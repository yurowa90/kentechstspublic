"""품질8 W8: 지역 지도 카드·색·관전과 진행자 광역 지도 검사.

총괄이 샌드박스 밖 로컬에서 서버를 띄운 뒤 실행:
  tests/.venv/bin/python tests/league/fx_region.py http://127.0.0.1:9430/index.html
작성 세션에서는 브라우저·서버·커밋 없이 py_compile만 실행한다.

빈 저장소에서 화면 조작으로 6도시 혼자 하기 1월 계획→1월 운영→2월 계획,
2팀 멀티 진행자 1월 계획/결과를 검사한다. 상태·계획·결과 주입은 없다.
placeCards는 원래 호출의 인자만 복사하고 원래 반환값을 그대로 돌려준다.
카드 판정은 계산 반환값이 아닌 실제 DOM bounding box로 한다. 캔버스 이름
라벨은 공개 배치 함수에 전달된 측정 상자를 이용하고, 공개 자료가 없으면
그 항목만 SKIP한다. 정전 기호 좌표는 현재 renderBoard의 비공개 지역 변수다.
지형 중심/카드 중심을 기호 좌표로 추정하지 않고 '구현에 좌표 공개 필요'로
SKIP한다. SKIP은 PASS/checks에 넣지 않으며 마지막 집계 직전에 별도 보고한다.

색 비교는 각 도시의 같은 평지 칸을 실제 #bd-canvas와 광역 캔버스에서 읽는다.
색 채집 전 화면의 결과·전력망·민원 렌즈를 끈다. 각 칸 3×3 화소,
최대 31칸의 채널별 중앙값으로 글자·밭·나무·전선의 소수
표본 영향을 줄인다. RGB 유클리드 거리 55 이하는 같은 계열로 본다:
build.js drawTile과 league.js renderBoard의 ±3.5% 명도 차는 평지 RGB에서
최대 약 18, 도시 평지 밭의 55% 혼합·그림자에는 추가 약 30의 차이가 있다.
합계에 8bit 반올림/축소 여유를 더한 55이며, 과거 회색 땅과 평지의 거리
약 70 이상을 허용하지 않는다. 두 캔버스를 같은 상수와 비교해 통과시키지 않는다.
바깥 땅은 무소유 평지 여러 칸을 고정 간격으로 읽어 중앙 RGB 채널 폭 >12를
요구한다(회색 R≈G≈B의 8bit/안티앨리어싱 차이를 넘는 채도).

거래는 공개 built 연계선·flow의 순량 |ab-ba|>0.05 MWh가 있을 때만 요구한다.
이는 renderBoard의 표시 생략 문턱이며 0/결측 flow에서 화살표를 요구하지 않는다.
data-flows 수와 실제 연결점 사이의 노란 화소를 함께 확인한다. 화살촉의
정밀 모양·방향 검증은 별도 Node 그리기 검사 범위다. 캡처는 econui와 같은
tests/results/fx-region-*.png. 콘솔 경고·오류·외부 연결도 공통 판정에 포함한다.
"""

import math
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, overflow, screenshot, shown)
from league_flow import confirm_seat, select_mode, start_solo, wait_unfolded
from solo import click_next, close_drawer, read


PUBLIC_JS = """() => {
  const L=KCP.league.state(), V=L.snap ||
    (L.S && KCP.leagueCore.publicView(L.S, Date.now()));
  // state()는 내부 away를 공개하지 않는다. 보이는 관전 바와 현재 지도 pack으로 확인.
  const region=KCP.leagueCore.regionOf(V.region);
  const away=document.querySelector('#lg-peek-back') ?
    region.teams.find(t=>t.pack===KCP.buildGame.saveView()?.map)?.id :
    document.querySelector('#lg-regionmap') ? 'region' : null;
  return {V, player:L.team, away:away ?? null};
}"""

