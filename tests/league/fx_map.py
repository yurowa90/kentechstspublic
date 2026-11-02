"""품질8 W3 / QUALITY-visual.md V2: 지도 조작의 실제 Canvas 픽셀 검사.

실행(총괄의 샌드박스 밖 로컬 환경):
  tests/.venv/bin/python tests/league/fx_map.py http://127.0.0.1:9430/index.html
작성 세션에서는 브라우저·서버·커밋을 실행하지 않고 py_compile만 수행한다.

모호한 명세의 해석:
* 혼자 하기와 #build를 각각 빈 컨텍스트, 1280×900, 일반/움직임 줄이기로
  검사한다. 설비는 자체 상시 움직임이 없는 태양광을 사용한다. 설치 전후
  커서를 지도 밖으로 옮기고 리그의 선택형 렌즈를 화면에서 꺼 비교한다.
* 시각은 지도 pointerup/실행 버튼 click부터의 절대 경과 ms이다. Python의
  연속 대기로 누적하지 않고 페이지 setTimeout으로 채집한다. 실측 오차도
  검사하며 100/150ms 표본이 겹치면 실패한다. 전체 지도 대신 태양광 본체
  영역을 비교하여 비용 글자(1.1초), 바다·기존 풍차·연기를 배제한다.
* '같음'은 모든 비교 픽셀의 RGBA 채널 차이가 2 이하라는 뜻이다. 동일
  Canvas·DPR에서 재래스터화할 때 경계의 8bit 반올림 차이만 허용한다.
  변경 픽셀 비율 허용은 없다. 단, 리그 막대 줄바꿈 전후의 빈 칸 그림은
  비교하지 않는다. 철거 1300ms 뒤 현재 칸에 태양광 패널색이 없어야 한다.
* 연속 조작은 같은 칸 설치→철거 5회 뒤 다른 칸에 최종 1개 설치한다.
  정확한 50ms 예약을 위해 이 구간만 보이는 DOM 도구 click과 Canvas의
  pointerdown/up을 페이지 타이머에서 전달한다(일반 구간은 실제 마우스).
  엔진/계획 주입은 없다. 단계별 계획, 실제 간격(50±35ms), 두 칸의 그림을
  함께 확인하므로 최종 빈 지도만 비교하는 공허한 통과를 막는다.
* rAF는 앱 콜백 자체를 감싸 세며 검사 자체의 rAF 루프는 만들지 않는다.
  2초 안정화 뒤 1초를 전후 동일 계획에서 비교한다. 기존 상시 rAF가
  있으면 공개 mapMotion.needsFrame의 입력을 관찰해 효과 상태 0으로
  대체한다. 원래 함수의 인자·반환·호출 시점과 실제 상태는 변경하지 않는다.
  공개 관측 훅이 없으면 그 항목을 실패 처리한다(임의 skip 없음).
* 시험은 야간에도 공급 가능한 디젤과 수요지를 화면으로 연결한다. 건물과
  수요지가 없는 중간 선분의 밝은 화소 집합 변화와 공개 관측한 선분 위상을
  함께 기록한다. 작은 축척에서 밝은 화소가 잡히지 않으면 위상 변화로 판정한다.
  reduce는 첫 진행 tick 다음 tick(150ms) 전인 50/100ms에 선 영역 전체와
  위상이 같은지 확인한다(고정 입자도 허용). 양쪽 표본 모두 실제 운전 중이어야 한다.
  이 검사는 V2의 입자 유무·움직임 검사이며 물리적 흐름량 검산은 아니다.
* 캡처는 econui 형식으로 tests/results/fx-map-*.png에 저장하며 시간별
  픽셀 표본도 PNG로 남긴다. 실패·콘솔 경고를 숨기거나 재시도하지 않는다.
"""

import base64
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, RESULTS, Checks, context_for, diagnostics,
                    local_address, monitored_page, overflow, screenshot, shown)
from league_flow import start_solo


RAF_JS = r"""(() => {
  const request = window.requestAnimationFrame;
  window.__w3raf = 0;
  window.requestAnimationFrame = function(callback) {
    return request.call(window, function(t) {
      window.__w3raf++;
      return callback.call(this, t);
    });
  };
})();"""

