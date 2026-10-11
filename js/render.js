'use strict';
// WebGL2 renderer. Storeys are stacked: world x = east, y = up (storey + height), z = south (local map y).
// Wall and floor panels sample a mask atlas (one 32x32 slot per cell) and discard holed texels, so bullet holes are
// real see-through geometry on every storey. The weapon, markers and screen effects go on the 2D canvas on top.
const gl=glc.getContext('webgl2',{antialias:false,alpha:false});
const MCOLS=64,MROWS=Math.ceil(2*NC/MCOLS),labels=[];
let prog,geoVao,geoBuf,geoN=0,dynVao,dynBuf,texWorld,texSpr,texMask,uMVP,uCam,vb=[],mvp=new Float32Array(16);

const VS=`#version 300 es
layout(location=0)in vec3 aPos;layout(location=1)in vec3 aTex;layout(location=2)in vec3 aAux;
uniform mat4 uMVP;uniform vec3 uCam;out vec3 vTex;out vec3 vAux;out float vDist;
void main(){gl_Position=uMVP*vec4(aPos,1.);vTex=aTex;vAux=aAux;vDist=distance(aPos,uCam);}`;
// vAux: light, mask slot (-1 none), 1 if the panel has studs/joists every 16 texels
const FS=`#version 300 es
precision highp float;precision highp sampler2DArray;
uniform sampler2DArray uTex;uniform sampler2D uMask;
in vec3 vTex;in vec3 vAux;in float vDist;out vec4 o;
float hole(vec2 f){vec2 s=vec2(mod(vAux.y,${MCOLS}.),floor(vAux.y/${MCOLS}.));return texelFetch(uMask,ivec2(s*32.+floor(clamp(f,0.,.999)*32.)),0).r;}
void main(){
  vec4 c=texture(uTex,vTex);
  if(c.a<.5)discard;
  float l=vAux.x;
  if(vAux.y>=0.){
    vec2 f=fract(vTex.xy);float e=1./32.;
    if(hole(f)>.5)discard;
    if(hole(f+vec2(e,0.))+hole(f-vec2(e,0.))+hole(f+vec2(0.,e))+hole(f-vec2(0.,e))>.5){   // texels beside a hole
      if(vAux.z>.5&&mod(floor(f.x*32.),16.)<1.)c=texture(uTex,vec3(vTex.xy,${L_STUD}.));       // a stud or joist shows as timber
      else l*=.55;                                                                          // everything else gets a dark rim
    }
  }
  o=vec4(c.rgb*l*clamp(1.3/(1.+vDist*.11),.3,1.),1.);
}`;
function initGL(){
  const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(o));return o};
  prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);uMVP=gl.getUniformLocation(prog,'uMVP');uCam=gl.getUniformLocation(prog,'uCam');
  gl.uniform1i(gl.getUniformLocation(prog,'uTex'),0);gl.uniform1i(gl.getUniformLocation(prog,'uMask'),1);
  const vao=()=>{                                              // 9 floats per vertex: position, uv + layer, light + slot + studs
    const v=gl.createVertexArray(),b=gl.createBuffer();gl.bindVertexArray(v);gl.bindBuffer(gl.ARRAY_BUFFER,b);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12)}
    return [v,b];
  };
  [geoVao,geoBuf]=vao();[dynVao,dynBuf]=vao();
  const array=(list,size,n)=>{                                 // 0xBBGGRR pictures -> RGBA array layers (picture in the top-left corner)
    const t=gl.createTexture(),px=new Uint8Array(size*size*4*n);
    list.forEach((p,i)=>{
      if(!p)return;
      const w=p.w||size,h=p.h||size,src=p.t||p;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=src[y*w+x],o=((i*size+y)*size+x)*4;if(c){px[o]=c&255;px[o+1]=c>>8&255;px[o+2]=c>>16&255;px[o+3]=255}}
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY,t);gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RGBA,size,size,n,0,gl.RGBA,gl.UNSIGNED_BYTE,px);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  };
  texWorld=array(TEXL,TEX,NTEX);texSpr=array(SPRL,64,SPRL.length);
  texMask=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texMask);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);gl.enable(gl.DEPTH_TEST);gl.clearColor(.56,.72,.9,1);
}
// ---------- hole masks ----------
const mbuf=new Uint8Array(1024),mzero=new Uint8Array(MCOLS*32*MROWS*32);
function upMask(slot){                           // slot < NC: the wall panel in that cell; otherwise the floor under cell slot-NC
  const src=slot<NC?holes:fholes,c=(slot<NC?slot:slot-NC)*TEX;
  for(let u=0;u<32;u++){const m=src[c+u];for(let v=0;v<32;v++)mbuf[v*32+u]=m>>>v&1?255:0}
  gl.texSubImage2D(gl.TEXTURE_2D,0,slot%MCOLS*32,(slot/MCOLS|0)*32,32,32,gl.RED,gl.UNSIGNED_BYTE,mbuf);
}
function syncMasks(){
  gl.activeTexture(gl.TEXTURE1);
  if(maskAll){
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,MCOLS*32,MROWS*32,0,gl.RED,gl.UNSIGNED_BYTE,mzero);
    for(let i=0;i<NC*TEX;i++){if(holes[i])dirtyM.add(i/TEX|0);if(fholes[i])dirtyM.add(NC+(i/TEX|0))}
    maskAll=0;
  }
  for(const s of dirtyM)upMask(s);
  dirtyM.clear();gl.activeTexture(gl.TEXTURE0);
}
// ---------- geometry ----------
// p: four corners (x,y,z each), uv: their texture coordinates; drawn as two triangles.
function quad(p,uv,layer,light,slot,stud){
  for(const i of [0,1,2,0,2,3])vb.push(p[i*3],p[i*3+1],p[i*3+2],uv[i*2],uv[i*2+1],layer,light,slot,stud);
}
const UV=[0,0,1,0,1,1,0,1],cube=g=>g&&g<SOFT&&g!==SKYW;
function buildGeo(){
  vb=[];
  for(let c=0;c<NC;c++){
    const x=c%MW,Y=c/MW|0,f=floorOf(Y),z=fold(Y),g=grid[c],t=f+1,out=zone[c]===0;
    if(g===SKYW)continue;
    const pk=prop[c],low=pk&&PROPH[pk]<1,wl=(n,hard)=>wallS[n]?L_WS+2*wallS[n]-(hard?1:2):hard?HWALL:SOFT;   // wl: the wall texture facing cell n, in that room's paint
    if(cube(g)){
      const top=pk?f+PROPH[pk]:t,L=pk?L_PR+pk-1:g;
      for(const [dx,dz,lt] of [[0,-1,.8],[0,1,.8],[-1,0,1],[1,0,1]]){        // side faces that look onto open space
        const nx=x+dx,nz=z+dz,n=c+dx+dz*MW;
        if(nx<0||nx>=MW||nz<0||nz>=FH||cube(grid[n])&&(pk?prop[n]===pk||!prop[n]:!(prop[n]&&PROPH[prop[n]]<1)))continue;   // hidden behind a neighbour at least as tall
        const l=lt*(zone[n]?.92:1.12),a=dx?x+(dx>0):x,b=dz?z+(dz>0):z;
        const Lf=pk||!zone[n]?L:g===BRICK?wl(n,0):g===HARD&&wallS[n]?wl(n,1):L;   // indoors, the outside wall and the posts wear the room's plaster
        quad(dx?[a,top,z,a,top,z+1,a,f,z+1,a,f,z]:[x,top,b,x+1,top,b,x+1,f,b,x,f,b],UV,Lf,l,-1,0);
      }
      if(pk||f<NL-1&&!cube(grid[c+OFFC]))quad([x,top,z,x+1,top,z,x+1,top,z+1,x,top,z+1],UV,pk?L:g===BRICK?L_ROOF:g,1.05,-1,0);   // top, where nothing stands on it
      if(!low)continue;                                           // above low furniture the room carries on: floor and ceiling below
    }
    if(g&&!pk){                                                 // thin wall panel
      const P=s=>orient[c]?[x,t,z+.5+s,x+1,t,z+.5+s,x+1,f,z+.5+s,x,f,z+.5+s]:[x+.5+s,t,z,x+.5+s,t,z+1,x+.5+s,f,z+1,x+.5+s,f,z];
      if(g===SOFT||g===HWALL)for(const s of [-.006,.006])quad(P(s),UV,wl(c+(s<0?-1:1)*(orient[c]?MW:1),g===HWALL),.96,c,g===SOFT?1:0);   // one skin per side, in each room's paint
      else quad(P(0),UV,g,.96,c,0);
    }
    const d=ramp[c];
    if(d){                                                      // stairs: sloped top, two flanks, and a riser under the top step
      const lo=f+rampB[c],hi=lo+.5,hw=d>0?lo:hi,he=d>0?hi:lo;   // heights at the west/north and east/south edges
      if(d===1||d===-1){
        quad([x,hw,z,x+1,he,z,x+1,he,z+1,x,hw,z+1],UV,L_STAIR,1,-1,0);
        for(const zz of [z,z+1])quad([x,hw,zz,x+1,he,zz,x+1,f,zz,x,f,zz],UV,L_CONC,.8,-1,0);
        if(rampB[c]){const xx=d>0?x+1:x;quad([xx,hi,z,xx,hi,z+1,xx,f,z+1,xx,f,z],UV,L_CONC,.9,-1,0)}
      }else{                                                    // a flight running north-south
        quad([x,hw,z,x,he,z+1,x+1,he,z+1,x+1,hw,z],UV,L_STAIR,1,-1,0);
        for(const xx of [x,x+1])quad([xx,hw,z,xx,he,z+1,xx,f,z+1,xx,f,z],UV,L_CONC,.8,-1,0);
        if(rampB[c]){const zz=d>0?z+1:z;quad([x,hi,zz,x+1,hi,zz,x+1,f,zz,x,f,zz],UV,L_CONC,.9,-1,0)}
      }
    }else if(!nofloor[c]&&hatch[c]!==3){                        // floor
      const hs=hatch[c],L=hs?hs===2?L_HATCHR:L_HATCH:out?f===1?L_GRASS:L_CONC:zone[c]===2+site?L_SITE:floorS[c]?L_FS+2*floorS[c]-(softF[c]?2:1):softF[c]?L_WOOD:L_CONC;   // the room's own floor; boards exactly where bullets go through
      quad([x,f,z,x+1,f,z,x+1,f,z+1,x,f,z+1],UV,L,out?1.1:.92,softF[c]&&!hs?NC+c:-1,1);
    }
    const up=c+OFFC;                                            // ceiling: the underside of the floor above, or the roof
    if(f<NL-1?!nofloor[up]&&hatch[up]!==3&&!ramp[c]:!out){
      const hs=f<NL-1?hatch[up]:0;
      quad([x,t-.004,z,x+1,t-.004,z,x+1,t-.004,z+1,x,t-.004,z+1],UV,hs?hs===2?L_HATCHR:L_HATCH:out?L_CONC:L_CEIL,.9,f<NL-1&&softF[up]&&!hs?NC+up:-1,1);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER,geoBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vb),gl.STATIC_DRAW);geoN=vb.length/9;
}
// Camera-facing sprite standing on (x, yb, z).
function bill(x,yb,z,w,h,S,light,sa,ca){
  const rx=-sa*w/2,rz=ca*w/2,u=S.w/64,v=S.h/64;
  quad([x-rx,yb+h,z-rz,x+rx,yb+h,z+rz,x+rx,yb,z+rz,x-rx,yb,z-rz],[0,0,u,0,u,v,0,v],S.layer,light,-1,0);
}

