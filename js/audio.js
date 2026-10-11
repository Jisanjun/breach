'use strict';
// All sound is synthesised: filtered noise bursts and sliding tones, placed in stereo by direction.
let ac,master;
function audioInit(){
  if(ac)return;
  ac=new AudioContext();master=ac.createGain();master.gain.value=cfg.vol;
  const comp=ac.createDynamicsCompressor();master.connect(comp);comp.connect(ac.destination);
}
addEventListener('pointerdown',audioInit);
// Route a source to the listener. World sounds (x,y given) fade with distance and pan by bearing.
function out(node,vol,x,y){
  const g=ac.createGain(),p=ac.createStereoPanner();
  if(x!==undefined){
    const dy=fold(y)-fold(cam.y),l=Math.hypot(x-cam.x,dy);     // the other floor is heard right above/below, at half volume
    vol/=(1+l*.22)*((y>=FH)===(cam.y>=FH)?1:2);p.pan.value=Math.sin(Math.atan2(dy,x-cam.x)-cam.a)*Math.min(1,l);
  }
  g.gain.value=vol;node.connect(g);g.connect(p);p.connect(master);return g;
}
function noise(dur,vol,cut,x,y,type){
  if(!ac)return;
  const n=ac.sampleRate*dur|0,b=ac.createBuffer(1,n,ac.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n)**2;
  const s=ac.createBufferSource(),f=ac.createBiquadFilter();
  s.buffer=b;f.type=type||'lowpass';f.frequency.value=cut;s.connect(f);out(f,vol,x,y);s.start();
}
function tone(f0,f1,dur,vol,x,y,type){
  if(!ac)return;
  const o=ac.createOscillator(),t=ac.currentTime,g=out(o,vol,x,y);
  o.type=type||'sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
  g.gain.setValueAtTime(g.gain.value,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.start(t);o.stop(t+dur);
}
const SHOT={ar:[.13,.5,2600,170],smg:[.09,.4,3400,220],sg:[.28,.8,1300,110],dmr:[.2,.7,2000,130],pistol:[.1,.45,3000,200]};   // length, volume, brightness, thump
const sfx={
  shot(k,x,y){const s=SHOT[k]||SHOT.ar;noise(s[0],s[1],s[2],x,y);tone(s[3],40,s[0]*.8,s[1]*.6,x,y)},
  dry(){tone(900,700,.03,.12,undefined,undefined,'square')},
  reload(t){noise(.04,.3,4000,undefined,undefined,'highpass');setTimeout(()=>noise(.06,.35,2500),t*600);setTimeout(()=>tone(500,300,.05,.2,undefined,undefined,'square'),t*900)},
  step(x,y){noise(.07,.3,240,x,y)},
  hit(hs){tone(hs?1900:1100,hs?1500:900,.07,.25,undefined,undefined,'square')},
  kill(){tone(660,660,.09,.25);setTimeout(()=>tone(990,990,.16,.25),90)},
  hurt(){noise(.09,.5,480);tone(140,60,.12,.3)},
  melee(){noise(.08,.4,400)},
  thud(x,y){noise(.16,.6,300,x,y);tone(110,50,.14,.5,x,y)},
  crash(x,y){noise(.4,.7,700,x,y);noise(.25,.4,2500,x,y,'highpass')},
  boom(x,y,big){noise(big?1:.5,big?1.4:.9,big?330:600,x,y);tone(big?90:140,30,big?.5:.25,big?1:.6,x,y)},
  clink(x,y){tone(2400,1800,.04,.18,x,y,'triangle')},
  hiss(x,y){noise(1.6,.5,5000,x,y,'highpass')},
  ring(){tone(4200,4000,2.4,.18)},
  beep(x,y,hi){tone(hi?2600:1900,hi?2600:1900,.07,.4,x,y,'square')},
  place(){tone(700,500,.06,.25,undefined,undefined,'square')},
  steel(x,y){noise(.4,.5,1500,x,y);tone(300,180,.3,.3,x,y,'sawtooth')},
  ping(){tone(1300,1300,.07,.25);setTimeout(()=>tone(1750,1750,.1,.25),80)},
  ui(){tone(880,880,.04,.15)},
  horn(){tone(330,330,.35,.3,undefined,undefined,'sawtooth');tone(495,495,.35,.2,undefined,undefined,'sawtooth')},
  jingle(win){[0,1,2].forEach(i=>setTimeout(()=>tone(win?[523,659,784][i]:[392,330,262][i],win?[523,659,784][i]:[392,330,262][i],.3,.3,undefined,undefined,'triangle'),i*150))},
};
