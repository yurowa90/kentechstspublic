"""수정 명세만 근거로 작성한 s-riverdeal 수용 검사.

명세에 ID가 없어 12.1-1~8(번호), 12.2-1~6·12.3-1~10·12.4-1~7
(각 절의 글머리표 순서)을 ID로 삼았다. 공통 추가 계약은 COMMON-1~4.
실행은 harness의 KCP_BASE 및 네 개의 새 context 환경을 따른다.
전수 탐색표·심각 미달 EPS 검사는 model_s-riverdeal.mjs도 실제 실행한다.
"""
import copy
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from accept_originals import assert_single_request
from harness import Ctx, main

ROOT = Path(__file__).resolve().parents[1]
KEY = "kcp:v1:s-riverdeal"
PARTIES = ("dam", "ag", "city", "eco")
CRITERION = "현재 생활과 생계를 우선하되 미래 비용을 공개한다."
REASON = "현재 생활과 생계를 먼저 보장하되 미래 비용을 공개하겠습니다."
COMMON = ["rd-c1", "rd-c2", "rd-c3"]
# 개별 질문 상한 3개(공통3+개별3+마지막1=최대7). 개정 전에는 rd-dry-cut까지 8문항이었다.
NKEYS = COMMON + ["rd-dam-future", "rd-dam-structure", "rd-dissent", "rd-science"]


def _plan(ag=50, city=35, env=20, f=0, save=False, link=False,
          pulse=False, order="proportional"):
    return dict(ag=ag, city=city, env=env, f=f, save=save, link=link,
                pulse=pulse, order=order)


def _state(p=None, mode="auto", rounds=None, locked=False, mask=0):
    p = copy.deepcopy(p or _plan())
    human = {k: {"status": "accept", "line": ""} for k in PARTIES}
    final = dict(mode="unanimous" if mode == "role" else "administrative",
                 gain="현재 공급을 유지한다.", loss="미래 비축이 줄어든다.",
                 text="가상 합의문으로 책임과 부담을 기록한다.", hardDecisionId="")
    # 모두 가상 문장이고 학생 자료를 사용하지 않는다.
    g = dict(version="rd-v2", mode=mode, tab="basin", scenario="normal",
             criterion=CRITERION, stage="draft", proposal=p, mask=mask,
             rounds=copy.deepcopy(rounds or []), humanDraft=copy.deepcopy(human),
             counter=None, final=final, locked=None, previousLocked=None)
    if locked:
        if rounds is None:
            decision = None if mode == "role" else _decision(1, p)
            g["rounds"] = [dict(n=1, proposal=copy.deepcopy(p), mask=mask,
                                human=human if mode == "role" else None, decision=decision)]
        records = [r["decision"] for r in g["rounds"] if r.get("decision")]
        final["hardDecisionId"] = records[-1]["id"] if records else ""
        g["stage"] = "locked"
        g["locked"] = copy.deepcopy({k: g[k] for k in
                                     ("version", "proposal", "mode", "criterion", "mask", "rounds", "final")})
    return dict(phase="prep", memo="", answers={}, answerQ={}, rubric={}, ext={},
                compare=dict(before="", open=False, better="", gap=""), game=g)


def _decision(n, p, party="dam", action="reject", after=None, option=None, mask=0):
    return dict(id=f"rd-r{n}-decision", action=action, party=party, option=option,
                beforeP=copy.deepcopy(p), afterP=copy.deepcopy(after or p),
                reason=REASON, beforeMask=mask)


def _inject(c, state):
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush()")
    c.page.evaluate("([key,state]) => localStorage.setItem(key,JSON.stringify(state))", [KEY, state])
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    c.goto("#ys-riverdeal", wait="#rd-root")
    c.phase("prep")


def _prep(c, auto=True, p=None):
    c.goto("#ys-riverdeal", wait="#rd-root")
    c.phase("prep")
    if auto:
        c.page.locator("#rd-mode-auto").click()
    c.page.locator("#rd-criterion").fill(CRITERION)
    if p:
        _edit(c, p)


def _edit(c, p):
    for k in ("ag", "city", "env"):
        c.page.locator(f"#rd-{k}").fill(str(p[k]))
    c.page.locator("#rd-f").select_option(str(p["f"]))
    c.page.locator("#rd-order").select_option(p["order"])
    for k in ("save", "link", "pulse"):
        c.page.locator(f"#rd-{k}").set_checked(p[k])


def _game(c):
    c.wait_saved()
    # 저장 대기열이 3초 안에 비지 않을 만큼 렌더러가 밀리면 wait_saved는 그냥 넘어간다(harness.py).
    # 페이지 시계로 300ms 타이머를 하나 더 기다리면 마감이 앞선 250ms 저장 타이머가 반드시 먼저 돈다
    # (accept_probe._state와 같은 보호, 2026-10-21 재발 경로 재조사의 부수 발견).
    c.page.evaluate("() => new Promise(r => setTimeout(r, 300))")
    return (c.ls(KEY) or {}).get("game", {})


def _text(c, sel):
    return c.page.locator(sel).inner_text().strip()


def _has(c, sel, texts, aid):
    value = _text(c, sel)
    for text in texts:
        c.expect(text in value, f"{aid} {sel}에 {text!r} 표시")


def _disabled(c, ids, aid, disabled=True):
    for id_ in ids:
        c.eq(c.page.locator(f"#{id_}").is_disabled(), disabled,
             f"{aid} {id_} 비활성 상태")


def _outputs(c, values, aid):
    for k, expected in values.items():
        sel = f"#rd-{k}"
        c.eq(_text(c, sel), expected, f"{aid} {sel} 숫자 텍스트")


def _reject(c, party="dam", reason=REASON):
    c.page.locator("#rd-counter-party").select_option(party)
    c.page.locator("#rd-decision-reason").fill(reason)
    c.page.locator("#rd-reject").click()


def _final(c, mode="majority"):
    c.page.locator("#rd-final-mode").select_option(mode)
    c.page.locator("#rd-gain").fill("현재 공급을 유지한다.")
    c.page.locator("#rd-loss").fill("미래 비축이 줄어든다.")
    c.page.locator("#rd-final-text").fill("공사의 조건부가 아닌 거부 의견을 남기고 현재 배분안을 상정한다.")


def _lock_n(c, reason=REASON):
    _prep(c)
    c.page.locator("#rd-submit").click()
    _reject(c, reason=reason)
    _final(c)
    c.page.locator("#rd-lock").click()


def _questions(c):
    return assert_single_request(c, c.page.evaluate("KCP.games['s-riverdeal'].questions(KCP.load('s-riverdeal'))"))


def _keys(c, expected, aid):
    qs = _questions(c)
    c.eq([q["k"] for q in qs], expected, f"{aid} 면접 질문 키 순서")
    c.eq(c.page.locator(".qdeck .qcard").count(), len(expected), f"{aid} 실제 질문 카드 수")
    c.expect(6 <= len(qs) <= 7, f"{aid} 총 6~7문항")
    c.eq(len(set(q["k"] for q in qs)), len(qs), f"{aid} 중복 키 없음")
    c.expect(all("src" not in q for q in qs), f"{aid} 모든 src 생략")
    cards = c.page.locator(".qdeck .qcard")
    for i in range(cards.count()):
        c.eq(cards.nth(i).locator(".who .tag-mine").inner_text().strip(), "연습용 질문",
             f"COMMON-2 질문 {i+1} 연습용 표시")
        c.expect("보고서 문항" not in cards.nth(i).inner_text(), "COMMON-2 보고서 문항 표시 없음")
    c.check(f"{aid} 면접실")


