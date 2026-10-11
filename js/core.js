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

// ---------- map ----------
// Maps are redrawn from Ubisoft's published per-floor blueprints (basement, ground floor with the yard, upper floor); the data is in js/maps.js.
// One cell is 25 px of the 1600x900 blueprint; rooms, walls, stairs, hatches and the timber ("line of sight") floors sit
// where the blueprint has them. The yard around the house is made up.
// Cube cells: # concrete, B brick, R steel, X crate, + invisible edge of the sky.
// Thin walls on the cell's mid-line, written the way they run: - | soft (breakable) wall, H I solid wall, = : barricaded door,
// ~ ! boarded window.
// Floor: . normal (timber when there is a room underneath), , solid floor (tiles, concrete: bullets stop), (space) none —
// open air, a stairwell or the pit of the driveway, h hatch, >> / << stairs rising east / west.
// 1-4 attacker spawn groups (N, S, W, E), r roaming-bot spot, a-d objective rooms.
//
// The storeys are stored one after another in the same grid: storey f occupies rows f*FH .. f*FH+FH-1, at the same x and
// local y. So a position is (x, y, h) with the storey folded into y, and walls, holes and pathfinding stay per-storey 2D.
// The renderer and the ray tests stack the storeys: height = storey + h, and rays continue through open floors.
const HARD=1,STEEL=2,BRICK=3,CRATE=4,SKYW=5,SOFT=6,DOOR=7,RTHIN=8,WIN=9,HWALL=19,SHIELD=20;   // >=SOFT is thin; SOFT/DOOR/WIN are destructible; SHIELD is set down by players
const WMID=0xFFFC0;                              // window: only rows 6..19 (the boards) open up; lintel and sill stay
const MAPID=(m=>MAPS[m]?m:'house')(new URLSearchParams(location.search).get('map')),FLOORS=MAPS[MAPID].floors,ROOMS=MAPS[MAPID].rooms;   // js/maps.js
const MAP=[].concat(...FLOORS),NL=FLOORS.length,FH=FLOORS[0].length;
const MW=MAP[0].length,MH=MAP.length,NC=MW*MH,OFFC=FH*MW;        // OFFC: the same spot one storey up
const FLOORN=['지하','1층','2층'];
const KEY={'#':HARD,R:STEEL,B:BRICK,X:CRATE,'+':SKYW,'-':SOFT,'|':SOFT,'=':DOOR,':':DOOR,'~':WIN,'!':WIN,H:HWALL,I:HWALL};
const PIT=MAPS[MAPID].pit?MAPS[MAPID].pit[1]*MW+MAPS[MAPID].pit[0]:-1;   // a cell of the basement storey under the open sky (House: the driveway)
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
    orig[c]=KEY[ch]||0;orient[c]='-=~H'.includes(ch)?1:0;     // 1 = wall runs along x
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
  for(let c=OFFC;c<NC;c++)softF[c]=!orig[c-OFFC]&&!nofloor[c]&&!ramp[c-OFFC]&&MAP[c/MW|0][c%MW]!==','?1:0;   // floors over a room are timber (bullets go through), unless drawn solid
  // zone: 0 open to the sky, 1 indoors, 2+k objective room k
  zone.fill(1);
  const fill=(start,v,out)=>{
    const q=[start];zone[start]=v;
    for(let i=0;i<q.length;i++){const c=q[i];if(out)out.push(c);for(const n of [c-1,c+1,c-MW,c+MW])if(!orig[n]&&zone[n]===1){zone[n]=v;q.push(n)}}
  };
  if(PIT>=0)fill(PIT,0);
  fill(OFFC+MW+1,0);fill(2*OFFC+MW+1,0);           // the driveway, the yard, the air around the upper floor
  sites.forEach((s,k)=>fill((s.y|0)*MW+(s.x|0),2+k,s.cells));
})();
function loadMap(){grid.set(orig);holes.fill(0);holeN.fill(0);fholes.fill(0);hatch.set(hatch0);geoDirty=maskAll=1;dirtyM.clear()}