# 공개 좌표·경로 조회만 사용하며 테스트에서 계획이나 Canvas 그림을 주입하지 않는다.
PROBE_JS = r"""() => {
  const BG = KCP.buildGame, cv = document.querySelector('#bd-canvas');
  const P = window.__w3 = {shots:{}, series:{}, fx:null, maxFx:0, marks:[], state:null};
  const motion = BG.mapMotion;
  if (typeof motion?.needsFrame === 'function') {
    const original = motion.needsFrame;
    motion.needsFrame = function(state, ...args) {
      P.state = state; // 공개 훅의 입력을 읽기만 한다. shot 시점에 위상을 값으로 복사한다.
      P.fx = {count:state.mapFx.length, floaters:state.floaters.length,
        hubs:state.rec.hubs.length, stacks:state.rec.stacks.length,
        at:performance.now()};
      P.maxFx = Math.max(P.maxFx, P.fx.count);
      return original.call(this, state, ...args);
    };
  }
  if (typeof motion?.flowMarks === 'function') {
    const original = motion.flowMarks;
    motion.flowMarks = function(...args) {
      const result = original.apply(this, args);
      P.marks = result.map(m => ({from:m.from, to:m.to, count:m.count}));
      return result;
    };
  }
  P.xy = i => {const t = BG.TILES[i]; return BG.tileXY(t.c, t.r);};
  P.clientXY = i => {const [x,y]=P.xy(i), box=cv.getBoundingClientRect();
    return [x+box.left,y+box.top];};
  const row = BG.TILES.filter(t => t.r === 0);
  // 막대 줄바꿈은 fitView의 위치뿐 아니라 축척도 바꿀 수 있다. 매번 현재 좌표로 구한다.
  Object.defineProperty(P,'scale',{get:() => {
    const a=P.xy(row[0].i), b=P.xy(row[1].i);
    return Math.abs(b[0]-a[0]) > Math.abs(b[1]-a[1]) ?
      Math.abs(b[0]-a[0])/Math.sqrt(3) : Math.abs(b[1]-a[1])/(Math.sqrt(3)*.62);
  }});
  P.rect = i => {const [x,y] = P.xy(i), s=P.scale;
    return {x:x-s*.48, y:y-s*.34, w:s*1.06, h:s*.66};};
  P.edgeRect = ([a,b]) => {
    const s=P.scale, A=P.xy(a), B=P.xy(b);
    A[1]-=s*.55; B[1]-=s*.55;
    const at=t=>[A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t+2*t*(1-t)*s*.08];
    const pts=[0,.5,1].map(at), xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    const pad=Math.max(3,s*.35);
    return {x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,
      w:Math.max(...xs)-Math.min(...xs)+2*pad,h:Math.max(...ys)-Math.min(...ys)+2*pad};
  };
  P.shot = (name, target, origin=performance.now()) => {
    // W3: 고정 rect는 배치 변경 뒤 다른 칸을 읽는다. 표본 시각에 같은 칸/선분을 다시 찾는다.
    const rect=Array.isArray(target) ? P.edgeRect(target) : P.rect(target);
    const box=cv.getBoundingClientRect(), sx=cv.width/box.width, sy=cv.height/box.height;
    const x=Math.floor(rect.x*sx), y=Math.floor(rect.y*sy);
    const w=Math.ceil(rect.w*sx), h=Math.ceil(rect.h*sy);
    if (x<0 || y<0 || x+w>cv.width || y+h>cv.height) throw Error('표본이 Canvas 밖');
    // 게임 Canvas에서 직접 여러 번 getImageData를 하면 Chrome이 willReadFrequently 경고를
    // 콘솔에 남겨 '콘솔 warning 0' 판정을 검사 스스로 깨뜨린다. 표본 영역을 복사본에 그린 뒤 읽는다.
    const copy=document.createElement('canvas'); copy.width=w; copy.height=h;
    const cg=copy.getContext('2d', {willReadFrequently:true});
    cg.drawImage(cv, x, y, w, h, 0, 0, w, h);
    const data=cg.getImageData(0,0,w,h);
    const view=P.state?.flowView;
    const mark=view?.marks?.find(m => P.flowEdge &&
      ((m.from===P.flowEdge[0] && m.to===P.flowEdge[1]) ||
       (m.from===P.flowEdge[1] && m.to===P.flowEdge[0])));
    const flow=mark ? {e:mark.e, phase:view.phase[mark.e], count:mark.count,
      observedAt:P.fx?.at} : null;
    // needsFrame에서 관측한 실제 상태를 시각별 값으로 복사한다. 이후 효과 종료에 영향받지 않는다.
    const mapFx=P.state ? P.state.mapFx.map(f=>({kind:f.kind,i:f.i})) : null;
    const shot={pixels:Array.from(data.data), w,h, ms:performance.now()-origin,
      rect, mapTop:box.top, mapFx,
      running:!!document.querySelector('#bd-run:not([hidden])'), flow, png:copy.toDataURL()};
    P.shots[name]=shot;
    return shot;
  };
  P.panel = name => {
    const p=P.shots[name].pixels; let n=0;
    for(let i=0;i<p.length;i+=4) if(p[i]<75 && p[i+1]>45 && p[i+1]<115 &&
      p[i+2]>105 && p[i+2]>p[i+1]*1.3 && p[i+3]===255) n++;
    return n;
  };
  P.arm = (key, target, times, selector, event) => {
    P.series[key]={done:false, error:null, times};
    document.querySelector(selector).addEventListener(event, () => {
      const t0=performance.now();
      for (const ms of times) setTimeout(() => {
        try {P.shot(`${key}-${ms}`,target,t0);}
        catch (e) {P.series[key].error=String(e);}
        if (ms===times.at(-1)) P.series[key].done=true;
      },ms);
    }, {once:true});
  };
  P.diff = (a,b,mask=false) => {
    const A=P.shots[a], B=P.shots[b];
    if (!A || !B || A.w!==B.w || A.h!==B.h) throw Error('표본 크기 불일치');
    let changed=0, max=0, litA=0, litB=0;
    // 입자 판정(명세 w3-map-motion.md 4: '작은 밝은 점'): 세 채널 모두 235 이상인 불투명 화소.
    // 특정 RGB 하나에 묶으면 구현의 색 선택을 베끼게 된다(검사 작성 규칙). 창문 노랑(파랑 채널 낮음)·
    // 청록 빛띠(빨강 채널 낮음)·반투명 구름 회색은 이 문턱을 넘지 않는다. 표본은 전선 영역으로 한정한다.
    const lit=(p,k) => p[k]>=235 && p[k+1]>=235 && p[k+2]>=235 && p[k+3]===255;
    for(let k=0;k<A.pixels.length;k+=4) {
      if(mask) {
        const x=lit(A.pixels,k), y=lit(B.pixels,k);
        litA+=x; litB+=y; changed+=(x!==y);
      } else {
        let d=0; for(let j=0;j<4;j++) d=Math.max(d,Math.abs(A.pixels[k+j]-B.pixels[k+j]));
        changed+=(d>2); max=Math.max(max,d);
      }
    }
    return {changed,max,litA,litB,total:A.w*A.h};
  };
  return {scale:P.scale, hook:typeof motion?.needsFrame==='function'};
}"""

