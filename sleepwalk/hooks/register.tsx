import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { LidHold, LidWork } from '../types'
import {
  BEAT_MS,
  HEAVY,
  HOT,
  IDLE_MS,
  PASSWORD_MS,
  STALE_MS,
  asksForPermission,
  battery,
  beatDir,
  beatPath,
  duration,
  firstLine,
  isCancelled,
  isSleepStillOff,
  lastReason,
  limitOf,
  parseArgs,
  passwordArgv,
  refusal,
  restoreArgv,
  settingsOf,
  sleepDisabled,
  temperature,
  thermalLevel,
  watchers,
  words,
} from './facts'
import type { Battery, Settings, Watcher } from './facts'
import { moonOff, moonOn, sized } from './icons'
import { below, checkSoon, registerUpdate } from './update'

// sleepwalk: keeps this session working with the lid shut.
//
// One password box starts a root watcher (hooks/watcher.sh). The watcher turns
// sleep off and is the one process that turns it back on: when every session's
// heartbeat stops, at the time limit, on low battery or heat, or on a signal.
// This module writes the heartbeat while the session works, draws the band,
// the footer label and /lid, and stops beating 2 minutes after the work ends.

type Run = { exitCode: number; stdout: string; stderr: string }
type Facts = { isSleepOff: boolean | null; battery: Battery; watchers: Watcher[] }

const OFF: LidHold = {
  phase: 'off',
  startedAt: 0,
  endsAt: 0,
  endsAtText: '',
  isJoined: false,
  pid: '',
  beat: '',
}
const NO_WORK: LidWork = { isTurnRunning: false, pending: 0, lastWorkAt: 0 }
const BUSY = ['pending', 'running', 'waiting']

const hold = atom({ plugin: 'sleepwalk', key: 'hold' } as const, OFF)
const note = atom({ plugin: 'sleepwalk', key: 'note' } as const, null)
const work = atom({ plugin: 'sleepwalk', key: 'work' } as const, NO_WORK)
const reading = atom({ plugin: 'sleepwalk', key: 'reading' } as const, null)
const mode = atom({ plugin: 'sleepwalk', key: 'mode' } as const, '')
const isLeftOff = atom({ plugin: 'sleepwalk', key: 'isSleepLeftOff' } as const, false)
const isLeftoverHidden = atom({ plugin: 'sleepwalk', key: 'isLeftoverHidden' } as const, false)

let timer: Timer | null = null
let isBeating = false

async function run($: EngineInterface, argv: readonly string[], timeoutMs = 10_000): Promise<Run> {
  try {
    const done = await $.process.run(argv, { timeoutMs })

    return { exitCode: done.exitCode, stdout: done.stdout, stderr: done.stderr }
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: String(error) }
  }
}

async function readFacts($: EngineInterface): Promise<Facts> {
  const [pmset, batt, ps] = await Promise.all([
    run($, ['/usr/bin/pmset', '-g']),
    run($, ['/usr/bin/pmset', '-g', 'batt']),
    run($, ['/bin/ps', '-axww', '-o', 'pid=,user=,args=']),
  ])

  return {
    isSleepOff: sleepDisabled(pmset.stdout),
    battery: battery(batt.stdout),
    watchers: watchers(ps.stdout),
  }
}

/** The watchers that read this person's heartbeat folder. */
function ownWatchers(facts: Facts, beat: string): Watcher[] {
  return facts.watchers.filter(w => beat.startsWith(`${w.dir}/`))
}

async function clockText($: EngineInterface, ms: number): Promise<string> {
  const shown = await run($, ['/bin/date', '-r', String(Math.floor(ms / 1000)), '+%H:%M'])

  return shown.stdout.trim() || 'the time limit'
}

async function say($: EngineInterface, text: string, isWarning = false): Promise<void> {
  await update($, note, () => ({ text, isWarning }))
}

/** A line in the transcript for the person; the model never reads it. */
async function notice($: EngineInterface, text: string): Promise<void> {
  await $.session
    .append({ message: { type: 'system', content: [{ type: 'text', text: `sleepwalk: ${text}` }] } })
    .catch(() => undefined)
}

