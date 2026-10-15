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
      if (awardId != null && (!id(awardId) || (!match.teamA.includes(awardId) && !match.teamB.includes(awardId)))) return false;
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
    if ([round.mvpPlayerId,round.bolaMurchaPlayerId].some(award => award != null && !participants.includes(award))) return false;
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
      if (games.length !== 9 || !["A","B","C"].includes(round.championTeam) || points[round.championTeam] !== Math.max(...Object.values(points)) || !participants.includes(round.mvpPlayerId) || !participants.includes(round.bolaMurchaPlayerId) || participants.some(playerId => !round.contributions[playerId])) return false;
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
    if (url.pathname === "/api/state") {
      if (!env.DB) return json({ error: "Armazenamento indisponível" }, 503);
      try {
        if (request.method === "GET") {
          const result = await getState(env);
          return json({ ...result, state: await isAdmin(request, env) ? result.state : publicState(result.state) });
        }
        if (request.method !== "PUT") return json({ error: "Método não permitido" }, 405);
        if (!await isAdmin(request, env)) return json({ error: "Acesso de admin necessário" }, 403);
        if (!sameOrigin(request, url) || !request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "Requisição inválida" }, 403);
        if (Number(request.headers.get("Content-Length") || 0) > 1000000) return json({ error: "Dados muito grandes" }, 413);
        const body = await request.json();
        if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || !validState(body.state)) return json({ error: "Dados inválidos" }, 400);
        const data = JSON.stringify(body.state);
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
