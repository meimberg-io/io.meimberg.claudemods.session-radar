import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Entry, Status, WaitReason } from '../types'
import { CARD_H, TILES_H, cardOf, cardSvg, tilesSvg } from './cards'
import { HOST_ID } from './channel'
import { groupRoster } from './roster'
import type { Row } from './roster'

export const PANE = 'session-radar'
export const PANE_TITLE = 'Session Radar'

const GLYPH: Record<Status, string> = { waiting: '◆', working: '●', idle: '✓' }
const COLOR: Record<Status, string> = { waiting: '#e8a33d', working: '#8f8cf4', idle: '#5fbf8f' }
const WAIT_WORD: Record<WaitReason, string> = {
  permission: 'Freigabe',
  question: 'Rückfrage',
  plan: 'Plan zur Freigabe',
  nextstep: 'Frage im Next step',
}
const TITLE_MAX = 60
const NOTE_MAX = 50
const BAR_W = 16

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function minutes(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m < 1 ? 'gerade eben' : `${m} min`
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h > 0 ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`
}

function cost(usd: number): string {
  return `≈$${usd.toFixed(2)}`
}

function bar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * BAR_W) : 0
  return '█'.repeat(filled) + '░'.repeat(BAR_W - filled)
}

function waitText(r: Row): string {
  if (!r.waitReason) return 'wartet'
  return r.waitReason === 'permission' && r.waitTool ? `${WAIT_WORD.permission} ${r.waitTool}` : WAIT_WORD[r.waitReason]
}

export type PaneData = {
  entries: readonly Entry[]
  now: number
  self: string
  isOpen: boolean
  onToggleDone: () => void
  // Jumps to a session in the desktop app by its app id.
  onOpen: (hostId: string) => void
  surface: RenderSurface
  // The pane body's width in cells, as the Pane props give it.
  columns: number
}

// The pane's tree from the surface's elements and what it shows; the caller
// reads $ and hands in the elements, as $ does not cross into this file.
export function paneTree(els: Elements[keyof Elements], data: PaneData): RenderElement {
  const { Box, Text, Button } = els
  const { now, self, isOpen } = data
  const g = groupRoster(data.entries, now)
  const total = [...g.waiting, ...g.working, ...g.idle].reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  const statsOf = (r: Row) =>
    [
      r.contextPercent !== undefined ? `ctx ${Math.round(r.contextPercent)}%` : undefined,
      r.costUsd !== undefined ? cost(r.costUsd) : undefined,
      clock(now - r.startedAt),
    ].filter(Boolean)
  const titleOf = (r: Row) => clip(r.title || r.cwd, TITLE_MAX) + (r.id === self ? ' (diese)' : '')
  const waitLine = (r: Row) =>
    `${waitText(r)} · seit ${minutes(now - (r.waitingSince ?? r.updatedAt))}` +
    (r.isStale ? ` · keine Rückmeldung seit ${minutes(now - r.heartbeat)}` : '')
  const isEmpty = g.waiting.length + g.working.length + g.idle.length === 0
  // The title line: status glyph and title, the link into the session where
  // there is one to jump to; underlined while the pointer is on it.
  const titleLine = (r: Row) => {
    const glyph = <Text color={COLOR[r.status]}>{GLYPH[r.status]} </Text>
    const title = <Text bold>{titleOf(r)}</Text>
    const hostId = r.hostId
    return hostId && r.id !== self && HOST_ID.test(hostId) ? (
      <Box key={`line-${r.id}`} flexDirection="row">
        {glyph}
        <Button key={`open-${r.id}`} label={titleOf(r)} plain hover={{ scope: `title-${r.id}`, underline: true }} dimColor={r.isStale || undefined} onPress={() => data.onOpen(hostId)} />
      </Box>
    ) : (
      <Text key={`title-${r.id}`} wrap="truncate-end" dimColor={r.isStale}>
        {glyph}
        {title}
      </Text>
    )
  }
  const toggle = g.idle.length > 0 && (
    <Button key="done-toggle" label={`${isOpen ? '▾' : '▸'} Fertig · ${g.idle.length}`} plain onPress={data.onToggleDone} />
  )

  if (data.surface !== 'terminal' && 'Svg' in els) {
    const { Svg } = els
    const W = Math.max(240, Math.min(900, (data.columns || 40) * 8 - 8))
    const card = (r: Row) => {
      const sub = r.status === 'waiting' ? waitLine(r) : r.model ?? ''
      const c = cardOf(r, sub, statsOf(r).join(' · '))
      const alt = [titleOf(r), sub, c.steps, c.stats].filter(Boolean).join(', ')
      return (
        <Box key={r.id} flexDirection="column">
          {titleLine(r)}
          <Svg source={cardSvg(W, c)} alt={alt} width={W} height={CARD_H} />
        </Box>
      )
    }
    const tiles = [
      { label: 'Wartet', value: String(g.waiting.length), color: g.waiting.length > 0 ? COLOR.waiting : undefined },
      { label: 'Läuft', value: String(g.working.length) },
      { label: 'Kosten', value: cost(total) },
    ]
    return (
      <Box flexDirection="column">
        <Svg
          key="tiles"
          source={tilesSvg(W, tiles)}
          alt={`Wartet ${g.waiting.length}, Läuft ${g.working.length}, Kosten ${cost(total)}`}
          width={W}
          height={TILES_H}
        />
        {isEmpty && <Text dimColor>Keine Sessions gemeldet.</Text>}
        {g.waiting.length > 0 && <Text key="h-wait" dimColor>Wartet auf dich · {g.waiting.length}</Text>}
        {g.waiting.map(card)}
        {g.working.length > 0 && <Text key="h-run" dimColor>Läuft · {g.working.length}</Text>}
        {g.working.map(card)}
        {toggle}
        {isOpen && g.idle.map(card)}
      </Box>
    )
  }

  const row = (r: Row) => {
    const meta = [r.model, ...statsOf(r)].filter(Boolean)
    return (
      <Box key={r.id} flexDirection="column" marginBottom={1}>
        {titleLine(r)}
        {r.status === 'waiting' && (
          <Text wrap="truncate-end" color={r.isStale ? undefined : COLOR.waiting} dimColor={r.isStale}>
            {'  '}
            {waitLine(r)}
          </Text>
        )}
        {r.status === 'working' && r.tasks && r.tasks.total > 0 && (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={COLOR.working}>{bar(r.tasks.done, r.tasks.total)}</Text> {r.tasks.done}/{r.tasks.total}
            {r.tasks.current ? ` · ${clip(r.tasks.current, NOTE_MAX)}` : ''}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          {'  '}
          {meta.join(' · ')}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Text color={COLOR.waiting} bold>
          Wartet · {g.waiting.length}
        </Text>
        <Text color={COLOR.working} bold>
          Läuft · {g.working.length}
        </Text>
        <Text bold>{cost(total)}</Text>
      </Box>
      {isEmpty && <Text dimColor>Keine Sessions gemeldet.</Text>}
      {g.waiting.length > 0 && (
        <Text key="h-wait" bold>
          Wartet auf dich · {g.waiting.length}
        </Text>
      )}
      {g.waiting.map(row)}
      {g.working.length > 0 && (
        <Text key="h-run" bold>
          Läuft · {g.working.length}
        </Text>
      )}
      {g.working.map(row)}
      {toggle}
      {isOpen && g.idle.map(row)}
    </Box>
  )
}
