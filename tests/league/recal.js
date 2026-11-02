"use strict";

// Independent acceptance contract: ECON-RECAL-SPEC §7.2, §5, §2 and
// ECON-REFERENCES §0, 2.1–2.8, 3.9–3.10, 4.3/4.6/4.8, 6.4/6.9,
// 7.13–7.15, 9.10–9.11, 13.4–13.5. Application source is only executed
// by require / VM bootstrap; it is never inspected to derive an oracle.
// Run: node tests/league/recal.js. No files, network or Git writes.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { X, D, IDS, energy } = require("./review/lib.js");
const ROOT = path.resolve(__dirname, "../..");
const SEEDS = ["recal-0", "recal-1", "recal-2"];
const clone = x => JSON.parse(JSON.stringify(x));
const snapshot = JSON.stringify(D);
const sum = a => a.reduce((s, x) => s + x, 0);
const finite = Number.isFinite;
const fmt = v => finite(v) ? Number(v.toFixed(6)) : String(v);
const near = (a, b, eps = 1e-8) => finite(a) && finite(b) && Math.abs(a - b) <= eps;
const between = (v, lo, hi) => finite(v) && v >= lo && v <= hi;
const highest = (ids, f) => ids.reduce((a, b) => f(b) > f(a) ? b : a);
const steel = id => D.start[id].mix?.steel || 0;
const STEEL = highest(IDS, steel);
const LOW = highest(IDS.filter(id => steel(id) === 0), id => D.start[id].mix?.other || 0);
const FOCAL = highest(IDS.filter(id => id !== STEEL), id => D.start[id].mix?.semi || 0);
let pass = 0, fail = 0, missing = 0, allowedMissing = 0;
let row = "준비";
const failures = [], missingKeys = new Set(), rows = new Map();

class Unimplemented extends Error {}
function check(name, condition, detail = "", unimplemented = false, allowed = false) {
  const label = `${row} / ${name}`;
  const bucket = rows.get(row) || { pass: 0, fail: 0 };
  rows.set(row, bucket);
  if (condition) { pass++; bucket.pass++; }
  else {
    fail++; bucket.fail++;
    if (unimplemented) { missing++; if (allowed) allowedMissing++; }
    failures.push(`${label}${detail ? `: ${detail}` : ""}`);
  }
  console.log(`${condition ? "통과" : unimplemented ? "미구현" : "실패"} ${label}${allowed ? " [미구현 허용: H01 뒤]" : ""}${detail ? `: ${detail}` : ""}`);
}
function test(name, fn, allowed = false) {
  try { fn(); }
  catch (e) { check(name, false, e.message, e instanceof Unimplemented, allowed); }
}
function field(value, name) {
  if (value == null) { missingKeys.add(name); throw new Unimplemented(`${name} 없음`); }
  return value;
}
function number(value, name) {
  field(value, name);
  if (!finite(value)) throw new Error(`${name} 유한 숫자 아님: ${String(value)}`);
  return value;
}
const p = (data, key) => number(data.params[key]?.v, `params.${key}`);
function block(name, method, fn) {
  row = name;
  console.log(`\n[${name}] 방법: ${method}`);
  test("실행", fn);
}
function dataFor(real = false) {
  const data = clone(D);
  if (real) {
    data.params.eduSpeed.v = 1;
    // A missing original eduMemory is asserted below, never silently accepted.
    // Setting the fixture flag still permits diagnostics of unrelated migration.
    data.params.eduMemory = { ...data.params.eduMemory, v: 1 };
  }
  return data;
}
function inputs(E, change = () => ({}), m = 0) {
  return Object.fromEntries(E.order.map(id => {
    const o = change(id, m, E) || {};
    const e = Object.assign(energy(id, E.cities[id]), o.energy);
    // lib.js's per-capita approximations, with explicitly consistent supply.
    e.servedMWh = o.energy?.servedMWh ?? e.demMWh * (1 - e.unsPct / 100);
    if (o.energy?.costPerMWh != null && o.energy?.opex == null)
      e.opex = e.demMWh * e.costPerMWh;
    return [id, { energy: e, policy: { taxRes: 0, taxInd: 0, service: 0, incentive: 0, ...o.policy },
      ...(o.assets ? { assets: o.assets } : {}) }];
  }));
}
function initial(data, seed, months = 36) {
  let E = X.initCities(IDS, data, { seed, months: months <= 36 ? months : 36 });
  E = X.calibrate(E, inputs(E), data);
  // Long convergence is a laboratory run, outside the 36-turn game cap.
  E.len = months;
  return E;
}
function run(data, seed, months, change = () => ({}), mutate = () => {}) {
  let E = initial(data, seed, months);
  const start = clone(E);
  mutate(E);
  const states = [], reports = [];
  for (let m = 0; m < months; m++) {
    const result = X.monthStep(E, inputs(E, change, m), data);
    E = field(result?.E, "monthStep.E");
    reports.push(field(result.report, `monthStep.report[${m + 1}]`));
    states.push(E);
  }
  return { start, E, states, reports };
}
function share(E, id, key = "pop") { return E.cities[id][key] / E.totals[key]; }
const changePct = (r, id, key = "pop", E = r.E) => (share(E, id, key) / share(r.start, id, key) - 1) * 100;
const relativePct = (a, b, id, key = "pop") => (share(a.E, id, key) / share(b.E, id, key) - 1) * 100;
// SPEC §7.2 v1.0.1: paired city populations, not regional shares.
const populationPct = (E, baseline, id) => (E.cities[id].pop / baseline.cities[id].pop - 1) * 100;
function fixedIndustry(data) {
  const d = clone(data);
  d.params.betaIndReal.v = 0;
  // The missing original key already fails the contract inventory. An older
  // engine ignoring this fixture flag also fails the shock-preservation check;
  // its elasticity is explicitly only a pre-recalibration diagnostic.
  d.params.kappaIndReal = { ...d.params.kappaIndReal, v: 0 };
  return d;
}

