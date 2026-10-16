# Session Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Claude-Code-Mod, der rechts ein Panel mit allen interaktiven
Sessions des Macs zeigt, gruppiert in „Wartet auf dich“, „Läuft“, „Fertig“.

**Architecture:** Jede Session meldet ihren eigenen Eintrag unter
`session:<id>` in den gemeinsamen Speicher (`$.store`, hinter einer kleinen
Schnittstelle austauschbar gegen eine Datei pro Session). Das Pane liest alle
Einträge per Polling, solange es offen ist. Zustandslogik (Status, Gruppen,
Aufgaben-Fortschritt) liegt in reinen Funktionen ohne `$`, das Modul
`register.tsx` verdrahtet nur Ereignisse, Speicher und Zeichnen.

**Tech Stack:** Claude Code Function Hooks (Early Access, getestet 2.1.299),
TypeScript/TSX, `claude plugin validate`, `claude plugin test`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-10-16-session-radar-design.md`

Vorbilder zum Nachlesen:
- Spike: `~/.claude/dev-mods/f8d844fd-a1ad-4ac1-8b52-8ffa870f0885/session-radar-spike/hooks/register.tsx`
- savvy-progress (Pane-Look, Tests): `https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress`
- API-Typen: werden nach dem ersten Laden nach `.claude-plugin/types/` gelegt;
  vorher über das `plugin-authoring`-Skill (`types/claude-code.d.ts`).

## Global Constraints

- Mod-Name `session-radar`, Slash-Befehl `/radar`, Pane-ID `session-radar`, Pane-Titel `Session Radar`.
- Speicher-Schlüssel `session:<sessionId>`; nur der eigene Schlüssel wird geschrieben.
- Heartbeat alle 30 s; Polling des Panes alle 3 s und nur, solange das Pane offen ist.
- Sichtbarkeit: `working`/`idle` ohne Heartbeat seit 2 min ausgeblendet; `waiting` ohne Heartbeat ab 2 min ausgegraut mit „keine Rückmeldung seit …“, ab 30 min ausgeblendet.
- Beim Session-Start Einträge löschen, deren `heartbeat` älter als 24 h ist.
- Nur Sessions mit mindestens einer Oberfläche (`(await $.session.surfaces()).length > 0`) melden sich.
- Panel öffnet nicht von selbst (`autoOpen` ist nicht Teil von v1).
- Keine Krabben, kein Ton, keine Systembenachrichtigung, kein Klick-zum-Springen.
- Kosten und Kontext kommen aus `$.session.usage()` (`cost?.usd`, `context.percent`), keine eigene Preistabelle.
- Gruppenreihenfolge: Wartet (längste Wartezeit oben), Läuft (zuletzt aktualisiert oben), Fertig (eingeklappt, neuestes Turn-Ende oben).
- Glyphen/Farben: wartet `◆` `#e8a33d`, läuft `●` `#8f8cf4`, fertig `✓` `#5fbf8f` (aus Spike/savvy-progress).
- UI-Texte deutsch: „Wartet auf dich“, „Läuft“, „Fertig“, „diese“, „Freigabe <Tool>“, „Rückfrage“, „Plan zur Freigabe“, „Frage im Next step“, „keine Rückmeldung seit <n> min“.

## Review Focus

1. Freigabe-Dialog in einem **Subagenten** (`e.agentId` gesetzt): die Session wartet trotzdem auf Oli → muss `waiting` werden. Test in Task 1.
2. Abgebrochener Turn (Esc) während `waiting`: `turn.abort`/`turn.complete` muss auf `idle` gehen, außer bei klebrigem Next-step-Warten. Test in Task 1.
3. Zwei Sessions mit gleichem Ordner und gleichem ersten Prompt: Zeilen dürfen nicht verschmelzen (Schlüssel ist die ID, nicht der Titel). Test in Task 2.
4. Kaputter oder fremder Eintrag im Speicher (alte Spike-Form, `null`, fehlende Felder): Pane zeichnet trotzdem, Eintrag wird übersprungen. Test in Task 3.
5. Sehr lange Titel und Schritt-Notizen: werden gekürzt, Layout bricht nicht. Test in Task 6.

---

## Dateien

