import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// What a tool call answers beneath the plugin; a test may swap it.
let toolAnswer: (e: { tool: string }) => Promise<unknown> = async () => ({ result: 'ok' })

let sessionId = 'sess-1'

async function start($: Engine, on: On, surface: 'desktop' | null = 'desktop', stored: Record<string, unknown> = {}) {
  toolAnswer = async () => ({ result: 'ok' })
  sessionId = 'sess-1'
  mock.store(on, stored)
  mock.clock(on, { now: Date.parse('2026-10-16T12:00:00Z') })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('classic.PermissionRequest', async () => ({}) as never)
  on('session.id', async () => ({ value: sessionId }) as never)
  on('session.end', async () => ({ sessionId }) as never)
  on('classic.SessionStart', async () => ({}) as never)
  on('ui.panes', async () => ({ value: [] }) as never)
  on('session.cwd', async () => ({ value: '/repo' }) as never)
  on('session.surfaces', async () => ({ value: surface ? [surface] : [] }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', async (_$, e) => (await toolAnswer(e)) as never)
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
  expect(await dump($)).toMatch(/— repo: Recherchiere zu anthropic$/m)
})
