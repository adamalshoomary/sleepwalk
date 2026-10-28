import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  asksForPermission,
  battery,
  duration,
  lastReason,
  parseArgs,
  passwordArgv,
  refusal,
  settingsOf,
  sleepDisabled,
  watchers,
  words,
} from '../hooks/facts'
import type { WordsProps } from '../hooks/words'

// Nothing sits beneath the plugin in a test: the hooks below stand for macOS
// and the engine. `fakeMac` answers the mod's commands from a small model of a
// Mac, so each test sets the state, acts, and reads what the mod did.

const HOME = '/Users/test'
const DIR = `${HOME}/Library/Caches/sleepwalk`
const PID = '4242'
const SID = '11111111-2222-3333-4444-555555555555'
const OTHER_SID = '66666666-7777-8888-9999-000000000000'
const CHATS = `${HOME}/Library/Application Support/Claude/claude-code-sessions`
const BEAT = `${DIR}/beat-${PID}`
const T0 = 1_800_000_000_000
const WATCHER_LINE = (until: number) =>
  `  101 root             /bin/sh -c # sleepwalk root watcher: one hold, then it exits.\\012#\\012 sleepwalk-watcher ${until} 25 4000 2 ${DIR}`

type Mac = {
  sleep: 0 | 1
  batt: string
  level: number
  temp: number
  /** The running watcher's end, in seconds; null when none runs. */
  watcher: number | null
  password: 'typed' | 'cancel'
  /** How long the person takes to type the password, in ms. */
  typingMs: number
  log: string[]
  files: Map<string, number>
  /** What each file holds, beside its time in `files`. */
  texts: Map<string, string>
  calls: string[][]
  status: string | undefined
  toasts: string[]
  /** The lines the mod wrote into the chat. */
  lines: string[]
  /** Where the session draws. */
  surfaces: ('terminal' | 'desktop')[]
}

function newMac(): Mac {
  return {
    sleep: 0,
    batt: "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; present: true\n",
    level: 0,
    temp: 3000,
    watcher: null,
    password: 'typed',
    typingMs: 0,
    log: [],
    files: new Map(),
    texts: new Map(),
    calls: [],
    status: undefined,
    toasts: [],
    lines: [],
    surfaces: ['desktop'],
  }
}

/** The watcher's loop, run on demand: with no heartbeat left, it turns sleep back on. */
function watcherCheck(mac: Mac): void {
  if (mac.watcher !== null && mac.files.size === 0) {
    mac.watcher = null
    mac.sleep = 0
    mac.log.push('sleepwalk: sleep on: turned off')
  }
}

