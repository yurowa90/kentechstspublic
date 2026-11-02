"""품질 8 UX 묶음 1: 구현 소스를 읽지 않고 M1~M5 명세로 작성한 검사.

저장소 루트, 샌드박스 밖 로컬에서 실행:
  tests/.venv/bin/python tests/league/ux_s2fix.py <주소> [--cfg desktop|tablet|mobile|all]

CFG와 지도 후보 계산의 공개 API 사용법만 기존 UX 검사에서 가져왔다.
KCP 상태는 읽기만 하며 진행은 화면 조작으로 한다. 결과/검사 설명은 tests/results/.
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

from ux_task import CFG, TILE_XY_JS


RESULTS = Path(__file__).resolve().parents[1] / "results"
GOLD = (236, 208, 131)
PREFIX = "자리 판단 · 3/8 "

# 화면에 보이는 육지 칸 전부를 표본으로 삼는다. 이웃 자체는 화면 밖이어도 거리 계산에 포함한다.
# B.tileXY는 화면 좌표이며 이웃 관계는 자료 T.nb를 사용한다. 확대 상태/내부 배율은 읽지 않는다.
SPACING_JS = """() => {
  const B=KCP.buildGame, samples=[];
  for(const T of B.TILES) {
    if(T.out) continue;
    const p=B.tileXY(T.c,T.r);
    if(!p || p[0]<0 || p[0]>=innerWidth || p[1]<0 || p[1]>=innerHeight ||
      document.elementFromPoint(...p)?.tagName!=='CANVAS') continue;
    const ds=T.nb.map(i=>B.TILES[i]).filter(Boolean).map(t=>B.tileXY(t.c,t.r))
      .filter(Boolean).map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]));
    if(ds.length) samples.push({i:T.i,min:Math.min(...ds)});
  }
  return {count:samples.length,min:samples.length?Math.min(...samples.map(s=>s.min)):null,
    samples:samples.slice(0,12)};
}"""

COACH_JS = """() => {
  const B=KCP.buildGame, issues=B.planIssues(), b=issues.unlinked[0];
  const coach=document.querySelector('#lg-coach');
  const result={step:Number(coach?.dataset.step || 0),
    task:document.querySelector('#lg-coach-task')?.textContent || '',
    count:issues.unlinked.length,waiting:issues.waiting.length};
  if(!b) return result;
  const T=B.TILES[b.i], q=t=>t.c-(t.r-(t.r&1))/2;
  // M2: odd-r → axial. 이름이 비슷한 수요지/동률도 거리, tile 번호로 독립 판정한다.
  const distance=t=>Math.max(Math.abs(q(t)-q(T)),Math.abs(t.r-T.r),
    Math.abs(q(t)-q(T)+t.r-T.r));
  const towns=B.SITES.filter(s=>s.dem).slice().sort((a,z)=>
    distance(B.TILES[a.tile])-distance(B.TILES[z.tile]) || a.tile-z.tile);
  const town=towns[0];
  return {...result,i:b.i,name:b.name,existing:!B.current().builds.some(x=>x.i===b.i),
    town:town?.name,townTile:town?.tile,distance:town?distance(B.TILES[town.tile]):null};
}"""

# NEAR_TOWN_JS와 같은 빈 육지/siteRule/화면 가림 필터. 이미 전선이 있는 칸은 제외하여
# M1의 '디젤을 놓은 뒤 미연결 대상'과 M2의 학생 설비 분기를 실제로 만든다.
CANDIDATES_JS = """() => {
  const B=KCP.buildGame, st=B.current(), used=new Set(st.builds.map(b=>b.i));
  const wired=new Set(st.lines.flatMap(l=>l.p)), towns=B.SITES.filter(s=>s.dem).map(s=>B.TILES[s.tile]);
  const d=t=>Math.min(...towns.map(w=>Math.hypot(w.X-t.X,w.Y-t.Y)));
  return B.TILES.filter(t=>!t.out && t.site<0 && !used.has(t.i) && !wired.has(t.i) &&
    B.siteRule('diesel',t)==='' && (()=>{const p=B.tileXY(t.c,t.r);
      return p && p[0]>=0 && p[0]<innerWidth && p[1]>=0 && p[1]<innerHeight &&
        document.elementFromPoint(...p)?.tagName==='CANVAS';})())
    .sort((a,b)=>d(a)-d(b)||a.i-b.i).map(t=>t.i);
}"""

BUTTON_JS = """el => {
  const r=el.getBoundingClientRect(), s=getComputedStyle(el);
  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return {text:el.textContent.trim(),disabled:el.disabled,bg:s.backgroundColor,
    inView:r.width>0 && r.height>0 && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight,
    clear:!!hit && (hit===el || el.contains(hit)),rect:{x:r.x,y:r.y,w:r.width,h:r.height}};
}"""

MAP_BOX_JS = """() => {
  // '지도 보이는 영역'은 CANVAS가 최상단인 화면 지점들의 경계 상자로 정의한다.
  // 전체 8px 격자로 찾고 표본 주변을 1px로 재탐색하여 UI 띠/서랍을 제외한다.
  let left=innerWidth,top=innerHeight,right=-1,bottom=-1;
  const hit=(x,y)=>document.elementFromPoint(x,y)?.tagName==='CANVAS';
  for(let y=0;y<innerHeight;y+=8) for(let x=0;x<innerWidth;x+=8) if(hit(x,y)) {
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<0) return null;
  const coarse={left,top,right,bottom};
  for(let y=0;y<innerHeight;y+=8) {
    for(let x=Math.max(0,coarse.left-8);x<coarse.left;x++) if(hit(x,y)) left=Math.min(left,x);
    for(let x=coarse.right+1;x<=Math.min(innerWidth-1,coarse.right+8);x++) if(hit(x,y)) right=Math.max(right,x);
  }
  for(let x=0;x<innerWidth;x+=8) {
    for(let y=Math.max(0,coarse.top-8);y<coarse.top;y++) if(hit(x,y)) top=Math.min(top,y);
    for(let y=coarse.bottom+1;y<=Math.min(innerHeight-1,coarse.bottom+8);y++) if(hit(x,y)) bottom=Math.max(bottom,y);
  }
  return {left,top,right,bottom};
}"""

ARM_JS = """([selector,event]) => {
  const target=document.querySelector(selector), predicate=__PREDICATE__;
  if(!target) throw Error('시간 계측 대상 없음: '+selector);
  const rec={started:false,done:false};window.__uxS2fixTiming=rec;
  target.addEventListener(event,()=>{
    rec.started=true;const start=performance.now();
    const sample=()=>{
      const elapsed=performance.now()-start;
      try {
        const value=predicate();
        if(value) {Object.assign(rec,{done:true,elapsed,value});return;}
      } catch(e) {Object.assign(rec,{done:true,error:String(e)});return;}
      if(elapsed>=400) {Object.assign(rec,{done:true,elapsed,value:false});return;}
      setTimeout(sample,8);
    };
    // capture 리스너 뒤 실제 앱 핸들러가 끝난 시점부터 관찰한다.
    queueMicrotask(sample);
  },{capture:true,once:true});
}"""

REPORT = """# 품질 8 UX 결함 묶음 1 검사

