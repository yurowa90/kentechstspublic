#!/usr/bin/env bash
# 두 실행기가 함께 쓰는 부하 확인과 시간 제한. bash 3.2 문법만 쓴다.
set -u

CI_TEST_PID=''
CI_WATCH_PID=''
CI_MARKER=''
CI_CODE=0
CI_STATE=done
CI_SECONDS=0
CI_ERROR_LOG=''  # 결과 폴더를 만든 뒤 지정하면 judge.py가 실행기 오류를 요약에 싣는다

ci_error() {
  printf '오류: %s\n' "$*" >&2
  if [ -n "$CI_ERROR_LOG" ]; then
    printf '오류: %s\n' "$*" >> "$CI_ERROR_LOG" 2>/dev/null || :
  fi
  exit 2
}

ci_positive_integer() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  awk -v value="$1" 'BEGIN { exit !(value > 0 && value <= 2147483647) }'
}

ci_load() {
  if [ -r /proc/loadavg ]; then
    awk '{print $1; exit}' /proc/loadavg
  else
    sysctl -n vm.loadavg 2>/dev/null | awk '{print $2; exit}'
  fi
}

ci_wait_load() {
  local load
  [ "$CI_MAX_LOAD" = 0 ] && return 0
  while :; do
    load=$(ci_load)
    [ -n "$load" ] || return 0
    awk -v load="$load" -v limit="$CI_MAX_LOAD" 'BEGIN { exit !(load >= limit) }' || return 0
    printf '부하 %s: 20초 대기\n' "$load"
    sleep 20
  done
}

ci_descendants() {
  local pid child
  pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    ci_descendants "$child"
  done
  printf '%s\n' "$pid"
}

ci_signal_tree() {
  local signal pid child
  signal=$1
  pid=$2
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    ci_signal_tree "$signal" "$child"
  done
  pkill -"$signal" -P "$pid" 2>/dev/null || :
  kill -"$signal" "$pid" 2>/dev/null || :
}

ci_cleanup_run() {
  local pid
  if [ -n "$CI_WATCH_PID" ]; then
    ci_signal_tree TERM "$CI_WATCH_PID"
    wait "$CI_WATCH_PID" 2>/dev/null || :
    CI_WATCH_PID=''
  fi
  if [ -n "$CI_TEST_PID" ]; then
    ci_signal_tree TERM "$CI_TEST_PID"
    ci_signal_tree KILL "$CI_TEST_PID"
    wait "$CI_TEST_PID" 2>/dev/null || :
    CI_TEST_PID=''
  fi
  if [ -n "$CI_MARKER" ] && [ -f "$CI_MARKER" ]; then
    while IFS= read -r pid; do
      ci_signal_tree KILL "$pid"
    done < "$CI_MARKER"
  fi
  [ -z "$CI_MARKER" ] || rm -f "$CI_MARKER"
}

ci_run_limited() {
  local log limit started code test_pid
  log=$1
  limit=$2
  shift 2
  CI_MARKER="${log}.timeout.$$"
  rm -f "$CI_MARKER"
  started=$(date +%s)
  "$@" > "$log" 2>&1 &
  CI_TEST_PID=$!
  test_pid=$CI_TEST_PID
  (
    # 감시 프로세스가 실행기의 서버 정리 함수를 물려받지 않게 한다.
    trap - EXIT INT TERM
    sleep "$limit"
    if kill -0 "$test_pid" 2>/dev/null; then
      # 부모가 먼저 끝나도 강제 종료할 수 있도록 자손 번호를 보관한다.
      ci_descendants "$test_pid" > "$CI_MARKER"
      while IFS= read -r pid; do
        ci_signal_tree TERM "$pid"
      done < "$CI_MARKER"
      sleep 10
      while IFS= read -r pid; do
        ci_signal_tree KILL "$pid"
      done < "$CI_MARKER"
    fi
  ) 2>/dev/null &
  # 감시 프로세스를 정상 정리할 때 bash가 찍는 'Terminated' 알림은 버린다.
  CI_WATCH_PID=$!
  wait "$CI_TEST_PID" 2>/dev/null
  code=$?
  if [ -f "$CI_MARKER" ]; then
    wait "$CI_WATCH_PID" 2>/dev/null || :
    CI_CODE=124
    CI_STATE=timeout
  else
    ci_signal_tree TERM "$CI_WATCH_PID"
    wait "$CI_WATCH_PID" 2>/dev/null || :
    CI_CODE=$code
    if [ "$code" -gt 128 ]; then CI_STATE=crash; else CI_STATE=done; fi
  fi
  CI_TEST_PID=''
  CI_WATCH_PID=''
  rm -f "$CI_MARKER"
  CI_MARKER=''
  CI_SECONDS=$(( $(date +%s) - started ))
  return 0
}
