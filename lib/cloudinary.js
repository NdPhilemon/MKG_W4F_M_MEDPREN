import crypto from 'node:crypto';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = 4_300_000; // Below Vercel's 4.5 MB, including Base64/JSON.
export const mediaError = (status, code, message) => Object.assign(new Error(message), {status, code});

export function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !/^[a-zA-Z0-9_-]+$/.test(cloudName) || !apiKey || !apiSecret) {
    throw mediaError(503, 'MEDIA_NOT_CONFIGURED', 'Le stockage des images n’est pas encore configuré. Contactez l’administrateur.');
  }
  return {cloudName, apiKey, apiSecret};
}

export function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw mediaError(400, 'INVALID_IMAGE', 'Image requise.');
  if (dataUrl.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 40) throw mediaError(413, 'IMAGE_TOO_LARGE', 'Image trop volumineuse : maximum 3 Mio après compression.');
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match || match[1].toLowerCase()==='image/svg+xml') throw mediaError(400, 'INVALID_IMAGE', 'Format photo invalide.');
  const mime = match[1].toLowerCase(), encoded = match[2];
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.toString('base64') !== encoded) throw mediaError(400, 'INVALID_IMAGE', 'Encodage image invalide.');
  if (buffer.length > MAX_IMAGE_BYTES) throw mediaError(413, 'IMAGE_TOO_LARGE', 'Image trop volumineuse : maximum 3 Mio après compression.');
  const matches = {
    'image/jpeg': buffer.length >= 3 && buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])),
    'image/png': buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/gif': ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii')),
    'image/webp': buffer.length >= 12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP'
  };
  if (mime in matches && !matches[mime]) throw mediaError(400, 'INVALID_IMAGE', 'Le contenu du fichier ne correspond pas au type d’image.');
  if (!(mime in matches) && buffer.length < 12) throw mediaError(400, 'INVALID_IMAGE', 'Fichier photo invalide.');
  return {mime, buffer};
}

export function signCloudinaryUpload(folder, userId, uploadId, config) {
  if (!/^[a-f0-9-]{20,80}$/i.test(uploadId||'')) throw mediaError(400, 'INVALID_UPLOAD_ID', 'Identifiant d’envoi invalide.');
  const userKey = crypto.createHash('sha256').update(userId).digest('hex').slice(0,24);
  const deploymentEnvironment = ['production','preview','development'].includes(process.env.VERCEL_ENV)?process.env.VERCEL_ENV:'development';
  const publicId = `mmedpren/${deploymentEnvironment}/${folder}/${userKey}-${uploadId}`;
  const params = {overwrite:'false', public_id:publicId, timestamp:String(Math.floor(Date.now()/1000))};
  const toSign = Object.keys(params).sort().map(key=>`${key}=${params[key]}`).join('&');
  return {ok:true,provider:'cloudinary',uploadUrl:`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    cloudName:config.cloudName,apiKey:config.apiKey,signature:crypto.createHash('sha256').update(toSign+config.apiSecret).digest('hex'),params};
}

export async function uploadCloudinary(image, folder, userId, config) {
  // Content-addressed IDs avoid creating duplicates when an upload response is lost.
  const hash = crypto.createHash('sha256').update(userId).update('\0').update(image.buffer).digest('hex');
  const deploymentEnvironment = ['production','preview','development'].includes(process.env.VERCEL_ENV)?process.env.VERCEL_ENV:'development';
  const publicId = `mmedpren/${deploymentEnvironment}/${folder}/${hash}`;
  const params = {overwrite:'false', public_id:publicId, timestamp:String(Math.floor(Date.now()/1000))};
  const toSign = Object.keys(params).sort().map(key=>`${key}=${params[key]}`).join('&');
  const signature = crypto.createHash('sha256').update(toSign + config.apiSecret).digest('hex');
  const form = new FormData();
  for (const [key,value] of Object.entries(params)) form.set(key,value);
  form.set('api_key',config.apiKey);form.set('signature',signature);
  form.set('file',new Blob([image.buffer],{type:image.mime}),'image');
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,{
      method:'POST',body:form,signal:AbortSignal.timeout(25000),redirect:'error'
    });
  } catch (e) {
    throw mediaError(e.name==='TimeoutError'?504:502,'MEDIA_UNAVAILABLE','Cloudinary est temporairement inaccessible. Réessayez.');
  }
  if (!response.ok) {
    const status = response.status;
    if (status===413) throw mediaError(413,'IMAGE_TOO_LARGE','Cloudinary a refusé la taille de l’image. Choisissez une image plus petite.');
    if (status===429) throw mediaError(429,'MEDIA_RATE_LIMIT','Limite Cloudinary atteinte. Réessayez plus tard.');
    if ([401,403].includes(status)) throw mediaError(502,'MEDIA_PROVIDER_AUTH','Cloudinary refuse l’upload. L’administrateur doit vérifier sa configuration.');
    if (status===400) throw mediaError(400,'MEDIA_REJECTED','Cloudinary a refusé cette image. Vérifiez son format et réessayez.');
    throw mediaError(502,'MEDIA_UNAVAILABLE','Cloudinary est temporairement indisponible. Réessayez.');
  }
  let data,url;
  try {
    data=await response.json();url=new URL(data.secure_url);
    if (url.protocol!=='https:' || url.hostname!=='res.cloudinary.com' || url.username || url.password ||
        !url.pathname.startsWith(`/${config.cloudName}/image/upload/`) || data.public_id!==publicId) throw new Error();
  } catch {
    throw mediaError(502,'MEDIA_INVALID_RESPONSE','Cloudinary n’a pas confirmé une URL image valide.');
  }
  // Optimized delivery plus a non-destructive resize: preserve the complete product/ad image.
  url.pathname=url.pathname.replace('/image/upload/','/image/upload/f_auto,q_auto,c_limit,w_1600/');
  return {ok:true,provider:'cloudinary',url:url.href,publicId,
    width:Number(data.width)||null,height:Number(data.height)||null,bytes:Number(data.bytes)||image.buffer.length};
}
