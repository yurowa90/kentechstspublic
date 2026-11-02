/* 섬 전력망 24시: 3D 섬 장면(화면 시안 v2)
 * 계산·저장·판정은 games/s-island-grid.js가 맡는다. 이 파일은 그 계획과 결과를 섬 위에 보여 주고,
 * 사용자가 장면에서 직접 누른 조작만 게임의 계획 함수(api.set, api.select)로 전달한다.
 * 그리기는 외부 라이브러리 없이 Canvas 2D로 한다: 원근 카메라, 화가 알고리즘, 면 단위 평면 음영. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const ID = "s-island-grid";
  const esc = KCP.esc;
  const html = document.documentElement;
  const SQ3 = Math.sqrt(3);
  const EPS = 1e-9;
  const SIDS = ["S1", "S2", "S3"];

  /* ===================== 1. 도구 ===================== */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const hexc = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const css = (c, a) => a === undefined || a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
  const centroid = pts => { let x = 0, y = 0, z = 0; for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; } return [x / pts.length, y / pts.length, z / pts.length]; };
  function hash(a, b, k = 0) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((k | 0) + 7, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const axial = (q, r) => [SQ3 * (q + r / 2), 1.5 * r];
  const hexDist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const model = () => KCP.games[ID] && KCP.games[ID].model;
  const labels = () => (model() && model().labels) || null;
  const d2 = x => (model() ? model().display2(x) : x.toFixed(2));
  const reducedMotion = () => (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const ICON = {
    plan: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 7l4 4"/>',
    quest: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    status: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l8-8"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M7 10v4M11 10v4"/>',
    factory: '<path d="M3 21V11l6 3V11l6 3V6h4v15z"/><path d="M3 21h18"/>',
    co2: '<path d="M5 16a4 4 0 0 1 2-7.5 5 5 0 0 1 9.6 1.2A3.4 3.4 0 0 1 17 16z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    reset: '<path d="M12 3l9 9-9 9-9-9z"/>',
    rotl: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 3v4h4"/>',
    rotr: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3v4h-4"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M16 16l5 5"/>',
    zout: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M16 16l5 5"/>',
    tilt: '<path d="M3 18l9-12 9 12z"/><path d="M3 18h18"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3"/><path d="M20 4v14h-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17v.5"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    wave: '<path d="M2 12c3-6 5-6 8 0s5 6 8 0 3-3 4-2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    next: '<path d="M5 5l7 7-7 7M12 5l7 7-7 7"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    fwd: '<path d="M9 5l7 7-7 7"/>',
    thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    flag: '<path d="M5 21V4h12l-3 4 3 4H5"/>'
  };
  const ico = k => `<svg class="v2-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[k] || ""}</svg>`;

  /* ===================== 2. 섬 만들기 ===================== */
  const PAL = {
    grass: hexc("#3a9a84"), grass2: hexc("#44a48b"), forest: hexc("#33917b"), hill: hexc("#4aa68b"),
    soilTop: hexc("#c98b5f"), soilSide: hexc("#a96d48"), sand: hexc("#e3cf9a"), sandSide: hexc("#c8ab76"),
    rock: hexc("#8fa2b4"), rockSide: hexc("#71859a"), rockPeak: hexc("#9fb1c2"),
    paved: hexc("#aab6be"), pavedSide: hexc("#8c99a2"), dock: hexc("#9aa6ae"),
    solarGround: hexc("#25374e"), solarSide: hexc("#1c2b3e"),
    panel: hexc("#2a4f88"), panelBack: hexc("#5a687c"), panelCurt: hexc("#6d7a8a"),
    trunk: hexc("#7a5a3f"), pine: hexc("#2b8b74"), pine2: hexc("#237866"), round: hexc("#3f9f78"),
    wall: hexc("#efe6d4"), wall2: hexc("#e3d7c2"), roofs: [hexc("#3f6fb5"), hexc("#2f8f9a"), hexc("#cf7656"), hexc("#4f7fc4")],
    tower: hexc("#c9d6e3"), towerTop: hexc("#8fa3b6"), glass: hexc("#3d5c7c"),
    white: hexc("#f1f4f6"), red: hexc("#d9534f"), steel: hexc("#7d8b96"), dsteel: hexc("#55626e"),
    containers: [hexc("#e07b39"), hexc("#3f7fbf"), hexc("#c94f4f"), hexc("#3fa07a"), hexc("#e0b83f")],
    wood: hexc("#9a7350"), hull: hexc("#eef2f5"), stripe: hexc("#2f5f9f"),
    field: [hexc("#a2c766"), hexc("#cbbd62")], batt: hexc("#e8eef2"), battTrim: hexc("#2fa7a0"),
    window: hexc("#ffd98a"), windowOff: hexc("#1b2735"), mint: hexc("#7be3b4"), amber: hexc("#f2b45c"),
    shallow: hexc("#a7e3ea"), palm: hexc("#3c9a6c"), rockSmall: hexc("#8e9aa4")
  };
  // 특별 칸: 급전선 F1~F4, 설비(배터리·디젤·태양광·풍력)와 지형
  const SPECIAL = {
    "2,-4": { type: "paved", pick: "F1", obj: "hospital" },
    "3,-4": { type: "grass", pick: "F1", obj: "shelter" },
    "1,-5": { type: "hill", h: 0.92, pick: "WIND", obj: "turbine" },
    "0,-4": { type: "hill", h: 0.78, obj: "trees" },
    "2,-5": { type: "hill", h: 0.7, obj: "rocks" },
    "-1,-3": { type: "hill", h: 0.74, obj: "trees" },
    "-2,-3": { type: "rock", h: 1.0, obj: "peak", peak: 2.5 },
    "-3,-2": { type: "rock", h: 0.92, obj: "peak", peak: 1.9 },
    "-1,-4": { type: "rock", h: 0.9, obj: "peak", peak: 1.6 },
    "-2,-2": { type: "forest", obj: "forest" },
    "-5,1": { type: "grass", pick: "F2", obj: "houses" },
    "-4,1": { type: "grass", pick: "F2", obj: "houses" },
    "-5,2": { type: "grass", pick: "F2", obj: "houses" },
    "-4,2": { type: "grass", pick: "F2", obj: "houses" },
    "-5,3": { type: "grass", pick: "F2", obj: "houses" },
    "-3,0": { type: "paved", pick: "DSL", obj: "gensets", units: [0, 1] },
    "-3,1": { type: "paved", pick: "DSL", obj: "gensets", units: [2], tank: true },
    "4,-1": { type: "paved", pick: "F3", obj: "towers" },
    "5,-1": { type: "paved", pick: "F3", obj: "towers" },
    "4,0": { type: "paved", pick: "F3", obj: "towers" },
    "5,0": { type: "paved", pick: "F3", obj: "towers" },
    "3,1": { type: "paved", pick: "F3", obj: "towers" },
    "-3,5": { type: "paved", pick: "F4", obj: "warehouse" },
    "-2,5": { type: "paved", pick: "F4", obj: "warehouse" },
    "-4,6": { type: "dock", pick: "F4", obj: "containers" },
    "-3,6": { type: "dock", pick: "F4", obj: "crane" },
    "-2,6": { type: "dock", pick: "F4", obj: "containers" },
    "-2,3": { type: "paved", pick: "BAT", obj: "ops" },
    "-1,3": { type: "paved", pick: "BAT", obj: "battery" },
    "0,3": { type: "paved", pick: "BAT", obj: "substation" },
    "-4,3": { type: "field", obj: "crops" },
    "-5,4": { type: "field", obj: "crops" }
  };
  const SEA_SPECIAL = { "-4,7": { obj: "pier", pick: "F4" }, "-3,7": { obj: "pier", pick: "F4" }, "-2,7": { obj: "boat" }, "-5,7": { obj: "boat" } };
  const ISLETS = [[8, -5], [8, -4], [-8, 2], [-9, 3], [3, 6], [-4, -5]];
  const TYPE = {
    grass: { top: PAL.grass, side: PAL.soilSide, h: 0.42 },
    forest: { top: PAL.forest, side: PAL.soilSide, h: 0.44 },
    hill: { top: PAL.hill, side: PAL.soilSide, h: 0.8 },
    rock: { top: PAL.rock, side: PAL.rockSide, h: 1.0 },
    soil: { top: PAL.soilTop, side: PAL.soilSide, h: 0.27 },
    sand: { top: PAL.sand, side: PAL.sandSide, h: 0.2 },
    paved: { top: PAL.paved, side: PAL.pavedSide, h: 0.42 },
    dock: { top: PAL.dock, side: PAL.pavedSide, h: 0.3 },
    field: { top: PAL.field[0], side: PAL.soilSide, h: 0.42 },
    solar: { top: PAL.solarGround, side: PAL.solarSide, h: 0.4 }
  };

  // 면: 점 목록, 바깥쪽 법선, 기본색. interior를 주면 법선을 바깥으로 맞춘다.
  function face(pts, base, interior, opt) {
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const c = centroid(pts);
    if (interior && dot(n, sub(c, interior)) < 0) n = [-n[0], -n[1], -n[2]];
    const f = { pts, n, base, c };
    if (opt) Object.assign(f, opt);
    return f;
  }
  function rotP(cx, cz, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return (lx, y, lz) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
  }
  function box(out, cx, y0, cz, w, d, h, rot, top, side, opt = {}) {
    const P = rotP(cx, cz, rot), x = w / 2, z = d / 2, y1 = y0 + h;
    const b = [P(-x, y0, -z), P(x, y0, -z), P(x, y0, z), P(-x, y0, z)];
    const t = [P(-x, y1, -z), P(x, y1, -z), P(x, y1, z), P(-x, y1, z)];
    const mid = [cx, y0 + h / 2, cz];
    if (!opt.noTop) out.push(face(t, top, mid, opt.topOpt));
    const walls = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, f = face([t[i], t[j], b[j], b[i]], side, mid, opt.sideOpt);
      out.push(f);
      walls.push(f);
    }
    return { t, b, walls, mid };
  }
  function prism(out, cx, y0, cz, rad, h, sides, rot, top, side, taper = 1, opt = {}) {
    const ring = (y, r) => Array.from({ length: sides }, (_, i) => { const a = rot + i * 2 * Math.PI / sides; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; });
    const b = ring(y0, rad), t = ring(y0 + h, rad * taper), mid = [cx, y0 + h / 2, cz];
    if (!opt.noTop) out.push(face(t, top, mid, opt.topOpt));
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; out.push(face([t[i], t[j], b[j], b[i]], side, mid, opt.sideOpt)); }
  }
  function cone(out, cx, y0, cz, rad, h, sides, rot, col, opt) {
    const apex = [cx, y0 + h, cz], mid = [cx, y0 + h * 0.25, cz];
    const ring = Array.from({ length: sides }, (_, i) => { const a = rot + i * 2 * Math.PI / sides; return [cx + Math.cos(a) * rad, y0, cz + Math.sin(a) * rad]; });
    for (let i = 0; i < sides; i++) out.push(face([apex, ring[i], ring[(i + 1) % sides]], col, mid, opt));
  }
  // 벽면 위 창: 벽 사각형 [윗왼, 윗오, 아래오, 아래왼] 안쪽에 가로 띠 창을 붙인다.
  function windowsOn(out, wall, rows, feeder, seed, opt = {}) {
    const [tl, tr, br, bl] = wall.pts, n = wall.n, o = 0.012;
    const at = (u, v) => { const top = [lerp(tl[0], tr[0], u), lerp(tl[1], tr[1], u), lerp(tl[2], tr[2], u)], bot = [lerp(bl[0], br[0], u), lerp(bl[1], br[1], u), lerp(bl[2], br[2], u)]; return [lerp(top[0], bot[0], v) + n[0] * o, lerp(top[1], bot[1], v) + n[1] * o, lerp(top[2], bot[2], v) + n[2] * o]; };
    const u0 = opt.u0 ?? 0.14, u1 = opt.u1 ?? 0.86, cols = opt.cols || 1;
    for (let r = 0; r < rows; r++) {
      const v0 = (r + 0.28) / rows * (opt.vspan ?? 0.9) + (opt.vtop ?? 0.04), v1 = v0 + (opt.vh ?? 0.42) / rows;
      for (let c = 0; c < cols; c++) {
        const a = lerp(u0, u1, c / cols) + (cols > 1 ? 0.03 : 0), bb = lerp(u0, u1, (c + 1) / cols) - (cols > 1 ? 0.03 : 0);
        const pts = [at(a, v0), at(bb, v0), at(bb, v1), at(a, v1)];
        out.push({ pts, n, base: PAL.glass, c: centroid(pts), win: true, feeder, th: hash(seed, r * 7 + c, 3) });
      }
    }
  }
  function house(out, cx, y0, cz, w, d, wh, rh, rot, roof, feeder, seed) {
    const P = rotP(cx, cz, rot), x = w / 2, z = d / 2, y1 = y0 + wh, o = 0.07;
    const mid = [cx, y0 + wh / 2, cz];
    const B = box(out, cx, y0, cz, w, d, wh, rot, PAL.wall, PAL.wall, { noTop: true });
    const ridge = [P(-x - o, y1 + rh, 0), P(x + o, y1 + rh, 0)], rmid = [cx, y1 + rh * 0.3, cz];
    out.push(face([P(-x - o, y1 - 0.02, z + o), P(x + o, y1 - 0.02, z + o), ridge[1], ridge[0]], roof, rmid));
    out.push(face([P(-x - o, y1 - 0.02, -z - o), P(x + o, y1 - 0.02, -z - o), ridge[1], ridge[0]], roof, rmid));
    out.push(face([P(-x, y1, -z), P(-x, y1, z), P(-x, y1 + rh, 0)], PAL.wall2, mid));
    out.push(face([P(x, y1, -z), P(x, y1, z), P(x, y1 + rh, 0)], PAL.wall2, mid));
    B.walls.forEach((wall, i) => { if (i % 2 === 0) windowsOn(out, wall, 1, feeder, seed + i, { vh: 0.5, vtop: 0.16, vspan: 0.6, u0: 0.32, u1: 0.68 }); });
  }
  function pine(out, x, y0, z, s, rot) {
    box(out, x, y0, z, 0.08 * s, 0.08 * s, 0.16 * s, rot, PAL.trunk, PAL.trunk);
    cone(out, x, y0 + 0.12 * s, z, 0.3 * s, 0.42 * s, 6, rot, PAL.pine);
    cone(out, x, y0 + 0.36 * s, z, 0.22 * s, 0.36 * s, 6, rot + 0.3, PAL.pine2);
  }
  function roundTree(out, x, y0, z, s, rot) {
    box(out, x, y0, z, 0.07 * s, 0.07 * s, 0.18 * s, rot, PAL.trunk, PAL.trunk);
    const c = [x, y0 + 0.38 * s, z], r = 0.24 * s, top = [x, y0 + 0.62 * s, z], bot = [x, y0 + 0.16 * s, z];
    const ring = Array.from({ length: 5 }, (_, i) => { const a = rot + i * 2 * Math.PI / 5; return [x + Math.cos(a) * r, c[1], z + Math.sin(a) * r]; });
    for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; out.push(face([top, ring[i], ring[j]], PAL.round, c)); out.push(face([bot, ring[j], ring[i]], PAL.round, c)); }
  }
  function rock(out, x, y0, z, s, seed) {
    const ring = Array.from({ length: 5 }, (_, i) => { const a = i * 2 * Math.PI / 5 + seed; const r = s * (0.8 + 0.3 * hash(i, seed * 100, 5)); return [x + Math.cos(a) * r, y0, z + Math.sin(a) * r]; });
    const apex = [x + s * 0.1, y0 + s * 0.8, z - s * 0.05], mid = [x, y0 + s * 0.2, z];
    for (let i = 0; i < 5; i++) out.push(face([apex, ring[i], ring[(i + 1) % 5]], PAL.rockSmall, mid));
  }

  function buildWorld() {
    const groups = [];
    const land = new Map();
    const key = (q, r) => q + "," + r;
    for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
      const d = hexDist(q, r);
      if (d > 6) continue;
      const k = key(q, r), sp = SPECIAL[k];
      let type, h, obj = null, pick = null, extra = {};
      if (sp) { type = sp.type; obj = sp.obj; pick = sp.pick || null; extra = sp; }
      else if (d <= 2) { type = "solar"; obj = "panels"; pick = "PV"; }
      else if (d === 6) type = hash(q, r, 1) < 0.28 ? "sand" : "soil";
      else {
        const v = hash(q, r, 2);
        type = v < 0.3 ? "forest" : "grass";
        obj = v < 0.3 ? "forest" : v < 0.45 ? "tree" : v < 0.5 ? "rocks" : null;
      }
      h = sp && sp.h ? sp.h : TYPE[type].h + (["grass", "forest"].includes(type) ? (hash(q, r, 4) - 0.5) * 0.08 : 0);
      land.set(k, { q, r, d, type, h, obj, pick, extra });
    }
    ISLETS.forEach(([q, r], i) => land.set(key(q, r), { q, r, d: hexDist(q, r), type: "sand", h: 0.16 + 0.04 * (i % 2), obj: i % 3 === 2 ? "rocks" : "palm", pick: null, extra: {} }));
    // 섬 둘레 얕은 물
    const shallow = new Map();
    land.forEach(t => DIRS.forEach(([dq, dr]) => { const k = key(t.q + dq, t.r + dr); if (!land.has(k)) shallow.set(k, { q: t.q + dq, r: t.r + dr }); }));
    Object.keys(SEA_SPECIAL).forEach(k => { if (!land.has(k)) { const [q, r] = k.split(",").map(Number); shallow.set(k, { q, r }); } });
    shallow.forEach((s, k) => {
      const [x, z] = axial(s.q, s.r), sp = SEA_SPECIAL[k];
      const corners = Array.from({ length: 6 }, (_, i) => { const a = (60 * i - 30) * Math.PI / 180; return [x + Math.cos(a), 0.004, z + Math.sin(a)]; });
      const g = { key: k, q: s.q, r: s.r, x, z, top: 0, water: true, pick: sp && sp.pick || null, tile: [{ pts: corners, n: [0, 1, 0], base: PAL.shallow, c: [x, 0, z], alpha: 0.42, flat: true }], objs: [], dyn: [], shadows: [] };
      if (sp && sp.obj === "pier") {
        for (let i = 0; i < 4; i++) box(g.objs, x - 0.55 + i * 0.36, -0.1, z - 0.2, 0.06, 0.06, 0.34, 0, PAL.wood, PAL.wood);
        box(g.objs, x, 0.24, z - 0.2, 1.5, 0.34, 0.05, 0, PAL.wood, PAL.wood);
      }
      if (sp && sp.obj === "boat") g.dyn.push({ kind: "boat", x: x + 0.1, z: z + 0.2, rot: k === "-5,7" ? 0.5 : -0.3, seed: s.q });
      groups.push(g);
    });
    land.forEach((t, k) => {
      const [x, z] = axial(t.q, t.r), T = TYPE[t.type];
      let top = T.top, side = T.side;
      const v = (hash(t.q, t.r, 9) - 0.5) * 0.08;
      top = top.map(c => clamp(c * (1 + v), 0, 255));
      if (t.type === "field") top = PAL.field[(t.q + t.r) & 1];
      const corners = y => Array.from({ length: 6 }, (_, i) => { const a = (60 * i - 30) * Math.PI / 180; return [x + Math.cos(a), y, z + Math.sin(a)]; });
      const tp = corners(t.h), bt = corners(0);
      const g = { key: k, q: t.q, r: t.r, x, z, top: t.h, type: t.type, pick: t.pick, tile: [], objs: [], dyn: [], shadows: [] };
      const mid = [x, t.h / 2, z];
      for (let i = 0; i < 6; i++) {
        const nb = land.get(key(t.q + DIRS[i][0], t.r + DIRS[i][1]));
        if (nb && nb.h >= t.h - 0.005) continue;
        const j = (i + 1) % 6;
        g.tile.push(face([tp[i], tp[j], bt[j], bt[i]], side, mid, { side: true }));
      }
      g.tile.push({ pts: tp, n: [0, 1, 0], base: top, c: [x, t.h, z], topFace: true });
      buildObjects(g, t, x, z);
      groups.push(g);
    });
    return groups;
  }
  function buildObjects(g, t, x, z) {
    const y = t.h, O = g.objs, rnd = i => hash(t.q, t.r, 20 + i);
    const shadow = (dx, dz, rx, rz) => g.shadows.push({ x: x + dx, z: z + dz, rx, rz: rz || rx });
    switch (t.obj) {
      case "forest":
        for (let i = 0; i < 4; i++) {
          const a = rnd(i) * 6.28, r = 0.25 + rnd(i + 5) * 0.45, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, s = 0.9 + rnd(i + 9) * 0.5;
          shadow(px - x, pz - z, 0.22 * s);
          (i % 3 === 2 ? roundTree : pine)(O, px, y, pz, s, rnd(i + 3));
        }
        break;
      case "trees":
        for (let i = 0; i < 3; i++) { const px = x - 0.4 + i * 0.4, pz = z + (rnd(i) - 0.5) * 0.6; shadow(px - x, pz - z, 0.2); pine(O, px, y, pz, 0.9 + rnd(i + 2) * 0.3, rnd(i + 4)); }
        break;
      case "tree": {
        const px = x + (rnd(1) - 0.5) * 0.6, pz = z + (rnd(2) - 0.5) * 0.6;
        shadow(px - x, pz - z, 0.22);
        (rnd(3) < 0.5 ? roundTree : pine)(O, px, y, pz, 1.05, rnd(4));
        break;
      }
      case "rocks":
        for (let i = 0; i < 3; i++) rock(O, x + (rnd(i) - 0.5) * 0.9, y, z + (rnd(i + 3) - 0.5) * 0.9, 0.14 + rnd(i + 6) * 0.1, rnd(i + 8) * 6);
        break;
      case "palm": {
        box(O, x, y, z, 0.07, 0.07, 0.55, 0.3, PAL.trunk, PAL.trunk);
        const c = [x, y + 0.55, z];
        for (let i = 0; i < 5; i++) { const a = i * 1.256 + 0.4, tip = [x + Math.cos(a) * 0.45, y + 0.4, z + Math.sin(a) * 0.45], s1 = [x + Math.cos(a + 0.5) * 0.12, y + 0.58, z + Math.sin(a + 0.5) * 0.12]; O.push(face([c, s1, tip], PAL.palm, [x, y + 0.3, z], { two: true })); }
        shadow(0, 0, 0.3);
        break;
      }
      case "peak": {
        const ph = t.extra.peak || 1.6, apex = [x + 0.08, y + ph, z - 0.1], mid = [x, y + 0.3, z];
        const ring = Array.from({ length: 6 }, (_, i) => { const a = (60 * i - 30) * Math.PI / 180, r = 0.86 + hash(t.q, t.r, 30 + i) * 0.1; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; });
        const shoulder = ring.map((p, i) => [lerp(p[0], apex[0], 0.45) + (hash(t.q, i, 40) - 0.5) * 0.12, y + ph * 0.42, lerp(p[2], apex[2], 0.45) + (hash(i, t.r, 41) - 0.5) * 0.12]);
        for (let i = 0; i < 6; i++) {
          const j = (i + 1) % 6;
          O.push(face([ring[i], ring[j], shoulder[j], shoulder[i]], PAL.rock, mid));
          O.push(face([shoulder[i], shoulder[j], apex], PAL.rockPeak, mid));
        }
        break;
      }
      case "hospital": {
        shadow(0, 0.05, 0.62, 0.48);
        const B = box(O, x, y, z, 1.05, 0.72, 0.52, 0.12, PAL.white, PAL.white);
        B.walls.forEach((w, i) => windowsOn(O, w, 2, 0, 50 + i, { cols: 3 }));
        box(O, x + 0.32, y + 0.52, z - 0.05, 0.36, 0.42, 0.18, 0.12, PAL.white, hexc("#dfe5ea"));
        const P = rotP(x - 0.18, z + 0.02, 0.12), yy = y + 0.525;
        O.push({ pts: [P(-0.18, yy, -0.05), P(0.18, yy, -0.05), P(0.18, yy, 0.05), P(-0.18, yy, 0.05)], n: [0, 1, 0], base: PAL.red, c: [x - 0.18, yy, z] });
        O.push({ pts: [P(-0.05, yy + 0.001, -0.18), P(0.05, yy + 0.001, -0.18), P(0.05, yy + 0.001, 0.18), P(-0.05, yy + 0.001, 0.18)], n: [0, 1, 0], base: PAL.red, c: [x - 0.18, yy + 0.001, z] });
        break;
      }
      case "shelter":
        shadow(0, 0, 0.42);
        house(O, x - 0.1, y, z + 0.05, 0.7, 0.5, 0.32, 0.2, -0.2, PAL.roofs[1], 0, 61);
        pine(O, x + 0.48, y, z - 0.35, 0.8, 1);
        break;
      case "houses":
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + rnd(i) * 0.6, r = 0.42, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          shadow(px - x, pz - z, 0.26);
          house(O, px, y, pz, 0.42, 0.32, 0.22, 0.16, (rnd(i + 3) < 0.5 ? 0 : Math.PI / 3) + 0.1, PAL.roofs[Math.floor(rnd(i + 6) * PAL.roofs.length)], 1, t.q * 31 + t.r * 7 + i);
        }
        break;
      case "towers":
        for (let i = 0; i < 2; i++) {
          const px = x + (i ? 0.3 : -0.28), pz = z + (i ? 0.22 : -0.2), h = 1.1 + rnd(i) * 1.3, w = 0.42 + rnd(i + 2) * 0.12;
          shadow(px - x + 0.1, pz - z + 0.05, w * 0.7);
          const B = box(O, px, y, pz, w, w, h, 0.05, PAL.towerTop, PAL.tower);
          const floors = Math.max(3, Math.round(h * 4));
          B.walls.forEach((wall, k) => windowsOn(O, wall, floors, 2, t.q * 13 + t.r * 5 + i * 4 + k, { vh: 0.45 }));
          box(O, px, y + h, pz, w * 0.4, w * 0.4, 0.08, 0.05, PAL.steel, PAL.steel);
        }
        break;
      case "warehouse": {
        shadow(0, 0, 0.7, 0.45);
        const B = box(O, x, y, z, 1.3, 0.7, 0.42, 0.04, hexc("#d9e7ef"), hexc("#c3d3dd"));
        B.walls.forEach((w, i) => { if (i % 2 === 0) windowsOn(O, w, 1, 3, 70 + i + t.q, { cols: 4, vh: 0.35, vtop: 0.3, vspan: 0.5 }); });
        box(O, x - 0.4, y + 0.42, z, 0.24, 0.24, 0.12, 0.04, PAL.steel, PAL.dsteel);
        break;
      }
      case "containers":
        for (let i = 0; i < 4; i++) {
          const px = x - 0.45 + (i % 2) * 0.5 + rnd(i) * 0.1, pz = z - 0.3 + Math.floor(i / 2) * 0.42;
          box(O, px, y, pz, 0.42, 0.2, 0.18, 0, PAL.containers[i % 5], PAL.containers[i % 5].map(c => c * 0.82));
          if (i === 1) box(O, px, y + 0.18, pz, 0.42, 0.2, 0.18, 0, PAL.containers[4], PAL.containers[4].map(c => c * 0.82));
        }
        break;
      case "crane":
        box(O, x - 0.2, y, z, 0.1, 0.1, 1.15, 0, hexc("#e8b13f"), hexc("#c9952f"));
        box(O, x + 0.15, y + 1.1, z, 0.95, 0.08, 0.08, 0, hexc("#e8b13f"), hexc("#c9952f"));
        box(O, x + 0.5, y + 0.55, z, 0.02, 0.02, 0.55, 0, PAL.dsteel, PAL.dsteel);
        box(O, x + 0.5, y + 0.45, z, 0.3, 0.16, 0.12, 0, PAL.containers[1], PAL.containers[1].map(c => c * 0.8));
        break;
      case "gensets":
        (t.extra.units || []).forEach((u, i) => {
          const px = x - 0.25 + i * 0.5, pz = z - 0.1;
          shadow(px - x, pz - z, 0.3, 0.2);
          box(O, px, y, pz, 0.42, 0.3, 0.26, 0.1, hexc("#7c8f84"), hexc("#61746a"));
          prism(O, px + 0.12, y + 0.26, pz + 0.04, 0.05, 0.42, 6, 0, PAL.dsteel, PAL.steel);
          g.dyn.push({ kind: "smoke", unit: u, x: px + 0.12, y: y + 0.7, z: pz + 0.04 });
        });
        if (t.extra.tank) { prism(O, x + 0.32, y, z + 0.32, 0.2, 0.32, 8, 0, hexc("#d7dde2"), hexc("#b9c2c9")); shadow(0.32, 0.32, 0.22); }
        break;
      case "ops":
        shadow(0, 0, 0.5, 0.38);
        { const B = box(O, x, y, z, 0.8, 0.56, 0.34, -0.1, hexc("#e3e9ee"), hexc("#d0d9e0")); B.walls.forEach((w, i) => windowsOn(O, w, 1, 0, 90 + i, { cols: 3, vh: 0.5, vtop: 0.2, vspan: 0.6 })); }
        box(O, x + 0.25, y + 0.34, z - 0.1, 0.03, 0.03, 0.5, 0, PAL.steel, PAL.steel);
        cone(O, x - 0.2, y + 0.34, z + 0.05, 0.14, 0.1, 6, 0, PAL.white);
        break;
      case "battery":
        for (let i = 0; i < 3; i++) {
          const px = x - 0.4 + i * 0.4, pz = z - 0.12;
          shadow(px - x, pz - z, 0.22, 0.16);
          box(O, px, y, pz, 0.32, 0.62, 0.3, 0, PAL.batt, PAL.batt);
          box(O, px, y + 0.3, pz, 0.34, 0.64, 0.025, 0, PAL.battTrim, PAL.battTrim);
        }
        g.dyn.push({ kind: "level", x: x + 0.66, z: z + 0.25, y });
        break;
      case "substation":
        box(O, x - 0.2, y, z, 0.3, 0.3, 0.26, 0, PAL.steel, PAL.dsteel);
        box(O, x + 0.25, y, z + 0.1, 0.24, 0.24, 0.22, 0, PAL.steel, PAL.dsteel);
        for (let i = 0; i < 3; i++) box(O, x - 0.45 + i * 0.45, y, z - 0.42, 0.04, 0.04, 0.62, 0, PAL.dsteel, PAL.dsteel);
        box(O, x, y + 0.6, z - 0.42, 0.98, 0.04, 0.04, 0, PAL.dsteel, PAL.dsteel);
        break;
      case "crops":
        for (let i = 0; i < 5; i++) {
          const zz = z - 0.7 + i * 0.35, half = Math.sqrt(Math.max(0, 1 - Math.pow((zz - z) / 0.95, 2))) * 0.72;
          O.push({ pts: [[x - half, y + 0.012, zz - 0.07], [x + half, y + 0.012, zz - 0.07], [x + half, y + 0.012, zz + 0.07], [x - half, y + 0.012, zz + 0.07]], n: [0, 1, 0], base: PAL.field[(i + 1) & 1].map(c => c * 0.86), c: [x, y, zz] });
        }
        break;
      case "panels":
        for (let i = 0; i < 3; i++) {
          const pz = z - 0.5 + i * 0.5, px = x, w = 0.72 + (i === 1 ? 0.3 : 0), tilt = 0.18, yy = y + 0.07;
          const pts = [[px - w, yy + tilt, pz - 0.14], [px + w, yy + tilt, pz - 0.14], [px + w, yy, pz + 0.12], [px - w, yy, pz + 0.12]];
          box(O, px - w * 0.8, y, pz, 0.03, 0.03, 0.1, 0, PAL.dsteel, PAL.dsteel);
          box(O, px + w * 0.8, y, pz, 0.03, 0.03, 0.1, 0, PAL.dsteel, PAL.dsteel);
          O.push({ pts: pts.map(p => [p[0], p[1] + 0.02, p[2]]), n: norm(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0]))).map(v => -v), base: PAL.panel, c: [px, yy + 0.1, pz], panel: true, th: hash(t.q, t.r, 60 + i), two: true, back: PAL.panelBack });
        }
        break;
      case "turbine": {
        prism(O, x, y, z, 0.1, 2.1, 6, 0, PAL.white, PAL.white, 0.5);
        box(O, x, y + 2.1, z, 0.34, 0.14, 0.14, -0.52 + Math.PI / 2, PAL.white, hexc("#dfe5ea"));
        g.dyn.push({ kind: "rotor", x, y: y + 2.17, z });
        shadow(0.4, 0.2, 0.3, 0.12);
        break;
      }
    }
  }
  let WORLD = null;
  const world = () => WORLD || (WORLD = buildWorld());

  /* ===================== 3. 그리기 ===================== */
  // 구간별 빛: 하늘 위, 수평선, 먼 바다, 가까운 바다, 주변광, 햇빛 색, 밤 정도
  const SKY = [
    ["#081629", "#1b3456", "#163150", "#0b2038", [0.28, 0.34, 0.5], [0.3, 0.36, 0.56], 1],
    ["#22365f", "#d39a80", "#4b6b8c", "#20446a", [0.46, 0.43, 0.54], [0.95, 0.7, 0.58], 0.55],
    ["#5fa9de", "#cde5f0", "#84c1db", "#4b9ac2", [0.6, 0.64, 0.7], [1, 0.93, 0.82], 0],
    ["#52a5e2", "#d4edf6", "#8dc9e1", "#55a4cb", [0.64, 0.68, 0.72], [1, 0.98, 0.92], 0],
    ["#50a3e3", "#d9eff7", "#90cbe2", "#5aa8cf", [0.66, 0.69, 0.72], [1, 0.97, 0.9], 0],
    ["#5ea6db", "#eadcbd", "#8cc0d6", "#529dc4", [0.6, 0.6, 0.64], [1, 0.86, 0.7], 0],
    ["#2d3d70", "#ec9868", "#536c8d", "#264569", [0.44, 0.39, 0.47], [1, 0.6, 0.42], 0.45],
    ["#081629", "#1d3658", "#163150", "#0b2038", [0.28, 0.34, 0.5], [0.3, 0.36, 0.56], 1]
  ].map(([a, b, c, d, amb, sun, night]) => ({ top: hexc(a), hor: hexc(b), far: hexc(c), near: hexc(d), amb, sun, night }));
  function lightFor(b, daylock) {
    const bb = daylock ? 4 : b, k = SKY[bb], h = bb * 3 + 1.5;
    let L;
    if (k.night >= 1) L = norm([-0.35, 0.75, -0.45]);
    else {
      const th = (h - 6) / 12 * Math.PI, el = Math.max(0.12, Math.sin(th)) * 1.15;
      L = norm([Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * 0.55 * Math.cos(el) + 0.25]);
    }
    return { ...k, L, b: bb };
  }

  function makeView(canvas) {
    const V = {
      canvas, g: null, W: 0, H: 0, dpr: 1,
      cam: { yaw: 0.52, pitch: 0.78, zoom: 1, tx: 0, tz: 1.2 },
      vis: null, pick: null, sel: null, hover: null, banners: null, frame: null
    };
    let Cx, Cy, Cz, fx, fy, fz, rx, rz, ux, uy, uz, Fz, ox, oy;
    const SX = new Float64Array(16), SY = new Float64Array(16);
    function setup() {
      const vis = V.vis || { x: 0, y: 0, w: V.W, h: V.H };
      const dist = 34, { yaw, pitch } = V.cam, cp = Math.cos(pitch), sp = Math.sin(pitch);
      const T = [V.cam.tx, 0.5, V.cam.tz];
      Cx = T[0] + dist * Math.sin(yaw) * cp; Cy = T[1] + dist * sp; Cz = T[2] + dist * Math.cos(yaw) * cp;
      const f = norm([T[0] - Cx, T[1] - Cy, T[2] - Cz]);
      fx = f[0]; fy = f[1]; fz = f[2];
      const r = norm([-fz, 0, fx]);
      rx = r[0]; rz = r[2];
      const u = cross(r, f);
      ux = u[0]; uy = u[1]; uz = u[2];
      const ext = 13.2;
      const Fw = vis.w * 0.92 / (2 * ext) * dist, Fh = vis.h * 0.92 / (2 * ext * (sp * 0.88 + 0.08) + 3.4 * cp) * dist;
      Fz = Math.max(40, Math.min(Fw, Fh)) * V.cam.zoom;
      ox = vis.x + vis.w / 2;
      oy = vis.y + vis.h / 2 + vis.h * 0.03;
    }
    V.setup = setup;
    V.basis = () => ({ rx, rz, fx, fz, F: Fz });
    function project(p) {
      const vx = p[0] - Cx, vy = p[1] - Cy, vz = p[2] - Cz, zc = vx * fx + vy * fy + vz * fz;
      if (zc < 0.5) return null;
      const s = Fz / zc;
      return [ox + (vx * rx + vz * rz) * s, oy - (vx * ux + vy * uy + vz * uz) * s, zc];
    }
    V.project = project;
    const depth = p => (p[0] - Cx) * fx + (p[1] - Cy) * fy + (p[2] - Cz) * fz;
    function proj(pts) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], vx = p[0] - Cx, vy = p[1] - Cy, vz = p[2] - Cz, zc = vx * fx + vy * fy + vz * fz;
        if (zc < 0.5) return 0;
        const s = Fz / zc;
        SX[i] = ox + (vx * rx + vz * rz) * s;
        SY[i] = oy - (vx * ux + vy * uy + vz * uz) * s;
      }
      return pts.length;
    }
    function path(g, n) { g.beginPath(); g.moveTo(SX[0], SY[0]); for (let i = 1; i < n; i++) g.lineTo(SX[i], SY[i]); g.closePath(); }
    const facing = f => (Cx - f.c[0]) * f.n[0] + (Cy - f.c[1]) * f.n[1] + (Cz - f.c[2]) * f.n[2] > 0;
    function shade(base, n, Lt, fogT, flip) {
      const k = Math.max(0, (flip ? -1 : 1) * (n[0] * Lt.L[0] + n[1] * Lt.L[1] + n[2] * Lt.L[2]));
      const a = Lt.amb, s = Lt.sun, m = 0.6 * k;
      let r = base[0] * (a[0] + s[0] * m), gg = base[1] * (a[1] + s[1] * m), b = base[2] * (a[2] + s[2] * m);
      if (fogT > 0) { r = lerp(r, Lt.hor[0], fogT); gg = lerp(gg, Lt.hor[1], fogT); b = lerp(b, Lt.hor[2], fogT); }
      return `rgb(${clamp(r, 0, 255) | 0},${clamp(gg, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;
    }

    function render(fr, opts = {}) {
      const g = V.g, W = V.W, H = V.H, Lt = fr.light;
      setup();
      const rec = opts.record ? [] : null;
      const near = 30, fogSpan = 26;
      const fogOf = d => clamp((d - near) / fogSpan, 0, 1) * 0.28;
      // 하늘과 바다
      const hz = project([Cx + fx * 4000, 0, Cz + fz * 4000]);
      const horizon = hz ? clamp(hz[1], -10, H + 10) : -10;
      const sky = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
      sky.addColorStop(0, css(Lt.top)); sky.addColorStop(1, css(Lt.hor));
      g.fillStyle = sky; g.fillRect(0, 0, W, Math.max(0, horizon));
      if (Lt.night > 0.3 && horizon > 4) {
        g.fillStyle = "rgba(255,255,255,0.75)";
        for (let i = 0; i < 70; i++) { const sx = hash(i, 3, 1) * W, sy = hash(i, 5, 2) * horizon * 0.9; g.fillRect(sx, sy, hash(i, 7, 3) < 0.15 ? 2 : 1, 1); }
      }
      const sea = g.createLinearGradient(0, Math.max(0, horizon), 0, H);
      sea.addColorStop(0, css(mixc(Lt.far, Lt.hor, 0.35)));
      sea.addColorStop(0.35, css(Lt.far));
      sea.addColorStop(1, css(Lt.near));
      g.fillStyle = sea; g.fillRect(0, Math.max(0, horizon), W, H - Math.max(0, horizon));
      // 물결
      const tt = fr.t || 0;
      g.lineCap = "round";
      for (let i = 0; i < 90; i++) {
        const wx = (hash(i, 1, 11) - 0.5) * 70, wz = (hash(i, 2, 12) - 0.5) * 70 + Math.sin(tt * 0.5 + i) * 0.15;
        if (hexDist(Math.round((wx / SQ3) - (wz / 1.5) / 2), Math.round(wz / 1.5)) < 8.5) continue;
        const p0 = project([wx, 0, wz]), p1 = project([wx + 0.7, 0, wz]);
        if (!p0 || !p1) continue;
        g.strokeStyle = `rgba(255,255,255,${(Lt.night ? 0.08 : 0.22) * (0.5 + hash(i, 4, 13) * 0.5)})`;
        g.lineWidth = Math.max(0.6, Fz / p0[2] * 0.05);
        g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      }
      // 칸 묶음을 먼 곳부터
      const groups = world().map(gr => ({ gr, d: depth([gr.x, gr.top, gr.z]) })).sort((a, b) => b.d - a.d);
      const items = [], smokes = [];
      for (const { gr } of groups) {
        const fogT = fogOf(depth([gr.x, gr.top, gr.z]));
        // 칸 몸통과 윗면
        for (const f of gr.tile) {
          if (!f.flat && !facing(f)) continue;
          const n = proj(f.pts);
          if (!n) continue;
          path(g, n);
          if (f.flat) {
            g.fillStyle = css(mixc(f.base, Lt.hor, Lt.night * 0.6), f.alpha * (1 - Lt.night * 0.5));
            g.fill();
            continue;
          }
          const col = shade(f.base, f.n, Lt, fogT);
          g.fillStyle = col; g.fill();
          if (f.topFace) {
            g.strokeStyle = shade(f.base.map(c => c * 0.8), f.n, Lt, fogT); g.lineWidth = 1; g.stroke();
            // 시험 결과에서 이 급전선이 차단되면 칸을 붉게 물들인다(차단 비율만큼).
            const fi = gr.pick && gr.pick[0] === "F" ? Number(gr.pick[1]) - 1 : -1;
            if (fi >= 0 && fr.dark && fr.dark[fi] > 0.001) { g.fillStyle = `rgba(232,72,104,${(0.16 + 0.42 * fr.dark[fi]).toFixed(3)})`; g.fill(); }
          }
          else { g.strokeStyle = col; g.lineWidth = 0.8; g.stroke(); }
          if (rec) rec.push({ id: gr.pick || null, xs: Array.from(SX.slice(0, n)), ys: Array.from(SY.slice(0, n)) });
        }
        // 선택·가리킴 표시
        const mark = gr.pick && (gr.pick === V.sel ? "sel" : gr.pick === V.hover ? "hover" : null);
        if (mark) {
          const topF = gr.tile.find(f => f.topFace || f.flat);
          const n = topF && proj(topF.pts.map(p => [p[0], p[1] + 0.02, p[2]]));
          if (n) {
            path(g, n);
            g.fillStyle = mark === "sel" ? "rgba(113,220,235,0.22)" : "rgba(255,255,255,0.12)"; g.fill();
            g.strokeStyle = mark === "sel" ? "#71dceb" : "rgba(255,255,255,0.75)"; g.lineWidth = mark === "sel" ? 2.6 : 1.6; g.stroke();
          }
        }
        // 그림자
        if (gr.shadows.length && Lt.night < 0.9) {
          g.fillStyle = `rgba(10,20,30,${0.2 * (1 - Lt.night)})`;
          for (const s of gr.shadows) {
            const sx = s.x + Lt.L[0] * -0.12, sz = s.z + Lt.L[2] * -0.12;
            const pts = Array.from({ length: 10 }, (_, i) => { const a = i / 10 * Math.PI * 2; return [sx + Math.cos(a) * s.rx, gr.top + 0.01, sz + Math.sin(a) * s.rz]; });
            const n = proj(pts);
            if (n) { path(g, n); g.fill(); }
          }
        }
        // 물체 면을 먼 곳부터
        items.length = 0;
        for (const f of gr.objs) items.push(f);
        for (const d of gr.dyn) dynFaces(d, fr, items);
        const order = items.map(f => ({ f, d: depth(f.c) })).sort((a, b) => b.d - a.d);
        for (const { f } of order) {
          const front = facing(f);
          if (!front && !f.two) continue;
          const n = proj(f.pts);
          if (!n) continue;
          path(g, n);
          let col;
          if (f.win) {
            const dark = fr.dark ? fr.dark[f.feeder] : 0, lit = Lt.night > 0.2 && f.th >= dark;
            col = lit ? css(mixc(PAL.glass, PAL.window, Math.min(1, Lt.night * 1.2))) : f.th < dark && Lt.night > 0.2 ? css(PAL.windowOff) : shade(PAL.glass, f.n, Lt, fogT);
          } else if (f.panel) {
            const base = !front ? f.back : f.th < (fr.curtFrac || 0) ? PAL.panelCurt : f.base;
            col = shade(base, f.n, Lt, fogT, !front);
            if (front && Lt.night < 0.5) { g.fillStyle = col; g.fill(); g.fillStyle = `rgba(190,225,255,${0.22 * (1 - Lt.night)})`; g.fill(); col = null; }
          } else if (f.em) col = css(f.em);
          else col = shade(f.base, f.n, Lt, fogT, !front && f.two);
          if (col) { g.fillStyle = col; g.fill(); if (!f.win) { g.strokeStyle = col; g.lineWidth = 0.6; g.stroke(); } }
          if (rec) rec.push({ id: gr.pick || null, xs: Array.from(SX.slice(0, n)), ys: Array.from(SY.slice(0, n)) });
        }
        for (const d of gr.dyn) if (d.kind === "smoke") smokes.push(d);
      }
      // 연기는 건물 위로 피어오르므로 섬을 다 그린 뒤 그린다.
      for (const d of smokes) smoke(g, d, fr);
      // 구름
      clouds(g, fr, Lt);
      // 수평선 안개와 폭염 기운
      if (horizon > 0) {
        const hzg = g.createLinearGradient(0, horizon - 40, 0, horizon + 120);
        hzg.addColorStop(0, css(Lt.hor, 0)); hzg.addColorStop(0.4, css(Lt.hor, 0.45)); hzg.addColorStop(1, css(Lt.hor, 0));
        g.fillStyle = hzg; g.fillRect(0, horizon - 40, W, 160);
      }
      if (fr.heat) { g.fillStyle = "rgba(255,140,60,0.10)"; g.fillRect(0, 0, W, H); }
      if (Lt.night > 0.3) { g.fillStyle = `rgba(8,16,40,${0.12 * Lt.night})`; g.fillRect(0, 0, W, H); }
      V.pick = rec;
      return { horizon };
    }
    function dynFaces(d, fr, out) {
      if (d.kind === "rotor") {
        // 회전면은 남동쪽(기본 시점)을 향한다.
        const a0 = (fr.t || 0) * (0.9 + (fr.wind || 0.4) * 3.2) + 0.4, L = 1.05, yawR = 0.52;
        const fx = Math.sin(yawR), fz = Math.cos(yawR), rx = fz, rz = -fx, n = [fx, 0, fz];
        const hx = d.x + fx * 0.22, hz = d.z + fz * 0.22, hub = [hx, d.y, hz];
        const at = (u, v) => [hx + rx * u, d.y + v, hz + rz * u];
        for (let i = 0; i < 3; i++) {
          const a = a0 + i * 2 * Math.PI / 3, cu = Math.cos(a), sv = Math.sin(a), pu = -Math.sin(a) * 0.07, pv = Math.cos(a) * 0.07;
          out.push({ pts: [at(pu, pv), at(cu * L, sv * L), at(-pu, -pv)], n, base: PAL.white, c: [hx + rx * cu * 0.4 + fx * 0.01, d.y + sv * 0.4, hz + rz * cu * 0.4 + fz * 0.01], two: true });
        }
        out.push({ pts: [at(0, 0.08), at(0.08, 0), at(0, -0.08), at(-0.08, 0)], n, base: hexc("#dfe5ea"), c: [hx + fx * 0.02, d.y, hz + fz * 0.02], two: true });
      } else if (d.kind === "level") {
        const lv = clamp((fr.soc ?? 8) / 16, 0, 1), H = 0.62, y0 = d.y, mid = [d.x, y0 + H / 2, d.z];
        box(out, d.x, y0, d.z, 0.14, 0.14, H, 0, hexc("#24364c"), hexc("#1d2c3e"));
        if (lv > 0.01) {
          const em = fr.batDir > 0 ? PAL.mint : fr.batDir < 0 ? PAL.amber : hexc("#9fe7cf");
          const tmp = [];
          box(tmp, d.x, y0 + 0.01, d.z, 0.15, 0.15, H * lv, 0, em, em);
          tmp.forEach(f => { f.em = f.n[1] > 0.5 ? em : em.map(c => c * 0.82); out.push(f); });
        }
        void mid;
      } else if (d.kind === "boat") {
        const bob = Math.sin((fr.t || 0) * 1.6 + d.seed) * 0.03, y0 = 0.02 + bob;
        const P = rotP(d.x, d.z, d.rot), mid = [d.x, y0 + 0.1, d.z];
        const hullTop = [P(-0.45, y0 + 0.16, -0.14), P(0.38, y0 + 0.16, -0.16), P(0.55, y0 + 0.16, 0), P(0.38, y0 + 0.16, 0.16), P(-0.45, y0 + 0.16, 0.14)];
        const hullBot = [P(-0.4, y0, -0.1), P(0.34, y0, -0.1), P(0.46, y0, 0), P(0.34, y0, 0.1), P(-0.4, y0, 0.1)];
        out.push(face(hullTop, PAL.hull, mid));
        for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; out.push(face([hullTop[i], hullTop[j], hullBot[j], hullBot[i]], i % 2 ? PAL.stripe : PAL.hull, mid)); }
        box(out, d.x - 0.1 * Math.cos(d.rot), y0 + 0.16, d.z - 0.1 * Math.sin(d.rot), 0.26, 0.2, 0.16, d.rot, PAL.white, hexc("#d5dde3"));
      }
    }
    function smoke(g, d, fr) {
      if (d.unit >= (fr.dslOn || 0)) return;
      const load = clamp(fr.dslLoad ?? 0.6, 0.2, 1), t = fr.t || 0, wind = 0.35 + (fr.wind || 0.4) * 0.6;
      for (let i = 0; i < 5; i++) {
        const ph = ((t * 0.35 + i / 5 + d.unit * 0.13) % 1);
        const p = project([d.x + ph * wind * 1.2, d.y + ph * 1.4, d.z - ph * 0.3]);
        if (!p) continue;
        const r = (0.14 + ph * 0.5) * Fz / p[2] * (0.75 + load * 0.5);
        g.fillStyle = `rgba(${fr.light.night > 0.5 ? "176,184,198" : "226,230,236"},${(0.72 - ph * 0.62) * (0.55 + load * 0.45)})`;
        g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fill();
      }
    }
    function clouds(g, fr, Lt) {
      const t = fr.t || 0, base = fr.cloudy ? 7 : 4, list = [];
      for (let i = 0; i < base; i++) list.push([(hash(i, 1, 70) - 0.5) * 34 + ((t * 0.25 + i * 3) % 40) - 20, 7.5 + hash(i, 2, 71) * 2, (hash(i, 3, 72) - 0.5) * 30 - 4, 1.8 + hash(i, 4, 73) * 1.8]);
      if (fr.cloudy) list.push([0.5, 6.5, 0.5, 3.4], [2.5, 6.8, -1.5, 2.6]);
      const col = Lt.night > 0.5 ? "70,84,110" : fr.cloudy ? "214,222,232" : "255,255,255";
      for (const [x, y, z, s] of list) {
        const p = project([x, y, z]);
        if (!p) continue;
        const r = s * Fz / p[2];
        for (let k = 0; k < 3; k++) {
          const cx = p[0] + (k - 1) * r * 0.7, cy = p[1] + (k === 1 ? -r * 0.25 : 0), rr = r * (k === 1 ? 0.75 : 0.55);
          const gr = g.createRadialGradient(cx, cy, rr * 0.1, cx, cy, rr);
          gr.addColorStop(0, `rgba(${col},${fr.cloudy ? 0.8 : 0.7})`); gr.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
        }
      }
    }
    V.render = render;
    V.hit = (x, y) => {
      const list = V.pick || [];
      for (let i = list.length - 1; i >= 0; i--) {
        const { xs, ys, id } = list[i];
        let inside = false;
        for (let a = 0, b = xs.length - 1; a < xs.length; b = a++) {
          if ((ys[a] > y) !== (ys[b] > y) && x < (xs[b] - xs[a]) * (y - ys[a]) / (ys[b] - ys[a]) + xs[a]) inside = !inside;
        }
        if (inside) return { id };
      }
      return null;
    };
    V.resize = (w, h) => {
      V.W = w; V.H = h;
      V.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const W = Math.max(1, Math.round(w * V.dpr)), H = Math.max(1, Math.round(h * V.dpr));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      V.g = canvas.getContext("2d");
      V.g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    };
    return V;
  }

  /* ===================== 4. 장면 자료 ===================== */
  const DEMO = { bat: [0, 0, 2, 3, 1, -2, -3, -1], n: [1, 1, 1, 0, 0, 1, 2, 2], dr: [false, false, false, false, true, true, false, false], shed: "R1", curt: "C1", weights: [3, 1.5] };
  // 화면에 보일 자료: 시험을 완료하면 세 날씨 결과, 그 전에는 예보대로(S1) 미리보기만 쓴다.
  function sceneData(src, view) {
    const m = model();
    if (!m) return null;
    let P, rs = null, prev = null;
    if (src && src.api) {
      const api = src.api;
      P = api.plan();
      prev = api.preview();
      const run = api.displayRun();
      if (run) { const res = m.compute(run.plan, run.corrections, run.rev); if (res.complete) rs = res.rs; }
    } else if (src && src.store) {
      const g = m.normalize(KCP.load(ID).game).game, run = g.locked || g.latestRun;
      P = run ? run.plan : g;
      if (run) { const res = m.compute(run.plan, run.corrections, run.rev); if (res.complete) rs = res.rs; }
      if (!rs) prev = m.simulate({ ...m.planSnapshot(g), shed: g.shed || "R1", curt: g.curt || "C1" }, "S1", q => m.approvalMatches(g.approvals, q), { preview: true });
    } else {
      P = DEMO;
      prev = m.simulate(DEMO, "S1", () => true, { preview: true });
    }
    if (!rs && !(prev && prev.rows)) return null;
    const tested = !!rs;
    const s = tested && view && SIDS.includes(view.s) ? view.s : "S1";
    const rows = tested ? rs[SIDS.indexOf(s)].rows : prev.rows;
    return { P, rs, prev, tested, s, rows, provisionalFrom: tested ? null : prev.provisionalFrom };
  }
  function loadsAt(row, P) {
    const d = row.d, dr = P.dr[row.b] ? 1.5 : 0;
    return [1, 0.3 * (d - 1), 0.4 * (d - 1), 0.3 * (d - 1) - dr];
  }
  function frameFor(data, b, t, prefs) {
    const L = labels(), row = data.rows[b], P = data.P;
    const light = lightFor(b, prefs && prefs.daylock);
    const fr = { b, t, light, rows: data.rows, wind: L ? L.WIND[b] / 2 : 0.4 };
    fr.soc = row.soc;
    fr.batDir = row.ch > EPS ? 1 : row.dis > EPS ? -1 : 0;
    fr.dslOn = P.n[b];
    fr.dslLoad = P.n[b] ? row.g / (3 * P.n[b]) : 0;
    fr.cloudy = data.s === "S2" && b >= 4 && b <= 6;
    fr.heat = data.s === "S3" && b >= 3 && b <= 6;
    if (data.tested) {
      const loads = loadsAt(row, P);
      fr.dark = row.cut.map((c, i) => loads[i] > EPS ? clamp(c / loads[i], 0, 1) : 0);
      fr.curtFrac = row.pv > EPS ? clamp(row.curt / row.pv, 0, 1) : 0;
    }
    return fr;
  }

  /* ===================== 5. 화면 셸 ===================== */
  const OBJ = {
    F1: { kicker: "FEEDER F1", title: "필수시설", color: "#f29bb2", desc: "병원·요양원·무더위쉼터. 냉방과 필수 장비에 쓰는 1.0 MW 고정 수요입니다." },
    F2: { kicker: "FEEDER F2", title: "서부 마을", color: "#ecd083", desc: "고령층 비율이 높은 마을. 디젤 발전기와 가까워 정전과 대기오염의 부담을 함께 집니다." },
    F3: { kicker: "FEEDER F3", title: "동부 신도시", color: "#9fd8f5", desc: "주거와 생활시설 수요. 젊은 가구가 중심이지만 냉방 중단의 불편과 건강 위험이 없다는 뜻은 아닙니다." },
    F4: { kicker: "FEEDER F4", title: "항구 산업", color: "#7be3b4", desc: "냉동창고·수산 가공 수요. 수요반응을 켠 구간에는 계약대로 1.5 MW를 줄입니다." },
    BAT: { kicker: "STORAGE", title: "운영센터 · 배터리", color: "#71dceb", icon: "battery", desc: "16 MWh · 최대 4 MW. 앞 구간에 남겨 둔 에너지만 뒤 구간에 쓸 수 있고, 전날 요청대로만 움직입니다." },
    DSL: { kicker: "GENERATOR", title: "디젤 발전소", color: "#d2a77c", icon: "factory", desc: "3기, 기당 1~3 MW. 켜 둔 발전기는 수요가 적어도 최소 1 MW를 냅니다. 서부 마을 옆에 있습니다." },
    PV: { kicker: "SOLAR", title: "태양광 단지", color: "#ffd36b", icon: "sun", desc: "20 MW = 외부 사업자 14 MW + 주민 협동조합 6 MW. 남는 전력은 태양광부터 줄입니다." },
    WIND: { kicker: "WIND", title: "풍력 발전기", color: "#d9e6f0", icon: "wind", desc: "2 MW 1기. 구간별 출력은 이 게임이 정한 가정값이며 이번 모형에서는 줄이지 않습니다." }
  };
  const ANCHOR = { F1: [0.6, 1.5, -6.0], F2: [-7.1, 1.05, 3.7], F3: [7.3, 3.0, -0.5], F4: [-0.6, 1.3, 7.8], BAT: [0.4, 2.15, 4.4], DSL: [-4.7, 2.5, 0.6], PV: [0.6, 1.7, -0.2], WIND: [-2.6, 4.4, -7.5] };
  const MINOR = new Set(["BAT", "DSL", "PV", "WIND"]);
  const STEPS = [
    { key: "crit", title: "판단 기준 정하기", text: "첫째·둘째 판단 기준과 폭염 노출 가중치를 고르세요. 기준을 먼저 정해야 결과를 같은 잣대로 읽을 수 있습니다.", target: "#ig-criteria", focus: "#ig-crit1" },
    { key: "plan", title: "운영 계획 그리기", text: "8구간마다 배터리·디젤·수요반응을 정하세요. 섬의 배터리, 디젤 발전소, 항구를 눌러도 그 구간 값을 바꿀 수 있습니다.", target: "#ig-timeline", focus: "#ig-bat-row" },
    { key: "principles", title: "분담 원칙 고르기", text: "전력이 모자랄 때 누구부터 줄일지(R1~R3), 남을 때 출력제한을 어떻게 나눌지(C1·C2) 고르세요.", target: "#ig-principles", focus: "#ig-shed-R1" },
    { key: "baseline", title: "기준선 선언과 예측", text: "어느 날씨에서 미공급을 얼마 이하로 둘지 선언하고, 정전이 가장 클 날씨를 예측하세요. 첫 예측은 시험 뒤 고칠 수 없습니다.", target: "#ig-baseline", focus: "#ig-baseline-s" },
    { key: "tested", title: "세 날씨로 시험 운전", text: "같은 계획을 세 날씨로 시험합니다. 시험을 마치면 구름 날씨와 더 더운 날의 결과와 급전선별 차단이 섬에 나타납니다.", target: "#ig-test", focus: "#ig-test" },
    { key: "locked", title: "계획 확정과 한 문장", text: "결과를 비교해 계획을 확정하고, 얻는 것과 잃는 것을 한 문장으로 쓰세요. 그다음 면접실로 이동합니다.", target: ".ig-final", focus: "#ig-lock" }
  ];
  const stepDone = (st, k) => k === "locked" ? st.locked && st.oneLine : !!st[k];

  const S = {
    on: false, phase: null, root: null, view: null, api: null, prefs: { daylock: false, motion: !reducedMotion(), labels: true, flows: true },
    vb: 4, s: "S1", sel: null, playing: false, speed: 1, t0: performance.now(), raf: 0, animUntil: 0, last: 0, lastActive: null,
    off: [], dialogs: {}, layoutRaf: 0, panel: "plan", playTimer: 0, uiTimer: 0, data: null
  };
  function $(sel) { return S.root ? S.root.querySelector(sel) : null; }

  function buildShell(app) {
    const L = labels();
    const root = document.createElement("div");
    root.id = "igs-root";
    root.className = "igs-root";
    root.dataset.panel = "plan";
    const cap = (k, icon, name, core, tone) => `<span class="v2-cap${tone ? " tone-" + tone : ""}" data-cap="${k}"${core ? " data-core" : ""} title="${name}">${ico(icon)}<span class="v2-cap-txt"><span class="v2-cap-k" data-k>${name}</span><span class="v2-cap-v" data-v></span></span></span>`;
    root.innerHTML = `
      <div class="v2-capsules igs-hud" id="igs-hud" role="group" aria-label="장면 상태: 선택한 시간 구간">
        ${cap("time", "clock", "시간", true)}
        ${cap("sky", "sun", "날씨", false, "sky")}
        <span class="v2-seg igs-scen" id="igs-scen" role="group" aria-label="장면 날씨" hidden>${SIDS.map(s => `<button type="button" data-igs-s="${s}" aria-pressed="${s === "S1"}">${s}</button>`).join("")}</span>
        <span class="v2-cap igs-lock-cap" id="igs-scen-lock" data-cap="lock"><span class="v2-cap-txt"><span class="v2-cap-k">구름·더위 날씨</span><span class="igs-lock-note">시험 후 공개</span></span></span>
        ${cap("load", "bolt", "수요")}
        ${cap("ren", "leaf", "재생 발전", false, "mint")}
        ${cap("soc", "battery", "배터리 잔량", true, "mint")}
        ${cap("dsl", "factory", "디젤")}
        ${cap("co2", "co2", "이 구간 CO₂", false, "gold")}
        ${cap("short", "alert", "부족", true)}
        <span class="v2-cap igs-cap-state" data-cap="state"><span class="v2-cap-txt"><span class="v2-cap-k">상태</span><span class="v2-cap-v" data-v></span></span></span>
        <button type="button" class="v2-cap-btn" id="igs-play" aria-pressed="false" aria-label="하루 재생">${ico("play")}</button>
        <button type="button" class="v2-cap-btn" id="igs-speed" aria-label="재생 속도 1배">1×</button>
        <button type="button" class="v2-cap-btn igs-more" id="igs-more" aria-expanded="false" aria-controls="igs-hud" aria-label="상태 자세히">${ico("more")}</button>
      </div>
      <p class="igs-badge" id="igs-badge" role="status">${ico("flag")}<span data-v>편집 중</span></p>
      <nav class="v2-toolbar igs-tools" id="igs-tools" aria-label="게임 메뉴">
        <button type="button" class="v2-tool" data-igs-panel="plan" aria-controls="v2-plan" aria-expanded="true">${ico("plan")}<span>계획</span></button>
        <button type="button" class="v2-tool" data-igs-open="quests" aria-haspopup="dialog">${ico("quest")}<span>단계</span></button>
        <button type="button" class="v2-tool" data-igs-panel="status" aria-controls="igs-status" aria-expanded="false">${ico("status")}<span>현황</span></button>
        <button type="button" class="v2-tool" data-igs-panel="settings" aria-controls="igs-settings" aria-expanded="false">${ico("settings")}<span>설정</span></button>
      </nav>
      <aside class="igs-quest" id="igs-quest" aria-labelledby="igs-q-title">
        <div class="igs-quest-head"><p class="v2-kicker">QUEST <span id="igs-q-n">1</span> / 6</p><button type="button" class="igs-q-fold" id="igs-q-fold" aria-expanded="true" aria-controls="igs-q-body">접기</button></div>
        <div class="igs-q-body" id="igs-q-body">
          <h2 class="igs-q-title" id="igs-q-title"></h2>
          <p class="igs-q-text" id="igs-q-text"></p>
          <p class="igs-q-next"><span class="v2-badge-gold">다음</span><span id="igs-q-next"></span></p>
          <div class="igs-q-bar" id="igs-q-bar" aria-hidden="true">${STEPS.map(() => "<span></span>").join("")}</div>
          <div class="igs-q-actions"><button type="button" class="v2-btn primary" id="igs-q-go">계획에서 열기</button><button type="button" class="v2-btn" data-igs-open="quests">전체 단계</button><button type="button" class="v2-btn" data-igs-open="story">브리핑</button></div>
        </div>
      </aside>
      <section class="v2-panel igs-plan" id="v2-plan" aria-labelledby="v2-plan-title">
        <header class="v2-panel-head"><div><p class="v2-kicker" id="v2-plan-kicker">DISPATCH PLAN</p><h2 class="v2-panel-title" id="v2-plan-title">급전 계획</h2></div><button type="button" class="v2-close" data-igs-close="plan" aria-label="계획 패널 닫기"><span aria-hidden="true">✕</span></button></header>
        <div class="igs-qbar" id="igs-qbar"><div class="igs-qbar-t"><p class="v2-kicker">QUEST <span id="igs-qb-n">1</span> / 6</p><p class="igs-qbar-title" id="igs-qb-title"></p></div><button type="button" class="v2-btn primary" id="igs-qb-go">이동</button><button type="button" class="v2-btn" data-igs-open="quests">전체 단계</button></div>
        <div class="v2-panel-body" id="v2-plan-body"></div>
      </section>
      <section class="v2-panel igs-status" id="igs-status" aria-labelledby="igs-status-title" hidden>
        <header class="v2-panel-head"><div><p class="v2-kicker">ISLAND STATUS</p><h2 class="v2-panel-title" id="igs-status-title">섬 현황</h2></div><button type="button" class="v2-close" data-igs-close="status" aria-label="현황 패널 닫기"><span aria-hidden="true">✕</span></button></header>
        <div class="v2-panel-body" id="igs-status-body"></div>
      </section>
      <section class="v2-panel igs-settings" id="igs-settings" aria-labelledby="igs-settings-title" hidden>
        <header class="v2-panel-head"><div><p class="v2-kicker">SETTINGS</p><h2 class="v2-panel-title" id="igs-settings-title">설정</h2></div><button type="button" class="v2-close" data-igs-close="settings" aria-label="설정 패널 닫기"><span aria-hidden="true">✕</span></button></header>
        <div class="v2-panel-body" id="igs-settings-body">
          <div class="igs-set-mission"><p class="v2-kicker">CURRENT STEP</p><p id="igs-set-step"></p></div>
          <dl class="igs-set-counts"><div><dt>계획 수정</dt><dd id="igs-set-rev">0회</dd></div><div><dt>시험 운전</dt><dd id="igs-set-tests">0회</dd></div><div><dt>상태</dt><dd id="igs-set-state">편집 중</dd></div></dl>
          <p class="igs-set-guide">섬을 끌면 시점이 돌고, 휠이나 두 손가락으로 확대합니다. 건물이나 이름표를 누르면 그 시간 구간의 값과 조작이 열립니다. 모든 조작은 계획 패널에서도 할 수 있습니다.</p>
          <div class="igs-set-grid">
            <button type="button" class="v2-tile" data-igs-open="howto">${ico("help")}게임 방법</button>
            <button type="button" class="v2-tile" data-igs-open="story">${ico("book")}이야기</button>
            <button type="button" class="v2-tile" data-igs-cam="reset">${ico("reset")}시점 초기화</button>
            <button type="button" class="v2-tile" id="igs-set-day" aria-pressed="false">${ico("sun")}항상 낮</button>
            <button type="button" class="v2-tile" id="igs-set-motion" aria-pressed="true">${ico("wave")}움직임</button>
            <button type="button" class="v2-tile" id="igs-set-labels" aria-pressed="true">${ico("tag")}이름표</button>
            <button type="button" class="v2-tile" id="igs-set-flows" aria-pressed="true">${ico("bolt")}전력 흐름</button>
          </div>
        </div>
      </section>
      <div class="igs-dock" id="igs-dock">
        <section class="igs-select" id="igs-select" aria-labelledby="igs-select-title" hidden>
          <div class="igs-select-head"><div><p class="v2-kicker" id="igs-select-kicker"></p><h2 class="igs-select-title" id="igs-select-title"></h2></div><button type="button" class="v2-close" id="igs-select-close" aria-label="선택 닫기"><span aria-hidden="true">✕</span></button></div>
          <p class="igs-select-desc" id="igs-select-desc"></p>
          <dl class="igs-select-stats" id="igs-select-stats"></dl>
          <div class="igs-select-actions" id="igs-select-actions"></div>
          <p class="igs-select-note" id="igs-select-note"></p>
        </section>
        <div class="igs-camrow" role="group" aria-label="시점">
          <button type="button" class="v2-pill" data-igs-cam="reset">${ico("reset")}<span>시점 초기화</span></button>
          <button type="button" class="v2-iconbtn" data-igs-cam="rotl" aria-label="왼쪽으로 돌리기">${ico("rotl")}</button>
          <button type="button" class="v2-iconbtn" data-igs-cam="rotr" aria-label="오른쪽으로 돌리기">${ico("rotr")}</button>
          <button type="button" class="v2-iconbtn igs-wide" data-igs-cam="zin" aria-label="확대">${ico("zin")}</button>
          <button type="button" class="v2-iconbtn igs-wide" data-igs-cam="zout" aria-label="축소">${ico("zout")}</button>
          <button type="button" class="v2-iconbtn igs-wide" data-igs-cam="tilt" aria-pressed="false" aria-label="낮은 시점">${ico("tilt")}</button>
        </div>
        <div class="igs-timeline" role="group" aria-label="장면 시간 구간">
          <span class="igs-prog" id="igs-prog" aria-hidden="true"></span>
          <button type="button" class="igs-prev" id="igs-prev" aria-label="이전 구간">${ico("prev")}</button>
          <span class="igs-mtime" id="igs-mtime"></span>
          <div class="igs-segs">${(L ? L.times : Array.from({ length: 8 }, (_, b) => String(b * 3))).map((t, b) => `<button type="button" class="igs-seg" data-igs-b="${b}" aria-pressed="false" aria-label="${esc(t)} 보기"><span>${String(b * 3).padStart(2, "0")}</span><span class="igs-seg-i" aria-hidden="true"></span><span class="igs-seg-bar" aria-hidden="true"></span></button>`).join("")}</div>
          <button type="button" class="igs-next" id="igs-next"><span>다음 구간</span><small id="igs-next-sub"></small></button>
        </div>
      </div>
      <div class="igs-stage">
        <canvas id="igs-canvas" class="igs-canvas" role="img" aria-label="섬 전력망 3D 장면"></canvas>
        <div class="igs-vignette" aria-hidden="true"></div>
        <div class="igs-report" id="igs-report" role="status" aria-live="polite" aria-atomic="true" hidden></div>
        <div class="igs-banners" id="igs-banners">${Object.keys(OBJ).map(k => MINOR.has(k)
          ? `<button type="button" class="igs-banner igs-marker" data-igs-pick="${k}" aria-pressed="false" style="--bn:${OBJ[k].color}" data-minor><span class="igs-bn-code">${ico(OBJ[k].icon)}</span><span class="sr-only">${esc(OBJ[k].title)}</span><span class="igs-bn-val sr-only" data-val></span><span data-cut hidden></span></button>`
          : `<button type="button" class="igs-banner" data-igs-pick="${k}" aria-pressed="false" style="--bn:${OBJ[k].color}"><span class="igs-bn-code">${k}</span><span class="igs-bn-name">${esc(OBJ[k].title)}</span><span class="igs-bn-val" data-val></span><span class="igs-bn-cut" data-cut></span></button>`).join("")}</div>
      </div>`;
    const timeset = KCP.$("#timeset", app);
    if (timeset) timeset.after(root); else app.prepend(root);
    S.root = root;
    // 기존 화면 요소를 셸 안으로 옮긴다. #phase는 계획 패널, 안내는 큰 창, 시간 조언은 설정으로.
    const phase = KCP.$("#phase", app);
    $("#v2-plan-body").append(phase);
    const tip = KCP.$("#tm-tip", app);
    if (tip) $("#igs-settings-body").insertBefore(tip, $(".igs-set-grid"));
    const strip = KCP.$("#strip", app);
    const ttl = strip && KCP.$(".ttl", strip);
    if (ttl) {
      ttl.insertAdjacentHTML("afterend", `<span class="igs-strip-q" id="igs-strip-q"></span><button type="button" class="igs-strip-info" id="igs-strip-info" data-igs-open="story" aria-label="브리핑 보기">${ico("info")}</button>`);
    }
    buildDialogs(app);
    bindShell();
  }

  /* ---------- 큰 창: 이야기, 게임 방법, 전체 단계 ---------- */
  function buildDialogs(app) {
    const V2 = KCP.v2;
    if (!V2 || !V2.dialog) return;
    const brief = KCP.$(".brief", app);
    // 이야기: 상황 안내를 장으로 나눈다.
    const story = V2.dialog({ id: "igs-story", kicker: "STORY", title: "연습섬 IG-24 이야기", className: "igs-story" });
    const ps = brief ? KCP.$$(".scenario > p:not(.label)", brief) : [];
    const rules = brief ? KCP.$$(".rules li", brief) : [];
    const task = brief ? KCP.$(".task ol", brief) : null;
    const clone = n => n ? n.cloneNode(true).outerHTML : "";
    const chapters = [
      { label: "BRIEFING", title: "폭염 전날 밤의 운영센터", body: clone(ps[0]), keys: ["폭염 예보", "육지 전력망 미연결", "급전 계획 담당자"] },
      { label: "ENERGY", title: "햇빛과 바람, 저장과 디젤", body: clone(ps[1]), keys: ["태양광 20 MW", "풍력 2 MW", "배터리 16 MWh", "디젤 3기"] },
      { label: "RULES", title: "전날 정한 계획대로", body: `<ul>${rules.slice(0, 2).map(clone).join("")}</ul>`, keys: ["3시간 × 8구간", "세 날씨 같은 계획", "보정은 승인 후"] },
      { label: "BURDEN", title: "누구의 부담으로 나눌까", body: `<ul>${rules.slice(2, 5).map(clone).join("")}</ul>`, keys: ["차단 원칙", "출력제한 분담", "자료 밖 대안은 가정"] },
      { label: "MISSION", title: "준비실에서 만들 답", body: task ? `<ol>${KCP.$$("li", task).map(clone).join("")}</ol>` : "", keys: ["기준 먼저", "얻는 것과 잃는 것", "가장 부담을 지는 집단"] }
    ];
    let ch = 0;
    const paintStory = () => {
      const c = chapters[ch];
      story.body.innerHTML = `<div class="v2-story"><div class="v2-story-no" aria-hidden="true">${String(ch + 1).padStart(2, "0")}</div><p class="v2-kicker">CHAPTER ${ch + 1} · ${c.label}</p><h3>${esc(c.title)}</h3>${c.body}<div class="v2-keys">${c.keys.map(k => `<span class="v2-badge-gold">${esc(k)}</span>`).join("")}</div>
        <div class="v2-story-foot"><div class="v2-dots" role="img" aria-label="${chapters.length}장 중 ${ch + 1}장">${chapters.map((_, i) => `<span class="${i <= ch ? "on" : ""}"></span>`).join("")}</div>
        <div class="row">${ch ? '<button type="button" class="v2-btn" data-story="prev">이전</button>' : ""}<button type="button" class="v2-btn primary" data-story="next" data-v2-autofocus>${ch < chapters.length - 1 ? "다음 기록" : "계획 시작"}</button></div></div></div>`;
    };
    story.body.addEventListener("click", e => {
      const b = e.target.closest("[data-story]");
      if (!b) return;
      if (b.dataset.story === "prev") ch = Math.max(0, ch - 1);
      else if (ch < chapters.length - 1) ch++;
      else { story.close(); openPanel("plan"); return; }
      paintStory();
      const nx = story.body.querySelector('[data-story="next"]');
      if (nx) nx.focus({ preventScroll: true });
    });
    story.el.addEventListener("close", () => { ch = 0; paintStory(); });
    paintStory();
    // 게임 방법: 번호 카드와 전체 안내문
    const howto = V2.dialog({ id: "igs-howto", kicker: "HOW TO PLAY", title: "게임 방법", wide: true });
    howto.body.innerHTML = `<ol class="v2-howto">${STEPS.map((s, i) => `<li><span class="n">${i + 1}</span><b>${esc(s.title)}</b><p>${esc(s.text)}</p></li>`).join("")}</ol>
      <div class="v2-long"><h3>섬 다루기</h3><ul class="v2-howto">
        <li><b>끌기</b><p>섬을 끌면 시점이 돕니다. 위아래로 끌면 기울기가 바뀝니다.</p></li>
        <li><b>확대</b><p>마우스 휠이나 두 손가락으로 확대·축소합니다. 시점 초기화로 처음 모습에 돌아옵니다.</p></li>
        <li><b>건물 누르기</b><p>배터리·디젤·항구를 누르면 그 구간의 값을 바로 바꿀 수 있습니다. 계획 패널의 같은 칸이 함께 바뀝니다.</p></li>
        <li><b>시간 막대</b><p>구간을 누르거나 다음 구간으로 하루를 넘겨 봅니다. 장면을 보는 시간일 뿐 계획을 바꾸지 않습니다.</p></li>
      </ul></div>
      <div class="v2-long igs-brief-full"><h3>상황과 규칙 전문</h3></div>`;
    if (brief) howto.body.querySelector(".igs-brief-full").append(brief);
    // 전체 단계
    const quests = V2.dialog({ id: "igs-quests", kicker: "QUEST MAP", title: "준비 단계" });
    quests.body.addEventListener("click", e => {
      const b = e.target.closest("[data-igs-step]");
      if (!b) return;
      quests.close();
      goStep(Number(b.dataset.igsStep));
    });
    [story, howto, quests].forEach(d => S.root.append(d.el));
    S.dialogs = { story, howto, quests, paintQuests: () => paintQuestMap(quests) };
  }
  function paintQuestMap(dlg) {
    const st = S.api ? S.api.status() : {};
    const cur = STEPS.findIndex(s => !stepDone(st, s.key));
    dlg.body.innerHTML = `<p class="small">계획을 세우고 시험해 확정하기까지 여섯 단계입니다. 단계를 누르면 계획 패널의 해당 위치로 이동합니다.</p>
      <ol class="v2-steps" style="margin-top:12px">${STEPS.map((s, i) => {
        const done = stepDone(st, s.key), now = i === cur;
        return `<li class="${done ? "done" : ""}"${now ? ' aria-current="step"' : ""}><span class="n">${done ? ico("check") : i + 1}</span><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div><div class="row"><span class="v2-state">${done ? "완료" : now ? "진행 중" : "대기"}</span><button type="button" class="v2-btn" data-igs-step="${i}">열기</button></div></li>`;
      }).join("")}</ol>`;
  }
  function openDialog(name, from) {
    const d = S.dialogs[name];
    if (!d) return;
    if (name === "quests") S.dialogs.paintQuests();
    d.open(from);
  }
  function goStep(i) {
    const s = STEPS[i];
    openPanel("plan");
    const target = document.querySelector(s.target), focus = document.querySelector(s.focus);
    if (target) target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    const el = focus && !focus.disabled ? focus : document.querySelector("#ig-bat-row");
    if (el) el.focus({ preventScroll: true });
  }

  /* ---------- 패널 ---------- */
  function openPanel(name) {
    if (!S.root) return;
    S.panel = name;
    S.root.dataset.panel = name || "none";
    [["plan", "#v2-plan"], ["status", "#igs-status"], ["settings", "#igs-settings"]].forEach(([k, sel]) => {
      const el = $(sel);
      if (el) el.hidden = k !== name;
    });
    S.root.querySelectorAll("[data-igs-panel]").forEach(b => b.setAttribute("aria-expanded", String(b.dataset.igsPanel === name)));
    if (name === "status") paintStatus();
    if (name === "settings") paintSettings();
    layout();
  }
  function togglePanel(name, btn) {
    if (S.panel === name) { openPanel(null); if (btn) btn.focus({ preventScroll: true }); }
    else openPanel(name);
  }

  /* ---------- 배치 측정 ---------- */
  // 휴대폰과 세로 태블릿은 아래 메뉴·아래 시트 배치를 쓴다(장면 CSS와 같은 조건).
  const COMPACT = "(max-width: 760px), (max-width: 1100px) and (orientation: portrait)";
  const mobile = () => (window.matchMedia ? matchMedia(COMPACT).matches : window.innerWidth <= 760);
  function layout() {
    if (!S.root || !S.on) return;
    const strip = document.getElementById("strip");
    if (!strip) return;
    const sb = Math.round(strip.getBoundingClientRect().bottom);
    html.style.setProperty("--igs-hud-top", (sb + (mobile() ? 6 : 8)) + "px");
    const hud = $("#igs-hud");
    // 상태 막대를 펼쳐도 섬 영역은 접힌 높이를 기준으로 둔다.
    if (hud && hud.dataset.expanded === "true" && S.hudBottom) { request(); return; }
    const hb = hud && S.phase === "prep" ? Math.round(hud.getBoundingClientRect().bottom) : sb;
    S.hudBottom = hb;
    html.style.setProperty("--v2-top", (Math.max(sb, hb) + (mobile() ? 6 : 10)) + "px");
    const nav = $("#igs-tools");
    if (mobile() && nav) html.style.setProperty("--igs-nav-h", Math.round(nav.getBoundingClientRect().height) + "px");
    const panelOpen = S.panel && !mobile();
    const panelW = S.panel === "status" ? 380 : S.panel === "settings" ? 470 : 440;
    html.style.setProperty("--igs-reserve", panelOpen ? (Math.min(panelW, window.innerWidth - 120) + 96 + 24) + "px" : "100px");
    // 섬이 보이는 영역(카메라 중심)
    const W = window.innerWidth, H = window.innerHeight;
    const top = Math.max(sb, hb) + 6;
    let vis;
    if (mobile()) {
      const dock = $("#igs-dock").getBoundingClientRect();
      vis = { x: 0, y: top - 16, w: W, h: Math.max(120, dock.top - top + 10) };
    } else {
      const right = panelOpen ? W - (Math.min(panelW, W - 120) + 96) - 8 : W - 90;
      vis = { x: 0, y: top, w: Math.max(200, right), h: Math.max(160, H - top - 40) };
    }
    if (S.view) { S.view.vis = vis; }
    request();
  }
  function scheduleLayout() {
    if (S.layoutRaf) return;
    S.layoutRaf = requestAnimationFrame(() => { S.layoutRaf = 0; layout(); });
  }

  /* ---------- 그리기 예약 ---------- */
  function request(anim = 0) {
    if (anim && S.prefs.motion && !reducedMotion()) S.animUntil = Math.max(S.animUntil, performance.now() + anim);
    if (!S.raf) S.raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    S.raf = 0;
    if (!S.on || !S.view) return;
    const cv = S.view.canvas, box = cv.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (S.view.W !== box.width || S.view.H !== box.height || !S.view.g) S.view.resize(box.width, box.height);
    const data = S.data || (S.data = sceneData(S.api ? { api: S.api } : { store: true }, { s: S.s }));
    if (!data) return;
    if (S.pan) {
      const k = clamp((now - S.pan.t0) / 450, 0, 1), e = 1 - Math.pow(1 - k, 3);
      S.view.cam.tx = lerp(S.pan.x0, S.pan.x1, e); S.view.cam.tz = lerp(S.pan.z0, S.pan.z1, e);
      if (k >= 1) S.pan = null; else S.animUntil = Math.max(S.animUntil, now + 50);
    }
    const moving = S.prefs.motion && !reducedMotion() && (S.playing || now < S.animUntil);
    const t = moving ? (now - S.t0) / 1000 : S.tFrozen || (S.tFrozen = 2.3);
    if (moving) S.tFrozen = t;
    const fr = frameFor(data, S.vb, t, S.prefs);
    S.view.sel = S.sel;
    S.view.render(fr);
    if (S.prefs.flows && S.phase === "prep") drawFlows(S.view, data, fr, t, moving);
    placeBanners(data);
    if (S.playing && now - S.last > 1700 / S.speed) { S.last = now; step(1, true); }
    if (S.playing) { const pg = $("#igs-prog"); if (pg) pg.style.setProperty("--igs-prog", clamp((now - S.last) / (1700 / S.speed), 0, 1).toFixed(3)); }
    if ((moving || S.playing) && !S.raf) S.raf = requestAnimationFrame(frame);
  }

  /* ---------- 이름표 ---------- */
  function placeBanners(data) {
    const layer = $("#igs-banners");
    if (!layer || S.phase !== "prep") return;
    layer.dataset.off = String(!S.prefs.labels);
    const row = data.rows[S.vb], P = data.P, loads = loadsAt(row, P);
    const vis = S.view.vis || { x: 0, y: 0, w: S.view.W, h: S.view.H };
    const placed = [];
    const els = Array.from(layer.querySelectorAll("[data-igs-pick]")).map(el => ({ el, p: S.view.project(ANCHOR[el.dataset.igsPick]) }));
    // 가까운(화면 아래쪽) 이름표부터 놓고, 겹치면 위로 밀어 서로 가리지 않게 한다.
    els.sort((a, b) => (b.p ? b.p[1] : -1e9) - (a.p ? a.p[1] : -1e9));
    els.forEach(({ el, p }) => {
      const k = el.dataset.igsPick;
      const ok = p && p[0] > vis.x + 10 && p[0] < vis.x + vis.w - 10 && p[1] > vis.y + 24 && p[1] < vis.y + vis.h + 30 && getComputedStyle(el).display !== "none";
      el.style.visibility = ok ? "visible" : "hidden";
      if (ok) {
        const w = el.offsetWidth, h = el.offsetHeight + 7;
        let x = p[0], y = p[1];
        for (let guard = 0; guard < 8; guard++) {
          const hit = placed.find(r => Math.abs(r.x - x) < (r.w + w) / 2 + 4 && Math.abs(r.y - y) < (r.h + h) / 2 + 2);
          if (!hit) break;
          y = hit.y - (hit.h + h) / 2 - 3;
        }
        placed.push({ x, y, w, h });
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      }
      el.setAttribute("aria-pressed", String(S.sel === k));
      let val = "", cut = "";
      if (k.startsWith("F")) {
        const i = Number(k[1]) - 1;
        val = `${d2(loads[i])} MW`;
        if (data.tested && row.cut[i] > EPS) cut = `−${d2(row.cut[i])}`;
        if (k === "F4" && P.dr[S.vb]) val += " · 수요반응";
      } else if (k === "BAT") val = `${d2(row.soc)} MWh${row.ch > EPS ? " ▲" : row.dis > EPS ? " ▼" : ""}`;
      else if (k === "DSL") val = `${P.n[S.vb]}기 ${d2(row.g)} MW`;
      else if (k === "PV") val = `${d2(row.pv)} MW`;
      else if (k === "WIND") val = `${d2(labels().WIND[S.vb])} MW`;
      const v = el.querySelector("[data-val]"), c = el.querySelector("[data-cut]");
      if (v.textContent !== val) { v.textContent = val; if (MINOR.has(k)) el.title = `${OBJ[k].title} · ${val}`; }
      if (c.textContent !== cut) c.textContent = cut;
    });
  }

  /* ---------- 상태 갱신 ---------- */
  function refreshUI() {
    if (!S.on || !S.root) return;
    S.data = sceneData(S.api ? { api: S.api } : { store: true }, { s: S.s });
    const data = S.data, L = labels();
    if (!data || !L) return;
    if (!data.tested) S.s = "S1";
    const b = S.vb, row = data.rows[b], P = data.P;
    const set = (k, v, sub, tone) => {
      const el = S.root.querySelector(`[data-cap="${k}"]`);
      if (!el) return;
      const vv = el.querySelector("[data-v]"), kk = el.querySelector("[data-k]");
      if (vv && vv.textContent !== v) vv.textContent = v;
      if (kk && sub !== undefined && kk.textContent !== sub) kk.textContent = sub;
      if (tone !== undefined) el.classList.toggle("tone-danger", tone === "danger");
    };
    const night = SKY[b].night >= 1, dusk = SKY[b].night > 0 && !night;
    const skyIco = S.root.querySelector('[data-cap="sky"] .v2-ico');
    if (skyIco) skyIco.innerHTML = ICON[data.s === "S2" && b >= 4 && b <= 6 ? "cloud" : night ? "moon" : "sun"];
    const provisional = data.provisionalFrom !== null && b >= data.provisionalFrom;
    set("time", L.times[b], `구간 ${b + 1}/8`);
    set("sky", `${row.t.toFixed(1)}°C`, data.tested ? L.scenarios[data.s] : "S1 예보대로");
    set("load", `${d2(row.L)} MW`, "수요");
    set("ren", `${d2(row.r)} MW`, "재생 발전");
    set("soc", `${d2(row.soc)} MWh`, provisional ? "잔량 · 임시값" : "배터리 잔량");
    set("dsl", `${P.n[b]}기 · ${d2(row.g)} MW`, "디젤");
    set("co2", `${d2(row.g * 3 * 0.75)} t`, "이 구간 CO₂");
    set("short", `${d2(row.u)} MW`, provisional ? "부족 · 임시값" : "부족", row.u > EPS ? "danger" : "");
    const scen = $("#igs-scen"), lock = $("#igs-scen-lock");
    scen.hidden = !data.tested;
    lock.hidden = data.tested;
    scen.querySelectorAll("[data-igs-s]").forEach(btn => btn.setAttribute("aria-pressed", String(btn.dataset.igsS === data.s)));
    // 배지와 띠
    const st = S.api ? S.api.status() : null;
    const G = S.api ? S.api.G : null;
    const stateText = !G ? "확정 계획 보기" : G.locked ? "계획 확정" : G.tests ? `시험 ${G.tests}회 · 편집 중` : "편집 중 · 시험 0회";
    const badge = $("#igs-badge [data-v]");
    if (badge.textContent !== stateText) badge.textContent = stateText;
    set("state", stateText);
    const cur = st ? STEPS.findIndex(s => !stepDone(st, s.key)) : -1;
    const q = document.getElementById("igs-strip-q");
    if (q) q.textContent = st ? (cur < 0 ? "준비 완료 · 면접실로" : `준비 단계 ${cur + 1}/6`) : "";
    // 단계 카드
    if (st) {
      const i = cur < 0 ? STEPS.length - 1 : cur;
      $("#igs-q-n").textContent = String(cur < 0 ? 6 : cur + 1);
      $("#igs-q-title").textContent = cur < 0 ? "준비 완료" : STEPS[i].title;
      $("#igs-q-text").textContent = cur < 0 ? "계획을 확정하고 한 문장을 썼습니다. 면접실로 이동해 후속 질문에 답하세요." : STEPS[i].text;
      $("#igs-q-next").textContent = cur < 0 ? "면접실" : cur + 1 < STEPS.length ? STEPS[cur + 1].title : "면접실";
      $("#igs-q-go").textContent = cur < 0 ? "면접실로 이동 버튼 보기" : "계획에서 열기";
      $("#igs-q-bar").querySelectorAll("span").forEach((sp, k) => { sp.className = stepDone(st, STEPS[k].key) ? "done" : k === cur ? "now" : ""; });
      $("#igs-qb-n").textContent = String(cur < 0 ? 6 : cur + 1);
      $("#igs-qb-title").textContent = cur < 0 ? "준비 완료 · 면접실로 이동하세요" : STEPS[i].title;
    }
    // 시간 막대
    S.root.querySelectorAll("[data-igs-b]").forEach(btn => {
      const k = Number(btn.dataset.igsB), r = data.rows[k];
      btn.setAttribute("aria-pressed", String(k === b));
      btn.dataset.short = String(r.u > EPS);
      btn.dataset.pending = String(data.provisionalFrom !== null && k >= data.provisionalFrom);
      const ic = btn.querySelector(".igs-seg-i");
      const want = SKY[k].night >= 1 ? "moon" : SKY[k].night > 0 ? "sun" : data.s === "S2" && k >= 4 && k <= 6 ? "cloud" : "sun";
      if (ic.dataset.k !== want) { ic.dataset.k = want; ic.innerHTML = ico(want); }
    });
    const nb = (b + 1) % 8;
    $("#igs-next-sub").textContent = `${L.times[nb]} ▶`;
    $("#igs-mtime").textContent = L.times[b];
    paintSelect();
    if (S.panel === "status") paintStatus();
    if (S.panel === "settings") paintSettings();
    const cv = $("#igs-canvas");
    const aria = `섬 전력망 3D 장면. ${L.times[b]}, ${data.tested ? L.scenarios[data.s] : "예보대로 미리보기"}. 수요 ${d2(row.L)} MW, 재생 발전 ${d2(row.r)} MW, 배터리 잔량 ${d2(row.soc)} MWh, 디젤 ${P.n[b]}기, 부족 ${d2(row.u)} MW.${dusk ? " 해 질 녘." : night ? " 밤." : ""}`;
    if (cv.getAttribute("aria-label") !== aria) cv.setAttribute("aria-label", aria);
    request();
  }
  function scheduleUI() {
    clearTimeout(S.uiTimer);
    const wait = performance.now() - (S.lastUI || 0) > 120 ? 0 : 90;
    S.uiTimer = setTimeout(() => { S.lastUI = performance.now(); refreshUI(); }, wait);
  }

  /* ---------- 전력 흐름 ---------- */
  // 모형 결과 행의 수지(태양광−출력제한 + 풍력 + 방전 + 디젤 = 공급 + 충전)를 계통 중심을 거치는 흐름으로 그린다.
  // 시험 전에는 급전선별 차단을 드러내지 않는다(D-33): 부족이 있으면 계통 중심만 붉게 표시한다.
  const HUB = [-0.7, 2.6, 2.2];
  const FLOW_COL = { PV: [255, 211, 107], WIND: [226, 238, 246], DSL: [224, 164, 110], BAT: [113, 220, 235] };
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function drawFlows(V, data, fr, t, moving) {
    const g = V.g, row = data.rows[S.vb], P = data.P;
    if (!g || !row) return;
    const hub = V.project(HUB);
    if (!hub) return;
    const at = k => { const a = ANCHOR[k]; return V.project([a[0], a[1] - 0.7, a[2]]); };
    const loads = loadsAt(row, P), night = fr.light ? fr.light.night || 0 : 0;
    const sc = clamp(Math.min(V.W, V.H * 1.6) / 1100, 0.65, 1.25);
    const links = [];
    const add = (from, to, v, col, cut) => { if (from && to && (v > 0.05 || cut > EPS)) links.push({ from, to, v, col, cut: cut || 0 }); };
    add(at("PV"), hub, Math.max(0, row.pv - row.curt), FLOW_COL.PV);
    add(at("WIND"), hub, Math.max(0, row.r - row.pv), FLOW_COL.WIND);
    add(at("DSL"), hub, row.g, FLOW_COL.DSL);
    add(at("BAT"), hub, row.dis, FLOW_COL.BAT);
    add(hub, at("BAT"), row.ch, FLOW_COL.BAT);
    for (let i = 0; i < 4; i++) {
      const k = "F" + (i + 1), cut = data.tested ? row.cut[i] : 0;
      add(hub, at(k), Math.max(0, loads[i] - cut), hexRgb(OBJ[k].color), cut);
    }
    g.save();
    g.lineCap = "round";
    for (const l of links) {
      const [x0, y0] = l.from, [x1, y1] = l.to, dist = Math.hypot(x1 - x0, y1 - y0);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - dist * 0.24;
      const q = u => [(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1, (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y1];
      const w = clamp(1.4 + l.v * 0.5, 1.4, 5.5) * sc, c = l.col;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1);
      g.strokeStyle = "rgba(8,20,34,0.38)"; g.lineWidth = w + 2.4 * sc; g.stroke();
      if (l.v > 0.05) { g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.42 + night * 0.25})`; g.lineWidth = w; g.stroke(); }
      if (l.cut > EPS) {
        g.setLineDash([5 * sc, 5 * sc]); g.strokeStyle = "rgba(220,120,144,0.95)"; g.lineWidth = Math.max(1.6, w * 0.6); g.stroke(); g.setLineDash([]);
        const pulse = moving ? 0.5 + 0.5 * Math.sin(t * 5) : 0.7;
        g.beginPath(); g.arc(x1, y1, (9 + pulse * 5) * sc, 0, Math.PI * 2);
        g.strokeStyle = `rgba(220,120,144,${0.55 + 0.4 * pulse})`; g.lineWidth = 2.4 * sc; g.stroke();
      }
      if (l.v <= 0.05) continue;
      const n = clamp(Math.round(2 + l.v * 0.9), 2, 9), r = w * 0.62 + 1.2 * sc;
      g.fillStyle = `rgba(${Math.min(255, c[0] + 30)},${Math.min(255, c[1] + 30)},${Math.min(255, c[2] + 30)},0.95)`;
      for (let i = 0; i < n; i++) {
        const u = moving ? (t * (0.32 + 0.04 * Math.min(l.v, 6)) + i / n) % 1 : (i + 0.5) / n;
        const [px, py] = q(u);
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      }
    }
    // 계통 중심: 부족이 있으면 붉게 맥박친다.
    const short = row.u > EPS, pulse = moving ? 0.5 + 0.5 * Math.sin(t * 4) : 0.6;
    g.beginPath(); g.arc(hub[0], hub[1], (short ? 9 + pulse * 4 : 7) * sc, 0, Math.PI * 2);
    g.fillStyle = short ? `rgba(220,120,144,${0.75 + 0.2 * pulse})` : "rgba(113,220,235,0.9)"; g.fill();
    g.lineWidth = 2.2 * sc; g.strokeStyle = "rgba(8,20,34,0.75)"; g.stroke();
    g.beginPath(); g.arc(hub[0], hub[1], 3 * sc, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    g.restore();
  }

  /* ---------- 구간 보고 ---------- */
  function reportFor(data, b) {
    const L = labels(), r = data.rows[b], p = data.rows[(b + 7) % 8], P = data.P, items = [];
    if (r.u > EPS) {
      if (data.tested) {
        const cuts = r.cut.map((c, i) => (c > EPS ? `F${i + 1} ${d2(c)}` : null)).filter(Boolean).join(" · ");
        items.push({ tone: "danger", text: `부족 ${d2(r.u)} MW · 차단 ${cuts} MW` });
      } else items.push({ tone: "danger", text: `부족 ${d2(r.u)} MW · 급전선별 차단은 시험 뒤 공개` });
    }
    if (Math.abs(r.pv - p.pv) >= 1) {
      const why = r.pv > p.pv ? "해가 오르며" : data.s === "S2" && b >= 4 && b <= 6 ? "구름이 끼며" : "해가 기울며";
      items.push({ tone: "sun", text: `${why} 태양광 ${d2(p.pv)} → ${d2(r.pv)} MW` });
    }
    if (r.ch > EPS) items.push({ tone: "cyan", text: `배터리 충전 ${d2(r.ch)} MW · 잔량 ${d2(r.soc)} MWh` });
    else if (r.dis > EPS) items.push({ tone: "cyan", text: `배터리 방전 ${d2(r.dis)} MW · 잔량 ${d2(r.soc)} MWh${r.soc <= 1.6 + 1e-6 ? " (하한)" : ""}` });
    if (r.n !== p.n || (b === 0 && r.n)) items.push({ tone: "gold", text: r.n ? `디젤 ${p.n}기 → ${r.n}기 · ${d2(r.g)} MW · CO₂ ${d2(r.g * 3 * 0.75)} t` : `디젤 ${p.n}기 → 정지` });
    if (r.curt > EPS) items.push({ tone: "sun", text: `남는 태양광 ${d2(r.curt)} MW 출력제한` });
    if (P.dr[b] && !P.dr[(b + 7) % 8]) items.push({ tone: "mint", text: "항구 수요반응 시작 · 1.5 MW 줄임" });
    if (!items.length) items.push({ tone: "ok", text: `수요 ${d2(r.L)} MW를 모두 공급` });
    const provisional = data.provisionalFrom !== null && b >= data.provisionalFrom;
    return { time: L.times[b], scen: (data.tested ? L.scenarios[data.s] : "S1 예보대로 미리보기") + (provisional ? " · 임시값" : ""), items: items.slice(0, 3) };
  }
  function showReport() {
    const el = $("#igs-report"), data = S.data;
    if (!el || !data || !labels() || S.phase !== "prep") return;
    const rp = reportFor(data, S.vb);
    el.innerHTML = `<p class="igs-rep-h"><span class="igs-rep-t">${esc(rp.time)}</span><span class="igs-rep-s">${esc(rp.scen)}</span></p><ul>${rp.items.map(it => `<li data-tone="${it.tone}">${esc(it.text)}</li>`).join("")}</ul>`;
    el.hidden = false;
    el.dataset.show = "true";
    clearTimeout(S.repTimer);
    if (!S.playing) hideReportSoon();
  }
  function hideReportSoon() {
    clearTimeout(S.repTimer);
    S.repTimer = setTimeout(() => { const el = $("#igs-report"); if (el) { el.dataset.show = "false"; S.repTimer = setTimeout(() => { if (!S.playing && el.dataset.show === "false") el.hidden = true; }, 400); } }, 6000);
  }

  /* ---------- 선택 카드 ---------- */
  const ACTIONS = {
    BAT: [["bat", -1, "방전 쪽 −1 MW"], ["bat", 1, "충전 쪽 +1 MW"]],
    DSL: [["n", -1, "1기 끄기"], ["n", 1, "1기 더 켜기"]],
    F4: [["dr", 0, "수요반응 켜기·끄기"]]
  };
  function select(id, from) {
    S.sel = id && OBJ[id] ? id : null;
    const card = $("#igs-select");
    if (!card) return;
    card.hidden = !S.sel;
    S.root.dataset.sel = String(!!S.sel);
    if (S.sel) {
      const o = OBJ[S.sel];
      $("#igs-select-kicker").textContent = o.kicker;
      $("#igs-select-title").textContent = o.title;
      $("#igs-select-desc").textContent = o.desc;
      $("#igs-select-actions").innerHTML = (ACTIONS[S.sel] || []).map(([row, d, label], i) => `<button type="button" class="v2-btn${i === (ACTIONS[S.sel].length - 1) ? " primary" : ""}" data-igs-act="${row}:${d}">${esc(label)}</button>`).join("") +
        (S.sel === "F1" || S.sel === "F2" ? '<button type="button" class="v2-btn" data-igs-goto="#ig-weights">폭염 가중치 보기</button>' : "") +
        (S.sel === "PV" ? '<button type="button" class="v2-btn" data-igs-goto="#ig-principles">출력제한 원칙 보기</button>' : "");
      // 휴대폰에서는 아래 시트를 접어 섬과 선택 카드가 함께 보이게 한다.
      if (mobile() && S.panel) openPanel(null);
    }
    paintSelect();
    if (S.sel) requestAnimationFrame(() => focusOn(S.sel));
    request(1200);
  }
  // 선택 카드가 고른 건물을 가리면 카메라를 옮겨 건물이 보이게 한다.
  function focusOn(id) {
    const card = $("#igs-select");
    if (!S.view || !card || card.hidden || mobile()) return;
    S.view.setup();
    const p = S.view.project(ANCHOR[id]), vis = S.view.vis;
    if (!p || !vis) return;
    const cr = card.getBoundingClientRect();
    const covered = p[0] > cr.left - 40 && p[0] < cr.right + 40 && p[1] > cr.top - 60 && p[1] < cr.bottom + 20;
    if (!covered) return;
    const want = [Math.min(vis.x + vis.w - 80, Math.max(cr.right + 120, vis.x + vis.w * 0.6)), vis.y + vis.h * 0.4];
    const B = S.view.basis(), c = S.view.cam, sp = Math.max(0.35, Math.sin(c.pitch));
    const dr = -(want[0] - p[0]) * p[2] / B.F, df = (want[1] - p[1]) * p[2] / (B.F * sp);
    const fh = Math.hypot(B.fx, B.fz) || 1;
    const tx = c.tx + dr * B.rx + df * B.fx / fh, tz = c.tz + dr * B.rz + df * B.fz / fh;
    if (S.prefs.motion && !reducedMotion()) S.pan = { x0: c.tx, z0: c.tz, x1: tx, z1: tz, t0: performance.now() };
    else { c.tx = tx; c.tz = tz; }
    request(900);
  }
  function paintSelect() {
    if (!S.sel || !S.data) return;
    const data = S.data, L = labels(), b = S.vb, row = data.rows[b], P = data.P, k = S.sel;
    const stats = [["시간", `${L.times[b]} · ${data.tested ? data.s : "S1 예보"}`]];
    let note = "";
    if (k.startsWith("F")) {
      const i = Number(k[1]) - 1, loads = loadsAt(row, P);
      stats.push(["이 구간 부하", `${d2(loads[i])} MW`]);
      if (data.tested) {
        stats.push(["이 구간 차단", `${d2(row.cut[i])} MW`]);
        stats.push(["하루 차단", `${d2(data.rs[SIDS.indexOf(data.s)].cut[i])} MWh`]);
      } else note = "급전선별 차단은 세 날씨로 시험한 뒤 공개됩니다.";
      if (i < 3) stats.push(["폭염 가중치", i === 0 ? String(P.weights[0]) : i === 1 ? String(P.weights[1]) : "1 (고정)"]);
      else stats.push(["수요반응", `${P.dr[b] ? "켬" : "끔"} · 하루 ${P.dr.filter(Boolean).length}/2구간`]);
    } else if (k === "BAT") {
      const v = P.bat[b];
      stats.push(["요청", v > 0 ? `충전 ${v} MW` : v < 0 ? `방전 ${-v} MW` : "정지"]);
      stats.push(["실제 충전 / 방전", `${d2(row.ch)} / ${d2(row.dis)} MW`]);
      stats.push(["잔량 시작 → 끝", `${d2(row.before)} → ${d2(row.soc)} MWh`]);
      if (row.clip) note = "잔량 한도 때문에 요청보다 작게 움직입니다.";
      if (data.provisionalFrom !== null && b >= data.provisionalFrom) note = "보정 승인 전이라 이 구간 값은 임시 제안값입니다. 계획 패널의 보정 안내를 확인하세요.";
    } else if (k === "DSL") {
      stats.push(["가동", `${P.n[b]}기 · 최소 ${P.n[b]} MW`]);
      stats.push(["발전", `${d2(row.g)} MW`]);
      stats.push(["이 구간 CO₂", `${d2(row.g * 3 * 0.75)} t`]);
      stats.push(["새 기동", `${row.starts}기`]);
    } else if (k === "PV") {
      stats.push(["발전", `${d2(row.pv)} MW`]);
      stats.push(["전지 온도", `${d2(row.cell)} °C`]);
      if (data.tested) stats.push(["출력제한", `${d2(row.curt)} MW (외부 ${d2(row.ext)} · 조합 ${d2(row.coop)})`]);
      else note = "출력제한 분담은 시험 뒤 공개됩니다.";
    } else if (k === "WIND") {
      stats.push(["출력", `${d2(L.WIND[b])} MW`]);
      stats.push(["정격 대비", `${Math.round(L.WIND[b] / 2 * 100)}%`]);
    }
    const dl = $("#igs-select-stats");
    const htmlStats = stats.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join("");
    if (dl.innerHTML !== htmlStats) dl.innerHTML = htmlStats;
    const editable = !!(S.api && S.api.editable());
    S.root.querySelectorAll("[data-igs-act]").forEach(btn => {
      const [r, dd] = btn.dataset.igsAct.split(":"), d = Number(dd);
      let dis = !editable;
      if (r === "bat") dis = dis || (d > 0 ? P.bat[b] >= 4 : P.bat[b] <= -4);
      if (r === "n") dis = dis || (d > 0 ? P.n[b] >= 3 : P.n[b] <= 0);
      if (r === "dr") btn.textContent = P.dr[b] ? "이 구간 수요반응 끄기" : "이 구간 수요반응 켜기";
      btn.disabled = dis;
    });
    if (!editable && S.api && S.api.G.locked) note = "계획을 확정했습니다. 바꾸려면 계획 패널에서 다시 계획하기를 누르세요.";
    const ne = $("#igs-select-note");
    if (ne.textContent !== note) ne.textContent = note;
  }
  function act(spec) {
    if (!S.api || !S.api.editable()) return;
    const [r, dd] = spec.split(":"), d = Number(dd), b = S.vb, G = S.api.G;
    if (r === "dr") S.api.set("dr", b, G.dr[b] ? 0 : 1);
    else S.api.set(r, b, Number(G[r][b]) + d);
    request(1600);
  }

  /* ---------- 현황·설정 ---------- */
  function paintStatus() {
    const body = $("#igs-status-body");
    if (!body || !S.data) return;
    const data = S.data, L = labels(), b = S.vb, row = data.rows[b], P = data.P;
    const tot = k => data.rows.reduce((s, r) => s + r[k] * 3, 0);
    const loads = loadsAt(row, P);
    const res = data.tested ? data.rs[SIDS.indexOf(data.s)] : null;
    body.innerHTML = `<h3>일일 운영값 · ${esc(data.tested ? L.scenarios[data.s] : "S1 예보대로 미리보기")}</h3>
      <dl class="igs-status-list">
        <div><dt>수요(수요반응 후)</dt><dd>${d2(tot("L"))} MWh</dd></div>
        <div><dt>재생 발전</dt><dd>${d2(tot("r"))} MWh</dd></div>
        <div><dt>디젤 발전 · CO₂</dt><dd>${d2(tot("g"))} MWh · ${d2(tot("g") * 0.75)} t</dd></div>
        <div><dt>미공급</dt><dd>${d2(tot("u"))} MWh</dd>${data.prev && data.prev.provisionalFrom !== null ? '<span class="sub">보정 승인 전 구간은 임시 제안값입니다.</span>' : ""}</div>
        <div><dt>하루 끝 배터리 잔량</dt><dd>${d2(data.rows[7].soc)} MWh</dd><span class="sub">시작 8.00 MWh</span></div>
      </dl>
      <h3>급전선 · ${esc(L.times[b])}</h3>
      <dl class="igs-status-list">${L.feeders.map((name, i) => `<div><dt>${esc(name)}</dt><dd>${d2(loads[i])} MW</dd><span class="sub">${res ? `이 구간 차단 ${d2(row.cut[i])} MW · 하루 ${d2(res.cut[i])} MWh` : "차단 분배는 시험 뒤 공개"}</span></div>`).join("")}</dl>
      <h3>설비 보기</h3>
      <div class="igs-pick-list">${["BAT", "DSL", "PV", "WIND", "F1", "F2", "F3", "F4"].map(k => `<button type="button" class="v2-btn" data-igs-pick="${k}">${esc(OBJ[k].title)}</button>`).join("")}</div>`;
  }
  function paintSettings() {
    const st = S.api ? S.api.status() : null, G = S.api ? S.api.G : null;
    const cur = st ? STEPS.findIndex(s => !stepDone(st, s.key)) : -1;
    const t = (sel, v) => { const el = $(sel); if (el && el.textContent !== v) el.textContent = v; };
    t("#igs-set-step", st ? (cur < 0 ? "준비 완료 · 면접실로 이동" : `단계 ${cur + 1}/6 · ${STEPS[cur].title}`) : "확정 계획 보기");
    t("#igs-set-rev", G ? `${G.rev}회` : "-");
    t("#igs-set-tests", G ? `${G.tests}회` : "-");
    t("#igs-set-state", G ? (G.locked ? "확정" : "편집 중") : "-");
    $("#igs-set-day").setAttribute("aria-pressed", String(S.prefs.daylock));
    $("#igs-set-motion").setAttribute("aria-pressed", String(S.prefs.motion));
    $("#igs-set-labels").setAttribute("aria-pressed", String(S.prefs.labels));
    $("#igs-set-flows").setAttribute("aria-pressed", String(S.prefs.flows));
  }

  /* ---------- 시간 ---------- */
  function setB(b, report) { S.vb = ((b % 8) + 8) % 8; refreshUI(); request(900); if (report) showReport(); }
  function step(d, auto) { setB(S.vb + d, true); if (!auto && S.playing) S.last = performance.now(); }
  function setPlaying(on) {
    S.playing = !!on;
    const btn = $("#igs-play");
    btn.setAttribute("aria-pressed", String(S.playing));
    btn.setAttribute("aria-label", S.playing ? "하루 재생 멈춤" : "하루 재생");
    btn.innerHTML = ico(S.playing ? "pause" : "play");
    S.root.dataset.playing = String(S.playing);
    S.last = performance.now();
    if (S.playing) showReport(); else hideReportSoon();
    request();
  }

  /* ---------- 카메라 ---------- */
  const CAM0 = { yaw: 0.52, pitch: 0.78, zoom: 1, tx: 0, tz: 1.2 };
  function cam(cmd) {
    const c = S.view.cam;
    if (cmd === "reset") { S.pan = null; Object.assign(c, CAM0); }
    if (cmd === "rotl") c.yaw -= Math.PI / 6;
    if (cmd === "rotr") c.yaw += Math.PI / 6;
    if (cmd === "zin") c.zoom = clamp(c.zoom * 1.2, 0.6, 2.6);
    if (cmd === "zout") c.zoom = clamp(c.zoom / 1.2, 0.6, 2.6);
    if (cmd === "tilt") c.pitch = c.pitch > 0.5 ? 0.36 : CAM0.pitch;
    S.root.querySelectorAll('[data-igs-cam="tilt"]').forEach(b => b.setAttribute("aria-pressed", String(c.pitch < 0.5)));
    request(1200);
  }

  function bindShell() {
    const root = S.root, cv = $("#igs-canvas");
    S.view = makeView(cv);
    root.addEventListener("click", e => {
      const t = e.target.closest("button");
      if (!t || !root.contains(t)) return;
      if (t.dataset.igsPanel) togglePanel(t.dataset.igsPanel, t);
      else if (t.dataset.igsClose) { const btn = root.querySelector(`[data-igs-panel="${t.dataset.igsClose}"]`); openPanel(null); if (btn) btn.focus({ preventScroll: true }); }
      else if (t.dataset.igsOpen) openDialog(t.dataset.igsOpen, t);
      else if (t.dataset.igsPick) { select(S.sel === t.dataset.igsPick && t.closest(".igs-banners") ? null : t.dataset.igsPick, "button"); }
      else if (t.dataset.igsB !== undefined) setB(Number(t.dataset.igsB), true);
      else if (t.dataset.igsS) { S.s = t.dataset.igsS; refreshUI(); request(900); }
      else if (t.dataset.igsCam) cam(t.dataset.igsCam);
      else if (t.dataset.igsAct) act(t.dataset.igsAct);
      else if (t.dataset.igsGoto) { openPanel("plan"); const el = document.querySelector(t.dataset.igsGoto); if (el) { el.scrollIntoView({ block: "start" }); const f = el.querySelector("select, button, input"); if (f) f.focus({ preventScroll: true }); } }
      else if (t.id === "igs-next") step(1);
      else if (t.id === "igs-prev") step(-1);
      else if (t.id === "igs-play") setPlaying(!S.playing);
      else if (t.id === "igs-speed") { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; t.textContent = S.speed + "×"; t.setAttribute("aria-label", `재생 속도 ${S.speed}배`); }
      else if (t.id === "igs-more") { const hud = $("#igs-hud"), on = hud.dataset.expanded !== "true"; hud.dataset.expanded = String(on); t.setAttribute("aria-expanded", String(on)); scheduleLayout(); }
      else if (t.id === "igs-select-close") { select(null); }
      else if (t.id === "igs-q-fold") { const q = $("#igs-quest"), fold = q.dataset.folded !== "true"; q.dataset.folded = String(fold); t.setAttribute("aria-expanded", String(!fold)); t.textContent = fold ? "펼치기" : "접기"; }
      else if (t.id === "igs-q-go" || t.id === "igs-qb-go") { const st = S.api ? S.api.status() : {}; const cur = STEPS.findIndex(s => !stepDone(st, s.key)); if (cur < 0) { openPanel("plan"); const go = document.getElementById("ig-go"); if (go) { go.scrollIntoView({ block: "center" }); go.focus({ preventScroll: true }); } } else goStep(cur); }
      else if (t.id === "igs-set-day") { S.prefs.daylock = !S.prefs.daylock; paintSettings(); request(); }
      else if (t.id === "igs-set-motion") { S.prefs.motion = !S.prefs.motion; if (!S.prefs.motion) S.animUntil = 0; paintSettings(); request(); }
      else if (t.id === "igs-set-labels") { S.prefs.labels = !S.prefs.labels; paintSettings(); request(); }
      else if (t.id === "igs-set-flows") { S.prefs.flows = !S.prefs.flows; paintSettings(); request(); }
    });
    // 띠의 안내 버튼은 셸 밖에 있다.
    const info = document.getElementById("igs-strip-info");
    if (info) info.onclick = () => openDialog("story", info);
    // 끌어서 돌리기, 휠·두 손가락 확대, 눌러서 고르기
    const pts = new Map();
    let drag = null, pinch = 0, hoverT = 0;
    cv.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0, yaw: S.view.cam.yaw, pitch: S.view.cam.pitch };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; }
    });
    cv.addEventListener("pointermove", e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        S.view.cam.zoom = clamp(S.view.cam.zoom * d / pinch, 0.6, 2.6);
        pinch = d;
        request(800);
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        if (drag.moved > 5) {
          cv.classList.add("dragging");
          S.view.cam.yaw = drag.yaw + dx * 0.008;
          S.view.cam.pitch = clamp(drag.pitch - dy * 0.006, 0.3, 1.32);
          request(800);
        }
        return;
      }
      if (e.pointerType === "mouse" && S.data && performance.now() - hoverT > 90) {
        hoverT = performance.now();
        const r = cv.getBoundingClientRect();
        S.view.render(frameFor(S.data, S.vb, S.tFrozen || 2.3, S.prefs), { record: true });
        const h = S.view.hit(e.clientX - r.left, e.clientY - r.top), id = h && h.id;
        if (id !== S.view.hover) { S.view.hover = id; cv.classList.toggle("hovering", !!id); request(); }
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      cv.classList.remove("dragging");
      if (drag && drag.moved <= 5 && e.type === "pointerup" && S.data) {
        const r = cv.getBoundingClientRect();
        S.view.render(frameFor(S.data, S.vb, S.tFrozen || 2.3, S.prefs), { record: true });
        const h = S.view.hit(e.clientX - r.left, e.clientY - r.top);
        select(h && h.id ? h.id : null, "pointer");
      }
      drag = null;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (S.view.hover) { S.view.hover = null; cv.classList.remove("hovering"); request(); } });
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      S.view.cam.zoom = clamp(S.view.cam.zoom * Math.exp(-e.deltaY * 0.0012), 0.6, 2.6);
      request(600);
    }, { passive: false });
    const onResize = () => scheduleLayout();
    window.addEventListener("resize", onResize);
    S.off.push(() => window.removeEventListener("resize", onResize));
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => scheduleLayout());
      [document.getElementById("strip"), $("#igs-hud"), $("#igs-dock")].forEach(el => el && ro.observe(el));
      S.off.push(() => ro.disconnect());
    }
  }

  /* ===================== 6. 수명 ===================== */
  function teardown() {
    S.on = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    if (S.layoutRaf) cancelAnimationFrame(S.layoutRaf);
    clearTimeout(S.uiTimer);
    clearTimeout(S.repTimer);
    S.raf = S.layoutRaf = 0;
    S.off.forEach(f => f());
    S.off = [];
    S.root = S.view = S.api = S.data = null;
    S.sel = null;
    S.playing = false;
    S.dialogs = {};
    ["--igs-hud-top", "--v2-top", "--igs-nav-h", "--igs-reserve"].forEach(p => html.style.removeProperty(p));
  }
  KCP.on("route:change", teardown);
  KCP.on("phase:change", ({ year, to }) => {
    if (year !== ID) return;
    const app = document.getElementById("app");
    if (!S.root || !app.contains(S.root)) { teardown(); S.on = true; buildShell(app); }
    S.on = true;
    S.phase = to;
    S.api = null;
    S.data = null;
    html.classList.add("v2-scene");
    html.classList.toggle("v2-prep", to === "prep");
    html.classList.toggle("v2-doc", to !== "prep");
    const kicker = $("#v2-plan-kicker"), title = $("#v2-plan-title");
    if (to === "prep") { kicker.textContent = "DISPATCH PLAN"; title.textContent = "급전 계획"; openPanel("plan"); }
    else {
      kicker.textContent = to === "room" ? "INTERVIEW" : "REFLECTION";
      title.textContent = to === "room" ? "면접실 · 후속 질문" : "성찰 · 연습용 평가 기준";
      $("#v2-plan").hidden = false;
      S.vb = 4;
      select(null);
      setPlaying(false);
    }
    scheduleLayout();
    scheduleUI();
  });
  KCP.on("ig:prep", ({ api }) => {
    if (!S.on) return;
    S.api = api;
    const G = api.G, at = G.activeB[G.activeRow];
    // 처음 들어올 때는 한낮(12–15시)을 보여 주고, 계획 칸을 고르면 그 구간을 따라간다.
    S.vb = at === 0 && !G.tests ? 4 : at;
    S.lastActive = `${G.activeRow}:${at}`;
    // 게임은 첫 그리기 직전에 계약을 넘긴다. 미리보기가 생긴 뒤에 갱신한다.
    scheduleUI();
  });
  KCP.on("ig:paint", ({ G }) => {
    if (!S.on || !S.api) return;
    const a = `${G.activeRow}:${G.activeB[G.activeRow]}`;
    if (a !== S.lastActive) { S.lastActive = a; S.vb = G.activeB[G.activeRow]; }
    scheduleUI();
  });

  /* ===================== 7. 홈 그림 ===================== */
  let staticView = null;
  KCP.igScene = {
    paintStatic(canvas, { w, h, b = 4, hero = false, thumb = false } = {}) {
      if (!model()) return;
      if (!staticView || staticView.canvas !== canvas) staticView = makeView(canvas);
      const V = staticView;
      V.resize(w, h);
      Object.assign(V.cam, hero ? { yaw: 0.62, pitch: 0.7, zoom: 1.04, tx: 0, tz: 1.0 } : thumb ? { yaw: 0.55, pitch: 0.8, zoom: 1.22, tx: 0, tz: 1.0 } : CAM0);
      V.vis = { x: 0, y: thumb ? 0 : h * 0.02, w, h };
      const data = sceneData(null, null);
      V.render(frameFor(data, b, 2.3, { daylock: false }));
    }
  };
})();
