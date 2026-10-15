import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { handleVercelRequest } from '../server/vercel-handler.mjs';

// IA dos times (Gemini) e leitura da planilha do caixa, com Supabase, Gemini e
// Google Planilhas simulados. Nenhuma chamada sai para a internet.
const salt = Buffer.alloc(16, 3), password = 'test-password-only';
const config = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_server-test-key', ADMIN_SESSION_KEY: 'test-session-secret', ADMIN_PASSWORD_HASH: salt.toString('hex') + ':' + pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex') };
const geminiKey = 'AIzaTESTKEY-0123456789abcdefghijkLMNOP';
let row = null, gemini = [], geminiCalls = [], sheet = null;
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const geminiText = text => reply({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

async function upstream(url, options = {}) {
  const target = new URL(url);
  if (target.hostname === 'generativelanguage.googleapis.com') {
    assert.equal(options.headers['x-goog-api-key'], geminiKey, 'the stored key is sent only to Google');
    geminiCalls.push({ model: target.pathname.split('/').pop(), body: JSON.parse(options.body) });
    const next = gemini.shift();
    if (!next) throw new Error('No Gemini answer queued');
    return next();
  }
  if (target.hostname === 'docs.google.com') {
    assert.match(target.pathname, /\/spreadsheets\/d\/[\w-]+\/export$/);
    return sheet();
  }
  const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null;
  if (target.pathname === '/rest/v1/site_state') return reply(row ? [row] : []);
  if (target.pathname === '/rest/v1/rpc/save_site_state') {
    if (body.p_expected_version !== (row?.version || 0)) return reply(0);
    row = { data: body.p_data, version: (row?.version || 0) + 1 };
    return reply(row.version);
  }
  if (target.pathname === '/rest/v1/admin_attempts') return options.method ? new Response(null, { status: 204 }) : reply([]);
  throw new Error('Unexpected upstream route ' + target.pathname);
}

const origin = 'https://bagres-test.vercel.app';
const request = (path, method = 'GET', body, headers = {}) => new Request(origin + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const run = req => handleVercelRequest(req, config, upstream);
const login = await run(request('/api/admin/login', 'POST', { password }));
assert.equal(login.status, 200);
const admin = { Cookie: login.headers.get('Set-Cookie').split(';')[0] };

// Estado inicial salvo.
const seed = await (await run(request('/api/seed', 'GET', null, admin))).json();
assert.equal(seed.teamAName, 'Equipe Roca');
assert.equal((await run(request('/api/state', 'PUT', { expectedVersion: 0, state: seed }, admin))).status, 200);

// Configuração: só admin, e a chave nunca volta inteira.
assert.equal((await run(request('/api/ai/settings'))).status, 403);
assert.equal((await run(request('/api/ai/settings', 'PUT', { prompt: 'x', key: geminiKey }))).status, 403);
assert.equal((await run(request('/api/ai/settings', 'PUT', { key: 'curta demais' }, admin))).status, 400);
assert.equal((await run(request('/api/ai/settings', 'PUT', { prompt: 'x'.repeat(8001) }, admin))).status, 400);
const saved = await run(request('/api/ai/settings', 'PUT', { prompt: 'Mota e Matheus não jogam juntos.', key: geminiKey }, admin));
assert.equal(saved.status, 200);
const savedBody = await saved.json();
assert.deepEqual({ hasKey: savedBody.hasKey, keyHint: savedBody.keyHint, version: savedBody.version }, { hasKey: true, keyHint: 'MNOP', version: 2 });
assert.ok(!JSON.stringify(savedBody).includes(geminiKey));
const settings = await (await run(request('/api/ai/settings', 'GET', null, admin))).json();
assert.equal(settings.prompt, 'Mota e Matheus não jogam juntos.');
assert.ok(!JSON.stringify(settings).includes(geminiKey));
for (const headers of [{}, admin]) {
  const text = await (await run(request('/api/state', 'GET', null, headers))).text();
  assert.ok(!text.includes(geminiKey) && !text.includes('aiSettings') && !text.includes('não jogam juntos'), 'state responses never carry the AI settings');
}

// Salvar o estado pelo navegador preserva a chave e o prompt, mesmo se alguém tentar sobrescrever.
const current = await (await run(request('/api/state', 'GET', null, admin))).json();
current.state.aiSettings = { key: 'AIzaOUTRA-chave-maliciosa-000000000000', prompt: 'troca' };
assert.equal((await run(request('/api/state', 'PUT', { expectedVersion: current.version, state: current.state }, admin))).status, 200);
assert.equal(JSON.parse(row.data).aiSettings.key, geminiKey);
assert.equal(JSON.parse(row.data).aiSettings.prompt, 'Mota e Matheus não jogam juntos.');

// Montar times.
const players = Array.from({ length: 8 }, (_, index) => ({ id: 'p' + (index + 1), name: 'Jogador ' + (index + 1), rating: (index % 5) + 1, keeper: index < 2 }));
const balance = { teams: ['A', 'B'], names: { A: 'Equipe Roca', B: 'Equipe Quinha' }, players };
const ask = () => run(request('/api/ai/balance', 'POST', balance, admin));
assert.equal((await run(request('/api/ai/balance', 'POST', balance))).status, 403);
assert.equal((await run(request('/api/ai/balance', 'POST', { ...balance, teams: ['A'] }, admin))).status, 400);

gemini = [() => geminiText(JSON.stringify({ teams: [{ team: 'A', players: ['J1', 'J3', 'J5', 'J7'] }, { team: 'B', players: ['J2', 'J4', 'J6', 'J8'] }], explanation: 'Níveis somados iguais.' }))];
let result = await ask();
assert.equal(result.status, 200);
let body = await result.json();
assert.deepEqual(body.teams, { A: ['p1', 'p3', 'p5', 'p7'], B: ['p2', 'p4', 'p6', 'p8'] });
assert.equal(body.explanation, 'Níveis somados iguais.');
const sent = geminiCalls.at(-1).body;
assert.equal(sent.generationConfig.responseMimeType, 'application/json');
assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
assert.equal(sent.generationConfig.temperature, undefined, 'use supported default sampling parameters');
assert.match(sent.contents[0].parts[0].text, /Mota e Matheus não jogam juntos\./);
assert.match(sent.contents[0].parts[0].text, /J8 \| Jogador 8 \| nível 3 \| linha/);
assert.match(sent.systemInstruction.parts[0].text, /No máximo um goleiro fixo por time/);

// Resposta fora das regras: pede de novo uma vez, explicando o problema.
gemini = [
  () => geminiText(JSON.stringify({ teams: [{ team: 'A', players: ['J1', 'J2', 'J3', 'J4', 'J5'] }, { team: 'B', players: ['J6', 'J7', 'J8'] }], explanation: '' })),
  () => geminiText('```json\n' + JSON.stringify({ teams: [{ team: 'A', players: ['J1', 'J4', 'J5', 'J8'] }, { team: 'B', players: ['2', 'J3', 'J6', 'J7'] }], explanation: 'ok' }) + '\n```')
];
geminiCalls = [];
result = await ask();
assert.equal(result.status, 200);
assert.match(geminiCalls[1].body.contents[0].parts[0].text, /recusada porque .*goleiro fixo|recusada porque os times ficaram com 5, 3/);
gemini = [() => geminiText('{"teams":[{"team":"A","players":["J1"]}],"explanation":""}'), () => geminiText('nada')];
result = await ask();
assert.equal(result.status, 502);
assert.equal((await result.json()).code, 'bad_output');

// Limite atingido, chave recusada e modelo desativado.
gemini = [() => reply({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }, 429)];
result = await ask();
assert.equal(result.status, 429);
assert.equal((await result.json()).code, 'quota');
gemini = [() => reply({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 400)];
result = await ask();
assert.equal(result.status, 422);
assert.equal((await result.json()).code, 'invalid_key');
geminiCalls = [];
gemini = [() => reply({ error: { code: 404, status: 'NOT_FOUND' } }, 404), () => geminiText(JSON.stringify({ teams: [{ team: 'A', players: ['J1', 'J3', 'J5', 'J7'] }, { team: 'B', players: ['J2', 'J4', 'J6', 'J8'] }], explanation: 'ok' }))];
result = await ask();
assert.equal(result.status, 200);
assert.notEqual(geminiCalls[0].model, geminiCalls[1].model, 'a retired model falls back to the next one');

// Sem chave salva.
// Falhas transitórias devem usar o próximo modelo, sem pedir outra chave.
const goodTeams = () => geminiText(JSON.stringify({ teams: [{ team: 'A', players: ['J1', 'J3', 'J5', 'J7'] }, { team: 'B', players: ['J2', 'J4', 'J6', 'J8'] }], explanation: 'ok' }));
geminiCalls = [];
gemini = [() => reply({ error: { status: 'UNAVAILABLE' } }, 503), goodTeams];
result = await ask();
assert.equal(result.status, 200, 'temporary overload must fall back to another model');
assert.equal(geminiCalls.length, 2);
assert.notEqual(geminiCalls[0].model, geminiCalls[1].model);

for (const firstFailure of [
  () => { throw new DOMException('Timed out', 'TimeoutError'); },
  () => { throw new TypeError('Network unavailable'); },
  () => ({ status: 200, ok: true, json: async () => { throw new DOMException('Body timed out', 'AbortError'); } }),
  () => reply({ error: { status: 'DEADLINE_EXCEEDED' } }, 504)
]) {
  geminiCalls = [];
  gemini = [firstFailure, goodTeams];
  result = await ask();
  assert.equal(result.status, 200, 'network and body timeouts must fall back');
  assert.equal(geminiCalls.length, 2);
}

// O limite individual deixa tempo para os modelos alternativos.
const originalTimeout = AbortSignal.timeout;
const timeouts = [];
AbortSignal.timeout = milliseconds => { timeouts.push(milliseconds); return originalTimeout(milliseconds); };
try {
  gemini = [() => { throw new DOMException('Timed out', 'TimeoutError'); }, goodTeams];
  assert.equal((await ask()).status, 200);
} finally { AbortSignal.timeout = originalTimeout; }
assert.equal(timeouts.filter(value => value === 15000).length, 3, 'one Supabase read and two bounded Gemini attempts');

// Não mascarar indisponibilidade ou timeout como modelo desativado.
gemini = [() => { throw new DOMException('Timed out', 'TimeoutError'); }, () => reply({}, 404), () => reply({}, 404)];
result = await ask();
assert.equal(result.status, 504);
assert.equal((await result.json()).code, 'timeout');
gemini = Array.from({ length: 3 }, () => () => reply({}, 503));
result = await ask();
assert.equal(result.status, 503);
assert.equal((await result.json()).code, 'unavailable');
gemini = Array.from({ length: 3 }, () => () => reply({}, 404));
assert.equal((await (await ask()).json()).code, 'model');

// Chave inválida e cota esgotada não geram uma sequência de novas chamadas.
for (const [status, code] of [[403, 'invalid_key'], [429, 'quota']]) {
  geminiCalls = [];
  gemini = [() => reply({}, status)];
  assert.equal((await (await ask()).json()).code, code);
  assert.equal(geminiCalls.length, 1);
}

// Esquema recusado: repetir só o modelo atual, sem recomeçar pelo desativado.
geminiCalls = [];
gemini = [() => reply({}, 404), () => reply({}, 400), goodTeams];
assert.equal((await ask()).status, 200);
assert.equal(geminiCalls.length, 3);
assert.equal(geminiCalls[1].model, geminiCalls[2].model);
assert.ok(geminiCalls[1].body.generationConfig.responseSchema);
assert.equal(geminiCalls[2].body.generationConfig.responseSchema, undefined);

// Recusas de segurança no candidato também são identificadas corretamente.
gemini = [() => reply({ candidates: [{ finishReason: 'SAFETY' }] })];
assert.equal((await (await ask()).json()).code, 'blocked');

// Prompt no limite continua sendo aceito e enviado integralmente ao Gemini.
const longPrompt = 'Perfil dos jogadores e equilíbrio. '.repeat(250).slice(0, 8000);
assert.equal(longPrompt.length, 8000);
assert.equal((await run(request('/api/ai/settings', 'PUT', { prompt: longPrompt }, admin))).status, 200);
gemini = [goodTeams];
assert.equal((await ask()).status, 200);
assert.ok(geminiCalls.at(-1).body.contents[0].parts[0].text.includes(longPrompt));

// Relógio simulado: três timeouts reais de 15s cabem no orçamento de 50s.
let elapsed = 0, deadlineCalls = 0;
const helperSource = readFileSync('server/worker.template.mjs', 'utf8');
const helperContext = { console:{warn(){}}, Date:{now:()=>elapsed}, Math, DOMException,
  AbortSignal:{timeout:ms=>({milliseconds:ms})},
  setTimeout(resolve, ms){ elapsed += ms; resolve(); },
  env:{EXTERNAL_FETCH:async(url, options)=>{
    deadlineCalls++;
    elapsed += options.signal.milliseconds;
    throw new DOMException('Timed out', 'TimeoutError');
  }}
};
new Script(helperSource.slice(helperSource.indexOf('const AI_MODELS'), helperSource.indexOf('const AI_FAILURES'))).runInNewContext(helperContext);
const timedAnswer = await new Script('askGemini(env,"test-key","rules","prompt",null,50000)').runInNewContext(helperContext);
assert.equal(timedAnswer.failure, 'timeout');
assert.equal(deadlineCalls, 3);
assert.ok(elapsed < 50000, 'fallback attempts must not exceed the global deadline');
elapsed = 48000;
deadlineCalls = 0;
await new Script('askGemini(env,"test-key","rules","prompt",null,50000)').runInNewContext(helperContext);
assert.equal(deadlineCalls, 0, 'do not start a request when the deadline is nearly exhausted');

assert.equal((await run(request('/api/ai/settings', 'PUT', { removeKey: true }, admin))).status, 200);
result = await ask();
assert.equal(result.status, 409);
assert.equal((await result.json()).code, 'no_key');

// Planilha do caixa.
const csv = ',,,CAIXA >> ,"-R$45,00"\nDATA ,DESCRIÇÃO,CATEGORIA,TIPO,VALOR (R$)\n05/10/2026,Mota,Mensalidade,PIX,"R$60,00"\n08/10/2026,"Quadra, 30min",Quadra,Débito,"-R$75,00"\n09/10/2026,Henrique,Avulso,PIX,"R$ 1.018,50"\n,,,,\n';
sheet = () => new Response(csv, { headers: { 'Content-Type': 'text/csv' } });
const ledgerResponse = await run(request('/api/transparency'));
assert.equal(ledgerResponse.status, 200);
assert.match(ledgerResponse.headers.get('Cache-Control'), /s-maxage/);
const ledger = await ledgerResponse.json();
assert.equal(ledger.balance, -45);
assert.deepEqual(ledger.entries.map(entry => [entry.date, entry.description, entry.category, entry.value]), [['2026-10-05', 'Mota', 'Mensalidade', 60], ['2026-10-08', 'Quadra, 30min', 'Quadra', -75], ['2026-10-09', 'Henrique', 'Avulso', 1018.5]]);
sheet = () => new Response('a,b\n1,2', { headers: { 'Content-Type': 'text/csv' } });
assert.equal((await run(request('/api/transparency'))).status, 502);
sheet = () => new Response('erro', { status: 500 });
assert.equal((await run(request('/api/transparency'))).status, 503);

console.log('Passed: AI key and prompt stay server-side, state saves preserve them, Gemini teams validated with one retry, quota/invalid key/no key/retired model handling, and cash sheet parsing.');
