/* 섬 전력망 건설(#build) — GRID TYCOON 시안
 * 육각 섬 지도(캔버스 2.5D)에 발전소·배터리·송전선을 짓고, 정책 카드(최대 2장)와 미션 2개를 고른 뒤
 * 1주·1달·3달을 빨리 감아 결과를 본다. 계산은 단순한 가상 모형이다(시간 단위, 시드로 날씨 고정).
 * 저장: localStorage 'kcp-build-v1'(건설·정책·미션·시드), 'kcp-build-trial-v1'(리그 시험 수치).
 * 라우트를 떠나면(route:change) RAF·타이머·리스너를 모두 정리한다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || typeof KCP.route !== "function") return;
  const esc = KCP.esc;
  // D-72: 화면 문구를 만드는 곳에서만 변환한다. 자료의 등급과 출처 줄은 그대로 둔다.
  // D-72: 학생 화면의 근거 등급 글자를 학생 말로. 모르는 값은 낮춰 보이지 않게 원래 글자를 그대로 둔다.
  const GRADE_WORDS = { G: "게임 가정", M: "모형 계산", O: "공식 자료", "O*": "공식 자료(보도로 확인)", P: "논문·보고서" };
  KCP.gradeWords = grade => [...new Set(String(grade || "G").split("·").map(g => g.trim().replace(/^추정$/, "G"))
    .filter(Boolean).map(g => GRADE_WORDS[g] || g))].join(" · ");
  const html = document.documentElement;
  const KEY = "kcp-build-v1";
  const TRIAL_KEY = "kcp-build-trial-v1";
  let trialMemory = {};
  // 설비 대조 자료도 모듈 메모리에만 보관한다. 원본 결과·저장 문서에 필드를 붙이지 않는다.
  const replayLayouts = new WeakMap();
  const gridFillContexts = new WeakMap(); // 시간별 수요·성적표 재계산은 기기 메모리에만 둔다.
  const replayLayout = st => JSON.stringify({ builds: st.builds.map(b => [b.t, b.i]), lines: st.lines.map(l => l.p) });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (x, d = 0) => {
    const v = Math.round(x * 10 ** d) / 10 ** d;
    return v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const hh = h => String(h).padStart(2, "0") + ":00";

  /* =====================================================================
   * 1. 지도 묶음(ui/build-maps.js) → 타일·수요지
   *    뾰족한 위 육각, 홀수 행이 반 칸 오른쪽. 한 번에 한 지도만 쓴다(usePack).
   * ===================================================================== */
  const SQ3 = Math.sqrt(3);
  const BASE_TNAME = { sea: "바다", beach: "해안", plain: "평지", forest: "숲", hill: "언덕", mount: "산 능선", town: "마을", urban: "도시", river: "하천", lake: "호수", out: "인접 지역", grid: "외부 전력망" };
  const HGT = { sea: 0, beach: 0.14, plain: 0.3, forest: 0.34, hill: 0.72, mount: 1.2, town: 0.3, urban: 0.3, river: 0.04, lake: 0.04, out: 0.2, grid: 0.3 };
  const WATER = { sea: 1, river: 1, lake: 1 };
  // 수요지 종류: 이름, 묶음(차단 순서), 정전 만족 가중치
  const KIND = {
    hospital: { label: "병원", w: 2 }, fire: { label: "소방서", w: 1.6 }, gov: { label: "관공서", w: 1.2 }, water: { label: "정수·하수", w: 1.6 },
    rail: { label: "철도역", w: 1.5 }, rail_s: { label: "전철역", w: 1.3 },
    village: { label: "마을", w: 1.3, old: true }, town_s: { label: "소도시", w: 1.3, old: true },
    city: { label: "도시", w: 1 }, city_m: { label: "도시", w: 1 }, city_l: { label: "도심", w: 1 },
    school: { label: "대학", w: 0.8 }, farm: { label: "농업", w: 0.8 }, livestock: { label: "축산", w: 1 },
    port: { label: "항구", w: 1.2 }, industry: { label: "산업단지", w: 1.2 }, factory_big: { label: "반도체", w: 2.5 },
    plant: { label: "기존 발전소" }, gridpt: { label: "외부 전력망" }
  };
  const CRIT = { hospital: 1, fire: 1, gov: 1, water: 1, rail: 1, rail_s: 1 };
  // 차단 순서(작을수록 마지막까지 받는다). 필수시설은 균등이 아니면 늘 집·산업 뒤에 끊긴다.
  const SHED = {
    home: { hospital: 0, fire: 1, water: 1, rail: 2, rail_s: 2, gov: 2, village: 3, town_s: 3, livestock: 4, city: 4, city_m: 4, city_l: 4, school: 5, farm: 6, port: 7, industry: 7, factory_big: 8 },
    industry: { hospital: 0, fire: 1, water: 1, rail: 2, rail_s: 2, gov: 2, factory_big: 3, industry: 4, port: 4, livestock: 5, farm: 6, village: 7, town_s: 7, city: 7, city_m: 7, city_l: 7, school: 8 }
  };
  const SHED_OPTS = [{ id: "home", name: "주거·병원 보호" }, { id: "industry", name: "산업 보호" }, { id: "equal", name: "균등" }];
  const SEASONS = [{ id: "spring", name: "봄", m: 3 }, { id: "summer", name: "여름", m: 6 }, { id: "autumn", name: "가을", m: 9 }, { id: "winter", name: "겨울", m: 0 }];
  const MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const monthOf = doy => { let m = 11; while (m > 0 && MSTART[m] > doy) m--; return m; };
  const monthName = m => `${m + 1}월${m === 6 ? " 장마" : ""}`;
  const seasonName = id => { const x = SEASONS.find(q => q.id === id) || SEASONS[1]; return `${x.name} · ${monthName(x.m)}`; };
  const leagueMonth = () => S?.opts.leagueRound?.()?.month;
  const displaySeason = id => {
    const rd = S?.opts.leagueRound?.(), x = SEASONS.find(q => q.id === id) || SEASONS[1];
    return rd?.month ? `${x.name} · ${rd.month}월 (날씨는 ${monthName(x.m)} 기준)` : seasonName(id);
  };
  const leagueWords = text => leagueMonth() ? text.replaceAll("라운드", "달").replaceAll("턴", "달") : text;
  const seasonLabel = res => (res && res.season ? displaySeason(res.season) : "");
  const KIND_POP = { city_l: 5000, city_m: 3500, town_s: 900, hospital: 600, fire: 100, gov: 300, rail: 800, rail_s: 300, school: 1500, farm: 100, livestock: 150, water: 100, port: 1000, industry: 1500, factory_big: 2500, plant: 50, gridpt: 0 };

  function hash(a, b, k) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(k | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // 부드러운 값 잡음(0~1): 격자 꼭짓점 해시를 이중선형으로 잇는다.
  function vnoise(x, y, k) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sm = t => t * t * (3 - 2 * t);
    const a = hash(xi, yi, k), b = hash(xi + 1, yi, k), c = hash(xi, yi + 1, k), d = hash(xi + 1, yi + 1, k);
    return lerp(lerp(a, b, sm(fx)), lerp(c, d, sm(fx)), sm(fy));
  }
  const NB_E = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const NB_O = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  // MODS: 리그 이벤트가 이번 운전에만 거는 배수(simulate의 opt.mods). 운전이 끝나면 null.
  let MODS = null;
  let PK = null, LG = false, COLS = 0, ROWS = 0, TILES = [], SITES = [], TOWNS = [], TNAME = BASE_TNAME, POPMAX = 1;
  const tix = (c, r) => r * COLS + c;
  const cube = T => { const x = T.c - (T.r - (T.r & 1)) / 2; return [x, -x - T.r, T.r]; };
  function hexDist(a, b) {
    const A = cube(TILES[a]), B = cube(TILES[b]);
    return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
  }
  const PACKS = KCP.BUILD_MAPS || {};
  // REF 8.5 [S31], NASA POWER 2001–2020: 대표 격자 월평균 일강수×달 일수(mm).
  // 다른 기후 계수는 유지한다. 모든 지역에 대표 격자를 사용하는 것은 M 가정이다.
  Object.values(PACKS).forEach(pack => {
    if (pack.climate && !pack.climate.precip_mm) pack.climate.precip_mm = [0.70, 1.13, 1.27, 2.55, 2.72, 4.16, 11.08, 8.15, 4.47, 1.65, 1.54, 0.83].map((v, m) => v * [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]);
  });
  // 혼자 하기에서도 모든 지도(연습 섬 + 리그 도시 6곳)를 고를 수 있다. 혼자 할 때 외부 연결점은 외부 전력망(수입)이다.
  const PACK_IDS = Object.keys(PACKS);
  // lg: 리그 모드. P.gates가 있으면 그 칸만 외부 연결점(이웃 도시 쪽)이 되고 나머지 'g' 칸은 경계 밖이 된다.
  function buildPack(P, lg) {
    const cols = P.rows[0].length, rows = P.rows.length, tiles = [];
    const gates = lg && P.gates ? P.gates : null, gateAt = new Map();
    if (gates) gates.forEach(g => gateAt.set(g.r * cols + g.c, g));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ch = P.rows[r][c];
      const dig = /[1-9]/.test(ch) ? +ch - 1 : -1;
      let t = dig >= 0 ? "town" : P.legend[ch] || "out", vt = null;
      if (gates) t = gateAt.has(r * cols + c) ? "grid" : t === "grid" ? "out" : t;
      // P.own: 광역 지도에서 잘라 온 창. '0' 칸은 이웃 도시 땅 — 모양은 보이되 짓거나 지나갈 수 없다.
      if (P.own && P.own[r][c] === "0" && t !== "sea" && t !== "lake") { vt = t === "grid" ? "plain" : t; t = "out"; }
      tiles.push({ i: r * cols + c, c, r, t, vt, town: -1, site: -1, X: SQ3 * (c + 0.5 * (r & 1)), Y: 1.5 * r, dig });
    }
    tiles.forEach(T => {
      T.nb = [];
      for (const [dc, dr] of (T.r & 1 ? NB_O : NB_E)) {
        const c = T.c + dc, r = T.r + dr;
        if (c >= 0 && c < cols && r >= 0 && r < rows) T.nb.push(r * cols + c);
      }
      T.water = !!WATER[T.t]; T.land = !T.water; T.out = T.t === "out";
    });
    tiles.forEach(T => { T.coast = T.land && !T.out && T.nb.some(j => tiles[j].t === "sea"); });
    // 수요지·기존 발전소·외부 연결점
    const sites = P.sites.map((s, k) => {
      let tile = -1;
      if (Number.isInteger(s.c)) tile = s.r * cols + s.c;
      else { const T = tiles.find(x => x.dig === k); tile = T ? T.i : -1; }
      return Object.assign({}, s, { tile, pop: s.pop != null ? s.pop : KIND_POP[s.kind] || 100 });
    });
    if (gates) gates.forEach((g, k) => sites.push({ id: "G" + k, code: "망", kind: "gridpt", name: g.name, note: "이웃 도시 연결점", to: g.to.slice(), tile: g.r * cols + g.c, pop: 0 }));
    else tiles.filter(T => T.t === "grid").forEach((T, k) => {
      const north = T.r < rows / 2, g = (P.gates || []).find(x => x.r * cols + x.c === T.i);
      if (g) sites.push({ id: "G" + k, code: "망", kind: "gridpt", name: g.name.replace(/ 방향/, " 쪽 외부 전력망"), note: "외부 전력망(수입)", to: g.to.slice(), tile: T.i, pop: 0 });
      else sites.push({ id: north ? "GN" : "GS", code: "망", kind: "gridpt", name: north ? "외부 전력망(북)" : "외부 전력망(남)", note: P.externalGridNote?.[north ? "north" : "south"] || "이웃 지역 전력망", tile: T.i, pop: 0 });
    });
    const towns = [];
    sites.forEach((s, si) => {
      tiles[s.tile].site = si;
      if (s.dem) { s.ti = towns.length; tiles[s.tile].town = s.ti; towns.push(s); }
    });
    // 바다에서 놀 수 있는 땅까지 거리(해상풍력·조력 후보)
    const play = T => T.land && !T.out;
    const dsh = tiles.map(T => (play(T) ? 0 : Infinity));
    const q = tiles.filter(play).map(T => T.i);
    while (q.length) { const u = q.shift(); tiles[u].nb.forEach(v => { if (!play(tiles[v]) && !tiles[v].out && dsh[v] > dsh[u] + 1) { dsh[v] = dsh[u] + 1; q.push(v); } }); }
    tiles.forEach(T => {
      T.dshore = dsh[T.i];
      T.offshore = T.t === "sea" && T.dshore <= 2;
      T.tidal = false;
    });
    // 기후 값
    const C = P.climate;
    const meanArr = a => a.reduce((x, y) => x + y, 0) / a.length;
    tiles.forEach(T => {
      T.wind = 0; T.sun = 0; T.woff = 0; T.seaF = 1;
      if (!C) {
        if (!T.land) return;
        const WB = { beach: 6.4, plain: 5.0, forest: 4.2, hill: 6.3, mount: 8.3, town: 4.8 }, SB = { beach: 0.96, plain: 0.92, forest: 0.8, hill: 0.9, mount: 0.7, town: 0.9 };
        const w = WB[T.t] + Math.max(0, 6 - T.X) * 0.22 + (T.coast && T.t !== "beach" ? 0.5 : 0) + (hash(T.c, T.r, 3) - 0.5) * 0.6;
        T.wind = Math.round(clamp(w, 4, 9) * 10) / 10;
        const nearMount = T.t !== "mount" && T.nb.some(j => tiles[j].t === "mount");
        T.sun = Math.round(clamp(SB[T.t] + (hash(T.c, T.r, 5) - 0.5) * 0.06 - (nearMount ? 0.06 : 0) + (T.r - 5) * 0.006, 0.6, 1) * 100) / 100;
        return;
      }
      if (T.out) return;
      const n = vnoise(T.X / 3.2, T.Y / 3.2, P.seed), n2 = vnoise(T.X / 2.4 + 9, T.Y / 2.4 + 4, P.seed + 7);
      if (T.t === "sea") {
        T.seaF = 0.9 + 0.05 * Math.min(4, T.dshore) + (n - 0.5) * 0.04;
        T.wind = Math.round(meanArr(C.wind100_sea) * T.seaF * 10) / 10;
        T.sun = 0;
        return;
      }
      const off = T.t === "beach" || T.coast ? 1.0 + 0.5 * n2 : T.t === "hill" ? 0.8 : T.t === "urban" ? -0.5 : T.t === "forest" ? -0.3 : T.water ? 0.4 : 0;
      T.woff = Math.round((off + (n - 0.5) * 0.3) * 100) / 100;
      T.wind = Math.round(Math.max(0.5, meanArr(C.wind10_land) * C.hub_factor_land + T.woff) * 10) / 10;
      const sr = { plain: [0.92, 0.08], beach: [0.92, 0.08], grid: [0.92, 0.08], urban: [0.85, 0.07], forest: [0.78, 0.07], hill: [0.86, 0.09], river: [0.9, 0.05], lake: [0.9, 0.05] }[T.t] || [0.9, 0.05];
      T.sun = Math.round((sr[0] + sr[1] * n2) * 100) / 100;
    });
    const base = { urban: 400, plain: 40, beach: 10, forest: 10, hill: 15, town: 0 };
    let pm = 1;
    tiles.forEach(T => {
      T.pop = 0; T.near = 0;
      if (T.out || !T.land) return;
      T.pop = sites.reduce((a, s) => { const A = cubeOf(tiles[s.tile]), B = cubeOf(T); const d = Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])); return a + s.pop * Math.exp(-d / 1.2); }, 0) + (C ? base[T.t] || 0 : 0);
      T.near = sites.reduce((a, s) => { const A = cubeOf(tiles[s.tile]), B = cubeOf(T); return a + (Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])) <= 2 ? s.pop : 0); }, 0);
      pm = Math.max(pm, T.pop);
    });
    sites.forEach(s => { if (s.kind === "livestock") tiles[s.tile].nb.forEach(j => { tiles[j].livestock = true; }); });
    // 조력 후보: 항구 가까운 아산만 연안 바다(항구에서 2칸 안, 육지와 맞닿은 칸)
    const port = sites.find(s => s.kind === "port");
    if (P.climate && port) tiles.forEach(T => { if (T.t === "sea" && T.dshore === 1) { const A = cubeOf(T), B = cubeOf(tiles[port.tile]); T.tidal = Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])) <= 2; } });
    return { cols, rows, tiles, sites, towns, popMax: pm, tname: Object.assign({}, BASE_TNAME, P.tname || {}) };
  }
  function cubeOf(T) { const x = T.c - (T.r - (T.r & 1)) / 2; return [x, -x - T.r, T.r]; }
  function usePack(id, mode) {
    if (!Object.hasOwn(PACKS, id)) id = PACK_IDS[0];
    const P = PACKS[id], lg = mode === "league", key = lg ? "_bL" : "_b";
    if (!P[key]) P[key] = buildPack(P, lg);
    const B = P[key];
    if (P.groups && !P.groups.some(G => G.id === "rnd")) P.groups.push({ id: "rnd", name: "연구", icon: "flask", tools: ["uni", "lab"] });
    PK = P; LG = lg; COLS = B.cols; ROWS = B.rows; TILES = B.tiles; SITES = B.sites; TOWNS = B.towns; TNAME = B.tname; POPMAX = B.popMax;
    if (KCP.buildGame) Object.assign(KCP.buildGame, { TILES, TOWNS, SITES, PK });
    return P;
  }

  /* =====================================================================
   * 2. 가상 모형
   * ===================================================================== */
  const M = {
    solarMW: 2, rated: 12, cutout: 25, cutin: 3,
    // P · 왕복 85%의 √값 0.922 [I13][I14] · REF 8.6
    batMW: 4, batMWh: 16, batEff: 0.922, socFloor: 0.1,
    lossPerHex: 0.015, taxPerT: 0.005 / 0.75,
    drCost: 0.05, shareCost: 0.1, save: 0.05,
    // M · 경사면 이득 포함 실적 수율 0.8×14.2/12.4≈0.92 [S22][S31] · REF 8.1
    wxSun: [1, 0.45, 0.2], tidalPeriod: 12.42, pvYield: 0.92
  };
  // 발전원: cls ren(변동), disp(급전), bat(저장). ok는 지을 수 있는 지형.
  const LAND4 = { beach: 1, plain: 1, hill: 1, forest: 1 };
  const BLD0 = {
    solar: { hostLimited: true, variable: true, name: "태양광", spec: "2 MW", mw: 2, cost: 8, cls: "ren", ok: LAND4, icon: "sun" },
    roof: { hostLimited: true, variable: true, name: "지붕 태양광", spec: "0.6 MW", mw: 0.6, cost: 4, cls: "ren", ok: { urban: 1 }, roof: true, icon: "roof" },
    wind: { hostLimited: true, variable: true, name: "풍력", spec: "2 MW", mw: 2, cost: 10, cls: "ren", ok: Object.assign({ mount: 1 }, LAND4), icon: "wind" },
    offshore: { hostLimited: true, variable: true, name: "해상풍력", spec: "4 MW", mw: 4, cost: 24, cls: "ren", sea: "offshore", icon: "offshore" },
    tidal: { hostLimited: true, variable: true, name: "조력", spec: "2 MW", mw: 2, cost: 18, cls: "ren", sea: "tidal", icon: "tidal" },
    hydro: { hostLimited: true, name: "소수력", spec: "0.8 MW", mw: 0.8, cost: 9, cls: "ren", ok: { river: 1 }, icon: "hydro" },
    diesel: { name: "디젤", spec: "3 MW", mw: 3, cost: 6, cls: "disp", ok: LAND4, icon: "diesel" },
    biomass: { name: "바이오매스", spec: "2 MW", mw: 2, cost: 10, cls: "disp", ok: { plain: 1, forest: 1 }, icon: "leaf" },
    battery: { name: "배터리", spec: "4 MW/16 MWh", mw: 4, cost: 12, cls: "bat", ok: Object.assign({ urban: 1 }, LAND4), icon: "battery" },
    // 연구 기관(cls inst): 발전하지 않는다. 가까운 마을 수요에 load MW를 더한다. 연구 규칙은 아래 RS·TECHS.
    uni: { name: "에너지공학대학", spec: "연구인력 2 · 0.3 MW", mw: 0, cost: 40, cls: "inst", ok: { plain: 1, hill: 1, urban: 1 }, icon: "uni", load: 0.3 },
    lab: { name: "기후에너지데이터연구소", spec: "연구석 3 · 0.3억/주", mw: 0, cost: 25, cls: "inst", ok: { plain: 1, hill: 1, urban: 1 }, icon: "lab", load: 0.15 }
  };
  /* ---------- 연구 → 실증 → 도입 (설계안 v0.1 §5·§13, 숫자는 모두 게임 가정 G) ----------
   * 유효 연구인력 = min(전문인력, 연구석). 전문인력 = 연구소마다 1 + 대학마다 2(지은 뒤 준비 기간이 지나야).
   * 주마다 유효 인력만큼 진척. 기준(need)을 채우면 실증(1주, 실증비) → 다음 주부터 도입(효과).
   * 연구소를 지었다고 효율이 저절로 오르지 않는다: 연구를 고르고, 인력·자리가 맞고, 실증을 거쳐야 한다. */
  const RS = { uniStaff: 2, uniPrepW: 4, labStaff: 1, labSeats: 3, labOpexW: 0.3, labOpexR: 3, roundSteps: 3, retroBat: 1 };
  const TECHS = [
    { id: "bms", name: "배터리 상태 진단·고효율 변환", bundle: "저장·전력변환", need: 6, demo: 3, get eff() { return bmsEffectText(); }, get why() { return `잔량을 정확히 읽어 안전 여유를 줄이고, 충전·방전 손실을 줄여요. ${bmsEffectText()}. 도입 때 배터리마다 개조비 ${fmt(RS.retroBat, 1)}억`; }, grade: "M·G" },
    { id: "grid", name: "스마트 송전 운영", bundle: "전력망", need: 8, demo: 4, eff: "송전 손실 1.5%/칸 → 1.0%/칸", why: "선로 상태를 실시간으로 보고 손실이 적은 길로 보낸다", grade: "M·G" },
    { id: "fcst", name: "기상·수요 예측", bundle: "예측·진단", need: 6, demo: 2, eff: "배터리를 저녁 피크(17–22시)용으로 아껴 쓴다 · 리그: 사건 예보 범위가 좁아진다", why: "예측은 날씨를 바꾸지 않는다 — 언제 쓸지 고르는 정보를 준다", grade: "M·G" }
  ];
  // 혼자 하기: 운영 기간(주) 안에서 연구가 어디까지 가는지. 시험 운전마다 처음부터(운영해도 연구가 쌓이지 않는다).
  function researchRun(st, weeks) {
    const unis = st.builds.filter(b => b.t === "uni").length, labs = st.builds.filter(b => b.t === "lab").length;
    const nb = st.builds.filter(b => b.t === "battery").length, q = (st.rq || []).filter(id => TECHS.some(T => T.id === id));
    const prog = {}, stage = {}, adoptW = {}, log = [], cost = { opex: 0, demo: 0 };
    let demoLeft = {};
    for (let w = 0; w < weeks; w++) {
      Object.keys(demoLeft).forEach(id => { if (--demoLeft[id] <= 0) { stage[id] = "done"; adoptW[id] = w; delete demoLeft[id]; log.push({ w, id, ev: "adopt" }); } });
      const staff = labs * RS.labStaff + (w >= RS.uniPrepW ? unis * RS.uniStaff : 0), seats = labs * RS.labSeats, eff = Math.min(staff, seats);
      cost.opex += labs * RS.labOpexW;
      const cur = q.find(id => !stage[id]);
      if (cur && eff > 0) {
        const T = TECHS.find(x => x.id === cur);
        prog[cur] = (prog[cur] || 0) + eff;
        if (prog[cur] >= T.need) { stage[cur] = "demo"; demoLeft[cur] = 1; cost.demo += T.demo + (cur === "bms" ? nb * RS.retroBat : 0); log.push({ w, id: cur, ev: "demo" }); }
      }
    }
    return { unis, labs, staff: labs * RS.labStaff + unis * RS.uniStaff, seats: labs * RS.labSeats, prog, stage, adoptW, log, cost: { opex: Math.round(cost.opex * 100) / 100, demo: cost.demo, total: Math.round((cost.opex + cost.demo) * 100) / 100 } };
  }
  let BLD = BLD0;
  // 급전 발전원: 용량, 최소 출력, 연료비(억/MWh), CO₂(t/MWh)
  // 석탄: 최소 출력 30%(멈추기 어렵다), 연료비 싸고 CO₂ 많다. 리그에서는 외부 연결점이 수입하지 않고 이웃과의 거래로만 오간다.
  // 석탄 M: LNG×0.56 [S16] REF 7.1; 수입 CO₂: normalCo2의 국가 계수(D-73).
  const dispOf = kind => (kind === "lng" ? { cap: 9.5, min: 0, fuel: 0.008, co2: 0.37 } : kind === "coal" ? { cap: 20, min: 6, fuel: 0.0045, co2: 0.82 } : kind === "import" ? { cap: LG ? 0 : (PK.gridCap || 4) / Math.max(1, SITES.filter(s => s.kind === "gridpt").length), min: 0, fuel: 0.012, co2: KCP.ECON_DATA.params.normalCo2.v }
    : kind === "diesel" ? { cap: 3, min: 1, fuel: (PK.fuel && PK.fuel.diesel) || 0.01, co2: 0.75 } : { cap: 2, min: 0.5, fuel: 0.02, co2: 0, bioCo2: 0.1 });
  const biomassFuel = tile => TILES[tile].livestock ? 0.012 : dispOf("biomass").fuel;
  const CLEAR_COST = 2;
  const lineUnit = () => PK.lineCost || 0.5;
  // 계산에 쓰는 기존 개선 비율(2/3)을 그대로 표시한다. 지도별 손실률을 고정 문구로 덮지 않는다.
  const gridLossPerHex = () => (PK.lossPerHex || M.lossPerHex) * (2 / 3);
  function bmsParams() {
    const p = KCP.TECH_DATA?.params;
    // 자료 키가 아직 없는 판에서는 기존 계산값을 유지한다(REF 8.6).
    return { floor: p?.bmsFloor?.v ?? 0.05, efficiency: p?.bmsEfficiency?.v ?? 0.933 };
  }
  function bmsEffectText() {
    const p = bmsParams();
    return `잔량 하한 ${fmt(M.socFloor * 100)}% → ${fmt(p.floor * 100)}% · 왕복 효율 ${fmt(M.batEff ** 2 * 100)}% → ${fmt(p.efficiency ** 2 * 100)}%(한 방향 약 ${fmt(p.efficiency * 100, 1)}%)`;
  }
  const gridEffectText = () => `송전 손실 ${fmt(100 * (PK.lossPerHex || M.lossPerHex), 2)}%/칸 → ${fmt(100 * gridLossPerHex(), 2)}%/칸`;
  const cityName = (pack = PK) => KCP.ECON_DATA?.start?.[pack.id]?.name ||
    Object.values(KCP.LEAGUE_REGIONS || {}).flatMap(r => r.teams).find(t => t.pack === pack.id)?.name || pack.name;
  const WX = [{ k: "sun", name: "맑음" }, { k: "cloud", name: "흐림" }, { k: "rain", name: "비" }];
  const TR = [[0.62, 0.28, 0.10], [0.35, 0.42, 0.23], [0.30, 0.42, 0.28]];
  // 평택 계절 날씨: 달마다 맑음·흐림·비 비율(7월 장마)
  const PW = [[.55, .35, .10], [.55, .33, .12], [.50, .35, .15], [.55, .30, .15], [.55, .30, .15], [.40, .35, .25], [.20, .35, .45], [.35, .35, .30], [.50, .30, .20], [.65, .25, .10], [.50, .35, .15], [.50, .38, .12]];
  const POLICIES = [
    { id: "tax", name: "탄소세", icon: "co2", eff: () => "CO₂ 값 매김 (디젤 ×1.5)", cost: "0억/일" },
    { id: "dr", name: "수요반응 계약", icon: "clock", eff: () => demandResponseText(), cost: "0.05억/일" },
    { id: "share", name: "주민 이익공유", icon: "people", eff: () => {
      const remaining = 1 - (KCP.ECON_DATA?.params.shareRelief?.v ?? 0.5);
      return `풍력·태양광 민원 ${remaining === 0.5 ? "½" : fmt(remaining * 100, 1) + "%"}`;
    }, cost: "0.1억/일" },
    { id: "save", name: "절전 캠페인", icon: "bolt", eff: () => `수요 −${fmt(M.save * 100)}% · 만족 −${fmt(KCP.ECON_DATA?.params.saveSatPenalty?.v ?? 5)}`, cost: "0억/일" }
  ];
  const costTarget = days => Math.round(PK.goals.costBase + PK.goals.costPerDay * days);
  const MISSIONS = [
    { id: "outage", name: "정전 최소", icon: "bolt", goal: () => "못 보낸 전력 ≤ 0.5% · 병원 0시간" },
    { id: "cost", name: "비용 최소", icon: "coin", goal: () => `총비용 ≤ ${PK.goals.costBase}억 + ${PK.goals.costPerDay}억×일수` },
    { id: "co2", name: "CO₂ 최소", icon: "co2", goal: () => `하루 평균 ≤ ${PK.goals.co2Day} t` },
    { id: "complaint", name: "주민 민원 최소", icon: "alert", goal: () => "민원 ≤ 1건 · 최저 만족 ≥ 60" }
  ];
  const TIPS0 = [
    "송전 손실은 거리에 비례해 쌓인다 — 발전소를 수요지 가까이?",
    "풍속이 2배면 풍력 출력은 약 8배(v³).",
    "태양광은 저녁 피크 전에 끝난다 — 배터리가 시간을 옮긴다.",
    "전력량(MWh) = 전력(MW) × 시간(h).",
    "한 전원에만 기대면 그 조건이 무너질 때 다 멈춘다.",
    "평균에 강한 계획 ≠ 최악의 날에 강한 계획.",
    "결론 먼저, 근거는 두세 개.",
    "얻는 것과 잃는 것을 한 문장에 함께.",
    "배터리는 전기를 만들지 않는다 — 남는 전기를 옮길 뿐.",
    "충전·방전마다 조금씩 잃는다(여기서는 각 95%).",
    "흐린 날 태양광은 맑은 날의 절반도 안 된다.",
    "버린 전력도 비용이다 — 건설비는 이미 냈다.",
    "짧게 보면 연료가 싸고, 길게 보면 연료 없는 발전이 싸질 수 있다.",
    "전기가 모자라면 병원은 마지막까지 받는다 — 우선순위가 있다."
  ];
  const tips = () => (PK.tips || []).concat(TIPS0);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 90일치를 항상 같은 순서로 뽑는다(1주는 1달의 앞부분과 같다).
  function weather(seed, season) {
    const rnd = mulberry32(seed >>> 0), out = [], C = PK.climate;
    const s = SEASONS.find(x => x.id === season) || SEASONS[1];
    let w = 0, sunny = 0;
    for (let d = 0; d < 90; d++) {
      const u = rnd(), u2 = C ? rnd() : 1;
      const doy = C ? (MSTART[s.m] + d) % 365 : 0, m = C ? monthOf(doy) : -1;
      if (C) {
        const p = PW[m];
        if (d === 0 || u2 > 0.45) w = u < p[0] ? 0 : u < p[0] + p[1] ? 1 : 2;
      } else if (d > 0) { const p = TR[w]; w = u < p[0] ? 0 : u < p[0] + p[1] ? 1 : 2; }
      let mult = 0.5 + rnd();
      if (w === 2) mult = Math.min(1.5, mult + 0.15);
      const r3 = rnd();
      const day = { w, mult, noise: [], m, doy };
      if (C) {
        day.tmax = C.temp_c[m] + 5 + (r3 - 0.5) * 6 + (w === 0 ? 1.5 : w === 2 ? -2.5 : 0);
        day.hot = day.tmax > 28;
        day.coolF = 0.15 + clamp((day.tmax - 28) * 0.025, 0, 0.1);
        day.winter = m === 11 || m <= 1;
        sunny = w === 0 ? sunny + 1 : 0;
        day.flow = w === 2 ? 1.3 : w === 1 ? 1.0 : sunny >= 3 ? 0.7 : 0.85;
        const sunnyStay = 0.45 + 0.55 * PW[m][0];
        day.flowMean = PW[m][0] * (0.85 - 0.15 * sunnyStay ** 2) + PW[m][1] + PW[m][2] * 1.3;
        // 일사: 그 달 GHI × 성능비 0.8을 날씨 비율로 나눠 월평균을 맞춘다. 낮 길이는 위도·적위로.
        const dec = 23.44 * Math.sin(2 * Math.PI * (284 + doy + 1) / 365) * Math.PI / 180, lat = C.lat * Math.PI / 180;
        day.dayLen = (2 / 15) * Math.acos(clamp(-Math.tan(lat) * Math.tan(dec), -1, 1)) * 180 / Math.PI;
        const ew = PW[m][0] * M.wxSun[0] + PW[m][1] * M.wxSun[1] + PW[m][2] * M.wxSun[2];
        day.eDay = C.ghi_kwh_m2_day[m] * M.pvYield * M.wxSun[w] / ew;
      } else day.hot = r3 < (w === 0 ? 0.5 : w === 1 ? 0.15 : 0);
      for (let h = 0; h < 24; h++) day.noise.push(1 + (rnd() * 2 - 1) * 0.15);
      out.push(day);
    }
    return out;
  }
  // 시간별 수요(MW). ctx: 그날 날씨 하루치와 정책, 증설 여부
  const IND_KIND = { factory_big: 1, industry: 1, port: 1 };
  function demand(ti, h, day, pol, fab2) {
    const W = TOWNS[ti], D = W.dem, inR = (a, b) => h >= a && h < b;
    let v = D.base;
    if (fab2 && D.fab2) v = D.fab2;
    if (D.day && inR(D.day.from, D.day.to)) v = D.day.v;
    if (D.add) D.add.forEach(a => { if (inR(a.from, a.to) && (!a.months || a.months.includes(day.m))) v += a.v; });
    if (D.morn && inR(7, 9)) v += D.morn;
    if (D.eve && inR(18, 22)) v += D.eve;
    if (D.off && inR(D.off.from, D.off.to)) v = 0;
    if (PK.hotAll) { if (day.hot && inR(13, 18)) v *= 1.15; }
    else {
      if (D.cool && day.hot && inR(13, 18)) v *= 1 + day.coolF;
      if (D.hotAdd && day.hot) v += D.hotAdd;
      if (D.heat && day.winter && inR(18, 22)) v *= 1.1;
    }
    if (MODS && MODS.demandMul && (!MODS.demandHours || inR(MODS.demandHours[0], MODS.demandHours[1]))) v *= MODS.demandMul;
    // 경제(리그 달 턴): 주민 수·산업 규모가 바뀐 만큼 마을·산업 수요가 따라 바뀐다.
    if (MODS && (MODS.demandRes || MODS.demandInd)) v *= IND_KIND[W.kind] ? MODS.demandInd || 1 : MODS.demandRes || 1;
    if (D.dr && pol.dr && inR(18, 21)) v = Math.max(0.1 * v, v - (D.dr === true ? 1.5 : D.dr) * (MODS && MODS.drEffect || 1));
    if (pol.save) v *= 1 - M.save;
    return v;
  }
  const PLAIN_DAY = { w: 0, hot: false, m: 6, coolF: 0, winter: false };
  const outageCut = dem => PK.climate ? Math.max(0.005, 0.02 * dem) : 0.05;
  const peakDemand = (pol, fab2) => { let p = 0; for (let h = 0; h < 24; h++) p = Math.max(p, TOWNS.reduce((a, W, ti) => a + demand(ti, h, PLAIN_DAY, pol, fab2), 0)); return p; };
  const polOf = st => ({ tax: st.policies.includes("tax"), dr: st.policies.includes("dr"), share: st.policies.includes("share"), save: st.policies.includes("save") });
  // HUD와 같은 보통 날의 하루 최대 수요를 비교한다. 저녁 계약량의 합은 하루 피크 감축이 아니다.
  function demandResponseText() {
    if (!S) return PK.drText;
    const previous = MODS;
    try {
      MODS = leagueMods(S.st);
      const pol = polOf(S.st), fab2 = PK.climate && S.st.fab2;
      const cut = peakDemand({ ...pol, dr: false }, fab2) - peakDemand({ ...pol, dr: true }, fab2);
      return `${PK.drText} · 하루 피크 −${fmt(Math.max(0, cut), 2)} MW(보통 날)`;
    } finally { MODS = previous; }
  }
  function previewPeak(st) {
    const previous = MODS;
    try { MODS = leagueMods(st); return peakDemand(polOf(st), PK.climate && st.fab2); }
    finally { MODS = previous; }
  }

  const stepMul = T => (T.out ? Infinity : T.t === "sea" || T.t === "lake" ? 3 : T.t === "mount" || T.t === "river" ? 2 : 1);
  const buildCost = (t, i) => BLD[t].cost + (TILES[i].t === "forest" ? CLEAR_COST : 0);
  function lineCost(p) { let s = 0; for (let k = 1; k < p.length; k++) s += lineUnit() * stepMul(TILES[p[k]]); return s; }
  const capex = st => st.builds.reduce((a, b) => a + (LG && Number.isFinite(b.paidCost) ? b.paidCost : buildCost(b.t, b.i)), 0) + st.lines.reduce((a, L) => a + lineCost(L.p), 0);
  const toolsOf = () => (PK.groups ? PK.groups.flatMap(g => g.tools) : PK.tools).concat(LG && KCP.TECH_DATA ? Object.keys(BLD).filter(k => BLD[k].tech) : []);
  // 이 타일에 이 발전원을 지을 수 있나(예산 제외)
  function siteRule(type, T) {
    const B = BLD[type];
    if (!B || !toolsOf().includes(type)) return "못 지음";
    if (T.out) return "지도 밖";
    if (type === "smr" && T.t !== "river" && T.t !== "beach") return "냉각수: 해안·하천만";
    if (B.sea) return (B.sea === "offshore" ? T.offshore : T.tidal) ? "" : B.sea === "tidal" ? (PK.tidalNote || "조력: 항구 가까운 연안 바다만") : "해상풍력: 연안 2칸 바다만";
    if (T.t === "sea") return "바다에는 못 지음";
    if (T.site >= 0) { const k = SITES[T.site].kind; return B.roof && k !== "plant" && k !== "gridpt" && T.t === "urban" ? "" : "시설 자리"; }
    if (T.t === "town") return "마을 자리";
    if (!B.ok[T.t]) return T.t === "mount" ? "산 능선: 풍력만" : B.roof ? "지붕 태양광: 도시만" : type === "hydro" ? "소수력: 하천만" : T.water ? "물 위에는 못 지음" : "못 지음";
    return "";
  }

  // 가장 싼 육각 경로(육지 1, 산·하천 2, 바다·호수 3, 인접 지역 불가)
  function routePath(a, b) {
    const N = TILES.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    dist[a] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === b) break;
      done[u] = 1;
      for (const v of TILES[u].nb) {
        const nd = dist[u] + stepMul(TILES[v]);
        if (nd < dist[v] - 1e-9) { dist[v] = nd; prev[v] = u; }
      }
    }
    if (!isFinite(dist[b])) return null;
    const p = [b];
    while (p[0] !== a) p.unshift(prev[p[0]]);
    return p;
  }

  // 송전망: 선이 지나는 타일이 연결 그래프. 건물·시설은 선 위에 있거나 선 끝과 이웃하면 붙는다.
  // 같은 타일의 건물과 시설(지붕 태양광)은 선 없이 바로 이어진다.
  function network(st) {
    const adj = new Map(), edges = [], eKey = new Map(), ends = new Set();
    const touch = a => { if (!adj.has(a)) adj.set(a, new Set()); };
    const link = (a, b) => {
      touch(a); touch(b);
      adj.get(a).add(b); adj.get(b).add(a);
      const k = a < b ? a + "-" + b : b + "-" + a;
      if (!eKey.has(k)) { eKey.set(k, edges.length); edges.push([Math.min(a, b), Math.max(a, b)]); }
    };
    st.lines.forEach(L => { for (let k = 1; k < L.p.length; k++) link(L.p[k - 1], L.p[k]); ends.add(L.p[0]); ends.add(L.p[L.p.length - 1]); });
    const lineT = new Set(adj.keys());
    const nodes = [];
    SITES.forEach((s, si) => {
      if (s.dem) nodes.push({ kind: "town", tile: s.tile, ti: s.ti, si, skind: s.kind });
      else if (s.kind === "plant") nodes.push({ kind: s.fuel === "coal" ? "coal" : "lng", tile: s.tile, si, cap: s.cap || 9.5 });
      else if (s.kind === "gridpt") nodes.push({ kind: "import", tile: s.tile, si });
    });
    st.builds.forEach((B, bi) => { if (!BLD[B.t] || BLD[B.t].cls !== "inst") nodes.push({ kind: B.t, tile: B.i, bi }); });
    const per = new Map();
    nodes.forEach(n => per.set(n.tile, (per.get(n.tile) || 0) + 1));
    per.forEach((c, t) => { if (c > 1) touch(t); });
    const lab = new Map();
    let nc = 0;
    adj.forEach((_, s) => {
      if (lab.has(s)) return;
      const q = [s]; lab.set(s, nc);
      while (q.length) { const u = q.pop(); adj.get(u).forEach(v => { if (!lab.has(v)) { lab.set(v, nc); q.push(v); } }); }
      nc++;
    });
    const par = Array.from({ length: nc }, (_, i) => i);
    const find = x => (par[x] === x ? x : (par[x] = find(par[x])));
    nodes.forEach(n => {
      n.att = [];
      if (adj.has(n.tile)) n.att.push([n.tile, 0]);
      TILES[n.tile].nb.forEach(j => { if (ends.has(j) || PK.attachAny && lineT.has(j)) n.att.push([j, 1]); });
      const cs = n.att.map(a => lab.get(a[0]));
      for (let k = 1; k < cs.length; k++) { const A = find(cs[0]), B = find(cs[k]); if (A !== B) par[A] = B; }
    });
    // 두 선에 함께 붙은 시설·건물은 그 사이를 이어 준다(전기가 시설을 거쳐 흐를 수 있다).
    nodes.forEach(n => {
      for (let x = 0; x < n.att.length; x++) for (let y = x + 1; y < n.att.length; y++) {
        const A = n.att[x][0], B = n.att[y][0];
        if (A !== B) { adj.get(A).add(B); adj.get(B).add(A); }
      }
    });
    const comps = new Map();
    nodes.forEach(n => {
      n.comp = n.att.length ? find(lab.get(n.att[0][0])) : -1;
      if (n.comp < 0) return;
      if (!comps.has(n.comp)) comps.set(n.comp, { towns: [], ren: [], bat: [], disp: [] });
      const C = comps.get(n.comp);
      if (n.kind === "town") C.towns.push(n);
      else if (isStorage(n)) C.bat.push(n);
      else if (n.kind === "lng" || n.kind === "coal" || n.kind === "import" || BLD[n.kind] && BLD[n.kind].cls === "disp") C.disp.push(n);
      else C.ren.push(n);
    });
    function bfs(n) {
      const dist = new Map(), from = new Map(), q = [];
      n.att.forEach(([t, d]) => { if (!dist.has(t) || dist.get(t) > d) { dist.set(t, d); from.set(t, -1); q.push(t); } });
      while (q.length) {
        q.sort((x, y) => dist.get(y) - dist.get(x));
        const u = q.pop(), du = dist.get(u);
        adj.get(u).forEach(v => { if (!dist.has(v) || dist.get(v) > du + 1) { dist.set(v, du + 1); from.set(v, u); q.push(v); } });
      }
      return { dist, from };
    }
    nodes.forEach(n => { if (n.att.length) n.bf = bfs(n); });
    function pair(g, l) {
      let best = Infinity, bt = -1;
      l.att.forEach(([t, dl]) => { const dg = g.bf.dist.get(t); if (dg !== undefined && dg + dl < best) { best = dg + dl; bt = t; } });
      if (bt < 0) return null;
      const path = [];
      let u = bt;
      while (g.bf.from.get(u) !== -1) {
        const p = g.bf.from.get(u);
        const e = eKey.get(p < u ? p + "-" + u : u + "-" + p);
        if (e !== undefined) path.push([e, p < u ? 1 : -1]);
        u = p;
      }
      return { g, l, d: best, eff: Math.max(0.4, 1 - (PK.lossPerHex || M.lossPerHex) * best), path };
    }
    comps.forEach(C => {
      const mk = (gs, ls) => { const out = []; gs.forEach(g => ls.forEach(l => { const P = pair(g, l); if (P) out.push(P); })); return out; };
      C.RL = mk(C.ren, C.towns);
      C.RB = mk(C.ren, C.bat).sort((a, b) => a.d - b.d);
      C.BL = mk(C.bat, C.towns);
      C.DL = mk(C.disp, C.towns);
    });
    nodes.forEach(n => {
      const C = n.comp >= 0 ? comps.get(n.comp) : null;
      n.live = !!C && (n.kind === "town" ? C.ren.length + C.bat.length + C.disp.length > 0 : C.towns.length > 0);
    });
    return { adj, edges, nodes, comps: Array.from(comps.values()), ends };
  }

  const SMOKY = { diesel: 1, biomass: 1 };
  function complaints(st, runFrac) {
    const share = st.policies.includes("share"), items = [];
    const residential = ["village", "town_s", "city", "city_m", "city_l"];
    const receptors = [...residential, "hospital", "school"];
    TOWNS.forEach((W, ti) => {
      const farm = ["farm", "livestock"].includes(W.kind);
      if (!receptors.includes(W.kind) && !farm) return;
      st.builds.forEach((B, bi) => {
        const d = hexDist(B.i, W.tile), f = runFrac ? runFrac[bi] || 0 : 0.6;
        const add = (kind, pts) => items.push({ ti, kind, bi, src: B.t, pts: pts * (share && ["noise", "view"].includes(kind) && ["wind", "offshore", "solar"].includes(B.t) ? 0.5 : 1) });
        if (["diesel", "biomass"].includes(B.t)) {
          if (!farm && d <= 3) add("smoke", (B.t === "diesel" ? 30 : 12) * (d <= 1 ? 1 : d === 2 ? 0.6 : 0.3) * f);
          else if (B.t === "diesel" && d <= 1) add("noise", 6 * f);
        } else if (B.t === "wind") {
          if (d <= 1) add("noise", 14);
          else if (d === 2) add("view", 3);
        } else if (B.t === "offshore") {
          if (d <= 3 && residential.includes(W.kind)) add("view", 2);
        } else if (B.t === "solar" && d <= 1) add("view", ["city", "city_m", "city_l"].includes(W.kind) ? 2 : 4);
      });
    });
    // 숲 훼손은 인접 수용자 수로 중복하지 않고 설비마다 한 번 기록한다.
    st.builds.forEach((B, bi) => {
      if (TILES[B.i].t !== "forest") return;
      const near = TOWNS.map((W, ti) => ({ W, ti, d: hexDist(B.i, W.tile) }))
        .filter(x => receptors.includes(x.W.kind) && x.d <= 3).sort((a, b) => a.d - b.d || a.ti - b.ti)[0];
      if (near) items.push({ ti: near.ti, kind: "green", bi, src: B.t, pts: 3 });
    });
    const groups = new Map();
    items.forEach(it => {
      const k = it.ti + ":" + it.kind, G = groups.get(k) || { pts: 0, top: null };
      G.pts += it.pts;
      if (!G.top || it.pts > G.top.pts) G.top = it;
      groups.set(k, G);
    });
    let issues = 0;
    const list = [];
    groups.forEach((G, k) => { if (G.pts >= 5) { issues++; const [ti, kind] = k.split(":"); list.push({ ti: +ti, kind, pts: G.pts, src: st.builds[G.top.bi].t }); } });
    list.sort((a, b) => b.pts - a.pts);
    return { items, issues, list };
  }

  // 시간 h의 재생 출력(MW). 섬은 예전 식, 평택은 달마다 기후 자료를 쓴다.
  function renOut(g, day, h, k) {
    const v0 = renOut0(g, day, h, k);
    if (!MODS) return v0;
    const m = ["solar", "roof", "tandem", "tandem_roof"].includes(g.kind) ? MODS.solarMul : g.kind === "wind" ? MODS.windMul : g.kind === "offshore" ? MODS.offshoreMul : g.kind === "tidal" ? MODS.tidalMul : null;
    let v = typeof m === "number" ? v0 * m : v0;
    // B18 손잡이가 없으면 기존 계산·반환 자료를 그대로 유지한다.
    if (MODS.reCap && BLD[g.kind] && BLD[g.kind].hostLimited) {
      v *= clamp((MODS.reCap[g.kind + ":" + g.tile] || 0) / BLD[g.kind].mw, 0, 1);
    }
    if (MODS.renewOutput) v *= MODS.renewOutput;
    return v;
  }
  function renOut0(g, day, h, k) {
    const T = TILES[g.tile], B = BLD[g.kind], C = PK.climate, vMul = day.mult * day.noise[h];
    if (["solar", "roof", "tandem", "tandem_roof"].includes(g.kind)) {
      if (!C) { const sp = h >= 6 && h < 18 ? Math.max(0, Math.sin(Math.PI * (h + 0.5 - 6) / 12)) : 0; return B.mw * sp * M.wxSun[day.w] * T.sun; }
      const N = day.dayLen, rise = 12 - N / 2, x = (h + 0.5 - rise) / N;
      if (x <= 0 || x >= 1) return 0;
      return B.mw * Math.min(1, day.eDay * Math.PI / (2 * N) * Math.sin(Math.PI * x) * T.sun);
    }
    if (g.kind === "wind" || g.kind === "offshore") {
      let v;
      if (!C) v = T.wind * vMul;
      else v = (T.t === "sea" ? C.wind100_sea[day.m] * T.seaF : C.wind10_land[day.m] * C.hub_factor_land + T.woff) * vMul;
      if (v > M.cutout) return 0;
      if (!C) return B.mw * Math.min(1, (v / M.rated) ** 3);
      return v < M.cutin ? 0 : B.mw * Math.min(1, (v ** 3 - M.cutin ** 3) / (M.rated ** 3 - M.cutin ** 3));
    }
    if (g.kind === "tidal") return B.mw * 0.31 * Math.abs(Math.sin(2 * Math.PI * (k + 3) / M.tidalPeriod));
    if (g.kind === "hydro") {
      const rain = C?.precip_mm, q = rain ? 0.5 + 0.5 * rain[MODS?.hydroMonth != null ? MODS.hydroMonth - 1 : day.m] / (rain.reduce((a, v) => a + v, 0) / 12) : 1;
      return B.mw * Math.min(1, 0.25 * q * (day.flow || 1) / (day.flowMean || 1));
    }
    return 0;
  }

  // opt.league: 외부 연결점이 붙은 덩어리마다 시간별 부족·남는 재생·남는 화력 여유를 따로 적는다(도시 사이 정산용).
  function simulate(st, days, opt) {
    MODS = opt && opt.mods ? opt.mods : null;
    try { return simulate0(st, days, opt); } finally { MODS = null; }
  }
  const isStorage = g => !!(BLD[g.kind] && BLD[g.kind].cls === "bat");
  const storedMWh = g => BLD[g.kind].mwh || M.batMWh;
  const storedMW = g => BLD[g.kind].mw || M.batMW;
  const storedStart = g => g.kind === "h2store" ? 0 : storedMWh(g) * 0.5;
  const storedFloor = g => g.kind === "h2store" ? 0 : storedMWh(g) * M.socFloor;
  const storedCeiling = g => storedMWh(g) * (g.kind !== "h2store" && MODS && MODS.essCap != null ? clamp(MODS.essCap, 0, 1) : 1);
  const storedEff = (g, eff) => g.kind === "h2store" ? Math.sqrt(KCP.TECH_DATA.params.h2Efficiency.v) : eff;
  function simulate0(st, days, opt) {
    const N = network(st), W = weather(st.seed, st.season), H = days * 24, pol = polOf(st), NT = TOWNS.length;
    const lgOut = !!(opt && opt.league);
    const fab2 = !!(PK.climate && st.fab2);
    const gens = N.nodes.filter(n => n.kind !== "town");
    const E = N.edges.length;
    // 연구: 혼자 하기는 이 운영 기간 안의 진척(주 단위), 리그는 진행자가 정한 도입 목록(opt.mods.tech)을 처음부터.
    const RR = lgOut ? null : researchRun(st, Math.ceil(days / 7));
    const techDay = {};
    if (RR) Object.keys(RR.adoptW).forEach(id => { techDay[id] = RR.adoptW[id] * 7; });
    else ((opt && opt.mods && opt.mods.tech) || []).forEach(id => { techDay[id] = 0; });
    let bEff = M.batEff, fcst = false;
    const batCeiling = MODS && MODS.essCap != null ? M.batMWh * clamp(MODS.essCap, 0, 1) : M.batMWh;
    const curtail = MODS && MODS.curtailP != null;
    // 대학·연구소 전력 수요: 가장 가까운 마을에 더한다.
    const instLoad = new Float32Array(TOWNS.length);
    st.builds.forEach(B => {
      const D = BLD[B.t];
      if (!D || D.cls !== "inst" || !D.load) return;
      let best = -1, bd = Infinity;
      SITES.forEach(s0 => { if (!s0.dem) return; const d = (TILES[s0.tile].X - TILES[B.i].X) ** 2 + (TILES[s0.tile].Y - TILES[B.i].Y) ** 2; if (d < bd) { bd = d; best = s0.ti; } });
      if (best >= 0) instLoad[best] += D.load;
    });
    const flow = new Float32Array(Math.max(1, H * E));
    const hrDem = new Float32Array(H), hrSup = new Float32Array(H), hrUns = new Float32Array(H * NT), hrWind = new Float32Array(H), hrDiesel = new Uint32Array(H);
    const townDemand = lgOut ? new Float64Array(H * NT) : null;
    const town = TOWNS.map(() => ({ dem: 0, uns: 0, outH: 0, eveH: 0, cloudH: 0, hotH: 0, dayOut: new Float32Array(days) }));
    const tot = { diesel: 0, waste: 0, curt: 0, loss: 0, ren: 0, renAvail: 0, idle: 0, batOut: 0, dem: 0, sup: 0, by: { lng: 0, coal: 0, import: 0, diesel: 0, biomass: 0 }, fuel: 0, co2: 0, bioCo2: 0, h2mixMWh: 0 };
    if (curtail) { tot.curtailMWh = 0; tot.curtailCapturedMWh = 0; }
    let dk = 0;
    gens.forEach(g => {
      g.runH = 0;
      if (isStorage(g)) { g.soc = Math.min(storedCeiling(g), storedStart(g)); g.floor = storedFloor(g); }
      if (SMOKY[g.kind]) g.dk = dk++;
      const D = g.kind === "smr" ? { cap: KCP.TECH_DATA.params.smrMW.v, min: KCP.TECH_DATA.params.smrMW.v * KCP.TECH_DATA.params.smrMin.v, fuel: KCP.TECH_DATA.params.smrFuel.v, co2: 0 } : g.kind === "lng" || g.kind === "coal" || g.kind === "import" || SMOKY[g.kind] ? dispOf(g.kind) : null;
      if (D) {
        if (g.kind === "lng" || g.kind === "coal") D.cap = g.cap;
        if (g.kind === "coal") D.min = 0.3 * g.cap;
        if (MODS && g.kind === "coal" && MODS.coalCapMul != null) { D.cap *= MODS.coalCapMul; D.min = Math.min(D.min, D.cap); }
        if (MODS && g.kind === "lng" && MODS.lngCapMul != null) D.cap *= MODS.lngCapMul;
        if (g.kind === "biomass") D.fuel = biomassFuel(g.tile);
        if (MODS && MODS.co2Mul && MODS.co2Mul[g.kind]) D.co2 *= MODS.co2Mul[g.kind];
        if (MODS && (MODS.disabledBuilds || []).includes(g.kind + ":" + g.tile)) { D.cap = 0; D.min = 0; }
        g.D = D;
        if (g.kind === "smr") tot.by.smr = 0;
        // 국제 연료 가격 지수(경제 모드): MODS.fuelMul = {lng, diesel, coal}
        g.mc = D.fuel * ((MODS && MODS.fuelMul && MODS.fuelMul[g.kind]) || 1) + (pol.tax ? D.co2 * M.taxPerT : 0);
      }
    });
    const shed = st.shed === "industry" ? SHED.industry : SHED.home, equal = st.shed === "equal";
    const prio = n => (equal ? 0 : shed[n.skind] != null ? shed[n.skind] : 5);
    N.comps.forEach(C => {
      C.towns.forEach(n => { n.prio = prio(n); });
      const byPrio = (a, b) => (a.l.prio - b.l.prio) || (a.d - b.d);
      C.RL.sort(byPrio); C.BL.sort(byPrio);
      C.DL.sort((a, b) => (a.g.mc - b.g.mc) || byPrio(a, b));
    });
    const addFlow = (P, sent, k) => { const o = k * E; for (const [e, s] of P.path) flow[o + e] += s * sent; };
    const hrHosp = new Uint8Array(H), hrHospDem = new Float32Array(H), hrHospUns = new Float32Array(H), hospTi = TOWNS.map(W => W.kind === "hospital");
    const GX = !lgOut ? [] : N.comps.filter(C => C.disp.some(u => u.kind === "import")).map(C => {
      const own = C.disp.filter(u => u.kind !== "import"), capT = own.reduce((a, u) => a + u.D.cap, 0);
      // 거래 CO₂의 co2i와 같은 설비 용량 가중. 실제 시간별 head 가중으로 바꾸면 회계가 달라진다.
      const byHead = {}, byDisp = {};
      own.forEach(u => {
        byHead[u.kind] = (byHead[u.kind] || 0) + (capT > 0 ? u.D.cap / capT : 0);
        byDisp[u.kind] = new Float64Array(H);
      });
      const to = [];
      C.disp.forEach(u => { if (u.kind === "import") (SITES[u.si].to || []).forEach(x => { if (!to.includes(x)) to.push(x); }); });
      return {
        C, own, to, byHead, byDisp, def: new Float32Array(H), ren: new Float32Array(H), head: new Float32Array(H),
        disp: new Float32Array(H), dmc: new Float32Array(H), dco2: new Float32Array(H),
        mc: capT > 0 ? own.reduce((a, u) => a + u.mc * u.D.cap, 0) / capT : Infinity,
        co2i: capT > 0 ? own.reduce((a, u) => a + u.D.co2 * u.D.cap, 0) / capT : 0,
        bioCo2i: capT > 0 ? own.reduce((a, u) => a + (u.D.bioCo2 || 0) * u.D.cap, 0) / capT : 0, dbioCo2: new Float32Array(H)
      };
    });
    for (let d = 0; d < days; d++) {
      const wx = W[d];
      // G · 설계 선택: BMS 왕복 85→87%, 한 방향 0.933 [I13][I14] · REF 8.6
      if (techDay.bms === d) { const bms = bmsParams(); bEff = bms.efficiency; gens.forEach(g => { if (isStorage(g) && g.kind !== "h2store") g.floor = storedMWh(g) * bms.floor; }); }
      if (techDay.fcst === d) fcst = true;
      // 예측: 그날 아침에 오늘 저녁(17–22시) 부족분(수요 − 재생 − 화력 용량)을 미리 계산해 배터리마다 그만큼(여유 10%) 남길 몫을 정한다.
      // 이 모형의 날씨·수요는 정해진 값이라 예측이 맞는다 — 실제 예측에는 오차가 있다(한계).
      if (fcst) N.comps.forEach(C => {
        C.keep = 0;
        if (!C.bat.length || !C.towns.length) return;
        const dcap = C.disp.reduce((a, u) => a + (u.D ? u.D.cap : 0), 0);
        let short = 0;
        for (let h = 17; h < 23; h++) {
          const k = d * 24 + h, dm = C.towns.reduce((a, n) => a + demand(n.ti, h, wx, pol, fab2) + instLoad[n.ti], 0), rn = C.ren.reduce((a, g) => {
            const v = renOut(g, wx, h, k);
            return a + (curtail && BLD[g.kind] && BLD[g.kind].variable ? v * (1 - clamp(MODS.curtailP, 0, 1)) : v);
          }, 0);
          short += Math.max(0, dm - rn - dcap);
        }
        C.keep = Math.min(batCeiling, M.batMWh * M.socFloor + 1.1 * short / C.bat.length / bEff);
      });
      if (techDay.grid === d) N.comps.forEach(C => [C.RL, C.RB, C.BL, C.DL].forEach(L => (L || []).forEach(P => { P.eff = Math.max(0.4, 1 - gridLossPerHex() * P.d); })));
      for (let h = 0; h < 24; h++) {
        const k = d * 24 + h;
        hrWind[k] = wx.mult * wx.noise[h];
        gens.forEach(g => {
          g.av = 0;
          if (isStorage(g)) { g.chg = 0; g.dis = 0; return; }
          if (g.D) { g.out = 0; g.w = 0; g.mixed = 0; return; }
          g.av = renOut(g, wx, h, k);
          if (g.live) tot.renAvail += g.av; else tot.idle += g.av;
          if (curtail) {
            g.cut = BLD[g.kind] && BLD[g.kind].variable ? g.av * clamp(MODS.curtailP, 0, 1) : 0;
            g.av -= g.cut;
          }
        });
        const dem = TOWNS.map((_, ti) => demand(ti, h, wx, pol, fab2) + instLoad[ti]);
        if (townDemand) townDemand.set(dem, k * NT);
        const rem = dem.slice();
        const dem0 = dem.reduce((a, b) => a + b, 0);
        let deliv = 0;
        for (const C of N.comps) {
          // 제어 대상 전력은 같은 망의 자기 ESS가 먼저 받는다. 남은 양은 판매 불가.
          if (curtail) {
            for (const P of C.RB) {
              const g = P.g, b = P.l;
              const room = Math.min(storedMW(b) - b.chg, (storedCeiling(b) - b.soc) / storedEff(b, bEff));
              if (g.cut <= 0 || room <= 0) continue;
              const give = Math.min(g.cut * P.eff, room), sent = give / P.eff;
              g.cut -= sent; b.chg += give; b.soc += give * storedEff(b, bEff);
              tot.loss += sent - give; tot.ren += sent; tot.curtailCapturedMWh += sent; addFlow(P, sent, k);
            }
            C.ren.forEach(g => { tot.curtailMWh += Math.max(0, g.cut); });
          }
          if (!C.towns.length) continue;
          for (const P of C.RL) {
            const g = P.g, ti = P.l.ti;
            if (g.av <= 1e-6 || rem[ti] <= 1e-6) continue;
            const give = Math.min(g.av * P.eff, rem[ti]), sent = give / P.eff;
            g.av -= sent; rem[ti] -= give; deliv += give; tot.loss += sent - give; tot.ren += sent; addFlow(P, sent, k);
          }
          for (const P of C.RB) {
            const g = P.g, b = P.l;
            if (g.av <= 1e-6) continue;
            const room = Math.min(storedMW(b) - b.chg, (storedCeiling(b) - b.soc) / storedEff(b, bEff));
            if (room <= 1e-6) continue;
            const give = Math.min(g.av * P.eff, room), sent = give / P.eff;
            g.av -= sent; b.chg += give; b.soc += give * storedEff(b, bEff); tot.loss += sent - give; tot.ren += sent; addFlow(P, sent, k);
          }
          C.ren.forEach(g => { tot.curt += Math.max(0, g.av); });
          for (const P of C.BL) {
            const b = P.g, ti = P.l.ti;
            if (rem[ti] <= 1e-6 || b.chg > 0) continue;
            // 예측 도입 뒤: 낮(6–16시)에는 오늘 저녁 예상 부족분만큼 남겨 둔다.
            const keep = fcst && h >= 6 && h < 17 && C.keep ? Math.max(b.floor, C.keep) : b.floor;
            const can = Math.min(storedMW(b) - b.dis, (b.soc - keep) * storedEff(b, bEff));
            if (can <= 1e-6) continue;
            const give = Math.min(can * P.eff, rem[ti]), sent = give / P.eff;
            b.dis += sent; b.soc -= sent / storedEff(b, bEff); rem[ti] -= give; deliv += give; tot.loss += sent - give; tot.batOut += sent; addFlow(P, sent, k);
          }
          for (const P of C.DL) {
            const u = P.g, ti = P.l.ti;
            if (rem[ti] <= 1e-6) continue;
            const can = u.D.cap - u.out;
            if (can <= 1e-6) continue;
            const give = Math.min(can * P.eff, rem[ti]), sent = give / P.eff;
            u.out += sent; rem[ti] -= give; deliv += give; tot.loss += sent - give; addFlow(P, sent, k);
          }
          C.disp.forEach(u => {
            if (u.out <= 1e-6) return;
            if (u.out < u.D.min) { u.w = u.D.min - u.out; tot.waste += u.w; u.out = u.D.min; }
            tot.by[u.kind] += u.out; tot.fuel += u.out * u.mc; tot.co2 += u.out * u.D.co2;
            tot.bioCo2 += u.out * (u.D.bioCo2 || 0); u.runH++;
            // F42: 같은 망의 남은 수소만 혼소한다. 이미 방전한 양은 다시 쓰지 않는다.
            if (u.kind === "lng" && MODS?.h2Co2 != null) {
              let need = u.out * (1 - MODS.h2Co2);
              for (const b of C.bat.filter(b => b.kind === "h2store")) {
                const eff = storedEff(b, bEff), used = Math.max(0, Math.min(need, storedMW(b) - b.dis, b.soc * eff));
                b.soc -= used / eff; b.dis += used; need -= used;
                tot.fuel -= used * u.mc; tot.co2 -= used * u.D.co2; u.mixed += used; tot.h2mixMWh += used;
              }
            }
            if (u.dk !== undefined && u.dk < 32) hrDiesel[k] |= 1 << u.dk;
          });
          // 균등: 덩어리 안의 부족분을 수요 비율대로 나눈다(병원도 같은 비율).
          if (equal) {
            let U = 0, D = 0;
            C.towns.forEach(n => { U += Math.max(0, rem[n.ti]); D += dem[n.ti]; });
            if (U > 0.01 && D > 0) C.towns.forEach(n => { rem[n.ti] = dem[n.ti] * U / D; });
          }
        }
        GX.forEach(G => {
          G.def[k] = G.C.towns.reduce((a, n) => a + Math.max(0, rem[n.ti]), 0);
          // 남는 재생 + 최소 출력 때문에 이미 만든(버릴) 화력 = 공짜 잉여. 화력 여유 = 더 돌릴 수 있는 양.
          G.ren[k] = G.C.ren.reduce((a, g) => a + Math.max(0, g.av), 0) + G.own.reduce((a, u) => a + (u.w || 0), 0);
          G.head[k] = G.own.reduce((a, u) => a + Math.max(0, u.D.cap - u.out), 0);
          // 이웃 전기로 바꿀 수 있는 우리 화력 출력(석탄은 최소 출력 아래로 못 내림)과 그 평균 연료비·CO₂
          let dq = 0, dm = 0, dc = 0, db = 0;
          G.own.forEach(u => { const q = Math.max(0, u.out - (u.w || 0) - (u.kind === "coal" || u.kind === "smr" ? u.D.min : 0)); G.byDisp[u.kind][k] += q; dq += q; dm += q * u.mc * (u.out > 0 ? 1 - u.mixed / u.out : 1); dc += q * u.D.co2 * (u.out > 0 ? 1 - u.mixed / u.out : 1); db += q * (u.D.bioCo2 || 0); });
          // dmc/dco2와 같은 대체 가능 출력 구성비. SMR도 분모에 포함하고 PM 입력에서는 뺀다.
          Object.values(G.byDisp).forEach(by => { by[k] = dq > 0 ? by[k] / dq : 0; });
          G.disp[k] = dq; G.dmc[k] = dq > 0 ? dm / dq : 0; G.dco2[k] = dq > 0 ? dc / dq : 0; G.dbioCo2[k] = dq > 0 ? db / dq : 0;
        });
        rem.forEach((r, ti) => {
          const Dt = town[ti];
          if (hospTi[ti]) { hrHospDem[k] += dem[ti]; hrHospUns[k] += Math.max(0, r); if (r > Math.max(0.005, dem[ti] * 0.02)) hrHosp[k] = 1; }
          Dt.dem += dem[ti];
          hrUns[k * NT + ti] = Math.max(0, r);
          if (r > outageCut(dem[ti])) {
            Dt.uns += r; Dt.outH++; Dt.dayOut[d]++;
            if (h >= 17 && h < 23) Dt.eveH++;
            if (wx.w > 0) Dt.cloudH++;
            if (wx.hot) Dt.hotH++;
          } else if (r > 0) Dt.uns += r;
        });
        hrDem[k] = dem0; hrSup[k] = deliv; tot.dem += dem0; tot.sup += deliv;
      }
    }
    tot.diesel = tot.by.diesel;
    // 배터리 시작·끝 잔량(MWh). 시작보다 덜 남았으면 그만큼은 이 기간 발전이 아니라 처음 채워 둔 전기로 쓴 것이다.
    tot.batStart = 0; tot.batEnd = 0;
    gens.forEach(g => {
      if (g.kind === "h2store") { tot.h2End = (tot.h2End || 0) + g.soc; }
      else if (isStorage(g)) { tot.batStart += Math.min(storedCeiling(g), storedStart(g)); tot.batEnd += g.soc; }
    });
    // 배터리는 전기를 만들지 않는다: 끝 잔량이 시작보다 적으면 그 차이를 다시 채우는 값(디젤 연료비·CO₂, 충전 효율 반영)을 이 기간에 물린다.
    tot.batDebt = Math.max(0, tot.batStart - tot.batEnd);
    if (tot.batDebt > 1e-6) { const D = dispOf("diesel"), e = tot.batDebt / bEff; tot.fuel += e * D.fuel; tot.co2 += e * D.co2; }
    const runFrac = st.builds.map((B, bi) => { const g = gens.find(n => n.bi === bi); return g && SMOKY[B.t] ? g.runH / H : 0; });
    const cp = complaints(st, runFrac);
    const cost = {
      capex: capex(st),
      fuel: tot.fuel,
      policy: days * ((pol.dr ? M.drCost * (MODS && MODS.drCost || 1) : 0) + (pol.share ? M.shareCost : 0))
    };
    cost.research = RR ? RR.cost.total : 0;
    cost.total = cost.capex + cost.fuel + cost.policy + cost.research;
    const satisfaction = towns => TOWNS.map((W, ti) => {
      const Dt = towns[ti], K = KIND[W.kind] || { w: 1 };
      const outPen = Math.min(80, (Dt.outH / H) * 300 * K.w + (K.old ? (Dt.hotH / H) * 300 : 0));
      const cpPen = cp.items.filter(it => it.ti === ti).reduce((a, it) => a + it.pts, 0);
      return Math.round(clamp(100 - outPen - cpPen - (pol.save ? 5 : 0), 0, 100));
    });
    const res = {
      days, H, E, NT, edges: N.edges, flow, hrDem, hrSup, hrUns, hrWind, hrDiesel, wx: W.slice(0, days),
      town, tot, cost, co2: tot.co2, bioCo2: tot.bioCo2, cp, sat: satisfaction(town), pol, seed: st.seed, season: PK.climate ? st.season : null, fab2, map: PK.id,
      unsTotal: town.reduce((a, Dt) => a + Dt.uns, 0), outTotal: town.reduce((a, Dt) => a + Dt.outH, 0),
      hrHosp, hrHospDem, hrHospUns, hospH: hrHosp.reduce((a, x) => a + x, 0), research: RR, techDay,
      gx: GX.map(G => ({ to: G.to, byHead: G.byHead, byDisp: G.byDisp, def: G.def, ren: G.ren, head: G.head, disp: G.disp, dmc: G.dmc, dco2: G.dco2, mc: G.mc, co2i: G.co2i, bioCo2i: G.bioCo2i, dbioCo2: G.dbioCo2 }))
    };
    res.missions = judge(st, res);
    res.news = headlines(st, res, N);
    res.questions = questions(st, res, N);
    replayLayouts.set(res, replayLayout(st));
    if (lgOut) gridFillContexts.set(res, { townDemand, hospTi, finish: r => { r.sat = satisfaction(r.town); r.missions = judge(st, r); r.news = headlines(st, r, N); r.questions = questions(st, r, N); replayLayouts.set(r, replayLayout(st)); } });
    return res;
  }

  const hospitals = () => TOWNS.filter(W => W.kind === "hospital").map(W => W.ti);
  function judge(st, R) {
    const target = costTarget(R.days), hosp = hospitals().reduce((a, ti) => a + R.town[ti].outH, 0);
    const all = {
      outage: { ok: R.unsTotal <= 0.005 * R.tot.dem && hosp === 0, val: `못 보낸 전력 ${fmt(100 * R.unsTotal / Math.max(1, R.tot.dem), 1)}% · 병원 ${hosp}시간` },
      cost: { ok: R.cost.total <= target, val: `총비용 ${fmt(R.cost.total, 1)}억 / 목표 ${target}억` },
      co2: { ok: R.co2 / R.days <= PK.goals.co2Day, val: `하루 ${fmt(R.co2 / R.days, 1)} t / 목표 ${PK.goals.co2Day} t` },
      complaint: { ok: R.cp.issues <= 1 && Math.min(...R.sat) >= 60, val: `민원 ${R.cp.issues}건 · 최저 만족 ${Math.min(...R.sat)}` }
    };
    return MISSIONS.map(m => ({ id: m.id, name: m.name, icon: m.icon, chosen: st.missions.includes(m.id), ...all[m.id] }));
  }

  function headlines(st, R, N) {
    const out = [];
    const add = (score, text) => out.push({ score, text });
    const place = PK.place;
    const byKind = k => TOWNS.filter(W => W.kind === k);
    byKind("hospital").forEach(W => { const h = R.town[W.ti].outH; if (h > 0) add(100 + h / 100, `${W.name} ${h}시간 정전… "비상발전기 또 돌렸다"`); });
    byKind("factory_big").forEach(W => { const h = R.town[W.ti].outH; if (h > 0) add(97 + h / 100, `${W.name} 정전 ${h}시간… 생산 차질`); });
    byKind("fire").forEach(W => { if (R.town[W.ti].outH > 0) add(96, `${W.name} 정전 — 비상발전기 가동`); });
    byKind("water").forEach(W => { if (R.town[W.ti].outH > 0) add(95, `${W.name} 정전 — 단수 우려`); });
    TOWNS.filter(W => W.kind === "rail" || W.kind === "rail_s").forEach(W => { if (R.town[W.ti].outH > 0) add(94, `${W.name.replace(/\(.*\)/, "")} 열차 지연 — 정전 ${R.town[W.ti].outH}시간`); });
    const worst = R.town.map((Dt, ti) => ({ ti, ...Dt })).filter(x => !CRIT[TOWNS[x.ti].kind] && TOWNS[x.ti].kind !== "factory_big").sort((a, b) => b.outH - a.outH)[0];
    if (worst && worst.outH > 0) {
      const W = TOWNS[worst.ti];
      let streak = 0, bestStreak = 0, hit = false, bestHit = false;
      R.wx.forEach((w, d) => {
        if (w.w > 0) { streak++; hit = hit || worst.dayOut[d] > 0; } else { streak = 0; hit = false; }
        if (streak >= 3 && hit && streak > bestStreak) { bestStreak = streak; bestHit = true; }
      });
      const eve = worst.eveH / worst.outH > 0.6;
      if (bestHit) add(80 + worst.outH / 10, `흐린 ${bestStreak === 3 ? "사흘" : bestStreak + "일"}간 ${W.name}${eve ? " 저녁" : ""} 정전`);
      else if (eve) add(70 + worst.outH / 10, `${W.name}, 해 지면 불 꺼져… 저녁 정전 ${worst.outH}시간`);
      else add(65 + worst.outH / 10, `${W.name} 정전 ${worst.outH}시간… "전기가 안 온다"`);
    }
    R.cp.list.forEach(c => {
      const W = TOWNS[c.ti];
      if (c.kind === "smoke") add(60 + c.pts, `${W.name}, ${c.src === "biomass" ? "바이오매스" : "디젤"} 매연 민원 이어져`);
      else if (c.kind === "noise") add(50 + c.pts, c.src === "wind" ? `${W.name} "풍차 소리에 잠 못 자"… 소음 민원` : `${W.name} "디젤 엔진 소리 밤새 울려"`);
      else if (c.kind === "view") add(30 + c.pts, `${W.name} "창밖이 발전소"… 경관 민원`);
      else if (c.kind === "green") add(28 + c.pts, `${W.name} 뒷숲 깎여… 녹지 훼손 논란`);
    });
    if (R.tot.renAvail > 1 && R.tot.curt / R.tot.renAvail > 0.12) add(55, `남는 전기 ${fmt(R.tot.curt)} MWh 버려져… "담아 둘 곳이 없다"`);
    const hiCO2 = PK.climate ? PK.goals.co2Day * 1.3 : 30;
    if ((LG ? R.tot.co2 : R.co2) / R.days > hiCO2) add(R.pol.tax ? 58 : 62, R.pol.tax ? `탄소세에 연료비 껑충… 연료 ${fmt(R.cost.fuel, 1)}억` : `${place} 하늘에 CO₂ ${fmt(LG ? R.tot.co2 : R.co2)} t… 탄소세 도입 논의`);
    if (R.tot.by.import > 0 && R.tot.by.import / Math.max(1, R.tot.sup) > 0.3) add(48, `전기 ${fmt(100 * R.tot.by.import / R.tot.sup)}%를 밖에서 사 왔다… "자립은 멀다"`);
    const lossShare = R.tot.loss / Math.max(1, R.tot.sup + R.tot.loss);
    // 섬의 기존 6% 문턱을 기준으로 리그 지도 손실률에 비례한다. #build의 뉴스는 보존한다.
    const lossThreshold = LG ? 0.06 * (PK.lossPerHex || M.lossPerHex) / M.lossPerHex : 0.06;
    if (lossShare > lossThreshold) add(45, `먼 송전선에서 전기 ${fmt(100 * lossShare, 1)}% 새어 나가`);
    if (R.outTotal === 0 && R.tot.dem > 0) add(75, `${R.days}일 무정전 운영… "불 한 번 안 꺼졌다"`);
    if ((LG ? R.tot.co2 : R.co2) / R.days <= (PK.climate ? PK.goals.co2Day * 0.5 : 5) && R.outTotal < R.H * 0.02) add(52, `${LG ? "지역에서 " : ""}화석 연료 거의 안 쓰고 ${place}을 밝혔다`);
    const idleG = N.nodes.filter(n => n.kind !== "town" && !n.live && n.bi !== undefined).length;
    if (idleG) add(57, `선 없는 발전소 ${idleG}곳… "지어 놓고 못 쓴다"`);
    if (!out.length) add(1, `${R.days}일 운영 끝… ${place} 전력망 첫 성적표`);
    return out.sort((a, b) => b.score - a.score).slice(0, 3).map(o => o.text);
  }

  function questions(st, R, N) {
    const qs = [];
    const add = (score, q, hints) => qs.push({ score, q, hints });
    const ga = (w, a, b) => (/[가-힣]$/.test(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 ? a : b);
    const worst = R.town.map((Dt, ti) => ({ ti, ...Dt })).sort((a, b) => (b.outH * ((KIND[TOWNS[b.ti].kind] || {}).w || 1)) - (a.outH * ((KIND[TOWNS[a.ti].kind] || {}).w || 1)))[0];
    if (worst && worst.outH > 0) {
      const W = TOWNS[worst.ti];
      add(90, `${W.name}${ga(W.name, "이", "가")} ${worst.outH}시간 정전됐습니다. 다시 짓는다면 무엇을 먼저 바꾸겠습니까?`,
        [`정전이 주로 언제였나(저녁 ${worst.eveH}시간)`, `못 보낸 전력 ${fmt(worst.uns, 1)} MWh`, "고치면 늘어나는 비용·민원은?"]);
    }
    const nearTown = R.cp.list.find(c => c.kind === "noise" || c.kind === "smoke");
    if (nearTown) {
      const W = TOWNS[nearTown.ti], what = nearTown.src === "wind" ? "풍력 발전기를" : nearTown.src === "biomass" ? "바이오매스 발전소를" : "디젤 발전기를";
      add(80, `${what} ${W.name} 가까이 지었습니다. 주민이 반대하면 어떻게 하겠습니까?`,
        ["누구의 불편을 먼저 볼지 정하기", `${W.name} 만족도 ${R.sat[nearTown.ti]}점`, "옮기면 송전 손실·비용은?"]);
    }
    if (R.co2 / R.days > (PK.climate ? PK.goals.co2Day : 30) && !R.pol.tax) add(75, `CO₂가 ${fmt(R.co2)} t 나왔는데 탄소세를 고르지 않았습니다. 왜였나요?`,
      ["지역 부담 vs 지구 부담", `하루 ${fmt(R.co2 / R.days, 1)} t`, "탄소세를 걸면 누가 더 내나?"]);
    const spent = capex(st);
    if (spent >= budgetOf() - 6) add(70, `예산 ${fmt(spent, 1)}억을 거의 다 썼습니다. 같은 돈으로 더 나은 조합이 있었을까요?`,
      ["무엇을 가장 중요하게 봤나", `연료비 ${fmt(R.cost.fuel, 1)}억 · 건설비 ${fmt(R.cost.capex, 1)}억`, "기간이 길어지면 답이 바뀌나?"]);
    if (R.tot.renAvail > 1 && R.tot.curt / R.tot.renAvail > 0.12) add(65, `남아서 버린 전력이 ${fmt(R.tot.curt)} MWh입니다. 어떻게 쓸 수 있었을까요?`,
      ["언제 남고 언제 모자랐나", `버린 전력 ${fmt(R.tot.curt)} MWh`, "배터리 1대 12억의 값어치는?"]);
    if (R.fab2 && R.town.some((Dt, ti) => TOWNS[ti].kind === "factory_big" && Dt.outH > 0)) add(85, "반도체 2라인 증설로 전기가 모자랐습니다. 공장과 주민 중 누구를 먼저 지켜야 합니까?",
      ["차단 순서를 무엇으로 정했나", "부족한 MW와 시간", "송전선을 새로 놓을 때의 갈등"]);
    const lost = R.missions.filter(m => m.chosen && !m.ok);
    if (lost.length) add(60, `'${lost[0].name}' 미션을 놓쳤습니다. 무엇과 바꾼 결과입니까?`,
      ["두 미션 중 무엇을 먼저 봤나", lost[0].val, "다른 미션에서 얻은 것"]);
    add(40, `가장 힘들었던 날은 언제였고, 그날을 버티려면 무엇이 필요합니까?`,
      ["평균 말고 최악의 날로 보기", `흐림·비 ${R.wx.filter(w => w.w > 0).length}일 / ${R.days}일`, "대비하는 데 드는 돈"]);
    add(35, `${PK.place === "섬" ? "이 섬" : PK.place}에 전원을 하나만 더 짓는다면 무엇을 어디에 짓겠습니까?`,
      ["판단 기준 한 줄", "그 타일의 일사·풍속 숫자", "그 선택의 대가"]);
    return qs.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /* ---------- 저장(지도마다 칸 하나) ---------- */
  function blankSlot(P) { return { seed: (P || PK).seed || 2026, builds: [], lines: [], policies: [], missions: [], shed: "home", season: "summer", fab2: false, rq: [] }; }
  function blankDoc() {
    const maps = {};
    PACK_IDS.forEach(id => { maps[id] = blankSlot(PACKS[id]); });
    return { v: 2, map: PACK_IDS[0], maps, runs: 0, jAuto: false, journal: [] };
  }
  /* ---------- 건설 일지 ---------- */
  const J_MAX = 30, J_LEN = 2000;
  const JQ = [
    { k: "why", q: "왜 이 자리에, 이 발전원을 골랐나요?", s: "왜", h: ["일사·풍속·주민 숫자 하나를 근거로", "다른 자리와 비교하면?"] },
    { k: "surprise", q: "결과에서 예상과 달랐던 점은?", s: "예상 밖", h: ["예상한 숫자 vs 실제 숫자", "왜 달랐는지 작동 원리로"] },
    { k: "trade", q: "얻은 것과 잃은 것을 한 문장으로", s: "한 문장", h: ["○○을 얻는 대신 △△을 잃었다", "그 부담은 누가 지나?"] },
    { k: "next", q: "다음에 바꿀 것, 더 알아봐야 할 것은?", s: "다음", h: ["바꿀 것 하나 + 이유", "더 확인할 자료나 실험 하나"] }
  ];
  const jstr = (x, max = J_LEN) => (typeof x === "string" ? x.slice(0, max) : "");
  const jnum = (x, lo, hi) => (typeof x === "number" && isFinite(x) ? clamp(x, lo, hi) : 0);
  function cleanEntry(e) {
    if (!e || typeof e !== "object" || !Number.isInteger(e.id) || e.id < 1) return null;
    const m = e.m && typeof e.m === "object" ? e.m : {};
    const a = e.a && typeof e.a === "object" ? e.a : {};
    return {
      id: e.id, at: jstr(e.at, 10), days: [7, 30, 90].includes(e.days) ? e.days : 7, seed: Number.isInteger(e.seed) ? e.seed : 0,
      map: Object.hasOwn(PACKS, e.map) ? e.map : PACK_IDS[0], season: jstr(e.season, 30),
      wx: Array.isArray(e.wx) ? [0, 1, 2].map(k => Math.round(jnum(e.wx[k], 0, 90))) : [0, 0, 0],
      m: { out: jnum(m.out, 0, 1e5), co2: jnum(m.co2, 0, 1e7), cost: jnum(m.cost, 0, 1e5), cp: jnum(m.cp, 0, 99), uns: jnum(m.uns, 0, 100), curt: jnum(m.curt, 0, 1e7) },
      pol: (Array.isArray(e.pol) ? e.pol : []).filter(id => POLICIES.some(P => P.id === id)).slice(0, 2),
      mis: (Array.isArray(e.mis) ? e.mis : []).filter(x => x && MISSIONS.some(P => P.id === x.id)).slice(0, 2).map(x => ({ id: x.id, ok: x.ok === true })),
      q: jstr(e.q, 300),
      a: { why: jstr(a.why), surprise: jstr(a.surprise), trade: jstr(a.trade), next: jstr(a.next), q: jstr(a.q) }
    };
  }
  // 현재 지도(usePack)로 한 칸을 검사한다.
  function sanitize(o, cap) {
    const st = blankSlot(), lim = typeof cap === "number" && isFinite(cap) ? cap : budgetOf();
    if (!o || typeof o !== "object") return st;
    if (Number.isInteger(o.seed) && o.seed > 0) st.seed = o.seed >>> 0;
    const used = new Set();
    (Array.isArray(o.builds) ? o.builds : []).forEach(b => {
      if (!b || !Object.hasOwn(BLD, b.t) || !Number.isInteger(b.i) || !TILES[b.i]) return;
      if (used.has(b.i) || siteRule(b.t, TILES[b.i])) return;
      used.add(b.i);
      st.builds.push({ t: b.t, i: b.i, ...(LG && Number.isFinite(b.paidCost) && b.paidCost >= 0 ? { paidCost: b.paidCost } : {}) });
    });
    (Array.isArray(o.lines) ? o.lines : []).forEach(L => {
      const p = L && Array.isArray(L.p) ? L.p : null;
      if (!p || p.length < 2 || p.length > 80) return;
      for (let k = 0; k < p.length; k++) {
        if (!Number.isInteger(p[k]) || !TILES[p[k]] || TILES[p[k]].out) return;
        if (k && !TILES[p[k - 1]].nb.includes(p[k])) return;
      }
      st.lines.push({ p: p.slice() });
    });
    st.policies = (Array.isArray(o.policies) ? o.policies : []).filter((id, k, a) => POLICIES.some(P => P.id === id) && a.indexOf(id) === k).slice(0, 2);
    st.missions = (Array.isArray(o.missions) ? o.missions : []).filter((id, k, a) => MISSIONS.some(P => P.id === id) && a.indexOf(id) === k).slice(0, 2);
    if (SHED_OPTS.some(x => x.id === o.shed)) st.shed = o.shed;
    if (SEASONS.some(x => x.id === o.season)) st.season = o.season;
    st.fab2 = o.fab2 === true;
    st.rq = (Array.isArray(o.rq) ? o.rq : []).filter((id, k, a) => (LG && KCP.TECH_DATA ? KCP.TECH_DATA.cards : TECHS).some(T => T.id === id) && a.indexOf(id) === k);
    while (capex(st) > lim + 1e-9 && (st.lines.length || st.builds.length)) { if (st.lines.length) st.lines.pop(); else st.builds.pop(); }
    return st;
  }
  function sanitizeDoc(o) {
    const doc = blankDoc();
    if (!o || typeof o !== "object") return doc;
    // v1(한 지도) → 연습 섬 칸으로 옮긴다.
    const raw = o.maps && typeof o.maps === "object" ? o.maps : { [PACK_IDS[0]]: o };
    const cur = PK ? PK.id : PACK_IDS[0];
    PACK_IDS.forEach(id => { usePack(id); BLD = bldFor(PACKS[id]); doc.maps[id] = sanitize(raw[id]); });
    usePack(cur); BLD = bldFor(PK);
    if (Object.hasOwn(PACKS, o.map)) doc.map = o.map;
    doc.journal = (Array.isArray(o.journal) ? o.journal : []).map(cleanEntry).filter(Boolean).slice(-J_MAX);
    doc.runs = Math.max(Number.isInteger(o.runs) && o.runs > 0 ? Math.min(o.runs, 1e6) : 0, doc.journal.reduce((a, e) => Math.max(a, e.id), 0));
    doc.jAuto = o.jAuto === true;
    return doc;
  }
  function bldFor(P) {
    const out = {};
    Object.keys(BLD0).forEach(k => { out[k] = Object.assign({}, BLD0[k], (P.bld && P.bld[k]) || {}); });
    if (LG && KCP.TECH_DATA) {
      const v = k => KCP.TECH_DATA.params[k].v;
      out.tandem = { ...out.solar, name: "탠덤 태양광", spec: `${out.solar.mw * v("tandemOutput")} MW`, tech: "tandem", mw: out.solar.mw * v("tandemOutput"), cost: out.solar.cost * v("tandemCost") };
      out.tandem_roof = { ...out.roof, name: "탠덤 지붕 태양광", spec: `${out.roof.mw * v("tandemOutput")} MW`, tech: "tandem", mw: out.roof.mw * v("tandemOutput"), cost: out.roof.cost * v("tandemCost") };
      out.nbat = { ...out.battery, name: "차세대 배터리", tech: "nbat", mwh: M.batMWh * v("nbatCapacity"), cost: v("nbatCost"), spec: "4 MW/20 MWh" };
      out.h2store = { ...out.battery, name: "수소 탱크", tech: "h2store", mwh: v("h2MWh"), mw: v("h2MW"), cost: v("h2Cost"), spec: "4 MW/200 MWh · 왕복 35%" };
      out.smr = { ...out.diesel, name: "SMR", tech: "smr", mw: v("smrMW"), cost: v("smrCost"), ok: { beach: 1, river: 1 }, spec: `${+v("smrMW").toFixed(2)} MW · 건설 ${v("smrTurns")}턴` };
    }
    return out;
  }
  function selectPack(id, mode) { const P = usePack(id, mode); BLD = bldFor(P); if (KCP.buildGame) KCP.buildGame.BLD = BLD; return P; }
  function loadState() {
    try { const raw = window.localStorage.getItem(KEY); return raw ? sanitizeDoc(JSON.parse(raw)) : blankDoc(); } catch (e) { return blankDoc(); }
  }
  function saveState(doc) { try { window.localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) { /* 저장 없이도 동작한다 */ } }

  selectPack(PACK_IDS[0]);
  KCP.buildGame = { simulate, sanitize, sanitizeDoc, network, complaints, weather, demand, routePath, capex, siteRule, selectPack, peakDemand, gridEffectText, bmsEffectText, TILES, TOWNS, SITES, M, BLD, PACKS, SEASONS, tips, TECHS, RS, researchRun };
  KCP.buildGame.gridFillContext = res => gridFillContexts.get(res);

  /* =====================================================================
   * 3. 아이콘
   * ===================================================================== */
  const IC = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    wind: '<path d="M12 11v10M9 21h6"/><circle cx="12" cy="9" r="1.5"/><path d="M12 7.5V2.5M13.3 9.8l4.4 2.4M10.7 9.8l-4.4 2.4"/>',
    diesel: '<path d="M3 21V12l5 3v-3l5 3V8h2.5V3h3v18z"/><path d="M2 21h20"/>',
    battery: '<rect x="2.5" y="7" width="17" height="11" rx="2"/><path d="M21.5 11v3M12 9l-2.5 4h3.2L10.3 17"/>',
    line: '<path d="M8 21l4-17 4 17M5.5 8h13M7.2 13h9.6M9 18.5l6-5.5M15 18.5l-6-5.5"/>',
    remove: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M8 9l1.8 6 2.2-5 2.2 5L16 9M7.5 12h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
    co2: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.4 3.4 0 0 0 7 18.5z"/>',
    alert: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9.5a3.6 3.6 0 0 1 0 5M19 7a7.2 7.2 0 0 1 0 10"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2A4.5 4.5 0 0 1 21 18.6"/>',
    map: '<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 3.5v14.5M15 6v14.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8M12 17.2h.01"/>',
    cards: '<rect x="4" y="6.5" width="12" height="14.5" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.4 3.4 0 0 0 7 18z"/>',
    rain: '<path d="M7 14.5h10a3.6 3.6 0 0 0 .6-7.2 5.4 5.4 0 0 0-10.3 1.4A3 3 0 0 0 7 14.5z"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
    news: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 12.5h6M7 15.5h4"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    reroll: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    skip: '<path d="M5 5v14l8-7zM13 5v14l8-7z" fill="currentColor"/>',
    hammer: '<path d="M14 6l4 4M3 21l9-9M11 7l3-3 6 6-3 3z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l8-8"/>',
    roof: '<path d="M3 12l9-7 9 7"/><path d="M6 10.5V20h12v-9.5"/><path d="M8.5 13.5h7l-1 3h-7z"/>',
    offshore: '<path d="M12 10v8M9.5 18h5"/><circle cx="12" cy="8" r="1.4"/><path d="M12 6.6V2.5M13.2 8.7l3.6 2M10.8 8.7l-3.6 2"/><path d="M2.5 21c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0 3.2 1.2 4.6 0"/>',
    tidal: '<path d="M2.5 9c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 7 0"/><path d="M2.5 14c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 7 0"/><path d="M12 17v4M9.5 21h5"/><circle cx="12" cy="4.5" r="1.8"/>',
    hydro: '<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/><path d="M9.5 13.5a2.6 2.6 0 0 0 2.5 2.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    uni: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M22 9v6"/>',
    lab: '<path d="M4 20h16"/><rect x="5" y="10" width="14" height="10" rx="1"/><path d="M9 14h2M13 14h2M9 17h2M13 17h2"/><path d="M12 10V6"/><path d="M8.5 4.5a5 5 0 0 1 7 0"/><path d="M6.5 2.5a8 8 0 0 1 11 0"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'
  };
  const ico = (k, cls = "v2-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${IC[k] || ""}</svg>`;
  // 도구 이름·아이콘·비용 표시(지도마다 비용이 다를 수 있다)
  const toolMeta = id => (id === "line" ? { id, icon: "line", name: "송전선", cost: `${fmt(lineUnit(), 1)}억/칸` }
    : id === "remove" ? { id, icon: "remove", name: "철거", cost: S && S.opts && S.opts.salvage ? "회수" : "환불" }
    : { id, icon: BLD[id].icon, name: BLD[id].name, cost: `${fmt(BLD[id].cost)}억`, rated: BLD[id].mw > 0 ? `정격 ${BLD[id].mw} MW` : "" });
  const LAYERS = [
    { id: "map", icon: "map", name: "지도" },
    { id: "sun", icon: "sun", name: "일사" },
    { id: "wind", icon: "wind", name: "풍속" },
    { id: "pop", icon: "people", name: "주민" }
  ];

  /* =====================================================================
   * 4. 화면 상태
   * ===================================================================== */
  let S = null; // 라우트가 살아 있는 동안의 화면 상태
  // E: 리그에서 보류한 화면만 감춘다. false로 바꾸면 대본·설정에 따라 다시 표시할 수 있다.
  const LEAGUE_UI_HIDDEN = { research: true, journal: true, longTrial: true, fab2: true };
  const uiVisible = (feature, opts = S?.opts || {}) => !opts.league || !LEAGUE_UI_HIDDEN[feature] ||
    (feature === "longTrial" && opts.solo === true);
  // 다른 화면(멀티플레이 팀)이 빌려 쓸 때의 갈래: opts.save · opts.budget · opts.locked · opts.onChange
  const budgetOf = () => (S && S.opts.budget ? S.opts.budget() : PK.budget);
  const persist = () => { if (S.opts.save) S.opts.save(S.doc); else saveState(S.doc); };
  const lockedMsg = () => (S && S.opts.locked ? S.opts.locked() : "");
  const reduced = () => (KCP.v2 && KCP.v2.reduced ? KCP.v2.reduced() : !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches));
  // 지도 효과는 화면 메모리에만 둔다. 시간·reduced를 인자로 받아 Node에서도 검사한다.
  const MAP_FX_MS = 300;
  const MAP_INK = { cyan: "#71dceb", danger: "#dc7890", dust: "#edf4fc" }; // v2.css 토큰
  const mapMotion = {
    needsFrame: (state, rm, hidden) => (!rm && !hidden) || !!(state.run || state.mapFx.length || state.floaters.length),
    active: (items, now, rm, ms = MAP_FX_MS) => rm ? [] : items.filter(f => now - f.t0 < ms),
    register(items, event, now, rm) {
      if (rm) return [];
      const key = event.p ? `l:${event.p.join("-")}` : `b:${event.i}`;
      return [...mapMotion.active(items, now, false).filter(f => f.key !== key),
        { ...event, ...(event.p ? { p: event.p.slice() } : {}), key, t0: now }];
    },
    pose(f, now) {
      const p = clamp((now - f.t0) / MAP_FX_MS, 0, 1), q = p - 1;
      return { p, scale: f.kind === "place" ? (p === 0 ? 0 : 1 + 2.70158 * q ** 3 + 1.70158 * q ** 2) : 1 - p * p,
        alpha: f.kind === "place" ? 1 : 1 - p, drop: f.kind === "place" ? 0 : p * p * 0.45 };
    },
    flowRoutes(net, res, lines) {
      const live = new Set(), towns = [], owners = [], index = new Map();
      const edgeKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
      res.edges.forEach(([a, b], e) => index.set(edgeKey(a, b), e));
      lines.forEach((L, li) => { for (let j = 1; j < L.p.length; j++) {
        const e = index.get(edgeKey(L.p[j - 1], L.p[j]));
        if (e !== undefined) (owners[e] ||= []).push(li);
      } });
      // 기존 network의 발전·충방전 경로를 읽는다. 급전·조류 계산은 추가하지 않는다.
      net.comps.forEach(C => [C.RL, C.RB, C.BL, C.DL].forEach(pairs => pairs.forEach(P => {
        if (!P.g.live || !P.l.live) return;
        P.path.forEach(([e0, dir]) => {
          const [a, b] = net.edges[e0], e = index.get(edgeKey(a, b));
          if (e === undefined) return;
          live.add(e);
          if (P.l.kind === "town") {
            const list = towns[e] ||= [];
            if (!list.some(n => n.ti === P.l.ti && n.dir === dir)) list.push({ ti: P.l.ti, dir });
          }
        });
      })));
      return { live, towns, owners };
    },
    townOutage: (res, k, ti, eps, outHour) =>
      res.hrUns[k * res.NT + ti] > eps && (!outHour || !!outHour(k)),
    flowMarks(res, k, routes, rm, eps, replay = false, outHour) {
      if (!res.flow || !res.E) return [];
      const marks = [];
      res.edges.forEach(([a, b], e) => {
        if (!routes.live.has(e)) return;
        const f = res.flow[k * res.E + e], amount = Math.abs(f);
        if (!Number.isFinite(amount)) return;
        const outage = (routes.towns[e] || []).some(n =>
          (!f || Math.sign(f) === n.dir) && mapMotion.townOutage(res, k, n.ti, eps, outHour));
        if (amount < 0.03 && !outage) return;
        // 재생 flow는 거래 전 값이다. 방향만 읽고 굵기·점 크기·밀도·속도는 고정한다.
        const shownAmount = replay ? 1 : amount;
        const desired = amount < 0.03 ? 0 : replay ? 2 : Math.min(6, 2 + Math.floor(amount / 2));
        marks.push({ e, from: f < 0 ? b : a, to: f < 0 ? a : b, amount: shownAmount, outage,
          desired: outage && !replay && desired ? Math.max(1, Math.floor(desired * 0.45)) : desired, count: 0,
          speed: rm ? 0 : 0.65 + Math.min(2, shownAmount * 0.12) });
      });
      // 첫 순회에 통전 선분마다 1개씩 배분한다(전체 200개까지). 긴 선은 선분 수만큼 허용한다.
      let budget = 200;
      const lineCounts = new Map(), lineSegments = new Map();
      (routes.owners || []).forEach(owners => owners.forEach(id =>
        lineSegments.set(id, (lineSegments.get(id) || 0) + 1)));
      for (let pass = 0; pass < 6 && budget; pass++) for (const m of marks) {
        const owners = routes.owners?.[m.e] || [];
        if (m.count >= m.desired || !budget || owners.some(id =>
          (lineCounts.get(id) || 0) >= Math.max(6, lineSegments.get(id) || 0))) continue;
        m.count++; budget--;
        owners.forEach(id => lineCounts.set(id, (lineCounts.get(id) || 0) + 1));
      }
      return marks;
    }
  };
  function mapEffect(event) {
    S.mapFx = mapMotion.register(S.mapFx, event, performance.now(), reduced());
  }
  const dprOf = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const $ = sel => (S ? S.root.querySelector(sel) : null);
  // 훅이 내부에서 다른 도시 지도를 조회해도 화면은 원래 지도를 유지한다.
  function leagueMods(st) {
    if (!S?.opts.league || typeof S.opts.leagueMods !== "function") return null;
    const pack = PK.id;
    try { return S.opts.leagueMods(st); }
    finally { if (PK.id !== pack) selectPack(pack, "league"); }
  }
  function leagueGrid(st) {
    if (!S?.opts.league || typeof S.opts.leagueGrid !== "function") return null;
    const pack = PK.id;
    try { return S.opts.leagueGrid(st); }
    finally { if (PK.id !== pack) selectPack(pack, "league"); }
  }
  function rememberTrial(res, st, round, gridMWh = 0) {
    const scope = S?.opts.trialScope || "", key = JSON.stringify([scope, res.map]);
    const trial = {
      map: res.map, scope, year: round?.year || null, month: round?.month || null,
      season: res.season, days: res.days, seed: res.seed,
      unsPct: res.tot.dem > 0 ? 100 * res.unsTotal / res.tot.dem : 0,
      // outH는 도시 전체 부족 시간(최대 days×24), outTotal은 수요지별 정전 시간의 합이다.
      outH: res.hrDem.reduce((hours, dem, k) => hours + (dem - res.hrSup[k] > outageCut(dem) ? 1 : 0), 0),
      outTotal: res.outTotal, co2: res.co2, cost: res.cost.total,
      capex: res.cost.capex, opex: res.cost.total - res.cost.capex,
      loss: res.tot.loss, idle: res.tot.idle,
      // D-80: gridFill이 더한 바깥 계통 전기(대표 기간 MWh). 지도의 수입 설비 출력은 섞지 않는다. 옛 기록에는 없다.
      gridMWh,
      plan: { builds: st.builds, lines: st.lines, policies: st.policies, shed: st.shed, fab2: st.fab2, rq: st.rq }
    };
    // 수치와 선택만 저장한다. 일지·이유·매시 배열·사건의 실제 크기는 저장하지 않는다.
    const copy = JSON.parse(JSON.stringify(trial));
    trialMemory[key] = copy;
    try {
      const raw = JSON.parse(window.localStorage.getItem(TRIAL_KEY) || "{}");
      const all = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      all[key] = copy;
      window.localStorage.setItem(TRIAL_KEY, JSON.stringify(all));
    } catch (e) { /* 저장 불가여도 같은 화면에서는 시험값을 읽는다 */ }
  }
  function lastTrial(map = PK.id, scope = S?.opts.trialScope || "") {
    const key = JSON.stringify([scope, map]);
    let trial = trialMemory[key];
    try { trial = JSON.parse(window.localStorage.getItem(TRIAL_KEY) || "{}")[key] || trial; } catch (e) { /* 손상된 저장은 무시 */ }
    if (!trial || trial.map !== map || trial.scope !== scope || ![trial.days, trial.unsPct, trial.outH, trial.co2, trial.cost].every(Number.isFinite)) return null;
    return JSON.parse(JSON.stringify(trial));
  }
  KCP.on("storage:clear", () => { trialMemory = {}; try { window.localStorage.removeItem(TRIAL_KEY); } catch (e) { /* 저장 불가 */ } });

  /* ---------- 투영(2.5D) ---------- */
  const SQ = 0.62, HZ = 0.42, BASE = -0.3;
  const V = { S: 20, ox: 0, oy: 0, rot: 0, zoom: 1, panX: 0, panY: 0, area: { l: 0, t: 0, r: 100, b: 100 }, W: 100, H: 100, bw: 1, bh: 1 };
  // 세계 좌표(X 동쪽, Y 남쪽) → 화면 평면(u 오른쪽, v 아래). 세로 화면에서는 90° 돌려 서쪽이 위로 간다.
  const uv = (X, Y) => (V.rot ? [-Y, X] : [X, Y]);
  function scr(X, Y, h) { const [u, v] = uv(X, Y); return [V.ox + u * V.S, V.oy + v * SQ * V.S - h * HZ * V.S]; }
  const tileTop = (T, extra = 0) => scr(T.X, T.Y, HGT[T.t] + extra);
  const corner = k => { const a = (60 * k - 90) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };
  const CORN = [0, 1, 2, 3, 4, 5].map(corner);
  function topPoly(T, h = HGT[T.t], shrink = 0.985) { return CORN.map(([cx, cy]) => scr(T.X + cx * shrink, T.Y + cy * shrink, h)); }
  let ORDER = [];
  function computeOrder() {
    ORDER = TILES.slice().sort((a, b) => { const A = uv(a.X, a.Y), B = uv(b.X, b.Y); return (A[1] - B[1]) || (A[0] - B[0]); });
  }
  // 화면 맞춤 대상: 섬은 땅, 평택은 시 경계 안(물 포함)과 그 연안 바다 한 칸
  const fitTile = T => (PK.fitSea ? !T.out && (T.t !== "sea" || T.dshore <= 1) : T.land);
  function fitView() {
    const a = V.area;
    const aw = Math.max(50, a.r - a.l), ah = Math.max(50, a.b - a.t);
    V.rot = ah > aw * 1.02 ? 1 : 0;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    TILES.forEach(T => { if (!fitTile(T)) return; const [u, v] = uv(T.X, T.Y); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
    const pad = 1.25;
    V.bw = u1 - u0 + 2 * pad;
    V.bh = (v1 - v0 + 2 * pad) * SQ + 1.3 * HZ + 0.5;
    const s = Math.min(aw / V.bw, ah / V.bh);
    V.S = Math.max(6, s * V.zoom);
    const mx = Math.max(0, (V.bw * V.S - aw) / 2 + 20), my = Math.max(0, (V.bh * V.S - ah) / 2 + 20);
    V.panX = clamp(V.panX, -mx, mx); V.panY = clamp(V.panY, -my, my);
    V.ox = (a.l + a.r) / 2 - ((u0 + u1) / 2) * V.S + V.panX;
    V.oy = (a.t + a.b) / 2 - (((v0 + v1) / 2) * SQ - 0.35) * V.S + V.panY;
    if (V.lastRot !== V.rot) { V.lastRot = V.rot; computeOrder(); }
  }

  /* ---------- 색 ---------- */
  const hex2 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`);
  const mul = (c, f) => [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const PAL = {
    beach: hex2("#e6d39e"), plain: hex2("#84c060"), forest: hex2("#5b9c4b"), hill: hex2("#a8bd6c"), mount: hex2("#9b9a8f"), town: hex2("#a3c886"),
    earth: hex2("#8b6a45"), sand: hex2("#c7ab74"), rock: hex2("#77756c"),
    urban: hex2("#aeb4b6"), river: hex2("#3f8fc4"), lake: hex2("#3a7fb8"), out: hex2("#6d7a72"), grid: hex2("#9cc27a")
  };
  function ramp(stops, t) {
    t = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    return mix(stops[i], stops[i + 1], t - i);
  }
  const RAMPS = {
    sun: ["#33415f", "#7d6a4a", "#e0a63a", "#ffe08a"].map(hex2),
    wind: ["#27395c", "#2f6f8f", "#4fc0d6", "#d9fbff"].map(hex2),
    pop: ["#2b3a4e", "#6b4a6b", "#d9706a", "#ffc49a"].map(hex2)
  };
  const WRANGE = () => (PK.climate ? [1.5, 8.5] : [4, 9]), SRANGE = () => (PK.climate ? [0.75, 1] : [0.6, 1]);
  const layerVal = (T, L) => (L === "sun" ? (T.sun - SRANGE()[0]) / (SRANGE()[1] - SRANGE()[0]) : L === "wind" ? (T.wind - WRANGE()[0]) / (WRANGE()[1] - WRANGE()[0]) : Math.sqrt(T.pop / POPMAX));
  const layerTxt = (T, L) => (L === "sun" ? (T.sun ? T.sun.toFixed(2).replace(/^0/, "") : "") : L === "wind" ? (T.wind ? T.wind.toFixed(1) : "") : T.site >= 0 ? fmt(SITES[T.site].pop / 1000, 1) + "k" : T.pop >= 50 ? fmt(T.pop / 1000, 1) + "k" : "");

  /* =====================================================================
   * 5. 그리기
   * ===================================================================== */
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); g.closePath(); }
  function fillPoly(g, pts, col) { polyPath(g, pts); g.fillStyle = col; g.fill(); }
  function shadow(g, x, y, rx, ry, a = 0.2) { g.beginPath(); g.ellipse(x + rx * 0.25, y + ry * 0.3, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = `rgba(10,24,30,${a})`; g.fill(); }
  // 화면 정렬 상자(정면 + 오른쪽 옆면 + 지붕)
  function box(g, x, y, w, d, h, top, front, side) {
    const dx = d * 0.55, dy = d * 0.42;
    fillPoly(g, [[x + w / 2, y], [x + w / 2 + dx, y - dy], [x + w / 2 + dx, y - dy - h], [x + w / 2, y - h]], side);
    g.fillStyle = front; g.fillRect(x - w / 2, y - h, w, h);
    fillPoly(g, [[x - w / 2, y - h], [x + w / 2, y - h], [x + w / 2 + dx, y - dy - h], [x - w / 2 + dx, y - dy - h]], top);
  }
  function pine(g, x, y, s, shade = 1) {
    shadow(g, x, y, s * 0.42, s * 0.16, 0.18);
    g.fillStyle = "#5a4630"; g.fillRect(x - s * 0.05, y - s * 0.25, s * 0.1, s * 0.25);
    const L = rgb(mul([70, 140, 72], shade)), R = rgb(mul([44, 102, 58], shade));
    for (let k = 0; k < 2; k++) {
      const by = y - s * (0.2 + k * 0.38), hw = s * (0.42 - k * 0.1), ty = by - s * 0.62;
      fillPoly(g, [[x - hw, by], [x, ty], [x, by]], L);
      fillPoly(g, [[x, ty], [x + hw, by], [x, by]], R);
    }
  }
  function roundTree(g, x, y, s) {
    shadow(g, x, y, s * 0.4, s * 0.15, 0.18);
    g.fillStyle = "#5a4630"; g.fillRect(x - s * 0.05, y - s * 0.3, s * 0.1, s * 0.3);
    g.beginPath(); g.arc(x, y - s * 0.5, s * 0.32, 0, Math.PI * 2); g.fillStyle = "#4f9a4a"; g.fill();
    g.beginPath(); g.arc(x - s * 0.1, y - s * 0.58, s * 0.16, 0, Math.PI * 2); g.fillStyle = "#73b764"; g.fill();
  }
  function peak(g, x, y, w, h, snow) {
    fillPoly(g, [[x - w, y], [x - w * 0.08, y - h], [x + w * 0.12, y]], "#b9b7ab");
    fillPoly(g, [[x - w * 0.08, y - h], [x + w, y], [x + w * 0.12, y]], "#73716a");
    if (snow) {
      fillPoly(g, [[x - w * 0.08, y - h], [x - w * 0.32, y - h * 0.66], [x - w * 0.14, y - h * 0.72], [x + w * 0.02, y - h * 0.62], [x + w * 0.2, y - h * 0.7]], "#f3f6f8");
    }
  }
  function house(g, x, y, s, roof) {
    const w = s * 0.42, h = s * 0.26, d = s * 0.3;
    shadow(g, x, y, w * 0.8, s * 0.12, 0.2);
    box(g, x, y, w, d, h, "#d9cdb8", "#f1e8d8", "#c4b69e");
    const dx = d * 0.55, dy = d * 0.42;
    fillPoly(g, [[x - w / 2 - 1, y - h], [x, y - h - s * 0.2], [x + w / 2 + 1, y - h]], rgb(mul(roof, 1.08)));
    fillPoly(g, [[x, y - h - s * 0.2], [x + w / 2 + 1, y - h], [x + w / 2 + dx + 1, y - h - dy], [x + dx, y - h - dy - s * 0.2]], rgb(mul(roof, 0.82)));
    return [x - w * 0.22, y - h * 0.72, w * 0.18, h * 0.32];
  }

  // 수요지·시설: 정적 그림 + 밤 창문 자리 기록
  function drawTown(g, T, rec) {
    const W = SITES[T.site], [x, y] = tileTop(T), s = V.S;
    const wins = [];
    const at = (dx, dy) => scr(T.X + dx, T.Y + dy, HGT[T.t]);
    const K = W.kind;
    if (K !== "hospital" && K !== "village" && K !== "town_s" && K !== "city" && K !== "port") { drawFacility(g, T, W, at, wins); }
    else if (K === "hospital") {
      const [px, py] = at(-0.45, 0.25);
      g.beginPath(); g.ellipse(px, py, s * 0.24, s * 0.24 * SQ, 0, 0, Math.PI * 2); g.fillStyle = "#4b5966"; g.fill();
      g.fillStyle = "#f4f6f8"; g.font = `700 ${Math.max(7, s * 0.24)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("H", px, py + 0.5);
      const [bx, by] = at(0.18, 0.1);
      shadow(g, bx, by, s * 0.5, s * 0.16, 0.22);
      box(g, bx, by, s * 0.72, s * 0.4, s * 0.42, "#e9eef3", "#fbfdff", "#c9d3dc");
      box(g, bx - s * 0.05, by - s * 0.42, s * 0.36, s * 0.3, s * 0.2, "#e9eef3", "#f7fafc", "#c9d3dc");
      g.fillStyle = "#e0485a";
      const cx = bx - s * 0.05, cy = by - s * 0.52, a = s * 0.07;
      g.fillRect(cx - a * 1.5, cy - a / 2, a * 3, a); g.fillRect(cx - a / 2, cy - a * 1.5, a, a * 3);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) wins.push([bx - s * 0.3 + c * s * 0.17, by - s * 0.34 + r * s * 0.15, s * 0.09, s * 0.08]);
    } else if (K === "village" || K === "town_s") {
      const spots = [[-0.42, -0.3, "#c8553d"], [0.32, -0.38, "#d7843d"], [-0.05, 0.05, "#b5483a"], [0.45, 0.25, "#d7843d"], [-0.45, 0.38, "#c8553d"]];
      spots.sort((p, q) => uv(p[0], p[1])[1] - uv(q[0], q[1])[1]).forEach(([dx, dy, rc], k) => {
        const [hx, hy] = at(dx, dy);
        const w = house(g, hx, hy, s * 0.95, hex2(rc));
        wins.push(w, [w[0] + s * 0.17, w[1], w[2], w[3]]);
        if (k === 1) roundTree(g, hx + s * 0.32, hy + s * 0.08, s * 0.5);
      });
    } else if (K === "city") {
      const towers = [[-0.35, -0.25, 1.2], [0.3, -0.35, 1.55], [0.42, 0.28, 0.95], [-0.25, 0.32, 0.8], [0.0, 0.0, 1.9]];
      towers.sort((p, q) => uv(p[0], p[1])[1] - uv(q[0], q[1])[1]).forEach(([dx, dy, hgt]) => {
        const [tx, ty] = at(dx, dy), w = s * 0.32, h = s * 0.62 * hgt;
        shadow(g, tx, ty, w * 0.9, s * 0.13, 0.22);
        box(g, tx, ty, w, s * 0.26, h, "#d5dee8", "#b9c9d8", "#8ea2b6");
        g.fillStyle = "rgba(60,96,130,0.55)";
        const rows = Math.max(2, Math.floor(h / (s * 0.14)));
        for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) {
          const wx = tx - w * 0.32 + c * w * 0.38, wy = ty - h + s * 0.06 + r * (h - s * 0.1) / rows;
          g.fillRect(wx, wy, w * 0.24, s * 0.06);
          wins.push([wx, wy, w * 0.24, s * 0.06]);
        }
      });
    } else {
      // 항구: 부두, 창고, 크레인, 컨테이너
      const [qx, qy] = at(0.15, 0.62);
      g.fillStyle = "#7a5b3c"; g.fillRect(qx - s * 0.5, qy - s * 0.06, s * 1.0, s * 0.12);
      const [wx0, wy0] = at(-0.32, -0.2);
      shadow(g, wx0, wy0, s * 0.45, s * 0.15, 0.22);
      box(g, wx0, wy0, s * 0.62, s * 0.36, s * 0.3, "#9fb3c4", "#c4d3df", "#8397a9");
      for (let c = 0; c < 3; c++) wins.push([wx0 - s * 0.24 + c * s * 0.18, wy0 - s * 0.2, s * 0.1, s * 0.07]);
      const cols = ["#d0533f", "#3f7fd0", "#e3b23c", "#3fae84"];
      for (let k = 0; k < 4; k++) { const [cx, cy] = at(0.15 + (k % 2) * 0.3, 0.05 + Math.floor(k / 2) * 0.24); box(g, cx, cy, s * 0.26, s * 0.14, s * 0.12, rgb(mul(hex2(cols[k]), 1.15)), cols[k], rgb(mul(hex2(cols[k]), 0.75))); }
      const [kx, ky] = at(0.55, -0.25);
      g.strokeStyle = "#e5b33a"; g.lineWidth = Math.max(1.5, s * 0.05); g.lineCap = "round";
      g.beginPath(); g.moveTo(kx, ky); g.lineTo(kx, ky - s * 0.9); g.lineTo(kx - s * 0.55, ky - s * 0.8); g.moveTo(kx, ky - s * 0.9); g.lineTo(kx + s * 0.2, ky - s * 0.82); g.stroke();
      g.lineWidth = 1; g.strokeStyle = "#3a3f46"; g.beginPath(); g.moveTo(kx - s * 0.45, ky - s * 0.81); g.lineTo(kx - s * 0.45, ky - s * 0.5); g.stroke();
    }
    if (rec && T.town >= 0) rec.wins.push({ ti: T.town, list: wins, x, y });
  }
  // 평택 시설 그림
  function drawFacility(g, T, W, at, wins) {
    const s = V.S, K = W.kind;
    const tower = (dx, dy, hgt, w, cols) => {
      const [tx, ty] = at(dx, dy), h = s * 0.62 * hgt;
      shadow(g, tx, ty, w * 0.9, s * 0.13, 0.22);
      box(g, tx, ty, w, s * 0.26, h, cols[0], cols[1], cols[2]);
      g.fillStyle = "rgba(60,96,130,0.55)";
      const rows = Math.max(2, Math.floor(h / (s * 0.14)));
      for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) {
        const wx = tx - w * 0.32 + c * w * 0.38, wy = ty - h + s * 0.06 + r * (h - s * 0.1) / rows;
        g.fillRect(wx, wy, w * 0.24, s * 0.06); wins.push([wx, wy, w * 0.24, s * 0.06]);
      }
    };
    const order = list => list.sort((p, q) => uv(p[0], p[1])[1] - uv(q[0], q[1])[1]);
    if (K === "city_l" || K === "city_m") {
      const big = K === "city_l";
      order(big ? [[-0.4, -0.25, 1.5], [0.3, -0.38, 2.1], [0.45, 0.25, 1.2], [-0.25, 0.32, 1.0], [0.02, 0.0, 2.4]] : [[-0.32, -0.22, 1.1], [0.32, -0.3, 1.4], [0.35, 0.28, 0.9], [-0.1, 0.12, 1.7]])
        .forEach(([dx, dy, hgt]) => tower(dx, dy, hgt, s * (big ? 0.3 : 0.28), big ? ["#dbe3ec", "#bfcedc", "#93a7ba"] : ["#e6e0d6", "#cfc6b6", "#a89c88"]));
    } else if (K === "industry") {
      order([[-0.3, -0.2], [0.3, 0.15]]).forEach(([dx, dy]) => {
        const [bx, by] = at(dx, dy), w = s * 0.62, h = s * 0.26;
        shadow(g, bx, by, w * 0.7, s * 0.14, 0.2);
        box(g, bx, by, w, s * 0.34, h, "#b9c3cb", "#9aa6b0", "#76838e");
        g.fillStyle = "#7d8a95";
        for (let k = 0; k < 4; k++) fillPoly(g, [[bx - w / 2 + k * w / 4, by - h], [bx - w / 2 + (k + 0.5) * w / 4, by - h - s * 0.1], [bx - w / 2 + (k + 1) * w / 4, by - h]], "#8c99a4");
        wins.push([bx - w * 0.35, by - h * 0.6, w * 0.7, s * 0.05]);
      });
      const [cx, cy] = at(0.45, -0.35);
      g.fillStyle = "#d9dde1"; g.fillRect(cx - s * 0.04, cy - s * 0.7, s * 0.08, s * 0.7);
    } else if (K === "factory_big") {
      const [bx, by] = at(-0.05, 0.05);
      shadow(g, bx, by, s * 0.75, s * 0.2, 0.22);
      box(g, bx, by, s * 1.0, s * 0.55, s * 0.36, "#f1f4f7", "#e3e9ef", "#b9c6d2");
      g.fillStyle = "#2f63b5"; g.fillRect(bx - s * 0.5, by - s * 0.2, s * 1.0, s * 0.05);
      box(g, bx + s * 0.25, by - s * 0.36, s * 0.3, s * 0.2, s * 0.1, "#cfd8e0", "#bac6d1", "#97a6b4");
      box(g, bx - s * 0.2, by - s * 0.36, s * 0.3, s * 0.2, s * 0.1, "#cfd8e0", "#bac6d1", "#97a6b4");
      for (let c = 0; c < 5; c++) wins.push([bx - s * 0.44 + c * s * 0.19, by - s * 0.3, s * 0.12, s * 0.06]);
    } else if (K === "plant") {
      order([[-0.38, 0.05], [-0.05, -0.3]]).forEach(([dx, dy]) => {
        const [tx, ty] = at(dx, dy), r = s * 0.2, h = s * 0.32;
        shadow(g, tx, ty, r * 1.2, s * 0.1, 0.22);
        g.fillStyle = "#dfe4e8"; g.fillRect(tx - r, ty - h, 2 * r, h);
        g.beginPath(); g.ellipse(tx, ty, r, r * SQ, 0, 0, Math.PI); g.fill();
        g.beginPath(); g.ellipse(tx, ty - h, r, r * SQ, 0, 0, Math.PI * 2); g.fillStyle = "#f4f6f8"; g.fill();
        g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(tx + r * 0.3, ty - h, r * 0.7, h);
      });
      const [hx, hy] = at(0.35, 0.2);
      box(g, hx, hy, s * 0.5, s * 0.3, s * 0.3, "#c7ced4", "#aab4bd", "#87929c");
      g.fillStyle = "#e8ecef"; g.fillRect(hx + s * 0.1, hy - s * 1.0, s * 0.09, s * 0.7);
      g.fillStyle = "#3f6fb0"; g.fillRect(hx + s * 0.1, hy - s * 1.0, s * 0.09, s * 0.08);
    } else if (K === "school") {
      const [bx, by] = at(0, 0.05);
      shadow(g, bx, by, s * 0.6, s * 0.16, 0.2);
      box(g, bx, by, s * 0.8, s * 0.34, s * 0.32, "#c9785a", "#b5634a", "#8e4b37");
      box(g, bx - s * 0.05, by - s * 0.32, s * 0.16, s * 0.12, s * 0.34, "#c9785a", "#b5634a", "#8e4b37");
      g.beginPath(); g.arc(bx - s * 0.05, by - s * 0.56, s * 0.05, 0, Math.PI * 2); g.fillStyle = "#f4efe6"; g.fill();
      for (let c = 0; c < 4; c++) wins.push([bx - s * 0.34 + c * s * 0.19, by - s * 0.22, s * 0.1, s * 0.08]);
    } else if (K === "fire") {
      const [bx, by] = at(0, 0.05);
      shadow(g, bx, by, s * 0.45, s * 0.14, 0.2);
      box(g, bx, by, s * 0.6, s * 0.32, s * 0.34, "#e36a5c", "#cf4a3d", "#a3362c");
      g.fillStyle = "#f5e9d6"; g.fillRect(bx - s * 0.22, by - s * 0.2, s * 0.18, s * 0.2); g.fillRect(bx + s * 0.04, by - s * 0.2, s * 0.18, s * 0.2);
      box(g, bx + s * 0.22, by - s * 0.34, s * 0.12, s * 0.1, s * 0.22, "#e36a5c", "#cf4a3d", "#a3362c");
      wins.push([bx - s * 0.2, by - s * 0.3, s * 0.4, s * 0.05]);
    } else if (K === "gov") {
      const [bx, by] = at(0, 0.05);
      shadow(g, bx, by, s * 0.55, s * 0.16, 0.2);
      box(g, bx, by, s * 0.74, s * 0.36, s * 0.5, "#eef1f4", "#dfe5ea", "#b6c1cb");
      g.strokeStyle = "#5c6670"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(bx + s * 0.3, by - s * 0.5); g.lineTo(bx + s * 0.3, by - s * 0.95); g.stroke();
      g.fillStyle = "#2f63b5"; g.fillRect(bx + s * 0.3, by - s * 0.95, s * 0.2, s * 0.12);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) wins.push([bx - s * 0.3 + c * s * 0.16, by - s * 0.42 + r * s * 0.18, s * 0.09, s * 0.09]);
    } else if (K === "rail" || K === "rail_s") {
      const big = K === "rail";
      const [a0, b0] = at(-0.7, 0.32), [a1, b1] = at(0.7, -0.32);
      g.strokeStyle = "#5a524a"; g.lineWidth = Math.max(2, s * 0.08);
      g.beginPath(); g.moveTo(a0, b0); g.lineTo(a1, b1); g.stroke();
      g.strokeStyle = "#c9ccd0"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(a0, b0 - 2); g.lineTo(a1, b1 - 2); g.moveTo(a0, b0 + 2); g.lineTo(a1, b1 + 2); g.stroke();
      const [bx, by] = at(-0.05, -0.12);
      shadow(g, bx, by, s * 0.5, s * 0.14, 0.2);
      box(g, bx, by, s * (big ? 0.8 : 0.5), s * 0.3, s * (big ? 0.34 : 0.24), "#7fa9c9", "#5f8fb4", "#476f8f");
      g.fillStyle = "#e8f1f8"; g.fillRect(bx - s * (big ? 0.36 : 0.22), by - s * (big ? 0.26 : 0.18), s * (big ? 0.72 : 0.44), s * 0.06);
      wins.push([bx - s * 0.3, by - s * 0.14, s * 0.6, s * 0.05]);
    } else if (K === "farm") {
      const p = [[-0.55, 0.0], [0.05, -0.45], [0.6, 0.0], [0.0, 0.45]].map(([dx, dy]) => at(dx, dy));
      polyPath(g, p); g.fillStyle = "rgba(120,190,90,0.7)"; g.fill();
      g.strokeStyle = "#5fb0e0"; g.lineWidth = Math.max(1.5, s * 0.05);
      g.beginPath(); const [c0, d0] = at(-0.5, 0.05), [c1, d1] = at(0.55, -0.05); g.moveTo(c0, d0); g.lineTo(c1, d1); g.stroke();
      const [bx, by] = at(0.2, 0.15);
      box(g, bx, by, s * 0.3, s * 0.2, s * 0.22, "#d8d2c4", "#c3bba9", "#9e957f");
      wins.push([bx - s * 0.08, by - s * 0.15, s * 0.1, s * 0.07]);
    } else if (K === "livestock") {
      order([[-0.3, -0.15], [0.3, 0.2]]).forEach(([dx, dy]) => {
        const [bx, by] = at(dx, dy);
        shadow(g, bx, by, s * 0.38, s * 0.12, 0.2);
        box(g, bx, by, s * 0.5, s * 0.24, s * 0.2, "#b85a45", "#e9e1d2", "#c6bba6");
        fillPoly(g, [[bx - s * 0.27, by - s * 0.2], [bx, by - s * 0.34], [bx + s * 0.27, by - s * 0.2]], "#a5503d");
        wins.push([bx - s * 0.15, by - s * 0.12, s * 0.3, s * 0.04]);
      });
      const [cx, cy] = at(0.45, -0.3);
      g.fillStyle = "#c9d0d6"; g.fillRect(cx - s * 0.08, cy - s * 0.5, s * 0.16, s * 0.5);
      g.beginPath(); g.ellipse(cx, cy - s * 0.5, s * 0.08, s * 0.05, 0, 0, Math.PI * 2); g.fillStyle = "#e4e9ed"; g.fill();
    } else if (K === "water") {
      order([[-0.3, -0.1], [0.3, 0.15], [0.25, -0.35]]).forEach(([dx, dy]) => {
        const [tx, ty] = at(dx, dy), r = s * 0.22;
        g.beginPath(); g.ellipse(tx, ty, r, r * SQ, 0, 0, Math.PI * 2); g.fillStyle = "#b8c1c8"; g.fill();
        g.beginPath(); g.ellipse(tx, ty - 1, r * 0.82, r * 0.82 * SQ, 0, 0, Math.PI * 2); g.fillStyle = "#4f9fc8"; g.fill();
      });
      const [bx, by] = at(-0.35, 0.3);
      box(g, bx, by, s * 0.28, s * 0.18, s * 0.2, "#e2e6e9", "#cfd5da", "#a9b2ba");
      wins.push([bx - s * 0.08, by - s * 0.14, s * 0.1, s * 0.07]);
    } else if (K === "gridpt") {
      const [bx, by] = at(-0.1, 0.1);
      g.strokeStyle = "#5e6872"; g.lineWidth = 1;
      polyPath(g, [[-0.45, -0.1], [0.15, -0.4], [0.55, 0.0], [0.0, 0.35]].map(([dx, dy]) => at(dx, dy))); g.fillStyle = "rgba(170,175,180,0.6)"; g.fill(); g.stroke();
      box(g, bx, by, s * 0.24, s * 0.18, s * 0.2, "#9aa3ab", "#7f8992", "#646d75");
      box(g, bx + s * 0.26, by - s * 0.05, s * 0.2, s * 0.16, s * 0.16, "#9aa3ab", "#7f8992", "#646d75");
      const [px, py] = at(0.25, -0.25);
      g.strokeStyle = "#2f3a44"; g.lineWidth = Math.max(1.2, s * 0.045);
      g.beginPath(); g.moveTo(px - s * 0.14, py); g.lineTo(px, py - s * 0.95); g.lineTo(px + s * 0.14, py); g.moveTo(px - s * 0.24, py - s * 0.75); g.lineTo(px + s * 0.24, py - s * 0.75); g.moveTo(px - s * 0.18, py - s * 0.5); g.lineTo(px + s * 0.18, py - s * 0.5); g.stroke();
      g.fillStyle = "#ffd25a";
      fillPoly(g, [[bx + s * 0.02, by - s * 0.18], [bx - s * 0.05, by - s * 0.08], [bx, by - s * 0.08], [bx - s * 0.03, by - s * 0.01], [bx + s * 0.06, by - s * 0.12], [bx + s * 0.01, by - s * 0.12]], "#ffd25a");
    }
  }

  // 플레이어 건물(정적 부분). rec가 있으면 움직이는 부분의 위치를 기록한다.
  function drawBuilding(g, type, T, rec, bi) {
    const [x, y] = tileTop(T), s = V.S;
    if (type === "solar") {
      shadow(g, x, y + s * 0.05, s * 0.62, s * 0.2, 0.2);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        const px = x - s * 0.42 + c * s * 0.46 + r * s * 0.06, py = y - s * 0.12 + r * s * 0.26 - c * s * 0.02;
        const w = s * 0.4, hgt = s * 0.2, sk = s * 0.08;
        g.fillStyle = "#59636d"; g.fillRect(px + w * 0.45, py - 1, 1.5, s * 0.1);
        fillPoly(g, [[px, py], [px + w, py], [px + w + sk, py - hgt], [px + sk, py - hgt]], "#d6e1ea");
        fillPoly(g, [[px + 1.2, py - 1], [px + w - 1.2, py - 1], [px + w + sk - 1.5, py - hgt + 1.2], [px + sk + 1.5, py - hgt + 1.2]], "#284b8c");
        g.strokeStyle = "rgba(160,200,255,0.45)"; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(px + w * 0.5, py - 1); g.lineTo(px + w * 0.5 + sk, py - hgt + 1); g.moveTo(px + sk * 0.5 + 1, py - hgt / 2); g.lineTo(px + w + sk * 0.5 - 1, py - hgt / 2); g.stroke();
        fillPoly(g, [[px + w * 0.55, py - 1], [px + w * 0.75, py - 1], [px + w * 0.82 + sk, py - hgt + 1.2], [px + w * 0.66 + sk, py - hgt + 1.2]], "rgba(255,255,255,0.14)");
      }
    } else if (type === "wind") {
      const H = s * 1.45;
      shadow(g, x, y, s * 0.2, s * 0.08, 0.25);
      g.strokeStyle = "rgba(10,24,30,0.18)"; g.lineWidth = Math.max(1, s * 0.05);
      g.beginPath(); g.moveTo(x + s * 0.05, y + s * 0.02); g.lineTo(x + s * 0.75, y + s * 0.28); g.stroke();
      fillPoly(g, [[x - s * 0.055, y], [x + s * 0.055, y], [x + s * 0.025, y - H], [x - s * 0.025, y - H]], "#eef3f7");
      fillPoly(g, [[x + s * 0.005, y], [x + s * 0.055, y], [x + s * 0.025, y - H], [x + s * 0.005, y - H]], "#bcc7d1");
      g.fillStyle = "#dfe6ec"; g.fillRect(x - s * 0.1, y - H - s * 0.06, s * 0.2, s * 0.09);
      if (rec) rec.hubs.push({ x, y: y - H - s * 0.02, len: s * 0.72, tile: T.i, bi });
    } else if (type === "diesel") {
      shadow(g, x, y, s * 0.5, s * 0.17, 0.24);
      box(g, x - s * 0.04, y + s * 0.04, s * 0.62, s * 0.38, s * 0.34, "#a9b2bb", "#8d96a0", "#6b737c");
      g.fillStyle = "#5c646d";
      for (let k = 0; k < 3; k++) g.fillRect(x - s * 0.28 + k * s * 0.2, y - s * 0.2, s * 0.12, s * 0.12);
      const cx = x + s * 0.22, cy = y - s * 0.22;
      g.fillStyle = "#e8ecef"; g.fillRect(cx - s * 0.05, cy - s * 0.62, s * 0.1, s * 0.62);
      g.fillStyle = "#c9473b"; g.fillRect(cx - s * 0.05, cy - s * 0.62, s * 0.1, s * 0.1); g.fillRect(cx - s * 0.05, cy - s * 0.4, s * 0.1, s * 0.08);
      if (rec) rec.stacks.push({ x: cx, y: cy - s * 0.64, bi, tile: T.i });
    } else if (type === "roof") {
      const [bx, by] = [x + s * 0.28, y + s * 0.28];
      fillPoly(g, [[bx - s * 0.28, by], [bx + s * 0.22, by], [bx + s * 0.3, by - s * 0.16], [bx - s * 0.2, by - s * 0.16]], "#1d3f78");
      g.strokeStyle = "#d6e1ea"; g.lineWidth = 1; g.stroke();
      g.strokeStyle = "rgba(160,200,255,0.5)"; g.beginPath(); g.moveTo(bx - s * 0.03, by); g.lineTo(bx + s * 0.05, by - s * 0.16); g.stroke();
      g.beginPath(); g.arc(bx + s * 0.32, by - s * 0.22, Math.max(4, s * 0.12), 0, Math.PI * 2); g.fillStyle = "#ffd25a"; g.fill();
      g.strokeStyle = "#5a4600"; g.lineWidth = 1; g.stroke();
    } else if (type === "offshore") {
      const H = s * 1.55;
      g.beginPath(); g.ellipse(x, y, s * 0.2, s * 0.08, 0, 0, Math.PI * 2); g.fillStyle = "#e3b23c"; g.fill();
      g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y + 2, s * 0.32, s * 0.12, 0, 0, Math.PI * 2); g.stroke();
      fillPoly(g, [[x - s * 0.06, y], [x + s * 0.06, y], [x + s * 0.028, y - H], [x - s * 0.028, y - H]], "#eef3f7");
      fillPoly(g, [[x + s * 0.005, y], [x + s * 0.06, y], [x + s * 0.028, y - H], [x + s * 0.005, y - H]], "#bcc7d1");
      g.fillStyle = "#dfe6ec"; g.fillRect(x - s * 0.11, y - H - s * 0.06, s * 0.22, s * 0.1);
      if (rec) rec.hubs.push({ x, y: y - H - s * 0.02, len: s * 0.8, tile: T.i, bi, sea: true });
    } else if (type === "tidal") {
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.2;
      for (let k = 0; k < 2; k++) { g.beginPath(); g.ellipse(x, y + 2, s * (0.3 + k * 0.14), s * (0.11 + k * 0.05), 0, 0, Math.PI * 2); g.stroke(); }
      box(g, x, y + s * 0.04, s * 0.5, s * 0.16, s * 0.14, "#d7dde2", "#b9c2c9", "#909ba4");
      g.fillStyle = "#e3b23c"; g.fillRect(x - s * 0.25, y - s * 0.16, s * 0.5, s * 0.05);
      g.beginPath(); g.arc(x + s * 0.32, y - s * 0.12, s * 0.07, 0, Math.PI * 2); g.fillStyle = "#e05a3c"; g.fill();
    } else if (type === "hydro") {
      box(g, x, y + s * 0.05, s * 0.6, s * 0.14, s * 0.16, "#d2d6da", "#b8bec4", "#949ba2");
      g.fillStyle = "rgba(255,255,255,0.75)";
      for (let k = 0; k < 3; k++) g.fillRect(x - s * 0.22 + k * s * 0.18, y + s * 0.05, s * 0.08, s * 0.12);
      box(g, x + s * 0.2, y - s * 0.11, s * 0.2, s * 0.14, s * 0.16, "#9fb3c4", "#8397a9", "#6b7f90");
    } else if (type === "biomass") {
      shadow(g, x, y, s * 0.5, s * 0.17, 0.22);
      box(g, x - s * 0.12, y + s * 0.04, s * 0.48, s * 0.34, s * 0.3, "#c3b48c", "#a8986e", "#857654");
      g.fillStyle = "#9db08a"; g.fillRect(x + s * 0.18, y - s * 0.42, s * 0.18, s * 0.44);
      g.beginPath(); g.ellipse(x + s * 0.27, y - s * 0.42, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); g.fillStyle = "#b8c9a6"; g.fill();
      const cx = x - s * 0.22, cy = y - s * 0.26;
      g.fillStyle = "#e8ecef"; g.fillRect(cx - s * 0.04, cy - s * 0.48, s * 0.08, s * 0.48);
      g.fillStyle = "#4f9a4a"; g.beginPath(); g.ellipse(x - s * 0.05, y - s * 0.12, s * 0.09, s * 0.05, -0.6, 0, Math.PI * 2); g.fill();
      if (rec) rec.stacks.push({ x: cx, y: cy - s * 0.5, bi, tile: T.i });
    } else if (type === "uni") {
      shadow(g, x, y + s * 0.05, s * 0.7, s * 0.2, 0.22);
      box(g, x - s * 0.18, y + s * 0.05, s * 0.62, s * 0.28, s * 0.36, "#c9785a", "#b5634a", "#8e4b37");
      box(g, x + s * 0.3, y + s * 0.12, s * 0.36, s * 0.24, s * 0.26, "#d9d2c3", "#c3baa8", "#9d9483");
      box(g, x - s * 0.22, y - s * 0.3, s * 0.16, s * 0.12, s * 0.4, "#c9785a", "#b5634a", "#8e4b37");
      g.beginPath(); g.arc(x - s * 0.22, y - s * 0.6, s * 0.06, 0, Math.PI * 2); g.fillStyle = "#f4efe6"; g.fill();
      g.fillStyle = "rgba(255,240,200,0.85)";
      for (let c = 0; c < 4; c++) g.fillRect(x - s * 0.44 + c * s * 0.15, y - s * 0.16, s * 0.08, s * 0.07);
    } else if (type === "lab") {
      shadow(g, x, y + s * 0.05, s * 0.55, s * 0.18, 0.22);
      box(g, x, y + s * 0.06, s * 0.6, s * 0.3, s * 0.4, "#e8eef3", "#c9d4dd", "#9fb0be");
      g.fillStyle = "#3f6fb0";
      for (let c = 0; c < 3; c++) g.fillRect(x - s * 0.24 + c * s * 0.17, y - s * 0.2, s * 0.11, s * 0.08);
      g.strokeStyle = "#5b6874"; g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath(); g.moveTo(x + s * 0.14, y - s * 0.34); g.lineTo(x + s * 0.14, y - s * 0.6); g.stroke();
      g.beginPath(); g.ellipse(x + s * 0.14, y - s * 0.66, s * 0.16, s * 0.07, -0.4, 0, Math.PI * 2); g.fillStyle = "#f4f6f8"; g.fill(); g.stroke();
      g.strokeStyle = "rgba(90,176,230,0.8)";
      for (let r = 1; r < 3; r++) { g.beginPath(); g.arc(x + s * 0.14, y - s * 0.7, s * 0.1 * r, -2.4, -0.7); g.stroke(); }
    } else if (type === "battery") {
      shadow(g, x, y, s * 0.52, s * 0.18, 0.22);
      for (let k = 1; k >= 0; k--) {
        const bx = x - s * 0.05 + k * s * 0.1, by = y - s * 0.02 + k * -s * 0.16 + s * 0.16;
        box(g, bx, by, s * 0.66, s * 0.22, s * 0.26, "#62cbbd", "#2ea395", "#21796f");
        g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 0.8;
        for (let r = 1; r < 4; r++) { g.beginPath(); g.moveTo(bx - s * 0.33 + r * s * 0.165, by - s * 0.26); g.lineTo(bx - s * 0.33 + r * s * 0.165, by); g.stroke(); }
      }
      g.fillStyle = "#ffe07a";
      const bx = x - s * 0.05, by = y + s * 0.02;
      fillPoly(g, [[bx + s * 0.03, by - s * 0.24], [bx - s * 0.07, by - s * 0.1], [bx, by - s * 0.1], [bx - s * 0.04, by - s * 0.01], [bx + s * 0.07, by - s * 0.15], [bx, by - s * 0.15]], "#ffe07a");
    }
  }
  function pylonTop(T) { const [x, y] = tileTop(T); return [x, y - V.S * 0.55]; }
  function drawPylon(g, T) {
    const [x, y] = tileTop(T), s = V.S, h = s * 0.55;
    if (T.water) { g.beginPath(); g.ellipse(x, y, s * 0.16, s * 0.07, 0, 0, Math.PI * 2); g.fillStyle = "#6c7680"; g.fill(); }
    g.strokeStyle = "#39434e"; g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath();
    g.moveTo(x - s * 0.09, y); g.lineTo(x, y - h); g.lineTo(x + s * 0.09, y);
    g.moveTo(x - s * 0.17, y - h * 0.82); g.lineTo(x + s * 0.17, y - h * 0.82);
    g.moveTo(x - s * 0.06, y - h * 0.4); g.lineTo(x + s * 0.06, y - h * 0.4);
    g.stroke();
  }
  function wirePath(g, A, B, sag) {
    g.moveTo(A[0], A[1]);
    g.quadraticCurveTo((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + sag, B[0], B[1]);
  }

  // 하천은 '물 칸'이 아니라 땅 위를 지나는 물줄기로 그린다: 이웃한 하천·호수·바다 쪽 변으로 띠를 잇는다(끊김이 눈에 보이게).
  const WATERY = t => t === "river" || t === "lake" || t === "sea";
  function drawRiver(g, T, top, dim) {
    polyPath(g, top);
    g.fillStyle = rgb(mul(PAL.plain, dim ? 0.8 : 0.96)); g.fill();
    if (dim) { g.fillStyle = "rgba(70,84,96,0.5)"; g.fill(); }
    g.strokeStyle = "rgba(20,40,30,0.18)"; g.lineWidth = 1; g.stroke();
    const h = HGT[T.vt || T.t], [cx, cy] = scr(T.X, T.Y, h);
    const ends = T.nb.map(j => TILES[j]).filter(N => WATERY(N.vt || N.t)).map(N => scr((T.X + N.X) / 2, (T.Y + N.Y) / 2, h));
    g.lineCap = "round"; g.lineJoin = "round";
    [[V.S * 0.42, "rgba(230,245,255,0.55)"], [V.S * 0.3, dim ? "rgba(70,130,175,0.75)" : rgb(PAL.river)]].forEach(([w, col]) => {
      g.strokeStyle = col; g.lineWidth = w;
      if (!ends.length) { g.beginPath(); g.arc(cx, cy, w / 2, 0, Math.PI * 2); g.fillStyle = col; g.fill(); return; }
      ends.forEach(([x, y]) => { g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); });
    });
  }
  function drawTile(g, T, layer) {
    const vt = T.vt || T.t, h = HGT[vt];
    const top = topPoly(T, h), bot = topPoly(T, BASE);
    const [cu, cv] = uv(T.X, T.Y);
    if (T.t === "sea") {
      const shallow = T.nb.some(j => TILES[j].land && !TILES[j].out);
      polyPath(g, topPoly(T, 0, 1.0));
      g.fillStyle = shallow ? "rgba(140,225,235,0.32)" : "rgba(255,255,255,0.025)";
      g.fill();
      if (layer === "wind" && T.wind > 0 && T.dshore <= 3) { g.fillStyle = rgb(ramp(RAMPS.wind, layerVal(T, "wind")), 0.6); g.fill(); }
      if (layer === "map" && (T.tidal || T.offshore) && PK.climate) { g.strokeStyle = T.tidal ? "rgba(255,226,140,0.35)" : "rgba(255,255,255,0.12)"; g.lineWidth = 1.2; g.stroke(); }
      g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1; g.stroke();
      return;
    }
    if (T.t === "river") { drawRiver(g, T, top, false); return; }
    if (T.t === "lake") {
      polyPath(g, top);
      g.fillStyle = rgb(PAL[T.t]); g.fill();
      g.strokeStyle = "rgba(200,240,255,0.35)"; g.lineWidth = 1;
      const [cx, cy] = tileTop(T);
      g.beginPath(); g.moveTo(cx - V.S * 0.3, cy); g.quadraticCurveTo(cx, cy - V.S * 0.08, cx + V.S * 0.3, cy); g.stroke();
      return;
    }
    let base = PAL[vt] || PAL[T.t];
    if (layer !== "map" && !T.out) base = ramp(RAMPS[layer], layerVal(T, layer));
    const jit = layer === "map" ? 1 + (hash(T.c, T.r, 9) - 0.5) * 0.07 : 1;
    const sideC = vt === "beach" ? PAL.sand : vt === "mount" ? PAL.rock : PAL.earth;
    // 보이는 옆면(화면 아래쪽을 향하는 변)
    for (let k = 0; k < 6; k++) {
      const j = (k + 1) % 6;
      const mu = (uv(T.X + (CORN[k][0] + CORN[j][0]) / 2, T.Y + (CORN[k][1] + CORN[j][1]) / 2));
      const nv = mu[1] - cv, nu = mu[0] - cu;
      if (nv < 0.05) continue;
      const f = nu > 0.2 ? 0.66 : nu < -0.2 ? 0.86 : 0.76;
      fillPoly(g, [top[k], top[j], bot[j], bot[k]], rgb(mul(sideC, f)));
      // 물가 거품 띠
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(bot[k][0], bot[k][1] - V.S * 0.12); g.lineTo(bot[j][0], bot[j][1] - V.S * 0.12); g.stroke();
    }
    polyPath(g, top);
    g.fillStyle = rgb(mul(base, jit)); g.fill();
    if (T.out) { g.fillStyle = T.vt ? "rgba(70,84,96,0.5)" : "rgba(190,205,215,0.28)"; g.fill(); if (T.vt === "river") drawRiver(g, T, top, true); return; }
    g.strokeStyle = layer === "map" ? "rgba(20,40,30,0.18)" : "rgba(10,20,40,0.35)"; g.lineWidth = 1; g.stroke();
    // 위쪽 변 하이라이트
    g.strokeStyle = "rgba(255,255,255,0.16)";
    g.beginPath(); g.moveTo(top[5][0], top[5][1]); g.lineTo(top[0][0], top[0][1]); g.lineTo(top[1][0], top[1][1]); g.stroke();
  }
  function drawDeco(g, T, layer) {
    if (!T.land) return;
    const s = V.S, at = (dx, dy, e = 0) => scr(T.X + dx, T.Y + dy, HGT[T.t] + e);
    const soft = layer !== "map";
    if (soft) g.globalAlpha = 0.55;
    if (T.t === "forest") {
      [[-0.38, -0.28], [0.34, -0.3], [0.0, 0.05], [-0.4, 0.38], [0.38, 0.36]].sort((p, q) => uv(p[0], p[1])[1] - uv(q[0], q[1])[1]).forEach(([dx, dy], k) => {
        const [x, y] = at(dx + (hash(T.c, T.r, k) - 0.5) * 0.15, dy);
        pine(g, x, y, s * (0.5 + hash(T.c, T.r, k + 20) * 0.18), 0.92 + hash(T.r, T.c, k) * 0.16);
      });
    } else if (T.t === "mount") {
      const [x2, y2] = at(0.3, -0.25); peak(g, x2, y2, s * 0.42, s * 0.65, false);
      const [x, y] = at(-0.08, 0.1); peak(g, x, y, s * 0.62, s * 1.0, true);
    } else if (T.t === "hill") {
      [[-0.3, -0.1, 0.42], [0.3, 0.2, 0.34]].forEach(([dx, dy, r]) => {
        const [x, y] = at(dx, dy);
        g.beginPath(); g.ellipse(x, y, s * r, s * r * 0.55, 0, Math.PI, 0); g.fillStyle = soft ? "rgba(255,255,255,0.12)" : "#b9cd7d"; g.fill();
        g.beginPath(); g.ellipse(x + s * r * 0.35, y, s * r * 0.6, s * r * 0.4, 0, Math.PI * 1.1, 0); g.fillStyle = soft ? "rgba(0,0,0,0.08)" : "#93a95c"; g.fill();
      });
      if (!soft && hash(T.c, T.r, 4) > 0.5) { const [x, y] = at(0.35, -0.35); roundTree(g, x, y, s * 0.45); }
    } else if (T.t === "plain" && !soft) {
      if (hash(T.c, T.r, 6) > 0.55) {
        // 밭 줄무늬
        const p = [[-0.5, -0.1], [0.2, -0.45], [0.55, 0.0], [-0.15, 0.35]].map(([dx, dy]) => at(dx, dy));
        polyPath(g, p); g.fillStyle = hash(T.c, T.r, 8) > 0.5 ? "rgba(214,196,96,0.55)" : "rgba(120,170,70,0.6)"; g.fill();
        g.strokeStyle = "rgba(80,110,40,0.35)"; g.lineWidth = 1;
        for (let k = 1; k < 4; k++) { const a = mixP(p[0], p[3], k / 4), b = mixP(p[1], p[2], k / 4); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      } else if (hash(T.c, T.r, 7) > 0.4) { const [x, y] = at(0.3, 0.2); roundTree(g, x, y, s * 0.45); }
    } else if (T.t === "urban" && T.site < 0) {
      [[-0.35, -0.2, 0.9], [0.3, -0.3, 1.2], [0.05, 0.25, 0.7], [-0.35, 0.3, 0.6]].sort((p, q) => uv(p[0], p[1])[1] - uv(q[0], q[1])[1]).forEach(([dx, dy, hg], k) => {
        const [bx, by] = at(dx, dy), h = s * 0.28 * hg * (0.8 + hash(T.c, T.r, k) * 0.5);
        box(g, bx, by, s * 0.26, s * 0.2, h, "#d9dde0", "#c4cacf", "#9ba3aa");
      });
    } else if (T.t === "beach" && PK.climate && !soft) {
      g.strokeStyle = "rgba(120,100,70,0.45)"; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { const [a0, b0] = at(-0.5, -0.2 + k * 0.2), [a1, b1] = at(0.5, -0.1 + k * 0.2); g.beginPath(); g.moveTo(a0, b0); g.quadraticCurveTo((a0 + a1) / 2, b0 - 3, a1, b1); g.stroke(); }
    } else if (T.t === "beach" && !soft && hash(T.c, T.r, 2) > 0.62) {
      const [x, y] = at(0.2, 0);
      g.strokeStyle = "#8a6a44"; g.lineWidth = Math.max(1, s * 0.05);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * 0.12, y - s * 0.3, x + s * 0.05, y - s * 0.55); g.stroke();
      g.fillStyle = "#4f9a4a";
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.7; g.beginPath(); g.ellipse(x + s * 0.05 + Math.cos(a) * s * 0.16, y - s * 0.55 + Math.sin(a) * s * 0.08 + s * 0.04, s * 0.17, s * 0.05, a, 0, Math.PI * 2); g.fill(); }
    }
    if (soft) g.globalAlpha = 1;
  }
  const mixP = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  // 시설 표지 색: 필수(빨강) · 주거(주황) · 산업(파랑) · 농축산(초록) · 공급(회색)
  const badgeCol = k => (CRIT[k] ? "#c0392b" : k === "plant" || k === "gridpt" ? "#4a5560" : k === "port" || k === "industry" || k === "factory_big" ? "#2c5f9e" : k === "farm" || k === "livestock" ? "#2e7d4a" : "#a35a12");

  // 정적 층: 지형·마을·건물·전선. 바뀔 때만 다시 그린다.
  function paintStatic() {
    const st = S.st, layer = S.layer, dpr = dprOf();
    const c = S.base;
    const PW = Math.round(V.W * dpr), PH = Math.round(V.H * dpr);
    if (c.width !== PW) c.width = PW;
    if (c.height !== PH) c.height = PH;
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, PW, PH);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineJoin = "round";
    const rec = { hubs: [], stacks: [], wins: [], pylons: new Map() };
    const rising = new Set(S.mapFx.filter(f => f.kind === "place").map(f => f.i));
    const growing = new Set(S.mapFx.filter(f => f.kind === "line").map(f => f.key));
    const bAt = new Map(st.builds.map((b, bi) => [b.i, bi]));
    const lineTiles = new Set();
    st.lines.forEach(L => L.p.forEach(i => lineTiles.add(i)));
    for (const T of ORDER) {
      drawTile(g, T, layer);
      if (T.site >= 0) drawTown(g, T, rec);
      if (bAt.has(T.i)) {
        const bi = bAt.get(T.i);
        if (!rising.has(T.i)) drawBuilding(g, st.builds[bi].t, T, rec, bi);
      } else if (T.site < 0 && !T.out) drawDeco(g, T, layer);
      if (lineTiles.has(T.i)) { drawPylon(g, T); rec.pylons.set(T.i, pylonTop(T)); }
    }
    // 전선(모든 타일 위)
    g.strokeStyle = "rgba(24,30,38,0.85)"; g.lineWidth = Math.max(1, V.S * 0.035);
    g.beginPath();
    st.lines.forEach(L => { if (!growing.has(`l:${L.p.join("-")}`)) for (let k = 1; k < L.p.length; k++) wirePath(g, rec.pylons.get(L.p[k - 1]), rec.pylons.get(L.p[k]), V.S * 0.08); });
    g.stroke();
    // 데이터 층 숫자
    if (layer !== "map" && V.S >= 21) {
      g.font = `600 ${Math.round(clamp(V.S * 0.36, 9, 13))}px "IBM Plex Mono", ui-monospace, monospace`;
      g.textAlign = "center"; g.textBaseline = "middle";
      TILES.forEach(T => {
        if (T.out || (!T.land && !(layer === "wind" && T.t === "sea" && T.wind > 0 && T.dshore <= 3))) return;
        const t = layerTxt(T, layer);
        if (!t) return;
        const [x, y] = tileTop(T);
        g.lineWidth = 3; g.strokeStyle = "rgba(6,16,30,0.85)"; g.strokeText(t, x, y + V.S * 0.32);
        g.fillStyle = "#f4f8fc"; g.fillText(t, x, y + V.S * 0.32);
      });
    }
    // 도시 지도 시설 표지: 종류별 색 동그라미 + 한 글자
    if (PK.climate) {
      const fs = Math.round(clamp(V.S * 0.34, 9, 14));
      g.font = `700 ${fs}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      SITES.forEach(W => {
        const T = TILES[W.tile], [x, y] = tileTop(T), r = Math.max(8, fs * 0.85);
        const bx = x - V.S * 0.5, by = y - V.S * 0.42;
        g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2);
        g.fillStyle = badgeCol(W.kind); g.fill();
        g.lineWidth = 1.5; g.strokeStyle = "#ffffff"; g.stroke();
        g.fillStyle = "#ffffff"; g.fillText(W.code, bx, by + 0.5);
      });
    }
    // 표시: 숲 정리, 연결 안 됨
    st.builds.forEach((b, bi) => {
      const T = TILES[b.i], [x, y] = tileTop(T), s = V.S;
      if (T.t === "forest") {
        const lx = x - s * 0.55, ly = y - s * 0.05;
        g.beginPath(); g.arc(lx, ly, Math.max(5, s * 0.17), 0, Math.PI * 2); g.fillStyle = "#1d5a33"; g.fill();
        g.strokeStyle = "#ffffff"; g.lineWidth = 1.4; g.stroke();
        g.strokeStyle = "#ffffff"; g.beginPath(); g.moveTo(lx - s * 0.08, ly); g.lineTo(lx + s * 0.08, ly); g.stroke();
      }
      const n = S.net.nodes.find(nd => nd.bi === bi);
      if (n && !n.live) {
        const bx = x + s * 0.5, by = y - s * 0.75;
        g.beginPath(); g.arc(bx, by, Math.max(6, s * 0.2), 0, Math.PI * 2); g.fillStyle = "#dc4f6a"; g.fill();
        g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = "#fff"; g.font = `700 ${Math.max(9, s * 0.28)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", bx, by + 0.5);
      }
    });
    S.rec = rec;
  }

  /* ---------- 움직이는 층 ---------- */
  function paintSea(g, t, night) {
    const grd = g.createLinearGradient(0, 0, 0, V.H);
    grd.addColorStop(0, "#1b5f86"); grd.addColorStop(0.55, "#2378a0"); grd.addColorStop(1, "#175274");
    g.fillStyle = grd; g.fillRect(0, 0, V.W, V.H);
    const step = 46;
    g.lineWidth = 1.4; g.lineCap = "round";
    for (let y = -step, row = 0; y < V.H + step; y += step * 0.6, row++) {
      for (let x = -step + (row % 2) * step * 0.5; x < V.W + step; x += step) {
        const hsh = hash(x | 0, row, 31), ph = t * (0.5 + hsh * 0.6) + hsh * 6.28;
        const a = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(ph));
        const ox = Math.sin(ph * 0.7) * 5;
        g.strokeStyle = `rgba(200,240,255,${a.toFixed(3)})`;
        g.beginPath(); g.moveTo(x + ox - 7, y + hsh * 20); g.quadraticCurveTo(x + ox, y + hsh * 20 - 3, x + ox + 7, y + hsh * 20); g.stroke();
      }
    }
  }
  function curHour() {
    const R = S.run;
    if (!R) return null;
    const k = clamp(R.k, 0, R.res.H - 1);
    return { k, d: Math.floor(k / 24), h: k % 24 };
  }
  function paintMapEffects(g, now, t) {
    const s = V.S;
    S.mapFx.forEach(f => {
      const { p, scale, alpha, drop } = mapMotion.pose(f, now);
      if (f.p) {
        const points = f.p.map(i => pylonTop(TILES[i]));
        const lengths = points.slice(1).map((B, i) => Math.hypot(B[0] - points[i][0], B[1] - points[i][1]));
        let left = lengths.reduce((a, b) => a + b, 0) * (f.kind === "line" ? Math.min(1, p / 0.75) : 1);
        g.save();
        if (f.kind === "unline") { g.globalAlpha = alpha; g.translate(0, drop * s); }
        g.strokeStyle = "rgba(24,30,38,0.85)"; // 정적 선과 같아 캐시 복귀 때 색이 튀지 않는다.
        g.lineWidth = Math.max(1, s * 0.035); g.beginPath();
        for (let j = 0; j < lengths.length && left > 0; j++) {
          const A = points[j], B = points[j + 1], u = Math.min(1, left / Math.max(0.001, lengths[j]));
          const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2 + s * 0.08;
          const qx = lerp(A[0], cx, u), qy = lerp(A[1], cy, u);
          g.moveTo(A[0], A[1]);
          g.quadraticCurveTo(qx, qy, lerp(qx, lerp(cx, B[0], u), u), lerp(qy, lerp(cy, B[1], u), u));
          left -= lengths[j];
        }
        g.stroke();
        if (f.kind === "line" && p >= 0.75) {
          const [x, y] = points[points.length - 1], flash = Math.sin((p - 0.75) * 4 * Math.PI);
          g.globalAlpha = Math.max(0, flash); g.fillStyle = MAP_INK.cyan;
          g.beginPath(); g.arc(x, y, 2 + s * 0.12 * flash, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        if (f.kind === "line") return;
      } else {
        const T = TILES[f.i], [x, y] = tileTop(T), rec = { hubs: [], stacks: [] };
        g.save(); g.globalAlpha = alpha;
        g.translate(x, y + drop * s); g.scale(1, scale); g.translate(-x, -y);
        drawBuilding(g, f.t, T, rec, -1);
        paintHubs(g, rec.hubs, t, S.run, curHour());
        g.restore();
      }
      // 8개의 먼지 원: 타일 바닥에서 타원 고리로 퍼진다.
      const [x, y] = tileTop(TILES[f.i]);
      g.save(); g.globalAlpha = (1 - p) * 0.65; g.fillStyle = MAP_INK.dust;
      for (let j = 0; j < 8; j++) {
        const a = j * Math.PI / 4, r = s * (0.2 + p * 0.65);
        g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * SQ,
          Math.max(0.5, s * (0.055 + p * 0.055)), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    });
  }
  function paintPowerFlow(g, t, R, ch, rm) {
    const res = R.res, s = V.S;
    if (S.flowView?.net !== S.net || S.flowView?.res !== res) {
      S.flowView = { net: S.net, res, routes: mapMotion.flowRoutes(S.net, res, S.st.lines), k: -1,
        phase: new Float32Array(res.E), time: t };
    }
    const view = S.flowView;
    if (view.k !== ch.k || view.rm !== rm) {
      view.marks = mapMotion.flowMarks(res, ch.k, view.routes, rm, R.replay ? 0 : OUT_EPS(),
        !!R.replay, R.replay ? R.opts.outHour : undefined);
      view.k = ch.k; view.rm = rm;
    }
    const dt = rm ? 0 : clamp(t - view.time, 0, 0.1); view.time = t;
    g.save(); g.lineCap = "round";
    view.marks.forEach(m => {
      const A = S.rec.pylons.get(m.from), B = S.rec.pylons.get(m.to);
      if (!A || !B) return;
      const w = 1.2 + Math.min(7, m.amount * 1.3);
      g.globalAlpha = m.outage ? 0.45 : 0.4;
      g.strokeStyle = m.outage ? MAP_INK.danger : MAP_INK.cyan; g.lineWidth = w + 3;
      g.beginPath(); wirePath(g, A, B, s * 0.08); g.stroke();
      g.globalAlpha = 1; g.strokeStyle = "rgba(200,250,255,0.9)"; g.lineWidth = Math.max(1, w * 0.4);
      g.beginPath(); wirePath(g, A, B, s * 0.08); g.stroke();
      view.phase[m.e] = (view.phase[m.e] + dt * m.speed) % 1;
      g.globalAlpha = 1; g.fillStyle = "#f2feff";
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2 + s * 0.08;
      for (let j = 0; j < m.count; j++) {
        const u = rm ? (j + 0.5) / m.count : (view.phase[m.e] + j / m.count + m.e * 0.17) % 1;
        const x = (1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * mx + u * u * B[0];
        const y = (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * my + u * u * B[1];
        g.beginPath(); g.arc(x, y, 1.6 + Math.min(3, m.amount * 0.5), 0, Math.PI * 2); g.fill();
      }
    });
    g.restore();
  }
  function paintHubs(g, hubs, anim, R, ch) {
    const s = V.S;
    hubs.forEach(hb => {
      let v = TILES[hb.tile].wind;
      if (ch) v *= R.res.hrWind[ch.k];
      const w = v > M.cutout ? 0 : 0.5 + v * 0.32;
      const a0 = anim * w + hb.tile;
      g.strokeStyle = "#f5f8fa"; g.lineWidth = Math.max(1.4, s * 0.06); g.lineCap = "round";
      g.beginPath();
      for (let k = 0; k < 3; k++) { const a = a0 + k * 2.094; g.moveTo(hb.x, hb.y); g.lineTo(hb.x + Math.cos(a) * hb.len, hb.y + Math.sin(a) * hb.len); }
      g.stroke();
      g.beginPath(); g.arc(hb.x, hb.y, Math.max(1.6, s * 0.06), 0, Math.PI * 2); g.fillStyle = "#c9d3dc"; g.fill();
    });
  }
  function paintDynamic(g, t) {
    const st = S.st, R = S.run, ch = curHour(), s = V.S, rm = reduced();
    const anim = rm ? 0 : t;
    // 풍력 날개
    paintHubs(g, S.rec.hubs, anim, R, ch);
    // 디젤 연기: 서풍이라 동쪽으로 흐른다(세로 화면에서는 아래쪽)
    const [ex, ey] = (() => { const A = scr(0, 0, 0), B = scr(1, 0, 0); const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; })();
    S.rec.stacks.forEach(sk => {
      let on = true;
      if (ch) { const n = S.runNet.dk[sk.bi]; on = n !== undefined && n < 32 && (R.res.hrDiesel[ch.k] & (1 << n)) !== 0; }
      if (!on) return;
      for (let k = 0; k < 7; k++) {
        const ph = rm ? k / 7 : ((anim * 0.32 + k / 7 + sk.bi * 0.13) % 1);
        const dist = ph * s * 2.2;
        const x = sk.x + ex * dist + Math.sin(ph * 6 + k) * s * 0.05, y = sk.y + ey * dist - ph * s * 0.55;
        const r = s * (0.09 + ph * 0.3);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = `rgba(${ch ? "92,92,96" : "120,124,130"},${((1 - ph) * (ch ? 0.5 : 0.32)).toFixed(3)})`;
        g.fill();
      }
    });
    if (!ch) return;
    const wx = R.res.wx[ch.d];
    // 구름·비
    if (wx.w > 0) {
      const n = wx.w === 1 ? 6 : 9;
      for (let k = 0; k < n; k++) {
        const span = V.W + 260, sp = 14 + hash(k, ch.d, 3) * 18;
        const x = ((hash(k, ch.d, 1) * span + anim * sp) % span) - 130;
        const y = V.area.t + hash(k, ch.d, 2) * (V.area.b - V.area.t) * 0.85;
        const r = 26 + hash(k, ch.d, 4) * 26;
        g.beginPath(); g.ellipse(x + 30, y + 70, r * 1.5, r * 0.5, 0, 0, Math.PI * 2); g.fillStyle = "rgba(8,20,32,0.12)"; g.fill();
        g.fillStyle = wx.w === 1 ? "rgba(236,242,248,0.78)" : "rgba(168,180,194,0.85)";
        g.beginPath();
        [[0, 0, 1], [-0.8, 0.25, 0.7], [0.85, 0.2, 0.75], [0.3, -0.35, 0.7]].forEach(([dx, dy, rr]) => { g.moveTo(x + dx * r + rr * r, y + dy * r); g.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); });
        g.fill();
      }
      if (wx.w === 2) {
        g.strokeStyle = "rgba(200,225,245,0.35)"; g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < 90; k++) {
          const x = (hash(k, 1, 5) * V.W + anim * 60) % V.W, y = (hash(k, 2, 5) * V.H + anim * 380) % V.H;
          g.moveTo(x, y); g.lineTo(x - 4, y + 12);
        }
        g.stroke();
      }
    }
    // 낮·밤
    const e = Math.sin(Math.PI * (ch.h + 0.5 - 6) / 12);
    const dark = e <= 0 ? 0.55 : clamp(0.55 - e * 1.7, 0, 0.55);
    if (e > -0.15 && e < 0.4) { g.fillStyle = `rgba(255,140,70,${(0.13 * (1 - Math.abs(e - 0.1) / 0.4)).toFixed(3)})`; g.fillRect(0, 0, V.W, V.H); }
    if (dark > 0.01) { g.fillStyle = `rgba(6,14,40,${dark.toFixed(3)})`; g.fillRect(0, 0, V.W, V.H); }
    // 전력 흐름
    const res = R.res;
    paintPowerFlow(g, t, R, ch, rm);
    // 창문·정전 표시
    const blink = rm ? 1 : (Math.sin(t * 9) > 0 ? 1 : 0.25);
    S.rec.wins.forEach(W => {
      const uns = mapMotion.townOutage(res, ch.k, W.ti, R.replay ? 0 : OUT_EPS(), R.replay ? R.opts.outHour : undefined);
      if (dark > 0.12) {
        if (!uns) {
          const gl = g.createRadialGradient(W.x, W.y - s * 0.3, 2, W.x, W.y - s * 0.3, s * 1.3);
          gl.addColorStop(0, `rgba(255,214,120,${(dark * 0.6).toFixed(3)})`); gl.addColorStop(1, "rgba(255,214,120,0)");
          g.fillStyle = gl; g.fillRect(W.x - s * 1.4, W.y - s * 1.7, s * 2.8, s * 2.8);
        }
        g.fillStyle = uns ? "rgba(20,24,40,0.95)" : "#ffd36b";
        W.list.forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
      }
      if (uns) {
        g.strokeStyle = `rgba(255,90,120,${(0.85 * blink).toFixed(3)})`; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(W.x, W.y, s * 0.95, s * 0.95 * SQ, 0, 0, Math.PI * 2); g.stroke();
      }
    });
  }
  function paintCursor(g, t) {
    if (S.run) return;
    const hov = S.hover;
    const rm = reduced();
    // 송전선 미리보기
    const pv = S.pending ? S.pending.p : S.preview ? S.preview.p : null;
    if (pv) {
      g.save();
      g.setLineDash([6, 5]); g.lineDashOffset = rm ? 0 : -t * 20;
      g.strokeStyle = S.pending ? "#ecd083" : "rgba(236,208,131,0.8)"; g.lineWidth = 3; g.lineCap = "round";
      g.beginPath();
      pv.forEach((i, k) => { const [x, y] = pylonTop(TILES[i]); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      g.restore();
      pv.forEach(i => { const [x, y] = pylonTop(TILES[i]); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fillStyle = "#ecd083"; g.fill(); });
    }
    if (S.lineStart != null) {
      const T = TILES[S.lineStart];
      const pulse = rm ? 1 : 0.75 + 0.25 * Math.sin(t * 5);
      polyPath(g, topPoly(T)); g.lineWidth = 3; g.strokeStyle = `rgba(236,208,131,${pulse.toFixed(3)})`; g.stroke();
    }
    const show = hov != null ? hov : null;
    if (show == null) return;
    const T = TILES[show];
    const chk = S.tool && S.tool !== "line" && S.tool !== "remove" ? canPlace(S.tool, show) : null;
    polyPath(g, topPoly(T));
    g.fillStyle = chk ? (chk.ok ? "rgba(123,227,180,0.22)" : "rgba(220,120,144,0.25)") : "rgba(255,255,255,0.12)";
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = chk ? (chk.ok ? "#7be3b4" : "#ff8fa6") : S.kbd ? "#ecd083" : "rgba(255,255,255,0.85)";
    g.stroke();
    if (chk && chk.ok) { g.globalAlpha = 0.6; drawBuilding(g, S.tool, T, null, -1); g.globalAlpha = 1; }
  }
  function syncLensButtons() {
    S.root.querySelectorAll("[data-lens]").forEach(b => b.setAttribute("aria-pressed", String(S.lenses[b.dataset.lens])));
  }
  function paintLeagueLayers(g) {
    const actual = S.opts.leagueResult?.(), summary = $("#lg-map-result"), gridText = $("#lg-lens-grid");
    if (summary) {
      summary.hidden = !actual || !S.lenses.result || !!(S.run && !S.run.replay);
      summary.dataset.faded = String(!!actual?.faded);
      if (actual) {
        // MWh / representative operating hours is an actual average shortage, not a peak estimate.
        const rd = S.opts.leagueRound?.(), completedDays = actual.days || S.opts.leagueResultDays?.() || rd?.days;
        const shortage = actual.uns ?? (Number.isFinite(actual.dem) ? actual.dem * actual.unsPct / 100 : null);
        const average = Number.isFinite(shortage) && completedDays ? shortage / (completedDays * 24) : null;
        const villages = new Set((actual.cpList || []).filter(cp => cp.score > 0).map(cp => cp.near));
        const text = (actual.faded ? `지난달(${actual.month || "–"}월) 실제` : `${actual.month || "–"}월 실제`) + ` · 정전 ${fmt(actual.unsPct, 2)}%${average == null ? "" : ` · 평균 부족 ${fmt(average, 2)} MW`} · 민원 ${fmt(actual.cp)}건 · 영향 마을 ${villages.size}곳`;
        if (summary.textContent !== text) summary.textContent = text;
      }
    }
    if (gridText) {
      gridText.hidden = !S.lenses.grid;
      if (S.lenses.grid) {
        const key = JSON.stringify([S.st.builds, S.st.lines, S.st.policies, S.opts.leagueRound?.()?.month, S.opts.leagueLensStamp?.()]);
        if (S.lensCache?.key !== key) S.lensCache = { key, grid: S.opts.leagueGrid?.(S.st) };
        const grid = S.lensCache.grid, text = grid ? `접속 여유 ${fmt(grid.headroomMW, 1)} MW · 대기 ${fmt(grid.waitingMW, 1)} MW` : `선이 닿는 수요지 ${S.net.nodes.filter(n => n.kind === "town" && n.live).length}/${TOWNS.length}`;
        if (gridText.textContent !== text) gridText.textContent = text;
      }
    }
    g.save();
    if (actual && S.lenses.result && !S.run) {
      g.globalAlpha = actual.faded ? .35 : 1;
      [...new Set((actual.cpList || []).filter(cp => cp.score > 0 && Number.isInteger(cp.near)).map(cp => cp.near))].forEach(near => {
        const cp = { near };
        const W = TOWNS[cp.near]; if (!W) return;
        const [x, y] = tileTop(TILES[W.tile]);
        g.fillStyle = "#ffe07a"; g.strokeStyle = "#172633"; g.lineWidth = 2;
        g.beginPath(); g.arc(x + 14, y - 25, 8, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = "#172633"; g.font = "bold 12px sans-serif"; g.textAlign = "center"; g.fillText("!", x + 14, y - 21);
      });
      if (!actual.town?.length && actual.unsPct > 0) {
        g.strokeStyle = "#ff8a7a"; g.lineWidth = 5;
        g.strokeRect(V.area.l + 3, V.area.t + 3, Math.max(0, V.area.r - V.area.l - 6), Math.max(0, V.area.b - V.area.t - 6));
      }
      // Public town rows, when available, are the only source of village outage colors.
      (actual.town || []).forEach((town, ti) => { if (!(town.outH > 0) || !TOWNS[ti]) return; polyPath(g, topPoly(TILES[TOWNS[ti].tile])); g.fillStyle = "rgba(192,57,43,.7)"; g.fill(); });
    }
    g.globalAlpha = 1;
    const trialLabels = [];
    if (S.result && S.lenses.result && !S.run) {
      // Local trial arrays are kept on this device. Town failures are actual trial values.
      S.result.town.forEach((town, ti) => {
        if (!TOWNS[ti] || !(town.outH > 0)) return;
        const T = TILES[TOWNS[ti].tile], [x, y] = tileTop(T);
        polyPath(g, topPoly(T)); g.fillStyle = "rgba(192,57,43,.7)"; g.fill();
        S.result.uiPeak ||= S.result.town.map((_, ti) => { let peak = 0; for (let k = 0; k < S.result.H; k++) peak = Math.max(peak, S.result.hrUns[k * S.result.NT + ti]); return peak; });
        const peak = S.result.uiPeak[ti];
        if (isMobile() && peak > 0) trialLabels.push({ x, y, peak });
      });
    }
    if (S.result && S.lenses.result && !S.run && isMobile()) {
      // Small screens hide facility banners; keep only the three largest peaks.
      const placed = [];
      trialLabels.sort((a, b) => b.peak - a.peak).slice(0, 3).forEach(p => {
        const text = `시험 최대 부족 ${fmt(p.peak, 2)} MW`;
        g.font = "bold 12px sans-serif"; g.textAlign = "center";
        const width = g.measureText(text).width, x = clamp(p.x, width / 2 + 8, V.W - width / 2 - 8);
        let y = p.y - 14;
        while (placed.some(q => Math.abs(q.x - x) < (q.width + width) / 2 + 4 && Math.abs(q.y - y) < 18)) y -= 20;
        placed.push({ x, y, width });
        g.lineWidth = 3; g.strokeStyle = "#172633"; g.strokeText(text, x, y); g.fillStyle = "#fff"; g.fillText(text, x, y);
      });
    }
    if (S.lenses.grid) {
      S.net.nodes.forEach(n => { const T = TILES[n.tile]; if (!T || T.out) return; polyPath(g, topPoly(T)); g.lineWidth = 2; g.strokeStyle = n.live ? "#71dceb" : "#ffe07a"; g.stroke(); });
    }
    if (S.lenses.complaints && BLD[S.tool] && S.hover != null) {
      const T = TILES[S.hover], radius = T.t === "forest" ? 3 : ["diesel", "wind"].includes(S.tool) ? 2 : ["solar", "biomass", "offshore"].includes(S.tool) ? 1 : 0;
      TILES.filter(t => radius > 0 && !t.out && hexDist(t.i, T.i) === radius).forEach(t => { polyPath(g, topPoly(t)); g.strokeStyle = "#f0a9e9"; g.lineWidth = 2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); });
      // Reuse the complaint calculation for affected demand sites, including wind/smoke direction.
      const cpKey = JSON.stringify([S.st.builds, S.st.policies, S.tool, T.i]);
      if (S.previewComplaint?.key !== cpKey) S.previewComplaint = { key: cpKey, value: complaints({ ...S.st, builds: [...S.st.builds, { t: S.tool, i: T.i }] }, null) };
      const cp = S.previewComplaint.value;
      cp.items.filter(item => item.bi === S.st.builds.length).forEach(item => { polyPath(g, topPoly(TILES[TOWNS[item.ti].tile])); g.fillStyle = "rgba(255,224,122,.4)"; g.fill(); });
    }
    g.restore();
  }
  function paintFloaters(g, now) {
    S.floaters.forEach(f => {
      const p = (now - f.t0) / 1100;
      g.globalAlpha = 1 - p;
      g.font = `700 14px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 3; g.strokeStyle = "rgba(6,16,30,0.9)";
      g.strokeText(f.text, f.x, f.y - p * 28); g.fillStyle = f.col; g.fillText(f.text, f.x, f.y - p * 28);
      g.globalAlpha = 1;
    });
  }

  // 사건 표시 전용 층. 모형·날씨·효과 크기와 독립적이며 배너·라벨 DOM 아래에 그린다.
  function setMapMood(mood) {
    if (!S?.alive) return;
    const next = ["heat", "cold", "snow", "storm", "cloud", "haze"].includes(mood) ? mood : null;
    if (S.mapMood === next) return;
    S.mapMood = next;
    request();
  }
  function paintMapMood(g, t, rm) {
    const mood = S.mapMood;
    if (!mood) return;
    // 전체 투명도 상한 0.06: 별도 캔버스를 한 번 합성하므로 입자가 겹쳐도 상한이 유지된다.
    const canvas = S.moodCanvas ||= document.createElement("canvas");
    if (canvas.width !== V.W) canvas.width = V.W;
    if (canvas.height !== V.H) canvas.height = V.H;
    const ink = canvas.getContext("2d"), a = V.area, w = Math.max(0, a.r - a.l), h = Math.max(0, a.b - a.t);
    ink.clearRect(0, 0, V.W, V.H);
    const anim = rm ? 0 : t;
    if (mood === "heat") {
      const tint = ink.createLinearGradient(0, a.t, 0, a.b);
      tint.addColorStop(0, "rgba(240,146,63,0)"); tint.addColorStop(1, "#f0923f");
      ink.fillStyle = tint; ink.fillRect(a.l, a.t, w, h);
      if (!rm) {
        ink.strokeStyle = "#ffb768"; ink.lineWidth = 2;
        for (let k = 0; k < 6; k++) {
          ink.beginPath();
          for (let x = 0; x <= w; x += 12) {
            const y = a.t + h * (.55 + k * .065) + Math.sin(x / 75 + anim * .6 + k) * 5;
            if (!x) ink.moveTo(a.l + x, y); else ink.lineTo(a.l + x, y);
          }
          ink.stroke();
        }
      }
    } else if (mood === "cold" || mood === "snow") {
      const frost = ink.createRadialGradient((a.l + a.r) / 2, (a.t + a.b) / 2, 0,
        (a.l + a.r) / 2, (a.t + a.b) / 2, Math.max(w, h) * .6);
      frost.addColorStop(0, "rgba(166,220,250,0)"); frost.addColorStop(.55, "rgba(166,220,250,0.15)"); frost.addColorStop(1, "#a6dcfa");
      ink.fillStyle = frost; ink.fillRect(a.l, a.t, w, h);
      if (mood === "snow" && !rm) {
        ink.fillStyle = "#f1f8ff";
        for (let k = 0; k < 60; k++) {
          const x = a.l + (hash(k, 1, 71) * w + Math.sin(anim * .3 + k) * 8 + w) % Math.max(1, w);
          const y = a.t + (hash(k, 2, 71) * h + anim * (9 + k % 5)) % Math.max(1, h);
          ink.beginPath(); ink.arc(x, y, 1 + k % 3 * .35, 0, Math.PI * 2); ink.fill();
        }
      }
    } else {
      ink.fillStyle = mood === "haze" ? "#a89c87" : "rgba(38,58,80,0.45)";
      ink.fillRect(a.l, a.t, w, h);
      if ((mood === "storm" || mood === "cloud") && !rm) {
        ink.fillStyle = "#263a50";
        for (let k = 0; k < 7; k++) {
          const x = a.l - 160 + (hash(k, 3, 71) * (w + 320) + anim * (mood === "storm" ? 85 : 12)) % (w + 320);
          const y = a.t + hash(k, 4, 71) * h;
          ink.beginPath(); ink.ellipse(x, y, 100 + k * 7, 18 + k * 2, -.15, 0, Math.PI * 2); ink.fill();
        }
      }
      if (mood === "storm" && !rm) {
        ink.strokeStyle = "#a2c9e5"; ink.lineWidth = 1; ink.beginPath();
        for (let k = 0; k < 80; k++) {
          const x = a.l + (hash(k, 5, 71) * w + anim * 100) % Math.max(1, w);
          const y = a.t + (hash(k, 6, 71) * h + anim * 290) % Math.max(1, h);
          ink.moveTo(x, y); ink.lineTo(x - 6, y + 12);
        }
        ink.stroke();
      }
    }
    g.save(); g.globalAlpha = 0.06;
    g.drawImage(canvas, 0, 0, V.W, V.H); g.restore();
  }

  function frame(now) {
    if (!S || !S.alive) return;
    // raf를 비우기 전에 동기화해 setMapMood의 request와 다음 프레임을 중복 예약하지 않는다.
    try { if (S.opts.league) KCP.fxTurn?.syncMapMood?.(S.root); }
    catch (_) { /* 사건 표시 실패가 지도 프레임 예약을 막지 않게 한다. */ }
    S.raf = 0;
    if (S.dirtyLayout) layout();
    const active = mapMotion.active(S.mapFx, now, reduced());
    if (active.length !== S.mapFx.length) { S.mapFx = active; S.dirtyStatic = true; }
    S.floaters = mapMotion.active(S.floaters, now, reduced(), 1100);
    if (S.dirtyStatic) { paintStatic(); S.dirtyStatic = false; }
    const g = S.g, t = (now - S.born) / 1000, dpr = dprOf();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.run && !S.run.done) stepRun(now);
    const ch = curHour();
    paintSea(g, reduced() ? 0 : t, ch);
    g.drawImage(S.base, 0, 0, V.W, V.H);
    if (S.mapFx.length) paintMapEffects(g, now, reduced() ? 0 : t);
    paintDynamic(g, t);
    paintCursor(g, t);
    if (S.opts.league) paintLeagueLayers(g);
    if (S.floaters.length) paintFloaters(g, now);
    paintMapMood(g, t, reduced());
    placeBanners();
    const keep = mapMotion.needsFrame(S, reduced(), document.hidden);
    if (keep) S.raf = requestAnimationFrame(frame);
  }
  function request() { if (S && S.alive && !S.raf) S.raf = requestAnimationFrame(frame); }

  /* =====================================================================
   * 6. 조작
   * ===================================================================== */
  const avgDem = ti => { let a = 0; for (let h = 0; h < 24; h++) a += demand(ti, h, PLAIN_DAY, {}, PK.climate && S && S.st.fab2); return a / 24; };
  const OUT_EPS = () => (PK.climate ? 0.004 : 0.05);
  const budgetLeft = () => budgetOf() - capex(S.st);
  function canPlace(type, i) {
    const T = TILES[i];
    if (S.st.builds.some(b => b.i === i)) return { ok: false, why: "이미 있음" };
    const why = siteRule(type, T);
    if (why) return { ok: false, why };
    const cost = buildCost(type, i);
    if (cost > budgetLeft() + 1e-9) return { ok: false, why: `예산 부족(${fmt(cost)}억)`, cost };
    return { ok: true, cost, clear: T.t === "forest" };
  }
  function changed(msg) {
    persist();
    if (S.opts.onChange) S.opts.onChange(S.st);
    S.net = network(S.st);
    S.result = null;
    S.dirtyStatic = true;
    refreshHUD();
    renderDrawer();
    placeBannerValues();
    updateAria();
    if (msg) announce(msg);
    request();
  }
  function floater(i, text, col) {
    if (reduced()) return;
    const [x, y] = tileTop(TILES[i]);
    S.floaters.push({ x, y: y - V.S * 0.6, text, col, t0: performance.now() });
  }
  function place(type, i) {
    if (toolLocked(type)) { toast(toolLocked(type)); return; }
    const chk = canPlace(type, i);
    if (!chk.ok) { toast(chk.why); return; }
    const item = { t: type, i };
    S.st.builds.push(item);
    S.undo.push({ kind: "b", item, st: S.st, turn: undoTurn() });
    mapEffect({ kind: "place", t: type, i });
    floater(i, `−${fmt(chk.cost)}억`, "#ecd083");
    changed(`${BLD[type].name} 설치 · ${fmt(chk.cost)}억${chk.clear ? " (숲 정리 포함)" : ""}`);
    S.opts.onFx?.("build");
  }
  // 철거 때 돌려받는 몫: 혼자 하기는 시험 운전이라 전액, 리그는 opts.salvage(이름표)가 정한다(지난 라운드 것 30%).
  const salvageOf = key => (S.opts && S.opts.salvage ? S.opts.salvage(key) : 1);
  // 설치 순서는 화면에만 둔다. 지난 달·라운드 및 이미 철거한 항목은 되돌리지 않는다.
  const undoTurn = () => JSON.stringify(S.opts.leagueRound?.() || null);
  const undoKey = entry => entry.kind === "b" ? `b:${entry.item.t}:${entry.item.i}` : `l:${entry.item.p.join("-")}`;
  function lastUndo() {
    const turn = undoTurn();
    S.undo = S.undo.filter(entry => entry.st === S.st && entry.turn === turn && salvageOf(undoKey(entry)) === 1 &&
      (entry.kind === "b" ? S.st.builds : S.st.lines).includes(entry.item));
    return S.undo.at(-1);
  }
  function refreshUndo() {
    const button = $("#bd-undo");
    if (button) button.disabled = !lastUndo() || !!S.run || !!lockedMsg();
  }
  function undoPlacement() {
    if (!S || S.run || lockedMsg()) return false;
    const entry = lastUndo();
    if (!entry) return false;
    S.undo.pop();
    cancelLine();
    S.sel = null;
    hideTip();
    if (entry.kind === "b") removeBuild(entry.item);
    else removeLines([entry.item]);
    return true;
  }
  function undoShortcut(e) {
    if (!S || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    if (e.target.closest("input, textarea, select") || e.target.isContentEditable || document.querySelector("dialog[open]")) return;
    if (S.lineStart != null || S.pending) { cancelLine(); e.preventDefault(); return; }
    if (undoPlacement()) e.preventDefault();
  }
  function removeBuild(b) {
    const c = buildCost(b.t, b.i), back = c * salvageOf(`b:${b.t}:${b.i}`);
    S.st.builds.splice(S.st.builds.indexOf(b), 1);
    floater(b.i, `+${fmt(back, 1)}억`, "#7be3b4");
    changed(leagueWords(back < c - 1e-9 ? `${BLD[b.t].name} 철거 · ${fmt(back, 1)}억 회수(지난 라운드 것 — ${fmt(c - back, 1)}억 손실)` : `${BLD[b.t].name} 철거 · ${fmt(c)}억 환불`));
  }
  function removeLines(gone, i = gone[0].p.at(-1)) {
    const full = gone.reduce((a, L) => a + lineCost(L.p), 0);
    const back = gone.reduce((a, L) => a + lineCost(L.p) * salvageOf(`l:${L.p.join("-")}`), 0);
    S.st.lines = S.st.lines.filter(L => !gone.includes(L));
    floater(i, `+${fmt(back, 1)}억`, "#7be3b4");
    changed(leagueWords(back < full - 1e-9 ? `송전선 철거 · ${fmt(back, 1)}억 회수(지난 라운드 것 — ${fmt(full - back, 1)}억 손실)` : `송전선 철거 · ${fmt(back, 1)}억 환불`));
  }
  function removeAt(i) {
    const bi = S.st.builds.findIndex(b => b.i === i);
    if (bi >= 0) {
      const b = S.st.builds[bi];
      removeBuild(b);
      mapEffect({ kind: "remove", t: b.t, i: b.i });
      S.opts.onFx?.("remove");
      return;
    }
    const gone = S.st.lines.filter(L => L.p.includes(i));
    if (gone.length) {
      removeLines(gone, i);
      gone.forEach(L => mapEffect({ kind: "unline", p: L.p, i }));
      S.opts.onFx?.("remove");
      return;
    }
    toast("철거할 것이 없다");
  }
  const onLine = i => S.st.lines.some(L => L.p.includes(i));
  const validStart = i => TILES[i].site >= 0 || S.st.builds.some(b => b.i === i) || onLine(i);
  const validEnd = i => !TILES[i].out && (TILES[i].land || S.st.builds.some(b => b.i === i) || onLine(i));
  function lineClick(i) {
    if (S.pending) {
      if (i === S.pending.end) { confirmLine(); return; }
    }
    if (S.lineStart == null) {
      if (!validStart(i)) { toast("시작: 발전소·마을·송전선"); return; }
      S.lineStart = i; S.pending = null; S.preview = null;
      announce("시작점 선택. 끝점을 고르세요.");
      showConfirm();
      request();
      return;
    }
    if (i === S.lineStart) { cancelLine(); return; }
    if (TILES[i].out) { toast(`${PK.name} 밖은 지날 수 없다`); return; }
    if (!validEnd(i)) { toast("끝점은 육지나 발전소"); return; }
    const p = routePath(S.lineStart, i);
    if (!p) { toast(`길이 없다(${PK.name} 밖은 못 지남)`); return; }
    S.pending = { p, end: i, cost: lineCost(p) };
    S.preview = null;
    showConfirm();
    announce(`송전선 ${p.length - 1}칸 · ${fmt(S.pending.cost, 1)}억. 확인하려면 다시 누르거나 Enter.`);
    request();
  }
  function confirmLine() {
    const P = S.pending;
    if (!P) return;
    if (P.cost > budgetLeft() + 1e-9) { toast(`예산 부족(${fmt(P.cost, 1)}억)`); return; }
    const item = { p: P.p };
    S.st.lines.push(item);
    S.undo.push({ kind: "l", item, st: S.st, turn: undoTurn() });
    mapEffect({ kind: "line", p: P.p });
    floater(P.end, `−${fmt(P.cost, 1)}억`, "#ecd083");
    S.pending = null; S.lineStart = null; S.preview = null;
    showConfirm();
    changed(`송전선 연결 · ${P.p.length - 1}칸 · ${fmt(P.cost, 1)}억`);
    S.opts.onFx?.("line");
  }
  function cancelLine() {
    S.pending = null; S.lineStart = null; S.preview = null;
    showConfirm();
    request();
  }
  function act(i) {
    if (toolLocked(S.tool)) { toast(toolLocked(S.tool)); return; }
    const tool = S.tool;
    if (!tool) { showTip(i); return; }
    const lk = lockedMsg();
    if (lk) { toast(lk); return; }
    if (tool === "remove") removeAt(i);
    else if (tool === "line") lineClick(i);
    else place(tool, i);
    showTip(i);
  }
  function setTool(id) {
    if (toolLocked(id)) { toast(toolLocked(id)); return; }
    S.tool = S.tool === id ? null : id;
    if (S.opts.league && BLD[S.tool] && !S.lensChosen) {
      S.lenses.complaints = true; S.lenses.grid = true; rememberLenses(); syncLensButtons();
    }
    if (S.opts.league) S.opts.onTool?.();
    cancelLine();
    S.sel = null;
    closePops();
    renderTools();
    S.root.dataset.mode = S.tool || "";
    if (S.hover != null) showTip(S.hover);
    request();
  }
  /* ---------- 도구 막대: 섬은 6개 그대로, 평택은 묶음(재생·화력·저장·송전·철거) ---------- */
  const toolLocked = id => {
    const tech = BLD[id]?.tech;
    if (!S.opts.league || !tech || S.opts.research?.()?.adopted?.includes(tech)) return "";
    return `${KCP.TECH_DATA?.cards.find(c => c.id === tech)?.name || tech} 연구 필요`;
  };
  function toolGroups() {
    const groups = (PK.groups || []).map(g => ({ ...g, tools: g.tools.slice() }));
    if (!S.opts.league || !KCP.TECH_DATA) return groups;
    const add = (base, ids, name) => {
      const group = groups.find(g => g.tools.includes(base));
      if (group) { group.tools.push(...ids.filter(id => BLD[id])); if (name) group.name = name; }
    };
    add("solar", ["tandem", "tandem_roof"]);
    add("battery", ["nbat", "h2store"], "저장");
    add("diesel", ["smr"]);
    return groups;
  }
  const toolBtn = (id, extra = "") => {
    const T = toolMeta(id), why = toolLocked(id);
    return `<button type="button" class="bd-tool" data-tool="${esc(id)}" aria-pressed="${S.tool === id}"${why ? ` disabled aria-disabled="true" title="${esc(why)}" aria-label="${esc(T.name + ' · ' + why)}"` : ""}${extra}>${ico(T.icon)}<span class="bd-tool-n">${why ? "🔒 " : ""}${esc(T.name)}${why ? `<small>${esc(why)}</small>` : ""}</span><span class="bd-tool-c num">${esc(T.cost)}${T.rated ? `<br>${esc(T.rated)}` : ""}</span></button>`;
  };
  function renderTools() {
    const box = $("#bd-tools"), sub = $("#bd-subtools");
    if (!box) return;
    const groups = toolGroups();
    S.root.classList.toggle("bd-grouped", !!PK.groups);
    const undo = '<button type="button" class="bd-tool" id="bd-undo" title="방금 놓은 것 되돌리기 (Ctrl/⌘+Z)" disabled><span>되돌리기</span></button>';
    if (!PK.groups) { box.innerHTML = toolsOf().map(id => toolBtn(id)).join("") + undo; sub.hidden = true; refreshUndo(); return; }
    box.innerHTML = groups.map(G => {
      if (G.tools.length === 1) return toolBtn(G.tools[0]);
      const cur = G.tools.includes(S.tool) ? toolMeta(S.tool) : null;
      return `<button type="button" class="bd-tool bd-group" data-group="${esc(G.id)}" aria-expanded="${S.openGroup === G.id}" aria-controls="bd-subtools"${cur ? ' data-active="true"' : ""}>${ico(cur ? cur.icon : G.icon)}<span class="bd-tool-n">${esc(G.name)}</span><span class="bd-tool-c num">${cur ? esc(cur.name) : G.tools.length + "종"}</span></button>`;
    }).join("") + undo;
    refreshUndo();
    const G = groups.find(g => g.id === S.openGroup);
    sub.hidden = !G;
    if (G) { sub.setAttribute("aria-label", G.name); sub.innerHTML = G.tools.map(id => toolBtn(id)).join(""); }
  }
  function openGroup(id) {
    S.openGroup = S.openGroup === id ? null : id;
    S.seasonOpen = false; renderSeasons();
    renderTools();
    if (S.openGroup) { const f = $("#bd-subtools .bd-tool"); if (f) f.focus({ preventScroll: true }); }
  }
  function renderSeasons() {
    const btn = $("#bd-season"), pop = $("#bd-seasons");
    if (!btn) return;
    btn.hidden = !PK.climate;
    $("#bd-season-t").textContent = PK.climate ? displaySeason(S.st.season) : "";
    btn.setAttribute("aria-expanded", String(!!S.seasonOpen));
    pop.hidden = !(PK.climate && S.seasonOpen);
    if (!pop.hidden) pop.innerHTML = SEASONS.map(x => `<button type="button" class="bd-tool bd-seasonbtn" data-season="${x.id}" aria-pressed="${S.st.season === x.id}">${ico(x.id === "summer" ? "sun" : x.id === "winter" ? "wind" : x.id === "spring" ? "leaf" : "cloud")}<span class="bd-tool-n">${x.name}</span><span class="bd-tool-c num">${monthName(x.m)}</span></button>`).join("");
  }
  function closePops() {
    if (!S) return;
    const had = S.openGroup || S.seasonOpen;
    S.openGroup = null; S.seasonOpen = false;
    if (had) { renderTools(); renderSeasons(); }
  }
  // 지도 바꾸기: 지도마다 건설 칸이 따로 있다.
  function applyPack() {
    $("#bd-kicker").textContent = PK.kicker;
    $("#bd-h1").textContent = PK.title;
    $("#bd-virtual").textContent = PK.virtual || "가상 모형";
    document.title = `${PK.title} · 켄텍 창의성 면접 연습실`;
    S.canvas.setAttribute("aria-roledescription", `${PK.name} 지도`);
    S.root.querySelectorAll("[data-map]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.map === PK.id)));
    const cur = $("#bd-mapcur-t");
    if (cur) cur.textContent = PK.name;
    const note = $("#bd-mapnote");
    note.hidden = !PK.note; note.textContent = PK.note || "";
    if (S.help) S.help.setTitle(PK.title);
    S.net = network(S.st);
    renderTools(); renderSeasons(); buildBanners();
  }
  function switchMap(id) {
    if (!S || S.run || id === PK.id || !Object.hasOwn(PACKS, id)) return;
    S.doc.map = id;
    selectPack(id);
    S.st = S.doc.maps[id];
    S.mapFx = []; S.flowView = null;
    S.tool = null; S.hover = null; S.sel = null; S.lineStart = null; S.pending = null; S.preview = null; S.result = null;
    S.openGroup = null; S.seasonOpen = false;
    S.root.dataset.mode = "";
    V.zoom = 1; V.panX = 0; V.panY = 0; V.lastRot = -1;
    hideTip(); showConfirm();
    persist();
    applyPack();
    if (S.drawerTab === "result") S.drawerTab = "policy";
    renderDrawer(); refreshHUD(); placeBannerValues(); updateAria();
    setLayer(S.layer);
    announce(`${PK.name} 지도`);
    request();
  }
  function hit(x, y) {
    for (let k = ORDER.length - 1; k >= 0; k--) {
      const T = ORDER[k], p = topPoly(T, HGT[T.t], 1);
      let inside = false;
      for (let a = 0, b = 5; a < 6; b = a++) {
        if ((p[a][1] > y) !== (p[b][1] > y) && x < (p[b][0] - p[a][0]) * (y - p[a][1]) / (p[b][1] - p[a][1]) + p[a][0]) inside = !inside;
      }
      if (inside) return T.i;
    }
    return null;
  }
  function setHover(i, kbd) {
    if (S.hover === i && !!kbd === !!S.kbd) return;
    S.hover = i; S.kbd = !!kbd;
    if (i != null && S.tool === "line" && S.lineStart != null && !S.pending && validEnd(i) && i !== S.lineStart) {
      const p = routePath(S.lineStart, i);
      S.preview = p ? { p, end: i, cost: lineCost(p) } : null;
      showConfirm();
    } else if (S.preview) { S.preview = null; showConfirm(); }
    if (i == null) hideTip(); else showTip(i);
    request();
  }

  /* ---------- 지도 포인터 ---------- */
  function bindCanvas(cv) {
    let down = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    on(cv, "pointerdown", e => {
      if (S.run) return;
      if (e.pointerType !== "touch") S.sel = null;
      const [x, y] = pos(e);
      down = { x, y, px: V.panX, py: V.panY, id: e.pointerId, moved: false, type: e.pointerType };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    });
    on(cv, "pointermove", e => {
      const [x, y] = pos(e);
      if (down && down.id === e.pointerId) {
        const dx = x - down.x, dy = y - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 8 && V.zoom > 1) down.moved = true;
        if (down.moved) { V.panX = down.px + dx; V.panY = down.py + dy; S.dirtyLayout = true; hideTip(); request(); return; }
      }
      if (S.run || e.pointerType === "touch") return;
      setHover(hit(x, y), false);
    });
    on(cv, "pointerup", e => {
      if (!down || down.id !== e.pointerId) return;
      const d = down; down = null;
      if (d.moved || S.run) return;
      const [x, y] = pos(e);
      const i = hit(x, y);
      if (i == null) { setHover(null); return; }
      if (d.type === "touch" && S.tool && S.tool !== "line" && S.sel !== i) {
        // 손가락: 첫 탭은 미리보기, 같은 타일을 한 번 더 누르면 설치
        S.sel = i;
        if (S.hover === i && !S.kbd) showTip(i);
        else setHover(i, false);
        return;
      }
      S.sel = null;
      setHover(i, false);
      act(i);
    });
    on(cv, "pointercancel", () => { down = null; });
    on(cv, "pointerleave", e => { if (e.pointerType !== "touch" && !S.kbd) setHover(null); });
    on(cv, "keydown", e => {
      if (S.run) return;
      S.sel = null;
      const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (dirs[e.key]) {
        e.preventDefault();
        const cur = S.hover != null ? S.hover : TOWNS[0].tile;
        const nx = S.hover == null ? cur : stepFrom(cur, dirs[e.key]);
        setHover(nx, true);
        const T = TILES[nx];
        announce(`${T.site >= 0 ? SITES[T.site].name : TNAME[T.t]}${T.wind ? `, 일사 ${T.sun}, 풍속 ${T.wind} m/s` : ""}`);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (S.pending && (S.hover == null || S.hover === S.pending.end)) { confirmLine(); return; }
        if (S.hover != null) act(S.hover);
        return;
      }
      if (e.key === "Escape") {
        if (S.lineStart != null || S.pending) { e.preventDefault(); cancelLine(); announce("송전선 취소"); }
        else if (S.tool) { e.preventDefault(); setTool(S.tool); announce("도구 해제"); }
      }
    });
    on(cv, "focus", () => { if (S.hover == null && cv.matches(":focus-visible")) setHover(TOWNS[0].tile, true); });
    on(cv, "blur", () => { if (S.kbd) { S.kbd = false; hideTip(); request(); } });
  }
  function stepFrom(i, [dx, dy]) {
    const T = TILES[i], A = scr(T.X, T.Y, 0);
    let best = i, bd = 0.35;
    T.nb.forEach(j => {
      const B = scr(TILES[j].X, TILES[j].Y, 0), vx = B[0] - A[0], vy = B[1] - A[1], L = Math.hypot(vx, vy) || 1;
      const d = (vx * dx + vy * dy) / L;
      if (d > bd) { bd = d; best = j; }
    });
    return best;
  }

  /* =====================================================================
   * 7. 시뮬레이션 재생
   * ===================================================================== */
  const RUN_MS = 8000;
  function startRun(days) {
    if (S.run) return;
    if (!S.opts.league && S.st.missions.length !== 2) {
      openDrawer("mission");
      toast("미션 2개를 먼저 고르세요");
      return;
    }
    cancelLine();
    hideTip();
    S.hover = null;
    const mods = leagueMods(S.st);
    const raw = simulate(S.st, days, S.opts.league ? { league: true, mods } : undefined);
    // D-74 계통 수입은 경제 모드(달이 있는 월 리그)의 실제 운영에만 있으므로 시험도 그때만 보정한다. 계절 4라운드는 그대로.
    const res = S.opts.league && leagueMonth() ? KCP.leagueCore.gridFill(raw) : raw;
    if (S.opts.league) rememberTrial(res, S.st, S.opts.leagueRound?.(), res === raw ? 0 : Math.max(0, res.tot.by.import - raw.tot.by.import));
    // 화면용: 디젤 건물 번호 → 비트 위치
    const dk = {};
    let n = 0;
    S.st.builds.forEach((b, bi) => { if (SMOKY[b.t]) dk[bi] = n++; });
    S.runNet = { dk };
    S.run = { res, days, t0: performance.now(), k: 0, done: false, tip: -1, tipBase: S.tipSeq++ };
    refreshUndo();
    S.result = null;
    html.classList.add("bd-running");
    closeDrawer(true);
    const panel = $("#bd-run");
    panel.hidden = false;
    $("#bd-replay-note").hidden = true;
    $("#bd-skip span").textContent = "결과 보기";
    $("#bd-run-len").textContent = days === 7 ? "1주" : days === 30 ? "1달" : "3달";
    S.root.querySelectorAll("[data-run]").forEach(b => { b.disabled = true; });
    if (reduced()) {
      // 움직임 줄이기: 짧은 진행 막대 뒤 결과로 건너뛴다.
      let p = 0;
      const tick = () => {
        if (!S || !S.alive || !S.run) return;
        p = Math.min(1, p + 0.25);
        S.run.k = Math.floor(p * (res.H - 1));
        updateRunPanel(p);
        if (p >= 1) { S.timers.push(setTimeout(() => finishRun(), 120)); return; }
        S.timers.push(setTimeout(tick, 150));
      };
      tick();
      request();
    } else request();
    $("#bd-skip").focus({ preventScroll: true });
    announce(`${days}일 운영 시작`);
  }
  // opts.del은 엔진 정산값, opts.r은 기기에서 공개 합계로 보정한 남은 부족이다. 여기서는 재계산하지 않는다.
  function replayMonth(res, opts = {}) {
    if (!S?.alive || S.run || !res || res.map !== PK.id || res.NT !== TOWNS.length ||
        replayLayouts.get(res) !== replayLayout(S.st)) return false;
    if (reduced() || !(opts.ms > 0)) return false;
    // 표시 규칙(G): 엔진 거래 또는 기기의 보정된 남은 부족을 마을 부족에 비례 배분
    const hrUns = res.hrUns.slice(), hrSup = res.hrSup.slice();
    for (let k = 0; k < res.H; k++) {
      let u = 0;
      for (let ti = 0; ti < res.NT; ti++) u += res.hrUns[k * res.NT + ti];
      const del = opts.r ? u - opts.r[k] : opts.del?.[k] || 0;
      const f = u > 0 ? (opts.r ? opts.r[k] : Math.max(0, u - del)) / u : 0;
      for (let ti = 0; ti < res.NT; ti++) hrUns[k * res.NT + ti] *= f;
      hrSup[k] += del;
    }
    const dk = {}; let n = 0;
    S.st.builds.forEach((b, bi) => { if (SMOKY[b.t]) dk[bi] = n++; });
    S.runNet = { dk };
    S.run = { replay: true, res: { ...res, hrUns, hrSup }, days: res.days, ms: opts.ms,
      t0: performance.now(), k: 0, done: false, tip: -1, tipBase: S.tipSeq++, opts,
      seen: -1, day: -1, outH: 0, outageNotified: false };
    S.lastTick = "";
    S.root.classList.add("bd-replaying");
    $("#bd-run").hidden = false;
    $("#bd-run-len").textContent = opts.label || "실제 운영 · 재생";
    $("#bd-replay-note").textContent = (opts.note ? `${opts.note} · ` : "") + "선 위 점은 전기가 통하는 길(양 아님)";
    $("#bd-replay-note").hidden = false;
    $("#bd-skip span").textContent = "건너뛰기";
    S.root.querySelectorAll("[data-run]").forEach(b => { b.disabled = true; });
    updateRunPanel(0);
    request();
    return true;
  }
  function skipReplay() {
    if (!S?.run?.replay) return false;
    S.run.k = S.run.res.H - 1;
    updateRunPanel(1);
    finishRun();
    return true;
  }
  function stepRun(now) {
    const R = S.run, p = clamp((now - R.t0) / (R.replay ? R.ms : RUN_MS), 0, 1);
    R.k = Math.min(R.res.H - 1, Math.floor(p * R.res.H));
    updateRunPanel(p);
    if (p >= 1) finishRun();
  }
  function updateRunPanel(p) {
    const R = S.run, ch = curHour();
    if (R.replay) {
      // 건너뛴 프레임 사이의 실제 시간도 모두 세어 정산의 outH와 일치시킨다.
      for (let k = R.seen + 1; k <= ch.k; k++) {
        if (R.opts.outHour?.(k)) {
          R.outH++;
          if (!R.outageNotified) { R.outageNotified = true; R.opts.onOutage?.(); }
        }
        const d = Math.floor(k / 24);
        if (d !== R.day) { R.day = d; R.opts.onDay?.(d, R.outH); }
      }
      R.seen = ch.k;
    }
    const wx = R.res.wx[ch.d];
    const tick = `${R.replay ? "운영일" : "Day"} ${ch.d + 1} · ${hh(ch.h)}`;
    if (S.lastTick !== tick) {
      S.lastTick = tick;
      $("#bd-run-day").textContent = tick;
      $("#bd-run-wx").innerHTML = ico(WX[wx.w].k) + `<span>${PK.climate ? (leagueMonth() ? `${leagueMonth()}월 (날씨는 ${monthName(wx.m)} 기준)` : monthName(wx.m)) + " · " : ""}${WX[wx.w].name}${wx.hot ? " · 폭염" : ""}</span>`;
      const bar = $("#bd-run-bar");
      bar.style.width = `${Math.round(p * 100)}%`;
      $("#bd-run-prog").setAttribute("aria-valuenow", String(Math.round(p * 100)));
      paintSpark();
      refreshHUD();
      placeBannerValues();
    }
    const tipK = reduced() ? 0 : Math.floor((performance.now() - R.t0) / 3000);
    if (tipK !== R.tip) {
      R.tip = tipK;
      const el = $("#bd-run-tip");
      if (R.replay) { el.textContent = "지도 클릭 · Esc · 건너뛰기로 재생을 끝낼 수 있어요"; return; }
      const month = leagueMonth();
      const relevantTips = month ? tips().filter(t => { const namedMonth = /^(\d+)월/.exec(t);
        if (namedMonth && +namedMonth[1] !== month) return false;
        const seasons = { 봄: [3,4,5], 여름: [6,7,8], 장마: [6,7], 가을: [9,10,11], 겨울: [12,1,2] };
        return Object.entries(seasons).every(([word, months]) => !t.includes(word) || months.includes(month)); }) : tips();
      el.textContent = (T => T[(R.tipBase * 3 + tipK) % T.length])(relevantTips.length ? relevantTips : ["전력망과 저장 설비를 함께 살펴요."]);
    }
  }
  function paintSpark() {
    const c = $("#bd-spark"), R = S.run;
    if (!c || !R) return;
    const box = c.getBoundingClientRect();
    if (!box.width) return;
    const dpr = dprOf(), W = box.width, H = box.height;
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const k1 = R.k, k0 = Math.max(0, k1 - 71), n = 72;
    let mx = 1;
    for (let k = k0; k <= k1; k++) mx = Math.max(mx, R.res.hrDem[k], R.res.hrSup[k]);
    mx *= 1.1;
    const X = k => 2 + (k - (k1 - n + 1)) / (n - 1) * (W - 4), Y = v => H - 3 - v / mx * (H - 8);
    // 부족분
    g.fillStyle = "rgba(255,120,150,0.35)";
    g.beginPath();
    for (let k = k0; k <= k1; k++) g.lineTo(X(k), Y(R.res.hrDem[k]));
    for (let k = k1; k >= k0; k--) g.lineTo(X(k), Y(R.res.hrSup[k]));
    g.fill();
    const line = (arr, col, wd) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); for (let k = k0; k <= k1; k++) { const x = X(k), y = Y(arr[k]); if (k === k0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); };
    line(R.res.hrDem, "rgba(237,244,252,0.85)", 1.4);
    line(R.res.hrSup, "#71dceb", 2);
  }
  function finishRun() {
    if (!S || !S.run) return;
    const R = S.run;
    R.done = true;
    if (R.replay) {
      S.run = null;
      S.lastTick = "";
      S.root.classList.remove("bd-replaying");
      $("#bd-run").hidden = true;
      $("#bd-replay-note").hidden = true;
      ["left", "width", "bottom"].forEach(k => $("#bd-run").style.removeProperty(k));
      $("#bd-skip span").textContent = "결과 보기";
      S.root.querySelectorAll("[data-run]").forEach(b => { b.disabled = false; });
      refreshHUD(); placeBannerValues(); request();
      R.opts.onDone?.();
      return;
    }
    S.result = R.res;
    S.run = null;
    S.lastTick = "";
    html.classList.remove("bd-running");
    $("#bd-run").hidden = true;
    S.root.querySelectorAll("[data-run]").forEach(b => { b.disabled = false; });
    S.result.entry = addEntry(R.res);
    refreshHUD();
    placeBannerValues();
    S.drawerTab = "result";
    renderDrawer();
    openDrawer("result");
    const head = $("#bd-res-title");
    if (head) head.focus({ preventScroll: true });
    announce(`운영 끝. 정전 ${R.res.outTotal}시간, 총비용 ${fmt(R.res.cost.total, 1)}억, CO₂ ${fmt(R.res.co2)} t.`);
    // 첫 운영 뒤 한 번만 일지를 저절로 연다.
    if (!S.opts.league && !S.doc.jAuto) { S.doc.jAuto = true; persist(); openJournal(S.result.entry, head); }
    if (S.opts.league) S.opts.onTrial?.(S.result);
    request();
  }
  // 운영마다 지표 한 줄을 남긴다(글을 안 써도 남는다).
  function addEntry(res) {
    const st = S.st, doc = S.doc;
    doc.runs = (doc.runs || 0) + 1;
    const wx = [0, 0, 0];
    res.wx.forEach(w => { wx[w.w]++; });
    const e = {
      id: doc.runs, at: new Date().toISOString().slice(0, 10), days: res.days, seed: res.seed, wx, map: PK.id, season: seasonLabel(res),
      m: { out: res.outTotal, co2: Math.round(res.co2), cost: Math.round(res.cost.total * 10) / 10, cp: res.cp.issues,
        uns: Math.round(1000 * res.unsTotal / Math.max(1, res.tot.dem)) / 10, curt: Math.round(res.tot.curt) },
      pol: st.policies.slice(), mis: res.missions.filter(m => m.chosen).map(m => ({ id: m.id, ok: m.ok })),
      q: res.questions[0] ? res.questions[0].q : "", a: { why: "", surprise: "", trade: "", next: "", q: "" }
    };
    doc.journal.push(e);
    while (doc.journal.length > J_MAX) doc.journal.shift();
    persist();
    return e.id;
  }

  /* =====================================================================
   * 8. DOM: HUD, 도구, 서랍, 말풍선
   * ===================================================================== */
  function on(el, type, fn, opt) { el.addEventListener(type, fn, opt); S.off.push(() => el.removeEventListener(type, fn, opt)); }
  const cap = (k, icon, name, tone) => `<span class="v2-cap bd-cap${tone ? " tone-" + tone : ""}" data-cap="${k}">${ico(icon)}<span class="v2-cap-txt"><span class="v2-cap-k">${name}</span><span class="v2-cap-v" data-v></span></span></span>`;
  // 지도가 많으면 [지도: 평택 ▾] 하나로 접는다. 연습 / 경기 남부·충청권 도시로 나눠 보여 준다.
  function mapPicker(packs) {
    const btn = id => `<button type="button" class="bd-mapbtn" data-map="${id}" aria-pressed="false">${esc(PACKS[id].name)}</button>`;
    const prac = packs.filter(id => !PACKS[id].climate), city = packs.filter(id => PACKS[id].climate);
    return `<button type="button" class="bd-mapbtn bd-mapcur" id="bd-mapcur" aria-expanded="false" aria-controls="bd-mappop"><span>지도</span> <b id="bd-mapcur-t"></b> <span aria-hidden="true">▾</span></button>
      <div class="bd-mappop" id="bd-mappop" hidden>
        ${prac.length ? `<p class="bd-mappop-h">연습</p><div class="bd-mappop-g">${prac.map(btn).join("")}</div>` : ""}
        ${city.length ? `<p class="bd-mappop-h">${esc(KCP.LEAGUE_REGIONS?.south?.name || "지역 도시")}</p><div class="bd-mappop-g">${city.map(btn).join("")}</div>` : ""}
      </div>`;
  }
  function shell(app, packs) {
    const root = document.createElement("div");
    root.className = "bd-root";
    root.id = "bd-root";
    root.innerHTML = `
      <div class="bd-stage">
        <canvas class="bd-canvas" id="bd-canvas" tabindex="0" role="application" aria-roledescription="섬 지도" aria-describedby="bd-keys"></canvas>
        <div class="bd-banners" id="bd-banners" aria-hidden="true"></div>
        <div class="bd-tip" id="bd-tip" hidden></div>
      </div>
      <p id="bd-keys" class="bd-sr">화살표로 타일 이동, Enter로 설치, Esc로 취소.</p>
      <header class="bd-hud" id="bd-hud">
        <a class="bd-back" href="#home" aria-label="연습실 홈으로">${ico("back")}</a>
        <div class="bd-title"><p class="v2-kicker" id="bd-kicker"></p><h1 id="bd-h1"></h1></div>
        <div class="bd-caps">
          ${cap("budget", "coin", "예산", "gold")}
          ${cap("time", "clock", "시간", "sky")}
          ${cap("power", "bolt", "공급/수요", "mint")}
          ${cap("co2", "co2", "CO₂")}
          ${cap("cp", "alert", "민원")}
        </div>
        <span class="bd-virtual" id="bd-virtual"></span>
        <button type="button" class="bd-help" id="bd-help" aria-label="도움말과 팁">${ico("help")}</button>
      </header>
      <div class="bd-mapbar" id="bd-mapbar">
        ${packs.length > 1 ? `<div class="bd-maps" role="group" aria-label="지도 고르기">${packs.length > 3 ? mapPicker(packs) : packs.map(id => `<button type="button" class="bd-mapbtn" data-map="${id}" aria-pressed="false">${esc(PACKS[id].name)}</button>`).join("")}</div>` : ""}
        <div class="bd-layers" role="group" aria-label="자료 지도">
          ${LAYERS.map(L => `<button type="button" class="bd-layer" data-layer="${L.id}" aria-pressed="false">${ico(L.icon)}<span>${L.name}</span></button>`).join("")}
        </div>
        <div class="bd-zoom" role="group" aria-label="확대">
          <button type="button" class="bd-zbtn" data-zoom="-1" aria-label="축소">${ico("minus")}</button>
          <button type="button" class="bd-zbtn" data-zoom="1" aria-label="확대">${ico("plus")}</button>
        </div>
        <span class="bd-windchip" id="bd-windchip" role="img" aria-label="우세풍: 서풍, 서쪽에서 동쪽으로"><svg class="v2-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M14 7l5 5-5 5"/></svg><span>서풍</span></span>
        <div class="bd-legend" id="bd-legend" hidden></div>
        <p class="bd-mapnote" id="bd-mapnote" hidden></p>
      </div>
      <aside class="bd-drawer" id="bd-drawer" aria-label="정책·미션·결과">
        <div class="bd-drawer-head">
          <div class="bd-tabs" role="group" aria-label="서랍">
            <button type="button" class="bd-tab" data-tab="policy" aria-pressed="true">${ico("cards")}<span>정책</span><b class="bd-count" data-count="policy"></b></button>
            <button type="button" class="bd-tab" data-tab="mission" aria-pressed="false">${ico("flag")}<span>미션</span><b class="bd-count" data-count="mission"></b></button>
            ${PK.groups ? `<button type="button" class="bd-tab" data-tab="research" aria-pressed="false">${ico("flask")}<span>연구</span><b class="bd-count" data-count="research"></b></button>` : ""}
            <button type="button" class="bd-tab" data-tab="result" aria-pressed="false">${ico("news")}<span>결과</span></button>
            <button type="button" class="bd-tab" data-tab="journal" aria-pressed="false">${ico("pen")}<span>일지</span><b class="bd-count" data-count="journal"></b></button>
          </div>
          <button type="button" class="bd-x" id="bd-drawer-x" aria-label="서랍 닫기">${ico("x")}</button>
        </div>
        <div class="bd-drawer-body" id="bd-drawer-body"></div>
      </aside>
      <div class="bd-confirm" id="bd-confirm" hidden></div>
      <section class="bd-run" id="bd-run" hidden aria-label="운영 중">
        <div class="bd-run-top">
          <span class="bd-run-len" id="bd-run-len"></span>
          <b class="bd-run-day num" id="bd-run-day" aria-live="off"></b>
          <span class="bd-run-wx" id="bd-run-wx"></span>
          <button type="button" class="bd-skip" id="bd-skip">${ico("skip")}<span>결과 보기</span></button>
        </div>
        <div class="bd-run-prog" id="bd-run-prog" role="progressbar" aria-label="진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="bd-run-bar"></span></div>
        <div class="bd-run-mid">
          <canvas class="bd-spark" id="bd-spark" aria-hidden="true"></canvas>
          <p class="bd-spark-key"><span class="k-dem">수요</span><span class="k-sup">공급</span><span class="k-uns">부족</span></p>
        </div>
        <p class="bd-run-tip"><span class="bd-tip-b">TIP</span><span id="bd-run-tip"></span></p>
        <p class="bd-run-tip" id="bd-replay-note" hidden></p>
      </section>
      <nav class="bd-dock" id="bd-dock" aria-label="건설 도구">
        <div class="bd-subtools" id="bd-subtools" role="group" hidden></div>
        <div class="bd-seasons" id="bd-seasons" role="group" aria-label="시작 계절" hidden></div>
        <div class="bd-tools" id="bd-tools"></div>
        <div class="bd-runs">
          <button type="button" class="bd-pm" id="bd-pm" aria-expanded="false" aria-controls="bd-drawer">${ico("cards")}<span>정책·미션</span></button>
          <button type="button" class="bd-season" id="bd-season" aria-expanded="false" aria-controls="bd-seasons" hidden>${ico("cal")}<span id="bd-season-t"></span></button>
          <span class="bd-run-lbl" aria-hidden="true">${ico("play")}</span>
          <button type="button" class="bd-go" data-run="7">1주</button>
          <button type="button" class="bd-go" data-run="30">1달</button>
          <button type="button" class="bd-go" data-run="90">3달</button>
        </div>
      </nav>
      <p class="bd-toast" id="bd-toast" role="status" aria-live="polite"></p>
      <p class="bd-sr" id="bd-live" aria-live="polite"></p>`;
    app.append(root);
    return root;
  }

  const powerChipDefinition = "설비/피크 = 수요지와 선으로 연결된 발전 설비의 정격 MW 합 / 기준 날(7월, 폭염·한파 제외)의 최대 시간 수요. 설비는 접속 대기·공사 중 SMR·저장·외부 수입을 제외하고, 피크는 현재 인구·산업·정책·증설을 반영하되 대학·연구소 추가 부하는 제외해요. 날씨·충전·송전 손실에 따라 실제 공급은 달라져요. 초록은 지난 운영과 이번 달 시험(했다면)의 정전율이 모두 목표 이하일 때만 표시해요.";
  function refreshHUD() {
    refreshUndo();
    const set = (k, v, tone) => {
      const el = S.root.querySelector(`[data-cap="${k}"]`);
      if (!el) return;
      const vEl = el.querySelector("[data-v]");
      if (vEl.textContent !== v) vEl.textContent = v;
      vEl.title = v;
      if (tone !== undefined) el.classList.toggle("tone-danger", tone === "danger");
    };
    const left = budgetLeft();
    set("budget", `${fmt(left, Math.abs(left % 1) > 1e-9 ? 1 : 0)}억`, left < 6 ? "danger" : "");
    const R = S.run, res = S.result;
    if (LG) {
      const power = S.root.querySelector('[data-cap="power"]');
      power.classList.remove("tone-mint");
      power.title = R || res ? "" : powerChipDefinition;
    }
    if (R) {
      const ch = curHour();
      set("time", `D${ch.d + 1} ${hh(ch.h)}`);
      set("power", `${fmt(R.res.hrSup[ch.k], 1)}/${fmt(R.res.hrDem[ch.k], 1)}`, R.res.hrSup[ch.k] + 0.05 < R.res.hrDem[ch.k] ? "danger" : "");
      if (!R.replay) {
        // 시험 운전의 기존 누적 CO₂ 보간. 실제 달에는 시간별 CO₂ 자료가 없어 표시하지 않는다.
        const co2 = R.res.co2 * (ch.k + 1) / R.res.H;
        set("co2", `${fmt(co2)} t`);
      } else set("co2", "–");
      set("cp", `${R.res.cp.issues}건`, R.res.cp.issues > 1 ? "danger" : "");
    } else if (res) {
      set("time", `${res.days}일 끝`);
      set("power", `정전 ${res.outTotal}h`, res.outTotal > 0 ? "danger" : "");
      set("co2", `${fmt(res.co2)} t`);
      set("cp", `${res.cp.issues}건`, res.cp.issues > 1 ? "danger" : "");
    } else {
      const grid = leagueGrid(S.st);
      const disabled = LG ? leagueMods(S.st)?.disabledBuilds || [] : [];
      const capMW = plannedSupplyMW(S.net.nodes, grid, disabled);
      const peak = previewPeak(S.st);
      const outageRisk = LG ? S.opts.leagueOutageRisk?.() : null;
      const powerRisk = capMW < peak || outageRisk === true;
      set("time", PK.climate ? (x => `${x.name} ${x.m + 1}월`)(SEASONS.find(q => q.id === S.st.season) || SEASONS[1]) : "건설 중");
      set("power", `${fmt(capMW, LG ? 1 : 0)}/${fmt(peak, 1)}`, powerRisk ? "danger" : "");
      if (LG) S.root.querySelector('[data-cap="power"]').classList.toggle("tone-mint", !powerRisk && outageRisk === false);
      set("co2", "—");
      const cp = complaints(S.st, null);
      set("cp", `${cp.issues}건`, cp.issues > 1 ? "danger" : "");
    }
    // 리그의 달 턴은 시뮬 계절의 대표 월과 별개다. 표시만 현재 턴을 따른다.
    const rd = S.opts.league && S.opts.leagueRound ? S.opts.leagueRound() : null;
    if (rd) {
      const season = (SEASONS.find(q => q.id === rd.season) || SEASONS[1]).name;
      set("time", rd.month ? `${rd.month}월 · ${season}` : season);
      const time = S.root.querySelector('[data-cap="time"] [data-v]');
      if (rd.month && time) { time.title = `${rd.year}년 ${rd.month}월 · ${season}`; time.setAttribute("aria-label", time.title); }
    }
    const pk = S.root.querySelector('[data-cap="power"] .v2-cap-k'), mode = R ? "run" : res ? "res" : "build";
    if (pk.dataset.mode !== mode) { pk.dataset.mode = mode; pk.innerHTML = R ? '공급/수요<span class="bd-unit"> MW</span>' : res ? (S.opts.league ? "시험 결과" : "결과") : '설비/피크<span class="bd-unit"> MW</span>'; }
  }

  /* ---------- 배너(시설 이름) ---------- */
  // 평택은 큰 시설만 이름표를 단다(작은 시설은 지도 위 동그라미 표지와 말풍선).
  const MAJOR = { city: 1, city_l: 1, city_m: 1, town_s: 1, village: 1, port: 1, factory_big: 1, plant: 1, gridpt: 1, hospital: 1 };
  function buildBanners() {
    const box = $("#bd-banners");
    const list = SITES.map((W, si) => ({ W, si })).filter(({ W }) => !PK.climate || MAJOR[W.kind] && !(W.kind === "hospital" && PK.climate));
    box.innerHTML = list.map(({ W, si }) => `<div class="bd-banner" data-si="${si}" data-kind="${W.kind}"><span class="bd-bn-code">${esc(W.code || W.id)}</span><span class="bd-bn-name">${esc(W.name)}</span>${W.note ? `<span class="bd-bn-note">${esc(W.note)}</span>` : ""}<span class="bd-bn-val num" data-bv></span></div>`).join("");
    S.banners = Array.from(box.children);
    S.bannerKey = "";
  }
  function placeBanners() {
    if (!S.banners) return;
    const key = `${V.ox.toFixed(1)},${V.oy.toFixed(1)},${V.S.toFixed(2)},${V.rot}`;
    if (S.bannerKey === key) return;
    S.bannerKey = key;
    const placed = [];
    const hit = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
    S.banners.forEach(el => {
      const W = SITES[+el.dataset.si];
      if (!W) return;
      const T = TILES[W.tile];
      const lift = W.kind === "city" || W.kind === "city_l" ? 1.45 : W.kind === "city_m" ? 1.2 : W.kind === "port" ? 1.05 : 0.95;
      const [x, y] = tileTop(T, 0);
      el.hidden = false;
      const w = el.offsetWidth, h = el.offsetHeight;
      const bx = clamp(x - w / 2, 4, V.W - w - 4);
      let r = null;
      for (const dy of [0, -(h + 4), h + 4 + V.S * 0.6, -2 * (h + 4)]) {
        const c = { x: bx, y: clamp(y - V.S * lift - h - 8 + dy, V.area.t, V.H - h - 4), w, h };
        if (!placed.some(p => hit(p, c))) { r = c; break; }
      }
      if (!r) { el.hidden = true; return; }
      placed.push(r);
      el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
    });
  }
  function placeBannerValues() {
    if (!S.banners) return;
    const R = S.run, ch = curHour();
    S.banners.forEach(el => {
      const si = +el.dataset.si, W = SITES[si];
      if (!W) return;
      const ti = W.dem ? W.ti : -1;
      const v = el.querySelector("[data-bv]");
      let txt = "", state = "";
      if (R && ti >= 0) {
        const uns = R.res.hrUns[ch.k * R.res.NT + ti];
        if (R.replay) {
          txt = `부족 ${fmt(uns, 2)} MW`;
          state = R.opts.outHour?.(ch.k) && uns > 0 ? "out" : "ok";
        } else {
          const dm = demand(ti, ch.h, R.res.wx[ch.d], R.res.pol, R.res.fab2);
          txt = `${fmt(dm, dm < 1 ? 2 : 1)} MW`;
          state = uns > OUT_EPS() ? "out" : "ok";
        }
      } else if (S.result && ti >= 0 && (!S.opts.league || S.lenses.result)) {
        const town = S.result.town[ti];
        S.result.uiPeak ||= S.result.town.map((_, ti) => { let peak = 0; for (let k = 0; k < S.result.H; k++) peak = Math.max(peak, S.result.hrUns[k * S.result.NT + ti]); return peak; });
        const peak = S.result.uiPeak[ti];
        txt = `${S.opts.league ? "시험 " : ""}${town.outH}h${peak > 0 ? ` · 최대 부족 ${fmt(peak, 2)} MW` : ""}`;
        if (S.result.cp.list.some(cp => cp.ti === ti)) txt += " · 민원 !";
        state = S.result.town[ti].outH > 0 ? "out" : "ok";
      } else {
        const n = S.net.nodes.find(nd => nd.si === si);
        state = n && n.live ? "ok" : "off";
        txt = n && n.live ? "" : "선 없음";
      }
      if (v.textContent !== txt) { v.textContent = txt; S.bannerKey = ""; }
      if (el.dataset.state !== state) el.dataset.state = state;
    });
  }

  /* ---------- 말풍선(타일 정보) ---------- */
  function gridWaitInfo(type, tile, grid, installed = false) {
    const B = BLD[type];
    if (!B?.hostLimited || !grid) return null;
    const key = `${type}:${tile}`, entries = grid.entries || [], own = entries.find(e => e.key === key);
    const need = Math.max(0, B.mw - (own?.allocatedMW || 0));
    const ahead = grid.entries ? (own ? entries.slice(0, entries.indexOf(own)) : entries).reduce((sum, e) => sum + Math.max(0, e.mw - e.allocatedMW), 0) :
      Math.max(0, grid.waitingMW - grid.reservedMW);
    const room = Math.max(0, grid.headroomMW), monthly = Math.max(0, grid.monthlyMW);
    const available = Math.max(0, Math.min(room, monthly) - ahead);
    // 예약량은 이미 H에서 빠져 있다. 현재 계획 앞의 대기량부터 월 처리량을 쓴다.
    const blocked = ahead + need > room;
    const months = monthly > 0 ? Math.ceil((ahead + need) / monthly) : Infinity;
    const wait = installed && !own ? "이 설비 대기 순서 확인 필요" : need === 0 ? "이 설비 0달 대기" : blocked || !Number.isFinite(months) ? "이 설비 상한 확보까지 대기" : `이 설비 ${months}달 대기`;
    // 상한·처리량·대기 순서를 확정할 수 없을 때는 개월 수를 만들어 내지 않는다.
    return { available, wait, waiting: need > 0, months: installed && !own || blocked || !Number.isFinite(months) ? null : need === 0 ? 0 : months };
  }
  function gridAdvice(type, tile, grid, installed = false) {
    const info = gridWaitInfo(type, tile, grid, installed);
    return info ? `이번 달 접속 가능 ${fmt(info.available, 2)} MW · ${info.wait} · 상한 넘으면 ESS 필요` : "";
  }
  // HUD의 기존 정격 합계: 리그에서는 저장·수입·접속 대기·건설 대기를 제외한다.
  function plannedSupplyMW(nodes, grid, disabled) {
    return nodes.filter(n => n.kind !== "town" && n.live).reduce((a, n) => {
      if (LG && disabled.includes(`${n.kind}:${n.tile}`)) return a;
      if (LG && n.kind !== "lng" && n.kind !== "coal" && n.kind !== "import") {
        const b = BLD[n.kind];
        if (b.cls === "bat") return a;
        if (b.hostLimited && grid && !grid.entries?.some(e => e.key === `${n.kind}:${n.tile}` && e.allocatedMW >= e.mw)) return a;
      }
      return a + (n.kind === "lng" || n.kind === "coal" ? n.cap : n.kind === "import" ? (LG ? 0 : (PK.gridCap || 4) / Math.max(1, SITES.filter(s => s.kind === "gridpt").length)) : BLD[n.kind].mw);
    }, 0);
  }
  function planIssues() {
    if (!S) return { unlinked: [], waiting: [], supplyMW: 0 };
    const grid = leagueGrid(S.st), disabled = leagueMods(S.st)?.disabledBuilds || [];
    const nodes = network(S.st).nodes;
    const unlinked = nodes.filter(n => n.kind !== "town" && n.kind !== "import" && !n.live)
      .map(n => ({ t: n.kind, i: n.tile, name: BLD[n.kind]?.name || SITES[n.si].name }));
    const waiting = S.st.builds.flatMap(b => {
      const info = gridWaitInfo(b.t, b.i, grid, true);
      return info?.waiting ? [{ t: b.t, i: b.i, name: BLD[b.t].name, months: info.months }] : [];
    });
    return { unlinked, waiting, supplyMW: plannedSupplyMW(nodes, grid, disabled) };
  }
  function placementAdvice(type, tile) {
    const T = TILES[tile], B = BLD[type], notes = [];
    if (!B || T.out) return notes;
    if (S.opts.league) {
      if (["diesel", "biomass"].includes(type) && !siteRule(type, T) && !S.st.builds.some(b => b.i === tile)) {
        const before = complaints(S.st, null), bi = S.st.builds.length;
        const after = complaints({ ...S.st, builds: [...S.st.builds, { t: type, i: tile }] }, null);
        const affected = new Set(after.items.filter(x => x.bi === bi && x.kind !== "green" && x.pts > 0).map(x => `${x.ti}:${x.kind}`));
        const villages = new Set(after.list.filter(x => x.kind !== "green" && affected.has(`${x.ti}:${x.kind}`)).map(x => x.ti)).size;
        notes.push(`이 칸에 지으면 민원 +${after.issues - before.issues}건(예상 · 가동 60% 가정, 실제 가동 시간에 따라 달라짐) · 영향 주변 시설·마을 ${villages}곳`);
      }
      if (type === "smr") notes.push("모형에 SMR 민원 미반영");
      if (["solar", "roof", "tandem", "tandem_roof"].includes(type) && !siteRule(type, T)) {
        const distance = TOWNS.length ? Math.min(...TOWNS.map(w => hexDist(tile, w.tile))) : null;
        const smartGrid = leagueMods(S.st)?.tech?.includes("grid");
        const loss = smartGrid ? gridLossPerHex() : PK.lossPerHex || M.lossPerHex;
        notes.push(`일사 배수 ×${T.sun.toFixed(2)}${T.t === "forest" ? ` · 숲 정리비 ${fmt(CLEAR_COST, 1)}억` : ""}`);
        if (distance !== null) notes.push(`가장 가까운 수요지까지 ${distance}칸 · 예상 손실률 ${fmt(100 * Math.min(0.6, loss * distance), 2)}%${smartGrid ? "(스마트 송전 적용)" : ""}(헥스 최단거리 기준 · 실제 전선 경로에 따라 달라져요)`);
        notes.push("도시 전체 접속 여유는 칸과 무관");
      }
    }
    if (S.opts.league && B.hostLimited && S.opts.leagueGrid) {
      const grid = leagueGrid(S.st);
      const text = gridAdvice(type, tile, grid, S.st.builds.some(b => b.t === type && b.i === tile));
      if (text) notes.push(text);
    }
    if (type === "wind" && PK.climate) {
      const month = (SEASONS.find(s => s.id === S.st.season) || SEASONS[1]).m;
      const wind = PK.climate.wind10_land[month] * PK.climate.hub_factor_land + T.woff;
      if (wind < M.cutin) notes.push(`대표 월 평균 풍속 ${fmt(wind, 1)} m/s · 가동 기준 ${M.cutin} m/s보다 낮아 거의 발전하지 않음`);
    }
    if (type === "biomass" && T.livestock) notes.push(`축산 옆 바이오매스 연료비 −${fmt(100 * (1 - biomassFuel(tile) / dispOf("biomass").fuel))}%`);
    return notes;
  }
  function showTip(i) {
    const el = $("#bd-tip");
    if (!el || S.run) return;
    const T = TILES[i];
    let verdict = "";
    if (S.tool && S.tool !== "line" && S.tool !== "remove") {
      const c = canPlace(S.tool, i);
      verdict = c.ok ? `<p class="ok">${ico("check")}${BLD[S.tool].name} ${fmt(c.cost)}억${c.clear ? " · 숲 정리" : ""}</p>` : `<p class="no">${ico("x")}${esc(c.why)}</p>`;
    } else if (S.tool === "line") {
      const P = S.pending || S.preview;
      if (S.lineStart == null) verdict = validStart(i) ? `<p class="ok">${ico("line")}여기서 시작</p>` : `<p class="no">${ico("x")}시작: 발전소·마을·선</p>`;
      else if (P && P.end === i) verdict = `<p class="ok">${ico("line")}${P.p.length - 1}칸 · ${fmt(P.cost, 1)}억</p>`;
    } else if (S.tool === "remove") {
      const b = S.st.builds.find(x => x.i === i);
      verdict = b ? `<p class="ok">${ico("remove")}${BLD[b.t].name} +${fmt(buildCost(b.t, i) * salvageOf(`b:${b.t}:${b.i}`), 1)}억</p>` : onLine(i) ? `<p class="ok">${ico("remove")}송전선 철거</p>` : "";
    }
    const W = T.site >= 0 ? SITES[T.site] : null;
    const name = W ? `${W.code || W.id} ${W.name}` : TNAME[T.t];
    const b = S.st.builds.find(x => x.i === i);
    const type = S.tool && BLD[S.tool] ? S.tool : b?.t;
    const advice = type ? placementAdvice(type, i) : [];
    const mulTxt = T.out ? "선 못 지남" : stepMul(T) > 1 ? `선 ×${stepMul(T)}` : "";
    let siteRow = "";
    if (W && W.dem) siteRow = `<p class="bd-tip-row"><span>${esc((KIND[W.kind] || {}).label || "")}</span><span>평균 ${fmt(avgDem(W.ti), avgDem(W.ti) < 1 ? 2 : 1)} MW</span>${CRIT[W.kind] ? "<span>필수</span>" : ""}</p>`;
    else if (W) siteRow = `<p class="bd-tip-row"><span>${W.kind === "plant" ? `LNG ${fmt(W.cap || 9.5, 1)} MW` : `수입 ${fmt(PK.gridCap || 4, 1)} MW`}</span><span>CO₂ ${W.kind === "plant" ? "0.37" : "0.46"} t/MWh</span></p>`;
    el.innerHTML = `<p class="bd-tip-h"><b>${esc(name)}</b>${b ? `<span>${BLD[b.t].name}</span>` : ""}${mulTxt ? `<span>${mulTxt}</span>` : ""}${T.tidal ? "<span>조력 후보</span>" : ""}</p>` + siteRow +
      (T.wind > 0 ? `<p class="bd-tip-row">${T.sun ? `<span>${ico("sun")}×${T.sun.toFixed(2)}</span>` : ""}<span>${ico("wind")}${T.wind.toFixed(1)} m/s</span>${T.land ? `<span>${ico("people")}${fmt(T.near)}</span>` : ""}</p>` : "") + verdict +
      (advice.length ? `<p class="bd-note" id="bd-placement-advice">${advice.map(text => S.opts.league && text.startsWith("일사 배수") ? `<strong>${esc(text)}</strong>` : esc(text)).join("<br>")}</p>` : "") +
      (S.sel === i && BLD[S.tool] && canPlace(S.tool, i).ok ? "<p>한 번 더 누르면 설치</p>" : "");
    el.hidden = false;
    const [x, y] = tileTop(T);
    const w = el.offsetWidth, h = el.offsetHeight;
    let tx = x + V.S * 0.8, ty = y - h - V.S * 0.5;
    if (tx + w > V.W - 8) tx = x - w - V.S * 0.8;
    tx = clamp(tx, 8, V.W - w - 8);
    ty = clamp(ty, V.area.t, V.H - h - 8);
    el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
  }
  function hideTip() { const el = $("#bd-tip"); if (el) el.hidden = true; }

  function showConfirm() {
    const el = $("#bd-confirm");
    if (!el) return;
    if (S.pending) {
      const P = S.pending, ok = P.cost <= budgetLeft() + 1e-9;
      el.innerHTML = `<span class="bd-cf-t">${ico("line")}<b>${P.p.length - 1}칸</b><span class="num">${fmt(P.cost, 1)}억</span>${ok ? "" : '<span class="bd-cf-no">예산 부족</span>'}</span>
        <button type="button" class="bd-cf-ok" id="bd-cf-ok"${ok ? "" : " disabled"}>${ico("check")}<span>연결</span></button>
        <button type="button" class="bd-cf-no-btn" id="bd-cf-x">${ico("x")}<span>취소</span></button>`;
      el.hidden = false;
      el.querySelector("#bd-cf-ok").onclick = confirmLine;
      el.querySelector("#bd-cf-x").onclick = () => { cancelLine(); S.canvas.focus({ preventScroll: true }); };
    } else if (S.lineStart != null) {
      const P = S.preview;
      el.innerHTML = `<span class="bd-cf-t">${ico("line")}<b>끝점 선택</b>${P ? `<span class="num">${P.p.length - 1}칸 · ${fmt(P.cost, 1)}억</span>` : ""}</span>
        <button type="button" class="bd-cf-no-btn" id="bd-cf-x">${ico("x")}<span>취소</span></button>`;
      el.hidden = false;
      el.querySelector("#bd-cf-x").onclick = () => { cancelLine(); S.canvas.focus({ preventScroll: true }); };
    } else { el.hidden = true; el.innerHTML = ""; }
  }

  let toastTimer = 0;
  // 경고 토스트(opts.warn)가 떠 있는 동안에는 일반 토스트가 덮지 못한다: 같은 동작 안의 '결과가 나왔어요'가
  // 저장 실패 경고를 75ms 만에 지우던 문제(2026-10-20 재현).
  let toastWarnUntil = 0;
  function toast(msg, opts) {
    const el = $("#bd-toast");
    if (!el) return;
    const warn = !!opts?.warn, now = Date.now();
    if (!warn && now < toastWarnUntil) return;
    if (warn) toastWarnUntil = now + 2200;
    el.textContent = msg;
    el.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (S && S.alive) { const e2 = $("#bd-toast"); if (e2) e2.dataset.show = "false"; } }, 2200);
    S.timers.push(toastTimer);
  }
  function announce(msg) { const el = $("#bd-live"); if (el) el.textContent = msg; }
  function updateAria() {
    const live = S.net.nodes.filter(n => n.kind === "town" && n.live).length;
    const counts = {};
    S.st.builds.forEach(b => { counts[b.t] = (counts[b.t] || 0) + 1; });
    const parts = Object.keys(counts).map(k => `${BLD[k].name} ${counts[k]}`);
    const lbl = `${PK.name} 지도. ${parts.length ? parts.join(", ") : "건물 없음"}, 송전선 ${S.st.lines.length}개. 전기가 닿는 수요지 ${live}/${TOWNS.length}. 예산 잔액 ${fmt(budgetLeft(), 1)}억.` +
      (S.result ? ` 최근 운영: 정전 ${S.result.outTotal}시간, CO₂ ${fmt(S.result.co2)} t.` : "");
    S.canvas.setAttribute("aria-label", lbl);
  }

  /* ---------- 서랍 ---------- */
  const isMobile = () => (window.matchMedia ? matchMedia("(max-width: 760px)").matches : window.innerWidth <= 760);
  function openDrawer(tab) {
    S.opts.onDrawer?.();
    if (tab) S.drawerTab = tab;
    S.drawerOpen = true;
    html.classList.add("bd-drawer-open");
    $("#bd-pm").setAttribute("aria-expanded", "true");
    renderDrawer();
    S.dirtyLayout = true;
    request();
  }
  function closeDrawer(silent) {
    S.drawerOpen = false;
    html.classList.remove("bd-drawer-open");
    $("#bd-pm").setAttribute("aria-expanded", "false");
    S.dirtyLayout = true;
    request();
    if (!silent) $("#bd-pm").focus({ preventScroll: true });
  }
  function renderDrawer() {
    const body = $("#bd-drawer-body");
    if (!body) return;
    if (!uiVisible(S.drawerTab)) S.drawerTab = "policy";
    S.root.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === S.drawerTab)));
    S.root.querySelector('[data-count="policy"]').textContent = `${S.st.policies.length}/2`;
    S.root.querySelector('[data-count="mission"]').textContent = S.opts.league ? '' : `${S.st.missions.length}/2`;
    S.root.querySelector('[data-count="journal"]').textContent = S.doc.journal.length ? String(S.doc.journal.length) : "";
    const rc = S.root.querySelector('[data-count="research"]');
    if (rc) rc.textContent = S.st.rq && S.st.rq.length ? String(S.st.rq.length) : "";
    const tab = S.drawerTab;
    if (tab === "policy") {
      const full = S.st.policies.length >= 2;
      body.innerHTML = `<p class="bd-sub">${ico("cards")}정책 카드 <b>최대 2장</b></p>
        <div class="bd-cards">${POLICIES.map(P => {
          const onP = S.st.policies.includes(P.id);
          return `<button type="button" class="bd-card" data-pol="${P.id}" aria-pressed="${onP}"${!onP && full ? " disabled" : ""}>
            <span class="bd-card-ico">${ico(P.icon)}</span>
            <span class="bd-card-txt"><b>${P.name}</b><span>${P.eff()}</span></span>
            <span class="bd-card-cost num">${P.cost}</span></button>`;
        }).join("")}</div>
        <p class="bd-sub bd-sub2">${ico("alert")}차단 순서 <b>모자랄 때</b></p>
        <div class="bd-shed" role="group" aria-label="차단 순서">${SHED_OPTS.map(o => `<button type="button" class="bd-shedbtn" data-shed="${o.id}" aria-pressed="${(S.st.shed || "home") === o.id}">${o.name}</button>`).join("")}</div>
        <p class="bd-note">${S.st.shed === "equal" ? "모두 같은 비율로 줄인다(병원 포함)." : S.st.shed === "industry" ? "필수시설 다음으로 공장·산단을 지킨다." : "병원·필수시설 다음으로 집을 지킨다."}</p>
        ${PK.climate ? `<p class="bd-sub bd-sub2"${uiVisible("fab2") ? "" : " hidden"}>${ico("flask")}시나리오</p>
        <button type="button" class="bd-card" data-fab2="1" aria-pressed="${!!S.st.fab2}"${uiVisible("fab2") ? "" : " hidden"}>
          <span class="bd-card-ico">${ico("diesel")}</span>
          <span class="bd-card-txt"><b>반도체 2라인 증설</b><span>공장 5 → 10 MW</span></span>
          <span class="bd-card-mark" aria-hidden="true">${S.st.fab2 ? ico("check") : ""}</span></button>` : ""}`;
    } else if (tab === "mission") {
      body.innerHTML = `<p class="bd-sub">${ico("flag")}이번 운영 미션 <b>${S.opts.league ? "선택" : "2개"}</b></p>
        <div class="bd-cards">${MISSIONS.map(m => {
          const onM = S.st.missions.includes(m.id);
          return `<button type="button" class="bd-card mis" data-mis="${m.id}" aria-pressed="${onM}"${!onM && S.st.missions.length >= 2 ? " disabled" : ""}>
            <span class="bd-card-ico">${ico(m.icon)}</span>
            <span class="bd-card-txt"><b>${m.name}</b><span>${m.goal()}</span></span>
            <span class="bd-card-mark" aria-hidden="true">${onM ? ico("check") : ""}</span></button>`;
        }).join("")}</div>
        <p class="bd-note">${S.opts.league ? "시험 운전은 미션 없이도 가능하다. 최대 2개를 골라 비교할 수 있다." : "고른 2개만 성공·실패를 따진다. 나머지는 '대신 잃은 것'으로 본다."}</p>`;
    } else if (tab === "research") body.innerHTML = renderResearch();
    else if (tab === "journal") body.innerHTML = renderTimeline();
    else body.innerHTML = renderResult();
    if (tab === "result" && S.result) {
      const q = body.querySelector("#bd-jopen"), again = body.querySelector("#bd-again"), rr = body.querySelector("#bd-reroll");
      if (q) q.onclick = () => openJournal(S.result.entry, q);
      if (again) again.onclick = rebuild;
      if (rr) rr.onclick = () => { S.st.seed = (S.st.seed % 99991) + 1; persist(); toast(`다른 날씨(시드 ${S.st.seed})`); rebuild(); };
    }
  }
  // 연구 서랍: 기관 → 인력·자리 → 고른 연구 순서 → 이 기간이면 어디까지 가나
  function renderResearch() {
    const R0 = researchRun(S.st, 13), eff = Math.min(R0.staff, R0.seats), host = S.opts.research ? S.opts.research() : null;
    const wk = id => { const a = R0.adoptW[id], dm = R0.log.find(x => x.id === id && x.ev === "demo"); return a != null ? `${a + 1}주차 도입` : dm ? `${dm.w + 1}주차 실증 중` : "3달 안에 못 끝남"; };
    const hostTxt = id => { if (!host) return ""; const st = (host.stage || {})[id]; return st === "done" ? `도입됨(${leagueMonth() ? `${S.opts.leagueTurnLabel?.(host.adoptR[id]) || "도입 달 자료 없음"}부터` : `${host.adoptR[id]}라운드부터`})` : st === "demo" ? leagueWords("실증 중 — 다음 라운드 도입") : `진척 ${host.prog && host.prog[id] || 0}/${TECHS.find(T => T.id === id).need}`; };
    const q = S.st.rq || [];
    return `<p class="bd-sub">${ico("flask")}연구 <b>지어야 시작</b></p>
      <p class="bd-note">에너지공학대학 ${R0.unis} · 기후에너지데이터연구소 ${R0.labs} → 전문인력 ${R0.staff}명, 연구석 ${R0.seats}자리 → <b>유효 연구인력 ${eff}명</b>${R0.unis ? ` (대학 인력은 ${LG ? leagueWords("지은 다음 라운드부터") : `${RS.uniPrepW}주 뒤부터`})` : ""}${!R0.labs ? " · 연구소가 없으면 연구석이 0" : ""}</p>
      <div class="bd-cards">${TECHS.map(T => {
        const k = q.indexOf(T.id), onR = k >= 0;
        return `<button type="button" class="bd-card" data-rq="${T.id}" aria-pressed="${onR}">
          <span class="bd-card-ico">${onR ? `<b class="num">${k + 1}</b>` : ico("flask")}</span>
          <span class="bd-card-txt"><b>${esc(T.name)}</b><span>${esc(T.bundle)} · ${esc(T.id === "grid" ? gridEffectText() : T.id === "bms" ? bmsEffectText() : T.eff)}</span><small>필요 ${T.need}인·주 · 실증 ${T.demo}억 · 근거 ${esc(KCP.gradeWords(T.grade))}${onR ? ` · ${host ? hostTxt(T.id) : wk(T.id)}` : ""}</small></span></button>`;
      }).join("")}</div>
      <p class="bd-note">누른 순서대로 하나씩 연구한다. ${LG ? `리그는 ${S.opts.leagueRound?.()?.month ? `한 달마다 ${KCP.TECH_DATA?.params.roundSteps.v ?? RS.roundSteps}` : `한 턴마다 ${RS.roundSteps}`}주치 진척, 실증 1${leagueMonth() ? "달" : "턴"}, 그다음 ${leagueMonth() ? "달" : "턴"}부터 효과. 연구소 운영비 ${RS.labOpexR}억/${leagueMonth() ? "달" : "턴"}.` : `혼자 하기는 운영 기간 안에서만 진행한다(1주·1달로는 대개 못 끝남). 연구소 운영비 ${RS.labOpexW}억/주.`} 숫자는 ${esc(KCP.gradeWords("G"))}이에요.</p>`;
  }
  function satBar(v) {
    const tone = v >= 70 ? "ok" : v >= 40 ? "mid" : "bad";
    return `<span class="bd-sat" data-tone="${tone}"><span style="width:${v}%"></span></span><b class="num">${v}</b>`;
  }
  // 리그 모드 성적표: 독립 시안 미션(하루 CO₂·비용 목표) 대신 리그가 넘긴 이번 달 목표·사건 안내를 보여 준다.
  // opts.leagueTrialGoals(R) → { rows: [{ name, ok, val }], notes: [문자열] }. 훅이 없거나 실패하면 미션 줄을 숨긴다.
  function leagueGoalsHTML(R) {
    let info = null;
    try { info = typeof S.opts.leagueTrialGoals === "function" ? S.opts.leagueTrialGoals(R) : null; } catch (_) { info = null; }
    if (!info) return "";
    const rows = (info.rows || []).map(m => `<p class="bd-mis-row" data-ok="${!!m.ok}"><span class="bd-mis-mark" aria-label="${m.ok ? "목표 안" : "목표 넘음"}">${ico(m.ok ? "check" : "x")}</span><b>${esc(m.name)}</b><span class="num">${esc(m.val)}</span></p>`).join("");
    const notes = (info.notes || []).map(t => `<p class="bd-trade">${esc(t)}</p>`).join("");
    const cause = info.cause ? `<p id="bd-no-supply-cause" class="bd-trade">${esc(info.cause)}</p>` : "";
    return rows || notes || cause ? `<div class="bd-mis" id="bd-league-goals">${rows}${cause}${notes}</div>` : "";
  }
  function renderResult() {
    const R = S.result;
    if (!R) return `<div class="bd-empty">${ico("play", "v2-ico bd-empty-ico")}<p><b>아직 운영 기록 없음</b></p><p>아래 ${uiVisible("longTrial") ? "1주·1달·3달" : "시험 1주"}를 누르면 결과가 여기 떠요.</p></div>`;
    const len = R.days === 7 ? "1주" : R.days === 30 ? "1달" : "3달";
    const chosen = R.missions.filter(m => m.chosen), others = R.missions.filter(m => !m.chosen);
    const lostElse = others.filter(m => !m.ok);
    return `<h2 class="bd-res-title" id="bd-res-title" tabindex="-1">${S.opts.league ? "시험 " : ""}${len} 운영 성적표 <span class="bd-tag">${esc(PK.virtual || "가상 모형")}${R.season ? " · " + esc(displaySeason(R.season)) : ""}${R.fab2 ? " · 증설" : ""} · 시드 ${R.seed}</span></h2>
      ${R.fab2 && !uiVisible("fab2") ? `<p id="bd-fab2-active">반도체 증설 시나리오 적용 중</p>` : ""}
      <div class="bd-res-acts">
        <button type="button" class="v2-btn" id="bd-again">${ico("hammer")}<span>다시 짓기</span></button>
        <button type="button" class="v2-btn primary" id="bd-jopen"${uiVisible("journal") ? "" : " hidden"}>${ico("pen")}<span>일지 쓰기</span></button>
        <button type="button" class="v2-btn bd-reroll" id="bd-reroll">${ico("reroll")}<span>다른 날씨</span></button>
      </div>
      <ul class="bd-news">${R.news.map(t => `<li>${ico("news")}<span>${esc(t)}</span></li>`).join("")}</ul>
      ${S.opts.league ? leagueGoalsHTML(R) : `<div class="bd-mis">${chosen.map(m => `<p class="bd-mis-row" data-ok="${m.ok}"><span class="bd-mis-mark" aria-label="${m.ok ? "성공" : "실패"}">${ico(m.ok ? "check" : "x")}</span><b>${m.name}</b><span class="num">${esc(m.val)}</span></p>`).join("")}
        ${lostElse.length ? `<p class="bd-trade"><b>대신 잃은 것</b> ${lostElse.map(m => esc(m.val)).join(" · ")}</p>` : `<p class="bd-trade"><b>대신 잃은 것</b> 없음 — 다른 목표도 지켰다</p>`}</div>`}
      <div class="bd-kpis">
        <p><span>총비용</span><b class="num">${fmt(R.cost.total, 1)}억</b><small>${S.opts.league ? "건설(지도 전체 설비비)" : "건설"} ${fmt(R.cost.capex, 1)} + 연료 ${fmt(R.cost.fuel, 1)} + 정책 ${fmt(R.cost.policy, 1)}${R.cost.research ? ` + 연구 ${fmt(R.cost.research, 1)}` : ""}</small></p>
        ${R.research && (R.research.unis || R.research.labs) ? `<p><span>연구</span><b class="num">${Object.keys(R.research.adoptW).length ? Object.keys(R.research.adoptW).map(id => `${TECHS.find(T => T.id === id).name.split(/[·\s]/)[0]} ${R.research.adoptW[id] + 1}주차`).join(", ") : "도입 없음"}</b><small>${(R.st && R.st.rq || []).length || (R.research.log.length) ? `실증 ${R.research.log.filter(x => x.ev === "demo").length}건 · ` : ""}연구비 ${fmt(R.research.cost.total, 1)}억</small></p>` : ""}
        <p><span>CO₂${LG ? " 생산" : ""}</span><b class="num">${fmt(LG ? R.tot.co2 : R.co2)} t</b><small>${PK.climate ? `${R.tot.by.coal > 0 ? `석탄 ${fmt(R.tot.by.coal)} · ` : ""}LNG ${fmt(R.tot.by.lng)} · ${LG ? "" : `수입 ${fmt(R.tot.by.import)} · `}디젤 ${fmt(R.tot.by.diesel)} MWh` : `디젤 ${fmt(R.tot.diesel)} MWh`}</small></p>
        <p><span>버린 전력</span><b class="num">${fmt(R.tot.curt)} MWh</b><small>송전 손실 ${fmt(R.tot.loss)} MWh</small></p>
      </div>
      <table class="bd-towns"><thead><tr><th scope="col">수요지</th><th scope="col">정전 h</th><th scope="col">부족 MWh</th><th scope="col">만족</th></tr></thead>
        <tbody>${TOWNS.map((W, ti) => `<tr><th scope="row"><span class="bd-bn-code">${esc(W.code || W.id)}</span>${esc(W.name)}</th><td class="num${R.town[ti].outH ? " bad" : ""}">${R.town[ti].outH}</td><td class="num">${fmt(R.town[ti].uns, 1)}</td><td class="bd-sat-cell">${satBar(R.sat[ti])}</td></tr>`).join("")}</tbody></table>
`;
  }
  function rebuild() {
    S.result = null;
    S.drawerTab = "policy";
    if (isMobile()) closeDrawer(true); else renderDrawer();
    refreshHUD(); placeBannerValues(); updateAria();
    S.dirtyStatic = true;
    request();
    const first = S.root.querySelector('[data-tool="solar"]');
    if (first) first.focus({ preventScroll: true });
  }

  /* ---------- 큰 창: 도움말, 면접관 질문 ---------- */
  function makeDialog(id, kicker, title) {
    if (KCP.v2 && KCP.v2.dialog) {
      const d = KCP.v2.dialog({ id, kicker, title, className: "bd-modal" });
      S.root.append(d.el);
      return d;
    }
    return null;
  }
  function openHelp(from) {
    if (!S.help) S.help = makeDialog("bd-help-dlg", "HOW TO PLAY", PK.title);
    if (!S.help) return;
    S.help.setTitle(PK.title);
    const C = PK.climate, li = t => `<li>${esc(t)}</li>`;
    const model = C ? [
      `태양광: 월별 일사량(GHI) × 성능비 0.8, 낮 길이는 위도 ${C.lat}°로 계산 · 맑음 1 · 흐림 0.45 · 비 0.2`,
      `육상풍력: 지상 10 m 풍속 × ${C.hub_factor_land}(허브 높이) + 지형 보정, 3 m/s 아래 0 · 12 m/s 정격 · 25 m/s 넘으면 정지`,
      "해상풍력 4 MW(100 m 풍속) · 조력 2 MW × |sin(2πt/12.42h)| · 소수력은 비 오면 ×1.3, 맑은 날 사흘 넘으면 ×0.7",
      `기존 LNG 9.5 MW(CO₂ 0.37 t/MWh) · 외부 전력망 연결점마다 ${fmt(PK.gridCap || 4, 1)} MW(CO₂ 0.46 t/MWh)`,
      "디젤 3 MW(최소 1 MW, CO₂ 0.75) · 바이오매스 2 MW(CO₂ 0.1로 셈 — 바이오 탄소는 회계상 일부만 셈, 축산 단지 옆은 연료비 싸짐)",
      `송전 손실 ${fmt(100 * (PK.lossPerHex || M.lossPerHex), 1)}%/칸 · 선 ${fmt(lineUnit(), 1)}억/칸(하천·산 ×2 · 바다·호수 ×3) · ${cityName()} 밖은 못 지남`,
      "급전 순서: 재생 → 배터리 → 싼 연료부터(LNG → 수입 → 디젤·바이오매스, 탄소세 포함)",
      `${PK.scale || ""} · 수요는 실제 규모의 축소판`
    ] : [
      "태양광 2 MW × 일사(맑음 1 · 흐림 0.45 · 비 0.2) × 타일 계수",
      "풍력 2 MW × (풍속/12)³, 25 m/s 넘으면 정지",
      "디젤 3 MW(켜면 최소 1 MW) · CO₂ 0.75 t/MWh · 연료 0.01억/MWh",
      "배터리 4 MW/16 MWh · 충전·방전 각 95% · 바닥 10%",
      "송전 손실 1.5%/칸 · 선 0.5억/칸(산 ×2 · 바다 ×3)"
    ];
    S.help.body.innerHTML = `<ol class="bd-steps">
          <li>${ico("hammer")}<b>짓기</b><span>도구 → 타일</span></li>
          <li>${ico("line")}<b>잇기</b><span>발전소 ↔ 수요지</span></li>
          <li>${ico("cards")}<b>고르기</b><span>정책 ≤2 · ${S.opts.league ? "미션 선택" : "미션 2"}</span></li>
          <li>${ico("play")}<b>돌리기</b><span>1주·1달·3달</span></li>
          <li>${ico("pen")}<b>적기</b><span>일지 네 칸</span></li>
        </ol>
        <h3 class="bd-h3">${ico("pen")}일지(교사용 안내)</h3>
        <ul class="bd-tiplist">
          <li>운영마다 지표 한 줄이 남고, 학생은 네 칸(이유·예상 밖·한 문장·다음)과 오늘의 질문에 답한다.</li>
          <li>일지 탭에서 회차를 비교하고 [활동지로 복사]로 글을 모아 낸다. 이 브라우저에만 저장된다.</li>
          <li>지도는 [${esc(PACKS.island.name)}](쉬운 첫 단계)과 도시 지도(실제 지명·계절 기후)로 나뉜다. 지금 지도는 [${esc(cityName())}]이며 지도마다 따로 저장된다.</li>
        </ul>
        <h3 class="bd-h3">${ico("help")}팁</h3>
        <ul class="bd-tiplist">${tips().slice(0, 6).map(li).join("")}</ul>
        <details class="bd-model"><summary>가상 모형 숫자</summary>
          <ul>${model.map(li).join("")}<li>모자라면 차단 순서(정책 탭)대로 끊는다. 균등이 아니면 병원·필수시설이 가장 늦게 끊긴다.</li></ul>
          <p>표시 없는 수치·계수는 게임 가정(G). 억 = 게임 단위.</p>
        </details>
        ${C ? `<details class="bd-model"><summary>자료와 가정</summary>
          <ul>
            <li>위치: 북위 ${C.lat}°, 동경 ${C.lon}°(${esc(cityName())})</li>
            ${[C.ghi_note, C.wind10_note, C.hub_note, C.wind100_sea_note, C.temp_note].map(li).join("")}
            ${(PK.sources || []).map(li).join("")}
            <li>${esc(PK.note || "")}</li>
          </ul>
        </details>` : ""}`;
    S.help.open(from);
  }
  /* ---------- 건설 일지 ---------- */
  const lenName = d => (d === 7 ? "1주" : d === 30 ? "1달" : "3달");
  const polName = id => (POLICIES.find(P => P.id === id) || {}).name || id;
  const misName = id => (MISSIONS.find(P => P.id === id) || {}).name || id;
  const findEntry = id => S.doc.journal.find(e => e.id === id) || null;
  const mapName = id => (PACKS[id] || PACKS[PACK_IDS[0]]).name;
  const entryDate = e => `${e.id}번째 운영 · ${mapName(e.map)}${e.season ? " · " + e.season : ""} · ${lenName(e.days)} · 맑음 ${e.wx[0]}일/흐림 ${e.wx[1]}일/비 ${e.wx[2]}일`;
  const misTxt = e => (e.mis.length ? e.mis.map(m => `${misName(m.id)} ${m.ok ? "✓" : "✗"}`).join(" · ") : "없음");
  const misHtml = e => (e.mis.length ? e.mis.map(m => `<span class="bd-mk" data-ok="${m.ok}">${esc(misName(m.id))} ${ico(m.ok ? "check" : "x", "v2-ico bd-mk-i")}<span class="bd-sr">${m.ok ? "성공" : "실패"}</span></span>`).join(" ") : "없음");
  const metricLine = e => `정전 ${fmt(e.m.out)}h · CO₂ ${fmt(e.m.co2)} t · 비용 ${fmt(e.m.cost, 1)}억 · 민원 ${fmt(e.m.cp)}건 · 정책 ${e.pol.length ? e.pol.map(polName).join(", ") : "없음"} · 미션 ${misTxt(e)}`;
  function jStrip(e) {
    const it = (k, v) => `<span><span class="bd-js-k">${k}</span> <b class="num">${esc(v)}</b></span>`;
    return `<p class="bd-jstrip">${it("정전", fmt(e.m.out) + "h")}${it("CO₂", fmt(e.m.co2) + " t")}${it("비용", fmt(e.m.cost, 1) + "억")}${it("민원", fmt(e.m.cp) + "건")}${it("정책", e.pol.length ? e.pol.map(polName).join("·") : "없음")}<span><span class="bd-js-k">미션</span> ${misHtml(e)}</span></p>`;
  }
  function openJournal(id, from) {
    if (!uiVisible("journal")) return;
    const e = findEntry(id);
    if (!e) { toast("일지 기록이 없다"); return; }
    if (!S.jdlg) {
      S.jdlg = makeDialog("bd-j-dlg", "JOURNAL", "건설 일지");
      if (!S.jdlg) return;
      S.jdlg.el.classList.add("bd-jmodal");
      S.jdlg.el.addEventListener("close", () => {
        stopSpeak();
        if (!S || S.drawerTab !== "journal" || !S.drawerOpen) return;
        const paper = S.jdlg.body.querySelector("[data-entry]"), id = paper ? paper.dataset.entry : "";
        renderDrawer();
        const back = S.root.querySelector(`[data-jopen="${id}"]`);
        if (back) back.focus({ preventScroll: true });
      });
    }
    stopSpeak();
    const area = (k, label, val) => `<textarea class="bd-jta" id="bd-j-${k}" data-j="${k}" rows="2" maxlength="${J_LEN}"${label ? ` aria-label="${esc(label)}"` : ""}>${esc(val)}</textarea>`;
    S.jdlg.body.innerHTML = `<div class="bd-paper" data-entry="${e.id}">
        <p class="bd-jdate">${esc(entryDate(e))}</p>
        ${jStrip(e)}
        <ol class="bd-jq">${JQ.map((P, k) => `<li>
          <div class="bd-jq-h"><label for="bd-j-${P.k}"><span class="bd-jn num">${k + 1}</span>${esc(P.q)}</label>
            <button type="button" class="bd-jhint" aria-expanded="false" aria-controls="bd-jh-${P.k}" aria-label="힌트: ${esc(P.q)}">?</button></div>
          <p class="bd-jhint-t" id="bd-jh-${P.k}" hidden>${P.h.map(esc).join("<br>")}</p>
          ${area(P.k, "", e.a[P.k])}</li>`).join("")}</ol>
        ${e.q ? `<div class="bd-jtoday"><p class="bd-jtoday-k">${ico("help")}오늘의 질문</p><label for="bd-j-q">${esc(e.q)}</label>${area("q", "", e.a.q)}</div>` : ""}
      </div>
      <div class="bd-jfoot">
        <button type="button" class="bd-speak" id="bd-speak" aria-pressed="false">${ico("mic")}<span>말로 해 보기</span><b class="num" id="bd-speak-t">0:00</b></button>
        <span class="bd-jsaved" id="bd-jsaved">자동 저장</span>
      </div>`;
    const B = S.jdlg.body;
    B.querySelectorAll("[data-j]").forEach(t => {
      t.addEventListener("input", () => {
        const cur = findEntry(e.id);
        if (!cur) return;
        cur.a[t.dataset.j] = t.value.slice(0, J_LEN);
        persist();
        const sv = B.querySelector("#bd-jsaved");
        if (sv) sv.textContent = "저장됨";
      });
    });
    B.querySelectorAll(".bd-jhint").forEach(b => {
      b.onclick = () => {
        const open = b.getAttribute("aria-expanded") !== "true";
        b.setAttribute("aria-expanded", String(open));
        B.querySelector("#" + b.getAttribute("aria-controls")).hidden = !open;
      };
    });
    B.querySelector("#bd-speak").onclick = () => (S.speak ? stopSpeak() : startSpeak());
    S.jdlg.open(from);
  }
  // 말로 해 보기: 녹음 없이 시간만 잰다.
  function startSpeak() {
    if (!uiVisible("journal")) return;
    const b = $("#bd-speak"), t = $("#bd-speak-t");
    if (!b) return;
    const t0 = Date.now();
    b.setAttribute("aria-pressed", "true");
    S.speak = setInterval(() => {
      if (!S || !t.isConnected) { stopSpeak(); return; }
      const sec = Math.floor((Date.now() - t0) / 1000);
      t.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }, 500);
  }
  function stopSpeak() {
    if (!S || !S.speak) return;
    clearInterval(S.speak);
    S.speak = 0;
    const b = $("#bd-speak");
    if (b) b.setAttribute("aria-pressed", "false");
  }
  function cmp(cur, prev, label, unit, d = 0) {
    if (prev == null) return "";
    const diff = cur - prev, eps = d ? 0.05 : 0.5;
    const dir = diff < -eps ? "down" : diff > eps ? "up" : "same";
    const ch = dir === "down" ? "↓" : dir === "up" ? "↑" : "→";
    const sr = dir === "down" ? "이전보다 줄었음" : dir === "up" ? "이전보다 늘었음" : "이전과 같음";
    return `<span class="bd-cmp" data-dir="${dir}">${label} ${ch}<span class="bd-sr"> ${sr}(${fmt(prev, d)}${unit} → ${fmt(cur, d)}${unit})</span></span>`;
  }
  function renderTimeline() {
    const list = S.doc.journal;
    if (!list.length) return `<div class="bd-empty">${ico("pen", "v2-ico bd-empty-ico")}<p><b>아직 일지 없음</b></p><p>운영을 한 번 돌리면 여기 쌓인다.</p></div>`;
    const cards = list.map((e, k) => {
      const p = k ? list[k - 1] : null;
      const answered = JQ.filter(P => e.a[P.k].trim()).length + (e.q && e.a.q.trim() ? 1 : 0);
      return `<li class="bd-jcard">
        <p class="bd-jc-h"><b>${e.id}번째 · ${lenName(e.days)}</b><span class="num">${esc(e.at)}</span></p>
        <p class="bd-jc-map"><span class="bd-mapchip">${esc(mapName(e.map))}</span>${e.season ? `<span>${esc(e.season)}</span>` : ""}</p>
        <p class="bd-jc-m"><span>정전 <b class="num">${fmt(e.m.out)}h</b></span><span>CO₂ <b class="num">${fmt(e.m.co2)} t</b></span><span>비용 <b class="num">${fmt(e.m.cost, 1)}억</b></span><span>민원 <b class="num">${fmt(e.m.cp)}건</b></span></p>
        ${p ? `<p class="bd-jc-cmp">${cmp(e.m.out, p.m.out, "정전", "h")}${cmp(e.m.co2, p.m.co2, "CO₂", " t")}${cmp(e.m.cost, p.m.cost, "비용", "억", 1)}</p>` : ""}
        <p class="bd-jc-mis">${misHtml(e)}</p>
        <dl class="bd-jc-a">${JQ.map(P => `<dt>${P.s}</dt><dd${e.a[P.k].trim() ? "" : ' class="empty"'}>${e.a[P.k].trim() ? esc(e.a[P.k]) : "아직 안 씀"}</dd>`).join("")}</dl>
        <button type="button" class="bd-jc-btn" data-jopen="${e.id}">${ico("pen")}<span>${answered ? "고치기" : "쓰기"}</span></button>
      </li>`;
    }).reverse().join("");
    return `<div class="bd-jtop"><p class="bd-sub">${ico("pen")}건설 일지 <b>${list.length}회</b></p>
        <button type="button" class="v2-btn bd-copy" id="bd-copy">${ico("copy")}<span>활동지로 복사</span></button></div>
      <textarea class="bd-copybox" id="bd-copybox" readonly hidden aria-label="활동지 글(복사용)"></textarea>
      <ol class="bd-jlist">${cards}</ol>`;
  }
  function worksheetText() {
    const out = ["전력망 건설 · 건설 일지", "(가상 모형 연습)", ""];
    S.doc.journal.forEach(e => {
      out.push(`[${entryDate(e)} · ${e.at}]`, metricLine(e));
      JQ.forEach((P, k) => { out.push(`${k + 1}. ${P.q}`, `→ ${e.a[P.k].trim() || "(아직 안 씀)"}`); });
      if (e.q) out.push(`오늘의 질문: ${e.q}`, `→ ${e.a.q.trim() || "(아직 안 씀)"}`);
      out.push("");
    });
    return out.join("\n");
  }
  function copyWorksheet() {
    const text = worksheetText();
    const fallback = () => {
      const box = $("#bd-copybox");
      if (!box) return;
      box.value = text;
      box.hidden = false;
      box.focus({ preventScroll: false });
      box.select();
      toast("선택됨 · Ctrl+C");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => { if (S && S.alive) toast("활동지 글을 복사했다"); }, () => { if (S && S.alive) fallback(); });
      } else fallback();
    } catch (err) { fallback(); }
  }

  /* ---------- 배치 계산 ---------- */
  function layout() {
    S.dirtyLayout = false;
    const W = window.innerWidth, H = window.innerHeight;
    V.W = W; V.H = H;
    S.g = (KCP.v2 && KCP.v2.fit) ? KCP.v2.fit(S.canvas, W, H) : S.canvas.getContext("2d");
    const hud = $("#bd-hud").getBoundingClientRect();
    const bar = $("#bd-mapbar").getBoundingClientRect();
    const dock = $("#bd-dock").getBoundingClientRect();
    const mob = isMobile();
    // 멀티플레이 팀 띠(.lg-bar)가 HUD 아래에 붙으면 그 아래부터 지도·서랍을 둔다.
    html.style.setProperty("--bd-hudb", `${Math.round(hud.bottom)}px`);
    const lgb = S.root.querySelector(".lg-bar"), top = lgb ? Math.max(hud.bottom, lgb.getBoundingClientRect().bottom) : hud.bottom;
    html.style.setProperty("--bd-top", `${Math.round(top + 8)}px`);
    html.style.setProperty("--lg-mapbar-bottom", `${Math.round($("#bd-mapbar").getBoundingClientRect().bottom + 8)}px`);
    html.style.setProperty("--bd-dock", `${Math.round(H - $("#bd-dock").getBoundingClientRect().top)}px`);
    let r = W - 8;
    if (S.drawerOpen && !mob) { const dr = $("#bd-drawer").getBoundingClientRect(); if (dr.width) r = dr.left - 8; }
    if (S.opts.league && W >= 761 && W <= 1279 && S.root.dataset.resultDrawer === "true") {
      const drawer = S.root.querySelector("#lg-panel");
      if (drawer && !drawer.hidden) r = drawer.getBoundingClientRect().left - 8;
    }
    let b = (dock.height ? dock.top : H) - 6;
    if (S.opts.league) {
      const stripTop = Math.max(top, $("#bd-mapbar").getBoundingClientRect().bottom) + 8;
      const reminder = S.root.querySelector("#lg-plan-reminder");
      let infoTop = stripTop;
      if (reminder) {
        const stage = S.root.querySelector(".bd-stage").getBoundingClientRect();
        reminder.style.left = `${Math.max(10, 8 - stage.left)}px`;
        reminder.style.right = `${Math.max(10, stage.right - r)}px`;
        reminder.style.top = `${stripTop - stage.top}px`;
        const height = reminder.getBoundingClientRect().height;
        if (height) infoTop += height + 8;
      }
      html.style.setProperty("--lg-map-info-top", `${Math.ceil(infoTop)}px`);
      const lenses = S.root.querySelector(".lg-lenses");
      // 띠가 보이면 범례를 띠 아래로 내린다. 범례 top은 렌즈 부모 기준이다.
      if (lenses) lenses.style.setProperty("--lg-lens-key-top", `${infoTop > stripTop ? Math.max(48, Math.ceil(infoTop - lenses.getBoundingClientRect().top)) : 48}px`);
      S.leagueMapTop = infoTop;
    }
    V.area = { l: 8, t: Math.max(top, bar.bottom) + 6, r, b };
    if (S.opts.league) V.area.t = S.leagueMapTop;
    fitView();
    const wc = $("#bd-windchip svg");
    if (wc) wc.style.transform = V.rot ? "rotate(90deg)" : "";
    S.dirtyStatic = true;
    S.bannerKey = "";
    if (S.hover != null && !S.run) showTip(S.hover);
  }
  function setLayer(id) {
    S.layer = id;
    S.root.querySelectorAll("[data-layer]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layer === id)));
    const lg = $("#bd-legend");
    if (id === "map") { lg.hidden = true; }
    else {
      const R = RAMPS[id], lab = id === "sun" ? [`×${SRANGE()[0]}`, "×1.0", "일사 계수"] : id === "wind" ? [String(WRANGE()[0]), `${WRANGE()[1]} m/s`, PK.climate ? "연평균 풍속(허브·해상 100 m)" : "평균 풍속"] : ["적음", "많음", "주민"];
      lg.innerHTML = `<span class="bd-lg-k">${lab[2]}</span><span class="num">${lab[0]}</span><span class="bd-lg-bar" style="background:linear-gradient(90deg,${R.map(c => rgb(c)).join(",")})"></span><span class="num">${lab[1]}</span>`;
      lg.hidden = false;
    }
    S.dirtyStatic = true;
    S.dirtyLayout = true;
    request();
  }

  /* =====================================================================
   * 9. 라우트
   * ===================================================================== */
  function teardown() {
    if (!S) return;
    const root = S.root, replayDone = S.run?.replay ? S.run.opts.onDone : null;
    S.run = null;
    S.mapFx = []; S.flowView = null;
    S.alive = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.timers.forEach(t => clearTimeout(t));
    S.off.forEach(f => f());
    if (S.ro) S.ro.disconnect();
    if (S.speak) clearInterval(S.speak);
    [S.help, S.jdlg].forEach(d => { if (d) d.close(); });
    html.classList.remove("bd-on", "bd-running", "bd-drawer-open");
    html.style.removeProperty("--bd-top");
    html.style.removeProperty("--bd-dock");
    if (S.opts.league) html.style.removeProperty("--lg-map-info-top");
    S = null;
    replayDone?.({ cancelled: true });
    KCP.fxTurn?.clearForMap?.(root);
  }
  KCP.on("route:change", teardown);
  // 검사용 읽기 도구: 화면 위 타일 좌표, 살아 있는지
  KCP.buildGame.tileXY = (c, r) => (S ? tileTop(TILES[tix(c, r)]) : null);
  KCP.buildGame.active = () => !!S;

  // 화면의 일시 상태만 복사한다. 건설 문서·시뮬레이션 상태에는 손대지 않는다.
  function saveView() {
    if (!S) return null;
    return { map: S.doc.map, zoom: V.zoom, panX: V.panX, panY: V.panY, tool: S.tool,
      lineStart: S.lineStart, pending: S.pending ? { ...S.pending, p: S.pending.p.slice() } : null, sel: S.sel };
  }
  function restoreView(view) {
    if (!S || !view || view.map !== S.doc.map) return;
    V.zoom = view.zoom; V.panX = view.panX; V.panY = view.panY;
    S.tool = view.tool; S.lineStart = view.lineStart; S.sel = view.sel;
    S.pending = view.pending ? { ...view.pending, p: view.pending.p.slice() } : null;
    S.preview = null;
    S.root.dataset.mode = S.tool || "";
    renderTools(); showConfirm(); S.dirtyLayout = true; request();
  }

  // opts(모두 선택): packs 고를 지도 · load()/save(doc) 저장 · budget() 예산 · locked() 잠금 사유 문자열 · onChange(st) · salvage(이름표) 철거 회수율 · research() 리그 연구 상태
  //   league 리그 모드(외부 연결점) · solo 혼자 하기(긴 시험 유지) · season() 정해진 계절 · leagueRound() HUD에 표시할 현재 턴({year, month, season}) · onMount(root) 화면이 생긴 뒤 · view saveView()의 복원값
  //   leagueMods(st) 사건을 뺀 이번 달 운영 보정값(trialMods 계약) · leagueGrid(st) 계획 기준 접속 상태(gridStatus, entries 포함 시 설비별 대기 계산)
  //   leagueTrialGoals(R) 리그 성적표의 이번 달 목표 줄·사건 안내({rows, notes}). 리그 모드에서는 독립 시안 미션 줄을 대신한다.
  //   trialScope 방·팀별 시험 저장 구분 키. lastTrial(map?, scope?)는 days·unsPct·outH·co2·cost·capex·opex와 달·계획을 반환한다.
  const K_LENSES = "kcp-league-lenses-v1";
  function rememberLenses() {
    S.lensChosen = true;
    try { localStorage.setItem(K_LENSES, JSON.stringify(S.lenses)); } catch (_) {}
  }
  function mount(app, opts) {
    opts = opts || {};
    teardown();
    html.classList.add("bd-on");
    const doc = opts.load ? opts.load() : loadState();
    const packs = opts.packs || PACK_IDS;
    if (!packs.includes(doc.map)) doc.map = packs[0];
    selectPack(doc.map, opts.league ? "league" : undefined);
    const st = doc.maps[doc.map];
    if (opts.season) st.season = opts.season();
    const root = shell(app, packs);
    root.classList.toggle("bd-league", !!opts.league);
    S = {
      opts, alive: true, root, doc, st, net: network(st), openGroup: null, seasonOpen: false, canvas: root.querySelector("#bd-canvas"), base: document.createElement("canvas"),
      g: null, raf: 0, born: performance.now(), off: [], timers: [], ro: null, layer: "map", tool: null, hover: null, kbd: false, sel: null,
      lenses: { complaints: false, grid: false, result: true }, lensCache: null,
      lineStart: null, pending: null, preview: null, undo: [], run: null, result: null, drawerOpen: false, drawerTab: "policy",
      floaters: [], mapFx: [], flowView: null, rec: { hubs: [], stacks: [], wins: [], pylons: new Map() }, dirtyStatic: true, dirtyLayout: true, banners: null, bannerKey: "",
      tipSeq: 0, lastTick: "", help: null, jdlg: null, speak: 0, runNet: { dk: {} }
    };
    if (opts.league) {
      try { const saved = JSON.parse(localStorage.getItem(K_LENSES)); if (saved) { ["complaints", "grid", "result"].forEach(k => { if (typeof saved[k] === "boolean") S.lenses[k] = saved[k]; }); S.lensChosen = true; } } catch (_) {}
      const lenses = document.createElement("div"); lenses.className = "lg-lenses"; lenses.setAttribute("role", "group"); lenses.setAttribute("aria-label", "영향과 결과 렌즈");
      lenses.innerHTML = [["complaints", "민원"], ["grid", "전력망"], ["result", "결과"]].map(([key, label]) => `<button type="button" class="bd-layer" data-lens="${key}" aria-pressed="${S.lenses[key]}">${label}</button>`).join("");
      root.querySelector(".bd-layers").append(lenses);
      const legend = document.createElement("span"); legend.className = "lg-lens-key"; legend.textContent = "하늘색: 선 닿음 · 노랑: 선 안 닿음 · 분홍 점선: 민원 반경";
      lenses.append(legend);
      lenses.addEventListener("click", e => { const b = e.target.closest("[data-lens]"); if (!b) return; S.lenses[b.dataset.lens] = !S.lenses[b.dataset.lens]; rememberLenses(); syncLensButtons(); placeBannerValues(); request(); });
      const summary = document.createElement("p"); summary.id = "lg-map-result"; summary.className = "lg-map-result"; summary.hidden = true; root.querySelector(".bd-stage").append(summary);
      const grid = document.createElement("p"); grid.id = "lg-lens-grid"; grid.className = "lg-lens-grid"; grid.hidden = true; root.querySelector("#bd-mapbar").append(grid);
      root.querySelector('[data-tab="mission"]').hidden = true;
      root.querySelectorAll('[data-tab="research"], [data-tab="journal"]').forEach(b => { b.hidden = !uiVisible(b.dataset.tab); });
      root.querySelectorAll("[data-run]").forEach(b => { b.textContent = `시험 ${b.textContent}`; });
      root.querySelectorAll('[data-run="30"], [data-run="90"]').forEach(b => { b.hidden = !uiVisible("longTrial"); });
      root.querySelector("#bd-pm span").textContent = "정책·결과";
    }
    V.zoom = 1; V.panX = 0; V.panY = 0; V.lastRot = -1;
    applyPack();
    bindCanvas(S.canvas);
    on(root.querySelector("#bd-dock"), "click", e => {
      if (e.target.closest("#bd-undo")) { undoPlacement(); return; }
      const t = e.target.closest("[data-tool]"), gr = e.target.closest("[data-group]"), se = e.target.closest("[data-season]");
      if (t) setTool(t.dataset.tool);
      else if (gr) openGroup(gr.dataset.group);
      else if (se) { S.st.season = se.dataset.season; S.seasonOpen = false; changed(`시작 계절 ${seasonName(S.st.season)}`); renderSeasons(); $("#bd-season").focus({ preventScroll: true }); }
      else if (e.target.closest("#bd-season") && S.opts.season) toast("계절은 진행자가 라운드마다 정합니다");
      else if (e.target.closest("#bd-season")) { S.seasonOpen = !S.seasonOpen; S.openGroup = null; renderTools(); renderSeasons(); if (S.seasonOpen) { const f = $("#bd-seasons [aria-pressed=true]"); if (f) f.focus({ preventScroll: true }); } }
    });
    const mapPop = root.querySelector("#bd-mappop"), mapCur = root.querySelector("#bd-mapcur");
    const mapPopShow = v => { if (!mapPop) return; mapPop.hidden = !v; mapCur.setAttribute("aria-expanded", String(v)); };
    root.querySelectorAll("[data-map]").forEach(b => on(b, "click", () => { mapPopShow(false); switchMap(b.dataset.map); if (mapCur) mapCur.focus({ preventScroll: true }); }));
    if (mapCur) {
      on(mapCur, "click", () => { mapPopShow(mapPop.hidden); if (!mapPop.hidden) { const f = mapPop.querySelector("[aria-pressed=true]") || mapPop.querySelector("[data-map]"); f.focus({ preventScroll: true }); } });
      on(document, "pointerdown", e => { if (!mapPop.hidden && !e.target.closest(".bd-maps")) mapPopShow(false); });
      on(document, "keydown", e => { if (e.key === "Escape" && !mapPop.hidden) { mapPopShow(false); mapCur.focus({ preventScroll: true }); e.preventDefault(); } });
    }
    on(document, "pointerdown", e => { if (S && (S.openGroup || S.seasonOpen) && !e.target.closest("#bd-dock")) closePops(); });
    root.querySelectorAll("[data-layer]").forEach(b => on(b, "click", () => setLayer(b.dataset.layer)));
    root.querySelectorAll("[data-zoom]").forEach(b => on(b, "click", () => {
      const steps = [1, 1.5, 2.2], k = steps.indexOf(V.zoom);
      const nk = clamp((k < 0 ? 0 : k) + +b.dataset.zoom, 0, steps.length - 1);
      V.zoom = steps[nk];
      if (V.zoom === 1) { V.panX = 0; V.panY = 0; }
      S.dirtyLayout = true; hideTip(); request();
    }));
    root.querySelectorAll("[data-run]").forEach(b => on(b, "click", () => startRun(+b.dataset.run)));
    root.querySelectorAll("[data-tab]").forEach(b => on(b, "click", () => { S.drawerTab = b.dataset.tab; renderDrawer(); }));
    on(root.querySelector("#bd-pm"), "click", () => (S.drawerOpen ? closeDrawer() : openDrawer()));
    on(root.querySelector("#bd-drawer-x"), "click", () => closeDrawer());
    on(root.querySelector("#bd-help"), "click", e => S.opts.onHelp ? S.opts.onHelp(e.currentTarget) : openHelp(e.currentTarget));
    on(root.querySelector("#bd-skip"), "click", () => { if (S.run?.replay) skipReplay(); else if (S.run) finishRun(); });
    on(root.querySelector("#bd-drawer-body"), "click", e => {
      const p = e.target.closest("[data-pol]"), m = e.target.closest("[data-mis]"), jo = e.target.closest("[data-jopen]");
      const sh = e.target.closest("[data-shed]"), fb = e.target.closest("[data-fab2]");
      if (jo) { openJournal(+jo.dataset.jopen, jo); return; }
      const rq = e.target.closest("[data-rq]");
      if ((sh || fb || p || rq) && lockedMsg()) { toast(lockedMsg()); return; }
      if (rq) {
        const id = rq.dataset.rq, list = S.st.rq = S.st.rq || [];
        if (list.includes(id)) list.splice(list.indexOf(id), 1); else list.push(id);
        changed(list.includes(id) ? `연구 순서 ${list.indexOf(id) + 1}: ${TECHS.find(T => T.id === id).name}` : "연구 뺌"); S.root.querySelector(`[data-rq="${id}"]`).focus({ preventScroll: true }); return;
      }
      if (sh) { S.st.shed = sh.dataset.shed; changed(`차단 순서: ${SHED_OPTS.find(o => o.id === S.st.shed).name}`); S.root.querySelector(`[data-shed="${S.st.shed}"]`).focus({ preventScroll: true }); return; }
      if (fb) { S.st.fab2 = !S.st.fab2; changed(S.st.fab2 ? "반도체 2라인 증설 켬" : "증설 끔"); S.root.querySelector("[data-fab2]").focus({ preventScroll: true }); return; }
      if (e.target.closest("#bd-copy")) { copyWorksheet(); return; }
      if (p && !p.disabled) {
        const id = p.dataset.pol, list = S.st.policies;
        if (list.includes(id)) list.splice(list.indexOf(id), 1); else if (list.length < 2) list.push(id);
        changed(); S.root.querySelector(`[data-pol="${id}"]`).focus({ preventScroll: true });
      } else if (m && !m.disabled) {
        const id = m.dataset.mis, list = S.st.missions;
        if (list.includes(id)) list.splice(list.indexOf(id), 1); else if (list.length < 2) list.push(id);
        changed(); S.root.querySelector(`[data-mis="${id}"]`).focus({ preventScroll: true });
      }
    });
    on(document, "keydown", undoShortcut);
    on(document, "keydown", e => {
      if (e.key !== "Escape" || !S || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      if (S.openGroup || S.seasonOpen) { const back = S.openGroup ? `[data-group="${S.openGroup}"]` : "#bd-season"; closePops(); const b = $(back); if (b) b.focus({ preventScroll: true }); e.preventDefault(); return; }
      if (S.drawerOpen && isMobile()) { closeDrawer(); e.preventDefault(); }
    });
    on(window, "resize", () => { S.dirtyLayout = true; request(); });
    on(document, "visibilitychange", () => request());
    if (window.ResizeObserver) { S.ro = new ResizeObserver(() => { if (S) { S.dirtyLayout = true; request(); } }); S.ro.observe(root.querySelector("#bd-hud")); S.ro.observe(root.querySelector("#bd-dock")); S.ro.observe(root.querySelector("#bd-drawer")); }
    renderDrawer();
    refreshHUD();
    placeBannerValues();
    updateAria();
    setLayer("map");
    if (opts.view) restoreView(opts.view);
    layout();
    request();
    if (opts.onMount) opts.onMount(root);
  }
  KCP.route("build", app => mount(app, {}));
  // 멀티플레이 팀 화면이 쓰는 도구: 화면 띄우기, 지금 칸, 예산·잠금 바뀐 뒤 다시 그리기, 계절 맞추기
  Object.assign(KCP.buildGame, {
    powerChipDefinition, replayMonth, skipReplay, mapMotion, setMapMood,
    mount, saveView, restoreView, lastTrial, openHelp: trigger => { if (S?.alive) { S.opts.onDrawer?.(); openHelp(trigger); } }, clearTrialDisplay: () => { if (S?.alive) { S.result = null; placeBannerValues(); request(); } }, closeDrawer: () => { if (S?.alive) closeDrawer(true); },
    current: () => (S ? S.st : null), planIssues,
    refresh: () => { if (S) { S.net = network(S.st); S.dirtyStatic = true; refreshHUD(); renderSeasons(); renderDrawer(); placeBannerValues(); updateAria(); request(); } },
    setSeason: id => { if (S && SEASONS.some(x => x.id === id) && S.st.season !== id) { S.st.season = id; S.result = null; refreshHUD(); renderSeasons(); request(); } },
    toast: (msg, opts) => { if (S) toast(msg, opts); }
  });
})();
