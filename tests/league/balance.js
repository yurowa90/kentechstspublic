/* 독립 목표 검사: docs/ECON-BALANCE.md. 구현의 계산식을 기대값으로 복사하지 않는다. */
"use strict";
const path = require("path");
global.window = { KCP: {} };
Math.random = () => { throw new Error("Math.random 호출 금지"); };
// ECON_DATA 사실 문장(SMR 공사 달)이 기술 원장을 읽으므로 실제 앱처럼 tech-data를 먼저 읽는다.
require(path.resolve(__dirname, "../../ui/tech-data.js"));
require(path.resolve(__dirname, "../../ui/econ-data.js"));
require(path.resolve(__dirname, "../../ui/econ.js"));
require(path.resolve(__dirname, "../../ui/league-data.js"));
const { econ: X, ECON_DATA: D } = window.KCP;
const IDS = Object.keys(D.start);
const SMALL = IDS.reduce((a, b) => D.start[a].cash0 <= D.start[b].cash0 ? a : b);
// 검사 장치의 단위 근사(M), 게임 계수를 변경하지 않음. 용어 절·review/lib.js 참고.
const FIXTURE = { people: 1e5, mwhPerDay: 25, days: 30, cost: 0.012,
  localCo2PerDay: 2.5, co2PerDay: 4, renew: 15, spare: 100 };
const SEEDS = Array.from({ length: 40 }, (_, i) => `balance-${i}`);
const clone = x => JSON.parse(JSON.stringify(x));
const sum = xs => xs.reduce((s, x) => s + x, 0);
const mean = xs => sum(xs) / xs.length;
const finite = Number.isFinite;
const fmt = x => finite(x) ? x.toFixed(3) : String(x);
function annualDebtRevenue(rows, id) {
  const recurring = rows.map(R => {
    const rev = R.fiscal?.[id]?.rev;
    return rev?.resTax + rev?.indTax;
  });
  const subsidies = rows.map(R => R.fiscal?.[id]?.rev?.subsidy);
  // v1.3: 12달 전에는 반복 세입 달 평균×12 + 올해 1월 지원금 1회분.
  // 12달부터는 최근 12달 세금·지원금 합계. 차익·거래·사건·회수 수입은 제외한다.
  const annual = rows.length < 12 ? mean(recurring) * 12 + subsidies[0] :
    sum(recurring) + sum(subsidies);
  return { recurring, subsidies, annual };
}
// RECAL F14: 첫해 시작 표준세입; 매년 1월 직전 연도 세금·분기 지원금 합계.
function capRevenue(r, id, m) {
  const yearStart = Math.floor(m / 12) * 12;
  return yearStart === 0 ? r.start.cities[id].revYear : sum(r.reports.slice(yearStart - 12, yearStart).map(R => {
    const v = R.fiscal[id].rev; return v.resTax + v.indTax + v.subsidy;
  }));
}
let pass = 0, fail = 0;
let section = "";
const counts = {}, failures = [];
function ok(cond, message) {
  const bucket = counts[section]; bucket.total++;
  if (cond) { pass++; bucket.pass++; }
  else { fail++; failures.push(`${section} ${message}`); }
}
function test(message, fn) {
  try { fn(); } catch (e) { ok(false, `${message}: 예외 ${e.message}`); }
}
function block(key, fn) {
  section = key; counts[key] = { pass: 0, total: 0 };
  test("검사 실행", fn);
  console.log(`${key} 통과 ${counts[key].pass}/${counts[key].total}`);
}
function energy(C, e = {}) {
  const demMWh = C.pop / FIXTURE.people * FIXTURE.mwhPerDay * FIXTURE.days;
  const costPerMWh = e.costPerMWh ?? FIXTURE.cost;
  return Object.assign({ unsPct: 0, hospH: 0, costPerMWh,
    co2Local: C.pop / FIXTURE.people * FIXTURE.localCo2PerDay * FIXTURE.days,
    co2: C.pop / FIXTURE.people * FIXTURE.co2PerDay * FIXTURE.days,
    demMWh, opex: demMWh * costPerMWh, renPct: FIXTURE.renew,
    tradeNet: 0, capexNew: 0, spareMW: FIXTURE.spare }, e);
}
function inputs(E, change = () => ({}), m = E.t) {
  return Object.fromEntries(E.order.map(id => {
    const o = change(id, m, E) || {};
    return [id, { energy: energy(E.cities[id], o.energy),
      policy: Object.assign({ taxRes: 0, taxInd: 0, service: 0, incentive: 0 }, o.policy) }];
  }));
}
function initial(seed = SEEDS[0], months = 36, data = D) {
  const E = X.initCities(IDS, data, { seed, months });
  return X.calibrate(E, inputs(E), data);
}
function run(months, change = () => ({}), seed = SEEDS[0], data = D) {
  let E = initial(seed, months, data);
  const start = clone(E), reports = [], states = [];
  for (let m = 0; m < months; m++) {
    const r = X.monthStep(E, inputs(E, change, m), data);
    if (!r || !r.E || !r.report) throw new Error(`monthStep ${m + 1}달 E/report 없음`);
    E = r.E; reports.push(r.report); states.push(E);
  }
  return { start, E, reports, states };
}
const lossPct = (r, id, m = r.states.length - 1) =>
  (r.states[m].cities[id].pop / r.start.cities[id].pop - 1) * 100;
const sharePct = (r, id, m = r.states.length - 1) =>
  ((r.states[m].cities[id].pop / r.states[m].totals.pop) /
    (r.start.cities[id].pop / r.start.totals.pop) - 1) * 100;
function operating(r, id) {
  return sum(r.reports.slice(0, 12).map(R => {
    const f = R.fiscal?.[id];
    if (![f?.revTotal, f?.expTotal, f?.exp?.capex].every(finite))
      throw new Error(`${id} fiscal 운영 수지 계약 필드 없음`);
    return f.revTotal - (f.expTotal - f.exp.capex);
  }));
}
function param(key, grade, expected) {
  const p = D.params[key];
  ok(!!p && finite(p.v) && p.grade === grade && typeof p.note === "string" && p.note.length > 0 &&
    (expected == null || Math.abs(p.v - expected) < 1e-9),
  `params.${key}=${JSON.stringify(p)} (목표 ${expected ?? "유한값"}, ${grade}, note)`);
}

