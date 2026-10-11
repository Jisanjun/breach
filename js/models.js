// three.js layer (ES module): animated character models and the first-person weapon, drawn into the same WebGL
// context and depth buffer after the world pass in render.js. If this file or the CDN fails to load, the game still
// runs: render.js falls back to flat sprites and a 2D-drawn gun.
// Characters: Kenney "Blocky Characters" (CC0) — see assets/LICENSE-kenney.txt. The weapons are built here from boxes.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const renderer=new THREE.WebGLRenderer({canvas:glc,context:gl});
renderer.autoClear=false;renderer.setPixelRatio(1);renderer.setSize(W,H,false);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,W/H,.04,90);
const vscene=new THREE.Scene(),vcam=new THREE.PerspectiveCamera(50,W/H,.01,10);   // the weapon has its own scene so walls never clip it
for(const s of [scene,vscene]){
  const sun=new THREE.DirectionalLight(0xffffff,1.7);sun.position.set(.5,1,.3);
  s.add(new THREE.AmbientLight(0xffffff,1.9),sun);
}
const loader=new GLTFLoader(),load=f=>loader.loadAsync('assets/'+f+'.glb');
const CHARS=[['j','h','r'],['d','g','n']];       // character looks per team
const chars={},guns={},inst={};
await Promise.all(CHARS.flat().map(async c=>{chars[c]=await load('character-'+c)}));
// Weapons are built from boxes: plain, dark, unmistakably firearms. About one unit long, muzzle along -z, sights up.
// Each part: material, width, height, length, x, y, z, tilt about x.
const MAT={k:0x1b1c20,g:0x3b3e45,t:0x8d7a52,w:0x5e4026};
for(const k in MAT)MAT[k]=new THREE.MeshStandardMaterial({color:MAT[k],roughness:k==='g'?.45:.85,metalness:k==='g'?.6:.15});
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
for(const k in GUNP){
  const g=guns[k]=new THREE.Group();
  for(const [m,w,h,l,x,y,z,rx] of GUNP[k]){const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),MAT[m]);b.position.set(x,y,z);b.rotation.x=rx||0;g.add(b)}
}

const CLIPS=['idle','walk','sprint','die','holding-both','holding-both-shoot'],SCALE=.62/2.7;   // the model is 2.7 units tall; a standing player .62
function make(o){
  const g=chars[CHARS[o.team][o.id%3]],root=g.scene.clone(true),mixer=new THREE.AnimationMixer(root),act={};
  root.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.color.set(o.team?0xffb680:0x8fb4ff)}});   // team tint
  for(const n of CLIPS)act[n]=mixer.clipAction(THREE.AnimationClip.findByName(g.animations,n));
  act.die.setLoop(THREE.LoopOnce);act.die.clampWhenFinished=true;
  act['holding-both-shoot'].setLoop(THREE.LoopOnce);
  const gun=guns.ar.clone(true);gun.rotation.x=-Math.PI/2;gun.position.set(-.2,-.95,.15);gun.scale.setScalar(1.5);     // muzzle (-z) along the raised arm
  root.getObjectByName('arm-right').add(gun);
  scene.add(root);
  return {root,mixer,act,team:o.team,cur:'',shot:0};
}
function play(i,n){                              // cross-fade the body animation
  if(i.cur===n)return;
  i.act[n].reset().fadeIn(.12).play();
  if(i.cur)i.act[i.cur].fadeOut(.12);
  i.cur=n;
}
const vguns={};let vcur=null;
for(const k in guns){const g=vguns[k]=guns[k].clone(true);g.visible=false;g.scale.setScalar(.42);vscene.add(g)}

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
    i.root.position.set(o.x,floorOf(o.y)+o.h,fold(o.y));i.root.rotation.y=Math.PI/2-o.av;
    i.root.scale.set(SCALE,SCALE*(o.dead?1:(o.z+.12)/.62),SCALE);                   // crouching squashes the model
    play(i,o.dead?'die':o.mv>3.3?'sprint':o.mv>.4?'walk':'idle');
    const hold=i.act['holding-both'];
    if(o.dead)hold.stop();else if(!hold.isRunning())hold.play();
    if(o.flash>0&&!i.shot)i.act['holding-both-shoot'].reset().play();
    i.shot=o.flash>0;
    i.mixer.update(dt);
  }
  for(const id in inst)if(!seen[id]){scene.remove(inst[id].root);delete inst[id]}
  renderer.resetState();renderer.render(scene,camera);
  // first-person weapon: lowered while reloading or busy, raised to the eye when aiming, kicked back by each shot
  const on=!me.dead&&!me.drone&&mode!=='menu'&&phase!=='lobby',k=on?me.guns[gun]:null;
  if(vcur!==k){if(vcur)vguns[vcur].visible=false;if(k)vguns[k].visible=true;vcur=k}
  if(k){
    const a=clamp((cfg.fov-fov)/(cfg.fov-(curGun().zoom||.55)),0,1),busy=reloadT>0||sensing||holdT>0?1:0,g=vguns[k];
    g.position.set(.15*(1-a)+Math.sin(bob)*.005*(1-a),-.13+a*.06-busy*.22+Math.abs(Math.cos(bob))*.004*(1-a)-(meleeT>.25?.04:0),-.42+Math.max(0,fireT)*.3+a*.1);
    g.rotation.set(Math.max(0,fireT)*.9-busy*.6,0,0);              // the kit's muzzles point along -z, the way the camera looks
    renderer.clearDepth();renderer.render(vscene,vcam);
  }
  renderer.resetState();
};
window.modelsReady=1;
