'use strict';
// Frame loop: simulate, render, HUD. Plus the self-check (open index.html#test and read the console).
const solid=(x,y,dr)=>{const g=grid[(y|0)*MW+(x|0)];return g&&!(dr&&g===DOOR)};     // drones slip under door barricades
const free=(x,y,dr)=>!(solid(x-.2,y-.2,dr)||solid(x+.2,y-.2,dr)||solid(x-.2,y+.2,dr)||solid(x+.2,y+.2,dr));
function viewTarget(){                           // dead in a match: watch a living teammate
  if(!me.dead||mode!=='mp'||phase==='lobby')return null;
  const m=Object.values(others).filter(o=>o.team===me.team&&!o.dead&&o.z>.05);
  return m.length?m[specI%m.length]:null;
}
// Try to stand at (x,y). Walls stop you, and so does anything more than knee-high above your feet (the flank of a
// staircase). From the top step, the cell ahead is the landing one storey up.
function tryMove(x,y,dr){
  const c=(me.y|0)*MW+(me.x|0);
  if(rampB[c]&&me.h>.75&&((y+FH)|0)*MW+(x|0)===link[c]){if(free(x,y+FH,dr)){me.x=x;me.y=y+FH;me.h=0}return}
  if(free(x,y,dr)&&ground(x,y)<=me.h+.35){me.x=x;me.y=y}
}
// Feet: with no floor underneath you belong to the storey below; then stand on the ground there, or fall to it.
function settle(dt){
  if(me.y>=FH&&gap((me.y|0)*MW+(me.x|0))&&!me.vz){me.y-=FH;me.h+=1;me.vz=-.01}
  const g=ground(me.x,me.y);
  if(me.vz||me.h>g+.35){
    me.vz=(me.vz||0)-9*dt;me.h+=me.vz*dt;
    if(me.h<=g){if(me.y>=FH&&gap((me.y|0)*MW+(me.x|0))){me.y-=FH;me.h+=1}else{if(me.vz<-2.5)sfx.thud();me.h=g;me.vz=0}}   // keep falling through the next opening, or land
  }else me.h=g;
}
let stepT=0;
function update(dt){
  fireT-=dt;meleeT-=dt;nadeT-=dt;muzzle-=dt;hitT-=dt;hurtT-=dt;boomT-=dt;killT-=dt;flashT-=dt;fade-=dt;
  me.pitch=Math.tan(me.pa);
  if(mode==='menu'){me.a+=dt*.12;Object.assign(cam,{x:me.x,y:me.y,z:.5,a:me.a,pa:0,pitch:0});return}   // title screen: slow pan over the yard
  if(reloadT>0&&(reloadT-=dt)<=0){const n=Math.min(curGun().mag-ammo[gun],res[gun]);ammo[gun]+=n;res[gun]-=n}
  const act=canAct(),drone=me.drone===1,f=(keys.KeyW?1:0)-(keys.KeyS?1:0),s=(keys.KeyD?1:0)-(keys.KeyA?1:0),ca=Math.cos(me.a),sa=Math.sin(me.a);
  moving=(act||drone)&&(f||s)?1:0;
  if(me.rap&&!act)me.rap=0;
  if(me.rap)rappel(f,s,dt);
  else if(moving){
    const wc=wires[(me.y|0)*MW+(me.x|0)],drag=wc!==undefined&&wc!==me.team?.45:1;        // the other side's barbed wire
    const v=drone?3.6:(ads?1.6:keys.KeyC?1.4:keys.ShiftLeft?4.2:2.8)*SPD[op().cls]*drag,sp=v*dt/Math.hypot(f,s);
    tryMove(me.x+(ca*f-sa*s)*sp,me.y,drone);tryMove(me.x,me.y+(sa*f+ca*s)*sp,drone);
    bob+=dt*v*2.4;
    if(!drone&&v>2&&(stepT-=dt*v)<0){stepT=1.8;noise(.06,.12,220)}        // my own footsteps, quiet
  }
  if(!me.dead&&!me.drone&&!free(me.x,me.y))                               // a barricade went up on top of me: step out of it
    for(const [i,j] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=(me.x|0)+.5+i,y=(me.y|0)+.5+j;if(free(x,y)){me.x=x;me.y=y;break}}
  if(!me.dead&&!me.rap)settle(dt);
  me.z+=((me.drone?.1:keys.KeyC&&!me.rap?.3:.5)-me.z)*Math.min(1,dt*12);
  me.lean+=((act&&!me.rap?(keys.KeyE?1:0)-(keys.KeyQ?1:0):0)-me.lean)*Math.min(1,dt*10);
  fov+=((ads&&act?curGun().zoom||.55:cfg.fov)-fov)*Math.min(1,dt*14);
  sensing=act&&op().sensor&&keys.KeyG?1:0;
  // objective: hold F to plant (attackers, inside the site) or disable (defenders, next to the defuser)
  const hold=act&&phase==='act'&&keys.KeyF&&!moving&&(isAtk()?!defuser&&inSite(me.x,me.y):defuser&&near3(me,defuser.x,defuser.y,.2)<1.3);
  if(!hold)holdT=0;
  else if((holdT+=dt)>=5){holdT=0;request(isAtk()?{t:'pl',x:me.x,y:me.y}:{t:'df'})}
  if(trig&&act&&!holdT&&!sensing&&(curGun().auto||fresh))tryFire();
  if(!trig&&fireT<-.12)shots=0;                                           // the recoil pattern starts over after a pause
  fresh=0;
  if(act&&phase==='act'&&!me.drone){                                      // door traps go off under an enemy's feet
    const c=(me.y|0)*MW+(me.x|0);
    if(traps[c]!==undefined&&traps[c]!==me.team){send({t:'tr',c});trapBoom(c)}
  }
  if(defuser&&phase==='act'){
    defuser.flash=Date.now()&256?1:0;
    if((beepT-=dt)<0){const left=(phaseEnd-Date.now())/1000;beepT=left<10?.25:1;sfx.beep(defuser.x,defuser.y,left<10)}
  }
  for(const id in others){
    const o=others[id];
    if(o.bot&&isHost){if(phase==='act')updBot(o,dt);continue}             // the host plays the bots; everyone else interpolates them
    if(Math.hypot(o.tx-o.x,o.ty-o.y)>3){o.x=o.tx;o.y=o.ty}                // another storey or a respawn: don't glide across the map
    const k=Math.min(1,dt*14),mx=(o.tx-o.x)*k,my=(o.ty-o.y)*k,l=Math.hypot(mx,my);
    o.x+=mx;o.y+=my;o.walk+=l;o.mv=l/dt;o.av+=Math.atan2(Math.sin(o.a-o.av),Math.cos(o.a-o.av))*k;o.flash-=dt;
  }
  for(let i=pings.length;i--;)if((pings[i].t-=dt)<=0)pings.splice(i,1);
  updParts(dt);updNades(dt);
  const sp=viewTarget();
  if(sp){const [ey,ez]=eyeOf(sp);Object.assign(cam,{x:sp.x,y:ey,z:ez,a:sp.av,pa:0,pitch:0})}
  else{
    const [ey,ez]=eyeOf(me);let lx=me.x-sa*me.lean*.35,ly=ca*me.lean*.35;
    if(grid[((ey+ly)|0)*MW+(lx|0)]&&!me.drone){lx=me.x;ly=0}              // don't lean the eye into a wall
    Object.assign(cam,{x:lx,y:ey+ly,z:ez,a:me.a,pa:me.pa,pitch:me.pitch});me.lx=lx;me.ly=me.y+ly;
  }
  if(boomT>0){cam.a+=rnd(boomT*.07);cam.pa+=rnd(boomT*.09)}                    // blast shake
}

