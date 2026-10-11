'use strict';
// Player state, weapons, operators, host-driven bots and round flow.
// Damage, fire rate and magazine follow Siege's own figures for each class: ar ~ R4-C / AK-12, smg ~ MP5 / FMG-9,
// dmr ~ 417, pistol ~ P226, shotgun ~ M590A1. fo is the range falloff in cells (a cell is roughly a metre): full damage up
// to fo[0], down to the share fo[2] from fo[1] on. A headshot kills at any range, except from the shotgun.
const GUNS={
  ar:{n:'돌격소총',rpm:800,dmg:42,pel:1,spr:.028,hole:0,mag:30,res:120,kick:.012,auto:1,rel:1.9,fo:[22,32,.55]},
  smg:{n:'기관단총',rpm:850,dmg:30,pel:1,spr:.042,hole:0,mag:30,res:150,kick:.009,auto:1,rel:1.7,fo:[16,25,.6]},
  sg:{n:'산탄총',rpm:80,dmg:34,pel:8,spr:.14,hole:2,mag:7,res:28,kick:.05,auto:0,rel:2.4,fo:[4,11,.3]},
  dmr:{n:'지정사수소총',rpm:450,dmg:66,pel:1,spr:.012,hole:1,mag:20,res:60,kick:.03,auto:0,rel:2.1,zoom:.36},
  pistol:{n:'권총',rpm:450,dmg:48,pel:1,spr:.03,hole:0,mag:15,res:45,kick:.018,auto:0,rel:1.4,fo:[11,20,.6]},
  shield:{n:'방탄 방패 + 권총',rpm:300,dmg:48,pel:1,spr:.075,hole:0,mag:15,res:45,kick:.02,auto:0,rel:1.6,fo:[11,20,.6],shield:1}};   // while it is out, rounds from the front stop on it
// Operators: [attackers, defenders]. g = gadget name (G key), nade = throwable (T key), d = menu description.
// cls is Siege's weight class: 1 light (fast, least health), 2 medium, 3 heavy (slow, most health).
const HP=[0,100,110,125],SPD=[0,1.08,1,.92];
const OPS=[[
  {n:'돌파병',cls:1,guns:['ar','pistol'],g:'돌파 폭약',gad:3,nade:'frag',nn:1,d:'돌격소총 · 돌파 폭약 ×3 · 수류탄'},
  {n:'해머',cls:2,guns:['sg','smg'],g:'해머',gad:8,hammer:1,nade:'flash',nn:2,d:'산탄총 · 벽을 한 방에 부수는 해머 · 섬광탄 ×2'},
  {n:'용접병',cls:2,guns:['ar','pistol'],g:'용접 폭약',gad:2,thermal:1,nade:'smoke',nn:2,d:'보강벽·보강 해치까지 뚫는 폭약 ×2 · 연막탄 ×2'},
  {n:'지정사수',cls:2,guns:['dmr','pistol'],g:'돌파 폭약',gad:1,nade:'clay',nn:2,d:'한 발이 센 반자동 소총 · 클레이모어 ×2 (밟으면 폭발)'},
  {n:'방패병',cls:3,guns:['shield','pistol'],g:'돌파 폭약',gad:1,nade:'smoke',nn:2,d:'방탄 방패: 들고 있으면 정면 총알을 막는다 · 연막탄 ×2'}],[
  {n:'보강병',cls:2,guns:['smg','sg'],g:'벽 보강',gad:4,nade:'shield',nn:1,d:'벽·해치 보강 ×4 · 설치형 방패'},
  {n:'방탄병',cls:3,guns:['ar','pistol'],g:'벽 보강',gad:2,hp:150,nade:'wire',nn:2,d:'방탄판 · 벽·해치 보강 ×2 · 철조망 ×2 (적이 느려짐)'},
  {n:'감지병',cls:1,guns:['smg','pistol'],g:'심박 감지',gad:0,sensor:1,nade:'c4',nn:1,d:'G 누르는 동안 벽 너머 적 감지 · C4 (T 던지고 T 기폭)'},
  {n:'함정병',cls:2,guns:['sg','pistol'],g:'문 함정',gad:3,trap:1,nade:'impact',nn:1,d:'문에 폭발 함정 ×3 (적이 지나가면 터짐)'},
  {n:'의무병',cls:2,guns:['smg','pistol'],g:'치료 주사',gad:3,heal:1,nade:'impact',nn:1,d:'G: 조준한 아군(없으면 자신) 체력 +40 ×3'}]];