def t_12_1_normal(c: Ctx):
    c.open("?prep=15&answer=8#ys-riverdeal")
    c.page.wait_for_selector("#rd-root")
    c.eq(c.page.locator("#rd-mode-role").get_attribute("aria-pressed"), "true", "12.1-1 역할극 기본")
    for k, value in dict(ag="50", city="35", env="20", f="0", order="proportional").items():
        c.eq(c.page.locator(f"#rd-{k}").input_value(), value, f"12.1-1 기본 {k}")
    c.eq(c.page.locator("#rd-criterion").input_value(), "", "12.1-2 빈 판단 기준")
    _disabled(c, ["rd-go", "rd-lock", "rd-submit"], "12.1-2")
    c.page.locator("#rd-mode-auto").click()
    c.page.locator("#rd-criterion").fill(CRITERION)
    _outputs(c, {"r":"105.00", "raw-end":"74.00", "end":"74.00", "shortage":"0.00",
                 "income":"0.891", "yield":"0.891", "supply":"97.2", "c":"0.667", "qe":"5.530",
                 "temp":"24.47", "sat":"8.4", "do":"6.048", "head":"29.30", "energy":"7118.68"}, "12.1-3")
    for k, unit in dict(r="백만 m³", end="백만 m³", shortage="백만 m³", supply="%", qe="m³/s",
                        temp="℃", sat="mg/L", do="mg/L", head="m", energy="MWh").items():
        adjacent = c.page.locator(f"#rd-{k}").evaluate("e=>e.parentElement.textContent + ' ' + (e.labels ? [...e.labels].map(x=>x.textContent).join(' ') : '')")
        c.expect(unit in adjacent, f"12.1-3 {k} 라벨 또는 인접 단위")
    _has(c,"#rd-do-caution",["실제 수질 예측이 아닙니다"],"12.1-3")
    c.page.locator("#rd-submit").click()
    c.eq(_game(c)["rounds"][0]["n"], 1, "12.1-4 첫 제출 라운드 1")
    for k, status in zip(PARTIES, ("거부", "수용", "수용", "수용")):
        _has(c, f"#rd-response-{k}", [status], "12.1-4")
    _has(c, "#rd-response-dam", ["74", "110", "36", "6", "심각"], "12.1-4")
    dam_text = _text(c, "#rd-response-dam")
    c.expect(re.search(r"74(?:\.0+)?\s*/\s*110(?:\.0+)?", dam_text) is not None,
             "12.1-4 공사 비축 현재값/기준 74/110")
    c.expect(re.search(r"[−-]\s*36(?:\.0+)?", dam_text) is not None,
             "12.1-4 공사 비축 부족량 −36")
    _has(c, "#rd-responses", ["못 채운 기준의 수", "실제 사람의 태도를 예측하지 않습니다"], "12.1-4")
    c.expect(c.page.locator("#rd-human-dam-status").is_hidden(), "12.1-4 자동 모드의 사람 입력 숨김")
    c.page.locator("#rd-decision-reason").fill("   ")
    _disabled(c,["rd-reject"],"12.1-5")
    _reject(c)
    c.eq(_game(c)["rounds"][0]["decision"]["reason"],REASON,"12.1-5 ready에서 거절 이유 기록")
    _final(c)
    c.eq(c.page.locator("#rd-hard-decision").input_value(),"rd-r1-decision","12.1-6 가장 어려운 기록 기본 선택")
    c.page.locator("#rd-memo").fill("가상 협상 준비 메모")
    c.page.locator("#rd-lock").click()
    c.eq(_game(c)["locked"]["proposal"],_plan(),"12.1-7 마지막 제출 N 스냅샷")
    _disabled(c,["rd-ag","rd-final-mode","rd-submit","rd-mode-role","rd-mode-auto"],"12.1-7")
    _disabled(c,["rd-go","rd-memo","rd-scenario"],"12.1-7",False)
    c.page.locator("#rd-tab-model").click()
    c.expect(c.page.locator("#rd-pane-model").is_visible(),"12.1-7 확정 뒤 자료 사용 가능")
    _has(c,"#rd-pane-model",["염분 침입","기수역","홍수기 제한수위"],"자료 개정")
    c.page.locator("#rd-tab-clauses").click()
    # 명세 3절·4.3: 조항 칸은 감량 순서의 선택 가능함을 확인한다.
    # 법령과 게임의 차이를 설명하는 “강제하지 않는 선택지”는 10절 성찰의 한계 칸에서 검사한다.
    _has(c,"#rd-pane-clauses",["댐 용수공급 조정기준","관심→주의→경계→심각","하천유지용수(주의)","농업용수(경계)","생활·공업용수(심각)","여러 선택지 가운데 하나"],"자료 개정")
    c.page.locator("#rd-tab-basin").click()
    _has(c,"#rd-pane-basin",["물 높이 단위가 아닙니다."],"자료 개정")
    c.check("12.1-7 준비실")
    c.page.locator("#rd-go").click()
    _keys(c,NKEYS,"12.1-7")
    _has(c,".qcard >> nth=1",[REASON],"12.1-7")
    c.page.locator('textarea[data-a="0"]').fill("가상 면접 답변 메모")
    qs = _questions(c)
    c.wait_saved()
    c.expect(c.ls(KEY) is not None,"COMMON-4 400ms 뒤 게임 저장 키 생성")
    c.page.reload()
    c.page.wait_for_selector(".qcard")
    c.eq(_questions(c),qs,"12.1-8 새로고침 질문·수치·문장 동일")
    c.eq(c.page.locator('textarea[data-a="0"]').input_value(),"가상 면접 답변 메모","12.1-8 답변 메모 보존")
    # 12.1-8·8절: 날짜 독립성을 검사한다. evaluate가 반환된 class를 함수로 호출하지 않게
    # 명시적 함수 안에서 Date를 교체하고, 검사 뒤 원래 생성자를 복원한다.
    dated=c.page.evaluate("""() => {
      const OriginalDate=window.Date;
      try {
        window.Date=class extends OriginalDate { static now(){return 4102444800000;} };
        return KCP.games['s-riverdeal'].questions(KCP.load('s-riverdeal'));
      } finally { window.Date=OriginalDate; }
    }""")
    c.eq(dated,qs,"12.1-8 임의 날짜 변경에도 질문 동일")
    c.phase("prep")
    c.eq(c.page.locator("#rd-memo").input_value(),"가상 협상 준비 메모","12.1-8 준비 메모 보존")


def t_12_2_cascade(c: Ctx):
    _prep(c)
    c.page.locator("#rd-submit").click()
    c.page.locator("#rd-want-a").click()
    c.page.locator("#rd-counter-start").click()
    _disabled(c,["rd-apply"],"12.2-3")
    c.page.locator("#rd-env").fill("0")
    c.expect(c.page.locator("#rd-cascade").is_visible(),"12.2-1 연쇄는 현재 화면에 표시")
    expected = {"city":["0.667","0.947","수용","조건부"], "eco":["5.530","2.958","6.048","3.645","수용","거부"],
                "dam":["74","94","6","0","거부","조건부"]}
    for party, texts in expected.items():
        _has(c,f'#rd-cascade .rd-cascade-party[data-rd-party="{party}"]',texts,"12.2-1")
    _disabled(c,["rd-apply"],"12.2-2")
    c.page.locator("#rd-decision-reason").fill(REASON)
    # 두 개의 동기 click 이벤트: 리렌더링돼도 같은 DOM 버튼에 대한 재클릭을 검증한다.
    c.page.locator("#rd-apply").evaluate("e=>{e.click();e.click();}")
    g = _game(c)
    c.eq(len(g["rounds"]),1,"12.2-2 더블클릭도 제출 이력 한 개")
    c.eq(g["rounds"][0]["decision"]["action"],"apply","12.2-2 반영 결정")
    c.eq(g["rounds"][0]["decision"]["afterP"]["env"],0,"12.2-2 반영안 C")
    _disabled(c,["rd-lock","rd-ag"],"12.2-2")
    c.page.locator("#rd-submit").click()
    _outputs(c,{"end":"94.00","c":"0.947","qe":"2.958","do":"3.645"},"12.2-2")
    c.eq(len(_game(c)["rounds"]),2,"12.2-2 재제출 시 라운드 증가")


