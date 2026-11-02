'use strict';

// Independent acceptance tests. Expected behavior comes only from docs/ECON-NEXT.md.
// Run from the repository root: node tests/league/next.js
// No application source is inspected to derive an expected value.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
let checks = 0;
let fail = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) {
    fail += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function scenario(name, run) {
  try {
    await run();
  } catch (error) {
    check(`${name}: fixture / execution`, false, error.message);
  }
}

const copy = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const approx = (a, b, eps = 0.01) => finite(a) && finite(b) && Math.abs(a - b) <= eps;
const same = (a, b) => {
  try { assert.deepEqual(copy(a), copy(b)); return true; } catch { return false; }
};

function ledgerContract(id, result) {
  const ledger = result && result.ledger;
  check(`${id}: ledger exists`, !!ledger && typeof ledger === 'object');
  for (const key of ['open', 'income', 'invest', 'opex', 'close']) {
    check(`${id}: ledger.${key} finite`, finite(ledger && ledger[key]));
  }
  if (!ledger) return;
  check(`${id}: ledger identity within 0.01`,
    approx(ledger.open + ledger.income - ledger.invest - ledger.opex, ledger.close),
    JSON.stringify(ledger));
  check(`${id}: investments nonnegative`, finite(ledger.invest) && ledger.invest >= 0);
  check(`${id}: operating costs nonnegative`, finite(ledger.opex) && ledger.opex >= 0);
}

function operationsContract(id, result) {
  for (const key of ['loss', 'idle']) {
    check(`${id}: ${key} finite MWh`, finite(result && result[key]));
    check(`${id}: ${key} nonnegative`, finite(result && result[key]) && result[key] >= 0);
  }
  check(`${id}: cpList array`, Array.isArray(result && result.cpList));
  for (const [index, item] of ((result && result.cpList) || []).entries()) {
    check(`${id}: cpList[${index}].kind`, ['noise', 'view', 'smoke', 'forest'].includes(item.kind));
    check(`${id}: cpList[${index}].score finite`, finite(item.score));
    check(`${id}: cpList[${index}].near present`, Object.hasOwn(item, 'near'));
  }
}

function causesContract(id, report) {
  const city = report.cities && report.cities[id];
  const causes = city && city.causes;
  check(`${id}: causes array`, Array.isArray(causes));
  if (!Array.isArray(causes)) return;
  check(`${id}: causes at most 3`, causes.length <= 3);
  check(`${id}: cause keys unique`, new Set(causes.map(cause => cause.key)).size === causes.length);
  for (const [index, cause] of causes.entries()) {
    check(`${id}: causes[${index}].key`, typeof cause.key === 'string' && cause.key.length > 0);
    check(`${id}: causes[${index}].label`, typeof cause.label === 'string' && cause.label.trim().length > 0);
    check(`${id}: causes[${index}].delta finite`, finite(cause.delta));
    // "기여가 큰 순" means magnitude of this month's signed contribution.
    // A large negative contribution must precede a small positive contribution.
    if (index) check(`${id}: causes descending contribution magnitude`,
      Math.abs(causes[index - 1].delta) + 1e-9 >= Math.abs(cause.delta));
  }
  const groups = report.groups && report.groups[id];
  check(`${id}: group explanation exists`, !!groups && Object.hasOwn(groups, 'why'));
  if (causes.length && groups) {
    // ECON-NEXT §0: why 객체의 key가 첫 원인의 key와 같아야 한다.
    check(`${id}: why uses leading cause key`, groups.approvalChangeCause?.key === causes[0].key && typeof groups.why === "string" && typeof groups.whyGrade === "string",
      `why=${JSON.stringify(groups.why)} first=${JSON.stringify(causes[0].key)}`);
  }
}

function regionContract(report, ids) {
  const region = report.region;
  check('region exists', !!region);
  if (!region) return;
  for (const key of ['unsPct', 'co2']) check(`region.${key} finite`, finite(region[key]));
  check('region.unsPct in percentage range', finite(region.unsPct) && region.unsPct >= 0 && region.unsPct <= 100);
  check('region.co2 nonnegative', finite(region.co2) && region.co2 >= 0);
  for (const key of ['uns', 'co2']) {
    check(`region.goal.${key} finite`, finite(region.goal && region.goal[key]));
    check(`region.met.${key} boolean`, typeof (region.met && region.met[key]) === 'boolean');
    // A goal for outages / emissions is an upper bound, including equality.
    const actual = key === 'uns' ? region.unsPct : region.co2;
    check(`region.met.${key} agrees with goal`, !!region.met && !!region.goal &&
      region.met[key] === (actual <= region.goal[key]));
  }
  check('contrib exists', !!report.contrib);
  for (const id of ids) {
    const contribution = report.contrib && report.contrib[id];
    check(`${id}: contribution exists`, !!contribution);
    for (const key of ['exportMWh', 'importMWh', 'co2Cut', 'tieCost']) {
      check(`${id}: contrib.${key} finite`, finite(contribution && contribution[key]));
    }
    for (const key of ['exportMWh', 'importMWh', 'tieCost']) {
      check(`${id}: contrib.${key} nonnegative`, finite(contribution && contribution[key]) && contribution[key] >= 0);
    }
  }
}

// Existing acceptance harnesses supply only the VM bootstrap and public API
// calling conventions. None of their expected outcomes are used below.
function boot() {
  const sandbox = { console, document: { documentElement: {} },
    KCP: { route() {}, on() {}, esc: value => String(value) } };
  const context = vm.createContext(sandbox);
  context.window = context;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
    const filename = path.join(ROOT, `ui/${name}.js`);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  const K = context.KCP;
  return { K, C: K.leagueCore, BG: K.buildGame, X: K.econ, D: K.ECON_DATA };
}

function energy(city, overrides = {}) {
  // Synthetic data (M), no real student data. Only contrasts are asserted;
  // these numbers are fixture units, not claimed ECON-NEXT coefficients.
  const demMWh = city.pop / 1e5 * 750;
  return { unsPct: 0, hospH: 0, costPerMWh: 0.012, co2Local: demMWh / 10,
    co2: demMWh / 8, demMWh, opex: demMWh * 0.012, renPct: 20,
    tradeNet: 0, capexNew: 0, spareMW: 10, cp: 0, cpList: [], ...overrides };
}

function inputs(E, change = () => ({})) {
  return Object.fromEntries(E.order.map(id => {
    const overrides = change(id, E.cities[id]) || {};
    return [id, { energy: energy(E.cities[id], overrides.energy),
      policy: { taxRes: 0, taxInd: 0, service: 0, incentive: 0, ...overrides.policy } }];
  }));
}

function initial(X, D, ids) {
  const E = X.initCities(ids, D, { seed: 'econ-next-independent', months: 12 });
  return X.calibrate(E, inputs(E), D);
}

function game(C, BG, R, ids) {
  const S = C.newState('NEXT22', R.id, 0, ids, { turns: 12 });
  for (const id of ids) {
    const reply = C.reduce(S, { type: 'claim', team: id, token: `next-${id}` }, 1, BG);
    if (!reply.ok) throw new Error(`${id}: claim rejected`);
    S.econ.cities[id].cash = 100000;
  }
  C.host(S, 'next', 2);
  S.events = [];
  return S;
}

function planFor(BG, C, R, id, type = 'diesel', far = false) {
  BG.selectPack(C.teamDef(R, id).pack, 'league');
  const homes = BG.SITES.filter(site => /home|town|village|city|resid/i.test(site.kind));
  if (!homes.length) throw new Error(`${id}: village fixture missing`);
  const anchors = BG.SITES.filter(site => site.dem).map(site => site.tile);
  const distance = (a, b) => Math.hypot(BG.TILES[a].X - BG.TILES[b].X, BG.TILES[a].Y - BG.TILES[b].Y);
  const candidates = BG.TILES.filter(tile => !tile.out && tile.site < 0 && !BG.siteRule(type, tile))
    .map(tile => ({ tile, d: Math.min(...homes.map(site => distance(tile.i, site.tile))) }))
    .sort((a, b) => far ? b.d - a.d : a.d - b.d);
  const candidate = candidates.find(({ tile }) => BG.routePath(anchors[0], tile.i));
  if (!candidate) throw new Error(`${id}: connected ${type} fixture missing`);
  const lines = [];
  // Connect identical demand sites in both placements; route cost is captured
  // by ledger, not changed into an expected complaint coefficient.
  for (const end of [...anchors.slice(1), candidate.tile.i]) {
    const route = BG.routePath(anchors[0], end);
    if (!route) throw new Error(`${id}: fixture route missing`);
    for (let at = 0; at < route.length - 1; at += 79) lines.push({ p: route.slice(at, at + 80) });
  }
  const plan = BG.sanitize({ builds: [{ t: type, i: candidate.tile.i }], lines,
    policies: [], missions: [], shed: 'equal', rq: [], seed: 2026 }, 1e9);
  return { plan, distance: candidate.d };
}

function operate(C, BG, S) {
  if (S.phase !== 'plan') C.host(S, 'next', 100 + S.round * 100);
  S.events = [];
  return C.run(S, BG, 150 + S.round * 100);
}

async function main() {
  let environment;
  await scenario('bootstrap', () => {
    environment = boot();
    check('engine APIs available', !!environment.C && !!environment.BG && !!environment.X && !!environment.D);
  });
  if (!environment) return;
  const { C, BG, X, D } = environment;
  const R = C.regionOf('south');
  const ids = R.teams.map(team => team.id);
  const id = ids[0];

  await scenario('§0 public left / ledger / operations / causes / region', () => {
    const S = game(C, BG, R, ids);
    for (const city of ids) S.teams[city].plan = planFor(BG, C, R, city).plan;
    const view = C.publicView(S, 3);
    check('plan CO2 target is positive monthly tonnes', finite(view.goals.co2Plan) && view.goals.co2Plan > 0);
    check('plan CO2 basis is public', typeof view.goals.co2Basis === 'string' && view.goals.co2Basis.length > 0);
    check('public snapshot retains the fixed CO2 target', C.goalsOf(view, 1e9).co2Plan === view.goals.co2Plan);
    for (const city of ids) {
      const spend = C.spendOf(BG, S, R, city, S.teams[city].plan);
      check(`${city}: paid plan has positive spend`, finite(spend) && spend > 0);
      check(`${city}: public left = budget - spend`,
        approx(view.teams[city].left, C.budget(S, city) - spend));
      check(`${city}: public left differs from budget for paid plan`,
        !approx(view.teams[city].left, C.budget(S, city)));
    }
    const result = C.run(S, BG, 50);
    check('evaluation uses the published plan CO2 target', result.econ.region.goal.co2 === view.goals.co2Plan);
    check('review retains the published plan CO2 target', C.publicView(S, 51).goals.co2Plan === view.goals.co2Plan);
    for (const city of ids) {
      ledgerContract(city, result.team[city]);
      operationsContract(city, result.team[city]);
      causesContract(city, result.econ);
      check(`${city}: ledger close agrees with cash`,
        approx(result.team[city].ledger && result.team[city].ledger.close, S.econ.cities[city].cash));
    }
    regionContract(result.econ, ids);
  });

  await scenario('§1 separate outage / hospital outage / complaint cause keys', () => {
    const base = initial(X, D, ids);
    const fixtures = [
      ['outage', { unsPct: 100 }, /정전|outage/i, /병원|hospital/i],
      ['hospital', { hospH: 720 }, /병원|hospital/i, null],
      ['complaint', { cp: 100, cpList: [{ kind: 'noise', score: 100, near: true }] }, /민원|complaint|noise/i, null],
    ];
    const keys = [];
    for (const [name, changes, include, exclude] of fixtures) {
      const { report } = X.monthStep(copy(base), inputs(base, city => city === id ? { energy: changes } : {}), D);
      causesContract(`${name}/${id}`, { cities: { [`${name}/${id}`]: report.cities[id] },
        groups: { [`${name}/${id}`]: report.groups[id] } });
      const causes = report.cities[id].causes || [];
      // Keys are intentionally unspecified; identify their meaning by label.
      const cause = causes.find(item => include.test(item.label) && (!exclude || !exclude.test(item.label)));
      check(`${name}: separate explanatory cause present`, !!cause, JSON.stringify(causes));
      check(`${name}: signed penalty delta < 0`, !!cause && finite(cause.delta) && cause.delta < 0);
      if (cause) keys.push(cause.key);
    }
    check('outage / hospital / complaints have three distinct keys', keys.length === 3 && new Set(keys).size === 3);
  });

  await scenario('§1 zero-supply priceScore preserves preceding price', () => {
    let E = initial(X, D, ids);
    const price = 0.018;
    E = X.monthStep(E, inputs(E, city => city === id ? { energy: { costPerMWh: price } } : {}), D).E;
    // Identical zero-supply scenarios: only the meaningless price calculated
    // from a zero denominator differs. The preceding, nonzero-supply price is
    // the reference. Compare the entire city outcome, not a guessed private field.
    const zeroSupply = costPerMWh => inputs(E, city => city === id ? { energy: {
      unsPct: 100, hospH: 0, costPerMWh, opex: 0, co2: 0, co2Local: 0, renPct: 0, spareMW: 0,
    } } : {});
    const zero = X.monthStep(copy(E), zeroSupply(0), D);
    const reference = X.monthStep(copy(E), zeroSupply(price), D);
    check('zero supply: price 0 and preceding price produce same approval',
      approx(zero.E.cities[id].approval, reference.E.cities[id].approval, 1e-9));
    check('zero supply: price 0 and preceding price produce same group response',
      same(zero.report.groups[id], reference.report.groups[id]));
    check('zero supply: price 0 and preceding price produce same cause contributions',
      same(zero.report.cities[id].causes, reference.report.cities[id].causes));
  });

  await scenario('§0 coop bonus added outside six score parts', () => {
    const parameter = D.params.coopBonus;
    check('params.coopBonus grade G', !!parameter && parameter.grade === 'G');
    check('params.coopBonus positive finite', !!parameter && finite(parameter.v) && parameter.v > 0);
    if (!parameter) return;
    const E = initial(X, D, ids);
    // Guaranteed clean, reliable operation; do not make the positive-bonus
    // assertion conditional on a difficult power-grid fixture meeting goals.
    const cleanInputs = inputs(E, () => ({ energy: {
      unsPct: 0, hospH: 0, co2: 0, co2Local: 0, renPct: 100,
    } }));
    const result = X.monthStep(copy(E), cleanInputs, D);
    check('coop fixture: both regional goals actually met', !!result.report.region &&
      result.report.region.met.uns === true && result.report.region.met.co2 === true);
    const score = X.score(result.E);
    const previous = parameter.v;
    let noBonus;
    try {
      parameter.v = 0;
      const withoutAward = X.monthStep(copy(E), copy(cleanInputs), D);
      noBonus = X.score(withoutAward.E);
    } finally { parameter.v = previous; }
    let awarded = false;
    for (const city of ids) {
      const row = score.by[city], plain = noBonus.by[city];
      check(`${city}: score parts stay six`, !!row && Object.keys(row.parts || {}).length === 6);
      check(`${city}: coop excluded from parts`, !!row && !Object.hasOwn(row.parts || {}, 'coop'));
      check(`${city}: separate coop field finite`, finite(row && row.coop));
      check(`${city}: coop nonnegative`, !!row && finite(row.coop) && row.coop >= 0);
      check(`${city}: turning bonus off preserves six parts`, same(row.parts, plain.parts));
      check(`${city}: total difference equals separate coop`, approx(row.score - plain.score, row.coop, 1e-9));
      awarded ||= finite(row.coop) && row.coop > 0;
    }
    // Prevent a permanently-zero placeholder from passing the score contract.
    check('both regional goals met: bonus actually awarded', awarded);
  });

  await scenario('§1 near vs far placement: six-month approval gap at least 2', () => {
    const histories = [];
    for (const far of [false, true]) {
      const S = game(C, BG, R, ids);
      const placement = planFor(BG, C, R, id, 'diesel', far);
      S.teams[id].plan = placement.plan;
      const records = [];
      for (let month = 0; month < 6; month++) {
        const result = operate(C, BG, S);
        ledgerContract(`${far ? 'far' : 'near'}/${id}/month${month + 1}`, result.team[id]);
        records.push({ approval: S.econ.cities[id].approval, cpList: result.team[id].cpList,
          uns: result.team[id].unsPct });
      }
      histories.push({ distance: placement.distance, records });
    }
    const [near, far] = histories;
    check('near vs far fixture really changes distance', far.distance > near.distance);
    check('near placement generates complaints', near.records.some(row =>
      Array.isArray(row.cpList) && row.cpList.some(item => item.score > 0)));
    const gap = far.records[5].approval - near.records[5].approval;
    check('six-month approval: far - near >= 2 points', finite(gap) && gap >= 2, `gap=${gap}`);
  });

  await scenario('§1 profit sharing is not always beneficial in policy grid', () => {
    // ECON-NEXT §1: 이익공유는 기존 plan.policies의 share로 실행한다.
    // 정책 목록 공개는 계약이 아니다. 실제 입력 수용과 아래 격자의 효과를 검사한다.
    const share = 'share';
    const accepted = BG.sanitize({ policies: [share] }, 1e9).policies.includes(share);
    check('profit-sharing policy fixture accepted', accepted);
    if (!accepted) return;
    let changed = 0, better = 0, notBetter = 0;
    for (const far of [false, true]) for (const tax of [-2, 0, 2]) for (const service of [-2, 0, 2]) {
      const rows = [];
      for (const enabled of [false, true]) {
        const S = game(C, BG, R, ids);
        S.teams[id].plan = planFor(BG, C, R, id, 'diesel', far).plan;
        S.teams[id].plan.policies = enabled ? [share] : [];
        S.teams[id].econPol = { taxRes: tax, taxInd: tax, service, incentive: 0 };
        for (let month = 0; month < 6; month++) operate(C, BG, S);
        rows.push({ score: X.score(S.econ).by[id].score, cash: S.econ.cities[id].cash });
      }
      check(`sharing grid far=${far} tax=${tax} service=${service}: finite scores`, rows.every(row => finite(row.score)));
      const delta = rows[1].score - rows[0].score;
      if (Math.abs(delta) > 1e-9 || Math.abs(rows[1].cash - rows[0].cash) > 0.01) changed += 1;
      if (delta > 1e-9) better += 1;
      else if (finite(delta)) notBetter += 1;
    }
    check('sharing actually affects score or finances in grid (not a no-op)', changed > 0, `changed=${changed}`);
    check('sharing is not a score gain in every grid cell', notBetter > 0, `better=${better} notBetter=${notBetter}`);
  });

  await scenario('§1 negative subsidy settles once', () => {
    // ECON-NEXT §1: 음수 지원금은 사건의 budgetAdd → energy.bonus다.
    // ECON-SPEC §5의 국가 지원금은 하한 0이므로 params를 음수로 바꾸지 않는다.
    const definition = R.events.find(event => finite(event.effect?.budgetAdd) && event.effect.budgetAdd < 0);
    check('negative event subsidy fixture available', !!definition);
    if (!definition) return;
    const bonus = definition.effect.budgetAdd;
    const E = initial(X, D, ids);
    const paid = X.yearStart(E, D);
    const plain = X.monthStep(E, inputs(E), D);
    const direct = X.monthStep(E, inputs(E, () => ({ energy: { bonus } })), D);
    const prepaid = X.monthStep(paid.E, inputs(E, () => ({ energy: { bonus } })), D);
    const twice = X.yearStart(paid.E, D);
    check('yearStart remains idempotent with negative event fixture', same(twice.E, paid.E));
    for (const city of ids) {
      check(`${city}: negative event cash change matches bonus once`,
        approx(direct.E.cities[city].cash - plain.E.cities[city].cash, bonus));
      check(`${city}: direct vs prepaid negative support cash equal`,
        approx(direct.E.cities[city].cash, prepaid.E.cities[city].cash));
      check(`${city}: prepaid national support not booked twice`, prepaid.report.fiscal[city].rev.subsidy === 0);
      for (const [label, result] of [['direct', direct], ['prepaid', prepaid]]) {
        const f = result.report.fiscal[city];
        check(`${city}/${label}: signed event support recorded`, f.rev.bonus === bonus && f.eventBonus === bonus);
        check(`${city}/${label}: signed support cash identity`,
          approx(f.cashBefore + f.revTotal - f.expTotal, f.cashAfter));
      }
    }
  });

  await scenario('§1 event targeting absent line does not choose another line', () => {
    // ECON-NEXT §1: 지정 선은 effect.tieDown이며 scope는 다른 효과의 적용 범위다.
    // 풍력·수요 변화가 섞이지 않은 선 사건으로 운영 결과의 동일성을 확인한다.
    const definition = R.events.find(event => typeof event.effect?.tieDown === 'string' &&
      Object.keys(event.effect).every(key => ['tieDown', 'budgetAdd'].includes(key)));
    check('named-line event fixture available', !!definition);
    if (!definition) return;
    const hitIds = definition.effect.tieDown.split('~');
    check('named-line event targets exactly two endpoint cities',
      new Set(hitIds).size === 2 && hitIds.every(city => ids.includes(city)));
    if (new Set(hitIds).size !== 2 || !hitIds.every(city => ids.includes(city))) return;
    const unrelated = R.ties.find(tie => !hitIds.includes(tie.a) && !hitIds.includes(tie.b));
    check('unrelated built line fixture available', !!unrelated);
    if (!unrelated) return;
    const S = game(C, BG, R, ids);
    for (const city of ids) S.teams[city].plan = planFor(BG, C, R, city).plan;
    S.ties = [{ ...copy(unrelated), cap: 4, st: 'built' }];
    const noEvent = copy(S), withEvent = copy(S);
    withEvent.events = [{ id: definition.id, round: S.round, x: 1 }];
    const a = C.runRound(noEvent, BG), b = C.runRound(withEvent, BG);
    // Event metadata may record that a line event was ineffective. Only
    // operating outcomes and actual ties are required to remain identical.
    check('absent target: every city outcome unchanged', same(a.team, b.team));
    check('absent target: regional operating outcome unchanged', same(a.region, b.region));
    check('absent target: unrelated line state unchanged', same(withEvent.ties, noEvent.ties));
    check('absent target: no line reported down', b.tieDown === null);
    // A present target must allow BOTH endpoint cities to respond, not only a.
    const present = copy(S);
    const target = C.tieDef(R, hitIds[0], hitIds[1]);
    if (!target) throw new Error('target line fixture missing');
    present.ties.push({ ...copy(target), cap: 4, st: 'built' });
    present.events = [{ id: definition.id, round: present.round, x: 1 }];
    // ECON-NEXT §1: 사건 자체가 무효인 fixture가 통과하지 않도록 지정 선의 단절도 확인한다.
    check('present target: named line reported down',
      C.runRound(copy(present), BG).tieDown === definition.effect.tieDown);
    const option = (definition.opts || []).find(item => item.id && item.cost >= 0);
    if (!option) throw new Error('line-event response option fixture missing');
    for (const city of hitIds) {
      const reply = C.reduce(copy(present), { type: 'respond', team: city, token: `next-${city}`,
        ev: definition.id, opt: option.id }, 4, BG);
      check(`${city}: line endpoint response accepted`, reply.ok === true, JSON.stringify(reply));
    }
  });
}

main().catch(error => check('runner', false, error.message)).finally(() => {
  console.log(`checks ${checks} fail ${fail}`);
  process.exitCode = fail ? 1 : 0;
});
