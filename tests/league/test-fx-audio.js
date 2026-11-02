/* 브라우저 없이 오디오 설정·재생 수명·실패 경로를 확인한다. WebAudio 경계만 대체한다. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const file = path.resolve(__dirname, "../../ui/fx-audio.js");
assert.ok(fs.existsSync(file), "KCP.fxAudio 모듈이 있어야 한다");
const source = fs.readFileSync(file, "utf8");
const kinds = ["build", "remove", "line", "tick", "outage", "complete", "research", "month", "card", "ready"];

function setup(saved = {}, options = {}) {
  const storage = new Map(Object.entries(saved).map(([k, v]) => [k, JSON.stringify(v)]));
  const nodes = [], contexts = [], logs = [];
  function param(value = 0) {
    return { value, events: [],
      setValueAtTime(v, t) { this.value = v; this.events.push(["set", v, t]); },
      linearRampToValueAtTime(v, t) { this.value = v; this.events.push(["linear", v, t]); },
      exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(["exp", v, t]); },
      cancelScheduledValues() { this.events = []; }
    };
  }
  function node(type) {
    if (options.nodeFailure) throw new Error("audio node unavailable");
    const n = { type, gain: param(1), frequency: param(440), Q: param(1),
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      connections: [], connect(target) { if (options.connectFailure) throw new Error("audio connection denied"); this.connections.push(target); }, disconnect() { this.disconnected = true; },
      start(t) { if (options.startFailure) throw new Error("audio start denied"); this.startAt = t; }, stop(t) { this.stopAt = t; }
    };
    nodes.push(n); return n;
  }
  class AudioContext {
    constructor() {
      if (options.constructorFailure) throw new Error("audio unavailable");
      this.currentTime = 0; this.sampleRate = 48000; this.state = options.suspended ? "suspended" : "running";
      this.destination = {}; this.resumes = 0; contexts.push(this);
    }
    resume() {
      this.resumes++;
      if (options.resumeFailure === "throw") throw new Error("resume unavailable");
      if (options.resumeFailure) return Promise.reject(new Error("resume denied"));
      this.state = "running"; return Promise.resolve();
    }
    close() { this.state = "closed"; return Promise.resolve(); }
    createGain() { return node("gain"); }
    createDynamicsCompressor() { return node("compressor"); }
    createOscillator() { const n = node("oscillator"); n.type = "sine"; return n; }
    createBiquadFilter() { return node("filter"); }
    createBufferSource() { return node("bufferSource"); }
    createBuffer(channels, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
  }
  const window = { KCP: {}, AudioContext: options.unsupported ? undefined : AudioContext,
    navigator: { userActivation: { isActive: !options.inactive } },
    localStorage: {
      getItem(k) { if (options.storageFailure) throw new Error("storage denied"); return storage.get(k) ?? null; },
      setItem(k, v) { if (options.storageFailure) throw new Error("storage denied"); storage.set(k, v); }
    }
  };
  vm.runInNewContext(source, { window, console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  return { fx: window.KCP.fxAudio, window, nodes, contexts, storage, logs };
}
const enabledKey = "kcp-league-sound-v1", volumeKey = "kcp-league-sound-vol-v1";
const sources = env => env.nodes.filter(n => n.startAt !== undefined);

test("기본 꺼짐·play는 사용자 잠금 해제 전후로 Context나 노드를 만들지 않는다", async () => {
  const e = setup();
  assert.equal(e.fx.enabled(), false); assert.equal(e.fx.volume(), .6);
  for (const k of kinds) e.fx.play(k);
  await e.fx.unlock(); assert.equal(e.contexts.length, 0); assert.equal(e.nodes.length, 0);
  e.fx.setEnabled(true);
  e.fx.play("build"); assert.equal(e.contexts.length, 0);
  await e.fx.unlock(); const count = e.nodes.length;
  e.fx.setEnabled(false);
  for (const k of kinds) e.fx.play(k);
  assert.equal(e.nodes.length, count);
});

test("설정은 두 기기 키에만 저장하고 음량 0과 범위 밖 값을 처리한다", async () => {
  const e = setup({ [enabledKey]: true, [volumeKey]: 0 });
  assert.equal(e.fx.enabled(), true); assert.equal(e.fx.volume(), 0);
  await e.fx.unlock(); const count = e.nodes.length;
  e.fx.play("ready"); assert.equal(e.nodes.length, count);
  e.fx.setVolume(2); assert.equal(e.fx.volume(), 1);
  e.fx.setVolume(-1); assert.equal(e.fx.volume(), 0);
  e.fx.setVolume(.4); e.fx.setVolume(NaN); assert.equal(e.fx.volume(), .4);
  e.fx.setEnabled(false);
  assert.deepEqual([...e.storage.keys()].sort(), [enabledKey, volumeKey].sort());
  assert.equal(JSON.parse(e.storage.get(enabledKey)), false);
  assert.equal(JSON.parse(e.storage.get(volumeKey)), .4);
  const corrupt = setup({ [enabledKey]: "true", [volumeKey]: "loud" });
  assert.equal(corrupt.fx.enabled(), false); assert.equal(corrupt.fx.volume(), .6);
});

test("AudioContext 생성·resume는 활성 사용자 조작에서 unlock으로만 수행한다", async () => {
  const e = setup({ [enabledKey]: true }, { suspended: true, inactive: true });
  await e.fx.unlock(); assert.equal(e.contexts.length, 0);
  e.window.navigator.userActivation.isActive = true;
  await e.fx.unlock(); assert.equal(e.contexts.length, 1); assert.equal(e.contexts[0].resumes, 1);
  e.contexts[0].state = "suspended"; e.fx.play("ready");
  assert.equal(e.contexts[0].resumes, 1); assert.equal(sources(e).length, 0);
  await e.fx.unlock(); e.fx.play("ready"); assert.ok(sources(e).length > 0);
});

test("열 팔레트는 0.4초 내 종료하고 연타 간격은 일반 80ms·tick 60ms이다", async () => {
  for (const k of kinds) {
    const e = setup({ [enabledKey]: true }); await e.fx.unlock();
    e.fx.play(k); const count = sources(e).length; assert.ok(count > 0, k);
    for (const n of sources(e)) {
      assert.ok(n.startAt >= 0 && n.stopAt <= .4 && n.stopAt > n.startAt, `${k}: 짧은 수명`);
      n.onended?.(); assert.equal(n.disconnected, true, `${k}: 소스 해제`);
    }
    e.contexts[0].currentTime = k === "tick" ? .059 : .079;
    e.fx.play(k); assert.equal(sources(e).length, count, `${k}: 연타 무시`);
    e.contexts[0].currentTime = k === "tick" ? .061 : .081;
    e.fx.play(k); assert.ok(sources(e).length > count, `${k}: 간격 뒤 재생`);
  }
});

test("겹친 음은 공통 마스터·압축기를 거치고 끄면 재생 중인 음도 음소거된다", async () => {
  const e = setup({ [enabledKey]: true }); await e.fx.unlock();
  const master = e.nodes.find(n => n.type === "gain"), compressor = e.nodes.find(n => n.type === "compressor");
  assert.ok(master && compressor);
  assert.ok(master.connections.includes(compressor)); assert.ok(compressor.connections.includes(e.contexts[0].destination));
  for (const k of kinds) e.fx.play(k);
  const count = sources(e).length;
  for (let i = 0; i < 30; i++) { e.contexts[0].currentTime += .081; e.fx.play(kinds[i % kinds.length]); }
  assert.equal(sources(e).length, count, "미종료 소리의 중첩 수는 제한한다");
  e.fx.setEnabled(false); assert.equal(master.gain.value, 0);
  const nodesBefore = e.nodes.length; e.fx.play("ready"); assert.equal(e.nodes.length, nodesBefore);
});

test("WebAudio 미지원·생성/노드/resume 실패·저장 거부에서 오류와 경고 없이 계속된다", async () => {
  for (const options of [{ unsupported: true }, { constructorFailure: true }, { nodeFailure: true },
    { suspended: true, resumeFailure: true }, { suspended: true, resumeFailure: "throw" }, { storageFailure: true }]) {
    const e = setup({ [enabledKey]: true }, options);
    assert.doesNotThrow(() => { e.fx.setEnabled(true); e.fx.setVolume(.7); e.fx.play("build"); });
    await e.fx.unlock();
    for (const k of kinds) assert.doesNotThrow(() => e.fx.play(k));
    assert.deepEqual(e.logs, []);
  }
});

test("마스터 연결 실패 후에는 다음 사용자 조작에서 정상 그래프를 새로 만든다", async () => {
  const options = { connectFailure: true };
  const e = setup({ [enabledKey]: true }, options);
  await e.fx.unlock(); options.connectFailure = false; await e.fx.unlock();
  const compressor = e.nodes.filter(n => n.type === "compressor").at(-1);
  assert.ok(compressor.connections.includes(e.contexts.at(-1).destination));
  assert.equal(e.contexts[0].state, "closed", "연결에 실패한 Context는 정리한다");
  e.fx.play("ready"); assert.ok(sources(e).length > 0);
  assert.deepEqual(e.logs, []);
});

test("재생 중 노드·start 실패를 삼키고 부분 생성한 노드를 해제한다", async () => {
  for (const failure of ["nodeFailure", "startFailure"]) {
    const options = {}, e = setup({ [enabledKey]: true }, options); await e.fx.unlock();
    const count = e.nodes.length; options[failure] = true;
    assert.doesNotThrow(() => e.fx.play("build"));
    assert.ok(e.nodes.slice(count).every(n => n.disconnected));
    options[failure] = false; e.contexts[0].currentTime = .1;
    e.fx.play("build"); assert.ok(sources(e).length > 0);
    assert.deepEqual(e.logs, []);
  }
});