block("B1", () => {
  param("betaPopReal", "M");
  // RECAL-SPEC §1.1·F01: 법인세 고용 탄력과 짝지은 산업 탄력(M).
  param("betaIndReal", "M");
  param("eduSpeed", "G"); param("startMix", "P");
  // ECON-BALANCE B1(v1.1): startMix 값은 회복·안정 목표로 정한다(0.2 고정 → 0..1 범위). 행동 목표는 아래 단언이 판정.
  ok(D.params.startMix && D.params.startMix.v >= 0 && D.params.startMix.v <= 1, `params.startMix 0..1 (${D.params.startMix && D.params.startMix.v})`);
  const stable = SEEDS.map(seed => run(36, undefined, seed));
  IDS.forEach(id => test(`${id} 40씨앗 반응`, () => {
    for (const [uns, lo, hi, drop] of [[100, -8, -3, 20], [5, -2.5, -0.5, 6]]) {
      const rr = SEEDS.map(seed => run(12, cid => cid === id ? { energy: { unsPct: uns } } : {}, seed));
      const pop = mean(rr.map(r => lossPct(r, id)));
      const appr = mean(rr.map(r => r.E.cities[id].approval - r.start.cities[id].approval));
      ok(finite(pop) && pop >= lo && pop <= hi, `${id} 정전${uns}% 12달 주민 ${fmt(pop)}% (목표 ${hi}%~${lo}%, 40씨앗)`);
      ok(finite(appr) && appr <= -drop, `${id} 정전${uns}% 지지율 ${fmt(appr)}점 (목표 ≤-${drop})`);
    }
    const rec = SEEDS.map(seed => run(24, (cid, m) => cid === id && m < 6 ? { energy: { unsPct: 100 } } : {}, seed));
    const peak = mean(rec.map(r => Math.max(0, ...r.states.map((_, m) => -lossPct(r, id, m)))));
    const end = mean(rec.map(r => Math.max(0, -lossPct(r, id))));
    ok(peak > 0 && finite(end) && end <= peak * 0.6,
      `${id} 6달 정전→18달 회복 최대손실 ${fmt(peak)}%, 마지막 ${fmt(end)}% (목표 ≤${fmt(peak * 0.6)}%)`);
    const drift = Math.max(...Array.from({ length: 36 }, (_, m) => Math.abs(mean(stable.map(r => sharePct(r, id, m))))));
    ok(finite(drift) && drift <= 0.6, `${id} 보통 조건 36달 최대 몫 변화 ${fmt(drift)}% (목표 ≤0.6%, 상대 변화)`);
  }));
  test("배속을 실제 사용", () => {
    if (!["betaPopReal", "betaIndReal", "eduSpeed"].every(k => finite(D.params[k]?.v))) {
      ok(false, "현실 계수×교육용 배속 사용 검증: 계약 필드 없음"); return;
    }
    const off = clone(D); off.params.eduSpeed.v = 0;
    const zeroReal = clone(D); zeroReal.params.betaPopReal.v = 0; zeroReal.params.betaIndReal.v = 0;
    const fast = clone(D); fast.params.eduSpeed.v *= 2;
    const change = id => id === SMALL ? { energy: { unsPct: 100 } } : {};
    const a = run(12, change, SEEDS[0], off), b = run(12, change, SEEDS[0], zeroReal), c = run(12, change, SEEDS[0], fast);
    for (const key of ["pop", "ind"]) {
      const av = a.E.cities[SMALL][key], bv = b.E.cities[SMALL][key], cv = c.E.cities[SMALL][key];
      ok(av === bv && cv < av, `${SMALL} ${key} 배속0=${av}, 현실계수0=${bv}, 배속2배=${cv} (곱 사용)`);
    }
  });
});

block("B2", () => {
  param("approvalDrop", "G", 10);
  const baseline = run(12);
  IDS.forEach(id => test(`${id} 평가`, () => {
    const bad = run(12, cid => cid === id ? { energy: { unsPct: 5, renPct: 0 },
      policy: { taxRes: 2, taxInd: 2, service: -2 } } : {});
    for (const [label, r, expected] of [["악조건", bad, false], ["보통 조건", baseline, true]]) {
      const c = r.E.cities[id], review = r.reports[11].review?.[id];
      ok(review?.pass === expected, `${id} ${label} 평가 pass=${review?.pass}, 지지율=${fmt(c.approval)} (목표 ${expected})`);
      ok(finite(c.approval0) && Math.abs(c.approval0 - r.start.cities[id].approval) < 1e-6,
        `${id} ${label} approval0=${c.approval0}, 보정 시작=${fmt(r.start.cities[id].approval)}`);
      ok(finite(c.approval0) && typeof review?.pass === "boolean" &&
        review.pass === (c.approval >= c.approval0 - 10), `${id} ${label} 시작 기준 평가 계약`);
    }
  }));
});

