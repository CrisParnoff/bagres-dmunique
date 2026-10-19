import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector,{ value:'',innerHTML:'',textContent:'',style:{}, dataset:{},className:'',disabled:false,required:false, classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return [];},addEventListener(){},reset(){},scrollIntoView(){},setAttribute(){} });
  return nodes.get(selector);
}
const context = vm.createContext({console,structuredClone,Map,Set,Date,setTimeout,clearTimeout,document:{querySelector:node,querySelectorAll(){return [];}},localStorage:{getItem(){return null;}},confirm:()=>true});
const app = readFileSync('app.js','utf8').split("$$('.tab').forEach")[0];
vm.runInContext(app,context);
const run = code => vm.runInContext(code,context);
run(`globalThis.realRender = render; persist = async () => true; showToast = message => {globalThis.lastToast=message;}; render = () => {}; adminMode = true;`);

run(`state = defaultState(); state.players = [{id:'p',name:'Gabriel'}, {id:'r',name:'Rival'}, {id:'mate',name:'Parceiro'}];
const game = (win, extra={}) => ({date:'2026-10-19',teamA:['p','mate'],teamB:['r'],scoreA:win?2:1,scoreB:win?1:2,...extra});
const series = (wins,losses) => {state.matches=[...Array.from({length:wins},()=>game(true)),...Array.from({length:losses},()=>game(false))];};
const badge = goal => playerAchievements('p').find(item=>item.key==='rivalry-'+goal);`);
for (const goal of [10,20,30]) {
  run(`series(${goal-1},0)`);
  assert.equal(run(`badge(${goal}).unlocked`),false);
  run(`series(${goal},${goal-4})`);
  assert.equal(run(`badge(${goal}).unlocked`),false,'four-win lead is insufficient');
  run(`series(${goal},${goal-5})`);
  assert.equal(run(`badge(${goal}).unlocked`),true,'five-win lead qualifies');
}
run(`series(10,5); state.matches.push(game(true,{scoreA:2,scoreB:2}));`);
assert.equal(run(`playerRivalries('p')[0].draws`),1);
assert.equal(run(`playerRivalries('p').some(r=>r.id==='mate')`),false);
assert.equal(run(`playerRivalries('r')[0].losses`),10,'reverse perspective');
run(`state.matches.push(game(true,{roundId:'open'}),game(true,{roundId:'missing'}),game(true,{scoreA:null})); state.rounds=[{id:'open',date:'2026-10-19',closed:false,teams:{A:['p','mate'],B:['r'],C:[]},keepers:{},contributions:{}}];`);
assert.equal(run(`playerRivalries('p')[0].wins`),10,'exclude open, missing rounds and absent scores');
run(`state.rounds[0].closed=true;`);
assert.equal(run(`playerRivalries('p')[0].wins`),11,'closed round counts actual match result');
run(`state.matches[0].scoreA=0;`);
assert.equal(run(`badge(10).unlocked`),false,'corrections recalculate qualification');
run(`renderAchievements(state.players[0]);`);
assert.match(nodes.get('#playerAchievements').innerHTML,/Rivalidades/);
assert.match(nodes.get('#playerAchievements').innerHTML,/cada confronto/);
console.log('Rivalry achievement tests passed');
