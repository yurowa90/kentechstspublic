"""rev14b/spec.md C·G·D·A3 수용 검사. 작성 세션에서는 py_compile만 실행.

허용된 샌드박스 밖 로컬 실행 담당자:
 REV14B_CAP=tests/results/rev14b tests/.venv/bin/python tests/league/rev14b.py \
   http://127.0.0.1:<포트>/index.html
기존 끝 화면 재알림 도우미가 없어 C는 네 크기에서 각각 실제 12달 진행한다.
FORCE_EVENT는 운영 전 사건 입력에만 사용. A3만 명세가 허용한 임시 폭포 DOM을
추가하고 finally에서 제거한다. 외부 요청은 context_for가 차단한다.
SKIP: D 계절 여름의 FORCE_EVENT가 사건을 생성할 수 없는 경우만(이유 출력).
나머지 미관측/선택자 부재/프레임 0은 BLOCKED 실패다. PNG는 실행 시 생성.
"""
import argparse
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, context_for, diagnostics, monitored_page, open_panel,
                    overflow, local_address, shown)
from fx_end import dismiss_guide
from fx_replay import reach_result
from league_flow import select_mode, wait_unfolded
from rev11 import DOM, InputBrowser, press
from rev14 import Checks, attempt, FORCE_EVENT, start_room, submit
from s7 import plan_and_trial
from solo import click_next, close_drawer, read

HS = '오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄어요.'
END_CARDS = ('#lg-final-summary, #lg-decisions, .lg-fx-end, #lg-rank, #lg-trends, '
             '.lg-end-more > *, #lg-panel .lg-pbody section, '
             '#lg-panel .lg-pbody article, #lg-panel .lg-pbody .lg-sec')
END_CONTROLS = '#lg-panel-fold, .lg-px, .lg-ptabs button'
END_PROBE = r"""({cards,controls}) => {
 if(window.__rev14bEnd)window.__rev14bEnd.active=false;
 const p=window.__rev14bEnd={active:true,done:false,seen:false,frames:0,bodyFrames:0,
  controlFrames:0,violations:0,maxArea:0,minLeft:null,maxRight:null,width:innerWidth,
  maxOverflow:0,samples:[],targets:[],error:null};
 const {visible,box,area}=(""" + DOM + r""");
 const scan=()=>{
  if(!p.active)return;
  try {
   const L=KCP.league.state(),V=L.S||L.snap;
   if(V?.phase==='end'&&visible(document.querySelector('#lg-final-summary'))) {
    const toast=document.querySelector('#bd-toast');
    if(visible(toast)&&+getComputedStyle(toast).opacity>0.05) {
     p.frames++;p.seen=true;const r=box(toast);
     p.minLeft=p.minLeft===null?r.left:Math.min(p.minLeft,r.left);
     p.maxRight=p.maxRight===null?r.right:Math.max(p.maxRight,r.right);
     const body=[...document.querySelectorAll(cards)].filter(visible),
       head=[...document.querySelectorAll(controls)].filter(visible);
     if(body.length)p.bodyFrames++;if(head.length)p.controlFrames++;
     p.maxOverflow=Math.max(p.maxOverflow,document.documentElement.scrollWidth-document.documentElement.clientWidth);
     let bad=r.left<0||r.right>innerWidth;const overlaps=[];
     for(const el of [...body,...head]) {
      const name=el.id||el.className,a=area(r,box(el));p.maxArea=Math.max(p.maxArea,a);
      if(!p.targets.includes(name))p.targets.push(name);
      if(a>0){bad=true;overlaps.push({name,area:a});}
     }
     if(bad){p.violations++;if(p.samples.length<8)p.samples.push({toast:r,overlaps});}
    } else if(p.seen){p.done=true;p.active=false;return;}
   }
  }catch(e){p.error=String(e);p.active=false;return;}
  requestAnimationFrame(scan);
 };requestAnimationFrame(scan);
}"""


def await_replay(page):
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    wait_unfolded(page)


