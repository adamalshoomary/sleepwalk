// Icons, hand-drawn and a little uneven, in Claude clay. The still ones come
// from tools/icons.py; the moving ones are written below. Each is a 24 by 24
// drawing; sized() sets the size a still one draws at.

export const moonOff = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><path d=\"M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z\" fill=\"none\" stroke=\"#D97757\" stroke-width=\"1.9\" stroke-linejoin=\"round\" opacity=\"0.85\"/></svg>"

export const arrow = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><path d=\"M12.3 19.8 C12.1 15.2 11.8 10.4 12.1 5.2 M7.1 10.1 C8.9 8.2 10.6 6.4 12.1 4.6 C13.7 6.1 15.4 7.9 17.2 9.4\" fill=\"none\" stroke=\"#D97757\" stroke-width=\"2.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>"

/** The icon at `px` CSS pixels. */
export function sized(svg: string, px: number): string {
  return svg.replace('width="24" height="24"', `width="${px}" height="${px}"`)
}

const EASE_OUT = 'cubic-bezier(.3,0,.2,1)'
const EASE_IN_OUT = 'cubic-bezier(.45,0,.55,1)'

// The band's icons, the same block in each of Adam's mods. An icon draws at
// ICON_PX in a frame INSET pixels wider on the left, so it sits centred over
// the prompt box's + and the row's words start where the working row's do.
// Measured in desktop app 4.29.0 (Q26).

/** CSS pixels: the icon's size, and the empty room left of it. */
export const ICON_PX = 16
export const INSET = 5.8
/** The frame's width, for the Svg's `width`. */
export const BAND_W = ICON_PX + INSET

const ORIGIN = 'transform-box:view-box;transform-origin:12px 12px'

/** One band frame's markup: a 24-unit drawing, widened on the left. */
function bandFrame(style: string, body: string): string {
  const units = (INSET * 24) / ICON_PX
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAND_W}" height="${ICON_PX}" viewBox="${-units} 0 ${24 + units} 24">${style}${body}</svg>`
}

/** A still 24 by 24 icon in the band's frame. */
export function banded(svg: string): string {
  const units = (INSET * 24) / ICON_PX
  return svg.replace(
    'width="24" height="24" viewBox="0 0 24 24"',
    `width="${BAND_W}" height="${ICON_PX}" viewBox="${-units} 0 ${24 + units} 24"`,
  )
}

const SHAFT = 'M12.3 19.8 C12.1 15.2 11.8 10.4 12.1 5.2'
const HEAD = 'M7.1 10.1 C8.9 8.2 10.6 6.4 12.1 4.6 C13.7 6.1 15.4 7.9 17.2 9.4'
const ARROW_LINE = 'fill="none" stroke="#D97757" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100 101"'
// A dash offset of 99.5 leaves one round dot where a stroke starts; 0 shows it whole.
const ARROW_IN = '@keyframes i{0%{stroke-dashoffset:99.5;stroke-width:0}20%{stroke-dashoffset:99.5;stroke-width:2.3px}100%{stroke-dashoffset:0;stroke-width:2.3px}}'

/** The update arrow as its line shows: it grows from a dot at its foot over 1.2 s, then stays. */
export const arrowIn = bandFrame(
  `<style>.a{animation:i .7s ${EASE_OUT} both}.h{animation:i .6s ${EASE_OUT} .6s both}${ARROW_IN}</style>`,
  `<path class="a" d="${SHAFT}" ${ARROW_LINE}/><path class="h" d="${HEAD}" ${ARROW_LINE}/>`,
)

/** The update arrow while Update runs: it rises and settles every 1.6 s. */
export const arrowBusy = bandFrame(
  `<style>.u{${ORIGIN};animation:u 1.6s ${EASE_IN_OUT} infinite}@keyframes u{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.4px)}}</style>`,
  `<g class="u"><path d="${SHAFT} ${HEAD}" ${ARROW_LINE.replace(' pathLength="100" stroke-dasharray="100 101"', '')}/></g>`,
)