CANDIDATES_JS = r"""() => {
  const BG=KCP.buildGame, P=__w3, st=BG.current(), s=P.scale;
  const occupied=new Set(st.builds.map(b=>b.i));
  const sites=BG.SITES.map(w=>P.clientXY(w.tile));
  const safe=BG.TILES.filter(t => t.site<0 && !t.out && !occupied.has(t.i) &&
    !BG.siteRule('solar',t) && ['plain','beach','hill'].includes(t.t)).filter(t => {
      const [x,y]=P.clientXY(t.i), el=document.elementFromPoint(x,y);
      return el?.id==='bd-canvas' && x>s*2 && x<innerWidth-s*2 &&
        y>document.querySelector('#bd-mapbar').getBoundingClientRect().bottom+s*2 &&
        y<document.querySelector('#bd-dock').getBoundingClientRect().top-s*2 &&
        sites.every(([a,b])=>Math.hypot(x-a,y-b)>s*2.5) &&
        st.builds.every(b=>{const [a,c]=P.clientXY(b.i);return Math.hypot(x-a,y-c)>s*3;});
    });
  if(safe.length<2) throw Error('가려지지 않은 독립 태양광 칸 2개 필요');
  const first=safe[0], [x,y]=P.xy(first.i);
  const second=safe.find(t=>{const [a,b]=P.xy(t.i);return Math.hypot(a-x,b-y)>s*4;});
  if(!second) throw Error('비교 영역이 겹치지 않는 두 번째 칸 없음');
  return [first.i,second.i];
}"""