def end_case(checks, page, base, width, touch):
    start_room(checks, page, base)
    plan_and_trial(page)
    for month in range(1, 13):
        state = read(page)['S']
        if state['phase'] != 'plan' or state['round'] != month:
            raise AssertionError(f'BLOCKED C {month}월 계획 상태 없음')
        if month == 12:
            page.evaluate(END_PROBE, {'cards': END_CARDS, 'controls': END_CONTROLS})
        submit(page, touch)
        reach_result(page, month)
        await_replay(page)
        if month < 12:
            overflow(checks, page, f'C {width} {month}월')
            click_next(page, read(page)['S'])
    state = read(page)['S']
    if state['phase'] != 'end':
        click_next(page, state)
    page.wait_for_selector('#lg-final-summary', state='visible')
    try:
        page.wait_for_function('() => window.__rev14bEnd?.frames>0 || window.__rev14bEnd?.error', timeout=6000)
    except Exception:
        checks.blocked(f'C {width} 알림 측정 프레임 0')
    # 보이는 알림 프레임을 확보해야 캡처 성공으로 센다.
    visible = page.locator('#bd-toast').evaluate("e=>e.getClientRects().length>0&&+getComputedStyle(e).opacity>0.05")
    checks.ok(visible, f'C {width} 캡처 순간 알림 opacity > .05')
    if visible:
        checks.shot(page, f'end-{width}')
    try:
        page.wait_for_function('() => window.__rev14bEnd?.done || window.__rev14bEnd?.error', timeout=8000)
    except Exception:
        checks.blocked(f'C {width} 알림 소멸까지 관측 미완료')
    p = page.evaluate('() => {const p=window.__rev14bEnd;p.active=false;return p;}')
    print(f'INFO C {width} {json.dumps(p, ensure_ascii=False)}', flush=True)
    checks.ok(p['frames'] > 0, f'C {width} rAF 프레임 > 0 (0이면 BLOCKED)')
    checks.ok(p['error'] is None and p['done'], f'C {width} rAF 오류 0·소멸까지 관측')
    checks.ok(p['bodyFrames'] == p['frames'] and p['controlFrames'] == p['frames'] and bool(p['targets']),
              f'C {width} 매 프레임 본문·머리 조작 요소 확보')
    checks.ok(p['violations'] == 0 and p['maxArea'] == 0, f'C {width} 모든 프레임 교차 넓이 0')
    checks.ok(p['minLeft'] is not None and p['minLeft'] >= 0 and
              p['maxRight'] is not None and p['maxRight'] <= p['width'], f'C {width} 알림 좌우 화면 안')
    checks.ok(p['maxOverflow'] == 0, f'C {width} 모든 관측 프레임 가로 넘침 0')
    rows = page.evaluate("""() => {
      const row=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).gridRowStart:null;};
      const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right};};
      return {more:row('.lg-end-more'),decisions:row('#lg-decisions'),fold:box('#lg-panel-fold'),close:box('.lg-px')};
    }""")
    if width == 390:
        checks.ok(rows['fold'] is not None and rows['close'] is not None and
                  0 <= rows['close']['left'] - rows['fold']['right'] <= 12,
                  f'C 390 접기는 닫기 바로 왼쪽·간격 <=12px (명세 C): {rows}')
    else:
        checks.ok(rows['more'] == ('3' if width == 1280 else '2'), f'C {width} .lg-end-more 행: {rows}')
        if width in (1024, 1180):
            checks.ok(rows['decisions'] == '1', f'C {width} #lg-decisions 1행')


