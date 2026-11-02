/* 심야 셔틀 장면: 80년대 중반 아케이드의 유사 3D 야간 주행 오마주
 * - 줄무늬가 지평선으로 좁아지는 굽은 도로, 시선유도봉과 가로등, 신스웨이브 밤하늘, 공단·아파트 실루엣,
 *   네온 계기판(세그먼트 숫자), 뒤에서 본 상자형 자율주행 셔틀과 미등.
 * - 게임 상태는 읽기만 한다. 계산은 게임 모델(ctx.model)의 normalizedCopy·safe·distance·zone을 쓴다.
 * - 감지 거리 R과 감속도 범위(lo~hi)는 준비실 '노선과 차량' 표에 공개된 값이다.
 *   숨은 감속도는 성찰 단계의 해설에서만 공개되므로 장면에서는 쓰지 않는다.
 *   정지 표시는 게임 문구의 '필요 감지 거리'(반응 0.5초 + 제동 + 여유 5 m)를 감속도 범위로 그린다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  const ORDER = ["clear", "rain", "fog"];
  const COND = {
    clear: { name: "맑은 밤", short: "맑음", R: 80, lo: 6.5, hi: 7 },
    rain: { name: "비 오는 밤", short: "비", R: 45, lo: 3, hi: 5 },
    fog: { name: "안개 낀 밤", short: "안개", R: 20, lo: 4, hi: 5.5 }
  };
  // 게임의 정지 조건 문구와 같은 뜻
  const ZONE_TEXT = {
    ban: "운행 금지 선택",
    below: "감속도 범위 전체에서 정지 조건 충족",
    band: "감속도에 따라 정지 조건 달라짐",
    above: "감속도 범위 전체에서 정지 조건 초과"
  };
  const ZONE_TONE = { below: "ok", band: "warn", above: "bad", ban: "volt" };
  const MODE = {
    auto: { text: "무인 허가", en: "PERMIT", tone: "ok" },
    staff: { text: "요원 탑승 허가", en: "PERMIT", tone: "ok" },
    deny: { text: "기준 미충족 불허", en: "DENIED", tone: "bad" },
    none: { text: "증거 부족 불허", en: "DENIED", tone: "bad" },
    ban: { text: "운행 금지", en: "CLOSED", tone: "volt" }
  };
  const MODE_SHORT = { auto: "허가", staff: "허가", deny: "불허", none: "불허", ban: "금지" };

  /* ---------- 작은 도구 ---------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const finite = x => typeof x === "number" && Number.isFinite(x);
  const fmt = (n, d) => { const p = 10 ** d; return (Math.round((n + Number.EPSILON) * p) / p).toFixed(d); };
  // 감속도 범위의 두 끝이 같은 값으로 보이면 하나만 쓴다.
  const span = (a, b, d) => (fmt(a, d) === fmt(b, d) ? `${fmt(a, d)} m` : `${fmt(a, d)}~${fmt(b, d)} m`);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const hexCache = {};
  let hexCount = 0;
  function rgbOf(hex) {
    if (hexCache[hex]) return hexCache[hex];
    if (++hexCount > 4000) { for (const key in hexCache) delete hexCache[key]; hexCount = 0; }
    const s = hex.replace("#", "");
    const v = [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
    hexCache[hex] = v;
    return v;
  }
  const hex2 = n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  // 두 색을 섞어 #rrggbb로 돌려준다(다시 섞을 수 있다).
  function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b), k = clamp(t, 0, 1);
    return `#${hex2(A[0] + (B[0] - A[0]) * k)}${hex2(A[1] + (B[1] - A[1]) * k)}${hex2(A[2] + (B[2] - A[2]) * k)}`;
  }
  function rgba(hex, a) {
    const A = rgbOf(hex);
    return `rgba(${A[0]},${A[1]},${A[2]},${clamp(a, 0, 1).toFixed(3)})`;
  }
  function rr(g, x, y, w, h, r) {
    const k = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + k, y);
    g.lineTo(x + w - k, y);
    g.arcTo(x + w, y, x + w, y + k, k);
    g.lineTo(x + w, y + h - k);
    g.arcTo(x + w, y + h, x + w - k, y + h, k);
    g.lineTo(x + k, y + h);
    g.arcTo(x, y + h, x, y + h - k, k);
    g.lineTo(x, y + k);
    g.arcTo(x, y, x + k, y, k);
    g.closePath();
  }
  // 초승달: 큰 원에서 비켜 놓은 원을 뺀다(큰 원 안으로 잘라 그린다).
  function crescent(g, x, y, r) {
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.clip();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.arc(x + r * 0.48, y - r * 0.26, r * 0.84, 0, Math.PI * 2);
    g.fill("evenodd");
    g.restore();
  }
  let fonts = null;
  function fontsOf() {
    if (fonts) return fonts;
    let mono = "", body = "";
    try {
      const cs = getComputedStyle(document.documentElement);
      mono = cs.getPropertyValue("--mono").trim();
      body = cs.getPropertyValue("--body").trim();
    } catch (e) { /* 기본 글꼴을 쓴다 */ }
    fonts = { mono: mono || "ui-monospace, monospace", body: body || "sans-serif" };
    return fonts;
  }

  /* ---------- 모델 함수: 게임 모델을 먼저 쓰고, 없을 때만 같은 식으로 대신한다 ---------- */
  const SAFE = (R, a) => (R <= 5 ? 0 : 3.6 * a * (-0.5 + Math.sqrt(0.25 + 2 * (R - 5) / a)));
  const DIST = (v, a) => { const w = v / 3.6; return w * 0.5 + w * w / (2 * a) + 5; };
  function tools(model) {
    const M = model && typeof model === "object" ? model : {};
    // 모델 함수가 없거나 이상한 값을 내면 같은 식의 대체 계산을 쓴다.
    const guard = (fn, alt) => (typeof fn !== "function" ? alt : (a, b) => {
      try { const x = fn(a, b); if (finite(x)) return x; } catch (e) { /* 대체 계산 */ }
      return alt(a, b);
    });
    const safe = guard(M.safe, SAFE);
    const distance = guard(M.distance, DIST);
    const zone = (c, v) => {
      if (typeof M.zone === "function") {
        try { const z = M.zone(c, v); if (Object.hasOwn(ZONE_TEXT, z)) return z; } catch (e) { /* 아래 식으로 대신한다 */ }
      }
      const k = COND[c];
      return v === 0 ? "ban" : v <= safe(k.R, k.lo) ? "below" : v <= safe(k.R, k.hi) ? "band" : "above";
    };
    return { safe, distance, zone };
  }

  // 저장 형식이 깨졌거나 비어 있어도 게임 자신의 정규화를 거친 값만 읽는다.
  let memo = { key: null, model: null, value: null };
  function readState(game, model) {
    let key = null;
    try { key = JSON.stringify(game); } catch (e) { key = null; }
    if (typeof key !== "string") key = null;
    if (key !== null && memo.key === key && memo.model === model && memo.value) return memo.value;
    let G = null;
    if (model && typeof model.normalizedCopy === "function") {
      try { G = model.normalizedCopy(game); } catch (e) { G = null; }
    }
    const src = G && typeof G === "object" ? G : (game && typeof game === "object" && !Array.isArray(game) ? game : {});
    const v = {};
    const def = { clear: 40, rain: 40, fog: 30 };
    for (const c of ORDER) {
      const x = src.v && typeof src.v === "object" ? src.v[c] : undefined;
      v[c] = finite(x) ? clamp(Math.round(x / 5) * 5, 0, 60) : def[c];
    }
    const band = ORDER.includes(src.band) ? src.band : "rain";
    const tests = Array.isArray(src.tests) ? src.tests.filter(t => t && typeof t === "object" && ORDER.includes(t.c)).slice(0, 10) : [];
    const per = { clear: 0, rain: 0, fog: 0 };
    tests.forEach(t => { per[t.c] += 1; });
    let modes = null;
    const L = G && G.locked && typeof G.locked === "object" ? G.locked : null;
    if (L && L.result && Array.isArray(L.result.rows)) {
      modes = {};
      for (const row of L.result.rows) if (row && ORDER.includes(row.c) && Object.hasOwn(MODE, row.mode)) modes[row.c] = row.mode;
      if (!ORDER.every(c => modes[c])) modes = null;
    }
    const value = { v, band, n: tests.length, per, locked: !!modes, modes };
    memo = { key, model, value };
    return value;
  }

  /* ---------- 색 ---------- */
  const PAL = {
    dark: {
      sky: ["#06041a", "#170a3c", "#3e0f5e", "#8a1d74"],
      skyRain: ["#07061a", "#131232", "#221f48", "#3a2b5c"],
      skyFog: ["#141128", "#262143", "#3d375f", "#615a82"],
      star: "#ffffff", moon: "#fff1d2", moonLow: "#ff9fd0",
      far: "#1d1242", near: "#0e0924", win: ["#ffd66b", "#39e2ff", "#ff5fd2"], winRate: 0.3,
      horizon: "#ff3fb4",
      groundA: "#0e0823", groundB: "#20154b", grid: "#8b3dff",
      roadA: "#1e1840", roadB: "#372d66", rumbleA: "#ff2e88", rumbleB: "#efe7ff", lane: "#efe7ff", center: "#ffd257",
      post: "#e9e3fb", reflector: "#ff9d2e", pole: "#2f2858", lamp: "#ffe7a8", pool: "#ffd98a",
      fog: "#3d3766", fogLight: "#9d94c6", rain: "#a9d8ff", veil: "#090616", fogVeil: "#5a5384",
      body: ["#f1ecff", "#bdb2e0"], bodyEdge: "#140d2e", glass: ["#120c30", "#2c2268"], tail: "#ff2b4f", amber: "#ffb23d",
      cone: "#39e2ff",
      ok: "#39e2ff", warn: "#ffc24a", bad: "#ff4d6d", volt: "#ffd257",
      plate: "#120d2b", plateText: "#f3eeff", plateLine: "#ff3fb4",
      hud: "#0d0926", hudLine: "#3d2f73", hudSel: "#39e2ff", hudText: "#f3eeff", hudDim: "#a99bd6",
      segOn: "#ffe066", segOnDim: "#d9cfff", segOff: "rgba(255,255,255,0.07)", segGlow: "rgba(255,224,102,0.25)",
      arcBase: "#2a2152", needle: "#ff5fd2", scan: "rgba(0,0,0,0.16)", tagInk: "#0a0820", stampBg: "rgba(13,9,38,0.88)"
    },
    light: {
      sky: ["#a493dd", "#c9a8e4", "#f2b4cf", "#ffd8ad"],
      skyRain: ["#8e86ad", "#a9a0c4", "#c4b9d6", "#ddd2e2"],
      skyFog: ["#c9c1df", "#ddd6eb", "#ebe5f3", "#f4effa"],
      star: "#fffaf0", moon: "#ffe27a", moonLow: "#ff6fa0",
      far: "#a68fd2", near: "#7a5fb4", win: ["#fff3c4", "#ffe08a", "#ffd0ea"], winRate: 0.16,
      horizon: "#ff5fa8",
      groundA: "#8c76c4", groundB: "#7b65b4", grid: "#f3e9ff",
      roadA: "#55458a", roadB: "#6c5ba6", rumbleA: "#ff4f9a", rumbleB: "#fff6ea", lane: "#fff6ea", center: "#ffd257",
      post: "#fffaf0", reflector: "#ff7a2e", pole: "#4d3c7c", lamp: "#fff3c4", pool: "#fff0c0",
      fog: "#efe8f7", fogLight: "#faf6ff", rain: "#4a3b78", veil: "#f6f0fd", fogVeil: "#f6f0fd",
      body: ["#fffdf7", "#cfc4ea"], bodyEdge: "#2a1858", glass: ["#2a1d5c", "#4b3b8c"], tail: "#ff2b4f", amber: "#ff9d1c",
      cone: "#7ff0ff",
      ok: "#18c1dc", warn: "#ffb020", bad: "#ff3d64", volt: "#ffc93d",
      plate: "#fffbf2", plateText: "#24124a", plateLine: "#8a1c9e",
      hud: "#fffbf2", hudLine: "#b9a5e0", hudSel: "#8a1c9e", hudText: "#24124a", hudDim: "#5b4985",
      segOn: "#2a1458", segOnDim: "#5b4985", segOff: "rgba(42,20,88,0.08)", segGlow: null,
      arcBase: "#e4daf5", needle: "#c2187a", scan: "rgba(36,18,74,0.06)", tagInk: "#ffffff", stampBg: "rgba(255,251,242,0.92)",
      okInk: "#0a7f9a", warnInk: "#9a5b00", badInk: "#c21f4a", voltInk: "#8f5300"
    }
  };
  const FOG_DIST = { clear: 520, rain: 150, fog: 46 };

  /* ---------- 장면 배치 ---------- */
  // 왕복 4차로를 뒤에서 따라가는 추적 카메라. 화면 가운데가 셔틀 차로다.
  const D = 42; // 카메라 깊이 상수(m): 지평선 쪽 압축 정도
  const ROAD = 7.4; // 도로 반폭(m)
  const LANE = 1.8; // 셔틀이 달리는 차로 중심(중앙선 오른쪽, m)
  const CAM_H = 4.4; // 카메라 높이(m): 클수록 도로가 좁아 보인다
  const SHUTTLE_LEN = 4.5; // 앞 범퍼(z = 0)에서 뒤 범퍼까지(m)
  function layout(w, h, thumb) {
    const compact = w < 620; // 넓은 계기판(약 390 px)과 제목판이 함께 들어가지 않는 폭
    const short = h < 230; // 면접실·성찰, 모바일 준비실
    const tiny = h < 160; // 모바일 면접실·성찰
    const botPad = thumb ? 4 : compact ? (tiny ? 34 : 38) : 40;
    const hy = Math.round(h * (thumb ? 0.42 : tiny ? 0.4 : short ? 0.38 : 0.36));
    const sRear = D / (D - SHUTTLE_LEN);
    const yRear = h - botPad;
    const RH = Math.max(12, (yRear - hy) / sRear);
    const k = RH / CAM_H; // z = 0에서 1 m의 화면 폭
    const shH = (yRear - hy) * (thumb ? 0.5 : compact ? 0.44 : 0.4);
    const shW = shH * 0.9;
    // 넓은 계기판은 화면이 넓을 때만: 좁거나 중간 폭이면 오른쪽 위 작은 계기판(소실점 오른쪽)
    const miniHud = thumb || w < 900;
    return { w, h, thumb, compact, short, tiny, miniHud, hy, RH, k, cx: w * 0.5, bend: 0, yRear, shH, shW, sRear, botPad };
  }
  function at(L, lat, z) {
    const s = D / (z + D), p = Math.max(0, 1 - s);
    return { x: L.cx + L.bend * p * p + (lat - LANE) * L.k * s, y: L.hy + L.RH * s, s };
  }
  const zOfY = (L, y) => D * L.RH / Math.max(0.001, y - L.hy) - D;

  /* ---------- 고정 무작위 자료(크기별) ---------- */
  const staticCache = new Map();
  function statics(w, h) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (staticCache.has(key)) return staticCache.get(key);
    const r = rng(0x5eed + Math.round(w) * 7 + Math.round(h));
    const stars = Array.from({ length: Math.round(clamp(w * h / 2600, 24, 150)) }, () => ({ x: r(), y: r(), s: r(), p: r() * 6.28 }));
    const build = (n, minH, maxH, seed) => {
      const q = rng(seed);
      const out = [];
      let x = -0.02;
      while (x < 1.02 && out.length < n) {
        const wd = 0.012 + q() * 0.035;
        const left = x < 0.48;
        const kind = left ? (q() < 0.28 ? "chimney" : q() < 0.55 ? "saw" : "block") : (q() < 0.18 ? "tower" : "apt");
        const hh = minH + q() * (maxH - minH) * (kind === "chimney" ? 1.25 : kind === "tower" ? 1.3 : 1);
        out.push({ x, wd: kind === "chimney" ? wd * 0.35 : wd, h: hh, kind, seed: Math.floor(q() * 1e9) });
        x += (kind === "chimney" ? wd * 0.6 : wd) + q() * 0.012;
      }
      return out;
    };
    const far = build(90, 0.12, 0.34, 0x51a7);
    const near = build(70, 0.18, 0.5, 0x9c1e);
    const drops = Array.from({ length: Math.round(clamp(w * h / 1800, 30, 260)) }, () => ({ x: r(), y: r(), l: 0.6 + r() * 0.8, sp: 0.8 + r() * 0.5 }));
    const wisps = Array.from({ length: 7 }, () => ({ x: r(), y: r(), w: 0.3 + r() * 0.4, sp: 0.4 + r() * 0.8 }));
    const v = { stars, far, near, drops, wisps };
    if (staticCache.size > 12) staticCache.clear();
    staticCache.set(key, v);
    return v;
  }

  /* ---------- 하늘 ---------- */
  function skyGradient(g, L, pal, band) {
    const c = band === "rain" ? pal.skyRain : band === "fog" ? pal.skyFog : pal.sky;
    const gr = g.createLinearGradient(0, 0, 0, L.hy);
    gr.addColorStop(0, c[0]);
    gr.addColorStop(0.45, c[1]);
    gr.addColorStop(0.8, c[2]);
    gr.addColorStop(1, c[3]);
    return gr;
  }
  function drawSky(g, L, pal, band, scheme, T, st, anim) {
    const sky = skyGradient(g, L, pal, band);
    g.fillStyle = sky;
    g.fillRect(0, 0, L.w, L.hy + 1);
    // 별: 맑은 밤에 가장 많이, 안개에는 몇 개만
    const starAlpha = band === "clear" ? 1 : band === "fog" ? 0.25 : 0;
    if (starAlpha > 0) {
      const lightSky = scheme === "light";
      for (const s of st.stars) {
        if (lightSky && s.y > 0.45) continue;
        const tw = anim ? 0.55 + 0.45 * Math.sin(T * (1.4 + s.s * 2) + s.p) : 0.8;
        const a = starAlpha * (lightSky ? 0.55 : 1) * (0.35 + 0.65 * s.s) * tw;
        const size = s.s > 0.92 ? 2 : 1;
        const sx = Math.round(s.x * L.w), sy = Math.round(s.y * L.hy * 0.88);
        g.fillStyle = rgba(pal.star, a);
        g.fillRect(sx, sy, size, size);
        if (s.s > 0.96 && !L.thumb) { // 십자 반짝임
          g.fillRect(sx - 2, sy, 5, 1);
          g.fillRect(sx, sy - 2, 1, 5);
        }
      }
    }
    const vx = L.cx + L.bend;
    const dim = band === "clear" ? 1 : band === "rain" ? 0.35 : 0.45;
    if (scheme === "light") {
      // 새벽: 줄무늬가 들어간 해가 지평선에서 떠오른다
      const r = Math.min(L.hy * 0.6, L.w * 0.1);
      const cy = L.hy - r * 0.42;
      if (band !== "clear") {
        const halo = g.createRadialGradient(vx, cy, r * 0.3, vx, cy, r * 2.2);
        halo.addColorStop(0, rgba("#fff4d8", 0.5));
        halo.addColorStop(1, rgba("#fff4d8", 0));
        g.fillStyle = halo;
        g.fillRect(vx - r * 2.2, cy - r * 2.2, r * 4.4, L.hy - (cy - r * 2.2) + 1);
      }
      const gr = g.createLinearGradient(0, cy - r, 0, cy + r);
      gr.addColorStop(0, rgba(pal.moon, dim));
      gr.addColorStop(1, rgba(pal.moonLow, dim));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(vx, cy, r, Math.PI, 0);
      g.lineTo(vx + r, L.hy);
      g.lineTo(vx - r, L.hy);
      g.closePath();
      g.fill();
      // 신스웨이브 해의 가로 틈(하늘 그라데이션으로 다시 칠한다)
      g.fillStyle = sky;
      for (let i = 0; i < 7; i++) {
        const yy = cy - r * 0.3 + i * r * 0.15;
        const hh = 1 + i * r * 0.024;
        if (yy < L.hy) g.fillRect(vx - r - 1, yy, r * 2 + 2, Math.min(hh, L.hy - yy));
      }
    } else {
      // 밤: 초승달
      const r = Math.max(5, Math.min(L.hy * 0.17, 26));
      const mx = L.compact || L.thumb ? L.w * 0.3 : L.w * 0.27;
      const my = L.hy * (L.thumb ? 0.32 : 0.36);
      const glow = g.createRadialGradient(mx, my, r * 0.5, mx, my, r * (band === "fog" ? 5 : 3.2));
      glow.addColorStop(0, rgba(pal.moon, 0.28 * dim + (band === "fog" ? 0.12 : 0)));
      glow.addColorStop(1, rgba(pal.moon, 0));
      g.fillStyle = glow;
      g.fillRect(mx - r * 5, my - r * 5, r * 10, r * 10);
      g.fillStyle = rgba(pal.moon, band === "clear" ? 1 : band === "rain" ? 0.5 : 0.32);
      crescent(g, mx, my, r);
    }
    // 구름(비): 겹친 띠
    if (band === "rain") {
      for (let i = 0; i < 3; i++) {
        const yy = L.hy * (0.08 + i * 0.2);
        const drift = anim ? (T * (6 + i * 3)) % (L.w * 0.26) : 0;
        g.fillStyle = scheme === "light" ? rgba("#7d739f", 0.28 + i * 0.08) : rgba("#2b2652", 0.55 + i * 0.12);
        for (let j = -2; j < 5; j++) {
          const bx = j * L.w * 0.26 + drift + i * 40;
          g.beginPath();
          g.ellipse(bx, yy, L.w * 0.16, L.hy * 0.09, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  // 공단(왼쪽: 굴뚝·톱니 지붕)과 주거지(오른쪽: 아파트) 실루엣. 창문 불빛까지 한 번에 그린다.
  function skylineShapes(g, L, pal, band, st) {
    const haze = band === "fog" ? 0.72 : band === "rain" ? 0.32 : 0;
    const fogC = band === "fog" ? pal.fog : pal.skyRain[2];
    for (const [list, color, scaleH, alphaWin] of [[st.far, pal.far, 0.55, 0.62], [st.near, pal.near, 1, 1]]) {
      const col = haze ? mix(color, fogC, haze * (list === st.far ? 1 : 0.8)) : color;
      for (const b of list) {
        const x = Math.round(b.x * L.w), wd = Math.max(2, Math.round(b.wd * L.w));
        const hh = Math.round(b.h * L.hy * scaleH);
        const top = L.hy - hh;
        g.fillStyle = col;
        if (b.kind === "saw") {
          g.beginPath();
          g.moveTo(x, L.hy);
          g.lineTo(x, top + hh * 0.25);
          const teeth = Math.max(2, Math.round(wd / 7));
          for (let i = 0; i < teeth; i++) {
            const x0 = x + wd * i / teeth, x1 = x + wd * (i + 1) / teeth;
            g.lineTo(x0 + (x1 - x0) * 0.75, top);
            g.lineTo(x1, top + hh * 0.25);
          }
          g.lineTo(x + wd, L.hy);
          g.closePath();
          g.fill();
        } else if (b.kind === "chimney") {
          g.fillRect(x, top, Math.max(2, wd), hh);
        } else {
          g.fillRect(x, top, wd, hh);
          if (b.kind === "tower" && wd > 3) g.fillRect(x + wd * 0.45, top - hh * 0.12, Math.max(1, wd * 0.1), hh * 0.12);
        }
        // 창문 불빛
        if (!L.thumb && b.kind !== "chimney" && wd >= 6 && hh >= 10) {
          const q = rng(b.seed);
          const cols = Math.max(1, Math.floor((wd - 2) / 4)), rows = Math.max(1, Math.floor((hh - 6) / 5));
          for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
              if (q() > pal.winRate * (b.kind === "saw" ? 0.4 : 1)) continue;
              const wc = pal.win[Math.floor(q() * pal.win.length)];
              g.fillStyle = rgba(wc, (1 - haze) * alphaWin * (0.55 + 0.45 * q()));
              g.fillRect(x + 2 + j * 4, top + 5 + i * 5, 2, 2);
            }
          }
        }
      }
    }
  }
  // 실루엣은 크기·색·날씨가 같으면 바뀌지 않으므로 화면 밖 캔버스에 한 번 그려 두고 옮겨 찍는다.
  const skyCache = new Map();
  function skylineLayer(g, L, pal, band, scheme, st) {
    let dpr = 1;
    try { if (typeof g.getTransform === "function") dpr = clamp(g.getTransform().a || 1, 1, 3); } catch (e) { dpr = 1; }
    const margin = Math.ceil(L.w * 0.05);
    const key = `${Math.round(L.w)}x${Math.round(L.h)}|${L.hy}|${scheme}|${band}|${dpr}|${L.thumb}`;
    if (skyCache.has(key)) return { c: skyCache.get(key), margin };
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil((L.w + margin * 2) * dpr));
    c.height = Math.max(1, Math.ceil((L.hy + 1) * dpr));
    const cg = c.getContext("2d");
    if (!cg) return null;
    cg.setTransform(dpr, 0, 0, dpr, margin * dpr, 0);
    skylineShapes(cg, L, pal, band, st);
    if (skyCache.size >= 3) skyCache.clear();
    skyCache.set(key, c);
    return { c, margin };
  }
  function drawSkyline(g, L, pal, band, scheme, T, st, anim) {
    const shift = -L.bend * 0.18;
    const layer = L.thumb ? null : skylineLayer(g, L, pal, band, scheme, st);
    if (layer) {
      g.drawImage(layer.c, shift - layer.margin, 0, L.w + layer.margin * 2, L.hy + 1);
    } else {
      g.save();
      g.translate(shift, 0);
      skylineShapes(g, L, pal, band, st);
      g.restore();
    }
    // 굴뚝 꼭대기 항공 장애등(깜박임)
    if (band !== "fog") {
      for (const [list, alpha, scaleH] of [[st.far, band === "rain" ? 0.35 : 0.6, 0.55], [st.near, band === "rain" ? 0.55 : 0.95, 1]]) {
        g.fillStyle = rgba("#ff3b5c", alpha);
        for (const b of list) {
          if (b.kind !== "chimney" || (anim && Math.sin(T * 3 + b.seed) <= -0.2)) continue;
          const x = Math.round(b.x * L.w + shift), wd = Math.max(2, Math.round(b.wd * L.w));
          g.fillRect(x - 0.5, L.hy - Math.round(b.h * L.hy * scaleH) - 2, wd + 1, 2);
        }
      }
    }
    // 지평선 네온
    const glow = g.createLinearGradient(0, L.hy - 16, 0, L.hy);
    glow.addColorStop(0, rgba(pal.horizon, 0));
    glow.addColorStop(1, rgba(pal.horizon, band === "fog" ? 0.18 : 0.42));
    g.fillStyle = glow;
    g.fillRect(0, L.hy - 16, L.w, 16);
  }

  /* ---------- 도로 ---------- */
  function quad(g, a, b, c, d) {
    g.beginPath();
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y);
    g.closePath();
  }
  function drawRoad(g, L, pal, band, travel, info) {
    const S = 6; // 줄무늬 한 칸(m)
    const fogC = band === "fog" ? pal.fog : mix(pal.fog, pal.sky[3], 0.25);
    const fogD = FOG_DIST[band];
    const zNear = zOfY(L, L.h + 2);
    const off = ((travel % S) + S) % S;
    const segs = [];
    for (let i = 0; i < 400; i++) {
      const z1 = zNear + i * S - off, z2 = z1 + S;
      if (z2 <= zNear) continue;
      const a = at(L, 0, Math.max(z1, zNear)), b = at(L, 0, z2);
      const dy = a.y - b.y;
      const idx = Math.floor((z1 + travel) / S + 1e-6);
      segs.push({ z1: Math.max(z1, zNear), z2, a, b, odd: ((idx % 2) + 2) % 2 === 1, dy });
      if (dy < 0.9 || z2 > 900) break;
    }
    const lastY = segs.length ? segs[segs.length - 1].b.y : L.h;
    // 먼 곳 바탕(지평선까지)
    const fFar = 1 - Math.exp(-300 / fogD);
    g.fillStyle = mix(mix(pal.groundA, pal.groundB, 0.5), fogC, fFar);
    g.fillRect(0, L.hy, L.w, lastY - L.hy + 1);
    // 1) 땅 줄무늬
    for (const s of segs) {
      const f = 1 - Math.exp(-Math.max(0, (s.z1 + s.z2) / 2) / fogD);
      g.fillStyle = mix(s.odd ? pal.groundB : pal.groundA, fogC, f);
      g.fillRect(0, Math.floor(s.b.y), L.w, Math.ceil(s.a.y - s.b.y) + 1);
    }
    // 2) 네온 격자(바닥)
    g.strokeStyle = rgba(pal.grid, band === "fog" ? 0.12 : band === "rain" ? 0.22 : 0.34);
    g.lineWidth = 1;
    g.beginPath();
    for (const side of [-1, 1]) {
      for (const lat of [9.6, 12.6, 16.5, 22, 30, 42, 60, 88, 130, 200]) {
        let first = true;
        for (let z = zNear; z < 420; z += z < 30 ? 3 : z < 120 ? 10 : 40) {
          const p = at(L, side * lat, z);
          if (first) { g.moveTo(p.x, p.y); first = false; } else g.lineTo(p.x, p.y);
        }
      }
    }
    for (const s of segs) {
      if (!s.odd || s.dy < 2) continue;
      g.moveTo(0, Math.round(s.a.y) + 0.5);
      g.lineTo(L.w, Math.round(s.a.y) + 0.5);
    }
    g.stroke();
    // 먼 도로(지평선까지 이어지는 가는 띠)
    {
      const zl = segs.length ? segs[segs.length - 1].z2 : 900;
      const a = at(L, -ROAD, zl), b = at(L, ROAD, zl), top = at(L, 0, 20000);
      g.fillStyle = mix(pal.roadA, fogC, fFar);
      g.beginPath();
      g.moveTo(a.x, a.y + 0.5);
      g.lineTo(top.x, top.y);
      g.lineTo(b.x, b.y + 0.5);
      g.closePath();
      g.fill();
    }
    // 3) 도로, 연석, 차선
    for (const s of segs) {
      const f = 1 - Math.exp(-Math.max(0, (s.z1 + s.z2) / 2) / fogD);
      g.fillStyle = mix(s.odd ? pal.roadB : pal.roadA, fogC, f);
      quad(g, at(L, -ROAD, s.z1), at(L, -ROAD, s.z2), at(L, ROAD, s.z2), at(L, ROAD, s.z1));
      g.fill();
      // 연석(빨강·흰색 번갈아)
      g.fillStyle = mix(s.odd ? pal.rumbleA : pal.rumbleB, fogC, f);
      for (const side of [-1, 1]) {
        quad(g, at(L, side * ROAD, s.z1), at(L, side * ROAD, s.z2), at(L, side * (ROAD + 0.55), s.z2), at(L, side * (ROAD + 0.55), s.z1));
        g.fill();
      }
      // 중앙선(노란 겹선)과 차로 경계(흰 점선)
      g.fillStyle = mix(pal.center, fogC, f);
      for (const c0 of [-0.3, 0.14]) {
        quad(g, at(L, c0, s.z1), at(L, c0, s.z2), at(L, c0 + 0.16, s.z2), at(L, c0 + 0.16, s.z1));
        g.fill();
      }
      if (s.odd) {
        g.fillStyle = mix(pal.lane, fogC, f);
        for (const lat of [-3.7, 3.7]) {
          quad(g, at(L, lat - 0.09, s.z1), at(L, lat - 0.09, s.z2), at(L, lat + 0.09, s.z2), at(L, lat + 0.09, s.z1));
          g.fill();
        }
      }
    }
    info.fogC = fogC;
  }

  /* ---------- 표지판·글자 ---------- */
  function plate(g, pal, text, x, y, size, align, edge) {
    const F = fontsOf();
    g.font = `700 ${size}px ${F.body}`;
    const tw = g.measureText(text).width;
    const pw = tw + size * 1.1, ph = size * 1.65;
    const px = Math.max(3, align === "right" ? x - pw : align === "center" ? x - pw / 2 : x);
    const py = y - ph / 2;
    g.fillStyle = pal.plate;
    rr(g, px, py, pw, ph, Math.min(6, ph / 3));
    g.fill();
    g.strokeStyle = edge || pal.plateLine;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = pal.plateText;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, px + size * 0.55, py + ph / 2 + size * 0.04);
    return { x: px, y: py, w: pw, h: ph };
  }

  /* ---------- 7세그먼트 숫자 ---------- */
  const SEG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "" };
  function segPath(g, seg, cw, ch, th) {
    const gp = th * 0.28, hT = th / 2;
    const H = (x1, x2, yc) => { g.moveTo(x1, yc); g.lineTo(x1 + hT, yc - hT); g.lineTo(x2 - hT, yc - hT); g.lineTo(x2, yc); g.lineTo(x2 - hT, yc + hT); g.lineTo(x1 + hT, yc + hT); g.closePath(); };
    const V = (xc, y1, y2) => { g.moveTo(xc, y1); g.lineTo(xc + hT, y1 + hT); g.lineTo(xc + hT, y2 - hT); g.lineTo(xc, y2); g.lineTo(xc - hT, y2 - hT); g.lineTo(xc - hT, y1 + hT); g.closePath(); };
    const l = hT, r = cw - hT, t = hT, m = ch / 2, b = ch - hT;
    if (seg === "a") H(l + gp, r - gp, t);
    if (seg === "g") H(l + gp, r - gp, m);
    if (seg === "d") H(l + gp, r - gp, b);
    if (seg === "f") V(l, t + gp, m - gp);
    if (seg === "b") V(r, t + gp, m - gp);
    if (seg === "e") V(l, m + gp, b - gp);
    if (seg === "c") V(r, m + gp, b - gp);
  }
  const segWidth = (text, ch) => text.length * ch * 0.55 + (text.length - 1) * ch * 0.2;
  function seg7(g, text, x, y, ch, on, off, glow) {
    const cw = ch * 0.55, gap = ch * 0.2, th = Math.max(1.4, ch * 0.14);
    g.save();
    g.translate(x, y);
    g.transform(1, 0, -0.09, 1, ch * 0.09, 0);
    for (let i = 0; i < text.length; i++) {
      const lit = SEG[text[i]] || "";
      g.save();
      g.translate(i * (cw + gap), 0);
      g.beginPath();
      for (const s of "abcdefg") if (!lit.includes(s)) segPath(g, s, cw, ch, th);
      g.fillStyle = off;
      g.fill();
      if (lit) {
        g.beginPath();
        for (const s of lit) segPath(g, s, cw, ch, th);
        if (glow) { g.strokeStyle = glow; g.lineWidth = th * 0.9; g.lineJoin = "round"; g.stroke(); }
        g.fillStyle = on;
        g.fill();
      }
      g.restore();
    }
    g.restore();
  }

  /* ---------- 조건 아이콘 ---------- */
  function icon(g, c, x, y, s, color) {
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = Math.max(1.2, s * 0.12);
    g.lineCap = "round";
    if (c === "clear") {
      crescent(g, x, y, s * 0.42);
    } else if (c === "rain") {
      g.beginPath();
      g.arc(x - s * 0.16, y - s * 0.08, s * 0.24, Math.PI * 0.9, Math.PI * 1.9);
      g.arc(x + s * 0.14, y - s * 0.12, s * 0.28, Math.PI * 1.15, Math.PI * 2.05);
      g.lineTo(x + s * 0.42, y + s * 0.06);
      g.lineTo(x - s * 0.4, y + s * 0.06);
      g.closePath();
      g.fill();
      g.beginPath();
      for (const dx of [-0.24, 0, 0.24]) { g.moveTo(x + dx * s, y + s * 0.2); g.lineTo(x + dx * s - s * 0.08, y + s * 0.44); }
      g.stroke();
    } else {
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const yy = y - s * 0.3 + i * s * 0.3;
        g.moveTo(x - s * 0.45, yy);
        g.bezierCurveTo(x - s * 0.15, yy - s * 0.12, x + s * 0.1, yy + s * 0.12, x + s * 0.45, yy);
      }
      g.stroke();
    }
    g.restore();
  }

  /* ---------- 노변 물체 ---------- */
  function sprites(L, travel, R, stopZ) {
    const list = [];
    const zNear = zOfY(L, L.h + 30);
    const post = 14, light = 42;
    for (let z = Math.ceil((zNear + travel) / post) * post - travel; z < 260; z += post) list.push({ kind: "post", z, side: -1 }, { kind: "post", z, side: 1 });
    for (let z = Math.ceil((zNear + travel) / light) * light - travel; z < 320; z += light) {
      const idx = Math.round((z + travel) / light);
      list.push({ kind: "lamp", z, side: idx % 2 ? 1 : -1 });
    }
    list.push({ kind: "gate", z: R });
    if (stopZ > 0) list.push({ kind: "stop", z: stopZ });
    return list.sort((a, b) => b.z - a.z);
  }
  function drawLampPools(g, L, pal, band, list, fogD, scheme) {
    // 가로등 아래 빛 웅덩이(노면)
    for (const o of list) {
      if (o.kind !== "lamp" || o.z < -2) continue;
      const lat = o.side * (ROAD - 1.8);
      const p = at(L, lat, o.z);
      const f = Math.exp(-Math.max(0, o.z) / fogD);
      const rx = 4.2 * L.k * p.s, ry = Math.max(1, rx * 0.22);
      const a = (scheme === "light" ? 0.16 : 0.32) * f;
      if (a < 0.01 || rx < 1) continue;
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, rgba(pal.pool, a));
      gr.addColorStop(1, rgba(pal.pool, 0));
      g.save();
      g.translate(p.x, p.y);
      g.scale(1, ry / rx);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
      if (band === "rain" && !L.thumb && scheme === "dark") {
        // 젖은 노면 반사: 세로로 긴 빛
        const hh = 7 * L.k * p.s;
        const gr2 = g.createLinearGradient(0, p.y - hh * 0.2, 0, p.y + hh);
        gr2.addColorStop(0, rgba(pal.lamp, 0));
        gr2.addColorStop(0.3, rgba(pal.lamp, 0.16 * f));
        gr2.addColorStop(1, rgba(pal.lamp, 0));
        g.fillStyle = gr2;
        g.fillRect(p.x - Math.max(1, 0.35 * L.k * p.s), p.y - hh * 0.2, Math.max(2, 0.7 * L.k * p.s), hh * 1.2);
      }
    }
  }
  function drawSprite(g, L, pal, band, o, fogC, fogD, info) {
    const f = 1 - Math.exp(-Math.max(0, o.z) / fogD);
    if (o.kind === "post") {
      const p = at(L, o.side * (ROAD + 1.2), o.z);
      if (p.s < 0.035) return;
      const wd = Math.max(1, 0.16 * L.k * p.s), hh = Math.max(2, 1.05 * L.k * p.s);
      g.fillStyle = mix(pal.post, fogC, f);
      g.fillRect(p.x - wd / 2, p.y - hh, wd, hh);
      g.fillStyle = mix(pal.reflector, fogC, f * 0.85);
      g.fillRect(p.x - wd / 2, p.y - hh, wd, Math.max(1, hh * 0.22));
      if (!L.thumb && p.s > 0.08 && f < 0.85) {
        const gr = g.createRadialGradient(p.x, p.y - hh * 0.9, 0, p.x, p.y - hh * 0.9, wd * 3.5);
        gr.addColorStop(0, rgba(pal.reflector, 0.45 * (1 - f)));
        gr.addColorStop(1, rgba(pal.reflector, 0));
        g.fillStyle = gr;
        g.fillRect(p.x - wd * 3.5, p.y - hh * 0.9 - wd * 3.5, wd * 7, wd * 7);
      }
    } else if (o.kind === "lamp") {
      const p = at(L, o.side * (ROAD + 2.3), o.z);
      // 아주 가까운 가로등은 화면을 가로지르는 기둥이 되므로 흐리게 지운다
      const near = clamp((o.z - 4) / 12, 0, 1);
      if (p.s < 0.03 || near <= 0) return;
      g.save();
      g.globalAlpha = near;
      const hh = 8.2 * L.k * p.s, arm = 3.2 * L.k * p.s * -o.side;
      const pw = Math.max(1, 0.24 * L.k * p.s);
      g.fillStyle = mix(pal.pole, fogC, f);
      g.fillRect(p.x - pw / 2, p.y - hh, pw, hh);
      g.fillRect(Math.min(p.x, p.x + arm), p.y - hh, Math.abs(arm), Math.max(1, pw * 0.8));
      const lx = p.x + arm, ly = p.y - hh + pw;
      g.fillStyle = mix(pal.lamp, fogC, f * 0.5);
      g.fillRect(lx - pw * 1.6, ly - pw * 0.2, pw * 3.2, Math.max(1, pw * 0.9));
      const rad = Math.max(2, (band === "fog" ? 3.4 : 1.15) * L.k * p.s);
      const gr = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
      gr.addColorStop(0, rgba(pal.lamp, (band === "fog" ? 0.5 : 0.7) * (1 - f * 0.7)));
      gr.addColorStop(1, rgba(pal.lamp, 0));
      g.fillStyle = gr;
      g.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
      g.restore();
    } else if (o.kind === "gate") {
      drawGate(g, L, pal, o.z, info);
    } else if (o.kind === "stop") {
      drawStop(g, L, pal, o.z, info.stopCol || pal.ok);
    }
  }
  // 정지 위치 표지: 필요 감지 거리의 먼 끝(나쁜 감속도) 양쪽 길가에 세운 빗금 판
  function drawStop(g, L, pal, z, col) {
    for (const side of [-1, 1]) {
      const p = at(L, side * (ROAD + 0.45), z);
      const u = L.k * p.s;
      const bw = Math.max(3, 0.62 * u), bh = Math.max(5, 1.5 * u), pole = Math.max(1, 0.12 * u);
      const top = p.y - 2.5 * u;
      g.fillStyle = pal.pole;
      g.fillRect(p.x - pole / 2, top + bh, pole, p.y - top - bh);
      g.fillStyle = col;
      g.fillRect(p.x - bw / 2, top, bw, bh);
      if (bw >= 5) {
        g.save();
        g.beginPath();
        g.rect(p.x - bw / 2, top, bw, bh);
        g.clip();
        g.strokeStyle = "rgba(255,255,255,0.85)";
        g.lineWidth = Math.max(1, bw * 0.18);
        g.beginPath();
        for (let i = -2; i < 5; i++) {
          const y0 = top + i * bw * 0.7;
          g.moveTo(p.x - bw / 2, y0 + bw * 0.7);
          g.lineTo(p.x + bw / 2, y0);
        }
        g.stroke();
        g.restore();
      }
    }
  }
  // 감지 거리 R의 관문: 체크포인트 아치를 닮은 네온 기둥과 가로대
  function drawGate(g, L, pal, z, info) {
    const left = at(L, -(ROAD + 0.7), z), right = at(L, ROAD + 0.7, z);
    const hh = 4.6 * L.k * left.s;
    const pw = Math.max(2, 0.4 * L.k * left.s);
    const col = info.ban ? pal.warn : pal.ok;
    const topY = left.y - hh;
    g.fillStyle = rgba(col, 0.9);
    g.fillRect(left.x - pw / 2, topY, pw, hh);
    g.fillRect(right.x - pw / 2, right.y - hh, pw, hh);
    // 가로대
    const bh = Math.max(L.thumb ? 4 : 15, 1.15 * L.k * left.s);
    const bx = left.x - pw / 2, bw = right.x - left.x + pw;
    g.fillStyle = pal.plate;
    rr(g, bx, topY - bh * 0.15, bw, bh, Math.min(5, bh / 3));
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = Math.max(1.2, bh * 0.1);
    g.stroke();
    info.gateBox = { x: bx, y: topY - bh * 0.15, w: bw, h: bh, col, rx: right.x + pw / 2, ry: right.y - hh / 2 };
    // 금지일 때 차단봉(빨강·흰 줄)
    if (info.ban) {
      const by = left.y - 1.1 * L.k * left.s, bt = Math.max(2, 0.35 * L.k * left.s);
      const n = 8;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? pal.rumbleB : pal.bad;
        g.fillRect(left.x + (right.x - left.x) * i / n, by, (right.x - left.x) / n + 0.5, bt);
      }
    }
  }

  /* ---------- 셔틀(뒤에서 본 모습) ---------- */
  function drawShuttle(g, L, pal, x, yb, sw, sh, state) {
    const { brake, hazard, T, anim } = state;
    // 그림자
    g.fillStyle = "rgba(0,0,0,0.42)";
    g.beginPath();
    g.ellipse(x, yb - sh * 0.01, sw * 0.62, Math.max(2, sw * 0.08), 0, 0, Math.PI * 2);
    g.fill();
    // 바퀴
    g.fillStyle = "#07051a";
    rr(g, x - sw * 0.46, yb - sh * 0.15, sw * 0.18, sh * 0.15, sw * 0.04); g.fill();
    rr(g, x + sw * 0.28, yb - sh * 0.15, sw * 0.18, sh * 0.15, sw * 0.04); g.fill();
    // 차체
    const top = yb - sh, bottom = yb - sh * 0.07;
    const gr = g.createLinearGradient(0, top, 0, bottom);
    gr.addColorStop(0, pal.body[0]);
    gr.addColorStop(1, pal.body[1]);
    g.fillStyle = gr;
    rr(g, x - sw / 2, top + sh * 0.04, sw, bottom - top - sh * 0.04, sw * 0.14);
    g.fill();
    g.strokeStyle = pal.bodyEdge;
    g.lineWidth = Math.max(1, sw * 0.018);
    g.stroke();
    // 지붕 라이다
    g.fillStyle = pal.bodyEdge;
    rr(g, x - sw * 0.13, top - sh * 0.03, sw * 0.26, sh * 0.08, sw * 0.03); g.fill();
    const spin = anim ? (Math.sin(T * 7) + 1) / 2 : 0.6;
    g.fillStyle = rgba(pal.cone, 0.55 + 0.45 * spin);
    g.fillRect(x - sw * 0.11, top + sh * 0.005, sw * 0.22, Math.max(1, sh * 0.018));
    // 카메라 돌기
    g.fillStyle = pal.bodyEdge;
    g.fillRect(x - sw * 0.47, top + sh * 0.07, sw * 0.06, sh * 0.05);
    g.fillRect(x + sw * 0.41, top + sh * 0.07, sw * 0.06, sh * 0.05);
    // 행선 LED 띠
    const ledY = top + sh * 0.1, ledH = Math.max(2, sh * 0.06);
    g.fillStyle = "#120a26";
    rr(g, x - sw * 0.34, ledY, sw * 0.68, ledH, ledH * 0.3); g.fill();
    g.fillStyle = rgba(pal.amber, 0.85);
    if (!L.thumb && sw > 30) {
      const dots = Math.floor(sw * 0.6 / 3), shift = anim ? Math.floor(T * 6) : 0;
      for (let i = 0; i < dots; i++) {
        if ((i * 7 + shift) % 5 === 0) continue;
        g.fillRect(x - sw * 0.3 + i * 3, ledY + ledH * 0.3, 1.6, Math.max(1, ledH * 0.4));
      }
    } else {
      g.fillRect(x - sw * 0.28, ledY + ledH * 0.35, sw * 0.56, Math.max(1, ledH * 0.3));
    }
    // 뒷유리
    const wy = top + sh * 0.2, wh = sh * 0.33;
    const gg = g.createLinearGradient(0, wy, 0, wy + wh);
    gg.addColorStop(0, pal.glass[0]);
    gg.addColorStop(1, pal.glass[1]);
    g.fillStyle = gg;
    rr(g, x - sw * 0.4, wy, sw * 0.8, wh, sw * 0.06); g.fill();
    // 승객 실루엣(야간 귀갓길)
    if (sw > 26) {
      g.fillStyle = "rgba(4,2,16,0.55)";
      for (const dx of [-0.22, 0.02, 0.24]) {
        g.beginPath();
        g.arc(x + dx * sw, wy + wh * 0.62, sw * 0.055, 0, Math.PI * 2);
        g.fill();
        rr(g, x + dx * sw - sw * 0.08, wy + wh * 0.72, sw * 0.16, wh * 0.3, sw * 0.04); g.fill();
      }
    }
    // 유리 반사
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.beginPath();
    g.moveTo(x - sw * 0.36, wy + wh);
    g.lineTo(x - sw * 0.2, wy);
    g.lineTo(x - sw * 0.08, wy);
    g.lineTo(x - sw * 0.24, wy + wh);
    g.closePath();
    g.fill();
    // 네온 띠(자율주행 도장)
    const by = wy + wh + sh * 0.05, bh = Math.max(2, sh * 0.055);
    const ng = g.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0);
    ng.addColorStop(0, "#ff3fb4");
    ng.addColorStop(1, "#39e2ff");
    g.fillStyle = ng;
    g.fillRect(x - sw / 2 + sw * 0.02, by, sw * 0.96, bh);
    // 미등(정지 조건이 위험하면 제동등처럼 밝게 깜박)
    const pulse = brake && anim ? 0.6 + 0.4 * Math.sin(T * 12) : 1;
    const ty = by + bh + sh * 0.04, tH = sh * 0.2, tW = sw * 0.09;
    for (const side of [-1, 1]) {
      const tx = x + side * sw * 0.4 - tW / 2;
      const glowR = sw * (brake ? 0.32 : 0.18);
      const gl = g.createRadialGradient(tx + tW / 2, ty + tH / 2, 0, tx + tW / 2, ty + tH / 2, glowR);
      gl.addColorStop(0, rgba(pal.tail, (brake ? 0.75 : 0.45) * pulse));
      gl.addColorStop(1, rgba(pal.tail, 0));
      g.fillStyle = gl;
      g.fillRect(tx + tW / 2 - glowR, ty + tH / 2 - glowR, glowR * 2, glowR * 2);
      g.fillStyle = brake ? "#ff5a73" : pal.tail;
      rr(g, tx, ty, tW, tH, tW * 0.3); g.fill();
      g.fillStyle = "rgba(255,240,240,0.8)";
      g.fillRect(tx + tW * 0.3, ty + tH * 0.15, Math.max(1, tW * 0.25), tH * 0.6);
      // 비상등(운행 금지)
      if (hazard) {
        const on = !anim || Math.sin(T * 6) > 0;
        g.fillStyle = on ? pal.amber : rgba(pal.amber, 0.25);
        rr(g, tx, ty - sh * 0.07, tW, sh * 0.05, 1.5); g.fill();
        if (on) {
          const ha = g.createRadialGradient(tx + tW / 2, ty - sh * 0.045, 0, tx + tW / 2, ty - sh * 0.045, sw * 0.2);
          ha.addColorStop(0, rgba(pal.amber, 0.55));
          ha.addColorStop(1, rgba(pal.amber, 0));
          g.fillStyle = ha;
          g.fillRect(tx + tW / 2 - sw * 0.2, ty - sh * 0.045 - sw * 0.2, sw * 0.4, sw * 0.4);
        }
      }
    }
    // 번호판 자리와 범퍼
    g.fillStyle = "#f6f1ff";
    rr(g, x - sw * 0.13, ty + tH * 0.35, sw * 0.26, sh * 0.075, 1.5); g.fill();
    g.fillStyle = pal.bodyEdge;
    rr(g, x - sw * 0.5, bottom - sh * 0.06, sw, sh * 0.075, sw * 0.03); g.fill();
  }

  /* ---------- 계기판 ---------- */
  function gauge(g, L, pal, c, x, y, w, h, info, sel, tl) {
    const k = COND[c], v = info.v[c];
    const safeLo = clamp(tl.safe(k.R, k.lo), 0, 60), safeHi = clamp(tl.safe(k.R, k.hi), 0, 60);
    g.save();
    g.globalAlpha = sel ? 1 : 0.8;
    g.fillStyle = pal.hud;
    rr(g, x, y, w, h, 7);
    g.fill();
    g.strokeStyle = sel ? pal.hudSel : pal.hudLine;
    g.lineWidth = sel ? 2 : 1;
    g.stroke();
    const cx = x + w / 2, r = Math.min(w * 0.36, h * 0.42), cy = y + r + h * 0.1;
    const ang = val => Math.PI + (val / 60) * Math.PI;
    const lw = Math.max(2, r * 0.2);
    g.lineCap = "butt";
    g.lineWidth = lw;
    g.strokeStyle = pal.arcBase;
    g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.stroke();
    const arc = (a, b, col) => { if (b <= a) return; g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, r, ang(a), ang(b)); g.stroke(); };
    arc(0, safeLo, pal.okInk || pal.ok);
    arc(safeLo, safeHi, pal.warnInk || pal.warn);
    arc(safeHi, 60, pal.badInk || pal.bad);
    // 눈금
    g.strokeStyle = pal.hudDim;
    g.lineWidth = 1;
    g.beginPath();
    for (let t = 0; t <= 60; t += 10) {
      const a = ang(t);
      g.moveTo(cx + Math.cos(a) * (r - lw * 0.9), cy + Math.sin(a) * (r - lw * 0.9));
      g.lineTo(cx + Math.cos(a) * (r - lw * 1.6), cy + Math.sin(a) * (r - lw * 1.6));
    }
    g.stroke();
    // 지시침: 테두리 쪽에만 그려 숫자와 겹치지 않게 한다
    const a = ang(v);
    g.strokeStyle = pal.needle;
    g.lineWidth = Math.max(2, r * 0.11);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    g.lineTo(cx + Math.cos(a) * r * 1.14, cy + Math.sin(a) * r * 1.14);
    g.stroke();
    // 숫자
    const dh = Math.max(7, r * 0.5);
    const text = v === 0 ? "--" : String(v).padStart(2, " ");
    if (!L.thumb) seg7(g, text, cx - segWidth(text, dh) / 2, cy - dh - r * 0.1, dh, sel ? pal.segOn : pal.segOnDim, pal.segOff, sel ? pal.segGlow : null);
    // 아이콘과 이름
    const iy = cy + (h - (cy - y)) * 0.42;
    const col = sel ? pal.hudText : pal.hudDim;
    if (!L.miniHud) {
      const F = fontsOf();
      g.font = `700 ${Math.round(clamp(h * 0.16, 9, 12))}px ${F.body}`;
      g.textBaseline = "middle";
      g.textAlign = "left";
      const nw = g.measureText(k.short).width;
      const isz = clamp(h * 0.16, 8, 12);
      const total = isz + 4 + nw;
      icon(g, c, cx - total / 2 + isz / 2, iy, isz, col);
      g.fillStyle = col;
      g.fillText(k.short, cx - total / 2 + isz + 4, iy + 0.5);
    } else {
      icon(g, c, cx, iy, clamp(h * 0.22, 6, 11), col);
    }
    // 시험 주행 횟수(점)
    const n = info.per[c];
    if (n > 0 && h > 40) {
      const dot = Math.max(2, Math.min(3, w / 30));
      const totalW = n * (dot + 2) - 2;
      g.fillStyle = pal.segOn;
      for (let i = 0; i < n; i++) g.fillRect(cx - totalW / 2 + i * (dot + 2), y + h - dot - 3, dot, dot);
    }
    // 확정 결과 꼬리표
    if (info.modes && !L.miniHud && h > 40) {
      const m = info.modes[c], tone = MODE[m].tone;
      const fs = Math.round(clamp(h * 0.15, 8, 11));
      g.font = `700 ${fs}px ${fontsOf().body}`;
      const label = MODE_SHORT[m];
      const lw2 = g.measureText(label).width + 8;
      g.fillStyle = pal[tone + "Ink"] || pal[tone];
      rr(g, x + w - lw2 - 3, y + 3, lw2, fs + 5, 3);
      g.fill();
      g.fillStyle = pal.tagInk;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(label, x + w - lw2 + 1, y + 3 + (fs + 5) / 2 + 0.5);
    }
    g.restore();
  }
  // 계기판이 차지하는 자리(글자판이 피해 가도록 먼저 계산한다)
  // 작은 계기판 크기: 좁은 화면에서는 제목판(왼쪽 위)과 겹치지 않게 줄인다.
  const miniSize = L => {
    if (L.thumb) return [40, 36];
    const gw = clamp(Math.floor((L.w - 186) / 3) - 4, 34, L.tiny ? 42 : L.short ? 46 : 58);
    return [gw, Math.round(gw * (L.tiny ? 0.95 : 0.96))];
  };
  function hudRect(L) {
    if (L.miniHud) {
      const [gw, gh] = miniSize(L);
      const run = L.thumb || L.tiny ? 0 : 4 + 10 + 8;
      return { x: L.w - 8 - gw * 3 - 8, y: L.thumb ? 6 : 8, w: gw * 3 + 8, h: gh + run };
    }
    const gw = L.short ? 82 : 96, gh = L.short ? 56 : 74, gap = 6, rw = L.short ? 70 : 80;
    const totalW = rw + gap + gw * 3 + gap * 2;
    return { x: L.w - 12 - totalW - 5, y: 4, w: totalW + 10, h: 22 + gh + 4 };
  }
  function hud(g, L, pal, info, tl) {
    const F = fontsOf();
    if (L.miniHud) {
      const [gw, gh] = miniSize(L), gap = 4;
      const x0 = L.w - 8 - gw * 3 - gap * 2, y0 = L.thumb ? 6 : 8;
      ORDER.forEach((c, i) => gauge(g, L, pal, c, x0 + i * (gw + gap), y0, gw, gh, info, c === info.band, tl));
      if (L.thumb || L.tiny) return; // 홈 카드 미리보기와 낮은 장면에는 RUN 칸을 생략한다
      // RUN: 실행한 시험 주행 수
      const dh = L.thumb ? 8 : 10;
      const text = String(info.n).padStart(2, "0");
      const rw = 30 + segWidth(text, dh) + 12;
      const rx = L.w - 8 - rw, ry = y0 + gh + 4;
      g.fillStyle = pal.hud;
      rr(g, rx, ry, rw, dh + 8, 5);
      g.fill();
      g.strokeStyle = pal.hudLine;
      g.lineWidth = 1;
      g.stroke();
      g.font = `600 9px ${F.mono}`;
      g.fillStyle = pal.hudText;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText("RUN", rx + 6, ry + (dh + 8) / 2 + 0.5);
      seg7(g, text, rx + rw - 6 - segWidth(text, dh), ry + 4, dh, pal.segOn, pal.segOff, null);
      return;
    }
    const gw = L.short ? 82 : 96, gh = L.short ? 56 : 74, gap = 6, rw = L.short ? 70 : 80;
    const totalW = rw + gap + gw * 3 + gap * 2;
    const x0 = L.w - 12 - totalW, y0 = 22;
    g.fillStyle = pal.plate;
    rr(g, x0 - 5, 4, totalW + 10, y0 + gh + 4, 9);
    g.fill();
    g.strokeStyle = pal.plateLine;
    g.lineWidth = 1.5;
    g.stroke();
    g.font = `600 10px ${F.mono}`;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = pal.plateText;
    g.fillText("RUN", x0 + 4, 16);
    g.fillText("SPEED  km/h", x0 + rw + gap + 4, 16);
    // RUN 상자: 시험 주행 수와 남은 예산 10칸
    g.fillStyle = pal.hud;
    rr(g, x0, y0, rw, gh, 7);
    g.fill();
    g.strokeStyle = pal.hudLine;
    g.lineWidth = 1;
    g.stroke();
    const dh = gh * 0.38;
    const text = String(info.n).padStart(2, "0");
    seg7(g, text, x0 + rw / 2 - segWidth(text, dh) / 2 - 6, y0 + 9, dh, pal.segOn, pal.segOff, pal.segGlow);
    g.font = `600 10px ${F.mono}`;
    g.fillStyle = pal.hudText;
    g.textAlign = "left";
    g.fillText("/10", x0 + rw / 2 + segWidth(text, dh) / 2 - 2, y0 + 9 + dh);
    const cell = (rw - 16) / 10;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i < info.n ? pal.segOn : pal.segOff;
      g.fillRect(x0 + 8 + i * cell, y0 + gh - 14, Math.max(2, cell - 2), 6);
    }
    ORDER.forEach((c, i) => gauge(g, L, pal, c, x0 + rw + gap + i * (gw + gap), y0, gw, gh, info, c === info.band, tl));
  }

  /* ---------- 허가 도장 ---------- */
  function stamp(g, L, pal, info, x, y, scale) {
    const meta = MODE[info.modes[info.band]];
    const col = pal[meta.tone + "Ink"] || pal[meta.tone];
    const F = fontsOf();
    g.save();
    g.translate(x, y);
    g.rotate(-0.16);
    const w = 150 * scale, h = 58 * scale;
    g.fillStyle = pal.stampBg;
    rr(g, -w / 2, -h / 2, w, h, 8 * scale);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 3 * scale;
    g.stroke();
    rr(g, -w / 2 + 5 * scale, -h / 2 + 5 * scale, w - 10 * scale, h - 10 * scale, 5 * scale);
    g.lineWidth = 1.2 * scale;
    g.stroke();
    g.fillStyle = col;
    if (!L.thumb) {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.round(19 * scale)}px ${F.mono}`;
      g.fillText(meta.en, 0, -h * 0.16);
      g.font = `700 ${Math.round(12 * scale)}px ${F.body}`;
      g.fillText(meta.text, 0, h * 0.24);
    } else {
      g.fillRect(-w * 0.3, -h * 0.14, w * 0.6, h * 0.12);
      g.fillRect(-w * 0.2, h * 0.1, w * 0.4, h * 0.1);
    }
    g.restore();
  }

  /* ---------- 날씨 전경 ---------- */
  function rainLayer(g, L, pal, st, T, anim, scheme) {
    const fall = anim ? T : 0;
    g.strokeStyle = rgba(pal.rain, scheme === "light" ? 0.38 : 0.42);
    g.lineWidth = 1;
    g.beginPath();
    for (const d of st.drops) {
      const len = (L.thumb ? 6 : 12) * d.l;
      const y = ((d.y * (L.h + 40) + fall * 260 * d.sp) % (L.h + 40)) - 20;
      const x = ((d.x * (L.w + 40) - fall * 40 * d.sp) % (L.w + 40) + L.w + 40) % (L.w + 40) - 20;
      g.moveTo(x, y);
      g.lineTo(x - len * 0.22, y + len);
    }
    g.stroke();
  }
  function fogLayer(g, L, pal, st, T, anim) {
    const drift = anim ? T : 0;
    for (const wsp of st.wisps) {
      const y = L.hy - 6 + wsp.y * (L.h - L.hy) * 0.7;
      const ww = wsp.w * L.w;
      const x = ((wsp.x * (L.w + ww) + drift * 12 * wsp.sp) % (L.w + ww)) - ww / 2;
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, ww / 2);
      gr.addColorStop(0, rgba(pal.fogLight, 0.42));
      gr.addColorStop(1, rgba(pal.fogLight, 0));
      g.save();
      g.translate(x, y);
      g.scale(1, 0.18);
      g.fillStyle = gr;
      g.fillRect(-ww / 2, -ww / 2, ww, ww);
      g.restore();
    }
  }

  /* ---------- 그리기 ---------- */
  function render(ctx) {
    const g = ctx.g, w = ctx.w, h = ctx.h;
    const tl = tools(ctx.model);
    const info = readState(ctx.game, ctx.model);
    const band = info.band, k = COND[band], v = info.v[band];
    const zone = tl.zone(band, v);
    const moving = v > 0;
    const dBest = moving ? tl.distance(v, k.hi) : 0, dWorst = moving ? tl.distance(v, k.lo) : 0;
    const anim = !ctx.reduced && !ctx.thumb;

    if (g && w > 0 && h > 0) {
      const T = anim && finite(ctx.t) ? ctx.t : 0;
      const scheme = ctx.scheme === "dark" ? "dark" : "light";
      const pal = PAL[scheme];
      const L = layout(w, h, !!ctx.thumb);
      const travel = moving ? T * (v / 3.6) * 2.4 : 0;
      L.bend = w * (L.compact || L.thumb ? 0.09 : 0.07) + (anim && moving ? w * 0.03 * Math.sin(T * 0.45) : 0);
      const st = statics(w, h);
      const fogD = FOG_DIST[band];
      const draw = { ban: !moving };
      g.save();
      // 1) 하늘과 도시
      drawSky(g, L, pal, band, scheme, T, st, anim);
      drawSkyline(g, L, pal, band, scheme, T, st, anim);
      // 2) 땅과 도로
      drawRoad(g, L, pal, band, travel, draw);
      const list = sprites(L, travel, k.R, moving ? dWorst : 0);
      drawLampPools(g, L, pal, band, list, fogD, scheme);
      // 3) 감지 범위(센서 빛)
      if (moving) {
        const a = at(L, LANE - 1.1, 0.5), b = at(L, LANE + 1.1, 0.5), c = at(L, LANE + 3.4, k.R), d = at(L, LANE - 3.4, k.R);
        const gr = g.createLinearGradient(0, a.y, 0, c.y);
        gr.addColorStop(0, rgba(pal.cone, scheme === "light" ? 0.28 : 0.2));
        gr.addColorStop(1, rgba(pal.cone, 0.04));
        g.fillStyle = gr;
        quad(g, a, d, c, b);
        g.fill();
      }
      // 4) 감지 거리 너머: 센서가 보지 못하는 구간을 흐리게
      const yR = at(L, 0, k.R).y;
      {
        const gr = g.createLinearGradient(0, L.hy, 0, yR);
        const base = band === "fog" ? 0.55 : band === "rain" ? 0.4 : 0.28;
        const veil = band === "fog" ? pal.fogVeil : pal.veil;
        gr.addColorStop(0, rgba(veil, base));
        gr.addColorStop(1, rgba(veil, base * 0.55));
        g.fillStyle = gr;
        g.fillRect(0, L.hy, w, yR - L.hy);
      }
      // 5) 필요 감지 거리 띠(정지 + 여유 5 m): 감속도 범위의 좋은 쪽~나쁜 쪽
      const zc = zone === "below" ? pal.ok : zone === "band" ? pal.warn : pal.bad;
      if (moving) {
        const zA = Math.max(0.5, dBest), zB = Math.max(zA + 0.5, dWorst);
        g.fillStyle = rgba(zc, 0.26);
        quad(g, at(L, -ROAD, zA), at(L, -ROAD, zB), at(L, ROAD, zB), at(L, ROAD, zA));
        g.fill();
        // 횡단보도처럼 세로 줄을 넣어 노면 표시로 읽히게 한다
        g.fillStyle = rgba(zc, 0.62);
        for (let lat = -ROAD + 0.35; lat < ROAD - 0.3; lat += 1.5) {
          quad(g, at(L, lat, zA), at(L, lat, zB), at(L, lat + 0.75, zB), at(L, lat + 0.75, zA));
          g.fill();
        }
        if (zB > k.R) {
          // 감지 거리를 넘는 부분은 빗금
          const s1 = Math.max(zA, k.R);
          g.save();
          quad(g, at(L, -ROAD, s1), at(L, -ROAD, zB), at(L, ROAD, zB), at(L, ROAD, s1));
          g.clip();
          const yA = at(L, 0, s1).y, yB = at(L, 0, zB).y;
          g.strokeStyle = rgba(pal.bad, 0.85);
          g.lineWidth = 2;
          g.beginPath();
          for (let x = -40; x < w + 40; x += 9) { g.moveTo(x, yA + 2); g.lineTo(x + (yA - yB) + 4, yB - 2); }
          g.stroke();
          g.restore();
        }
        for (const [z, wd] of [[zA, 0.35], [zB, 0.6]]) {
          g.fillStyle = zc;
          quad(g, at(L, -ROAD, z - wd / 2), at(L, -ROAD, z + wd / 2), at(L, ROAD, z + wd / 2), at(L, ROAD, z - wd / 2));
          g.fill();
        }
        draw.stopCol = zc;
      }
      // 6) 감지 거리 선(점선)
      {
        const l = at(L, -ROAD, k.R), r = at(L, ROAD, k.R);
        g.strokeStyle = moving ? pal.ok : pal.warn;
        g.lineWidth = Math.max(1.5, 0.25 * L.k * l.s);
        g.setLineDash([Math.max(3, 0.9 * L.k * l.s), Math.max(2, 0.6 * L.k * l.s)]);
        g.beginPath();
        g.moveTo(l.x, l.y); g.lineTo(r.x, r.y);
        g.stroke();
        g.setLineDash([]);
      }
      // 7) 노변 물체(먼 것부터), 감지 관문 포함
      for (const o of list) drawSprite(g, L, pal, band, o, draw.fogC, fogD, draw);
      // 8) 셔틀
      const sp = at(L, LANE, -SHUTTLE_LEN);
      const bob = anim && moving ? Math.sin(T * 11) * 0.6 : 0;
      const brake = moving && zone !== "below";
      if (band === "rain") {
        // 미등이 젖은 노면에 비침
        for (const side of [-1, 1]) {
          const gx = sp.x + side * L.shW * 0.4;
          const gr = g.createLinearGradient(0, sp.y - 2, 0, sp.y + L.shH * 0.5);
          gr.addColorStop(0, rgba(pal.tail, brake ? 0.5 : 0.3));
          gr.addColorStop(1, rgba(pal.tail, 0));
          g.fillStyle = gr;
          g.fillRect(gx - L.shW * 0.05, sp.y - 2, L.shW * 0.1, L.shH * 0.5);
        }
      }
      drawShuttle(g, L, pal, sp.x, sp.y + bob, L.shW, L.shH, { brake, hazard: !moving, T, anim });
      // 9) 날씨 전경
      if (band === "rain") rainLayer(g, L, pal, st, T, anim, scheme);
      if (band === "fog") fogLayer(g, L, pal, st, T, anim);
      // 10) 화면 주사선(오락기 화면 느낌)
      if (!L.thumb) {
        g.fillStyle = pal.scan;
        g.beginPath();
        for (let y = 0; y < h; y += 3) g.rect(0, y, w, 1);
        g.fill();
      }
      // 11) 표지 글자(불투명 판 위)
      const hudBox = hudRect(L);
      const tinyCompact = L.compact && L.tiny;
      const gb = draw.gateBox;
      if (!L.thumb && gb) {
        // 감지 거리 관문 글자: 가로대 안에 들어가면 그 안에, 아니면 판을 따로 단다
        const label = moving ? `감지 ${k.R} m` : "운행 금지";
        const fsIn = Math.round(clamp(gb.h * 0.66, 10, 14));
        g.font = `700 ${fsIn}px ${fontsOf().body}`;
        if (g.measureText(label).width + 8 <= gb.w) {
          g.fillStyle = pal.plateText;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(label, gb.x + gb.w / 2, gb.y + gb.h / 2 + 0.5);
        } else if (L.compact) {
          // 좁은 화면: 제목판과 계기판을 피해 오른쪽 기둥 옆에 단다
          if (!tinyCompact) plate(g, pal, label, gb.rx + 4, Math.max(gb.ry, hudBox.y + hudBox.h + 12), 10, "left", gb.col);
        } else {
          plate(g, pal, label, gb.x + gb.w / 2, gb.y - 9, 11, "center", gb.col);
        }
      }
      if (!L.thumb && !tinyCompact && moving) {
        // 필요 감지 거리 글자: 왼쪽 길가, 띠의 먼 끝 높이
        const p = at(L, -ROAD - 0.8, Math.max(dWorst, 1));
        const fs = L.compact ? 10 : 12;
        const label = L.compact ? `필요 ${span(dBest, dWorst, 0)}` : `필요 거리 ${span(dBest, dWorst, 1)}`;
        g.font = `700 ${fs}px ${fontsOf().body}`;
        const pw = g.measureText(label).width + fs * 1.1;
        if (p.x - pw - 6 >= 4) plate(g, pal, label, p.x - 6, p.y - fs * 0.4, fs, "right", zc);
        else plate(g, pal, label, 4, p.y - fs * 1.6, fs, "left", zc);
      }
      // 12) 계기판과 도장
      hud(g, L, pal, info, tl);
      if (info.locked && !(L.compact && L.tiny)) {
        // 도장: 넓은 화면은 오른쪽 아래(칩 줄 반대편), 좁은 화면은 칩 줄 위 오른쪽 땅
        const sc = L.thumb ? 0.5 : L.compact ? 0.6 : L.short ? 0.7 : 0.9;
        const sw2 = 150 * sc, sh2 = 58 * sc;
        if (L.miniHud) stamp(g, L, pal, info, w - 10 - sw2 / 2, L.yRear - sh2 / 2 - 8, sc);
        else stamp(g, L, pal, info, w - 16 - sw2 / 2, h - 14 - sh2 / 2, sc);
      }
      g.restore();
    }

    /* ---------- 글 요약(캔버스 aria-label)과 칩 ---------- */
    const vs = info.v;
    const range = span(dBest, dWorst, 1);
    const caption = (moving
      ? `${k.name} 허용 속도 ${v} km/h로 달리는 셔틀. 필요 감지 거리 ${range}, 감지 거리 ${k.R} m: ${ZONE_TEXT[zone]}.`
      : `${k.name}은 운행 금지를 선택해 셔틀이 멈춰 있음.`)
      + ` 세 조건 허용 속도 맑음 ${vs.clear}·비 ${vs.rain}·안개 ${vs.fog} km/h, 시험 주행 ${info.n}회`
      + (info.locked ? `, 허가 결정 확정(${k.name} ${MODE[info.modes[band]].text}).` : ", 허가 미확정.");
    // 칩은 한 줄에 들어가도록 폭에 따라 고른다(넓음: 다섯 개까지, 중간: 네 개, 좁음: 짧은 이름 세 개, 아주 좁음: 두 개).
    const chips = [];
    const wide = w >= 900, compact = w < 560, narrow = w < 340;
    const prep = ctx.phase === "prep" || !ctx.phase;
    const mode = info.locked ? info.modes[band] : null;
    chips.push({ label: compact ? k.short : k.name, value: moving ? `${v} km/h` : "운행 금지", tone: moving ? "accent" : "volt" });
    if (prep) {
      if (moving) chips.push({ label: compact ? "필요" : "필요 거리", value: compact ? span(dBest, dWorst, 0) : range, tone: ZONE_TONE[zone] });
      if (!narrow || !moving) chips.push({ label: compact ? "감지" : "감지 거리", value: `${k.R} m` });
      if (!compact && (wide || !mode)) chips.push({ label: "시험 주행", value: `${info.n}/10회` });
      if (mode && !compact) chips.push({ label: "심사", value: MODE[mode].text, tone: MODE[mode].tone });
    } else {
      if (mode) chips.push({ label: "심사", value: compact ? MODE_SHORT[mode] : MODE[mode].text, tone: MODE[mode].tone });
      else chips.push({ label: "심사", value: "미확정" });
      if (!compact) chips.push({ label: "시험 주행", value: `${info.n}/10회` });
    }
    return { caption, chips, animate: anim };
  }

  KCP.v2.skin("s-shuttle-permit", { kicker: "NIGHT RUN", title: "새벽셔틀 심야 주행", render });
})();
