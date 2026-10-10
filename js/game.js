'use strict';
// Player state, weapons, operators, bots and round flow.
const GUNS={
  ar:{n:'돌격소총',rpm:700,dmg:34,pel:1,spr:.028,hole:0,mag:30,res:120,kick:.012,auto:1,rel:1.9},
  smg:{n:'기관단총',rpm:950,dmg:23,pel:1,spr:.042,hole:0,mag:28,res:140,kick:.009,auto:1,rel:1.7},
  sg:{n:'산탄총',rpm:80,dmg:15,pel:8,spr:.14,hole:2,mag:6,res:24,kick:.05,auto:0,rel:2.4},
  dmr:{n:'지정사수소총',rpm:320,dmg:58,pel:1,spr:.012,hole:1,mag:12,res:48,kick:.03,auto:0,rel:2.1,zoom:.36},
  pistol:{n:'권총',rpm:420,dmg:30,pel:1,spr:.03,hole:0,mag:12,res:48,kick:.018,auto:0,rel:1.4}};
// Operators: [attackers, defenders]. g = gadget name (G key), nade = throwable (T key), d = menu description.
const OPS=[[
  {n:'돌파병',guns:['ar','pistol'],g:'돌파 폭약',gad:3,nade:'frag',nn:1,d:'돌격소총 · 돌파 폭약 ×3 · 수류탄'},
  {n:'해머',guns:['sg','smg'],g:'해머',gad:8,hammer:1,nade:'flash',nn:2,d:'산탄총 · 벽을 한 방에 부수는 해머 · 섬광탄 ×2'},
  {n:'용접병',guns:['ar','pistol'],g:'용접 폭약',gad:2,thermal:1,nade:'smoke',nn:2,d:'보강벽까지 뚫는 폭약 ×2 · 연막탄 ×2'},
  {n:'지정사수',guns:['dmr','pistol'],g:'돌파 폭약',gad:1,nade:'flash',nn:2,d:'한 발이 센 반자동 소총 · 섬광탄 ×2'}],[
  {n:'보강병',guns:['smg','sg'],g:'벽 보강',gad:4,nade:'impact',nn:2,d:'벽 보강 ×4 · 충격 수류탄 ×2'},
  {n:'방탄병',guns:['ar','pistol'],g:'벽 보강',gad:2,hp:150,nade:'impact',nn:1,d:'체력 150 · 벽 보강 ×2'},
  {n:'감지병',guns:['smg','pistol'],g:'심박 감지',gad:0,sensor:1,nade:'impact',nn:2,d:'G 누르는 동안 벽 너머 적 감지'},
  {n:'함정병',guns:['sg','pistol'],g:'문 함정',gad:3,trap:1,nade:'impact',nn:1,d:'문에 폭발 함정 ×3 (적이 지나가면 터짐)'}]];
cfg.ops=cfg.ops.map((v,i)=>clamp(v,0,OPS[i].length-1));

const me={id:-1,name:'',team:0,x:20.5,y:3.5,a:1.57,pitch:0,z:.5,lean:0,hp:100,maxHp:100,dead:0,gad:0,nn:0,drone:0,sx:0,sy:0,guns:['ar','pistol']};   // drone: 1 driving, 2 destroyed
const cam={x:20.5,y:3.5,a:1.57,z:.5,pitch:0};    // what is rendered: me, or the teammate I'm spectating
const bomb={x:0,y:0,S:P_BOMB,h:.45,w:.3};        // marks the objective room
let mode='menu',phase='lobby',phaseEnd=0,actDur=180,atkTeam=0,score=[0,0],msg='',site=0,spawnGrp=0;
let bots=[],others={},gun=0,ammo=[0,0],res=[0,0],fov=cfg.fov,charge=-1,bfsT=0,defuser=null,holdT=0,beepT=0,specI=0,sensing=0,flashT=0;
let fireT=0,reloadT=0,meleeT=0,nadeT=0,muzzle=0,hitT=0,hitHS=0,hurtT=0,hurtA=0,boomT=0,killT=0,bob=0,deathMsg='',feedV=0;
const feedL=[],stats={},pings=[],traps={};
const isAtk=()=>mode!=='mp'||me.team===atkTeam,side=()=>isAtk()?0:1,op=()=>OPS[side()][cfg.ops[side()]];
const canAct=()=>!me.dead&&(phase==='act'||phase==='prep'&&!isAtk());
const foes=()=>mode==='mp'?Object.values(others).filter(o=>o.team!==me.team):bots;
const curGun=()=>GUNS[me.guns[gun]];
const inSite=(x,y)=>zone[(y|0)*MW+(x|0)]===2+site;
const st=id=>stats[id]||(stats[id]={k:0,d:0});
function feed(e){e.t=Date.now();feedL.push(e);if(feedL.length>30)feedL.shift();feedV++}

