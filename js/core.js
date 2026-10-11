'use strict';
// Shared basics: canvas, saved settings, map data.
// The js/ files are classic scripts sharing one global scope; index.html lists them in load order.
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a=1)=>(Math.random()-.5)*a;
const W=480,H=270,TEX=32;
const cv=$('cv'),ctx=cv.getContext('2d'),img=ctx.createImageData(W,H),px=new Uint32Array(img.data.buffer),depth=new Float32Array(W*H);

// ---------- settings (localStorage is a trust boundary: take only well-typed values) ----------
const cfg={name:'',sens:1,vol:.7,fov:.85,ops:[0,0]};
try{
  const s=JSON.parse(localStorage.getItem('breach')||'{}');
  if(typeof s.name==='string')cfg.name=s.name.slice(0,12);
  for(const k of ['sens','vol','fov'])if(typeof s[k]==='number'&&isFinite(s[k]))cfg[k]=s[k];
  if(Array.isArray(s.ops))cfg.ops=[s.ops[0]|0,s.ops[1]|0];
}catch(e){}
cfg.sens=clamp(cfg.sens,.2,3);cfg.vol=clamp(cfg.vol,0,1);cfg.fov=clamp(cfg.fov,.6,1.1);
const saveCfg=()=>{try{localStorage.setItem('breach',JSON.stringify(cfg))}catch(e){}};

// ---------- map ----------
// Cube cells: # concrete, B brick (exterior), R steel, X crate.
// Thin walls on the cell's mid-line, written the way they run: - | soft wall, = : barricaded door, ~ ! boarded window.
// 1-4 attacker spawn groups (N, S, W, E), r roaming-bot spot, a/b/c objective rooms, s stairs, h floor hatch.
//
// Two storeys are laid out one below the other in the same grid: rows 0..FH-1 are the ground floor, rows FH.. the
// upper floor, drawn at the same x and y+FH. Nothing can see or shoot between them (solid rows in between); stairs
// and open hatches move you by exactly FH rows. So the whole engine stays 2D.
const HARD=1,STEEL=2,BRICK=3,CRATE=4,SOFT=5,DOOR=6,RTHIN=7,WIN=8;   // >=SOFT is thin; SOFT/DOOR/WIN are destructible
const WMID=0xFFFC0;                              // window: only rows 6..19 (the boards) open up; lintel and sill stay
const _d=n=>'.'.repeat(n),_e='#'+_d(39)+'#',_y=_d(7),_b='B'.repeat(8),_B='B'.repeat(41);
const MAP=['#'.repeat(41),                        // ---- ground floor ----
  _e,
  '#'+_d(15)+'1.1.1.1.1'+_d(15)+'#',
  '#'+_d(11)+'X'+_d(15)+'X'+_d(11)+'#',
  _e,
  _e,
  '#'+_y+'BBB~BBBBB=BBBB~B~BBBB~BBB'+_y+'#',
  '#'+_y+'B.....|.....R.....|.....B'+_y+'#',
  '#'+_y+'!.....|.....R..r..:..a..B'+_y+'#',
  '#.3.....B..r..:.....|.....|.....!.....4.#',
  '#....X..B.....|....X|X....|....XB'+_y+'#',
  '#.3.....B--=--#-=---#---=-#--=--B..X..4.#',
  '#'+_y+'Bs....|........X..|.....B'+_y+'#',
  '#.3.....:.........X.......:.....:.....4.#',
  '#'+_y+'B.....|......r....|....sB'+_y+'#',
  '#.3.....B-=---#---=-#-=---#---=-B..X..4.#',
  '#....X..B.....|X....|.....R.....B'+_y+'#',
  '#.3.....B..b..|.....:.....R.....!.....4.#',
  '#'+_y+'!.....|.....|.....|..r..B'+_y+'#',
  '#'+_y+'B....X|.....|.....|X....B'+_y+'#',
  '#'+_y+'BBB~BBBB~B~BBBB=BBBBB~BBB'+_y+'#',
  _e,
  '#'+_d(13)+'X'+_d(12)+'X'+_d(12)+'#',
  _e,
  '#'+_d(15)+'2.2.2.2.2'+_d(15)+'#',
  _e,
  '#'.repeat(41),
  _B,_B,_B,_B,_B,_B,                             // ---- upper floor (same footprint, no outdoors) ----
  _b+'BBBBBBBBBBBBBBBBBBBBBBBBB'+_b,
  _b+'B.....|...........|..r..B'+_b,
  _b+'B..h..|...........:.....B'+_b,
  _b+'B.....:...h..c..h.|..h..B'+_b,
  _b+'B.....|...........|.....B'+_b,
  _b+'B--=--#-=-------=-#--=--B'+_b,
  _b+'Bs....|...........|.....B'+_b,
  _b+'B.................:.....B'+_b,
  _b+'B.....|...........|....sB'+_b,
  _b+'B-=---#---=-#-=---#---=-B'+_b,
  _b+'B..r..|.....|.....|.....B'+_b,
  _b+'B.....:.....|.....:.....B'+_b,
  _b+'B..h..|..h..|.....|..h..B'+_b,
  _b+'B.....|.....|.....|.....B'+_b,
  _b+'BBBBBBBBBBBBBBBBBBBBBBBBB'+_b,
  _B,_B,_B,_B,_B,_B];