def t_12_2_options_budget(c: Ctx):
    _prep(c,p=_plan(link=True))
    c.page.locator("#rd-submit").click()
    c.page.locator("#rd-counter-party").select_option("dam")
    _disabled(c,["rd-want-b"],"12.2-3")
    _has(c,"#rd-root",["이미 이송 중입니다"],"12.2-3")
    c.page.locator("#rd-want-a").click()
    c.page.locator("#rd-counter-start").click()
    c.page.locator("#rd-env").fill("0")
    c.page.locator("#rd-f").select_option("0.3")
    c.page.locator("#rd-save").check()
    c.page.locator("#rd-decision-reason").fill(REASON)
    _has(c,"#rd-cost",["75","60"],"12.2-3")
    _has(c,"#rd-root",["대책비가 60억 원을 넘었습니다"],"12.2-3")
    _disabled(c,["rd-submit","rd-apply","rd-lock"],"12.2-3")


def t_12_2_repeated_reject(c: Ctx):
    _prep(c)
    for n in (1,2):
        c.page.locator("#rd-submit").click()
        if n == 2:
            _has(c,"#rd-next-threshold",["이번에도 거절하면","다음 제출","110","111"],"12.2-4")
        _reject(c)
    _has(c,"#rd-next-threshold",["다음 제출","110","111"],"12.2-4")
    g = _game(c)
    c.eq([r["mask"] for r in g["rounds"]],[0,0],"12.2-4 첫 두 제출 기준 불변")
    _final(c)
    c.page.locator("#rd-lock").click()
    c.eq(_game(c)["locked"]["mask"],0,"12.2-4 둘째 거절 직후 확정은 mask0")
    # 적용 전 저장 이력을 주입하여 셋째 제출부터 실제 상승하는지 확인한다.
    state=c.ls(KEY)
    state["game"].update(stage="ready",locked=None)
    _inject(c,state)
    _has(c,"#rd-next-threshold",["다음 제출","111"],"12.2-4")
    c.page.locator("#rd-submit").click()
    _reject(c)
    g = _game(c)
    c.eq([r["mask"] for r in g["rounds"]],[0,0,1],"12.2-4 셋째 제출부터 mask1")
    c.eq(g["mask"],1,"12.2-4 현재 제출 mask와 다음 예고 구분")
    _has(c,"#rd-response-dam",["110","111"],"12.2-4")
    c.expect("112" not in _text(c,"#rd-next-threshold"),"12.2-4 같은 곳 추가 상승 없음")
    c.page.reload()
    c.page.wait_for_selector("#rd-root")
    c.eq([r["mask"] for r in _game(c)["rounds"]],[0,0,1],"12.2-4 적용 뒤 복원")
    # 중단 이력 3종은 규범 model 함수를 별도로 호출한다.
    sequences = [[{"action":"reject","party":"dam"},{"action":"apply","party":"dam"},{"action":"reject","party":"dam"}],
                 [{"action":"reject","party":"dam"},{"action":"reject","party":"ag"},{"action":"reject","party":"dam"}],
                 [{"action":"reject","party":"dam"},None,{"action":"reject","party":"dam"}]]
    for i, ds in enumerate(sequences):
        actual=c.page.evaluate("ds=>KCP.games['s-riverdeal'].model.masksFromDecisions(ds.map(decision=>({decision})))",ds)
        c.eq(actual,{"used":[0,0,0],"next":0},f"12.2-4 연속 중단 이력 {i+1}")


def t_12_2_four_rounds(c: Ctx):
    _prep(c,p=_plan(ag=30,city=21,env=12,order="agFirst"))
    for party, field in (("ag","ag"),("eco","env"),("city","city")):
        c.page.locator("#rd-submit").click()
        c.page.locator("#rd-counter-party").select_option(party)
        c.page.locator("#rd-want-a").click()
        c.page.locator("#rd-counter-start").click()
        loc=c.page.locator(f"#rd-{field}")
        loc.fill(str(int(loc.input_value())+1))
        c.page.locator("#rd-decision-reason").fill(REASON)
        c.page.locator("#rd-apply").click()
    c.page.locator("#rd-submit").click()
    _final(c,"administrative")
    _disabled(c,["rd-submit","rd-apply","rd-lock"],"12.2-5")
    _has(c,"#rd-root",["네 번의 제안을 마쳤습니다"],"12.2-5")
    c.page.locator("#rd-submit").evaluate("e=>e.click()")
    c.eq(len(_game(c)["rounds"]),4,"12.2-5 다섯째 제출 없음")
    _reject(c,"ag")
    c.page.locator("#rd-lock").click()
    g=_game(c)
    c.eq(sum(r["decision"]["action"]=="apply" for r in g["rounds"]),3,"12.2-5 최대 반영 3회")
    c.page.locator("#rd-go").click()
    c.expect("rd-applied-three" in [q["k"] for q in _questions(c)],"12.2-5 세 번 반영 후보 노출")


def t_12_2_cancel_restore(c: Ctx):
    _prep(c)
    c.page.locator("#rd-submit").click()
    c.page.locator("#rd-want-a").click()
    c.page.locator("#rd-counter-start").click()
    c.page.locator("#rd-env").fill("0")
    c.wait_saved()
    c.page.reload()
    c.page.wait_for_selector("#rd-root")
    g=_game(c)
    c.eq(g["stage"],"counter","12.2-6 임시 편집 단계 복원")
    c.eq(g["proposal"]["env"],0,"12.2-6 임시 배분 복원")
    c.eq(g["counter"]["beforeP"],_plan(),"12.2-6 원 제출 보존")
    c.page.locator("#rd-counter-cancel").click()
    g=_game(c)
    c.eq(g["proposal"],_plan(),"12.2-6 편집 취소 beforeP 복원")
    c.eq(g["rounds"][0]["decision"],None,"12.2-6 취소는 결정 기록 없음")
    c.eq(g["stage"],"ready","12.2-6 ready 복귀")


def t_12_3_limits(c: Ctx):
    _prep(c,p=_plan(0,0,0))
    _outputs(c,{"c":"계산 불가(유량 0)","do":"계산 불가(유량 0)"},"12.3-1")
    c.page.locator("#rd-submit").click()
    for party in ("ag","city","eco"):
        _has(c,f"#rd-response-{party}",["거부"],"12.3-1")
    c.expect(not re.search(r"NaN|Infinity",_text(c,"#rd-root")),"12.3-1 화면 비유한값 없음")
    c.expect(not re.search(r"NaN|Infinity",json.dumps(c.ls(KEY))),"12.3-1 저장 비유한값 없음")
    _inject(c,_state(_plan(80,80,80,pulse=True,order="envFirst")))
    _outputs(c,{"end":"40.00","energy":"8603.62"},"12.3-1")
    r=c.page.evaluate("KCP.games['s-riverdeal'].model.simulate(KCP.load('s-riverdeal').game.proposal,55)")
    c.eq(r["v"],dict(ag=59,city=80,env=0),"12.3-1 X 공급량")
    c.eq(r["pulseActual"],0,"12.3-1 감량된 펄스 잔여0")
    c.eq(r["pulseEffective"],False,"12.3-1 감량된 펄스 완화 없음")
    _inject(c,_state(_plan(1,0,0)))
    _outputs(c,{"do":"0.000"},"12.3-1")
    _has(c,"#rd-root",["산소 감소식이 포화값을 넘었습니다","0으로 제한한 모형값"],"12.3-1")


