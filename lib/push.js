import crypto from 'node:crypto';
import admin from 'firebase-admin';
import webpush from 'web-push';
import {initFirebase} from '../api/firebase-init.js';

const b64=value=>Buffer.from(value).toString('base64url');
function vapid(){
  const secret=process.env.SESSION_SECRET;
  if(!secret||secret.length<32)throw Object.assign(new Error('Notifications serveur non configurées.'),{status:503,code:'PUSH_NOT_CONFIGURED'});
  const privateKey=crypto.createHash('sha256').update(`mmedpren-push:${secret}`).digest(),ecdh=crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);return {privateKey:b64(privateKey),publicKey:b64(ecdh.getPublicKey(null,'uncompressed'))}
}
export function pushPublicKey(){return vapid().publicKey}
export function pushSubscriptionId(endpoint){return crypto.createHash('sha256').update(endpoint).digest('hex')}
export async function broadcastPush(payload){
  initFirebase();const keys=vapid(),db=admin.firestore(),[rows,root]=await Promise.all([db.collection('mmedpren_push_subscriptions').get(),db.collection('mmedpren').doc('global').get()]);
  const now=Date.now(),activeUsers=new Set((root.data()?.users||[]).filter(u=>['admin','manager','seller'].includes(u.role)&&(u.status!=='Suspendu'||(u.suspendedUntil&&new Date(u.suspendedUntil).getTime()<=now))).map(u=>u.id));
  webpush.setVapidDetails(`mailto:${(process.env.ADMIN_EMAIL||'admin@mmedpren.app').trim()}`,keys.publicKey,keys.privateKey);
  await Promise.all(rows.docs.filter(doc=>activeUsers.has(doc.data().userId)).map(async doc=>{try{await webpush.sendNotification(doc.data().subscription,JSON.stringify(payload),{TTL:300,urgency:'high',timeout:4000})}catch(e){if([404,410].includes(e.statusCode))await doc.ref.delete();else console.error('PUSH_DELIVERY_ERROR',{status:e.statusCode||0})}}))
}
