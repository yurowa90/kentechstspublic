/* 멀티플레이 연결. 모두 같은 모양: open(opts) → { send(ev, data), on(ev, fn), status(), onStatus(fn), close() }
 * - local: 같은 브라우저의 탭끼리(BroadcastChannel). 교사 PC 한 대에서 시연·연습할 때, 검사할 때.
 * - supabase: Supabase Realtime의 Broadcast(서버에 저장하지 않는 실시간 중계). 태블릿마다 다른 기기일 때.
 *   라이브러리 없이 Phoenix 웹소켓 규약(vsn 1.0.0)을 직접 쓴다 — 앱에 외부 스크립트를 들이지 않기 위해(D-31).
 *   필요한 것: 프로젝트 주소(ref 또는 https://<ref>.supabase.co)와 공개(publishable/anon) 키. 학생 개인정보는 보내지 않는다.
 * 메시지는 모두 받는 쪽에서 믿지 않고 검사한다(league-core.reduce).
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const MAX_BYTES = 200000; // 로컬 BroadcastChannel의 기존 제한.
  const SEND_CAP = 256000; // Supabase 무료 요금제 문서상 256KB. 실측 256KB까지 도착, 300KB 이상은 error로 거부됐다.
  const ACK_WAIT = 5000; // 실제 측정 지연 중앙 약 230ms·최대 약 500ms에 재시도 여유를 둔다.

  // 공개 키 입력 실수를 막는 검사다. JWT 서명을 검증하는 인증 절차는 아니다.
  function publicKeyProblem(key) {
    key = String(key || "").trim();
    if (key.includes("sb_secret_")) return "secret";
    if (!key.startsWith("eyJ")) return null;
    try {
      // JWT는 header.payload.signature 세 부분이어야 한다(서명 검증은 하지 않는다 — 실수 방지 목적).
      const parts = key.split("."), part = parts[1];
      if (parts.length !== 3 || !parts[2] || !part || !/^[A-Za-z0-9_-]+={0,2}$/.test(part)) return "malformed";
      const encoded = part.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(encoded + "=".repeat((4 - encoded.length % 4) % 4)), c => c.charCodeAt(0))
      ));
      if (payload?.role === "service_role") return "service_role";
      return payload?.role === "anon" ? null : "not_anon";
    } catch (e) { return "malformed"; }
  }

  const bytes = value => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const secure = () => !!globalThis.crypto?.subtle;
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const signing = { name: "ECDSA", hash: "SHA-256" };
  function publicJWK(key) {
    if (!key || key.kty !== "EC" || key.crv !== "P-256" || typeof key.x !== "string" || typeof key.y !== "string" || key.d != null) throw new Error("key");
    return { kty: "EC", crv: "P-256", x: key.x, y: key.y };
  }
  async function createIdentity() {
    const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    return { publicKey: publicJWK(await crypto.subtle.exportKey("jwk", pair.publicKey)), privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey), n: 0 };
  }
  async function fingerprint(key) {
    const digest = await crypto.subtle.digest("SHA-256", bytes(publicJWK(key)));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }
  // JSON 값만 서명한다. 객체 키 재정렬·1.0 → 1·-0 → 0은 같은 바이트가 된다.
  function canonical(value) {
    const encode = v => {
      if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
      if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
      if (Array.isArray(v)) return "[" + Array.from(v, encode).join(",") + "]";
      if (v && typeof v === "object" && Object.prototype.toString.call(v) === "[object Object]" &&
          (Object.getPrototypeOf(v) === null || Object.getPrototypeOf(v).constructor?.name === "Object"))
        return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + encode(v[k])).join(",") + "}";
      throw Error("non-json");
    };
    return encode(value);
  }
  const sessionId = () => crypto.randomUUID();
  async function hostBinding(key) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(canonical(publicJWK(key)))));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32글자, 8자리 = 40비트
    const bits = Array.from(hash.slice(0, 5), b => b.toString(2).padStart(8, "0")).join("");
    const room = Array.from({ length: 8 }, (_, i) => alphabet[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join("");
    return { room, fingerprint: btoa(String.fromCharCode(...hash)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22) };
  }
  // D-77: 행 사전은 고정된 네 경로에서만 쓴다. 재계산·임의 경로 참조는 하지 않는다.
  // 중복 참조도 아래 세 경로만 허용한다. 각 원본은 econ의 같은 이름 필드다.
  // [-2]는 판 2의 참조, _refs의 비트는 적용 경로다. 참조 없는 판 1은 옛 형식을 유지한다.
  const snapshotRefs = [["report", "score"], ["report", "offers"], ["scoreState", "totals"]];
  const snapshotObject = x => x !== null && typeof x === "object" && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === null || Object.getPrototypeOf(x).constructor?.name === "Object");
  const snapshotKey = k => typeof k === "string" && !["__proto__", "constructor", "prototype"].includes(k);
  function snapshotSafe(value) {
    if (!value || typeof value !== "object") return true;
    return Object.keys(value).every(k => snapshotKey(k) && snapshotSafe(value[k]));
  }
  function snapshotEnvelope(view, keys, refs) {
    // 수신기의 서명 세션 결속 검사는 확장 전이므로 기존 sid도 최상위에 둔다.
    const { room, region, sid, ...body } = view;
    return { _cp: refs ? 2 : 1, ...(Object.hasOwn(view, "room") ? { room } : {}),
      ...(Object.hasOwn(view, "region") ? { region } : {}),
      ...(Object.hasOwn(view, "sid") ? { sid } : {}), ...(refs ? { _refs: refs } : {}), keys, body };
  }
  function snapshotRows(view, row, packing) {
    for (const t of Object.values(view.teams || {}))
      if (snapshotObject(t) && Array.isArray(t.hist)) t.hist = t.hist.map(row);
    for (const c of Object.values(view.econ?.cities || {}))
      if (snapshotObject(c) && Array.isArray(c.hist)) c.hist = c.hist.map(row);
    if (Array.isArray(view.results)) view.results = view.results.map(value => {
      // team 없는 옛 결과도 통째로 보존한다. 배열 원본과 행 배열은 -1 표지로 구분한다.
      if (packing) {
        if (!snapshotObject(value) || !snapshotObject(value.team)) return [-1, value];
        value.team = Object.fromEntries(Object.entries(value.team).map(([id, t]) => [id, row(t)]));
        return row(value);
      }
      const result = row(value);
      if (value[0] !== -1) {
        if (!snapshotObject(result) || !snapshotObject(result.team)) throw Error("snapshot-row");
        result.team = Object.fromEntries(Object.entries(result.team).map(([id, t]) => [id, row(t)]));
      }
      return result;
    });
  }
  // base와 배분은 정확한 두 필드일 때만 기존 행 배열로 바꾼다(누락·추가 필드 보존).
  function compactSnapshot(data) {
    const view = JSON.parse(JSON.stringify(data));
    if (!snapshotSafe(view)) throw Error("snapshot-key");
    let refs = 0;
    const econ = view.econ;
    if (snapshotObject(econ)) snapshotRefs.forEach(([parent, key], i) => {
      const target = econ[parent];
      // 깊은 값 비교와 함께 키 순서도 확인해 펼친 JSON 바이트까지 보존한다.
      // previousScore는 운영 전 점수이므로 현재 점수의 참조로 바꾸지 않는다.
      if (snapshotObject(target) && Object.hasOwn(target, key) && Object.hasOwn(econ, key) &&
          canonical(target[key]) === canonical(econ[key]) &&
          JSON.stringify(target[key]) === JSON.stringify(econ[key]) && bytes(target[key]).length > 4) {
        target[key] = [-2]; refs |= 1 << i;
      }
    });
    const pairs = (rows, a, b) => Array.isArray(rows) && rows.every(x => snapshotObject(x) &&
      Object.keys(x).length === 2 && Object.hasOwn(x, a) && Object.hasOwn(x, b));
    for (const t of Object.values(view.teams || {}).filter(snapshotObject)) {
      if (!Object.hasOwn(t, "baseRows") && pairs(t.base, "k", "c")) {
        t.baseRows = t.base.map(({ k, c }) => [k, c]); delete t.base;
      }
      if (snapshotObject(t.trialGrid) && !Object.hasOwn(t.trialGrid, "rows") && pairs(t.trialGrid.entries, "key", "allocatedMW")) {
        t.trialGrid.rows = t.trialGrid.entries.map(({ key, allocatedMW }) => [key, allocatedMW]);
        delete t.trialGrid.entries;
      }
    }
    const pack = () => {
      const keys = [], index = new Map();
      const row = obj => {
        if (!snapshotObject(obj)) return [-1, obj];
        const ks = Object.keys(obj), signature = JSON.stringify(ks);
        if (!index.has(signature)) { index.set(signature, keys.length); keys.push(ks); }
        return [index.get(signature), ...ks.map(k => obj[k])];
      };
      snapshotRows(view, row, true);
      return snapshotEnvelope(view, keys, refs);
    };
    // 사전까지 포함한 최종 봉투로 판단한다. 행마다 축약률이 달라 보정은 최대 두 번이다.
    const MAX_COMPACTION_PASSES = 2;
    let packed = pack(), size = bytes(packed).length;
    if (size > 178000) {
      for (let pass = 0; pass < MAX_COMPACTION_PASSES && size > 178000; pass++) {
        // base·배분은 유지하고, 기록만 객체로 되돌린 뒤 비율을 한 번 계산한다.
        snapshotRows(view, values => values[0] === -1 ? values[1] :
          Object.fromEntries(packed.keys[values[0]].map((k, i) => [k, values[i + 1]])), false);
        // 예전 저장에 남은 계획 전문은 그 팀의 건설 속도 요약으로 바꾼다.
        for (const t of Object.values(view.teams || {}).filter(snapshotObject)) {
          (Array.isArray(t.hist) ? t.hist : []).forEach((row, i) => {
            if (!snapshotObject(row)) return;
            if (i >= t.hist.length - 2 || !row.plan) return;
            const summary = Object.fromEntries(["t", "r", "cap", "n", "l"].filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]]));
            // 객체 바이트로 절감량을 근사한다. 다음 차례 여부는 재포장한 봉투 실측으로 결정한다.
            size -= bytes(row).length - bytes(summary).length;
            t.hist[i] = summary;
          });
        }
        const rows = Object.values(view.teams || {}).filter(snapshotObject).flatMap(t => (Array.isArray(t.hist) ? t.hist : []).slice(0, -2).map(row => ({ t, row, size: bytes(row).length + 1 })));
        const removable = rows.reduce((sum, x) => sum + x.size, 0);
        const ratio = Math.max(0, Math.min(1, (size - 177000) / Math.max(1, removable)));
        for (const t of Object.values(view.teams || {}).filter(snapshotObject)) {
          const old = rows.filter(x => x.t === t), target = old.reduce((sum, x) => sum + x.size, 0) * ratio;
          let removed = 0, count = 0;
          while (count < old.length && removed < target) removed += old[count++].size;
          if (count) t.hist = t.hist.slice(count);
        }
        // 한 행씩 전체를 재측정하지 않는다. 한 차례 삭제가 끝난 뒤 한 번만 재포장한다.
        packed = pack();
        size = bytes(packed).length;
      }
    }
    return packed;
  }
  function expandSnapshot(view) {
    if (!snapshotObject(view)) return null;
    try {
      if (Object.hasOwn(view, "_cp")) {
        if ((view._cp !== 1 && view._cp !== 2) || !snapshotObject(view.body) || !Array.isArray(view.keys) || !snapshotSafe(view)) return null;
        if ((view._cp === 2) !== Object.hasOwn(view, "_refs")) return null;
        const keys = view.keys;
        if (!keys.every(ks => Array.isArray(ks) && ks.every(snapshotKey) && new Set(ks).size === ks.length)) return null;
        const row = values => {
          if (!Array.isArray(values)) throw Error("snapshot-row");
          if (values[0] === -1 && values.length === 2) return values[1];
          const ks = Number.isSafeInteger(values[0]) && values[0] >= 0 && keys[values[0]];
          if (!ks || values.length !== ks.length + 1) throw Error("snapshot-row");
          return Object.fromEntries(ks.map((k, i) => [k, values[i + 1]]));
        };
        const envelope = view;
        view = envelope.body;
        if (Object.hasOwn(envelope, "room")) view.room = envelope.room;
        if (Object.hasOwn(envelope, "region")) view.region = envelope.region;
        if (Object.hasOwn(envelope, "sid")) view.sid = envelope.sid;
        snapshotRows(view, row, false);
        if (Object.hasOwn(envelope, "_refs")) {
          const refs = envelope._refs, econ = view.econ;
          if (!Number.isSafeInteger(refs) || refs <= 0 || refs >= 1 << snapshotRefs.length || !snapshotObject(econ)) return null;
          for (const [i, [parent, key]] of snapshotRefs.entries()) {
            if (!(refs & 1 << i)) continue;
            const target = econ[parent], marker = target?.[key];
            if (!snapshotObject(target) || !Array.isArray(marker) || marker.length !== 1 || marker[0] !== -2 ||
                !Object.hasOwn(econ, key)) return null;
            target[key] = JSON.parse(JSON.stringify(econ[key]));
          }
        }
      }
      // _cp 없는 옛 진행자·혼자 하기 값에는 기존 base/배분 복원만 적용한다.
      for (const t of Object.values(view.teams || {}).filter(snapshotObject)) {
        if (t.baseRows && !Object.hasOwn(t, "base")) { t.base = t.baseRows.map(([k, c]) => ({ k, c })); delete t.baseRows; }
        if (t.trialGrid?.rows && !Object.hasOwn(t.trialGrid, "entries")) {
          t.trialGrid.entries = t.trialGrid.rows.map(([key, allocatedMW]) => ({ key, allocatedMW }));
          delete t.trialGrid.rows;
        }
      }
      return view;
    } catch (_) { return null; }
  }
  async function signHost(identity, event, room, sid, data) {
    identity.n = Math.max(Date.now(), (identity.n || 0) + 1);
    const wire = JSON.parse(JSON.stringify({ event, room, sid, n: identity.n, data: event === "snap" ? compactSnapshot(data) : data, hostKey: identity.publicKey }));
    const key = await crypto.subtle.importKey("jwk", identity.privateKey, algorithm, false, ["sign"]);
    wire.sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign(signing, key, bytes(canonical(wire))))));
    return wire;
  }
  function hostReceiver(trust, apply, rejected = () => {}) {
    let chain = Promise.resolve(), queued = 0, waitingSnap = null;
    const retiredSessions = new Set();
    const cheap = wire => wire && wire.event && wire.room === trust.room && typeof wire.sid === "string" && wire.sid.length <= 64 &&
      Number.isSafeInteger(wire.n) && wire.n > (trust.hostN || 0) &&
      (!trust.sid || wire.sid === trust.sid || wire.event === "snap" && !retiredSessions.has(wire.sid));
    return (event, incoming) => {
      const snap = event === "snap";
      // 16개 상한은 snap이 아닌 메시지(ack·nack)만 센다. snap은 아래에서 최신 하나만 기다리게 한다.
      if (!snap && queued >= 16 || !cheap(incoming) || incoming.event !== event) return Promise.resolve(false);
      try {
        if (typeof incoming.sig !== "string" || incoming.sig.length > 128) return Promise.resolve(false);
        if (bytes(incoming).length > SEND_CAP) return Promise.resolve(false);
      } catch (_) { rejected(event); return Promise.resolve(false); }
      // 공개 상태는 가장 새것만 쓸모 있다. 검증을 시작하지 않은 옛 snap은 '처리하지 않음'으로 건너뛴다.
      // 건너뛴 snap은 hostN을 올리지 않으므로 순번 재사용 검사는 실제로 검증하는 snap에 그대로 걸린다.
      // 늦게 도착한 옛 순번 snap이 기다리던 더 새 snap을 밀어내지 못하게 순번으로 비교한다.
      // 밀어내지 못한 snap도 예비 후보로 둔다(순번이 가장 큰 하나). 기다리던 snap이 순번만 큰 위조여도 그 뒤 정상 snap이 남는다.
      if (snap && waitingSnap && waitingSnap.incoming.n >= incoming.n) {
        if (!waitingSnap.prev || waitingSnap.prev.incoming.n < incoming.n) waitingSnap.prev = { incoming };
        return Promise.resolve(false);
      }
      const item = { incoming, skip: false, prev: null };
      if (snap) {
        // 밀려난 snap 하나는 예비로 둔다. 최신 snap이 위조라 거절되면 그것을 대신 검증한다(예비 후보는 순번이 가장 큰 하나).
        if (waitingSnap) { waitingSnap.skip = true; item.prev = waitingSnap; waitingSnap.prev = null; }
        waitingSnap = item;
      } else queued++;
      const check = async it => {
        const { sig, ...data } = it.incoming;
        const json = canonical(data), signed = JSON.parse(json), wire = { ...signed, sig };
        if (!cheap(wire)) return false;
        const binding = await hostBinding(wire.hostKey);
        if (binding.room !== trust.room || trust.fingerprint && binding.fingerprint !== trust.fingerprint ||
            trust.hostKey && canonical(publicJWK(trust.hostKey)) !== canonical(publicJWK(wire.hostKey))) throw Error("host");
        const key = await crypto.subtle.importKey("jwk", publicJWK(wire.hostKey), algorithm, false, ["verify"]);
        if (!await crypto.subtle.verify(signing, key, Uint8Array.from(atob(sig), c => c.charCodeAt(0)), bytes(json))) throw Error("host");
        if (event === "snap" && (wire.data?.sid !== wire.sid || wire.data?.room !== trust.room)) throw Error("host");
        it.prev = null; // 검증을 통과했으니 예비는 필요 없다(무거운 apply 동안 붙잡지 않음, apply 예외 때 옛 상태 재반영도 막음).
        if (trust.sid && trust.sid !== wire.sid) retiredSessions.add(trust.sid);
        trust.hostKey = publicJWK(wire.hostKey); trust.fingerprint = binding.fingerprint;
        trust.sid = wire.sid; trust.hostN = wire.n;
        await apply(event, signed.data);
        return true;
      };
      const work = async () => {
        if (waitingSnap === item) waitingSnap = null;
        // 건너뛴 snap의 내용은 뒤 snap의 예비로 남을 수 있어 여기서 지우지 않는다.
        if (item.skip) return false;
        try {
          try { return await check(item); }
          catch (_) {
            rejected(event);
            const back = item.prev; item.prev = null;
            if (!back) return false;
            try { return await check(back); } catch (_) { rejected(event); return false; }
          }
        } finally { if (!snap) queued--; item.incoming = null; item.prev = null; }
      };
      chain = chain.then(work);
      return chain;
    };
  }
  // body 문자열 자체를 서명한다. 봉투 객체의 키 순서와 바깥 메타데이터는 인증 근거가 아니다.
  async function signEnvelope(identity, team, request, now = Date.now()) {
    identity.n = Math.max(now, (identity.n || 0) + 1);
    const body = JSON.stringify({ ...request, ...(request.id ? { born: request.born ?? identity.n } : {}), team, kid: await fingerprint(identity.publicKey), n: identity.n });
    const key = await crypto.subtle.importKey("jwk", identity.privateKey, algorithm, false, ["sign"]);
    const sig = await crypto.subtle.sign(signing, key, bytes(body));
    return { team, body, sig: btoa(String.fromCharCode(...new Uint8Array(sig))) };
  }
  async function verifyEnvelope(envelope, publicKey) {
    try {
      if (typeof envelope?.body !== "string" || typeof envelope.sig !== "string") return false;
      const key = await crypto.subtle.importKey("jwk", publicJWK(publicKey), algorithm, false, ["verify"]);
      return await crypto.subtle.verify(signing, key, Uint8Array.from(atob(envelope.sig), c => c.charCodeAt(0)), bytes(envelope.body));
    } catch (_) { return false; }
  }
  function requestBody(envelope) {
    try { return JSON.parse(envelope.body); } catch (_) { return null; }
  }
  // 팀별로 검증과 반영을 한 사슬에서 실행한다. apply에는 검증된 값만 들어간다.
  function receiver(S, apply, verify = verifyEnvelope) {
    const chains = new Map(), queued = new Map();
    return envelope => {
      const team = envelope?.team;
      if (typeof team !== "string" || !Object.hasOwn(S.teams, team) || (queued.get(team) || 0) >= 16 || typeof envelope.body !== "string" || envelope.body.length > SEND_CAP || bytes(envelope.body).length > SEND_CAP || typeof envelope.sig !== "string" || envelope.sig.length > 128) return Promise.resolve({ ok: false, err: "bad" });
      const wire = { team, body: envelope.body, sig: envelope.sig };
      queued.set(team, (queued.get(team) || 0) + 1);
      const work = async () => {
        const m = requestBody(wire), T = S.teams[team];
        if (!m || m.team !== team || typeof m.type !== "string" || !Number.isSafeInteger(m.n) || m.n <= 0 || bytes(wire.body).length > SEND_CAP) return { ok: false, err: "bad" };
        const claim = m.type === "claim", epoch = T.seatVersion || 0;
        const stateful = ["hello", "plan", "econ", "crit", "ready"].includes(m.type);
        // kick 뒤 새 키/자리는 독립된 순번 공간이다. lastN은 퇴거 차단용 최댓값으로 남긴다.
        const stateNs = T.lastNByType?.seat === epoch && T.lastNByType.kid === m.kid ? T.lastNByType : null;
        const lastN = () => stateful ? stateNs?.values[m.type] || 0 : T.lastN || 0;
        const reject = err => ({ ok: false, err, request: m });
        if (!S.sid || m.sid !== S.sid) return reject("session");
        if (m.seat !== epoch) return reject("seat");
        if (m.n <= Math.max(claim && T.token !== m.kid ? 0 : lastN(), T.retired?.[m.kid] || 0)) return reject("replay");
        if (m.id != null && (typeof m.id !== "string" || m.id.length > 64 || !Number.isSafeInteger(m.born) || m.born <= 0 || m.born > m.n)) return reject("bad");
        const key = claim ? m.publicKey : T.publicKey;
        if (!key || !await verify(wire, key)) return reject("signature");
        const token = await fingerprint(key);
        if (m.kid !== token) return reject("signature");
        if ((T.seatVersion || 0) !== epoch || m.seat !== epoch) return reject("seat");
        if (claim && T.token && (T.token !== token || !T.publicKey)) return reject(T.publicKey ? "taken" : "legacy");
        if (!claim && (!T.publicKey || T.token !== token)) return reject("seat");
        if (m.n <= Math.max(lastN(), T.retired?.[token] || 0)) return reject("replay");
        if (stateful) {
          T.lastNByType = stateNs || { seat: epoch, kid: token, values: {} };
          T.lastNByType.values[m.type] = m.n;
        }
        T.lastN = Math.max(T.lastN || 0, m.n);
        // 같은 요청 id를 새 순번으로 재전송해도 거래·연구를 두 번 적용하지 않는다.
        const cached = typeof m.id === "string" && T.receipts?.find(x => x.id === m.id && x.kid === token);
        // D-75는 자체적으로 멱등이다. 같은 id의 재전송도 추가 필드·판정 변경을 규칙에서 검사한다.
        if (cached && m.type !== "verdict") return { ...cached.result, quiet: true, request: m, verified: true };
        if (!cached && m.id && m.born <= (T.receiptFloor || 0)) return reject("expired");
        const trusted = { ...m, token };
        if (claim) trusted.publicKey = publicJWK(key);
        const result = apply(trusted);
        if (!cached && typeof m.id === "string" && m.id.length <= 64 && result.err !== "stale") {
          T.receipts ||= [];
          T.receipts.push({ id: m.id, born: m.born, kid: token, result });
          if (T.receipts.length > 64) T.receiptFloor = Math.max(T.receiptFloor || 0, T.receipts.shift().born || 0);
        }
        return { ...result, request: m, verified: true };
      };
      const next = (chains.get(team) || Promise.resolve()).then(work).catch(() => ({ ok: false, err: "bad" })).finally(() => queued.set(team, queued.get(team) - 1));
      chains.set(team, next);
      return next;
    };
  }
  function replyGate() {
    const rates = new Map();
    return (result, now = Date.now()) => {
      const m = result.request;
      if (!m || ["bad", "signature"].includes(result.err) || typeof m.kid !== "string" || !/^[a-f0-9]{64}$/.test(m.kid)) return null;
      if (!result.ok) {
        const rate = rates.get(m.team) || { at: now, count: 0 };
        if (now - rate.at >= 1000) { rate.at = now; rate.count = 0; }
        rates.set(m.team, rate);
        if (++rate.count > 2) return null; // 팀 전체 2회/초: kid를 바꿔도 증폭 불가
      }
      const reply = { team: m.team, kid: m.kid, n: m.n, type: m.type.slice(0, 32) };
      if (result.err) reply.err = result.err;
      for (const k of ["id", "rid"]) if (typeof m[k] === "string" && m[k].length <= 64) reply[k] = m[k];
      if (result.ok && m.type === "claim") reply.seat = m.seat;
      return reply;
    };
  }
  function broadcastMessage(room, ev, data, ref = "1", joinRef = "1") {
    return { topic: "realtime:kcp-league-" + room, event: "broadcast", payload: { type: "broadcast", event: ev, payload: data }, ref, join_ref: joinRef };
  }

  function hub() {
    const fns = new Map(), sfns = [];
    let st = "connecting";
    return {
      on(ev, fn) { if (!fns.has(ev)) fns.set(ev, []); fns.get(ev).push(fn); },
      fire(ev, data) { (fns.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.warn(e); } }); },
      onStatus(fn) { sfns.push(fn); fn(st); },
      set(s) { if (s !== st) { st = s; sfns.forEach(fn => fn(s)); } },
      get status() { return st; }
    };
  }

  function local(room) {
    const H = hub();
    if (typeof BroadcastChannel !== "function") { H.set("error"); return { send() {}, on: H.on, onStatus: H.onStatus, status: () => H.status, close() {} }; }
    const ch = new BroadcastChannel("kcp-league-" + room);
    ch.onmessage = e => { const m = e.data; if (m && typeof m.ev === "string") H.fire(m.ev, m.data); };
    setTimeout(() => H.set("open"), 0);
    return {
      kind: "local",
      send(ev, data) { if (bytes({ ev, data }).length > MAX_BYTES) { H.fire("oversize", { ev }); return false; } try { ch.postMessage({ ev, data }); return true; } catch (e) { console.warn(e); return false; } },
      on: H.on, onStatus: H.onStatus, status: () => H.status,
      close() { ch.close(); H.set("closed"); }
    };
  }

  // 프로젝트 주소 → 웹소켓 주소. 검사용으로 ws://… 전체 주소도 받는다.
  function wsUrl(url, key) {
    let base = String(url || "").trim();
    if (/^wss?:\/\//.test(base)) return base + (base.includes("?") ? "&" : "?") + "apikey=" + encodeURIComponent(key) + "&vsn=1.0.0";
    if (/^[a-z0-9]{20}$/.test(base)) base = "https://" + base + ".supabase.co";
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)) return null;
    return base.replace(/^https/, "wss").replace(/\/$/, "") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(key) + "&vsn=1.0.0";
  }

  function supabase(room, url, key, canSend = () => true, ack = false) {
    const H = hub(), topic = "realtime:kcp-league-" + room, addr = publicKeyProblem(key) ? null : wsUrl(url, key);
    let ws = null, ref = 0, seq = 0, joinRef = null, hb = 0, retry = 0, closed = false, joined = false, timer = 0;
    const queue = [], pending = ack ? new Map() : null;
    // 미확인(ack 없음)은 크기 때문인지 일시 끊김 때문인지 가를 수 없다. 그래서 미확인 기록으로 보내기를 막지 않는다:
    // 교실 와이파이가 한 번 흔들려 100KB 상태의 ack가 늦으면 이후 100KB 넘는 상태를 영영 못 보내게 되기 때문이다.
    // 미확인 결과는 진행자 경고에만 쓴다.
    const cap = () => SEND_CAP;
    function reset() {
      pending?.forEach(p => clearTimeout(p.timer)); pending?.clear();
    }
    function settle(id, success, reason) {
      const p = pending?.get(id);
      if (!p) return;
      pending.delete(id); clearTimeout(p.timer);
      H.fire(success ? "delivered" : "undelivered", { ev: p.ev, bytes: p.bytes, seq: p.seq, ...(reason ? { reason } : {}) });
    }
    function transmit(m) {
      const size = bytes(m).length, ev = m.payload.event;
      if (size > cap()) { H.fire("oversize", { ev, bytes: size }); return false; }
      seq++; // 재연결 뒤에도 연결 객체 안의 전송 순서를 유지한다.
      if (ack) {
        if (pending.size >= 64) settle(pending.keys().next().value, false, "pending-limit");
        pending.set(m.ref, { ev, bytes: size, seq, timer: setTimeout(() => settle(m.ref, false, "timeout"), ACK_WAIT) });
      }
      raw(m);
      return true;
    }
    if (!addr || !key) { H.set("error"); return { kind: "supabase", send() {}, on: H.on, onStatus: H.onStatus, status: () => H.status, close() {} }; }
    const raw = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    function enqueue(m) {
      const p = m.payload, d = p.payload;
      if (p.event === "req" && d) {
        // 연계선·사건은 대상별 최신값을 남겨 다른 협상까지 지우지 않는다.
        const body = requestBody(d);
        const i = queue.findIndex(q => {
          const old = requestBody(q.payload.payload);
          return q.payload.event === p.event && body && old && q.payload.payload.team === d.team &&
            old.type === body.type && old.other === body.other && old.ev === body.ev && old.id === body.id;
        });
        if (i >= 0) queue.splice(i, 1);
      }
      queue.push(m); if (queue.length > 50) queue.shift();
    }
    function flush() {
      if (!joined) return;
      for (let i = 0; i < queue.length;) {
        const m = queue[i];
        if (!canSend(m.payload.event, m.payload.payload)) { i++; continue; }
        queue.splice(i, 1); m.join_ref = joinRef; transmit(m);
      }
    }
    function join() {
      if (closed || !ws || ws.readyState !== 1) return;
      reset(); joined = false;
      joinRef = String(++ref);
      const payload = { config: { broadcast: { self: false, ack }, presence: { key: "", enabled: false }, postgres_changes: [], private: false } };
      if (/^eyJ/.test(key)) payload.access_token = key; // 예전 anon 키(JWT)만. 새 publishable 키는 주소의 apikey로 충분하다.
      raw({ topic, event: "phx_join", payload, ref: joinRef, join_ref: joinRef });
    }
    function connect() {
      if (closed) return;
      H.set(retry ? "reconnecting" : "connecting");
      try { ws = new WebSocket(addr); } catch (e) { H.set("error"); schedule(); return; }
      ws.onopen = () => { retry = 0; join(); clearInterval(hb); hb = setInterval(() => raw({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), 25000); };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m || m.topic !== topic) return;
        if (m.event === "phx_reply" && m.ref === joinRef) {
          if (m.payload && m.payload.status === "ok") { joined = true; H.set("open"); flush(); }
          else { H.set("error"); }
          return;
        }
        if (m.event === "phx_reply") {
          if (m.payload?.status === "ok" || m.payload?.status === "error")
            settle(m.ref, m.payload.status === "ok", m.payload.status === "error" ? m.payload.response?.reason || "error" : undefined);
          return;
        }
        if (m.event === "phx_error" || m.event === "phx_close") { joined = false; reset(); H.set("reconnecting"); clearTimeout(timer); timer = setTimeout(join, 1000); return; }
        if (m.event === "broadcast" && m.payload && typeof m.payload.event === "string") H.fire(m.payload.event, m.payload.payload);
      };
      ws.onclose = () => { joined = false; reset(); clearTimeout(timer); clearInterval(hb); if (!closed) { H.set("reconnecting"); schedule(); } };
      ws.onerror = () => {};
    }
    function schedule() { clearTimeout(timer); retry++; timer = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(retry, 5))); }
    connect();
    return {
      kind: "supabase",
      send(ev, data) {
        const m = broadcastMessage(room, ev, data, String(++ref), joinRef);
        const size = bytes(m).length;
        if (size > cap()) { H.fire("oversize", { ev, bytes: size }); return false; }
        enqueue(m); flush(); return true;
      },
      flush,
      on: H.on, onStatus: H.onStatus, status: () => H.status,
      close() { closed = true; joined = false; reset(); clearInterval(hb); clearTimeout(timer); if (ws) try { ws.close(); } catch (e) { /* 이미 닫힘 */ } H.set("closed"); }
    };
  }

  KCP.leagueNet = {
    open(o) { return o && o.kind === "supabase" ? supabase(o.room, o.url, o.key, o.canSend, o.ack) : local(o.room); },
    replyGate, compactSnapshot, expandSnapshot, canonical, sessionId, hostBinding, signHost, hostReceiver,
    publicKeyProblem, wsUrl, secure, createIdentity, fingerprint, signEnvelope, verifyEnvelope, requestBody, receiver, broadcastMessage, byteLength: value => bytes(value).length
  };
})();
