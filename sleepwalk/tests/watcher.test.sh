#!/bin/sh
# Tests for hooks/watcher.sh. Run as yourself: sh tests/watcher.test.sh
#
# Nothing here needs root or changes a power setting. Each test runs a copy of
# the watcher whose system commands (pmset, ioreg, notifyutil, caffeinate,
# logger, system_profiler) are fakes that read and write files in a temporary
# folder. The copy waits 1 s per check and calls a heartbeat stale after 3 s.

here=$(cd "$(dirname "$0")" && pwd)
source_file="$here/../hooks/watcher.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"
failed=0
passed=0

cat >"$bin/pmset" <<'EOF'
#!/bin/sh
s="$FAKE/state"
case "$1 $2" in
  "-a disablesleep") echo "$3" >"$s/sleep" ;;
  "-g ") printf ' SleepDisabled\t\t%s\n' "$(cat "$s/sleep")" ;;
  "-g batt") cat "$s/batt" ;;
  "sleepnow ") echo sleepnow >>"$s/calls" ;;
esac
EOF
cat >"$bin/ioreg" <<'EOF'
#!/bin/sh
s="$FAKE/state"
case "$*" in
  *AppleClamshellState*) printf '      "AppleClamshellState" = %s\n' "$(cat "$s/lid")" ;;
  *AppleSmartBattery*) printf '      "VirtualTemperature" = 1\n      "Temperature" = %s\n' "$(cat "$s/temp")" ;;
