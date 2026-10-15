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
function fixture(count) {
  run(`state = defaultState(); state.matchDate = "2026-10-07"; state.players = Array.from({length:${count}},(_,i)=>({id:"p"+i,name:"Jogador "+i,rating:1+i%5,available:true,team:null,stats:emptyStats()}));`);
}
fixture(14); assert.equal(run('activeTeamKeys().length'),2); run('autoBalance()'); assert.equal(run('teamPlayers("A").length'),7); assert.equal(run('teamPlayers("C").length'),0);
for (const n of [15,16,17,18,21]) {
  fixture(n); run('state.players[0].fixedGoalkeeper = true; state.players[1].fixedGoalkeeper = true; state.players[2].fixedGoalkeeper = true; autoBalance();');
  assert.equal(run('activeTeamKeys().length'),3);
  assert.ok(run('Math.max(...activeTeamKeys().map(k=>teamPlayers(k).length))-Math.min(...activeTeamKeys().map(k=>teamPlayers(k).length))<=1'));
  assert.ok(run('activeTeamKeys().every(k=>teamPlayers(k).filter(p=>p.fixedGoalkeeper).length===1)'));
}
// Manual swaps support every pair, including selecting C first or second.
for (const [first,second] of [['A','B'],['B','A'],['A','C'],['C','A'],['B','C'],['C','B']]) {
  fixture(15); run('autoBalance(); selectedSwapId=null;');
  const a=run(`teamPlayers("${first}")[0].id`), b=run(`teamPlayers("${second}")[0].id`);
  run(`selectSwap("${a}"); selectSwap("${b}");`);
  assert.equal(run(`state.players.find(p=>p.id==="${a}").team`),second);
  assert.equal(run(`state.players.find(p=>p.id==="${b}").team`),first);
  assert.equal(run('selectedSwapId'),null);
}
fixture(15); run('autoBalance(); selectedSwapId=null;');
const cancelId=run('teamPlayers("C")[0].id'); run(`selectSwap("${cancelId}"); selectSwap("${cancelId}");`);
assert.equal(run('selectedSwapId'),null,'C selection can be cancelled');
// Prevent a swap that would put two fixed keepers together.
fixture(15); run('state.players[0].fixedGoalkeeper=true; state.players[1].fixedGoalkeeper=true; autoBalance(); selectedSwapId=null;');
const keeperTeam=run('state.players[0].team'), otherTeam=run('state.players[1].team');
const outfieldId=run(`teamPlayers("${otherTeam}").find(p=>!p.fixedGoalkeeper).id`);
run(`selectSwap("p0"); selectSwap("${outfieldId}");`);
assert.equal(run('state.players[0].team'),keeperTeam);
assert.equal(run(`state.players.find(p=>p.id==="${outfieldId}").team`),otherTeam);
// A single goalkeeper gets weight 5 regardless of their outfield rating.
fixture(15);
run('state.players[0].rating=1; state.players[0].fixedGoalkeeper=true; autoBalance();');
assert.equal(run('balanceWeight(state.players[0])'),5);
assert.equal(run('state.players[0].rating'),1,'outfield rating is unchanged');
assert.equal(run('teamTotal(state.players[0].team)'),run('teamPlayers(state.players[0].team).reduce((sum,p)=>sum+(p.fixedGoalkeeper?5:p.rating),0)'));
run('state.players[1].fixedGoalkeeper=true; autoBalance();');
assert.equal(run('balanceWeight(state.players[0])'),0,'multiple keepers retain previous handling');
// Reproduce the supplied roster: old sums were 12, 15, 15 excluding Cris.
fixture(15);
run('const ratings=[5,2,3,2,3,5,4,2,1,3,4,5,2,1,3]; state.players.forEach((p,i)=>p.rating=ratings[i]); state.players[2].fixedGoalkeeper=true; autoBalance();');
assert.equal(run('balanceWeight(state.players[2])'),5);
assert.ok(run('Math.max(...activeTeamKeys().map(teamTotal))-Math.min(...activeTeamKeys().map(teamTotal))<=2'));
fixture(15); run('state.players[0].fixedGoalkeeper = true; autoBalance(); globalThis.round = ensureRound();');
assert.equal(run('new Set(Object.values(round.teams).flat()).size'),15);
run(`roundSchedule.forEach((pair,index)=>{ const [a,b]=pair.split('-'); state.matches.push({id:'m'+index,date:round.date,roundId:round.id,scheduleIndex:index,teamAKey:a,teamBKey:b,teamAName:round.names[a],teamBName:round.names[b],teamA:round.teams[a].slice(),teamB:round.teams[b].slice(),goalkeeperAId:round.keepers[a],goalkeeperBId:round.keepers[b],scoreA:a==='A'?2:1,scoreB:b==='A'?2:1,contributions:{}}); });`);
assert.ok(run('roundStandings(round).every(row=>row.games===6)'));
assert.equal(run('roundStandings(round)[0].key'),'A'); assert.equal(run('roundStandings(round)[0].points'),18);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").games'),0,'unclosed day stays out of ranking');
run(`Object.values(round.teams).flat().forEach(id=>round.contributions[id]={goals:0,assists:0}); const scorer=round.teams.A.find(id=>id!==round.keepers.A); globalThis.scorer=scorer; round.contributions[scorer]={goals:4,assists:2}; round.contributions.p0={goals:1,assists:1}; round.mvpPlayerId=scorer; round.bolaMurchaPlayerId=round.teams.B[0]; round.championTeam='A'; round.closed=true;`);
assert.equal(run('rankingStatsForMatches(state.matches).get(scorer).goals'),4);
assert.equal(run('rankingStatsForMatches(state.matches).get(scorer).assists'),2);
assert.equal(run('rankingStatsForMatches(state.matches).get(scorer).wins'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get(scorer).games'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get(round.teams.B[0]).losses'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get(round.teams.B[0]).wins'),0);
assert.equal(run('rankingStatsForMatches(state.matches).get(scorer).mvps'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").goalkeeperGames'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").goalkeeperConceded'),6);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").lineGames'),0);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").lineGoals'),0);
assert.equal(run('rankingStatsForMatches(state.matches).get("p0").goals'),1,'general totals include keeper goals but line averages exclude them');
run('rebuildStats()'); assert.equal(run('state.players.find(p=>p.id===scorer).stats.goals'),4);
// A month filtered to other matches must not inherit round contributions.
assert.equal(run('rankingStatsForMatches([]).get(scorer).goals'),0);
// Old two-team history still counts normally.
run(`state.matches.push({id:'old',date:'2026-09-01',teamAName:'A',teamBName:'B',teamA:['p0'],teamB:[scorer],scoreA:1,scoreB:0,contributions:{p0:{goals:1,assists:0}},mvpPlayerId:'p0',bolaMurchaPlayerId:scorer});`);
assert.equal(run('rankingStatsForMatches(state.matches.filter(m=>m.id==="old")).get("p0").goals'),1);
assert.equal(run('rankingStatsForMatches(state.matches.filter(m=>m.id==="old")).get("p0").lineGames'),1);
// Backend checks saved snapshots, schedule indexes, final champion and no double counting.
let worker = readFileSync('server/worker.template.mjs','utf8').replace('__HTML_CONTENT__','""').replace('__CSS_CONTENT__','""').replace('__APP_CONTENT__','""').replace('export default {','const worker = {');
const backend = vm.createContext({console}); vm.runInContext(worker,backend);
const valid = data => {backend.sample = structuredClone(data); return vm.runInContext('validState(sample)',backend);};
const sample = run('structuredClone(state)'); assert.ok(valid(sample));
const mutate = change => {const data=structuredClone(sample); change(data); return data;};
assert.equal(valid(mutate(s=>s.rounds[0].championTeam='B')),false,'nonleader cannot be champion');
assert.equal(valid(mutate(s=>s.matches[0].scheduleIndex=s.matches[1].scheduleIndex)),false);
assert.equal(valid(mutate(s=>s.matches[0].contributions={p0:{goals:1,assists:0}})),false,'match-level contributions forbidden for aggregated round');
assert.equal(valid(mutate(s=>s.matches.pop())),true,'old ordinary game independent of round');
assert.equal(valid(mutate(s=>s.matches.shift())),false,'closed round must have all nine');
assert.equal(valid(mutate(s=>s.rounds[0].contributions.p0.goals=99)),false);
backend.sample=sample; const pub=vm.runInContext('publicState(sample)',backend); assert.equal(pub.players[0].rating,undefined); assert.equal(pub.matches[0].roundId,sample.rounds[0].id);
// Draws leave a tie; only one chosen tied team is champion.
const drawDay = mutate(s=>{s.matches.filter(m=>m.roundId).forEach(m=>{m.scoreA=2;m.scoreB=2;});s.rounds[0].championTeam='C';}); assert.ok(valid(drawDay));
// Reopening removes stats and awards; changing rosters after save doesn't rewrite participants.
run('round.closed=false; round.championTeam=null; state.players.forEach(p=>p.team="B");');
assert.equal(run('rankingStatsForMatches(state.matches.filter(m=>m.roundId)).get(scorer).goals'),0);
assert.equal(run('entryPlayers("A").length'),5);
run('state.matches = state.matches.filter(m=>m.roundId);');
// Smoke render both public/admin round panel against DOM contract.
run('renderRound(); adminMode=false; renderRound();');
assert.ok(node('#roundPanel').innerHTML.includes('9 jogos de 10 minutos'));
assert.ok(!node('#roundPanel').innerHTML.includes('<th>Pontos</th>'));
assert.ok(node('#roundStandingsFooter').innerHTML.includes('<th>Pontos</th>'));
assert.ok(node('#roundStandingsFooter').innerHTML.includes('Vitória 3 · empate 1 · derrota 0'));
assert.ok(!node('#roundStandingsFooter').innerHTML.includes('standings-champion'));
assert.ok(!node('#roundPanel').innerHTML.includes('data-round-game="0" class="round-game"><input'));
node('#monthlyRankingSort').value = 'goals'; node('#annualRankingSort').value = 'goals';
run('adminMode=true; realRender(); adminMode=false; realRender();');
// Close a tied day, reject missing tiebreak winner, and count only one title.
run('adminMode=true; state.matches.forEach(m=>{m.scoreA=2;m.scoreB=2;});');
node('#matchMvp').value = run('round.teams.A[0]'); node('#matchBolaMurcha').value = run('round.teams.B[0]');
node('#roundChampion').value = '';
await run('closeRound()'); assert.equal(run('currentRound().closed'),false);
node('#roundChampion').value = 'C';
await run('closeRound()'); assert.equal(run('currentRound().closed'),true);
assert.equal(run('currentRound().championTeam'),'C');
assert.equal(run('rankingStatsForMatches(state.matches).get(currentRound().teams.C[0]).wins'),1);
assert.equal(run('rankingStatsForMatches(state.matches).get(currentRound().teams.A[0]).wins'),0);
assert.ok(valid(run('structuredClone(state)')));
// Renaming changes the active round's nine fixtures and champion name only.
const savedScores = run('JSON.stringify(state.matches.map(m=>[m.scoreA,m.scoreB]))');
run('updateTeamName("A","Equipe Quinha"); updateTeamName("B","Equipe Cão"); updateTeamName("C","Amarelo");');
assert.equal(run('currentRound().names.A'),'Equipe Quinha');
assert.equal(run('currentRound().names.B'),'Equipe Cão');
assert.ok(run('roundMatches(currentRound()).every(m=>m.teamAName===currentRound().names[m.teamAKey]&&m.teamBName===currentRound().names[m.teamBKey])'));
assert.equal(run('JSON.stringify(state.matches.map(m=>[m.scoreA,m.scoreB]))'),savedScores);
assert.ok(valid(run('structuredClone(state)')));
assert.ok(node('#roundPanel').innerHTML.includes('Equipe Quinha'));
assert.ok(node('#roundPanel').innerHTML.includes('Equipe Cão'));
const oldNames = run('JSON.stringify(currentRound().names)');
run('state.matchDate="2026-10-08"; updateTeamName("A","Outro dia");');
assert.equal(run('JSON.stringify(state.rounds[0].names)'),oldNames,'other days keep their historical names');
assert.ok(node('#roundPanel').innerHTML.includes('Outro dia'));
// Unsaved scores survive a name edit.
node('#roundPanel').querySelectorAll = () => [{dataset:{roundGame:'0'},elements:{scoreA:{value:'3'},scoreB:{value:'2'}}}];
run('updateTeamName("C","Novo nome");');
assert.ok(node('#roundPanel').innerHTML.includes('name="scoreA" min="0" max="99" required value="3"'));
assert.ok(node('#roundPanel').innerHTML.includes('name="scoreB" min="0" max="99" required value="2"'));
node('#roundPanel').querySelectorAll = () => [];
run('adminMode=false; updateTeamName("A","Sem acesso");');
assert.equal(run('state.teamAName'),'Outro dia');
// No accidental element IDs introduced in code that are absent from HTML.
const html = readFileSync('index.html','utf8');
for (const id of ['teamCName','teamCList','teamCEmpty','teamCTotal','teamCCard','roundPanel','roundStandingsFooter','scoreFormTitle','scoreFormHelp']) assert.ok(html.includes(`id="${id}"`),id);
console.log('Passed: 2/3 teams, 15+ balancing, goalkeeper exclusion, 9-game schedule, day totals once, single champion/tie, reopening, legacy history, backend validation, public projection and render smoke.');

// Stats period filtering and chart agree with the existing rankings, without
// duplicating the aggregate contribution across nine games.
context.chartFixture = sample;
run('state=structuredClone(chartFixture);');
assert.equal(run('statsMatchesForPeriod("month","2026","2026-10").length'),9);
assert.equal(run('statsMatchesForPeriod("month","2026","2026-09").length'),1);
assert.equal(run('statsMatchesForPeriod("year","2025","2026-10").length'),0);
assert.equal(run('statsMatchesForPeriod("all","2025","2026-10").length'),10);
assert.equal(run('playerStatsTimeline(scorer,statsMatchesForPeriod("month","2026","2026-10")).length'),1);
assert.equal(run('playerStatsTimeline(scorer,statsMatchesForPeriod("month","2026","2026-10"))[0].goals'),4);
assert.equal(run('playerStatsTimeline(scorer,statsMatchesForPeriod("month","2026","2026-10"))[0].assists'),2);
assert.equal(run('playerStatsTimeline(scorer,statsMatchesForPeriod("month","2026","2026-10"))[0].games'),1);
assert.equal(run('playerStatsTimeline("absent",state.matches).length'),0);
run('state.rounds[0].closed=false;');
assert.equal(run('playerStatsTimeline(scorer,statsMatchesForPeriod("month","2026","2026-10")).length'),0);
run('state.rounds[0].closed=true; state.matches.push({id:"zero",date:"2026-10-09",teamA:[scorer],teamB:["p0"],scoreA:0,scoreB:0,contributions:{}});');
assert.equal(run('playerStatsTimeline(scorer,state.matches).at(-1).goals'),0);
assert.equal(run('playerStatsTimeline(scorer,state.matches).at(-1).assists'),0);
assert.equal(run('playerStatsTimeline(scorer,state.matches)[0].date'),'2026-09-01');
run('renderStatsChart(state.players.find(p=>p.id===scorer),statsMatchesForPeriod("month","2026","2026-10"));');
assert.ok(node('#playerStatsChart').innerHTML.includes('<svg'));
assert.ok(node('#playerStatsChart').innerHTML.includes('Ver números por data'));
assert.ok(node('#playerStatsChart').innerHTML.includes('tabindex="0" role="button"'));
run('renderStatsChart(state.players[0],[]);');
assert.ok(!node('#playerStatsChart').innerHTML.includes('<svg'));
run('adminMode=true;');
node('#playerStatsSelect').value=run('scorer');
node('#playerStatsPeriod').value='month'; node('#playerStatsMonth').value='2026-10';
run('renderPlayerStats();');
assert.ok(node('#playerStatsProfile').innerHTML.includes('outubro de 2026'));
assert.ok(node('#playerStatsChart').innerHTML.includes('<svg'));
node('#playerStatsPeriod').value='all';run('renderPlayerStats();');
assert.ok(node('#playerStatsProfile').innerHTML.includes('Histórico completo'));
console.log('Passed: month/year/all filters, chronological player series, closed day totals once, zero-goal dates, no-data chart, keyboard points and synchronized stats rendering.');

// Attack totals separate the player's historic role and respect period filters.
run('state=structuredClone(chartFixture); adminMode=true;');
node('#playerStatsSelect').value='p0'; node('#playerStatsPeriod').value='month'; node('#playerStatsMonth').value='2026-10';
run('renderPlayerStats();');
let grid=node('#playerStatsGrid').innerHTML;
let line=grid.split('<h4>NA LINHA</h4>')[1].split('</article>')[0];
let keeper=grid.split('<h4>COMO GOLEIRO FIXO</h4>')[1].split('</article>')[0];
assert.ok(line.includes('<dt>Gols</dt><dd>0</dd>'));
assert.ok(line.includes('<dt>Assistências</dt><dd>0</dd>'));
assert.ok(keeper.includes('<dt>Gols feitos</dt><dd>1</dd>'));
assert.ok(keeper.includes('<dt>Assistências</dt><dd>1</dd>'));
node('#playerStatsMonth').value='2026-09';run('renderPlayerStats();');
grid=node('#playerStatsGrid').innerHTML;
line=grid.split('<h4>NA LINHA</h4>')[1].split('</article>')[0];
keeper=grid.split('<h4>COMO GOLEIRO FIXO</h4>')[1].split('</article>')[0];
assert.ok(line.includes('<dt>Gols</dt><dd>1</dd>'));
assert.ok(keeper.includes('<dt>Gols feitos</dt><dd>0</dd>'));
console.log('Passed: line/goalkeeper goal and assist totals by period, preserving existing averages.');
// Monthly membership persists independently of availability and previous months.
run('state=structuredClone(chartFixture); state.monthlyMembers={}; adminMode=true; persist=async()=>true;');
node('#monthlyMembersMonth').value='2026-10';
assert.equal(await run('setMonthlyMember("p0",true,"2026-10")'),true);
assert.equal(await run('setMonthlyMember("p1",true,"2026-10")'),true);
assert.equal(await run('setMonthlyMember("p1",true,"2026-11")'),true);
assert.equal(run('state.monthlyMembers["2026-10"].length'),2);
assert.equal(run('state.monthlyMembers["2026-11"].length'),1);
assert.equal(await run('setMonthlyMember("p0",false,"2026-10")'),true);
assert.equal(run('state.monthlyMembers["2026-10"][0]'),'p1');
assert.equal(run('state.monthlyMembers["2026-11"].length'),1);
assert.equal(await run('setMonthlyMember("missing",true,"2026-10")'),false);
run('persist=async()=>false;');
assert.equal(await run('setMonthlyMember("p0",true,"2026-10")'),false);
assert.equal(run('state.monthlyMembers["2026-10"].length'),1,'failed save rolls back only that month');
assert.equal(await run('setMonthlyMember("p0",true,"2026-12")'),false);
assert.equal(run('Object.hasOwn(state.monthlyMembers,"2026-12")'),false);
run('renderMonthlyMembers();');assert.ok(node('#monthlyMembersList').innerHTML.includes('data-monthly-member'));
const memberships=run('JSON.stringify(state.monthlyMembers)');
run('adminMode=false; renderMonthlyMembers();');
assert.ok(!node('#monthlyMembersList').innerHTML.includes('data-monthly-member'));
assert.ok(node('#monthlyMembersList').innerHTML.includes('Não mensalista'));
assert.equal(await run('setMonthlyMember("p0",true,"2026-10")'),false);
assert.equal(run('JSON.stringify(state.monthlyMembers)'),memberships);
const membershipState=run('structuredClone(state)');assert.ok(valid(membershipState));
for(const invalid of [{'2026-13':['p0']},{'2026-10':['p0','p0']},{'2026-10':'p0'},{'2026-10':[null]}])assert.equal(valid({...membershipState,monthlyMembers:invalid}),false);
backend.sample=membershipState;
assert.equal(vm.runInContext('publicState(sample).monthlyMembers["2026-10"][0]',backend),'p1');
console.log('Passed: per-month membership, admin-only edits, public status, backend validation and failed-save rollback.');

// Monthly squad marker follows match month; preselection can be manually overridden.
run('state=structuredClone(chartFixture); adminMode=true; state.monthlyMembers={"2026-10":["p0"]}; state.matchDate="2026-10-22"; state.players.forEach(p=>{p.available=false;});');
assert.equal(run('selectMatchMonthlyMembers()'),1);
assert.equal(run('state.players.find(p=>p.id==="p0").available'),true);
run('state.players.find(p=>p.id==="p0").available=false; renderSquad();');
assert.equal(run('state.players.find(p=>p.id==="p0").available'),false);
assert.ok(node('#squadList').innerHTML.includes('Mensalista no mês da partida'));
run('state.matchDate="2026-11-05"; renderSquad();');
assert.ok(!node('#squadList').innerHTML.includes('Mensalista no mês da partida'));
assert.equal(run('selectMatchMonthlyMembers()'),0);
console.log('Passed: monthly squad markers, period selection and manual absence override.');

// Home counts one ordinary game plus a nine-match day as two games.
assert.equal(run('recordedGameCount([{id:"ordinary"}, ...Array.from({length:9},(_,i)=>({id:`game-${i}`,roundId:"day1"}))])'),2);
assert.equal(run('recordedGameCount([{id:"a"},{id:"b"},{roundId:"day1"},{roundId:"day1"},{roundId:"day2"}])'),4);
assert.equal(run('recordedGameCount([])'),0);
console.log('Passed: home game count groups each three-team round once.');
// Achievements use completed days, strict conceded thresholds and saved partnerships.
fixture(3);
run(`state.players[0].name='Guardião'; state.players[1].name='Parceiro'; state.matches=Array.from({length:5},(_,i)=>({id:'badge'+i,date:'2026-10-'+String(i+1).padStart(2,'0'),teamA:['p0','p1'],teamB:['p2'],scoreA:9,scoreB:7,goalkeeperAId:'p0',contributions:{p0:{goals:1,assists:1}},mvpPlayerId:'p0'}));`);
assert.equal(run('playerAchievements("p0").find(b=>b.key==="duo-win").unlocked'),true);
assert.ok(run('playerAchievements("p0").find(b=>b.key==="duo-win").extra').includes('Parceiro'));
assert.equal(run('playerAchievements("p0").find(b=>b.key==="keeper-conceded-8").unlocked'),true);
assert.equal(run('playerAchievements("p0").find(b=>b.key==="keeper-conceded-6").unlocked'),false);
assert.equal(run('playerAchievements("p0").find(b=>b.key==="keeper-goals-5").unlocked'),true);
assert.equal(run('playerAchievements("p0").find(b=>b.key==="line-goals-1").unlocked'),false);
node('#playerStatsSelect').value='p0'; node('#playerStatsPeriod').value='all'; run('renderPlayerStats();');
assert.ok(node('#playerStatsProfile').innerHTML.includes('Guardião da meta'));
assert.ok(node('#playerStatsChart').innerHTML.includes('Gols sofridos por data'));
assert.ok(node('#playerAchievements').innerHTML.includes('Dupla de respeito'));
run('state.matches[0].scoreB=20; state.matches[0].scoreA=0;');
assert.equal(run('playerAchievements("p0").find(b=>b.key==="duo-win").unlocked'),false,'correction relocks a medal');
run('state.matches.forEach(m=>{m.scoreA=0;m.scoreB=20;});');
assert.equal(run('playerAchievements("p0").find(b=>b.key==="duo-loss").unlocked'),true);
assert.equal(run('playerAchievements("p0").find(b=>b.key==="keeper-conceded-20").unlocked'),false,'less than means strictly below');
run('state=structuredClone(chartFixture);');
const badgeRoundPlayer=run('state.rounds[0].teams.A[0]');
context.badgeRoundPlayer=badgeRoundPlayer;
assert.equal(run('playerDayEntries(badgeRoundPlayer).filter(e=>e.date===state.rounds[0].date).length'),1,'nine games count once');
run('state.rounds[0].closed=false;');
assert.equal(run('playerDayEntries(badgeRoundPlayer).filter(e=>e.date===state.rounds[0].date).length'),0,'reopened rounds excluded');
console.log('Passed: keeper focus, chart, milestones, partners, strict thresholds, correction and single-day rounds.');
