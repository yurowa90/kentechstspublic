/* 은여울강 가뭄 협상 장면(화면 시안 v2): 양피지 유역 원정 지도
 * 90년대 말 역사 실시간 전략 게임의 원정 지도와 외교 창을 오마주했다. 상업 게임 이름은 쓰지 않는다.
 * - 상류 → 하류: 저수지·댐 → 농업 수로와 들녘 → 수도교와 여울시 → 하구 갯벌 → 바다.
 * - 강·수로 폭은 감량 뒤 실제 공급량(model.simulate)에 비례한다. 저수지 수위는 고른 전망의 기말 저수량이다.
 * - 깃발 색은 마지막 제출의 반응(수용 초록·조건부 황색·거부 빨강)이고 제출 전에는 흰 깃발이다.
 *   상정안을 확정하면 밀랍 인장을 찍는다.
 * 게임 상태는 읽기만 한다. 수치는 게임 모형을 그대로 부른다(모형이 없을 때만 물 수지 최소 대체).
 * 양피지·지형 층과 배분 상태 층은 화면 밖 캔버스에 캐시하고, 물결·깃발·물고기만 매 프레임 그린다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  const TAU = Math.PI * 2, EPS = 1e-9;
  const PARTIES = ["dam", "ag", "city", "eco"];
  const SHORT = ["공사", "농민", "도시", "하구"];
  const STATUS_KO = { accept: "수용", conditional: "조건부", reject: "거부", none: "대기" };
  const SCEN = { dry: { ko: "건조", inflow: 15 }, normal: { ko: "평년", inflow: 55 }, wet: { ko: "습윤", inflow: 100 } };
  const FINAL_KO = { unanimous: "만장일치안", majority: "다수 합의안", administrative: "행정 결정 요청" };
  const BASE = { ag: 50, city: 35, env: 20 };
  const ORDERS = ["proportional", "agFirst", "cityFirst", "envFirst"];
  // 참가자 색(고전 전략 게임의 1~4번 플레이어 색): 공사 파랑, 농민 노랑, 도시 빨강, 하구 초록
  const PLAYER = ["#2d5fc4", "#d9aa1c", "#c43a2b", "#2f8f3f"];
  // 깃발 천 색은 반응을 뜻한다. 제출 전에는 흰 깃발(휴전 깃발)이다.
  const FLAG = { none: "#f4efe1", accept: "#3b8a3a", conditional: "#e2a52b", reject: "#b3302a" };
  const BADGE_INK = { none: "#4a3520", accept: "#ffffff", conditional: "#2a1a05", reject: "#ffffff" };
  const SERIF = '"Nanum Myeongjo", "Noto Serif KR", "Noto Serif CJK KR", "Batang", serif';
  const SANS = '"IBM Plex Sans KR", "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
  const WOOD = "#3a2616", GOLD = "#c9a043", GOLD2 = "#e8c873";

  /* ---------- 작은 도구 ---------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const isNum = x => typeof x === "number" && Number.isFinite(x);
  const own = (o, key) => !!o && Object.prototype.hasOwnProperty.call(o, key);
  const fmt = x => isNum(x) ? String(Math.round(x * 10) / 10) : "–";
  const isStatus = s => s === "accept" || s === "conditional" || s === "reject";
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const c = rgb(hex);
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return "#" + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, "0")).join("");
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function trace(g, pts, close) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (close) g.closePath();
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] + EPS) + a[0]) inside = !inside;
    }
    return inside;
  }
  // Catmull-Rom 곡선을 촘촘한 꺾은선으로 바꾼다.
  function spline(pts, per) {
    const out = [], n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  }
  function makePath(points) {
    const s = [0], nrm = [];
    for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      nrm.push([-dy / l, dx / l]);
    }
    return { pts: points, s, n: nrm, len: s[s.length - 1] || 1 };
  }
  function pointAt(P, d) {
    const s = P.s;
    d = clamp(d, 0, P.len);
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < d) lo = mid; else hi = mid;
    }
    const t = (d - s[lo]) / ((s[hi] - s[lo]) || 1), a = P.pts[lo], b = P.pts[hi];
    return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), nx: P.n[lo][0], ny: P.n[lo][1], i: lo };
  }
  function nearestX(P, x) {
    let bi = 0, bd = Infinity;
    P.pts.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  function blob(cx, cy, rx, ry, n, seed, amp) {
    const r = rng(seed), a1 = r() * TAU, a2 = r() * TAU, a3 = r() * TAU, out = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      const q = 1 + amp * (0.55 * Math.sin(3 * a + a1) + 0.3 * Math.sin(5 * a + a2) + 0.15 * Math.sin(9 * a + a3));
      out.push([cx + Math.cos(a) * rx * q, cy + Math.sin(a) * ry * q]);
    }
    return out;
  }
  // 경로 양옆으로 폭을 준 띠의 두 가장자리. wob은 손으로 그린 듯한 떨림이다.
  function ribbon(P, widthAt, wob) {
    const left = [], right = [];
    for (let i = 0; i < P.pts.length; i++) {
      const p = P.pts[i], nn = P.n[i];
      const hw = Math.max(0.3, widthAt(i) / 2);
      const jl = wob ? wob * (Math.sin(i * 1.73) * 0.5 + Math.sin(i * 0.61 + 1) * 0.5) : 0;
      const jr = wob ? wob * (Math.sin(i * 1.31 + 2) * 0.5 + Math.sin(i * 0.47) * 0.5) : 0;
      left.push([p[0] + nn[0] * (hw + jl), p[1] + nn[1] * (hw + jl)]);
      right.push([p[0] - nn[0] * (hw + jr), p[1] - nn[1] * (hw + jr)]);
    }
    return { left, right };
  }
  function fillRibbon(g, rb) {
    g.beginPath();
    g.moveTo(rb.left[0][0], rb.left[0][1]);
    for (let i = 1; i < rb.left.length; i++) g.lineTo(rb.left[i][0], rb.left[i][1]);
    for (let i = rb.right.length - 1; i >= 0; i--) g.lineTo(rb.right[i][0], rb.right[i][1]);
    g.closePath();
  }
  function text(g, s, x, y, font, fill, halo, align) {
    g.font = font;
    g.textAlign = align || "center";
    g.textBaseline = "middle";
    if (halo) {
      g.lineJoin = "round";
      g.lineWidth = 3;
      g.strokeStyle = halo;
      g.strokeText(s, x, y);
    }
    g.fillStyle = fill;
    g.fillText(s, x, y);
  }

  /* ---------- 상태 읽기(읽기 전용) ---------- */
  const int80 = (x, d) => Number.isInteger(x) && x >= 0 && x <= 80 ? x : d;
  function planOf(x) {
    const p = x && typeof x === "object" ? x : {};
    return {
      ag: int80(p.ag, BASE.ag), city: int80(p.city, BASE.city), env: int80(p.env, BASE.env),
      f: [0, 0.1, 0.2, 0.3].includes(p.f) ? p.f : 0,
      save: p.save === true, link: p.link === true, pulse: p.pulse === true,
      order: ORDERS.includes(p.order) ? p.order : "proportional"
    };
  }
  // 모형이 없을 때만 쓰는 최소 대체: 물 수지와 비례 감량만 계산한다.
  function fallbackSim(p, inflow) {
    const req = { ag: p.ag, city: p.city, env: p.env + (p.pulse ? 4 : 0) };
    const plan = req.ag + req.city + req.env;
    const rawEnd = 130 + inflow + (p.link ? 10 : 0) - 6 - plan;
    const shortage = Math.max(0, 40 - rawEnd);
    const sc = plan > 0 ? (plan - shortage) / plan : 1;
    const v = { ag: req.ag * sc, city: req.city * sc, env: req.env * sc };
    const Ve = v.env + 0.25 * v.ag + 0.3 * v.city;
    return {
      req, v, shortage, end: rawEnd + shortage, R: v.ag + v.city + v.env, Vc: v.city + v.env + 0.25 * v.ag, Ve,
      Qe: Ve * 1e6 / (90 * 86400), DO: null, supply: Math.min(1, v.city / (36 * (p.save ? 0.9 : 1))),
      ratioAg: Math.min(1, v.ag / Math.max(EPS, 55 * (1 - p.f))), pulseEffective: p.pulse && sc >= 1 - EPS
    };
  }
  let memo = { key: null, model: null, S: null };
  function readState(ctx) {
    const raw = ctx.game && typeof ctx.game === "object" ? ctx.game : {};
    let key = "";
    try { key = JSON.stringify(raw); } catch (e) { key = "?"; }
    const m = ctx.model && typeof ctx.model === "object" ? ctx.model : {};
    if (memo.key === key && memo.model === m && memo.S) return memo.S;
    let g = raw;
    // 저장값이 깨졌거나 일부만 있어도 게임과 같은 규칙으로 고친 사본을 읽는다(원본은 건드리지 않는다).
    if (typeof m.restore === "function") {
      try {
        const out = m.restore(raw);
        if (out && out.game && typeof out.game === "object") g = out.game;
      } catch (e) { g = raw; }
    }
    const p = planOf(g.proposal);
    const scen = own(SCEN, g.scenario) ? g.scenario : "normal";
    let r = null;
    if (typeof m.simulate === "function") {
      try { r = m.simulate(p, SCEN[scen].inflow); } catch (e) { r = null; }
    }
    if (!r || !r.v || typeof r.v !== "object") r = fallbackSim(p, SCEN[scen].inflow);
    const v = {
      ag: isNum(r.v.ag) ? Math.max(0, r.v.ag) : p.ag,
      city: isNum(r.v.city) ? Math.max(0, r.v.city) : p.city,
      env: isNum(r.v.env) ? Math.max(0, r.v.env) : p.env
    };
    const req = r.req && typeof r.req === "object" ? r.req : { ag: p.ag, city: p.city, env: p.env + (p.pulse ? 4 : 0) };
    const flow = {
      R: isNum(r.R) ? r.R : v.ag + v.city + v.env,
      s1: v.city + v.env,
      Vc: isNum(r.Vc) ? r.Vc : v.city + v.env + 0.25 * v.ag,
      s3: v.env + 0.25 * v.ag,
      Ve: isNum(r.Ve) ? r.Ve : v.env + 0.25 * v.ag + 0.3 * v.city,
      ag: v.ag, city: v.city, env: v.env, agRet: 0.25 * v.ag, cityRet: 0.3 * v.city,
      planAg: isNum(req.ag) ? req.ag : p.ag, planCity: isNum(req.city) ? req.city : p.city
    };
    const end = isNum(r.end) ? r.end : 130;
    const shortage = isNum(r.shortage) ? Math.max(0, r.shortage) : 0;
    const thrQ = r.pulseEffective ? 3 : 4;
    const hQ = isNum(r.Qe) ? clamp(r.Qe / (thrQ * 1.25), 0, 1) : 0;
    const hDO = isNum(r.DO) ? clamp((r.DO - 3) / 3, 0, 1) : hQ;
    const rounds = Array.isArray(g.rounds) ? g.rounds.filter(x => x && typeof x === "object") : [];
    const last = rounds.length ? rounds[rounds.length - 1] : null;
    const mode = g.mode === "auto" ? "auto" : "role";
    let statuses = null, draft = false;
    if (last) {
      if (mode === "role") {
        const hm = last.human && typeof last.human === "object" ? last.human : null;
        if (hm && PARTIES.every(k => hm[k] && isStatus(hm[k].status))) statuses = PARTIES.map(k => hm[k].status);
        else if (g.stage === "responses" && g.humanDraft && typeof g.humanDraft === "object") {
          // 역할극 반응을 기록하는 중이면 고른 반응을 미리 보여 준다(아직 기록 전).
          statuses = PARTIES.map(k => g.humanDraft[k] && isStatus(g.humanDraft[k].status) ? g.humanDraft[k].status : "none");
          draft = true;
        }
      } else if (typeof m.evaluate === "function") {
        try {
          const e = m.evaluate(planOf(last.proposal), Number.isInteger(last.mask) ? last.mask : 0);
          const list = e && e.normal && Array.isArray(e.normal.responses) ? e.normal.responses : null;
          if (list && list.length === 4 && list.every(isStatus)) statuses = list.slice();
        } catch (e) { statuses = null; }
      }
    }
    const d = last && last.decision && typeof last.decision === "object" ? last.decision : null;
    const locked = g.stage === "locked" && !!g.locked && typeof g.locked === "object";
    const fin = locked && g.locked.final && typeof g.locked.final === "object" ? g.locked.final : (g.final && typeof g.final === "object" ? g.final : {});
    const S = {
      key, p, scen, flow, end, shortage, mode,
      level: clamp((end - 40) / 194, 0, 1),
      health: Math.min(hQ, hDO),
      supply: isNum(r.supply) ? clamp(r.supply, 0, 1) : 1,
      ratioAg: isNum(r.ratioAg) ? clamp(r.ratioAg, 0, 1) : 1,
      pulseOK: !!r.pulseEffective,
      n: Math.min(4, rounds.length),
      statuses, draft,
      decision: d && PARTIES.includes(d.party) ? { party: d.party, action: d.action === "apply" ? "apply" : "reject" } : null,
      mask: Number.isInteger(g.mask) ? g.mask : 0,
      locked,
      finalMode: own(FINAL_KO, fin.mode) ? fin.mode : ""
    };
    memo = { key, model: m, S };
    return S;
  }

  /* ---------- 색 ---------- */
  function palette(scheme, scen) {
    const dark = scheme === "dark";
    // 어두운 화면: 등잔불 아래의 양피지처럼 한 톤 낮추고 따뜻하게 한다.
    const D = c => dark ? mix("#1c130a", c, 0.8) : c;
    const pick = (dry, normal, wet) => D(scen === "dry" ? dry : scen === "wet" ? wet : normal);
    return {
      dark, scen,
      parch: dark ? "#bc9f6e" : "#ecdab0",
      parch2: dark ? "#ccb281" : "#f6eacd",
      stain: dark ? "#8b6b3c" : "#c6a067",
      burn: dark ? "#160d05" : "#6b4519",
      ink: dark ? "#22150a" : "#3a2412",
      halo: dark ? "rgba(204,178,129,0.9)" : "rgba(246,234,205,0.9)",
      land: pick("#dcb46c", "#cbc58c", "#abc480"),
      land2: pick("#c18f4a", "#a9ad72", "#86ad66"),
      forest: pick("#8a8540", "#5d7d3b", "#3f7236"),
      forest2: pick("#5c5626", "#3d5a27", "#2a5226"),
      forest3: pick("#a69a52", "#7c9a4c", "#5a8f45"),
      water: pick("#7a9e98", "#4c86b5", "#3a77ba"),
      water2: pick("#a8c0b3", "#88b4d4", "#7cb2e2"),
      deep: pick("#5b8079", "#346d9c", "#2a5f9c"),
      sea: D("#86a8bc"), sea2: D("#5f88a3"),
      mud: pick("#c9a46c", "#bba57c", "#ab9d7e"),
      crack: D("#6b4a26"),
      stone: D("#c2b08b"), stone2: D("#8f7c5b"),
      rock: pick("#e3c89a", "#dfcda2", "#d9cfa8"), rock2: pick("#a8784a", "#9c8058", "#8a8160"),
      roof: D("#a9472f"), roof2: D("#7f3322"),
      wall: D("#f2e4c2"),
      crops: [pick("#c9bb5c", "#8fae4a", "#76ad48"), pick("#d6bf64", "#b4be57", "#9cc258"), pick("#dfb65a", "#d7b85c", "#c4c262")],
      straw: D("#d7c18b"), fallow: D("#c09c6a"),
      marsh: pick("#9c9a58", "#7d9b55", "#6c9d55"), marshDry: D("#b39a5e"),
      reed: pick("#6f6a2e", "#4f6b2c", "#3e6a2b"), reedDry: D("#8c7340")
    };
  }

  /* ---------- 배치 ---------- */
  let layoutMemo = { key: "", L: null };
  function getLayout(w, h, thumb) {
    const key = `${Math.round(w * 10)}x${Math.round(h * 10)}:${thumb ? 1 : 0}`;
    if (layoutMemo.key !== key) layoutMemo = { key, L: makeLayout(w, h, thumb) };
    return layoutMemo.L;
  }
  function makeLayout(w, h, thumb) {
    const kind = thumb ? "thumb" : w / h >= 3 ? "wide" : "compact";
    const wide = kind === "wide";
    const k = clamp(h / 200, 0.6, 1.3);
    const kw = wide ? clamp(h / 250, 0.55, 1) : clamp(h / 250, 0.5, 0.8);
    const titleR = thumb ? 0 : Math.min(w * 0.46, 212);
    const titleB = thumb ? 0 : 58;
    const chipT = thumb ? h : h - 44;
    const halfMax = kw * (1.2 + 0.12 * 244) / 2;
    const L = { w, h, kind, wide, thumb, k, kw, titleR, titleB, chipT, halfMax, sig: `${Math.round(w * 10)}x${Math.round(h * 10)}:${kind}` };
    const yR = wide || thumb ? h * 0.6 : clamp(lerp(titleB, chipT, 0.6), titleB + 14, h - 18);
    L.yR = yR;
    // 저수지와 댐
    const rx = wide ? Math.min(w * 0.066, h * 0.42) : w * 0.092;
    const ry = Math.min(wide ? h * 0.25 : h * 0.21, Math.max(8, (h - titleB - 12) / 2));
    const cx = rx + w * (wide ? 0.03 : 0.05);
    const cy = clamp(yR - h * 0.02, titleB + 4 + ry, h - 4 - ry);
    const damX = cx + rx * 0.9, dh = ry * 0.52;
    L.res = { cx, cy, rx, ry, damX, dh, full: blob(cx, cy, rx, ry, 48, 11, 0.16).map(([x, y]) => [Math.min(x, damX), y]) };
    // 들녘
    let fx0 = Math.max(damX + w * (wide ? 0.035 : 0.04), wide ? titleR + 6 : 0);
    let fx1 = wide ? fx0 + Math.min(w * 0.17, h * 1.5) : w * 0.47;
    let fy0 = wide ? h * 0.09 : thumb ? h * 0.1 : titleB + 4;
    const fy1 = yR - halfMax - (wide ? h * 0.07 : 4);
    let shortC = false;
    if (!wide && !thumb && fy1 - fy0 < 26) {
      // 낮은 장면(면접실·성찰의 휴대폰 화면): 제목 아래가 좁으면 들녘을 제목 오른쪽으로 옮긴다.
      shortC = true;
      fx0 = titleR + 10;
      fx1 = fx0 + w * 0.19;
      fy0 = 8;
    }
    L.shortC = shortC;
    // 도시
    const qx0 = fx1 + w * (wide ? 0.06 : shortC ? 0.025 : 0.05);
    const qx1 = qx0 + (wide ? Math.min(w * 0.14, h * 1.2) : w * (shortC ? 0.15 : 0.19));
    const qy0 = wide ? h * 0.07 : thumb ? h * 0.08 : (qx0 > titleR ? 8 : titleB + 4);
    const qy1 = yR - halfMax - (wide ? h * 0.05 : 4);
    // 해안선
    const coastX = w * (wide ? 0.865 : shortC ? 0.93 : 0.885);
    const amp1 = h * 0.04, amp2 = h * 0.02;
    const coastAt = y => coastX + amp1 * Math.sin(y * 0.043 + 1.1) + amp2 * Math.sin(y * 0.117 + 0.4);
    L.coastX = coastX;
    L.coastAt = coastAt;
    L.coast = [];
    for (let y = -6; y <= h + 6; y += 3) L.coast.push([coastAt(y), y]);
    // 강
    const yEnd = yR - h * 0.03, xEnd = coastAt(yEnd) + 1;
    const pts = [[damX + 1, cy]];
    const x0 = damX + w * (wide ? 0.025 : 0.045), x1 = xEnd - w * 0.05;
    const nSeg = wide ? 9 : 6;
    for (let i = 0; i <= nSeg; i++) {
      const u = i / nSeg;
      pts.push([lerp(x0, x1, u), yR + h * (wide ? 0.04 : 0.035) * Math.sin(u * Math.PI * (wide ? 4.2 : 3) + 0.5) * (1 - 0.6 * u)]);
    }
    pts.push([xEnd, yEnd]);
    const river = makePath(spline(pts, 10));
    L.river = river;
    const ex0 = Math.max(qx1 + w * 0.01, coastX - w * 0.15);
    L.nodes = {
      farmIn: fx0 + (fx1 - fx0) * 0.12,
      farmRet: fx1 + w * (wide ? 0.02 : 0.015),
      cityIn: qx0 + (qx1 - qx0) * 0.08,
      cityRet: qx1 + w * (wide ? 0.015 : 0.012),
      flare: ex0 + (xEnd - ex0) * 0.35
    };
    const rAt = x => river.pts[nearestX(river, x)];
    // 들녘 필지(5×2 = 10필지라 휴경 10%가 한 필지다)
    L.fields = { x0: fx0, y0: fy0, x1: fx1, y1: fy1, plots: makePlots(fx0, fy0, fx1, fy1, k) };
    const pIn = rAt(L.nodes.farmIn), cy1 = fy1 + 3 * k;
    L.canal = makePath(spline([[pIn[0], pIn[1]], [pIn[0] + 1.5 * k, lerp(pIn[1], cy1, 0.65)], [pIn[0] + 7 * k, cy1], [lerp(fx0, fx1, 0.55), cy1 + 0.4], [fx1 - (fx1 - fx0) * 0.05, cy1]], 6));
    const pRet = rAt(L.nodes.farmRet);
    L.agRet = makePath(spline([[fx1 - (fx1 - fx0) * 0.02, lerp(fy0, fy1, 0.8)], [lerp(fx1, pRet[0], 0.7), lerp(fy1, pRet[1], 0.35)], [pRet[0], pRet[1]]], 8));
    L.house = wide ? { x: fx1 - 9 * k, y: fy0 - 1 * k } : { x: fx0 - 3 * k, y: fy1 - 1 * k };
    // 도시
    const qcx = (qx0 + qx1) / 2, qcy = (qy0 + qy1) / 2, qrx = (qx1 - qx0) / 2, qry = (qy1 - qy0) / 2;
    const wall = blob(qcx, qcy, qrx * 0.9, qry * 0.88, 10, 5, 0.06);
    const inner = blob(qcx, qcy, qrx * 0.76, qry * 0.72, 10, 5, 0.06);
    const pC = rAt(L.nodes.cityIn);
    const aqEnd = [qcx - qrx * 0.42, qcy + qry * 0.38];
    L.aq = makePath(spline([[pC[0], pC[1]], [pC[0] + 1, lerp(pC[1], qy1, 0.55)], [lerp(pC[0], aqEnd[0], 0.6), qy1 - qry * 0.05], aqEnd], 8));
    const pCR = rAt(L.nodes.cityRet);
    L.cityRet = makePath(spline([[qx1 - qrx * 0.3, qcy + qry * 0.55], [lerp(qx1, pCR[0], 0.6), lerp(qy1, pCR[1], 0.4)], [pCR[0], pCR[1]]], 8));
    const keep = { x: qcx + qrx * 0.1, y: qcy - qry * 0.05 };
    const houses = [];
    const hr = rng(77), cell = 7.4 * k;
    for (let y = qy0 + cell * 0.6; y < qy1 - cell * 0.3; y += cell * 0.82) {
      for (let x = qx0 + cell * 0.5; x < qx1 - cell * 0.3; x += cell) {
        const hx = x + (hr() - 0.5) * cell * 0.35, hy = y + (hr() - 0.5) * cell * 0.25;
        if (!inPoly(inner, hx, hy)) continue;
        if (Math.hypot((hx - keep.x) / 1.2, hy - keep.y) < 8.5 * k) continue;
        if (Math.hypot(hx - aqEnd[0], hy - aqEnd[1]) < 7 * k) continue;
        houses.push({ x: hx, y: hy, s: (0.85 + hr() * 0.35) * k, v: hr() });
      }
    }
    houses.sort((a, b) => a.y - b.y);
    L.city = { x0: qx0, y0: qy0, x1: qx1, y1: qy1, cx: qcx, cy: qcy, rx: qrx, ry: qry, wall, keep, houses, cistern: { x: aqEnd[0], y: aqEnd[1], r: 4.4 * k } };
    // 하구
    const iFl = nearestX(river, L.nodes.flare), pF = river.pts[iFl];
    const mcx = lerp(ex0, xEnd, 0.6), mcy = yEnd + h * 0.015, mrx = (xEnd - ex0) * 0.6, mry = h * (wide ? 0.24 : 0.25);
    L.est = {
      x0: ex0, x1: xEnd, y: yEnd, i: iFl, mcx, mcy, mrx, mry,
      marsh: blob(mcx, mcy, mrx, mry, 34, 21, 0.13),
      channels: [-1, 1].map(sg => makePath(spline([[pF[0], pF[1]], [lerp(pF[0], xEnd, 0.5), pF[1] + sg * h * 0.06], [coastAt(yEnd + sg * h * 0.15) + 2, yEnd + sg * h * 0.15]], 8))),
      hut: { x: lerp(ex0, xEnd, 0.42), y: yEnd - h * (wide ? 0.15 : 0.16) }
    };
    // 상류 유입과 이웃 댐 연계 이송 수로(왼쪽 가장자리에서 들어온다)
    const inY = cy - ry * 0.4;
    L.inflow = makePath(spline([[-6, inY - h * 0.05], [cx - rx * 1.08, inY - h * 0.012], [cx - rx * 0.55, inY + ry * 0.12]], 8));
    const lkY = cy + ry * 0.55;
    L.link = makePath(spline([[-6, lkY + h * 0.09], [cx - rx * 1.02, lkY + h * 0.02], [cx - rx * 0.6, lkY - ry * 0.05]], 8));
    // 깃발 자리
    L.flags = [
      wide || shortC ? { x: damX + 2 * k, y: cy - dh - 1.5 * k } : { x: damX + 3 * k, y: cy + dh + 1.5 * k },
      { x: L.house.x + 4 * k, y: L.house.y + 1 * k },
      { x: keep.x, y: keep.y - 3.5 * k },
      { x: L.est.hut.x + 5 * k, y: L.est.hut.y + 1 * k }
    ];
    // 외교 창·라운드 명판·나침반·인장·날씨 기호
    const rowH = h >= 220 ? 19 : 16;
    L.panel = wide && w >= 760 ? { x: w - 214, y: 10, w: 204, h: 28 + rowH * 4 + 8, rowH } : null;
    L.plaque = !wide && !thumb ? { x: w - 54, y: 8, w: 46, h: 34 } : null;
    L.compass = wide && h >= 220 ? { x: w - 66, y: h - 70, r: 34 } : null;
    L.seal = wide ? (h >= 220 ? { x: w - 150, y: h - 86, r: 34 } : { x: (qx1 + ex0) / 2, y: h * 0.5, r: Math.min(36, h * 0.2) })
      : thumb ? { x: w - 34, y: h * 0.62, r: 18 } : shortC ? { x: w - 30, y: h - 30, r: 16 } : { x: w - 44, y: clamp(h * 0.56, 60, h - 26), r: 21 };
    L.weather = wide ? { x: (fx1 + qx0) / 2, y: 12 + 8 * k } : null;
    // 사수위 감량 표식: 넓은 화면은 댐 남쪽 끝 아래, 좁은 화면은 저수지 바닥 위
    L.cutMark = wide && h >= 220 ? { x: damX + 4 * k, y: cy + dh + 12 * k } : { x: cx - rx * 0.25, y: cy - ry * 0.45 };
    L.free = makeFree(L);
    return L;
  }
  function makePlots(x0, y0, x1, y1, k) {
    const cols = 5, rows = 2, r = rng(303), grid = [];
    const jx = (x1 - x0) / cols * 0.14, jy = (y1 - y0) / rows * 0.12;
    for (let j = 0; j <= rows; j++) {
      grid.push([]);
      for (let i = 0; i <= cols; i++) {
        const edgeX = i === 0 || i === cols, edgeY = j === 0 || j === rows;
        grid[j].push([lerp(x0, x1, i / cols) + (edgeX ? 0 : (r() - 0.5) * 2 * jx), lerp(y0, y1, j / rows) + (edgeY ? (r() - 0.5) * jy : (r() - 0.5) * 2 * jy)]);
      }
    }
    const gap = Math.max(1, 1.3 * k), plots = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
        const mx = q.reduce((s, p) => s + p[0], 0) / 4, my = q.reduce((s, p) => s + p[1], 0) / 4;
        const poly = q.map(([x, y]) => {
          const dx = mx - x, dy = my - y, l = Math.hypot(dx, dy) || 1;
          return [x + dx / l * gap, y + dy / l * gap];
        });
        // 수로(왼쪽 아래)에서 먼 필지부터 휴경·물 부족을 맡긴다.
        plots.push({ poly, mx, my, dist: Math.hypot(mx - x0, (my - y1) * 1.6), ang: r() < 0.5 ? 0 : 1, crop: (i + j * 2) % 3 });
      }
    }
    plots.slice().sort((a, b) => b.dist - a.dist).forEach((p, idx) => { p.rank = idx; });
    return plots;
  }
  function makeFree(L) {
    const k = L.k, pad = 3 * k, rects = [];
    const F = L.fields, C = L.city;
    rects.push([F.x0 - pad, F.y0 - pad - 6 * k, F.x1 + pad, F.y1 + pad + 5 * k]);
    rects.push([C.x0 - pad, C.y0 - pad, C.x1 + pad, C.y1 + pad]);
    if (L.panel) rects.push([L.panel.x - 6, L.panel.y - 6, L.panel.x + L.panel.w + 6, L.panel.y + L.panel.h + 6]);
    if (L.plaque) rects.push([L.plaque.x - 4, L.plaque.y - 4, L.plaque.x + L.plaque.w + 4, L.plaque.y + L.plaque.h + 4]);
    if (L.compass) rects.push([L.compass.x - L.compass.r - 6, L.compass.y - L.compass.r - 14, L.compass.x + L.compass.r + 6, L.compass.y + L.compass.r + 6]);
    if (L.weather) rects.push([L.weather.x - 16 * k, L.weather.y - 14 * k, L.weather.x + 30 * k, L.weather.y + 30 * k]);
    L.flags.forEach(f => rects.push([f.x - 8 * k, f.y - 24 * k, f.x + 18 * k, f.y + 4 * k]));
    const R = L.res, E = L.est;
    const corridors = [
      [L.river.pts.filter((_, i) => i % 2 === 0), L.halfMax + 5 * k],
      [L.canal.pts, 6 * k], [L.agRet.pts, 3 * k], [L.aq.pts, 6 * k], [L.cityRet.pts, 3 * k],
      [L.inflow.pts, 6 * k], [L.link.pts, 6 * k]
    ];
    return (x, y, rad) => {
      rad = rad || 0;
      if (x < 2 || x > L.w - 2 || y < 4 || y > L.h - 2) return false;
      if (x + rad > L.coastAt(y) - 4 * k) return false;
      for (const q of rects) if (x + rad > q[0] && x - rad < q[2] && y + rad > q[1] && y - rad < q[3]) return false;
      const ex = (x - R.cx) / (R.rx + 7 + rad), ey = (y - R.cy) / (R.ry + 7 + rad);
      if (ex * ex + ey * ey < 1) return false;
      const mx = (x - E.mcx) / (E.mrx + 4 + rad), my = (y - E.mcy) / (E.mry + 4 + rad);
      if (mx * mx + my * my < 1) return false;
      for (const [pts, lim0] of corridors) {
        const lim = lim0 + rad;
        for (const p of pts) {
          const dx = p[0] - x, dy = p[1] - y;
          if (dx * dx + dy * dy < lim * lim) return false;
        }
      }
      return true;
    };
  }

  /* ---------- 양피지와 지형(캐시 1층) ---------- */
  let NOISE = null;
  function noiseTile() {
    if (NOISE) return NOISE;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const img = g.createImageData(128, 128), d = img.data, r = rng(91);
    for (let i = 0; i < d.length; i += 4) {
      if (r() < 0.55) { d[i] = 96; d[i + 1] = 64; d[i + 2] = 30; d[i + 3] = (r() * 34) | 0; }
      else { d[i] = 255; d[i + 1] = 250; d[i + 2] = 234; d[i + 3] = (r() * 30) | 0; }
    }
    g.putImageData(img, 0, 0);
    NOISE = c;
    return c;
  }
  function drawParchment(g, L, pal) {
    const { w, h } = L, r = rng(5);
    g.fillStyle = pal.parch;
    g.fillRect(0, 0, w, h);
    // 얼룩과 밝은 결
    for (let i = 0; i < 12; i++) {
      const x = r() * w, y = r() * h, rad = (0.25 + r() * 0.5) * Math.min(w, h * 2.2) * 0.5;
      const light = i % 3 !== 0;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(light ? pal.parch2 : pal.stain, light ? 0.5 : 0.16));
      gr.addColorStop(1, rgba(light ? pal.parch2 : pal.stain, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const pat = g.createPattern(noiseTile(), "repeat");
    if (pat) {
      g.fillStyle = pat;
      g.fillRect(0, 0, w, h);
    }
    // 섬유 결
    g.lineWidth = 0.6;
    for (let i = 0; i < Math.round(w * h / 1800); i++) {
      const x = r() * w, y = r() * h, len = 6 + r() * 18, a = (r() - 0.5) * 0.6;
      g.strokeStyle = rgba(r() < 0.5 ? pal.stain : pal.parch2, 0.22);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 2, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // 접힌 자국
    if (!L.thumb) {
      [1 / 3, 2 / 3].forEach(fx => {
        const x = Math.round(w * fx) + 0.5;
        const gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
        gr.addColorStop(0, rgba(pal.burn, 0));
        gr.addColorStop(0.45, rgba(pal.burn, 0.07));
        gr.addColorStop(0.55, rgba(pal.parch2, 0.25));
        gr.addColorStop(1, rgba(pal.parch2, 0));
        g.fillStyle = gr;
        g.fillRect(x - 6, 0, 12, h);
      });
    }
  }
  function edgeBurn(g, L, pal) {
    const { w, h } = L, a = pal.dark ? 0.62 : 0.4, sz = Math.min(46, h * 0.22);
    const sides = [[0, 0, sz, h, 0, 0, sz, 0], [w - sz, 0, sz, h, w, 0, w - sz, 0], [0, 0, w, sz, 0, 0, 0, sz], [0, h - sz, w, sz, 0, h, 0, h - sz]];
    sides.forEach(([x, y, ww, hh, ax, ay, bx, by]) => {
      const gr = g.createLinearGradient(ax, ay, bx, by);
      gr.addColorStop(0, rgba(pal.burn, a));
      gr.addColorStop(1, rgba(pal.burn, 0));
      g.fillStyle = gr;
      g.fillRect(x, y, ww, hh);
    });
  }
  function drawSea(g, L, pal) {
    const { w, h, k } = L;
    g.save();
    g.beginPath();
    g.moveTo(L.coast[0][0], L.coast[0][1]);
    L.coast.forEach(p => g.lineTo(p[0], p[1]));
    g.lineTo(w + 8, h + 8);
    g.lineTo(w + 8, -8);
    g.closePath();
    const gr = g.createLinearGradient(L.coastX - 20, 0, w, 0);
    gr.addColorStop(0, rgba(pal.sea, 0.95));
    gr.addColorStop(1, rgba(pal.sea2, 0.95));
    g.fillStyle = gr;
    g.fill();
    g.clip();
    // 바다 결(옛 지도의 물결 무늬)
    const r = rng(17);
    g.strokeStyle = rgba(pal.ink, 0.28);
    g.lineWidth = 0.8;
    for (let i = 0; i < Math.round((w - L.coastX) * h / 900); i++) {
      const x = L.coastX + r() * (w - L.coastX + 10), y = r() * h, s = (2.5 + r() * 2) * k;
      g.beginPath();
      g.moveTo(x - s, y);
      g.quadraticCurveTo(x - s / 2, y - s * 0.55, x, y);
      g.quadraticCurveTo(x + s / 2, y - s * 0.55, x + s, y);
      g.stroke();
    }
    g.restore();
    // 해안선과 해안 평행선
    for (let j = 3; j >= 1; j--) {
      g.strokeStyle = rgba(pal.ink, 0.12 + 0.08 * (3 - j));
      g.lineWidth = 0.8;
      g.beginPath();
      L.coast.forEach((p, i) => { const x = p[0] + j * 4 * k; if (i) g.lineTo(x, p[1]); else g.moveTo(x, p[1]); });
      g.stroke();
    }
    g.strokeStyle = rgba(pal.ink, 0.9);
    g.lineWidth = 1.3;
    trace(g, L.coast, false);
    g.stroke();
  }
  function mountain(g, x, y, s, pal, jit) {
    const px = x + jit * s * 0.3, py = y - s, lx = x - s * 1.05, rx = x + s * 1.05;
    const outline = () => {
      g.beginPath();
      g.moveTo(lx, y);
      g.quadraticCurveTo(lerp(lx, px, 0.45) - s * 0.08, lerp(y, py, 0.62), px, py);
      g.quadraticCurveTo(lerp(px, rx, 0.55) + s * 0.08, lerp(py, y, 0.38), rx, y);
    };
    // 햇빛 받는 면: 옅은 황토
    outline();
    g.closePath();
    g.fillStyle = pal.rock;
    g.fill();
    // 그늘 면: 짙은 흙빛과 잉크 빗금
    g.beginPath();
    g.moveTo(px, py);
    g.quadraticCurveTo(lerp(px, rx, 0.55) + s * 0.08, lerp(py, y, 0.38), rx, y);
    g.lineTo(px + s * 0.18, y);
    g.quadraticCurveTo(px + s * 0.02, lerp(py, y, 0.5), px, py);
    g.closePath();
    g.fillStyle = pal.rock2;
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.55);
    g.lineWidth = 0.75;
    for (let i = 1; i < 9; i++) {
      const t = i / 9, ax = lerp(px, rx, t) - s * 0.04, ay = lerp(py, y, t) + s * 0.04;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax - s * 0.2 * (1 - t * 0.3), ay + s * 0.3 * (1 - t * 0.55));
      g.stroke();
    }
    // 능선의 작은 주름
    g.strokeStyle = rgba(pal.ink, 0.45);
    g.beginPath();
    g.moveTo(px - s * 0.05, py + s * 0.25);
    g.quadraticCurveTo(px - s * 0.28, py + s * 0.5, px - s * 0.42, py + s * 0.78);
    g.stroke();
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 1.25;
    outline();
    g.stroke();
  }
  function cracks(g, list, pal) {
    // 건조 전망: 갈라진 땅(다각형 균열) 무늬
    g.strokeStyle = rgba(pal.crack, 0.42);
    g.lineWidth = 0.7;
    list.forEach(line => {
      trace(g, line, false);
      g.stroke();
    });
  }
  function tufts(g, list, pal) {
    // 빈 풀밭의 잉크 풀 표시
    g.strokeStyle = rgba(pal.forest2, 0.45);
    g.lineWidth = 0.7;
    g.beginPath();
    list.forEach(([x, y, s]) => {
      g.moveTo(x - s, y);
      g.lineTo(x - s * 1.3, y - s);
      g.moveTo(x, y);
      g.lineTo(x, y - s * 1.4);
      g.moveTo(x + s, y);
      g.lineTo(x + s * 1.3, y - s);
    });
    g.stroke();
  }
  function hill(g, x, y, s, pal) {
    g.beginPath();
    g.moveTo(x - s, y);
    g.quadraticCurveTo(x, y - s * 0.95, x + s, y);
    g.fillStyle = rgba(pal.land2, 0.32);
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.78);
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = rgba(pal.ink, 0.38);
    g.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      const t = 0.55 + i * 0.1, hx = lerp(x - s, x + s, t), hy = y - Math.sin(t * Math.PI) * s * 0.45;
      g.beginPath();
      g.moveTo(hx, hy + 1);
      g.lineTo(hx - s * 0.08, hy + s * 0.32);
      g.stroke();
    }
  }
  function tree(g, x, y, s, pal, conifer, pickV) {
    const col = pickV < 0.5 ? pal.forest : pickV < 0.75 ? pal.forest3 : pal.forest2;
    if (conifer) {
      g.beginPath();
      g.moveTo(x, y - s * 2);
      g.lineTo(x + s * 0.72, y - s * 0.15);
      g.lineTo(x - s * 0.72, y - s * 0.15);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      g.strokeStyle = rgba(pal.ink, 0.88);
      g.lineWidth = 0.8;
      g.stroke();
      g.beginPath();
      g.moveTo(x, y - s * 0.15);
      g.lineTo(x, y + s * 0.15);
      g.stroke();
      return;
    }
    g.beginPath();
    g.arc(x, y - s * 1.05, s * 0.68, 0, TAU);
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.85);
    g.lineWidth = 0.8;
    g.stroke();
    g.beginPath();
    g.arc(x + s * 0.12, y - s * 0.95, s * 0.48, -0.2, 1.9);
    g.strokeStyle = rgba(pal.forest2, 0.75);
    g.lineWidth = Math.max(0.8, s * 0.2);
    g.stroke();
    g.beginPath();
    g.arc(x - s * 0.22, y - s * 1.25, s * 0.18, 0, TAU);
    g.fillStyle = rgba(pal.parch2, 0.35);
    g.fill();
  }
  // 지형 배치(산·언덕·숲·풀·균열)는 크기마다 한 번만 정해 둔다. 전망·화면 색이 바뀌면 다시 칠하기만 한다.
  function planTerrain(L) {
    if (L.plan) return L.plan;
    const { w, h, k } = L, r = rng(42), free = L.free, res = L.res;
    const washes = [];
    for (let i = 0; i < 9; i++) washes.push([r() * w, r() * h, (0.12 + r() * 0.2) * Math.min(w, h * 2.5)]);
    // 산맥: 왼쪽 위 상류 고지(제목 명판 뒤로 이어진다), 넓은 화면은 들녘과 도시 사이 능선도
    const mts = [], nM = L.wide ? 8 : 5;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < nM; i++) {
        const x = lerp(-6, res.damX + 4 * k, (i + row * 0.5) / (nM - 1)) + (r() - 0.5) * 8 * k;
        const base = res.cy - res.ry - 2 * k - r() * 4 * k - row * (L.wide ? 13 : 8) * k;
        const s = (L.wide ? 17 + r() * 13 : 9 + r() * 7) * k * (row ? 0.85 : 0.8), jit = r() - 0.5;
        if (base - s * 0.3 > 4) mts.push([x, base, s, jit]);
      }
    }
    if (L.wide) {
      const a = L.fields.x1 + 6 * k, b = L.city.x0 - 6 * k;
      for (let i = 0; i < 5 && b - a > 30 * k; i++) {
        const x = lerp(a + 10 * k, b - 10 * k, i / 4) + (r() - 0.5) * 6 * k, base = L.yR - L.halfMax - h * (0.1 + r() * 0.14), s = (12 + r() * 10) * k, jit = r() - 0.5;
        if (base - s > 4) mts.push([x, base, s, jit]);
      }
    }
    mts.sort((a, b) => a[1] - b[1]);
    // 남쪽 언덕
    const hills = [];
    for (let i = 0; i < (L.wide ? 80 : 30) && hills.length < (L.wide ? 12 : 5); i++) {
      const x = r() * w, y = L.yR + L.halfMax + (r() * 0.9 + 0.1) * (h - L.yR - L.halfMax), s = (7 + r() * 8) * k;
      if (free(x, y - s * 0.4, s * 0.8) && !hills.some(q => Math.abs(q[0] - x) < s * 2 && Math.abs(q[1] - y) < s)) hills.push([x, y, s]);
    }
    hills.sort((a, b) => a[1] - b[1]);
    // 숲: 덩어리 중심을 고르고 그 안에 나무를 촘촘히 심는다.
    const ts = (L.wide ? 4.3 : 3.5) * k, clusters = [], want = L.thumb ? 6 : L.wide ? 14 : 7;
    for (let c = 0; c < 400 && clusters.length < want; c++) {
      const cx = r() * w, cy = r() * h, spread = (L.wide ? 14 + r() * 18 : 9 + r() * 10) * k;
      if (!free(cx, cy, spread * 0.45) || clusters.some(q => Math.hypot(q[0] - cx, (q[1] - cy) * 1.6) < (q[2] + spread) * 1.1)) continue;
      clusters.push([cx, cy, spread]);
    }
    const forests = [], trees = [];
    clusters.forEach(([cx, cy, spread]) => {
      const pts = [];
      for (let y = cy - spread * 0.8; y <= cy + spread * 0.8; y += ts * 0.95) {
        for (let x = cx - spread * 1.5; x <= cx + spread * 1.5; x += ts * 1.25) {
          const jx = x + (r() - 0.5) * ts * 0.7, jy = y + (r() - 0.5) * ts * 0.5;
          const e = ((jx - cx) / (spread * 1.5)) ** 2 + ((jy - cy) / (spread * 0.8)) ** 2;
          if (e < 1 - r() * 0.25 && free(jx, jy, ts * 0.5)) pts.push([jx, jy, ts * (0.85 + r() * 0.35), r() < 0.3, r()]);
        }
      }
      if (pts.length < 3) return;
      forests.push(pts);
      trees.push(...pts);
    });
    for (let i = 0; i < (L.wide ? 26 : 8); i++) {
      const x = r() * w, y = r() * h;
      if (free(x, y, ts)) trees.push([x, y, ts * (0.8 + r() * 0.3), r() < 0.3, r()]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    // 풀 표시와 균열은 따로 씨앗을 쓴다.
    const tr = rng(63), tuftList = [];
    for (let i = 0, n = Math.round(w * h / (L.wide ? 1500 : 1300)); i < n; i++) {
      const x = tr() * w, y = tr() * h, s = (1.6 + tr() * 1.4) * k;
      if (free(x, y, 2)) tuftList.push([x, y, s]);
    }
    const cr = rng(64), crackList = [];
    for (let i = 0, n = Math.round(w * h / (L.wide ? 9000 : 7000)); i < n; i++) {
      const cx = cr() * w, cy = cr() * h, s = (5 + cr() * 5) * k;
      if (!free(cx, cy, s)) continue;
      for (let j = 0; j < 5; j++) {
        let x = cx, y = cy;
        const a0 = j / 5 * TAU + cr() * 0.6, line = [[x, y]];
        for (let q = 0; q < 3; q++) {
          x += Math.cos(a0 + (cr() - 0.5) * 0.9) * s * 0.4;
          y += Math.sin(a0 + (cr() - 0.5) * 0.9) * s * 0.28;
          line.push([x, y]);
        }
        crackList.push(line);
      }
    }
    L.plan = { washes, mts, hills, forests, trees, tufts: tuftList, cracks: crackList };
    return L.plan;
  }
  function drawTerrain(g, L, pal, parchDone) {
    const { h } = L, plan = planTerrain(L);
    if (!parchDone) drawParchment(g, L, pal);
    // 채색한 땅(강가는 푸르게, 먼 곳은 옅게)
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = rgba(pal.land, 0.4);
    g.lineWidth = Math.min(h * 0.5, 150);
    trace(g, L.river.pts, false);
    g.stroke();
    g.strokeStyle = rgba(pal.land, 0.3);
    g.lineWidth = Math.min(h * 0.24, 70);
    g.stroke();
    plan.washes.forEach(([x, y, rad], i) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(i % 2 ? pal.land : pal.land2, 0.22));
      gr.addColorStop(1, rgba(pal.land, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
    g.restore();
    drawSea(g, L, pal);
    plan.mts.forEach(([x, y, s, jit]) => mountain(g, x, y, s, pal, jit));
    if (pal.scen === "dry") cracks(g, plan.cracks, pal);
    else tufts(g, plan.tufts, pal);
    plan.hills.forEach(([x, y, s]) => hill(g, x, y, s, pal));
    // 숲 바닥(물감 번짐)
    g.save();
    g.fillStyle = rgba(pal.forest2, 0.16);
    plan.forests.forEach(pts => {
      g.beginPath();
      pts.forEach(([x, y, s]) => { g.moveTo(x + s * 1.3, y - s * 0.6); g.arc(x, y - s * 0.6, s * 1.3, 0, TAU); });
      g.fill();
    });
    g.restore();
    // 나무 그림자와 줄기는 한 번에, 수관은 뒤에서 앞으로 하나씩 칠한다.
    g.fillStyle = rgba(pal.ink, 0.16);
    g.beginPath();
    plan.trees.forEach(([x, y, s]) => { g.moveTo(x + s * 1.2, y + s * 0.05); g.ellipse(x + s * 0.45, y + s * 0.05, s * 0.75, s * 0.26, 0, 0, TAU); });
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.85);
    g.lineWidth = 0.9;
    g.beginPath();
    plan.trees.forEach(([x, y, s, conifer]) => { if (!conifer) { g.moveTo(x, y + s * 0.1); g.lineTo(x, y - s * 0.6); } });
    g.stroke();
    plan.trees.forEach(([x, y, s, conifer, v]) => tree(g, x, y, s, pal, conifer, v));
    if (L.compass) compass(g, L.compass, pal);
  }
  // 옛 지도의 눈금 테두리
  function neatline(g, L, pal) {
    const { w, h } = L, o = 5.5, i2 = 9;
    g.save();
    g.strokeStyle = rgba(pal.ink, 0.85);
    g.lineWidth = 1;
    g.strokeRect(o, o, w - 2 * o, h - 2 * o);
    g.lineWidth = 0.8;
    g.strokeRect(i2, i2, w - 2 * i2, h - 2 * i2);
    g.fillStyle = rgba(pal.ink, 0.8);
    const seg = 22;
    for (let x = i2, j = 0; x < w - i2; x += seg, j++) {
      if (j % 2) continue;
      g.fillRect(x, o + 0.5, Math.min(seg, w - i2 - x), i2 - o - 1);
      g.fillRect(x, h - i2 + 0.5, Math.min(seg, w - i2 - x), i2 - o - 1);
    }
    for (let y = i2, j = 0; y < h - i2; y += seg, j++) {
      if (j % 2) continue;
      g.fillRect(o + 0.5, y, i2 - o - 1, Math.min(seg, h - i2 - y));
      g.fillRect(w - i2 + 0.5, y, i2 - o - 1, Math.min(seg, h - i2 - y));
    }
    g.restore();
  }
  function compass(g, c, pal) {
    g.save();
    g.translate(c.x, c.y);
    g.strokeStyle = rgba(pal.ink, 0.8);
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(0, 0, c.r * 0.62, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, c.r * 0.55, 0, TAU);
    g.stroke();
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      g.beginPath();
      g.moveTo(Math.cos(a) * c.r * 0.55, Math.sin(a) * c.r * 0.55);
      g.lineTo(Math.cos(a) * c.r * 0.62, Math.sin(a) * c.r * 0.62);
      g.stroke();
    }
    for (let i = 7; i >= 0; i--) {
      const a = i * Math.PI / 4 - Math.PI / 2, len = i % 2 ? c.r * 0.58 : c.r, wd = i % 2 ? c.r * 0.1 : c.r * 0.15;
      const tip = [Math.cos(a) * len, Math.sin(a) * len];
      const sl = [Math.cos(a - Math.PI / 2) * wd, Math.sin(a - Math.PI / 2) * wd];
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(sl[0], sl[1]);
      g.lineTo(tip[0], tip[1]);
      g.closePath();
      g.fillStyle = i % 2 ? pal.parch2 : GOLD;
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-sl[0], -sl[1]);
      g.lineTo(tip[0], tip[1]);
      g.closePath();
      g.fillStyle = rgba(pal.ink, 0.85);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, c.r * 0.08, 0, TAU);
    g.fillStyle = GOLD;
    g.fill();
    g.stroke();
    text(g, "N", 0, -c.r - 7, `800 12px ${SERIF}`, pal.ink, pal.halo);
    g.restore();
  }

  /* ---------- 배분 상태(캐시 2층) ---------- */
  function widthOf(L, vol) { return L.kw * (1.2 + 0.12 * Math.max(0, vol)); }
  function riverWidths(L, S) {
    const f = S.flow, N = L.nodes;
    const vols = [f.R, f.s1, f.Vc, f.s3, f.Ve], marks = [N.farmIn, N.farmRet, N.cityIn, N.cityRet];
    const sm = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
    const span = 7 * L.k, ex0 = N.flare, ex1 = L.est.x1;
    return L.river.pts.map(([x]) => {
      let vol = vols[0];
      marks.forEach((m, j) => { vol += (vols[j + 1] - vols[j]) * sm((x - m + span) / (2 * span)); });
      let wd = widthOf(L, vol);
      if (x > ex0) wd *= 1 + 1.3 * Math.pow(clamp((x - ex0) / Math.max(1, ex1 - ex0), 0, 1), 1.6);
      return wd;
    });
  }
  function widthsFor(L, S) {
    if (L.wKey !== S.key || !L.widths) {
      L.widths = riverWidths(L, S);
      L.wKey = S.key;
    }
    return L.widths;
  }
  function drawWater(g, L, P, widthAt, pal, opts) {
    const o = opts || {};
    const rb = ribbon(P, widthAt, o.wob);
    fillRibbon(g, rb);
    g.fillStyle = o.fill || pal.water;
    g.fill();
    // 가운데 밝은 물빛
    g.save();
    g.clip();
    g.strokeStyle = rgba(pal.water2, 0.55);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = Math.max(0.8, widthAt(Math.floor(P.pts.length / 2)) * 0.35);
    trace(g, P.pts, false);
    g.stroke();
    g.restore();
    // 잉크 강둑
    g.strokeStyle = rgba(pal.ink, o.inkA || 0.85);
    g.lineWidth = o.inkW || 1.1;
    g.lineJoin = "round";
    trace(g, rb.left, false);
    g.stroke();
    trace(g, rb.right, false);
    g.stroke();
    return rb;
  }
  function bankHatch(g, rb, pal, k, step) {
    // 옛 지도처럼 그늘진 둑에 짧은 빗금을 넣는다.
    g.strokeStyle = rgba(pal.ink, 0.32);
    g.lineWidth = 0.7;
    const side = rb.left;
    g.beginPath();
    for (let i = 2; i < side.length - 2; i += step) {
      const a = side[i - 1], b = side[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      g.moveTo(side[i][0] + nx * 1.2, side[i][1] + ny * 1.2);
      g.lineTo(side[i][0] + nx * 3.8 * k, side[i][1] + ny * 3.8 * k);
    }
    g.stroke();
  }
  function drawReservoir(g, L, S, pal) {
    const R = L.res, k = L.k;
    const scale = lv => 0.25 + 0.75 * Math.pow(clamp(lv, 0, 1), 0.6);
    const shape = lv => {
      const sc = scale(lv);
      return R.full.map(([x, y]) => [R.damX + (x - R.damX) * sc, R.cy + (y - R.cy) * (0.42 + 0.58 * sc)]);
    };
    // 드러난 바닥(만수 윤곽)
    trace(g, R.full, true);
    g.fillStyle = rgba(pal.mud, 0.75);
    g.fill();
    g.save();
    trace(g, R.full, true);
    g.clip();
    // 마른 바닥 갈라짐: 건조할수록 진하게
    const cr = rng(9), crackA = S.scen === "dry" ? 0.75 : S.level < 0.25 ? 0.5 : 0.3;
    g.strokeStyle = rgba(pal.crack, crackA);
    g.lineWidth = 0.7;
    g.beginPath();
    for (let i = 0; i < 26; i++) {
      let x = R.cx + (cr() - 0.5) * R.rx * 2, y = R.cy + (cr() - 0.5) * R.ry * 2;
      g.moveTo(x, y);
      for (let j = 0; j < 3; j++) {
        x += (cr() - 0.5) * 9 * k;
        y += (cr() - 0.5) * 7 * k;
        g.lineTo(x, y);
      }
    }
    g.stroke();
    g.restore();
    // 지금 수위의 물
    const water = shape(S.level);
    trace(g, water, true);
    const gr = g.createLinearGradient(R.cx - R.rx, 0, R.damX, 0);
    gr.addColorStop(0, pal.water2);
    gr.addColorStop(0.55, pal.water);
    gr.addColorStop(1, pal.deep);
    g.fillStyle = gr;
    g.fill();
    // 수면 결
    g.save();
    g.clip();
    g.strokeStyle = rgba("#ffffff", pal.dark ? 0.22 : 0.35);
    g.lineWidth = 0.8;
    const wr = rng(31);
    for (let i = 0; i < 14; i++) {
      const x = R.cx + (wr() - 0.5) * R.rx * 1.6, y = R.cy + (wr() - 0.5) * R.ry * 1.4, s = (3 + wr() * 4) * k;
      g.beginPath();
      g.moveTo(x - s, y);
      g.quadraticCurveTo(x, y - s * 0.4, x + s, y);
      g.stroke();
    }
    g.restore();
    trace(g, water, true);
    g.strokeStyle = rgba(pal.ink, 0.85);
    g.lineWidth = 1.1;
    g.stroke();
    // 출발 수위(130) 점선과 만수 윤곽 점선
    trace(g, shape((130 - 40) / 194), true);
    g.setLineDash([1.5, 3]);
    g.strokeStyle = rgba(pal.ink, 0.5);
    g.lineWidth = 0.9;
    g.stroke();
    trace(g, R.full, true);
    g.setLineDash([4, 3]);
    g.strokeStyle = rgba(pal.ink, 0.55);
    g.stroke();
    g.setLineDash([]);
    // 사수위에 닿으면 붉은 경고 고리
    if (S.shortage > EPS || S.end <= 40 + 1e-6) {
      trace(g, shape(0), true);
      g.setLineDash([3, 2]);
      g.strokeStyle = "#b3302a";
      g.lineWidth = 1.4;
      g.stroke();
      g.setLineDash([]);
    }
  }
  function drawDam(g, L, pal) {
    const R = L.res, k = L.k, x = R.damX, y0 = R.cy - R.dh, y1 = R.cy + R.dh, bow = R.dh * 0.32, th = 4.2 * k;
    g.save();
    g.lineCap = "butt";
    g.beginPath();
    g.moveTo(x, y0);
    g.quadraticCurveTo(x - bow, R.cy, x, y1);
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = th + 2.2;
    g.stroke();
    g.strokeStyle = pal.stone;
    g.lineWidth = th;
    g.stroke();
    // 돌 쌓은 줄눈
    g.strokeStyle = rgba(pal.ink, 0.5);
    g.lineWidth = 0.7;
    for (let i = 1; i < 9; i++) {
      const t = i / 9, yy = lerp(y0, y1, t), xx = x - bow * 2 * t * (1 - t);
      g.beginPath();
      g.moveTo(xx - th / 2, yy);
      g.lineTo(xx + th / 2, yy);
      g.stroke();
    }
    // 수문 탑
    const gx = x - bow * 0.5;
    g.fillStyle = pal.stone2;
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 0.9;
    g.fillRect(gx - 2.6 * k, R.cy - 3 * k, 5.2 * k, 6 * k);
    g.strokeRect(gx - 2.6 * k, R.cy - 3 * k, 5.2 * k, 6 * k);
    g.restore();
  }
  function drawFields(g, L, S, pal) {
    const F = L.fields, k = L.k, p = S.p;
    const fallow = Math.round(p.f * 10);
    const irrigated = 10 - fallow;
    const parched = Math.round((1 - S.ratioAg) * irrigated);
    g.save();
    g.fillStyle = rgba(pal.land2, 0.25);
    g.fillRect(F.x0 - 2 * k, F.y0 - 2 * k, F.x1 - F.x0 + 4 * k, F.y1 - F.y0 + 4 * k);
    F.plots.forEach(pl => {
      const isFallow = pl.rank < fallow;
      const isParched = !isFallow && pl.rank < fallow + parched;
      trace(g, pl.poly, true);
      g.fillStyle = isFallow ? pal.fallow : isParched ? pal.straw : pal.crops[pl.crop];
      g.fill();
      g.save();
      g.clip();
      // 밭고랑 / 휴경 빗금
      const xs = pl.poly.map(q => q[0]), ys = pl.poly.map(q => q[1]);
      const bx0 = Math.min(...xs) - 4, bx1 = Math.max(...xs) + 4, by0 = Math.min(...ys) - 4, by1 = Math.max(...ys) + 4;
      if (isFallow) {
        g.strokeStyle = rgba(pal.ink, 0.62);
        g.lineWidth = 0.8;
        const st = 3.4 * k;
        g.beginPath();
        for (let d = bx0 - (by1 - by0); d < bx1; d += st) {
          g.moveTo(d, by1);
          g.lineTo(d + (by1 - by0), by0);
        }
        g.stroke();
        g.strokeStyle = rgba(pal.ink, 0.25);
        g.beginPath();
        for (let d = bx0; d < bx1 + (by1 - by0); d += st * 2) {
          g.moveTo(d, by1);
          g.lineTo(d - (by1 - by0), by0);
        }
        g.stroke();
      } else {
        g.strokeStyle = rgba(isParched ? pal.crack : pal.forest2, isParched ? 0.45 : 0.38);
        g.lineWidth = 0.7;
        const st = 2.6 * k;
        g.beginPath();
        if (pl.ang) {
          for (let x = bx0; x < bx1; x += st) { g.moveTo(x, by0); g.lineTo(x + 2, by1); }
        } else {
          for (let y = by0; y < by1; y += st) { g.moveTo(bx0, y); g.lineTo(bx1, y + 1.5); }
        }
        g.stroke();
        if (isParched) {
          g.strokeStyle = rgba(pal.crack, 0.7);
          g.lineWidth = 0.8;
          const cr = rng(Math.round(pl.mx * 7 + pl.my));
          for (let i = 0; i < 3; i++) {
            let x = lerp(bx0, bx1, cr()), y = lerp(by0, by1, cr());
            g.beginPath();
            g.moveTo(x, y);
            for (let j = 0; j < 3; j++) { x += (cr() - 0.5) * 6 * k; y += (cr() - 0.5) * 5 * k; g.lineTo(x, y); }
            g.stroke();
          }
        }
      }
      g.restore();
      trace(g, pl.poly, true);
      g.strokeStyle = rgba(pal.ink, 0.75);
      g.lineWidth = 0.8;
      g.stroke();
    });
    g.restore();
    // 농가
    const hx = L.house.x, hy = L.house.y, s = 1.15 * k;
    g.fillStyle = pal.wall;
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 0.9;
    g.fillRect(hx - 4 * s, hy - 4 * s, 8 * s, 5 * s);
    g.strokeRect(hx - 4 * s, hy - 4 * s, 8 * s, 5 * s);
    g.beginPath();
    g.moveTo(hx - 5 * s, hy - 4 * s);
    g.lineTo(hx, hy - 8 * s);
    g.lineTo(hx + 5 * s, hy - 4 * s);
    g.closePath();
    g.fillStyle = mix(PLAYER[1], "#6b4a10", 0.25);
    g.fill();
    g.stroke();
  }
  function aqueductBase(g, P, wd, pal, k) {
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    trace(g, P.pts, false);
    g.strokeStyle = rgba(pal.ink, 0.9);
    g.lineWidth = wd + 4.4 * k;
    g.stroke();
    g.strokeStyle = pal.stone;
    g.lineWidth = wd + 2.6 * k;
    g.stroke();
    // 아치 표시
    g.strokeStyle = rgba(pal.ink, 0.55);
    g.lineWidth = 0.7;
    for (let d = 4 * k; d < P.len - 3 * k; d += 5.5 * k) {
      const a = pointAt(P, d), off = wd / 2 + 1.3 * k;
      g.beginPath();
      g.arc(a.x + a.nx * off, a.y + a.ny * off, 1.2 * k, 0, Math.PI, false);
      g.stroke();
    }
    g.restore();
  }
  function drop(g, x, y, r, fill, ink) {
    g.beginPath();
    g.moveTo(x, y - r * 1.5);
    g.quadraticCurveTo(x + r * 1.1, y - r * 0.1, x, y + r);
    g.quadraticCurveTo(x - r * 1.1, y - r * 0.1, x, y - r * 1.5);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = rgba(ink, 0.9);
    g.lineWidth = 0.7;
    g.stroke();
  }
  function drawCity(g, L, S, pal) {
    const C = L.city, k = L.k;
    // 성벽 안 마당
    trace(g, C.wall, true);
    g.fillStyle = rgba(pal.parch2, 0.92);
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 3.4 * k;
    g.lineJoin = "round";
    g.stroke();
    g.strokeStyle = pal.stone;
    g.lineWidth = 2 * k;
    g.stroke();
    // 탑
    C.wall.forEach((p, i) => {
      if (i % 2) return;
      g.beginPath();
      g.arc(p[0], p[1], 2.3 * k, 0, TAU);
      g.fillStyle = pal.stone;
      g.fill();
      g.strokeStyle = rgba(pal.ink, 0.95);
      g.lineWidth = 0.9;
      g.stroke();
    });
    // 집
    C.houses.forEach(hs => {
      const s = hs.s, x = hs.x, y = hs.y;
      g.fillStyle = pal.wall;
      g.strokeStyle = rgba(pal.ink, 0.9);
      g.lineWidth = 0.75;
      g.fillRect(x - 2.4 * s, y - 1.2 * s, 4.8 * s, 2.8 * s);
      g.strokeRect(x - 2.4 * s, y - 1.2 * s, 4.8 * s, 2.8 * s);
      g.beginPath();
      g.moveTo(x - 2.9 * s, y - 1.2 * s);
      g.lineTo(x - 1.6 * s, y - 3.4 * s);
      g.lineTo(x + 1.6 * s, y - 3.4 * s);
      g.lineTo(x + 2.9 * s, y - 1.2 * s);
      g.closePath();
      g.fillStyle = hs.v < 0.55 ? pal.roof : hs.v < 0.8 ? pal.roof2 : mix(PLAYER[2], "#5a2a1a", 0.35);
      g.fill();
      g.stroke();
    });
    // 성채
    const kx = C.keep.x, ky = C.keep.y, s = k;
    g.fillStyle = pal.stone;
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 0.9;
    g.fillRect(kx - 4.2 * s, ky - 2 * s, 8.4 * s, 6.5 * s);
    g.strokeRect(kx - 4.2 * s, ky - 2 * s, 8.4 * s, 6.5 * s);
    for (let i = 0; i < 4; i++) {
      g.fillRect(kx - 4.2 * s + i * 2.4 * s, ky - 3.4 * s, 1.3 * s, 1.4 * s);
      g.strokeRect(kx - 4.2 * s + i * 2.4 * s, ky - 3.4 * s, 1.3 * s, 1.4 * s);
    }
    g.fillStyle = rgba(pal.ink, 0.75);
    g.fillRect(kx - 0.9 * s, ky + 1.6 * s, 1.8 * s, 2.9 * s);
    // 물탱크: 채운 높이 = 도시 공급률
    const cs = C.cistern;
    g.save();
    g.beginPath();
    g.arc(cs.x, cs.y, cs.r, 0, TAU);
    g.fillStyle = pal.stone;
    g.fill();
    g.clip();
    g.fillStyle = pal.water;
    const lvY = cs.y + cs.r - 2 * cs.r * S.supply;
    g.fillRect(cs.x - cs.r, lvY, cs.r * 2, cs.y + cs.r - lvY);
    g.restore();
    g.beginPath();
    g.arc(cs.x, cs.y, cs.r, 0, TAU);
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 1.1;
    g.stroke();
    // 절수 캠페인 깃발(물방울)
    if (S.p.save) {
      const bx = C.x1 - C.rx * 0.18, by = C.y0 + C.ry * 0.45, s2 = k;
      g.strokeStyle = rgba(pal.ink, 0.95);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx, by + 9 * s2);
      g.lineTo(bx, by - 7 * s2);
      g.stroke();
      g.beginPath();
      g.moveTo(bx, by - 7 * s2);
      g.lineTo(bx + 9 * s2, by - 7 * s2);
      g.lineTo(bx + 9 * s2, by + 2 * s2);
      g.lineTo(bx + 4.5 * s2, by - 0.2 * s2);
      g.lineTo(bx, by + 2 * s2);
      g.closePath();
      g.fillStyle = "#e9f1f6";
      g.fill();
      g.stroke();
      drop(g, bx + 4.5 * s2, by - 3.6 * s2, 2.3 * s2, pal.water, pal.ink);
      if (!L.thumb && !L.shortC) text(g, "절수", bx + 4.5 * s2, by + 6.5 * s2, `800 ${Math.round(clamp(9 * k, 9, 11))}px ${SANS}`, pal.ink, pal.halo);
    }
  }
  function drawEstuary(g, L, S, pal) {
    const E = L.est, k = L.k, hl = S.health, f = S.flow;
    g.save();
    // 땅 쪽만 칠한다(바다 위로 넘치지 않게)
    g.beginPath();
    g.moveTo(-8, -8);
    L.coast.forEach(p => g.lineTo(p[0], p[1]));
    g.lineTo(-8, L.h + 8);
    g.closePath();
    g.clip();
    trace(g, E.marsh, true);
    g.fillStyle = rgba(mix(pal.marshDry, pal.marsh, hl), 0.55);
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.35);
    g.lineWidth = 0.8;
    g.setLineDash([2, 3]);
    g.stroke();
    g.setLineDash([]);
    // 습지 점묘
    const r = rng(55);
    g.fillStyle = rgba(pal.ink, 0.3);
    for (let i = 0; i < 90; i++) {
      const x = E.mcx + (r() - 0.5) * E.mrx * 2, y = E.mcy + (r() - 0.5) * E.mry * 2;
      if (inPoly(E.marsh, x, y)) g.fillRect(x, y, 0.9, 0.9);
    }
    // 갈래 물길(폭 ∝ 하구 도달 유량)
    const cw = widthOf(L, f.Ve) * 0.32;
    E.channels.forEach(P => drawWater(g, L, P, i => cw * (0.6 + 1.2 * i / P.pts.length), pal, { inkA: 0.6, inkW: 0.8 }));
    // 갈대 덤불: 건강할수록 푸르고 촘촘하다
    const nReed = Math.round((L.wide ? 26 : 13) * (0.55 + 0.45 * hl));
    g.strokeStyle = mix(pal.reedDry, pal.reed, hl);
    g.lineWidth = 0.9;
    for (let i = 0, made = 0; i < 200 && made < nReed; i++) {
      const x = E.mcx + (r() - 0.5) * E.mrx * 1.9, y = E.mcy + (r() - 0.5) * E.mry * 1.9;
      if (!inPoly(E.marsh, x, y) || x > L.coastAt(y) - 3 * k) continue;
      if (Math.abs(y - E.y) < L.halfMax * 0.8 + 3 * k && x > E.x0) continue;
      made++;
      const s = (3 + r() * 2.5) * k;
      g.beginPath();
      for (let j = -2; j <= 2; j++) {
        g.moveTo(x + j * 0.6 * k, y);
        g.quadraticCurveTo(x + j * 1.1 * k, y - s * 0.6, x + j * 1.9 * k, y - s);
      }
      g.stroke();
    }
    g.restore();
    // 갯벌: 바닷가의 점박이 띠(물이 적으면 넓게 드러난다)
    g.save();
    g.beginPath();
    for (let y = E.y - L.h * 0.22, i = 0; y <= E.y + L.h * 0.24; y += 3, i++) {
      const x = L.coastAt(y) + (2 + 3 * Math.sin(y * 0.2)) * k;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = rgba(mix(pal.mud, pal.sea, 0.25), 0.85);
    g.lineWidth = (5 + 3 * (1 - hl)) * k;
    g.lineCap = "round";
    g.stroke();
    g.restore();
    // 산란장 표시(펄스를 온전히 이행할 때)
    if (S.pulseOK) {
      const sx = lerp(E.x0, E.x1, 0.7), sy = E.y + L.h * 0.09;
      g.fillStyle = rgba("#f6e7a8", 0.95);
      g.strokeStyle = rgba(pal.ink, 0.7);
      g.lineWidth = 0.6;
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, d = (i % 3 + 1) * 1.6 * k;
        g.beginPath();
        g.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.6, 1.05 * k, 0, TAU);
        g.fill();
        g.stroke();
      }
    }
    // 어민 오두막
    const hx = E.hut.x, hy = E.hut.y, s = 1.05 * k;
    g.fillStyle = pal.wall;
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 0.9;
    g.fillRect(hx - 3.6 * s, hy - 3.2 * s, 7.2 * s, 4.2 * s);
    g.strokeRect(hx - 3.6 * s, hy - 3.2 * s, 7.2 * s, 4.2 * s);
    g.beginPath();
    g.moveTo(hx - 4.6 * s, hy - 3.2 * s);
    g.lineTo(hx, hy - 7 * s);
    g.lineTo(hx + 4.6 * s, hy - 3.2 * s);
    g.closePath();
    g.fillStyle = mix(PLAYER[3], "#2a3a1a", 0.3);
    g.fill();
    g.stroke();
  }
  function boat(g, x, y, s, pal) {
    g.beginPath();
    g.moveTo(x - 5 * s, y);
    g.quadraticCurveTo(x, y + 3 * s, x + 5 * s, y);
    g.closePath();
    g.fillStyle = "#6b4a2a";
    g.fill();
    g.strokeStyle = rgba(pal.ink, 0.95);
    g.lineWidth = 0.8;
    g.stroke();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 8 * s);
    g.stroke();
    g.beginPath();
    g.moveTo(x + 0.5 * s, y - 7.5 * s);
    g.quadraticCurveTo(x + 4.5 * s, y - 4 * s, x + 0.5 * s, y - 1 * s);
    g.closePath();
    g.fillStyle = "#f3ead2";
    g.fill();
    g.stroke();
  }
  function weather(g, L, S, pal) {
    // 습윤: 상류 비구름 / 건조: 해. 넓은 화면에서만 그린다(좁은 화면은 겹침을 피한다).
    const W = L.weather, k = L.k;
    if (!W) return;
    const x = W.x, y = W.y;
    g.save();
    if (S.scen === "wet") {
      // 잉크 윤곽을 먼저 굵게 그리고 그 위를 칠해 겉선만 남긴다(구름 실루엣).
      g.beginPath();
      [[-8, 1, 6], [0, -3, 8], [9, 0, 7], [2, 4, 6]].forEach(([dx, dy, r]) => { g.moveTo(x + dx * k + r * k, y + dy * k); g.arc(x + dx * k, y + dy * k, r * k, 0, TAU); });
      g.strokeStyle = rgba(pal.ink, 0.85);
      g.lineWidth = 2.2;
      g.stroke();
      g.fillStyle = pal.parch2;
      g.fill();
      g.strokeStyle = rgba(pal.ink, 0.35);
      g.lineWidth = 0.7;
      g.beginPath();
      g.arc(x + 1 * k, y + 1 * k, 4 * k, Math.PI * 0.1, Math.PI * 0.8);
      g.stroke();
    } else if (S.scen === "dry") {
      g.strokeStyle = rgba("#b0611a", 0.9);
      g.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = i * TAU / 12;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * 8 * k, y + Math.sin(a) * 8 * k);
        g.lineTo(x + Math.cos(a) * 12 * k, y + Math.sin(a) * 12 * k);
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, 6 * k, 0, TAU);
      g.fillStyle = rgba("#f0c24e", 0.95);
      g.fill();
      g.strokeStyle = rgba(pal.ink, 0.85);
      g.stroke();
    }
    g.restore();
  }
  function labels(g, L, S, pal) {
    if (!L.wide) return;
    const k = L.k, f = sz => `800 ${Math.round(sz)}px ${SERIF}`, ink = rgba(pal.ink, 0.92);
    const R = L.res, F = L.fields, C = L.city, E = L.est;
    text(g, "은여울 저수지", R.cx - R.rx * 0.22, R.cy + R.ry * 0.5, f(11.5 * Math.min(1, k)), ink, pal.halo);
    if (F.y0 - 7 * k >= 16) text(g, "들녘", (F.x0 + F.x1) / 2, F.y0 - 7 * k, f(12 * Math.min(1.1, k)), ink, pal.halo);
    if (C.y0 - 2 * k >= 16) text(g, "여울시", C.cx, C.y0 - 2 * k, f(12 * Math.min(1.1, k)), ink, pal.halo);
    text(g, "하구 갯벌", E.mcx - E.mrx * 0.15, Math.min(L.h - 12, E.mcy + E.mry + 3 * k), f(11 * Math.min(1, k)), ink, pal.halo);
    // 강 이름은 물길을 따라 한 글자씩 놓는다.
    const P = L.river, name = "은 여 울 강";
    g.save();
    g.font = f(12 * Math.min(1.1, k));
    g.fillStyle = ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let d = P.len * 0.56;
    for (const ch of name) {
      const a = pointAt(P, d), b = pointAt(P, d + 2);
      const ang = Math.atan2(b.y - a.y, b.x - a.x), off = L.halfMax * 0.55 + 9 * k;
      g.save();
      g.translate(a.x + a.nx * off, a.y + a.ny * off);
      g.rotate(ang);
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.strokeStyle = pal.halo;
      g.strokeText(ch, 0, 0);
      g.fillText(ch, 0, 0);
      g.restore();
      d += ch === " " ? 5 * k : 9 * k;
    }
    g.restore();
    if (S.p.link) text(g, "이웃 댐 연계 +10", 15, L.link.pts[0][1] - 10 * k, `700 ${Math.round(10 * Math.min(1.1, k))}px ${SANS}`, ink, pal.halo, "left");
  }
  function drawState(g, L, S, pal) {
    const k = L.k, f = S.flow;
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    weather(g, L, S, pal);
    // 상류 유입(전망별 15·55·100)과 이웃 댐 연계 이송
    const inW = L.kw * (1 + 0.075 * SCEN[S.scen].inflow);
    drawWater(g, L, L.inflow, i => inW * (0.75 + 0.25 * i / L.inflow.pts.length), pal, { wob: 0.4 });
    if (S.p.link) {
      aqueductBase(g, L.link, L.kw * 3.4, pal, k);
      drawWater(g, L, L.link, () => L.kw * 3.4, pal, { inkA: 0.7, inkW: 0.8 });
    }
    drawReservoir(g, L, S, pal);
    // 농업 수로(폭 ∝ 실제 공급)와 회귀수. 감량되면 계획 폭을 붉은 점선으로 남긴다.
    const n = L.canal.pts.length, taper = i => i < n * 0.35 ? 1 : lerp(1, 0.45, (i / n - 0.35) / 0.65);
    const canalW = widthOf(L, f.ag) * 0.9;
    if (f.planAg - f.ag > 0.5) {
      fillRibbon(g, ribbon(L.canal, i => widthOf(L, f.planAg) * 0.9 * taper(i), 0));
      g.setLineDash([2, 2]);
      g.strokeStyle = rgba("#b3302a", 0.85);
      g.lineWidth = 0.9;
      g.stroke();
      g.setLineDash([]);
    }
    if (f.ag > 0.05) drawWater(g, L, L.canal, i => canalW * taper(i), pal, { inkA: 0.8, inkW: 0.9 });
    if (f.agRet > 0.05) drawWater(g, L, L.agRet, () => widthOf(L, f.agRet) * 0.8, pal, { inkA: 0.6, inkW: 0.7 });
    // 도시 수도교(폭 ∝ 실제 공급)와 회귀수
    const aqW = widthOf(L, f.city) * 0.85;
    aqueductBase(g, L.aq, aqW, pal, k);
    if (f.planCity - f.city > 0.5) {
      fillRibbon(g, ribbon(L.aq, () => widthOf(L, f.planCity) * 0.85, 0));
      g.setLineDash([2, 2]);
      g.strokeStyle = rgba("#b3302a", 0.85);
      g.lineWidth = 0.9;
      g.stroke();
      g.setLineDash([]);
    }
    if (f.city > 0.05) drawWater(g, L, L.aq, () => aqW, pal, { inkA: 0.7, inkW: 0.8 });
    if (f.cityRet > 0.05) drawWater(g, L, L.cityRet, () => widthOf(L, f.cityRet) * 0.8, pal, { inkA: 0.6, inkW: 0.7 });
    drawFields(g, L, S, pal);
    drawCity(g, L, S, pal);
    drawEstuary(g, L, S, pal);
    // 본류: 구간마다 그 구간을 지나는 물량에 비례한 폭
    const widths = widthsFor(L, S);
    const rb = drawWater(g, L, L.river, i => widths[i], pal, { wob: 0.35 });
    bankHatch(g, rb, pal, k, L.wide ? 3 : 4);
    drawDam(g, L, pal);
    if (!L.thumb) boat(g, lerp(L.coastX, L.w, L.wide ? 0.2 : 0.55), L.est.y + L.h * (L.wide ? 0.13 : 0.24), 0.95 * k, pal);
    labels(g, L, S, pal);
    if (S.shortage > EPS) cutMark(g, L, S, pal);
    g.restore();
    edgeBurn(g, L, pal);
    if (!L.thumb) neatline(g, L, pal);
    if (L.panel) drawPanel(g, L, S, pal);
    if (L.plaque) drawPlaque(g, L, S);
    if (S.locked) drawSeal(g, L, S, pal);
  }

  // 사수위에 닿아 감량될 때의 붉은 표식(얼마나 줄었는지)
  function cutRect(L, S, g) {
    const fs = L.thumb ? 0 : L.wide ? 11 : 10, label = `감량 −${fmt(S.shortage)}`;
    if (!fs) return { x: L.cutMark.x - 7, y: L.cutMark.y - 7, w: 14, h: 14, label: "" };
    g.font = `800 ${fs}px ${SANS}`;
    const w = g.measureText(label).width + 12, h = fs + 7;
    return { x: L.cutMark.x - w / 2, y: L.cutMark.y - h / 2, w, h, label, fs };
  }
  function cutMark(g, L, S, pal) {
    const q = cutRect(L, S, g);
    g.save();
    roundRect(g, q.x, q.y, q.w, q.h, q.label ? 3 : 7);
    g.fillStyle = "#8f1f15";
    g.fill();
    g.strokeStyle = "#f4d9a8";
    g.lineWidth = 1;
    g.stroke();
    if (q.label) text(g, q.label, q.x + q.w / 2, q.y + q.h / 2 + 0.5, `800 ${q.fs}px ${SANS}`, "#fff1df");
    else text(g, "!", q.x + q.w / 2, q.y + q.h / 2 + 0.5, `900 10px ${SANS}`, "#fff1df");
    g.restore();
  }

  /* ---------- 외교 창·명판·인장 ---------- */
  function statusAt(S, i) { return S.statuses && isStatus(S.statuses[i]) ? S.statuses[i] : "none"; }
  function drawPanel(g, L, S, pal) {
    const P = L.panel, x = P.x, y = P.y, w = P.w, h = P.h, rh = P.rowH;
    g.save();
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = 6;
    g.shadowOffsetY = 2;
    roundRect(g, x, y, w, h, 4);
    g.fillStyle = WOOD;
    g.fill();
    g.restore();
    g.save();
    roundRect(g, x + 2.5, y + 2.5, w - 5, h - 5, 3);
    g.strokeStyle = GOLD;
    g.lineWidth = 1;
    g.stroke();
    // 머리띠: 나무판에 금빛 글씨
    text(g, "외교", x + 12, y + 14, `800 12px ${SERIF}`, GOLD2, null, "left");
    text(g, S.locked ? "상정 확정" : `ROUND ${S.n}/4`, x + w - 12, y + 14, `700 11.5px ${SANS}`, "#f3e3bd", null, "right");
    // 본문: 양피지(밝은 화면) 또는 짙은 나무(어두운 화면)
    const by = y + 25, bh = h - 29;
    g.fillStyle = pal.dark ? "#2b1e12" : "#f4e8ca";
    g.fillRect(x + 4, by, w - 8, bh);
    g.strokeStyle = rgba(GOLD, 0.6);
    g.strokeRect(x + 4.5, by + 0.5, w - 9, bh - 1);
    const body = pal.dark ? "#f1e3c2" : "#2c1b0c";
    PARTIES.forEach((key, i) => {
      const ry = by + 4 + i * rh, cy = ry + rh / 2;
      if (i) {
        g.strokeStyle = pal.dark ? "rgba(201,160,67,0.25)" : "rgba(90,60,30,0.2)";
        g.beginPath();
        g.moveTo(x + 10, ry + 0.5);
        g.lineTo(x + w - 10, ry + 0.5);
        g.stroke();
      }
      g.fillStyle = PLAYER[i];
      g.fillRect(x + 11, cy - 4.5, 9, 9);
      g.strokeStyle = body;
      g.lineWidth = 1;
      g.strokeRect(x + 11.5, cy - 4, 8, 8);
      text(g, SHORT[i], x + 27, cy + 0.5, `700 12px ${SANS}`, body, null, "left");
      let tx = x + 27 + 30;
      if ((S.mask >> i) & 1) {
        text(g, "▲기준", tx, cy + 0.5, `700 10px ${SANS}`, pal.dark ? "#ffb4a0" : "#9b2a1e", null, "left");
        tx += 36;
      }
      if (S.decision && S.decision.party === key) text(g, S.decision.action === "apply" ? "반영" : "거절", tx, cy + 0.5, `700 10px ${SANS}`, pal.dark ? "#d9c49a" : "#5b3f22", null, "left");
      const st = statusAt(S, i), label = STATUS_KO[st];
      g.font = `700 11px ${SANS}`;
      const bw = Math.max(38, g.measureText(label).width + 14), bx = x + w - 10 - bw;
      roundRect(g, bx, cy - 7.5, bw, 15, 7.5);
      g.fillStyle = FLAG[st];
      g.fill();
      g.strokeStyle = st === "none" ? "#8a6a43" : "rgba(0,0,0,0.35)";
      g.lineWidth = 1;
      if (S.draft) g.setLineDash([2, 2]);
      g.stroke();
      g.setLineDash([]);
      text(g, label, bx + bw / 2, cy + 0.5, `700 11px ${SANS}`, BADGE_INK[st], null);
    });
    g.restore();
  }
  function drawPlaque(g, L, S) {
    const P = L.plaque;
    g.save();
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = 4;
    g.shadowOffsetY = 1;
    roundRect(g, P.x, P.y, P.w, P.h, 3);
    g.fillStyle = WOOD;
    g.fill();
    g.restore();
    roundRect(g, P.x + 2, P.y + 2, P.w - 4, P.h - 4, 2);
    g.strokeStyle = GOLD;
    g.lineWidth = 1;
    g.stroke();
    text(g, "ROUND", P.x + P.w / 2, P.y + 10, `700 8px ${SANS}`, GOLD2);
    text(g, `${S.n}/4`, P.x + P.w / 2, P.y + 23, `800 13px ${SERIF}`, "#f6e8c6");
  }
  function drawSeal(g, L, S, pal) {
    const s = L.seal, r = s.r, x = s.x, y = s.y;
    g.save();
    // 리본 꼬리
    if (!L.thumb) {
      [[-1, "#1f4e79"], [1, "#8a2318"]].forEach(([sg, col]) => {
        g.beginPath();
        g.moveTo(x + sg * r * 0.15, y + r * 0.4);
        g.lineTo(x + sg * r * 0.75, y + r * 1.35);
        g.lineTo(x + sg * r * 0.45, y + r * 1.22);
        g.lineTo(x + sg * r * 0.28, y + r * 1.45);
        g.lineTo(x - sg * r * 0.1, y + r * 0.5);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = rgba(pal.ink, 0.8);
        g.lineWidth = 0.8;
        g.stroke();
      });
    }
    // 밀랍 덩어리
    const rr = rng(13), pts = [];
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU, q = 1 + 0.07 * Math.sin(a * 5 + 1) + 0.05 * (rr() - 0.5) + (i % 7 === 0 ? 0.09 : 0);
      pts.push([x + Math.cos(a) * r * q, y + Math.sin(a) * r * q]);
    }
    g.shadowColor = "rgba(40,10,5,0.45)";
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    trace(g, pts, true);
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 1.1);
    gr.addColorStop(0, "#d2473a");
    gr.addColorStop(0.55, "#a8241b");
    gr.addColorStop(1, "#6e130d");
    g.fillStyle = gr;
    g.fill();
    g.shadowColor = "transparent";
    g.beginPath();
    g.arc(x, y, r * 0.7, 0, TAU);
    g.strokeStyle = "rgba(70,8,5,0.75)";
    g.lineWidth = Math.max(1, r * 0.07);
    g.stroke();
    g.beginPath();
    g.arc(x, y, r * 0.7, Math.PI * 1.05, Math.PI * 1.6);
    g.strokeStyle = "rgba(255,190,170,0.5)";
    g.lineWidth = Math.max(1, r * 0.05);
    g.stroke();
    // 물결 문장
    g.strokeStyle = "#f5c9b6";
    g.lineWidth = Math.max(1, r * 0.06);
    for (let j = 0; j < 2; j++) {
      const yy = y + (L.thumb ? 0 : r * 0.28) + j * r * 0.16 - r * 0.08;
      g.beginPath();
      for (let i = 0; i <= 12; i++) {
        const xx = x - r * 0.42 + i / 12 * r * 0.84, w2 = Math.sin(i / 12 * TAU * 1.5) * r * 0.06;
        if (i) g.lineTo(xx, yy + w2); else g.moveTo(xx, yy + w2);
      }
      g.stroke();
    }
    if (!L.thumb) text(g, "확정", x, y - r * 0.14, `800 ${Math.round(r * 0.42)}px ${SERIF}`, "#fbe1d4");
    g.restore();
    // 상정 방식 두루마리
    if (!L.thumb && L.wide && S.finalMode && L.h >= 220) {
      const label = FINAL_KO[S.finalMode];
      g.save();
      g.font = `800 11.5px ${SERIF}`;
      const fw = g.measureText(label).width + 24, fx = x - fw / 2, fy = y + r * 1.62;
      roundRect(g, fx, fy - 10, fw, 20, 3);
      g.fillStyle = "#f4e8ca";
      g.fill();
      g.strokeStyle = rgba(pal.ink, 0.85);
      g.lineWidth = 1;
      g.stroke();
      text(g, label, fx + fw / 2, fy + 0.5, `800 11.5px ${SERIF}`, "#2c1b0c");
      g.restore();
    }
  }

  /* ---------- 움직이는 층(매 프레임) ---------- */
  function streaks(g, P, widths, t, speed, gap, col) {
    const n = Math.max(1, Math.floor(P.len / gap)), span = n * gap;
    g.strokeStyle = col;
    g.lineCap = "round";
    for (let j = 0; j < n; j++) {
      const d = (j * gap + t * speed) % span;
      const a = pointAt(P, d), wd = Array.isArray(widths) ? widths[a.i] : widths;
      if (!(wd >= 2.6)) continue;
      const lane = ((j * 7) % 3 - 1) * wd * 0.22, len = Math.min(gap * 0.5, 2 + wd * 0.55), b = pointAt(P, d + len);
      g.lineWidth = clamp(wd * 0.12, 0.7, 1.8);
      g.beginPath();
      g.moveTo(a.x + a.nx * lane, a.y + a.ny * lane);
      g.lineTo(b.x + b.nx * lane, b.y + b.ny * lane);
      g.stroke();
    }
  }
  function dashFlow(g, P, wd, t, speed, col, k) {
    if (wd < 1.2) return;
    g.save();
    g.strokeStyle = col;
    g.lineWidth = clamp(wd * 0.32, 0.6, 2);
    g.lineCap = "round";
    g.setLineDash([2.5 * k, 6 * k]);
    g.lineDashOffset = -t * speed;
    trace(g, P.pts, false);
    g.stroke();
    g.restore();
  }
  function fish(g, x, y, s, ang, col, ink) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.ellipse(0, 0, 3 * s, 1.3 * s, 0, 0, TAU);
    g.moveTo(-2.6 * s, 0);
    g.lineTo(-4.6 * s, -1.4 * s);
    g.lineTo(-4.6 * s, 1.4 * s);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = rgba(ink, 0.85);
    g.lineWidth = 0.6;
    g.stroke();
    g.restore();
  }
  function flagShape(g, x, y, k, st, player, t, ph, draft, pal) {
    const poleH = 20.5 * k, cw = 13.5 * k, ch = 9 * k, top = y - poleH;
    g.save();
    g.fillStyle = rgba(pal.ink, 0.25);
    g.beginPath();
    g.ellipse(x, y, 3.2 * k, 1.2 * k, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "#2c1a0b";
    g.lineWidth = Math.max(1, 1.2 * k);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, top);
    g.stroke();
    const n = 8, upper = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, dy = Math.sin(t * 4.4 + ph - u * 3.4) * 1.5 * k * u;
      upper.push([x + u * cw, top + 1.4 * k + dy]);
    }
    const end = upper[n];
    g.beginPath();
    g.moveTo(upper[0][0], upper[0][1]);
    upper.forEach(p => g.lineTo(p[0], p[1]));
    g.lineTo(end[0] - 2.6 * k, end[1] + ch / 2);
    for (let i = n; i >= 0; i--) g.lineTo(upper[i][0], upper[i][1] + ch);
    g.closePath();
    g.globalAlpha = draft ? 0.8 : 1;
    g.fillStyle = FLAG[st];
    g.fill();
    g.globalAlpha = 1;
    // 접힌 그늘과 깃대 쪽 플레이어 색 띠
    g.save();
    g.clip();
    g.fillStyle = "rgba(0,0,0,0.13)";
    for (let i = 1; i < n; i++) {
      if (Math.cos(t * 4.4 + ph - (i / n) * 3.4) > 0.35) g.fillRect(upper[i][0] - cw / n / 2, upper[i][1] - 2, cw / n, ch + 4);
    }
    g.fillStyle = player;
    g.fillRect(x, top, 2.6 * k, ch + 6 * k);
    g.restore();
    g.strokeStyle = "rgba(34,20,10,0.95)";
    g.lineWidth = Math.max(0.8, 0.8 * k);
    if (draft) g.setLineDash([2, 1.5]);
    g.stroke();
    g.setLineDash([]);
    // 문양: 수용 ✓, 조건부 ~, 거부 ✕
    const mid = upper[Math.round(n * 0.58)], mx = mid[0], my = mid[1] + ch / 2;
    g.strokeStyle = st === "conditional" ? "#3a2405" : "#ffffff";
    g.lineWidth = Math.max(1, 1.25 * k);
    g.lineCap = "round";
    g.lineJoin = "round";
    const e = 2.1 * k;
    g.beginPath();
    if (st === "accept") {
      g.moveTo(mx - e, my);
      g.lineTo(mx - e * 0.25, my + e * 0.8);
      g.lineTo(mx + e * 1.1, my - e * 0.9);
    } else if (st === "reject") {
      g.moveTo(mx - e * 0.85, my - e * 0.85);
      g.lineTo(mx + e * 0.85, my + e * 0.85);
      g.moveTo(mx + e * 0.85, my - e * 0.85);
      g.lineTo(mx - e * 0.85, my + e * 0.85);
    } else if (st === "conditional") {
      g.moveTo(mx - e * 1.1, my + e * 0.25);
      g.quadraticCurveTo(mx - e * 0.55, my - e * 0.75, mx, my);
      g.quadraticCurveTo(mx + e * 0.55, my + e * 0.75, mx + e * 1.1, my - e * 0.25);
    }
    g.stroke();
    // 깃대 꼭지(플레이어 색)
    g.beginPath();
    g.arc(x, top - 1.1 * k, 1.9 * k, 0, TAU);
    g.fillStyle = player;
    g.fill();
    g.strokeStyle = "#22140a";
    g.lineWidth = 0.9;
    g.stroke();
    g.restore();
  }
  function plateRect(L, f, w, h, keep) {
    const k = L.k;
    const cands = [
      [f.x - w / 2, f.y + 3 * k], [f.x + 15 * k, f.y - 20 * k], [f.x + 4 * k, f.y - 6 * k - h],
      [f.x - w - 4 * k, f.y - 6 * k - h], [f.x - w - 3 * k, f.y - 2 * k - h / 2]
    ];
    for (const [x, y] of cands) {
      if (x < 4 || y < 4 || x + w > L.w - 4 || y + h > L.h - 4) continue;
      if (keep.some(q => x < q[2] && x + w > q[0] && y < q[3] && y + h > q[1])) continue;
      return [x, y];
    }
    return null;
  }
  function drawLive(g, L, S, pal, t, still, zones) {
    const k = L.k, f = S.flow;
    const light = pal.dark ? "rgba(225,238,248,0.55)" : "rgba(255,255,255,0.75)";
    const widths = widthsFor(L, S);
    g.save();
    // 물결·생물은 외교 창·명판·인장 밑으로 지나가지 않게 그 자리를 빼고 그린다.
    g.save();
    g.beginPath();
    g.rect(0, 0, L.w, L.h);
    [L.panel, L.plaque].forEach(q => { if (q) g.rect(q.x, q.y, q.w, q.h); });
    if (S.locked) {
      g.moveTo(L.seal.x + L.seal.r * 1.2, L.seal.y);
      g.arc(L.seal.x, L.seal.y, L.seal.r * 1.2, 0, TAU);
    }
    g.clip("evenodd");
    // 물 흐름: 속도 ∝ 물량
    if (!still) {
      streaks(g, L.river, widths, t, 14 + 0.12 * f.R, 22 * k, light);
      streaks(g, L.inflow, L.kw * (1 + 0.075 * SCEN[S.scen].inflow), t, 10 + 0.12 * SCEN[S.scen].inflow, 18 * k, light);
      dashFlow(g, L.canal, widthOf(L, f.ag) * 0.9, t, 10 + 0.15 * f.ag, light, k);
      dashFlow(g, L.aq, widthOf(L, f.city) * 0.85, t, 10 + 0.15 * f.city, light, k);
      if (S.p.link) dashFlow(g, L.link, L.kw * 3.4, t, 14, light, k);
      L.est.channels.forEach(P => dashFlow(g, P, widthOf(L, f.Ve) * 0.32, t, 9, light, k));
    }
    // 산란기 펄스: 댐에서 하구로 내려가는 밝은 물마루
    if (S.p.pulse) {
      const P = L.river, period = 4.2, u = still ? 0.62 : (t % period) / period;
      const d = u * P.len;
      g.strokeStyle = S.pulseOK ? "rgba(255,255,255,0.95)" : "rgba(255,230,200,0.7)";
      g.lineWidth = Math.max(1.4, 2.2 * k);
      g.lineCap = "round";
      for (let j = 0; j < 3; j++) {
        const b = pointAt(P, d - j * 5 * k), wb = (widths[b.i] || 6) / 2 + 1.5;
        g.globalAlpha = 1 - j * 0.3;
        g.beginPath();
        g.moveTo(b.x + b.nx * wb, b.y + b.ny * wb);
        g.lineTo(b.x - b.nx * wb, b.y - b.ny * wb);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // 하구 생물: 물고기·새 수 ∝ 하구 건강(하구 Q와 모형 DO)
    const E = L.est, hl = S.health;
    const seal = S.locked ? { x: L.seal.x - L.seal.r, y: L.seal.y - L.seal.r, w: L.seal.r * 2, h: L.seal.r * 2.5 } : null;
    const covered = (x, y) => [L.panel, L.plaque, seal].some(q => q && x > q.x - 8 && x < q.x + q.w + 8 && y > q.y - 8 && y < q.y + q.h + 8);
    const nFish = Math.round(1 + hl * (L.wide ? 4 : 3) + (S.pulseOK ? 1 : 0));
    for (let i = 0; i < nFish; i++) {
      const cyc = still ? (0.12 + i * 0.13) % 0.4 : ((t * 0.55 + i * 1.7) % 2) / 2;
      const bx = lerp(L.coastX + 8 * k, L.w - 12 * k, ((i * 0.37) % 1) * (L.panel ? 0.45 : 0.85));
      const by = E.y + (i % 2 ? 1 : -1) * (6 + i * 5) * k + (L.panel ? 6 * k : 0);
      if (covered(bx, by)) continue;
      if (cyc < 0.42) {
        const u = cyc / 0.42, jx = bx + (u - 0.5) * 12 * k, jy = by - Math.sin(u * Math.PI) * 7 * k;
        fish(g, jx, jy, 0.85 * k, Math.atan2(-Math.cos(u * Math.PI) * 7, 12), "#9fb7c4", pal.ink);
      } else if (cyc < 0.6) {
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.lineWidth = 0.8;
        g.beginPath();
        g.ellipse(bx + 6 * k, by, (cyc - 0.4) * 22 * k, (cyc - 0.4) * 7 * k, 0, 0, TAU);
        g.stroke();
      }
    }
    const nBird = Math.round(hl * (L.wide ? 4 : 2));
    g.strokeStyle = rgba(pal.ink, 0.85);
    g.lineWidth = Math.max(0.8, 0.9 * k);
    for (let i = 0; i < nBird; i++) {
      const a = (still ? 0.6 : t * 0.45) + i * TAU / Math.max(1, nBird);
      const bx = E.mcx + Math.cos(a) * E.mrx * 0.55, by = E.mcy - E.mry * 0.35 + Math.sin(a) * E.mry * 0.25;
      if (covered(bx, by)) continue;
      const flap = Math.sin((still ? 1 : t) * 7 + i) * 1.2 * k, s = 2.6 * k;
      g.beginPath();
      g.moveTo(bx - s, by - flap);
      g.quadraticCurveTo(bx - s * 0.4, by - s * 0.5, bx, by);
      g.quadraticCurveTo(bx + s * 0.4, by - s * 0.5, bx + s, by - flap);
      g.stroke();
    }
    // 습윤 전망의 비(구름 아래)
    if (S.scen === "wet" && L.weather) {
      const W = L.weather;
      g.strokeStyle = rgba(pal.water, 0.85);
      g.lineWidth = 0.9;
      for (let i = 0; i < 7; i++) {
        const u = still ? (i * 0.31) % 1 : (t * 1.6 + i * 0.29) % 1, xx = W.x - 8 * k + i * 3 * k, yy = W.y + 7 * k + u * 12 * k;
        g.beginPath();
        g.moveTo(xx, yy);
        g.lineTo(xx - 1.5 * k, yy + 3.5 * k);
        g.stroke();
      }
    }
    g.restore();
    // 깃발과 명패
    const keep = zones.slice();
    L.flags.forEach(fl => keep.push([fl.x - 3 * k, fl.y - 23 * k, fl.x + 15 * k, fl.y + 2 * k]));
    L.flags.forEach((fl, i) => flagShape(g, fl.x, fl.y, k, statusAt(S, i), PLAYER[i], still ? 0.4 : t, i * 1.3, S.draft, pal));
    // 명패: 아주 낮은 장면(휴대폰 면접실·성찰)은 깃발만 남겨 겹침을 줄인다.
    if (!L.thumb && !L.shortC) {
      const fs = Math.round(clamp(10.5 * k, 10, 12));
      L.flags.forEach((fl, i) => {
        g.font = `800 ${fs}px ${SANS}`;
        // 연속 거절로 기준이 오른 당사자는 ▲를 붙인다.
        const name = SHORT[i] + ((S.mask >> i) & 1 ? "▲" : "");
        const tw = g.measureText(name).width, pw = tw + 18, ph = fs + 6;
        const at = plateRect(L, fl, pw, ph, keep);
        if (!at) return;
        keep.push([at[0] - 2, at[1] - 2, at[0] + pw + 2, at[1] + ph + 2]);
        roundRect(g, at[0], at[1], pw, ph, 3);
        g.fillStyle = pal.dark ? "#2b1e12" : "#f6ebcf";
        g.fill();
        g.strokeStyle = pal.dark ? GOLD : "#4a2f17";
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = PLAYER[i];
        g.fillRect(at[0] + 4.5, at[1] + ph / 2 - 3.5, 7, 7);
        g.strokeStyle = pal.dark ? "#f1e3c2" : "#2c1b0c";
        g.strokeRect(at[0] + 4.5, at[1] + ph / 2 - 3.5, 7, 7);
        text(g, name, at[0] + 14 + tw / 2, at[1] + ph / 2 + 0.5, `800 ${fs}px ${SANS}`, pal.dark ? "#f1e3c2" : "#2c1b0c");
      });
    }
    g.restore();
  }

  /* ---------- 칩·설명 ---------- */
  function chipList(S, w, h) {
    const p = S.p;
    const scen = { label: "전망", value: SCEN[S.scen].ko, tone: "scen-" + S.scen };
    const round = S.locked ? { label: "상정", value: "확정", tone: "seal" } : { label: "라운드", value: `${S.n}/4`, tone: "round" };
    if (w < 300 || h < 150) return [scen, round];
    const base = [
      { label: "농업", value: String(p.ag), tone: "ag" },
      { label: "도시", value: String(p.city), tone: "city" },
      { label: "하천", value: p.pulse ? `${p.env}+4` : String(p.env), tone: "env" },
      scen
    ];
    if (w < 600) return base;
    const out = base.concat([{ label: "기말 저수", value: fmt(S.end), tone: "dam" }]);
    if (S.shortage > EPS) out.push({ label: "감량", value: fmt(S.shortage), tone: "bad" });
    out.push({ label: "라운드", value: `${S.n}/4`, tone: "round" });
    if (S.locked) out.push({ label: "상정", value: "확정", tone: "seal" });
    return out;
  }
  // 칩 줄이 덮는 대략의 영역(명패를 피해서 놓는 데만 쓴다)
  function chipZones(chips, w, h) {
    if (!chips.length) return [];
    const fs = w <= 760 ? 12 : 12.5, avail = w - 20;
    let rows = 1, x = 0, maxX = 0;
    chips.forEach(c => {
      const cw = 30 + String(c.label).length * fs + String(c.value).length * fs * 0.62;
      if (x && x + cw > avail) { rows++; x = 0; }
      x += cw + 6;
      maxX = Math.max(maxX, x);
    });
    const top = h - 10 - rows * 26 - (rows - 1) * 6;
    return [[10, top - 2, 10 + (rows > 1 ? avail : maxX), h]];
  }
  function caption(S) {
    const p = S.p, f = S.flow, sc = SCEN[S.scen].ko;
    let s = `은여울강 유역도. ${sc} 전망에서 농업 ${p.ag}, 도시 ${p.city}, 하천유지 ${p.env}백만 m³${p.pulse ? "(펄스 4 추가)" : ""}를 배분합니다.`;
    if (S.shortage > EPS) s += ` 사수위에 닿아 ${fmt(S.shortage)}백만 m³를 감량하므로 실제 공급은 농업 ${fmt(f.ag)}, 도시 ${fmt(f.city)}, 하천 ${fmt(f.env)}입니다.`;
    s += ` 저수지 기말 저수량은 ${fmt(S.end)}백만 m³입니다.`;
    const opts = [p.f ? `휴경 ${Math.round(p.f * 100)}%` : "", p.save ? "도시 절수" : "", p.link ? "이웃 댐 연계 이송" : "", p.pulse ? "산란기 펄스" : ""].filter(Boolean);
    if (opts.length) s += ` 부속 조항: ${opts.join(", ")}.`;
    if (!S.n) s += " 아직 제출한 제안이 없어 네 깃발이 모두 흰색입니다.";
    else if (S.statuses) s += ` 협상 라운드 ${S.n}/4${S.draft ? "(반응 입력 중)" : ""}: ${PARTIES.map((_, i) => `${SHORT[i]} ${STATUS_KO[statusAt(S, i)]}`).join(", ")}.`;
    else s += ` 협상 라운드 ${S.n}/4: 반응을 기록하기 전입니다.`;
    if (S.locked) s += ` 상정안을 확정했습니다${S.finalMode ? "(" + FINAL_KO[S.finalMode] + ")" : ""}.`;
    return s;
  }

  /* ---------- 캐시와 그리기 ---------- */
  // 캐시 층: 양피지(크기·화면 색) → 지형(전망 색) → 배분 상태. 매 프레임은 마지막 층 위에 움직이는 것만 그린다.
  const cache = { pKey: "", pC: null, tKey: "", tC: null, sKey: "", sC: null };
  function layerCanvas(c, w, h, dpr) {
    const cv = c || document.createElement("canvas");
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { cv, g };
  }
  function dprOf(g) {
    try {
      const m = typeof g.getTransform === "function" ? g.getTransform() : null;
      if (m && isNum(m.a) && m.a > 0) return m.a;
    } catch (e) { /* 변환 행렬을 못 읽으면 기기 배율을 쓴다 */ }
    return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  }
  let fontHooked = false;
  function hookFonts() {
    if (fontHooked) return;
    fontHooked = true;
    try {
      const fs = document.fonts;
      if (!fs || typeof fs.load !== "function") return;
      // 웹 글꼴이 늦게 도착하면 캐시를 비우고 장면을 한 번 다시 그린다.
      Promise.all([fs.load(`800 13px "Nanum Myeongjo"`, "은여울강"), fs.load(`700 12px "IBM Plex Sans KR"`, "공사수용")])
        .then(list => {
          if (!list.some(a => a && a.length)) return;
          cache.pKey = "";
          cache.tKey = "";
          cache.sKey = "";
          if (typeof KCP.v2.kickStage === "function") KCP.v2.kickStage(400);
        })
        .catch(() => {});
    } catch (e) { /* 글꼴 API가 없으면 대체 글꼴로 그린다 */ }
  }
  function render(ctx) {
    const g = ctx.g, w = ctx.w, h = ctx.h;
    const S = readState(ctx);
    const pal = palette(ctx.scheme, S.scen);
    const thumb = !!ctx.thumb;
    if (!(w >= 40 && h >= 30)) {
      if (w > 0 && h > 0) {
        g.fillStyle = pal.parch;
        g.fillRect(0, 0, w, h);
      }
      return { caption: caption(S), chips: [], animate: false };
    }
    if (!thumb) hookFonts();
    const chips = thumb ? [] : chipList(S, w, h);
    const L = getLayout(w, h, thumb);
    const still = !!(ctx.reduced || thumb);
    const t = still ? 0 : (isNum(ctx.t) ? ctx.t : 0);
    const zones = thumb ? [] : chipZones(chips, w, h).concat([[0, 0, L.titleR, L.titleB]]);
    if (L.panel) zones.push([L.panel.x - 4, L.panel.y - 4, L.panel.x + L.panel.w + 4, L.panel.y + L.panel.h + 4]);
    if (L.plaque) zones.push([L.plaque.x - 4, L.plaque.y - 4, L.plaque.x + L.plaque.w + 4, L.plaque.y + L.plaque.h + 4]);
    if (S.locked) zones.push([L.seal.x - L.seal.r - 4, L.seal.y - L.seal.r - 4, L.seal.x + L.seal.r + 4, L.seal.y + L.seal.r * 1.5]);
    if (S.shortage > EPS) {
      const q = cutRect(L, S, g);
      zones.push([q.x - 3, q.y - 3, q.x + q.w + 3, q.y + q.h + 3]);
    }
    if (thumb) {
      drawTerrain(g, L, pal);
      drawState(g, L, S, pal);
    } else {
      const dpr = dprOf(g);
      const pKey = [L.sig, dpr, ctx.scheme].join("|");
      if (cache.pKey !== pKey || !cache.pC) {
        const o = layerCanvas(cache.pC, w, h, dpr);
        cache.pC = o.cv;
        drawParchment(o.g, L, pal);
        cache.pKey = pKey;
        cache.tKey = "";
      }
      const tKey = pKey + "|" + S.scen;
      if (cache.tKey !== tKey || !cache.tC) {
        const o = layerCanvas(cache.tC, w, h, dpr);
        cache.tC = o.cv;
        o.g.drawImage(cache.pC, 0, 0, w, h);
        drawTerrain(o.g, L, pal, true);
        cache.tKey = tKey;
        cache.sKey = "";
      }
      const sKey = tKey + "#" + S.key;
      if (cache.sKey !== sKey || !cache.sC) {
        const o = layerCanvas(cache.sC, w, h, dpr);
        cache.sC = o.cv;
        o.g.drawImage(cache.tC, 0, 0, w, h);
        drawState(o.g, L, S, pal);
        cache.sKey = sKey;
      }
      g.drawImage(cache.sC, 0, 0, w, h);
    }
    drawLive(g, L, S, pal, t, still, zones);
    return { caption: caption(S), chips, animate: !still };
  }

  KCP.v2.skin("s-riverdeal", { kicker: "RIVER MAP", title: "은여울강 유역도", render });
})();