esac
EOF
cat >"$bin/notifyutil" <<'EOF'
#!/bin/sh
echo "com.apple.system.thermalpressurelevel $(cat "$FAKE/state/level")"
EOF
cat >"$bin/caffeinate" <<'EOF'
#!/bin/sh
echo "caffeinate $*" >>"$FAKE/state/calls"
while [ $# -gt 0 ]; do
  [ "$1" = -w ] && pid=$2
  shift
done
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
EOF
cat >"$bin/logger" <<'EOF'
#!/bin/sh
echo "$*" >>"$FAKE/state/log"
EOF
cat >"$bin/system_profiler" <<'EOF'
#!/bin/sh
cat "$FAKE/state/displays"
EOF
chmod +x "$bin"/*

sed -e "s#/usr/bin/pmset#$bin/pmset#g" \
  -e "s#/usr/sbin/ioreg#$bin/ioreg#g" \
  -e "s#/usr/bin/notifyutil#$bin/notifyutil#g" \
  -e "s#/usr/bin/caffeinate#$bin/caffeinate#g" \
  -e "s#/usr/bin/logger#$bin/logger#g" \
  -e "s#/usr/sbin/system_profiler#$bin/system_profiler#g" \
  -e 's#^stale=90$#stale=3#' \
  -e 's#/bin/sleep 5 &#/bin/sleep 1 \&#' \
  "$source_file" >"$work/watcher.sh"

builtin_display='        Color LCD:
          Display Type: Built-in Liquid Retina Display
          Resolution: 2560 x 1664 Retina'
external_display="$builtin_display
        DELL U2720Q:
          Resolution: 3840 x 2160 (2160p/4K UHD 1 - Ultra High Definition)"

# Sets up a fresh fake Mac: sleep on, lid open, on the charger at 80%, cool.
fresh() {
  FAKE="$work/case"
  export FAKE
  rm -rf "$FAKE"
  mkdir -p "$FAKE/state" "$FAKE/beats"
  echo 0 >"$FAKE/state/sleep"
  echo No >"$FAKE/state/lid"
  echo 3000 >"$FAKE/state/temp"
  echo 0 >"$FAKE/state/level"
  printf '%s\n' "$builtin_display" >"$FAKE/state/displays"
  : >"$FAKE/state/calls"
  : >"$FAKE/state/log"
  battery ac 80
}

battery() {
  if [ "$1" = ac ]; then source_name='AC Power'; else source_name='Battery Power'; fi
  printf "Now drawing from '%s'\n -InternalBattery-0 (id=1)\t%s%%; discharging; present: true\n" \
    "$source_name" "$2" >"$FAKE/state/batt"
}

# Starts a stand-in session process and a heartbeat file for it.
session() {
  sleep 600 &
  session_pid=$!
  touch "$FAKE/beats/beat-$session_pid"
}

# Starts the watcher the way the mod does: in the background, under set -m,
# so it has its own process group and can trap INT.
start() {
  until_s=${1:-$(($(date +%s) + 3600))}
  watcher=$(/bin/sh -c 'set -m; /bin/sh "$@" </dev/null >/dev/null 2>&1 & echo $!' \
    launcher "$work/watcher.sh" "$until_s" 25 4000 2 "$FAKE/beats")
  sleep 1.5
}

# Waits up to 8 s for the watcher to exit.
ended() {
  i=0
  while kill -0 "$watcher" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -gt 40 ] && return 1
    sleep 0.2
  done
  return 0
}

check() {
  if eval "$2"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: $1"
    echo "  log: $(tr '\n' '|' <"$FAKE/state/log")"
    echo "  sleep: $(cat "$FAKE/state/sleep") calls: $(tr '\n' ' ' <"$FAKE/state/calls")"
  fi
}

says() {
  grep -q "$1" "$FAKE/state/log"
}

cleanup() {
  kill "$watcher" 2>/dev/null
  [ -n "${session_pid:-}" ] && kill "$session_pid" 2>/dev/null
  wait 2>/dev/null
  session_pid=
}

fresh; session; start
check "turns sleep off and keeps the display awake" '[ "$(cat "$FAKE/state/sleep")" = 1 ] && grep -q "caffeinate -d -i -u -t" "$FAKE/state/calls"'
check "the display hold runs while the hold runs" 'pgrep -f "bin/caffeinate -d -i -u" >/dev/null'
check "keeps holding while the heartbeat is fresh" 'touch "$FAKE/beats/beat-$session_pid"; sleep 1.5; kill -0 "$watcher"'
rm "$FAKE/beats/beat-$session_pid"
check "turning the mode off ends the hold" 'ended && says "sleep on: turned off"'
check "sleep is back on afterwards" '[ "$(cat "$FAKE/state/sleep")" = 0 ]'
check "no sleepnow with the lid open" '! grep -q sleepnow "$FAKE/state/calls"'
check "the display hold ends with the watcher" 'sleep 0.5; ! pgrep -f "bin/caffeinate -d -i -u" >/dev/null'
cleanup

fresh; session; start
kill "$session_pid"
check "a crashed or closed session ends the hold" 'ended && says "sleep on: the session ended"'
check "sleep is back on after the session ends" '[ "$(cat "$FAKE/state/sleep")" = 0 ]'
cleanup

fresh; session; start
check "a stale heartbeat ends the hold" 'ended && says "sleep on: no heartbeat for 3 s"'
cleanup

fresh; session; start $(($(date +%s) + 3))
(while :; do touch "$FAKE/beats/beat-$session_pid" 2>/dev/null; sleep 1; done) &
toucher=$!
check "the time limit ends the hold" 'ended && says "sleep on: time limit"'
kill "$toucher"
cleanup

fresh; session; battery battery 20; start
check "battery under the floor ends the hold" 'ended && says "sleep on: battery at 20%"'
cleanup

fresh; session; battery ac 20; start
check "the floor does not apply on the charger" 'kill -0 "$watcher"'
cleanup

fresh; session; start
echo 2 >"$FAKE/state/level"
check "thermal pressure level 2 ends the hold" 'ended && says "sleep on: thermal pressure level 2"'
cleanup

fresh; session; start
echo 4100 >"$FAKE/state/temp"
check "a battery at 41 C ends the hold" 'ended && says "sleep on: battery at 41 C"'
cleanup

for signal in TERM INT HUP; do
  fresh; session; start
  kill -s "$signal" "$watcher"
  check "$signal ends the hold" 'ended && says "sleep on: stopped by a signal"'
  check "sleep is back on after $signal" '[ "$(cat "$FAKE/state/sleep")" = 0 ]'
  cleanup
done

fresh; session; start
echo Yes >"$FAKE/state/lid"
rm "$FAKE/beats/beat-$session_pid"
check "with the lid shut, the watcher sleeps the Mac" 'ended && grep -q sleepnow "$FAKE/state/calls"'
cleanup

fresh; session; start
echo Yes >"$FAKE/state/lid"
printf '%s\n' "$external_display" >"$FAKE/state/displays"
rm "$FAKE/beats/beat-$session_pid"
check "with an external display, no sleepnow" 'ended && ! grep -q sleepnow "$FAKE/state/calls"'
cleanup

fresh; session; first=$session_pid
sleep 600 &
second=$!
touch "$FAKE/beats/beat-$second"
(while :; do touch "$FAKE/beats/beat-$second"; sleep 1; done) &
toucher=$!
start
rm "$FAKE/beats/beat-$first"
check "a joined session keeps the hold going" 'sleep 1.5; kill -0 "$watcher"'
kill "$toucher"
rm "$FAKE/beats/beat-$second"
check "the hold ends when the last session turns off" 'ended && says "sleep on: turned off"'
kill "$first" "$second" 2>/dev/null
cleanup

fresh; session; touch "$FAKE/beats/beat-x1"; start
rm "$FAKE/beats/beat-$session_pid"
check "a heartbeat name that is no pid counts for nothing" 'ended && says "sleep on: turned off"'
cleanup

fresh
sh "$work/watcher.sh" soon 25 4000 2 "$FAKE/beats"
code=$?
check "bad arguments: exits and leaves sleep alone" '[ "$code" -eq 2 ] && [ "$(cat "$FAKE/state/sleep")" = 0 ] && says "refused: bad arguments"'

fresh
sh "$work/watcher.sh" 1000 25 4000 2 "$FAKE/beats"
code=$?
check "an end time in the past: exits and leaves sleep alone" '[ "$code" -eq 2 ] && [ "$(cat "$FAKE/state/sleep")" = 0 ]'

fresh
sh "$work/watcher.sh" 9999999999 25 4000 2 "$FAKE/nowhere"
code=$?
check "a missing heartbeat folder: exits and leaves sleep alone" '[ "$code" -eq 2 ] && [ "$(cat "$FAKE/state/sleep")" = 0 ]'

echo "watcher tests: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