cfg.ops=cfg.ops.map((v,i)=>clamp(v,0,OPS[i].length-1));

// x, y (storey folded in), h = feet above that storey's floor, z = eye height above the feet, a = yaw, pa = pitch angle (pitch = its tangent)
const me={id:-1,name:'',team:0,x:spawns[0][2][0],y:spawns[0][2][1],h:0,a:1.57,pa:0,pitch:0,z:.5,lean:0,hp:100,maxHp:100,dead:0,gad:0,nn:0,drone:0,sx:0,sy:0,guns:['ar','pistol']};   // drone: 1 driving, 2 destroyed
const cam={x:me.x,y:me.y,a:1.57,z:.5,pa:0,pitch:0};   // the eye that is rendered and shot from: mine, or the teammate I'm spectating
const bomb={x:0,y:0};                            // marks the objective room
let mode='menu',phase='lobby',phaseEnd=0,actDur=180,atkTeam=0,score=[0,0],msg='',site=0,spawnGrp=0,offline=0,fillTo=0;
let others={},gun=0,ammo=[0,0],res=[0,0],fov=cfg.fov,charge=-1,defuser=null,holdT=0,beepT=0,specI=0,sensing=0,flashT=0,fade=0;
let fireT=0,reloadT=0,meleeT=0,nadeT=0,muzzle=0,hitT=0,hitHS=0,hurtT=0,hurtA=0,boomT=0,killT=0,bob=0,deathMsg='',feedV=0,shots=0;
const feedL=[],stats={},pings=[],traps={},wires={},flows={};   // traps, wires: cell -> team that set it
me.op=OPS[0][cfg.ops[0]];                        // the operator I'm equipped as; a menu pick only takes effect at the next loadout
const isAtk=()=>me.team===atkTeam,side=()=>isAtk()?0:1,op=()=>me.op;
const canAct=()=>!me.dead&&(phase==='act'||phase==='prep'&&!isAtk());
const foes=()=>Object.values(others).filter(o=>o.team!==me.team);
const enemiesOf=t=>[me,...Object.values(others)].filter(e=>e.team!==t);
const hostBots=()=>isHost?Object.values(others).filter(o=>o.bot&&!o.dead):[];
const curGun=()=>GUNS[me.guns[gun]];
const inSite=(x,y)=>zone[(y|0)*MW+(x|0)]===2+site;
const st=id=>stats[id]||(stats[id]={k:0,d:0});
function feed(e){e.t=Date.now();feedL.push(e);if(feedL.length>30)feedL.shift();feedV++}

