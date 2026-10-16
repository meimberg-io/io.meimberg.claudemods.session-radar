# Session Radar – Design

Stand: 2026-10-16 · Autor: Oliver Meimberg mit Claude

## Absicht

Oli arbeitet in der Claude-Desktop-App mit mehreren Sessions gleichzeitig.
Welche davon arbeitet und welche auf ihn wartet, sieht er heute nur an den
orangen und blauen Punkten in der linken Seitenleiste, und Details nur durch
Hineinklicken. Session Radar ist ein Claude-Code-Mod, der rechts ein Panel mit
einer Live-Übersicht über **alle** laufenden Sessions auf diesem Mac zeigt:
Wer arbeitet, wer wartet, wie weit ist jede.

Vorbild für Aussehen und Machart ist das Agents-Panel von
[savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)
(johnnyvizz/claude-kit). Dort ist eine Zeile ein Subagent einer Session, hier
ist eine Zeile eine ganze Session.

## Ziele

- Ein Panel rechts (Mod-Pane), in jeder Session mit dem Mod aufrufbar, das
  alle aktiven Sessions des Macs zeigt.
- Pro Session sofort erkennbar, ob sie **wartet** (auf Freigabe oder Antwort),
  **arbeitet** oder **fertig/idle** ist.
- „Wartet auf dich“ steht ganz oben. Das ist der Hauptzweck.
- Fortschritt pro Session, soweit die Session ihn kennt (Aufgabenliste).

## Nicht-Ziele

- Kein Springen in eine andere Session per Klick. Ein Mod kann die
  Desktop-App nach aktuellem Wissen nicht umschalten.
- Keine Cloud- oder Remote-Sessions, nur Sessions auf diesem Mac, in denen
  der Mod geladen ist.
- Kein Ton, keine Systembenachrichtigung, kein Beantworten von Fragen aus dem
  Panel (Oli: „erstmal reicht das“).
- Keine Subagenten-Ansicht innerhalb einer Session (das macht savvy-progress).

## Anti-Ziele

- Eine Session, die wartet, darf im Panel nicht als „arbeitet“ oder „fertig“
  erscheinen. Ein übersehener Wartezustand ist schlimmer als gar kein Panel.
- Tote Sessions dürfen nicht dauerhaft als „arbeitet“ in der Liste hängen.
- Das Panel darf die Sessions nicht spürbar bremsen.

## Was der Spike gezeigt hat (2026-10-16)

Wegwerf-Mod `session-radar-spike` unter
`~/.claude/dev-mods/f8d844fd-a1ad-4ac1-8b52-8ffa870f0885/session-radar-spike/`,
in drei Desktop-Sessions geladen:

- Die Mod-API kennt nur die eigene Session. Eine Liste aller Sessions gibt es
  nicht. Lösung: Jede Session meldet ihren eigenen Zustand in einen
  gemeinsamen Speicher, das Panel liest alle Einträge.
- **`$.store` ist zwischen Sessions geteilt und wird live gelesen.** Bei
  3-Sekunden-Abfrage tauchten alle drei Sessions in jedem Panel auf. Die
  Datei-Variante (`$.fs` unter `~/.claude/session-radar-spike/`) ging genauso.
- Das Pane erscheint in der Desktop-App rechts, mit Vergrößern- und
  Schließen-Knopf.
- „Arbeitet“ (`prompt.submit`) und „fertig“ (`turn.complete` ohne `agentId`)
  wurden zuverlässig erkannt.
- **Nicht bestätigt:** „wartet“. Der Spike setzte ihn bei `tool.call` auf
  `AskUserQuestion` und bei `classic.PermissionRequest`. Ein Test schlug fehl,
  weil die Rückfrage zu schnell geschlossen wurde. Siehe „Risiken“.

## Entscheidungen

Von Oli:

- Look und Gliederung wie savvy-progress: Summenkacheln oben, Gruppen, Zeilen
  mit Titel, Unterzeile, Fortschrittsbalken.
- Gruppen „Wartet auf dich“, „Läuft“, „Fertig“ (einklappbar).
- Wartende Sessions tauchen oben im Panel auf, mehr Benachrichtigung braucht
  es vorerst nicht.
- Ablage: `~/workspace-meimbergio/io.meimberg.claudemods.session-radar`,
  eigenes Git-Repo.

Von Claude (Oli kann widersprechen):

