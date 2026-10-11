'use strict';
// World simulation that every client runs the same way: wall destruction, hatches, ray tests, bullets, grenades, traps.
// Particles are cosmetic only.
const pcol=(r,g,b)=>0xff000000|rgb(r,g,b);
const PLASTER=pcol(205,190,160),WOOD=pcol(150,105,58),METAL=pcol(110,116,128),SPARK=pcol(255,220,110),BLOOD=pcol(170,20,20),SOOT=pcol(24,24,26);

// ---------- particles ----------
const parts=[];
function spawnP(x,y,z,n,col,spd,life,grav,size){
  for(let i=0;i<n;i++){
    if(parts.length>500)parts.shift();
    parts.push({x,y,z,vx:rnd(spd),vy:rnd(spd),vz:rnd(spd)+spd*.2,life:life*(.6+Math.random()*.6),col,grav,size:size||1});
  }
}
function updParts(dt){
  for(let i=parts.length;i--;){
    const p=parts[i];
    if((p.life-=dt)<=0){parts.splice(i,1);continue}
    if(!p.grav)continue;                         // decals just sit there
    p.vz-=3*p.grav*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
    if(p.z<.01){p.z=.01;p.vz*=-.3;p.vx*=.5;p.vy*=.5}
  }
}

// ---------- destruction ----------
// World position of a wall texel (for debris).
function wallPoint(c,ui,vi){
  const cx=c%MW,cy=c/MW|0,u=(ui+.5)/TEX;
  return orient[c]?[cx+u,cy+.5,1-(vi+.5)/TEX]:[cx+.5,cy+u,1-(vi+.5)/TEX];
}
function punch(c,ui,vi,r,net){
  const g=grid[c];
  if(g!==SOFT&&g!==DOOR&&g!==WIN)return;
  let add=0;
  for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){
    const u=ui+a,v=vi+b;
    if(a*a+b*b>r*r+r||u<0||u>=TEX||v<0||v>=TEX)continue;
    if(g===SOFT&&u%16===0||g===WIN&&(v<6||v>19))continue;      // studs and the window frame survive
    const i=c*TEX+u,bit=1<<v;
    if(!(holes[i]&bit)){holes[i]|=bit;add++}
  }
  holeN[c]+=r>4&&g!==SOFT?Math.max(add,90):add;   // melee always counts on boards: 3 hits break a door, 2 a window
  if(add){const p=wallPoint(c,ui,vi);spawnP(p[0],p[1],p[2],Math.min(10,2+add>>2),g===SOFT?PLASTER:WOOD,1.6,.7,1)}
  if(net)send({t:'h',c,u:ui,v:vi,r});
  if(holeN[c]>(g===SOFT?400:g===DOOR?260:170))destroy(c);       // too many holes -> the panel falls (peers derive the same)
}
function destroy(c,hard){                        // hard: also takes out a reinforced panel (thermal charge)
  const g=grid[c];
  if(g===WIN){                                   // a window loses its boards but keeps frame and sill
    if(holeN[c]>9000)return;
    for(let u=0;u<TEX;u++)holes[c*TEX+u]|=WMID;
    holeN[c]=9999;
  }else if(g===SOFT||g===DOOR||hard&&g===RTHIN)grid[c]=0;
  else return;
  if(charge===c)charge=-1;
  const x=c%MW+.5,y=(c/MW|0)+.5;
  spawnP(x,y,.5,26,g===SOFT?PLASTER:g===RTHIN?METAL:WOOD,3,1.1,1,2);sfx.crash(x,y);
}
function reinforce(c,net){
  if(grid[c]!==SOFT)return;
  grid[c]=RTHIN;holes.fill(0,c*TEX,c*TEX+TEX);holeN[c]=0;if(charge===c)charge=-1;
  sfx.steel(c%MW+.5,(c/MW|0)+.5);if(net)send({t:'rf',c});
}
function barricade(c,net){                       // board up an open doorway again
  if(orig[c]!==DOOR||grid[c])return;
  grid[c]=DOOR;holes.fill(0,c*TEX,c*TEX+TEX);holeN[c]=0;
  sfx.thud(c%MW+.5,(c/MW|0)+.5);if(net)send({t:'bd',c});
}
function explode(c,net,th){                      // breach charge on wall cell c
  if(net)send({t:'b',c,th:th?1:0});
  destroy(c,th);
  const x=c%MW+.5,y=(c/MW|0)+.5;
  sfx.boom(x,y,1);spawnP(x,y,.5,30,SOOT,4,.9,1,2);spawnP(x,y,.5,12,SPARK,5,.35,1);
  if(Math.hypot(cam.x-x,cam.y-y)<9)boomT=.5;
  if(Math.hypot(me.x-x,me.y-y)<1.8)hurt(60,'폭발',{x,y});
  for(const b of hostBots())if(Math.hypot(b.x-x,b.y-y)<1.8)botHurt(b,60,{name:'폭발'});
  blastHatches(x,y,1.3);
}

