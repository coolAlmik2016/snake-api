'use strict';
// Server-authoritative Snake apples and cosmetics.
// Historical browser data is accepted at most once for pre-existing accounts.
const COSTS=Object.freeze({mint:0,blue:2,lavender:4,peach:6,rose:9,gold:12,palette:100,rainbow:200});
const ALL=Object.keys(COSTS),MAX_WALLET=100000,DEFAULT_COLOR='#7bd9ca';
const has=(x)=>Object.prototype.hasOwnProperty.call(COSTS,x);
const validColor=(x)=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
function fresh(){return {wallet:0,skinId:'mint',owned:['mint'],customColor:DEFAULT_COLOR,revision:0}}
function fromLegacy(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return fresh();
  const owned=['mint',...(Array.isArray(value.owned)?value.owned.filter(has):[])];
  const unique=[...new Set(owned)].slice(0,ALL.length);
  const wallet=Math.min(MAX_WALLET,Math.max(0,Number.isFinite(Number(value.wallet))?Math.floor(Number(value.wallet)):0));
  return {wallet,skinId:unique.includes(value.skinId)?value.skinId:'mint',owned:unique,customColor:validColor(value.customColor)?value.customColor:DEFAULT_COLOR,revision:0};
}
function ensure(player,isNew=false){
  if(!player.inventory){
    player.inventory=fromLegacy(player.save);
    // A previous manual cloud save takes precedence over untrusted device progress.
    player.legacyMigrated=Boolean(player.save)||isNew;
  }else{
    const rev=Number.isSafeInteger(player.inventory.revision)?player.inventory.revision:0;
    player.inventory=fromLegacy(player.inventory);
    player.inventory.revision=Math.max(0,rev);
  }
  if(!Number.isSafeInteger(player.inventory.revision)||player.inventory.revision<0)player.inventory.revision=0;
  player.save={...player.inventory}; // backward-readable snapshot, never writable from client
  return player.inventory;
}
function state(player){return player.inventory}
function importOld(player,raw){
  if(player.legacyMigrated)return {ok:false,code:'already_migrated',message:'Старые данные уже перенесены'};
  // The one-time import is inherently unverified. It exists only for older accounts.
  player.inventory=fromLegacy(raw);
  player.legacyMigrated=true;
  player.save={...player.inventory};
  return {ok:true,inventory:player.inventory};
}
function sync(player){player.inventory.revision=(player.inventory.revision||0)+1;player.save={...player.inventory}}
function award(player,score){
  if(!Number.isSafeInteger(score)||score<0||score%10!==0||score>4000)throw Error('Score must be verified');
  const apples=score/10;
  player.best=Math.max(Number(player.best)||0,score);
  player.inventory.wallet=Math.min(MAX_WALLET,player.inventory.wallet+apples);
  player.legacyMigrated=true;
  sync(player);
  return {apples,inventory:state(player)};
}
function buy(player,id){
  if(!has(id)||id==='mint')return {ok:false,code:'unknown_skin',message:'Неизвестный цвет'};
  const inv=player.inventory;
  if(inv.owned.includes(id))return {ok:true,alreadyOwned:true,inventory:inv};
  if(inv.wallet<COSTS[id])return {ok:false,code:'not_enough_apples',message:'Недостаточно яблок'};
  inv.wallet-=COSTS[id];
  inv.owned.push(id);
  inv.skinId=id;
  player.legacyMigrated=true;
  sync(player);
  return {ok:true,purchased:true,cost:COSTS[id],inventory:inv};
}
function select(player,id,color){
  if(!has(id)||!player.inventory.owned.includes(id))return {ok:false,code:'skin_locked',message:'Этот цвет ещё не куплен'};
  if(color!==undefined&&(id!=='palette'||!validColor(color)))return {ok:false,code:'invalid_color',message:'Недопустимый цвет'};
  if(player.inventory.skinId===id&&(color===undefined||player.inventory.customColor===color))return {ok:true,unchanged:true,inventory:player.inventory};
  player.inventory.skinId=id;
  if(id==='palette'&&color!==undefined)player.inventory.customColor=color;
  player.legacyMigrated=true;
  sync(player);
  return {ok:true,inventory:player.inventory};
}
module.exports={COSTS,ensure,state,importOld,award,buy,select,fromLegacy};
