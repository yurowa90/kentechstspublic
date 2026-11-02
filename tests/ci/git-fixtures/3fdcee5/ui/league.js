/* 멀티플레이 리그 화면: #league(로비) · #league/host(진행자 판) · #league/team(팀 = 도시 건설 화면 + 리그 띠)
 * 진행자 기기가 규칙(league-core)으로 상태를 정하고 4초마다·바뀔 때마다 모두에게 알린다. 팀 기기는 자기 도시만 짓고
 * 계획·판매 단가·연계선 요청을 보낸다. 학생 이름은 받지 않는다(팀 = 도시).
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || typeof KCP.route !== "function" || !KCP.leagueCore || !KCP.leagueNet || !KCP.buildGame || !KCP.ECON_DATA) return;
  const C = KCP.leagueCore, NET = KCP.leagueNet, BG = KCP.buildGame, esc = KCP.esc, gradeWords = KCP.gradeWords;
  // D-74: 바깥 계통은 제한된 몫만 메운다. 상한·할증은 자료 파일 값으로 문장을 만든다.
  const SUPPLY_ASSUMPTION = () => `바깥 계통은 매시간 수요의 ${fmt(params("gridImportShare") * 100)}%까지만 메워 줘요(기준 원가의 ${fmt(params("gridImportMarkup"), 1)}배). 나머지는 내 도시 발전과 이웃 연계선으로 대야 해요(게임 가정).`;
  const POWER_CHIP_DEF = BG.powerChipDefinition;
  const REGION = "south";
  // K_TEAM: 이 기기에서 마지막으로 쓴 팀(이어서 하기). K_TAB(sessionStorage): 이 탭의 팀·서명 키·순번 — 한 PC에서 탭 여러 개로 시연해도 섞이지 않게.
  // 팀 자료(건설·일지)는 방·팀마다 따로: K_DATA + ":" + 방 + ":" + 팀
  const K_NET = "kcp-league-net-v1", K_HOST = "kcp-league-host-v1", K_TEAM = "kcp-league-team-v1", K_TAB = "kcp-league-tab-v1", K_DATA = "kcp-league-data-v1";
  const PUBLIC_KEY_NOTICE = "비밀 키(service_role)는 쓰면 안 돼요. 대시보드의 publishable 또는 anon 키를 넣어요.";
  const JOIN_KEY_NOTICE = "이 참가 링크의 키는 쓸 수 없어요. 선생님께 새 링크를 받아요.";
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const SEASON_NAME = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };
  const PHASE_NAME = { lobby: "준비", plan: "계획·협상", run: "운영 중", review: "결과·일지", end: "끝" };
  const JQ = [
    { k: "why", q: "우리 도시는 무엇을, 왜 지었나요?" },
    { k: "nb", q: "우리 선택이 이웃 도시에 준 영향은?" },
    { k: "next", q: "다음 라운드에 바꿀 것 하나와 이유" }
  ];
  const store = {
    get(k) { try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v, replacer) { try { window.localStorage.setItem(k, JSON.stringify(v, replacer)); return true; } catch (e) { return false; } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };
  // 설명 HTML은 호출부의 정적 틀만 받는다. 값·이름·키는 esc로 이스케이프한다.
  function infoTip(key, html, opts = {}) {
    return `<details class="lg-info" data-fold="${esc(key)}"><summary class="lg-info-btn" data-info-key="${esc(key)}" aria-label="설명 보기: ${esc(opts.label || key)}">!</summary><div class="lg-info-pop" role="note">${html}</div></details>`;
  }
  function tipBox(key, title, html) {
    return `<details class="lg-tipbox lg-out-fold" data-fold="${esc(key)}"><summary data-fold-summary="${esc(key)}"><span class="lg-tip-b" aria-hidden="true">TIP</span><span>${esc(title)}</span></summary><div class="lg-tipbody">${html}</div></details>`;
  }
  function closeFocusedInfo(e) {
    if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return false;
    const info = document.activeElement?.closest("details.lg-info[open]");
    if (!info) return false;
    info.open = false; delete info.dataset.pinned;
    info.querySelector("summary").focus({ preventScroll: true });
    e.preventDefault(); e.stopPropagation();
    return true;
  }
  function bindInfoTips(root) {
    root.querySelectorAll("details.lg-info").forEach(info => {
      if (info.dataset.bound) return;
      info.dataset.bound = "true";
      info.querySelector("summary").addEventListener("click", e => {
        e.preventDefault();
        // 호버로 이미 열렸을 때의 첫 클릭도 고정한다. 다음 클릭은 닫기다.
        const pinned = info.dataset.pinned === "true";
        info.open = !pinned;
        if (pinned) delete info.dataset.pinned; else info.dataset.pinned = "true";
      });
      info.addEventListener("pointerenter", () => {
        if (typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches) info.open = true;
      });
      // 펼치며 단추가 다음 줄로 이동해도 호버가 즉시 풀리지 않도록 관련 행을 이탈 경계로 삼는다.
      const hoverArea = info.closest(".lg-info-line, .lg-data-chip, [data-grid-fill]") || info;
      hoverArea.addEventListener("pointerleave", () => {
        if (typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches && !info.dataset.pinned) info.open = false;
      });
      info.addEventListener("toggle", () => {
        if (!info.open) { delete info.dataset.pinned; return; }
        // 머리 띠 칩의 설명은 화면 기준으로 띄우므로 단추 바로 아래에 놓는다.
        if (info.closest(".lg-data-chip")) {
          const r = info.querySelector("summary").getBoundingClientRect();
          info.querySelector(".lg-info-pop")?.style.setProperty("--lg-chip-pop-top", `${Math.round(r.bottom + 6)}px`);
        }
      });
      info.addEventListener("keydown", closeFocusedInfo);
    });
  }
  const K_DATA_NOTICE = "kcp-league-data-notice-v1";
  const DATA_NOTICE_TITLE = "가상 데이터 포함 안내";
  const DATA_NOTICE_BODY = "도시 이름은 실제 지명이에요. 실제 공개 자료에서 가져온 숫자는 출처·기준연도·단위를 함께 표시하고, 출처 표시가 없는 숫자는 게임을 위해 정한 가정이에요. 그래서 게임 결과는 그 도시의 실제 상태나 앞으로의 예측이 아니에요.";
  const DATA_NOTICE_CHIP = "공개 자료(출처·기준연도·단위 표시) 외 숫자는 게임 가정이라 결과는 실제 상태·예측이 아니에요.";
  let dataNoticeSeen = store.get(K_DATA_NOTICE) === true;
  const dataNoticeConfirmed = () => dataNoticeSeen || store.get(K_DATA_NOTICE) === true;
  // D-86: 시작 전 안내는 확정 단추 바로 위에 펼쳐 보이되 단추를 막지 않는다. '안내 확인'은 이 기기에서 다음 판부터 접어 두는 표시다.
  function dataNoticeHTML(key) {
    const seen = dataNoticeConfirmed();
    return tipBox(`data-notice-${key}`, DATA_NOTICE_TITLE, `<p>${DATA_NOTICE_BODY}</p><button type="button" class="v2-btn" data-notice-confirm ${seen ? "disabled" : ""}>안내 확인</button>`)
      .replace('<details ', `<details data-data-notice${seen ? "" : " open"} `);
  }
  function bindDataNotices(root, update) {
    root.querySelectorAll("[data-notice-confirm]").forEach(button => button.addEventListener("click", () => {
      dataNoticeSeen = true; store.set(K_DATA_NOTICE, true);
      root.querySelectorAll("[data-data-notice]").forEach(box => {
        box.open = false; box.querySelector("[data-notice-confirm]").disabled = true;
      });
      update();
      // 접힌 본문 안에 키보드 초점이 남지 않도록 요약으로 돌린다.
      button.closest("details").querySelector("summary").focus({ preventScroll: true });
    }));
  }
  function dataChipHTML() {
    return `<div class="lg-data-chip"><span>가상 데이터</span>${infoTip("data-notice-chip", DATA_NOTICE_CHIP, { label: "가상 데이터" })}</div>`;
  }
  const tab = {
    get() { try { return JSON.parse(window.sessionStorage.getItem(K_TAB)); } catch (e) { return null; } },
    set(v) { try { window.sessionStorage.setItem(K_TAB, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const dataKey = () => `${K_DATA}:${L.room}:${L.team}`;
  // 팀 기기 자료(하루 전 약속·확신·일지·S7 사본, D-65로 기기 안에만 있음)와 접속 정보의 저장 실패를 종류마다 기억하고,
  // 혼자 하기와 같은 경고 토스트로 알린다. 실패한 종류가 모두 다시 저장되면 해제해, 다음 실패 때 다시 알린다.
  // 방이 바뀌어도 남지 않게 키 전체가 아니라 종류(팀 자료·S7 사본·탭·이어서 하기)로 센다.
  const teamSaveFailed = new Set();
  let teamSaveWarned = false;
  function warnTeamSave() {
    if (L?.role !== "team" || !teamSaveFailed.size || teamSaveWarned || !document.getElementById("lg-bar")) return;
    teamSaveWarned = true;
    BG.toast("진행을 저장하지 못했어요. 브라우저 저장 공간·설정을 확인해요.", { warn: true });
  }
  function teamWrote(kind, ok) {
    // 성공하던 종류가 새로 실패하면, 다른 종류가 실패로 남아 있어도 다시 알린다.
    if (!ok && !teamSaveFailed.has(kind)) teamSaveWarned = false;
    if (ok) teamSaveFailed.delete(kind); else teamSaveFailed.add(kind);
    if (!teamSaveFailed.size) teamSaveWarned = false;
    // mountCity 안의 teamSave는 곧 지워질 옛 화면에 토스트를 띄우므로, 같은 동작이 끝난 뒤(새 화면) 알린다.
    // Promise 마이크로태스크: Node vm 검사 샌드박스에는 queueMicrotask가 없다.
    Promise.resolve().then(warnTeamSave);
    return ok;
  }
  const teamSet = (k, v) => teamWrote(k.split(":")[0], store.set(k, v));
  // 저장값이 숫자·문자열·배열로 깨져 있으면 속성을 붙일 수 없어 상태 수신이 멈춘다 — 일반 객체가 아니면 빈 자료로 시작한다.
  const tdata = () => { const raw = L?.role === "solo" ? L.interview : store.get(dataKey()); const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; d.docs = d.docs && typeof d.docs === "object" ? d.docs : {}; d.journal = d.journal && typeof d.journal === "object" ? d.journal : {}; return d; };
  // S7 월간 사본(계획 때 국제 지수·운영 조건)은 팀 자료와 다른 키에 둔다. 같은 키에 두면 이 기기가 새 방의
  // 같은 팀으로 승인된 적이 있을 때 사본만으로 '이미 자료 있음'이 되어 옛 방 → 새 방 이전(일지·답변 복사)이
  // 건너뛰어진다(sec.js F3-9: 앞 단계의 승인된 세션이 같은 방:팀 키에 사본을 남긴 경우).
  const K_S7 = "kcp-league-s7-v1", S7_FIELDS = ["outageSnapshots", "outageOperatingIntl"];
  const s7Key = () => `${K_S7}:${L.room}:${L.team}`;
  function s7data() {
    if (L?.role === "solo") return tdata();
    const saved = store.get(s7Key()), d = store.get(dataKey());
    const stale = d && S7_FIELDS.some(k => Object.hasOwn(d, k));
    if (saved && typeof saved === "object") {
      // 분리 키가 이미 있으면 팀 자료 키의 옛 사본은 버린다(2달 보관 정리 밖에 남지 않게).
      if (stale) { S7_FIELDS.forEach(k => delete d[k]); teamSet(dataKey(), d); }
      return saved;
    }
    // 분리 전 판(팀 자료 키에 사본이 있던 기기)은 한 번 옮긴다.
    const moved = {};
    if (stale) {
      S7_FIELDS.forEach(k => { if (Object.hasOwn(d, k)) { moved[k] = d[k]; delete d[k]; } });
      if (teamSet(s7Key(), moved)) teamSet(dataKey(), d);
    }
    return moved;
  }
  function putS7(d) {
    if (L.role === "solo") { putData(d); return; }
    teamSet(s7Key(), Object.fromEntries(S7_FIELDS.filter(k => d[k] !== undefined).map(k => [k, d[k]])));
  }
  // 이전 판정용: S7 사본·안내 표시(guideSeen)·빈 묶음만 있으면 학생이 쓴 자료가 없는 것으로 본다.
  // 그 밖의 값(자동 기록 interview.causes 등 포함)은 보수적으로 '자료 있음'으로 보아 덮어쓰지 않는다.
  const TEAM_META = ["guideSeen", "rev"];
  const hasTeamContent = d => !!d && typeof d === "object" && Object.entries(d).some(([k, v]) =>
    !S7_FIELDS.includes(k) && !TEAM_META.includes(k) && v != null && v !== false && !(typeof v === "object" && !Object.keys(v).length));
  const R = () => C.regionOf(REGION);
  // 이 방에 참가한 도시(2~6곳). 상태 S나 공개 상태 V 둘 다 받는다.
  const actT = X => { const ids = X && Array.isArray(X.active) && X.active.length ? X.active : X && X.teams ? Object.keys(X.teams) : R().teams.map(t => t.id); return R().teams.filter(t => ids.includes(t.id)); };
  const teamName = id => (C.teamDef(R(), id) || { name: id }).name;
  const teamCol = id => (C.teamDef(R(), id) || { color: "#888" }).color;
  const fmt = (x, d = 0) => (typeof x === "number" && isFinite(x) ? x.toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–");
  // 하루 평균의 작은 양을 0으로 읽지 않게 한다. 부호 있는 Δ와 상세 계산은 각자 정밀도를 유지한다.
  const perDayText = x => Number.isFinite(x) && x >= 0 && x < GRID_DISPLAY_MIN_PER_DAY ? "0.1 MWh/일 미만" : `${fmt(x, 1)} MWh/일`;
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  let codeTime = 0;
  function code(n) {
    if (window.crypto?.getRandomValues) {
      const values = window.crypto.getRandomValues(new Uint32Array(n));
      return Array.from(values, v => ALPHA[v % ALPHA.length]).join("");
    }
    // 방 코드만 새로 만든다. 판 안의 사건·컴퓨터 난수는 저장된 코드를 씨앗으로 쓴다.
    codeTime = Math.max(Date.now(), codeTime + 1);
    let value = codeTime;
    return Array.from({ length: n }, () => { const ch = ALPHA[value % ALPHA.length]; value = Math.floor(value / ALPHA.length); return ch; }).join("");
  }
  const normalizeRoom = r => String(r || "").replace(/[-\s]/g, "").toUpperCase();
  const newRoom = r => /^[A-HJ-NP-Z2-9]{8}$/.test(r);
  const validRoom = r => typeof r === "string" && (newRoom(r) || /^[A-Z2-9]{4,6}$/.test(r));
  const displayRoom = r => newRoom(r) ? r.slice(0, 4) + "-" + r.slice(4) : r;
  const netCfg = () => store.get(K_NET) || { kind: "local", url: "", key: "" };
  const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

  let lobbyStop = null;
  let L = null; // { role, room, net, conn, S?(진행자 상태), snap?(받은 공개 상태), team?, identity?, token?(혼자 하기), timers[] }
  function close() {
    if (!L) return;
    saveSolo();
    teamSaveFailed.clear(); teamSaveWarned = false;
    flushHost();
    L.resultReplayWait?.();
    L.regionObserver?.disconnect(); L.hudObserver?.disconnect(); L.barObserver?.disconnect(); L.guidanceObserver?.disconnect();
    clearInterval(L.guidanceTimer); L.guidanceTimer = null;
    L.timers.forEach(t => clearInterval(t));
    clearTimeout(L.planT); clearTimeout(L.pending); clearTimeout(L.hostSaveT);
    if (L.conn) L.conn.close();
    if (L.escapeHandler) document.removeEventListener("keydown", L.escapeHandler, true);
    L = null;
  }
  KCP.on("route:change", ({ name, arg }) => {
    lobbyStop?.(); lobbyStop = null;
    if (name !== "league") { close(); return; }
    if (L && L.role === "host" && arg !== "host" && !/^view\//.test(arg || "")) close();
    if (L && L.role === "host") L.viewing = /^view\//.test(arg || "") ? arg.slice(5) : null;
    if (L && L.role === "team" && !/^team/.test(arg)) close();
    if (L && L.role === "solo" && arg !== "solo") close();
  });

  const QUESTIONS = {
  "lg-c-site": "이번 달 가장 큰 설비를 그 자리에 지은 이유를 지도 숫자 하나로 말해 봐요.",
  "lg-c-balance": "지금까지 우리 도시는 균형과 집중 가운데 어느 쪽이었나요?",
  "lg-c-hidden": "화면에 숫자로 보이지 않는데 결과를 바꾼 것이 있었다면 무엇이라고 짐작하나요?",
  "lg-p-predict": "예측한 정전 변화와 실제 결과가 달랐어요. 무엇이 예측을 빗나가게 했을까요?",
  "lg-p-line": "처음 선언한 지킬 선({criterion} {line}점 이상) 아래로 내려갔어요. 선과 계획 가운데 무엇을 바꾸겠습니까?",
  "lg-i-overbuild": "남는 공급 능력이 수요보다 꽤 큽니다. 일부러 여유를 둔 것인가요?",
  "lg-i-smoke": "화력 설비 가까운 마을에 민원이 있어요. 그 주민에게 어떻게 설명하겠습니까?",
  "lg-i-timing": "연구나 큰 투자를 지금 시작한 것은 이른가요, 늦은가요?",
  "lg-i-lab": "연구소의 연구가 실제 도입까지 가기 전에 게임이 끝난다면, 그래도 지을 가치가 있나요?",
  "lg-i-gap": "주민이 {nb} 쪽으로 빠져나갔어요. 우리가 못한 것과 {nb}가 잘한 것 중 무엇이 더 컸을까요?",
  "lg-i-cause": "이번 달 뉴스 세 개 사이에서 가장 불확실한 원인과 결과의 연결은 무엇인가요?",
  "lg-i-offer": "기업 이전 조건 가운데 우리가 못 맞춘 하나를 맞추려면 무엇을 포기해야 하나요?",
  "lg-r-co2": "환경단체의 반문: 정전은 줄었지만 CO₂가 늘었어요. 이 계획을 고치거나 유지할 이유는 무엇인가요?",
  "lg-r-outage": "직장인의 반문: CO₂는 줄었지만 정전이 늘었어요. 이 계획을 고치거나 유지할 이유는 무엇인가요?",
  "lg-r-tax": "노년층의 반문: 세금을 올렸지만 생활 만족은 낮아졌어요. 이 정책을 고치거나 유지할 이유는 무엇인가요?",
  "lg-r-free": "청년층의 반문: 감세와 서비스 확대로 적자가 났어요. 이 정책을 고치거나 유지할 이유는 무엇인가요?",
  "lg-r-tie": "{nb}와의 연계선을 거절한 결정을 고치거나 유지할 이유는 무엇인가요?",
  "lg-r-tie-accept": "{nb}와의 연계선을 수락한 뒤 비용·배출 부담이 생겼어요. 이 결정을 고치거나 유지할 이유는 무엇인가요?",
  "lg-f-typhoon": "태풍으로 연계선 하나가 한 달 끊긴다면, 우리 계획에서 가장 먼저 무너질 곳은 어디인가요?",
  "lg-f-event": "예보와 실제 사건 크기를 본 뒤, 다음 달 전력 계획을 고치거나 유지할 이유는 무엇인가요?",
  "lg-f-lag": "정책 효과가 바로 나타난다면 이번 결정은 달라졌을까요?",
  "lg-d-headline": "다음 달 우리 도시 신문 1면 제목으로 나오길 바라는 결과는 무엇인가요?",
  "lg-e-weights": "우리 순위에 가장 크게 작용한 항목의 가중치를 어떻게 평가하나요?",
  "lg-h-approval": "주민 평가 결과가 나왔어요. 가장 낮은 집단을 다음 해에 어떻게 대하겠습니까?",
  "lg-h-criterion": "이 리그 점수표에 항목 하나를 더한다면 무엇을 넣겠습니까?"
};
  /* 경제 화면 계산. 표시용 추정은 엔진 결과와 구분한다. */
  // Realtime은 객체 키를 재정렬한다. 표시·동률 순서는 공개 상태가 아닌 명세·로컬 자료에서 읽는다.
  const SCORE_KEYS = ["pop", "ind", "fin", "co2", "appr", "rel"];
  const GROUP_KEYS = Object.keys(KCP.ECON_DATA.groups);
  const EXPORT_KEYS = Object.keys(KCP.ECON_DATA.intl.base.export);
  const OFFER_CHECK_KEYS = ["mw", "re", "rel", "workers"];
  const SCORE_NAMES = { pop: "주민", ind: "산업", fin: "재정", co2: "탄소", appr: "지지", rel: "전력 신뢰" };
  const PART_NAMES = { rel: "전력 신뢰", price: "전기요금", air: "공기(발전 PM2.5 증분·이웃 기여, 추정)", jobs: "일자리", svc: "공공서비스", tax: "세금", crowd: "집값·혼잡", A: "산업 여건", out: "산출", taxI: "산업 세금", ren: "재생", co2: "탄소", outage: "정전", hospital: "병원 정전", complaint: "민원", share: "이익공유", save: "절전", unrest: "시위", bounds: "만족도 상한·하한", other: "이전 만족도" };
  // G: 질문 빈도·문턱은 ECON-UI U4와 INTERVIEW §4의 화면 가정이다. 엔진 계수가 아니다.
  const IQ = KCP.ECON_DATA.params.interviewQuestionRules.v;
  const END_Q = ["우리 계획을 기준 먼저, 2분 동안 설명해 봐요.", "가장 어려웠던 결정에서 무엇을 포기했나요?", "예측과 결과가 가장 크게 어긋난 달은 언제였나요?", "받은 반문 하나에 대해 고치거나 유지하는 최종 이유는?", "이 리그 점수표에 항목 하나를 더한다면 무엇을 넣겠습니까?"];
  const params = k => KCP.ECON_DATA.params[k].v;
  // D-69: 측정 근거(P)가 있는 이웃 쌍만 이름으로 밝히고, 나머지 맞닿은 쌍의 기여는 게임 가정(G)임을 표시한다. 도시 이름은 자료에서 읽는다.
  function airNeighbours() {
    const act = new Set(actT(L.snap || {}).map(t => t.id));
    return (KCP.ECON_DATA.airNeighbours || []).filter(x => !act.size || (act.has(x.from) && act.has(x.to)));
  }
  function airNoteHTML() {
    // 이번 판 참가 도시 사이의 쌍만 쓴다. G 비율이 여럿이면 범위로 적는다.
    const list = airNeighbours();
    const measured = list.filter(x => x.grade !== "G").map(x => `${teamName(x.from)}→${teamName(x.to)}`);
    const g = list.filter(x => x.grade === "G").map(x => x.ratio).filter(Number.isFinite);
    const lo = Math.min(...g), hi = Math.max(...g), ratio = lo === hi ? fmt(lo, 1) : `${fmt(lo, 1)}~${fmt(hi, 1)}`;
    return [`발전 PM2.5 증분과 이웃 기여를 추정한 값(${gradeWords("M·G")})이에요.`,
      measured.length ? `측정 비율(${gradeWords("P")})이 있는 이웃 기여: ${esc(measured.join("·"))}.` : "",
      g.length ? `나머지 맞닿은 도시 사이 기여(${esc(ratio)}배)는 근거 없는 게임 가정이에요.` : ""].filter(Boolean).join(" ");
  }

  const signed = (x, d = 0) => { const rounded = Number(Number(x).toFixed(d)) + 0; return `${rounded > 0 ? "+" : ""}${fmt(rounded, d).replace("-", "−")}`; };
  const causeLabel = c => ["taxI", "air"].includes(c.key) ? PART_NAMES[c.key] : c.label || PART_NAMES[c.key] || c.key;
  const visibleCauses = rows => (rows || []).filter(c => Number(c.delta.toFixed(1)) !== 0);
  const turnText = (text, V = L?.snap) => V?.econ ? String(text).replaceAll("라운드", "달") : String(text);
  const journalQuestion = (q, V) => turnText(L.role === "solo" ? q.replaceAll("우리", "내") : q, V);
  const gradeClass = grade => /^(O|O\*)$/.test(grade) ? "tag-official" : grade === "P" ? "tag-paper" : grade === "M" ? "tag-model" : "tag-mine";
  const lowestGroup = groups => GROUP_KEYS.filter(k => Object.hasOwn(groups, k)).sort((a, b) => groups[a] - groups[b] || GROUP_KEYS.indexOf(a) - GROUP_KEYS.indexOf(b))[0];
  function reweightScore(score, weights) {
    const total = Object.values(weights).reduce((a, x) => a + Math.max(0, Number(x) || 0), 0);
    // 공식 점수(econ.js score)와 같은 식: ln(0) 방지용 하한 scorePartFloor(현재 1)을 쓰는 가중 기하평균 + 공동 보너스, 0~100.
    const floor = Math.min(100, Math.max(1, Number(KCP.ECON_DATA.params.scorePartFloor?.v) || 1));
    const geo = r => Math.exp(SCORE_KEYS.reduce((a, k) => a + Math.max(0, Number(weights[k]) || 0) * Math.log(Math.max(floor, r.parts[k] || 0)), 0) / total);
    const rows = (score?.rank || []).map((r, i) => ({ ...r, order: i, score: total ? Math.round(Math.min(100, Math.max(0, geo(r) + (Number(r.coop) || 0))) * 10) / 10 : r.score }));
    return rows.sort((a, b) => b.score - a.score || a.order - b.order).map((r, i) => ({ ...r, rank: i + 1 }));
  }
  function causeBreakdown(before, after, weights, actual) {
    const total = Object.values(weights).reduce((a, x) => a + x, 0) || 1;
    const all = Object.keys(weights).map(k => ({ key: k, value: ((after[k] || 0) - (before[k] || 0)) * weights[k] / total }));
    const residual = actual - all.reduce((a, x) => a + x.value, 0);
    if (Math.abs(residual) > Number.EPSILON) all.push({ key: "other", value: residual });
    return all.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }
  function chooseQuestion(x) {
    const tests = {
      "lg-c-site": x.large, "lg-c-balance": x.quarter && (x.spread >= IQ.gapWide || x.spread <= IQ.gapNarrow),
      "lg-c-hidden": x.quarter && Math.abs(x.dApproval) > IQ.approval && !x.policyQuarter,
      "lg-p-predict": x.miss, "lg-p-line": x.crossed,
      "lg-i-overbuild": x.spare >= x.peak * IQ.spare && x.peak > 0 && x.uns === 0,
      "lg-i-smoke": x.smoke, "lg-i-timing": x.firstResearch || x.left <= IQ.quarter && x.large,
      "lg-i-lab": x.labPending && x.left <= IQ.quarter + 1, "lg-i-gap": x.outflow,
      "lg-i-cause": x.news >= IQ.quarter, "lg-i-offer": x.offerFail === 1,
      "lg-r-co2": x.dUns < 0 && x.co2Growth >= IQ.co2Up, "lg-r-outage": x.dUns > 0 && x.co2Growth <= -IQ.co2Up,
      "lg-r-tax": x.tax >= 1 && x.dSenior < 0, "lg-r-free": x.tax <= -1 && x.service >= 1 && x.balance < 0,
      "lg-r-tie": x.rejected && x.neighborWorse, "lg-r-tie-accept": x.accepted && (x.balance < 0 || x.co2Growth > 0), "lg-f-typhoon": x.quarter && x.tradeShare >= IQ.large && x.ties > 0,
      "lg-f-event": x.event, "lg-f-lag": x.policyPrevious, "lg-d-headline": x.quarter,
      "lg-e-weights": x.quarter && Math.abs(x.dRank) >= IQ.rank,
      "lg-h-approval": x.evaluation, "lg-h-criterion": x.end
    };
    const candidates = Object.keys(tests).filter(k => tests[k] && k !== x.last && (!x.used || x.used.indexOf(k) === x.used.lastIndexOf(k)) && (!x.allowed || x.allowed.some(prefix => k.startsWith(prefix))));
    if (x.event && !x.allowed) return candidates.includes("lg-f-event") ? "lg-f-event" : null;
    const priority = x.crit?.includes("rel") ? ["lg-r-co2", "lg-r-outage"] : x.crit?.includes("co2") ? ["lg-r-outage", "lg-r-co2"] : [];
    return ["lg-f-event", ...priority, ...candidates.filter(k => k.startsWith("lg-r-")), "lg-p-line", "lg-p-predict", ...candidates].find(k => candidates.includes(k)) || null;
  }
  function putData(d) {
    if (L.role === "solo") soloMutate(() => { L.interview = d; });
    else teamSet(dataKey(), d);
  }
  function monthNote() {
    const d = tdata(), rd = L.snap?.round || 0;
    d.interview = d.interview || {}; d.interview.months = d.interview.months || {};
    d.interview.months[rd] ||= { operatingPlan: null, followingPlanChanged: null, resultNumbers: [] };
    return { d, n: d.interview.months[rd] };
  }
  function curtailEvents(V, round, id) {
    const reg = C.regionOf(V.region || REGION);
    return (V.events || []).filter(ev => ev.round === round && ev.id === "light_load_curtailment")
      .map(ev => ({ ev, E: C.eventDef(reg, ev.id) }))
      .filter(({ E }) => E && (!id || C.hits(reg, E, id)));
  }
  function curtailHTML(V, res, id, monthMWh, foldNote = false) {
    if (!V.econ) return "";
    if (!res?.team[id]) return `<section class="lg-curtail"><h4>버린 재생 전기</h4><p class="lg-hint">첫 운영 뒤에 표시돼요.</p></section>`;
    const r = res.team[id], rd = C.roundsOf(V)[res.round - 1];
    // B18 결과는 대표 일수, 경제 보고서는 월 MWh. 월 값 0도 그대로 우선한다.
    const mwh = monthMWh ?? res.econ?.grid?.[id]?.curtailMWh ??
      (r.curtailMWh == null ? undefined : r.curtailMWh * (rd.mdays || rd.days) / rd.days);
    const events = curtailEvents(V, res.round, id);
    const eventText = events.map(({ ev, E }) => {
      const o = (E.opts || []).find(o => o.id === V.teams[id]?.resp?.[res.round + ":" + E.id]);
      const dv = o && typeof o.dev === "number" && (!o.knobs || o.knobs.includes("solarMul")) ? o.dev : 1;
      const mul = Math.max(0, 1 + (E.effect.solarMul - 1) * (typeof ev.x === "number" ? ev.x : 1) * dv);
      return `<div><dt>출력제어 사건</dt><dd>${esc(`사건: 태양광 ${pct((mul - 1) * 100)}%`)}${typeof ev.x === "number" ? "" : " (기본 크기)"}</dd><small>현상 <span class="tag-official">${esc(gradeWords(E.grade))}</span> · 크기 <span class="tag-mine">${esc(gradeWords("G"))}</span></small></div>`;
    }).join("");
    // renPct는 수요 대비 재생 공급(배터리 포함)의 반올림 값이라 발전량 분모로 쓰지 않는다. 대신 그 달 수요 대비 비율을 보인다.
    const demMonth = r.dem > 0 ? r.dem * (rd.mdays || rd.days) / rd.days : 0;
    const share = demMonth > 0 && typeof mwh === "number" ? `그 달 전기 수요의 ${fmt(100 * mwh / demMonth, 2)}%` : "–";
    return `<section class="lg-curtail" aria-label="버린 재생 전기"><h4>버린 재생 전기</h4><p class="lg-hint">${esc(resLabel(res))} · 월 기준</p>
      <dl><div><dt>계통 접속 출력제어</dt><dd>${esc(fmt(mwh, 2))} MWh</dd><small>${esc(share)} · <span class="tag-mine">${esc(gradeWords("G"))}</span></small></div>
      ${eventText || `<div><dt>출력제어 사건</dt><dd>이번 달 사건 없음</dd></div>`}</dl>
      ${foldNote ? infoTip("city-curtail", `전력망 접속 여유가 모자라거나 전기가 남는 봄·가을에는 재생 전기를 버립니다. 배터리와 연계선이 있으면 덜 버려요.`, { label: "버린 재생 전기" }) : `<p class="lg-hint">전력망 접속 여유가 모자라거나 전기가 남는 봄·가을에는 재생 전기를 버립니다. 배터리와 연계선이 있으면 덜 버려요.</p>`}</section>`;
  }
  const ASSUMPTIONS = '표시 없는 수치는 게임 가정이에요';
  function sourceHTML(id) {
    const start = KCP.ECON_DATA.start[id], names = { pop0: "시작 주민", ind0: "시작 종사자", fsr0: "시작 재정자립도" };
    if (!start?.src) return `<p class="lg-hint">시작 자료: ${esc(start?.note || "출처 자료 준비 중")}</p>`;
    return `<details id="lg-start-src"><summary>시작 자료·출처</summary>${Object.entries(start.src).map(([key, src]) => {
      if (!src || typeof src !== "object") return "";
      const field = ({ pop: "pop0", ind: "ind0", fsr: "fsr0" })[key] || key;
      const value = field === "fsr0" ? start[field] * 100 : start[field];
      return `<p>${esc(names[field] || key)} ${esc(fmt(value, 1))}${esc(field === "fsr0" ? "%" : src.unit || "명")} · ${esc(src.year || "기준연도 없음")} · ${esc(src.source || src.note || "게임 가정")} <span class="${gradeClass(src.grade)}">${esc(src.grade || "G")}</span></p>`;
    }).join("")}</details>`;
  }
  // 화면 보조값은 기기 저장만 사용한다. 약속·확신·수업 설정을 요청 봉투에 넣지 않는다.
  const K_CLASS = "kcp-league-class-v1";
  function unlockAudio() { return KCP.fxAudio?.unlock(); }
  function signal(kind) { KCP.fxAudio?.play(kind); }
  function speedText(E, detailed = false) {
    const n = E.speeds?.monthsPerTurn ?? E.eduSpeed;
    return Number.isFinite(n) ? `주민·기업 이동 시간 ×${fmt(n, 2)}(게임 1달 ≈ 현실 약 ${fmt(n, 2)}달) · 수업용 배속(${detailed ? "G" : gradeWords("G")})` : "";
  }
  function speedsHTML(E) {
    if (!E?.speeds) return `<p class="lg-hint">${esc(E ? speedText(E) : "")}</p>`;
    const s = E.speeds;
    const notes = Object.fromEntries((s.items || []).filter(x => ["lngSpikeFrequency", "outageHoursPerPercent", "complaintPoliticalEffect"].includes(x.key)).map(x => [x.key, x.note]));
    const items = [["이동 시간", s.monthsPerTurn, "배"], ["지지율 회복", s.eduMemory, "배"], ["주민 평가 간격", s.reviewEvery, "달"], ["대기 영향(집단 만족만·교육용)", s.eduAir, "배"], ["탄소 국경 부담", s.eduCbam, "배"], ["전력망 접속", s.eduConn, "배"], ["버리는 재생 전기", s.eduCurtail, "배"], ["기상 사건 빈도", s.hazardFreq, "배"], ["SMR 공사", s.smrTurns, "달"], ["LNG 가격 급등 빈도", s.lngSpikeFrequency, "배"], ["정전 1% 환산", s.outageHoursPerPercent, "시간/연"], ["연습 섬 송전 손실", s.islandLineLoss, "배"], ["연구 기간 비교", Array.isArray(s.researchYears) ? s.researchYears.join("~") : null, "년"], ["민원이 지지에 미치는 영향", Array.isArray(s.complaintPoliticalEffect) ? s.complaintPoliticalEffect.join("~") : null, "배"]];
    return `<details id="lg-speeds"><summary>수업용 시간과 효과 크기 · ${esc(gradeWords("G"))}</summary><p>${esc(speedText(E, true))}</p>${items.filter(([,v]) => v != null).map(([name,v,unit]) => { const key = { "LNG 가격 급등 빈도": "lngSpikeFrequency", "정전 1% 환산": "outageHoursPerPercent", "민원이 지지에 미치는 영향": "complaintPoliticalEffect" }[name]; return `<p>${esc(name)}: ${esc(notes[key] || `${v}${unit}`)}</p>`; }).join("")}${buildLeadHTML()}</details>`;
  }
  // D-81: 실제 공사 기간과 이 게임의 공사 규칙 차이를 밝힌다. 자료는 기기 안 params에서 읽는다(공개 상태 아님).
  function buildLeadHTML() {
    const lead = KCP.ECON_DATA.params.buildLeadYears?.v, kr = KCP.ECON_DATA.params.buildLeadKorea?.v;
    if (!lead || !kr) return "";
    const names = [["solar", "태양광"], ["wind", "육상풍력"], ["ess", "배터리(ESS)"], ["biomass", "바이오매스"], ["diesel", "디젤"], ["smr", "SMR"]];
    return `<p id="lg-build-lead">실제 공사 기간(착공~가동, 미국 에너지정보청 가정값 · ${esc(gradeWords("P"))}): ${names.map(([k, n]) => `${esc(n)} ${esc(lead[k])}년`).join(" · ")}. 한국 사례 · ${esc(gradeWords("O*"))}: LNG 복합 ${esc(kr.lngMonths.join("~"))}개월(계획 기준), 육상풍력은 인허가까지 약 ${esc(kr.windPermitYears)}년. 송전망은 계획·인허가부터 완공까지 ${esc(kr.gridYears.join("~"))}년(국제에너지기구 · ${esc(gradeWords("P"))}).</p><p id="lg-build-rule">이 게임은 SMR만 공사 ${esc(KCP.TECH_DATA?.params.smrTurns.v ?? 12)}달을 기다리고, 다른 설비는 바로 지어져 전력망 접속만 기다려요. 그래서 SMR이 현실보다 상대적으로 불리하게 그려져 있어요(${esc(gradeWords("G"))}).</p>`;
  }
  const bioCo2Text = value => `바이오 CO₂ ${fmt(value, 2)} t(국가 총량 밖 · IPCC 정보 항목)`;
  function recalHTML(rep, id, foldSource = false) {
    const c = rep?.cities?.[id], f = rep?.fiscal?.[id];
    const ps = KCP.ECON_DATA.params, value = key => ps[key]?.v;
    const warn = Number.isFinite(value("budgetToRevenue")) ? value("debtWarnRatio") / value("budgetToRevenue") : null;
    const crisis = Number.isFinite(value("budgetToRevenue")) ? value("debtCapRatio") / value("budgetToRevenue") : null;
    return `${Number.isFinite(c?.bioCo2) ? `<p id="lg-bio-co2">${esc(bioCo2Text(c.bioCo2))}</p>` : ""}
      ${Number.isFinite(c?.co2Intensity) ? `<p id="lg-co2-intensity">CO₂(공급 1MWh당, 지연 평균) ${esc(fmt(c.co2Intensity, 3))} t/MWh</p>` : ""}
      ${Number.isFinite(f?.perResidentNet) ? `<p id="lg-resident-net">이 도시는 주민 1명당 재정이 월 ${esc(signed(f.perResidentNet * 1e8))} 게임 원</p>` : ""}
      ${["warn", "crisis"].includes(f?.debtStage) ? `${foldSource ? '<div class="lg-info-line">' : ""}<p id="lg-debt-warning" class="lg-warn">지방채 ${f.debtStage === "crisis" ? "위기" : "주의"}${Number.isFinite(f.debtRatio) ? ` · 예산 대비 채무비율 ${esc(fmt(f.debtRatio * 100, 1))}%` : ""}${Number.isFinite(warn) && Number.isFinite(crisis) ? ` · 주의 ${esc(fmt(warn * 100))}% · 위기 ${esc(fmt(crisis * 100))}%${foldSource ? ` · <span class="tag-official">${esc(gradeWords("O"))}(2026.1.2)</span>` : ""}` : ""}${f.debtOver ? " · 지방채 한도를 넘었어요" : ""}</p>${foldSource ? infoTip("city-debt-source", "출처: 지방재정법 시행령 제65조의3 · 2026.1.2 시행 · 단위 %", { label: "지방채 기준 출처" }) : '<p class="lg-hint">출처: 지방재정법 시행령 제65조의3 · 2026.1.2 시행 · 단위 %</p>'}${foldSource ? "</div>" : ""}` : ""}`;
  }
  // Economic history t=0 is the end of the first operating month.
  function monthPoints(V, id) {
    const hist = V.econ?.cities[id]?.hist || [], rs = V.results || [];
    const months = [...new Set([...hist.map(h => h.t + 1), ...rs.map(r => r.round)])].sort((a, b) => a - b);
    return months.map(t => ({ ...hist.find(h => h.t + 1 === t), t, uns: rs.find(r => r.round === t)?.team[id]?.unsPct }));
  }
  function monthName(V, t) { const rd = C.roundsOf(V)[t - 1]; return rd?.month ? `${rd.year}년 ${rd.month}월` : `${t}라운드`; }
  function trendHTML(V, id, timeline = false) {
    const points = monthPoints(V, id), months = points.map(h => h.t), city = V.econ?.cities[id];
    const names = [["uns", "정전", "%"], ["pop", "주민", "명"], ["appr", "지지율", "%"], ["cash", "현금", "억"]];
    const start = months[0] || 1, end = months.at(-1) || start;
    const graphWidth = timeline ? Math.max(380, (end - start) * 24 + 116) : 380;
    const plotEnd = graphWidth - 100, X = t => 40 + (t - start) / Math.max(1, end - start) * (plotEnd - 40);
    const graphs = names.map(([k, name, unit], row) => {
      const vals = points.filter(h => Number.isFinite(h[k]));
      let lo = 0, hi = 100;
      if (k === "pop") hi = Math.max(1, city?.pop0 || 0, ...vals.map(h => h[k])) * 1.1;
      if (k === "cash") { lo = Math.min(0, ...vals.map(h => h[k])); hi = Math.max(1, ...vals.map(h => h[k])); }
      const Y = v => row * 70 + 56 - (v - lo) / Math.max(1, hi - lo) * 35;
      const path = vals.map((h, i) => `${i ? "L" : "M"}${X(h.t).toFixed(1)},${Y(h[k]).toFixed(1)}`).join(" ");
      return `<g data-trend="${k}"><text x="4" y="${row * 70 + 14}">${name} · ${esc(vals.length ? fmt(vals.at(-1)[k], 1) + unit : "자료 없음")}</text>${[lo, (lo + hi) / 2, hi].map(v => `<path d="M40,${Y(v)} H${plotEnd}" stroke="currentColor" opacity=".15"/><text x="${plotEnd + 5}" y="${Y(v) + 4}">${esc(fmt(v))}</text>`).join("")}<path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>${vals.map(h => `<circle data-month="${h.t}" cx="${X(h.t)}" cy="${Y(h[k])}" r="3"><title>${esc(monthName(V, h.t))} ${name} ${esc(fmt(h[k], 1))}${unit}</title></circle>`).join("")}</g>`;
    }).join("");
    const changes = [], records = new Map();
    if (timeline) {
      (V.teams[id]?.hist || []).forEach(h => records.set(h.r, { n: h.n, l: h.l }));
      if (id === L?.team) Object.entries(tdata().interview?.months || {}).forEach(([t, n]) => {
        if (n.buildCount != null) records.set(+t, { n: n.buildCount, l: n.lineCount || 0 });
        if ((n.missed || n.outageOpened || n.outageSingleShown) && missedText(n)) changes.push({ t: +t, label: missedText(n), kind: "outage" });
        if (n.policy) changes.push({ t: +t, label: "정책 변경", kind: "policy" });
      });
      let previous = { n: 0, l: 0 };
      [...records].sort((a,b) => a[0] - b[0]).forEach(([t, h]) => {
        if (h.n !== previous.n || h.l !== previous.l) changes.push({ t, label: `설비 ${h.n ?? "–"}개 · 전선 ${h.l ?? "–"}개`, kind: "build" });
        previous = h;
      });
      changes.sort((a,b) => a.t - b.t || a.kind.localeCompare(b.kind));
    }
    const displayedChanges = [...new Map(changes.filter(h => h.t >= start && h.t <= end).map(h => [`${h.t}:${h.kind}`, h])).values()];
    return `<figure id="${timeline ? "lg-timeline" : "lg-trends"}" class="lg-trends"><figcaption><div class="lg-info-line">${timeline ? "월별 추이 · 결정 표지" : "도시 추이"}${infoTip(timeline ? "timeline-trend" : "city-trend", "숫자 눈금을 함께 읽어요. 정전·지지는 0~100%, 주민·현금은 0을 포함해요.", { label: "추이 눈금" })}</div></figcaption><div class="lg-trend-scroll"><svg style="min-width:${timeline && C.roundsOf(V).length > 12 ? graphWidth : 0}px" viewBox="0 0 ${graphWidth} ${timeline ? 346 : 310}" role="img" aria-label="정전·주민·지지율·현금 추이, 0을 포함한 숫자 눈금">${graphs}${displayedChanges.map(h => `<g data-change="${h.kind}"><path d="M${X(h.t)},18 V276" stroke="currentColor" stroke-dasharray="2 4" opacity=".4"/><text text-anchor="middle" x="${X(h.t)}" y="${h.kind === "policy" ? 340 : h.kind === "outage" ? 310 : 325}">${h.kind === "policy" ? "정" : h.kind === "outage" ? "원" : "설"}<title>${esc(monthName(V, h.t))} ${esc(h.label)}</title></text></g>`).join("")}<text x="4" y="295">${esc(monthName(V, start))}</text><text x="${graphWidth - 5}" text-anchor="end" y="295">${esc(monthName(V, end))}</text></svg></div>${timeline ? `<p class="lg-hint">설 = 설비·전선 변경 · 정 = 정책 변경${displayedChanges.some(h => h.kind === "outage") ? " · 원 = 원인 나누기 결과" : ""}</p>` : ""}${timeline ? `<ul>${changes.map(h => `<li>${esc(monthName(V, h.t))} · ${esc(h.label)}</li>`).join("") || "<li>남은 결정 기록 없음</li>"}</ul>` : ""}</figure>`;
  }
  function lossHTML(V) {
    const me = V.teams[L.team], loss = C.lossOf(me.base, BG.current());
    return loss > 0 ? `<span class="lg-demolition">철거 손실 ${esc(fmt(loss, 1))}억</span>` : "";
  }
  const subsidyText = () => { const months = params("subsidyPayMonths"), quarterly = months.join() === "1,4,7,10"; return `국가 재정지원금은 연초에 연액을 정하고 ${quarterly ? "분기 초" : "지급 월"}(${months.join("·")}월)${quarterly ? "에" : "마다"} 1/${months.length}씩 받아요.`; };
  function helpHTML() {
    return `<section id="lg-help" class="lg-sec"><h3>이번 달에 할 일</h3><button type="button" class="v2-btn" id="lg-coach-again">첫 달 코치 다시 보기</button><p>${esc(SUPPLY_ASSUMPTION())}</p><ol><li>배치: 설비를 고르고 지도에 놓아요. 민원·전력망 렌즈를 봐요.</li><li>송전: 발전소와 마을을 선으로 이어요. 이웃 거래는 노란 연결점까지.</li><li>시험 운전: 아래 시험 버튼으로 내 도시를 먼저 돌려 봐요.</li><li>준비: 근거 하나·방향·확신으로 약속하고 준비를 눌러요.</li></ol><h4>재정지원금과 남은 돈</h4><p>${esc(subsidyText())} 남은 돈에는 지방채 한도를 포함해요. 건설·연구·대응 예약과 지원금·연계선 정산을 반영해요. 지방채는 빚이에요.</p><h4>막대 버튼</h4>${[["소리", "신호음을 켜거나 꺼요."], ["이웃·거래", "사건 대응, 전기값과 연계선을 정해요."], ["지역 지도", "이웃 도시를 보고 돌아와요."], ["연구", "연구 → 실증 → 도입을 살펴요."], ["결과", "숫자 → 원인 → 자세히를 봐요."], ["일지", "기준·약속·유지와 변경을 남겨요."], ["도시", "주민·지지율·정책·추이를 봐요."], ["순위", "도시별 점수 항목을 비교해요."], ["준비", "진행자에게 준비를 알리고, 혼자 할 때는 바로 이 달을 운영해요."]].map(([name, text]) => `<p><b>${name}</b> ${text}</p>`).join("")}<span id="lg-sound-controls"><button type="button" class="v2-btn" id="lg-sound" aria-pressed="${KCP.fxAudio?.enabled() === true}">소리</button><input type="range" id="lg-sound-vol" min="0" max="100" step="10" aria-label="소리 크기" value="${Math.round((KCP.fxAudio?.volume() ?? .6) * 100)}"${KCP.fxAudio?.enabled() ? "" : " hidden"}></span><button type="button" class="v2-btn" id="lg-build-help">모형 숫자와 자료 출처</button>${L.role === "solo" ? '<h4>판 다시 시작</h4><p>저장된 진행과 일지를 지우고 새 판을 시작해요.</p><button type="button" class="v2-btn" id="lg-solo-restart">처음부터</button>' : ""}${L.snap?.econ?.cities[L.team] ? `<p>지지율 ${esc(fmt(L.snap.econ.cities[L.team].approval, 1))}% · 주민 변화 ${esc(signed(L.snap.econ.report?.cities?.[L.team]?.dPop || 0))}명(지난달 대비)</p>` : ""}${speedsHTML(L.snap?.econ)}</section>`;
  }
  function planIssueCounts() {
    const issues = BG.planIssues();
    return { unlinked: issues.unlinked.length, waiting: issues.waiting.length, supplyMW: issues.supplyMW };
  }
  // D-74 뒤에는 돌 설비가 없어도 계통이 일부를 메워 정전이 100%가 되지 않는다(빈 계획 첫 달 약 50%).
  function noSupplyCause(unsPct, issues) {
    return unsPct > 0 && issues?.supplyMW === 0 ?
      `이번 달 돌아간 발전 설비가 없었어요: 전선 미연결 ${issues.unlinked}기 · 접속 대기 ${issues.waiting}기. ${SUPPLY_ASSUMPTION()}` : "";
  }
  function choosePlanTool(type) {
    closePanel(); BG.closeDrawer?.();
    const root = document.getElementById("bd-root");
    const groupSelector = `[data-group="${type === "line" ? "grid" : "fire"}"]`;
    const tool = root?.querySelector(`[data-tool="${type}"]`);
    if (!tool || tool.closest("[hidden]")) {
      const group = root?.querySelector(groupSelector);
      if (group?.getAttribute("aria-expanded") !== "true") group?.click();
    }
    const button = root?.querySelector(`[data-tool="${type}"]`);
    if (!button?.disabled && button?.getAttribute("aria-pressed") !== "true") button?.click();
    // 도구 선택은 하위 단추를 다시 그려 접는다. 새 단추를 펼친 뒤 포커스를 준다.
    const selected = root?.querySelector(`[data-tool="${type}"]`);
    const group = root?.querySelector(groupSelector);
    if (!selected || selected.closest("[hidden]")) {
      if (group?.getAttribute("aria-expanded") !== "true") group?.click();
    }
    (root?.querySelector(`[data-tool="${type}"]:not(:disabled)`) || root?.querySelector(groupSelector))?.focus({ preventScroll: true });
  }
  function updatePlanIssues() {
    const el = document.getElementById("lg-plan-issues");
    if (!el || L.away) return;
    const issues = planIssueCounts(), planning = L.snap?.phase === "plan";
    if (planning) {
      const { d, n } = monthNote();
      if (JSON.stringify(n.planIssues) !== JSON.stringify(issues)) { n.planIssues = issues; putData(d); }
    }
    const text = planning ? [issues.unlinked ? `<button type="button" class="lg-bbtn" data-issue="line">전선에 안 닿은 설비 ${issues.unlinked}기</button>` : "",
      issues.waiting ? `<button type="button" class="lg-bbtn" data-issue="wait">이번 달 접속 대기 ${issues.waiting}기</button>` : "",
      issues.supplyMW === 0 ? '<button type="button" class="lg-bbtn" data-issue="supply">이번 달 돌 설비 없음</button>' : ""].join("") : "";
    if (el.innerHTML !== text) el.innerHTML = text;
    el.hidden = !text;
  }
  function showIssueCheck(skip) {
    const root = document.getElementById("bd-root");
    if (!root) return;
    document.getElementById("lg-issue-check")?.remove();
    closePanel(); BG.closeDrawer?.();
    const issues = planIssueCounts(), card = document.createElement("section");
    card.id = "lg-issue-check"; card.setAttribute("role", "region"); card.setAttribute("aria-label", "준비 전 확인");
    card.innerHTML = `<h3>준비 전에 확인해요</h3><p>전선 미연결 ${issues.unlinked}기 · 이번 달 접속 대기 ${issues.waiting}기${issues.supplyMW === 0 ? " · 이번 달 돌 설비 없음" : ""}</p><p>${esc(SUPPLY_ASSUMPTION())}</p><button type="button" class="v2-btn" id="lg-issue-fix">고치러 가기</button><button type="button" class="v2-btn" id="lg-issue-go">그대로 진행</button>`;
    root.append(card);
    card.querySelector("#lg-issue-fix").onclick = () => {
      card.remove();
      const current = planIssueCounts();
      if (current.unlinked) choosePlanTool("line");
      else choosePlanTool("diesel");
    };
    card.querySelector("#lg-issue-go").onclick = () => {
      card.remove();
      if (L.snap?.phase !== "plan") { document.getElementById("lg-ready")?.focus({ preventScroll: true }); return; }
      const { d, n } = monthNote(); n.issueCheckPassed = true; putData(d); readyAction(skip);
      const promise = L.panel === "journal" ? root.querySelector("#lg-predict")?.querySelector("button:not(:disabled), select") : null;
      (promise || document.getElementById("lg-ready"))?.focus({ preventScroll: true });
    };
    card.querySelector("#lg-issue-fix").focus({ preventScroll: true });
  }
  function closeCoach(restore = false) {
    const d = tdata(); d.guideSeen = true; putData(d);
    L.coach = null;
    document.getElementById("lg-coach")?.remove();
    document.querySelectorAll(".lg-coach-target").forEach(el => el.classList.remove("lg-coach-target"));
    if (restore) document.getElementById("bd-canvas")?.focus({ preventScroll: true });
  }
  function showFirstGuide(root, again = false) {
    if (!root || L.away || !["team", "solo"].includes(L.role)) return;
    const d = tdata();
    const reattach = !again && !!L.coach;
    if (!again && !reattach && (d.guideSeen || L.previous || L.snap?.round !== 1 || curRound().month !== 1 || L.snap?.results?.length)) return;
    document.getElementById("lg-coach")?.remove();
    if (!reattach) L.coach = { step: again && ["review", "end"].includes(L.snap?.phase) ? 5 : 0,
      round: L.snap.round, builds: BG.current()?.builds.length || 0 };
    const el = document.createElement("aside"); el.id = "lg-coach"; el.setAttribute("aria-label", "첫 달 코치");
    el.innerHTML = '<span id="lg-coach-task" role="status" aria-live="polite"></span><button type="button" class="lg-bbtn" id="lg-coach-action"></button><button type="button" class="lg-bbtn" id="lg-coach-skip">건너뛰기</button><button type="button" class="lg-bbtn" id="lg-coach-close" aria-label="코치 닫기"><span id="lg-guide-close">닫기</span></button>';
    root.querySelector(".lg-map-guidance").append(el);
    el.querySelector("#lg-coach-close").onclick = () => closeCoach(true);
    el.querySelector("#lg-coach-skip").onclick = () => { if (L.coach.step < 7) L.coach.step++; else closeCoach(true); updateCoach(false); };
    el.querySelector("#lg-coach-action").onclick = coachAction;
    updateCoach(!reattach);
  }
  function coachSteps(issues, n) {
    // 말풍선 gridWaitInfo도 hostLimited가 없는 설비에는 접속 대기를 적용하지 않는다.
    const immediate = Object.entries(BG.BLD).find(([id, b]) => b.cls === "disp" && !b.hostLimited && document.querySelector(`[data-group="fire"]`) && id === "diesel");
    const build = immediate ? `${immediate[1].name} 하나 놓기 · 접속 대기 없어요` : "설비 하나 놓기 · 말풍선의 '대기'를 확인해요";
    return [
      ["이번 달 사건을 열어 봐요", "사건 보기", '#lg-bar [data-panel="deal"]'],
      [build, "화력", '[data-group="fire"]'],
      [`마을까지 이어요 · 미연결 ${issues.unlinked}기 · 대기 ${issues.waiting}기`, "송전선", '[data-tool="line"]'],
      ["시험 1주를 돌려 정전을 확인해요", "시험 1주", '[data-run="7"]'],
      ["준비 → 근거·방향·확신 고르고 약속해요", "준비", L.awaitReady ? "#lg-ready-confirm" : "#lg-ready"],
      ["운영 끝 · 결과에서 예측과 실제를 비교해요", "결과", '#lg-bar [data-panel="result"]'],
      ["정전 변화의 원인 하나를 골라 열어 봐요", "원인 열기", document.querySelector("#lg-outage-open") ? "#lg-outage-open" : "#lg-outage-carry"],
      [n.answer && n.askReason?.trim() ? "이유를 남겼어요 · 다음 달로 가요" : "다음에 바꿀 것 고르고 이유 한 줄 써요", n.answer && n.askReason?.trim() ? "다음 달" : "이유 쓰기", n.answer && n.askReason?.trim() ? "#lg-ready" : '[data-note="askReason"]']
    ];
  }
  function updateCoach(advance = true) {
    const state = L.coach, el = document.getElementById("lg-coach");
    if (!state || !el || L.away) return;
    if (state.round !== L.snap?.round) { closeCoach(); return; }
    const { n } = monthNote(), issues = planIssueCounts(), count = BG.current()?.builds.length || 0;
    const review = ["review", "end"].includes(L.snap?.phase);
    const done = [L.panel === "deal", count > state.builds, count >= 1 && issues.unlinked === 0,
      !!document.querySelector("#bd-again")?.getClientRects().length, n.confirmed || review,
      review && L.panel === "result", review && (document.querySelector('#lg-missed[data-opened="true"]') || n.outageSingleShown || !document.querySelector("#lg-missed[data-opened]"))];
    // 한 확인 주기에 한 단계만 전진해 화면의 다음 행동을 읽을 시간을 준다.
    if (advance && state.step < 7 && done[state.step]) state.step++;
    const [task, action, selector] = coachSteps(issues, n)[state.step];
    el.dataset.step = String(state.step + 1);
    const taskEl = el.querySelector("#lg-coach-task"), text = `${state.step + 1}/8 ${task}`;
    if (taskEl.textContent !== text) taskEl.textContent = text;
    el.querySelector("#lg-coach-action").textContent = action;
    document.querySelectorAll(".lg-coach-target").forEach(item => item.classList.remove("lg-coach-target"));
    let target = document.querySelector(selector);
    if (state.step === 2 && (!target || target.closest("[hidden]"))) target = document.querySelector('[data-group="grid"]');
    if (state.step === 4 && !target) target = document.getElementById("lg-ready");
    target?.classList.add("lg-coach-target");
  }
  function coachAction() {
    const step = L.coach?.step;
    if (step == null) return;
    if (step === 1) { closePanel(); BG.closeDrawer?.(); const group = document.querySelector('[data-group="fire"]'); if (group?.getAttribute("aria-expanded") !== "true") group?.click(); return; }
    if (step === 2) { choosePlanTool("line"); return; }
    if (step === 0 || step === 5) { openPanel(step === 0 ? "deal" : "result"); updateCoach(); return; }
    if (step === 6) openPanel("result");
    const { n } = monthNote(), [, , selector] = coachSteps(planIssueCounts(), n)[step];
    const target = document.querySelector(selector);
    if (!target) { openPanel(step >= 5 ? "result" : "journal"); return; }
    if (step >= 6 && selector !== "#lg-ready") { scrollPanelTo(target); target.focus({ preventScroll: true }); if (target.matches("button") && !target.disabled) target.click(); }
    else if (!target.disabled) target.click();
  }
  function setupMapGuidance(root) {
    clearInterval(L.guidanceTimer);
    const stack = document.createElement("div"); stack.className = "lg-map-guidance";
    stack.innerHTML = '<div id="lg-plan-issues" aria-label="이번 달 계획 확인" hidden></div>';
    // 기존 결과 요약도 같은 묶음에 두어 코치·서랍과 자리를 나눈다.
    const summary = root.querySelector("#lg-map-result");
    if (summary) stack.append(summary);
    root.append(stack);
    stack.addEventListener("click", e => {
      const issue = e.target.closest("[data-issue]");
      if (issue?.dataset.issue === "line") choosePlanTool("line");
      if (issue?.dataset.issue === "wait") {
        const text = BG.planIssues().waiting.map(b => `${b.name}: ${b.months == null ? "대기(말풍선에서 확인)" : `${b.months}달 대기`}`).join(" · ");
        BG.toast(`접속 대기 설비는 이번 달 발전하지 않아요. ${text}`);
      }
      if (issue?.dataset.issue === "supply") { const group = root.querySelector('[data-group="fire"]'); closePanel(); BG.closeDrawer?.(); if (group?.getAttribute("aria-expanded") !== "true") group?.click(); }
    });
    L.guidanceObserver?.disconnect();
    const syncBottom = () => {
      if (!stack.isConnected) return;
      const bottom = `${Math.ceil(stack.getBoundingClientRect().bottom + 8)}px`;
      if (root.style.getPropertyValue("--lg-guidance-bottom") !== bottom) root.style.setProperty("--lg-guidance-bottom", bottom);
    };
    L.guidanceObserver = new ResizeObserver(syncBottom);
    L.guidanceObserver.observe(stack);
    const session = L;
    L.guidanceTimer = setInterval(() => {
      if (L !== session || !root.isConnected || L.away) return;
      updatePlanIssues(); updateCoach();
      if (L.snap?.phase !== "plan") document.getElementById("lg-issue-check")?.remove();
      // 지도 머리가 움직여도 띠 크기는 같을 수 있어 위치는 주기마다 확인한다.
      syncBottom();
    }, 500);
    updatePlanIssues(); syncBottom();
  }
  function publicCSV(V) {
    // 열을 명시해 자유 서술·약속서·로그가 내려받기에 섞이지 않게 한다.
    const rows = [["도시", "달", "연", "월", "정전(%)", "주민(명)", "지지율(%)", "현금(억)"]];
    actT(V).forEach(city => monthPoints(V, city.id).forEach(h => {
      const rd = C.roundsOf(V)[h.t - 1];
      rows.push([city.name, h.t, rd?.year ?? "", rd?.month ?? "", h.uns ?? "", h.pop ?? "", h.appr ?? "", h.cash ?? ""]);
    }));
    return "\ufeff" + rows.map(row => row.map(v => `"${(typeof v === "string" ? v.replace(/^[=+@-]/, "'$&") : String(v)).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  }
  function downloadRecords() {
    const csv = publicCSV(C.publicView(L.S, Date.now())), url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `league-${L.room}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function cityHTML(V) {
    const E = V.econ, c = E.cities[L.team], rep = E.report, f = rep?.fiscal[L.team], g = rep?.groups[L.team];
    const h = c.hist, prev = E.before?.[L.team], dp = rep?.cities[L.team]?.dPop || 0, di = rep?.cities[L.team]?.dInd || 0;
    const groups = GROUP_KEYS.filter(k => Object.hasOwn(c.groups, k)), low = lowestGroup(c.groups);
    const pol = L.pendingPol || V.teams[L.team].econPol || c.policy || {}, open = V.phase === "plan";
    const every = params("reviewEvery"), remaining = every - E.t % every;
    const grid = c.grid || V.grid?.[L.team];
    const revenues = { subsidy: "재정지원금", resTax: "주민세", indTax: "산업세", facility: `지역자원시설세(${gradeWords("O·M·G")})`, tariff: "전기요금 차익", trade: "전력 판매", royalty: "기술 사용료", bonus: "사건 지원금", salvage: "철거 회수" };
    const expenses = { capex: "건설", fuel: "연료", opex: "운영", service: "공공서비스", incentive: "유치 보조", interest: "이자", trade: "전력 구매", polChange: "정책 변경", policy: "시위 중 정책 변경" };
    const money = (title, vals, names) => `<h4>${title}</h4><dl class="lg-money">${Object.keys(names).filter(k => Object.hasOwn(vals || {}, k) && !(k === "facility" && !vals[k])).map(k => `<div><dt>${esc(names[k] || k)}</dt><dd>${esc(fmt(vals[k], 2))}억</dd></div>`).join("")}</dl>`;
    return `<section id="lg-city" class="lg-sec"><h3>${esc(c.name)} 도시</h3>${sourceHTML(L.team)}${lossHTML(V)}
      ${(L.doc?.maps[L.doc.map] || V.teams[L.team].plan)?.fab2 ? `<p id="lg-fab2-active">반도체 증설 시나리오 적용 중</p>` : ""}
      <div class="lg-info-line"><p class="lg-left">남은 돈 <b data-money="left">${esc(fmt(V.teams[L.team].left, 1))}억</b></p><p class="lg-hint">남은 돈에는 지방채 한도(빚)를 포함해요. 억 = 게임 단위</p>${infoTip("city-money", "예약·지원금·연계선 정산을 반영해요. 실제 시 예산이 아니에요.", { label: "남은 돈 단위" })}</div><p class="lg-hint">${ASSUMPTIONS}</p><dl class="lg-kpi"><div><dt>주민</dt><dd>${esc(fmt(c.pop))}명</dd><small>지난달 ${esc(signed(dp))}명</small></div><div><dt>종사자</dt><dd>${esc(fmt(c.ind))}명</dd><small>지난달 ${esc(signed(di))}명</small></div><div><dt>현금</dt><dd>${esc(fmt(c.cash, 1))}억</dd><small>지방채 한도 ${esc(fmt(c.debtCap, 1))}억</small></div><div><dt>지지율</dt><dd>${esc(fmt(c.approval, 1))}%</dd><small>다음 평가 ${esc(fmt(remaining))}달 뒤</small>${infoTip("city-approval-rule", `통과: 참가 도시 평균 지지율 변화 대비 −${esc(fmt(params("approvalDrop"), 1))}%p 이내`, { label: "지지율" })}</div></dl>
      ${tipBox("city-power-definition", "설비/피크", `<p id="lg-power-def" class="lg-hint">${esc(POWER_CHIP_DEF)}</p>`)}${recalHTML(rep, L.team, true)}${trendHTML(V, L.team)}<section id="lg-grid" aria-label="재생 접속과 출력제어"><dl><div><dt>재생 접속 여유(남은/전체)</dt><dd>${esc(fmt(grid?.headroomMW, 1))} / ${esc(fmt(grid?.hostMW, 1))} MW</dd></div><div><dt>접속 대기</dt><dd data-waiting="${grid?.waitingMW > 0}">${esc(fmt(grid?.waitingMW, 1))} MW</dd></div></dl>${curtailHTML(V, V.results.at(-1), L.team, undefined, true)}<div class="lg-info-line"><p class="lg-hint"><span class="tag-mine">${esc(gradeWords("G"))} · 접속·출력제어</span> <span class="tag-official">충전 상한 ${esc(fmt(params("essCap") * 100))}% · ${esc(gradeWords(KCP.ECON_DATA.params.essCap.grade))}(2020.2)</span></p>${infoTip("city-grid-ess", "재생 설비는 지어도 전력망 접속 여유가 있어야 발전해요. ESS와 연계선이 여유를 늘립니다. 충전 상한 출처: 2020.2 안전대책(산업부 2022 보도설명자료)", { label: "접속과 ESS 출처" })}</div></section>
      ${g ? `<p id="lg-approval-why">이번 달 지지율 변화 이유(${esc(gradeWords(g.whyGrade))}): ${esc(whyText(g) || "표시할 만큼 큰 변화 없음")}</p>` : ""}<h4>집단 만족</h4>${groups.map(k => `<div class="lg-grp" data-g="${esc(k)}"><button type="button" data-group="${esc(k)}" aria-expanded="${L.group === k}">${esc(KCP.ECON_DATA.groups[k].name)} · 비중 ${esc(fmt(c.shares[k] * 100, 1))}% · 만족 ${esc(fmt(c.groups[k], 1))}점</button><meter min="0" max="100" value="${esc(c.groups[k])}" aria-label="${esc(KCP.ECON_DATA.groups[k].name)} 만족"></meter>${k === low && g?.lowestGroupDissatisfaction?.group === k ? `<p class="lg-why">이 집단의 불만 이유(${esc(gradeWords(g?.lowestGroupDissatisfaction?.whyGrade))}): ${g.lowestGroupDissatisfaction.key ? `${esc(PART_NAMES[g.lowestGroupDissatisfaction.key] || g.lowestGroupDissatisfaction.key)} · 만족도 부족 ${esc(fmt(g.lowestGroupDissatisfaction.deficit, 1))}점` : "현재 별도 불만 요인 없음"}</p>` : ""}${L.group === k ? groupCauseHTML(c, k, rep, prev) : ""}</div>`).join("")}
      <div class="lg-info-line lg-air-note"><span class="tag-mine">공기 · ${esc(gradeWords(airNeighbours().some(x => x.grade !== "G") ? "M·G·P" : "M·G"))}</span><p class="lg-hint">전체 대기질이나 관측 농도는 아니에요.</p>${infoTip("city-air", airNoteHTML(), { label: "공기 추정" })}</div>
      <section id="lg-econpol"><h4>정책 <span class="tag-mine">${esc(gradeWords("G"))}</span></h4>${[["taxRes", "주민 세율", "세입↑ / 주민 매력↓"], ["taxInd", "산업 세율", "세입↑ / 기업 매력↓"], ["service", "공공서비스", "생활 만족↑ / 지출↑"], ["incentive", "기업 유치 보조", "기업 매력↑ / 지출↑"]].map(([k, name, help]) => `<label class="lg-policy"><span>${name} <output>${esc(fmt(pol[k] || 0, 1))}${k === "incentive" ? "억/달" : "단계"}</output></span><input type="range" data-pol="${k}" min="${k === "incentive" ? 0 : -2}" max="${k === "incentive" ? 20 : 2}" step="1" value="${esc(pol[k] || 0)}" ${open ? "" : "disabled"}><small>얻는 것 / 잃는 것: ${help}</small></label>`).join("")}<label class="lg-policy lg-re100"><span><input type="checkbox" data-pol="re100" ${pol.re100 ? "checked" : ""} ${open && techResearch(V, L.team).adopted?.includes("re100") ? "" : "disabled"}>RE100 산단 지정</span><small>${techResearch(V, L.team).adopted?.includes("re100") ? `재생 전기 비중을 산업 평가에 더 반영해요(${gradeWords("G")}).` : "🔒 RE100 산단 도입 후 선택"}</small></label></section>
      <section id="lg-fiscal"><h4>지난달 돈</h4>${f ? `${money("세입", f.rev, revenues)}${money("세출", f.exp, expenses)}<p>운영 수지(건설 제외) ${esc(signed(f.revTotal - f.expTotal + f.exp.capex, 2))}억</p><div class="lg-info-line"><p class="lg-hint">연료 ${esc(fmt((V.results.at(-1)?.team[L.team]?.cost.fuel || 0) * (rep.weekMul || 1), 2))}억(전기요금 차익에 이미 반영)</p>${infoTip("city-fuel-note", `총 전기 매출(참고) ${esc(fmt(f.tariffGross, 2))}억`, { label: "연료·총 전기 매출(참고)" })}</div>` : `<p class="lg-hint">첫 운영 뒤에 표시돼요.</p>`}</section>
      <section id="lg-moves"><div class="lg-info-line"><h4>지난달 이주·이전</h4>${rep && ["pop", "ind"].some(k => rep.flows?.[k]?.some(f => f.from === L.team || f.to === L.team)) ? infoTip("city-moves", `이유는 두 도시의 시작 대비 변화에서 가장 큰 차이 한 가지를 고른 설명이에요. 근거 표시가 없는 이전 기록은 추정(${esc(gradeWords("G"))})이에요.`, { label: "이주 이유" }) : ""}</div>${movesHTML(rep, L.team)}</section>
      <section id="lg-offers"><h4>기업 이전 희망</h4>${E.offers.length ? E.offers.map(o => { const e = o.eval?.by[L.team]; return `<article class="lg-offer" data-offer="${esc(o.id)}"><b>${esc(o.name)} · ${esc(fmt(o.workers))}명</b>${e ? `<p>조건 충족 도시 우선 순위 ${esc(e.rank)}위</p>${OFFER_CHECK_KEYS.filter(k => Object.hasOwn(e.checks, k)).map(k => [k, e.checks[k]]).map(([k, v]) => `<p data-check="${esc(k)}" data-ok="${v.ok ? "true" : "false"}">${v.ok ? "✓" : "✗"} ${esc({ mw: "여유 전력", re: "재생", rel: "정전", workers: "구직 인력" }[k])}: 우리 ${esc(fmt(v.have, 1))}${esc({ mw: " MW", re: "%", rel: "%", workers: "명" }[k])} / 조건 ${k === "rel" ? "≤" : "≥"} ${esc(fmt(v.need, 1))}${esc({ mw: " MW", re: "%", rel: "%", workers: "명" }[k])}</p>`).join("")}` : `<p>운영 뒤 조건 평가가 표시돼요.</p>`}</article>`; }).join("") : `<p class="lg-hint">열린 제안이 없어요.</p>`}</section>
      ${Number.isFinite(E.speeds?.monthsPerTurn ?? E.eduSpeed) ? `<div class="lg-info-line"><p class="lg-hint">주민·기업 이동 시간 ×${esc(fmt(E.speeds?.monthsPerTurn ?? E.eduSpeed, 2))}</p>${infoTip("city-speed", esc(speedText(E).slice(speedText(E).indexOf("("))), { label: "수업용 배속" })}</div>` : ""}</section>`;
  }
  function groupCauseHTML(c, key, rep, prev) {
    const weights = params("groupW")[key], parts = c.groupParts || {}, target = rep?.cities[L.team]?.Lparts || {};
    // groupTargets가 lagL에서 그대로 읽는 다섯 항목만 지연 비교. air·tax·taxI는 다른 식이다.
    const bars = causeBreakdown({}, parts, weights, 0, false).filter(x => x.key !== "other");
    return `<div class="lg-cause">${infoTip(`city-group-${key}`, `만족도 목표에 들어가는 점수(집단 만족이 따라가기 전) · 옅은 글 상자: 앞으로 반영될 변화(${esc(gradeWords("G"))})`, { label: "집단 만족 계산" })}${bars.map(x => `<div>${esc(PART_NAMES[x.key] || x.key)} ${esc(fmt(x.value, 1))}점<meter min="0" max="100" value="${esc(Math.max(0, x.value))}" aria-label="목표 기여(지연 반영 전)"></meter>${["rel", "price", "jobs", "svc", "crowd"].includes(x.key) && target[x.key] != null ? `<span class="lg-pending">앞으로 반영될 변화 ${esc(signed((target[x.key] - (parts[x.key] || 0)) * weights[x.key], 1))}점</span>` : ""}</div>`).join("")}</div>`;
  }
  function migrationReason(flow) {
    const subject = `${teamName(flow.from)}에서 ${teamName(flow.to)}보다`;
    const why = (flow.why || "이동 조건이 불리해서").replaceAll("공기가 나빠서", "발전 PM2.5 증분으로 공기가 나빠서").replace(/\s*\((?:추정·)?(?:O\*?|P|M|G)\)/g, "");
    return `${subject} 시작 대비 변화로 볼 때 ${why} · ${gradeWords(flow.whyGrade)}`;
  }
  function movesHTML(rep, id) {
    const rows = ["pop", "ind"].flatMap(k => (rep?.flows[k] || []).filter(f => !id || f.from === id || f.to === id).map(f => ({ ...f, kind: k })));
    return rows.length ? `<ul class="lg-movelist">${rows.map(f => `<li>${esc(teamName(f.from))} → ${esc(teamName(f.to))} ${esc(fmt(f.n))}명(${f.kind === "pop" ? "주민" : "종사자"}): ${esc(migrationReason(f))}</li>`).join("")}</ul>` : `<p class="lg-hint">지난달 보고된 흐름이 없어요.</p>`;
  }
  // 기술 표시는 공개 연구 상태를 그대로 읽는다. 칭호는 점수에 더하지 않는다.
  // T2 화면 연출 시간(게임 계수 아님): 0.8초. CSS의 lg-tech-reveal과 일치한다.
  const TECH_FLIP_MS = 800;
  // 서랍 안을 누르는 중·직후 다시 그리기를 미루는 시간. 누른 채 끌어 서랍 밖에서 뗀 경우를 위해 누름 상태는 최대 3초만 믿는다.
  const PANEL_PRESS_MS = 300, PANEL_PRESS_HOLD_MS = 3000;
  const techData = () => KCP.TECH_DATA;
  const techCard = id => techData()?.cards.find(c => c.id === id);
  const techResearch = (V, id) => V.teams?.[id]?.research || V.econ?.cities?.[id]?.research || V.teams?.[id]?.rs || {};
  function techTitlesHTML(rs) {
    return (rs.titles || []).map(id => techData()?.titles.find(t => t.id === id)).filter(Boolean)
      .map(t => `<span class="lg-tech-title" title="칭호는 점수에 더하지 않아요">◇ ${esc(t.name)}</span>`).join("");
  }
  function techIconsHTML(rs) {
    return (rs.adopted || []).map(techCard).filter(Boolean).map(c => `<span class="lg-tech-icon" data-tech-adopted="${esc(c.id)}" title="${esc(c.name)}"><span aria-hidden="true">◆</span> ${esc(c.name)}</span>`).join("");
  }
  function techNewsHTML(V) {
    const res = V.results?.at(-1);
    return actT(V).flatMap(t => (res?.team[t.id]?.research?.completed || []).map(techCard).filter(Boolean)
      .map(c => `<p class="lg-tech-news">${esc(t.name)}, ${esc(c.name)} 개발 · 다음 ${V.econ ? "달" : "턴"} 도입</p>`)).join("");
  }
  function techState(V, id, c) {
    const rs = techResearch(V, id), queue = rs.queue || V.teams[id].plan?.rq || [];
    const other = techData().pairs.find(pair => pair.includes(c.id))?.find(k => k !== c.id);
    const selected = [...(rs.adopted || []), ...queue, ...Object.keys(rs.stage || {}).filter(k => rs.stage[k]), ...Object.keys(rs.adoptR || {})];
    if (rs.adopted?.includes(c.id)) return { key: "adopted", text: "도입", blocked: true };
    if (rs.stage?.[c.id] === "done" || rs.adoptR?.[c.id] > V.round) return { key: "pending", text: `다음 ${V.econ ? "달" : "턴"} 도입`, blocked: true };
    if (rs.stage?.[c.id] === "demo") return { key: "demo", text: "실증 중", blocked: true };
    if (queue.includes(c.id)) return { key: rs.current === c.id || (!rs.current && queue[0] === c.id) ? "progress" : "queued", text: rs.current === c.id || (!rs.current && queue[0] === c.id) ? "진행 중" : "연구 대기", blocked: false };
    if (other && selected.includes(other)) return { key: "locked", text: "잠김", why: `${techCard(other)?.name || other} 선택 · 둘 중 하나`, blocked: true };
    const req = c.req || [], adopted = rs.adopted || [];
    if (req.length && !(c.id === "mass" ? req.some(k => adopted.includes(k)) : req.every(k => adopted.includes(k))))
      return { key: "locked", text: "잠김", why: `${req.map(k => techCard(k)?.name || k).join(c.id === "mass" ? " 또는 " : " · ")} 도입 필요`, blocked: true };
    if (c.id === "re100" && (V.results?.at(-1)?.team[id]?.renPct || 0) < techData().params.re100Need.v)
      return { key: "locked", text: "잠김", why: `직전 운영 재생 비중 ${fmt(techData().params.re100Need.v)}% 이상 필요`, blocked: true };
    const donors = actT(V).filter(t => t.id !== id && techResearch(V, t.id).adopted?.includes(c.id));
    return { key: donors.length ? "transfer" : "available", text: donors.length ? "다른 도시 도입 · 이전 가능" : "가능", blocked: false };
  }
  function gradeTags(grade) {
    return (grade || "G").split("·").map(g => `<span class="${gradeClass(g)}">${esc(gradeWords(g))}</span>`).join(" · ");
  }
  function techEffectText(c, V = L.snap) {
    const p = techData().params, v = k => p[k]?.v, f = (k, d = 3) => fmt(v(k), d);
    switch (c.id) {
      case "grid": return BG.gridEffectText();
      case "hvdc": return `연계선 용량 ×${f("hvdcCap")}로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×${f("hvdcCost")}`;
      case "scable": return `연계선 용량 ×${f("scableCap")}, 손실 ×${f("scableLoss")}, 냉각 ${f("scableCooling")}억/선/${V?.econ ? "달" : "턴"}`;
      case "sic": return `재생 출력 ×${f("sicOutput")}`;
      case "bms": return BG.bmsEffectText();
      case "tandem": return `새 탠덤 태양광 출력 ×${f("tandemOutput")}, 건설비 ×${f("tandemCost")}`;
      case "nbat": return `새 배터리 용량 ${fmt(BG.M.batMWh * v("nbatCapacity"), 1)} MWh(×${f("nbatCapacity")})`;
      case "mass": return `새 태양광·배터리 건설비 ×${f("massCost")}`;
      case "h2store": return `${f("h2MWh")} MWh 저장, 왕복 ${fmt(v("h2Efficiency") * 100, 1)}%`;
      case "h2mix": return c.eff;
      case "ccu": return `석탄 CO₂ ×${f("ccuCo2")}, 출력 ×${f("ccuOutput")}`;
      case "smr": return `${f("smrMW")} MW, ${f("smrCost")}억, 공사 ${f("smrTurns")}${V?.econ ? "달" : "턴"}`;
      case "vpp": return `수요반응 ×${f("drEffect")}·비용 ×${f("drCost")}, 출력제어 손실 ×${f("vppCurtail")}`;
      case "re100": return `정책 선택 시 산업 매력의 재생 항목 가중 ×${fmt(params("re100PolicyWeight"), 3)}`;
      default: return c.eff;
    }
  }
  function techEurekaText(id, V) {
    const p = techData().params;
    const text = { hvdc: () => `연계선 ${fmt(p.eurekaTies.v)}개 연결`, tandem: () => `태양광 ${fmt(p.eurekaSolar.v)}기 운영`,
      smr: () => `지지율이 시작보다 ${fmt(p.eurekaApproval.v)}%p 넘게 떨어지지 않음 또는 시위 없음`, vpp: () => `수요반응 정책 ${fmt(p.eurekaDr.v)}${V?.econ ? "달" : "턴"} 운영`,
      re100: () => `재생 비중 ${fmt(p.re100Need.v)}% 이상 운영` };
    return text[id] ? text[id]() : techData().eureka[id];
  }
  function externalLinks(sources) {
    return [...new Set(sources)].filter(s => typeof s === "string" && /^https?:\/\/[^\s]+$/.test(s))
      .map(s => `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(new URL(s).hostname)}</a>`).join(" · ");
  }
  function techScaleHTML(c) {
    const keys = { hvdc: "hvdcCap", scable: "scableCap", sic: "sicOutput", tandem: "tandemOutput", nbat: "nbatCapacity", mass: "massCost", h2store: "h2Efficiency", h2mix: "h2Co2", ccu: "ccuCo2", smr: "smrTurns", vpp: "drEffect" };
    const p = techData().params[keys[c.id]], ref = c.numbers?.need;
    const urls = [...(p?.sources || []), ...(c.effectSources || []), ...(c.sources || [])];
    const comparison = c.scale;
    const scale = Number.isFinite(comparison?.v) ? `교육용 배속 ×${fmt(comparison.v, 3)} · ${gradeWords(comparison.grade)}` : `교육용 배속: 비교값 없음 · ${gradeWords(comparison?.grade)}`;
    // 자료에 들어 있는 비교 문장의 등급도 HTML을 만들기 전에 읽는다.
    const baseline = String(comparison?.baseline || "").replace(/\((O\*?|P|M|G)\)/g, (_, grade) => `(${gradeWords(grade)})`);
    const basis = c.id === "hvdc" ? String(p?.note || "").replace(/\((O\*?|P|M|G)\)/g, (_, grade) => `(${gradeWords(grade)})`) : "";
    return `<p class="lg-tech-scale">${esc(scale)}${baseline ? ` · 비교 기준: ${esc(baseline)}` : ""} · 연구·공사 시간은 수업용으로 압축했어요(${esc(gradeWords("G"))}).</p><p class="lg-tech-source" data-tech-source="${esc(c.id)}">출처: ${externalLinks(urls) || "현실 효과 비교 자료 없음"}${basis ? ` · ${esc(basis)}` : ""} · 기준연도 ${esc(p?.year || ref?.year || "자료 없음")} · 위 효과 단위는 게임 기준이에요.</p>`;
  }
  function techDetailHTML(V, c) {
    const rs = techResearch(V, L.team), state = techState(V, L.team, c), queue = rs.queue || [], open = !lockMsg() && !L.techPending;
    const donors = actT(V).filter(t => t.id !== L.team && techResearch(V, t.id).adopted?.includes(c.id));
    const peers = actT(V).filter(t => t.id !== L.team && !techState(V, t.id, c).blocked);
    const peer = peers.find(t => t.id === rs.joint?.[c.id]?.other) || peers.find(t => t.id === L.techPeer) || peers[0];
    const license = rs.licensedFrom?.[c.id], joint = rs.joint?.[c.id], p = techData().params;
    const pair = techData().pairs.find(pair => pair.includes(c.id));
    const source = (c.sources || []).filter(s => typeof s === "string");
    const links = source.map(s => /^(https?:\/\/|docs\/)[^\s]+$/.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s.startsWith("docs/") ? s.split("/").at(-1) : new URL(s).hostname)}</a>` : esc(s));
    const unlocked = (c.unlock?.builds || []).map(k => BG.BLD[k]?.name || k);
    if (c.unlock?.tie) unlocked.push("HVDC 연계선");
    if (c.unlock?.policy) unlocked.push("RE100 산단 정책");
    return `<article class="lg-tech-detail" id="lg-tech-detail" data-tech-detail="${esc(c.id)}" aria-label="기술 상세">
      <h3>${esc(c.name)}</h3><p>${c.fieldCategory === "concentration" ? "켄텍 융합전공" : "켄텍 12대 연구분야"}: <b>${esc(c.field)}</b>${c.fieldCategory === "concentration" ? " (12대 연구분야 아님)" : ""} · ${esc(gradeWords(c.fieldGrade))}(${esc(c.year)})</p>${infoTip(`research-field-${c.id}`, `<p class="lg-tech-source">분야 이름 출처: ${externalLinks(source)} · ${esc(c.year)}(${esc(c.fieldGrade)}) · 카드와 분야의 연결은 게임 가정(G)</p>`, { label: "분야 이름 출처" })}
      <p class="lg-tech-effect">효과: ${esc(techEffectText(c, V))} · 근거 ${gradeTags(c.evidenceGrade)} · 효과 크기 ${gradeTags(c.effectGrade)}</p>${techScaleHTML(c)}
      <p>${esc(c.why)}</p>${source.some(s => s.startsWith("docs/")) ? `<details class="lg-tech-design"><summary>설계 문서</summary>${links.filter((_, i) => source[i].startsWith("docs/")).join(" · ")}</details>` : ""}
      <p>필요 연구량 ${esc(fmt(c.need))} · 실증비 ${esc(fmt(c.demo))}억${c.numbers?.demo ? ` (${esc(gradeWords(c.numbers.demo.grade))})` : ""}</p>
      <p>유레카: ${esc(techEurekaText(c.id, V))}${rs.eureka?.includes(c.id) ? " · 달성" : ` · 남은 연구량의 ${esc(fmt(p.eurekaFrac.v * 100, 1))}% 추가 진척(${esc(gradeWords("G"))})`}</p>
      ${pair ? `<p>둘 중 하나: ${pair.map(k => esc(techCard(k)?.name || k)).join(" / ")}</p>` : ""}
      ${state.why ? `<p>${esc(state.why)}</p>` : ""}${unlocked.length ? `<p>해금: ${unlocked.map(esc).join(" · ")} · 도입 후 설비는 건설 도구, 연계선은 이웃·거래, 정책은 도시 서랍에서 선택</p>` : ""}
      ${license ? `<p>이전 원 개발 도시: ${esc(teamName(license))}</p>` : ""}
      ${joint ? `<p>공동 연구: ${esc(teamName(joint.other))} · ${joint.active ? "함께 진행(연결이 끊기면 대기)" : "상대 도시의 같은 카드 요청 대기"}</p>` : ""}
      <div class="lg-tech-actions"><button type="button" data-tech-action="research" data-card="${esc(c.id)}" ${open && !state.blocked && !queue.includes(c.id) ? "" : "disabled"}>연구 순서에 넣기</button>
      <label>이전 도시<select id="lg-tech-donor" ${open && donors.length && !state.blocked && !joint && !license ? "" : "disabled"}>${donors.length ? donors.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("") : `<option value="">도입 도시 없음</option>`}</select></label>
      <button type="button" data-tech-action="license" data-card="${esc(c.id)}" ${open && donors.length && !state.blocked && !joint && !license ? "" : "disabled"}>기술 이전</button><p class="lg-hint">사용료 ${esc(fmt(p.royalty.v, 1))}억/${V.econ ? "달" : "턴"}, 최대 ${esc(fmt(p.royaltyMonths.v))}${V.econ ? "달" : "턴"}</p>
      <label>공동 연구 도시<select id="lg-tech-peer" ${open && peers.length && !state.blocked && !license ? "" : "disabled"}>${peers.length ? peers.map(t => `<option value="${esc(t.id)}" ${t.id === peer?.id ? "selected" : ""}>${esc(t.name)}</option>`).join("") : `<option value="">대상 도시 없음</option>`}</select></label>
      <button type="button" data-tech-action="joint" data-card="${esc(c.id)}" ${open && peers.length && !state.blocked && !license ? "" : "disabled"}>공동 연구</button></div>
      ${tipBox(`research-cooperation-${c.id}`, "기술 이전·공동 연구", `<p class="lg-hint">기술 이전: 필요 연구량 ${esc(fmt(p.licenseNeed.v * 100))}% · 도시별 수입 상한 ${esc(fmt(p.royaltyCap.v))}억(${esc(gradeWords("G"))}).</p>
      <p class="lg-hint">공동 연구는 양쪽 도시의 내부 전력망까지 이어진 연계선과 같은 카드 요청이 필요해요. 합산 인력으로 진행하고 실증비는 ${esc(fmt(p.jointShare.v * 100))}%씩 부담해요(${esc(gradeWords("G"))}). 서버가 조건과 예산을 확인해요.</p>`)}
      ${lockMsg() ? `<p>${esc(lockMsg())}</p>` : ""}</article>`;
  }
  function techHTML(V) {
    const data = techData();
    if (!data) return `<p class="lg-hint">연구 자료가 없어요.</p>`;
    const rs = techResearch(V, L.team), builds = V.teams[L.team].plan?.builds || [], queue = rs.queue || [];
    const chosen = techCard(L.techCard) || techCard(rs.current) || data.cards[0];
    const progress = id => Math.max(0, Math.min(100, rs.progress?.[id] || 0));
    return `<section id="lg-tech" class="lg-tech-panel"><h2>연구 기술 트리</h2>
      <p class="lg-tech-staff">연구 인력: 대학 ${esc(fmt(builds.filter(b => b.t === "uni").length))}곳 · 연구소 ${esc(fmt(builds.filter(b => b.t === "lab").length))}곳 · 인력 ${esc(fmt(rs.staff))}명 · 유효 인력 ${esc(fmt(rs.eff))}명</p>
      <p class="lg-hint">새 대학은 운영을 마친 뒤 인력에 반영돼요.</p><p class="lg-hint">${V.econ ? "한 달" : "한 턴"}에 인력당 ${esc(fmt(rs.stepsPerTurn))}주치 진척 · 연구 예약 비용 ${esc(fmt(rs.reservedCost, 1))}억. 인력이 없으면 진척이 멈춰요.</p>
      <div class="lg-tech-titles">${techTitlesHTML(rs)}</div><p class="lg-tech-queue">연구 순서: ${queue.length ? queue.map((k, i) => `${esc(i + 1)}. ${esc(techCard(k)?.name || k)}`).join(" → ") : "아직 없음"}</p>
      <div class="lg-info-line"><p class="lg-hint">근거 표시·기술 트리</p>${infoTip("research-grades", `<p>근거 표시: ${esc(["O", "O*", "P", "M", "G"].map(g => `${gradeWords(g)}(${g})`).join(" · "))}. 출처 줄의 글자도 같은 뜻이에요.</p><p>트리 안에서 좌우로 스크롤해 여섯 갈래를 볼 수 있어요. 카드를 눌러 상세를 확인해요.</p>`, { label: "근거 표시·기술 트리" })}</div>
      <div class="lg-tech-scroll" tabindex="0" role="region" aria-label="여섯 갈래 기술 트리, 좌우 스크롤"><div class="lg-tech-tree">${data.branches.map(b => `<section class="lg-tech-branch" data-branch="${esc(b.id)}"><h3>${esc(b.name)}</h3>${data.cards.filter(c => c.branch === b.id).map(c => {
        const state = techState(V, L.team, c), pair = data.pairs.find(pair => pair.includes(c.id));
        return `<button class="lg-tech-card" type="button" data-tech-card="${esc(c.id)}" data-state="${esc(state.key)}" aria-pressed="${c.id === chosen.id}"><strong>${esc(c.name)}</strong><span>${state.key === "locked" ? "🔒 " : state.key === "adopted" ? "◆ " : ""}${esc(state.text)}</span>${["progress", "queued", "demo", "pending"].includes(state.key) ? `<progress max="100" value="${esc(progress(c.id))}" aria-label="${esc(c.name)} 진척"></progress><small>${esc(fmt(progress(c.id), 1))}%${state.key === "demo" ? " · 효과 도입 전 실증" : ""}</small>` : ""}${c.req?.length ? `<small>↑ ${c.req.map(k => esc(techCard(k)?.name || k)).join(c.id === "mass" ? " 또는 " : " · ")}</small>` : ""}${pair ? `<small>둘 중 하나 · ${esc(techCard(pair.find(k => k !== c.id))?.name)}</small>` : ""}</button>`;
      }).join("")}</section>`).join("")}</div></div>
      <p id="lg-tech-status" class="lg-tech-status" role="status">${esc(L.techError || (L.techPending ? "연구 요청을 확인하는 중이에요." : ""))}</p>${techDetailHTML(V, chosen)}</section>`;
  }
  function techResultHTML(V) {
    const res = V.results?.at(-1), rs = res?.team[L.team]?.research;
    if (!rs) return "";
    const completed = (rs.completed || []).map(techCard).filter(Boolean), eureka = (rs.eurekaNow || []).map(techCard).filter(Boolean);
    const key = `${res.round}:${completed.map(c => c.id).join(",")}`;
    // 같은 결과를 다시 그려도 시작 시각을 보존해 반복해서 뒤집지 않는다.
    // 재생 중 접힌 서랍(U10)에서는 시계를 시작하지 않는다 — 펼쳐 보일 때 뒤집기 연출이 시작되게.
    if (completed.length && L.techReveal?.key !== key && !L.panelFolded) L.techReveal = { key, at: Date.now() };
    const elapsed = L.techReveal?.key === key ? Math.max(0, Date.now() - L.techReveal.at) : 0;
    const animate = completed.length && elapsed < TECH_FLIP_MS;
    return `<section class="lg-tech-results" aria-label="이번 ${V.econ ? "달" : "턴"} 연구 소식">${completed.map(c => `<article class="lg-tech-complete ${animate ? "lg-tech-flip" : ""}" data-tech-completed="${esc(c.id)}"${animate ? ` style="animation-delay:-${esc(elapsed)}ms"` : ""}><p>연구 완료 · 다음 ${V.econ ? "달" : "턴"} 도입</p><h3>${esc(c.name)}</h3><p>${esc(techEffectText(c, V))} · 근거 ${gradeTags(c.evidenceGrade)} · 효과 크기 ${gradeTags(c.effectGrade)}</p><p>${c.fieldCategory === "concentration" ? "켄텍 융합전공" : "켄텍 12대 연구분야"}: ${esc(c.field)}</p></article>`).join("")}${eureka.map(c => `<p class="lg-tech-eureka" role="status">유레카! ${esc(c.name)} 연구가 빨라졌어요 · ${esc(techEurekaText(c.id, V))}</p>`).join("")}</section>`;
  }
  function techErrorText(error) {
    const text = { exclusive: "둘 중 하나만 선택할 수 있어요. 연구 순서를 확인해요.", renewable: `직전 운영의 재생 비중이 ${fmt(techData()?.params.re100Need.v)}% 이상이어야 해요.`, research: "이미 실증·도입한 카드이거나 연구 순서가 올바르지 않아요.", license: "상대 도시의 도입 여부와 공동 연구 여부를 확인해요. 원 개발 도시는 자기 기술을 이전받을 수 없어요.", joint: "공동 연구를 시작할 수 없어요. 양쪽 내부 전력망까지 연결된 연계선, 같은 카드 요청, 상대 도시의 연구 상태를 확인해요.", phase: "지금 단계에서는 연구를 바꿀 수 없어요.", stale: "턴이나 단계가 바뀌었어요. 현재 화면에서 다시 요청해요." };
    if (String(error).startsWith("prerequisite:")) return `${techCard(String(error).split(":")[1])?.name || "이 카드"}의 선행 기술을 먼저 도입해야 해요.`;
    if (String(error).startsWith("budget:")) return `${teamName(String(error).slice(7))} 예산이 모자랍니다. 실증비와 사용료 예약액을 확인해요.`;
    return text[error] || `연구 요청을 처리하지 못했어요 (${String(error)}).`;
  }
  function techClick(e) {
    const card = e.target.closest("[data-tech-card]");
    if (card) { L.techCard = card.dataset.techCard; renderPanel(); return true; }
    const button = e.target.closest("[data-tech-action]");
    if (!button) return false;
    if (button.disabled || lockMsg() || L.techPending) return true;
    const type = button.dataset.techAction, key = button.dataset.card, rs = techResearch(L.snap, L.team);
    const other = document.getElementById(type === "license" ? "lg-tech-donor" : "lg-tech-peer")?.value;
    if (type !== "research" && !other) return true;
    // 미전송 건설 계획을 먼저 보내고, 승인된 rq를 로컬 계획에도 반영한다.
    clearTimeout(L.planT); sendPlan();
    const extra = type === "research" ? { queue: [...(rs.queue || []).filter(k => k !== key), key] } : { other, card: key };
    L.techPending = { type, extra, rev: L.rev, round: L.snap.round, phase: L.snap.phase };
    L.techPeer = type === "joint" ? other : L.techPeer; L.techError = "";
    send(type, extra); renderPanel();
    return true;
  }
  function syncTechQueue(V, me) {
    if (!me || !techData()) return;
    const pending = L.techPending, rs = techResearch(V, L.team), queue = me.plan?.rq || rs.queue || [];
    const accepted = pending && (pending.type === "research" ? JSON.stringify(queue) === JSON.stringify(pending.extra.queue) :
      pending.type === "license" ? !!rs.licensedFrom?.[pending.extra.card] : rs.joint?.[pending.extra.card]?.other === pending.extra.other);
    if (pending && !accepted && (pending.round !== V.round || pending.phase !== V.phase)) {
      L.techPending = null; L.techError = "턴이나 단계가 바뀌었어요. 연구 순서를 확인해요.";
    }
    if (pending && !accepted && L.techPending) return;
    const st = L.away ? L.doc?.maps[L.doc.map] : BG.current();
    if (accepted || me.rev >= L.rev) {
      if (st) st.rq = queue.slice();
      // 승인 대기 중 편집도 새 서버 판본보다 앞서야 다음 plan 요청이 무시되지 않는다.
      const edits = accepted ? Math.max(0, L.rev - pending.rev) : 0;
      L.rev = Math.max(L.rev, me.rev + edits);
      if (accepted) { L.techPending = null; L.techError = "연구 요청이 반영됐어요."; }
      if (edits && !L.away) sendPlan();
    }
  }
  function rankHTML(E, nearby) {
    const rows = E.score?.rank || [], own = rows.findIndex(r => r.id === L.team), prev = E.previousScore?.by || {};
    const leaders = Object.fromEntries(SCORE_KEYS.map(k => [k, Math.max(...rows.map(r => r.parts[k]))]));
    const V = L.S || L.snap, ended = L.snap?.phase === "end" || L.S?.phase === "end";
    let gridShown = false;
    return `<section id="lg-rank" class="lg-sec"><h2>${ended ? "최종 순위" : "도시 순위"} <span class="tag-mine">모형 점수 · ${esc(gradeWords("G"))}</span></h2><div class="lg-rankrows">${rows.map((r, i) => {
      const shown = !nearby || Math.abs(i - own) <= 1, delta = prev[r.id] ? prev[r.id].rank - r.rank : 0;
      // 팀은 다른 도시의 옛 달을 보관하지 않으므로 자기 도시의 합계만 공개한다.
      const grid = ended && shown && (L.role !== "team" || r.id === L.team) ? gridTotal(V, r.id) : null;
      const gridHTML = grid ? `<small data-grid-total>${esc(gridTotalText(V, grid))}</small>` : "";
      if (grid) gridShown = true;
      return `<article class="lg-rankrow" data-team="${esc(r.id)}" data-rank="${esc(r.rank)}" data-me="${r.id === L.team}"><h3>${esc(r.rank)}위 ${shown ? esc(r.name) : `${esc(fmt(r.score, 1))}점(이름 가림)`} <small>${delta ? `${delta > 0 ? "▲" : "▼"}${esc(Math.abs(delta))}` : "–"}</small></h3>${shown ? `${techTitlesHTML(E.cities[r.id].research || {})}<b data-total>${esc(fmt(r.score, 1))}점</b><p>지역 전체의 성장을 빼고 본 변화: 주민 ${esc(signed((E.cities[r.id].pop / E.cities[r.id].pop0 / (E.totals.pop / E.totals.pop0) - 1) * 100, 2))}% · 산업 ${esc(signed((E.cities[r.id].ind / E.cities[r.id].ind0 / (E.totals.ind / E.totals.ind0) - 1) * 100, 2))}%</p><div class="lg-scoreparts">${SCORE_KEYS.map(k => `<div data-part="${k}" data-leader="${r.parts[k] === leaders[k]}"><span>${SCORE_NAMES[k]} ${esc(fmt(r.parts[k], 1))}점 ${r.parts[k] === leaders[k] ? "· 1위(동점 포함)" : ""}</span><meter min="0" max="100" value="${esc(r.parts[k])}" aria-label="${SCORE_NAMES[k]} 부분 점수"></meter>${k === "rel" ? gridHTML : ""}</div>`).join("")}</div>` : ""}</article>`;
    }).join("")}</div>${gridShown ? infoTip("rank-grid-note", `<p class="lg-hint" data-grid-note>${esc(GRID_TOTAL_NOTE())}</p>`, { label: "전력 신뢰 점수" }) : ""}${nearby ? infoTip("rank-names", "내 도시와 바로 위·아래 도시의 이름을 보여 줍니다.", { label: "도시" }) : ""}</section>`;
  }
  // D-80 각주: 끝 순위의 계통 합계 설명은 칸마다 반복하지 않고 순위 아래 한 번만 둔다.
  const GRID_TOTAL_NOTE = () => `전력 신뢰 점수는 바깥 계통에 기댄 만큼 깎지 않아요. 그 전기의 비용은 재정 점수, 배출은 탄소 점수에 이미 들어가 있어요. 계통 수입 상한(매시간 수요의 ${fmt(params("gridImportShare") * 100)}%)과 기준 원가의 ${fmt(params("gridImportMarkup"), 1)}배 할증은 ${gradeWords("G")}이에요.`;
  function tickerHTML(V) {
    const E = V.econ;
    const I = E.intl || {}, exports = EXPORT_KEYS.filter(k => Object.hasOwn(I.export || {}, k)).map(k => I.export[k]), ex = exports.length ? exports.reduce((a, x) => a + x, 0) / exports.length : 1;
    const curtailDef = curtailEvents(V, V.round).map(x => x.E);
    const curtail = curtailDef.length ? `<p class="lg-curtail-news">출력제어: 남는 재생 전기를 버렸어요 — 저장·연계선이 있으면 덜 버립니다 <small>현상 <span class="tag-official">${esc(gradeWords([...new Set(curtailDef.map(e => e?.grade || "G"))].join("·")))}</span></small></p>${infoTip("curtail-news-grade", `크기·대응 <span class="tag-mine">${esc(gradeWords("G"))}</span>`, { label: "출력제어" })}` : "";
    return `<section id="lg-ticker" class="lg-ticker" aria-label="국제 지수와 뉴스"><div class="lg-indices">${[["lng", "LNG", I.lng], ["fx", "환율", I.fx], ["export", "수출(부문 평균)", ex], ["ship", "해운", I.ship]].map(([k, name, v]) => `<span data-index="${k}" data-direction="${v >= 1 ? "up" : "down"}">${name} ${esc(fmt(v, 2))} ${v >= 1 ? "▲" : "▼"}</span>`).join("")}</div>${infoTip("indices-basis", `1 = 2026년 수준 · 가상 변동(${esc(gradeWords("G"))})`, { label: "국제 지수" })}${curtail}${techNewsHTML(V)}${(E.intlActive || []).map(x => { const event = KCP.ECON_DATA.intl.events.find(e => e.id === x.id) || x; return x.id === "cbam" && !event.text ? "" : x.id === "cbam" ? `<div class="lg-info-line">${esc(event.name || x.id)}${infoTip("cbam", esc(event.text), { label: event.name || x.id })}</div>` : `<p>${esc(event.name || x.id)}</p>`; }).join("")}${(E.report?.news || []).slice(0, IQ.quarter).map(x => `<p>${esc(x)}</p>`).join("")}</section>`;
  }
  function criterionDraft(V) {
    const { n } = monthNote(), firstYear = curRound().year === C.roundsOf(V)[0].year;
    const crit = n.crit || V.teams[L.team].crit || { chips: [], line: IQ.line, choice: "keep" };
    // 새해 1월에는 지난해 유지/바꾸기 선택을 이어받지 않는다.
    return { chips: crit.chips.slice(), line: crit.line, choice: curRound().month === 1 && !firstYear && !n.crit ? null : crit.choice };
  }
  const validCritLine = value => Number.isInteger(value) && value >= 0 && value <= 100;
  function queueCrit(crit) {
    L.pendingCrit = validCritLine(crit.line) && crit.chips.length && crit.choice
      ? { chips: crit.chips.slice(), line: crit.line, choice: crit.choice, rid: L.reqSeq = (L.reqSeq || 0) + 1 } : null;
  }
  const readyAllowed = V => V && V.phase !== "end" && V.phase !== "run" &&
    (!V.econ || L.role === "solo" || V.phase === "plan" || V.phase === "lobby");
  function critHTML(V) {
    if (V.phase !== "plan" || curRound().month !== 1) return "";
    const crit = criterionDraft(V), { n } = monthNote(), firstYear = curRound().year === C.roundsOf(V)[0].year;
    return `<section id="lg-crit" class="lg-sec"><div class="lg-info-line"><h3>${L.role === "solo" ? "내 기준" : "우리 기준"}</h3>${infoTip("criteria-guide", "도시가 가장 지키고 싶은 항목 1~2개를 골라요. 첫 항목의 부분 점수를 지킬 선으로 둬요.", { label: "지킬 선" })}</div><div class="lg-acts">${SCORE_KEYS.map(k => [k, SCORE_NAMES[k]]).map(([k, name]) => `<button type="button" class="v2-btn" data-crit="${k}" aria-pressed="${crit.chips.includes(k)}">${name}</button>`).join("")}</div><label class="lg-field">${esc(SCORE_NAMES[crit.chips[0]] || "선택 첫 항목")} 지킬 선(점 이상)<input id="lg-crit-line" type="number" min="0" max="100" value="${esc(validCritLine(crit.line) ? crit.line : "")}"></label>${firstYear ? "" : `<div class="lg-acts"><button class="v2-btn" type="button" data-crit-choice="keep" aria-pressed="${crit.choice === "keep"}">유지</button><button class="v2-btn" type="button" data-crit-choice="change" aria-pressed="${crit.choice === "change"}">바꾸기</button></div>`}<label class="lg-jq">이유 한 줄(기기에만)<textarea data-note="critReason" rows="2" maxlength="1000">${esc(n.critReason || "")}</textarea></label><p class="lg-hint">정해진 항목·숫자·유지/바꿈만 진행자에게 보냅니다. 고르지 않으면 기준 미선택으로 둬요.</p></section>`;
  }
  const EVIDENCE_STEP = params("promiseEvidenceStep"); // 기기 안 비교 눈금(G)
  const EVIDENCE_RULE = `고른 근거는 저녁 수요 ${EVIDENCE_STEP.evening * 100}%·LNG ${EVIDENCE_STEP.fuel * 100}%, 접속 여유 ${EVIDENCE_STEP.grid * 100}%·풍속 ${EVIDENCE_STEP.wind * 100}% 이상 바뀌면 변화로 봐요(${gradeWords("G")}). 이웃 정전은 이전 값의 ${EVIDENCE_STEP.neighbor * 100}%와 ${EVIDENCE_STEP.neighborFloor}%p 중 큰 값 이상 바뀌어야 해요. 그보다 작으면 비교하지 않아요.`;
  // 근거 접속 여유와 지도 칩의 기준 차이. S1 카드와 S4 약속 기준이 같은 문장을 쓴다.
  const EVIDENCE_GRID_BASIS = "근거의 접속 여유는 이번 달 새 접속을 처리하기 전 값이고, 지도 칩은 지금 배치에 이번 달 접속 처리까지 반영한 값이라 다를 수 있어요.";
  const EVIDENCE_NAMES = { evening: "저녁 수요", grid: "접속 여유", fuel: "LNG 지수", wind: `풍속(계절 대표값·높이 환산, ${gradeWords("G")})`, neighbor: "이웃 정전" };
  const direction = x => { const rounded = Math.abs(x) < params("promiseSameDelta") ? 0 : Number(x.toFixed(params("promiseDirectionDigits"))); return rounded > 0 ? "up" : rounded < 0 ? "down" : "same"; };
  const PREDICTION_RULE = `같을 것: 정전 변화는 ±${params("promiseSameDelta")}%p 미만, 현금 변화는 ±${params("promiseSameDelta")}억 미만(게임 비교 기준).`;
  // 계통 주제는 문턱이 기준 크기에 따라 달라 상수에서 문장을 만든다.
  const predictionRule = topic => topic === "grid" ? `같을 것: 계통에 기댄 전기의 하루 평균 변화가 ${GRID_SAME_MWH_PER_DAY} MWh/일과 기준 하루 평균의 ${GRID_SAME_SHARE_PER_DAY * 100}% 중 큰 값 이하(게임 비교 기준). 판정은 표시 반올림 전 값으로 해요.` : PREDICTION_RULE;
  const DIRECTION_NAMES = { up: "늘 것", down: "줄 것", same: "같을 것" };
  function windForecast() {
    const climate = BG.PACKS[C.teamDef(R(), L.team).pack]?.climate;
    const month = BG.SEASONS.find(s => s.id === curRound().season)?.m;
    const n = climate?.wind10_land?.[month];
    return Number.isFinite(n) ? n * (climate.hub_factor_land || 1) : null;
  }
  function evidenceOptions(V) {
    const c = V.econ.cities[L.team], grid = c.grid || V.grid?.[L.team];
    const neighbors = new Set(R().ties.filter(t => t.a === L.team || t.b === L.team).map(t => t.a === L.team ? t.b : t.a));
    const other = actT(V).filter(t => neighbors.has(t.id)).sort((a, b) => (V.results.at(-1)?.team[b.id]?.unsPct || 0) - (V.results.at(-1)?.team[a.id]?.unsPct || 0))[0];
    const pol = Object.fromEntries((BG.current()?.policies || []).map(k => [k, true]));
    // build.demand의 저녁 창(18–22시) 시작 시각. 새 계수가 아니라 기존 모형의 시간 좌표다.
    const day = { hot: false, winter: curRound().season === "winter", m: curRound().month };
    const evening = BG.TOWNS.reduce((sum, w, ti) => sum + BG.demand(ti, 18, day, pol, BG.current()?.fab2) * (/^(factory_big|industry|port)$/.test(w.kind) ? c.ind / c.ind0 : c.pop / c.pop0), 0);
    const lng = V.econ.intl?.lng, wind = windForecast();
    return [
      { key: "evening", text: `${EVIDENCE_NAMES.evening}: ${fmt(evening, 2)} MW`, value: evening },
      { key: "wind", text: `${EVIDENCE_NAMES.wind}: ${fmt(wind, 2)} m/s`, value: wind },
      // 공개 상태의 grid는 진행자가 refreshGrid(advance=false)로 만든 값: 이번 달 새 접속을 처리하기 전(지난달까지 접속된 몫).
      // 지도 칩(build leagueGrid → trialGrid)은 gridStatus(…, true)로 이번 달 접속 처리까지 반영해 다를 수 있다(접속 처리로 작아지고, 계획 중 ESS·연계선을 더하면 커질 수 있다). 달마다 같은 시점끼리 비교하려고 근거는 처리 전 값을 쓴다.
      { key: "grid", text: `${EVIDENCE_NAMES.grid}: ${fmt(grid?.headroomMW, 2)} MW`, value: grid?.headroomMW },
      { key: "fuel", text: `${EVIDENCE_NAMES.fuel}: ${fmt(lng, 2)}`, value: lng },
      { key: "neighbor", neighborId: other?.id, text: `${other ? teamName(other.id) + " · " : ""}${EVIDENCE_NAMES.neighbor}: ${fmt(V.results.at(-1)?.team[other?.id]?.unsPct, 2)}%`, value: V.results.at(-1)?.team[other?.id]?.unsPct }
    ];
  }
  // 6차 녹화 N1: 근거 기준값 = 계획 시작 때 값(D-82 각주 예정)
  const evidenceUnit = key => ({ evening: " MW", wind: " m/s", grid: " MW", fuel: "", neighbor: "%" })[key] || "";
  function evidenceAtStart(item, n) {
    if (!n.s1EvidenceValues) return item;
    const value = n.s1EvidenceValues[item.key];
    const neighborId = item.key === "neighbor" ? n.s1EvidenceNeighborId : item.neighborId;
    const name = `${item.key === "neighbor" && neighborId ? teamName(neighborId) + " · " : ""}${EVIDENCE_NAMES[item.key]}`;
    return { ...item, value, text: `${name}: ${fmt(value, 2)}${evidenceUnit(item.key)}`,
      ...(item.key === "neighbor" ? { neighborId } : {}) };
  }
  function evidenceComparisonValues(n, previous) {
    const key = n.evidence?.key;
    const value = n.s1EvidenceValues ? n.s1EvidenceValues[key] : n.evidence?.value;
    let before = previous?.s1EvidenceValues ? previous.s1EvidenceValues[key] :
      previous?.evidenceValues?.[key] ?? (key && previous?.evidence?.key === key ? previous.evidence.value : null);
    if (key === "neighbor" && n.s1EvidenceValues && previous?.s1EvidenceValues &&
        (!n.s1EvidenceNeighborId || n.s1EvidenceNeighborId !== previous.s1EvidenceNeighborId)) before = null;
    return { value, before };
  }
  function evidenceNowHTML(n, stage, nowValue = n.evidence?.nowValue ?? n.evidence?.value) {
    const key = n.evidence?.key, start = n.s1EvidenceValues?.[key];
    if (!Number.isFinite(start) || !Number.isFinite(nowValue) || fmt(start, 2) === fmt(nowValue, 2)) return "";
    const tail = { s4: "지금", s6: "약속 때", s7: "약속 때" }[stage];
    const rule = { s4: "시작 값으로 비교", s6: "달마다 시작 값끼리 비교", s7: "원인 연결은 시작 값 기준" }[stage];
    return `<p id="lg-evidence-now-${stage}" class="lg-hint">${esc(`계획 시작(S1) ${fmt(start, 2)} → ${tail} ${fmt(nowValue, 2)}${evidenceUnit(key)}(계획 변경·${rule})`)}</p>`;
  }
  function firstStrategy(V) { return !(V.results || []).length; }
  function evidenceFocus(V) {
    if (!V.econ || V.phase !== "plan" || L.away || !BG.current()) return null;
    const events = (V.events || []).filter(ev => ev.round === V.round).map(ev => C.eventDef(R(), ev.id)).filter(Boolean);
    if (!events.length || events.some(ev => C.hits(R(), ev, L.team) && ev.opts?.length)) return null;
    const months = tdata().interview?.months, old = months?.[V.round - 1], previous = old?.s1EvidenceValues;
    const n = months?.[V.round], current = n?.s1EvidenceValues;
    if (!previous || !current) return null;
    const options = Object.entries(current).map(([key, value]) => ({ key, value, text: EVIDENCE_NAMES[key],
      neighborId: key === "neighbor" ? n.s1EvidenceNeighborId : null }));
    const candidates = options.filter(x => Number.isFinite(x.value) && Number.isFinite(previous[x.key]) &&
      (x.key !== "neighbor" || x.neighborId && x.neighborId === old.s1EvidenceNeighborId)).map(x => {
      const before = previous[x.key], delta = x.value - before;
      const ratio = before !== 0 ? delta / Math.abs(before) : null;
      return { ...x, before, delta, ratio, size: before === 0 ? delta === 0 ? 0 : Infinity : Math.abs(ratio) };
    }).sort((a, b) => b.size - a.size);
    const candidate = candidates[0];
    if (!candidate) return null;
    const unit = { evening: " MW", wind: " m/s", grid: " MW", fuel: "", neighbor: "%" }[candidate.key];
    const name = candidate.key === "neighbor" ? `${teamName(candidate.neighborId)} · ${EVIDENCE_NAMES.neighbor}` : EVIDENCE_NAMES[candidate.key];
    const shortName = candidate.key === "wind" ? "풍속" : EVIDENCE_NAMES[candidate.key];
    const unchanged = candidates.every(x => x.delta === 0);
    const change = unchanged ? "지난달과 같음" : `${fmt(candidate.before, 2)} → ${fmt(candidate.value, 2)}${unit}${candidate.key === "neighbor" ? ` · ${signed(candidate.delta, 2)}%p` : candidate.ratio === null ? "(지난달은 0)" : ` · ${signed(candidate.ratio * 100, 2)}%`}`;
    return { ...candidate, name, shortName, unchanged, text: `이번 달 볼 것 · ${name}: ${fmt(candidate.value, 2)}${unit} · ${unchanged ? change : `지난달 대비 ${change}`}` };
  }
  function rememberEvidenceValues(V) {
    if (!V.econ || V.phase !== "plan" || L.away || !BG.current()) return;
    const { d, n } = monthNote();
    if (n.s1EvidenceValues) return;
    const options = evidenceOptions(V).filter(x => Number.isFinite(x.value));
    n.s1EvidenceValues = Object.fromEntries(options.map(x => [x.key, x.value]));
    n.s1HasWind = (BG.current().builds || []).some(b => ["wind", "offshore"].includes(b.t));
    n.s1EvidenceNeighborId = options.find(x => x.key === "neighbor")?.neighborId || null;
    putData(d);
  }
  // S1 후보는 기기 안의 계획 시작 값과 지난달 S7만 읽는다. 공개 상태에는 넣지 않는다.
  function evidenceCandidates(V) {
    if (!V?.econ || V.phase !== "plan" || L.away || !["team", "solo"].includes(L.role) || !BG.current()) return null;
    const events = (V.events || []).filter(ev => ev.round === V.round).map(ev => C.eventDef(R(), ev.id)).filter(Boolean);
    if (events.some(ev => C.hits(R(), ev, L.team) && ev.opts?.length)) return null;
    const months = tdata().interview?.months, old = months?.[V.round - 1], n = months?.[V.round];
    const previous = old?.s1EvidenceValues, current = n?.s1EvidenceValues;
    const hasWind = typeof n?.s1HasWind === "boolean" ? n.s1HasWind : (BG.current().builds || []).some(b => ["wind", "offshore"].includes(b.t));
    const frozen = old?.outageFrozen, carry = old?.missedCarry;
    const growthCandidate = frozen ? !!frozen.parts && outageCardCandidates(frozen.parts, frozen).some(p => p.key === "growth") :
      carry?.largest?.key === "growth" && Math.abs(carry.largest.value) >= outageMinPart(carry);
    const includeFuel = growthCandidate || V.econ.cities[L.team].cash < 0;
    const allOptions = evidenceOptions(V).map(x => {
      const value = current ? current[x.key] : x.value;
      const neighborId = current ? n.s1EvidenceNeighborId : x.neighborId;
      const before = x.key !== "neighbor" || neighborId && neighborId === old?.s1EvidenceNeighborId ? previous?.[x.key] : undefined;
      const delta = value - before, ratio = before !== 0 ? delta / Math.abs(before) : null;
      const shortName = x.key === "wind" ? "풍속" : EVIDENCE_NAMES[x.key];
      const name = x.key === "neighbor" && neighborId ? `${teamName(neighborId)} · ${shortName}` : shortName;
      const unit = { evening: " MW", wind: " m/s", grid: " MW", fuel: "", neighbor: "%" }[x.key];
      // 이웃이 바뀐 달은 값이 없는 것이 아니라 다른 도시 값이므로 따로 밝힌다.
      const otherNeighbor = x.key === "neighbor" && neighborId && old?.s1EvidenceNeighborId && neighborId !== old.s1EvidenceNeighborId ? old.s1EvidenceNeighborId : null;
      return { key: x.key, value, before, delta, ratio, shortName, name, unit, otherNeighbor,
        text: `${name}: ${fmt(value, 2)}${unit}`,
        size: before === 0 ? delta === 0 ? 0 : Infinity : Math.abs(ratio) };
    }).filter(x => Number.isFinite(x.value));
    const options = allOptions.filter(x => x.key !== "wind" || hasWind);
    const picked = new Map();
    const add = (item, tag) => { if (item && picked.size < 3 && !picked.has(item.key)) picked.set(item.key, { ...item, tag }); };
    // signed와 같은 두 자리 반올림으로 판정하며, -0도 0으로 본다.
    const noVisibleChange = x => x.delta === 0 || Number((x.key === "neighbor" ? x.delta : x.ratio === null ? x.value : x.ratio * 100).toFixed(2)) === 0;
    const changeTag = x => !Number.isFinite(x.before) ? "" : noVisibleChange(x) ? "지난달과 같음" : x.key === "neighbor" ? `지난달보다 ${signed(x.delta, 2)}%p` : x.ratio === null ? "지난달 0에서 바뀜" : `지난달보다 ${signed(x.ratio * 100, 2)}%`;
    // 1. 변화율 절댓값: 0에서 새 변화 우선, 동률은 기존 근거 목록 순서. 이웃은 같은 도시만 비교.
    const changed = options.filter(x => Number.isFinite(x.before)).sort((a, b) => b.size - a.size);
    if (changed.length) add(changed[0], changeTag(changed[0]));
    // 2. 지난달 S7의 가장 큰 몫과 연결된 근거(없으면 건너뜀).
    // 새 문턱으로 다시 읽어 '뚜렷한 원인 없음'인 옛 기록은 일지·지난달 줄과 같게 잇지 않는다.
    const largest = old && outageNoCause(old) ? null : old?.outageLargest || old?.missedCarry?.largest;
    // 사건은 장마·석탄 상한처럼 저녁 수요와 무관한 경우가 많아 잇지 않는다(검토 지적).
    const linked = { weather: "evening", progress: "grid", choice: "grid", trade: "neighbor", growth: "fuel" }[largest?.key];
    add(options.find(x => x.key === linked), `지난달 가장 큰 몫(${outageNames(old?.outageFrozen || old?.missedCarry || { basis: old?.missedBasis })[largest?.key] || ""})과 이어짐`);
    // 3. 접속 여부와 무관하게 계획에 풍력이 있을 때만 풍속을 넣는다.
    add(options.find(x => x.key === "wind"), "계절 대표값");
    // 4. 지난달 성장 몫이 S7 카드 후보였거나 이번 달 현금 주제일 때 LNG 지수를 넣는다.
    if (includeFuel) add(options.find(x => x.key === "fuel"), "국제 지수");
    // 5. 변화율 순서로 채우되, 보이는 변화 0·지난달 값 없음은 최소 두 후보 보충에만 쓴다.
    const remaining = [...changed, ...options.filter(x => !Number.isFinite(x.before))];
    const skipped = [], missing = [];
    for (const item of remaining) {
      if (picked.size >= 3) break;
      if (picked.has(item.key) || item.key === "fuel" && !includeFuel) continue;
      // 지난달 연결 근거는 2단계에서 이미 골랐다. 보이는 변화가 없으면 최소 두 후보가 필요할 때만 보충한다.
      if (!Number.isFinite(item.before)) { missing.push(item); continue; }
      if (noVisibleChange(item)) { skipped.push(item); continue; }
      add(item, changeTag(item));
    }
    for (const item of [...skipped, ...missing]) {
      if (picked.size >= 2) break;
      add(item, changeTag(item));
    }
    // 6. 옛 기록도 이미 고른 근거는 유지한다. 규칙상 마지막 우선순위 후보를 빼고 최대 세 개로 둔다.
    const selected = allOptions.find(x => x.key === n?.s1Pick);
    if (selected && !picked.has(selected.key)) {
      if (picked.size >= 3) picked.delete([...picked.keys()].at(-1));
      add(selected, changeTag(selected));
    }
    // 반환/화면 순서는 evidenceOptions의 고정 순서다.
    return allOptions.filter(x => picked.has(x.key)).map(x => picked.get(x.key));
  }
  const s1Narrow = typeof matchMedia === "function" ? matchMedia("(max-width: 760px)") : null;
  // 옛 iPad Safari(iOS 14 전)의 MediaQueryList에는 addEventListener가 없어 addListener로 받는다.
  const s1NarrowChange = e => {
    const fold = document.getElementById("lg-s1-more");
    if (fold) fold.open = !e.matches;
  };
  if (typeof s1Narrow?.addEventListener === "function") s1Narrow.addEventListener("change", s1NarrowChange);
  else if (typeof s1Narrow?.addListener === "function") s1Narrow.addListener(s1NarrowChange);
  function evidenceFocusHTML(V) {
    const candidates = evidenceCandidates(V);
    if (!candidates) return "";
    const pick = tdata().interview?.months?.[V.round]?.s1Pick;
    const selected = candidates.find(x => x.key === pick);
    const conditions = (V.events || []).filter(ev => ev.round === V.round).map(ev => C.eventDef(R(), ev.id))
      .filter(ev => ev && C.hits(R(), ev, L.team) && !ev.opts?.length);
    const card = x => `<button type="button" id="lg-s1-${x.key}" class="lg-s1-card" data-s1-pick="${x.key}" aria-pressed="${selected?.key === x.key}"${x.key === "grid" ? ' aria-describedby="lg-s1-grid-basis"' : ""}><strong>${esc(x.name)} · ${esc(fmt(x.value, 2) + x.unit)}</strong><small>${Number.isFinite(x.before) ? `지난달 ${esc(fmt(x.before, 2))} → ${esc(fmt(x.value, 2) + x.unit)}` : x.otherNeighbor ? `지난달은 다른 이웃(${esc(teamName(x.otherNeighbor))})` : "지난달 값 없음"}</small>${x.tag ? `<span class="lg-s1-tag">${esc(x.tag)}</span>` : ""}</button>`;
    return `<section id="lg-evidence-focus" class="lg-sec">${conditions.length ? `<p class="lg-s1-condition">이번 달 조건 · ${conditions.map(ev => `${esc(ev.name)}: ${esc(turnText(ev.id === "finedust_coal_cap" ? "계절관리제 시행으로 석탄발전 출력을 제한해요." : ev.text || "", V))}`).join(" · ")}</p>` : ""}<h3>이번 달 볼 것 · 근거 후보 ${candidates.length}개</h3><div class="lg-s1-cards" role="group" aria-label="근거 후보">${candidates.map((x, i) => candidates.length === 3 && i === 2 ? `<details id="lg-s1-more" class="lg-s1-fold lg-out-fold" data-wide-open${wideOpen()}><summary>후보 하나 더</summary>${card(x)}</details>` : card(x)).join("")}</div>${candidates.some(x => x.key === "grid") ? `<p id="lg-s1-grid-basis" class="lg-hint">${EVIDENCE_GRID_BASIS}</p>` : ""}${tipBox("s1-evidence-guide", "대응을 고를 사건이 없는 달이에요.", "<p> 이번 달에 눈여겨볼 근거 하나를 골라요. 고른 근거는 약속의 '근거 하나'에 미리 표시돼요.</p>")}<p class="lg-hint"> 이 값 하나가 원인이라는 뜻은 아니에요.</p><button type="button" class="v2-btn lg-s1-promise" data-hud-panel="journal" ${selected ? "" : "disabled"}>${selected ? `${esc(withParticle(selected.shortName, "으로"))} 약속하기` : "근거를 하나 고르면 약속으로 이어져요"}</button></section>`;
  }
  function needsLoop(V) { return !!V.econ && V.phase === "plan"; }
  function needsExplanation(V) { return firstStrategy(V) || largeDecision(); }
  const LEARNING_WORDS = ["정전", "CO₂", "CO2", "현금", "사건", "날씨", "민원", "접속", "거래", "수요", "풍속", "LNG", "탄소", "배출", "지지", "주민", "폭염", "한파", "부족", "피크", "출력제어", "연계선", "연료", "성장", "공사", "기술", "계통"];
  const LEARNING_RULE = "판정: 근거·예측·비교·이유를 마친 뒤, 고치겠다면 다음 달 계획을 실제로 바꾸고, 유지하겠다면 지난달 결과 숫자나 원인을 들어 계획을 유지해야 달성해요(기기에만).";
  const LEARNING_TITLE = `숫자는 0이 아닌 지난달 결과와 같은 값에 단위(%p·%·t/일·t·억·시간·MWh/일·MWh·MW)가 필요해요. 원인 단어: ${LEARNING_WORDS.join("·")}`;
  const learningRuleHTML = (foldRule = false) => {
    const detail = `<p>${esc(LEARNING_TITLE)}</p><p>다음 달 계획을 확정한 뒤 말과 실제 변경을 비교해요. 마지막 달은 판정하지 않아요.</p>`;
    return foldRule ? `<p class="lg-hint">${LEARNING_RULE}</p>` + tipBox("learning-plan-rule", "판정 상세 보기", detail).replace('class="lg-tipbox lg-out-fold"', 'class="lg-learning-details lg-tipbox lg-out-fold"')
      : `<p class="lg-hint">${LEARNING_RULE}</p><details class="lg-learning-details"><summary>판정 상세 보기</summary>${detail}</details>`;
  };
  const legacyLearningNote = n => !!n && ["operatingPlan", "followingPlanChanged", "resultNumbers"].every(k => !Object.hasOwn(n, k));
  function learningVerdict(n, currentPlan = false) {
    if (legacyLearningNote(n)) return "legacy";
    if (n.finalMonth) return "final";
    if (n.followingPlanChanged == null || !currentPlan && !["ready", "result"].includes(n.followingPlanBasis)) return "pending";
    const reason = n.askReason?.trim() || "";
    const values = [...reason.replaceAll(",", "").replaceAll("\u2212", "-").matchAll(/(?:^|[^\d.\w+-])([+-]?\d+(?:\.\d+)?)\s*(?:%p|%|t\/일|t|억|시간|MWh\/일|MWh|MW)(?![A-Za-z])/g)];
    const cited = LEARNING_WORDS.some(word => reason.toLowerCase().includes(word.toLowerCase())) ||
      values.some(([, value]) => Number(value) !== 0 && n.resultNumbers?.some(result => Number(result) === Number(value)));
    const complete = !n.skipped && !!n.evidence && !!n.pred?.[n.topic || "uns"] && !!n.compared && !!reason &&
      (n.answer === "revise" && n.followingPlanChanged === true || n.answer === "keep" && n.followingPlanChanged === false && cited);
    if (complete) return "achieved";
    if (n.answer === "keep" && n.followingPlanChanged === true || n.answer === "revise" && n.followingPlanChanged === false) return "mismatch";
    if (n.answer === "keep" && !cited) return "uncited";
    if (!["keep", "revise"].includes(n.answer)) return "unanswered";
    return "incomplete";
  }
  function learningStatus(n, detail = false, currentPlan = false) {
    const verdict = learningVerdict(n, currentPlan);
    if (verdict === "legacy") return currentPlan ? "옛 기준 기록이라 판정하지 않아요" : "판정 기록 없음(옛 기준)";
    if (verdict === "final") return "마지막 달이라 판정 없음";
    if (verdict === "pending") return currentPlan && !n.operatingPlan ? "지난달 운영 기록이 이 기기에 없어 판정하지 않아요" : "다음 달 계획에서 확인해요";
    if (verdict === "achieved") return "달성";
    if (currentPlan) {
      if (verdict === "mismatch") return n.answer === "revise" ? "아직 바꾸지 않았어요" : "말과 지금 계획이 달라요 — 유지하겠다고 했어요";
      if (verdict === "uncited") return "미달성 예정 · 지난달 이유에 결과 숫자나 원인이 없어요";
      if (verdict === "unanswered") return "미달성 예정 · 지난달 유지·수정 답을 고르지 않았어요";
      return "미달성 예정 · 지난달 근거·예측·비교·이유 기록이 부족해요";
    }
    return `미달성${verdict === "mismatch" ? " · 말과 실제 변경이 달라요" : detail ? " · 다음 달 변경 또는 결과를 인용한 유지 이유를 확인해요" : ""}`;
  }
  const CONFIDENCE = { half: ["반반", params("promiseConfidence").half], fairly: ["꽤", params("promiseConfidence").fairly], sure: ["확실", params("promiseConfidence").sure] };
  const MISS_NAMES = { weather: "날씨·운전 기간", trade: "이웃 거래", grid: "접속 대기", event: "사건·대응", choice: "내 선택", progress: "접속·공사·기술 진행", growth: "도시 성장·연료 값", gridImport: "계통 수입" };
  const OUT_NAMES = { choice: MISS_NAMES.choice, weather: MISS_NAMES.weather, event: MISS_NAMES.event, trade: MISS_NAMES.trade, progress: MISS_NAMES.progress, growth: MISS_NAMES.growth, gridImport: MISS_NAMES.gridImport };
  const outageNames = a => a?.basis === "monthly" ? { ...OUT_NAMES, weather: "날씨·계절·운전 기간" } : OUT_NAMES;
  // S7 전용: 끝자리 0을 유지하고, 반올림된 0에는 부호를 붙이지 않는다.
  const outageNumber = (x, sign = false) => {
    if (!Number.isFinite(x)) return "–";
    const rounded = Number(Number(x).toFixed(2)) + 0;
    return `${rounded < 0 ? "−" : sign && rounded > 0 ? "+" : ""}${Math.abs(rounded).toFixed(2)}`;
  };
  const outageUnit = (a, level = false) => a?.target === "grid" ? a.unit || "MWh" : level ? "%" : "%p";
  const outageGridRounded = x => Number(x.toFixed(1)) + 0;
  const outageLegacyGrid = a => a?.target === "grid" && a.unit !== "MWh/일";
  const outageValue = (x, unit, sign = false) => {
    if (unit !== "MWh" && unit !== "MWh/일") return `${outageNumber(x, sign)}${unit}`;
    if (!Number.isFinite(x)) return `– ${unit}`;
    const rounded = outageGridRounded(x);
    return `${rounded < 0 ? "−" : sign && rounded > 0 ? "+" : ""}${Math.abs(rounded).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
  };
  // D-82: 하루 평균(MWh/일) 기록의 비용은 하루치이므로 '억/일'로 적는다. 옛 월 합계 기록은 '억'.
  const outageCost = (x, a, compact = false) => a?.target === "grid" ? `${compact ? ", 비용 " : " (비용 "}${outageNumber(x * params("normalCost") * params("gridImportMarkup"), true)}억${a.unit === "MWh/일" ? "/일" : ""}${compact ? "" : ")"}` : "";
  function outageLimitText(value, unit) {
    const scale = unit === "MWh" || unit === "MWh/일" ? 10 : 100;
    const magnitude = Math.abs(value), rounded = Number(magnitude.toFixed(scale === 10 ? 1 : 2));
    // 문턱을 표시 눈금에서 올림하고 문장은 '이하'로 쓴다: 문턱 미만 몫 x는 반올림 표시값 ≤ 올림(x) ≤ 올림(문턱)이라
    // 화면의 '+0.2'와 '0.2 … 이하'가 서로 어긋나지 않는다(6차 녹화 N2).
    // 먼저 같은 표시 눈금으로 반올림하면 0.07 * 100 같은 부동소수 곱셈의 불필요한 올림을 피한다.
    return outageValue(rounded < magnitude ? rounded + 1 / scale : rounded, unit);
  }
  // 재현 차이를 보일 최소 크기: 표시 자릿수의 절반(정전 0.005%p, 계통 0.05 MWh/일).
  const outageReplayShown = (a, x) => Number.isFinite(x) && Math.abs(x) >= (a?.target === "grid" ? params("outageReplayGridMin") : params("outageReplayUnsMin"));
  // D-82 총괄 결정: 계통 최소 몫은 '같음' 문턱을 나눈 값과 표시 눈금의 절반 중 큰 값(기본값 1/10·0.05 MWh/일).
  const OUTAGE_MIN_GRID_PART_PER_DAY = params("outageMinGridPartPerDay");
  const outageMinPart = a => a?.target === "grid" ? Math.max(gridSameTolPerDay(a.trial ?? a.base) / params("outageMinPartDivisor"), OUTAGE_MIN_GRID_PART_PER_DAY) : params("outageMinUnsPart");
  // fcc5e80 혼자 12달(평택·고정) 측정: r=0 고르는 달 8·작은 카드 8달, 5% 고르는 달 6·작은 카드 1달(8월 growth +0.31 = Δ의 5.8%), 10% 고르는 달 4 — 총괄 결정 5%(D-82 각주).
  function outageCardMin(a) {
    const min = outageMinPart(a);
    const total = a?.total ?? (a?.actual - (a?.trial ?? a?.base));
    return Number.isFinite(total) ? Math.max(min, params("outageCardShareMin") * Math.abs(total)) : min;
  }
  // 직접: 해당 물리 입력을 바꾸는 단계. 같은 단계: 함께 바뀌지만 해당 근거만의 효과는 아니다.
  // 간접: 비용·다른 수요·이웃 조건을 통한 관련성만 있다.
  // 연료 배수는 급전 한계비용을 바꾼다. 고립 정전 효과가 보장되지 않으므로 growth도 간접이다.
  const OUTAGE_EVIDENCE_LINKS = {
    evening:  { choice: "stage", weather: "direct", event: "direct", growth: "direct" },
    wind:     { weather: "direct", event: "direct" },
    grid:     { choice: "direct", progress: "direct" },
    fuel:     { event: "indirect", growth: "indirect" },
    neighbor: { progress: "indirect", trade: "direct" }
  };
  const outageCardCandidates = (parts, a) => [...parts].filter(p => Math.abs(p.value) >= outageCardMin(a))
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, params("outageCardCount"));
  function outagePartRanking(a) {
    const ranked = [...(a?.parts || [])].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    const min = outageCardMin(a);
    const largest = ranked[0] && Math.abs(ranked[0].value) >= min ? ranked[0] : null;
    // 대상의 표시 자릿수(정전 0.01, 계통 0.1)에서 크기가 같은 몫은 모두 가장 큰 몫으로 보인다. 저장하는 largest는 첫 몫 하나 그대로.
    const shown = p => a?.target === "grid" ? Math.abs(Number(p.value.toFixed(params("outageRankingDigits").grid))) : Number(Math.abs(p.value).toFixed(params("outageRankingDigits").uns));
    const tied = largest ? ranked.filter(p => Math.abs(p.value) >= min && shown(p) === shown(largest)).map(p => p.key) : [];
    return { ranked, largest, tied };
  }
  function outageCardState(a, n) {
    const { ranked, largest, tied } = outagePartRanking(a);
    const selected = a?.parts?.find(p => p.key === n.missed);
    // 대체 버튼으로 고른 작은 몫도 고정본에 남아 있으면 화면·붙이기·일지에서 같은 선택으로 읽는다.
    // 계통 대상은 단서 문구만 바꾼 사본(outageTargetClues)으로 그리므로 그 원본도 같은 고정본으로 본다.
    const frozenPicked = !!a && (a === n.outageFrozen || !!n.outageFrozen && OUTAGE_CLUE_SOURCE.get(a) === n.outageFrozen) && !!selected;
    const single = !frozenPicked && (a?.parts ? ranked.slice(1).every(p => Math.abs(p.value) < outageCardMin(a)) : !!n.outageSingleShown);
    return { selected, frozenPicked, largest, tied, single, opened: !!n.outageOpened || frozenPicked || single };
  }
  const outageGridVisible = a => a.grid?.waitingMW > 0 && Number.isFinite(a.grid.value) && Math.abs(a.grid.value) >= outageMinPart(a);
  // 게임 가정: 수요 전력의 5% 이상을 못 보내면 지속적인 공급 부족을 다시 살펴보게 한다.
  // S7 안내용 정전율(%) 기준이며, 차이의 몫 문턱(outageMinPart)·점수·정전 판정은 바꾸지 않는다.
  const OUTAGE_HIGH_PCT = params("outageHighPct");
  const outageHigh = x => Number.isFinite(x) && Number(x.toFixed(params("outageHighDigits"))) >= OUTAGE_HIGH_PCT;
  const outageBothHigh = a => a?.target !== "grid" && [a?.trial, a?.actual].every(outageHigh);
  const outageNoCauseLabel = a => outageBothHigh(a) ? "차이 원인 없음(정전 자체는 큼)" : "뚜렷한 원인 없음";
  function recordedOutageNoCauseLabel(n) {
    // 이미 붙인 옛 문자열도 그대로 읽는다. 새 기록은 같은 문구를 S4·일지까지 이어 쓴다.
    const saved = n.missedCarry?.missed;
    return ["뚜렷한 원인 없음", "차이 원인 없음(정전 자체는 큼)"].includes(saved) ? saved : outageNoCauseLabel(n.outageFrozen);
  }
  function outageNoCause(n) {
    return !!(n.outageNoCause || n.outageFrozen?.parts?.every(p => Math.abs(p.value) < outageCardMin(n.outageFrozen)) ||
      (n.outageSingleShown && n.outageLargest && Math.abs(n.outageLargest.value) < outageCardMin(n.outageFrozen || n.missedCarry)));
  }
  function missedText(n) {
    const { frozenPicked, single, tied } = outageCardState(n.outageFrozen, n);
    if (!frozenPicked && (n.outageOpened || n.outageSingleShown) && outageNoCause(n)) return recordedOutageNoCauseLabel(n);
    const a = n.outageFrozen || n.missedCarry, names = outageNames(a || { basis: n.missedBasis });
    const largestParts = n.outageFrozen?.parts ? tied.map(k => n.outageFrozen.parts.find(p => p.key === k)).filter(p => p && Object.hasOwn(OUT_NAMES, p.key)) :
      Object.hasOwn(OUT_NAMES, n.outageLargest?.key || "") && Math.abs(n.outageLargest.value) >= outageCardMin(a) ? [n.outageLargest] : [];
    const matched = frozenPicked && tied.includes(n.missed);
    if (matched && tied.length === 1 && !outageNoCause(n)) return `내가 고른 원인: ${names[n.missed]} · 실제 가장 큰 몫과 같음(${outageValue(largestParts[0].value, outageUnit(a), true)}${outageCost(largestParts[0].value, a, true)})`;
    return [single ? "고르기 생략" : n.missed ? `내가 고른 원인: ${names[n.missed] || MISS_NAMES[n.missed] || n.missed}` : "",
      matched ? "크기가 같은 가장 큰 몫 중 하나를 짚음" : "",
      frozenPicked && outageNoCause(n) ? recordedOutageNoCauseLabel(n) : "",
      !outageNoCause(n) && (n.outageOpened || n.outageSingleShown) && largestParts.length ? `가장 큰 몫: ${largestParts.map(p => `${names[p.key]} ${outageValue(p.value, outageUnit(a), true)}${outageCost(p.value, a)}`).join(" / ")}` : ""].filter(Boolean).join(" · ");
  }
  function y2022LinkHTML(id, newTab = false) {
    return `<p class="lg-y2022 lg-hint"><a id="${id}" href="#y2022"${newTab ? ' target="_blank" rel="noopener"' : ""}>2022 기출로 연습하기</a> — 데이터 → 배치 판단 → 근거 설명 → 반문 대응: 오늘 고른 근거·예측·원인 나누기를 말로 설명해 봐요.</p>`;
  }
  function missedCarryHTML(V) {
    const note = tdata().interview?.months?.[V.round - 1], carry = note?.missedCarry;
    if (!carry) return "";
    const { frozenPicked, single, tied } = outageCardState(note.outageFrozen, note);
    if (!frozenPicked && (note.outageOpened || note.outageSingleShown) && outageNoCause(note)) return `<p id="lg-missed-carry" class="lg-hint">지난달 원인 고르기: ${esc(recordedOutageNoCauseLabel(note))}</p>`;
    const a = note.outageFrozen || carry, names = outageNames(a);
    const largestParts = note.outageFrozen?.parts ? tied.map(k => note.outageFrozen.parts.find(p => p.key === k)).filter(p => p && Object.hasOwn(OUT_NAMES, p.key)) :
      Object.hasOwn(OUT_NAMES, carry.largest?.key || "") && Math.abs(carry.largest.value) >= outageCardMin(a) ? [carry.largest] : [];
    const largestText = !outageNoCause(note) && (note.outageOpened || note.outageSingleShown) ?
      largestParts.map(p => `${names[p.key]} ${outageValue(p.value, outageUnit(a), true)}${outageCost(p.value, a, true)}`).join(" / ") : "";
    const matched = frozenPicked && tied.includes(note.missed);
    const pickedName = names[frozenPicked ? note.missed : carry.missed];
    const label = single || !pickedName ? "지난달 원인 고르기: 건너뜀" : `지난달 내가 고른 원인: ${pickedName}`;
    return `<p id="lg-missed-carry" class="lg-hint">${esc(label)}${matched ? tied.length > 1 ? " · 크기가 같은 가장 큰 몫 중 하나를 짚음" : " · 실제 가장 큰 몫과 같음" : ""}${largestText ? `(${matched && tied.length === 1 ? "" : "가장 큰 몫 "}${esc(largestText)})` : frozenPicked && outageNoCause(note) ? ` · ${esc(recordedOutageNoCauseLabel(note))}` : ""}</p>`;
  }
  // 약속 주제는 확정(준비) 때 굳힌다. 그 전에는 시험 운전 결과에 따라 다시 정하고, 주제가 바뀌면 방향을 다시 고른다.
  // 정전이 없는 계획 달은 계통에 기댄 전기로 비교하되, 그 기준값을 구할 수 없으면 정전으로 둔다.
  function promiseTopic(V, n) {
    if (n.topic && (V.phase !== "plan" || n.confirmed)) return n.topic;
    if (V.econ.cities[L.team].cash < 0) return "cash";
    if (V.phase !== "plan") return n.topic || "uns";
    const res = { ...curRound(), round: V.round }, trial = matchingTrial(V, res, L.team);
    const baseline = outageBaseline(V, res).value;
    return Number.isFinite(baseline) && baseline < ZERO_OUTAGE_PCT &&
      (!trial || Number.isFinite(trial.unsPct) && trial.unsPct < ZERO_OUTAGE_PCT) &&
      Number.isFinite(promiseGridBaseline(V).mwh) ? "grid" : "uns";
  }
  const freeExperiment = () => L.role === "solo" && tdata().freeExperiment !== false;
  function promiseHistoryHTML(V) {
    const rows = Object.entries(tdata().interview?.months || {}).filter(([, n]) => n.evidence);
    return rows.length ? `<details id="lg-promise-history"><summary>약속 일지 · 근거 유지와 변경</summary><ul>${rows.map(([t, n], i) => `<li>${esc(t)}달 · ${esc(n.evidence.text)} · ${i ? n.evidence.key === rows[i - 1][1].evidence.key ? "근거 유지" : "근거 변경" : "첫 근거"}${missedText(n) ? ` · ${esc(missedText(n))}` : ""}</li>`).join("")}</ul></details>` : "";
  }
  function calibrationHTML(id = "lg-calibration") {
    if (L.role !== "solo") return "";
    const rows = Object.values(tdata().interview?.months || {}).filter(n => n.outcome && Object.hasOwn(CONFIDENCE, n.confidence || ""));
    return `<section id="${esc(id)}" class="lg-calibration"><h4>내 확신 보정 · 기기에만</h4>${Object.entries(CONFIDENCE).map(([key, [label, p]]) => {
      const group = rows.filter(n => n.confidence === key), wins = group.filter(n => n.outcome.hit).length;
      const brier = group.length ? group.reduce((sum, n) => sum + (p - Number(n.outcome.hit)) ** 2, 0) / group.length : null;
      return `<p data-calibration="${key}">'${label}'${withParticle(label, '을를').slice(label.length)} 고른 달 중 맞은 비율 ${group.length ? fmt(wins / group.length * 100, 1) + "%" : "기록 없음"} · ${group.length}번${brier == null ? "" : ` · 확신 점수 ${fmt(brier, 3)}(0에 가까울수록 정확)`}</p><meter min="0" max="1" value="${group.length ? wins / group.length : 0}" aria-label="${label} 적중 비율"></meter>`;
    }).join("")}<p class="lg-hint">${rows.length ? `기록이 ${rows.length}번뿐이라 비율이 크게 흔들릴 수 있어요.` : "기록이 쌓이면 맞은 비율을 볼 수 있어요."} 순위에는 넣지 않아요.</p></section>`;
  }
  // 같은 기준을 약속과 결과의 정전 Δ에 쓴다. 시험 기록도 해당 방·도시·월만 읽는다.
  const trialBaselineLabel = trial => trial?.days > 0 && trial.days !== 7 ? `시험 ${trial.days}일 대비` : "시험 1주 대비";
  function outageBaseline(V, res, n = {}) {
    const old = V.results.find(x => x.round === res.round - 1)?.team[L.team];
    const trial = n.trial?.unsPct != null ? n.trial : matchingTrial(V, res, L.team);
    // 옛 약속 사본에는 days가 없을 수 있다. 기간 이름만은 같은 방·도시·월의 시험 기록에서 읽는다.
    const days = trial?.days > 0 ? trial.days : matchingTrial(V, res, L.team)?.days;
    return { value: old?.unsPct ?? trial?.unsPct,
      label: old ? "지난달 대비" : trialBaselineLabel({ days }) };
  }
  // '다음에 바꿀 것'의 저장 칸은 둘이다(일지 next, S8 유지·수정 이유 askReason). 약속 카드와 일지 머리가 같은 값을 읽게 한다.
  function nextChangeOf(d, round) {
    const old = d.interview?.months?.[round];
    const text = (d.journal?.[round]?.next?.trim() || old?.askReason?.trim() || "").replace(/\s+/g, " ");
    return { text, answer: text && old?.answer === "keep" ? "(유지)" : text && old?.answer === "revise" ? "(고치겠다)" : "" };
  }
  function previousChangeHTML(V) {
    if (V.phase !== "plan") return "";
    const change = nextChangeOf(tdata(), V.round - 1);
    return change.text ? `<p id="lg-previous-change" title="${esc(change.text)}">지난달 다음에 바꿀 것${change.answer}: ${esc(change.text)}</p>` : "";
  }
  const PLAN_POL_NAMES = { tax: "탄소세", dr: "수요반응 계약", share: "주민 이익공유", save: "절전 캠페인" };
  function localPlan(st, econPol) {
    return { builds: (st?.builds || []).map(b => ({ t: b.t, i: b.i })),
      lines: (st?.lines || []).map(l => ({ p: l.p.slice() })), policies: (st?.policies || []).slice(),
      rq: (st?.rq || []).slice(),
      shed: st?.shed || "home", fab2: !!st?.fab2, econPol: { ...(econPol || {}) } };
  }
  function planDifference(before, after) {
    if (!before || !after) return { known: false, changed: false, text: "지난달 계획 기록 없음" };
    const difference = (a, b, key) => {
      const old = new Set(a.map(key)), now = new Set(b.map(key));
      return { added: [...now].filter(k => !old.has(k)).length, removed: [...old].filter(k => !now.has(k)).length };
    };
    const builds = difference(before.builds, after.builds, b => C.itemKey("b", b));
    // 방향만 뒤집은 같은 전선은 변경으로 세지 않는다.
    const lineKey = l => [l.p.join("-"), l.p.slice().reverse().join("-")].sort()[0];
    const lines = difference(before.lines, after.lines, lineKey), policies = [];
    new Set([...before.policies, ...after.policies]).forEach(k => {
      if (before.policies.includes(k) !== after.policies.includes(k)) policies.push(`${PLAN_POL_NAMES[k] || k} ${after.policies.includes(k) ? "켬" : "끔"}`);
    });
    const ecoNames = { taxRes: "주민세", taxInd: "산업세", service: "공공서비스", incentive: "기업 유치 보조", re100: "RE100 산단 지정" };
    new Set([...Object.keys(before.econPol), ...Object.keys(after.econPol)]).forEach(k => {
      const old = k === "re100" ? !!before.econPol[k] : before.econPol[k] ?? 0;
      const now = k === "re100" ? !!after.econPol[k] : after.econPol[k] ?? 0;
      if (old !== now) policies.push(k === "re100" ? `${ecoNames[k]} ${now ? "켬" : "끔"}` : `${ecoNames[k] || k} ${old} → ${now}`);
    });
    if (before.shed !== after.shed) policies.push("차단 순서 변경");
    if (before.fab2 !== after.fab2) policies.push(`2라인 ${after.fab2 ? "켬" : "끔"}`);
    const research = JSON.stringify(before.rq || []) !== JSON.stringify(after.rq || []);
    const changed = !!(builds.added || builds.removed || lines.added || lines.removed || policies.length || research);
    return { known: true, changed, builds, lines, research, text: `설비 ${builds.added}개 추가·${builds.removed}개 제거 · 전선 ${before.lines.length} → ${after.lines.length}개(${lines.added}개 추가·${lines.removed}개 제거) · 정책 ${policies.join(" · ") || "켬·끔 변경 없음"} · 연구 ${research ? "대기열 변경" : "변경 없음"}` };
  }
  function currentPlanDifference(V) {
    const old = tdata().interview?.months?.[V.round - 1]?.operatingPlan;
    return planDifference(old, localPlan(BG.current(), L.pendingPol || V.teams[L.team].econPol || V.econ?.cities[L.team]?.policy));
  }
  function confirmFollowingPlan(n, diff, basis) {
    n.followingPlanChanged = diff.known ? diff.changed : null;
    if (diff.known) n.followingPlanBasis = basis;
    else delete n.followingPlanBasis;
    delete n.followingPlanConfirmedChanged;
  }
  function rememberLocalPlan(V) {
    if (!V.econ || L.away) return;
    const d = tdata(), before = JSON.stringify(d.interview); d.interview ||= {}; d.interview.months ||= {};
    const months = d.interview.months;
    // 확정 시점이 없는 옛 false/미리보기 값은 믿지 않는다. 다음 달 운영 기록이 있으면 복원한다.
    Object.entries(months).forEach(([rd, note]) => {
      if (legacyLearningNote(note)) return;
      delete note.followingPlanConfirmedChanged;
      if (!["ready", "result"].includes(note.followingPlanBasis)) {
        confirmFollowingPlan(note, planDifference(note.operatingPlan, months[Number(rd) + 1]?.operatingPlan), "result");
      }
    });
    if (["review", "end"].includes(V.phase)) {
      const res = V.results.at(-1), r = res?.team[L.team];
      if (!r) return;
      const n = months[res.round] ||= { operatingPlan: null, followingPlanChanged: null, resultNumbers: [] }, city = V.econ.cities[L.team], period = resultPeriod(V, res);
      if (legacyLearningNote(n)) return;
      n.finalMonth = res.round === C.roundsOf(V).length;
      n.operatingPlan = localPlan(V.teams[L.team].plan, V.teams[L.team].econPol || city.policy);
      const gridTopic = promiseTopic(V, n) === "grid", grid = promiseGridReliance(V, res, L.team, n);
      // 화면에 숫자로 보이는 하루 평균만 1자리로 추가한다. '0.1 미만'은 계통 단어로 인용한다.
      const dailyNumbers = [grid?.perDay >= GRID_DISPLAY_MIN_PER_DAY ? grid.perDay : null,
        gridTopic && Number.isFinite(r.co2Cons) ? r.co2Cons * period.mul / period.days : null];
      n.resultNumbers = [...new Set([r.unsPct, r.outH * period.mul, r.co2Prod * period.mul, city.cash, city.approval]
        .filter(Number.isFinite).flatMap(v => [0, 1, 2].map(digits => String(Number(v.toFixed(digits)))))
        .concat(dailyNumbers.filter(Number.isFinite).map(v => fmt(v, 1).replaceAll(",", ""))))];
      const old = months[res.round - 1];
      if (old && !legacyLearningNote(old)) {
        const diff = planDifference(old.operatingPlan, n.operatingPlan);
        // 준비 뒤 해제·수정하거나 진행자가 바로 운영해도 실제 운영 계획으로 다시 확정한다.
        confirmFollowingPlan(old, diff, "result");
      }
    } else if (V.phase === "plan" && BG.current()) {
      const old = months[V.round - 1];
      // ack 뒤 스냅이 오기 전(진행자는 스냅을 150ms 늦게 보낸다)에는 ack로 확인된 값을 쓴다. 이 틈의 그리기가
      // 준비 확정값을 지우지 않게 한다.
      const ready = L.wantReady ?? L.readyAcked ?? V.teams[L.team].ready;
      if (old && !legacyLearningNote(old) && !ready) confirmFollowingPlan(old, { known: false }, "ready");
    } else return;
    if (before !== JSON.stringify(d.interview)) putData(d);
  }
  // S4의 학생 선택·판정이 든 지난달 변경 상자는 폭 760 초과에서 펼친다.
  // 비교 규칙 TIP은 폭과 관계없이 닫아 둔다.
  // Node VM 검사(v3a-ready.js)는 matchMedia 없이 이 파일을 불러 쓴다. 그때는 닫힌 상태로 둔다.
  const wideOpen = () => typeof matchMedia === "function" && matchMedia("(min-width: 761px)").matches ? " open" : "";
  function planFollowupHTML(V) {
    if (V.phase !== "plan" || V.round < 2) return "";
    const d = tdata(), old = d.interview?.months?.[V.round - 1], diff = currentPlanDifference(V);
    const reason = old?.askReason?.trim().replace(/\s+/g, " ");
    const extraReason = reason && reason !== nextChangeOf(d, V.round - 1).text ? `<p>지난달 ${old.answer === "keep" ? "유지" : "수정"} 이유: ${esc(reason)}</p>` : "";
    const change = nextChangeOf(d, V.round - 1);
    const preview = old && !legacyLearningNote(old) ? { ...old, followingPlanChanged: diff.known ? diff.changed : null } : old;
    const canConfirm = old && !legacyLearningNote(old) && !old.finalMonth && diff.known;
    return `<details id="lg-plan-followup" class="lg-sec" data-wide-open${wideOpen()}><summary>지난달 말과 실제 변경${old ? ` · 학습 미션 ${learningStatus(preview, false, true)}` : ""}</summary><div class="lg-plan-comparison"><div><h4>말한 변경</h4><p>${esc(change.text || "지난달 이유 기록 없음")}</p>${extraReason}</div><div><h4>이번 달 실제 변경</h4><p id="lg-actual-change">${esc(diff.text)}</p>${infoTip("plan-followup-scope", "설비·전선·정책·연구만 셉니다. 연계선·사건 대응은 제외해요.", { label: "실제 변경 범위" })}</div></div></details>${old ? `<p id="lg-previous-mission">지난달 학습 미션: ${learningStatus(preview, false, true)}${canConfirm ? "(지금 계획 기준, 준비하면 확정)" : ""}</p>` : ""}${learningRuleHTML(true)}`;
  }
  function updatePlanReminder(V) {
    const root = document.getElementById("bd-root");
    if (!root || L.away) return;
    let strip = root.querySelector("#lg-plan-reminder");
    const old = tdata().interview?.months?.[V.round - 1];
    if (V.phase !== "plan" || !["keep", "revise"].includes(old?.answer) || !old.askReason?.trim() || old.reminderDismissed) {
      if (strip) { strip.remove(); window.dispatchEvent(new Event("resize")); }
      return;
    }
    const created = !strip;
    if (!strip) {
      strip = document.createElement("div"); strip.id = "lg-plan-reminder";
      root.querySelector(".bd-stage").append(strip);
      strip.addEventListener("click", e => {
        if (!e.target.closest("#lg-plan-reminder-close")) return;
        const d = tdata(); d.interview.months[V.round - 1].reminderDismissed = true; putData(d); strip.remove(); window.dispatchEvent(new Event("resize"));
      });
    }
    strip.innerHTML = `<span>지난달 ${old.answer === "keep" ? "유지하겠다" : "고치겠다"}: ${esc(old.askReason.trim().replace(/\s+/g, " "))}</span><button type="button" id="lg-plan-reminder-close" aria-label="지난달 이유 띠 닫기">×</button>`;
    if (created) window.dispatchEvent(new Event("resize"));
  }
  // 월 합계 계약은 유지하고 약속 비교용 하루 평균은 시험 원기간에서 직접 구한다.
  function promiseGridBaseline(V, n = monthNote().n) {
    const previous = V.results.find(x => x.round === V.round - 1);
    if (previous) {
      // days는 비교 기준인 지난달의 월 일수다.
      const { mwh, cost, days, perDay, unit } = gridReliance(V, previous, L.team);
      return { label: "지난달 대비", mwh, cost, days, perDay, unit,
        base: { kind: "last", label: "지난달 대비", mwh, cost, days, perDay },
        delta: null, deltaCost: null, tol: gridSameTol(mwh), deltaPerDay: null, deltaPerDayCost: null, tolPerDay: gridSameTolPerDay(perDay) };
    }
    const res = { ...curRound(), round: V.round }, trial = n?.confirmed && Number.isFinite(n.trial?.gridMWh) && n.trial.days > 0 ? n.trial : matchingTrial(V, res, L.team);
    const days = resultPeriod(V, res).days, perDay = Number.isFinite(trial?.gridMWh) && trial.days > 0 ? trial.gridMWh / trial.days : null;
    const mwh = perDay == null ? null : perDay * days, cost = mwh == null ? null : mwh * params("normalCost") * params("gridImportMarkup");
    return { label: trialBaselineLabel(trial), mwh, cost, days, perDay, unit: "MWh/일",
      base: { kind: perDay == null ? null : "trial", label: trialBaselineLabel(trial), mwh, cost, days: perDay == null ? null : trial.days, perDay },
      delta: null, deltaCost: null, tol: gridSameTol(mwh), deltaPerDay: null, deltaPerDayCost: null, tolPerDay: gridSameTolPerDay(perDay) };
  }
  // 첫 달 계통 기준은 약속 확정 때 남긴 시험 값(n.trial)을 쓴다. 약속 뒤 시험을 다시 돌려도 판정 기준이 바뀌지 않는다.
  function promiseGridReliance(V, res, id, n) {
    const g = gridReliance(V, res, id), t = n?.trial;
    if (V.results.some(x => x.round === res.round - 1) || !Number.isFinite(t?.gridMWh) || !(t.days > 0)) return g;
    const price = params("normalCost") * params("gridImportMarkup"), mwh = t.gridMWh * resultPeriod(V, res).days / t.days;
    const delta = g.mwh == null ? null : g.mwh - mwh, perDay = t.gridMWh / t.days;
    const deltaPerDay = g.perDay == null ? null : g.perDay - perDay;
    return { ...g, base: { kind: "trial", label: trialBaselineLabel(t), mwh, cost: mwh * price, days: t.days, perDay },
      delta, deltaCost: delta == null ? null : delta * price, tol: gridSameTol(mwh),
      deltaPerDay, deltaPerDayCost: deltaPerDay == null ? null : deltaPerDay * price, tolPerDay: gridSameTolPerDay(perDay) };
  }
  // 근거·방향·확신과 약속 주제에 맞는 비교 기준을 표시한다.
  function predictionHTML(V) {
    rememberLocalPlan(V);
    const { n } = monthNote();
    if (!needsLoop(V)) return "";
    const topic = promiseTopic(V, n), complete = !!n.evidence && Object.hasOwn(DIRECTION_NAMES, n.pred?.[topic] || "") && Object.hasOwn(CONFIDENCE, n.confidence || "");
    const comparison = outageBaseline(V, { ...curRound(), round: V.round }, n);
    const grid = topic === "grid" ? promiseGridBaseline(V) : null;
    const baseline = `비교 기준: ${topic === "cash" ? "이번 달 운영 전 현금" : topic === "grid" ? Number.isFinite(grid.perDay) ? `${grid.label} · 하루 평균 ${perDayText(grid.perDay)}(${grid.base.kind === "last" ? `지난달 ${grid.days}일 합` : `이번 달 ${grid.days}일이면 약`} ${fmt(grid.mwh, 1)} MWh · ${fmt(grid.cost, 2)}억)` : "기준 없음" : `${comparison.label} · 정전 ${Number.isFinite(comparison.value) ? `${fmt(comparison.value, 2)}%` : "시험 기록 없음"}`}`;
    const directionLabel = `2. 이번 달 ${topic === "cash" ? "현금(월말 잔액)" : topic === "grid" ? "바깥 계통에 기댄 전기" : "정전"} 방향`;
    return `<div class="lg-promise-carry">${previousChangeHTML(V)}${missedCarryHTML(V)}</div><section id="lg-predict" class="lg-pred lg-sec"><div class="lg-promise-heading"><h3>기준 먼저 · 하루 전 약속</h3><h4>1. 근거 하나</h4></div><div id="lg-evidence" class="lg-acts">${evidenceOptions(V).map(now => {
      const x = evidenceAtStart(now, n);
      const extra = n.evidence?.key === x.key ? evidenceNowHTML(n, "s4", now.value) : "";
      const label = x.key === "wind" ? x.text.replace(EVIDENCE_NAMES.wind, "풍속") : x.key === "neighbor" ? x.text.slice(x.text.indexOf(EVIDENCE_NAMES.neighbor)) : x.text;
      const button = `<button class="v2-btn" type="button" data-evidence="${x.key}" aria-pressed="${n.evidence?.key === x.key}" title="${esc(x.text)}" aria-label="${esc(x.text + (n.s1Pick === x.key ? " · S1에서 고름" : ""))}" ${Number.isFinite(x.value) ? "" : "disabled"}>${esc(label)}${n.s1Pick === x.key ? ' <small class="lg-s1-mark">S1에서 고름</small>' : ""}</button>`;
      return extra ? `<div>${button}${extra}</div>` : button;
    }).join("")}</div>
      <p id="lg-promise-baseline" class="lg-hint${topic === "grid" ? " lg-promise-grid-baseline" : ""}" title="${esc(baseline)}">${esc(baseline)}</p>
      ${topic === "grid" ? `<p class="lg-hint">${matchingTrial(V, { ...curRound(), round: V.round }, L.team) ? "시험에서" : "지난달에"} 정전이 없어서, 이번 달은 부족을 바깥 계통이 얼마나 메웠는지로 약속해요.</p>` : ""}
      <label class="lg-field"><span class="lg-promise-direction" title="${esc(directionLabel)}">${esc(directionLabel)}</span><select data-pred="${topic}"><option value="">선택해요</option>${Object.entries(DIRECTION_NAMES).map(([v, label]) => `<option value="${v}" ${n.pred?.[topic] === v ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <div class="lg-promise-confidence"><h4>3. 확신</h4><div class="lg-acts">${Object.entries(CONFIDENCE).map(([key, [label]]) => `<button type="button" class="v2-btn" data-confidence="${key}" aria-pressed="${n.confidence === key}">${label}</button>`).join("")}</div></div>
      ${L.awaitReady ? `<div class="lg-promise-actions"><p id="lg-promise-remaining">${complete ? "준비할 수 있어요" : `남은 단계: ${!n.evidence ? "근거" : !n.pred?.[topic] ? "방향" : "확신"}`}</p><button class="v2-btn primary" type="button" id="lg-ready-confirm" ${complete ? "" : "disabled"}>약속하고 준비</button>${freeExperiment() ? '<button class="v2-btn" type="button" id="lg-predict-skip" aria-label="자유 실험 · 건너뛰고 준비">건너뛰고 준비</button>' : ""}</div>` : ""}</section>${tipBox("promise-rules", "약속 비교 기준 자세히", `<p class="lg-hint">약속은 이 기기에만 남아요.</p><p id="lg-evidence-grid-basis" class="lg-hint">${EVIDENCE_GRID_BASIS}</p><p class="lg-hint">${predictionRule(topic)}</p>`).replace("<details ", '<details id="lg-promise-rules" ')}${needsExplanation(V) ? `<label class="lg-jq">이번 결정의 기준(선택)<textarea data-note="decision" rows="2" maxlength="1000">${esc(n.decision || "")}</textarea></label>` : ""}${planFollowupHTML(V)}${promiseHistoryHTML(V)}${calibrationHTML()}`;
  }
  // 저장한 주제의 변화량과 문턱으로 방향을 판정하며 전송용 적중 값은 불리언으로 둔다.
  function promiseComparison(V, n) {
    const result = V.results.at(-1), r = result?.team[L.team], c = V.econ.cities[L.team];
    const topic = promiseTopic(V, n), grid = topic === "grid" ? promiseGridReliance(V, result, L.team, n) : null;
    const comparison = grid ? grid.base : outageBaseline(V, result, n);
    const beforeCash = V.econ.before?.[L.team]?.cash;
    const delta = topic === "cash" ? Number.isFinite(c.cash) && Number.isFinite(beforeCash) ? c.cash - beforeCash : null
      : grid ? grid.delta : Number.isFinite(comparison.value) && Number.isFinite(r?.unsPct) ? r.unsPct - comparison.value : null;
    const actual = grid ? grid.deltaPerDay == null ? null : Math.abs(grid.deltaPerDay) <= grid.tolPerDay ? "same" : grid.deltaPerDay > 0 ? "up" : "down" : delta == null ? null : direction(delta);
    const hit = actual == null ? null : n.pred[topic] === actual;
    return { result, r, topic, comparison, grid, delta, actual, hit };
  }
  function promiseVerdictText({ r, topic, comparison, grid, delta, hit }, n) {
    return topic === "grid" ? `계통 예측: ${DIRECTION_NAMES[n.pred[topic]] || "미선택"} / 실제 결과: ${grid.deltaPerDay == null ? `이번 달 하루 평균 ${perDayText(grid.perDay)}(${grid.base.label})` : `${grid.base.label} 하루 평균 ${signed(grid.deltaPerDay, 1)} MWh/일 · ${hit ? "예상과 같음" : "예상과 다름"}(이번 달 하루 평균 ${perDayText(grid.perDay)} · 월 합계 ${fmt(grid.mwh, 1)} MWh · 월 비용 약 ${fmt(grid.cost, 2)}억)`}`
      : `${topic === "cash" ? "현금" : "정전"} 예측: ${DIRECTION_NAMES[n.pred[topic]] || "미선택"} / 실제 결과: ${delta == null ? topic === "cash" ? "비교 기준 없음" : `${fmt(r.unsPct, 2)}%(비교 기준 없음)` : `${topic === "cash" ? "운영 전 대비" : comparison.label} ${signed(delta, 2)}${topic === "cash" ? "억" : "%p"} · ${hit ? "예상과 같음" : "예상과 다름"}`}`;
  }
  // '이번 달 자세히' 접힘 제목용 짧은 판정. 숫자와 월 합계는 판정 줄·상세에 이미 있다(390 첫 화면 줄 수를 줄인다).
  function promiseVerdictShort(c, n) {
    if (c.topic !== "grid") return promiseVerdictText(c, n);
    const dir = DIRECTION_NAMES[n.pred?.grid] || "미선택";
    return c.grid.deltaPerDay == null ? `계통 예측 ${dir} · 비교 기준 없음` : `계통 예측 ${dir} → ${c.hit ? "예상과 같음" : "예상과 다름"} · 하루 평균 Δ ${signed(c.grid.deltaPerDay, 1)} MWh/일`;
  }
  function reportPromiseVerdict(V) {
    if (L.role !== "team" || !L.claimAccepted || L.away || !V.econ || V.phase !== "review" ||
        V.round >= C.roundsOf(V).length || V.results.at(-1)?.round !== V.round) return;
    const n = tdata().interview?.months?.[V.round];
    if (!n?.evidence || n.skipped || n.finalMonth || n.verdictReport?.done || !Object.hasOwn(DIRECTION_NAMES, n.pred?.[promiseTopic(V, n)] || "")) return;
    const { hit } = promiseComparison(V, n);
    if (typeof hit !== "boolean") return;
    const key = `${L.team}:${V.sid}:${V.teams[L.team]?.seatVersion || 0}:${V.round}`;
    if (L.verdictSent === key || [...L.pendingRequests.values()].some(p => p.type === "verdict" && p.extra.round === V.round)) return;
    // 새로고침 뒤에도 같은 요청 ID·최초 값·재시도 횟수를 이어 쓴다. 완료한 월은 기기 기록으로 막는다.
    if (n.verdictReport?.pending) {
      const pending = structuredClone(n.verdictReport.pending);
      L.pendingRequests.set(pending.id, pending); L.verdictSent = key;
      retryRequest(pending);
    } else {
      // 로컬 약속 객체를 펼치지 않는다. 화면과 같은 판정의 월·boolean만 전송한다.
      if (send("verdict", { round: V.round, hit })) L.verdictSent = key;
    }
  }
  function rememberVerdictRequest(pending, done = false) {
    if (L.role !== "team" || pending?.type !== "verdict") return;
    const d = tdata(), n = d.interview?.months?.[pending.extra.round];
    if (!n) return;
    const { id, type, extra, stamp, tries, born } = pending;
    n.verdictReport = done ? { done: true } : { pending: { id, type, extra, stamp, tries, born } };
    putData(d);
  }
  // S6·S7 공통 방향 규칙. 접속 풍력 자료가 없으면 직접 효과를 인정하지 않는다.
  // hasConnectedWind: true 접속 풍력 있음, false 없음, null·undefined 계산하지 못함(이유 문장을 '없음'으로 단정하지 않는다).
  function evidenceEffect(key, { topic, hasConnectedWind } = {}) {
    if (topic === "uns" || topic === "grid") {
      if (key === "evening" || key === "neighbor") return { sign: 1, reason: "" };
      if (key === "grid") return { sign: 0, reason: "접속 여유는 이번 달 새 접속을 처리하기 전 값이라 결과와 방향을 비교하지 않아요" };
      if (key === "wind") return hasConnectedWind ? { sign: -1, reason: "" }
        : hasConnectedWind == null ? { sign: 0, reason: "이번 달 풍력 접속 자료를 계산하지 못해 풍속과 결과의 방향을 비교하지 않아요" }
        : { sign: 0, reason: "우리 도시에 접속된 풍력 설비가 없어 풍속과 결과의 방향을 비교하지 않아요" };
      if (key === "fuel") return { sign: 0, reason: `LNG 지수는 비용으로만 닿아 이번 대상(${topic === "grid" ? "바깥 계통에 기댄 전기" : "정전"})과 방향을 비교하지 않아요` };
    } else if (key === "fuel") return { sign: -1, reason: "" };
    return { sign: 0, reason: "이 근거는 이번 대상과 방향을 비교하지 않아요" };
  }
  // 약속한 주제로 판정하고 계통 약속 때 실제 정전이 생겼으면 함께 알린다.
  function promiseResultHTML(V, n, reviewOrder = false) {
    if (!n.evidence || !n.pred || n.skipped) return "";
    const compared = promiseComparison(V, n), { result, r, topic, actual, hit } = compared;
    if (actual && n.confidence && (!n.outcome || n.outcome.actual !== actual || n.outcome.hit !== hit)) { const { d, n: saved } = monthNote(); saved.outcome = n.outcome = { actual, hit }; putData(d); }
    // 기기에 남긴 전 달 같은 근거와의 변화만 읽는다. 처음에는 방향을 추정하지 않는다.
    const previousNote = tdata().interview?.months?.[V.round - 1];
    const { value: evidenceValue, before: previousValue } = evidenceComparisonValues(n, previousNote);
    // S7과 같은 날씨 단계의 접속 여부를 읽는다. 고정본·캐시도 outageAttribution이 함께 처리한다.
    const hasConnectedWind = n.evidence.key === "wind" && (topic === "uns" || topic === "grid")
      ? outageAttribution(V, result, L.team, n)?.hasConnectedWind : false;
    const effect = evidenceEffect(n.evidence.key, { topic, hasConnectedWind });
    const change = evidenceValue - previousValue, threshold = Math.max(Math.abs(previousValue) * EVIDENCE_STEP[n.evidence.key], n.evidence.key === "neighbor" ? EVIDENCE_STEP.neighborFloor : EVIDENCE_STEP.floor);
    const evidenceDir = Number.isFinite(previousValue) && Number.isFinite(evidenceValue) && effect.sign && Math.abs(change) >= threshold ? (change * effect.sign > 0 ? "up" : "down") : null;
    const evidenceText = !effect.sign ? effect.reason : !Number.isFinite(previousValue) ? "지난달 값이 없어 비교하지 않아요"
      : !Number.isFinite(evidenceValue) ? "근거 값이 없어 비교하지 않아요" : !evidenceDir ? "근거 변화가 비교 눈금보다 작아 비교하지 않아요"
      : actual ? evidenceDir === actual ? "같은 방향(게임 안 단순 비교)" : "다른 방향(게임 안 단순 비교)" : "결과의 비교 기준이 없어 비교하지 않아요";
    const verdict = esc(promiseVerdictText(compared, n));
    // 표시 1자리가 같아도 판정이 갈리는 경계에서 학생이 판정을 의심하지 않게 상세에 계산값을 보인다.
    const gridCalc = topic === "grid" && compared.grid.deltaPerDay != null
      ? `<p id="lg-promise-grid-calc" class="lg-hint">판정 계산: 하루 평균 Δ ${esc(signed(compared.grid.deltaPerDay, 2))} MWh/일, '같음' 범위 ±${esc(fmt(compared.grid.tolPerDay, 2))} MWh/일(기준 하루 평균 ${esc(fmt(compared.grid.base.perDay, 2))}의 ${esc(fmt(GRID_SAME_SHARE_PER_DAY * 100))}%와 ${esc(fmt(GRID_SAME_MWH_PER_DAY, 2))} 중 큰 값)</p>` : "";
    // D-82 결정 2: 공개 소비 배출과 기존 시험 기록만 읽는다. trial.co2는 gridFill 뒤의 소비 기준이다.
    // D-82 결정 1: 비교는 각 기간의 하루 평균(t/일), 월 합계는 보조로 표시한다.
    let co2cons = "";
    if (topic === "grid") {
      const period = resultPeriod(V, result), total = Number.isFinite(r?.co2Cons) ? r.co2Cons * period.mul : null;
      const current = total == null ? null : total / period.days;
      const previous = V.results.find(x => x.round === result.round - 1), p = previous?.team[L.team];
      // 약속 때 남긴 시험 사본(n.trial.co2)을 먼저 쓴다. 옛 기록에는 없어서, 그때만 일수·계통량이 같은 기존 시험 기록을 쓴다.
      const saved = !previous && Number.isFinite(n.trial?.co2) && n.trial.days > 0 ? n.trial : null;
      const trial = saved || (!previous && compared.grid.base.kind === "trial" ? matchingTrial(V, result, L.team) : null);
      const sameTrial = trial && (saved || !n.trial || n.trial.days === trial.days && n.trial.gridMWh === trial.gridMWh);
      const base = previous ? Number.isFinite(p?.co2Cons) ? p.co2Cons * resultPeriod(V, previous).mul / resultPeriod(V, previous).days : null
        : sameTrial && Number.isFinite(trial.co2) ? trial.co2 / trial.days : null;
      const change = current != null && base != null ? `${previous ? "지난달 대비" : trialBaselineLabel(trial)} Δ ${signed(current - base, 1)} t/일`
        : `Δ 비교 없음(${previous ? "지난달 소비 값 없음" : trial && !sameTrial ? "약속 뒤 시험이 바뀜" : "첫 결과"})`;
      co2cons = `<p id="lg-s6-co2cons" class="lg-hint">소비 CO₂(이웃·계통에서 받은 전기 포함) 하루 평균 ${esc(fmt(current, 1))} t/일 · ${esc(change)}(이번 달 합 ${esc(fmt(total))} t) · 계통에서 끌어온 전기도 우리 도시 소비 배출에 들어가요.</p>`;
    }
    const alsoOutage = topic === "grid" && r?.unsPct >= ZERO_OUTAGE_PCT ? `<p class="lg-hint" id="lg-promise-also-outage">이번 달은 정전도 생겼어요(${esc(fmt(r.unsPct, 2))}%)</p>` : "";
    const outage = (topic === "uns" || topic === "grid") && (hit === false || n.outageOpened || n.outageSingleShown) ? outageCardsHTML(V, result, L.team, n) : "";
    return `<p id="lg-promise-summary" class="lg-promise-summary">${verdict} <button class="v2-btn" type="button" data-promise-details>예측 자세히</button></p>${alsoOutage}${co2cons}${reviewOrder ? outage : ""}<section id="lg-promise-result" class="lg-pred lg-sec" tabindex="-1"><h3>예측 대 실제</h3><p>근거: ${esc(n.evidence.text)} · 확신 ${esc(CONFIDENCE[n.confidence]?.[0] || "미선택")}</p>${evidenceNowHTML(n, "s6")}<p data-compare="${topic}">${verdict}</p>${gridCalc}<p id="lg-evidence-direction">고른 근거도 같은 쪽으로 움직였나요: ${esc(evidenceText)}</p>${tipBox("promise-result-rules", "근거·예측 판정 기준", `<p class="lg-hint">${EVIDENCE_RULE}</p><p class="lg-hint">${predictionRule(topic)}</p>`)}${reviewOrder ? "" : outage}${needsReviewLoop(n) ? `<label class="lg-radio lg-compared"><span><input type="checkbox" data-compared ${n.compared ? "checked" : ""}>예측과 실제를 비교했어요</span></label>` : ""}${calibrationHTML()}</section>`;
  }
  function newBuildCost(V, st = BG.current()) {
    const base = new Set((V.teams[L.team].base || []).map(b => b.k));
    // 새 설비만: 기존 설비 철거·선·정책 변경을 새 건설로 세지 않는다.
    return (st?.builds || []).filter(b => !base.has(C.itemKey("b", b))).reduce((a, b) => {
      const approved = V.teams[L.team].plan?.builds?.find(item => C.itemKey("b", item) === C.itemKey("b", b));
      const item = Number.isFinite(approved?.paidCost) ? { ...b, paidCost: approved.paidCost } : b;
      return a + BG.capex({ ...st, builds: [item], lines: [] });
    }, 0);
  }
  function largeDecision() {
    const V = L.snap, { n } = monthNote(), me = V?.teams[L.team];
    if (!V?.econ || V.phase !== "plan") return false;
    return !!n.big || newBuildCost(V) > 0 && newBuildCost(V) >= me.budget * IQ.large;
  }

  function questionContext(V) {
    const E = V.econ, rep = E.report, res = V.results.at(-1), prevRes = V.results.at(-2), r = res?.team[L.team], p = prevRes?.team[L.team], c = E.cities[L.team], prev = E.before?.[L.team], { d, n } = monthNote();
    const inv = d.interview?.months || {}, keys = Object.keys(inv).map(Number).sort((a, b) => a - b), last = keys.filter(k => k < V.round).map(k => inv[k].ask || inv[k].quarterKey).filter(Boolean).at(-1);
    const parts = E.score.by[L.team].parts, pol = V.teams[L.team].econPol || c.policy;
    const outflow = (rep?.flows.pop || []).filter(f => f.from === L.team).sort((a, b) => b.n - a.n)[0];
    const quarterMonths = keys.filter(k => k > V.round - IQ.quarter && k <= V.round);
    return { large: (n.buildCost || 0) > 0 && n.buildCost >= (n.buildBudget || 0) * IQ.large, event: (V.events || []).some(ev => ev.round === V.round && C.eventDef(R(), ev.id) && C.hits(R(), C.eventDef(R(), ev.id), L.team)), used: Object.values(inv).map(m => m.ask || m.quarterKey).filter(Boolean), smoke: (r?.cpList || []).some(cp => cp.kind === "smoke" && cp.score > 0), quarter: V.round % IQ.quarter === 0, spread: Math.max(...Object.values(parts)) - Math.min(...Object.values(parts)), dApproval: c.approval - (prev?.approval ?? c.approval), policyQuarter: quarterMonths.some(k => inv[k].policy), miss: n.pred?.uns && p && n.pred.uns !== direction(r.unsPct - p.unsPct), crossed: V.teams[L.team].crit && parts[V.teams[L.team].crit.chips[0]] < V.teams[L.team].crit.line && !keys.some(k => k < V.round && inv[k].crossed), spare: r?.spareMW || 0, peak: r && BG.peakDemand ? BG.peakDemand(Object.fromEntries((BG.current()?.policies || []).map(k => [k, true])), BG.current()?.fab2) : 0, uns: r?.unsPct, complaints: r?.cp || 0, lowGroup: lowestGroup(c.groups), left: C.roundsOf(V).length - V.round, firstResearch: !!n.research, labPending: (BG.current()?.builds || []).some(b => b.t === "lab") && Object.keys(V.teams[L.team].rs?.prog || {}).length > 0, outflow: !!outflow, nb: outflow?.to || actT(V).find(t => t.id !== L.team)?.id, news: rep?.news.length || 0, offerFail: E.offers.map(o => o.eval?.by[L.team]?.fail.length).find(x => x === 1), dUns: p ? r.unsPct - p.unsPct : 0, co2Growth: p?.co2Prod ? r.co2Prod / p.co2Prod - 1 : 0, tax: pol.taxRes || 0, service: pol.service || 0, dSenior: c.groups.senior - (prev?.groups.senior ?? c.groups.senior), balance: rep ? rep.fiscal[L.team].revTotal - rep.fiscal[L.team].expTotal + rep.fiscal[L.team].exp.capex : 0, accepted: !!n.accepted && V.ties.some(t => t.st === "built" && [t.a, t.b].includes(L.team) && [t.a, t.b].includes(n.acceptedOther)), rejected: !!n.rejected, neighborWorse: !!n.rejectedOther && p && res.team[n.rejectedOther]?.unsPct > prevRes.team[n.rejectedOther]?.unsPct, ties: V.ties.filter(t => t.st === "built").length, tradeShare: rep ? (rep.fiscal[L.team].rev.trade || 0) / Math.max(1, rep.fiscal[L.team].revTotal) : 0, policyPrevious: !!inv[V.round - 1]?.policy, dRank: (E.previousScore?.by[L.team]?.rank || 0) - E.score.by[L.team].rank, evaluation: !!rep?.review?.[L.team], end: V.phase === "end", last, crit: V.teams[L.team].crit?.chips };
  }
  function withParticle(name, pair) {
    const ch = name.codePointAt(name.length - 1), final = ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0;
    // '으로/로'는 받침 ㄹ(종성 8)도 '로'를 쓴다.
    const rieul = final && (ch - 0xac00) % 28 === 8;
    return name + ({ "이가": final ? "이" : "가", "을를": final ? "을" : "를", "이라고": final ? "이라고" : "라고", "은는": final ? "은" : "는", "으로": final && !rieul ? "으로" : "로", "과와": final ? "과" : "와", "이에요": final ? "이에요" : "예요" }[pair] || "");
  }
  const questionText = (key, x = {}) => (QUESTIONS[key] || "").replace(/\{(city|nb)\}([이가을를])?/g, (_, who, particle) => {
    const name = teamName(who === "city" ? L.team : x.nb || L.team);
    return particle ? withParticle(name, "이가".includes(particle) ? "이가" : "을를") : name;
  }).replaceAll("{criterion}", SCORE_NAMES[(x.crit || L.snap?.teams[L.team]?.crit)?.chips?.[0]] || "선택한 항목")
    .replaceAll("{line}", fmt((x.crit || L.snap?.teams[L.team]?.crit)?.line, 1));
  function causeHTML(V) {
    const E = V.econ, c = E.cities[L.team], prev = E.before?.[L.team], rep = E.report;
    if (!rep || !prev) return "";
    const pop = (rep.flows?.pop || []).filter(f => f.from === L.team || f.to === L.team);
    const approval = visibleCauses(rep.cities[L.team]?.causes).map(x => ({ key: x.key, value: x.delta, label: causeLabel(x) }));
    const bars = (rows, unit, groups) => rows.slice(0, IQ.quarter).map(x => `<div data-cause="${esc(x.key)}"><span>${esc(x.label || PART_NAMES[x.key] || (groups ? "지연·집단 반응" : "처음 인구 비중과 이웃 도시의 상황"))}: ${esc(signed(x.value, 1))}${unit}</span><meter min="0" max="${esc(Math.max(1, ...rows.map(y => Math.abs(y.value))))}" value="${esc(Math.abs(x.value))}" aria-label="기여 크기"></meter></div>`).join("");
    return `<section id="lg-causes" class="lg-sec lg-cause"><h3>무엇이 결과를 만들었나</h3><h4>주민 이동 ${esc(signed(rep.net[L.team].pop))}명</h4>${pop.length ? `<ul class="lg-pop-reasons">${pop.map(f => `<li>${esc(teamName(f.from))} → ${esc(teamName(f.to))} ${esc(fmt(f.n))}명: ${esc(migrationReason(f))}</li>`).join("")}</ul>` : `<p>보고된 주민 이동 없음</p>`}<p class="lg-hint">이유는 두 도시의 시작 대비 변화에서 가장 큰 차이 한 가지예요. 자연 증가 ${esc(fmt(rep.net[L.team].growPop))}명은 이동과 별개예요.</p><h4>이번 달 도시 지지율 변화 ${esc(signed(c.approval - prev.approval, 1))}%p</h4>${bars(approval, "%p", true)}<p class="lg-hint">생활 항목의 변화와 집단별 중요도·비중을 곱한 설명이에요. 이번 달 변화에 많이 영향을 준 원인부터 보여요. 달마다 상위 ${esc(params("causeCount"))}개만 남으므로 전체 변화와 합이 다를 수 있어요. 정전·병원 정전·민원은 따로 읽어요(${esc(gradeWords("G"))}).</p><p class="lg-hint lg-air-note">${airNoteHTML()}</p></section>`;
  }
  function eventQuestionHTML(V) {
    return (V.events || []).filter(ev => ev.round === V.round).map(ev => {
      const E = C.eventDef(R(), ev.id); if (!E || !C.hits(R(), E, L.team)) return "";
      const opt = E.opts?.find(o => o.id === (V.teams[L.team].resp || {})[`${V.round}:${ev.id}`]);
      return `<p>${esc(E.name)} · 예보 ${esc(evSize(E, { id: ev.id, round: ev.round }, V.teams[L.team]?.fcx?.[ev.id]))} / 확정 ${esc(evSize(E, ev))} ${E.opts?.length ? `/ 우리 대응: ${esc(String(opt?.name || "안 함").replace(/^대응\s*/, ""))}` : "/ 저장·다른 발전원으로 대비하는 사건"}</p>`;
    }).join("");
  }
  function rebuttalMetricsHTML(V, key, nb) {
    const id = L.team, c = V.econ.cities[id], prev = V.econ.before?.[id];
    const res = V.results.at(-1), old = V.results.at(-2), r = res?.team[id], p = old?.team[id];
    const rep = resultReport(V, res), oldRep = old && resultReport(V, old), saved = old && tdata().interview?.metrics?.[old.round];
    const balance = f => f ? f.revTotal - f.expTotal + (f.exp.capex || 0) : undefined;
    let rows;
    if (["lg-r-co2", "lg-r-outage"].includes(key)) rows = [["정전", p?.unsPct, r?.unsPct, "%"], ["CO₂", p && p.co2Prod * resultPeriod(V, old).mul, r && r.co2Prod * resultPeriod(V, res).mul, " t"]];
    else if (key === "lg-r-tax") rows = [["주민 세율", (saved?.taxRes ?? monthNote().n.startPolicy?.taxRes), c.policy?.taxRes, "단계"], ["노년 만족", prev?.groups?.senior, c.groups.senior, "점"]];
    else if (key === "lg-r-free") rows = [["운영 수지(건설 제외)", (balance(oldRep?.fiscal?.[id]) ?? saved?.balance), balance(rep?.fiscal?.[id]), "억"], ["지방채", prev ? Math.max(0, -prev.cash) : undefined, Math.max(0, -c.cash), "억"]];
    else rows = [[`${teamName(nb)} 정전`, old?.team[nb]?.unsPct, res?.team[nb]?.unsPct, "%"], ["연계선 분담비(누적)", (oldRep?.contrib?.[id]?.tieCost ?? saved?.tieCost), rep?.contrib?.[id]?.tieCost, "억"]];
    return `<dl class="lg-rebuttal-metrics" aria-label="반문 지표 두 개, 지난달과 이번 달">${rows.map(([label, before, after, unit]) => `<div><dt>${esc(label)}</dt><dd>${Number.isFinite(before) ? `${esc(fmt(before, 2))}${esc(unit)}` : "비교 없음"} → ${Number.isFinite(after) ? `${esc(fmt(after, 2))}${esc(unit)}` : "자료 없음"}</dd></div>`).join("")}</dl>`;
  }
  function needsReviewLoop(n) { return !n.skipped && !!n.evidence && !!(n.pred?.[n.topic || "uns"]); }
  function reasonStartsHTML(V) {
    const result = V.results.at(-1), r = result?.team[L.team], left = V.teams[L.team]?.left;
    if (!r) return "";
    const n = tdata().interview?.months?.[V.round] || {}, grid = promiseTopic(V, n) === "grid" ? gridReliance(V, result, L.team) : null;
    const starts = [...(Number.isFinite(grid?.perDay) ? [`이번 달 계통이 메운 전기 하루 평균 ${perDayText(grid.perDay)}이라서 `, "다음 달 시험에서 계통이 메운 전기가 줄어드는지 확인하고 "]
      : [`이번 달 정전 ${fmt(r.unsPct, 2)}%라서 `, `다음 달 시험에서 정전 ${fmt(r.unsPct, 2)}%가 줄어드는지 확인하고 `]), `남은 돈 ${fmt(left, 1)}억이라 `];
    return `<div class="lg-acts lg-reason-starts" aria-label="이유 문장 시작">${starts.map(text => `<button class="v2-btn" type="button" data-reason-start="${esc(text)}">${esc(text)}</button>`).join("")}</div>`;
  }
  function resultInterviewHTML(V, reviewOrder = false) {
    if (!V.econ || !["review", "end"].includes(V.phase)) return "";
    const { d, n } = monthNote(), x = questionContext(V), months = d.interview.months, asked = Object.values(months).filter(m => m.ask || m.quarterKey).length;
    if (!n.ask && !n.quarterKey && asked < IQ.max && (x.event || x.large || x.crossed || x.miss || V.round % Math.max(1, Math.ceil(C.roundsOf(V).length / IQ.target)) === 0)) {
      const key = chooseQuestion(x); if (key) { n.ask = key; n.nb = key === "lg-r-tie" ? n.rejectedOther : key === "lg-r-tie-accept" ? n.acceptedOther : x.nb; } putData(d);
    }
    if (x.crossed && !n.crossed) { n.crossed = true; putData(d); }
    const res = V.results.at(-1)?.team[L.team], prev = V.results.at(-2)?.team[L.team], c = V.econ.cities[L.team];
    const trial = matchingTrial(V, V.results.at(-1), L.team), baseUns = prev?.unsPct ?? trial?.unsPct;
    const unsChange = baseUns == null ? null : res.unsPct - baseUns, cashChange = c.cash - (V.econ.before?.[L.team]?.cash ?? c.cash);
    const pred = promiseResultHTML(V, n, reviewOrder);
    const key = n.ask || n.quarterKey, revisable = /^lg-[rpf]-/.test(key || ""), reflection = revisable || needsReviewLoop(n);
    const controls = reflection ? `<div class="lg-acts lg-decision-actions">${[["revise", "고치겠다"], ["keep", "유지하겠다"]].map(([k, name]) => `<button class="v2-btn" type="button" data-answer="${k}" aria-pressed="${n.answer === k}">${name}</button>`).join("")}</div>` : "";
    const rules = learningRuleHTML();
    const questionBody = n.ask ? `<p>${esc(questionText(n.ask, { nb: n.nb }))}</p>${n.ask === "lg-f-event" ? eventQuestionHTML(V) : ""}` : "";
    const questionReason = `<label class="lg-jq">이유 한 줄(기기에만)<textarea data-note="${revisable || !needsReviewLoop(n) ? "askReason" : "questionReason"}" rows="2" maxlength="1000">${esc((revisable || !needsReviewLoop(n) ? n.askReason : n.questionReason) || "")}</textarea></label>`;
    // 반문의 두 지표는 판단 근거라 접지 않는다. 접는 것은 질문 전문뿐이다.
    const rebuttal = /^lg-r-/.test(n.ask || "") ? rebuttalMetricsHTML(V, n.ask, n.nb) : "";
    const question = reviewOrder ? `${rebuttal}<details class="lg-question-full" data-decision-detail="question"><summary><span class="lg-question-preview">${questionBody.replaceAll("<p>", "").replaceAll("</p>", " ")}</span><span>질문 전문</span></summary>${questionBody}${!revisable && needsReviewLoop(n) ? questionReason : ""}</details>` : `${rebuttal}${questionBody}`;
    // c/i/d/e/h형 질문에는 선택 버튼을 붙이지 않는다. 고리의 수정은 별도 영역이다.
    const loop = needsReviewLoop(n) && !revisable ? `<section id="lg-loop-review" class="lg-sec"><h3>비교 뒤 유지·수정</h3>${controls}${reasonStartsHTML(V)}<label class="lg-jq">다음 선택의 이유<textarea data-note="askReason" rows="2" maxlength="1000">${esc(n.askReason || "")}</textarea></label><p id="lg-learning-mission">학습 미션: ${learningStatus(n, true)}</p>${rules}</section>` : "";
    const ask = n.ask ? `<section class="lg-ask lg-sec" data-question="${esc(n.ask)}">${reviewOrder && loop ? "" : `<h3>질문 한 장 <span class="tag-mine">연습용</span></h3>`}${question}${revisable ? controls : ""}${revisable || !needsReviewLoop(n) ? reasonStartsHTML(V) : ""}${reviewOrder && !revisable && needsReviewLoop(n) ? "" : questionReason}${needsReviewLoop(n) && revisable ? `<p id="lg-learning-mission">학습 미션: ${learningStatus(n, true)}</p>${rules}` : ""}</section>` : "";
    return `${pred}${loop}${ask}`;
  }

  function quarterHTML(V) {
    if (!V.econ || V.round % IQ.quarter !== 0 || !["review", "end"].includes(V.phase)) return "";
    const { d, n } = monthNote(), x = questionContext(V);
    if (n.ask || x.event || needsReviewLoop(n) || Object.values(d.interview.months).filter(m => m.ask || m.quarterKey).length >= IQ.max && !n.quarterKey) return "";
    if (!n.quarterKey) {
      const eligible = chooseQuestion({ ...x, last: null, allowed: ["lg-c-", "lg-i-"] });
      n.quarterKey = x.evaluation ? "lg-h-approval" : V.round / IQ.quarter % 2 === 0 ? "lg-d-headline" : eligible || "lg-d-headline"; putData(d);
    }
    const c = V.econ.cities[L.team], hist = c.hist, old = hist.at(-IQ.quarter - 1) || V.econ.before?.[L.team];
    return `<label class="lg-jq" id="lg-quarter" data-question="${esc(n.quarterKey)}"><span>분기 질문: ${esc(questionText(n.quarterKey, x))}</span><small>주민 ${esc(signed(c.pop - (old?.pop || c.pop)))}명 · 지지율 ${esc(fmt(c.approval, 1))}% · 현재 ${esc(V.econ.score.by[L.team].rank)}위${x.evaluation ? ` · 주민 평가 ${V.econ.report.review[L.team].pass ? "통과" : "미통과"}` : ""}</small><textarea data-note="quarterAnswer" rows="3" maxlength="1000">${esc(n.quarterAnswer || "")}</textarea></label>${L.role === "solo" ? `<button class="v2-btn" type="button" id="lg-quarter-skip">분기 질문 건너뛰기</button>` : ""}`;
  }
  function debriefHTML(E) {
    const top = E.score?.rank[0], rows = E.score?.rank || [];
    const V = L.role === "host" ? C.publicView(L.S, Date.now()) : L.snap;
    const arrivals = Object.fromEntries(rows.map(r => [r.id, 0]));
    (E.report?.flows?.pop || []).forEach(f => { arrivals[f.to] = (arrivals[f.to] || 0) + f.n; });
    const maxArrival = Math.max(0, ...Object.values(arrivals)), arrivalIds = Object.keys(arrivals).filter(id => arrivals[id] === maxArrival);
    const changedLeader = maxArrival > 0 && top && !arrivalIds.includes(top.id);
    const helped = (V?.results || []).some(res => Object.values(res.team || {}).some(r => r.imp > 0 && r.unsPct === 0));
    const cards = [changedLeader ? "이번 달 주민이 가장 많이 들어온 도시와 순위 1위 도시가 다릅니다. 무엇이 둘을 갈랐을까요?" : null, helped ? "이웃 전기를 받아 정전 없이 운영한 도시가 있어요. 그 대가(돈·배출·위험)는 누가 졌나요?" : null, "점수 가중치를 탄소 0.30으로 바꾸면 순위가 어떻게 바뀔까요?", "가장 늦게 효과가 나타난 결정은 무엇이었나요?", "이 게임이 현실과 가장 다른 점 하나를 꼽는다면?"];
    return `<section id="lg-debrief" class="lg-sec"><h2>디브리핑</h2><p>종합 1위 ${esc(top?.name || "")}${Number.isFinite(E.speeds?.monthsPerTurn ?? E.eduSpeed) ? ` · 주민·기업 이동 시간 ×${esc(fmt(E.speeds?.monthsPerTurn ?? E.eduSpeed, 2))}` : ""}</p>${Number.isFinite(E.speeds?.monthsPerTurn ?? E.eduSpeed) ? infoTip("debrief-speed", esc(speedText(E).slice(speedText(E).indexOf("("))), { label: "수업용 배속" }) : ""}<div class="lg-debriefcards">${cards.filter(Boolean).map((q, i) => `<article class="lg-card" data-debrief="${i + 1}"><h3>${i + 1}. ${esc(q)}</h3></article>`).join("")}</div>${L.role === "host" ? y2022LinkHTML("lg-y2022-host") : ""}<p>${esc((E.report?.news || []).slice(0, IQ.quarter).join(" → "))}</p><section id="lg-wsim"><div class="lg-info-line"><h3>가중치를 바꾸면?</h3>${infoTip("weights-note", "화면에서만 다시 계산해요. 원래 점수와 엔진 상태는 유지돼요. 모두 0이면 원래 점수를 써요.", { label: "가중치를 바꾸면?" })}</div>${SCORE_KEYS.map(k => [k, SCORE_NAMES[k]]).map(([k, name]) => `<label class="lg-policy"><span>${name} <output data-weight-value="${k}">${esc(fmt(params("wScore")[k], 2))}</output></span><input type="range" data-weight="${k}" min="0" max="1" step="0.05" value="${esc(params("wScore")[k])}"></label>`).join("")}<ol id="lg-wrank">${reweightScore(E.score, params("wScore")).map(r => `<li>${esc(r.name)} ${esc(fmt(r.score, 1))}점</li>`).join("")}</ol></section></section>`;
  }
  // 결정 목록의 예측 이름은 기기에 저장한 약속 주제를 따른다.
  function decisionsHTML(V) {
    const d = tdata(), months = d.interview?.months || {}, journal = d.journal || {};
    const rounds = [...new Set([...Object.keys(months), ...Object.keys(journal)])].map(Number).filter(t => t > 0 && t <= V.round).sort((a, b) => a - b);
    const item = t => {
      const n = months[t] || {}, topic = n.topic || "uns", parts = [];
      if (n.evidence?.text) parts.push(`근거 ${n.evidence.text}`);
      if (n.pred?.[topic]) parts.push(`예측 ${topic === "cash" ? "현금" : topic === "grid" ? "계통" : "정전"} ${DIRECTION_NAMES[n.pred[topic]] || n.pred[topic]}`);
      if (n.outcome && typeof n.outcome.hit === "boolean") parts.push(`판정 ${n.outcome.hit ? "예상과 같음" : "예상과 다름"}`);
      if (n.pred) parts.push(`학습 미션 ${learningStatus(n)}`);
      const cause = missedText(n); if (cause) parts.push(cause);
      const reason = nextChangeOf(d, t);
      if (reason.text) parts.push(`${n.answer === "keep" ? "유지할 이유" : "바꿀 이유"} ${reason.text}`);
      return parts.length ? `<li data-decision-month="${t}">${esc(monthName(V, t))} · ${esc(parts.reduce((text, part) => text + (text ? part.startsWith("판정 ") ? " → " : " · " : "") + part, ""))}</li>` : "";
    };
    // 내용이 남은 달 중 최근 석 달을 먼저 보인다. 빈 자동 기록은 접힘 달 수에도 넣지 않는다.
    const items = rounds.map(item).filter(Boolean), recent = items.slice(-3).join(""), older = items.slice(0, -3).join("");
    return `<section id="lg-decisions" class="lg-sec"><h3>결정과 결과 · 기기에 남은 기록</h3><ul>${recent || "<li>기기에 남은 결정 기록 없음</li>"}</ul>${older ? `<details data-decision-detail="older-months"><summary>앞의 ${items.length - 3}달 기록</summary><ul>${older}</ul></details>` : ""}</section>`;
  }
  function endHTML(V) {
    const { d } = monthNote(), inv = d.interview, end = inv.end || {};
    const crit = V.teams[L.team].crit, own = V.econ.score.by[L.team], top = V.econ.score.rank[0];
    const summary = `<section id="lg-final-summary" class="lg-sec"><h2>최종 순위</h2><p>${esc(teamName(L.team))} ${esc(own.rank)}위 · ${esc(fmt(own.score, 1))}점 / 종합 1위 ${esc(top.name)} ${esc(fmt(top.score, 1))}점</p></section>`;
    return `${summary}${decisionsHTML(V)}${KCP.fxEnd?.html(L.role === "solo" ? { ...V, results: L.S.results } : V, L.team) || ""}<p class="lg-season-chip">${esc(SEASON_NAME[curRound().season])} · ${esc(curRound().month)}월</p>${trendHTML(V, L.team, true)}${calibrationHTML("lg-final-calibration")}${finalCausesHTML(V)}${y2022LinkHTML("lg-y2022-end")}${rankHTML(V.econ, L.role !== "solo")}${L.role === "solo" ? soloReplayHTML(V) + debriefHTML(V.econ) : ""}<section id="lg-reflect" class="lg-sec"><h3>끝 성찰</h3><button class="v2-btn" type="button" id="lg-speak">말로 해 보기 · 2분</button><output id="lg-speak-time" aria-live="off">2:00</output><p>선언한 기준: ${esc(crit?.chips.map(k => SCORE_NAMES[k]).join(" · ") || "미선택")} · 지킬 선 ${esc(crit?.line ?? "–")}점</p><p>건너뛴 분기 질문 ${esc(Object.values(inv.months).filter(m => m.quarterSkip).length)}개</p>${END_Q.map((q, i) => `<label class="lg-jq"><span>${esc(L.role === "solo" ? q.replaceAll("우리", "내") : q)}</span><textarea data-end="${i}" rows="3" maxlength="1000">${esc(end[i] || "")}</textarea></label>`).join("")}<fieldset class="lg-pick"><legend>자기 점검 <span class="tag-mine">연습용 평가 기준</span></legend>${(KCP.HABITS || []).map(h => `<label class="lg-radio"><span><input type="checkbox" data-habit="${esc(h.k)}" ${inv.habits?.[h.k] ? "checked" : ""}>${esc(h.n)}</span></label>`).join("")}</fieldset><button class="v2-btn" type="button" id="lg-jcopy">활동지로 복사</button></section>`;
  }
  function finalCausesHTML(V) {
    // 혼자 하기·진행자는 전체 보고서를 보관한다. 공개 스냅에는 마지막 보고서만 있어
    // 팀은 받은 달별 원인을 기기 안에 기록한다. 자유 서술·새 네트워크 필드는 없다.
    const history = L.S?.results || V.results, saved = tdata().interview?.causes || {};
    const sums = new Map(); let months = 0;
    history.forEach(res => {
      const causes = resultReport(V, res)?.cities?.[L.team]?.causes || saved[res.round];
      if (!causes) return;
      months++;
      causes.forEach(c => {
        const old = sums.get(c.key) || { key: c.key, label: causeLabel(c), delta: 0 };
        old.delta += c.delta; sums.set(c.key, old);
      });
    });
    const reasons = visibleCauses([...sums.values()]).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, params("causeCount"));
    const runs = history.filter(res => res.team?.[L.team]), city = V.econ.cities[L.team];
    const totalHours = runs.reduce((sum, res) => sum + res.team[L.team].outH * resultPeriod(V, res).mul, 0);
    return `<section id="lg-final-causes" class="lg-sec"><h2>무엇이 이 결과를 만들었나</h2><p>${esc(runs.length)}달 누적 정전 ${esc(fmt(totalHours, 1))}시간(${esc(outageHoursDef(runs.reduce((days, res) => days + resultPeriod(V, res).days, 0), true))}) · 시작 대비 지지율 ${esc(signed(city.approval - city.approval0, 1))}%p</p>${reasons.map(c => `<p>${esc(causeLabel(c))}: 보고된 달별 지지율 기여 합 ${esc(signed(c.delta, 1))}%p</p>`).join("")}${infoTip("final-cause-note", `<p class="lg-hint">${esc(months)}/${esc(runs.length)}달 보고서의 주요 원인을 합친 추정(${esc(gradeWords("G"))})입니다. 달마다 상위 ${esc(params("causeCount"))}개만 남으므로 전체 변화와 합이 다를 수 있어요.${months < runs.length ? " 받지 못한 달은 합산에서 빠졌어요." : ""}</p>`, { label: "주요 원인" })}</section>`;
  }
  // 활동지에는 약속 주제에 맞는 예측과 기존 일지 기록을 모은다.
  function worksheet(V) {
    const d = tdata(), inv = d.interview || {}, c = V.econ?.cities[L.team], lines = [`[${R().name} 전력 리그] ${teamName(L.team)}`];
    if (c) {
      const grid = gridTotal(V, L.team);
      lines.push(`최종 지표: 주민 ${fmt(c.pop)}명 · 종사자 ${fmt(c.ind)}명 · 현금 ${fmt(c.cash, 1)}억 · 지지율 ${fmt(c.approval, 1)}%`, grid ? gridTotalText(V, grid) : "", ...SCORE_KEYS.map(k => `${SCORE_NAMES[k]} ${fmt(V.econ.score.by[L.team].parts[k], 1)}점`));
    }
    Object.entries(inv.months || {}).forEach(([rd, n]) => { lines.push(`■ ${(() => { const r = C.roundsOf(V)[Number(rd) - 1]; return r?.month ? `${r.year}년 ${r.month}월` : `${rd}라운드`; })()}`, n.crit ? `기준 ${n.crit.chips.map(k => SCORE_NAMES[k]).join(" · ")} / ${n.crit.line}점 / ${n.crit.choice === "keep" ? "유지" : "바꿈"}\n${n.critReason || ""}` : "", n.decision || "", n.evidence ? `근거: ${n.evidence.text}${n.confidence ? ` / 확신 ${CONFIDENCE[n.confidence]?.[0] || ""}` : ""}` : "", missedText(n), n.pred ? n.topic === "grid" ? `예측 계통 ${DIRECTION_NAMES[n.pred.grid] || "건너뜀"} / 비교 ${n.compared ? "완료" : "미완료"} / 학습 미션 ${learningStatus(n)}` : `예측: 정전 ${DIRECTION_NAMES[n.pred.uns] || "건너뜀"} / 현금 ${DIRECTION_NAMES[n.pred.cash] || "건너뜀"} / 비교 ${n.compared ? "완료" : "미완료"} / 학습 미션 ${learningStatus(n)}` : "", n.ask ? `${questionText(n.ask, { nb: n.nb, crit: n.crit })}\n${n.answer === "revise" ? "고침" : n.answer === "keep" ? "유지" : "미응답"}: ${n.askReason || ""}` : "", n.quarterKey ? `${questionText(n.quarterKey)}\n${n.quarterAnswer || (n.quarterSkip ? "건너뜀" : "")}` : "", ...JQ.map(q => `${journalQuestion(q.q, V)}\n${d.journal?.[rd]?.[q.k] || ""}`)); });
    Object.values(d.docs || {}).forEach(doc => (doc.journal || []).forEach(e => {
      lines.push(`■ 건설 일지 ${e.id}회 · ${e.days}일 · ${e.season || ""}`, `정전 ${fmt(e.m?.uns, 2)}% · CO₂ ${fmt(e.m?.co2)} t · 비용 ${fmt(e.m?.cost, 1)}억`, ...[["why", "무엇을 왜 지었나"], ["surprise", "예상 밖 결과"], ["trade", "얻는 것과 잃는 것"], ["next", "다음에 바꿀 것"], ["q", e.q || "오늘의 질문"]].map(([key, label]) => `${label}\n${e.a?.[key] || ""}`));
    }));
    (KCP.HABITS || []).forEach(h => lines.push(`${inv.habits?.[h.k] ? "✓" : "□"} ${h.n}`));
    END_Q.forEach((q, i) => lines.push(`■ ${journalQuestion(q, V)}\n${inv.end?.[i] || ""}`));
    return lines.filter(Boolean).join("\n\n");
  }
  function updateMission() {
    const out = document.getElementById("lg-learning-mission");
    if (out) out.textContent = `학습 미션: ${learningStatus(monthNote().n, true)}`;
  }
  function previousNoteHTML(V) {
    const d = tdata(), old = d.interview?.months?.[V.round - 1], change = nextChangeOf(d, V.round - 1);
    if (!old && !change.text) return "";
    const hasAnswer = !!(old?.ask || old?.quarterKey), reason = old?.questionReason || old?.askReason || old?.quarterAnswer || "";
    const sameReason = hasAnswer && !!change.text && change.text === reason.trim().replace(/\s+/g, " ");
    return `<details id="lg-previous-note" class="lg-sec" open><summary>지난달 답 · 다음에 바꿀 것 자세히</summary>${hasAnswer ? `<p>${esc(questionText(old.ask || old.quarterKey, { nb: old.nb }))}</p><p>${esc(old.answer === "revise" ? "고치겠다" : old.answer === "keep" ? "유지하겠다" : "한 줄 답")}: ${esc(reason || "미응답")}</p>` : ""}${sameReason ? "" : `<p>다음에 바꿀 것${change.answer}: ${esc(change.text || "아직 쓰지 않음")}</p>`}</details>`;
  }
  function weightSimulation(E, weights) {
    if (!E.scoreState || !KCP.econ) return reweightScore(E.score, weights);
    const total = Object.values(weights).reduce((a, v) => a + Math.max(0, v), 0);
    if (!total) return E.score.rank;
    const data = { ...KCP.ECON_DATA, params: { ...KCP.ECON_DATA.params, wScore: { ...KCP.ECON_DATA.params.wScore, v: weights } } };
    return KCP.econ.score(E.scoreState, data).rank;
  }
  function updateWeights(root, E) {
    const weights = Object.fromEntries([...root.querySelectorAll("[data-weight]")].map(el => [el.dataset.weight, +el.value]));
    root.querySelectorAll("[data-weight-value]").forEach(el => { el.textContent = fmt(weights[el.dataset.weightValue], 2); });
    const target = root.querySelector("#lg-wrank"); if (target) target.innerHTML = weightSimulation(E, weights).map(r => `<li>${esc(r.name)} ${esc(fmt(r.score, 1))}점</li>`).join("");
  }

  const K_SOLO = "kcp-league-solo-v1";
  let pendingSolo = null, soloNotice = "";
  let soloSaveFailed = false, soloSaveWarned = false;
  function warnSoloSave() {
    if (!soloSaveFailed || soloSaveWarned || !document.getElementById("lg-bar")) return;
    soloSaveWarned = true;
    BG.toast("진행을 저장하지 못했어요. 브라우저 저장 공간·설정을 확인해요.", { warn: true });
  }
  function writeSolo(save) {
    // JSON은 -0을 0으로 쓴다. 경제 보고서의 원본 값도 맞춰 저장·복원 비교가 같게 한다.
    if (!store.set(K_SOLO, save, function (key, value) {
      if (Object.is(value, -0)) { this[key] = 0; return 0; }
      return value;
    })) soloSaveFailed = true;
    else { soloSaveFailed = false; soloSaveWarned = false; }
    warnSoloSave();
  }
  function saveSolo() {
    if (L?.role === "solo") writeSolo({ v: 1, state: L.S, team: L.team, style: L.style, interview: L.interview, aiRound: L.aiRound || 0, initial: L.initial, previous: L.previous });
  }
  // 실패 응답·예외·중첩 요청에서도 마지막 상태를 저장한다. 멀티는 기존 경로를 그대로 쓴다.
  function soloMutate(fn) {
    const session = L;
    if (session?.role !== "solo") return fn();
    session.mutating = (session.mutating || 0) + 1;
    // 예외면 반쯤 바뀐 상태를 저장하지 않는다(새로고침하면 마지막 정상 저장으로 돌아간다).
    let ok = false;
    try { const r = fn(); ok = true; return r; }
    finally { if (--session.mutating === 0 && L === session && ok) saveSolo(); }
  }
  window.addEventListener("pagehide", () => { saveSolo(); flushHost(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveSolo(); });
  function startSolo(app, fresh) {
    let validSave = false;
    try {
      const save = fresh || pendingSolo || store.get(K_SOLO);
      pendingSolo = null;
      const object = x => !!x && typeof x === "object" && !Array.isArray(x);
      const valid = save?.state?.region === REGION && object(save.state.teams) && C.validTeams(R(), Object.keys(save.state.teams)).ok
        && typeof save.team === "string" && Object.hasOwn(save.state.teams, save.team) && object(save.state.teams[save.team])
        && actT(save.state).some(t => t.id === save.team) && object(save.interview)
        && object(save.state.econ?.cities) && Object.hasOwn(save.state.econ.cities, save.team) && object(save.state.econ.cities[save.team]);
      if (!valid) throw new Error("solo-save");
      validSave = true;
      if (L?.role !== "solo") {
        close();
        L = { role: "solo", room: save.state.room, S: save.state, team: save.team, style: save.style || "balanced", token: save.state.teams[save.team].token, timers: [], snap: null, rev: 0, planT: 0, skew: 0, interview: save.interview || { docs: {}, journal: {} }, aiRound: save.aiRound || 0, initial: save.initial || null, previous: save.previous || null };
        const listeners = {}, session = L;
        L.conn = { kind: "solo", status: () => "open", close() {}, on(ev, fn) { listeners[ev] = fn; }, onStatus(fn) { fn("open"); }, send(ev, m) {
          if (ev !== "req" || L !== session) return;
          soloMutate(() => {
            const result = C.reduce(L.S, m, 0, BG);
            if (!result.ok) { listeners.nack?.({ ...m, err: result.err }); return; }
            if (m.type === "tie" && L.S.phase === "plan") C.computerPlans(L.S, BG, L.team, L.style, true);
            BG.selectPack(C.teamDef(R(), L.team).pack, "league");
            queueMicrotask(() => { if (L === session) soloMutate(() => listeners.snap?.(C.publicView(L.S, Date.now()))); });
          });
        } };
        L.conn.on("snap", onSnap); L.conn.on("nack", nack);
      }
      L.app = app;
      soloMutate(() => {
        if (L.S.phase === "lobby") { C.host(L.S, "next", 0); L.S.ends = null; }
        soloComputers();
        L.snap = C.publicView(L.S, Date.now());
        mountCity(app);
        if (L.S.phase === "end" || L.S.phase === "review") openPanel("result");
        else closePanel();
      });
      warnSoloSave();
    } catch (e) {
      close(); pendingSolo = null;
      // 정상 저장을 읽은 뒤의 컴퓨터 계산·화면 오류는 진행 기록을 지우지 않는다.
      if (validSave) soloNotice = "혼자 하기 화면을 열지 못했어요. 저장된 진행은 유지돼요.";
      else { store.del(K_SOLO); soloNotice = "저장값을 읽지 못해 지웠어요. 새로 시작해요."; }
      if (location.hash !== "#league") location.hash = "#league"; else lobby(app);
    }
  }
  function soloComputers() {
    if (L.S.phase !== "plan" || L.aiRound === L.S.round) return;
    soloMutate(() => {
      if (KCP.leagueAI?.plan) {
        C.computerPlans(L.S, BG, L.team, L.style, false);
        // 뒤 도시가 보낸 제안에도 앞 도시가 답할 수 있도록 응답을 한 번 더 통과시킨다.
        C.computerPlans(L.S, BG, L.team, L.style, true);
        L.aiRound = L.S.round;
      }
      BG.selectPack(C.teamDef(R(), L.team).pack, "league");
    });
  }
  function soloNext() {
    if (L.away || L.busy || L.S.phase === "end") return;
    L.busy = true;
    try {
      soloMutate(() => {
        clearTimeout(L.planT);
        if (L.S.phase === "plan") {
          sendPlan(); soloComputers(); C.computerPlans(L.S, BG, L.team, L.style, true);
          C.reduce(L.S, { type: "ready", team: L.team, token: L.token, ready: true }, 0, BG);
          C.run(L.S, BG, 0);
          const { d, n } = monthNote(); n.big = n.big || largeDecision(); putData(d);
        } else C.host(L.S, "next", 0);
        L.S.ends = null; soloComputers();
        BG.selectPack(C.teamDef(R(), L.team).pack, "league");
        onSnap(C.publicView(L.S, Date.now()));
      });
    } finally { L.busy = false; }
  }
  function readyAction(skip) {
    if (L.away) return;
    const V = L.snap;
    if (!V) return;
    if (skip && !freeExperiment()) return;
    unlockAudio();
    const { d, n } = monthNote();
    if (V.phase === "plan" && !V.teams[L.team].ready && !n.issueCheckPassed) {
      const issues = planIssueCounts();
      if (issues.unlinked || issues.supplyMW === 0) { showIssueCheck(skip); return; }
    }
    if (!skip && !L.awaitReady && needsLoop(V) && !n.confirmed) { L.awaitReady = true; openPanel("journal"); renderBar(); return; }
    if (V.econ && V.phase === "plan") {
      const crit = criterionDraft(V), el = document.getElementById("lg-crit-line");
      if (el) crit.line = el.valueAsNumber;
      if (crit.chips.length) {
        if (!validCritLine(crit.line)) { BG.toast("지킬 선은 0~100의 정수로 적어요"); return; }
        if (!crit.choice) { BG.toast("올해 기준을 유지할지 바꿀지 골라요"); openPanel("journal"); return; }
        if (curRound().month === 1 && crit.choice === "change" && !n.critReason?.trim()) { BG.toast("기준을 바꾸는 이유를 한 줄 적어요"); openPanel("journal"); return; }
        n.crit = crit; send("crit", crit);
      }
    }
    if (!skip && needsLoop(V) && (!n.evidence || !Object.hasOwn(DIRECTION_NAMES, n.pred?.[promiseTopic(V, n)] || "") || !Object.hasOwn(CONFIDENCE, n.confidence || ""))) {
      BG.toast("근거 하나·결과 방향·확신을 먼저 정해요"); L.awaitReady = true; openPanel("journal"); return;
    }
    if (V.phase === "plan") n.planIssues = planIssueCounts();
    n.skipped = !!skip; n.buildCost = newBuildCost(V); n.buildBudget = V.teams[L.team].budget; n.buildCount = BG.current()?.builds.length; n.lineCount = BG.current()?.lines.length;
    const trial = BG.lastTrial?.(), result = trial?.result || trial;
    if (trial && (!trial.round || trial.round === V.round)) {
      const unsPct = result.unsPct ?? (result.tot?.dem > 0 ? 100 * result.unsTotal / result.tot.dem : undefined);
      if (Number.isFinite(unsPct)) n.trial = { unsPct, ...(Number.isFinite(trial.gridMWh) && trial.days > 0 ? { gridMWh: trial.gridMWh, days: trial.days, ...(Number.isFinite(trial.co2) ? { co2: trial.co2 } : {}) } : {}) };
    }
    const preparing = L.role === "solo" || !V.teams[L.team].ready;
    // 약속 확인은 준비 해제 뒤에도 유지한다. 다음 달 계획의 확정값은 아래에서 따로 해제한다.
    if (needsLoop(V)) n.topic = promiseTopic(V, n);
    n.confirmed = true; n.big = n.big || largeDecision();
    const old = d.interview.months[V.round - 1];
    if (needsLoop(V) && old && !legacyLearningNote(old)) {
      confirmFollowingPlan(old, preparing ? currentPlanDifference(V) : { known: false }, "ready");
    }
    if (L.role !== "solo") L.wantReady = preparing;
    putData(d); L.awaitReady = false; signal("ready"); renderBar();
    if (L.role === "solo") soloNext();
    else { clearTimeout(L.planT); sendPlan(); send("ready", { ready: !V.teams[L.team].ready }); }
  }
  function restartSolo() {
    if (!window.confirm("처음부터 시작하면 이 판의 진행과 일지·답변이 지워집니다. 다시 시작할까요?")) return;
    close(); store.del(K_SOLO); location.hash = "#league";
  }
  function soloSummary(V) {
    const c = V.econ.cities[L.team], r = V.econ.score.by[L.team];
    return { score: r.score, pop: c.pop, cash: c.cash, approval: c.approval, uns: V.results.at(-1)?.team[L.team]?.unsPct };
  }
  function soloReplayHTML(V) {
    const now = soloSummary(V), old = L.previous;
    return `<section id="lg-solo-replay" class="lg-sec"><h3>지난 판과 비교</h3>${old ? [["score", "점수", "점"], ["pop", "주민", "명"], ["cash", "현금", "억"], ["approval", "지지율", "%p"], ["uns", "정전(마지막 달)", "%p"]].map(([key, label, unit]) => `<p>${label} ${fmt(old[key], 1)} → ${fmt(now[key], 1)} · ${signed(now[key] - old[key], 1)}${unit}</p>`).join("") : "<p>첫 판이에요. 같은 조건으로 다시 하면 차이를 비교해요.</p>"}${L.initial ? '<button class="v2-btn" type="button" id="lg-solo-same">같은 조건으로 다시</button>' : '<p>예전 저장 기록에는 시작 조건이 없어요. 새 판부터 같은 조건을 저장해요.</p>'}</section>`;
  }
  function replaySolo() {
    if (L.role !== "solo" || L.snap.phase !== "end" || !L.initial) return;
    const app = L.app, save = { v: 1, state: structuredClone(L.initial), initial: structuredClone(L.initial), previous: soloSummary(L.snap), team: L.team, style: L.style, interview: { docs: {}, journal: {}, freeExperiment: L.interview?.freeExperiment }, aiRound: 0 };
    close(); writeSolo(save); startSolo(app, save);
  }

  function econClick(e) {
    if (!L.snap?.econ) return false;
    if (e.target.closest("#lg-speak")) {
      const session = L; L.speakUntil = Date.now() + 2 * 60 * 1000;
      if (L.speakTimer) clearInterval(L.speakTimer);
      L.speakTimer = setInterval(() => { if (L !== session) return; const out = document.getElementById("lg-speak-time"); if (out) out.textContent = mmss(L.speakUntil - Date.now()); if (Date.now() >= L.speakUntil) clearInterval(L.speakTimer); }, 1000);
      L.timers.push(L.speakTimer); return true;
    }
    if (e.target.closest("#lg-solo-same")) { replaySolo(); return true; }
    const V = L.snap, { d, n } = monthNote(), chip = e.target.closest("[data-crit]"), choice = e.target.closest("[data-crit-choice]");
    if (chip || choice) {
      if (V.phase !== "plan") return true;
      const old = criterionDraft(V), crit = { ...old, chips: old.chips.slice() };
      if (chip) {
        const key = chip.dataset.crit;
        if (crit.chips.includes(key)) { if (crit.chips.length === 1) return true; crit.chips = crit.chips.filter(k => k !== key); }
        else { if (crit.chips.length === 2) crit.chips.shift(); crit.chips.push(key); }
      }
      if (choice) crit.choice = choice.dataset.critChoice;
      const el = document.getElementById("lg-crit-line"); if (el) crit.line = el.valueAsNumber;
      n.crit = crit; putData(d); queueCrit(crit);
      if (!validCritLine(crit.line)) { BG.toast("지킬 선은 0~100의 정수로 적어요"); return true; }
      const panel = document.getElementById("lg-panel");
      panel.querySelectorAll("[data-crit]").forEach(b => b.setAttribute("aria-pressed", String(crit.chips.includes(b.dataset.crit))));
      panel.querySelectorAll("[data-crit-choice]").forEach(b => b.setAttribute("aria-pressed", String(crit.choice === b.dataset.critChoice)));
      if (el) el.parentElement.firstChild.textContent = `${SCORE_NAMES[crit.chips[0]] || "선택 첫 항목"} 지킬 선(점 이상)`;
      if (crit.chips.length && crit.choice) send("crit", crit);
      renderPanel(); return true;
    }
    const evidence = e.target.closest("[data-evidence]");
    if (evidence && V.phase === "plan") {
      const options = evidenceOptions(V), item = options.find(x => x.key === evidence.dataset.evidence);
      const start = item && evidenceAtStart(item, n);
      if (start && Number.isFinite(start.value)) {
        n.evidence = { ...start, ...(Number.isFinite(item.value) ? { nowValue: item.value } : {}) };
        n.evidenceValues = Object.fromEntries(options.filter(x => Number.isFinite(x.value)).map(x => [x.key, x.value]));
        n.confirmed = false; putData(d); renderPanel();
      }
      return true;
    }
    const confidence = e.target.closest("[data-confidence]"), missed = e.target.closest("[data-missed]");
    if (confidence && V.phase === "plan") { n.confidence = confidence.dataset.confidence; n.topic = promiseTopic(V, n); n.confirmed = false; putData(d); renderPanel(); return true; }
    if (missed && ["review", "end"].includes(V.phase) && !n.outageOpened && Object.hasOwn(MISS_NAMES, missed.dataset.missed)) {
      const a = outageAttribution(V, V.results.at(-1), L.team, n);
      n.missed = missed.dataset.missed;
      n.missedBasis = a ? a.basis || "trial" : V.econ && V.round > 1 ? "monthly" : "trial";
      putData(d); renderPanel(); return true;
    }
    if (e.target.closest("#lg-outage-open") || e.target.closest("#lg-outage-carry")) {
      if (!["review", "end"].includes(V.phase)) return true;
      const a = outageAttribution(V, V.results.at(-1), L.team, n);
      if (!a) return true;
      const { single, largest, frozenPicked, opened } = outageCardState(a, n);
      if (e.target.closest("#lg-outage-open")) {
        if (single || !outageCardCandidates(a.parts, a).some(p => p.key === n.missed)) return true;
        n.outageOpened = true;
      } else {
        if (single) {
          if (!shownOutageElement(document.getElementById("lg-panel"), "#lg-outage-single")) return true;
          n.outageSingleShown = true;
        } else if (!opened) return true;
        n.missedCarry = { basis: a.basis || "trial", ...(a.target ? { target: a.target } : {}), ...(a.unit ? { unit: a.unit } : {}), missed: frozenPicked ? n.missed : largest ? single ? "고르기 생략" : n.missed : outageNoCauseLabel(a),
          ...(largest ? { largest: { ...largest } } : {}) };
      }
      if (!n.outageFrozen || outageLegacyGrid(n.outageFrozen)) n.outageFrozen = structuredClone(a);
      n.outageNoCause = !largest;
      if (largest) n.outageLargest = { ...largest };
      else { delete n.outageLargest; if (n.missedCarry) delete n.missedCarry.largest; }
      putData(d); renderPanel();
      if (e.target.closest("#lg-outage-open")) {
        // 공개 순간(카드 앞면의 몫·꼬리표와 폭포 첫 줄)이 화면 위에 오게 한다. 초점은 판정 머리로 옮기되 스크롤은 하지 않는다.
        document.getElementById("lg-outage-verdict")?.focus({ preventScroll: true });
        scrollPanelTo(document.getElementById("lg-outage-cards") || document.getElementById("lg-missed"));
      }
      return true;
    }
    const group = e.target.closest("[data-group]");
    if (group) { L.group = L.group === group.dataset.group ? null : group.dataset.group; renderPanel(); return true; }
    const answer = e.target.closest("[data-answer]");
    if (answer) { n.answer = answer.dataset.answer; putData(d); renderPanel(); revealDecisionReason(); return true; }
    if (e.target.closest("#lg-ready-confirm")) { readyAction(false); return true; }
    if (e.target.closest("#lg-predict-skip") && freeExperiment()) { readyAction(true); return true; }
    if (e.target.closest("#lg-quarter-skip")) { n.quarterSkip = true; putData(d); BG.toast("분기 질문을 건너뛰었어요"); return true; }
    return false;
  }
  function econChange(e) {
    if (!L.snap?.econ) return false;
    const pol = e.target.closest("[data-pol]"), line = e.target.closest("#lg-crit-line"), note = e.target.closest("[data-note]"), pred = e.target.closest("[data-pred]"), end = e.target.closest("[data-end]"), weight = e.target.closest("[data-weight]"), habit = e.target.closest("[data-habit]");
    const { d, n } = monthNote();
    if (e.target.matches("[data-compared]")) { n.compared = e.target.checked; putData(d); renderPanel(); return true; }
    if (habit) { d.interview.habits = d.interview.habits || {}; d.interview.habits[habit.dataset.habit] = habit.checked; putData(d); return true; }
    if (pol) {
      const policy = Object.fromEntries([...pol.closest("#lg-econpol").querySelectorAll("[data-pol]")].map(el => [el.dataset.pol, el.type === "checkbox" ? el.checked : +el.value]));
      n.startPolicy = n.startPolicy || L.snap.teams[L.team].econPol || L.snap.econ.cities[L.team].policy;
      L.pendingPol = { ...policy, [pol.dataset.pol]: pol.type === "checkbox" ? pol.checked : +pol.value };
      n.big = true; n.policy = Object.keys(L.pendingPol).some(k => L.pendingPol[k] !== (n.startPolicy?.[k] ?? (k === "re100" ? false : 0))); n.confirmed = false; putData(d); send("econ", { ...L.pendingPol }); return true;
    }
    if (line) {
      if (e.type !== "input" || L.snap.phase !== "plan") return true;
      const crit = { ...criterionDraft(L.snap), line: line.valueAsNumber };
      n.crit = crit; putData(d); queueCrit(crit); return true;
    }
    if (note) { n[note.dataset.note] = note.value.slice(0, 1000); putData(d); updateMission(); return true; }
    if (pred) { n.topic = pred.dataset.pred; n.pred = {}; n.pred[pred.dataset.pred] = pred.value; n.confirmed = false; putData(d); const b = document.getElementById("lg-ready-confirm"); if (b) b.disabled = !(n.evidence && n.pred[n.topic] && n.confidence); const remaining = document.getElementById("lg-promise-remaining"); if (remaining) remaining.textContent = b?.disabled ? `남은 단계: ${!n.evidence ? "근거" : !n.pred[n.topic] ? "방향" : "확신"}` : "준비할 수 있어요"; return true; }
    if (end) { d.interview.end = d.interview.end || {}; d.interview.end[end.dataset.end] = end.value.slice(0, 1000); putData(d); return true; }
    if (weight) { updateWeights(document.getElementById("lg-panel"), L.snap.econ); return true; }
    return false;
  }

  function lobbyCityInfo(t, compact = false) {
    const stat = KCP.ECON_DATA?.start?.[t.id], ties = R().ties.filter(x => x.a === t.id || x.b === t.id);
    const facts = stat ? `<dl class="lg-city-facts"><dt>시작 주민</dt><dd>${esc(fmt(stat.pop0))}명</dd>${compact ? "" : `<dt>시작 종사자</dt><dd>${esc(fmt(stat.ind0))}명</dd>`}<dt>시작 재정자립도</dt><dd>${esc(fmt(stat.fsr0 * 100, 1))}%</dd></dl>` : "";
    return `<div class="${compact ? "lg-chosen-city" : "lg-city-profile"}"><h2>${esc(t.name)}</h2>${facts}</div>${compact ? "" : `<p class="lg-hint">이웃 연계선 후보 ${ties.length}곳 · ${esc(ties.map(x => teamName(x.a === t.id ? x.b : x.a)).join(" · "))}</p>`}${stat ? sourceHTML(t.id) : ""}<p class="lg-hint">${ASSUMPTIONS}</p>`;
  }
  KCP.paintLeaguePreview = cv => renderBoard(cv, { active: R().teams.map(t => t.id), teams: {}, ties: [] }, null, false, { mode: "home" });

  function soloDefaultCity(reg, saved) {
    if (saved?.state && reg.teams.some(t => t.id === saved.team)) return saved.team;
    // 지역 자료의 필수 도시(reg.must)가 첫 경험의 기본이다. 없을 때만 시작 지도 기존 발전소 용량으로 고른다.
    const must = (reg.must || []).find(id => reg.teams.some(t => t.id === id));
    if (must) return must;
    // 시작 지도 기존 발전소 용량(게임 MW): build-maps.js sites[].cap. 외부 접속점은 설비에 넣지 않는다.
    const capacity = t => (BG.PACKS[t.pack]?.sites || []).reduce((mw, site) => mw + (site.kind === "plant" && Number.isFinite(site.cap) ? site.cap : 0), 0);
    return reg.teams.reduce((best, t) => !best || capacity(t) > capacity(best) ? t : best, null)?.id;
  }

  /* ================= 로비 ================= */
  function lobby(app, joinArg, initialMode = "solo") {
    lobbyStop?.();
    document.documentElement.classList.remove("v2-league-seat", "v2-league-host");
    document.documentElement.classList.add("v2-league-lobby");
    let pre = null;
    if (joinArg) { try { pre = JSON.parse(b64d(joinArg)); } catch (e) { pre = null; } }
    let keyNotice = "";
    const savedNet = netCfg();
    if (NET.publicKeyProblem(savedNet.key)) {
      store.set(K_NET, { ...savedNet, key: "" });
      keyNotice = PUBLIC_KEY_NOTICE;
    }
    if (pre && pre.n && pre.n.kind === "supabase") {
      const cfg = { kind: "supabase", url: String(pre.n.url || ""), key: String(pre.n.key || "") };
      if (NET.publicKeyProblem(cfg.key)) { keyNotice = JOIN_KEY_NOTICE; pre = null; initialMode = "join"; }
      else store.set(K_NET, cfg);
    }
    const soloSave = store.get(K_SOLO);
    const net = { ...netCfg() }, hostSave = store.get(K_HOST), lastTeam = store.get(K_TEAM);
    if (NET.publicKeyProblem(net.key)) net.key = ""; // 저장에 실패해도 거부 대상 키는 화면에 넣지 않는다.
    const reg = R();
    let syncLobby = null;
    const mustCity = id => (reg.must || []).includes(id);
    const soloCity = soloDefaultCity(reg, soloSave);
    const seedChoice = id => `<label class="lg-field" for="${id}">날씨·사건<select id="${id}" style="min-height:44px"><option value="room">방마다 다르게(기본)</option><option value="fixed">고정(다시 해 보기용)</option></select></label>`;
    const cityChecks = solo => reg.teams.map(t => `<label class="lg-pickcity" style="--c:${esc(t.color)}"><input class="lg-chipcheck" type="checkbox" ${solo ? `data-solo-city="${esc(t.id)}"` : `value="${esc(t.id)}"`} checked ${mustCity(t.id) ? "disabled" : ""}><span>${esc(t.name)}${mustCity(t.id) ? ' <small aria-label="필수 도시">🔒</small>' : ""}</span></label>`).join("");
    const choices = (id, label, options) => `<fieldset class="lg-pick lg-choice"><legend><label for="${id}">${label}</label></legend><select class="lg-contract" id="${id}" aria-label="${label}">${options.map(([v, name, selected]) => `<option value="${esc(v)}" ${selected ? "selected" : ""}>${esc(name)}</option>`).join("")}</select><div class="lg-presets" role="group" aria-label="${label}">${options.map(([v, name]) => `<button class="lg-preset" type="button" data-select="${id}" data-value="${esc(v)}" aria-pressed="false">${esc(name)}</button>`).join("")}</div></fieldset>`;
    app.innerHTML = `
      <main class="lg-lobby" data-mode="solo">
        <header class="lg-topline">
          <a class="lg-back" href="#home">← 연습실 홈</a>
          <div class="lg-title"><p class="v2-kicker"><span>GRID TYCOON</span> · 전력 리그</p><h1>${esc(reg.name)}</h1></div>
          <nav class="lg-modes" aria-label="플레이 모드">${[["solo", "혼자 하기"], ["join", "팀으로 참가"], ["host", "진행자(교사)"]].map(([mode, name]) => `<button type="button" data-mode="${mode}" aria-pressed="${mode === "solo"}" aria-controls="${mode === "solo" ? "lg-solo" : `lg-mode-${mode}`}">${name}</button>`).join("")}</nav>
          <span class="lg-hud-pill">도시 <b>${reg.teams.length}곳</b></span>
        </header>
        <div class="lg-control-room">
        <section class="lg-world" aria-label="리그 지역과 도시 선택">
          <header class="lg-lhead">
          <p class="lg-sub">도시 하나씩 맡아 전력망을 짓고 주민·기업을 겨룹니다.</p>
          </header>
          <figure class="lg-worldmap">
            ${reg.board ? '<canvas id="lg-lobby-map" role="img" aria-label="참가 도시 광역 지도. 아래 도시 칩으로도 선택할 수 있어요."></canvas>' : `<ul class="lg-cities">${reg.teams.map(t => `<li style="--c:${esc(t.color)}">${esc(t.name)}</li>`).join("")}</ul>`}
          </figure>
          <p class="lg-maphelp" id="lg-maphelp">지도에서 내 도시를 눌러요 · 🔒 필수 도시</p>
        </section>
        <section class="lg-setup" aria-label="새 게임 설정">
          <div class="lg-cards">
          <article class="lg-card" id="lg-solo" data-panel="solo" data-active="true"><header class="lg-modehead"><h2>혼자 하기</h2><p class="lg-hint">컴퓨터 도시와 겨룹니다. 한 탭에서 끝까지.</p>${soloNotice ? `<p class="lg-hint">${esc(soloNotice)}</p>` : ""}</header>
            <div class="lg-modebody">
            ${dataNoticeHTML("solo")}<div class="lg-launch"><button class="v2-btn primary lg-big" type="button" id="lg-solo-start">혼자 시작</button>${soloSave?.state ? `<a class="v2-btn lg-big" id="lg-solo-resume" href="#league/solo">이어서 하기</a><button class="v2-btn" type="button" id="lg-solo-reset">처음부터</button>` : ""}</div>
            <div class="lg-options">
            <div class="lg-citysettings">
            ${choices("lg-solo-city", "내 도시", reg.teams.map(t => [t.id, t.name, t.id === soloCity]))}<div id="lg-lobby-city-info" class="lg-lobby-city-info"></div>
            <fieldset class="lg-pick"><legend>함께할 도시 · 나와 컴퓨터 포함</legend><div class="lg-solo-cities">${cityChecks(true)}</div>${infoTip("solo-cities", "🔒 필수 도시 · 내 도시 외에는 컴퓨터가 맡아요.", { label: "함께할 도시" })}</fieldset>
            </div>
            <div class="lg-gamesettings">
            ${choices("lg-solo-turns", "게임 길이", [12, 24, 36].map(n => [String(n), `${n}달`]))}
            <div class="lg-info-line" id="lg-solo-turnmsg"></div>
            ${choices("lg-solo-style", "컴퓨터 성향", [["careful", "신중"], ["balanced", "균형", true], ["bold", "공격"]])}
            <details class="lg-extra-settings"><summary>날씨·사건 · 연습 방식</summary><div>${seedChoice("lg-solo-seed")}<label class="lg-field">연습 방식<select id="lg-solo-practice"><option value="free">자유 실험(약속 건너뛰기 가능)</option><option value="promise">약속 연습</option></select></label></div></details>
            </div>
            </div>
            </div>
          </article>
          <article class="lg-card" id="lg-mode-join" data-panel="join" data-active="false">
            <header class="lg-modehead"><h2>팀으로 참가</h2><p class="lg-hint">진행자 화면의 방 코드를 넣어요.</p></header>
            <div class="lg-modebody">
            <label class="lg-field"><span>방 코드</span><input id="lg-code" aria-label="방 코드" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" minlength="8" maxlength="32" value="${esc(pre && validRoom(pre.r) ? displayRoom(pre.r) : "")}" placeholder="ABCD-EFGH" aria-describedby="lg-code-h"></label>
            <p class="lg-hint" id="lg-code-h">진행자 화면의 8글자 · 하이픈·공백은 생략해도 됩니다</p>
            <button type="button" class="v2-btn primary lg-big" id="lg-join">참가하기</button>
            ${lastTeam && validRoom(lastTeam.room) && lastTeam.team ? `<button type="button" class="v2-btn lg-big" id="lg-rejoin">이어서: ${esc(teamName(lastTeam.team))} 팀 · 방 ${esc(lastTeam.room)}</button>` : ""}
            </div>
          </article>
          <article class="lg-card" id="lg-mode-host" data-panel="host" data-active="false">
            <header class="lg-modehead"><h2>진행자(교사)</h2><p class="lg-hint">방을 만들고 달을 넘깁니다. 프로젝터용 화면.</p></header>
            <div class="lg-modebody">
            <div class="lg-options">
            <fieldset class="lg-pick">
              <legend>참가 도시 <b id="lg-pickn"></b></legend>
              <div class="lg-presets" role="group" aria-label="인원별 추천">${[2, 3, 4, 5, 6].map(n => `<button type="button" class="lg-preset" data-preset="${n}" aria-pressed="${n === 6}">${n}팀</button>`).join("")}</div>
              <div class="lg-pickc">${cityChecks(false)}</div>
              <p class="lg-hint" id="lg-pickmsg">${esc(withParticle((reg.must || []).map(teamName).join(" · "), "은는"))} 꼭 들어가고, 고른 도시끼리 이웃해야 해요.</p>
            </fieldset>
            <fieldset class="lg-pick">
              <legend>게임 길이</legend>
              <div class="lg-presets" role="group" aria-label="게임 길이">${[[0, "계절 4라운드"], [12, "12달(1년)"], [24, "24달"], [36, "36달"]].map(([n, t]) => `<button type="button" class="lg-preset" data-turns="${n}" aria-pressed="${n === 12}">${t}</button>`).join("")}</div>
              ${seedChoice("lg-host-seed")}<label class="lg-field">수업 시간<select id="lg-class-time"><option value="50">50분</option><option value="100" selected>100분</option><option value="0">제한 없음</option></select></label><p class="lg-hint">진행자 타이머의 기본값만 바꿔요. 자동으로 달을 넘기지 않아요.</p><p class="lg-hint" id="lg-class-split" aria-live="polite"></p>
              <p class="lg-hint" id="lg-turnmsg">1턴 = 1달. ${esc(subsidyText())} 세금은 달마다 받아요. 주민·기업은 살기 좋은 도시로 옮겨 가요.</p>
            </fieldset>
            </div>
            ${!NET.secure() ? '<p role="alert">이 주소에서는 팀이 앉을 수 없어요(https 주소나 이 기기 안에서만)</p>' : ""}${dataNoticeHTML("host")}<div class="lg-launch"><button type="button" class="v2-btn primary lg-big" id="lg-host">새 방 만들기</button>
            ${hostSave && validRoom(hostSave.room) ? `<button type="button" class="v2-btn lg-big" id="lg-rehost">이어서 진행: 방 ${esc(hostSave.room)}</button>` : ""}
            </div>
            </div>
          </article>
          </div>
        </section>
        </div>
        <details class="lg-net" ${net.kind === "supabase" ? "open" : ""}>
          <summary>연결 방식: <b id="lg-net-now">${net.kind === "supabase" ? "온라인(태블릿마다)" : "이 기기(탭끼리)"}</b></summary>
          <fieldset class="lg-radio">
            <legend class="lg-sr">연결 방식</legend>
            <label><input type="radio" name="lg-net" value="local" ${net.kind !== "supabase" ? "checked" : ""}> 이 기기(같은 브라우저의 탭끼리 — 시연·연습)</label>
            <label><input type="radio" name="lg-net" value="supabase" ${net.kind === "supabase" ? "checked" : ""}> 온라인(Supabase Realtime — 태블릿마다)</label>
          </fieldset>
          <div class="lg-sb" ${net.kind === "supabase" ? "" : "hidden"}>
            <label class="lg-field"><span>프로젝트 주소</span><input id="lg-url" autocomplete="off" placeholder="https://xxxx.supabase.co" value="${esc(net.url || "")}"></label>
            <label class="lg-field"><span>공개 키(publishable / anon)</span><input id="lg-key" type="password" autocomplete="off" value="${esc(net.key || "")}"></label>
            <p class="lg-hint">서버에 저장하지 않는 실시간 중계만 써요. 학생 이름·개인정보는 오가지 않아요. 비밀(service) 키는 넣지 않아요.</p>
          </div>
        </details>
        <p class="lg-err" id="lg-err" role="alert">${esc(keyNotice)}</p>
      </main>`;
    const $ = s => app.querySelector(s);
    bindInfoTips(app);
    bindDataNotices(app, () => {
    });
    const showClassSplit = () => {
      const minutes = +$("#lg-class-time").value, selected = +(app.querySelector("[data-turns][aria-pressed=true]")?.dataset.turns ?? 12), turns = selected || 4, unit = selected ? "달" : "라운드";
      const duration = fraction => { const n = Math.round(minutes * 60 / turns * fraction); return `${Math.floor(n / 60)}분 ${n % 60}초`; };
      $("#lg-class-split").textContent = minutes ? `${minutes}분 ÷ ${turns}${unit} → ${unit}마다 계획 약 ${duration(.7)} · 결과 약 ${duration(.3)}` : "시간 제한 없이 진행해요.";
    };
    $("#lg-class-time").addEventListener("change", showClassSplit);
    app.addEventListener("click", e => { if (e.target.closest("[data-turns]")) queueMicrotask(showClassSplit); });
    showClassSplit();
    const errEl = $("#lg-err");
    const readNet = () => {
      const kind = app.querySelector("input[name=lg-net]:checked").value;
      const cfg = { kind, url: $("#lg-url").value.trim(), key: $("#lg-key").value.trim() };
      if (NET.publicKeyProblem(cfg.key)) { errEl.textContent = PUBLIC_KEY_NOTICE; return null; }
      if (kind === "supabase") {
        if (!NET.wsUrl(cfg.url, cfg.key) || !cfg.key) { errEl.textContent = "Supabase 프로젝트 주소와 공개 키를 확인해요."; return null; }
      }
      store.set(K_NET, cfg);
      return cfg;
    };
    app.querySelectorAll("input[name=lg-net]").forEach(r => r.addEventListener("change", () => {
      const sb = r.value === "supabase" && r.checked;
      $(".lg-sb").hidden = !sb && r.checked ? true : $(".lg-sb").hidden;
      if (r.checked) { $(".lg-sb").hidden = r.value !== "supabase"; $("#lg-net-now").textContent = r.value === "supabase" ? "온라인(태블릿마다)" : "이 기기(탭끼리)"; }
    }));
    soloNotice = "";
    $("#lg-solo-start").addEventListener("click", () => {
      const player = $("#lg-solo-city").value, ids = [...app.querySelectorAll("[data-solo-city]:checked")].map(b => b.dataset.soloCity);
      if (!ids.includes(player)) ids.push(player);
      const check = C.validTeams(reg, ids);
      if (!check.ok) { errEl.textContent = check.err; return; }
      const state = C.newState(code(6), REGION, 0, check.ids, { turns: +$("#lg-solo-turns").value, seedMode: $("#lg-solo-seed").value });
      check.ids.forEach(id => C.reduce(state, { type: "claim", team: id, token: `solo-city-${id}` }, 0, BG));
      if (soloSave?.state && !window.confirm("새 판을 시작하면 저장된 진행과 일지·답변이 지워집니다. 시작할까요?")) return;
      close(); pendingSolo = { v: 1, state, initial: structuredClone(state), team: player, style: $("#lg-solo-style").value, interview: { docs: {}, journal: {}, freeExperiment: $("#lg-solo-practice").value === "free" } }; writeSolo(pendingSolo);
      location.hash = "#league/solo";
    });
    $("#lg-solo-reset")?.addEventListener("click", () => { if (!window.confirm("저장된 진행과 일지·답변을 지우고 처음부터 시작할까요?")) return; store.del(K_SOLO); lobby(app); });
    $("#lg-join").addEventListener("click", () => {
      const room = normalizeRoom($("#lg-code").value);
      if (!newRoom(room)) { errEl.textContent = "새 방 코드는 8글자예요. 예전 방은 진행자가 이어서 진행한 뒤 새 코드로 참가해요."; $("#lg-code").focus(); return; }
      const n = readNet();
      if (!n) return;
      const cur = tab.get(), oldTeam = cur?.room?.length <= 6 ? cur : lastTeam;
      tab.set({ migrationFrom: cur?.migrationFrom || (oldTeam?.room?.length <= 6 ? { room: oldTeam.room, team: oldTeam.team } : null), ...(cur && cur.room === room ? cur : { room, net: n, team: null, identity: null }), ...(pre?.r === room && pre.f ? { fingerprint: pre.f } : {}) });
      location.hash = "#league/team";
    });
    const rj = $("#lg-rejoin");
    if (rj) rj.addEventListener("click", () => { tab.set({ ...lastTeam, identity: lastTeam.identity || null }); location.hash = "#league/team"; });
    $("#lg-host").addEventListener("click", async () => {
      if (!NET.secure()) { errEl.textContent = "이 주소에서는 팀이 앉을 수 없어요(https 주소나 이 기기 안에서만)"; return; }
      const n = readNet();
      if (!n) return;
      if (hostSave && hostSave.state && hostSave.state.phase !== "end" && !window.confirm(`진행 중인 방 ${hostSave.room}을 닫고 새로 만들까요?`)) return;
      const V = C.validTeams(reg, picked());
      if (!V.ok) { errEl.textContent = V.err; return; }
      const identity = await NET.createIdentity(), binding = await NET.hostBinding(identity.publicKey), room = binding.room;
      const tb = app.querySelector("[data-turns][aria-pressed=true]"), turns = tb ? +tb.dataset.turns : 0;
      const state = C.newState(room, REGION, Date.now(), V.ids, { turns, seedMode: $("#lg-host-seed").value });
      store.set(`${K_CLASS}:${room}`, +$("#lg-class-time").value);
      state.sid = NET.sessionId();
      if (!store.set(K_HOST, { room, net: n, identity, fingerprint: binding.fingerprint, state })) {
        errEl.textContent = "진행을 저장하지 못했어요. 저장 공간·브라우저 설정을 확인해요."; return;
      }
      location.hash = "#league/host";
    });
    app.querySelectorAll("[data-turns]").forEach(b => b.addEventListener("click", () => {
      app.querySelectorAll("[data-turns]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      const m = $("#lg-turnmsg"); if (m) m.textContent = +b.dataset.turns ? `1턴 = 1달. ${subsidyText()} 세금은 달마다 받아요. 주민·기업은 살기 좋은 도시로 옮겨 가요.` : "봄·여름·가을·겨울 4라운드(라운드마다 예산이 25%씩 늘어남). 경제(주민·세금)는 없어요.";
    }));
    // 참가 도시 고르기
    const boxes = [...app.querySelectorAll(".lg-pickc input")];
    const picked = () => boxes.filter(b => b.checked).map(b => b.value);
    const showPick = () => {
      const V = C.validTeams(reg, picked());
      $("#lg-pickn").textContent = `${V.ids.length}팀`;
      $("#lg-pickmsg").textContent = V.ok ? `${V.ids.map(teamName).join(" · ")}` : V.err;
      $("#lg-pickmsg").dataset.bad = String(!V.ok);
      app.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", String(JSON.stringify((reg.presets[b.dataset.preset] || []).slice().sort()) === JSON.stringify(V.ids.slice().sort()))));
      syncLobby?.();
    };
    boxes.forEach(b => b.addEventListener("change", showPick));
    app.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { const set = reg.presets[b.dataset.preset] || []; boxes.forEach(x => { x.checked = set.includes(x.value) || x.disabled; }); showPick(); }));
    showPick();
    const rh = $("#lg-rehost");
    if (rh) rh.addEventListener("click", () => { location.hash = "#league/host"; });

    const root = $(".lg-lobby"), cv = $("#lg-lobby-map");
    let mode = pre ? "join" : initialMode, raf = 0, intro = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const soloBoxes = [...app.querySelectorAll("[data-solo-city]")];
    const mapIds = () => mode === "host" ? picked() : mode === "solo" ? soloBoxes.filter(b => b.checked).map(b => b.dataset.soloCity) : reg.teams.map(t => t.id);
    const drawLobby = () => {
      if (!cv || !cv.isConnected) return;
      const ids = mapIds(), player = mode === "solo" ? $("#lg-solo-city").value : null;
      const lit = intro && !reduced.matches ? ids.slice(0, Math.ceil((performance.now() - intro) / 90)) : ids;
      renderBoard(cv, { active: ids, teams: {}, ties: [] }, null, false, { player, lit, mode });
      cv.setAttribute("aria-label", `광역 지도 · ${mode === "solo" ? `내 도시 ${teamName(player)} · ` : ""}참가 도시 ${ids.map(teamName).join(" · ")}. 아래 도시 칩으로 선택할 수 있어요.`);
    };
    const stopIntro = () => { cancelAnimationFrame(raf); raf = 0; intro = null; };
    const animateMap = () => {
      stopIntro();
      if (reduced.matches || !cv) { drawLobby(); return; }
      intro = performance.now();
      const frame = () => {
        if (!cv.isConnected) { stopIntro(); return; }
        drawLobby();
        if (performance.now() - intro < 720) raf = requestAnimationFrame(frame);
        else { stopIntro(); drawLobby(); }
      };
      raf = requestAnimationFrame(frame);
    };
    syncLobby = () => {
      const player = $("#lg-solo-city").value;
      $("#lg-lobby-city-info").innerHTML = lobbyCityInfo(C.teamDef(reg, player), true);
      soloBoxes.forEach(b => {
        const own = b.dataset.soloCity === player;
        b.disabled = own || mustCity(b.dataset.soloCity);
        if (b.disabled) b.checked = true;
      });
      app.querySelectorAll("[data-select]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === $("#" + b.dataset.select).value)));
      const turnmsg = $("#lg-solo-turnmsg"), opened = turnmsg.querySelector("details")?.open, pinned = turnmsg.querySelector("details")?.dataset.pinned;
      turnmsg.innerHTML = infoTip("solo-turns", `${esc($("#lg-solo-turns").value)}달 동안 진행해요. 1턴 = 1달, 준비 버튼으로 달을 넘깁니다.`, { label: "게임 길이" });
      turnmsg.querySelector("details").open = !!opened;
      if (pinned) turnmsg.querySelector("details").dataset.pinned = pinned;
      bindInfoTips(turnmsg);
      $("#lg-maphelp").textContent = mode === "host" ? "지도에서 참가 도시를 눌러요 · 🔒 필수 도시" : mode === "solo" ? "지도에서 내 도시를 눌러요 · 금색 테두리 = 내 도시 · 🔒 필수 도시" : "진행자가 만든 방에 참가해요 · 도시 선택은 참가 뒤에";
      drawLobby();
    };
    const setMode = next => {
      if (next !== mode) stopIntro();
      mode = next; root.dataset.mode = mode;
      app.querySelectorAll(".lg-modes [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      app.querySelectorAll("[data-panel]").forEach(p => { p.dataset.active = String(p.dataset.panel === mode); p.hidden = p.dataset.panel !== mode; });
      syncLobby();
    };
    app.querySelectorAll(".lg-modes [data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
    app.querySelectorAll("[data-select]").forEach(b => b.addEventListener("click", () => {
      const select = $("#" + b.dataset.select);
      select.value = b.dataset.value; select.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    ["#lg-solo-city", "#lg-solo-turns", "#lg-solo-style"].forEach(s => $(s).addEventListener("change", () => { stopIntro(); setMode("solo"); }));
    soloBoxes.forEach(b => b.addEventListener("change", () => { stopIntro(); setMode("solo"); }));
    boxes.forEach(b => b.addEventListener("change", () => { stopIntro(); setMode("host"); }));
    app.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => { setMode("host"); animateMap(); }));
    $("#lg-code").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); setMode("join"); });
    cv?.addEventListener("click", e => {
      const id = boardHit(cv, e);
      if (!id || mode === "join") return;
      stopIntro();
      if (mode === "solo") { $("#lg-solo-city").value = id; $("#lg-solo-city").dispatchEvent(new Event("change", { bubbles: true })); }
      else boxes.find(b => b.value === id && !b.disabled)?.click();
    });
    const ro = cv ? new ResizeObserver(drawLobby) : null;
    if (cv) ro.observe(cv);
    const motionChange = () => { stopIntro(); drawLobby(); };
    reduced.addEventListener("change", motionChange);
    lobbyStop = () => { stopIntro(); ro?.disconnect(); reduced.removeEventListener("change", motionChange); document.documentElement.classList.remove("v2-league-lobby"); };
    setMode(mode); animateMap();
    // 공통 라우터가 동기적으로 붙이는 제목 포커스도 첫 페인트 전에 정리한다.
    // 로비는 자동 포커스 없이 시작하고 키보드 탐색의 focus-visible은 유지한다.
    queueMicrotask(() => {
      const heading = $("h1");
      if (heading && root.isConnected) {
        if (document.activeElement === heading) heading.blur();
        heading.removeAttribute("tabindex");
      }
    });
  }

  /* ================= 진행자 ================= */
  async function hostView(app) {
    if (!NET.secure()) { app.innerHTML = '<main class="lg-lobby"><a href="#league">← 로비</a><p role="alert">이 주소에서는 팀이 앉을 수 없어요(https 주소나 이 기기 안에서만)</p></main>'; return; }
    if (!await hostInit()) { location.hash = "#league"; return; }
    L.app = app;
    L.viewing = null;
    renderHost(true);
    pushSnap();
  }
  async function hostInit() {
    const save = store.get(K_HOST);
    if (!save || !validRoom(save.room) || !save.state) return false;
    if (!NET.secure()) return false;
    if (!save.identity?.privateKey || !save.state.sid || save.room.length !== 8) {
      save.identity = await NET.createIdentity();
      const binding = await NET.hostBinding(save.identity.publicKey);
      save.state.seedKey ??= save.state.room;
      save.room = save.state.room = binding.room; save.fingerprint = binding.fingerprint;
      save.state.sid = NET.sessionId();
      for (const id of Object.keys(save.state.teams || {})) C.host(save.state, "kick", Date.now(), id);
      save.migration = "예전 방은 새 진행자 키와 8자리 코드로 다시 만들었어요. 저장된 게임을 이어가요. 팀은 새 코드로 다시 참가해요.";
    }
    if (!L || L.role !== "host" || L.room !== save.room) {
      close();
      const S = save.state;
      // 저장본 바로잡기: 지역·팀이 맞지 않으면 새로
      const ok = S && S.region === REGION && S.teams && actT(S).length >= 2 && actT(S).every(t => S.teams[t.id]);
      L = { role: "host", room: save.room, net: save.net, identity: save.identity, fingerprint: save.fingerprint, migration: save.migration, S: ok ? S : C.newState(save.room, REGION, Date.now()), timers: [], pending: 0 };
      L.S.sid = NET.sessionId(); // 실행마다 새 세션: 저장 실패 전 봉투도 다시 적용하지 않는다.
      L.conn = NET.open(Object.assign({ room: save.room }, save.net, { ack: true }));
      const session = L;
      const replyFor = NET.replyGate();
      const receive = NET.receiver(L.S, m => L === session ? C.reduce(session.S, m, Date.now(), BG) : { ok: false, err: "closed" });
      if (Object.values(L.S.teams).some(t => t.token && !t.publicKey) && !L.S.log.some(x => x.t.startsWith("예전 방식으로 앉은 팀"))) {
        L.S.log.push({ at: Date.now(), t: "예전 방식으로 앉은 팀은 자리 비우기를 누른 뒤 다시 앉아 줘요." });
        L.S.log = L.S.log.slice(-40);
      }
      L.conn.on("oversize", ({ ev }) => {
        if (L !== session || ev !== "snap" || L.sizeWarned) return;
        L.sizeWarned = true;
        L.S.log.push({ at: Date.now(), t: "상태가 너무 커서 팀 기기에 보내지 못했어요" });
        L.S.log = L.S.log.slice(-40); saveHost(); renderHost();
      });
      L.conn.on("req", async envelope => {
        if (L !== session) return;
        const r = await receive(envelope), m = r.request;
        if (L !== session) return;
        // 검증과 규칙 적용 뒤에만 화면과 저장을 갱신한다.
        if (L.viewing) BG.selectPack(C.teamDef(R(), L.viewing).pack, "league");
        const reply = replyFor(r);
        if (reply) await hostSend(r.ok ? "ack" : "nack", reply);
        if (L !== session) return;
        if (r.verified) saveHost(); // quiet 요청도 마지막 순번을 보존한다.
        if (r.ok && !r.quiet) changed();
        else if (r.ok && m.type === "claim") pushSnap();
      });
      L.conn.onStatus(s => { const el = document.getElementById("lg-conn"); if (el) { el.dataset.s = s; el.textContent = connLabel(s); } if (s === "open" && L === session && !L.channelWatching) hostChannelWatch(); });
      L.timers.push(setInterval(() => { pushSnap(); renderHost(); }, 4000));
      L.timers.push(setInterval(tickTimer, 1000));
      flushHost();
    }
    return true;
  }
  const connLabel = s => ({ open: "연결됨", connecting: "연결 중", reconnecting: "다시 연결 중", error: "연결 오류", closed: "닫힘" }[s] || s);
  function saveHost() {
    if (L?.role !== "host" || L.hostSaveT) return;
    L.hostSaveT = setTimeout(() => { if (L?.role === "host") flushHost(); }, 1000);
  }
  function flushHost() {
    if (L?.role !== "host") return;
    clearTimeout(L.hostSaveT); L.hostSaveT = 0;
    L.saveWarning = !store.set(K_HOST, { room: L.room, net: L.net, identity: L.identity, fingerprint: L.fingerprint, migration: L.migration, state: L.S });
    hostWarning();
  }
  function hostChannelWatch() {
    if (L?.role !== "host" || L.conn.kind !== "supabase" || L.channelWatching) return;
    const session = L;
    L.channelWatching = true;
    // 전달 결과는 순서가 뒤섞여 올 수 있다. 더 새 상태의 결과만 경고를 켜고 끈다.
    let lastSeq = 0;
    const watch = (event, missed) => L.conn.on(event, m => {
      if (L !== session || m.ev !== "snap" || m.seq < lastSeq) return;
      lastSeq = m.seq;
      L.channelMissed = missed ? m.bytes : 0; hostWarning();
    });
    watch("undelivered", true);
    // 다음 상태의 서버 수신 확인까지 경고를 유지한다. 단순 send 성공은 확인이 아니다.
    watch("delivered", false);
    hostWarning();
  }
  function hostWarning() {
    const el = document.getElementById("lg-host-warning");
    let channel = "";
    if (L?.role === "host" && L.conn?.kind === "supabase" && L.channelMissed)
      // ack는 Supabase 서버가 받아 중계했다는 확인일 뿐 팀 기기별 도착 확인이 아니다(D-77). 사실 범위만 말한다.
      channel = `방금 상태(${Math.round(L.channelMissed / 1000)}KB)의 전달 확인을 서버에서 받지 못했어요. 팀 화면이 멈췄으면 연결을 확인해요.`;
    if (el) el.textContent = [L.saveWarning ? "진행을 저장하지 못했어요. 저장 공간·브라우저 설정을 확인해요. 이 화면을 닫으면 진행을 잃을 수 있어요." : "", L.migration || "", channel].filter(Boolean).join(" ");
  }
  function hostSend(event, data) {
    const session = L, copy = structuredClone(data);
    session.hostSending = (session.hostSending || Promise.resolve()).then(async () => {
      if (L !== session) return;
      const wire = await NET.signHost(session.identity, event, session.room, session.S.sid, copy);
      if (L === session) { saveHost(); return session.conn.send(event, wire); }
    }).catch(() => { if (L === session) BG.toast("진행자 서명을 만들지 못했어요. 연결을 확인해요."); return false; });
    return session.hostSending;
  }
  async function pushSnap() {
    if (L?.role !== "host") return;
    const session = L;
    if (await hostSend("snap", C.publicView(L.S, Date.now())) !== false && L === session) L.sizeWarned = false;
  }
  function changed() {
    saveHost();
    if (L.viewing) updateView();
    clearTimeout(L.pending);
    L.pending = setTimeout(() => { pushSnap(); renderHost(); }, 150);
  }
  function tickTimer() {
    const el = document.getElementById("lg-timer");
    if (!el || !L) return;
    const S = L.S || L.snap, now = L.S ? Date.now() : Date.now() + (L.skew || 0);
    el.textContent = S && S.ends ? mmss(S.ends - now) : "";
    const hostTime = document.getElementById("lg-host-time");
    if (hostTime) {
      hostTime.textContent = el.textContent || "시간 제한 없음";
      hostTime.dataset.unlimited = String(!S?.ends);
      hostTime.dataset.low = String(!!(S?.ends && S.ends - now < 60000));
    }
    el.dataset.low = String(!!(S && S.ends && S.ends - now < 60000));
  }
  function nextLabel(S) {
    const n = C.roundsOf(L.S).length;
    if (S.econ) {
      const rd = C.roundsOf(S)[Math.max(0, S.round - 1)], next = C.roundsOf(S)[S.round];
      if (S.phase === "lobby") return `${rd.month}월 시작`;
      if (S.phase === "plan") return `${rd.month}월 운영`;
      if (S.phase === "review") return next ? `${next.month}월 시작` : "최종 결과";
      return "";
    }
    if (S.phase === "lobby") return "1라운드 시작";
    if (S.phase === "plan") return `${S.round}라운드 운영`;
    if (S.phase === "review") return S.round >= n ? "최종 결과" : `${S.round + 1}라운드 시작`;
    return "";
  }
  function classTimer() {
    const minutes = store.get(`${K_CLASS}:${L.room}`), S = L.S;
    if (minutes == null || !["plan", "review"].includes(S.phase)) return;
    S.ends = minutes === 0 ? null : Date.now() + minutes * 60000 / C.roundsOf(S).length * (S.phase === "plan" ? .7 : .3);
  }
  function hostNext() {
    const S = L.S, now = Date.now();
    if (S.phase === "plan") {
      const btn = document.getElementById("lg-next");
      if (btn) { btn.disabled = true; btn.textContent = "운영 중…"; }
      setTimeout(() => { C.run(S, BG, now); classTimer(); L.flash = S.round; changed(); renderHost(true); }, 30);
      return;
    }
    if (C.host(S, "next", now)) { classTimer(); changed(); renderHost(true); }
  }
  function joinLink() {
    const n = L.net && L.net.kind === "supabase" ? { kind: "supabase", url: L.net.url, key: L.net.key } : { kind: "local" };
    return `${location.origin}${location.pathname}#league/j=${b64e(JSON.stringify({ r: L.room, f: L.fingerprint, n }))}`;
  }
  function renderHostMapCaption(V, res) {
    const cap = L.app.querySelector("#lg-mapcap");
    const moves = (V.econ?.report?.flows.pop || []).slice().sort((a, b) => b.n - a.n).slice(0, IQ.quarter);
    // 설명은 보고된 흐름을 보존한다. 실제 그린 화살표 수는 canvas 메타에서만 읽는다.
    cap.textContent = (res ? `${resLabel(res)} 도시 사이 전력 거래 · 선 굵기 = 용량` : "점선 = 제안된 연계선, 실선 = 연결된 연계선") + (R().board ? " · 도시를 누르면 그 도시 지도" : "")
      + moves.map(f => ` · ${teamName(f.from)} → ${teamName(f.to)} ${fmt(f.n)}명: ${migrationReason(f)}`).join("");
  }
  function renderHost(full) {
    if (!L || L.role !== "host" || !L.app || !L.app.isConnected || L.viewing) return;
    document.documentElement.classList.remove("v2-league-lobby", "v2-league-seat");
    document.documentElement.classList.add("v2-league-host");
    const S = L.S, reg = R(), now = Date.now(), V = C.publicView(S, now);
    const res = S.results[S.results.length - 1] || null;
    const RS0 = C.roundsOf(S), rd = S.round ? RS0[S.round - 1] : RS0[0];
    const focused = document.activeElement, focusCity = focused?.closest("[data-host-city]")?.dataset.hostCity;
    const focusCard = focused?.matches("summary") ? focused.closest("[data-host-card]")?.dataset.hostCard : null;
    const infoState = [...L.app.querySelectorAll("details.lg-info[data-fold]")].map(el => ({ key: el.dataset.fold, open: el.open, pinned: el.dataset.pinned === "true" }));
    const focusInfo = focused?.getAttribute("data-info-key");
    const focusKick = focused?.dataset.kick;
    const focusThumb = focused?.matches(".lg-thumb") ? focused.closest("[data-team]")?.dataset.team : null;
    if (full || !L.app.querySelector(".lg-host")) {
      L.hostSummaryHTML = null; L.hostTeamHTML = null;
      L.app.innerHTML = `
        <main class="lg-host" data-econ="${!!V.econ}">
          <header class="lg-hbar">
            <a class="lg-back" href="#league" aria-label="로비로">←</a>
            ${V.econ ? "" : `<div class="lg-room"><span>방 코드</span><b id="lg-roomcode">${esc(displayRoom(L.room))}</b></div>`}
            <div class="lg-hmeta">
              <p class="v2-kicker">${esc(reg.short)}</p>
              <h1 id="lg-h1"></h1>
            </div>
            ${dataChipHTML()}<span class="lg-conn" id="lg-conn" data-s="${esc(L.conn.status())}">${connLabel(L.conn.status())}</span>
            <b class="lg-timer num" id="lg-timer" aria-live="off" ${V.econ ? "hidden" : ""}></b>
          </header>
          <p id="lg-host-warning" role="alert"></p>
          <section class="lg-host-command" aria-label="리그 지휘 막대">
            ${V.econ ? '<section id="lg-host-overview" aria-label="진행 현황"></section>' : ""}
            <div class="lg-host-actions">
              <button type="button" class="v2-btn primary" id="lg-next"></button>
              <div class="lg-host-tools" role="group" aria-label="진행 보조"><button type="button" class="v2-btn" id="lg-extend">+1분</button>
              <button type="button" class="v2-btn" id="lg-link">참가 링크 복사</button><button type="button" class="v2-btn" id="lg-download">기록 내려받기</button></div>
            </div>
          </section>
          ${V.econ ? '<section id="lg-host-alerts" aria-label="위험 도시"></section><section id="lg-host-summary" aria-label="도시 요약"></section>' : ""}
          <section id="lg-host-verdicts" class="lg-verdicts" aria-label="약속 판정" hidden></section>
          ${V.econ ? `<div id="lg-host-ticker">${tickerHTML(V)}</div>` : ""}
          <section class="lg-evbox" id="lg-evbox" aria-live="polite"></section>
          ${V.econ ? `<details id="lg-host-details" class="lg-host-details" ${L.hostDetailsOpen ? "open" : ""}><summary>상세 지도·도시 카드</summary>` : ""}
          <section class="lg-hgrid">
            <figure class="lg-mapbox">${R().board ? `<canvas class="lg-map lg-mapc" id="lg-mapc" role="img" aria-label="광역 지도: 여섯 도시 지도를 합친 지도와 연계선"></canvas><nav class="lg-mapnav" aria-label="도시 지도 보기">${actT(S).map(t => `<a href="#league/view/${t.id}" style="--c:${t.color}">${esc(t.name)}</a>`).join("")}</nav>` : `<svg class="lg-map" id="lg-map" viewBox="0 0 600 470" role="img" aria-label="지역 지도와 연계선"></svg>`}
              <figcaption id="lg-mapcap"></figcaption></figure>
            <div class="lg-teams" id="lg-teams"></div>
          </section>
          ${V.econ ? "</details>" : ""}
          ${V.econ ? `<div id="lg-host-rank"></div><div id="lg-host-debrief"></div>` : ""}
          <div id="lg-host-y2022"></div><section class="lg-results" id="lg-results"></section>
          <section class="lg-logbox"><h2>기록</h2><ol class="lg-log" id="lg-log"></ol></section>
          ${V.econ ? `<p class="lg-hint">억 = 게임 단위 · ${ASSUMPTIONS}</p>` : ""}
          <p class="lg-sr" id="lg-live" aria-live="polite"></p>
        </main>`;
      const $ = s => L.app.querySelector(s);
      $("#lg-next").addEventListener("click", hostNext);
      if (V.econ) {
        $("#lg-host-summary").addEventListener("click", e => {
          const button = e.target.closest("[data-host-city]"); if (!button) return;
          const details = $("#lg-host-details"), card = $(`#lg-host-card-${button.dataset.hostCity}`);
          details.open = true; L.hostDetailsOpen = true;
          if (card) { card.open = true; L.hostCards = { ...L.hostCards, [button.dataset.hostCity]: true }; card.querySelector("summary").focus(); card.scrollIntoView({ block: "nearest" }); }
        });
        $("#lg-host-details").addEventListener("toggle", e => {
          if (e.target !== $("#lg-host-details")) return;
          L.hostDetailsOpen = e.target.open;
          if (e.target.open) {
            const snapshot = C.publicView(L.S, Date.now()), result = L.S.results.at(-1);
            if ($("#lg-mapc")) renderBoard($("#lg-mapc"), snapshot, result, L.flash === L.S.round);
            else renderMap($("#lg-map"), snapshot, result, L.flash === L.S.round);
            renderHostMapCaption(snapshot, result);
            $("#lg-teams").querySelectorAll("details[open] canvas[data-thumb]").forEach(cv => thumb(cv, cv.dataset.thumb, snapshot.teams[cv.dataset.thumb].plan));
          }
        });
        $("#lg-teams").addEventListener("toggle", e => {
          if (e.target.matches("details[data-host-card]")) {
            L.hostCards = { ...L.hostCards, [e.target.dataset.hostCard]: e.target.open };
            if (e.target.open) { const cv = e.target.querySelector("canvas[data-thumb]"); if (cv) thumb(cv, cv.dataset.thumb, C.publicView(L.S, Date.now()).teams[cv.dataset.thumb].plan); }
          }
        }, true);
      }
      const mc = $("#lg-mapc");
      if (mc) {
        mc.addEventListener("click", e => { const id = boardHit(mc, e); if (id && Object.hasOwn(L.S.teams, id)) location.hash = `#league/view/${id}`; });
        mc.addEventListener("mousemove", e => { const id = boardHit(mc, e); mc.style.cursor = id && Object.hasOwn(L.S.teams, id) ? "pointer" : "default"; mc.title = id ? `${teamName(id)} 지도 보기` : ""; });
      }
      $("#lg-extend").addEventListener("click", () => { if (C.host(L.S, "extend", Date.now())) changed(); });
      $("#lg-download").addEventListener("click", downloadRecords);
      $("#lg-link").addEventListener("click", () => copyText(joinLink(), "참가 링크를 복사했어요", $("#lg-link")));
      $("#lg-teams").addEventListener("click", e => {
        const k = e.target.closest("[data-kick]");
        if (k && window.confirm(`${teamName(k.dataset.kick)} 자리를 비울까요? (다른 기기가 그 팀으로 들어올 수 있게 됩니다)`)) { C.host(L.S, "kick", Date.now(), k.dataset.kick); changed(); }
      });
    }
    const $ = s => L.app.querySelector(s);
    // 경제 모드는 지휘 막대에 달·단계가 있으므로 지역 이름만, 계절 모드는 막대가 없어 라운드·단계를 제목에 둔다.
    $("#lg-h1").textContent = S.econ ? reg.name : S.phase === "lobby" ? "팀 입장 기다리는 중" : S.phase === "end" ? "리그 끝 — 최종 결과" : `${turnLabel(rd, S.round, C.roundsOf(S).length)} · ${PHASE_NAME[S.phase]}`;
    const nx = $("#lg-next"), lab = nextLabel(S);
    nx.hidden = !lab; nx.disabled = false; nx.textContent = lab;
    $("#lg-extend").hidden = !S.ends;
    if (V.econ) {
      $("#lg-host-overview").innerHTML = hostOverviewHTML(V, res);
      $("#lg-host-alerts").innerHTML = hostRiskHTML(V, res);
      const summary = hostSummaryHTML(V, res);
      if (L.hostSummaryHTML !== summary) { $("#lg-host-summary").innerHTML = summary; L.hostSummaryHTML = summary; }
    }
    const verdicts = hostVerdictsHTML(S), verdictBox = $("#lg-host-verdicts");
    verdictBox.hidden = !verdicts;
    if (verdictBox.innerHTML !== verdicts) verdictBox.innerHTML = verdicts;
    tickTimer();
    const ev = S.round ? evCards(V, S.round) : "";
    $("#lg-evbox").innerHTML = ev ? `<h2>${V.econ ? `${rd.month}월` : `${S.round}라운드`} 사건</h2>${ev}` : "";
    if (!V.econ || $("#lg-host-details").open) {
      if ($("#lg-mapc")) renderBoard($("#lg-mapc"), V, res, L.flash === S.round); else renderMap($("#lg-map"), V, res, L.flash === S.round);
    }
    renderHostMapCaption(V, res);
    const cards = actT(S).map(t => {
      const card = teamCard(t, V.teams[t.id], res && res.team[t.id], S);
      return V.econ ? `<details id="lg-host-card-${esc(t.id)}" data-host-card="${esc(t.id)}" ${L.hostCards?.[t.id] ? "open" : ""}><summary>${esc(t.name)} 상세</summary>${card}</details>` : card;
    }).join("");
    if (L.hostTeamHTML !== cards) { $("#lg-teams").innerHTML = cards; L.hostTeamHTML = cards; }
    const restored = focusCity ? [...$("#lg-host-summary").querySelectorAll("[data-host-city]")].find(el => el.dataset.hostCity === focusCity)
      : focusCard ? [...$("#lg-teams").querySelectorAll("[data-host-card]")].find(el => el.dataset.hostCard === focusCard)?.querySelector("summary")
      : focusKick ? [...$("#lg-teams").querySelectorAll("[data-kick]")].find(el => el.dataset.kick === focusKick)
      : focusThumb ? [...$("#lg-teams").querySelectorAll("[data-team]")].find(el => el.dataset.team === focusThumb)?.querySelector(".lg-thumb") : null;
    if (restored && restored !== document.activeElement) restored.focus({ preventScroll: true });
    $("#lg-teams").querySelectorAll("canvas[data-thumb]").forEach(cv => {
      if (!V.econ || $("#lg-host-details").open && cv.closest("details").open) thumb(cv, cv.dataset.thumb, V.teams[cv.dataset.thumb].plan);
    });
    $("#lg-results").innerHTML = res ? resultsTable(S, res) : `<p class="lg-hint">${V.econ ? "한 달을" : "라운드를"} 운영하면 여기에 도시별 결과가 나옵니다. 팀은 <b>방 코드 ${esc(displayRoom(L.room))}</b>로 들어옵니다.</p>`;
    if (!V.econ && techData()) {
      let news = $("#lg-tech-host-news");
      if (!news) { news = document.createElement("section"); news.id = "lg-tech-host-news"; news.className = "lg-tech-host-news"; $("#lg-results").before(news); }
      news.innerHTML = techNewsHTML(V);
    }
    if (V.econ) {
      const ticker = $("#lg-host-ticker"), rank = $("#lg-host-rank"), debrief = $("#lg-host-debrief");
      if (ticker) ticker.innerHTML = tickerHTML(V);
      if (rank) {
        if (S.phase !== "end" || !rank.querySelector(".lg-fx-end")) {
          rank.innerHTML = rankHTML(V.econ, false) + (S.phase === "end" ? KCP.fxEnd?.html({ ...V, results: S.results }, null, { allCities: true }) || "" : "");
          if (S.phase === "end") KCP.fxEnd?.mount(rank);
        }
        rank.querySelectorAll(".lg-scoreparts [data-leader=true] > span").forEach(el => { el.textContent = el.textContent.replace("· 1위(동점 포함)", "◆"); el.title = "부분 점수 공동 선두(동점 포함)"; });
      }
      if (debrief && S.phase === "end" && !debrief.querySelector("#lg-debrief")) {
        debrief.innerHTML = debriefHTML(V.econ);
        debrief.addEventListener("input", () => updateWeights(debrief, C.publicView(L.S, Date.now()).econ));
      }
    }
    $("#lg-host-y2022").hidden = !!V.econ;
    $("#lg-host-y2022").innerHTML = !V.econ && S.phase === "end" ? y2022LinkHTML("lg-y2022-host") : "";
    $("#lg-log").innerHTML = S.log.slice(-8).reverse().map(x => `<li>${esc(logText(V, x.t))}</li>`).join("");
    // innerHTML 갱신을 모두 마친 뒤 팀 서랍과 같은 data-fold 키로 열림·고정을 복원한다.
    infoState.forEach(({ key, open, pinned }) => {
      [...L.app.querySelectorAll("details.lg-info[data-fold]")].filter(el => el.dataset.fold === key).forEach(el => {
        el.open = open;
        if (pinned) el.dataset.pinned = "true"; else delete el.dataset.pinned;
      });
    });
    bindInfoTips(L.app);
    if (focusInfo) [...L.app.querySelectorAll("[data-info-key]")].find(el => el.dataset.infoKey === focusInfo)?.focus({ preventScroll: true });
    hostWarning();
  }
  function logText(V, text) {
    if (!V.econ) return text;
    // 엔진 로그는 대표 운전 기간을 보관한다. 월 화면에서는 해당 결과와 맞춰 표시한다.
    return text.replaceAll("다음 턴 도입", "다음 달 도입").replace(/(\d+)라운드([^·]*)/g, (_, round, tail) => {
      const rd = C.roundsOf(V)[Number(round) - 1];
      return rd?.month ? `${rd.month}월${tail}` : `${round}달${tail}`;
    }).replace(/CO₂ ([\d.,]+) t/, (match) => {
      const round = /^(\d+)라운드 운영 끝/.exec(text)?.[1], res = V.results.find(r => r.round === Number(round));
      const co2 = res && (resultReport(V, res)?.region?.co2 ?? res.region.co2 * resultPeriod(V, res).mul);
      return Number.isFinite(co2) ? `CO₂ ${fmt(co2)} t(월)` : match;
    });
  }
  // 지지율 평가선: 엔진(econ.js approvalRelative)과 같이 경제 도시 전체의 평균 변화 대비 −approvalDrop 미만이면 미달. 평가 달의 pass가 있으면 그것을 쓴다.
  function approvalBelowLine(V, res, id) {
    const cities = V.econ?.cities || {}, city = cities[id];
    if (!city) return false;
    const pass = (res ? resultReport(V, res) : V.econ.report)?.review?.[id]?.pass;
    if (typeof pass === "boolean") return !pass;
    const order = V.econ.scoreState?.order || Object.keys(cities);
    const changes = order.filter(k => cities[k]).map(k => cities[k].approval - cities[k].approval0);
    const average = changes.length > 1 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    return city.approval - city.approval0 - average < -params("approvalDrop");
  }
  function hostRisk(V, res, id) {
    const city = V.econ?.cities[id], r = res?.team[id], issues = [];
    if (r && r.unsPct > (V.goals || R().goals).unsPct) issues.push("정전 목표 초과");
    if (V.teams[id].left < 0) issues.push("남은 돈 음수");
    if (city && approvalBelowLine(V, res, id)) issues.push("지지율 평가선 미달");
    if ((V.grid?.[id]?.waitingMW || 0) > 0) issues.push("접속 대기");
    return issues;
  }
  function planCo2Text(V) {
    return V.phase === "lobby"
      ? `첫 달 목표(계획 시작 때 확정) · CO₂ ≤ ${fmt(V.goals.co2Plan)} t · 기준: ${V.goals.co2Basis}`
      : `이번 달 CO₂ 목표 ≤ ${fmt(V.goals.co2Plan)} t · 계획 시작 때 확정 · 기준: ${V.goals.co2Basis}`;
  }
  function hostOverviewHTML(V, res) {
    const showReady = !V.econ || ["lobby", "plan"].includes(V.phase);
    const teams = actT(V), unready = teams.filter(t => !V.teams[t.id].ready), rd = C.roundsOf(V)[Math.max(0, V.round - 1)];
    const region = res && resultReport(V, res)?.region;
    const goal = { uns: V.goals.unsPct, co2: V.goals.co2Plan ?? V.goals.co2 * (rd.mdays || rd.days) / rd.days };
    const lastGoal = region?.goal || (res ? { uns: V.goals.unsPct, co2: V.goals.co2 * resultPeriod(V, res).mul } : null);
    const planning = ["lobby", "plan"].includes(V.phase), shownGoal = planning ? goal : lastGoal || goal;
    const bar = (label, value, target, unit, digits) => {
      if (!Number.isFinite(value) || !Number.isFinite(target)) return "";
      const scale = Math.max(target * 2, value, 1), width = Math.min(100, 100 * value / scale), marker = 100 * target / scale;
      return `<div class="lg-goalbar" data-bad="${value > target}"><span>${label}</span><div role="meter" aria-label="${label} · 지난달 운영 / 목표" aria-valuemin="0" aria-valuemax="${scale}" aria-valuenow="${value}" aria-valuetext="${fmt(value, digits)}${unit} / 목표 ${fmt(target, digits)}${unit}"><i style="width:${width}%"></i><em style="left:${marker}%"></em></div><b>${value > target ? "▲ " : ""}${esc(fmt(value, digits))}${unit}</b></div>`;
    };
    return `<div class="lg-host-board" aria-label="프로젝터 핵심 현황">
      <div class="lg-command-room lg-proj-key"><small>방 코드</small><b id="lg-roomcode">${esc(displayRoom(L.room))}</b></div>
      <div class="lg-command-month lg-proj-key"><small>${esc(rd.year || "")} · ${V.round || 1}/${C.roundsOf(V).length}${V.econ ? "달" : "라운드"}</small><b>${V.econ ? `${rd.month}월` : `${V.round || 1}라운드`}</b><span class="lg-phase-chip">${esc(PHASE_NAME[V.phase])}</span></div>
      <div class="lg-command-time lg-proj-key"><small>남은 시간</small><b id="lg-host-time"></b></div>
      <div class="lg-command-ready lg-proj-key"${showReady ? ' id="lg-host-ready"' : ""}><small>${showReady ? "준비" : "진행"}</small><b>${showReady ? `${teams.length - unready.length}<small>/${teams.length}팀</small>` : V.phase === "end" ? "리그 종료" : "운영 완료"}</b>${showReady ? `<span class="lg-ready-pips" aria-hidden="true">${teams.map(t => `<i data-ready="${!!V.teams[t.id].ready}"></i>`).join("")}</span>` : ""}</div>
    </div><div class="lg-command-goals"><small>지역 공동목표</small><div id="lg-host-goals">
      <div class="lg-goal-chip"><span>정전 목표 ≤ ${esc(fmt(shownGoal.uns, 2))}%</span><span>지난달 실제${region ? ` (${esc(res.month)}월) ${esc(fmt(region.unsPct, 2))}%` : " · 첫 운영 전"}</span>${region ? bar("정전", region.unsPct, lastGoal.uns, "%", 2) : ""}</div>
      <div class="lg-goal-chip" aria-label="CO₂ 목표와 지난달 실제"><span>${planning ? "이번 달 CO₂ 목표" : "목표 CO₂"} ≤ ${esc(fmt(shownGoal.co2))} t</span><span>지난달 실제${region ? ` (${esc(res.month)}월) ${esc(fmt(region.co2))} t` : " · 첫 운영 전"}</span>${region ? bar("CO₂", region.co2, lastGoal.co2, " t", 0) : ""}</div>
      ${planning ? `<small class="lg-goal-note">${V.phase === "lobby" ? "첫 달 목표 · " : ""}계획 시작 때 확정 · 기준: ${esc(V.goals.co2Basis)}</small>` : ""}
    </div></div>`;
  }
  function hostRiskHTML(V, res) {
    // 등급: 정전 목표 초과·남은 돈 음수·지지율 평가선 미달 = 위험(▲), 접속 대기만 = 주의(●). 위험 도시를 먼저 보인다.
    const teams = actT(V), CAUTION = new Set(["접속 대기"]);
    const risks = teams.map(t => { const why = hostRisk(V, res, t.id); return { t, why, level: why.some(k => !CAUTION.has(k)) ? "risk" : "caution" }; })
      .filter(x => x.why.length).sort((a, b) => (a.level === "risk" ? 0 : 1) - (b.level === "risk" ? 0 : 1));
    const short = { "정전 목표 초과": "정전", "남은 돈 음수": "남은 돈", "지지율 평가선 미달": "지지율", "접속 대기": "접속 대기" };
    return `<div class="lg-alerts"><div id="lg-host-risk"><span class="lg-hint">위험·주의 도시</span><ul class="lg-host-city-chips" aria-label="위험·주의 도시 목록">${risks.length ? risks.map(x => `<li class="lg-risk-chip" data-level="${x.level}"><b>${x.level === "risk" ? "▲ 위험" : "● 주의"} · ${esc(x.t.name)}</b><span>${x.why.map(k => esc(short[k] || k)).join(" · ")}</span></li>`).join("") : '<li class="lg-hint">없음</li>'}</ul></div>${["lobby", "plan"].includes(V.phase) ? `<div id="lg-host-unready"><span>미준비</span><ul class="lg-host-city-chips" aria-label="미준비 도시 목록">${teams.filter(t => !V.teams[t.id].ready).map(t => `<li class="lg-unready-chip">${esc(t.name)}</li>`).join("") || '<li class="lg-hint">없음</li>'}</ul></div>` : ""}</div>`;
  }
  function hostVerdictsHTML(S) {
    if (!S.econ || !["review", "end"].includes(S.phase) || S.results.at(-1)?.round !== S.round) return "";
    // 팀 기기는 마지막 달에 판정을 보내지 않는다(reportPromiseVerdict) — 모두 '미보고'로 보이지 않게 한다.
    if (S.round >= C.roundsOf(S).length) return '<h2>약속 판정</h2><p class="lg-hint">마지막 달은 다음 달 약속이 없어 판정을 모으지 않아요.</p>';
    const teams = actT(S), value = id => S.teams[id]?.verdicts?.[S.round];
    const same = teams.filter(t => value(t.id) === true).length, different = teams.filter(t => value(t.id) === false).length;
    return `<h2>약속 판정: 같음 ${same}팀 · 다름 ${different}팀 · 미보고 ${teams.length - same - different}팀</h2><p class="lg-hint">점수에 들어가지 않아요. 미보고에는 아직 도착하지 않은 팀과 약속·비교 기준이 없어 판정하지 않은 팀이 함께 들어 있어요.</p><div class="lg-verdict-chips">${teams.map(t => {
      const hit = value(t.id), label = hit === true ? "같음" : hit === false ? "다름" : "미보고";
      return `<span class="lg-verdict-chip" data-verdict="${hit === true ? "same" : hit === false ? "different" : "pending"}">${esc(t.name)} · ${label}</span>`;
    }).join("")}</div>`;
  }
  function hostSummaryHTML(V, res) {
    const mul = res ? resultPeriod(V, res).mul : 1, rep = res && resultReport(V, res);
    const cell = (label, value, unit = "", bad = false) => `<td data-label="${label}" data-bad="${!!bad}"${value === "" ? ' data-empty="true" aria-label="첫 운영 뒤 표시"' : ""}>${bad ? '<span class="lg-warning-symbol" aria-label="위험">▲ </span>' : ""}<span class="lg-ledger-value">${esc(value)}${value === "–" || value === "" ? "" : `<small>${unit}</small>`}</span></td>`;
    // 계통 칸: D-82 하루 평균. 칸 안 단위는 머리글(MWh/일)에 맡긴다. ◆는 정전 0인데 계통에 기댄 도시.
    const gridCell = id => {
      const r = res?.team[id], perDay = res ? gridReliance(V, res, id).perDay : null;
      const leaned = Number.isFinite(perDay) && perDay > GRID_LEAN_PER_DAY && r?.unsPct < ZERO_OUTAGE_PCT;
      const value = !res ? "" : perDay == null ? "–" : fmt(perDay, 1);
      return `<td data-label="계통" data-grid-lean="${leaned}"${value === "" ? ' data-empty="true" aria-label="첫 운영 뒤 표시"' : ""}>${leaned ? '<span class="lg-grid-symbol" aria-label="정전 0, 계통에 기댐">◆ </span>' : ""}<span class="lg-ledger-value">${esc(value)}</span></td>`;
    };
    return `<h2>${actT(V).length === 6 ? "여섯" : actT(V).length} 도시 장부</h2><p class="lg-hint">${res ? `${esc(resultHeading(V, res))} · 정전·CO₂·주민 Δ = 지난달 운영` : "정전·CO₂·주민 Δ는 첫 운영 뒤 표시"} · 돈·지지율 = 지금</p><div class="lg-tablewrap"><table id="lg-host-summary-table" class="lg-table"><thead><tr><th scope="col">도시</th><th scope="col">정전</th><th scope="col">계통(MWh/일)</th><th scope="col">CO₂(t)</th><th scope="col">남은 돈(억)</th><th scope="col">현금(억)</th><th scope="col">지방채 한도(억)</th><th scope="col">지지율</th><th scope="col">주민 Δ</th><th scope="col">준비</th></tr></thead><tbody>${actT(V).map(t => {
      const city = V.econ.cities[t.id], r = res?.team[t.id], ready = V.teams[t.id].ready;
      return `<tr><th scope="row"><button type="button" data-host-city="${esc(t.id)}" aria-controls="lg-host-card-${esc(t.id)}">${esc(t.name)}</button></th>${cell("정전", res ? fmt(r?.unsPct, 2) : "", "%", r && r.unsPct > V.goals.unsPct)}${gridCell(t.id)}${cell("CO₂", res ? fmt(r ? r.co2Prod * mul : undefined) : "", "t")}${cell("남은 돈", fmt(V.teams[t.id].left, 1), "억", V.teams[t.id].left < 0)}${cell("현금", fmt(city.cash, 1), "억")}${cell("지방채 한도", fmt(city.debtCap, 1), "억")}${cell("지지율", fmt(city.approval, 1), "%", approvalBelowLine(V, res, t.id))}${cell("주민 Δ", res ? rep?.cities?.[t.id] ? signed(rep.cities[t.id].dPop) : "–" : "", "명")}<td data-label="준비" data-ready="${ready && ["lobby", "plan"].includes(V.phase)}">${["lobby", "plan"].includes(V.phase) ? ready ? "준비 ✓" : "미준비" : "—"}</td></tr>`;
    }).join("")}</tbody></table></div><p class="lg-ledger-note">▲ = 목표·평가선 넘음(위험) · <span class="lg-grid-symbol" aria-hidden="true">◆</span> = 정전 0이지만 바깥 계통에 기댄 달 · 계통 = 계통이 메운 전기, 하루 평균 · 도시 이름을 누르면 상세가 열려요. 남은 돈은 지방채 한도를 포함하며 건설·연구·대응 예약과 정산 뒤 쓸 수 있는 돈이에요.</p>`;
  }
  function teamCard(t, v, r, S) {
    const plan = v.plan || { builds: [], lines: [] };
    const cnt = {};
    plan.builds.forEach(b => { cnt[b.t] = (cnt[b.t] || 0) + 1; });
    const B = BG.BLD;
    const items = Object.keys(cnt).map(k => `<span class="lg-chip">${esc((B[k] || { name: k }).name)} ${cnt[k]}</span>`).join("") || `<span class="lg-hint">${plan.lines.length ? `설비 건설 없음(송전선 ${plan.lines.length})` : "아직 건설 없음"}</span>`;
    const st = !v.seated ? "빈 자리" : v.online ? "접속" : "끊김";
    const H = v.hist || [], last = H[H.length - 1];
    const mul = S.econ && r ? resultPeriod(S, S.results.at(-1)).mul : 1;
    const ago = last ? Math.max(0, Math.round((Date.now() - last.t) / 1000)) : null;
    return `<article class="lg-tcard" style="--c:${t.color}" data-team="${t.id}">
      <a class="lg-thumb" href="#league/view/${t.id}" aria-label="${esc(t.name)} 지도 크게 보기"><canvas data-thumb="${t.id}" width="232" height="150"></canvas><span>지도 보기</span></a>
      <div class="lg-speed">${spark(H, v.budget)}<span>${last ? `투자 <b class="num">${fmt(last.cap)}억</b> · 설비 ${last.n} · 선 ${last.l}${ago != null ? ` · <i>${ago < 60 ? `${ago}초` : `${Math.round(ago / 60)}분`} 전 변경</i>` : ""}` : "아직 계획 없음"}</span></div>
      <header><h3>${esc(t.name)}</h3><span class="lg-seat" data-s="${!v.seated ? "empty" : v.online ? "on" : "off"}">${st}</span>${v.ready && (!S.econ || ["lobby", "plan"].includes(S.phase)) ? `<span class="lg-ready">준비 ✓</span>` : ""}</header>
      <p class="lg-tline"><span>${S.econ ? "남은 돈" : "예산"} <b class="num">${fmt(S.econ ? v.left : v.budget, S.econ ? 1 : 0)}억</b></span><span>판매 단가 <b class="num">${fmt(v.price, 3)}</b></span><span>송전선 <b class="num">${plan.lines.length}</b></span></p>
      ${S.econ ? `<p class="lg-tline">주민 ${esc(signed(S.econRep?.cities[t.id]?.dPop || 0))}명 · 지지율 ${esc(fmt(S.econ.cities[t.id].approval, 1))}%</p><div class="lg-chips">${v.crit?.chips?.length ? v.crit.chips.map(k => `<span class="lg-chip">기준: ${esc(SCORE_NAMES[k])}</span>`).join("") : `<span class="lg-chip">기준 미선택</span>`}</div>` : ""}
      <div class="lg-chips">${items}</div><div class="lg-tech-icons">${techIconsHTML(v.research || {})}</div>
      ${r ? `<p class="lg-tline lg-tres"><span>정전 <b class="num" data-bad="${r.unsPct > (S.econ ? C.goalsOf(S).unsPct : 0.5)}">${fmt(r.unsPct, 2)}%</b></span><span>${S.econ ? "CO₂(이번 달 운영)" : "CO₂"} <b class="num">${fmt(r.co2Prod * mul)} t</b></span><span>수입/수출 <b class="num">${fmt(r.imp * mul, 1)}/${fmt(r.exp * mul, 1)}</b></span></p>` : ""}
      ${v.seated ? `<button type="button" class="lg-kick" data-kick="${t.id}">자리 비우기</button>` : ""}
    </article>`;
  }
  function resultsTable(S, res) {
    const g = C.goalsOf(S), act = actT(S).filter(t => res.team[t.id]);
    if (S.econ) {
      const V = C.publicView(S, Date.now()), rep = resultReport(V, res), { mul, days } = resultPeriod(V, res);
      return `<h2>${esc(resultHeading(V, res))}</h2><div class="lg-tablewrap"><table class="lg-table"><thead><tr><th scope="col">도시</th><th scope="col" title="${esc(outageHoursDef(days))}">정전 시간(h)*</th><th scope="col">이번 달 총지출(억)</th><th scope="col">CO₂ 생산/소비(t)</th><th scope="col">판매/구매(MWh)</th><th scope="col">보너스(점)</th></tr></thead><tbody>${act.map(t => {
        const r = res.team[t.id]; return `<tr style="--c:${esc(t.color)}"><th scope="row">${esc(t.name)}</th><td>${esc(fmt(r.outH * mul, 1))}</td><td>${esc(fmt(r.ledger ? r.ledger.invest + r.ledger.opex : undefined, 2))}</td><td>${esc(fmt(r.co2Prod * mul))}/${esc(fmt(r.co2Cons * mul))}</td><td>${esc(fmt(rep?.contrib?.[t.id]?.exportMWh, 1))}/${esc(fmt(rep?.contrib?.[t.id]?.importMWh, 1))}</td><td>+${esc(fmt(V.econ.score?.by[t.id]?.coop, 1))}</td></tr>`;
      }).join("")}</tbody></table></div><p class="lg-hint">모두 월 기준. 공동 보너스는 도시 자체 부분 점수 ${Object.keys(params("wScore")).length}개와 별도로 더해요.</p><p id="lg-host-outage-def" class="lg-hint">* ${esc(outageHoursDef(days))}</p>`;
    }
    const rows = act.map(t => {
      const r = res.team[t.id];
      return `<tr style="--c:${t.color}"><th scope="row">${esc(t.name)}</th>
        <td class="num" data-bad="${r.unsPct > g.unsPct}">${fmt(r.unsPct, 2)}%</td><td class="num" data-bad="${r.hospH > 0}">${r.hospH}</td>
        <td class="num">${fmt(r.cost.inv != null ? r.cost.inv : r.cost.capex, 1)} / ${fmt(r.cost.opex != null ? r.cost.opex : r.cost.fuel, 1)}</td><td class="num">${fmt(r.co2Prod)}</td><td class="num">${fmt(r.co2Cons)}</td>
        <td class="num">${fmt(r.imp, 1)} / ${fmt(r.exp, 1)}</td><td class="num">${fmt(r.earn - r.pay, 2)}</td><td class="num">${r.sat}</td></tr>`;
    }).join("");
    const maxC = Math.max(1, ...act.map(t => Math.max(res.team[t.id].co2Prod, res.team[t.id].co2Cons)));
    const bars = act.map(t => { const r = res.team[t.id]; return `<li style="--c:${t.color}"><span>${esc(t.name)}</span><i style="width:${(100 * r.co2Prod / maxC).toFixed(1)}%" class="p"></i><i style="width:${(100 * r.co2Cons / maxC).toFixed(1)}%" class="c"></i></li>`; }).join("");
    return `<h2>${resLabel(res)} 결과</h2>
      <p class="lg-goals"><span data-ok="${res.region.ok.uns}">지역 정전 ${fmt(res.region.unsPct, 2)}% (목표 ≤ ${g.unsPct}%)</span><span data-ok="${res.region.ok.co2}">지역 CO₂ ${fmt(res.region.co2)} t (목표 ≤ ${fmt(g.co2)} t)</span></p>
      <div class="lg-tablewrap"><table class="lg-table"><thead><tr><th scope="col">팀</th><th scope="col">정전</th><th scope="col">병원 정전(h)</th><th scope="col">새 투자 / 운영(억)</th><th scope="col">CO₂ 생산(t)</th><th scope="col">CO₂ 소비(t)</th><th scope="col">수입/수출(MWh)</th><th scope="col">거래 수지(억)</th><th scope="col">최저 만족</th></tr></thead><tbody>${rows}</tbody></table></div>
      <figure class="lg-co2"><figcaption>CO₂ — <b class="p">생산 기준</b>(발전소가 있는 곳) vs <b class="c">소비 기준</b>(전기를 쓴 곳)</figcaption><ul>${bars}</ul></figure>`;
  }

  // 정전 시간 정의(league-core run의 outH): 거래 뒤 도시 부족량이 그 시각 도시 수요의 2%(최소 0.005 MW)를 넘은 시간.
  function outageHoursDef(days, cumulative = false) {
    return `정전 시간은 도시 안 부족량의 합이 그 시각 도시 수요의 ${fmt(params("outageHourShare") * 100)}%를 넘은 시간${cumulative ? "의 합" : ""}이에요(최소 판정선 ${fmt(params("outageHourMinMW"), 3)} MW, ${cumulative ? "누적 최대" : "이번 달 최대"} ${fmt(days * 24)}시간). 정전율은 못 보낸 전력의 비율이라 따로 읽어요.`;
  }
  // 월 결과는 대표 운전 일수를 월 일수로 환산한다. %는 비율이므로 환산하지 않는다.
  function resultPeriod(V, res) {
    const rd = C.roundsOf(V)[res.round - 1];
    const days = rd?.mdays || res.days;
    return { days, mul: days / res.days };
  }
  function resultHeading(V, res) {
    const next = C.roundsOf(V)[res.round];
    return res.month ? `${res.month}월 결과 · ${next ? `다음 운영 ${next.month}월` : "운영 종료"}` : `${resLabel(res)} 결과`;
  }
  function resultReport(V, res) {
    return res.econ || (V.econ?.report?.year === res.year && V.econ?.report?.month === res.month ? V.econ.report : null);
  }
  const trialScope = id => JSON.stringify([L.room, id]);
  function matchingTrial(V, res, id) {
    const map = C.teamDef(R(), id).pack;
    const trial = BG.lastTrial?.(map, trialScope(id));
    return trial && trial.scope === trialScope(id) && trial.map === map && trial.days > 0 &&
      trial.year === res.year && trial.month === res.month && trial.season === res.season ? trial : null;
  }
  function trialCompareHTML(V, res, id) {
    const r = res.team[id], trial = matchingTrial(V, res, id), { days, mul } = resultPeriod(V, res);
    if (!trial) return `<section id="lg-trial-compare" class="lg-sec"><h4>시험 / 실제 / 차이 원인</h4><p class="lg-hint">같은 방·도시·월의 시험 기록이 없어요. 계획 단계에서 시험 운전하면 비교할 수 있어요.</p></section>`;
    const tm = days / trial.days, approximate = trial.days !== res.days;
    const rows = [["정전", trial.unsPct, r.unsPct, "%"], ["정전 시간", trial.outH * tm, r.outH * mul, "시간"],
      ...(V.econ ? [["CO₂ 소비(계통 포함)", trial.co2 * tm, r.co2Cons * mul, "t"]] : []),
      ["전력 운영비", trial.opex * tm, (r.cost.fuel + r.cost.policy) * mul, "억"]];
    const events = (V.events || []).filter(ev => ev.round === res.round && C.eventDef(R(), ev.id) && C.hits(R(), C.eventDef(R(), ev.id), id));
    const candidates = [events.length ? `사건: ${events.map(ev => C.eventDef(R(), ev.id).name).join(", ")}` : "사건: 해당 없음",
      `이웃 구매 ${fmt(r.imp * mul, 1)} / 판매 ${fmt(r.exp * mul, 1)} MWh`,
      `접속 대기: ${fmt(r.grid?.waitingMW, 1)} MW`,
      `날씨: ${trial.seed === res.seed && trial.days === res.days ? "같은 날씨 조건·운전 기간" : "날씨 조건 또는 운전 기간이 다름"}`];
    const attribution = outageAttribution(V, res, id);
    const attributionText = !attribution ? "후보별 영향 크기는 분리하지 않았어요." : attribution.basis === "monthly" ?
      "원인 카드는 지난달 실제 → 이번 달 실제의 정전 변화를 나눠요. 위 시험 / 실제 차이와는 기준이 달라요." :
      "시험 → 실제의 정전 변화를 단계별로 나눠 계산했어요. 약속이 예상과 다르면 원인 카드에서 몫을 열어 비교해요.";
    return `<section id="lg-trial-compare" class="lg-sec"><h4>시험 / 실제 / 차이 원인</h4><p class="lg-hint">${esc(`${trial.days}일 시험과 대표 ${res.days}일 실제를 ${days}일 ${V.econ ? "월" : "라운드"} 기준으로 환산${approximate ? "(시험 추정)" : ""}`)}${V.econ ? " · CO₂는 소비 기준(계통 포함)" : ""} · 시험은 이웃 거래 없이 도시 단독${V.econ ? " + 계통 수입" : ""}</p>
      <table class="lg-table lg-compare"><thead><tr><th scope="col">지표</th><th scope="col">시험</th><th scope="col">실제</th></tr></thead><tbody>${rows.map(([label, a, b, unit]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(fmt(a, 2))}${unit}</td><td>${esc(fmt(b, 2))}${unit}</td></tr>`).join("")}</tbody></table>
      <p id="lg-trial-reasons">차이 원인 후보: ${esc(candidates.join(" · "))}</p><p class="lg-hint">시험 뒤 계획을 바꿔도 차이가 나요. ${attributionText} 비용은 기존 설비 투자액을 빼고 전력 운영비만 비교해요. 실제 신규 투자 ${esc(fmt(r.ledger?.invest, 2))}억은 아래 장부에 따로 표시해요(거래·연구·대응·공공서비스는 이 비교에서 제외).</p></section>`;
  }
  function withCityPack(id, fn) {
    const prior = Object.entries(BG.PACKS).find(([, p]) => p._bL?.tiles === BG.TILES || p._b?.tiles === BG.TILES);
    const mode = prior?.[1]._bL?.tiles === BG.TILES ? "league" : undefined;
    const oldBLD = BG.BLD, hadPK = Object.hasOwn(BG, "PK");
    try { BG.selectPack(C.teamDef(R(), id).pack, "league"); return fn(); }
    finally { if (prior) BG.selectPack(prior[0], mode); BG.BLD = oldBLD; if (!hadPK) delete BG.PK; }
  }
  function co2Attribution(V, res, id) {
    const previous = V.results.find(x => x.round === res.round - 1), rep = resultReport(V, res);
    if (!previous?.team[id] || !rep) return null;
    L.co2Cache = L.co2Cache || {};
    const key = JSON.stringify([id, res.round]);
    if (Object.hasOwn(L.co2Cache, key)) return L.co2Cache[key];
    // 다음 계획이 이미 편집 중이면 지난 계획으로 가장하지 않는다.
    if (V.round !== res.round || !["review", "end"].includes(V.phase) || !V.teams[id].plan) return null;
    return withCityPack(id, () => {
      const city = V.econ.cities[id], before = V.econ.before?.[id];
      if (!before) return null;
      // hist는 이번 달 월말까지 포함하므로, 지난 운영의 시작 인구는 세 번째 끝 항목이다.
      const old = city.hist?.at(-3) || { pop: city.pop0, ind: city.ind0 };
      const nowDM = KCP.econ.demandMul({ ...city, pop: before.pop, ind: before.ind });
      const oldDM = KCP.econ.demandMul({ ...city, pop: old.pop, ind: old.ind });
      const input = structuredClone({ ...V, events: [], round: res.round,
        econ: { ...V.econ, cities: { ...V.econ.cities, [id]: { ...city, pop: before.pop, ind: before.ind } } } });
      const mods = C.trialMods(input, R(), id), plan = BG.sanitize(V.teams[id].plan, 1e9);
      // 같은 이번 달 계획·접속·기술과 난수에서 계절·주민/산업 수요 배수만 바꾼다.
      const sim = (season, dm) => BG.simulate({ ...plan, season, seed: res.seed }, res.days,
        { league: true, mods: { ...mods, demandRes: dm.res, demandInd: dm.ind } }).co2;
      const current = sim(res.season, nowDM), baseline = sim(previous.season, oldDM);
      const period = resultPeriod(V, res), prevPeriod = resultPeriod(V, previous);
      const seasonalDemand = (current - baseline) * period.mul;
      const calendar = previous.team[id].co2Prod * (period.days - prevPeriod.days) / previous.days;
      const total = res.team[id].co2Prod * period.mul - previous.team[id].co2Prod * prevPeriod.mul;
      return L.co2Cache[key] = { total, seasonalDemand, calendar, choice: total - seasonalDemand - calendar };
    });
  }
  // 순차 반사실(G). 공개 상태·요청 본문에는 붙이지 않고 현재 기기 세션에서만 캐시한다.
  const outageCacheKey = (res, id, trial, promisedTrial) => JSON.stringify([id, res.round,
    trial && [trial.seed, trial.days, trial.unsPct, trial.gridMWh, trial.plan], promisedTrial && [promisedTrial.gridMWh, promisedTrial.days], "d82"]);
  // flow는 손실 뒤 도착량이며 화력 대체도 포함한다. 기존 결과로 계통 수입 전
  // 거래 단계를 복원한다. 시간별 공급 식은 core만 소유하고 반올림 잔차는 마지막 몫에 둔다.
  // D-74: 이번 결과의 공급이 모두 바깥 계통에서 왔는지(자체 발전·이웃 구매 0). 결과 서랍의 계통 수입 역산과 같은 공개 필드만 쓴다.
  // 바깥 계통이 메워 준 전기(대표 기간 MWh): 고립 운전 정전 − 실제 정전 − 이웃 구매 + 판매 대체분. 공개 필드로 역산하며 없으면 null.
  function gridFillMWh(r) {
    if (!r || ![r.uns, r.imp, r.sub, r.isolated?.uns].every(Number.isFinite)) return null;
    return Math.max(0, r.isolated.uns - r.uns - r.imp + r.sub);
  }
  // 전체 결과가 있는 기기는 직접 합산하고, 팀은 받은 달만 기존 기기 기록에서 보충한다.
  function gridTotal(V, id) {
    const history = L.S?.results || V.results || [];
    const saved = L.role === "team" && id === L.team ? tdata().interview?.metrics : null;
    let mwh = 0, months = 0, total = 0;
    history.forEach(res => {
      if (!res.team?.[id]) return;
      total++;
      const direct = gridFillMWh(res.team[id]);
      const value = direct == null ? saved?.[res.round]?.grid : direct * resultPeriod(V, res).mul;
      if (!Number.isFinite(value)) return;
      mwh += value; months++;
    });
    return months ? { mwh, cost: mwh * params("normalCost") * params("gridImportMarkup"), months, total } : null;
  }
  function gridTotalText(V, grid) {
    const none = grid.mwh < 0.1;
    const sum = none ? "계통이 메운 전기 없음" : `계통이 메운 전기 ${fmt(grid.months)}달 합 ${fmt(grid.mwh, 1)} MWh · 비용 약 ${fmt(grid.cost, 2)}억`;
    const annual = !none && C.roundsOf(V).length !== 12 ? ` · 1년 평균 ${fmt(grid.mwh * 12 / grid.months, 1)} MWh` : "";
    const missing = grid.months < grid.total ? ` (받지 못한 ${fmt(grid.total - grid.months)}달 빠짐)` : "";
    return sum + annual + missing;
  }
  // D-80: 정전 0은 표시 자릿수(소수 둘째 자리)에서 0. '같을 것' 문턱은 A-3 측정 전 임시값(G).
  const ZERO_OUTAGE_PCT = params("zeroOutagePct"), GRID_SAME_MWH = params("gridSameMwh"), GRID_SAME_SHARE = params("gridSameShare");
  const gridSameTol = baseMwh => Math.max(GRID_SAME_MWH, Number.isFinite(baseMwh) ? GRID_SAME_SHARE * Math.abs(baseMwh) : 0);
  // D-82 G 잠정 제안. 실제 영상 표본·후보·한계: tests/league/review/D82-gridtol-report.md.
  const GRID_SAME_MWH_PER_DAY = params("gridSameMwhPerDay"), GRID_SAME_SHARE_PER_DAY = params("gridSameSharePerDay");
  // 진행자 장부 ◆ 문턱(G, 총괄 결정): 하루 평균 계통이 이 값을 넘고 정전이 ZERO_OUTAGE_PCT 미만인 달.
  const GRID_LEAN_PER_DAY = params("gridLeanPerDay");
  // 계통 하루 평균의 표시 경계: 소수 한 자리로 반올림하면 0이 되는 값(판정 문턱·진행자 ◆ 문턱과 뜻이 다르다).
  // '0.1 MWh/일 미만' 표기와 결과 서랍 [data-grid-fill] 숨김이 읽는다. S7의 OUTAGE_MIN_GRID_PART_PER_DAY와
  // outageReplayShown의 계통 .05도 같은 표시 경계다(리그 기준 2 갈래 몫이라 여기서 묶지 않음).
  const GRID_DISPLAY_MIN_PER_DAY = 0.05;
  const gridSameTolPerDay = basePerDay => Math.max(GRID_SAME_MWH_PER_DAY,
    Number.isFinite(basePerDay) ? GRID_SAME_SHARE_PER_DAY * Math.abs(basePerDay) : 0);
  // 계통이 메운 전기의 월 환산과 비교 기준. 공개 결과 필드와 기기 안 시험 기록만 읽는 순수 함수다.
  function gridReliance(V, res, id) {
    const price = params("normalCost") * params("gridImportMarkup"), costOf = mwh => mwh == null ? null : mwh * price;
    const period = resultPeriod(V, res), days = period.days;
    const own = gridFillMWh(res?.team?.[id]), mwh = own == null ? null : own * period.mul, perDay = mwh == null ? null : mwh / days;
    const previous = V.results?.find(x => x.round === res.round - 1), last = gridFillMWh(previous?.team?.[id]);
    let base = { kind: null, label: previous ? "비교 없음(지난달 계통 값 없음)" : "비교 없음(첫 결과)", mwh: null, cost: null, days: null, perDay: null };
    if (last != null) {
      const prevPeriod = resultPeriod(V, previous), previousMWh = last * prevPeriod.mul;
      base = { kind: "last", label: "지난달 대비", mwh: previousMWh, days: prevPeriod.days, perDay: previousMWh / prevPeriod.days };
    }
    else if (!previous) {
      const trial = matchingTrial(V, res, id);
      if (trial && Number.isFinite(trial.gridMWh)) base = { kind: "trial", label: trialBaselineLabel(trial), mwh: trial.gridMWh * days / trial.days, days: trial.days, perDay: trial.gridMWh / trial.days };
      else if (trial) base.label = "비교 없음(시험 기록에 계통 값 없음)";
    }
    base.cost = costOf(base.mwh);
    const delta = mwh != null && base.mwh != null ? mwh - base.mwh : null;
    const deltaPerDay = perDay != null && base.perDay != null ? perDay - base.perDay : null;
    return { mwh, cost: costOf(mwh), base, delta, deltaCost: delta == null ? null : delta * price, tol: gridSameTol(base.mwh),
      days, perDay, deltaPerDay, deltaPerDayCost: deltaPerDay == null ? null : deltaPerDay * price,
      tolPerDay: gridSameTolPerDay(base.perDay), unit: "MWh/일" };
  }
  function gridOnlyServed(V, r) {
    if (!V.econ || !r || !Number.isFinite(r.dem)) return false;
    const served = r.dem - r.uns, grid = gridFillMWh(r);
    return grid != null && served > params("gridOnlyServedMwh") && served - grid <= params("gridOnlyServedMwh");
  }
  function outageNeighborStage(res, id, isolated) {
    const imported = Object.entries(res.flow || {}).reduce((sum, [key, flow]) => {
      const [a, b] = key.split("~");
      return sum + (id === b ? flow.ab : id === a ? flow.ba : 0);
    }, 0);
    const r = res.team[id], demand = r.dem;
    return { imported, unsPct: Math.max(0, isolated - 100 * Math.max(0, imported - r.sub) / Math.max(1e-9, demand)) };
  }
  const outageGridClue = monthly => `바깥 계통이 메워 준 몫의 ${monthly ? "지난달 대비" : "시험 대비"} 변화 · 매시간 수요의 ${fmt(params("gridImportShare") * 100)}%까지 · 기준 원가의 ${fmt(params("gridImportMarkup"), 1)}배(${gradeWords("G")})`;
  // 이미 계산한 두 단계의 대표 기간 결과만 요약한다. 새 시뮬레이션·전송값은 없다.
  function outageWeatherMetrics(s, plan, mods) {
    const climate = BG.PACKS[s.map]?.climate;
    const liveWind = BG.network(plan).nodes.filter(n => n.live && ["wind", "offshore"].includes(n.kind) &&
      !(mods.disabledBuilds || []).includes(`${n.kind}:${n.tile}`) &&
      (!mods.reCap || (mods.reCap[`${n.kind}:${n.tile}`] || 0) > 0));
    const windMean = kind => climate && liveWind.some(n => n.kind === kind) && s.hrWind?.length ?
      s.hrWind.reduce((sum, mult, k) => {
        const m = s.wx[Math.floor(k / 24)].m;
        return sum + (kind === "offshore" ? climate.wind100_sea[m] : climate.wind10_land[m] * climate.hub_factor_land) * mult;
      }, 0) / s.hrWind.length : null;
    const wind = windMean("wind"), offshoreWind = windMean("offshore");
    return { wind, offshoreWind, hasConnectedWind: [wind, offshoreWind].some(Number.isFinite),
      renPerDay: s.tot.ren / s.days, demand: s.tot.dem / s.H,
      peakDemand: Math.max(...s.hrDem), hotDays: s.wx.filter(d => d.hot).length,
      unsPct: s.tot.dem > 0 ? 100 * s.unsTotal / s.tot.dem : 0 };
  }
  function outageWeatherClue(before, after, oldSeason, season, oldDays, days, monthly) {
    const wind = [["wind", "육상 허브 기준"], ["offshoreWind", "해상 100m 기준"]]
      .filter(([key]) => [before[key], after[key]].every(Number.isFinite))
      .map(([key, label]) => `평균 풍속(${label}) ${fmt(before[key], 1)} → ${fmt(after[key], 1)} m/s`);
    const demand = `평균 수요 ${fmt(before.demand, 2)} → ${fmt(after.demand, 2)} MW`;
    const renChange = before.renPerDay > 0 ? `${signed((after.renPerDay / before.renPerDay - 1) * 100, 1)}%` : `${fmt(before.renPerDay, 1)} → ${fmt(after.renPerDay, 1)} MWh/일(이전 값 0)`;
    const renewable = before.renPerDay === 0 && after.renPerDay === 0 ? "재생 공급 없음" : `하루 재생 공급량 ${renChange}`;
    // 순서만 정하는 단순 근사(G): 평균 수요 증가와 평균 재생 공급 감소를 같은 MW로 비교한다.
    // 열기 전 몫의 부호가 드러나지 않도록 두 변화의 절댓값만 비교한다.
    // 시간대·송전·저장 효과를 분리한 인과 몫은 아니며 추가 시뮬레이션도 하지 않는다.
    const demandImpact = after.demand - before.demand, renImpact = (before.renPerDay - after.renPerDay) / 24;
    const physical = Math.abs(renImpact) > Math.abs(demandImpact) ? [renewable, demand] : [demand, renewable];
    const differentDays = oldDays !== days;
    const hot = differentDays ? `무더위 ${fmt(100 * before.hotDays / oldDays, 0)}% → ${fmt(100 * after.hotDays / days, 0)}% 날` : `무더위 ${before.hotDays} → ${after.hotDays}일`;
    const detail = [...physical, hot, ...wind, `계절 ${SEASON_NAME[oldSeason]} → ${SEASON_NAME[season]}`].join(" · ");
    const same = (key, digits) => fmt(before[key], digits) === fmt(after[key], digits);
    const items = physical.map(text => text === demand ?
      { text, unchanged: same("demand", 2), value: `평균 수요 ${fmt(after.demand, 2)} MW` } :
      { text, unchanged: same("renPerDay", 1), value: after.renPerDay === 0 ? "재생 공급 없음" : `하루 재생 공급량 ${fmt(after.renPerDay, 1)} MWh/일` });
    const beforeHot = differentDays ? fmt(100 * before.hotDays / oldDays, 0) : String(before.hotDays);
    const afterHot = differentDays ? fmt(100 * after.hotDays / days, 0) : String(after.hotDays);
    items.push({ text: hot, unchanged: beforeHot === afterHot, value: `무더위 ${afterHot}${differentDays ? "% 날" : "일"}` });
    for (const [key, label] of [["wind", "육상 허브 기준"], ["offshoreWind", "해상 100m 기준"]]) {
      if ([before[key], after[key]].every(Number.isFinite)) items.push({
        text: `평균 풍속(${label}) ${fmt(before[key], 1)} → ${fmt(after[key], 1)} m/s`,
        unchanged: same(key, 1), value: `평균 풍속(${label}) ${fmt(after[key], 1)} m/s` });
    }
    items.push({ text: `계절 ${SEASON_NAME[oldSeason]} → ${SEASON_NAME[season]}`,
      unchanged: oldSeason === season, value: `계절 ${SEASON_NAME[season]}` });
    const unchanged = items.filter(x => x.unchanged).map(x => x.value);
    const body = [...items.filter(x => !x.unchanged).map(x => x.text), ...(unchanged.length ? [`같음: ${unchanged.join(" · ")}`] : [])].join(" · ");
    const withTail = `${body} · 자세한 값은 단서 더 보기`;
    const short = withTail.length <= 70 ? withTail : body;
    return { short, full: `${detail} · 최대 수요 ${fmt(before.peakDemand, 2)} → ${fmt(after.peakDemand, 2)} MW · 하루 재생 공급량 ${fmt(before.renPerDay, 1)} → ${fmt(after.renPerDay, 1)} MWh/일 · 대표 운전 ${oldDays} → ${days}일. ${monthly ? "지난달 → 이번 달" : "시험 → 실제"} 날씨를 같은 이번 운영 계획·접속 조건으로 비교해요. 사건·주민·산업 조건도 고정해요. 수요에는 기온·계절 영향이 포함되고, 무더위는 모형의 일 최고기온 ${BG.M.hotTmax}℃ 초과 ${differentDays ? "날의 비율이에요" : "일수예요"}. 재생 공급량은 접속 할당·출력제어를 반영해 실제 공급한 양이에요. 풍속은 접속된 풍력 종류만 표시하며 설치 위치별 보정은 제외해요. 단서 순서는 평균 수요·재생 공급 변화의 절댓값으로 정해요(게임 가정).` };
  }
  // D-80 / 계약 A: 지도 수입 설비의 출력을 제외한 계통 보충량만 읽는다.
  function outageFilled(raw) {
    const filled = C.gridFill(raw);
    return { filledUnsPct: filled.tot.dem > 0 ? 100 * filled.unsTotal / filled.tot.dem : 0,
      gridMWh: filled.tot.by.import - raw.tot.by.import };
  }
  const outageStageValue = (stage, target, days) => target === "grid" ? stage.gridMWh / days : stage.filledUnsPct;
  function outageAttribution(V, res, id, note) {
    if (!L || !res?.team?.[id]) return null;
    const n = note || (id === L.team ? tdata().interview?.months?.[res.round] : null);
    // 실제로 연 분해는 기기 메모에 고정한다. 새 시험·캐시보다 먼저 읽는다(D-65).
    if ((n?.outageOpened || n?.outageSingleShown) && n.outageFrozen?.round === res.round && n.outageFrozen.id === id &&
        !outageLegacyGrid(n.outageFrozen)) return n.outageFrozen;
    if (V.econ && res.round > 1) return outageAttributionMonthly(V, res, id, note);
    L.outCache ||= {};
    const trial = matchingTrial(V, res, id);
    // 같은 달 시험을 다시 돌리면 새 분해를 계산한다. 시험 계획 전체도 식별에 포함한다.
    const key = outageCacheKey(res, id, trial, n?.trial);
    if (Object.hasOwn(L.outCache, key)) return L.outCache[key];
    if (V.round !== res.round || !["review", "end"].includes(V.phase) || !V.teams[id]?.plan) return null;
    const before = V.econ?.before?.[id];
    const events = (V.events || []).filter(ev => ev.round === res.round);
    L.outFailures ||= {};
    if (!trial?.plan) return null;
    if (!before || ![trial.unsPct, trial.seed, res.seed, res.days, res.team[id].unsPct].every(Number.isFinite) ||
        res.days <= 0 || events.some(ev => !Number.isFinite(ev.x))) {
      L.outFailures[key] = { attempts: 2, render: L.outRender || 0 };
      return null;
    }
    const failed = L.outFailures[key], render = L.outRender || 0;
    // 같은 그리기의 여러 호출은 재시도하지 않는다. 다음 그리기에 한 번만 재시도한다.
    if (failed && (failed.attempts >= 2 || failed.render === render)) return null;
    const started = performance.now();
    try {
      return withCityPack(id, () => {
        const city = V.econ.cities[id];
        const input = structuredClone({ ...V, round: res.round,
          teams: Object.fromEntries(Object.entries(V.teams).map(([tid, t]) =>
            [tid, { ...t, construction: t.construction || t.research?.construction }])),
          econ: { ...V.econ, intl: V.econ.intl?.cur ? V.econ.intl : { cur: V.econ.intl },
            cities: { ...V.econ.cities, [id]: { ...city, pop: before.pop, ind: before.ind } } },
          grid: Object.fromEntries(actT(V).map(t => [t.id, V.grid?.[t.id]?.entries ? V.grid[t.id] : V.teams[t.id].trialGrid])) });
        // 공개 trialGrid의 key·allocatedMW에 실제 계획의 종류·용량을 다시 붙인다.
        if (actT(V).every(t => !input.grid[t.id])) delete input.grid;
        const trialInput = { ...input, events: [], teams: { ...input.teams, [id]: { ...input.teams[id], plan: trial.plan } } };
        const trialMods = C.trialMods(trialInput, R(), id);
        const grid = C.gridStatus(input, R(), BG, id);
        input.grid = { ...input.grid, [id]: grid };
        // gridStatus가 이웃의 연결점도 읽으므로, 시뮬레이션 전에 내 지도를 다시 고른다.
        BG.selectPack(C.teamDef(R(), id).pack, "league");
        const normalMods = C.modsFor({ ...input, events: [] }, R(), id), eventMods = C.modsFor(input, R(), id);
        const target = trial.unsPct < ZERO_OUTAGE_PCT && res.team[id].unsPct < ZERO_OUTAGE_PCT ? "grid" : "uns";
        let simulations = 0, gridFills = 0;
        const sim = (plan, seed, days, mods) => {
          const st = BG.sanitize(plan, 1e9);
          st.season = res.season; st.seed = seed;
          if (mods.tax && !st.policies.includes("tax")) st.policies.push("tax");
          simulations++;
          const s = BG.simulate(st, days, { league: true, mods });
          const unsPct = s.tot.dem > 0 ? 100 * s.unsTotal / s.tot.dem : 0;
          if (!Number.isFinite(unsPct) || !Number.isFinite(s.tot.ren)) throw new Error("outage simulation");
          gridFills++;
          return { unsPct, ...outageWeatherMetrics(s, st, mods), ...outageFilled(s) };
        };
        const plan = input.teams[id].plan;
        const base = sim(trial.plan, trial.seed, trial.days, trialMods);
        const choice = sim(plan, trial.seed, trial.days, normalMods);
        const weather = sim(plan, res.seed, res.days, normalMods);
        const event = sim(plan, res.seed, res.days, eventMods);
        // 연결 대기 반사실은 거래 전 단계에 같은 계통 보충을 적용해 비교한다. 분해 합계에는 더하지 않는다.
        const reCap = Object.fromEntries((grid?.entries || []).map(b => [b.key, b.mw]));
        const waitingMW = res.team[id].grid?.waitingMW ?? grid.waitingMW;
        const connected = waitingMW > 0 ? sim(plan, res.seed, res.days, { ...eventMods, reCap }) : event;
        const value = stage => outageStageValue(stage, target, res.days);
        // 시험·실제 각 대표기간의 하루 평균으로 비교해 달 길이 효과를 제거한다.
        const baseValue = outageStageValue(base, target, trial.days);
        const choiceValue = outageStageValue(choice, target, trial.days);
        const weatherValue = value(weather), eventValue = value(event);
        const trialValue = target === "grid" ? Number.isFinite(n?.trial?.gridMWh) && n.trial.days > 0 ? n.trial.gridMWh / n.trial.days
          : Number.isFinite(trial.gridMWh) ? trial.gridMWh / trial.days : null : trial.unsPct;
        const actual = target === "grid" ? gridFillMWh(res.team[id]) : res.team[id].unsPct;
        if (!Number.isFinite(actual)) throw new Error("outage actual");
        const actualValue = target === "grid" ? actual / res.days : actual;
        const total = trialValue == null ? null : actualValue - trialValue;
        const replay = trialValue == null ? null : baseValue - trialValue;
        const neighbor = outageNeighborStage(res, id, event.unsPct);
        // Σ몫 = 실제 − base. replay = base − 기록값이므로 Σ몫 + replay = total.
        const parts = [
          { key: "choice", value: choiceValue - baseValue },
          { key: "weather", value: weatherValue - choiceValue },
          { key: "event", value: eventValue - weatherValue },
          { key: "trade", value: actualValue - eventValue }
        ];
        const oldBuilds = new Set((trial.plan.builds || []).map(b => C.itemKey("b", b)));
        const newBuilds = new Set((plan.builds || []).map(b => C.itemKey("b", b)));
        const added = [...newBuilds].filter(k => !oldBuilds.has(k)).length;
        const removed = [...oldBuilds].filter(k => !newBuilds.has(k)).length;
        const changed = ["lines", "policies", "shed", "fab2", "rq"].filter(k => JSON.stringify(trial.plan[k]) !== JSON.stringify(plan[k]));
        const eventClue = outageEventClue(events, input, res, id, plan);
        const weatherClue = outageWeatherClue(choice, weather, res.season, res.season, trial.days, res.days, false);
        const clues = {
          choice: `시험 뒤 설비 ${added}개 추가 / ${removed}개 제거${changed.length ? ` · ${changed.map(k => ({ lines: "전선", policies: "정책", shed: "배분", fab2: "산업 증설", rq: "연구" }[k])).join("·")} 변경` : ""}`,
          weather: weatherClue.short,
          event: eventClue.short,
          trade: `이웃 구매 ${fmt(neighbor.imported * resultPeriod(V, res).mul, 1)} / 판매 ${fmt(res.team[id].exp * resultPeriod(V, res).mul, 1)} MWh(월 환산)${target === "grid" ? " · 이웃에게 산 만큼 바깥 계통에 덜 기대요" : ""}`
        };
        delete L.outFailures[key];
        return L.outCache[key] = { basis: "trial", target, ...(target === "grid" ? { unit: "MWh/일" } : {}), base: baseValue, round: res.round, id, trialIdentity: key,
          trial: trialValue, actual: actualValue, total, replay, parts, clues, clueMore: { event: eventClue.full, weather: weatherClue.full },
          hasConnectedWind: weather.hasConnectedWind,
          grid: { value: value(connected) - eventValue, waitingMW },
          simulations, gridFills, ms: performance.now() - started };
      });
    } catch (e) {
      L.outFailures[key] = { attempts: (failed?.attempts || 0) + 1, render };
      return null;
    }
  }
  // 월간 S7 사본은 방·팀별 tdata에만 둔다. 공개 상태·요청 본문에는 추가하지 않는다.
  function outageRememberIntl(V) {
    if (!V.econ || V.phase !== "plan" || !L.team) return;
    const intl = V.econ.intl?.cur || V.econ.intl, d = s7data();
    if (!Number.isFinite(intl?.fuelMul)) return;
    const pending = { round: V.round, intl };
    if (JSON.stringify(d.outageOperatingIntl) !== JSON.stringify(pending)) {
      d.outageOperatingIntl = structuredClone(pending); putS7(d);
    }
  }
  function outageOperatingInput(V, res, id, intl) {
    const input = structuredClone({ ...V, round: res.round,
      teams: Object.fromEntries(Object.entries(V.teams).map(([tid, t]) =>
        [tid, { ...t, construction: t.construction || t.research?.construction }])),
      econ: { ...V.econ, intl: { cur: intl }, cities: Object.fromEntries(Object.entries(V.econ.cities).map(([tid, city]) =>
        [tid, { ...city, ...(V.econ.before[tid] || {}) }])) },
      grid: Object.fromEntries(actT(V).map(t => [t.id, V.grid?.[t.id]?.entries ? V.grid[t.id] : V.teams[t.id].trialGrid])) });
    if (actT(V).every(t => !input.grid[t.id])) delete input.grid;
    input.grid = { ...input.grid, [id]: C.gridStatus(input, R(), BG, id) };
    BG.selectPack(C.teamDef(R(), id).pack, "league");
    return input;
  }
  function outageSim(plan, seed, season, days, mods, weatherMetrics, output) {
    const st = BG.sanitize(plan, 1e9);
    st.seed = seed; st.season = season;
    if (mods.tax && !st.policies.includes("tax")) st.policies.push("tax");
    const s = BG.simulate(st, days, { league: true, mods });
    if (![s.tot.dem, s.unsTotal].every(Number.isFinite)) throw new Error("outage simulation");
    const pct = s.tot.dem > 0 ? 100 * s.unsTotal / s.tot.dem : 0;
    if (!Number.isFinite(pct)) throw new Error("outage simulation");
    if (weatherMetrics) Object.assign(weatherMetrics, outageWeatherMetrics(s, st, mods));
    if (output) output.raw = s;
    return pct;
  }
  // 태블릿 재생: S7 사본의 공개 재료(계획·씨앗·사건 배수)만 읽어 기기 안에서 다시 돌린다.
  // S7 블록은 바꾸지 않는다(소유: 리그 완성 기준 2). simulate 옵션은 league-core simTeam과 같게 둔다.
  // 원시 시간별 값은 메모리에만 둔다(D-65).
  let replaySimulationCache = null;
  function outageReplaySimulation(id, snapshot) {
    const { plan, mods, seed, season, days, round } = snapshot;
    const key = JSON.stringify([id, round, plan, mods, seed, season, days]);
    if (replaySimulationCache?.session === L && replaySimulationCache.key === key) return replaySimulationCache.res;
    const res = withCityPack(id, () => {
      const st = BG.sanitize(plan, 1e9);
      st.seed = seed; st.season = season;
      if (mods?.tax && !st.policies.includes("tax")) st.policies.push("tax");
      return BG.simulate(st, days, { league: true, mods: mods && Object.keys(mods).length ? mods : null });
    });
    replaySimulationCache = { session: L, key, res };
    return res;
  }
  // S7 사본은 계획이 없는 도시(아무것도 짓지 않은 달)를 만들지 않는다. 재생만 같은 공개 재료로 빈 계획을 돌린다.
  // 국제 지수 선택은 S7 사본(outageSnapshot)과 같은 순서를 따른다.
  function emptyPlanReplayInput(V, res, id) {
    if (V.teams[id]?.plan || !V.econ?.before?.[id]) return null;
    const d = tdata(), kept = d.outageSnapshots && typeof d.outageSnapshots === "object" ? d.outageSnapshots : {}, initial = KCP.ECON_DATA.intl.base;
    const intl = d.outageOperatingIntl?.round === res.round ? d.outageOperatingIntl.intl :
      kept[res.round - 1]?.nextIntl || (res.round === 1 ? { fuelMul: Math.round(initial.lng * initial.fx * 1000) / 1000 } : null);
    if (!Number.isFinite(intl?.fuelMul)) return null;
    return withCityPack(id, () => ({ round: res.round, plan: {}, seed: res.seed, days: res.days, season: res.season,
      mods: C.modsFor(outageOperatingInput(V, res, id, intl), R(), id) }));
  }
  function replaySimulation(V, res, id) {
    if (!L || L.away || id !== L.team || !res?.team?.[id] || V.round !== res.round ||
        !["review", "end"].includes(V.phase)) return null;
    const snapshot = outageSnapshot(V, res, id) || emptyPlanReplayInput(V, res, id);
    return snapshot ? outageReplaySimulation(id, snapshot) : null;
  }
  // 연계선의 반대쪽 연결 여부만 보관한다. 우리 쪽 전선은 다음 달 계획으로 다시 판단한다.
  function outageTiePorts(id, plan) {
    return withCityPack(id, () => {
      const net = BG.network(BG.sanitize(plan || {}, 1e9));
      return new Set(net.nodes.filter(n => n.kind === "import" && n.live && n.comp >= 0)
        .flatMap(n => BG.SITES[n.si].to || []));
    });
  }
  function validOutageSnapshot(s, round) {
    const object = x => !!x && typeof x === "object" && !Array.isArray(x);
    const finiteTree = x => typeof x === "number" ? Number.isFinite(x) :
      x && typeof x === "object" ? Object.values(x).every(finiteTree) : x != null;
    return object(s) && s.round === round && object(s.plan) && Array.isArray(s.plan.builds) && Array.isArray(s.plan.lines) &&
      Array.isArray(s.plan.policies) && object(s.mods) && object(s.normalMods) && object(s.eventMods) &&
      object(s.facts) && object(s.fullReCap) && Object.hasOwn(SEASON_NAME, s.season) &&
      [s.seed, s.days, s.unsPct, s.isolatedUnsPct, s.waitingMW, s.facts.pop, s.facts.ind, s.facts.fuel].every(Number.isFinite) &&
      s.days > 0 && typeof s.facts.event === "string" && finiteTree(s.mods) && finiteTree(s.normalMods) && finiteTree(s.eventMods) &&
      finiteTree(s.fullReCap) && [s.mods.essCap, s.mods.hydroMonth, s.mods.curtailP].every(Number.isFinite) &&
      object(s.mods.reCap) && s.plan.builds.every(b => object(b) && typeof b.t === "string" && Number.isInteger(b.i)) &&
      s.plan.lines.every(l => object(l) && Array.isArray(l.p) && l.p.every(Number.isInteger)) &&
      C.MUL.every(k => Number.isFinite(s.eventMods[k]));
  }
  const matchesOutageSnapshot = (s, res, id) => validOutageSnapshot(s, res.round) &&
    s.unsPct === res.team[id].unsPct && s.seed === res.seed && s.days === res.days && s.season === res.season;
  // 사본 실패도 기존처럼 같은 그리기에서 반복하지 않고 다음 그리기에 한 번만 재시도한다.
  function outageSnapshot(V, res, id) {
    if (id !== L.team || !V.econ || V.round !== res?.round || !["review", "end"].includes(V.phase)) return null;
    const d = s7data();
    const snapshots = d.outageSnapshots && typeof d.outageSnapshots === "object" && !Array.isArray(d.outageSnapshots) ? d.outageSnapshots : {};
    const kept = Object.fromEntries(Object.entries(snapshots).filter(([r]) => +r >= res.round - 1 && +r <= res.round));
    if (Object.keys(kept).length !== Object.keys(snapshots).length) { d.outageSnapshots = kept; putS7(d); }
    if (matchesOutageSnapshot(kept[res.round], res, id)) return kept[res.round];
    const key = `snapshot:${id}:${res.round}`, render = L.outRender || 0;
    L.outFailures ||= {};
    const failed = L.outFailures[key];
    if (failed && (failed.attempts >= 2 || failed.render === render)) return null;
    try {
      const before = V.econ.before?.[id], events = (V.events || []).filter(e => e.round === res.round);
      // intl는 월말 갱신된다. 계획 때 기기에 보관한 값 또는 지난 사본의 다음 운영용 값을 사용한다.
      // 첫 운영은 국제 지수 갱신 전이므로 자료의 시작 지수를 쓴다(첫 결과에서 처음 연 기기도 지원).
      const initial = KCP.ECON_DATA.intl.base;
      const hasOperatingIntl = d.outageOperatingIntl?.round === res.round;
      const intlFallback = !hasOperatingIntl && !!kept[res.round - 1]?.nextIntl;
      const intl = hasOperatingIntl ? d.outageOperatingIntl.intl :
        kept[res.round - 1]?.nextIntl || (res.round === 1 ? { fuelMul: Math.round(initial.lng * initial.fx * 1000) / 1000 } : null);
      if (!before || !V.teams[id]?.plan || !Number.isFinite(intl?.fuelMul) ||
          ![before.pop, before.ind, res.seed, res.days, res.team[id]?.unsPct].every(Number.isFinite) || res.days <= 0 ||
          events.some(e => !Number.isFinite(e.x))) {
        L.outFailures[key] = { attempts: 2, render }; return null;
      }
      const snapshot = withCityPack(id, () => {
        const input = outageOperatingInput(V, res, id, intl), plan = BG.sanitize(V.teams[id].plan, 1e9);
        const mods = C.modsFor(input, R(), id), normalMods = C.modsFor({ ...input, events: [] }, R(), id);
        // MUL 중 coalCapMul에는 기술도 곱해진다. 사건 없는 배수를 따로 보관해 0배 사건도 나눗셈 없이 제거한다.
        const eventMods = Object.fromEntries(C.MUL.map(k => [k, (mods[k] ?? 1) / (normalMods[k] ?? 1)]));
        for (const k of ["demandHours", "tax"]) if (Object.hasOwn(mods, k)) eventMods[k] = structuredClone(mods[k]);
        const eventClue = outageEventClue(events, input, res, id, plan), grid = input.grid[id];
        const hostTies = input.ties.filter(t => t.st === "built" && [t.a, t.b].includes(id) && input.teams[t.a] && input.teams[t.b])
          .map(t => {
            const other = t.a === id ? t.b : t.a;
            return [other, outageTiePorts(other, input.teams[other].plan).has(id) ? C.effectiveTie(input, t).cap * params("hostTieMul") : 0];
          });
        const ports = outageTiePorts(id, plan);
        const tieHostMW = hostTies.reduce((sum, [other, mw]) => sum + (ports.has(other) ? mw : 0), 0);
        const output = {}, isolatedUnsPct = outageSim(plan, res.seed, res.season, res.days, mods, null, output);
        const filled = outageFilled(output.raw);
        return { round: res.round, plan, seed: res.seed, days: res.days, season: res.season, mods,
          unsPct: res.team[id].unsPct, isolatedUnsPct, ...filled,
          normalMods, eventMods, hostMW: grid.hostMW, tieHostMW, hostTies,
          fullReCap: Object.fromEntries(grid.entries.map(b => [b.key, b.mw])),
          waitingMW: res.team[id].grid?.waitingMW ?? grid.waitingMW,
          facts: { pop: before.pop, ind: before.ind, fuel: intl.fuelMul, event: eventClue.full || eventClue.short,
            eventNames: events.filter(e => C.eventDef(R(), e.id) && C.hits(R(), C.eventDef(R(), e.id), id, input)).map(e => C.eventDef(R(), e.id).name).join("·") || "해당 사건 없음" },
          nextIntl: structuredClone(V.econ.intl?.cur || V.econ.intl), ...(intlFallback ? { intlFallback: true } : {}) };
      });
      if (!validOutageSnapshot(snapshot, res.round)) throw new Error("outage snapshot");
      d.outageSnapshots = { ...kept, [res.round]: structuredClone(snapshot) };
      delete d.outageOperatingIntl;
      putS7(d); delete L.outFailures[key];
      return snapshot;
    } catch (e) {
      L.outFailures[key] = { attempts: (failed?.attempts || 0) + 1, render }; return null;
    }
  }
  const monthlyOutageKey = (res, id) => JSON.stringify(["monthly", id, res.round, res.team[id].unsPct, res.seed, res.days, res.season, "d82"]);
  function outageAttributionMonthly(V, res, id, note) {
    if (!L || !res?.team?.[id] || res.round < 2) return null;
    const n = note || (id === L.team ? tdata().interview?.months?.[res.round] : null);
    if ((n?.outageOpened || n?.outageSingleShown) && n.outageFrozen &&
        n.outageFrozen.round === res.round && n.outageFrozen.id === id &&
        !outageLegacyGrid(n.outageFrozen)) return n.outageFrozen;
    const key = monthlyOutageKey(res, id);
    L.outCache ||= {}; L.outFailures ||= {};
    if (Object.hasOwn(L.outCache, key)) return L.outCache[key];
    if (V.round !== res.round || !["review", "end"].includes(V.phase)) return null;
    const started = performance.now(), hadCurrent = matchesOutageSnapshot(s7data().outageSnapshots?.[res.round], res, id);
    const current = outageSnapshot(V, res, id), old = s7data().outageSnapshots?.[res.round - 1];
    const previousResult = V.results.find(r => r.round === res.round - 1), previous = previousResult?.team[id];
    if (!current || !validOutageSnapshot(old, res.round - 1) || !Number.isFinite(previous?.unsPct) || previous.unsPct !== old.unsPct) return null;
    const failed = L.outFailures[key], render = L.outRender || 0;
    if (failed && (failed.attempts >= 2 || failed.render === render)) return null;
    try {
      return withCityPack(id, () => {
        const target = previous.unsPct < ZERO_OUTAGE_PCT && res.team[id].unsPct < ZERO_OUTAGE_PCT ? "grid" : "uns";
        let simulations = hadCurrent ? 0 : 1, gridFills = hadCurrent ? 0 : 1;
        const sim = (plan, seed, season, days, mods, weatherMetrics) => {
          const output = {};
          simulations++;
          outageSim(plan, seed, season, days, mods, weatherMetrics, output);
          gridFills++;
          return outageStageValue(outageFilled(output.raw), target, days);
        };
        const base = sim(old.plan, old.seed, old.season, old.days, old.mods);
        const oldBuilds = new Set(old.plan.builds.map(b => `${b.t}:${b.i}`)), newBuilds = new Set(current.plan.builds.map(b => `${b.t}:${b.i}`));
        const input = outageOperatingInput(V, res, id, { fuelMul: old.facts.fuel }), grid = input.grid[id];
        const ports = outageTiePorts(id, current.plan);
        const priorTieMW = old.hostTies?.reduce((sum, [other, mw]) => sum + (ports.has(other) ? mw : 0), 0);
        // 이번 계획의 ESS·우리 전선 + 지난달 이웃 연결·연계선 용량. 옛 사본에는 실제 상한을 쓴다.
        const choiceHostMW = priorTieMW == null ? grid.hostMW : grid.hostMW - current.tieHostMW + priorTieMW;
        const neighborHostMW = priorTieMW == null ? 0 : current.tieHostMW - priorTieMW;
        let actualRoom = grid.hostMW, choiceRoom = choiceHostMW;
        const choiceReCap = Object.fromEntries(grid.entries.map(b => {
          const oldMW = old.mods.reCap[b.key] || 0;
          // 실제 상한으로 잘린 기존 예약만 복원한다. 여유가 있는데 사라진 예약(같은 키 재건설)은 복원하지 않는다.
          const clippedOldMW = Math.min(oldMW, actualRoom);
          const reservedMW = neighborHostMW < 0 && b.allocatedMW + 1e-9 >= clippedOldMW ? Math.max(oldMW, b.allocatedMW) : b.allocatedMW;
          actualRoom = Math.max(0, actualRoom - reservedMW);
          const allocatedMW = Math.min(reservedMW, choiceRoom);
          choiceRoom = Math.max(0, choiceRoom - allocatedMW);
          return [b.key, allocatedMW >= b.mw ? b.mw : 0];
        }));
        // 새 설비와 우리 선택의 접속 감소·공사 재시작은 ①. 이웃 단절·접속 증가·공사 완료는 ④.
        const choiceMods = structuredClone(old.mods);
        const oldDisabled = new Set(old.mods.disabledBuilds || []), currentDisabled = new Set(current.mods.disabledBuilds || []);
        let disconnectedMW = 0, restarted = 0;
        for (const key of newBuilds) {
          if (!oldBuilds.has(key)) {
            if (Object.hasOwn(current.mods.reCap, key)) choiceMods.reCap[key] = current.mods.reCap[key];
            else delete choiceMods.reCap[key];
            choiceMods.disabledBuilds = (choiceMods.disabledBuilds || []).filter(k => k !== key);
            if (currentDisabled.has(key)) choiceMods.disabledBuilds.push(key);
          } else {
            if (Object.hasOwn(current.mods.reCap, key) || Object.hasOwn(old.mods.reCap, key)) {
              choiceMods.reCap[key] = Math.min(old.mods.reCap[key] || 0, choiceReCap[key] || 0);
              disconnectedMW += (old.mods.reCap[key] || 0) - choiceMods.reCap[key];
            }
            if (!oldDisabled.has(key) && currentDisabled.has(key)) {
              (choiceMods.disabledBuilds ||= []).push(key); restarted++;
            }
          }
        }
        // ① 계획·접속의 출력제어를 엔진으로 재계산한다. 기술은 지난달에 고정하고 ②에서는 계절만 바꾼다.
        const curtailInput = { ...input, events: [],
          teams: { ...input.teams, [id]: { ...input.teams[id], plan: current.plan, research: { adopted: old.mods.tech || [] } } },
          grid: { ...input.grid, [id]: { ...grid, entries: grid.entries.map(b => ({ ...b, allocatedMW: choiceMods.reCap[b.key] || 0 })) } } };
        const choiceCurtail = season => C.modsFor({ ...curtailInput,
          rounds: C.roundsOf(input).map((rd, i) => i === res.round - 1 ? { ...rd, season } : rd) }, R(), id).curtailP;
        choiceMods.curtailP = choiceCurtail(old.season);
        const choiceWeather = {}, currentWeather = {};
        const choice = sim(current.plan, old.seed, old.season, old.days, choiceMods, choiceWeather);
        const weatherMods = { ...choiceMods, hydroMonth: current.mods.hydroMonth,
          curtailP: choiceCurtail(current.season) };
        const weather = sim(current.plan, current.seed, current.season, current.days, weatherMods, currentWeather);
        const eventMods = { ...weatherMods };
        C.MUL.forEach(k => { eventMods[k] = (old.normalMods[k] ?? 1) * current.eventMods[k]; });
        for (const k of ["demandHours", "tax"]) {
          delete eventMods[k];
          if (Object.hasOwn(current.eventMods, k)) eventMods[k] = current.eventMods[k];
        }
        const event = sim(current.plan, current.seed, current.season, current.days, eventMods);
        // ④ 접속·공사·기술·출력제어를 현재 값으로. 주민·산업·국제 연료는 지난달 값 유지.
        const progressMods = structuredClone(current.mods);
        for (const k of ["demandRes", "demandInd", "fuelMul"]) {
          delete progressMods[k];
          if (Object.hasOwn(old.mods, k)) progressMods[k] = structuredClone(old.mods[k]);
        }
        // SMR 연료 계수는 국제 가격이 아니라 기술 채택에 종속된다.
        if (progressMods.fuelMul) delete progressMods.fuelMul.smr;
        if (current.mods.fuelMul?.smr != null) progressMods.fuelMul = { ...progressMods.fuelMul, smr: current.mods.fuelMul.smr };
        const progress = sim(current.plan, current.seed, current.season, current.days, progressMods);
        // ⑤ 현재 사본의 계통 반영값을 재사용한다. 옛 사본은 한 번 더 계산한다.
        const growth = [current.filledUnsPct, current.gridMWh].every(Number.isFinite) ?
          outageStageValue(current, target, current.days) : sim(current.plan, current.seed, current.season, current.days, current.mods);
        const connected = current.waitingMW > 0 ? sim(current.plan, current.seed, current.season, current.days, { ...current.mods, reCap: current.fullReCap }) : growth;
        const actualGrid = gridFillMWh(res.team[id]), previousGrid = gridFillMWh(previous);
        if (target === "grid" && ![actualGrid, previousGrid].every(Number.isFinite)) throw new Error("outage actual");
        const actual = target === "grid" ? actualGrid / res.days : res.team[id].unsPct;
        const trialValue = target === "grid" ? previousGrid / previousResult.days : previous.unsPct;
        const neighbor = outageNeighborStage(res, id, current.isolatedUnsPct), oldNeighbor = outageNeighborStage(previousResult, id, old.isolatedUnsPct);
        const parts = [{ key: "choice", value: choice - base }, { key: "weather", value: weather - choice },
          { key: "event", value: event - weather }, { key: "progress", value: progress - event }, { key: "growth", value: growth - progress },
          // Σ앞단계 = growth − base. 양쪽 실제 잔차를 빼 Σ몫 = 실제 − 지난달 실제 보장.
          { key: "trade", value: (actual - growth) - (trialValue - base) }];
        const oldFilled = outageStageValue(old, target, old.days);
        const connectedMW = [...oldBuilds].filter(k => newBuilds.has(k)).reduce((sum, k) => sum + Math.max(0, (current.mods.reCap[k] || 0) - (old.mods.reCap[k] || 0)), 0);
        const completed = (old.mods.disabledBuilds || []).filter(k => oldBuilds.has(k) && newBuilds.has(k) && !(current.mods.disabledBuilds || []).includes(k)).length;
        const adopted = (current.mods.tech || []).filter(k => !(old.mods.tech || []).includes(k)).length;
        const eventNames = snapshot => snapshot.facts.eventNames || snapshot.facts.event.split(" / ").map(e => e.split(":")[0]).join("·");
        const changed = ["lines", "policies", "shed", "fab2", "rq"].filter(k => JSON.stringify(old.plan[k]) !== JSON.stringify(current.plan[k]));
        const change = k => old.facts[k] > 0 ? signed((current.facts[k] / old.facts[k] - 1) * 100, 2) + "%" : "이전 값 0: 비율 없음";
        const weatherClue = outageWeatherClue(choiceWeather, currentWeather, old.season, current.season, old.days, current.days, true);
        const clues = {
          choice: `지난달 뒤 설비 ${[...newBuilds].filter(k => !oldBuilds.has(k)).length}개 추가 / ${[...oldBuilds].filter(k => !newBuilds.has(k)).length}개 제거${disconnectedMW > 0 ? ` · 접속 감소 ${fmt(disconnectedMW, 1)} MW` : ""}${restarted ? ` · 공사 재시작 ${restarted}기` : ""}${changed.length ? ` · ${changed.map(k => ({ lines: "전선", policies: "정책", shed: "배분", fab2: "산업 증설", rq: "연구" }[k])).join("·")} 변경` : ""}`,
          weather: weatherClue.short,
          event: `지난달 ${eventNames(old)} → 이번 달 ${eventNames(current)}`,
          progress: `접속 ${signed(connectedMW, 1)} MW${Math.abs(neighborHostMW) > 1e-9 ? ` · 연계선 변화(이웃 단절·새 연계선)로 접속 ${signed(neighborHostMW, 1)} MW` : ""} · 공사 완료 ${completed}기 · 새 기술 ${adopted}개 · 출력제어 ${fmt(weatherMods.curtailP * 100, 2)} → ${fmt(current.mods.curtailP * 100, 2)}%`,
          growth: `운영 당시 주민 ${change("pop")} · 산업 ${change("ind")} · 연료 지수 ${fmt(old.facts.fuel, 3)} → ${fmt(current.facts.fuel, 3)}`,
          trade: `이웃 구매 ${fmt(oldNeighbor.imported * resultPeriod(V, previousResult).mul, 1)} → ${fmt(neighbor.imported * resultPeriod(V, res).mul, 1)} / 판매 ${fmt(previous.exp * resultPeriod(V, previousResult).mul, 1)} → ${fmt(res.team[id].exp * resultPeriod(V, res).mul, 1)} MWh(월 환산)${target === "grid" ? " · 이웃에게 산 만큼 바깥 계통에 덜 기대요" : ""}`
        };
        delete L.outFailures[key];
        return L.outCache[key] = { basis: "monthly", target, ...(target === "grid" ? { unit: "MWh/일" } : {}), base, round: res.round, id, trial: trialValue, actual,
          total: actual - trialValue,
          hasConnectedWind: currentWeather.hasConnectedWind,
          replay: Number.isFinite(oldFilled) ? base - oldFilled : null, replayOutsideSum: true, parts, clues, clueMore: { event: `지난달: ${old.facts.event} / 이번 달: ${current.facts.event}`, weather: weatherClue.full },
          grid: { value: connected - growth, waitingMW: current.waitingMW }, simulations, gridFills, ms: performance.now() - started };
      });
    } catch (e) {
      L.outFailures[key] = { attempts: (failed?.attempts || 0) + 1, render }; return null;
    }
  }
  // 사건 단서: 카드에는 우리 도시 정전(계통 대상이면 계통에 기댄 전기)에 닿는 사건 하나를 두 줄 안으로, 나머지는 '단서 더 보기'에 둔다.
  // 고립 운전의 사건 몫과 같은 modsFor 기준으로 대응 뒤 배수를 읽는다. 연계선 끊김은 거래 몫으로 안내한다.
  const EVENT_KINDS = { solarMul: ["solar", "roof", "tandem", "tandem_roof"], windMul: ["wind"], offshoreMul: ["offshore"], tidalMul: ["tidal"], coalCapMul: ["coal"], lngCapMul: ["lng"] };
  function outageEventClue(events, input, res, id, plan) {
    const hit = events.filter(ev => C.eventDef(R(), ev.id) && C.hits(R(), C.eventDef(R(), ev.id), id, input));
    if (!hit.length) return { short: "우리 도시에 해당하는 사건 없음", full: "" };
    const kinds = new Set(BG.network(BG.sanitize(plan, 1e9)).nodes.map(n => n.kind));
    const normalMods = C.modsFor({ ...input, events: [] }, R(), id);
    const rows = hit.map(ev => {
      const E = C.eventDef(R(), ev.id), f = E.effect || {}, opt = E.opts?.find(o => o.id === input.teams[id].resp?.[`${res.round}:${ev.id}`]);
      const eventMods = C.modsFor({ ...input, events: [ev] }, R(), id);
      const knobs = C.MUL.filter(k => (eventMods[k] ?? 1) !== (normalMods[k] ?? 1));
      const cancelled = opt?.cancel === true || (opt?.dev === 0 && !knobs.length);
      const affects = !cancelled && (knobs.includes("demandMul") || knobs.some(k => (EVENT_KINDS[k] || []).some(t => kinds.has(t))));
      const resp = E.opts?.length ? ` · 대응: ${String(opt?.name || "안 함").replace(/^대응\s*/, "")}` : "";
      const effect = cancelled ? " · 대응으로 효과 없음" : f.tieDown ? " · 연계선 끊김 — 거래 몫에서 봐요" : !affects ? " · 우리 도시 정전에 닿는 효과 없음(해당 설비·수요 효과 없음)" : "";
      const size = (x, nx) => evSize(E, x, nx) || "크기 없음";
      return { affects, text: `${E.name}: 예보 ${size({ id: ev.id, round: ev.round }, input.teams[id]?.fcx?.[ev.id])} → 확정 ${size(ev)}${resp}${effect}` };
    });
    const main = rows.filter(r => r.affects);
    const full = rows.map(r => r.text).join(" / ");
    const short = main.length ? `${main[0].text}${rows.length > 1 ? ` 외 ${rows.length - 1}건` : ""}` : `우리 도시 정전에 닿는 사건 없음(해당 ${rows.length}건)`;
    return { short, full: rows.length > 1 || !main.length ? full : "" };
  }
  function outageWaterfallHTML(a) {
    const monthly = a.basis === "monthly", names = outageNames(a);
    let cursor = a.trial ?? a.base ?? 0;
    const rows = [{ key: monthly ? "previous" : "trial", label: monthly ? "지난달 실제" : "시험", value: a.trial, from: 0, to: cursor }];
    const replay = a.replayOutsideSum ? 0 : a.replay || 0;
    if (outageReplayShown(a, replay)) rows.push({ key: "replay", label: monthly ? "재현 차이" : "시험 재현 차이", value: replay, from: cursor, to: cursor + replay });
    cursor += replay;
    a.parts.forEach(p => { const from = cursor; cursor += p.value; rows.push({ ...p, label: names[p.key], from, to: cursor }); });
    rows.push({ key: "actual", label: monthly ? "이번 달 실제" : "실제", value: a.actual, from: 0, to: a.actual });
    const low = Math.min(0, ...rows.flatMap(p => [p.from, p.to])), high = Math.max(1e-9, ...rows.flatMap(p => [p.from, p.to]));
    const rowText = p => p.key === "trial" && a.target === "grid" && a.trial == null ? "기록에 계통 값 없음" :
      outageValue(p.value, outageUnit(a, ["trial", "previous", "actual"].includes(p.key)), !["trial", "previous", "actual"].includes(p.key));
    const summary = rows.map(p => `${p.label} ${rowText(p)}`).join(", ");
    return `<div id="lg-outage-waterfall" class="lg-out-wf" role="img" aria-label="${esc(summary)}">${rows.map(p => `<div class="lg-out-row" data-out-step="${p.key}" data-out-value="${p.value}"><span>${esc(p.label)}</span><span class="lg-out-track"><i class="lg-out-bar" data-negative="${p.value < 0}" style="left:${100 * (Math.min(p.from, p.to) - low) / (high - low)}%;width:${100 * Math.abs(p.to - p.from) / (high - low)}%"></i></span><b>${esc(rowText(p))}</b></div>`).join("")}</div>`;
  }
  function outageEvidenceLinks(n, a) {
    const links = { ...OUTAGE_EVIDENCE_LINKS[n.evidence?.key] };
    // 예전 저장 결과처럼 접속을 확인할 수 없을 때도 풍속만으로 직접 효과를 인정하지 않는다.
    if (n.evidence?.key === "wind" && !a.hasConnectedWind) {
      links.weather = "indirect"; links.event = "indirect";
    }
    return links;
  }
  function outageEvidenceSummary(n, a) {
    const links = outageEvidenceLinks(n, a), names = outageNames(a);
    if (!n.evidence?.text) return "고른 근거 없음";
    // 거의 0인 몫은 '외 n개'에 세지 않는다. 요약만 읽어도 근거의 효과로 오해하지 않게 '직접 연결 몫'이라고 밝힌다.
    const direct = a.parts.filter(p => links[p.key] === "direct")
      .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    const evidence = `고른 근거 ‘${n.evidence.text}’`;
    if (!direct.length) return `${evidence}만의 효과는 따로 계산하지 않음`;
    const counted = direct.filter(p => Math.abs(p.value) >= outageCardMin(a));
    if (!counted.length) return `${evidence} · 직접 연결 몫은 거의 0`;
    const largest = counted[0];
    return `${evidence} · 직접 연결 몫 ${names[largest.key]} ${outageValue(largest.value, outageUnit(a), true)}${counted.length > 1 ? ` 외 ${counted.length - 1}개` : ""}`;
  }
  function outageEvidenceText(n, a, largest) {
    const monthly = a.basis === "monthly", names = outageNames(a);
    const links = outageEvidenceLinks(n, a);
    const linked = a.parts.filter(p => links[p.key]);
    let text;
    if (linked.length) text = `고른 근거 ‘${n.evidence.text}’와 관련된 몫: ${["direct", "stage", "indirect"].map(kind => {
      const parts = linked.filter(p => links[p.key] === kind);
      return parts.length ? `${kind === "stage" ? "같은 단계와 연결" : `${kind === "direct" ? "직접" : "간접"} 연결`} — ${parts.map(p => `${names[p.key]} ${outageValue(p.value, outageUnit(a), true)}`).join(" / ")}` : "";
    }).filter(Boolean).join("; ")}. ${linked.every(p => Math.abs(p.value) < outageCardMin(a)) ? "이 몫들은 이번 차이에 거의 기여하지 않았어요. " : ""}근거 하나만의 인과 효과는 아니에요.${linked.some(p => links[p.key] === "indirect") ? ` 간접 연결은 이 근거가 ${a.target === "grid" ? "바깥 계통에 기댄 전기를" : "정전을"} 바꿨다는 뜻이 아니에요.` : ""}`;
    else text = `고른 근거 ‘${n.evidence?.text || "미선택"}’만의 ${a.target === "grid" ? "계통 의존 효과" : "정전 효과"}는 따로 계산하지 않았어요. ${a.parts.map(p => names[p.key]).join(" / ")}가 함께 작용해요.`;
    // S6과 같은 방향 규칙. 접속 여유는 새 접속 처리 전 값이므로 진행 몫과 방향을 비교하지 않는다.
    // 월간 분해만 전달→이번 달 근거 변화와 비교한다. 시험 기준은 연결만 안내한다.
    // 예측 판정과 같은 기기 메모·변화 눈금을 사용한다.
    const key = n.evidence?.key, previous = tdata().interview?.months?.[a.round - 1];
    const { value: evidenceValue, before: oldValue } = evidenceComparisonValues(n, previous);
    const change = evidenceValue - oldValue, effectSign = evidenceEffect(key, { topic: a.target === "grid" ? "grid" : "uns", hasConnectedWind: a.hasConnectedWind }).sign;
    const threshold = Math.max(Math.abs(oldValue) * EVIDENCE_STEP[key], key === "neighbor" ? EVIDENCE_STEP.neighborFloor : EVIDENCE_STEP.floor);
    const evidenceSign = monthly && Number.isFinite(oldValue) && Number.isFinite(evidenceValue) && effectSign && Math.abs(change) >= threshold ? Math.sign(change * effectSign) : 0;
    const { ranked, tied } = outagePartRanking(a), leaders = ranked.filter(p => tied.includes(p.key));
    const mixedSigns = new Set(leaders.map(p => Math.sign(p.value))).size > 1;
    // 동점은 정렬 첫 몫 대신 직접 연결된 몫을 본다. 부호가 섞이면 반대 방향으로 단정하지 않는다.
    largest = leaders.find(p => links[p.key] === "direct" && Math.sign(p.value) === evidenceSign) ||
      leaders.find(p => links[p.key] === "direct") || largest;
    const sameDirection = largest && evidenceSign && Math.sign(largest.value) === evidenceSign;
    if (largest && links[largest.key] === "direct" && evidenceSign && !sameDirection && !mixedSigns) return `${text} 고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요. 이 근거만으로 이번 차이의 방향을 설명하기는 어려워요.`;
    if (largest && links[largest.key] === "direct" && mixedSigns && evidenceSign && !sameDirection) return `${text} 크기가 같은 가장 큰 몫들의 방향이 서로 달라, 이 근거로 방향을 판정하지 않아요.`;
    if (largest && links[largest.key] === "direct" && !evidenceSign) return `${text} 고른 근거가 가장 큰 몫(${names[largest.key]})과 같은 이야기예요.`;
    const next = { choice: "시험 뒤 설비·전선·정책 변경", weather: "시험과 실제의 날씨·재생 발전량", event: "사건 예보 범위와 우리 대응", trade: "이웃 정전과 구매·판매", gridImport: "바깥 계통의 수입 상한과 남은 부족", progress: "접속 할당·공사 완료·새 기술", growth: "주민·산업 수요 변화와 운영 당시 연료 지수" };
    if (monthly) { next.choice = "지난달과 이번 달의 설비·전선·정책 변경"; next.weather = "지난달과 이번 달의 날씨·계절·운전 기간"; }
    return largest ? links[largest.key] === "direct" && sameDirection ? `${text} 고른 근거는 이번 차이의 가장 큰 몫과도 이어져요.` : `${text} 다음에는 ${next[largest.key]}도 근거로 살펴봐요.` : `${text} 이번 달은 ${outageNoCauseLabel(a)}으로 기록해요.`;
  }
  // 사건 단서는 사본(지난달·이번 달 공용)에 대상과 무관하게 저장된다. 계통 대상이면 그릴 때 대상 이름으로 바꾼다.
  // 사본 → 원본. 저장하는 고정본에 속성을 더하지 않으려고 따로 둔다.
  const OUTAGE_CLUE_SOURCE = new WeakMap();
  const OUTAGE_CLUE_UNS = "우리 도시 정전에 닿는", OUTAGE_CLUE_GRID = "우리 도시가 바깥 계통에 기댄 전기에 닿는";
  function outageTargetClues(a) {
    if (a?.target !== "grid") return a;
    const swap = o => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.replaceAll(OUTAGE_CLUE_UNS, OUTAGE_CLUE_GRID) : v]));
    const copy = { ...a, clues: swap(a.clues), clueMore: swap(a.clueMore) };
    OUTAGE_CLUE_SOURCE.set(copy, a);
    return copy;
  }
  function outageCardsHTML(V, res, id, n) {
    const a = outageTargetClues(outageAttribution(V, res, id, n));
    const comparison = V.econ && n.evidence && n.pred && !n.skipped ? promiseComparison(V, n) : null;
    const same = comparison?.actual === "same"
      ? `<p id="lg-outage-same">실제로는 ${comparison.topic === "grid" ? "바깥 계통에 기댄 전기가" : "정전이"} ${esc(withParticle(comparison.comparison.label.replace(/ 대비$/, ""), "과와"))} 거의 같았어요(판정: 같음).</p>` : "";
    const monthly = a ? a.basis === "monthly" : !!V.econ && res.round > 1, names = outageNames(a || { basis: monthly ? "monthly" : "trial" });
    const comparisonNote = monthly ? '<p id="lg-outage-baseline" class="lg-hint">약속 판정과 같은 기준(지난달 실제 → 이번 달 실제)을 나눠요.</p>' :
      V.econ && res.round > 1 ? '<p id="lg-outage-baseline" class="lg-hint">약속 판정은 지난달 대비, 아래 나누기는 시험 대비예요.</p>' : "";
    const trial = !a && !monthly && matchingTrial(V, res, id);
    const failed = L.outFailures?.[monthly ? monthlyOutageKey(res, id) : outageCacheKey(res, id, trial, n?.trial)] ||
      (monthly && L.outFailures?.[`snapshot:${id}:${res.round}`]);
    const old = monthly && s7data().outageSnapshots?.[res.round - 1];
    const missing = monthly && (!validOutageSnapshot(old, res.round - 1) ||
      V.results.find(r => r.round === res.round - 1)?.team[id]?.unsPct !== old.unsPct);
    const unavailable = missing ? "지난달 운영 조건이 이 기기에 없어 나누지 못해요." :
      (monthly || trial) ? failed?.attempts === 1 ? "원인을 계산하지 못했어요. 다음 결과 그리기에서 한 번 더 시도해요." : "이번 달은 원인 나누기를 표시하지 않아요." :
      "같은 방·도시·월의 시험 기록이 없어요. 계산에 필요한 당시 자료가 있어야 원인 몫을 나눌 수 있어요.";
    if (!a) return `<div id="lg-missed"><h4>무엇을 놓쳤나</h4>${same}${missing ? "" : comparisonNote}<p class="lg-hint">${unavailable}</p>${monthly ? "" : Object.entries(MISS_NAMES).filter(([key]) => !["growth", "progress", "gridImport"].includes(key)).map(([key, label]) => `<button type="button" class="v2-btn" data-missed="${key}" aria-pressed="${n.missed === key}">${label}</button>`).join("")}${!monthly && n.missed ? y2022LinkHTML("lg-y2022-result", V.phase !== "end") : ""}</div>`;
    // 옛 고정본에서 고른 작은 몫도 카드와 꼬리표를 보존한다. 고정된 분해 값은 바꾸지 않는다.
    const { selected, frozenPicked, largest, tied, single, opened } = outageCardState(a, n);
    const unit = outageUnit(a), part = x => outageValue(x, unit, true), level = x => outageValue(x, outageUnit(a, true));
    const min = outageCardMin(a), minText = outageLimitText(min, unit);
    const subject = a.target === "grid" ? "바깥 계통에 기댄 전기" : "정전";
    const top = outageCardCandidates(a.parts, a);
    if (frozenPicked && !top.includes(selected)) {
      if (top.length === params("outageCardCount")) top.pop();
      top.push(selected);
    }
    const cards = a.parts.filter(p => top.includes(p));
    const others = single ? a.parts : a.parts.filter(p => !cards.includes(p));
    // HTML 생성만으로 기록하지 않고, DOM에 실제로 표시된 뒤 저장한다.
    if (opened) L.outShownPending = { round: res.round, single, largest: largest ? { ...largest } : null, frozen: a };
    const gridSize = outageGridVisible(a);
    const causeCount = a.parts.length === 4 ? "네" : a.parts.length === 6 ? "여섯" : `${a.parts.length}개`;
    const difference = a.trial == null ? null : a.actual - a.trial, smallDifference = Number.isFinite(difference) && Math.abs(difference) < min;
    const partsSum = a.parts.reduce((sum, p) => sum + p.value, 0);
    // 월간 합계 밖 재현 진단은 실제 차이를 설명하는 몫으로 읽지 않는다.
    const replayDominates = !a.replayOutsideSum && !smallDifference && Math.sign(a.replay) === Math.sign(difference) &&
      Math.abs(a.replay) > Math.abs(difference) / 2 && Math.abs(partsSum) < Math.abs(difference) / 2;
    const noCauseDetail = replayDominates ?
      `차이의 대부분은 재현 차이(저장된 ${monthly ? "지난달 사본" : "시험"}과 같은 조건 재계산의 차이)예요 — 원인 후보로 나눌 수 없어요` :
      `${causeCount} 원인의 몫이 모두 ${minText} 이하라, 바뀐 조건 하나하나는 ${subject}${a.target === "grid" ? "를" : "을"} 거의 바꾸지 않았어요`;
    const highOutageHint = a.target !== "grid" && outageHigh(a.actual) ? `. 정전 자체는 커요: ${outageHigh(a.trial) ? `${monthly ? "지난달" : "시험"}에도 정전이 컸으니 ` : ""}${smallDifference ? "이번 달 변화보다 " : ""}지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요` : "";
    const noCauseSummary = `${monthly ? "지난달" : "시험"} ${a.trial == null ? "기록에 계통 값이 없어 시험 대비 차이는 표시하지 않아요. 실제" : esc(level(a.trial))}${a.trial == null ? "" : ` → ${monthly ? "이번 달" : "실제"}`} ${esc(level(a.actual))}${a.trial == null ? "예요" : smallDifference ? "로 거의 같아요" : "의 차이를 나눠 보는 카드예요"}. ${noCauseDetail}${highOutageHint}`;
    const singleText = !largest ? noCauseSummary : `이번 차이의 가장 큰 몫은 ${esc(names[largest.key])}(${esc(part(largest.value) + outageCost(largest.value, a, true))})${withParticle(names[largest.key], "이에요").slice(names[largest.key].length)}. ${causeCount} 원인 중 나머지 몫은 모두 ${minText} 이하라 원인 고르기를 건너뛰어요`;
    // 합계 밖의 지속 병목: 카드 정답과 무관하므로 열기 전에도 같은 위치에 표시한다.
    const gridBox = gridSize ? `<aside id="lg-outage-grid-bottleneck" aria-label="접속 대기 병목"><strong>접속 대기 ${esc(fmt(a.grid.waitingMW, 1))} MW: 대기가 없었다면 ${subject} <b data-out-grid="${a.grid.value}">${esc(part(a.grid.value))}</b></strong><p>이번 차이와 별개로 계속 있는 몫이에요(분해 합계 밖).</p>${infoTip("outage-grid-method", `<p id="lg-outage-grid">${a.target ? "이번 실제 조건에서 계통 보충을 반영하고" : "이번 실제 조건의 고립 운전에서"} 대기 설비를 모두 연결해 비교했어요.</p>`, { label: "접속 대기" })}</aside>` :
      a.grid?.waitingMW > 0 && Number.isFinite(a.grid.value) ? `<p id="lg-outage-grid-small" class="lg-hint">접속 대기 ${esc(fmt(a.grid.waitingMW, 1))} MW(효과 ${outageLimitText(outageMinPart(a), unit)} 이하)</p>` : "";
    const othersHTML = `<p id="lg-outage-others" class="lg-hint">${single ? "원인 단서" : "카드에 없는 후보"}: ${others.map(p => `${esc(names[p.key])}(${esc(a.clues[p.key])})${opened ? ` <b data-out-other="${p.key}" data-out-value="${p.value}">${esc(part(p.value))}</b>` : ""}`).join(" · ")}</p>`;
    // 좁은 서랍에서 카드 단서는 두 줄로 줄여 보이므로, 전체 단서는 접어 둔다(숫자 %p 없음).
    const more = single ? [] : cards.map(p => [p.key, a.clueMore?.[p.key] || a.clues[p.key]]);
    for (const key of ["event", "weather"]) if (a.clueMore?.[key] && !more.some(([k]) => k === key)) more.push([key, a.clueMore[key]]);
    const moreHTML = more.length ? `<details id="lg-outage-more" class="lg-hint"><summary>단서 더 보기</summary><ul>${more.map(([key, text]) => `<li><b>${esc(names[key])}</b>: ${esc(text)}</li>`).join("")}</ul></details>` : "";
    return `<section id="lg-missed" class="lg-outage" data-ms="${a.ms}" data-simulations="${a.simulations}" data-grid-fills="${a.gridFills ?? 0}" data-opened="${opened}" data-single="${single}"><div class="lg-info-line"><h4>${subject} 변화의 원인 하나</h4>${same}${infoTip("outage-order", "각 단계에서 조건 하나를 바꿔 앞 단계와의 차이를 그 조건의 몫으로 계산해요.", { label: "계산 순서" })}</div>${a.target === "uns" && n.topic === "grid" ? '<p class="lg-hint">이번 달은 실제 정전이 생겨 원인은 정전으로 나눠요.</p>' : a.target === "grid" && n.topic === "uns" ? '<p class="lg-hint">이번 달은 비교하는 두 결과 모두 정전이 없어 원인은 바깥 계통에 기댄 전기로 나눠요.</p>' : ""}${a.target === "grid" && a.trial == null ? '<p class="lg-hint">시험 기록에 계통 값 없음</p>' : ""}${comparisonNote}${gridBox}
      ${single ? `<p id="lg-outage-single">${singleText}.</p>` : `<p class="lg-hint">${monthly ? "지난달 실제 → 이번 달 실제" : "시험 → 실제"} ${esc(part(a.total))}. 후보 ${cards.length === 1 ? "한" : cards.length === 2 ? "두" : "세"} 개의 단서만 보고 하나를 골라요.</p><div id="lg-outage-cards" class="lg-out-cards" role="group" aria-label="원인 카드">${cards.map(p => `<button type="button" class="lg-out-card" data-missed="${p.key}" aria-pressed="${n.missed === p.key}" ${opened ? "disabled" : ""}${opened ? ` data-out-value="${p.value}"` : ""}><strong>${esc(names[p.key])}</strong><span class="lg-out-clue">${esc(a.clues[p.key])}</span><b class="lg-out-size">${opened ? `${esc(part(p.value))}` : "?"}</b>${opened ? `<span class="lg-out-tags">${n.missed === p.key ? '<span data-out-tag="picked">내가 고름</span>' : ""}${tied.includes(p.key) ? `<span data-out-tag="largest">${tied.length > 1 ? "공동 가장 큼" : "가장 큼"}</span>` : ""}</span>` : ""}</button>`).join("")}</div>`}
      ${!opened ? `${single ? othersHTML : tipBox("outage-others", "카드에 없는 후보", othersHTML)}${moreHTML}<button type="button" class="v2-btn primary" id="lg-outage-open" ${cards.some(p => p.key === n.missed) ? "" : "disabled"}>이 카드로 정하고 열기</button>` : `${outageWaterfallHTML(a)}${single ? othersHTML : `<details id="lg-outage-others-fold" class="lg-out-fold lg-hint"><summary>나머지 원인 ${others.length}개</summary>${othersHTML}</details>`}${moreHTML}${outageReplayShown(a, a.replay) ? `<div class="lg-info-line"><p id="lg-outage-replay" class="lg-hint">${monthly ? "재현 차이" : "시험 재현 차이"} ${esc(part(a.replay))}</p>${infoTip("outage-replay", monthly ? `지난달 사본의 ${a.target === "grid" ? "계통 보충량" : a.target ? "계통 반영 정전율" : "고립 정전율"}과 같은 조건 재계산의 차이예요. ${a.replayOutsideSum ? "분해 합계 밖 진단이며 원인 후보에는 넣지 않아요." : "원인 후보에는 넣지 않아요."}` : "저장된 시험과 재계산의 차이예요. 시험 뒤 뺀 설비의 접속 할당 등 당시 접속·기술 조건을 완전히 되살리지 못해 생길 수 있어요. 원인 후보에는 넣지 않아요.", { label: "재계산과의 차이" })}</div>` : ""}<div id="lg-outage-verdict" tabindex="-1" aria-live="polite"><p>내가 고른 것: ${single ? "고르기 생략" : `${esc(names[n.missed] || "미선택")} ${selected ? esc(part(selected.value)) : ""}${selected ? tied.includes(selected.key) ? tied.length > 1 ? " · 크기가 같은 가장 큰 몫 중 하나예요" : " · 가장 큰 몫과 같아요" : Math.abs(selected.value) < min ? " · 이번 차이에 거의 기여하지 않았어요" : " · 몫은 있지만 가장 크지 않았어요" : ""}`}</p><p>${largest ? tied.length > 1 ? `가장 큰 것(크기 같음 ${tied.length}개): ${tied.map(k => `${esc(names[k])} ${esc(part(a.parts.find(p => p.key === k).value) + outageCost(a.parts.find(p => p.key === k).value, a))}`).join(" · ")}` : `가장 큰 것: ${esc(names[largest.key])} ${esc(part(largest.value) + outageCost(largest.value, a))} · ${esc(a.clues[largest.key])}` : esc(outageNoCauseLabel(a))}</p><details id="lg-outage-evidence" class="lg-out-fold lg-hint"><summary><span>내 예측이 놓친 것 · ${esc(outageEvidenceSummary(n, a))}</span></summary><p>내 예측이 놓친 것: ${esc(outageEvidenceText(n, a, largest))}</p>${evidenceNowHTML(n, "s7")}</details></div><button type="button" class="v2-btn" id="lg-outage-carry" ${n.missedCarry ? "disabled" : ""}>${n.missedCarry ? "다음 달 약속 카드에 붙였어요" : "다음 달 약속 카드에 붙이기"}</button><small class="lg-hint">기기에만 저장</small>${y2022LinkHTML("lg-y2022-result", V.phase !== "end")}`}
      <p id="lg-outage-order" class="lg-hint">이번 달 계산 순서: ${esc(a.parts.map(p => names[p.key]).join(" → "))}. 순서를 바꾸면 몫이 달라질 수 있는 추정이에요. 게임에서 정한 순서예요.</p></section>`;
  }
  function co2AttributionHTML(V, res, id) {
    const a = co2Attribution(V, res, id);
    return `<p id="lg-co2-attribution">CO₂ 변화: ${a ? `선택 몫 ${esc(signed(a.choice, 1))} t(추정) · 계절·수요 몫 ${esc(signed(a.seasonalDemand, 1))} t(추정) · 월 일수 몫 ${esc(signed(a.calendar, 1))} t` : "지난달 또는 당시 계획 자료가 없어 몫을 계산할 수 없어요."}</p>${a ? `<p class="lg-hint">같은 이번 달 계획·접속·기술·날씨 조건으로 지난달과 이번 달 계절·주민/산업 수요 배수만 바꿔 비교했어요. 나머지를 선택 몫으로 추정했으므로 사건·이웃 거래·날씨 차이도 포함해요. 선택만의 인과 효과는 아닙니다.</p>` : ""}`;
  }
  function coopHTML(V, res, id) {
    const rep = resultReport(V, res), region = rep?.region;
    if (!region) return `<section id="lg-coop" class="lg-sec"><h4>지역 공동성과</h4><p class="lg-hint">공동목표 보고서가 없어요.</p></section>`;
    const bonus = V.econ?.score?.by[id]?.coop;
    return `<section id="lg-coop" class="lg-sec"><h4>1. 지역 공동성과</h4><p class="lg-goals"><span data-ok="${region.met.uns}">정전 ${esc(fmt(region.unsPct, 2))}% / 목표 ≤ ${esc(fmt(region.goal.uns, 2))}%</span><span data-ok="${region.met.co2}">CO₂ ${esc(fmt(region.co2))} t / 목표 ≤ ${esc(fmt(region.goal.co2))} t</span></p><p id="lg-coop-bonus">공동 보너스 +${esc(fmt(bonus, 1))}점 · 두 목표 달성 시 +${esc(fmt(params("coopBonus"), 1))}점(이번 달만, 누적하지 않음)</p>
      <h4>2. 도시별 기여</h4><ul class="lg-contrib">${actT(V).map(t => { const c = rep.contrib?.[t.id]; return `<li data-contrib="${esc(t.id)}"><b>${esc(t.name)}</b> ${c ? `판매 ${esc(fmt(c.exportMWh, 1))} / 구매 ${esc(fmt(c.importMWh, 1))} MWh · 공급한 전기 기준 감축(소비 배출, 추정): ${(c.servedMWh ?? (res.team[t.id] ? Math.max(0, res.team[t.id].dem - res.team[t.id].uns) * resultPeriod(V, res).mul : undefined)) === 0 ? "공급 없음" : gridOnlyServed(V, res.team[t.id]) ? "바깥 계통 공급만(자체·이웃 공급 없음)" : `${esc(signed(c.co2Cut, 1))} t`} · 연계선 분담 ${esc(fmt(c.tieCost, 1))}억` : "자료 없음"}</li>`; }).join("")}</ul><p class="lg-hint">실제 공급량 × 보통 배출계수 − 소비 기준 배출(수입분 포함, 판매분 제외). 정전으로 줄어든 배출은 감축에 넣지 않음. 음수는 초과 배출. 연계선 분담은 누적 투자예요.</p>
      <h4>3. 도시 자체 성과</h4><p>${esc(teamName(id))}: 정전 ${esc(fmt(res.team[id].unsPct, 2))}% · CO₂ ${esc(fmt(res.team[id].co2Prod * resultPeriod(V, res).mul))} t · 도시 점수 ${esc(fmt(V.econ?.score?.by[id]?.score, 1))}점(공동 보너스 포함)</p></section>`;
  }
  function migrationBenefitHTML(V, res, id) {
    const rep = resultReport(V, res), net = rep?.net?.[id], city = V.econ.cities[id];
    if (!net) return `<p id="lg-migration-benefit">이주 편익·부담: 보고된 이동 자료가 없어요.</p>`;
    const inflow = (rep.flows?.pop || []).filter(f => f.to === id).reduce((sum, f) => sum + f.n, 0);
    const policy = city.policy || {};
    const tax = inflow * params("resTax") * (1 + params("taxStep") * (policy.taxRes || 0));
    const service = inflow * params("svcCost") * (1 + params("svcStep") * (policy.service || 0));
    const demand = city.pop > 0 ? inflow / city.pop * 100 : null;
    return `<p id="lg-migration-benefit">이주 유입 ${esc(fmt(inflow))}명(순이동 ${esc(signed(net.pop))}명): 편익은 주민세 +${esc(fmt(tax, 2))}억/달, 부담은 주민 수요 +${esc(fmt(demand, 2))}%·서비스 +${esc(fmt(service, 2))}억/달(다음 운영, 정책 유지 가정·추정).</p>`;
  }
  function outageDamageHTML(V, res, id) {
    const r = res.team[id], share = r.residentDemandShare, scale = C.regionOf(V.region).mwScale;
    // H04: 공개된 대표 기간 미공급량을 월로 환산. 기기 안 표시뿐이며 현금·공개 상태를 바꾸지 않는다.
    if (![r.uns, share, scale].every(Number.isFinite) || share < 0 || share > 1) return '<p id="lg-outage-damage">정전 피해 추정: 자료 없음(미공급량·수요 몫 필요)</p>';
    if (r.uns <= 0) return '<p id="lg-outage-damage">정전 피해 추정: 이번 달 미공급 없음</p>';
    const kwh = Math.max(0, r.uns) * resultPeriod(V, res).mul * scale * params("mwhToKwh");
    const range = params("outageIndustryUsd").map(usd => kwh * (share * params("outageHomeWon") + (1 - share) * usd * params("outageFx")) / params("wonPerEok"));
    return `<p id="lg-outage-damage">정전 피해 추정 ${range.map(v => esc(fmt(v, v >= 10 ? 0 : 1))).join("~")}억 원(실제 돈, 현금에는 안 들어감, 추정) · 주거 몫 ${esc(fmt(share * 100, 1))}%·산업 몫 ${esc(fmt((1 - share) * 100, 1))}% · 가구 대상 지불의사 설문 Jin(2025)·제조업 조사 Jin 외(2024)(${esc(gradeWords("P"))})</p>${infoTip("outage-damage-method", `비산업 수요를 주거로, 미공급을 수요 비례로 근사(${esc(gradeWords("M"))}) · 문헌 환율·단위 환산(${esc(gradeWords("M"))}), 지도 축척(${esc(gradeWords("G"))})`, { label: "정전 피해 추정" })}`;
  }
  // D-82 결정 1: 하루 평균과 그 변화를 먼저 표시. 반올림해 0인 0.05 MWh/일 미만은 숨긴다.
  function gridFillHTML(V, res, id) {
    const grid = promiseGridReliance(V, res, id, id === L.team ? tdata().interview?.months?.[res.round] : null), perDay = grid.perDay;
    if (!(perDay >= GRID_DISPLAY_MIN_PER_DAY)) return "";
    return `<div data-grid-fill><dt>계통이 메운 전기</dt><dd>${esc(fmt(perDay, 1))} MWh/일</dd><dd class="lg-result-note"><small>${esc(grid.base.label)}${grid.deltaPerDay == null ? "" : ` 하루 평균 Δ ${esc(signed(grid.deltaPerDay, 1))} MWh/일`} · 이번 달 합 ${esc(fmt(grid.mwh, 1))} MWh · 비용 약 ${esc(fmt(grid.cost, 2))}억</small>${infoTip("result-grid-assumption", `상한·할증은 ${esc(gradeWords("G"))}`, { label: "계통이 메운 전기" })}</dd></div>`;
  }
  // 결과 서랍의 월 환산 지표와 계통 기준 대비 변화를 함께 표시한다.
  function resultHTML(V, res) {
    const id = L.team, r = res.team[id], rep = resultReport(V, res), { days, mul } = resultPeriod(V, res);
    const previous = V.results.find(x => x.round === res.round - 1), p = previous?.team[id];
    const pm = previous ? resultPeriod(V, previous).mul : 1;
    const n = tdata().interview?.months?.[res.round] || {};
    // 지난 결과는 그 달에 저장한 약속 주제를 따른다(plan 단계의 promiseTopic은 현재 달 조건으로 다시 계산하므로).
    const gridTopic = (res.round === V.round ? promiseTopic(V, n) : n.topic) === "grid";
    const comparison = outageBaseline(V, res, n);
    // 계통 주제는 소비 CO₂ 줄과 같은 하루 평균 정밀도로 읽고, 월 길이에 따른 합계는 보조로 둔다.
    const deltas = [["정전(이번 달)", r.unsPct, comparison.value, "%", "%p", comparison.label, 2],
      ["정전 시간(이번 달)", r.outH * mul, p ? p.outH * pm : undefined, "시간", "시간", "지난달 대비", 1],
      gridTopic ? ["CO₂(이번 달 운영)", r.co2Prod * mul / days, p ? p.co2Prod * pm / resultPeriod(V, previous).days : undefined, " t/일", " t/일", "지난달 대비", 1, `이번 달 합 ${fmt(r.co2Prod * mul)} t`]
        : ["CO₂(이번 달 운영)", r.co2Prod * mul, p ? p.co2Prod * pm : undefined, "t", "t", "지난달 대비", 0]];
    const ledger = r.ledger;
    const complaintsNow = withCityPack(id, () => BG.complaints(BG.sanitize(L.doc?.maps[L.doc.map] || V.teams[id].plan || {}, 1e9), null).issues);
    return `<section id="lg-result" class="lg-sec"><h3 id="lg-result-heading">${esc(resultHeading(V, res))}</h3><div class="lg-info-line"><p class="lg-hint">운영 기간·정전 시간</p>${infoTip("result-period", `<p class="lg-hint">${esc(teamName(id))} · ${esc(res.year)}년 · 대표 ${esc(res.days)}일 × ${esc(fmt(mul, 3))} → 월 ${esc(days)}일 · CO₂는 생산 기준</p><p id="lg-result-outage-def" class="lg-hint">${esc(outageHoursDef(days))}</p>`, { label: "운영 기간·정전 시간" })}</div>
      <dl id="lg-result-deltas" class="lg-result-deltas">${deltas.map(([label, value, prev, unit, du, basis, precision, total = ""]) => `<div><dt>${esc(label)}</dt><dd>${esc(fmt(value, precision))}${unit}</dd><small>${esc(basis)} Δ ${Number.isFinite(prev) ? `${esc(signed(value - prev, precision))}${du}` : basis.startsWith("시험 ") ? "비교 없음(시험 기록 없음)" : "비교 없음(첫 결과)"}${total ? Number.isFinite(prev) ? `(${esc(total)})` : ` · ${esc(total)}` : ""}</small></div>`).join("")}${gridFillHTML(V, res, id)}</dl>
      ${outageDamageHTML(V, res, id)}
      ${Number.isFinite(rep?.cities?.[id]?.bioCo2) && rep.cities[id].bioCo2 > 0 ? `<p id="lg-result-bio-co2">${esc(bioCo2Text(rep.cities[id].bioCo2))}</p>` : ""}
      <p id="lg-result-causes">가장 큰 변화 원인(${esc(gradeWords(rep?.groups?.[id]?.whyGrade))}): ${esc(whyText(rep?.groups?.[id]) || "표시할 만큼 큰 변화 없음")}</p><details id="lg-result-reasons"><summary>무엇 때문에 달라졌나요</summary>${causeHTML(V)}
      </details><details id="lg-result-details"><summary>자세히 · 장부와 거래</summary>${trialCompareHTML(V, res, id)}<p id="lg-site-impact">자리 탓: 송전 손실 ${esc(fmt(r.loss * mul, 1))} MWh · 선 없는 설비 출력 ${esc(fmt(r.idle * mul, 1))} MWh · 접속 대기 ${esc(fmt(r.grid?.waitingMW, 1))} MW</p>
      <p id="lg-result-ledger">장부(억): ${ledger ? `달 초 ${esc(fmt(ledger.open, 2))} + 수입 ${esc(fmt(ledger.income, 2))} − 신규 투자 ${esc(fmt(ledger.invest, 2))} − 운영비 ${esc(fmt(ledger.opex, 2))} = 달 말 ${esc(fmt(ledger.close, 2))} · 이번 ${V.econ ? "달" : "턴"} 총지출 ${esc(fmt(ledger.invest + ledger.opex, 2))}` : "자료 없음"}</p><p class="lg-hint">억 = 게임 단위 · 장부는 이미 월 기준이에요.</p>
      ${rep?.fiscal?.[id]?.rev?.facility > 0 ? `<p id="lg-result-facility">지역자원시설세 ${esc(fmt(rep.fiscal[id].rev.facility, 3))}억(게임 단위, 세입에 포함) · 지방세법 제146조·지방재정법 제29조, 2026년 세율(${esc(gradeWords("O"))}) · 징수교부금 차감 전·돈 환산(${esc(gradeWords("M"))}), 지도 축척(${esc(gradeWords("G"))})</p>` : ""}
      ${co2AttributionHTML(V, res, id)}${coopHTML(V, res, id)}${migrationBenefitHTML(V, res, id)}
      <p>병원 정전 ${esc(fmt(r.hospH * mul, 1))}시간 · CO₂ 소비 기준 ${esc(fmt(r.co2Cons * mul))} t · 민원(지금 지도 기준) ${esc(fmt(complaintsNow))}건 · 운영 당시 ${esc(fmt(r.cp))}건</p>
      ${curtailHTML(V, res, id)}${res.events?.length ? `<div class="lg-evres">${evCards(V, res.round, id)}</div>` : ""}
      ${res.tieDown ? `<p class="lg-warn">고장 난 연계선: ${res.tieDown.split("~").map(teamName).map(esc).join("–")}</p>` : ""}
      ${r.unlinked?.length ? `<p class="lg-warn">연결점까지 선이 없어 거래 못 함: ${r.unlinked.map(teamName).map(esc).join(", ")}</p>` : ""}</details></section>`;
  }

  /* ---------- 라운드 사건 카드 ---------- */
  const SCOPE = { region: "지역 전체", "kind:coastal": "바다에 닿은 도시", "kind:industrial": "대형 공장이 있는 도시", "kind:coal": "석탄 발전소가 있는 도시", "kind:metro_south": R().scopeLabels?.metro_south || R().teams.filter(t => C.hits(R(), { scope: "kind:metro_south" }, t.id)).map(t => t.name).join(" · "), "kind:chungcheong": R().scopeLabels?.chungcheong || R().teams.filter(t => C.hits(R(), { scope: "kind:chungcheong" }, t.id)).map(t => t.name).join(" · "), "kind:inland": "내륙 도시" };
  // 예보 범위(계획 때)와 실제 크기(운영 뒤). 배수 손잡이마다 "수요 +6~18%".
  const KNOB = { demandMul: "수요", solarMul: "태양광", windMul: "육상풍력", offshoreMul: "해상풍력", tidalMul: "조력", coalCapMul: "석탄 출력", lngCapMul: "LNG 출력" };
  const pct = v => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;
  function evSize(E, ev, nx) {
    const f = E.effect || {}, fc = E.fc || 0;
    return C.MUL.filter(k => typeof f[k] === "number").map(k => {
      const d = (f[k] - 1) * 100;
      if (typeof ev.x === "number") return `${KNOB[k]} ${pct(d * ev.x)}%`;
      if (nx) { const a = d * nx[0], b = d * nx[1]; return `${KNOB[k]} ${pct(Math.min(a, b))}~${pct(Math.max(a, b)).replace("+", "")}%`; }
      if (!fc) return `${KNOB[k]} ${pct(d)}%`;
      const a = d * (1 - fc), b = d * (1 + fc);
      return `${KNOB[k]} ${pct(Math.min(a, b))}~${pct(Math.max(a, b)).replace("+", "")}%`;
    }).join(" · ");
  }
  function evReveal(E, ev, nx) {
    const forecast = evSize(E, { id: ev.id, round: ev.round }, nx), confirmed = evSize(E, ev, nx);
    return forecast && typeof ev.x === "number" ? `예보 ${forecast} → 확정 ${confirmed}` : confirmed;
  }
  // 설비 출력만 바꾸는 사건인데 우리 지도에 그 설비가 없으면 설비 이름을 돌려준다(카드의 '해당'과 S7 '효과 없음'을 맞춤).
  const EVENT_KIND_NAMES = { solarMul: "태양광", windMul: "육상풍력", offshoreMul: "해상풍력", tidalMul: "조력", coalCapMul: "석탄", lngCapMul: "LNG" };
  // 계획 단계의 이번 달 카드는 편집 중인 지도, 결과 단계의 이번 달 카드는 운영한 계획(S7 사건 단서와 같은 계획)을 본다.
  // 지난 결과의 카드는 그때 계획을 알 수 없어 붙이지 않는다. 설비 종류 집합은 설비 목록이 같으면 다시 계산하지 않는다.
  function eventIdleKinds(E, id, X, round) {
    const keys = Object.keys(E.effect || {});
    if (!keys.length || !keys.every(k => Object.hasOwn(EVENT_KINDS, k)) || round !== X.round) return "";
    const team = X.teams?.[id];
    const plan = X.phase === "plan" ? (id === L.team && L.doc?.maps[L.doc.map]) || team?.plan :
      ["review", "end"].includes(X.phase) ? team?.plan : null;
    if (!plan) return "";
    try {
      const memo = `${id}:${JSON.stringify(plan.builds || [])}`;
      if (L.idleKinds?.key !== memo) L.idleKinds = { key: memo, kinds: withCityPack(id, () => new Set(BG.network(BG.sanitize(plan, 1e9)).nodes.map(n => n.kind))) };
      const kinds = L.idleKinds.kinds;
      return keys.some(k => EVENT_KINDS[k].some(t => kinds.has(t))) ? "" : keys.map(k => EVENT_KIND_NAMES[k]).join("·");
    } catch (e) { return ""; }
  }
  // resp = {plan 단계의 내 대응}이 있으면 대응 버튼을 단다.
  function evCards(X, round, me, act) {
    const reg = R(), list = (X.events || []).filter(x => x.round === round).map(ev => ({ ev, E: C.eventDef(reg, ev.id) })).filter(x => x.E);
    if (!list.length) return "";
    const myT = me && X.teams && X.teams[me];
    const city = me && X.econ?.cities[me], grant = X.phase === "plan" && city && city.cash < -city.debtCap ? C.grantOf(X, reg, me, BG) : null;
    return `${grant?.awarded ? `<p class="lg-hint">지방채 한도를 넘었지만, 이번 달에는 특별교부세 ${fmt(grant.left, 2)}억 안에서만 새 설비·선로를 지을 수 있어요.</p>` : ""}<ul class="lg-evs">${list.map(({ ev, E }) => {
      const sc = E.scope || "region", who = SCOPE[sc] || (sc.startsWith("team:") ? teamName(sc.slice(5)) : sc);
      const mine = me ? C.hits(reg, E, me) : null, nx = mine && myT && myT.fcx ? myT.fcx[E.id] || null : null;
      const idle = mine ? eventIdleKinds(E, me, X, round) : "";
      const size = evSize(E, ev, nx), known = typeof ev.x === "number";
      const cur = myT && myT.resp ? myT.resp[round + ":" + E.id] || "none" : "none", opts = Array.isArray(E.opts) ? E.opts : [];
      const choose = act && mine && opts.length ? `<div class="lg-evopts" role="group" aria-label="${esc(E.name)} 대응">${[{ id: "none", name: "대응 안 함", cost: 0 }, ...opts].map(o => `<button type="button" class="lg-evopt" data-resp="${o.id}" data-ev="${esc(E.id)}" aria-pressed="${cur === o.id}"${o.note ? ` title="${esc(turnText(o.note, X))}"` : ""}>${esc(o.name)}${o.cost ? ` <b class="num">${fmt(o.cost)}억</b>` : ""}</button>`).join("")}</div>${cur !== "none" ? `<small class="lg-evnote">${esc(turnText((opts.find(o => o.id === cur) || {}).note || "", X))}</small>` : ""}` : "";
      const co = opts.find(o => o.id === cur), after = known && co && typeof co.dev === "number" && !co.knobs ? evSize(E, { x: ev.x * co.dev }) : "";
      const picked = !act && mine && cur !== "none" ? `<small class="lg-evnote">우리 대응: ${esc((co || {}).name || "")}${after ? ` → ${esc(after)}` : ""}</small>`
        : !me && X.teams && opts.length ? (() => { const who = actT(X).map(({ id }) => { const o = opts.find(q => q.id === (X.teams[id].resp || {})[round + ":" + E.id]); return o ? `${teamName(id)} ${o.name}` : ""; }).filter(Boolean); return `<small class="lg-evnote">대응: ${esc(who.join(" · ") || "아직 없음")}</small>`; })() : "";
      return `<li class="lg-ev" data-mine="${mine}"><b>${esc(E.name)}</b><span>${esc(turnText(E.text || "", X))}</span>
        ${size ? `<span class="lg-evsize"><i>${known ? "확정" : nx ? "정밀 예보" : E.fc ? "예보" : "크기"}</i> ${esc(size)}</span>` : ""}
        ${X.econ && E.grant && (!me || C.grantAmount({ ...X, events: [ev] }, reg, me, round) > 0) ? `<small class="lg-evnote">특별교부세 ${fmt(KCP.ECON_DATA.params[E.grant.param].v, 2)}억: 이번 달 새 설비·선로·재난 대응 비용에만 쓰며, 남은 돈은 사라져요.</small>` : ""}
        ${E.tip && mine !== false ? `<small class="lg-evnote">${esc(E.tip)}</small>` : ""}${techData()?.eventHints?.[E.id] && mine !== false ? `<small class="lg-tech-event-hint">${esc(techData().eventHints[E.id].text)}</small>` : ""}${choose}${picked}
        <small>${esc(who)}${mine === true ? idle ? ` · 우리 도시 해당 · 우리 지도에 ${esc(idle)} 설비가 없어 우리 발전엔 영향 없음(이웃 거래로는 닿을 수 있음)` : " · 우리 도시 해당" : mine === false ? " · 우리 도시 해당 없음" : ""} · <abbr class="${gradeClass(E.grade)}" title="사건의 근거: ${esc(gradeWords(E.grade))}. 크기와 대응 효과: ${esc(gradeWords("G"))}">근거 ${esc(gradeWords(E.grade))} · 크기 ${esc(gradeWords("G"))}</abbr></small>${eventSourceHTML(E)}</li>`;
    }).join("")}</ul>`;
  }
  // 자료의 ISO 구간 "시작/끝"은 학생이 읽는 '시작~끝'으로 보인다(league-data.js 사건 asOf 계약).
  function eventSourceTimeText(E) {
    // 목록 안은 ', '로 이어 출처 줄의 ' · ' 필드 구분과 섞이지 않게 한다. null은 '시점을 확정할 수 없음'이라는
    // 계약 뜻만 보인다(정책 발표가 아닌 null 사건도 있다).
    const dates = list => list.map(x => String(x).replace("/", "~")).join(", ");
    const observed = E.asOf === null ? "자료 시점 없음"
      : E.asOf === undefined ? "자료 시점 미기재" : `자료 시점 ${dates(E.asOf)}`;
    return observed + (E.published === undefined ? "" : ` · 발표 ${dates(E.published)}`);
  }
  function eventSourceHTML(E) {
    return `<details class="lg-event-source" data-event-source="${esc(E.id)}"><summary>사건 자료·출처</summary><p>${esc(E.why || "실측값 자료 없음 · 게임 가정(G)")}</p><p>출처: ${externalLinks(E.sources || []) || "외부 출처 자료 없음"} · ${esc(eventSourceTimeText(E))} · 근거 ${esc(E.grade || "G")} · 크기 G</p>${E.grant ? `<p>${esc(E.grant.why)}</p><p>출처: ${externalLinks(E.grant.sources)} · ${esc(E.grant.gradeNote)}</p>` : ""}<p class="lg-hint">실측값의 단위는 위 설명 기준이에요. 사건 크기·대응 효과는 게임 가정(G)입니다.</p></details>`;
  }

  /* ---------- 팀 카드: 건설 속도(투자 누적)와 축소 지도 ---------- */
  function spark(H, budget) {
    if (!H || H.length < 2) return `<svg class="lg-spark" viewBox="0 0 120 30" aria-hidden="true"></svg>`;
    const max = Math.max(1, budget || 0, ...H.map(p => p.cap)), t0 = H[0].t, t1 = Math.max(t0 + 1, H[H.length - 1].t);
    const pts = H.map(p => `${(4 + 112 * (p.t - t0) / (t1 - t0)).toFixed(1)},${(27 - 24 * p.cap / max).toFixed(1)}`).join(" ");
    return `<svg class="lg-spark" viewBox="0 0 120 30" role="img" aria-label="투자 누적 변화"><line x1="4" x2="116" y1="3" y2="3" class="lg-spark-b"/><polyline points="${pts}"/></svg>`;
  }
  const TCOL = { sea: "#3d7fb3", beach: "#d8cf9c", plain: "#9cc86a", forest: "#3f8a4f", hill: "#a9a07a", mount: "#7d6c55", urban: "#babac2", river: "#2f8fe0", lake: "#5ab0e6", out: "#59625e", grid: "#f0c83c", town: "#babac2" };
  const BCOL = { solar: "#ffd23f", roof: "#ff9f1c", wind: "#ffffff", offshore: "#cfe8ff", tidal: "#62d2c4", hydro: "#38b6ff", diesel: "#4a3b2c", biomass: "#8a6a2a", battery: "#9b6bff" };
  function thumb(cv, id, plan) {
    const t = C.teamDef(R(), id);
    if (!t || !cv.getContext) return;
    BG.selectPack(t.pack, "league");
    const T = BG.TILES, dpr = Math.min(2, window.devicePixelRatio || 1), W = Number(cv.dataset.thumbWidth) || cv.width, Hh = Number(cv.dataset.thumbHeight) || cv.height;
    cv.dataset.thumbWidth = W; cv.dataset.thumbHeight = Hh;
    cv.width = W * dpr; cv.height = Hh * dpr; cv.style.aspectRatio = `${W} / ${Hh}`;
    const g = cv.getContext("2d");
    g.scale(dpr, dpr);
    const xs = T.map(x => x.X), ys = T.map(x => x.Y), x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const k = Math.min(W / (x1 - x0), Hh / (y1 - y0)), ox = (W - k * (x1 - x0)) / 2 - k * x0, oy = (Hh - k * (y1 - y0)) / 2 - k * y0;
    const P = (X, Y) => [ox + k * X, oy + k * Y];
    T.forEach(tile => {
      const [cx, cy] = P(tile.X, tile.Y);
      g.beginPath();
      for (let a = 0; a < 6; a++) { const ang = Math.PI / 180 * (60 * a - 90); const px = cx + k * 0.98 * Math.cos(ang), py = cy + k * 0.98 * Math.sin(ang); if (a) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath(); g.fillStyle = tile.t === "river" ? TCOL.plain : tile.t === "out" && tile.vt === "river" ? TCOL.out : TCOL[tile.t] || "#888"; g.fill();
    });
    // 강은 물줄기 띠로(호수는 물 면 그대로)
    const wet = x => ["river", "lake", "sea"].includes(x.vt || x.t);
    g.strokeStyle = TCOL.river; g.lineWidth = Math.max(1, k * 0.55); g.lineCap = "round";
    T.forEach(tile => { if ((tile.vt || tile.t) !== "river") return; const [cx, cy] = P(tile.X, tile.Y); g.beginPath(); g.arc(cx, cy, g.lineWidth / 2, 0, Math.PI * 2); (tile.nb || []).map(j => T[j]).filter(o => o && wet(o)).forEach(o => { const [ox2, oy2] = P((tile.X + o.X) / 2, (tile.Y + o.Y) / 2); g.moveTo(cx, cy); g.lineTo(ox2, oy2); }); g.stroke(); });
    const pl = plan || { builds: [], lines: [] };
    g.strokeStyle = "#1b2430"; g.lineWidth = Math.max(1.2, k * 0.28); g.lineJoin = "round";
    (pl.lines || []).forEach(L0 => { if (!Array.isArray(L0.p)) return; g.beginPath(); L0.p.forEach((i, n) => { const tt = T[i]; if (!tt) return; const [x, y] = P(tt.X, tt.Y); if (n) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
    BG.SITES.forEach(s0 => { const tt = T[s0.tile]; if (!tt || s0.kind === "gridpt") return; const [x, y] = P(tt.X, tt.Y); g.fillStyle = "#fff"; g.strokeStyle = "#333"; g.lineWidth = 1; g.fillRect(x - k * 0.35, y - k * 0.35, k * 0.7, k * 0.7); g.strokeRect(x - k * 0.35, y - k * 0.35, k * 0.7, k * 0.7); });
    (pl.builds || []).forEach(b => { const tt = T[b.i]; if (!tt) return; const [x, y] = P(tt.X, tt.Y); g.beginPath(); g.arc(x, y, k * 0.55, 0, Math.PI * 2); g.fillStyle = BCOL[b.t] || "#f0f"; g.fill(); g.lineWidth = 1; g.strokeStyle = "#111"; g.stroke(); });
  }

  /* ---------- 진행자: 도시 지도 크게 보기(#league/view/<팀>) ---------- */
  async function viewCity(app, id) {
    if (!NET.secure()) { app.innerHTML = '<main class="lg-lobby"><a href="#league">← 로비</a><p role="alert">이 주소에서는 팀이 앉을 수 없어요(https 주소나 이 기기 안에서만)</p></main>'; return; }
    if (!await hostInit()) { location.hash = "#league"; return; }
    const t = C.teamDef(R(), id);
    if (!t || !Object.hasOwn(L.S.teams, id)) { location.hash = "#league/host"; return; }
    L.app = app; L.viewing = id;
    const S = L.S, RS0 = C.roundsOf(S), rd = RS0[Math.max(0, S.round - 1)] || RS0[0];
    BG.selectPack(t.pack, "league");
    const st = BG.sanitize(S.teams[id].plan || {}, 1e9);
    st.season = rd.season;
    L.viewLeft = C.publicView(S, Date.now()).teams[id].left;
    BG.mount(app, {
      packs: [t.pack], league: true,
      townLook: () => cityTownLook(C.publicView(L.S, Date.now()), id),
      load: () => ({ v: 2, map: t.pack, maps: { [t.pack]: st }, runs: 0, jAuto: true, journal: [] }),
      save: () => {},
      budget: () => L.viewLeft + BG.capex(BG.current()),
      locked: () => "진행자 보기 전용 — 짓기는 팀 기기에서",
      season: () => rd.season,
      ...(S.econ ? { leagueRound: () => C.roundsOf(L.S)[Math.max(0, L.S.round - 1)],
        leagueMods: st => trialConditions(st, id), leagueGrid: st => trialGrid(st, id), leagueOutageRisk: () => lastOutageRisk(L.snap || C.publicView(L.S, Date.now()), id), leagueTrialGoals: res => trialGoals(res, id), trialScope: trialScope(id) } : {}),
      onMount: root => { refreshCityTownLook(C.publicView(L.S, Date.now()), id); root.querySelector('[data-cap="budget"] .v2-cap-k').textContent = "남은 돈"; viewBar(root, id); window.dispatchEvent(new Event("resize")); }
    });
  }
  function viewBar(root, id) {
    const ids = actT(L.S).map(t => t.id), k = ids.indexOf(id), prev = ids[(k - 1 + ids.length) % ids.length], next = ids[(k + 1) % ids.length];
    const bar = document.createElement("div");
    bar.className = "lg-bar lg-viewbar"; bar.id = "lg-bar"; bar.style.setProperty("--c", teamCol(id));
    bar.innerHTML = `<a class="lg-bbtn" href="#league/host">← 진행자 판</a><a class="lg-bbtn" href="#league/view/${prev}" aria-label="이전 도시">‹</a>
      <span class="lg-bteam">${esc(teamName(id))}</span><span class="lg-bphase">보기 전용</span><span id="lg-vstat"></span>
      <a class="lg-bbtn" href="#league/view/${next}" aria-label="다음 도시">›</a>`;
    root.append(bar);
    viewStat();
  }
  function viewStat() {
    const el = document.getElementById("lg-vstat");
    if (!el || !L || !L.viewing) return;
    const v = C.publicView(L.S, Date.now()).teams[L.viewing], H = v.hist || [], last = H[H.length - 1];
    L.viewLeft = v.left;
    el.textContent = `남은 돈 ${fmt(v.left, 1)}억 · 투자 ${last ? fmt(last.cap) : 0}억 · ${!v.seated ? "빈 자리" : v.online ? "접속" : "끊김"}`;
  }
  // 보고 있는 도시의 계획이 바뀌면 화면을 다시 띄우지 않고 그 자리에서 바꾼다(확대·위치 유지).
  function updateView() {
    const st = BG.current();
    if (!st || !L.viewing) return;
    const t = C.teamDef(R(), L.viewing), plan = L.S.teams[L.viewing].plan;
    if (!plan) { refreshCityTownLook(C.publicView(L.S, Date.now()), L.viewing, false); return; }
    BG.selectPack(t.pack, "league");
    const clean = BG.sanitize(plan, 1e9);
    Object.assign(st, { builds: clean.builds, lines: clean.lines, policies: clean.policies, shed: clean.shed, fab2: clean.fab2 });
    viewStat();
    refreshCityTownLook(C.publicView(L.S, Date.now()), L.viewing);
  }

  /* ---------- 지역 지도(개략) ---------- */
  // 경도·위도 → 화면. 지명 위치는 대략(시·군 중심). 바다·호수는 모양만 흉내 낸 개략도.
  const GEO = { hwaseong: [126.86, 37.17], pyeongtaek: [127.0, 36.99], anseong: [127.3, 37.03], dangjin: [126.68, 36.8], asan: [126.98, 36.78], cheonan: [127.2, 36.82] };
  const P = ([lon, lat]) => [Math.round((lon - 126.45) * 600 / 1.05), Math.round((37.32 - lat) * 470 / 0.72)];
  const SEA = [[126.45, 37.32], [126.74, 37.32], [126.72, 37.2], [126.78, 37.1], [126.92, 37.03], [126.98, 36.97], [126.86, 36.95], [126.74, 36.98], [126.62, 37.0], [126.45, 37.02]];
  const LAKES = [{ n: `${teamName("dangjin")} 인근 호수`, at: [126.83, 36.88], r: [16, 7] }, { n: `${teamName("asan")} 인근 호수`, at: [126.98, 36.9], r: [20, 6] }, { n: `${teamName("hwaseong")} 인근 호수`, at: [126.75, 37.12], r: [12, 6] }, { n: `${teamName("asan")} 남쪽 호수`, at: [126.8, 36.63], r: [12, 6] }];
  // 광역 지도: R().board = 여섯 도시 지도를 합친 한 장. 팀마다 도시 창(BUILD_MAPS[pack].win)에서 지은 선·설비를 제자리에 그린다.
  const SQ3 = Math.sqrt(3);
  let boardCache = null;
  function boardInfo() {
    const B = R().board;
    if (!B) return null;
    if (boardCache && boardCache.B === B) return boardCache;
    const cells = [], sum = {};
    B.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = SQ3 * (c + 0.5 * (r & 1)) + SQ3 / 2, y = 1.5 * r + 1, team = B.letters[B.own[r][c]] || null;
      cells.push({ c, r, ch, x, y, team });
      if (team) { const S0 = sum[team] = sum[team] || [0, 0, 0]; S0[0] += x; S0[1] += y; S0[2]++; }
    }));
    const cen = {};
    Object.keys(sum).forEach(k => { cen[k] = [sum[k][0] / sum[k][2], sum[k][1] / sum[k][2]]; });
    boardCache = { B, cells, cen, W: SQ3 * (B.cols + 0.5), H: 1.5 * (B.rows.length - 1) + 2, at: (c, r) => cells[r * B.cols + c] };
    return boardCache;
  }
  // 도시 창의 칸 번호 → 광역 칸 좌표(x, y)
  function winXY(id, i) {
    const t = C.teamDef(R(), id), P = KCP.BUILD_MAPS[t.pack], cols = P.rows[0].length, w = P.win || [0, 0];
    const c = (i % cols) + w[0], r = Math.floor(i / cols) + w[1];
    return [SQ3 * (c + 0.5 * (r & 1)) + SQ3 / 2, 1.5 * r + 1];
  }
  function gateXY(id, other) {
    const t = C.teamDef(R(), id), P = KCP.BUILD_MAPS[t.pack], g = (P.gates || []).find(x => x.to.includes(other));
    if (!g) return null;
    const w = P.win || [0, 0], c = g.c + w[0], r = g.r + w[1];
    return [SQ3 * (c + 0.5 * (r & 1)) + SQ3 / 2, 1.5 * r + 1];
  }
  function renderBoard(cv, V, res, flash, preview = null, layoutZoom = 1) {
    const TER = KCP.fxRegion.terrain;
    const G = boardInfo(), reg = R(), on = new Set(actT(V).map(t => t.id)), goals = V.goals || reg.goals;
    // 로비에서는 결과·건설 계획 없이 같은 지형과 경계를 그린다. 진행 화면은 원래 경로를 쓴다.
    const lit = new Set(preview?.lit || on), tokens = getComputedStyle(cv);
    const palette = Object.fromEntries(["--ui-panel", "--ui-border", "--ui-text", "--ui-muted", "--ui-gold", "--body"].map(name => [name, tokens.getPropertyValue(name).trim()]));
    const token = name => palette[name];
    const cssW = cv.clientWidth || 600, cssH = preview ? cv.parentElement.clientHeight : Math.round(G.H * cssW / G.W);
    // contain: 같은 배율로 맞추고 남는 공간의 가운데에 지도를 둔다.
    const k = preview ? Math.min(cssW / G.W, cssH / G.H) : cssW / G.W, dpr = Math.min(2, window.devicePixelRatio || 1);
    const kx = k, ox = preview ? (cssW - G.W * k) / 2 : 0, oy = preview ? (cssH - G.H * k) / 2 : 0;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + "px"; }
    const g = cv.getContext("2d");
    const labelBounds = [], names = [], icons = [];
    const box = (x, y, width, height, extra = {}) => ({ x: ox + x * k, y: oy + y * k, width: width * k, height: height * k, ...extra });
    const polygonBox = (points, extra) => {
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]), x = Math.min(...xs) - .3, y = Math.min(...ys) - .3;
      labelBounds.push(box(x, y, Math.max(...xs) + .3 - x, Math.max(...ys) + .3 - y, extra));
    };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr * kx, 0, 0, dpr * k, dpr * ox, dpr * oy);
    const NB_E = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], NB_O = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
    const hex = (x, y, rr) => { g.beginPath(); for (let a = 0; a < 6; a++) { const t = Math.PI / 180 * (60 * a - 90); const px = x + rr * Math.cos(t), py = y + rr * Math.sin(t); if (a) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); };
    // 강 칸은 땅 위에 물줄기(이웃 강·호수·바다 칸까지 잇는 띠)로 그려 호수(물 면 전체)와 구별한다.
    const WET = ch => ch === "r" || ch === "l" || ch === "~", nbOf = cl => (cl.r & 1 ? NB_O : NB_E).map(([dc, dr]) => { const o = G.at(cl.c + dc, cl.r + dr); return o && o.c === cl.c + dc ? o : null; }).filter(Boolean);
    G.cells.forEach(cl => {
      if (preview && !cl.team) return;
      const wet = cl.ch === "~" || cl.ch === "l", ch = cl.ch === "r" ? "p" : cl.ch;
      const base = TER[ch] || TER.p, color = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16));
      // 도시 지도 drawTile처럼 칸마다 7% 이내의 명도 차. 물은 원색 유지.
      const jitter = 1 + (((cl.c * 17 + cl.r * 31) % 19) / 18 - .5) * .07;
      const outside = !preview && (!cl.team || !on.has(cl.team));
      const out = [1, 3, 5].map(i => parseInt(TER.out.slice(i, i + 2), 16));
      g.fillStyle = wet ? base : `rgb(${color.map((v, i) => Math.round((outside ? v * .1 + out[i] * .9 : v) * (outside ? .72 : 1) * jitter)).join(",")})`;
      hex(cl.x, cl.y, 1.03); g.fill();
      if (!wet && ["f", "h", "m"].includes(ch)) {
        g.fillStyle = outside ? "rgba(25,55,25,.12)" : "rgba(255,255,225,.13)";
        g.beginPath(); g.moveTo(cl.x - .6, cl.y + .3); g.lineTo(cl.x, cl.y - .55); g.lineTo(cl.x + .65, cl.y + .3); g.closePath(); g.fill();
      }
      if (cl.ch === "g") {
        g.strokeStyle = "#243c30"; g.lineWidth = .16;
        g.beginPath(); g.moveTo(cl.x - .35, cl.y); g.lineTo(cl.x + .35, cl.y); g.stroke();
        g.strokeRect(cl.x - .6, cl.y - .22, .3, .44); g.strokeRect(cl.x + .3, cl.y - .22, .3, .44);
      }
    });
    g.lineCap = "round"; g.lineJoin = "round";
    [["rgba(230,244,255,0.9)", 0.95], [TER.r, 0.62]].forEach(([col, w]) => {
      g.strokeStyle = col; g.lineWidth = w;
      G.cells.forEach(cl => { if (cl.ch !== "r" || (preview && !cl.team)) return; const ns = nbOf(cl).filter(o => WET(o.ch)); g.beginPath(); if (!ns.length) g.arc(cl.x, cl.y, w / 2, 0, Math.PI * 2); ns.forEach(o => { g.moveTo(cl.x, cl.y); g.lineTo((cl.x + o.x) / 2, (cl.y + o.y) / 2); }); g.stroke(); });
    });
    G.cells.forEach(cl => {
      if (preview) {
        if (!cl.team) return;
        hex(cl.x, cl.y, 1.03);
        g.fillStyle = token("--ui-panel");
        g.globalAlpha = lit.has(cl.team) ? 0.04 : 0.82;
        g.fill(); g.globalAlpha = 1;
      }
    });
    // 도시 경계(팀 색 굵은 선)
    const B = G.B;
    g.lineCap = "round";
    G.cells.forEach(cl => {
      if (!cl.team) return;
      (cl.r & 1 ? NB_O : NB_E).forEach(([dc, dr]) => {
        const o = G.at(cl.c + dc, cl.r + dr) || null, ot = o && o.c === cl.c + dc ? o.team : null;
        if (ot === cl.team) return;
        const nx = SQ3 * (cl.c + dc + 0.5 * ((cl.r + dr) & 1)) + SQ3 / 2, ny = 1.5 * (cl.r + dr) + 1, mx = (cl.x + nx) / 2, my = (cl.y + ny) / 2, dx = (ny - cl.y) / 2 / SQ3, dy = -(nx - cl.x) / 2 / SQ3;
        let border = on.has(cl.team) ? teamCol(cl.team) : "#c2d2c6";
        if (preview) border = !lit.has(cl.team) ? token("--ui-border") : cl.team === preview.player ? token("--ui-gold") : token("--ui-border");
        g.strokeStyle = border;
        g.lineWidth = preview && cl.team === preview.player ? 0.7 : ot ? 0.32 : 0.42;
        g.beginPath(); g.moveTo(mx + dx, my + dy); g.lineTo(mx - dx, my - dy); g.stroke();
      });
    });
    // 팀마다 지은 송전선·설비
    on.forEach(id => {
      const plan = V.teams[id] && V.teams[id].plan;
      if (!plan) return;
      g.strokeStyle = "#1b2430"; g.lineWidth = 0.34; g.lineJoin = "round";
      (plan.lines || []).forEach(L0 => { if (!Array.isArray(L0.p)) return; g.beginPath(); L0.p.forEach((i, n) => { const [x, y] = winXY(id, i); if (n) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
      (plan.builds || []).forEach(b0 => { const [x, y] = winXY(id, b0.i); g.beginPath(); g.arc(x, y, 0.62, 0, Math.PI * 2); g.fillStyle = BCOL[b0.t] || "#f0f"; g.fill(); g.lineWidth = 0.15; g.strokeStyle = "#111"; g.stroke(); });
    });
    // 연계선: 실제 연결점(노란 칸)끼리
    let flows = 0;
    reg.ties.filter(D => !preview && on.has(D.a) && on.has(D.b)).forEach(D => {
      const A = gateXY(D.a, D.b), Bq = gateXY(D.b, D.a);
      if (!A || !Bq) return;
      const T = V.ties.find(x => x.a === D.a && x.b === D.b), F = res && T?.st === "built" && res.flow?.[C.tieId(T)], net = F && Number.isFinite(F.ab) && Number.isFinite(F.ba) ? F.ab - F.ba : 0;
      g.setLineDash(!T ? [0.5, 0.9] : T.st === "prop" ? [1.2, 0.8] : []);
      g.strokeStyle = !T ? "rgba(40,50,60,0.55)" : T.st === "prop" ? token("--ui-gold") : "#1d2430"; g.lineWidth = !T ? 0.3 : T.cap === 4 ? 0.95 : 0.6;
      g.beginPath(); g.moveTo(...A); g.lineTo(...Bq); g.stroke(); g.setLineDash([]);
      if (F && Math.abs(net) > 0.05) {
        const flowWidth = .35 + Math.min(1.4, Math.sqrt(Math.abs(net)) * .035);
        g.setLineDash([0.9, 1.1]); g.lineDashOffset = window.matchMedia("(prefers-reduced-motion: reduce)").matches || KCP.v2?.reduced?.() ? 0 : -(performance.now() / 120) % 4; g.strokeStyle = "#ffd23f"; g.lineWidth = flowWidth + (flash ? .15 : 0);
        g.beginPath(); if (net >= 0) { g.moveTo(...A); g.lineTo(...Bq); } else { g.moveTo(...Bq); g.lineTo(...A); } g.stroke(); g.setLineDash([]);
        g.lineDashOffset = 0;
        const from = net >= 0 ? A : Bq, to = net >= 0 ? Bq : A, dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
        if (len) for (const at of [.35, .7]) {
          const x = from[0] + dx * at, y = from[1] + dy * at, s = 1 + flowWidth;
          polygonBox([[x, y], [x - dx / len * s + dy / len * s * .55, y - dy / len * s - dx / len * s * .55],
            [x - dx / len * s - dy / len * s * .55, y - dy / len * s + dx / len * s * .55]], { kind: "flow-arrow" });
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - dx / len * s + dy / len * s * .55, y - dy / len * s - dx / len * s * .55);
          g.lineTo(x - dx / len * s - dy / len * s * .55, y - dy / len * s + dx / len * s * .55); g.closePath(); g.fillStyle = "#ffd23f"; g.fill();
        }
        g.font = "700 1.35px sans-serif"; g.textAlign = "center"; g.lineWidth = 0.35; g.strokeStyle = "#fff"; g.fillStyle = "#1d2430";
        const mx = (A[0] + Bq[0]) / 2, my = (A[1] + Bq[1]) / 2 - 0.9, tx = `${fmt(Math.abs(net), 0)} MWh`;
        g.strokeText(tx, mx, my); g.fillText(tx, mx, my); flows++;
        labelBounds.push(box(mx - g.measureText(tx).width / 2 - .3, my - 1.65, g.measureText(tx).width + .6, 2.2, { kind: "flow-text" }));
      }
    });
    // 이름표(도시·호수)
    g.textAlign = "center";
    if (!preview) (B.labels || []).forEach(L0 => {
      const x = SQ3 * (L0.c + 0.5 * (L0.r & 1)) + SQ3 / 2, y = 1.5 * L0.r + 1;
      g.font = "600 1.2px sans-serif"; g.fillStyle = "rgba(20,40,60,0.75)"; g.fillText(L0.t, x, y);
      const width = g.measureText(L0.t).width;
      labelBounds.push(box(x - width / 2, y - 1.2, width, 1.6, { kind: "water", soft: true }));
    });
    reg.teams.forEach(t => {
      const c0 = G.cen[t.id]; if (!c0) return;
      const act = on.has(t.id), r0 = res && res.team[t.id], v = V.teams[t.id];
      if (preview) {
        const inactive = preview.mode === "seat" && !act;
        const own = !inactive && t.id === preview.player, locked = preview.mode !== "seat" && (reg.must || []).includes(t.id), taken = preview.mode === "seat" && !!v?.seated;
        // 이름표는 지형의 가로 투영과 무관하게 같은 픽셀 글자 크기로 그린다.
        const size = 13, subSize = 10, x = ox + c0[0] * kx, y = oy + c0[1] * k;
        const name = `${locked ? "🔒 " : ""}${t.name}`, sub = preview.mode === "home" ? "" : preview.mode === "seat" ? inactive ? "이번 방 아님" : taken ? "다른 팀" : own ? "고른 도시" : "비어 있음" : own ? "내 도시" : !act ? "제외" : preview.mode === "solo" ? "컴퓨터" : "참가 도시";
        g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.font = `600 ${size}px ${token("--body")}`;
        const w = Math.max(g.measureText(name).width, sub.length * subSize) + 32;
        g.globalAlpha = inactive ? .45 : taken ? .7 : 1;
        g.beginPath(); g.roundRect(x - w / 2, y - size - 8, w, sub ? size + subSize + 20 : size + 16, 14);
        g.fillStyle = token("--ui-panel"); g.fill();
        g.strokeStyle = own ? token("--ui-gold") : token("--ui-border"); g.lineWidth = own ? 2 : 1; g.stroke();
        g.beginPath(); g.arc(x - w / 2 + 12, y - 4, 5, 0, Math.PI * 2); g.fillStyle = t.color; g.fill();
        if (preview.mode === "seat" && act) { g.beginPath(); g.arc(x + w / 2 - 10, y + subSize + 1, 3, 0, Math.PI * 2); g.fillStyle = tokens.getPropertyValue(taken ? "--ui-muted" : "--ui-mint").trim(); g.fill(); }
        g.fillStyle = own ? token("--ui-gold") : token("--ui-text"); g.fillText(name, x + 4, y);
        if (sub) { if (inactive) g.globalAlpha = .8; g.font = `500 ${subSize}px ${token("--body")}`; g.fillStyle = token("--ui-muted"); g.fillText(sub, x, y + subSize + 3); }
        g.restore();
        return;
      }
      g.font = `800 ${act ? 2.6 : 2.0}px sans-serif`; g.lineWidth = 0.6; g.strokeStyle = "rgba(0,0,0,0.55)"; g.fillStyle = act ? "#fff" : "#f1f5ec";
      g.strokeText(t.name, c0[0], c0[1]); g.fillText(t.name, c0[0], c0[1]);
      const nameWidth = g.measureText(t.name).width;
      names.push(box(c0[0] - nameWidth / 2 - .3, c0[1] - (act ? 2.9 : 2.3), nameWidth + .6, act ? 3.5 : 2.9, { id: t.id }));
      const sub = !act ? "" : r0 ? `정전 ${fmt(r0.unsPct, 1)}%` : v && !v.seated ? "빈 자리" : "";
      if (sub) { g.font = "700 1.5px sans-serif"; g.lineWidth = 0.45; g.strokeText(sub, c0[0], c0[1] + 2.2); g.fillStyle = r0 && r0.unsPct > goals.unsPct ? "#ffb3a8" : "#fff"; g.fillText(sub, c0[0], c0[1] + 2.2); }
      const halfWidth = Math.max(nameWidth, sub ? g.measureText(sub).width : 0) / 2 + .6;
      const iconSize = Math.max(1, 7 / (k / layoutZoom)), iconY = c0[1] - 1;
      const outage = act && r0?.unsPct >= .05, building = act && KCP.fxRegion.newBuildCount(v, V.round, V.phase) > 0;
      if (outage || building) {
        const iconX = c0[0] + halfWidth + iconSize + .7;
        g.save(); g.lineWidth = .22; g.strokeStyle = "#fff";
        if (outage) {
          icons.push(box(iconX - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2, { id: t.id, kind: "outage" }));
          g.beginPath(); g.arc(iconX, iconY, iconSize, 0, Math.PI * 2); g.fillStyle = "#b52b32"; g.fill(); g.stroke();
          g.beginPath(); g.moveTo(iconX + iconSize * .25, iconY - iconSize * .75); g.lineTo(iconX - iconSize * .5, iconY + iconSize * .1);
          g.lineTo(iconX, iconY + iconSize * .1); g.lineTo(iconX - iconSize * .25, iconY + iconSize * .75);
          g.lineTo(iconX + iconSize * .5, iconY - iconSize * .15); g.lineTo(iconX, iconY - iconSize * .15); g.closePath(); g.fillStyle = "#fff"; g.fill();
        }
        if (building) {
          const x = iconX + (outage ? iconSize * 2.4 : 0);
          icons.push(box(x - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2, { id: t.id, kind: "build" }));
          g.fillStyle = "#12634c"; g.fillRect(x - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2); g.strokeRect(x - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2);
          g.lineWidth = .4; g.beginPath(); g.moveTo(x - iconSize * .55, iconY); g.lineTo(x + iconSize * .55, iconY); g.moveTo(x, iconY - iconSize * .55); g.lineTo(x, iconY + iconSize * .55); g.stroke();
        }
        g.restore();
      }
      // 카드 배치는 도시 이름·정전 줄·기호의 실제 픽셀 영역을 피한다.
      const right = halfWidth + (outage || building ? .7 + iconSize * (outage && building ? 4.4 : 2) : 0);
      labelBounds.push(box(c0[0] - halfWidth, c0[1] - Math.max(3, iconSize + 1),
        halfWidth + right, Math.max(3, iconSize + 1) + Math.max(sub ? 3 : 1, iconSize - 1), { id: t.id, kind: "city" }));
    });
    if (V.econ) {
      const top = (V.econ.report?.flows.pop || []).slice().sort((a, b) => b.n - a.n).slice(0, IQ.quarter), max = Math.max(1, ...top.map(f => f.n));
      const drawn = [];
      top.forEach(f => {
        const A = G.cen[f.from], B = G.cen[f.to]; if (!A || !B) return;
        const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy); if (!len) return;
        // 광역 지도 이름·정전 줄의 실제 글자 폭 바깥부터 잇는다.
        const labelEdge = (id, point, vx, vy) => {
          const t = C.teamDef(reg, id), r = res?.team[id], v = V.teams[id];
          const sub = r ? `정전 ${fmt(r.unsPct, 1)}%` : v && !v.seated ? "빈 자리" : "";
          g.font = "800 2.6px sans-serif"; const nameWidth = g.measureText(t.name).width;
          g.font = "700 1.5px sans-serif"; const subWidth = sub ? g.measureText(sub).width : 0;
          const halfWidth = Math.max(nameWidth, subWidth) / 2 + 1.4;
          const scale = Math.min(vx ? halfWidth / Math.abs(vx) : Infinity, vy ? (vy > 0 ? sub ? 5.2 : 1.8 : 4.2) / Math.abs(vy) : Infinity);
          return [point[0] + vx * scale, point[1] + vy * scale];
        };
        const tail = labelEdge(f.from, A, dx / len, dy / len), head = labelEdge(f.to, B, -dx / len, -dy / len);
        if ((head[0] - tail[0]) * dx + (head[1] - tail[1]) * dy <= 0) return;
        const [x, y] = head;
        g.setLineDash([]); g.lineWidth = 0.4 + f.n / max; g.strokeStyle = "#8d2755";
        g.beginPath(); g.moveTo(tail[0], tail[1]); g.lineTo(x, y); g.stroke();
        g.fillStyle = "#8d2755"; g.beginPath(); g.moveTo(x, y); g.lineTo(x - dx / len * 2 + dy / len, y - dy / len * 2 - dx / len); g.lineTo(x - dx / len * 2 - dy / len, y - dy / len * 2 + dx / len); g.closePath(); g.fill();
        polygonBox([[x, y], [x - dx / len * 2 + dy / len, y - dy / len * 2 - dx / len],
          [x - dx / len * 2 - dy / len, y - dy / len * 2 + dx / len]], { kind: "migration-arrow" });
        const mx = (tail[0] + x) / 2, my = (tail[1] + y) / 2;
        labelBounds.push(box(mx - 1.5, my - 1.5, 3, 3, { kind: "migration-mid" }));
        drawn.push([f.from, f.to]);
      });
      cv.dataset.moves = String(drawn.length);
      cv.dataset.movePairs = JSON.stringify(drawn);
    }
    cv.dataset.k = String(k); cv.dataset.flows = String(flows);
    if (preview) { cv.dataset.preview = "true"; cv.dataset.ox = String(ox); cv.dataset.kx = String(kx); cv.dataset.oy = String(oy); }
    if (preview?.mode === "seat") cv.dataset.seatActive = [...on].join(" ");
    else delete cv.dataset.seatActive;
    if (!preview) {
      cv.setAttribute("aria-label", `도시별 설비·송전선·거래·이주 지도. ${KCP.fxRegion.legend}`);
      KCP.fxRegion.recordLayout(cv, { cards: [], names, icons });
    }
    return labelBounds;
  }
  function boardHit(cv, ev) {
    const G = boardInfo(), rect = cv.getBoundingClientRect(), scale = rect.width / cv.clientWidth;
    const k = cv.dataset.preview ? +cv.dataset.k * scale : rect.width / G.W;
    const kx = cv.dataset.preview ? +cv.dataset.kx * scale : k;
    const x = (ev.clientX - rect.left - (cv.dataset.preview ? +cv.dataset.ox * scale : 0)) / kx, y = (ev.clientY - rect.top - (cv.dataset.preview ? +cv.dataset.oy * scale : 0)) / k;
    let best = null, bd = Infinity;
    G.cells.forEach(cl => { const d = (cl.x - x) ** 2 + (cl.y - y) ** 2; if (d < bd) { bd = d; best = cl; } });
    return best && bd < 1.2 && (cv.dataset.seatActive === undefined || cv.dataset.seatActive.split(" ").includes(best.team)) ? best.team : null;
  }
  function renderMap(svg, V, res, flash) {
    const reg = R(), pts = SEA.map(P).map(p => p.join(",")).join(" ");
    const on = new Set(actT(V).map(t => t.id)), G = V.goals || reg.goals;
    const tieSvg = reg.ties.filter(D => on.has(D.a) && on.has(D.b)).map(D => {
      const T = V.ties.find(x => x.a === D.a && x.b === D.b);
      const [x1, y1] = P(GEO[D.a]), [x2, y2] = P(GEO[D.b]);
      const F = res && T && res.flow[C.tieId(T)];
      const net = F ? F.ab - F.ba : 0, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const st = !T ? "none" : T.st;
      const lab = F && (F.ab + F.ba) > 0.05 ? `<text class="lg-flowlab" x="${mx}" y="${my - 6}">${fmt(Math.abs(net), 1)} MWh ${net >= 0 ? "→" : "←"}</text>` : "";
      const dir = net >= 0 ? `M${x1},${y1} L${x2},${y2}` : `M${x2},${y2} L${x1},${y1}`;
      return `<g class="lg-tie" data-st="${st}" data-kind="${D.kind}"><path d="M${x1},${y1} L${x2},${y2}" stroke-width="${T ? (T.cap === 4 ? 7 : 4) : 2}"/>${F && Math.abs(net) > 0.05 ? `<path class="lg-flow${flash ? " lg-flash" : ""}" d="${dir}"/>` : ""}${lab}<title>${esc(teamName(D.a))}–${esc(teamName(D.b))} (${esc(D.name)}) ${!T ? "후보" : T.st === "built" ? `${T.cap} MW 연결` : `${T.cap} MW 제안`}</title></g>`;
    }).join("");
    const cities = reg.teams.map(t => {
      const [x, y] = P(GEO[t.id]), v = V.teams[t.id], r = res && res.team[t.id];
      if (!on.has(t.id)) return `<g class="lg-city" data-off="true"><circle cx="${x}" cy="${y}" r="26"/><text x="${x}" y="${y + 5}" class="lg-cname">${esc(t.name)}</text></g>`;
      const ring = r ? (r.unsPct > G.unsPct ? "bad" : "ok") : "none";
      return `<a href="#league/view/${t.id}" class="lg-citylink"><g class="lg-city" data-ring="${ring}" style="--c:${t.color}"><circle cx="${x}" cy="${y}" r="34"/><text x="${x}" y="${y + 5}" class="lg-cname">${esc(t.name)}</text>${v.seated ? "" : `<text x="${x}" y="${y + 22}" class="lg-cempty">빈 자리</text>`}</g><title>${esc(t.name)} 지도 보기</title></a>`;
    }).join("");
    svg.innerHTML = `<rect width="600" height="470" class="lg-land"/><polygon points="${pts}" class="lg-sea"/>
      ${LAKES.map(l => { const [x, y] = P(l.at); return `<ellipse cx="${x}" cy="${y}" rx="${l.r[0]}" ry="${l.r[1]}" class="lg-lake"/><text x="${x}" y="${y + 18}" class="lg-lname">${l.n}</text>`; }).join("")}
      <ellipse cx="${P([126.63, 37.17])[0]}" cy="${P([126.63, 37.17])[1]}" rx="7" ry="4" class="lg-isle"/><text x="${P([126.63, 37.17])[0]}" y="${P([126.63, 37.17])[1] - 8}" class="lg-lname">제부도</text>
      <text x="40" y="60" class="lg-seaname">서해</text><text x="${P([126.84, 37.0])[0]}" y="${P([126.84, 37.0])[1] + 4}" class="lg-seaname s">${esc(teamName("asan"))} 쪽 만</text>
      ${tieSvg}${cities}`;
  }

  /* ================= 팀 ================= */
  function teamView(app) {
    const save = tab.get();
    if (!NET.secure()) {
      close();
      app.innerHTML = '<main class="lg-lobby"><a href="#league">← 로비</a><p role="alert">이 주소에서는 안전한 연결을 만들 수 없어요. https 주소나 같은 기기에서 열어 줘요.</p></main>';
      return;
    }
    if (!save || !validRoom(save.room)) { location.hash = "#league"; return; }
    if (!L || L.role !== "team" || L.room !== save.room) {
      close();
      L = { role: "team", room: save.room, net: save.net || { kind: "local" }, team: save.team || null, identity: save.identity || null, fingerprint: save.fingerprint, hostKey: save.hostKey, hostN: save.hostN || 0, sid: save.sid, seat: save.seat, migrationFrom: save.migrationFrom, lastHostAt: Date.now(), lastSnapAt: Date.now(), pendingRequests: new Map(), snap: null, timers: [], rev: 0, planT: 0, skew: 0, lastPhase: null, lastRound: 0 };
      L.conn = NET.open(Object.assign({ room: save.room }, L.net, {
        ack: false, // 전달 확인은 진행자만 쓴다(D-77). 저장값 형식이 바뀌어도 팀은 켜지 않는다.
        canSend: (ev, m) => !L?.away || ev !== "req" || ["hello", "claim"].includes(NET.requestBody(m)?.type)
      }));
      const session = L;
      const receiveHost = NET.hostReceiver(session, async (event, data) => {
        if (L !== session) return;
        session.lastHostAt = Date.now();
        // '연결됨'은 받아들인 공개 상태가 있을 때만: 형식이 맞지 않아 버린 상태로는 연결 확인 안내를 끄지 않는다(D-77).
        const seq = session.snapSeq;
        if (event === "snap") onSnap(data);
        // 이른 claim 거절은 첫 snap 뒤 정상 claim의 자리 해제·30초 지연을 일으키지 않는다.
        else if (!(event === "nack" && data?.type === "claim" && data.n === session.earlyClaimN)) await response(event, data);
        const status = document.getElementById("lg-conn");
        if (event === "snap" && session.snapSeq !== seq) { session.hostWarning = false; if (status) { status.dataset.s = "open"; status.textContent = connLabel("open"); } }
        if (L === session) teamSave();
      }, event => { if (L === session && event === "snap") connectionWarning(); });
      for (const event of ["snap", "nack", "ack"]) L.conn.on(event, wire => receiveHost(event, wire));
      // 소켓이 다시 열려도 받아들인 공개 상태가 오기 전에는 연결 확인 안내를 '연결됨'으로 덮지 않는다(D-77 판본 혼재).
      L.conn.onStatus(s => { const el = document.getElementById("lg-conn"); if (el && !(s === "open" && L.hostWarning)) { el.dataset.s = s; el.textContent = connLabel(s); } if (s === "open" && L.team && !L.claimAccepted) send("claim"); });
      // 교실 와이파이에서 요청 하나가 사라져도 5초 안에 복구한다: 계획·정책·기준·준비를 진행자에 반영될 때까지 다시 보낸다.
      // 진행자는 같은 값을 조용히 넘기므로(reduce의 quiet) 중복 전송은 해가 없다. 준비는 토글이 아니라 원하는 값을 보낸다.
      L.timers.push(setInterval(() => {
        connectionWarning();
        if (!L.team) return;
        if (!L.snap) return;
        if (!L.claimAccepted) { send("claim"); return; }
        const canRetry = type => {
          const sent = L.stateRequests?.[type];
          if (!sent || sent.team !== L.team || sent.sid !== L.snap.sid || sent.seat !== L.snap.teams[L.team]?.seatVersion) return true;
          // 기준의 숫자 편집은 전송 전 pending만 바뀔 수 있다. ack는 그 새 편집을 막지 않는다.
          return Date.now() - sent.sentAt >= 2000 && (type !== "plan" || !sent.acked || sent.rev !== L.rev);
        };
        if (canRetry("hello")) send("hello");
        for (const pending of L.pendingRequests.values()) if (Date.now() - pending.sentAt >= 5000) retryRequest(pending);
        reportPromiseVerdict(L.snap);
        const me = L.snap && L.snap.teams[L.team];
        if (!me) return;
        if (["lobby", "plan"].includes(L.snap.phase) && me.rev < L.rev && canRetry("plan")) sendPlan();
        if (L.snap.phase === "plan") {
          if (L.pendingPol && canRetry("econ")) send("econ", L.pendingPol);
          if (L.pendingCrit && validCritLine(L.pendingCrit.line) && L.pendingCrit.chips.length && L.pendingCrit.choice && canRetry("crit")) send("crit", L.pendingCrit);
        }
        if (readyAllowed(L.snap) && L.wantReady != null && !!me.ready !== L.wantReady && canRetry("ready")) send("ready", { ready: L.wantReady });
      }, 5000));
      L.timers.push(setInterval(tickTimer, 1000));
    }
    L.app = app;
    if (!L.team) seatPicker(app);
    else if (L.claimAccepted && L.snap?.teams[L.team]) mountCity(app);
    else {
      app.innerHTML = `<main class="lg-lobby" id="lg-team-wait"><a class="lg-back" href="#league">← 로비</a><h1>${esc(teamName(L.team))} 팀</h1><p role="status" id="lg-wait">진행자에게 첫 도시 상태를 받는 중이에요.</p></main>`;
      send("hello"); send("claim");
    }
  }
  function send(type, extra, retry) {
    if (type === "verdict" && L.role !== "team") return;
    if (L.away && !["hello", "claim"].includes(type)) return;
    if (type === "crit") {
      if (!extra || !validCritLine(extra.line) || !extra.chips?.length || !extra.choice) return;
      if (extra !== L.pendingCrit) queueCrit(extra);
      extra = L.pendingCrit;
    }
    if (type === "ready") L.wantReady = !!(extra && extra.ready);
    const stamp = L.snap && !["claim", "hello"].includes(type) ? { rd: L.snap.round, ph: L.snap.phase } : {};
    if (L.role === "solo") {
      L.conn.send("req", Object.assign({ type, team: L.team, token: L.token }, extra || {}, stamp));
      return;
    }
    const earlyClaim = !L.snap && type === "claim" && !L.earlyClaimSent && L.hostKey && L.sid && tab.get()?.room === L.room;
    if ((!L.snap?.sid && !earlyClaim) || !L.team) return;
    if (type === "claim" && Date.now() < (L.claimAfter || 0)) return;
    if (earlyClaim) L.earlyClaimSent = true;
    const session = L, team = L.team;
    const oneShot = ["tie", "respond", "price", "research", "license", "joint", "verdict"].includes(type);
    if (oneShot && !retry && L.pendingRequests.size >= 32) { BG.toast("응답을 기다리는 요청이 많아요. 잠시 뒤 다시 요청해요."); return; }
    const pending = retry || (oneShot ? { id: NET.sessionId(), type, extra: structuredClone(extra || {}), stamp, tries: 0 } : null);
    const request = { ...extra, ...(pending?.stamp || stamp), type, sid: earlyClaim ? L.sid : L.snap.sid, seat: (earlyClaim ? L.seat : L.snap.teams[team]?.seatVersion) || 0, ...(pending ? { id: pending.id, born: pending.born } : {}) };
    if (pending) { session.pendingRequests.set(pending.id, pending); pending.sentAt = Date.now(); rememberVerdictRequest(pending); }
    // 대기열에 넣을 때 최신 요청을 표시해 이전 ack가 새 편집을 지우지 못하게 한다.
    const stateRequest = ["hello", "plan", "econ", "crit", "ready"].includes(type)
      ? { team, sid: request.sid, seat: request.seat, sentAt: Date.now(), n: null,
          pol: L.pendingPol, crit: L.pendingCrit, ready: L.wantReady, rev: request.rev } : null;
    if (stateRequest) { session.stateRequests ||= {}; session.stateRequests[type] = stateRequest; }
    // 서명도 직렬 처리해 느린 기기에서 뒤 요청이 앞서 전송되지 않게 한다.
    session.sending = (session.sending || Promise.resolve()).then(async () => {
      if (L !== session || L.team !== team) return;
      if (!session.identity) session.identity = await NET.createIdentity();
      if (L !== session || L.team !== team) return;
      if (type === "claim") request.publicKey = session.identity.publicKey;
      const envelope = await NET.signEnvelope(session.identity, team, request);
      if (L !== session || L.team !== team) return;
      // 저장 실패 시 미등록 키로 자리를 잡지 않는다. 예전 토큰 방식으로 돌아가지 않는다.
      if (!teamSave()) throw new Error("seat-save");
      if (pending) { const body = NET.requestBody(envelope); pending.n = body.n; pending.born = body.born; rememberVerdictRequest(pending); }
      if (stateRequest) { stateRequest.n = NET.requestBody(envelope).n; stateRequest.sentAt = Date.now(); }
      // 첫 snap의 정상 claim은 이른 claim의 5초 재시도 대기에도 막히지 않아야 한다.
      if (type === "claim") { session.claimN = NET.requestBody(envelope).n; session.claimSeat = request.seat; session.claimAfter = earlyClaim ? 0 : Date.now() + 5000; }
      if (earlyClaim) session.earlyClaimN = session.claimN;
      session.conn.send("req", envelope);
    }).catch(() => {
      if (L === session) BG.toast("안전한 연결을 만들지 못했어요. 다시 접속해 줘요.");
    });
    return pending;
  }
  function teamSave() { if (L.role === "solo") { saveSolo(); return; } const s = { room: L.room, net: L.net, team: L.team, identity: L.identity, fingerprint: L.fingerprint, hostKey: L.hostKey, hostN: L.hostN, sid: L.sid, seat: L.seat, migrationFrom: L.migrationFrom }; const saved = teamWrote(K_TAB, tab.set(s)); if (L.team) teamSet(K_TEAM, s); return saved; }
  function seatPicker(app) {
    lobbyStop?.();
    document.documentElement.classList.remove("v2-league-lobby", "v2-league-host");
    document.documentElement.classList.add("v2-league-seat");
    const reg = R(), V = L.snap, teams = V ? actT(V) : reg.teams;
    if (!V || !teams.some(t => t.id === L.seatChoice && !V.teams[t.id].seated)) L.seatChoice = null;
    const noticeOpen = app.querySelector('[data-fold="data-notice-team"]')?.open;
    const seatInfo = app.querySelector('[data-fold="seat-choice"]');
    const seatInfoState = seatInfo && { open: seatInfo.open, pinned: seatInfo.dataset.pinned };
    const infoFocus = document.activeElement?.getAttribute("data-info-key");
    const noticeFocus = document.activeElement?.getAttribute("data-fold-summary");
    const focusSeat = document.activeElement?.dataset.seat, confirmFocus = document.activeElement?.id === "lg-seat-confirm";
    app.innerHTML = `<main class="lg-lobby lg-seat-picker">
      <header class="lg-topline"><a class="lg-back" href="#league">← 로비</a><div class="lg-title"><p class="v2-kicker">팀으로 참가 · 방 ${esc(displayRoom(L.room))}</p><h1>우리 팀 도시 고르기</h1></div><span class="lg-hud-pill">빈 자리 <b>${V ? teams.filter(t => !V.teams[t.id].seated).length : "–"}/${teams.length}</b></span></header>
      <p class="lg-sub" id="lg-wait">${V ? "빈 도시를 고르고, 참가 버튼으로 확정해요." : "진행자 화면을 찾는 중… 방 코드와 연결 방식이 맞는지 확인해요."}</p>
      <div class="lg-seat-layout"><section class="lg-seat-stage" aria-label="도시 지도와 자리 선택"><figure class="lg-seat-map">${reg.board ? '<canvas id="lg-seat-map" role="img" aria-label="도시 지도. 아래 도시 버튼으로 선택할 수 있어요."></canvas>' : ""}</figure>
      <div class="lg-seats" role="group" aria-label="우리 팀 도시 선택">${teams.map(t => { const taken = V?.teams[t.id]?.seated; return `<button type="button" class="lg-seatbtn" data-seat="${esc(t.id)}" aria-pressed="${t.id === L.seatChoice}" ${!V || taken ? "disabled" : ""}><b>${esc(t.name)}</b><span>${!V ? "…" : taken ? "다른 팀이 맡음" : "비어 있음"}</span></button>`; }).join("")}</div></section>
      <aside class="lg-seat-info" aria-label="고른 도시 정보"><div id="lg-seat-info" aria-live="polite"></div>${infoTip("seat-choice", "선택한 도시를 확인한 뒤 참가해요. 점유된 도시는 고를 수 없어요.", { label: "고른 도시 정보" })}${dataNoticeHTML("team")}<button type="button" class="v2-btn primary" id="lg-seat-confirm" disabled>도시를 먼저 골라요</button></aside></div>
      <p class="lg-err" id="lg-err" role="alert"></p></main>`;
    const root = app.querySelector(".lg-seat-picker"), cv = app.querySelector("#lg-seat-map");
    const draw = () => {
      if (!cv?.isConnected) return;
      renderBoard(cv, { active: teams.map(t => t.id), teams: Object.fromEntries(teams.map(t => [t.id, { seated: !!V?.teams[t.id]?.seated }])), ties: [] }, null, false, { player: L.seatChoice, mode: "seat" });
    };
    const select = id => {
      if (!V || !teams.some(t => t.id === id) || V.teams[id].seated) return;
      L.seatChoice = id; update();
    };
    const update = () => {
      const t = teams.find(t => t.id === L.seatChoice), info = app.querySelector("#lg-seat-info"), button = app.querySelector("#lg-seat-confirm");
      app.querySelectorAll("[data-seat]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.seat === L.seatChoice)));
      info.innerHTML = t ? lobbyCityInfo(t) : '<h2>어느 도시를 맡을까요?</h2><p class="lg-hint">지도나 아래 도구 막대에서 빈 도시를 골라요.</p>';
      button.disabled = !t; button.textContent = t ? `${t.name}으로 참가` : "도시를 먼저 골라요";
      draw();
    };
    const notice = app.querySelector('[data-fold="data-notice-team"]');
    if (noticeOpen !== undefined) notice.open = noticeOpen;
    const newSeatInfo = app.querySelector('[data-fold="seat-choice"]');
    if (seatInfoState) {
      newSeatInfo.open = seatInfoState.open;
      if (seatInfoState.pinned) newSeatInfo.dataset.pinned = seatInfoState.pinned;
    }
    bindInfoTips(app);
    bindDataNotices(app, update);
    app.querySelectorAll("[data-seat]").forEach(b => b.addEventListener("click", () => select(b.dataset.seat)));
    cv?.addEventListener("click", e => { const id = boardHit(cv, e); if (id) select(id); });
    cv?.addEventListener("mousemove", e => {
      const id = boardHit(cv, e);
      cv.style.cursor = id && V?.teams[id] && !V.teams[id].seated ? "pointer" : "default";
    });
    cv?.addEventListener("mouseleave", () => { cv.style.cursor = "default"; });
    app.querySelector("#lg-seat-confirm").addEventListener("click", e => {
      const id = L.seatChoice;
      if (!id || !L.snap?.teams[id] || L.snap.teams[id].seated || L.claiming) return;
      L.team = id; L.claiming = true; L.claimAccepted = false;
      teamSave(); send("claim");
      e.currentTarget.disabled = true; app.querySelectorAll("[data-seat]").forEach(b => { b.disabled = true; });
      app.querySelector("#lg-wait").textContent = `${teamName(L.team)} 자리를 요청했어요…`;
    });
    const ro = cv ? new ResizeObserver(draw) : null;
    if (cv) ro.observe(cv);
    const mo = new MutationObserver(() => { if (!root.isConnected) stop(); });
    const stop = () => { ro?.disconnect(); mo.disconnect(); document.documentElement.classList.remove("v2-league-seat"); };
    mo.observe(app, { childList: true }); lobbyStop = stop;
    update();
    if (focusSeat) [...app.querySelectorAll("[data-seat]")].find(b => b.dataset.seat === focusSeat)?.focus({ preventScroll: true });
    else if (confirmFocus) app.querySelector("#lg-seat-confirm").focus({ preventScroll: true });
    else if (noticeFocus === "data-notice-team") notice.querySelector("summary").focus({ preventScroll: true });
    else if (infoFocus === "seat-choice") newSeatInfo.querySelector("summary").focus({ preventScroll: true });
  }
  function connectionWarning() {
    // 서명을 확인한 진행자 메시지(ack 포함)가 10초 없거나, 받아들인 공개 상태가 20초 없을 때 안내한다.
    // 부하 중 무거운 snap 처리만 밀릴 때 일찍 뜨지 않게 하면서, 형식이 안 맞는 snap만 오는 경우(D-77 판본 혼재)도 잡는다.
    const now = Date.now(), hostAge = now - L.lastHostAt, snapAge = now - (L.lastSnapAt ?? L.lastHostAt);
    if (hostAge <= 10000 && snapAge <= 20000) return;
    L.hostWarning = true;
    // 새로고침 권유는 30초가 지나도 돌아오지 않을 때만 붙인다. 짧은 밀림에 학생이 새로고침부터 누르지 않게 한다.
    const text = "진행자 화면과 연결을 확인하는 중" + (Math.max(hostAge, snapAge) > 30000 ? " · 새로고침하면 다시 연결됩니다" : "");
    const el = document.getElementById("lg-conn") || document.getElementById("lg-wait");
    if (el) { el.textContent = text; el.dataset.s = "connecting"; }
  }
  function releaseSeat() {
    L.regionObserver?.disconnect(); L.away = null; L.home = null;
    L.team = null; L.seat = null; L.claiming = false; L.claimAccepted = false; L.pendingRequests.clear(); teamSave();
    if (L.app?.isConnected) { location.hash !== "#league/team" ? (location.hash = "#league/team") : seatPicker(L.app); }
  }
  function retryRequest(pending) {
    if (pending.tries >= 3) {
      L.pendingRequests.delete(pending.id);
      if (pending.type === "verdict") { rememberVerdictRequest(pending, true); return; } // 자동 전송 — 학생 알림 없음(D-75)
      if (["research", "license", "joint"].includes(pending.type)) { L.techPending = null; L.techError = "요청 응답을 확인하지 못했어요. 연결을 확인하고 다시 요청해요."; renderPanel(); }
      BG.toast("요청 응답을 확인하지 못했어요. 연결을 확인하고 다시 요청해요."); return;
    }
    pending.tries++; send(pending.type, pending.extra, pending);
  }
  async function response(event, m) {
    const session = L;
    if (!m || m.team !== L.team || !L.identity || m.kid !== await NET.fingerprint(L.identity.publicKey)) return;
    if (L !== session) return;
    // signature 거절의 kid/id는 아직 인증되지 않은 요청에서 왔다. 대기 요청도 취소하지 않는다.
    if (event === "nack" && m.err === "signature") return;
    const pending = L.pendingRequests.get(m.id);
    if (["tie", "respond", "price", "research", "license", "joint", "verdict"].includes(m.type) && !pending) return;
    if (m.type === "claim" && m.n !== L.claimN) return;
    if (pending && pending.n !== m.n) return;
    if (event === "ack") {
      if (pending) { L.pendingRequests.delete(m.id); rememberVerdictRequest(pending, true); }
      const sent = L.stateRequests?.[m.type];
      if (sent && sent.n === m.n && sent.team === L.team && sent.sid === L.snap?.sid && sent.seat === L.snap?.teams[L.team]?.seatVersion) {
        sent.acked = true;
        if (m.type === "ready" && L.wantReady === sent.ready) { L.readyAcked = sent.ready; L.wantReady = null; }
        if (m.type === "crit" && L.pendingCrit === sent.crit) L.pendingCrit = null;
        if (m.type === "econ" && L.pendingPol === sent.pol) L.pendingPol = null;
      }
      if (m.type === "claim" && m.n === L.claimN && m.seat === L.claimSeat) {
        L.claimAccepted = true; L.seat = m.seat;
        const old = L.migrationFrom;
        if (old?.team === L.team && old.room !== L.room && !hasTeamContent(store.get(dataKey()))) {
          const data = store.get(`${K_DATA}:${old.room}:${L.team}`);
          s7data(); // 새 방 키에 남은 분리 전 사본을 덮어쓰기 전에 분리 키로 옮긴다.
          if (data) teamSet(dataKey(), data);
          // 옛 방에서 이어 온 판이면 분리 키 사본도 따라온다(새 방 사본이 없을 때만).
          const oldS7 = store.get(`${K_S7}:${old.room}:${L.team}`);
          if (oldS7 && !store.get(s7Key())) teamSet(s7Key(), oldS7);
          s7data(); // 옛 방 자료에 들어 있던 분리 전 사본도 정리한다.
        }
        if (L.snap?.teams[L.team]?.seatVersion === L.seat) onSnap(L.snap, true);
      }
      return;
    }
    if (pending && m.err === "session") return; // 새 sid는 서명된 snap에서만 받는다.
    if (pending && m.err === "replay") { retryRequest(pending); return; }
    if (pending) { L.pendingRequests.delete(m.id); rememberVerdictRequest(pending, true); }
    nack(m);
  }
  function nack(m) {
    if (["signature", "replay", "seat", "session"].includes(m.err)) return;
    // 약속 판정은 화면이 스스로 보내는 값이다. 늦게 도착해 거절돼도 학생에게 알림을 띄우지 않는다(D-75).
    if (m.type === "verdict") return;
    if (m.type === "claim") {
      const msg = m.err === "legacy" ? "진행자에게 이 팀 자리 비우기를 요청해요" : "다른 기기가 이미 그 팀을 맡았어요. 진행자에게 이 팀 자리 비우기를 요청해요";
      L.claimAfter = Date.now() + 30000;
      releaseSeat();
      BG.toast(msg);
      const el = document.getElementById("lg-err"); if (el) el.textContent = msg;
      return;
    }
    if (["research", "license", "joint"].includes(m.type)) {
      L.techPending = null; L.techError = m.err === "stale" ? "지난 단계 요청이에요. 현재 화면에서 다시 확인해요." : techErrorText(m.err); renderPanel();
      BG.toast(L.techError); return;
    }
    if (m.type === "crit") {
      // 늦게 도착한 이전 요청의 거절이 새 편집값을 지우지 않게 한다.
      if (m.rid != null && m.rid !== L.pendingCrit?.rid) return;
      L.pendingCrit = null;
    }
    if (m.type === "econ") { L.pendingPol = null; renderPanel(); }
    if (m.type === "plan" && ["phase", "stale"].includes(m.err) && !["lobby", "plan"].includes(L.snap?.phase)) {
      warnUnsentPlan(); return;
    }
    const msg = { stale: "지난 단계 요청이에요. 현재 화면에서 다시 확인해요.", phase: "지금 단계에서는 바꿀 수 없어요.", built: "이미 연결된 연계선이에요.", noprop: "제안이 없어요.", notie: "이웃이 아닙니다.", noev: "이번 라운드 우리 도시 사건이 아닙니다.", noopt: "없는 대응이에요." }[m.err] || (String(m.err).startsWith("budget:") ? `${teamName(String(m.err).slice(7))} 예산이 모자랍니다.` : "요청을 처리하지 못했어요.");
    BG.toast(turnText(msg));
  }
  // 지지율 변화 원인: 재보정 엔진은 why가 문장, 옛 엔진은 {key, text} 객체다. 객체를 그대로 찍지 않는다.
  function whyText(g) {
    const why = g?.why;
    const text = typeof why === "string" ? why : why?.text || g?.approvalChangeCause?.text || "";
    return text.replace(/([+−-]?\d+(?:\.\d+)?)%p/g, (_, value) => `${signed(Number(value.replace("−", "-")), 1)}%p`);
  }
  function onSnap(V, replay) {
    V = NET.expandSnapshot(V);
    if (!V || V.room !== L.room || V.region !== REGION || !V.teams) return;
    // 이미 받은 상태를 다시 그리는 호출(replay)은 새 진행자 상태가 아니므로 연결 판정 시각을 바꾸지 않는다.
    if (!replay) { L.lastSnapAt = Date.now(); L.snapSeq = (L.snapSeq || 0) + 1; }
    return soloMutate(() => {
      const prev = L.snap;
      L.snap = V; L.skew = V.now - Date.now();
      if (!L.team) { if (L.app && L.app.isConnected && L.app.querySelector(".lg-seats")) seatPicker(L.app); return; }
      const me = V.teams[L.team];
      // 탭 저장의 팀이 이 방에 없으면 기다림 화면에서 멈추지 않고 자리 선택으로 돌아간다.
      if (!me) {
        if (L.role === "team") {
          // '이어서 하기' 저장에 같은 방·없는 팀이 남으면 누를 때마다 다시 돌아오므로 함께 지운다.
          const last = store.get(K_TEAM);
          if (last?.room === L.room && last?.team === L.team) store.del(K_TEAM);
          releaseSeat(); KCP.toast("이 방에 그 도시 자리가 없어 자리 선택으로 돌아왔어요.");
        }
        return;
      }
      if (L.role === "team") {
        const previousSeat = L.seat;
        if (previousSeat != null && me.seatVersion !== previousSeat) { releaseSeat(); return; }
        if (!prev) send("claim");
        if (prev && prev.sid !== V.sid) {
          for (const pending of L.pendingRequests.values()) retryRequest(pending);
        }
        if (!L.claimAccepted) return;
      }
      // S7 운영 연료는 월말 갱신 전의 계획 단계 값으로 기기에만 보관한다.
      outageRememberIntl(V);
      // 결과를 받은 즉시, 다음 계획이 편집되기 전에 한 번만 계산한다.
      if (V.econ && ["review", "end"].includes(V.phase)) {
        if (L.role === "team") KCP.fxEnd?.remember(V, V.results.at(-1));
        outageSnapshot(V, V.results.at(-1), L.team);
        outageAttribution(V, V.results.at(-1), L.team);
      }
      reportPromiseVerdict(V);
      if (V.econ?.report?.cities?.[L.team]) {
        const d = tdata(); d.interview = d.interview || {}; d.interview.causes = d.interview.causes || {};
        const last = V.results.at(-1);
        if (last) {
          d.interview.causes[last.round] = V.econ.report.cities[L.team].causes || [];
          d.interview.metrics = d.interview.metrics || {};
          const f = V.econ.report.fiscal?.[L.team], grid = gridFillMWh(last.team?.[L.team]);
          d.interview.metrics[last.round] = { balance: f ? f.revTotal - f.expTotal + (f.exp.capex || 0) : null,
            tieCost: V.econ.report.contrib?.[L.team]?.tieCost, taxRes: V.econ.cities[L.team].policy?.taxRes,
            grid: grid == null ? null : grid * resultPeriod(V, last).mul };
          // 결과를 한 달 놓치고 다시 붙어도, 아직 전체 필드가 남은 앞 달의 계통 값은 채워 둔다.
          V.results.slice(-2, -1).forEach(res => {
            const g = gridFillMWh(res.team?.[L.team]), m = d.interview.metrics[res.round] = d.interview.metrics[res.round] || {};
            if (g != null && !Number.isFinite(m.grid)) m.grid = g * resultPeriod(V, res).mul;
          });
          putData(d);
        }
      }
      // 새로고침·이어서: 첫 상태를 받기 전에는 대기 화면이고, 받은 뒤에 도시 지도를 붙인다.
      if (L.app?.isConnected && L.app.querySelector("#lg-team-wait")) { mountCity(L.app); return; }
      syncTechQueue(V, me);
      const pending = L.pendingCrit, crit = me?.crit;
      if (pending && crit && pending.line === crit.line && pending.choice === crit.choice && pending.chips.length === crit.chips.length && pending.chips.every((k, i) => k === crit.chips[i])) L.pendingCrit = null;
      if (prev && (prev.phase !== V.phase || prev.round !== V.round)) { L.pendingCrit = null; L.pendingPol = null; L.awaitReady = false; L.wantReady = null; L.readyAcked = null; }
      if (L.wantReady != null && me && !!me.ready === L.wantReady) L.wantReady = null;
      if (L.readyAcked != null && me && !!me.ready === L.readyAcked) L.readyAcked = null;
      const pendingPol = L.pendingPol, econPol = me?.econPol;
      if (pendingPol && econPol && ["taxRes", "taxInd", "service", "incentive", "re100"].every(k => (k === "re100" ? !!pendingPol[k] === !!econPol[k] : pendingPol[k] === econPol[k]))) L.pendingPol = null;
      if (L.claiming && me.seated) { L.claiming = false; if (L.app && L.app.isConnected) mountCity(L.app); return; }
      if (!L.app || !L.app.isConnected || !document.getElementById("lg-bar")) return;
      if (L.away) {
        if (prev && (prev.phase !== V.phase || prev.round !== V.round)) phaseChanged(V);
        updateTeamAway();
        return;
      }
      // 내 도시를 다른 기기에서 처음 여는 경우: 진행자에게 남은 계획을 가져온다.
      if (me.plan && me.rev > L.rev && L.rev === 0 && isEmptyDoc()) adoptPlan(me);
      const rd = curRound();
      BG.setSeason(rd.season);
      if (V.econ && V.phase === "plan") {
        const { d, n } = monthNote(); n.buildCost = newBuildCost(V); n.buildBudget = me.budget; putData(d);
      }
      // 계절이 같아도 달이 바뀌면 leagueRound()를 다시 읽어 HUD 시간을 갱신한다.
      refreshCityTownLook(V, L.team);
      if (prev && (prev.phase !== V.phase || prev.round !== V.round)) phaseChanged(V);
      else if (!prev && V.phase === "plan") closePanel();
      // 진행자는 연결 복구용으로 4초마다 같은 공개 상태를 다시 보낸다. 화면에 쓰는 내용(now 제외)과
      // 수신 처리로 바뀌는 기기 쪽 대기 값이 지난번과 같으면 머리 막대·서랍을 갈아 끼우지 않는다.
      // 학생이 누르던 체크박스·입력칸이 내용 변화 없이 바뀌어 조작을 놓치지 않게 한다.
      // 이미 받은 상태를 다시 그리는 호출(replay)과 혼자 하기는 늘 그린다.
      if (L.role === "team" && !replay) {
        const viewKey = JSON.stringify([{ ...V, now: 0 }, L.team, L.rev, L.techPending, L.techError,
          L.pendingCrit, L.pendingPol, L.wantReady, L.readyAcked, L.awaitReady]);
        if (viewKey === L.snapViewKey) { if (L.panelDirty && L.panel) snapRenderPanel(); return; }
        // 그리다 예외가 나면 다음 같은 상태에서 다시 시도하도록 키는 그린 뒤에 남긴다.
        L.snapViewKey = null;
        renderBar();
        if (L.panel) snapRenderPanel();
        L.snapViewKey = viewKey;
        return;
      }
      renderBar();
      if (L.panel) renderPanel();
    });
  }
  // 턴 이름: 달 턴이면 "2027년 3월 (3/12)", 계절 라운드면 "2 / 4라운드 · 여름"
  function turnLabel(rd, n, tot, short) {
    if (rd && rd.month) return short ? `${rd.month}월 (${n}/${tot})` : `${rd.year}년 ${rd.month}월 (${n}/${tot}달) · ${SEASON_NAME[rd.season]}`;
    return short ? `${n}/${tot}R · ${SEASON_NAME[rd.season]}` : `${n} / ${tot}라운드 · ${SEASON_NAME[rd.season]}`;
  }
  const resLabel = res => (res.month ? `${res.year}년 ${res.month}월(대표 ${res.days}일 운영)` : `${res.round}라운드 · ${SEASON_NAME[res.season]} ${res.days}일`);
  function curRound() { const V = L.snap, RS0 = V ? C.roundsOf(V) : R().rounds; return RS0[Math.max(0, (V ? V.round : 1) - 1)] || RS0[0]; }
  function isEmptyDoc() { const d = L.doc, st = d && d.maps[d.map]; return !st || (!st.builds.length && !st.lines.length); }
  function adoptPlan(me) {
    const st = L.doc.maps[L.doc.map];
    Object.assign(st, { builds: me.plan.builds || [], lines: me.plan.lines || [], policies: me.plan.policies || [], shed: me.plan.shed || "home", fab2: !!me.plan.fab2, rq: (me.plan.rq || []).slice() });
    L.rev = me.rev;
    mountCity(L.app);
  }
  // 연출 훅: 계획 단계에 들어오면(달이 바뀔 때·처음 도시에 들어올 때) 내 도시 사건 예보 카드를 띄운다.
  // 문장은 결과 서랍과 같은 evSize를 쓴다. 같은 달 재표시는 fx-turn이 막는다.
  function forecastStart(V) {
    if (!L || L.away || !V || V.phase !== "plan") return;
    const cards = (V.events || []).filter(ev => ev.round === V.round).map(ev => ({ ev, E: C.eventDef(R(), ev.id) })).filter(({ E }) => E && C.hits(R(), E, L.team)).map(({ ev, E }) => ({ id: ev.id, tag: "사건 예보", title: E.name, body: turnText(E.text, V), big: evSize(E, { id: ev.id, round: V.round }, V.teams[L.team]?.fcx?.[ev.id]) }));
    if (!cards.length) return;
    // 계획 단계의 코치 띠·문제 칩이 같은 틱에 그려지므로 두 프레임 뒤(배치가 자리 잡은 뒤)에 띄운다.
    // 그래야 움직임 줄이기에서도 카드가 처음부터 최종 위치에 나타난다.
    const round = V.round, team = L.team;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!L || L.away || L.team !== team || L.snap?.round !== round || L.snap?.phase !== "plan") return;
      KCP.fxTurn?.monthStart({ round, team, view: L.snap, cards, sound: kind => signal(kind) });
    }));
  }
  function phaseChanged(V) {
    KCP.fxTurn?.phase?.(V.phase, V.round);
    if (matchMedia("(max-width: 760px)").matches) BG.closeDrawer?.();
    const live = document.getElementById("lg-live");
    const evn = (V.events || []).filter(x => x.round === V.round).map(x => (C.eventDef(R(), x.id) || {}).name).filter(Boolean);
    const when = V.econ ? `${curRound().month}월` : `${V.round}라운드`;
    const t = V.phase === "plan" ? `${when} 계획 시작${evn.length ? ` · 사건: ${evn.join(", ")}` : " — 짓고 협상해요"}` : V.phase === "review" ? `${when} 결과가 나왔어요` : V.phase === "end" ? "리그가 끝났어요" : PHASE_NAME[V.phase];
    BG.toast(t);
    if (live) live.textContent = t;
    const adopted = techResearch(V, L.team).adopted || [];
    if (V.phase === "plan" && adopted.some(id => !(L.soundAdopted || []).includes(id))) signal("research");
    L.soundAdopted = adopted.slice();
    if (V.phase === "plan" && V.econ) {
      const { d, n } = monthNote(); n.startPolicy = V.teams[L.team].econPol || V.econ.cities[L.team].policy; putData(d);
    }
    if (L.away) return; // 알림만 갱신하고 돌아갈 서랍은 유지한다.
    if (V.phase === "review" || V.phase === "end") {
      BG.clearTrialDisplay?.(); warnUnsentPlan(); openPanel("result");
      const result = V.results.at(-1), team = result?.team[L.team];
      const previous = V.results.find(r => r.round === result?.round - 1), p = previous?.team[L.team];
      // 결과 서랍의 월 환산과 fmt를 그대로 쓴다. 대표 운영일을 늘려 시뮬레이션하지 않는다.
      const mul = result ? resultPeriod(V, result).mul : 1, pm = previous ? resultPeriod(V, previous).mul : 1;
      const summary = team ? [["정전 시간", team.outH * mul, p && p.outH * pm, "시간", 1],
        ["정전", team.unsPct, p?.unsPct, "%", 2], ["CO₂", team.co2Prod * mul, p && p.co2Prod * pm, "t", 0]]
        .map(([label, value, before, unit, digits]) => ({ label, value, unit, format: v => fmt(v, digits),
          direction: before == null || value === before ? "" : value > before ? "up" : "down" })) : [];
      const monthLabel = result?.month ? `${result.month}월` : `${result?.round || V.round}라운드`;
      const events = (V.events || []).filter(ev => ev.round === result?.round && result?.events?.includes(ev.id));
      const cards = result?.events?.length ? [{ tag: "지난달 결산", title: monthLabel,
        body: summary.map(s => `${s.label} ${s.format(s.value)}${s.unit}`).join(" · "), big: "운영 결과" },
        ...events.map(ev => {
          const E = C.eventDef(R(), ev.id);
          if (!E) return null;
          const hit = C.hits(R(), E, L.team), nx = hit ? V.teams[L.team]?.fcx?.[ev.id] : null;
          return { id: ev.id, tag: "사건", title: E.name, body: evReveal(E, ev, nx) || turnText(E.text || "", V), big: evSize(E, ev, nx) || "확정",
            ...(hit ? { forecast: { id: ev.id, tag: "사건 예보", title: E.name, body: turnText(E.text, V), big: evSize(E, { id: ev.id, round: ev.round }, nx) } } : {}) };
        }).filter(Boolean)] : [];
      const hud = summary.slice(1).map((s, i) => ({ el: document.querySelector(i === 1 ? '[data-cap="co2"]' : '[data-cap="power"]'), direction: s.direction }));
      const replayed = KCP.fxTurn?.monthEnd({ round: result?.round || V.round, monthLabel, team: L.team, result, view: V, cards, summary, hud,
        sound: kind => signal(kind === "done" ? "complete" : kind) });
      foldResultDuringReplay(replayed);
      if (!replayed) signal(team?.unsPct > 0 ? "outage" : "complete");
    }
    else if (V.phase === "plan") { signal("month"); BG.clearTrialDisplay?.(); closePanel(); forecastStart(V); }
  }
  function foldResultDuringReplay(replayed) {
    if (!replayed || !matchMedia("(max-width: 760px)").matches ||
        matchMedia("(prefers-reduced-motion: reduce)").matches || KCP.v2?.reduced?.()) return;
    const session = L, panel = document.getElementById("lg-panel"), round = L.snap.round;
    if (!panel || L.panel !== "result") return;
    // monthEnd는 다음 틱의 재계산을 기다릴 때도 true다. playing만으로 종료를 판단하지 않는다.
    const finished = () => {
      const state = KCP.fxTurn?.state?.();
      return !state || state.skipped || state.cardsOpen || (!state.playing && (state.replayed || state.ms === 0));
    };
    if (finished()) return;
    const active = () => L === session && !session.away && session.panel === "result" &&
      session.snap.round === round && ["review", "end"].includes(session.snap.phase) &&
      panel.isConnected && !panel.hidden && document.getElementById("lg-panel") === panel;
    let poll, limit;
    const stop = () => {
      clearInterval(poll); clearTimeout(limit);
      if (session.resultReplayWait === stop) session.resultReplayWait = null;
    };
    const reveal = () => {
      const show = active(); stop();
      if (show) { session.panelFolded = false; renderPanel(); }
    };
    session.resultReplayWait = stop;
    // 접기 직전 그리기에서 시작된 연구 완료 연출 시계를 지워, 펼칠 때 연출이 보이게 한다.
    session.techReveal = null; session.panelFolded = true; renderPanel();
    // 조건이 깨져 멈출 때(탭 전환·관전·다시 그리기)도 접힘을 풀고 다시 그려 결과가 접힌 채 남지 않게 한다.
    const release = () => { stop(); if (L === session && session.panelFolded) { session.panelFolded = false; if (!session.away && session.panel) renderPanel(); } };
    poll = setInterval(() => { if (!active()) release(); else if (finished()) reveal(); }, 100);
    limit = setTimeout(() => { if (active()) reveal(); else release(); }, 6000);
  }
  function lockMsg() {
    if (L?.away) return "관전 중 · 읽기 전용 — 우리 도시로 돌아가 편집해요";
    const V = L && L.snap;
    if (!V) return "";
    return V.phase === "lobby" || V.phase === "plan" ? "" : V.phase === "end" ? "리그가 끝났어요" : turnText("지금은 운영·결과 단계 — 다음 라운드 계획 때 지을 수 있어요", V);
  }
  function trialInput(st, id) {
    const source = L.role === "host" || L.role === "solo" ? L.S : L.snap;
    if (!source?.teams[id]) return null;
    const input = structuredClone({ ...source, events: [], teams: { ...source.teams, [id]: { ...source.teams[id], plan: st } } });
    if (input.econ && input.grid) {
      input.grid = Object.fromEntries(Object.keys(input.teams).map(key => [key,
        input.grid[key]?.entries ? input.grid[key] : input.teams[key].trialGrid || null]));
      if (Object.values(input.grid).every(g => !g)) delete input.grid;
    }
    return input;
  }
  function trialConditions(st, id = L.team) {
    const input = trialInput(st, id);
    return input && C.trialMods ? C.trialMods(input, R(), id) : {};
  }
  // 리그 시험 성적표의 목표 줄(build.js leagueTrialGoals 훅). 시험 입력은 trialInput·C.trialMods가
  // events: []로 만들므로 이번 달 사건을 넣지 않는다 — 그 사실과 예보 범위를 밝힌다.
  function trialGoals(res, id = L.team) {
    const V = L.role === "host" || L.role === "solo" ? L.S : L.snap;
    if (!V?.teams?.[id] || !res) return null;
    const g = C.goalsOf ? C.goalsOf(V) : V.goals || R().goals;
    const rd = C.roundsOf(V)[Math.max(0, (V.round || 1) - 1)] || {}, days = rd.mdays || rd.days;
    const uns = res.tot?.dem > 0 ? 100 * res.unsTotal / res.tot.dem : 0;
    const period = V.econ ? "이번 달" : "이번 라운드", actual = V.econ ? "실제 달은" : "실제 라운드는";
    const rows = Number.isFinite(g?.unsPct) ? [{ name: `정전 · ${period} 목표`, ok: uns <= g.unsPct, val: `시험 ${fmt(uns, 2)}% / 목표 ≤ ${fmt(g.unsPct, 2)}%(지역 공동목표 선)` }] : [];
    const notes = [];
    // D-82 결정 1: 같은 시험 기록이면 gridMWh를 읽고, 다르면 현재 시험 결과로 표시한다.
    // 리그 지도의 수입 설비 출력은 0이라 res.tot.by.import는 gridMWh와 같다. 아래 생산/소비 차이 줄도 같은 값을 쓴다.
    const trial = V.econ ? matchingTrial(V, rd, id) : null;
    const gridMWh = trial?.map === res.map && trial?.seed === res.seed && trial?.days === res.days && Number.isFinite(trial?.gridMWh)
      ? trial.gridMWh : res.tot?.by?.import;
    if (V.econ && Number.isFinite(gridMWh) && res.days > 0 && days > 0) {
      const perDayGrid = gridMWh / res.days, monthlyGrid = perDayGrid * days;
      notes.push(`바깥 계통이 메워 준 전기 시험 ${res.days}일 ${fmt(gridMWh, 1)} MWh → 하루 평균 ${perDayText(perDayGrid)}(이번 달 ${days}일이면 약 ${fmt(monthlyGrid, 1)} MWh · 비용 약 ${fmt(monthlyGrid * params("normalCost") * params("gridImportMarkup"), 2)}억 · 상한·할증은 ${gradeWords("G")})`);
    }
    if (V.econ && Number.isFinite(g?.co2Plan) && res.days > 0 && days > 0)
      notes.push(`CO₂ 생산: 우리 도시 시험 ${fmt(res.tot.co2)} t(${res.days}일) → ${days}일 환산 약 ${fmt(res.tot.co2 * days / res.days)} t. 지역 공동목표 ≤ ${fmt(g.co2Plan)} t는 ${actT(V).length}개 도시의 이번 달 생산 배출 합이에요(계획 시작 때 확정).`);
    if (V.econ && Number.isFinite(g?.co2Plan) && res.days > 0 && days > 0 && Number.isFinite(res.tot?.co2))
      notes.push(`위 CO₂는 생산 배출이라 머리 칩(소비 기준)과 다를 수 있어요. 차이는 바깥 계통에서 받은 전기의 배출${Number.isFinite(gridMWh) ? `(${res.days}일 시험 약 ${fmt(gridMWh * params("normalCo2"))} t)` : ""}이에요.`);
    const evs = (V.events || []).filter(ev => ev.round === V.round).map(ev => ({ ev, E: C.eventDef(R(), ev.id) })).filter(x => x.E && C.hits(R(), x.E, id));
    const names = evs.map(({ ev, E }) => { const size = evSize(E, { id: ev.id, round: ev.round }, V.teams[id]?.fcx?.[ev.id]); return size ? `${E.name} · 예보 ${size}` : E.name; });
    notes.push(names.length ? `시험에는 ${period} 확정 사건(${names.join(", ")})과 우리 대응이 들어 있지 않아요 — ${actual} 달라질 수 있어요.` : `${period} 우리 도시에 해당하는 사건이 없어요. 시험과 실제는 날씨·운전 기간·이웃 거래로 달라질 수 있어요.`);
    // 원문 문자열은 기존 기록·검산용으로 유지하고, 표시할 때만 보충 설명을 접는다.
    const noteDetails = notes.map(text => {
      if (text.startsWith("바깥 계통이 메워 준 전기")) {
        const split = text.indexOf(" · 상한·할증은 ");
        return split < 0 ? null : { key: "grid-assumption", visible: text.slice(0, split) + ")", detail: text.slice(split + 3, -1), label: "바깥 계통 상한·할증" };
      }
      if (text.startsWith("CO₂ 생산:")) {
        const split = text.indexOf(" t는 ");
        return split < 0 ? null : { key: "co2-goal", visible: text.slice(0, split + 2), detail: text.slice(split + 4), label: "지역 공동목표" };
      }
      return null;
    });
    return { rows, notes, noteDetails, cause: noSupplyCause(uns, planIssueCounts()), causeNote: SUPPLY_ASSUMPTION() };
  }
  function lastOutageRisk(V, id) {
    if (V?.phase !== "plan") return null;
    const result = V?.results?.at(-1)?.team[id];
    if (!Number.isFinite(result?.unsPct)) return null;
    const goal = (C.goalsOf(V) || V.goals).unsPct;
    const rd = C.roundsOf(V)[Math.max(0, (V.round || 1) - 1)];
    const trial = rd && matchingTrial(V, rd, id);
    return result.unsPct > goal || !!trial && trial.unsPct > goal;
  }
  function trialGrid(st, id = L.team) {
    const input = trialInput(st, id);
    return input?.econ ? withCityPack(id, () => C.gridStatus(input, R(), BG, id, true)) : null;
  }
  // 태블릿의 마을별 보정값 대신 이미 공개된 도시 합계만 사용한다(D-65·D-66).
  function cityTownLook(V, id) {
    const city = V?.econ?.cities?.[id];
    if (!Number.isFinite(city?.pop) || !(city.pop0 > 0) || !Number.isFinite(city.pop0)) return null;
    const r = city.pop / city.pop0;
    const steps = Math.floor((Math.abs(r - 1) + 1e-9) / 0.02);
    const houses = Math.max(-3, Math.min(3, r >= 1 ? steps : -steps)) || 0;
    const uns = V.results?.at(-1)?.team?.[id]?.unsPct;
    return { houses, darkShare: Number.isFinite(uns) ? Math.max(0, Math.min(1, uns / 100)) : null };
  }
  // staticChanged 기본값 true: 공개 상태가 올 때마다 정적 층을 다시 그리던 기존 동작을 유지한다.
  function refreshCityTownLook(V, id, staticChanged = true) {
    const canvas = document.getElementById("bd-canvas"), sr = document.getElementById("bd-town-look-sr"), look = cityTownLook(V, id), city = V?.econ?.cities?.[id];
    if (canvas && look) {
      const pct = (city.pop / city.pop0 - 1) * 100;
      const text = `주민 시작 대비 ${pct >= 0 ? "+" : ""}${fmt(pct, 2)}% · ${look.darkShare == null ? "아직 운영 결과 없음" : `최근 운영한 달에 못 보낸 전기 ${fmt(look.darkShare * 100, 2)}%`}. 집 한 채 = 시작 주민 2%, 회색 빈집 = 2% 줄어듦, 최대 3채 · 불 꺼진 창 = 못 보낸 전기 몫. 마을별 인구가 아니라 도시 전체 변화를 모든 마을에 똑같이 보인 것이에요.`;
      canvas.dataset.townPopPct = String(pct);
      canvas.dataset.townUnsPct = look.darkShare == null ? "" : String(look.darkShare * 100);
      // 캔버스에는 이미 aria-describedby(bd-keys)가 있어 aria-description은 낭독되지 않을 수 있다. 숨은 문단을 함께 잇는다.
      canvas.setAttribute("aria-description", text);
      if (sr) { sr.textContent = text; canvas.setAttribute("aria-describedby", "bd-keys bd-town-look-sr"); }
    } else if (canvas) {
      delete canvas.dataset.townPopPct; delete canvas.dataset.townUnsPct;
      canvas.removeAttribute("aria-description");
      if (sr) sr.textContent = "";
      canvas.setAttribute("aria-describedby", "bd-keys");
    }
    BG.refresh({ static: staticChanged });
  }
  function mountCity(app, resume, view) {
    L.soundAdopted = (techResearch(L.snap, L.team).adopted || []).slice();
    if (!L.snap?.teams[L.team]) return;
    teamSave();
    const reg = R(), t = C.teamDef(reg, L.team), s = tdata();
    const raw = s.docs[t.pack];
    // 건설 화면의 저장 문서 모양({v, map, maps, journal ...})을 이 도시 하나로 쓴다.
    BG.selectPack(t.pack, "league");
    if (!resume) {
      const st = BG.sanitize(raw && raw.maps ? raw.maps[t.pack] : L.snap.teams[L.team].plan || null, 1e9);
      if (techData() && L.snap?.teams[L.team]?.plan) st.rq = (L.snap.teams[L.team].plan.rq || []).slice();
      L.doc = { v: 2, map: t.pack, maps: { [t.pack]: st }, runs: raw && Number.isInteger(raw.runs) ? raw.runs : 0, jAuto: true, journal: raw && Array.isArray(raw.journal) ? raw.journal : [] };
      L.rev = Math.max(L.rev, s.rev || 0);
    }
    app.querySelector("main.lg-lobby")?.remove();
    replaceTeamMap(app);
    BG.mount(app, {
      packs: [t.pack], league: true, solo: L.role === "solo", view,
      townLook: () => cityTownLook(L.snap, L.team),
      onFx: kind => signal(kind),
      load: () => L.doc,
      save: doc => { if (L.away) return; const z = tdata(); z.docs[t.pack] = { maps: doc.maps, runs: doc.runs, journal: doc.journal }; z.rev = L.rev; putData(z); },
      // 남은 예산 = 예산 − 철거 손실·사건 대응(fixed) − 이번에 지난 라운드 것을 뜯어 생긴 손실
      budget: () => { const me = L.snap && L.snap.teams[L.team]; return me ? me.budget - (me.fixed || 0) - C.researchReserve(L.snap, L.team, BG, BG.current()) - C.lossOf(me.base, BG.current()) : 0; },
      research: () => { const me = L.snap && L.snap.teams[L.team]; return (me && (me.research || me.rs)) || { prog: {}, stage: {}, adoptR: {} }; },
      salvage: key => { const me = L.snap && L.snap.teams[L.team]; return me && (me.base || []).some(x => x.k === key) ? C.SALV : 1; },
      locked: lockMsg,
      season: () => curRound().season,
      leagueRound: curRound,
      leagueTurnLabel: n => { const rd = C.roundsOf(L.snap)[n - 1]; return rd?.month ? `${rd.year}년 ${rd.month}월` : `${n}라운드`; },
      leagueMods: trialConditions,
      leagueGrid: trialGrid,
      leagueOutageRisk: () => lastOutageRisk(L.snap, L.team),
      leagueTrialGoals: res => trialGoals(res),
      leagueLensStamp: () => L.snap?.rev,
      trialScope: trialScope(L.team),
      onChange: () => {
        if (L.away) return;
        if (L.snap?.econ) { const { d, n } = monthNote(); n.confirmed = false; n.buildCost = newBuildCost(L.snap); n.buildBudget = L.snap.teams[L.team].budget; n.research = (BG.current()?.builds || []).some(b => ["uni", "lab"].includes(b.t) && !(L.snap.teams[L.team].base || []).some(item => item.k === C.itemKey("b", b))); putData(d); }
        L.rev++; const z = tdata(); z.rev = L.rev; putData(z); clearTimeout(L.planT);
        // 혼자 하기는 같은 탭에서 즉시 반영한다. 이탈 때 취소되는 전송 타이머를 기다리지 않는다.
        if (L.role === "solo") sendPlan(); else L.planT = setTimeout(sendPlan, 400); },
      onTrial: () => { closePanel(); if (L.snap?.econ && curRound().month === 1 && !monthNote().n.baselineSeen) { const { d, n } = monthNote(); n.baselineSeen = true; putData(d); } },
      onHelp: () => openPanel("help"),
      onDrawer: closePanel,
      onTool: closePanel,
      // Esc 도구 취소(D-83)는 서랍을 닫지 않는다. 키 처리 순서와 무관하게 송전선 표시 상태만 맞춘다.
      onToolCancel: () => { const map = document.querySelector(".lg-team-map[data-line-tool]"); if (map) map.dataset.lineTool = "false"; },
      leagueResultDays: () => L.snap?.results.at(-1)?.days,
      leagueResult: () => { const res = L.snap?.results.at(-1); return res?.team[L.team] ? { ...res.team[L.team], faded: L.snap.phase === "plan", round: res.round, month: res.month || C.roundsOf(L.snap)[res.round - 1]?.month, days: res.days } : null; },
      onMount: root => { refreshCityTownLook(L.snap, L.team); addBar(root); setupTeamMap(root); warnTeamSave(); window.dispatchEvent(new Event("resize")); }
    });
    if (resume) {
      if (L.coach) showFirstGuide(document.getElementById("bd-root"));
      forecastStart(L.snap);
      return;
    }
    send("claim");
    sendPlan();
    showFirstGuide(document.getElementById("bd-root"));
    forecastStart(L.snap);
  }
  function warnUnsentPlan() {
    const V = L?.snap;
    if (!V || L.role === "solo" || V.teams[L.team]?.rev >= L.rev || L.unsentRound === V.round) return;
    L.unsentRound = V.round;
    BG.toast(turnText("마지막 편집은 이번 라운드 운영에 반영되지 않았어요.", V));
  }
  function sendPlan() {
    if (L?.techPending) return; // 승인 전에 예전 rq로 연구 요청을 덮어쓰지 않는다.
    if (!L || L.away || !["lobby", "plan"].includes(L.snap?.phase)) return;
    const st = L.doc?.maps[L.doc.map];
    if (!st || !L.team || L.snap.teams[L.team]?.rev >= L.rev && L.snap.teams[L.team]?.plan) return;
    send("plan", { rev: L.rev, plan: { builds: st.builds, lines: st.lines, policies: st.policies, shed: st.shed, fab2: st.fab2, missions: st.missions, seed: st.seed, season: st.season, rq: st.rq || [] } });
  }
  // U5: 편집 문서는 L.doc에만 보관한다. BG.current는 관전 전용 사본일 수 있다.
  function leaveTeamCity() {
    if (L.away) return;
    const panel = document.getElementById("lg-panel"), root = document.getElementById("bd-root");
    L.home = { panel, scroll: panel?.querySelector(".lg-pbody")?.scrollTop || 0, phase: L.snap?.phase, round: L.snap?.round,
      view: BG.saveView(), group: root?.querySelector('[data-group][aria-expanded="true"]')?.dataset.group,
      layer: root?.querySelector('[data-layer][aria-pressed="true"]')?.dataset.layer,
      drawer: root?.querySelector('#bd-pm')?.getAttribute("aria-expanded") === "true",
      tab: root?.querySelector('[data-tab][aria-pressed="true"]')?.dataset.tab };
    panel?.remove(); // 입력값·선택·스크롤과 리스너까지 그대로 보존한다.
    clearTimeout(L.planT); L.planT = 0;
    L.away = "region";
    mountTeamPeek(L.team); // 실행 중인 시험 운전도 정리하고 읽기 전용 사본으로 전환한다.
  }
  function awayBar(root, peek) {
    document.querySelectorAll("#lg-bar").forEach(el => el.remove());
    const bar = document.createElement("header");
    bar.id = "lg-bar"; bar.className = peek ? "lg-bar lg-awaybar" : "lg-awaybar";
    bar.innerHTML = `<strong>${peek ? `${esc(teamName(L.away))} 관전 중 · 읽기 전용` : "지역 지도"}</strong>
      <div class="lg-awaystatus"><span id="lg-bround"></span><span id="lg-bphase"></span><b class="lg-timer" id="lg-timer"></b></div>
      <div class="lg-awayactions">${peek ? '<button type="button" class="lg-bbtn" id="lg-peek-region">지역 지도로</button>' : ""}
      <button type="button" class="lg-bbtn" id="${peek ? "lg-peek-back" : "lg-region-back"}">우리 도시로</button>
      <button type="button" class="lg-bbtn" id="lg-ready" disabled>준비</button></div>
      <p class="lg-awaylive" id="lg-live" role="status" aria-live="polite"></p>`;
    root.prepend(bar);
    bar.querySelector(peek ? "#lg-peek-back" : "#lg-region-back").onclick = returnTeamCity;
    bar.querySelector("#lg-peek-region")?.addEventListener("click", teamRegion);
    updateAwayStatus();
  }
  function updateAwayStatus() {
    const V = L.snap;
    if (!V) return;
    const round = document.getElementById("lg-bround"), phase = document.getElementById("lg-bphase");
    if (round) round.textContent = turnLabel(curRound(), V.round, C.roundsOf(V).length, true);
    if (phase) phase.textContent = PHASE_NAME[V.phase];
    tickTimer();
  }
  function replaceTeamMap(app) {
    // build.mount는 append 방식이다. 팀이 다시 mount할 때 숨긴 이전 루트도 제거한다.
    // 돌아갈 입력 서랍은 leaveTeamCity가 L.home.panel로 따로 보존한다.
    L.hudObserver?.disconnect(); L.barObserver?.disconnect(); L.syncMoney = null;
    app.querySelectorAll("#bd-root, #lg-region").forEach(el => el.remove());
  }
  function mountTeamPeek(id) {
    const t = C.teamDef(R(), id);
    BG.selectPack(t.pack, "league");
    const st = BG.sanitize(L.snap?.teams[id]?.plan || {}, 1e9);
    replaceTeamMap(L.app);
    BG.mount(L.app, { packs: [t.pack], league: true,
      townLook: () => cityTownLook(L.snap, id),
      load: () => ({ v: 2, map: t.pack, maps: { [t.pack]: st }, runs: 0, jAuto: true, journal: [] }),
      save: () => {}, locked: () => "관전 중 · 읽기 전용", season: () => curRound().season, leagueRound: curRound,
      budget: () => L.snap.teams[id].left + BG.capex(BG.current()),
      ...(L.snap?.econ ? { leagueMods: st => trialConditions(st, id), leagueGrid: st => trialGrid(st, id), leagueOutageRisk: () => lastOutageRisk(L.snap || C.publicView(L.S, Date.now()), id), leagueTrialGoals: res => trialGoals(res, id), trialScope: trialScope(id) } : {}),
      onMount: root => {
        refreshCityTownLook(L.snap, id);
        root.classList.add("lg-peek");
        setupTeamMap(root, id);
        root.querySelectorAll("#lg-peek").forEach(el => el.remove());
        const peek = document.createElement("section"); peek.id = "lg-peek";
        root.append(peek); awayBar(peek, true);
        // 건설 도구·정책·시험 운전은 관전에서 접근하지 않는다. 지도 확대·드래그는 유지한다.
        root.querySelectorAll("#bd-dock, #bd-drawer").forEach(el => {
          el.inert = true; el.querySelectorAll("button, input, select").forEach(control => { control.disabled = true; });
        });
        window.dispatchEvent(new Event("resize"));
      }
    });
  }
  function teamPeek(id) {
    if (!L.snap?.teams[id]) return;
    if (id === L.team) { returnTeamCity(); return; }
    leaveTeamCity(); L.regionObserver?.disconnect(); L.away = id;
    mountTeamPeek(id);
    document.getElementById("lg-peek-back")?.focus();
  }
  function teamRegion() {
    if (!boardInfo() || !L.snap) return;
    leaveTeamCity(); L.away = "region";
    L.regionObserver?.disconnect();
    document.getElementById("lg-region")?.remove();
    const root = document.getElementById("bd-root");
    root.hidden = true; root.inert = true;
    root.querySelectorAll("#lg-peek, #lg-bar").forEach(el => el.remove());
    const region = document.createElement("main"); region.id = "lg-region"; region.className = "lg-region";
    region.innerHTML = `<div class="lg-regiontools"><button type="button" class="lg-bbtn" data-region-zoom="1" aria-label="지역 지도 확대">＋</button>
      <button type="button" class="lg-bbtn" data-region-zoom="-1" aria-label="지역 지도 축소">−</button><span>확대 후 드래그로 이동 · 아래 도시 버튼으로도 관전</span></div>
      <div class="lg-regionviewport"><div class="lg-regionboard"><canvas id="lg-regionmap" class="lg-mapc" role="img" aria-label="도시별 설비·송전선·거래·이주 지도" aria-describedby="lg-regioncap"></canvas><div class="lg-regionlabels"></div></div></div>
      <p id="lg-regioncap" class="lg-regioncap"></p><nav class="lg-regioncities" aria-label="관전할 도시">${actT(L.snap).map(t => `<button type="button" class="lg-regioncity" data-region-city="${esc(t.id)}" style="--c:${esc(t.color)}"><b>${esc(t.name)}${t.id === L.team ? " · 우리 도시" : ""}</b><span></span></button>`).join("")}</nav>`;
    L.app.append(region); awayBar(region, false);
    region.querySelectorAll("[data-region-city]").forEach(b => b.onclick = () => teamPeek(b.dataset.regionCity));
    const viewport = region.querySelector(".lg-regionviewport"), cv = region.querySelector("canvas");
    L.regionZoom = 1;
    let drag = null;
    region.querySelectorAll("[data-region-zoom]").forEach(b => b.onclick = () => {
      L.regionZoom = Math.max(1, Math.min(3, L.regionZoom + Number(b.dataset.regionZoom) * 0.5));
      updateTeamRegion();
    });
    viewport.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved ||= Math.hypot(dx, dy) > 6;
      viewport.scrollLeft = drag.left - dx; viewport.scrollTop = drag.top - dy;
    });
    viewport.addEventListener("pointerup", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved; drag = null;
      viewport.releasePointerCapture(e.pointerId);
      if (!moved) teamPeek(boardHit(cv, e));
    });
    viewport.addEventListener("pointercancel", () => { drag = null; });
    L.regionObserver = new ResizeObserver(() => { if (L?.away === "region") updateTeamRegion(); });
    L.regionObserver.observe(viewport);
    updateTeamRegion(); document.getElementById("lg-region-back").focus();
  }
  function regionSummary(V, id) {
    const v = V.teams[id], r = V.results.at(-1)?.team[id], c = V.econ?.cities[id];
    return `설비 ${fmt(v.plan?.builds?.length || 0)}개 · 정전 ${r ? fmt(r.unsPct, 1) + "%" : "결과 대기"}${c ? ` · 지지율 ${fmt(c.approval, 1)}% · 주민 ${signed(V.econ.report?.cities[id]?.dPop || 0)}명` : ""}`;
  }
  function updateTeamRegion() {
    const region = document.getElementById("lg-region"), V = L.snap, G = boardInfo();
    if (!region || !V) return;
    const viewport = region.querySelector(".lg-regionviewport");
    const baseWidth = Math.min(viewport.clientWidth, viewport.clientHeight * G.W / G.H);
    region.querySelector(".lg-regionboard").style.width = `${baseWidth * L.regionZoom}px`;
    const cv = region.querySelector("canvas"), zoom = cv.clientWidth / baseWidth;
    const drawnLabels = renderBoard(cv, V, V.results.at(-1), false, null, zoom);
    const labels = drawnLabels.map(b => ({ ...b, x: b.x / zoom, y: b.y / zoom, width: b.width / zoom, height: b.height / zoom }));
    const overlay = region.querySelector(".lg-regionlabels");
    overlay.style.width = baseWidth + "px"; overlay.style.height = G.H * baseWidth / G.W + "px";
    overlay.style.transform = `scale(${zoom})`;
    overlay.innerHTML = actT(V).map(t => {
      // SUMMARY_JS는 innerText를 읽는다. 이름은 생성 텍스트라 기존 목록의 요약 후보 수를 늘리지 않는다.
      return `<span class="lg-regionlabel" style="--c:${esc(t.color)}"><span class="lg-regionlabel-name" aria-hidden="true" aria-label="${esc(t.name)}"></span>${esc(regionSummary(V, t.id))}</span>`;
    }).join("");
    const nodes = [...region.querySelectorAll(".lg-regionlabel")], cities = actT(V), k = +cv.dataset.k / zoom;
    const measure = () => nodes.map((el, i) => ({ id: cities[i].id, x: G.cen[cities[i].id][0] * k,
      y: G.cen[cities[i].id][1] * k, width: el.offsetWidth, height: el.offsetHeight }));
    const bounds = { width: baseWidth, height: G.H * baseWidth / G.W };
    let cards = measure(), placed = KCP.fxRegion.placeCards(cards, labels, bounds);
    if (placed.length !== nodes.length) {
      // 좁은 창·큰 숫자에서만 글자와 폭을 줄이고 실제 크기를 다시 측정한다.
      nodes.forEach(el => { el.style.fontSize = "10px"; el.style.width = Math.min(108, bounds.width * .3) + "px"; });
      cards = measure(); placed = KCP.fxRegion.placeCards(cards, labels, bounds);
    }
    const g = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    g.save(); g.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    placed.forEach((p, i) => {
      const el = nodes[i], anchor = cards[i];
      el.style.left = p.x + "px"; el.style.top = p.y + "px";
      const x = Math.max(p.x, Math.min(p.x + p.width, anchor.x)), y = Math.max(p.y, Math.min(p.y + p.height, anchor.y));
      // 도시명 바깥부터 연결해 이름표와 기호를 선으로 덮지 않는다.
      const box = labels.find(b => b.kind === "city" && b.id === anchor.id);
      const dx = x - anchor.x, dy = y - anchor.y;
      let start = 0;
      if (box) start = Math.min(dx > 0 ? (box.x + box.width - anchor.x) / dx : dx < 0 ? (box.x - anchor.x) / dx : Infinity,
        dy > 0 ? (box.y + box.height - anchor.y) / dy : dy < 0 ? (box.y - anchor.y) / dy : Infinity);
      if (start >= 1) return;
      g.beginPath(); g.moveTo(anchor.x + dx * start, anchor.y + dy * start); g.lineTo(x, y);
      g.strokeStyle = "rgba(20,36,30,.85)"; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = cities[i].color; g.lineWidth = 1; g.stroke();
    });
    // 물리적으로 들어가지 않는 극소 영역에서는 아래 도시 목록을 대안으로 둔다.
    if (!placed.length) nodes.forEach(el => { el.hidden = true; });
    g.restore();
    KCP.fxRegion.recordLayout(cv, { cards: placed.map(p => ({ ...p, x: p.x * zoom, y: p.y * zoom, width: p.width * zoom, height: p.height * zoom })) });
    region.querySelectorAll("[data-region-city]").forEach(b => { b.querySelector("span").textContent = regionSummary(V, b.dataset.regionCity); });
    const moves = (V.econ?.report?.flows.pop || []).slice().sort((a, b) => b.n - a.n).slice(0, IQ.quarter);
    const movement = moves.map(f => `${teamName(f.from)} → ${teamName(f.to)} ${fmt(f.n)}명: ${migrationReason(f)}`).join(" · ");
    region.querySelector("#lg-regioncap").textContent = [KCP.fxRegion.legend, movement,
      placed.length < nodes.length ? "지도 아래 도시 목록에서 보기" : ""].filter(Boolean).join("\n");
  }
  function updateTeamAway() {
    updateAwayStatus();
    if (L.away === "region") { updateTeamRegion(); return; }
    const t = C.teamDef(R(), L.away), st = BG.current();
    if (!t || !st) return;
    BG.selectPack(t.pack, "league");
    Object.assign(st, BG.sanitize(L.snap.teams[L.away]?.plan || {}, 1e9));
    BG.setSeason(curRound().season); refreshCityTownLook(L.snap, L.away);
    document.querySelectorAll(".lg-peek #bd-drawer button, .lg-peek #bd-drawer input").forEach(el => { el.disabled = true; });
  }
  function returnTeamCity() {
    if (!L.away) return;
    const home = L.home;
    L.regionObserver?.disconnect(); L.away = null; L.home = null;
    // mountCity는 저장본으로 덮거나 claim/plan을 보내지 않고 같은 L.doc를 다시 연결한다.
    mountCity(L.app, true, home?.view);
    if (home?.panel) {
      document.getElementById("lg-panel")?.replaceWith(home.panel);
      const restoreScroll = () => { const body = home.panel.querySelector(".lg-pbody"); if (body) body.scrollTop = home.scroll; };
      restoreScroll();
      // 재생 중 접어 둔 서랍을 관전 동안 풀었으면 돌아올 때 다시 그린다.
      const unfolded = home.panel.dataset.folded === "true" && !L.panelFolded;
      if (unfolded || home.phase !== L.snap?.phase || home.round !== L.snap?.round) { renderPanel(); restoreScroll(); }
      syncResultMapSpace();
    }
    const root = document.getElementById("bd-root");
    if (home?.layer) root.querySelector(`[data-layer="${home.layer}"]`)?.click();
    if (home?.group && root.querySelector(`[data-group="${home.group}"]`)?.getAttribute("aria-expanded") !== "true") root.querySelector(`[data-group="${home.group}"]`)?.click();
    if (home?.drawer) root.querySelector("#bd-pm")?.click();
    if (home?.tab) root.querySelector(`[data-tab="${home.tab}"]`)?.click();
    document.querySelectorAll(".lg-bar [data-panel]").forEach(b => b.setAttribute("aria-expanded", String(b.dataset.panel === L.panel)));
    document.querySelector('[data-panel="region"]')?.focus();
    // 관전 중 취소한 내 계획만 복귀 후 재전송한다. 관전 사본은 절대 보내지 않는다.
    if (L.snap?.teams[L.team]?.rev < L.rev && !lockMsg()) sendPlan();
    L.conn.flush?.();
  }

  function syncLastOutage(root, V, id) {
    const hud = root.querySelector("#bd-hud"), power = hud?.querySelector('[data-cap="power"]');
    if (!hud || !power) return;
    const pct = V?.results.at(-1)?.team[id]?.unsPct, outage = Number.isFinite(pct) && pct >= ZERO_OUTAGE_PCT;
    hud.dataset.lastOutage = String(outage);
    const note = outage ? `지난달 정전 ${pct < 0.05 ? "0.1% 미만" : `${fmt(pct, 1)}%`}` : null;
    const label = note ? `${power.textContent.trim()} · ${note}` : null;
    for (const [key, text] of [["title", note], ["aria-label", label]]) {
      if (text === null) power.removeAttribute(key);
      else if (power.getAttribute(key) !== text) power.setAttribute(key, text);
    }
    // build.refreshHUD가 title을 다시 써도 기존 관찰자의 syncMoney에서 설명을 복원한다.
    L.hudObserver?.observe(power, { attributes: true, attributeFilter: ["title"] });
  }
  function setupTeamMap(root, id = L.team) {
    root.classList.add("lg-team-map");
    // 자료 지도만 접는다. 녹화·검사에서 쓰는 세 렌즈는 항상 펼침 밖에 둔다.
    const layers = root.querySelector(".bd-layers");
    if (layers && !layers.querySelector(".lg-map-views")) {
      const views = document.createElement("details"); views.className = "lg-map-views";
      const summary = document.createElement("summary"); summary.className = "bd-layer"; summary.textContent = "지도 보기";
      const choices = document.createElement("div"); choices.className = "lg-map-choices";
      layers.querySelectorAll("[data-layer]").forEach(button => choices.append(button));
      views.append(summary, choices); layers.prepend(views);
      views.addEventListener("click", e => {
        if (!e.target.closest("[data-layer]")) return;
        views.open = false; summary.focus({ preventScroll: true });
      });
    }
    // 저장된 켜짐 설정으로 재진입해도 지도 조작 전에 잠금을 푼다(터치는 pointerup에서 활성화).
    ["pointerup", "click", "keydown"].forEach(name => root.addEventListener(name, unlockAudio, true));
    root.dataset.lineTool = "false";
    const syncTool = () => { root.dataset.lineTool = String(!!root.querySelector('[data-tool="line"][aria-pressed="true"]')); };
    root.addEventListener("click", e => { if (e.target.closest("#bd-pm, [data-group], [data-run]")) closePanel(); queueMicrotask(syncTool); });
    root.addEventListener("keydown", () => queueMicrotask(syncTool));
    syncTool();
    L.hudObserver?.disconnect();
    const money = root.querySelector('[data-cap="budget"]');
    if (L.snap?.econ && money && !money.querySelector(".lg-debt-note")) {
      const note = document.createElement("small"); note.className = "lg-debt-note"; note.textContent = "(빚 한도 포함)"; money.querySelector(".v2-cap-txt").append(note);
    }
    const syncMoney = () => {
      const value = money?.querySelector("[data-v]"), label = money?.querySelector(".v2-cap-k");
      if (label && label.textContent !== "남은 돈") label.textContent = "남은 돈";
      const text = `${fmt(L.snap?.teams[id]?.left, 1)}억`;
      if (value && value.textContent !== text) value.textContent = text;
      if (value) value.dataset.money = "left";
      if (money && L.snap?.econ) {
        const description = `남은 돈 ${text} (빚 한도 포함)`;
        money.title = description; money.setAttribute("aria-label", description);
      }
      syncLastOutage(root, L.snap, id);
    };
    root.querySelectorAll('[data-cap]').forEach(cap => {
      // 같은 서랍을 여는 중복 바로가기는 숫자 표시로 둔다(도움말·결과·도시는 막대에서 연다).
      if (!["budget", "power"].includes(cap.dataset.cap)) return;
      cap.setAttribute("role", "button"); cap.tabIndex = 0;
      const tab = { budget: "deal", power: "city" }[cap.dataset.cap];
      cap.addEventListener("click", () => openPanel(tab));
      cap.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); openPanel(tab); } });
    });
    const cp = root.querySelector('[data-cap="cp"] [data-v]');
    const drawer = root.querySelector("#bd-drawer");
    const syncPolicy = () => {
      const text = drawer?.querySelector('[data-pol="share"] .bd-card-txt > span');
      const value = `모든 민원의 만족 감점 ${fmt((1 - params("shareRelief")) * 100)}%(${gradeWords("G")}) · 민원 건수와 별도`;
      if (L.snap?.econ && text && text.textContent !== value) text.textContent = value;
    };
    const syncComplaints = () => {
      const value = `${BG.complaints(BG.current(), null).issues}건`;
      if (cp && cp.textContent !== value) cp.textContent = value;
    };
    // HUD 콜백은 돈과 지금 지도의 민원을 함께 맞춘다.
    L.hudObserver?.disconnect();
    L.hudObserver = new MutationObserver(() => { syncMoney(); syncComplaints(); syncPolicy(); });
    if (money) L.hudObserver.observe(money, { childList: true, characterData: true, subtree: true });
    if (cp) L.hudObserver.observe(cp, { childList: true, characterData: true, subtree: true });
    if (drawer) L.hudObserver.observe(drawer, { childList: true, characterData: true, subtree: true });
    L.syncMoney = () => { syncMoney(); syncComplaints(); syncPolicy(); }; L.syncMoney();
    root.querySelectorAll('[data-cap="co2"] .v2-cap-k').forEach(el => { el.textContent = "CO₂ 시험·소비"; el.title = "CO₂ 시험 운전 · 소비 기준(계통에서 받은 전기 포함)"; el.setAttribute("aria-label", el.title); });
    root.querySelectorAll('[data-cap="cp"] .v2-cap-k').forEach(el => { el.textContent = "민원 지금"; el.title = "민원(지금 지도 기준)"; el.setAttribute("aria-label", el.title); });
  }
  function addBar(root) {
    // 새로고침 뒤 도시 지도가 두 번 붙으면 막대·서랍이 겹친다 — 붙이기 전에 예전 것을 지운다.
    for (const id of ["lg-bar", "lg-panel"]) document.getElementById(id)?.remove();
    const bar = document.createElement("div");
    bar.className = "lg-bar";
    bar.dataset.econ = String(!!L.snap?.econ);
    bar.id = "lg-bar";
    bar.style.setProperty("--c", teamCol(L.team));
    bar.innerHTML = `<div class="lg-status"><span class="lg-bteam">${esc(teamName(L.team))}</span>
      <span class="lg-bround" id="lg-bround"></span>
      <span class="lg-bmoney" aria-hidden="true">남은 돈 <b id="lg-left-hud" data-money="left"></b></span>
      <span class="lg-bphase" id="lg-bphase"></span><span id="lg-hud-chips"></span><span id="lg-watch" aria-label="이번 달 볼 것"></span><b class="lg-timer num" id="lg-timer"></b>
      <span class="lg-conn" id="lg-conn" data-s="${esc(L.conn.status())}">${connLabel(L.conn.status())}</span>${dataChipHTML()}</div>
      <div class="lg-actions"><button type="button" class="lg-bbtn" data-panel="deal">이웃·거래<b class="lg-badge" id="lg-badge" hidden></b></button>
      <button type="button" class="lg-bbtn" data-panel="region">지역 지도</button>
      <button type="button" class="lg-bbtn" data-panel="tech">연구</button>
      <button type="button" class="lg-bbtn" data-panel="result">결과</button>
      <button type="button" class="lg-bbtn" data-panel="journal">일지</button>
      ${L.snap?.econ ? `<button type="button" class="lg-bbtn" data-panel="city">도시</button><button type="button" class="lg-bbtn" data-panel="rank">순위</button>` : ""}
      </div><button type="button" class="v2-btn primary lg-readybtn" id="lg-ready" aria-pressed="false">준비</button>
      <p id="lg-plan-co2" hidden></p>
      <p class="lg-sr" id="lg-live" aria-live="polite"></p>`;
    root.append(bar);
    setupMapGuidance(root);
    const panel = document.createElement("aside");
    panel.className = "lg-panel";
    panel.dataset.econ = String(!!L.snap?.econ);
    panel.id = "lg-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "리그");
    root.append(panel);
    L.barObserver?.disconnect();
    L.barObserver = new ResizeObserver(() => { if (bar.isConnected) window.dispatchEvent(new Event("resize")); });
    L.barObserver.observe(bar);
    bar.addEventListener("click", e => {
      unlockAudio();
      const hud = e.target.closest("[data-hud-panel]"); if (hud) { openPanel(hud.dataset.hudPanel); return; }
      const p = e.target.closest("[data-panel]");
      if (p?.dataset.panel === "region") { teamRegion(); return; }
      if (p) {
        // 접힌 서랍(재생 중 자동 접힘 포함)의 같은 단추는 닫지 않고 펼친다.
        if (L.panel === p.dataset.panel && L.panelFolded) { L.resultReplayWait?.(); L.panelFolded = false; renderPanel(); return; }
        L.panel === p.dataset.panel ? closePanel() : openPanel(p.dataset.panel); return;
      }
      if (e.target.closest("#lg-ready")) {
        // 약속을 다 채웠으면 막대 단추도 확정이다. 덜 채운 자유 실험 달에만 다시 누르기 = 건너뛰기(ECON-UI v1.1).
        const confirm = document.getElementById("lg-ready-confirm"), complete = !!confirm && !confirm.disabled;
        readyAction(!complete && !!L.awaitReady && L.panel === "journal" && !L.panelFolded && freeExperiment());
      }
    });
    bindInfoTips(bar);
    if (L.escapeHandler) document.removeEventListener("keydown", L.escapeHandler, true);
    L.escapeHandler = e => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (closeFocusedInfo(e)) return;
      const check = root.querySelector("#lg-issue-check"), coach = root.querySelector("#lg-coach");
      const drawer = L.panel ? document.getElementById("lg-panel") : null, active = document.activeElement;
      // D-83 각주 2: 키보드 초점이 들어 있는 층이 기본 순서보다 먼저 Esc를 받는다(덱의 '초점이 덱 안'과 같은
      // 루트 contains 판정). 확인 상자·서랍 안에 초점이 있으면 코치가 열려 있어도 그 층부터 닫는다.
      if (check?.contains(active)) { check.remove(); document.getElementById("lg-ready")?.focus({ preventScroll: true }); }
      else if (drawer?.contains(active)) closePanel(true);
      // 기본 순서(D-83): 코치(②)가 확인 상자·서랍(⑤)보다 먼저다. 코치 안에 포커스가 있거나 고른 건설 도구가 없을
      // 때만 코치를 닫는다. 도구를 고른 채 포커스가 코치 밖이면 이 Esc는 도구 취소(build.js) 몫이라 서랍도 닫지 않고 넘긴다.
      else if (coach) {
        if (!(coach.contains(document.activeElement) || !document.getElementById("bd-root")?.dataset.mode)) return;
        closeCoach(true);
      }
      else if (check) { check.remove(); document.getElementById("lg-ready")?.focus({ preventScroll: true }); }
      else if (L.panel) closePanel(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // 건설 화면의 도구 팝업 처리기보다 리그의 열린 확인·서랍을 먼저 닫는다.
    document.addEventListener("keydown", L.escapeHandler, true);
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("change", onPanelChange);
    panel.addEventListener("input", e => {
      if (e.target.matches("#lg-sound-vol")) { KCP.fxAudio?.setVolume(+e.target.value / 100); return; }
      if (e.target.matches("#lg-crit-line, [data-note], [data-pred], [data-end], [data-weight]")) econChange(e);
      if (e.target.matches("[data-j]")) onPanelChange(e);
      const pol = e.target.closest("[data-pol]");
      if (pol) {
        const output = pol.closest("label").querySelector("output");
        if (output) output.textContent = `${fmt(+pol.value, 1)}${pol.dataset.pol === "incentive" ? "억/달" : "단계"}`;
      }
      const r = e.target.closest("#lg-price");
      if (r) { const o = document.getElementById("lg-price-v"); if (o) o.textContent = (+r.value).toFixed(3); }
    });
    // 누름 시각: snapRenderPanel이 누르는 중·직후 PANEL_PRESS_MS 동안 스냅숏 다시 그리기를 미룬다.
    panel.addEventListener("pointerdown", () => { L.panelPress = { down: true, at: performance.now() }; }, true);
    for (const type of ["pointerup", "pointercancel"]) {
      panel.addEventListener(type, () => { if (L.panelPress) L.panelPress = { down: false, at: performance.now() }; }, true);
    }
    panel.addEventListener("focusout", () => {
      const session = L;
      // 다음 포커스와 change 처리가 끝난 뒤 갱신한다. 다른 입력으로 옮기면 계속 미룬다.
      setTimeout(() => {
        if (L !== session || !panel.isConnected || !session?.panelDirty) return;
        // 서랍 버튼을 누르려고 옮긴 포커스라면 pointerup·click 전에 버튼을 없애지 않는다.
        const active = document.activeElement;
        if (active && panel.contains(active) && active.matches("button")) return;
        // 초점을 주지 않고 누른 체크박스·버튼도 누름 보호로 막는다(팀 화면).
        L.role === "team" ? snapRenderPanel() : renderPanel();
      }, 0);
    });
    renderBar();
  }
  function renderBar() {
    const V = L.snap, reg = R();
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    if (!V) { set("lg-bround", "진행자 연결 대기"); set("lg-bphase", ""); return; }
    rememberLocalPlan(V); rememberEvidenceValues(V); updatePlanReminder(V);
    const rd = curRound();
    const RS0 = C.roundsOf(V);
    set("lg-bround", V.round ? turnLabel(rd, V.round, RS0.length, true) : `준비 · ${turnLabel(RS0[0], 1, RS0.length, true)}`);
    set("lg-bphase", PHASE_NAME[V.phase]);
    const planGoal = document.getElementById("lg-plan-co2");
    if (planGoal) {
      planGoal.hidden = !V.econ || V.phase !== "plan";
      planGoal.textContent = planGoal.hidden ? "" : planCo2Text(V);
    }
    const me = V.teams[L.team]; set("lg-left-hud", `${fmt(me.left, 1)}억`); L.syncMoney?.();
    const rb = document.getElementById("lg-ready");
    for (const id of ["lg-bar", "lg-panel"]) { const el = document.getElementById(id); if (el) el.dataset.econ = String(!!V.econ); }
    if (rb) rb.style.minHeight = V.econ ? "44px" : "";
    if (rb) { rb.setAttribute("aria-pressed", String(!!me.ready)); rb.textContent = V.econ && V.phase === "plan" && L.awaitReady ? "기준 확인" : L.role === "solo" && V.phase === "review" ? V.round === C.roundsOf(V).length ? "최종 결과" : "다음 달" : me.ready ? "준비 ✓" : "준비"; rb.disabled = !readyAllowed(V); }
    if (V.econ && !document.querySelector('.lg-bar [data-panel="city"]')) {
      const bar = document.getElementById("lg-bar"), b = document.createElement("button"); b.type = "button"; b.className = "lg-bbtn"; b.dataset.panel = "city"; b.textContent = "도시"; bar?.querySelector(".lg-actions")?.append(b);
      const rank = b.cloneNode(true); rank.dataset.panel = "rank"; rank.textContent = "순위"; bar?.querySelector(".lg-actions")?.append(rank);
    }
    const inc = V.ties.filter(T => T.st === "prop" && T.by !== L.team && (T.a === L.team || T.b === L.team)).length;
    const city = V.econ?.cities[L.team], chips = document.getElementById("lg-hud-chips"), watch = document.getElementById("lg-watch");
    // 태블릿에서는 칩 폭을 줄여 말줄임할 수 있어 전체 문구를 title에도 둔다.
    if (chips && city) { const pop = `주민 변화 ${signed(V.econ.report?.cities?.[L.team]?.dPop || 0)}명(지난달 대비)`; chips.innerHTML = `<span>지지 ${esc(fmt(city.approval, 1))}%</span><span title="${esc(pop)}">${esc(pop)}</span>`; }
    const grid = city?.grid || V.grid?.[L.team];
    const candidates = evidenceCandidates(V), s1Pick = tdata().interview?.months?.[V.round]?.s1Pick;
    const selectedEvidence = candidates?.find(x => x.key === s1Pick);
    const focus = candidates ? { shortName: selectedEvidence?.shortName || "근거 고르기", text: selectedEvidence?.text || "이번 달에 눈여겨볼 근거 하나를 골라요" } : null;
    const badges = [focus ? [focus.shortName, "deal", focus.text] : evCards(V, V.round, L.team) ? ["사건", "deal"] : null, grid?.waitingMW > 0 ? ["접속 대기", "city"] : null, me.left < 0 || city?.cash < 0 ? ["현금 위험", "city"] : null, inc ? ["이웃 제안", "deal"] : null].filter(Boolean).slice(0, 3);
    if (watch) watch.innerHTML = badges.length ? `<span>이번 달 볼 것</span>${badges.map(([text, tab, title]) => `<button type="button" class="lg-bbtn" data-hud-panel="${tab}" title="${esc(title || text)}"${title ? ' data-evidence-focus="true"' : ""}>${esc(text)}</button>`).join("")}` : "";
    const bd = document.getElementById("lg-badge");
    if (bd) { bd.hidden = !inc; bd.textContent = String(inc); }
    tickTimer(); updatePlanIssues();
    if (!L.coach) showFirstGuide(document.getElementById("bd-root"));
    updateCoach();
  }
  function openPanel(tab) {
    L.resultReplayWait?.();
    const previous = L.panel, active = document.activeElement;
    if (active && !active.closest("#lg-panel") && active !== document.body) L.panelTrigger = active;
    BG.closeDrawer?.();
    L.panelFolded = false; L.panel = tab;
    const p = document.getElementById("lg-panel"); if (!p) return;
    p.hidden = false; renderPanel(); syncResultMapSpace();
    document.querySelectorAll(".lg-bar [data-panel]").forEach(b => b.setAttribute("aria-expanded", String(b.dataset.panel === tab)));
    if (previous !== tab || tab === "result" && L.snap?.phase === "end") { p.scrollTop = 0; p.querySelector(".lg-pbody")?.scrollTo(0, 0); }
    if (tab === "journal" && L.awaitReady) {
      const card = p.querySelector("#lg-predict");
      // 지난달 변경·놓친 것 두 줄과 약속을 한 화면에 둔다.
      if (card) { p.querySelector(".lg-pbody")?.scrollTo(0, 0); card.querySelector("button:not(:disabled),select")?.focus({ preventScroll: true }); }
    } else if (previous !== tab) p.querySelector(".lg-px")?.focus({ preventScroll: true });
  }
  // 원인 카드(분해된 #lg-missed[data-opened])가 있는 달만 S7을 먼저 거치게 한다. 분해할 수 없는 달(시험 기록·지난달 사본 없음,
  // 계산 전)은 할 수 있는 S7 행동이 없으므로 바로 단추를 낸다. 고르기를 생략하는 달(data-single)은 카드가 보이는 순간 S7이 끝난다.
  function decisionShortcutHTML(outage, n) {
    const card = outage?.hasAttribute("data-opened") ? outage : null;
    if (!card || card.dataset.single === "true" || n.missedCarry || n.outageSingleShown)
      return `<button type="button" class="v2-btn" id="lg-to-decision" aria-controls="lg-result-decision">다음 결정으로 가기</button>`;
    return `<p id="lg-to-decision" class="lg-hint">${n.outageOpened || card.dataset.opened === "true" ? "연 원인을 다음 달 약속 카드에 붙이면 다음 결정으로 가요" : "원인 하나를 먼저 골라 열어 봐요"}</p>`;
  }
  // 리그 서랍 안에서 el 위끝이 탭 줄 바로 아래 오도록 서랍만 스크롤한다(페이지·지도는 움직이지 않음).
  function scrollPanelTo(el) {
    const p = document.getElementById("lg-panel");
    if (!p || !el || !p.contains(el)) return;
    const tabs = p.querySelector(".lg-ptabs")?.offsetHeight || 0;
    const body = p.querySelector(".lg-pbody");
    if (body) body.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - tabs - 8;
  }
  // S8 선택 뒤 다시 그린 이유 묶음을 읽을 위치로 옮긴다. 입력 초점은 건드리지 않는다.
  function revealDecisionReason() {
    if (!matchMedia("(max-width: 1024px)").matches) return;
    const p = document.getElementById("lg-panel"), body = p?.querySelector(".lg-pbody");
    const field = p?.querySelector('.lg-result-decision [data-note="askReason"]');
    if (!body || !field || p.dataset.folded === "true") return;
    const label = field.closest(".lg-jq") || field, starts = label.parentElement?.querySelector(".lg-reason-starts") || label;
    const box = body.getBoundingClientRect(), top = box.top + body.clientTop;
    if (starts.getBoundingClientRect().top >= top && label.getBoundingClientRect().bottom <= top + body.clientHeight) return;
    // 방금 누른 고치기·유지 단추가 위로 밀려 가리지 않게, 단추 줄부터 이유 칸까지 들어가면 단추 줄에 맞춘다.
    const actions = p.querySelector(".lg-result-decision .lg-decision-actions");
    const fits = actions && label.getBoundingClientRect().bottom - actions.getBoundingClientRect().top <= body.clientHeight - 8;
    scrollPanelTo(fits ? actions : starts);
  }
  function syncResultMapSpace() {
    const root = document.getElementById("bd-root"), p = document.getElementById("lg-panel");
    if (!root || L.away) return;
    const wide = !!p && !p.hidden && ["review", "end"].includes(p.dataset.stage) && ["result", "journal"].includes(p.dataset.tab);
    const before = root.dataset.resultDrawer, drawerBefore = root.dataset.leagueDrawer;
    root.dataset.resultDrawer = String(wide);
    root.dataset.leagueDrawer = String(!!p && !p.hidden);
    root.dataset.promiseOpen = String(!!p && !p.hidden && !L.panelFolded && L.panel === "journal" && !!p.querySelector("#lg-ready-confirm"));
    if (before !== root.dataset.resultDrawer || drawerBefore !== root.dataset.leagueDrawer) window.dispatchEvent(new Event("resize"));
  }
  function closePanel(restore = false) {
    L.resultReplayWait?.();
    L.panel = null; L.panelDirty = false; const p = document.getElementById("lg-panel"); if (p) p.hidden = true;
    syncResultMapSpace();
    document.querySelectorAll(".lg-bar [data-panel]").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (restore && L.panelTrigger?.isConnected) L.panelTrigger.focus({ preventScroll: true });
  }
  // 내 도시 안에서 그 이웃 쪽 외부 연결점까지 선이 이어졌나
  function gateLinked(other) {
    const st = BG.current();
    if (!st) return false;
    const N = BG.network(st);
    return N.nodes.some(n => n.kind === "import" && (BG.SITES[n.si].to || []).includes(other) && n.comp >= 0 && n.att.length > 0 && N.comps.some(Cc => Cc.disp.includes(n) && (Cc.towns.length || Cc.ren.length || Cc.disp.length > 1)));
  }
  // 스냅숏 수신으로 서랍을 다시 그릴 때만 쓴다. 학생이 서랍 안을 누르는 중이거나 막 누른 직후
  // (초점을 주지 않는 체크박스·탭 포함)에는 요소를 갈아 끼우지 않고 잠시 뒤 다시 그린다.
  // 학생 자신의 조작에 따른 다시 그리기는 바로 해야 하므로 renderPanel에는 넣지 않는다.
  function snapRenderPanel() {
    const press = L.panelPress, pressAge = press ? performance.now() - press.at : Infinity;
    const pressWait = !press ? 0 : press.down ? (pressAge < PANEL_PRESS_HOLD_MS ? PANEL_PRESS_MS : 0) : PANEL_PRESS_MS - pressAge;
    if (pressWait <= 0) { renderPanel(); return; }
    L.panelDirty = true;
    const session = L;
    clearTimeout(L.panelPressT);
    L.panelPressT = setTimeout(() => { if (L === session && session.panelDirty && session.panel) snapRenderPanel(); }, pressWait);
  }
  function renderPanel() {
    if (L.away) return;
    const p = document.getElementById("lg-panel");
    if (!p || !L.panel) return;
    const active = document.activeElement;
    // 포커스를 복원해도 빠른 키 입력·IME 조합·드래그 도중의 요소 교체는 복구할 수 없다.
    if (active && p.contains(active) && active.matches("input, textarea, select, button[data-pol], button[data-crit], button[data-crit-choice]")) {
      L.panelDirty = true;
      return;
    }
    L.panelDirty = false;
    L.outRender = (L.outRender || 0) + 1;
    L.outShownPending = null;
    const V = L.snap, reg = R(), tab = L.panel;
    const reviewOrder = tab === "result" && V?.econ && V.phase === "review" && ["team", "solo"].includes(L.role);
    const techScroll = p.querySelector(".lg-tech-scroll")?.scrollLeft || 0;
    const bodyScroll = V?.phase === "end" && (p.dataset.stage !== "end" || p.dataset.tab !== tab) ? 0 : p.querySelector(".lg-pbody")?.scrollTop || 0;
    // 기본으로 펼친 상자를 학생이 접었으면 다시 그려도 접힌 채로 둔다.
    const closedWide = [...p.querySelectorAll("details[data-wide-open][id]:not([open])")].map(el => el.id);
    const openedDetails = [...p.querySelectorAll("details[open]")].map(el => el.id ? ["id", el.id] : el.hasAttribute("data-event-source") ? ["data-event-source", el.dataset.eventSource] : el.hasAttribute("data-decision-detail") ? ["data-decision-detail", el.dataset.decisionDetail] : el.hasAttribute("data-fold") ? ["data-fold", el.dataset.fold] : null).filter(Boolean);
    const pinnedInfo = [...p.querySelectorAll("details.lg-info[data-pinned]")].map(el => el.dataset.fold);
    const focused = document.activeElement, focusKey = focused && p.contains(focused) ? ["data-info-key", "data-fold-summary", "data-note", "data-j", "data-end", "data-pol", "data-ptab", "data-tech-card", "data-tech-action", "data-pclose", "data-evidence", "data-confidence", "data-answer", "data-missed", "data-crit", "data-crit-choice", "data-resp", "id"].find(k => focused.hasAttribute(k)) : null;
    const focusValue = focusKey ? focused.getAttribute(focusKey) : null, cursor = focusKey && focused.tagName === "TEXTAREA" ? [focused.selectionStart, focused.selectionEnd] : null;
    let body = "";
    if (!V) body = `<p class="lg-hint">진행자 연결을 기다리는 중이에요.</p>`;
    else if (tab === "help") body = helpHTML();
    else if (tab === "tech") body = techHTML(V);
    else if (tab === "city" && V.econ) body = cityHTML(V);
      else if (tab === "rank" && V.econ) body = tickerHTML(V) + rankHTML(V.econ, L.role !== "solo");
    else if (tab === "deal") {
      const me = V.teams[L.team], open = V.phase === "lobby" || V.phase === "plan";
      const nbs = reg.ties.filter(D => (D.a === L.team || D.b === L.team) && V.teams[D.a] && V.teams[D.b]);
      const left = me.left;
      const evh = V.round ? evCards(V, V.round, L.team, V.phase === "plan") : "";
      body = `${evidenceFocusHTML(V)}${evh ? `<section class="lg-sec"><h3>${V.econ ? "이번 달" : "이번 라운드"} 사건</h3>${evh}</section>` : ""}<p class="lg-left">남은 돈 <b class="num" data-money="left" data-bad="${left < 0}">${fmt(left, 1)}억</b> ${lossHTML(V)} <small>(${V.econ ? "지방채 한도(빚) 포함 · 예약·지원금·연계선 정산 반영" : "계획 반영 뒤 쓸 수 있는 돈"} · 연계선은 두 도시가 반씩 · ${V.econ ? "지난달" : "지난 라운드"} 것을 철거하면 ${Math.round(C.SALV * 100)}%만 회수)</small></p>
        <section class="lg-sec"><h3>내 전기 판매 단가</h3>
          <p class="lg-hint">이웃이 모자랄 때 남는 전기를 이 값에 팝니다(MWh당 억). 화력 여유분은 연료비보다 비쌀 때만 팝니다.</p>
          <label class="lg-price"><input type="range" id="lg-price" min="${C.PRICE.min}" max="${C.PRICE.max}" step="0.001" value="${me.price}" ${open ? "" : "disabled"} aria-label="판매 단가"><b class="num" id="lg-price-v">${me.price.toFixed(3)}</b></label></section>
        <section class="lg-sec"><h3>이웃 연계선</h3><ul class="lg-nbs">${nbs.map(D => {
          const other = D.a === L.team ? D.b : D.a, T = V.ties.find(x => x.a === D.a && x.b === D.b);
          const half2 = D.cost / 2, half4 = D.cost * 1.6 / 2, linked = gateLinked(other);
          let st = "", act = "";
          if (!T) { st = "없음"; act = open ? `<button type="button" class="v2-btn" data-tie="propose" data-other="${other}" data-cap="2">2 MW 제안 (내 몫 ${fmt(half2, 1)}억)</button><button type="button" class="v2-btn" data-tie="propose" data-other="${other}" data-cap="4">4 MW 제안 (${fmt(half4, 1)}억)</button>` : ""; }
          else if (T.st === "built") st = `${T.kind === "hvdc" ? "HVDC · " : ""}명목 ${T.cap} MW · 운영 ${fmt(C.effectiveTie(V, T).cap, 1)} MW(기술 적용·사건 전) 연결됨`;
          else if (T.by === L.team) { st = `${T.cap} MW 제안함 · 답 기다림`; act = open ? `<button type="button" class="v2-btn" data-tie="cancel" data-other="${other}">제안 거두기</button>` : ""; }
          else { st = `${withParticle(teamName(T.by), "이가")} ${T.cap} MW 제안`; act = open ? `<button type="button" class="v2-btn primary" data-tie="accept" data-other="${other}">수락 (내 몫 ${fmt(C.tieCost(reg, T) / 2, 1)}억)</button><button type="button" class="v2-btn" data-tie="cancel" data-other="${other}">거절</button>` : ""; }
          const hvdc = techResearch(V, L.team).adopted?.includes("hvdc");
          if (!T) act += hvdc ? [2, 4].map(cap => `<button type="button" class="v2-btn" data-tie="propose" data-other="${esc(other)}" data-cap="${cap}" data-kind="hvdc" ${open ? "" : "disabled"}>HVDC로 제안 · 명목 ${esc(cap)} MW · 운영 ${esc(fmt(C.effectiveTie(V, { ...D, cap, kind: "hvdc" }).cap, 1))} MW(기술 적용·사건 전) (내 몫 ${esc(fmt(C.tieCost(reg, { ...D, cap, kind: "hvdc" }) / 2, 1))}억)</button>`).join("") : `<button type="button" class="v2-btn" disabled>🔒 HVDC 도입 후 제안</button>`;
          return `<li style="--c:${teamCol(other)}"><div class="lg-nbh"><b>${esc(teamName(other))}</b><span>${esc(D.name)} · ${D.kind === "sea" ? "해저" : D.kind === "bay" ? "만 횡단" : "육상"}</span><span class="lg-gate" data-ok="${linked}">${linked ? "연결점까지 선 이음" : "연결점(노란 칸)까지 선 필요"}</span></div>
            <p class="lg-nbs-st">${esc(st)}</p><div class="lg-acts">${act}</div></li>`;
        }).join("")}</ul></section>`;
    } else if (tab === "result") {
      const res = V.results[V.results.length - 1];
      if (!res) body = `<p class="lg-hint">${V.econ ? "한 달을" : "라운드를"} 운영하면 결과가 여기에 나옵니다. 그 전에는 아래 [1주] 버튼으로 <b>우리 도시만</b> 시험 운전해 볼 수 있어요(이웃 거래 없이).</p>`;
      else if (V.econ) body = resultHTML(V, res);
      else {
        const r = res.team[L.team], g = V.goals || reg.goals;
        const rd = C.roundsOf(V)[res.round - 1];
        const curtailMWh = res.econ?.grid?.[L.team]?.curtailMWh ??
          (r.curtailMWh == null ? undefined : r.curtailMWh * (rd.mdays || rd.days) / rd.days);
        const rank = actT(V).filter(t => res.team[t.id]).map(t => ({ t, r: res.team[t.id] }));
        body = `<section class="lg-sec"><h3>${resLabel(res)} — ${esc(teamName(L.team))}</h3>
          <dl class="lg-kpi lg-result-deltas"><div><dt>정전</dt><dd>${fmt(r.unsPct, 2)}%</dd></div><div><dt>병원 정전</dt><dd>${r.hospH}시간</dd></div><div><dt>이번 라운드 돈</dt><dd>${fmt(r.cost.total, 1)}억</dd></div></dl>
          <details id="lg-result-reasons"><summary>무엇 때문에 달라졌나요</summary>${(r.cpList || []).filter(cp => cp.score > 0).map(cp => `<p>${esc(PART_NAMES[cp.kind] || "민원")} ${esc(fmt(cp.score, 1))}<meter min="0" max="${esc(Math.max(1, ...(r.cpList || []).map(x => x.score)))}" value="${esc(cp.score)}" aria-label="민원 영향"></meter></p>`).join("") || "<p>표시할 민원 원인 없음</p>"}</details>
          <details id="lg-result-details"><summary>자세히 · 장부와 거래</summary><dl class="lg-kpi">
            <div><dt>정전</dt><dd class="num" data-bad="${r.unsPct > g.unsPct}">${fmt(r.unsPct, 2)}%</dd><small>혼자였다면 ${fmt(100 * r.isolated.uns / Math.max(1e-9, r.dem), 2)}%</small></div>
            <div><dt>병원 정전</dt><dd class="num" data-bad="${r.hospH > 0}">${r.hospH}시간</dd></div>
            <div><dt>사 온 전기 / 판 전기</dt><dd class="num">${fmt(r.imp, 1)} / ${fmt(r.exp, 1)} MWh</dd><small>거래 수지 ${fmt(r.earn - r.pay, 2)}억</small></div>
            <div><dt>CO₂ 생산 / 소비 기준</dt><dd class="num">${fmt(r.co2Prod)} / ${fmt(r.co2Cons)} t</dd></div>
            <div><dt>이번 라운드 돈</dt><dd class="num">${fmt(r.cost.total, 1)}억</dd><small>새 투자 ${fmt(r.cost.inv != null ? r.cost.inv : r.cost.capex, 1)} + 운영 ${fmt(r.cost.opex != null ? r.cost.opex : r.cost.fuel, 1)}(연료·정책·대응${r.cost.research ? "·연구소" : ""}·거래) · 누적 투자 ${fmt(r.cost.stock != null ? r.cost.stock : r.cost.capex, 1)}</small></div>
            <div><dt>최저 만족 · 민원</dt><dd class="num">${r.sat} · ${r.cp}건</dd></div>
          </dl>
          ${curtailHTML(V, res, L.team, curtailMWh)}
          ${res.events && res.events.length ? `<div class="lg-evres">${evCards(V, res.round, L.team)}</div>` : ""}${res.tieDown ? `<p class="lg-warn">고장 난 연계선: ${res.tieDown.split("~").map(teamName).map(esc).join("–")}</p>` : ""}
          ${r.unlinked.length ? `<p class="lg-warn">연계선이 있어도 연결점까지 선이 없어 거래 못 함: ${r.unlinked.map(teamName).map(esc).join(", ")}</p>` : ""}
          <p class="lg-goals"><span data-ok="${res.region.ok.uns}">지역 정전 ${fmt(res.region.unsPct, 2)}%</span><span data-ok="${res.region.ok.co2}">지역 CO₂ ${fmt(res.region.co2)} t / ${fmt(g.co2)} t</span></p>
          <section class="lg-sec"><h3>다른 도시</h3><table class="lg-table lg-mini"><thead><tr><th scope="col">팀</th><th scope="col">정전</th><th scope="col">CO₂ 생산</th><th scope="col">수입/수출</th></tr></thead><tbody>
          ${rank.map(x => `<tr style="--c:${x.t.color}" ${x.t.id === L.team ? 'data-me="true"' : ""}><th scope="row">${esc(x.t.name)}</th><td class="num">${fmt(x.r.unsPct, 2)}%</td><td class="num">${fmt(x.r.co2Prod)}</td><td class="num">${fmt(x.r.imp, 1)}/${fmt(x.r.exp, 1)}</td></tr>`).join("")}</tbody></table></section></details></section>`;
      }
    } else {
      const J = tdata().journal[V.round || 0] || {};
      body = `<section class="lg-sec"><h3>${V.round ? V.econ ? `${curRound().month}월` : `${V.round}라운드` : "준비"} 일지</h3><p class="lg-hint">이 기기에만 저장돼요.</p>
        ${JQ.map(q => `<label class="lg-jq"><span>${esc(journalQuestion(q.q, V))}</span><textarea data-j="${q.k}" rows="3" maxlength="1000">${esc(J[q.k] || "")}</textarea></label>`).join("")}
        <button type="button" class="v2-btn" id="lg-jcopy">활동지로 복사</button></section>`;
    }
    if (V?.econ) {
      if (tab === "result") {
        const interview = resultInterviewHTML(V, reviewOrder);
        body = V.phase === "end" ? `${endHTML(V)}<details class="lg-last-month" id="lg-last-month"><summary>${esc(curRound().month)}월 결과 자세히</summary>${body}${interview}</details>` : body + interview;
      }
      if (tab === "journal") body = predictionHTML(V) + critHTML(V) + previousNoteHTML(V) + body.replace('<button type="button" class="v2-btn" id="lg-jcopy">', quarterHTML(V) + '<button type="button" class="v2-btn" id="lg-jcopy">');
    }
    if (tab === "result" && V?.phase === "end" && !V.econ) body = y2022LinkHTML("lg-y2022-end") + `<p class="lg-season-chip">${esc(SEASON_NAME[curRound().season])}</p>` + body;
    if (tab === "result" && V) body = V.phase === "end" ? body + techResultHTML(V) : techResultHTML(V) + body;
    p.dataset.stage = V?.phase || ""; p.dataset.tab = tab;
    p.classList.toggle("lg-tech-drawer", tab === "tech");
    p.dataset.folded = String(!!L.panelFolded);
    if (V?.econ && V.phase === "plan") {
      const goal = `<p id="lg-plan-co2-drawer" class="lg-hint">${esc(planCo2Text(V))}</p>`;
      // 계획 CO₂ 목표 줄은 모든 탭에서 맨 위(폰에서는 머리의 같은 줄이 숨으므로 유일한 표시).
      body = goal + body;
    }
    p.innerHTML = `<div class="lg-ptabs" aria-label="리그 서랍"><strong>${esc({ deal: "이웃·거래", result: "결과", journal: "일지", city: "도시", rank: "순위", tech: "연구", help: "도움말" }[tab])}</strong><button class="lg-bbtn" type="button" id="lg-panel-fold" aria-expanded="${!L.panelFolded}">${L.panelFolded ? "펼치기" : "접기"}</button><button type="button" class="lg-px" data-pclose aria-label="닫기">×</button></div><div class="lg-pbody" ${L.panelFolded ? "hidden" : ""}>${body}<p class="lg-hint">${ASSUMPTIONS}</p></div>`;
    p.querySelectorAll(".lg-promise-carry > p").forEach(line => { line.title = line.textContent; });
    if (tab === "result" && V?.phase === "end") KCP.fxEnd?.mount(p);
    const panelBody = p.querySelector(".lg-pbody"), promiseActions = p.querySelector(".lg-promise-actions");
    if (promiseActions && !L.panelFolded) p.append(promiseActions);
    syncResultMapSpace();
    const summary = p.querySelector("#lg-promise-summary");
    if (reviewOrder) {
      // 숫자 → 판정 → 원인 카드 → 결정을 먼저 두고, 상세의 기존 열림 상태는 보존한다.
      const deltas = p.querySelector("#lg-result-deltas"), outage = p.querySelector("#lg-missed");
      const compared = p.querySelector(".lg-compared"), questions = [...p.querySelectorAll("#lg-loop-review, .lg-ask")];
      const decision = document.createElement("section"); decision.className = "lg-result-decision"; decision.id = "lg-result-decision"; decision.tabIndex = -1;
      decision.append(...questions);
      const loop = decision.querySelector("#lg-loop-review"), ask = decision.querySelector(".lg-ask");
      if (loop && ask) loop.querySelector("h3").after(ask);
      const actions = decision.querySelector(".lg-decision-actions");
      if (compared) { if (actions) actions.prepend(compared); else decision.prepend(compared); }
      // 판정 줄은 남기고 긴 규칙 문단만 기존 펼치기 안으로 옮긴다.
      const mission = decision.querySelector("#lg-learning-mission"), rules = mission?.nextElementSibling;
      const ruleDetails = rules?.nextElementSibling;
      if (rules?.matches(".lg-hint") && ruleDetails?.matches(".lg-learning-details")) {
        ruleDetails.querySelector("summary").textContent = "학습 미션 판정 규칙";
        ruleDetails.querySelector("summary").after(rules);
        ruleDetails.dataset.decisionDetail = "rule";
      }
      const shortcut = summary && decision.childElementCount ? decisionShortcutHTML(outage, monthNote().n) : "";
      // 연구 완료 소식(T2 '결과 맨 위')은 숫자 줄보다 먼저 둔다.
      const techNews = p.querySelector(".lg-tech-results");
      // 결과 제목(몇 월 결과 · 다음 운영 몇 월)은 접지 않고 서랍 맨 위에 둔다. 섹션을 접힘으로 옮기기 전에 꺼낸다.
      const heading = p.querySelector("#lg-result-heading");
      const sections = [p.querySelector("#lg-result"), p.querySelector("#lg-promise-result")].filter(Boolean);
      const monthDetails = document.createElement("details"); monthDetails.id = "lg-month-details"; monthDetails.className = "lg-sec";
      const monthSummary = document.createElement("summary"), n = monthNote().n;
      monthSummary.innerHTML = esc(`이번 달 자세히 · ${summary ? promiseVerdictShort(promiseComparison(V, n), n) : "정전 시간 정의·피해 추정"}`);
      monthDetails.append(monthSummary, ...sections);
      panelBody.prepend(...[heading, techNews, deltas, summary, outage, decision.childElementCount ? decision : null, sections.length ? monthDetails : null].filter(Boolean));
      if (shortcut) summary.insertAdjacentHTML("afterend", shortcut);
    } else if (summary && V?.phase !== "end") panelBody.prepend(summary);
    if (tab === "result" && V?.results?.length) {
      const res = V.results.at(-1), note = tdata().interview?.months?.[res.round];
      const cause = noSupplyCause(res.team[L.team]?.unsPct, note?.planIssues);
      if (cause) {
        const line = document.createElement("div"); line.id = "lg-no-supply-cause"; line.className = "lg-hint";
        line.innerHTML = esc(cause.slice(0, -SUPPLY_ASSUMPTION().length)) + infoTip("result-no-supply", esc(SUPPLY_ASSUMPTION()), { label: "바깥 계통" });
        if (reviewOrder) (summary || p.querySelector("#lg-result-deltas"))?.after(line);
        else if (summary) summary.after(line); else if (V.phase === "end") p.querySelector("#lg-last-month")?.append(line); else panelBody.prepend(line);
      }
    }
    // 계통 약속 달의 '정전도 생겼어요' 줄은 맨 위로 옮긴 판정 줄 바로 아래에 둔다(D-80 B-3a).
    const alsoOutage = p.querySelector("#lg-promise-also-outage");
    if (summary && alsoOutage && summary.isConnected) summary.after(alsoOutage);
    // D-82 결정 2: 재배치·바로가기 삽입 뒤에도 소비 CO₂를 판정의 바로 다음에 둔다.
    // '정전도 생겼어요'가 있으면 그 줄을 판정 바로 아래에 두고(D-80 B-3a) 소비 CO₂는 그다음에 둔다.
    const co2cons = p.querySelector("#lg-s6-co2cons");
    if (summary && co2cons && summary.isConnected) {
      const co2Info = p.querySelector('[data-fold="result-co2-consumption"]');
      (alsoOutage?.isConnected ? alsoOutage : summary).after(co2cons);
      if (co2Info) co2cons.after(co2Info);
    }
    closedWide.forEach(id => { const el = p.querySelector(`details[id="${id}"]`); if (el) el.open = false; });
    openedDetails.forEach(([key, value]) => { [...p.querySelectorAll(`details[${key}]`)].filter(el => el.getAttribute(key) === value).forEach(el => { el.open = true; }); });
    pinnedInfo.forEach(key => { [...p.querySelectorAll("details.lg-info[data-fold]")].filter(el => el.dataset.fold === key).forEach(el => { el.dataset.pinned = "true"; }); });
    bindInfoTips(p);
    panelBody.scrollTop = bodyScroll;
    recordOutageShown(p);
    p.querySelector("#lg-last-month")?.addEventListener("toggle", () => recordOutageShown(p));
    const tree = p.querySelector(".lg-tech-scroll"); if (tree) tree.scrollLeft = techScroll;
    restorePanelFocus(p, focusKey, focusValue, cursor);
  }
  function shownOutageElement(p, selector) {
    const result = p?.querySelector(selector);
    if (!result || result.closest("[hidden]")) return null;
    for (let el = result.parentElement; el && el !== p; el = el.parentElement) {
      if (el.tagName === "DETAILS" && !el.open) return null;
    }
    return result;
  }
  function recordOutageShown(p) {
    const pending = L.outShownPending;
    if (!pending || !shownOutageElement(p, pending.single ? "#lg-outage-single" : "#lg-outage-verdict")) return;
    const { d, n } = monthNote();
    if (pending.round !== L.snap.round) return;
    const changed = (pending.single && !n.outageSingleShown) ||
      !n.outageFrozen || outageLegacyGrid(n.outageFrozen) || n.outageNoCause !== !pending.largest ||
      n.outageLargest?.key !== pending.largest?.key || n.outageLargest?.value !== pending.largest?.value ||
      (!pending.largest && !!n.missedCarry?.largest);
    if (pending.single) n.outageSingleShown = true;
    if (!n.outageFrozen || outageLegacyGrid(n.outageFrozen)) n.outageFrozen = structuredClone(pending.frozen);
    n.outageNoCause = !pending.largest;
    if (pending.largest) n.outageLargest = { ...pending.largest };
    else { delete n.outageLargest; if (n.missedCarry) delete n.missedCarry.largest; }
    L.outShownPending = null;
    if (changed) {
      putData(d);
      const timeline = p.querySelector("#lg-timeline");
      if (timeline) {
        const parent = timeline.parentElement;
        timeline.outerHTML = trendHTML(L.snap, L.team, true);
        bindInfoTips(parent);
      }
    }
  }
  function restorePanelFocus(p, key, value, cursor) {
    if (!key) return;
    const target = [...p.querySelectorAll(`[${key}]`)].find(el => el.getAttribute(key) === value);
    if (target) { target.focus({ preventScroll: true }); if (cursor) target.setSelectionRange(...cursor); }
  }
  function onPanelClick(e) {
    if (e.target.closest("#lg-coach-again")) { closePanel(); showFirstGuide(document.getElementById("bd-root"), true); return; }
    if (e.target.closest("#lg-solo-restart")) { restartSolo(); return; }
    if (e.target.closest("button#lg-to-decision")) {
      const decision = document.getElementById("lg-result-decision");
      scrollPanelTo(decision); decision?.focus({ preventScroll: true }); return;
    }
    if (e.target.closest("[data-promise-details]")) {
      const details = document.getElementById("lg-last-month"); if (details) details.open = true;
      const month = document.getElementById("lg-month-details"); if (month) month.open = true;
      const result = document.getElementById("lg-promise-result");
      scrollPanelTo(result);
      if (month && result) result.focus({ preventScroll: true });
      return;
    }
    const start = e.target.closest("[data-reason-start]");
    if (start) {
      const field = start.parentElement.parentElement.querySelector('[data-note="askReason"]');
      if (field) {
        const typed = field.value.trim();
        field.value = typed ? `${typed} ${start.dataset.reasonStart}` : start.dataset.reasonStart;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length);
      }
      return;
    }
    const s1Card = e.target.closest("#lg-evidence-focus [data-s1-pick]");
    if (s1Card) {
      const item = evidenceCandidates(L.snap)?.find(x => x.key === s1Card.dataset.s1Pick);
      if (!item) return;
      const { d, n } = monthNote(); n.s1Pick = item.key; putData(d);
      const badge = document.querySelector('#lg-watch [data-evidence-focus="true"]');
      if (badge) { badge.textContent = item.shortName; badge.title = item.text; }
      renderPanel();
      return;
    }
    const focusLink = e.target.closest("#lg-evidence-focus [data-hud-panel]");
    if (focusLink) {
      const { n } = monthNote(), focus = evidenceCandidates(L.snap)?.find(x => x.key === n.s1Pick);
      if (!focus || focusLink.disabled) return;
      openPanel("journal");
      let chip = document.querySelector(`#lg-evidence [data-evidence="${focus.key}"]`);
      // 기존 칩 클릭과 같은 저장 경로. 먼저 고른 S4 근거는 덮어쓰지 않는다.
      if (!n.evidence && chip) { chip.click(); chip = document.querySelector(`#lg-evidence [data-evidence="${focus.key}"]`); }
      if (chip) { scrollPanelTo(chip); chip.focus({ preventScroll: true }); }
      return;
    }
    const sound = e.target.closest("#lg-sound");
    if (sound) {
      const enabled = !KCP.fxAudio?.enabled(); KCP.fxAudio?.setEnabled(enabled);
      sound.setAttribute("aria-pressed", String(enabled));
      const volume = document.getElementById("lg-sound-vol"); if (volume) volume.hidden = !enabled;
      if (enabled) Promise.resolve(unlockAudio()).then(() => signal("ready"));
      return;
    }
    if (e.target.closest("#lg-build-help")) { closePanel(); BG.openHelp?.(document.getElementById("bd-help")); return; }
    if (e.target.closest("#lg-panel-fold")) { L.panelFolded = !L.panelFolded; document.getElementById("lg-panel").dataset.folded = String(L.panelFolded); renderPanel(); return; }
    if (techClick(e)) return;
    if (econClick(e)) return;
    const t = e.target.closest("[data-ptab]"), x = e.target.closest("[data-pclose]"), tie = e.target.closest("[data-tie]");
    if (x) { closePanel(true); return; }
    if (t) { openPanel(t.dataset.ptab); return; }
    if (tie && L.snap?.econ) {
      const { d, n } = monthNote(), other = tie.dataset.other;
      const X = L.snap.ties.find(x => x.st === "prop" && (x.a === L.team && x.b === other || x.b === L.team && x.a === other));
      n.big = true; n.confirmed = false;
      if (tie.dataset.tie === "accept") { n.accepted = true; n.acceptedOther = other; }
      if (tie.dataset.tie === "cancel" && X && X.by !== L.team) { n.rejected = true; n.rejectedOther = other; }
      putData(d);
    }
    if (tie) {
      const current = L.snap.ties.find(t => [t.a, t.b].includes(L.team) && [t.a, t.b].includes(tie.dataset.other));
      send("tie", { op: tie.dataset.tie, other: tie.dataset.other, cap: +tie.dataset.cap || current?.cap || 2, kind: tie.dataset.kind || current?.kind });
      tie.disabled = true; return;
    }
    const rs = e.target.closest("[data-resp]");
    if (rs) { if (L.snap?.econ) { const { d, n } = monthNote(); n.big = true; n.confirmed = false; putData(d); } send("respond", { ev: rs.dataset.ev, opt: rs.dataset.resp }); rs.closest(".lg-evopts").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === rs))); return; }
    if (e.target.closest("#lg-jcopy") && L.snap?.econ) { copyText(worksheet(L.snap), "활동지를 복사했어요", e.target.closest("#lg-jcopy")); return; }
    if (e.target.closest("#lg-jcopy")) {
      const V = L.snap, J = tdata().journal[V ? V.round : 0] || {}, res = V && V.results[V.results.length - 1];
      const r = res && res.team[L.team];
      const txt = [`[${R().name} 전력 리그] ${teamName(L.team)} · ${V && V.round ? `${V.round}라운드` : "준비"}`,
        r ? `결과: 정전 ${fmt(r.unsPct, 2)}% · 병원 정전 ${r.hospH}h · CO₂ 생산 ${fmt(r.co2Prod)} t / 소비 ${fmt(r.co2Cons)} t · 수입 ${fmt(r.imp, 1)} / 수출 ${fmt(r.exp, 1)} MWh` : "",
        ...JQ.map(q => `■ ${q.q}\n${J[q.k] || ""}`)].filter(Boolean).join("\n\n");
      copyText(txt, "일지를 복사했어요", e.target.closest("#lg-jcopy"));
    }
  }
  function onPanelChange(e) {
    const volume = e.target.closest("#lg-sound-vol");
    if (volume) { KCP.fxAudio?.setVolume(+volume.value / 100); Promise.resolve(unlockAudio()).then(() => signal("ready")); return; }
    if (econChange(e)) return;
    const pr = e.target.closest("#lg-price");
    if (pr) { send("price", { price: +pr.value }); return; }
    const j = e.target.closest("[data-j]");
    if (j) {
      const s = tdata(), rd = L.snap ? L.snap.round : 0;
      s.journal[rd] = s.journal[rd] || {}; s.journal[rd][j.dataset.j] = j.value.slice(0, 1000);
      putData(s);
    }
  }
  function copyText(text, ok, btn) {
    const done = () => { if (btn) { const o = btn.textContent; btn.textContent = ok; setTimeout(() => { btn.textContent = o; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt("복사해요", text));
    else window.prompt("복사해요", text);
  }

  KCP.route("league", (app, arg) => {
    if (arg === "solo") startSolo(app);
    else if (arg === "host") hostView(app);
    else if (/^view\//.test(arg || "")) viewCity(app, arg.slice(5));
    else if (arg === "team") teamView(app);
    else lobby(app, /^j=/.test(arg || "") ? arg.slice(2) : null, arg === "multi" ? "host" : "solo");
  });
  // 검사용
  KCP.league = {
    infoTip, tipBox, bindInfoTips,
    state: () => (L ? { role: L.role, room: L.room, team: L.team, S: L.S, snap: L.snap, rev: L.rev } : null),
    next: () => L && (L.role === "solo" ? soloNext() : L.role === "host" && hostNext()),
    uiMath: { monthPoints, resultPeriod, fmt, cityTownLook, trendHTML, techScaleHTML, withParticle, causeBreakdown, reweightScore, chooseQuestion, weightSimulation, publicCSV, speedText, recalHTML, migrationReason, outageAttribution, outageAttributionMonthly, outageCardsHTML, replaySimulation, evidenceFocusHTML, predictionHTML, renderBar, renderPanel, onPanelClick },
    // 팀 기기에서 계획을 코드로 고친다(검사·시연 녹화용). 화면 조작과 같은 길(rev 올림 → 진행자에게 보냄).
    plan: fn => { const st = BG.current(); if (!st || !L || !["team", "solo"].includes(L.role) || lockMsg()) return false; fn(st);
      // 실제 화면 편집처럼 건설 문서도 저장한다(mountCity의 save와 같은 모양). 안 하면 새로고침 뒤 옛 문서가 실린다.
      if (L.doc?.maps && !L.away) { const pack = C.teamDef(R(), L.team).pack, z = tdata(); z.docs[pack] = { maps: L.doc.maps, runs: L.doc.runs, journal: L.doc.journal }; putData(z); }
      if (L.snap?.econ) { const { d, n } = monthNote(); n.buildCost = newBuildCost(L.snap); n.buildBudget = L.snap.teams[L.team].budget; n.confirmed = false; putData(d); } L.rev++; sendPlan(); BG.refresh(); return true; }
  };
})();
