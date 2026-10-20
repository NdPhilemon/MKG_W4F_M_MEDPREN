import admin from 'firebase-admin';
import {initFirebase} from './firebase-init.js';
import {authenticate} from './sync.js';
import {pushPublicKey,pushSubscriptionId} from '../lib/push.js';

const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method==='GET')return res.status(200).json({ok:true,publicKey:pushPublicKey()});
    if(req.method!=='POST')throw fail(405,'METHOD_NOT_ALLOWED','Méthode non autorisée.');
    const identity=await authenticate(req.headers['x-sync-token']),body=typeof req.body==='string'?JSON.parse(req.body):req.body||{},subscription=body.subscription;
    if(!subscription||typeof subscription.endpoint!=='string'||!/^https:\/\//.test(subscription.endpoint)||subscription.endpoint.length>2048||typeof subscription.keys?.p256dh!=='string'||subscription.keys.p256dh.length>512||typeof subscription.keys?.auth!=='string'||subscription.keys.auth.length>256)throw fail(400,'INVALID_SUBSCRIPTION','Abonnement de notification invalide.');
    const cleanSubscription={endpoint:subscription.endpoint,expirationTime:Number.isFinite(subscription.expirationTime)?subscription.expirationTime:null,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
    initFirebase();const ref=admin.firestore().collection('mmedpren_push_subscriptions').doc(pushSubscriptionId(subscription.endpoint));
    if(body.action==='unsubscribe')await ref.delete();
    else if(body.action==='subscribe')await ref.set({subscription:cleanSubscription,userId:identity.user.id,role:identity.role,updatedAt:new Date().toISOString()});
    else throw fail(400,'UNKNOWN_ACTION','Action inconnue.');
    return res.status(200).json({ok:true})
  }catch(e){const status=e instanceof SyntaxError?400:e.status||500;return res.status(status).json({ok:false,code:e.code||'PUSH_ERROR',error:status>=500?'Notifications temporairement indisponibles.':e.message})}
}
