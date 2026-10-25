'use strict';
const assert=require('node:assert/strict');
const {apiRequest,listFriendsServerOnly}=require('./huevo-api');
process.env.HUEVO_CLIENT_ID='test-id';process.env.HUEVO_CLIENT_SECRET='test-secret';
assert.throws(()=>listFriendsServerOnly('too-short'),/Invalid player token/);
assert.throws(()=>listFriendsServerOnly('123456789012345',{limit:101}),/Invalid pagination/);
assert.throws(()=>listFriendsServerOnly('123456789012345',{sort:'invalid'}),/Invalid friends filters/);
apiRequest('POST','/credits').then(()=>{throw Error('Should not succeed')},e=>{
 assert.match(e.message,/allowlist/);
 console.log('huEVO API input validation tests passed');
}).catch(e=>{console.error(e);process.exitCode=1});
