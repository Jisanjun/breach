'use strict';
// Multiplayer: star topology over WebRTC. The host's browser relays events, referees rounds and the objective,
// and plays the bots. Solo practice is the same code with no peers connected.
// ponytail: signalling and TURN relay are PeerJS's free public servers — best effort, no uptime promise.
// Upgrade path: own PeerServer + TURN (pass {host,config} to new Peer), or swap this file for a WebSocket relay.
const ROOM='breach-fps-',room=new URLSearchParams(location.search).get('room');
const EV=['h','x','rf','b','d','k','f','g','ge','bd','tp','tr','p','hx','hr','hm'];   // game events a client may send; the host relays them
const REQ=['pl','df','team'];                    // requests only the host decides on
const BOTN=[['알파','브라보','찰리','델타','에코'],['폭스','골프','호텔','인디아','줄리엣']];
let peer,hostConn,isHost=0,roster=[],nextId=1,roundSize=[0,0];
const conns={},snap={},seen={};
const myName=()=>(cfg.name.trim()||'플레이어'+(Math.random()*900+100|0)).slice(0,12);
const nameOf=id=>id===me.id?me.name:others[id]?others[id].name:'?';
// Everything arriving from a peer is checked before use.
const num=v=>typeof v==='number'&&isFinite(v);
const okCell=c=>Number.isInteger(c)&&c>=0&&c<NC;
const inMap=(x,y)=>num(x)&&num(y)&&x>=1&&y>=1&&x<MW-1&&y<MH-1;
const okState=v=>Array.isArray(v)&&v.length===4&&v.every(num);
function send(m){                                // my game event -> everyone else
  if(mode!=='mp')return;
  m.id=me.id;
  if(isHost)relay(m,me.id);else if(hostConn&&hostConn.open)hostConn.send(m);
}
const request=m=>isHost?hostReq(m,me.id):hostConn&&hostConn.open&&hostConn.send(m);
function relay(m,from){for(const id in conns)if(+id!==from&&conns[id].open)conns[id].send(m)}
function toAll(m){relay(m,-1);onNet(m)}          // host announcement, applied locally too
function applyState(id,v){
  const o=others[id],now=Date.now();if(!o||!okState(v))return;
  if(!o.dead&&v[3]>.4&&now-o.stepT>330&&Math.hypot(v[0]-o.tx,v[1]-o.ty)>.13){o.stepT=now;sfx.step(v[0],v[1])}   // footsteps: standing and walking or faster
  o.tx=v[0];o.ty=v[1];o.a=v[2];o.z=clamp(v[3],0,.5);
}
function onNet(m){
  if(!m||typeof m!=='object')return;
  const c=m.c,o=others[m.id];
  switch(m.t){
    case 'h':if(okCell(c))punch(c,m.u|0,m.v|0,Math.min(6,m.r|0));break;
    case 'x':if(okCell(c))destroy(c);break;
    case 'b':if(okCell(c))explode(c,0,m.th);break;
    case 'rf':if(okCell(c))reinforce(c);break;
    case 'bd':if(okCell(c))barricade(c);break;
    case 'hx':if(okCell(c))openHatch(c);break;
    case 'hm':if(okCell(c))hitHatch(c);break;
    case 'hr':if(okCell(c)&&hatch[c]===1){hatch[c]=2;sfx.steel(c%MW+.5,(c/MW|0)+.5)}break;
    case 'tp':if(okCell(c)&&o&&orig[c]===DOOR)traps[c]=o.team;break;
    case 'tr':if(okCell(c))trapBoom(c);break;
    case 'p':if(o&&o.team===me.team&&inMap(m.x,m.y)&&num(m.z))addPing(m.x,m.y,clamp(m.z,0,1),o.name);break;
    case 'g':
      if(o&&NADE[m.k]&&inMap(m.x,m.y)&&[m.z,m.vx,m.vy,m.vz].every(num))
        nades.push({k:m.k,x:m.x,y:m.y,z:clamp(m.z,.05,.95),vx:clamp(m.vx,-9,9),vy:clamp(m.vy,-9,9),vz:clamp(m.vz,-9,9),fuse:NADE[m.k].fuse,own:m.id});
      break;
    case 'ge':
      if(o&&NADE[m.k]&&inMap(m.x,m.y)&&num(m.z)){
        const i=nades.findIndex(n=>n.own===m.id&&n.k===m.k);if(i>=0)nades.splice(i,1);
        nadeBoom(m.k,m.x,m.y,m.z,okCell(m.c)?m.c:-1,o);
      }
      break;
    case 'd':                                     // someone's shot landed: on me, or (host) on one of the bots
      if(!o)break;
      if(m.to===me.id)hurt(clamp(+m.dmg||0,0,999),o.name,o,m.hs);
      else if(isHost&&others[m.to]&&others[m.to].bot)botHurt(others[m.to],clamp(+m.dmg||0,0,999),o,m.hs);
      break;
    case 'k':
      if(o){
        const kt=m.bi===me.id?me.team:others[m.bi]?others[m.bi].team:-1;
        o.dead=1;st(m.id).d++;if(kt>=0&&m.bi!==m.id)st(m.bi).k++;
        feed({a:String(m.by).slice(0,12),ta:kt,b:o.name,tb:o.team,hs:m.hs});
        if(m.bi===me.id){killT=1.4;sfx.kill()}
      }
      break;
    case 'f':if(o){o.flash=.08;sfx.shot(m.g,o.x,o.y);noiseAt(o.x,o.y,14,o.team)}break;
    case 'S':for(const id in m.p)if(+id!==me.id)applyState(id,m.p[id]);break;
    case 'hi':me.id=m.id;break;
    case 'full':err('방이 가득 찼습니다 (최대 10명)');break;
    case 'lobby':
      roster=m.roster;score=m.score;
      for(const p of roster){
        if(p.id===me.id){me.team=p.team;me.name=p.name;continue}
        const q=others[p.id]||(others[p.id]={id:p.id,x:0,y:0,tx:0,ty:0,a:0,av:0,z:.5,dead:1,flash:0,stepT:0,walk:0,mv:0});
        q.name=p.name;q.team=p.team;q.bot=p.bot?1:0;
      }
      for(const id in others)if(!roster.some(p=>p.id===+id))delete others[id];
      drawLobby();break;
    case 'round':
      newRound(clamp(m.site|0,0,sites.length-1),clamp(m.grp|0,0,3));
      atkTeam=m.atk;actDur=m.act;phase='prep';phaseEnd=Date.now()+m.prep*1e3;feedL.length=0;feedV++;
      if(m.n===1)for(const k in stats)delete stats[k];
      me.dead=1;me.drone=0;for(const id in others)others[id].dead=1;
      for(const [id,slot] of m.sp){
        const p=id===me.id?me:others[id];if(!p)continue;
        const s=p.team===atkTeam?atkSpawn(slot):defSpawn(slot);
        p.x=p.tx=s[0];p.y=p.ty=s[1];p.dead=0;
        if(isHost&&p.bot)initBot(p,slot);
      }
      if(!me.dead)resetMe();
      showMenu(0);banner('라운드 '+m.n,(isAtk()?'공격 — 드론으로 정찰':'방어 — 벽을 보강하고 자리 잡기')+(site===2?' · 목표는 2층':''));sfx.horn();break;
    case 'phase':
      phase='act';phaseEnd=Date.now()+actDur*1e3;
      if(me.drone){me.drone=0;me.x=me.sx;me.y=me.sy;me.z=.5;me.pitch=0;me.onStair=0;me.a=Math.atan2(sites[site].y-me.y,sites[site].x-me.x)}   // back from the drone to the body
      banner('교전 개시',isAtk()?'디퓨저 설치 또는 전원 제압':'목표를 지켜라');sfx.horn();break;
    case 'planted':
      defuser={x:+m.x,y:+m.y,S:P_DEFUSER,h:.16,w:.26,flash:0};phaseEnd=Date.now()+35e3;
      feed({txt:String(m.by).slice(0,12)+' 디퓨저 설치'});sfx.beep(defuser.x,defuser.y,1);
      for(const b of hostBots())b.alert=1;
      break;
    case 'end':
      phase='end';phaseEnd=Date.now()+6e3;score=m.score;msg=['블루','오렌지'][m.win]+' 팀 승리 — '+m.why;
      banner(m.win===me.team?'라운드 승리':'라운드 패배',m.why);sfx.jingle(m.win===me.team);break;
    case 'match':
      phase='lobby';score=[0,0];msg='';$('res').textContent=['블루','오렌지'][m.win]+' 팀 매치 승리!';showMenu('lobby');break;
    case 'sync':                                  // joined mid-round: take the host's world and watch until the next round
      if(isHost)break;
      newRound(clamp(m.site|0,0,sites.length-1),clamp(m.grp|0,0,3));
      if(Array.isArray(m.g)&&m.g.length===NC)for(let i=0;i<NC;i++)grid[i]=clamp(m.g[i]|0,0,WIN);
      for(const k in m.h||{}){
        const q=+k,a=m.h[k];
        if(okCell(q)&&Array.isArray(a)&&a.length===TEX){for(let u=0;u<TEX;u++)holes[q*TEX+u]=a[u]>>>0;holeN[q]=clamp(m.n&&m.n[k]|0,0,9999)}
      }
      for(const k in m.tr||{})if(okCell(+k))traps[+k]=m.tr[k]|0;
      for(const k in m.hs||{})if(okCell(+k))hatch[+k]=clamp(m.hs[k]|0,0,3);
      atkTeam=m.atk;actDur=m.act;phase=m.phase;phaseEnd=Date.now()+(+m.rem||0);score=m.score;
      if(m.def)defuser={x:+m.def[0],y:+m.def[1],S:P_DEFUSER,h:.16,w:.26,flash:0};
      for(const id of m.alive||[])if(others[id])others[id].dead=0;
      me.dead=1;showMenu(0);break;
  }
}
// Host-side referee for objective and lobby requests.
function hostReq(m,id){
  const p=id===me.id?me:others[id];if(!p)return;
  if(m.t==='team'){
    const r=roster.find(q=>q.id===id);
    if(phase==='lobby'&&r&&roster.filter(q=>q.team!==r.team&&!q.bot).length<5){r.team^=1;syncLobby()}
    return;
  }
  if(p.dead||phase!=='act')return;
  if(m.t==='pl'&&!defuser&&p.team===atkTeam&&inMap(m.x,m.y)&&inSite(m.x,m.y))toAll({t:'planted',x:m.x,y:m.y,by:nameOf(id)});
  if(m.t==='df'&&defuser&&p.team!==atkTeam)endMP(1-atkTeam,'디퓨저 해제');
}
function fillBots(){                             // top each team up to fillTo with bots (ids 100+team*10+n); humans push bots out
  roster=roster.filter(p=>!p.bot);
  for(const t of [0,1])for(let n=roster.filter(p=>p.team===t).length,i=0;n<fillTo;n++,i++)roster.push({id:100+t*10+i,name:BOTN[t][i],team:t,bot:1});
  for(const id in snap)if(!roster.some(p=>p.id===+id))delete snap[id];
}
function syncLobby(){
  if(phase==='lobby'||phase==='end')fillBots();  // never mid-round: that would pull live bots out of the fight
  toAll({t:'lobby',roster,score});
}
function syncMsg(){
  const h={},n={},hs={};
  for(let c=0;c<NC;c++){
    if(holeN[c]&&grid[c]){h[c]=Array.from(holes.subarray(c*TEX,c*TEX+TEX));n[c]=holeN[c]}
    if(hatch[c])hs[c]=hatch[c];
  }
  return {t:'sync',site,grp:spawnGrp,g:Array.from(grid),h,n,hs,tr:traps,atk:atkTeam,act:actDur,phase,rem:phaseEnd-Date.now(),score,
    def:defuser&&[defuser.x,defuser.y],alive:roster.filter(p=>!(p.id===me.id?me:others[p.id]).dead).map(p=>p.id)};
}
function drop(id){
  const c=conns[id];if(!c)return;
  delete conns[id];delete snap[id];delete seen[id];c.close();
  roster=roster.filter(p=>p.id!==id);syncLobby();
}
function onConn(c){
  c.on('data',m=>{
    if(!m||typeof m!=='object')return;
    if(c.pid===undefined){
      if(m.t!=='join')return;
      if(roster.filter(p=>!p.bot).length>=10)return c.send({t:'full'});
      const id=c.pid=nextId++,n=t=>roster.filter(p=>p.team===t&&!p.bot).length;
      conns[id]=c;seen[id]=Date.now();
      roster.push({id,name:String(m.name||'팬'+id).slice(0,12),team:n(0)<=n(1)?0:1});
      c.send({t:'hi',id});syncLobby();
      if(phase!=='lobby')c.send(syncMsg());
    }else if(m.t==='s'){if(okState(m.v)){seen[c.pid]=Date.now();snap[c.pid]=m.v;applyState(c.pid,m.v)}}
    else if(EV.includes(m.t)){m.id=c.pid;relay(m,c.pid);onNet(m)}
    else if(REQ.includes(m.t))hostReq(m,c.pid);
  });
  c.on('close',()=>drop(c.pid));
}
function host(){
  if(!window.Peer)return err('멀티플레이 라이브러리 로드 실패 — 인터넷 연결 확인');
  const code=Math.random().toString(36).slice(2,7);
  $('bHost').disabled=true;err('방 만드는 중…');peer=new Peer(ROOM+code);
  peer.on('error',e=>{err('연결 오류: '+e.type);$('bHost').disabled=false});
  peer.on('connection',onConn);
  peer.on('open',()=>{
    isHost=1;mode='mp';me.id=0;me.name=myName();
    $('link').value=location.href.split(/[?#]/)[0]+'?room='+code;
    roster=[{id:0,name:me.name,team:0}];err('');syncLobby();showMenu('lobby');
  });
}
function join(){
  if(!window.Peer)return err('멀티플레이 라이브러리 로드 실패 — 인터넷 연결 확인');
  $('bJoin').disabled=true;err('방에 접속 중…');peer=new Peer();
  peer.on('error',e=>{err(e.type==='peer-unavailable'?'방을 찾을 수 없습니다 (호스트가 나갔거나 링크 오류)':'연결 오류: '+e.type);$('bJoin').disabled=false});
  peer.on('open',()=>{
    hostConn=peer.connect(ROOM+room,{reliable:true,serialization:'json'});
    hostConn.on('open',()=>{mode='mp';me.name=myName();$('link').value=location.href;err('');showMenu('lobby');hostConn.send({t:'join',name:me.name})});
    hostConn.on('data',onNet);
    hostConn.on('close',()=>{phase='lobby';showMenu('lobby');err('호스트와 연결이 끊겼습니다 — 새로고침하세요')});
  });
}
function startRound(){
  syncLobby();                                   // settle the bots first, so everyone knows who is in this round
  const slot=[0,0];roundSize=[0,0];
  const sp=roster.map(p=>(roundSize[p.team]++,[p.id,slot[p.team]++]));
  toAll({t:'round',n:score[0]+score[1]+1,atk:atkTeam,sp,prep:offline?12:30,act:180,site:Math.random()*sites.length|0,grp:Math.random()*4|0});
}
function endMP(win,why){if(phase!=='act')return;score[win]++;toAll({t:'end',win,why,score})}
function hostTick(){
  const now=Date.now(),def=1-atkTeam,alive=t=>roster.filter(p=>p.team===t&&!(p.id===me.id?me:others[p.id]).dead).length;
  for(const id in seen)if(now-seen[id]>15e3)drop(+id);          // ghost players (tab closed without a clean close)
  if(phase==='prep'&&now>phaseEnd)toAll({t:'phase'});
  else if(phase==='act'){
    if(roundSize[def]&&!alive(def))endMP(atkTeam,'방어팀 전멸');
    else if(defuser){if(now>phaseEnd)endMP(atkTeam,'디퓨저 작동 완료')}     // once planted, only a disable or the timer ends it
    else if(roundSize[atkTeam]&&!alive(atkTeam))endMP(def,'공격팀 전멸');
    else if(now>phaseEnd)endMP(def,'시간 종료');
  }else if(phase==='end'&&now>phaseEnd){
    if(Math.max(...score)>=4){toAll({t:'match',win:score[0]>score[1]?0:1});syncLobby()}   // first to 4 rounds
    else{atkTeam=def;startRound()}                                                        // swap sides every round
  }
}
setInterval(()=>{                                // 15 Hz net tick (timers survive background tabs)
  if(mode!=='mp')return;
  const r2=n=>+n.toFixed(2),v=[me.x,me.y,me.a,me.drone===2?0:me.z].map(r2);
  if(!me.drone&&!me.dead){v[0]=r2(cam.x);v[1]=r2(cam.y)}         // leaning moves what others can hit
  if(isHost){
    snap[0]=v;for(const b of Object.values(others))if(b.bot)snap[b.id]=[b.x,b.y,b.a,b.z].map(r2);
    relay({t:'S',p:snap},-1);hostTick();
  }else if(hostConn&&hostConn.open)hostConn.send({t:'s',v});
},66);
function drawLobby(){
  for(const t of [0,1]){
    const ul=$('t'+t);ul.textContent='';
    for(const p of roster)if(p.team===t){const li=document.createElement('li');li.textContent=p.name+(p.bot?' (봇)':'')+(p.id===me.id?' (나)':'')+(p.id===0?' ★':'');ul.append(li)}
  }
  $('bStart').hidden=$('fillRow').hidden=!isHost;$('linkRow').hidden=!!offline;$('fill').value=fillTo;
  $('wait').textContent=isHost?(offline?'혼자 연습: 봇이 양 팀을 채운다. 4라운드 선승.':'링크를 공유하고, 다 모이면 시작. 라운드마다 공수 교대, 4라운드 선승.'):'호스트가 시작하면 게임이 열립니다.';
}