function fakeMac(on: On, mac: Mac, clock: { now: () => number; sleep: (ms: number) => Promise<void> }): void {
  const out = (stdout: string, exitCode = 0, stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', async (_, e) => {
    const argv = [...e.argv]
    mac.calls.push(argv)
    const [cmd, first, second] = argv

    if (cmd === '/usr/bin/pmset' && first === '-g' && second === 'batt') return out(mac.batt)
    if (cmd === '/usr/bin/pmset' && first === '-g') return out(` SleepDisabled\t\t${mac.sleep}\n`)
    if (cmd === '/bin/ps') {
      return out(`    1 root             /sbin/launchd\n${mac.watcher === null ? '' : `${WATCHER_LINE(mac.watcher)}\n`}`)
    }
    if (cmd === '/bin/sh') return out(`${PID}\n`)
    if (cmd === '/usr/bin/notifyutil') return out(`com.apple.system.thermalpressurelevel ${mac.level}\n`)
    if (cmd === '/usr/sbin/ioreg') return out(`      "Temperature" = ${mac.temp}\n`)
    if (cmd === '/bin/date') return out('23:14\n')
    if (cmd === '/usr/bin/grep') {
      const wanted = argv.at(-2) ?? ''
      const found = [...mac.texts].filter(([path, text]) => path.startsWith(`${CHATS}/`) && text.includes(wanted))
      return out(found.map(([path]) => `${path}\n`).join(''), found.length ? 0 : 1)
    }
    if (cmd === '/usr/bin/open') return out('')
    if (cmd === '/bin/sleep') {
      watcherCheck(mac)
      return out('')
    }
    if (cmd === '/bin/rm') {
      mac.files.delete(argv[2] ?? '')
      watcherCheck(mac)
      return out('')
    }
    if (cmd === '/usr/bin/log') {
      return out(mac.log.map(line => `2026-10-26 21:00:00.000 Df logger[1:2] ${line}`).join('\n'))
    }
    if (cmd === '/usr/bin/osascript') {
      if (mac.typingMs > 0) await clock.sleep(mac.typingMs)
      if (mac.password === 'cancel') return out('', 1, 'execution error: User canceled. (-128)')
      if (argv.some(arg => arg.includes('disablesleep 0'))) {
        mac.sleep = 0
        return out('')
      }
      // The watcher's first check: a heartbeat over 90 s old ends the hold at once.
      const seen = [...mac.files.values()].some(at => clock.now() - at <= 90_000)
      if (!seen) {
        mac.log.push('sleepwalk: sleep on: no heartbeat for 90 s')
        return out('')
      }
      const until = Number(argv.at(-5))
      mac.watcher = until
      mac.sleep = 1
      mac.log.push(`sleepwalk: sleep off until ${until}`)
      return out('')
    }

    return out('', 127, `not faked: ${cmd}`)
  })
  on('fs.write', (_, e) => {
    mac.files.set(e.path, clock.now())
    mac.texts.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => ({
    value: e.path.endsWith('/hooks/watcher.sh') ? '# sleepwalk root watcher: test copy\n' : (mac.texts.get(e.path) ?? ''),
  }))
  on('session.id', () => ({ value: SID }))
  on('session.surfaces', () => ({ value: mac.surfaces }))
  on('fs.list', (_, e) => ({
    value: [...mac.files]
      .filter(([path]) => path.startsWith(`${e.path}/`))
      .map(([path, mtimeMs]) => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 14, mtimeMs, isLink: false })),
  }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'lid' } }))
  on('ui.status', (_, e) => {
    mac.status = e.text
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    mac.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.append', (_, e, next) => {
    const content = e.message.content as unknown
    mac.lines.push(Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? '').join('') : String(content))
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return e.component === 'SessionMode' ? <Text>{(e.props as { modes: string[] }).modes.join(' & ')}</Text> : <Text>engine</Text>
  })
  mock.env(on, { HOME })
}

const BAND = {
  plugin: 'sleepwalk',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const FOOTER = { plugin: 'sleepwalk', component: 'SessionMode', props: { modes: [] } } as const

/** In the app, the password box opens once the band's words are in, 2.6 s after the switch. */
const ASKED_MS = 3_000

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

async function lid($: Engine, args: string): Promise<string> {
  const done = await $.command.run({ command: 'lid', args, ...RUN })
  return done.text ?? ''
}

/** Every text drawn, the band's moving words included: those are a Client's props. */
async function bandText(ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: object }[]> }): Promise<string> {
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const words = (await ui.findAll({ type: 'Client' })).flatMap(found =>
    ((found.props as { props?: WordsProps }).props?.parts ?? []).map(part => part.text),
  )
  return [...texts, ...words].join(' | ')
}