def t_12_3_severe(c: Ctx):
    _prep(c,p=_plan(30,21,12,order="agFirst"))
    _outputs(c,{"income":"0.455","supply":"58.3"},"12.3-2")
    c.page.locator("#rd-submit").click()
    for party,status in zip(PARTIES,("수용","거부","거부","조건부")):
        _has(c,f"#rd-response-{party}",[status],"12.3-2")
    good=dict(end=120,income=1,supply=1,C=.5,Qe=6,DO=7,pulseEffective=False)
    for key,bound,sign,index,extra in (("end",80,-1,0,{}),("income",.70,-1,1,{}),("supply",.85,-1,2,{}),
                                      ("C",1,1,2,{}),("Qe",3,-1,3,{}),("Qe",2,-1,3,{"pulseEffective":True}),("DO",4,-1,3,{})):
        for offset in (0,.5e-9,2e-9):
            for mask in (0,15):
                r={**good,**extra,key:bound+sign*offset}
                actual=c.page.evaluate("([r,mask])=>KCP.games['s-riverdeal'].model.response(r,{shortage:0},mask)",[r,mask])
                c.eq(actual[index],"reject" if offset>1e-9 else "conditional",f"12.3-2 {key} 경계/EPS/상승{mask}")
    # 표시 0.850으로 반올림되어도 원값이 0.85보다 작으면 수용하지 않는다.
    r={**good,"income":.8499999}
    c.eq(c.page.evaluate("r=>KCP.games['s-riverdeal'].model.response(r,{shortage:0},0)[1]",r),
         "conditional","12.3-4 표시 반올림으로 수용 변경 없음")


def t_12_3_budget(c: Ctx):
    _prep(c,p=_plan(f=.2,save=True,link=True))
    _has(c,"#rd-cost",["60","60억"],"12.3-3")
    _disabled(c,["rd-submit"],"12.3-3",False)
    c.page.locator("#rd-pulse").check()
    _has(c,"#rd-cost",["60"],"12.3-3")
    c.page.locator("#rd-f").select_option("0.3")
    _has(c,"#rd-cost",["75"],"12.3-3")
    _has(c,"#rd-root",["대책비가","60억 원을 넘었습니다","제출할 수 없는 초안"],"12.3-3")
    _disabled(c,["rd-submit","rd-lock"],"12.3-3")
    c.page.locator("#rd-link").uncheck()
    c.page.locator("#rd-save").uncheck()
    _has(c,"#rd-cost",["45"],"12.3-4")


def t_12_3_invalid(c: Ctx):
    _prep(c)
    for bad in ("","1.5","-1","81","1e309"):
        loc=c.page.locator("#rd-ag")
        # 7.2·12.3-4: value에 1e309를 대입하면 브라우저 자체가 경고하므로 네이티브
        # 텍스트 삽입(붙여넣기)으로 검사한다. 한 번에 넣어 중간의 유효한 '1'이
        # 마지막 유효 계산을 바꾸지 않게 하며, 경고 수집은 그대로 유지한다.
        if bad == "1e309":
            loc.fill("")
            c.page.keyboard.insert_text(bad)
            loc.press("Tab")
        else:
            loc.evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}",bad)
        _disabled(c,["rd-submit","rd-lock"],"12.3-4")
        _has(c,"#rd-root",["0~80의 정수를 입력하세요","마지막 유효 입력 기준"],"12.3-4")
        _outputs(c,{"end":"74.00"},"12.3-4")
        if bad != "1e309":
            c.eq(loc.input_value(),bad,"12.3-4 blur/change 후 강제 반올림 없음")
        loc.fill("50")
    for bad in ("",1.5,-1,81,"1e309",None):
        s=_state();s["game"]["proposal"]["ag"]=bad
        _inject(c,s)
        c.expect(_game(c).get("locked") is None,"12.3-4 손상 입력 확정 없음")
        c.expect(c.page.locator("#rd-root").is_visible(),"12.3-4 손상 입력에도 준비실 렌더")
        p=_game(c).get("proposal",{})
        if p:
            c.expect(isinstance(p.get("ag"),(int,float)) and 0<=p["ag"]<=80 and p["ag"]%1==0,
                     "12.3-4 저장 제안의 유효 범위 복구")


def t_12_3_scenarios(c: Ctx):
    _lock_n(c)
    before=_questions(c)
    c.page.locator("#rd-scenario").select_option("dry")
    _outputs(c,{"end":"40.00","shortage":"6.00","do":"5.941","supply":"91.7"},"12.3-5")
    c.page.locator("#rd-scenario").select_option("wet")
    _outputs(c,{"end":"119.00"},"12.3-5")
    _has(c,'#rd-scenarios [data-rd-scenario="wet"]',["조건부"],"12.3-5")
    c.eq(_questions(c),before,"12.3-5 전망 선택으로 질문 평년 분기 불변")
    c.page.locator("#rd-go").click()
    _keys(c,NKEYS,"12.3-5")


def t_12_3_role(c: Ctx):
    _prep(c,auto=False)
    c.page.locator("#rd-submit").click()
    _disabled(c,["rd-record-human","rd-counter-start","rd-lock"],"12.3-6")
    for party in PARTIES:
        c.eq(c.page.locator(f"#rd-human-{party}-status").input_value(),"","12.3-6 사람 반응 초기 미입력")
        c.page.locator(f"#rd-human-{party}-status").select_option("accept")
        c.eq(c.page.locator(f"#rd-human-{party}-line").get_attribute("maxlength"),"200","12.3-6 이유 최대200자")
    c.page.locator("#rd-human-dam-status").select_option("reject")
    c.page.locator("#rd-human-dam-line").fill("   ")
    _disabled(c,["rd-record-human"],"12.3-6")
    c.page.locator("#rd-human-dam-status").select_option("conditional")
    c.page.locator("#rd-human-dam-line").fill("")
    _disabled(c,["rd-record-human"],"12.3-6",False)
    c.page.locator("#rd-human-dam-status").select_option("accept")
    c.page.locator("#rd-record-human").click()
    c.expect(all(x["status"]=="accept" for x in _game(c)["rounds"][0]["human"].values()),"12.3-6 사람 수용 보존")
    _has(c,"#rd-response-dam",["거부"],"12.3-6 모형 공사 거부 숨기지 않음")
    for mode in ("unanimous","majority"):
        c.expect(c.page.locator(f'#rd-final-mode option[value="{mode}"]').is_enabled(),f"12.3-6 전원 수용에서도 {mode} 가능")
    _final(c,"unanimous")
    c.page.locator("#rd-lock").click()
    c.page.locator("#rd-go").click()
    _keys(c,COMMON+["rd-dam-future","rd-dam-structure","rd-dry-cut","rd-science"],"12.3-7")
    c.expect("rd-dissent" not in [q["k"] for q in _questions(c)],"12.3-7 역할극 전원 수용이면 dissent 없음")


def t_12_3_role_reset(c: Ctx):
    _prep(c,auto=False)
    c.page.locator("#rd-submit").click()
    for party in PARTIES:
        c.page.locator(f"#rd-human-{party}-status").select_option("conditional")
    c.page.locator("#rd-record-human").click()
    c.page.locator("#rd-counter-party").select_option("dam")
    c.page.locator("#rd-want-a").click()
    c.page.locator("#rd-counter-start").click()
    c.page.locator("#rd-env").fill("19")
    _has(c,"#rd-cascade",["사람 반응: 재확인 필요"],"12.3-6")
    c.page.locator("#rd-decision-reason").fill(REASON)
    c.page.locator("#rd-apply").click()
    c.page.locator("#rd-submit").click()
    for party in PARTIES:
        c.eq(c.page.locator(f"#rd-human-{party}-status").input_value(),"","12.3-6 다음 제출 사람 반응 비움")
    c.eq(_game(c)["rounds"][0]["human"]["dam"]["status"],"conditional","12.3-6 이전 반응 기록 보존")
    _disabled(c,["rd-mode-role","rd-mode-auto"],"12.3-6")