// Contract existence is independent of behavioral diagnostics. Do not alias
// kappaPop / kappaInd / uni / lab to the SPEC's new names.
block("계약 필드", "새 params·자료 키의 존재와 값 형식을 별도 단언; 현실 사본만 변경", () => {
  for (const key of ["eduMemory", "kappaPopReal", "kappaIndReal", "jobsJ", "crowdK", "taxGain",
    "lossAversion", "taxYardstick", "fiscalTargetRev", "budgetToRevenue", "debtWarnRatio",
    "cbamEuShare", "cbamDrop", "eduCbam", "scoreCo2Worst", "scoreCo2Best"]) test(key, () => {
    p(D, key); check(key, true);
  });
  test("cbamPhase", () => {
    const phase = field(D.params.cbamPhase?.v, "params.cbamPhase");
    check("cbamPhase[2027]", near(phase[2027], 0.05), `값=${phase[2027]}, 목표=0.05`);
  });
  for (const id of IDS) for (const key of ["univ0", "lab0"]) test(`${id}.${key}`, () => {
    const v = number(D.start[id][key], `start.${id}.${key}`);
    check(`${id}.${key}`, v >= 0, `값=${v}`);
  });
  check("자료에서 도시 선택", STEEL !== LOW && FOCAL !== STEEL && steel(STEEL) > 0,
    `대표=${FOCAL}, 철강 최대=${STEEL}, 저집약=${LOW}`);
  for (const fn of ["initCities", "calibrate", "monthStep", "score", "yearStart"])
    check(`econ.${fn}`, typeof X[fn] === "function", "공개 검사 API", typeof X[fn] !== "function");
});