// ---------- damage ----------
// ponytail: hits and wall damage are shooter-authoritative (a modified client can cheat).
// Move validation into hostReq-style host checks if that ever matters.
function hitFoe(t,dmg,hs){                       // my bullet or blade landed on t
  hitT=.18;hitHS=hs?1:0;sfx.hit(hs);
  if(isHost&&t.bot)botHurt(t,dmg,me,hs);else send({t:'d',to:t.id,dmg,hs:hs?1:0});
}
// from: who or what did it — a player/bot object, or just {x,y} for the direction marker.
function hurt(d,by,from,hs,bul){                  // bul: it was a bullet (a shield can stop it)
  if(me.dead)return;
  if(me.drone===1&&phase==='prep'){me.drone=2;sfx.crash(me.x,me.y);return}   // my scouting drone got shot
  if(phase!=='act')return;
  if(bul&&d<500&&curGun().shield&&!me.rap&&from&&floorOf(from.y)===floorOf(me.y)&&Math.cos(Math.atan2(fold(from.y)-fold(me.y),from.x-me.x)-me.a)>.45){
    sfx.steel(me.x,me.y);spawnP(me.x+Math.cos(me.a)*.3,me.y+Math.sin(me.a)*.3,me.h+.4,3,SPARK,2,.2,1);return;   // the ballistic shield took it
  }
  me.hp-=d;hurtT=.5;sfx.hurt();
  if(from&&from.x!==undefined)hurtA=Math.atan2(fold(from.y)-fold(me.y),from.x-me.x);
  if(me.hp>0)return;
  const bi=from&&from.id!==undefined?from.id:-1;
  me.dead=1;specI=0;deathMsg=by+(hs?'의 헤드샷':'')+'에 사망';
  st(me.id).d++;if(bi>=0)st(bi).k++;
  feed({a:by,ta:from&&from.team!==undefined?from.team:-1,b:me.name,tb:me.team,hs});
  send({t:'k',by,bi,hs:hs?1:0});
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
  // spread: the first shot is true, a burst blooms, moving costs, aiming and crouching help
  const sp=g.spr*(ads?.3:1)*(moving?1.6:1)*(me.z<.4?.8:1)*(g.pel>1?1:Math.min(2.2,.25+shots*.25));
  // a clean headshot kills (160 beats even the 150-hp operator); shotgun pellets only double
  for(let i=0;i<g.pel;i++)bullet(cam.x,cam.y,cam.z,me.a+rnd(sp),me.pitch+rnd(sp),g.dmg,g.hole,me,g.pel>1?g.dmg*1.5:160,g.fo);
  // recoil: a fixed climb with a left-right weave you can learn, instead of random jitter
  me.pa=Math.min(1.35,me.pa+g.kick*(ads?.7:1));me.a+=g.kick*.6*Math.sin(shots*1.3)*(ads?.6:1);shots++;
  sfx.shot(k);send({t:'f',g:k});noiseAt(me.x,me.y,14,me.team);
}
const aim=r=>trace(cam.x,cam.y,cam.z,Math.cos(me.a),Math.sin(me.a),me.pitch,r,-2);
function aimHatch(){                             // the hatch I'm looking down at, or up at from the storey below; -1 if none
  const p=me.pitch;if(Math.abs(p)<.3||me.dead||me.drone)return -1;
  const d=p<0?cam.z/-p:(1-cam.z)/p;if(d>2.2)return -1;
  const c=(cam.y+Math.sin(me.a)*d|0)*MW+(cam.x+Math.cos(me.a)*d|0)+(p>0?OFFC:0);
  return c<NC&&hatch[c]?c:-1;
}
function doorAhead(open){                        // a doorway cell within arm's reach in front of me (open: only if unboarded)
  const ca=Math.cos(me.a),sa=Math.sin(me.a);
  for(let d=.3;d<1.8;d+=.25){const c=(me.y+sa*d|0)*MW+(me.x+ca*d|0);if(orig[c]===DOOR&&(!open||!grid[c]))return c}
  return -1;
}
function gadget(){
  if(!canAct())return;
  const o=op(),hc=aimHatch();
  if(charge>=0)return explode(charge,1,o.thermal);
  if(!me.gad||o.sensor)return;
  if(o.heal){                                    // medic: the teammate under the crosshair, or myself
    const dx=Math.cos(me.a),dy=Math.sin(me.a),near=t=>{const rx=t.x-me.x,ry=fold(t.y)-fold(me.y),al=rx*dx+ry*dy;return al>0&&al<2.2&&Math.abs(rx*dy-ry*dx)<.5};
    const t=Object.values(others).find(t=>t.team===me.team&&!t.dead&&t.z>.2&&floorOf(t.y)===floorOf(me.y)&&near(t));
    if(t){if(isHost&&t.bot)t.hp=Math.min(100,t.hp+40);else send({t:'hl',to:t.id})}
    else if(me.hp<me.maxHp)me.hp=Math.min(me.maxHp,me.hp+40);
    else return;
    me.gad--;return sfx.ui();
  }
  if(hc>=0){
    const s=hatch[hc];
    if(o.trap)return;
    if(!isAtk()){if(s===1){hatch[hc]=2;geoDirty=1;me.gad--;sfx.steel(me.x,me.y);send({t:'hr',c:hc})}}
    else if(s===1||s===2&&o.thermal){openHatch(hc,1);me.gad--;meleeT=.6;sfx.thud(me.x,me.y);if(!o.hammer)boomT=.25}
    return;
  }
  if(o.trap){
    const c=doorAhead(0);
    if(c>=0&&traps[c]===undefined){traps[c]=me.team;me.gad--;sfx.place();send({t:'tp',c})}
    return;
  }
  aim(1.6);
  if(hitC<0)return;
  const c=hitC,g=grid[c];
  if(g===HWALL)return;                           // solid wall: nothing to place or break
  if(o.hammer){if(g!==RTHIN){destroy(c);send({t:'x',c});me.gad--;meleeT=.6;sfx.thud(me.x,me.y)}}
  else if(isAtk()){if(g!==RTHIN||o.thermal){charge=c;me.gad--;sfx.place()}}
  else if(g===SOFT){reinforce(c,1);me.gad--}
}
function melee(){
  if(!canAct()||meleeT>0)return;
  meleeT=.45;sfx.melee();
  const dx=Math.cos(me.a),dy=Math.sin(me.a),hc=aimHatch(),d=aim(1.3),c=hitC,u=hitU,v=hitV;
  for(const t of foes()){
    const rx=t.x-cam.x,ry=fold(t.y)-fold(cam.y),al=rx*dx+ry*dy;
    if(!t.dead&&t.z>.05&&al>0&&al<Math.min(d,1.1)&&Math.abs(rx*dy-ry*dx)<.3&&Math.abs(absZ(t.y,t.h)-absZ(me.y,me.h))<.6)return hitFoe(t,999);
  }
  const wc=[(me.y|0)*MW+(me.x|0),((me.y+dy*.9)|0)*MW+((me.x+dx*.9)|0)].find(k=>wires[k]!==undefined&&wires[k]!==me.team);
  if(wc!==undefined){delete wires[wc];send({t:'wx',c:wc});return sfx.clink(me.x,me.y)}     // cut the other side's barbed wire
  if(hc>=0)hitHatch(hc,1);else if(c>=0)punch(c,u,v,5,1);
}
function throwNade(){
  const k=op().nade,live=nades.find(n=>n.mine&&n.k==='c4');
  if(!canAct()||nadeT>0||!k)return;
  if(live){                                      // second press: set off the C4 I threw
    nades.splice(nades.indexOf(live),1);nadeT=.5;send({t:'ge',k:'c4',x:live.x,y:live.y,z:live.z,c:-1});
    return nadeBoom('c4',live.x,live.y,live.z,-1,me);
  }
  if(!me.nn)return;
  if(NADE[k].place){                             // set down on the floor cell ahead instead of thrown
    const ca=Math.cos(me.a),sa=Math.sin(me.a),ax=Math.abs(ca)>Math.abs(sa),c=((me.y|0)+(ax?0:Math.sign(sa)))*MW+(me.x|0)+(ax?Math.sign(ca):0);
    if(me.rap||grid[c]||nofloor[c]||ramp[c]||hatch[c]||wires[c]!==undefined||traps[c]!==undefined)return;
    if(Object.values(others).some(o=>!o.dead&&(o.y|0)*MW+(o.x|0)===c))return;
    me.nn--;nadeT=.8;sfx.place();
    if(k==='shield')placeShield(c,ax?0:1,1);
    else if(k==='wire'){wires[c]=me.team;send({t:'w',c})}
    else{traps[c]=me.team;send({t:'tp',c})}       // claymore: goes off under the first enemy to step on it
    return;
  }
  me.nn--;nadeT=.8;sfx.melee();
  const cp=Math.cos(me.pa),ca=Math.cos(me.a)*cp,sa=Math.sin(me.a)*cp,ok=nadeSolid(cam.x+ca*.3,cam.y+sa*.3,cam.z)<0;
  const n={k,x:cam.x+(ok?ca*.3:0),y:cam.y+(ok?sa*.3:0),z:cam.z,vx:ca*7,vy:sa*7,vz:Math.sin(me.pa)*7+1.1,fuse:NADE[k].fuse,mine:1};
  nades.push(n);send({t:'g',k,x:n.x,y:n.y,z:n.z,vx:n.vx,vy:n.vy,vz:n.vz});
}
function tryBarricade(){
  const c=doorAhead(1),inC=p=>(p.y|0)*MW+(p.x|0)===c;
  if(!canAct()||meleeT>0||c<0)return;
  if(inC(me)||Object.values(others).some(o=>!o.dead&&inC(o)))return;   // never board someone in
  meleeT=.8;barricade(c,1);
}
function addPing(x,y,z,who){pings.push({x,y,z,who,t:6});if(pings.length>8)pings.shift();sfx.ping()}
// ---------- rope and windows (Space) ----------
// Attackers clip onto a rope at any outside face of the house and ride it up or down; from the rope they climb in through
// an opened window, a breached wall or onto a balcony. Anyone can climb through an opened window from the floor.
// ponytail: no rope is drawn and nobody hangs upside down; bots do not use it.
const winOpen=c=>grid[c]===WIN&&holeN[c]>9000;
const face=k=>k>=0&&k<NC&&(orig[k]===BRICK||orig[k]>=SOFT),ledge=k=>k>=0&&k<NC&&!orig[k]&&!nofloor[k]&&zone[k]===0;
function rapFace(c,dx,dy){const w=c+dx+dy*MW;return face(w)||face(w+OFFC)||ledge(w+OFFC)||nofloor[c]&&ledge(w)}   // wall here or above, or a ledge to reach
function spaceAct(){                             // what Space would do now: k 1 climb to cell t, 2 let go of the rope, 3 clip on
  const ca=Math.cos(me.a),sa=Math.sin(me.a),ax=Math.abs(ca)>Math.abs(sa);
  const dx=me.rap?me.rx:ax?Math.sign(ca):0,dy=me.rap?me.ry:ax?0:Math.sign(sa),c=(me.y|0)*MW+(me.x|0),w=c+dx+dy*MW;
  const t=winOpen(w)||grid[w]===SHIELD?w+dx+dy*MW:me.rap&&nofloor[c]&&!grid[w]?w:-1;   // over a sill or a shield, or (off the rope) onto a ledge
  if(t>=0&&me.h<.5&&!grid[t]&&!nofloor[t])return {k:1,t};
  if(me.rap)return {k:!nofloor[c]&&me.h<.3?2:0};
  return {k:isAtk()&&phase==='act'&&zone[c]===0&&!nofloor[c]&&me.h<.1&&rapFace(c,dx,dy)?3:0,dx,dy};
}
function vault(){
  if(!canAct()||me.drone)return;
  const s=spaceAct();
  if(s.k===1){me.x=s.t%MW+.5;me.y=(s.t/MW|0)+.5;me.h=0;me.rap=0;sfx.thud(me.x,me.y)}
  else if(s.k===2){me.rap=0;me.h=0}
  else if(s.k===3){me.rap=1;me.rx=s.dx;me.ry=s.dy;me.x=(me.x|0)+.5+s.dx*.28;me.y=(me.y|0)+.5+s.dy*.28;me.vz=0;sfx.place()}
}
function rappel(f,s,dt){                          // on the rope: f up/down, s along the wall
  const c=(me.y|0)*MW+(me.x|0);
  me.h+=f*1.3*dt;
  if(me.h>=1){const up=c+OFFC;if(up<NC&&!grid[up]&&nofloor[up]){me.y+=FH;me.h-=1}else me.h=.99}
  if(me.h<0){if(nofloor[c]){me.y-=FH;me.h+=1}else me.h=0}
  if(floorOf(me.y)===NL-1)me.h=Math.min(me.h,.45);                  // nothing to stand on up there: stop under the eaves
  if(s){
    const x=me.x-me.ry*s*1.2*dt,y=me.y+me.rx*s*1.2*dt;
    if(free(x,y)&&rapFace((y|0)*MW+(x|0),me.rx,me.ry))me.x=x,me.y=y;
  }
}
function doPing(){
  if(me.dead||mode==='menu'||phase==='lobby')return;
  const ca=Math.cos(me.a),sa=Math.sin(me.a),d=trace(cam.x,cam.y,cam.z,ca,sa,me.pitch,30,-1)-.1;
  const za=clamp(absZ(cam.y,cam.z)+me.pitch*d,.05,NL-.05),f=za|0,x=cam.x+ca*d,y=fold(cam.y)+sa*d+f*FH,z=za-f;
  addPing(x,y,z,me.name);send({t:'p',x,y,z});
}