def t_12_3_question_examples(c: Ctx):
    c.goto("#ys-riverdeal",wait="#rd-root")
    c.eq(_questions(c),[],"12.3-7 미확정 questions=[]")
    for p,mode,keys in ((_plan(43,33,15,.2,True,False,True),"auto",COMMON+["rd-dam-future","rd-dam-structure","rd-dissent","rd-science"]),
                        (_plan(42,36,0,.2,False,True),"auto",COMMON+["rd-eco","rd-dissent","rd-tax","rd-science"]),
                        (_plan(0,35,22),"role",COMMON+["rd-ag","rd-order-reason","rd-science"])):
        s=_state(p,mode,locked=True)
        # T에서 미수용 당사자는 공사가 아니라 하구다.
        if p["ag"]==42:
            d=_decision(1,p,"eco")
            s["game"]["rounds"][0]["decision"]=d
            s["game"]["locked"]["rounds"][0]["decision"]=copy.deepcopy(d)
        _inject(c,s)
        c.phase("room")
        _keys(c,keys,"12.3-8" if mode=="role" else "12.3-7")
        texts=" ".join(q["q"] for q in _questions(c))
        for value in (["84.00","1개"] if p["ag"]==43 else ["2.739","27.26","3.627","55억"] if p["ag"]==42 else ["0.000"]):
            c.expect(value in texts,"12.3-7 질문 주요 수치 일치")
        before=_questions(c)
        # locked 데이터와 독립인 편집 초안 변경이 질문을 바꾸지 않는다.
        altered=copy.deepcopy(s);altered["game"]["proposal"]=_plan(1,1,1)
        qs=c.page.evaluate("s=>KCP.games['s-riverdeal'].questions(s)",altered)
        c.eq(qs,before,"12.3-7 질문은 locked만 읽음")


def t_12_3_escape(c: Ctx):
    payload="<img src=x onerror=alert(1)>"
    dialogs=[];requests=[]
    c.page.on("dialog",lambda dialog:(dialogs.append(dialog.message),dialog.dismiss()))
    c.page.on("request",lambda r:requests.append(r.url))
    _lock_n(c,payload)
    c.page.locator("#rd-go").click()
    _keys(c,NKEYS,"12.3-9")
    _has(c,".qcard >> nth=1",[payload],"12.3-9")
    c.eq(c.page.locator(".qcard img").count(),0,"12.3-9 문자열로 표시, 이미지 DOM 없음")
    c.eq(dialogs,[],"12.3-9 경고창 없음")
    c.expect(not any(re.search(r"/x(?:$|[?#])",url) for url in requests),"12.3-9 주입 문자열 네트워크 요청 없음")
    # 7.3·12.1-8: 저장은 디바운스된다. KCP.load의 대기 중 상태와 달리 localStorage는
    # 즉시 생기지 않으므로 저장 완료를 기다린 뒤 발언 변경 검사를 한다.
    c.wait_saved()
    changed=copy.deepcopy(c.ls(KEY));changed["game"]["locked"]["rounds"][0]["decision"]["reason"]="다른 가상 발언"
    c.eq(c.page.evaluate("s=>KCP.games['s-riverdeal'].questions(s).map(q=>q.k)",changed),NKEYS,"12.3-9 발언 변경에도 키 안정")


def t_12_3_restart(c: Ctx):
    _lock_n(c)
    c.page.locator("#rd-memo").fill("가상 준비 메모 보존")
    c.page.locator("#rd-go").click()
    c.page.locator('textarea[data-a="0"]').fill("가상 면접 메모 보존")
    old=_game(c)["locked"]
    c.phase("prep")
    _has(c,"#rd-root",["확정을 풀고 새 4회 협상을 시작합니다","기존 메모와 면접 메모는 남습니다"],"12.3-10")
    c.page.locator("#rd-unlock").click()
    g=_game(c)
    c.eq([g["locked"],g["rounds"],g["mask"]],[None,[],0],"12.3-10 새 협상 초기화")
    c.eq(g["previousLocked"],old,"12.3-10 이전 snapshot 하나 보존")
    c.eq(c.page.locator("#rd-memo").input_value(),"가상 준비 메모 보존","12.3-10 메모 보존")
    c.eq(c.ls(KEY)["answers"].get("0"),"가상 면접 메모 보존","12.3-10 공통 답변 보존")
    c.expect(c.page.locator("#rd-root details").count()>0,"12.3-10 이전 협상 읽기 가능")
    _disabled(c,["rd-go"],"12.3-10")
    c.eq(_questions(c),[],"12.3-10 과거 기록 새 질문에 합산 안 함")
    _has(c,"#rd-root",["이전 협상의 면접 메모가 남아 있습니다"],"12.3-10")
    c.eq(g["final"]["hardDecisionId"],"","12.3-10 새 협상은 가장 어려운 기록 비움")


def t_rev_rounding(c: Ctx):
    # 7.4 개정: 판정은 반올림 전 값. 평년 DO 4.99997은 5.000/5.000으로 보이지 않는다.
    _prep(c,p=_plan(3,59,2))
    c.page.locator("#rd-submit").click()
    eco=_text(c,"#rd-response-eco")
    c.expect("4.99997 / 5.00000 (이상) · −0.00003 · 미충족" in eco,"7.4 반올림 동률 DO 자릿수 확대")
    c.expect("5.000 / 5.000" not in eco,"7.4 같은 값처럼 보이는 미충족 없음")
    _has(c,"#rd-responses",["판정은 반올림 전 값으로 합니다"],"7.4")
    c.page.locator("#rd-counter-party").select_option("eco")
    c.page.locator("#rd-want-a").click()
    c.page.locator("#rd-counter-start").click()
    c.page.locator("#rd-env").fill("3")
    _has(c,"#rd-cascade",["판정은 반올림 전 값으로 합니다","4.99997 / 5.00000"],"7.4 연쇄 비교")
    c.check("7.4 반올림 동률 표시")


def t_rev_hard_choice(c: Ctx):
    # 7.1 개정: 학생이 고른 가장 어려운 역제안 기록을 다음 결정이 덮어쓰지 않는다.
    _prep(c)
    c.page.locator("#rd-submit").click()
    _reject(c)
    c.page.locator("#rd-submit").click()
    _reject(c)
    c.eq(c.page.locator("#rd-hard-decision").input_value(),"rd-r1-decision","7.1 기존 선택 유지")
    c.page.locator("#rd-hard-decision").select_option("rd-r2-decision")
    c.eq(_game(c)["final"]["hardDecisionId"],"rd-r2-decision","7.1 학생 선택 저장")
    c.page.locator("#rd-submit").click()
    _reject(c)
    c.eq(_game(c)["final"]["hardDecisionId"],"rd-r2-decision","7.1 셋째 결정 뒤에도 학생 선택 유지")
    c.eq(c.page.locator("#rd-hard-decision").input_value(),"rd-r2-decision","7.1 화면 선택 유지")


def t_rev_revert_ready(c: Ctx):
    # 7.2 개정: 끝난 제출 뒤 값을 바꿨다가 되돌리면 추가 제출 없이 확정할 수 있다.
    _prep(c)
    c.page.locator("#rd-submit").click()
    _reject(c)
    _final(c)
    _disabled(c,["rd-lock"],"7.2 수정 전 확정 가능",False)
    c.page.locator("#rd-ag-plus").click()
    c.eq(_game(c)["stage"],"draft","7.2 수정하면 초안")
    _disabled(c,["rd-lock"],"7.2 수정한 초안은 확정 불가")
    c.page.locator("#rd-ag-minus").click()
    c.eq(_game(c)["stage"],"ready","7.2 되돌리면 ready 복귀")
    _disabled(c,["rd-lock"],"7.2 되돌린 뒤 확정 가능",False)
    c.page.locator("#rd-lock").click()
    g=_game(c)
    c.eq([len(g["rounds"]),g["stage"]],[1,"locked"],"7.2 추가 제출 없이 확정")
    c.page.reload();c.page.wait_for_selector("#rd-root")
    c.eq(_game(c)["stage"],"locked","7.2 새로고침 뒤 확정 유지")


