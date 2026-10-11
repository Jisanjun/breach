'use strict';
// Software renderer: textured floor and ceiling, raycast walls with see-through layers for holed panels,
// depth-tested sprites and particles, then the weapon and screen effects drawn on top with the 2D context.
const LT=new Float32Array(8),LU=new Float32Array(8),LC=new Int32Array(8),LL=new Float32Array(8),labels=[],drawList=[];
const FOG=pcol(20,20,22),SKY=new Uint32Array(H*2);
for(let i=0;i<H*2;i++){const k=Math.min(1,i/150);SKY[i]=pcol(176-k*104,202-k*92,226-k*56)}   // by rows above the horizon
const fogAt=d=>Math.min(1,1.7/(1+d*.35));

function castPlanes(proj,ca,sa,plX,plY,hor){
  for(let y=0;y<H;y++){
    const p=y+.5-hor,row=y*W;
    if(p>-.5&&p<.5){px.fill(FOG,row,row+W);continue}
    const fl=p>0,dist=(fl?cam.z:1-cam.z)*proj/(fl?p:-p),sx=dist*2*plX/W,sy=dist*2*plY/W,f=fogAt(dist);
    let fx=cam.x+dist*(ca-plX),fy=cam.y+dist*(sa-plY);
    if(fl){
      const L1=lvl(f*.92),t0=FT[0][lvl(f*1.12)],t1=FT[1][L1],t2=FT[2][L1],tS=FSTAIR[L1];
      for(let x=0;x<W;x++,fx+=sx,fy+=sy){
        const cx=fx|0,cy=fy|0;
        if(fx<0||fy<0||cx>=MW||cy>=MH){px[row+x]=FOG;continue}
        const c=cy*MW+cx,z=zone[c],hh=hatch[c];
        px[row+x]=(hh?HT[hh][L1]:stair[c]?tS:z?z-2===site?t2:t1:t0)[(fy*TEX&31)<<5|fx*TEX&31];
      }
    }else{
      const L1=lvl(f*.92),t1=CT[L1],sky=SKY[Math.min(H*2-1,-p|0)];
      for(let x=0;x<W;x++,fx+=sx,fy+=sy){
        const cx=fx|0,cy=fy|0;
        if(fx<0||fy<0||cx>=MW||cy>=MH){px[row+x]=sky;continue}
        const c=cy*MW+cx,hh=c<OFFC?hatch[c+OFFC]:0;             // a hatch in the floor above shows in this ceiling
        px[row+x]=zone[c]?(hh?HT[hh][L1]:t1)[(fy*TEX&31)<<5|fx*TEX&31]:sky;
      }
    }
  }
}
function wallCol(x,t,u,c,lit,proj,hor){
  const g=grid[c],lh=proj/t,top=hor-lh*(1-cam.z),ui=u*TEX|0,k=TEX/lh,b=c*TEX,L=lvl(fogAt(t)*lit),tex=T[g][L],dark=T[g][L>5?L-5:0];
  let hm=0,nb=0,stud=null;
  if(g>=SOFT){
    hm=holes[b+ui];
    nb=(ui?holes[b+ui-1]:0)|(ui<TEX-1?holes[b+ui+1]:0)|hm<<1|hm>>>1;      // texels beside a hole get a dark rim
    if(g===SOFT&&ui%16===0)stud=STUD[L];                                   // a stud shows as timber where the plaster next to it is gone
  }
  const ch=c===charge&&ui>11&&ui<20,y1=Math.min(H-1,top+lh|0);
  for(let y=Math.max(0,Math.ceil(top));y<=y1;y++){
    let vi=(y-top)*k|0,p;if(vi>TEX-1)vi=TEX-1;
    if(ch&&vi>12&&vi<19)p=Date.now()&256&&vi<15&&ui>14&&ui<17?0xff2020ff:0xff181818;   // breach charge, blinking light
    else if(hm>>>vi&1)continue;
    else p=(nb>>>vi&1?stud||dark:tex)[vi*TEX+ui];
    px[y*W+x]=p;depth[y*W+x]=t;
  }
}
function castWalls(proj,ca,sa,plX,plY,hor){
  for(let x=0;x<W;x++){
    const cx=2*(x+.5)/W-1,rdx=ca+plX*cx||1e-9,rdy=sa+plY*cx||1e-9;
    let mx=cam.x|0,my=cam.y|0,n=0;
    const ddx=Math.abs(1/rdx),ddy=Math.abs(1/rdy),sx=rdx<0?-1:1,sy=rdy<0?-1:1;
    let sdx=(rdx<0?cam.x-mx:mx+1-cam.x)*ddx,sdy=(rdy<0?cam.y-my:my+1-cam.y)*ddy;
    for(let i=0;i<120;i++){
      let t,side,u;const pc=my*MW+mx;                        // pc: the cell the ray is leaving lights the face it hits
      if(sdx<sdy){t=sdx;sdx+=ddx;mx+=sx;side=0}else{t=sdy;sdy+=ddy;my+=sy;side=1}
      const c=my*MW+mx,g=grid[c];
      if(!g)continue;
      if(g>=SOFT){
        if(orient[c]){t=(my+.5-cam.y)/rdy;u=cam.x+rdx*t-mx;side=1}else{t=(mx+.5-cam.x)/rdx;u=cam.y+rdy*t-my;side=0}
        if(!(u>=0&&u<1))continue;
      }else{u=side?cam.x+rdx*t:cam.y+rdy*t;u-=Math.floor(u)}
      LT[n]=t;LU[n]=u;LC[n]=c;LL[n]=(side?.8:1)*(zone[pc]?.92:1.12);n++;
      if(g<SOFT||n===8||!holes[c*TEX+(u*TEX|0)])break;       // keep going only through columns that have holes
    }
    while(n--)wallCol(x,LT[n],LU[n],LC[n],LL[n],proj,hor);    // back to front
  }
}

