import admin from "firebase-admin";
export function initFirebase(){
  const existing=admin.apps.find(app=>app?.name==='[DEFAULT]');
  if(existing)return existing;
  const projectId=process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail=process.env.FIREBASE_CLIENT_EMAIL?.trim();
  let privateKey=process.env.FIREBASE_PRIVATE_KEY?.trim();
  if(!projectId||!clientEmail||!privateKey)throw new Error("Variables Firebase manquantes");
  if(privateKey.startsWith('"')&&privateKey.endsWith('"'))privateKey=privateKey.slice(1,-1);
  privateKey=privateKey.replace(/\\n/g,'\n').replace(/\r\n/g,'\n');
  return admin.initializeApp({
    credential:admin.credential.cert({projectId,clientEmail,privateKey}),
    storageBucket:process.env.FIREBASE_STORAGE_BUCKET||undefined
  });
}