OBSERVE_JS = """() => {
  window.__w8 = {layout:null};
  const fx=KCP.fxRegion;
  if (typeof fx?.placeCards !== 'function') return false;
  const original=fx.placeCards;
  fx.placeCards=function(cards, labels, bounds, ...rest) {
    const result=original.call(this,cards,labels,bounds,...rest);
    __w8.layout=structuredClone({cards,labels,bounds});
    return result;
  };
  return true;
}"""

# 화소는 복사 캔버스에서 읽는다. 앱 캔버스의 반복 getImageData 경고를 만들지 않는다.
PIXELS_JS = """(() => {
  const median=values => {
    const a=[...values].sort((a,b)=>a-b); return a[Math.floor(a.length/2)];
  };
  const image=cv => {
    const copy=document.createElement('canvas'); copy.width=cv.width; copy.height=cv.height;
    const g=copy.getContext('2d',{willReadFrequently:true}); g.drawImage(cv,0,0);
    return g.getImageData(0,0,copy.width,copy.height);
  };
  const patch=(cv, data, x, y) => {
    const sx=cv.width/cv.clientWidth, sy=cv.height/cv.clientHeight;
    x=Math.round(x*sx); y=Math.round(y*sy);
    if(x<1 || y<1 || x>=data.width-1 || y>=data.height-1) return null;
    const colors=[];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      const i=((y+dy)*data.width+x+dx)*4;
      if(data.data[i+3]===255) colors.push(Array.from(data.data.slice(i,i+3)));
    }
    return colors.length ? [0,1,2].map(c=>median(colors.map(p=>p[c]))) : null;
  };
  const representative=colors=>colors.length ?
    [0,1,2].map(c=>median(colors.map(p=>p[c]))) : null;
  const spread=(items,n=31)=>items.length<=n ? items :
    Array.from({length:n},(_,i)=>items[Math.floor(i*(items.length-1)/(n-1))]);
  const xy=(c,r,k)=>[(Math.sqrt(3)*(c+.5*(r&1))+Math.sqrt(3)/2)*k,(1.5*r+1)*k];
  return {median,image,patch,representative,spread,xy};
})()"""

CITY_COLOR_JS = """() => {
  const P=""" + PIXELS_JS + """, BG=KCP.buildGame, cv=document.querySelector('#bd-canvas');
  const view=BG.saveView(), pack=KCP.BUILD_MAPS[view.map];
  if (!cv) return {rgb:null,samples:[],win:pack.win || [0,0],map:view.map,
    diagnostics:{canvas:null,k:null,candidates:0,inCanvas:0,visibleCandidates:0}};
  const box=cv.getBoundingClientRect(), current=BG.current();
  const occupied=new Set([...(current.builds || []).map(b=>b.i),
    ...(current.lines || []).flatMap(l=>l.p || [])]);
  const candidates=BG.TILES.filter(t=>!t.out && t.t==='plain' && t.site<0 && !occupied.has(t.i))
    .map(t=>{const [x,y]=BG.tileXY(t.c,t.r); return {c:t.c,r:t.r,x,y};});
  const inCanvas=candidates.filter(t=>t.x>3 && t.y>3 &&
    t.x<cv.clientWidth-3 && t.y<cv.clientHeight-3);
  const tiles=inCanvas.filter(t=>document.elementFromPoint(box.left+t.x,box.top+t.y)===cv);
  const data=cv.width>0 && cv.height>0 ? P.image(cv) : null;
  const samples=data ? P.spread(tiles).map(t=>({...t,rgb:P.patch(cv,data,t.x,t.y)}))
    .filter(t=>t.rgb) : [];
  return {rgb:P.representative(samples.map(t=>t.rgb)), samples,
    win:pack.win || [0,0], map:view.map,
    // 도시 지도는 tileXY()를 사용한다. dataset.k 누락만으로 표본을 배제하지 않는다.
    diagnostics:{canvas:{width:cv.width,height:cv.height,clientWidth:cv.clientWidth,
      clientHeight:cv.clientHeight,x:box.x,y:box.y,widthCSS:box.width,heightCSS:box.height,
      visible:cv.checkVisibility({visibilityProperty:true})},k:cv.dataset.k ?? null,
      viewport:{width:innerWidth,height:innerHeight},candidates:candidates.length,
      inCanvas:inCanvas.length,visibleCandidates:tiles.length,
      cover:[...new Set(inCanvas.slice(0,40).map(t=>{const e=document.elementFromPoint(box.left+t.x,box.top+t.y);
        return e ? `${e.tagName}#${e.id}.${String(e.className).slice(0,60)}` : null;}))].slice(0,5)}};
}"""