# G V4 덧붙임: 점은 summary 배경 원, 글자는 텍스트 노드 Range로 측정한다.
# rev16 #71-2(명세): 누름 영역이 칩 전체가 되며 점과 '!'는 summary의 가상 요소(지금 ::before) 하나로 그린다.
# 가상 요소의 글자는 Range로 잴 수 없으므로 그 가상 요소의 계산 스타일에서 실제로 그려지는 상자를 다시 만든다(#56 후속).
#  - 어느 가상 요소인지 고정하지 않고 content가 "!"인 ::before·::after를 찾는다.
#  - 위치는 CSS 변수(--lg-money-dot-x/y)가 아니라 가상 요소의 left/top 해석값(위치 지정 요소면 px 사용값)을 쓴다.
#    포함 블록은 summary부터 위로 처음 만나는 '위치 지정(absolute일 때) 또는 transform·filter·backdrop-filter·contain(paint 등)이
#    있는' 요소의 안쪽(테두리 안) 상자이고, 그런 조상이 없을 때 fixed면 화면이다(이 HUD처럼 backdrop-filter 조상이 있으면 그 상자).
#    위치 지정 조상이 없는 absolute는 계산하지 않는다(null → BLOCKED). 바깥 여백(margin)은 left/top에 더한다.
#  - 상자 크기는 border-box(배경 원이 그려지는 넓이)로 맞추고, transform·transform-origin을 DOMMatrix로 적용한다.
#    점 가운데 = 상자 가운데의 화면 좌표, '!' 가운데 = 내용 상자 가운데의 화면 좌표(가로 가운데 정렬이고 줄 높이 = 내용 높이인
#    한 줄일 때만 정해진다. 아니면 거리 Infinity로 실패).
#  - 한계: '!' 가운데는 글자 화소가 아니라 정렬 방식(가운데 정렬·줄 높이)으로 정한다. 그래서 거리 ≤4px 단언은 사실상
#    같은 상자 안 가운데 정렬을 확인한다. 다른 방식으로 가운데에 두면 거짓 실패가 날 수 있다(그때는 캡처 화소로 잰다).
#  - 숫자는 Number.isFinite(parseFloat(v))로 읽는다(지수 표기 1.56e-15px도 받는다).
#  - 보임: 점은 배경색 불투명도 > 0·크기 > 0, '!'는 글자 크기 > 0·글자색 불투명도 > 0(summary 글자 크기는 0이라
#    가상 요소가 글자 크기를 따로 가져야 '!'가 보인다). 둘 다 display·visibility·opacity와 summary 자체의 보임도 본다.
# 기대값은 명세에서 온다: 누름 영역 화면 안 ≥44×44(#71 이슈 본문, docs/QUALITY-ux.md D '44px 미만 0'),
# 점 가운데가 금액 글자 밖, '!' 글자 가운데와 점 가운데 거리 ≤4px(rev14b 명세 G V4). 구현의 22px·18px 같은 값은 쓰지 않는다.
DOT_BOX = r"""el => {
 const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null;};
 const alpha=c=>{
  c=String(c||'').trim();if(!c||c==='transparent')return 0;
  const slash=/\/\s*([-+\d.eE]+)(%?)\s*\)\s*$/.exec(c);
  if(slash){const a=parseFloat(slash[1]);return slash[2]?a/100:a;}
  const m=/^rgba?\(([^)]*)\)$/.exec(c);
  if(m){const parts=m[1].split(/\s*,\s*|\s+/).filter(Boolean);
   if(parts.length>=4){const a=parseFloat(parts[3]);return parts[3].endsWith('%')?a/100:a;}}
  return 1;
 };
 let pseudo=null,p=null;
 for(const name of ['::before','::after']){const s=getComputedStyle(el,name);if(s.content==='"!"'){pseudo=name;p=s;break;}}
 if(!p||!['absolute','fixed'].includes(p.position))return null;
 const fixed=p.position==='fixed';
 const contains=s=>s.transform!=='none'||s.filter!=='none'||(s.backdropFilter&&s.backdropFilter!=='none')||
  /paint|layout|strict|content/.test(s.contain||'');
 let c=el;
 while(c){const s=getComputedStyle(c);if((!fixed&&s.position!=='static')||contains(s))break;c=c.parentElement;}
 let origin=null;
 if(c){const r=c.getBoundingClientRect();origin={left:r.left+c.clientLeft,top:r.top+c.clientTop,width:c.clientWidth,height:c.clientHeight};}
 else if(fixed)origin={left:0,top:0,width:innerWidth,height:innerHeight};
 if(!origin)return null;
 const side=k=>num(p[k])??0,border=['Left','Right','Top','Bottom'].map(k=>side('border'+k+'Width')),
  pad=['Left','Right','Top','Bottom'].map(k=>side('padding'+k));
 let w=num(p.width),h=num(p.height);
 if(w===null||h===null)return null;
 if(p.boxSizing!=='border-box'){w+=border[0]+border[1]+pad[0]+pad[1];h+=border[2]+border[3]+pad[2]+pad[3];}
 const l=num(p.left),t=num(p.top),rt=num(p.right),bm=num(p.bottom),margin=['Left','Right','Top','Bottom'].map(k=>side('margin'+k));
 const left=l!==null?origin.left+l+margin[0]:(rt!==null?origin.left+origin.width-rt-margin[1]-w:null),
  top=t!==null?origin.top+t+margin[2]:(bm!==null?origin.top+origin.height-bm-margin[3]-h:null);
 if(left===null||top===null)return null;
 const matrix=p.transform==='none'?new DOMMatrixReadOnly():new DOMMatrixReadOnly(p.transform);
 const [ox,oy]=p.transformOrigin.split(' ').map(v=>num(v)??0);
 const at=(x,y)=>{const q=new DOMPoint(x-ox,y-oy).matrixTransform(matrix);return {x:left+ox+q.x,y:top+oy+q.y};};
 const dot=at(w/2,h/2);
 const cw=w-border[0]-border[1]-pad[0]-pad[1],ch=h-border[2]-border[3]-pad[2]-pad[3],lh=num(p.lineHeight);
 const centered=['center','-webkit-center'].includes(p.textAlign)&&lh!==null&&Math.abs(lh-ch)<.5;
 const glyph=centered?at(border[0]+pad[0]+cw/2,border[2]+pad[2]+ch/2):null;
 const host=typeof el.checkVisibility==='function'?el.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;
 const shown=host&&p.display!=='none'&&p.visibility==='visible'&&(num(p.opacity)??1)>0;
 return {pseudo,x:dot.x,y:dot.y,left:p.left,top:p.top,w,h,transform:p.transform,centered,glyph,
  distance:glyph?Math.hypot(dot.x-glyph.x,dot.y-glyph.y):Infinity,
  bg:p.backgroundColor,color:p.color,fontSize:p.fontSize,
  dotVisible:shown&&w>0&&h>0&&alpha(p.backgroundColor)>0,
  bangVisible:shown&&(num(p.fontSize)??0)>0&&alpha(p.color)>0};
}"""


