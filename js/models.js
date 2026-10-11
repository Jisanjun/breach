// three.js layer (ES module): operator bodies and the first-person weapon, drawn into the same WebGL context and depth
// buffer after the world pass in render.js. Everything is built here from boxes, so there are no model files to load.
// If this file or the CDN fails to load, the game still runs: render.js falls back to flat sprites and a 2D-drawn gun.
import * as THREE from 'three';

const renderer=new THREE.WebGLRenderer({canvas:glc,context:gl});
renderer.autoClear=false;renderer.setPixelRatio(1);renderer.setSize(W,H,false);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,W/H,.04,90);
const vscene=new THREE.Scene(),vcam=new THREE.PerspectiveCamera(50,W/H,.01,10);   // the weapon has its own scene so walls never clip it
for(const s of [scene,vscene]){
  const sun=new THREE.DirectionalLight(0xffffff,1.7);sun.position.set(.5,1,.3);
  s.add(new THREE.AmbientLight(0xffffff,1.9),sun);
}
const mat=(c,metal)=>new THREE.MeshStandardMaterial({color:c,roughness:metal?.45:.85,metalness:metal?.6:.12});
const box=(m,w,h,d,x,y,z,rx)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);b.position.set(x,y,z);b.rotation.x=rx||0;return b};

// ---------- weapons: about one unit long, muzzle along -z, sights up ----------
// Each part: material, width, height, length, x, y, z, tilt about x.
const MAT={k:mat(0x1b1c20),g:mat(0x3b3e45,1),t:mat(0x8d7a52),w:mat(0x5e4026)};
const GUNP={
  ar:[['k',.07,.13,.42,0,0,0],['g',.03,.03,.4,0,.02,-.45],['k',.075,.09,.3,0,.01,-.34],['g',.04,.045,.07,0,.02,-.66],['t',.055,.12,.3,0,-.015,.36],
    ['t',.05,.16,.07,0,-.13,.13,.3],['k',.045,.24,.09,0,-.17,-.07,-.2],['k',.03,.05,.2,0,.095,-.02],['k',.02,.07,.02,0,.08,-.5]],
  smg:[['k',.07,.12,.36,0,0,0],['g',.03,.03,.16,0,.02,-.26],['k',.07,.08,.14,0,0,-.22],['k',.05,.03,.26,0,.03,.3],['k',.05,.1,.03,0,-.02,.43],
    ['k',.05,.15,.07,0,-.13,.1,.25],['k',.04,.26,.06,0,-.19,-.06],['k',.025,.04,.12,0,.08,-.04]],
  sg:[['k',.07,.11,.4,0,0,.02],['g',.035,.035,.5,0,.025,-.42],['g',.035,.035,.42,0,-.02,-.38],['w',.075,.07,.22,0,-.02,-.33],['w',.055,.12,.32,0,-.03,.38],
    ['w',.05,.13,.07,0,-.11,.17,.45],['k',.02,.03,.02,0,.06,-.64]],
  dmr:[['k',.07,.13,.46,0,0,0],['g',.03,.03,.5,0,.02,-.5],['k',.07,.085,.28,0,.01,-.36],['g',.045,.045,.1,0,.02,-.76],['k',.055,.13,.32,0,-.02,.39],
    ['k',.05,.16,.07,0,-.13,.13,.3],['k',.05,.18,.1,0,-.14,-.07],['g',.055,.055,.3,0,.12,-.04],['k',.03,.04,.06,0,.085,-.14],['k',.03,.04,.06,0,.085,.06]],
  pistol:[['g',.05,.07,.3,0,.02,-.05],['k',.048,.05,.26,0,-.03,-.04],['k',.046,.19,.085,0,-.13,.07,.22],['k',.01,.02,.015,0,.063,-.18]]};
GUNP.shield=GUNP.pistol;
const guns={},vguns={},inst={};
for(const k in GUNP){
  const g=guns[k]=new THREE.Group();
  for(const [m,...p] of GUNP[k])g.add(box(MAT[m],...p));
  const v=vguns[k]=g.clone(true);v.visible=false;v.scale.setScalar(.42);vscene.add(v);
}

