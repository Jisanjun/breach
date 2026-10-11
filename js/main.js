'use strict';
// Frame loop: simulate, render, HUD. Plus the self-check (open index.html#test and read the console).
const solid=(x,y,dr)=>{const g=grid[(y|0)*MW+(x|0)];return g&&!(dr&&g===DOOR)};     // drones slip under door barricades
const free=(x,y,dr)=>!(solid(x-.2,y-.2,dr)||solid(x+.2,y-.2,dr)||solid(x-.2,y+.2,dr)||solid(x+.2,y+.2,dr));
function viewTarget(){                           // dead in a match: watch a living teammate
  if(!me.dead||mode!=='mp'||phase==='lobby')return null;
  const m=Object.values(others).filter(o=>o.team===me.team&&!o.dead&&o.z>.05);
  return m.length?m[specI%m.length]:null;
}
let stepT=0;
function update(dt){
  fireT-=dt;meleeT-=dt;nadeT-=dt;muzzle-=dt;hitT-=dt;hurtT-=dt;boomT-=dt;killT-=dt;flashT-=dt;
  if(mode==='menu'){me.a+=dt*.12;cam.a=me.a;return}            // title screen: slow pan over the yard
  if(reloadT>0&&(reloadT-=dt)<=0){const n=Math.min(curGun().mag-ammo[gun],res[gun]);ammo[gun]+=n;res[gun]-=n}
  const act=canAct(),drone=me.drone===1,f=(keys.KeyW?1:0)-(keys.KeyS?1:0),s=(keys.KeyD?1:0)-(keys.KeyA?1:0),ca=Math.cos(me.a),sa=Math.sin(me.a);
  moving=(act||drone)&&(f||s)?1:0;
  if(moving){
    const v=drone?3.6:ads?1.6:keys.KeyC?1.4:keys.ShiftLeft?4.2:2.8,sp=v*dt/Math.hypot(f,s);
    const nx=me.x+(ca*f-sa*s)*sp,ny=me.y+(sa*f+ca*s)*sp;
    if(free(nx,me.y,drone))me.x=nx;if(free(me.x,ny,drone))me.y=ny;
    bob+=dt*v*2.4;
    if(!drone&&v>2&&(stepT-=dt*v)<0){stepT=1.8;noise(.06,.12,220)}        // my own footsteps, quiet
  }
  if(!me.dead&&!me.drone&&!free(me.x,me.y))                               // a barricade went up on top of me: step out of it
    for(const [i,j] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=(me.x|0)+.5+i,y=(me.y|0)+.5+j;if(free(x,y)){me.x=x;me.y=y;break}}
  me.z+=((me.drone?.1:keys.KeyC?.3:.5)-me.z)*Math.min(1,dt*12);
  me.lean+=((act?(keys.KeyE?1:0)-(keys.KeyQ?1:0):0)-me.lean)*Math.min(1,dt*10);
  fov+=((ads&&act?curGun().zoom||.55:cfg.fov)-fov)*Math.min(1,dt*14);
  sensing=act&&op().sensor&&keys.KeyG?1:0;
  // objective: hold F to plant (attackers, inside the site) or disable (defenders, next to the defuser)
  const hold=act&&phase==='act'&&keys.KeyF&&!moving&&(isAtk()?!defuser&&inSite(me.x,me.y):defuser&&Math.hypot(me.x-defuser.x,me.y-defuser.y)<1.3);
  if(!hold)holdT=0;
  else if((holdT+=dt)>=5){holdT=0;request(isAtk()?{t:'pl',x:me.x,y:me.y}:{t:'df'})}
  if(trig&&act&&!holdT&&!sensing&&(curGun().auto||fresh))tryFire();
  fresh=0;
  if(act&&phase==='act'&&!me.drone){                                      // door traps go off under an enemy's feet
    const c=(me.y|0)*MW+(me.x|0);
    if(traps[c]!==undefined&&traps[c]!==me.team){send({t:'tr',c});trapBoom(c)}
  }
  if(defuser&&phase==='act'){
    defuser.flash=Date.now()&256?1:0;
    if((beepT-=dt)<0){const left=(phaseEnd-Date.now())/1000;beepT=left<10?.25:1;sfx.beep(defuser.x,defuser.y,left<10)}
  }
  if(mode==='solo'&&phase==='act'){
    if((bfsT-=dt)<0){bfsT=.4;defuser?bfs(defuser.x,defuser.y):bfs(me.x,me.y)}
    for(const b of bots)updBot(b,dt);
    if(phase==='act'&&Date.now()>phaseEnd)defuser?endSolo(1,'디퓨저 작동 완료'):endSolo(0,'시간 초과');
  }
  for(const id in others){
    const o=others[id],k=Math.min(1,dt*14),mx=(o.tx-o.x)*k,my=(o.ty-o.y)*k,l=Math.hypot(mx,my);
    o.x+=mx;o.y+=my;o.walk+=l;o.mv=l/dt;o.av+=Math.atan2(Math.sin(o.a-o.av),Math.cos(o.a-o.av))*k;o.flash-=dt;
  }
  for(let i=pings.length;i--;)if((pings[i].t-=dt)<=0)pings.splice(i,1);
  updParts(dt);updNades(dt);
  const sp=viewTarget();
  if(sp){cam.x=sp.x;cam.y=sp.y;cam.a=sp.av;cam.z=sp.z;cam.pitch=0}
  else{
    cam.a=me.a;cam.z=me.z;cam.pitch=me.pitch;cam.x=me.x-sa*me.lean*.35;cam.y=me.y+ca*me.lean*.35;
    if(grid[(cam.y|0)*MW+(cam.x|0)]&&!me.drone){cam.x=me.x;cam.y=me.y}
  }
  if(boomT>0){cam.a+=rnd(boomT*.07);cam.pitch+=rnd(boomT*.09)}                 // blast shake
}