def v4(checks, page, base):
    start_room(checks, page, base)
    made = page.evaluate(FORCE_EVENT, 'coldwave_heating')
    if not made['ok']:
        made = page.evaluate(FORCE_EVENT, 'heavy_rain')
    if not made['ok']:
        checks.blocked('G V4 교부세 사건 생성 불가: ' + made['reason'])
        return
    page.evaluate('() => KCP.league.plan(() => {})')
    close_drawer(page)
    button = page.locator('.lg-money-info summary')
    if button.count() != 1:
        checks.blocked('G V4 .lg-money-info summary 하나 미확보')
        return
    hit = button.bounding_box()
    checks.ok(hit['y'] >= 0, 'G V4 summary top >= 0')
    # #71 명세 1: 누름 영역(summary)이 화면 안에서 44×44 이상(터치 기준 44px, docs/QUALITY-ux.md D).
    view = page.viewport_size
    checks.ok(hit['width'] >= 44 and hit['height'] >= 44 and hit['x'] >= 0 and hit['y'] >= 0 and
              hit['x'] + hit['width'] <= view['width'] and hit['y'] + hit['height'] <= view['height'],
              f'G V4 누름 영역 화면 안 ≥44×44: {hit}/{view}')
    dot = button.evaluate(DOT_BOX)
    money = page.locator('[data-cap="budget"] [data-v]')
    if dot is None or money.count() != 1:
        checks.blocked('G V4 점·! 가상 요소/금액 [data-v] 선택자 미확보')
    else:
        b = money.evaluate("""el=>{const r=document.createRange();r.selectNodeContents(el);
          const b=r.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}""")
        checks.ok(all(isinstance(dot[k], (int, float)) for k in ('x', 'y')) and
                  not (b['x'] <= dot['x'] <= b['x'] + b['width'] and b['y'] <= dot['y'] <= b['y'] + b['height']),
                  f'G V4 보이는 점 중심이 금액 글자 밖: {dot}/{b}')
        checks.ok(dot['distance'] <= 4, f'G V4 ! 글자 가운데·점 중심 거리 <=4px: {dot}')
        checks.ok(dot['dotVisible'], f'G V4 점 보임(배경 불투명·크기 > 0): {dot}')
        checks.ok(dot['bangVisible'], f"G V4 '!' 보임(글자 크기 > 0·글자색 불투명): {dot}")
    for target in ('map', 'ready'):
        # 누름은 실제 터치 경로를 사용한다. 첫 누름이 닫기 외 준비까지 실행하면 실패다.
        button.tap()
        checks.ok(page.locator('.lg-money-info').evaluate('e=>e.open'), f'G V4 {target} ! 누르면 열림')
        if target == 'map':
            checks.shot(page, 'v4-open')
            canvas = page.locator('#bd-canvas')
            b = canvas.bounding_box()
            if b is None:
                raise AssertionError('BLOCKED 지도 빈 곳 좌표 없음')
            point = page.evaluate("""b=>{for(let y=b.y+8;y<b.y+b.height;y+=24)
              for(let x=b.x+8;x<b.x+b.width;x+=24)
               if(document.elementFromPoint(x,y)?.id==='bd-canvas')return {x,y};return null;}""", b)
            if point is None:
                raise AssertionError('BLOCKED 설명 밖 지도 빈 곳 좌표 없음')
            page.touchscreen.tap(point['x'], point['y'])
        else:
            b = page.locator('#lg-ready').bounding_box()
            if b is None:
                raise AssertionError('BLOCKED 준비 단추 좌표 없음')
            # 덧붙임: 준비 자리에서 실제 설명 글을 눌러야 click 관통을 검사한다.
            point = page.evaluate("""b=>{
              const pop=document.querySelector('.lg-money-info .lg-info-pop');
              if(!pop)return null;const w=document.createTreeWalker(pop,NodeFilter.SHOW_TEXT);
              let n;while((n=w.nextNode())){if(!n.textContent.trim())continue;
               const range=document.createRange();range.selectNodeContents(n);
               for(const r of range.getClientRects()){
                const left=Math.max(r.left,b.x),right=Math.min(r.right,b.x+b.width),
                 top=Math.max(r.top,b.y),bottom=Math.min(r.bottom,b.y+b.height);
                if(left>=right||top>=bottom)continue;
                const x=(left+right)/2,y=(top+bottom)/2;
                if(document.elementFromPoint(x,y)?.closest('.lg-money-info .lg-info-pop'))return {x,y};
               }}return null;}""", b)
            if point is None:
                raise AssertionError('BLOCKED 준비 자리 위 설명 글 겹침 미확보')
            page.touchscreen.tap(point['x'], point['y'])
        checks.ok(not page.locator('.lg-money-info').evaluate('e=>e.open'), f'G V4 {target} 한 번 누르면 닫힘')
        state = read(page)
        checks.ok(state['S']['phase'] == 'plan' and not state['S']['teams'][state['player']].get('ready') and
                  not shown(page, '#lg-ready-confirm') and not shown(page, '#lg-issue-check'),
                  f'G V4 {target} 닫는 누름에 준비 실행 없음')
        checks.shot(page, 'v4-closed')
    overflow(checks, page, 'G V4')