// ---------- floor hatches (cells on the upper floor; an open one drops you to the floor below) ----------
function openHatch(c,net){
  if(hatch[c]!==1&&hatch[c]!==2)return;
  hatch[c]=3;
  const x=c%MW+.5,y=(c/MW|0)+.5;
  spawnP(x,y,.05,16,WOOD,2.5,.9,1,2);spawnP(x,y-FH,.95,20,WOOD,2,1.2,1,2);sfx.crash(x,y);
  if(net)send({t:'hx',c});
}
function hitHatch(c,net){                        // melee: the third hit breaks a plain hatch (holeN is free to count on floor cells)
  if(hatch[c]!==1)return;
  spawnP(c%MW+.5,(c/MW|0)+.5,.05,6,WOOD,1.6,.6,1);
  if(net)send({t:'hm',c});
  if(++holeN[c]>=3)openHatch(c);
}
function blastHatches(x,y,r){                    // a blast opens plain hatches on its own floor and the one right overhead
  const cx=x|0,cy=y|0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const q=(cy+j)*MW+cx+i;
    if(Math.hypot(cx+i+.5-x,cy+j+.5-y)<r)for(const c of [q,q+OFFC])if(c<NC&&hatch[c]===1)openHatch(c);
  }
}

// ---------- rays ----------
// Ray through the map in 2.5D (z = height 0..1, slope = dz per unit distance). Returns distance travelled.
// hole>=0: bullet, punches soft walls and keeps going (max 3). hole=-1: sight check, stops at the first solid texel.
// hole=-2: reach check for hands (melee, gadgets), stops at any thin wall even where it is already holed.
let hitC=-1,hitU=0,hitV=0;const pens=[];
function trace(ox,oy,oz,dx,dy,slope,maxD,hole){
  dx=dx||1e-9;dy=dy||1e-9;hitC=-1;pens.length=0;
  if(slope)maxD=Math.min(maxD,slope<0?-oz/slope:(1-oz)/slope);        // floor / ceiling
  let mx=ox|0,my=oy|0,t=0;
  const ddx=Math.abs(1/dx),ddy=Math.abs(1/dy),sx=dx<0?-1:1,sy=dy<0?-1:1;
  let sdx=(dx<0?ox-mx:mx+1-ox)*ddx,sdy=(dy<0?oy-my:my+1-oy)*ddy;
  for(let i=0;i<120;i++){
    const c=my*MW+mx,g=grid[c];
    if(g>=SOFT){                                 // thin wall: where does the ray cross the cell's mid-line?
      let tt,u;
      if(orient[c]){tt=(my+.5-oy)/dy;u=ox+dx*tt-mx}else{tt=(mx+.5-ox)/dx;u=oy+dy*tt-my}
      if(tt>0&&u>=0&&u<1){
        if(tt>maxD)return maxD;
        const ui=u*TEX|0,vi=Math.min(TEX-1,(1-oz-slope*tt)*TEX|0),open=holes[c*TEX+ui]>>>vi&1;
        if(hole===-2||!open){
          hitC=c;hitU=ui;hitV=vi;
          if(hole<0||g===RTHIN)return tt;
          punch(c,ui,vi,hole,1);
          if(grid[c]&&!(holes[c*TEX+ui]>>>vi&1))return tt;     // stud, sill or lintel: the bullet stops
          pens.push(tt);
          if(pens.length>2)return tt;
        }
      }
    }else if(g&&i)return t;
    if(sdx<sdy){t=sdx;sdx+=ddx;mx+=sx}else{t=sdy;sdy+=ddy;my+=sy}
    if(t>maxD)return maxD;
  }
  return maxD;
}
function los(x0,y0,z0,x1,y1,z1){
  const dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy);
  return d<.05||trace(x0,y0,z0,dx/d,dy/d,(z1-z0)/d,d,-1)>=d-.02;
}
// One bullet from `by` (me, or a bot the host is driving). Only the shooter's machine runs this.
function bullet(ox,oy,oz,a,slope,dmg,hole,by,hsDmg){
  const dx=Math.cos(a),dy=Math.sin(a),stop=trace(ox,oy,oz,dx,dy,slope,40,hole);
  let best,bd=stop,bz;
  for(const t of enemiesOf(by.team)){
    if(t.dead||t.z<.05)continue;
    const rx=(t===me?cam.x:t.x)-ox,ry=(t===me?cam.y:t.y)-oy,al=rx*dx+ry*dy;
    if(al<=0||al>=bd||Math.abs(rx*dy-ry*dx)>.22)continue;
    const z=oz+slope*al;if(z<0||z>t.z+.12)continue;
    best=t;bd=al;bz=z;
  }
  if(!best){
    if(stop<40){                                 // sparks and a scorch mark where it stopped
      const x=ox+dx*(stop-.04),y=oy+dy*(stop-.04),z=clamp(oz+slope*stop,.02,.98);
      spawnP(x,y,z,3,SPARK,2,.2,1);spawnP(x,y,z,1,SOOT,0,25,0);
    }
    return;
  }
  let k=1;for(const q of pens)if(q<bd)k*=.7;     // each wall penetrated costs damage
  spawnP(ox+dx*bd,oy+dy*bd,bz,5,BLOOD,1.5,.5,1);
  if(by!==me)return hitBy(by,best,dmg*k);
  const hs=bz>best.z-.08;
  hitFoe(best,(hs?hsDmg:dmg)*k,hs);
}

