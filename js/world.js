'use strict';
// World simulation that every client runs the same way: wall and floor destruction, hatches, ray tests through the
// storeys, bullets, grenades, traps. Particles are cosmetic only.
// Positions are (x, y, z): y carries the storey (see core.js), z is the height inside that storey, 0..1.
const eyeOf=(e,zz)=>{let z=e.h+(zz===undefined?e.z:zz),y=e.y;if(z>=1){z-=1;y+=FH}return [y,z]};   // an entity's eye: on the upper half of a flight of stairs it is already in the storey above
const absZ=(y,z)=>floorOf(y)+z;

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
    if(p.z<.01){
      const c=(p.y|0)*MW+(p.x|0);
      if(p.y>=FH&&(nofloor[c]||hatch[c]===3)){p.y-=FH;p.z+=1}             // debris drops through openings
      else{p.z=.01;p.vz*=-.3;p.vx*=.5;p.vy*=.5}
    }
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
  if(add){const p=wallPoint(c,ui,vi);spawnP(p[0],p[1],p[2],Math.min(10,2+add>>2),g===SOFT?PLASTER:WOOD,1.6,.7,1);dirtyM.add(c)}
  if(net)send({t:'h',c,u:ui,v:vi,r});
  if(holeN[c]>(g===SOFT?400:g===DOOR?260:170))destroy(c);       // too many holes -> the panel falls (peers derive the same)
}
function punchFloor(c,ui,vi,r,net){              // c: the cell whose floor it is; shot or blasted from either side
  if(!softF[c]||hatch[c])return;
  let add=0;
  for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){
    const u=ui+a,v=vi+b;
    if(a*a+b*b>r*r+r||u<0||u>=TEX||v<0||v>=TEX||u%16===0)continue;      // joists survive
    const i=c*TEX+u,bit=1<<v;
    if(!(fholes[i]&bit)){fholes[i]|=bit;add++}
  }
  if(add){
    const x=c%MW+(ui+.5)/TEX,y=(c/MW|0)+(vi+.5)/TEX;
    spawnP(x,y,.03,Math.min(6,1+add>>2),WOOD,1.4,.6,1);spawnP(x,y-FH,.96,Math.min(8,2+add>>2),WOOD,1,.9,1);dirtyM.add(NC+c);
  }
  if(net)send({t:'fh',c,u:ui,v:vi,r});
}
function destroy(c,hard){                        // hard: also takes out a reinforced panel (thermal charge)
  const g=grid[c];
  if(g===WIN){                                   // a window loses its boards but keeps frame and sill
    if(holeN[c]>9000)return;
    for(let u=0;u<TEX;u++)holes[c*TEX+u]|=WMID;
    holeN[c]=9999;dirtyM.add(c);
  }else if(g===SOFT||g===DOOR||g===SHIELD||hard&&g===RTHIN){
    grid[c]=0;geoDirty=1;
    if(g===SHIELD){holes.fill(0,c*TEX,c*TEX+TEX);holeN[c]=0;dirtyM.add(c)}
  }else return;
  if(charge===c)charge=-1;
  const x=c%MW+.5,y=(c/MW|0)+.5;
  spawnP(x,y,.5,26,g===SOFT?PLASTER:g===RTHIN||g===SHIELD?METAL:WOOD,3,1.1,1,2);sfx.crash(x,y);
}
// A deployable shield is a thin wall whose upper part is open from the start: it stops legs and low shots, and Space climbs over it.
function placeShield(c,o,net){
  if(grid[c]||nofloor[c]||ramp[c]||hatch[c])return;
  grid[c]=SHIELD;orient[c]=o;holeN[c]=1;geoDirty=1;dirtyM.add(c);
  for(let u=0;u<TEX;u++)holes[c*TEX+u]=0x3FFF;   // rows 0..13 from the top are air
  sfx.steel(c%MW+.5,(c/MW|0)+.5);if(net)send({t:'sh',c,o});
}
function reinforce(c,net){
  if(grid[c]!==SOFT)return;
  grid[c]=RTHIN;holes.fill(0,c*TEX,c*TEX+TEX);holeN[c]=0;geoDirty=1;dirtyM.add(c);if(charge===c)charge=-1;
  sfx.steel(c%MW+.5,(c/MW|0)+.5);if(net)send({t:'rf',c});
}
function barricade(c,net){                       // board up an open doorway again
  if(orig[c]!==DOOR||grid[c])return;
  grid[c]=DOOR;holes.fill(0,c*TEX,c*TEX+TEX);holeN[c]=0;geoDirty=1;dirtyM.add(c);
  sfx.thud(c%MW+.5,(c/MW|0)+.5);if(net)send({t:'bd',c});
}
const near3=(e,x,y,z)=>Math.hypot(e.x-x,fold(e.y)-fold(y),absZ(e.y,e.h+e.z*.5)-absZ(y,z));   // distance from an entity's middle to a point, across storeys
function explode(c,net,th){                      // breach charge on wall cell c
  if(net)send({t:'b',c,th:th?1:0});
  destroy(c,th);
  const x=c%MW+.5,y=(c/MW|0)+.5;
  sfx.boom(x,y,1);spawnP(x,y,.5,30,SOOT,4,.9,1,2);spawnP(x,y,.5,12,SPARK,5,.35,1);
  if(near3(me,x,y,.5)<9)boomT=.5;
  if(near3(me,x,y,.5)<1.8)hurt(60,'폭발',{x,y});
  for(const b of hostBots())if(near3(b,x,y,.5)<1.8)botHurt(b,60,{name:'폭발'});
  blastHatches(x,y,1.3);
}

