"use strict";

// Node only: real network/lobby code, synthetic keys, in-memory DOM/storage/WS.
// Run: node tests/league/keycheck.js [--mutations]
// Expected results come from KEYCHECK.md and the test brief, not the implementation.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");
const K_NET = "kcp-league-net-v1";
const URL_FIXTURE = "https://keycheck-fixture.supabase.co";
const HOST_NOTICE = "비밀 키(service_role)는 쓰면 안 돼요. 대시보드의 publishable 또는 anon 키를 넣어요.";
const JOIN_NOTICE = "이 참가 링크의 키는 쓸 수 없어요. 선생님께 새 링크를 받아요.";
const b64 = value => Buffer.from(value).toString("base64url");
const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const signature = b64("keycheck-fixture-signature-not-cryptographic");
const jwt = payload => `${header}.${b64(JSON.stringify(payload))}.${signature}`;
const anon = jwt({ role: "anon", fixture: "keycheck-only" });
const cases = [
  ["anon", anon, null],
  ["service-role", jwt({ role: "service_role", fixture: "keycheck-only" }), "service_role"],
  ["authenticated", jwt({ role: "authenticated", fixture: "keycheck-only" }), "not_anon"],
  ["missing-role", jwt({ fixture: "keycheck-only" }), "not_anon"],
  ["invalid-base64", `${header}.!fixture-invalid!.${signature}`, "malformed"],
  ["invalid-json", `${header}.${b64("fixture: not JSON")}.${signature}`, "malformed"],
  ["no-dots", header, "malformed"],
  ["one-dot", anon.split(".").slice(0, 2).join("."), "malformed"],
  ["three-dots", `${anon}.${b64("fixture-extra")}`, "malformed"],
  ["secret", "sb_secret_keycheck_fixture_never_a_real_key", "secret"],
  ["embedded-secret", "fixture_sb_secret_embedded_keycheck", "secret"],
  ["publishable", "sb_publishable_keycheck_fixture_never_a_real_key", null]
];
const variants = cases.flatMap(([name, key, problem]) => [
  { name, key, problem }, { name: `${name}-space`, key: ` \t${key}\r\n `, problem }
]);
const sources = Object.fromEntries([
  "build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-net", "league"
].map(name => [name, fs.readFileSync(path.join(ROOT, "ui", name + ".js"), "utf8")]));

// Each mutation removes one guard or introduces one disclosure, only in VM memory.
const mutations = {
  socket: ["league-net", "publicKeyProblem(key) ? null : wsUrl(url, key)", "wsUrl(url, key)", "open/service-role/no-websocket"],
  link: ["league", "if (NET.publicKeyProblem(cfg.key)) { keyNotice", "if (false) { keyNotice", "link/service-role/not-saved"],
  saved: ["league", "if (NET.publicKeyProblem(savedNet.key))", "if (false)", "saved/service-role/cleared"],
  input: ["league", "if (NET.publicKeyProblem(cfg.key)) { errEl", "if (false) { errEl", "read/service-role/null"],
  notice: ["league", "errEl.textContent = PUBLIC_KEY_NOTICE; return null;", "errEl.textContent = PUBLIC_KEY_NOTICE + cfg.key; return null;", "read/service-role/no-key-in-error"],
  log: ["league-net", 'key = String(key || "").trim();', 'key = String(key || "").trim(); console.log(key);', "classify/service-role/no-key-in-log"]
};

const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const decodeHTML = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, ch => ({ "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" })[ch]);
function storage(saved) {
  const values = new Map(saved ? [[K_NET, JSON.stringify(saved)]] : []), writes = [];
  return {
    values, writes,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); writes.push([key, String(value)]); },
    removeItem(key) { values.delete(key); }
  };
}

