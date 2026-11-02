#!/usr/bin/env bash
# 인자·목록 오류만 종료 코드 2(--check는 목록과 파일이 어긋나면 1). 검사는 끝까지 실행하고 judge.py가 결과를 판정한다.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd) || exit 2
cd "$ROOT" || exit 2
source "$ROOT/tests/ci/lib.sh"

LIST_FILE=tests/ci/node-suites.txt
OUT=tests/results/ci/node
PART=all
CHECK=0
NODE=${NODE:-node}
LIMIT=${KCP_TEST_TIMEOUT:-5400}
COUNT_PY=${COUNT_PY:-python3}  # 실패 표지 집계용(표준 라이브러리만)

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out|--part)
      [ "$#" -ge 2 ] && [ -n "$2" ] || ci_error "$1 값 필요"
      if [ "$1" = --out ]; then OUT=$2; else PART=$2; fi
      shift 2
      ;;
    --check) CHECK=1; shift ;;
    *) ci_error "알 수 없는 인자: $1" ;;
  esac
done
case "$PART" in all|heavy|rest) ;; *) ci_error '검사 범위는 all·heavy·rest 중 하나 필요' ;; esac
ci_positive_integer "$LIMIT" || ci_error '시간 제한은 양의 정수 필요'

if [ "$CHECK" -eq 0 ]; then
  mkdir -p "$OUT" || ci_error '결과 폴더 생성 실패'
  OUT=$(cd "$OUT" && pwd) || ci_error '결과 폴더 확인 실패'
  rm -f "$OUT/runner-error.txt"
  CI_ERROR_LOG="$OUT/runner-error.txt"
  : > "$OUT/status.tsv" || ci_error '상태 파일 생성 실패'
  : > "$OUT/summary.txt" || ci_error '요약 파일 생성 실패'
  : > "$OUT/expected.txt" || ci_error '기대 목록 파일 생성 실패'
  trap ci_cleanup_run EXIT
  # 중단돼도 judge.py가 '실행기 오류'와 '실행 안 됨'으로 알 수 있게 한다.
  trap 'ci_error "중단 신호(INT·TERM)를 받아 멈춤"' INT TERM
fi

