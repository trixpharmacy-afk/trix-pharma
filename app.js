const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const mem={};
const store={
 get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return mem[k]??null}},
 set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){mem[k]=v}}
};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* every pharmacy starts EMPTY: stock only exists after you record a purchase */
const seed=()=>({name:'My Pharmacy',br:['Main'],meds:[],sales:[],buys:[],pats:[],clm:[],sups:[],log:[],xf:[]});
const norm=d=>({...seed(),...(d||{})});
let D=seed(),REV=0,me=null,cur='dash',flash='',RC=null,TOKEN=store.get('trix_token'),B={paidUntil:0,pending:[]},TEAM={staff:[],invites:[]},st,chain=Promise.resolve();
const PRICE=500000;
const isOwner=()=>!!me&&me.role==='Owner';
const active=()=>B.paidUntil>Date.now();
const left=()=>Math.ceil((B.paidUntil-Date.now())/864e5);

/* server connection */
const api=async(p,method='GET',body)=>{
 const r=await fetch(p,{method,headers:{'Content-Type':'application/json',...(TOKEN?{Authorization:'Bearer '+TOKEN}:{})},body:body&&JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(j.error||'Something went wrong.');e.status=r.status;throw e}
 return j;
};
async function pull(){const r=await api('/api/db');D=norm(r.db);REV=r.rev}
async function push(){
 try{REV=(await api('/api/db','PUT',{db:D,rev:REV})).rev}
 catch(e){if(e.status===409){await pull();note('A teammate changed the data. It was reloaded, please repeat your last action.');draw()}}
}
const save=()=>{clearTimeout(st);st=setTimeout(()=>{chain=chain.then(push)},300)};
async function refresh(){const r=await api('/api/me');B=r.bill;me=r.user;if(active())await pull()}
async function boot(){const r=await api('/api/me');me=r.user;B=r.bill;D=seed();if(active())await pull();enter(me)}
async function loadTeam(){TEAM=await api('/api/team')}

const log=t=>{D.log.unshift([new Date().toLocaleString(),me.name,t]);D.log=D.log.slice(0,200);save()};
const $m=v=>'FRW '+Math.round(v).toLocaleString();
const days=m=>(new Date(m.e)-new Date())/864e5;
const status=m=>m.q===0?['bad','Out of stock']:days(m)<0?['bad','Expired']:days(m)<=90?['warn','Near expiry']:m.q<30?['warn','Low stock']:['ok','In stock'];
const pill=m=>{const s=status(m);return `<span class="pill ${s[0]}">${s[1]}</span>`};
const T=(h,rows,empty)=>`<div class="panel tw"><table><thead><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${h.length}" class="empty">${empty||'Nothing here yet.'}</td></tr>`}</tbody></table></div>`;
const tr=c=>`<tr>${c.map(x=>`<td>${x}</td>`).join('')}</tr>`;
const F=(label,id,type,o)=>`<div><label for="${id}">${label}</label>${type==='sel'?`<select id="${id}">${o.map(x=>`<option value="${esc(x[0])}">${esc(x[1])}</option>`).join('')}</select>`:`<input id="${id}" type="${type}" ${o||''}>`}</div>`;
const sellable=()=>D.meds.map((m,i)=>[i,m]).filter(([i,m])=>m.q>0&&days(m)>=0);
const v=id=>$('#'+id).value;
const note=t=>flash=t;
const hint=t=>`<div class="panel empty">${t}</div>`;

/* auth */
const msg=(t,ok)=>{const m=$('#msg');m.textContent=t;m.className='msg '+(t?(ok?'ok':'err'):'')};
const LINK=Object.fromEntries(new URLSearchParams(location.search));
const HEAD={in:['Welcome back','Sign in to manage your pharmacy.'],up:['Create your pharmacy account','It takes less than a minute.'],rs:['Reset your password','We will email you a secure link.'],rn:['Choose a new password','Use at least 8 characters.']};
function show(t){$$('.tabs .btn').forEach(x=>x.classList.toggle('on',x.dataset.t===t));['in','up','rs','rn'].forEach(k=>$('#f-'+k).style.display=k===t?'':'none');$('#ct').textContent=HEAD[t][0];$('#cs').textContent=HEAD[t][1];msg('')}
$$('.tabs .btn').forEach(b=>b.onclick=()=>show(b.dataset.t));
const authGo=async(p,b)=>{try{const r=await api(p,'POST',b);TOKEN=r.token;store.set('trix_token',TOKEN);await boot()}catch(e){msg(e.message)}};
$('#doIn').onclick=()=>authGo('/api/login',{email:v('inE'),pass:v('inP')});
$('#doUp').onclick=async()=>{try{await api('/api/signup/start','POST',{name:v('upN'),email:v('upE'),pass:v('upP')});msg('Check your email. We sent a confirmation link to '+v('upE').trim()+'. Open it to finish creating your account.',true)}catch(e){msg(e.message)}};
$('#doRs').onclick=async()=>{try{await api('/api/reset/start','POST',{email:v('rsE')});msg('If that email has an account, we sent a reset link. Check your inbox.',true)}catch(e){msg(e.message)}};
$('#doRn').onclick=async()=>{try{await api('/api/reset/finish','POST',{email:LINK.e,token:LINK.reset,pass:v('rnP')});history.replaceState(null,'','/');show('in');msg('Password changed. You can sign in now.',true)}catch(e){msg(e.message)}};
function enter(u){
 me=u;$('#auth').style.display='none';$('#app').style.display='grid';
 $('#av').textContent=u.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
 $('#acct').textContent=(u.imp?'Support view · ':'')+u.name.split(/\s+/)[0]+' · '+u.role;
 $('#navTeam').style.display=isOwner()?'':'none';
 $('#side a[data-v="set"]').style.display=isOwner()?'':'none';
 go('dash');
}
$('#logout').onclick=()=>{api('/api/logout','POST').catch(()=>{});TOKEN=null;store.set('trix_token',null);me=null;D=seed();RC=null;$('#app').style.display='none';$('#app').classList.remove('open');$('#auth').style.display='flex';$('#inP').value='';show('in')};

/* navigation */
const toggle=o=>$('#app').classList.toggle('open',o);
$('#burger').onclick=()=>toggle();$('#shade').onclick=()=>toggle(false);
$$('#side a[data-v]').forEach(a=>{a.onclick=()=>go(a.dataset.v);a.onkeydown=e=>{if(e.key==='Enter')go(a.dataset.v)}});
async function go(id){
 if(!active()&&id!=='plan')id='plan';
 if((id==='team'||id==='set')&&!isOwner())id='dash';
 if(id==='team'){try{await loadTeam()}catch(e){}}
 cur=id;toggle(false);window.scrollTo(0,0);
 $$('#side a').forEach(x=>{x.classList.toggle('on',x.dataset.v===id);x.classList.toggle('lock',!active()&&!!x.dataset.v&&x.dataset.v!=='plan')});
 draw();
}
function draw(){
 const warn=active()&&left()<=5&&isOwner()?`<p class="msg err" role="alert">Your subscription ends in ${left()} day(s). Renew in Plans &amp; billing.</p>`:'';
 $('#view').innerHTML=(flash?`<p class="msg ok" role="status">${esc(flash)}</p>`:'')+warn+views[cur]();flash='';
 if(cur==='cat')wireSearch();
}
$('#view').onclick=async e=>{
 const b=e.target.closest('[data-a]');if(!b)return;
 const a=b.dataset.a,i=+b.dataset.i;
 if(a==='go')return go(b.dataset.i);
 const r=acts[a]&&await acts[a](i);
 if(r===null)return;
 if(r)note(r);draw();
};
const err=t=>{$('#view').querySelector('.err')?.remove();$('#view').insertAdjacentHTML('afterbegin',`<p class="msg err" role="alert">${esc(t)}</p>`);return null};
const ownerOnly=()=>isOwner()?false:err('Only the owner can do this.');

/* actions */
const acts={
 buy(){
  const n=v('bN').trim(),q=+v('bQ'),e=v('bE'),b=v('bB').trim(),c=+v('bC'),p=+v('bPr'),br=v('bR'),sup=v('bS').trim()||'Unknown supplier';
  if(!n||!e||!b)return err('Fill in the medicine, batch and expiry date.');
  if(!Number.isInteger(q)||q<1)return err('Quantity must be a whole number above zero.');
  if(v('bC')===''||!(c>=0))return err('Enter the cost of one unit.');
  if(v('bPr')===''||!(p>0))return err('Enter the selling price of one unit.');
  const ex=D.meds.find(m=>m.n.toLowerCase()===n.toLowerCase()&&m.b===b&&m.br===br);
  if(ex){ex.c=(ex.q*ex.c+q*c)/(ex.q+q);ex.q+=q;ex.p=p}
  else D.meds.push({n,f:v('bF').trim()||'Tablet',q,e,b,c,p,br});
  if(!D.sups.includes(sup))D.sups.push(sup);
  D.buys.unshift([new Date().toLocaleString(),n,q,b,sup,c,br]);
  log('Received '+q+' × '+n+' from '+sup);save();return 'Purchase recorded. The stock is ready to sell.';
 },
 sale(){
  const m=D.meds[+v('sM')],q=+v('sQ');
  if(!m)return err('Choose a medicine from your stock.');
  if(!Number.isInteger(q)||q<1)return err('Quantity must be a whole number above zero.');
  if(days(m)<0)return err('This batch is expired and cannot be sold.');
  if(q>m.q)return err('Only '+m.q+' units are available in that batch.');
  m.q-=q;const tot=q*m.p,id='R'+Date.now().toString(36).toUpperCase(),pat=v('sP').trim()||'Walk-in';
  D.sales.unshift([new Date().toLocaleString(),m.n,q,tot,pat,m.br,q*m.c,me.name,id]);
  RC={id,when:new Date().toLocaleString(),n:m.n,q,p:m.p,tot,pat,br:m.br,by:me.name,ph:D.name};
  log('Sold '+q+' × '+m.n);save();return 'Sale recorded: '+$m(tot);
 },
 print(){window.print();return null},
 closeRc(){RC=null;return ''},
 addbr(){
  if(ownerOnly())return null;
  const n=v('brN').trim();if(!n)return err('Enter the branch name.');
  if(D.br.some(b=>b.toLowerCase()===n.toLowerCase()))return err('That branch already exists.');
  D.br.push(n);log('Added branch '+n);save();return 'Branch added.';
 },
 xfer(){
  const m=D.meds[+v('xM')],q=+v('xQ'),to=v('xT');
  if(!m||!Number.isInteger(q)||q<1||q>m.q)return err('Choose a batch and a quantity it can cover.');
  if(to===m.br)return err('Pick a different destination branch.');
  m.q-=q;const d=D.meds.find(x=>x.n===m.n&&x.b===m.b&&x.br===to);
  d?d.q+=q:D.meds.push({...m,q,br:to});
  D.xf.unshift([new Date().toLocaleString(),m.n,q,m.br,to]);log('Transferred '+q+' × '+m.n+' to '+to);save();return 'Transfer complete.';
 },
 wo(i){if(ownerOnly())return null;const m=D.meds[i];log('Wrote off '+m.q+' × '+m.n+' ('+m.b+')');m.q=0;save();return 'Batch written off.'},
 pat(){const n=v('pN').trim();if(!n)return err('Enter the patient’s name.');D.pats.push([n,v('pPh').trim(),v('pI').trim()]);log('Added patient '+n);save();return 'Patient added.'},
 clm(){const n=v('cP').trim(),a=+v('cA');if(!n)return err('Type the patient’s name.');if(!(a>0))return err('Enter a claim amount above zero.');D.clm.unshift([n,v('cI').trim(),a,'Pending']);log('Filed claim '+$m(a));save();return 'Claim filed.'},
 cyc(i){const s=['Pending','Approved','Paid','Rejected'],c=D.clm[i];c[3]=s[(s.indexOf(c[3])+1)%4];save();return 'Claim marked '+c[3]+'.'},
 scan(){cur='scan';window._q=v('qC').trim().toLowerCase();return ''},
 name(){if(ownerOnly())return null;D.name=v('nm').trim()||D.name;save();return 'Settings saved.'},
 async inv(){try{await api('/api/team/invite','POST',{name:v('tN'),email:v('tE')});await loadTeam();return 'Invitation sent. They must create an account with that email.'}catch(e){return err(e.message)}},
 async rm(i){
  const u=TEAM.staff[i];if(!u||!confirm('Remove '+u.name+'? They will be signed out immediately.'))return null;
  try{await api('/api/team/remove','POST',{id:u.id});await loadTeam();return 'Staff member removed.'}catch(e){return err(e.message)}
 },
 async cinv(i){try{await api('/api/team/remove','POST',{email:TEAM.invites[i].email});await loadTeam();return 'Invitation cancelled.'}catch(e){return err(e.message)}},
 async pay(){
  try{await api('/api/pay','POST',{m:v('pM'),ref:v('pR')});await refresh();return 'Payment submitted. When TRIX confirms it, we email you an activation code.'}
  catch(e){return err(e.message)}
 },
 async act(){try{await api('/api/activate','POST',{code:v('pC')});await refresh();return 'Subscription active for 30 days.'}catch(e){return err(e.message)}},
 async chk(){try{await refresh()}catch(e){return err(e.message)}return active()?'Your subscription is active.':'Not confirmed yet.'}
};

/* screens */
const sold=()=>D.sales.reduce((s,x)=>s+x[3],0);
const profit=()=>D.sales.reduce((s,x)=>s+x[3]-x[6],0);
const rcpt=()=>!RC?'':`<div id="rcpt"><h2 style="margin:0">${esc(RC.ph)}</h2><p class="mute">Receipt ${RC.id} · ${esc(RC.when)}<br>Branch: ${esc(RC.br)} · Served by ${esc(RC.by)}</p><p style="margin:12px 0 4px">${esc(RC.n)} × ${RC.q} @ ${$m(RC.p)}</p><p style="margin:0"><b>Total ${$m(RC.tot)}</b>${RC.pat!=='Walk-in'?'<br>Patient: '+esc(RC.pat):''}</p><p class="mute" style="margin:10px 0">Thank you.</p><button class="btn p sm noprint" data-a="print">Print receipt</button> <button class="btn sm noprint" data-a="closeRc">Close</button></div>`;
const views={
 dash(){
  const w=D.meds.filter(m=>status(m)[0]!=='ok').slice(0,5);
  return `<h1>Good day, ${esc(me.name.split(/\s+/)[0])}</h1><p class="sub">Here’s how ${esc(D.name)} is doing today.</p>
  <div class="acts"><button class="btn" data-a="go" data-i="buy">＋ Record purchase</button><button class="btn p" data-a="go" data-i="sale">＋ Record sale</button></div>
  <div class="kpis"><div class="kpi"><small>Units in stock</small><b>${D.meds.reduce((s,m)=>s+m.q,0).toLocaleString()}</b><small>Across all branches</small></div>
  <div class="kpi"><small>Expired / expiring</small><b>${D.meds.filter(m=>m.q>0&&days(m)<=90).length}</b><small>Expired or due within 90 days</small></div>
  <div class="kpi"><small>Sales</small><b>${$m(sold())}</b><small>${D.sales.length} transactions</small></div>
  <div class="kpi"><small>Gross profit</small><b>${$m(profit())}</b><small>Sales minus the cost of units sold</small></div></div>
  ${D.meds.length?`<div class="panel"><div class="ph"><div><h2>Expiry watch</h2><p>Batches that need action</p></div><button class="btn" data-a="go" data-i="exp">Review</button></div>
  <div class="tw"><table><thead><tr><th>MEDICINE</th><th>BATCH</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody>${w.map(m=>tr([esc(m.n),esc(m.b),m.e,pill(m)])).join('')||'<tr><td colspan="4" class="empty">Nothing needs action.</td></tr>'}</tbody></table></div></div>`:hint('Start here: record a purchase from your supplier. Only stock you have received can be sold.')}`;
 },
 stock(){return `<h1>Stock &amp; batches</h1><p class="sub">Every batch you received. Cost is for you only and never shown to customers.</p>`+T(['MEDICINE','BATCH','BRANCH','QTY','COST / UNIT','PRICE / UNIT','EXPIRY','STATUS'],D.meds.map(m=>tr([esc(m.n),esc(m.b),esc(m.br),m.q,$m(m.c),$m(m.p),m.e,pill(m)])),'No stock yet. Record a purchase first.')},
 scan(){
  const q=window._q||'',r=q?D.meds.filter(m=>m.b.toLowerCase()===q||m.n.toLowerCase().includes(q)):[];
  return `<h1>Barcode scanner</h1><p class="sub">Type or scan (with a USB scanner) a batch code.</p><div class="form">${F('Batch code or name','qC','text','autofocus')}<button class="btn p" data-a="scan">Look up</button></div>`+(q?T(['MEDICINE','BATCH','BRANCH','QTY','PRICE','EXPIRY','STATUS'],r.map(m=>tr([esc(m.n),esc(m.b),esc(m.br),m.q,$m(m.p),m.e,pill(m)])),'No match.'):'');
 },
 br(){
  const opts=D.meds.map((m,i)=>[i,`${m.n} · ${m.b} · ${m.br} (${m.q})`]).filter((o,i)=>D.meds[i].q>0);
  return `<h1>Branches &amp; transfers</h1><p class="sub">Move stock between your branches.</p>`+T(['BRANCH','BATCHES','UNITS'],D.br.map(b=>{const l=D.meds.filter(m=>m.br===b);return tr([esc(b),l.length,l.reduce((s,m)=>s+m.q,0)])}))+
  (isOwner()?`<div class="form">${F('New branch name','brN','text','autocomplete="off" maxlength="60"')}<button class="btn p" data-a="addbr">Add branch</button></div>`:'')+
  (D.br.length>1&&opts.length?`<div class="form">${F('Batch','xM','sel',opts)}${F('Quantity','xQ','number','min="1"')}${F('To branch','xT','sel',D.br.map(b=>[b,b]))}<button class="btn p" data-a="xfer">Transfer</button></div>`:hint('Transfers need at least two branches and some stock.'))+
  T(['WHEN','MEDICINE','QTY','FROM','TO'],D.xf.map(x=>tr(x.map(esc))));
 },
 sale(){
  const l=sellable();
  return `<h1>Record a sale</h1><p class="sub">You can only sell stock you received from a supplier.</p>${rcpt()}`+
  (l.length?`<div class="form">${F('Medicine batch','sM','sel',l.map(([i,m])=>[i,`${m.n} · ${m.b} · ${m.br} · ${m.q} left · ${$m(m.p)}`]))}${F('Quantity','sQ','number','min="1" value="1"')}${F('Patient (optional)','sP','text','autocomplete="off" maxlength="80"')}<button class="btn p" data-a="sale">Record sale</button></div>`:hint('No sellable stock. Record a purchase from a supplier first.'))+
  T(['WHEN','MEDICINE','QTY','TOTAL','PROFIT','PATIENT','BRANCH','BY'],D.sales.slice(0,15).map(s=>tr([esc(s[0]),esc(s[1]),s[2],$m(s[3]),$m(s[3]-s[6]),esc(s[4]),esc(s[5]),esc(s[7])])));
 },
 buy(){
  return `<h1>Purchases &amp; suppliers</h1><p class="sub">Record what you receive from suppliers. Give the cost and the selling price of one unit.</p>
  <div class="form">${F('Medicine','bN','text','list="ml" autocomplete="off" maxlength="80"')}<datalist id="ml">${[...new Set(D.meds.map(m=>m.n))].map(n=>`<option value="${esc(n)}">`).join('')}</datalist>${F('Form','bF','text','placeholder="Tablet"')}${F('Quantity received','bQ','number','min="1"')}${F('Batch number','bB','text','autocomplete="off"')}${F('Expiry date','bE','date')}${F('Cost of 1 unit (FRW)','bC','number','min="0"')}${F('Selling price of 1 unit (FRW)','bPr','number','min="0"')}${F('Supplier','bS','text','list="sl" autocomplete="off" maxlength="80"')}<datalist id="sl">${D.sups.map(s=>`<option value="${esc(s)}">`).join('')}</datalist>${F('Branch','bR','sel',D.br.map(b=>[b,b]))}<button class="btn p" data-a="buy">Save purchase</button></div>`+
  T(['WHEN','MEDICINE','QTY','BATCH','SUPPLIER','COST / UNIT','BRANCH'],D.buys.slice(0,20).map(b=>tr([esc(b[0]),esc(b[1]),b[2],esc(b[3]),esc(b[4]),$m(b[5]),esc(b[6])])))+
  `<div class="panel"><div class="ph"><div><h2>Your suppliers</h2></div></div>${D.sups.map(s=>`<div class="row">${esc(s)}</div>`).join('')||'<div class="empty">Suppliers appear here after your first purchase.</div>'}</div>`;
 },
 exp(){
  const l=D.meds.map((m,i)=>[m,i]).sort((a,b)=>a[0].e<b[0].e?-1:1);
  return `<h1>Expiry control</h1><p class="sub">Soonest first.${isOwner()?' Write off expired batches.':''}</p>`+T(['MEDICINE','BATCH','QTY','EXPIRY','DAYS','STATUS',''],l.map(([m,i])=>tr([esc(m.n),esc(m.b),m.q,m.e,Math.floor(days(m)),pill(m),isOwner()&&days(m)<0&&m.q>0?`<button class="btn sm" data-a="wo" data-i="${i}">Write off</button>`:''])));
 },
 cat(){return `<h1>Medicine catalogue</h1><p class="sub">Every medicine you stock, with its selling price.</p><input class="search" id="q" placeholder="Search medicines" aria-label="Search medicines"><div class="panel tw"><table><thead><tr><th>MEDICINE</th><th>FORM</th><th>PRICE</th><th>STOCK</th><th>EXPIRY</th><th>STATUS</th></tr></thead><tbody id="tb"></tbody></table></div>`},
 rep(){
  return `<h1>Reports &amp; audit</h1><p class="sub">Sales, profit and activity.</p><div class="kpis"><div class="kpi"><small>Total sales</small><b>${$m(sold())}</b></div><div class="kpi"><small>Gross profit</small><b>${$m(profit())}</b></div><div class="kpi"><small>Stock value at cost</small><b>${$m(D.meds.reduce((s,m)=>s+m.q*m.c,0))}</b></div><div class="kpi"><small>Stock value at price</small><b>${$m(D.meds.reduce((s,m)=>s+m.q*m.p,0))}</b></div></div>`+
  T(['WHEN','ITEM','QTY','TOTAL','PROFIT','BY'],D.sales.slice(0,20).map(s=>tr([esc(s[0]),esc(s[1]),s[2],$m(s[3]),$m(s[3]-s[6]),esc(s[7])])))+
  (isOwner()?`<h2>Activity log</h2>`+T(['WHEN','USER','ACTION'],D.log.slice(0,40).map(x=>tr(x.map(esc)))):'');
 },
 pat(){return `<h1>Patients</h1><p class="sub">Your patient records.</p><div class="form">${F('Name','pN','text','autocomplete="off" maxlength="80"')}${F('Phone','pPh','tel','autocomplete="off"')}${F('Insurer','pI','text','autocomplete="off"')}<button class="btn p" data-a="pat">Add patient</button></div>`+T(['NAME','PHONE','INSURER'],D.pats.map(p=>tr(p.map(esc))))},
 ins(){
  return `<h1>Insurance &amp; claims</h1><p class="sub">Tap a status to move it along.</p><div class="form">${F('Patient name','cP','text','list="pl" autocomplete="off" maxlength="80"')}<datalist id="pl">${D.pats.map(p=>`<option value="${esc(p[0])}">`).join('')}</datalist>${F('Insurer','cI','text','autocomplete="off"')}${F('Amount (FRW)','cA','number','min="0"')}<button class="btn p" data-a="clm">File claim</button></div>`+
  T(['PATIENT','INSURER','AMOUNT','STATUS'],D.clm.map((c,i)=>tr([esc(c[0]),esc(c[1]),$m(c[2]),`<button class="btn sm" data-a="cyc" data-i="${i}">${c[3]}</button>`])));
 },
 noti(){
  const n=D.meds.filter(m=>status(m)[0]!=='ok').map(m=>`<div class="row"><div>${esc(m.n)} · ${esc(m.b)}<em>${esc(m.br)} · ${m.q} units · expires ${m.e}</em></div>${pill(m)}</div>`);
  return `<h1>Notifications</h1><p class="sub">Alerts from your stock and expiry data.</p><div class="panel">${n.join('')||'<div class="empty">All clear.</div>'}</div>`;
 },
 team(){
  return `<h1>Team &amp; access</h1><p class="sub">Only you, the owner, can add or remove staff accounts. Staff see only your pharmacy’s data.</p>
  <div class="form">${F('Staff name','tN','text','autocomplete="off" maxlength="80"')}${F('Staff email','tE','email','autocomplete="off"')}<button class="btn p" data-a="inv">Invite staff</button></div>
  <div class="panel">${TEAM.staff.map((u,i)=>`<div class="row"><div>${esc(u.name)}<em>${esc(u.email)}</em></div><span>${u.role==='Owner'?'<span class="pill ok">Owner</span>':`<span class="pill warn">Staff</span> <button class="btn sm" data-a="rm" data-i="${i}">Remove</button>`}</span></div>`).join('')}${TEAM.invites.map((u,i)=>`<div class="row"><div>${esc(u.email)}<em>Invited, waiting for them to create the account</em></div><button class="btn sm" data-a="cinv" data-i="${i}">Cancel</button></div>`).join('')}</div>`;
 },
 plan(){
  const p=B.pending.length,cs=B.codeSent;
  const head=`<h1>Plans &amp; billing</h1><p class="sub">${active()?'Active — '+left()+' days left.':'There is no free trial. Pay to use the system.'}</p>
  <div class="kpis"><div class="kpi"><small>TRIX Pharmacy · monthly</small><b>${$m(PRICE)}</b><small>Per month, all features</small></div>
  <div class="kpi"><small>Status</small><b>${active()?'Active':cs?'Code sent':p?'Pending':'Locked'}</b><small>${active()?'Renews by '+new Date(B.paidUntil).toLocaleDateString():cs?'Check your email for the activation code':p?'Waiting for confirmation':'Payment required'}</small></div></div>`;
  if(!isOwner())return head+hint('Only the pharmacy owner can pay and manage the subscription. Please ask the owner.');
  return head+`<div class="panel"><div class="ph"><div><h2>How to pay</h2><p>Pay ${$m(PRICE)} by either method, then enter the reference below.</p></div></div>
  <div class="row"><div>1. Equity Bank<em>Account: 4007113189056</em></div></div>
  <div class="row"><div>2. MoMo<em>+250798297779</em></div></div></div>
  <div class="form">${F('Payment method','pM','sel',[['Equity Bank','Equity Bank'],['MoMo','MoMo']])}${F('Transaction reference','pR','text','autocomplete="off"')}<button class="btn p" data-a="pay">I have paid</button><button class="btn" data-a="chk">Check status</button></div>
  <div class="form">${F('Activation code (sent to your email)','pC','text','autocomplete="off"')}<button class="btn p" data-a="act">Activate</button></div>`;
 },
 set(){return `<h1>Settings</h1><p class="sub">Your pharmacy details.</p><div class="form">${F('Pharmacy name','nm','text',`value="${esc(D.name)}" maxlength="80"`)}<button class="btn p" data-a="name">Save</button></div>`}
};
function wireSearch(){
 const d=t=>{const r=D.meds.filter(m=>m.n.toLowerCase().includes(t.toLowerCase()));$('#tb').innerHTML=r.length?r.map(m=>tr([esc(m.n),esc(m.f),$m(m.p),m.q,m.e,pill(m)])).join(''):'<tr><td colspan="6" class="empty">No medicine matches that search.</td></tr>'};
 $('#q').oninput=e=>d(e.target.value);d('');
}

/* resume a saved session */
if(LINK.as){TOKEN=LINK.as;store.set('trix_token',TOKEN);history.replaceState(null,'','/');boot().catch(()=>{TOKEN=null;store.set('trix_token',null)})}
else if(LINK.verify){history.replaceState(null,'','/');msg('Confirming your email...',true);authGo('/api/signup/verify',{email:LINK.e,token:LINK.verify})}
else if(LINK.reset){show('rn');msg('Choose a new password for '+(LINK.e||'your account')+'.',true)}
else if(TOKEN)boot().catch(()=>{TOKEN=null;store.set('trix_token',null)});
