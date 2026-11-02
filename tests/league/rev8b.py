"""명세 B 독립 수용 검사. 브라우저 실행은 샌드박스 밖 로컬 담당자가 한다.

  python3 tests/srv.py 9430 .
  tests/.venv/bin/python tests/league/rev8b.py http://127.0.0.1:9430/index.html

기본: 1280×900, 1024×768 터치, 390×844 터치 × 밝음/어두움.
진입·칸 조작은 HEAD의 ux_coach.py/ux_task.py 방식이며 앱 상태는 읽기만 한다.
기대값은 spec-B.md B1~B4/C-B1·3·4·5·6에서 정한다. 강제 클릭·단계 건너뛰기 없음.
필수 장면/조작을 만들지 못하면 BLOCKED도 failures에 포함한다.
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from econui import HIDDEN_JS, OVERFLOW_JS
from ux_coach import NEAR_TOWN_JS, STEP_JS
from ux_s2fix import reveal_tile
from ux_task import CFG, TILE_XY_JS


# 숨김은 폭 0으로 판정하지 않는다((비공개 개발 설정)).
VISIBLE_JS = "el => !(" + HIDDEN_JS + ")(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0"
TARGET_JS = """() => {
  const B=KCP.buildGame, f=B.planIssues().unlinked[0], t=f && B.nearestTown(f.i);
  return f && t ? {facility:{tile:f.i,name:f.name},town:t} : null;
}"""
RESULT_DONE_JS = """() => {
  const L=KCP.league.state(), S=L.S||L.snap, f=KCP.fxTurn?.state?.();
  // playing=false만으로 다음 틱의 재생 대기를 종료로 오인하지 않는다.
  return S && ['review','end'].includes(S.phase) && S.results?.length > 0 &&
    (!f || (!f.playing && (f.replayed || f.skipped || f.ms === 0)));
}"""
READY_GEOMETRY_JS = r"""() => {
  const e=document.querySelector('#lg-ready'), s=getComputedStyle(e), r=e.getBoundingClientRect();
  const rects=[];
  const walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
  while(walk.nextNode()) {
    const n=walk.currentNode;
    for(let i=0;i<n.length;i++) if(n.textContent[i].trim()) {
      const range=document.createRange(); range.setStart(n,i); range.setEnd(n,i+1);
      rects.push(...range.getClientRects());
    }
  }
  const rows=[];
  for(const q of rects) if(!rows.some(y=>Math.abs(y-q.top)<1)) rows.push(q.top);
  const textH=rects.length ?
    Math.max(...rects.map(q=>q.bottom))-Math.min(...rects.map(q=>q.top)) : 0;
  const specified=Number.parseFloat(s.lineHeight);
  const line=Number.isFinite(specified) ? specified : textH;
  const extras=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth']
    .reduce((v,k)=>v+Number.parseFloat(s[k]),0);
  return {text:e.textContent.trim(),lines:rows.length,height:r.height,line,textH,extras,
    nowrap:s.whiteSpace,wordBreak:s.wordBreak,client:e.clientWidth,scroll:e.scrollWidth};
}"""

# 표지 클래스 이름은 명세에 고정되지 않았다. 지도 이름표 영역에서 자료 이름과 정확히 같은
# 잎 요소를 찾되 기존 .bd-banner는 제외한다. 작업 중 UI의 함수/클래스를 복사하지 않는다.
MARKS_JS = r"""names => {
  const hidden=__HIDDEN__;
  return names.map(name=>[...document.querySelectorAll('#bd-banners *')].filter(e=>
    !e.closest('.bd-banner') && e.textContent.trim()===name &&
    ![...e.children].some(c=>c.textContent.trim()===name)).map(e=>{
      const r=e.getBoundingClientRect();
      return {name,hidden:hidden(e),w:r.width,h:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,
        pointer:getComputedStyle(e).pointerEvents};
    }));
}""".replace('__HIDDEN__', HIDDEN_JS)

MAP_GEOMETRY_JS = r"""target => {
  const B=KCP.buildGame, hidden=__HIDDEN__, ts=B.TILES;
  // tileXY의 화면 x는 세계 X/Y의 선형 투영이다. 독립된 세 칸으로 배율 S를 구하므로
  // V(비공개 상태), 투영 상수, 구현의 이름표 배치 함수를 읽을 필요가 없다.
  const a=ts[0], pa=B.tileXY(a.c,a.r); let scale=null;
  outer: for(const b of ts.slice(1)) for(const c of ts.slice(1)) {
    const dx=b.X-a.X,dy=b.Y-a.Y,ex=c.X-a.X,ey=c.Y-a.Y,det=dx*ey-dy*ex;
    if(Math.abs(det)<1e-6) continue;
    const pb=B.tileXY(b.c,b.r),pc=B.tileXY(c.c,c.r);
    const u=pb[0]-pa[0],v=pc[0]-pa[0];
    scale=Math.hypot((u*ey-v*dy)/det,(dx*v-ex*u)/det); break outer;
  }
  const boxes=[target.facility,target.town].map(item=>{
    const t=ts[item.tile],p=B.tileXY(t.c,t.r),half=scale*1.2/2;
    return {name:item.name,x:p[0],y:p[1],l:p[0]-half,r:p[0]+half,t:p[1]-half,b:p[1]+half};
  });
  const overlaps=[...document.querySelectorAll('#bd-banners .bd-banner')].filter(e=>{
    if(hidden(e)) return false;
    const r=e.getBoundingClientRect();
    return r.width>0 && r.height>0 && boxes.some(b=>r.left<b.r && r.right>b.l && r.top<b.b && r.bottom>b.t);
  }).map(e=>e.textContent.trim());
  return {scale,boxes,overlaps};
}""".replace('__HIDDEN__', HIDDEN_JS)


class Blocked(Exception):
    """필수 상태/조작을 만들지 못했다. 성공이나 SKIP으로 세지 않는다."""


class Checks:
    def __init__(self):
        self.rows = []

    def ok(self, condition, label, detail=None):
        row = {"pass": bool(condition), "label": label}
        if detail is not None:
            row['detail'] = detail
        self.rows.append(row)
        print(('PASS ' if condition else 'FAIL ') + label, flush=True)
        return bool(condition)

    def require(self, condition, label, detail=None):
        if not self.ok(condition, label, detail):
            raise Blocked(label)

    def blocked(self, label, exc):
        self.ok(False, f'BLOCKED {label}', f'{type(exc).__name__}: {exc}')


class Case:
    def __init__(self, page, checks, cfg, scheme, out):
        self.p, self.c, self.cfg, self.out = page, checks, cfg, out
        self.tag = f'{cfg}-{scheme}'
        self.touch = CFG[cfg].get('has_touch', False)
        self.names = []

    def check(self, condition, label, detail=None):
        return self.c.ok(condition, f'{self.tag} {label}', detail)

    def require(self, condition, label, detail=None):
        self.c.require(condition, f'{self.tag} {label}', detail)

    def visible(self, sel):
        return self.p.locator(sel).evaluate_all('nodes => nodes.some(' + VISIBLE_JS + ')')

    def hidden(self, sel):
        return self.p.locator(sel).evaluate_all('nodes => nodes.every(' + HIDDEN_JS + ')')

    def action_hidden(self):
        loc = self.p.locator('#lg-coach-action')
        return loc.count() == 1 and loc.evaluate('el => el.hidden') and self.hidden('#lg-coach-action')

    def overflow(self, label):
        if self.cfg == 'mobile':
            value = self.p.evaluate(OVERFLOW_JS)
            self.check(value <= 0, f'B3 390 가로 스크롤 0: {label}', value)

    def press(self, sel):
        loc = self.p.locator(sel).first
        loc.scroll_into_view_if_needed()
        (loc.tap if self.touch else loc.click)()
        self.p.wait_for_timeout(350)
        self.overflow(sel)

    def step(self, expected):
        self.p.wait_for_function('n => (' + STEP_JS + ')() === n', arg=expected, timeout=12000)
        text = self.p.locator('#lg-coach-task').inner_text()
        self.require(f' · {expected}/8 ' in text, f'B1 코치 {expected}/8 도달', text)
        self.overflow(f'{expected}/8')
        self.p.screenshot(path=str(self.out / f'{self.tag}-step{expected}.png'))

    def tile(self, i):
        reveal_tile(self.p, self.touch, i, lambda: self.overflow('지도 이동'))
        xy = self.p.evaluate(TILE_XY_JS, i)
        self.require(xy is not None, f'지도 칸 {i} 직접 조작 가능')
        (self.p.touchscreen.tap if self.touch else self.p.mouse.click)(*xy)
        self.p.wait_for_timeout(300)

    def ready_line(self):
        info = self.p.evaluate(READY_GEOMETRY_JS)
        # 글자 상자(content area)는 줄 높이보다 클 수 있다(1280 실측: 글자 상자 21px, line-height 18.2px).
        # 두 줄이면 높이가 줄 높이의 거의 두 배가 되므로 1.5배를 경계로 둔다.
        self.check(info['lines'] == 1 and 0 < info['textH'] <= info['line'] * 1.5,
                   'B3 주 단추 글자 한 줄·낱말 중간 줄바꿈 없음', info)
        # B3의 최소 높이/여백을 허용한다. 실제 글자 Range 줄 수도 별도로 검사해
        # 고정 높이에서 두 줄이 잘리는 결함이 통과하지 못하게 한다.
        self.check(info['height'] <= max(44, info['line'] + info['extras']) + 2 and
                   info['scroll'] <= info['client'] + 1,
                   'B3 주 단추 높이 한 줄 근처·글자 잘림 없음', info)
        self.check(info['nowrap'] == 'nowrap' and info['wordBreak'] == 'keep-all',
                   'B3 nowrap·keep-all', info)
        self.overflow('주 단추')

    def map_check(self, target):
        self.require(target is not None, 'B2 첫 미연결 설비·가장 가까운 마을 존재')
        names = [target['facility']['name'], target['town']['name']]
        self.names = list(dict.fromkeys([*self.names, *names]))
        keys = self.p.locator('.lg-map-keys')
        self.require(keys.count() > 0, 'B2 지도 범례 묶음 존재')
        self.check(self.hidden('.lg-map-keys'), 'B2 3/8 지도 범례 명시적 숨김')
        marks = self.p.evaluate(MARKS_JS, names)
        for name, found in zip(names, marks):
            shown = [m for m in found if not m['hidden'] and m['w'] > 0 and m['h'] > 0]
            self.check(len(shown) == 1, f'B2 자료 이름 코치 표지 한 개: {name}', found)
            if shown:
                m = shown[0]
                vp = CFG[self.cfg]['viewport']
                self.check(m['x'] >= 0 and m['y'] >= 0 and m['right'] <= vp['width'] and
                           m['bottom'] <= vp['height'], f'B2 {name} 표지 화면 안', m)
                self.check(m['pointer'] == 'none', f'B2 {name} 표지 클릭 통과', m)
        geometry = self.p.evaluate(MAP_GEOMETRY_JS, target)
        self.require(geometry['scale'] is not None and geometry['scale'] > 0,
                     'B2 칸 크기 측정 가능', geometry)
        self.check(not geometry['overlaps'], 'B2 두 대상 꼭대기 S×1.2 영역에 보이는 배너 겹침 0', geometry)
        self.overflow('송전 표지')

    def map_restored(self):
        # rev18 R5(개정 3): 자리 판단(DOM data-step 2·3) 외에는 닫힌 범례 단추를 숨긴다.
        # 내용이 모두 접혀 묶음 크기가 0이어도 3/8의 display:none 규칙은 풀려야 한다.
        folded = self.p.evaluate("""() => {
          const coach=document.querySelector('#lg-coach[data-step]');
          const info=document.querySelector('#lg-map-key-info');
          return innerWidth <= 1100 && document.querySelector('#bd-root')?.dataset.lgPhase === 'plan' &&
            !!coach && !['2','3'].includes(coach.dataset.step) &&
            !!info && !info.open && info.dataset.pinned !== 'true';
        }""") and self.visible('#lg-coach')
        if folded:
            restored = self.p.locator('.lg-map-keys').evaluate_all(
                "nodes => nodes.length > 0 && nodes.every(el => getComputedStyle(el).display !== 'none')"
            ) and not self.visible('#lg-map-key-info')
            label = 'B2 3/8 이후 범례 묶음 명시적 숨김 해제(3/8 숨김 규칙 풀림) 및 닫힌 범례 단추는 rev18 R5대로 숨김'
        else:
            restored = self.visible('.lg-map-keys') and not self.hidden('.lg-map-keys')
            label = 'B2 3/8 이후 지도 범례 복귀'
        self.check(restored, label)
        marks = self.p.evaluate(MARKS_JS, self.names)
        self.check(all(not group or all(m['hidden'] for m in group) for group in marks),
                   'B2 3/8 이후 코치 표지 제거/숨김', marks)

    def run(self, base, city):
        p = self.p
        p.goto(base.rstrip('#') + '#league')
        p.wait_for_selector(".lg-modes [data-mode='solo']")
        if p.locator(".lg-modes [data-mode='solo']").get_attribute('aria-pressed') != 'true':
            self.press(".lg-modes [data-mode='solo']")
        if city:
            p.locator('#lg-solo-city').select_option(city)
        self.press('#lg-solo-start')
        p.wait_for_selector('#lg-coach', timeout=60000)
        self.step(1)
        self.ready_line()
        # B4: 학생이 코치 행동으로 연 서랍 제목까지 확인한다.
        self.check(p.locator('#lg-bar [data-panel="deal"]').inner_text().strip() == '사건·거래',
                   'B4 아래 막대 사건·거래')
        self.press('#lg-coach-action')
        p.wait_for_selector('#lg-panel .lg-ptabs strong')
        self.check(p.locator('#lg-panel .lg-ptabs strong').inner_text() == '사건·거래',
                   'B4 서랍 제목 사건·거래')
        self.step(2)
        self.press('#lg-coach-action')
        if self.visible('[data-tool="diesel"]'):
            self.press('[data-tool="diesel"]')
        kind = p.locator('#bd-root').get_attribute('data-mode')
        self.require(bool(kind), '코치가 가리킨 건설 도구 선택')
        before = p.evaluate('() => KCP.buildGame.current().builds.length')
        for i in p.evaluate(NEAR_TOWN_JS, kind):
            self.tile(i)
            if self.touch and p.evaluate('() => KCP.buildGame.current().builds.length') == before:
                self.tile(i)
            if self.visible('#bd-cf-ok'):
                self.press('#bd-cf-ok')
            if p.evaluate('() => KCP.buildGame.current().builds.length') > before:
                break
        self.require(p.evaluate('() => KCP.buildGame.current().builds.length') == before + 1,
                     '학생 지도 조작으로 설비 한 기 설치')
        self.step(3)
        self.press('#lg-coach-action')
        # 기존 설비도 이어야 할 수 있다. 매번 공개 자료에서 첫 대상을 다시 읽는다.
        for _ in range(12):
            if p.evaluate(STEP_JS) != 3:
                break
            target = p.evaluate(TARGET_JS)
            if target is None:
                break
            self.map_check(target)
            self.tile(target['facility']['tile'])
            # 시작점 선택으로 자동 이동한 뒤에도 표지·배너 배치가 따라야 한다.
            self.map_check(target)
            self.tile(target['town']['tile'])
            self.require(self.visible('#bd-cf-ok'), '송전 두 끝점 뒤 연결 확인 단추')
            self.press('#bd-cf-ok')
            p.wait_for_timeout(700)
        self.step(4)
        self.map_restored()
        self.press('#lg-coach-action')
        p.wait_for_selector('#bd-skip, #bd-again', timeout=90000)
        if self.visible('#bd-skip'):
            self.press('#bd-skip')
        p.wait_for_selector('#bd-again', timeout=90000)
        self.step(5)
        self.require(p.locator('#lg-ready').is_enabled(), 'B3 5/8 처음 주 단추 켜짐')
        self.check(self.action_hidden(), 'B3 5/8 켜진 주 단추와 중복 코치 단추 hidden')
        self.check('lg-coach-target' in (p.locator('#lg-ready').get_attribute('class') or '').split(),
                   'B3 5/8 주 단추 강조 유지')
        self.press('#lg-ready')
        if self.visible('#lg-issue-check'):
            self.press('#lg-issue-go')
        p.wait_for_selector('#lg-ready-confirm')
        self.require(p.locator('#lg-ready').is_disabled(), 'B3 약속 미완성 주 단추 꺼짐')
        self.check(self.visible('#lg-coach-action') and
                   p.locator('#lg-coach-action').inner_text() == '남은 칸 채우기',
                   'B3 5/8 미완성 코치 단추 남은 칸 채우기')
        self.ready_line()
        self.check(p.locator('#lg-ready').inner_text() == '약속하고 준비', 'B3 주 단추 약속하고 준비 문구')
        self.press('#lg-coach-action')
        evidence = p.locator('#lg-predict [data-evidence]:enabled').first
        self.require(evidence.count() > 0, '약속 근거 선택 가능')
        self.press('#lg-predict [data-evidence]:enabled')
        pred = p.locator('#lg-predict [data-pred]')
        values = pred.locator('option').evaluate_all('ns => ns.filter(n=>n.value && !n.disabled).map(n=>n.value)')
        self.require(bool(values), '약속 방향 선택 가능')
        pred.select_option(values[0])
        self.press('#lg-predict [data-confidence="fairly"]')
        self.require(p.locator('#lg-ready').is_enabled(), 'B3 약속 완성 주 단추 켜짐')
        self.check(self.action_hidden(), 'B3 5/8 약속 완성 뒤 중복 코치 단추 hidden')
        self.ready_line()
        self.press('#lg-ready')
        p.wait_for_function(RESULT_DONE_JS, timeout=180000)
        self.step(6)
        self.check('운영 끝 · 결과 맨 위에서 내 예측과 실제를 비교해요' in
                   p.locator('#lg-coach-task').inner_text(), 'B1 C-B1 결과 맨 위 비교 안내')
        samples = p.evaluate("""async () => {
          const values=[], until=performance.now()+3000;
          do { values.push(Number(document.querySelector('#lg-coach')?.dataset.step || 0));
            await new Promise(r=>setTimeout(r,100)); } while(performance.now()<until);
          values.push(Number(document.querySelector('#lg-coach')?.dataset.step || 0)); return values;
        }""")
        self.require(all(n == 6 for n in samples), 'B1 결과 뒤 무조작 3초 동안 6/8 유지', samples)
        self.press('#lg-coach-action')
        self.step(7)
        p.wait_for_timeout(3000)
        self.require(p.evaluate(STEP_JS) == 7, 'B1 7/8도 무조작 자동 전진 없음')
        no_card = p.locator('#lg-missed[data-opened]').count() == 0 or \
            p.locator('#lg-missed[data-single="true"]').count() > 0
        task = p.locator('#lg-coach-task').inner_text()
        action = p.locator('#lg-coach-action').inner_text()
        if no_card:
            self.check('이번 달은 고를 원인 카드가 없어요 · 확인하고 넘어가요' in task,
                       'B1 C-B4 카드 없음/고르기 생략 안내', task)
            self.check(action == '확인하고 다음', 'B1 C-B5 확인하고 다음', action)
        else:
            self.check('이번 달 변화의 원인 하나를 골라 열어 봐요' in task, 'B1 C-B3 원인 안내', task)
            self.check(action == '원인 열기', 'B1 카드 있음 원인 열기', action)
            self.require(p.locator('#lg-missed').get_attribute('data-opened') == 'false',
                         'B1 7/8 진입 때 원인 카드 미개봉')
            self.require(p.locator('#lg-outage-cards [data-missed]').count() > 0,
                         'B1 학생이 고를 원인 카드 존재')
            self.press('#lg-outage-cards [data-missed]')
        self.press('#lg-coach-action')
        self.step(8)
        if not no_card:
            self.check(p.locator('#lg-missed').get_attribute('data-opened') == 'true',
                       'B1 7/8 코치 행동으로 원인 실제 열림')
        self.press('#lg-coach-action')  # 코치가 가리킨 이유 입력란으로 이동
        if self.visible('[data-compared]') and not p.locator('[data-compared]').is_checked():
            self.press('[data-compared]')
        self.press('[data-answer="keep"]')
        field = p.locator('[data-note="askReason"]')
        field.fill('시험과 실제 결과를 비교해서 다음 달에도 확인하겠다')
        field.press('Tab')
        p.wait_for_timeout(700)
        self.require(p.locator('#lg-ready').inner_text() == '다음 달' and
                     p.locator('#lg-ready').is_enabled(), 'B3 8/8 다음 달 주 단추 켜짐')
        self.check(self.action_hidden(), 'B3 8/8 다음 달 중복 코치 단추 hidden')
        self.check('lg-coach-target' in (p.locator('#lg-ready').get_attribute('class') or '').split(),
                   'B3 8/8 주 단추 강조 유지')
        self.ready_line()
        p.screenshot(path=str(self.out / f'{self.tag}-next-month.png'))
        self.press('#lg-ready')
        p.wait_for_function("() => {const L=KCP.league.state(),S=L.S||L.snap; return S.round===2 && S.phase==='plan';}",
                            timeout=120000)
        self.check(True, 'B1 코치만 따라 첫 달 완료·다음 달 계획 도달')
        self.overflow('다음 달')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('base')
    ap.add_argument('--cfg', choices=['all', *CFG], default='all')
    ap.add_argument('--scheme', choices=['all', 'light', 'dark'], default='all')
    ap.add_argument('--city', default=None)
    ap.add_argument('--out', default='tests/results/rev8b')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    checks = Checks()
    configs = list(CFG) if args.cfg == 'all' else [args.cfg]
    schemes = ['light', 'dark'] if args.scheme == 'all' else [args.scheme]
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for cfg in configs:
                    for scheme in schemes:
                        events = {k: [] for k in ('error', 'warning', 'pageerror')}
                        with browser.new_context(**CFG[cfg], color_scheme=scheme, locale='ko-KR') as ctx:
                            page = ctx.new_page()
                            page.set_default_timeout(15000)
                            page.on('console', lambda m: events[m.type].append(m.text)
                                    if m.type in ('error', 'warning') else None)
                            page.on('pageerror', lambda e: events['pageerror'].append(str(e)))
                            page.on('dialog', lambda d: d.accept())
                            case = Case(page, checks, cfg, scheme, out)
                            try:
                                case.run(args.base, args.city)
                            except Exception as exc:
                                checks.blocked(case.tag, exc)
                                try:
                                    page.screenshot(path=str(out / f'{case.tag}-BLOCKED.png'))
                                except Exception as shot_error:
                                    checks.blocked(case.tag + ' 실패 캡처', shot_error)
                            finally:
                                for kind, entries in events.items():
                                    case.check(not entries, f'{kind} 0', entries)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked('브라우저/검사 실행 환경', exc)
    failures = sum(not r['pass'] for r in checks.rows)
    (out / 'rev8b.json').write_text(json.dumps({'assertions': len(checks.rows), 'failures': failures,
                                             'checks': checks.rows}, ensure_ascii=False, indent=2))
    print(f'assertions {len(checks.rows)} failures {failures}', flush=True)
    raise SystemExit(1 if failures else 0)


if __name__ == '__main__':
    main()
