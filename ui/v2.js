/* 화면 시안 v2 공통 셸
 * - 라우트·단계마다 <html>의 화면 모드 클래스를 바꾼다(v2-home, v2-scene, v2-skin-<게임 id>).
 * - 큰 안내 창(dialog)을 만든다. 닫으면 연 버튼으로 포커스를 돌린다.
 * - 창작 게임의 장면(stage)을 등록받아 준비실 위에 그린다.
 *   KCP.v2.skin(id, { kicker, title, render(ctx) })
 *   render는 ctx.g(2D 컨텍스트, CSS px 단위), ctx.w, ctx.h, ctx.t(초), ctx.game, ctx.state,
 *   ctx.phase, ctx.thumb, ctx.reduced, ctx.scheme, ctx.model, ctx.root를 받고
 *   { caption, chips:[{label, value, tone}], animate } 를 돌려준다. 게임 상태는 읽기만 한다.
 * 장면은 장식과 요약을 겸한다. 조작은 모두 기존 게임 화면의 컨트롤로 한다.
 */
(function () {
  const KCP = window.KCP;
  const esc = KCP.esc;
  const html = document.documentElement;
  const V2 = KCP.v2 = KCP.v2 || {};
  const SKINS = V2.skins = V2.skins || {};
  const media = q => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
  const reduceQuery = media("(prefers-reduced-motion: reduce)");
  const darkQuery = media("(prefers-color-scheme: dark)");
  V2.reduced = () => !!reduceQuery.matches || html.classList.contains("v2-still");
  V2.scheme = () => html.dataset.theme === "dark" ? "dark" : html.dataset.theme === "light" ? "light" : darkQuery.matches ? "dark" : "light";
  V2.dpr = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  /* ---------- 화면 모드 ---------- */
  function clearModes() {
    Array.from(html.classList).forEach(c => { if (c.startsWith("v2-")) html.classList.remove(c); });
  }
  V2.clearModes = clearModes;

  /* ---------- 큰 안내 창 ---------- */
  // 네이티브 dialog의 showModal은 바깥을 비활성화하고 Esc로 닫힌다.
  V2.dialog = function ({ id, kicker, title, wide = false, className = "" }) {
    const d = document.createElement("dialog");
    d.id = id;
    d.className = `v2-modal${wide ? " wide" : ""}${className ? " " + className : ""}`;
    d.setAttribute("aria-labelledby", `${id}-title`);
    d.innerHTML = `<div class="v2-modal-frame">
      <header class="v2-modal-head"><div class="v2-modal-titles"><p class="v2-kicker">${esc(kicker)}</p><h2 id="${id}-title" class="v2-modal-title">${esc(title)}</h2></div>
        <button type="button" class="v2-close" data-v2-close aria-label="닫기"><span aria-hidden="true">✕</span></button></header>
      <div class="v2-modal-body"></div></div>`;
    let opener = null;
    d.addEventListener("close", () => {
      html.classList.remove("v2-modal-open");
      const back = opener;
      opener = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    });
    // 프레임 밖(배경)을 누르면 닫는다.
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
    d.querySelector("[data-v2-close]").onclick = () => d.close();
    return {
      el: d,
      body: d.querySelector(".v2-modal-body"),
      setTitle(text) { d.querySelector(".v2-modal-title").textContent = text; },
      open(from) {
        if (!d.isConnected) return;
        opener = from || document.activeElement;
        if (!d.open) d.showModal();
        html.classList.add("v2-modal-open");
        const first = d.querySelector("[data-v2-autofocus]");
        if (first) first.focus({ preventScroll: true });
      },
      close() { if (d.open) d.close(); }
    };
  };

  /* ---------- 캔버스 도구 ---------- */
  // 캔버스를 CSS 크기에 맞추고 DPR을 반영한 2D 컨텍스트를 돌려준다.
  V2.fit = function (canvas, w, h) {
    const dpr = V2.dpr();
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  };

  /* ---------- 창작 게임 장면(문서형 게임) ---------- */
  V2.skin = function (id, spec) { SKINS[id] = spec; };
  let stage = null;
  function stageCtx(st, now) {
    const spec = SKINS[st.id];
    const state = st.state || KCP.load(st.id);
    return {
      id: st.id, spec, g: st.g, w: st.w, h: st.h, t: (now - st.born) / 1000,
      state, game: state && typeof state.game === "object" && state.game ? state.game : {},
      phase: st.phase, thumb: false, reduced: V2.reduced(), scheme: V2.scheme(),
      model: KCP.games[st.id] && KCP.games[st.id].model, root: document.getElementById("phase")
    };
  }
  function paintStage(now) {
    const st = stage;
    if (!st) return;
    st.raf = 0;
    const box = st.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    st.w = box.width; st.h = box.height;
    st.g = V2.fit(st.canvas, st.w, st.h);
    let out = null;
    try {
      st.g.save();
      out = SKINS[st.id].render(stageCtx(st, now)) || {};
      st.g.restore();
    } catch (e) {
      // 장면은 보조 화면이다. 그리기 오류가 게임 조작을 막지 않도록 장면만 멈춘다.
      st.broken = true;
      V2.lastError = e;
      st.el.classList.add("v2-stage-broken");
      return;
    }
    if (out.caption && out.caption !== st.caption) {
      st.caption = out.caption;
      st.canvas.setAttribute("aria-label", out.caption);
    }
    const chips = Array.isArray(out.chips) ? out.chips : [];
    const sig = JSON.stringify(chips);
    if (sig !== st.chipSig) {
      st.chipSig = sig;
      st.hud.innerHTML = chips.map(c => `<span class="v2-stage-chip${c.tone ? " tone-" + esc(c.tone) : ""}"><span class="v2-stage-chip-k">${esc(c.label)}</span> <b class="num">${esc(c.value)}</b></span>`).join("");
    }
    if (out.animate && !V2.reduced() && st.visible && now < st.until) st.raf = requestAnimationFrame(paintStage);
  }
  function kick(ms = 5000) {
    const st = stage;
    if (!st || st.broken) return;
    st.until = Math.max(st.until, performance.now() + ms);
    if (!st.raf) st.raf = requestAnimationFrame(paintStage);
  }
  V2.kickStage = kick;
  function teardownStage() {
    if (!stage) return;
    if (stage.raf) cancelAnimationFrame(stage.raf);
    stage.off.forEach(f => f());
    stage = null;
  }
  function mountStage(id, phase, state) {
    const app = document.getElementById("app");
    let el = document.getElementById("v2-stage");
    if (!stage || stage.id !== id || !el || !app.contains(el)) {
      teardownStage();
      const spec = SKINS[id];
      el = document.createElement("section");
      el.id = "v2-stage";
      el.className = "v2-stage";
      el.setAttribute("aria-label", `${spec.title || "게임"} 장면`);
      el.innerHTML = `<canvas class="v2-stage-canvas" role="img" aria-label="${esc(spec.title || "게임 장면")}"></canvas>
        <div class="v2-stage-top"><p class="v2-stage-kicker">${esc(spec.kicker || "")}</p><p class="v2-stage-title">${esc(spec.title || "")}</p></div>
        <div class="v2-stage-hud"></div>`;
      const brief = KCP.$(".brief", app);
      if (brief) app.insertBefore(el, brief); else app.prepend(el);
      stage = { id, el, canvas: KCP.$("canvas", el), hud: KCP.$(".v2-stage-hud", el), born: performance.now(), until: 0, raf: 0, off: [], visible: true, chipSig: "", caption: "" };
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => kick(300));
        ro.observe(el);
        stage.off.push(() => ro.disconnect());
      }
      if (window.IntersectionObserver) {
        const io = new IntersectionObserver(entries => {
          entries.forEach(en => { if (stage) stage.visible = en.isIntersecting; });
          if (stage && stage.visible) kick(1500);
        });
        io.observe(el);
        stage.off.push(() => io.disconnect());
      }
    }
    stage.phase = phase;
    stage.state = state;
    el.dataset.phase = phase;
    kick(6000);
  }

  // 게임 화면에서 값을 바꾸면 장면을 다시 그린다(읽기 전용).
  let pend = 0;
  const onInput = e => {
    if (!stage || !e.target || !e.target.closest || !e.target.closest("#phase")) return;
    clearTimeout(pend);
    pend = setTimeout(() => kick(4000), 90);
  };
  ["input", "change", "click", "keyup"].forEach(type => document.addEventListener(type, onInput, true));
  new MutationObserver(() => kick(600)).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", () => kick(600));

  KCP.on("route:change", () => { teardownStage(); clearModes(); });
  KCP.on("storage:clear", () => kick(600));
  KCP.on("phase:change", ({ year, to, state }) => {
    if (!Object.hasOwn(SKINS, year)) return;
    html.classList.add("v2-skin", `v2-skin-${year}`);
    // phase:change는 단계 화면을 그리기 전에 온다. 화면이 생긴 뒤에 장면을 붙인다.
    mountStage(year, to, state);
  });
  KCP.on("prep:render", ({ year, state }) => {
    if (stage && stage.id === year) { stage.state = state; kick(6000); }
  });

  /* ---------- 홈 ---------- */
  // 창작 게임 카드 미리보기: 등록된 장면을 작은 캔버스에 한 번 그린다.
  function paintThumb(canvas, id) {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const g = V2.fit(canvas, box.width, box.height);
    try {
      if (id === "s-island-grid" && KCP.igScene) { KCP.igScene.paintStatic(canvas, { w: box.width, h: box.height, b: 4, thumb: true }); return; }
      const spec = SKINS[id];
      if (!spec) return;
      const state = KCP.load(id);
      g.save();
      spec.render({ id, spec, g, w: box.width, h: box.height, t: 0, state, game: state.game || {}, phase: "prep", thumb: true, reduced: true, scheme: V2.scheme(), model: KCP.games[id] && KCP.games[id].model, root: null });
      g.restore();
    } catch (e) { V2.lastError = e; }
  }
  let homeRO = null;
  KCP.on("home:render", ({ app }) => {
    html.classList.add("v2-home");
    const mast = KCP.$(".masthead", app);
    if (mast && !KCP.$(".v2-hero-art", mast)) {
      const art = document.createElement("div");
      art.className = "v2-hero-art";
      art.setAttribute("aria-hidden", "true");
      art.innerHTML = '<canvas class="v2-hero-canvas"></canvas><span class="v2-hero-tag">연습섬 IG-24 · 3D 장면</span>';
      mast.append(art);
      if (KCP.ORIGINAL_ORDER && KCP.ORIGINAL_ORDER.includes("s-island-grid") && KCP.YEARS["s-island-grid"]) {
        const cta = document.createElement("p");
        cta.className = "v2-hero-cta";
        cta.innerHTML = '<a class="v2-cta" href="#ys-island-grid">섬 전력망 24시 시작하기 <span aria-hidden="true">▶</span></a>' +
          (KCP.routes && KCP.routes.build ? '<a class="bd-home-link" href="#build">섬 전력망 건설 <small>GRID TYCOON 시안</small></a>' : "") +
          '<span class="v2-hero-note">새 화면 시안 · 창작 게임</span>';
        mast.append(cta);
      }
    }
    const thumbs = [];
    KCP.$$("#home-originals .opkg, .home-grid .pkg", app).forEach(card => {
      const id = (card.getAttribute("href") || "").replace(/^#y/, "");
      if (!(id === "s-island-grid" || Object.hasOwn(SKINS, id)) || KCP.$(".v2-thumb", card)) return;
      card.classList.add("v2-has-thumb");
      card.dataset.v2Game = id;
      const c = document.createElement("canvas");
      c.className = "v2-thumb";
      c.setAttribute("aria-hidden", "true");
      card.prepend(c);
      thumbs.push([c, id]);
    });
    const hero = KCP.$(".v2-hero-canvas", app);
    const leagueMap = KCP.$("#home-league-map", app);
    const paintAll = () => {
      if (hero && hero.isConnected && KCP.igScene) {
        const box = hero.getBoundingClientRect();
        if (box.width && box.height) KCP.igScene.paintStatic(hero, { w: box.width, h: box.height, b: 5, hero: true });
      }
      thumbs.forEach(([c, id]) => { if (c.isConnected) paintThumb(c, id); });
      if (leagueMap?.isConnected && leagueMap.clientWidth && KCP.paintLeaguePreview) KCP.paintLeaguePreview(leagueMap);
    };
    if (homeRO) homeRO.disconnect();
    homeRO = window.ResizeObserver ? new ResizeObserver(() => requestAnimationFrame(paintAll)) : null;
    if (homeRO && hero) homeRO.observe(hero);
    if (homeRO && leagueMap) homeRO.observe(leagueMap.parentElement);
    requestAnimationFrame(paintAll);
  });
})();
