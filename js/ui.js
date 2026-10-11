'use strict';
// Input, HUD (DOM over the canvas), menus and settings.
const keys={};let trig=0,fresh=0,ads=0,moving=0;
const locked=()=>document.pointerLockElement===cv;
function lockPointer(){const p=cv.requestPointerLock();if(p&&p.catch)p.catch(()=>{})}   // the browser may refuse (e.g. Esc pressed a moment ago); the prompt stays up
const put=(id,t)=>{const e=$(id);if(e._t!==t)e.textContent=e._t=t};
const setW=(id,p)=>{const e=$(id);p=p.toFixed(1)+'%';if(e._w!==p)e.style.width=e._w=p};
const err=t=>{$('err').textContent=t};

// ---------- menus ----------
function showMenu(kind){                         // 'home' | 'lobby' | 'pause' | 0
  $('menu').hidden=!kind;
  for(const k of ['home','lobby','pause'])$(k).hidden=k!==kind;
  if(kind&&document.pointerLockElement)document.exitPointerLock();
}
function banner(t,sub){
  const b=$('banner'),s=document.createElement('small');
  b.textContent=t;s.textContent=sub||'';b.append(s);
  b.classList.remove('show');void b.offsetWidth;b.classList.add('show');   // restart the CSS animation
}
function drawOps(){
  OPS.forEach((list,sd)=>{
    const box=$('ops'+sd);box.textContent='';
    list.forEach((o,i)=>{
      const b=document.createElement('button'),s=document.createElement('small');
      b.className='op'+(cfg.ops[sd]===i?' on':'');b.textContent=o.n;s.textContent=o.d+' · 체력 '+(o.hp||HP[o.cls])+' · 속도 '+'●'.repeat(4-o.cls)+'○'.repeat(o.cls-1);b.append(s);
      b.onclick=()=>pickOp(sd,i);box.append(b);
    });
  });
}
function pickOp(sd,i){
  cfg.ops[sd]=i;saveCfg();drawOps();sfx.ui();
  if(mode!=='menu'&&phase==='prep'&&!me.dead&&sd===side())loadout();     // still in prep: re-equip right away
}
function drawBoard(){
  const b=$('board'),tb=document.createElement('table');b.textContent='';
  const row=(cells,cls)=>{
    const tr=document.createElement('tr');if(cls)tr.className=cls;
    for(const c of cells){const td=document.createElement('td');td.textContent=c;tr.append(td)}
    tb.append(tr);
  };
  row(['','이름','처치','사망'],'hd');
  for(const t of [0,1]){
    row([t===atkTeam?'공격':'방어',['블루','오렌지'][t]+' — '+score[t]+'승','',''],'c'+t);
    for(const p of roster)if(p.team===t){const s=st(p.id);row([(p.id===me.id?me:others[p.id]||{}).dead?'✕':'',p.name+(p.id===me.id?' (나)':''),s.k,s.d])}
  }
  b.append(tb);
}
drawOps();
$('nm').value=cfg.name;$('nm').oninput=e=>{cfg.name=e.target.value.slice(0,12);saveCfg()};
for(const [id,key,lo,hi] of [['sSens','sens',.2,3],['sVol','vol',0,1],['sFov','fov',.6,1.1]]){
  const e=$(id);e.min=lo;e.max=hi;e.step=.01;e.value=cfg[key];
  e.oninput=()=>{cfg[key]=clamp(+e.value,lo,hi);saveCfg();if(master)master.gain.value=cfg.vol};
}
$('bSolo').onclick=()=>{startOffline();lockPointer()};
$('bAlone').onclick=()=>{startOffline(1);lockPointer()};
$('bHost').onclick=host;$('bJoin').onclick=join;
$('bStart').onclick=()=>{$('res').textContent='';startRound();lockPointer()};
$('bTeam').onclick=()=>request({t:'team'});
$('fill').onchange=()=>{fillTo=clamp($('fill').value|0,0,6);if(isHost&&phase==='lobby')syncLobby()};
$('bCopy').onclick=()=>navigator.clipboard.writeText($('link').value).then(()=>{$('bCopy').textContent='복사됨';setTimeout(()=>$('bCopy').textContent='초대 링크 복사',1500)});
$('bResume').onclick=lockPointer;
$('bLeave').onclick=()=>{location.href=location.href.split(/[?#]/)[0]};
if(room){$('bJoin').hidden=false;$('bHost').hidden=true}
if(matchMedia('(pointer:coarse)').matches&&!matchMedia('(pointer:fine)').matches)err('키보드와 마우스가 필요한 PC용 게임입니다');

// ---------- input ----------
function swapGun(i){if(i!==gun&&canAct()){gun=i;reloadT=0;fireT=Math.max(fireT,.25);sfx.ui()}}
addEventListener('keydown',e=>{
  if(!locked())return;
  e.preventDefault();if(e.repeat)return;keys[e.code]=1;
  switch(e.code){
    case 'KeyR':reload();break;
    case 'KeyG':gadget();break;
    case 'KeyV':melee();break;
    case 'KeyT':throwNade();break;
    case 'KeyB':tryBarricade();break;
    case 'KeyZ':doPing();break;
    case 'Digit1':case 'Digit2':swapGun(+e.code[5]-1);break;
    case 'KeyX':swapGun(1-gun);break;
    case 'Space':vault();break;
    case 'Enter':if(isHost&&phase==='prep')phaseEnd=0;break;       // host skips the rest of prep; hostTick announces the phase change
    case 'KeyO':if(phase==='prep'&&!me.dead)pickOp(side(),(cfg.ops[side()]+1)%OPS[side()].length);break;   // switch operator while still in prep
  }
});
addEventListener('keyup',e=>{keys[e.code]=0});
addEventListener('mousemove',e=>{
  if(!locked())return;
  const s=(ads?.0013:.0022)*cfg.sens;me.a+=e.movementX*s;me.pa=clamp(me.pa-e.movementY*s,-1.35,1.35);
});
addEventListener('mousedown',e=>{
  if(!locked())return;
  if(e.button===0)trig=fresh=1;if(e.button===2)ads=1;if(e.button===1){e.preventDefault();doPing()}
});
addEventListener('mouseup',e=>{if(e.button===0)trig=0;if(e.button===2)ads=0});
addEventListener('wheel',e=>{if(locked())swapGun(1-gun)});
addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('pointerlockchange',()=>{
  if(locked())return showMenu(0);
  for(const k in keys)keys[k]=0;trig=ads=0;
  if(mode!=='menu'&&phase!=='lobby'&&$('menu').hidden)showMenu('pause');   // Esc mid-round opens the pause panel
});
cv.onclick=()=>{
  if(me.dead)specI++;
  if(mode!=='menu'&&phase!=='lobby')lockPointer();
};

// ---------- HUD ----------
function hud(){
  const on=mode!=='menu'&&phase!=='lobby',h=$('hud');
  if(h.hidden===on)h.hidden=!on;
  if(!on)return;
  const now=Date.now(),s=Math.max(0,Math.ceil((phaseEnd-now)/1000)),o=op(),g=curGun(),off=me.drone||me.dead;
  put('clock',phase==='end'?'–:––':(s/60|0)+':'+String(s%60).padStart(2,'0'));
  const hot=defuser&&phase==='act'?'hot':'';if($('clock').className!==hot)$('clock').className=hot;
  put('sub',phase==='end'?'':defuser?'디퓨저 작동 중 — '+(isAtk()?'지켜라':'해제하라'):(phase==='prep'?'준비 단계 · ':'')+(isAtk()?'공격':'방어')+' · '+roomAt(cam.x,cam.y));
  const pip=t=>roster.filter(p=>p.team===t).map(p=>(p.id===me.id?me:others[p.id]||{dead:1}).dead?'○':'●').join('');
  put('pip0',pip(0));put('pip1',pip(1));put('sc0',''+score[0]);put('sc1',''+score[1]);
  put('hpNum',me.dead?'':''+Math.max(0,me.hp|0));setW('hpFill',me.dead?0:clamp(me.hp/me.maxHp*100,0,100));
  put('opName',me.dead?'':me.drone?'드론':o.n);
  put('ammo',off?'':reloadT>0?'장전 중':ammo[gun]+' / '+res[gun]);
  put('gunName',off?'':g.n+'  ['+(gun+1)+']');
  put('gads',off?'':'[G] '+o.g+(o.sensor?'':' ×'+me.gad)+'\n[T] '+NADE[o.nade].n+(nades.some(n=>n.mine&&n.k==='c4')?' 기폭':' ×'+me.nn));
  put('note',killT>0?'처치':'');
  let m='',prog=0;const hc=aimHatch();
  if(phase==='end')m='';
  else if(me.dead){const sp=viewTarget();m=(deathMsg?deathMsg+'\n':'')+(sp?'관전: '+sp.name+' (클릭: 다음 팀원)':'다음 라운드 대기')}
  else if(!locked())m='화면을 클릭하면 조작 시작';
  else if(holdT>0){m=isAtk()?'디퓨저 설치 중':'디퓨저 해제 중';prog=holdT/5}
  else if(me.rap){const k=spaceAct().k;m='레펠 — [W/S] 오르내리기 · [A/D] 옆으로'+(k===1?' · [Space] 들어가기':k===2?' · [Space] 줄 풀기':'')}
  else if(phase==='prep')m=(!isAtk()?'준비 — 벽·해치 보강, 구멍 뚫기 가능':me.drone===1?'드론 정찰 중 — 바리케이드 밑으로 통과':'드론 파괴됨 — 교전 대기')+' · [O] 오퍼레이터 변경'+(isHost?' · [Enter] 준비 건너뛰기':'');
  else if(charge>=0)m='[G] 폭약 기폭';
  else if(isAtk()&&!defuser&&inSite(me.x,me.y))m='목표 구역 — [F] 꾹 눌러 디퓨저 설치';
  else if(!isAtk()&&defuser&&near3(me,defuser.x,defuser.y,.2)<1.3)m='[F] 꾹 눌러 디퓨저 해제';
  else if(sensing)m='심박 감지 중';
  else if(hc>=0){                                               // a floor hatch under the crosshair, or overhead
    const st2=hatch[hc],can=me.gad&&!o.sensor&&!o.trap;
    m=st2===3?'':isAtk()?(can&&(st2===1||o.thermal)?'[G] 해치 파괴':st2===2?'보강된 해치 — 용접 폭약 필요':'')+(st2===1?' · [V] 타격 (3번)':''):st2===1?(can?'[G] 해치 보강 · ':'')+'[V] 타격 (3번)':'보강된 해치';
  }
  else if(doorAhead(1)>=0)m='[B] 바리케이드 설치';
  else if(o.trap){const c=doorAhead(0);m=me.gad&&c>=0&&traps[c]===undefined?'[G] 문 함정 설치':''}
  else{
    aim(1.6);const t=grid[hitC],hit=hitC>=0&&t!==HWALL;         // nothing to offer on a solid wall
    if(hit&&me.gad&&!o.sensor)m=o.hammer?(t!==RTHIN?'[G] 해머':''):isAtk()?(t!==RTHIN||o.thermal?'[G] '+o.g:''):t===SOFT?'[G] 벽 보강':'';
    if(hit&&t!==RTHIN)m+=(m?' · ':'')+'[V] 타격';
  }
  if(locked()&&canAct()&&!me.rap&&!me.drone&&!holdT){const k=spaceAct().k;if(k===1||k===3)m+=(m?' · ':'')+(k===1?'[Space] 창문 넘기':'[Space] 레펠')}
  put('prompt',m);setW('progFill',prog*100);if($('prog').hidden!==!prog)$('prog').hidden=!prog;
  const sec=now/1000|0,showB=!!keys.Tab||phase==='end';        // scoreboard: Tab, and between rounds
  if(showB&&(hud.bs!==sec||$('board').hidden)){hud.bs=sec;drawBoard()}
  if($('board').hidden===showB)$('board').hidden=!showB;
  if(hud.fv!==feedV||hud.sec!==sec){                           // kill feed: last few lines, each for 10 s
    hud.fv=feedV;hud.sec=sec;
    const f=$('feed');f.textContent='';
    for(const e of feedL.filter(e=>now-e.t<1e4).slice(-5)){
      const d=document.createElement('div');
      if(e.txt)d.textContent=e.txt;
      else{
        const a=document.createElement('b'),b=document.createElement('b');
        a.textContent=e.a;a.className='c'+e.ta;b.textContent=e.b;b.className='c'+e.tb;d.append(a,e.hs?' ⌖ ':' ▸ ',b);
      }
      f.append(d);
    }
  }
}
