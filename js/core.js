'use strict';
// Shared basics: canvases, saved settings, map data.
// The js/ files are classic scripts sharing one global scope; index.html lists them in load order.
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rnd=(a=1)=>(Math.random()-.5)*a;
const W=480,H=270,TEX=32;
const glc=$('gl'),cv=$('cv'),ctx=cv.getContext('2d');           // gl: the 3D view, cv: the 2D overlay on top (weapon, markers) and the input target

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

// ---------- map: a three-storey house modelled on Siege's House (basement, ground floor with the yard, upper floor) ----------
// Cube cells: # concrete, B brick, R steel, X crate, + invisible edge of the sky.
// Thin walls on the cell's mid-line, written the way they run: - | soft wall, = : barricaded door, ~ ! boarded window.
// Floor: . normal, (space) none — open air, a stairwell or the drop above the driveway, h hatch, >> / << stairs rising east / west.
// 1-4 attacker spawn groups (N, S, W, E), r roaming-bot spot, a-d objective rooms.
//
// The storeys are stored one after another in the same grid: storey f occupies rows f*FH .. f*FH+FH-1, at the same x and
// local y. So a position is (x, y, h) with the storey folded into y, and walls, holes and pathfinding stay per-storey 2D.
// The renderer and the ray tests stack the storeys: height = storey + h, and rays continue through open floors.
const HARD=1,STEEL=2,BRICK=3,CRATE=4,SKYW=5,SOFT=6,DOOR=7,RTHIN=8,WIN=9;   // >=SOFT is thin; SOFT/DOOR/WIN are destructible
const WMID=0xFFFC0;                              // window: only rows 6..19 (the boards) open up; lintel and sill stay
const _d=n=>'.'.repeat(n),_s=n=>' '.repeat(n),_h=n=>'#'.repeat(n),_y=_d(7),_a=_s(7);
const FLOORS=[[                                  // ---- basement: garage (driveway trench to the north), gym, laundry ----
  _h(33),_h(33),_h(33),
  _h(9)+_d(12)+_h(12),
  _h(9)+_d(10)+'>>'+_h(12),
  _h(11)+'======'+_h(16),
  _h(9)+_d(10)+'|'+_d(4)+_h(9),
  _h(9)+_d(10)+'|'+_d(4)+_h(9),
  _h(9)+'....a.....:..r.'+_h(9),
  _h(9)+_d(10)+'|'+_d(4)+_h(9),
  _h(9)+'--=----=--#-=--'+_h(9),
  _h(9)+_d(15)+_h(9),
  _h(9)+_d(13)+'<<'+_h(9),
  _h(9)+'-=-----=--#-=--'+_h(9),
  _h(9)+_d(10)+'|'+_d(4)+_h(9),
  _h(9)+'......r...:....'+_h(9),
  _h(9)+_d(10)+'|'+_d(4)+_h(9),
  _h(33),_h(33),_h(33),_h(33),_h(33),_h(33)],[
  _h(33),                                        // ---- ground floor and the yard ----
  '#'+_d(11)+'1.1.1.1.1'+_d(11)+'#',
  '#'+_d(5)+'X'+_d(19)+'X'+_d(5)+'#',
  '#'+_d(8)+_s(12)+_d(11)+'#',
  '#'+_d(8)+_s(12)+_d(11)+'#',
  '#'+_y+'BB~BBBBB~BBBB~BBB'+_y+'#',
  '#'+_y+'B....|.....|....B'+_y+'#',
  '#'+_y+'!....:.h...|....!'+_y+'#',
  '#.3.....B.h..|..b..:....B.....4.#',
  '#'+_y+'B....|.....|....B'+_y+'#',
  '#.3.....B---=#-=-=-#--=-B.....4.#',
  '#'+_y+'B>>.............B'+_y+'#',
  '#.3.....:.............  B.<<..4.#',
  '#'+_y+'B-=--#-...-#-=--B'+_y+'#',
  '#.3.....B....|.....|....B.....4.#',
  '#'+_y+'!....:.h...|..r.:'+_y+'#',
  '#.3.....B..r.|.....|....B.....4.#',
  '#'+_y+'BB~BBBBB=BBBBB~BB'+_y+'#',
  '#'+_d(31)+'#',
  '#'+_d(5)+'X'+_d(19)+'X'+_d(5)+'#',
  '#'+_d(31)+'#',
  '#'+_d(11)+'2.2.2.2.2'+_d(11)+'#',
  _h(33)],[
  '+'.repeat(33),                                // ---- upper floor: open air around it, a balcony with stairs on the east side ----
  '+'+_s(31)+'+','+'+_s(31)+'+','+'+_s(31)+'+','+'+_s(31)+'+',
  '+'+_a+'BB~BBBBB~BBBBB~BB'+_a+'+',
  '+'+_a+'B....|.....|....B'+_a+'+',
  '+'+_a+'!..r.|.....|....!'+_a+'+',
  '+'+_a+'B....:.ch..|.dh.B'+_a+'+',
  '+'+_a+'B....|.....|....B'+_a+'+',
  '+'+_a+'B--=-#-=---#-=--B'+_a+'+',
  '+'+_a+'B  .............B'+_a+'+',
  '+'+_a+'B...............:.'+_s(6)+'+',
  '+'+_a+'B--=-#--=--#--=-B'+_a+'+',
  '+'+_a+'B....|.....|....B'+_a+'+',
  '+'+_a+'!.h..|..h..:..r.!'+_a+'+',
  '+'+_a+'B....:.....|....B'+_a+'+',
  '+'+_a+'BB~BBBBB~BBBBB~BB'+_a+'+',
  '+'+_s(31)+'+','+'+_s(31)+'+','+'+_s(31)+'+','+'+_s(31)+'+',
  '+'.repeat(33)]];