// ---------- grenades ----------
// The thrower's simulation decides where and when it goes off ('ge' event); everyone else flies a look-alike.
const NADE={frag:{fuse:2.4,n:'수류탄'},flash:{fuse:1.6,n:'섬광탄'},smoke:{fuse:1.4,n:'연막탄'},impact:{fuse:9,n:'충격 수류탄',hit:1}};
const nades=[],smokes=[];
function nadeSolid(x,y,z){                       // blocking cell at this point, or -1
  const cx=x|0,cy=y|0,c=cy*MW+cx,g=grid[c];
  if(!g)return -1;
  if(g<SOFT)return c;
  const o=orient[c];
  if(Math.abs(o?y-cy-.5:x-cx-.5)>.1)return -1;
  return holes[c*TEX+((o?x-cx:y-cy)*TEX|0)]>>>Math.min(TEX-1,(1-z)*TEX|0)&1?-1:c;
}
function updNades(dt){
  for(let i=nades.length;i--;){
    const n=nades[i];let hit=-1;
    for(let k=Math.ceil(dt/.01),h=dt/k;k--;){
      n.vz-=3.2*h;
      let c=nadeSolid(n.x+n.vx*h,n.y,n.z);if(c>=0){n.vx*=-.4;hit=c}else n.x+=n.vx*h;
      c=nadeSolid(n.x,n.y+n.vy*h,n.z);if(c>=0){n.vy*=-.4;hit=c}else n.y+=n.vy*h;
      n.z+=n.vz*h;
      if(n.z<.04){
        if(n.y>=FH&&hatch[(n.y|0)*MW+(n.x|0)]===3){n.y-=FH;n.z=.94;continue}     // rolled into an open hatch: falls to the floor below
        if(n.vz<-.4||NADE[n.k].hit)hit=-2;                                       // -2: bounced on the floor
        n.z=.04;n.vz*=-.4;n.vx*=.7;n.vy*=.7;
      }
      if(n.z>.96){n.z=.96;n.vz*=-.4}
    }
    n.fuse-=dt;
    if(hit!==-1&&!n.hush){sfx.clink(n.x,n.y);n.hush=.15}
    n.hush=Math.max(0,(n.hush||0)-dt);
    if(n.mine&&(n.fuse<=0||NADE[n.k].hit&&hit!==-1)){
      nades.splice(i,1);
      send({t:'ge',k:n.k,x:n.x,y:n.y,z:n.z,c:hit>=0?hit:-1});
      nadeBoom(n.k,n.x,n.y,n.z,hit>=0?hit:-1,me);
    }else if(!n.mine&&n.fuse<-3)nades.splice(i,1);              // the owner never reported the blast: drop the ghost
  }
  for(let i=smokes.length;i--;)if((smokes[i].t-=dt)<=0)smokes.splice(i,1);
}
function nadeBoom(k,x,y,z,c,own){
  const d=Math.hypot(me.x-x,me.y-y),mine=own===me,foe=own.team!==me.team,bz=clamp(z,.1,.9);
  if(k==='smoke'){
    smokes.push({x,y,t:14,p:Array.from({length:6},()=>[rnd(1.7),rnd(1.7),.2+Math.random()*.5])});
    return sfx.hiss(x,y);
  }
  if(k==='flash'){
    sfx.boom(x,y,0);spawnP(x,y,z,10,SPARK,3,.3,0);
    if(!me.dead&&d<14&&los(x,y,bz,cam.x,cam.y,me.z)){          // looking at it hurts much more than looking away
      const f=(1+Math.cos(Math.atan2(y-cam.y,x-cam.x)-cam.a))/2;
      flashT=Math.max(flashT,(1-d/14)*(.6+3.4*f*f));sfx.ring();
    }
    for(const b of hostBots())if(Math.hypot(b.x-x,b.y-y)<7&&los(x,y,bz,b.x,b.y,.5))b.blind=2.5;
    return;
  }
  const big=k==='frag',R=big?3.4:1.7,D=big?130:55;
  sfx.boom(x,y,big);spawnP(x,y,z,big?40:16,SOOT,4,.9,1,2);spawnP(x,y,z,big?16:8,SPARK,5,.35,1);
  if(Math.hypot(cam.x-x,cam.y-y)<9)boomT=big?.5:.25;
  if((mine||foe)&&d<R&&los(x,y,bz,cam.x,cam.y,me.z))hurt(D*(1-d/R),mine?'자폭':own.name,mine?{x,y}:own);
  for(const b of hostBots()){                                   // the host answers for its bots (no friendly fire from grenades)
    const l=Math.hypot(b.x-x,b.y-y);
    if(b.team!==own.team&&l<R&&los(x,y,bz,b.x,b.y,.5))botHurt(b,D*(1-l/R),own);
  }
  noiseAt(x,y,30,-1);
  // tear into thin walls and hatches around the blast: depends only on the reported position, so every client agrees
  if(k==='impact'&&c>=0)destroy(c);
  const r=big?1.3:.8,cx=x|0,cy=y|0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const q=(cy+j)*MW+cx+i,g=grid[q];
    if(g!==SOFT&&g!==DOOR&&g!==WIN)continue;
    const o=orient[q],u=clamp(o?x-cx-i:y-cy-j,0,.999);
    if(Math.hypot(o?x-cx-i-u:x-cx-i-.5,o?y-cy-j-.5:y-cy-j-u)<r)punch(q,u*TEX|0,(1-bz)*TEX|0,big?9:6);
  }
  blastHatches(x,y,big?1.5:.9);
}

// ---------- door traps ----------
function trapBoom(c){
  if(traps[c]===undefined)return;
  delete traps[c];
  const x=c%MW+.5,y=(c/MW|0)+.5;
  sfx.boom(x,y,0);spawnP(x,y,.3,14,SOOT,3,.7,1,2);spawnP(x,y,.3,8,SPARK,4,.3,1);
  if(Math.hypot(me.x-x,me.y-y)<1.1)hurt(70,'함정',{x,y});
}