기대값의 근거는 사용자 M1~M5 명세다. 구현 파일은 읽지 않았다.
실행: `tests/.venv/bin/python tests/league/ux_s2fix.py <주소> [--cfg desktop|tablet|mobile|all]`.
기본은 all이며 환경은 ux_task.CFG 그대로다. 브라우저 실행은 샌드박스 밖 로컬의 총괄 담당이다.

- M1: 보이는 육지 칸의 모든 T.nb 화면 거리 중 최솟값을 잰다. 최소 3개 표본을 요구한다.
  터치 도구 선택 이벤트부터 400ms 안에 44px 이상, 마우스는 선택 전후 ±0.5px.
  디젤 첫/둘째 탭의 설비 수, 송전선 선택 뒤 대상 가림, 확대 비감소/축소 감소를 확인한다.
- M2: planIssues의 첫 미연결 설비 이름/기존 여부와 odd-r→axial 헥스 거리로 고른 마을 이름을
  정확히 비교한다. 동률은 tile 번호 순서다. 시작 전/시작점/확인 막대 문구와 꼬리 순서도 비교한다.
  송전선 행동 단추의 도구/대상 가림, 터치의 마을 노출 또는 대상의 지도 중앙 1/2 배치를 확인한다.
  지도를 드래그해야 하는 끝점은 실제 좌표로 옮긴 뒤 누르며 횟수를 JSON의 pans로 남긴다.
- M3: S1 선택/미선택을 새 컨텍스트로 분리한다. 각 칩의 aria-pressed, 선택 변경 뒤 원래 칩의
  'S1에서 고름' 유지, 남은 단계의 정확한 글자를 비교한다.
- M4: 준비 전/미완성 약속/완성 약속/닫힘/결과 상태의 주 단추를 확인한다. 금색 RGB ±3,
  주 단추 화면 노출/중심 가림, 보조 단추 비금색, 시험 단추의 sRGB 상대 휘도를 비교한다.
  확신→근거→방향 순서로 채워 select change 뒤 400ms 안 활성과 주 단추를 통한 결과 +1을 본다.
  결과 대기는 최대 180초다. 미완성 서랍을 닫고 주 단추로 다시 여는 경로도 별도 판에서 본다.
- M5: 화력 펼침 전후의 보이는 data-tool 차집합을 도구 범위로 삼는다. '정격 숫자 MW'가 있는
  모든 숫자의 소수는 최대 1자리, mobile은 단추 내부 넘침 1px 이하/쌍별 교차 면적 0을 비교한다.
- 매 단언 PASS/FAIL, 콘솔 error/warning·pageerror 각각 FAIL, 각 조작 뒤 가로 스크롤을 확인한다.
  예외도 FAIL이며 하나라도 있으면 종료 코드 1이다. 마지막 출력은 PASS n / FAIL m이다.

모호한 부분/관찰 한계:
- 마을 이름은 느슨하게 두지 않았다. 지도 중앙 영역은 elementFromPoint의 CANVAS 노출 영역
  경계 상자로 해석했다(8px 격자 + 가장자리 1px 재탐색; 8px 미만의 고립된 틈은 표본에서 빠질 수 있다).