block("B3", () => {
  const base = run(12), base36 = run(36);
  // 세금은 첫 달 주민 수에 대해 발생하므로 첫 달 상태로 나눈다.
  const first = IDS.map(id => base.reports[0].fiscal?.[id]?.rev?.resTax / base.states[0].cities[id].pop);
  const err = (Math.max(...first) - Math.min(...first)) / mean(first);
  ok(first.every(finite) && finite(err) && err <= 0.01,
    `주민 1인당 세금 상대 차이 ${fmt(err * 100)}% (목표 ≤1%), ${JSON.stringify(Object.fromEntries(IDS.map((id, i) => [id, first[i]])))}`);
  IDS.forEach(id => test(`${id} 정책 수지`, () => {
    const low = run(12, cid => cid === id ? { policy: { taxRes: -2, taxInd: -2, service: 2 } } : {});
    const high = run(12, cid => cid === id ? { policy: { taxRes: 2, taxInd: 2, service: -2 } } : {});
    const l = operating(low, id), delta = operating(high, id) - operating(base, id);
    const drop = high.E.cities[id].approval - base.E.cities[id].approval;
    // v1.6.1: 상대 기준과 복원된 절대 적자를 함께 검증한다.
    ok(finite(l) && l < 0, `${id} 저세율·서비스+2 연 운영수지 ${fmt(l)}억 (절대 적자)`);
    const low36 = run(36, cid => cid === id ? { policy: { taxRes: -2, taxInd: -2, service: 2 } } : {});
    const baseAnnual = operating(base, id);
    const cashDelta = (low36.E.cities[id].cash - low36.start.cities[id].cash) -
      (base36.E.cities[id].cash - base36.start.cities[id].cash);
    ok(finite(l) && finite(baseAnnual) && l < baseAnnual,
      `${id} 저세율·서비스+2 연 운영 수지 ${fmt(l)}억, 정책0 ${fmt(baseAnnual)}억 (목표 정책0 미만)`);
    ok(finite(cashDelta) && cashDelta < 0,
      `${id} 저세율·서비스+2 36달 누적 현금 차이 ${fmt(cashDelta)}억 (목표 정책0 미만)`);
    ok(delta >= 0.3 * D.start[id].cash0, `${id} 고세율 수지 개선 ${fmt(delta)}억 (목표 ≥${fmt(0.3 * D.start[id].cash0)})`);
    ok(drop <= -8, `${id} 고세율 지지율 차이 ${fmt(drop)}점 (목표 ≤-8)`);
  }));
  // 정책 격자의 판정 입력은 B12 v1.6.1과 통일한다. 25칸 대각선도 아래 B12에서 단언.

});

block("B4", () => {
  const baseline = run(12);
  IDS.forEach(id => test(`${id} 요금과 거래`, () => {
    const trade = run(12, cid => cid === id ? { energy: { tradeNet: D.start[id].cash0 * 10 } } : {});
    const a = baseline.reports[11].cities?.[id]?.Lparts?.price, b = trade.reports[11].cities?.[id]?.Lparts?.price;
    ok(finite(a) && finite(b) && Math.abs(a - b) < 1e-9, `${id} 거래0 price=${a}, 거래증가 price=${b} (목표 동일)`);
    const prices = [0.3, 0.5].map(mul => {
      // v1.2 우선: B11 — 매달 입력 공급량으로 가중 평균을 0.012에 맞춘다.
      const r = run(12, (cid, m, E) => {
        const own = energy(E.cities[id]).demMWh;
        const others = sum(IDS.filter(key => key !== id).map(key => energy(E.cities[key]).demMWh));
        const rest = 1 + own * (1 - mul) / others;
        return { energy: { costPerMWh: FIXTURE.cost * (cid === id ? mul : rest) } };
      });
      return r.reports[11].cities?.[id]?.Lparts?.price;
    });
    // v1.2 우선: B11 — 공급량 가중 평균의 0.3/0.5배 하한 비교.
    ok(prices.every(finite) && prices[0] === prices[1], `${id} 원가 가중평균0.3/0.5 price=${prices.join("/")} (목표 동일)`);
  }));
  test("평균에 원가0 도시도 포함", () => {
    const r = run(12, id => id === SMALL ? { energy: { costPerMWh: 0 } } : {});
    const id = IDS.find(cid => cid !== SMALL), p = r.reports[11].cities?.[id]?.Lparts?.price;
    const b = baseline.reports[11].cities?.[id]?.Lparts?.price;
    ok(finite(p) && finite(b) && p < b, `원가0 도시 포함: 다른 도시 price=${p}, 기준=${b} (평균 하락)`);
  });
  const markup = D.params.tariffMarkup;
  ok(finite(markup?.v) && markup?.grade === "G" && !!markup?.note, `params.tariffMarkup=${JSON.stringify(markup)} (G·note 필요)`);
  IDS.forEach(id => test(`${id} 차익 보고`, () => {
    const R = baseline.reports[0], f = R.fiscal?.[id];
    const dem = energy(baseline.start.cities[id]).demMWh;
    const gross = dem * FIXTURE.cost * (1 + markup?.v);
    const margin = gross - dem * FIXTURE.cost;
    ok(finite(f?.tariffGross) && finite(gross) && Math.abs(f.tariffGross - gross) < 0.01,
      `${id} tariffGross=${f?.tariffGross} (목표 ${fmt(gross)})`);
    ok(finite(f?.rev?.tariff) && finite(margin) && Math.abs(f.rev.tariff - margin) < 0.01,
      `${id} rev.tariff=${f?.rev?.tariff} (차익 목표 ${fmt(margin)})`);
  }));
  test("비싼 전력의 음수 차익", () => {
    // v1.2 우선: B11 — 원가를 10배 올린 도시도 공급량 가중 평균으로 차익 계산.
    const E = initial(), ins = inputs(E, id => id === SMALL ? { energy: { costPerMWh: FIXTURE.cost * 10 } } : {});
    const others = IDS.filter(id => id !== SMALL);
    const avg = sum(others.map(id => ins[id].energy.demMWh * ins[id].energy.costPerMWh)) / sum(others.map(id => ins[id].energy.demMWh));
    const e = ins[SMALL].energy, want = e.demMWh * (avg * (1 + markup?.v) - e.costPerMWh);
    const f = X.monthStep(E, ins, D)?.report?.fiscal?.[SMALL];
    // v1.2 우선: B11 — 이 입력은 정전 0이므로 공급량=수요량.
    ok(finite(want) && want < 0 && finite(f?.rev?.tariff) && Math.abs(f.rev.tariff - want) < 0.01,
      `${SMALL} 비싼 전력 차익=${f?.rev?.tariff}, 목표=${fmt(want)} (음수 허용)`);
  });
});