def t_rev_question_balance(c: Ctx):
    # 8절 개정: 농민이 심각 미달이면 고정 순서와 무관하게 질문을 받는다(개정 전에는 빠졌다).
    s=_state(_plan(20,0,80,.3),"auto",locked=True)
    _inject(c,s)
    c.phase("room")
    # 세 곳 모두 심각 미달: 기준과의 상대 거리(도시 공급 0 > 농가 소득 > 비축) 순으로 모두 묻는다.
    _keys(c,COMMON+["rd-city","rd-ag","rd-dam-future","rd-science"],"8 공정성")
    texts=" ".join(q["q"] for q in _questions(c))
    c.expect("쉬운 타협이 되지 않았는지" in texts,"8 공사 비축 대표성 질문 합침")


def t_12_4_reflection(c: Ctx):
    _lock_n(c)
    c.phase("reflect")
    c.expect(c.page.locator("#exwrap").is_hidden(),"12.4-1 관문 전 예시·해설 숨김")
    for text in ("         ","가나다라마바사아자"):
        c.page.locator("#before-s-riverdeal").fill(text)
        _disabled(c,["openEx"],"12.4-1")
        c.expect(c.page.locator("#exwrap").is_hidden(),"12.4-1 trim 10자 미만 숨김")
    c.page.locator("#before-s-riverdeal").fill("가나다라마바사아자차")
    c.page.locator("#openEx").click()
    c.expect(c.page.locator("#exwrap #rd-reflect").is_visible(),"COMMON-3 공통 관문 안 성찰 내용 표시")
    c.eq(c.page.locator("#rd-examples details").count(),4,"12.4-1 가상 예시 네 개")
    c.eq(c.page.locator("#rd-examples details[open]").count(),0,"12.4-1 초기 details 전부 닫힘")
    c.eq(c.page.locator("#rd-reflect button, #rd-reflect textarea, #rd-reflect input").count(),0,"12.4-1 자체 관문 없음")
    for id_ in ("rd-science-water","rd-science-oxygen","rd-science-crop","rd-model-limits"):
        c.expect(c.page.locator(f"#{id_}").is_visible(),"12.4-1 과학 해설과 한계도 공통 관문 뒤 표시")
    for id_,values in (("life",["35억","100.0%","0.898","5.099","84.00","44.00","5.973"]),
                       ("eco",["50억","5.986","6.604","0.847","95.7%","83.00"]),
                       ("future",["116.00","0.455","58.3%","3.318","76.00","농민과 도시는 거부","하구는 조건부"]),
                       ("farm",["올해 농가 생계 우선","30억","1.000","100.0%","4.585","5.299","89.00","49.00","다수 합의안"])):
        summary=c.page.locator(f"#rd-example-{id_} summary")
        summary.focus();summary.press("Enter")
        _has(c,f"#rd-example-{id_}",values,"12.4-1")
        if id_=="life":
            c.expect(c.page.locator("#rd-example-eco").get_attribute("open") is None,"12.4-1 다른 예시는 독립 닫힘")
    for loc in c.page.locator("#exwrap details").all():
        loc.evaluate("e=>e.open=true")
    # 명세 3절·4.3의 활동 약속과 10절 모형 한계: “강제하지 않는 선택지”는 성찰에서 확인한다.
    _has(c,"#rd-model-limits",["강제하지 않는 선택지"],"N1 감량 순서 설명 위치")
    # 성찰 개정: 3자 합의 비율, 실제 댐 감량 순서, 염분 침입, FAO-33 근거와 적용 한계.
    _has(c,"#rd-model-limits",["11,602,477","94.2%","5.0%","0.7%","0.003%","관심→주의→경계→심각","하천유지유량","환경생태유량","염분 침입","기수역"],"성찰 개정")
    _has(c,"#rd-science-crop",["FAO","33호","Ky","50%","83%"],"성찰 개정")
    c.check("12.4-3 성찰 모든 details 펼침")