// Minimal DOM boundary for lobby forms, not a browser/layout emulator. Values and
// messages are read from the real generated markup; missing selectors stay null.
function dom() {
  const nodes = new Map(), history = [];
  const node = () => ({
    value: "", type: "", textContent: "", innerHTML: "", dataset: {}, isConnected: false,
    handlers: {}, addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
    focus() {}, blur() {},
    // 가독성 2단계(b17a394)부터 로비가 "!" 설명 안의 details를 다시 찾는다. 판정 대상이 아닌 빈 노드를 돌려준다.
    querySelector() { return node(); }, querySelectorAll() { return []; },
    click() { for (const fn of this.handlers.click || []) fn({ target: this }); }
  });
  let html = "";
  const app = Object.assign(node(), {
    nodes, history,
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll(selector) {
      if (selector === "input[name=lg-net]") return [nodes.get("radio-local"), nodes.get("radio-supabase")];
      return [];
    }
  });
  Object.defineProperty(app, "innerHTML", {
    get: () => html,
    set(value) {
      html = value; history.push(value); nodes.clear();
      for (const match of value.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const [, tag, attrs, id] = match, el = node();
        el.value = decodeHTML(/\bvalue="([^"]*)"/.exec(attrs)?.[1] || "");
        el.type = /\btype="([^"]*)"/.exec(attrs)?.[1] || "";
        const rest = value.slice(match.index + match[0].length);
        el.textContent = decodeHTML(rest.split("<")[0]);
        if (tag === "select") {
          const options = [...rest.split("</select>")[0].matchAll(/<option\b([^>]*)>/g)];
          const selected = options.find(m => /\bselected\b/.test(m[1])) || options[0];
          el.value = /\bvalue="([^"]*)"/.exec(selected?.[1] || "")?.[1] || "";
        }
        nodes.set("#" + id, el);
      }
      nodes.set(".lg-lobby", node()); nodes.set(".lg-sb", node());
      for (const kind of ["local", "supabase"]) {
        const radio = node(); radio.value = kind;
        radio.checked = new RegExp(`name="lg-net" value="${kind}" checked`).test(value);
        nodes.set("radio-" + kind, radio);
        if (radio.checked) nodes.set("input[name=lg-net]:checked", radio);
      }
    }
  });
  return app;
}

function boot({ saved, mutation } = {}) {
  const app = dom(), localStorage = storage(saved), sessionStorage = storage(), logs = [], sockets = [];
  const routes = {}, KCP = { route: (name, fn) => { routes[name] = fn; }, on() {}, esc: escapeHTML };
  const context = vm.createContext({
    KCP, localStorage, sessionStorage, crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, structuredClone,
    console: Object.fromEntries(["log", "info", "warn", "error", "debug", "trace", "dir", "table"].map(name => [name, (...args) => logs.push(args)])),
    location: { hash: "#league", origin: "https://fixture.invalid", pathname: "/" },
    document: { documentElement: { classList: { add() {}, remove() {} } }, getElementById: id => app.querySelector("#" + id), addEventListener() {} },
    addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    cancelAnimationFrame() {}, queueMicrotask: fn => fn(),
    WebSocket: class { constructor() { sockets.push(this); this.readyState = 0; } send() {} close() {} }
  });
  context.window = context;
  for (const [name, original] of Object.entries(sources)) {
    let source = original;
    if (mutation && mutations[mutation][0] === name) {
      const [, from, to] = mutations[mutation];
      if (!source.includes(from)) throw Error("mutation anchor missing");
      source = source.replace(from, to);
    }
    if (name === "league") {
      // Expose the real lexical readNet closure, without replacing its body or
      // skipping lobby execution. This hook never touches application files.
      const anchor = '    app.querySelectorAll("input[name=lg-net]").forEach';
      if (!source.includes(anchor)) throw Error("readNet hook missing");
      source = source.replace(anchor, "    KCP.keycheckReadNet = readNet;\n" + anchor);
    }
    vm.runInContext(source, context, { filename: "ui/" + name + ".js" });
  }
  return {
    app, logs, sockets, localStorage, sessionStorage, KCP, context,
    net: () => JSON.parse(localStorage.getItem(K_NET)),
    notice: () => app.querySelector("#lg-err").textContent,
    enter(hash = "#league/multi") { context.location.hash = hash; routes.league(app, hash.slice("#league/".length)); },
    input(key) {
      app.nodes.set("input[name=lg-net]:checked", app.nodes.get("radio-supabase"));
      app.querySelector("#lg-url").value = ` ${URL_FIXTURE} `;
      app.querySelector("#lg-key").value = key;
    }
  };
}

