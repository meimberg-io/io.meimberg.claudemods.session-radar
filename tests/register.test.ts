import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// What a tool call answers beneath the plugin; a test may swap it.
let opened: string[] = []
let checkAnswer = 'allow'
let toolAnswer: (e: { tool: string }) => Promise<unknown> = async () => ({ result: 'ok' })

let sessionId = 'sess-1'
// The files the mod wrote, by path.
let files: Record<string, string> = {}

async function start($: Engine, on: On, surface: 'desktop' | null = 'desktop', stored: Record<string, unknown> = {}) {
  toolAnswer = async () => ({ result: 'ok' })
  checkAnswer = 'allow'
  opened = []
  sessionId = 'sess-1'
  files = {}
  on('fs.read', async (_$, e) => (files[e.path] !== undefined ? { value: files[e.path] } : { deny: 'missing' }) as never)
  on('fs.write', async (_$, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  mock.store(on, stored)
  mock.clock(on, { now: Date.parse('2026-10-16T12:00:00Z') })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('classic.PermissionRequest', async () => ({}) as never)
  on('session.id', async () => ({ value: sessionId }) as never)
  on('session.end', async () => ({ sessionId }) as never)
  on('classic.SessionStart', async () => ({}) as never)
  on('classic.UserPromptSubmit', async () => ({}) as never)
  on('classic.PostToolUse', async () => ({}) as never)
  on('ui.panes', async () => ({ value: [] }) as never)
  on('session.attach', async (_$, e) => ({ clientId: e.clientId }) as never)
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  mock.env(on, surface ? { CLAUDE_CODE_HOST_SESSION_ID: 'local_c400d3fe-ac97', HOME: '/home/t' } : { HOME: '/home/t' })
  on('session.cwd', async () => ({ value: '/repo' }) as never)
  on('session.surfaces', async () => ({ value: surface ? [surface] : [] }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', async (_$, e) => (await toolAnswer(e)) as never)
  on('tool.check', async () => ({ decision: checkAnswer }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface, isInteractive: surface !== null } as never)
}

async function dump($: Engine): Promise<string> {
  const ran = (await $.command.run({ command: 'radar', args: 'dump' } as never)) as { text?: string }
  return ran.text ?? ''
}

const turnEnd = { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as never

test('a started desktop session reports idle', async ($, on) => {
  await start($, on)
  expect(await dump($)).toMatch(/^sess-1 · idle/m)
})

test('a session without a surface reports nothing', async ($, on) => {
  await start($, on, null)
  expect(await dump($)).not.toMatch(/· (idle|working|waiting)/)
})

test('a next-step question is still waiting after the turn ends', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'do it' } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done so far', ask: 'Freigabe?' } as never)
  await $.turn.complete(turnEnd)
  expect(await dump($)).toMatch(/· waiting · nextstep/)
})

test('an open question is waiting while it is open and working after', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'ask me' } as never)
  let during = ''
  toolAnswer = async () => {
    during = await dump($)
    return { result: 'answered' }
  }
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(during).toMatch(/· waiting · question/)
  expect(await dump($)).toMatch(/· working/)
})

test("a subagent's permission prompt makes the session wait", async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'go' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'sub-1' } as never)
  expect(await dump($)).toMatch(/· waiting · permission · Bash/)
})

test('the task list of the session shows as done/total', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'plan it' } as never)
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'pending' },
    ],
  } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  expect(await dump($)).toMatch(/· working · - · - · 1\/2 —/m)
})

test("a subagent's own todo list leaves the session's progress alone", async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'plan it' } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Mine', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'sub-1', todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] } as never)
  expect(await dump($)).toMatch(/ · 0\/1 —/m)
})

test('after /clear the session reports again under its new id', async ($, on) => {
  await start($, on)
  await $.session.end({ reason: 'clear' } as never)
  sessionId = 'sess-2'
  await $.classic.SessionStart({ source: 'clear' } as never)
  await $.prompt.submit({ text: 'weiter' } as never)
  const out = await dump($)
  expect(out).toMatch(/^sess-2 · working/m)
  expect(out).not.toMatch(/sess-1/)
})

