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
console.log('Passed: current DOM controls, seven screens, admin navigation, three-team/round/artwork/stats/membership features, icons, font and bundled visual layer.');