// ---------- bots ----------
// Bots are ordinary roster entries that the host's browser plays: it moves them, shoots for them and takes hits for
// them, and everyone else sees them through the same snapshots and events as a human. Solo practice is just an
// offline host with bots on both sides.
// Steps between cells. Stairs: the low half joins the floor around it, the high half only joins the low half and the
// landing one storey up (link). An open hatch adds a one-way drop.
function adj(c){
  const d=ramp[c];
  if(d)return rampB[c]?[c-d,link[c]]:d===1||d===-1?[c+d,c-d,c-MW,c+MW]:[c+d,c-d,c-1,c+1];
  const n=[c-1,c+1,c-MW,c+MW].filter(k=>!rampB[k]);
  if(link[c]>=0)n.push(link[c]);
  return n;
}
const fwd=c=>hatch[c]===3?[...adj(c),c-OFFC]:adj(c);                         // where you can step from c
const rev=c=>c+OFFC<NC&&hatch[c+OFFC]===3?[...adj(c),c+OFFC]:adj(c);          // where you can step to c from
function flowTo(x,y){                            // steps-to-goal for every cell, cached for half a second; doors count as passable (bots break them)
  const g=(y|0)*MW+(x|0),now=Date.now();let f=flows[g];
  if(!f||now-f.t>500){
    f=flows[g]=f||{a:new Int16Array(NC)};f.t=now;f.a.fill(-1);
    const q=[g];f.a[g]=0;
    for(let i=0;i<q.length;i++){const c=q[i];for(const n of rev(c))if(f.a[n]<0&&(!grid[n]||grid[n]===DOOR||grid[n]===SHIELD)&&!nofloor[n]){f.a[n]=f.a[c]+1;q.push(n)}}
  }
  return f.a;
}
function smoked(x0,y0,x1,y1){                    // does a smoke cloud sit on this sight line? (same storey only)
  for(const s of smokes){
    if(floorOf(s.y)!==floorOf(y0))continue;
    const dx=x1-x0,dy=y1-y0,t=clamp(((s.x-x0)*dx+(s.y-y0)*dy)/(dx*dx+dy*dy||1),0,1);
    if(Math.hypot(x0+dx*t-s.x,y0+dy*t-s.y)<1.1)return 1;
  }
  return 0;
}
function noiseAt(x,y,r,team){                    // host: bots of the other side within earshot turn hostile and remember where
  for(const b of hostBots())if(b.team!==team&&Math.hypot(b.x-x,fold(b.y)-fold(y))<r){b.alert=1;b.heard=[x,y];b.heardT=Date.now()}
}
let prepN=0;
function botPrep(){                              // host, each net tick of the prep phase: defender bots reinforce up to three walls of the objective
  if(prepN>2||Math.random()>.04||!hostBots().some(b=>b.team!==atkTeam))return;
  const cand=[];for(const c of sites[site].cells)for(const n of [c-1,c+1,c-MW,c+MW])if(grid[n]===SOFT)cand.push(n);
  if(cand.length){prepN++;reinforce(cand[Math.random()*cand.length|0],1)}
}
function initBot(b,slot){
  Object.assign(b,{hp:100,z:.5,h:0,alert:0,saw:0,react:0,blind:0,df:0,plantT:0,brk:0,last:null,lastT:0,heard:null,heardT:0,
    post:[b.x,b.y],roam:slot>2,wait:1+Math.random()*5,mv:0,walk:0,flash:0});
  b.a=b.av=Math.atan2(fold(sites[site].y)-fold(b.y),sites[site].x-b.x);
}
function botHurt(b,dmg,from,hs){
  if(b.dead||phase!=='act')return;
  b.hp-=dmg;b.alert=1;
  if(from&&from.x!==undefined){b.last=[from.x,from.y];b.lastT=Date.now()}
  if(b.hp<=0)toAll({t:'k',id:b.id,by:from&&from.name||'?',bi:from&&from.id!==undefined?from.id:-1,hs:hs?1:0});
}
function hitBy(b,t,dmg){                         // a bot's bullet landed on t
  if(t===me)hurt(dmg,b.name,b,0,1);else if(t.bot)botHurt(t,dmg,b);else relay({t:'d',id:b.id,to:t.id,dmg,hs:0},-1);
}
function updBot(b,dt){
  b.blind-=dt;b.flash-=dt;b.mv=0;b.tx=b.x;b.ty=b.y;
  if(b.dead)return;
  const [by,bz]=eyeOf(b,.5);
  let tg=null,td=22;                             // nearest enemy in sight (drones are ignored); sight lines run through open floors too
  if(b.blind<=0)for(const e of enemiesOf(b.team)){
    if(e.dead||e.z<.2)continue;
    const d=Math.hypot(e.x-b.x,fold(e.y)-fold(b.y)),fa=Math.atan2(fold(e.y)-fold(b.y),e.x-b.x);
    if(d<td&&(b.alert||d<2.5||Math.cos(fa-b.a)>-.2)&&!smoked(b.x,b.y,e.x,e.y)&&sees(b.x,by,bz,e)){tg=e;td=d}
  }
  if(tg){
    if(!b.saw)b.react=(b.team===atkTeam?.6:.35)+Math.random()*.4;   // reaction time before the first shot; defenders are holding angles
    b.alert=1;b.a=Math.atan2(fold(tg.y)-fold(b.y),tg.x-b.x);b.last=[tg.x,tg.y];b.lastT=Date.now();b.df=b.plantT=0;
    if((b.react-=dt)<=0){
      const [gy,gz]=eyeOf(b,.45),d=Math.max(.3,td);
      b.react=.14+Math.random()*.3;b.flash=.08;sfx.shot('smg',b.x,b.y);relay({t:'f',id:b.id,g:'smg'},-1);
      bullet(b.x,gy,gz,b.a+rnd(.13),(absZ(tg.y,tg.h+tg.z-.15)-absZ(gy,gz))/d+rnd(.07),11,0,b,11);
      noiseAt(b.x,b.y,12,b.team);
    }
  }else if((b.wait-=dt)<0)botMove(b,dt);
  b.h=ground(b.x,b.y);b.saw=tg?1:0;b.av=b.a;
}
function botMove(b,dt){
  const atk=b.team===atkTeam,now=Date.now(),S=sites[site];let goal=null;
  if(defuser){
    const d=near3(b,defuser.x,defuser.y,.2);
    if(atk){if(d>2.5)goal=[defuser.x,defuser.y]}                               // attackers guard the defuser
    else if(d>1.2)goal=[defuser.x,defuser.y];
    else if((b.df+=dt)>5){b.df=0;endMP(1-atkTeam,'디퓨저 해제')}                // left alone on it for 5 s
  }else if(b.last&&now-b.lastT<6000)goal=b.last;                               // chase the last sighting
  else if(atk){
    if(near3(b,S.x,S.y,.3)>1.5)goal=[S.x,S.y];
    if(inSite(b.x,b.y)&&(b.plantT+=dt)>5){b.plantT=0;toAll({t:'planted',x:b.x,y:b.y,by:b.name})}   // in the room, nobody in sight: plant
  }else if(b.roam&&b.heard&&now-b.heardT<8000)goal=b.heard;                    // roamers go and look at noises
  else if(Math.hypot(b.x-b.post[0],b.y-b.post[1])>.6)goal=b.post;              // everyone else returns to their post
  if(!goal)return;
  const f=flowTo(goal[0],goal[1]),c=(b.y|0)*MW+(b.x|0);let n=c;
  for(const k of fwd(c))if(f[k]>=0&&(f[n]<0||f[k]<f[n]))n=k;
  if(n===c)return;
  if(grid[n]){if((b.brk+=dt)>.8){b.brk=0;destroy(n);send({t:'x',c:n})}return}   // a barricade in the way: break it
  const tx=n%MW+.5,ty=(n/MW|0)+.5;
  if(Math.abs(n-c)>MW){b.x=tx;b.y=ty;return}                                   // onto the next storey: the top of the stairs, or down a hatch
  const l=Math.hypot(tx-b.x,ty-b.y);b.a=Math.atan2(ty-b.y,tx-b.x);
  const v=wires[c]!==undefined&&wires[c]!==b.team?.9:2;                        // barbed wire drags
  b.x+=(tx-b.x)/l*v*dt;b.y+=(ty-b.y)/l*v*dt;b.mv=v;b.walk+=v*dt;
  if(traps[c]!==undefined&&traps[c]!==b.team){toAll({t:'tr',c});botHurt(b,70,{name:'함정'})}
}

