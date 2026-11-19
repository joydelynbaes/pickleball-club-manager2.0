// Pickleball Club Manager - Firebase-backed PWA starter.
// Paste your Firebase web app config into firebaseConfig below.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
  appId: "PASTE_APP_ID"
};
const root=document; const $=id=>document.getElementById(id);
const show=(id,yes)=>$(id).classList.toggle('hidden',!yes);
const note=(msg,error=false)=>{ $('notice').textContent=msg;$('notice').classList.toggle('error',error);show('notice',true)};
let auth,db,user,clubId,club,role,state,unsubState,unsubMembers,unsubRequests,tab='session',installPrompt;
const path=(...p)=>p.join('/');
const clubRef=()=>doc(db,'clubs',clubId);
const memberRef=uid=>doc(db,'clubs',clubId,'members',uid);
const stateRef=()=>doc(db,'clubs',clubId,'state','live');
const memberList=()=>collection(db,'clubs',clubId,'members');
const requestsRef=()=>collection(db,'clubs',clubId,'joinRequests');
const activePlayers=()=>state?.players||[];
const queue=()=>state?.queue||[];
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function configReady(){return firebaseConfig.apiKey!=='PASTE_API_KEY'&&firebaseConfig.projectId!=='PASTE_PROJECT_ID'}
function showOnly(id){['auth','clubGate','pending','main'].forEach(x=>show(x,x===id))}
function init(){
 if(!configReady()){showOnly('auth');note('Setup needed: add your Firebase web app configuration in app.js first.',true);return}
 const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
 onAuthStateChanged(auth,async u=>{user=u;if(!u){cleanup();showOnly('auth');return}showOnly('clubGate');await restoreMembership()});
}
async function restoreMembership(){
 const saved=localStorage.getItem('pbcm_club');if(!saved)return;
 clubId=saved;
 try{const [c,m]=await Promise.all([getDoc(clubRef()),getDoc(memberRef(user.uid))]);if(c.exists()&&m.exists()&&m.data().active){club=c.data();role=m.data().role;enterClub()}else if(c.exists()){showOnly('pending')}}catch(e){note(e.message,true)}
}
$('signIn').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)}catch(e){note(e.message,true)}};
$('signUp').onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)}catch(e){note(e.message,true)}};
$('signOut').onclick=$('signOut2').onclick=$('logout').onclick=()=>signOut(auth);
$('createClub').onclick=async()=>{
 try{
  const name=$('newClubName').value.trim(),display=$('displayName').value.trim();if(!name||!display)return note('Enter your name and club name.',true);
  clubId='club-'+crypto.randomUUID().slice(0,8);
  await setDoc(clubRef(),{name,adminUid:user.uid,createdAt:serverTimestamp()});
  await setDoc(memberRef(user.uid),{uid:user.uid,email:user.email,displayName:display,role:'admin',active:true,joinedAt:serverTimestamp()});
  await setDoc(stateRef(),{players:[],queue:[],rounds:[],active:null,courts:2,format:'doubles',scoring:'traditional',target:11,winBy:2,partners:{},opponents:{},updatedAt:serverTimestamp()});
  localStorage.setItem('pbcm_club',clubId);club={name};role='admin';enterClub();
 }catch(e){note(e.message,true)}
};
$('requestJoin').onclick=async()=>{
 try{clubId=$('clubId').value.trim();let display=$('displayName').value.trim();if(!clubId||!display)return note('Enter your name and club ID.',true);
 const c=await getDoc(clubRef());if(!c.exists())return note('Club ID not found.',true);
 await setDoc(doc(db,'clubs',clubId,'joinRequests',user.uid),{uid:user.uid,email:user.email,displayName:display,status:'pending',requestedAt:serverTimestamp()});
 localStorage.setItem('pbcm_club',clubId);showOnly('pending');note('Access request sent. Ask your organizer to approve you.');
 }catch(e){note(e.message,true)}
};
$('pendingBack').onclick=restoreMembership;
function cleanup(){[unsubState,unsubMembers,unsubRequests].forEach(f=>f&&f());unsubState=unsubMembers=unsubRequests=null}
function enterClub(){
 showOnly('main');$('clubTitle').textContent=club.name;$('userRole').textContent=role==='admin'?'Club organizer':'Club member';
 cleanup();
 unsubState=onSnapshot(stateRef(),snap=>{if(snap.exists()){state=snap.data();render()}else note('Session data is missing.',true)},e=>note(e.message,true));
}
function saveState(patch){return updateDoc(stateRef(),{...patch,updatedAt:serverTimestamp()})}
function nm(id){return state.players.find(p=>p.id===id)?.name||'Removed'}
function key(a,b){return [a,b].sort((x,y)=>x-y).join('_')}
function count(map,a,b){return map?.[key(a,b)]||0}
function inc(map,a,b){let k=key(a,b);map[k]=(map[k]||0)+1}