block("B5", () => {
  param("scorePartFloor", "G", 1);
  const E = initial();
  IDS.forEach(id => test(`${id} 재정 점수`, () => {
    const parts = cash => { const e = clone(E); e.cities[id].cash = cash; return X.score(e, D)?.by?.[id]?.parts; };
    const a = parts(E.cities[id].cash0 * 3), b = parts(0), c = parts(-0.20 * 2.2 * E.cities[id].revYear);
    const keys = Object.keys(a || {}).sort().join(",");
    ok(keys === ["pop", "ind", "fin", "co2", "appr", "rel"].sort().join(","), `${id} parts 키=${keys} (정확히 pop,ind,fin,co2,appr,rel)`);
    ok(a?.fin === 100 && b?.fin === 100, `${id} 현금3배/0 fin=${a?.fin}/${b?.fin} (목표 100/100)`);
    ok(finite(c?.fin) && c.fin === 66.7, `${id} 한도50% 부채 fin=${c?.fin} (F14: 예산 채무 20%, 목표 66.7)`);
  }));
  const w = D.params.wScore?.v;
  const expected = { pop: .10, ind: .10, fin: .125, co2: .275, appr: .15, rel: .25 };
  ok(Object.keys(expected).every(k => finite(w?.[k]) && Math.abs(w[k] - expected[k]) < 1e-9) &&
    Math.abs(sum(Object.values(w)) - 1) < 1e-9 && !Object.hasOwn(w || {}, "cash"),
    `점수 가중 ${JSON.stringify(w)} (RECAL-SPEC §7.4: T5·B16 G 재보정, 합1·cash 제외)`);
});

block("B6", () => {
  // F13 목표 자체를 검증: 상·하한 여부만 판별하고 구현의 보정식을 재계산하지 않는다.
  for (const targetRatio of [D.params.fiscalTargetRev.v, .6]) {
    const data = clone(D);
    data.params.fiscalTargetRev.v = targetRatio; // .6은 비제약 분기를 실제로 실행하는 별도 검사 입력.
    for (const key of ["eduSpeed", "gpYear", "giYear"]) data.params[key].v = 0;
    data.intl.eventP = 0; data.intl.schedule = [];
    for (const key of Object.keys(data.intl.sigma)) data.intl.sigma[key] = 0;
    const r = run(12, undefined, SEEDS[0], data);
    let lower = 0, upper = 0, free = 0;
    IDS.forEach(id => {
      const c = r.start.cities[id], subsidy = X.yearStart(r.start, data).E.cities[id].subsidy;
      ok(operating(r, id) > 0, `B6 ${id} 보통 조건 연 운영수지 > 0`);
      const atLower = c.equalize <= .001;
      const atUpper = Math.abs(c.equalize - subsidy * data.params.equalizeMaxShare.v) <= .001;
      if (atLower) lower++;
      else if (atUpper) upper++;
      else {
        free++;
        const target = data.params.fiscalTargetRev.v * c.revYear, actual = operating(r, id);
        ok(Math.abs(actual - target) <= .03,
          `F13 비제약 도시 연 운영수지=${fmt(actual)}, 목표=${fmt(target)} (반올림 ≤.03억)`);
      }
    });
    ok(lower + upper + free === IDS.length && (targetRatio !== .6 || free > 0), "F13 모든 도시 경계 분류·비제약 목표 검증 존재");
    console.log(`B6 목표비율 ${targetRatio} 정액보정 경계: 하한 ${lower}, 상한 ${upper}, 비제약 ${free}`);
  }
});

block("B7", () => {
  const baseline = run(24);
  IDS.forEach(id => test(`${id} 거래와 지방채`, () => {
    const r = run(24, (cid, m) => cid === id && m === 1 ? { energy: { tradeNet: D.start[id].cash0 * 100 } } : {});
    for (const m of [1, 2]) {
      const cap = r.states[m].cities[id].debtCap;
      const rows = r.reports.slice(0, m + 1);
      const eligible = rows.map(R => {
        const rev = R.fiscal?.[id]?.rev;
        return rev?.resTax + rev?.indTax + rev?.subsidy;
      });
      const want = capRevenue(r, id, m) * D.params.debtCapRatio?.v;
      const control = baseline.states[m].cities[id].debtCap;
      // v1.3: 반복 세입만 평균×12, 지원금은 1회분. 월 20% 제한은 적용하지 않는다.
      ok(eligible.every(finite) && finite(want) && finite(cap) && Math.abs(cap - want) <= 0.1,
        `${id} ${m + 1}달 debtCap=${fmt(cap)}, 반복 세입 연환산·지원금1회 목표=${fmt(want)}`);
      ok(finite(cap) && finite(control) && Math.abs(cap - control) <= Math.max(0.1, control * 0.001),
        `${id} 거래 제외 한도=${fmt(cap)}, 무거래=${fmt(control)} (같은 세입)`);
    }
    for (const m of [11, 23]) {
      const rev12 = sum(r.reports.slice(m - 11, m + 1).map(R => {
        const rev = R.fiscal?.[id]?.rev;
        return rev?.resTax + rev?.indTax + rev?.subsidy;
      }));
      const want = D.params.debtCapRatio?.v * capRevenue(r, id, m), cap = r.states[m].cities[id].debtCap;
      // v1.2 우선: B11 — 최근12달 세금·지원금만 포함, 전기 차익도 제외.
      ok(finite(want) && finite(cap) && Math.abs(cap - want) <= 0.1,
        `${id} ${m + 1}달 최근12달 세금·지원금 한도=${fmt(cap)}, 목표=${fmt(want)}`);
    }
    for (const m of [0, 5]) {
      const rows = r.reports.slice(0, m + 1);
      const { annual } = annualDebtRevenue(rows, id);
      const cap = r.states[m].cities[id].debtCap, want = D.params.debtCapRatio?.v * capRevenue(r, id, m);
      // v1.3: 반복 세입 달 평균만 연환산하고 올해 1월 지원금은 한 번만 더한다.
      ok(finite(want) && finite(cap) && Math.abs(cap - want) <= 0.1,
        `${id} ${m + 1}달 관측 평균 연환산 한도=${fmt(cap)}, 목표=${fmt(want)} (지원금은 1회분)`);
    }
  }));
});

