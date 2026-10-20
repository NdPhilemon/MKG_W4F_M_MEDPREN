import admin from "firebase-admin";
import crypto from "node:crypto";
import {initFirebase} from "./firebase-init.js";
import {signSession,verifySessionToken,sameSecret} from "../lib/session.js";
import {broadcastPush} from "../lib/push.js";
import {waitUntil} from "@vercel/functions";
import "../sync-core.js";
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
function refs(){initFirebase();const db=admin.firestore();return {db,ROOT:db.collection("mmedpren").doc("global"),ORDERS:db.collection("mmedpren_orders")}}
const arr=v=>Array.isArray(v)?v:[];
async function schedulePush(payload){if(!payload)return;const task=broadcastPush(payload).catch(e=>console.error('PUSH_BROADCAST_ERROR',{code:e.code||'PUSH_ERROR'}));try{waitUntil(task)}catch{await task}}
function send(res,s,p){res.status(s);res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(p))}
function cleanUser(u){if(!u)return null;const {password,...r}=u;return r}
function primaryAdmin(){
  return {
    id:"u-admin",
    name:"Administrateur principal",
    email:"",
    role:"admin",
    shops:["main"],
    permissions:["*"],
    status:"Actif",
    isPrimary:true,
    suspendedUntil:null
  }
}
function mainShop(){
  return {id:"main",name:"Boutique principale",location:"ISP, Bukavu/Sud-Kivu"}
}
function defaults(){
  return {
    revision:0,
    rate:2400,
    mainCurrency:"USD",
    hideMoney:true,
    shopSettings:{phone:"0974112163",rccm:"CD/BKV/RCCM/24-A-01446",receiptLocation:"ISP, Bukavu/Sud-Kivu",correctionWindowMin:10},
    adminProfile:{name:"Administrateur principal",email:"",phone:""},
    shops:[mainShop()],
    users:[primaryAdmin()],
    products:[],
    ads:[],
    sales:[],
    moneyTransactions:[],
    notifications:[],
    updatedAt:new Date().toISOString()
  }
}
function normalizeRoot(raw={}){
  const r={...defaults(),...raw};
  r.shops=arr(r.shops);
  if(!r.shops.some(s=>s?.id==="main"))r.shops.unshift(mainShop());

  r.users=arr(r.users);
  r.moneyTransactions=arr(r.moneyTransactions);
  r.users=r.users.map(u=>u.suspendedUntil&&new Date(u.suspendedUntil)<=new Date()?{...u,status:'Actif',suspendedUntil:null}:u);
  let adminUser=r.users.find(u=>u?.isPrimary)||r.users.find(u=>String(u?.email||"").toLowerCase()===ADMIN_EMAIL);
  if(!adminUser){
    r.users.unshift(primaryAdmin())
  }else{
    adminUser.id=adminUser.id||"u-admin";
    adminUser.role="admin";
    adminUser.isPrimary=true;
    adminUser.permissions=["*"];
    if(!Array.isArray(adminUser.shops)||!adminUser.shops.length)adminUser.shops=["main"];
    adminUser.email=ADMIN_EMAIL||adminUser.email
  }
  return r
}
async function readRoot(){
  const {db,ROOT}=refs();
  return db.runTransaction(async t=>{const s=await t.get(ROOT);if(s.exists)return normalizeRoot(s.data());const d=defaults();t.set(ROOT,d);return d});
}
const error=(status,message,code)=>Object.assign(new Error(message),{status,code});
const can=(a,p)=>a.role==='admin'||arr(a.user.permissions).includes('*')||arr(a.user.permissions).includes(p);
const inShop=(a,id)=>a.role==='admin'||arr(a.user.shops).includes(id);
function identity(root,id){
  const user=arr(root.users).find(u=>u.id===id);
  if(!user||!['admin','manager','seller'].includes(user.role)||
    (user.status==='Suspendu'&&(!user.suspendedUntil||new Date(user.suspendedUntil)>new Date())))throw error(401,'Compte indisponible','ACCOUNT_INVALID');
  return {user,role:user.role,root};
}
export async function authenticate(token){return identity(await readRoot(),verifySessionToken(token).sub)}
async function login(body,req){
  if(!ADMIN_EMAIL||!process.env.ADMIN_PASSWORD)throw error(503,'Configuration administrateur manquante dans Vercel','ADMIN_NOT_CONFIGURED');
  const {db}=refs(),email=String(body.email||'').trim().toLowerCase();
  // Durable throttling: shared by all serverless instances, without storing credentials.
  const id=crypto.createHash('sha256').update(`${email}|${req.headers['x-forwarded-for']||'unknown'}`).digest('hex');
  const ref=db.collection('mmedpren_auth_limits').doc(id);
  await db.runTransaction(async t=>{const snap=await t.get(ref),old=snap.data()||{},now=Date.now();
    const count=now-Number(old.start||0)<900000?Number(old.count||0):0;
    if(count>=10)throw error(429,'Trop de tentatives. Réessayez dans 15 minutes.');
    t.set(ref,{start:count?old.start:now,count:count+1});
  });
  const root=await readRoot();let user;
  if(body.type==='admin'&&email===ADMIN_EMAIL&&sameSecret(body.secret,process.env.ADMIN_PASSWORD))user=root.users.find(u=>u.isPrimary);
  else if(body.type==='staff')user=root.users.find(u=>!u.isPrimary&&String(u.email||'').toLowerCase()===email&&sameSecret(body.secret,u.accessCode));
  if(!user)throw error(401,'Identifiants incorrects','INVALID_CREDENTIALS');
  const a=identity(root,user.id),token=signSession(a.user);
  await ref.delete();return {user:cleanUser(a.user),token,...await stateFor(a)};
}
function publicProduct(p){const {buy,buyCurrency,...safe}=p;return safe}
function publicOrder(o){return {...o,items:arr(o.items).map(({buy,...item})=>item)}}
function privateProduct(p,a){if(can(a,'reports.profit'))return p;const {buy,buyCurrency,...safe}=p;return safe}
function privateSale(s,a){return can(a,'reports.profit')?s:{...s,items:arr(s.items).map(({buy,...item})=>item)}}
function privateMoney(t,a){if(can(a,'reports.profit'))return t;const {fee,...safe}=t;return safe}
async function stateFor(a,sid){
  const r=a?.root||await readRoot(),{ORDERS}=refs();
  const rows=a?await ORDERS.get():sid?await ORDERS.where('visitorSessionId','==',sid).get():{docs:[]};
  const orders=rows.docs.map(d=>d.data().payload).filter(Boolean);
  if(!a)return {revision:r.revision,state:{rate:r.rate,mainCurrency:r.mainCurrency,shopSettings:r.shopSettings,shops:r.shops,
    products:arr(r.products).filter(p=>p.visibleToVisitors!==false&&Number(p.stock)>0).map(publicProduct),
    ads:arr(r.ads).filter(x=>x.active!==false),orders:orders.map(publicOrder)}};
  return {revision:r.revision,...(a?{sessionToken:signSession(a.user)}:{}),state:{rate:r.rate,mainCurrency:r.mainCurrency,hideMoney:r.hideMoney,shopSettings:r.shopSettings,
    adminProfile:a.role==='admin'?r.adminProfile:{},shops:r.shops.filter(s=>inShop(a,s.id)),
    users:a.role==='admin'?r.users.map(cleanUser):[{...cleanUser(a.user),accessCode:null}],
    products:arr(r.products).filter(p=>inShop(a,p.shopId)).map(p=>privateProduct(p,a)),ads:arr(r.ads),
    sales:arr(r.sales).filter(s=>inShop(a,s.shopId)&&(can(a,'sales.all')||s.sellerId===a.user.id)).map(s=>privateSale(s,a)),
    moneyTransactions:(can(a,'money.view')||can(a,'money.manage'))?arr(r.moneyTransactions).filter(t=>inShop(a,t.shopId)).map(t=>privateMoney(t,a)):[],
    orders:orders.filter(o=>inShop(a,o.shopId)&&(a.role==='admin'||(o.status==='waiting'&&can(a,'orders.waiting'))||(o.claimedById===a.user.id&&can(a,'orders.own')))),
    notifications:a.role==='admin'?arr(r.notifications):[]}};
}
function validateMedia(value){
  if(typeof value==='string'&&/^data:/i.test(value))throw error(400,'Envoyez les images via /api/upload avant la synchronisation');
  if(value&&typeof value==='object')Object.values(value).forEach(validateMedia);
}
function validateChanges(changes,a,current){
  const stock=new Map();
  for(const c of changes.filter(c=>c.key==='sales')){
    const old=arr(current.sales).find(x=>x.id===c.id),next=c.after;
    if(old&&c.before&&!can(a,'reports.profit')){
      const visible=s=>({...s,items:arr(s.items).map(({buy,...item})=>item)});
      if(JSON.stringify(visible(old))!==JSON.stringify(c.before)&&JSON.stringify(visible(old))!==JSON.stringify(next))throw error(409,'Vente modifiée à distance','SYNC_CONFLICT');
      c.before=old;
    }
    if(next&&(!Number.isFinite(next.paidTotal)||next.paidTotal<=0||!['USD','CDF'].includes(next.currency)||!arr(next.items).length))throw error(400,'Vente invalide');
    if(next)for(const item of next.items){
      const product=arr(current.products).find(p=>p.id===item.productId&&inShop(a,p.shopId));
      if(!product)throw error(400,'Article de vente invalide');
      const previous=arr(old?.items).find(i=>i.productId===item.productId);
      item.buy=Number(previous?.buy??product.buy);item.sell=Number(item.sell??previous?.sell??product.sell);item.name=String(item.name||product.name);item.photo=item.photo||product.photo||'';item.details=item.details||product.details||'';
      if(!Number.isFinite(item.buy)||item.buy<0||!Number.isFinite(item.sell)||item.sell<0)throw error(400,'Prix invalide');
    }
    if(!can(a,'sales.create')||!inShop(a,(next||old)?.shopId))throw error(403,'Vente non autorisée');
    if(a.role!=='admin'){
      if((old&&old.sellerId!==a.user.id&&!can(a,'sales.all'))||(!old&&next?.sellerId!==a.user.id))throw error(403,'Vente non autorisée');
      if(old&&a.role==='seller'&&Date.now()-new Date(old.createdAt)>Number(current.shopSettings.correctionWindowMin)*60000){
        const onlyRequest=next&&Object.keys({...old,...next}).every(k=>k==='pendingRequest'||JSON.stringify(old[k])===JSON.stringify(next[k]));
        if(!onlyRequest)throw error(403,'Approbation administrateur requise');
      }
      if(!next)throw error(403,'Suppression réservée à un administrateur');
    }
    for(const [sale,sign] of [[old,1],[next,-1]])if(sale&&sale.status!=='Annulée')for(const item of arr(sale.items)){
      if(!Number.isFinite(item.qty)||item.qty<=0)throw error(400,'Quantité invalide');
      stock.set(item.productId,(stock.get(item.productId)||0)+sign*item.qty);
    }
  }
  for(const c of changes){
    if(MkgSync.lists.includes(c.key)&&!safeId(c.id))throw error(400,'Identifiant invalide');
    if(c.after?.id&&c.after.id!==c.id)throw error(400,'Identifiant incohérent');
    if(c.key==='orders')continue;
    if(c.key==='moneyTransactions'){
      const old=arr(current.moneyTransactions).find(t=>t.id===c.id),next=c.after;
      if(!can(a,'money.manage')||!inShop(a,(next||old)?.shopId))throw error(403,'Transaction Mobile Money non autorisée');
      if(next&&(!['deposit','send','withdrawal'].includes(next.type)||!['USD','CDF'].includes(next.currency)||!Number.isFinite(next.amount)||next.amount<=0||!Number.isFinite(next.fee)||next.fee<0||typeof next.network!=='string'||next.network.length>80))throw error(400,'Transaction Mobile Money invalide');
      if(a.role!=='admin'&&((old&&old.agentId!==a.user.id)||(!old&&next?.agentId!==a.user.id)||!next))throw error(403,'Transaction Mobile Money non autorisée');
      continue;
    }
    if(c.key==='users'){
      const primary=arr(current.users).find(u=>u.isPrimary);
      if(primary?.id===c.id&&(!c.after||c.after.role!=='admin'||!c.after.isPrimary))throw error(403,'Compte principal protégé');
      if(c.after?.isPrimary&&c.id!==primary?.id)throw error(403,'Compte principal unique');
    }
    if(c.key==='products'){
      const old=arr(current.products).find(p=>p.id===c.id),next=c.after;
      if(old&&next&&!can(a,'reports.profit')){next.buy=old.buy;next.buyCurrency=old.buyCurrency}
      if(next&&(!Number.isFinite(next.stock)||next.stock<0||!Number.isFinite(next.buy)||next.buy<0||!Number.isFinite(next.sell)||next.sell<0))throw error(400,'Stock ou prix invalide');
      if(!inShop(a,(old||next)?.shopId)||(next&&!inShop(a,next.shopId)))throw error(403,'Boutique non autorisée');
      if(!can(a,'products.edit')){
        if(!old||!next||Object.keys({...old,...next}).some(k=>k!=='stock'&&JSON.stringify(old[k])!==JSON.stringify(next[k])))throw error(403,'Article non autorisé');
        if(Number(next.stock)-Number(c.before?.stock)!==(stock.get(c.id)||0))throw error(403,'Stock sans vente correspondante');
      }
      continue;
    }
    if(a.role!=='admin'&&!['sales','notifications','moneyTransactions'].includes(c.key))throw error(403,'Action réservée à un administrateur');
  }
  if(!can(a,'products.edit'))for(const [id,delta] of stock){
    const c=changes.find(c=>c.key==='products'&&c.id===id);
    if(delta&&(!c||Number(c.after.stock)-Number(c.before?.stock)!==delta))throw error(400,'Stock et ventes incohérents');
  }
}
const safeId=id=>typeof id==='string'&&/^[\w-]{1,150}$/.test(id);
function orderRow(o){return {visitorSessionId:o.visitorSessionId,status:o.status,claimedById:o.claimedById||null,claimedByName:o.claimedByName||null,updatedAt:o.updatedAt,payload:o}}
async function syncPrivate(body,token){
  const sub=verifySessionToken(token).sub,{db,ROOT,ORDERS}=refs();
  let pushPayload=null;
  if(!safeId(body.requestId))throw error(400,'Identifiant de requête requis');
  const receipt=db.collection('mmedpren_sync_receipts').doc(`${sub}-${body.requestId}`);
  await db.runTransaction(async t=>{
    const [rootSnap,done]=await Promise.all([t.get(ROOT),t.get(receipt)]);
    const current=normalizeRoot(rootSnap.data()),a=identity(current,sub);
    if(done.exists)return;
    let changes=body.changes;
    if(!Array.isArray(changes)){
      if(Number(body.baseRevision)!==Number(current.revision))throw error(409,'Ancienne file locale : réconciliation nécessaire avant envoi','SYNC_CONFLICT');
      changes=MkgSync.diff({...current,orders:[]},body.state||{}).filter(c=>c.key!=='orders');
    }
    if(changes.length>150)throw error(413,'Trop de modifications dans un seul envoi');
    const addedNotification=changes.find(c=>c.key==='notifications'&&!c.before&&c.after);
    if(addedNotification)pushPayload={title:String(addedNotification.after.title||"M'MEDPREN").slice(0,120),body:String(addedNotification.after.body||'').slice(0,500),url:'/#home',tag:addedNotification.id};
    // Legacy rows may still contain Base64 in `before`; only the new value must be URL-only.
    for(const change of changes)validateMedia(change?.after);
    validateChanges(changes,a,current);
    const orderChanges=changes.filter(c=>c.key==='orders');
    const orderDocs=[];
    for(const c of orderChanges){if(!safeId(c.id))throw error(400,'Commande invalide');orderDocs.push(await t.get(ORDERS.doc(c.id)))}
    const next=MkgSync.merge(current,changes.filter(c=>c.key!=='orders'));
    // Strip legacy passwords even when the old document still contains them.
    next.users=arr(next.users).map(cleanUser);
    for(let i=0;i<orderChanges.length;i++){
      const c=orderChanges[i],old=orderDocs[i].data()?.payload;
      if(!old||!c.after)throw error(403,'Création/suppression de commande interdite');
      if(!inShop(a,old.shopId)||(a.role!=='admin'&&(old.claimedById!==sub||!can(a,'orders.own'))))throw error(403,'Commande attribuée à un autre agent');
      for(const key of ['visitorSessionId','claimedById','claimedByName','claimedAt','items','shopId'])if(JSON.stringify(c.after[key])!==JSON.stringify(old[key]))throw error(409,'Commande modifiée à distance');
      if(c.after.status!==old.status&&!(old.status==='claimed'&&c.after.status==='completed'))throw error(403,'Transition de commande interdite');
      const merged=MkgSync.merge({orders:[old]},[c]).orders[0];
      if(merged.status==='completed'&&!arr(next.sales).some(s=>s.id===merged.saleId&&s.sourceOrderId===merged.id))throw error(400,'Vente de commande manquante');
      t.set(ORDERS.doc(c.id),orderRow(merged));
    }
    next.revision=Number(current.revision||0)+1;next.updatedAt=new Date().toISOString();
    t.set(ROOT,next);t.set(receipt,{createdAt:new Date(),revision:next.revision});
  });
  const state=await stateFor(await authenticate(token));await schedulePush(pushPayload);return state;
}
async function syncPublic(body){
  const sid=body.visitorSessionId,{db,ROOT,ORDERS}=refs();
  let pushPayload=null;
  if(!safeId(sid)||!Array.isArray(body.orders)||body.orders.length>50)throw error(400,'Session ou commandes invalides');
  await db.runTransaction(async t=>{
    const rootSnap=await t.get(ROOT),root=normalizeRoot(rootSnap.data()),writes=[];
    for(const incoming of body.orders){
      if(!safeId(incoming.id))throw error(400,'Commande invalide');
      const ref=ORDERS.doc(incoming.id),snap=await t.get(ref),old=snap.data()?.payload;
      if(old&&old.visitorSessionId!==sid)throw error(403,'Commande non autorisée');
      let o=old;
      if(!o){
        const items=arr(incoming.items).map(i=>{const p=root.products.find(p=>p.id===i.productId&&p.visibleToVisitors!==false&&p.shopId==='main');
          if(!p||!Number.isInteger(i.qty)||i.qty<1||i.qty>p.stock)throw error(400,'Article indisponible');
          return {productId:p.id,name:p.name,qty:i.qty,sell:p.sell,buy:p.buy};});
        if(!items.length)throw error(400,'Commande vide');
        o={id:incoming.id,code:`CMD-${incoming.id.slice(-8).toUpperCase()}`,visitorSessionId:sid,visitorName:String(incoming.visitorName||'').slice(0,120),whatsapp:String(incoming.whatsapp||'').slice(0,40),shopId:'main',items,status:'waiting',claimedById:null,claimedByName:null,createdAt:new Date().toISOString(),messages:[]};
        pushPayload={title:'Nouvelle commande',body:`${o.visitorName||'Un visiteur'} a envoyé ${o.code}.`,url:'/#orders',tag:o.id};
      }
      const messages=new Map(arr(o.messages).map(m=>[m.id,m]));
      if(!['completed','cancelled'].includes(o.status))for(const m of arr(incoming.messages))if(safeId(m.id)&&!messages.has(m.id))messages.set(m.id,{id:m.id,senderType:'visitor',senderId:sid,senderName:o.visitorName||'Visiteur',text:String(m.text||'').slice(0,4000),at:new Date().toISOString()});
      const merged={...o,messages:[...messages.values()]};
      if(!old||JSON.stringify(old.messages)!==JSON.stringify(merged.messages)){merged.updatedAt=new Date().toISOString();writes.push([ref,merged])}
    }
    for(const [ref,o] of writes)t.set(ref,orderRow(o));
    if(writes.length)t.set(ROOT,{...root,revision:Number(root.revision||0)+1,updatedAt:new Date().toISOString()});
  });
  const state=await stateFor(null,sid);await schedulePush(pushPayload);return state;
}
async function claimOrder(body,token){
  const sub=verifySessionToken(token).sub,{db,ROOT,ORDERS}=refs();
  if(!safeId(body.orderId))throw error(400,'Commande invalide');
  return db.runTransaction(async t=>{
    const rootSnap=await t.get(ROOT),orderSnap=await t.get(ORDERS.doc(body.orderId));
    const root=normalizeRoot(rootSnap.data()),a=identity(root,sub),old=orderSnap.data()?.payload;
    if(!old||!inShop(a,old.shopId)||!can(a,'orders.waiting'))throw error(403,'Commande non autorisée');
    if(old.status!=='waiting'||old.claimedById)throw error(409,'Commande déjà récupérée');
    const now=new Date().toISOString(),order={...old,status:'claimed',claimedById:sub,claimedByName:a.user.name,claimedAt:now,updatedAt:now,
      messages:[...arr(old.messages),{id:`msg-${crypto.randomUUID()}`,senderType:a.role==='admin'?'admin':'agent',senderId:sub,senderName:a.user.name,text:'Bonjour, je vais vous assister pour finaliser votre commande.',at:now}]};
    const revision=Number(root.revision||0)+1;t.set(ORDERS.doc(order.id),orderRow(order));t.set(ROOT,{...root,revision,updatedAt:now});
    return {order,revision};
  });
}
export default async function handler(req,res){
  try{
    let result;
    if(req.method==='GET'){
      const scope=req.query?.scope||'public';
      if(scope==='revision'){const root=await readRoot();result={revision:root.revision}}
      else if(scope==='public')result=await stateFor(null,String(req.query?.visitorSessionId||''));
      else result=await stateFor(await authenticate(req.headers['x-sync-token']));
    }else if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
      if(body.action==='auth')result=await login(body,req);
      else if(body.action==='syncPublic')result=await syncPublic(body);
      else if(body.action==='sync')result=await syncPrivate(body,body.auth?.token);
      else if(body.action==='claimOrder')result=await claimOrder(body,body.auth?.token);
      else throw error(400,'Action inconnue');
    }else throw error(405,'Méthode non autorisée');
    return send(res,200,{ok:true,provider:'firebase',...result});
  }catch(e){
    const status=e instanceof SyntaxError?400:e.status||500;
    console.error('FIREBASE_SYNC_API',{status,code:e.code||'SERVER_ERROR'});
    const configurationError=['ADMIN_NOT_CONFIGURED','SESSION_NOT_CONFIGURED'].includes(e.code);
    const publicError=configurationError?e.message:status>=500?'Service temporairement indisponible':e.message;
    return send(res,status,{ok:false,provider:'firebase',code:e.code||'SERVER_ERROR',error:publicError});
  }
}