/** A line the model reads with its next request; the person does not see it as typed. */
async function tellModel($: EngineInterface, text: string): Promise<void> {
  await $.session
    .append({ message: { type: 'user', content: [{ type: 'text', text: `[sleepwalk] ${text}` }] } })
    .catch(() => undefined)
}

async function removeBeat($: EngineInterface, path: string): Promise<void> {
  if (path.includes('/sleepwalk/beat-')) await run($, ['/bin/rm', '-f', path])
}

/** Other sessions whose fresh heartbeat keeps the same hold going. */
async function others($: EngineInterface, h: LidHold): Promise<number> {
  const dir = h.beat.slice(0, h.beat.lastIndexOf('/'))
  const now = await $.clock.now()
  const entries = await $.fs.list(dir).catch(() => [])

  return entries.filter(
    entry =>
      /^beat-\d+$/.test(entry.name) && `${dir}/${entry.name}` !== h.beat && now - entry.mtimeMs <= STALE_MS,
  ).length
}

/** The watcher's own reason from the system log, since the hold began. */
async function reasonSince($: EngineInterface, startedAt: number): Promise<{ reason: string | null; isStillOff: boolean }> {
  const minutes = Math.ceil(((await $.clock.now()) - startedAt) / 60_000) + 1
  const shown = await run(
    $,
    [
      '/usr/bin/log',
      'show',
      '--style',
      'compact',
      '--last',
      `${Math.min(Math.max(minutes, 2), 1440)}m`,
      '--predicate',
      'process == "logger" AND eventMessage BEGINSWITH "sleepwalk:"',
    ],
    30_000,
  )

  return { reason: lastReason(shown.stdout), isStillOff: isSleepStillOff(shown.stdout) }
}

async function checkLeftover($: EngineInterface): Promise<void> {
  const facts = await readFacts($)
  const isLeft = facts.isSleepOff === true && facts.watchers.length === 0
  if (isLeft !== (await read($, isLeftOff))) await update($, isLeftOff, () => isLeft)
  if (facts.watchers.length === 0) await removeStaleBeats($)
}

/** With no watcher running, a stale heartbeat file only marks a crash: delete it. */
async function removeStaleBeats($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home?.startsWith('/')) return

  const dir = beatDir(home)
  const now = await $.clock.now()
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (/^beat-\d+$/.test(entry.name) && now - entry.mtimeMs > STALE_MS) await removeBeat($, `${dir}/${entry.name}`)
  }
}

function statusLine(h: LidHold, percent: number | null): string {
  return `awake until ${h.endsAtText}${percent === null ? '' : `, battery ${percent}%`}`
}

async function turnOn($: EngineInterface, cfg: Settings): Promise<string> {
  const current = await read($, hold)
  if (current.phase === 'on') return `Sleepwalk mode is already on, until ${current.endsAtText}.`
  if (current.phase === 'asking') return 'The password box is already open.'
  if (current.phase === 'stopping') return 'Sleepwalk mode is turning off. Try again in a few seconds.'

  const [pidRun, home] = await Promise.all([run($, ['/bin/sh', '-c', 'echo $PPID']), $.env.get('HOME')])
  const pid = pidRun.stdout.trim()
  if (!/^\d+$/.test(pid) || !home?.startsWith('/')) {
    const text = 'Stayed off: this session could not be found.'
    await say($, text, true)
    return text
  }

  const [facts, thermal, ioreg] = await Promise.all([
    readFacts($),
    run($, ['/usr/bin/notifyutil', '-g', 'com.apple.system.thermalpressurelevel']),
    run($, ['/usr/sbin/ioreg', '-r', '-n', 'AppleSmartBattery']),
  ])
  const refused = refusal({
    battery: facts.battery,
    floor: cfg.floor,
    level: thermalLevel(thermal.stdout),
    temp: temperature(ioreg.stdout),
  })
  if (refused) {
    await say($, `Stayed off. ${refused}`, true)
    return `Sleepwalk mode stays off. ${refused}`
  }

  const beat = beatPath(beatDir(home), pid)
  const now = await $.clock.now()
  await $.fs.write(beat, `${now}\n`)
  await update($, note, () => null)

  const running = ownWatchers(facts, beat).find(w => w.until * 1000 > now + 60_000)
  if (running) {
    const endsAt = Math.min(running.until * 1000, now + cfg.limitMs)
    const endsAtText = await clockText($, endsAt)
    await update($, hold, () => ({ phase: 'on', startedAt: now, endsAt, endsAtText, isJoined: true, pid, beat }))
    await afterOn($, cfg)
    return `Joined the hold another session started. This Mac stays awake with the lid shut until ${endsAtText} at the latest.`
  }

  const endsAt = now + cfg.limitMs
  const endsAtText = await clockText($, endsAt)
  await update($, hold, () => ({ phase: 'asking', startedAt: now, endsAt, endsAtText, isJoined: false, pid, beat }))
  // Keep the heartbeat fresh while the password box is open, so the watcher
  // finds it fresh however long the person takes to type.
  startBeating($, cfg)
  $.clock.after(1, () => void askPassword($, cfg))

  return 'A password box is open. Type your Mac password to keep this Mac awake with the lid shut.'
}