// ---------- operators: 1.8 units tall, facing +z; fatigues, plate carrier and helmet band in the team's colour ----------
const SKIN=mat(0xc9a27e),DARK=mat(0x22252a),FAT=[mat(0x364050),mat(0x4b4234)],TEAM=[mat(0x3f74e0),mat(0xe68a2c)],SCALE=.62/1.8;
function make(o){
  const root=new THREE.Group(),body=new THREE.Group(),t=o.team;
  const leg=s=>{const g=new THREE.Group();g.position.set(s*.11,.82,0);g.add(box(FAT[t],.17,.82,.2,0,-.41,0),box(DARK,.18,.12,.27,0,-.76,.03));body.add(g);return g};
  const L=leg(-1),R=leg(1),gun=guns.ar.clone(true);
  body.add(box(FAT[t],.44,.56,.24,0,1.1,0),box(TEAM[t],.47,.4,.29,0,1.14,0),box(DARK,.3,.13,.3,0,.87,0),box(DARK,.2,.16,.09,0,1.12,.19),   // torso, carrier, belt, pouches
    box(SKIN,.2,.2,.2,0,1.52,0),box(DARK,.25,.15,.27,0,1.62,-.01),box(TEAM[t],.26,.04,.28,0,1.57,-.01),box(DARK,.21,.07,.04,0,1.53,.11),   // head, helmet, band, goggles
    box(FAT[t],.11,.11,.4,-.25,1.25,.2),box(FAT[t],.11,.11,.52,.2,1.21,.26));                                                              // arms out to the rifle
  gun.rotation.y=Math.PI;gun.position.set(-.06,1.24,.5);gun.scale.setScalar(1.05);body.add(gun);
  root.add(body);scene.add(root);
  return {root,body,L,R,team:t,down:0};
}

window.drawModels=dt=>{
  const ey=floorOf(cam.y)+cam.z,ez=fold(cam.y),cp=Math.cos(cam.pa),spec=viewTarget(),seen={};
  camera.fov=2*Math.atan(fov*H/W)*180/Math.PI;camera.updateProjectionMatrix();
  camera.position.set(cam.x,ey,ez);camera.lookAt(cam.x+Math.cos(cam.a)*cp,ey+Math.sin(cam.pa),ez+Math.sin(cam.a)*cp);
  for(const o of Object.values(others)){
    if(o.z<.2||o===spec)continue;                // drones stay sprites; no body around the eye I'm watching through
    let i=inst[o.id];
    if(i&&i.team!==o.team){scene.remove(i.root);i=null}
    if(!i)i=inst[o.id]=make(o);
    seen[o.id]=1;
    i.root.position.set(o.x,floorOf(o.y)+o.h,fold(o.y));i.root.rotation.y=Math.PI/2-o.av;i.root.scale.setScalar(SCALE);
    i.down=clamp(i.down+(o.dead?dt:-dt)*4,0,1);                       // falls onto the back, gets up at the next round
    i.body.rotation.x=-i.down*Math.PI/2;i.body.position.y=i.down*.14;
    i.body.scale.y=o.dead?1:(o.z+.12)/.62;                            // crouching squashes the figure
    const sw=o.dead?0:Math.sin(o.walk*4.5)*Math.min(.85,o.mv*.26);    // stride with speed
    i.L.rotation.x=sw;i.R.rotation.x=-sw;
  }
  for(const id in inst)if(!seen[id]){scene.remove(inst[id].root);delete inst[id]}
  renderer.resetState();renderer.render(scene,camera);
  // first-person weapon: lowered while reloading or busy, raised to the eye when aiming, kicked back by each shot
  const on=!me.dead&&!me.drone&&!(me.cv>=0)&&mode!=='menu'&&phase!=='lobby',k=on?me.guns[gun]:null;
  for(const n in vguns)vguns[n].visible=n===k;
  if(k){
    const a=clamp((cfg.fov-fov)/(cfg.fov-(curGun().zoom||.55)),0,1),busy=reloadT>0||sensing||holdT>0?1:0,g=vguns[k];
    g.position.set(.15*(1-a)+Math.sin(bob)*.005*(1-a),-.13+a*.06-busy*.22+Math.abs(Math.cos(bob))*.004*(1-a)-(meleeT>.25?.04:0),-.42+Math.max(0,fireT)*.3+a*.1);
    g.rotation.set(Math.max(0,fireT)*.9-busy*.6,0,0);
    renderer.clearDepth();renderer.render(vscene,vcam);
  }
  renderer.resetState();
};
window.modelsReady=1;
