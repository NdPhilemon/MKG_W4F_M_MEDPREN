import admin from "firebase-admin";
import crypto from "node:crypto";
import {initFirebase} from "./firebase-init.js";
initFirebase();
const db=admin.firestore(),ROOT=db.collection("mmedpren").doc("global"),ORDERS=db.collection("mmedpren_orders");
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"ndagonywaphilemon@gmail.com").toLowerCase(),ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"202020";

const SESSION_SECRET=process.env.SESSION_SECRET||ADMIN_PASSWORD;
function b64url(input){return Buffer.from(input).toString("base64url")}
function signSession(user,role){
  const payload=b64url(JSON.stringify({sub:user.id,email:user.email||"",role,exp:Date.now()+30*24*60*60*1000}));
  const sig=crypto.createHmac("sha256",SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`
}
function verifySessionToken(token){
  try{
    const [payload,sig]=String(token||"").split(".");if(!payload||!sig)return null;
    const expected=crypto.createHmac("sha256",SESSION_SECRET).update(payload).digest("base64url");
    const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!data?.sub||!data?.exp||Date.now()>Number(data.exp))return null;
    return data
  }catch(e){return null}
}

const arr=v=>Array.isArray(v)?v:[];
function send(res,s,p){res.status(s);res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(p))}
function cleanUser(u){if(!u)return null;const {password,...r}=u;return r}
function primaryAdmin(){
  return {
    id:"u-admin",
    name:"Administrateur principal",
    email:ADMIN_EMAIL,
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
    adminProfile:{name:"Administrateur principal",email:ADMIN_EMAIL,phone:""},
    shops:[mainShop()],
    users:[primaryAdmin()],
    products:[],
    ads:[],
    sales:[],
    notifications:[],
    updatedAt:new Date().toISOString()
  }
}
function normalizeRoot(raw={}){
  const r={...defaults(),...raw};
  r.shops=arr(r.shops);
  if(!r.shops.some(s=>s?.id==="main"))r.shops.unshift(mainShop());

  r.users=arr(r.users);
  let adminUser=r.users.find(u=>u?.isPrimary)||r.users.find(u=>String(u?.email||"").toLowerCase()===ADMIN_EMAIL);
  if(!adminUser){
    r.users.unshift(primaryAdmin())
  }else{
    adminUser.id=adminUser.id||"u-admin";
    adminUser.role="admin";
    adminUser.isPrimary=true;
    adminUser.permissions=["*"];
    if(!Array.isArray(adminUser.shops)||!adminUser.shops.length)adminUser.shops=["main"];
    adminUser.email=adminUser.email||ADMIN_EMAIL
  }
  return r
}
async function readRoot(){
  const s=await ROOT.get();
  if(!s.exists){
    const d=defaults();
    await ROOT.set(d);
    return d
  }
  const before=s.data()||{};
  const normalized=normalizeRoot(before);
  const needsRepair=
    !Array.isArray(before.shops)||!before.shops.some(x=>x?.id==="main")||
    !Array.isArray(before.users)||!before.users.some(x=>x?.isPrimary||String(x?.email||"").toLowerCase()===ADMIN_EMAIL);
  if(needsRepair){
    await ROOT.set({
      shops:normalized.shops,
      users:normalized.users,
      adminProfile:normalized.adminProfile,
      updatedAt:new Date().toISOString()
    },{merge:true})
  }
  return normalized
}
async function allOrders(){const s=await ORDERS.get();return s.docs.map(d=>d.data().payload).filter(Boolean)}
async function visitorOrders(id){if(!id)return[];const s=await ORDERS.where("visitorSessionId","==",id).get();return s.docs.map(d=>d.data().payload).filter(Boolean)}
async function upsertOrders(os){const v=arr(os).filter(o=>o?.id);if(!v.length)return;const b=db.batch();for(const o of v)b.set(ORDERS.doc(o.id),{visitorSessionId:o.visitorSessionId||null,status:o.status||"waiting",claimedById:o.claimedById||null,claimedByName:o.claimedByName||null,updatedAt:o.updatedAt||new Date().toISOString(),payload:o},{merge:true});await b.commit()}
async function bump(){return db.runTransaction(async t=>{const s=await t.get(ROOT),n=(s.exists?Number(s.data().revision||0):0)+1;t.set(ROOT,{revision:n,updatedAt:new Date().toISOString()},{merge:true});return n})}
async function auth(a){
  const root=await readRoot(),users=arr(root.users);
  const tokenData=verifySessionToken(a?.token);
  if(tokenData){
    if(tokenData.role==="admin"){
      const stored=users.find(u=>u.id===tokenData.sub)||users.find(u=>u.isPrimary)||primaryAdmin();
      return {role:"admin",user:{...stored,role:"admin",isPrimary:true,permissions:["*"]},root}
    }
    const stored=users.find(u=>u.id===tokenData.sub);
    if(!stored||stored.status==="Suspendu"||(stored.suspendedUntil&&new Date(stored.suspendedUntil)>new Date()))return null;
    return {role:stored.role||"seller",user:stored,root}
  }
  if(!a?.email||!a?.secret)return null;
  const email=String(a.email).toLowerCase();
  if(a.type==="admin"&&email===ADMIN_EMAIL&&String(a.secret)===String(ADMIN_PASSWORD)){
    const stored=users.find(u=>String(u.email||"").toLowerCase()===email)||users.find(u=>u.isPrimary)||primaryAdmin();
    return {role:"admin",user:{...stored,role:"admin",isPrimary:true,permissions:["*"]},root}
  }
  const user=users.find(u=>String(u.email||"").toLowerCase()===email&&String(u.accessCode||"")===String(a.secret));
  if(!user||user.status==="Suspendu"||(user.suspendedUntil&&new Date(user.suspendedUntil)>new Date()))return null;
  return {role:user.role||"seller",user,root}
}
async function privateState(a){
  const r=normalizeRoot(a.root||await readRoot());
  const adminUsers=arr(r.users);
  if(a.role==="admin"&&!adminUsers.some(u=>u.id===a.user.id)){
    adminUsers.unshift(a.user)
  }
  return {
    rate:Number(r.rate||2400),
    mainCurrency:r.mainCurrency||"USD",
    hideMoney:!!r.hideMoney,
    shopSettings:r.shopSettings||{},
    adminProfile:r.adminProfile||{},
    shops:arr(r.shops),
    users:a.role==="admin"?adminUsers.map(cleanUser):[cleanUser(a.user)],
    products:arr(r.products),
    ads:arr(r.ads),
    sales:arr(r.sales),
    orders:await allOrders(),
    notifications:arr(r.notifications)
  }
}
async function publicState(sid){const r=await readRoot();return {rate:Number(r.rate||2400),mainCurrency:r.mainCurrency||"USD",shopSettings:r.shopSettings||{},shops:arr(r.shops),products:arr(r.products).filter(p=>p&&p.visibleToVisitors!==false&&Number(p.stock||0)>0),ads:arr(r.ads).filter(a=>a?.active!==false),orders:await visitorOrders(sid)}}
function deletes(state,ops){let users=arr(state.users),products=arr(state.products),ads=arr(state.ads),sales=arr(state.sales);for(const op of arr(ops)){const p=op?.payload||{};if(op.type==="product.delete"&&p.productId)products=products.filter(x=>x.id!==p.productId);if(op.type==="ad.delete"&&p.adId)ads=ads.filter(x=>x.id!==p.adId);if(op.type==="staff.delete"&&p.userId)users=users.filter(x=>x.id!==p.userId||x.isPrimary);if(op.type==="report.reset"&&Array.isArray(p.saleIds)){const ids=new Set(p.saleIds);sales=sales.filter(x=>!ids.has(x.id))}}return{users,products,ads,sales}}
async function writeAdmin(s,ops){
  const x=deletes(s,ops);
  let users=x.users.map(u=>{const{password,...r}=u;return r});
  if(!users.some(u=>u?.isPrimary||String(u?.email||"").toLowerCase()===ADMIN_EMAIL)){
    users.unshift(primaryAdmin())
  }
  let shops=arr(s.shops);
  if(!shops.some(sh=>sh?.id==="main"))shops.unshift(mainShop());

  await ROOT.set({
    rate:Number(s.rate||2400),
    mainCurrency:s.mainCurrency||"USD",
    hideMoney:!!s.hideMoney,
    shopSettings:s.shopSettings||{},
    adminProfile:s.adminProfile||{},
    shops,
    users,
    products:x.products,
    ads:x.ads,
    sales:x.sales,
    notifications:arr(s.notifications),
    updatedAt:new Date().toISOString()
  },{merge:true});
  await upsertOrders(s.orders)
}
async function writeStaff(s,a){const r=await readRoot(),sm=new Map(arr(r.sales).map(x=>[x.id,x]));for(const x of arr(s.sales))if(x?.id)sm.set(x.id,x);const pm=new Map(arr(r.products).map(x=>[x.id,x])),can=a.role==="manager"&&arr(a.user.permissions).includes("products.edit");for(const x of arr(s.products)){if(!x?.id)continue;const cur=pm.get(x.id);if(can)pm.set(x.id,x);else if(cur)pm.set(x.id,{...cur,stock:Number(x.stock||0)})}await ROOT.set({sales:[...sm.values()],products:[...pm.values()],updatedAt:new Date().toISOString()},{merge:true});await upsertOrders(s.orders)}
async function syncPublic(body){const sid=String(body.visitorSessionId||"");if(!sid)throw Object.assign(new Error("Session visiteur manquante"),{status:400});for(const o of arr(body.orders).filter(o=>o?.id&&o.visitorSessionId===sid)){const ref=ORDERS.doc(o.id);await db.runTransaction(async t=>{const s=await t.get(ref);if(!s.exists){t.set(ref,{visitorSessionId:sid,status:o.status||"waiting",claimedById:o.claimedById||null,claimedByName:o.claimedByName||null,updatedAt:o.updatedAt||new Date().toISOString(),payload:o});return}const row=s.data(),server=row.payload||{},mm=new Map([...arr(server.messages),...arr(o.messages)].filter(Boolean).map(m=>[m.id,m])),adv=["claimed","completed","cancelled"].includes(row.status||server.status),merged={...o,...(adv?{status:row.status||server.status,claimedById:row.claimedById||server.claimedById,claimedByName:row.claimedByName||server.claimedByName,claimedAt:server.claimedAt,completedAt:server.completedAt,saleId:server.saleId}:{}),visitorSessionId:sid,messages:[...mm.values()],updatedAt:new Date().toISOString()};t.set(ref,{visitorSessionId:sid,status:merged.status||"waiting",claimedById:merged.claimedById||null,claimedByName:merged.claimedByName||null,updatedAt:merged.updatedAt,payload:merged},{merge:true})})}const revision=await bump();return{revision,state:await publicState(sid)}}
export default async function handler(req,res){try{if(req.method==="GET"){const scope=String(req.query.scope||"public");if(scope==="revision"){const r=await readRoot();return send(res,200,{ok:true,provider:"firebase",revision:Number(r.revision||0),updatedAt:r.updatedAt||null})}if(scope==="public"){const r=await readRoot();return send(res,200,{ok:true,provider:"firebase",revision:Number(r.revision||0),state:await publicState(String(req.query.visitorSessionId||""))})}const a=await auth({token:req.headers["x-sync-token"],email:req.headers["x-sync-email"],secret:req.headers["x-sync-secret"],type:req.headers["x-sync-type"]});if(!a)return send(res,401,{ok:false,error:"Authentification requise"});return send(res,200,{ok:true,provider:"firebase",revision:Number(a.root.revision||0),state:await privateState(a)})}if(req.method!=="POST")return send(res,405,{ok:false,error:"Méthode non autorisée"});const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body||{};if(body.action==="auth"){
  const a=await auth({email:body.email,secret:body.secret,type:body.type});
  if(!a)return send(res,401,{ok:false,error:"Identifiants incorrects"});
  return send(res,200,{ok:true,provider:"firebase",user:cleanUser(a.user),token:signSession(a.user,a.role)})
}if(body.action==="syncPublic"){const r=await syncPublic(body);return send(res,200,{ok:true,provider:"firebase",...r})}const a=await auth(body.auth);if(!a)return send(res,401,{ok:false,error:"Session non autorisée"});if(body.action==="claimOrder"){const ref=ORDERS.doc(String(body.orderId||""));let claimed=null;await db.runTransaction(async t=>{const s=await t.get(ref);if(!s.exists)return;const row=s.data();if((row.status||row.payload?.status)!=="waiting"||row.claimedById)return;const now=new Date().toISOString(),old=row.payload||{},msg={id:`msg-${crypto.randomUUID()}`,senderType:a.role==="admin"?"admin":"agent",senderId:a.user.id,senderName:a.user.name,text:"Bonjour, j’ai récupéré votre commande et je vais vous assister pour la finaliser.",at:now};claimed={...old,status:"claimed",claimedById:a.user.id,claimedByName:a.user.name,claimedAt:now,updatedAt:now,messages:[...arr(old.messages),msg]};t.set(ref,{status:"claimed",claimedById:a.user.id,claimedByName:a.user.name,updatedAt:now,payload:claimed},{merge:true})});if(!claimed)return send(res,409,{ok:false,error:"Commande déjà récupérée"});const revision=await bump();return send(res,200,{ok:true,provider:"firebase",revision,order:claimed})}if(body.action==="sync"){if(a.role==="admin")await writeAdmin(body.state||{},body.operations||[]);else await writeStaff(body.state||{},a);const revision=await bump(),refreshed=await auth(body.auth);return send(res,200,{ok:true,provider:"firebase",revision,state:await privateState(refreshed)})}return send(res,400,{ok:false,error:"Action inconnue"})}catch(e){console.error("FIREBASE_SYNC_API",e);return send(res,e.status||500,{ok:false,provider:"firebase",error:e?.message||"Erreur serveur Firebase"})}}
