(function () {
  "use strict";
  const TEXT = {
    kicker: "테스터판",
    title: "의견 보내기",
    warn: "이름·학번·학교·연락처는 쓰지 마세요.",
    intro: "아래 칸을 쓰고 [글 복사]를 눌러 메신저나 메일로 직접 보내 주세요. 게임이 자동으로 보내지는 않아요.",
    introSheet: "아래 칸을 쓰고 [보내기]를 누를 때만 선생님 시트로 보내요. [글 복사]로 메신저나 메일에 직접 보내도 돼요.",
    outNoteSheet: "판·날짜·화면·기기 정보가 붙고, [보내기]로 보내면 시트에 받은 시각도 적혀요. 방 코드·참가 링크·저장된 진행·약속·이유·일지는 어느 쪽에도 없어요.",
    fieldsHintSheet: "세 칸 중 하나 이상 써야 보내거나 복사할 수 있어요. 어느 화면에서 무엇을 하다가 그랬는지 함께 쓰면 좋아요.",
    draftNoteSheet: "쓰던 글은 보내거나 복사한 뒤에도 이 기기에 임시로 남아요. 다 보냈으면 [지우기]를 눌러 주세요.",
    send: "보내기",
    sending: "보내는 중이에요.",
    sent: "선생님 시트로 보냈어요.",
    sendFail: "보내지 못했어요. [글 복사]로 직접 보내 주세요.",
    sendDup: "같은 글이라 안 보냈어요. 고치거나 30초 뒤에 보낼 수 있어요.",
    piiGoSend: "그대로 보내기",
    roleLegend: "역할(선택 사항)",
    good: "좋았던 점",
    hard: "헷갈리거나 어려웠던 점",
    fix: "고쳤으면 하는 점",
    fieldsHint: "세 칸 중 하나 이상 써야 복사돼요. 어느 화면에서 무엇을 하다가 그랬는지 함께 쓰면 좋아요.",
    easyLegend: "쉬웠나요? (1 아주 어려움 ~ 5 아주 쉬움)",
    funLegend: "재미있었나요? (1 전혀 재미없음 ~ 5 아주 재미있음)",
    noRate: "고르지 않음",
    outLabel: "복사될 글",
    outNote: "판·날짜·화면·기기 정보가 함께 붙어요. 방 코드, 저장된 진행, 약속·이유·일지, 시각은 붙지 않아요.",
    copy: "글 복사",
    share: "공유",
    clear: "지우기",
    draftNote: "쓰던 글은 복사·공유한 뒤에도 이 기기에만 남아요. 보낸 뒤에는 [지우기]를 눌러 주세요.",
    copied: "복사했어요. 메신저나 메일에 붙여 넣어 보내 주세요.",
    copyFail: "자동 복사가 안 됐어요. 상자의 글이 선택되어 있으니 직접 복사해 주세요(아이패드는 길게 누르기, 컴퓨터는 Ctrl+C 또는 ⌘+C).",
    empty: "좋았던 점, 헷갈리거나 어려웠던 점, 고쳤으면 하는 점 가운데 하나 이상 써 주세요.",
    piiTitle: "개인정보일 수 있어요",
    piiBody: "쓴 글에 5자리 이상 이어진 숫자나 전화번호·이메일 모양이 있어요. 학번·연락처 같은 개인정보라면 지우고 보내 주세요.",
    piiEdit: "고치러 가기",
    piiGoCopy: "그대로 복사",
    piiGoShare: "그대로 공유",
    cleared: "쓰던 글을 지웠어요.",
    shareFail: "공유하지 못했어요. [글 복사]를 눌러 보내 주세요.",
    roles: { student: "학생", teacher: "교사", other: "기타" },
    shareTitle: "켄텍 연습실 테스터 의견"
  };
  const RESULT_TEXT = Object.freeze({
    title: "결과 보내기(테스터)",
    note: "[결과 보내기]를 누르면 아래 값만 선생님 시트로 보내요(한 판에 한 번). 예측·확신은 횟수만 가고 방 코드·참가 링크·이유·일지·끝 성찰은 안 가요.",
    valuesLabel: "보낼 값",
    button: "결과 보내기",
    sentButton: "보냈어요",
    sending: "보내는 중이에요.",
    sent: "선생님 시트로 보냈어요.",
    fail: "보내지 못했어요. 잠시 뒤 다시 눌러 주세요.",
    // 시트 판의 끝 화면 확신 보정 제목 꼬리(결과 보내기로 횟수가 나가므로 '기기에만'이 아니다).
    calibrationTag: "기기에 저장"
  });
  const KCP = window.KCP;
  const DRAFT_KEY = "kcp:feedback-draft-v1";
  const WORD_FIELDS = ["good", "hard", "fix"];
  const RATE_VALUES = ["", "1", "2", "3", "4", "5"];
  let modal = null, info = null, opener = null, pendingAction = null;
  let lastSend = null;
  const field = id => modal.el.querySelector("#fb-" + id);

  function sheetUrl() {
    const url = KCP.BUILD?.feedbackUrl;
    return typeof url === "string" && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.trim()) ? url.trim() : "";
  }

  function buildLabel(build = KCP.BUILD || {}) {
    build = build || {};
    // 배포 사본의 값이 문자열이 아니어도 예외 없이 글로 만든다.
    return `${build.label || "개발판"}${build.sha ? " · 커밋 " + String(build.sha).slice(0, 12) : ""}${build.date ? " · " + build.date : ""}`;
  }

  async function send(kind, fields) {
    const url = sheetUrl();
    if (!url) return false;
    try {
      await fetch(url, { method: "POST", mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ kind, fields }) });
      return true;
    } catch (_) { return false; }
  }

  function sheetFields(info, fields) {
    const league = info.league;
    const word = key => (fields[key] || "").replace(/\r\n/g, "\n").trim();
    const rate = value => RATE_VALUES.includes(value) && value ? Number(value) : "";
    return {
      "판": buildLabel(info.build), "화면 경로": info.route, "화면 크기": info.size,
      "기기": `${info.browser} · 터치 ${info.touch} · ${info.scheme}`,
      "모드": league ? league.mode : "", "도시": league?.city || "",
      "달": league ? `${league.month}/${league.total}달${league.monthLabel ? " (" + league.monthLabel + ")" : ""}` : "",
      "단계": league ? league.phase : "", "서랍": league ? league.drawer : "",
      "역할": Object.hasOwn(TEXT.roles, fields.role) ? TEXT.roles[fields.role] : "",
      "좋았던 점": word("good"), "헷갈리거나 어려웠던 점": word("hard"), "고쳤으면 하는 점": word("fix"),
      "쉬웠나요": rate(fields.easy), "재미있었나요": rate(fields.fun)
    };
  }

  function routeName(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    if (!raw) return "#home";
    const [name, argument = ""] = raw.split("/");
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return "#?";
    const first = argument.split(/[\/=?&#]/)[0];
    return "#" + name + (/^[A-Za-z0-9_-]+$/.test(first) ? "/" + first : "");
  }

  function browserFamily(ua, maxTouchPoints) {
    const browser = [
      [/SamsungBrowser\//, "삼성 인터넷"], [/Whale\//, "웨일"],
      [/Edg(?:A|iOS)?\//, "Edge"], [/OPR\//, "Opera"],
      [/(?:Firefox|FxiOS)\//, "Firefox"],
      [/(?:CriOS|Chrome|HeadlessChrome|Chromium)\//, "Chrome"], [/Safari\//, "Safari"]
    ].find(([pattern]) => pattern.test(ua))?.[1] || "기타";
    const os = [
      [/iPad/, "iPadOS"], [/iPhone|iPod/, "iOS"], [/Android/, "Android"],
      [/CrOS/, "ChromeOS"], [/Windows/, "Windows"],
      [/Macintosh/, maxTouchPoints > 1 ? "iPadOS" : "macOS"],
      [/Mac OS X/, "macOS"], [/Linux/, "Linux"]
    ].find(([pattern]) => pattern.test(ua))?.[1] || "기타";
    return `${browser}·${os}`;
  }

  function piiKinds(text) {
    return [
      ["digits", /\d{5,}/],
      ["phone", /(?:^|[^\d])(?:\+82[-.\s]?|0)(?:1[016789]|[2-6]\d?)[-.\s)]?\d{3,4}[-.\s]?\d{4}(?!\d)/],
      ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/]
    ].filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  }

  function compose(info, fields) {
    const lines = [
      "[켄텍 연습실 테스터 의견]", `날짜: ${info.date}`,
      `판: ${buildLabel(info.build)}`,
      `화면: ${info.route}`, `화면 크기: ${info.size}`, `터치: ${info.touch}`,
      `화면 밝기: ${info.scheme}`, `브라우저: ${info.browser}`
    ];
    const league = info.league;
    if (league) lines.push(
      `리그 모드: ${league.mode}`, `도시: ${league.city || "없음"}`,
      `달: ${league.month}/${league.total}${league.monthLabel ? " (" + league.monthLabel + ")" : ""}`,
      `단계: ${league.phase}`, `열린 서랍: ${league.drawer}`
    );
    const rate = value => RATE_VALUES.includes(value) && value ? value + "/5" : "고르지 않음";
    lines.push("", `역할: ${TEXT.roles[fields.role] || "고르지 않음"}`,
      `쉬웠나요: ${rate(fields.easy)}`, `재미있었나요: ${rate(fields.fun)}`);
    const headings = ["좋았던 점:", "헷갈리거나 어려웠던 점:", "고쳤으면 하는 점:"];
    WORD_FIELDS.forEach((key, i) => {
      lines.push(headings[i], (fields[key] || "").replace(/\r\n/g, "\n").trim() || "(쓰지 않음)");
    });
    return lines.join("\n");
  }

  function cleanFields(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const fields = { role: ["student", "teacher", "other"].includes(source.role) ? source.role : "" };
    WORD_FIELDS.forEach(key => { fields[key] = typeof source[key] === "string" ? source[key].slice(0, 2000) : ""; });
    ["easy", "fun"].forEach(key => { fields[key] = RATE_VALUES.includes(source[key]) ? source[key] : ""; });
    return fields;
  }

  function readDraft() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
      return cleanFields(raw?.v === 1 ? raw : null);
    } catch (_) { return cleanFields(null); }
  }

  function values() {
    const fields = {};
    WORD_FIELDS.forEach(key => { fields[key] = field(key).value; });
    ["role", "easy", "fun"].forEach(key => {
      fields[key] = field(key).querySelector("input:checked")?.value || "";
    });
    return fields;
  }

  function fill(fields) {
    WORD_FIELDS.forEach(key => { field(key).value = fields[key]; });
    ["role", "easy", "fun"].forEach(key => {
      field(key).querySelectorAll("input").forEach(input => { input.checked = input.value === fields[key]; });
    });
  }

  function refresh() { if (info) field("out").value = compose(info, values()); }
  function hidePii() { field("pii").hidden = true; pendingAction = null; }
  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_) { /* 저장소 오류가 있어도 칸은 비운다. */ }
    if (!modal) return;
    fill(cleanFields(null));
    hidePii();
    field("status").textContent = "";
    refresh();
  }

  function changed() {
    hidePii();
    field("status").textContent = "";
    const fields = values();
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, ...fields })); } catch (_) { /* 저장 실패가 작성을 막지 않게 한다. */ }
    refresh();
  }

  async function perform(action) {
    field("status").textContent = "";
    if (action === "copy") {
      try {
        if (typeof navigator.clipboard?.writeText !== "function") throw new Error();
        await navigator.clipboard.writeText(text());
        field("status").textContent = TEXT.copied;
      } catch (_) {
        const out = field("out");
        out.focus();
        out.select();
        out.setSelectionRange(0, out.value.length);
        field("status").textContent = TEXT.copyFail;
      }
    } else if (action === "send") {
      const fields = values(), key = JSON.stringify(fields), at = Date.now();
      if (lastSend?.key === key && at - lastSend.at < 30000) {
        field("status").textContent = TEXT.sendDup;
        return;
      }
      const attempt = { key, at };
      lastSend = attempt;
      field("status").textContent = TEXT.sending;
      const sent = await send("feedback", sheetFields(info, fields));
      field("status").textContent = sent ? TEXT.sent : TEXT.sendFail;
      if (!sent && lastSend === attempt) lastSend = null;
    } else {
      try { await navigator.share({ title: TEXT.shareTitle, text: text() }); }
      catch (error) { if (error?.name !== "AbortError") field("status").textContent = TEXT.shareFail; }
    }
  }

  function request(action) {
    const fields = values();
    hidePii();
    field("status").textContent = "";
    if (WORD_FIELDS.every(key => !fields[key].trim())) {
      field("status").textContent = TEXT.empty;
      field("good").focus();
      return;
    }
    if (piiKinds(WORD_FIELDS.map(key => fields[key]).join("\n")).length) {
      pendingAction = action;
      field("pii-go").textContent = action === "send" ? TEXT.piiGoSend : action === "copy" ? TEXT.piiGoCopy : TEXT.piiGoShare;
      field("pii").hidden = false;
      field("pii-edit").focus();
      return;
    }
    perform(action);
  }

  function create() {
    const esc = KCP.esc;
    modal = KCP.v2.dialog({ id: "kcp-feedback", kicker: TEXT.kicker, title: TEXT.title, className: "fb-modal" });
    const ratings = key => `<fieldset id="fb-${key}"><legend>${esc(TEXT[key + "Legend"])}</legend><div class="fb-options">${RATE_VALUES.map(value => `<label><input type="radio" name="fb-${key}" value="${value}"${value ? "" : " checked"}>${esc(value || TEXT.noRate)}</label>`).join("")}</div></fieldset>`;
    modal.body.innerHTML = `
      <p id="fb-warn" class="fb-warn">${esc(TEXT.warn)}</p>
      <p id="fb-intro">${esc(TEXT.intro)}</p>
      <fieldset id="fb-role"><legend>${esc(TEXT.roleLegend)}</legend><div class="fb-options">${Object.entries(TEXT.roles).map(([value, label]) => `<label><input type="radio" name="fb-role" value="${value}">${esc(label)}</label>`).join("")}</div></fieldset>
      <p id="fb-fields-hint">${esc(TEXT.fieldsHint)}</p>
      ${WORD_FIELDS.map(key => `<div class="fb-field"><label for="fb-${key}">${esc(TEXT[key])}</label><textarea id="fb-${key}" maxlength="2000" rows="3" aria-describedby="fb-fields-hint"></textarea></div>`).join("")}
      ${ratings("easy")}${ratings("fun")}
      <label for="fb-out">${esc(TEXT.outLabel)}</label>
      <p id="fb-out-note">${esc(TEXT.outNote)}</p>
      <textarea id="fb-out" readonly rows="10" aria-describedby="fb-out-note"></textarea>
      <div id="fb-pii" hidden role="group" aria-labelledby="fb-pii-title">
        <p id="fb-pii-title">${esc(TEXT.piiTitle)}</p><p>${esc(TEXT.piiBody)}</p>
        <div class="fb-actions"><button type="button" id="fb-pii-edit" class="v2-btn">${esc(TEXT.piiEdit)}</button><button type="button" id="fb-pii-go" class="v2-btn">${esc(TEXT.piiGoCopy)}</button></div>
      </div>
      <div class="fb-actions"><button type="button" id="fb-send" class="v2-btn primary" hidden>${esc(TEXT.send)}</button><button type="button" id="fb-copy" class="v2-btn primary">${esc(TEXT.copy)}</button><button type="button" id="fb-share" class="v2-btn" hidden>${esc(TEXT.share)}</button><button type="button" id="fb-clear" class="v2-btn">${esc(TEXT.clear)}</button></div>
      <p id="fb-status" role="status" aria-live="polite"></p>
      <p id="fb-draft-note">${esc(TEXT.draftNote)}</p>`;
    // 학생이 테스터라 창을 열 때 경고 줄도 함께 읽히게 한다(첫 초점은 닫기 단추).
    modal.el.setAttribute("aria-describedby", "fb-warn");
    document.body.appendChild(modal.el);
    modal.el.addEventListener("close", () => {
      // 서랍이 다시 그려져도 기존 처리기 뒤에서 새 단추로 초점을 돌린다.
      if (opener && !opener.isConnected && ["fb-open-home", "fb-open-settings", "lg-feedback"].includes(opener.id)) {
        document.getElementById(opener.id)?.focus({ preventScroll: true });
      }
      opener = null;
      hidePii();
    });
    WORD_FIELDS.concat(["role", "easy", "fun"]).forEach(key => {
      field(key).addEventListener("input", changed);
      field(key).addEventListener("change", changed);
    });
    field("send").onclick = () => request("send");
    field("copy").onclick = () => request("copy");
    field("share").onclick = () => request("share");
    field("clear").onclick = () => {
      clearDraft();
      field("status").textContent = TEXT.cleared;
      field("good").focus();
    };
    field("pii-edit").onclick = () => {
      hidePii();
      const key = WORD_FIELDS.find(key => piiKinds(field(key).value).length) || "good";
      field(key).focus();
    };
    field("pii-go").onclick = () => {
      const action = pendingAction;
      hidePii();
      // 누른 단추가 숨으면 초점이 문서로 빠진다. 먼저 원래 동작 단추로 옮기고(복사 실패면 perform이 글 상자로 옮김) 실행한다.
      if (action) { field(action).focus(); perform(action); }
    };
  }

  function open(context, from) {
    if (!modal) create();
    const now = new Date(), build = KCP.BUILD || { label: "개발판", sha: "", date: "" };
    info = {
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      // 배포 사본이 label을 빠뜨려도 "판: undefined"가 되지 않게 기본 이름으로 받는다.
      build: { label: String(build.label || "개발판"), sha: String(build.sha || "").slice(0, 12), date: String(build.date || "") },
      route: routeName(window.location.hash), size: `${window.innerWidth}×${window.innerHeight}`,
      touch: navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches ? "예" : "아니요",
      scheme: KCP.v2.scheme() === "dark" ? "어두움" : "밝음",
      browser: browserFamily(navigator.userAgent, navigator.maxTouchPoints),
      league: context?.league
    };
    fill(readDraft());
    hidePii();
    field("status").textContent = "";
    field("share").hidden = typeof navigator.share !== "function";
    const hasSheet = !!sheetUrl();
    field("send").hidden = !hasSheet;
    field("copy").classList.toggle("primary", !hasSheet);
    [["intro", "intro"], ["out-note", "outNote"], ["fields-hint", "fieldsHint"], ["draft-note", "draftNote"]].forEach(([id, key]) => {
      field(id).textContent = TEXT[key + (hasSheet ? "Sheet" : "")];
    });
    refresh();
    if (!modal.el.open) {
      opener = from || document.activeElement;
      modal.open(opener);
    }
  }

  function close() { modal?.close(); }
  function text() { return modal ? field("out").value : ""; }
  KCP.feedback = { open, close, text, DRAFT_KEY, routeName, browserFamily, piiKinds, compose, sheetUrl, buildLabel, sheetFields, send, RESULT_TEXT };
  KCP.on?.("route:change", close);
  KCP.on?.("storage:clear", clearDraft);
  window.addEventListener?.("resize", () => {
    if (!modal?.el.open) return;
    info.size = `${window.innerWidth}×${window.innerHeight}`;
    refresh();
  });
})();