name_of() {
  local base
  base=$(basename "$1" .js)
  case "$1" in */review/*) printf 'r-%s\n' "$base" ;; *) printf '%s\n' "$base" ;; esac
}

# 목록 형식 확인: 두 칸, 경로 모양, 묶음 이름, 경로·검사 이름 중복.
[ -r "$LIST_FILE" ] || ci_error "Node 검사 목록 없음: $LIST_FILE"
problems=$(awk '
  /^[[:space:]]*(#|$)/ { next }
  {
    if (NF != 2) { printf "%d번째 줄: 경로와 묶음 두 칸 필요\n", NR; next }
    if ($1 !~ /^tests\/league\/(review\/)?[A-Za-z0-9_.-]+\.js$/) { printf "%d번째 줄: 경로는 tests/league/ 아래 .js 필요\n", NR }
    if ($2 != "heavy" && $2 != "rest" && $2 != "ignore") { printf "%d번째 줄: 묶음은 heavy·rest·ignore 중 하나\n", NR }
    if (seen[$1]++) { printf "%d번째 줄: 중복된 경로 %s\n", NR, $1 }
    n = $1; sub(/^.*\//, "", n); sub(/\.js$/, "", n); if ($1 ~ /\/review\//) n = "r-" n
    if ($2 != "ignore" && named[n]++) { printf "%d번째 줄: 검사 이름 %s 중복\n", NR, n }
  }' "$LIST_FILE")
[ -z "$problems" ] || ci_error "Node 검사 목록 형식 오류: $(printf '%s' "$problems" | tr '\n' ' ')"

LISTED=()
PARTS=()
while read -r path part; do
  LISTED[${#LISTED[@]}]=$path
  PARTS[${#PARTS[@]}]=$part
done < <(awk '!/^[[:space:]]*(#|$)/ {print $1, $2}' "$LIST_FILE")
[ "${#LISTED[@]}" -gt 0 ] || ci_error 'Node 검사 목록이 비어 있음'
LISTED_TEXT=$(printf '%s\n' "${LISTED[@]}")

# 목록 밖 파일: 예전 글롭과 같은 범위에서 찾는다. 목록에 없으면 CI에서 조용히 빠지지 않게 실패로 남긴다.
UNLISTED=()
while IFS= read -r file; do
  [ -f "$file" ] || continue
  printf '%s\n' "$LISTED_TEXT" | grep -Fxq -- "$file" || UNLISTED[${#UNLISTED[@]}]=$file
done < <(
  printf '%s\n' tests/league/*.js | LC_ALL=C sort
  printf '%s\n' tests/league/review/[0-9]*.js | LC_ALL=C sort
)
MISSING_COUNT=0
index=0
while [ "$index" -lt "${#LISTED[@]}" ]; do
  [ "${PARTS[$index]}" = ignore ] || [ -f "${LISTED[$index]}" ] || MISSING_COUNT=$((MISSING_COUNT + 1))
  index=$((index + 1))
done

if [ "$CHECK" -eq 1 ]; then
  index=0
  while [ "$index" -lt "${#LISTED[@]}" ]; do
    if [ "${PARTS[$index]}" != ignore ] && [ ! -f "${LISTED[$index]}" ]; then
      printf 'MISSING 목록에 있는데 파일 없음: %s\n' "${LISTED[$index]}"
    fi
    index=$((index + 1))
  done
  for file in ${UNLISTED[@]+"${UNLISTED[@]}"}; do
    printf 'UNLISTED 파일이 있는데 목록에 없음: %s\n' "$file"
  done
  printf 'Node 검사 목록: 등록 %s줄(보조 파일 %s 포함) · 없는 파일 %s · 미등록 %s\n' "${#LISTED[@]}" \
    "$(printf '%s\n' "${PARTS[@]}" | grep -cx ignore)" "$MISSING_COUNT" "${#UNLISTED[@]}"
  [ "$MISSING_COUNT" -eq 0 ] && [ "${#UNLISTED[@]}" -eq 0 ] && exit 0
  exit 1
fi

# 이번 실행에서 판정할 이름. 미등록 파일은 rest·all 묶음이 한 번만 보고한다.
index=0
while [ "$index" -lt "${#LISTED[@]}" ]; do
  part=${PARTS[$index]}
  if [ "$part" != ignore ] && { [ "$PART" = all ] || [ "$PART" = "$part" ]; }; then
    name_of "${LISTED[$index]}" >> "$OUT/expected.txt"
  fi
  index=$((index + 1))
done
if [ "$PART" != heavy ]; then
  for file in ${UNLISTED[@]+"${UNLISTED[@]}"}; do
    name_of "$file" >> "$OUT/expected.txt"
  done
fi
[ -s "$OUT/expected.txt" ] || ci_error "묶음 $PART 에 Node 검사가 없음"

record() {  # 이름 상태 표지 경로: 실행하지 않은 검사를 표지 줄과 함께 남긴다
  local name state mark file
  name=$1; state=$2; mark=$3; file=$4
  printf '%s %s\n' "$mark" "$file" > "$OUT/$name.log"
  printf '%s\t-\t0\t%s\n' "$name" "$state" >> "$OUT/status.tsv"
  printf '%s exit=- 0s state=%s :: %s %s\n' "$name" "$state" "$mark" "$file" | tee -a "$OUT/summary.txt"
}

index=0
while [ "$index" -lt "${#LISTED[@]}" ]; do
  file=${LISTED[$index]}
  part=${PARTS[$index]}
  index=$((index + 1))
  [ "$part" != ignore ] || continue
  [ "$PART" = all ] || [ "$PART" = "$part" ] || continue
  name=$(name_of "$file")
  log="$OUT/$name.log"
  if [ ! -f "$file" ]; then
    record "$name" missing 'MISSING 검사 파일 없음:' "$file"
    continue
  fi
  ci_run_limited "$log" "$LIMIT" "$NODE" "$file"
  printf '%s\t%s\t%s\t%s\n' "$name" "$CI_CODE" "$CI_SECONDS" "$CI_STATE" >> "$OUT/status.tsv"
  exit_text=$CI_CODE
  case "$CI_STATE" in crash) exit_text="$CI_CODE(CRASH)" ;; timeout) exit_text='124(TIMEOUT)' ;; esac
  extra=''
  case "$file" in
    */review/*)
      # 판정과 같은 함수로 세며 변이 탐지 줄과 빈 실패 사전을 제외한다.
      fails=$(PYTHONDONTWRITEBYTECODE=1 "$COUNT_PY" - "$ROOT/tests/ci" "$name" "$log" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from judge import failure_lines
print(len(failure_lines("node", sys.argv[2], Path(sys.argv[3]).read_text(encoding="utf-8", errors="replace"))))
PY
      )
      extra=" fails=${fails:-모름}"
      ;;
  esac
  last=$(tail -n 1 "$log" | cut -c1-100)
  printf '%s exit=%s %ss state=%s%s :: %s\n' "$name" "$exit_text" "$CI_SECONDS" "$CI_STATE" "$extra" "$last" \
    | tee -a "$OUT/summary.txt"
done
if [ "$PART" != heavy ]; then
  for file in ${UNLISTED[@]+"${UNLISTED[@]}"}; do
    record "$(name_of "$file")" unlisted 'UNLISTED 목록에 없는 검사 파일(tests/ci/node-suites.txt에 등록 필요):' "$file"
  done
fi
exit 0
