/* 2025 켄테시아 타임스 장면: 1980년대 탐정 추리 게임의 수사 게시판 오마주
 * - 코르크 게시판에 발행 순서 칸 1~4. 학생이 칸에 꽂은 신문(기호 ● ■ ▲ ◆)을 그 칸에 압정으로 꽂는다.
 * - 이웃한 두 칸이 모두 차면 빨간 실로 잇는다(학생이 정한 순서 그대로, 실의 색·굵기는 모두 같다).
 * - 두 칸 사이의 쪽지: 노란 쪽지 = 연결 근거, 분홍 쪽지 = 사이의 사건. 적은 글이 길수록 쪽지 줄이 늘어난다.
 * - 오른쪽 '미배치' 서류 더미 = 아직 칸에 넣지 않은 신문(자료 2~5 순서). 고른 신문은 들려 있고 점선 테두리.
 * - 돋보기 = 지금 읽고 있는 신문 탭. 위쪽 마닐라 카드 = 종합 설명(글이 길수록 줄이 늘어난다). 별 배지 = 장식.
 * - 아래 시계 띠 = 발행 순서 칸 번호(먼저 → 나중). 시계 바늘은 칸 번호만 나타낸다.
 * 정답이나 예시 답안은 읽지 않는다. 게임 상태(order, links, gaps, overall, sel, tab)만 읽어 그대로 비춘다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;
  const ID = "2025";
  const IDS = ["blue", "red", "green", "black"]; // 자료 2~5 순서(게임 탭 순서)
  const SYM = { blue: "●", red: "■", green: "▲", black: "◆" };
  const NUM = { blue: 2, red: 3, green: 4, black: 5 };
  const SHORT = { red: "창간호 · 이주 300년", blue: "켄트로늄 고갈 · AI 접속권", green: "거대 인공위성 · AI 교사", black: "기억 클라우드 · 제노스" };
  const FONT_KO = '"IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const FONT_TYPE = '"IBM Plex Mono", "IBM Plex Sans KR", "Noto Sans KR", ui-monospace, monospace';
  const FONT_SERIF = '"Nanum Myeongjo", "Noto Serif KR", Georgia, serif';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const str = v => (typeof v === "string" ? v.trim() : "");
  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 팔레트: 낮 사무실(밝은 화면)과 탁상등 밤 사무실(어두운 화면) ---------- */
  const PALS = {
    light: {
      frame: "#7a5330", frameHi: "#a0744a", frameLo: "#4e321a",
      cork: "#c49a62", corkLo: "#b0864f", speck: ["#9c733f", "#d9b47c", "#8a6434", "#e2c48f"],
      beam: "rgba(255,248,222,0.20)", vignette: "rgba(60,36,14,0.16)", glow: "",
      shadow: "rgba(40,24,8,0.32)",
      news: "#f5f0e2", newsEdge: "#b9ae94", newsInk: "#2a241b", newsLine: "#a79d86", photo: "#bdb39c", photoLo: "#9f957e",
      sym: { red: "#c42a3e", blue: "#1f62bd", green: "#12783c", black: "#1f1a14" },
      pin: "#c8281e", pinHi: "#f17868", pinLo: "#7d150f",
      string: "#b5161c", stringHi: "#e0473f",
      noteLink: "#f2da68", noteLinkLo: "#d2b947", noteGap: "#f4b9b0", noteGapLo: "#d99488", noteInk: "#5b4a1d", noteInk2: "#6e3027",
      empty: "rgba(70,44,18,0.45)", emptyFill: "rgba(255,240,210,0.16)", qmark: "rgba(70,44,18,0.5)",
      card: "#efdcab", cardLo: "#cdb67f", cardLine: "#b39a62", cardHead: "#9b2119", cardInk: "#4a3818",
      label: "#f6efd9", labelInk: "#2a2116", labelRed: "#8e1f1a",
      ruler: "#b8925a", rulerHi: "#dcb978", rulerLo: "#7d5d30", tick: "#4f3a1e",
      clock: "#f6efd9", clockDim: "#d8c9a6", clockRim: "#5a4224", hand: "#2a2116",
      badge: "#c9a23e", badgeHi: "#f0d47e", badgeLo: "#86651a", badgeInk: "#5a4210",
      lens: "rgba(214,236,255,0.28)", lensRim: "#5b4424", lensHi: "rgba(255,255,255,0.55)",
      sel: "#9b2119", mote: "255,250,228"
    },
    dark: {
      frame: "#3a2614", frameHi: "#57391f", frameLo: "#1f140a",
      cork: "#6a4f30", corkLo: "#584027", speck: ["#4a3520", "#80623e", "#3f2d1b", "#8f7149"],
      beam: "", vignette: "rgba(6,4,2,0.55)", glow: "255,200,120",
      shadow: "rgba(0,0,0,0.5)",
      news: "#ddd2b9", newsEdge: "#9b8f73", newsInk: "#241e15", newsLine: "#8f846b", photo: "#a49a82", photoLo: "#867c65",
      sym: { red: "#c42a3e", blue: "#1f62bd", green: "#12783c", black: "#1f1a14" },
      pin: "#d43426", pinHi: "#ff8a78", pinLo: "#7d150f",
      string: "#d8322a", stringHi: "#ff6a58",
      noteLink: "#d9c35a", noteLinkLo: "#b29c3c", noteGap: "#d99f97", noteGapLo: "#b77d74", noteInk: "#4a3c15", noteInk2: "#5c2720",
      empty: "rgba(255,226,180,0.38)", emptyFill: "rgba(0,0,0,0.14)", qmark: "rgba(255,226,180,0.45)",
      card: "#d6c290", cardLo: "#b09c68", cardLine: "#9a8350", cardHead: "#8e1f1a", cardInk: "#3e2e12",
      label: "#efe3c4", labelInk: "#241d14", labelRed: "#8e1f1a",
      ruler: "#8d6d3c", rulerHi: "#b8925a", rulerLo: "#56401f", tick: "#e8d6ad",
      clock: "#e8dcbc", clockDim: "#857558", clockRim: "#2a1d0e", hand: "#241d14",
      badge: "#b8923a", badgeHi: "#e6c56c", badgeLo: "#6e5214", badgeInk: "#4a360c",
      lens: "rgba(255,230,180,0.18)", lensRim: "#b8925a", lensHi: "rgba(255,240,210,0.5)",
      sel: "#ff8a6a", mote: "255,214,150"
    }
  };

  /* ---------- 상태 읽기(읽기만) ---------- */
  function readState(game) {
    const G = game && typeof game === "object" ? game : {};
    const raw = Array.isArray(G.order) ? G.order : [];
    const seen = new Set();
    const order = [0, 1, 2, 3].map(i => {
      const id = raw[i];
      if (typeof id !== "string" || !own(SYM, id) || seen.has(id)) return null;
      seen.add(id);
      return id;
    });
    const placed = order.filter(Boolean);
    const unplaced = IDS.filter(id => !seen.has(id));
    const links = [0, 1, 2].map(i => str(own(G.links, String(i)) ? G.links[i] : ""));
    const gaps = [0, 1, 2].map(i => str(own(G.gaps, String(i)) ? G.gaps[i] : ""));
    const overall = str(G.overall);
    const sel = typeof G.sel === "string" && own(SYM, G.sel) && !seen.has(G.sel) ? G.sel : null;
    const tab = typeof G.tab === "string" && own(SYM, G.tab) ? G.tab : "blue";
    return {
      order, placed, unplaced, links, gaps, overall, sel, tab,
      nLinks: links.filter(Boolean).length, nGaps: gaps.filter(Boolean).length,
      overallLen: Array.from(overall.replace(/\s+/g, "")).length
    };
  }

  /* ---------- 칩과 캔버스 설명 ---------- */
  const symOrNone = id => (id ? SYM[id] : "?");
  function makeChips(d, narrow) {
    const n = d.placed.length;
    const chips = [{ label: "배치", value: `${n}/4`, tone: n === 4 ? "ok" : n ? "info" : "muted" }];
    if (!narrow) chips.push({ label: "내 순서", value: d.order.map(symOrNone).join(" → "), tone: "muted" });
    chips.push({ label: narrow ? "근거" : "연결 근거", value: `${d.nLinks}/3`, tone: d.nLinks === 3 ? "ok" : d.nLinks ? "info" : "muted" });
    chips.push({ label: narrow ? "사건" : "사이 사건", value: `${d.nGaps}/3`, tone: d.nGaps === 3 ? "ok" : d.nGaps ? "info" : "muted" });
    chips.push({ label: "종합", value: d.overallLen ? `${d.overallLen}자` : "비어 있음", tone: d.overallLen ? "info" : "muted" });
    return chips;
  }
  function caption(d) {
    const slots = d.order.map((id, i) => `${i + 1}번 칸 ${id ? `${SYM[id]} ${SHORT[id]}` : "비어 있음"}`).join(", ");
    const pile = d.unplaced.length ? `아직 배치하지 않은 신문 ${d.unplaced.map(id => SYM[id]).join(" ")}.` : "신문 4부를 모두 배치했습니다.";
    return `수사 게시판. 신문 4부 중 ${d.placed.length}부를 발행 순서 칸에 꽂았습니다. ${slots}. ${pile} ` +
      `연결 근거 ${d.nLinks}/3칸, 사이의 사건 ${d.nGaps}/3칸, 종합 설명 ${d.overallLen}자. 지금 읽는 신문 ${SYM[d.tab]}.`;
  }
  // 셸의 칩 줄 수를 글자 폭으로 어림한다(위 칩 CSS: 좌우 여백 20, 테 7, 간격 4).
  function chipRows(g, chips, w) {
    if (!chips.length) return 0;
    g.save();
    let rows = 1, x = 0;
    const max = w - 20;
    for (const c of chips) {
      g.font = `12.5px ${FONT_TYPE}`;
      const a = g.measureText(String(c.label)).width;
      g.font = `700 12.5px ${FONT_TYPE}`;
      const b = g.measureText(String(c.value)).width;
      const cw = Math.min(max, 20 + 7 + 6 + a + b);
      if (x && x + 6 + cw > max) { rows++; x = cw; } else x += (x ? 6 : 0) + cw;
    }
    g.restore();
    return rows;
  }
  // 장면 위 이름표(.v2-stage-top)의 자리. 홈 미리보기에서는 없다.
  function titleBox(thumb) {
    if (thumb) return null;
    const st = document.getElementById("v2-stage");
    const top = st && st.querySelector(".v2-stage-top");
    if (!top) return null;
    const a = st.getBoundingClientRect(), b = top.getBoundingClientRect();
    if (!b.width) return null;
    return { r: b.right - a.left, b: b.bottom - a.top };
  }

  /* ---------- 배치 ---------- */
  function layout(w, h, thumb, narrow, rows, tb, hasPile) {
    const L = { w, h, thumb, narrow };
    L.fw = thumb ? 4 : narrow ? 7 : 11;
    const chipH = thumb || !rows ? 0 : 10 + rows * 25 + (rows - 1) * 6 + 6;
    L.tlH = thumb ? 9 : narrow ? 16 : 22;
    const titleB = tb ? tb.b + 6 : narrow ? 40 : 58;
    const titleR = tb ? tb.r + 10 : narrow ? 160 : 240;
    L.bottom = h - Math.max(L.fw, chipH) - L.tlH - 4;
    const normalTop = thumb ? L.fw + 8 : titleB + 4;
    L.compact = !thumb && L.bottom - normalTop < (narrow ? 40 : 64);
    L.top = L.compact ? L.fw + 8 : normalTop;
    L.pile = !L.compact && hasPile;
    const inner0 = L.fw + (narrow ? 4 : 10), inner1 = w - L.fw - (narrow ? 4 : 10);
    L.pileW = L.pile ? clamp(Math.round(w * (thumb ? 0.2 : 0.17)), thumb ? 30 : 56, 190) : 0;
    L.sx0 = L.compact ? Math.max(inner0, titleR) : inner0;
    L.sx1 = inner1 - (L.pile ? L.pileW + (narrow ? 6 : 14) : 0);
    L.slotW = Math.max(10, (L.sx1 - L.sx0) / 4);
    L.ph = Math.max(14, L.bottom - L.top - 2);
    L.pw = Math.max(9, Math.min(L.slotW * (narrow || thumb ? 0.66 : 0.6), L.ph * 0.78));
    if (L.pw / 0.78 < L.ph) L.ph = Math.round(L.pw / 0.78);
    L.py = L.top + Math.max(0, (L.bottom - L.top - L.ph) / 2) * 0.5;
    L.cx = i => L.sx0 + L.slotW * (i + 0.5);
    L.px0 = L.sx1 + (narrow ? 6 : 14);
    L.px1 = inner1;
    L.tlY = L.bottom + 3;
    // 위쪽 띠 오른쪽: 종합 설명 카드와 배지
    L.band = !L.compact && !thumb ? { y0: L.fw + 6, y1: L.top - 6, x0: titleR + 8, x1: inner1 } : null;
    if (thumb) L.band = { y0: L.fw + 2, y1: L.top - 2, x0: inner0, x1: inner1, thumb: true };
    return L;
  }

  /* ---------- 그리기 도구 ---------- */
  function rnd(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function symShape(g, id, cx, cy, r, col) {
    g.fillStyle = col;
    g.beginPath();
    if (id === "red") g.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
    else if (id === "blue") g.arc(cx, cy, r, 0, Math.PI * 2);
    else if (id === "green") { g.moveTo(cx, cy - r); g.lineTo(cx + r * 1.05, cy + r * 0.8); g.lineTo(cx - r * 1.05, cy + r * 0.8); g.closePath(); }
    else { g.moveTo(cx, cy - r * 1.1); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r * 1.1); g.lineTo(cx - r, cy); g.closePath(); }
    g.fill();
  }
  function pin(g, P, x, y, r) {
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath(); g.arc(x + r * 0.5, y + r * 0.7, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.pinLo;
    g.beginPath(); g.arc(x, y + r * 0.25, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.pin;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.pinHi;
    g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2); g.fill();
  }
  function fitFont(g, text, maxW, size, weight, family) {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (s > 6 && g.measureText(text).width > maxW) { s -= 0.5; g.font = `${weight} ${s}px ${family}`; }
    return s;
  }

  /* ---------- 배경: 나무 테, 코르크(캐시), 빛 ---------- */
  const CACHE = { stage: { key: "", cv: null }, thumb: { key: "", cv: null } };
  function boardImage(slot, w, h, fw, P, scheme) {
    const dpr = KCP.v2.dpr ? KCP.v2.dpr() : 1;
    const key = `${w}x${h}:${fw}:${scheme}:${dpr}`;
    const c = CACHE[slot];
    if (c.key === key && c.cv) return c.cv;
    const cv = c.cv || document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 나무 테
    g.fillStyle = P.frame; g.fillRect(0, 0, w, h);
    g.fillStyle = P.frameHi; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    g.fillStyle = P.frameLo; g.fillRect(0, h - 2, w, 2); g.fillRect(w - 2, 0, 2, h);
    const r0 = rnd(97);
    g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const yy = 2 + r0() * (fw - 3);
      g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy + r0() * 2 - 1); g.stroke();
    }
    // 코르크
    const x0 = fw, y0 = fw, cw = w - fw * 2, ch = h - fw * 2;
    g.fillStyle = P.cork; g.fillRect(x0, y0, cw, ch);
    const grad = g.createLinearGradient(0, y0, 0, y0 + ch);
    grad.addColorStop(0, "rgba(255,255,255,0.05)"); grad.addColorStop(1, "rgba(0,0,0,0.08)");
    g.fillStyle = grad; g.fillRect(x0, y0, cw, ch);
    const r = rnd(2025);
    const n = Math.round(cw * ch / 26);
    for (let i = 0; i < n; i++) {
      g.fillStyle = P.speck[(r() * 4) | 0];
      const s = r() < 0.85 ? 1 : 2;
      g.fillRect(x0 + r() * cw, y0 + r() * ch, s, s);
    }
    g.fillStyle = P.corkLo;
    for (let i = 0; i < n / 30; i++) g.fillRect(x0 + r() * cw, y0 + r() * ch, 3, 2);
    // 안쪽 그림자
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(x0, y0, cw, 2); g.fillRect(x0, y0, 2, ch);
    // 낡은 압정 구멍
    g.fillStyle = "rgba(40,24,8,0.35)";
    for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(x0 + r() * cw, y0 + r() * ch, 0.9, 0, Math.PI * 2); g.fill(); }
    c.cv = cv; c.key = key;
    return cv;
  }
  function lighting(g, L, P, scheme) {
    const { w, h, fw } = L;
    g.save();
    g.beginPath(); g.rect(fw, fw, w - fw * 2, h - fw * 2); g.clip();
    if (scheme === "dark") {
      // 탁상등: 왼쪽 위에서 비추는 따뜻한 빛, 나머지는 어둡게
      const lx = w * 0.16, ly = -h * 0.25, R = Math.max(w, h) * 0.95;
      const gr = g.createRadialGradient(lx, ly, 10, lx, ly, R);
      gr.addColorStop(0, `rgba(${P.glow},0.42)`);
      gr.addColorStop(0.35, `rgba(${P.glow},0.14)`);
      gr.addColorStop(0.7, "rgba(0,0,0,0.18)");
      gr.addColorStop(1, P.vignette);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    } else {
      // 창 블라인드 빛: 기울어진 밝은 띠
      g.fillStyle = P.beam;
      const step = L.narrow ? 26 : 38;
      for (let x = -h; x < w + h; x += step * 2.2) {
        g.beginPath();
        g.moveTo(x, fw); g.lineTo(x + step, fw); g.lineTo(x + step - h * 0.55, h); g.lineTo(x - h * 0.55, h); g.closePath();
        g.fill();
      }
      const gr = g.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.3, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, P.vignette);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    g.restore();
  }
  function motes(g, L, P, t) {
    const r = rnd(7);
    g.save();
    for (let i = 0; i < 14; i++) {
      const bx = r() * L.w, by = r() * L.h, sp = 4 + r() * 8, ph = r() * 6.28;
      const x = (bx + t * sp) % L.w, y = by + Math.sin(t * 0.6 + ph) * 6;
      g.fillStyle = `rgba(${P.mote},${0.25 + 0.2 * Math.sin(t + ph)})`;
      g.fillRect(x, y, 1.5, 1.5);
    }
    g.restore();
  }

  /* ---------- 신문 1면(작은 그림) ---------- */
  const LOOK = {
    blue: { photo: "low", heads: [0.86, 0.5], kicker: false },
    red: { photo: "top", heads: [0.7], kicker: true },
    green: { photo: "top", heads: [0.9, 0.62], kicker: false },
    black: { photo: "none", heads: [0.8, 0.55], kicker: false, quote: true }
  };
  function drawPaper(g, P, id, x, y, pw, ph, ang, o) {
    g.save();
    g.translate(x + pw / 2, y + ph / 2);
    g.rotate(ang);
    const X = -pw / 2, Y = -ph / 2;
    const lift = o.lift ? Math.max(2, pw * 0.05) : 0;
    g.fillStyle = P.shadow;
    g.fillRect(X + 2 + lift, Y + 3 + lift * 1.4, pw, ph);
    g.translate(-lift * 0.3, -lift);
    g.fillStyle = P.news; g.fillRect(X, Y, pw, ph);
    g.strokeStyle = P.newsEdge; g.lineWidth = 1; g.strokeRect(X + 0.5, Y + 0.5, pw - 1, ph - 1);
    const m = Math.max(2, pw * 0.07);
    const iw = pw - m * 2;
    const mastH = Math.max(4, ph * 0.12);
    const symR = clamp(mastH * 0.42, 2, 9);
    g.fillStyle = P.newsInk;
    if (o.text && pw >= 80) {
      const s = fitFont(g, "KENTESIA TIMES", iw - symR * 2 - 6, Math.min(14, mastH * 0.9), 800, FONT_SERIF);
      g.textBaseline = "middle"; g.textAlign = "left";
      g.fillText("KENTESIA TIMES", X + m, Y + m + mastH * 0.5, iw - symR * 2 - 6);
      void s;
    } else {
      g.fillRect(X + m, Y + m + mastH * 0.2, iw * 0.66, Math.max(1.5, mastH * 0.55));
    }
    symShape(g, id, X + pw - m - symR, Y + m + mastH * 0.5, symR, P.sym[id]);
    let cy = Y + m + mastH + Math.max(1, ph * 0.015);
    g.fillStyle = P.newsInk;
    g.fillRect(X + m, cy, iw, Math.max(1, ph * 0.012));
    g.fillRect(X + m, cy + Math.max(2, ph * 0.022), iw, 1);
    cy += Math.max(4, ph * 0.05);
    const look = LOOK[id];
    const lg = Math.max(2.2, ph * 0.032);
    if (look.kicker) { g.fillStyle = P.newsInk; g.fillRect(X + m, cy, iw * 0.34, Math.max(1.5, lg * 0.9)); cy += lg * 1.5; }
    const photoBox = hh => {
      g.fillStyle = P.photo; g.fillRect(X + m, cy, iw, hh);
      g.fillStyle = P.photoLo;
      g.beginPath(); g.moveTo(X + m, cy + hh); g.lineTo(X + m + iw * 0.35, cy + hh * 0.45); g.lineTo(X + m + iw * 0.6, cy + hh * 0.75);
      g.lineTo(X + m + iw * 0.8, cy + hh * 0.35); g.lineTo(X + m + iw, cy + hh * 0.7); g.lineTo(X + m + iw, cy + hh); g.closePath(); g.fill();
      cy += hh + lg;
    };
    look.heads.forEach(f => { g.fillStyle = P.newsInk; g.fillRect(X + m, cy, iw * f, Math.max(1.5, lg * 1.1)); cy += lg * 1.7; });
    if (look.photo === "top") photoBox(ph * 0.24);
    const bottom = Y + ph - m;
    const colW = (iw - m) / 2;
    const textTo = look.photo === "low" ? bottom - ph * 0.2 : look.quote ? bottom - lg * 3 : bottom;
    g.fillStyle = P.newsLine;
    for (let c = 0; c < 2; c++) {
      let yy = cy, k = 0;
      while (yy + 1 < textTo) {
        const short = (k + c * 3 + id.length) % 7 === 6;
        g.fillRect(X + m + c * (colW + m), yy, colW * (short ? 0.55 : 1), 1);
        yy += lg; k++;
      }
    }
    if (look.photo === "low") { cy = bottom - ph * 0.2 + lg * 0.4; photoBox(ph * 0.2 - lg * 0.4); }
    if (look.quote) { g.fillStyle = P.newsInk; g.fillRect(X + m, bottom - lg * 2, 1.5, lg * 2); g.fillRect(X + m + 3, bottom - lg * 1.6, iw * 0.7, Math.max(1.5, lg * 0.8)); }
    if (o.sel) {
      g.strokeStyle = P.sel; g.lineWidth = 2; g.setLineDash([4, 3]);
      g.strokeRect(X - 3, Y - 3, pw + 6, ph + 6);
      g.setLineDash([]);
    }
    g.restore();
    return { x: x + pw / 2 - lift * 0.3, y: y - lift + Math.max(3, ph * 0.04) };
  }
  function magnifier(g, P, cx, cy, r) {
    g.save();
    g.strokeStyle = P.lensRim; g.lineCap = "round";
    g.lineWidth = Math.max(2, r * 0.32);
    g.beginPath(); g.moveTo(cx + r * 0.7, cy + r * 0.7); g.lineTo(cx + r * 1.6, cy + r * 1.6); g.stroke();
    g.fillStyle = P.lens; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = Math.max(1.5, r * 0.18); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = P.lensHi; g.lineWidth = Math.max(1, r * 0.1);
    g.beginPath(); g.arc(cx, cy, r * 0.65, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    g.restore();
  }

  /* ---------- 쪽지·카드·배지·시계 띠 ---------- */
  function note(g, P, kind, x, y, s, len, ang, text) {
    g.save();
    g.translate(x + s / 2, y + s / 2); g.rotate(ang);
    const X = -s / 2, Y = -s / 2;
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(X + 1.5, Y + 2, s, s);
    g.fillStyle = kind === "link" ? P.noteLink : P.noteGap; g.fillRect(X, Y, s, s);
    g.fillStyle = kind === "link" ? P.noteLinkLo : P.noteGapLo; g.fillRect(X, Y, s, Math.max(2, s * 0.14));
    const ink = kind === "link" ? P.noteInk : P.noteInk2;
    let ly = Y + s * 0.3;
    if (text && s >= 34) {
      g.fillStyle = ink; g.font = `600 ${Math.round(clamp(s * 0.22, 8, 11))}px ${FONT_KO}`;
      g.textAlign = "left"; g.textBaseline = "top";
      g.fillText(kind === "link" ? "근거" : "사건", X + s * 0.12, Y + s * 0.2);
      ly = Y + s * 0.48;
    }
    const lines = clamp(Math.ceil(len / 22), 1, 4);
    const lh = (Y + s - s * 0.1 - ly) / 4;
    g.fillStyle = ink;
    for (let i = 0; i < lines; i++) g.fillRect(X + s * 0.12, ly + i * lh, s * (i === lines - 1 ? 0.45 : 0.76), Math.max(1, s * 0.04));
    g.restore();
    pin(g, P, x + s / 2, y + 1, clamp(s * 0.09, 1.6, 3.4));
  }
  function placeholder(g, P, x, y, s) {
    g.save();
    g.strokeStyle = P.empty; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    g.setLineDash([]);
    g.fillStyle = P.qmark; g.font = `700 ${Math.round(s * 0.55)}px ${FONT_TYPE}`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("?", x + s / 2, y + s / 2 + 1);
    g.restore();
  }
  function overallCard(g, P, x, y, cw, chh, len, text) {
    g.save();
    g.translate(x + cw / 2, y + chh / 2); g.rotate(0.018);
    const X = -cw / 2, Y = -chh / 2;
    g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(X + 2, Y + 3, cw, chh);
    g.fillStyle = P.card; g.fillRect(X, Y, cw, chh);
    g.fillStyle = P.cardLo; g.fillRect(X, Y + chh - 2, cw, 2);
    const head = Y + Math.max(5, chh * 0.24);
    g.fillStyle = P.cardHead; g.fillRect(X + 4, head, cw - 8, 1);
    if (text && cw >= 70 && chh >= 26) {
      g.fillStyle = P.cardHead; g.font = `700 ${Math.round(clamp(chh * 0.2, 9, 11))}px ${FONT_TYPE}`;
      g.textAlign = "left"; g.textBaseline = "bottom";
      g.fillText("종합 설명", X + 5, head - 1);
    }
    const n = len ? clamp(Math.ceil(len / 30), 1, 5) : 0;
    const lh = (chh - (head - Y) - 6) / 5;
    g.fillStyle = P.cardLine;
    for (let i = 0; i < 5; i++) g.fillRect(X + 5, head + 3 + (i + 1) * lh - 1, cw - 10, 1);
    g.fillStyle = P.cardInk;
    for (let i = 0; i < n; i++) g.fillRect(X + 6, head + 3 + (i + 1) * lh - 3, (cw - 14) * (i === n - 1 ? 0.5 : 0.92), Math.max(1.2, lh * 0.28));
    if (!n && cw >= 30) {
      g.fillStyle = P.cardLine; g.font = `700 ${Math.round(clamp(chh * 0.3, 8, 14))}px ${FONT_TYPE}`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("?", 0, head - Y > 0 ? (head + Y + chh) / 2 - 0 : 0);
    }
    g.restore();
    pin(g, P, x + cw / 2, y + 2, clamp(cw * 0.04, 2, 3.5));
  }
  function badge(g, P, cx, cy, r) {
    g.save();
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.badgeLo; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.badge; g.beginPath(); g.arc(cx, cy, r * 0.88, 0, Math.PI * 2); g.fill();
    g.strokeStyle = P.badgeLo; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r * 0.74, 0, Math.PI * 2); g.stroke();
    // 여섯 꼭짓점 별
    g.fillStyle = P.badgeHi;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 6, rr = i % 2 ? r * 0.3 : r * 0.62;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill();
    g.fillStyle = P.badgeLo; g.beginPath(); g.arc(cx, cy, r * 0.13, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  function timeline(g, P, L, d) {
    const y = L.tlY, hh = L.tlH, x0 = L.sx0 - 2, x1 = L.sx1 + 2;
    const my = y + hh / 2;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x0 + 1, my - hh * 0.18 + 2, x1 - x0, hh * 0.36);
    g.fillStyle = P.ruler; g.fillRect(x0, my - hh * 0.18, x1 - x0, hh * 0.36);
    g.fillStyle = P.rulerHi; g.fillRect(x0, my - hh * 0.18, x1 - x0, 1);
    g.fillStyle = P.rulerLo; g.fillRect(x0, my + hh * 0.18 - 1, x1 - x0, 1);
    g.fillStyle = P.tick;
    for (let x = x0 + 4; x < x1 - 4; x += L.narrow ? 6 : 8) g.fillRect(Math.round(x), my - hh * 0.18 + 1, 1, hh * 0.14);
    // 화살촉(먼저 → 나중)
    g.fillStyle = P.rulerLo;
    g.beginPath(); g.moveTo(x1 + hh * 0.45, my); g.lineTo(x1 - 1, my - hh * 0.36); g.lineTo(x1 - 1, my + hh * 0.36); g.closePath(); g.fill();
    if (!L.thumb && !L.narrow) {
      g.font = `600 10px ${FONT_TYPE}`; g.textBaseline = "middle"; g.textAlign = "center";
      [["먼저", x0 + 18], ["나중", x1 - 18]].forEach(([s, cx]) => {
        g.fillStyle = P.label; g.fillRect(cx - 15, my - 7, 30, 14);
        g.fillStyle = P.labelInk; g.fillText(s, cx, my + 0.5);
      });
    }
    const r = Math.max(3, hh * 0.45);
    for (let i = 0; i < 4; i++) {
      const cx = L.cx(i), filled = !!d.order[i];
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.arc(cx + 1, my + 1.5, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = P.clockRim; g.beginPath(); g.arc(cx, my, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = filled ? P.clock : P.clockDim; g.beginPath(); g.arc(cx, my, r - 1.5, 0, Math.PI * 2); g.fill();
      if (!L.thumb && r >= 7) {
        g.fillStyle = P.hand; g.font = `700 ${Math.round(r * 1.05)}px ${FONT_TYPE}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(i + 1), cx, my + 0.5);
        // 칸 번호만큼 돈 바늘(장식)
        const a = -Math.PI / 2 + (i + 1) * Math.PI / 2;
        g.strokeStyle = filled ? P.pin : P.clockRim; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.6, my + Math.sin(a) * r * 0.6); g.lineTo(cx + Math.cos(a) * (r - 2), my + Math.sin(a) * (r - 2)); g.stroke();
      } else {
        g.fillStyle = P.hand; g.fillRect(cx - 0.5, my - r * 0.55, 1, r * 0.55);
      }
    }
  }

  /* ---------- 장면 ---------- */
  function render(ctx) {
    const { g, w, h } = ctx;
    const thumb = !!ctx.thumb;
    const scheme = ctx.scheme === "dark" ? "dark" : "light";
    const P = PALS[scheme];
    const d = readState(ctx.game);
    const narrow = w < 560;
    const chips = thumb ? [] : makeChips(d, narrow);
    const L = layout(w, h, thumb, narrow, thumb ? 0 : chipRows(g, chips, w), titleBox(thumb), d.unplaced.length > 0);
    const t = thumb || ctx.reduced ? 0 : Number(ctx.t) || 0;
    const text = !thumb;

    g.drawImage(boardImage(thumb ? "thumb" : "stage", w, h, L.fw, P, scheme), 0, 0, w, h);
    lighting(g, L, P, scheme);

    // 위쪽 띠: 종합 설명 카드와 배지
    if (L.band) {
      const B = L.band, bh = B.y1 - B.y0;
      if (bh >= 14 && B.x1 - B.x0 >= 60) {
        const br = clamp(bh * 0.42, 6, 22);
        badge(g, P, B.x1 - br - 2, B.y0 + bh / 2, br);
        const cw = clamp((B.x1 - B.x0) * (B.thumb ? 0.22 : 0.3), 34, 170);
        const cx = B.x1 - br * 2 - 14 - cw;
        if (cx > B.x0) overallCard(g, P, cx, B.y0 + 1, cw, bh - 2, d.overallLen, text);
      }
    }

    // 빈 칸과 신문
    const ANG = [-0.03, 0.022, -0.016, 0.028];
    const pins = [null, null, null, null];
    const tops = [];
    for (let i = 0; i < 4; i++) {
      const id = d.order[i];
      const x = L.cx(i) - L.pw / 2, y = L.py;
      tops.push({ x, y });
      if (!id) {
        g.save();
        g.fillStyle = P.emptyFill; g.fillRect(x, y, L.pw, L.ph);
        g.strokeStyle = P.empty; g.lineWidth = 1.2; g.setLineDash([4, 4]);
        g.strokeRect(x + 0.5, y + 0.5, L.pw - 1, L.ph - 1);
        g.setLineDash([]);
        g.fillStyle = P.qmark; g.font = `700 ${Math.round(clamp(L.pw * 0.4, 9, 40))}px ${FONT_TYPE}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("?", x + L.pw / 2, y + L.ph / 2);
        g.restore();
        continue;
      }
      pins[i] = drawPaper(g, P, id, x, y, L.pw, L.ph, ANG[i], { text, lift: false });
    }

    // 빨간 실: 학생이 정한 순서에서 이웃한 두 칸이 모두 찼을 때만
    const sway = t ? Math.sin(t * 1.3) * 1.2 : 0;
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = pins[i], b = pins[i + 1];
      if (!a || !b) continue;
      const sag = Math.min(L.ph * 0.18, (b.x - a.x) * 0.12) + sway;
      g.strokeStyle = "rgba(0,0,0,0.28)"; g.lineWidth = narrow || thumb ? 1.6 : 2.4;
      g.beginPath(); g.moveTo(a.x + 1, a.y + 2); g.quadraticCurveTo((a.x + b.x) / 2 + 1, (a.y + b.y) / 2 + sag * 2 + 2, b.x + 1, b.y + 2); g.stroke();
      g.strokeStyle = P.string; g.lineWidth = narrow || thumb ? 1.4 : 2;
      g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag * 2, b.x, b.y); g.stroke();
      g.strokeStyle = P.stringHi; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(a.x, a.y - 0.6); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag * 2 - 0.6, b.x, b.y - 0.6); g.stroke();
    }
    g.restore();
    pins.forEach(p => { if (p) pin(g, P, p.x, p.y, clamp(L.pw * 0.05, 2, 5)); });

    // 칸 사이 쪽지: 노랑 = 연결 근거, 분홍 = 사이의 사건
    const gapW = L.slotW - L.pw;
    const ns = clamp(Math.min(gapW * 0.82, L.ph * 0.36), 9, 48);
    for (let i = 0; i < 3; i++) {
      const mx = (L.cx(i) + L.cx(i + 1)) / 2;
      const ny = L.py + L.ph * 0.36;
      const hasL = !!d.links[i], hasG = !!d.gaps[i];
      if (hasL) note(g, P, "link", mx - ns / 2 - ns * 0.12, ny - ns * 0.55, ns, Array.from(d.links[i]).length, -0.06 + i * 0.03, text);
      if (hasG) note(g, P, "gap", mx - ns / 2 + ns * 0.12, ny + ns * 0.55, ns, Array.from(d.gaps[i]).length, 0.05 - i * 0.02, text);
      if (!hasL && !hasG && d.order[i] && d.order[i + 1] && !thumb) placeholder(g, P, mx - ns * 0.35, ny, ns * 0.7);
    }

    // 미배치 서류 더미(자료 2~5 순서)
    let pileRead = null;
    if (L.pile) {
      const n = d.unplaced.length;
      const areaW = L.px1 - L.px0;
      const labH = text && !narrow && areaW >= 56 ? 16 : 0;
      const room = L.ph - labH;
      let pph = room * (n > 1 ? 0.7 : 0.85), ppw = pph * 0.78;
      if (ppw > areaW - 8) { ppw = areaW - 8; pph = ppw / 0.78; }
      const dy = n > 1 ? Math.min(pph * 0.32, (room - pph) / (n - 1)) : 0;
      const tray = { x: L.px0, y: L.py - 2, w: areaW, h: L.ph + 4 };
      g.save();
      g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(tray.x, tray.y, tray.w, tray.h);
      g.strokeStyle = P.empty; g.lineWidth = 1; g.strokeRect(tray.x + 0.5, tray.y + 0.5, tray.w - 1, tray.h - 1);
      g.restore();
      if (labH) {
        const lw = Math.min(areaW - 4, 74), lh = 15;
        const lx = tray.x + (areaW - lw) / 2, ly = tray.y + 2;
        {
          g.fillStyle = P.label; g.fillRect(lx, ly, lw, lh);
          g.fillStyle = P.labelRed; g.fillRect(lx, ly, 2, lh);
          g.fillStyle = P.labelInk; g.font = `600 10.5px ${FONT_TYPE}`; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(`미배치 ${n}`, lx + lw / 2 + 1, ly + lh / 2 + 0.5);
        }
      }
      d.unplaced.forEach((id, k) => {
        const x = L.px0 + (areaW - ppw) / 2 + (k % 2 ? 3 : -3);
        const y = L.py + labH + 2 + (n > 1 ? k * dy : (room - pph) / 2);
        const pp = drawPaper(g, P, id, x, y, ppw, pph, (k % 2 ? 0.05 : -0.04), { text: text && ppw >= 80, lift: id === d.sel, sel: id === d.sel });
        if (id === d.tab) pileRead = { x: x + ppw * 0.7, y: y + pph * 0.55, r: clamp(ppw * 0.22, 4, 22) };
        void pp;
      });
      if (!n) {
        g.fillStyle = P.qmark; g.font = `700 ${Math.round(clamp(areaW * 0.18, 9, 22))}px ${FONT_TYPE}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("0", tray.x + areaW / 2, tray.y + tray.h / 2);
      }
    }

    // 돋보기: 지금 읽고 있는 신문
    const slotRead = d.order.indexOf(d.tab);
    if (slotRead >= 0) {
      const tp = tops[slotRead];
      const r = clamp(L.pw * 0.22, 4, 24);
      magnifier(g, P, tp.x + L.pw * 0.66, tp.y + L.ph * 0.58 + (t ? Math.sin(t * 0.9) * 1.5 : 0), r);
    } else if (pileRead) {
      magnifier(g, P, pileRead.x, pileRead.y + (t ? Math.sin(t * 0.9) * 1.5 : 0), pileRead.r);
    }

    timeline(g, P, L, d);
    if (t && !thumb) motes(g, L, P, t);

    return { caption: caption(d), chips, animate: !thumb && !ctx.reduced };
  }

  KCP.v2.skin(ID, { kicker: "CASE BOARD", title: "켄테시아 사건 게시판", render });
})();