REGION_COLOR_JS = """reference => {
  const P=""" + PIXELS_JS + """, cv=document.querySelector('#lg-regionmap');
  const data=P.image(cv), k=+cv.dataset.k;
  const samples=reference.samples.map(t=>{
    const [x,y]=P.xy(t.c+reference.win[0],t.r+reference.win[1],k);
    return P.patch(cv,data,x,y);
  }).filter(Boolean);
  return {rgb:P.representative(samples), n:samples.length};
}"""

OUTSIDE_JS = """selector => {
  const P=""" + PIXELS_JS + """, L=KCP.league.state(), V=L.snap || L.S;
  const B=KCP.leagueCore.regionOf(V.region).board, cv=document.querySelector(selector);
  const data=P.image(cv), cells=[];
  // 무소유 칸만: 비참가 도시 경계선/이름표를 바깥 지형으로 오인하지 않는다.
  B.rows.forEach((row,r)=>[...row].forEach((ch,c)=>{
    if((ch==='p' || ch==='.') && !B.letters[B.own[r][c]]) cells.push([c,r]);
  }));
  const samples=P.spread(cells).map(([c,r])=>{
    const [x,y]=P.xy(c,r,+cv.dataset.k); return P.patch(cv,data,x,y);
  }).filter(Boolean);
  return {rgb:P.representative(samples), n:samples.length};
}"""

GEOMETRY_JS = """() => {
  const cv=document.querySelector('#lg-regionmap'), map=cv.getBoundingClientRect();
  const rect=el=>{const b=el.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height};};
  const cards=[...document.querySelectorAll('.lg-regionlabel')].map(el=>({
    ...rect(el),visible:el.checkVisibility({visibilityProperty:true})}));
  const layout=window.__w8?.layout;
  // 현재 구현의 도시명은 Canvas 글자. 공개 placeCards에 전달되는 라벨 상자는
  // CSS px이며 페이지 좌표로 변환한다. 오래된/다른 크기의 관측값은 사용하지 않는다.
  const valid=layout && Math.abs(layout.bounds.width-cv.clientWidth)<1 &&
    Math.abs(layout.bounds.height-cv.clientHeight)<1;
  const labels=valid ? layout.labels.map(b=>({x:map.x+b.x*map.width/cv.clientWidth,
    y:map.y+b.y*map.height/cv.clientHeight,width:b.width*map.width/cv.clientWidth,
    height:b.height*map.height/cv.clientHeight,kind:b.kind,soft:b.soft,id:b.id})) : null;
  return {map:rect(cv),cards,labels};
}"""

CLICK_CITY_JS = """city => {
  const L=KCP.league.state(), V=L.snap, B=KCP.leagueCore.regionOf(V.region).board;
  const cv=document.querySelector('#lg-regionmap'), box=cv.getBoundingClientRect();
  const points=[];
  B.own.forEach((row,r)=>[...row].forEach((ch,c)=>{
    if(B.letters[ch]!==city) return;
    const x=(Math.sqrt(3)*(c+.5*(r&1))+Math.sqrt(3)/2)*+cv.dataset.k+box.left;
    const y=(1.5*r+1)*+cv.dataset.k+box.top;
    if(x>0 && y>0 && x<innerWidth && y<innerHeight && document.elementFromPoint(x,y)===cv)
      points.push({x,y});
  }));
  return points[Math.floor(points.length/2)] || null;
}"""

