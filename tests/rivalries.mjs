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
run(`state.matches.push(game(true,{roundId:'open'}),game(true,{roundId:'missing'}),game(true,{scoreA:null})); state.rounds=[{id:'open',date:'2026-10-19',closed:false,championTeam:'A',teams:{A:['p','mate'],B:['r'],C:[]},keepers:{},contributions:{}}];`);
assert.equal(run(`playerRivalries('p')[0].wins`),10,'exclude open, missing rounds and absent scores');
run(`state.rounds[0].closed=true;`);
assert.equal(run(`playerRivalries('p')[0].wins`),11,'closed round counts champion result once');
run(`state.matches[0].scoreA=0;`);
assert.equal(run(`badge(10).unlocked`),false,'corrections recalculate qualification');
run(`renderAchievements(state.players[0]);`);
assert.match(nodes.get('#playerAchievements').innerHTML,/Rivalidades/);
assert.match(nodes.get('#playerAchievements').innerHTML,/uma única vez por adversário/);
console.log('Rivalry achievement tests passed');
run(`state.rounds=[]; const sequence = results => { state.matches=results.map((result,index)=>game(result==='W',{date:'2026-10-'+String(index+1).padStart(2,'0'),...(result==='D'?{scoreA:1,scoreB:1}:{})})).reverse(); }; const special = key => playerAchievements('p').find(b=>b.key==='rivalry-'+key);`);
run(`sequence(['W','W']);`);
assert.equal(run(`special('streak').unlocked`),false);
run(`sequence(['W','W','D','W']);`);
assert.equal(run(`special('streak').unlocked`),false,'draw breaks streak');
run(`sequence(['W','W','W','L']);`);
assert.equal(run(`special('streak').unlocked`),true,'earned historical streak remains');
run(`sequence(['L','L','L','W']);`);
assert.equal(run(`special('revenge').unlocked`),true,'revenge follows three losses in chronological order');
run(`sequence(['L','L','D','L','W']);`);
assert.equal(run(`special('revenge').unlocked`),false,'draw breaks loss sequence');
run(`sequence(['L','L','L','W']); state.matches[0].scoreA=0;`);
assert.equal(run(`special('revenge').unlocked`),false,'score correction removes revenge');
run(`state.matches=[]; state.players.push({id:'c',name:'Terceiro'}); state.rounds=[{id:'day',date:'2026-10-19',closed:true,championTeam:'A',teams:{A:['p','mate'],B:['r'],C:['c']},keepers:{},contributions:{}}];
for(let i=0;i<9;i++) state.matches.push(game(false,{roundId:'day',scheduleIndex:i}));`);
assert.equal(run(`playerRivalries('p').find(r=>r.id==='r').wins`),1,'nine games give one win against rival');
assert.equal(run(`playerRivalries('p').find(r=>r.id==='c').wins`),1,'champion beats both opposing teams once');
assert.equal(run(`playerRivalries('r').find(r=>r.id==='p').losses`),1);
assert.equal(run(`playerRivalries('r').some(r=>r.id==='c')`),false,'losing teams do not beat each other');
assert.equal(run(`special('streak').unlocked`),false,'one round cannot earn a three-win streak');
run(`state.rounds[0].closed=false;`);
assert.equal(run(`playerRivalries('p').length`),0,'reopening removes the whole day');
run(`state.rounds[0].closed=true; state.rounds[0].championTeam='B';`);
assert.equal(run(`playerRivalries('p').find(r=>r.id==='r').losses`),1,'correcting champion updates rivalries');
console.log('Streak and revenge tests passed');

