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
  'session:w': entry({ id: 'w', title: 'Wartende Session', status: 'waiting', waitReason: 'permission', waitTool: 'Bash', waitingSince: NOW - 120_000, hostId: 'local_aaaa-1111' }),
  'session:r': entry({ id: 'r', title: 'Laufende Session', status: 'working', tasks: { done: 2, total: 5, current: 'Tests schreiben' }, hostId: 'local_bbbb-2222' }),
  'session:i': entry({ id: 'i', title: 'Fertige Session', status: 'idle', lastTurnEndedAt: NOW - 5_000 }),
}

// The commands the pane ran on the host, as argv.
let ran: string[][] = []

async function open($: Engine, on: On, entries: Record<string, unknown> = three): Promise<string[]> {
  const opened: string[] = []
  ran = []
  on('process.run', async (_$, e) => {
    ran.push([...(e as unknown as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
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

async function mount($: Engine, surface: 'terminal' | 'desktop') {
  return $.ui.mount({ plugin: 'session-radar', surface, component: 'Pane', requestId: PANE, props })
}

// What a row says: its text on the terminal, its card's alt text on the desktop.
async function says($: Engine, surface: 'terminal' | 'desktop', text: RegExp): Promise<boolean> {
  const ui = await mount($, surface)
  const found =
    surface === 'terminal'
      ? (await ui.find({ text })) !== undefined
      : (await ui.findAll({ type: 'Svg' })).some(c => text.test(String(c.props.alt)))
  await ui.unmount()
  return found
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the pane groups waiting, running and finished sessions`, async ($, on) => {
    await open($, on)
    const ui = await mount($, surface)
    expect(await ui.find({ text: /Wartet auf dich · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Läuft · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Fertig · 1/ })).toBeDefined()
  })

  test(`${surface}: a waiting row says what it waits for`, async ($, on) => {
    await open($, on)
    expect(await says($, surface, /Freigabe Bash/)).toBe(true)
  })

  test(`${surface}: a running row shows its task progress`, async ($, on) => {
    await open($, on)
    expect(await says($, surface, /2\/5/)).toBe(true)
    expect(await says($, surface, /\(diese\)/)).toBe(true)
  })

  test(`${surface}: finished sessions show only once unfolded`, async ($, on) => {
    await open($, on)
    expect(await says($, surface, /Fertige Session/)).toBe(false)
    const ui = await mount($, surface)
    await ui.press({ key: 'done-toggle' })
    await ui.unmount()
    expect(await says($, surface, /Fertige Session/)).toBe(true)
  })

  test(`${surface}: a very long title is clipped and still draws`, async ($, on) => {
    await open($, on, { 'session:long': entry({ id: 'long', title: 'L'.repeat(500), status: 'working' }) })
    expect(await says($, surface, /L{59}…/)).toBe(true)
    expect(await says($, surface, /L{61}/)).toBe(false)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pressing a session's open button jumps to it in the app`, async ($, on) => {
    await open($, on)
    const ui = await mount($, surface)
    await ui.press({ key: 'open-w' })
    await ui.unmount()
    expect(ran).toEqual([['open', 'claude://claude.ai/epitaxy/local_aaaa-1111']])
  })

  test(`${surface}: no open button for this session or one without a valid app id`, async ($, on) => {
    await open($, on, {
      ...three,
      'session:x': entry({ id: 'x', title: 'Fremd', status: 'working', hostId: 'local_x; rm -rf ~' }),
      'session:y': entry({ id: 'y', title: 'Terminal', status: 'working' }),
    })
    const ui = await mount($, surface)
    expect(await ui.find({ key: 'open-w' })).toBeDefined()
    expect(await ui.find({ key: 'open-r' })).toBeUndefined()
    expect(await ui.find({ key: 'open-x' })).toBeUndefined()
    expect(await ui.find({ key: 'open-y' })).toBeUndefined()
    await ui.unmount()
  })
}

test('desktop: tiles and one card per shown session, drawn as Svg', async ($, on) => {
  await open($, on)
  const ui = await mount($, 'desktop')
  const svgs = await ui.findAll({ type: 'Svg' })
  // header tiles + waiting card + running card; finished is folded
  expect(svgs.length).toBe(3)
  expect(String(svgs[0]?.props.alt)).toMatch(/Wartet 1, Läuft 1/)
  for (const s of svgs) expect(String(s.props.source)).toMatch(/^<svg /)
})

test('desktop: text in a card is escaped', async ($, on) => {
  await open($, on, { 'session:x': entry({ id: 'x', title: 'a <b> & "c"', status: 'working' }) })
  const ui = await mount($, 'desktop')
  const source = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('')
  expect(source).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
  expect(source).not.toContain('<b>')
})

test('terminal: no Svg is drawn', async ($, on) => {
  await open($, on)
  const ui = await mount($, 'terminal')
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
})

test('/radar opens the pane', async ($, on) => {
  const opened = await open($, on)
  expect(opened).toEqual([PANE])
})

test('desktop: status icons do not pulse', async ($, on) => {
  await open($, on)
  const ui = await mount($, 'desktop')
  const source = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('')
  expect(source).not.toMatch(/animation|class="live"/)
  await ui.unmount()
})