async function askPassword($: EngineInterface, cfg: Settings): Promise<void> {
  const asked = await read($, hold)
  if (asked.phase !== 'asking') return

  const script = await $.fs.read(`${$.plugin.root}/hooks/watcher.sh`).catch(() => '')
  if (!script.startsWith('# sleepwalk root watcher')) {
    await stayOff($, asked, 'Sleepwalk mode stays off: the watcher script is missing.')
    return
  }

  const dir = asked.beat.slice(0, asked.beat.lastIndexOf('/'))
  const args = [String(Math.floor(asked.endsAt / 1000)), String(cfg.floor), String(HOT), String(HEAVY), dir]
  const prompt = `sleepwalk wants to turn off sleep until ${asked.endsAtText}, so this Claude session keeps working with the lid shut. Sleep comes back on when the work ends.`
  const done = await run($, passwordArgv(prompt, script, args), PASSWORD_MS)

  if (done.exitCode !== 0) {
    const text = isCancelled(done.stderr)
      ? 'Sleepwalk mode stays off: the password box was cancelled.'
      : `Sleepwalk mode stays off: ${firstLine(done.stderr) || 'the password box failed'}.`
    await stayOff($, asked, text, !isCancelled(done.stderr))
    return
  }

  for (let tries = 0; tries < 10; tries++) {
    const facts = await readFacts($)
    if (facts.isSleepOff === true && ownWatchers(facts, asked.beat).length > 0) {
      const now = await read($, hold)
      // Turned off while the box was open: the watcher finds no heartbeat and ends itself.
      if (now.phase !== 'asking') return
      await update($, hold, (h): LidHold => ({ ...h, phase: 'on' }))
      await update($, isLeftOff, () => false)
      await afterOn($, cfg)
      return
    }
    await run($, ['/bin/sleep', '0.5'])
  }

  const { reason } = await reasonSince($, asked.startedAt)
  await stayOff($, asked, `Sleepwalk mode did not start${reason ? `: ${words(reason)}` : ''}.`, true)
  await checkLeftover($)
}

async function stayOff($: EngineInterface, h: LidHold, text: string, isWarning = false): Promise<void> {
  await removeBeat($, h.beat)
  await update($, hold, () => OFF)
  await say($, text, isWarning)
}

async function afterOn($: EngineInterface, cfg: Settings): Promise<void> {
  const h = await read($, hold)
  await update($, work, w => ({ ...w, lastWorkAt: h.startedAt }))
  startBeating($, cfg)
  $.ui.status(statusLine(h, null))
  $.ui.toast(`Awake until ${h.endsAtText}. The screen stays unlocked.`)
  if (asksForPermission(await read($, mode)) !== false) {
    $.ui.toast('Prompts wait for you. Answer from your phone with Remote Control.')
  }
  await tellModel(
    $,
    `Sleepwalk mode is on until ${h.endsAtText}. The Mac stays awake and unlocked with its lid shut, so every tool keeps working, computer use and desktop screenshots included. The person may be away: a question or a permission prompt waits until they answer, perhaps from their phone through Remote Control.`,
  )
}

function startBeating($: EngineInterface, cfg: Settings): void {
  timer?.cancel()
  timer = $.clock.every(BEAT_MS, () => void heartbeat($, cfg))
  void heartbeat($, cfg)
}

function stopBeating(): void {
  timer?.cancel()
  timer = null
}