RAPID_JS = r"""([a,b]) => new Promise((resolve,reject) => {
  const BG=KCP.buildGame, P=__w3, cv=document.querySelector('#bd-canvas');
  const actions=Array.from({length:10},(_,k)=>({tool:k%2?'remove':'solar',i:a}));
  actions.push({tool:'solar',i:b});
  const trace=[], start=performance.now();
  const step=k => {
    try {
      const {tool,i}=actions[k];
      // W3 §2·§5: 철거도 설치와 같은 화면 조작을 따른다. 닫힌 하위 메뉴의
      // 같은 data-tool 대신 현재 보이는 도구만 선택하고 실제 선택 상태를 확인한다.
      const visibleTool=()=>[...document.querySelectorAll(`#bd-dock [data-tool="${tool}"]`)]
        .find(el=>el.getClientRects().length && getComputedStyle(el).visibility==='visible');
      let button=visibleTool();
      if(!button) {
        const group=BG.PK.groups?.find(g=>g.tools.includes(tool));
        const control=document.querySelector(`#bd-dock [data-group="${group?.id}"]`);
        if(!control || !control.getClientRects().length) throw Error('보이는 도구 묶음 없음');
        control.click(); button=visibleTool();
      }
      if(!button || button.disabled || !button.getClientRects().length) throw Error('보이는 도구 없음');
      if(BG.saveView().tool!==tool) button.click();
      // setTool→closePops→renderTools 뒤 숨겨진 subtools에는 이전 aria-pressed가 남는다.
      // 이전 button이나 숨은 메뉴를 검사하지 않고 갱신된 본 막대와 실제 선택을 다시 읽는다.
      const group=BG.PK.groups?.find(g=>g.tools.includes(tool));
      const selected=group?.tools.length>1 ?
        document.querySelector(`#bd-dock [data-group="${group.id}"][data-active="true"]`) :
        visibleTool()?.getAttribute('aria-pressed')==='true';
      if(BG.saveView().tool!==tool || !selected)
        throw Error(`도구 선택 실패: ${tool}`);
      // 도구 선택으로 layout이 예약된다. 다음 프레임의 앱 layout 뒤 새 좌표로 누른다.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          const [x,y]=P.clientXY(i);
          if(document.elementFromPoint(x,y)!==cv) throw Error('지도 클릭이 가려짐');
          const init={bubbles:true,clientX:x,clientY:y,pointerId:41,
            pointerType:'mouse',isPrimary:true,button:0};
          cv.dispatchEvent(new PointerEvent('pointerdown',{...init,buttons:1}));
          cv.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0}));
          cv.dispatchEvent(new PointerEvent('pointerleave',{...init,bubbles:false}));
          trace.push({ms:performance.now()-start,tool,i,
            builds:BG.current().builds.map(b=>({t:b.t,i:b.i}))});
          if(k===actions.length-1) resolve(trace);
          else setTimeout(()=>step(k+1),Math.max(0,start+(k+1)*50-performance.now()));
        } catch(e) {reject(e);}
      }));
    } catch(e) {reject(e);}
  };
  step(0);
})"""

FLOW_SITE_JS = r"""() => {
  const BG=KCP.buildGame, P=__w3, st=BG.current();
  for(const t of BG.TILES) {
    if(t.out || t.site>=0 || BG.siteRule('diesel',t) || st.builds.some(b=>b.i===t.i)) continue;
    const [x,y]=P.clientXY(t.i);
    if(document.elementFromPoint(x,y)?.id!=='bd-canvas') continue;
    // 극소 수요지의 0.03 MW 미만 표시 생략을 피하려고 기본 수요 큰 곳부터 찾는다.
    const towns=[...BG.TOWNS].sort((a,b)=>(b.dem?.base||0)-(a.dem?.base||0));
    for(const town of towns) {
      const end=P.clientXY(town.tile);
      if(document.elementFromPoint(...end)?.id!=='bd-canvas') continue;
      const p=BG.routePath(t.i,town.tile);
      if(!p || p.length<4 || p.length>8) continue;
      const edge=p.slice(1,-2).find((i,k) => {
        const j=p[k+2];
        return BG.TILES[i].site<0 && BG.TILES[j].site<0 &&
          !st.builds.some(b=>b.i===i||b.i===j);
      });
      if(edge!==undefined) return {i:t.i,end:town.tile,path:p,edge:[edge,p[p.indexOf(edge)+1]]};
    }
  }
  throw Error('디젤→수요지 사이 독립 전선 구간이 없음');
}"""


def plan(page):
    return page.evaluate("() => KCP.buildGame.current().builds.map(b=>({t:b.t,i:b.i}))")


def tool(page, name):
    if page.evaluate("name => KCP.buildGame.saveView().tool === name", name):
        return
    button = page.locator(f'#bd-dock [data-tool="{name}"]:visible')
    if not button.count():
        group = page.evaluate("name => KCP.buildGame.PK.groups?.find(g=>g.tools.includes(name))?.id", name)
        page.locator(f'#bd-dock [data-group="{group}"]').click()
    page.locator(f'#bd-dock [data-tool="{name}"]:visible').click()
    page.wait_for_function("name => KCP.buildGame.saveView().tool === name", arg=name)
    # W3 §2: 리그 도구 선택은 패널을 닫고 지도 layout을 예약한다. 갱신 뒤 좌표로 클릭한다.
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def click_tile(page, i):
    # 도구·막대 갱신에 예약된 layout 뒤, 클릭 직전에 현재 칸의 화면 좌표를 구한다.
    x, y = page.evaluate("""i => new Promise(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve(__w3.clientXY(i)))))""", i)
    page.mouse.click(x, y)
    page.mouse.move(0, 0)