function selfTest(){
  const ok=(c,m)=>console.assert(c,m);
  loadMap();site=0;
  ok(MAP.every(r=>r.length===MW)&&spawns.every(g=>g.length===5)&&sites.length===2&&sites.every(s=>s.cells.length>=17),'map shape');
  ok(zone[MW+1]===0&&zone[9*MW+10]===1&&inSite(29.5,8.5)&&!inSite(11.5,17.5),'zones');
  for(let c=0;c<NC;c++)if(orig[c]>=SOFT){                      // thin walls must not meet a perpendicular thin wall (it would leave a gap)
    const [a,b]=orient[c]?[c-1,c+1]:[c-MW,c+MW];
    ok([a,b].every(n=>orig[n]<SOFT||orient[n]===orient[c]),'thin wall junction at '+c);
  }
  const c=11*MW+10,sight=()=>trace(10.3,9.5,.5,0,1,0,5,-1);    // soft wall south of the NW room, seen from inside
  ok(grid[c]===SOFT&&orient[c]===1,'soft wall where expected');
  ok(Math.abs(sight()-2)<1e-6&&hitC===c,'intact wall blocks sight');
  trace(10.3,9.5,.5,0,1,0,5,0);
  ok(holeN[c]===1&&sight()===5,'bullet hole opens a sight line');
  trace(10.5,9.5,.5,0,1,0,5,0);ok(holes[c*TEX+16]===0,'studs stop bullets');
  for(let i=0;i<9;i++)punch(c,5+i%3*11,5+(i/3|0)*11,5);
  ok(grid[c]===0,'heavily holed wall collapses');
  reinforce(c+2);trace(12.3,9.5,.5,0,1,0,5,0);
  ok(grid[c+2]===RTHIN&&holeN[c+2]===0,'reinforced wall stops bullets');
  destroy(c+2);ok(grid[c+2]===RTHIN,'normal breach leaves reinforced wall');
  destroy(c+2,1);ok(grid[c+2]===0,'thermal breach opens reinforced wall');
  const d=11*MW+11;destroy(d);ok(grid[d]===0,'door breaks');barricade(d);ok(grid[d]===DOOR&&holeN[d]===0,'door can be boarded up again');
  const w=6*MW+11;punch(w,10,2,3);punch(w,10,28,3);ok(holeN[w]===0,'window frame is solid');
  destroy(w);ok(grid[w]===WIN&&holes[w*TEX+5]===WMID&&!free(11.5,6.5),'window opens but stays a wall');
  ok(los(11.5,5,.5,11.5,8,.5)&&!los(11.5,5,.1,11.5,8,.1),'open window: see through the middle, not the sill');
  const n={k:'frag',x:9.5,y:9.5,z:.5,vx:0,vy:6,vz:0,fuse:9};nades.length=0;nades.push(n);
  for(let i=0;i<60;i++)updNades(.016);
  ok(n.y<11.5&&n.y>8.5&&n.z<.1,'grenade bounces off a wall and lands');nades.length=0;
  loadMap();console.log('selfTest done');
}

loadMap();newRound(0,0);
$('ver').textContent='v'+V;
if(location.hash==='#test')selfTest();
let last=performance.now();
requestAnimationFrame(function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  update(dt);render();hud();
  requestAnimationFrame(frame);
});