// Home celebrates only badges newly unlocked on the latest completed matchday.
run(`state=defaultState();state.players=[{id:'p',name:'Gabriel',stats:emptyStats()},{id:'r',name:'Rival',stats:emptyStats()},{id:'guest',name:'Convidado',stats:emptyStats()}];state.rounds=[];
state.matches=Array.from({length:5},(_,i)=>({id:'m'+i,date:'2026-10-'+String(i+1).padStart(2,'0'),teamA:['p'],teamB:['r'],scoreA:3,scoreB:1,contributions:{p:{goals:2,assists:0}},mvpPlayerId:i===4?'guest':null})).reverse();`);
assert.equal(run('recentAchievements().date'),'2026-10-05');
assert.equal(run(`recentAchievements().items.filter(i=>i.player.id==='p' && i.badge.key==='line-goals-10').length`),1);
assert.equal(run(`recentAchievements().items.some(i=>i.badge.key==='line-goals-1')`),false,'old first-goal badge is not repeated');
assert.equal(run(`recentAchievements().items.some(i=>i.player.id==='guest' && i.badge.key==='mvp-1')`),true,'awards outside lineup still count');
assert.equal(run(`recentAchievements().items.filter(i=>i.badge.key==='presence-5').length`),2);
run(`state.rounds=[{id:'newday',date:'2026-10-06',closed:false,teams:{A:['p'],B:['r'],C:[]},keepers:{A:'p'},championTeam:'A',contributions:{p:{goals:0,assists:0}}}];state.matches.unshift({id:'part',roundId:'newday',date:'2026-10-06',teamA:['p'],teamB:['r'],teamAKey:'A',teamBKey:'B',scoreA:3,scoreB:1});`);
assert.equal(run('recentAchievements().date'),'2026-10-05','draft round does not replace latest completed date');
run(`state.rounds[0].closed=true;`);
assert.equal(run('recentAchievements().date'),'2026-10-06');
assert.equal(run(`recentAchievements().items.filter(i=>i.badge.key.startsWith('keeper-conceded-')).length`),5,'goalkeeper milestones count once per day');
assert.equal(run(`recentAchievements().items.some(i=>i.badge.key==='line-goals-10')`),false,'previous day milestone is not repeated');
run('renderHomeAchievements();');
assert.match(nodes.get('#homeAchievements').innerHTML,/Gabriel/);
assert.equal(nodes.get('#homeAchievementsDate').textContent,'06/10/2026');
run(`state.rounds=[];state.matches=state.matches.filter(m=>!m.roundId);state.matches[0].contributions.p.goals=0;`);
assert.equal(run(`recentAchievements().items.some(i=>i.badge.key==='line-goals-10')`),false,'corrected result removes false milestone');
run(`state.matches.unshift({id:'quiet',date:'2026-10-07',teamA:['p'],teamB:['r'],scoreA:0,scoreB:0,contributions:{}});renderHomeAchievements();`);
assert.match(nodes.get('#homeAchievements').innerHTML,/Nenhuma nova conquista/);
run('state.matches=[];state.rounds=[];renderHomeAchievements();');
assert.equal(run('recentAchievements().items.length'),0);
assert.match(nodes.get('#homeAchievements').innerHTML,/primeiro jogo encerrado/);
console.log('Recent home achievements passed: thresholds, no duplicates, outside-lineup awards, open/closed rounds, keeper milestones, corrections and empty states.');

// Equal-progress opponents and partners all stay visible, including after unlock.
run(`state=defaultState();state.rounds=[];state.players=['p','mate1','mate2','r1','r2','r3','r4'].map(id=>({id,name:id==='r2'?'<Outro rival>':id,stats:emptyStats()}));state.matches=Array.from({length:2},(_,i)=>({id:'many'+i,date:'2026-10-0'+(i+1),teamA:['p','mate1','mate2'],teamB:['r1','r2','r3','r4'],scoreA:2,scoreB:1,contributions:{}}));`);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='rivalry-10').people.length`),4,'all tied opponents appear');
assert.equal(run(`playerAchievements('p').find(b=>b.key==='duo-win').people.length`),2,'all partners with progress appear');
run(`renderAchievements(state.players[0]);`);
assert.match(nodes.get('#playerAchievements').innerHTML,/Empatados na liderança/);
assert.match(nodes.get('#playerAchievements').innerHTML,/&lt;Outro rival&gt;/,'player names remain escaped');
assert.ok(!nodes.get('#playerAchievements').innerHTML.includes('<Outro rival>'));
run(`state.matches=Array.from({length:10},(_,i)=>({...state.matches[0],id:'win'+i,date:'2026-10-'+String(i+1).padStart(2,'0')}));`);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='rivalry-10').people.filter(p=>p.unlocked).length`),4,'every eligible opponent is marked unlocked');
assert.equal(run(`playerAchievements('p').find(b=>b.key==='duo-win').people.filter(p=>p.unlocked).length`),2);
console.log('All opponent/partner progress passed: ties, escaping and multiple unlocked people.');

// Only the leaders remain; a lower total must never enter the displayed list.
run(`state.matches[0].teamB=state.matches[0].teamB.filter(id=>id!=='r4');state.matches[0].teamA=state.matches[0].teamA.filter(id=>id!=='mate2');`);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='rivalry-10').people.length`),3);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='rivalry-10').people.some(p=>p.id==='r4')`),false);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='duo-win').people.length`),1);
assert.equal(run(`playerAchievements('p').find(b=>b.key==='duo-win').people[0].id`),'mate1');
console.log('Only leaders shown: every tie included, lower totals omitted.');