// ---------- first-person weapon (2D overlay) ----------
const GUNLOOK={ar:{len:1,w:1,c:'#2b2e33',mag:1},smg:{len:.72,w:.9,c:'#2c2c31',mag:1},sg:{len:1.05,w:1.3,c:'#4a3524'},
  dmr:{len:1.25,w:.9,c:'#30352c',mag:1,scope:1},pistol:{len:.42,w:.85,c:'#26262a'}};
function drawGun(kind,a){                        // a: 0 at the hip .. 1 aiming down the sights
  const L=GUNLOOK[kind],s=1+a*.3,wv=L.w*s,Y=L.len*64*s,hw=y=>(2.4+y*.17)*wv;
  const dip=(reloadT>0?Math.sin(Math.min(1,reloadT*2.5)*1.57)*70:0)+(sensing||holdT>0?80:0);
  const mx=W/2+(1-a)*68+Math.sin(bob)*2.5*(1-a*.7),my=H-92+a*(H/2+24-(H-92))+Math.abs(Math.cos(bob))*2*(1-a)+dip+Math.max(0,fireT)*30-(meleeT>.25?22:0);
  const q=(y0,y1,k0,k1,col)=>{ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(-k0,y0);ctx.lineTo(k0,y0);ctx.lineTo(k1,y1);ctx.lineTo(-k1,y1);ctx.fill()};
  ctx.save();ctx.translate(mx,my);ctx.rotate(-.26*(1-a));
  if(muzzle>0){
    ctx.fillStyle='#ffb93c';ctx.beginPath();
    for(let i=0;i<10;i++){const r=i&1?5*s:(11+Math.random()*7)*s,t=i*.628+bob;ctx.lineTo(Math.cos(t)*r,-5*s+Math.sin(t)*r)}
    ctx.fill();ctx.fillStyle='#fff6d0';ctx.beginPath();ctx.arc(0,-5*s,4*s,0,7);ctx.fill();
  }
  q(0,Y*.4,hw(0),hw(Y*.4),'#17181b');                                    // barrel
  q(Y*.3,Y,hw(Y*.3)*1.55,hw(Y)*1.55,L.c);                                // handguard
  q(Y,Y+190,hw(Y)*1.95,hw(Y+190)*1.95,'#1c1d21');                        // receiver, runs off the bottom of the screen
  q(Y*.3,Y+190,.9*wv,2.2*wv,'#42454b');                                  // top rail
  ctx.fillStyle='#0c0c0e';ctx.fillRect(-1.4*wv,-6*s,2.8*wv,7*s);         // front sight
  ctx.fillRect(-hw(Y)*1.2,Y-7*s,2.2*wv,8*s);ctx.fillRect(hw(Y)*1.2-2.2*wv,Y-7*s,2.2*wv,8*s);   // rear sight posts
  if(L.scope){ctx.lineWidth=3*s;ctx.strokeStyle='#101113';ctx.fillStyle='rgba(120,190,230,.22)';ctx.beginPath();ctx.arc(0,Y*.78,9*s,0,7);ctx.fill();ctx.stroke()}
  if(L.mag){ctx.fillStyle='#131316';ctx.beginPath();const k=hw(Y)*1.9;ctx.moveTo(-k,Y+14);ctx.lineTo(-k-13*s,Y+62);ctx.lineTo(-k+3*s,Y+70);ctx.lineTo(-k*.4,Y+30);ctx.fill()}
  ctx.fillStyle='#39402f';ctx.beginPath();ctx.ellipse(-hw(Y*.7)*1.7,Y*.74,8*s,13*s,-.5,0,7);ctx.fill();   // support hand
  ctx.restore();
}
const vig=document.createElement('canvas');vig.width=W;vig.height=H;
{const g=vig.getContext('2d'),r=g.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,H*.95);r.addColorStop(0,'rgba(170,0,0,0)');r.addColorStop(1,'rgba(170,0,0,.9)');g.fillStyle=r;g.fillRect(0,0,W,H)}

