'use strict';
// SERVER ONLY. Never put HUEVO_CLIENT_SECRET in frontend code.
const BASE = 'https://huevo.su/api/apps/v1';
async function apiRequest(method, route, playerToken = null) {
  const id=process.env.HUEVO_CLIENT_ID, secret=process.env.HUEVO_CLIENT_SECRET;
  if(!id||!secret) throw Error('Configure HUEVO_CLIENT_ID and HUEVO_CLIENT_SECRET on the server');
  const known=method==='GET' && (/^\/users\/\d+$/.test(route)||route==='/wallet'||route.startsWith('/me/friends?'));
  if(!known)throw Error('Route not in verified read-only allowlist');
  const response=await fetch(BASE+route,{
    method,
    headers:{'Authorization':'Basic '+Buffer.from(id+':'+secret).toString('base64'),'Accept':'application/json',...(playerToken?{'X-Huevo-User-Token':playerToken}:{})},
    signal:AbortSignal.timeout(10000)
  });
  if(response.status===429){const e=Error('huEVO rate limited');e.retryAfter=response.headers.get('Retry-After');throw e;}
  const data=await response.json();
  if(!response.ok||data.ok===false){const e=Error(data.error?.message||'huEVO error');e.code=data.error?.code||'upstream_error';throw e;}
  return data;
}
function getPublicUser(userId){if(!/^\d+$/.test(String(userId)))throw Error('Invalid user id');return apiRequest('GET','/users/'+userId);}
// Consent-scoped short-lived token from huevo.requestAccess(['friends']). Never persist it.
function listFriendsServerOnly(playerToken, options={}){
  if(typeof playerToken!=='string'||playerToken.length<12||playerToken.length>4096||/[\r\n]/.test(playerToken))throw Error('Invalid player token');
  const limit=options.limit??100,offset=options.offset??0;
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw Error('Invalid pagination');
  const sort=options.sort??'name',inApp=options.inApp??1;
  if(!['name','added'].includes(sort)||![0,1].includes(inApp))throw Error('Invalid friends filters');
  const query=new URLSearchParams({limit:String(limit),offset:String(offset),sort,in_app:String(inApp)});
  return apiRequest('GET','/me/friends?'+query.toString(),playerToken);
}
module.exports={apiRequest,getPublicUser,listFriendsServerOnly};
