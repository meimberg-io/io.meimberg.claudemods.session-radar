import type { Status } from '../types'
import type { Row } from './roster'

// The desktop look: summary tiles and one card per session, each an SVG string
// for the surface's Svg element. Pure; light and dark through the SVG's own
// media query. Laid out after savvy-progress's agents panel.

// The title sits above the card, as the link to the session; the card holds the rest.
export const CARD_H = 50
export const TILES_H = 44

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const COLOR: Record<Status, string> = { waiting: '#e8a33d', working: '#8f8cf4', idle: '#5fbf8f' }
// Under the title's text, past its status glyph.
const TEXT_X = 16
export const MARK_W = 22

const CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
</style>`

export function xml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

// Rough advance of system UI text in em, enough to fit a line into its slot.
function em(ch: string): number {
  if (/[⺀-鿿가-힣！-｠\u{1F300}-\u{1FAFF}]/u.test(ch)) return 1
  if (/[\s.,:;'|!il1()[\]]/.test(ch)) return 0.3
  if (/[A-ZÄÖÜmw@%]/.test(ch)) return 0.72
  return 0.56
}

export function textWidth(text: string, size: number): number {
  let w = 0
  for (const ch of text) w += em(ch) * size
  return w
}

export function fit(text: string, size: number, width: number): string {
  if (textWidth(text, size) <= width) return text
  let out = ''
  let w = textWidth('…', size)
  for (const ch of text) {
    w += em(ch) * size
    if (w > width) break
    out += ch
  }
  return out + '…'
}

export function svg(W: number, H: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${body}</svg>`
}

export function tilesSvg(W: number, tiles: readonly { label: string; value: string; color?: string }[]): string {
  const gap = 6
  const tw = (W - gap * (tiles.length - 1)) / tiles.length
  const body = tiles
    .map((t, i) => {
      const x = i * (tw + gap)
      const fill = t.color ? `fill="${t.color}"` : 'class="t"'
      return `<rect class="tile" x="${x}" y="0" width="${tw}" height="40" rx="8"/>
<text class="s" x="${x + 9}" y="16" font-family="${FONT}" font-size="11">${xml(t.label)}</text>
<text ${fill} x="${x + 9}" y="33" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${xml(t.value)}</text>`
    })
    .join('\n')
  return svg(W, TILES_H, body)
}

export type Card = {
  // The line under the title: what it waits for, or the model.
  sub: string
  isSubColored: boolean
  // Left of the bar's line: the running step; right: context, cost, time.
  steps: string
  stats: string
  // 0..1 of the bar; null draws it empty.
  progress: number | null
  status: Status
  isStale: boolean
}

export function cardSvg(W: number, c: Card): string {
  const color = COLOR[c.status]
  const textW = W - TEXT_X - MARK_W
  const statsW = textWidth(c.stats, 11)
  const stepsW = Math.max(0, textW - statsW - 12)
  const fillW = Math.round(textW * Math.max(0, Math.min(1, c.progress ?? 0)))
  const sub = c.isSubColored ? `fill="${color}"` : 'class="s"'
  const body = `<g${c.isStale ? ' opacity=".5"' : ''}>
<text ${sub} x="${TEXT_X}" y="13" font-family="${FONT}" font-size="11">${xml(fit(c.sub, 11, textW))}</text>
${c.steps && stepsW > 30 ? `<text class="t" x="${TEXT_X}" y="29" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fit(c.steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${TEXT_X + textW}" y="29" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(c.stats)}</text>
<rect class="k" x="${TEXT_X}" y="36" width="${textW}" height="4" rx="2"/>${fillW > 0 ? `<rect x="${TEXT_X}" y="36" width="${fillW}" height="4" rx="2" fill="${color}"/>` : ''}
</g>
<line class="ln" x1="0" y1="${CARD_H - 0.5}" x2="${W}" y2="${CARD_H - 0.5}"/>`
  return svg(W, CARD_H, body)
}

// What a card shows of a session row.
export function cardOf(r: Row, sub: string, stats: string): Card {
  const steps = r.status === 'working' && r.tasks && r.tasks.total > 0 ? `${r.tasks.done}/${r.tasks.total}${r.tasks.current ? ' · ' + r.tasks.current : ''}` : ''
  const progress =
    r.status === 'idle' ? 1 : r.status === 'waiting' ? 1 : r.tasks && r.tasks.total > 0 ? r.tasks.done / r.tasks.total : null
  return { sub, isSubColored: r.status === 'waiting', steps, stats, progress, status: r.status, isStale: r.isStale }
}
