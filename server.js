'use strict';
// Snake huEVO demo backend. No verified platform identity endpoints available yet.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {verifyLaunch,issueSession,verifySession}=require('./huevo-auth');
const {apiRequest,getPublicUser,listFriendsServerOnly,createDonationIntent,getDonationIntent}=require('./huevo-api');
const {createRun,verifyRun}=require('./run-proof');
const {initialize,persist:saveDatabase}=require('./database');
const economy=require('./economy');
const PORT=Number(process.env.PORT||3000);
const DATA=process.env.DATA_FILE||path.join(__dirname,'data.json');
const PUBLIC=path.join(__dirname,'public');
let db={players:{},huevoPlayers:{}};
const sessions=new Map(); // temporary guest sessions; stable cookie allows re-entry during this process only
let mutations=Promise.resolve();
async function updatePlayer(callback){const job=mutations.then(async()=>{const result=await callback();await persist();return result});mutations=job.catch(err=>console.error('State mutation failed:',err.message));return job}
async function persist(){await saveDatabase(db)}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body)}
function getCookie(req,name){const items=(req.headers.cookie||'').split(';').map(s=>s.trim());return items.find(s=>s.startsWith(name+'='))?.slice(name.length+1)}
async function user(req,res){let id=getCookie(req,'snake_guest');if(!id||!/^[a-f0-9]{48}$/.test(id)||!db.players[id]){id=crypto.randomBytes(24).toString('hex');db.players[id]={name:'Гость '+id.slice(0,5),best:0,save:null,friends:[],since:Date.now()};await persist();res.setHeader('Set-Cookie','snake_guest='+id+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000'+(process.env.NODE_ENV==='production'?'; Secure':''))}return {id,p:db.players[id]}}
function body(req){return new Promise((resolve,reject)=>{let buf='';req.on('data',c=>{buf+=c;if(buf.length>20000){reject(Error('Too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(buf||'{}'))}catch{reject(Error('Bad JSON'))}})})}
function cleanSave(v){if(!v||typeof v!=='object')return null;const colors=['mint','blue','lavender','peach','rose','gold','palette','rainbow'];const owned=Array.isArray(v.owned)?[...new Set(['mint',...v.owned.filter(x=>colors.includes(x))])]:['mint'];const skinId=colors.includes(v.skinId)&&owned.includes(v.skinId)?v.skinId:'mint';const customColor=typeof v.customColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(v.customColor)?v.customColor:'#7bd9ca';return {wallet:Math.min(100000,Math.max(0,Math.floor(Number(v.wallet)||0))),skinId,owned,customColor}}
function scoreValid(v){return Number.isSafeInteger(v)&&v>=0&&v<=4000&&v%10===0}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'};
const rate=new Map();function limited(id){const t=Date.now();let r=rate.get(id);if(!r||t-r.since>60000){r={since:t,count:0};rate.set(id,r)}return ++r.count>80}
const server=http.createServer(async(req,res)=>{
 try{
 const origin=req.headers.origin;
 const allowedOrigin='https://coolalmik2016.github.io';
 if(origin===allowedOrigin && req.url.startsWith('/api/')){
   res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
   res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
   res.setHeader('Vary','Origin');
 }
 if(req.method==='OPTIONS'){
   if(origin!==allowedOrigin || !req.url.startsWith('/api/'))return json(res,403,{ok:false,error:{code:'forbidden'}});
   res.writeHead(204);return res.end();
 }
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'snake-api',storage:process.env.DATABASE_URL?'postgresql':'ephemeral'});
 if(url.pathname.startsWith('/api/')){
  if(url.pathname.startsWith('/api/huevo/')){
    // Require a verified launch to create a session. Never accept a user ID sent by the client.
    if(req.method==='POST'&&url.pathname==='/api/huevo/login'){
      if(!limited('login:'+req.socket.remoteAddress))return await (async()=>{
        const b=await body(req);
        const player=verifyLaunch(b.query);
        if(!player)return json(res,401,{ok:false,error:{code:'invalid_launch',message:'Неверная или устаревшая подпись huEVO'}});
        const key=player.mode+':'+player.id;
        await updatePlayer(()=>{
          const existing=Boolean(db.huevoPlayers[key]);
          const prev=db.huevoPlayers[key]||{best:0,save:null};
          db.huevoPlayers[key]={...prev,name:player.displayName||player.username||'Игрок',username:player.username,avatar:player.avatar};
          economy.ensure(db.huevoPlayers[key],!existing);
        });
        return json(res,200,{ok:true,token:issueSession(player),user:{id:player.id,mode:player.mode,name:db.huevoPlayers[key].name,avatar:player.avatar}});
      })();
      return json(res,429,{ok:false,error:{code:'rate_limited',message:'Повторите вход позже'}});
    }
    const match=/^Bearer (.+)$/.exec(req.headers.authorization||'');
    const session=verifySession(match?.[1]);
    if(!session)return json(res,401,{ok:false,error:{code:'unauthorized',message:'Необходим вход через huEVO'}});
    const key=session.mode+':'+session.id;
    const player=db.huevoPlayers[key];
    if(!player)return json(res,401,{ok:false,error:{code:'unauthorized',message:'Сессия не найдена'}});
    if(limited('hu:'+key))return json(res,429,{ok:false,error:{code:'rate_limited',message:'Слишком много запросов'}});
    if(req.method==='GET'&&url.pathname==='/api/huevo/donations/status'){
      try{
        const wallet=await apiRequest('GET','/wallet');
        // Do not expose application wallet balance to arbitrary players.
        return json(res,200,{ok:true,frozen:wallet.frozen===true,paymentsConfigured:true,realDonationsEnabled:session.mode==='live'&&process.env.HUEVO_REAL_DONATIONS_ENABLED==='true',mode:session.mode});
      }catch(err){
        console.warn('huEVO wallet status unavailable:',err.code||err.message);
        return json(res,502,{ok:false,error:{code:'wallet_unavailable',message:'Статус кошелька huEVO сейчас недоступен'}});
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/donations/create'){
      const b=await body(req);
      // huEVO accepts any whole-number donation from 1 to 100000 monетки.
      // Never trust the amount sent by the browser, even if the UI validates it.
      if(!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>100000)
        return json(res,400,{ok:false,error:{code:'invalid_amount',message:'Сумма должна быть целым числом от 1 до 100 000 монэток'}});
      const test=session.mode!=='live'||process.env.HUEVO_REAL_DONATIONS_ENABLED!=='true';
      try{
        // Amount and player identity come from trusted server state, not arbitrary browser input.
        const intent=await createDonationIntent({userId:Number(session.id),amount:b.amount,test,idempotencyKey:'snake-'+crypto.randomUUID()});
        if(!intent.ok||!/^pi_[A-Za-z0-9_-]{5,100}$/.test(intent.intent_id||'')||intent.amount!==b.amount||String(intent.user_id)!==session.id||intent.test!==test)
          throw Error('Unexpected huEVO payment response');
        await updatePlayer(()=>{
          player.donations ||= {};
          player.donations[intent.intent_id]={amount:b.amount,test,status:intent.status,createdAt:Date.now()};
          const entries=Object.entries(player.donations).sort((a,b)=>b[1].createdAt-a[1].createdAt).slice(0,30);
          player.donations=Object.fromEntries(entries);
        });
        return json(res,200,{ok:true,intent_id:intent.intent_id,amount:b.amount,status:intent.status,test});
      }catch(e){
        console.error('Donation intent error:',e.code||e.message);
        return json(res,e.retryAfter?429:502,{ok:false,error:{code:e.code||'payment_unavailable',message:'Не удалось создать платёж. Попробуйте позже.'}});
      }
    }
    const donationMatch=/^\/api\/huevo\/donations\/(pi_[A-Za-z0-9_-]{5,100})$/.exec(url.pathname);
    if(req.method==='GET'&&donationMatch){
      const intentId=donationMatch[1];
      const record=player.donations?.[intentId];
      if(!record)return json(res,404,{ok:false,error:{code:'not_found',message:'Платёж не найден'}});
      try{
        const result=await getDonationIntent(intentId);
        if(String(result.user_id)!==session.id||result.amount!==record.amount||result.test!==record.test)
          throw Error('Payment details mismatch');
        if(!['pending','succeeded','failed','cancelled','expired'].includes(result.status))
          throw Error('Unknown payment status');
        await updatePlayer(()=>{if(player.donations?.[intentId])player.donations[intentId].status=result.status});
        return json(res,200,{ok:true,intent_id:intentId,status:result.status,amount:record.amount,test:record.test,error:result.error??null});
      }catch(e){
        console.error('Donation status verification:',e.code||e.message);
        return json(res,502,{ok:false,error:{code:'status_unavailable',message:'Не удалось проверить оплату. Повторите проверку позже.'}});
      }
    }
    // Owner-only read/preview panel; intentionally does not execute any wallet transfer.
    if(url.pathname.startsWith('/api/huevo/owner/')){
      const ownerId=String(process.env.HUEVO_OWNER_USER_ID||'');
      if(!/^\d+$/.test(ownerId)||ownerId==='0'||session.mode!=='live'||session.id!==ownerId)
        return json(res,403,{ok:false,error:{code:'not_owner',message:'Доступ только владельцу приложения'}});
      if(req.method==='GET'&&url.pathname==='/api/huevo/owner/summary'){
        try{
          const w=await apiRequest('GET','/wallet');
          return json(res,200,{ok:true,balance:Number.isSafeInteger(w.balance)?w.balance:null,frozen:w.frozen===true,payoutsEnabled:false});
        }catch(e){
          return json(res,502,{ok:false,error:{code:'wallet_unavailable',message:'Не удалось получить баланс кошелька'}});
        }
      }
      if(req.method==='POST'&&url.pathname==='/api/huevo/owner/preview'){
        const b=await body(req);
        if(!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>100000)
          return json(res,400,{ok:false,error:{code:'bad_amount',message:'Сумма от 1 до 100 000 монэток'}});
        try{
          const w=await apiRequest('GET','/wallet');
          if(w.frozen===true)return json(res,409,{ok:false,error:{code:'wallet_frozen',message:'Кошелёк заморожен'}});
          if(!Number.isSafeInteger(w.balance))return json(res,502,{ok:false,error:{code:'unknown_balance',message:'Баланс недоступен'}});
          if(b.amount>w.balance)return json(res,409,{ok:false,error:{code:'insufficient_wallet',message:'Монэток недостаточно'}});
          return json(res,200,{ok:true,recipientId:session.id,amount:b.amount,balanceBefore:w.balance,balanceAfter:w.balance-b.amount,simulation:true,payoutsEnabled:false});
        }catch(e){
          return json(res,502,{ok:false,error:{code:'wallet_unavailable',message:'Не удалось проверить баланс'}});
        }
      }
      return json(res,404,{ok:false,error:{code:'not_found',message:'Метод не найден'}});
    }
    const profileMatch=/^\/api\/huevo\/public-profile\/(\d+)$/.exec(url.pathname);
    if(req.method==='GET'&&profileMatch){
      try{
        const result=await getPublicUser(profileMatch[1]);
        return json(res,200,result);
      }catch(e){
        return json(res,e.retryAfter?429:502,{ok:false,error:{code:e.code||'upstream_error',message:'Не удалось получить профиль huEVO'},retryAfter:e.retryAfter||null});
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/friends'){
      // The player explicitly granted friends scope via SDK.
      // Token is used for this one upstream call only; never stored in the database.
      const b=await body(req);
      try{
        // Request friends who opened this app; never save the consent token or full friends list.
        const sort=b.sort==='added'?'added':'name';
        const offset=Number.isInteger(b.offset)?b.offset:0;
        if(offset<0||offset>10000)return json(res,400,{ok:false,error:{code:'bad_request',message:'Неверная страница списка'}});
        const result=await listFriendsServerOnly(b.token,{limit:100,offset,sort,inApp:1});
        if(!Number.isInteger(result.total)||!Array.isArray(result.friends))throw Error('Invalid huEVO friends response');
        const unique=new Set(),ranked=[];
        for(const friend of result.friends){
          const id=String(friend?.id??'');
          if(!/^\d+$/.test(id)||unique.has(id)||!friend.in_app)continue;
          unique.add(id);
          const record=db.huevoPlayers[session.mode+':'+id];
          if(!record)continue;
          ranked.push({id,name:String(friend.display_name||friend.username||record.name||'Игрок').slice(0,100),avatar:typeof friend.avatar==='string'?friend.avatar:'',score:record.best??0,online:Boolean(friend.online)});
        }
        ranked.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru'));
        return json(res,200,{ok:true,total:result.total,offset,received:result.friends.length,players:ranked,verifiedScores:false});
      }catch(e){
        return json(res,e.retryAfter?429:502,{ok:false,error:{code:e.code||'upstream_error',message:'Не удалось получить друзей из huEVO'},retryAfter:e.retryAfter||null});
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/run/start'){
      const run=createRun(key);
      return json(res,200,{ok:true,...run});
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/run/finish'){
      const b=await body(req);
      const check=verifyRun(key,b);
      if(!check.ok)return json(res,400,{ok:false,error:{code:'invalid_run',message:check.reason}});
      const result=await updatePlayer(()=>economy.award(player,check.score));
      return json(res,200,{ok:true,best:player.best,verified:true,apples:result.apples,inventory:result.inventory});
    }
    if(req.method==='GET'&&url.pathname==='/api/huevo/me')return json(res,200,{ok:true,user:{id:session.id,mode:session.mode,name:player.name,username:player.username,avatar:player.avatar,best:player.best},save:player.save,inventory:economy.state(player),canImportLegacy:!player.legacyMigrated});
    if(req.method==='GET'&&url.pathname==='/api/huevo/leaderboard')return json(res,200,{ok:true,mode:session.mode,verifiedScores:true,players:Object.entries(db.huevoPlayers).filter(([k])=>k.startsWith(session.mode+':')).sort((a,b)=>b[1].best-a[1].best).slice(0,20).map(([k,v])=>({id:k.slice(session.mode.length+1),name:v.name,avatar:v.avatar,score:v.best}))});
    if(req.method==='PUT'&&url.pathname==='/api/huevo/save')return json(res,410,{ok:false,error:{code:'readonly_inventory',message:'Сохранения синхронизируются автоматически'}});
    if(req.method==='POST'&&url.pathname==='/api/huevo/inventory/import'){
      const b=await body(req);
      const result=await updatePlayer(()=>economy.importOld(player,b.save));
      return json(res,result.ok?200:409,result.ok?result:{ok:false,error:{code:result.code,message:result.message}});
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/inventory/buy'){
      const b=await body(req);
      const result=await updatePlayer(()=>economy.buy(player,b.skinId));
      return json(res,result.ok?200:400,result.ok?result:{ok:false,error:{code:result.code,message:result.message}});
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/inventory/select'){
      const b=await body(req);
      const result=await updatePlayer(()=>economy.select(player,b.skinId,b.color));
      return json(res,result.ok?200:400,result.ok?result:{ok:false,error:{code:result.code,message:result.message}});
    }
    if(req.method==='POST'&&url.pathname==='/api/huevo/score')return json(res,410,{ok:false,error:{code:'use_verified_run',message:'Используйте проверяемую игровую партию'}});
    return json(res,404,{ok:false,error:{code:'not_found',message:'Метод не найден'}});
  }
  const {id,p}=await user(req,res);
  if(limited(id))return json(res,429,{error:'Слишком много запросов'});
  if(req.method==='GET'&&url.pathname==='/api/me')return json(res,200,{id:id.slice(0,10),name:p.name,best:p.best,save:p.save,mode:'guest-demo',friendCode:id.slice(0,10)});
  if(req.method==='GET'&&url.pathname==='/api/leaderboard')return json(res,200,{mode:'demo-unverified',players:Object.entries(db.players).sort((a,b)=>b[1].best-a[1].best).slice(0,20).map(([key,p])=>({name:p.name,score:p.best,code:key.slice(0,10)}))});
  if(req.method==='GET'&&url.pathname==='/api/friends')return json(res,200,{mode:'demo-manual-friends',players:p.friends.map(code=>Object.entries(db.players).find(([k])=>k.startsWith(code))).filter(Boolean).map(([key,v])=>({name:v.name,score:v.best,code:key.slice(0,10)})).sort((a,b)=>b.score-a.score)});
  if(req.method==='GET'&&url.pathname==='/api/save')return json(res,200,{save:p.save});
  if(req.method==='POST'&&url.pathname==='/api/profile'){const b=await body(req);if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>24)return json(res,400,{error:'Имя: от 2 до 24 символов'});p.name=b.name.trim().replace(/[<>]/g,'');await persist();return json(res,200,{ok:true,name:p.name})}
  if(req.method==='POST'&&url.pathname==='/api/score'){const b=await body(req);if(!scoreValid(b.score))return json(res,400,{error:'Некорректный счёт'});p.best=Math.max(p.best,b.score);await persist();return json(res,200,{ok:true,best:p.best,verified:false})}
  if(req.method==='PUT'&&url.pathname==='/api/save'){const b=await body(req);p.save=cleanSave(b.save);await persist();return json(res,200,{ok:true})}
  if(req.method==='POST'&&url.pathname==='/api/friends'){const b=await body(req);if(!/^[a-f0-9]{10}$/.test(b.code||''))return json(res,400,{error:'Неверный код'});const peer=Object.keys(db.players).find(k=>k.startsWith(b.code));if(!peer||peer===id)return json(res,404,{error:'Друг не найден'});p.friends=[...new Set([...p.friends,b.code])].slice(0,50);await persist();return json(res,200,{ok:true})}
  return json(res,404,{error:'Неизвестный метод'});
 }
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
 let file=url.pathname==='/'?'/index.html':url.pathname;
 file=path.resolve(PUBLIC,'.'+decodeURIComponent(file));if(!file.startsWith(PUBLIC+path.sep))return json(res,403,{error:'Forbidden'});
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','x-content-type-options':'nosniff'});res.end(data)});
 }catch(e){json(res,400,{error:'Некорректный запрос'})}
});
initialize().then(state=>{db=state;server.listen(PORT,()=>console.log(`Snake API listening on ${PORT}`))}).catch(error=>{console.error('Database initialization failed:',error);process.exit(1)});