CARRY_BOX = r"""el => {
 const s=getComputedStyle(el);
 let cost=null,costBox=null,clips=[],costRange=null;
 const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];let n;
 while((n=walker.nextNode()))nodes.push(n);
 const text=el.textContent,at=text.indexOf('비용');
 if(at>=0) {
  const number=/[+−-]?\d[\d,]*(?:\.\d+)?/.exec(text.slice(at+2));
  if(number) {
   const end=at+2+number.index+number[0].length,start=end-1;
   let offset=0;
   for(const node of nodes){const next=offset+node.length;
    if(start>=offset&&end<=next){costRange=document.createRange();
     costRange.setStart(node,start-offset);costRange.setEnd(node,end-offset);break;}offset=next;}
   if(costRange){
    const clientBox=p=>{if(p===document.scrollingElement)return {left:0,top:0,right:innerWidth,bottom:innerHeight};
     const b=p.getBoundingClientRect();return {
     left:b.left+p.clientLeft,top:b.top+p.clientTop,
     right:b.left+p.clientLeft+p.clientWidth,bottom:b.top+p.clientTop+p.clientHeight};};
    const shift=(lo,hi,a,z)=>lo<a?lo-a:hi>z?hi-z:0;
    // 부분 노출된 긴 줄은 마지막 숫자까지 정상 스크롤한다.
    // hidden/clip과 line-clamp는 해제하지 않아 실제 클리핑은 실패한다.
    for(let p=el.parentElement;p;p=p.parentElement){const ps=getComputedStyle(p),b=clientBox(p),r=costRange.getBoundingClientRect();
     if(/^(auto|scroll)$/.test(ps.overflowX)&&p.scrollWidth>p.clientWidth)
      p.scrollLeft+=shift(r.left,r.right,b.left,b.right);
     if(/^(auto|scroll)$/.test(ps.overflowY)&&p.scrollHeight>p.clientHeight)
      p.scrollTop+=shift(r.top,r.bottom,b.top,b.bottom);
    }
    const last=costRange.getBoundingClientRect();
    window.scrollBy(shift(last.left,last.right,0,innerWidth),shift(last.top,last.bottom,0,innerHeight));
    const boxes=[...costRange.getClientRects()],r=el.getBoundingClientRect();
    costBox=boxes.map(b=>({left:b.left,right:b.right,top:b.top,bottom:b.bottom}));
    cost=boxes.length>0&&boxes.every(b=>b.width>0&&b.height>0&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&
     b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom);
    // 대상은 fixed 서랍(#lg-panel) 안이라 포함 블록이 뷰포트다. body·html의 overflow는 이 서랍을 자르지 않으므로 빼고, 화면 안 여부는 위에서 따로 본다.
    for(let p=el;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const ps=getComputedStyle(p),b=clientBox(p),
     x=/^(hidden|clip|scroll|auto)$/.test(ps.overflowX),y=/^(hidden|clip|scroll|auto)$/.test(ps.overflowY);
     if(x||y){const inside=boxes.every(r=>(!x||(r.left>=b.left&&r.right<=b.right))&&(!y||(r.top>=b.top&&r.bottom<=b.bottom)));
      clips.push({name:p.id||p.tagName,x,y,box:b,scrollLeft:p.scrollLeft,scrollTop:p.scrollTop,inside});cost=cost&&inside;}
    }
   }
  }
 }
 const r=el.getBoundingClientRect();
 return {text:text.trim(),scroll:el.scrollHeight,client:el.clientHeight,clamp:s.webkitLineClamp,
  overflow:s.overflow,overflowY:s.overflowY,cost,costBox,clips,hasCost:at>=0,left:r.left,right:r.right};
}"""


