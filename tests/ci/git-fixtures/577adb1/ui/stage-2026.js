/* 2026 최우수 혁신기술 선정평가 · 심사 법정(COURT OF REVIEW)
 * 휴대용 게임기 시절 법정 추리 게임의 화면 문법을 빌린 장면이다. 나무 판벽 앞 높은 단상에 위원장이 앉아 있고,
 * 아래에는 네 후보 기술이 '증거품 패' 네 장으로 놓인다. 패마다 학생이 평가표에 매긴 합계(0~25점)가 막대로 차오르고,
 * 오른쪽 '증거 제출' 함에는 채운 칸 수(x/20)가 기술(행) × 기준(열) 칸으로 쌓인다. 학생이 최우수 기술을 고르면
 * 가시 돋친 말풍선 '추천!'이 그 패를 가리킨다.
 * 정답 누설 방지: 장면은 학생이 고른 점수와 추천만 비춘다. 보고서의 예시 답안·해설·단서는 읽지도 그리지도 않는다.
 * 합계가 가장 높은 패를 따로 표시하지 않는다(추천은 학생이 누른 버튼만 따른다).
 * 게임 상태(state.game)는 읽기만 한다. 움직임은 막대 차오름과 말풍선 등장뿐이고, 줄인 움직임에서는 최종 상태만 그린다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || !KCP.v2 || typeof KCP.v2.skin !== "function") return;

  const ID = "2026";
  const CRIT = ["f", "s", "e", "g", "u"];
  const TECH = [
    { id: "bb", name: "브레인부스트 듀오", short: "브레인부스트" },
    { id: "db", name: "드림밴드", short: "드림밴드" },
    { id: "ml", name: "AI 마음렌즈", short: "마음렌즈" },
    { id: "wc", name: "울버린 켄텍카솔", short: "켄텍카솔" },
  ];
  const MAX = 25;
  const CELLS = TECH.length * CRIT.length;
  const FONT_D = '"Black Han Sans", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';
  const FONT_B = '"IBM Plex Sans KR", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';
  const FONT_M = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const R = Math.round;
  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 상태 읽기(읽기 전용) ---------- */
  function read(game) {
    const G = game && typeof game === "object" ? game : {};
    const sc = G.scores && typeof G.scores === "object" ? G.scores : {};
    let filled = 0;
    const techs = TECH.map((t) => {
      const row = own(sc, t.id) && sc[t.id] && typeof sc[t.id] === "object" ? sc[t.id] : {};
      const vals = CRIT.map((k) => {
        const v = Number(row[k]);
        return Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0;
      });
      const n = vals.filter(Boolean).length;
      filled += n;
      return { id: t.id, name: t.name, short: t.short, vals, n, total: vals.reduce((a, b) => a + b, 0) };
    });
    const best = TECH.some((t) => t.id === G.best) ? G.best : "";
    return { techs, filled, best, done: techs.filter((t) => t.n === CRIT.length).length };
  }

  /* ---------- 색 ---------- */
  function palette(dark) {
    return dark
      ? {
          wall: "#3a2517", wallLine: "#2c1b10", wallHi: "#4a3120", mold: "#6b4421", moldHi: "#c79a3e",
          wain: "#24160c", wainHi: "#352213", wainDk: "#140b05",
          benchTop: "#8a5527", benchHi: "#b07436", benchFace: "#5c3518", benchDk: "#341c0a",
          gold: "#e2b64e", goldDk: "#9a7422", goldHi: "#f6dc8c",
          chair: "#5e1c18", chairHi: "#7e2a22",
          robe: "#141418", robeHi: "#2a2a32", skin: "#e5b88c", skinDk: "#b98a62", beard: "#ece6da", beardDk: "#b9b1a2", hair: "#c9c2b6", eye: "#1b1410",
          lamp: "rgba(255, 196, 96, 0.28)", lampCore: "#ffd27a",
          cardFrame: "#7a4f22", cardFace: "#2e1e11", cardText: "#f1e2c0", cardMuted: "#d8c49a", iconBg: "#121a2e", iconGrid: "#1c2742",
          gaugeBox: "#140b05", gaugeEmpty: "#4a331d", gaugeFill: "#6fb0ff", gaugeHi: "#b9d9ff", tick: "#140b05",
          trayFace: "#16222a", slot: "#2a3a44", slotFill: "#e2b64e", slotFillHi: "#f6dc8c",
          tagBg: "#e2b64e", tagInk: "#1c120b", badgeBg: "#0c0805", badgeInk: "#f6dc8c",
          bubble: "#fffdf6", bubbleEdge: "#0e0a07", bubbleInk: "#d8261c", speed: "rgba(255, 236, 190, 0.45)", flash: "255, 246, 220",
        }
      : {
          wall: "#e6d1a2", wallLine: "#d2b984", wallHi: "#efdfb8", mold: "#8a5a2e", moldHi: "#d4a43c",
          wain: "#8b5a31", wainHi: "#a46d3d", wainDk: "#6a4120",
          benchTop: "#b97d42", benchHi: "#dba062", benchFace: "#8a5530", benchDk: "#5e3519",
          gold: "#d6a838", goldDk: "#93701c", goldHi: "#f3d685",
          chair: "#8e2a24", chairHi: "#b13a30",
          robe: "#26262c", robeHi: "#3f3f48", skin: "#f0c69a", skinDk: "#c99a6e", beard: "#fbf8f1", beardDk: "#cfc8bb", hair: "#d6d0c4", eye: "#2a1a10",
          lamp: "rgba(255, 220, 140, 0.22)", lampCore: "#fff0c4",
          cardFrame: "#5a3519", cardFace: "#f7eed6", cardText: "#3a2414", cardMuted: "#5e4129", iconBg: "#25304e", iconGrid: "#2f3c60",
          gaugeBox: "#3a2414", gaugeEmpty: "#e6d6b0", gaugeFill: "#2f6fc4", gaugeHi: "#7fb0f0", tick: "#3a2414",
          trayFace: "#20303a", slot: "#3a4e5c", slotFill: "#e2b64e", slotFillHi: "#f6dc8c",
          tagBg: "#d6a838", tagInk: "#2a1a0c", badgeBg: "#1c120b", badgeInk: "#f6dc8c",
          bubble: "#ffffff", bubbleEdge: "#1a120c", bubbleInk: "#d1231a", speed: "rgba(255, 255, 255, 0.55)", flash: "255, 255, 255",
        };
  }

  /* ---------- 증거품 그림(12×12 점 그림) ---------- */
  const ICON_PAL = {
    k: "#120c08", p: "#f29bb4", P: "#d4708e", b: "#4f8df0", y: "#f2c84b", v: "#9a7cf0", m: "#ffe28a", w: "#f8f6ef",
    c: "#5fd6e6", C: "#2a8aa6", r: "#e0402e", S: "#b9c0c8", s: "#e8ecf0",
  };
  const ICONS = {
    // 브레인부스트 듀오: 뇌와 캡슐
    bb: ["...kkkkkk...", "..kppPppPk..", ".kpPpppPppk.", "kppppPpppPpk", "kpPpppPpppPk", "kppPpppPpppk",
      ".kpppPpppPk.", "..kkkpppkk..", "....kkkk....", "..kbbbyyyk..", "..kbbbyyyk..", "...kkkkkk..."],
    // 드림밴드: 머리띠와 잠(Z)
    db: ["..kkkkkkkk..", ".kvvvvvvvvk.", "kvvkkkkkkvvk", "kvk......kvk", "kvk.mmmm.kvk", "kvk...m..kvk",
      "kvk..m...kvk", "kvk.mmmm.kvk", "kmk......kmk", "kkk......kkk", "............", "............"],
    // AI 마음렌즈: 렌즈 속 눈
    ml: ["............", "....kkkk....", "..kkwwwwkk..", ".kwwwccwwwk.", "kwwwcCCcwwwk", "kwwcCkkCcwwk",
      "kwwcCkkCcwwk", "kwwwcCCcwwwk", ".kwwwccwwwk.", "..kkwwwwkk..", "....kkkk....", "............"],
    // 울버린 켄텍카솔: 연고 튜브
    wc: ["....kkkk....", "....kSSk....", "...kkkkkk...", "...kwwwwk...", "...kwrrwk...", "...krrrrk...",
      "...kwrrwk...", "...kwwwwk...", "...kwwwwk...", "...kwwwwk...", "..kkkkkkkk..", "..kSsSsSsk.."],
  };
  function sprite(g, map, x, y, s) {
    for (let r = 0; r < map.length; r++) {
      const row = map[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === "." || !ICON_PAL[ch]) continue;
        g.fillStyle = ICON_PAL[ch];
        g.fillRect(x + c * s, y + r * s, s, s);
      }
    }
  }

  /* ---------- 글자 ---------- */
  // 폭에 맞춰 글자 크기를 줄인다. 최소 크기보다 작아지면 0을 돌려주고 그리지 않는다.
  function fitFont(g, str, family, weight, size, maxW, min) {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (s > min && g.measureText(str).width > maxW) {
      s -= 1;
      g.font = `${weight} ${s}px ${family}`;
    }
    return g.measureText(str).width <= maxW ? s : 0;
  }
  // 네 패의 이름을 같은 크기로 맞춘다: 전체 이름이 모두 들어가면 전체 이름, 아니면 모두 짧은 이름.
  const labelCache = new Map();
  try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => labelCache.clear()); } catch (e) { /* 글꼴 이벤트가 없으면 그대로 둔다 */ }
  function labelFit(g, maxW, size) {
    const key = `${R(maxW)}|${size}`;
    if (labelCache.has(key)) return labelCache.get(key);
    const fit = (k) => Math.min(...TECH.map((t) => fitFont(g, t[k], FONT_D, 400, size, maxW, 9)));
    let out = { key: "name", size: fit("name") };
    if (out.size < Math.min(size, 11)) { const s2 = fit("short"); out = s2 > out.size ? { key: "short", size: s2 } : out; }
    if (labelCache.size > 40) labelCache.clear();
    labelCache.set(key, out);
    return out;
  }
  function text(g, str, x, y, color, align, base) {
    g.textAlign = align || "left";
    g.textBaseline = base || "alphabetic";
    g.fillStyle = color;
    g.fillText(str, x, y);
  }

  /* ---------- 배경: 판벽과 몰딩 ---------- */
  function drawWall(g, w, h, P, U, moldY) {
    g.fillStyle = P.wall;
    g.fillRect(0, 0, w, h);
    const step = U * 12;
    for (let x = R((w % step) / 2); x < w; x += step) {
      g.fillStyle = P.wallLine;
      g.fillRect(x, 0, U, moldY);
      g.fillStyle = P.wallHi;
      g.fillRect(x + U, 0, U, moldY);
    }
    g.fillStyle = P.mold;
    g.fillRect(0, moldY, w, U * 2);
    g.fillStyle = P.moldHi;
    g.fillRect(0, moldY, w, U);
    const top = moldY + U * 2;
    g.fillStyle = P.wain;
    g.fillRect(0, top, w, h - top);
    // 판벽 안 네모 판(빛 받는 윗변·왼변, 그늘진 아랫변·오른변)
    const pw = U * 34, ph = h - top - U * 6;
    if (ph > U * 4) {
      for (let x = R(((w - U * 2) % pw) / 2) + U * 2; x + pw - U * 3 <= w; x += pw) {
        const ww = pw - U * 3, y0 = top + U * 3;
        g.fillStyle = P.wainDk;
        g.fillRect(x, y0 + ph - U, ww, U);
        g.fillRect(x + ww - U, y0, U, ph);
        g.fillStyle = P.wainHi;
        g.fillRect(x, y0, ww, U);
        g.fillRect(x, y0, U, ph);
      }
    }
  }

  function drawLamp(g, x, y, U, P, dark) {
    const r = U * (dark ? 22 : 16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, P.lamp);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.fillStyle = P.goldDk;
    g.fillRect(x - U * 2, y + U * 2, U * 4, U * 2);
    g.fillStyle = P.lampCore;
    g.fillRect(x - U, y - U * 2, U * 2, U * 4);
    g.fillStyle = P.gold;
    g.fillRect(x - U * 3, y + U * 2, U * 6, U);
  }

  /* ---------- 위원장 단상 ---------- */
  // 단상 위로 위원장(흰 수염, 검은 법복)이 보이고 뒤에 붉은 등받이가 선다. gu는 점 하나의 크기.
  function drawJudge(g, cx, benchTop, gu, P) {
    const x0 = R(cx - gu * 10), y0 = R(benchTop - gu * 14);
    const B = (c, r, w, h, col) => { g.fillStyle = col; g.fillRect(x0 + c * gu, y0 + r * gu, w * gu, h * gu); };
    // 등받이
    B(-2, -2, 24, 17, P.chair);
    B(-1, -3, 22, 1, P.goldHi);
    B(-2, -2, 24, 1, P.gold);
    B(-1, -1, 1, 15, P.chairHi);
    // 법복과 흰 옷깃
    B(1, 10, 18, 5, P.robe);
    B(3, 9, 14, 1, P.robe);
    B(2, 11, 2, 4, P.robeHi);
    B(8, 9, 4, 3, P.beard);
    // 머리
    B(6, 1, 8, 8, P.skin);
    B(5, 2, 1, 6, P.skin);
    B(14, 2, 1, 6, P.skin);
    B(6, 0, 8, 1, P.skinDk);
    B(4, 2, 1, 4, P.hair);
    B(15, 2, 1, 4, P.hair);
    B(5, 1, 1, 2, P.hair);
    B(14, 1, 1, 2, P.hair);
    // 눈썹·눈·코
    B(7, 3, 2, 1, P.hair);
    B(11, 3, 2, 1, P.hair);
    B(7, 4, 2, 1, P.eye);
    B(11, 4, 2, 1, P.eye);
    B(9, 5, 2, 1, P.skinDk);
    // 수염
    B(5, 6, 10, 2, P.beard);
    B(6, 8, 8, 2, P.beard);
    B(7, 10, 6, 1, P.beard);
    B(8, 11, 4, 1, P.beard);
    B(6, 9, 1, 1, P.beardDk);
    B(13, 9, 1, 1, P.beardDk);
    B(9, 6, 2, 1, P.beardDk);
    // 의사봉(오른손)
    B(17, 7, 4, 2, P.benchHi);
    B(18, 9, 1, 4, P.benchFace);
  }

  function drawBench(g, x, y, bw, bh, U, P, label) {
    g.fillStyle = P.benchDk;
    g.fillRect(x - U, y - U, bw + U * 2, bh + U);
    g.fillStyle = P.benchFace;
    g.fillRect(x, y + U * 3, bw, bh - U * 3);
    g.fillStyle = P.benchTop;
    g.fillRect(x - U * 2, y, bw + U * 4, U * 3);
    g.fillStyle = P.benchHi;
    g.fillRect(x - U * 2, y, bw + U * 4, U);
    // 세로 판과 금색 띠
    const n = Math.max(2, Math.round(bw / (U * 22)));
    for (let i = 1; i < n; i++) {
      g.fillStyle = P.benchDk;
      g.fillRect(R(x + (bw * i) / n), y + U * 3, U, bh - U * 3);
    }
    g.fillStyle = P.gold;
    g.fillRect(x, R(y + U * 3 + (bh - U * 3) * 0.32), bw, U);
    // 이름패
    const pw = Math.min(U * 34, R(bw * 0.46)), ph = Math.min(U * 9, R((bh - U * 3) * 0.5));
    if (label && ph >= 11 && pw >= 36) {
      const px = R(x + (bw - pw) / 2), py = R(y + U * 3 + (bh - U * 3 - ph) * 0.62);
      g.fillStyle = P.goldDk;
      g.fillRect(px - U, py - U, pw + U * 2, ph + U * 2);
      g.fillStyle = P.gold;
      g.fillRect(px, py, pw, ph);
      g.fillStyle = P.goldHi;
      g.fillRect(px, py, pw, U);
      if (fitFont(g, "위원장", FONT_D, 400, Math.min(16, ph - 2), pw - U * 4, 9)) text(g, "위원장", px + pw / 2, py + ph / 2 + 1, "#2a1a0c", "center", "middle");
    }
  }

  /* ---------- 증거 제출 함 ---------- */
  function drawTray(g, x, y, tw, th, st, P, U, withText) {
    g.fillStyle = P.benchDk;
    g.fillRect(x, y, tw, th);
    g.fillStyle = P.gold;
    g.fillRect(x + U, y + U, tw - U * 2, th - U * 2);
    g.fillStyle = P.trayFace;
    g.fillRect(x + U * 2, y + U * 2, tw - U * 4, th - U * 4);
    let top = y + U * 3;
    if (withText && th >= 50) {
      const label = `${st.filled}/${CELLS}`;
      const head = tw >= 118 ? "증거 제출" : "";
      const hs = Math.max(10, Math.min(14, R(th * 0.16)));
      g.font = `600 ${hs}px ${FONT_M}`;
      const nw = g.measureText(label).width;
      if (head) {
        if (fitFont(g, head, FONT_D, 400, hs + 1, tw - U * 8 - nw - 6, 9)) text(g, head, x + U * 4, top + hs * 0.95, P.goldHi, "left", "alphabetic");
        g.font = `600 ${hs}px ${FONT_M}`;
        text(g, label, x + tw - U * 4, top + hs * 0.95, "#f7eed6", "right", "alphabetic");
      } else {
        text(g, label, x + tw / 2, top + hs * 0.95, "#f7eed6", "center", "alphabetic");
      }
      top += hs + U * 2;
    }
    const gap = Math.max(1, U);
    const aw = tw - U * 6, ah = y + th - U * 3 - top;
    const s = Math.floor(Math.min((aw - gap * 4) / 5, (ah - gap * 3) / 4));
    if (s < 2) return;
    const gx = R(x + (tw - (s * 5 + gap * 4)) / 2), gy = R(top + (ah - (s * 4 + gap * 3)) / 2);
    st.techs.forEach((t, r) => {
      t.vals.forEach((v, c) => {
        const sx = gx + c * (s + gap), sy = gy + r * (s + gap);
        g.fillStyle = v ? P.slotFill : P.slot;
        g.fillRect(sx, sy, s, s);
        if (v && s >= 4) {
          g.fillStyle = P.slotFillHi;
          g.fillRect(sx, sy, s, Math.max(1, R(s / 4)));
        }
      });
    });
  }

  /* ---------- 증거품 패 ---------- */
  function drawGauge(g, x, y, gw, gh, shown, P) {
    g.fillStyle = P.gaugeBox;
    g.fillRect(x, y, gw, gh);
    const ix = x + 1, iy = y + 1, iw = gw - 2, ih = gh - 2;
    g.fillStyle = P.gaugeEmpty;
    g.fillRect(ix, iy, iw, ih);
    const fw = R((iw * clamp(shown, 0, MAX)) / MAX);
    if (fw > 0) {
      g.fillStyle = P.gaugeFill;
      g.fillRect(ix, iy, fw, ih);
      g.fillStyle = P.gaugeHi;
      g.fillRect(ix, iy, fw, Math.max(1, R(ih / 3)));
    }
    g.fillStyle = P.tick;
    for (let i = 1; i < 5; i++) g.fillRect(R(ix + (iw * i) / 5), iy, 1, ih);
  }

  function drawCard(g, box, t, idx, shown, chosen, P, U, withText) {
    const { x, y, w: cw, h: ch } = box;
    const b = Math.max(2, U);
    // 바깥 틀(추천한 패는 금색으로 빛난다)
    if (chosen) {
      g.fillStyle = P.goldHi;
      g.fillRect(x - b, y - b, cw + b * 2, ch + b * 2);
    }
    g.fillStyle = chosen ? P.gold : P.cardFrame;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = chosen ? P.goldDk : P.gold;
    g.fillRect(x + b, y + b, cw - b * 2, ch - b * 2);
    g.fillStyle = P.cardFace;
    g.fillRect(x + b * 2, y + b * 2, cw - b * 4, ch - b * 4);
    const ix0 = x + b * 2, iy0 = y + b * 2, iw0 = cw - b * 4, ih0 = ch - b * 4;
    const pad = Math.max(3, R(Math.min(iw0, ih0) * 0.06));
    const horiz = iw0 >= ih0 * 1.55 || ih0 < 62;
    let icon, area;
    if (horiz) {
      const s = ih0 - pad * 2;
      icon = { x: ix0 + pad, y: iy0 + pad, s };
      area = { x: ix0 + pad * 2 + s, y: iy0 + pad, w: iw0 - s - pad * 3, h: s };
    } else {
      const band = withText ? clamp(R(ih0 * 0.3), 22, 40) : clamp(R(ih0 * 0.14), 8, 14);
      const s = Math.max(8, Math.min(iw0 - pad * 2, ih0 - pad * 2 - band));
      const sp = Math.max(2, R(pad / 2));
      icon = { x: R(ix0 + (iw0 - s) / 2), y: iy0 + pad, s };
      area = { x: ix0 + pad, y: iy0 + pad + s + sp, w: iw0 - pad * 2, h: ih0 - pad * 2 - s - sp };
    }
    // 그림 칸: 남색 격자 위 점 그림
    g.fillStyle = P.iconBg;
    g.fillRect(icon.x, icon.y, icon.s, icon.s);
    g.fillStyle = P.iconGrid;
    const gs = Math.max(4, R(icon.s / 6));
    for (let k = gs; k < icon.s; k += gs) {
      g.fillRect(icon.x + k, icon.y, 1, icon.s);
      g.fillRect(icon.x, icon.y + k, icon.s, 1);
    }
    const ps = Math.max(1, Math.floor((icon.s * 0.78) / 12));
    sprite(g, ICONS[t.id], R(icon.x + (icon.s - ps * 12) / 2), R(icon.y + (icon.s - ps * 12) / 2), ps);
    // 증거 번호 꼬리표
    if (icon.s >= 26) {
      const ts = clamp(R(icon.s * 0.2), 11, 18);
      g.fillStyle = P.tagBg;
      g.fillRect(icon.x, icon.y, ts, ts);
      if (withText) {
        g.font = `700 ${ts - 3}px ${FONT_M}`;
        text(g, String(idx + 1), icon.x + ts / 2, icon.y + ts / 2 + 1, P.tagInk, "center", "middle");
      }
    }
    const scoreTxt = t.total ? `합계 ${t.total}/${MAX}` : "미채점";
    if (horiz) {
      if (area.w < 18) return;
      const gh = clamp(R(area.h * 0.16), 6, 14);
      const gy = area.y + area.h - gh;
      drawGauge(g, area.x, gy, area.w, gh, shown, P);
      if (withText && area.w >= 34) {
        const nameSize = clamp(R(area.h * 0.24), 10, 19);
        const ny = area.y + Math.max(nameSize, R(area.h * 0.34));
        const lf = area.h >= 30 ? labelFit(g, area.w, nameSize) : { size: 0 };
        if (lf.size) {
          g.font = `400 ${lf.size}px ${FONT_D}`;
          text(g, t[lf.key], area.x, ny, P.cardText, "left", "alphabetic");
        }
        const ss = clamp(R(area.h * 0.18), 10, 15);
        const label = area.w >= 70 ? scoreTxt : t.total ? String(t.total) : "-";
        if (fitFont(g, label, t.total ? FONT_M : FONT_B, 600, ss, area.w, 9)) text(g, label, area.x, gy - Math.max(3, R(gh * 0.5)), P.cardMuted, "left", "alphabetic");
      }
    } else {
      const gh = clamp(R(area.h * 0.26), 5, 10);
      const gy = area.y + area.h - gh;
      drawGauge(g, area.x, gy, area.w, gh, shown, P);
      if (withText) {
        const room = gy - area.y - 2;
        const lf = room >= 10 ? labelFit(g, area.w, clamp(room, 10, 14)) : { size: 0 };
        if (lf.size) {
          g.font = `400 ${lf.size}px ${FONT_D}`;
          text(g, t[lf.key], area.x + area.w / 2, area.y + lf.size, P.cardText, "center", "alphabetic");
        }
        // 합계 배지: 그림 칸 오른쪽 아래
        if (icon.s >= 30) {
          const bs = clamp(R(icon.s * 0.2), 11, 16);
          const label = t.total ? String(t.total) : "-";
          g.font = `700 ${bs}px ${FONT_M}`;
          const bw = Math.max(bs + 4, R(g.measureText(label).width) + 8);
          g.fillStyle = P.badgeBg;
          g.fillRect(icon.x + icon.s - bw, icon.y + icon.s - bs - 4, bw, bs + 4);
          text(g, label, icon.x + icon.s - bw / 2, icon.y + icon.s - (bs + 4) / 2 + 1, P.badgeInk, "center", "middle");
        }
      }
    }
  }

  /* ---------- 추천 말풍선 ---------- */
  function spikes(cx, cy, rx, ry, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2;
      const k = i % 2 ? 0.8 + ((i * 7) % 5) * 0.02 : 1.06 + ((i * 3) % 4) * 0.03;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function poly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }
  function drawBubble(g, B, tip, P, U, scale, withText) {
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    g.save();
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
    const body = spikes(cx, cy, B.w / 2, B.h / 2, 11);
    const tx = clamp(tip.x, B.x + B.w * 0.28, B.x + B.w * 0.72);
    const tw = Math.max(U * 4, B.w * 0.1);
    const tail = [[tx - tw, cy + B.h * 0.2], [tx + tw, cy + B.h * 0.2], [tip.x, tip.y]];
    g.lineJoin = "miter";
    g.lineWidth = Math.max(3, U * 2);
    g.strokeStyle = P.bubbleEdge;
    poly(g, tail);
    g.stroke();
    poly(g, body);
    g.stroke();
    g.fillStyle = P.bubble;
    poly(g, tail);
    g.fill();
    poly(g, body);
    g.fill();
    if (withText && B.fs >= 10) {
      g.font = `400 ${B.fs}px ${FONT_D}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      g.lineWidth = Math.max(3, R(B.fs / 7));
      g.strokeStyle = P.bubbleEdge;
      g.strokeText("추천!", cx, cy + 1);
      g.fillStyle = P.bubbleInk;
      g.fillText("추천!", cx, cy + 1);
    }
    g.restore();
  }
  function drawSpeed(g, cx, cy, w, h, P, k) {
    g.save();
    g.strokeStyle = P.speed;
    g.globalAlpha = clamp(k, 0, 1);
    const n = 28, L = Math.hypot(w, h);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ((i * 13) % 7) * 0.02;
      g.lineWidth = 2 + (i % 3) * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * L * 0.12, cy + Math.sin(a) * L * 0.12);
      g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      g.stroke();
    }
    g.restore();
  }

  /* ---------- 장면 기억(막대 차오름, 말풍선 등장 시각) ---------- */
  // 셸은 크기가 바뀌거나 화면 밖으로 나가면 그리기를 멈출 수 있다. 그래서 크기가 바뀌었거나 그림 사이가
  // 0.25초 넘게 벌어지면 움직임을 건너뛰고 최종 상태를 그린다(중간 프레임이 멈춰 남지 않게).
  const mem = { lastT: -1, prevT: 0, best: null, burstAt: -99, shown: null, size: "", moving: false };

  // DOM 이름표와 칩의 위치(캔버스 기준). 읽기만 하고, 없으면 어림값을 쓴다.
  function measure(w, h, thumb) {
    const out = { titleR: thumb ? 0 : Math.min(w * 0.5, w <= 560 ? 190 : 250), titleB: thumb ? 0 : w <= 560 ? 40 : 58, hudT: thumb ? h : h - 42 };
    if (thumb) return out;
    try {
      const stage = document.getElementById("v2-stage");
      const cv = stage && stage.querySelector("canvas");
      if (!cv) return out;
      const cr = cv.getBoundingClientRect();
      const top = stage.querySelector(".v2-stage-top");
      if (top) {
        const r = top.getBoundingClientRect();
        if (r.width && r.height) { out.titleR = r.right - cr.left; out.titleB = r.bottom - cr.top; }
      }
      let tmin = Infinity;
      stage.querySelectorAll(".v2-stage-chip").forEach((c) => { const r = c.getBoundingClientRect(); if (r.height) tmin = Math.min(tmin, r.top - cr.top); });
      if (isFinite(tmin)) out.hudT = tmin;
    } catch (e) { /* 어림값을 쓴다 */ }
    return out;
  }

  function render(ctx) {
    const g = ctx.g, w = Math.max(1, ctx.w), h = Math.max(1, ctx.h);
    const thumb = !!ctx.thumb, dark = ctx.scheme === "dark", still = !!ctx.reduced || thumb;
    const st = read(ctx.game);
    const P = palette(dark);
    const U = w >= 900 && h >= 200 ? 3 : 2;
    const M = measure(w, h, thumb);
    const narrow = w <= 560;
    const compact = h < 200 || thumb;
    g.imageSmoothingEnabled = false;

    // 막대·말풍선 기억(새 장면이면 초기화하고, 처음 그림에서는 등장 효과를 내지 않는다)
    let shown = st.techs.map((t) => t.total), burstK = 0, animate = false;
    if (!thumb) {
      if (ctx.t < mem.lastT || !mem.shown) { mem.best = st.best; mem.burstAt = -99; mem.shown = shown.slice(); mem.prevT = ctx.t; }
      if (st.best !== mem.best) { mem.best = st.best; if (st.best) mem.burstAt = ctx.t; }
      const size = `${R(w)}x${R(h)}`;
      const gapT = ctx.t - mem.prevT;
      const settle = still || size !== mem.size || (mem.moving && gapT > 0.25);
      mem.size = size;
      const dt = mem.moving ? clamp(gapT, 0, 0.2) : 1 / 60;
      mem.prevT = ctx.t;
      mem.lastT = ctx.t;
      if (settle) { mem.shown = shown.slice(); mem.burstAt = -99; }
      else {
        mem.shown = mem.shown.map((v, i) => {
          const d = shown[i] - v;
          const nv = Math.abs(d) < 0.05 ? shown[i] : v + d * Math.min(1, dt * 9);
          if (nv !== shown[i]) animate = true;
          return nv;
        });
      }
      shown = mem.shown;
      const age = ctx.t - mem.burstAt;
      if (!still && st.best && age >= 0 && age < 0.9) { burstK = 1 - age / 0.9; animate = true; }
      mem.moving = animate;
    }

    // 배치: 위쪽 띠(이름표·단상·증거 함), 아래쪽 줄(증거품 패 네 장), 맨 아래 칩
    const cardsBottom = thumb ? h - 6 : Math.min(h - 6, M.hudT - 6);
    const rowTop = compact
      ? R(Math.max(thumb ? h * 0.42 : M.titleB + 4, cardsBottom - (thumb ? h : 130)))
      : R(Math.max(h * 0.48, M.titleB + 8));
    const zoneB = rowTop - (compact ? 4 : 8);

    // 1) 판벽
    drawWall(g, w, h, P, U, zoneB - (compact ? 0 : U * 2));

    // 2) 증거 제출 함(오른쪽 위)
    const trayW = R(clamp(w * (narrow ? 0.22 : 0.17), 64, 190));
    const trayH = R(clamp(zoneB - (compact ? 6 : 14), 28, 104));
    const trayX = R(w - trayW - (narrow ? 8 : 14)), trayY = compact ? 4 : 10;

    // 3) 단상과 위원장(좁은 장면에서는 이름표와 함 사이 가운데)
    const freeL = compact ? Math.min(M.titleR + 6, trayX - 40) : 0;
    const freeR = trayX - 6;
    const bcx = compact ? R((freeL + freeR) / 2) : R(w / 2);
    const bw = R(clamp(compact ? (freeR - freeL) * 0.8 : w * 0.3, 48, compact ? 200 : 320));
    const bh = R(clamp(zoneB * (compact ? 0.42 : 0.4), 10, 64));
    const benchTop = zoneB - bh + (compact ? 0 : U * 2);
    const gu = Math.max(1, Math.floor(Math.min((benchTop - (compact ? 3 : 10)) / 15, bw / 26)));
    if (!compact && w >= 640) {
      drawLamp(g, R(bcx - bw / 2 - U * 22), R(benchTop - bh * 0.6), U, P, dark);
      drawLamp(g, R(bcx + bw / 2 + U * 22), R(benchTop - bh * 0.6), U, P, dark);
    }
    if (benchTop - gu * 17 >= -2) drawJudge(g, bcx, benchTop, gu, P);
    drawBench(g, R(bcx - bw / 2), benchTop, bw, bh, U, P, !thumb);
    drawTray(g, trayX, trayY, trayW, trayH, st, P, U, !thumb);

    // 4) 증거품 패 네 장
    const side = narrow ? 8 : 16;
    const gap = narrow ? 6 : 14;
    const ch = Math.max(20, cardsBottom - rowTop);
    const cw = Math.min(narrow ? 200 : 280, (w - side * 2 - gap * 3) / 4);
    const x0 = R((w - (cw * 4 + gap * 3)) / 2);
    const boxes = TECH.map((t, i) => ({ x: R(x0 + i * (cw + gap)), y: rowTop, w: R(cw), h: R(ch) }));
    st.techs.forEach((t, i) => drawCard(g, boxes[i], t, i, shown[i], st.best === t.id, P, U, !thumb));

    // 5) 추천 말풍선: 학생이 누른 기술만 가리킨다
    if (st.best) {
      const card = boxes[TECH.findIndex((t) => t.id === st.best)];
      const tip = { x: card.x + card.w / 2, y: card.y + Math.min(card.h * 0.35, 18) };
      const zh = Math.max(16, zoneB - (compact ? 2 : 6));
      let fs = R(clamp(zh * (compact ? 0.5 : 0.42), 14, 40));
      g.font = `400 ${fs}px ${FONT_D}`;
      let bwid = g.measureText("추천!").width / 0.6, bht = fs / 0.6;
      if (bht > zh) { const k = zh / bht; fs = R(fs * k); bwid *= k; bht = zh; }
      // 위치: 가리키는 패 위. 이름표와 증거 함을 피한다.
      let bx = tip.x - bwid / 2;
      const by = zoneB - bht - (compact ? 0 : U * 2);
      if (by < M.titleB && bx < M.titleR + 6) bx = M.titleR + 6;
      if (by < trayY + trayH && bx + bwid > trayX - 6) bx = trayX - 6 - bwid;
      bx = clamp(bx, 4, Math.max(4, w - bwid - 4));
      const B = { x: R(bx), y: R(by), w: R(bwid), h: R(bht), fs };
      if (burstK > 0) {
        drawSpeed(g, B.x + B.w / 2, B.y + B.h / 2, w, h, P, burstK);
        g.fillStyle = `rgba(${P.flash}, ${(burstK * burstK * 0.45).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      }
      const age = 1 - burstK;
      const scale = burstK > 0 ? (age < 0.35 ? 0.55 + (age / 0.35) * 0.6 : 1.15 - Math.min(1, (age - 0.35) / 0.3) * 0.15) : 1;
      drawBubble(g, B, tip, P, U, scale, !thumb);
    }

    // 캡션과 칩: 학생이 입력한 값만
    const nameOf = (id) => (TECH.find((t) => t.id === id) || {}).name || "";
    const per = st.techs.map((t) => `${t.name} ${t.total ? `합계 ${t.total}점(${t.n}/5칸)` : "미채점"}`).join(", ");
    const caption = `심사 법정 장면. 위원장 단상 아래 후보 기술 증거품 네 장. 평가표 ${st.filled}/${CELLS}칸 채움. ${per}. ${st.best ? `추천한 기술: ${nameOf(st.best)}.` : "아직 추천한 기술 없음."}`;
    const chips = [
      { label: "증거 제출", value: `${st.filled}/${CELLS}`, tone: st.filled === CELLS ? "ok" : st.filled ? "info" : "muted" },
      { label: "추천", value: st.best ? nameOf(st.best) : "미정", tone: st.best ? "rec" : "muted" },
    ];
    if (!narrow) chips.push({ label: "채점 끝난 기술", value: `${st.done}/${TECH.length}`, tone: st.done === TECH.length ? "ok" : "muted" });
    return { caption, chips, animate };
  }

  KCP.v2.skin(ID, { kicker: "COURT OF REVIEW", title: "최우수 기술 심사 법정", render });
})();
