const STORAGE_KEY = "fut-quinta-amigos-v1";
const emptyStats = () => ({ games: 0, wins: 0, draws: 0, losses: 0, points: 0, goals: 0, assists: 0, gf: 0, ga: 0 });

const defaultState = () => ({
  players: [],
  matches: [],
  rounds: [],
  monthlyMembers: {},
  teamCName: "Time Verde",
  teamAName: "Time Azul",
  teamBName: "Time Branco",
  matchDate: new Date().toISOString().slice(0, 10)
});

let state = defaultState();
let toastTimer;
let adminMode = false;
let dataVersion = 0;
let serverEmpty = false;
let saveQueue = Promise.resolve();
let selectedSwapId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
const photoUrl = (player) => player.photoKey ? `/player-photos/${player.photoKey.split("/").map(encodeURIComponent).join("/")}` : "";
function playerAvatar(player, className = "avatar") {
  const content = player.photoKey
    ? `<img src="${photoUrl(player)}" alt="Foto de ${escapeHtml(player.name)}" loading="lazy" />`
    : escapeHtml(initials(player.name));
  return `<span class="${className}" aria-label="${escapeHtml(player.name)}">${content}</span>`;
}

function readLocalBackup() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.players && Array.isArray(stored.players) && Array.isArray(stored.matches)) {
      stored.rounds ??= []; stored.teamCName ??= "Time Verde";
      stored.players.forEach(player => { player.stats = { ...emptyStats(), ...player.stats }; });
      return stored;
    }
  } catch (_) {}
  return null;
}

function persist() {
  if (!adminMode) return;
  const snapshot = structuredClone(state);
  saveQueue = saveQueue.then(async () => {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: snapshot, expectedVersion: dataVersion })
    });
    if (!response.ok) throw new Error(response.status === 409 ? "Os dados mudaram em outro dispositivo. Recarregue a página." : "Não foi possível salvar. Recarregue e tente novamente.");
    const result = await response.json();
    dataVersion = result.version;
    serverEmpty = false;
    $("#importNote").classList.add("hidden");
    return true;
  }).catch(error => { showToast(error.message); return false; });
  return saveQueue;
}

async function loadRemote() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Dados indisponíveis. Recarregue a página.");
    const result = await response.json();
    dataVersion = result.version;
    serverEmpty = result.version === 0;
    state = result.state || defaultState();
    $("#contributions").innerHTML = "";
    $("#matchMvp").value = ""; $("#matchBolaMurcha").value = "";
    state.monthlyMembers ??= {};
    state.rounds ??= [];
    state.teamCName ??= "Time Verde";
    selectedSwapId = null;
    state.players.forEach(player => {
      player.stats = { ...emptyStats(), ...player.stats };
      player.manualStats = { ...emptyStats(), ...player.manualStats };
      player.manualStatsByYear = player.manualStatsByYear || {};
    });
    render();
    $("#importNote").classList.toggle("hidden", !adminMode || !serverEmpty || !readLocalBackup());
  } catch (error) {
    $("#accessNote").textContent = error.message;
  }
}

async function toggleAdmin() {
  if (adminMode) {
    await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    adminMode = false;
    document.body.classList.remove("admin-mode");
    if ($("#jogadores").classList.contains("active")) setTab("inicio");
    $("#adminToggle").textContent = "Entrar como admin";
    $("#accessNote").textContent = "Modo de visualização. Entre como admin para editar jogadores e resultados.";
    $("#statsForm").classList.add("hidden");
    $("#passwordForm").classList.add("hidden");
    await loadRemote();
    return;
  }
  $("#passwordForm").classList.remove("hidden");
  $("#adminPassword").focus();
}

async function enterAdmin() {
  adminMode = true;
  $("#passwordForm").classList.add("hidden");
  document.body.classList.add("admin-mode");
  $("#adminToggle").textContent = "Sair do admin";
  $("#accessNote").textContent = "Admin ativo: você pode editar jogadores, níveis e estatísticas.";
  $("#importNote").classList.toggle("hidden", !serverEmpty || !readLocalBackup());
  await loadRemote();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

async function uploadPlayerPhoto(id, file) {
  const form = new FormData();
  form.set("id", id);
  form.set("photo", file);
  const response = await fetch("/api/player-photo", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível enviar a foto");
  return result.photoKey;
}

async function deletePlayerPhoto(id, photoKey) {
  if (!photoKey) return;
  await fetch("/api/player-photo/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, photoKey })
  });
}

function setTab(tabId) {
  if (tabId === "jogadores" && !adminMode) tabId = "inicio";
  if (tabId === "inicio") renderHome();
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === tabId));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function teamPlayers(team) {
  return state.players.filter(player => player.available !== false && player.team === team);
}

function availablePlayers() {
  return state.players.filter(player => player.available !== false);
}

function balanceWeight(player) {
  if (!player.fixedGoalkeeper) return Number(player.rating || 0);
  return availablePlayers().filter(item => item.fixedGoalkeeper).length === 1 ? 5 : 0;
}

function teamTotal(team) {
  return teamPlayers(team).reduce((total, player) => total + balanceWeight(player), 0);
}

function render() {
  $("#teamAName").value = currentRound()?.names.A || state.teamAName;
  $("#teamCName").value = currentRound()?.names.C || state.teamCName || "Time Verde";
  $("#teamCName").disabled = !adminMode;
  $("#teamBName").value = currentRound()?.names.B || state.teamBName;
  $("#matchDate").value = state.matchDate;
  $("#teamAName").disabled = !adminMode;
  $("#teamBName").disabled = !adminMode;
  $("#playerCount").textContent = availablePlayers().length;
  $("#rosterCount").textContent = `${state.players.length} ${state.players.length === 1 ? "jogador" : "jogadores"}`;
  $("#emptySquad").classList.toggle("hidden", state.players.length > 0);
  renderTeams();
  renderSquad();
  renderRoster();
  renderAnnualRanking();
  renderMonthlyRanking();
  renderMonthlyHighlights();
  renderPlayerStats();
  renderMatches();
  renderHome();
  renderRound();
  renderMonthlyMembers();
}

