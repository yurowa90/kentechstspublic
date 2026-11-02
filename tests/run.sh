#!/bin/bash
# 연습실 브라우저 검사 실행기.
#   tests/run.sh            모든 검사를 네 개씩 병렬로 돌린다
#   tests/run.sh probe peer 지정한 검사만 돌린다 (regression, base, screens, routine, probe, peer, drill, integration)
#   KCP_PORT_BASE=9900 tests/run.sh  시작 포트를 바꾼다(기본 8840). 여러 워크트리에서 동시에 돌릴 때 겹치지 않게.
# 처음 한 번: uv venv tests/.venv && uv pip install --python tests/.venv/bin/python playwright && tests/.venv/bin/playwright install chromium-headless-shell
set -u
T="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$T")"; PY="$T/.venv/bin/python"
mkdir -p "$T/results"
ALL=(regression base screens routine probe peer drill integration originals s-island-grid s-cement-carbon s-variant-desk s-shuttle-permit s-riverdeal g2022 g2023 g2024 g2025 g2026 savefail)
SUITES=("${@:-${ALL[@]}}")
[ $# -eq 0 ] && SUITES=("${ALL[@]}")
run_one() {
  name=$1; port=$2
  python3 "$T/srv.py" "$port" "$ROOT" & srv=$!; sleep 1
  file="$T/accept_$name.py"; [ "$name" = regression ] && file="$T/regression.py"
  (cd "$T" && KCP_BASE="http://127.0.0.1:$port/index.html" KCP_RESULT="$T/results/$name.json" "$PY" "$file" > "$T/results/$name.txt" 2>&1)
  kill $srv
  printf "%-12s %s\n" "$name" "$(grep -h 'problems:' "$T/results/$name.txt" || echo '결과 없음')"
}
export -f run_one; export T ROOT PY
i=0; for s in "${SUITES[@]}"; do echo "$s $((${KCP_PORT_BASE:-8840} + i))"; i=$((i + 1)); done | xargs -P 4 -n 2 bash -c 'run_one "$0" "$1"'