describe('what macOS prints', () => {
  test('pmset, battery and ps lines read right', async () => {
    expect(sleepDisabled(' SleepDisabled\t\t1\n')).toBe(true)
    expect(sleepDisabled(' SleepDisabled\t\t0\n')).toBe(false)
    expect(sleepDisabled('nothing')).toBeNull()
    expect(battery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=2)\t63%; discharging")).toEqual({
      percent: 63,
      isOnBattery: true,
    })
    expect(watchers(`${WATCHER_LINE(1_800_000_600)}\n`)).toEqual([
      { pid: 101, until: 1_800_000_600, floor: 25, hot: 4000, heavy: 2, dir: DIR },
    ])
    expect(watchers(WATCHER_LINE(1).replace('root', 'test'))).toEqual([])
    expect(watchers('  7 root   /bin/sh -c set -m; /bin/sh -c x sleepwalk-watcher 1 2 3 4 /x')).toEqual([])
  })

  test('the watcher reason and its plain words', async () => {
    const log = 'x sleepwalk: sleep off until 1\ny sleepwalk: sleep on: battery at 24%\n'
    expect(lastReason(log)).toBe('battery at 24%')
    expect(words('battery at 24%')).toBe('the battery fell to 24%')
    expect(words('time limit')).toBe('the time limit passed')
    expect(words('battery at 41 C')).toBe('the battery reached 41 °C')
    expect(duration(112 * 60_000)).toBe('1 h 52 min')
    expect(duration(30_000)).toBe('under a minute')
  })

  test('modes, limits and refusals', async () => {
    expect(asksForPermission('default')).toBe(true)
    expect(asksForPermission('acceptEdits')).toBe(true)
    expect(asksForPermission('auto')).toBe(false)
    expect(asksForPermission('bypassPermissions')).toBe(false)
    expect(asksForPermission('')).toBeNull()
    expect(settingsOf({})).toEqual({ limitMs: 7_200_000, floor: 25 })
    expect(settingsOf({ timeLimitMinutes: 1, batteryFloor: 99 })).toEqual({ limitMs: 300_000, floor: 95 })
    expect(parseArgs(' on ')).toEqual({ word: 'on', minutes: null })
    expect(parseArgs('on 30')).toEqual({ word: 'on', minutes: 30 })
    expect(parseArgs('on soon')).toEqual({ word: 'bad', minutes: null })
    expect(parseArgs('')).toEqual({ word: '', minutes: null })
    const cool = { level: 0, temp: 3000, floor: 25 }
    expect(refusal({ ...cool, battery: { percent: 20, isOnBattery: true } })).toMatch('under the 25% floor')
    expect(refusal({ ...cool, battery: { percent: 20, isOnBattery: false } })).toBeNull()
    expect(refusal({ ...cool, level: 2, battery: { percent: 80, isOnBattery: false } })).toMatch('thermal pressure')
    expect(refusal({ ...cool, temp: 4000, battery: { percent: 80, isOnBattery: false } })).toMatch('40 °C')
  })

  test('the password call hands the script and its arguments to AppleScript, unquoted', async () => {
    const argv = passwordArgv('Why', "echo 'x'", ['1', '25', '4000', '2', '/a b'])
    expect(argv[0]).toBe('/usr/bin/osascript')
    expect(argv.slice(-7)).toEqual(['Why', "echo 'x'", '1', '25', '4000', '2', '/a b'])
    expect(argv.join(' ')).toContain('with administrator privileges')
    expect(argv.join(' ')).toContain('set -m; ')
  })
})

