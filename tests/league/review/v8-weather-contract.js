'use strict';
// V8 문구 14 독립 기대값. 입력은 검사 쪽 복제 시뮬레이션의 물리량이다.
module.exports = function weatherShort(before, after, old, current) {
  const fmt = (v, digits) => v.toLocaleString('ko-KR', { maximumFractionDigits: digits });
  const seasons = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  const entry = (name, left, right, unit) => ({
    same: left === right, change: `${name} ${left} → ${right}${unit}`, flat: `${name} ${right}${unit}`
  });
  const demand = entry('평균 수요', fmt(before.demand, 2), fmt(after.demand, 2), ' MW');
  const change = Number(((after.renewable / before.renewable - 1) * 100).toFixed(1)) + 0;
  const renewable = {
    same: fmt(before.renewable, 1) === fmt(after.renewable, 1),
    change: before.renewable > 0 ? `하루 재생 공급량 ${change > 0 ? '+' : ''}${fmt(change, 1).replace('-', '−')}%` :
      `하루 재생 공급량 ${fmt(before.renewable, 1)} → ${fmt(after.renewable, 1)} MWh/일(이전 값 0)`,
    flat: after.renewable === 0 ? '재생 공급 없음' : `하루 재생 공급량 ${fmt(after.renewable, 1)} MWh/일`
  };
  const entries = Math.abs(after.renewable - before.renewable) / 24 > Math.abs(after.demand - before.demand) ?
    [renewable, demand] : [demand, renewable];
  const differentDays = old.days !== current.days;
  entries.push(entry('무더위', differentDays ? fmt(100 * before.hotDays / old.days, 0) + '%' : String(before.hotDays),
    differentDays ? fmt(100 * after.hotDays / current.days, 0) + '%' : String(after.hotDays), differentDays ? ' 날' : '일'));
  for (const [key, label] of [['wind', '육상 허브 기준'], ['offshoreWind', '해상 100m 기준']])
    if ([before[key], after[key]].every(Number.isFinite))
      entries.push(entry(`평균 풍속(${label})`, fmt(before[key], 1), fmt(after[key], 1), ' m/s'));
  entries.push(entry('계절', seasons[old.season], seasons[current.season], ''));
  const changed = entries.filter(x => !x.same).map(x => x.change), unchanged = entries.filter(x => x.same).map(x => x.flat);
  const body = [...changed, ...(unchanged.length ? ['같음: ' + unchanged.join(' · ')] : [])].join(' · ');
  const full = body + ' · 자세한 값은 단서 더 보기';
  return full.length > 70 ? body : full;
};