const MW=MAP[0].length,MH=MAP.length,NC=MW*MH,FH=MH/2,OFFC=FH*MW;      // FH rows per floor, OFFC = the same spot one floor up
const KEY={'#':HARD,R:STEEL,B:BRICK,X:CRATE,'-':SOFT,'|':SOFT,'=':DOOR,':':DOOR,'~':WIN,'!':WIN};
const grid=new Uint8Array(NC),orig=new Uint8Array(NC),orient=new Uint8Array(NC),zone=new Uint8Array(NC);
const holeN=new Uint16Array(NC),stair=new Uint8Array(NC),hatch=new Uint8Array(NC),hatch0=new Uint8Array(NC);   // hatch: 1 shut, 2 reinforced, 3 open
const holes=new Uint32Array(NC*TEX);             // per cell: TEX columns, each a bitmask of punched-out rows
const spawns=[[],[],[],[]],roamSpots=[],sites=[];
const fold=y=>y>=FH?y-FH:y;                       // y as if on the ground floor: for distances and markers across floors
(function parseMap(){
  MAP.forEach((row,y)=>[...row].forEach((ch,x)=>{
    const c=y*MW+x,k='abc'.indexOf(ch);
    orig[c]=KEY[ch]||0;orient[c]='-=~'.includes(ch)?1:0;      // 1 = wall runs along x
    if(ch>='1'&&ch<='4')spawns[ch-1].push([x+.5,y+.5]);
    if(ch==='r')roamSpots.push([x+.5,y+.5]);
    if(ch==='s')stair[c]=1;
    if(ch==='h')hatch0[c]=1;
    if(k>=0)sites[k]={x:x+.5,y:y+.5,cells:[]};
  }));
  // zone: 0 outdoors (reachable from the yard), 1 indoors, 2+k objective room k
  zone.fill(1);
  const fill=(start,v,out)=>{
    const q=[start];zone[start]=v;
    for(let i=0;i<q.length;i++){const c=q[i];if(out)out.push(c);for(const n of [c-1,c+1,c-MW,c+MW])if(!orig[n]&&zone[n]===1){zone[n]=v;q.push(n)}}
  };
  fill(MW+1,0);
  sites.forEach((s,k)=>fill((s.y|0)*MW+(s.x|0),2+k,s.cells));
})();
function loadMap(){grid.set(orig);holes.fill(0);holeN.fill(0);hatch.set(hatch0)}
