/* 시멘트 공장의 탄소 장부 · 공장 전경(PLANT VIEW)
 * 90년대 초 등각 도시 건설 게임의 화면 문법을 빌린 장면이다. 2:1 마름모 타일 위에 윗면·왼면·오른면의
 * 밝기가 다른 픽셀 건물을 세우고, 준비실의 선택(수요·클링커·연료·포집·행선지·장부 규칙·전환 지원·미래·확정)을
 * 공장 풍경으로 옮긴다. 게임 상태는 읽기만 하며 수치는 게임 모형(model.normalize, model.calc)의 값을 그대로 쓴다.
 * 그리기: 작은 픽셀 버퍼(타일 폭 TW)에 정수 좌표로 칠한 뒤 최근접 보간으로 키운다. 바탕(땅·마을)과 공장은
 * 상태가 바뀔 때만 다시 그리고, 연기·트럭·흐름 점 같은 움직임만 매 프레임 덧그린다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  const ID = "s-cement-carbon";
  const FUT = { smooth: "순조로운 전환", scarce: "원료 부족", delay: "기술 지연" };
  const FUT_SHORT = { smooth: "순조", scarce: "원료 부족", delay: "기술 지연" };
  const CRIT = { sure: "확실한 감축", local: "일자리·지역 경제", price: "가격 부담", risk: "기술 위험 분산", honest: "장부와 실제의 일치" };
  const CRIT_RGB = { sure: [30, 150, 140], local: [226, 124, 40], price: [222, 184, 40], risk: [146, 88, 196], honest: [52, 98, 210] };
  const PLAN0 = { d: 0, c: 80, bio: 0, elec: 0, capture: 0, mineral: 0, syn: 0, acct: 0, support: false };
  const RANGE = { d: [0, 30], c: [50, 80], bio: [0, 40], elec: [0, 30], capture: [0, 90], mineral: [0, 100], syn: [0, 100], acct: [0, 100] };
  const BASE0 = 2 * 0.8 * 0.65 * 44 / 56 + 2 * 0.8 * 3.4 * 0.095;
  const GROUPS = { demand: 1, clinker: 1, fuel: 1, capture: 1, dest: 1, acct: 1, support: 1 };

  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
  const rgb = c => "rgb(" + (clamp(c[0], 0, 255) | 0) + "," + (clamp(c[1], 0, 255) | 0) + "," + (clamp(c[2], 0, 255) | 0) + ")";
  function hash(x, y, s) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  /* ---------- 상태 읽기(읽기 전용) ---------- */
  function read(ctx) {
    const model = ctx.model && typeof ctx.model === "object" ? ctx.model : null;
    let g = null;
    if (model && typeof model.normalize === "function") {
      try { g = model.normalize(ctx.game); } catch (e) { g = null; }
    }
    if (!g || typeof g !== "object") g = ctx.game && typeof ctx.game === "object" ? ctx.game : {};
    const raw = g.plan && typeof g.plan === "object" ? g.plan : {};
    const plan = {};
    Object.keys(PLAN0).forEach(k => {
      const v = raw[k];
      if (k === "support") plan[k] = v === true;
      else plan[k] = typeof v === "number" && isFinite(v) ? clamp(v, RANGE[k][0], RANGE[k][1]) : PLAN0[k];
    });
    if (plan.mineral + plan.syn > 100) plan.mineral = plan.syn = 0;
    const fut = own(FUT, g.fut) ? g.fut : "smooth";
    const step = g.step === 2 ? 2 : 1;
    const locked = !!(g.locked && typeof g.locked === "object");
    const crit = Array.isArray(g.criteria) ? [0, 1].map(i => (own(CRIT, g.criteria[i]) ? g.criteria[i] : "")) : ["", ""];
    const pv = g.prediction && typeof g.prediction === "object" ? g.prediction.value : g.predictDraft;
    const pred = pv === "reach" || pv === "below" ? pv : "";
    let r = null;
    if (model && typeof model.calc === "function") {
      try { r = model.calc(plan, fut); } catch (e) { r = null; }
    }
    if (r && !(isFinite(r.reduction) && isFinite(r.physical) && isFinite(r.C))) r = null;
    const base = model && typeof model.BASE === "number" && isFinite(model.BASE) ? model.BASE : BASE0;
    return { plan, fut, step, locked, crit, pred, r, base, model };
  }

  // 장면에 쓰는 정규화 값. 모형 값이 없으면 계획 값만으로 어림한다.
  function derive(st) {
    const p = st.plan, r = st.r, cap = p.capture / 100;
    const P = r ? r.P : 2 * (1 - p.d / 100);
    const K = r ? r.K : P * p.c / 100;
    const v = {
      P, prod: P / 2, K, kiln: K / 1.6,
      scm: r ? r.scm : Math.min(P * (1 - p.c / 100), 0.45), clay: r ? r.clay : 0,
      bio: p.bio / 100, e: r ? r.e : p.elec / 100, ePlan: p.elec / 100,
      coal: r ? r.coalShare : 1 - p.bio / 100 - p.elec / 100,
      cap, rEff: r ? r.r : cap * 0.9, C: r ? r.C : 0, store: r ? r.store : 0, mineral: r ? r.mineral : 0,
      syn: r ? r.syn : 0, leak: r ? r.leak : 0, overflow: r ? r.overflow : 0,
      stack: r ? r.stack : st.base * (1 - cap * 0.9),
      ledger: r ? r.ledger : null, physical: r ? r.physical : null,
      shares: { store: 100 - p.mineral - p.syn, mineral: p.mineral, syn: p.syn }
    };
    v.smoke = clamp(v.stack / st.base, 0, 1.4);
    v.trucksQ = v.kiln > 0.95 ? 3 : v.kiln > 0.7 ? 2 : 1;
    v.trucksS = v.scm > 0.3 ? 2 : v.scm > 0.05 ? 1 : 0;
    v.silos = v.prod > 0.92 ? 4 : v.prod > 0.8 ? 3 : 2;
    v.absorbers = cap >= 0.9 ? 3 : cap >= 0.6 ? 2 : cap > 0 ? 1 : 0;
    return v;
  }

  /* ---------- 색 ---------- */
  function palette(dark, fut) {
    const dry = fut === "scarce";
    const tone = c => (dark ? [c[0] * 0.36 + 10, c[1] * 0.38 + 14, c[2] * 0.46 + 32] : c);
    const P = {
      dark, fut, tone,
      col: c => rgb(tone(c)),
      face: c => { const t = tone(c); return [rgb(t), rgb(mul(t, 0.8)), rgb(mul(t, 0.6))]; },
      band: c => { const t = tone(c); return [rgb(mul(t, 1.1)), rgb(t), rgb(mul(t, 0.76)), rgb(mul(t, 0.58))]; },
      raw: c => [rgb(mul(c, 1.1)), rgb(c), rgb(mul(c, 0.76)), rgb(mul(c, 0.58))],
      lit: dark ? [rgb([255, 204, 96]), rgb([255, 168, 70]), rgb([70, 66, 64])] : [rgb([62, 82, 104]), rgb([150, 182, 206]), rgb([46, 62, 80])]
    };
    let grass = [[92, 150, 58], [100, 158, 62], [86, 142, 54]];
    if (dry) grass = grass.map(c => mix(c, [176, 160, 86], 0.42));
    P.g = {
      grass: grass.map(tone), grassDk: tone(dry ? [138, 126, 66] : [70, 120, 44]), grassLt: tone(dry ? [196, 180, 112] : [132, 184, 84]),
      pad: [tone([172, 168, 154]), tone([166, 162, 148])], seam: tone([142, 138, 124]),
      dirt: [tone([164, 126, 82]), tone([154, 117, 75])], dirtDk: tone([128, 96, 60]), dirtLt: tone([188, 152, 106]),
      road: tone([88, 90, 96]), roadEdge: tone([124, 126, 132]), dash: dark ? [222, 196, 96] : [238, 214, 110],
      water: [tone([44, 108, 180]), tone([50, 116, 188])], waterLt: tone([112, 168, 224]), foam: tone([212, 234, 250]),
      sand: [tone([222, 204, 150]), tone([212, 194, 140])]
    };
    return P;
  }

  /* ---------- 픽셀 그리기 ---------- */
  function rect(A, x, y, w, h, col) {
    const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + w), y1 = Math.round(y + h);
    if (x1 <= x0 || y1 <= y0) return;
    A.c.fillStyle = col;
    A.c.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  function spanOf(p, yc) {
    let xl = Infinity, xr = -Infinity;
    const n = p.length;
    for (let k = 0; k < n; k += 2) {
      const ax = p[k], ay = p[k + 1], bx = p[(k + 2) % n], by = p[(k + 3) % n];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const x = ax + (yc - ay) * (bx - ax) / (by - ay);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
    }
    return [xl, xr];
  }
  // 볼록 다각형을 행 단위로 칠한다(안티앨리어싱 없음). clip은 같은 행에서 겹치는 구간만 남긴다.
  function poly(A, p, col, clip) {
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 1; k < p.length; k += 2) { if (p[k] < y0) y0 = p[k]; if (p[k] > y1) y1 = p[k]; }
    const ys = Math.max(0, Math.ceil(y0 - 0.5)), ye = Math.min(A.H - 1, Math.floor(y1 - 0.5));
    if (ye < ys) return;
    A.c.fillStyle = col;
    for (let y = ys; y <= ye; y++) {
      const s = spanOf(p, y + 0.5);
      let L = s[0], R = s[1];
      if (clip) { const c = spanOf(clip, y + 0.5); if (c[0] > L) L = c[0]; if (c[1] < R) R = c[1]; }
      if (!(R > L)) continue;
      const a = Math.round(L), b = Math.round(R);
      if (b > a) A.c.fillRect(a, y, b - a, 1);
    }
  }
  function ell(A, cx, cy, rx, ry, col) {
    const ys = Math.ceil(cy - ry - 0.5), ye = Math.floor(cy + ry - 0.5);
    A.c.fillStyle = col;
    for (let y = ys; y <= ye; y++) {
      const t = (y + 0.5 - cy) / ry;
      if (t <= -1 || t >= 1) continue;
      const hw = rx * Math.sqrt(1 - t * t), a = Math.round(cx - hw), b = Math.round(cx + hw);
      if (b > a) A.c.fillRect(a, y, b - a, 1);
    }
  }
  function line(A, x0, y0, x1, y1, col) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    A.c.fillStyle = col;
    for (;;) {
      A.c.fillRect(x0, y0, 1, 1);
      if ((x0 === x1 && y0 === y1) || ++n > 4000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* ---------- 등각 투영 ---------- */
  const PX = (S, i, j) => S.ox + (i - j) * S.hw;
  const PY = (S, i, j, z) => S.oy + (i + j) * S.hh - (z || 0) * S.zh;
  function diamond(S, i, j, si, sj, z) {
    return [PX(S, i, j), PY(S, i, j, z), PX(S, i + si, j), PY(S, i + si, j, z), PX(S, i + si, j + sj), PY(S, i + si, j + sj, z), PX(S, i, j + sj), PY(S, i, j + sj, z)];
  }
  // 상자: f = [윗면, 왼면, 오른면]
  function box(A, S, i, j, si, sj, z0, h, f, clip) {
    const z1 = z0 + h;
    const ax = PX(S, i, j), ay = PY(S, i, j, 0), bx = PX(S, i + si, j), by = PY(S, i + si, j, 0);
    const cx = PX(S, i + si, j + sj), cy = PY(S, i + si, j + sj, 0), dx = PX(S, i, j + sj), dy = PY(S, i, j + sj, 0);
    const zt = z1 * S.zh, zb = z0 * S.zh;
    if (h > 0) {
      if (f[1]) poly(A, [dx, dy - zt, cx, cy - zt, cx, cy - zb, dx, dy - zb], f[1], clip);
      if (f[2]) poly(A, [cx, cy - zt, bx, by - zt, bx, by - zb, cx, cy - zb], f[2], clip);
    }
    if (f[0]) poly(A, [ax, ay - zt, bx, by - zt, cx, cy - zt, dx, dy - zt], f[0], clip);
  }
  // 왼면(j = j+sj)과 오른면(i = i+si)의 창 격자. colFn(a, b)가 null이면 건너뛴다.
  function winL(A, S, i, j, si, sj, z0, h, nx, ny, colFn, fw, fh) {
    const J = j + sj, w = fw || 0.5, hh = fh || 0.45;
    for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
      const col = colFn(a, b);
      if (!col) continue;
      const i0 = i + si * (a + 0.5 - w / 2) / nx, i1 = i + si * (a + 0.5 + w / 2) / nx;
      const za = z0 + h * (b + 0.5 - hh / 2) / ny, zb = z0 + h * (b + 0.5 + hh / 2) / ny;
      poly(A, [PX(S, i0, J), PY(S, i0, J, zb), PX(S, i1, J), PY(S, i1, J, zb), PX(S, i1, J), PY(S, i1, J, za), PX(S, i0, J), PY(S, i0, J, za)], col);
    }
  }
  function winR(A, S, i, j, si, sj, z0, h, nx, ny, colFn, fw, fh) {
    const I = i + si, w = fw || 0.5, hh = fh || 0.45;
    for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
      const col = colFn(a, b);
      if (!col) continue;
      const j0 = j + sj * (a + 0.5 - w / 2) / nx, j1 = j + sj * (a + 0.5 + w / 2) / nx;
      const za = z0 + h * (b + 0.5 - hh / 2) / ny, zb = z0 + h * (b + 0.5 + hh / 2) / ny;
      poly(A, [PX(S, I, j1), PY(S, I, j1, zb), PX(S, I, j0), PY(S, I, j0, zb), PX(S, I, j0), PY(S, I, j0, za), PX(S, I, j1), PY(S, I, j1, za)], col);
    }
  }
  // 세운 원기둥: f = [밝음, 중간, 어두움, 가장 어두움], cap = 윗면
  function cyl(A, S, i, j, r, z0, h, f, cap) {
    const cx = PX(S, i, j), base = PY(S, i, j, z0), top = PY(S, i, j, z0 + h);
    const rx = Math.max(0.75, r * Math.SQRT2 * S.hw), ry = rx / 2;
    for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
      const t = (x + 0.5 - cx) / rx;
      if (t <= -1 || t >= 1) continue;
      const y0 = Math.round(top), y1 = Math.round(base + Math.sqrt(1 - t * t) * ry);
      if (y1 <= y0) continue;
      A.c.fillStyle = t < -0.45 ? f[0] : t < 0.15 ? f[1] : t < 0.62 ? f[2] : f[3];
      A.c.fillRect(x, y0, 1, y1 - y0);
    }
    if (cap) ell(A, cx, top, rx, ry, cap);
    return { cx, top, rx, ry };
  }
  // 원기둥 둘레의 띠(색 줄무늬)
  function ring(A, c, yTop, yBot, f) {
    for (let x = Math.floor(c.cx - c.rx); x < Math.ceil(c.cx + c.rx); x++) {
      const t = (x + 0.5 - c.cx) / c.rx;
      if (t <= -1 || t >= 1) continue;
      const e = Math.sqrt(1 - t * t) * c.ry;
      A.c.fillStyle = t < -0.45 ? f[0] : t < 0.15 ? f[1] : t < 0.62 ? f[2] : f[3];
      A.c.fillRect(x, Math.round(yTop + e), 1, Math.max(1, Math.round(yBot - yTop)));
    }
  }
  // 원뿔 더미(석회석·석탄·바이오·혼합재·점토)
  function pile(A, S, i, j, r, hgt, f, seed, speck) {
    if (r <= 0.04) return;
    const cx = PX(S, i, j), cy = PY(S, i, j, 0);
    const rx = r * Math.SQRT2 * S.hw, ry = rx / 2, hz = Math.max(1, hgt * S.zh);
    for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
      const t = (x + 0.5 - cx) / rx;
      if (t <= -1 || t >= 1) continue;
      const top = Math.round(cy - hz * (1 - Math.pow(Math.abs(t), 1.35)) - ry * 0.25 * Math.sqrt(1 - t * t));
      const bot = Math.round(cy + Math.sqrt(1 - t * t) * ry);
      if (bot <= top) continue;
      A.c.fillStyle = t < -0.3 ? f[0] : t < 0.28 ? f[1] : f[2];
      A.c.fillRect(x, top, 1, bot - top);
      if (speck) for (let y = top + 1; y < bot; y++) {
        const hsh = hash(x, y, seed);
        if (hsh < 0.09) { A.c.fillStyle = speck[0]; A.c.fillRect(x, y, 1, 1); }
        else if (hsh > 0.95) { A.c.fillStyle = speck[1]; A.c.fillRect(x, y, 1, 1); }
      }
    }
  }
  // 축을 따라 놓인 관(i 방향 또는 j 방향). pts = [[i,j,z], ...], w = 화면 두께(px)
  function pipe(A, S, pts, w, hi, lo) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      let xa = PX(S, a[0], a[1]), ya = PY(S, a[0], a[1], a[2]), xb = PX(S, b[0], b[1]), yb = PY(S, b[0], b[1], b[2]);
      if (Math.abs(xb - xa) < 0.5) {
        rect(A, xa - w / 2, Math.min(ya, yb) - w / 2, w, Math.abs(yb - ya) + w, lo);
        rect(A, xa - w / 2, Math.min(ya, yb) - w / 2, Math.max(1, w / 2), Math.abs(yb - ya) + w, hi);
        continue;
      }
      if (xb < xa) { let t = xa; xa = xb; xb = t; t = ya; ya = yb; yb = t; }
      for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
        const s = clamp((x + 0.5 - xa) / (xb - xa), 0, 1), yc = ya + (yb - ya) * s;
        const y0 = Math.round(yc - w / 2), y1 = Math.round(yc + w / 2), m = Math.round(yc);
        if (y1 <= y0) continue;
        A.c.fillStyle = lo; A.c.fillRect(x, y0, 1, y1 - y0);
        if (m > y0) { A.c.fillStyle = hi; A.c.fillRect(x, y0, 1, m - y0); }
      }
    }
  }

  /* ---------- 배치: 타일 좌표 i, j(화면 가로 u = i - j, 깊이 v = i + j) ----------
   * 얕고 긴 띠(v -5~5)에 왼쪽부터 마을 · 석회석 광산 · 원료 마당 · 예열탑과 회전 가마 · 포집 설비 · CO₂ 배관과
   * 세 행선지 · 바다(저장)를 늘어놓는다. */
  const LAY = {
    quarry: { i: -9.4, j: 4.4, si: 4.4, sj: 3.4 },
    crusher: { i: -4.7, j: 1.7, si: 1.3, sj: 1.1, h: 1.1 },
    lime: { i: -2.3, j: 2.4 },
    scm: { i: -3.6, j: 6.0 },
    clay: { i: -1.8, j: 6.2 },
    calciner: { i: -2.9, j: 4.1, si: 1.2, sj: 0.8 },
    tower: { i: -4, j: -1.4, si: 2, sj: 2 },
    stack: { i: -0.9, j: -1.75, r: 0.3, h: 3.3 },
    kiln: { i0: -2, i1: 3, j: -0.4, z0: 1.05, z1: 0.8, r: 0.4 },
    hood: { i: 3, j: -1.2, si: 1.5, sj: 1.6, h: 1.4 },
    sub: { i: -0.6, j: 0.9, si: 1.4, sj: 0.9 },
    bio: { i: 1.7, j: 2.7 }, coal: { i: 2.9, j: 1.8 },
    billboard: { i: 0.65, j: 4.05 },
    silos: { i: 5.0, j: [-3.6, -2.7, -1.8, -0.9] },
    cap: { i: -1.1, j: -5.0, si: 3.6, sj: 2.4 },
    M: { i: 3.4, j: -5.0 },
    syn: { i: 3.0, j: -8.8, si: 2.4, sj: 1.8 },
    mineral: { i: 6.6, j: -6.0, si: 1.8, sj: 1.6 },
    training: { i: 6.4, j: -4.2, si: 1.6, sj: 1.2 },
    platform: { i: 10.3, j: -7.4 },
    coast: 15
  };
  // 화면 범위: 가로 u, 세로 y = v/2 - z(타일 높이 단위)
  const WIDE = { u0: -22.2, u1: 22.2, y0: -5.9, y1: 2.5 };
  const CROP = { u0: -9.0, u1: 18.4, y0: -5.9, y1: 2.5 };
  // 나무를 심지 않을 자리 [i0, i1, j0, j1]
  const OCC = [[-1, 3.6, 0.6, 5.2], [-6, -0.5, 3.4, 8.2], [9.4, 11.2, -8.4, -6.4]];

  function terrainFn(L) {
    return (ti, tj) => {
      const u = ti - tj, v = ti + tj;
      const coast = L.coast + (hash(v, 0, 31) < 0.3 ? 1 : 0);
      if (u >= coast) return 6;
      if (u >= coast - 1) return 7;
      for (let k = 0; k < L.roads.length; k++) {
        const r = L.roads[k];
        if (ti >= r[0] && ti < r[1] && tj >= r[2] && tj < r[3]) return r[4];
      }
      for (let k = 0; k < L.pads.length; k++) {
        const r = L.pads[k];
        if (ti >= r[0] && ti < r[1] && tj >= r[2] && tj < r[3]) return 1;
      }
      for (let k = 0; k < L.dirt.length; k++) {
        const r = L.dirt[k];
        if (ti >= r[0] && ti < r[1] && tj >= r[2] && tj < r[3]) return 5;
      }
      if (u < -16.5) {
        if (((ti % 4) + 4) % 4 === 0) return 2;
        if (((tj % 4) + 4) % 4 === 2) return 3;
      }
      return 0;
    };
  }
  const WORLD = {
    coast: LAY.coast,
    pads: [[-5, 9, -9, 1], [-1, 4, 1, 4]],
    roads: [[-17, -1, 3, 4, 2]],
    dirt: [[-10, -4, 4, 9], [-5, -1, 4, 8]]
  };
  WORLD.terrain = terrainFn(WORLD);

  /* ---------- 바탕: 땅(픽셀 단위) ---------- */
  // 보이는 범위의 타일 종류를 한 번만 계산하고, 픽셀은 32비트 정수로 바로 쓴다(다시 그리는 비용을 줄인다).
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const NOISE = (() => { const a = new Uint8Array(4096); for (let k = 0; k < 4096; k++) a[k] = (hash(k & 63, k >> 6, 5) * 256) | 0; return a; })();
  const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  function pack(c) {
    const r = clamp(Math.round(c[0]), 0, 255), g = clamp(Math.round(c[1]), 0, 255), b = clamp(Math.round(c[2]), 0, 255);
    return (LE ? ((255 << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | 255)) >>> 0;
  }
  // 가로등 빛: 픽셀 값을 바로 밝힌다(배열을 만들지 않는다).
  function LIGHT(v) {
    const r = LE ? v & 255 : v >>> 24, g = LE ? (v >>> 8) & 255 : (v >>> 16) & 255, b = LE ? (v >>> 16) & 255 : (v >>> 8) & 255;
    const R = Math.min(255, (r * 1.35 + 34) | 0), G = Math.min(255, (g * 1.28 + 26) | 0), B = Math.min(255, (b * 1.05 + 6) | 0);
    return (LE ? ((255 << 24) | (B << 16) | (G << 8) | R) : ((R << 24) | (G << 16) | (B << 8) | 255)) >>> 0;
  }
  function paintGround(A, S, Pal, lamps, view) {
    const W = A.W, H = A.H, img = A.c.createImageData(W, H), px = new Uint32Array(img.data.buffer), G = Pal.g, terr = WORLD.terrain;
    const i0 = view.i0, j0 = view.j0, ni = view.i1 - i0 + 1, nj = view.j1 - j0 + 1;
    const type = new Int8Array(ni * nj), vari = new Uint8Array(ni * nj), flag = new Uint8Array(ni * nj);
    for (let a = 0; a < ni; a++) for (let b = 0; b < nj; b++) {
      const ti = i0 + a, tj = j0 + b, t = terr(ti, tj), k = a * nj + b;
      type[k] = t;
      vari[k] = (hash(ti, tj, t + 1) * 3) | 0;
      if (t === 6) flag[k] = (terr(ti - 1, tj) !== 6 ? 1 : 0) | (terr(ti, tj + 1) !== 6 ? 2 : 0) | (hash(ti, tj, 6) > 0.55 ? 4 : 0);
    }
    const two = (c, e) => [pack(c), pack(mul(c, e))];
    const grass = G.grass.map(c => two(c, 0.94)), grassDk = two(G.grassDk, 0.94), grassLt = two(G.grassLt, 0.94);
    const pad = G.pad.map(c => two(c, 0.88)), seam = two(G.seam, 0.88);
    const dirt = G.dirt.map(c => two(c, 0.94)), dirtDk = two(G.dirtDk, 0.94), dirtLt = two(G.dirtLt, 0.94);
    const road = pack(G.road), roadEdge = pack(G.roadEdge), dash = pack(G.dash);
    const water = G.water.map(pack), waterLt = pack(G.waterLt), foam = pack(G.foam), sand = G.sand.map(c => two(c, 0.94));
    const e = 0.8 / S.hw, step = 0.5 / S.hw;
    for (let y = 0; y < H; y++) {
      const wy = (y + 0.5 - S.oy) / S.hh, wx = (0.5 - S.ox) / S.hw, row = y * W, nrow = (y & 63) << 6;
      let fi = (wx + wy) / 2, fj = (wy - wx) / 2;
      for (let x = 0; x < W; x++, fi += step, fj -= step) {
        const ti = Math.floor(fi), tj = Math.floor(fj), ui = fi - ti, uj = fj - tj, a = ti - i0, b = tj - j0;
        const k = a >= 0 && a < ni && b >= 0 && b < nj ? a * nj + b : -1;
        const t = k < 0 ? 0 : type[k], v = k < 0 ? 0 : vari[k], n = NOISE[nrow | (x & 63)], ed = ui < e || uj < e ? 1 : 0;
        let c;
        if (t === 0) c = (n < 18 ? grassDk : n > 247 ? grassLt : grass[v])[ed];
        else if (t === 1) c = (n < 8 ? seam : pad[v & 1])[ed];
        else if (t === 2 || t === 3) {
          const p = t === 2 ? uj : ui, q = t === 2 ? ui : uj;
          c = p < 0.1 || p > 0.9 ? roadEdge : Math.abs(p - 0.5) < 0.05 && ((q * 4) | 0) % 2 === 0 ? dash : road;
        } else if (t === 5) c = (n < 26 ? dirtDk : n > 243 ? dirtLt : dirt[v & 1])[ed];
        else if (t === 6) {
          const f = k < 0 ? 0 : flag[k];
          c = (f & 1) && ui < 0.12 ? foam : (f & 2) && uj > 0.9 ? foam : (f & 4) && Math.abs(uj - 0.35) < 0.045 && ui > 0.25 && ui < 0.6 ? waterLt : water[v & 1];
        } else c = sand[v & 1][ed];
        px[row + x] = c;
      }
    }
    // 밤: 가로등 불빛을 4×4 디더로 번지게 한다.
    (lamps || []).forEach(L => {
      const r = L[2], ya = Math.max(0, Math.floor(L[1] - r / 2)), yb = Math.min(H - 1, Math.ceil(L[1] + r / 2)), xa = Math.max(0, Math.floor(L[0] - r)), xb = Math.min(W - 1, Math.ceil(L[0] + r));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const dx = x - L[0], dy = (y - L[1]) * 2, q = (dx * dx + dy * dy) / (r * r);
        if (!(q < 1 && (1 - q) * 16 > BAYER[(y & 3) * 4 + (x & 3)])) continue;
        px[y * W + x] = LIGHT(px[y * W + x]);
      }
    });
    A.c.putImageData(img, 0, 0);
  }

  /* ---------- 마을과 나무(가장자리 채움) ---------- */
  function tree(A, S, Pal, i, j, s, seed) {
    const cx = PX(S, i, j), cy = PY(S, i, j, 0), r = Math.max(1.5, S.hw * 0.4 * s);
    const leaf = [[54, 120, 50], [38, 96, 40], [96, 164, 72]].map(c => rgb(Pal.tone(c)));
    rect(A, cx - 0.5, cy - r * 0.8, 1, r * 0.8 + 1, Pal.col([96, 70, 44]));
    ell(A, cx, cy - r * 1.15, r, r * 0.9, leaf[0]);
    ell(A, cx + r * 0.3, cy - r * 1.0, r * 0.65, r * 0.6, leaf[1]);
    if (r > 2.5) ell(A, cx - r * 0.35, cy - r * 1.45, r * 0.38, r * 0.3, leaf[2]);
    if (hash(seed, 3, 9) > 0.5 && r > 2.5) rect(A, cx - r * 0.5, cy - r * 1.2, 1, 1, leaf[2]);
  }
  function house(A, S, Pal, i, j, seed) {
    const roofs = [[184, 64, 48], [70, 96, 168], [96, 128, 72], [150, 110, 70]];
    const roof = roofs[(hash(seed, 1, 2) * roofs.length) | 0], wall = Pal.face([226, 220, 204]);
    const big = hash(seed, 5, 5) > 0.82;
    const si = big ? 0.8 : 0.72, sj = 0.72, i0 = i + 0.14, j0 = j + 0.14, h = big ? 1.1 : 0.42, rh = big ? 0.12 : 0.32;
    box(A, S, i0, j0, si, sj, 0, h, [null, wall[1], wall[2]]);
    const jm = j0 + sj / 2, zt = h + rh, rf = Pal.face(big ? [120, 120, 126] : roof);
    if (big) {
      box(A, S, i0, j0, si, sj, h, rh, rf);
      winL(A, S, i0, j0, si, sj, 0, h, 2, 3, () => (Pal.dark && hash(seed, 7, 3) > 0.3 ? Pal.lit[0] : Pal.lit[2]), 0.5, 0.45);
      winR(A, S, i0, j0, si, sj, 0, h, 2, 3, () => (Pal.dark && hash(seed, 9, 3) > 0.4 ? Pal.lit[1] : Pal.lit[2]), 0.5, 0.45);
      return;
    }
    poly(A, [PX(S, i0, jm), PY(S, i0, jm, zt), PX(S, i0 + si, jm), PY(S, i0 + si, jm, zt), PX(S, i0 + si, j0 + sj), PY(S, i0 + si, j0 + sj, h), PX(S, i0, j0 + sj), PY(S, i0, j0 + sj, h)], rf[1]);
    poly(A, [PX(S, i0, j0), PY(S, i0, j0, h), PX(S, i0 + si, j0), PY(S, i0 + si, j0, h), PX(S, i0 + si, jm), PY(S, i0 + si, jm, zt), PX(S, i0, jm), PY(S, i0, jm, zt)], rf[0]);
    poly(A, [PX(S, i0 + si, j0), PY(S, i0 + si, j0, h), PX(S, i0 + si, jm), PY(S, i0 + si, jm, zt), PX(S, i0 + si, j0 + sj), PY(S, i0 + si, j0 + sj, h)], wall[2]);
    const lit = Pal.dark && hash(seed, 7, 1) > 0.35;
    winL(A, S, i0, j0, si, sj, 0, h, 2, 1, () => (lit ? Pal.lit[0] : Pal.lit[2]), 0.45, 0.5);
  }
  function occupied(ti, tj) {
    const ci = ti + 0.5, cj = tj + 0.5;
    for (let k = 0; k < OCC.length; k++) { const r = OCC[k]; if (ci > r[0] && ci < r[1] && cj > r[2] && cj < r[3]) return true; }
    return false;
  }
  function filler(S, Pal, view, items) {
    const terr = WORLD.terrain;
    for (let ti = view.i0; ti <= view.i1; ti++) for (let tj = view.j0; tj <= view.j1; tj++) {
      const u = ti - tj, v = ti + tj;
      if (v < view.v0 || v > view.v1 || u < view.u0 || u > view.u1) continue;
      if (terr(ti, tj) !== 0 || occupied(ti, tj)) continue;
      const hsh = hash(ti, tj, 77);
      if (u > -16.5) {
        if (hsh < 0.34) items.push({ d: v + 1, f: A => tree(A, S, Pal, ti + 0.5, tj + 0.5, 0.8 + hsh, ti * 31 + tj) });
        continue;
      }
      if (hsh < 0.45) items.push({ d: v + 1, f: A => house(A, S, Pal, ti, tj, ti * 131 + tj) });
      else if (hsh < 0.8) items.push({ d: v + 1, f: A => tree(A, S, Pal, ti + 0.5, tj + 0.5, 0.75 + (hsh - 0.45), ti * 17 + tj) });
    }
  }

  /* ---------- 공장 ---------- */
  function lot(A, S, Pal, i, j, si, sj) {
    poly(A, diamond(S, i, j, si, sj, 0), Pal.col([186, 168, 128]));
    for (let a = 0; a < 4; a++) {
      const ii = i + (a % 2) * si, jj = j + (a >> 1) * sj;
      rect(A, PX(S, ii, jj), PY(S, ii, jj, 0.3), 1, 0.3 * S.zh, Pal.col([214, 184, 132]));
      rect(A, PX(S, ii, jj), PY(S, ii, jj, 0.3), Math.max(2, S.hw * 0.18), 1, Pal.col([226, 84, 60]));
    }
  }
  const mid = (o) => o.i + o.si / 2 + o.j + o.sj / 2;
  // mode "static": 상태와 무관한 설비(광산·파쇄기·컨베이어·예열탑·가마 몸체·가마 머리·해안 둑), "state": 나머지
  function buildPlant(S, Pal, st, vis, items, meta, mode) {
    const p = st.plan, dark = Pal.dark, delay = st.fut === "delay", scarce = st.fut === "scarce";
    const conc = Pal.face([222, 216, 202]), steel = Pal.face([168, 180, 192]), teal = Pal.face([62, 170, 160]);
    const tealBand = Pal.band([62, 170, 160]), steelBand = Pal.band([176, 186, 196]), whiteBand = Pal.band([236, 232, 222]);
    const win = seed => (a, b) => (dark ? (hash(a + seed, b, 3) > 0.3 ? Pal.lit[0] : Pal.lit[2]) : Pal.lit[0]);
    const reg = (g, r) => { (meta.groups[g] = meta.groups[g] || []).push(r); };
    const add = (d, f, stat) => { if ((mode === "static") === !!stat) items.push({ d, f }); };

    // 석회석 광산(계단식 채굴장): 땅보다 낮으니 맨 먼저 그린다.
    const q = LAY.quarry;
    reg("demand", [q.i, q.j, q.si, q.sj]);
    add(-60, A => {
      const rim = diamond(S, q.i, q.j, q.si, q.sj, 0), lime = Pal.face([216, 208, 186]);
      const strata = Pal.col([190, 180, 154]), floor = Pal.col([200, 192, 168]);
      const levels = 3, dz = 0.34, ins = Math.min(q.si, q.sj) * 0.15;
      for (let k = 0; k < levels; k++) {
        const i0 = q.i + ins * k, j0 = q.j + ins * k, si = q.si - 2 * ins * k, sj = q.sj - 2 * ins * k, zt = -dz * k, zb = -dz * (k + 1);
        const a = [PX(S, i0, j0), PY(S, i0, j0, zt)], b = [PX(S, i0 + si, j0), PY(S, i0 + si, j0, zt)], c = [PX(S, i0, j0 + sj), PY(S, i0, j0 + sj, zt)], dzp = dz * S.zh;
        poly(A, [a[0], a[1], b[0], b[1], b[0], b[1] + dzp, a[0], a[1] + dzp], lime[1], rim);
        poly(A, [a[0], a[1], c[0], c[1], c[0], c[1] + dzp, a[0], a[1] + dzp], lime[2], rim);
        if (dzp >= 4) poly(A, [a[0], a[1] + dzp * 0.5, b[0], b[1] + dzp * 0.5, b[0], b[1] + dzp * 0.5 + 1, a[0], a[1] + dzp * 0.5 + 1], strata, rim);
        poly(A, diamond(S, i0, j0, si, sj, zb), k === levels - 1 ? floor : lime[0], rim);
      }
      const fi = q.i + ins * 3, fj = q.j + ins * 3, z = -dz * levels;
      poly(A, diamond(S, fi + 0.2, fj + 0.25, 0.9, 0.6, z), Pal.col([86, 140, 170]), rim);
      const ex = Pal.face([236, 186, 48]);
      box(A, S, fi + 1.5, fj + 0.4, 0.5, 0.4, z, 0.3, ex, rim);
      line(A, PX(S, fi + 1.5, fj + 0.6), PY(S, fi + 1.5, fj + 0.6, z + 0.3), PX(S, fi + 1.1, fj + 0.3), PY(S, fi + 1.1, fj + 0.3, z + 0.6), ex[2]);
      // 경사로(뒤쪽 벽을 따라 올라와 도로로 나간다)
      poly(A, [PX(S, q.i + q.si * 0.62, q.j), PY(S, q.i + q.si * 0.62, q.j, 0), PX(S, q.i + q.si * 0.8, q.j), PY(S, q.i + q.si * 0.8, q.j, 0),
        PX(S, q.i + q.si * 0.8, q.j + ins * 2), PY(S, q.i + q.si * 0.8, q.j + ins * 2, -dz * 2), PX(S, q.i + q.si * 0.62, q.j + ins * 2), PY(S, q.i + q.si * 0.62, q.j + ins * 2, -dz * 2)], Pal.col([200, 190, 164]), rim);
    }, true);

    // 파쇄기와 석회석 더미(클링커 물량)
    const cr = LAY.crusher;
    add(mid(cr), A => {
      const shed = Pal.face([150, 160, 170]);
      box(A, S, cr.i, cr.j, cr.si, cr.sj, 0, cr.h, shed);
      winL(A, S, cr.i, cr.j, cr.si, cr.sj, 0, cr.h, 2, 2, win(11), 0.45, 0.35);
      box(A, S, cr.i + 0.35, cr.j + 0.25, 0.55, 0.55, cr.h, 0.35, Pal.face([180, 190, 198]));
    }, true);
    add(LAY.lime.i + LAY.lime.j + 0.4, A => {
      const s = clamp(vis.kiln, 0, 1.2);
      pile(A, S, LAY.lime.i, LAY.lime.j, 0.5 + 0.3 * s, 0.45 + 0.4 * s, Pal.face([224, 218, 198]), 3, [Pal.col([190, 182, 160]), Pal.col([244, 240, 228])]);
    });
    // 원료 이송 경사 컨베이어(파쇄기 → 예열탑 꼭대기)
    add(-1.2, A => {
      const I = -3.75, gz0 = cr.h + 0.05, gz1 = 2.9, j0 = cr.j, j1 = LAY.tower.j + LAY.tower.sj, w = 0.28;
      const leg = Pal.col(dark ? [96, 104, 114] : [110, 116, 124]);
      for (let k = 1; k <= 2; k++) { const jj = j0 + (j1 - j0) * k / 3, zz = gz0 + (gz1 - gz0) * k / 3; rect(A, PX(S, I + w / 2, jj), PY(S, I + w / 2, jj, zz), 1, zz * S.zh, leg); }
      poly(A, [PX(S, I + w, j0), PY(S, I + w, j0, gz0), PX(S, I + w, j1), PY(S, I + w, j1, gz1), PX(S, I + w, j1), PY(S, I + w, j1, gz1 - 0.28), PX(S, I + w, j0), PY(S, I + w, j0, gz0 - 0.28)], Pal.col([140, 150, 160]));
      poly(A, [PX(S, I, j0), PY(S, I, j0, gz0), PX(S, I, j1), PY(S, I, j1, gz1), PX(S, I + w, j1), PY(S, I + w, j1, gz1), PX(S, I + w, j0), PY(S, I + w, j0, gz0)], Pal.col([190, 198, 206]));
    }, true);

    // 클링커 대체 원료: 기존 혼합재(공급 한도), 소성 점토와 점토 소성로
    reg("clinker", [LAY.scm.i - 1, LAY.scm.j - 1, 2, 2]);
    reg("clinker", [LAY.clay.i - 0.9, LAY.clay.j - 0.9, 1.8, 1.8]);
    reg("clinker", [LAY.calciner.i, LAY.calciner.j, LAY.calciner.si, LAY.calciner.sj]);
    add(LAY.scm.i + LAY.scm.j, A => {
      const s = clamp(vis.scm / 0.45, 0, 1), sc = LAY.scm;
      box(A, S, sc.i - 0.95, sc.j - 0.95, 1.9, 0.14, 0, 0.32, conc);
      box(A, S, sc.i - 0.95, sc.j - 0.95, 0.14, 1.9, 0, 0.32, conc);
      if (s > 0.02) pile(A, S, sc.i, sc.j, 0.22 + 0.62 * Math.sqrt(s), 0.18 + 0.62 * Math.sqrt(s), Pal.face([150, 154, 160]), 5, [Pal.col([118, 122, 128]), Pal.col([196, 200, 206])]);
      if (scarce) {
        // 원료 부족: 노란 경고 표지판
        const x = PX(S, sc.i + 0.9, sc.j - 0.9), y = PY(S, sc.i + 0.9, sc.j - 0.9, 0), hgt = S.zh * 1.1, sz = Math.max(3, Math.round(S.hw * 0.42));
        rect(A, x, y - hgt, 1, hgt, Pal.col([90, 90, 96]));
        poly(A, [x + 0.5, y - hgt - sz, x + 0.5 + sz, y - hgt, x + 0.5, y - hgt + sz, x + 0.5 - sz, y - hgt], rgb(dark ? [214, 170, 40] : [250, 204, 40]));
        rect(A, x, y - hgt - sz * 0.5, 1, sz * 0.6, rgb([30, 24, 10]));
        rect(A, x, y - hgt + sz * 0.3, 1, 1, rgb([30, 24, 10]));
      }
    });
    add(LAY.clay.i + LAY.clay.j, A => {
      const s = clamp(vis.clay / 0.35, 0, 1);
      if (s > 0.02) pile(A, S, LAY.clay.i, LAY.clay.j, 0.28 + 0.55 * Math.sqrt(s), 0.24 + 0.5 * Math.sqrt(s), Pal.face([196, 108, 66]), 6, [Pal.col([160, 82, 48]), Pal.col([224, 150, 108])]);
    });
    add(mid(LAY.calciner), A => {
      const k = LAY.calciner;
      if (vis.clay > 0.005) {
        box(A, S, k.i, k.j, k.si, k.sj, 0, 0.6, Pal.face([176, 120, 92]));
        const c = cyl(A, S, k.i + 1.0, k.j + 0.25, 0.11, 0.6, 1.2, steelBand, Pal.col([60, 60, 64]));
        meta.calTop = [c.cx, c.top - 1];
        winL(A, S, k.i, k.j, k.si, k.sj, 0, 0.6, 3, 1, win(5), 0.4, 0.4);
      } else lot(A, S, Pal, k.i, k.j, k.si, k.sj);
    });

    // 굴뚝(빨강·흰 띠)과 예열탑
    const T = LAY.tower, sk = LAY.stack;
    add(sk.i + sk.j + 0.4, A => {
      box(A, S, sk.i - 0.42, sk.j - 0.42, 0.84, 0.84, 0, 0.3, conc);
      const c = cyl(A, S, sk.i, sk.j, sk.r, 0.3, sk.h, whiteBand, Pal.col([70, 70, 74]));
      const red = Pal.band([200, 56, 44]);
      for (let k = 0; k < 2; k++) {
        const zb = 0.3 + sk.h * (0.74 + k * 0.14), zt = zb + sk.h * 0.07;
        ring(A, c, PY(S, sk.i, sk.j, zt), PY(S, sk.i, sk.j, zb), red);
      }
      ell(A, c.cx, c.top, c.rx, c.ry, Pal.col([40, 40, 44]));
      meta.stackTop = [c.cx, c.top - 1];
    });
    add(mid(T) + 0.2, A => {
      box(A, S, T.i, T.j, T.si, T.sj, 0, 0.6, conc);
      const fi = T.i + 0.15, fj = T.j + 0.15, fs = T.si - 0.3, top = 3.0;
      box(A, S, fi, fj, fs, fs, 0.6, top - 0.6, Pal.face([150, 158, 168]));
      const beam = Pal.col(dark ? [110, 118, 128] : [204, 210, 216]), beam2 = Pal.col(dark ? [80, 86, 94] : [150, 156, 164]);
      for (let z = 1.15; z < top; z += 0.55) {
        poly(A, [PX(S, fi, fj + fs), PY(S, fi, fj + fs, z), PX(S, fi + fs, fj + fs), PY(S, fi + fs, fj + fs, z), PX(S, fi + fs, fj + fs), PY(S, fi + fs, fj + fs, z - 0.07), PX(S, fi, fj + fs), PY(S, fi, fj + fs, z - 0.07)], beam);
        poly(A, [PX(S, fi + fs, fj + fs), PY(S, fi + fs, fj + fs, z), PX(S, fi + fs, fj), PY(S, fi + fs, fj, z), PX(S, fi + fs, fj), PY(S, fi + fs, fj, z - 0.07), PX(S, fi + fs, fj + fs), PY(S, fi + fs, fj + fs, z - 0.07)], beam2);
      }
      winL(A, S, fi, fj, fs, fs, 0.6, top - 0.6, 3, 4, win(21), 0.3, 0.3);
      winR(A, S, fi, fj, fs, fs, 0.6, top - 0.6, 3, 4, win(29), 0.3, 0.3);
      const cyc = Pal.band([206, 196, 176]);
      [[0.45, 1.1], [1.25, 1.1], [0.45, 2.15], [1.25, 2.15]].forEach(([a, z]) => {
        const ci = fi + a, cj = fj + fs + 0.22;
        const c = cyl(A, S, ci, cj, 0.22, z, 0.5, cyc, cyc[1]);
        const yb = PY(S, ci, cj, z) + c.ry, tip = PY(S, ci, cj, z - 0.42);
        for (let y = Math.round(yb); y < Math.round(tip); y++) {
          const hw = c.rx * (1 - (y - yb) / (tip - yb));
          rect(A, c.cx - hw, y, hw, 1, cyc[1]);
          rect(A, c.cx, y, hw, 1, cyc[2]);
        }
      });
      box(A, S, fi - 0.05, fj - 0.05, fs + 0.1, fs + 0.1, top, 0.14, Pal.face([132, 138, 148]));
      // 배기 덕트: 탑 꼭대기 → 굴뚝
      const dw = Math.max(2, S.hh * 0.55), zd = top - 0.25;
      pipe(A, S, [[fi + fs, fj + 0.45, zd], [sk.i - 0.25, fj + 0.45, zd], [sk.i - 0.25, sk.j + 0.25, zd]], dw, steel[0], steel[2]);
    }, true);

    // 회전 가마(긴 원통), 받침, 타이어, 전기 가열 코일
    const K = LAY.kiln;
    reg("fuel", [K.i0, K.j - 0.5, K.i1 - K.i0, 1.0]);
    const kx0 = PX(S, K.i0, K.j), ky0 = PY(S, K.i0, K.j, K.z0), kx1 = PX(S, K.i1, K.j), ky1 = PY(S, K.i1, K.j, K.z1), kth = K.r * S.zh * 1.15;
    meta.kiln = { x0: kx0, y0: ky0, x1: kx1, y1: ky1, th: kth };
    const kilnPart = (s0, s1) => {
      const depth = K.i0 + (K.i1 - K.i0) * (s0 + s1) / 2 + K.j + 0.6;
      add(depth, A => {
        const shell = dark ? Pal.raw([132, 70, 42]) : Pal.band([200, 116, 70]), tire = Pal.band([92, 92, 98]);
        [0.16, 0.5, 0.84].forEach(s => {
          if (s < s0 || s >= s1) return;
          const ii = K.i0 + (K.i1 - K.i0) * s, zz = K.z0 + (K.z1 - K.z0) * s - K.r * 0.9;
          box(A, S, ii - 0.18, K.j - 0.28, 0.36, 0.56, 0, zz, conc);
        });
        for (let x = Math.floor(kx0 + (kx1 - kx0) * s0); x < Math.ceil(kx0 + (kx1 - kx0) * s1); x++) {
          const s = (x + 0.5 - kx0) / (kx1 - kx0);
          if (s < s0 || s > s1) continue;
          const yc = ky0 + (ky1 - ky0) * s, ya = Math.round(yc - kth), yb = Math.round(yc + kth), m1 = Math.round(yc - kth * 0.35), m2 = Math.round(yc + kth * 0.45);
          A.c.fillStyle = shell[0]; A.c.fillRect(x, ya, 1, m1 - ya);
          A.c.fillStyle = shell[1]; A.c.fillRect(x, m1, 1, m2 - m1);
          A.c.fillStyle = shell[3]; A.c.fillRect(x, m2, 1, yb - m2);
        }
        [0.16, 0.5, 0.84].forEach(s => {
          if (s < s0 || s >= s1) return;
          const xc = kx0 + (kx1 - kx0) * s, yc = ky0 + (ky1 - ky0) * s, tw = Math.max(1, S.hw * 0.12);
          rect(A, xc - tw, yc - kth - 1, tw, kth * 2 + 2, tire[1]);
          rect(A, xc, yc - kth - 1, tw, kth * 2 + 2, tire[3]);
        });
      }, true);
      // 전기 가열 코일: 계획한 만큼 감고, 미래 상한으로 쓰지 못하는 몫은 꺼 둔다.
      add(depth + 0.01, A => {
        const coils = Math.round(vis.ePlan * 10), on = Math.round(vis.e * 10);
        for (let k = 0; k < coils; k++) {
          const s = 0.26 + k * 0.09;
          if (s < s0 || s >= s1) continue;
          const xc = kx0 + (kx1 - kx0) * s, yc = ky0 + (ky1 - ky0) * s, tw = Math.max(1, S.hw * 0.08);
          rect(A, xc, yc - kth, tw, kth * 2, k < on ? rgb(dark ? [255, 214, 120] : [255, 190, 50]) : Pal.col([70, 70, 76]));
        }
      });
    };
    kilnPart(0, 0.35);
    kilnPart(0.35, 0.7);
    kilnPart(0.7, 1.0);

    // 가마 머리(버너)와 냉각기
    const hd = LAY.hood;
    add(mid(hd), A => {
      box(A, S, hd.i, hd.j, hd.si, hd.sj, 0, hd.h, Pal.face([186, 176, 162]));
      box(A, S, hd.i + 0.15, hd.j + 0.2, 0.8, 1.2, hd.h, 0.4, Pal.face([160, 150, 138]));
      winL(A, S, hd.i, hd.j, hd.si, hd.sj, 0, hd.h, 3, 2, win(41), 0.35, 0.3);
      winR(A, S, hd.i, hd.j, hd.si, hd.sj, 0, hd.h, 3, 2, win(43), 0.35, 0.3);
    }, true);
    meta.burner = [PX(S, hd.i, K.j + 0.15), PY(S, hd.i, K.j + 0.15, 0.85)];

    // 연료 마당: 석탄 더미(석탄 비율), 폐기물·바이오 더미(혼합연료 비율), 전기 변전 설비(전기 가열)
    reg("fuel", [LAY.coal.i - 1, LAY.coal.j - 1, 2, 2]);
    reg("fuel", [LAY.bio.i - 1, LAY.bio.j - 0.9, 2.2, 1.8]);
    reg("fuel", [LAY.sub.i, LAY.sub.j, LAY.sub.si, LAY.sub.sj]);
    add(LAY.coal.i + LAY.coal.j, A => {
      const s = clamp(vis.coal, 0, 1), c = LAY.coal;
      box(A, S, c.i - 0.85, c.j - 0.85, 1.7, 0.12, 0, 0.28, conc);
      if (s > 0.02) pile(A, S, c.i, c.j, 0.3 + 0.55 * Math.sqrt(s), 0.25 + 0.5 * Math.sqrt(s), Pal.face([62, 62, 68]), 8, [Pal.col([36, 36, 40]), Pal.col([120, 120, 128])]);
    });
    add(LAY.bio.i + LAY.bio.j, A => {
      const s = clamp(vis.bio / 0.4, 0, 1), b = LAY.bio;
      if (s <= 0.02) return;
      pile(A, S, b.i, b.j, 0.3 + 0.5 * Math.sqrt(s), 0.2 + 0.42 * Math.sqrt(s), Pal.face([150, 112, 62]), 9, [Pal.col([96, 128, 52]), Pal.col([196, 160, 104])]);
      const n = Math.round(s * 4);
      for (let k = 0; k < n; k++) box(A, S, b.i + 0.55 + (k % 2) * 0.3, b.j - 0.6 + (k >> 1) * 0.3, 0.26, 0.26, 0, 0.2, Pal.face([206, 176, 96]));
    });
    add(mid(LAY.sub), A => {
      const sb = LAY.sub;
      if (vis.ePlan <= 0) { lot(A, S, Pal, sb.i, sb.j, sb.si, sb.sj); return; }
      poly(A, diamond(S, sb.i, sb.j, sb.si, sb.sj, 0), Pal.col([150, 150, 150]));
      const n = Math.round(vis.ePlan * 10), on = Math.round(vis.e * 10);
      for (let k = 0; k < n; k++) {
        const ii = sb.i + 0.12 + k * 0.44;
        box(A, S, ii, sb.j + 0.25, 0.32, 0.4, 0, 0.42, k < on ? Pal.face([128, 150, 116]) : Pal.face([104, 104, 108]));
        rect(A, PX(S, ii + 0.16, sb.j + 0.45), PY(S, ii + 0.16, sb.j + 0.45, 0.72), 1, 0.3 * S.zh, Pal.col([90, 90, 96]));
      }
      // 가마로 가는 전선
      const x0 = PX(S, sb.i + sb.si * 0.5, sb.j + 0.2), y0 = PY(S, sb.i + sb.si * 0.5, sb.j + 0.2, 0.7);
      line(A, x0, y0, PX(S, sb.i + sb.si * 0.5 + 0.4, K.j + 0.3), PY(S, sb.i + sb.si * 0.5 + 0.4, K.j + 0.3, 1.0), Pal.col(dark ? [150, 150, 160] : [70, 70, 78]));
    });

    // 시멘트 사일로(생산량): 앞쪽부터 채운다
    reg("demand", [LAY.silos.i - 0.5, -4.1, 1.0, 3.7]);
    LAY.silos.j.forEach((jj, k) => {
      add(LAY.silos.i + jj + 0.5, A => {
        const on = 3 - k < vis.silos;
        if (!on) { poly(A, diamond(S, LAY.silos.i - 0.42, jj - 0.42, 0.84, 0.84, 0), Pal.col([150, 146, 132])); return; }
        cyl(A, S, LAY.silos.i, jj, 0.42, 0, 2.3, whiteBand, Pal.col([206, 202, 192]));
        const y = PY(S, LAY.silos.i, jj, 1.6), rx = 0.42 * Math.SQRT2 * S.hw;
        rect(A, PX(S, LAY.silos.i, jj) - rx, y, rx * 2, 1, Pal.col([190, 186, 176]));
      });
    });
    add(LAY.silos.i - 0.9 + 0.6, A => {
      // 사일로 위 이송 통로
      const n = vis.silos, j0 = LAY.silos.j[4 - n], j1 = LAY.silos.j[3];
      pipe(A, S, [[LAY.silos.i, j0, 2.55], [LAY.silos.i, j1, 2.55], [hd.i + hd.si * 0.6, j1, 2.55], [hd.i + hd.si * 0.6, j1, hd.h + 0.4]], Math.max(2, S.hh * 0.5), Pal.col([196, 200, 206]), Pal.col([120, 126, 134]));
    });

    // 탄소 포집 설비: 흡수탑 수 = 포집률(30/60/90). 기술 지연이면 비계와 크레인.
    const cp = LAY.cap;
    reg("capture", [cp.i, cp.j, cp.si, cp.sj]);
    add(-40, A => {
      if (vis.absorbers === 0) lot(A, S, Pal, cp.i, cp.j, cp.si, cp.sj);
      else poly(A, diamond(S, cp.i, cp.j, cp.si, cp.sj, 0), Pal.col([194, 192, 184]));
    });
    if (vis.absorbers > 0) {
      add(-3.6, A => {
        // 배가스 덕트: 굴뚝 밑 → 흡수탑 줄
        pipe(A, S, [[sk.i - 0.1, sk.j - 0.25, 0.55], [sk.i - 0.1, cp.j + 0.9, 0.55], [cp.i + 0.35, cp.j + 0.9, 0.55]], Math.max(2, S.hh * 0.5), steel[0], steel[2]);
      });
      for (let k = 0; k < vis.absorbers; k++) {
        const ci = cp.i + 0.7 + k * 1.05, cj = cp.j + 0.9;
        add(ci + cj, A => {
          const c = cyl(A, S, ci, cj, 0.37, 0, 2.6, tealBand, Pal.col([120, 200, 190]));
          ring(A, c, PY(S, ci, cj, 1.75), PY(S, ci, cj, 1.68), Pal.band([210, 232, 228]));
          ring(A, c, PY(S, ci, cj, 0.9), PY(S, ci, cj, 0.83), Pal.band([210, 232, 228]));
          if (k === 0) meta.capTop = [c.cx, c.top];
        });
      }
      add(cp.i + 2.9 + cp.j + 1.0, A => {
        cyl(A, S, cp.i + 3.1, cp.j + 0.8, 0.28, 0, 1.9, steelBand, Pal.col([200, 206, 212]));
      });
      add(cp.i + 1.4 + cp.j + 2.0, A => {
        const hi = cp.i + 0.4, hj = cp.j + 1.6;
        box(A, S, hi, hj, 2.3, 0.7, 0, 0.7, Pal.face([214, 210, 198]));
        winL(A, S, hi, hj, 2.3, 0.7, 0, 0.7, 5, 1, win(51), 0.4, 0.4);
        box(A, S, hi + 0.2, hj + 0.1, 0.5, 0.4, 0.7, 0.18, Pal.face([150, 156, 164]));
      });
      if (delay) {
        add(cp.i + cp.j + 3.4, A => {
          const scaf = Pal.col(dark ? [200, 170, 90] : [214, 158, 40]);
          const i0 = cp.i + 0.2, i1 = cp.i + 0.7 + (vis.absorbers - 1) * 1.05 + 0.55, J = cp.j + 1.4;
          for (let z = 0.5; z <= 2.75; z += 0.45) line(A, PX(S, i0, J), PY(S, i0, J, z), PX(S, i1, J), PY(S, i1, J, z), scaf);
          for (let ii = i0; ii <= i1 + 0.01; ii += 0.45) line(A, PX(S, ii, J), PY(S, ii, J, 0), PX(S, ii, J), PY(S, ii, J, 2.75), scaf);
          // 타워 크레인
          const ci = cp.i - 0.35, cj = cp.j + 0.35, cx = PX(S, ci, cj), cb = PY(S, ci, cj, 0), ct = PY(S, ci, cj, 3.6);
          line(A, cx, cb, cx, ct, scaf); line(A, cx + 1, cb, cx + 1, ct, scaf);
          for (let y = ct + 2; y < cb; y += 3) rect(A, cx, y, 2, 1, scaf);
          line(A, cx - S.hw * 0.8, ct, cx + S.hw * 2.6, ct, scaf);
          line(A, cx - S.hw * 0.8, ct + 1, cx + S.hw * 2.6, ct + 1, scaf);
          rect(A, cx - S.hw * 0.8, ct + 1, Math.max(2, S.hw * 0.3), Math.max(2, S.hh * 0.5), Pal.col([110, 110, 116]));
          meta.crane = [cx + S.hw * 2.1, ct + 2];
        });
      }
    }

    // CO₂ 배관과 세 행선지. 굵기는 각 흐름의 물량에 비례한다.
    const M = LAY.M, has = vis.C > 1e-9, zp = 0.32;
    const wOf = qq => Math.max(1, Math.round(clamp(Math.sqrt(qq / 1.1), 0.25, 1) * S.hh * 0.95));
    const jx = 5.8, pf = LAY.platform, mn = LAY.mineral, sy = LAY.syn;
    const trunk = [[cp.i + 2.7, cp.j + 2.0, zp], [M.i, cp.j + 2.0, zp], [M.i, M.j, zp]];
    const toSyn = [[M.i, M.j, zp], [M.i, sy.j + sy.sj, zp]];
    const toStore = [[M.i, M.j, zp], [jx, M.j, zp], [jx, pf.j, zp], [pf.i - 0.45, pf.j, zp]];
    const toMin = [[jx, M.j, zp], [mn.i, M.j, zp]];
    reg("dest", [M.i - 0.4, M.j - 0.4, 0.8, 0.8]);
    reg("dest", [sy.i, sy.j, sy.si, sy.sj]);
    reg("dest", [mn.i, mn.j, mn.si, mn.sj]);
    reg("dest", [pf.i - 0.5, pf.j - 0.5, 1, 1]);
    meta.flows = [];
    const pcol = has ? teal : Pal.face([150, 150, 150]);
    add(M.i + cp.j + 2.0 - 0.3, A => pipe(A, S, trunk, wOf(vis.C), pcol[0], pcol[2]));
    if (vis.shares.syn > 0) add(M.i + sy.j + sy.sj + 0.2, A => pipe(A, S, toSyn, wOf(vis.syn), pcol[0], pcol[2]));
    if (vis.shares.store > 0 || vis.store > 1e-9) add(jx + M.j - 0.3, A => pipe(A, S, toStore, wOf(vis.store), pcol[0], pcol[2]));
    if (vis.shares.mineral > 0) add(jx + M.j + 0.2, A => pipe(A, S, toMin, wOf(vis.mineral + vis.overflow), pcol[0], pcol[2]));
    add(M.i + M.j + 0.4, A => {
      box(A, S, M.i - 0.3, M.j - 0.3, 0.6, 0.6, 0, 0.55, Pal.face([200, 204, 196]));
      rect(A, PX(S, M.i, M.j) - 1, PY(S, M.i, M.j, 0.7) - 1, 3, 2, has ? Pal.col([255, 210, 60]) : Pal.col([120, 120, 120]));
    });
    if (has) {
      meta.flows.push({ pts: trunk });
      if (vis.syn > 1e-9) meta.flows.push({ pts: toSyn });
      if (vis.store > 1e-9) meta.flows.push({ pts: toStore });
      if (vis.mineral > 1e-9) meta.flows.push({ pts: toMin });
    }

    // 광물화 시설: 탄산염 블록(연 0.100 Mt 상한까지)
    add(mid(mn), A => {
      if (vis.shares.mineral <= 0) { lot(A, S, Pal, mn.i, mn.j, mn.si, mn.sj); return; }
      box(A, S, mn.i, mn.j, mn.si * 0.62, mn.sj, 0, 0.9, Pal.face([200, 208, 214]));
      winL(A, S, mn.i, mn.j, mn.si * 0.62, mn.sj, 0, 0.9, 2, 2, win(61), 0.45, 0.3);
      winR(A, S, mn.i, mn.j, mn.si * 0.62, mn.sj, 0, 0.9, 3, 2, win(63), 0.45, 0.3);
      const n = Math.max(1, Math.round(clamp(vis.mineral / 0.1, 0, 1) * 6));
      for (let k = 0; k < n; k++) box(A, S, mn.i + mn.si * 0.68 + (k >= 3 ? 0.3 : 0), mn.j + 0.15 + (k % 3) * 0.48, 0.26, 0.38, 0, 0.26 + (k >= 3 ? 0 : 0.0), Pal.face([238, 238, 232]));
    });
    // 합성연료 시설: 전기분해 공장, 메탄올 탱크, 수소 구형 탱크, 소각탑
    add(mid(sy), A => {
      if (vis.shares.syn <= 0) { lot(A, S, Pal, sy.i, sy.j, sy.si, sy.sj); return; }
      box(A, S, sy.i, sy.j + 0.9, sy.si, 0.9, 0, 0.75, Pal.face([206, 214, 226]));
      winL(A, S, sy.i, sy.j + 0.9, sy.si, 0.9, 0, 0.75, 5, 1, () => (dark ? Pal.lit[1] : Pal.col([70, 120, 200])), 0.5, 0.5);
      cyl(A, S, sy.i + 0.5, sy.j + 0.45, 0.36, 0, 1.25, whiteBand, Pal.col([214, 210, 200]));
      const sc = PX(S, sy.i + 1.5, sy.j + 0.45), sy0 = PY(S, sy.i + 1.5, sy.j + 0.45, 0.6), rr = 0.4 * Math.SQRT2 * S.hw;
      rect(A, sc - rr * 0.6, sy0, 1, PY(S, sy.i + 1.5, sy.j + 0.45, 0) - sy0, Pal.col([110, 110, 116]));
      rect(A, sc + rr * 0.6, sy0, 1, PY(S, sy.i + 1.5, sy.j + 0.45, 0) - sy0, Pal.col([110, 110, 116]));
      ell(A, sc, sy0, rr, rr * 0.95, Pal.col([228, 228, 222]));
      ell(A, sc + rr * 0.3, sy0 + rr * 0.25, rr * 0.7, rr * 0.65, Pal.col([196, 196, 190]));
      ell(A, sc - rr * 0.35, sy0 - rr * 0.35, rr * 0.3, rr * 0.25, Pal.col([250, 250, 246]));
      cyl(A, S, sy.i + 2.2, sy.j + 0.3, 0.07, 0, 1.6, steelBand, Pal.col([90, 90, 96]));
      meta.flare = [PX(S, sy.i + 2.2, sy.j + 0.3), PY(S, sy.i + 2.2, sy.j + 0.3, 1.6)];
    });
    // 저장: 바다 위 주입 설비
    add(pf.i + pf.j + 0.6, A => {
      const legs = Pal.col([110, 110, 116]);
      [[0, 0], [0.8, 0], [0, 0.8], [0.8, 0.8]].forEach(([a, b]) => rect(A, PX(S, pf.i - 0.4 + a, pf.j - 0.4 + b), PY(S, pf.i - 0.4 + a, pf.j - 0.4 + b, 0.5), 1, 0.5 * S.zh + 2, legs));
      box(A, S, pf.i - 0.45, pf.j - 0.45, 0.9, 0.9, 0.45, 0.14, Pal.face([206, 190, 110]));
      box(A, S, pf.i - 0.3, pf.j - 0.32, 0.42, 0.36, 0.59, 0.3, vis.store > 1e-9 ? Pal.face([226, 226, 220]) : Pal.face([150, 150, 150]));
      const dx = PX(S, pf.i + 0.18, pf.j + 0.18), dy0 = PY(S, pf.i + 0.18, pf.j + 0.18, 0.59), dy1 = PY(S, pf.i + 0.18, pf.j + 0.18, 1.5);
      const red = Pal.col([214, 70, 50]);
      line(A, dx, dy0, dx, dy1, red); line(A, dx - 2, dy0, dx, dy1, red); line(A, dx + 2, dy0, dx, dy1, red);
      meta.platform = [PX(S, pf.i, pf.j), PY(S, pf.i, pf.j, 0)];
      meta.platformTop = [dx, dy1];
    });

    // 해안 둑(바다 쪽으로 보이는 흙 단면)
    add(-90, A => {
      const terr = WORLD.terrain, bankR = Pal.col([132, 98, 62]), bankL = Pal.col([160, 122, 80]);
      for (let tj = meta.view.j0; tj <= meta.view.j1; tj++) for (let ti = meta.view.i0; ti <= meta.view.i1; ti++) {
        if (terr(ti, tj) === 6) continue;
        if (terr(ti + 1, tj) === 6) {
          const I = ti + 1;
          poly(A, [PX(S, I, tj + 1), PY(S, I, tj + 1, 0), PX(S, I, tj), PY(S, I, tj, 0), PX(S, I, tj), PY(S, I, tj, -0.22), PX(S, I, tj + 1), PY(S, I, tj + 1, -0.22)], bankR);
        }
        if (terr(ti, tj + 1) === 6) {
          const J = tj + 1;
          poly(A, [PX(S, ti, J), PY(S, ti, J, 0), PX(S, ti + 1, J), PY(S, ti + 1, J, 0), PX(S, ti + 1, J), PY(S, ti + 1, J, -0.22), PX(S, ti, J), PY(S, ti, J, -0.22)], bankL);
        }
      }
    }, true);

    // 탄소 장부 전광판(장부 배출 대 물리적 대기 배출, 목표선), 예측 표지판, 기준 깃발 두 개
    const bb = LAY.billboard;
    reg("acct", [bb.i - 0.8, bb.j - 0.6, 2.0, 1.2]);
    add(bb.i + bb.j + 0.5, A => {
      const bx = PX(S, bb.i, bb.j), by = PY(S, bb.i, bb.j, 0);
      const pw = Math.round(S.hw * 4.4), ph = Math.round(S.zh * 1.5), top = Math.round(by - S.zh * 2.2), left = Math.round(bx - pw * 0.5);
      const post = Pal.col([90, 90, 96]);
      rect(A, left + pw * 0.2, top + ph, 1, by - top - ph, post);
      rect(A, left + pw * 0.8, top + ph, 1, by - top - ph, post);
      rect(A, left - 1, top - 1, pw + 2, ph + 2, Pal.col([64, 64, 70]));
      rect(A, left, top, pw, ph, rgb(dark ? [10, 12, 22] : [22, 26, 42]));
      const L = st.base, led = vis.ledger, phy = vis.physical;
      const bx0 = left + Math.round(pw * 0.27), bw = Math.round(pw * 0.68), bh = Math.max(2, Math.round(ph * 0.17));
      const r1 = top + Math.round(ph * 0.42), r2 = top + Math.round(ph * 0.7);
      rect(A, bx0, r1, bw, bh, rgb([46, 50, 68]));
      rect(A, bx0, r2, bw, bh, rgb([46, 50, 68]));
      if (led !== null) {
        rect(A, bx0, r1, Math.round(bw * clamp(led / L, 0, 1.2) / 1.2), bh, rgb([255, 190, 60]));
        rect(A, bx0, r2, Math.round(bw * clamp(phy / L, 0, 1.2) / 1.2), bh, rgb([230, 232, 240]));
      }
      // 목표선: 장부 배출이 현재의 40%(감축 60%)
      const tx = bx0 + Math.round(bw * 0.4 / 1.2);
      for (let y = r1 - 1; y <= r2 + bh; y += 2) rect(A, tx, y, 1, 1, rgb([255, 96, 80]));
      if (S.hw < 9) rect(A, left + 2, top + 2, Math.round(pw * 0.4), Math.max(1, Math.round(ph * 0.12)), rgb([255, 211, 107]));
      meta.board = { x: left, y: top, w: pw, h: ph, bars: { x: bx0, w: bw, r1, r2, bh, tx } };
      // 예측 표지판: 기술 지연에서 60% 이상(위 화살표) / 미만(아래 화살표)
      if (st.pred) {
        const sz = Math.max(4, Math.round(S.hw * 0.5)), sx = left - sz - 3, sy = by - Math.round(S.zh * 1.05);
        rect(A, sx + sz / 2, sy + sz, 1, by - sy - sz + S.hh * 0.3, post);
        rect(A, sx - 1, sy - 1, sz + 2, sz + 2, Pal.col([40, 40, 46]));
        rect(A, sx, sy, sz, sz, rgb(st.pred === "reach" ? [40, 150, 84] : [206, 104, 36]));
        const cx = sx + sz / 2, m = Math.max(1, Math.round(sz * 0.2));
        if (st.pred === "reach") poly(A, [sx + m, sy + sz - m, sx + sz - m, sy + sz - m, cx, sy + m], rgb([255, 255, 255]));
        else poly(A, [sx + m, sy + m, sx + sz - m, sy + m, cx, sy + sz - m], rgb([255, 255, 255]));
      }
      [0, 1].forEach(k => {
        const key = st.crit[k], fx = left + pw + 2 + k * Math.max(4, Math.round(S.hw * 0.75)), hgt = Math.round(S.zh * (k === 0 ? 2.3 : 1.8)), fy = by + (k ? S.hh * 0.3 : 0);
        rect(A, fx, fy - hgt, 1, hgt, post);
        if (key) {
          const fw = Math.max(4, Math.round(S.hw * 0.62)), fh = Math.max(3, Math.round(S.hh * 0.75));
          rect(A, fx + 1, fy - hgt, fw, fh, rgb(dark ? mix(CRIT_RGB[key], [255, 255, 255], 0.1) : CRIT_RGB[key]));
          rect(A, fx + 1, fy - hgt + fh - 1, fw, 1, rgb(mul(CRIT_RGB[key], 0.7)));
        }
      });
    });

    // 전환 지원: 재배치·교육 센터(켜면 문을 연다)
    const tr = LAY.training;
    reg("support", [tr.i, tr.j, tr.si, tr.sj]);
    add(mid(tr), A => {
      if (!p.support) { lot(A, S, Pal, tr.i, tr.j, tr.si, tr.sj); return; }
      box(A, S, tr.i, tr.j, tr.si, tr.sj, 0, 0.75, Pal.face([232, 220, 196]));
      box(A, S, tr.i - 0.05, tr.j - 0.05, tr.si + 0.1, tr.sj + 0.1, 0.75, 0.12, Pal.face([60, 120, 200]));
      winL(A, S, tr.i, tr.j, tr.si, tr.sj, 0, 0.75, 4, 2, win(71), 0.45, 0.35);
      winR(A, S, tr.i, tr.j, tr.si, tr.sj, 0, 0.75, 3, 2, win(73), 0.45, 0.35);
      const fx = PX(S, tr.i + tr.si, tr.j), fy = PY(S, tr.i + tr.si, tr.j, 0.87);
      rect(A, fx, fy - S.zh * 0.85, 1, S.zh * 0.85, Pal.col([90, 90, 96]));
      rect(A, fx + 1, fy - S.zh * 0.85, Math.max(4, S.hw * 0.55), Math.max(3, S.hh * 0.6), rgb(dark ? [70, 190, 120] : [46, 160, 90]));
    });
  }

  /* ---------- 움직이는 것 ---------- */
  function truck(A, S, Pal, i, j, dirI, body) {
    const L = 0.42, Wd = 0.24;
    if (dirI) {
      box(A, S, i - L / 2, j - Wd / 2, L * 0.62, Wd, 0.05, 0.22, body);
      box(A, S, i - L / 2 + L * 0.66, j - Wd / 2, L * 0.34, Wd, 0.05, 0.2, Pal.face([214, 70, 52]));
    } else {
      box(A, S, i - Wd / 2, j - L / 2, Wd, L * 0.62, 0.05, 0.22, body);
      box(A, S, i - Wd / 2, j - L / 2 + L * 0.66, Wd, L * 0.34, 0.05, 0.2, Pal.face([214, 70, 52]));
    }
  }
  function along(pts, s) {
    let total = 0;
    const seg = [];
    for (let k = 0; k + 1 < pts.length; k++) { const l = Math.abs(pts[k + 1][0] - pts[k][0]) + Math.abs(pts[k + 1][1] - pts[k][1]); seg.push(l); total += l; }
    let d = (((s % 1) + 1) % 1) * total;
    for (let k = 0; k < seg.length; k++) {
      if (d <= seg[k] || k === seg.length - 1) {
        const f = seg[k] ? clamp(d / seg[k], 0, 1) : 0, a = pts[k], b = pts[k + 1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]), a.length > 2 ? a[2] + (b[2] - a[2]) * f : 0];
      }
      d -= seg[k];
    }
    return [pts[0][0], pts[0][1], true, 0];
  }
  function drawDynamic(A, S, Pal, st, vis, meta, t, still) {
    const dark = Pal.dark;
    // 트럭: 광산 → 파쇄기(클링커 물량에 따라 1~3대), 혼합재 반입(공급 한도에 따라 0~2대)
    const haul = [[-6.6, 3.5], [-3.9, 3.5]];
    for (let k = 0; k < vis.trucksQ; k++) {
      const s = (t * 0.08 + k / vis.trucksQ) % 1, q = s < 0.5 ? s * 2 : 2 - s * 2;
      const pos = along(haul, q);
      truck(A, S, Pal, pos[0], pos[1], true, Pal.face([236, 190, 56]));
    }
    const sup = [[-15.5, 3.5], [-4.6, 3.5]];
    for (let k = 0; k < vis.trucksS; k++) {
      const pos = along(sup, (t * 0.035 + k * 0.5) % 1);
      truck(A, S, Pal, pos[0], pos[1], true, Pal.face([150, 156, 164]));
    }
    // 가마 회전 무늬와 버너 불빛
    const kn = meta.kiln;
    if (kn) {
      const hl = rgb(dark ? [150, 96, 64] : [236, 168, 120]);
      for (let k = 0; k < 9; k++) {
        const s = 0.05 + k * 0.1, x = Math.round(kn.x0 + (kn.x1 - kn.x0) * s), yc = kn.y0 + (kn.y1 - kn.y0) * s;
        const ph = ((t * 0.9 + k * 0.37) % 1) * 2 - 1;
        rect(A, x, Math.round(yc + ph * kn.th * 0.8), 1, 1, hl);
      }
    }
    if (meta.burner) {
      const f = still ? 0.6 : 0.5 + 0.5 * Math.sin(t * 9) * Math.sin(t * 5.3);
      const hot = vis.e > 0.15 ? [255, 236, 200] : vis.bio > 0.2 ? [255, 210, 90] : [255, 150, 50];
      const r0 = Math.max(1.5, S.hw * (0.2 + 0.07 * f));
      ell(A, meta.burner[0], meta.burner[1], r0, r0 * 0.7, rgb(hot));
      ell(A, meta.burner[0], meta.burner[1], r0 * 0.5, r0 * 0.35, rgb([255, 252, 236]));
    }
    // 굴뚝 연기: 굴뚝으로 나가는 CO₂에 비례한 굵기와 짙기. 포집이 클수록 흰 수증기에 가깝다.
    if (meta.stackTop) {
      const sm = clamp(vis.smoke, 0, 1.2), n = Math.round(3 + 9 * sm), sx = meta.stackTop[0], sy = meta.stackTop[1];
      const grey = mix(dark ? [92, 96, 106] : [112, 108, 104], dark ? [170, 176, 188] : [240, 240, 238], clamp(vis.rEff * 1.15, 0, 1));
      // 바람에 오른쪽으로 눕는 연기 기둥(장면 위쪽 밖으로 나가지 않게 조금만 오른다)
      for (let k = n - 1; k >= 0; k--) {
        const a = (t * 0.14 + k / n) % 1;
        const r = Math.max(1, S.hw * (0.14 + a * (0.2 + 0.42 * sm)));
        const x = sx + a * S.hw * (3.2 + 2.6 * sm) + Math.sin(k * 1.7 + t * 0.8) * S.hw * 0.12;
        const y = Math.max(r * 0.8 + 1, sy - Math.sqrt(a) * S.zh * 0.9 - r * 0.25);
        A.c.globalAlpha = clamp((1 - a * 0.85) * (0.45 + 0.5 * sm), 0.1, 0.95);
        ell(A, x, y, r, r * 0.85, rgb(grey));
        ell(A, x - r * 0.3, y - r * 0.3, r * 0.5, r * 0.4, rgb(mix(grey, [255, 255, 255], 0.35)));
      }
      A.c.globalAlpha = 1;
      if (dark) rect(A, sx, sy - 1, 1, 1, rgb(still || Math.sin(t * 3.4) > 0 ? [255, 70, 60] : [120, 30, 30]));
    }
    // 점토 소성로 연기: 소성 점토를 쓰면 별도의 석탄을 태운다.
    if (meta.calTop) {
      const grey = rgb(dark ? [104, 108, 118] : [128, 124, 120]);
      for (let k = 0; k < 4; k++) {
        const a = (t * 0.22 + k / 4) % 1, r = Math.max(1, S.hw * (0.08 + a * 0.2));
        A.c.globalAlpha = clamp(0.75 * (1 - a), 0.1, 0.8);
        ell(A, meta.calTop[0] + a * S.hw * 1.6, meta.calTop[1] - Math.sqrt(a) * S.zh * 0.5, r, r * 0.85, grey);
      }
      A.c.globalAlpha = 1;
    }
    // 바다 반짝임
    const glint = rgb(dark ? [150, 186, 230] : [235, 246, 255]);
    for (let k = 0; k < 14; k++) {
      const ti = 9 + Math.floor(hash(k, 1, 41) * 10), tj = -12 + Math.floor(hash(k, 2, 41) * 14);
      if (WORLD.terrain(ti, tj) !== 6 || Math.sin(t * 2.3 + k * 1.9) < 0.55) continue;
      const x = PX(S, ti + 0.5, tj + 0.5), y = PY(S, ti + 0.5, tj + 0.5, 0);
      rect(A, x - 1, y, 3, 1, glint);
      rect(A, x, y - 1, 1, 3, glint);
    }
    // CO₂ 흐름 점(청록)
    const dot = rgb(dark ? [150, 255, 236] : [220, 255, 248]);
    (meta.flows || []).forEach((fl, idx) => {
      const n = Math.max(3, fl.pts.length * 3);
      for (let k = 0; k < n; k++) {
        const pos = along(fl.pts, (t * 0.1 + k / n + idx * 0.13) % 1);
        rect(A, PX(S, pos[0], pos[1]), PY(S, pos[0], pos[1], pos[3] || 0.32) - 1, 1, 1, dot);
      }
    });
    // 바다: 저장 누출 거품(미래별 누출률), 어선, 합성연료 소각탑 불꽃
    if (meta.platform) {
      const bub = vis.leak > 0 ? Math.min(5, 1 + Math.round(Math.log10(vis.leak * 1e6 + 1) * 1.6)) : 0;
      for (let k = 0; k < bub; k++) {
        const a = (t * 0.4 + k / Math.max(1, bub)) % 1;
        rect(A, meta.platform[0] + S.hw * (0.9 + 0.3 * Math.sin(k * 2.1)), meta.platform[1] + S.hh * 1.2 - a * S.zh * 0.6, 1, 1, rgb(dark ? [120, 170, 210] : [220, 240, 255]));
      }
      if (dark) rect(A, meta.platformTop[0], meta.platformTop[1] - 1, 1, 1, rgb(still || Math.sin(t * 2.6 + 1) > 0 ? [255, 80, 60] : [110, 30, 30]));
    }
    const bi = 9.4 + Math.sin(t * 0.25) * 0.5, bj = -10.6;
    box(A, S, bi, bj, 0.5, 0.22, 0.02, 0.12, Pal.face([222, 90, 60]));
    box(A, S, bi + 0.1, bj + 0.02, 0.18, 0.16, 0.14, 0.14, Pal.face([236, 236, 230]));
    if (meta.flare && vis.syn > 1e-9) {
      const f = still ? 1 : Math.round(1 + Math.sin(t * 11));
      rect(A, meta.flare[0] - 1, meta.flare[1] - 2 - f, 2, 2 + f, rgb([255, 170, 60]));
    }
    if (meta.crane) rect(A, meta.crane[0], meta.crane[1] + (still ? 3 : 2 + Math.round(2 + 2 * Math.sin(t * 1.3))), 1, 2, rgb([60, 60, 66]));
  }

  // 조작 중인 밸브의 설비를 깜박이는 점선 마름모로 표시한다(게임 화면의 포커스 표시를 읽기만 한다).
  function activeGroup(root) {
    if (!root || typeof root.querySelector !== "function") return "";
    const el = root.querySelector(".cc-valve legend.cc-active-legend");
    const id = el && el.parentElement ? el.parentElement.id || "" : "";
    const g = id.indexOf("cc-valve-") === 0 ? id.slice(9) : "";
    return own(GROUPS, g) ? g : "";
  }
  function drawSelection(A, S, rects, t, still) {
    // 노랑·검정이 번갈아 흐르는 점선(선택 상자)
    const ink = [rgb([255, 222, 60]), rgb([20, 20, 24])], off = still ? 0 : Math.floor(t * 10);
    rects.forEach(r => {
      const p = diamond(S, r[0] - 0.08, r[1] - 0.08, r[2] + 0.16, r[3] + 0.16, 0);
      for (let k = 0; k < 4; k++) {
        const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[((k + 1) % 4) * 2], by = p[((k + 1) % 4) * 2 + 1];
        const n = Math.max(2, Math.round(Math.abs(bx - ax)));
        for (let m = 0; m <= n; m++) rect(A, ax + (bx - ax) * m / n, ay + (by - ay) * m / n, 1, 1, ink[((m + off) >> 1) & 1]);
      }
    });
  }

  /* ---------- 장면 조립과 캐시 ---------- */
  const cache = { gkey: "", dkey: "", pkey: "", ground: null, deco: null, plant: null, frame: null, meta: null };
  function fit(W, H, bx) {
    const tw = Math.min(2 * (W - 2) / (bx.u1 - bx.u0), 2 * (H - 2) / (bx.y1 - bx.y0));
    return clamp(Math.floor(tw / 2) * 2, 8, 64);
  }
  function camera(W, H) {
    const wide = fit(W, H, WIDE), crop = fit(W, H, CROP);
    const bx = wide >= crop * 0.86 ? WIDE : CROP, TW = bx === WIDE ? wide : crop;
    const hw = TW / 2, hh = TW / 4, zh = TW / 2;
    return { TW, hw, hh, zh, ox: Math.round(W / 2 - (bx.u0 + bx.u1) / 2 * hw), oy: Math.round(H / 2 - (bx.y0 + bx.y1) / 2 * zh) };
  }
  function viewRange(S, W, H) {
    const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => { const wx = (x - S.ox) / S.hw, wy = (y - S.oy) / S.hh; return [(wx + wy) / 2, (wy - wx) / 2]; });
    const is = pts.map(p => p[0]), js = pts.map(p => p[1]);
    return {
      i0: Math.floor(Math.min.apply(null, is)) - 2, i1: Math.ceil(Math.max.apply(null, is)) + 2,
      j0: Math.floor(Math.min.apply(null, js)) - 2, j1: Math.ceil(Math.max.apply(null, js)) + 2,
      u0: -(S.ox / S.hw) - 2, u1: (W - S.ox) / S.hw + 2, v0: -(S.oy / S.hh) - 2, v1: (H - S.oy) / S.hh + 6
    };
  }
  function makeBuf(cv, W, H) {
    const c = cv || document.createElement("canvas");
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return { cv: c, c: ctx, W, H };
  }

  /* ---------- 글자(원래 해상도로 덧그림) ---------- */
  const SANS = "\"IBM Plex Sans KR\", \"Noto Sans KR\", \"Apple SD Gothic Neo\", sans-serif";
  function overlayText(g, meta, st, cs, dark, w) {
    const b = meta.board;
    if (b && b.w * cs >= 100) {
      const fs = Math.round(clamp(b.h * cs * 0.25, 9, 12));
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.font = "700 " + fs + "px " + SANS;
      g.fillStyle = "#ffd36b";
      const hy = (b.y + (b.bars.r1 - b.y) / 2) * cs;
      g.fillText("탄소 장부", b.x * cs + 4, hy);
      if (st.step === 2) {
        g.fillStyle = "#9fe8dc";
        g.textAlign = "right";
        g.fillText("인정 " + st.plan.acct + "%", (b.x + b.w) * cs - 4, hy);
        g.textAlign = "left";
      }
      g.font = "600 " + Math.max(9, fs - 1) + "px " + SANS;
      g.fillStyle = "#ffd36b";
      g.fillText("장부", b.x * cs + 4, (b.bars.r1 + b.bars.bh / 2) * cs);
      g.fillStyle = "#eef0f6";
      g.fillText("실제", b.x * cs + 4, (b.bars.r2 + b.bars.bh / 2) * cs);
    }
    if (st.locked) {
      const fs = clamp(Math.round(w * 0.02), 14, 24), x = w - fs * 2.6, y = fs * 1.4;
      g.save();
      g.translate(x, y);
      g.rotate(-0.16);
      g.font = "800 " + fs + "px " + SANS;
      const tw = g.measureText("확정").width, pw = tw + fs * 0.9, ph = fs * 1.5;
      g.fillStyle = dark ? "rgba(40,8,8,0.9)" : "rgba(255,250,240,0.92)";
      g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.strokeStyle = dark ? "#ff8a78" : "#c0281c";
      g.lineWidth = 2;
      g.strokeRect(-pw / 2 + 1, -ph / 2 + 1, pw - 2, ph - 2);
      g.strokeRect(-pw / 2 + 4, -ph / 2 + 4, pw - 8, ph - 8);
      g.fillStyle = dark ? "#ff8a78" : "#c0281c";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("확정", 0, 1);
      g.restore();
    }
  }

  /* ---------- 칩과 설명 ---------- */
  function chipsOf(st, narrow) {
    const m = st.model, r = st.r, p = st.plan, out = [];
    const fmt = (x, n) => (m && typeof m.fmt === "function" ? m.fmt(x, n) : x.toFixed(n));
    if (r) {
      const red = m && typeof m.fmtRed === "function" ? m.fmtRed(r.reduction) : r.reduction.toFixed(1);
      out.push({ label: "장부 감축", value: red + "%", tone: r.reduction >= 60 - 1e-12 ? "ok" : "warn" });
      out.push({ label: "실제 배출", value: fmt(r.physical, 3) + " Mt", tone: r.physical - st.base >= 0.0005 ? "bad" : "plain" });
    } else out.push({ label: "포집", value: p.capture + "%", tone: "plain" });
    out.push({ label: "미래", value: FUT_SHORT[st.fut], tone: st.fut === "smooth" ? "info" : "warn" });
    if (!narrow) {
      if (r) out.push({ label: "포집", value: p.capture + "%", tone: p.capture ? "info" : "plain" });
      out.push({ label: "계획", value: st.locked ? "확정" : st.step === 2 ? "2단계" : "1단계", tone: st.locked ? "ok" : "plain" });
    }
    return out;
  }
  function captionOf(st, vis) {
    const p = st.plan, r = st.r, m = st.model;
    const fmt = (x, n) => (m && typeof m.fmt === "function" ? m.fmt(x, n) : x.toFixed(n));
    const parts = ["시멘트 공장 전경, " + FUT[st.fut] + " 미래."];
    parts.push("수요 감축 " + p.d + "%" + (r ? "로 생산 " + fmt(r.P, 3) + " Mt/년" : "") + ", 클링커 " + p.c + "%" + (r && r.warnC ? "(원료 한도로 실제 " + fmt(r.cActual * 100, 1) + "%)" : "") + ".");
    parts.push("가마 연료는 석탄 " + (r ? fmt(r.coalShare * 100, 0) : 100 - p.bio - p.elec) + "%, 폐기물·바이오 " + p.bio + "%, 전기 " + (r ? fmt(r.e * 100, 0) : p.elec) + "%" + (r && r.warnE ? "(계획 " + p.elec + "%)" : "") + ".");
    if (p.capture) parts.push("포집 설비 " + p.capture + "%" + (r ? ", 실효 " + fmt(r.r * 100, 1) + "%" : "") + (st.fut === "delay" ? ", 기술 지연으로 공사 중" : "") + ". 포집한 CO₂는 저장 " + vis.shares.store + "%, 광물화 " + p.mineral + "%, 합성연료 " + p.syn + "%로 보냄.");
    else parts.push("포집 설비 없음, 굴뚝 연기가 짙음.");
    if (r) parts.push("전광판: 장부상 감축률 " + (m && typeof m.fmtRed === "function" ? m.fmtRed(r.reduction) : r.reduction.toFixed(1)) + "%, 물리적 대기 배출 " + fmt(r.physical, 3) + " Mt/년.");
    if (st.step === 2) parts.push("합성연료 인정 " + p.acct + "%.");
    parts.push("전환 지원 " + (p.support ? "켬(교육 센터 운영)" : "끔") + ".");
    const c1 = st.crit[0] ? CRIT[st.crit[0]] : "", c2 = st.crit[1] ? CRIT[st.crit[1]] : "";
    if (c1 || c2) parts.push("기준 깃발: " + [c1 && "첫째 " + c1, c2 && "둘째 " + c2].filter(Boolean).join(", ") + ".");
    if (st.pred) parts.push("예측: 기술 지연에서 60% " + (st.pred === "reach" ? "이상" : "미만") + ".");
    parts.push(st.locked ? "계획 확정됨." : st.step === 2 ? "2단계 조절 중." : "1단계 조절 중.");
    return parts.join(" ");
  }

  /* ---------- 그리기 ---------- */
  function render(ctx) {
    const g = ctx.g, w = Math.max(1, ctx.w), h = Math.max(1, ctx.h);
    const st = read(ctx), vis = derive(st);
    const dark = ctx.scheme === "dark", thumb = !!ctx.thumb, still = !!ctx.reduced || thumb;
    const tr = typeof g.getTransform === "function" ? g.getTransform() : null, dpr = tr && tr.a > 0 ? tr.a : 1;
    const P = !thumb && w >= 640 && h >= 150 ? 2 : 1;
    const k = Math.max(1, Math.round(P * dpr)), cs = k / dpr;
    const W = Math.max(8, Math.ceil(w * dpr / k)), H = Math.max(8, Math.ceil(h * dpr / k));
    const S = camera(W, H), view = viewRange(S, W, H), Pal = palette(dark, st.fut);
    const t = still ? 2.2 : ctx.t;
    // 층 1: 땅(크기·밤낮·원료 부족의 마른 풀), 층 2: 상태와 무관한 마을과 설비(투명), 층 3: 상태를 그린 공장
    const dkey = [W, H, S.TW, S.ox, S.oy, dark].join("|"), gkey = dkey + "|" + (st.fut === "scarce");
    const pkey = gkey + "|" + st.fut + "|" + JSON.stringify([st.plan, st.step, st.crit, st.locked, st.pred, vis.C, vis.scm, vis.clay, vis.e, vis.store, vis.mineral, vis.syn, vis.ledger, vis.physical]);
    const C = thumb ? { gkey: "", dkey: "", pkey: "" } : cache;
    if (C.gkey !== gkey) {
      C.ground = makeBuf(C.ground && C.ground.cv, W, H);
      const lamps = dark ? [[-2, 3.2], [2.6, 4.2], [6, -0.6], [-4.6, -2.2], [5.4, -5.6], [-7, 2.6]].map(([i, j]) => [PX(S, i, j), PY(S, i, j, 0), S.hw * 1.7]) : null;
      paintGround(C.ground, S, Pal, lamps, view);
      C.gkey = gkey;
      C.pkey = "";
    }
    if (C.dkey !== dkey) {
      C.deco = makeBuf(C.deco && C.deco.cv, W, H);
      C.deco.c.clearRect(0, 0, W, H);
      const items = [];
      filler(S, Pal, view, items);
      buildPlant(S, Pal, st, vis, items, { groups: {}, view, flows: [] }, "static");
      items.sort((a, b) => a.d - b.d).forEach(it => it.f(C.deco));
      C.dkey = dkey;
      C.pkey = "";
    }
    if (C.pkey !== pkey) {
      C.plant = makeBuf(C.plant && C.plant.cv, W, H);
      const pc = C.plant.c;
      pc.drawImage(C.ground.cv, 0, 0);
      pc.drawImage(C.deco.cv, 0, 0);
      const meta = { groups: {}, view, flows: [] }, items = [];
      buildPlant(S, Pal, st, vis, items, meta, "state");
      items.sort((a, b) => a.d - b.d).forEach(it => it.f(C.plant));
      // 미래의 날씨: 원료 부족은 먼지 낀 누런빛, 기술 지연은 흐린 잿빛
      if (st.fut !== "smooth") {
        pc.globalAlpha = dark ? 0.08 : st.fut === "scarce" ? 0.12 : 0.14;
        pc.fillStyle = st.fut === "scarce" ? "rgb(214,168,86)" : "rgb(84,98,124)";
        pc.fillRect(0, 0, W, H);
        pc.globalAlpha = 1;
      }
      C.meta = meta;
      C.pkey = pkey;
    }
    C.frame = makeBuf(C.frame && C.frame.cv, W, H);
    const F = C.frame;
    F.c.drawImage(C.plant.cv, 0, 0);
    drawDynamic(F, S, Pal, st, vis, C.meta, t, still);
    const grp = thumb ? "" : activeGroup(ctx.root);
    if (grp && C.meta.groups[grp]) drawSelection(F, S, C.meta.groups[grp], t, still);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(F.cv, 0, 0, W * k, H * k);
    g.restore();
    if (!thumb) {
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayText(g, C.meta, st, cs, dark, w);
      g.restore();
    }
    return { caption: captionOf(st, vis), chips: chipsOf(st, w < 560), animate: !still };
  }

  KCP.v2.skin(ID, { kicker: "PLANT VIEW", title: "시멘트 공장 전경", render });
})();