function recordedGameCount(matches) {
  return matches.filter(match => !match.roundId).length + new Set(matches.filter(match => match.roundId).map(match => match.roundId)).size;
}
// ---------- Início ----------
const homeDate = (value, options) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", options);
const homeWeekday = value => homeDate(value, { weekday: "long" }).replace("-feira", "");
const homeDayLabel = value => {
  const sameYear = value.slice(0, 4) === currentYearValue();
  return `${homeWeekday(value)}, ${homeDate(value, sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" })}`;
};
const homeCount = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`;
const homePlayer = id => state.players.find(player => player.id === id) || { id, name: "Jogador removido" };
const homeKitKey = key => ["A", "B", "C"].includes(key) ? key.toLowerCase() : "a";

// Craque e Bagre do dia de jogo mais recente que já tem os dois escolhidos.
function homeAwardDays() {
  const days = [];
  for (const round of state.rounds || []) {
    if (!round.closed || !round.mvpPlayerId || !round.bolaMurchaPlayerId) continue;
    days.push({
      date: round.date, mvpId: round.mvpPlayerId, bagreId: round.bolaMurchaPlayerId,
      line: id => ({ goals: Number(round.contributions?.[id]?.goals) || 0, assists: Number(round.contributions?.[id]?.assists) || 0 }),
      team: id => round.names[["A", "B", "C"].find(key => round.teams[key]?.includes(id))] || ""
    });
  }
  const byDate = new Map();
  state.matches.forEach(match => {
    if (match.roundId || !match.date) return;
    if (!byDate.has(match.date)) byDate.set(match.date, []);
    byDate.get(match.date).push(match);
  });
  for (const [date, matches] of byDate) {
    // Com mais de uma partida no dia, vale quem foi escolhido mais vezes; no empate, a mais recente.
    const pick = field => {
      const counts = new Map();
      matches.forEach(match => { if (match[field]) counts.set(match[field], (counts.get(match[field]) || 0) + 1); });
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };
    const mvpId = pick("mvpPlayerId"), bagreId = pick("bolaMurchaPlayerId");
    if (!mvpId || !bagreId) continue;
    days.push({
      date, mvpId, bagreId,
      line: id => matches.reduce((sum, match) => ({ goals: sum.goals + (Number(match.contributions?.[id]?.goals) || 0), assists: sum.assists + (Number(match.contributions?.[id]?.assists) || 0) }), { goals: 0, assists: 0 }),
      team: id => { const match = matches.find(item => item.teamA.includes(id) || item.teamB.includes(id)); return match ? (match.teamA.includes(id) ? match.teamAName : match.teamBName) : ""; }
    });
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

function homeAwardFigure(kind, playerId, day) {
  const player = homePlayer(playerId);
  const { goals, assists } = day.line(playerId);
  const numbers = [goals && homeCount(goals, "gol", "gols"), assists && homeCount(assists, "assistência", "assistências")].filter(Boolean);
  const detail = numbers.length ? numbers.join(" · ") : kind === "craque" ? "Escolhido o melhor em campo" : "Passou em branco";
  const team = day.team(playerId);
  const photo = player.photoKey
    ? `<img src="${photoUrl(player)}" alt="Foto de ${escapeHtml(player.name)}" decoding="async" />`
    : `<span class="award-initials" aria-hidden="true">${escapeHtml(initials(player.name))}</span>`;
  const title = kind === "craque" ? "Craque da semana" : "Bagre da semana";
  return `<figure class="award award-${kind}">
    <div class="award-photo">${photo}${kind === "bagre" ? '<span class="award-stamp" aria-hidden="true">Bagre</span>' : ""}</div>
    <figcaption>
      <span class="award-title"><svg class="icon" aria-hidden="true"><use href="#i-${kind === "craque" ? "crown" : "catfish"}" /></svg>${title}</span>
      <strong class="award-name">${escapeHtml(player.name)}</strong>
      <span class="award-detail">${detail}</span>
      ${team ? `<span class="award-team">${escapeHtml(team)}</span>` : ""}
    </figcaption>
  </figure>`;
}

function renderHomeAwards() {
  const day = homeAwardDays()[0];
  $("#homeAwardsDate").textContent = day ? `Jogo de ${homeDayLabel(day.date)}` : "";
  $("#homeAwards").innerHTML = day
    ? homeAwardFigure("craque", day.mvpId, day) + homeAwardFigure("bagre", day.bagreId, day)
    : ["craque", "bagre"].map(kind => `<figure class="award award-${kind} is-vacant">
      <div class="award-photo"><span class="award-initials" aria-hidden="true">?</span></div>
      <figcaption>
        <span class="award-title"><svg class="icon" aria-hidden="true"><use href="#i-${kind === "craque" ? "crown" : "catfish"}" /></svg>${kind === "craque" ? "Craque" : "Bagre"} da semana</span>
        <strong class="award-name">Ainda sem dono</strong>
        <span class="award-team">Sai junto com o primeiro placar registrado.</span>
      </figcaption>
    </figure>`).join("");
}

function renderHomePodium(field, target, singular, plural, monthName, stats) {
  const sorted = state.players
    .map(player => ({ player, value: stats.get(player.id)?.[field] || 0 }))
    .filter(entry => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name, "pt-BR"));
  let rank = 0;
  const ranked = sorted.map((entry, index) => { if (!index || entry.value !== sorted[index - 1].value) rank = index + 1; return { ...entry, rank }; }).filter(entry => entry.rank <= 3);
  if (!ranked.length) {
    $(target).innerHTML = `<li class="podium-empty">${field === "goals" ? "Ninguém balançou a rede" : "Ninguém deu assistência"} em ${monthName} ainda.</li>`;
    return;
  }
  const steps = [0, 1, 2].map(slot => {
    const entry = ranked[slot];
    if (!entry) return `<li class="podium-step slot-${slot + 1} rank-${slot + 1} is-vacant" aria-hidden="true"><span class="podium-block">${slot + 1}</span></li>`;
    const { player, value } = entry;
    return `<li class="podium-step slot-${slot + 1} rank-${entry.rank}">
      ${playerAvatar(player, "podium-face")}
      <b class="podium-name">${escapeHtml(player.name)}</b>
      <span class="podium-value"><strong>${value}</strong> ${value === 1 ? singular : plural}</span>
      <span class="podium-block" aria-hidden="true">${entry.rank}</span>
      <span class="visually-hidden">${entry.rank}º lugar</span>
    </li>`;
  });
  const extra = ranked.length - 3;
  $(target).innerHTML = steps.join("") + (extra > 0 ? `<li class="podium-more">E mais ${homeCount(extra, "empatado", "empatados")} com ${homeCount(ranked[2].value, singular, plural)}.</li>` : "");
}

function renderHomeLineup() {
  $("#homeMatchDate").textContent = state.matchDate ? homeDayLabel(state.matchDate) : "";
  const defaults = { A: "Time Azul", B: "Time Branco", C: "Time Verde" };
  const teams = activeTeamKeys().map(key => ({ key, name: currentRound()?.names[key] || state[`team${key}Name`] || defaults[key], players: entryPlayers(key) }));
  if (teams.some(team => team.players.length)) {
    $("#homeTeams").innerHTML = `<div class="lineup-grid teams-${teams.length}">${teams.map(team => `<article class="sheet sheet-${homeKitKey(team.key)}">
      <header class="sheet-head"><b>${escapeHtml(team.name)}</b><span>${homeCount(team.players.length, "jogador", "jogadores")}</span></header>
      ${team.players.length
        ? `<ul class="sheet-list">${team.players.map(player => `<li>${playerAvatar(player)}<span class="sheet-player">${escapeHtml(player.name)}</span>${player.fixedGoalkeeper ? '<span class="sheet-keeper">Goleiro</span>' : ""}</li>`).join("")}</ul>`
        : '<p class="sheet-empty">Aguardando escalação</p>'}
    </article>`).join("")}</div>`;
    return;
  }
  const confirmed = availablePlayers();
  $("#homeTeams").innerHTML = confirmed.length
    ? `<p class="lineup-note">${homeCount(confirmed.length, "confirmado", "confirmados")}. Os times ainda não foram montados.</p><ul class="confirmed-list">${confirmed.map(player => `<li>${playerAvatar(player)}<span>${escapeHtml(player.name)}</span></li>`).join("")}</ul>`
    : '<p class="lineup-note">Ninguém confirmado ainda. Os times aparecem aqui quando a diretoria montar a escalação.</p>';
}

function renderHomeResults() {
  const latest = state.matches.reduce((max, match) => (match.date || "") > max ? match.date : max, "");
  $("#homeResultsDate").textContent = latest ? homeDayLabel(latest) : "";
  if (!latest) {
    $("#homeMatches").innerHTML = '<p class="results-empty">Os placares aparecem aqui quando a primeira partida for registrada.</p>';
    return;
  }
  const round = (state.rounds || []).find(item => item.date === latest);
  const matches = state.matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => match.date === latest)
    // Rodada: ordem da tabela de jogos. Dois times: mais antiga primeiro.
    .sort((a, b) => (a.match.scheduleIndex ?? -a.index) - (b.match.scheduleIndex ?? -b.index))
    .map(({ match }) => match);
  const rows = matches.map(match => {
    const a = Number(match.scoreA), b = Number(match.scoreB);
    const outcome = (mine, theirs) => mine > theirs ? "won" : mine < theirs ? "lost" : "";
    return `<li class="score-row">
      ${match.roundId ? `<span class="score-game"><span class="visually-hidden">Jogo </span>${match.scheduleIndex + 1}</span>` : ""}
      <span class="score-team home ${outcome(a, b)}"><span>${escapeHtml(match.teamAName)}</span><i class="kit kit-${homeKitKey(match.teamAKey || "A")}" aria-hidden="true"></i></span>
      <span class="score-box">${a}<span class="score-x" aria-hidden="true">×</span><span class="visually-hidden"> a </span>${b}</span>
      <span class="score-team away ${outcome(b, a)}"><i class="kit kit-${homeKitKey(match.teamBKey || "B")}" aria-hidden="true"></i><span>${escapeHtml(match.teamBName)}</span></span>
    </li>`;
  }).join("");
  let aside;
  if (round) {
    const standings = roundStandings(round);
    aside = `<div class="day-aside"><h4>${round.closed ? "Classificação do dia" : "Rodada em andamento"}</h4><ol class="day-standings">${standings.map((row, index) => {
      const champion = round.closed && round.championTeam === row.key;
      return `<li class="${champion ? "is-champion" : ""}"><span class="day-pos">${index + 1}</span><i class="kit kit-${homeKitKey(row.key)}" aria-hidden="true"></i><b>${escapeHtml(row.name)}</b>${champion ? '<span class="day-champion"><svg class="icon" aria-hidden="true"><use href="#i-trophy" /></svg>Campeão</span>' : ""}<span class="day-points"><strong>${row.points}</strong> pts</span></li>`;
    }).join("")}</ol><p class="day-foot">${homeCount(roundMatches(round).length, "jogo", "jogos")} de 10 minutos</p></div>`;
  } else {
    const totals = new Map();
    matches.forEach(match => Object.entries(match.contributions || {}).forEach(([id, line]) => {
      const sum = totals.get(id) || { goals: 0, assists: 0 };
      sum.goals += Number(line.goals) || 0; sum.assists += Number(line.assists) || 0;
      totals.set(id, sum);
    }));
    const scorers = [...totals].filter(([, line]) => line.goals || line.assists).sort((a, b) => b[1].goals - a[1].goals || b[1].assists - a[1].assists || homePlayer(a[0]).name.localeCompare(homePlayer(b[0]).name, "pt-BR"));
    aside = `<div class="day-aside"><h4>Quem decidiu</h4>${scorers.length
      ? `<ul class="day-scorers">${scorers.map(([id, line]) => { const player = homePlayer(id); return `<li>${playerAvatar(player)}<b>${escapeHtml(player.name)}</b><span>${[line.goals && homeCount(line.goals, "gol", "gols"), line.assists && homeCount(line.assists, "assist.", "assist.")].filter(Boolean).join(" · ")}</span></li>`; }).join("")}</ul>`
      : '<p class="day-foot">Sem gols ou assistências individuais registrados.</p>'}</div>`;
  }
  $("#homeMatches").innerHTML = `<div class="results-body"><ol class="scoreboard ${round ? "is-round" : matches.length === 1 ? "is-single" : ""}">${rows}</ol>${aside}</div>`;
}

function renderHome() {
  const month = currentMonthValue();
  const monthName = homeDate(`${month}-01`, { month: "long" });
  const monthlyMatches = state.matches.filter(match => match.date?.startsWith(month));
  const stats = rankingStatsForMatches(monthlyMatches);
  renderHomeAwards();
  $$("[data-home-month]").forEach(element => { element.textContent = `de ${monthName}`; });
  renderHomePodium("goals", "#homeGoals", "gol", "gols", monthName, stats);
  renderHomePodium("assists", "#homeAssists", "assistência", "assistências", monthName, stats);
  const games = recordedGameCount(monthlyMatches);
  const goals = monthlyMatches.reduce((sum, match) => sum + Number(match.scoreA) + Number(match.scoreB), 0);
  const confirmed = availablePlayers().length;
  const nextDay = state.matchDate ? homeWeekday(state.matchDate) : "";
  $("#homeSummary").innerHTML = `<span class="month-line-month">${monthName[0].toUpperCase()}${monthName.slice(1)}</span> até agora: <b>${games}</b> ${games === 1 ? "jogo" : "jogos"} e <b>${goals}</b> ${goals === 1 ? "gol" : "gols"}. ${nextDay ? `Na escalação de ${nextDay}` : "Na escalação"}, <b>${confirmed}</b> ${confirmed === 1 ? "confirmado" : "confirmados"}.`;
  renderHomeLineup();
  renderHomeResults();
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentYearValue() {
  return String(new Date().getFullYear());
}

function renderMonthlyHighlights() {
  const monthInput = $("#highlightsMonth");
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const playersById = new Map(state.players.map(player => [player.id, player]));
  const totals = rankingStatsForMatches(state.matches.filter(match => match.date?.startsWith(month)));

  const renderList = (field, listSelector, emptySelector) => {
    const ranked = [...totals.entries()]
      .filter(([, stats]) => stats[field] > 0)
      .map(([id, stats]) => ({ player: playersById.get(id), value: stats[field] }))
      .filter(entry => entry.player)
      .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name, "pt-BR"));
    const topThree = [];
    let position = 0;
    let previousValue = null;
    ranked.forEach((entry, index) => {
      if (entry.value !== previousValue) position = index + 1;
      if (position <= 3) topThree.push({ ...entry, position });
      previousValue = entry.value;
    });
    $(listSelector).innerHTML = topThree.map(entry => `
      <li class="monthly-row">
        <span class="monthly-position">${entry.position}º</span>
        <span class="monthly-player">${playerAvatar(entry.player)}<span>${escapeHtml(entry.player.name)}</span></span>
        <strong>${entry.value}</strong>
      </li>`).join("");
    $(emptySelector).classList.toggle("hidden", topThree.length > 0);
  };

  renderList("goals", "#monthlyGoals", "#monthlyGoalsEmpty");
  renderList("assists", "#monthlyAssists", "#monthlyAssistsEmpty");
  renderList("wins", "#monthlyWins", "#monthlyWinsEmpty");
  renderList("mvps", "#monthlyMvps", "#monthlyMvpsEmpty");
  renderList("bolaMurchas", "#monthlyBolaMurchas", "#monthlyBolaMurchasEmpty");
  const keeperTotals = rankingStatsForMatches(state.matches.filter(match => match.date.startsWith(month)));
  const keepers = state.players.filter(player => keeperTotals.get(player.id)?.goalkeeperGames > 0)
    .sort((a, b) => goalkeeperOrder(keeperTotals.get(a.id), keeperTotals.get(b.id)) || a.name.localeCompare(b.name, "pt-BR"));
  let keeperPosition = 0;
  const highlighted = keepers.map((player, index) => {
    if (!index || goalkeeperOrder(keeperTotals.get(player.id), keeperTotals.get(keepers[index - 1].id)) !== 0) keeperPosition = index + 1;
    return { player, position: keeperPosition, stats: keeperTotals.get(player.id) };
  }).filter(entry => entry.position <= 3);
  $("#monthlyGoalkeepers").innerHTML = highlighted.map(({player, position, stats}) => `<li class="monthly-row"><span class="monthly-position">${position}º</span><span class="monthly-player">${playerAvatar(player)}<span>${escapeHtml(player.name)}<small>${stats.goalkeeperGames} ${stats.goalkeeperGames === 1 ? "jogo" : "jogos"} · ${stats.goalkeeperConceded} GS</small></span></span><strong>${goalkeeperAverage(stats)}</strong></li>`).join("");
  $("#monthlyGoalkeepersEmpty").classList.toggle("hidden", highlighted.length > 0);
}

function statsMatchesForPeriod(period, year, month) {
  return state.matches.filter(match => period === "all" || (typeof match.date === "string" && match.date.startsWith(period === "month" ? month : `${year}-`)));
}
function playerStatsTimeline(playerId, matches) {
  const days = new Map();
  for (const match of matches) {
    if (![...(match.teamA || []), ...(match.teamB || [])].includes(playerId)) continue;
    if (match.roundId && !(state.rounds || []).some(round => round.id === match.roundId && round.closed)) continue;
    if (!days.has(match.date)) days.set(match.date, []);
    days.get(match.date).push(match);
  }
  return [...days.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([date, dayMatches]) => {
    const stats = rankingStatsForMatches(dayMatches).get(playerId) || emptyStats();
    return {date, goals:stats.goals, assists:stats.assists, games:stats.games};
  });
}
function renderStatsChart(player, matches) {
  const target = $("#playerStatsChart");
  const rows = playerStatsTimeline(player.id, matches);
  if (!rows.length) {
    target.innerHTML = '<p class="empty-state">O gráfico aparecerá quando houver uma partida ou rodada encerrada deste jogador no período.</p>';
    return;
  }
  const width = Math.max(640, rows.length * 66 + 100), height = 280;
  const left = 42, right = width - 30, top = 22, bottom = 225;
  const maximum = Math.max(1,...rows.flatMap(row => [row.goals,row.assists]));
  const step = Math.max(1,Math.ceil(maximum / 4)), scale = Math.ceil(maximum / step) * step;
  const x = index => rows.length === 1 ? (left+right)/2 : left + index * (right-left)/(rows.length-1);
  const y = value => bottom - value / scale * (bottom-top);
  const label = date => new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
  const reading = index => { const row = rows[index]; return `${new Date(`${row.date}T12:00:00`).toLocaleDateString("pt-BR")}: ${row.goals} ${row.goals === 1 ? "gol" : "gols"} · ${row.assists} ${row.assists === 1 ? "assistência" : "assistências"}`; };
  const series = [["goals","Gols","#62baff"],["assists","Assistências","#e6c768"]];
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Evolução de gols e assistências de ${escapeHtml(player.name)} por data"><title>Gols e assistências por dia</title>${Array.from({length:scale/step+1},(_,i) => { const value=i*step; return `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="stats-chart-grid"/><text x="${left-12}" y="${y(value)+5}" text-anchor="end" class="stats-chart-label">${value}</text>`; }).join("")}${rows.map((row,i) => `<text x="${x(i)}" y="${bottom+28}" text-anchor="middle" class="stats-chart-label">${label(row.date)}</text>`).join("")}${series.map(([field,name,color]) => `<polyline points="${rows.map((row,i)=>`${x(i)},${y(row[field])}`).join(" ")}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${rows.map((row,i)=>`<circle cx="${x(i)}" cy="${y(row[field])}" r="6" fill="${color}" stroke="var(--surface)" stroke-width="2" tabindex="0" role="button" data-stats-point="${i}" aria-label="${escapeHtml(reading(i))} · ${name}"><title>${escapeHtml(reading(i))}</title></circle>`).join("")}`).join("")}</svg>`;
  target.innerHTML = `<div class="stats-chart-legend"><span><i class="stats-goals-color"></i>Gols</span><span><i class="stats-assists-color"></i>Assistências</span><span class="muted">${rows.length} ${rows.length === 1 ? "data registrada" : "datas registradas"}</span></div><div class="stats-chart-scroll" tabindex="0" aria-label="Gráfico de desempenho; deslize para ver todas as datas"><div class="stats-chart-canvas" style="min-width:${width}px">${svg}</div></div><p id="statsChartReading" class="stats-chart-reading" aria-live="polite">${escapeHtml(reading(rows.length-1))}</p><p class="muted small">Cada ponto mostra os totais daquele dia. ${rows.length === 1 ? "Com mais jogos, as linhas vão mostrar sua evolução." : "Toque em um ponto para consultar os números."}</p><details class="stats-chart-data"><summary>Ver números por data</summary><div class="table-scroll"><table><thead><tr><th>Data</th><th>Gols</th><th>Assistências</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${new Date(`${row.date}T12:00:00`).toLocaleDateString("pt-BR")}</td><td>${row.goals}</td><td>${row.assists}</td></tr>`).join("")}</tbody></table></div></details>`;
  $$('[data-stats-point]').forEach(point => {
    const show = () => { $("#statsChartReading").textContent = reading(Number(point.dataset.statsPoint)); };
    point.addEventListener("click",show); point.addEventListener("focus",show);
    point.addEventListener("keydown",event => { if (["Enter"," "].includes(event.key)) { event.preventDefault(); show(); } });
  });
}

// One result per closed matchday, retaining the saved roster and goalkeeper role.
function playerDayEntries(playerId, matches = state.matches) {
  const entries = [];
  for (const match of matches.filter(item => !item.roundId)) {
    const key = (match.teamA || []).includes(playerId) ? 'A' : (match.teamB || []).includes(playerId) ? 'B' : null;
    if (!key) continue;
    const own = Number(key === 'A' ? match.scoreA : match.scoreB), conceded = Number(key === 'A' ? match.scoreB : match.scoreA);
    entries.push({date:match.date, ids:key === 'A' ? match.teamA : match.teamB, keeper:(key === 'A' ? match.goalkeeperAId : match.goalkeeperBId) === playerId, conceded, result:own === conceded ? 'draw' : own > conceded ? 'win' : 'loss', goals:Number(match.contributions?.[playerId]?.goals)||0, assists:Number(match.contributions?.[playerId]?.assists)||0, mvp:match.mvpPlayerId === playerId, bagre:match.bolaMurchaPlayerId === playerId});
  }
  const included = new Set(matches.map(match=>match.roundId).filter(Boolean));
  for (const round of (state.rounds || []).filter(item=>item.closed && included.has(item.id))) {
    const key = ['A','B','C'].find(team=>(round.teams[team] || []).includes(playerId));
    if (!key) continue;
    const conceded = roundMatches(round).filter(match=>match.teamAKey === key || match.teamBKey === key).reduce((sum,match)=>sum + Number(match.teamAKey === key ? match.scoreB : match.scoreA),0);
    entries.push({date:round.date, ids:round.teams[key], keeper:round.keepers[key] === playerId, conceded, result:round.championTeam === key ? 'win' : 'loss', goals:Number(round.contributions?.[playerId]?.goals)||0, assists:Number(round.contributions?.[playerId]?.assists)||0, mvp:round.mvpPlayerId === playerId, bagre:round.bolaMurchaPlayerId === playerId});
  }
  return entries.sort((a,b)=>a.date.localeCompare(b.date));
}
function keeperDayTotals(entries) {
  const days = new Map();
  entries.filter(entry=>entry.keeper).forEach(entry=>days.set(entry.date,(days.get(entry.date)||0)+entry.conceded));
  return [...days].map(([date,conceded])=>({date,conceded}));
}
function playerAchievements(playerId) {
  const entries = playerDayEntries(playerId);
  const count = predicate => entries.filter(predicate).length;
  const total = (field,keeper) => entries.filter(entry=>entry.keeper === keeper).reduce((sum,entry)=>sum+entry[field],0);
  const badges = [];
  const addSeries = (key,icon,names,goals,value,unit) => goals.forEach((goal,index)=>badges.push({key:`${key}-${goal}`,icon,name:names[index],goal,value,unlocked:value>=goal,detail:`${Math.min(value,goal)}/${goal} ${unit}`,progress:Math.min(100,value/goal*100)}));
  addSeries('line-goals','⚽',['Estreou a conta','Faro de gol','Pesadelo da defesa','Máquina de gols'],[1,10,25,50],total('goals',false),'gols na linha');
  addSeries('line-assists','🎯',['Passe com carinho','Garçom do Bagres','Mesa servida','Chef das assistências'],[1,10,25,50],total('assists',false),'assistências na linha');
  addSeries('wins','🏆',['Pegou gosto por vencer','Colecionador de quintas','Nasceu para ganhar'],[5,10,25],count(entry=>entry.result==='win'),'vitórias');
  addSeries('mvp','⭐',['Dia de protagonista','Respeita o protagonista','Craque de carteirinha'],[1,5,10],count(entry=>entry.mvp),'MVPs');
  addSeries('presence','📅',['Figurinha carimbada','Só falta morar na quadra','Patrimônio do Bagres'],[5,10,25],new Set(entries.map(entry=>entry.date)).size,'dias jogados');
  addSeries('keeper-days','🧤',['Assumiu a bronca','Dono da meta','Guardião do Bagres'],[5,10,25],new Set(entries.filter(entry=>entry.keeper).map(entry=>entry.date)).size,'dias no gol');
  addSeries('keeper-goals','⚽',['Até o goleiro deixou o dele','Saiu do gol para o abraço','Goleiro artilheiro','Luvas e chuteira quente'],[1,3,5,10],total('goals',true),'gols como goleiro');
  addSeries('keeper-assists','🎯',['De luva também serve','Reposição com endereço','Lançamento de respeito','Garçom de luvas'],[1,3,5,10],total('assists',true),'assistências como goleiro');
  addSeries('bagre','🐟',['Batismo de bagre'],[1],count(entry=>entry.bagre),'Bagre');
  const keeperDays = keeperDayTotals(entries);
  const best = keeperDays.length ? Math.min(...keeperDays.map(day=>day.conceded)) : null;
  [20,15,10,8,6].forEach((limit,index)=>{
    const unlocked = best !== null && best < limit;
    const day = keeperDays.find(day=>day.conceded < limit);
    badges.push({key:`keeper-conceded-${limit}`,icon:'🧤',name:['Segurou a onda','Fechou a torneira','Muralha em construção','Aqui não passa fácil','Hoje o gol ficou pequeno'][index],unlocked,detail:`Menos de ${limit} gols em um dia completo no gol`,extra:best === null ? 'Ainda sem dia registrado no gol' : `Melhor dia: ${best} gols sofridos${day ? ' · conquistada em '+new Date(day.date+'T12:00:00').toLocaleDateString('pt-BR') : ''}`,progress:unlocked?100:0});
  });
  const partners = new Map();
  for (const entry of entries) for (const id of new Set(entry.ids)) {
    if (id === playerId || !['win','loss'].includes(entry.result)) continue;
    if (!partners.has(id)) partners.set(id,{id,win:new Set(),loss:new Set()});
    partners.get(id)[entry.result].add(entry.date);
  }
  for (const [key,result,goal,name,icon] of [['duo-win','win',5,'Dupla de respeito','🤝'],['duo-loss','loss',5,'Dupla que não dá certo','💀'],['duo-win10','win',10,'Parceria de milhões','🔥']]) {
    const sorted = [...partners.values()].sort((a,b)=>b[result].size-a[result].size || a.id.localeCompare(b.id));
    const winners = sorted.filter(partner=>partner[result].size>=goal);
    const value = sorted[0]?.[result].size || 0;
    const person = id => state.players.find(player=>player.id===id)?.name || 'Jogador removido';
    badges.push({key,icon,name,unlocked:winners.length>0,progress:Math.min(100,value/goal*100),detail:`${Math.min(value,goal)}/${goal} ${result==='win'?'vitórias':'derrotas'} com a mesma pessoa`,extra:winners.length ? winners.map(partner=>`${person(partner.id)} · ${partner[result].size}`).join(' / ') : sorted.length ? `Parceria mais próxima: ${person(sorted[0].id)}` : 'Jogue no mesmo time para começar'});
  }
  return badges;
}
function renderAchievements(player) {
  const badges = playerAchievements(player.id);
  const earned = badges.filter(badge=>badge.unlocked);
  const card = badge => `<article class="achievement ${badge.unlocked?'is-unlocked':''}"><span class="achievement-icon" aria-hidden="true">${badge.icon}</span><div><span class="achievement-status">${badge.unlocked?'✓ Conquistada':'Próxima meta'}</span><h4>${escapeHtml(badge.name)}</h4><p>${escapeHtml(badge.detail)}</p>${badge.extra?`<p class="achievement-extra">${escapeHtml(badge.extra)}</p>`:''}${badge.unlocked?'':`<progress max="100" value="${badge.progress}" aria-label="Progresso: ${escapeHtml(badge.name)}"></progress>`}</div></article>`;
  const family = badge => badge.key.replace(/-\d+$/, '');
  const nextFamilies = new Set();
  const next = badges.filter(badge=>{
    if(badge.unlocked || nextFamilies.has(family(badge))) return false;
    nextFamilies.add(family(badge)); return true;
  }).sort((a,b)=>b.progress-a.progress).slice(0,3);
  const groups = [
    ['⚽','Jogador', badge=>!badge.key.startsWith('keeper-')&&!badge.key.startsWith('duo-')],
    ['🧤','Goleiro', badge=>badge.key.startsWith('keeper-')],
    ['🤝','Duplas', badge=>badge.key.startsWith('duo-')]
  ];
  $('#playerAchievements').innerHTML = `<div class="section-heading"><div><p class="eyebrow">SUA COLEÇÃO</p><h3>Conquistas</h3></div><span class="pill">${earned.length} de ${badges.length}</span></div><p class="muted achievement-help">Medalhas do histórico completo, independentemente do filtro dos Stats.</p><div class="achievement-showcase"><h4 class="achievement-section-title">🏅 Já conquistadas <span>${earned.length}</span></h4>${earned.length?`<div class="achievement-grid">${earned.slice(-3).map(card).join('')}</div>`:'<p class="achievement-empty">Suas primeiras medalhas vão aparecer aqui. Confira as próximas metas abaixo.</p>'}<h4 class="achievement-section-title">🎯 Próximas metas</h4><div class="achievement-grid">${next.map(card).join('')}</div></div><div class="achievement-catalog"><p class="achievement-catalog-label">Explore todas as conquistas</p>${groups.map(([icon,label,predicate])=>{const items=badges.filter(predicate);return `<details class="achievement-category"><summary><span>${icon} ${label}</span><span class="achievement-category-count">${items.filter(badge=>badge.unlocked).length}/${items.length} <span aria-hidden="true">⌄</span></span></summary><div class="achievement-grid">${items.map(card).join('')}</div></details>`;}).join('')}</div><details class="achievement-rules"><summary>Como funciona?</summary><p>Contamos apenas jogos e rodadas encerrados. Um dia com três times conta uma vez. As conquistas são recalculadas se os resultados forem corrigidos.</p></details>`;
}

function renderKeeperChart(player,matches) {
  const rows = keeperDayTotals(playerDayEntries(player.id,matches));
  const target = $('#playerStatsChart');
  if (!rows.length) { target.innerHTML='<p class="empty-state">Sem dias encerrados como goleiro neste período.</p>'; return; }
  const width=Math.max(640,rows.length*70+90), max=Math.max(1,...rows.map(row=>row.conceded));
  const x=i=>rows.length===1?width/2:45+i*(width-80)/(rows.length-1), y=n=>210-n/max*170;
  const date=value=>new Date(value+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  target.innerHTML=`<p class="muted small">Gols sofridos por dia completo no gol. Menor é melhor; na rodada com três times, soma os seis confrontos.</p><div class="stats-chart-scroll"><svg class="keeper-chart" viewBox="0 0 ${width} 250" role="img" aria-label="Gols sofridos por data de ${escapeHtml(player.name)}"><line x1="45" y1="210" x2="${width-35}" y2="210" class="stats-chart-grid"/><polyline points="${rows.map((row,i)=>`${x(i)},${y(row.conceded)}`).join(' ')}" fill="none" stroke="#62baff" stroke-width="3"/>${rows.map((row,i)=>`<circle cx="${x(i)}" cy="${y(row.conceded)}" r="6" fill="#62baff"><title>${date(row.date)}: ${row.conceded} gols sofridos</title></circle><text x="${x(i)}" y="${y(row.conceded)-14}" text-anchor="middle" class="stats-chart-label">${row.conceded}</text><text x="${x(i)}" y="240" text-anchor="middle" class="stats-chart-label">${date(row.date)}</text>`).join('')}</svg></div><details class="stats-chart-data"><summary>Ver números por data</summary><div class="table-scroll"><table><thead><tr><th>Data</th><th>Gols sofridos no dia</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${new Date(row.date+'T12:00:00').toLocaleDateString('pt-BR')}</td><td>${row.conceded}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function renderPlayerStats() {
  const periodInput = $("#playerStatsPeriod");
  if (!["month","year","all"].includes(periodInput.value)) periodInput.value = "year";
  const period = periodInput.value;
  $("#playerStatsMonthLabel").classList.toggle("hidden", period !== "month");
  $("#playerStatsYearLabel").classList.toggle("hidden", period !== "year");
  if (!$("#playerStatsMonth").value) $("#playerStatsMonth").value = currentMonthValue();
  const playerSelect = $("#playerStatsSelect");
  const previousPlayer = playerSelect.value;
  const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  playerSelect.innerHTML = players.length
    ? players.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")
    : '<option value="">Nenhum jogador cadastrado</option>';
  playerSelect.disabled = players.length === 0;
  if (!players.length) {
    $("#playerStatsChart").innerHTML = '<p class="empty-state">Cadastre jogadores para acompanhar a evolução.</p>';
    $("#playerStatsProfile").innerHTML = "";
    $("#playerAchievements").innerHTML = "";
    $("#playerStatsGrid").innerHTML = '<div class="empty-state">Cadastre jogadores para consultar os stats.</div>';
    $("#playerStatsEmpty").classList.add("hidden");
    return;
  }
  playerSelect.value = players.some(player => player.id === previousPlayer) ? previousPlayer : players[0].id;

  const yearSelect = $("#playerStatsYear");
  const previousYear = yearSelect.value;
  const years = new Set([currentYearValue()]);
  state.matches.forEach(match => { if (/^\d{4}-\d{2}-\d{2}$/.test(match.date)) years.add(match.date.slice(0, 4)); });
  const sortedYears = [...years].sort((a, b) => Number(b) - Number(a));
  yearSelect.innerHTML = sortedYears.map(year => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = sortedYears.includes(previousYear) ? previousYear : currentYearValue();

  const player = players.find(item => item.id === playerSelect.value);
  const selectedYear = yearSelect.value;
  const selectedMonth = $("#playerStatsMonth").value;
  const matches = statsMatchesForPeriod(period,selectedYear,selectedMonth);
  const periodLabel = period === "all" ? "Histórico completo" : period === "month" ? new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString("pt-BR", {month:"long",year:"numeric"}) : `Temporada ${selectedYear}`;
  const stats = rankingStatsForMatches(matches).get(player.id) || emptyStats();
  const lineAverage = value => stats.lineGames ? (value / stats.lineGames).toFixed(2).replace(".", ",") : "—";
  const winRate = stats.games ? `${Math.round(stats.wins / stats.games * 100)}%` : "0%";
  let mainStats = [["Gols", stats.goals, "⚽", "blue"], ["Assistências", stats.assists, "↗", "red"], ["Vitórias", stats.wins, "🏆", "gold"], ["Partidas", stats.games, "▦", "silver"], ["MVPs", stats.mvps, "★", "gold"], ["Bagre", stats.bolaMurchas, "🐟", "blue"]];
  const history = playerDayEntries(player.id);
  const keeperFocus = new Set(history.filter(entry=>entry.keeper).map(entry=>entry.date)).size > new Set(history.filter(entry=>!entry.keeper).map(entry=>entry.date)).size;
  const periodEntries = playerDayEntries(player.id,matches);
  const keeperWins = periodEntries.filter(entry=>entry.keeper && entry.result==='win').length;
  if (keeperFocus) mainStats = [["Dias no gol", new Set(periodEntries.filter(entry=>entry.keeper).map(entry=>entry.date)).size, "🧤", "blue"], ["Gols sofridos", stats.goalkeeperConceded || 0, "🥅", "red"], ["Média por dia", stats.goalkeeperGames ? ((stats.goalkeeperConceded || 0)/new Set(periodEntries.filter(entry=>entry.keeper).map(entry=>entry.date)).size).toFixed(2).replace('.',',') : '—', "▦", "silver"], ["Vitórias no gol", keeperWins, "🏆", "gold"], ["Gols como goleiro", (stats.goals||0)-(stats.lineGoals||0), "⚽", "blue"], ["Assistências no gol", (stats.assists||0)-(stats.lineAssists||0), "↗", "red"]];
  const groups = [
    ["NA LINHA", [["Partidas na linha", stats.lineGames || 0], ["Gols", stats.lineGoals || 0], ["Assistências", stats.lineAssists || 0], ["Média de gols", lineAverage(stats.lineGoals)], ["Média de assistências", lineAverage(stats.lineAssists)]]],
    ["RESULTADOS", [["Partidas", stats.games], ["Taxa de vitória", winRate], ["Empates", stats.draws], ["Derrotas", stats.losses], ["Vitórias", stats.wins]]],
    ["PREMIAÇÕES", [["MVP", stats.mvps], ["Bagre", stats.bolaMurchas]]],
    ["COMO GOLEIRO FIXO", [["Partidas no gol", stats.goalkeeperGames || 0], ["Gols feitos", (stats.goals || 0) - (stats.lineGoals || 0)], ["Assistências", (stats.assists || 0) - (stats.lineAssists || 0)], ["Gols sofridos", stats.goalkeeperGames ? stats.goalkeeperConceded : "—"], ["Gols sofridos por jogo", goalkeeperAverage(stats)]]]
  ];
  const keeperStats = [["Partidas no gol", stats.goalkeeperGames || 0], ["Gols sofridos / jogo", goalkeeperAverage(stats)], ["Gols feitos", (stats.goals || 0) - (stats.lineGoals || 0)], ["Assistências", (stats.assists || 0) - (stats.lineAssists || 0)]];
  $("#playerStatsProfile").innerHTML = `
    <div class="player-card-photo">${playerAvatar(player, "player-card-portrait")}</div>
    <div class="player-card-body"><header class="player-card-heading"><p class="eyebrow">FC BAGRES D’MUNIQUE</p><h3>${escapeHtml(player.name)}</h3>${keeperFocus ? '<p class="keeper-profile-caption">🧤 Guardião da meta</p>' : ""}<p class="player-card-period">${escapeHtml(periodLabel)}</p></header>
    <dl class="player-card-metrics">${mainStats.map(([label, value, icon, color]) => `<div class="player-card-metric metric-${color}"><span class="player-card-icon" aria-hidden="true">${icon}</span><div><dd>${value}</dd><dt>${label}</dt></div></div>`).join("")}</dl>
    <section class="player-card-keeper" aria-label="Estatísticas como goleiro fixo"><h4>NO GOL</h4><dl>${keeperStats.map(([label,value]) => `<div><dd>${value}</dd><dt>${label}</dt></div>`).join("")}</dl></section></div>`;
  $("#playerStatsGrid").innerHTML = groups.map(([title, metrics]) => `<article class="stats-group"><h4>${title}</h4><dl>${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl></article>`).join("");
  $("#playerStatsEmpty").classList.toggle("hidden", stats.games > 0);
  $("#playerStatsEmpty").textContent = `${player.name} ainda não tem partidas registradas neste período.`;
  $("#stats-evolution-title").textContent = keeperFocus ? "Sua evolução no gol" : "Sua evolução";
  $("#statsChartPill").textContent = keeperFocus ? "Gols sofridos por dia" : "Gols + assistências";
  if (keeperFocus) renderKeeperChart(player,matches); else renderStatsChart(player,matches);
  renderAchievements(player);
}

function renderTeams() {
  $("#matchDateLabel").textContent = state.matchDate ? new Date(`${state.matchDate}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "";
  const drawTeam = (team, target) => {
    $(target).innerHTML = entryPlayers(team).map(player => `
      <div class="team-player ${selectedSwapId === player.id ? "swap-selected" : ""}">
        <span class="team-person">${playerAvatar(player)}<b>${escapeHtml(player.name)}${player.fixedGoalkeeper ? '<small class="keeper-badge">Goleiro fixo</small>' : ""}</b></span>
        ${adminMode ? `<span class="team-player-actions"><span class="rating" title="${player.fixedGoalkeeper ? (balanceWeight(player) === 5 ? "Goleiro único: peso 5 no equilíbrio dos times" : "Goleiro fixo: nota da linha desconsiderada") : "Nota na linha"}">${player.fixedGoalkeeper ? (balanceWeight(player) === 5 ? "GK 5" : "GK") : player.rating || "—"}</span><button class="swap-button" type="button" data-swap="${escapeHtml(player.id)}" aria-pressed="${selectedSwapId === player.id}" aria-label="${selectedSwapId === player.id ? "Cancelar troca de" : "Selecionar para troca:"} ${escapeHtml(player.name)}">${selectedSwapId === player.id ? "Selecionado" : "Trocar"}</button></span>` : ""}
      </div>`).join("");
  };
  drawTeam("A", "#teamAList");
  drawTeam("B", "#teamBList");
  drawTeam("C", "#teamCList");
  $("#teamCCard").classList.toggle("hidden", activeTeamKeys().length < 3);
  $(".teams-grid").classList.toggle("three-teams", activeTeamKeys().length === 3);
  $("#teamCTotal").textContent = adminMode ? teamTotal("C") : "";
  $$("#teamAList [data-swap], #teamBList [data-swap], #teamCList [data-swap]").forEach(button =>
    button.addEventListener("click", () => selectSwap(button.dataset.swap)));
  if (adminMode) {
    const selected = state.players.find(player => player.id === selectedSwapId);
    $("#swapHint").textContent = selected
      ? `${selected.name} selecionado. Escolha um jogador do outro time para trocar, ou clique nele novamente para cancelar.`
      : "Para trocar, selecione um jogador de cada time.";
  }
  const totalA = teamTotal("A");
  const totalB = teamTotal("B");
  $("#teamATotal").textContent = adminMode ? totalA : "";
  $("#teamBTotal").textContent = adminMode ? totalB : "";
  $("#scoreATeamLabel").textContent = state.teamAName;
  $("#scoreBTeamLabel").textContent = state.teamBName;
  renderContributions();

  const strip = $("#balanceStrip");
  const label = $("#balanceLabel");
  const hint = $("#balanceHint");
  const countA = teamPlayers("A").length;
  const countB = teamPlayers("B").length;
  const difference = Math.abs(totalA - totalB);
  strip.className = "balance-strip";
  if (!adminMode) {
    label.textContent = countA && countB ? "Times da semana" : "Times ainda não montados";
    hint.textContent = countA && countB ? `${countA} × ${countB} jogadores` : "A escalação aparece aqui quando for montada.";
    return;
  }
  if (activeTeamKeys().length === 3) {
    label.textContent = "Rodada com três times";
    hint.textContent = activeTeamKeys().map(key => `${state[`team${key}Name`]}: ${teamPlayers(key).length} jogadores`).join(" · ");
  } else if (!countA || !countB) {
    label.textContent = "Times ainda não montados";
    hint.textContent = state.players.length ? "Escolha os jogadores ou use “Equilibrar times”." : "Cadastre os jogadores para começar.";
  } else if (difference <= 1 && Math.abs(countA - countB) <= 1) {
    strip.classList.add("good");
    label.textContent = "Confronto equilibrado";
    hint.textContent = `Diferença de ${difference} ${difference === 1 ? "ponto" : "pontos"}.`;
  } else {
    strip.classList.add("warn");
    label.textContent = "Vale ajustar os times";
    hint.textContent = `Diferença de ${difference} pontos entre as equipes.`;
  }
}

function selectSwap(id) {
  if (!adminMode || currentRound()) return;
  const player = state.players.find(item => item.id === id && item.available !== false && activeTeamKeys().includes(item.team));
  if (!player) return;
  if (selectedSwapId === id) {
    selectedSwapId = null;
  } else {
    const previous = state.players.find(item => item.id === selectedSwapId);
    if (previous && previous.available !== false && activeTeamKeys().includes(previous.team) && previous.team !== player.team) {
      const oldTeam = previous.team;
      previous.team = player.team;
      player.team = oldTeam;
      if (hasGoalkeeperConflict()) { player.team = previous.team; previous.team = oldTeam; selectedSwapId = null; renderTeams(); showToast("A troca deixaria dois goleiros fixos no mesmo time"); return; }
      selectedSwapId = null;
      persist();
      renderSquad();
      showToast(`${previous.name} e ${player.name} trocaram de time`);
    } else {
      selectedSwapId = id;
    }
  }
  renderTeams();
}

function renderContributions() {
  const target = $("#contributions");
  const previous = {};
  target.querySelectorAll('[data-goals], [data-assists]').forEach(input => {
    const id = input.dataset.goals || input.dataset.assists;
    previous[id] ??= {};
    previous[id][input.dataset.goals ? "goals" : "assists"] = input.value;
  });
  if (!teamPlayers("A").length || !teamPlayers("B").length) {
    target.innerHTML = '<p class="muted small">Monte os times para registrar gols e assistências por jogador.</p>';
    renderMatchAwards();
    return;
  }
  target.innerHTML = activeTeamKeys().map(key => [key, currentRound()?.names[key] || state[`team${key}Name`]]).map(([team, name]) => `
    <div class="contribution-team">
      <h4>${escapeHtml(name)}</h4>
      ${entryPlayers(team).map(player => `
        <div class="contribution-row">
          <strong>${escapeHtml(player.name)}</strong>
          <label>Gols<input type="number" min="0" max="99" value="${escapeHtml(previous[player.id]?.goals ?? currentRound()?.contributions?.[player.id]?.goals ?? 0)}" required data-goals="${player.id}" aria-label="Gols de ${escapeHtml(player.name)}" /></label>
          <label>Assistências<input type="number" min="0" max="99" value="${escapeHtml(previous[player.id]?.assists ?? currentRound()?.contributions?.[player.id]?.assists ?? 0)}" required data-assists="${player.id}" aria-label="Assistências de ${escapeHtml(player.name)}" /></label>
        </div>`).join("")}
    </div>`).join("");
  renderMatchAwards();
}

function renderMatchAwards() {
  const participants = activeTeamKeys().flatMap(entryPlayers);
  [["#matchMvp", "Escolha o MVP"], ["#matchBolaMurcha", "Escolha o Bagre"]].forEach(([selector, placeholder]) => {
    const select = $(selector);
    const previous = select.value || currentRound()?.[selector === "#matchMvp" ? "mvpPlayerId" : "bolaMurchaPlayerId"];
    select.innerHTML = `<option value="">${placeholder}</option>${participants.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")}`;
    if (participants.some(player => player.id === previous)) select.value = previous;
    select.disabled = participants.length === 0;
  });
}

function matchMonthlyMembers() {
  return new Set(state.monthlyMembers?.[(state.matchDate || "").slice(0,7)] || []);
}
function selectMatchMonthlyMembers() {
  if (!adminMode || currentRound()) return 0;
  const members = matchMonthlyMembers();
  let count = 0;
  state.players.forEach(player => { if (members.has(player.id)) { player.available = true; count++; } });
  return count;
}
function renderSquad() {
  const selected = availablePlayers();
  const monthly = matchMonthlyMembers();
  $("#availableCount").textContent = `${selected.length} de ${state.players.length} confirmados`;
  $("#unassignedCount").textContent = `${selected.filter(player => !player.team).length} sem time`;
  $("#squadList").innerHTML = state.players
    .slice()
    .sort((a, b) => (a.available === false) - (b.available === false) || (adminMode ? b.rating - a.rating : 0) || a.name.localeCompare(b.name, "pt-BR"))
    .map(player => `
      <div class="squad-row ${player.available === false ? "unavailable" : ""}">
        <label class="availability-label"><input type="checkbox" data-available="${player.id}" ${player.available !== false ? "checked" : ""} ${!adminMode ? "disabled" : ""} /><span class="squad-person"><span>${escapeHtml(player.name)}${monthly.has(player.id) ? '<span class="squad-monthly-star" title="Mensalista no mês da partida" aria-label="Mensalista no mês da partida">*</span>' : ""}</span>${adminMode ? `<span class="rating">${player.fixedGoalkeeper ? (balanceWeight(player) === 5 ? "GK 5" : "GK") : player.rating || "—"}</span>` : ""}</span></label>
        ${adminMode ? `<select data-assign="${player.id}" aria-label="Time de ${escapeHtml(player.name)}" ${player.available === false ? "disabled" : ""}>
          <option value="" ${!player.team ? "selected" : ""}>Sem time</option>
          <option value="A" ${player.team === "A" ? "selected" : ""}>${escapeHtml(state.teamAName)}</option>
          <option value="B" ${player.team === "B" ? "selected" : ""}>${escapeHtml(state.teamBName)}</option>
          ${activeTeamKeys().length === 3 ? `<option value="C" ${player.team === "C" ? "selected" : ""}>${escapeHtml(state.teamCName)}</option>` : ""}
        </select>` : `<span class="squad-team">${player.available === false ? "Fora" : player.team === "A" ? escapeHtml(state.teamAName) : player.team === "B" ? escapeHtml(state.teamBName) : player.team === "C" ? escapeHtml(state.teamCName) : "Sem time"}</span>`}
        ${adminMode ? `<label class="keeper-choice"><input type="checkbox" data-keeper="${player.id}" ${player.fixedGoalkeeper ? "checked" : ""} ${player.available === false ? "disabled" : ""} />Goleiro fixo neste jogo</label>` : player.fixedGoalkeeper && player.available !== false ? '<span class="keeper-badge">Goleiro fixo</span>' : ""}
      </div>`).join("");
  $$('[data-keeper]').forEach(input => input.addEventListener("change", event => {
    const player = state.players.find(item => item.id === event.target.dataset.keeper);
    if (!player || !adminMode) return;
    player.fixedGoalkeeper = event.target.checked;
    if (availablePlayers().filter(item => item.fixedGoalkeeper).length > activeTeamKeys().length || hasGoalkeeperConflict()) {
      player.fixedGoalkeeper = false;
      showToast("Marque no máximo um goleiro fixo por time");
    } else persist();
    render();
  }));
  $$('[data-assign]').forEach(select => select.addEventListener("change", event => {
    const player = state.players.find(item => item.id === event.target.dataset.assign);
    if (player) {
      const previousTeam = player.team;
      player.team = event.target.value || null;
      if (hasGoalkeeperConflict()) { player.team = previousTeam; showToast("Esse time já tem um goleiro fixo"); renderSquad(); return; }
    }
    persist();
    render();
  }));
  $$('[data-available]').forEach(input => input.addEventListener("change", event => {
    const player = state.players.find(item => item.id === event.target.dataset.available);
    if (!player) return;
    player.available = event.target.checked;
    if (!player.available) { player.team = null; player.fixedGoalkeeper = false; }
    persist(); render();
  }));
}

function renderRoster() {
  const target = $("#rosterList");
  if (!state.players.length) {
    target.innerHTML = '<div class="empty-state">Ainda não há jogadores cadastrados.</div>';
    return;
  }
  target.innerHTML = state.players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map(player => `
      <div class="roster-row">
        <div class="roster-person">${playerAvatar(player, "roster-avatar")}<div class="roster-info"><b>${escapeHtml(player.name)}</b><span>${adminMode ? `Nota ${player.rating} · ` : ""}${player.stats.games} jogos</span></div></div>
        <div class="row-actions admin-only">
          <button class="mini-button" data-edit="${player.id}" title="Editar ${escapeHtml(player.name)}">✎</button>
          <button class="mini-button danger" data-delete="${player.id}" title="Excluir ${escapeHtml(player.name)}">×</button>
        </div>
      </div>`).join("");
  $$('[data-edit]').forEach(button => button.addEventListener("click", () => startEdit(button.dataset.edit)));
  $$('[data-delete]').forEach(button => button.addEventListener("click", () => deletePlayer(button.dataset.delete)));
}

function rankingStatsForMatches(matches) {
  const totals = new Map(state.players.map(player => [player.id, { ...emptyStats(), mvps: 0, bolaMurchas: 0, goalkeeperGames: 0, goalkeeperConceded: 0, lineGames: 0, lineGoals: 0, lineAssists: 0 }]));
  matches.filter(match => !match.roundId).forEach(match => {
    const draw = match.scoreA === match.scoreB;
    const winner = draw ? null : match.scoreA > match.scoreB ? "A" : "B";
    [["A", match.teamA], ["B", match.teamB]].forEach(([team, ids]) => {
      (ids || []).forEach(id => {
        const stats = totals.get(id);
        if (!stats) return;
        stats.games += 1;
        const isFixedGoalkeeper = (team === "A" ? match.goalkeeperAId : match.goalkeeperBId) === id;
        if (!isFixedGoalkeeper) {
          stats.lineGames += 1;
          stats.lineGoals += Number(match.contributions?.[id]?.goals) || 0;
          stats.lineAssists += Number(match.contributions?.[id]?.assists) || 0;
        }
        stats.gf += team === "A" ? match.scoreA : match.scoreB;
        stats.ga += team === "A" ? match.scoreB : match.scoreA;
        stats.goals += Number(match.contributions?.[id]?.goals) || 0;
        stats.assists += Number(match.contributions?.[id]?.assists) || 0;
        if (draw) { stats.draws += 1; stats.points += 1; }
        else if (winner === team) { stats.wins += 1; stats.points += 3; }
        else stats.losses += 1;
      });
    });
    for (const [id, conceded] of [[match.goalkeeperAId, match.scoreB], [match.goalkeeperBId, match.scoreA]]) {
      const keeper = totals.get(id);
      if (keeper) { keeper.goalkeeperGames += 1; keeper.goalkeeperConceded += conceded; }
    }
    const mvp = totals.get(match.mvpPlayerId);
    if (mvp) mvp.mvps += 1;
    const bolaMurcha = totals.get(match.bolaMurchaPlayerId);
    if (bolaMurcha) bolaMurcha.bolaMurchas += 1;
  });
  const roundIds = new Set(matches.map(match => match.roundId).filter(Boolean));
  (state.rounds || []).filter(round => round.closed && roundIds.has(round.id)).forEach(round => {
    const games = roundMatches(round);
    for (const key of ["A","B","C"]) for (const id of round.teams[key]) {
      const stats = totals.get(id); if (!stats) continue;
      stats.games++;
      if (key === round.championTeam) { stats.wins++; stats.points += 3; } else stats.losses++;
      const keeper = round.keepers[key] === id;
      if (keeper) stats.goalkeeperGames++; else stats.lineGames++;
      for (const match of games) {
        const isA = match.teamAKey === key, isB = match.teamBKey === key;
        if (!isA && !isB) continue;
        stats.gf += isA ? match.scoreA : match.scoreB;
        stats.ga += isA ? match.scoreB : match.scoreA;
        if (keeper) stats.goalkeeperConceded += isA ? match.scoreB : match.scoreA;
      }
    }
    Object.entries(round.contributions || {}).forEach(([id, contribution]) => {
      const stats = totals.get(id);
      if (!stats) return;
      stats.goals += contribution.goals; stats.assists += contribution.assists;
      if (!Object.values(round.keepers).includes(id)) { stats.lineGoals += contribution.goals; stats.lineAssists += contribution.assists; }
    });
    if (totals.has(round.mvpPlayerId)) totals.get(round.mvpPlayerId).mvps++;
    if (totals.has(round.bolaMurchaPlayerId)) totals.get(round.bolaMurchaPlayerId).bolaMurchas++;
  });
  return totals;
}

function goalkeeperAverage(stats) {
  return stats?.goalkeeperGames ? (stats.goalkeeperConceded / stats.goalkeeperGames).toFixed(2).replace(".", ",") : "—";
}
function goalkeeperOrder(a, b) {
  return a.goalkeeperConceded * b.goalkeeperGames - b.goalkeeperConceded * a.goalkeeperGames;
}
function hasGoalkeeperConflict() {
  return activeTeamKeys().some(team => teamPlayers(team).filter(player => player.fixedGoalkeeper).length > 1);
}

function manualStatsForYear(player, year) {
  const byYear = player.manualStatsByYear || {};
  if (byYear[String(year)]) return { ...emptyStats(), ...byYear[String(year)] };
  return String(year) === currentYearValue() ? { ...emptyStats(), ...player.manualStats } : emptyStats();
}

function renderRankingTable(bodySelector, emptySelector, sortBy, totals, editable = false) {
  const tieBreakers = {
    goals: ["goals", "assists", "wins", "games"],
    assists: ["assists", "goals", "wins", "games"],
    wins: ["wins", "draws", "goals", "assists"],
    games: ["games", "goals", "assists", "wins"],
    mvps: ["mvps", "goals", "assists", "wins"],
    bolaMurchas: ["bolaMurchas", "wins", "games", "goals"]
  };
  const hasStats = [...totals.values()].some(stats => Object.values(stats).some(value => Number(value) > 0));
  $(emptySelector).classList.toggle("hidden", hasStats);
  const sortedPlayers = state.players.filter(player => sortBy !== "goalkeeperAverage" || totals.get(player.id)?.goalkeeperGames > 0).sort((a, b) =>
    (sortBy === "goalkeeperAverage"
      ? goalkeeperOrder(totals.get(a.id), totals.get(b.id)) || totals.get(b.id).goalkeeperGames - totals.get(a.id).goalkeeperGames
      : tieBreakers[sortBy].reduce((difference, key) => difference || (totals.get(b.id)?.[key] || 0) - (totals.get(a.id)?.[key] || 0), 0))
      || a.name.localeCompare(b.name, "pt-BR"));
  if (sortBy === "goalkeeperAverage") {
    $(emptySelector).classList.toggle("hidden", sortedPlayers.length > 0);
    $(emptySelector).textContent = "Nenhuma partida com goleiro fixo registrada neste período.";
  } else $(emptySelector).textContent = "Nenhuma partida registrada neste período.";
  const metricLabel = { goals: "gols", assists: "assistências", wins: "vitórias", games: "partidas", mvps: "MVPs", bolaMurchas: "Bagres", goalkeeperAverage: "gols sofridos / jogo" }[sortBy];
  $(bodySelector.replace("Body", "Podium")).innerHTML = hasStats ? sortedPlayers.slice(0, 3).map((player, index) => `<article class="podium-player podium-${index + 1}"><span class="podium-position">${index + 1}º</span>${playerAvatar(player, "podium-avatar")}<b>${escapeHtml(player.name)}</b><strong>${sortBy === "goalkeeperAverage" ? goalkeeperAverage(totals.get(player.id)) : totals.get(player.id)?.[sortBy] || 0} <span>${metricLabel}</span></strong></article>`).join("") : "";
  $(bodySelector).innerHTML = hasStats ? sortedPlayers.map((player, index) => {
    const stats = totals.get(player.id) || emptyStats();
    return `<tr class="${index === 0 ? "leader" : ""}">
      <td class="position">${index + 1}</td>
      <td><span class="ranking-name">${playerAvatar(player)}${escapeHtml(player.name)}</span></td>
      <td>${stats.games}</td><td>${stats.wins}</td><td>${stats.draws}</td><td>${stats.losses}</td><td>${stats.goals}</td><td>${stats.assists}</td><td>${stats.mvps}</td><td>${stats.bolaMurchas}</td><td>${stats.goalkeeperGames || "—"}</td><td>${stats.goalkeeperGames ? stats.goalkeeperConceded : "—"}</td><td>${goalkeeperAverage(stats)}</td>${editable ? `<td><button class="mini-button" type="button" data-edit-stats="${escapeHtml(player.id)}" aria-label="Editar estatísticas de ${escapeHtml(player.name)}">✎</button></td>` : ""}
    </tr>`;
  }).join("") : "";
  if (editable && adminMode) {
    $$(`${bodySelector} [data-edit-stats]`).forEach(button => button.addEventListener("click", () => startStatsEdit(button.dataset.editStats)));
  }
}

function renderAnnualRanking() {
  const body = $("#annualRankingBody");
  if (!adminMode) { body.innerHTML = ""; $("#annualRankingPodium").innerHTML = ""; return; }
  const yearSelect = $("#annualRankingYear");
  const previousYear = yearSelect.value;
  const years = new Set([currentYearValue()]);
  state.matches.forEach(match => { if (/^\d{4}-\d{2}-\d{2}$/.test(match.date)) years.add(match.date.slice(0, 4)); });
  const sortedYears = [...years].sort((a, b) => Number(b) - Number(a));
  yearSelect.innerHTML = sortedYears.map(year => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = sortedYears.includes(previousYear) ? previousYear : currentYearValue();
  const year = yearSelect.value;
  const matches = state.matches.filter(match => typeof match.date === "string" && match.date.startsWith(`${year}-`));
  const totals = rankingStatsForMatches(matches);
  state.players.forEach(player => {
    const stats = totals.get(player.id);
    const manual = manualStatsForYear(player, year);
    ["games", "wins", "draws", "losses", "points", "goals", "assists", "gf", "ga"].forEach(key => { stats[key] += Number(manual[key]) || 0; });
  });
  renderRankingTable("#annualRankingBody", "#annualRankingEmpty", $("#annualRankingSort").value, totals, true);
}

function renderMonthlyRanking() {
  const monthInput = $("#monthlyRankingMonth");
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const matches = state.matches.filter(match => typeof match.date === "string" && match.date.startsWith(month));
  renderRankingTable("#monthlyRankingBody", "#monthlyRankingEmpty", $("#monthlyRankingSort").value, rankingStatsForMatches(matches));
}

function renderMatches() {
  $("#matchesCount").textContent = `${state.matches.length} ${state.matches.length === 1 ? "partida" : "partidas"}`;
  $("#matchesEmpty").style.display = state.matches.length ? "none" : "block";
  $("#matchesList").innerHTML = state.matches.map(match => `
    <div class="match-row">
      <span class="match-date">${new Date(`${match.date}T12:00:00`).toLocaleDateString("pt-BR")}${match.roundId ? `<small> · Jogo ${match.scheduleIndex + 1} · 10 min</small>` : ""}</span>
      <b class="match-team">${escapeHtml(match.teamAName)}</b>
      <span class="match-score">${match.scoreA} × ${match.scoreB}</span>
      <b class="match-team">${escapeHtml(match.teamBName)}</b>
      <button class="mini-button danger admin-only" data-delete-match="${match.id}" title="Excluir partida">×</button>
      <div class="match-details">${awardSummary(match).replace(/^ · /, '')}${matchContributionDetails(match)}</div>
    </div>`).join("");
  $$('[data-delete-match]').forEach(button => button.addEventListener("click", () => deleteMatch(button.dataset.deleteMatch)));
}

function matchContributionDetails(match) {
  const round = state.rounds?.find(round => round.id === match.roundId);
  if (round) {
    return `<details class="match-contribution-details"><summary>Rodada do dia · ${round.closed ? "encerrada" : "em andamento"}</summary>${round.closed ? `<p>Campeão: <b>${escapeHtml(round.names[round.championTeam])}</b>${awardSummary(round)}</p>` : ""}<p class="muted small">Gols e assistências gerais do dia, sem divisão por jogo.</p>${["A","B","C"].map(key => `<h4>${escapeHtml(round.names[key])}</h4>${round.teams[key].map(id => { const player = state.players.find(p => p.id === id); const c = round.contributions?.[id]; return c && (c.goals || c.assists) ? `<p>${escapeHtml(player?.name || "Jogador removido")}: ${c.goals} gols · ${c.assists} assistências</p>` : ""; }).join("")}`).join("")}</details>`;
  }
  const team = (ids, name) => {
    const entries = (ids || []).map(id => ({ player: state.players.find(player => player.id === id), contribution: match.contributions?.[id] })).filter(({contribution}) => contribution && (Number(contribution.goals) > 0 || Number(contribution.assists) > 0));
    return `<section class="match-contribution-team"><h4>${escapeHtml(name)}</h4>${entries.length ? `<div class="match-contribution-head"><span>Jogador</span><span>Gols</span><span>Ass.</span></div>${entries.map(({player, contribution}) => `<div class="match-contribution-player"><span>${player ? playerAvatar(player) : ''}<b>${player ? escapeHtml(player.name) : 'Jogador removido'}</b></span><strong>${Number(contribution.goals) || 0}</strong><strong>${Number(contribution.assists) || 0}</strong></div>`).join('')}` : '<p class="muted small">Sem gols ou assistências individuais registrados.</p>'}</section>`;
  };
  return `<details class="match-contribution-details"><summary>Ver detalhes · gols e assistências</summary><div class="match-contribution-grid">${team(match.teamA, match.teamAName)}${team(match.teamB, match.teamBName)}</div></details>`;
}

function awardSummary(match) {
  const mvp = state.players.find(player => player.id === match.mvpPlayerId);
  const bolaMurcha = state.players.find(player => player.id === match.bolaMurchaPlayerId);
  const goalkeeperNotes = [[match.goalkeeperAId, match.scoreB], [match.goalkeeperBId, match.scoreA]].map(([id, conceded]) => {
    const player = state.players.find(item => item.id === id);
    return player ? `Goleiro: ${escapeHtml(player.name)} (${conceded} GS)` : null;
  });
  const awards = [...goalkeeperNotes, mvp && `MVP: ${escapeHtml(mvp.name)}`, bolaMurcha && `Bagre: ${escapeHtml(bolaMurcha.name)}`].filter(Boolean);
  return awards.length ? ` · ${awards.join(" · ")}` : "";
}

function autoBalance() {
  if (availablePlayers().length < 2) { showToast("Selecione pelo menos dois jogadores para esta partida"); return; }
  selectedSwapId = null;
  if (currentRound()) { showToast("A escalação desta rodada já está salva. Escolha outra data para montar novos times."); return; }
  const keys = activeTeamKeys();
  const keepers = availablePlayers().filter(player => player.fixedGoalkeeper).sort(() => Math.random() - .5);
  if (keepers.length > keys.length) { showToast("Selecione no máximo um goleiro fixo por time"); return; }
  availablePlayers().forEach(player => { player.team = null; });
  keepers.forEach((player, index) => { player.team = keys[index]; });
  const ordered = availablePlayers().filter(player => !player.fixedGoalkeeper).sort((a, b) => b.rating - a.rating || Math.random() - .5);
  ordered.forEach(player => {
    player.team = keys.slice().sort((a,b) => teamPlayers(a).length - teamPlayers(b).length || teamTotal(a) - teamTotal(b))[0];
  });
  persist();
  render();
  showToast("Times equilibrados automaticamente");
}

function startEdit(id) {
  const player = state.players.find(item => item.id === id);
  if (!player) return;
  $("#editingId").value = player.id;
  $("#playerName").value = player.name;
  $("#playerRating").value = player.rating;
  $("#playerPhoto").value = "";
  $("#playerSubmit").textContent = "Salvar alterações";
  $("#cancelEdit").classList.remove("hidden");
  $("#removePlayerPhoto").classList.toggle("hidden", !player.photoKey);
  $("#playerName").focus();
}

function startStatsEdit(id) {
  if (!adminMode) return;
  const player = state.players.find(item => item.id === id);
  if (!player) return;
  const year = $("#annualRankingYear").value || currentYearValue();
  const matches = state.matches.filter(match => typeof match.date === "string" && match.date.startsWith(`${year}-`));
  const recorded = rankingStatsForMatches(matches).get(id) || emptyStats();
  const manual = manualStatsForYear(player, year);
  $("#statsPlayerId").value = id;
  $("#statsTitle").textContent = `Estatísticas de ${player.name} — ${year}`;
  for (const [key, field] of [["games", "statGames"], ["wins", "statWins"], ["draws", "statDraws"], ["losses", "statLosses"], ["goals", "statGoals"], ["assists", "statAssists"]]) {
    $(`#${field}`).value = recorded[key] + (Number(manual[key]) || 0);
  }
  $("#statsForm").classList.remove("hidden");
  $("#statsForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEdit() {
  $("#playerForm").reset();
  $("#playerRating").value = 3;
  $("#editingId").value = "";
  $("#playerSubmit").textContent = "Adicionar jogador";
  $("#cancelEdit").classList.add("hidden");
  $("#removePlayerPhoto").classList.add("hidden");
}

function deletePlayer(id) {
  const player = state.players.find(item => item.id === id);
  if (!player || !confirm(`Excluir ${player.name} do elenco? A pessoa não aparecerá mais no ranking.`)) return;
  state.players = state.players.filter(item => item.id !== id);
  persist();
  render();
  showToast("Jogador excluído");
}

function rebuildStats() {
  state.players.forEach(player => {
    const byYear = { ...(player.manualStatsByYear || {}) };
    if (player.manualStats && !byYear[currentYearValue()]) byYear[currentYearValue()] = player.manualStats;
    player.stats = Object.values(byYear).reduce((totals, yearStats) => {
      Object.keys(totals).forEach(key => { totals[key] += Number(yearStats?.[key]) || 0; });
      return totals;
    }, emptyStats());
  });
  const recorded = rankingStatsForMatches(state.matches);
  state.players.forEach(player => Object.keys(emptyStats()).forEach(key => { player.stats[key] += recorded.get(player.id)[key]; }));
}

function applyMatchStats(match) {
  const draw = match.scoreA === match.scoreB;
  const winner = draw ? null : match.scoreA > match.scoreB ? "A" : "B";
  [["A", match.teamA], ["B", match.teamB]].forEach(([team, ids]) => {
    ids.forEach(id => {
      const player = state.players.find(item => item.id === id);
      if (!player) return;
      player.stats.games += 1;
      player.stats.gf += team === "A" ? match.scoreA : match.scoreB;
      player.stats.ga += team === "A" ? match.scoreB : match.scoreA;
      player.stats.goals += match.contributions?.[id]?.goals || 0;
      player.stats.assists += match.contributions?.[id]?.assists || 0;
      if (draw) { player.stats.draws += 1; player.stats.points += 1; }
      else if (winner === team) { player.stats.wins += 1; player.stats.points += 3; }
      else player.stats.losses += 1;
    });
  });
}

function deleteMatch(id) {
  if (!confirm("Excluir esta partida e recalcular o ranking?")) return;
  const match = state.matches.find(match => match.id === id);
  const round = state.rounds?.find(round => round.id === match?.roundId);
  if (round) { round.closed = false; round.championTeam = null; }
  state.matches = state.matches.filter(match => match.id !== id);
  rebuildStats();
  persist();
  render();
  showToast("Partida removida e ranking recalculado");
}

// Three-team rounds keep a roster snapshot; each team plays six ten-minute games.
const roundSchedule = ["A-C", "A-B", "C-B", "C-A", "B-A", "B-C", "A-C", "A-B", "C-B"];
function currentRound() { return (state.rounds || []).find(round => round.date === state.matchDate); }
function activeTeamKeys() { return currentRound() || availablePlayers().length >= 15 ? ["A", "B", "C"] : ["A", "B"]; }
function entryPlayers(key) {
  const round = currentRound();
  return round ? round.teams[key].map(id => ({ ...(state.players.find(player => player.id === id) || { id, name: "Jogador removido" }), team: key, fixedGoalkeeper: round.keepers[key] === id })) : teamPlayers(key);
}
function roundMatches(round) { return state.matches.filter(match => match.roundId === round.id); }
function roundStandings(round) {
  const rows = ["A","B","C"].map(key => ({ key, name: round.names[key], games: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0 }));
  roundMatches(round).forEach(match => {
    for (const [key, scored, conceded] of [[match.teamAKey,match.scoreA,match.scoreB],[match.teamBKey,match.scoreB,match.scoreA]]) {
      const row = rows.find(row => row.key === key);
      row.games++; row.gf += scored; row.ga += conceded;
      if (scored > conceded) { row.wins++; row.points += 3; }
      else if (scored === conceded) { row.draws++; row.points++; }
      else row.losses++;
    }
  });
  return rows.sort((a,b) => b.points - a.points || a.key.localeCompare(b.key));
}
function ensureRound() {
  if (currentRound()) return currentRound();
  const keys = ["A","B","C"];
  if (availablePlayers().length < 15 || availablePlayers().some(player => !keys.includes(player.team)) || keys.some(key => !teamPlayers(key).length) || hasGoalkeeperConflict()) throw new Error("Distribua todos os confirmados entre os três times, com no máximo um goleiro fixo por time.");
  const counts = keys.map(key => teamPlayers(key).length);
  if (Math.max(...counts) - Math.min(...counts) > 1) throw new Error("Deixe os três times com quantidades iguais ou com diferença de apenas um jogador.");
  if (state.matches.some(match => match.date === state.matchDate && !match.roundId)) throw new Error("Esta data já tem partidas no formato de dois times. Use outra data para a rodada de três times.");
  const round = { id: `r-${Date.now()}`, date: state.matchDate, closed: false, championTeam: null, contributions: {}, teams: {}, names: {}, keepers: {} };
  keys.forEach(key => { round.teams[key] = teamPlayers(key).map(player => player.id); round.names[key] = state[`team${key}Name`]; round.keepers[key] = teamPlayers(key).find(player => player.fixedGoalkeeper)?.id || null; });
  state.rounds ??= []; state.rounds.push(round);
  return round;
}
function updateTeamName(key, value) {
  if (!adminMode || !["A","B","C"].includes(key)) return;
  const name = value.slice(0,18) || `Equipe ${key}`;
  state[`team${key}Name`] = name;
  const round = currentRound();
  if (round) {
    round.names[key] = name;
    roundMatches(round).forEach(match => {
      if (match.teamAKey === key) match.teamAName = name;
      if (match.teamBKey === key) match.teamBName = name;
    });
  }
  renderSquad(); renderTeams(); renderRound({preserveScores:true}); renderHome(); renderMatches();
}
function renderRound({preserveScores = false} = {}) {
  const three = activeTeamKeys().length === 3;
  const panel = $("#roundPanel");
  const standingsFooter = $("#roundStandingsFooter");
  const scoreDraft = new Map();
  const championDraft = preserveScores ? $("#roundChampion")?.value : null;
  if (preserveScores) panel.querySelectorAll("[data-round-game]").forEach(form => {
    if (form.elements.scoreA && form.elements.scoreB) scoreDraft.set(Number(form.dataset.roundGame), { scoreA:form.elements.scoreA.value, scoreB:form.elements.scoreB.value });
  });
  const round = currentRound();
  panel.classList.toggle("hidden", !three);
  standingsFooter.classList.toggle("hidden", !three);
  $("#scoreForm .score-inputs").classList.toggle("hidden", three);
  for (const id of ["scoreA","scoreB"]) { $(`#${id}`).required = !three; $(`#${id}`).disabled = three; }
  $("#scoreFormTitle").textContent = three ? "Gols e assistências do dia" : "Registrar placar";
  $("#scoreFormHelp").textContent = three ? "Lance os totais gerais do dia e escolha um MVP e um Bagre. Feche após os nove placares. No ranking, cada jogador conta uma rodada e só o campeão recebe a vitória." : "O resultado atualiza jogos, vitórias, empates e derrotas. Informe os gols e assistências de cada jogador abaixo.";
  $("#scoreForm button[type=submit]").textContent = three ? "Fechar rodada e atualizar rankings" : "Salvar resultado";
  $("#saveRoundDraft").classList.toggle("hidden", !three);
  $("#saveRoundDraft").disabled = !round || round.closed;
  $("#scoreForm button[type=submit]").disabled = three && (!round || round.closed || roundMatches(round).length !== 9);
  $$("#scoreForm [data-goals], #scoreForm [data-assists], #matchMvp, #matchBolaMurcha").forEach(input => input.disabled = !!round?.closed);
  $$("#squadList input, #squadList select, #selectAll, #selectNone, #selectMonthly, #clearTeams, #autoBalance, [data-swap]").forEach(input => input.disabled = !adminMode || !!round);
  ["A","B","C"].forEach(key => $(`#team${key}Name`).disabled = !adminMode);
  if (!three) { panel.innerHTML = ""; standingsFooter.innerHTML = ""; return; }
  const names = round?.names || Object.fromEntries(["A","B","C"].map(key => [key,state[`team${key}Name`]]));
  const matches = round ? roundMatches(round) : [];
  const rows = round ? roundStandings(round) : [];
  const leaders = rows.filter(row => row.points === rows[0]?.points);
  const standings = rows.length ? rows : ["A","B","C"].map(key => ({key,name:names[key],games:0,wins:0,draws:0,losses:0,points:0}));
  standingsFooter.innerHTML = `<h3>Pontuação do dia</h3><p class="muted small">Vitória 3 · empate 1 · derrota 0</p><div class="table-scroll"><table aria-label="Classificação dos times no dia"><thead><tr><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Pontos</th></tr></thead><tbody>${standings.map(row => `<tr><td>${escapeHtml(row.name)}${round?.closed && round.championTeam === row.key ? '<span class="standings-champion">Campeão</span>' : ''}</td><td>${row.games}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td><b>${row.points}</b></td></tr>`).join("")}</tbody></table></div>`;

  panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">RODADA DO DIA</p><h3>3 times · 9 jogos de 10 minutos</h3></div><span class="pill">${matches.length}/9 jogos</span></div><p class="muted small">Cada time joga seis partidas de dez minutos. No ranking: uma rodada por jogador, com uma vitória para o campeão e uma derrota para os demais. Na tabela do dia, vitória: 3 pontos · empate: 1 ponto · derrota: 0. Um único campeão pela pontuação final.</p>${round?.closed ? `<p class="round-champion">🏆 Campeão do dia: <strong>${escapeHtml(names[round.championTeam])}</strong></p>` : '<p class="muted small">Rodada em andamento: os rankings serão atualizados no fechamento.</p>'}<div class="round-schedule">${roundSchedule.map((pair,index) => {
    const [a,b] = pair.split("-"); const match = matches.find(match => match.scheduleIndex === index);
    return `<form data-round-game="${index}" class="round-game"><span class="round-game-number">${index+1}º <small>10 min</small></span><b>${escapeHtml(names[a])}</b>${adminMode && !round?.closed ? `<input aria-label="Gols de ${escapeHtml(names[a])} no jogo ${index+1}" type="number" name="scoreA" min="0" max="99" required value="${escapeHtml(scoreDraft.get(index)?.scoreA ?? match?.scoreA ?? '')}"/>` : `<strong>${match?.scoreA ?? '—'}</strong>`}<span>×</span>${adminMode && !round?.closed ? `<input aria-label="Gols de ${escapeHtml(names[b])} no jogo ${index+1}" type="number" name="scoreB" min="0" max="99" required value="${escapeHtml(scoreDraft.get(index)?.scoreB ?? match?.scoreB ?? '')}"/>` : `<strong>${match?.scoreB ?? '—'}</strong>`}<b>${escapeHtml(names[b])}</b>${adminMode && !round?.closed ? `<button type="submit" class="button secondary">${match ? 'Atualizar' : 'Salvar'}</button>` : ''}</form>`;
  }).join("")}</div>${adminMode && matches.length === 9 && !round.closed && leaders.length > 1 ? `<label class="round-tie">Empate em pontos: vencedor do desempate<select id="roundChampion" required><option value="">Escolha o único campeão</option>${leaders.map(row => `<option value="${row.key}">${escapeHtml(row.name)}</option>`).join("")}</select></label>` : ''}${adminMode && round ? `<div class="round-actions">${round.closed ? '<button id="reopenRound" class="button secondary" type="button">Reabrir rodada para corrigir</button>' : ''}<button id="removeRound" class="text-button" type="button">Excluir rodada do dia</button></div>` : ''}`;
  if (championDraft && $("#roundChampion")) $("#roundChampion").value = championDraft;
  $$('[data-round-game]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); if (!adminMode) return;
    const snapshot = structuredClone(state);
    try {
      const scoreA = Number(form.elements.scoreA.value), scoreB = Number(form.elements.scoreB.value);
      if (![scoreA,scoreB].every(n => Number.isInteger(n) && n >= 0 && n <= 99) || !form.elements.scoreA.value || !form.elements.scoreB.value) return;
      const savedRound = ensureRound();
      if (savedRound.closed) return;
      captureRoundEntries(savedRound);
      const index = Number(form.dataset.roundGame); const [a,b] = roundSchedule[index].split('-');
      const existing = roundMatches(savedRound).find(match => match.scheduleIndex === index);
      const match = { id: existing?.id || `m-${savedRound.id}-${index}`, roundId: savedRound.id, scheduleIndex: index, date: savedRound.date, teamAKey: a, teamBKey: b, teamAName: savedRound.names[a], teamBName: savedRound.names[b], teamA: savedRound.teams[a].slice(), teamB: savedRound.teams[b].slice(), goalkeeperAId: savedRound.keepers[a], goalkeeperBId: savedRound.keepers[b], scoreA, scoreB, contributions: {} };
      if (existing) Object.assign(existing,match); else state.matches.unshift(match);
      const saved = await persist(); if (!saved) state = snapshot;
      render(); showToast(saved ? 'Placar salvo na rodada' : 'Placar não salvo. Recarregue antes de tentar novamente.');
    } catch(error) { state = snapshot; showToast(error.message); }
  }));
  $("#reopenRound")?.addEventListener("click", async () => {
    if (!confirm("Reabrir a rodada? Ela sai temporariamente dos rankings até ser fechada novamente.")) return;
    const before = structuredClone(state); round.closed = false; round.championTeam = null; rebuildStats();
    if (!await persist()) state = before;
    render();
  });
  $("#removeRound")?.addEventListener("click", async () => {
    if (!confirm("Excluir os nove jogos e os totais desta rodada?")) return;
    const before = structuredClone(state); state.matches = state.matches.filter(match => match.roundId !== round.id); state.rounds = state.rounds.filter(item => item.id !== round.id); rebuildStats();
    if (!await persist()) state = before;
    $("#contributions").innerHTML = ""; $("#scoreForm").reset(); render();
  });
}
function captureRoundEntries(round) {
  for (const id of Object.values(round.teams).flat()) {
    const goals = Number(document.querySelector(`[data-goals="${id}"]`)?.value || 0);
    const assists = Number(document.querySelector(`[data-assists="${id}"]`)?.value || 0);
    if (![goals,assists].every(n => Number.isInteger(n) && n >= 0 && n <= 99)) throw new Error("Informe gols e assistências inteiros entre 0 e 99.");
    round.contributions[id] = {goals,assists};
  }
  const ids = Object.values(round.teams).flat();
  round.mvpPlayerId = ids.includes($("#matchMvp").value) ? $("#matchMvp").value : null;
  round.bolaMurchaPlayerId = ids.includes($("#matchBolaMurcha").value) ? $("#matchBolaMurcha").value : null;
}
async function closeRound() {
  const round = currentRound();
  if (!round || round.closed || roundMatches(round).length !== 9) { showToast("Salve os nove placares antes de fechar a rodada."); return; }
  const before = structuredClone(state);
  try {
    captureRoundEntries(round);
    if (!round.mvpPlayerId || !round.bolaMurchaPlayerId) throw new Error("Escolha o MVP e o Bagre do dia.");
    const rows = roundStandings(round), leaders = rows.filter(row => row.points === rows[0].points);
    const champion = leaders.length === 1 ? leaders[0].key : $("#roundChampion")?.value;
    if (!leaders.some(row => row.key === champion)) throw new Error("Indique o único vencedor do desempate em pontos.");
    for (const row of rows) {
      for (const field of ['goals','assists']) {
        if (round.teams[row.key].reduce((sum,id) => sum + round.contributions[id][field],0) > row.gf) throw new Error(`${row.name}: o total de ${field === 'goals' ? 'gols' : 'assistências'} não pode superar os gols do time nos seis jogos.`);
      }
    }
    round.championTeam = champion; round.closed = true; rebuildStats();
    const saved = await persist(); if (!saved) state = before;
    render(); showToast(saved ? `Rodada fechada! Campeão: ${round.names[champion]}` : 'Não foi possível fechar a rodada.');
  } catch(error) { state = before; showToast(error.message); }
}

let monthlySaving = false;
function renderMonthlyMembers() {
  const monthInput = $("#monthlyMembersMonth");
  if (!monthInput.value) monthInput.value = currentMonthValue();
  const month = monthInput.value;
  const members = new Set(state.monthlyMembers?.[month] || []);
  const informed = Object.hasOwn(state.monthlyMembers || {},month);
  const players = state.players.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
  const count = players.filter(player=>members.has(player.id)).length;
  $("#monthlyMembersCount").textContent = `${count} ${count === 1 ? "mensalista" : "mensalistas"}`;
  $("#monthlyMembersStatus").textContent = monthlySaving ? "Salvando…" : informed ? `Mensalistas de ${new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}.` : "Nenhum mensalista informado para este mês.";
  $("#monthlyMembersList").innerHTML = players.length ? players.map(player=>{
    const active = members.has(player.id);
    return `<div class="monthly-member-row ${active ? "is-monthly" : ""}"><span class="monthly-member-person">${playerAvatar(player)}<b>${escapeHtml(player.name)}</b></span>${adminMode ? `<label class="monthly-member-choice"><input type="checkbox" data-monthly-member="${player.id}" ${active ? "checked" : ""} ${monthlySaving ? "disabled" : ""} />Mensalista</label>` : `<span class="monthly-member-badge">${active ? "Mensalista" : informed ? "Não mensalista" : "Não informado"}</span>`}</div>`;
  }).join("") : '<p class="empty-state">Cadastre os jogadores para marcar os mensalistas.</p>';
  monthInput.disabled = monthlySaving;
  $$('[data-monthly-member]').forEach(input=>input.addEventListener("change",()=>setMonthlyMember(input.dataset.monthlyMember,input.checked,month)));
}
async function setMonthlyMember(playerId, active, month) {
  if (!adminMode || monthlySaving || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !state.players.some(player=>player.id===playerId) || typeof active !== "boolean") return false;
  state.monthlyMembers ??= {};
  const existed = Object.hasOwn(state.monthlyMembers,month);
  const previous = (state.monthlyMembers[month] || []).slice();
  const members = new Set(previous);
  if (active) members.add(playerId); else members.delete(playerId);
  state.monthlyMembers[month] = [...members];
  monthlySaving = true; renderMonthlyMembers();
  try {
    const saved = await persist();
    if (!saved) {
      if (existed) state.monthlyMembers[month] = previous; else delete state.monthlyMembers[month];
      showToast("A alteração de mensalista não foi salva. Recarregue e tente novamente.");
    }
    return !!saved;
  } finally { monthlySaving = false; renderMonthlyMembers(); }
}

$$('.tab').forEach(tab => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
$("#adminToggle").addEventListener("click", toggleAdmin);
$("#cancelPassword").addEventListener("click", () => { $("#passwordForm").classList.add("hidden"); $("#adminPassword").value = ""; });
$("#passwordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const password = $("#adminPassword").value;
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    $("#adminPassword").value = "";
    if (!response.ok) { showToast(response.status === 429 ? "Muitas tentativas. Aguarde 15 minutos." : "Senha incorreta ou acesso não autorizado"); return; }
    await enterAdmin();
  } catch (_) { $("#adminPassword").value = ""; showToast("Não foi possível entrar agora"); }
});
$("#importLocal").addEventListener("click", () => {
  if (!adminMode || !serverEmpty || !confirm("Importar os dados antigos deste navegador para o site?")) return;
  const backup = readLocalBackup();
  if (!backup) return;
  state = backup;
  state.players.forEach(player => { player.manualStats = emptyStats(); });
  persist(); render();
  showToast("Dados antigos enviados para o site");
});
$("#annualRankingSort").addEventListener("change", renderAnnualRanking);
$("#annualRankingYear").addEventListener("change", renderAnnualRanking);
$("#monthlyRankingSort").addEventListener("change", renderMonthlyRanking);
$("#monthlyRankingMonth").addEventListener("input", renderMonthlyRanking);
$("#monthlyRankingMonth").addEventListener("change", renderMonthlyRanking);
$("#playerStatsSelect").addEventListener("change", renderPlayerStats);
$("#playerStatsYear").addEventListener("change", renderPlayerStats);
$("#playerStatsPeriod").addEventListener("change", renderPlayerStats);
$("#playerStatsMonth").addEventListener("change", renderPlayerStats);
$("#highlightsMonth").addEventListener("input", renderMonthlyHighlights);
$("#closeStats").addEventListener("click", () => $("#statsForm").classList.add("hidden"));
$("#statsForm").addEventListener("submit", event => {
  event.preventDefault();
  if (!adminMode) return;
  const player = state.players.find(item => item.id === $("#statsPlayerId").value);
  if (!player) return;
  const fields = { games: "statGames", wins: "statWins", draws: "statDraws", losses: "statLosses", goals: "statGoals", assists: "statAssists" };
  const totals = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, Number($(`#${field}`).value)]));
  if (Object.values(totals).some(value => !Number.isInteger(value) || value < 0 || value > 999)) return;
  if (totals.wins + totals.draws + totals.losses !== totals.games) { showToast("Jogos devem somar vitórias, empates e derrotas"); return; }
  const year = $("#annualRankingYear").value || currentYearValue();
  const yearMatches = state.matches.filter(match => typeof match.date === "string" && match.date.startsWith(`${year}-`));
  const recorded = rankingStatsForMatches(yearMatches).get(player.id) || emptyStats();
  const updates = {};
  for (const key of Object.keys(fields)) {
    updates[key] = totals[key] - (recorded[key] || 0);
    if (updates[key] < 0) { showToast("Para reduzir dados de um jogo registrado, exclua essa partida no histórico"); return; }
  }
  player.manualStatsByYear ??= {};
  player.manualStatsByYear[year] = { ...emptyStats(), ...updates, points: 3 * updates.wins + updates.draws };
  rebuildStats(); persist(); render();
  $("#statsForm").classList.add("hidden");
  showToast("Estatísticas individuais atualizadas");
});