test('another loop finishing a tool leaves an open permission waiting', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'go' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'sub-1' } as never)
  await $.tool.call({ tool: 'Read', agentId: 'sub-2', file_path: '/x' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/y' } as never)
  expect(await dump($)).toMatch(/· waiting · permission · Bash/)
  await $.tool.call({ tool: 'Bash', agentId: 'sub-1', command: 'ls' } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('a meta prompt does not answer a next-step question', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'do it' } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'x', ask: 'Weiter?' } as never)
  await $.turn.complete(turnEnd)
  await $.prompt.submit({ text: 'task finished', isMeta: true } as never)
  expect(await dump($)).toMatch(/· waiting · nextstep/)
})

test('a reload keeps what the session reported before', async ($, on) => {
  const before = { v: 1, id: 'sess-1', title: 'repo: x', cwd: '/repo', status: 'waiting', waitReason: 'nextstep', isSticky: true, waitingSince: 1, startedAt: 1, updatedAt: 1, heartbeat: Date.parse('2026-10-16T11:59:00Z'), tasks: { done: 2, total: 4, current: 'b' } }
  await start($, on, 'desktop', { 'session:sess-1': before })
  expect(await dump($)).toMatch(/^sess-1 · waiting · nextstep · - · 2\/4 —/m)
})

test('a question shows as a question, not as a permission for it', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'ask me' } as never)
  let during = ''
  toolAnswer = async () => {
    await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: {} } as never)
    during = await dump($)
    return { result: 'answered' }
  }
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(during).toMatch(/· waiting · question · -/)
})

test('a turn started without prompt.submit still names the session', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'Recherchiere zu anthropic', turnId: 't1' } as never)
  expect(await dump($)).toMatch(/— repo: Recherchiere zu anthropic( \[|$)/m)
})

test('a respawned worker without a surface keeps reporting a session it reported before', async ($, on) => {
  const before = { v: 1, id: 'sess-1', title: 'repo: x', cwd: '/repo', status: 'idle', startedAt: 1, updatedAt: 1, heartbeat: Date.parse('2026-10-16T11:59:00Z') }
  await start($, on, null, { 'session:sess-1': before })
  await $.prompt.submit({ text: 'weiter' } as never)
  expect(await dump($)).toMatch(/^sess-1 · working/m)
})

test('a tool the engine will ask about makes the session wait until it ran', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'ls ~' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: { command: 'ls ~' } } as never)
  expect(await dump($)).toMatch(/· waiting · permission · Bash/)
  await $.tool.call({ tool: 'Bash', command: 'ls ~' } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('an ask seen twice, by check and by the permission hook, ends with one run', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'ls ~' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: {} } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls ~' } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('an allowed tool does not wait', async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'read' } as never)
  await $.tool.check({ tool: 'Read', input: {} } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('a desktop session reports its app id', async ($, on) => {
  await start($, on)
  expect(await dump($)).toMatch(/\[local_c400d3fe-ac97\]$/m)
})

test('the pane opens by itself in an interactive session', async ($, on) => {
  await start($, on)
  expect(opened).toEqual(['session-radar'])
})

test('the pane stays closed in a session without a surface', async ($, on) => {
  await start($, on, null)
  expect(opened).toEqual([])
})

test('the desktop attaching later starts reporting and opens the pane', async ($, on) => {
  await start($, on, null)
  expect(opened).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'c1' } as never)
  expect(await dump($)).toMatch(/^sess-1 · idle/m)
  expect(opened).toEqual(['session-radar'])
})

test('a second client attaching does not open the pane again', async ($, on) => {
  await start($, on)
  await $.session.attach({ surface: 'mobile', clientId: 'c2' } as never)
  expect(opened).toEqual(['session-radar'])
})

