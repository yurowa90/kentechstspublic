/* 2023 가람국 10년 계획 · 개척 길 장면(TRAIL LOG)
 * 80년대 교육용 개척 길 게임의 화면 문법을 빌린 장면이다. 옆으로 흐르는 픽셀 풍경 위로 가람국의 마차가
 * 10년 길을 따라 가고, 학생이 고른 실행 항목은 그 해 구간의 풍경(연구 탑·마을·나무·그루터기)으로 남는다.
 * 아래 이정표 띠는 1–10년 차 핀과 고른 항목 번호, 오른쪽 계기판은 과학·행복·환경 누적 지수와
 * 같은 해 이웃(나람국·다람국) 값을 보여 준다. 이웃 마차는 같은 해 세 지수 합의 차이만큼 앞이나 뒤에 선다.
 * 게임 상태(state.game.plan)는 읽기만 한다. 실행 항목 값과 이웃 계획은 g2023.js의 자료를 그대로 옮긴 사본이며,
 * 계산(전염병·박람회 포함)도 g2023.js의 compute와 같다. 성찰 단계의 예시 계획·유실 문장은 쓰지 않는다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  /* ---------- 자료(g2023.js 사본, 읽기 전용) ---------- */
  // [이름, 과학, 행복, 환경]
  const IT = {
    "1A": ["과학의 태동", 1, 0, 0], "1B": ["최저 임금제", 0, 1, 0], "1C": ["분리수거", 0, 0, 1],
    "2A": ["이론의 발견", 3, 0, -1], "2B": ["과학 수준의 향상", 2, 0, 0], "2C": ["배움의 즐거움", 1, 1, 0],
    "2D": ["대형 쇼핑몰", 0, 3, -1], "2E": ["로봇 대체 근무", 0, 2, 0], "2F": ["역사 체험의 날", 0, 1, 1],
    "2G": ["재활용 기술 개발", 1, 0, 1], "2H": ["나무 심기의 날", 0, 0, 2], "2I": ["개발 제한", -1, 0, 3],
    "3A": ["생산 기술 발전", 4, 0, -1], "3B": ["혁신 연구소", 3, 0, 0], "3C": ["엄격한 폐기물 관리", 1, 1, 1],
    "3D": ["의료 혜택 확대", 0, 3, 0], "3E": ["황무지 개척", 1, 4, -2], "3F": ["더 많은 운동장", 0, 4, -1],
    "3G": ["1급수", 0, 1, 2], "3H": ["생태 복원 프로젝트", 0, 0, 3], "3I": ["초록 기금", 2, -2, 3],
    "4A": ["천재 과학자", 6, -1, -1], "4B": ["직접 운전 금지", 3, 1, 0], "4C": ["초고속 여객기", 3, 3, -2],
    "4D": ["행복도시", 2, 5, -3], "4E": ["온실 가스 감축", -2, 3, 3], "4F": ["자동차 격일제", 0, -3, 7],
    "4G": ["프로슈머", 0, 2, 2]
  };
  const NARAM = ["1A", "2C", "2B", "3B", "1B", "2F", "2A", "2E", "3F", "3C"];
  const DARAM = ["1C", "1B", "1A", "2F", "2H", "2C", "3G", "3H", "3C", "3F"];
  const NAMES = ["과학", "행복", "환경"];

  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const fmt = v => (v < 0 ? "−" + Math.abs(v) : String(v));
  function hash(x, s) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  // g2023.js compute와 같은 규칙: 3년 차 누적 과학·환경 중 하나라도 0 이하면 4년 차 행복 −1,
  // (박람회 개최국만) 6년 차 누적 과학 5·환경 3 이상이면 7년 차 행복 +2.
  function compute(plan, expo) {
    const cum = [0, 0, 0];
    const rows = [];
    let epi = null, fair = null;
    plan.forEach((id, i) => {
      const v = IT[id];
      const d = [v[1], v[2], v[3]];
      if (i === 3 && epi) d[1] -= 1;
      if (i === 6 && fair) d[1] += 2;
      cum[0] += d[0]; cum[1] += d[1]; cum[2] += d[2];
      rows.push({ id, d, cum: cum.slice() });
      if (i === 2) epi = cum[0] <= 0 || cum[2] <= 0;
      if (i === 5 && expo) fair = cum[0] >= 5 && cum[2] >= 3;
    });
    return { rows, epi, fair };
  }
  const NB = [
    { name: "나람국", res: compute(NARAM, false) },
    { name: "다람국", res: compute(DARAM, false) }
  ];
  const ZERO = [0, 0, 0];
  const cumAt = (res, n) => (n > 0 && res.rows[n - 1] ? res.rows[n - 1].cum : ZERO);
  const level = gap => (gap >= 5 ? "bad" : gap >= 3 ? "warn" : "");
  const LEVEL_WORD = { bad: "위험", warn: "경계" };
  const worse = (a, b) => (a === "bad" || b === "bad" ? "bad" : a === "warn" || b === "warn" ? "warn" : "");

  /* ---------- 상태 읽기 ---------- */
  function read(ctx) {
    const g = ctx.game && typeof ctx.game === "object" ? ctx.game : {};
    const raw = Array.isArray(g.plan) ? g.plan : [];
    const plan = [];
    raw.forEach(id => { if (typeof id === "string" && own(IT, id) && !plan.includes(id) && plan.length < 10) plan.push(id); });
    const game = KCP.games["2023"];
    const plannedYears = plan.length;
    if (ctx.phase === "prep" && game && typeof game.shownYears === "function") plan.splice(game.shownYears({ ...g, plan }));
    const res = compute(plan, true);
    const n = plan.length;
    const mine = cumAt(res, n);
    // 같은 해 이웃과의 격차(게임 표의 경계·위험 칸과 같은 기준)
    const lv = [0, 1, 2].map(k => (n ? NB.reduce((acc, nb) => worse(acc, level(cumAt(nb.res, n)[k] - mine[k])), "") : ""));
    const nbs = NB.map(nb => {
      const c = cumAt(nb.res, n);
      const lvs = [0, 1, 2].map(k => (n ? level(c[k] - mine[k]) : ""));
      return { name: nb.name, cum: c, diff: (c[0] + c[1] + c[2]) - (mine[0] + mine[1] + mine[2]), lv: lvs.reduce(worse, "") };
    });
    return { plan, res, n, mine, lv, nbs, hiddenYears: n < plannedYears };
  }

  /* ---------- 색 ---------- */
  const PAL = {
    light: {
      sky: ["#a7d4e6", "#cfe6e6", "#f2e7c6"], sun: "#e9792a", sunLt: "#f6a24c", cloud: "#fffaf0", cloudSh: "#e6dcc4",
      star: null, haze: "#b8915e",
      mtn: "#8c6bc2", mtnDk: "#6e4fa6", hill: "#4f9a3a", hillDk: "#3c7d2c", dry: "#a8945a", dryDk: "#8c7744",
      ground: "#cdb06c", groundDk: "#b8975a", grass: "#6aa246", fog: "#f2e7c6",
      trail: "#a8652d", trailDk: "#8a4c1f", trailLt: "#c88a50", rut: "#7a421a",
      tree: "#2f7d32", treeDk: "#1f5e22", trunk: "#6b4423", stump: "#7b5532", stumpLt: "#a87a4c",
      cabin: "#f6ead0", cabinSh: "#d8c49c", roof: "#c4541c", win: "#6b4423",
      tower: "#5b3f8c", beacon: "#e33bd6", cloudRain: "#8d8a80", rain: "#4c7fb8",
      flag: "#e8b417", pole: "#4d3c25", bunt: ["#c4541c", "#6a3a9c", "#2f7d32", "#1f58b8"],
      wood: "#6b4423", woodDk: "#4a2e15", wheel: "#2a1f12", ox: "#8a5a2b", oxDk: "#5e3b1a",
      covers: ["#fbf3dc", "#b39a6c", "#9370cf"], coverSh: ["#d9cba4", "#8c7650", "#6f4fa8"],
      ink: "#2a1f12", ink2: "#4d3c25", panel: "#fbf5e2", panelLine: "#2a1f12", strip: "#f3e9cc", stripLine: "#6a5638",
      pin: "#8f420a", plate: "#fbf5e2",
      idx: ["#b0235a", "#1f58b8", "#2c6a1c"], warn: "#855000", bad: "#a3261a", cell: "#e2d6b6", nbCol: ["#6a5638", "#6a3a9c"]
    },
    dark: {
      sky: ["#000000", "#000000", "#06060f"], sun: "#ffc04d", sunLt: "#ffd98a", cloud: null, cloudSh: null,
      star: ["#b6f7c0", "#ffc04d", "#c99bff"], haze: "#4a2408",
      mtn: "#5a2a96", mtnDk: "#3c1a6a", hill: "#138a2a", hillDk: "#0b5e1a", dry: "#5e4a1c", dryDk: "#3e300f",
      ground: "#141006", groundDk: "#2a2008", grass: "#1f9a2c", fog: "#000000",
      trail: "#8f3c10", trailDk: "#622808", trailLt: "#c2581c", rut: "#4a1e06",
      tree: "#2fd14a", treeDk: "#178a2c", trunk: "#9a6230", stump: "#a0602a", stumpLt: "#d08a40",
      cabin: "#3a2a12", cabinSh: "#241a0a", roof: "#e0661f", win: "#ffc04d",
      tower: "#b07aff", beacon: "#ff7bff", cloudRain: "#4a4a5a", rain: "#5fa8ff",
      flag: "#ffc04d", pole: "#b6f7c0", bunt: ["#ff7a2f", "#c99bff", "#47d16a", "#6fb0ff"],
      wood: "#9a6230", woodDk: "#6a3e18", wheel: "#e8e0c8", ox: "#c07a3a", oxDk: "#8a5226",
      covers: ["#e8ffe8", "#a08a60", "#a77ef0"], coverSh: ["#b6d8b6", "#7a6644", "#7a52c0"],
      ink: "#b6f7c0", ink2: "#f0c060", panel: "#000000", panelLine: "#47d16a", strip: "#000000", stripLine: "#2f7d3a",
      pin: "#47d16a", plate: "#000000",
      idx: ["#ff7ab8", "#7fb2ff", "#8fe36a"], warn: "#ffc04d", bad: "#ff7a66", cell: "#173a1d", nbCol: ["#a9bca5", "#c99bff"]
    }
  };

  /* ---------- 픽셀 버퍼 ---------- */
  let BUF = null;
  function buffer(W, H) {
    if (!BUF) BUF = document.createElement("canvas");
    if (BUF.width !== W) BUF.width = W;
    if (BUF.height !== H) BUF.height = H;
    const c = BUF.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    return c;
  }
  function R(c, x, y, w, h, col) {
    if (!col || w <= 0 || h <= 0) return;
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  // 바둑판 점 한 줄(80년대 화면의 디더링)
  function dither(c, x0, x1, y, col, odd) {
    c.fillStyle = col;
    for (let x = Math.round(x0) + ((y + (odd ? 1 : 0)) & 1); x < x1; x += 2) c.fillRect(x, y, 1, 1);
  }

  /* ---------- 풍경 조각 ---------- */
  function tree(c, x, yb, P, h) {
    R(c, x + 1, yb - 2, 1, 2, P.trunk);
    R(c, x + 1, yb - h, 1, 1, P.tree);
    for (let r = 1; r < h - 2; r++) R(c, x, yb - h + r, 3, 1, r & 1 ? P.treeDk : P.tree);
    R(c, x, yb - 3, 3, 1, P.treeDk);
  }
  function stump(c, x, yb, P) {
    R(c, x, yb - 2, 2, 2, P.stump);
    R(c, x, yb - 2, 2, 1, P.stumpLt);
  }
  function cabin(c, x, yb, P) {
    R(c, x, yb - 3, 5, 3, P.cabin);
    R(c, x + 4, yb - 3, 1, 3, P.cabinSh);
    R(c, x + 2, yb - 2, 1, 2, P.win);
    R(c, x - 1, yb - 4, 7, 1, P.roof);
    R(c, x + 1, yb - 5, 3, 1, P.roof);
  }
  function tower(c, x, yb, P, h, blink) {
    R(c, x + 1, yb - h, 1, h, P.tower);
    for (let y = yb - 2; y > yb - h + 1; y -= 2) R(c, x, y, 3, 1, P.tower);
    R(c, x, yb - 1, 1, 1, P.tower);
    R(c, x + 2, yb - 1, 1, 1, P.tower);
    if (blink) R(c, x + 1, yb - h - 1, 1, 1, P.beacon);
  }
  function rainCloud(c, x, y, P, t) {
    R(c, x + 1, y, 4, 1, P.cloudRain);
    R(c, x, y + 1, 6, 1, P.cloudRain);
    const f = Math.floor(t * 4) & 1;
    R(c, x + 1 + f, y + 3, 1, 1, P.rain);
    R(c, x + 4 - f, y + 4, 1, 1, P.rain);
  }
  // 마차: x = 소의 앞 끝, yb = 바퀴가 닿는 줄. big이면 덮개가 크다.
  function wagon(c, x, yb, P, k, frame, big) {
    const cov = P.covers[k], sh = P.coverSh[k];
    const ow = big ? 6 : 5;
    const bw = big ? 13 : 10;
    const bx = x - ow - 4 - bw;
    // 소
    R(c, x - ow - 1, yb - 5, ow, 3, P.ox);
    R(c, x - ow - 1, yb - 3, ow, 1, P.oxDk);
    R(c, x - 2, yb - 6, 2, 2, P.ox);
    R(c, x - 1, yb - 7, 1, 1, P.oxDk);
    const lf = frame ? 1 : 0;
    R(c, x - ow - 1 + lf, yb - 2, 1, 2, P.oxDk);
    R(c, x - 3 - lf, yb - 2, 1, 2, P.oxDk);
    // 끌채
    R(c, x - ow - 4, yb - 4, 3, 1, P.woodDk);
    // 짐칸
    R(c, bx, yb - 5, bw, 2, P.wood);
    R(c, bx, yb - 3, bw, 1, P.woodDk);
    // 덮개(둥근 지붕과 테)
    const ch = big ? 7 : 5;
    R(c, bx + 1, yb - 5 - ch, bw - 2, ch, cov);
    R(c, bx + 2, yb - 6 - ch, bw - 4, 1, cov);
    R(c, bx, yb - 4 - ch, 1, ch - 1, cov);
    R(c, bx + bw - 1, yb - 4 - ch, 1, ch - 1, cov);
    R(c, bx + 1, yb - 6, bw - 2, 1, sh);
    for (let i = 3; i < bw - 2; i += big ? 4 : 3) R(c, bx + i, yb - 5 - ch, 1, ch - 1, sh);
    // 바퀴(살이 번갈아 돈다)
    [bx + 1, bx + bw - 4].forEach(wx => {
      R(c, wx, yb - 3, 3, 3, P.wheel);
      R(c, wx + 1, yb - 2, 1, 1, frame ? P.wood : P.wheel);
      if (!frame) { R(c, wx, yb - 3, 1, 1, P.wood); R(c, wx + 2, yb - 1, 1, 1, P.wood); }
      else { R(c, wx + 2, yb - 3, 1, 1, P.wood); R(c, wx, yb - 1, 1, 1, P.wood); }
    });
    return { cx: bx + bw / 2, top: yb - 6 - ch };
  }

  /* ---------- 마차 위치(바뀌면 부드럽게 따라감) ---------- */
  const MOVE = { x: null, nb: [null, null], t: -1 };
  function ease(cur, target, dt) {
    if (cur === null || !isFinite(cur) || dt <= 0 || dt > 1) return target;
    const v = cur + (target - cur) * (1 - Math.exp(-dt * 3.2));
    return Math.abs(target - v) < 0.05 ? target : v;
  }

  /* ---------- 그리기 ---------- */
  function render(ctx) {
    const g = ctx.g, w = ctx.w, h = ctx.h;
    const st = read(ctx);
    const dark = ctx.scheme === "dark";
    const P = dark ? PAL.dark : PAL.light;
    const thumb = !!ctx.thumb;
    const still = thumb || !!ctx.reduced;
    const t = still ? 0 : ctx.t;
    const frame = still ? 0 : Math.floor(t * 5) & 1;
    const n = st.n;

    // 배치: 오른쪽 계기판(넓은 화면), 아래 이정표 띠, 나머지는 풍경
    const panelW = !thumb && w >= 720 && h >= 90 ? clamp(Math.round(w * 0.22), 220, 270) : 0;
    const stripH = h >= 120 ? 42 : h >= 104 ? 34 : 0;
    const LW = w - panelW, LH = h - stripH;
    const px = w >= 900 ? 3 : 2;
    const BW = Math.max(60, Math.ceil(LW / px)), BH = Math.max(24, Math.ceil(LH / px));
    const c = buffer(BW, BH);

    const hz = Math.round(BH * 0.4);
    const trailH = BH >= 60 ? 12 : BH >= 40 ? 10 : 8;
    const trailTop = BH - trailH - 1;
    const x0 = 26, x10 = BW - 4;
    const seg = (x10 - x0) / 10;
    const xp = i => Math.round(x0 + seg * i);

    // 하늘
    const b1 = Math.round(hz * 0.42), b2 = Math.round(hz * 0.78);
    R(c, 0, 0, BW, b1, P.sky[0]);
    R(c, 0, b1, BW, b2 - b1, P.sky[1]);
    R(c, 0, b2, BW, hz - b2 + 2, P.sky[2]);
    if (P.sky[0] !== P.sky[1]) { dither(c, 0, BW, b1, P.sky[0], 0); dither(c, 0, BW, b2, P.sky[1], 0); }
    const envNow = st.mine[2];
    if (n && envNow < 0) {
      // 환경 지수가 음수면 지평선 쪽이 뿌옇다
      const rows = Math.min(hz - 2, 2 + Math.abs(envNow));
      for (let r = 0; r < rows; r++) dither(c, 0, BW, hz - 1 - r, P.haze, r & 1);
    }
    if (P.star) {
      for (let i = 0; i < 46; i++) {
        const sx = Math.floor(hash(i, 7) * BW), sy = Math.floor(hash(i, 11) * Math.max(1, hz - 4));
        if (still || hash(i, Math.floor(t * 2)) > 0.12) R(c, sx, sy, 1, 1, P.star[i % 3]);
      }
    }
    // 해·달
    const sunX = BW - 16, sunY = Math.max(4, Math.round(hz * 0.3));
    R(c, sunX - 1, sunY - 3, 4, 7, P.sun);
    R(c, sunX - 3, sunY - 1, 8, 3, P.sun);
    R(c, sunX - 2, sunY - 2, 6, 5, P.sun);
    if (dark) R(c, sunX + 1, sunY - 2, 3, 4, P.sky[0]);
    else R(c, sunX - 1, sunY - 1, 2, 2, P.sunLt);
    // 구름(밝은 화면): 천천히 흐른다
    if (P.cloud) {
      for (let i = 0; i < 3; i++) {
        const span = BW + 30;
        const cx = ((hash(i, 3) * span + t * (1.2 + i * 0.5)) % span) - 15;
        const cy = 2 + Math.floor(hash(i, 5) * Math.max(1, hz * 0.45));
        R(c, cx + 2, cy, 7, 1, P.cloud);
        R(c, cx, cy + 1, 12, 2, P.cloud);
        R(c, cx + 1, cy + 3, 10, 1, P.cloudSh);
      }
    }
    // 먼 산(보라)과 언덕(초록): 옆으로 흐르는 시차. 환경 지수가 낮을수록 언덕이 마른다.
    const dry = n ? clamp((1 - envNow) / 5, 0, 1) : 0;
    const scrollA = t * 1.5, scrollB = t * 3;
    for (let x = 0; x < BW; x++) {
      const u = x + scrollA;
      const m = Math.round(hz - 3 - 6 * (0.5 + 0.5 * Math.sin(u * 0.07)) - 4 * (0.5 + 0.5 * Math.sin(u * 0.023 + 1.3)));
      R(c, x, m, 1, hz - m + 1, (Math.floor(u) % 9) < 2 ? P.mtnDk : P.mtn);
      const v = x + scrollB;
      const hl = Math.round(hz - 2 * (0.5 + 0.5 * Math.sin(v * 0.11 + 0.4)) - 1);
      const useDry = hash(Math.floor(v), 41) < dry;
      R(c, x, hl, 1, hz - hl + 2, useDry ? P.dry : P.hill);
      if (((Math.floor(v) + hl) & 3) === 0) R(c, x, hl, 1, 1, useDry ? P.dryDk : P.hillDk);
    }
    // 들판
    R(c, 0, hz + 2, BW, trailTop - hz - 2, P.ground);
    for (let y = hz + 3; y < trailTop; y += 3) {
      for (let x = 0; x < BW; x++) {
        if (hash(x, y * 131 + 17) < 0.07) R(c, x, y, 1, 1, hash(x, y * 7 + 3) < dry ? P.groundDk : P.grass);
      }
    }
    // 길
    R(c, 0, trailTop, BW, trailH + 1, P.trail);
    R(c, 0, trailTop, BW, 1, P.trailDk);
    for (let x = 0; x < BW; x++) {
      if (hash(x, 23) < 0.14) R(c, x, trailTop + 2 + Math.floor(hash(x, 29) * (trailH - 3)), 1, 1, P.trailLt);
    }
    R(c, 0, trailTop + Math.round(trailH * 0.45), BW, 1, P.rut);
    R(c, 0, BH - 3, BW, 1, P.rut);
    R(c, 0, BH - 1, BW, 1, P.trailDk);

    // 아직 가지 않은 길: 들판에 옅은 안개
    if (n < 10) {
      for (let y = hz + 3; y < trailTop; y += 2) dither(c, xp(n) + 2, BW, y, P.fog, (y >> 1) & 1);
    }

    // 고른 해마다 그 해 구간의 풍경(과학 → 연구 탑, 행복 → 마을, 환경 + → 나무, 환경 − → 그루터기, 행복 − → 비구름)
    const baseY = trailTop - 1;
    const zoneH = trailTop - hz - 4;
    st.res.rows.forEach((row, i) => {
      const d = row.d;
      const avail = Math.max(4, xp(i + 1) - xp(i) - 3);
      const cnt = {
        tower: d[0] > 0 ? 1 : 0,
        cabin: d[1] > 0 ? Math.min(d[1], 3) : 0,
        tree: d[2] > 0 ? Math.min(d[2], 4) : 0,
        stump: d[2] < 0 ? Math.min(-d[2], 3) : 0
      };
      const W = { tower: 4, cabin: 7, tree: 4, stump: 3 };
      const width = () => Object.keys(cnt).reduce((s, k) => s + cnt[k] * W[k], 0);
      let guard = 20;
      while (width() > avail && guard-- > 0) {
        const k = ["cabin", "tree", "stump"].filter(q => cnt[q] > 1).sort((a, b) => cnt[b] * W[b] - cnt[a] * W[a])[0];
        if (k) cnt[k] -= 1;
        else if (cnt.tower) cnt.tower = 0;
        else break;
      }
      let x = xp(i) + 2;
      if (cnt.tower) {
        const th = clamp(4 + d[0] * 2, 5, Math.max(5, zoneH));
        tower(c, x, baseY, P, th, still || ((Math.floor(t * 2) + i) & 1) === 0);
        x += W.tower;
      }
      for (let k = 0; k < cnt.cabin; k++) { cabin(c, x + 1, baseY - (k & 1), P); x += W.cabin; }
      for (let k = 0; k < cnt.tree; k++) { tree(c, x, baseY - (k % 2), P, 5 + ((i + k) % 3)); x += W.tree; }
      for (let k = 0; k < cnt.stump; k++) { stump(c, x, baseY, P); x += W.stump; }
      if (d[1] < 0) rainCloud(c, xp(i) + Math.max(0, (seg - 6) / 2), Math.max(2, hz - 9), P, t);
    });

    // 이정표 말뚝(1–10년 차)
    for (let i = 1; i <= 10; i++) {
      const x = xp(i);
      R(c, x, trailTop - 4, 1, 4, i <= n ? P.pole : P.trailDk);
      R(c, x - 1, trailTop - 5, 3, 2, i <= n ? P.pin : P.trailDk);
    }
    // 사건: 전염병(4년 차 노란 깃발), 세계 박람회(7년 차 깃발 줄). 게임 화면이 알린 뒤에만 그린다.
    if (n >= 3 && st.res.epi) {
      const fx = Math.round(xp(3) + seg * 0.5);
      R(c, fx, baseY - 9, 1, 9, P.pole);
      R(c, fx + 1, baseY - 9 + frame, 4, 3, P.flag);
      R(c, fx + 2, baseY - 8 + frame, 1, 1, P.bad);
    }
    if (n >= 6 && st.res.fair) {
      const a = xp(6) + 1, b = xp(7) - 1;
      R(c, a, baseY - 10, 1, 10, P.pole);
      R(c, b, baseY - 10, 1, 10, P.pole);
      for (let x = a + 1, k = 0; x < b - 1; x += 3, k++) {
        const y = baseY - 10 + Math.round(2 * Math.sin(((x - a) / Math.max(1, b - a)) * Math.PI));
        R(c, x, y, 2, 1, P.bunt[k % 4]);
        R(c, x, y + 1, 1, 1, P.bunt[k % 4]);
      }
    }

    // 마차: 이웃 두 대는 뒤 바퀴 자국, 가람국은 앞 자국. 이웃은 같은 해 세 지수 합의 차이만큼 앞뒤로.
    const dt = MOVE.t >= 0 ? ctx.t - MOVE.t : 0;
    if (!thumb) MOVE.t = ctx.t;
    const unit = Math.max(2, seg * 0.3);
    const tx = xp(n);
    const myX = Math.round(still ? tx : (MOVE.x = ease(MOVE.x, tx, dt)));
    const nbX = st.nbs.map((nb, j) => {
      const target = clamp(tx + clamp(nb.diff, -8, 8) * unit, 22, BW - 1);
      return Math.round(still ? target : (MOVE.nb[j] = ease(MOVE.nb[j], target, dt)));
    });
    const backY = [trailTop + Math.round(trailH * 0.45) + 2, trailTop + 4];
    const boxes = [];
    [1, 0].forEach(j => { boxes[j + 1] = wagon(c, nbX[j], backY[j], P, j + 1, frame ^ j, false); });
    boxes[0] = wagon(c, myX, BH - 2, P, 0, frame, true);

    // 버퍼를 키워 붙인다(최근접 보간)
    g.imageSmoothingEnabled = false;
    g.drawImage(BUF, 0, 0, BW, BH, 0, 0, BW * px, BH * px);
    if (BW * px < LW) { g.fillStyle = P.trailDk; g.fillRect(BW * px, 0, LW - BW * px, LH); }

    const mono = '"IBM Plex Mono", "IBM Plex Sans KR", "Noto Sans KR", ui-monospace, monospace';
    const sans = '"IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';

    // 이름표: 하늘에 나라 이름, 점선으로 마차와 잇는다(겹치면 줄을 바꾼다)
    if (!thumb) {
      const fs = LW < 500 ? 11 : 12;
      g.font = `700 ${fs}px ${sans}`;
      const tags = [
        { k: 0, x: boxes[0].cx * px, top: boxes[0].top * px, text: n ? `가람국 ${n}년 차` : "가람국 출발", lv: "" },
        { k: 1, x: boxes[1].cx * px, top: boxes[1].top * px, text: st.nbs[0].name + (st.nbs[0].lv ? " 대비 " + LEVEL_WORD[st.nbs[0].lv] : ""), lv: st.nbs[0].lv },
        { k: 2, x: boxes[2].cx * px, top: boxes[2].top * px, text: st.nbs[1].name + (st.nbs[1].lv ? " 대비 " + LEVEL_WORD[st.nbs[1].lv] : ""), lv: st.nbs[1].lv }
      ];
      const used = [];
      const tagH = fs + 7;
      // 들판까지 내려와도 되지만 길은 가리지 않는다. 자리가 없으면 이웃 이름표는 생략한다(계기판·설명에 값이 있다).
      const rows = Math.max(1, Math.min(3, Math.floor((trailTop * px - 8) / (tagH + 2))));
      tags.forEach(tg => {
        const tw = Math.ceil(g.measureText(tg.text).width) + 12;
        const x = Math.round(clamp(tg.x - tw / 2, 2, LW - tw - 2));
        let r = 0;
        const clash = q => used.some(u => u.r === q && x < u.x1 + 4 && x + tw > u.x0 - 4);
        while (r < rows && clash(r)) r++;
        if (r >= rows) return;
        used.push({ r, x0: x, x1: x + tw });
        const y = 3 + r * (tagH + 2);
        const edge = tg.lv ? (tg.lv === "bad" ? P.bad : P.warn) : (tg.k === 0 ? P.ink : P.nbCol[tg.k - 1]);
        g.fillStyle = edge;
        for (let yy = y + tagH + 1; yy < tg.top - 1; yy += 3) g.fillRect(Math.round(tg.x), yy, 1, 2);
        g.fillStyle = P.plate;
        g.fillRect(x, y, tw, tagH);
        g.fillStyle = edge;
        g.fillRect(x, y, tw, 1); g.fillRect(x, y + tagH - 1, tw, 1); g.fillRect(x, y, 1, tagH); g.fillRect(x + tw - 1, y, 1, tagH);
        g.fillRect(x, y, 3, tagH);
        g.fillStyle = tg.lv ? edge : P.ink;
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.fillText(tg.text, x + 7, y + tagH / 2 + 0.5);
      });
    }

    // 이정표 띠: 1–10년 차 핀과 고른 항목 번호
    if (stripH) {
      const y0 = LH;
      g.fillStyle = P.strip;
      g.fillRect(0, y0, LW, stripH);
      g.fillStyle = P.stripLine;
      g.fillRect(0, y0, LW, 1);
      const py = y0 + Math.round(stripH * (stripH >= 40 ? 0.5 : 0.62));
      for (let x = Math.round(xp(0) * px); x < Math.round(xp(10) * px); x += 4) g.fillRect(x, py, 2, 1);
      g.fillRect(Math.round(xp(0) * px) - 1, py - 4, 2, 9);
      const fsS = LW < 500 ? 10.5 : 11.5;
      for (let i = 1; i <= 10; i++) {
        const x = Math.round(xp(i) * px);
        const on = i <= n;
        const s = 4;
        g.fillStyle = on ? P.pin : P.strip;
        g.fillRect(x - s, py - s, s * 2, s * 2);
        g.fillStyle = on ? P.pin : P.stripLine;
        g.fillRect(x - s, py - s, s * 2, 1); g.fillRect(x - s, py + s - 1, s * 2, 1);
        g.fillRect(x - s, py - s, 1, s * 2); g.fillRect(x + s - 1, py - s, 1, s * 2);
        if (i === n + 1 && !thumb && (still || frame === 0)) {
          g.fillStyle = P.ink;
          g.fillRect(x - s - 2, py - s - 2, s * 2 + 4, 1); g.fillRect(x - s - 2, py + s + 1, s * 2 + 4, 1);
          g.fillRect(x - s - 2, py - s - 2, 1, s * 2 + 4); g.fillRect(x + s + 1, py - s - 2, 1, s * 2 + 4);
        }
        if (!thumb) {
          g.textAlign = "center";
          g.textBaseline = "alphabetic";
          if (stripH >= 40) {
            g.font = `600 ${fsS}px ${mono}`;
            g.fillStyle = P.ink2;
            g.fillText(String(i), x, y0 + stripH - 3);
          }
          g.font = `700 ${fsS}px ${mono}`;
          g.fillStyle = on ? P.ink : P.ink2;
          g.fillText(on && st.plan[i - 1] ? st.plan[i - 1] : stripH >= 40 ? "" : String(i), x, py - s - 3);
        }
      }
    }

    // 계기판: 과학·행복·환경 누적 지수(−5…15 막대)와 같은 해 이웃 값
    if (panelW) {
      const X = LW, W = panelW;
      g.fillStyle = P.panel;
      g.fillRect(X, 0, W, h);
      g.fillStyle = P.panelLine;
      g.fillRect(X, 0, 2, h);
      g.fillRect(X + 6, 5, W - 11, 1); g.fillRect(X + 6, h - 6, W - 11, 1);
      g.fillRect(X + 6, 5, 1, h - 10); g.fillRect(X + W - 6, 5, 1, h - 10);
      const ix = X + 16, iw = W - 32;
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.font = `700 12.5px ${sans}`;
      g.fillStyle = P.ink;
      const compact = h < 150;
      g.fillText(n ? `국가 지수 · ${n}년 차 누적` : "국가 지수 · 출발 전", ix, compact ? 21 : 24);
      const top = compact ? 26 : 32, rowH = (h - top - 9) / 3;
      const cells = 20, cw = iw / cells;
      for (let k = 0; k < 3; k++) {
        const y = top + k * rowH;
        const v = st.mine[k];
        const lv = st.lv[k];
        g.textAlign = "left";
        g.font = `700 13px ${sans}`;
        g.fillStyle = P.idx[k];
        g.fillText(NAMES[k], ix, y + 14);
        if (lv) {
          g.font = `700 12px ${sans}`;
          g.fillStyle = lv === "bad" ? P.bad : P.warn;
          g.fillText(LEVEL_WORD[lv] + " 수준", ix + 38, y + 14);
        }
        g.font = `700 15px ${mono}`;
        g.fillStyle = P.ink;
        g.textAlign = "right";
        g.fillText(fmt(v), ix + iw, y + 15);
        g.textAlign = "left";
        const by = y + (compact ? 18 : 20), bh = compact ? 5 : 9;
        const zero = 5;
        for (let i = 0; i < cells; i++) {
          const val = i - zero;
          const fill = v > 0 ? val >= 0 && val < v : v < 0 ? val < 0 && val >= v : false;
          g.fillStyle = fill ? (v < 0 ? P.bad : P.idx[k]) : P.cell;
          g.fillRect(Math.round(ix + i * cw), by, Math.max(1, Math.round(cw) - 2), bh);
        }
        g.fillStyle = P.ink;
        g.fillRect(Math.round(ix + zero * cw) - 1, by - 2, 1, bh + 4);
        if (!compact) {
          g.font = `500 11.5px ${sans}`;
          g.fillStyle = P.ink2;
          g.fillText(`나람국 ${fmt(st.nbs[0].cum[k])} · 다람국 ${fmt(st.nbs[1].cum[k])}`, ix, by + bh + 14);
        }
      }
    }

    // 칩과 설명
    const chips = [{ label: "연차", value: `${n} / 10` }];
    NAMES.forEach((nm, k) => {
      const lv = st.lv[k];
      chips.push({ label: nm, value: fmt(st.mine[k]) + (lv ? " " + LEVEL_WORD[lv] : ""), tone: lv || "" });
    });
    const route = st.plan.map((id, i) => `${i + 1}년 ${id} ${IT[id][0]}`).join(", ");
    const warnTxt = NAMES.map((nm, k) => (st.lv[k] ? `${nm} ${LEVEL_WORD[st.lv[k]]} 수준` : "")).filter(Boolean).join(", ");
    const nbTxt = st.nbs.map(nb => `${nb.name} 마차는 세 지수 합이 ${nb.diff === 0 ? "같아 나란히" : Math.abs(nb.diff) + (nb.diff > 0 ? " 높아 앞에" : " 낮아 뒤에")} 있습니다`).join(". ");
    const ev = [];
    if (n >= 3 && st.res.epi) ev.push("4년 차 전염병 깃발");
    if (n >= 6 && st.res.fair) ev.push("7년 차 박람회 깃발 줄");
    const caption = n
      ? `가람국 개척 길 그림. ${n}년 차까지 ${st.hiddenYears ? "누적을 확인한 항목" : "고른 항목"}: ${route}. 누적 과학 ${st.mine[0]}, 행복 ${st.mine[1]}, 환경 ${st.mine[2]}.` +
        `${warnTxt ? " 이웃보다 낮은 지수: " + warnTxt + "." : ""} ${nbTxt}.${ev.length ? " " + ev.join(", ") + "." : ""}`
      : st.hiddenYears
        ? "가람국 개척 길 그림. 누적을 확인한 해가 아직 없어 세 나라 마차가 출발점에 서 있습니다."
        : "가람국 개척 길 그림. 아직 고른 실행 항목이 없어 세 나라 마차가 출발점에 서 있습니다.";
    return { caption, chips, animate: !still };
  }

  KCP.v2.skin("2023", { kicker: "TRAIL LOG · 10-YEAR PLAN", title: "가람국 개척 길 · 10년 계획", render });
})();
