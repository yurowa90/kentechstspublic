/* 리그 효과음: 기기 설정만 저장하며 외부 음원·배경음은 사용하지 않는다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const K_SOUND = "kcp-league-sound-v1", K_VOLUME = "kcp-league-sound-vol-v1";
  const store = {
    get(k) { try { return JSON.parse(window.localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  };
  let isEnabled = store.get(K_SOUND) === true;
  const savedVolume = store.get(K_VOLUME);
  let level = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : .6;
  let context = null, master = null, compressor = null, noiseBuffer = null;
  const last = new Map(), active = new Set(), HEADROOM = .5, PEAK = .07;

  function updateGain() {
    if (!context || !master) return;
    try {
      const at = context.currentTime, value = isEnabled ? level * HEADROOM : 0;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value, at);
      // 끄기는 즉시 음소거, 음량 변경은 짧게 이어 클릭을 줄인다.
      if (!value) master.gain.setValueAtTime(0, at);
      else master.gain.linearRampToValueAtTime(value, at + .015);
    } catch (_) {}
  }
  function setEnabled(value) {
    isEnabled = value === true; store.set(K_SOUND, isEnabled); updateGain();
    // 끄면 오디오 처리도 멈춰 태블릿 배터리를 아낀다. 다시 켤 때는 unlock이 resume한다.
    if (!isEnabled) try { context?.suspend?.().catch(() => {}); } catch (_) {}
  }
  function setVolume(value) {
    if (!Number.isFinite(value)) return;
    level = Math.max(0, Math.min(1, value)); store.set(K_VOLUME, level); updateGain();
  }
  function disconnect(nodes) { nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }); }

  // 사용자 조작 핸들러에서만 호출한다. play·설정 함수는 Context를 생성하거나 resume하지 않는다.
  async function unlock() {
    let initializing = false;
    try {
      if (!isEnabled || window.navigator?.userActivation?.isActive === false) return;
      if (!context || context.state === "closed") {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        initializing = true;
        context = new AC();
        master = context.createGain(); compressor = context.createDynamicsCompressor();
        master.gain.value = level * HEADROOM;
        compressor.threshold.value = -12; compressor.knee.value = 6; compressor.ratio.value = 4;
        compressor.attack.value = .005; compressor.release.value = .08;
        master.connect(compressor); compressor.connect(context.destination);
        noiseBuffer = null; last.clear(); active.clear();
        initializing = false;
      }
      if (context.state !== "running") await context.resume(); // iOS의 interrupted 포함
    } catch (_) {
      // 생성·접속 실패는 다음 사용자 조작에서 다시 시도한다. resume 거부도 밖으로 전파하지 않는다.
      if (initializing) {
        disconnect([master, compressor].filter(Boolean));
        try { context?.close?.()?.catch(() => {}); } catch (_) {}
        context = master = compressor = null;
      }
    }
  }

  function envelope(gain, at, duration, peak, attack) {
    gain.setValueAtTime(0, at);
    gain.linearRampToValueAtTime(peak, at + attack);
    gain.exponentialRampToValueAtTime(.0001, at + duration - .008);
    gain.linearRampToValueAtTime(0, at + duration);
  }
  function voice(event, source, nodes, at, duration) {
    event.sources.push(source); event.pending++;
    source.onended = () => {
      disconnect(nodes);
      if (--event.pending === 0) active.delete(event);
    };
    source.start(at); source.stop(at + duration);
  }
  function tone(event, hz, endHz, delay, duration, peak = PEAK, type = "sine") {
    const at = event.at + delay, o = context.createOscillator(); event.nodes.push(o);
    const g = context.createGain(); event.nodes.push(g);
    o.type = type; o.frequency.setValueAtTime(hz, at);
    if (endHz !== hz) o.frequency.exponentialRampToValueAtTime(endHz, at + duration);
    envelope(g.gain, at, duration, peak, .006);
    o.connect(g); g.connect(master); voice(event, o, [o, g], at, duration);
  }
  function noise(event, filterType, hz, delay, duration, peak = PEAK) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .2), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const at = event.at + delay, n = context.createBufferSource(); event.nodes.push(n);
    const f = context.createBiquadFilter(); event.nodes.push(f);
    const g = context.createGain(); event.nodes.push(g);
    n.buffer = noiseBuffer; f.type = filterType; f.frequency.value = hz; f.Q.value = .7;
    envelope(g.gain, at, duration, peak, .004);
    n.connect(f); f.connect(g); g.connect(master); voice(event, n, [n, f, g], at, duration);
  }
  function notes(event, frequencies, gap, duration, peak = PEAK) {
    frequencies.forEach((hz, i) => tone(event, hz, hz, gap * i, duration, peak));
  }
  const palette = {
    build(e) { tone(e, 700, 380, 0, .055, .035, "triangle"); tone(e, 520, 760, .04, .12, .05); },
    remove(e) { tone(e, 190, 75, 0, .20, PEAK, "triangle"); },
    line(e) { noise(e, "highpass", 1800, 0, .10, .025); notes(e, [740, 1110], .09, .14, .035); },
    tick(e) { noise(e, "bandpass", 2800, 0, .025, PEAK * Math.pow(10, -18 / 20)); },
    outage(e) { notes(e, [220, 165], .12, .17, .055); },
    complete(e) { notes(e, [523, 659], .11, .15, .06); },
    research(e) { notes(e, [659, 784, 1047], .08, .15, .05); },
    month(e) { tone(e, 125, 48, 0, .24); },
    card(e) { noise(e, "bandpass", 1400, 0, .15, .055); },
    ready(e) { notes(e, [392, 523], .12, .15, .055); }
  };
  function play(kind) {
    // 꺼짐·잠금·음량 0에서는 버퍼와 노드를 만들지 않는다. 지원 없는 기기에서도 조작은 계속된다.
    if (!isEnabled || !level || !context || !master || context.state !== "running" || !Object.hasOwn(palette, kind)) return;
    let event;
    try {
      const at = context.currentTime + .01, gap = kind === "tick" ? .06 : .08;
      if (at - (last.get(kind) ?? -Infinity) < gap || active.size >= 8) return;
      last.set(kind, at);
      event = { at, nodes: [], sources: [], pending: 0 }; active.add(event);
      // 최대 8개 짧은 효과음 + 마스터 여유 음량 + 압축기로 중첩 시 피크를 억제한다.
      palette[kind](event);
    } catch (_) {
      if (event) {
        event.sources.forEach(n => { try { n.stop(); } catch (_) {} });
        disconnect(event.nodes); active.delete(event);
      }
    }
  }
  KCP.fxAudio = { play, setEnabled, enabled: () => isEnabled, setVolume, volume: () => level, unlock };
})();