async function heartbeat($: EngineInterface, cfg: Settings): Promise<void> {
  if (isBeating) return
  isBeating = true
  try {
    const h = await read($, hold)
    const now = await $.clock.now()
    if (h.phase === 'asking') {
      await $.fs.write(h.beat, `${now}\n`)
      return
    }
    if (h.phase !== 'on') {
      stopBeating()
      return
    }

    await $.fs.write(h.beat, `${now}\n`)
    const facts = await readFacts($)
    if (ownWatchers(facts, h.beat).length === 0) {
      await ended($, h, cfg, facts)
      return
    }
    if (now >= h.endsAt) {
      await turnOff($, cfg, 'time limit')
      return
    }

    const w = await read($, work)
    const agents = await $.agent.list().catch(() => [])
    const isBusy = w.isTurnRunning || w.pending > 0 || agents.some(agent => BUSY.includes(agent.status))
    if (isBusy) {
      await update($, work, x => ({ ...x, lastWorkAt: now }))
    } else if (now - Math.max(w.lastWorkAt, h.startedAt) >= IDLE_MS) {
      await turnOff($, cfg, 'work ended')
      return
    }

    const count = await others($, h)
    await update($, reading, () => ({ battery: facts.battery.percent, isOnBattery: facts.battery.isOnBattery, others: count }))
    $.ui.status(statusLine(h, facts.battery.percent))
  } finally {
    isBeating = false
  }
}

/** The watcher ended the hold by itself: a guardrail, a signal, or a crash. */
async function ended($: EngineInterface, h: LidHold, cfg: Settings, facts: Facts): Promise<void> {
  stopBeating()
  await removeBeat($, h.beat)
  await update($, hold, () => OFF)
  $.ui.status(undefined)

  const { reason, isStillOff } = await reasonSince($, h.startedAt)
  const why = reason ? words(reason) : 'the watcher stopped'
  if (facts.isSleepOff === true || isStillOff) {
    await update($, isLeftOff, () => true)
    await update($, isLeftoverHidden, () => false)
    await say($, `Ended (${why}), but sleep is still off.`, true)
    await notice($, `the hold ended (${why}), but sleep is still off on this Mac.`)
  } else if (facts.isSleepOff === null) {
    await say($, `Ended (${why}). Check with /lid status.`, true)
    await notice($, `the hold ended (${why}); pmset did not answer, so sleep was not checked.`)
  } else {
    await say($, `Sleep back on: ${why}.`)
    await notice($, `sleep is back on: ${why}.`)
  }
  $.ui.toast(`Sleep back on: ${why}.`)
  await tellModel($, 'Sleepwalk mode is off. Shutting the lid sleeps the Mac again.')
}

async function turnOff($: EngineInterface, cfg: Settings, reason: string): Promise<string> {
  const h = await read($, hold)
  if (h.phase === 'off') return 'Sleepwalk mode is already off.'
  if (h.phase === 'stopping') return 'Sleepwalk mode is already turning off.'

  stopBeating()
  if (h.phase === 'asking') {
    await stayOff($, h, 'Stayed off. Typing the password now changes nothing.')
    return 'Sleepwalk mode stays off.'
  }

  await update($, hold, (x): LidHold => ({ ...x, phase: 'stopping' }))
  await removeBeat($, h.beat)
  const why = words(reason)

  let text: string
  if ((await others($, h)) > 0) {
    text = `Off here. Another session still keeps the Mac awake.`
  } else {
    let facts = await readFacts($)
    for (let tries = 0; tries < 12 && (facts.isSleepOff !== false || ownWatchers(facts, h.beat).length > 0); tries++) {
      await run($, ['/bin/sleep', '1.25'])
      facts = await readFacts($)
    }
    if (facts.isSleepOff === false) {
      text = reason === 'turned off' ? '' : `Sleep back on: ${why}.`
    } else {
      await update($, isLeftOff, () => true)
      await update($, isLeftoverHidden, () => false)
      text = `Ended (${why}), but sleep is still off.`
    }
  }

  await update($, hold, () => OFF)
  if (text === '') await update($, note, () => null)
  else await say($, text, text.endsWith('sleep is still off.'))
  await notice($, text === '' ? `sleep is back on: ${why}.` : text)
  $.ui.status(undefined)
  await tellModel($, 'Sleepwalk mode is off. Shutting the lid sleeps the Mac again.')

  return text === '' ? 'Sleep back on.' : text
}