// ---------- damage ----------
// ponytail: hits and wall damage are shooter-authoritative (a modified client can cheat).
// Move validation into hostReq-style host checks if that ever matters.
function hitFoe(t,dmg,hs){
  hitT=.18;hitHS=hs?1:0;sfx.hit(hs);
  if(t.bot)hitBot(t,dmg,hs);else send({t:'d',to:t.id,dmg,hs:hs?1:0});
}
function hitBot(b,d,hs){
  if(b.dead)return;
  b.hp-=d;b.hitT=.12;b.alert=1;
  if(b.hp>0)return;
  b.dead=1;feed({a:me.name,ta:0,b:b.name,tb:1,hs});killT=1.4;sfx.kill();
  if(bots.every(b=>b.dead))endSolo(1,'전원 제압');
}
// from: who or what did it — a player/bot object, or just {x,y} for the direction marker.
function hurt(d,by,from,hs){
  if(me.dead)return;
  if(me.drone===1&&phase==='prep'){me.drone=2;sfx.crash(me.x,me.y);return}   // my scouting drone got shot
  if(phase!=='act')return;
  me.hp-=d;hurtT=.5;sfx.hurt();
  if(from)hurtA=Math.atan2(from.y-me.y,from.x-me.x);
  if(me.hp>0)return;
  const bi=from&&from.id!==undefined?from.id:-1;
  me.dead=1;specI=0;deathMsg=by+(hs?'의 헤드샷':'')+'에 사망';
  st(me.id).d++;if(bi>=0)st(bi).k++;
  feed({a:by,ta:from&&from.team!==undefined?from.team:-1,b:me.name,tb:me.team,hs});
  send({t:'k',by,bi,hs:hs?1:0});
  if(mode==='solo')endSolo(0,'사망');
}