- 실제 UI 조작으로 도달한 M2 분기만 실행한다. 기존/학생 대상, 2기 이상, 대기 꼬리, 미연결 0기
  분기의 관찰 여부를 JSON coverage와 아래 실행 기록에 명시한다. 코치가 즉시 다음 단계로
  넘어가 보이지 않은 0기 문구를 통과로 세지 않으며, 상태를 조작해 억지로 노출하지 않는다.
- 정격 표시가 없는 도구에는 M5 소수 단언을 적용하지 않는다(명세의 '있으면' 조건).
- 이 파일 작성 세션에서는 브라우저를 실행하지 않는다. 문법 확인과 실제 UI 통과는 별개다.

"""


def color(value):
    parts = [float(x) for x in re.findall(r"[\d.]+", value)]
    if len(parts) < 3:
        raise ValueError(f"RGB 배경색을 읽을 수 없음: {value}")
    return parts[:3], parts[3] if len(parts) > 3 else 1


def gold(value):
    rgb, _ = color(value)
    return all(abs(a - b) <= 3 for a, b in zip(rgb, GOLD))


def luminance(value):
    rgb, _ = color(value)
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in (c / 255 for c in rgb)]
    return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))


def coach_text(info, mode="initial"):
    if not info["count"]:
        return PREFIX + f'마을까지 이어요 · 미연결 0기 · 대기 {info["waiting"]}기'
    name, town = info["name"], info["town"]
    if not name or not town:
        raise AssertionError("M2 설비/수요지의 공개 이름 없음")
    if mode == "confirm":
        text = "칸 수·비용 막대의 '연결'을 누르세요"
    elif mode == "start":
        text = f"이제 {town} 칸을 누르고 뜨는 막대의 '연결'을 누르세요"
    elif info["existing"]:
        # rev11 R3 / REV11_COPY.C3: 이유·조작 순서·마침표까지 표의 글자 그대로.
        text = f"기존 {name}도 전선에 안 닿으면 운영에서 못 써요. {name} 칸, {town} 칸을 차례로 누르고 '연결'을 눌러야 넘어가요."
    else:
        text = f"{name} 칸, {town} 칸을 차례로 누르고 '연결'을 누르세요"
    if info["count"] >= 2:
        text += f' · 전선 미연결 {info["count"]}기'
    if info["waiting"]:
        text += f' · 대기 {info["waiting"]}기'
    return PREFIX + text


def reveal_tile(page, touch, i, on_pan):
    """가려진 끝점을 지도 드래그로 노출한다. ux_coach의 3단계도 같은 화면 조작을 쓴다."""
    for _ in range(8):
        if page.evaluate(TILE_XY_JS, i) is not None:
            return
        drag = page.evaluate("""i => {
          const B=KCP.buildGame,T=B.TILES[i],p=B.tileXY(T.c,T.r);
          let best=null;
          for(let y=innerHeight*.3;y<innerHeight*.75;y+=20)
            for(let x=innerWidth*.2;x<innerWidth*.8;x+=20) {
              const e=document.elementFromPoint(x,y);
              if(e?.tagName==='CANVAS' && (!best || Math.hypot(x-innerWidth/2,y-innerHeight/2)<best.d))
                best={x,y,d:Math.hypot(x-innerWidth/2,y-innerHeight/2)};
            }
          if(!best || !p) return null;
          return {x:best.x,y:best.y,dx:Math.max(-innerWidth*.3,Math.min(innerWidth*.3,best.x-p[0])),
            dy:Math.max(-innerHeight*.25,Math.min(innerHeight*.25,best.y-p[1]))};
        }""", i)
        if drag is None:
            raise AssertionError("끝점 이동용 지도 드래그 시작점 없음")
        if touch:
            # touchscreen에는 끌기 API가 없다. 마우스 이벤트로 바꾸지 않고 touch pointer를 보낸다.
            page.evaluate("""async d => {
              const el=document.elementFromPoint(d.x,d.y),id=79;
              const send=(type,x,y,buttons)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,
                cancelable:true,pointerId:id,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,
                button:0,buttons}));
              send('pointerdown',d.x,d.y,1);
              for(let j=1;j<=12;j++) {
                send('pointermove',d.x+d.dx*j/12,d.y+d.dy*j/12,1);
                await new Promise(requestAnimationFrame);
              }
              send('pointerup',d.x+d.dx,d.y+d.dy,0);
            }""", drag)
        else:
            page.mouse.move(drag["x"], drag["y"])
            page.mouse.down()
            page.mouse.move(drag["x"] + drag["dx"], drag["y"] + drag["dy"], steps=12)
            page.mouse.up()
        on_pan()
        page.wait_for_timeout(120)
    if page.evaluate(TILE_XY_JS, i) is None:
        raise AssertionError(f"끝점 {i}: 드래그 8회 뒤에도 노출 실패")


class NoS1(Exception):
    pass


class StopCase(Exception):
    """실패로 기록한 전제가 없으면 해당 시나리오의 종속 조작만 중단한다."""


class Suite:
    def __init__(self, cfg):
        self.cfg = cfg
        self.rows, self.cases, self.events = [], [], []
        self.coverage = {key: False for key in ("student", "existing", "start", "confirm", "multiple", "waiting", "zero")}

    def check(self, condition, label, detail=None):
        row = {"pass": bool(condition), "label": f"{self.cfg} {label}"}
        if detail is not None:
            row["detail"] = detail
        self.rows.append(row)
        print(f'{"PASS" if row["pass"] else "FAIL"} {row["label"]}', flush=True)
        if not condition and detail is not None:
            print("  " + json.dumps(detail, ensure_ascii=False), flush=True)
        return bool(condition)

    def require(self, condition, label, detail=None):
        if not self.check(condition, label, detail):
            raise StopCase(label)

    def event(self, case, kind, message):
        self.events.append({"case": case, "kind": kind, "message": str(message)})
        self.check(False, f"{case} {kind}", str(message))

    def run(self, browser, base, name, function):
        for attempt in range(8):
            mark = len(self.rows)
            try:
                return self.run_once(browser, base, name, function)
            except NoS1:
                # 근거 카드가 없는 판에서 남긴 준비 단언은 버리고 새 판으로 다시 한다.
                del self.rows[mark:]
                self.cases.pop()
        self.check(False, f"{name} S1 근거 카드가 있는 판을 8판 안에 못 만남")

    def run_once(self, browser, base, name, function):
        ctx = page = run = None
        rec = {"name": name, "pans": 0}
        self.cases.append(rec)
        try:
            ctx = browser.new_context(**CFG[self.cfg], color_scheme="light", locale="ko-KR")
            page = ctx.new_page()
            page.set_default_timeout(15000)
            page.on("console", lambda msg: self.event(name, msg.type, msg.text)
                    if msg.type in ("error", "warning") else None)
            page.on("pageerror", lambda exc: self.event(name, "pageerror", exc))
            page.on("dialog", lambda dialog: dialog.accept())
            run = Case(self, page, rec)
            page.goto(base.split("#", 1)[0] + "#league")
            page.wait_for_selector(".lg-modes [data-mode='solo']")
            page.wait_for_timeout(800)
            run.press(".lg-modes [data-mode='solo']")
            run.press("#lg-solo-start")
            page.wait_for_selector("#lg-coach", timeout=60000)
            page.wait_for_timeout(1200)
            run.overflow("혼자 하기 시작")
            function(run)
        except NoS1:
            raise
        except StopCase as exc:
            rec["stopped"] = str(exc)
        except Exception as exc:
            rec["exception"] = f"{type(exc).__name__}: {exc}"
            self.check(False, f"{name} 예외", rec["exception"])
        finally:
            if ctx is not None:
                try:
                    if page is not None and run is not None and not page.is_closed():
                        run.overflow("시나리오 끝")
                except Exception as exc:
                    self.check(False, f"{name} 종료 검사 예외", str(exc))
                try:
                    ctx.close()
                except Exception as exc:
                    self.check(False, f"{name} 컨텍스트 종료 예외", str(exc))

    def summary(self):
        passed = sum(row["pass"] for row in self.rows)
        return {"cfg": self.cfg, "pass": passed, "fail": len(self.rows) - passed,
                "pans": sum(case["pans"] for case in self.cases), "coverage": self.coverage,
                "assertions": self.rows, "events": self.events, "cases": self.cases}


class Case:
    def __init__(self, suite, page, record):
        self.s, self.p, self.rec = suite, page, record
        self.touch = CFG[suite.cfg].get("has_touch", False)

    def check(self, condition, label, detail=None):
        return self.s.check(condition, f'{self.rec["name"]} {label}', detail)

    def require(self, condition, label, detail=None):
        if not self.check(condition, label, detail):
            raise StopCase(label)

    def overflow(self, label):
        size = self.p.evaluate("() => ({scroll:document.documentElement.scrollWidth,width:innerWidth})")
        self.check(size["scroll"] <= size["width"] + 1, f"가로 스크롤 0: {label}", size)

    def shown(self, selector):
        loc = self.p.locator(selector).first
        return loc.count() > 0 and loc.is_visible()

    def press(self, selector, pause=120):
        loc = self.p.locator(selector).first
        loc.scroll_into_view_if_needed()
        (loc.tap if self.touch else loc.click)()
        if pause:
            self.p.wait_for_timeout(pause)
        self.overflow(selector)

    def close_drawer(self):
        if self.shown("#lg-panel .lg-px"):
            self.press("#lg-panel .lg-px")
            self.p.wait_for_selector("#lg-panel", state="hidden")

    def tool(self, group, kind):
        if not self.shown(f'[data-tool="{kind}"]'):
            self.press(f'[data-group="{group}"]')
        # 이미 고른 도구를 다시 누르면 도구가 풀린다(setTool 토글). 고른 상태면 누르지 않는다.
        if self.p.locator(f'[data-tool="{kind}"]').first.get_attribute("aria-pressed") != "true":
            self.press(f'[data-tool="{kind}"]')

    def timed(self, selector, predicate, action=None, event="click"):
        self.p.locator(selector).first.scroll_into_view_if_needed()
        self.p.evaluate(ARM_JS.replace("__PREDICATE__", predicate), [selector, event])
        if action is None:
            self.press(selector, pause=0)
        else:
            action()
        self.p.wait_for_function("() => window.__uxS2fixTiming?.done", timeout=3000)
        timing = self.p.evaluate("() => window.__uxS2fixTiming")
        self.rec.setdefault("timings", []).append({"selector": selector, **timing})
        self.overflow(f"400ms 계측 {selector}")
        return bool(timing.get("value")) and timing.get("elapsed", 401) <= 400, timing

    def spacing(self, label):
        value = self.p.evaluate(SPACING_JS)
        self.require(value["count"] >= 3 and value["min"] is not None,
                     f"{label}: 보이는 육지 표본 3개 이상", value)
        self.rec.setdefault("spacing", []).append({"label": label, **value})
        return value["min"]

    def tile(self, i, pan=False):
        if pan:
            self.reveal(i)
        xy = self.p.evaluate(TILE_XY_JS, i)
        self.require(xy is not None, f"칸 {i} 화면 안 CANVAS", xy)
        (self.p.touchscreen.tap if self.touch else self.p.mouse.click)(*xy)
        self.p.wait_for_timeout(160)
        self.overflow(f"칸 {i}")

    def reveal(self, i):
        # 확대/축소 API나 상태를 고치지 않는다. 실제 지도 영역에서 포인터 드래그만 한다.
        def count():
            self.rec["pans"] += 1
        reveal_tile(self.p, self.touch, i, count)

    def install(self):
        before = self.p.evaluate("() => KCP.buildGame.current().builds.length")
        candidates = self.p.evaluate(CANDIDATES_JS)
        self.require(bool(candidates), "지을 수 있는 빈 육지 후보 존재")
        i = candidates[0]
        self.tile(i)
        if self.touch:
            self.check(self.p.evaluate("() => KCP.buildGame.current().builds.length") == before,
                       "디젤 첫 탭은 미리보기")
            self.tile(i)
        elif self.shown("#bd-cf-ok"):
            self.press("#bd-cf-ok")
        self.p.wait_for_timeout(200)
        after = self.p.evaluate("() => KCP.buildGame.current().builds.length")
        self.require(after == before + 1, "디젤 실제 설치 +1", {"before": before, "after": after, "i": i})
        return i

    def pick_s1(self):
        # 판마다 방 코드 소금이 달라 1월에 대응할 사건이 있으면 S1 근거 카드가 없다(사건 대응 달).
        # 그런 판이면 NoS1을 던져 Suite.run이 새 컨텍스트(새 판)로 다시 시작한다(검사 준비, 최대 8판).
        cards = self.p.locator("#lg-evidence-focus [data-s1-pick]")
        self.press('#lg-bar [data-panel="deal"]')
        try:
            cards.first.wait_for(state="visible", timeout=4000)
        except Exception:
            raise NoS1()
        cards.first.wait_for(state="visible")
        key = cards.first.get_attribute("data-s1-pick")
        self.require(bool(key), "S1 근거 카드 키 존재")
        self.press("#lg-evidence-focus [data-s1-pick]")
        self.rec["s1Key"] = key
        # 코치 1단계는 0.5초 주기 확인 때 사건 서랍이 열려 있어야 넘어간다. 닫기 전에 그 확인을 기다린다.
        self.p.wait_for_function("() => !document.querySelector('#lg-coach') || Number(document.querySelector('#lg-coach').dataset.step) >= 2", timeout=5000)
        self.close_drawer()
        return key

    def open_promise(self):
        self.press("#lg-ready")
        self.p.wait_for_function("""() => ['#lg-predict','#lg-issue-check'].some(sel=>{
          const e=document.querySelector(sel);return e && e.getBoundingClientRect().width>0 &&
            getComputedStyle(e).visibility!=='hidden';})""")
        if self.shown("#lg-issue-check"):
            self.press("#lg-issue-go")
        self.p.wait_for_selector("#lg-predict", state="visible")
        self.p.wait_for_timeout(250)
        self.overflow("약속 서랍 열림")

    def chips(self):
        return self.p.locator("#lg-evidence [data-evidence]").evaluate_all("""nodes=>nodes.map(e=>({
          key:e.dataset.evidence,pressed:e.getAttribute('aria-pressed'),text:e.textContent}))""")

    def chip_selector(self, key):
        return f'#lg-evidence [data-evidence={json.dumps(key)}]'

    def button(self, selector):
        return self.p.locator(selector).first.evaluate(BUTTON_JS)

    def trial_weaker(self, phase):
        ready, trial = self.button("#lg-ready"), self.button('[data-run="7"]')
        self.check(not gold(trial["bg"]), f"{phase} 시험 단추 비금색", trial)
        self.check(luminance(trial["bg"]) < luminance(ready["bg"]),
                   f"{phase} 시험 배경 상대 휘도 < 주 행동", {"ready": ready["bg"], "trial": trial["bg"]})

    def incomplete(self):
        primary, secondary = self.button("#lg-ready"), self.button("#lg-ready-confirm")
        self.check(primary["text"] == "약속하고 준비", "미완성 주 행동 글자", primary)
        self.check(primary["disabled"], "미완성 주 행동 비활성", primary)
        self.check(gold(primary["bg"]), "미완성 주 행동 금색 RGB ±3", primary)
        self.check(primary["inView"] and primary["clear"], "미완성 주 행동 화면 안/가림 없음", primary)
        self.check(secondary["text"] == "약속하고 준비" and secondary["disabled"],
                   "서랍 아래 보조 단추 글자/비활성", secondary)
        self.check(color(secondary["bg"])[1] == 0 or not gold(secondary["bg"]),
                   "보조 단추 투명 또는 비금색", secondary)


def map_case(r):
    r.close_drawer()
    r.spacing("건설 도구 전")
    if not r.shown('[data-tool="diesel"]'):
        r.press('[data-group="fire"]')
    # 도구 묶음 펼침은 선택 전 배율 비교에 포함하지 않는다.
    before = r.spacing("디젤 선택 직전")
    if r.touch:
        predicate = "() => {const s=(" + SPACING_JS + ")();return s.count>=3 && s.min>=44 ? s : false;}"
        ok, timing = r.timed('[data-tool="diesel"]', predicate)
        r.check(ok, "터치 디젤 선택 400ms 안 이웃 간격 ≥44px", timing)
    else:
        r.press('[data-tool="diesel"]')
    after = r.spacing("디젤 선택 후")
    r.check(after >= 44 if r.touch else abs(after - before) <= .5,
            "디젤 터치 44px/마우스 배율 보존", {"before": before, "after": after})
    r.install()
    info = r.p.evaluate(COACH_JS)
    r.require(info["count"] > 0, "디젤 설치 뒤 미연결 대상 존재", info)
    if not r.shown('[data-tool="line"]'):
        r.press('[data-group="grid"]')
    before = r.spacing("송전선 선택 직전")
    if r.touch:
        predicate = "() => {const s=(" + SPACING_JS + ")();return s.count>=3 && s.min>=44 ? s : false;}"
        ok, timing = r.timed('[data-tool="line"]', predicate)
        r.check(ok, "터치 송전선 선택 400ms 안 이웃 간격 ≥44px", timing)
    else:
        r.press('[data-tool="line"]')
    after = r.spacing("송전선 선택 후")
    r.check(after >= 44 if r.touch else abs(after - before) <= .5,
            "송전선 터치 44px/마우스 배율 보존", {"before": before, "after": after})
    if r.touch:
        r.check(r.p.evaluate(TILE_XY_JS, info["i"]) is not None, "송전선 선택 뒤 첫 미연결 설비 노출", info)
    r.press('[data-zoom="1"]')
    zoomed = r.spacing("확대 단추 후")
    r.check(zoomed >= after, "자동 확대 뒤 확대 단추 비감소", {"before": after, "after": zoomed})
    r.press('[data-zoom="-1"]')
    reduced = r.spacing("축소 단추 후")
    r.check(reduced < zoomed, "축소 단추 간격 감소", {"before": zoomed, "after": reduced})


def check_coach(r, mode):
    info = r.p.evaluate(COACH_JS)
    r.require(info["step"] == 3, f"{mode} 코치 3단계", info)
    expected = coach_text(info, mode)
    r.check(info["task"] == expected, f"코치 {mode} 정확한 문구/꼬리 순서", {"actual": info, "expected": expected})
    if info["count"]:
        r.s.coverage["existing" if info["existing"] else "student"] = True
        if info["count"] >= 2:
            r.s.coverage["multiple"] = True
    else:
        r.s.coverage["zero"] = True
    if info["waiting"]:
        r.s.coverage["waiting"] = True
    if mode in ("start", "confirm"):
        r.s.coverage[mode] = True
    r.rec.setdefault("coach", []).append({"mode": mode, **info})
    return info


def coach_done(r, frame):
    """마지막 연결 뒤 코치 진행 상태를 단언 1개로 판정한다(#56).

    코치 단계는 0.5초 주기 확인으로 넘어가므로, 마지막 연결 직후 한 번 읽은 화면이 3단계에 머물러 있을 수도
    이미 다음 단계일 수도 있다. 예전에는 머물면 2개(3단계·0기 문구), 넘어갔으면 1개(미연결 해소)를 단언해
    통과 실행의 단언 수가 설정마다 1씩 흔들렸다(맥 542·543, CI 541). 이제 같은 한 번의 읽기(frame)로
    어느 쪽이든 단언 1개만 낸다. 3단계에 머물렀으면 0기 문구를 글자 그대로 비교하고, 넘어갔으면 미연결 0을
    본다. 0기 문구를 실제로 본 경우만 coverage zero로 센다.
    """
    if frame["step"] == 3:
        expected = coach_text(frame, "initial")
        ok = frame["count"] == 0 and frame["task"] == expected
        detail = {"branch": "3단계에 머묾", "actual": frame, "expected": expected}
        if ok:
            r.s.coverage["zero"] = True
            if frame["waiting"]:
                r.s.coverage["waiting"] = True
    else:
        ok = frame["count"] == 0
        detail = {"branch": "다음 단계로 넘어감", "actual": frame}
    r.rec.setdefault("coach", []).append({"mode": "done", **frame})
    r.check(ok, "송전 연결 뒤 코치 진행 상태(3단계면 미연결 0기 문구, 넘어갔으면 미연결 0)", detail)


def coach_case(r):
    r.pick_s1()
    r.p.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step)===2")
    r.tool("fire", "diesel")
    r.install()
    r.p.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step)===3")
    # 하나를 더 놓아 미연결 2기 이상 꼬리를 UI 조작으로 노출한다.
    r.tool("fire", "diesel")
    r.install()
    for _ in range(12):
        frame = r.p.evaluate(COACH_JS)
        if frame["step"] != 3 or frame["count"] == 0:
            coach_done(r, frame)
            break
        info = check_coach(r, "initial")
        r.check(r.p.locator("#lg-coach-action").inner_text().strip() == "송전선", "3단계 행동 단추 송전선")
        r.press("#lg-coach-action")
        r.check(r.p.locator("#bd-root").get_attribute("data-mode") == "line", "코치 행동 단추 송전선 선택")
        xy = r.p.evaluate(TILE_XY_JS, info["i"])
        r.check(xy is not None, "코치 행동 뒤 대상 설비 노출", info)
        if r.touch:
            town_xy = r.p.evaluate(TILE_XY_JS, info["townTile"])
            box = r.p.evaluate(MAP_BOX_JS)
            centered = bool(xy and box and
                box["left"] + (box["right"] - box["left"]) / 4 <= xy[0] <= box["right"] - (box["right"] - box["left"]) / 4 and
                box["top"] + (box["bottom"] - box["top"]) / 4 <= xy[1] <= box["bottom"] - (box["bottom"] - box["top"]) / 4)
            r.check(town_xy is not None or centered, "터치 마을도 노출 또는 대상이 지도 중앙 1/2",
                    {"target": xy, "town": town_xy, "mapBox": box})
        r.tile(info["i"], pan=True)
        check_coach(r, "start")
        r.tile(info["townTile"], pan=True)
        r.p.wait_for_selector("#bd-cf-ok", state="visible")
        check_coach(r, "confirm")
        before = r.p.evaluate("() => KCP.buildGame.current().lines.length")
        r.press("#bd-cf-ok")
        r.p.wait_for_function("n => KCP.buildGame.current().lines.length===n+1", arg=before)
    else:
        r.check(False, "송전 연결 12회 안에 코치 진행")


def selected_promise_case(r):
    key = r.pick_s1()
    ready = r.button("#lg-ready")
    r.check(ready["text"] == "준비" and not ready["disabled"], "첫 준비 글자/활성", ready)
    r.check(gold(ready["bg"]), "첫 준비 배경 금색 RGB ±3", ready)
    r.trial_weaker("계획")
    r.open_promise()
    r.incomplete()
    chips = r.chips()
    r.require(len(chips) >= 2 and any(c["key"] == key for c in chips), "S4 변경 가능한 근거 칩 2개 이상", chips)
    for chip in chips:
        r.check(chip["pressed"] == ("true" if chip["key"] == key else "false"),
                f'S1 미리 선택 aria-pressed: {chip["key"]}', chip)
    picked = next(c for c in chips if c["key"] == key)
    r.check("S1에서 고름" in picked["text"], "처음 선택 칩 내부 S1 표지", picked)
    r.check(r.p.locator("#lg-promise-remaining").inner_text().strip() == "남은 단계: 방향",
            "S1 선택 뒤 남은 단계는 방향")
    other = next(c["key"] for c in chips if c["key"] != key)
    r.press(r.chip_selector(other))
    for chip in r.chips():
        r.check(chip["pressed"] == ("true" if chip["key"] == other else "false"),
                f'학생이 바꾼 근거 단일 선택: {chip["key"]}', chip)
        if chip["key"] == key:
            r.check("S1에서 고름" in chip["text"], "근거 변경 뒤 처음 칩 S1 표지 유지", chip)
    # M4 지정 순서: 확신 → 근거 → 방향. 마지막 select change만으로 활성화되어야 한다.
    r.press('[data-confidence="fairly"]')
    r.press(r.chip_selector(key))
    r.check(r.p.locator("#lg-ready").is_disabled(), "방향만 비었을 때 주 행동 비활성")
    selector = "#lg-predict [data-pred]"
    ok, timing = r.timed(selector, "() => {const e=document.querySelector('#lg-ready');return !!e && !e.disabled;}",
                         action=lambda: r.p.locator(selector).first.select_option("down"), event="change")
    r.check(ok, "방향 select만 바꿔 400ms 안 주 행동 활성", timing)
    r.require(r.p.locator("#lg-ready").is_enabled(), "완성 약속 주 행동 활성")
    before = r.p.evaluate("() => {const L=KCP.league.state(),S=L.S||L.snap;return (S.results||[]).length;}")
    r.press("#lg-ready")
    r.p.wait_for_function("""n => {const L=KCP.league.state(),S=L.S||L.snap;
      return (S.results||[]).length>n;}""", arg=before, timeout=180000)
    after = r.p.evaluate("() => {const L=KCP.league.state(),S=L.S||L.snap;return (S.results||[]).length;}")
    r.check(after == before + 1, "주 행동으로 1월 운영 결과 정확히 +1", {"before": before, "after": after})
    r.p.wait_for_function("() => document.querySelector('#lg-ready')?.textContent.trim()==='다음 달'", timeout=15000)
    r.check(r.button("#lg-ready")["text"] == "다음 달", "결과 단계 주 행동 다음 달")
    r.trial_weaker("결과")


def blank_promise_case(r):
    # 별도 컨텍스트: S1 카드/이전 판 localStorage를 가져오지 않는다.
    r.close_drawer()
    r.open_promise()
    r.incomplete()
    chips = r.chips()
    r.require(bool(chips), "S1 미선택 별도 판 근거 칩 존재")
    for chip in chips:
        r.check(chip["pressed"] == "false", f'S1 미선택 모든 칩 false: {chip["key"]}', chip)
    r.check(r.p.locator("#lg-promise-remaining").inner_text().strip() == "남은 단계: 근거",
            "S1 미선택 남은 단계는 근거")
    r.close_drawer()
    ready = r.button("#lg-ready")
    r.check(not ready["disabled"], "미완성 약속 서랍 닫으면 주 행동 활성", ready)
    r.open_promise()
    r.check(r.shown("#lg-predict"), "닫힌 미완성 약속을 주 행동으로 다시 열기")


def fire_case(r):
    r.close_drawer()
    if r.shown('[data-tool="diesel"]'):
        r.press('[data-group="fire"]')
    visible_tools = """nodes=>nodes.filter(e=>e.getBoundingClientRect().width>0 &&
      e.getBoundingClientRect().height>0 && getComputedStyle(e).visibility!=='hidden').map(e=>e.dataset.tool)"""
    before = r.p.locator("[data-tool]").evaluate_all(visible_tools)
    r.press('[data-group="fire"]')
    tools = r.p.evaluate("""before => [...document.querySelectorAll('[data-tool]')].filter(e=>{
      const r=e.getBoundingClientRect();return r.width>0 && r.height>0 &&
        getComputedStyle(e).visibility!=='hidden' && !before.includes(e.dataset.tool);
    }).map(e=>{const r=e.getBoundingClientRect();return {kind:e.dataset.tool,text:e.textContent,
      scroll:e.scrollWidth,client:e.clientWidth,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};})""", before)
    r.require(bool(tools) and any(t["kind"] == "diesel" for t in tools), "화력 펼친 도구 범위에 디젤 포함", tools)
    r.rec["fireTools"] = tools
    for tool in tools:
        for number in re.findall(r"정격\s*([+-]?[\d,]+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*MW", tool["text"]):
            decimal = number.split(".", 1)[1] if "." in number else ""
            r.check(len(decimal) <= 1, f'{tool["kind"]} 정격 소수 최대 1자리', {"number": number, "text": tool["text"]})
        if r.s.cfg == "mobile":
            r.check(tool["scroll"] <= tool["client"] + 1, f'{tool["kind"]} 390px 단추 내부 가로 넘침 0', tool)
    if r.s.cfg == "mobile":
        for i, a in enumerate(tools):
            for b in tools[i + 1:]:
                ar, br = a["rect"], b["rect"]
                overlap = max(0, min(ar["right"], br["right"]) - max(ar["left"], br["left"])) * max(
                    0, min(ar["bottom"], br["bottom"]) - max(ar["top"], br["top"]))
                r.check(overlap == 0, f'390px 화력 도구 {a["kind"]}/{b["kind"]} 교차 면적 0', overlap)


def write_reports(summaries):
    RESULTS.mkdir(parents=True, exist_ok=True)
    for result in summaries:
        (RESULTS / f'ux_s2fix-{result["cfg"]}.json').write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    runs = []
    for result in summaries:
        missing = [key for key, seen in result["coverage"].items() if not seen]
        runs.append(f'- {result["cfg"]}: PASS {result["pass"]} / FAIL {result["fail"]}, '
                    f'pans={result["pans"]}; M2 미관찰 분기: {", ".join(missing) or "없음"}.')
    (RESULTS / "last.md").write_text(REPORT + "실행 기록(실행 환경은 실행 담당자가 확인):\n\n" +
                                    "\n".join(runs) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("--cfg", choices=[*CFG, "all"], default="all")
    args = parser.parse_args()
    cfgs = list(CFG) if args.cfg == "all" else [args.cfg]
    suites = [Suite(cfg) for cfg in cfgs]
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for suite in suites:
                    for name, function in (("M1-map", map_case), ("M2-coach", coach_case),
                                           ("M3-M4-S1-picked", selected_promise_case),
                                           ("M3-M4-no-S1", blank_promise_case), ("M5-fire", fire_case)):
                        suite.run(browser, args.base, name, function)
                    suite.check(not suite.events, "콘솔 error/warning·pageerror 0", suite.events)
            finally:
                browser.close()
    except Exception as exc:
        for suite in suites:
            suite.check(False, "브라우저 실행기 예외", f"{type(exc).__name__}: {exc}")
    summaries = [suite.summary() for suite in suites]
    write_reports(summaries)
    passed = sum(s["pass"] for s in summaries)
    failed = sum(s["fail"] for s in summaries)
    print(f"PASS {passed} / FAIL {failed}", flush=True)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
