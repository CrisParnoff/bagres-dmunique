import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { createSupabaseEnv } from '../server/supabase.mjs';
import { handleVercelRequest } from '../server/vercel-handler.mjs';
import entry from '../api/[...path].js';
const salt=Buffer.alloc(16,7), password='test-password-only';
const config={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_server-test-key',ADMIN_SESSION_KEY:'test-session-secret',ADMIN_PASSWORD_HASH:salt.toString('hex')+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')};
let row=null;const attempts=new Map(),photos=new Map(),calls=[];
const response=(value,status=200,headers={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
async function upstream(url,options){
 const path=new URL(url).pathname,query=new URL(url).searchParams;
 assert.equal(options.headers.apikey,config.SUPABASE_SECRET_KEY);
 assert.equal(options.headers.Authorization,undefined);
 calls.push({path,options});
 const body=options.body && typeof options.body==='string'?JSON.parse(options.body):null;
 if(path==='/rest/v1/site_state')return response(row?[row]:[]);
 if(path==='/rest/v1/rpc/save_site_state'){
  if(body.p_expected_version !== (row?.version||0))return response(0);
  row={data:body.p_data,version:(row?.version||0)+1};return response(row.version);
 }
 if(path==='/rest/v1/admin_attempts'){
  const key=query.get('client_key')?.slice(3);
  if(options.method==='POST'){attempts.set(body.client_key,{failures:body.failures,locked_until:body.locked_until});return response(null,204);}
  if(options.method==='DELETE'){attempts.delete(key);return response(null,204);}
  return response(attempts.has(key)?[attempts.get(key)]:[]);
 }
 if(path.startsWith('/storage/v1/object/authenticated/')){
  const key=path.slice('/storage/v1/object/authenticated/bagres-player-photos/'.length);
  const photo=photos.get(key);return photo?new Response(photo.bytes,{headers:{'Content-Type':photo.type}}):response({message:'not found'},404);
 }
 if(path==='/storage/v1/object/bagres-player-photos' && options.method==='DELETE'){body.prefixes.forEach(key=>photos.delete(key));return response([]);}
 if(path.startsWith('/storage/v1/object/bagres-player-photos/') && options.method==='POST'){
  photos.set(path.slice('/storage/v1/object/bagres-player-photos/'.length),{bytes:options.body,type:options.headers['Content-Type']});return response({Key:'saved'});
 }
 throw new Error('Unexpected upstream route '+path);
}
const origin='https://bagres-test.vercel.app';
const request=(path,method='GET',body,headers={})=>new Request(origin+path,{method,headers:{Origin:origin,...(body?'Content-Type'in headers?{}:{'Content-Type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'||body instanceof FormData?body:JSON.stringify(body)}:{})});
const run=req=>handleVercelRequest(req,config,upstream);
assert.equal(typeof entry.fetch,'function');
const publicInitial=await run(request('/api/state'));assert.equal(publicInitial.status,200);assert.equal((await publicInitial.json()).version,0);
assert.equal((await run(request('/api/state','PUT',{expectedVersion:0,state:{}}))).status,403);
assert.equal((await run(request('/api/admin/login','POST',{password},{Origin:'https://other.example'}))).status,403);
const login=await run(request('/api/admin/login','POST',{password},{'x-vercel-forwarded-for':'203.0.113.1','CF-Connecting-IP':'spoofed'}));
assert.equal(login.status,200);const cookie=login.headers.get('Set-Cookie').split(';')[0];assert.match(login.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Strict/);
const admin={Cookie:cookie};
assert.equal((await (await run(request('/api/session','GET',null,admin))).json()).admin,true);
const seed=await (await run(request('/api/seed','GET',null,admin))).json();
const saves=await Promise.all([run(request('/api/state','PUT',{expectedVersion:0,state:seed},admin)),run(request('/api/state','PUT',{expectedVersion:0,state:seed},admin))]);
assert.deepEqual(saves.map(r=>r.status).sort(),[200,409],'concurrent writes cannot overwrite newer state');
assert.equal((await run(request('/api/state','PUT',{expectedVersion:1,state:seed},admin))).status,200);
assert.equal(row.version,2);
const pendingAdmin={...config,ADMIN_PASSWORD_HASH:undefined,ADMIN_SESSION_KEY:undefined};
const readOnly=req=>handleVercelRequest(req,pendingAdmin,upstream);
const available=await readOnly(request('/api/state'));assert.equal(available.status,200);
assert.equal((await available.json()).state.players[0].rating,undefined);
assert.equal((await (await readOnly(request('/api/session'))).json()).admin,false);
assert.equal((await readOnly(request('/api/admin/login','POST',{password}))).status,503);
assert.equal((await readOnly(request('/api/state','PUT',{expectedVersion:2,state:seed},admin))).status,403);
assert.equal(row.version,2,'pending admin setup cannot authorize writes');
const publicState=await (await run(request('/api/state'))).json();assert.equal(publicState.state.players[0].rating,undefined);
const privateState=await (await run(request('/api/state','GET',null,admin))).json();assert.equal(privateState.state.players[0].rating,5);
for(let i=0;i<5;i++)assert.equal((await run(request('/api/admin/login','POST',{password:'wrong'},{'x-vercel-forwarded-for':'203.0.113.2'}))).status,401);
assert.equal((await run(request('/api/admin/login','POST',{password},{'x-vercel-forwarded-for':'203.0.113.2'}))).status,429);
assert.equal((await run(request('/api/admin/login','POST',{password},{'x-vercel-forwarded-for':'203.0.113.3'}))).status,200,'another client is not globally locked');
const form=new FormData();form.set('id','p1');form.set('photo',new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),'photo.png');
const upload=await run(new Request(origin+'/api/player-photo',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form}));assert.equal(upload.status,200);
const {photoKey}=await upload.json();
for(const prefix of ['/player-photos/','/api/player-photos/']){
 const result=await run(request(prefix+photoKey));assert.equal(result.status,200);assert.equal(result.headers.get('Content-Type'),'image/png');assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[1,2,3]);
}
assert.equal((await run(request('/api/player-photo/delete','POST',{id:'p1',photoKey},admin))).status,200);
assert.equal((await run(request('/player-photos/'+photoKey))).status,404);
for(const [type,bytes] of [
 ['image/jpeg',[255,216,255,224]],
 ['image/png',[137,80,78,71,13,10,26,10]],
 ['image/webp',[82,73,70,70,0,0,0,0,87,69,66,80]]
]) {
 photos.set(photoKey,{bytes:new Uint8Array(bytes),type:'binary/octet-stream'});
 const migrated=await run(request('/player-photos/'+photoKey));
 assert.equal(migrated.status,200);assert.equal(migrated.headers.get('Content-Type'),type);
 assert.deepEqual([...new Uint8Array(await migrated.arrayBuffer())],bytes);
}
photos.set(photoKey,{bytes:new TextEncoder().encode('<script>alert(1)</script>'),type:'application/octet-stream'});
assert.equal((await run(request('/player-photos/'+photoKey))).status,404,'unrecognized binary is never exposed as an image');
photos.set(photoKey,{bytes:new Uint8Array(2*1024*1024+1),type:'binary/octet-stream'});
assert.equal((await run(request('/player-photos/'+photoKey))).status,404,'oversized legacy images are rejected');
photos.delete(photoKey);
assert.equal((await run(request('/api/admin/logout','POST',{},admin))).status,200);
const env=createSupabaseEnv(config,upstream);
await assert.rejects(()=>env.BUCKET.get('../secret'));
assert.throws(()=>createSupabaseEnv({}),/configuration/);
const failure=await handleVercelRequest(request('/api/state'),{},upstream);assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes(config.SUPABASE_SECRET_KEY));
const broken=await handleVercelRequest(request('/api/state'),config,async()=>response({message:'failure'},500));assert.equal(broken.status,503);
const sql=readFileSync('supabase/migrations/0001_bagres.sql','utf8');assert.match(sql,/where id=1 and version=p_expected_version/);assert.match(sql,/from public, anon, authenticated/);
const staticApp=readFileSync('public/app.js','utf8'),html=readFileSync('public/index.html','utf8');
assert.ok(!staticApp.includes(config.SUPABASE_SECRET_KEY));assert.ok(!html.includes('__FCBAGRES_'));assert.match(html,/\/assets\/fcbagres-logo.webp/);
const legacyKey='eyJ.test-legacy-jwt';
await createSupabaseEnv({...config,SUPABASE_SECRET_KEY:undefined,SUPABASE_SERVICE_ROLE_KEY:legacyKey},async(url,options)=>{
 assert.equal(options.headers.apikey,legacyKey);assert.equal(options.headers.Authorization,'Bearer '+legacyKey);return response([]);
}).DB.prepare('SELECT data, version FROM site_state WHERE id = 1').first();
assert.throws(()=>createSupabaseEnv({...config,SUPABASE_SECRET_KEY:'sb_publishable_client-key'}),/server secret/);
console.log('Passed: Supabase REST state/version conflicts, admin login/rate limit/origin checks, private/public projection, photo upload/read/delete and Vercel build.');
