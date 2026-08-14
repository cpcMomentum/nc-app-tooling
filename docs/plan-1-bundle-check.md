# Plan: nc-bundle-check — zwei Builds vergleichen statt raten

> **Erstellt:** 2026-08-14
> **Issue:** nc-app-tooling#1
> **Betrifft:** alle fuenf Apps (contractmanager, worktime, rechnungswerk, vinarium, projektwerk)

---

## Tiefen-Einschaetzung

| Signal | Bewertung |
|---|---|
| Reichweite | 1 Skript, 1 Testdatei, 5 Workflow-Zeilen — klein |
| Risiko | kein Security/Migration/Deploy. Schlimmstenfalls blockiert ein CI-Schritt zu Unrecht — genau der Zustand, den wir beheben |
| Loesungsraum | eng, die Richtung ist in #1 entschieden |
| Verifikations-kritisch | nein, der Fall ist reproduzierbar |
| Explizit angefragt | nein |

**0 von 5 Signalen → normale Tiefe.** Kein Multi-Agent-Durchlauf.

---

## 1. Problem

Der Check schliesst aus zwei Beobachtungen auf eine Absicht:

> `src/` geaendert + `js/` unveraendert → Build vergessen

In einer Vue-3-Codebasis mit TypeScript ist das ein **haeufiger korrekter Zustand**. Typen,
Interfaces und Kommentare verschwinden beim Kompilieren restlos.

**Belegt an projektwerk `b50e137`:** geaendert waren eine JSDoc-Zeile und
`dueDate?: string | null` in einem Typliteral. `npm run build` im Arbeitsbaum ausgefuehrt —
`js/` und `css/` blieben unveraendert. Der Check blockierte trotzdem.

---

## 2. Entwurfsentscheidung

### Optionen

**A: Pfade feiner ausschliessen** (`src/types/**`, `*.d.ts`)

- Aufwand: klein
- Trifft aber nur einen Teil: die Aenderung in `b50e137` lag in `src/services/tickets.ts`,
  also in einer ganz normalen Quelldatei. Typaenderungen stehen ueberall.
- **Verworfen** — kuriert das Symptom an der Stelle, an der es zufaellig auftrat.

**B: Zwei Builds im selben Lauf vergleichen**

- Aufwand: mittel
- Beantwortet die Frage, statt sie zu schaetzen: aendert der Quelltext das Kompilat?
- Umgeht die Falle aus contractmanager#251, weil beide Builds dieselbe Umgebung und
  dasselbe `node_modules` benutzen. Die Minifier-Drift entsteht ausschliesslich zwischen
  verschiedenen Umgebungen.
- Kosten: ein zusaetzlicher Build je PR (projektwerk: 228 ms).
- **Gewaehlt.**

**C: Check ersatzlos streichen**

- Aufwand: null
- Der Release baut ohnehin `rm -rf js/ && npm run build`, fuer den App Store ist das Risiko
  also gedeckt.
- Aber: der direkte Deploy (rsync auf Testinstanz und VPS) baut **nicht**. Genau dort wirkt
  ein veraltetes Bundle. contractmanager#327 ist dieser Fall.
- **Verworfen** — die Luecke bleibt real.

### Abgrenzung

Die Zwei-Build-Pruefung gilt fuer **Quelltextaenderungen**. Aendert sich nur das Lockfile,
liesse sich der Basisstand nicht ohne zweite Installation bauen; dort bleibt die vorhandene
Unterscheidung Laufzeit- gegen Entwicklungsabhaengigkeit (`dev: true` im Lockfile).

---

## 3. Verfahren

Im App-Verzeichnis, nach dem ohnehin erfolgten `npm install`:

```
1. npm run build                    → Bundle B (Stand des PR)
2. Hashes von js/ und css/ merken
3. git checkout <base> -- src/      → Quellen des Ziel-Branches
4. npm run build                    → Bundle A (Stand ohne die Aenderung)
5. Hashes vergleichen
6. git checkout HEAD -- src/ js/ css/   → Arbeitsbaum wiederherstellen
```

- **A == B** → die Aenderung beruehrt das Bundle nicht. Schweigen.
- **A != B** → das Bundle muss sich aendern. Hat der PR `js/`/`css/` nicht angefasst, ist
  es veraltet. Melden.

Schritt 6 ist nicht optional: die spaeteren CI-Schritte (Typecheck, Tests, Build) laufen im
selben Job und duerfen keinen verbogenen Arbeitsbaum vorfinden.

---

## 4. Schritte, Test zuerst

### Phase 0: Sofortmassnahme (blockiert niemanden mehr)