def carry_check(checks, page, width):
    open_panel(page, 'journal')
    el = page.locator('#lg-missed-carry')
    if el.count() != 1 or not el.is_visible():
        checks.blocked(f'G V5 {width} 다음 달 #lg-missed-carry 미확보')
        return
    el.scroll_into_view_if_needed()
    box = el.evaluate(CARRY_BOX)
    checks.ok(bool(box['text']) and box['scroll'] <= box['client'] + 1, f'G V5 {width} 전체 글 높이: {box}')
    checks.ok(box['clamp'] in ('none', 'unset'), f'G V5 {width} 줄 수 제한 없음: {box["clamp"]}')
    checks.ok(box['overflow'] == 'visible' and box['overflowY'] == 'visible', f'G V5 {width} overflow visible')
    checks.ok(not box['hasCost'] or box['cost'] is True, f'G V5 {width} 비용 뒤 숫자까지 화면·클리핑 안')
    if width == 390:
        checks.shot(page, 'v5-390')
    overflow(checks, page, f'G V5 {width}')


def v5_and_w2(checks, page, base):
    start_room(checks, page, base)
    plan_and_trial(page)
    found = False
    for month in range(1, 12):
        submit(page, True)
        reach_result(page, month)
        await_replay(page)
        open_panel(page, 'result')
        cards = page.locator('#lg-outage-cards [data-missed]')
        if cards.count():
            cards.first.tap()
            if shown(page, '#lg-outage-open'):
                press(page, '#lg-outage-open', True)
            if shown(page, '#lg-outage-carry'):
                # 같은 결과 서랍에서 A3 임시 표시를 먼저 검사하고 제거한다.
                attempt(checks, 'A3 W2 390', lambda: w2(checks, page))
                press(page, '#lg-outage-carry', True)
                click_next(page, read(page)['S'])
                found = True
                break
        click_next(page, read(page)['S'])
    if not found:
        checks.blocked('G V5 실제 카드 공개→다음 달 이어붙이기 장면 미확보')
        return
    carry_check(checks, page, 390)
    page.set_viewport_size({'width': 1280, 'height': 900})
    carry_check(checks, page, 1280)


