// TRIX Pharmacy server. No npm packages needed: only Node.js 18 or newer.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const ADMIN_KEY=process.env.ADMIN_KEY||'';        // your private key for admin.html
const BREVO_KEY=process.env.BREVO_KEY||'';        // email service API key (brevo.com)
const MAIL_FROM=process.env.MAIL_FROM||'';        // sender email verified in Brevo
const DEV_EMAIL=process.env.DEV_EMAIL||'arseneineza9@gmail.com'; // YOUR email: new accounts and payment references are sent here
const PUBLIC_URL=process.env.PUBLIC_URL||'the TRIX Pharmacy website';
const FILE=path.join(__dirname,'data.json');
const PUBLIC={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/admin.html':'admin.html'};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};

let DB={users:[],orgs:{},sessions:{}};
try{DB=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch(e){}
DB.pays=DB.pays||[];DB.audit=DB.audit||[];
const save=()=>{fs.writeFileSync(FILE+'.tmp',JSON.stringify(DB));fs.renameSync(FILE+'.tmp',FILE)};
const audit=(action,target)=>{DB.audit.unshift({at:Date.now(),action,target});DB.audit=DB.audit.slice(0,500)};
const rnd=n=>crypto.randomBytes(n).toString('hex');
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const hash=(p,s=rnd(16))=>s+':'+crypto.scryptSync(p,s,64).toString('hex');
const same=(p,h)=>{try{const[s,k]=h.split(':');return crypto.timingSafeEqual(Buffer.from(k,'hex'),crypto.scryptSync(String(p),s,64))}catch(e){return false}};
const eq=(a,b)=>crypto.timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)));

/* one-time email codes (kept in memory, valid 10 minutes, 5 tries) */
const PEND={},HITS={};
const limit=(key,max,ms)=>{const n=Date.now();HITS[key]=(HITS[key]||[]).filter(t=>n-t<ms);if(HITS[key].length>=max)return false;HITS[key].push(n);return true};
async function sendMail(to,subject,text){
 if(!BREVO_KEY||!MAIL_FROM){console.log(`\n[DEV MAIL - no email service set] To: ${to}\n${subject}\n${text}\n`);return true}
 const r=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':BREVO_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'TRIX Pharmacy',email:MAIL_FROM},to:[{email:to}],subject,textContent:text})});
 return r.ok;
}
const BASE=(process.env.PUBLIC_URL||'http://localhost:'+PORT).replace(/\/$/,'');
function makeToken(kind,email,extra,ttl){
 const t=rnd(24);
 PEND[kind+':'+email]={h:sha(t),exp:Date.now()+ttl,tries:0,...extra};
 return t;
}
function checkToken(kind,email,token){
 const p=PEND[kind+':'+email];
 if(!p||p.exp<Date.now())return null;
 if(p.tries++>=10){delete PEND[kind+':'+email];return null}
 return eq(sha(String(token).trim()),p.h)?p:null;
}
const actCode=()=>{const al='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',b=crypto.randomBytes(10);let t='';for(const x of b)t+=al[x%al.length];return 'TRX-'+t.slice(0,5)+'-'+t.slice(5)};

const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
const bad=(res,c,e)=>send(res,c,{error:e});
const readBody=req=>new Promise((ok,no)=>{let d='',n=0;req.on('data',c=>{n+=c.length;if(n>2e6){no(new Error('Too large'));req.destroy()}else d+=c});req.on('end',()=>{try{ok(d?JSON.parse(d):{})}catch(e){no(e)}});req.on('error',no)});
const cleanEmail=e=>String(e||'').trim().toLowerCase();
const okEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)&&e.length<=120;
const findUser=e=>DB.users.find(u=>u.email===e);
const newSession=(u,ttl=30*864e5,imp=false)=>{const t=rnd(32);DB.sessions[sha(t)]={uid:u.id,exp:Date.now()+ttl,imp};save();return t};
const dropSessions=uid=>{for(const k of Object.keys(DB.sessions))if(DB.sessions[k].uid===uid)delete DB.sessions[k]};
const findInvite=e=>{for(const[id,o]of Object.entries(DB.orgs)){const i=(o.invites||[]).find(x=>x.email===e&&Date.now()-x.at<14*864e5);if(i)return{org:id,inv:i}}return null};
const ip=req=>req.socket.remoteAddress||'?';

