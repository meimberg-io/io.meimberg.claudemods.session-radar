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

Der Mod muss in jeder Session geladen sein, die im Panel erscheinen soll. Dafür
den Ordner in `~/.claude/settings.json` eintragen. Mehrere Ordner werden mit `:`
getrennt, einen bestehenden Wert also ergänzen statt ersetzen:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/oli/workspace-meimbergio/io.meimberg.claudemods.session-radar"
  }
}
```

Neue Sessions laden ihn danach automatisch, auch in der Desktop-App.

## Bedienung

- Das Panel öffnet sich in jeder neuen Session von selbst als Tab rechts.
- **Öffnen ↗** auf einer Karte springt in der Desktop-App in diese Session.
- `/radar` öffnet das Panel wieder oder holt es nach vorn.
- `/radar dump` listet die gemeldeten Einträge als Text (zur Fehlersuche).

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