def t_12_4_keyboard(c: Ctx):
    c.goto("#ys-riverdeal",wait="#rd-root")
    c.page.locator("#rd-mode-auto").focus();c.page.keyboard.press("Space")
    c.page.locator("#rd-criterion").focus();c.page.keyboard.type(CRITERION)
    for key,maxlength in (("criterion","200"),("decision-reason","200"),("gain","200"),("loss","200"),("final-text","1000")):
        c.eq(c.page.locator(f"#rd-{key}").get_attribute("maxlength"),maxlength,"12.4-2 입력 길이 제한")
    tab=c.page.locator("#rd-tab-basin")
    tab.focus();tab.press("ArrowRight")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-tab-parties","12.4-2 탭 오른쪽 로빙")
    c.page.keyboard.press("Enter")
    c.expect(c.page.locator("#rd-pane-parties").is_visible(),"12.4-2 Enter 탭 활성화")
    c.page.keyboard.press("ArrowRight");c.page.keyboard.press("Space")
    c.expect(c.page.locator("#rd-pane-clauses").is_visible(),"12.4-2 Space 조항 탭 활성화")
    c.page.keyboard.press("End")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-tab-model","12.4-2 탭 End")
    c.page.keyboard.press("Enter")
    c.expect(c.page.locator("#rd-pane-model").is_visible(),"12.4-2 계산 근거 탭 활성화")
    c.page.keyboard.press("Home")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-tab-basin","12.4-2 탭 Home")
    c.page.keyboard.press("Enter")
    c.expect(c.page.locator("#rd-pane-basin").is_visible(),"12.4-2 유역 탭 활성화")
    c.page.keyboard.press("ArrowLeft")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-tab-model","12.4-2 탭 왼쪽 순환")
    c.eq(c.page.locator('[role="tab"][tabindex="0"]').count(),1,"12.4-2 탭 하나만 tabindex0")
    for suffix in ("basin","parties","clauses","model"):
        t=c.page.locator(f"#rd-tab-{suffix}");p=c.page.locator(f"#rd-pane-{suffix}")
        c.eq(t.get_attribute("aria-controls"),f"rd-pane-{suffix}","12.4-2 탭 controls")
        c.eq(p.get_attribute("aria-labelledby"),f"rd-tab-{suffix}","12.4-2 패널 labelledby")
    loc=c.page.locator("#rd-ag");loc.focus();loc.press("ArrowUp");loc.press("ArrowDown")
    c.eq(loc.input_value(),"50","12.4-2 number 위아래 조작")
    focus_style=loc.evaluate("e=>{const s=getComputedStyle(e);return {width:s.outlineWidth,style:s.outlineStyle,offset:parseFloat(s.outlineOffset)}}")
    c.eq(focus_style["width"],"2px","12.4-2 키보드 초점 테두리2px")
    c.eq(focus_style["style"],"solid","12.4-2 키보드 초점 실선")
    c.expect(focus_style["offset"]>0,"12.4-2 키보드 초점 outline-offset")
    for key in ("ag","city","env"):
        for sign in ("plus","minus"):
            b=c.page.locator(f"#rd-{key}-{sign}");b.focus();b.press("Enter")
            c.expect("1백만 m³" in (b.get_attribute("aria-label") or ""),"12.4-2 스테퍼 단위 포함 접근 이름")
    for key in ("save","link","pulse"):
        b=c.page.locator(f"#rd-{key}");b.focus();b.press("Space");b.press("Space")
    c.page.locator("#rd-order").focus();c.page.keyboard.press("ArrowDown")
    c.page.locator("#rd-order").press("ArrowUp")
    c.page.locator("#rd-submit").focus();c.page.keyboard.press("Enter")
    c.expect(c.page.evaluate("document.activeElement.closest('#rd-responses')!==null"),"12.4-2 제출 뒤 반응 제목 초점")
    c.page.locator("#rd-want-a").focus();c.page.keyboard.press("Space")
    c.page.locator("#rd-counter-start").focus();c.page.keyboard.press("Enter")
    loc=c.page.locator("#rd-env");loc.focus();loc.press("ArrowDown")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-env","12.4-2 타이핑·숫자 갱신이 초점 보존")
    c.page.locator("#rd-decision-reason").focus();c.page.keyboard.type(REASON)
    c.page.locator("#rd-apply").focus();c.page.keyboard.press("Enter")
    c.expect(c.page.evaluate("document.activeElement.closest('#rd-cascade')!==null"),"12.4-2 반영 뒤 연쇄 제목 초점")
    c.page.locator("#rd-submit").focus();c.page.keyboard.press("Enter")
    c.page.locator("#rd-decision-reason").focus();c.page.keyboard.type(REASON)
    c.page.locator("#rd-reject").focus();c.page.keyboard.press("Enter")
    # 5.4·7.4·12.4-2: 초점 단언 전에 상정 방식 선택 완료를 확인한다.
    # 데스크톱에서 선택이 반영되지 않아 disabled 버튼에 focus했는지는 재검사로 구분한다.
    # 기본 <select>의 닫힌 상태 키 동작은 운영체제마다 다르다(macOS Chromium은 End로 목록을 연다).
    # 키보드 접근성은 브라우저 기본 컨트롤이 보장하므로, 포커스를 준 뒤 값 선택만 검사한다.
    c.page.locator("#rd-final-mode").focus()
    c.page.select_option("#rd-final-mode", "administrative")
    c.eq(c.page.locator("#rd-final-mode").input_value(),"administrative","12.4-2 키보드 상정 방식 선택 완료")
    for id_,text in (("gain","현재 공급을 지킨다."),("loss","비축을 줄인다."),("final-text","가상 합의로 부담을 나눈다.")):
        c.page.locator(f"#rd-{id_}").focus();c.page.keyboard.type(text)
    _disabled(c,["rd-lock"],"12.4-2 확정 전 필수 입력 완료",False)
    c.page.locator("#rd-lock").focus();c.page.keyboard.press("Enter")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-go","12.4-2 확정 뒤 이동 초점")
    _disabled(c,["rd-unlock"],"12.4-2 확정 뒤 다시 계획하기 가능",False)
    c.page.locator("#rd-unlock").focus();c.page.keyboard.press("Enter")
    c.eq(c.page.evaluate("document.activeElement.id"),"rd-ag","12.4-2 다시 계획하기 초점")
    c.page.locator("#rd-ag").fill("81")
    described=c.page.locator("#rd-ag").get_attribute("aria-describedby") or ""
    c.expect(bool(described) and c.page.evaluate("ids=>ids.split(/\\s+/).every(id=>!!document.getElementById(id))",described),"12.4-2 오류 aria-describedby 실제 대상")
    c.eq(c.page.locator("#rd-status").get_attribute("aria-live"),"polite","12.4-2 상태만 polite 낭독")
    c.eq(c.page.locator("#rd-results[aria-live]").count(),0,"12.4-2 매 입력 전체 결과 live 낭독 없음")
    for k in ("criterion","gain","loss","final-text"):
        loc=c.page.locator(f"#rd-{k}")
        c.eq(loc.get_attribute("aria-required"),"true","12.4-2 필수 접근 속성")
        c.expect("필수" in c.page.locator(f'label[for="rd-{k}"]').inner_text(),"12.4-2 필수 라벨")