const MAP=[].concat(...FLOORS),NL=FLOORS.length,FH=FLOORS[0].length;
const MW=MAP[0].length,MH=MAP.length,NC=MW*MH,OFFC=FH*MW;        // OFFC: the same spot one storey up
const ROOMS=[                                    // callouts: storey, x0, y0, x1, y1 (cells, inclusive), name
  [0,9,6,18,9,'차고'],[0,20,6,23,9,'세탁실'],[0,9,11,23,12,'차고 복도'],[0,9,14,18,16,'체육관'],[0,20,14,23,16,'창고'],[0,9,3,20,4,'차고 진입로'],
  [1,9,6,12,9,'주방'],[1,14,6,18,9,'TV방'],[1,20,6,23,9,'음악실'],[1,9,11,23,12,'연결 복도'],[1,9,14,12,16,'거실'],[1,14,14,18,16,'현관'],[1,20,14,23,16,'게임방'],
  [2,9,6,12,9,'분홍 방'],[2,14,6,18,9,'자동차 방'],[2,20,6,23,9,'안방'],[2,9,11,23,12,'2층 복도'],[2,9,14,12,16,'남자아이 방'],[2,14,14,18,16,'독서실'],[2,20,14,23,16,'놀이방'],[2,25,12,25,12,'발코니']];
const FLOORN=['지하','1층','2층'];
const KEY={'#':HARD,R:STEEL,B:BRICK,X:CRATE,'+':SKYW,'-':SOFT,'|':SOFT,'=':DOOR,':':DOOR,'~':WIN,'!':WIN};
const grid=new Uint8Array(NC),orig=new Uint8Array(NC),orient=new Uint8Array(NC),zone=new Uint8Array(NC);
const holeN=new Uint16Array(NC),hatch=new Uint8Array(NC),hatch0=new Uint8Array(NC);      // hatch: 1 shut, 2 reinforced, 3 open
const nofloor=new Uint8Array(NC),softF=new Uint8Array(NC),ramp=new Int8Array(NC),rampB=new Float32Array(NC),link=new Int32Array(NC).fill(-1);
const holes=new Uint32Array(NC*TEX),fholes=new Uint32Array(NC*TEX);   // per cell: TEX columns, each a bitmask of punched-out rows (walls / the floor under the cell)
const spawns=[[],[],[],[]],roamSpots=[],sites=[];
const floorOf=y=>y/FH|0,fold=y=>y%FH;             // which storey a y is on, and y within that storey
const roomAt=(x,y)=>{const f=floorOf(y),l=fold(y)|0,r=ROOMS.find(r=>r[0]===f&&x>=r[1]&&l>=r[2]&&x<r[3]+1&&l<=r[4]);return FLOORN[f]+' '+(r?r[5]:zone[(y|0)*MW+(x|0)]?'':'마당')};
// Feet height above the storey's floor at a spot: 0 except on stairs.
function ground(x,y){const c=(y|0)*MW+(x|0),d=ramp[c];return d?rampB[c]+(d>0?x-(x|0):1-x+(x|0))*.5:0}
let geoDirty=1,maskAll=1;const dirtyM=new Set();  // renderer bookkeeping: rebuild geometry / re-upload every hole mask / these mask slots (floors are NC+cell)
(function parseMap(){
  MAP.forEach((row,y)=>[...row].forEach((ch,x)=>{
    const c=y*MW+x,k='abcd'.indexOf(ch);
    orig[c]=KEY[ch]||0;orient[c]='-=~'.includes(ch)?1:0;      // 1 = wall runs along x
    if(ch>='1'&&ch<='4')spawns[ch-1].push([x+.5,y+.5]);
    if(ch==='r')roamSpots.push([x+.5,y+.5]);
    if(ch==='h')hatch0[c]=1;
    if(ch===' ')nofloor[c]=1;
    if(ch==='>'||ch==='<'){                                    // a flight is two cells; the uphill one starts half-way up and leads onto the storey above
      const d=ramp[c]=ch==='>'?1:-1;
      if(row[x-d]===ch){rampB[c]=.5;link[c]=c+d+OFFC;link[c+d+OFFC]=c}
    }
    if(k>=0)sites[k]={x:x+.5,y:y+.5,cells:[]};
  }));
  for(let c=OFFC;c<NC;c++)softF[c]=!orig[c-OFFC]&&!nofloor[c]&&!ramp[c-OFFC]?1:0;   // floors over a room are timber: bullets go through
  // zone: 0 open to the sky, 1 indoors, 2+k objective room k
  zone.fill(1);
  const fill=(start,v,out)=>{
    const q=[start];zone[start]=v;
    for(let i=0;i<q.length;i++){const c=q[i];if(out)out.push(c);for(const n of [c-1,c+1,c-MW,c+MW])if(!orig[n]&&zone[n]===1){zone[n]=v;q.push(n)}}
  };
  fill(3*MW+9,0);fill(OFFC+MW+1,0);fill(2*OFFC+MW+1,0);        // the driveway trench, the yard, the air around the upper floor
  sites.forEach((s,k)=>fill((s.y|0)*MW+(s.x|0),2+k,s.cells));
})();
function loadMap(){grid.set(orig);holes.fill(0);holeN.fill(0);fholes.fill(0);hatch.set(hatch0);geoDirty=maskAll=1;dirtyM.clear()}