const jobValues = new Map();
function jobPair(real, seed) {
  const d = fixedIndustry(dataFor(real));
  const base = run(d, seed, 12);
  const changed = run(d, seed, 12, () => ({}), E => {
    const delta = E.cities[FOCAL].ind * 0.01;
    const others = IDS.filter(id => id !== FOCAL), total = sum(others.map(id => E.cities[id].ind));
    E.cities[FOCAL].ind += delta;
    others.forEach(id => { E.cities[id].ind -= delta * E.cities[id].ind / total; });
    // Starting constants and calibration remain those before the shock.
  });
  return { base, changed, elasticity: Math.log(share(changed.E, FOCAL) / share(base.E, FOCAL)) / Math.log(1.01),
    popPct: relativePct(changed, base, FOCAL) };
}
block("01 일자리 고리", "보정 뒤 종사자 +1%·다른 도시 비례 차감, κ_ind=0; 무충격 대비 주민 몫 로그/ln(1.01), 산업 충격 유지 전제도 단언", () => {
  for (const seed of SEEDS) test(seed, () => {
    const real = jobPair(true, seed), game = jobPair(false, seed);
    jobValues.set(seed, { real, game });
    check(`${seed} 현실 12달`, between(real.elasticity, 0.07, 0.13), `탄력=${fmt(real.elasticity)}, 목표=0.07~0.13`);
    check(`${seed} 게임 시간 압축`, game.elasticity > real.elasticity * 2 && real.elasticity > 0,
      `현실=${fmt(real.elasticity)}, 게임=${fmt(game.elasticity)}, 목표=>현실×2`);
    for (const [label, r] of [["현실", real], ["게임", game]]) {
      const a = r.changed.start, b = r.changed.E;
      const want = share(a, FOCAL, "ind") * 1.01;
      check(`${seed} ${label} 산업 충격 유지`, near(share(b, FOCAL, "ind"), want, 1e-5),
        `최종 산업 몫=${fmt(share(b, FOCAL, "ind"))}, 목표=${fmt(want)}`);
    }
  });
});

block("02 정전 교차 점검", "대표 도시 정전 100% 12달; 같은 씨앗 무충격 대비 도시 인구 차이(v1.0.1), 게임 범위 v1.0.2", () => {
  for (const seed of SEEDS) for (const real of [true, false]) test(`${seed}/${real}`, () => {
    const d = dataFor(real), base = run(d, seed, 12);
    const r = run(d, seed, 12, id => id === FOCAL ? { energy: { unsPct: 100 } } : {});
    const v = populationPct(r.E, base.E, FOCAL), [lo, hi] = real ? [-3.9, -1.3] : [-9, -3];
    check(`${seed} ${real ? "현실" : "게임"}`, between(v, lo, hi), `무충격 대비 인구 차이=${fmt(v)}%, 목표=${lo}~${hi}%`);
  });
});
block("03 정전 5%", "대표 도시 정전 5% 12달; 같은 씨앗 무충격 대비 도시 인구 차이(게임, v1.0.1·v1.0.2)", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(), base = run(d, seed, 12);
    const r = run(d, seed, 12, id => id === FOCAL ? { energy: { unsPct: 5 } } : {});
    const v = populationPct(r.E, base.E, FOCAL);
    check(seed, between(v, -3.5, -0.5), `무충격 대비 인구 차이=${fmt(v)}%, 목표=-3.5~-0.5%`);
  });
});
block("04 회복", "6달 전면 정전 뒤 18달 정상; 같은 씨앗 무충격 대비 인구 차이의 최대 손실 중 24달까지 회복한 비율(게임, v1.0.1)", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(), base = run(d, seed, 24);
    const r = run(d, seed, 24, (id, m) => id === FOCAL && m < 6 ? { energy: { unsPct: 100 } } : {});
    const differences = r.states.map((E, m) => populationPct(E, base.states[m], FOCAL));
    const low = Math.min(...differences), end = differences[23];
    const recovered = (low - end) / low * 100;
    check(`${seed} 손실 발생`, low < -0.1, `최대 손실=${fmt(low)}%, 발생=${differences.indexOf(low) + 1}달`);
    check(seed, finite(recovered) && recovered >= 40 && low < 0,
      `최대 손실=${fmt(low)}%, 24달=${fmt(end)}%, 회복=${fmt(recovered)}%, 목표≥40%`);
  });
});
block("05 무변화 표류", "모든 도시 보통 조건 36달; 도시·달 전체의 최대 절대 주민 몫 변화", () => {
  for (const seed of SEEDS) for (const real of [true, false]) test(`${seed}/${real}`, () => {
    const r = run(dataFor(real), seed, 36);
    const v = Math.max(...r.states.flatMap(E => IDS.map(id => Math.abs(changePct(r, id, "pop", E)))));
    const limit = real ? 0.1 : 0.6;
    check(`${seed} ${real ? "현실" : "게임"}`, finite(v) && v <= limit, `최대 몫 변화=${fmt(v)}%, 목표≤${limit}%`);
  });
});
block("06 세금 고리 순서", "주민세 +1단계 12달의 무충격 대비 몫 손실을 같은 도시의 종사자 +1% 효과와 비교", () => {
  for (const seed of SEEDS) for (const real of [true, false]) test(`${seed}/${real}`, () => {
    const pair = field(jobValues.get(seed), "일자리 측정")[real ? "real" : "game"];
    const tax = run(fixedIndustry(dataFor(real)), seed, 12, id => id === FOCAL ? { policy: { taxRes: 1 } } : {});
    const v = relativePct(tax, pair.base, FOCAL), jobs = pair.popPct;
    check(`${seed} ${real ? "현실" : "게임"}`, v < 0 && jobs > 0 && Math.abs(v) < Math.abs(jobs),
      `세율+1=${fmt(v)}%, 일자리+1%=${fmt(jobs)}%, 목표=세율 절댓값<일자리 절댓값`);
  });
});