def t_12_4_layout_contrast(c: Ctx):
    s=_state(mode="role",locked=True)
    s["game"]["locked"]["final"]["text"]="가"*1000
    s["game"]["final"]["text"]="가"*1000
    for h in s["game"]["locked"]["rounds"][0]["human"].values():h["line"]="가"*200
    s["game"]["rounds"]=copy.deepcopy(s["game"]["locked"]["rounds"])
    _inject(c,s)
    for loc in c.page.locator("#rd-root details").all():loc.evaluate("e=>e.open=true")
    c.check("12.4-3 준비실 긴 발언·합의·이력")
    c.expect(c.page.evaluate("document.documentElement.scrollWidth<=innerWidth"),"12.4-3 준비실 문서 폭")
    # 대비 API도 사용하고, 반투명 배경은 아래에서 실제 합성해 다시 검사한다.
    composite_js="""sel=>{
      const el=document.querySelector(sel),parse=s=>{const p=s.match(/[\\d.]+/g)?.map(Number);return p?{r:p[0],g:p[1],b:p[2],a:p[3]??1}:null;};
      const over=(a,b)=>({r:a.r*a.a+b.r*(1-a.a),g:a.g*a.a+b.g*(1-a.a),b:a.b*a.a+b.b*(1-a.a),a:1});
      let bg={r:255,g:255,b:255,a:1};const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);
      for(const p of chain){const c=parse(getComputedStyle(p).backgroundColor);if(c)bg=over(c,bg);}
      const fg=over(parse(getComputedStyle(el).color),bg),lum=c=>{const f=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
      const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }"""
    for id_ in ("rd-assumptions","rd-do-caution","rd-do-threshold","rd-coefficients"):
        sel=f"#{id_}";loc=c.page.locator(sel)
        c.expect(loc.is_visible(),"12.4-4 필수 주석 상시 노출")
        c.expect(c.contrast(sel)>=4.5,"12.4-4 harness 대비4.5 이상")
        c.expect(c.page.evaluate(composite_js,sel)>=4.5,"12.4-4 실제 합성 배경 대비4.5 이상")
        c.expect("hint" not in (loc.get_attribute("class") or "").split(),"12.4-4 주석 hint 없음")
        c.expect(loc.evaluate("e=>parseFloat(getComputedStyle(e).fontSize)>=14"),"12.4-4 주석 글자14px 이상")
    c.eq(c.page.locator("#rd-map").get_attribute("role"),"img","12.4-2 SVG 이미지 역할")
    c.expect(c.page.locator("#rd-map title").count()>0 and c.page.locator("#rd-map desc").count()>0,"12.4-2 SVG 제목·설명")
    for k in ("ag","city","env"):
        c.expect(c.page.locator(f"#rd-{k}").evaluate("e=>parseFloat(getComputedStyle(e).fontSize)>=16"),"12.4-3 입력 글자16px")
    for loc in c.page.locator("#rd-root button").all():
        if loc.is_visible():c.expect(loc.bounding_box()["height"]>=44,"12.4-3 버튼 높이44px")
    c.phase("room");c.check("12.4-3 면접실 긴 원문")
    c.phase("reflect")
    c.page.locator("#before-s-riverdeal").fill(CRITERION);c.page.locator("#openEx").click()
    for loc in c.page.locator("#phase details").all():loc.evaluate("e=>e.open=true")
    c.check("12.4-3 성찰 모든 details")
    # 200% 확대에 해당하는 CSS viewport 축소로 실제 재배치를 확인한다.
    c.page.set_viewport_size(dict(width=c.cfg.width//2,height=c.cfg.height//2))
    c.check("12.4-3 성찰 200% 상당 재배치")
    c.phase("room");c.check("12.4-3 면접실 200% 상당 재배치")
    c.phase("prep");c.check("12.4-3 준비실 200% 상당 재배치")


def t_12_4_static_network(c: Ctx):
    result=subprocess.run(["node","--check",str(ROOT/"games/s-riverdeal.js")],capture_output=True,text=True)
    c.eq(result.returncode,0,"12.4-5 게임 JS 구문 검사")
    css_path=ROOT/"games/s-riverdeal.css"
    css=css_path.read_text() if css_path.exists() else ""
    clean=re.sub(r"/\*.*?\*/","",css,flags=re.S)
    selectors=[]
    for text in re.findall(r"([^{}]+)\{",clean):
        for line in text.strip().splitlines():
            line=line.strip()
            if not line or line.startswith("@"):continue
            selectors.append(line)
    c.expect(bool(selectors),"12.4-5 게임 CSS 규칙 존재")
    for sel in selectors:
        c.expect(sel.startswith((".rd-","#rd-")) and "," not in sel,f"12.4-5 CSS 접두어·한 줄 한 선택자 {sel}")
    c.expect(not re.search(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(",clean),"12.4-5 새 색 리터럴 없음")
    c.expect(not re.search(r"color\s*:\s*var\(--(?:warn|ink-3)\)",clean),"12.4-5 장식용 색을 글자색으로 사용 안 함")
    c.expect(re.search(r"\.rd-notice\s*\{[^}]*color\s*:\s*var\(--ink-2\)[^}]*font-size\s*:\s*14px",clean) is not None,"12.4-5 필수 주석 CSS 계약")
    # 12.4-5·4.4절: 게임 데이터의 원격 요청을 금지한다. 명세가 정하지 않은 폰트 중
    # index.html의 공통 Google Fonts가 문자 등장 때 지연 로드하는 woff만 제외한다.
    # 다른 호스트·종류의 요청과 주입 문자열 요청은 계속 실패로 잡는다.
    requests=[]
    c.page.on("request",lambda r:requests.append(r.url)
              if not (r.resource_type=="font" and urlsplit(r.url).hostname=="fonts.gstatic.com") else None)
    before=c.page.evaluate("({keys:Object.keys(localStorage).filter(k=>k!=='kcp:v1:s-riverdeal').map(k=>[k,localStorage.getItem(k)]),order:KCP.ORDER.slice(),functions:['save','load','josa','lines','hbar'].map(k=>String(KCP[k]))})")
    _lock_n(c)
    for tab in ("basin","parties","clauses","model"):c.page.locator(f"#rd-tab-{tab}").click()
    c.page.locator("#rd-go").click();c.phase("reflect")
    c.page.locator("#before-s-riverdeal").fill(CRITERION);c.page.locator("#openEx").click()
    after=c.page.evaluate("({keys:Object.keys(localStorage).filter(k=>k!=='kcp:v1:s-riverdeal').map(k=>[k,localStorage.getItem(k)]),order:KCP.ORDER.slice(),functions:['save','load','josa','lines','hbar'].map(k=>String(KCP[k]))})")
    c.eq(after,before,"12.4-5 기존 함수·게임 순서·다른 저장 키 보존")
    c.eq(requests,[],"12.4-5 게임 조작 중 네트워크 요청 없음")
    scripts=c.page.locator("script[src]").evaluate_all("es=>es.map(e=>e.getAttribute('src'))")
    c.expect(all(not re.match(r"(?:https?:)?//",src) for src in scripts),"12.4-5 외부 라이브러리 스크립트 없음")
    # 12.4-5: 이 시나리오의 콘솔·페이지 오류를 검사한다. rec는 모든 새 context의
    # 누적 기록이다. 이전 검사 오류도 harness가 별도로 실패 집계하므로 누락되지 않는다.
    c.eq([m for m in c.rec["console"] if m["test"]==c.test],[],"12.4-5 콘솔 error/warn 없음")
    c.eq([m for m in c.rec["pageerrors"] if m["test"]==c.test],[],"12.4-5 페이지 오류 없음")
    c.expect(c.page.evaluate("!Object.hasOwn(KCP.games['s-riverdeal'],'afterReflect')"),"12.4-1 자체 afterReflect 없음")


def t_12_4_integration(c: Ctx):
    c.goto("#home",wait=".home-grid")
    card=c.page.locator('#home-originals .opkg[href="#ys-riverdeal"]')
    c.eq(card.count(),1,"COMMON-1 홈 창작 구역에 게임 카드 하나")
    c.eq(c.page.locator(".pkg").count(),5,"COMMON-1 기출 다섯 카드 유지")
    _has(c,'#home-originals .opkg[href="#ys-riverdeal"]',
         ["은여울강 가뭄 협상", "물을 나누고 역제안을 주고받으며, 지금의 생활·생계와 하구 생태, 미래의 비축 사이에서 합의안을 만듭니다.",
          "물 배분","생태계","에너지","합의와 책임"],"12.4-6")
    card.click();c.page.wait_for_selector("#rd-root")
    c.eq(c.page.evaluate("location.hash"),"#ys-riverdeal","12.4-6 창작 ID 라우팅")
    _has(c,".brief",["창작 게임 · 가상 자료"],"COMMON-1")
    c.check("COMMON-1 준비실")
    _lock_n(c);c.page.locator("#rd-go").click()
    _keys(c,NKEYS,"12.4-6")
    c.phase("reflect")
    panel=c.page.locator("section.panel").filter(has=c.page.locator("#rsum"))
    c.expect("연습용 평가 기준" in panel.inner_text(),"COMMON-3 자기 평가 머리")
    c.eq(c.page.locator("table.rubric tbody tr").count(),9,"12.4-6 연습 평가 기준9개")
    c.eq(c.page.locator(".intent li").count(),6,"12.4-6 설계 의도6개")
    c.eq(c.page.locator("#phase h3").filter(has_text="설계 의도").count(),1,"COMMON-3 설계 의도 머리")
    c.page.locator('.seg button[data-v="3"]').first.click()
    _has(c,"#rsum",["점검 1/9"],"12.4-6 문자열 ID 자기평가")
    c.page.locator("#before-s-riverdeal").fill(CRITERION);c.page.locator("#openEx").click()
    c.page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{window.__rdCopy=t;return Promise.resolve();}}})")
    c.page.locator("#copyAll").click()
    copied=c.page.evaluate("window.__rdCopy || ''")
    c.expect(copied.startswith("[은여울강 가뭄 협상 · 창작 쟁점 게임 연습]"),"12.4-6 문자열 ID 복사 제목")
    c.expect("NaN" not in copied and "실제 수질 예측이 아닙니다" in copied,"12.4-6 복사에도 과학 경고 유지")
    c.check("COMMON-3 성찰")


def t_12_4_exhaustive(c: Ctx):
    # 전수 탐색은 환경과 무관한 Node 검사여서 네 환경 중 한 번만 실행한다.
    if c.cfg.name != "desktop-light":
        return
    # 59,521,392개 전수 탐색이 멈추면 무한 대기하지 않도록 넉넉한 시간 제한을 둔다(worker 분할 실행).
    try:
        result=subprocess.run(["node",str(ROOT/"tests/model_s-riverdeal.mjs")],capture_output=True,text=True,timeout=1800)
    except subprocess.TimeoutExpired as e:
        c.expect(False,f"12.4-7 전수 탐색 1800초 시간 초과\n{e.stdout or ''}{e.stderr or ''}")
        return
    c.eq(result.returncode,0,"12.4-7 59,521,392개·전체16행×6열·검산·분기 대조\n"+result.stdout+result.stderr)


def t_12_4_corrupt_storage(c: Ctx):
    for game in ("손상된 가상 저장값",[],{"version":"rd-v2","proposal":_plan(81,-1,1.5),"mask":99,"rounds":[None]*5}):
        _inject(c,{"phase":"prep","game":game})
        c.expect(c.page.locator("#rd-root").is_visible(),"COMMON-4 손상 game 문자열·배열·범위 밖 복구")
        c.eq(c.rec["pageerrors"],[],"COMMON-4 손상 저장값에서 페이지 오류 없음")
        _disabled(c,["rd-go"],"COMMON-4")
        c.check("COMMON-4 복구된 준비실")


if __name__ == "__main__":
    main(globals())