def prepare_remove(checks, page, i, label):
    # W3 §2: removeAt은 확인창 없이 즉시 철거한다. 리그 회수율은 반환액만 바꾼다.
    # 따라서 화면의 철거 선택 → 대상 태양광의 +회수액 안내 → 지도 클릭 순서를 따른다.
    tool(page, 'remove')
    x, y = page.evaluate("i => __w3.clientXY(i)", i)
    page.mouse.move(x, y)
    verdict = page.locator('#bd-tip:not([hidden]) .ok')
    verdict.wait_for(state='visible')
    text = verdict.inner_text()
    checks.ok('태양광' in text and '+' in text and '억' in text,
              f'{label} 철거 도구의 대상·회수 안내 확인: {text}')


def take(page, name, target):
    page.evaluate("([name,target]) => {__w3.shot(name,target);}", [name, target])


def compare(checks, page, a, b, same, label, mask=False):
    result = page.evaluate("([a,b,mask]) => __w3.diff(a,b,mask)", [a, b, mask])
    ok = result['changed'] == 0 if same else result['changed'] >= 5
    if mask and not same:
        ok = ok and result['litA'] > 0 and result['litB'] > 0
    checks.ok(ok, f"{label}: {result}")


def arm(page, key, target, times, selector='#bd-canvas', event='pointerup'):
    page.evaluate("args => __w3.arm(...args)", [key, target, times, selector, event])


def collected(checks, page, key, label):
    page.wait_for_function("key => __w3.series[key]?.done", arg=key)
    data = page.evaluate("key => ({...__w3.series[key], actual:__w3.series[key].times.map(t=>__w3.shots[`${key}-${t}`]?.ms)})", key)
    checks.ok(not data['error'] and all(actual is not None and abs(actual - target) <= 35
              for actual, target in zip(data['actual'], data['times'])) and
              all(b > a for a, b in zip(data['actual'], data['actual'][1:])
                  if a is not None and b is not None),
              f"{label} 채집 시각 ±35ms: {data}")
    return data


def idle(page):
    page.mouse.move(0, 0)
    page.wait_for_timeout(2000)
    return page.evaluate("""() => new Promise(resolve => {
      const n=__w3raf, t=performance.now();
      setTimeout(()=>resolve({callbacks:__w3raf-n, ms:performance.now()-t,
        fx:__w3.fx, maxFx:__w3.maxFx}),1000);
    })""")


def setup(page, base, mode):
    page.goto(base + ('#league' if mode == 'solo' else '#build'))
    page.wait_for_function(BOOT_JS)
    if mode == 'solo':
        start_solo(page)
        if shown(page, '#lg-guide-close'):
            page.locator('#lg-guide-close').click()
        if shown(page, '.lg-px'):
            page.locator('.lg-px').click()
    page.wait_for_selector('#bd-canvas')
    if shown(page, '#bd-drawer-x'):
        page.locator('#bd-drawer-x').click()
    tool(page, 'solar')
    # 켜진 렌즈를 하나씩 끈다. .all()의 nth 위치 지정자는 첫 클릭 뒤 목록이 줄어 어긋나므로 매번 첫 항목을 다시 찾는다.
    pressed = page.locator('[data-lens][aria-pressed="true"]')
    for _ in range(10):
        if not pressed.count():
            break
        pressed.first.click()
    # 품질8 UX: 리그 지도에서는 자료 지도 단추가 '지도 보기'(details.lg-map-views) 안으로 접혔다. 닫혀 있으면 펼친 뒤 고른다.
    layer = page.locator('[data-layer="map"]')
    # 기본 '지도' 층이 이미 켜져 있으면 고르지 않는다. 리그에서는 펼친 '지도 보기' 메뉴의 선택지가
    # 문제 칩(#lg-issue 계열)에 가려 클릭이 막히는 기존 배치 결함이 있다(UX 갈래에 보고, 2026-10-20).
    if layer.get_attribute('aria-pressed') != 'true':
        if not layer.is_visible() and page.locator('.lg-map-views > summary').count():
            page.locator('.lg-map-views > summary').click()
        layer.click()
    page.mouse.move(0, 0)
    page.wait_for_timeout(600)
    return page.evaluate(PROBE_JS)


