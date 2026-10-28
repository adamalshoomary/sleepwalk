// Readers for what macOS prints, and the small rules the mod decides by.
// Nothing here calls `$`, so the tests call these directly.

/** The name the root watcher runs under (`$0`), and how `ps` finds it. */
export const MARKER = 'sleepwalk-watcher'

/** How `ps` shows the watcher's first words: the shell, then the script's first line. */
export const WATCHER_HEAD = '/bin/sh -c # sleepwalk root watcher'

/** Battery temperature that ends a hold, in hundredths of a degree Celsius. */
export const HOT = 4000

/** Thermal pressure level that ends a hold: 2 is Heavy. */
export const HEAVY = 2

/** A heartbeat older than this ends the hold (the watcher uses the same 90 s). */
export const STALE_MS = 90_000

/** How often a holding session writes its heartbeat and checks the watcher. */
export const BEAT_MS = 15_000

/** The hold ends this long after the session's work ends. */
export const IDLE_MS = 120_000

/** How long the password box may stay open. */
export const PASSWORD_MS = 300_000

/** Permission modes in which no permission prompt waits for a person. */
const UNATTENDED_MODES = ['auto', 'bypassPermissions', 'dontAsk']

export type Battery = { percent: number | null; isOnBattery: boolean }

export type Watcher = {
  pid: number
  /** End of the hold, seconds since the epoch. */
  until: number
  floor: number
  hot: number
  heavy: number
  dir: string
}

export type Settings = { limitMs: number; floor: number }

/** `SleepDisabled` from `pmset -g`: true when sleep is off, null when absent. */
export function sleepDisabled(pmset: string): boolean | null {
  const found = /SleepDisabled\s+(\d)/.exec(pmset)

  return found ? found[1] === '1' : null
}

/** Charge and power source from `pmset -g batt`. */
export function battery(batt: string): Battery {
  const found = /(\d+)%/.exec(batt)

  return {
    percent: found ? Number(found[1]) : null,
    isOnBattery: batt.includes("'Battery Power'"),
  }
}

/** The level from `notifyutil -g com.apple.system.thermalpressurelevel`. */
export function thermalLevel(out: string): number | null {
  const found = /thermalpressurelevel\s+(\d+)/.exec(out)

  return found ? Number(found[1]) : null
}

/** `Temperature` from `ioreg -r -n AppleSmartBattery`, in hundredths of a degree. */
export function temperature(ioreg: string): number | null {
  const found = /^\s*"Temperature" = (\d+)/m.exec(ioreg)

  return found ? Number(found[1]) : null
}

/** True when the lid is shut, from `ioreg -r -k AppleClamshellState -d 1`. */
export function isLidShut(ioreg: string): boolean {
  return /"AppleClamshellState" = Yes/.test(ioreg)
}

/** Root watchers running now, from `ps -axww -o pid=,user=,args=`. */
export function watchers(ps: string): Watcher[] {
  const found: Watcher[] = []

  for (const line of ps.split('\n')) {
    const row = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!row || row[2] !== 'root') continue

    const args = row[3] ?? ''
    if (!args.startsWith(WATCHER_HEAD)) continue

    const at = args.lastIndexOf(` ${MARKER} `)
    if (at < 0) continue

    const rest = args.slice(at + MARKER.length + 2).split(' ')
    const numbers = rest.slice(0, 4).map(Number)
    const dir = rest.slice(4).join(' ')
    if (numbers.length < 4 || numbers.some(n => !Number.isInteger(n)) || !dir.startsWith('/')) continue

    const [until = 0, floor = 0, hot = 0, heavy = 0] = numbers
    found.push({ pid: Number(row[1]), until, floor, hot, heavy, dir })
  }

  return found
}

/** The reason in the watcher's last "sleep on" line of `log show` output. */
export function lastReason(log: string): string | null {
  let reason: string | null = null

  for (const line of log.split('\n')) {
    const found = /sleepwalk: sleep (?:on|still off after 5 tries): (.*)$/.exec(line)
    if (found) reason = (found[1] ?? '').trim()
  }

  return reason
}

/** True when the line says sleep stayed off, the one outcome to shout about. */
export function isSleepStillOff(log: string): boolean {
  const lines = log.split('\n').filter(line => /sleepwalk: sleep (on|still off)/.test(line))

  return (lines.at(-1) ?? '').includes('still off')
}

/**
 * Whether a permission prompt can wait for a person in this mode: true for
 * `default`, `acceptEdits` and `plan`, false for the unattended modes, null
 * while the mode is not known yet.
 */
export function asksForPermission(mode: string): boolean | null {
  if (mode === '') return null

  return !UNATTENDED_MODES.includes(mode)
}