// ---------- player actions ----------
function reload(){
  const g=curGun();
  if(reloadT<=0&&ammo[gun]<g.mag&&res[gun]>0&&canAct()){reloadT=g.rel;sfx.reload(g.rel)}
}
function tryFire(){
  const k=me.guns[gun],g=GUNS[k];
  if(fireT>0||reloadT>0)return;
  if(!ammo[gun]){if(res[gun])reload();else if(fresh)sfx.dry();return}
  ammo[gun]--;fireT=60/g.rpm;muzzle=.06;
  const sp=g.spr*(ads?.3:1)*(moving?1.6:1)*(me.z<.4?.8:1);
  // a clean headshot kills (160 beats even the 150-hp operator); shotgun pellets only double
  for(let i=0;i<g.pel;i++)bullet(cam.x,cam.y,me.z,me.a+rnd(sp),me.pitch+rnd(sp),g.dmg,g.hole,null,g.pel>1?g.dmg*2:160);
  me.pitch=Math.min(.7,me.pitch+g.kick*(ads?.7:1));me.a+=rnd(g.kick);
  sfx.shot(k);send({t:'f',g:k});alertBots(14);
}
const aim=r=>trace(cam.x,cam.y,me.z,Math.cos(me.a),Math.sin(me.a),me.pitch,r,-2);
function doorAhead(open){                        // a doorway cell within arm's reach in front of me (open: only if unboarded)
  const ca=Math.cos(me.a),sa=Math.sin(me.a);
  for(let d=.3;d<1.8;d+=.25){const c=(me.y+sa*d|0)*MW+(me.x+ca*d|0);if(orig[c]===DOOR&&(!open||!grid[c]))return c}
  return -1;
}
function gadget(){
  if(!canAct())return;
  const o=op();
  if(charge>=0)return explode(charge,1,o.thermal);
  if(!me.gad||o.sensor)return;
  if(o.trap){
    const c=doorAhead(0);
    if(c>=0&&traps[c]===undefined){traps[c]=me.team;me.gad--;sfx.place();send({t:'tp',c})}
    return;
  }
  aim(1.6);
  if(hitC<0)return;
  const c=hitC,g=grid[c];
  if(o.hammer){if(g!==RTHIN){destroy(c);send({t:'x',c});me.gad--;meleeT=.6;sfx.thud(me.x,me.y)}}
  else if(isAtk()){if(g!==RTHIN||o.thermal){charge=c;me.gad--;sfx.place()}}
  else if(g===SOFT){reinforce(c,1);me.gad--}
}
function melee(){
  if(!canAct()||meleeT>0)return;
  meleeT=.45;sfx.melee();
  const dx=Math.cos(me.a),dy=Math.sin(me.a),d=aim(1.3),c=hitC,u=hitU,v=hitV;
  for(const t of foes()){
    const rx=t.x-cam.x,ry=t.y-cam.y,al=rx*dx+ry*dy;
    if(!t.dead&&t.z>.05&&al>0&&al<Math.min(d,1.1)&&Math.abs(rx*dy-ry*dx)<.3)return hitFoe(t,999);
  }
  if(c>=0)punch(c,u,v,5,1);
}
function throwNade(){
  const k=op().nade;
  if(!canAct()||!me.nn||nadeT>0||!k)return;
  me.nn--;nadeT=.8;sfx.melee();
  const ca=Math.cos(me.a),sa=Math.sin(me.a),ok=nadeSolid(cam.x+ca*.3,cam.y+sa*.3,me.z)<0;
  const n={k,x:cam.x+(ok?ca*.3:0),y:cam.y+(ok?sa*.3:0),z:me.z,vx:ca*7,vy:sa*7,vz:me.pitch*7+1.1,fuse:NADE[k].fuse,mine:1};
  nades.push(n);send({t:'g',k,x:n.x,y:n.y,z:n.z,vx:n.vx,vy:n.vy,vz:n.vz});
}
function tryBarricade(){
  const c=doorAhead(1),inC=p=>(p.y|0)*MW+(p.x|0)===c;
  if(!canAct()||meleeT>0||c<0)return;
  if(inC(me)||Object.values(others).some(o=>!o.dead&&inC(o))||bots.some(b=>!b.dead&&inC(b)))return;   // never board someone in
  meleeT=.8;barricade(c,1);
}
function addPing(x,y,z,who){pings.push({x,y,z,who,t:6});if(pings.length>8)pings.shift();sfx.ping()}
function doPing(){
  if(me.dead||mode==='menu'||phase==='lobby')return;
  const ca=Math.cos(me.a),sa=Math.sin(me.a),d=trace(cam.x,cam.y,me.z,ca,sa,me.pitch,30,-1)-.1;
  const x=cam.x+ca*d,y=cam.y+sa*d,z=clamp(me.z+me.pitch*d,.05,.95);
  addPing(x,y,z,me.name);send({t:'p',x,y,z});
}