// Never include actual/expected values, exception messages, or key fragments in
// diagnostics, even when a disclosure mutation deliberately leaks inside the VM.
function suite(mutation) {
  let checks = 0;
  const failures = [];
  const check = (label, value) => { checks++; if (!value) failures.push(label); };
  const run = (label, fn) => { try { fn(); } catch { check(label + "/execution", false); } };
  const clean = (value, key) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const raw = key.trim();
    const fragments = [raw, ...raw.split(".").filter(part => part.length >= 8), raw.slice(-16)];
    return fragments.every(part => !text.includes(part));
  };
  const noLeaks = (h, key, label, rejected) => {
    check(label + "/no-key-in-error", clean(h.notice(), key));
    check(label + "/no-key-in-log", clean(h.logs, key));
    // Public keys are intentionally persisted; typed input remains in a password
    // control. Neither exemption permits a rejected key in generated HTML/storage.
    const markup = h.app.history.map(html => rejected ? html : html.replace(/<input\b[^>]*\bid="lg-key"[^>]*>/g, ""));
    const screen = [markup, [...h.app.nodes.values()].map(n => [n.textContent, n.innerHTML])];
    check(label + "/no-key-in-screen", clean(screen, key));
    check(label + "/password-input", h.app.querySelector("#lg-key").type === "password");
    if (rejected) {
      check(label + "/no-key-in-storage", clean([...h.localStorage.values, ...h.sessionStorage.values], key));
      check(label + "/no-key-written", clean([...h.localStorage.writes, ...h.sessionStorage.writes], key));
    }
  };
  for (const { name, key, problem } of variants) {
    run("classify/" + name, () => {
      const h = boot({ mutation });
      check(`classify/${name}/result`, h.KCP.leagueNet.publicKeyProblem(key) === problem);
      check(`classify/${name}/no-key-in-log`, clean(h.logs, key));
    });
    run("open/" + name, () => {
      const h = boot({ mutation });
      const conn = h.KCP.leagueNet.open({ kind: "supabase", room: "ABCDEFGH", url: URL_FIXTURE, key });
      check(`open/${name}/no-websocket`, h.sockets.length === (problem ? 0 : 1));
      check(`open/${name}/status`, conn.status() === (problem ? "error" : "connecting"));
      conn.send("req", { fixture: true }); conn.close();
      check(`open/${name}/no-key-in-log`, clean(h.logs, key));
    });
    run("link/" + name, () => {
      const h = boot({ mutation });
      h.enter("#league/j=" + b64(JSON.stringify({ r: "ABCDEFGH", n: { kind: "supabase", url: URL_FIXTURE, key } })));
      if (problem) {
        check(`link/${name}/not-saved`, h.localStorage.getItem(K_NET) === null);
        check(`link/${name}/student-notice`, h.notice() === JOIN_NOTICE);
        check(`link/${name}/empty-input`, h.app.querySelector("#lg-key").value === "");
        check(`link/${name}/join-mode`, h.app.querySelector(".lg-lobby").dataset.mode === "join");
      } else {
        check(`link/${name}/saved`, h.net()?.key === key && h.net()?.url === URL_FIXTURE && h.net()?.kind === "supabase");
        check(`link/${name}/no-notice`, h.notice() === "");
      }
      check(`link/${name}/no-websocket`, h.sockets.length === 0);
      noLeaks(h, key, "link/" + name, !!problem);
    });
    run("saved/" + name, () => {
      const h = boot({ saved: { kind: "supabase", url: URL_FIXTURE, key }, mutation });
      h.enter();
      check(`saved/${name}/cleared`, h.net()?.key === (problem ? "" : key));
      check(`saved/${name}/config-preserved`, h.net()?.kind === "supabase" && h.net()?.url === URL_FIXTURE);
      check(`saved/${name}/notice`, h.notice() === (problem ? HOST_NOTICE : ""));
      if (problem) check(`saved/${name}/empty-input`, h.app.querySelector("#lg-key").value === "");
      noLeaks(h, key, "saved/" + name, !!problem);
    });
    run("read/" + name, () => {
      const h = boot({ mutation }); h.enter(); h.input(key);
      const result = h.KCP.keycheckReadNet();
      if (problem) {
        check(`read/${name}/null`, result === null);
        check(`read/${name}/not-saved`, h.localStorage.getItem(K_NET) === null);
        check(`read/${name}/host-notice`, h.notice() === HOST_NOTICE);
        // The real join click consumes readNet's null and must not navigate/save.
        h.app.querySelector("#lg-code").value = "ABCDEFGH";
        h.app.querySelector("#lg-join").click();
        check(`read/${name}/join-blocked`, h.context.location.hash === "#league/multi" && h.sessionStorage.values.size === 0);
      } else {
        check(`read/${name}/returned`, result?.key === key.trim() && result?.url === URL_FIXTURE && result?.kind === "supabase");
        check(`read/${name}/saved`, h.net()?.key === key.trim() && h.net()?.url === URL_FIXTURE);
        check(`read/${name}/no-notice`, h.notice() === "");
      }
      noLeaks(h, key, "read/" + name, !!problem);
    });
  }
  return { checks, failures };
}

if (process.argv.includes("--mutations")) {
  let detected = 0;
  for (const name of Object.keys(mutations)) {
    const result = suite(name), expected = mutations[name][3];
    const caught = result.failures.includes(expected);
    if (caught) detected++;
    console.log(`${caught ? "PASS" : "FAIL"} mutation/${name}: ${expected}`);
  }
  console.log(`keycheck mutations: ${detected}/${Object.keys(mutations).length} detected`);
  process.exitCode = detected === Object.keys(mutations).length ? 0 : 1;
} else {
  const result = suite();
  for (const label of result.failures) console.error("FAIL " + label);
  console.log(`keycheck: ${result.checks} checks, ${result.failures.length} failed`);
  process.exitCode = result.failures.length ? 1 : 0;
}
