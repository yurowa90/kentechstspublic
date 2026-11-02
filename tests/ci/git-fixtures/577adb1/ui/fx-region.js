/* 광역 지도 전용 그리기·배치. 모형·저장·전송 상태를 갖지 않는다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  // 작업 예산 = 겹침 판정 횟수(같은 입력이면 기기와 무관하게 같은 결과). 기존 12ms 마감 안의 판정은
  // 데스크톱 Chromium에서 약 41만~80만, Node에서 4.5만~60.7만이었다. 6도시 탐욕 배치는 600~4000회로 끝나고,
  // 연계선 0~1개 지도의 되돌아가기 성공은 340~1400px·카드 높이 50~96px 범위에서 최대 약 31.3만·46.7만 회였다.
  // 50만은 그 범위를 모두 살린다. 연계선 2개 이상인 좁은 지도에는 50만을 넘어 축소 재측정·도시 목록으로 가는 장면이 남는다.
  // 실패 한 번의 비용은 데스크톱 Chromium 약 7~13ms이고, 라벨이 많은 장면은 후보 생성·정렬까지 더해 Node 약 40ms였다.
  // 라벨이 없을 때의 후보 생성처럼 판정이 없는 일은 격자 크기로 유한하다.
  // 시계는 SAFETY_CHECK 판정마다만 읽는다. 50만/16384 ≈ 30회이므로 읽을 때마다 5ms씩 흐르는 시계도
  // 예산 안에서는 200ms 안전 상한에 닿지 않는다. 안전 상한은 이 데스크톱보다 약 13배 이상 느린 환경에서
  // 예산 상위권의 무거운 입력에만 걸린다.
  const PLACE_WORK_BUDGET = 500000, SAFETY_MS = 200, SAFETY_CHECK = 16384;
  // 색 출처: build.js PAL(육지·강·호수), paintStatic의 바다 그라디언트.
  // 도시 지도는 승인 범위 밖이므로 고치지 않고 광역용 대응표를 이곳에 모은다.
  const terrain = Object.freeze({ "~": "#2378a0", b: "#e6d39e", p: "#84c060", f: "#5b9c4b",
    h: "#a8bd6c", m: "#9b9a8f", u: "#aeb4b6", r: "#3f8fc4", l: "#3a7fb8", g: "#9cc27a", ".": "#84c060", out: "#6d7a72" });
  const overlap = (a, b, gap = 3) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  const layouts = new Map();
  function placeCards(cards, labels, bounds) {
    // 배율 1의 CSS px 입력. 확대는 호출부에서 결과에 곱하므로 탐색하지 않는다.
    // 부동소수점 확대/축소 오차만 없애며 크기·장애물·경계의 실제 변경은 키에 남긴다.
    const key = JSON.stringify([cards, labels, bounds], (_, v) => typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
    if (layouts.has(key)) return layouts.get(key);
    const now = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    const started = now(), exhausted = {};
    let work = 0;
    // 한도 신호로 중첩된 후보 생성·탐색도 즉시 중단하며, 실제 겹침 판정은 예산을 넘기지 않는다.
    const checkOverlap = (a, b, gap) => {
      if (work >= PLACE_WORK_BUDGET) throw exhausted;
      const hit = overlap(a, b, gap);
      work++;
      if (work % SAFETY_CHECK === 0 && now() - started > SAFETY_MS) throw exhausted;
      return hit;
    };
    const pad = 4, gap = 4;
    const hard = labels.filter(l => !l.soft), soft = labels.filter(l => l.soft);
    // 큰 카드 우선. 동률은 원래 도시 순서로 고정한다.
    const order = cards.map((c, i) => ({ ...c, order: i })).sort((a, b) => b.width * b.height - a.width * a.height || a.order - b.order);
    const byCost = (a, b) => a.cost - b.cost || a.rect.y - b.rect.y || a.rect.x - b.rect.x;
    function candidates(card, full) {
      const result = [], seen = new Set();
      const maxX = bounds.width - pad - card.width, maxY = bounds.height - pad - card.height;
      if (maxX < pad || maxY < pad) return result;
      const add = (x, y) => {
        x = Math.max(pad, Math.min(maxX, x)); y = Math.max(pad, Math.min(maxY, y));
        const key = `${Math.round(x * 100)},${Math.round(y * 100)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const rect = { id: card.id, x, y, width: card.width, height: card.height };
        if (hard.some(l => checkOverlap(rect, l, gap))) return;
        const edge = Math.min(x - pad, maxX - x, y - pad, maxY - y);
        const waterCost = soft.reduce((sum, l) => sum + (checkOverlap(rect, l, 0) ? card.width * card.height : 0), 0);
        result.push({ rect, edge, cost: (x + card.width / 2 - card.x) ** 2 + (y + card.height / 2 - card.y) ** 2 + waterCost });
      };
      // 중심 근처 여덟 방향 → 주변 띠 → 지도 전체 격자 및 경계.
      for (let ring = 1; ring <= 3; ring++) for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]]) {
        add(card.x - card.width / 2 + dx * (card.width / 2 + 14) * ring,
          card.y - card.height / 2 + dy * (card.height / 2 + 18) * ring);
      }
      for (const label of hard) if (card.x >= label.x && card.x <= label.x + label.width && card.y >= label.y && card.y <= label.y + label.height) {
        add(card.x - card.width / 2, label.y + label.height + gap);
        add(card.x - card.width / 2, label.y - card.height - gap);
        add(label.x - card.width - gap, card.y - card.height / 2);
        add(label.x + label.width + gap, card.y - card.height / 2);
      }
      if (!full) return result.sort(byCost);
      const step = Math.max(10, Math.min(card.width, card.height) / 3, Math.min(bounds.width, bounds.height) / 20);
      for (let y = pad; y <= maxY; y += step) {
        for (let x = pad; x <= maxX; x += step) add(x, y);
        add(maxX, y);
      }
      for (let x = pad; x <= maxX; x += step) add(x, maxY);
      add(maxX, maxY);
      // 라벨 옆의 빈 띠는 격자보다 좁을 수 있어 실제 변도 후보로 쓴다.
      const xs = [pad, maxX], ys = [pad, maxY];
      for (const box of hard) {
        xs.push(box.x - card.width - gap, box.x + box.width + gap);
        ys.push(box.y - card.height - gap, box.y + box.height + gap);
      }
      for (const x of xs) {
        for (const y of ys) add(x, y);
      }
      result.sort(byCost);
      return result;
    }
    function solve() {
      // 가까운 방향·도시 이름표 가장자리로 먼저 배치한다. 넓은 지도도 전체 격자 없이 끝난다.
      let placed = [];
      for (const card of order) {
        const found = candidates(card, false).find(c => !placed.some(p => checkOverlap(c.rect, p, gap)));
        if (!found) { placed = null; break; }
        placed.push(found.rect);
      }
      // 막힌 경우 도시별 전체 후보를 한 번만 생성·정렬. 재귀에서는 교차만 검사한다.
      const lists = [];
      if (!placed) for (const card of order) lists.push(candidates(card, true));
      let attempts = 0;
      function search(i, placed) {
        if (i === order.length) return placed;
        if (++attempts > 800) return null;
        for (const { rect } of lists[i]) {
          if (placed.some(p => checkOverlap(rect, p, gap))) continue;
          const found = search(i + 1, [...placed, rect]);
          if (found) return found;
          if (attempts > 800) break;
        }
        return null;
      }
      if (!placed) placed = lists.length === order.length && search(0, []);
      if (!placed) {
        lists.forEach(list => list.sort((a, b) => a.edge - b.edge || a.cost - b.cost));
        attempts = 0; placed = search(0, []);
      }
      return placed;
    }
    let placed = null;
    try {
      // 완전한 배치는 추가 한도 확인 없이 반환하고, 중단된 부분 배치는 공유하지 않는다.
      placed = solve();
    } catch (error) {
      if (error !== exhausted) throw error;
    }
    // 물리적으로 들어가지 않는 영역에서는 기존 도시 목록을 대안으로 둔다.
    const result = Object.freeze(placed ? cards.map(c => Object.freeze(placed.find(p => p.id === c.id))) : []);
    if (layouts.size >= 24) layouts.delete(layouts.keys().next().value);
    // 안전 상한으로 중단된 실패도 캐시해 느린 기기에서 갱신마다 200ms를 반복 소비하지 않는다.
    layouts.set(key, result);
    return result;
  }
  function newBuildCount(team, round, phase) {
    if (!team?.plan?.builds?.length) return 0;
    if (["lobby", "plan", "run"].includes(phase)) {
      const base = new Set((team.base || []).map(b => b.k));
      return team.plan.builds.filter(b => !base.has(`b:${b.t}:${b.i}`)).length;
    }
    // 운영 뒤에는 base가 갱신되므로 공개 건설 기록에서 확인되는 증가만 그린다.
    const previous = (team.hist || []).filter(h => h.r < round).at(-1);
    const current = (team.hist || []).filter(h => h.r === round).at(-1);
    return current && (previous || round === 1) ? Math.max(0, current.n - (previous?.n || 0)) : 0;
  }
  const legend = "번개 = 지난달 정전(0.05% 이상, 소수 1자리 표시가 0이 아닐 때) · ＋ = 이번 달 계획에 새 설비(계획 단계) / 지난달 설비 수 늘어남(결과 단계)";
  let last = null;
  function recordLayout(canvas, layout) {
    last = { canvas, ...Object.fromEntries(["cards", "names", "icons"].map(k => [k,
      (layout[k] || (last?.canvas === canvas ? last[k] : [])).map(b => ({ ...b }))])) };
  }
  function lastLayout() {
    if (!last) return null;
    // viewport CSS px. 스크롤·지도 이동 뒤에도 현재 캔버스 원점을 반영한다.
    const rect = last.canvas.getBoundingClientRect(), scale = rect.width / last.canvas.clientWidth;
    return Object.freeze(Object.fromEntries(["cards", "names", "icons"].map(k => [k, Object.freeze(last[k].map(b => Object.freeze({ ...b,
      x: rect.left + b.x * scale, y: rect.top + b.y * scale, width: b.width * scale, height: b.height * scale
    })))])));
  }
  KCP.fxRegion = { terrain, placeCards, newBuildCount, legend, recordLayout, lastLayout };
})();