// ---------- bots (solo practice only) ----------
function alertBots(r){for(const b of bots)if(Math.hypot(b.x-me.x,b.y-me.y)<r)b.alert=1}
function bfs(x,y){                               // flow field toward (x,y); bots may break barricades on the way
  flow.fill(-1);const q=[(y|0)*MW+(x|0)];flow[q[0]]=0;
  for(let i=0;i<q.length;i++){const c=q[i];for(const n of [c-1,c+1,c-MW,c+MW])if(flow[n]<0&&(!grid[n]||grid[n]===DOOR)){flow[n]=flow[c]+1;q.push(n)}}
}
function smoked(x0,y0,x1,y1){                    // does a smoke cloud sit on this sight line?
  for(const s of smokes){
    const dx=x1-x0,dy=y1-y0,t=clamp(((s.x-x0)*dx+(s.y-y0)*dy)/(dx*dx+dy*dy||1),0,1);
    if(Math.hypot(x0+dx*t-s.x,y0+dy*t-s.y)<1.1)return 1;
  }
  return 0;
}
function updBot(b,dt){
  b.hitT-=dt;b.flash-=dt;b.blind-=dt;b.mv=0;if(b.dead)return;
  const dx=cam.x-b.x,dy=cam.y-b.y,d=Math.hypot(dx,dy),to=Math.atan2(dy,dx);
  const see=!me.dead&&b.blind<=0&&d<20&&(b.alert||d<2.5||Math.cos(to-b.a)>-.2)&&!smoked(b.x,b.y,cam.x,cam.y)&&los(b.x,b.y,.5,cam.x,cam.y,me.z);
  if(see){
    if(!b.saw)b.react=.55+Math.random()*.4;      // reaction time before the first shot
    b.alert=1;b.a=to;b.df=0;
    if((b.react-=dt)<=0){
      b.react=.14+Math.random()*.3;b.flash=.07;sfx.shot('smg',b.x,b.y);
      bullet(b.x,b.y,.45,to+rnd(.13),(me.z-.65)/d+rnd(.07),11,0,b);
    }
  }else if(defuser&&Math.hypot(b.x-defuser.x,b.y-defuser.y)<1.2){
    if((b.df+=dt)>5)endSolo(0,'봇이 디퓨저를 해제');          // left alone at the defuser for 5 s
  }else if(b.alert&&b.roam){
    const c=(b.y|0)*MW+(b.x|0);let n=c;
    for(const k of [c-1,c+1,c-MW,c+MW])if(flow[k]>=0&&(flow[n]<0||flow[k]<flow[n]))n=k;
    if(n!==c){
      const tx=n%MW+.5,ty=(n/MW|0)+.5,l=Math.hypot(tx-b.x,ty-b.y);b.a=Math.atan2(ty-b.y,tx-b.x);
      if(grid[n]){if((b.brk+=dt)>.8){destroy(n);b.brk=0}}
      else{b.x+=(tx-b.x)/l*1.6*dt;b.y+=(ty-b.y)/l*1.6*dt;b.mv=1.6;b.walk+=1.6*dt}
    }
  }
  b.saw=see;b.av=b.a;
}

// ---------- round flow ----------
function loadout(){
  const o=op();
  me.guns=o.guns;gun=0;ammo=o.guns.map(k=>GUNS[k].mag);res=o.guns.map(k=>GUNS[k].res);
  me.hp=me.maxHp=o.hp||100;me.gad=o.gad;me.nn=o.nn||0;reloadT=0;
}
function resetMe(){
  me.dead=0;me.pitch=me.lean=0;me.z=.5;me.a=Math.atan2(sites[site].y-me.y,sites[site].x-me.x);
  me.sx=me.x;me.sy=me.y;me.drone=mode==='mp'&&isAtk()?1:0;      // attackers scout by drone during prep
  holdT=flashT=0;deathMsg='';loadout();
}
function newRound(s,g){
  loadMap();site=s;spawnGrp=g;charge=-1;defuser=null;msg='';
  parts.length=nades.length=smokes.length=pings.length=0;for(const c in traps)delete traps[c];
  bomb.x=sites[s].x;bomb.y=sites[s].y;
}
const atkSpawn=i=>spawns[spawnGrp][i%5];
function defSpawn(i){const cs=sites[site].cells,c=cs[(1+i*4)%cs.length];return [c%MW+.5,(c/MW|0)+.5]}   // spread through the objective room
function startSolo(){
  mode='solo';me.team=atkTeam=0;me.id=-1;feedL.length=0;feedV++;
  newRound(Math.random()*sites.length|0,Math.random()*4|0);
  [me.x,me.y]=atkSpawn(0);resetMe();
  const S=sites[site],near=roamSpots.slice().sort((a,b)=>Math.hypot(a[0]-S.x,a[1]-S.y)-Math.hypot(b[0]-S.x,b[1]-S.y));
  bots=[0,1,2].map(defSpawn).concat(near.slice(0,2)).map(([x,y],i)=>({x,y,z:.5,a:Math.random()*7,av:0,hp:100,roam:i>2,bot:1,team:1,
    name:'봇'+(i+1),react:0,alert:0,saw:0,brk:0,flash:0,hitT:0,walk:0,mv:0,blind:0,df:0}));
  phase='act';phaseEnd=Date.now()+180e3;showMenu(0);banner('작전 개시','붉은 바닥 방에 디퓨저를 설치하거나 전원 제압');sfx.horn();
}
function endSolo(win,why){
  if(phase==='end')return;
  phase='end';phaseEnd=Date.now()+1500;msg=(win?'승리':'패배')+' — '+why+'\n클릭해서 다시 시작';
  banner(win?'승리':'패배',why);sfx.jingle(win);
}