FLOW_JS = """() => {
  const P=""" + PIXELS_JS + """, L=KCP.league.state();
  const V=KCP.leagueCore.publicView(L.S,Date.now()), res=V.results.at(-1);
  const cv=document.querySelector('#lg-mapc'), data=P.image(cv), reg=KCP.leagueCore.regionOf(V.region);
  const gate=(id,other)=>{
    const t=reg.teams.find(t=>t.id===id), pack=KCP.BUILD_MAPS[t.pack];
    const g=(pack.gates || []).find(g=>g.to.includes(other));
    return g ? P.xy(g.c+(pack.win?.[0] || 0),g.r+(pack.win?.[1] || 0),+cv.dataset.k) : null;
  };
  const expected=(V.ties || []).filter(t=>t.st==='built').flatMap(t=>{
    const f=res?.flow?.[KCP.leagueCore.tieId(t)];
    if(!f || !Number.isFinite(f.ab) || !Number.isFinite(f.ba) || Math.abs(f.ab-f.ba)<=.05) return [];
    const A=gate(t.a,t.b), B=gate(t.b,t.a);
    if(!A || !B) return [{a:t.a,b:t.b,pixels:null}];
    const sx=cv.width/cv.clientWidth, sy=cv.height/cv.clientHeight;
    const dx=B[0]-A[0], dy=B[1]-A[1], len=Math.hypot(dx,dy);
    let pixels=0;
    // 내부 20~80% 구간, 연결선 주위 3 지도 단위. 도시 경계·발전소는 제외.
    for(let y=Math.max(0,Math.floor((Math.min(A[1],B[1])-3*+cv.dataset.k)*sy));
      y<Math.min(data.height,Math.ceil((Math.max(A[1],B[1])+3*+cv.dataset.k)*sy));y++)
      for(let x=Math.max(0,Math.floor((Math.min(A[0],B[0])-3*+cv.dataset.k)*sx));
        x<Math.min(data.width,Math.ceil((Math.max(A[0],B[0])+3*+cv.dataset.k)*sx));x++) {
        const px=x/sx-A[0], py=y/sy-A[1], at=(px*dx+py*dy)/(len*len);
        if(at<.2 || at>.8 || Math.abs(px*dy-py*dx)/len>3*+cv.dataset.k) continue;
        const i=(y*data.width+x)*4, r=data.data[i], g=data.data[i+1], b=data.data[i+2];
        if(r>210 && g>150 && b<110 && r>b*1.8 && data.data[i+3]===255) pixels++;
      }
    return [{a:t.a,b:t.b,net:f.ab-f.ba,pixels}];
  });
  return {built:(V.ties || []).filter(t=>t.st==='built').length,
    hasFlow:!!res?.flow, expected, drawn:Number(cv.dataset.flows)};
}"""


class RegionChecks(Checks):
    def __init__(self):
        super().__init__()
        self.skipped = []

    def skip(self, label):
        self.skipped.append(label)
        print('SKIP ' + label, flush=True)

    def finish(self):
        print(f'skips {len(self.skipped)} (PASS 집계 제외)', flush=True)
        return super().finish()


def frames(page):
    page.evaluate('() => document.fonts.ready.then(() => new Promise(resolve => '
                  'requestAnimationFrame(() => requestAnimationFrame(resolve))))')


def dismiss(page):
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()
    close_drawer(page)


def open_region(page):
    wait_unfolded(page)
    dismiss(page)
    page.locator('.lg-bar [data-panel="region"]').click()
    page.wait_for_selector('#lg-regionmap')
    page.wait_for_function("() => +document.querySelector('#lg-regionmap')?.dataset.k > 0")
    frames(page)


def city_color(page):
    # 결과 렌즈의 정전 틴트를 지형색 변화로 세지 않는다. 관전에서도 렌즈 조작은 공개 UI다.
    for _ in range(3):
        pressed = page.locator('[data-lens][aria-pressed="true"]:visible')
        if not pressed.count():
            break
        pressed.first.click()
    # 달 시작 예보 카드(W4)는 Esc로 닫히는 덧층이다. 지형색 표본은 카드가 닫힌 지도에서 읽는다.
    if page.locator('.fx-turn-layer .fx-turn-card:visible').count():
        page.keyboard.press('Escape')
        page.wait_for_function("() => !document.querySelector('.fx-turn-layer .fx-turn-card')?.checkVisibility()", timeout=3000)
    page.mouse.move(0, 0)
    frames(page)
    return page.evaluate(CITY_COLOR_JS)


