// Icons, hand-drawn and a little uneven, in Claude clay. Source: tools/icons.py.
// Each is a 24 by 24 SVG; sized() sets the size it draws at.

export const moonOff = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><path d=\"M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z\" fill=\"none\" stroke=\"#D97757\" stroke-width=\"1.9\" stroke-linejoin=\"round\" opacity=\"0.85\"/></svg>"

export const moonOn = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><style>.r{transform-box:view-box;transform-origin:12px 12px;animation:s 5.2s ease-in-out infinite}@keyframes s{0%,100%{transform:rotate(-11deg)}50%{transform:rotate(9deg)}}</style><g class=\"r\"><path d=\"M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z\" fill=\"#D97757\"><animate attributeName=\"d\" dur=\"4s\" repeatCount=\"indefinite\" values=\"M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z;M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C16.6 20.2 18.4 19.0 19.4 17.6 C13.4 18.6 8.3 15.4 8.2 10.0 C8.1 7.2 10.6 4.6 14.6 3.3 Z;M14.6 3.3 C9.2 3.1 4.4 7.4 4.6 13.2 C4.8 18.4 9.6 21.4 14.2 20.6 C17.3 20.1 19.6 18.2 20.6 15.9 C15.2 17.1 10.6 13.4 10.9 8.6 C11.1 6.4 12.4 4.5 14.6 3.3 Z\" keyTimes=\"0;.5;1\" calcMode=\"spline\" keySplines=\".45 0 .55 1;.45 0 .55 1\"/></path></g></svg>"

export const arrow = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><path d=\"M12.3 19.8 C12.1 15.2 11.8 10.4 12.1 5.2 M7.1 10.1 C8.9 8.2 10.6 6.4 12.1 4.6 C13.7 6.1 15.4 7.9 17.2 9.4\" fill=\"none\" stroke=\"#D97757\" stroke-width=\"2.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>"

/** The icon at `px` CSS pixels. */
export function sized(svg: string, px: number): string {
  return svg.replace('width="24" height="24"', `width="${px}" height="${px}"`)
}