def w2(checks, page):
    # Node 고정 예 .27/.24/.24: 순서·단독 최대를 지키는 합 .8이 불가능해 gap≠0.
    # 입력과 기대 문구는 rev14b A에서 정한다. 구현 출력으로 입력을 고르지 않는다.
    try:
        result = page.evaluate("""() => {
          const L=KCP.league;if(typeof L.outageWaterfallHTML!=='function')return {blocked:'outageWaterfallHTML 함수 없음'};
          const a={basis:'monthly',round:2,target:'grid',unit:'MWh/일',trial:20,base:20,actual:20.75,total:.75,
           replay:0,replayOutsideSum:true,parts:[.27,.24,.24,0,0,0].map((value,i)=>({key:['choice','weather','event','progress','growth','trade'][i],value}))};
          const host=document.querySelector('#lg-panel .lg-pbody');if(!host)return {blocked:'서랍 본문 없음'};
          const box=document.createElement('div');box.id='rev14b-temp';box.innerHTML=L.outageWaterfallHTML(a);host.append(box);
          return {count:box.querySelectorAll('#lg-outage-round-note[data-round-note="w2"]').length};
        }""")
        if result.get('blocked'):
            checks.blocked('A3 ' + result['blocked'])
            return
        checks.ok(result['count'] == 1, 'A3 고정 gap 입력에 W2 하나')
        note = page.locator('#rev14b-temp #lg-outage-round-note[data-round-note="w2"]')
        if note.count() != 1:
            return
        checks.ok(note.inner_text().strip() ==
                  '몫마다 표시 눈금에 맞춰 보여서, 몫의 합(+0.7 MWh/일)이 차이(+0.8 MWh/일)와 0.1 MWh/일 달라요.',
                  'A3 W2 갱신 문구·세 자리 표시')
        note.scroll_into_view_if_needed()
        box = note.evaluate("""el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);
          const lh=parseFloat(s.lineHeight);return {left:b.left,right:b.right,scroll:el.scrollWidth,client:el.clientWidth,
           lines:Number.isFinite(lh)?(b.height-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom))/lh:null};}""")
        checks.ok(box['left'] >= 0 and box['right'] <= 390 and box['scroll'] <= box['client'], f'A3 W2 가로 넘침 0: {box}')
        checks.ok(box['lines'] is not None and 0 < box['lines'] <= 2, f'A3 W2 두 줄 이하: {box}')
        checks.shot(page, 'w2-390')
    finally:
        page.evaluate("() => document.getElementById('rev14b-temp')?.remove()")


