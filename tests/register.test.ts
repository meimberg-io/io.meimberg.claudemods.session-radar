import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// What a tool call answers beneath the plugin; a test may swap it.
let toolAnswer: (e: { tool: string }) => Promise<unknown> = async () => ({ result: 'ok' })

async function start($: Engine, on: On, surface: 'desktop' | null = 'desktop') {
  toolAnswer = async () => ({ result: 'ok' })
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-16T12:00:00Z') })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('classic.PermissionRequest', async () => ({}) as never)
  on('session.id', async () => ({ value: 'sess-1' }) as never)
  on('session.cwd', async () => ({ value: '/repo' }) as never)
  on('session.surfaces', async () => ({ value: surface ? [surface] : [] }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
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
  expect(await dump($)).toMatch(/· working · - · - · 1\/2$/m)
})

test("a subagent's own todo list leaves the session's progress alone", async ($, on) => {
  await start($, on)
  await $.prompt.submit({ text: 'plan it' } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Mine', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'sub-1', todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] } as never)
  expect(await dump($)).toMatch(/ · 0\/1$/m)
})
