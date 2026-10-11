'use strict';
// Procedural textures and sprites, packed 0xBBGGRR (0 = transparent). The renderer uploads them as texture arrays.
const rgb=(r,g,b)=>clamp(b|0,0,255)<<16|clamp(g|0,0,255)<<8|clamp(r|0,1,255);
function mkTex(fn,w=TEX,h=TEX){const t=new Uint32Array(w*h);for(let v=0;v<h;v++)for(let u=0;u<w;u++)t[v*w+u]=fn(u,v,rnd(16));return t}
const gray=(v,n=0)=>rgb(v+n,v+n,v+n+4);
const brick=(u,v,n)=>v%8===0||(u+(v>>3&1)*8)%16===0?rgb(150,140,130):rgb(150+n,74+n*.6,58+n*.5);
const plank=(u,v,n)=>rgb(160+n,114+n,64+n);

// World textures, one array layer each. Walls use their cell type as the layer.
const L_GRASS=10,L_WOOD=11,L_SITE=12,L_CONC=13,L_CEIL=14,L_STAIR=15,L_HATCH=16,L_HATCHR=17,L_STUD=18;
const TEXL=[];
TEXL[HARD]=mkTex((u,v,n)=>v%16===0||u%16===0?gray(72):(u%16===3||u%16===13)&&(v%16===3||v%16===13)?gray(90):gray(128,n*.7));
TEXL[BRICK]=mkTex(brick);
TEXL[STEEL]=TEXL[RTHIN]=mkTex((u,v,n)=>u%8===4&&v%8===4?rgb(160,160,170):v%16===0||u%16===0?rgb(30,32,38):v<4&&(u+v>>2)%2?rgb(210,170,30):rgb(64+n/2,70+n/2,82+n/2));
TEXL[CRATE]=mkTex((u,v,n)=>u<2||u>29||v<2||v>29||Math.abs(u-v)<2||Math.abs(u+v-31)<2?rgb(96,66,36):rgb(168+n,124+n,72+n));
TEXL[SOFT]=mkTex((u,v,n)=>v>27?rgb(96,80,62):v===27?rgb(60,50,40):rgb(200+n*.6,186+n*.6,156+n*.6));
TEXL[DOOR]=mkTex((u,v,n)=>v%6===0?rgb(58,38,22):(u===3||u===28)&&v%6===3?rgb(40,40,44):plank(u,v,n));
TEXL[WIN]=mkTex((u,v,n)=>v===5||v===20?rgb(120,112,104):v<6||v>19?brick(u,v,n):(v-6)%5===0?rgb(58,38,22):plank(u,v,n));
TEXL[L_GRASS]=mkTex((u,v,n)=>(u*7+v*13)%11===0?rgb(66,90,46):rgb(84+n,106+n,60+n*.5));
TEXL[L_WOOD]=mkTex((u,v,n)=>v%8===0||(u+(v>>3)*11)%32===0?rgb(70,50,34):rgb(128+n,94+n,62+n));
TEXL[L_SITE]=mkTex((u,v,n)=>u<2||v<2?rgb(220,180,30):rgb(150+n,58+n*.4,50+n*.4));          // objective room: red with yellow lines
TEXL[L_CONC]=mkTex((u,v,n)=>u===0||v===0?gray(84):gray(118,n*.6));
TEXL[L_CEIL]=mkTex((u,v,n)=>u===0||v===0?gray(96):u>11&&u<20&&v>13&&v<18?rgb(250,250,235):gray(150,n*.4));   // tiles with a light
TEXL[L_STAIR]=mkTex((u,v,n)=>u%8<2?rgb(40,40,44):v<2||v>29?rgb(230,190,40):rgb(120+n,120+n,126+n));   // treads run across the flight
TEXL[L_HATCH]=mkTex((u,v,n)=>u<2||u>29||v<2||v>29?rgb(60,44,28):u===15||u===16?rgb(70,50,32):rgb(150+n,108+n,62+n));
TEXL[L_HATCHR]=mkTex((u,v,n)=>u<2||u>29||v<2||v>29?rgb(30,32,38):u%8===4&&v%8===4?rgb(160,160,170):rgb(70+n/2,76+n/2,88+n/2));
TEXL[L_STUD]=mkTex((u,v,n)=>rgb(120+n,84+n,48+n));              // timber shown where plaster or flooring next to a stud or joist is gone
TEXL[HWALL]=mkTex((u,v,n)=>v>27?gray(70):v%14===0||(u+(v/14|0)*8)%16===0?gray(120):gray(168,n*.5));   // solid interior wall: painted blockwork, so it never reads as plaster
TEXL[SHIELD]=mkTex((u,v,n)=>v<16||u<2||u>29?rgb(24,26,30):v<22&&u>8&&u<23?rgb(96,128,150):(u%10===5)&&v%6===1?rgb(150,150,158):rgb(58+n/2,64+n/2,74+n/2));   // deployable shield: only the lower part is ever shown
const NTEX=21;