def season_heat(checks, page, base):
    page.goto(base + '#league/multi')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'host')
    # e2e.py의 진행자 로비 경로. 혼자 하기에는 계절 판 선택이 없다.
    button = page.locator('#lg-mode-host [data-turns="0"]')
    if button.count() != 1:
        checks.blocked('D 진행자 로비 계절 4라운드 단추 선택자 미확보')
        return
    button.click()
    page.locator('#lg-host').click()
    page.wait_for_selector('#lg-roomcode')
    checks.ok(page.evaluate("() => KCP.league.state().role==='host'"), 'D 진행자 방 생성')
    for _ in range(12):
        state = read(page)['S']
        rounds = page.evaluate('() => KCP.leagueCore.roundsOf(KCP.league.state().S)')
        if state['phase'] == 'plan' and rounds[state['round']-1].get('season') == 'summer':
            break
        click_next(page, state)
    state = read(page)['S']
    checks.ok(not state.get('econ') and len(rounds) == 4, 'D 계절 4라운드·경제 없음')
    rounds = page.evaluate('() => KCP.leagueCore.roundsOf(KCP.league.state().S)')
    if state['phase'] != 'plan' or rounds[state['round']-1].get('season') != 'summer':
        checks.blocked('D 계절 여름 계획 미확보')
        return
    try:
        made = page.evaluate(FORCE_EVENT, 'heatwave_peak')
    except Exception as exc:
        checks.skip('D 계절 폭염', '진행자 FORCE_EVENT 생성 예외: ' + str(exc).splitlines()[0])
        return
    print('INFO D 진행자 FORCE_EVENT ' + json.dumps(made, ensure_ascii=False), flush=True)
    if not made['ok']:
        checks.skip('D 계절 폭염', '진행자 FORCE_EVENT: ' + made['reason'])
        return
    # 실제 운영 단추로 상태 저장·진행자 상황판 렌더링까지 갱신한다.
    # 계획 전용 API를 진행자 세션에 호출하지 않는다.
    click_next(page, state)
    source = page.locator('#lg-evbox [data-event-source="heatwave_peak"]')
    if not source.count():
        checks.blocked('D [data-event-source="heatwave_peak"] 미확보')
        return
    card = source.first.locator('xpath=ancestor::li[contains(concat(" ", normalize-space(@class), " "), " lg-ev ")][1]')
    if not card.count():
        checks.blocked('D .lg-ev 카드 선택자 미확보')
        return
    front = card.evaluate("""el=>[...el.querySelectorAll('p,span')].filter(e=>!e.closest('details')&&!e.children.length).map(e=>e.innerText.trim())""")
    checks.ok(HS in front, f'D 계절 폭염 앞면 = HS: {front}')
    checks.ok(not any('보수비' in line or '교부세' in line for line in front),
              f'D 계절 폭염 앞면 보수비·교부세 없음: {front}')
    card.scroll_into_view_if_needed()
    checks.shot(page, 'd-season-heat')
    overflow(checks, page, 'D 계절 폭염')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='tests/srv.py loopback 주소')
    args = parser.parse_args()
    checks = Checks(Path(os.environ.get('REV14B_CAP', 'tests/results/rev14b/')))
    try:
        base = local_address(['rev14b.py', args.address])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                cases = [(w, h, w == 390, 'C', lambda p, width=w: end_case(checks, p, base, width, width == 390))
                         for w, h in ((390, 844), (1024, 768), (1180, 820), (1280, 900))]
                cases += [(390, 844, True, 'G V4', lambda p: v4(checks, p, base)),
                          (390, 844, True, 'G V5/A3', lambda p: v5_and_w2(checks, p, base)),
                          (390, 844, True, 'D', lambda p: season_heat(checks, p, base))]
                for width, height, touch, label, run in cases:
                    label = f'{label} {width}x{height}'
                    context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
                    page, logs = monitored_page(context)
                    try:
                        attempt(checks, label, lambda: run(page))
                    finally:
                        diagnostics(checks, logs, label)
                        attempt(checks, label + ' 가로 넘침', lambda: overflow(checks, page, label))
                        checks.ok(not external, label + ' 외부 요청 0: ' + repr(external))
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'주소/브라우저 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