def intersect(a, b):
    # 양의 교차 면적만 충돌. DOM 반올림을 명목으로 겹침을 허용하지 않는다.
    return (a['x'] < b['x'] + b['width'] and a['x'] + a['width'] > b['x'] and
            a['y'] < b['y'] + b['height'] and a['y'] + a['height'] > b['y'])


def geometry(checks, page, label):
    data = page.evaluate(GEOMETRY_JS)
    cards, bounds = data['cards'], data['map']
    checks.ok(len(cards) == 6 and all(c['visible'] and c['width'] > 0 and c['height'] > 0
                                    for c in cards), label + ' 상태 카드 6개 실제 표시')
    pairs = [(i, j) for i, a in enumerate(cards) for j, b in enumerate(cards)
             if i < j and intersect(a, b)]
    checks.ok(not pairs, f'{label} 카드끼리 겹침 0: {pairs}')
    # CSS↔Canvas 크기 변환의 부동소수점 오차만 0.01px 허용한다.
    outside = [i for i, c in enumerate(cards) if c['x'] < bounds['x'] - .01 or
               c['y'] < bounds['y'] - .01 or
               c['x'] + c['width'] > bounds['x'] + bounds['width'] + .01 or
               c['y'] + c['height'] > bounds['y'] + bounds['height'] + .01]
    checks.ok(not outside, f'{label} 카드 지도 안: 지도={bounds}, 밖={outside}')
    if data['labels'] is None:
        checks.skip(label + ' 도시 이름·hard/soft 상자 충돌: 공개 배치 계산 결과 필요')
    else:
        # W8 브리프 할 일 2·검사 6: 6개 및 이름 충돌 0은 kind=city에 적용한다.
        # placeCards의 전체 입력에는 수역 이름·화살표·기호도 포함된다.
        cities = [b for b in data['labels'] if b.get('kind') == 'city']
        checks.ok(len(cities) == 6, label + ' 공개 도시 이름 라벨 측정 상자 6개')
        collisions = [(i, j) for i, c in enumerate(cards)
                      for j, b in enumerate(cities) if intersect(c, b)]
        checks.ok(not collisions, f'{label} 카드·도시 이름 겹침 0: {collisions}')
        # W8 할 일 3·검사 6 및 placeCards 계약: 비도시 hard 상자도 가리지 않는다.
        hard = [b for b in data['labels'] if b.get('kind') != 'city' and not b.get('soft')]
        collisions = [(i, j, b.get('kind'), b.get('id')) for i, c in enumerate(cards)
                      for j, b in enumerate(hard) if intersect(c, b)]
        checks.ok(not collisions, f'{label} 카드·비도시 hard 상자 겹침 0: {collisions}')
        # W8 할 일 2의 도시 이름 충돌 금지와 구분: soft(water)는 비용만 부과한다.
        soft = [b for b in data['labels'] if b.get('soft')]
        overlaps = sum(intersect(c, b) for c in cards for b in soft)
        print(f'INFO {label} 카드·soft(water) 상자 겹침 {overlaps}개', flush=True)
    overflow(checks, page, label)


def outside_color(checks, page, selector, label):
    sample = page.evaluate(OUTSIDE_JS, selector)
    rgb = sample['rgb']
    checks.ok(sample['n'] >= 5 and rgb is not None and max(rgb) - min(rgb) > 12,
              f'{label} 바깥 땅 회색 아님: {sample}')


