import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Entry, Signal } from '../types'
import { HOST_ID, KEY_PREFIX, isEntry, pruneOld, readEntries, removeEntry, writeEntry } from './channel'
import type { StoreLike } from './channel'
import { PANE, PANE_TITLE, paneTree } from './pane'
import { createLog } from './log'
import type { FsLike, Log } from './log'
import { applySignal } from './status'
import { applyTaskCall, summarize } from './tasks'
import type { TaskList } from './tasks'

const roster = atom({ plugin: 'session-radar', key: 'roster' } as const, [])
const selfId = atom({ plugin: 'session-radar', key: 'selfId' } as const, '')
const isDoneOpen = atom({ plugin: 'session-radar', key: 'isDoneOpen' } as const, false)

const HEARTBEAT_MS = 30_000
const POLL_MS = 3_000
const WAIT_TOOLS: Record<string, 'question' | 'plan'> = { AskUserQuestion: 'question', ExitPlanMode: 'plan' }
const WRAP_UP = 'mcp__ccd_turn__wrap_up'

// This session's own entry; undefined while it reports nothing (no surface yet).
let me: Entry | undefined
let titleFromHost: string | undefined
let beat: Timer | undefined
let taskList: TaskList | undefined
let poll: Timer | undefined
// The session's permission mode as the classic hook events last carried it.
let mode: string | undefined
// Modes where an 'ask' puts a dialog in front of the person; in auto a
// classifier settles it, in bypassPermissions and dontAsk nobody is asked.
const ASKING_MODES = new Set(['default', 'acceptEdits', 'plan'])
// Remembered across a /clear, which ends the session without a session.start.
let reportsFrom: string | undefined

// The measuring log: what each session saw, one file per session id, plus
// the marks the person sets with /radar mark.
let logger: Log | undefined
let logDir = ''
let logId = ''

function fsOf($: EngineInterface): FsLike {
  return { read: path => $.fs.read(path) as Promise<string>, write: (path, text) => $.fs.write(path, text) }
}

function note(k: string, fields: Record<string, unknown> = {}): void {
  if (logger && logDir && logId) logger.add(`${logDir}/${logId}.jsonl`, { t: new Date().toISOString(), k, ...fields })
}

function short(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
}

// The engine wants $ spelled out at each call, so the channel gets $.store this way.
export function storeOf($: EngineInterface): StoreLike {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

async function save($: EngineInterface): Promise<void> {
  if (me) await writeEntry(storeOf($), me)
}

// Applies a signal and, with `loops`, changes which loops hold a wait open.
// The time is read first, so no await sits between reading `me` and writing it.
async function emit($: EngineInterface, signal: Signal, loops?: (open: string[]) => string[]): Promise<void> {
  const now = await $.clock.now()
  if (!me) return
  const open = loops ? loops(me.waitLoops ?? []) : me.waitLoops ?? []
  const before = me
  const next = applySignal(me, signal, now)
  me = { ...next, waitLoops: next.status === 'waiting' ? open : [] }
  if (before.status !== me.status || before.waitReason !== me.waitReason) {
    note('status', { from: before.status, to: me.status, reason: me.waitReason, tool: me.waitTool, by: signal.kind, loops: me.waitLoops })
  }
  await save($)
}

function loopOf(agentId: string | undefined): string {
  return agentId ?? ''
}

async function openWait($: EngineInterface, loop: string, reason: 'permission' | 'question' | 'plan', tool?: string): Promise<void> {
  // One loop asks one thing at a time: the check and the permission hook may both report it.
  await emit($, { kind: 'waitStart', reason, tool }, open => (open.includes(loop) ? open : [...open, loop]))
}

// A tool call of `loop` resolved: the wait it held is over; the session goes
// back to working once no loop holds one.
async function closeWait($: EngineInterface, loop: string): Promise<void> {
  if (!me || me.status !== 'waiting') return
  const open = me.waitLoops ?? []
  const at = open.indexOf(loop)
  if (at < 0) return
  const rest = [...open.slice(0, at), ...open.slice(at + 1)]
  if (rest.length > 0) {
    me = { ...me, waitLoops: rest }
    await save($)
    return
  }
  await emit($, { kind: 'waitEnd' }, () => [])
}

async function isInteractive($: EngineInterface, surface: unknown): Promise<boolean> {
  if (surface !== null && surface !== undefined) return true
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return false
  }
}