function auth(req){
 const t=(req.headers.authorization||'').slice(7),s=DB.sessions[sha(t)];
 if(!s||s.exp<Date.now())return null;
 const u=DB.users.find(x=>x.id===s.uid);
 return u?{u,o:DB.orgs[u.org],t,owner:u.role==='Owner',imp:!!s.imp}:null;
}
// returns the signed-in account, or sends the error and returns null
function need(req,res,{owner=false,paid=false}={}){
 const a=auth(req);
 if(!a){bad(res,401,'Please sign in.');return null}
 if(owner&&!a.owner){bad(res,403,'Only the owner can do this.');return null}
 if(paid&&a.o.paidUntil<=Date.now()){bad(res,402,'Subscription not active.');return null}
 return a;
}

const R={
 'POST /api/signup/start':async(req,res,b)=>{
  const name=String(b.name||'').trim().slice(0,80),e=cleanEmail(b.email),p=String(b.pass||'');
  if(!name||!okEmail(e))return bad(res,400,'Enter your name and a valid email address.');
  if(p.length<8)return bad(res,400,'Use a password with at least 8 characters.');
  if(findUser(e))return bad(res,409,'That email already has an account. Sign in instead.');
  if(!limit('code:'+e,3,10*60e3)||!limit('codeip:'+ip(req),10,10*60e3))return bad(res,429,'Too many codes requested. Wait a few minutes.');
  const iv=findInvite(e);
  const t=makeToken('up',e,{name,hash:hash(p),org:iv&&iv.org},24*3600e3);
  const sent=await sendMail(e,'Confirm your TRIX Pharmacy account',`Hello ${name},\n\nPlease confirm that this email address is yours by opening this link:\n${BASE}/?verify=${t}&e=${encodeURIComponent(e)}\n\nThe link works for 24 hours. If you did not create this account, ignore this email.`);
  if(!sent)return bad(res,502,'Could not send the email. Try again shortly.');
  send(res,200,{ok:1});
 },
 'POST /api/signup/verify':async(req,res,b)=>{
  const e=cleanEmail(b.email),p=checkToken('up',e,b.token);
  if(!p)return bad(res,400,'That link is invalid or has expired. Create the account again.');
  if(findUser(e))return bad(res,409,'That email already has an account.');
  delete PEND['up:'+e];
  let org=p.org,role='Staff';
  if(org&&DB.orgs[org]&&(DB.orgs[org].invites||[]).some(i=>i.email===e)){DB.orgs[org].invites=DB.orgs[org].invites.filter(i=>i.email!==e)}
  else{org=rnd(8);role='Owner';DB.orgs[org]={db:null,rev:0,paidUntil:0,pending:[],invites:[],createdAt:Date.now()}}
  const u={id:rnd(8),name:p.name,email:e,hash:p.hash,role,org,createdAt:Date.now()};
  DB.users.push(u);
  if(role==='Owner')sendMail(DEV_EMAIL,'New TRIX account: '+u.name,`A new pharmacy account was created and its email address was confirmed.\n\nName: ${u.name}\nEmail: ${u.email}\nTime: ${new Date().toLocaleString()}\nStatus: locked until payment.\n\nTo give them access: when they pay, check the payment and press "Confirm and email code" in your console, or open Pharmacies and press "Extend 30 days".\nConsole: ${BASE}/admin.html`).catch(()=>{});
  send(res,200,{token:newSession(u)});
 },
 'POST /api/login':async(req,res,b)=>{
  const e=cleanEmail(b.email);
  if(!limit('login:'+e,8,15*60e3)||!limit('loginip:'+ip(req),30,15*60e3))return bad(res,429,'Too many attempts. Wait 15 minutes and try again.');
  const u=findUser(e);
  if(!u||!same(b.pass,u.hash))return bad(res,401,'Email or password is incorrect. Check both and try again.');
  send(res,200,{token:newSession(u)});
 },
 'POST /api/reset/start':async(req,res,b)=>{
  const e=cleanEmail(b.email);
  if(!okEmail(e))return bad(res,400,'Enter a valid email address.');
  if(!limit('code:'+e,3,10*60e3)||!limit('codeip:'+ip(req),10,10*60e3))return bad(res,429,'Too many codes requested. Wait a few minutes.');
  if(findUser(e)){const t=makeToken('rs',e,{},3600e3);await sendMail(e,'Reset your TRIX Pharmacy password',`We received a request to reset your password.\nOpen this link to choose a new password (valid for 1 hour):\n${BASE}/?reset=${t}&e=${encodeURIComponent(e)}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`)}
  send(res,200,{ok:1}); // same answer whether or not the account exists
 },
 'POST /api/reset/finish':async(req,res,b)=>{
  const e=cleanEmail(b.email),p=checkToken('rs',e,b.token),pw=String(b.pass||'');
  if(!p)return bad(res,400,'That link is invalid or has expired. Ask for a new one.');
  if(pw.length<8)return bad(res,400,'Use a new password with at least 8 characters.');
  const u=findUser(e);if(!u)return bad(res,400,'That link is invalid or has expired. Ask for a new one.');
  delete PEND['rs:'+e];u.hash=hash(pw);dropSessions(u.id);save();send(res,200,{ok:1});
 },
 'POST /api/logout':async(req,res)=>{const a=auth(req);if(a){delete DB.sessions[sha(a.t)];save()}send(res,200,{ok:1})},
 'GET /api/me':async(req,res)=>{
  const a=need(req,res);if(!a)return;
  send(res,200,{user:{name:a.u.name,email:a.u.email,role:a.u.role,imp:a.imp},bill:{paidUntil:a.o.paidUntil,pending:a.owner?a.o.pending:[],codeSent:a.owner&&!!(a.o.act&&a.o.act.exp>Date.now())}});
 },
 'GET /api/db':async(req,res)=>{
  const a=need(req,res,{paid:true});if(!a)return;
  send(res,200,{db:a.o.db,rev:a.o.rev||0});
 },
 'PUT /api/db':async(req,res,b)=>{
  const a=need(req,res,{paid:true});if(!a)return;
  if(!b||typeof b.db!=='object'||!b.db||Array.isArray(b.db))return bad(res,400,'Bad data.');
  if(b.rev!==(a.o.rev||0))return bad(res,409,'Data was changed by a teammate.');
  a.o.db=b.db;a.o.rev=(a.o.rev||0)+1;save();send(res,200,{rev:a.o.rev});
 },
 'POST /api/pay':async(req,res,b)=>{
  const a=need(req,res,{owner:true});if(!a)return;
  const ref=String(b.ref||'').trim().slice(0,60);
  if(ref.length<4)return bad(res,400,'Enter the transaction reference from your payment.');
  if(!limit('pay:'+a.u.id,5,60*60e3))return bad(res,429,'Too many submissions. Try again later.');
  const m=b.m==='MoMo'?'MoMo':'Equity Bank',norm=ref.toUpperCase().replace(/\s+/g,'');
  const dup=DB.pays.filter(p=>p.norm===norm&&p.org!==a.u.org);
  a.o.pending=a.o.pending.slice(-9);
  a.o.pending.push({m,ref,at:new Date().toISOString()});
  DB.pays.push({id:rnd(6),org:a.u.org,email:a.u.email,name:a.u.name,m,ref,norm,at:Date.now(),status:'pending'});
  DB.pays=DB.pays.slice(-2000);save();
  await sendMail(DEV_EMAIL||'(no developer email set)','TRIX payment reference to check: '+ref,`A customer submitted a payment reference.\n\nPharmacy owner: ${a.u.name} (${a.u.email})\nMethod: ${m}\nReference: ${ref}\nExpected amount: 500,000 FRW\nTime: ${new Date().toLocaleString()}\n${dup.length?'\nWARNING: this reference was also submitted by: '+dup.map(d=>d.email).join(', ')+'\n':''}\nCheck it against your ${m} statement. If it matches, open the admin console and press "Confirm and email code". If it does not match, press "Reject".`);
  send(res,200,{ok:1});
 },
 'POST /api/activate':async(req,res,b)=>{
  const a=need(req,res,{owner:true});if(!a)return;
  if(!limit('act:'+a.u.id,8,15*60e3))return bad(res,429,'Too many attempts. Wait 15 minutes and try again.');
  const o=a.o,c=String(b.code||'').trim().toUpperCase();
  if(!o.act||o.act.exp<Date.now()||!eq(sha(c),o.act.h))return bad(res,400,'That activation code is not valid.');
  o.paidUntil=Math.max(Date.now(),o.paidUntil)+30*864e5;delete o.act;save();send(res,200,{ok:1});
 },
 /* team: owner only */
 'GET /api/team':async(req,res)=>{
  const a=need(req,res,{owner:true});if(!a)return;
  send(res,200,{staff:DB.users.filter(u=>u.org===a.u.org).map(u=>({id:u.id,name:u.name,email:u.email,role:u.role})),invites:(a.o.invites||[]).map(i=>({email:i.email,name:i.name}))});
 },
 'POST /api/team/invite':async(req,res,b)=>{
  const a=need(req,res,{owner:true});if(!a)return;
  const e=cleanEmail(b.email),name=String(b.name||'').trim().slice(0,80);
  if(!okEmail(e))return bad(res,400,'Enter a valid email address for your staff member.');
  if(findUser(e))return bad(res,409,'That email already has an account.');
  if(DB.users.filter(u=>u.org===a.u.org).length+(a.o.invites||[]).length>=25)return bad(res,400,'Team limit reached.');
  if(!limit('inv:'+a.u.id,10,60*60e3))return bad(res,429,'Too many invitations. Try again later.');
  a.o.invites=(a.o.invites||[]).filter(i=>i.email!==e);a.o.invites.push({email:e,name,at:Date.now()});save();
  await sendMail(e,'You are invited to TRIX Pharmacy',`${a.u.name} invited you to join their pharmacy on TRIX Pharmacy as staff.\nOpen ${BASE}, choose "Create account", and use this same email address (${e}).\nYou will then receive an email with a link to confirm it.`);
  send(res,200,{ok:1});
 },
 'POST /api/team/remove':async(req,res,b)=>{
  const a=need(req,res,{owner:true});if(!a)return;
  if(b.email){a.o.invites=(a.o.invites||[]).filter(i=>i.email!==cleanEmail(b.email));save();return send(res,200,{ok:1})}
  const u=DB.users.find(x=>x.id===b.id&&x.org===a.u.org);
  if(!u||u.role==='Owner')return bad(res,404,'No such staff member.');
  DB.users=DB.users.filter(x=>x.id!==u.id);dropSessions(u.id);save();send(res,200,{ok:1});
 }
};
const orgView=id=>{
 const o=DB.orgs[id];if(!o)return null;
 const us=DB.users.filter(u=>u.org===id),ow=us.find(u=>u.role==='Owner'),d=o.db||{};
 return{id,createdAt:o.createdAt||0,paidUntil:o.paidUntil||0,name:d.name||'',owner:ow?{id:ow.id,name:ow.name,email:ow.email}:null,
  staff:us.filter(u=>u.role!=='Owner').map(u=>({id:u.id,name:u.name,email:u.email})),codeOut:!!(o.act&&o.act.exp>Date.now()),
  stats:{meds:(d.meds||[]).length,sales:(d.sales||[]).length,patients:(d.pats||[]).length}};
};
const withDup=p=>({...p,dup:DB.pays.filter(x=>x.norm===p.norm&&x.id!==p.id&&x.org!==p.org).map(x=>({email:x.email,status:x.status}))});
const A={ // you only (needs ADMIN_KEY)
 'GET /api/admin/overview':async(req,res)=>send(res,200,{orgs:Object.keys(DB.orgs).map(orgView),pays:DB.pays.filter(p=>p.status==='pending').map(withDup),audit:DB.audit.slice(0,60)}),
 'POST /api/admin/org/get':async(req,res,b)=>{const o=DB.orgs[b.id];if(!o)return bad(res,404,'No such pharmacy.');audit('viewed data',(orgView(b.id).owner||{}).email);save();send(res,200,{db:o.db,rev:o.rev||0})},
 'POST /api/admin/org/save':async(req,res,b)=>{
  const o=DB.orgs[b.id];if(!o)return bad(res,404,'No such pharmacy.');
  if(!b.db||typeof b.db!=='object'||Array.isArray(b.db))return bad(res,400,'The data must be a JSON object.');
  o.db=b.db;o.rev=(o.rev||0)+1;audit('edited data',(orgView(b.id).owner||{}).email);save();send(res,200,{ok:1});
 },
 'POST /api/admin/org/access':async(req,res,b)=>{
  const o=DB.orgs[b.id];if(!o)return bad(res,404,'No such pharmacy.');
  const days=Number(b.days);if(!Number.isFinite(days)||days<0||days>366)return bad(res,400,'Days must be between 0 and 366.');
  o.paidUntil=days===0?0:Math.max(Date.now(),o.paidUntil||0)+days*864e5;
  audit(days===0?'suspended':'extended '+days+' days',(orgView(b.id).owner||{}).email);save();send(res,200,{ok:1,paidUntil:o.paidUntil});
 },
 'POST /api/admin/payment/confirm':async(req,res,b)=>{
  const u=findUser(cleanEmail(b.email));if(!u||u.role!=='Owner')return bad(res,404,'No such owner account.');
  const mine=DB.pays.filter(p=>p.org===u.org&&p.status==='pending');
  const clash=mine.find(p=>DB.pays.some(x=>x.norm===p.norm&&x.org!==p.org&&x.status==='confirmed'));
  if(clash&&!b.force)return bad(res,409,'The reference '+clash.ref+' was already confirmed for another pharmacy. Check it before continuing.');
  mine.forEach(p=>{p.status='confirmed'});
  const o=DB.orgs[u.org],code=actCode();
  o.act={h:sha(code),exp:Date.now()+30*864e5};o.pending=[];audit('confirmed payment, code emailed',u.email);save();
  const emailed=await sendMail(u.email,'Your TRIX Pharmacy activation code',`Hello ${u.name},\n\nWe received your payment. Your activation code is:\n\n${code}\n\nOpen TRIX Pharmacy, go to Plans & billing, type this code and press Activate.\nIt unlocks 30 days and works only once.\n`);
  send(res,200,{ok:1,emailed});
 },
 'POST /api/admin/payment/reject':async(req,res,b)=>{
  const u=findUser(cleanEmail(b.email));if(!u||u.role!=='Owner')return bad(res,404,'No such owner account.');
  DB.pays.filter(p=>p.org===u.org&&p.status==='pending').forEach(p=>{p.status='rejected'});
  DB.orgs[u.org].pending=[];audit('rejected payment reference',u.email);save();
  const emailed=await sendMail(u.email,'We could not match your TRIX payment',`Hello ${u.name},\n\nWe could not find a payment that matches the reference you sent. Please check the reference on your payment message and send it again in Plans & billing.\n${String(b.reason||'').slice(0,300)}\n`);
  send(res,200,{ok:1,emailed});
 },
 'POST /api/admin/user/reset':async(req,res,b)=>{
  const u=DB.users.find(x=>x.id===b.id);if(!u)return bad(res,404,'No such user.');
  const t=makeToken('rs',u.email,{},3600e3);
  const emailed=await sendMail(u.email,'Reset your TRIX Pharmacy password',`A password reset was requested for your account.\nOpen this link to choose a new password (valid for 1 hour):\n${BASE}/?reset=${t}&e=${encodeURIComponent(u.email)}\n`);
  audit('sent password reset link',u.email);save();send(res,200,{ok:1,emailed});
 },
 'POST /api/admin/user/impersonate':async(req,res,b)=>{
  const u=DB.users.find(x=>x.id===b.id);if(!u)return bad(res,404,'No such user.');
  audit('opened account (support access)',u.email);send(res,200,{token:newSession(u,3600e3,true)});
 },
 'POST /api/admin/user/edit':async(req,res,b)=>{
  const u=DB.users.find(x=>x.id===b.id);if(!u)return bad(res,404,'No such user.');
  const name=String(b.name||u.name).trim().slice(0,80),e=cleanEmail(b.email||u.email);
  if(!name||!okEmail(e))return bad(res,400,'Enter a name and a valid email.');
  if(e!==u.email&&findUser(e))return bad(res,409,'That email is already used by another account.');
  audit('edited user '+u.email+' -> '+e,e);u.name=name;u.email=e;save();send(res,200,{ok:1});
 },
 'POST /api/admin/user/delete':async(req,res,b)=>{
  if(b.confirm!=='DELETE')return bad(res,400,'Type DELETE to confirm.');
  const u=DB.users.find(x=>x.id===b.id);if(!u)return bad(res,404,'No such user.');
  let removed;
  if(u.role==='Owner'){
   const gone=DB.users.filter(x=>x.org===u.org);
   gone.forEach(x=>{dropSessions(x.id);for(const k of Object.keys(PEND))if(k.endsWith(':'+x.email))delete PEND[k]});
   DB.users=DB.users.filter(x=>x.org!==u.org);delete DB.orgs[u.org];removed=gone.length;
   audit('DELETED pharmacy and '+gone.length+' account(s)',u.email);
  }else{
   dropSessions(u.id);DB.users=DB.users.filter(x=>x.id!==u.id);removed=1;audit('deleted staff account',u.email);
  }
  save();send(res,200,{ok:1,removed});
 }
};

http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://x'),key=req.method+' '+url.pathname;
  if(url.pathname.startsWith('/api/')){
   if(A[key]){
    if(!(ADMIN_KEY&&eq(req.headers['x-admin-key']||'',ADMIN_KEY))){if(!limit('admfail:'+ip(req),10,15*60e3))return bad(res,429,'Too many wrong keys. Wait 15 minutes.');return bad(res,403,'Wrong admin key.')}
    return A[key](req,res,req.method==='POST'?await readBody(req):{});
   }
   if(!R[key])return bad(res,404,'Not found.');
   return R[key](req,res,req.method==='GET'?{}:await readBody(req));
  }
  const f=PUBLIC[url.pathname];
  if(req.method!=='GET'||!f){res.writeHead(404);return res.end('Not found')}
  const h={'Content-Type':TYPES[path.extname(f)],'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(f==='index.html')h['Content-Security-Policy']="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
  res.writeHead(200,h);res.end(fs.readFileSync(path.join(__dirname,f)));
 }catch(e){try{bad(res,400,'Bad request.')}catch(x){}}
}).listen(PORT,()=>console.log('TRIX Pharmacy running on http://localhost:'+PORT));