def compare_color(checks, page, reference, label):
    actual = page.evaluate(REGION_COLOR_JS, reference)
    distance = (math.dist(reference['rgb'], actual['rgb'])
                if reference['rgb'] is not None and actual['rgb'] is not None else math.inf)
    detail = (f", 도시 표본 0개 진단={reference.get('diagnostics')}"
              if not reference['samples'] else '')
    checks.ok(len(reference['samples']) >= 5 and actual['n'] >= 5 and distance <= 55,
              f"{label} 평지 RGB 거리 ≤55: 도시={reference['rgb']}, "
              f"광역={actual['rgb']}, 거리={distance:.1f}, n={actual['n']}{detail}")


def returned(checks, page, player, label):
    page.locator('#lg-peek-back').click()
    page.wait_for_selector('.lg-bar [data-panel="region"]')
    frames(page)
    state = page.evaluate(PUBLIC_JS)
    checks.ok(state['player'] == player and not state['away'] and shown(page, '#bd-canvas') and
              page.locator('#lg-ready').is_enabled(), label + ' 우리 도시로 복귀·편집 가능')


def check_outage(checks, page, label):
    result = page.evaluate(PUBLIC_JS)['V']['results'][-1]
    values = {city: row.get('unsPct') for city, row in result['team'].items()}
    checks.ok(len(values) == 6 and all(isinstance(v, (int, float)) and math.isfinite(v)
                                     for v in values.values()),
              f'{label} 1월 공개 정전 결과 6개: {values}')
    # 코드 확인: league.js renderBoard의 iconX/iconY/iconSize는 공개되지 않는다.
    # placeCards 라벨 상자는 이름·결과·기호를 합친 영역이며 기호 위치가 아니다.
    # 팀 색 경계선도 빨갈 수 있어 도시 중심 주변 빨간 화소를 기호로 간주하지 않는다.
    # W8b: KCP.fxRegion.lastLayout()이 마지막으로 그린 기호 상자(화면 좌표)와 도시 id를 읽기 전용으로 공개한다.
    # 명세 W8b 3: 정전 기호는 화면 표시(소수 1자리)로 0이 아닌 값, 즉 0.05% 이상일 때만.
    layout = page.evaluate("() => KCP.fxRegion?.lastLayout?.() || null")
    if not layout:
        checks.ok(False, label + ' 정전 기호 배치 공개 자료(lastLayout) 존재')
        return
    outage = {i['id'] for i in layout['icons'] if i.get('kind') == 'outage'}
    expect = {city for city, v in values.items() if isinstance(v, (int, float)) and v >= 0.05}
    checks.ok(outage == expect, f'{label} 정전 기호 도시 = 공개 정전 0.05% 이상 도시: 기호 {sorted(outage)}, 기대 {sorted(expect)}')
    # 기호 상자 화소에 빨간 계열이 실제로 그려졌는지(캔버스 복사본에서 읽기 — getImageData 경고 방지).
    reds = page.evaluate("""(ids) => {
      const L=KCP.fxRegion.lastLayout(), out={};
      // W8 할 일 3: lastLayout의 기호가 그려진 팀 광역/진행자 지도를 읽는다.
      const canvases=['#lg-regionmap','#lg-mapc'].map(s=>document.querySelector(s)).filter(Boolean);
      const cv=canvases.find(c=>c.checkVisibility({visibilityProperty:true})) || canvases[0];
      if (!cv) return null;
      const r=cv.getBoundingClientRect(), sx=cv.width/r.width, sy=cv.height/r.height;
      if (!r.width || !r.height) return null;
      for (const icon of L.icons.filter(i=>i.kind==='outage' && ids.includes(i.id))) {
        const w=Math.max(1,Math.round(icon.width*sx)), h=Math.max(1,Math.round(icon.height*sy));
        const c=document.createElement('canvas'); c.width=w; c.height=h;
        const g=c.getContext('2d',{willReadFrequently:true});
        g.drawImage(cv, Math.round((icon.x-r.left)*sx), Math.round((icon.y-r.top)*sy), w, h, 0, 0, w, h);
        const d=g.getImageData(0,0,w,h).data; let n=0;
        for (let k=0;k<d.length;k+=4) if (d[k]>170 && d[k+1]<130 && d[k+2]<150) n++;
        out[icon.id]=n;
      }
      return out;
    }""", sorted(outage))
    checks.ok(reds is not None and all(n > 0 for n in reds.values()),
              f'{label} 정전 기호 상자 안 빨간 화소 존재: {reds}')


