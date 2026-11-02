/* 끝 화면: 공개된 월별 값만 그린다. CO₂ 수신 사본은 이 탭에만 저장한다(D-65). */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const ICON = { heat: ["☀", "폭염"], cold: ["✧", "한파"], snow: ["❄", "눈"],
    storm: ["🌀", "태풍"], cloud: ["☁", "구름"], rain: ["☂", "집중호우"], haze: ["≋", "안개·먼지"] };
  const METRICS = [["appr", "지지", "%"], ["pop", "주민 · 시작 대비 변화", "%p"], ["uns", "정전", "%"], ["co2", "CO₂ 생산", " t/일"], ["grid", "계통이 메운 전기", " MWh/일"]];
  const mounted = new WeakSet();
  const played = new Set();
  const co2Key = (room, id) => "kcp-fx-end-co2-v1:" + JSON.stringify([room, id]);
  function co2Saved(room, id) {
    if (!room) return {};
    try {
      const data = JSON.parse(window.sessionStorage.getItem(co2Key(room, id)));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function remember(V, result) {
    if (!V?.room || !Number.isInteger(result?.round) || result.round < 1 || !(result.days > 0) || !Number.isFinite(result.days)) return;
    // 월말에 이미 공개된 각 도시의 CO₂·대표 운영일만 보관한다. 리그 상태·전송값은 바꾸지 않는다.
    Object.entries(result.team || {}).forEach(([id, value]) => {
      const grid = KCP.league?.uiMath?.gridFillMWh?.(value);
      if (!Number.isFinite(value?.co2Prod) && grid == null) return;
      const data = co2Saved(V.room, id);
      // grid: 결과 서랍과 같은 정의의 '계통이 메운 전기'(대표 기간 MWh). 공개 결과에서 역산한 값만 둔다.
      data[result.round] = { co2Prod: Number.isFinite(value?.co2Prod) ? value.co2Prod : null, days: result.days, ...(grid == null ? {} : { grid }) };
      try { window.sessionStorage.setItem(co2Key(V.room, id), JSON.stringify(data)); } catch (_) { /* 빈 달 안내로 대체 */ }
    });
  }
  function html(V, team, opts = {}) {
    const math = KCP.league?.uiMath, C = KCP.leagueCore, esc = KCP.esc;
    if (!V?.econ || !math || !C || (!team && !opts.allCities)) return "";
    const rounds = C.roundsOf(V), results = V.results || [], cities = V.econ.cities || {};
    const ids = (V.active?.length ? V.active : Object.keys(V.teams || {})).filter(id => cities[id]);
    const end = Math.max(0, ...results.map(r => r.round), ...ids.flatMap(id => math.monthPoints(V, id).map(p => p.t)));
    if (!end) return "";
    const months = Array.from({ length: end }, (_, i) => i + 1);
    const month = t => rounds[t - 1]?.month ? `${rounds[t - 1].year}년 ${rounds[t - 1].month}월` : `${t}라운드`;
    const fmt = math.fmt, valid = Number.isFinite;
    const value = (v, unit) => !valid(v) ? "자료 없음" : unit === "%p" ? `${v > 0 ? "+" : ""}${fmt(v, 1)}%` : `${fmt(v, unit === "명" ? 0 : 1)}${unit}`;
    const tickValue = (v, precision = 0) => v >= 1e6 ? `${fmt(v / 1e6, 1)}백만` : v >= 1000 ? `${fmt(v / 1000, 1)}천` : fmt(v, precision);
    const byRound = new Map(results.map(r => [r.round, r]));
    const points = Object.fromEntries(ids.map(id => [id, new Map(math.monthPoints(V, id).map(p => [p.t, p]))]));
    const saved = Object.fromEntries(ids.map(id => [id, co2Saved(V.room, id)]));
    const read = (id, t, key) => {
      if (key === "appr") return points[id]?.get(t)?.appr;
      if (key === "pop") {
        const pop = points[id]?.get(t)?.pop, start = cities[id]?.pop0;
        // 시작 인구 대비 변화율(%). 절대 인구로 읽히지 않게 0을 기준선으로 그린다(UX 갈래 요청).
        return valid(pop) && valid(start) && start > 0 ? (pop / start - 1) * 100 : undefined;
      }
      const res = byRound.get(t), r = res?.team?.[id];
      if (key === "uns") return r?.unsPct;
      if (key === "grid") {
        // 결과 서랍의 '계통이 메운 전기'와 같은 값(월 환산 MWh)을 그 달 일수로 나눈다. 새 전송값은 없다(D-65).
        // 진행자·혼자 하기는 전체 결과로, 팀은 최근 두 달 밖의 달을 이 기기의 기록으로 채운다. 없으면 비운다.
        const direct = math.gridFillMWh?.(r);
        if (direct != null) { const period = math.resultPeriod(V, res); return direct * period.mul / period.days; }
        const own = id === team ? opts.savedGrid?.[t]?.grid : undefined;
        if (valid(own)) return own / math.resultPeriod(V, { round: t, days: res?.days }).days;
        const cached = saved[id]?.[t];
        if (!valid(cached?.grid) || !valid(cached.days) || !(cached.days > 0)) return undefined;
        const period = math.resultPeriod(V, { round: t, days: cached.days });
        return cached.grid * period.mul / period.days;
      }
      // D-82: 달마다 일수가 달라 월 합계는 2월에 저절로 줄어든다. 하루 평균(월 환산 ÷ 그 달 일수)으로 그린다.
      // 공개 사본에 없는 달만 탭 사본으로 보충한다. 보충할 값도 없으면 추정하지 않는다.
      const perDay = (co2, period) => co2 * period.mul / period.days;
      if (valid(r?.co2Prod)) return perDay(r.co2Prod, math.resultPeriod(V, res));
      const cached = saved[id]?.[t];
      return valid(cached?.co2Prod) && valid(cached.days) && cached.days > 0 ?
        perDay(cached.co2Prod, math.resultPeriod(V, { round: t, days: cached.days })) : undefined;
    };
    const series = (id, name, color, dash = "") => ({ id, name, color, dash });
    const lines = opts.allCities ? ids.map((id, i) => series(id, cities[id].name || id, C.teamDef(C.regionOf(V.region), id)?.color || "var(--ui-text)", ["", "6 3", "2 3", "9 3 2 3", "12 4", "4 2 1 2"][i % 6])) :
      [series(team, "내 도시", "var(--ui-cyan)"), series("neighbors", "이웃 평균", "var(--ui-muted)", "5 4")];
    const average = (t, key) => {
      const values = ids.filter(id => id !== team).map(id => read(id, t, key)).filter(valid);
      return values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined;
    };
    const graphs = METRICS.map(([key, name, unit]) => {
      const data = lines.map(s => ({ ...s, values: months.map(t => s.id === "neighbors" ? average(t, key) : read(s.id, t, key)) }));
      const values = data.flatMap(s => s.values).filter(valid);
      const signed = unit === "%p";
      // 전부 0인 CO₂도 0·0.5·1의 서로 다른 눈금을 쓴다. 그래프 크기·진행자 배치는 유지한다.
      const hi = key === "co2" && values.length && values.every(v => v === 0) ? 1 :
        signed ? Math.max(1, ...values.map(Math.abs)) * 1.15 : unit === "%" ? Math.max(100, ...values) : Math.max(1, ...values) * 1.12;
      const lo = signed ? -hi : 0;
      const x = i => 40 + i / Math.max(1, end - 1) * 158, y = v => 106 - (v - lo) / (hi - lo) * 72;
      const last = s => { const i = s.values.findLastIndex(valid); return i < 0 ? "자료 없음" : `${month(i + 1)} ${value(s.values[i], unit)}`; };
      const description = opts.allCities ? `${name}, ${data.map(s => `${s.name}: ${month(1)} ${value(s.values[0], unit)} → ${month(end)} ${value(s.values.at(-1), unit)}`).join("; ")}` :
        `${name}, ${month(1)} ${value(data[0].values[0], unit)} → ${month(end)} ${value(data[0].values.at(-1), unit)}, 이웃 평균 ${value(data[1].values.at(-1), unit)}`;
      const paths = data.map(s => {
        let pen = false;
        const d = s.values.map((v, i) => {
          if (!valid(v)) { pen = false; return ""; }
          const cmd = `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; return cmd;
        }).filter(Boolean).join(" ");
        // 점과 선을 감싼 g는 수평선이어도 높이가 있다. 선 자체에는 clip-path를 걸지 않는다.
        return `${s.dash ? '<g class="lg-fx-reveal">' : ""}<path class="lg-fx-line" data-fx-series="${esc(s.id)}" d="${d}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ' pathLength="1"'} style="--fx-line:${esc(s.color)}"/>${s.values.map((v, i) => valid(v) ? `<circle cx="${x(i)}" cy="${y(v)}" r="2" style="--fx-line:${esc(s.color)}"><title>${esc(s.name)} ${esc(month(i + 1))} ${esc(value(v, unit))}</title></circle>` : "").join("")}${s.dash ? "</g>" : ""}`;
      }).join("");
      const ticks = [...new Set([0, Math.floor((end - 1) / 2), end - 1])];
      // CO₂는 도시 하나라도 빈 달이면 알린다(기존 계약). 계통은 화면에 그린 선이 실제로 끊긴 달만 알린다.
      const missing = key === "co2" && ids.some(id => months.some(t => !valid(read(id, t, key)))) ? '<p class="lg-fx-note">공개 상태에는 최근 두 달의 CO₂만 있어 빈 달이 있어요</p>' :
        key === "grid" && data.some(s => s.values.some(v => !valid(v))) ? '<p class="lg-fx-note" data-fx-gap="grid">이 기기에 저장된 기록이 없는 달은 비워 두었어요</p>' : "";
      return `<article class="lg-fx-chart" data-fx-metric="${key}"><h4>${name} <small>${esc(KCP.gradeWords("M·G"))}</small></h4><svg viewBox="0 0 224 144" role="img" aria-label="${esc(description + "; 값이 없는 달은 선을 끊어요")}"><text x="4" y="13">${esc(key === "uns" ? "% · 그 달 수요 대비" : signed ? "% · 시작 인구 대비" : unit.trim())}</text>${(signed ? [lo, 0, hi] : [0, hi / 2, hi]).map(v => `<path class="${signed && v === 0 ? "lg-fx-zero" : "lg-fx-gridline"}" d="M40,${y(v)} H198"/><text x="36" y="${y(v) + 3}" text-anchor="end">${esc(signed ? (v > 0 ? "+" : "") + fmt(v, 1) : tickValue(v, hi < 10 ? 1 : 0))}</text>`).join("")}<path class="lg-fx-axis" d="M40,34 V106 H198"/>${paths}${ticks.map(i => `<text x="${x(i)}" y="123" text-anchor="middle">${esc(rounds[i]?.month ? rounds[i].month + "월" : i + 1)}</text>`).join("")}<text x="119" y="139" text-anchor="middle">${esc(rounds[0]?.year === rounds[end - 1]?.year ? rounds[0]?.year + "년 · 월" : `${rounds[0]?.year || 1}–${rounds[end - 1]?.year || end}년 · 월`)}</text></svg><div class="lg-fx-values">${data.map(s => `<p style="--fx-line:${esc(s.color)}" data-dashed="${!!s.dash}"><b>${esc(s.name)}</b> ${esc(last(s))}</p>`).join("")}</div>${missing}</article>`;
    }).join("");
    const strip = months.map(t => {
      const res = byRound.get(t), eventIds = [...new Set([...(V.events || []).filter(e => e.round === t).map(e => e.id), ...(res?.events || [])])];
      const events = eventIds.map(id => ICON[KCP.fxTurn?.eventMood?.[id]] || ["•", "일반 사건"]);
      const outage = (opts.allCities ? ids : [team]).some(id => res?.team?.[id]?.outH > 0 || res?.team?.[id]?.unsPct > 0);
      const known = (opts.allCities ? ids : [team]).every(id => valid(res?.team?.[id]?.outH) || valid(res?.team?.[id]?.unsPct));
      const label = `${month(t)} · ${events.map(e => e[1]).join("·") || "사건 없음"} · ${outage ? "정전 있음" : known ? "정전 없음" : "정전 자료 없음"}`;
      return `<li data-fx-month="${t}"><span aria-hidden="true">${esc(month(t))}</span><span class="lg-fx-icons" aria-hidden="true">${events.map(e => esc(e[0])).join(" ") || "–"}${outage ? '<i class="lg-fx-outage">●</i>' : ""}</span><span class="lg-sr">${esc(label)}</span></li>`;
    }).join("");
    // 진행자는 기존 DOM 보존 훅이 재연출을 막는다. 팀 서랍만 세션 키로 중복을 막는다.
    const endKey = opts.allCities ? "" : JSON.stringify([V.room, team, end]);
    return `<section class="lg-fx-end" data-fx-end-key="${esc(endKey)}" aria-label="달별 도시 궤적"><h3>달별 도시 궤적</h3><div class="lg-fx-strip" role="region" aria-label="연대기 띠 · 좌우 스크롤" tabindex="0"><ol>${strip}</ol></div><p class="lg-fx-key">${opts.allCities ? "도시별 색·선무늬" : "청록 실선: 내 도시 · 회색 점선: 이웃 평균"} · ●: 정전 표시</p><div class="lg-fx-charts" role="region" aria-label="지표 그래프 ${METRICS.length}개 · 좁은 화면에서는 좌우로 넘겨요" tabindex="0">${graphs}</div>${KCP.league.tipBox("end-trajectory-note", "궤적 자료와 읽는 법", `<p class="lg-fx-note">출처: 공개된 달별 경제 이력·운영 결과(${esc(KCP.gradeWords("M·G"))}). CO₂는 생산(우리 도시 설비 배출) 기준이고, 달마다 일수가 달라 그달 합계를 일수로 나눈 하루 평균이에요. 계통이 메운 전기는 결과 서랍에 나오는 같은 이름의 하루 평균(MWh/일) 값과 같아요. 주민은 각 도시 시작 인구 대비 변화(%)이고 가운데 실선이 0(변화 없음)이에요. 이웃 평균은 같은 달 활성 이웃 중 값이 있는 도시의 산술 평균이며 주민은 도시별 시작 대비 %를 평균해요. 값이 없는 달은 선을 끊어요.</p>`)}</section>`;
  }
  function mount(root) {
    if (!root) return;
    const reduced = KCP.v2?.reduced?.() ?? !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const blocks = [...root.querySelectorAll(".lg-fx-end")].filter(el => {
      if (mounted.has(el)) return false;
      mounted.add(el);
      const key = el.dataset?.fxEndKey;
      return !(key && played.has(key));
    });
    // '이미 연출함'은 등장이 화면에서 끝난 뒤에 적는다. 같은 틱에 서랍이 두 번 그려지면(혼자 하기)
    // 첫 요소는 바로 버려지므로, 그때 적어 버리면 화면에 남는 두 번째 요소가 등장 없이 나온다.
    // 끝난 뒤에는 진행자 상태가 4초마다 와서 서랍을 다시 그려도 반복하지 않는다.
    const settle = el => { const key = el.dataset?.fxEndKey; if (key && el.isConnected) played.add(key); };
    if (reduced) { blocks.forEach(settle); return; }
    if (!blocks.length) return;
    window.setTimeout(() => blocks.forEach(settle), 900);
    const bars = [...root.querySelectorAll("#lg-rank .lg-scoreparts meter")];
    blocks.forEach(el => el.classList.add("lg-fx-enter"));
    bars.forEach(el => el.classList.add("lg-fx-rank-enter"));
    // 시작 폭을 확정한 뒤 기존 meter를 최종 폭으로 펼친다. 값·DOM 구조는 바꾸지 않는다.
    void root.offsetWidth;
    window.requestAnimationFrame(() => {
      blocks.forEach(el => el.classList.remove("lg-fx-enter"));
      bars.forEach(el => el.classList.remove("lg-fx-rank-enter"));
    });
  }
  KCP.fxEnd = { html, mount, remember };
})();
