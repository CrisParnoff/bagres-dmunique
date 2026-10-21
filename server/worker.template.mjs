const HTML = __HTML_CONTENT__;
const CSS = __CSS_CONTENT__;
const APP = __APP_CONTENT__;

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

const sameOrigin = (request, url) => request.headers.get("Origin") === url.origin;
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");

async function sessionKey(env) {
  if (!env.ADMIN_SESSION_KEY) throw new Error("Admin session key missing");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SESSION_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signedSession(request, env) {
  const cookie = request.headers.get("Cookie")?.split("; ").find(item => item.startsWith("fut_admin="))?.slice(10);
  if (!cookie) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !/^[0-9a-f]{64}$/.test(signature || "")) return false;
  try {
    const [expires, nonce] = atob(payload.replace(/-/g, "+").replace(/_/g, "/")).split(":");
    if (!nonce || Number(expires) <= Date.now()) return false;
    const bytes = Uint8Array.from(signature.match(/../g), part => parseInt(part, 16));
    return crypto.subtle.verify("HMAC", await sessionKey(env), bytes, new TextEncoder().encode(payload));
  } catch (_) { return false; }
}

const isAdmin = signedSession;

async function attemptKey(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.ADMIN_SESSION_KEY}:${ip}`)));
}

async function verifyPassword(password, env) {
  if (!env.ADMIN_PASSWORD_HASH || typeof password !== "string" || password.length > 128) return false;
  const [salt, expected] = env.ADMIN_PASSWORD_HASH.split(":");
  if (!/^[0-9a-f]{32}$/.test(salt || "") || !/^[0-9a-f]{64}$/.test(expected || "")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const actual = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g), part => parseInt(part, 16)), iterations: 100000, hash: "SHA-256" }, key, 256);
  const expectedBytes = Uint8Array.from(expected.match(/../g), part => parseInt(part, 16));
  const actualBytes = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= actualBytes[i] ^ expectedBytes[i];
  return difference === 0;
}

async function login(request, env, url) {
  if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
  if (!env.DB) return json({ error: "Armazenamento indisponível" }, 503);
  const key = await attemptKey(request, env);
  const now = Date.now();
  const attempt = await env.DB.prepare("SELECT failures, locked_until FROM admin_attempts WHERE client_key = ?").bind(key).first();
  if (attempt?.locked_until > now) return json({ error: "Tente novamente mais tarde" }, 429);
  const body = await request.json();
  if (!await verifyPassword(body.password, env)) {
    const failures = (attempt?.failures || 0) + 1;
    const lock = failures >= 5 ? now + 15 * 60 * 1000 : 0;
    await env.DB.prepare("INSERT INTO admin_attempts (client_key, failures, locked_until) VALUES (?, ?, ?) ON CONFLICT(client_key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until").bind(key, lock ? 0 : failures, lock).run();
    return json({ error: "Senha incorreta" }, 401);
  }
  await env.DB.prepare("DELETE FROM admin_attempts WHERE client_key = ?").bind(key).run();
  const payload = btoa(`${now + 12 * 60 * 60 * 1000}:${crypto.randomUUID()}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signature = hex(await crypto.subtle.sign("HMAC", await sessionKey(env), new TextEncoder().encode(payload)));
  const response = json({ admin: true });
  response.headers.set("Set-Cookie", `fut_admin=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
  return response;
}

function validState(state) {
  const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  const number = value => Number.isInteger(value) && value >= 0 && value <= 99999;
  const stats = value => value && typeof value === "object" && ["games", "wins", "draws", "losses", "points", "goals", "assists", "gf", "ga"].every(key => number(value[key] ?? 0));
  if (!state || !Array.isArray(state.players) || state.players.length > 200 || !Array.isArray(state.matches) || state.matches.length > 1000) return false;
  if (typeof state.teamAName !== "string" || state.teamAName.length > 30 || typeof state.teamBName !== "string" || state.teamBName.length > 30 || !/^\d{4}-\d{2}-\d{2}$/.test(state.matchDate)) return false;
  const ids = new Set();
  for (const player of state.players) {
    if (!id(player.id) || ids.has(player.id) || typeof player.name !== "string" || !player.name.trim() || player.name.length > 60 || !Number.isInteger(player.rating) || player.rating < 1 || player.rating > 5 || ![null, "A", "B", "C", undefined].includes(player.team) || !stats(player.stats) || (player.manualStats != null && !stats(player.manualStats))) return false;
    if (player.photoKey != null && player.photoKey !== `players/${player.id}/${player.photoKey.split("/").at(-1)}`) return false;
    if (player.photoKey != null && !/^players\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]{36}$/.test(player.photoKey)) return false;
    if (player.fixedGoalkeeper != null && typeof player.fixedGoalkeeper !== "boolean") return false;
    if (player.goalkeeperRating != null && (!Number.isInteger(player.goalkeeperRating) || player.goalkeeperRating < 1 || player.goalkeeperRating > 5)) return false;
    ids.add(player.id);
  }
  const keepers = state.players.filter(player => player.available !== false && player.fixedGoalkeeper);
  if (keepers.length > (state.players.filter(player => player.available !== false).length >= 15 ? 3 : 2) || ["A", "B", "C"].some(team => keepers.filter(player => player.team === team).length > 1)) return false;
  for (const match of state.matches) {
    if (!id(match.id) || !/^\d{4}-\d{2}-\d{2}$/.test(match.date) || !number(match.scoreA) || !number(match.scoreB) || !Array.isArray(match.teamA) || !Array.isArray(match.teamB) || !match.teamA.every(id) || !match.teamB.every(id) || typeof match.teamAName !== "string" || typeof match.teamBName !== "string") return false;
    if (match.contributions && (typeof match.contributions !== "object" || !Object.values(match.contributions).every(value => number(value.goals) && number(value.assists)))) return false;
    if (match.goalkeeperAId != null && (!id(match.goalkeeperAId) || !match.teamA.includes(match.goalkeeperAId))) return false;
    if (match.goalkeeperBId != null && (!id(match.goalkeeperBId) || !match.teamB.includes(match.goalkeeperBId))) return false;
    if (match.goalkeeperAId != null && match.goalkeeperAId === match.goalkeeperBId) return false;
    for (const awardId of [match.mvpPlayerId, match.bolaMurchaPlayerId]) {
      // MVP e Bagre podem ser de quem ficou fora da escalação.
      if (awardId != null && !id(awardId)) return false;
    }
  }
  if (state.teamCName != null && (typeof state.teamCName !== "string" || state.teamCName.length > 30)) return false;
  if (state.rounds != null && (!Array.isArray(state.rounds) || state.rounds.length > 1000)) return false;
  const roundIds = new Set(), roundDates = new Set();
  const schedule = ["A-C", "A-B", "C-B", "C-A", "B-A", "B-C", "A-C", "A-B", "C-B"];
  for (const round of state.rounds || []) {
    if (!id(round.id) || roundIds.has(round.id) || !/^\d{4}-\d{2}-\d{2}$/.test(round.date) || roundDates.has(round.date) || typeof round.closed !== "boolean") return false;
    roundIds.add(round.id); roundDates.add(round.date);
    if (!round.teams || !round.names || !round.keepers || !round.contributions) return false;
    const participants = [];
    for (const key of ["A","B","C"]) {
      if (!Array.isArray(round.teams[key]) || !round.teams[key].length || !round.teams[key].every(id) || typeof round.names[key] !== "string" || round.names[key].length > 30 || (round.keepers[key] != null && !round.teams[key].includes(round.keepers[key]))) return false;
      participants.push(...round.teams[key]);
    }
    if (participants.length < 15 || participants.length > 200 || new Set(participants).size !== participants.length || Math.max(...Object.values(round.teams).map(team => team.length)) - Math.min(...Object.values(round.teams).map(team => team.length)) > 1) return false;
    if (typeof round.contributions !== "object" || !Object.entries(round.contributions).every(([playerId,c]) => participants.includes(playerId) && c && number(c.goals) && c.goals <= 99 && number(c.assists) && c.assists <= 99)) return false;
    if ([round.mvpPlayerId,round.bolaMurchaPlayerId].some(award => award != null && !id(award))) return false;
    const games = state.matches.filter(match => match.roundId === round.id);
    const indexes = new Set(); const points = { A:0, B:0, C:0 }, goals = { A:0, B:0, C:0 };
    for (const match of games) {
      if (!Number.isInteger(match.scheduleIndex) || match.scheduleIndex < 0 || match.scheduleIndex >= 9 || indexes.has(match.scheduleIndex)) return false;
      indexes.add(match.scheduleIndex);
      const [a,b] = schedule[match.scheduleIndex].split('-');
      if (match.date !== round.date || match.teamAKey !== a || match.teamBKey !== b || JSON.stringify(match.teamA) !== JSON.stringify(round.teams[a]) || JSON.stringify(match.teamB) !== JSON.stringify(round.teams[b]) || match.teamAName !== round.names[a] || match.teamBName !== round.names[b] || match.goalkeeperAId !== round.keepers[a] || match.goalkeeperBId !== round.keepers[b] || Object.keys(match.contributions || {}).length || match.mvpPlayerId != null || match.bolaMurchaPlayerId != null) return false;
      goals[a] += match.scoreA; goals[b] += match.scoreB;
      if (match.scoreA > match.scoreB) points[a] += 3;
      else if (match.scoreA < match.scoreB) points[b] += 3;
      else { points[a]++; points[b]++; }
    }
    if (round.closed) {
      if (games.length !== 9 || !["A","B","C"].includes(round.championTeam) || points[round.championTeam] !== Math.max(...Object.values(points)) || !id(round.mvpPlayerId) || !id(round.bolaMurchaPlayerId) || participants.some(playerId => !round.contributions[playerId])) return false;
      for (const key of ["A","B","C"]) for (const field of ["goals","assists"]) if (round.teams[key].reduce((sum,playerId) => sum + round.contributions[playerId][field],0) > goals[key]) return false;
    } else if (round.championTeam != null) return false;
  }
  if (state.matches.some(match => match.roundId != null && !roundIds.has(match.roundId))) return false;
  if (state.monthlyMembers != null) {
    if (typeof state.monthlyMembers !== "object" || Array.isArray(state.monthlyMembers) || Object.keys(state.monthlyMembers).length > 240) return false;
    for (const [month,members] of Object.entries(state.monthlyMembers)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(members) || members.length > 200 || !members.every(id) || new Set(members).size !== members.length) return false;
    }
  }
  return true;
}

async function getState(env) {
  const row = await env.DB.prepare("SELECT data, version FROM site_state WHERE id = 1").first();
  return row ? { state: JSON.parse(row.data), version: row.version } : { state: initialState(), version: 0 };
}

function initialState() {
  const names = [
    ["Mota", 5], ["Matheus", 5], ["Bernardo", 4], ["Antonio", 4],
    ["Arthur", 4], ["Gi", 3], ["Benhur", 3], ["Cris", 3],
    ["Teteu", 3], ["Scherer", 2], ["Samuel", 2], ["João", 1], ["Eduardo", 1]
  ];
  const stats = () => ({ games: 0, wins: 0, draws: 0, losses: 0, points: 0, goals: 0, assists: 0, gf: 0, ga: 0 });
  return {
    players: names.map(([name, rating], index) => ({ id: "p" + (index + 1), name, rating, available: true, team: null, stats: stats() })),
    matches: [], rounds: [], monthlyMembers: {}, teamAName: "Equipe Roca", teamBName: "Equipe Quinha", teamCName: "Equipe Cão",
    matchDate: new Date().toISOString().slice(0, 10)
  };
}

function publicState(state) {
  return {
    ...state,
    rounds: (state.rounds || []).map(({id,date,closed,championTeam,teams,names,keepers,contributions,mvpPlayerId,bolaMurchaPlayerId}) => ({id,date,closed,championTeam,teams: Object.fromEntries(["A","B","C"].map(key => [key,teams[key]])), names: Object.fromEntries(["A","B","C"].map(key => [key,names[key]])), keepers: Object.fromEntries(["A","B","C"].map(key => [key,keepers[key]])), contributions,mvpPlayerId,bolaMurchaPlayerId})),
    players: state.players.map(({ id, name, available, team, stats, photoKey, fixedGoalkeeper }) => ({ id, name, available, team, stats, photoKey, fixedGoalkeeper })),
    matches: state.matches.map(({ roundId, scheduleIndex, teamAKey, teamBKey, id, date, teamAName, teamBName, scoreA, scoreB, teamA, teamB, contributions, mvpPlayerId, bolaMurchaPlayerId, goalkeeperAId, goalkeeperBId }) =>
      ({ roundId, scheduleIndex, teamAKey, teamBKey, id, date, teamAName, teamBName, scoreA, scoreB, teamA, teamB, contributions, mvpPlayerId, bolaMurchaPlayerId, goalkeeperAId, goalkeeperBId }))
  };
}


// ---------- Configuração privada (IA dos times) ----------
// A chave do Gemini e o prompt da diretoria ficam em aiSettings dentro do
// estado salvo, mas nunca saem do servidor: GET /api/state remove o campo e
// PUT /api/state mantém o que já estava salvo, ignorando o que o navegador mandar.
const AI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];
const AI_PROMPT_LIMIT = 8000;
const AI_TIME_BUDGET = 50000;
const KIT_COLORS = { A: "vermelho", B: "branco", C: "preto" };
const externalFetch = env => env.EXTERNAL_FETCH || fetch;

function withoutPrivate(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const { aiSettings, ...rest } = state;
  return rest;
}

const aiSettingsView = settings => ({
  prompt: typeof settings?.prompt === "string" ? settings.prompt : "",
  hasKey: Boolean(settings?.key),
  keyHint: settings?.key ? settings.key.slice(-4) : "",
  updatedAt: settings?.updatedAt || null
});

async function saveAiSettings(env, update) {
  const current = await getState(env);
  const previous = current.state?.aiSettings || {};
  const aiSettings = { prompt: update.prompt ?? previous.prompt ?? "", key: update.key ?? previous.key ?? "", updatedAt: new Date().toISOString() };
  const data = JSON.stringify({ ...withoutPrivate(current.state), aiSettings });
  if (current.version === 0) {
    const result = await env.DB.prepare("INSERT OR IGNORE INTO site_state (id, data, version) VALUES (1, ?, 1)").bind(data).run();
    return result.meta.changes ? { version: 1, settings: aiSettings } : null;
  }
  const result = await env.DB.prepare("UPDATE site_state SET data = ?, version = version + 1 WHERE id = 1 AND version = ?").bind(data, current.version).run();
  return result.meta.changes ? { version: current.version + 1, settings: aiSettings } : null;
}

function validBalanceRequest(body) {
  const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  if (!body || !Array.isArray(body.teams) || ![2, 3].includes(body.teams.length) || !body.teams.every((key, index) => key === "ABC"[index])) return false;
  if (!body.names || typeof body.names !== "object" || !body.teams.every(key => typeof body.names[key] === "string" && body.names[key].trim() && body.names[key].length <= 30)) return false;
  if (!Array.isArray(body.players) || body.players.length < body.teams.length || body.players.length > 60) return false;
  const ids = new Set();
  for (const player of body.players) {
    if (!player || !id(player.id) || ids.has(player.id) || typeof player.name !== "string" || !player.name.trim() || player.name.length > 60) return false;
    if (!Number.isInteger(player.rating) || player.rating < 1 || player.rating > 5 || typeof player.keeper !== "boolean") return false;
    ids.add(player.id);
  }
  return body.players.filter(player => player.keeper).length <= body.teams.length;
}

const BALANCE_RULES = `Você monta os times da pelada semanal do FC Bagres D'Munique.
Regras obrigatórias, que valem acima de qualquer orientação:
1. Use todos os jogadores da lista, cada um em exatamente um time, identificados pelo código (J1, J2...).
2. Os times têm a mesma quantidade de jogadores ou diferença de no máximo um.
3. No máximo um goleiro fixo por time; havendo goleiros fixos, espalhe um por time.
4. O nível vai de 1 (mais fraco) a 5 (mais forte). A força dos times deve ficar o mais parecida possível. Havendo um goleiro por time, some também o nível no gol de cada goleiro. Havendo somente um goleiro, ele tem peso 5; havendo dois goleiros para três times, eles têm peso zero. Para jogadores de linha, use o nível na linha.
Siga as orientações da diretoria (características dos jogadores, quem joga bem junto, quem não deve ficar no mesmo time) sempre que não quebrarem as regras.
Responda somente com o JSON pedido. Em "explanation", explique em português, em até três frases curtas, o critério usado.`;

function balancePrompt(body, guidance, feedback) {
  return [
    "Orientações da diretoria:",
    guidance?.trim() || "(nenhuma orientação extra)",
    "",
    `Times (${body.teams.length}):`,
    ...body.teams.map(key => `${key} = ${body.names[key]} (camisa ${KIT_COLORS[key]})`),
    "",
    `Jogadores confirmados (${body.players.length}):`,
    ...body.players.map((player, index) => `J${index + 1} | ${player.name} | nível ${player.rating} | ${player.keeper ? "goleiro fixo · nível no gol" : "linha"}`),
    ...(feedback ? ["", `Sua resposta anterior foi recusada porque ${feedback} Corrija e responda de novo.`] : [])
  ].join("\n");
}

const balanceSchema = teams => ({
  type: "OBJECT",
  properties: {
    teams: { type: "ARRAY", items: { type: "OBJECT", properties: { team: { type: "STRING", enum: teams }, players: { type: "ARRAY", items: { type: "STRING" } } }, required: ["team", "players"] } },
    explanation: { type: "STRING" }
  },
  required: ["teams", "explanation"]
});

// Confere a resposta da IA com as mesmas regras da escalação; nada é aplicado sem passar aqui.
function readBalance(text, body) {
  let parsed = null;
  try { parsed = JSON.parse(text); }
  catch (_) { try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || ""); } catch (_) { return { problem: "a resposta não era JSON." }; } }
  const codes = new Map(body.players.map((player, index) => [`J${index + 1}`, player]));
  const teams = Object.fromEntries(body.teams.map(key => [key, []]));
  const seen = new Set();
  for (const entry of Array.isArray(parsed?.teams) ? parsed.teams : []) {
    const key = String(entry?.team || "").trim().toUpperCase();
    if (!teams[key]) return { problem: `o time "${key}" não existe.` };
    for (const raw of Array.isArray(entry.players) ? entry.players : []) {
      const number = String(raw).trim().toUpperCase().match(/^J?\s*(\d+)/)?.[1];
      const player = number && codes.get(`J${Number(number)}`);
      if (!player) return { problem: `o código "${String(raw).slice(0, 20)}" não está na lista.` };
      if (seen.has(player.id)) return { problem: `${player.name} apareceu em mais de um time.` };
      seen.add(player.id);
      teams[key].push(player.id);
    }
  }
  const missing = body.players.filter(player => !seen.has(player.id));
  if (missing.length) return { problem: `faltaram jogadores: ${missing.map(player => player.name).join(", ")}.` };
  const sizes = body.teams.map(key => teams[key].length);
  if (Math.min(...sizes) === 0 || Math.max(...sizes) - Math.min(...sizes) > 1) return { problem: `os times ficaram com ${sizes.join(", ")} jogadores, e a diferença máxima é um.` };
  const keepers = new Set(body.players.filter(player => player.keeper).map(player => player.id));
  if (body.teams.some(key => teams[key].filter(playerId => keepers.has(playerId)).length > 1)) return { problem: "um time ficou com mais de um goleiro fixo." };
  return { teams, explanation: typeof parsed?.explanation === "string" ? parsed.explanation.trim().slice(0, 600) : "" };
}

function geminiFailure(status, detail) {
  if (status === 429 || status === 402 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(detail)) return "quota";
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|API key expired|PERMISSION_DENIED|leaked/i.test(detail)) return "invalid_key";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

async function askGemini(env, key, system, prompt, schema, deadline) {
  let modelMissing = false;
  for (const model of AI_MODELS) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) break;
    let response;
    try {
      response = await externalFetch(env)(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json", ...(schema ? { responseSchema: schema } : {}) }
        }),
        signal: AbortSignal.timeout(Math.min(remaining, 40000))
      });
    } catch (_) { return { failure: "unavailable" }; }
    // Modelo desativado pelo Google: tenta o próximo da lista.
    if (response.status === 404) { modelMissing = true; continue; }
    if (!response.ok) {
      const failure = geminiFailure(response.status, await response.text().catch(() => ""));
      // Se o formato pedido for recusado, tenta uma vez sem o esquema (o JSON continua sendo conferido).
      if (failure === "bad_request" && schema) return askGemini(env, key, system, prompt, null, deadline);
      return { failure };
    }
    const data = await response.json().catch(() => null);
    const text = (data?.candidates?.[0]?.content?.parts || []).filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("");
    if (!text) return { failure: data?.promptFeedback?.blockReason ? "blocked" : "bad_output" };
    return { text, model };
  }
  return { failure: modelMissing ? "model" : "unavailable" };
}

const AI_FAILURES = {
  no_key: [409, "Nenhuma chave Gemini configurada. Salve a chave na engrenagem da tela Partida."],
  quota: [429, "A chave Gemini atingiu o limite de uso."],
  invalid_key: [422, "A chave Gemini foi recusada pelo Google."],
  model: [502, "Os modelos do Gemini configurados no site não estão mais disponíveis."],
  blocked: [502, "O Gemini recusou responder com essas orientações."],
  bad_output: [502, "A IA devolveu times que não seguem as regras. Tente de novo."],
  bad_request: [502, "O Gemini não aceitou o pedido."],
  unavailable: [503, "O Gemini não respondeu agora. Tente de novo em instantes."]
};
const aiFailure = code => json({ error: AI_FAILURES[code][1], code }, AI_FAILURES[code][0]);

// ---------- Transparência: leitura da planilha pública do caixa ----------
const TRANSPARENCY_SHEET = "1f7Yl7GMFzMXkkiRVyEiRkj_i10psEHs2MN0T9XL8YlA";
const plain = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function sheetMoney(value) {
  const text = String(value ?? "").replace(/[\s ]/g, "");
  if (!/\d/.test(text)) return null;
  const number = Number(text.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(number)) return null;
  return Math.round((text.includes("-") || /^\(.*\)$/.test(text) ? -number : number) * 100) / 100;
}

function sheetDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  return `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function readLedger(csv) {
  const rows = parseCsv(csv);
  let balance = null, header = -1;
  rows.forEach((cells, index) => {
    const caixa = cells.findIndex(cell => plain(cell).startsWith("caixa"));
    if (balance === null && caixa >= 0) balance = cells.slice(caixa + 1).map(sheetMoney).find(value => value !== null) ?? null;
    if (header < 0 && cells.some(cell => plain(cell).startsWith("data")) && cells.some(cell => plain(cell).startsWith("valor"))) header = index;
  });
  if (header < 0) return null;
  const columns = rows[header].map(plain);
  const column = name => columns.findIndex(cell => cell.startsWith(name));
  const at = { date: column("data"), description: column("descri"), category: column("categ"), type: column("tipo"), value: column("valor") };
  const cell = (cells, key) => at[key] >= 0 ? String(cells[at[key]] ?? "").trim().slice(0, 120) : "";
  const entries = rows.slice(header + 1)
    .map(cells => ({ date: sheetDate(cells[at.date]), description: cell(cells, "description"), category: cell(cells, "category"), type: cell(cells, "type"), value: sheetMoney(cells[at.value]) }))
    .filter(entry => entry.date && entry.value !== null);
  const total = Math.round(entries.reduce((sum, entry) => sum + entry.value, 0) * 100) / 100;
  return { balance: balance ?? total, entries: entries.slice(-1000) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (request.method === "GET" && url.pathname === "/styles.css") return new Response(CSS, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    if (request.method === "GET" && url.pathname === "/app.js") return new Response(APP, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    const photoPath = url.pathname.match(/^\/player-photos\/players\/([a-zA-Z0-9_-]{1,64})\/([a-f0-9-]{36})$/);
    if (request.method === "GET" && photoPath) {
      if (!env.BUCKET) return new Response("Imagem indisponível", { status: 404 });
      const object = await env.BUCKET.get(`players/${photoPath[1]}/${photoPath[2]}`);
      if (!object) return new Response("Imagem não encontrada", { status: 404 });
      const contentType = object.httpMetadata?.contentType;
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) return new Response("Imagem inválida", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.method === "POST" && url.pathname === "/api/player-photo") {
      if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
      if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("multipart/form-data")) return json({ error: "Requisição inválida" }, 403);
      if (!env.BUCKET) return json({ error: "Armazenamento de fotos indisponível" }, 503);
      try {
        const form = await request.formData();
        const id = form.get("id");
        const file = form.get("photo");
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !file || typeof file.arrayBuffer !== "function") return json({ error: "Dados da foto inválidos" }, 400);
        if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size <= 0 || file.size > 2 * 1024 * 1024) return json({ error: "Use uma imagem JPG, PNG ou WebP de até 2 MB" }, 413);
        const key = `players/${id}/${crypto.randomUUID()}`;
        await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
        return json({ photoKey: key });
      } catch (error) {
        console.error("Player photo upload failed", error);
        return json({ error: "Não foi possível enviar a foto" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/player-photo/delete") {
      if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
      if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
      if (!env.BUCKET) return json({ error: "Armazenamento de fotos indisponível" }, 503);
      try {
        const body = await request.json();
        if (typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id) || body.photoKey !== `players/${body.id}/${String(body.photoKey).split("/").at(-1)}` || !/^players\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]{36}$/.test(body.photoKey)) return json({ error: "Dados da foto inválidos" }, 400);
        await env.BUCKET.delete(body.photoKey);
        return json({ removed: true });
      } catch (error) {
        console.error("Player photo removal failed", error);
        return json({ error: "Não foi possível remover a foto" }, 400);
      }
    }
    if (request.method === "GET" && url.pathname === "/api/session") return json({ admin: await isAdmin(request, env) });
    if (request.method === "GET" && url.pathname === "/api/seed") {
      if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
      return json(initialState());
    }
    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      try { return await login(request, env, url); }
      catch (error) { console.error("Admin login failed", error); return json({ error: "Login indisponível" }, 503); }
    }
    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      if (!sameOrigin(request, url)) return json({ error: "Requisição inválida" }, 403);
      const response = json({ admin: false });
      response.headers.set("Set-Cookie", "fut_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
      return response;
    }
    if (request.method === "GET" && url.pathname === "/api/transparency") {
      try {
        const response = await externalFetch(env)(`https://docs.google.com/spreadsheets/d/${TRANSPARENCY_SHEET}/export?format=csv`, { redirect: "follow", signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
        const text = await response.text();
        if (text.length > 2000000) throw new Error("Sheet too large");
        const ledger = readLedger(text);
        if (!ledger) return json({ error: "A planilha mudou de formato e não foi possível ler os lançamentos." }, 502);
        return new Response(JSON.stringify({ ...ledger, fetchedAt: new Date().toISOString() }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600", "X-Content-Type-Options": "nosniff" } });
      } catch (error) {
        console.error("Transparency sheet failed", error.message);
        return json({ error: "Não foi possível ler a planilha agora." }, 503);
      }
    }
    if (url.pathname === "/api/ai/settings") {
      if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
      if (!env.DB) return json({ error: "Armazenamento indisponível" }, 503);
      try {
        if (request.method === "GET") return json(aiSettingsView((await getState(env)).state?.aiSettings));
        if (request.method !== "PUT") return json({ error: "Método não permitido" }, 405);
        if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
        const body = await request.json();
        const update = {};
        if (body.prompt != null) {
          if (typeof body.prompt !== "string" || body.prompt.length > AI_PROMPT_LIMIT) return json({ error: `O prompt pode ter até ${AI_PROMPT_LIMIT} caracteres.` }, 400);
          update.prompt = body.prompt;
        }
        if (typeof body.key === "string" && body.key.trim()) {
          const key = body.key.trim();
          if (!/^[A-Za-z0-9._-]{20,200}$/.test(key)) return json({ error: "Isso não parece uma chave do Gemini. Copie a chave inteira, sem espaços." }, 400);
          update.key = key;
        }
        if (body.removeKey === true) update.key = "";
        const saved = await saveAiSettings(env, update);
        if (!saved) return json({ error: "Os dados mudaram em outro dispositivo. Recarregue a página." }, 409);
        return json({ version: saved.version, ...aiSettingsView(saved.settings) });
      } catch (error) {
        console.error("AI settings request failed", error.message);
        return json({ error: "Não foi possível acessar a configuração da IA." }, 503);
      }
    }
    if (url.pathname === "/api/ai/balance") {
      if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);
      if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
      if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
      if (!env.DB) return json({ error: "Armazenamento indisponível" }, 503);
      try {
        const body = await request.json();
        if (!validBalanceRequest(body)) return json({ error: "Dados da escalação inválidos." }, 400);
        const settings = (await getState(env)).state?.aiSettings;
        if (!settings?.key) return aiFailure("no_key");
        const deadline = Date.now() + AI_TIME_BUDGET;
        let feedback = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const answer = await askGemini(env, settings.key, BALANCE_RULES, balancePrompt(body, settings.prompt, feedback), balanceSchema(body.teams), deadline);
          if (answer.failure) return aiFailure(answer.failure);
          const result = readBalance(answer.text, body);
          if (!result.problem) return json({ teams: result.teams, explanation: result.explanation, model: answer.model });
          feedback = result.problem;
          if (deadline - Date.now() < 15000) break;
        }
        return aiFailure("bad_output");
      } catch (error) {
        console.error("AI balance failed", error.message);
        return aiFailure("unavailable");
      }
    }
    if (url.pathname === "/api/state") {
      if (!env.DB) return json({ error: "Armazenamento indisponível" }, 503);
      try {
        if (request.method === "GET") {
          const result = await getState(env);
          const state = withoutPrivate(result.state);
          return json({ ...result, state: await isAdmin(request, env) ? state : publicState(state) });
        }
        if (request.method !== "PUT") return json({ error: "Método não permitido" }, 405);
        if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
        if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
        if (Number(request.headers.get("Content-Length") || 0) > 1000000) return json({ error: "Dados muito grandes" }, 413);
        const body = await request.json();
        const incoming = withoutPrivate(body.state);
        if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || !validState(incoming)) return json({ error: "Dados inválidos" }, 400);
        // A configuração da IA não vem do navegador: preserva a que já está salva.
        const aiSettings = body.expectedVersion > 0 ? (await getState(env)).state?.aiSettings : null;
        const data = JSON.stringify(aiSettings ? { ...incoming, aiSettings } : incoming);
        if (data.length > 1000000) return json({ error: "Dados muito grandes" }, 413);
        if (body.expectedVersion === 0) {
          const result = await env.DB.prepare("INSERT OR IGNORE INTO site_state (id, data, version) VALUES (1, ?, 1)").bind(data).run();
          if (!result.meta.changes) return json({ error: "Dados atualizados em outro dispositivo" }, 409);
          return json({ version: 1 });
        }
        const result = await env.DB.prepare("UPDATE site_state SET data = ?, version = version + 1 WHERE id = 1 AND version = ?").bind(data, body.expectedVersion).run();
        if (!result.meta.changes) return json({ error: "Dados atualizados em outro dispositivo" }, 409);
        return json({ version: body.expectedVersion + 1 });
      } catch (error) {
        console.error("State request failed", error);
        return json({ error: "Não foi possível acessar os dados" }, 503);
      }
    }
    return new Response("Não encontrado", { status: 404 });
  }
};
