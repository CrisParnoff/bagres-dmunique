import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const backend=vm.createContext({Response,Request,URL,console,TextEncoder,crypto:globalThis.crypto});
vm.runInContext(readFileSync('dist/server/index.js','utf8').replace('export default {','const worker = {').replace('const isAdmin = signedSession;', 'let isAdmin = signedSession;'),backend);
vm.runInContext('isAdmin=async request=>request.headers.get("X-Test-Admin")==="yes";',backend);
let version=1;
let state={players:['a','b','c'].map(id=>({id,name:id,rating:3,stats:{}})),matches:[{id:'m',date:'2026-11-12',teamA:['a'],teamB:['b','c'],scoreA:2,scoreB:1,teamAName:'A',teamBName:'B'}],rounds:[],teamAName:'A',teamBName:'B',matchDate:'2026-11-12',aiSettings:{key:'secret'}};
const env={DB:{prepare(sql){let args;return {bind(...values){args=values;return this;},async first(){return {data:JSON.stringify(state),version};},async run(){if(args[1]!==version)return {meta:{changes:0}};state=JSON.parse(args[0]);version++;return {meta:{changes:1}};}};}}};
backend.env=env;
async function req(action,extra={},admin=false,origin='https://test.example'){
 const request=new Request('https://test.example/api/voting',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(admin?{'X-Test-Admin':'yes'}:{})},body:JSON.stringify({action,date:'2026-11-12',...extra})});backend.request=request;return vm.runInContext('worker.fetch(request,env)',backend);
}
assert.equal((await req('open')).status,403);
assert.equal((await req('open',{},true)).status,200);
assert.equal((await req('vote',{voter:'outside',mvp:'a',bagre:'b'})).status,400);
assert.equal((await req('vote',{voter:'a',mvp:'a',bagre:'b'},false,'https://evil.example')).status,403);
const concurrent=await Promise.all([req('vote',{voter:'a',mvp:'b',bagre:'c'}),req('vote',{voter:'b',mvp:'a',bagre:'c'})]);
assert.ok(concurrent.every(r=>r.status===200));assert.equal(Object.keys(state.voting['2026-11-12'].ballots).length,2);
assert.equal((await req('vote',{voter:'a',mvp:'c',bagre:'b'})).status,409);
backend.request=new Request('https://test.example/api/voting');let view=await (await vm.runInContext('worker.fetch(request,env)',backend)).json();assert.equal(view.total,2);assert.equal(view.results.find(p=>p.id==='c').bagre,2);assert.equal(view.ballots,undefined);
backend.sample=state;assert.equal(vm.runInContext('withoutPrivate(sample).voting',backend),undefined);assert.equal(vm.runInContext('publicState(sample).voting',backend),undefined);
assert.equal((await req('remove',{voter:'a'})).status,403);
assert.equal((await req('remove',{voter:'a'},true)).status,200);assert.equal(Object.keys(state.voting['2026-11-12'].ballots).length,1);
assert.equal((await req('vote',{voter:'a',mvp:'c',bagre:'b'})).status,200);
assert.equal((await req('close',{},true)).status,200);assert.equal((await req('vote',{voter:'c',mvp:'a',bagre:'b'})).status,409);
assert.equal((await req('open',{},true)).status,200);assert.equal(Object.keys(state.voting['2026-11-12'].ballots).length,2);
backend.request=new Request('https://test.example/api/state',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://test.example','X-Test-Admin':'yes'},body:JSON.stringify({expectedVersion:version,state:{...state,voting:{}}})});
assert.equal((await vm.runInContext('worker.fetch(request,env)',backend)).status,200);assert.equal(Object.keys(state.voting['2026-11-12'].ballots).length,2);
await vm.runInContext('saveAiSettings(env,{prompt:"new"})',backend);assert.equal(Object.keys(state.voting['2026-11-12'].ballots).length,2);assert.equal(state.aiSettings.key,'secret');
// Daily records group appearances and exclude open rounds.
const front=vm.createContext({console,Date,Map,Set,document:{querySelector:()=>null,querySelectorAll:()=>[]}});
vm.runInContext(readFileSync('app.js','utf8').split("$$('.tab').forEach")[0],front);
vm.runInContext(`state=defaultState();state.players=[{id:'a',name:'A'}];state.matches=[
{date:'2026-11-01',teamA:['a'],teamB:['b'],scoreA:2,scoreB:0,contributions:{a:{goals:2,assists:1}}},
{date:'2026-11-08',teamA:['a'],teamB:['b'],scoreA:1,scoreB:1,contributions:{a:{goals:1}}},
{date:'2026-11-12',teamA:['a'],teamB:['b'],scoreA:0,scoreB:1,contributions:{}},
{date:'2026-11-19',roundId:'open',teamA:['a'],teamB:['b'],scoreA:9,scoreB:0,contributions:{a:{goals:9}}}];`,front);
let stats=vm.runInContext('playerRunStats("a")',front);assert.equal(stats.best.unbeaten,2);assert.equal(stats.current.unbeaten,0);assert.equal(stats.best.goals,2);assert.equal(stats.maxGoals,2);assert.equal(stats.lastDate,'2026-11-12');
vm.runInContext(`state.rounds=[{id:'open',date:'2026-11-19',closed:true,championTeam:'A',teams:{A:['a'],B:['b'],C:['c']},keepers:{},contributions:{a:{goals:5,assists:3}}}];`,front);
stats=vm.runInContext('playerRunStats("a")',front);assert.equal(stats.current.win,1);assert.equal(stats.maxGoals,5);assert.equal(stats.maxAssists,3);
console.log('Passed: voting permissions, duplicates, concurrent writes, partial privacy, removal/revote, close/reopen, preservation and daily streaks/records.');