/** A span of time in words: `1 h 52 min`, `4 min`, `under a minute`. */
export function duration(ms: number): string {
  if (ms < 60_000) return 'under a minute'

  const minutes = Math.round(ms / 60_000)

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** A time limit in minutes, held to 5 to 720, in ms. */
export function limitOf(minutes: number): number {
  return Math.min(Math.max(Number.isFinite(minutes) ? Math.round(minutes) : 120, 5), 720) * 60_000
}

/** The options from `/config`, held to sane ranges. */
export function settingsOf(options: Readonly<Record<string, unknown>>): Settings {
  const floor = Number(options.batteryFloor ?? 25)

  return {
    limitMs: limitOf(Number(options.timeLimitMinutes ?? 120)),
    floor: Math.min(Math.max(Number.isFinite(floor) ? floor : 25, 5), 95),
  }
}

/** `/lid` arguments: the word, and for `on` an optional time limit in minutes. */
export function parseArgs(args: string): { word: string; minutes: number | null } {
  const [word = '', count] = args.trim().toLowerCase().split(/\s+/)
  const minutes = word === 'on' && count !== undefined && /^\d+$/.test(count) ? Number(count) : null

  return { word: word === 'on' && count !== undefined && minutes === null ? 'bad' : word, minutes }
}

/** Why the mode may not start now, or null when it may. */
export function refusal(input: {
  battery: Battery
  floor: number
  level: number | null
  temp: number | null
}): string | null {
  const { percent, isOnBattery } = input.battery
  if (isOnBattery && percent !== null && percent < input.floor) {
    return `The battery is at ${percent}%, under the ${input.floor}% floor. Plug in the charger first.`
  }
  if (input.level !== null && input.level >= HEAVY) {
    return `The Mac is under heavy thermal pressure (level ${input.level}). Let it cool first.`
  }
  if (input.temp !== null && input.temp >= HOT) {
    return `The battery is at ${Math.floor(input.temp / 100)} °C. Let it cool under 40 °C first.`
  }

  return null
}

/** The heartbeat file of one session's CLI process. */
export function beatPath(dir: string, pid: string): string {
  return `${dir}/beat-${pid}`
}

/** A heartbeat's text: the time it was written, then the session's transcript id. */
export function beatText(now: number, sessionId: string): string {
  return `${now}\n${sessionId}\n`
}

/** The transcript id a heartbeat names, or null for an older heartbeat without one. */
export function beatSession(text: string): string | null {
  const id = text.split('\n')[1]?.trim() ?? ''
  return /^[0-9a-fA-F-]{36}$/.test(id) ? id : null
}

/** Where the desktop app keeps one file per Code chat. */
export function chatsDir(home: string): string {
  return `${home}/Library/Application Support/Claude/claude-code-sessions`
}

/** The desktop app's id and name of a chat, from its file; null when the file does not read. */
export function chatOf(text: string): { localId: string; title: string } | null {
  try {
    const chat = JSON.parse(text) as { sessionId?: unknown; title?: unknown }
    const localId = typeof chat.sessionId === 'string' && /^local_[A-Za-z0-9-]{1,64}$/.test(chat.sessionId) ? chat.sessionId : ''
    const title = typeof chat.title === 'string' ? chat.title.trim() : ''
    return localId ? { localId, title } : null
  } catch {
    return null
  }
}

/** The link that opens a chat in the desktop app. */
export function chatLink(localId: string): string {
  return `claude://code/continue?session=${localId}`
}

/** A chat name short enough for one row. */
export function shortTitle(title: string, max = 40): string {
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}\u2026`
}

/** The heartbeat folder under the person's home. */
export function beatDir(home: string): string {
  return `${home}/Library/Caches/sleepwalk`
}

/**
 * The osascript call that asks for the Mac password and starts the root
 * watcher in the background. AppleScript quotes each argument for the shell;
 * `set -m` gives the watcher its own process group, so it can trap INT.
 */
export function passwordArgv(prompt: string, script: string, args: readonly string[]): string[] {
  return [
    '/usr/bin/osascript',
    '-e',
    'on run argv',
    '-e',
    `set cmd to "/bin/sh -c " & quoted form of (item 2 of argv) & " ${MARKER}"`,
    '-e',
    'repeat with i from 3 to count of argv',
    '-e',
    'set cmd to cmd & " " & quoted form of (item i of argv)',
    '-e',
    'end repeat',
    '-e',
    'do shell script "set -m; " & cmd & " </dev/null >/dev/null 2>&1 &" with prompt (item 1 of argv) with administrator privileges',
    '-e',
    'end run',
    prompt,
    script,
    ...args,
  ]
}

/** The osascript call that asks for the Mac password and turns sleep back on. */
export function restoreArgv(prompt: string): string[] {
  return [
    '/usr/bin/osascript',
    '-e',
    'on run argv',
    '-e',
    'do shell script "/usr/bin/pmset -a disablesleep 0" with prompt (item 1 of argv) with administrator privileges',
    '-e',
    'end run',
    prompt,
  ]
}

/** Why a hold ended, in plain words, from the mod's or the watcher's reason. */
export function words(reason: string): string {
  const fixed: Record<string, string> = {
    'turned off': 'the mode was turned off',
    'work ended': 'the work ended 2 minutes ago',
    'time limit': 'the time limit passed',
    'session ended': 'the session ended',
    'the session ended': 'the session ended',
    'stopped by a signal': 'the watcher was stopped',
    'could not turn sleep off': 'macOS did not turn sleep off',
    'no heartbeat for 90 s': 'this session stopped answering for 90 seconds',
  }
  const known = fixed[reason]
  if (known) return known

  const percent = /^battery at (\d+)%$/.exec(reason)
  if (percent) return `the battery fell to ${percent[1]}%`

  const heat = /^battery at (\d+) C$/.exec(reason)
  if (heat) return `the battery reached ${heat[1]} °C`

  const level = /^thermal pressure level (\d+)$/.exec(reason)
  if (level) return `the Mac ran hot (thermal pressure level ${level[1]})`

  return reason
}

/** The first line of a command's error output, for a short message. */
export function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/** True when osascript's error says the person pressed Cancel. */
export function isCancelled(stderr: string): boolean {
  return stderr.includes('-128')
}