// Starts reporting; after a reload it picks up the entry the session left.
async function begin($: EngineInterface, cwd: string): Promise<void> {
  if (me) return
  const now = await $.clock.now()
  const id = await $.session.id()
  const left = await $.store.get(KEY_PREFIX + id)
  const host = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const hostId = host && HOST_ID.test(host) ? host : undefined
  if (me) return
  me = isEntry(left)
    ? { ...left, cwd, heartbeat: now, hostId }
    : { v: 1, id, title: titleFromHost ?? '', cwd, status: 'idle', startedAt: now, updatedAt: now, heartbeat: now, hostId }
  reportsFrom = cwd
  // After /clear the session goes on under a new id, and so does its log.
  logId = me.id
  await pruneOld(storeOf($), now)
  await save($)
  // A new session opens the pane, whichever way it starts reporting (start,
  // a late attach, /clear); a respawn or reload leaves a closed pane closed.
  if (!isEntry(left)) {
    try {
      await refresh($)
      await $.ui.open({ id: PANE, title: PANE_TITLE })
      startPolling($)
    } catch {}
  }
  beat?.cancel()
  beat = $.clock.every(HEARTBEAT_MS, () => {
    void (async () => {
      const at = await $.clock.now()
      if (!me) return
      me = { ...me, heartbeat: at }
      await save($)
    })().catch(() => {})
  })
}

async function refresh($: EngineInterface): Promise<void> {
  const entries = await readEntries(storeOf($))
  await update($, roster, () => entries)
}

function stopPolling(): void {
  poll?.cancel()
  poll = undefined
}

// Reads the others every few seconds while the pane is up, and stops once it is gone.
function startPolling($: EngineInterface): void {
  if (poll) return
  poll = $.clock.every(POLL_MS, () => {
    void (async () => {
      const isUp = (await $.ui.panes()).some(p => p.id === PANE)
      if (!isUp) return stopPolling()
      await refresh($)
    })().catch(() => {})
  })
}

function dumpLine(e: Entry): string {
  const tasks = e.tasks ? [`${e.tasks.done}/${e.tasks.total}`] : []
  return [e.id, e.status, e.waitReason ?? '-', e.waitTool ?? '-', ...tasks].join(' · ') + ` — ${e.title}` + (e.hostId ? ` [${e.hostId}]` : '')
}

// What a turn's text names: a slash command by its name, a system notice
// (<task-notification>, <system-reminder>, ...) nothing.
export function nameOf(text: string): string {
  const t = text.trim()
  const command = /^<command-message>([^<]+)<\/command-message>/.exec(t)
  if (command) return `/${command[1]!.trim()}`
  if (t.startsWith('<')) return ''
  return t.slice(0, 40)
}

// The fallback title, from the first prompt that names something, once.
function nameFrom(text: string): void {
  const name = nameOf(text)
  if (me && !me.title && name !== '') me = { ...me, title: `${basename(me.cwd)}: ${name}` }
}