```
.claude-plugin/plugin.json      Manifest (name, version, description, author, types)
hooks/hooks.json                { "modules": ["./register.tsx"] }
hooks/status.ts                 reine Zustandslogik: Signal → Entry
hooks/roster.ts                 reine Sicht-Logik: Einträge → Gruppen
hooks/tasks.ts                  reine Logik: Aufgabenlisten-Aufrufe → Fortschritt
hooks/channel.ts                Speicherzugriff (lesen, schreiben, aufräumen)
hooks/pane.tsx                  Zeichnen des Panes
hooks/register.tsx              Verdrahtung: Ereignisse, Timer, Befehl
types/index.d.ts                Typen + PluginState-Vertrag
tests/*.test.ts(x)              claude plugin test
README.md                       Installation, Grenzen
```

Gemeinsame Typen (in `types/index.d.ts`, Task 1):

```ts
export type Status = 'waiting' | 'working' | 'idle'
export type WaitReason = 'permission' | 'question' | 'plan' | 'nextstep'
export type Tasks = { done: number; total: number; current: string }
export type Entry = {
  v: 1
  id: string
  title: string
  cwd: string
  status: Status
  waitReason?: WaitReason
  waitTool?: string          // bei permission: Tool-Name
  waitingSince?: number
  isSticky?: boolean         // nextstep: überlebt turn.complete
  tasks?: Tasks
  model?: string
  contextPercent?: number
  costUsd?: number
  startedAt: number
  updatedAt: number
  lastTurnEndedAt?: number
  heartbeat: number
}
export type Signal =
  | { kind: 'prompt' }
  | { kind: 'turnStart' }
  | { kind: 'turnEnd' }                       // turn.complete / turn.abort des Haupt-Loops
  | { kind: 'waitStart'; reason: Exclude<WaitReason, 'nextstep'>; tool?: string }
  | { kind: 'waitEnd' }                       // Freigabe/Frage/Plan beantwortet
  | { kind: 'nextStepAsk' }                   // wrap_up mit ask oder blocked
```

---