// ---------- floor hatches (a cell of an upper storey; open, it is a hole you drop through) ----------
function openHatch(c,net){
  if(hatch[c]!==1&&hatch[c]!==2)return;
  hatch[c]=3;geoDirty=1;
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
function blastHatches(x,y,r){                    // a blast opens plain hatches in its own floor and in the ceiling overhead
  const cx=x|0,cy=y|0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const q=(cy+j)*MW+cx+i;
    if(Math.hypot(cx+i+.5-x,cy+j+.5-y)<r)for(const c of [q,q+OFFC])if(c<NC&&hatch[c]===1)openHatch(c);
  }
}

// ---------- rays ----------
// trace: a ray from (ox,oy,oz) along the unit direction (dx,dy), climbing `slope` per unit distance. Returns how far it got.
// It runs storey by storey: walls inside a storey (seg), then the floor or ceiling it reaches, which it passes if that
// panel is missing, open, already holed there, or — for bullets — timber.
// hole>=0: bullet, punches soft panels and keeps going (three at most). hole=-1: sight check, stops at the first solid texel.
// hole=-2: reach check for hands (melee, gadgets), stops at any thin wall even where it is already holed.
let hitC=-1,hitU=0,hitV=0;const pens=[];
function seg(ox,oy,oz,dx,dy,slope,lim,hole,base){
  let mx=ox|0,my=oy|0,t=0;
  const ddx=Math.abs(1/dx),ddy=Math.abs(1/dy),sx=dx<0?-1:1,sy=dy<0?-1:1;
  let sdx=(dx<0?ox-mx:mx+1-ox)*ddx,sdy=(dy<0?oy-my:my+1-oy)*ddy;
  for(let i=0;i<120;i++){
    const c=my*MW+mx,g=grid[c];
    if(g>=SOFT){                                 // thin wall: where does the ray cross the cell's mid-line?
      let tt,u;
      if(orient[c]){tt=(my+.5-oy)/dy;u=ox+dx*tt-mx}else{tt=(mx+.5-ox)/dx;u=oy+dy*tt-my}
      if(tt>0&&u>=0&&u<1){
        if(tt>lim)return lim;
        const ui=u*TEX|0,vi=clamp((1-oz-slope*tt)*TEX|0,0,TEX-1),open=holes[c*TEX+ui]>>>vi&1;
        if(hole===-2||!open){
          hitC=c;hitU=ui;hitV=vi;
          if(hole<0||g===RTHIN||g===HWALL||g===SHIELD)return tt;
          punch(c,ui,vi,hole,1);
          if(grid[c]&&!(holes[c*TEX+ui]>>>vi&1))return tt;     // stud, sill or lintel: the bullet stops
          pens.push(base+tt);
          if(pens.length>2)return tt;
        }
      }
    }else if(g&&i&&!(prop[c]&&oz+slope*t>PROPH[prop[c]]))return t;   // a cube stops the ray, unless it is furniture and the ray clears it
    if(sdx<sdy){t=sdx;sdx+=ddx;mx+=sx}else{t=sdy;sdy+=ddy;my+=sy}
    if(t>lim)return lim;
  }
  return lim;
}
function floorOpen(c,x,y,hole,dist){             // can a ray at (x,y) get past the floor of cell c?
  if(nofloor[c]||hatch[c]===3)return 1;
  if(hatch[c]||!softF[c]||grid[c]&&grid[c]<SOFT)return 0;
  const ui=(x-(x|0))*TEX|0,vi=(y-(y|0))*TEX|0,i=c*TEX+ui,bit=1<<vi;
  if(fholes[i]&bit)return 1;
  if(hole<0)return 0;
  punchFloor(c,ui,vi,Math.max(hole,1),1);
  if(!(fholes[i]&bit))return 0;                  // a joist
  pens.push(dist);return pens.length<4;
}
function trace(ox,oy,oz,dx,dy,slope,maxD,hole){
  dx=dx||1e-9;dy=dy||1e-9;hitC=-1;pens.length=0;
  let base=0;
  for(let k=0;k<=NL;k++){
    const tv=slope?(slope<0?-oz/slope:(1-oz)/slope):1e9,lim=Math.min(maxD-base,tv),d=seg(ox,oy,oz,dx,dy,slope,lim,hole,base);
    if(d<lim-1e-9||tv>=maxD-base)return Math.min(maxD,base+d);
    const x=ox+dx*tv,y=oy+dy*tv,down=slope<0,f=floorOf(y);
    if(down?!f:f===NL-1)return down||zone[(y|0)*MW+(x|0)]?base+tv:maxD;     // the ground, a roof, or off into the sky
    if(!floorOpen(((down?y:y+FH)|0)*MW+(x|0),x,y,hole,base+tv))return base+tv;   // the panel in the way belongs to the upper storey
    ox=x;oy=down?y-FH:y+FH;oz=down?1-1e-6:1e-6;base+=tv;
  }
  return base;
}
function los(x0,y0,z0,x1,y1,z1){                 // z: height inside each point's own storey
  const dx=x1-x0,dy=fold(y1)-fold(y0),d=Math.max(.05,Math.hypot(dx,dy));
  return trace(x0,y0,z0,dx/d,dy/d,(absZ(y1,z1)-absZ(y0,z0))/d,d,-1)>=d-.02;
}
const sees=(x,y,z,e)=>{const [ey,ez]=eyeOf(e);return los(x,y,z,e.x,ey,ez)};   // is entity e's head visible from that point?
// One bullet from `by` (me, or a bot the host is driving). Only the shooter's machine runs this.
function bullet(ox,oy,oz,a,slope,dmg,hole,by,hsDmg,fo){   // fo: range falloff [full damage up to, weakest from, weakest share]
  const dx=Math.cos(a),dy=Math.sin(a),stop=trace(ox,oy,oz,dx,dy,slope,40,hole),oa=absZ(oy,oz),ol=fold(oy);
  let best,bd=stop,bz;
  if(by.team===atkTeam)for(let i=0;i<cams.length;i++){            // an attacker's round takes out a camera it passes through
    const k=cams[i],rx=k.x-ox,ry=fold(k.y)-ol,al=rx*dx+ry*dy;
    if(!k.dead&&al>0&&al<stop&&Math.abs(rx*dy-ry*dx)<.14&&Math.abs(oa+slope*al-floorOf(k.y)-.9)<.14)camDown(i,1);
  }
  for(const t of enemiesOf(by.team)){
    if(t.dead||t.z<.05)continue;
    const rx=t.x-ox,ry=fold(t.y)-ol,al=rx*dx+ry*dy;
    if(al<=0||al>=bd||Math.abs(rx*dy-ry*dx)>.22)continue;
    const z=oa+slope*al-absZ(t.y,t.h);            // how high above the target's feet the shot passes
    if(z<0||z>t.z+.12)continue;
    best=t;bd=al;bz=z;
  }
  const at=d=>{const za=clamp(oa+slope*d,.02,NL-.02),f=za|0;return [ox+dx*d,ol+dy*d+f*FH,za-f]};   // the point d along the ray
  if(!best){
    if(stop<40){const p=at(stop-.04);spawnP(p[0],p[1],p[2],3,SPARK,2,.2,1);spawnP(p[0],p[1],p[2],1,SOOT,0,25,0)}   // sparks and a scorch mark
    return;
  }
  let k=1;for(const q of pens)if(q<bd)k*=.7;     // each panel penetrated costs damage
  const far=fo&&bd>fo[0]?Math.max(fo[2],1-(bd-fo[0])/(fo[1]-fo[0])*(1-fo[2])):1;
  const p=at(bd);spawnP(p[0],p[1],p[2],5,BLOOD,1.5,.5,1);
  if(by!==me)return hitBy(by,best,dmg*k);
  const hs=bz>best.z-.08;
  hitFoe(best,(hs?hsDmg*(hsDmg<160?far:1):dmg*far)*k,hs);        // distance never saves a head from a rifle round
}