$("#autoBalance").addEventListener("click", autoBalance);
$("#addFirstPlayer").addEventListener("click", () => { setTab("jogadores"); $("#playerName").focus(); });
$("#selectMonthly").addEventListener("click", async () => {
  if (!adminMode || currentRound()) return;
  const before = structuredClone(state);
  const count = selectMatchMonthlyMembers();
  if (!count) { showToast("Nenhum mensalista cadastrado para o mês da partida. Confira a aba Transparência."); return; }
  const saved = await persist();
  if (!saved) state = before;
  render(); showToast(saved ? "Mensalistas selecionados. Você pode desmarcar quem não vai jogar." : "Não foi possível salvar a seleção.");
});
$("#selectAll").addEventListener("click", () => {
  if (!adminMode || currentRound()) return;
  state.players.forEach(player => { player.available = true; });
  persist(); render();
});
$("#selectNone").addEventListener("click", () => {
  if (!adminMode || currentRound()) return;
  state.players.forEach(player => { player.available = false; player.team = null; player.fixedGoalkeeper = false; });
  persist(); render();
});
$("#clearTeams").addEventListener("click", () => {
  if (!adminMode || currentRound()) return;
  selectedSwapId = null;
  state.players.forEach(player => { player.team = null; });
  persist(); render(); showToast("Escalação limpa");
});