block("B8", () => {
  // 모든 도시가 충족 가능한 동일 조건의 제안: 도시별 자격 차이로 순위를 가리지 않는다.
  const offer = { id: "fixture", name: "검사용 기업", workers: 1, mw: 1, rePct: 0, unsMax: 100 };
  const won = {};
  SEEDS.forEach(seed => test(`${seed} 동일 입력 승자`, () => {
    const E = initial(seed), ev = X.evalOffer(offer, E, inputs(E), D);
    const id = ev?.rank?.find(cid => ev.by?.[cid]?.ok === true);
    if (!id) throw new Error("evalOffer rank 또는 충족 도시 없음");
    won[id] = (won[id] || 0) + 1;
  }));
  ok(Object.keys(won).length >= 2, `40씨앗 동일 입력 승자 ${JSON.stringify(won)} (목표 ≥2곳)`);
  IDS.forEach(id => test(`${id} MW 누락`, () => {
    const E = initial(), ins = inputs(E); delete ins[id].energy.spareMW;
    const by = X.evalOffer(offer, E, ins, D)?.by?.[id];
    ok(by?.checks?.mw?.ok === false && by?.ok === false,
      `${id} spareMW 누락 mw.ok=${by?.checks?.mw?.ok}, 전체 ok=${by?.ok} (둘 다 false)`);
  }));
  const ranks = SEEDS.map(seed => {
    const change = id => id === SMALL ? { energy: { renPct: 100 }, policy: { incentive: 20, taxInd: -2 } } : {};
    const r = run(12, change, seed);
    return X.evalOffer(offer, r.E, inputs(r.E, change), D)?.rank?.[0];
  });
  ok(ranks.every(id => id === SMALL), `최소 cash0 ${SMALL} 보조20·산업세-2·재생100 1위 ${ranks.filter(id => id === SMALL).length}/40 (목표 40/40)`);
});

block("B10", () => {
  test("yearStart 지급 가드", () => {
    const E = initial(), before = JSON.stringify(E), one = X.yearStart(E, D), two = X.yearStart(one.E, D);
    ok(JSON.stringify(E) === before, "yearStart 입력 불변");
    ok(one.E?.paidQuarter === `${E.year}:1`, `paidYear=${one.E?.paidYear} (목표 ${E.year})`);
    IDS.forEach(id => {
      ok(one.E.cities[id].cash > E.cities[id].cash, `${id} 첫 yearStart 지급`);
      ok(two.E?.cities?.[id]?.cash === one.E.cities[id].cash,
        `${id} 같은 해 중복 지급 현금 ${fmt(one.E.cities[id].cash)}→${fmt(two.E?.cities?.[id]?.cash)} (목표 동일)`);
    });
  });
  for (const months of [12, 24, 36]) test(`${months}달 길이 제한`, () => {
    const r = run(months), before = JSON.stringify(r.E), next = X.monthStep(r.E, inputs(r.E), D);
    ok(next?.report === null && JSON.stringify(next?.E) === before && JSON.stringify(r.E) === before,
      `${months}달 뒤 monthStep t=${next?.E?.t}, report=${next?.report === null ? "null" : typeof next?.report} (목표 상태 불변·report:null)`);
  });
  param("newsMin", "G"); param("newsFrac", "G");
  test("작은 흐름에 이주·이전 뉴스 없음", () => {
    const r = run(12);
    const rows = r.reports.slice(0, 3);
    const news = rows.flatMap(R => R.news || []).filter(s => /→.*(?:이주|이전)/.test(s));
    const sizes = rows.map(R => Object.fromEntries(["pop", "ind"].map(k => [k, Math.max(0, ...(R.flows?.[k] || []).map(f => f.n))])));
    ok(news.length === 0, `보통 조건 초기3달 작은 흐름 ${JSON.stringify(sizes)}, 뉴스 ${JSON.stringify(news)} (목표 없음)`);
  });
});

// v1.2 전용 입력: 기존 B1–B10의 동일 원가 입력과 단언은 그대로 둔다.
function inputs12(E, change = () => ({}), m = E.t) {
  return Object.fromEntries(E.order.map((id, i) => {
    const o = change(id, m, E) || {};
    const e = energy(E.cities[id], Object.assign({
      demMWh: E.cities[id].pop / FIXTURE.people * (450 + 80 * i),
      costPerMWh: FIXTURE.cost * (0.7 + 0.15 * i),
      unsPct: i * 0.4, tradeNet: (i - (IDS.length - 1) / 2) * 0.3
    }, o.energy));
    // 명세의 공급량 해석: 명시된 servedMWh가 없으면 수요×(1−정전율)로 계산한다.
    e.servedMWh = o.energy?.servedMWh ?? e.demMWh * (1 - e.unsPct / 100);
    e.buyCost = o.energy?.buyCost ?? Math.max(0, -e.tradeNet);
    // costPerMWh는 자기 수요용 연료·정책·구매비를 합친 공급량당 원가로 해석한다.
    // opex에는 구매비를 뺀 연료·정책비와 판매용 연료를 넣는다. 판매 수입은 tradeNet에만 있다.
    e.opex = o.energy?.opex ?? e.servedMWh * e.costPerMWh - e.buyCost + Math.max(0, e.tradeNet) * 0.5;
    return [id, { energy: e,
      policy: Object.assign({ taxRes: 0, taxInd: 0, service: 0, incentive: 0 }, o.policy) }];
  }));
}
function run12(months, change = () => ({}), seed = "balance-v1.2") {
  let E = X.initCities(IDS, D, { seed, months });
  E = X.calibrate(E, inputs12(E), D);
  const start = clone(E), reports = [], states = [], supplied = [];
  for (let m = 0; m < months; m++) {
    const ins = inputs12(E, change, m), r = X.monthStep(E, ins, D);
    if (!r?.E || !r?.report) throw new Error(`monthStep v1.2 ${m + 1}달 E/report 없음`);
    E = r.E; supplied.push(ins); reports.push(r.report); states.push(E);
  }
  return { start, E, reports, states, supplied };
}
const served12 = e => e.servedMWh ?? e.demMWh * (1 - e.unsPct / 100);
function averageCost12(ins, excluded) {
  const live = IDS.filter(id => id !== excluded).map(id => ins[id].energy).filter(e => served12(e) > 0);
  return sum(live.map(e => served12(e) * e.costPerMWh)) / sum(live.map(served12));
}