def solo_stage(checks, page, width, month):
    label = f'{width}-{month:02d}월'
    dismiss(page)
    frames(page)
    state = page.evaluate(PUBLIC_JS)
    player, ids = state['player'], state['V']['active']
    checks.ok(len(ids) == 6 and state['V']['round'] == month and state['V']['phase'] == 'plan' and
              len(state['V']['results']) == month - 1, label + ' 6도시·계획·운영 횟수')
    own = city_color(page)
    open_region(page)
    geometry(checks, page, label)
    outside_color(checks, page, '#lg-regionmap', label)
    compare_color(checks, page, own, label + '-' + player)
    if month == 2:
        check_outage(checks, page, label)
    screenshot(checks, page, f'fx-region-solo-{label}.png')
    # 다른 5개 도시는 도시 버튼→관전→지역 지도로. 각 도시의 실제 도시 Canvas와 비교.
    for city in (city for city in ids if city != player):
        page.locator(f'[data-region-city="{city}"]').click()
        page.wait_for_selector('#lg-peek-back')
        frames(page)
        viewing = page.evaluate(PUBLIC_JS)
        checks.ok(viewing['away'] == city and shown(page, '#bd-canvas') and
                  page.locator('#lg-ready').is_disabled(), label + f' 도시 버튼→{city} 관전')
        reference = city_color(page)
        page.locator('#lg-peek-region').click()
        page.wait_for_selector('#lg-regionmap')
        frames(page)
        compare_color(checks, page, reference, label + '-' + city)
    # 목록과 별개로 실제 광역 칸을 마우스로 눌러 boardHit 경로를 통과한다.
    other = next(city for city in ids if city != player)
    point = page.evaluate(CLICK_CITY_JS, other)
    checks.ok(point is not None, label + ' 클릭 가능한 다른 도시 지도 칸')
    if point is not None:
        page.mouse.click(point['x'], point['y'])
        page.wait_for_selector('#lg-peek-back')
        viewing = page.evaluate(PUBLIC_JS)
        checks.ok(viewing['away'] == other and page.locator('#lg-ready').is_disabled(),
                  label + ' 지도 클릭→해당 도시 읽기 전용 관전')
        returned(checks, page, player, label)
    else:
        page.locator('#lg-region-back').click()
    # 지역 지도 자체의 '우리 도시로'도 따로 확인한다.
    open_region(page)
    page.locator('#lg-region-back').click()
    page.wait_for_selector('.lg-bar [data-panel="region"]')
    checks.ok(not page.evaluate(PUBLIC_JS)['away'] and page.locator('#lg-ready').is_enabled(),
              label + ' 지역 지도→우리 도시로')


def solo_case(checks, page, base, width):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    page.evaluate(OBSERVE_JS)
    # start_solo의 HUD 흐름을 재사용하되 참가 도시는 화면에서 명시적으로 모두 고른다.
    select_mode(page, 'solo')
    for box in page.locator('[data-solo-city]').all():
        if not box.is_checked() and box.is_enabled():
            box.check()
    start_solo(page)
    solo_stage(checks, page, width, 1)
    for _ in range(4):
        state = read(page)['S']
        if state['round'] == 2 and state['phase'] == 'plan':
            break
        if state['phase'] == 'review':
            wait_unfolded(page)
        click_next(page, state)
    page.wait_for_function("() => {const V=KCP.league.state()?.snap; return V?.round===2 && V.phase==='plan';}")
    solo_stage(checks, page, width, 2)


