import type { ClientModule } from 'claude-code'

// The band's words, drawn by the surface itself so they can move every frame.
// They wipe in from the left with a soft edge once the moon has grown, and
// wipe out from the right as the band goes. A new `phase` wipes them in
// afresh; new text in the same phase (the time left, the battery) changes in
// place. Times are milliseconds from the start of the phase.

/** One run of words: plain, dim, or a warning's yellow. */
export type Words = { text: string; tone: 'plain' | 'dim' | 'warning' }
export type WordsProps = { phase: string; parts: Words[]; inAtMs: number; outAtMs: number | null }
type Shown = { phase: string; ms: number; inAtMs: number; outAtMs: number | null }

/** Milliseconds: one frame, and one wipe. */
const FRAME_MS = 16
export const WIPE_MS = 600
/** How many characters the soft edge fades across. */
const EDGE = 4

/** Whether the words are still moving at `ms`. */
function isMoving(shown: Shown): boolean {
  return shown.ms <= (shown.outAtMs ?? shown.inAtMs) + WIPE_MS
}

const words: ClientModule<WordsProps, Shown> = (props, surface) => {
  const { Box, Text } = surface.elements
  const shown = surface.state
  if (shown === undefined) {
    surface.setState({ phase: props.phase, ms: 0, inAtMs: props.inAtMs, outAtMs: props.outAtMs })
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (now !== undefined && isMoving(now)) surface.setState({ ...now, ms: now.ms + FRAME_MS })
    })
    return <Box />
  }
  if (shown.phase !== props.phase || shown.outAtMs !== props.outAtMs) {
    const isNew = shown.phase !== props.phase
    surface.setState({ phase: props.phase, ms: isNew ? 0 : shown.ms, inAtMs: props.inAtMs, outAtMs: props.outAtMs })
  }

  const total = props.parts.reduce((sum, part) => sum + part.text.length, 0)
  const span = total + EDGE
  const into = Math.min(1, Math.max(0, (shown.ms - shown.inAtMs) / WIPE_MS))
  const out = shown.outAtMs === null ? 0 : Math.min(1, Math.max(0, (shown.ms - shown.outAtMs) / WIPE_MS))
  // The first character not yet shown; the EDGE before it fade in two steps.
  const front = Math.round(span * (into - out))

  let start = 0
  const runs = props.parts.map((part, index) => {
    const full = Math.max(0, Math.min(part.text.length, front - EDGE - start))
    const near = Math.max(0, Math.min(part.text.length, front - EDGE / 2 - start))
    const far = Math.max(0, Math.min(part.text.length, front - start))
    start += part.text.length
    if (far === 0) return null
    return (
      <Text key={`w${index}`} dimColor={part.tone === 'dim'} color={part.tone === 'warning' ? 'yellow' : undefined}>
        {part.text.slice(0, full)}
        <Text color="inactive">{part.text.slice(full, near)}</Text>
        <Text color="subtle">{part.text.slice(near, far)}</Text>
      </Text>
    )
  })
  return (
    <Box flexDirection="row" alignItems="center" gap="sm">
      {runs}
    </Box>
  )
}

export default words