// ---------- grenades ----------
// The thrower's simulation decides where and when it goes off ('ge' event); everyone else flies a look-alike.
// stick: stays where it first touches and waits for its owner's second press. place: not thrown at all, set down on the cell ahead.
const NADE={frag:{fuse:2.4,n:'수류탄'},flash:{fuse:1.6,n:'섬광탄'},smoke:{fuse:1.4,n:'연막탄'},impact:{fuse:9,n:'충격 수류탄',hit:1},
  c4:{fuse:1e9,n:'C4',stick:1},wire:{n:'철조망',place:1},shield:{n:'설치형 방패',place:1},clay:{n:'클레이모어',place:1}};
const nades=[],smokes=[];
function nadeSolid(x,y,z){                       // blocking cell at this point, or -1
  const cx=x|0,cy=y|0,c=cy*MW+cx,g=grid[c];
  if(!g)return -1;
  if(g<SOFT)return prop[c]&&z>PROPH[prop[c]]?-1:c;   // over the furniture
  const o=orient[c];
  if(Math.abs(o?y-cy-.5:x-cx-.5)>.1)return -1;
  return holes[c*TEX+((o?x-cx:y-cy)*TEX|0)]>>>clamp((1-z)*TEX|0,0,TEX-1)&1?-1:c;
}
const gap=c=>nofloor[c]||hatch[c]===3;            // no floor to land on in this cell
function updNades(dt){
  for(let i=nades.length;i--;){
    const n=nades[i];let hit=-1;
    for(let k=n.stuck?0:Math.ceil(dt/.01),h=dt/k;k--;){
      n.vz-=3.2*h;
      let c=nadeSolid(n.x+n.vx*h,n.y,n.z);if(c>=0){n.vx*=-.4;hit=c}else n.x+=n.vx*h;
      c=nadeSolid(n.x,n.y+n.vy*h,n.z);if(c>=0){n.vy*=-.4;hit=c}else n.y+=n.vy*h;
      n.z+=n.vz*h;c=(n.y|0)*MW+(n.x|0);
      if(n.z<.04){
        if(n.y>=FH&&gap(c)){n.y-=FH;n.z+=1}                                    // falls to the storey below
        else{if(n.vz<-.4||NADE[n.k].hit||NADE[n.k].stick)hit=-2;n.z=.04;n.vz*=-.4;n.vx*=.7;n.vy*=.7}   // -2: bounced on the floor
      }else if(n.z>.96){
        if(n.y<(NL-1)*FH){if(gap(c+OFFC)){n.y+=FH;n.z-=1}else{n.z=.96;n.vz*=-.4}}     // up through an opening, or off the ceiling
        else if(zone[c]){n.z=.96;n.vz*=-.4}                                    // top storey: a roof indoors, open sky outdoors
      }
      if(hit!==-1&&NADE[n.k].stick){n.stuck=1;break}
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
  const bz=clamp(z,.1,.9),d=near3(me,x,y,bz),mine=own===me,foe=own.team!==me.team;
  if(k==='smoke'){
    smokes.push({x,y,t:14,p:Array.from({length:6},()=>[rnd(1.7),rnd(1.7),.2+Math.random()*.5])});
    return sfx.hiss(x,y);
  }
  if(k==='flash'){
    sfx.boom(x,y,0);spawnP(x,y,bz,10,SPARK,3,.3,0);
    if(!me.dead&&d<14&&sees(x,y,bz,me)){                        // looking at it hurts much more than looking away
      const f=(1+Math.cos(Math.atan2(fold(y)-fold(cam.y),x-cam.x)-cam.a))/2;
      flashT=Math.max(flashT,(1-d/14)*(.6+3.4*f*f));sfx.ring();
    }
    for(const b of hostBots())if(near3(b,x,y,bz)<7&&sees(x,y,bz,b))b.blind=2.5;
    return;
  }
  const big=k==='frag'||k==='c4',R=big?3.4:1.7,D=big?130:55;
  for(const q in wires)if(floorOf(q/MW|0)===floorOf(y)&&Math.hypot(q%MW+.5-x,(q/MW|0)+.5-y)<R*.6)delete wires[q];   // blasts clear barbed wire
  sfx.boom(x,y,big);spawnP(x,y,bz,big?40:16,SOOT,4,.9,1,2);spawnP(x,y,bz,big?16:8,SPARK,5,.35,1);
  if(d<9)boomT=big?.5:.25;
  if((mine||foe)&&d<R&&sees(x,y,bz,me))hurt(D*(1-d/R),mine?'자폭':own.name,mine?{x,y}:own);
  for(const b of hostBots()){                                   // the host answers for its bots (no friendly fire from grenades)
    const l=near3(b,x,y,bz);
    if(b.team!==own.team&&l<R&&sees(x,y,bz,b))botHurt(b,D*(1-l/R),own);
  }
  noiseAt(x,y,30,-1);
  // tear into the walls, floor and hatches around the blast: depends only on the reported position, so every client agrees
  if(k==='impact'&&c>=0)destroy(c);
  const r=big?1.3:.8,cx=x|0,cy=y|0,fc=cy*MW+cx,fu=(x-cx)*TEX|0,fv=(y-cy)*TEX|0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const q=(cy+j)*MW+cx+i,g=grid[q];
    if(g===SHIELD&&big)destroy(q);               // a frag or C4 next to a deployable shield takes it out
    if(g!==SOFT&&g!==DOOR&&g!==WIN)continue;
    const o=orient[q],u=clamp(o?x-cx-i:y-cy-j,0,.999);
    if(Math.hypot(o?x-cx-i-u:x-cx-i-.5,o?y-cy-j-.5:y-cy-j-u)<r)punch(q,u*TEX|0,(1-bz)*TEX|0,big?9:6);
  }
  if(bz<.5)punchFloor(fc,fu,fv,big?7:4);else if(fc+OFFC<NC)punchFloor(fc+OFFC,fu,fv,big?7:4);
  blastHatches(x,y,big?1.5:.9);
}

// ---------- door traps ----------
function trapBoom(c){
  if(traps[c]===undefined)return;
  delete traps[c];
  const x=c%MW+.5,y=(c/MW|0)+.5;
  sfx.boom(x,y,0);spawnP(x,y,.3,14,SOOT,3,.7,1,2);spawnP(x,y,.3,8,SPARK,4,.3,1);
  if(near3(me,x,y,.3)<1.1)hurt(70,'함정',{x,y});
}