def construction(checks, page, label, reduced):
    original = plan(page)
    a, b = page.evaluate(CANDIDATES_JS)
    before = idle(page)
    take(page, 'empty-a', a)
    take(page, 'empty-b', b)
    # 패널색 부재/존재는 동일한 색 기준을 쓴다. 배치가 달라진 빈 칸의 전체 화소는 비교하지 않는다.
    checks.ok(page.evaluate("() => __w3.panel('empty-a')===0 && __w3.panel('empty-b')===0"),
              label + ' 설치 전 두 칸에 태양광 패널색 없음')
    times = [50, 600, 1200] if reduced else [100, 150, 600, 1200]
    arm(page, 'place', a, times)
    click_tile(page, a)
    collected(checks, page, 'place', label + ' 설치')
    checks.ok(plan(page) == original + [{'t': 'solar', 'i': a}], label + ' 화면 설치가 계획에 반영')
    if reduced:
        compare(checks, page, 'place-50', 'place-600', True, label + ' reduce 50ms에 최종 그림')
    else:
        compare(checks, page, 'place-100', 'place-150', False, label + ' 설치 100→150ms 움직임')
    compare(checks, page, 'place-600', 'place-1200', True, label + ' 설치 600→1200ms 정지')
    # 막대 줄 수가 바뀌어도 현재 같은 칸에 패널색이 있어야 설치 그림이 남은 것이다.
    checks.ok(page.evaluate("() => __w3.panel('place-600')>0"), label + ' 600ms 태양광 패널색 존재')
    screenshot(checks, page, f'fx-map-{label}-placed.png')
    overflow(checks, page, label + ' 설치')

    prepare_remove(checks, page, a, label)
    take(page, 'before-remove', a)
    arm(page, 'remove', a, [100, 150, 600, 1300])
    click_tile(page, a)
    collected(checks, page, 'remove', label + ' 철거')
    # W3 §2: 그림 비교와 별도로 화면 조작 직후 실제 대상이 제거됐는지 확인한다.
    checks.ok(not any(item['i'] == a for item in plan(page)), label + ' 철거 대상 칸의 설비 제거')
    if not reduced:
        # W3 §2: 시각마다 같은 칸을 추적한다. 축척·래스터화로 화소가 불안정하면
        # 공개 needsFrame 입력의 remove 등록(100ms)·종료(600ms)를 함께 증거로 쓴다.
        removal = page.evaluate("""i => {
          const P=__w3, A=P.shots['remove-100'], B=P.shots['remove-150'];
          const pixels=A.w===B.w && A.h===B.h ? P.diff('remove-100','remove-150') : null;
          const effects=[100,600].map(t=>P.shots[`remove-${t}`].mapFx);
          return {pixels,effects,active:effects[0]?.some(f=>f.kind==='remove' && f.i===i)===true,
            ended:effects[1]!==null && !effects[1].some(f=>f.kind==='remove' && f.i===i)};
        }""", a)
        lifecycle = removal['active'] and removal['ended']
        pixels = removal['pixels']
        pixel_changed = pixels is not None and pixels['changed'] >= 5
        checks.ok(lifecycle, f'{label} remove 효과 100ms 존재·600ms 종료: {removal["effects"]}')
        checks.ok(pixel_changed or lifecycle,
                  f'{label} 철거 움직임: {removal}, 판정={"픽셀" if pixel_changed else "공개 효과 상태"}')
    # 비용 글자는 1.1초 유지된다. 1300ms의 현재 rect에서 패널색 부재로 철거 잔상을 검사한다.
    checks.ok(page.evaluate("() => __w3.panel('remove-1300')===0"),
              label + ' 철거 1300ms 현재 칸에 태양광 패널색 없음')
    layout = page.evaluate("""() => {
      const P=__w3, before=P.shots['empty-a'], placed=P.shots['before-remove'],
        after=P.shots['remove-1300'];
      return {canvasTop:{before:before.mapTop,placed:placed.mapTop,after:after.mapTop,
        delta:after.mapTop-placed.mapTop,changed:after.mapTop!==placed.mapTop},
        tileY:{before:before.rect.y,placed:placed.rect.y,after:after.rect.y}};
    }""")
    print(f'INFO {label} 리그 배치 변화: {layout}', flush=True)
    checks.ok(plan(page) == original, label + ' 철거 뒤 계획 복원')
    after = idle(page)
    print(f'INFO {label} rAF 전={before} 후={after}', flush=True)
    fx = after['fx']
    checks.ok(fx is not None and fx['count'] == 0 and fx['floaters'] == 0,
              label + ' 효과·비용 글자 종료 뒤 상태 0 (공개 needsFrame 관찰)')
    if before['callbacks']:
        # 풍차·연기 등 기존 상시 rAF는 효과 종료로 멈출 수 없으므로 상태 0 대체.
        checks.ok(fx is not None and fx['count'] == 0 and (reduced or after['maxFx'] > 0),
                  label + ' 기존 상시 rAF: 효과 등록 관측 뒤 효과 상태 0으로 대체')
    else:
        checks.ok(after['callbacks'] == 0, label + ' 기존 정지 지도: 효과 뒤 1초 rAF 콜백 0')

    trace = page.evaluate(RAPID_JS, [a, b])
    page.wait_for_timeout(1300)
    gaps = [right['ms'] - left['ms'] for left, right in zip(trace, trace[1:])]
    checks.ok(len(trace) == 11 and all(abs(gap - 50) <= 35 for gap in gaps),
              f'{label} 설치·철거 5회 + 최종 설치, 간격 50±35ms: {gaps}')
    checks.ok(all(row['builds'] == original + ([{'t': 'solar', 'i': a}] if k % 2 == 0 else [])
                  for k, row in enumerate(trace[:10])), label + ' 빠른 조작 매 단계 계획 반영')
    checks.ok(plan(page) == original + [{'t': 'solar', 'i': b}], label + ' 1300ms 뒤 최종 계획 건물 수 +1')
    take(page, 'rapid-a', a)
    take(page, 'rapid-b', b)
    # 연속 철거 뒤에도 줄바꿈 전 empty-a와 전체 화소 비교는 무의미하다. 현재 칸의 패널색을 본다.
    checks.ok(page.evaluate("() => __w3.panel('rapid-a')===0"), label + ' 화면 A 태양광 패널색 없음')
    # W3 §1·§5: 최종 태양광 본체가 남아야 한다. 최소 10화소라는 규정은 없으므로
    # 작은 축척도 같은 색 기준으로 패널 화소의 존재를 확인한다(빈 칸의 패널색 0은 위에서 검사).
    panel = page.evaluate("() => ({added:__w3.panel('rapid-b')-__w3.panel('empty-b')})")
    checks.ok(panel['added'] > 0, f'{label} 최종 1개는 태양광 패널색 픽셀로도 확인: {panel}')
    screenshot(checks, page, f'fx-map-{label}-rapid.png')
    overflow(checks, page, label + ' 연속 조작')


