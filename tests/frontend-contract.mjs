import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Script} from 'node:vm';

// The redesign must satisfy the current app's DOM contract, including features
// absent from the original visual prototype and controls rendered dynamically.
const html=readFileSync('index.html','utf8'),app=readFileSync('app.js','utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(ids.length,new Set(ids).size,'HTML IDs must be unique');
const generatedIds=[...app.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(match=>match[1]);
const available=new Set([...ids,...generatedIds]);
for(const match of app.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g))assert.ok(available.has(match[1]),'Missing application control #'+match[1]);
for(const id of ['inicio','partida','jogadores','ranking','stats','destaques','transparencia']){
 assert.ok(ids.includes(id),'Missing screen '+id);
 assert.match(html,new RegExp('data-tab="'+id+'"'),'Missing navigation to '+id);
}
for(const id of ['teamCCard','roundPanel','saveRoundDraft','roundStandingsFooter','artworkPanel','playerStatsChart','playerAchievements','monthlyMembersList'])assert.ok(ids.includes(id),'Missing current feature #'+id);
assert.match(html,/class="tab admin-only" data-tab="jogadores"/);
const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(manifest.start_url,'/');
for(const icon of manifest.icons)assert.ok(existsSync('public'+icon.src));
for(const path of ['/assets/crest-256.webp','/assets/fonts/archivo-var-latin.woff2','/assets/og-image.jpg'])assert.ok(existsSync('public'+path));
const ui=readFileSync('ui.js','utf8'),bundle=readFileSync('public/app.js','utf8');
new Script(bundle,{filename:'public/app.js'});
assert.ok(bundle.endsWith(ui),'The verified build must include the visual layer');
assert.ok(!/fetch\s*\(|localStorage|sessionStorage/.test(ui),'Visual interactions must not persist or change application data');

// Erros transitórios ficam num diálogo legível, inclusive quando a hospedagem
// responde com HTML em vez do JSON da aplicação.
const alertNodes = new Map();
const alertNode = selector => {
 if (!alertNodes.has(selector)) alertNodes.set(selector, { textContent:'', dataset:{}, disabled:false, open:false, classList:{add(){},remove(){},toggle(){}}, querySelector(){return alertNode(selector+' span');}, showModal(){this.open=true;} });
 return alertNodes.get(selector);
};
const alertContext = { document:{querySelector:alertNode}, fetch:async()=>new Response('Gateway timeout',{status:504}), console };
new Script(app.split("$$('.tab').forEach")[0]).runInNewContext(alertContext);
new Script('adminMode=true; state=defaultState(); state.players=[{id:"p1",name:"Um",rating:3},{id:"p2",name:"Dois",rating:3}];').runInNewContext(alertContext);
await new Script('aiBalance()').runInNewContext(alertContext);
assert.equal(alertNode('#aiAlertDialog').open,true);
assert.equal(alertNode('#aiAlertDialog').dataset.code,'timeout');
assert.match(alertNode('#aiAlertMessage').textContent,/Tente novamente/);
assert.equal(alertNode('#aiBalance').disabled,false,'retry button must be restored');
for (const code of ['unavailable','blocked','bad_output','bad_request']) {
 new Script(`showAiProblem('${code}')`).runInNewContext(alertContext);
 assert.equal(alertNode('#aiAlertDialog').dataset.code,code);
 assert.ok(alertNode('#aiAlertMessage').textContent);
}
console.log('Passed: current DOM controls, seven screens, admin navigation, three-team/round/artwork/stats/membership features, icons, font and bundled visual layer.');