- 0.1 In allen fuenf Apps `continue-on-error: true` am Schritt „Bundle aktuell"
- 0.2 Im Schritt-Namen kenntlich machen: „Bundle aktuell (Hinweis, siehe nc-app-tooling#1)"
- **Ergebnis:** kein PR wird mehr zu Unrecht blockiert, das Signal bleibt sichtbar

### Phase 1: Testgeruest im Werkzeug-Repo

Das Repo hat heute **keine Tests und keine CI**. Vier Skripte pruefen fuenf Apps, und
niemand prueft die vier Skripte. Vier der heutigen Werkzeugfehler (`.ts`, Plurale,
dynamische Aufrufe, zusammengesetzte PHP-Strings) waeren hier aufgefallen.

- 1.1 `node:test` als Testlaeufer, `npm test` im `package.json`, keine neue Abhaengigkeit
- 1.2 Hilfsfunktion, die ein Wegwerf-Git-Repo mit App-Struktur aufbaut
      (`appinfo/info.xml`, `src/`, `js/`, `l10n/`)
- 1.3 **RED:** Test „Typaenderung in `src/` ohne Bundle-Aenderung wird nicht gemeldet" —
      muss mit dem heutigen Stand FEHLSCHLAGEN
- 1.4 Tests fuer das bestehende, richtige Verhalten, damit die Reparatur nichts kaputt macht:
      echte Quelltextaenderung ohne Rebuild wird gemeldet; Rebuild vorhanden wird nicht
      gemeldet; reine Entwicklungsabhaengigkeit wird nicht gemeldet;
      `[skip bundle-check]` greift
- **Ergebnis:** `npm test` laeuft, ein Test ist rot, vier sind gruen

### Phase 2: Zwei-Build-Vergleich

- 2.1 **GREEN:** Verfahren aus Abschnitt 3 in `bin/bundle-check.mjs`, bis 1.3 gruen ist
- 2.2 Arbeitsbaum-Wiederherstellung auch im Fehlerfall (`try/finally`), mit Test dafuer
- 2.3 Fehlt ein `build`-Skript in der App: verstaendlich abbrechen statt still durchwinken
- 2.4 **REFACTOR:** gemeinsame Git-Hilfen aus `pre-commit.mjs` und `bundle-check.mjs`
      zusammenfuehren, Tests bleiben gruen
- **Ergebnis:** alle Tests gruen, `b50e137` laeuft nachweislich durch

### Phase 3: CI fuer das Werkzeug-Repo

- 3.1 Workflow, der `npm test` auf Push und PR laufen laesst
- 3.2 Gegenprobe: eine Zeile im Skript verbiegen, Lauf muss rot werden, zuruecknehmen
- **Ergebnis:** Aenderungen am Werkzeug sind abgesichert, bevor sie fuenf Apps erreichen

### Phase 4: Ausrollen

- 4.1 Tag bumpen, `version` im selben Commit
- 4.2 Gegen alle fuenf Apps laufen lassen, **inklusive projektwerk `b50e137`**
- 4.3 In jeder App: Abhaengigkeit hochziehen, `continue-on-error` wieder entfernen
- 4.4 Belegen: der echte dompurify-Bump (contractmanager#323) wird weiterhin abgewiesen
- **Ergebnis:** blockierender Check ohne den bekannten Fehlalarm

---

## 5. Risiken

| Risiko | Wahrscheinlichkeit | Wirkung | Gegenmassnahme |
|---|---|---|---|
| Build nicht deterministisch auch bei gleicher Umgebung | niedrig | Check meldet immer | In Phase 2 messen: denselben Stand zweimal bauen, Hashes muessen gleich sein. Weichen sie ab, ist die Grundannahme falsch und der Umbau wird abgebrochen |
| Arbeitsbaum bleibt verbogen zurueck | mittel | Folgeschritte im selben Job scheitern | Wiederherstellung in `try/finally`, eigener Test |
| Zweiter Build kostet spuerbar Zeit | niedrig | langsamere CI | Gemessen: projektwerk 228 ms. Bei einer App ueber 30 s neu bewerten |
| Aenderung ausserhalb `src/` beeinflusst das Bundle (z.B. `vite.config.ts`) | niedrig | Fehlalarm bleibt | Bewusst ausserhalb des Zuschnitts; wird sichtbar, weil der Vergleich dann Unterschiede zeigt, die niemand erklaert |

---

## 6. Was dieser Plan NICHT umfasst

- Die Frage, ob das kompilierte Bundle ueberhaupt versioniert bleiben soll. Beim
  Durchdenken hat sich gezeigt, dass ein Wegfall die Fehlerklasse nicht beseitigt (rsync
  kopiert aus dem Arbeitsbaum, nicht aus Git) und `js/`/`css/` in dieselbe Kategorie
  schoebe, die contractmanager#245 verursacht hat. Eigenes Thema, eigene Entscheidung.
- Tests fuer `nc-l10n-check`, `nc-pre-commit` und `nc-release-check`. Phase 1 schafft das
  Geruest, in dem sie entstehen koennen — nachziehen, sobald dieser Umbau steht.
