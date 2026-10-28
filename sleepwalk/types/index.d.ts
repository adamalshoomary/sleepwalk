/** Where this session's hold stands. */
export type LidPhase = 'off' | 'asking' | 'on' | 'stopping'

/** This session's hold on the Mac. */
export type LidHold = {
  phase: LidPhase
  /** When the mode was turned on, in ms since the epoch. */
  startedAt: number
  /** When this session's hold ends at the latest, in ms since the epoch. */
  endsAt: number
  /** `endsAt` as a clock time, such as `23:14`. */
  endsAtText: string
  /** True when this session joined a hold another session started. */
  isJoined: boolean
  /** The session's CLI process, which the heartbeat file is named after. */
  pid: string
  /** The heartbeat file's path. */
  beat: string
}

/** The last outcome the band shows, such as why sleep came back on. */
export type LidNote = { text: string; isWarning: boolean }

/** Whether the session is working, so the hold can end 2 minutes after. */
export type LidWork = {
  isTurnRunning: boolean
  /** Background commands, agents and scheduled wake-ups at the last stop. */
  pending: number
  /** The last time work was seen, in ms since the epoch. */
  lastWorkAt: number
}

/** What the last heartbeat read, for the band and the status line. */
export type LidReading = {
  battery: number | null
  isOnBattery: boolean
  /** Other sessions whose heartbeat keeps the same hold going. */
  others: number
}

/** The update line above the prompt; null shows none. */
export type UpdateView =
  | { phase: 'offer'; current: string; latest: string }
  | { phase: 'updating'; latest: string }
  | { phase: 'done'; text: string; isWarning: boolean }
  | null

declare module 'claude-code' {
  interface PluginState {
    'sleepwalk': {
      hold: LidHold
      note: LidNote | null
      work: LidWork
      reading: LidReading | null
      /** The permission mode the classic hooks last reported; '' until then. */
      mode: string
      /** True when sleep is off on this Mac and no watcher holds it. */
      isSleepLeftOff: boolean
      isLeftoverHidden: boolean
      /** The update line above the prompt; null shows none. */
      update: UpdateView
    }
  }
}