- Gemeinsamer Speicher ist `$.store`, nicht `$.fs`. Er ist einfacher, braucht
  keine Pfade und lässt keine Dateien herumliegen.
- Mod-Name `session-radar`, Slash-Befehl `/radar` (öffnen oder in den
  Vordergrund holen).
- Das Panel öffnet sich beim Session-Start nicht von selbst, sondern nur über
  `/radar`. Begründung: Bei vielen Sessions würde es sonst überall aufgehen.
  Option `autoOpen` (`never` als Standard, `waiting`: öffnet, sobald irgendeine
  Session wartet) ist erlaubt, wenn billig.
- Die Krabben-Figuren aus savvy-progress kommen nicht in Version 1. Sie sind
  Deko, Oli hat sie nicht verlangt.
- In die Liste kommen nur Sessions mit einer interaktiven Oberfläche
  (Desktop, Terminal, IDE). Headless-Läufe (`claude -p`, SDK, geplante Tasks,
  Routinen) melden sich nicht, weil Oli dort nichts tun kann.
- „Fertig“ heißt: Session ist offen, lebt (Heartbeat) und hat gerade keinen
  Turn. Sortiert nach letztem Turn-Ende, das neueste oben.
- Ein wartender Eintrag wird nie stillschweigend ausgeblendet. Ohne Heartbeat
  bleibt er in „Wartet“, ausgegraut mit „keine Rückmeldung seit …“. Erst nach
  30 Minuten ohne Heartbeat verschwindet er.

## Aufbau

Ein Mod-Modul, zwei Rollen in jeder Session:

1. **Melder.** Hört auf die Ereignisse der eigenen Session und schreibt einen
   Eintrag `session:<sessionId>` in `$.store`.
2. **Anzeige.** Liest alle `session:*`-Einträge (Abfrage alle 2–3 s per
   `$.clock.every`, nur solange das Pane offen ist, wenn die API das hergibt)
   und zeichnet das Pane.

### Eintrag pro Session

| Feld | Inhalt | Quelle (Vorschlag, im Bau zu prüfen) |
| --- | --- | --- |
| `id` | Session-ID | `$.session.id()` |
| `title` | Titel wie in der Seitenleiste | `session_title` aus `classic.SessionStart`; sonst Ordnername + Anfang des ersten Prompts |
| `cwd` | Arbeitsordner | `$.session.cwd()` |
| `status` | `waiting` · `working` · `idle` | Ereignisse, siehe unten |
| `waitingFor` | z. B. „Freigabe Bash“, „Rückfrage“ | `tool_name` der Freigabe bzw. Frage |
| `tasks` | `done`/`total` und aktueller Schritt | Aufgabenliste der Session: Tool-Aufrufe von `mcp__ccd_turn__update_plan` (Desktop) bzw. `TodoWrite`/`TaskCreate`/`TaskUpdate` (CLI) mitlesen |
| `model` | Modell der Session | `$.session.model()` oder `turn.complete` |
| `context` | Kontext-Füllstand in % | `$.session.usage()` (`context.percent`) |
| `cost` | Kosten, wie die Statuszeile sie kennt | `$.session.usage()`, keine eigene Preistabelle |
| `startedAt`, `updatedAt` | Zeiten | `$.session.usage().startedAt`, `$.clock.now()` |
| `heartbeat` | „lebt noch“ | alle 30 s neu geschrieben |

### Zustände

- `working`: `prompt.submit`, `turn.start`, und nach einer beantworteten
  Freigabe oder Rückfrage.
- `waiting` (Oli: diese vier Fälle zählen):
  - Freigabe-Dialog offen (`classic.PermissionRequest`, evtl.
    `classic.Notification` mit `notification_type` für Freigaben),
  - Rückfrage offen (`AskUserQuestion`),
  - Plan zur Genehmigung vorgelegt (`ExitPlanMode`),
  - Turn endet mit einer Frage in der „Next step“-Box: Aufruf von
    `mcp__ccd_turn__wrap_up` mit `ask` oder `blocked: true`. Der Zustand
    bleibt bis zum nächsten `prompt.submit`, auch nach `turn.complete`.
  Eine Frage nur im Fließtext am Ende eines Turns gilt als `idle`. Sie ist
  nicht sicher erkennbar und wird nicht geraten.
- `idle`: `turn.complete` des Haupt-Loops (ohne `agentId`).
- Weg aus der Liste: `session.end` löscht den Eintrag. Ohne Heartbeat seit
  2 Minuten gilt der Eintrag als verwaist und wird ausgeblendet (beim Lesen,
  nicht gelöscht, damit ein kurzer Hänger nichts kaputt macht).

