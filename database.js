'use strict';
// Durable state for Snake. DATABASE_URL must remain server-side (Render Environment).
const fs=require('node:fs');
const path=require('node:path');
const FILE=process.env.DATA_FILE||path.join(__dirname,'data.json');
let pool=null;
let queue=Promise.resolve();
const empty=()=>({players:{},huevoPlayers:{}});
function normalize(x){if(!x||typeof x!=='object')return empty();return {players:x.players&&typeof x.players==='object'?x.players:{},huevoPlayers:x.huevoPlayers&&typeof x.huevoPlayers==='object'?x.huevoPlayers:{}}}
async function initialize(){
  if(process.env.DATABASE_URL){
    const {Pool}=require('pg');
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:12000,ssl:{rejectUnauthorized:true}});
    await pool.query('CREATE TABLE IF NOT EXISTS snake_state (id INTEGER PRIMARY KEY CHECK (id = 1), data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())');
    // Existing local data may be imported only into an EMPTY database.
    const existing=await pool.query('SELECT data FROM snake_state WHERE id=1');
    if(existing.rows.length)return normalize(existing.rows[0].data);
    let initial=empty();
    try{initial=normalize(JSON.parse(fs.readFileSync(FILE,'utf8')))}catch(_){}
    await pool.query('INSERT INTO snake_state(id,data) VALUES (1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[JSON.stringify(initial)]);
    const saved=await pool.query('SELECT data FROM snake_state WHERE id=1');
    console.log('Snake: persistent PostgreSQL storage active');
    return normalize(saved.rows[0].data);
  }
  let x=empty();
  try{x=normalize(JSON.parse(fs.readFileSync(FILE,'utf8')))}catch(_){}
  console.warn('Snake: DATABASE_URL is missing; using EPHEMERAL local JSON storage');
  return x;
}
async function persist(data){
  const snapshot=JSON.stringify(normalize(data));
  if(pool){
    const job=queue.then(()=>pool.query('UPDATE snake_state SET data=$1::jsonb,updated_at=NOW() WHERE id=1',[snapshot]));
    queue=job.catch(err=>{console.error('PostgreSQL write failed:',err.message)});
    await job;
  }else{
    const tmp=FILE+'.tmp';
    fs.writeFileSync(tmp,snapshot);fs.renameSync(tmp,FILE);
  }
}
module.exports={initialize,persist};
