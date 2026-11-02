/* 2022 미션 켄텍 · 도시 전력 지도(CITY POWER MAP)
 * 위에서 내려다본 16비트 도시 건설 게임의 화면 문법을 빌린 장면이다. 10×10 KENTECH 지도를 타일(바다·풀밭·호수·
 * 산·농경지·숲·습지·유전·문화재)로 깔고, 학생이 지도에 세운 발전소(화석·원자력·풍력·태양광)를 픽셀 건물로,
 * 2번 문제의 연결을 가로·세로 전봇대 전선으로, 마을의 불빛을 공급량으로 그린다. 옆에는 메뉴 창(발전소·마을)과
 * 조언 창을 둔다.
 * 게임 상태(state.game)는 읽기만 한다. 지도·발전 설비 자료는 g2022.js의 model.data에서 읽는다.
 * 면접실은 현재 질문에 맞는 학생 계획과 관련 발전소·경로·마을을 강조한다. 현재 질문은 메모리에만 둔다.
 * 성찰 단계의 예시 답변 배치는 읽지도 그리지도 않는다.
 * 그리기: 작은 픽셀 버퍼에 정수 좌표로 칠한 뒤 최근접 보간으로 키운다. 지형은 크기·밤낮·자료가 바뀔 때 다시 그린다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  const ID = "2022";
  // ctx.model의 동결된 지도·발전 설비 자료를 참조한다. 자료 값의 사본은 두지 않는다.
  let data = null;
  const villages = () => Object.entries(data.VILL).map(([n, v]) => ({ n, ...v }));
  const DV = { S: [1, 0], SW: [1, -1], W: [0, -1], N: [-1, 0], E: [0, 1] };
  // 장면 메뉴에만 쓰는 짧은 이름. 정식 이름·생산·비용은 data.PT를 읽는다.
  const SHORT = { fossil: "화석 연료", nuclear: "원자력", wind: "풍력", solar: "태양광" };
  const TYPES = ["fossil", "nuclear", "wind", "solar"];
  const OVN = { map: "지도", solar: "평균 일사량", wind: "평균 풍속·풍향", current: "평균 해류 방향" };

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rc = id => [data.ROWS.indexOf(id[0]), Number(id.slice(1)) - 1];
  const idOf = (r, c) => (r >= 0 && r < 10 && c >= 0 && c < 10 ? data.ROWS[r] + (c + 1) : null);
  const terr = (r, c) => (r < 0 || r > 9 || c < 0 || c > 9 ? "sea" : { "~": "sea", ".": "land", o: "lake" }[data.TERR[r][c]]);
  const outOf = (type, id) => { const [r, c] = rc(id); return type === "wind" ? data.WIND[r][c] : type === "solar" ? data.SOLAR[r] : data.PT[type].out; };
  function hash(x, y, s) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  // 게임의 영향 분석과 같은 규칙: 풍향을 따라 4칸
  function smogPath(id) {
    const path = [];
    let cur = id;
    for (let i = 0; i < 4; i++) {
      const [r, c] = rc(cur);
      const d = DV[data.WDIR[r][c]];
      cur = idOf(r + d[0], c + d[1]);
      if (!cur) break;
      path.push(cur);
    }
    return path;
  }

  const orth = id => {
    const [r, c] = rc(id);
    return [idOf(r - 1, c), idOf(r + 1, c), idOf(r, c - 1), idOf(r, c + 1)].filter(Boolean);
  };
  // 게임과 같은 해류 읽기: 인접한 바다에서 분기를 따라 최대 60개 해역.
  function currentPath(id) {
    const sea = cell => { const [r, c] = rc(cell); return terr(r, c) === "sea"; };
    const queue = orth(id).filter(sea), seen = new Set();
    while (queue.length && seen.size < 60) {
      const cell = queue.shift();
      if (seen.has(cell) || !sea(cell)) continue;
      seen.add(cell);
      const direction = data.CURR[cell];
      if (!direction) continue;
      (direction === "NS" ? ["N", "S"] : [direction]).forEach(dir => {
        const [r, c] = rc(cell), d = DV[dir], next = idOf(r + d[0], c + d[1]);
        if (next && !seen.has(next)) queue.push(next);
      });
    }
    return [...seen];
  }

  /* ---------- 좁은 화면 면접실의 문제 상황·장면 위치 ----------
   * 질문 카드 다음에 문제 상황과 장면을 둔다. 원래 자리는 표시점으로 기억해 시간 안내 등 주변 요소의
   * 상대 순서를 보존한다. 표시점은 화면·접근성 트리에 나타나지 않으며 저장값에도 넣지 않는다. */
  const narrowQuery = window.matchMedia ? window.matchMedia("(max-width: 760px)") : null;
  let stageHome = null;
  function restoreStage() {
    if (!stageHome) return;
    const { app, el, brief, stageSlot, briefSlot } = stageHome;
    if (stageSlot.parentNode === app && el.parentNode === app) stageSlot.after(el);
    if (briefSlot.parentNode === app && brief.parentNode === app) briefSlot.after(brief);
  }
  function clearStageHome() {
    restoreStage();
    if (stageHome) {
      stageHome.stageSlot.remove();
      stageHome.briefSlot.remove();
      stageHome = null;
    }
  }
  function placeStage(phase) {
    const el = document.getElementById("v2-stage"), app = document.getElementById("app"), main = document.getElementById("phase");
    if (!el || !app || !main || !app.contains(el) || !document.documentElement.classList.contains("v2-skin-" + ID)) return;
    const brief = app.querySelector(".brief");
    if (!brief || brief.parentNode !== app || el.parentNode !== app || main.parentNode !== app) return;
    if (!stageHome || stageHome.el !== el || stageHome.brief !== brief) {
      clearStageHome();
      const stageSlot = document.createComment("2022 장면 원래 위치"), briefSlot = document.createComment("2022 문제 상황 원래 위치");
      el.before(stageSlot);
      brief.before(briefSlot);
      stageHome = { app, el, brief, stageSlot, briefSlot };
    }
    if (phase === "room" && narrowQuery && narrowQuery.matches) {
      if (main.nextElementSibling !== brief) main.after(brief);
      if (brief.nextElementSibling !== el) brief.after(el);
    } else restoreStage();
  }
  if (narrowQuery) {
    const replace = () => { const el = document.getElementById("v2-stage"); if (el && el.dataset.phase) placeStage(el.dataset.phase); };
    if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", replace);
    else if (narrowQuery.addListener) narrowQuery.addListener(replace);
  }

  /* ---------- 면접실의 현재 질문(저장하지 않는 메모리) ---------- */
  let questionIndex = 0, offRoom = null;
  function clearQuestion() {
    if (offRoom) offRoom();
    offRoom = null;
    questionIndex = 0;
  }
  if (typeof KCP.on === "function") {
    KCP.on("route:change", () => { clearQuestion(); clearStageHome(); });
    KCP.on("phase:change", ({ year, to } = {}) => {
      clearQuestion();
      if (year === ID) placeStage(to);
      else clearStageHome();
    });
    KCP.on("room:render", ({ year, root }) => {
      clearQuestion();
      if (year !== ID || !root) return;
      placeStage("room");
      const follow = event => {
        const card = event.target?.closest?.(".qdeck .qcard");
        const answer = card && card.querySelector("textarea[data-a]");
        const index = answer ? Number(answer.dataset.a) : NaN;
        if (Number.isInteger(index) && index >= 0) questionIndex = index;
        // 클릭의 기본 처리(peer.cur 갱신)가 끝난 다음 프레임에 읽는다.
        KCP.v2.kickStage?.(600);
      };
      root.addEventListener("focusin", follow, true);
      root.addEventListener("click", follow, true);
      offRoom = () => {
        root.removeEventListener("focusin", follow, true);
        root.removeEventListener("click", follow, true);
      };
    });
  }
  function currentQuestion(ctx, G) {
    if (ctx.thumb || ctx.phase !== "room") return null;
    const game = KCP.games?.[ID];
    if (!game || typeof game.questions !== "function") return null;
    // questions()는 game을 정규화해서 대입하므로 상태 사본으로 조회한다.
    const qs = game.questions({ ...ctx.state, game: G });
    const main = ctx.root?.querySelector("#room-main"), alt = ctx.root?.querySelector("#room-alt");
    let index = questionIndex;
    if (alt && !alt.hidden && main?.hidden) {
      const peer = ctx.state?.ext?.peer && (typeof KCP.ext === "function" ? KCP.ext(ctx.state, "peer", {}) : ctx.state.ext.peer);
      index = peer?.cur;
    }
    index = Number.isInteger(index) && index >= 0 && index < qs.length ? index : 0;
    const q = qs[index];
    return q ? { index, key: typeof KCP.qkey === "function" ? KCP.qkey(q) : q.k, tag: q.tag || "", official: q.src === "report" } : null;
  }

  function focusOf(question, plants) {
    const focus = { plants: [], air: [], sea: [], villages: [], cost: false };
    if (!question) return focus;
    const key = question.key;
    if (key === "22-q1-nuc" || key === "22-q1-fos") {
      focus.plants = plants.filter(p => p.type === (key === "22-q1-nuc" ? "nuclear" : "fossil"));
      focus.air = focus.plants.flatMap(p => smogPath(p.cell));
      if (key === "22-q1-nuc") focus.sea = focus.plants.flatMap(p => currentPath(p.cell));
    } else if (key === "22-q2-cost") focus.cost = true;
    else if (key === "22-q2-one") focus.plants = plants;
    else if (key === "22-div-typhoon") focus.plants = plants.filter(p => p.type === "wind" &&
      [p.cell, ...orth(p.cell)].some(cell => { const [r, c] = rc(cell); return terr(r, c) === "sea"; }));
    else if (key === "22-hum-vote") focus.villages = ["빛가람"];
    else if (key === "22-hum-future") focus.villages = ["배멧", "참살이"];
    return focus;
  }

  /* ---------- 상태 읽기(읽기 전용) ---------- */
  function read(ctx) {
    const M = ctx.model || KCP.games?.[ID]?.model;
    const D = M?.data || KCP.games?.[ID]?.model?.data;
    if (!M || !D) return null;
    data = D;
    const G = M.normalizeGame(ctx.game);
    const { overlay, tool, q1, q2 } = G;
    const question = currentQuestion(ctx, G);
    let mode = G.mode;
    if (question) {
      if (question.key.startsWith("22-q1")) mode = "q1";
      else if (question.key.startsWith("22-q2")) mode = "q2";
      else mode = q2.length ? "q2" : "q1";
    }
    const plants = mode === "q1" ? TYPES.filter(k => q1[k]).map(k => ({ type: k, cell: q1[k], to: null })) : q2;
    const empty = !!question && !plants.length;
    const s = M.supply(q2, empty ? [] : G.wires);
    const count = { fossil: 0, nuclear: 0, wind: 0, solar: 0 };
    q2.forEach(p => { count[p.type] += 1; });
    const met = villages().filter(v => s.got[v.n] >= v.need).length;
    return { mode, overlay: question ? "map" : overlay, tool, q1, q2, plants, question, empty, focus: focusOf(question, plants), got: s.got, wire: s.wire,
      edges: s.edges, cost: s.plantCost, total: s.total, count, met };
  }

  /* ---------- 색 ---------- */
  const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const rgb = c => "rgb(" + (clamp(c[0], 0, 255) | 0) + "," + (clamp(c[1], 0, 255) | 0) + "," + (clamp(c[2], 0, 255) | 0) + ")";
  const palCache = {};
  function palette(dark) {
    const key = dark ? "d" : "l";
    if (palCache[key]) return palCache[key];
    // 밝은 화면은 낮의 도시, 어두운 화면은 밤의 도시(파랗게 가라앉힌 색 + 노란 불빛)
    const night = c => [c[0] * 0.5 + 6, c[1] * 0.56 + 12, c[2] * 0.62 + 38];
    const C = s => rgb(dark ? night(hex(s)) : hex(s));
    palCache[key] = {
      dark,
      deep: C("#2c6db0"), deep2: C("#2766a8"), deepHi: C("#5a9ad8"),
      sea: C("#3a8ad2"), sea2: C("#4597dd"), seaHi: C("#a6d6ff"), foam: C("#e4f4ff"),
      lake: C("#4aa9da"), lake2: C("#5bb6e2"),
      sand: C("#e8d49a"), sand2: C("#d6bf80"),
      grass: C("#5fae4a"), grass2: C("#6cbb55"), grassDk: C("#468e3a"), flower: C("#f4e6a0"),
      mtn: C("#8c7a5e"), mtnDk: C("#6a5a44"), mtnLt: C("#b4a286"), snow: C("#f4f4f0"),
      soil: C("#a87a46"), crop: C("#d9bb4c"), crop2: C("#93c04a"),
      tree: C("#2f7a3a"), treeDk: C("#225c2c"), treeLt: C("#4a9a4c"), trunk: C("#6a4424"), deer: C("#b0703a"),
      reed: C("#9cbf5c"), reedDk: C("#6e9440"), marsh: C("#5aa2a0"), bird: C("#fbfbf6"),
      fish: C("#1f5f9e"), fishLt: C("#7fc0f0"), whale: C("#24486e"), whaleLt: C("#5e86ad"),
      oil: C("#222228"), oilLt: C("#4a4a56"), rig: C("#b0b4bc"), rigDk: C("#6e7480"),
      roof: C("#c24a32"), roof2: C("#3a62b8"), wall: C("#f2e8d2"), wallDk: C("#c8b894"), road: C("#7c7c84"), roadLn: C("#e8e0b0"),
      winOff: dark ? "rgb(18,24,44)" : "rgb(70,82,108)", winOn: "rgb(255,222,96)", glow: "rgba(255,214,90,",
      pagoda: C("#b5402a"), pagodaDk: C("#7a2a1c"), stone: C("#c8c0b0"),
      pad: C("#b9b8b0"), padDk: C("#8e8d86"), metal: C("#d8dade"), metalDk: C("#8a8e98"),
      stackR: C("#c8362a"), stackW: C("#f0ece4"), factory: C("#6c6c78"), factoryDk: C("#4e4e58"),
      dome: C("#e6e6e2"), domeDk: C("#a8a8a4"), tower: C("#cfcbc0"), towerDk: C("#9a968c"),
      panel: C("#2b56b8"), panelLt: C("#8fb6ff"), panelDk: C("#1a2c5a"),
      blade: dark ? "rgb(214,222,240)" : "rgb(250,250,252)", towerW: dark ? "rgb(170,180,204)" : "rgb(236,238,242)",
      pole: dark ? "rgb(150,120,90)" : "rgb(92,62,34)", wire: dark ? "rgb(255,214,110)" : "rgb(40,40,46)", spark: "rgb(255,246,160)",
      smoke: dark ? "rgba(150,150,164," : "rgba(96,90,92,", steam: dark ? "rgba(210,220,240," : "rgba(255,255,255,",
      frame: dark ? "rgb(4,8,24)" : "rgb(27,37,80)",
      // 메뉴 창(SNES 시대 창): 밝은 화면은 크림색 창 + 남색 테두리, 어두운 화면은 파란 띠 창 + 흰 테두리
      wOuter: dark ? "rgb(4,8,24)" : "rgb(27,37,80)", wRing: dark ? "rgb(236,240,250)" : "rgb(27,37,80)",
      wInner: dark ? "rgb(120,140,190)" : "rgb(255,255,255)",
      wBands: dark ? ["rgb(40,72,170)", "rgb(30,58,148)", "rgb(22,46,124)", "rgb(16,36,104)"] : ["rgb(252,247,230)"],
      wDither: dark ? "" : "rgb(244,236,210)",
      ink: dark ? "#ffffff" : "#1b2550", ink2: dark ? "#d6def5" : "#3a4266", hi: dark ? "#ffe27a" : "#8a3a00",
      okC: dark ? "#9cf0b0" : "#1d6a2e", badC: dark ? "#ffb4a6" : "#a42a1c",
      empty: dark ? "rgba(255,255,255,0.2)" : "rgba(27,37,80,0.16)"
    };
    return palCache[key];
  }

  /* ---------- 픽셀 그리기 ---------- */
  function rect(A, x, y, w, h, col) {
    const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + w), y1 = Math.round(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    A.c.fillStyle = col;
    A.c.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  // 타일 안 16칸 설계 좌표 → 버퍼 픽셀
  function sprite(A, x0, y0, T) {
    const u = T / 16;
    const f = v => Math.round(v * u);
    return (sx, sy, sw, sh, col) => {
      const a = f(sx), b = f(sy);
      const w = Math.max(1, f(sx + sw) - a), h = Math.max(1, f(sy + sh) - b);
      A.c.fillStyle = col;
      A.c.fillRect(x0 + a, y0 + b, w, h);
    };
  }
  function line(A, x0, y0, x1, y1, col) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy, n = 0;
    A.c.fillStyle = col;
    for (;;) {
      A.c.fillRect(x0, y0, 1, 1);
      if ((x0 === x1 && y0 === y1) || n++ > 4000) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  function makeBuf(cv, W, H) {
    if (!cv) cv = document.createElement("canvas");
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const c = cv.getContext("2d");
    c.imageSmoothingEnabled = false;
    return { cv, c, W, H };
  }
  // 2×2 체크 무늬(디더링)
  const patCache = {};
  function checker(A, col) {
    if (!patCache[col]) {
      const cv = document.createElement("canvas");
      cv.width = 2; cv.height = 2;
      const c = cv.getContext("2d");
      c.fillStyle = col;
      c.fillRect(0, 0, 1, 1);
      c.fillRect(1, 1, 1, 1);
      patCache[col] = cv;
    }
    return A.c.createPattern(patCache[col], "repeat");
  }

  /* ---------- 배치 ---------- */
  function layout(w, h, dpr, thumb) {
    // 버퍼 픽셀 한 칸의 크기(장치 픽셀). 넉넉한 화면은 2배로 키워 굵은 픽셀을 만든다.
    const big = !thumb && h >= 190;
    const k = Math.max(1, Math.round(dpr * (big ? 2 : 1)));
    const cs = k / dpr;
    const W = Math.max(8, Math.ceil(w / cs)), H = Math.max(8, Math.ceil(h / cs));
    const narrow = w < 560;
    const labels = !thumb && !narrow && h >= 150;
    const pad = Math.max(2, Math.round((thumb ? 6 : narrow ? 5 : 8) / cs));
    const gut = labels ? Math.round(14 / cs) : 0;
    const T = Math.max(5, Math.floor((H - pad * 2 - gut) / 10));
    const M = T * 10;
    const mapCss = (M + gut) * cs;
    const side = thumb ? 0 : narrow ? w - mapCss - pad * cs * 2 - 6 : Math.min(720, w - mapCss - pad * cs * 2 - 24);
    const hasPanel = !thumb && side >= 150;
    let mx;
    if (!hasPanel) mx = Math.round((W - M - gut) / 2) + gut;
    else {
      const total = mapCss + (narrow ? 6 : 18) + side;
      const left = narrow ? pad * cs : Math.max(pad * cs, (w - total) / 2);
      mx = Math.round(left / cs) + gut;
    }
    const my = Math.round((H - M - gut) / 2) + gut;
    const panel = hasPanel ? { x: (mx + M) * cs + (narrow ? 6 : 18), y: pad * cs, w: side, h: h - pad * cs * 2 } : null;
    return { k, cs, W, H, T, M, mx, my, gut, labels, narrow, panel };
  }

  /* ---------- 지형 ---------- */
  function paintGround(A, L, P) {
    const { W, H, T, M, mx, my } = L;
    // 지도 밖 먼바다
    rect(A, 0, 0, W, H, P.deep);
    A.c.fillStyle = checker(A, P.deep2);
    A.c.fillRect(0, 0, W, H);
    for (let y = 2; y < H; y += 7) {
      for (let x = 0; x < W; x += 11) {
        const hs = hash(x, y, 7);
        if (hs < 0.12) rect(A, x + Math.floor(hs * 60), y, 3, 1, P.deepHi);
      }
    }
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const x = mx + c * T, y = my + r * T, t = terr(r, c);
        if (t === "sea") {
          rect(A, x, y, T, T, P.sea);
          A.c.fillStyle = checker(A, P.sea2);
          A.c.fillRect(x, y + Math.floor(T / 2), T, Math.ceil(T / 2));
          const hs = hash(r, c, 3);
          rect(A, x + Math.floor(hs * (T - 4)), y + Math.floor(T * 0.3), Math.max(2, Math.round(T * 0.22)), 1, P.seaHi);
        } else if (t === "lake") {
          rect(A, x, y, T, T, P.lake);
          A.c.fillStyle = checker(A, P.lake2);
          A.c.fillRect(x, y, T, Math.ceil(T / 2));
        } else {
          rect(A, x, y, T, T, P.grass);
          A.c.fillStyle = checker(A, P.grass2);
          A.c.fillRect(x + ((r + c) % 2 ? 0 : Math.floor(T / 2)), y, Math.ceil(T / 2), T);
          for (let i = 0; i < 4; i++) {
            const hx = hash(r * 10 + c, i, 5), hy = hash(r * 10 + c, i, 9);
            rect(A, x + 1 + Math.floor(hx * (T - 3)), y + 1 + Math.floor(hy * (T - 3)), 1, 1, i === 0 ? P.flower : P.grassDk);
          }
        }
      }
    }
    // 물가: 육지 쪽 모래 띠와 바다 쪽 물거품
    const sb = Math.max(1, Math.round(T / 9));
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (terr(r, c) !== "land") continue;
        const x = mx + c * T, y = my + r * T;
        if (terr(r - 1, c) !== "land") { rect(A, x, y, T, sb, P.sand); rect(A, x, y - 1, T, 1, P.foam); }
        if (terr(r + 1, c) !== "land") { rect(A, x, y + T - sb, T, sb, P.sand2); rect(A, x, y + T, T, 1, P.foam); }
        if (terr(r, c - 1) !== "land") { rect(A, x, y, sb, T, P.sand); rect(A, x - 1, y, 1, T, P.foam); }
        if (terr(r, c + 1) !== "land") { rect(A, x + T - sb, y, sb, T, P.sand2); rect(A, x + T, y, 1, T, P.foam); }
      }
    }
    Object.keys(data.FEAT).forEach(id => {
      const [r, c] = rc(id);
      feature(A, data.FEAT[id], mx + c * T, my + r * T, T, P, terr(r, c));
    });
    // 지도 테두리
    A.c.strokeStyle = P.frame;
    A.c.lineWidth = 1;
    A.c.strokeRect(mx - 0.5, my - 0.5, M + 1, M + 1);
  }

  function feature(A, f, x, y, T, P, ter) {
    const s = sprite(A, x, y, T);
    if (f === "mtn") {
      s(1, 7, 8, 7, P.mtnDk); s(2, 5, 6, 2, P.mtnDk); s(3, 3, 4, 2, P.mtn); s(4, 2, 2, 1, P.snow); s(3, 3, 2, 2, P.snow);
      s(3, 5, 5, 3, P.mtn); s(2, 8, 3, 5, P.mtnLt);
      s(8, 9, 7, 5, P.mtnDk); s(9, 7, 5, 2, P.mtn); s(10, 6, 3, 1, P.snow); s(9, 9, 3, 4, P.mtnLt);
    } else if (f === "farm") {
      s(1, 1, 14, 14, P.soil);
      for (let i = 0; i < 4; i++) s(2, 2 + i * 3.4, 12, 1.6, i % 2 ? P.crop2 : P.crop);
    } else if (f === "deer") {
      [[2, 2], [9, 1], [1, 9], [10, 8]].forEach(([a, b]) => { s(a, b, 5, 4, P.tree); s(a + 1, b - 1, 3, 1, P.treeLt); s(a + 1, b + 4, 3, 1, P.treeDk); s(a + 2, b + 5, 1, 1.5, P.trunk); });
      s(6, 9, 4, 2, P.deer); s(9, 7, 1.5, 2, P.deer); s(6, 11, 1, 2, P.deer); s(9, 11, 1, 2, P.deer);
    } else if (f === "bird") {
      s(1, 2, 14, 12, P.marsh);
      const u = T / 16;
      A.c.fillStyle = checker(A, P.reed);
      A.c.fillRect(Math.round(x + u), Math.round(y + 2 * u), Math.round(14 * u), Math.round(12 * u));
      [[2, 9], [5, 11], [11, 10], [13, 5], [3, 4]].forEach(([a, b]) => { s(a, b, 1, 3, P.reedDk); s(a + 1, b - 1, 1, 3, P.reedDk); });
      s(7, 5, 3, 1.2, P.bird); s(9, 4, 1.2, 1.2, P.bird); s(6, 4.5, 1, 1, P.bird);
    } else if (f === "heritage") {
      s(3, 12, 10, 2, P.stone); s(5, 7, 6, 5, P.pagodaDk); s(6, 8, 1, 4, P.stone); s(9, 8, 1, 4, P.stone);
      s(3, 5, 10, 2, P.pagoda); s(5, 3, 6, 2, P.pagoda); s(7, 1, 2, 2, P.pagodaDk);
    } else if (f === "oil") {
      if (ter === "sea") { s(2, 9, 12, 3, P.rigDk); s(3, 12, 1, 3, P.rigDk); s(12, 12, 1, 3, P.rigDk); s(2, 8, 12, 1, P.rig); }
      else { s(2, 10, 12, 5, P.oil); s(3, 11, 4, 2, P.oilLt); }
      s(6, 2, 1, 8, P.rigDk); s(9, 2, 1, 8, P.rigDk); s(6, 4, 4, 1, P.rig); s(6, 7, 4, 1, P.rig); s(7, 1, 2, 1, P.rig);
    } else if (f === "fish") {
      [[3, 4], [9, 9]].forEach(([a, b], i) => { s(a, b, 4, 2, i ? P.fishLt : P.fish); s(a + 4, b - 0.5, 1.5, 3, i ? P.fishLt : P.fish); });
    } else if (f === "whale") {
      s(3, 7, 9, 3, P.whale); s(4, 6, 6, 1, P.whaleLt); s(12, 5, 1.5, 3, P.whale); s(13, 4, 2, 1.5, P.whale); s(4, 10, 2, 1, P.foam);
    }
  }

  /* ---------- 마을과 발전소 ---------- */
  // lit: 0~1, 공급/필요 비율만큼 창문에 불이 켜진다
  function village(A, x, y, T, P, lit) {
    const s = sprite(A, x, y, T);
    s(0.5, 0.5, 15, 15, P.wallDk);
    s(1, 1, 14, 14, P.sand);
    s(0, 7, 16, 2, P.road); s(7, 0, 2, 16, P.road);
    for (let i = 0; i < 16; i += 4) { s(i + 0.5, 7.8, 1.5, 0.5, P.roadLn); s(7.8, i + 0.5, 0.5, 1.5, P.roadLn); }
    const houses = [[1.5, 1.5, P.roof], [10, 1.5, P.roof2], [1.5, 10, P.roof2], [10, 10, P.roof]];
    const on = Math.round(clamp(lit, 0, 1) * houses.length * 2);
    houses.forEach(([a, b, roof], i) => {
      s(a, b + 2, 4.5, 3, P.wall); s(a - 0.3, b, 5.1, 2, roof);
      s(a + 0.8, b + 3, 1, 1, i * 2 < on ? P.winOn : P.winOff);
      s(a + 2.8, b + 3, 1, 1, i * 2 + 1 < on ? P.winOn : P.winOff);
    });
  }

  function plantAt(A, type, x, y, T, P, r, c, t, still) {
    const s = sprite(A, x, y, T);
    const sea = terr(r, c) !== "land";
    if (sea) { s(1, 12, 1, 3, P.metalDk); s(14, 12, 1, 3, P.metalDk); s(1, 11, 14, 1.5, P.padDk); }
    else { s(1, 1, 14, 14, P.padDk); s(1.5, 1.5, 13, 13, P.pad); }
    if (type === "fossil") {
      s(2, 7, 9, 7, P.factoryDk); s(2, 6, 9, 1.5, P.factory);
      for (let i = 0; i < 3; i++) s(3 + i * 2.8, 9, 1.4, 1.4, P.winOn);
      s(11, 2, 2, 12, P.stackW); s(11, 2, 2, 1.5, P.stackR); s(11, 6, 2, 1.5, P.stackR); s(11, 10, 2, 1.5, P.stackR);
      s(13.5, 5, 1.5, 9, P.factory); s(13.5, 5, 1.5, 1, P.stackR);
    } else if (type === "nuclear") {
      s(1.5, 8, 8, 6, P.domeDk); s(2, 6, 7, 3, P.dome); s(3, 5, 5, 1, P.dome); s(4, 4.3, 3, 1, P.dome); s(3, 6, 2, 2, P.metal);
      s(9.5, 3, 5, 11, P.towerDk); s(10.3, 3, 3.4, 11, P.tower); s(10.8, 6, 2.4, 4, P.tower); s(9.5, 2.5, 5, 1, P.metal);
    } else if (type === "solar") {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        s(1.5 + i * 6.8, 2 + j * 6.5, 6.2, 5.6, P.panelDk);
        s(2 + i * 6.8, 2.5 + j * 6.5, 5.2, 4.6, P.panel);
        s(4.4 + i * 6.8, 2.5 + j * 6.5, 0.6, 4.6, P.panelLt); s(2 + i * 6.8, 4.6 + j * 6.5, 5.2, 0.5, P.panelLt);
      }
      if (!still) {
        const gl = Math.floor((t * 1.2 + (r + c) * 0.37) % 4);
        s(2.5 + (gl % 2) * 6.8, 3 + Math.floor(gl / 2) * 6.5, 1.2, 1.2, "rgb(255,255,255)");
      }
    } else if (type === "wind") {
      const hubx = x + Math.floor(T / 2), huby = y + Math.round(T * 0.36);
      rect(A, hubx - 1, huby, 2, Math.round(T * 0.58), P.towerW);
      rect(A, hubx, huby, 1, Math.round(T * 0.58), P.metalDk);
      // 날개 회전 속도는 그 칸의 평균 풍속(게임에 공개된 값)을 따른다
      const spd = 0.6 + data.WIND[r][c] / 10;
      const a0 = still ? 0.4 : t * spd;
      const len = T * 0.34;
      for (let i = 0; i < 3; i++) {
        const a = a0 + i * 2.0944;
        line(A, hubx, huby, hubx + Math.cos(a) * len, huby + Math.sin(a) * len, P.blade);
      }
      rect(A, hubx - 1, huby - 1, 2, 2, P.metalDk);
    }
  }
  function plant(A, p, T, P, L, t, still) {
    const [r, c] = rc(p.cell);
    plantAt(A, p.type, L.mx + c * T, L.my + r * T, T, P, r, c, t, still);
  }

  function drawLines(A, st, T, P, L) {
    // 학생이 놓은 한 칸 선분만 한 번씩 그린다. 자동 경로와 최적 경로는 만들지 않는다.
    const lift = Math.max(2, Math.round(T * 0.3));
    const point = id => {
      const [r, c] = rc(id);
      return [L.mx + c * T + Math.floor(T / 2), L.my + r * T + Math.floor(T / 2)];
    };
    const poles = new Set(st.edges.flat());
    poles.forEach(id => {
      const [x, y] = point(id);
      rect(A, x, y - lift, 1, lift + 1, P.pole);
      rect(A, x - 1, y - lift, 3, 1, P.pole);
    });
    st.edges.forEach(([from, to]) => {
      const a = point(from), b = point(to);
      a[1] -= lift; b[1] -= lift;
      const mxp = (a[0] + b[0]) / 2, myp = (a[1] + b[1]) / 2 + (a[1] === b[1] ? 1 : 0);
      if (st.focus.cost) {
        A.c.beginPath(); A.c.moveTo(...a); A.c.lineTo(mxp, myp); A.c.lineTo(...b);
        A.c.strokeStyle = P.frame; A.c.lineWidth = 3; A.c.stroke();
        A.c.strokeStyle = P.spark; A.c.lineWidth = 1; A.c.stroke();
        return;
      }
      line(A, a[0], a[1], mxp, myp, P.wire);
      line(A, mxp, myp, b[0], b[1], P.wire);
    });
  }

  // 현재 질문의 대상은 고정 윤곽으로 강조한다. 풍향은 점선, 해류는 실선이다.
  function drawFocus(A, st, T, P, L) {
    if (!st.question) return;
    const point = id => { const [r, c] = rc(id); return [L.mx + (c + 0.5) * T, L.my + (r + 0.5) * T]; };
    const route = (cells, dotted, color) => {
      if (cells.length < 2) return;
      A.c.save();
      A.c.setLineDash(dotted ? [Math.max(2, T / 5), Math.max(2, T / 8)] : []);
      A.c.beginPath(); A.c.moveTo(...point(cells[0]));
      cells.slice(1).forEach(cell => A.c.lineTo(...point(cell)));
      A.c.strokeStyle = P.dark ? "#000000" : "#ffffff"; A.c.lineWidth = 4; A.c.stroke();
      A.c.strokeStyle = color; A.c.lineWidth = 2; A.c.stroke();
      A.c.restore();
    };
    const ring = (cell, color, inset) => {
      const [r, c] = rc(cell), x = L.mx + c * T + inset, y = L.my + r * T + inset, size = T - inset * 2;
      A.c.strokeStyle = P.dark ? "#000000" : "#ffffff"; A.c.lineWidth = 4; A.c.strokeRect(x, y, size, size);
      A.c.strokeStyle = color; A.c.lineWidth = 2; A.c.strokeRect(x, y, size, size);
    };
    st.focus.plants.forEach(p => {
      if (p.type === "fossil" || p.type === "nuclear") {
        if (st.focus.air.length) route([p.cell, ...smogPath(p.cell)], true, P.badC);
      }
    });
    const sea = new Set(st.focus.sea);
    sea.forEach(cell => {
      ring(cell, P.dark ? "#8ee8ff" : "#003f75", Math.max(3, T / 4));
      const direction = data.CURR[cell];
      if (!direction) return;
      (direction === "NS" ? ["N", "S"] : [direction]).forEach(dir => {
        const [r, c] = rc(cell), d = DV[dir], next = idOf(r + d[0], c + d[1]);
        if (sea.has(next)) route([cell, next], false, P.dark ? "#8ee8ff" : "#003f75");
      });
    });
    st.focus.plants.forEach(p => ring(p.cell, P.hi, 2));
    villages().filter(v => st.focus.villages.includes(v.n)).forEach(v => ring(v.cell, P.hi, 2));
  }

  function drawSmoke(A, st, T, P, L, t, still) {
    st.plants.forEach((p, i) => {
      const [r, c] = rc(p.cell);
      const x0 = L.mx + c * T, y0 = L.my + r * T;
      if (p.type === "fossil") {
        const path = [[x0 + T * 0.75, y0 + T * 0.1]].concat(smogPath(p.cell).map(id => { const [rr, cc] = rc(id); return [L.mx + cc * T + T / 2, L.my + rr * T + T / 2]; }));
        if (path.length < 2) return;
        const N = 7;
        for (let k = 0; k < N; k++) {
          const ph = still ? k / N : (t * 0.22 + k / N + i * 0.13) % 1;
          const u = ph * (path.length - 1);
          const j = Math.min(path.length - 2, Math.floor(u));
          const f = u - j;
          const x = path[j][0] + (path[j + 1][0] - path[j][0]) * f, y = path[j][1] + (path[j + 1][1] - path[j][1]) * f;
          const sz = Math.max(2, Math.round(T * (0.18 + ph * 0.32)));
          A.c.fillStyle = P.smoke + (0.62 * (1 - ph) + 0.12).toFixed(2) + ")";
          A.c.fillRect(Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
          A.c.fillRect(Math.round(x - sz / 2) - 1, Math.round(y - sz / 2) + 1, sz + 2, Math.max(1, sz - 2));
        }
      } else if (p.type === "nuclear") {
        for (let k = 0; k < 3; k++) {
          const ph = still ? k / 3 : (t * 0.3 + k / 3) % 1;
          const sz = Math.max(2, Math.round(T * (0.2 + ph * 0.18)));
          const x = x0 + T * 0.75 + ph * T * 0.15, y = y0 + T * 0.12 - ph * T * 0.5;
          A.c.fillStyle = P.steam + (0.8 * (1 - ph)).toFixed(2) + ")";
          A.c.fillRect(Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
        }
      }
    });
  }

  // 게임에서 고른 [데이터] 겹쳐 보기를 장면에도 비춘다(게임 화면에 이미 보이는 값)
  function drawOverlay(A, st, T, P, L, t, still) {
    const { mx, my } = L;
    if (st.overlay === "solar") {
      for (let r = 0; r < 10; r++) {
        A.c.fillStyle = "rgba(255,214,64," + (0.06 + data.SOLAR[r] / 20 * (P.dark ? 0.2 : 0.3)).toFixed(3) + ")";
        A.c.fillRect(mx, my + r * T, T * 10, T);
      }
    } else if (st.overlay === "wind") {
      const col = P.dark ? "rgb(220,232,255)" : "rgb(255,255,255)";
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        const d = DV[data.WDIR[r][c]], v = data.WIND[r][c];
        const ph = still ? 0.5 : (t * v / 16 + hash(r, c, 11)) % 1;
        const len = Math.max(2, Math.round(T * v / 40));
        const cx = mx + c * T + T / 2 + d[1] * (ph - 0.5) * T * 0.7, cy = my + r * T + T / 2 + d[0] * (ph - 0.5) * T * 0.7;
        line(A, cx - d[1] * len, cy - d[0] * len, cx, cy, col);
      }
    } else if (st.overlay === "current") {
      Object.keys(data.CURR).forEach(id => {
        const [r, c] = rc(id);
        (data.CURR[id] === "NS" ? ["N", "S"] : [data.CURR[id]]).forEach(dd => {
          const d = DV[dd];
          const ph = still ? 0.5 : (t * 0.4 + hash(r, c, 13)) % 1;
          const cx = mx + c * T + T / 2 + d[1] * (ph - 0.5) * T * 0.6, cy = my + r * T + T / 2 + d[0] * (ph - 0.5) * T * 0.6;
          const len = Math.max(2, Math.round(T * 0.22));
          line(A, cx - d[1] * len, cy - d[0] * len, cx, cy, P.foam);
          rect(A, Math.round(cx) - (d[1] ? 0 : 1), Math.round(cy) - (d[0] ? 0 : 1), d[1] ? 1 : 3, d[0] ? 1 : 3, P.foam);
        });
      });
    }
  }

  /* ---------- 메뉴 창(버퍼에 픽셀 테두리, 글자는 CSS px로 덧그림) ---------- */
  function windowFrame(A, L, P, box) {
    const cs = L.cs;
    const x = Math.round(box.x / cs), y = Math.round(box.y / cs), w = Math.round(box.w / cs), h = Math.round(box.h / cs);
    const b = Math.max(1, Math.round(2 / cs));
    // 모서리를 1픽셀 깎은 두꺼운 테두리
    rect(A, x + 1, y, w - 2, h, P.wOuter); rect(A, x, y + 1, w, h - 2, P.wOuter);
    rect(A, x + 2, y + 1, w - 4, h - 2, P.wRing); rect(A, x + 1, y + 2, w - 2, h - 4, P.wRing);
    const ix = x + 1 + b, iy = y + 1 + b, iw = w - 2 - 2 * b, ih = h - 2 - 2 * b;
    rect(A, ix, iy, iw, ih, P.wInner);
    const n = P.wBands.length;
    for (let i = 0; i < n; i++) rect(A, ix + 1, iy + 1 + Math.floor((ih - 2) * i / n), iw - 2, Math.ceil((ih - 2) / n), P.wBands[i]);
    if (P.wDither) {
      A.c.fillStyle = checker(A, P.wDither);
      A.c.fillRect(ix + 1, iy + Math.floor(ih * 0.7), iw - 2, ih - 1 - Math.floor(ih * 0.7));
    }
  }

  let fontCache = null;
  function fonts() {
    if (fontCache) return fontCache;
    const cs = getComputedStyle(document.documentElement);
    const v = n => (cs.getPropertyValue(n) || "").trim();
    fontCache = { display: v("--display") || "sans-serif", body: v("--body") || "sans-serif", mono: v("--mono") || "monospace" };
    return fontCache;
  }

  function wrap(g, text, maxW) {
    const lines = [];
    let cur = "";
    text.split(" ").forEach(wd => {
      const next = cur ? cur + " " + wd : wd;
      if (!cur || g.measureText(next).width <= maxW) cur = next;
      else { lines.push(cur); cur = wd; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // 조언: 학생이 고른 상태만 요약한다. 어디에 지으라는 말(정답·예시 배치)은 하지 않는다.
  function questionLabel(st) {
    const q = st.question;
    return q ? "질문 " + (q.index + 1) + (q.tag ? " · " + q.tag : "") + " · " + (q.official ? "보고서 문항" : "연습용 질문") : "";
  }
  function questionDetail(st) {
    const key = st.question?.key, sites = st.focus.plants.map(p => data.PT[p.type].n + " " + p.cell).join(", ");
    if (key === "22-q1-nuc") return sites + " 강조. 사고 시 풍향을 따라 최대 4칸 이동하는 경로(점선)와 해류 경로(실선)는 연습실 재구성입니다.";
    if (key === "22-q1-fos") return sites + " 강조. 미세먼지가 풍향을 따라 최대 4칸 이동하는 경로(점선)는 연습실 재구성입니다.";
    if (key === "22-q2-cost") return "전선·비용 강조. 발전 " + st.cost + "(재구성: 기당), 전선 " + st.wire + "칸, 총비용 " + st.total + "(연습실 가정: 전선 1칸당 비용 1).";
    if (key === "22-q2-one") return sites + " 한 종류 발전소 강조. 이 발전 방식이 멈출 때의 대응을 설명해 보세요.";
    if (key === "22-div-typhoon") return "바닷가 풍력 강조: " + (sites || "이 계획에 해상·해안 풍력 없음") + ". 태풍 때 얻는 것과 잃는 것을 설명해 보세요.";
    if (key === "22-hum-vote") return "빛가람 마을 강조. 보전과 개발을 바라는 주민에게 계획을 설명해 보세요.";
    if (key === "22-hum-future") return "배멧·참살이 마을 강조. 계획이 두 마을의 미래에 주는 영향을 설명해 보세요.";
    return (st.mode === "q1" ? "1번" : "2번") + " 계획" + (st.mode === "q2" ? "과 직접 놓은 전선" : "") + "입니다. 위치를 고른 이유를 설명해 보세요.";
  }
  function briefAdvice(st) {
    const q = st.question;
    const targets = {
      "22-q1": "1번 배치", "22-q2": "2번 공급·전선",
      "22-q1-nuc": "원자력 · 풍향·해류", "22-q1-fos": "화석 · 풍향",
      "22-q2-cost": "전선·비용", "22-q2-one": "한 종류 발전소",
      "22-div-typhoon": "해상·해안 풍력", "22-hum-vote": "빛가람 주민",
      "22-hum-future": "배멧·참살이",
    };
    return (q ? "질문 " + (q.index + 1) : st.mode === "q1" ? "1번" : "2번") + " · " +
      (st.empty ? "계획 없음" : targets[q?.key] || "내 계획");
  }
  function advice(st, phase) {
    if (phase === "room") return questionLabel(st) + ". " + (st.empty ? "준비실에서 이 문제의 계획을 아직 세우지 않았습니다. 준비실로 돌아가 계획을 세워 보세요." : questionDetail(st));
    if (phase === "reflect") return "성찰 단계입니다. 내가 세운 배치를 다시 보며 무엇을 무겁게 보았는지 돌아보세요.";
    if (st.mode === "q1") {
      const left = TYPES.filter(k => !st.q1[k]).map(k => SHORT[k]);
      if (!left.length) return "네 발전소를 모두 세웠습니다. 위치마다 경제·사회·환경 측면의 이유를 적어 보세요.";
      if (left.length === 4) return "시장님, 설치 도구를 고르고 지도 칸을 눌러 발전소를 세워 보세요. 종류마다 1기씩입니다.";
      return "아직 세우지 않은 발전소: " + left.join(", ") + ". 종류마다 1기씩 세웁니다.";
    }
    if (!st.q2.length) return "세 마을에 60·80·100의 전기를 보내야 합니다. 발전소를 세우고 공급 마을을 고른 뒤 전선을 직접 놓으세요.";
    const short = villages().filter(v => st.got[v.n] < v.need).map(v => v.n + " " + (v.need - st.got[v.n]));
    if (short.length) return "전력 부족: " + short.join(", ") + ". 지도와 데이터를 보며 계획을 이어 가세요.";
    return "세 마을 모두 불이 켜졌습니다. 총비용 " + st.total + ". 계획 설명에 고른 이유와 포기한 것을 적어 보세요.";
  }

  // 창 배치(CSS px). A: 발전소, B: 마을 전력, C: 조언
  function boxesOf(L, st) {
    const pn = L.panel;
    if (!pn) return null;
    const main = st.mode === "q1" ? "A" : "B";
    const out = {};
    if (pn.h < 84) { out.C = pn; return out; }
    if (L.narrow) {
      const advH = clamp(Math.round(pn.h * 0.48), 40, 64);
      out[main] = { x: pn.x, y: pn.y, w: pn.w, h: pn.h - advH - 5 };
      out.C = { x: pn.x, y: pn.y + pn.h - advH, w: pn.w, h: advH };
      return out;
    }
    if (pn.h < 150) {
      const ww = Math.min(300, pn.w * 0.42);
      out[main] = { x: pn.x, y: pn.y, w: ww, h: pn.h };
      out.C = { x: pn.x + ww + 8, y: pn.y, w: Math.min(520, pn.w - ww - 8), h: pn.h };
      return out;
    }
    const advH = clamp(Math.round(pn.h * 0.3), 46, 64);
    const topH = pn.h - advH - 6;
    const wA = Math.min(280, pn.w * 0.4), wB = Math.min(420, pn.w - wA - 8);
    out.A = { x: pn.x, y: pn.y, w: wA, h: topH };
    out.B = { x: pn.x + wA + 8, y: pn.y, w: wB, h: topH };
    out.C = { x: pn.x, y: pn.y + topH + 6, w: wA + 8 + wB, h: advH };
    return out;
  }
  function gridOf(box, n, cols, narrow) {
    const th = narrow ? 17 : 25;
    const rows = Math.ceil(n / cols);
    const rowH = (box.h - th - (narrow ? 3 : 6)) / rows;
    const colW = (box.w - 8) / cols;
    const ic = Math.max(8, Math.min(rowH - 4, 20));
    return { th, rowH, colW, ic, cell: i => ({ x: box.x + 4 + (i % cols) * colW, y: box.y + th + Math.floor(i / cols) * rowH, cy: box.y + th + Math.floor(i / cols) * rowH + rowH / 2 }) };
  }

  function panelFrames(A, L, P, st, bx) {
    const cs = L.cs;
    Object.keys(bx).forEach(k => windowFrame(A, L, P, bx[k]));
    if (bx.A) {
      const gd = gridOf(bx.A, 4, L.narrow ? 2 : 1, L.narrow);
      const T = Math.max(5, Math.floor(gd.ic / cs));
      TYPES.forEach((k, i) => {
        const c = gd.cell(i);
        plantAt(A, k, Math.round((c.x + 14) / cs), Math.round((c.cy - T * cs / 2) / cs), T, P, 5, 1, 0, true);
      });
    }
    if (bx.B) {
      const gd = gridOf(bx.B, 3, 1, L.narrow);
      const T = Math.max(5, Math.floor(gd.ic / cs));
      villages().forEach((v, i) => {
        const c = gd.cell(i);
        village(A, Math.round((c.x + 6) / cs), Math.round((c.cy - T * cs / 2) / cs), T, P, st.mode === "q2" ? st.got[v.n] / v.need : 0);
      });
    }
    if (bx.C) {
      // 조언가 얼굴(픽셀 초상)
      const box = bx.C;
      const fsz = Math.min(box.h - 16, 30);
      const T = Math.max(6, Math.floor(fsz / cs));
      const s = sprite(A, Math.round((box.x + 10) / cs), Math.round((box.y + (box.h - T * cs) / 2) / cs), T);
      const dark = P.dark;
      s(3, 1, 10, 5, "rgb(60,44,36)"); s(3, 4, 10, 9, "rgb(240,196,150)"); s(2, 3, 2, 6, "rgb(60,44,36)"); s(12, 3, 2, 6, "rgb(60,44,36)");
      s(4, 7, 3, 2, "rgb(30,30,40)"); s(9, 7, 3, 2, "rgb(30,30,40)"); s(7, 7.5, 2, 0.8, "rgb(30,30,40)");
      s(6, 11, 4, 1, "rgb(170,80,70)"); s(2, 13, 12, 3, dark ? "rgb(230,236,250)" : "rgb(40,64,150)"); s(7, 13, 2, 3, "rgb(200,60,50)");
    }
  }

  function panelText(g, L, P, F, st, bx, phase, t, still) {
    const narrow = L.narrow;
    g.textBaseline = "middle";
    const head = (box, text, right, th) => {
      g.font = "400 " + (narrow ? 12 : 13) + "px " + F.display;
      g.fillStyle = P.hi;
      g.textAlign = "left";
      g.fillText(text, box.x + 10, box.y + th / 2 + 2);
      if (right) {
        g.font = "600 11px " + F.body;
        g.textAlign = "right";
        g.fillStyle = P.ink2;
        g.fillText(right, box.x + box.w - 10, box.y + th / 2 + 2);
      }
    };
    if (bx.A) {
      const box = bx.A, gd = gridOf(box, 4, narrow ? 2 : 1, narrow);
      head(box, "발전소", st.mode === "q1" ? "1번 · 1기씩" : "2번 · 세운 수", gd.th);
      const fs = Math.max(11, Math.min(13, gd.rowH - 6));
      TYPES.forEach((k, i) => {
        const c = gd.cell(i);
        const sel = phase === "prep" && st.tool === k;
        if (sel && (still || Math.floor(t * 2.2) % 2 === 0)) {
          g.font = "700 " + fs + "px " + F.body; g.fillStyle = P.hi; g.textAlign = "left"; g.fillText("▶", c.x + 1, c.cy);
        }
        const val = st.mode === "q1" ? (st.q1[k] || "—") : "×" + st.count[k];
        g.font = "600 " + fs + "px " + F.mono; g.textAlign = "right";
        g.fillStyle = st.mode === "q1" && !st.q1[k] ? P.ink2 : P.ink;
        g.fillText(val, c.x + gd.colW - 6, c.cy);
        if (!narrow) {
          g.font = (sel ? "700 " : "400 ") + fs + "px " + F.body;
          g.fillStyle = P.ink; g.textAlign = "left";
          g.fillText(SHORT[k], c.x + 14 + gd.ic + 8, c.cy);
        }
      });
      if (phase === "prep" && st.tool === "erase" && !narrow) {
        g.font = "600 11px " + F.body; g.fillStyle = P.hi; g.textAlign = "right";
        g.fillText("지우개 사용 중", box.x + box.w - 10, box.y + box.h - 10);
      }
    }
    if (bx.B) {
      const box = bx.B, gd = gridOf(box, 3, 1, narrow);
      head(box, "마을 전력", st.mode === "q2" ? "공급 / 필요" : "1번 · 연결 없음", gd.th);
      const fs = Math.max(11, Math.min(13, gd.rowH - 4));
      villages().forEach((v, i) => {
        const c = gd.cell(i);
        const nx = c.x + 6 + gd.ic + 8;
        g.font = "400 " + fs + "px " + F.body; g.fillStyle = P.ink; g.textAlign = "left";
        g.fillText(v.n, nx, c.cy);
        g.font = "600 " + fs + "px " + F.mono; g.textAlign = "right";
        if (st.mode !== "q2") { g.fillStyle = P.ink2; g.fillText(v.cell, box.x + box.w - 10, c.cy); return; }
        const gv = st.got[v.n], ok = gv >= v.need;
        g.fillStyle = ok ? P.okC : gv ? P.ink : P.badC;
        g.fillText(gv + "/" + v.need, box.x + box.w - 10, c.cy);
        // 공급 막대(픽셀 칸)
        const bx0 = nx + 52, bw = box.x + box.w - 10 - g.measureText("000/100").width - 10 - bx0;
        if (bw < 40) return;
        const cells = 10, cw = bw / cells, fill = Math.min(cells, Math.floor(gv / v.need * cells + 1e-9));
        for (let q = 0; q < cells; q++) {
          g.fillStyle = q < fill ? (ok ? P.okC : P.hi) : P.empty;
          g.fillRect(Math.round(bx0 + q * cw), Math.round(c.cy - 4), Math.max(2, Math.round(cw) - 2), 8);
        }
      });
    }
    if (bx.C) {
      const box = bx.C;
      const fx = box.x + 10 + Math.min(box.h - 16, 30) + 10;
      const maxW = box.x + box.w - 10 - fx;
      const fs = narrow || box.h < 60 ? 11 : 12.5, lh = fs + 3;
      // 좁은 창은 '조언' 머리를 첫 줄 앞에 붙여 글줄을 하나 더 쓴다
      const inline = narrow || box.h < 60;
      g.textAlign = "left";
      g.font = "400 " + (inline ? 11 : 12) + "px " + F.display;
      const lab = inline ? "조언 " : "";
      const labW = inline ? g.measureText(lab).width : 0;
      const maxLines = Math.max(1, Math.floor((box.h - 8) / lh) - (inline ? 0 : 1));
      const top = box.y + (box.h - lh * (maxLines + (inline ? 0 : 1))) / 2 + lh / 2;
      g.fillStyle = P.hi;
      g.fillText(inline ? lab : "조언", fx, top);
      g.font = "400 " + fs + "px " + F.body;
      g.fillStyle = P.ink;
      // 좁은 면접실은 질문 번호·대상만 표시한다. 전체 설명은 기존 캔버스 이름에 남긴다.
      const lines = wrap(g, narrow && phase === "room" ? briefAdvice(st) : advice(st, phase), maxW - labW);
      lines.slice(0, maxLines).forEach((ln, i) => {
        let txt = ln;
        if (i === maxLines - 1 && lines.length > maxLines) {
          while (txt.length > 1 && g.measureText(txt + "…").width > maxW - labW) txt = txt.slice(0, -1);
          txt += "…";
        }
        g.fillText(txt, fx + labW, top + lh * (i + (inline ? 0 : 1)));
      });
    }
  }

  function drawLabels(g, L, P, F, st) {
    if (!L.labels) return;
    const cs = L.cs, T = L.T * cs, x0 = L.mx * cs, y0 = L.my * cs;
    g.font = "600 10px " + F.mono;
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillStyle = P.dark ? "#e8eeff" : "#ffffff";
    for (let i = 0; i < 10; i++) {
      g.fillText(String(i + 1), x0 + T * (i + 0.5), y0 - 7);
      g.fillText(data.ROWS[i], x0 - 7, y0 + T * (i + 0.5));
    }
    // 마을 이름표(작은 창). 공급을 채운 마을은 노란 테두리
    if (T >= 26) {
      g.font = "700 11px " + F.body;
      villages().forEach(v => {
        const [r, c] = rc(v.cell);
        const full = st.mode === "q2" && st.got[v.n] >= v.need;
        const tw = Math.round(g.measureText(v.n).width + 8);
        const cx = x0 + T * (c + 0.5);
        const bx = Math.round(clamp(cx - tw / 2, x0 - 2, x0 + T * 10 - tw + 2)), by = Math.round(y0 + T * r - 15);
        g.fillStyle = P.dark ? "#0b1d52" : "#fcf7e6";
        g.fillRect(bx, by, tw, 14);
        g.strokeStyle = st.focus.villages.includes(v.n) ? P.hi : full ? "#ffd75e" : P.dark ? "#e8ecf8" : "#1b2550";
        g.lineWidth = 1.5;
        g.strokeRect(bx + 0.75, by + 0.75, tw - 1.5, 12.5);
        g.fillStyle = P.dark ? "#ffffff" : "#1b2550";
        g.fillText(v.n, bx + tw / 2, by + 7.5);
      });
    }
  }

  /* ---------- 설명과 칩 ---------- */
  function captionOf(st, phase) {
    const parts = ["KENTECH 도시 지도(10×10, 위에서 본 픽셀 타일)."];
    if (st.question) parts.push(questionLabel(st) + ". " + (st.empty ? "준비실에서 이 문제의 계획을 아직 세우지 않았습니다." : questionDetail(st)));
    if (st.overlay !== "map") parts.push("데이터 겹쳐 보기: " + OVN[st.overlay] + ".");
    if (st.mode === "q1") {
      const placed = TYPES.filter(k => st.q1[k]).map(k => data.PT[k].n + " " + st.q1[k]);
      parts.push("1번 문제 배치 " + placed.length + "/4" + (placed.length ? ": " + placed.join(", ") + "." : ", 아직 세운 발전소 없음."));
    } else {
      parts.push("2번 문제 발전소 " + st.q2.length + "기" + (st.q2.length ? ": " + st.q2.map(p => SHORT[p.type] + " " + p.cell + (p.to ? "→" + p.to : "")).join(", ") + "." : "."));
      parts.push("마을 공급: " + villages().map(v => v.n + " " + st.got[v.n] + "/" + v.need + (st.got[v.n] >= v.need ? " 불 켜짐" : st.got[v.n] ? " 일부 켜짐" : " 꺼짐")).join(", ") + ".");
      parts.push("발전 비용 " + st.cost + "(재구성: 기당), 전선 " + st.wire + "칸, 총비용 " + st.total + "(연습실 가정: 전선 1칸당 비용 1). ");
    }
    if (st.plants.some(p => p.type === "fossil")) parts.push("화석 연료 발전소 굴뚝 연기가 바람을 따라 흐름.");
    if (phase === "prep") parts.push("선택한 도구: " + ({ erase: "지우개", wire: "전선 놓기", unwire: "전선 지우기" }[st.tool] || data.PT[st.tool].n) + ".");
    return parts.join(" ");
  }
  function chipsOf(st, narrow) {
    if (st.question) {
      const out = [{ label: "질문", value: (st.question.index + 1) + " · " + st.question.tag, tone: "plain" },
        { label: "문항", value: st.question.official ? "보고서 문항" : "연습용 질문", tone: "plain" },
        { label: "장면", value: (st.mode === "q1" ? "1번" : "2번") + " 계획 · 재구성", tone: "info" }];
      if (st.empty) out.push({ label: "계획", value: "계획 없음", tone: "warn" });
      else if (st.focus.cost) {
        out.push({ label: "발전 비용", value: st.cost + " · 재구성(기당)", tone: "info" },
          { label: "전선", value: st.wire + "칸 · 1칸당 비용 1(연습실 가정)", tone: "info" },
          { label: "총비용", value: String(st.total), tone: "info" });
      } else if (st.focus.villages.length) out.push({ label: "강조", value: st.focus.villages.join("·"), tone: "info" });
      else if (st.focus.plants.length) out.push({ label: "강조", value: [...new Set(st.focus.plants.map(p => SHORT[p.type]))].join("·"), tone: "info" });
      return out;
    }
    if (st.mode === "q1") {
      const n = TYPES.filter(k => st.q1[k]).length;
      const out = [{ label: "문제", value: "1번", tone: "plain" }, { label: "배치", value: n + "/4", tone: n === 4 ? "ok" : "plain" }];
      if (!narrow) {
        out.push({ label: "도구", value: ({ erase: "지우개", wire: "전선 놓기", unwire: "전선 지우기" }[st.tool] || SHORT[st.tool]), tone: "info" });
        out.push({ label: "데이터", value: OVN[st.overlay], tone: "plain" });
      }
      return out;
    }
    const out = [{ label: "문제", value: "2번", tone: "plain" }, { label: "발전소", value: st.q2.length + "기", tone: "plain" },
      { label: "불 켜진 마을", value: st.met + "/3", tone: st.met === 3 ? "ok" : st.q2.length ? "warn" : "plain" }];
    if (!narrow) out.push({ label: "총비용", value: String(st.total), tone: "info" });
    return out;
  }

  /* ---------- 그리기 ---------- */
  const cache = { gkey: "" };
  function render(ctx) {
    const g = ctx.g, w = Math.max(1, ctx.w), h = Math.max(1, ctx.h);
    const st = read(ctx);
    if (!st) return;
    const dark = ctx.scheme === "dark", thumb = !!ctx.thumb, still = !!ctx.reduced || thumb;
    const tr = typeof g.getTransform === "function" ? g.getTransform() : null, dpr = tr && tr.a > 0 ? tr.a : 1;
    const L = layout(w, h, dpr, thumb);
    const P = palette(dark);
    // 첫 프레임의 rAF 시각이 장면 생성 시각보다 앞서면 ctx.t가 음수가 되어 연기 위치 계산이 배열 밖을 읽는다.
    const t = still ? 0 : Math.max(0, ctx.t || 0);
    const phase = ctx.phase === "room" || ctx.phase === "reflect" ? ctx.phase : "prep";
    const C = thumb ? { gkey: "" } : cache;
    const gkey = [L.W, L.H, L.T, L.mx, L.my, dark].join("|");
    if (C.gkey !== gkey || C.data !== data) {
      C.ground = makeBuf(C.ground && C.ground.cv, L.W, L.H);
      paintGround(C.ground, L, P);
      C.gkey = gkey;
      C.data = data;
    }
    C.frame = makeBuf(C.frame && C.frame.cv, L.W, L.H);
    const A = C.frame, T = L.T;
    A.c.drawImage(C.ground.cv, 0, 0);
    drawOverlay(A, st, T, P, L, t, still);
    villages().forEach(v => {
      const [r, c] = rc(v.cell);
      const lit = st.mode === "q2" ? clamp(st.got[v.n] / v.need, 0, 1) : 0;
      if (dark && lit > 0) {
        // 밤: 불 켜진 마을 둘레의 디더링 불빛
        A.c.fillStyle = checker(A, P.glow + (0.3 + Math.round(lit * 5) / 10).toFixed(1) + ")");
        A.c.fillRect(L.mx + Math.round((c - 0.5) * T), L.my + Math.round((r - 0.5) * T), T * 2, T * 2);
      }
      village(A, L.mx + c * T, L.my + r * T, T, P, lit);
    });
    if (st.mode === "q2") drawLines(A, st, T, P, L);
    st.plants.forEach(p => plant(A, p, T, P, L, t, still));
    drawSmoke(A, st, T, P, L, t, still);
    drawFocus(A, st, T, P, L);
    const bx = thumb ? null : boxesOf(L, st);
    if (bx) panelFrames(A, L, P, st, bx);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(A.cv, 0, 0, L.W * L.k, L.H * L.k);
    g.restore();
    if (!thumb) {
      const F = fonts();
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLabels(g, L, P, F, st);
      if (bx) panelText(g, L, P, F, st, bx, phase, t, still);
      g.restore();
    }
    return { caption: captionOf(st, phase), chips: chipsOf(st, w < 560), animate: !still };
  }

  KCP.v2.skin(ID, { kicker: "CITY POWER MAP", title: "켄텍 도시 전력 지도", render });
})();
