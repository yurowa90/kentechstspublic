#!/usr/bin/env bash
# 서버·인자·목록 오류만 종료 코드 2. 검사 실패를 포함한 나머지는 0이며 judge.py가 판정한다.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd) || exit 2
cd "$ROOT" || exit 2
source "$ROOT/tests/ci/lib.sh"

SUITES=tests/ci/suites.txt
COUNTS=tests/ci/baseline-counts.txt
PORT=${PORT:-8000}
OUT=tests/results/ci/browser
PY=${PY:-tests/.venv/bin/python}
SRV_PY=${SRV_PY:-python3}
CI_MAX_LOAD=${KCP_MAX_LOAD:-150}
LIMIT=${KCP_TEST_TIMEOUT:-2400}
MODE=''
SHARD=''
LIST=0
CHECK=0
SHARDS=0
NAMES=()
SERVER_PID=''
PROBE=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --port|--out|--shard)
      [ "$#" -ge 2 ] && [ -n "$2" ] || ci_error "$1 값 필요"
      case "$1" in
        --port) PORT=$2 ;;
        --out) OUT=$2 ;;
        --shard)
          [ -z "$MODE" ] || ci_error '검사 선택 방식 중복'
          MODE=shard
          SHARD=$2
          ;;
      esac
      shift 2
      ;;
    --all)
      [ -z "$MODE" ] || ci_error '검사 선택 방식 중복'
      MODE=all
      shift
      ;;
    --list) LIST=1; shift ;;
    --check) CHECK=1; shift ;;
    --shards) SHARDS=1; shift ;;
    --*) ci_error "알 수 없는 인자: $1" ;;
    *) NAMES[${#NAMES[@]}]=$1; shift ;;
  esac
done

ci_positive_integer "$PORT" && [ "$PORT" -le 65535 ] || ci_error '포트는 1~65535 정수 필요'
ci_positive_integer "$LIMIT" || ci_error '시간 제한은 양의 정수 필요'
[[ "$CI_MAX_LOAD" =~ ^[0-9]+([.][0-9]+)?$ ]] || ci_error '부하 한도는 0 이상의 수 필요'
if [ "$MODE" = shard ]; then
  ci_positive_integer "$SHARD" || ci_error '샤드는 양의 정수 필요'
fi
[ -r "$SUITES" ] || ci_error '검사 목록 파일 없음'
[ -r "$COUNTS" ] || ci_error '기준 수치 파일 없음'

# 목록 확인. CI 매트릭스는 이 파일의 샤드 번호에서 만들므로(--shards) 칸이 틀린 줄이 어느 샤드에서도
# 돌지 않고 빠지는 일이 없어야 한다. 필수 검사는 기준 수치(baseline-counts.txt)도 있어야 한다.
problems=$(awk '
  FILENAME == ARGV[1] {
    if ($0 !~ /^[[:space:]]*(#|$)/ && $1 == "browser") counted[$2] = 1
    next
  }
  /^[[:space:]]*(#|$)/ { next }
  {
    if (NF < 3 || NF > 4) { printf "%d번째 줄: 이름·샤드·예상초[·optional|mac] 칸 수 오류\n", FNR; next }
    if ($1 !~ /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/) printf "%d번째 줄: 잘못된 검사 이름 %s\n", FNR, $1
    if ($2 !~ /^[1-9][0-9]*$/) printf "%d번째 줄: 샤드는 1 이상의 정수 필요(%s)\n", FNR, $2
    if ($3 !~ /^[0-9]+$/) printf "%d번째 줄: 예상초는 0 이상의 정수 필요(%s)\n", FNR, $3
    if (NF == 4 && $4 != "optional" && $4 != "mac") printf "%d번째 줄: 넷째 칸은 optional·mac만 허용(%s)\n", FNR, $4
    if (seen[$1]++) printf "%d번째 줄: 중복된 검사 이름 %s\n", FNR, $1
    if ((NF == 3 || $4 == "mac") && !($1 in counted)) printf "%d번째 줄: %s 의 기준 수치가 baseline-counts.txt에 없음\n", FNR, $1
  }' "$COUNTS" "$SUITES")
[ -z "$problems" ] || ci_error "suites.txt 확인 실패: $(printf '%s' "$problems" | tr '\n' ' ')"

if [ "$CHECK" -eq 1 ] || [ "$SHARDS" -eq 1 ]; then
  [ -z "$MODE" ] && [ "${#NAMES[@]}" -eq 0 ] && [ "$LIST" -eq 0 ] || ci_error '--check·--shards는 다른 선택과 함께 쓸 수 없음'
  if [ "$SHARDS" -eq 1 ]; then
    # GitHub Actions matrix에 그대로 넣는 JSON 배열(예: [1,2,3]).
    awk '!/^[[:space:]]*(#|$)/ {print $2}' "$SUITES" | sort -n -u | paste -s -d, - | sed 's/^/[/; s/$/]/'
  else
    printf 'suites.txt 확인: %s줄, 샤드 %s\n' "$(awk '!/^[[:space:]]*(#|$)/' "$SUITES" | wc -l | tr -d ' ')" \
      "$(awk '!/^[[:space:]]*(#|$)/ {print $2}' "$SUITES" | sort -n -u | paste -s -d, -)"
  fi
  exit 0
fi

if [ -n "$MODE" ]; then
  [ "${#NAMES[@]}" -eq 0 ] || ci_error '이름과 샤드·전체 선택은 함께 쓸 수 없음'
  while IFS= read -r name; do
    NAMES[${#NAMES[@]}]=$name
    # mac 표시 검사는 CI 샤드에서 돌리지 않고 --all(맥 로컬 최종 확인)에서만 돈다(README 'CI에서 빼는 검사').
done < <(awk -v mode="$MODE" -v shard="$SHARD" '!/^[[:space:]]*(#|$)/ && (mode == "all" || ($2 == shard && $4 != "mac")) {print $1}' "$SUITES")
fi
if [ "$MODE" = shard ]; then
  [ "${#NAMES[@]}" -gt 0 ] || ci_error "suites.txt에 샤드 $SHARD 검사가 없음"
fi
[ "${#NAMES[@]}" -gt 0 ] || ci_error '검사 이름 또는 --shard·--all 필요'
for name in "${NAMES[@]}"; do
  [[ "$name" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$ ]] || ci_error "잘못된 검사 이름: $name"
done
if [ "$LIST" -eq 1 ]; then
  printf '%s\n' "${NAMES[@]}"
  exit 0
fi

cleanup() {
  ci_cleanup_run
  if [ -n "$SERVER_PID" ]; then
    ci_signal_tree TERM "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || :
  fi
  [ -z "$PROBE" ] || rm -f "$PROBE"
}
trap cleanup EXIT

# 결과 폴더와 기대 목록을 먼저 만든다. 그 뒤의 실행기 오류(파이썬 없음, 포트 충돌, 서버 기동 실패, 중단 신호)는
# runner-error.txt에 남고, judge.py는 돌지 못한 검사를 '실행 안 됨'으로 판정한다.
mkdir -p "$OUT" || ci_error '결과 폴더 생성 실패'
OUT=$(cd "$OUT" && pwd) || ci_error '결과 폴더 확인 실패'
rm -f "$OUT/runner-error.txt"
CI_ERROR_LOG="$OUT/runner-error.txt"
trap 'ci_error "중단 신호(INT·TERM)를 받아 멈춤"' INT TERM
: > "$OUT/status.tsv" || ci_error '상태 파일 생성 실패'
: > "$OUT/summary.txt" || ci_error '요약 파일 생성 실패'
printf '%s\n' "${NAMES[@]}" > "$OUT/expected.txt" || ci_error '기대 목록 파일 생성 실패'

# 파이썬이 없으면 모든 검사가 127로 끝나 원인이 흐려지므로 시작 전에 막는다.
command -v "$PY" >/dev/null 2>&1 || ci_error "파이썬 실행 파일 없음: $PY (PY로 지정)"

URL="http://127.0.0.1:$PORT/index.html"
if curl -sS --connect-timeout 1 --max-time 2 -o /dev/null "$URL" 2>/dev/null; then
  ci_error "포트 $PORT 에 이미 응답하는 서버가 있음"
fi
PROBE="$OUT/.index.$$"
"$SRV_PY" tests/srv.py "$PORT" "$ROOT" > "$OUT/srv.log" 2>&1 &
SERVER_PID=$!
# 새 실행기(macOS 등)는 첫 파이썬 기동이 느릴 수 있어 60초까지 기다린다(서버 준비 확인일 뿐 검사 대기 상한이 아니다).
deadline=$(( $(date +%s) + 60 ))
ready=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  kill -0 "$SERVER_PID" 2>/dev/null || ci_error '서버 시작 실패: srv.log 확인 필요'
  if curl -fsS --connect-timeout 1 --max-time 1 "$URL" -o "$PROBE" 2>/dev/null; then
    cmp -s "$ROOT/index.html" "$PROBE" || ci_error '서버의 index.html이 작업 루트와 다름'
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  { echo '--- curl -v'; curl -v --max-time 3 "$URL" -o /dev/null 2>&1 | tail -15; echo '--- lsof'; lsof -nP -iTCP:"$PORT" 2>&1 | head; echo '--- srv.log'; cat "$OUT/srv.log"; } > "$OUT/server-diag.txt" 2>&1 || true
  ci_error '60초 안에 서버가 준비되지 않음(server-diag.txt 참고)'
fi
rm -f "$PROBE"
PROBE=''

for name in "${NAMES[@]}"; do
  safe=${name//:/__}
  log="$OUT/$safe.log"
  file="tests/league/$name.py"
  args=("$URL")
  case "$name" in
    ux_task:*) file=tests/league/ux_task.py; args=("$URL" --cfg "${name#ux_task:}") ;;
    webkit) file=tests/league/webkit.py ;;
  esac
  if [ ! -f "$file" ]; then
    optional=$(awk -v name="$name" '$1 == name && $4 == "optional" {print "yes"; exit}' "$SUITES")
    CI_CODE=-
    CI_SECONDS=0
    # 선택 검사(suites.txt의 optional)는 SKIP, 그 밖은 MISSING으로 남기고 judge.py가 실패로 판정한다.
    if [ "$optional" = yes ]; then CI_STATE=skip; mark=SKIP; else CI_STATE=missing; mark=MISSING; fi
    printf '%s 검사 파일 없음: %s\n' "$mark" "$file" > "$log"
  else
    ci_wait_load
    ci_run_limited "$log" "$LIMIT" "$PY" "$file" "${args[@]}"
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$CI_CODE" "$CI_SECONDS" "$CI_STATE" >> "$OUT/status.tsv"
  load=$(ci_load)
  last=$(tail -n 1 "$log" | cut -c1-140)
  line="$name exit=$CI_CODE ${CI_SECONDS}s load=${load:-모름} state=$CI_STATE :: $last"
  printf '%s\n' "$line" | tee -a "$OUT/summary.txt"
done
exit 0