function converged(data, seed, change) {
  // REF 2.7: residents frozen; κ_ind=0.05 speeds convergence only.
  p(data, "kappaIndReal");
  const d = clone(data); d.params.kappaIndReal.v = 0.05; d.params.betaPopReal.v = 0;
  d.params.kappaPopReal = { ...d.params.kappaPopReal, v: 0 };
  // A stationary long-run experiment must remove common regional growth too.
  d.params.gpYear.v = 0; d.params.giYear.v = 0;
  // Freeze international noise and random events in this deep copy so the
  // final 24 months measure convergence, not a moving external target.
  for (const key of Object.keys(d.intl.sigma)) d.intl.sigma[key] = 0;
  d.intl.eventP = 0;
  const r = run(d, seed, 600, change);
  const delta = Math.max(...IDS.map(id => Math.abs(share(r.E, id, "ind") - share(r.states[575], id, "ind")) * 100));
  check(`${seed} 장기 수렴`, delta < 0.001, `마지막 24달 최대 산업 몫 변화=${fmt(delta)}%p, 목표<0.001%p`);
  return r;
}
block("07 산업 세금", "현실 사본·주민 이동 끔·kappaIndReal=0.05·국제 sigma/eventP=0; 산업세 -1단계 장기 산업 몫을 무충격과 비교", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true), base = converged(d, seed, () => ({}));
    const r = converged(d, seed, id => id === FOCAL ? { policy: { taxInd: -1 } } : {});
    const v = relativePct(r, base, FOCAL, "ind");
    check(seed, between(v, 0.15, 0.45), `장기 산업 몫 변화=${fmt(v)}%, 목표=0.15~0.45%`);
  });
});
block("08 요금 업종 차", "현실 사본·주민 이동 끔·κ_ind=0.05·국제 sigma/eventP=0; 도시별 원가 -10% 장기 산업 몫 효과를 같은 무충격과 비교", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true), base = converged(d, seed, () => ({}));
    const values = [STEEL, LOW].map(target => {
      const r = converged(d, seed, id => id === target ? { energy: { costPerMWh: 0.012 * 0.9 } } : {});
      return relativePct(r, base, target, "ind");
    });
    const [high, low] = values;
    check(seed, high > 0 && low > 0 && high > low * 5,
      `철강 최대(${STEEL})=${fmt(high)}%, 저집약(${LOW})=${fmt(low)}%, 비=${fmt(high / low)}, 목표>5배`);
  });
});