def host_geometry(checks, page, label):
    details = page.locator('#lg-host-details')
    if not details.evaluate('el => el.open'):
        details.locator(':scope > summary').click()
    # 접힌 본문을 0크기 카드로 검사하지 않는다. 두 카드 모두 실제로 펼친다.
    for card in page.locator('#lg-teams [data-host-card]').all():
        if not card.evaluate('el => el.open'):
            card.locator(':scope > summary').click()
    page.wait_for_selector('#lg-mapc')
    frames(page)
    data = page.evaluate("""() => {
      const rect=el=>{const b=el.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height};};
      return {map:rect(document.querySelector('#lg-mapc')),
        cards:[...document.querySelectorAll('#lg-teams .lg-tcard')].map(rect)};
    }""")
    cards = data['cards']
    checks.ok(len(cards) == 2 and data['map']['width'] > 0 and data['map']['height'] > 0 and
              all(c['width'] > 0 and c['height'] > 0 for c in cards), label + ' 지도·2팀 카드 표시')
    checks.ok(all(not intersect(data['map'], c) for c in cards) and
              all(not intersect(a, b) for i, a in enumerate(cards) for b in cards[i + 1:]),
              label + ' 광역 지도·카드/카드끼리 겹침 0')
    outside_color(checks, page, '#lg-mapc', label)
    overflow(checks, page, label)
    flow = page.evaluate(FLOW_JS)
    if not flow['expected']:
        checks.skip(f'{label} 거래 화살표: 표시할 공개 순거래 없음 '
                    f"(built={flow['built']}, flow공개={flow['hasFlow']})")
    else:
        checks.ok(flow['drawn'] == len(flow['expected']) and
                  all(f['pixels'] is not None and f['pixels'] >= 3 for f in flow['expected']),
                  f'{label} 공개 거래 화살표 수·연결선 노란 화소: {flow}')
    screenshot(checks, page, f'fx-region-host-1280-{label.rsplit("-", 1)[-1]}.png')


def host_case(checks, context, base, pages):
    host, events = monitored_page(context)
    pages.append((host, events, 'host-1280'))
    host.goto(base + '#league')
    host.wait_for_function(BOOT_JS)
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="12"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    for city in ('pyeongtaek', 'dangjin'):
        team, events = monitored_page(context)
        pages.append((team, events, 'host-team-' + city))
        team.goto(base + '#league')
        select_mode(team, 'join')
        team.locator('#lg-code').fill(room)
        team.locator('#lg-join').click()
        confirm_seat(team, city)
        dismiss(team)
    host.wait_for_function("""() => {
      const V=KCP.leagueCore.publicView(KCP.league.state().S,Date.now());
      return ['pyeongtaek','dangjin'].every(id=>V.teams[id]?.seated);
    }""")
    host.locator('#lg-next').click()
    host.wait_for_function("() => KCP.league.state().S.phase==='plan'")
    host_geometry(checks, host, 'host-1280-plan')
    # e2e3의 진행자 흐름과 같이 미준비 팀도 화면의 운영 단추로 진행한다.
    host.locator('#lg-next').click()
    host.wait_for_function("() => KCP.league.state().S.phase==='review'")
    host_geometry(checks, host, 'host-1280-review')


def main():
    checks = RegionChecks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height in ((1280, 900), (390, 844)):
                context, external = context_for(browser, base, width, height, 'light')
                page, events = monitored_page(context)
                try:
                    solo_case(checks, page, base, width)
                except Exception as exc:
                    checks.ok(False, f'solo-{width} 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                    screenshot(checks, page, f'fx-region-solo-{width}-failure.png')
                finally:
                    diagnostics(checks, events, f'solo-{width}')
                    checks.ok(not external, f'solo-{width} 외부 연결 0: {external}')
                    context.close()
            context, external = context_for(browser, base, 1280, 900, 'light')
            pages = []
            try:
                host_case(checks, context, base, pages)
            except Exception as exc:
                checks.ok(False, f'host-1280 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                if pages:
                    screenshot(checks, pages[0][0], 'fx-region-host-1280-failure.png')
            finally:
                for page, events, label in pages:
                    diagnostics(checks, events, label)
                checks.ok(not external, f'host-1280 외부 연결 0: {external}')
                context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