### Panel

- Kopf: Summenkacheln „Wartet“, „Läuft“, „Kosten gesamt“ (wie die drei Kacheln
  in savvy-progress).
- Gruppe **Wartet auf dich · n**, oranges ◆, Unterzeile sagt, worauf
  („Freigabe Bash“, „Rückfrage“), sortiert nach Wartezeit, die längste oben.
- Gruppe **Läuft · n**, lila ●, Fortschrittsbalken `done/total` mit aktuellem
  Schritt, sonst ohne Balken.
- Gruppe **Fertig · n**, grünes ✓, einklappbar, standardmäßig eingeklappt.
- Kleingedruckt pro Zeile: Modell · Kontext % · ≈ Kosten · Laufzeit.
- Die eigene Session ist markiert („diese“).
- Desktop ist das Ziel. Im Terminal muss es lesbar bleiben, muss aber nicht
  hübsch sein.

## Randbedingungen

- Mod-API ist Early Access (getestet mit Claude Code 2.1.299) und kann sich
  zwischen Releases ändern.
- `$.store` ist auf 4 MiB JSON pro Plugin begrenzt. Pro Session wenige hundert
  Bytes, also unkritisch, aber verwaiste Einträge sollten ab und zu
  aufgeräumt werden (z. B. älter als 24 h beim Session-Start löschen).
- Gleichzeitiges Schreiben: Jede Session schreibt nur ihren eigenen Schlüssel.
  `$.store` ist laut API aber **eine** JSON-Datei pro Plugin. Gleichzeitige
  Schreibvorgänge mehrerer Sessions können also Einträge anderer Sessions
  verlieren. Im Spike gab es keine Verluste, die Last war aber klein. Das wird
  beim Bau mit vielen schnellen Schreibvorgängen aus mehreren Sessions getestet.
  Verliert der Test Einträge, wird `$.fs` mit einer Datei pro Session genommen
  (im Spike ebenfalls bewährt). Der Speicherzugriff sitzt deshalb hinter einer
  kleinen eigenen Schnittstelle.
- Polling läuft nur, solange das Pane offen ist (`$.ui.panes()`,
  `ui.close`, `cancel()` von `$.clock.every`). Der Heartbeat läuft immer.
- Geladen wird der Mod in allen Sessions über `CLAUDE_CODE_PLUGIN_DIRS` in
  `~/.claude/settings.json`. Derzeit zeigt dieser Eintrag auf den Spike und
  muss beim Umstieg auf das Repo umgestellt werden.

## Risiken und erste Prüfungen beim Bau

1. **Wartezustand zuerst beweisen.** Bevor das Panel hübsch wird: In einer
   Desktop-Session eine Freigabe und eine Rückfrage offen stehen lassen und
   prüfen, dass der Eintrag `waiting` zeigt. Wenn `tool.call` auf
   `AskUserQuestion` oder `classic.PermissionRequest` in der Desktop-App nicht
   feuern, andere Signale suchen (`ui.render` auf `AskUserQuestion`,
   `classic.Notification`).
2. Ob die Aufgabenliste der Desktop-App (`mcp__ccd_turn__update_plan`) als
   `tool.call` im Mod sichtbar ist. Falls nicht, gibt es keinen Balken.
   Das ist akzeptabel.
3. Ob der Session-Titel aus der Seitenleiste erreichbar ist. Falls nicht, gilt
   der Ersatz-Titel.
4. Ob eine abgebrochene Session (Fenster zu, Absturz) `session.end` sendet.
   Ein Heartbeat deckt das ohnehin ab.

## Dem Bau überlassen

- Dateiaufteilung, Typvertrag (`types/index.d.ts`), Tests mit
  `claude plugin test`.
- Abfrage-Intervall, genaue Farben, Texte, Kürzungen.
- Ob Kosten und Kontext in Version 1 schon drin sind oder erst nach dem
  Kern (Status + Titel + Gruppen). Der Kern hat Vorrang.
- README mit Installationsanleitung, `marketplace.json` erst, wenn Oli teilen
  will.
- Aufräumen des Spikes (Ordner, `~/.claude/session-radar-spike/`,
  Store-Einträge `s:*`) und Umstellen von `CLAUDE_CODE_PLUGIN_DIRS`, sobald der
  echte Mod läuft.