### Task 1: Gerüst und Zustandslogik

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts`, `hooks/status.ts`, `hooks/register.tsx` (leeres `register`), `tsconfig.json`
- Test: `tests/status.test.ts`

**Interfaces:**
- Produces: `applySignal(entry: Entry, signal: Signal, now: number): Entry`, alle Typen oben.

- [ ] **Step 1: Gerüst anlegen.** `plugin.json` mit `name: "session-radar"`, `version: "0.1.0"`, `author: { "name": "Oliver Meimberg" }`, `"types": "./types/index.d.ts"`. `tsconfig.json` nach Vorlage aus dem Kopf von `claude-code.d.ts` (include `.claude-plugin/types`, `hooks`, `types`, `tests`). `types/index.d.ts` deklariert zusätzlich `interface PluginState { 'session-radar': { roster: Entry[]; selfId: string; isDoneOpen: boolean } }`.

- [ ] **Step 2: Failing tests schreiben** (`tests/status.test.ts`, reine Funktion, `test`/`expect` aus `claude-code/testing`):
  - `prompt from idle → working`, `waitReason` gelöscht.
  - `waitStart permission tool=Bash → waiting, waitReason 'permission', waitTool 'Bash', waitingSince = now`.
  - `waitEnd after permission → working`, `waitReason` undefined.
  - `waitStart question` und `waitStart plan` → `waiting` mit passendem Grund.
  - `nextStepAsk then turnEnd → bleibt waiting, waitReason 'nextstep', isSticky true`.
  - `sticky nextstep then prompt → working, isSticky false`.
  - `waiting permission then turnEnd (Esc) → idle` (Review Focus 2).
  - `turnEnd → idle, lastTurnEndedAt = now`.
  - zweites `waitStart` während `waiting` behält das erste `waitingSince`.
  - jede Funktion setzt `updatedAt = now` und gibt ein neues Objekt zurück.

- [ ] **Step 3: Run** `claude plugin test .` — Expected: FAIL (`applySignal` fehlt).

- [ ] **Step 4: `applySignal` in `hooks/status.ts` implementieren.** Reiner Switch über `signal.kind`, keine Seiteneffekte.

- [ ] **Step 5: Run** `claude plugin test .` und `claude plugin validate .` und `npx -y -p typescript@5.6.3 tsc -p .` — Expected: PASS, Validierung ohne Fehler.

- [ ] **Step 6: Commit** `feat: scaffold session-radar and status reducer`

### Task 2: Gruppen und Sichtbarkeit

**Files:**
- Create: `hooks/roster.ts`
- Test: `tests/roster.test.ts`

**Interfaces:**
- Consumes: `Entry`.
- Produces: `groupRoster(entries: readonly Entry[], now: number): { waiting: Row[]; working: Row[]; idle: Row[] }` mit `type Row = Entry & { isStale: boolean }` (Typ in `roster.ts` exportiert).

- [ ] **Step 1: Failing tests:**
  - `working` mit `heartbeat = now - 119_000` sichtbar, mit `now - 121_000` fehlt.
  - `waiting` mit `heartbeat = now - 5 * 60_000` sichtbar und `isStale: true`; mit `now - 31 * 60_000` fehlt.
  - Wartende sortiert nach `waitingSince` aufsteigend; Laufende nach `updatedAt` absteigend; Fertige nach `lastTurnEndedAt` absteigend.
  - zwei Einträge mit gleichem `title` und `cwd`, verschiedenen `id` → zwei Zeilen (Review Focus 3).

- [ ] **Step 2: Run** `claude plugin test .` — Expected: FAIL.

- [ ] **Step 3: `groupRoster` implementieren** (Konstanten `STALE_MS = 120_000`, `WAIT_DROP_MS = 1_800_000` exportiert).

- [ ] **Step 4: Run** `claude plugin test .` — Expected: PASS.

- [ ] **Step 5: Commit** `feat: group and age session entries`

### Task 3: Speicherkanal

**Files:**
- Create: `hooks/channel.ts`
- Test: `tests/channel.test.ts`

**Interfaces:**
- Consumes: `Entry`.
- Produces: `writeEntry($: EngineInterface, entry: Entry): Promise<void>`, `readEntries($: EngineInterface): Promise<Entry[]>`, `removeEntry($: EngineInterface, id: string): Promise<void>`, `pruneOld($: EngineInterface, now: number): Promise<number>` (gelöschte Anzahl), `KEY_PREFIX = 'session:'`.

- [ ] **Step 1: Failing tests** (mit `mock.store(on, …)` aus `claude-code/testing`):
  - `writeEntry` dann `readEntries` liefert den Eintrag.
  - `readEntries` überspringt `null`, Strings, Objekte ohne `v: 1` oder ohne `id`/`status`, und Schlüssel ohne Präfix (z. B. Spike-`s:x`) (Review Focus 4).
  - `pruneOld` löscht Einträge mit `heartbeat < now - 86_400_000`, lässt jüngere stehen.
  - `removeEntry` entfernt nur den eigenen Schlüssel.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implementieren** über `$.store.get/set/delete/keys`. Validierung beim Lesen als kleiner Typwächter `isEntry(x: unknown): x is Entry`.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `feat: store channel for session entries`

### Task 4: Melder verdrahten und Wartezustand live beweisen

**Files:**
- Modify: `hooks/register.tsx`
- Test: `tests/register.test.ts`

**Interfaces:**
- Consumes: `applySignal`, `writeEntry`, `removeEntry`, `pruneOld`.
- Produces: im Modul `async function emit($, signal: Signal): Promise<void>` (wendet an, schreibt), modulweite Variable `me: Entry | undefined`.

Ereignis-Zuordnung (exakt so):

| Ereignis | Signal |
| --- | --- |
| `session.start` (nach `next`) | Eintrag anlegen (`status: 'idle'`), `pruneOld`, Heartbeat-Timer 30 s starten; nur wenn `surfaces().length > 0`, sonst gar nichts tun |
| `session.attach` | wenn noch kein `me`: wie `session.start` |
| `classic.SessionStart` | `title = e.session_title` falls gesetzt |
| `prompt.submit` | `prompt`; Ersatz-Titel `${basename(cwd)}: ${text.slice(0, 40)}`, falls noch kein Titel |
| `turn.start` (Haupt-Loop) | `turnStart` |
| `classic.PermissionRequest` (jeder Loop, auch Subagent) | `waitStart permission`, `tool = e.tool_name` |
| `tool.call` `AskUserQuestion` / `ExitPlanMode` (jeder Loop) | vor `next`: `waitStart question` bzw. `plan`; nach `next`: `waitEnd` |
| `tool.call` beliebig, nach `next`, wenn `me.status === 'waiting'` und nicht sticky | `waitEnd` |
| `tool.call` `mcp__ccd_turn__wrap_up` mit `ask` (nicht leer) oder `blocked === true` | `nextStepAsk` |
| `turn.complete` / `turn.abort` ohne `agentId` | `turnEnd`; danach `usage` lesen: `model`, `contextPercent`, `costUsd`, `startedAt` |
| `session.end` | `removeEntry` |

- [ ] **Step 1: Failing tests** (`$.session.start({ …, surface: 'desktop', isInteractive: true })`, `mock.store`, `mock.clock`):
  - Nach Start liegt `session:<id>` mit `status 'idle'` im Store.
  - Start ohne Oberfläche (`surface` weggelassen) schreibt nichts.
  - `$.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'x', ask: 'Freigabe?' })`, danach Turn-Ende → Eintrag `waiting`/`nextstep`.
  - `tool.call` `AskUserQuestion` mit einem Hook, der `next` erst nach einem Store-Blick auflöst: während des Aufrufs steht `waiting`/`question`, danach `working`.
  - `classic.PermissionRequest` mit `agent_id` gesetzt → `waiting` (Review Focus 1).

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Verdrahtung implementieren** gemäß Tabelle. Timer-`cancel` merken; `session.end` stoppt ihn.

- [ ] **Step 4: Run** `claude plugin test .`, `claude plugin validate .`, `tsc` — Expected: PASS.

- [ ] **Step 5: Live-Beweis in der Desktop-App (manuell, mit Oli).** `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` vom Spike-Ordner auf diesen Repo-Ordner umstellen (Oli fragen). Neue Session öffnen, dann nacheinander erzeugen und jeweils offen lassen: Bash-Freigabe, `AskUserQuestion`, `ExitPlanMode` (Plan-Modus), wrap_up mit Frage. Für jeden Fall aus einer *zweiten* Session `/radar dump` aufrufen: Der Befehl antwortet mit `{ text }`, das alle Einträge als eine Zeile `id · status · waitReason · waitTool` auflistet (in diesem Task mitbauen, Test: `/radar dump` nennt die eigene ID).
  Expected: `status: "waiting"` mit richtigem `waitReason`. Fällt ein Fall durch: Alternativsignal (`classic.Notification` mit `notification_type`, `ui.render` auf `AskUserQuestion`) einbauen, Test ergänzen, wiederholen. **Nicht weiter zu Task 5, bevor alle vier Fälle grün sind.**

- [ ] **Step 6: Gleichzeitigkeits-Test (manuell).** Drei Sessions gleichzeitig je einen Turn mit vielen schnellen Tool-Aufrufen laufen lassen, danach prüfen, dass alle drei Schlüssel vorhanden sind. Fehlt einer: `channel.ts` auf `$.fs` mit `~/.claude/session-radar/<id>.json` umstellen (gleiche Schnittstelle, Tests aus Task 3 grün halten).

- [ ] **Step 7: Commit** `feat: report session status to the shared store`

### Task 5: Aufgaben-Fortschritt

**Files:**
- Create: `hooks/tasks.ts`
- Modify: `hooks/register.tsx` (tool.call-Hook ruft `applyTaskCall` und schreibt `me.tasks`)
- Test: `tests/tasks.test.ts`

**Interfaces:**
- Produces: `applyTaskCall(prev: TaskList | undefined, tool: string, input: unknown): TaskList | undefined`, `summarize(list: TaskList): Tasks`, mit `type TaskList = { content: string; status: 'pending' | 'in_progress' | 'completed' }[]`.

Unterstützt v1: `mcp__ccd_turn__update_plan` (Felder `items`, `advance`, `done: number[]` 1-basiert, `start: number` 1-basiert) und `TodoWrite` (`todos`). Andere Tools → `prev` unverändert. `TaskCreate`/`TaskUpdate` sind nicht in v1 (Entscheidung beim Planen, Balken ist optional).

- [ ] **Step 1: Failing tests:**
  - `items` mit 3 Einträgen, einer `in_progress` → `summarize` = `{ done: 0, total: 3, current: <Inhalt des in_progress> }`.
  - `advance: true` → laufender wird `completed`, nächster `pending` wird `in_progress`.
  - `done: [1,2], start: 3` setzt entsprechend.
  - `TodoWrite` mit `todos` ersetzt die Liste.
  - unbekanntes Tool oder kaputte Eingabe → `prev`.
  - `summarize` einer komplett erledigten Liste: `current: ''`.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementieren.** **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat: track task progress per session`

