# sleepwalk root watcher: one hold, then it exits.
#
# It runs as root, started by the mod through one macOS password box. It turns
# system sleep off, keeps the display awake, and it alone turns sleep back on.
# Nothing is installed: the mod passes this text to /bin/sh -c, so no file of
# it runs from disk, and nothing stays after it exits.
#
# Arguments: <until> <floor> <hot> <heavy> <dir>
#   until  end of the hold, in seconds since the epoch
#   floor  battery floor in per cent, checked on battery power only
#   hot    battery temperature limit, in hundredths of a degree Celsius
#   heavy  thermal pressure level that ends the hold (2 is Heavy)
#   dir    folder of heartbeat files, one per session, named beat-<pid>
#
# Sleep comes back on when the time limit passes, when no session holds a
# fresh heartbeat (every session turned the mode off, ended or crashed), when
# the battery is under the floor, when the Mac runs hot, or on HUP, INT or TERM.
# If the lid is shut then, the watcher sleeps the Mac, because macOS does not
# sleep a Mac whose lid was already shut when sleep came back on.

PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

until_s=$1
floor=$2
hot=$3
heavy=$4
dir=$5
stale=90
keep=

note() {
  /usr/bin/logger "sleepwalk: $*"
}

sleep_is() {
  /usr/bin/pmset -g | /usr/bin/grep -Eq "SleepDisabled[[:space:]]+$1"
}

lid_shut() {
  /usr/sbin/ioreg -r -k AppleClamshellState -d 1 | /usr/bin/grep -q '"AppleClamshellState" = Yes'
}

external_display() {
  shown=$(/usr/sbin/system_profiler SPDisplaysDataType 2>/dev/null)
  all=$(printf '%s\n' "$shown" | /usr/bin/grep -c 'Resolution:')
  own=$(printf '%s\n' "$shown" | /usr/bin/grep -c 'Display Type: Built-in')
  [ "$all" -gt "$own" ]
}

restore() {
  trap '' HUP INT TERM
  tries=0
  until sleep_is 0; do
    /usr/bin/pmset -a disablesleep 0
    tries=$((tries + 1))
    [ "$tries" -ge 5 ] && break
    /bin/sleep 1
  done
  [ -n "$keep" ] && /bin/kill "$keep" 2>/dev/null
  if sleep_is 0; then
    note "sleep on: $1"
  else
    note "sleep still off after 5 tries: $1"
  fi
  if lid_shut && ! external_display; then
    note "lid shut: sleeping now"
    /usr/bin/pmset sleepnow
  fi
  exit 0
}

case "$until_s$floor$hot$heavy" in
  '' | *[!0-9]*)
    note "refused: bad arguments"
    exit 2
    ;;
esac
case $dir in
  /*) ;;
  *)
    note "refused: the heartbeat folder is not an absolute path"
    exit 2
    ;;
esac
[ -d "$dir" ] || {
  note "refused: no heartbeat folder"
  exit 2
}

trap 'restore "stopped by a signal"' HUP INT TERM

left=$(($until_s - $(/bin/date +%s)))
[ "$left" -gt 0 ] || {
  note "refused: the end time has passed"
  exit 2
}

/usr/bin/pmset -a disablesleep 1
sleep_is 1 || restore "could not turn sleep off"
# Keep the display on and the person counted as active, so the screen does not
# dim, start the screen saver or lock. It ends with this watcher.
/usr/bin/caffeinate -d -i -u -t "$left" -w $$ &
keep=$!
note "sleep off until $until_s"

while :; do
  now=$(/bin/date +%s)
  [ "$now" -ge "$until_s" ] && restore "time limit"

  files=0
  alive=0
  fresh=0
  for f in "$dir"/beat-*; do
    [ -f "$f" ] || continue
    pid=${f##*/beat-}
    case $pid in
      '' | *[!0-9]*) continue ;;
    esac
    files=$((files + 1))
    /bin/kill -0 "$pid" 2>/dev/null || continue
    alive=$((alive + 1))
    seen=$(/usr/bin/stat -f %m "$f" 2>/dev/null) || continue
    [ $((now - seen)) -le "$stale" ] && fresh=$((fresh + 1))
  done
  [ "$files" -eq 0 ] && restore "turned off"
  [ "$alive" -eq 0 ] && restore "the session ended"
  [ "$fresh" -eq 0 ] && restore "no heartbeat for $stale s"

  batt=$(/usr/bin/pmset -g batt)
  case $batt in
    *"'Battery Power'"*)
      pct=$(printf '%s\n' "$batt" | /usr/bin/sed -n 's/.*[^0-9]\([0-9][0-9]*\)%.*/\1/p' | /usr/bin/head -n 1)
      [ -n "$pct" ] && [ "$pct" -lt "$floor" ] && restore "battery at $pct%"
      ;;
  esac

  level=$(/usr/bin/notifyutil -g com.apple.system.thermalpressurelevel | /usr/bin/awk '{ print $2 }')
  case $level in
    '' | *[!0-9]*) ;;
    *) [ "$level" -ge "$heavy" ] && restore "thermal pressure level $level" ;;
  esac

  temp=$(/usr/sbin/ioreg -r -n AppleSmartBattery | /usr/bin/sed -n 's/^[[:space:]]*"Temperature" = \([0-9][0-9]*\).*/\1/p' | /usr/bin/head -n 1)
  [ -n "$temp" ] && [ "$temp" -ge "$hot" ] && restore "battery at $((temp / 100)) C"

  /bin/sleep 5 &
  wait $!
done
