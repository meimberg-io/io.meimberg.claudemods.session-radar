# Session Radar

Ein Claude-Code-Mod: rechts ein Panel mit allen interaktiven Sessions auf
diesem Mac, gruppiert in **Wartet auf dich**, **Läuft** und **Fertig**.

Vorbild ist das Agents-Panel von
[savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress).
Dort ist eine Zeile ein Subagent, hier eine ganze Session.

## Was es zeigt

- **Wartet auf dich**: Freigabe-Dialog, Rückfrage, Plan zur Freigabe oder eine
  Frage in der „Next step“-Box. Die längste Wartezeit steht oben.
- **Läuft**: Fortschritt aus der Aufgabenliste der Session (`3/7 · aktueller
  Schritt`), falls sie eine hat.
- **Fertig**: offene Sessions ohne laufenden Turn, eingeklappt.
- Pro Zeile Modell, Kontext-Füllstand, Kosten und Laufzeit, oben die Summen.

## Installation

Repository klonen, an einen Ort deiner Wahl:

```bash
git clone https://github.com/meimberg-io/io.meimberg.claudemods.session-radar.git ~/session-radar
```

Der Mod muss in jeder Session geladen sein, die im Panel erscheinen soll. Dafür
den Ordner in `~/.claude/settings.json` eintragen, als absoluten Pfad zu deinem
Klon. Mehrere Ordner werden mit `:` getrennt, einen bestehenden Wert also
ergänzen statt ersetzen:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<du>/session-radar"
  }
}
```

Neue Sessions laden ihn danach automatisch, auch in der Desktop-App. Schon
offene Sessions brauchen einen Neustart. `git pull` im Klon aktualisiert den Mod.

## Bedienung

- Das Panel öffnet sich in jeder neuen Session von selbst als Tab rechts.
- Ein Klick auf den Titel einer Karte springt in der Desktop-App in diese Session.
- `/radar` öffnet das Panel wieder oder holt es nach vorn.
- `/radar dump` listet die gemeldeten Einträge als Text (zur Fehlersuche).
- `/radar mark <Notiz>` hält fest, dass das Panel gerade etwas Falsches zeigt:
  die Notiz und eine Momentaufnahme aller Sessions landen in
  `~/.claude/session-radar-log/marks.jsonl`.

## Messprotokoll

Jede Session schreibt die Ereignisse, aus denen der Mod ihren Status ableitet,
nach `~/.claude/session-radar-log/<session-id>.jsonl`, eine JSON-Zeile pro
Ereignis, die letzten 3000 je Session: Start und Verbinden, Berechtigungsmodus,
Prompts und Turns (Text auf 60 Zeichen gekürzt), Tool-Prüfungen mit Urteil,
Tool-Aufrufe mit Dauer, Benachrichtigungen und jeder Statuswechsel. Die Dateien
bleiben auf dem Rechner und dienen nur der Fehlersuche.

## Grenzen

- Nur Sessions auf diesem Mac, in denen der Mod geladen ist. Cloud- und
  Remote-Sessions fehlen.
- Hintergrundläufe (`claude -p`, SDK, geplante Tasks) melden sich nicht.
- Eine Frage, die nur im Fließtext am Ende eines Turns steht, gilt als
  „Fertig“. Sie ist nicht sicher erkennbar.
- Springen geht nur zu Desktop-Sessions, nicht zu Terminal- oder IDE-Sessions.
- Die Mod-API ist Early Access (getestet mit Claude Code 2.1.299) und kann sich
  ändern.

## Entwicklung

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx -y -p typescript@5.6.3 tsc -p .
```

Die Typen unter `.claude-plugin/types/` legt die Engine beim Laden an, sie sind
nicht im Repo. Design und Plan liegen unter `docs/superpowers/`.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Panel-Aufbau und Kartendesign sind an
[savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)
von johnnyvizz angelehnt, das ebenfalls unter MIT steht; der Hinweis dazu steht
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