block("B11", () => {
  test("공급량 가중 매출·차익과 0공급 제외", () => {
    const r = run12(1, id => id === SMALL ? { energy: { unsPct: 100, costPerMWh: 0, tradeNet: 0 } } : {});
    const ins = r.supplied[0], avg = averageCost12(ins), markup = D.params.tariffMarkup?.v;
    IDS.forEach(id => {
      const e = ins[id].energy, f = r.reports[0].fiscal?.[id], served = served12(e);
      const gross = served * averageCost12(ins, id) * (1 + markup), margin = gross - served * e.costPerMWh;
      ok(finite(f?.tariffGross) && finite(gross) && Math.abs(f.tariffGross - gross) <= 0.01,
        `${id} 공급=${fmt(served)}/${fmt(e.demMWh)}, 가중원가=${fmt(avg)}, tariffGross=${f?.tariffGross}, 목표=${fmt(gross)}`);
      ok(finite(f?.rev?.tariff) && finite(margin) && Math.abs(f.rev.tariff - margin) <= 0.01,
        `${id} 공급량 기준 차익=${f?.rev?.tariff}, 목표=${fmt(margin)}`);
    });
    const blackoutPrice = r.reports[0].cities?.[SMALL]?.Lparts?.price;
    // 한 도시의 원가를 다른 공급 도시의 가중 평균에 맞추면 지역 평균과도 같아진다.
    const target = IDS.find(id => id !== SMALL);
    const others = IDS.filter(id => id !== target && served12(ins[id].energy) > 0);
    const normalCost = sum(others.map(id => served12(ins[id].energy) * ins[id].energy.costPerMWh)) /
      sum(others.map(id => served12(ins[id].energy)));
    const normal = run12(1, id => id === SMALL ? { energy: { unsPct: 100, costPerMWh: 0, tradeNet: 0 } } :
      id === target ? { energy: { unsPct: 0, costPerMWh: normalCost, tradeNet: 0 } } : {});
    const normalPrice = normal.reports[0].cities?.[target]?.Lparts?.price;
    // ECON-NEXT §1 감사 A가 B11의 공급0 요금0점을 대체: 직전 부분 점수 보존(정전 이중 감점 제거).
    ok(blackoutPrice === r.start.cities[SMALL].lagL.price && finite(normalPrice),
      `정전100% ${SMALL} price=${blackoutPrice}, 직전=${r.start.cities[SMALL].lagL.price} (동일)`);
    const normalCap = normal.reports[0].fiscal?.[target]?.debtCap;
    ok(finite(normalCap) && normalCap > 0,
      `${target} 정전0%·평균원가 fiscal.debtCap=${fmt(normalCap)} (목표 >0)`);
    const f = r.reports[0].fiscal?.[SMALL];
    ok(f?.rev?.tariff === 0 && f?.tariffGross === 0,
      `${SMALL} 정전100% 차익=${f?.rev?.tariff}, 매출=${f?.tariffGross} (둘 다 0)`);
  });
  IDS.forEach(id => test(`${id} 구매·판매 요금 점수`, () => {
    const scenarios = [
      { tradeNet: 0, buyCost: 0 },
      { tradeNet: -2, buyCost: 2 },
      { tradeNet: 2, buyCost: 0 },
      { tradeNet: 20, buyCost: 0 }
    ];
    const prices = scenarios.map(e => run12(1, cid => cid === id ? {
      energy: Object.assign({ unsPct: 0, costPerMWh: FIXTURE.cost }, e)
    } : {}).reports[0].cities?.[id]?.Lparts?.price);
    const gap = Math.abs(prices[1] - prices[2]);
    ok(prices.every(finite) && gap <= 5,
      `${id} 자기수요 원가 동일 수입/수출 price=${prices[1]}/${prices[2]}, 차이=${fmt(gap)} (≤5점)`);
    ok(prices.every(finite) && Math.max(...prices) - Math.min(...prices) <= 0.01,
      `${id} 무거래/구매/판매/판매10배 price=${prices.join("/")} (자기수요 원가만 반영)`);
  }));
  test("공급0 도시 원가는 지역 평균에서 제외", () => {
    const results = [0, FIXTURE.cost * 100].map(costPerMWh => run12(1, id => id === SMALL ? {
      energy: { unsPct: 100, costPerMWh, tradeNet: 0 }
    } : {}));
    IDS.filter(id => id !== SMALL).forEach(id => {
      const a = results[0].reports[0], b = results[1].reports[0];
      const ap = a.cities?.[id]?.Lparts?.price, bp = b.cities?.[id]?.Lparts?.price;
      const ag = a.fiscal?.[id]?.tariffGross, bg = b.fiscal?.[id]?.tariffGross;
      ok([ap, bp, ag, bg].every(finite) && Math.abs(ap - bp) < 0.01 && Math.abs(ag - bg) < 0.01,
        `${id} 0공급 도시 원가0/100배 price=${ap}/${bp}, 매출=${ag}/${bg} (동일)`);
    });
  });
  test("세금·지원금만으로 매달 지방채 한도 갱신", () => {
    const baseline = run12(24);
    const spike = run12(24, (id, m) => m === 0 ? { energy: {
      costPerMWh: baseline.supplied[0][id].energy.costPerMWh * 3
    } } : {});
    for (const [label, r] of [["보통", baseline], ["첫달 원가3배", spike]]) IDS.forEach(id => {
      for (const m of [...Array.from({ length: 11 }, (_, i) => i), 11, 23]) {
        const rows = r.reports.slice(Math.max(0, m - 11), m + 1);
        // v1.3: B7과 같은 독립 기대식을 사용한다.
        const { recurring, subsidies, annual } = annualDebtRevenue(rows, id);
        const want = capRevenue(r, id, m) * D.params.debtCapRatio?.v;
        const cap = r.reports[m].fiscal?.[id]?.debtCap;
        ok(recurring.every(finite) && subsidies.every(finite) && finite(want) && finite(cap) && Math.abs(cap - want) <= 0.1,
          `${label} ${id} ${m + 1}달 fiscal.debtCap=${fmt(cap)}, 반복 세입 연환산·지원금1회 목표=${fmt(want)}`);
      }
      const caps = r.reports.slice(0, 11).map(R => R.fiscal?.[id]?.debtCap);
      ok(caps.every(c => finite(c) && c > 0),
        `${label} ${id} 1~11달 한도=${caps.map(fmt).join("/")} (모두 >0)`);
    });
  });
});

