import type { Elements, RenderElement } from 'claude-code'

import type { Status, WaitReason } from '../types'
import { groupRoster } from './roster'
import type { Row } from './roster'
import type { Entry } from '../types'

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
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
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
}

// The pane's tree from the surface's elements and what it shows; the caller
// reads $ and hands in the elements, as $ does not cross into this file.
export function paneTree(els: Elements[keyof Elements], data: PaneData): RenderElement {
  const { Box, Text, Button } = els
  const { now, self, isOpen } = data
  const g = groupRoster(data.entries, now)
  const total = [...g.waiting, ...g.working, ...g.idle].reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  const row = (r: Row) => {
    const meta = [
      r.model,
      r.contextPercent !== undefined ? `ctx ${Math.round(r.contextPercent)}%` : undefined,
      r.costUsd !== undefined ? cost(r.costUsd) : undefined,
      clock(now - r.startedAt),
    ].filter(Boolean)
    return (
      <Box key={r.id} flexDirection="column" marginBottom={1}>
        <Text wrap="truncate-end" dimColor={r.isStale}>
          <Text color={COLOR[r.status]}>{GLYPH[r.status]} </Text>
          <Text bold>{clip(r.title || r.cwd, TITLE_MAX)}</Text>
          {r.id === self ? ' (diese)' : ''}
        </Text>
        {r.status === 'waiting' && (
          <Text wrap="truncate-end" color={r.isStale ? undefined : COLOR.waiting} dimColor={r.isStale}>
            {'  '}
            {waitText(r)} · seit {minutes(now - (r.waitingSince ?? r.updatedAt))}
            {r.isStale ? ` · keine Rückmeldung seit ${minutes(now - r.heartbeat)}` : ''}
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

  const isEmpty = g.waiting.length + g.working.length + g.idle.length === 0

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
      {g.idle.length > 0 && (
        <Button
          key="done-toggle"
          label={`${isOpen ? '▾' : '▸'} Fertig · ${g.idle.length}`}
          plain
          onPress={data.onToggleDone}
        />
      )}
      {isOpen && g.idle.map(row)}
    </Box>
  )
}