def flow(checks, page, label, mode, reduced):
    fixture = page.evaluate(FLOW_SITE_JS)
    page.evaluate("edge => {__w3.flowEdge=edge;}", fixture['edge'])
    tool(page, 'diesel')
    old = plan(page)
    click_tile(page, fixture['i'])
    checks.ok(plan(page) == old + [{'t': 'diesel', 'i': fixture['i']}], label + ' 시험용 디젤 화면 설치')
    page.wait_for_timeout(1200)
    # W3 §4: 작은 밝은 점의 이동을 본다. 양 끝 철탑 사이 전체에 축척의 0.35배
    # 여유를 두어 리그의 작은 지도에서도 곡선·입자 가장자리를 놓치지 않는다.
    # 전선도 고정 rect를 재사용하지 않고 표본 시각마다 양 끝 칸에서 영역을 구한다.
    edge = fixture['edge']
    take(page, 'no-line', edge)
    tool(page, 'line')
    click_tile(page, fixture['i'])
    click_tile(page, fixture['end'])
    arm(page, 'line', edge, [100, 150, 600], '#bd-cf-ok', 'click')
    page.locator('#bd-cf-ok').click()
    page.mouse.move(0, 0)
    collected(checks, page, 'line', label + ' 송전선')
    checks.ok(page.evaluate("p => KCP.buildGame.current().lines.some(l=>JSON.stringify(l.p)===JSON.stringify(p))",
                            fixture['path']), label + ' 화면 송전선 완성 경로가 계획에 존재')
    compare(checks, page, 'no-line', 'line-600', False, label + ' 600ms 전선 중앙에 선 그림 존재')
    checks.ok(page.evaluate("""() => {
      const dark=name=>{const p=__w3.shots[name].pixels;let n=0;
        for(let k=0;k<p.length;k+=4) if(p[k]<60 && p[k+1]<65 && p[k+2]<70) n++;
        return n;};
      return dark('line-600')-dark('no-line') >= 3;
    }"""), label + ' 선 영역의 어두운 전선·철탑 픽셀 증가 (연기 변화만으로 통과 방지)')
    screenshot(checks, page, f'fx-map-{label}-line.png')
    if mode == 'build':
        page.locator('#bd-pm').click()
        page.locator('[data-tab="mission"]').click()
        for _ in range(2):
            page.locator('[data-mis][aria-pressed="false"]:not([disabled])').first.click()
        page.locator('#bd-drawer-x').click()
        page.wait_for_timeout(600)
    arm(page, 'flow', edge, [50, 100] if reduced else [180, 280, 380], '[data-run="7"]', 'click')
    page.locator('[data-run="7"]').click()
    collected(checks, page, 'flow', label + ' 시험 1주')
    keys = ['flow-50', 'flow-100'] if reduced else ['flow-180', 'flow-280', 'flow-380']
    checks.ok(page.evaluate("keys => keys.every(k=>__w3.shots[k]?.running)", keys),
              label + ' 모든 전선 표본이 실제 시험 운전 중')
    if reduced:
        # W3b §5: 정지한 빛띠와 고정 입자도 허용한다. 밝은 화소 수 0은 요구하지 않는다.
        compare(checks, page, keys[0], keys[1], True, label + ' reduce 시험 중 선 픽셀 고정')
        masked = page.evaluate("keys => __w3.diff(...keys,true)", keys)
        phases = page.evaluate("keys => keys.map(k=>__w3.shots[k].flow)", keys)
        checks.ok(all(p is not None for p in phases) and
                  phases[0]['e'] == phases[1]['e'] and
                  isinstance(phases[0]['phase'], (int, float)) and
                  phases[0]['phase'] == phases[1]['phase'],
                  f'{label} reduce 전선 위상 불변: 픽셀={masked}, 위상={phases}')
    else:
        marks = page.evaluate('() => __w3.marks')
        checks.ok(any(m['count'] > 0 and {m['from'], m['to']} == set(fixture['edge']) for m in marks),
                  label + ' 비교한 전선은 실제 통전 입자 경로')
        for a, b in zip(keys, keys[1:]):
            # W3 §4: 움직임은 선분 위상의 변화로도 확인한다. 축척·래스터화 때문에
            # 밝은 화소가 누락될 수 있어 고정 5화소 문턱 대신 집합 차이 또는 위상을 쓴다.
            # 위상도 별도 단언하여 다른 밝은 물체의 이동만으로 통과하지 못하게 한다.
            masked = page.evaluate("keys => __w3.diff(...keys,true)", [a, b])
            phases = page.evaluate("keys => keys.map(k=>__w3.shots[k].flow)", [a, b])
            phase_changed = (all(p is not None and p['count'] > 0 for p in phases) and
                             phases[0]['e'] == phases[1]['e'] and
                             all(isinstance(p['phase'], (int, float)) for p in phases) and
                             abs(phases[1]['phase'] - phases[0]['phase']) > 1e-6)
            pixel_changed = masked['changed'] > 0 and masked['litA'] > 0 and masked['litB'] > 0
            checks.ok(phase_changed, f'{label} 통전 선분 위상 시간 변화 {a}→{b}: {phases}')
            checks.ok(pixel_changed or phase_changed,
                      f'{label} 선 위 입자색 픽셀 시간 변화 {a}→{b}: 픽셀={masked}, '
                      f'위상={phases}, 판정={"픽셀" if pixel_changed else "공개 위상"}')
    screenshot(checks, page, f'fx-map-{label}-running.png')
    overflow(checks, page, label + ' 시험')
    if shown(page, '#bd-skip'):
        page.locator('#bd-skip').click()