/** The update arrow, still. */
export const arrowStill = banded(arrow)

// The band's moon moves as Claude's own working icons do: it grows from a dot
// as the band appears, rocks and breathes while the Mac is kept awake, and
// draws back into the dot when sleep comes back on. Both take 2.4 s, twice
// ticker's wave (Adam, Q26). CSS only: the desktop app keeps the frame of an
// unchanged source across redraws, so it never restarts.

/** Seconds: the grow, one beat, the time the undraw holds still, the undraw. */
export const DRAW_S = 2.4
export const BEAT_S = 4.8
export const HOLD_S = 0.5
export const UNDRAW_S = 2.4

/** The crescent at rest, and thin, its inner curve bent in and its lower tip curled. */
const CRESCENT = 'M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z'
const THIN = 'M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C16.6 20.2 18.4 19.0 19.4 17.6 C13.4 18.6 8.3 15.4 8.2 10.0 C8.1 7.2 10.6 4.6 14.6 3.3 Z'
/** The dot the moon grows from and shrinks into, as a scale. */
const DOT = 0.16
const GROW = `@keyframes g{0%{transform:scale(0)}12%{transform:scale(${DOT})}100%{transform:scale(1)}}`
const ROCK = '@keyframes r{0%,50%,100%{transform:rotate(0)}25%{transform:rotate(-10deg)}75%{transform:rotate(9deg)}}'
const BREATHE = `@keyframes b{0%,100%{d:path("${CRESCENT}")}50%{d:path("${THIN}")}}`
const MOON_BODY = `<g class="g"><g class="r"><path class="b" d="${CRESCENT}" fill="#D97757"/></g></g>`

/** The beat, in step with a moon that appeared `ageS` seconds ago. */
function beat(ageS: number): string {
  const delay = (DRAW_S - ageS).toFixed(2)
  return `.r{${ORIGIN};animation:r ${BEAT_S}s ${EASE_IN_OUT} ${delay}s infinite}.b{animation:b ${BEAT_S}s ${EASE_IN_OUT} ${delay}s infinite}`
}

/**
 * The moon while the band shows. A moon that appeared `ageS` seconds ago
 * carries on where it was; at 0 it grows from the dot.
 */
export function moonRunning(ageS = 0): string {
  const grow = ageS < DRAW_S ? `.g{${ORIGIN};animation:g ${DRAW_S}s ${EASE_OUT} ${(-ageS).toFixed(2)}s both}` : ''
  return bandFrame(`<style>${grow}${beat(ageS)}${GROW}${ROCK}${BREATHE}</style>`, MOON_BODY)
}

/**
 * The moon as the band goes: drawn over the running moon, it holds still for
 * HOLD_S while its frame loads, then shrinks into the dot and away.
 */
export function moonUndraw(ageS: number): string {
  const total = HOLD_S + UNDRAW_S
  const held = ((HOLD_S / total) * 100).toFixed(1)
  const dot = (((HOLD_S + UNDRAW_S * 0.88) / total) * 100).toFixed(1)
  // A moon still growing shrinks from the size it had reached.
  const from = ageS >= DRAW_S ? 1 : Math.max(DOT, 1 - (1 - ageS / DRAW_S) ** 3)
  const shrink = `@keyframes o{0%,${held}%{transform:scale(${from.toFixed(2)});animation-timing-function:${EASE_IN_OUT}}${dot}%{transform:scale(${DOT});animation-timing-function:${EASE_IN_OUT}}100%{transform:scale(0)}}`
  return bandFrame(`<style>.g{${ORIGIN};animation:o ${total}s linear both}${beat(ageS)}${shrink}${ROCK}${BREATHE}</style>`, MOON_BODY)
}

/** An empty frame the size of the moon's, drawn in its place once the undraw covers it. */
export function moonCleared(): string {
  return bandFrame('', '')
}