test('a respawn of a session that reported before does not reopen a closed pane', async ($, on) => {
  const before = { v: 1, id: 'sess-1', title: 'repo: x', cwd: '/repo', status: 'idle', startedAt: 1, updatedAt: 1, heartbeat: Date.parse('2026-10-16T11:59:00Z') }
  await start($, on, 'desktop', { 'session:sess-1': before })
  expect(opened).toEqual([])
})

test('in auto mode an ask is settled by the classifier, nobody waits', async ($, on) => {
  await start($, on)
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'auto' } as never)
  await $.prompt.submit({ text: 'run tests' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: {} } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('switching back to default mode makes an ask wait again', async ($, on) => {
  await start($, on)
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'auto' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'x', permission_mode: 'default' } as never)
  await $.prompt.submit({ text: 'x' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: {} } as never)
  expect(await dump($)).toMatch(/· waiting · permission · Bash/)
})

test('bypass mode never waits on an ask', async ($, on) => {
  await start($, on)
  await $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't', permission_mode: 'bypassPermissions' } as never)
  await $.prompt.submit({ text: 'x' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: {} } as never)
  expect(await dump($)).toMatch(/· working/)
})

test('a turn opened by a system notice gives no title, the next real prompt does', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: '<task-notification>\n<task-id>x</task-id>', turnId: 't1' } as never)
  expect(await dump($)).toMatch(/— +\[local/m)
  await $.turn.start({ text: 'Echte Frage', turnId: 't2' } as never)
  expect(await dump($)).toMatch(/— repo: Echte Frage \[/m)
})

test('a slash command names the session by the command', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: '<command-message>meimberg-io-leafcutter:resolve-issue</command-message>\n<command-name>/x</command-name>', turnId: 't1' } as never)
  expect(await dump($)).toMatch(/— repo: \/meimberg-io-leafcutter:resolve-issue \[/m)
})

const LOG = '/home/t/.claude/session-radar-log'

function logOf(path: string): Record<string, unknown>[] {
  return (files[path] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}

test('the measuring log records what decides the status', async ($, on) => {
  await start($, on)
  await $.classic.SessionStart({ source: 'startup', permission_mode: 'default' } as never)
  await $.prompt.submit({ text: 'ls ~' } as never)
  checkAnswer = 'ask'
  await $.tool.check({ tool: 'Bash', input: {} } as never)
  await dump($)
  const log = logOf(`${LOG}/sess-1.jsonl`)
  const kinds = log.map(l => l.k)
  for (const k of ['session.start', 'classic.SessionStart', 'prompt.submit', 'tool.check', 'status']) expect(kinds).toContain(k)
  expect(log.find(l => l.k === 'tool.check')).toMatchObject({ tool: 'Bash', decision: 'ask', mode: 'default' })
  expect(log.find(l => l.k === 'status' && l.to === 'waiting')).toMatchObject({ from: 'working', reason: 'permission' })
  expect(typeof log[0]?.t).toBe('string')
})

test('a tool call is logged when it starts and when it ends', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: 'Read', file_path: '/x', tool_use_id: 'u1' } as never)
  await dump($)
  const calls = logOf(`${LOG}/sess-1.jsonl`).filter(l => l.k === 'tool.call')
  expect(calls.map(l => l.phase)).toEqual(['start', 'end'])
  expect(calls[1]).toMatchObject({ tool: 'Read' })
  expect(typeof calls[1]?.ms).toBe('number')
})

test('/radar mark writes the note with a snapshot of every session', async ($, on) => {
  await start($, on)
  const ran = (await $.command.run({ command: 'radar', args: 'mark falsch orange' } as never)) as { text?: string }
  expect(ran.text).toMatch(/Markiert/)
  const [mark] = logOf(`${LOG}/marks.jsonl`)
  expect(mark).toMatchObject({ note: 'falsch orange', by: 'sess-1' })
  expect((mark?.entries as { id: string }[]).map(e => e.id)).toContain('sess-1')
})
