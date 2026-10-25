'use strict';
// huEVO launch verification and application-owned stateless sessions.
// Run on trusted backend ONLY; never bundle this module or secrets into public HTML.
const crypto = require('node:crypto');
const MAX_AGE = 24 * 60 * 60;
const SESSION_AGE = 12 * 60 * 60;
function verifyLaunch(query, opts = {}) {
  const secret=opts.clientSecret ?? process.env.HUEVO_CLIENT_SECRET;
  const appId=String(opts.appId ?? process.env.HUEVO_APP_ID ?? '');
  if (!secret || !appId) throw Error('HUEVO_CLIENT_SECRET and HUEVO_APP_ID must be set');
  if (typeof query!=='string' || query.length>8192) return null;
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const entries = new Map();
  for(const [k,v] of params){
    if(!k.startsWith('hu_'))continue;
    // Ambiguous signed fields must be rejected rather than silently overwritten.
    if(entries.has(k))return null;
    entries.set(k,v);
  }
  const got=entries.get('hu_hash')||'';
  if(!/^[0-9a-f]{64}$/i.test(got))return null;
  const message=[...entries].filter(([k])=>k!=='hu_hash').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
  const key=crypto.createHash('sha256').update(secret,'utf8').digest();
  const expected=crypto.createHmac('sha256',key).update(message,'utf8').digest();
  if(!crypto.timingSafeEqual(expected, Buffer.from(got,'hex')))return null;
  const now=opts.now??Math.floor(Date.now()/1000);
  const ts=entries.get('hu_ts')||'';
  if(!/^\d+$/.test(ts) || now-Number(ts)<0 || now-Number(ts)> (opts.maxAge??MAX_AGE))return null;
  const userId=entries.get('hu_user_id')||'';
  if(!/^\d+$/.test(userId)||BigInt(userId)===0n||entries.get('hu_app_id')!==appId)return null;
  const mode=entries.get('hu_mode');
  if(mode!=='live'&&mode!=='test')return null;
  return {id:userId,mode,username:(entries.get('hu_username')||'').slice(0,80),displayName:(entries.get('hu_display_name')||'').slice(0,100),avatar:(entries.get('hu_avatar')||'').slice(0,2048)};
}
function b64(obj){return Buffer.from(JSON.stringify(obj)).toString('base64url')}
function sessionKey(secret){return crypto.createHash('sha256').update(secret).digest()}
function issueSession(user, opts={}){
  const secret=opts.sessionSecret??process.env.SNAKE_SESSION_SECRET;
  if(!secret || secret.length<32) throw Error('Set SNAKE_SESSION_SECRET to a random string of at least 32 characters');
  const now=opts.now??Math.floor(Date.now()/1000);
  const payload=b64({sub:user.id,mode:user.mode,iat:now,exp:now+SESSION_AGE});
  const sig=crypto.createHmac('sha256',sessionKey(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifySession(token,opts={}){
  const secret=opts.sessionSecret??process.env.SNAKE_SESSION_SECRET;
  if(!secret || secret.length<32 || typeof token!=='string' || token.length>2048)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const expected=crypto.createHmac('sha256',sessionKey(secret)).update(parts[0]).digest();
  let got;try{got=Buffer.from(parts[1],'base64url')}catch{return null}
  if(got.length!==expected.length || !crypto.timingSafeEqual(expected,got))return null;
  try{
    const obj=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    const now=opts.now??Math.floor(Date.now()/1000);
    if(!/^\d+$/.test(obj.sub)||!['live','test'].includes(obj.mode)||!Number.isSafeInteger(obj.exp)||!Number.isSafeInteger(obj.iat)||obj.iat>now||obj.exp<=now)return null;
    return {id:obj.sub,mode:obj.mode};
  }catch{return null}
}
module.exports={verifyLaunch,issueSession,verifySession};
