'use strict';
const crypto=require('node:crypto');
const runs=new Map();
const MAX_STEPS=10000;
function next(seed){return (Math.imul(seed,1664525)+1013904223)>>>0}
function createRun(userKey){
  const id=crypto.randomBytes(16).toString('hex');
  const seed=crypto.randomBytes(4).readUInt32LE(0);
  const issued=Date.now();
  runs.set(id,{userKey,seed,issued});
  for(const [k,v] of runs)if(Date.now()-v.issued>3600000)runs.delete(k);
  return {runId:id,seed};
}
function verifyRun(userKey,input){
  const run=runs.get(input?.runId);
  if(!run||run.userKey!==userKey)return {ok:false,reason:'Партия не найдена'};
  runs.delete(input.runId); // consume before verification; no replay
  const elapsed=Date.now()-run.issued;
  const moves=input?.moves;
  if(!Array.isArray(moves)||moves.length<1||moves.length>MAX_STEPS||!Number.isSafeInteger(input.steps)||input.steps!==moves.length)
    return {ok:false,reason:'Неверная запись партии'};
  // Conservative anti-speed check, tolerates background timing and client jitter.
  if(elapsed<Math.max(0,moves.length*65-2500)||elapsed>3600000)return {ok:false,reason:'Недопустимое время партии'};
  const N=20;
  let snake=[{x:7,y:10},{x:6,y:10},{x:5,y:10}],heading='right',score=0,seed=run.seed,food;
  const dirs={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
  function spawn(){
    const free=[];
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(!snake.some(p=>p.x===x&&p.y===y))free.push({x,y});
    if(!free.length)return null;
    seed=next(seed);
    return free[Math.floor((seed/4294967296)*free.length)];
  }
  food=spawn();
  let ended=false;
  for(let i=0;i<moves.length;i++){
    const dir=moves[i];
    if(typeof dir!=='string'||!(dir in dirs))return {ok:false,reason:'Недопустимое направление'};
    const [dx,dy]=dirs[dir],[ox,oy]=dirs[heading];
    if(dx===-ox&&dy===-oy)return {ok:false,reason:'Разворот назад'};
    heading=dir;
    const head={x:snake[0].x+dx,y:snake[0].y+dy};
    const eating=food&&head.x===food.x&&head.y===food.y;
    const occupied=eating?snake:snake.slice(0,-1);
    const dead=head.x<0||head.y<0||head.x>=N||head.y>=N||occupied.some(p=>p.x===head.x&&p.y===head.y);
    if(dead){ended=true;if(i!==moves.length-1)return {ok:false,reason:'Шаги после конца игры'};break}
    snake.unshift(head);
    if(eating){score+=10;food=spawn();if(!food){ended=true;if(i!==moves.length-1)return {ok:false,reason:'Шаги после победы'};break}}
    else snake.pop();
  }
  if(!ended||score!==input.score)return {ok:false,reason:'Счёт не соответствует партии'};
  return {ok:true,score};
}
module.exports={createRun,verifyRun};
