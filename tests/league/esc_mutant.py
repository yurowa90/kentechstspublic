"""fx_event Esc 블록의 변이 확인용 사본을 만든다(2026-10-21, 5448fbe).

HEAD 트리를 OUT 폴더에 풀고 ui/fx-turn.js의 topEscape를 'Esc면 덱을 닫고 전파는 막지 않음'으로 바꾼다.
그러면 Esc 한 번에 카드와 리그 서랍(또는 코치·대화상자 뒤의 예보)이 함께 닫힌다(D-83 '한 번에 한 층' 위반).
이 사본을 서버로 띄워 fx_event.py를 돌리면 Esc 단언이 실패해야 한다(5448fbe 기록 37건).
바꿀 줄이 없으면(구현이 바뀌어) 멈추고 알린다. 저장소 파일은 건드리지 않는다.
사용: python3 tests/league/esc_mutant.py <OUT 폴더>  →  (cd <OUT> && python3 <저장소>/tests/srv.py <포트> .)
"""
import os, subprocess, sys
out = sys.argv[1]
root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
os.makedirs(out, exist_ok=True)
archive = subprocess.run(["git", "-C", root, "archive", "HEAD"], capture_output=True, check=True).stdout
subprocess.run(["tar", "-x", "-C", out], input=archive, check=True)
path = os.path.join(out, "ui", "fx-turn.js")
src = open(path, encoding="utf-8").read()
head = "const topEscape = (e, close) => {\n"
start = src.find(head)
end = src.find("\n  };", start)
if src.count(head) != 1 or end < 0 or "close();" not in src[start:end]:
    sys.exit("topEscape 본문을 찾지 못했다: 구현이 바뀌었으면 변이를 다시 정해야 한다")
# 본문 전체를 갈아 끼운다(조건 줄이 늘거나 바뀌어도 같은 변이가 되게).
src = src[:start + len(head)] + '    if (e.key !== "Escape" || !deck) return;\n    close();' + src[end:]
open(path, "w", encoding="utf-8").write(src)
print("변이 사본:", out)