block("09 배속 정의", "반올림되지 않은 E.cities의 Leff·Aeff로 로짓 목표와 실제 첫 달 이동의 κ 역산; 큰 정수 모집단으로 반올림 오차를 1e-9 미만으로 제한, β 배속 금지 함께 검증", () => {
  for (const seed of SEEDS) test(seed, () => {
    for (const real of [true, false]) {
      const d = dataFor(real);
      const kp = p(d, "kappaPopReal"), ki = p(d, "kappaIndReal"), speed = p(d, "eduSpeed");
      check(`${seed} ${real ? "현실" : "게임"} 계수`, near(kp, 0.009) && near(ki, 0.005) &&
        near(p(d, "betaPopReal"), 0.12) && near(p(d, "betaIndReal"), 0.08) && (real || near(speed, 4.4)),
      `κ_pop=${kp}, κ_ind=${ki}, β_pop=${p(d, "betaPopReal")}, β_ind=${p(d, "betaIndReal")}, 배속=${speed}`);
      d.params.gpYear.v = 0; d.params.giYear.v = 0;
      for (const id of IDS) { d.start[id].pop0 *= 1e6; d.start[id].ind0 *= 1e6; }
      const E = initial(d, seed), before = clone(E);
      const r = X.monthStep(E, inputs(E, id => id === FOCAL ? { energy: { unsPct: 100 } } : {}), d);
      for (const [key, eff, beta, kappa] of [["pop", "Leff", 0.12, kp], ["ind", "Aeff", 0.08, ki]]) {
        // REF 2.1: startMix=1, normalized fixed-effect logit. Its common
        // mean cancels exactly, so no engine helper is used for the oracle.
        // The report rounds these scores; state retains migration precision.
        const weights = IDS.map(id => share(before, id, key) * Math.exp(beta *
          number(r.E.cities[id][eff], `E.cities.${id}.${eff}`) / 10));
        const total = sum(weights);
        const gaps = IDS.map((id, i) => weights[i] / total * before.totals[key] - before.cities[id][key]);
        const moved = IDS.map(id => r.E.cities[id][key] - before.cities[id][key]);
        const observed = sum(gaps.map((g, i) => g * moved[i])) / sum(gaps.map(g => g * g));
        const want = kappa * speed;
        const residual = Math.max(...gaps.map((g, i) => Math.abs(moved[i] - want * g)));
        check(`${seed} ${real ? "현실" : "게임"} ${key} 실제 κ·β`, near(observed, want, 1e-9) && residual <= 1.01,
          `κ=${fmt(observed)}, 목표=${want}±1e-9, SPEC β 이동 잔차=${fmt(residual)}명(정수 반올림≤1명)`);
      }
    }
  });
});