### Task 6: Pane

**Files:**
- Create: `hooks/pane.tsx`
- Modify: `hooks/register.tsx` (`/radar`-Befehl, `ui.render`-Hook, Polling)
- Test: `tests/pane.test.tsx`

**Interfaces:**
- Consumes: `groupRoster`, `readEntries`, Atome `roster`, `selfId`, `isDoneOpen`.
- Produces: `renderPane($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement>`.

Aufbau: drei Kacheln (Wartet · n, Läuft · n, Kosten gesamt ≈ $x.xx); dann Gruppen in der Reihenfolge aus den Global Constraints; „Fertig“ ist ein `Button` (plain) zum Auf-/Zuklappen, Zustand in `isDoneOpen` (Standard `false`). Zeile: Glyphe, Titel (max. 60 Zeichen, `…`), „ (diese)“ für die eigene Session; Unterzeile je nach Gruppe: Wartegrund („Freigabe Bash“, „Rückfrage“, „Plan zur Freigabe“, „Frage im Next step“) und Wartezeit, oder `done/total · current` (max. 50 Zeichen) mit Balken; Kleingedruckt: `model · ctx n% · ≈$x.xx · mm:ss`. Veraltete wartende Zeilen gedimmt mit „keine Rückmeldung seit n min“. Desktop-Look an savvy-progress angelehnt; Terminal muss nur lesbar sein.

