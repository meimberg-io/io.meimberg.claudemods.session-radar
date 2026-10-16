import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Entry } from '../types'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const PANE = 'session-radar'
const props = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

function entry(over: Partial<Entry>): Entry {
  return { v: 1, id: 'x', title: 'repo: task', cwd: '/repo', status: 'idle', startedAt: NOW - 60_000, updatedAt: NOW, heartbeat: NOW, ...over }
}

const three = {
  'session:w': entry({ id: 'w', title: 'Wartende Session', status: 'waiting', waitReason: 'permission', waitTool: 'Bash', waitingSince: NOW - 120_000 }),
  'session:r': entry({ id: 'r', title: 'Laufende Session', status: 'working', tasks: { done: 2, total: 5, current: 'Tests schreiben' } }),
  'session:i': entry({ id: 'i', title: 'Fertige Session', status: 'idle', lastTurnEndedAt: NOW - 5_000 }),
}

async function open($: Engine, on: On, entries: Record<string, unknown> = three): Promise<string[]> {
  const opened: string[] = []
  mock.store(on, entries)
  mock.clock(on, { now: NOW })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.id', async () => ({ value: 'r' }) as never)
  on('session.surfaces', async () => ({ value: [] }) as never)
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', async () => ({ value: [{ id: PANE }] }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.command.run({ command: 'radar', args: '' } as never)
  return opened
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane groups waiting, running and finished sessions`, async ($, on) => {
    await open($, on)
    const ui = await $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ text: /Wartet auf dich · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Läuft · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Fertig · 1/ })).toBeDefined()
  })

  test(`${surface}: a waiting row says what it waits for`, async ($, on) => {
    await open($, on)
    const ui = await $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ text: /Freigabe Bash/ })).toBeDefined()
  })

  test(`${surface}: a running row shows its task progress`, async ($, on) => {
    await open($, on)
    const ui = await $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ text: /2\/5/ })).toBeDefined()
    expect(await ui.find({ text: /\(diese\)/ })).toBeDefined()
  })

  test(`${surface}: finished sessions show only once unfolded`, async ($, on) => {
    await open($, on)
    const ui = await $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ text: /Fertige Session/ })).toBeUndefined()
    await ui.press({ key: 'done-toggle' })
    expect(await ui.find({ text: /Fertige Session/ })).toBeDefined()
  })

  test(`${surface}: a very long title is clipped and still draws`, async ($, on) => {
    await open($, on, { 'session:long': entry({ id: 'long', title: 'L'.repeat(500), status: 'working' }) })
    const ui = await $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
    expect(await ui.find({ text: /L{59}…/ })).toBeDefined()
    expect(await ui.find({ text: /L{61}/ })).toBeUndefined()
  })
}

test('/radar opens the pane', async ($, on) => {
  const opened = await open($, on)
  expect(opened).toEqual([PANE])
})