block("B12", () => {
  const host = require("./review/21-host-policy-grid");
  const result = host.grid();
  host.check(result);
  ok(true, "B12 실제 호스트 125×6 조합(반올림 전): 공통1위 없음·감세·증세 계열 각각 ≤3도시·세율 축별 6도시 독식 없음");
  const winners = IDS.filter(id => {
    const diagonal = result[id].rows.filter(r => r.taxRes === r.taxInd);
    ok(diagonal.length === 25 && diagonal.every(r => finite(r.score) && finite(r.preRound)), `${id} B3 실제 호스트 25칸`);
    return host.topRows(diagonal).some(r => r.key === "-2,-2,2");
  });
  ok(winners.length <= 2, `B3 실제 호스트 감세·서비스+2 1위 ${winners.length}/6 (≤2)`);
});

block("B13", () => {
  for (const months of [12, 24, 36]) test(`${months}달 평균 지지율`, () => {
    const base = run12(months);
    IDS.forEach(id => test(`${id} 막판 정책 변경`, () => {
      const late = run12(months, (cid, m) => cid === id && m >= months - 2 ? {
        policy: { taxRes: -2, taxInd: -2, service: 2 }
      } : {});
      for (const [label, r] of [["보통", base], ["마지막2달 변경", late]]) {
        // 매달 정산 뒤 지지율을 사용한다. 초기 보정 상태는 '달'에 포함하지 않는다.
        const approvals = r.states.slice(-12).map(E => E.cities[id].approval);
        const want = mean(approvals), appr = X.score(r.E, D)?.by?.[id]?.parts?.appr;
        // 공개 점수는 소수 첫째 자리로 보고하므로 평균의 반올림 오차 0.05점을 허용한다.
        ok(approvals.every(finite) && finite(appr) && Math.abs(appr - want) <= 0.051,
          `${months}달 ${id} ${label} parts.appr=${fmt(appr)}, 마지막12달 평균=${fmt(want)}`);
      }
      const a = X.score(base.E, D)?.by?.[id]?.score, b = X.score(late.E, D)?.by?.[id]?.score;
      const delta = b - a;
      ok(finite(a) && finite(b) && delta <= 1 + 1e-9,
        `${months}달 ${id} 막판변경 점수=${fmt(b)}, 보통=${fmt(a)}, 증가=${fmt(delta)} (≤1점)`);
    }));
  });
});

block("B14", () => {
  test("정책0 지역 평균 주민 기여·화면 필드·정액 보정 상한", () => {
    const r = run12(36);
    for (let m = 0; m < 36; m++) {
      const annual = Math.floor(m / 12) * 12;
      let contribution = 0, population = 0;
      IDS.forEach(id => {
        const f = r.reports[m].fiscal?.[id], jan = r.reports[annual].fiscal?.[id];
        const pop = r.states[m].cities[id].pop;
        // F25: 1월 공지 연액 = 분기 지급액×4. 정액 기본·보정을 빼고 12달 배분.
        const perCapSubsidy = (4 * jan?.rev?.subsidy - jan?.equalize - D.params.subBase?.v) / pop;
        const net = f?.rev?.resTax / pop + perCapSubsidy / 12 + f?.rev?.tariff / pop - f?.exp?.service / pop;
        ok(finite(net) && finite(f?.perResidentNet) && Math.abs(f.perResidentNet - net) < 1e-12,
          `${id} ${m + 1}달 perResidentNet=${f?.perResidentNet}, 기대=${net}억/명·달 (도시별 음수 허용)`);
        contribution += net * pop; population += pop;
        if (m === annual) {
          const ratio = jan?.equalize / (4 * jan?.rev?.subsidy);
          ok(finite(jan?.equalize) && jan.equalize >= 0 && finite(ratio) && ratio <= 0.5,
            `${id} ${m + 1}달 정액보정=${fmt(jan?.equalize)}, 1월 공지 연액=${fmt(4 * jan?.rev?.subsidy)}, 비율=${fmt(ratio * 100)}% (≤50%)`);
        }
      });
      const average = contribution / population;
      ok(finite(average) && average >= 0,
        `${m + 1}달 지역 인구 가중 평균 주민1명 월 순효과=${fmt(average * 1e8)}원 (≥0)`);
    }
  });
});

block("B15", () => {
  // RECAL-SPEC §7.2·§7.3: 실제 move 진입 인자를 계측해 β 불변·κ 시간 압축 확인.
  const fs = require("node:fs"), vm = require("node:vm"), calls = [];
  const source = fs.readFileSync(path.resolve(__dirname, "../../ui/econ.js"), "utf8")
    .replace("function move(E, key, eff, beta, kappa, totNew, data) {",
      "function move(E, key, eff, beta, kappa, totNew, data) { recordMove(key, beta, kappa);");
  const sandbox = { window: { KCP: { ECON_DATA: D } }, recordMove: (key, beta, kappa) => calls.push({ key, beta, kappa }) };
  vm.runInNewContext(source, sandbox);
  for (const speed of [1, 4.4]) {
    const data = clone(D); data.params.eduSpeed.v = speed;
    const engine = sandbox.window.KCP.econ, E = engine.initCities(IDS, data);
    calls.length = 0; engine.monthStep(E, inputs(E), data);
    for (const [key, beta, real] of [["pop", 0.12, 0.009], ["ind", 0.08, 0.005]]) {
      const call = calls.find(c => c.key === key);
      ok(call && Math.abs(call.beta - beta) < 1e-9 && Math.abs(call.kappa - real * speed) < 1e-9,
        `${key} eduSpeed=${speed}: β=${call?.beta}, κ=${call?.kappa} (β=${beta}, κ=${real * speed})`);
    }
  }
  param("eduSpeed", "G", 4.4);
  param("betaIndReal", "M", 0.08);
});

