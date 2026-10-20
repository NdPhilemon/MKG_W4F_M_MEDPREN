import admin from "firebase-admin";
import crypto from "node:crypto";
import { authenticate } from "./sync.js";
import { verifySessionToken } from "../lib/session.js";
import { cloudinaryConfig, decodeImage, signCloudinaryUpload, uploadCloudinary, MAX_UPLOAD_BODY_BYTES, mediaError } from "../lib/cloudinary.js";

async function reserveUpload(userId) {
  const db=admin.firestore(),now=Date.now();
  const userKey=crypto.createHash('sha256').update(userId).digest('hex');
  const limits=[
    {ref:db.collection('mmedpren_upload_limits').doc(`user-${userKey}`),duration:600000,max:20},
    {ref:db.collection('mmedpren_upload_limits').doc('project'),duration:86400000,max:200}
  ];
  await db.runTransaction(async transaction=>{
    const snapshots=await Promise.all(limits.map(limit=>transaction.get(limit.ref)));
    const rows=limits.map((limit,i)=>{
      const old=snapshots[i].data()||{},active=now-Number(old.start||0)<limit.duration;
      const count=active?Number(old.count||0):0;
      if(count>=limit.max)throw Object.assign(mediaError(429,'UPLOAD_RATE_LIMIT','Trop d’envois d’images. Réessayez plus tard.'),{retryAfter:Math.ceil((Number(old.start)+limit.duration-now)/1000)});
      return {start:active?old.start:now,count:count+1};
    });
    limits.forEach((limit,i)=>transaction.set(limit.ref,rows[i]));
  });
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method!=='POST'){res.setHeader('Allow','POST');throw mediaError(405,'METHOD_NOT_ALLOWED','Méthode non autorisée');}
    if(Number(req.headers['content-length']||0)>MAX_UPLOAD_BODY_BYTES)throw mediaError(413,'IMAGE_TOO_LARGE','Image trop volumineuse. Compressez-la avant envoi.');
    const serialized=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
    if(Buffer.byteLength(serialized,'utf8')>MAX_UPLOAD_BODY_BYTES)throw mediaError(413,'IMAGE_TOO_LARGE','Image trop volumineuse. Compressez-la avant envoi.');
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(!body||typeof body!=='object'||Array.isArray(body))throw mediaError(400,'INVALID_BODY','Requête JSON invalide.');
    const folder=body.folder??'products';
    if(!['products','ads'].includes(folder))throw mediaError(400,'INVALID_FOLDER','Destination image invalide.');
    const session=verifySessionToken(req.headers['x-sync-token']);
    if(body.action==='sign'&&session.role){
      const permissions=Array.isArray(session.permissions)?session.permissions:[],allowed=session.role==='admin'||(folder==='products'&&(permissions.includes('products.edit')||permissions.includes('*')));
      if(!allowed)throw mediaError(403,'UPLOAD_FORBIDDEN','Vous ne disposez pas de l’autorisation d’envoyer cette image.');
      return res.status(200).json(signCloudinaryUpload(folder,session.sub,body.uploadId,cloudinaryConfig()))
    }
    const identity=await authenticate(req.headers['x-sync-token']);
    const permissions=identity.user.permissions||[];
    const allowed=identity.role==='admin'||(folder==='products'&&(permissions.includes('products.edit')||permissions.includes('*')));
    if(!allowed)throw mediaError(403,'UPLOAD_FORBIDDEN','Vous ne disposez pas de l’autorisation d’envoyer cette image.');
    const config=cloudinaryConfig();
    if(body.action==='sign')return res.status(200).json(signCloudinaryUpload(folder,identity.user.id,body.uploadId,config));
    const image=decodeImage(body.dataUrl);
    await reserveUpload(identity.user.id);
    return res.status(200).json(await uploadCloudinary(image,folder,identity.user.id,config));
  } catch(e) {
    const status=e instanceof SyntaxError?400:e.status||500;
    // Never log request bodies, tokens, environment values or provider response messages.
    console.error('MEDIA_UPLOAD_ERROR',{status,code:e.code||'UPLOAD_ERROR'});
    if(status===429)res.setHeader('Retry-After',String(e.retryAfter||60));
    return res.status(status).json({ok:false,code:e.code||'UPLOAD_ERROR',error:e instanceof SyntaxError?'Requête JSON invalide.':e.status?e.message:'Le service d’images est temporairement indisponible.'});
  }
}
