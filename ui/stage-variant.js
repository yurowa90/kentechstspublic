/* 변이 판독대 장면: 1980년대 검문 부스 판독대 오마주(픽셀 아트)
 * - 위: 부스 창문 띠. 바깥에 상담을 기다리는 사람들이 줄을 선다(줄 길이 = 상담 수요, 표지 8 = 동시 상담 8건).
 * - 창문 아래 눈금 레일: 카드 16장의 분류 점수 위치, 보고선 T1(빨강)·상담선 T2(주황) 깃발.
 * - 책상: 규정집, 증거 저울(접시 5개 = 무게 5개), 서류함 세 칸(보고·상담 후 결정·보고하지 않음, 서류 장수 = 분류 장수),
 *   결과 봉투(공개 뒤 2×2 대조표), 정책 제어함(램프와 스위치 4개), 수동 변경 쪽지(창에 꽂힘), 벽 등.
 * - 기준을 확정하면 창 덧문이 내려오고 '확정' 도장이 찍힌다.
 * 게임 상태는 읽기만 한다. 분류는 게임 모형(model)의 함수와 카드 자료로 다시 계산해 화면의 장수와 맞춘다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;
  const ID = "s-variant-desk";
  const GROUPS = ["R", "C", "N"];
  const GROUP_NAME = { R: "보고", C: "상담 후 결정", N: "보고하지 않음" };
  const STAMP_TEXT = { R: "보고", C: "상담", N: "미보고" };
  const WEIGHT_SHORT = ["가계", "빈도", "기능", "예측", "위치"];
  const POLICY_KEYS = ["secondary", "minors", "noCare", "relatives"];
  const DEF = { weights: [2, 1, 3, 1, 1], t1: 12, t2: 1, counts: { R: 4, C: 8, N: 4 } };
  const SMIN = -31, SMAX = 47, CAPACITY = 8;
  const FONT_KO = '"IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 팔레트: 낮 근무(밝은 화면)와 밤 근무(어두운 화면) ---------- */
  const PALS = {
    light: {
      sky: ["#868d78", "#959a83", "#a4a790", "#b1b39b"], star: "", beam: "",
      far: "#6b6956", farDark: "#5b5948", farHi: "#7b7964", wire: "#36342c",
      ground: "#78715a", groundDark: "#6a634e", path: "#898169", pathDark: "#7b735b",
      person: "#2a2722", personRim: "#4a453c", personWait: "#3d3932",
      frame: "#2a2923", frameHi: "#4b493e", frameLo: "#1b1a16", glass: "rgba(255,255,255,0.13)",
      wall: "#4e503a", wallHi: "#606349", wallLo: "#3f412f",
      grill: "#1c1c17", grillHi: "#6a6b57",
      rail: "#2e2d26", railHi: "#4c4a3e", railLo: "#1d1c18", tick: "#99957d", tickHi: "#cfc9a8",
      zoneN: "#5c5c54", zoneC: "#957026", zoneR: "#8e3527",
      t1: "#d6553a", t2: "#dfa33a", flagInk: "#1d1812", mark: "#f6efd8",
      desk: "#5a4733", deskDark: "#4c3b2a", deskGrain: "#443525", deskHi: "#6a5640", deskEdge: "#33281c", deskEdgeHi: "#7a6448",
      paper: "#e8dec3", paperShade: "#c9bd9d", paperLine: "#b3a583", paperEdge: "#9f9170", ink: "#382f25", label: "#f1e8cf",
      R: "#b3372a", C: "#bf8424", N: "#6f6d64",
      metal: "#4b4c44", metalHi: "#6f7065", metalLo: "#32332d", metalIn: "#3b3c35",
      brass: "#a6853e", brassHi: "#cfac5f", brassLo: "#77612e", iron: "#3b3a36", ironHi: "#6b6961",
      book: "#5a2a24", bookHi: "#76392f", bookLo: "#3b1b16", gold: "#b99b4d", pages: "#d7cdaf",
      lamp: "#394938", lampHi: "#5a735c", lampLo: "#26301f", bulb: "#fff1bd", glow: "255,214,140", glowA: 0.075,
      slip: "#e5d38c", slipShade: "#c5b36b", pin: "#c23a2b",
      env: "#c4ab7e", envLo: "#a28a5f", envHi: "#d5bf95", wax: "#a02a21", waxHi: "#c9483b",
      ledOn: "#8bd86e", ledAmber: "#f2b33d", ledRed: "#e2563f", ledOff: "#2e2f29", ledSkip: "#8ea0ad",
      shutter: "#5c5b4d", shutterLo: "#4a493e", shutterHi: "#74735f",
      tp: "#4f7a32", fp: "#b3372a", fn: "#bf8424", tn: "#6f6d64"
    },
    dark: {
      sky: ["#12171b", "#161c20", "#1b2226", "#20282b"], star: "#8d9a92", beam: "rgba(214,226,190,0.07)",
      far: "#38382f", farDark: "#2e2e27", farHi: "#45453a", wire: "#121210",
      ground: "#312e27", groundDark: "#2a2822", path: "#3a372e", pathDark: "#322f28",
      person: "#0c0b09", personRim: "#2a2721", personWait: "#171612",
      frame: "#1b1a16", frameHi: "#34332b", frameLo: "#100f0d", glass: "rgba(255,255,255,0.07)",
      wall: "#31332a", wallHi: "#3f4236", wallLo: "#25271f",
      grill: "#0f0f0c", grillHi: "#4c4d40",
      rail: "#1f1e1a", railHi: "#38362e", railLo: "#121210", tick: "#7d7a66", tickHi: "#b8b293",
      zoneN: "#4a4a43", zoneC: "#806020", zoneR: "#7a2e22",
      t1: "#e8664a", t2: "#eab24a", flagInk: "#1b1712", mark: "#efe3c4",
      desk: "#3d3024", deskDark: "#33281e", deskGrain: "#2d2319", deskHi: "#4a3b2c", deskEdge: "#211912", deskEdgeHi: "#5a4835",
      paper: "#d6cba9", paperShade: "#b3a786", paperLine: "#9f9373", paperEdge: "#8a7e60", ink: "#2e261d", label: "#e6d9b8",
      R: "#c2402f", C: "#c98d2a", N: "#7a776c",
      metal: "#3d3e38", metalHi: "#5c5d53", metalLo: "#262722", metalIn: "#2f302a",
      brass: "#a07f3a", brassHi: "#cba85a", brassLo: "#6e592a", iron: "#2d2c29", ironHi: "#5b5952",
      book: "#4d231e", bookHi: "#673128", bookLo: "#311612", gold: "#ad9046", pages: "#c9bf9f",
      lamp: "#2f3c2e", lampHi: "#4f6651", lampLo: "#1d251a", bulb: "#fff0b0", glow: "255,204,120", glowA: 0.085,
      slip: "#d8c67f", slipShade: "#b6a462", pin: "#d0412f",
      env: "#b29b6f", envLo: "#8f7a52", envHi: "#c4ad84", wax: "#a82c22", waxHi: "#cf4b3c",
      ledOn: "#8fe070", ledAmber: "#f5b840", ledRed: "#ea5a42", ledOff: "#24251f", ledSkip: "#94a7b5",
      shutter: "#46453b", shutterLo: "#38372f", shutterHi: "#5a594b",
      tp: "#6f9a48", fp: "#c2402f", fn: "#c98d2a", tn: "#7a776c"
    }
  };

  /* ---------- 3×5 픽셀 숫자 글꼴(번호·장수·문턱 값) ---------- */
  const GLYPH = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001010010010",
    "8": "111101111101111", "9": "111101111001111", "-": "000000111000000", "/": "001001010100100",
    "T": "111010010010010", "P": "110101110100100", " ": "000000000000000"
  };
  const pWidth = s => Math.max(0, String(s).length * 4 - 1);
  function pText(c, s, x, y, col) {
    c.fillStyle = col;
    let cx = Math.round(x);
    const yy = Math.round(y);
    for (const ch of String(s)) {
      const gl = GLYPH[ch] || GLYPH[" "];
      for (let i = 0; i < 15; i++) if (gl.charCodeAt(i) === 49) c.fillRect(cx + (i % 3), yy + ((i / 3) | 0), 1, 1);
      cx += 4;
    }
  }

  /* ---------- 픽셀 도구(저해상도 캔버스 좌표 = 정수 칸) ---------- */
  function rect(c, x, y, w, h, col) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function line(c, x0, y0, x1, y1, col, th) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const t = th || 1;
    c.fillStyle = col;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4000; n++) {
      c.fillRect(x0, y0, t, t);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function ellipse(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let y = -ry; y <= ry; y++) {
      const k = 1 - (y * y) / ((ry + 0.5) * (ry + 0.5));
      if (k <= 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      c.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  }
  // 체크 무늬 디더(흙바닥)
  function checker(c, x, y, w, h, a, b, step) {
    rect(c, x, y, w, h, a);
    c.fillStyle = b;
    const s = step || 2;
    for (let yy = 0; yy < h; yy++) for (let xx = (yy % 2) * (s >> 1); xx < w; xx += s) c.fillRect(x + xx, y + yy, 1, 1);
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 게임 상태 읽기 ---------- */
  let CARDS = null;
  function cardsOf(model) {
    if (CARDS) return CARDS;
    try {
      const list = model && typeof model.cards === "function" ? model.cards() : null;
      if (Array.isArray(list) && list.length) {
        CARDS = list.filter(v => v && typeof v.id === "string" && Array.isArray(v.e) && v.e.length === 5)
          .map(v => ({ id: v.id, e: v.e.map(Number) }));
      }
    } catch (e) { CARDS = null; }
    return CARDS;
  }
  // 모형을 쓸 수 없을 때만 화면의 장수를 읽는다.
  function domCounts(root) {
    if (!root || !root.querySelector) return null;
    const out = {};
    for (const k of GROUPS) {
      const el = root.querySelector(`#vd-count-${k}`);
      const n = el ? parseInt(el.textContent, 10) : NaN;
      if (!Number.isFinite(n)) return null;
      out[k] = n;
    }
    return out;
  }
  function readDesk(ctx) {
    const model = ctx.model || null;
    let g = null;
    if (model && typeof model.normalizeGame === "function") {
      try { g = model.normalizeGame(ctx.game || {}); } catch (e) { g = null; }
    }
    const s = g ? (g.locked || g) : null;
    const weights = s && Array.isArray(s.weights) && s.weights.length === 5 ? s.weights.map(w => clamp(Number(w) || 0, 0, 3)) : DEF.weights.slice();
    const t1 = s && Number.isFinite(s.t1) ? s.t1 : DEF.t1;
    const t2 = s && Number.isFinite(s.t2) ? s.t2 : DEF.t2;
    const overrides = s && s.overrides && typeof s.overrides === "object" ? s.overrides : {};
    const classify = model && typeof model.classify === "function"
      ? score => model.classify(score, { t1, t2 })
      : score => (score >= t1 ? "R" : score >= t2 ? "C" : "N");
    const cards = cardsOf(model);
    const rows = [];
    let counts = { R: 0, C: 0, N: 0 };
    if (cards) {
      for (const v of cards) {
        let score = 0;
        for (let k = 0; k < 5; k++) score += v.e[k] * weights[k];
        const auto = classify(score);
        const ov = own(overrides, v.id) ? overrides[v.id] : null;
        const group = ov && GROUPS.includes(ov.to) ? ov.to : (GROUPS.includes(auto) ? auto : "N");
        rows.push({ id: v.id, score, auto, group, manual: !!ov });
        counts[group]++;
      }
    } else {
      counts = domCounts(ctx.root) || { ...DEF.counts };
    }
    const order = cards ? cards.map(v => v.id) : [];
    const manualIds = Object.keys(overrides).filter(id => overrides[id] && GROUPS.includes(overrides[id].to))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const mode = g && ["pending", "apply", "skip"].includes(g.policyMode) ? g.policyMode : "pending";
    const policy = {};
    POLICY_KEYS.forEach(k => { const v = g && g.policy ? g.policy[k] : null; policy[k] = typeof v === "boolean" ? v : null; });
    const decided = POLICY_KEYS.filter(k => policy[k] !== null).length;
    const stage1 = !!(g && g.stage1Confirmed);
    const locked = !!(g && g.locked);
    const revealed = !!(g && (g.revealed || g.locked));
    // 상담 수요: 정책을 정하기 전에는 보고 + 상담 후 결정 칸 전체, 정한 뒤에는 게임 계산값(혈족 검토 포함).
    let demand = counts.R + counts.C, cm = null;
    if (g && model && typeof model.compute === "function" && (mode === "skip" || (mode === "apply" && decided === 4))) {
      try {
        const r = model.compute(g);
        if (r) {
          if (Number.isFinite(r.demand)) demand = r.demand;
          if (revealed && r.r) cm = r.r;
        }
      } catch (e) { cm = null; }
    }
    return { weights, t1, t2, rows, counts, manualIds, overrides, mode, policy, decided, stage1, locked, revealed, demand, cm };
  }

  /* ---------- 칩·설명 ---------- */
  function policyChip(d) {
    if (d.mode === "skip") return { label: "정책", value: "건너뜀", tone: "muted" };
    if (d.mode === "apply") return d.decided === 4 ? { label: "정책", value: "적용", tone: "ok" } : { label: "정책", value: `검토 ${d.decided}/4`, tone: "warn" };
    return d.stage1 ? { label: "정책", value: "선택 전", tone: "warn" } : { label: "정책", value: "대기", tone: "muted" };
  }
  function makeChips(d, w) {
    const n = d.manualIds.length;
    const narrow = w < 560;
    const chips = [
      { label: "보고", value: String(d.counts.R), tone: "report" },
      { label: "상담", value: String(d.counts.C), tone: "consult" },
      { label: "미보고", value: String(d.counts.N), tone: "none" }
    ];
    if (!narrow) chips.push({ label: "수동", value: `${n}/3`, tone: n ? "warn" : "muted" });
    chips.push(d.locked ? { label: "기준", value: "확정", tone: "ok" } : policyChip(d));
    if (!narrow) {
      if (d.locked) chips.push(policyChip(d));
      chips.push({ label: "상담 수요", value: `${d.demand}/${CAPACITY}`, tone: d.demand > CAPACITY ? "warn" : "ok" });
      if (d.revealed && !d.locked) chips.push({ label: "결과", value: "공개", tone: "info" });
    }
    return chips;
  }
  function policyText(d) {
    if (d.mode === "skip") return "정책 단계 건너뜀";
    if (d.mode === "apply") return d.decided === 4 ? "정책 네 개 적용" : `정책 ${d.decided}/4 선택`;
    return d.stage1 ? "정책 단계 선택 전" : "정책 단계는 1단계 확정 뒤";
  }
  function caption(d) {
    const w = d.weights;
    let out = `검문 부스 판독대 장면. 서류함: 보고 ${d.counts.R}장, 상담 후 결정 ${d.counts.C}장, 보고하지 않음 ${d.counts.N}장. `
      + `증거 저울: 가계 ${w[0]}, 빈도 ${w[1]}, 기능 ${w[2]}, 예측 ${w[3]}, 같은 위치 ${w[4]}. 보고선 ${d.t1}, 상담선 ${d.t2}. `
      + `수동 변경 쪽지 ${d.manualIds.length}장. ${policyText(d)}. 상담 줄 ${d.demand}명, 동시 상담 ${CAPACITY}건${d.demand > CAPACITY ? " — 대기 발생" : ""}.`;
    if (d.revealed && d.cm) out += ` 공개된 대조표(보고만 양성): 맞게 보고 ${d.cm.TP}, 비병원성을 보고 ${d.cm.FP}, 병원성을 보고하지 않음 ${d.cm.FN}, 비병원성을 보고하지 않음 ${d.cm.TN}.`;
    if (d.locked) out += " 기준 확정 도장이 찍혀 있습니다.";
    return out;
  }
  function chipRows(chips, w) {
    if (!chips.length) return 0;
    const fs = w < 760 ? 12 : 12.5;
    const width = c => 22 + String(c.label).length * fs + 5 + String(c.value).length * fs * 0.8;
    const avail = Math.max(120, w - 20);
    let rows = 1, x = 0;
    for (const c of chips) {
      const cw = width(c);
      if (x > 0 && x + cw > avail) { rows++; x = 0; }
      x += cw + 6;
    }
    return rows;
  }

  function chipsWidth(chips, w) {
    const fs = w < 760 ? 12 : 12.5;
    return chips.reduce((s, c) => s + 28 + String(c.label).length * fs + 5 + String(c.value).length * fs * 0.8 + 6, 0);
  }

  /* ---------- 배치(칸 단위) ---------- */
  function layoutFor(GW, GH, P, thumb, rows) {
    const narrow = GW < 300;
    const L = { GW, GH, P, thumb, narrow, wide: !narrow };
    L.WH = narrow && GH < 80 && !thumb ? 15 : clamp(Math.round(GH * (narrow ? 0.27 : 0.28)), 12, 30);
    L.RH = narrow ? (GH < 80 ? 6 : 7) : (GH < 80 ? 7 : 9);
    L.DY = L.WH + L.RH;
    const chipPx = thumb || !rows ? 0 : 10 + rows * 25 + (rows - 1) * 6 + 3;
    L.BOT = Math.max(L.DY + 16, GH - Math.ceil(chipPx / P));
    L.wallW = narrow ? 14 : 22;
    L.wx1 = GW - L.wallW;                  // 창유리 오른쪽 끝(부스 벽 시작)
    L.paneH = L.WH - 3;                    // 창턱 위 유리 높이
    L.rx0 = narrow ? 3 : 5;
    L.rx1 = L.wx1 - (narrow ? 3 : 5);
    L.sp = narrow ? 5 : 7;                 // 줄 간격
    L.pw = narrow ? 3 : 5;                 // 사람 폭
    L.capGap = narrow ? 3 : 5;             // 정원 표지 앞뒤 간격
    L.door = L.wx1 - (narrow ? 3 : 5);     // 맨 앞사람 오른쪽 끝
    L.feet = L.paneH - 2;                  // 발 위치
    L.lampW = narrow ? (GW < 170 ? 10 : 13) : 22;
    // 책상 물건 배치: 왼쪽부터, 공간이 모자라면 덜 중요한 것부터 뺀다.
    L.tw = narrow ? (GW >= 170 ? 24 : 20) : 50; L.tg = narrow ? 3 : 8;
    const items = narrow
      ? [["scale", GW < 170 ? 36 : 40, 1], ["trays", L.tw * 3 + L.tg * 2, 0], ["policy", 15, 2], ["ledger", 20, 3]]
      : [["book", 30, 4], ["scale", 84, 1], ["trays", L.tw * 3 + L.tg * 2, 0], ["ledger", 40, 3], ["policy", 28, 2]];
    const margin = narrow ? 2 : 5, gap0 = narrow ? 3 : 7;
    const avail = GW - margin * 2 - L.lampW;
    const need = list => list.reduce((s, it) => s + it[1], 0) + gap0 * (list.length - 1);
    const list = items.slice();
    while (list.length > 1 && need(list) > avail) {
      let worst = 0;
      list.forEach((it, i) => { if (it[2] > list[worst][2]) worst = i; });
      list.splice(worst, 1);
    }
    const extra = Math.max(0, avail - need(list));
    const gap = gap0 + Math.min(narrow ? 6 : 16, Math.floor(extra / (list.length + 1)));
    const used = need(list) + (gap - gap0) * (list.length - 1);
    let x = margin + Math.max(0, Math.floor((avail - used) / 2));
    L.items = {};
    L.top = L.DY + 2;
    L.AH = L.BOT - L.top - 1;
    list.forEach(it => { L.items[it[0]] = { x, y: L.top, w: it[1], h: L.AH }; x += it[1] + gap; });
    return L;
  }
  const qx = (L, i) => L.door - L.pw - 1 - i * L.sp - (i >= CAPACITY ? L.capGap : 0);
  const xOf = (L, s) => Math.round(L.rx0 + ((clamp(s, SMIN, SMAX) - SMIN) * (L.rx1 - L.rx0)) / (SMAX - SMIN));
  function lampGeo(L) {
    const hx = L.GW - (L.narrow ? 8 : 13), hy = L.DY + (L.narrow ? 1 : 2);
    return { hx, hy, gx: hx - (L.narrow ? 16 : 40), gy: L.DY + Math.round((L.BOT - L.DY) * 0.42), rx: L.narrow ? 36 : 96, ry: Math.max(8, Math.round((L.BOT - L.DY) * 0.56)) };
  }

  /* ---------- 캐시: 장면과 홈 미리보기는 따로 둔다 ---------- */
  const SLOT = { stage: { key: "" }, thumb: { key: "" } };
  function canvasOf(slot, name, w, h) {
    let cv = slot[name];
    if (!cv) { cv = document.createElement("canvas"); slot[name] = cv; }
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    return cv;
  }

  /* ---------- 정적 배경: 바깥 풍경, 창틀, 부스 벽, 레일 바탕, 책상 ---------- */
  function drawBackground(c, L, pal) {
    const { GW, GH, WH, paneH, wx1 } = L;
    const R = rng(7 + GW * 13 + GH);
    // 하늘 띠
    const horizon = Math.round(paneH * 0.58);
    const bands = pal.sky.length;
    for (let i = 0; i < bands; i++) {
      const y0 = Math.round((horizon * i) / bands), y1 = Math.round((horizon * (i + 1)) / bands);
      rect(c, 0, y0, wx1, y1 - y0, pal.sky[i]);
      if (i > 0) { c.fillStyle = pal.sky[i]; for (let xx = (i * 3) % 4; xx < wx1; xx += 4) c.fillRect(xx, y0 - 1, 2, 1); }
    }
    if (pal.star) {
      c.fillStyle = pal.star;
      const n = Math.round(wx1 / 9);
      for (let i = 0; i < n; i++) c.fillRect(Math.floor(R() * wx1), Math.floor(R() * horizon * 0.7), 1, 1);
    }
    if (pal.beam) {
      // 탐조등 빛줄기
      c.fillStyle = pal.beam;
      const bx = Math.round(wx1 * 0.62);
      for (let y = 0; y < horizon; y++) c.fillRect(bx - Math.round(y * 0.9) - 6, y, 6 + Math.round(y * 0.5), 1);
    }
    // 먼 담장과 철조망, 감시탑
    const wallTop = horizon - Math.max(3, Math.round(paneH * 0.2));
    rect(c, 0, wallTop, wx1, horizon - wallTop + 1, pal.far);
    rect(c, 0, wallTop, wx1, 1, pal.farHi);
    c.fillStyle = pal.farDark;
    const bh = Math.max(2, Math.round((horizon - wallTop) / 2));
    for (let y = wallTop + bh; y < horizon; y += bh) c.fillRect(0, y, wx1, 1);
    for (let y = wallTop + 1, row = 0; y < horizon; y += bh, row++) for (let xx = (row % 2) * 5; xx < wx1; xx += 10) c.fillRect(xx, y, 1, bh - 1);
    c.fillStyle = pal.wire;
    for (let xx = 0; xx < wx1; xx++) c.fillRect(xx, wallTop - 2 + ((xx >> 1) % 2), 1, 1);
    for (let xx = 4; xx < wx1; xx += 14) c.fillRect(xx, wallTop - 4, 1, 4);
    const tx = Math.round(wx1 * (L.narrow ? 0.62 : 0.4));
    if (wallTop > 12) {
      rect(c, tx, wallTop - 8, 1, 8, pal.farDark);
      rect(c, tx + 5, wallTop - 8, 1, 8, pal.farDark);
      rect(c, tx - 1, wallTop - 11, 8, 3, pal.farDark);
      rect(c, tx - 2, wallTop - 12, 10, 1, pal.wire);
    }
    // 땅과 줄 서는 길
    checker(c, 0, horizon + 1, wx1, paneH - horizon - 1, pal.ground, pal.groundDark, 4);
    const pathY = L.feet - 1;
    rect(c, 0, pathY, wx1, paneH - pathY, pal.path);
    c.fillStyle = pal.pathDark;
    for (let xx = 0; xx < wx1; xx += 3) c.fillRect(xx, pathY + ((xx / 3) % 2 ? 1 : 0), 1, 1);
    // 상담 정원 표지(8번째 사람 뒤)와 줄 벨트
    const free = L.sp - L.pw + L.capGap;
    const signX = qx(L, CAPACITY - 1) - Math.ceil(free / 2);
    if (signX > 3) {
      rect(c, signX, L.feet - 8, 1, 8, pal.frameLo);
      if (L.wide && !L.thumb) {
        rect(c, signX - 2, L.feet - 15, 5, 7, pal.paper);
        rect(c, signX - 2, L.feet - 15, 5, 1, pal.R);
        pText(c, String(CAPACITY), signX - 1, L.feet - 14 + 1, pal.ink);
      } else {
        rect(c, signX - 1, L.feet - 11, 3, 4, pal.paper);
        rect(c, signX - 1, L.feet - 11, 3, 1, pal.R);
      }
    }
    // 창틀: 위 테, 창살, 창턱
    rect(c, 0, 0, wx1, 2, pal.frame);
    rect(c, 0, 2, wx1, 1, pal.frameLo);
    const panes = L.narrow ? 2 : 4;
    for (let i = 1; i < panes; i++) {
      const mx = Math.round((wx1 * i) / panes);
      rect(c, mx - 1, 0, 2, paneH, pal.frame);
      rect(c, mx - 1, 0, 1, paneH, pal.frameHi);
    }
    // 유리 반사 줄
    c.fillStyle = pal.glass;
    for (let i = 0; i < panes; i++) {
      const px = Math.round((wx1 * i) / panes) + Math.round((wx1 / panes) * 0.18);
      for (let k = 0; k < Math.min(paneH - 4, 12); k++) { c.fillRect(px + k, 3 + k, 2, 1); c.fillRect(px + k + 5, 3 + k, 1, 1); }
    }
    rect(c, 0, paneH, wx1, 3, pal.frame);
    rect(c, 0, paneH, wx1, 1, pal.frameHi);
    rect(c, 0, WH - 1, wx1, 1, pal.frameLo);
    // 부스 벽(오른쪽): 인터컴 스피커 그릴
    rect(c, wx1, 0, GW - wx1, WH, pal.wall);
    rect(c, wx1, 0, 1, WH, pal.frameLo);
    rect(c, wx1 + 1, 0, 1, WH, pal.wallHi);
    c.fillStyle = pal.wallLo;
    for (let y = 3; y < WH; y += 6) c.fillRect(wx1 + 2, y, GW - wx1 - 2, 1);
    const gx = wx1 + (L.narrow ? 3 : 4), gw = GW - wx1 - (L.narrow ? 5 : 8), gy = L.narrow ? 3 : 4, gh = Math.max(6, Math.round(WH * 0.42));
    rect(c, gx - 1, gy - 1, gw + 2, gh + 2, pal.grillHi);
    rect(c, gx, gy, gw, gh, pal.grill);
    c.fillStyle = pal.grillHi;
    for (let y = gy + 1; y < gy + gh - 1; y += 2) c.fillRect(gx + 1, y, gw - 2, 1);
    // 레일(점수 눈금) 바탕
    const ry = WH;
    rect(c, 0, ry, GW, L.RH, pal.rail);
    rect(c, 0, ry, GW, 1, pal.railHi);
    rect(c, 0, ry + L.RH - 1, GW, 1, pal.railLo);
    const trackY = ry + L.RH - 4;
    rect(c, L.rx0 - 1, trackY - 1, L.rx1 - L.rx0 + 3, 4, pal.railLo);
    for (let s = -30; s <= SMAX; s += 5) rect(c, xOf(L, s), trackY + 2, 1, 1, s % 10 === 0 ? pal.tickHi : pal.tick);
    rect(c, xOf(L, 0), trackY + 2, 1, 1, pal.tickHi);
    // 책상: 판자, 나뭇결, 앞 모서리
    const dy = L.DY;
    rect(c, 0, dy, GW, GH - dy, pal.desk);
    rect(c, 0, dy, GW, 1, pal.deskEdge);
    rect(c, 0, dy + 1, GW, 1, pal.deskHi);
    const plank = L.narrow ? 10 : 13;
    for (let y = dy + plank; y < GH - 3; y += plank) {
      rect(c, 0, y, GW, 1, pal.deskDark);
      c.fillStyle = pal.deskDark;
      const off = Math.floor(R() * 40);
      for (let xx = off; xx < GW; xx += 47 + Math.floor(R() * 30)) c.fillRect(xx, y - plank + 1, 1, plank - 1);
    }
    const grains = Math.round((GW * (GH - dy)) / 60);
    for (let i = 0; i < grains; i++) {
      const gx2 = Math.floor(R() * GW), gy2 = dy + 2 + Math.floor(R() * (GH - dy - 4)), len = 3 + Math.floor(R() * 12);
      rect(c, gx2, gy2, len, 1, R() < 0.7 ? pal.deskGrain : pal.deskHi);
    }
    rect(c, 0, GH - 3, GW, 1, pal.deskEdgeHi);
    rect(c, 0, GH - 2, GW, 2, pal.deskEdge);
    // 벽 등 빛(책상 위 따뜻한 원, 단계별 띠)
    const lc = lampGeo(L);
    for (let b = 0; b < 4; b++) {
      const k = 1 - b * 0.23;
      ellipse(c, lc.gx, lc.gy, Math.round(lc.rx * k), Math.round(lc.ry * k), `rgba(${pal.glow},${pal.glowA})`);
    }
    return { x: gx, y: gy, w: gw, h: gh };
  }

  /* ---------- 창: 줄 선 사람들, 덧문, 쪽지, 인터컴 ---------- */
  function person(c, L, pal, x, i, wait, bob) {
    const n = L.narrow;
    const tall = n ? (i % 3 === 1 ? 8 : 7) : (i % 3 === 1 ? 11 : 10);
    const w = L.pw;
    const col = wait ? pal.personWait : pal.person;
    const top = L.feet - tall + bob;
    const hx = x + (n ? 0 : 1);
    if (i % 3 === 0) {
      // 모자 쓴 사람
      rect(c, hx, top, 3, 1, col);
      rect(c, hx - 1, top + 1, 5, 1, col);
      rect(c, hx, top + 2, 3, n ? 1 : 2, col);
    } else {
      rect(c, hx, top + 1, 3, n ? 2 : 3, col);
    }
    const by = top + (n ? 3 : 4), bodyH = tall - (n ? 5 : 6);
    rect(c, x, by, w, bodyH, col);
    rect(c, x, by, 1, bodyH, pal.personRim);
    const ly = L.feet - 2 + bob;
    rect(c, x + (n ? 0 : 1), ly, 1, 2 - bob, col);
    rect(c, x + w - (n ? 1 : 2), ly, 1, 2 - bob, col);
    if (i % 5 === 2 && !n) rect(c, x + w, by + 3, 2, 3, pal.personRim);
  }
  function drawQueue(c, L, pal, n, t, moving) {
    for (let i = 0; i < n; i++) {
      const x = qx(L, i);
      if (x < -6) break;
      const bob = moving && Math.sin(t * 5.2 + i * 1.9) > 0.55 ? -1 : 0;
      person(c, L, pal, x, i, i >= CAPACITY, bob);
    }
  }
  function drawShutter(c, L, pal, f) {
    if (f <= 0.01) return 0;
    const bottom = Math.round(L.paneH * f);
    for (let y = 0; y < bottom; y++) rect(c, 0, y, L.wx1, 1, y % 3 === 2 ? pal.shutterLo : pal.shutter);
    rect(c, 0, bottom - 2, L.wx1, 2, pal.shutterLo);
    rect(c, 0, bottom - 2, L.wx1, 1, pal.shutterHi);
    const hx = Math.round(L.wx1 * 0.5);
    rect(c, hx - 3, bottom - 1, 7, 1, pal.frameLo);
    return bottom;
  }
  // 도장 테두리(굵은 선 또는 이중 선, 잉크가 덜 묻은 자리)
  function stampFrame(c, x, y, w, h, col, gapCol, thick) {
    const b = thick ? 2 : 1;
    rect(c, x, y, w, b, col); rect(c, x, y + h - b, w, b, col);
    rect(c, x, y, b, h, col); rect(c, x + w - b, y, b, h, col);
    if (!thick && w > 14 && h >= 13) {
      rect(c, x + 2, y + 2, w - 4, 1, col); rect(c, x + 2, y + h - 3, w - 4, 1, col);
      rect(c, x + 2, y + 2, 1, h - 4, col); rect(c, x + w - 3, y + 2, 1, h - 4, col);
    }
    if (gapCol) {
      c.fillStyle = gapCol;
      for (let i = 3; i < w - 2; i += 7) c.fillRect(x + i, (i / 7) % 2 >= 1 ? y + h - 1 : y, 2, 1);
    }
  }
  function drawSlips(c, L, pal, d, detail) {
    const sw = L.narrow ? 11 : 19, sh = L.narrow ? 8 : 11;
    d.manualIds.slice(0, 3).forEach((id, i) => {
      const x = L.wx1 - 4 - (i + 1) * (sw + (L.narrow ? 2 : 4)) + 1;
      const y = 4 + (i % 2);
      if (x < 2) return;
      rect(c, x + 1, y + 1, sw, sh, "rgba(0,0,0,0.28)");
      rect(c, x, y, sw, sh, pal.slip);
      rect(c, x, y + sh - 1, sw, 1, pal.slipShade);
      const to = d.overrides[id] && d.overrides[id].to;
      rect(c, x + 1, y + sh - 3, sw - 2, 1, pal[to] || pal.N);
      if (L.wide && detail) pText(c, id, x + 2, y + 3, pal.ink);
      else { rect(c, x + 2, y + 3, sw - 4, 1, pal.ink); rect(c, x + 2, y + 5, sw - 6, 1, pal.paperLine); }
      rect(c, x + Math.floor(sw / 2) - 1, y - 1, 2, 2, pal.pin);
    });
  }
  function drawIntercom(c, L, pal, gr, t, active, moving) {
    if (!gr) return;
    const ly = gr.y + gr.h + 2;
    if (ly + 2 <= L.WH) {
      const on = active && (!moving || Math.sin(t * 7) > -0.6);
      rect(c, gr.x + Math.floor(gr.w / 2) - 1, ly, 2, 2, on ? pal.ledOn : pal.ledOff);
    }
    if (active) {
      // 말소리 물결(면접실)
      const k = moving ? Math.floor(t * 4) % 3 : 2;
      for (let i = 0; i <= k; i++) rect(c, gr.x - 3 - i * 2, gr.y + Math.floor(gr.h / 2) - 1 - i, 1, 3 + i * 2, pal.tickHi);
    }
  }

  /* ---------- 레일: 영역, 카드 점, 문턱 깃발 ---------- */
  function drawRail(c, L, pal, d, detail) {
    const trackY = L.WH + L.RH - 4;
    const x2 = xOf(L, d.t2), x1 = xOf(L, d.t1);
    rect(c, L.rx0, trackY, Math.max(0, x2 - L.rx0), 2, pal.zoneN);
    rect(c, x2, trackY, Math.max(0, x1 - x2), 2, pal.zoneC);
    rect(c, x1, trackY, Math.max(0, L.rx1 - x1 + 1), 2, pal.zoneR);
    // 카드 점: 같은 자리면 위로 쌓고, 넘치면 옆으로 민다.
    const pw = L.narrow ? 1 : 2, levels = Math.max(1, Math.floor((trackY - L.WH - 1) / 2));
    const placed = [];
    const rows = d.rows.slice().sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
    for (const v of rows) {
      const base = xOf(L, v.score);
      let spot = null;
      for (let shift = 0; shift < 40 && !spot; shift++) {
        const dx = shift === 0 ? 0 : (shift % 2 ? 1 : -1) * Math.ceil(shift / 2) * (pw + 1);
        for (let lev = 0; lev < levels && !spot; lev++) {
          const x = base + dx;
          if (!placed.some(p => p.lev === lev && Math.abs(p.x - x) <= pw)) spot = { x, lev };
        }
      }
      if (!spot) spot = { x: base, lev: levels - 1 };
      placed.push(spot);
      const y = trackY - 2 - spot.lev * 2;
      rect(c, spot.x, y, pw, 2, pal[v.group]);
      if (v.manual) rect(c, spot.x, y - 1, pw, 1, pal.mark);
    }
    const fl = flagGeo(L, d, detail);
    const flag = (f, col) => {
      rect(c, f.x, f.y, 1, L.WH + L.RH - f.y, col);
      rect(c, f.x0 + 1, f.y + 1, f.fw, f.fh, "rgba(0,0,0,0.35)");
      rect(c, f.x0, f.y, f.fw, f.fh, col);
      if (f.txt) pText(c, f.txt, f.x0 + 2, f.y + 1, pal.flagInk);
    };
    flag(fl.t2, pal.t2);
    flag(fl.t1, pal.t1);
  }
  // 문턱 깃발 자리: T1은 오른쪽, T2는 왼쪽으로. 가장자리에서는 뒤집고, 겹치면 T2를 한 줄 위로 올린다.
  function flagGeo(L, d, detail) {
    const fh = 7, fy = L.WH - fh - 1;
    const spec = (x, val, tag, left) => {
      const txt = detail ? (L.wide ? `${tag} ${val}` : String(val)) : "";
      const fw = detail ? pWidth(txt) + 4 : 4;
      let lft = left;
      if (!lft && x + fw > L.GW - 1) lft = true;
      if (lft && x - fw + 1 < 0) lft = false;
      const x0 = lft ? x - fw + 1 : x;
      return { x, txt, fw, fh, x0, x1: x0 + fw - 1, y: fy };
    };
    const t1 = spec(xOf(L, d.t1), d.t1, "T1", false), t2 = spec(xOf(L, d.t2), d.t2, "T2", true);
    if (!(t1.x1 < t2.x0 - 1 || t2.x1 < t1.x0 - 1)) t2.y = Math.max(0, fy - fh - 1);
    return { t1, t2 };
  }

  /* ---------- 책상 물건 ---------- */
  function drawBook(c, L, pal, box, open) {
    const bw = Math.min(box.w, 30), bh = Math.min(box.h - 2, 38);
    if (bh < 14) return;
    const x = box.x, y = box.y + Math.max(0, Math.floor((box.h - bh) / 2) - 1);
    rect(c, x + 2, y + 2, bw, bh, "rgba(0,0,0,0.3)");
    if (open) {
      // 성찰: 펼친 규정집
      rect(c, x, y, bw, bh, pal.bookLo);
      rect(c, x + 1, y + 1, bw - 2, bh - 2, pal.pages);
      rect(c, x + Math.floor(bw / 2), y + 1, 1, bh - 2, pal.paperEdge);
      c.fillStyle = pal.paperLine;
      for (let yy = y + 4; yy < y + bh - 3; yy += 3) { c.fillRect(x + 3, yy, Math.floor(bw / 2) - 5, 1); c.fillRect(x + Math.floor(bw / 2) + 3, yy, Math.floor(bw / 2) - 6, 1); }
      rect(c, x + 3, y + 4, Math.floor(bw / 2) - 8, 1, pal.ink);
      rect(c, x + bw - 9, y + bh - 1, 2, 4, pal.R);
      return;
    }
    rect(c, x, y, bw, bh, pal.book);
    rect(c, x, y, 4, bh, pal.bookLo);
    rect(c, x + 4, y, 1, bh, pal.bookHi);
    rect(c, x + bw - 2, y + 1, 2, bh - 2, pal.pages);
    rect(c, x + 5, y + bh - 2, bw - 7, 2, pal.pages);
    rect(c, x + 7, y + 4, bw - 12, 1, pal.gold);
    rect(c, x + 7, y + bh - 6, bw - 12, 1, pal.gold);
    // 표지 문장: 이중 나선
    const cx = x + Math.floor((bw + 4) / 2), cy = y + Math.floor(bh / 2) - 2;
    for (let k = 0; k < 11; k++) {
      const o = Math.round(Math.sin(k * 0.62) * 3);
      rect(c, cx + o, cy - 5 + k, 1, 1, pal.gold);
      rect(c, cx - o, cy - 5 + k, 1, 1, pal.gold);
      if (k % 2 === 0 && Math.abs(o) > 1) rect(c, cx - Math.abs(o) + 1, cy - 5 + k, Math.abs(o) * 2 - 1, 1, pal.brassLo);
    }
    rect(c, x + bw - 10, y + bh, 2, 4, pal.R);
  }
  function drawScale(c, L, pal, box, weights, tilt, detail) {
    const wide = L.wide;
    const cx = box.x + Math.floor(box.w / 2);
    const short = box.h < 34;
    const py = box.y + (wide ? 3 : 2);
    const spacing = Math.floor((box.w - (wide ? 8 : 4)) / 5);
    const half = spacing * 2 + (wide ? 4 : 2);
    const s = Math.sin(tilt) * (short ? 0.5 : 1);
    const strLen = wide ? clamp(Math.round(box.h * 0.3), 5, 14) : clamp(Math.round(box.h * 0.24), 4, 8);
    // 레일에 매단 사슬과 고리
    for (let y = L.DY; y < py - 1; y++) rect(c, cx, y, 1, 1, (y - L.DY) % 2 ? pal.ironHi : pal.iron);
    // 저울대
    const ly = py + Math.round(-half * s), ry = py + Math.round(half * s);
    line(c, cx - half, ly, cx + half, ry, pal.brassLo, wide ? 2 : 1);
    line(c, cx - half, ly, cx + half, ry, pal.brass, 1);
    rect(c, cx - 1, py - 2, 3, 3, pal.brassHi);
    rect(c, cx, py - 1, 1, 1, pal.brassLo);
    rect(c, cx - half - 1, ly - 1, 2, 2 + (wide ? 1 : 0), pal.brassHi);
    rect(c, cx + half, ry - 1, 2, 2 + (wide ? 1 : 0), pal.brassHi);
    const pans = [];
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * spacing;
      const hx = cx + off, hy = py + Math.round(off * s);
      const panW = wide ? 11 : 7, h2 = Math.floor(panW / 2);
      const panY = hy + strLen;
      line(c, hx, hy + 1, hx - h2, panY, pal.iron, 1);
      line(c, hx, hy + 1, hx + h2, panY, pal.iron, 1);
      rect(c, hx, hy, 1, 2, pal.iron);
      // 추: 무게만큼 쌓는다
      const bw = wide ? 5 : 3, bh = wide ? 3 : 2;
      for (let j = 0; j < weights[k]; j++) {
        const by = panY - (j + 1) * bh;
        rect(c, hx - Math.floor(bw / 2), by, bw, bh, pal.iron);
        rect(c, hx - Math.floor(bw / 2), by, bw, 1, pal.ironHi);
      }
      rect(c, hx - h2, panY, panW, 1, pal.brassHi);
      rect(c, hx - h2 + 1, panY + 1, panW - 2, 1, pal.brass);
      rect(c, hx - h2 + 2, panY + 2, panW - 4, 1, pal.brassLo);
      pans.push({ x: hx, y: panY + 3, w: weights[k] });
    }
    // 무게 표 쪽지: 저울 아래 책상에 한 줄로 놓는다.
    let tagY = -1;
    if (detail) {
      const lowest = Math.max(...pans.map(p => p.y));
      tagY = lowest + (wide ? 3 : 2);
      if (tagY + 7 > box.y + box.h) tagY = -1;
      if (tagY >= 0) {
        const tw = wide ? 7 : 5, tl = wide ? 3 : 2;
        for (const p of pans) {
          rect(c, p.x - tl + 1, tagY + 1, tw, 7, "rgba(0,0,0,0.3)");
          rect(c, p.x - tl, tagY, tw, 7, pal.label);
          rect(c, p.x - tl, tagY + 6, tw, 1, pal.paperShade);
          pText(c, String(p.w), p.x - 1, tagY + 1, pal.ink);
        }
      }
    }
    return { pans, short, tagY };
  }
  function drawTray(c, L, pal, x, box, g, n, detail) {
    const wide = L.wide;
    const tw = L.tw, lip = 7;
    const bottom = box.y + box.h - 1;
    const room = box.h - lip - 4;
    const sh = wide ? clamp(room - 16, 6, 14) : clamp(room - 16, 5, 9);
    const stackRoom = Math.max(2, room - sh);
    const step = n <= 1 ? 1 : Math.min(wide ? 2 : 1.5, stackRoom / (n - 1));
    const sw = tw - 6;
    const lipTop = bottom - lip + 1;
    const trayTop = lipTop - sh - 4;
    // 서류함 몸체(뒤)
    rect(c, x + 2, trayTop + 2, tw, bottom - trayTop, "rgba(0,0,0,0.3)");
    rect(c, x, trayTop, tw, lipTop - trayTop, pal.metalIn);
    rect(c, x, trayTop, tw, 1, pal.metalHi);
    rect(c, x, trayTop, 1, lipTop - trayTop, pal.metal);
    rect(c, x + tw - 1, trayTop, 1, lipTop - trayTop, pal.metalLo);
    // 서류 더미: 한 장마다 모서리 한 줄이 보인다.
    let topY = lipTop - sh - 1, topX = x + 3;
    for (let i = 0; i < n; i++) {
      const jit = ((i * 7 + g.charCodeAt(0)) % 3) - 1;
      const yy = lipTop - sh - 1 - Math.floor(i * step);
      const xx = x + 3 + jit;
      rect(c, xx, yy, sw, sh, i % 2 ? pal.paper : pal.paperShade);
      rect(c, xx, yy + sh - 1, sw, 1, pal.paperEdge);
      topY = yy; topX = xx;
    }
    let stamp = null;
    if (n > 0) {
      // 맨 위 서류: 제목 줄, 괘선, 도장
      rect(c, topX, topY, sw, sh, pal.paper);
      rect(c, topX, topY + sh - 1, sw, 1, pal.paperEdge);
      rect(c, topX + 2, topY + 2, Math.floor(sw * 0.45), 1, pal.ink);
      c.fillStyle = pal.paperLine;
      for (let yy = topY + 4; yy < topY + sh - 2; yy += 2) c.fillRect(topX + 2, yy, sw - ((yy - topY) % 4 ? 8 : 5), 1);
      const stw = wide ? Math.min(sw - 6, 24) : Math.min(sw - 4, 11);
      const sth = wide ? Math.min(sh - 3, 9) : Math.min(sh - 2, 5);
      if (stw > 4 && sth > 2) {
        const sx = topX + sw - stw - (wide ? 2 : 1), sy = topY + sh - sth - (wide ? 2 : 1);
        rect(c, sx, sy, stw, sth, pal.paper);
        stampFrame(c, sx, sy, stw, sth, pal[g], pal.paper);
        if (!(detail && wide && sth >= 6)) rect(c, sx + 2, sy + Math.floor(sth / 2), stw - 4, 1, pal[g]);
        stamp = { x: sx, y: sy, w: stw, h: sth };
      }
    }
    // 앞 턱과 이름표
    rect(c, x, lipTop, tw, lip, pal.metal);
    rect(c, x, lipTop, tw, 1, pal.metalHi);
    rect(c, x, bottom, tw, 1, pal.metalLo);
    const labW = wide ? tw - 8 : tw - 6;
    const lx = x + Math.floor((tw - labW) / 2);
    rect(c, lx, lipTop + 1, labW, lip - 2, pal.label);
    rect(c, lx, lipTop + 1, 2, lip - 2, pal[g]);
    if (detail) {
      const s = String(n);
      pText(c, s, lx + labW - pWidth(s) - 2, lipTop + 1, pal.ink);
    }
    return { x, lipTop, labX: lx, labW, stamp, topY, topX };
  }
  function drawLedger(c, L, pal, box, d) {
    const wide = L.wide;
    const lw = box.w - 2, lh = Math.min(box.h - 2, wide ? 32 : 22);
    if (lh < 10) return null;
    const x = box.x, y = box.y + Math.max(0, Math.floor((box.h - lh) / 2) - (wide ? 4 : 2));
    rect(c, x + 2, y + 2, lw, lh, "rgba(0,0,0,0.3)");
    if (!d.revealed) {
      // 봉인한 결과 봉투
      rect(c, x, y, lw, lh, pal.env);
      rect(c, x, y, lw, 1, pal.envHi);
      rect(c, x, y + lh - 1, lw, 1, pal.envLo);
      const mx = x + Math.floor(lw / 2), my = y + Math.floor(lh * 0.45);
      line(c, x, y + 1, mx, my, pal.envLo, 1);
      line(c, x + lw - 1, y + 1, mx, my, pal.envLo, 1);
      ellipse(c, mx, my, wide ? 3 : 2, wide ? 3 : 2, pal.wax);
      rect(c, mx - 1, my - 1, 1, 1, pal.waxHi);
      return { x, y, w: lw, h: lh };
    }
    // 공개된 대조표(보고만 양성): 열 = 병원성/비병원성, 행 = 보고/보고하지 않음
    rect(c, x, y, lw, lh, pal.paper);
    rect(c, x, y + lh - 1, lw, 1, pal.paperEdge);
    rect(c, x + 2, y + 2, Math.floor(lw * 0.5), 1, pal.ink);
    const gx = x + 2, gy = y + (wide ? 5 : 4), gw = lw - 4, gh = lh - (wide ? 7 : 5);
    const cw = Math.floor(gw / 2), ch = Math.floor(gh / 2);
    rect(c, gx, gy, gw, 1, pal.paperLine); rect(c, gx, gy + ch, gw, 1, pal.paperLine); rect(c, gx, gy + gh - 1, gw, 1, pal.paperLine);
    rect(c, gx, gy, 1, gh, pal.paperLine); rect(c, gx + cw, gy, 1, gh, pal.paperLine); rect(c, gx + gw - 1, gy, 1, gh, pal.paperLine);
    const cm = d.cm || { TP: 0, FP: 0, FN: 0, TN: 0 };
    const cells = [["TP", 0, 0, pal.tp], ["FP", 1, 0, pal.fp], ["FN", 0, 1, pal.fn], ["TN", 1, 1, pal.tn]];
    const ps = wide ? 2 : 1;
    for (const [k, cx2, cy2, col] of cells) {
      const n = clamp(cm[k] | 0, 0, 12);
      const ox = gx + cx2 * cw + 2, oy = gy + cy2 * ch + 2;
      const per = Math.max(1, Math.floor((cw - 3) / (ps + 1)));
      for (let i = 0; i < n; i++) rect(c, ox + (i % per) * (ps + 1), oy + Math.floor(i / per) * (ps + 1), ps, ps, col);
    }
    return { x, y, w: lw, h: lh };
  }
  function drawPolicy(c, L, pal, box, d, t, moving) {
    const wide = L.wide;
    const bw = box.w, bh = Math.min(box.h - 1, wide ? 27 : 17);
    const x = box.x, y = box.y + (wide ? 1 : 0);
    rect(c, x + 2, y + 2, bw, bh, "rgba(0,0,0,0.3)");
    rect(c, x, y, bw, bh, pal.metal);
    rect(c, x, y, bw, 1, pal.metalHi);
    rect(c, x, y + bh - 1, bw, 1, pal.metalLo);
    rect(c, x + 1, y + 1, 1, 1, pal.metalHi); rect(c, x + bw - 2, y + 1, 1, 1, pal.metalHi);
    // 램프: 꺼짐(1단계 전) / 주황(선택 중) / 초록(적용·확정) / 회청(건너뜀)
    const lr = wide ? 4 : 3;
    const lcx = x + Math.floor(bw / 2), lcy = y + lr + 2;
    let lampCol = pal.ledOff;
    if (d.locked) lampCol = d.mode === "skip" ? pal.ledSkip : pal.ledOn;
    else if (d.mode === "apply") lampCol = d.decided === 4 ? pal.ledOn : pal.ledAmber;
    else if (d.mode === "skip") lampCol = pal.ledSkip;
    else if (d.stage1) lampCol = pal.ledAmber;
    ellipse(c, lcx, lcy, lr + 1, lr + 1, pal.metalLo);
    ellipse(c, lcx, lcy, lr, lr, lampCol);
    if (lampCol === pal.ledOff) rect(c, lcx - Math.floor(lr / 2), lcy - Math.floor(lr / 2), 2, 1, pal.metalHi);
    else {
      const busy = !d.locked && (d.mode === "pending" || (d.mode === "apply" && d.decided < 4));
      if (moving && busy && Math.sin(t * 6) > 0.2) ellipse(c, lcx, lcy, lr - 1, lr - 1, "rgba(255,255,255,0.35)");
      rect(c, lcx - Math.floor(lr / 2), lcy - Math.floor(lr / 2), 1, 1, "rgba(255,255,255,0.7)");
    }
    // 스위치 4개: 위 = 보고함, 아래 = 보고하지 않음, 가운데 = 미선택
    const sw = wide ? 3 : 2, shh = wide ? 8 : 5, gap = Math.floor((bw - 4 * sw) / 5);
    const sy = lcy + lr + (wide ? 4 : 3);
    const dim = d.mode === "skip" || (!d.stage1 && !d.locked);
    const x0 = x + Math.floor((bw - (4 * sw + 3 * gap)) / 2);
    POLICY_KEYS.forEach((k, i) => {
      const sx = x0 + i * (sw + gap);
      rect(c, sx - 1, sy - 1, sw + 2, shh + 2, pal.metalLo);
      rect(c, sx, sy, sw, shh, pal.grill);
      const v = d.policy[k];
      const ly = v === true ? sy : v === false ? sy + shh - (wide ? 3 : 2) : sy + Math.floor(shh / 2) - 1;
      rect(c, sx, ly, sw, wide ? 3 : 2, dim ? pal.metal : pal.metalHi);
      const led = v === true ? pal.ledOn : v === false ? pal.ledRed : pal.ledOff;
      if (sy + shh + 3 < y + bh) rect(c, sx + Math.floor(sw / 2), sy + shh + 2, 1, 1, dim ? pal.ledOff : led);
    });
    let tapeY = -1, plateY = -1;
    if (d.mode === "skip") {
      // 건너뛴 정책: 스위치 위에 종이 띠
      tapeY = sy + Math.floor(shh / 2) - (wide ? 2 : 1);
      rect(c, x - 1, tapeY, bw + 2, wide ? 5 : 3, pal.slip);
      rect(c, x - 1, tapeY + (wide ? 4 : 2), bw + 2, 1, pal.slipShade);
    }
    if (wide && y + bh + 10 <= box.y + box.h) {
      // 이름표
      plateY = y + bh + 2;
      rect(c, x + 3, plateY + 1, bw - 4, 7, "rgba(0,0,0,0.3)");
      rect(c, x + 2, plateY, bw - 4, 7, pal.label);
      rect(c, x + 2, plateY + 6, bw - 4, 1, pal.paperShade);
    }
    return { x, y, w: bw, h: bh, tapeY, plateY };
  }
  // 고무 도장 세 개와 인주(넓은 화면, 칩이 닿지 않는 오른쪽 아래)
  function drawStamps(c, L, pal, x, base) {
    const cols = ["R", "C", "N"];
    cols.forEach((k, i) => {
      const sx = x + i * 11;
      rect(c, sx + 1, base - 1, 9, 2, "rgba(0,0,0,0.3)");
      rect(c, sx, base - 2, 9, 1, pal[k]);
      rect(c, sx, base - 5, 9, 3, pal.deskEdge);
      rect(c, sx, base - 5, 9, 1, pal.deskHi);
      rect(c, sx + 3, base - 8, 3, 3, pal.deskDark);
      rect(c, sx + 3, base - 8, 1, 3, pal.deskHi);
      ellipse(c, sx + 4, base - 10, 3, 2, pal.bookLo);
      rect(c, sx + 2, base - 11, 2, 1, pal.bookHi);
    });
    // 인주: 뚜껑 열린 금속 통
    const px = x + 36;
    rect(c, px + 1, base - 4, 20, 5, "rgba(0,0,0,0.3)");
    rect(c, px, base - 5, 20, 5, pal.metal);
    rect(c, px, base - 5, 20, 1, pal.metalHi);
    rect(c, px + 2, base - 4, 16, 3, pal.grill);
    rect(c, px + 3, base - 4, 4, 1, pal.R);
    rect(c, px + 9, base - 3, 5, 1, pal.C);
  }
  function drawLamp(c, L, pal, flick) {
    const g0 = lampGeo(L);
    const wx = L.wx1 + Math.floor(L.wallW / 2), wy = L.WH - (L.narrow ? 3 : 5);
    rect(c, wx - 2, wy - 1, 4, 3, pal.lampLo);
    line(c, wx, wy + 1, g0.hx + 1, g0.hy - (L.narrow ? 2 : 3), pal.lampLo, L.narrow ? 1 : 2);
    const hw = L.narrow ? 4 : 8, hh = L.narrow ? 3 : 6;
    const hx = g0.hx, hy = g0.hy;
    // 빛 원뿔
    const coneLen = L.narrow ? 10 : 18;
    c.fillStyle = `rgba(${pal.glow},${(pal.glowA * 1.1).toFixed(3)})`;
    for (let r = 1; r <= coneLen; r++) {
      const spread = Math.round(hw + r * 0.9);
      c.fillRect(hx - spread - Math.round(r * 0.8), hy + 1 + r, spread * 2 + 1, 1);
    }
    // 갓(옆에서 본 반구)과 전구 빛
    for (let r = 0; r < hh; r++) {
      const half = Math.round(hw * Math.sqrt((r + 1) / hh));
      rect(c, hx - half, hy - hh + r, half * 2 + 1, 1, r === 0 ? pal.lampHi : pal.lamp);
    }
    rect(c, hx - hw, hy, hw * 2 + 1, 1, pal.lampLo);
    rect(c, hx - hw + 2, hy + 1, hw * 2 - 3, 1, pal.bulb);
    if (flick > 0) ellipse(c, g0.gx, g0.gy, Math.round(g0.rx * 0.5), Math.round(g0.ry * 0.5), `rgba(${pal.glow},${(pal.glowA * flick).toFixed(3)})`);
  }

  /* ---------- 움직임 상태(장면 전용, 홈 미리보기는 쓰지 않는다) ---------- */
  const shutterStop = L => (L.paneH >= 20 ? 0.62 : 1);
  const anim = { lastT: -1, tilt: null, queue: null, shutter: null, counts: null, locked: null, lockAt: -9, fly: [] };
  const tiltOf = d => clamp(d.weights.reduce((s, w, k) => s + w * (k - 2), 0) * 0.035, -0.28, 0.28);
  function stepAnim(ctx, d, L) {
    const t = Number(ctx.t) || 0;
    if (t + 0.05 < anim.lastT) Object.assign(anim, { lastT: -1, tilt: null, queue: null, shutter: null, counts: null, locked: null, lockAt: -9, fly: [] });
    const dt = anim.lastT < 0 ? 0 : clamp(t - anim.lastT, 0, 0.1);
    anim.lastT = t;
    const tiltT = tiltOf(d), queueT = d.demand, shutT = d.locked ? shutterStop(L) : 0;
    const snap = ctx.reduced || anim.tilt === null;
    const ease = (cur, target, rate, eps) => {
      const v = snap ? target : cur + (target - cur) * (1 - Math.exp(-dt * rate));
      return Math.abs(v - target) < eps ? target : v;
    };
    anim.tilt = ease(anim.tilt, tiltT, 6, 0.004);
    anim.queue = ease(anim.queue, queueT, 5, 0.02);
    anim.shutter = ease(anim.shutter, shutT, 7, 0.004);
    // 서류가 옮겨 가는 모습: 줄어든 칸에서 늘어난 칸으로 한두 장 날린다.
    if (anim.counts && !ctx.reduced) {
      const diff = GROUPS.map(k => d.counts[k] - anim.counts[k]);
      const lo = Math.min(...diff), hi = Math.max(...diff);
      if (lo < 0 && hi > 0) {
        const from = GROUPS[diff.indexOf(lo)], to = GROUPS[diff.indexOf(hi)];
        for (let i = 0; i < Math.min(3, hi); i++) anim.fly.push({ from, to, at: t + i * 0.09 });
      }
    }
    anim.counts = { ...d.counts };
    anim.fly = anim.fly.filter(f => t - f.at < 0.55);
    if (anim.locked === false && d.locked && !ctx.reduced) anim.lockAt = t;
    anim.locked = d.locked;
    const settled = anim.tilt === tiltT && anim.queue === queueT && anim.shutter === shutT && !anim.fly.length && t - anim.lockAt > 0.4;
    return { tilt: anim.tilt, queue: anim.queue, shutter: anim.shutter, fly: anim.fly.slice(), lockAge: t - anim.lockAt, settled };
  }

  // 칸 안에 들어가도록 글자를 줄인다.
  function fitText(g, text, x, y, maxW) {
    if (maxW <= 6) return;
    const tw = g.measureText(text).width;
    if (tw <= maxW) { g.fillText(text, x, y); return; }
    const m = /(\d+(?:\.\d+)?)px/.exec(g.font);
    const size = m ? Number(m[1]) : 11;
    const next = Math.floor((size * maxW) / tw);
    if (next < 8) return;
    const saved = g.font;
    g.font = saved.replace(/(\d+(?:\.\d+)?)px/, `${next}px`);
    g.fillText(text, x, y);
    g.font = saved;
  }

  /* ---------- 그리기 ---------- */
  function render(ctx) {
    const g = ctx.g;
    const thumb = !!ctx.thumb;
    const w = Math.max(1, Number(ctx.w) || 1), h = Math.max(1, Number(ctx.h) || 1);
    const P = thumb ? 2 : w >= 900 ? 3 : 2;
    const GW = Math.max(60, Math.ceil(w / P)), GH = Math.max(40, Math.ceil(h / P));
    const scheme = ctx.scheme === "dark" ? "dark" : "light";
    const pal = PALS[scheme];
    const phase = ["prep", "room", "reflect"].includes(ctx.phase) ? ctx.phase : "prep";
    const d = readDesk(ctx);
    const chips = thumb ? [] : makeChips(d, w);
    const L = layoutFor(GW, GH, P, thumb, thumb ? 0 : chipRows(chips, w));
    const slot = thumb ? SLOT.thumb : SLOT.stage;
    const bg = canvasOf(slot, "bg", GW, GH);
    const key = `${GW}x${GH}:${P}:${scheme}:${L.BOT}:${thumb}`;
    if (slot.key !== key) {
      const bc = bg.getContext("2d");
      bc.clearRect(0, 0, GW, GH);
      slot.grill = drawBackground(bc, L, pal);
      slot.key = key;
    }
    const frame = canvasOf(slot, "frame", GW, GH);
    const c = frame.getContext("2d");
    c.clearRect(0, 0, GW, GH);
    c.drawImage(bg, 0, 0);
    const t = thumb ? 0 : Number(ctx.t) || 0;
    const a = thumb
      ? { tilt: tiltOf(d), queue: d.demand, shutter: d.locked ? shutterStop(L) : 0, fly: [], lockAge: 9, settled: true }
      : stepAnim(ctx, d, L);
    const moving = !thumb && !ctx.reduced;
    const detail = !thumb;

    // 창: 줄, 덧문과 확정 도장, 쪽지, 인터컴
    drawQueue(c, L, pal, Math.round(a.queue), t, moving);
    const shutBottom = drawShutter(c, L, pal, a.shutter);
    let lockStamp = null;
    if (d.locked && shutBottom > 8) {
      // 확정 표지: 내려온 덧문에 붙인 종이와 빨간 도장. 문턱 깃발·이름표·쪽지와 겹치지 않는 자리를 고른다.
      const sw = L.wide ? 40 : 26, sh = Math.min(shutBottom - 2, L.wide ? 15 : 12);
      const sy = Math.max(1, Math.floor((shutBottom - 1 - sh) / 2));
      const fl = flagGeo(L, d, detail);
      const labelR = thumb ? 0 : Math.ceil((w < 561 ? 130 : 190) / P);
      const slipL = d.manualIds.length ? L.wx1 - 4 - Math.min(3, d.manualIds.length) * (L.narrow ? 13 : 23) : L.wx1;
      const busy = [[0, labelR, 0, 30], [slipL - 1, L.wx1, 0, 16]];
      for (const f of [fl.t1, fl.t2]) busy.push([f.x0 - 1, f.x1 + 1, f.y, f.y + f.fh]);
      const free = x => busy.every(([x0, x1, y0, y1]) => x + sw < x0 || x > x1 || sy + sh < y0 || sy > y1);
      let sx = null;
      for (const k of [0.62, 0.76, 0.5, 0.38, 0.86, 0.28]) {
        const cand = Math.round(L.wx1 * k) - Math.floor(sw / 2);
        if (cand > 1 && cand + sw < L.wx1 - 1 && free(cand)) { sx = cand; break; }
      }
      if (sx === null) sx = Math.round(L.wx1 * 0.62) - Math.floor(sw / 2);
      const slam = a.lockAge < 0.25 ? Math.round((0.25 - a.lockAge) * 10) : 0;
      const ins = sh >= 12 ? 2 : 1, fh2 = sh - ins * 2 - 1;
      rect(c, sx + 1, sy + 1, sw, sh, "rgba(0,0,0,0.35)");
      rect(c, sx, sy, sw, sh, pal.label);
      rect(c, sx, sy + sh - 1, sw, 1, pal.paperShade);
      rect(c, sx - 1, sy, 4, 2, pal.slipShade);
      rect(c, sx + sw - 3, sy, 4, 2, pal.slipShade);
      stampFrame(c, sx + ins - slam, sy + ins - slam, sw - ins * 2 + slam * 2, fh2 + slam * 2, pal.R, pal.label, false);
      if (!detail) rect(c, sx + 6, sy + Math.floor(sh / 2) - 1, sw - 12, 2, pal.R);
      lockStamp = { x: sx + ins, y: sy + ins, w: sw - ins * 2, h: fh2 };
    }
    drawSlips(c, L, pal, d, detail);
    drawIntercom(c, L, pal, slot.grill, t, phase === "room", moving);
    // 레일
    if (d.rows.length) drawRail(c, L, pal, d, detail);
    else {
      rect(c, xOf(L, d.t2), L.WH, 1, L.RH, pal.t2);
      rect(c, xOf(L, d.t1), L.WH, 1, L.RH, pal.t1);
    }
    // 책상 물건
    const it = L.items;
    let scale = null, ledger = null, pol = null;
    if (it.book) drawBook(c, L, pal, it.book, phase === "reflect");
    if (it.scale) scale = drawScale(c, L, pal, it.scale, d.weights, a.tilt, detail);
    const trays = {};
    if (it.trays) GROUPS.forEach((k, i) => { trays[k] = drawTray(c, L, pal, it.trays.x + i * (L.tw + L.tg), it.trays, k, d.counts[k], detail); });
    if (it.ledger) ledger = drawLedger(c, L, pal, it.ledger, d);
    if (ledger && d.locked && ledger.h >= 14) {
      const sh = L.wide ? 11 : 7;
      rect(c, ledger.x + 3, ledger.y + Math.floor((ledger.h - sh) / 2), ledger.w - 6, sh, pal.paper);
      stampFrame(c, ledger.x + 3, ledger.y + Math.floor((ledger.h - sh) / 2), ledger.w - 6, sh, pal.R, pal.paper);
      if (!(detail && L.wide)) rect(c, ledger.x + 6, ledger.y + Math.floor(ledger.h / 2), ledger.w - 12, 1, pal.R);
    }
    if (it.policy) pol = drawPolicy(c, L, pal, it.policy, d, t, moving);
    // 고무 도장 받침: 칩과 책상 물건(정책 제어함·장부)에 닿지 않을 때만 놓는다.
    if (L.wide && detail && chipsWidth(chips, w) + 40 < (GW - 64) * P) {
      const top = GH - 15;
      const clear = [pol, ledger].every(o => !o || o.x > GW - 6 || o.x + o.w < GW - 66 || (o.plateY >= 0 ? o.plateY + 8 : o.y + o.h) + 1 < top);
      if (clear) drawStamps(c, L, pal, GW - 64, GH - 3);
    }
    // 날아가는 서류
    for (const f of a.fly) {
      const p = clamp((t - f.at) / 0.5, 0, 1);
      if (p <= 0 || !trays[f.from] || !trays[f.to]) continue;
      const A = trays[f.from], B = trays[f.to];
      const fx = A.x + 3 + (B.x - A.x) * p, fy = Math.max(L.DY + 1, Math.min(A.topY, B.topY) - 2 - Math.sin(p * Math.PI) * (L.wide ? 14 : 8));
      rect(c, fx + 1, fy + 1, L.tw - 6, L.wide ? 6 : 4, "rgba(0,0,0,0.25)");
      rect(c, fx, fy, L.tw - 6, L.wide ? 6 : 4, pal.paper);
      rect(c, fx + 2, fy + 2, L.tw - 12, 1, pal.paperLine);
    }
    drawLamp(c, L, pal, moving ? 0.6 + 0.4 * Math.sin(t * 9.1) * Math.sin(t * 2.3) : 0);
    // 어두운 부스: 가장자리를 단계별로 조금씩 어둡게
    for (let i = 0; i < 3; i++) {
      const k = (i + 1) * (L.narrow ? 2 : 3);
      rect(c, 0, 0, k, GH, "rgba(0,0,0,0.06)");
      rect(c, GW - k, 0, k, GH, "rgba(0,0,0,0.06)");
      rect(c, k, GH - Math.ceil(k / 2), GW - k * 2, Math.ceil(k / 2), "rgba(0,0,0,0.05)");
    }

    // 확대해서 옮긴다(가장 가까운 칸 그대로)
    g.imageSmoothingEnabled = false;
    g.drawImage(frame, 0, 0, GW, GH, 0, 0, GW * P, GH * P);

    // 글자(장면에서만): 서류함 이름, 도장 글씨, 저울 이름, 확정 도장
    if (detail) {
      g.textBaseline = "middle";
      if (L.wide) {
        g.textAlign = "left";
        g.font = `700 11px ${FONT_KO}`;
        g.fillStyle = pal.ink;
        GROUPS.forEach(k => {
          const tr = trays[k];
          if (!tr) return;
          fitText(g, GROUP_NAME[k], (tr.labX + 3) * P, (tr.lipTop + 3.5) * P, (tr.labW - pWidth(String(d.counts[k])) - 8) * P);
        });
        g.textAlign = "center";
        g.font = `800 ${P === 3 ? 13 : 11}px ${FONT_KO}`;
        GROUPS.forEach(k => {
          const tr = trays[k];
          if (!tr || !tr.stamp || tr.stamp.h < 6) return;
          g.fillStyle = pal[k];
          fitText(g, STAMP_TEXT[k], (tr.stamp.x + tr.stamp.w / 2) * P, (tr.stamp.y + tr.stamp.h / 2) * P + 0.5, (tr.stamp.w - 5) * P);
        });
        if (scale && scale.tagY >= 0) {
          g.font = `600 10px ${FONT_KO}`;
          g.fillStyle = scheme === "dark" ? "#e9dcbc" : "#f3ead2";
          const ty = (scale.tagY + 11) * P;
          if (ty + 6 <= (L.BOT + 1) * P) scale.pans.forEach((p, k) => g.fillText(WEIGHT_SHORT[k], p.x * P + P / 2, ty));
        }
        if (pol && pol.plateY >= 0) {
          g.font = `700 10px ${FONT_KO}`;
          g.fillStyle = pal.ink;
          fitText(g, "보고 정책", (pol.x + pol.w / 2) * P, (pol.plateY + 3) * P + 0.5, (pol.w - 7) * P);
        }
        if (pol && pol.tapeY >= 0) {
          g.font = `700 10px ${FONT_KO}`;
          g.fillStyle = pal.ink;
          fitText(g, "건너뜀", (pol.x + pol.w / 2) * P, (pol.tapeY + 2.5) * P, (pol.w + 2) * P);
        }
        if (ledger && d.locked && ledger.h >= 14) {
          g.font = `800 12px ${FONT_KO}`;
          g.fillStyle = pal.R;
          g.fillText("확정", (ledger.x + ledger.w / 2) * P, (ledger.y + ledger.h / 2) * P);
        }
      }
      if (lockStamp) {
        g.textAlign = "center";
        g.font = `800 ${clamp(Math.floor((lockStamp.h - 2) * P * 0.88), 10, 18)}px ${FONT_KO}`;
        g.fillStyle = pal.R;
        g.fillText("확정", (lockStamp.x + lockStamp.w / 2) * P, (lockStamp.y + lockStamp.h / 2) * P + 1);
      }
    }
    return { caption: caption(d), chips, animate: !thumb && (moving || !a.settled) };
  }

  KCP.v2.skin(ID, { kicker: "INSPECTION DESK", title: "변이 판독대", render });
})();