async function restoreSleep($: EngineInterface): Promise<void> {
  const done = await run(
    $,
    restoreArgv('sleepwalk wants to turn sleep back on. Sleep is off on this Mac, so a shut lid does not sleep it.'),
    PASSWORD_MS,
  )
  if (done.exitCode !== 0) {
    await say(
      $,
      isCancelled(done.stderr) ? 'Sleep is still off: the password box was cancelled.' : `Sleep is still off: ${firstLine(done.stderr)}.`,
      true,
    )
    return
  }
  await checkLeftover($)
  await say($, (await read($, isLeftOff)) ? 'Sleep is still off. Run `sudo pmset -a disablesleep 0` in Terminal.' : 'Sleep back on.')
}

async function statusText($: EngineInterface, cfg: Settings): Promise<string> {
  const [h, w, m, facts] = await Promise.all([read($, hold), read($, work), read($, mode), readFacts($)])
  const now = await $.clock.now()
  const lines: string[] = []

  if (h.phase === 'on') {
    lines.push(`Sleepwalk mode: on until ${h.endsAtText}, ${duration(h.endsAt - now)} left.${h.isJoined ? ' This session joined a hold another session started.' : ''}`)
    const idle = now - Math.max(w.lastWorkAt, h.startedAt)
    lines.push(
      w.isTurnRunning || w.pending > 0
        ? 'Work: running. The hold ends 2 minutes after the work ends.'
        : `Work: none for ${duration(idle)}. The hold ends after 2 minutes with no work.`,
    )
  } else {
    lines.push(`Sleepwalk mode: ${h.phase === 'asking' ? 'waiting for the password' : h.phase === 'stopping' ? 'turning off' : 'off'}.`)
  }

  const watching = facts.watchers.map(x => x.pid).join(', ')
  lines.push(
    `Sleep: ${facts.isSleepOff === true ? 'off' : facts.isSleepOff === false ? 'on' : 'unknown'} (pmset SleepDisabled ${facts.isSleepOff === true ? 1 : facts.isSleepOff === false ? 0 : '?'}).${watching ? ` Root watcher running: pid ${watching}.` : ' No root watcher is running.'}`,
  )
  const { percent, isOnBattery } = facts.battery
  lines.push(`Battery: ${percent === null ? 'unknown' : `${percent}%`}, ${isOnBattery ? 'on battery' : 'on the charger'}.`)

  const asks = asksForPermission(m)
  lines.push(
    asks === true
      ? `Permission mode: ${m}. A prompt nobody answers stops the work. Answer from your phone with Remote Control, or use Auto or Bypass permissions.`
      : asks === false
        ? `Permission mode: ${m}. No prompt waits for a person.`
        : 'Permission mode: not known yet.',
  )
  lines.push(`Limits: ${duration(cfg.limitMs)}, battery floor ${cfg.floor}% on battery, thermal pressure level ${HEAVY}, battery ${HOT / 100} °C.`)

  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const cfg = settingsOf(options)
  registerUpdate(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'lid',
      description: 'Keep this session working with the lid closed: on [minutes], off or status',
      argumentHint: 'on [minutes]|off|status',
    })

    // A reload starts the module over; $.state still holds the hold.
    const h = await read($, hold)
    if (h.phase === 'on') {
      const facts = await readFacts($)
      if (ownWatchers(facts, h.beat).length > 0) {
        startBeating($, cfg)
        $.ui.status(statusLine(h, facts.battery.percent))
      } else {
        await ended($, h, cfg, facts)
      }
    } else if (h.phase === 'asking' || h.phase === 'stopping') {
      // The reload cut the password box or the stop short.
      await stayOff($, h, 'Sleepwalk mode is off: the mod reloaded during the change. Turn it on again if you need it.')
    }

    await checkLeftover($)
    checkSoon($)
    return started
  })

  on('session.end', async ($, e, next) => {
    stopBeating()
    const h = await read($, hold)
    if (h.phase !== 'off') {
      await removeBeat($, h.beat)
      await update($, hold, () => OFF)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, work, w => ({ ...w, isTurnRunning: true, lastWorkAt: now }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, work, w => ({ ...w, isTurnRunning: false, lastWorkAt: now }))
    }
    return next(e)
  })

  // The stop reports work still in flight: background commands and agents,
  // and wake-ups the session has scheduled. Each one counts as work.
  on('classic.Stop', async ($, e, next) => {
    const pending = (e.background_tasks?.length ?? 0) + (e.session_crons?.length ?? 0)
    const now = await $.clock.now()
    await update($, work, w => ({ ...w, pending, lastWorkAt: now }))
    if (e.permission_mode) await update($, mode, () => e.permission_mode ?? '')
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode) await update($, mode, () => e.permission_mode ?? '')
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.permission_mode) await update($, mode, () => e.permission_mode ?? '')
    return next(e)
  })

  on('command.run', { command: 'lid' }, async ($, e) => {
    const { word, minutes } = parseArgs(e.args)
    if (word === 'on') return { text: await turnOn($, minutes === null ? cfg : { ...cfg, limitMs: limitOf(minutes) }) }
    if (word === 'off') return { text: await turnOff($, cfg, 'turned off') }
    if (word === '' || word === 'status') return { text: await statusText($, cfg) }

    return { text: 'Use /lid on, /lid on <minutes>, /lid off or /lid status.' }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const held = await read($, hold)
    if (held.phase !== 'on') return next(e)

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, 'sleepwalking'] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [held, said, r, m, isLeft, isHidden] = await Promise.all([
      read($, hold),
      read($, note),
      read($, reading),
      read($, mode),
      read($, isLeftOff),
      read($, isLeftoverHidden),
    ])
    const now = await $.clock.now()
    const asks = asksForPermission(m)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    // One row: the moon, a few words, the buttons.
    const row = (icon: string, alt: string, key: string, ...parts: RenderChildren[]) => (
      <Box key={key} flexDirection="row" alignItems="center" gap="sm">
        {Svg && <Svg source={sized(icon, 16)} alt={alt} width={16} height={16} isInteractive />}
        {parts}
      </Box>
    )

    const leftover =
      isLeft && !isHidden && held.phase === 'off'
        ? row(
            moonOff,
            'sleepwalk',
            'leftover',
            <Text color="yellow">Sleep is still off</Text>,
            <Button key="restore" label="Turn it back on" variant="primary" onPress={() => restoreSleep($)} />,
            <Button key="leave" label="Leave it" onPress={() => update($, isLeftoverHidden, () => true)} />,
          )
        : null

    const rest = await next(e)

    if (held.phase === 'asking') {
      return below(Box, rest, row(moonOff, 'sleepwalk', 'asking', <Text>Type your Mac password</Text>))
    }

    if (held.phase === 'stopping') {
      return below(Box, rest, row(moonOff, 'sleepwalk', 'stopping', <Text dimColor>Turning sleep back on...</Text>))
    }

    if (held.phase === 'on') {
      const left = duration(held.endsAt - now)
      const charge = r === null || r.battery === null ? '' : `, battery ${r.battery}%`

      return below(Box, rest, [
        row(
          moonOn,
          'sleepwalk on',
          'on',
          <Text>Awake until {held.endsAtText}</Text>,
          <Text dimColor>
            {left} left{charge}
          </Text>,
          <Button key="off" label="Stop" onPress={() => turnOff($, cfg, 'turned off')} />,
        ),
        asks !== false ? (
          <Text key="asks" color="yellow">
            {asks === true ? `${m.charAt(0).toUpperCase()}${m.slice(1)} mode asks first. ` : ''}Prompts wait for you: answer by Remote Control, or use Auto mode.
          </Text>
        ) : null,
      ])
    }

    // Off: the switch, and on the same row the last outcome, if any.
    const outcome = said
      ? [
          <Text color={said.isWarning ? 'yellow' : undefined} dimColor={!said.isWarning}>
            {said.text}
          </Text>,
          <Button key="clear" label="OK" onPress={() => update($, note, () => null)} />,
        ]
      : []
    return below(Box, rest, [
      leftover,
      row(moonOff, 'sleepwalk', 'off', <Button key="on" label="Stay awake with lid shut" onPress={() => turnOn($, cfg)} />, ...outcome),
    ])
  })
}