// ---------- first-person weapon ----------
const GUNLOOK={ar:{len:1,w:1,c:'#2b2e33',mag:1},smg:{len:.72,w:.9,c:'#2c2c31',mag:1},sg:{len:1.05,w:1.3,c:'#4a3524'},
  dmr:{len:1.25,w:.9,c:'#30352c',mag:1,scope:1},pistol:{len:.42,w:.85,c:'#26262a'}};
function drawGun(kind,a){                        // a: 0 at the hip .. 1 aiming down the sights
  const L=GUNLOOK[kind],s=1+a*.3,wv=L.w*s,Y=L.len*64*s,hw=y=>(2.4+y*.17)*wv;
  const dip=(reloadT>0?Math.sin(Math.min(1,reloadT*2.5)*1.57)*70:0)+(sensing||holdT>0?80:0);
  const mx=W/2+(1-a)*68+Math.sin(bob)*2.5*(1-a*.7),my=H-92+a*(H/2+24-(H-92))+Math.abs(Math.cos(bob))*2*(1-a)+dip+Math.max(0,fireT)*30-(meleeT>.25?22:0);
  const quad=(y0,y1,k0,k1,col)=>{ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(-k0,y0);ctx.lineTo(k0,y0);ctx.lineTo(k1,y1);ctx.lineTo(-k1,y1);ctx.fill()};
  ctx.save();ctx.translate(mx,my);ctx.rotate(-.26*(1-a));
  if(muzzle>0){
    ctx.fillStyle='#ffb93c';ctx.beginPath();
    for(let i=0;i<10;i++){const r=i&1?5*s:(11+Math.random()*7)*s,t=i*.628+bob;ctx.lineTo(Math.cos(t)*r,-5*s+Math.sin(t)*r)}
    ctx.fill();ctx.fillStyle='#fff6d0';ctx.beginPath();ctx.arc(0,-5*s,4*s,0,7);ctx.fill();
  }
  quad(0,Y*.4,hw(0),hw(Y*.4),'#17181b');                                 // barrel
  quad(Y*.3,Y,hw(Y*.3)*1.55,hw(Y)*1.55,L.c);                             // handguard
  quad(Y,Y+190,hw(Y)*1.95,hw(Y+190)*1.95,'#1c1d21');                     // receiver, runs off the bottom of the screen
  quad(Y*.3,Y+190,.9*wv,2.2*wv,'#42454b');                               // top rail
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
  const proj=W/2/fov,ca=Math.cos(cam.a),sa=Math.sin(cam.a),plX=-sa*fov,plY=ca*fov,hor=H/2+cam.pitch*proj;
  const upMe=cam.y>=FH,shift=y=>(y>=FH)===upMe?0:upMe?FH:-FH;       // shift: brings a spot on the other floor to the place right above/below
  castPlanes(proj,ca,sa,plX,plY,hor);depth.fill(1e9);castWalls(proj,ca,sa,plX,plY,hor);

  // ---- sprites, far to near ----
  drawList.length=labels.length=0;
  const add=(x,y,S,h,w,zb,o)=>{const dx=x-cam.x,dy=y-cam.y,d=dx*ca+dy*sa;if(d>.15)drawList.push({d,s:dy*ca-dx*sa,S,h,w,zb,o})};
  if(mode!=='menu')add(bomb.x,bomb.y,P_BOMB,bomb.h,bomb.w,0);
  if(defuser)add(defuser.x,defuser.y,P_DEFUSER,defuser.h,defuser.w,0,defuser);
  for(const c in traps)add(c%MW+.5,(c/MW|0)+.5,P_TRAP,.05,.7,.12);
  for(const n of nades)add(n.x,n.y,P_NADE,.07,.07,n.z-.035);
  for(const s of smokes){const k=Math.min(1,(14-s.t)*1.5,s.t/2)*1.2;for(const p of s.p)add(s.x+p[0],s.y+p[1],P_PUFF,k,k,p[2]-k/2)}
  for(const s of Object.values(others)){
    if(s.z<.05)continue;                                     // destroyed drone
    if(s.dead)add(s.x,s.y,CORPSE[s.team],.14,.75,0,s);
    else if(s.z<.2)add(s.x,s.y,P_DRONE,.1,.24,0,s);          // a player driving a drone
    else{
      const back=Math.cos(s.av-Math.atan2(cam.y-s.y,cam.x-s.x))<0?1:0,step=s.mv>.4?1+(s.walk*2.5&1):0;
      add(s.x,s.y,OPSPR[s.team][back][step],s.z+.12,(s.z+.12)*SW/SH,0,s);
    }
  }
  drawList.sort((a,b)=>b.d-a.d);
  for(const q of drawList){
    const d=q.d,o=q.o,S=q.S,lh=proj/d,sx=W/2+q.s/d*proj,bot=hor+lh*(cam.z-q.zb),top=bot-lh*q.h,w=lh*q.w,hh=bot-top;
    const tex=S.t[lvl(fogAt(d)*(o&&o.dead?.6:1))],x0=sx-w/2,x1=Math.min(W,x0+w),y1=Math.min(H,bot),fl=o&&o.flash>0&&!o.dead,white=o&&o.hitT>0;
    for(let x=Math.max(0,Math.ceil(x0));x<x1;x++){
      const u=(x-x0)/w*S.w|0;
      for(let y=Math.max(0,Math.ceil(top));y<y1;y++){
        const i=y*W+x;if(depth[i]<d)continue;
        const ti=((y-top)/hh*S.h|0)*S.w+u,c=tex[ti];if(!c)continue;
        px[i]=white?0xffffffff:fl&&S.m[ti]?0xff60f0ff:c;
      }
    }
    if(!o||!o.name||o.dead||(o.y>=FH)!==upMe)continue;
    if(o.team===me.team)labels.push(['▼ '+o.name,sx,top-3,'#9cf']);                               // teammates show through walls
    else if(sensing&&Math.hypot(o.x-me.x,o.y-me.y)<7)labels.push(['♥',sx,(top+bot)/2,'#f44']);            // heartbeat sensor
  }
  for(const p of parts){
    const dx=p.x-cam.x,dy=p.y-cam.y,d=dx*ca+dy*sa;if(d<.1)continue;
    const k=proj/d,sx=W/2+(dy*ca-dx*sa)*k|0,sy=hor+(cam.z-p.z)*k|0,sz=clamp(p.size*k*.02|0,1,6);
    for(let yy=sy;yy<sy+sz;yy++)for(let xx=sx;xx<sx+sz;xx++)if(xx>=0&&xx<W&&yy>=0&&yy<H&&depth[yy*W+xx]>=d-.06)px[yy*W+xx]=p.col;
  }
  for(const p of pings){
    const dx=p.x-cam.x,dy=p.y+shift(p.y)-cam.y,d=dx*ca+dy*sa;
    if(d>.2)labels.push(['◆ '+p.who,W/2+(dy*ca-dx*sa)/d*proj,hor+(cam.z-p.z)*proj/d,'#fd3']);
  }
  const mark=(o,txt,col)=>{                                   // objective markers show through walls
    const sh=shift(o.y),dx=o.x-cam.x,dy=o.y+sh-cam.y,d=dx*ca+dy*sa;
    if(d>.6)labels.push([txt+(sh?sh<0?' △위층':' ▽아래층':'')+' '+(Math.hypot(dx,dy)*2|0)+'m',W/2+(dy*ca-dx*sa)/d*proj,hor+(cam.z-.75)*proj/d,col]);
  };
  if(mode!=='menu'&&phase!=='lobby')defuser?mark(defuser,'◈ 디퓨저','#ff6a5a'):mark(bomb,'◇ 목표','#fff');
  for(const o of Object.values(others)){                       // teammates on the other floor: a marker right above/below them
    const sh=shift(o.y);if(!sh||o.dead||o.team!==me.team)continue;
    const dx=o.x-cam.x,dy=o.y+sh-cam.y,d=dx*ca+dy*sa;
    if(d>.3)labels.push([(sh<0?'△ ':'▽ ')+o.name,W/2+(dy*ca-dx*sa)/d*proj,hor+(sh<0?-.7:.7)*proj/d,'#9cf']);
  }
  ctx.putImageData(img,0,0);

  // ---- overlays ----
  ctx.font='bold 9px sans-serif';ctx.textAlign='center';
  for(const [n,x,y,col] of labels){ctx.fillStyle=col;ctx.fillText(n,x,clamp(y,9,H-2))}
  const playing=mode!=='menu'&&phase!=='lobby';
  if(me.drone&&playing){ctx.fillStyle='rgba(40,255,120,.07)';ctx.fillRect(0,0,W,H)}
  else if(!me.dead&&playing){
    const a=clamp((cfg.fov-fov)/(cfg.fov-(curGun().zoom||.55)),0,1);
    drawGun(me.guns[gun],a);
    if(muzzle>0){ctx.fillStyle='rgba(255,220,150,.06)';ctx.fillRect(0,0,W,H)}
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
  if(fade>0){ctx.fillStyle=`rgba(0,0,0,${Math.min(1,fade*3.5)})`;ctx.fillRect(0,0,W,H)}       // changing floors
  if(me.dead&&playing&&!viewTarget()){ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,W,H)}
  cv.style.transform=`rotate(${me.lean*4}deg) scale(${1+Math.abs(me.lean)*.1})`;
}