block("B17", () => {
  // v1.3: 정책·인구·종사자를 고정해 1월 지원금 연환산에 따른 한도 왜곡을 측정한다.
  const data = clone(D);
  for (const key of ["eduSpeed", "gpYear", "giYear"]) data.params[key].v = 0;
  let E = X.initCities(IDS, data, { seed: "balance-v1.3", months: 24 });
  const ins = inputs12(E);
  E = X.calibrate(E, ins, data);
  const start = clone(E), reports = [], states = [];
  for (let m = 0; m < 13; m++) {
    const r = X.monthStep(E, ins, data);
    if (!r?.E || !r?.report) throw new Error(`monthStep v1.3 ${m + 1}달 E/report 없음`);
    E = r.E; reports.push(r.report); states.push(E);
  }
  ok(IDS.length === 6, `v1.3 참가 도시=${IDS.length} (목표 6)`);
  IDS.forEach(id => test(`${id} 첫달·13달째 한도`, () => {
    const first = reports[0].fiscal?.[id]?.debtCap, later = reports[12].fiscal?.[id]?.debtCap;
    const cash0 = start.cities[id].cash0, delta = Math.abs(later - first) / first;
    const fixed = states.every(S => S.cities[id].pop === start.cities[id].pop &&
      S.cities[id].ind === start.cities[id].ind &&
      JSON.stringify(S.cities[id].policy) === JSON.stringify(ins[id].policy));
    ok(fixed, `${id} 13달 정책·인구·종사자 고정`);
    // RECAL-SPEC §1.1·§8 #6: cash0 상한을 새 연 세입 비율의 정확한 기대값으로 교체한다.
    const firstWant = start.cities[id].revYear * data.params.debtCapRatio?.v;
    const laterWant = annualDebtRevenue(reports.slice(0, 12), id).annual * data.params.debtCapRatio?.v;
    console.log(`B17 측정 ${id} cash0=${fmt(cash0)}, 첫달=${fmt(first)}, 13달째=${fmt(later)}, 차이=${fmt(delta * 100)}%, 목표=${fmt(firstWant)}/${fmt(laterWant)}`);
    ok(finite(cash0) && cash0 > 0 && finite(first) && first > 0 && Math.abs(first - Math.round(firstWant * 10) / 10) < 1e-9,
      `${id} 첫달 한도=${fmt(first)}, cash0=${fmt(cash0)} (연 세입×0.88=${fmt(firstWant)})`);
    ok(fixed && finite(first) && first > 0 && finite(later) && finite(delta) && delta <= 0.3,
      `${id} 첫달/13달째 한도=${fmt(first)}/${fmt(later)}, 첫달 대비 차이=${fmt(delta * 100)}% (≤30%)`);
  }));
});

block("H01 PM2.5 증분·정전 상한", () => {
  // 독립 손계산: 석탄 10,000 MWh → .07㎍/㎥, P 이웃 → .07×(.059/.092), .07×.45; G 이웃 → .07×.2.
  // CO₂ 대리값 재도입, 소비량 사용, 이웃의 재전파, eduAir의 이주 적용을 잡는다.
  const E = X.initCities(IDS, D, { seed: "s4-air", months: 36 });
  const normal = inputs(E, id => ({ energy: { co2Local: 0, co2: 0,
    genMWh: { coal: id === "dangjin" ? 10000 : 0, lng: 0, diesel: 0, biomass: 0 } } }));
  const start = X.calibrate(E, normal, D);
  const expected = { dangjin: 77.97, pyeongtaek: 80 - 29 * .07 * .2, hwaseong: 80,
    asan: 80 - 29 * .07 * (.059 / .092), cheonan: 80 - 29 * .07 * .45, anseong: 80 };
  for (const id of IDS) ok(Math.abs(start.cities[id].lagL.air - expected[id]) < 1e-9,
    `${id} 직접·인접만 PM 반영: ${start.cities[id].lagL.air}`);
  ok(Math.abs(start.cities.dangjin.groupParts.air - 71.88) < 1e-9, "집단 만족만 대기 영향 ×4");
  for (const [fuel, want] of [["coal", 77.97], ["diesel", 78.376], ["biomass", 78.376], ["lng", 79.8985]]) {
    const I = clone(normal); I.dangjin.energy.genMWh = { [fuel]: 10000 };
    const a = X.calibrate(E, I, D).cities.dangjin;
    ok(Math.abs(a.lagL.air - want) < 1e-9, `${fuel} 연료별 PM: ${a.lagL.air}`);
    I.dangjin.energy.co2Local = 999999; I.dangjin.energy.co2 = 999999;
    I.dangjin.energy.importMWh = 99999; I.dangjin.energy.servedMWh = 0;
    ok(X.calibrate(E, I, D).cities.dangjin.lagL.air === a.lagL.air, `${fuel} CO₂·소비·수입과 독립`);
  }
  const noEdu = clone(D); noEdu.params.eduAir.v = 1;
  const plain = X.calibrate(E, normal, noEdu);
  ok(plain.cities.dangjin.L === start.cities.dangjin.L, "eduAir는 이주용 L 불변");
  ok(Math.abs(plain.cities.dangjin.groupParts.air - 77.97) < 1e-9, "eduAir=1 집단 만족 원래 크기");
  const off = clone(normal);
  IDS.forEach(id => Object.assign(off[id].energy, { unsPct: 100, servedMWh: 0, co2: 0,
    co2Local: 0, genMWh: { coal: 0, lng: 0, diesel: 0, biomass: 0 } }));
  const r = X.monthStep(start, off, D);
  const rise = r.report.cities.dangjin.Lparts.air - start.cities.dangjin.lagL.air;
  console.log(`H01 측정 시작 ΔPM=0.07, 정전 air 상승=${rise}, 상한=2.03`);
  ok(rise >= 0 && rise <= 2.03 + 1e-9, "§7.2 전면 정전 air 상승 상한");
  ok(r.report.cities.dangjin.Lparts.air === 80, "무배출도 airBase까지, 100점 아님");
});

failures.forEach(message => console.log(`FAIL ${message}`));
console.log(`pass ${pass} fail ${fail}`);
process.exitCode = fail ? 1 : 0;