def save_samples(checks, page, label):
    def save():
        RESULTS.mkdir(parents=True, exist_ok=True)
        samples = page.evaluate("() => Object.entries(window.__w3?.shots || {}).map(([name,s])=>[name,s.png])")
        for name, png in samples:
            (RESULTS / f'fx-map-{label}-{name}.png').write_bytes(base64.b64decode(png.split(',', 1)[1]))
        return bool(samples)
    checks.test(label + ' 시간별 Canvas 표본 PNG 저장', save)


class MotionBrowser:
    def __init__(self, browser, reduced):
        self.browser = browser
        self.motion = 'reduce' if reduced else 'no-preference'

    def new_context(self, **options):
        return self.browser.new_context(reduced_motion=self.motion, **options)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for mode in ('solo', 'build'):
                    for reduced in (False, True):
                        label = f'{mode}-1280x900-' + ('reduce' if reduced else 'motion')
                        context, external = context_for(MotionBrowser(browser, reduced), base, 1280, 900, 'light')
                        context.add_init_script(RAF_JS)
                        page, events = monitored_page(context)
                        try:
                            probe = setup(page, base, mode)
                            checks.ok(probe['hook'], label + ' 공개 효과 상태 관측 경로')
                            checks.ok(page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches") == reduced,
                                      label + ' 움직임 설정 실제 적용')
                            overflow(checks, page, label + ' 시작')
                            construction(checks, page, label, reduced)
                            flow(checks, page, label, mode, reduced)
                        except Exception as exc:
                            checks.ok(False, f'{label} 진행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                            screenshot(checks, page, f'fx-map-{label}-failure.png')
                        finally:
                            save_samples(checks, page, label)
                            diagnostics(checks, events, label)
                            overflow(checks, page, label + ' 마지막')
                            checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