function render(){
  if(!gl)return;
  // three.js (models.js) shares this context and leaves its own state behind: put ours back
  gl.useProgram(prog);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.colorMask(true,true,true,true);
  gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.STENCIL_TEST);gl.clearColor(.56,.72,.9,1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texMask);gl.activeTexture(gl.TEXTURE0);
  const ca=Math.cos(cam.a),sa=Math.sin(cam.a),cp=Math.cos(cam.pa),sp=Math.sin(cam.pa);
  const ex=cam.x,ey=floorOf(cam.y)+cam.z,ez=fold(cam.y),fx=ca*cp,fy=sp,fz=sa*cp;             // eye and view direction
  // view-projection: right = (-sa,0,ca), up = (-ca*sp,cp,-sa*sp), forward = (fx,fy,fz); perspective from the horizontal half-angle tangent `fov`
  const px=1/fov,py=W/H/fov,n=.04,fr=90,A=(fr+n)/(n-fr),B=2*fr*n/(n-fr);
  const R=[-sa,0,ca,sa*ex-ca*ez],U=[-ca*sp,cp,-sa*sp,ca*sp*ex-cp*ey+sa*sp*ez],F=[-fx,-fy,-fz,fx*ex+fy*ey+fz*ez];   // view rows (last = translation)
  for(let i=0;i<4;i++){mvp[i*4]=px*R[i];mvp[i*4+1]=py*U[i];mvp[i*4+2]=A*F[i]+(i===3?B:0);mvp[i*4+3]=-F[i]}
  const toScreen=(x,y,z)=>{                                    // world point -> overlay pixel, or null when behind the camera
    const w=mvp[3]*x+mvp[7]*y+mvp[11]*z+mvp[15];if(w<.1)return null;
    return [(mvp[0]*x+mvp[4]*y+mvp[8]*z+mvp[12])/w*W/2+W/2,H/2-(mvp[1]*x+mvp[5]*y+mvp[9]*z+mvp[13])/w*H/2];
  };
  syncMasks();if(geoDirty){buildGeo();geoDirty=0}
  gl.viewport(0,0,W,H);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(uMVP,false,mvp);gl.uniform3f(uCam,ex,ey,ez);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY,texWorld);gl.bindVertexArray(geoVao);gl.drawArrays(gl.TRIANGLES,0,geoN);

  // ---- sprites and particles ----
  vb=[];labels.length=0;
  const playing=mode!=='menu'&&phase!=='lobby',S=(e,s,w,h,lift)=>bill(e.x,floorOf(e.y)+(e.h||0)+(lift||0),fold(e.y),w,h,s,1,sa,ca);
  if(playing)S(bomb,P_BOMB,.3,.45);
  if(defuser)S(defuser,P_DEFUSER,.26,.16);
  if(charge>=0){const x=charge%MW+.5,y=(charge/MW|0)+.5,l=Math.hypot(ex-x,ez-fold(y))||1;S({x:x+(ex-x)/l*.08,y:y+(ez-fold(y))/l*.08},P_CHARGE,.3,.2,.4)}
  for(const c in traps)S({x:c%MW+.5,y:(c/MW|0)+.5},P_TRAP,.7,.05,.12);
  const rope=(e,top)=>{const b=floorOf(e.y)+e.h+top;bill(e.x,b,fold(e.y),.025,NL-b,P_ROPE,1,sa,ca)};   // from the harness up to the eaves
  if(me.rap&&!me.dead)rope({x:me.x+me.rx*.12,y:me.y+me.ry*.12,h:me.h},.2);
  for(const o of Object.values(others)){const c=(o.y|0)*MW+(o.x|0);if(!o.dead&&o.z>.2&&(nofloor[c]||o.h>.05&&!ramp[c]))rope(o,o.z)}   // others: whoever hangs in the air is on a rope
  cams.forEach((k,i)=>{if(!k.dead&&i!==me.cv)S(k,P_CAM,.2,.15,.82)});
  if(me.dr&&!me.dv&&phase==='act')S(me.dr,P_DRONE,.24,.1);                // my parked drone
  for(const c in wires)S({x:c%MW+.5,y:(c/MW|0)+.5},P_WIRE,.95,.24,.01);
  for(const g of nades)g.k==='c4'?S({x:g.x,y:g.y},P_CHARGE,.2,.13,g.z-.03):S({x:g.x,y:g.y},P_NADE,.07,.07,g.z-.035);
  for(const s of smokes){const k=Math.min(1,(14-s.t)*1.5,s.t/2)*1.2;for(const p of s.p)S({x:s.x+p[0],y:s.y+p[1]},P_PUFF,k,k,p[2]-k/2)}
  for(const o of Object.values(others)){
    if(o.z<.05)continue;                                       // destroyed drone
    const model=window.modelsReady;                            // with models.js loaded, bodies are real 3D; sprites are the fallback
    if(o.dead){if(!model)S(o,CORPSE[o.team],.75,.14)}
    else if(o.z<.2)S(o,P_DRONE,.24,.1);                        // a player driving a drone
    else{
      const back=Math.cos(o.av-Math.atan2(ez-fold(o.y),ex-o.x))<0?1:0,step=o.mv>.4?1+(o.walk*2.5&1):0;
      if(!model)S(o,OPSPR[o.team][back][step],(o.z+.12)*SW/SH,o.z+.12);
      if(o.flash>0)S({x:o.x+Math.cos(o.av)*.3,y:o.y+Math.sin(o.av)*.3,h:o.h},P_FLASH,.16,.16,o.z-.13);
      const top=toScreen(o.x,floorOf(o.y)+o.h+o.z+.2,fold(o.y));
      if(top&&o.team===me.team)labels.push(['▼ '+o.name,top[0],top[1],'#9cf']);                          // teammates show through walls and floors
      else if(top&&sensing&&Math.hypot(o.x-me.x,fold(o.y)-fold(me.y))<7&&Math.abs(floorOf(o.y)-floorOf(me.y))<2)labels.push(['♥',top[0],top[1]+12,'#f44']);   // heartbeat sensor
    }
  }
  for(const p of parts)bill(p.x,floorOf(p.y)+p.z,fold(p.y),p.size*.035,p.size*.035,p.col,1,sa,ca);
  for(const p of pings){const s=toScreen(p.x,floorOf(p.y)+p.z,fold(p.y));if(s)labels.push(['◆ '+p.who,s[0],s[1],'#fd3'])}
  if(playing){                                                 // objective marker with distance and storey
    const o=defuser||bomb,s=toScreen(o.x,floorOf(o.y)+.7,fold(o.y)),df=floorOf(o.y)-floorOf(cam.y);
    if(s)labels.push([(defuser?'◈ 디퓨저 ':'◇ 목표 ')+(df?df>0?'△ ':'▽ ':'')+(Math.hypot(o.x-ex,fold(o.y)-ez)*2|0)+'m',s[0],s[1],defuser?'#ff6a5a':'#fff']);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY,texSpr);gl.bindVertexArray(dynVao);gl.bindBuffer(gl.ARRAY_BUFFER,dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vb),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,vb.length/9);
  if(window.drawModels)drawModels(frameDt);

  // ---- 2D overlay ----
  ctx.clearRect(0,0,W,H);
  ctx.font='bold 9px sans-serif';ctx.textAlign='center';
  for(const [t,x,y,col] of labels){ctx.fillStyle=col;ctx.fillText(t,clamp(x,20,W-20),clamp(y,9,H-2))}
  if((me.drone||(me.cv>=0||me.dv)&&!me.dead)&&playing){ctx.fillStyle='rgba(40,255,120,.07)';ctx.fillRect(0,0,W,H)}   // drone or camera feed
  else if(!me.dead&&playing){
    const a=clamp((cfg.fov-fov)/(cfg.fov-(curGun().zoom||.55)),0,1);
    if(!window.modelsReady)drawGun(me.guns[gun],a);
    if(muzzle>0){ctx.fillStyle='rgba(255,220,150,.06)';ctx.fillRect(0,0,W,H)}
    if(curGun().shield){                                       // the ballistic shield: lower left of the view, with its window
      ctx.fillStyle='rgba(22,24,28,.94)';ctx.fillRect(W*.06,H*.4,W*.5,H*.6);
      ctx.fillStyle='rgba(130,170,200,.3)';ctx.fillRect(W*.17,H*.46,W*.28,H*.13);
      ctx.strokeStyle='#0c0d10';ctx.lineWidth=3;ctx.strokeRect(W*.06,H*.4,W*.5,H*.6);ctx.strokeRect(W*.17,H*.46,W*.28,H*.13);
    }
    ctx.fillStyle='#fff';
    if(a<.5){const g=4+moving*4+Math.max(0,fireT)*20|0;ctx.fillRect(W/2-g-4,H/2,4,1);ctx.fillRect(W/2+g+1,H/2,4,1);ctx.fillRect(W/2,H/2-g-4,1,4);ctx.fillRect(W/2,H/2+g+1,1,4)}
    else ctx.fillRect(W/2-1,H/2-1,2,2);
    if(hitT>0||killT>1){                                       // hit marker: white, red on a headshot, bigger on a kill
      const k=killT>1?9:6;ctx.strokeStyle=hitHS||killT>1?'#ff4030':'#fff';ctx.lineWidth=1.5;ctx.beginPath();
      for(const [i,j] of [[1,1],[1,-1],[-1,1],[-1,-1]]){ctx.moveTo(W/2+i*3,H/2+j*3);ctx.lineTo(W/2+i*k,H/2+j*k)}
      ctx.stroke();
    }
  }
  const red=clamp(hurtT*1.6+(playing&&!me.dead&&me.hp<35?.3:0),0,1);
  if(red>0){ctx.globalAlpha=red;ctx.drawImage(vig,0,0);ctx.globalAlpha=1}
  if(hurtT>0&&!me.dead){                                       // where the damage came from
    const r=hurtA-cam.a-Math.PI/2;
    ctx.strokeStyle=`rgba(255,70,50,${Math.min(1,hurtT*2)})`;ctx.lineWidth=5;ctx.beginPath();ctx.arc(W/2,H/2,72,r-.3,r+.3);ctx.stroke();
  }
  if(boomT>0){ctx.fillStyle=`rgba(255,240,210,${Math.min(1,boomT*1.6)})`;ctx.fillRect(0,0,W,H)}
  if(flashT>0){ctx.fillStyle=`rgba(255,255,255,${Math.min(1,flashT/1.2)})`;ctx.fillRect(0,0,W,H)}
  if(me.dead&&playing&&!viewTarget()){ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,W,H)}
  $('view').style.transform=`rotate(${me.lean*4}deg) scale(${1+Math.abs(me.lean)*.1})`;
}
if(gl)initGL();else $('err').textContent='이 브라우저는 WebGL2 를 지원하지 않습니다';