Polling: `/radar` und `ui.open` starten `$.clock.every(3000, refresh)`, `ui.close` für die Pane-ID bzw. ein `refresh`, das das Pane nicht mehr in `$.ui.panes()` findet, ruft `cancel()`. `refresh` = `readEntries` → `update(roster)`.

- [ ] **Step 1: Failing tests** (für `surface` in `terminal`, `desktop`; Store mit drei Einträgen vorbelegt: einer waiting/permission Bash, einer working mit Tasks 2/5, einer idle):
  - `find({ text: /Wartet auf dich · 1/ })`, `/Läuft · 1/`, `/Fertig · 1/` vorhanden.
  - Wartende Zeile enthält „Freigabe Bash“.
  - Laufende Zeile enthält „2/5“.
  - Fertige Zeile ist erst nach `press` auf den Fertig-Button sichtbar.
  - Titel mit 500 Zeichen wird gezeichnet und gekürzt, kein Fehler (Review Focus 5).
  - `/radar` antwortet `{ text }` und öffnet `session-radar` (`on('ui.open', …)` mitschreiben).

- [ ] **Step 2: Run** — FAIL. **Step 3: Implementieren.** **Step 4: Run** `claude plugin test .`, `validate`, `tsc` — PASS.

- [ ] **Step 5: Live-Sichtprüfung mit Oli** in der Desktop-App: drei Sessions, eine wartend. Screenshot gegen die Global Constraints prüfen.

- [ ] **Step 6: Commit** `feat: session radar pane`

### Task 7: Abschluss

**Files:**
- Create: `README.md`
- Modify: `~/.claude/settings.json` (nur nach Olis Zustimmung, falls nicht schon in Task 4)

- [ ] **Step 1: README** (deutsch): Zweck, Installation über `CLAUDE_CODE_PLUGIN_DIRS`, `/radar`, Grenzen (nur dieser Mac, nur Sessions mit geladenem Mod, Fließtext-Fragen zählen als fertig, Early-Access-API).
- [ ] **Step 2: Spike aufräumen** (nach Olis OK): Ordner `~/.claude/dev-mods/f8d844fd-a1ad-4ac1-8b52-8ffa870f0885/session-radar-spike/`, `~/.claude/session-radar-spike/`, `~/.claude/settings.json.bak-session-radar`.
- [ ] **Step 3: Gesamtprüfung:** `claude plugin validate .`, `claude plugin test .`, `tsc` — alles grün.
- [ ] **Step 4: Commit** `docs: readme for session radar`