function selfTest(){
  const ok=(c,m)=>console.assert(c,m),G=FH,U=2*FH;               // G, U: row offsets of the ground and upper floors
  loadMap();site=1;
  ok(MAP.every(r=>r.length===MW)&&MH===NL*FH&&spawns.every(g=>g.length===5)&&sites.length===4&&sites.every(s=>s.cells.length>=15),'map shape');
  ok(zone[(G+1)*MW+1]===0&&sites.every((s,k)=>zone[(s.y|0)*MW+(s.x|0)]===2+k&&roomAt(s.x,s.y).length>4),'zones and site callouts');
  for(const g of spawns)for(const s of sites)ok(flowTo(s.x,s.y)[(g[0][1]|0)*MW+(g[0][0]|0)]>0,'every objective can be walked to from every spawn');
  for(let c=0;c<NC;c++){
    if(orig[c]>=SOFT){                           // thin walls must not meet a perpendicular thin wall (it would leave a gap)
      const [a,b]=orient[c]?[c-1,c+1]:[c-MW,c+MW];
      ok([a,b].every(n=>orig[n]<SOFT||orient[n]===orient[c]),'thin wall junction at '+c);
    }
    if(rampB[c])ok(link[c]>=0&&!orig[link[c]]&&!nofloor[link[c]]&&nofloor[c+OFFC]&&ramp[c-ramp[c]]===ramp[c],'stairs lead to a landing at '+c);
    if(hatch0[c])ok(c>=OFFC&&!orig[c]&&!orig[c-OFFC]&&!nofloor[c],'hatch has free floor above and below at '+c);
  }
  if(MAPID!=='house'){for(const k in flows)delete flows[k];return console.log('selfTest done (map rules only: '+MAPID+')')}   // the rest walks through House
  ok(zone[PIT]===0&&zone[(G+8)*MW+10]===1&&inSite(17.5,G+23.5)&&!inSite(17.5,U+23.5),'zones');
  ok(roomAt(17.5,G+23.5)==='1층 TV방'&&roomAt(20.5,10.5)==='지하 차고'&&roomAt(2,G+2)==='1층 마당','callouts');
  // walls
  const c=(G+20)*MW+15,sight=()=>trace(15.3,G+18.5,.5,0,1,0,4.5,-1);    // soft wall between the lobby and the TV room
  ok(grid[c]===SOFT&&orient[c]===1,'soft wall where expected');
  ok(Math.abs(sight()-2)<1e-6&&hitC===c,'intact wall blocks sight');
  trace(15.3,G+18.5,.5,0,1,0,4.5,0);
  ok(holeN[c]===1&&sight()===4.5,'bullet hole opens a sight line');
  trace(15.5,G+18.5,.5,0,1,0,4.5,0);ok(holes[c*TEX+16]===0,'studs stop bullets');
  for(let i=0;i<9;i++)punch(c,5+i%3*11,5+(i/3|0)*11,5);
  ok(grid[c]===0,'heavily holed wall collapses');
  reinforce(c+1);trace(16.3,G+18.5,.5,0,1,0,4.5,0);
  ok(grid[c+1]===RTHIN&&holeN[c+1]===0,'reinforced wall stops bullets');
  destroy(c+1);ok(grid[c+1]===RTHIN,'normal breach leaves reinforced wall');
  destroy(c+1,1);ok(grid[c+1]===0,'thermal breach opens reinforced wall');
  const hw=c+3;trace(18.3,G+18.5,.5,0,1,0,4.5,0);destroy(hw,1);
  ok(grid[hw]===HWALL&&holeN[hw]===0&&trace(18.3,G+18.5,.5,0,1,0,4.5,-1)===2,'solid interior wall: no holes, no breach');
  const d=(G+20)*MW+23;destroy(d);ok(orig[d]===DOOR&&grid[d]===0,'door breaks');barricade(d);ok(grid[d]===DOOR&&holeN[d]===0,'door can be boarded up again');
  const w=(G+9)*MW+17;punch(w,10,2,3);punch(w,10,28,3);ok(orig[w]===WIN&&holeN[w]===0,'window frame is solid');
  destroy(w);ok(grid[w]===WIN&&holes[w*TEX+5]===WMID&&!free(17.5,G+9.5),'window opens but stays a wall');
  ok(los(17.5,G+8.2,.5,17.5,G+11,.5)&&!los(17.5,G+8.2,.1,17.5,G+11,.1),'open window: see through the middle, not the sill');
  const n={k:'frag',x:13.5,y:G+18.5,z:.5,vx:0,vy:6,vz:0,fuse:9};nades.length=0;nades.push(n);
  for(let i=0;i<60;i++)updNades(.016);
  ok(n.y<G+20.5&&n.y>G+15.5&&n.z<.1,'grenade bounces off a wall and lands');nades.length=0;
  // storeys
  ok(ground(17.5,G+10.5)===.25&&ground(18.5,G+10.5)===.75&&ground(15.5,14.5)===.25,'stair heights');
  ok(flowTo(19.5,U+10.5)[(G+10)*MW+16]===3,'path up the stairs');
  for(const g of spawns)for(const s of sites)ok(flowTo(s.x,s.y)[(g[0][1]|0)*MW+(g[0][0]|0)]>0,'every objective can be walked to from every spawn');
  Object.assign(me,{x:16.5,y:G+10.5,h:0,vz:0,dead:0,drone:0});
  for(let i=0;i<40;i++){tryMove(me.x+.07,me.y);settle(.02)}
  ok(me.y>U&&me.h===0&&me.x>19,'walking up the stairs arrives on the upper floor');
  for(let i=0;i<12;i++){tryMove(me.x-.07,me.y);settle(.02)}
  ok(me.y<U&&me.h>.4&&me.h<1,'walking back off the landing puts you on the stairs');
  Object.assign(me,{x:19.5,y:G+10.5,h:0,vz:0});tryMove(18.9,G+10.5);ok(me.x===19.5,'the flank of the stairs is a wall from below');
  const fl=(U+17)*MW+23,down=()=>los(23.3,U+17.5,.5,23.3,G+17.5,.5);    // master bedroom floorboards over the living room
  ok(softF[fl]&&!down(),'floor blocks sight');
  trace(23.3,U+17.5,.5,1e-9,0,-20,2,0);
  ok(fholes[fl*TEX+9]&&down(),'a shot through the floor opens a sight line');
  ok(!softF[(G+21)*MW+17]&&softF[(G+7)*MW+10],'solid floor in the TV room, timber in the dining room');
  const hc=(U+16)*MW+25,below=(G+16)*MW+25;                             // hatch from the master bedroom into the living room
  ok(hatch[hc]===1&&flowTo(25.5,G+16.5)[hc]>5,'shut hatch: the way down is the stairs');
  hitHatch(hc);hitHatch(hc);ok(hatch[hc]===1,'two melee hits leave a hatch shut');hitHatch(hc);ok(hatch[hc]===3,'third hit opens it');
  for(const k in flows)delete flows[k];
  ok(flowTo(25.5,G+16.5)[hc]===1&&flowTo(25.5,U+16.5)[below]>5,'open hatch: one step down, still the long way up');
  Object.assign(me,{x:24.5,y:U+16.5,h:0,vz:0});for(let i=0;i<40;i++){tryMove(me.x+.05,me.y);settle(.02)}
  ok(me.y<U&&me.y>G&&me.h===0,'walking onto an open hatch drops you a storey');
  loadMap();hatch[hc]=2;blastHatches(25.5,G+16.5,1.3);ok(hatch[hc]===2,'reinforced hatch survives a blast from below');
  hatch[hc]=1;blastHatches(25.5,G+16.5,1.3);ok(hatch[hc]===3,'plain hatch is blown open from below');
  for(const k in flows)delete flows[k];
  // rope: up the south wall, then in through the pink room's window once its boards are gone
  loadMap();phase='act';atkTeam=me.team;
  Object.assign(me,{x:11.5,y:G+28.5,h:0,vz:0,a:-Math.PI/2,rap:0,dead:0,drone:0});vault();
  ok(me.rap===1&&Math.abs(me.y-G-28.22)<1e-6,'attackers clip onto a rope at an outside wall');
  for(let i=0;i<60;i++)rappel(1,0,.02);
  ok(me.y>U&&Math.abs(me.h-.45)<1e-6,'the rope carries you up to the next storey and stops under the eaves');
  const rw=(U+27)*MW+11;vault();ok(me.rap===1&&me.y>U+28,'a boarded window keeps you on the rope');
  destroy(rw);vault();ok(!me.rap&&(me.y|0)===U+26&&me.h===0,'through the opened window into the room');
  Object.assign(me,{x:11.5,y:G+26.5,a:Math.PI/2,h:0});vault();ok((me.y|0)===G+26,'no rope indoors, and a brick wall is not a window');
  const sc=(G+18)*MW+15;placeShield(sc,1);
  ok(grid[sc]===SHIELD&&Math.abs(trace(15.5,G+17.2,.3,0,1,0,6,0)-1.3)<1e-6&&trace(15.5,G+17.2,.8,0,1,0,6,-1)>1.4,'deployable shield: stops low shots, open above');
  Object.assign(me,{x:15.5,y:G+17.5,a:Math.PI/2,h:0});vault();ok((me.y|0)===G+19,'Space climbs over a shield');
  destroy(sc);ok(!grid[sc]&&!holes[sc*TEX+3],'and a blast clears it away');
  const cn={k:'c4',x:13.5,y:G+17.5,z:.5,vx:0,vy:3,vz:0,fuse:NADE.c4.fuse};nades.length=0;nades.push(cn);
  for(let i=0;i<120;i++)updNades(.016);
  ok(cn.stuck&&nades.length===1&&cn.y<G+20.5,'C4 stays where it lands and waits');nades.length=0;
  me.guns=['shield','pistol'];gun=0;me.hp=me.maxHp=100;Object.assign(me,{x:15.5,y:G+17.5,a:0,dead:0,rap:0});
  hurt(40,'t',{x:18.5,y:G+17.5},0,1);const front=me.hp;hurt(40,'t',{x:12.5,y:G+17.5},0,1);
  ok(front===100&&me.hp===60,'ballistic shield stops rounds from the front only');me.guns=['ar','pistol'];
  phase='lobby';
  const sides=()=>(fillBots(),[0,1].map(t=>roster.filter(p=>p.team===t).length).join());
  roster=[{id:0,team:0}];fillTo=6;ok(sides()==='1,5','1 v 5: bots only on the side with no humans');
  fillTo=5;ok(sides()==='5,5','bots fill both sides');fillTo=0;roster=[];
  Object.assign(me,{x:16.5,y:G+2.5,h:0,vz:0});
  loadMap();console.log('selfTest done');
}

loadMap();newRound(0,0);
$('ver').textContent='v'+V;
if(location.hash==='#test')selfTest();
let last=performance.now(),frameDt=.016;
requestAnimationFrame(function frame(now){
  const dt=frameDt=Math.min(.05,(now-last)/1000);last=now;
  update(dt);render();hud();
  requestAnimationFrame(frame);
});