["A","B","C"].forEach(key => {
  $(`#team${key}Name`).addEventListener("input", event => updateTeamName(key,event.target.value));
  $(`#team${key}Name`).addEventListener("change", () => { if (adminMode) persist(); });
});
$("#matchDate").addEventListener("change", async event => {
  if (!adminMode) return;
  const before = structuredClone(state);
  const changed = state.matchDate !== event.target.value;
  state.matchDate = event.target.value;
  if (changed) selectMatchMonthlyMembers();
  $("#contributions").innerHTML = ""; $("#matchMvp").value = ""; $("#matchBolaMurcha").value = "";
  if (!await persist()) state = before;
  render();
});

$("#playerForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#playerName").value.trim();
  const rating = Number($("#playerRating").value);
  const editingId = $("#editingId").value;
  if (!name || rating < 1 || rating > 5) return;
  const duplicate = state.players.some(player => player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") && player.id !== editingId);
  if (duplicate) { showToast("Já existe um jogador com esse nome"); return; }
  const file = $("#playerPhoto").files[0];
  if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
    showToast("Escolha uma imagem JPG, PNG ou WebP de até 2 MB");
    return;
  }
  let player;
  let oldPhotoKey = null;
  if (editingId) {
    player = state.players.find(item => item.id === editingId);
    if (player) { oldPhotoKey = player.photoKey || null; player.name = name; player.rating = rating; }
  } else {
    player = { id: `p-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, rating, available: true, team: null, stats: emptyStats() };
    state.players.push(player);
  }
  (async () => {
    if (file) {
      try { player.photoKey = await uploadPlayerPhoto(player.id, file); }
      catch (error) { showToast(error.message); }
    }
    const saved = await persist();
    if (saved && file && oldPhotoKey && player.photoKey !== oldPhotoKey) await deletePlayerPhoto(player.id, oldPhotoKey);
    cancelEdit();
    render();
    if (!file || player.photoKey) showToast(editingId ? "Jogador atualizado" : "Jogador adicionado");
  })();
});
$("#cancelEdit").addEventListener("click", cancelEdit);
$("#removePlayerPhoto").addEventListener("click", async () => {
  const player = state.players.find(item => item.id === $("#editingId").value);
  if (!player?.photoKey) return;
  const oldPhotoKey = player.photoKey;
  player.photoKey = null;
  if (await persist()) {
    await deletePlayerPhoto(player.id, oldPhotoKey);
    $("#removePlayerPhoto").classList.add("hidden");
    render();
    showToast("Foto removida");
  } else player.photoKey = oldPhotoKey;
});

$("#scoreForm").addEventListener("submit", event => {
  event.preventDefault();
  if (!adminMode) return;
  if (activeTeamKeys().length === 3) { closeRound(); return; }
  const teamA = teamPlayers("A");
  const teamB = teamPlayers("B");
  if (!teamA.length || !teamB.length) { showToast("Monte as duas equipes antes de salvar"); return; }
  if (hasGoalkeeperConflict()) { showToast("Cada time pode ter apenas um goleiro fixo"); return; }
  const scoreA = Number($("#scoreA").value);
  const scoreB = Number($("#scoreB").value);
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) return;
  const contributions = {};
  for (const player of [...teamA, ...teamB]) {
    const goals = Number(document.querySelector(`[data-goals="${player.id}"]`).value);
    const assists = Number(document.querySelector(`[data-assists="${player.id}"]`).value);
    if (![goals, assists].every(value => Number.isInteger(value) && value >= 0 && value <= 99)) return;
    contributions[player.id] = { goals, assists };
  }
  const mvpPlayerId = $("#matchMvp").value;
  const bolaMurchaPlayerId = $("#matchBolaMurcha").value;
  const participantIds = new Set([...teamA, ...teamB].map(player => player.id));
  if (!participantIds.has(mvpPlayerId) || !participantIds.has(bolaMurchaPlayerId)) {
    showToast("Escolha um MVP e um Bagre entre os jogadores da partida");
    return;
  }
  for (const [team, score] of [[teamA, scoreA], [teamB, scoreB]]) {
    if (team.reduce((sum, player) => sum + contributions[player.id].goals, 0) > score) { showToast("Gols individuais não podem passar do placar do time"); return; }
    if (team.reduce((sum, player) => sum + contributions[player.id].assists, 0) > score) { showToast("Assistências não podem passar do placar do time"); return; }
  }
  const match = {
    id: `m-${Date.now()}`,
    date: state.matchDate,
    teamAName: state.teamAName,
    teamBName: state.teamBName,
    scoreA,
    scoreB,
    teamA: teamA.map(player => player.id),
    teamB: teamB.map(player => player.id),
    goalkeeperAId: teamA.find(player => player.fixedGoalkeeper)?.id || null,
    goalkeeperBId: teamB.find(player => player.fixedGoalkeeper)?.id || null,
    contributions,
    mvpPlayerId,
    bolaMurchaPlayerId
  };
  state.matches.unshift(match);
  applyMatchStats(match);
  persist();
  $("#scoreForm").reset();
  $("#contributions").innerHTML = "";
  render();
  showToast("Placar salvo e ranking atualizado");
});

$("#resetData").addEventListener("click", async () => {
  if (!confirm("Restaurar a lista inicial? Todas as alterações e partidas salvas no site serão apagadas.")) return;
  const response = await fetch("/api/seed");
  if (!response.ok) { showToast("Não foi possível restaurar agora"); return; }
  state = await response.json();
  persist();
  cancelEdit();
  $("#scoreForm").reset();
  $("#contributions").innerHTML = "";
  render();
  showToast("Lista inicial restaurada");
});

$$("[data-home-tab]").forEach(button => button.addEventListener("click", () => {
  setTab(button.dataset.homeTab);
  if (button.hasAttribute("data-home-history")) $(".history-card").scrollIntoView({ behavior: "smooth", block: "start" });
}));

render();
fetch("/api/session").then(response => response.json()).then(session => {
  if (session.admin) return enterAdmin();
  return loadRemote();
}).catch(() => loadRemote());



$("#saveRoundDraft").addEventListener("click", async () => {
  const round = currentRound(); if (!adminMode || !round || round.closed) return;
  const before = structuredClone(state);
  try {
    captureRoundEntries(round);
    if (!await persist()) { state = before; showToast("Não foi possível salvar os totais."); return; }
    showToast("Totais parciais salvos. Rankings atualizam ao fechar a rodada.");
  } catch(error) { state = before; showToast(error.message); }
});

$("#refreshTransparency").addEventListener("click", () => {
  const frame = $("#transparencySheet");
  frame.src = frame.getAttribute("src");
});

let artworkObjectUrl = null;
$("#toggleArtwork").addEventListener("click", () => {
  if (!adminMode) return;
  $("#artworkPanel").classList.toggle("hidden");
});
$("#generateArtwork").addEventListener("click", async () => {
  if (!adminMode) return;
  const button=$("#generateArtwork"); button.disabled=true;
  $("#downloadArtwork").classList.add("hidden");
  $("#artworkStatus").textContent="Carregando as fotos e montando a arte…";
  try {
    const data=artworkData();
    const photos=new Map();
    const logoUrl=$(".brand-logo").src;
    const logo=await loadArtworkImage(logoUrl);
    await Promise.all(data.teams.flatMap(team=>team.players).filter(player=>player.photoUrl).map(async player=>{photos.set(player.id,await loadArtworkImage(player.photoUrl));}));
    if(!adminMode)return;
    const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1920;
    drawTeamArtwork(canvas.getContext("2d"),data,{logo,photos});
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!blob)throw new Error("Não foi possível preparar o PNG. Tente novamente.");
    if(artworkObjectUrl)URL.revokeObjectURL(artworkObjectUrl);
    artworkObjectUrl=URL.createObjectURL(blob);
    $("#artworkPreview").src=artworkObjectUrl;$("#artworkPreview").classList.remove("hidden");
    const link=$("#downloadArtwork");link.href=artworkObjectUrl;link.download=`fc-bagres-times-${data.date}.png`;link.classList.remove("hidden");
    $("#artworkStatus").textContent="Arte pronta. Baixe o PNG em resolução original para postar.";
  }catch(error){$("#artworkStatus").textContent=error.message;showToast(error.message);}
  finally{button.disabled=false;}
});

$("#monthlyMembersMonth").addEventListener("change", renderMonthlyMembers);