// ---------- round flow ----------
function loadout(){
  const o=me.op=OPS[side()][cfg.ops[side()]];
  me.guns=o.guns;gun=0;ammo=o.guns.map(k=>GUNS[k].mag);res=o.guns.map(k=>GUNS[k].res);
  me.hp=me.maxHp=o.hp||HP[o.cls];me.gad=o.gad;me.nn=o.nn||0;reloadT=0;
}
function resetMe(){
  me.dead=0;me.pa=me.pitch=me.lean=me.h=0;me.z=.5;me.a=Math.atan2(fold(sites[site].y)-fold(me.y),sites[site].x-me.x);
  me.sx=me.x;me.sy=me.y;me.drone=isAtk()?1:0;me.rap=0;    // attackers scout by drone during prep
  holdT=flashT=shots=0;deathMsg='';loadout();
}
function newRound(s,g){
  loadMap();site=s;spawnGrp=g;charge=-1;defuser=null;msg='';
  parts.length=nades.length=smokes.length=pings.length=0;
  for(const c in traps)delete traps[c];for(const c in wires)delete wires[c];for(const c in flows)delete flows[c];prepN=0;
  bomb.x=sites[s].x;bomb.y=sites[s].y;
}
const atkSpawn=i=>spawns[spawnGrp][i%5];
function defSpawn(i){const cs=sites[site].cells,c=cs[(1+i*3)%cs.length];return [c%MW+.5,(c/MW|0)+.5]}   // spread through the objective room
function startOffline(alone){                    // solo practice: a local match, bots fill both teams — or only the other one
  offline=1;isHost=1;mode='mp';me.id=0;me.name=myName();fillTo=alone?6:5;score=[0,0];atkTeam=0;
  roster=[{id:0,name:me.name,team:0}];syncLobby();startRound();
}