function noteMode(e: { permission_mode?: string }): void {
  if (typeof e.permission_mode === 'string' && e.permission_mode !== mode) {
    note('mode', { from: mode, to: e.permission_mode })
    mode = e.permission_mode
  }
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'radar', description: 'Open the Session Radar pane' })
    const id = await $.session.id()
    await update($, selfId, () => id)
    logDir = `${(await $.env.get('HOME')) ?? ''}/.claude/session-radar-log`
    logId = id
    logger = createLog(fsOf($))
    note('session.start', { source: (e as { source?: unknown }).source, surface: e.surface, isInteractive: e.isInteractive, host: await $.env.get('CLAUDE_CODE_HOST_SESSION_ID') })
    // A respawned worker or a reload may start without a surface; an entry this
    // session left says it was interactive.
    const left = await $.store.get(KEY_PREFIX + id)
    if (isEntry(left) || (await isInteractive($, e.surface))) await begin($, e.cwd)
    // A reload stops the poll; a pane still up keeps refreshing.
    try {
      if ((await $.ui.panes()).some(p => p.id === PANE)) {
        await refresh($)
        startPolling($)
      }
    } catch {}
    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    note('session.attach', { surface: e.surface })
    await begin($, await $.session.cwd())
    return attached
  })

  on('classic.SessionStart', async ($, e, next) => {
    note('classic.SessionStart', { source: e.source, mode: e.permission_mode, title: e.session_title })
    noteMode(e)
    // /clear ends the session and starts a new one without session.start.
    if (!me && reportsFrom !== undefined && (e.source === 'clear' || e.source === 'resume')) {
      await begin($, reportsFrom)
      const id = await $.session.id()
      await update($, selfId, () => id)
    }
    if (e.session_title) {
      titleFromHost = e.session_title
      if (me) {
        me = { ...me, title: e.session_title }
        await save($)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'radar' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'mark' || args.startsWith('mark ')) {
      const text = args.slice(4).trim()
      const entries = await readEntries(storeOf($))
      logger?.add(`${logDir}/marks.jsonl`, { t: new Date().toISOString(), note: text, by: logId, mode, entries })
      await logger?.idle()
      return { text: `Markiert${text ? `: ${text}` : ''}. Logs: ${logDir}` }
    }
    if (args === 'dump') {
      await logger?.idle()
      const list = await readEntries(storeOf($))
      return { text: list.length === 0 ? 'Keine Sessions gemeldet.' : list.map(dumpLine).join('\n') }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    startPolling($)
    return { text: 'Session Radar geöffnet.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stopPolling()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'session-radar' }, async ($, e) =>
    paneTree($.ui.resolve(e), {
      entries: await read($, roster),
      now: await $.clock.now(),
      self: await read($, selfId),
      isOpen: await read($, isDoneOpen),
      onToggleDone: () => void update($, isDoneOpen, open => !open),
      onOpen: hostId => void $.process.run(['open', `claude://claude.ai/epitaxy/${hostId}`]).catch(() => {}),
      surface: e.surface,
      columns: e.props.bodyColumns,
    }),
  )

  on('prompt.submit', async ($, e, next) => {
    // Notices, delivery receipts and slash commands are not the person answering.
    // Older engines lack these fields: read them loosely.
    const meta = e as { isMeta?: unknown; command?: unknown }
    note('prompt.submit', { isMeta: meta.isMeta, command: meta.command, text: short(e.text) })
    if (meta.isMeta || meta.command) return next(e)
    nameFrom(e.text)
    await emit($, { kind: 'prompt' })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // The desktop app may start a turn without a prompt.submit the mod sees.
    note('turn.start', { text: short(e.text) })
    nameFrom(e.text)
    await emit($, { kind: 'turnStart' })
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    // A question or plan asks through this dialog too; its tool.call already says so.
    note('classic.PermissionRequest', { tool: e.tool_name, agent: e.agent_id, mode: e.permission_mode })
    if (!WAIT_TOOLS[e.tool_name]) await openWait($, loopOf(e.agent_id), 'permission', e.tool_name)
    return next(e)
  })

  // The desktop app asks through its own dialog, past classic.PermissionRequest:
  // the engine's 'ask' verdict is the signal that reaches every surface.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const asksPerson = mode === undefined || ASKING_MODES.has(mode)
    note('tool.check', { tool: e.tool, agent: (e as { agentId?: string }).agentId, id: e.tool_use_id, decision: verdict.decision, mode })
    if (verdict.decision === 'ask' && asksPerson && !WAIT_TOOLS[e.tool]) await openWait($, loopOf((e as { agentId?: string }).agentId), 'permission', e.tool)
    return verdict
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteMode(e)
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    noteMode(e)
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    note('classic.Notification', { type: e.notification_type, message: short(e.message), mode: e.permission_mode })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const reason = WAIT_TOOLS[e.tool]
    const loop = loopOf(e.agentId)
    const input = e as unknown as { ask?: unknown; blocked?: unknown }
    const startedAt = Date.now()
    note('tool.call', { phase: 'start', tool: e.tool, agent: e.agentId, id: e.tool_use_id, ...(e.tool === WRAP_UP ? { ask: short(input.ask), blocked: input.blocked } : {}) })
    const ended = () => note('tool.call', { phase: 'end', tool: e.tool, agent: e.agentId, id: e.tool_use_id, ms: Date.now() - startedAt })
    if (reason) {
      await openWait($, loop, reason)
      try {
        return await next(e)
      } finally {
        ended()
        await closeWait($, loop)
      }
    }

    const ran = await next(e)
    ended()
    const list = e.agentId === undefined ? applyTaskCall(taskList, e.tool, e) : taskList
    if (list !== taskList && list && me) {
      taskList = list
      me = { ...me, tasks: summarize(list) }
      await save($)
    }
    if (e.tool === WRAP_UP) {
      const asks = (typeof input.ask === 'string' && input.ask.trim() !== '') || input.blocked === true
      if (asks) await emit($, { kind: 'nextStepAsk' })
    } else {
      await closeWait($, loop)
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    note('turn.complete', { agent: e.agentId, isAborted: e.isAborted })
    if (e.agentId === undefined && me) {
      await emit($, { kind: 'turnEnd' })
      try {
        const usage = await $.session.usage()
        const model = await $.session.model()
        if (!me) return done
        me = {
          ...me,
          model,
          contextPercent: usage.context.percent,
          costUsd: usage.cost?.usd,
          startedAt: usage.startedAt,
        }
        await save($)
      } catch {}
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    note('session.end', { reason: e.reason })
    beat?.cancel()
    stopPolling()
    beat = undefined
    if (me) await removeEntry(storeOf($), me.id)
    me = undefined
    taskList = undefined
    return next(e)
  })
}