// ---------- sprites (64x64 array layers; the picture sits in the top-left w x h) ----------
const SW=20,SH=36,SPRL=[];
const spr=(t,w,h)=>{const s={t,w,h,layer:SPRL.length};SPRL.push(s);return s};
function mkOp(body,back,step){
  const s=new Uint32Array(SW*SH),box=(u0,v0,u1,v1,c)=>{for(let v=v0;v<=v1;v++)for(let u=u0;u<=u1;u++)s[v*SW+u]=c};
  const dark=rgb(34,36,42),vest=rgb(60,64,72),skin=rgb(214,170,130),boot=rgb(22,22,26),gun=rgb(16,16,16);
  const l=step===1?2:0,r=step===2?2:0;                         // the lifted leg is drawn 2 rows shorter
  box(5,22,9,33-l,dark);box(5,34-l,9,35-l,boot);
  box(10,22,14,33-r,dark);box(10,34-r,14,35-r,boot);
  box(4,9,15,21,vest);box(4,20,15,21,dark);                    // vest, belt
  box(1,9,3,18,body);box(16,9,18,18,body);                     // sleeves
  box(1,19,3,20,skin);box(16,19,18,20,skin);                   // hands
  box(4,9,5,11,body);box(14,9,15,11,body);                     // shoulder patches
  box(6,0,13,4,body);box(6,4,13,4,dark);                       // helmet with rim
  if(back){box(7,5,12,8,body);box(6,11,13,19,dark);box(8,13,11,15,body);box(15,12,19,13,gun)}   // back of the helmet, pack, muzzle poking out
  else{
    box(7,5,12,8,skin);box(7,5,12,6,dark);box(8,5,11,5,rgb(120,200,230));                       // face, goggles
    box(7,12,12,13,body);box(3,14,17,16,gun);box(8,17,10,19,gun);                               // chest stripe, gun, magazine
  }
  return s;
}
const TEAMC=[rgb(45,95,210),rgb(225,120,35)];                  // 0 blue, 1 orange
const OPSPR=TEAMC.map(c=>[0,1].map(b=>[0,1,2].map(s=>spr(mkOp(c,b,s),SW,SH))));     // [team][back][step]
const CORPSE=TEAMC.map(c=>{                                    // the standing sprite laid on its side
  const s=mkOp(c,0,0),t=new Uint32Array(SH*SW);
  for(let v=0;v<SW;v++)for(let u=0;u<SH;u++)t[v*SH+u]=s[u*SW+v];
  return spr(t,SH,SW);
});
const P_DRONE=spr(mkTex((u,v)=>v<4?(u>6&&u<9?rgb(60,255,90):0):u<3||u>12?rgb(20,20,22):rgb(74,76,84),16,10),16,10);
const P_DEFUSER=spr(mkTex((u,v)=>v<3?(u>4&&u<11?rgb(96,96,104):0):u>5&&u<10&&v>4&&v<9?rgb(255,60,40):rgb(52,56,64),16,12),16,12);
const P_BOMB=spr(mkTex((u,v)=>v<2||v>21?rgb(40,40,46):v>15&&(u+v>>1)%4<2?rgb(235,195,30):u>5&&u<10&&v>5&&v<12?rgb(240,240,240):rgb(165,42,36),16,24),16,24);
const P_NADE=spr(mkTex((u,v)=>(u-3.5)**2+(v-3.5)**2<12?(v<2?rgb(150,150,150):rgb(50,72,50)):0,8,8),8,8);
const P_TRAP=spr(mkTex((u,v)=>v<2?(u%4<2?rgb(255,60,40):0):rgb(60,60,66),16,4),16,4);
const P_PUFF=spr(mkTex((u,v,n)=>{const r=(u-7.5)**2+(v-7.5)**2;return r<30||r<60&&(u+v&1)?rgb(170+n,172+n,176+n):0},16,16),16,16);
const P_CHARGE=spr(mkTex((u,v)=>u>5&&u<10&&v<3?rgb(255,40,30):rgb(26,26,28),16,10),16,10);
const P_CAM=spr(mkTex((u,v)=>v<3?(u>5&&u<10?rgb(60,62,68):0):u>10&&u<14&&v>5&&v<9?rgb(255,50,40):rgb(34,36,42),16,12),16,12);   // camera housing with its red light
const P_ROPE=spr(mkTex(()=>rgb(28,24,20),2,2),2,2);
const P_WIRE=spr(mkTex((u,v)=>(u+v)%4===0||(u-v+16)%4===0?rgb(150,150,156):(u%6===0&&v%4===1)?rgb(210,210,214):0,32,8),32,8);
const P_FLASH=spr(mkTex((u,v)=>(u-3.5)**2+(v-3.5)**2<14?rgb(255,230,120):0,8,8),8,8);
// particle colours, as one-colour sprites
const dot=(r,g,b)=>spr(mkTex(()=>rgb(r,g,b),4,4),4,4);
const PLASTER=dot(205,190,160),WOOD=dot(150,105,58),METAL=dot(110,116,128),SPARK=dot(255,220,110),BLOOD=dot(170,20,20),SOOT=dot(24,24,26);