describe('the mode in a session', () => {
  test('while off, the footer holds the switch on every surface, and the band stays clear', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ key: 'on' })).toBeUndefined()
      expect(await bandText(ui)).toBe('engine')
      await ui.unmount()
      const footer = await $.ui.mount({ ...FOOTER, surface })
      expect((await footer.find({ key: 'on' }))?.props.label).toBe('\u263e')
      expect(await bandText(footer)).not.toContain('sleepwalking')
      await footer.unmount()
    }
  })

  test('the footer switch asks for the password and the band shows the hold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await footer.press({ key: 'on' })
    await clock.advance(ASKED_MS)
    expect(mac.calls.filter(call => call[0] === '/usr/bin/osascript')).toHaveLength(1)
    expect(mac.sleep).toBe(1)
    expect(await footer.find({ key: 'on' })).toBeUndefined()
    expect(await bandText(footer)).toContain('sleepwalking')
    await footer.unmount()

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake until 23:14')
    await band.unmount()
  })

  test('in the app the password box waits for its words; in the terminal it opens at once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const asked = () => mac.calls.filter(call => call[0] === '/usr/bin/osascript').length

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await footer.press({ key: 'on' })
    await clock.advance(2_400)
    expect(asked()).toBe(0)
    await clock.advance(400)
    expect(asked()).toBe(1)
    await footer.unmount()
    await lid($, 'off')
    await clock.advance(5_000)

    mac.surfaces = ['terminal']
    await lid($, 'on')
    await clock.advance(5)
    expect(asked()).toBe(2)
  })

  test('/lid on asks for the password once, then holds and shows it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(await lid($, 'on')).toContain('A password box is opening')
    expect(mac.files.has(BEAT)).toBe(true)
    await clock.advance(ASKED_MS)

    const asked = mac.calls.filter(call => call[0] === '/usr/bin/osascript')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.slice(-6)).toEqual(['# sleepwalk root watcher: test copy\n', String((T0 + 7_200_000) / 1000), '25', '4000', '2', DIR])
    expect(mac.sleep).toBe(1)
    expect(mac.status).toBe('awake until 23:14, battery 80%')

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await bandText(footer)).toContain('sleepwalking')
    await footer.unmount()

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake until 23:14 | 2 h left, battery 80%')
    await clock.advance(2_500)
    expect((await band.find({ key: 'off' }))?.props.label).toBe('Stop')
    await band.unmount()
  })

  test('Turn off removes the heartbeat and reports sleep back on', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await band.find({ key: 'undraw' })).toBeUndefined()
    // Stop shows once the moon has grown and the words are in.
    expect(await band.find({ key: 'off' })).toBeUndefined()
    await clock.advance(2_500)
    await band.press({ key: 'off' })
    expect(mac.files.size).toBe(0)
    expect(mac.sleep).toBe(0)
    expect(mac.status).toBeUndefined()
    expect(mac.lines).toContain('sleepwalk: sleep is back on: the mode was turned off.')

    // The moon draws back into its dot, then the band goes.
    expect(await band.find({ key: 'undraw' })).toBeDefined()
    expect(await bandText(band)).toContain('Sleep back on.')
    await clock.advance(3_200)
    expect(await band.find({ key: 'hold' })).toBeUndefined()
    expect(await bandText(band)).toBe('engine')
    await band.unmount()

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect((await footer.find({ key: 'on' }))?.props.label).toBe('\u263e')
    await footer.unmount()
  })

  test('a cancelled password box leaves everything off', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.password = 'cancel'
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    expect(mac.files.size).toBe(0)
    expect(mac.sleep).toBe(0)
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toBe('engine')
    await band.unmount()
  })

  test('under the battery floor the mode refuses, with no password box', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t20%; discharging; present: true\n"
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(await lid($, 'on')).toContain('under the 25% floor')
    await clock.advance(ASKED_MS)
    expect(mac.calls.some(call => call[0] === '/usr/bin/osascript')).toBe(false)
    expect(mac.files.size).toBe(0)
  })

  test('the hold ends 2 minutes after the work ends, not while a turn runs', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'build it', turnId: 't1' })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    await clock.advance(10 * 60_000)
    expect(mac.watcher).not.toBeNull()

    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(60_000)
    expect(mac.watcher).not.toBeNull()

    await clock.advance(90_000)
    expect(mac.watcher).toBeNull()
    expect(mac.sleep).toBe(0)
    expect(mac.lines).toContain('sleepwalk: Sleep back on: the work ended 2 minutes ago.')
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toBe('engine')
    await band.unmount()
  })

  test('background work reported at the stop keeps the hold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on')
    await clock.advance(ASKED_MS)
    await $.classic.Stop({
      stop_hook_active: false,
      permission_mode: 'bypassPermissions',
      background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test' }],
      session_crons: [],
    })

    await clock.advance(10 * 60_000)
    expect(mac.watcher).not.toBeNull()
  })

  test('the time limit ends the hold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'long job', turnId: 't1' })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    await clock.advance(7_200_000 + 20_000)
    expect(mac.watcher).toBeNull()
    expect(mac.sleep).toBe(0)
  })

  test('when the watcher ends the hold itself, the chat says why and the band clears', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'job', turnId: 't1' })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    mac.watcher = null
    mac.sleep = 0
    mac.log.push('sleepwalk: sleep on: battery at 24%')
    await clock.advance(20_000)

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toBe('engine')
    await band.unmount()
    expect(mac.lines).toContain('sleepwalk: sleep is back on: the battery fell to 24%.')
    expect(mac.toasts.at(-1)).toBe('Sleep back on: the battery fell to 24%.')
  })

  test('a second session joins a running hold with no password', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.watcher = T0 / 1000 + 3600
    mac.sleep = 1
    mac.files.set(`${DIR}/beat-777`, T0)
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(await lid($, 'on')).toContain('Joined the hold another session started')
    expect(mac.calls.some(call => call[0] === '/usr/bin/osascript')).toBe(false)
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake until 23:14')
    await band.unmount()

    expect(await lid($, 'off')).toContain('Another session still keeps the Mac awake')
    expect(mac.watcher).not.toBeNull()
  })

  test('a permission mode that asks is warned about while the mode is on', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'default' })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Default mode asks first.')
    expect(await bandText(band)).toContain('Remote Control')
    await band.unmount()

    await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'bypassPermissions' })
    const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(again)).not.toContain('Remote Control')
    await again.unmount()
  })

  test('sleep left off at start shows the fix, and the fix asks for the password', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.sleep = 1
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Sleep is still off')
    await band.press({ key: 'restore' })
    expect(mac.sleep).toBe(0)
    expect(await bandText(band)).toBe('engine')
    expect(mac.toasts.at(-1)).toBe('Sleep back on.')
    await band.unmount()
  })

  test('the session ending removes the heartbeat', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on')
    await clock.advance(ASKED_MS)
    expect(mac.files.size).toBe(1)

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
    expect(mac.files.size).toBe(0)
    expect(mac.watcher).toBeNull()
  })
  test('a slow password box keeps the heartbeat fresh, so the hold starts', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.typingMs = 150_000
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.turn.start({ text: 'job', turnId: 't1' })
    await lid($, 'on')
    await clock.advance(160_000)

    expect(mac.log).toContain(`sleepwalk: sleep off until ${(T0 + 7_200_000) / 1000}`)
    expect(mac.sleep).toBe(1)
    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await bandText(footer)).toContain('sleepwalking')
    await footer.unmount()
  })

  test('/lid on 30 holds for 30 minutes', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on 30')
    await clock.advance(ASKED_MS)

    expect(mac.watcher).toBe((T0 + 30 * 60_000) / 1000)
    expect(await lid($, 'on soon')).toContain('Use /lid on')
  })

  test('with no watcher running, a stale heartbeat file from a crash is deleted', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    mac.files.set(`${DIR}/beat-999`, T0 - 600_000)
    mac.files.set(`${DIR}/beat-998`, T0 - 10_000)
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect([...mac.files.keys()]).toEqual([`${DIR}/beat-998`])
  })
  test('the heartbeat names this chat', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await lid($, 'on')
    await clock.advance(ASKED_MS)

    expect(mac.texts.get(BEAT)?.split('\n')[1]).toBe(SID)
  })
})

