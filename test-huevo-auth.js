'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifyLaunch,issueSession,verifySession}=require('./huevo-auth');
const now=1760000000, secret='server-client-secret', sessionSecret='a'.repeat(64), appId='456';
function sign(fields){const data=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>k+'='+v).join('\n');const key=crypto.createHash('sha256').update(secret).digest();return crypto.createHmac('sha256',key).update(data).digest('hex')}
const fields={hu_app_id:'456',hu_user_id:'123',hu_username:'тест',hu_display_name:'Тест Игрок',hu_ts:String(now-8),hu_mode:'test'};
const query='?'+new URLSearchParams({...fields,hu_hash:sign(fields)});
const options={clientSecret:secret,appId,now};
const user=verifyLaunch(query,options);assert.equal(user.id,'123');assert.equal(user.mode,'test');
assert.equal(verifyLaunch(query.replace('Тест','X'),options)?.id,'123'); // unchanged percent-encoded string, still valid
assert.equal(verifyLaunch(query+'&hu_user_id=999',options),null);
assert.equal(verifyLaunch(query,{...options,appId:'999'}),null);
assert.equal(verifyLaunch(query,{...options,now:now+90000}),null);
assert.equal(verifyLaunch(query.replace('hu_user_id=123','hu_user_id=124'),options),null);
const token=issueSession(user,{sessionSecret,now});assert.deepEqual(verifySession(token,{sessionSecret,now}),{id:'123',mode:'test'});
assert.equal(verifySession(token+'bad',{sessionSecret,now}),null);
assert.equal(verifySession(token,{sessionSecret,now:now+SESSION_AGE_FIX()}),null);
function SESSION_AGE_FIX(){return 12*3600+1}
console.log('huEVO signed launch + session tests passed');