block("10 세율 범위", "이동 끈 동일 보정 상태에서 taxRes -2/0/+2; monthStep의 ownRev 결과 resTax 비율", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true); d.params.betaPopReal.v = 0; d.params.betaIndReal.v = 0;
    const E = initial(d, seed);
    for (const id of IDS) {
      const values = [-2, 0, 2].map(step => number(X.monthStep(clone(E), inputs(E,
        cid => cid === id ? { policy: { taxRes: step } } : {}), d).report.fiscal[id].rev.resTax, `fiscal.${id}.resTax`));
      const [low, standard, high] = values;
      // The public fiscal ledger uses rounded game money; compare amounts
      // with two 0.001-unit roundings instead of imposing a ratio precision
      // which rejects correct percentages for small cities.
      check(`${seed}/${id}`, standard > 0 && near(low, standard * 0.5, 0.002) && near(high, standard * 1.5, 0.002),
        `-2/0/+2=${values.map(fmt).join("/")}억, 기준비=${fmt(low / standard)}/${fmt(high / standard)}, 목표=0.5/1.5`);
    }
  });
});
block("11 재정 점수 문턱", "보정 뒤 양의 revYear 고정; cash=-d×budgetToRevenue×revYear로 score.parts.fin의 법정 세 문턱 대조", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true), E = initial(d, seed);
    // Oracle is SPEC's 2.2, never the possibly incorrect implementation value.
    // Missing budgetToRevenue still fails the separate existence assertion.
    const mul = 2.2;
    for (const id of IDS) for (const [ratio, want] of [[0.10, 100], [0.25, 50], [0.40, 0]]) {
      const state = clone(E), revYear = number(state.cities[id].revYear, `cities.${id}.revYear`);
      state.cities[id].cash = -ratio * mul * revYear;
      const actual = number(X.score(state, d).by[id].parts.fin, `score.${id}.fin`);
      check(`${seed}/${id}/d=${ratio}`, revYear > 0 && near(actual, want, 1e-6), `fin=${fmt(actual)}, 목표=${want}`);
    }
  });
});
block("12 지원금 분기 지급", "보정 상태 yearStart가 결정한 도시별 연액(subsidy)을 고정 기대값으로 12달의 월 지급·연합계 대조", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true), E = initial(d, seed, 12);
    const announced = X.yearStart(clone(E), d);
    const annual = Object.fromEntries(IDS.map(id => [id, number(announced.E.cities[id].subsidy, `cities.${id}.subsidy 연액`)]));
    const r = run(d, seed, 12);
    for (const id of IDS) {
      const payments = r.reports.map(R => number(R.fiscal[id].rev.subsidy, `fiscal.${id}.rev.subsidy`));
      const want = annual[id] / 4;
      check(`${seed}/${id}/월별`, annual[id] > 0 && payments.every((v, m) => near(v, m % 3 === 0 ? want : 0, 0.002)),
        `연액=${fmt(annual[id])}, 1~12월=${payments.map(fmt).join(",")}, 분기목표=${fmt(want)}`);
      check(`${seed}/${id}/연합계`, near(sum(payments), annual[id], 0.008), `합=${fmt(sum(payments))}, 연액=${fmt(annual[id])}`);
    }
  });
});

function hostBoot() {
  const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const n of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core"]) {
    const filename = path.join(ROOT, `ui/${n}.js`);
    vm.runInContext(fs.readFileSync(filename, "utf8"), ctx, { filename });
  }
  return ctx.KCP;
}
block("13 대학 자산", "VM 호스트의 무건설 econInput을 lib 근사 에너지와 결합해 보정·36달 실행; 자료 대학 도시의 svc·talent 최대 편차·시작 수 전달 검사", () => {
  const K = hostBoot(), C = K.leagueCore, H = K.econ, data = clone(K.ECON_DATA);
  const region = field(C.regionOf("south"), "leagueCore.regionOf(south)");
  check("econInput 함수", typeof C.econInput === "function", "F05 입력 경로", typeof C.econInput !== "function");
  // Existing uni is used ONLY to identify baseline cities for diagnostics.
  // It never supplies the expected assets or replaces missing univ0/lab0.
  const universities = IDS.filter(id => data.start[id].univ0 > 0 || data.start[id].uni > 0);
  check("대학 도시 존재", universities.length > 0, `자료 선택=${universities.join(",")}`);
  for (const seed of SEEDS) test(seed, () => {
    const S = C.newState(seed, region.id, 0, IDS, { turns: 36 });
    let E = H.initCities(IDS, data, { seed, months: 36 });
    E = H.calibrate(E, inputs(E), data); S.econ = E;
    const start = clone(E);
    const errors = Object.fromEntries(universities.map(id => [id, { svc: 0, talent: 0 }]));
    let assetMismatch = false;
    for (let m = 0; m < 36; m++) {
      S.round = m + 1; S.phase = "plan"; S.events = []; S.econ = E;
      const I = inputs(E);
      for (const id of IDS) {
        S.teams[id].plan = { builds: [], lines: [], policies: [], rq: [] };
        // runRound's public output supplies the argument shape; only assets
        // are used, so seasonal dispatch/events cannot contaminate this row.
      }
      const dispatch = C.runRound(S, K.buildGame);
      for (const id of IDS) {
        const hostInput = C.econInput(S, region, id, dispatch.team[id], 30 / 7);
        I[id].assets = field(hostInput.assets, `econInput.${id}.assets`);
        const s = data.start[id];
        if (s.univ0 != null && s.lab0 != null &&
          (!near(I[id].assets.uni, s.univ0) || !near(I[id].assets.lab, s.lab0))) assetMismatch = true;
      }
      const r = H.monthStep(E, I, data); E = r.E;
      for (const id of universities) for (const [key, parts] of [["svc", "lagL"], ["talent", "lagA"]])
        errors[id][key] = Math.max(errors[id][key], Math.abs(number(E.cities[id][parts][key], `${id}.${parts}.${key}`) -
          number(start.cities[id][parts][key], `start.${id}.${parts}.${key}`)));
    }
    for (const id of universities) {
      const e = errors[id];
      check(`${seed}/${id}/36달 점수`, e.svc <= 1 && e.talent <= 1,
        `시작 svc/talent=${fmt(start.cities[id].lagL.svc)}/${fmt(start.cities[id].lagA.talent)}, 최대편차=${fmt(e.svc)}/${fmt(e.talent)}, 목표 각각≤1`);
    }
    check(`${seed}/시작 수 전달`, !assetMismatch && IDS.every(id => finite(data.start[id].univ0) && finite(data.start[id].lab0)),
      "assets.uni=univ0, assets.lab=lab0; 누락 키는 계약 필드에서 별도 실패");
  });
});