// Club Skill Rating (CSR): a private-club estimate, NOT an official DUPR rating.
// Replays completed match history chronologically. Singles and doubles are rated separately.
const RATING_BASE = 3.0;
const RATING_MIN = 1.0;
const RATING_MAX = 5.0;
const RATING_MIN_MATCHES = 10;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function calculateClubRatings(){
 const result={singles:{},doubles:{}};
 for(const format of ['singles','doubles']){
  const ratings={},games={};
  const matches=[];
  for(const round of (state.rounds||[])){
   if(round.closed)continue;
   for(const m of (round.matches||[])){
    if(!m.done||!Array.isArray(m.score)||!Array.isArray(m.teams)||m.teams.length!==2)continue;
    const teamSize=(m.teams[0]||[]).length;
    if((format==='singles'&&teamSize!==1)||(format==='doubles'&&teamSize!==2))continue;
    if(m.teams.some(t=>!Array.isArray(t)||!t.length))continue;
    matches.push(m);
   }
  }
  const getRating=id=>ratings[id]??RATING_BASE;
  for(const m of matches){
   const [teamA,teamB]=m.teams;
   const avgA=teamA.reduce((s,id)=>s+getRating(id),0)/teamA.length;
   const avgB=teamB.reduce((s,id)=>s+getRating(id),0)/teamB.length;
   const expectedA=1/(1+Math.pow(10,(avgB-avgA)*1.15));
   const actualA=m.score[0]>m.score[1]?1:0;
   const pointDiff=Math.abs(m.score[0]-m.score[1]);
   const totalPoints=Math.max(1,m.score[0]+m.score[1]);
   const margin=clamp(pointDiff/Math.max(11,totalPoints),0,1);
   const marginFactor=0.85+(margin*0.35);
   const teamGames=Math.max(...teamA.concat(teamB).map(id=>games[id]||0));
   const kFactor=0.16/Math.sqrt(1+teamGames/20);
   const delta=clamp(kFactor*(actualA-expectedA)*marginFactor,-0.18,0.18);
   for(const id of teamA){ratings[id]=clamp(getRating(id)+delta,RATING_MIN,RATING_MAX);games[id]=(games[id]||0)+1}
   for(const id of teamB){ratings[id]=clamp(getRating(id)-delta,RATING_MIN,RATING_MAX);games[id]=(games[id]||0)+1}
  }
  for(const p of (state.players||[])){
   const count=games[p.id]||0;
   result[format][p.id]={rating:count?getRating(p.id):null,matches:count,eligible:count>=RATING_MIN_MATCHES};
  }
 }
 return result;
}
function ratingLabel(r){
 if(r<2.0)return 'Beginner';
 if(r<2.5)return 'Developing';
 if(r<3.0)return 'Recreational';
 if(r<3.5)return 'Intermediate';
 if(r<4.0)return 'Advanced';
 if(r<4.5)return 'Competitive';
 return 'Elite';
}
function ratingText(r){return r==null?'—':r.toFixed(3)}
function cap(){return state.courts*(state.format==='doubles'?4:2)}
function pairTeams(ids){
 if(state.format==='singles')return [[ids[0]],[ids[1]]];
 let [a,b,c,d]=ids,opts=[[[a,b],[c,d]],[[a,c],[b,d]],[[a,d],[b,c]]],best=opts[0],low=Infinity;
 for(let teams of opts){let cost=count(state.partners,...teams[0])*1000+count(state.partners,...teams[1])*1000;for(let x of teams[0])for(let y of teams[1])cost+=count(state.opponents,x,y)*35+Math.random()*.5;if(cost<low){low=cost;best=teams}}
 return best;
}
async function generate(){
 if(state.active)return note('Finish the current round first.',true);
 let available=state.queue.filter(id=>state.players.some(p=>p.id===id&&p.active));
 if(available.length<cap())return note(`Need ${cap()} active players; only ${available.length} are waiting.`,true);
 let ids=available.slice(0,cap()),size=state.format==='doubles'?4:2,matches=[];
 for(let i=0;i<state.courts;i++){let group=ids.slice(i*size,(i+1)*size);matches.push({court:i+1,ids:group,teams:pairTeams(group),score:[0,0],serving:0,server:state.format==='singles'?1:2,done:false,events:[]})}
 let q=state.queue.filter(id=>!ids.includes(id)).concat(ids),players=state.players.map(p=>({...p,games:p.games+(ids.includes(p.id)?1:0),waits:p.active&&!ids.includes(p.id)?p.waits+1:p.waits}));
 await saveState({queue:q,players,active:{number:state.rounds.length+1,matches,started:new Date().toLocaleTimeString()}});
}
async function score(court,team){
 let m=state.active.matches.find(x=>x.court===court);if(!m||m.done)return;
 let old={score:[...m.score],serving:m.serving,server:m.server};m.events=[...(m.events||[]),old];
 if(state.scoring==='rally'){m.score[team]++;m.serving=team;m.server=1}
 else if(m.serving===team){m.score[team]++}
 else if(state.format==='singles'){m.serving=team;m.server=1}
 else if(m.server===1){m.server=2}
 else{m.serving=team;m.server=1}
 if(m.score[team]>=state.target&&m.score[team]-m.score[1-team]>=state.winBy)m.done=true;
 await saveState({active:{...state.active,matches:state.active.matches.map(x=>x.court===court?m:x)}});
}
async function undo(court){let m=state.active.matches.find(x=>x.court===court);if(!m?.events?.length)return;let old=m.events.pop();m.score=old.score;m.serving=old.serving;m.server=old.server;m.done=false;await saveState({active:{...state.active,matches:state.active.matches.map(x=>x.court===court?m:x)}})}
async function finish(closed=false){
 let a=state.active;if(!a)return;if(!closed&&a.matches.some(m=>!m.done))return;
 let players=state.players.map(p=>({...p})),partners={...state.partners},opponents={...state.opponents};
 for(let m of a.matches)if(!closed&&m.done){
  let w=m.score[0]>m.score[1]?0:1,l=1-w;
  m.teams[w].forEach(id=>{let p=players.find(x=>x.id===id);if(p)p.wins++});
  m.teams[l].forEach(id=>{let p=players.find(x=>x.id===id);if(p)p.losses++});
  if(state.format==='doubles'){inc(partners,...m.teams[0]);inc(partners,...m.teams[1]);for(let x of m.teams[0])for(let y of m.teams[1])inc(opponents,x,y)}
 }
 await saveState({players,partners,opponents,rounds:[...state.rounds,{...a,closed,ended:new Date().toLocaleTimeString()}],active:null});
}
function view(title,sub=''){return `<section class="panel"><h2>${title}</h2><p class="muted small">${sub}</p></section>`}
function render(){
 if(!state)return;
 const tabs=document.querySelectorAll('.tabs button');tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='session')sessionView();if(tab==='players')playersView();if(tab==='courts')courtsView();if(tab==='ratings')ratingsView();if(tab==='admin')adminView();
}
function sessionView(){
 let waiting=state.queue.filter(id=>state.players.some(p=>p.id===id&&p.active));
 $('view').innerHTML=`<section class="panel"><h2>Session setup</h2><div class="grid2">
 <label>Courts<select id="courts">${[1,2,3,4,5,6].map(n=>`<option ${state.courts===n?'selected':''}>${n}</option>`).join('')}</select></label>
 <label>Format<select id="format"><option value="doubles" ${state.format==='doubles'?'selected':''}>Doubles</option><option value="singles" ${state.format==='singles'?'selected':''}>Singles</option></select></label>
 <label>Scoring<select id="scoring"><option value="traditional" ${state.scoring==='traditional'?'selected':''}>Traditional</option><option value="rally" ${state.scoring==='rally'?'selected':''}>Rally</option></select></label>
 <label>Target score<input id="target" type="number" min="1" max="99" value="${state.target}"></label>
 </div><label>Win by<select id="winBy"><option value="2" ${state.winBy===2?'selected':''}>2</option><option value="1" ${state.winBy===1?'selected':''}>1</option></select></label>
 <button class="secondary" id="apply">Apply settings</button><button class="primary full" id="generate" ${state.active?'disabled':''}>Generate next round</button>
 <p class="muted small">Capacity: ${cap()} players · ${waiting.length} in queue</p></section>
 <section class="panel"><h2>Waiting queue</h2>${waiting.map((id,i)=>`<div class="row"><b class="green">${i+1}</b><span class="grow">${esc(nm(id))}</span><span class="badge">${state.players.find(p=>p.id===id)?.games||0} games</span></div>`).join('')||'<p class="muted">No waiting players.</p>'}</section>
 ${state.active?'<section class="panel"><b>Round in progress</b><button class="primary full" id="goCourts">Open live courts</button></section>':''}`;
 $('apply').onclick=async()=>{if(state.active)return note('Finish the active round before changing courts or format.',true);await saveState({courts:+$('courts').value,format:$('format').value,scoring:$('scoring').value,target:Math.max(1,+$('target').value||11),winBy:+$('winBy').value})};
 $('generate').onclick=generate;if($('goCourts'))$('goCourts').onclick=()=>{tab='courts';render()};
}
function playersView(){
 const ratings=calculateClubRatings();
 $('view').innerHTML=`<section class="panel"><h2>Players</h2><form id="add"><input id="playerName" placeholder="Player name" required><button class="primary full">Add player</button></form>
 ${state.players.map(p=>{
  const d=ratings.doubles[p.id],s=ratings.singles[p.id];
  return `<div class="row player-row"><div class="grow"><b>${esc(p.name)}</b><div class="muted small">${p.games} games · ${p.wins} wins · ${p.losses} losses · ${p.waits} waits</div><div class="player-rating-line"><span>Doubles: <b>${d.eligible?ratingText(d.rating):'Provisional'} </b></span><span>Singles: <b>${s.eligible?ratingText(s.rating):'Provisional'}</b></span></div></div><button class="secondary small" data-pause="${p.id}">${p.active?'Pause':'Activate'}</button></div>`
 }).join('')}</section>
 <section class="panel"><p class="muted small">Club Skill Ratings are calculated automatically from completed club matches. Players cannot edit them. A player needs at least ${RATING_MIN_MATCHES} matches in the relevant format to qualify for its leaderboard.</p><button class="secondary full" id="openRatings">View rating leaderboards</button></section>`;
 $('add').onsubmit=async e=>{e.preventDefault();let name=$('playerName').value.trim();if(state.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return note('Player already exists.',true);let id=crypto.randomUUID();await saveState({players:[...state.players,{id,name,active:true,games:0,wins:0,losses:0,waits:0}],queue:[...state.queue,id]})};
 root.querySelectorAll('[data-pause]').forEach(b=>b.onclick=async()=>{let id=b.dataset.pause;if(state.active?.matches.some(m=>m.ids.includes(id)))return note('Player is currently playing.',true);await saveState({players:state.players.map(p=>p.id===id?{...p,active:!p.active}:p)})});
 $('openRatings').onclick=()=>{tab='ratings';render()};
}
function ratingsView(){
 const ratings=calculateClubRatings();
 const makeBoard=(format,label)=>{
  const rows=state.players.map(p=>({player:p,...ratings[format][p.id]})).filter(x=>x.eligible).sort((a,b)=>b.rating-a.rating||b.matches-a.matches||a.player.name.localeCompare(b.player.name));
  const pending=state.players.map(p=>({player:p,...ratings[format][p.id]})).filter(x=>!x.eligible).sort((a,b)=>b.matches-a.matches||a.player.name.localeCompare(b.player.name));
  return `<section class="panel"><div class="rating-board-head"><div><h2>${label}</h2><p class="muted small">Minimum ${RATING_MIN_MATCHES} completed ${format} matches</p></div><span class="badge">${rows.length} ranked</span></div>
   ${rows.length?rows.map((x,i)=>`<div class="rating-row"><span class="rating-rank">${i+1}</span><div class="grow"><b>${esc(x.player.name)}</b><div class="muted small">${ratingLabel(x.rating)} · ${x.matches} matches</div></div><strong class="rating-number">${ratingText(x.rating)}</strong></div>`).join(''):'<p class="muted small">No players have qualified yet. Complete 10 matches in this format to appear here.</p>'}
   ${pending.length?`<details class="rating-pending"><summary>Not yet ranked (${pending.length})</summary>${pending.map(x=>`<div class="rating-row"><span class="rating-rank muted">—</span><div class="grow"><b>${esc(x.player.name)}</b><div class="muted small">${x.matches}/${RATING_MIN_MATCHES} matches completed</div></div><span class="badge">Provisional</span></div>`).join('')}</details>`:''}
  </section>`;
 };
 $('view').innerHTML=`<section class="panel rating-intro"><div class="eyebrow">PRIVATE CLUB STATISTICS</div><h2>Club Skill Ratings</h2><p class="muted small">Automatically calculated from completed matches. These are internal club estimates, not official DUPR ratings.</p><div class="rating-legend"><span>1.0 Beginner</span><span>3.0 Intermediate baseline</span><span>5.0 Elite</span></div></section>${makeBoard('doubles','Doubles leaderboard')}${makeBoard('singles','Singles leaderboard')}<section class="panel"><h2>How the rating works</h2><ul class="rating-explain"><li>Everyone starts at a neutral 3.000 baseline.</li><li>Winning against stronger-rated opponents earns more than beating lower-rated opponents.</li><li>Point margin affects the size of the rating change, within a limited range.</li><li>Rating changes become smaller as a player's match history grows, helping ratings stabilize.</li><li>Only completed matches count; rounds closed without results are excluded.</li></ul><p class="muted small">Ratings are recalculated from saved match history, so correcting or removing match history will also change the ratings.</p></section>`;
}

function courtsView(){
 if(!state.active){$('view').innerHTML=view('No active round','Generate a round from the Session tab.');return}
 let html=`<section class="panel"><h2>Round ${state.active.number}</h2><p class="muted small">${state.active.started}</p></section>`;
 for(let m of state.active.matches){html+=`<section class="match"><div class="muted small">COURT ${m.court} · ${m.done?'FINISHED':state.scoring.toUpperCase()}</div><div class="teams"><div><div class="teamname">${teamText(m.teams[0])}</div><div class="score">${m.score[0]}</div>${m.serving===0&&!m.done?'<span class="green small">SERVING</span>':''}</div><b class="muted">VS</b><div><div class="teamname">${teamText(m.teams[1])}</div><div class="score">${m.score[1]}</div>${m.serving===1&&!m.done?'<span class="green small">SERVING</span>':''}</div></div>${m.done?'<p class="green">Match completed</p>':`<div class="scorebtns"><button class="primary" data-score="${m.court}-0">Team 1 won rally</button><button class="primary" data-score="${m.court}-1">Team 2 won rally</button></div><button class="secondary full" data-undo="${m.court}">Undo last rally</button>`}</section>`}
 html+=`<section class="panel"><button class="primary full" id="finish" ${state.active.matches.some(m=>!m.done)?'disabled':''}>Complete round</button><button class="secondary full" id="closeRound">Close round without results</button></section>`;
 $('view').innerHTML=html;
 root.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>{let [c,t]=b.dataset.score.split('-');score(+c,+t)});
 root.querySelectorAll('[data-undo]').forEach(b=>b.onclick=()=>undo(+b.dataset.undo));
 $('finish').onclick=()=>finish();$('closeRound').onclick=()=>{if(confirm('Close this round without recording results?'))finish(true)};
}
function adminView(){
 $('view').innerHTML=`<section class="panel"><h2>Club access</h2><p class="muted small">Share this club ID with members. They must request access and be approved by an organizer.</p><div class="badge">${esc(clubId)}</div><button id="copyId" class="secondary full">Copy club ID</button></section><section class="panel"><h2>Pending requests</h2><div id="requests" class="muted small">Loading requests…</div></section><section class="panel"><h2>Club members</h2><div id="members" class="muted small">Loading members…</div></section>`;
 $('copyId').onclick=()=>navigator.clipboard.writeText(clubId).then(()=>note('Club ID copied.'));
 if(unsubRequests)unsubRequests();if(unsubMembers)unsubMembers();
 if(role==='admin'){
  unsubRequests=onSnapshot(requestsRef(),snap=>{let el=$('requests');if(!el)return;let pending=snap.docs.filter(d=>d.data().status==='pending');el.innerHTML=pending.length?pending.map(d=>{let x=d.data();return `<div class="row"><div class="grow">${esc(x.displayName)}<div class="muted">${esc(x.email)}</div></div><button class="primary" data-approve="${d.id}">Approve</button></div>`}).join(''):'No pending requests.';el.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{let uid=b.dataset.approve,req=await getDoc(doc(db,'clubs',clubId,'joinRequests',uid));if(!req.exists())return;let x=req.data();await setDoc(memberRef(uid),{uid,email:x.email,displayName:x.displayName,role:'member',active:true,joinedAt:serverTimestamp()});await updateDoc(doc(db,'clubs',clubId,'joinRequests',uid),{status:'approved'})})});
  unsubMembers=onSnapshot(memberList(),snap=>{let el=$('members');if(!el)return;el.innerHTML=snap.docs.map(d=>{let x=d.data();return `<div class="row"><span class="grow">${esc(x.displayName||x.email)}</span><span class="badge">${esc(x.role)}</span></div>`}).join('')});
 }else{$('requests').textContent='Only club organizers can approve requests.';$('members').textContent='Only club organizers can view the member list.'}
}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
$('logout').onclick=()=>signOut(auth);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;show('installBtn',true)});
$('installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();installPrompt=null;show('installBtn',false)}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
init();