describe('while another chat keeps the Mac awake', () => {
  /** Another desktop chat holds: its heartbeat, the watcher, and the app's file for it. */
  function otherChat(mac: Mac, title: string): void {
    mac.watcher = T0 / 1000 + 3600
    mac.sleep = 1
    mac.files.set(`${DIR}/beat-777`, T0)
    mac.texts.set(`${DIR}/beat-777`, `${T0}\n${OTHER_SID}\n`)
    mac.texts.set(
      `${CHATS}/a/b/local_abc-123.json`,
      JSON.stringify({ sessionId: 'local_abc-123', cliSessionId: OTHER_SID, title }),
    )
  }

  test('the band names that chat, and Open opens it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'Mods Q17: tidy ticker')
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake: Mods Q17: tidy ticker')
    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await footer.find({ key: 'on' })).toBeUndefined()
    await footer.unmount()
    await band.press({ key: 'open' })
    expect(mac.calls).toContainEqual(['/usr/bin/open', 'claude://code/continue?session=local_abc-123'])
    await band.unmount()
  })

  test('a long chat name is cut to fit one row', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'A chat whose name runs on far longer than any band row can hold')
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake: A chat whose name runs on far longer th\u2026')
    await band.unmount()
  })

  test('a chat the app has no file for is not named, and has no Open', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'unused')
    mac.texts.clear()
    mac.texts.set(`${DIR}/beat-777`, `${T0}\n${OTHER_SID}\n`)
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Another chat keeps the Mac awake')
    expect(await band.find({ key: 'open' })).toBeUndefined()
    await band.unmount()
  })

  test('with no watcher running, a fresh heartbeat names no chat', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'Mods Q17')
    mac.watcher = null
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect((await footer.find({ key: 'on' }))?.props.label).toBe('\u263e')
    await footer.unmount()
  })

  test('when that chat stops, the switch comes back', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'Mods Q17')
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    mac.files.delete(`${DIR}/beat-777`)
    mac.watcher = null
    await clock.advance(15_000)
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toBe('engine')
    await band.unmount()
    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect((await footer.find({ key: 'on' }))?.props.label).toBe('\u263e')
    await footer.unmount()
  })

  test('turning on here still joins that hold', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const mac = newMac()
    otherChat(mac, 'Mods Q17')
    fakeMac(on, mac, clock)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    expect(await lid($, 'on')).toContain('Joined the hold another session started')
    await clock.advance(15_000)
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await bandText(band)).toContain('Awake until 23:14')
    expect(await bandText(band)).not.toContain('Awake: Mods Q17')
    await band.unmount()
  })
})
