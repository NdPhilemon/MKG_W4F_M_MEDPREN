import { MongoClient } from "mongodb";
import admin from "firebase-admin";

const {MONGODB_URI,FIREBASE_PROJECT_ID,FIREBASE_CLIENT_EMAIL,FIREBASE_PRIVATE_KEY,FIREBASE_STORAGE_BUCKET}=process.env;
if(!MONGODB_URI||!FIREBASE_PROJECT_ID||!FIREBASE_CLIENT_EMAIL||!FIREBASE_PRIVATE_KEY){
  throw new Error("Variables de migration manquantes");
}
admin.initializeApp({
  credential:admin.credential.cert({
    projectId:FIREBASE_PROJECT_ID,
    clientEmail:FIREBASE_CLIENT_EMAIL,
    privateKey:FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n")
  }),
  storageBucket:FIREBASE_STORAGE_BUCKET||undefined
});
const mongo=new MongoClient(MONGODB_URI);
const fdb=admin.firestore();
const strip=v=>Array.isArray(v)?v.map(strip):(v&&typeof v==="object"?Object.fromEntries(Object.entries(v).filter(([k])=>k!=="_id").map(([k,x])=>[k,strip(x)])):v);

await mongo.connect();
const mdb=mongo.db("mmedpren");
const meta=(await mdb.collection("app_meta").findOne({_id:"global"}))||{};
const names=["shops","users","products","ads","sales","orders","notifications"];
const data={};
for(const n of names)data[n]=strip(await mdb.collection(n).find({}).toArray());

const mainShop={id:"main",name:"Boutique principale",location:"ISP, Bukavu/Sud-Kivu"};
if(!data.shops.some(s=>s.id==="main"))data.shops.unshift(mainShop);

await fdb.collection("mmedpren").doc("global").set({
  revision:Number(meta.revision||0),
  rate:Number(meta.rate||2400),
  mainCurrency:meta.mainCurrency||"USD",
  hideMoney:!!meta.hideMoney,
  shopSettings:strip(meta.shopSettings||{}),
  adminProfile:strip(meta.adminProfile||{}),
  shops:data.shops,
  users:data.users.map(({password,...u})=>u),
  products:data.products,
  ads:data.ads,
  sales:data.sales,
  notifications:data.notifications,
  updatedAt:new Date().toISOString()
},{merge:true});

for(let i=0;i<data.orders.length;i+=400){
  const batch=fdb.batch();
  for(const o of data.orders.slice(i,i+400)){
    if(!o?.id)continue;
    batch.set(fdb.collection("mmedpren_orders").doc(o.id),{
      visitorSessionId:o.visitorSessionId||null,
      status:o.status||"waiting",
      claimedById:o.claimedById||null,
      claimedByName:o.claimedByName||null,
      updatedAt:o.updatedAt||new Date().toISOString(),
      payload:o
    },{merge:true})
  }
  await batch.commit()
}
await mongo.close();
console.log("Migration MongoDB -> Firebase terminée");