block("14 정전 시 대기 [미구현 허용: H01 뒤]", "coal=lib 수요 MWh인 정상 시작에서 전면 정전·genMWh=0; air 최대 상승을 airSlope×시작 ΔPM으로 제한", () => {
  for (const key of ["kPM", "airSlope", "airBase"]) test(key, () => {
    p(D, key); check(key, true);
  }, true);
  test("pmFuelW", () => { field(D.params.pmFuelW?.v, "params.pmFuelW"); check("pmFuelW", true); }, true);
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true), kPM = p(d, "kPM"), slope = p(d, "airSlope"), base = p(d, "airBase");
    const fuelW = field(d.params.pmFuelW?.v, "params.pmFuelW");
    let E = X.initCities(IDS, d, { seed, months: 36 });
    const normal = inputs(E);
    for (const id of IDS) normal[id].energy.genMWh = { coal: normal[id].energy.demMWh, lng: 0, diesel: 0, biomass: 0 };
    E = X.calibrate(E, normal, d);
    const startAir = number(E.cities[STEEL].lagL.air, `${STEEL}.lagL.air`);
    const own = id => kPM * number(fuelW.coal, "pmFuelW.coal") * normal[id].energy.genMWh.coal;
    // D-69: 철강 최대 발원 도시에는 두 land/bay 이웃의 G 0.2 기여가 유입된다.
    const deltaPM = own(STEEL) + .2 * (own("pyeongtaek") + own("asan"));
    check(`${seed}/H01 유효 충격`, deltaPM > 0 && near(startAir, Math.max(0, Math.min(100, base - slope * deltaPM)), 1e-6),
      `시작 ΔPM=${fmt(deltaPM)}, 시작 air=${fmt(startAir)}, H01 기대=${fmt(base - slope * deltaPM)}`);
    const I = inputs(E, () => ({ energy: { unsPct: 100, servedMWh: 0, co2: 0, co2Local: 0,
      costPerMWh: 0, opex: 0, genMWh: { coal: 0, lng: 0, diesel: 0, biomass: 0 } } }));
    const r = X.monthStep(E, I, d);
    const rise = number(r.report.cities[STEEL].Lparts.air, "report.Lparts.air") - startAir;
    check(seed, rise >= -1e-8 && rise <= slope * deltaPM + 1e-8,
      `상승=${fmt(rise)}점, 상한=${fmt(slope * deltaPM)}점`);
  }, true);
});

