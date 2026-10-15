// Camada de interface do FC Bagres D'Munique.
// Só cuida de movimento e detalhes visuais: não altera dados, regras ou chamadas
// ao servidor (isso tudo continua em app.js).
(() => {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Reinicia uma animação baseada em classe.
  function replayClass(element, className, duration = 1200) {
    if (!element || reducedMotion.matches) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    clearTimeout(element[`_${className}Timer`]);
    element[`_${className}Timer`] = setTimeout(() => element.classList.remove(className), duration);
  }

  // The current app has six public sections plus the admin roster.
  // Per-button state avoids the remake's fixed five-tab indicator.
  const updateNavigation = () => qsa('.tab').forEach(tab => {
    if (tab.classList.contains('active')) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  updateNavigation();
  qsa('.tab').forEach(tab => new MutationObserver(updateNavigation).observe(tab, {attributes:true,attributeFilter:['class']}));
  qs('#cancelPassword')?.addEventListener('click', () => qs('#adminToggle')?.focus());

  // ---------- Entrada das abas ----------
  // A aba visível toca a entrada; depois fica "assentada" para que edições
  // dentro dela não repitam a animação.
  const SETTLE_AFTER = 1700;
  const SETTLE_CAP = 3600;
  const viewState = new WeakMap();

  function settleLater(view, { reset = false } = {}) {
    if (reducedMotion.matches) { view.classList.add("settled"); return; }
    const state = viewState.get(view) || {};
    if (reset || !state.startedAt) state.startedAt = performance.now();
    clearTimeout(state.timer);
    const remainingCap = Math.max(0, SETTLE_CAP - (performance.now() - state.startedAt));
    state.timer = setTimeout(() => view.classList.add("settled"), Math.min(SETTLE_AFTER, remainingCap));
    viewState.set(view, state);
  }

  function unsettle(view) {
    view.classList.remove("settled");
    settleLater(view, { reset: true });
  }

  const views = qsa(".view");
  views.forEach(view => {
    viewState.set(view, { active: view.classList.contains("active") });
    if (view.classList.contains("active")) settleLater(view, { reset: true });
    new MutationObserver(() => {
      const state = viewState.get(view);
      const active = view.classList.contains("active");
      if (active === state.active) return;
      state.active = active;
      if (active) unsettle(view);
      else { clearTimeout(state.timer); view.classList.remove("settled", "replaying"); }
    }).observe(view, { attributes: true, attributeFilter: ["class"] });
    // Enquanto a entrada toca, conteúdo que chega do servidor também entra animado.
    new MutationObserver(() => {
      if (view.classList.contains("active") && !view.classList.contains("settled")) settleLater(view);
    }).observe(view, { childList: true, subtree: true });
  });

  // Entrar/sair do modo admin muda bastante a tela: toca a entrada de novo.
  let wasAdmin = document.body.classList.contains("admin-mode");
  new MutationObserver(() => {
    const isAdmin = document.body.classList.contains("admin-mode");
    if (isAdmin === wasAdmin) return;
    wasAdmin = isAdmin;
    const active = qs(".view.active");
    if (active) unsettle(active);
    const crest = qs(".brand-crest");
    replayClass(crest, "shine", 1200);
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Filtros e ordenação: os itens novos entram em sequência.
  const replayTargets = [
    ["#monthlyRankingSort, #monthlyRankingMonth", el => el.closest(".ranking-card")],
    ["#annualRankingSort, #annualRankingYear", el => el.closest(".ranking-card")],
    ["#playerStatsSelect, #playerStatsYear, #playerStatsPeriod, #playerStatsMonth", () => qs("#stats")],
    ["#highlightsMonth", () => qs("#destaques .monthly-grid")]
  ];
  document.addEventListener("change", event => {
    for (const [selector, target] of replayTargets) {
      if (event.target.matches?.(selector)) replayClass(target(event.target), "replaying", 1600);
    }
  });

  // ---------- Partida ----------
  // Placar de confirmados pulsa quando muda.
  const playerCount = qs("#playerCount");
  let lastCount = playerCount?.textContent;
  if (playerCount) {
    new MutationObserver(() => {
      if (playerCount.textContent === lastCount) return;
      lastCount = playerCount.textContent;
      replayClass(playerCount.closest(".hero-stat"), "bump", 600);
    }).observe(playerCount, { childList: true, characterData: true, subtree: true });
  }

  // Marcar/desmarcar: o app recria a lista, então animamos a caixa nova.
  document.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
    const key = ["available", "keeper"].find(name => input.dataset[name]);
    if (!key) return;
    requestAnimationFrame(() => {
      const fresh = qs(`[data-${key}="${CSS.escape(input.dataset[key])}"]`);
      replayClass(fresh, "just-toggled", 450);
    });
  });

  // Equilibrar times: jogadores entram em sequência e o VS pulsa.
  document.addEventListener("click", event => {
    if (!event.target.closest?.("#autoBalance")) return;
    replayClass(qs(".teams-grid"), "replaying", 1600);
    replayClass(qs(".versus"), "kick", 1100);
  });

  // Troca entre times: destaca os dois jogadores que trocaram.
  let swapBefore = null;
  const teamOf = id => ["A", "B", "C"].find(team => qs(`#team${team}List [data-swap="${CSS.escape(id)}"]`)) || null;
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-swap]");
    if (!button) return;
    const selected = qs(".team-player.swap-selected [data-swap]")?.dataset.swap || null;
    swapBefore = { clicked: button.dataset.swap, selected, clickedTeam: teamOf(button.dataset.swap) };
  }, true);
  document.addEventListener("click", event => {
    if (!event.target.closest?.("[data-swap]") || !swapBefore) return;
    const { clicked, selected, clickedTeam } = swapBefore;
    swapBefore = null;
    if (!selected || selected === clicked || teamOf(clicked) === clickedTeam) return;
    [clicked, selected].forEach(id => replayClass(qs(`[data-swap="${CSS.escape(id)}"]`)?.closest(".team-player"), "just-swapped", 1100));
  });

  // Destaques: todos os empatados em 1º ganham o destaque dourado.
  const markLeaders = list => qsa(".monthly-row", list).forEach(row => {
    row.classList.toggle("lead", qs(".monthly-position", row)?.textContent.trim().startsWith("1º") ?? false);
  });
  qsa(".monthly-list").forEach(list => {
    markLeaders(list);
    new MutationObserver(() => markLeaders(list)).observe(list, { childList: true });
  });

  // ---------- Avisos ----------
  const toast = qs("#toast");
  const passwordForm = qs("#passwordForm");
  if (toast) {
    new MutationObserver(() => {
      const message = toast.textContent || "";
      if (!toast.classList.contains("show")) return;
      if (/Senha incorreta|Muitas tentativas/.test(message) && !passwordForm.classList.contains("hidden")) replayClass(passwordForm, "shake", 550);
      if (/Placar salvo/.test(message)) celebrate();
      if (/Times equilibrados/.test(message)) replayClass(qs(".brand-crest"), "shine", 1200);
    }).observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  // Confete nas cores do clube quando um placar é salvo.
  function celebrate() {
    if (reducedMotion.matches) return;
    const colors = ["#d90a1c", "#f8f5f3", "#0b63b9", "#d8b46e", "#ef2333", "#f2dba4"];
    const button = qs('#scoreForm button[type="submit"]')?.getBoundingClientRect();
    const visible = button && button.width && button.top > 0 && button.bottom < window.innerHeight;
    const x = visible ? button.left + button.width / 2 : window.innerWidth / 2;
    const y = visible ? button.top : window.innerHeight * .45;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 80; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti";
      const side = Math.random() * 2 - 1;
      piece.style.left = `${x}px`;
      piece.style.top = `${y}px`;
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--dx", `${side * (60 + Math.random() * 300)}px`);
      piece.style.setProperty("--up", `${-(140 + Math.random() * 260)}px`);
      piece.style.setProperty("--dy", `${120 + Math.random() * 320}px`);
      piece.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 900}deg`);
      piece.style.animationDelay = `${Math.random() * 120}ms`;
      if (i % 3 === 0) { piece.style.width = "7px"; piece.style.height = "7px"; piece.style.borderRadius = "50%"; }
      fragment.append(piece);
    }
    document.body.append(fragment);
    setTimeout(() => qsa(".confetti").forEach(piece => piece.remove()), 2100);
    replayClass(qs(".brand-crest"), "shine", 1200);
  }

  // ---------- Diálogo da diretoria ----------
  if (passwordForm) {
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !passwordForm.classList.contains("hidden")) qs("#cancelPassword")?.click();
    });
    // Clique fora do diálogo (no fundo escurecido) fecha.
    document.addEventListener("click", event => {
      if (event.target === document.body && !passwordForm.classList.contains("hidden")) qs("#cancelPassword")?.click();
    });
  }

  // ---------- Escudo ----------
  const crest = qs(".brand-crest");
  crest?.addEventListener("click", () => replayClass(crest, "shine", 1200));
})();
