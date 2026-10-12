import crypto from 'node:crypto';
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw Object.assign(new Error('Configuration de session manquante'), {status:503});
  return value;
}
export function signSession(user) {
  const payload = Buffer.from(JSON.stringify({sub:user.id,exp:Date.now()+30*86400000})).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256',secret()).update(payload).digest('base64url')}`;
}
export function verifySessionToken(token) {
  const key=secret();
  const fail=code=>{throw Object.assign(new Error(code==='TOKEN_EXPIRED'?'Session expirée, veuillez vous reconnecter':'Authentification requise'),{status:401,code})};
  if(!token) return fail('AUTH_REQUIRED');
  const parts=String(token).split('.');
  if(parts.length!==2)return fail('TOKEN_INVALID');
  const [payload,sig]=parts,expected=crypto.createHmac('sha256',key).update(payload).digest('base64url');
  if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return fail('TOKEN_INVALID');
  let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{return fail('TOKEN_INVALID')}
  if(!data.sub||!Number.isFinite(data.exp))return fail('TOKEN_INVALID');
  if(Date.now()>=data.exp)return fail('TOKEN_EXPIRED');
  return data;
}
export function sameSecret(a,b) {
  const digest=v=>crypto.createHash('sha256').update(String(v||'')).digest();
  return !!a&&!!b&&crypto.timingSafeEqual(digest(a),digest(b));
}
