/* 2024 켄트로늄 정착 시뮬레이터 · 정착 기지 장면(SETTLEMENT COMMAND)
 * 90년대 후반 외계 행성 실시간 전략 게임의 화면 문법을 빌린 장면이다. 보라·청록 화산재 평원, 푸른 수정 무리,
 * 빛나는 가스 분출구 위에 학생이 고른 정착지 칸을 판으로 깔고, 사령부와 특별 아이템별 모듈을 세운다.
 * 왼쪽 아래 미니맵에는 보고서 지도 전체와 고른 칸, 카메라 상자를 그리고, 오른쪽 위 자원 표시줄에는
 * 게임 화면(#energy 또는 면접실 요약)에 이미 적힌 채굴량·생산량·소비량 글자만 옮긴다.
 * 숨은 속성(행복·건강 등)과 시뮬레이션 기록, 화면에 없는 내부 계산값은 읽지도 그리지도 않는다.
 * 게임 상태는 읽기만 한다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  /* ---------- 공개 자료(게임 화면에 그대로 보이는 지도와 아이템 이름) ---------- */
  const game = KCP.games["2024"];
  const TER_N = { L: "용암", W: "호수", M: "갯벌", D: "사막", F: "숲", G: "초원" };
  const TCOL = { L: [200, 72, 58], W: [114, 205, 196], M: [122, 97, 82], D: [225, 184, 112], F: [59, 132, 72], G: [185, 220, 90] };
  const MAX_TILES = 7, MAX_ITEMS = 10;
  const ITEM_IDS = ["eng", "medP", "medF", "admP", "admF", "eduP", "eduF", "armP", "armF", "funP", "funF", "ccs", "hvac", "bomb", "sub", "seed", "h2", "grid", "ai", "envlab", "mat"];
  // 장면 모듈: 전문가·시설 짝은 한 구역(분야)으로, 나머지는 아이템마다 한 동.
  const MODS = [
    { k: "med", p: "medP", f: "medF", n: "의료" },
    { k: "adm", p: "admP", f: "admF", n: "행정" },
    { k: "edu", p: "eduP", f: "eduF", n: "교육" },
    { k: "arm", p: "armP", f: "armF", n: "무장" },
    { k: "fun", p: "funP", f: "funF", n: "여가·문화" },
    { k: "ccs", f: "ccs", n: "온실가스 포집기" },
    { k: "envlab", f: "envlab", n: "환경기후기술 연구소" },
    { k: "h2", f: "h2", n: "수소에너지 연구소" },
    { k: "grid", f: "grid", n: "차세대그리드 연구소" },
    { k: "ai", f: "ai", n: "에너지AI 연구소" },
    { k: "mat", f: "mat", n: "신소재 연구소" },
    { k: "hvac", f: "hvac", n: "냉난방시설" },
    { k: "seed", f: "seed", n: "종자보관소" },
    { k: "bomb", f: "bomb", n: "폭파장치" },
    { k: "sub", f: "sub", n: "수중기지" },
  ];

  const SQ3 = Math.sqrt(3);

  /* ---------- 지도 기하 ----------
   * 준비실 화면에 그려진 지도(#map polygon[data-hex])에서 칸 id·지형·중심·육각형 방향을 읽는다.
   * 지도 배열이나 좌표 규칙(odd-r, even-q, 뾰족·평평)이 바뀌어도 장면이 그대로 따라가게 하기 위해서다.
   * 좌표는 육각형 외접 반지름이 1이 되도록 정규화한다. 화면 지도가 없으면(면접실·성찰·홈 미리보기)
   * g2024.js가 노출한 보고서 지도(even-q, 위아래 변이 평평한 육각형)를 쓴다. */
  function makeGeo(list, orient) {
    const byId = Object.create(null);
    list.forEach(t => { byId[t.id] = t; });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    list.forEach(t => { if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x; if (t.y < y0) y0 = t.y; if (t.y > y1) y1 = t.y; });
    // 이웃 간격: 가장 가까운 두 중심 사이 거리(정규화 뒤 이론값 √3)
    let nd = Infinity;
    for (let i = 0; i < list.length && i < 400; i++) for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
      if (d > 1e-6 && d < nd) nd = d;
    }
    if (!isFinite(nd)) nd = SQ3;
    const hw = orient === "flat" ? 1 : SQ3 / 2, hh = orient === "flat" ? SQ3 / 2 : 1;
    return { tiles: list, byId, orient, nd, x0: x0 - hw, x1: x1 + hw, y0: y0 - hh, y1: y1 + hh };
  }
  const REPORT_GEO = (() => {
    const list = [];
    game.MAP.forEach((row, r) => row.split("").forEach((t, c) => {
      if (t !== ".") list.push({ id: game.tileId(r, c), t, x: 1.5 * c, y: SQ3 * (r + (c % 2 === 0 ? 0.5 : 0)) });
    }));
    return makeGeo(list, "flat");
  })();
  let domGeo = null, domKey = "";
  function geoFromDom(root) {
    if (!root || typeof root.querySelectorAll !== "function") return null;
    const polys = root.querySelectorAll("#map polygon[data-hex]");
    if (!polys.length) return null;
    const svg = polys[0].ownerSVGElement;
    let key = (svg && svg.getAttribute("viewBox")) || "";
    for (let i = 0; i < polys.length; i++) key += "|" + polys[i].getAttribute("data-hex");
    if (domGeo && key === domKey) return domGeo;
    const raw = [];
    let rsum = 0, rn = 0, pointy = 0, flat = 0;
    for (let i = 0; i < polys.length; i++) {
      const el = polys[i];
      const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number).filter(v => isFinite(v));
      if (nums.length < 12) continue;
      let cx = 0, cy = 0;
      const n = Math.floor(nums.length / 2);
      for (let k = 0; k < n; k++) { cx += nums[2 * k]; cy += nums[2 * k + 1]; }
      cx /= n; cy /= n;
      let r = 0;
      for (let k = 0; k < n; k++) {
        const dx = nums[2 * k] - cx, dy = nums[2 * k + 1] - cy;
        r += Math.hypot(dx, dy);
        const ad = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
        if (Math.abs(ad - 90) < 8) pointy++;
        if (ad < 8 || ad > 172) flat++;
      }
      rsum += r / n; rn++;
      const m = /(?:^|\s)t-([A-Z])(?:\s|$)/.exec(el.getAttribute("class") || "");
      const id = el.getAttribute("data-hex");
      if (id && m) raw.push({ id, t: m[1], x: cx, y: cy });
    }
    if (!raw.length || !rn) return null;
    const R0 = rsum / rn || 1;
    raw.forEach(t => { t.x /= R0; t.y /= R0; });
    domGeo = makeGeo(raw, flat > pointy ? "flat" : "pointy");
    domKey = key;
    return domGeo;
  }
  const geoOf = root => geoFromDom(root) || REPORT_GEO;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rgb = (c, a) => (a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function rng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strSeed(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h | 0;
  }

  /* ---------- 상태 읽기(읽기 전용) ---------- */
  // 에너지 값은 게임이 화면에 적은 글자를 그대로 옮긴다(준비실 #energy, 면접실 요약의 '에너지' 줄).
  function readEnergy(root) {
    if (!root || typeof root.querySelector !== "function") return null;
    const num = s => { const m = String(s || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
    const box = root.querySelector("#energy");
    if (box) {
      const b = box.querySelectorAll("b");
      if (b.length >= 3) {
        const txt = [0, 1, 2].map(i => b[i].textContent.trim());
        const v = txt.map(num);
        // 자급 여부는 게임이 생산량 글자에 칠한 색(--ok/--bad)을 그대로 따른다.
        const style = b[1].getAttribute("style") || "";
        const ok = /--bad/.test(style) ? false : /--ok/.test(style) ? true : v[1] >= v[2];
        if (v.every(x => isFinite(x))) return { K: txt[0], prod: txt[1], cons: txt[2], ok };
      }
    }
    const dts = root.querySelectorAll("dl.recap dt");
    for (let i = 0; i < dts.length; i++) {
      if (dts[i].textContent.trim() !== "에너지") continue;
      const dd = dts[i].nextElementSibling;
      const m = dd && dd.textContent.match(/채굴\s*(-?[\d.]+K)\s*·\s*생산\s*(-?[\d.]+)\s*·\s*소비\s*(-?[\d.]+)/);
      if (m) return { K: m[1], prod: m[2], cons: m[3], ok: /자급/.test(dd.textContent) ? true : /부족/.test(dd.textContent) ? false : Number(m[2]) >= Number(m[3]) };
    }
    return null;
  }
  function read(ctx) {
    const geo = geoOf(ctx.root);
    const TILE = geo.byId;
    const G = ctx.game && typeof ctx.game === "object" ? ctx.game : {};
    const locked = !!(G.locked && typeof G.locked === "object");
    const src = locked ? G.locked : G;
    const seen = Object.create(null);
    const sel = (Array.isArray(src.sel) ? src.sel : []).filter(id => typeof id === "string" && TILE[id] && !seen[id] && (seen[id] = true)).slice(0, MAX_TILES);
    const raw = src.items && typeof src.items === "object" ? src.items : {};
    const items = {};
    let count = 0;
    ITEM_IDS.forEach(id => {
      const v = raw[id];
      if (typeof v === "number" && isFinite(v) && v > 0) { items[id] = Math.min(id === "eng" ? 6 : 1, Math.floor(v)); count += items[id]; }
    });
    return { geo, sel, items, count, locked, energy: ctx.thumb ? null : readEnergy(ctx.root) };
  }

  /* ---------- 색 ---------- */
  function palette(dark) {
    return dark ? {
      dark: true,
      g0: "#1d1333", g1: "#140f26", g2: "#0b171b",
      ashA: [118, 74, 170], ashB: [40, 140, 140], ashC: [12, 8, 22],
      speck: [190, 170, 230], ridge: "rgba(6,4,14,0.55)", ridgeLt: "rgba(150,120,210,0.18)",
      cry: [70, 170, 255], cryLt: [200, 240, 255], cryDk: [24, 70, 150],
      vent: [90, 255, 170], rock: [44, 34, 58], rockLt: [84, 70, 104],
      mHi: [178, 190, 204], mMid: [106, 120, 138], mLo: [58, 68, 82], mDk: [26, 32, 41],
      cyan: [95, 243, 255], amber: [255, 181, 59], green: [99, 239, 143], red: [255, 90, 74],
      shadow: "rgba(0,0,0,0.5)",
    } : {
      dark: false,
      g0: "#a99cc0", g1: "#9488ac", g2: "#7e9e9d",
      ashA: [128, 92, 170], ashB: [60, 150, 148], ashC: [70, 56, 96],
      speck: [240, 232, 255], ridge: "rgba(52,36,82,0.35)", ridgeLt: "rgba(255,250,255,0.28)",
      cry: [62, 150, 236], cryLt: [214, 244, 255], cryDk: [28, 74, 150],
      vent: [60, 230, 150], rock: [92, 78, 112], rockLt: [146, 132, 168],
      mHi: [244, 247, 250], mMid: [170, 181, 195], mLo: [110, 122, 138], mDk: [60, 70, 84],
      cyan: [40, 210, 235], amber: [240, 160, 30], green: [50, 200, 110], red: [226, 64, 48],
      shadow: "rgba(30,20,50,0.38)",
    };
  }

  /* ---------- 바탕(화산재 평원): 크기·테마·배치가 바뀔 때만 다시 그린다 ---------- */
  const groundCache = {};
  function groundLayer(w, h, P, L, thumb) {
    const dpr = typeof KCP.v2.dpr === "function" ? KCP.v2.dpr() : 1;
    const key = [Math.round(w), Math.round(h), P.dark, dpr, L.key].join("|");
    const slot = thumb ? "thumb" : "stage";
    if (groundCache[slot] && groundCache[slot].key === key) return groundCache[slot].cv;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintGround(g, w, h, P, L);
    groundCache[slot] = { key, cv };
    return cv;
  }
  function paintGround(g, w, h, P, L) {
    const gr = g.createLinearGradient(0, 0, w * 0.3, h);
    gr.addColorStop(0, P.g0); gr.addColorStop(0.55, P.g1); gr.addColorStop(1, P.g2);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const R = rng(2024);
    const n = Math.round(clamp(w * h / 700, 60, 520));
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = R() * h, rx = 3 + R() * 34, ry = rx * (0.28 + R() * 0.3);
      const pick = R();
      const col = pick < 0.5 ? P.ashA : pick < 0.82 ? P.ashB : P.ashC;
      g.fillStyle = rgb(col, 0.06 + R() * 0.16);
      g.beginPath(); g.ellipse(x, y, rx, ry, (R() - 0.5) * 0.5, 0, Math.PI * 2); g.fill();
    }
    // 화산재 언덕 줄
    g.lineCap = "round";
    for (let i = 0; i < Math.round(w / 40); i++) {
      const x = R() * w, y = R() * h, len = 30 + R() * 90, bend = (R() - 0.5) * 18;
      g.strokeStyle = P.ridge; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y + bend, x + len, y + bend * 0.3); g.stroke();
      g.strokeStyle = P.ridgeLt; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y - 1.5); g.quadraticCurveTo(x + len / 2, y + bend - 1.5, x + len, y + bend * 0.3 - 1.5); g.stroke();
    }
    // 운석 구덩이
    for (let i = 0; i < Math.round(w / 200) + 1; i++) {
      const x = R() * w, y = h * (0.15 + R() * 0.8), r = 6 + R() * 12;
      if (L.avoid(x, y, r + 6)) continue;
      g.fillStyle = rgb(P.ashC, 0.35);
      g.beginPath(); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(P.speck, 0.22); g.lineWidth = 1;
      g.beginPath(); g.ellipse(x, y + 1, r, r * 0.45, 0, 0.1, Math.PI - 0.1); g.stroke();
    }
    // 반짝이는 재 알갱이
    for (let i = 0; i < n * 2; i++) {
      g.fillStyle = rgb(P.speck, 0.08 + R() * 0.22);
      g.fillRect(R() * w, R() * h, 1, 1);
    }
    L.crystals.forEach((c, i) => crystalCluster(g, c.x, c.y, c.s, P, rng(77 + i * 13)));
    L.vents.forEach(v => ventRim(g, v.x, v.y, v.s, P));
  }
  function crystalCluster(g, x, y, s, P, R) {
    g.fillStyle = P.shadow;
    g.beginPath(); g.ellipse(x + s * 0.2, y + s * 0.15, s * 1.25, s * 0.42, 0, 0, Math.PI * 2); g.fill();
    const shards = 5 + Math.floor(R() * 3);
    const list = [];
    for (let i = 0; i < shards; i++) list.push({ dx: (R() - 0.5) * s * 1.8, dy: (R() - 0.5) * s * 0.5, hgt: s * (0.8 + R() * 1.2), wid: s * (0.22 + R() * 0.16), tilt: (R() - 0.5) * 0.7 });
    list.sort((a, b) => a.dy - b.dy);
    list.forEach(sh => {
      const bx = x + sh.dx, by = y + sh.dy, tx = bx + Math.sin(sh.tilt) * sh.hgt, ty = by - Math.cos(sh.tilt) * sh.hgt;
      const hw = sh.wid;
      g.fillStyle = rgb(mix(P.cry, P.cryLt, 0.35));
      g.beginPath(); g.moveTo(bx - hw, by); g.lineTo(tx - hw * 0.5, ty + sh.hgt * 0.18); g.lineTo(tx, ty); g.lineTo(bx, by + hw * 0.3); g.closePath(); g.fill();
      g.fillStyle = rgb(P.cryDk);
      g.beginPath(); g.moveTo(bx, by + hw * 0.3); g.lineTo(tx, ty); g.lineTo(tx + hw * 0.5, ty + sh.hgt * 0.18); g.lineTo(bx + hw, by); g.closePath(); g.fill();
      g.strokeStyle = rgb(P.cryLt, 0.85); g.lineWidth = 1;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(bx, by + hw * 0.3); g.stroke();
    });
  }
  function ventRim(g, x, y, s, P) {
    g.fillStyle = P.shadow;
    g.beginPath(); g.ellipse(x, y + s * 0.2, s * 1.5, s * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(P.rock);
    g.beginPath(); g.ellipse(x, y, s * 1.3, s * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(P.rockLt);
    g.beginPath(); g.ellipse(x, y - s * 0.08, s * 1.15, s * 0.45, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = "#050308";
    g.beginPath(); g.ellipse(x, y, s * 0.72, s * 0.28, 0, 0, Math.PI * 2); g.fill();
  }

  /* ---------- 배치 계산 ---------- */
  function layout(w, h, thumb, sel, geo) {
    const u = clamp(h / 15.5, thumb ? 3.2 : 4, 17);
    const mmH = thumb ? clamp(h * 0.4, 24, 60) : clamp(h * (w < 560 ? 0.34 : 0.42), 34, 104);
    // 미니맵: 지도 전체 경계(정규화 좌표)를 상자 안쪽 4px 여백에 맞춘다.
    const mmS = (mmH - 8) / Math.max(1, geo.y1 - geo.y0);
    const mmW = (geo.x1 - geo.x0) * mmS + 8;
    const mm = { x: 8, y: h - mmH - 8, w: mmW, h: mmH, s: mmS, geo };
    const left = mm.x + mm.w;
    const rx = u * (w < 560 ? 6.4 : 7.4), ry = u * (w < 560 ? 3.4 : 3.9);
    let bx = left + (w - left) * (w > 700 ? 0.34 : 0.42);
    bx = Math.max(bx, left + rx + u * 3);
    bx = Math.min(bx, w - rx - u * 2.5);
    const by = h * 0.6;
    // 정착지 판: 칸 수에 맞춰 크기를 정한다.
    const tl = sel.map(id => geo.byId[id]);
    const SQ = 0.62;
    let s = u * (w < 560 ? 2.6 : 3.0), cx0 = 0, cy0 = 0;
    if (tl.length) {
      const xs = tl.map(t => t.x), ys = tl.map(t => t.y);
      const hw = geo.orient === "flat" ? 2 : SQ3, hh = geo.orient === "flat" ? SQ3 : 2;
      const spanX = Math.max(...xs) - Math.min(...xs) + hw, spanY = Math.max(...ys) - Math.min(...ys) + hh;
      s = Math.max(4, Math.min(s, (w - left - 24) * 0.8 / spanX, (h * 0.78) / (spanY * SQ)));
      cx0 = (Math.max(...xs) + Math.min(...xs)) / 2;
      cy0 = (Math.max(...ys) + Math.min(...ys)) / 2;
    }
    const foot = tl.map(t => ({ t, x: bx + (t.x - cx0) * s, y: by + (t.y - cy0) * s * SQ }));
    // 장식 자리: 기지와 미니맵, 자원 표시줄을 피한다.
    const readW = thumb ? 0 : Math.min(w * 0.75, 330), readH = thumb ? 0 : 30;
    const boxes = [
      { x0: mm.x - 4, y0: mm.y - 4, x1: mm.x + mm.w + 4, y1: h },
      { x0: bx - rx - u * 3, y0: by - ry - u * 5, x1: bx + rx + u * 3, y1: by + ry + u * 2.5 },
      { x0: w - readW - 10, y0: 0, x1: w, y1: readH + 6 },
    ];
    foot.forEach(f => boxes.push({ x0: f.x - s * 1.1, y0: f.y - s, x1: f.x + s * 1.1, y1: f.y + s }));
    const avoid = (x, y, r) => boxes.some(b => x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1);
    const crystals = [], vents = [];
    const R = rng(4242 + Math.round(w));
    const want = clamp(Math.round(w / 170), 2, 8);
    for (let tries = 0; crystals.length < want && tries < 120; tries++) {
      const cs = u * (1.1 + R() * 0.7), x = 10 + R() * (w - 20), y = h * 0.22 + R() * h * 0.7;
      if (avoid(x, y, cs * 1.4) || crystals.some(c => Math.hypot(c.x - x, c.y - y) < cs * 4)) continue;
      crystals.push({ x, y, s: cs });
    }
    const wantV = clamp(Math.round(w / 420), 1, 3);
    for (let tries = 0; vents.length < wantV && tries < 120; tries++) {
      const vs = u * 1.1, x = 12 + R() * (w - 24), y = h * 0.3 + R() * h * 0.6;
      if (avoid(x, y, vs * 1.8) || crystals.concat(vents).some(c => Math.hypot(c.x - x, c.y - y) < vs * 5)) continue;
      vents.push({ x, y, s: vs });
    }
    const key = Math.round(u * 10) + ":" + Math.round(bx) + ":" + geo.orient + geo.tiles.length + ":" + sel.slice().sort().join(",");
    return { u, mm, bx, by, rx, ry, s, SQ, foot, crystals, vents, avoid, key, geo };
  }

  /* ---------- 정착지 판 ---------- */
  // orient: "pointy"(꼭짓점이 위아래) 또는 "flat"(위아래 변이 평평)
  function hexPts(x, y, s, sq, orient) {
    const p = [], off = orient === "flat" ? 0 : -30;
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i + off); p.push([x + s * Math.cos(a), y + s * Math.sin(a) * sq]); }
    return p;
  }
  function pathPts(g, p) { g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); }
  const TOP = { L: [60, 28, 30], W: [28, 104, 116], M: [80, 60, 52], D: [168, 132, 78], F: [30, 74, 60], G: [94, 140, 66] };
  function tileTexture(g, f, s, sq, t) {
    const R = rng(strSeed(f.t.id));
    const x = f.x, y = f.y, k = f.t.t;
    if (k === "L") {
      const pulse = 0.65 + 0.35 * Math.sin(t * 2.2 + f.x * 0.05);
      g.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        let px = x + (R() - 0.5) * s * 1.4, py = y + (R() - 0.5) * s * sq * 1.2;
        const pts = [[px, py]];
        for (let j = 0; j < 4; j++) { px += (R() - 0.3) * s * 0.4; py += (R() - 0.5) * s * 0.25; pts.push([px, py]); }
        g.beginPath(); pts.forEach((q, i2) => (i2 ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
        g.strokeStyle = `rgba(255,110,40,${0.25 * pulse})`; g.lineWidth = 4; g.stroke();
        g.strokeStyle = `rgba(255,190,90,${0.9 * pulse})`; g.lineWidth = 1.3; g.stroke();
      }
    } else if (k === "W") {
      const gr = g.createLinearGradient(x, y - s, x, y + s);
      gr.addColorStop(0, "rgba(120,230,230,0.35)"); gr.addColorStop(1, "rgba(10,40,60,0.25)");
      g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.35 + i / 3) % 1;
        g.strokeStyle = `rgba(210,255,250,${0.45 * (1 - ph)})`; g.lineWidth = 1;
        g.beginPath(); g.ellipse(x + (R() - 0.5) * s * 0.6, y + (R() - 0.5) * s * 0.3, s * (0.15 + ph * 0.5), s * sq * (0.08 + ph * 0.25), 0, 0, Math.PI * 2); g.stroke();
      }
    } else if (k === "M") {
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? "rgba(40,28,24,0.55)" : "rgba(120,150,150,0.28)";
        g.beginPath(); g.ellipse(x + (R() - 0.5) * s * 1.3, y + (R() - 0.5) * s * sq * 1.2, s * (0.12 + R() * 0.18), s * sq * (0.06 + R() * 0.1), 0, 0, Math.PI * 2); g.fill();
      }
    } else if (k === "D") {
      g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const yy = y - s * sq * 0.6 + i * s * sq * 0.4;
        g.strokeStyle = "rgba(120,86,40,0.6)";
        g.beginPath(); g.moveTo(x - s, yy); g.quadraticCurveTo(x, yy - s * 0.25, x + s, yy + 2); g.stroke();
        g.strokeStyle = "rgba(240,210,150,0.5)";
        g.beginPath(); g.moveTo(x - s, yy - 1.5); g.quadraticCurveTo(x, yy - s * 0.25 - 1.5, x + s, yy + 0.5); g.stroke();
      }
    } else if (k === "F") {
      for (let i = 0; i < 6; i++) {
        const tx = x + (R() - 0.5) * s * 1.3, ty = y + (R() - 0.5) * s * sq * 1.3, tr = s * (0.14 + R() * 0.1);
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.beginPath(); g.ellipse(tx + tr * 0.3, ty + tr * 0.4, tr, tr * 0.55, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = R() < 0.3 ? "#6b4e96" : "#2f8064";
        g.beginPath(); g.arc(tx, ty - tr * 0.4, tr, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(160,240,200,0.55)";
        g.beginPath(); g.arc(tx - tr * 0.3, ty - tr * 0.7, tr * 0.35, 0, Math.PI * 2); g.fill();
      }
    } else if (k === "G") {
      g.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const tx = x + (R() - 0.5) * s * 1.5, ty = y + (R() - 0.5) * s * sq * 1.4;
        g.strokeStyle = i % 3 ? "rgba(170,230,110,0.8)" : "rgba(50,90,40,0.8)";
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 1.5, ty - s * 0.16); g.moveTo(tx, ty); g.lineTo(tx + 1.5, ty - s * 0.14); g.stroke();
      }
    }
  }
  // 가장자리 i(꼭짓점 i→i+1) 너머에 고른 칸이 있는지: 변 중점 쪽으로 이웃 간격만큼 간 자리에 중심이 있으면 이웃이다.
  function sharedEdge(f, i, foot, geo) {
    const v = hexPts(f.t.x, f.t.y, 1, 1, geo.orient), a = v[i], b = v[(i + 1) % 6];
    const mx = (a[0] + b[0]) / 2 - f.t.x, my = (a[1] + b[1]) / 2 - f.t.y, ml = Math.hypot(mx, my) || 1;
    const nx = f.t.x + (mx / ml) * geo.nd, ny = f.t.y + (my / ml) * geo.nd;
    return foot.some(o => o !== f && Math.hypot(o.t.x - nx, o.t.y - ny) < geo.nd * 0.25);
  }
  function paintFootprint(g, L, sel, P, t, reduced) {
    const s = L.s, sq = L.SQ, th = Math.max(2, s * 0.2), geo = L.geo;
    const foot = L.foot.slice().sort((a, b) => a.y - b.y);
    foot.forEach(f => {
      const p = hexPts(f.x, f.y, s * 0.985, sq, geo.orient);
      g.fillStyle = rgb(mix(TOP[f.t.t], [0, 0, 0], 0.55));
      g.beginPath();
      g.moveTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); g.lineTo(p[2][0], p[2][1]); g.lineTo(p[3][0], p[3][1]);
      g.lineTo(p[3][0], p[3][1] + th); g.lineTo(p[2][0], p[2][1] + th); g.lineTo(p[1][0], p[1][1] + th); g.lineTo(p[0][0], p[0][1] + th);
      g.closePath(); g.fill();
      pathPts(g, p);
      g.fillStyle = rgb(TOP[f.t.t]);
      g.fill();
      g.save(); pathPts(g, p); g.clip();
      tileTexture(g, f, s, sq, reduced ? 0 : t);
      g.restore();
      pathPts(g, p);
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1; g.stroke();
    });
    // 바깥 경계: 고른 정착지 테두리(선택 표시)
    const pulse = reduced ? 0.85 : 0.6 + 0.4 * Math.sin(t * 2.4);
    g.lineCap = "round";
    [[5, 0.25 * pulse], [1.6, 0.95]].forEach(([lw, a]) => {
      g.strokeStyle = rgb(P.cyan, a); g.lineWidth = lw;
      g.beginPath();
      foot.forEach(f => {
        const p = hexPts(f.x, f.y, s * 0.985, sq, geo.orient);
        for (let i = 0; i < 6; i++) {
          if (sharedEdge(f, i, foot, geo)) continue;
          const a1 = p[i], a2 = p[(i + 1) % 6];
          g.moveTo(a1[0], a1[1]); g.lineTo(a2[0], a2[1]);
        }
      });
      g.stroke();
    });
  }

  /* ---------- 건물 ---------- */
  // 3/4 시점 상자: (x, y)는 바닥 앞 가운데. wd 너비, dp 지붕 깊이, ht 앞벽 높이.
  function block(g, x, y, wd, dp, ht, roof, wall, edge) {
    g.fillStyle = wall;
    g.fillRect(x - wd / 2, y - ht, wd, ht);
    g.fillStyle = roof;
    g.fillRect(x - wd / 2, y - ht - dp, wd, dp);
    if (edge) { g.fillStyle = edge; g.fillRect(x - wd / 2, y - ht - 1, wd, 1.2); }
  }
  function shadow(g, x, y, rx, ry, P) {
    g.fillStyle = P.shadow;
    g.beginPath(); g.ellipse(x + rx * 0.12, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
  function lamp(g, x, y, r, col, on) {
    g.fillStyle = rgb(col, on ? 0.35 : 0.12);
    g.beginPath(); g.arc(x, y, r * 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = on ? rgb(col) : rgb(mix(col, [0, 0, 0], 0.55));
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const metal = (P, f) => rgb(mix(P.mLo, P.mHi, f));

  function commandCenter(g, x, y, u, P, t, st, reduced) {
    const hover = st.sel.length ? 0 : (reduced ? u * 1.2 : u * (1.1 + 0.25 * Math.sin(t * 2)));
    shadow(g, x, y + u * 0.2, u * 3.1, u * 1.1, P);
    if (hover) {
      // 착륙 지점을 아직 고르지 않음: 공중에 떠 있는 사령부와 점선 착륙 표지
      g.setLineDash([4, 4]); g.strokeStyle = rgb(P.amber, 0.85); g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(x, y, u * 3.4, u * 1.3, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      [-1.8, 1.8].forEach(dx => {
        const fl = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(t * 18 + dx);
        const gr = g.createLinearGradient(0, y - hover, 0, y - hover + u * 1.6);
        gr.addColorStop(0, rgb(P.cyan, 0.9 * fl)); gr.addColorStop(1, rgb(P.cyan, 0));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x + dx * u - u * 0.35, y - hover); g.lineTo(x + dx * u + u * 0.35, y - hover); g.lineTo(x + dx * u, y - hover + u * 1.6); g.closePath(); g.fill();
      });
    }
    const yy = y - hover;
    g.fillStyle = metal(P, 0.15);
    [[-2.6, 0], [2.6, 0], [-1.5, 0.35], [1.5, 0.35]].forEach(([dx, dy]) => g.fillRect(x + dx * u - u * 0.18, yy - u * 0.9 + dy * u, u * 0.36, u * 0.9));
    const W = u * 5.2, D = u * 2.5, H = u * 1.5;
    // 옆 날개(격납고)
    block(g, x - W / 2 - u * 0.5, yy - u * 0.4, u * 1.4, u * 1.1, u * 0.9, metal(P, 0.5), metal(P, 0.18), rgb(P.mHi, 0.6));
    block(g, x + W / 2 + u * 0.5, yy - u * 0.4, u * 1.4, u * 1.1, u * 0.9, metal(P, 0.5), metal(P, 0.18), rgb(P.mHi, 0.6));
    // 몸체: 앞벽 + 팔각 지붕
    g.fillStyle = metal(P, 0.2);
    g.beginPath();
    g.moveTo(x - W / 2, yy - u * 0.6); g.lineTo(x - W / 2 + u * 0.7, yy - u * 0.2); g.lineTo(x + W / 2 - u * 0.7, yy - u * 0.2); g.lineTo(x + W / 2, yy - u * 0.6);
    g.lineTo(x + W / 2, yy - u * 0.6 - H); g.lineTo(x - W / 2, yy - u * 0.6 - H); g.closePath(); g.fill();
    const top = yy - u * 0.6 - H;
    g.fillStyle = metal(P, 0.62);
    g.beginPath();
    g.moveTo(x - W / 2, top); g.lineTo(x - W / 2 + u * 0.8, top - D); g.lineTo(x + W / 2 - u * 0.8, top - D); g.lineTo(x + W / 2, top);
    g.closePath(); g.fill();
    g.fillStyle = rgb(P.mHi, 0.7); g.fillRect(x - W / 2, top - 1, W, 1.4);
    g.fillStyle = rgb(P.mDk, 0.7);
    for (let i = -2; i <= 2; i++) g.fillRect(x + i * u - 0.5, top + u * 0.15, 1, H - u * 0.3);
    g.fillStyle = rgb(P.amber, 0.9);
    g.fillRect(x - W / 2 + u * 0.4, top + H * 0.62, W - u * 0.8, u * 0.22);
    // 지붕 위 돔
    g.fillStyle = metal(P, 0.4);
    g.beginPath(); g.ellipse(x, top - D * 0.5, u * 1.5, u * 0.7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = metal(P, 0.85);
    g.beginPath(); g.ellipse(x, top - D * 0.62, u * 1.1, u * 0.5, 0, Math.PI, Math.PI * 2); g.fill();
    g.strokeStyle = rgb(P.cyan, 0.9); g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(x, top - D * 0.5, u * 1.5, u * 0.7, 0, 0.15, Math.PI - 0.15); g.stroke();
    // 상태등: 화면에 생산 ≥ 소비로 표시되면 초록, 부족하면 깜박이는 주황, 값이 없으면 청록
    const e = st.energy;
    const col = !e ? P.cyan : e.ok ? P.green : P.amber;
    const on = reduced || !e || e.ok ? true : Math.sin(t * 7) > -0.2;
    lamp(g, x - u * 1.9, top - D * 0.45, u * 0.22, col, on);
    lamp(g, x + u * 1.9, top - D * 0.45, u * 0.22, col, on);
    lamp(g, x, top - D * 0.62 - u * 0.55, u * 0.18, P.red, reduced ? true : Math.sin(t * 3) > 0.3);
  }

  function hut(g, x, y, u, P, col) {
    shadow(g, x, y, u * 0.9, u * 0.35, P);
    g.fillStyle = metal(P, 0.3);
    g.fillRect(x - u * 0.8, y - u * 0.7, u * 1.6, u * 0.7);
    g.fillStyle = metal(P, 0.75);
    g.beginPath(); g.moveTo(x - u * 0.9, y - u * 0.7); g.lineTo(x, y - u * 1.4); g.lineTo(x + u * 0.9, y - u * 0.7); g.closePath(); g.fill();
    g.fillStyle = rgb(col);
    g.fillRect(x - u * 0.2, y - u * 0.55, u * 0.4, u * 0.55);
  }
  function plus(g, x, y, r, col) {
    g.fillStyle = col;
    g.fillRect(x - r, y - r * 0.33, r * 2, r * 0.66);
    g.fillRect(x - r * 0.33, y - r, r * 0.66, r * 2);
  }

  // 모듈 하나를 그린다. m.p: 전문가를 골랐다(작은 막사), m.f: 시설·아이템을 골랐다(건물).
  function module(g, m, x, y, u, P, t, reduced, onWater) {
    const blink = k => reduced || Math.sin(t * 3 + k) > 0;
    const f = m.f, p = m.p;
    switch (m.k) {
      case "med": {
        if (f) {
          shadow(g, x, y, u * 1.5, u * 0.5, P);
          block(g, x, y, u * 2.4, u * 1.2, u * 1.1, metal(P, 0.95), metal(P, 0.55), rgb(P.mHi));
          plus(g, x, y - u * 1.7, u * 0.42, rgb(P.cyan));
          g.fillStyle = rgb(P.cyan, 0.8); g.fillRect(x - u * 0.9, y - u * 0.75, u * 1.8, u * 0.2);
        }
        if (p) {
          const hx = x + (f ? u * 1.8 : 0), hy = y + (f ? u * 0.3 : 0);
          hut(g, hx, hy, u * 0.8, P, P.cyan);
          plus(g, hx, hy - u * 1.35, u * 0.22, rgb(P.cyan));
        }
        break;
      }
      case "adm": {
        if (f) {
          shadow(g, x, y, u * 1.1, u * 0.4, P);
          block(g, x, y, u * 1.4, u * 0.8, u * 2.6, metal(P, 0.7), metal(P, 0.35), rgb(P.mHi, 0.8));
          g.fillStyle = rgb(P.cyan, 0.75);
          for (let i = 0; i < 3; i++) g.fillRect(x - u * 0.45, y - u * 2.3 + i * u * 0.7, u * 0.9, u * 0.22);
          g.strokeStyle = metal(P, 0.9); g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y - u * 3.4); g.lineTo(x, y - u * 4.4); g.stroke();
          lamp(g, x, y - u * 4.5, u * 0.16, P.red, blink(1));
        }
        if (p) {
          const hx = x + (f ? -u * 1.5 : 0), hy = y + (f ? u * 0.3 : 0);
          hut(g, hx, hy, u * 0.8, P, P.amber);
          g.strokeStyle = metal(P, 0.9); g.lineWidth = 1;
          g.beginPath(); g.arc(hx + u * 0.5, hy - u * 1.1, u * 0.35, Math.PI * 0.9, Math.PI * 1.9); g.stroke();
        }
        break;
      }
      case "edu": {
        if (f) {
          shadow(g, x, y, u * 1.5, u * 0.5, P);
          g.fillStyle = metal(P, 0.3); g.fillRect(x - u * 1.3, y - u * 0.5, u * 2.6, u * 0.5);
          g.fillStyle = metal(P, 0.7);
          g.beginPath(); g.ellipse(x, y - u * 0.5, u * 1.3, u * 1.3, 0, Math.PI, Math.PI * 2); g.fill();
          g.strokeStyle = rgb(P.cyan, 0.7); g.lineWidth = 1;
          g.beginPath(); g.ellipse(x, y - u * 0.5, u * 0.65, u * 1.3, 0, Math.PI, Math.PI * 2); g.stroke();
          g.beginPath(); g.moveTo(x - u * 1.25, y - u * 1.0); g.lineTo(x + u * 1.25, y - u * 1.0); g.stroke();
          g.beginPath(); g.moveTo(x, y - u * 1.8); g.lineTo(x, y - u * 0.5); g.stroke();
        }
        if (p) hut(g, x + (f ? u * 1.7 : 0), y + (f ? u * 0.3 : 0), u * 0.8, P, P.green);
        break;
      }
      case "arm": {
        if (f) {
          shadow(g, x, y, u * 1.6, u * 0.55, P);
          block(g, x, y, u * 2.6, u * 1.3, u * 0.8, rgb(mix(P.mMid, [90, 110, 70], 0.35)), rgb(mix(P.mLo, [50, 60, 40], 0.4)), rgb(P.mHi, 0.6));
          g.fillStyle = metal(P, 0.5);
          g.beginPath(); g.ellipse(x, y - u * 1.45, u * 0.75, u * 0.42, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = metal(P, 0.1); g.lineWidth = Math.max(1.5, u * 0.22);
          g.beginPath(); g.moveTo(x + u * 0.2, y - u * 1.55); g.lineTo(x + u * 1.4, y - u * 1.95); g.moveTo(x + u * 0.2, y - u * 1.35); g.lineTo(x + u * 1.4, y - u * 1.75); g.stroke();
          g.fillStyle = "rgba(0,0,0,0.7)"; g.fillRect(x - u * 1.0, y - u * 0.55, u * 2.0, u * 0.18);
        }
        if (p) {
          const hx = x + (f ? -u * 1.7 : 0), hy = y + (f ? u * 0.4 : 0);
          g.fillStyle = rgb(mix(P.mMid, [150, 130, 90], 0.5));
          for (let i = 0; i < 5; i++) { const a = Math.PI * (0.1 + i * 0.2); g.beginPath(); g.ellipse(hx + Math.cos(a) * u * 0.7, hy - Math.sin(a) * u * 0.3, u * 0.32, u * 0.2, 0, 0, Math.PI * 2); g.fill(); }
          lamp(g, hx, hy - u * 0.5, u * 0.14, P.amber, blink(2));
        }
        break;
      }
      case "fun": {
        if (f) {
          shadow(g, x, y, u * 1.6, u * 0.55, P);
          g.fillStyle = metal(P, 0.25); g.fillRect(x - u * 1.4, y - u * 0.35, u * 2.8, u * 0.35);
          g.fillStyle = rgb(P.green, 0.28);
          g.beginPath(); g.ellipse(x, y - u * 0.35, u * 1.4, u * 1.4, 0, Math.PI, Math.PI * 2); g.fill();
          g.fillStyle = "#2f8064";
          [[-0.6, 0.9], [0.1, 1.2], [0.7, 0.8]].forEach(([dx, hh]) => { g.beginPath(); g.arc(x + dx * u, y - u * (0.35 + hh * 0.6), u * 0.32, 0, Math.PI * 2); g.fill(); });
          g.strokeStyle = rgb(P.cryLt, 0.8); g.lineWidth = 1;
          g.beginPath(); g.ellipse(x, y - u * 0.35, u * 1.4, u * 1.4, 0, Math.PI, Math.PI * 2); g.stroke();
          g.beginPath(); g.ellipse(x - u * 0.4, y - u * 1.2, u * 0.4, u * 0.25, -0.5, Math.PI, Math.PI * 1.7); g.stroke();
        }
        if (p) hut(g, x + (f ? u * 1.8 : 0), y + (f ? u * 0.3 : 0), u * 0.8, P, P.green);
        break;
      }
      case "ccs": {
        shadow(g, x, y, u * 1.0, u * 0.38, P);
        g.fillStyle = metal(P, 0.35); g.fillRect(x - u * 0.6, y - u * 2.6, u * 1.2, u * 2.6);
        g.fillStyle = metal(P, 0.75);
        g.beginPath(); g.ellipse(x, y - u * 2.6, u * 0.6, u * 0.28, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = rgb(P.cyan, 0.6); g.lineWidth = 1;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x, y - u * (0.6 + i * 0.7), u * 0.6, u * 0.18, 0, 0, Math.PI); g.stroke(); }
        for (let i = 0; i < 4; i++) {
          const ph = reduced ? i / 4 : (t * 0.5 + i / 4) % 1;
          g.fillStyle = rgb(P.vent, 0.35 * (1 - ph));
          g.beginPath(); g.arc(x - u * (1.8 - ph * 1.2), y - u * (3.0 - ph * 0.3), u * (0.25 - ph * 0.1), 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case "envlab": {
        shadow(g, x, y, u * 1.4, u * 0.5, P);
        block(g, x, y, u * 2.2, u * 1.1, u * 1.0, metal(P, 0.8), metal(P, 0.4), rgb(P.mHi, 0.7));
        g.fillStyle = rgb(mix(P.green, [255, 255, 255], 0.1), 0.85);
        g.beginPath(); g.ellipse(x + u * 0.4, y - u * 1.9, u * 0.5, u * 0.65, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = rgb(P.green, 0.9); g.fillRect(x - u * 0.8, y - u * 0.7, u * 0.8, u * 0.2);
        break;
      }
      case "h2": {
        shadow(g, x, y, u * 1.6, u * 0.5, P);
        [-0.75, 0.75].forEach(dx => {
          const cx = x + dx * u, cy = y - u * 0.9;
          const gr = g.createRadialGradient(cx - u * 0.3, cy - u * 0.3, u * 0.1, cx, cy, u * 0.85);
          gr.addColorStop(0, rgb(P.cryLt)); gr.addColorStop(1, rgb(mix(P.cyan, P.mLo, 0.5)));
          g.fillStyle = gr;
          g.beginPath(); g.arc(cx, cy, u * 0.8, 0, Math.PI * 2); g.fill();
        });
        g.fillStyle = metal(P, 0.3); g.fillRect(x - u * 1.5, y - u * 0.25, u * 3.0, u * 0.25);
        break;
      }
      case "grid": {
        shadow(g, x, y, u * 0.9, u * 0.3, P);
        g.strokeStyle = metal(P, 0.85); g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(x - u * 0.7, y); g.lineTo(x, y - u * 3.2); g.lineTo(x + u * 0.7, y);
        g.moveTo(x - u * 0.45, y - u * 1.0); g.lineTo(x + u * 0.45, y - u * 1.0);
        g.moveTo(x - u * 0.25, y - u * 2.0); g.lineTo(x + u * 0.25, y - u * 2.0);
        g.moveTo(x - u * 1.0, y - u * 2.6); g.lineTo(x + u * 1.0, y - u * 2.6);
        g.stroke();
        lamp(g, x - u * 1.0, y - u * 2.6, u * 0.13, P.cyan, blink(4));
        lamp(g, x + u * 1.0, y - u * 2.6, u * 0.13, P.cyan, blink(5));
        break;
      }
      case "ai": {
        shadow(g, x, y, u * 1.3, u * 0.45, P);
        block(g, x, y, u * 1.8, u * 0.9, u * 0.9, metal(P, 0.7), metal(P, 0.3), rgb(P.mHi, 0.7));
        g.fillStyle = metal(P, 0.9);
        g.beginPath(); g.ellipse(x, y - u * 2.3, u * 0.95, u * 0.55, -0.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = metal(P, 0.2); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y - u * 1.8); g.lineTo(x, y - u * 2.3); g.lineTo(x + u * 0.6, y - u * 2.9); g.stroke();
        for (let i = 0; i < 3; i++) lamp(g, x - u * 0.5 + i * u * 0.5, y - u * 0.45, u * 0.1, i === 1 ? P.amber : P.green, reduced || Math.sin(t * 5 + i * 2) > 0);
        break;
      }
      case "mat": {
        shadow(g, x, y, u * 1.4, u * 0.5, P);
        block(g, x, y, u * 2.2, u * 1.0, u * 1.2, metal(P, 0.55), metal(P, 0.22), rgb(P.mHi, 0.6));
        g.fillStyle = metal(P, 0.35); g.fillRect(x + u * 0.4, y - u * 3.0, u * 0.5, u * 1.9);
        const glow = reduced ? 0.9 : 0.7 + 0.3 * Math.sin(t * 4);
        g.fillStyle = `rgba(255,140,40,${glow})`; g.fillRect(x - u * 0.8, y - u * 0.75, u * 0.9, u * 0.35);
        for (let i = 0; i < 3; i++) {
          const ph = reduced ? i / 3 : (t * 0.4 + i / 3) % 1;
          g.fillStyle = rgb(P.mHi, 0.35 * (1 - ph));
          g.beginPath(); g.arc(x + u * (0.65 + ph * 0.5), y - u * (3.2 + ph * 1.4), u * (0.25 + ph * 0.35), 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case "hvac": {
        shadow(g, x, y, u * 1.2, u * 0.4, P);
        block(g, x, y, u * 2.0, u * 1.0, u * 0.8, metal(P, 0.6), metal(P, 0.3), rgb(P.mHi, 0.6));
        g.strokeStyle = metal(P, 0.05); g.lineWidth = 1;
        for (let i = 0; i < 5; i++) { const fx = x - u * 0.8 + i * u * 0.4; g.beginPath(); g.moveTo(fx, y - u * 0.7); g.lineTo(fx, y - u * 0.1); g.stroke(); }
        [-0.45, 0.45].forEach((dx, i) => {
          const cx = x + dx * u, cy = y - u * 1.3;
          g.fillStyle = metal(P, 0.2); g.beginPath(); g.ellipse(cx, cy, u * 0.38, u * 0.22, 0, 0, Math.PI * 2); g.fill();
          const a = reduced ? 0 : t * 8 + i;
          g.strokeStyle = rgb(P.cyan, 0.8);
          g.beginPath(); g.moveTo(cx - Math.cos(a) * u * 0.3, cy - Math.sin(a) * u * 0.15); g.lineTo(cx + Math.cos(a) * u * 0.3, cy + Math.sin(a) * u * 0.15); g.stroke();
        });
        break;
      }
      case "seed": {
        shadow(g, x, y, u * 1.1, u * 0.4, P);
        g.fillStyle = metal(P, 0.3);
        g.beginPath(); g.moveTo(x - u * 1.0, y); g.lineTo(x - u * 0.7, y - u * 0.9); g.lineTo(x + u * 0.7, y - u * 0.9); g.lineTo(x + u * 1.0, y); g.closePath(); g.fill();
        g.fillStyle = metal(P, 0.7); g.fillRect(x - u * 0.7, y - u * 1.2, u * 1.4, u * 0.3);
        g.fillStyle = rgb(P.green);
        g.beginPath(); g.ellipse(x, y - u * 0.45, u * 0.32, u * 0.18, -0.6, 0, Math.PI * 2); g.fill();
        break;
      }
      case "bomb": {
        shadow(g, x, y, u * 1.2, u * 0.4, P);
        [[-0.55, 0], [0.55, 0], [0, -0.75]].forEach(([dx, dy]) => {
          const cx = x + dx * u, cy = y + dy * u;
          block(g, cx, cy, u * 1.0, u * 0.45, u * 0.65, rgb(mix(P.amber, [255, 255, 255], 0.2)), rgb(mix(P.amber, [0, 0, 0], 0.25)), null);
          g.fillStyle = "rgba(20,16,10,0.85)";
          for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.moveTo(cx - u * 0.5 + i * u * 0.36, cy); g.lineTo(cx - u * 0.32 + i * u * 0.36, cy);
            g.lineTo(cx - u * 0.14 + i * u * 0.36, cy - u * 0.65); g.lineTo(cx - u * 0.32 + i * u * 0.36, cy - u * 0.65);
            g.closePath(); g.fill();
          }
        });
        break;
      }
      case "sub": {
        if (onWater) {
          for (let i = 0; i < 2; i++) {
            const ph = reduced ? 0.4 + i * 0.3 : (t * 0.5 + i / 2) % 1;
            g.strokeStyle = rgb(P.cryLt, 0.5 * (1 - ph)); g.lineWidth = 1;
            g.beginPath(); g.ellipse(x, y - u * 0.1, u * (1.2 + ph * 0.9), u * (0.4 + ph * 0.3), 0, 0, Math.PI * 2); g.stroke();
          }
          g.fillStyle = metal(P, 0.7);
          g.beginPath(); g.ellipse(x, y - u * 0.1, u * 1.1, u * 0.7, 0, Math.PI, Math.PI * 2); g.fill();
          g.fillStyle = rgb(P.cyan, 0.85);
          for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x + i * u * 0.45, y - u * 0.4, u * 0.13, 0, Math.PI * 2); g.fill(); }
        } else {
          shadow(g, x, y, u * 1.1, u * 0.4, P);
          g.fillStyle = metal(P, 0.6);
          g.beginPath(); g.ellipse(x, y - u * 0.5, u * 1.1, u * 0.55, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = rgb(P.cyan, 0.85);
          for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x + i * u * 0.45, y - u * 0.5, u * 0.13, 0, Math.PI * 2); g.fill(); }
          g.strokeStyle = metal(P, 0.9); g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x + u * 0.4, y - u * 1.0); g.lineTo(x + u * 0.4, y - u * 1.6); g.lineTo(x + u * 0.8, y - u * 1.6); g.stroke();
        }
        break;
      }
      default: break;
    }
  }

  function modulesOf(items) {
    const has = id => (items[id] || 0) > 0;
    return MODS.filter(m => has(m.f) || (m.p && has(m.p))).map(m => ({ k: m.k, n: m.n, p: !!(m.p && has(m.p)), f: has(m.f) }));
  }

  /* ---------- 일꾼 드론(엔지니어) ---------- */
  function drone(g, x, y, u, P, carry, t, i) {
    const bob = Math.sin(t * 6 + i) * u * 0.12;
    g.fillStyle = P.shadow;
    g.beginPath(); g.ellipse(x, y + u * 0.9, u * 0.45, u * 0.16, 0, 0, Math.PI * 2); g.fill();
    const yy = y + bob;
    g.fillStyle = rgb(mix(P.amber, P.mMid, 0.35));
    g.beginPath(); g.ellipse(x, yy, u * 0.5, u * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(P.mHi);
    g.beginPath(); g.ellipse(x - u * 0.12, yy - u * 0.1, u * 0.2, u * 0.12, 0, 0, Math.PI * 2); g.fill();
    if (carry) {
      g.fillStyle = rgb(P.cyan, 0.35); g.beginPath(); g.arc(x + u * 0.45, yy + u * 0.15, u * 0.38, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgb(P.cryLt); g.beginPath(); g.arc(x + u * 0.45, yy + u * 0.15, u * 0.17, 0, Math.PI * 2); g.fill();
    }
  }

  /* ---------- 분출구 증기 ---------- */
  function ventSteam(g, v, P, t, reduced) {
    const glow = reduced ? 0.8 : 0.65 + 0.35 * Math.sin(t * 3 + v.x);
    const gr = g.createRadialGradient(v.x, v.y, 1, v.x, v.y, v.s * 1.1);
    gr.addColorStop(0, rgb(P.vent, 0.9 * glow)); gr.addColorStop(1, rgb(P.vent, 0));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(v.x, v.y, v.s * 1.1, v.s * 0.45, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 5; i++) {
      const ph = reduced ? (i + 0.5) / 5 : (t * 0.35 + i / 5) % 1;
      g.fillStyle = rgb(P.vent, 0.28 * (1 - ph));
      g.beginPath(); g.arc(v.x + Math.sin(ph * 5 + i) * v.s * 0.4, v.y - ph * v.s * 4, v.s * (0.35 + ph * 0.8), 0, Math.PI * 2); g.fill();
    }
  }

  /* ---------- 미니맵 ---------- */
  function minimap(g, mm, st, P, t, reduced) {
    const { x, y, w, h, s } = mm;
    g.fillStyle = rgb(P.mHi); g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle = rgb(P.mDk); g.fillRect(x - 1, y - 1, w + 4, h + 4);
    g.fillStyle = rgb(P.mMid); g.fillRect(x - 2, y - 2, w + 3, h + 3);
    g.fillStyle = "#03070a"; g.fillRect(x, y, w, h);
    const geo = mm.geo, ox = x + 4, oy = y + 4;
    const set = new Set(st.sel);
    const cen = tt => [ox + (tt.x - geo.x0) * s, oy + (tt.y - geo.y0) * s];
    geo.tiles.forEach(tt => {
      const c = cen(tt);
      pathPts(g, hexPts(c[0], c[1], s * 0.92, 1, geo.orient));
      g.fillStyle = set.has(tt.id) ? rgb(mix(TCOL[tt.t], [255, 255, 255], 0.15)) : rgb(mix(TCOL[tt.t], [3, 7, 10], 0.55));
      g.fill();
    });
    const pulse = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * 4);
    st.sel.forEach(id => {
      const c = cen(geo.byId[id]);
      pathPts(g, hexPts(c[0], c[1], s * 0.95, 1, geo.orient));
      g.strokeStyle = `rgba(255,255,255,${pulse})`; g.lineWidth = 1.2; g.stroke();
    });
    // 카메라 상자: 고른 정착지를 둘러싼다. 아직 없으면 가운데 점선.
    let x0, y0, x1, y1;
    if (st.sel.length) {
      const pts = st.sel.map(id => cen(geo.byId[id]));
      x0 = Math.min(...pts.map(p => p[0])) - s * 2.6; x1 = Math.max(...pts.map(p => p[0])) + s * 2.6;
      y0 = Math.min(...pts.map(p => p[1])) - s * 2.1; y1 = Math.max(...pts.map(p => p[1])) + s * 2.1;
    } else {
      x0 = x + w * 0.32; x1 = x + w * 0.68; y0 = y + h * 0.3; y1 = y + h * 0.7;
      g.setLineDash([3, 3]);
    }
    x0 = clamp(x0, x + 1, x + w - 2); x1 = clamp(x1, x + 2, x + w - 1); y0 = clamp(y0, y + 1, y + h - 2); y1 = clamp(y1, y + 2, y + h - 1);
    g.strokeStyle = "rgba(235,255,245,0.95)"; g.lineWidth = 1;
    g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
    g.setLineDash([]);
  }

  /* ---------- 자원 표시줄(게임 화면에 적힌 값만) ---------- */
  function iconCrystal(g, x, y, r, P) {
    g.fillStyle = rgb(P.cry);
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.6, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.6, y); g.closePath(); g.fill();
    g.fillStyle = rgb(P.cryLt);
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x - r * 0.6, y); g.lineTo(x, y + r * 0.1); g.closePath(); g.fill();
  }
  function iconBolt(g, x, y, r, col) {
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x + r * 0.2, y - r); g.lineTo(x - r * 0.55, y + r * 0.15); g.lineTo(x - r * 0.05, y + r * 0.15); g.lineTo(x - r * 0.25, y + r); g.lineTo(x + r * 0.55, y - r * 0.2); g.lineTo(x + r * 0.05, y - r * 0.2); g.closePath(); g.fill();
  }
  function iconPlug(g, x, y, r, col) {
    g.fillStyle = col;
    g.fillRect(x - r * 0.55, y - r * 0.35, r * 1.1, r * 0.8);
    g.fillRect(x - r * 0.4, y - r, r * 0.22, r * 0.7);
    g.fillRect(x + r * 0.18, y - r, r * 0.22, r * 0.7);
    g.fillRect(x - r * 0.12, y + r * 0.4, r * 0.24, r * 0.6);
  }
  function iconCrate(g, x, y, r, col) {
    g.fillStyle = col; g.fillRect(x - r * 0.8, y - r * 0.7, r * 1.6, r * 1.4);
    g.fillStyle = "rgba(3,7,10,0.9)"; g.fillRect(x - r * 0.8, y - r * 0.1, r * 1.6, r * 0.2);
  }
  function readout(g, w, st, P, compact) {
    const e = st.energy;
    const fs = compact ? 11 : 12.5;
    const green = [125, 255, 168], cyan = [120, 236, 255], red = [255, 128, 112], amber = [255, 196, 90];
    const parts = [
      { ic: "k", lab: "채굴", val: e ? e.K : "—", col: cyan },
      { ic: "p", lab: "생산", val: e ? e.prod : "—", col: !e ? cyan : e.ok ? green : red },
      { ic: "c", lab: "소비", val: e ? e.cons : "—", col: cyan },
      { ic: "i", lab: compact ? "" : "아이템", val: `${st.count}/${MAX_ITEMS}`, col: st.count >= MAX_ITEMS ? amber : green },
    ];
    g.font = `600 ${fs}px "IBM Plex Mono", "IBM Plex Sans KR", monospace`;
    g.textBaseline = "middle";
    const ws = parts.map(p => g.measureText((p.lab ? p.lab + " " : "") + p.val).width + fs * 1.9);
    const total = ws.reduce((a, b) => a + b, 0) + 6;
    const x0 = Math.max(4, w - total - 8), y0 = 6, hh = fs + 12;
    g.fillStyle = "rgba(3,7,10,0.82)";
    g.fillRect(x0, y0, total, hh);
    g.strokeStyle = "rgba(120,236,255,0.5)"; g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, total - 1, hh - 1);
    let x = x0 + 6;
    const cy = y0 + hh / 2;
    parts.forEach((p, i) => {
      const r = fs * 0.5;
      if (p.ic === "k") iconCrystal(g, x + r, cy, r, P);
      else if (p.ic === "p") iconBolt(g, x + r, cy, r, rgb(p.col));
      else if (p.ic === "c") iconPlug(g, x + r, cy, r, rgb(cyan));
      else iconCrate(g, x + r, cy, r, rgb(amber));
      let tx = x + fs * 1.35;
      if (p.lab) {
        g.fillStyle = "rgba(200,222,216,0.92)";
        g.fillText(p.lab, tx, cy + 0.5);
        tx += g.measureText(p.lab + " ").width;
      }
      g.fillStyle = rgb(p.col);
      g.fillText(p.val, tx, cy + 0.5);
      x += ws[i];
    });
  }

  /* ---------- 장면 ---------- */
  function render(ctx) {
    const g = ctx.g, w = ctx.w, h = ctx.h;
    const reduced = !!ctx.reduced || !!ctx.thumb;
    const t = reduced ? 0 : ctx.t;
    const P = palette(ctx.scheme === "dark");
    const st = read(ctx);
    const L = layout(w, h, !!ctx.thumb, st.sel, st.geo);
    const u = L.u;

    g.drawImage(groundLayer(w, h, P, L, !!ctx.thumb), 0, 0, w, h);
    L.vents.forEach(v => ventSteam(g, v, P, t, reduced));
    if (st.sel.length) paintFootprint(g, L, st.sel, P, t, reduced);

    // 모듈 자리: 사령부 둘레 타원. 수중기지는 호수 칸이 있으면 그 위로 간다.
    const mods = modulesOf(st.items);
    const lake = L.foot.find(f => f.t.t === "W");
    const ring = mods.filter(m => !(m.k === "sub" && lake));
    const n = ring.length;
    // 바로 위(사령부 뒤)는 비워 두고 고르게 돌린다.
    const placed = ring.map((m, i) => {
      const a = -Math.PI / 2 + Math.PI / Math.max(n, 1) + (Math.PI * 2 * i) / Math.max(n, 1);
      return { m, x: L.bx + Math.cos(a) * L.rx, y: L.by + Math.sin(a) * L.ry + u * 0.2, water: false };
    });
    if (lake && mods.some(m => m.k === "sub")) placed.push({ m: mods.find(m => m.k === "sub"), x: lake.x, y: lake.y + u * 0.4, water: true });

    // 전력 도관: 사령부 → 모듈. 화면에 생산이 소비보다 적게 표시되면 주황으로 깜박인다.
    const e = st.energy;
    const lineCol = !e || e.ok ? P.cyan : P.amber;
    const flick = !e || e.ok || reduced ? 1 : (Math.sin(t * 9) > 0 ? 1 : 0.35);
    g.lineCap = "round";
    placed.forEach((p, i) => {
      const sx = L.bx, sy = L.by - u * 0.3, ex = p.x, ey = p.y - u * 0.1;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey);
      g.strokeStyle = rgb(P.mDk, 0.75); g.lineWidth = Math.max(2, u * 0.32); g.stroke();
      g.strokeStyle = rgb(lineCol, 0.7 * flick); g.lineWidth = 1; g.stroke();
      if (!reduced && (!e || e.ok)) {
        const ph = (t * 0.6 + i * 0.17) % 1;
        g.fillStyle = rgb(lineCol, 0.95);
        g.beginPath(); g.arc(sx + (ex - sx) * ph, sy + (ey - sy) * ph, Math.max(1.2, u * 0.16), 0, Math.PI * 2); g.fill();
      }
    });

    // 뒤(위쪽)부터 그린다
    const draws = placed.map(p => ({ y: p.y, f: () => module(g, p.m, p.x, p.y, u, P, t, reduced, p.water) }));
    draws.push({ y: L.by, f: () => commandCenter(g, L.bx, L.by, u, P, t, st, reduced) });
    draws.sort((a, b) => a.y - b.y).forEach(d => d.f());

    // 엔지니어: 사령부와 정착지 칸 사이를 오가는 채굴 드론(인원수만큼)
    const eng = st.items.eng || 0;
    const targets = L.foot.length ? L.foot : [{ x: L.bx - u * 4, y: L.by + u * 1.5 }, { x: L.bx + u * 4, y: L.by + u * 1.5 }];
    for (let i = 0; i < eng; i++) {
      const tg = targets[i % targets.length];
      const ph = reduced ? 0.3 + (i % 3) * 0.2 : (t * 0.22 + i / Math.max(eng, 1)) % 1;
      const k = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const sx = L.bx + (i % 2 ? u * 2.2 : -u * 2.2), sy = L.by + u * 0.6;
      const ex = tg.x + (((i * 37) % 7) - 3) * u * 0.18, ey = tg.y + u * 0.2;
      drone(g, sx + (ex - sx) * k, sy + (ey - sy) * k - u * 0.9, u * 1.15, P, ph >= 0.5, t, i);
    }

    // 가장자리 어둡게(망원 화면 느낌)
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, P.dark ? "rgba(0,0,0,0.5)" : "rgba(40,24,70,0.22)");
    g.fillStyle = vg; g.fillRect(0, 0, w, h);

    minimap(g, L.mm, st, P, t, reduced);
    if (!ctx.thumb) readout(g, w, st, P, w < 560);

    // 요약(캔버스 설명과 상태 칩)
    const tcount = {};
    st.sel.forEach(id => { const nm = TER_N[st.geo.byId[id].t]; tcount[nm] = (tcount[nm] || 0) + 1; });
    const terr = Object.keys(tcount).map(k => `${k} ${tcount[k]}`).join(", ");
    const modTxt = mods.map(m => m.n).join(", ");
    const caption = `정착 기지 장면. ${st.sel.length ? `고른 정착지 ${st.sel.length}칸(${terr}) 위에 사령부가 내려앉아 있다` : "정착지를 아직 고르지 않아 사령부가 착륙 지점 위에 떠 있다"}. ` +
      `특별 아이템 ${st.count}/${MAX_ITEMS}개. ${modTxt ? `사령부 둘레 모듈: ${modTxt}. ` : "특별 아이템 모듈은 아직 없다. "}` +
      `${eng ? `엔지니어 ${eng}명이 채굴 드론으로 오간다. ` : ""}` +
      `${e ? `화면에 표시된 에너지: 채굴 ${e.K}, 생산 ${e.prod}, 소비 ${e.cons}. ` : ""}왼쪽 아래 미니맵에 정착지 위치를 표시한다.${st.locked ? " 탐사계획 확정됨." : ""}`;
    const narrow = w < 560;
    const chips = [{ label: "정착지", value: `${st.sel.length}/${MAX_TILES}${narrow ? "" : "칸"}`, tone: st.sel.length ? "info" : "" }];
    // 좁은 화면에서 확정 칩이 붙으면 아이템 수는 캔버스 자원 표시줄과 설명에만 둔다(칩이 두 줄로 넘치지 않게).
    if (!(narrow && st.locked && e)) chips.push({ label: "아이템", value: `${st.count}/${MAX_ITEMS}${narrow ? "" : "개"}`, tone: st.count ? "info" : "" });
    if (e) chips.push({ label: narrow ? "에너지" : "에너지 생산/소비", value: `${e.prod}/${e.cons}`, tone: e.ok ? "ok" : "bad" });
    if (st.locked) chips.push({ label: "계획", value: "확정", tone: "warn" });
    return { caption, chips, animate: !reduced };
  }

  KCP.v2.skin("2024", { kicker: "SETTLEMENT COMMAND", title: "켄트로늄 정착 기지", render });
})();
