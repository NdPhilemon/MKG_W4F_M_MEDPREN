import { MongoClient } from "mongodb";
import crypto from "node:crypto";

const uri=process.env.MONGODB_URI;
if(!uri)throw new Error("MONGODB_URI manquant");
const globalForMongo=globalThis;
const client=globalForMongo.__mmedprenMongoClient || new MongoClient(uri,{maxPoolSize:10});
if(!globalForMongo.__mmedprenMongoClient)globalForMongo.__mmedprenMongoClient=client;
let connected=globalForMongo.__mmedprenMongoConnected;
async function database(){
  if(!connected){connected=client.connect();globalForMongo.__mmedprenMongoConnected=connected}
  await connected;return client.db("mmedpren")
}
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"ndagonywaphilemon@gmail.com").toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"202020";
const COLLECTIONS=["shops","users","products","ads","sales","orders","notifications"];

function stripMongo(value){
  if(Array.isArray(value))return value.map(stripMongo);
  if(value&&typeof value==="object"){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(k==="_id")continue;
      out[k]=stripMongo(v)
    }
    return out
  }
  return value
}

const publicProduct=p=>p&&p.visibleToVisitors!==false&&Number(p.stock||0)>0;
const cleanUser=u=>{if(!u)return null;const {password,_id,...rest}=u;return stripMongo(rest)};
const userForRole=(u,role)=>role==="admin"?cleanUser(u):(()=>{const {accessCode,password,...rest}=u||{};return rest})();
function json(res,status,data){res.status(status).setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(data))}
async function meta(db){
  const c=db.collection("app_meta");let m=await c.findOne({_id:"global"});
  if(!m){m={_id:"global",revision:0,rate:2400,mainCurrency:"USD",hideMoney:true,shopSettings:{phone:"0974112163",rccm:"CD/BKV/RCCM/24-A-01446",receiptLocation:"ISP, Bukavu/Sud-Kivu",correctionWindowMin:10},adminProfile:{name:"Administrateur principal",email:ADMIN_EMAIL,phone:""},updatedAt:new Date()};await c.insertOne(m)}
  return m
}
async function bump(db){const r=await db.collection("app_meta").findOneAndUpdate({_id:"global"},{$inc:{revision:1},$set:{updatedAt:new Date()}},{returnDocument:"after"});return Number(r?.revision||0)}
async function auth(db,a){
  if(!a?.email||!a?.secret)return null;const email=String(a.email).toLowerCase();
  if(a.type==="admin"&&email===ADMIN_EMAIL&&a.secret===ADMIN_PASSWORD){
    const stored=await db.collection("users").findOne({email:{$regex:`^${email.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`,$options:"i"}});
    return {user:stored||{id:"u-admin",name:"Administrateur principal",email:ADMIN_EMAIL,role:"admin",shops:["main"],permissions:["*"],status:"Actif",isPrimary:true},role:"admin"}
  }
  const u=await db.collection("users").findOne({email:{$regex:`^${email.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`,$options:"i"},accessCode:String(a.secret)});
  if(!u||u.status==="Suspendu"||(u.suspendedUntil&&new Date(u.suspendedUntil)>new Date()))return null;
  return {user:u,role:u.role||"seller"}
}
async function upsertMany(col,items,transform=x=>x){
  if(!Array.isArray(items)||!items.length)return;
  const ops=items.filter(x=>x&&x.id).map(x=>{
    const safe=stripMongo(transform({...x}));
    return {updateOne:{filter:{id:x.id},update:{$set:safe},upsert:true}}
  });
  if(ops.length)await col.bulkWrite(ops,{ordered:false})
}
async function applyDeletes(db,ops=[]){
  for(const op of ops||[]){const p=op.payload||{};
    if(op.type==="product.delete"&&p.productId)await db.collection("products").deleteOne({id:p.productId});
    if(op.type==="ad.delete"&&p.adId)await db.collection("ads").deleteOne({id:p.adId});
    if(op.type==="staff.delete"&&p.userId)await db.collection("users").deleteOne({id:p.userId,isPrimary:{$ne:true}});
    if(op.type==="report.reset"&&Array.isArray(p.saleIds))await db.collection("sales").deleteMany({id:{$in:p.saleIds}})
  }
}
async function writeAdminState(db,state,ops){
  await applyDeletes(db,ops);
  await db.collection("app_meta").updateOne({_id:"global"},{$set:{rate:Number(state.rate||2400),mainCurrency:state.mainCurrency||"USD",hideMoney:!!state.hideMoney,shopSettings:stripMongo(state.shopSettings||{}),adminProfile:stripMongo(state.adminProfile||{}),updatedAt:new Date()}},{upsert:true});
  for(const name of COLLECTIONS){
    const items=state[name];if(!Array.isArray(items))continue;
    if(name==="users")await upsertMany(db.collection(name),items,u=>{const {password,...safe}=u;return safe});
    else await upsertMany(db.collection(name),items)
  }
}
async function writeStaffState(db,state,role,user){
  if(Array.isArray(state.sales))await upsertMany(db.collection("sales"),state.sales);
  if(Array.isArray(state.orders))await upsertMany(db.collection("orders"),state.orders);
  if(Array.isArray(state.products)){
    const canEdit=role==="manager"&&(user.permissions||[]).includes("products.edit");
    const ops=state.products.filter(p=>p?.id).map(p=>({updateOne:{filter:{id:p.id},update:canEdit?{$set:stripMongo(p)}:{$set:{stock:Number(p.stock||0)}},upsert:canEdit}}));
    if(ops.length)await db.collection("products").bulkWrite(ops,{ordered:false})
  }
}
async function privateState(db,role,user){
  const m=await meta(db);const [shops,products,ads,sales,orders,notifications]=await Promise.all([
    db.collection("shops").find({}).toArray(),db.collection("products").find({}).toArray(),db.collection("ads").find({}).toArray(),db.collection("sales").find({}).toArray(),db.collection("orders").find({}).toArray(),db.collection("notifications").find({}).sort({date:-1}).limit(100).toArray()
  ]);
  let users=[];if(role==="admin")users=(await db.collection("users").find({}).toArray()).map(cleanUser);else users=[userForRole(user,role)];
  return stripMongo({rate:m.rate||2400,mainCurrency:m.mainCurrency||"USD",hideMoney:!!m.hideMoney,shopSettings:m.shopSettings||{},adminProfile:m.adminProfile||{},shops,users,products,ads,sales,orders,notifications})
}
async function publicState(db,visitorSessionId){
  const m=await meta(db);const [shops,products,ads,orders]=await Promise.all([
    db.collection("shops").find({}).toArray(),db.collection("products").find({visibleToVisitors:{$ne:false},stock:{$gt:0}}).toArray(),db.collection("ads").find({active:{$ne:false}}).toArray(),visitorSessionId?db.collection("orders").find({visitorSessionId}).toArray():[]
  ]);
  return stripMongo({rate:m.rate||2400,mainCurrency:m.mainCurrency||"USD",shopSettings:m.shopSettings||{},shops,products:products.filter(publicProduct),ads,orders})
}
async function syncPublic(db,body){
  const sid=String(body.visitorSessionId||"");if(!sid)throw Object.assign(new Error("Session visiteur manquante"),{status:400});
  const incoming=(body.orders||[]).filter(o=>o&&o.visitorSessionId===sid).map(stripMongo);
  for(const o of incoming){
    const existing=await db.collection("orders").findOne({id:o.id});
    if(!existing){await db.collection("orders").insertOne(stripMongo({...o,visitorSessionId:sid}));continue}
    const mergedMessages=new Map([...(existing.messages||[]),...(o.messages||[])].filter(Boolean).map(m=>[m.id,m]));
    const serverAdvanced=["claimed","completed","cancelled"].includes(existing.status);
    const merged={...o,...(serverAdvanced?{status:existing.status,claimedById:existing.claimedById,claimedByName:existing.claimedByName,claimedAt:existing.claimedAt,completedAt:existing.completedAt,saleId:existing.saleId}:{}),messages:[...mergedMessages.values()],visitorSessionId:sid,updatedAt:new Date().toISOString()};
    await db.collection("orders").updateOne({id:o.id},{$set:stripMongo(merged)},{upsert:true})
  }
  const revision=await bump(db);return {revision,state:await publicState(db,sid)}
}
export default async function handler(req,res){
  try{
    const db=await database();
    if(req.method==="GET"){
      const scope=String(req.query.scope||"public");
      if(scope==="revision"){
        const m=await meta(db);
        return json(res,200,{ok:true,revision:Number(m.revision||0),updatedAt:m.updatedAt||null})
      }
      if(scope==="public"){const m=await meta(db);return json(res,200,{ok:true,revision:Number(m.revision||0),state:await publicState(db,String(req.query.visitorSessionId||""))})}
      const a={email:req.headers["x-sync-email"],secret:req.headers["x-sync-secret"],type:req.headers["x-sync-type"]};const au=await auth(db,a);if(!au)return json(res,401,{ok:false,error:"Authentification requise"});const m=await meta(db);return json(res,200,{ok:true,revision:Number(m.revision||0),state:await privateState(db,au.role,au.user)})
    }
    if(req.method!=="POST")return json(res,405,{ok:false,error:"Méthode non autorisée"});
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body||{};
    if(body.action==="auth"){
      const au=await auth(db,{email:body.email,secret:body.secret,type:body.type});if(!au)return json(res,401,{ok:false,error:"Identifiants incorrects"});return json(res,200,{ok:true,user:userForRole(au.user,au.role)})
    }
    if(body.action==="syncPublic"){const out=await syncPublic(db,body);return json(res,200,{ok:true,...out})}
    const au=await auth(db,body.auth);if(!au)return json(res,401,{ok:false,error:"Session non autorisée"});
    if(body.action==="claimOrder"){
      const orderId=String(body.orderId||"");const now=new Date().toISOString();const upd=await db.collection("orders").findOneAndUpdate({id:orderId,status:"waiting",$or:[{claimedById:null},{claimedById:{$exists:false}}]},{$set:{status:"claimed",claimedById:au.user.id,claimedByName:au.user.name,claimedAt:now,updatedAt:now},$push:{messages:{id:`msg-${crypto.randomUUID()}`,senderType:au.role==="admin"?"admin":"agent",senderId:au.user.id,senderName:au.user.name,text:"Bonjour, j’ai récupéré votre commande et je vais vous assister pour la finaliser.",at:now}}},{returnDocument:"after"});
      if(!upd)return json(res,409,{ok:false,error:"Commande déjà récupérée"});const revision=await bump(db);return json(res,200,{ok:true,revision,order:stripMongo(upd)})
    }
    if(body.action==="sync"){
      if(au.role==="admin")await writeAdminState(db,body.state||{},body.operations||[]);
      else await writeStaffState(db,body.state||{},au.role,au.user);
      const revision=await bump(db);
      return json(res,200,{ok:true,revision,state:await privateState(db,au.role,au.user)})
    }
    return json(res,400,{ok:false,error:"Action inconnue"})
  }catch(e){console.error("SYNC_API",e);return json(res,e.status||500,{ok:false,error:e.status?e.message:"Erreur serveur de synchronisation"})}
    }