block("15 CBAM", "2027년 철강 최대 도시·국제 잡음 0에서 t=0 CBAM 일정 유무의 monthStep 산출 차; 공급 고정·전력 CO₂만 바꾼 두 쌍 및 기본 일정 시작 대조", () => {
  for (const seed of SEEDS) test(seed, () => {
    const d = dataFor(true);
    for (const key of ["lng", "fx", "ship", "export"]) d.intl.sigma[key] = 0;
    const E = initial(d, seed);
    E.year = 2027; E.month = 1;
    // F16: the scheduled real event is active from t=0. Use the documented
    // monthStep API rather than guessing an internal outIdx call signature.
    const scheduled = X.monthStep(clone(E), inputs(E), d);
    const expected = steel(STEEL) * number(d.start[STEEL].exportShare, `start.${STEEL}.exportShare`) *
      0.154 * 0.046 * 0.05 * 5;
    const measured = [];
    for (const intensity of [0.274, 0.82]) {
      const onData = clone(d), offData = clone(d);
      offData.intl.schedule = (d.intl.schedule || []).filter(event => event.id !== "cbam");
      onData.intl.schedule = [...offData.intl.schedule, { t: 0, id: "cbam" }];
      const change = (id, m, state) => id === STEEL ? { energy: {
        co2: energy(id, state.cities[id]).demMWh * intensity,
        co2Local: energy(id, state.cities[id]).demMWh * intensity } } : {};
      const on = X.monthStep(clone(E), inputs(E, change), onData);
      const off = X.monthStep(clone(E), inputs(E, change), offData);
      const a = number(on.E.cities[STEEL].out, "CBAM on cities.out");
      const b = number(off.E.cities[STEEL].out, "CBAM off cities.out");
      measured.push(b - a);
    }
    // cities.out is a rounded public index. SPEC's 2027 loss is smaller
    // than its 0.001 reporting unit; do not demand unobservable precision.
    // Zero international noise gives a neutral off-index of 1, so a real
    // loss remains observable. Carbon independence below is a paired exact
    // comparison: identical non-CBAM conditions have identical rounding.
    check(`${seed}/2027년 감소`, expected > 0 && measured.every(v => v > 0 && near(v, expected, 0.001)),
      `저/고 전력 탄소 CBAM 감소=${measured.map(fmt).join("/")}, SPEC 감소=${fmt(expected)}(공개 out 반올림 오차≤0.001)`);
    check(`${seed}/전력 탄소 독립`, measured.every(v => v > 0) && near(measured[0], measured[1], 1e-9),
      `탄소집약도=0.274/0.82, 감소차=${fmt(measured[1] - measured[0])}`);
    check(`${seed}/시작 일정`, (d.intl.schedule || []).some(e => e.id === "cbam" && e.t === 0) &&
      scheduled.report.intl.cbam > 0, `t=0 일정 및 첫 운영 활성=${scheduled.report.intl.cbam}`);
  });
});

row = "원본 보존";
check("ECON_DATA 깊은 사본", JSON.stringify(D) === snapshot, "현실 모드·속도·장기 수렴·host 입력 실험 후 원본 동일");
console.log("\n행별 결과:");
for (const [name, counts] of rows) console.log(`${name}: 통과 ${counts.pass} / 실패 ${counts.fail}`);
console.log(`\n미구현 키: ${[...missingKeys].sort().join(", ") || "없음"}`);
console.log(`미구현 ${missing} (실패에 포함), 그중 H01 뒤 미구현 허용 ${allowedMissing}`);
console.log(`통과 ${pass} / 실패 ${fail}`);
if (failures.length) console.log(`\n실패·미구현 목록:\n${failures.map(s => `- ${s}`).join("\n")}`);
process.exitCode = fail ? 1 : 0;
