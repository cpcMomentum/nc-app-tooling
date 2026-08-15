# nc-app-tooling

Geteilte Entwicklungswerkzeuge der Nextcloud-App-Flotte: **VertragsWerk**
(`contractmanager`), **WorkTime**, **RechnungsWerk**, **Vinarium**,
**ProjektWerk**.

## Warum es dieses Repo gibt

Die Apps teilen ihre Regeln über einen gemeinsamen Skill-Ordner — aber der liegt
außerhalb der Repos, und die CI sieht immer nur das eine App-Repo, das sie
auscheckt. Werkzeuge wurden deshalb kopiert, und Kopien laufen auseinander.

Beim l10n-Prüfer war der Stand im August 2026: **drei verschiedene Lösungen in
drei Apps, zwei Apps ganz ohne.** Und das Ergebnis war messbar — Apps mit
Prüfer hatten null Lücken, Apps ohne hatten 21 bis 37.

Eine Regel lässt sich als Text teilen. Ein Werkzeug nicht. Dafür ist dieses Repo
da: eine Fassung, versioniert, von allen Apps als Abhängigkeit gezogen.

## Einbinden

```bash
npm install --save-dev github:cpcMomentum/nc-app-tooling#v1.0.0
```

Auf einen Tag zeigen, nicht auf einen Branch — sonst ändert sich das Werkzeug
unter der App, ohne dass es jemand entscheidet.

```jsonc
// package.json der App
"scripts": {
    "l10n:check": "nc-l10n-check",
    "l10n:fix": "nc-l10n-check --fix"
}
```

## `nc-l10n-check`

Wächter gegen Drift zwischen Code und Übersetzungskatalogen.

```bash
npm run l10n:check    # prüfen, Exit 1 bei struktureller Drift
npm run l10n:fix      # Kataloge aus dem Code regenerieren
```

Läuft im Wurzelverzeichnis der App. **Es gibt nichts zu konfigurieren** — die
App-ID kommt aus `appinfo/info.xml`, die Sprachen aus den vorhandenen
`l10n/*.json`. Jeder Schalter wäre eine Stelle, an der die Apps wieder
auseinanderlaufen können.

Wahrheit ist der Code. Eingesammelt werden:

| Quelle | Aufrufe |
|---|---|
| `src/` (`.js`, `.ts`, `.vue`, ohne Tests) | `t('<app>', '…')`, `n('<app>', '…', '…')` |
| `lib/`, `templates/`, `appinfo/` (`.php`) | `->t('…')`, `->t("…")`, `->n('…', '…')` |

Geprüft wird gegen alle `l10n/<lang>.{js,json}`:

1. `.js` und `.json` tragen dieselben Schlüssel
2. … und dieselben Werte (fängt typografische Drift, etwa `…` gegen `...`)
3. Jeder Schlüssel aus dem Code steht im Katalog — fehlende blockieren
4. Jeder Schlüssel im Katalog kommt im Code vor — tote blockieren
5. Hinweis, nicht blockierend: Einträge, die noch dem Quelltext entsprechen

Pluralformen sind berücksichtigt: `n()` bildet den Nextcloud-Schlüssel
`_Singular_::_Plural_` mit dem Wert `[Singular, Plural]`. Ohne diese Erfassung
hielte der Prüfer genau diese Einträge für tot und `--fix` würde sie löschen.

### Quellsprache

Deutsch, in `src/` **und** `lib/`. In der Quellsprache gilt Wert == Schlüssel;
`--fix` setzt das durch. Ein englischer Quellstring in einer deutschen App sieht
übersetzt aus, ist es aber nicht — so standen in VertragsWerk 29 Meldungen fünf
Monate lang englisch in einer deutschen Oberfläche.

**Reihenfolge beachten:** Erst die Quellstrings richtigstellen, dann `--fix`.
Umgekehrt überschreibt der Fix vorhandene Übersetzungen mit dem Schlüssel.

### Im Pre-Commit-Hook

Der Auslöser hängt am **Code**, nicht an den l10n-Dateien. Das ist der Punkt:
Wer den Katalogeintrag vergisst, fasst keine l10n-Datei an — ein Auslöser „bei
jeder l10n-Änderung" sieht genau den Fall nicht, den er finden soll.

```sh
L10N_RELEVANT=$(git diff --cached --name-only --diff-filter=ACM \
    | grep -E '^(src/|lib/|templates/|appinfo/|l10n/).*\.(js|ts|vue|php|json)$' || true)
if [ -n "$L10N_RELEVANT" ] && command -v node >/dev/null 2>&1; then
    npx --no-install nc-l10n-check || exit 1
fi
```

Steht ein Check dahinter, der bei „keine PHP-Dateien gestaged" mit `exit 0`
aussteigt, muss dieser Block **davor** — sonst erreicht eine reine
`.vue`-Änderung ihn nie.

### Im CI

```yaml
- name: l10n-Vollstaendigkeit
  run: npm run l10n:check
```

## `nc-bundle-fresh`

Prüft, ob das vorliegende Bundle zum Quellstand passt. Läuft im Release
zwischen Signieren und Packen.

```bash
npx nc-bundle-fresh          # im Wurzelverzeichnis der App
```

Der Release baut in Schritt 3.1, **packt** aber in Schritt 5.1 einfach, was im
Arbeitsbaum liegt. Dazwischen prüfte bis 08/2026 nichts, ob dieses Bundle zum
Quellstand passt — keiner der 15 Tarball-Checks vergleicht Bundle gegen `src/`.
Ein veraltetes, aber vorhandenes Bundle bestand damit jede Prüfung (#2).

Verglichen wird genau das Paar, das beim Nutzer landet:

| | Quelle | wird |
|---|---|---|
| Quellen | `git archive HEAD` | neu gebaut (`npm ci && npm run build`) |
| Bundle | Arbeitsbaum | dagegen gehalten (SHA-256) |

Ein schmutziger Arbeitsbaum verfälscht das Urteil deshalb **nicht**: was nicht
committet ist, wird auch nicht ausgeliefert.

| Exit | Bedeutung |
|---|---|
| 0 | Bundle passt zum Quellstand |
| 1 | Inhalt weicht ab oder eine Bundle-Datei fehlt — **nicht releasen** |
| 2 | Der Vergleich war nicht möglich (Build kaputt, Lockfile fehlt) |

Überzählige Dateien im Arbeitsbaum werden genannt, blockieren aber nicht: das
ist Totgewicht, kein alter ausgelieferter Code — worauf es zeigen würde, ist die
Einstiegsdatei, und die wird byte-genau verglichen.

Nicht verglichen werden `*.map` und `*.LICENSE.txt` (stehen in den
Tarball-Excludes, erreichen nie einen Nutzer) und alles, was nicht kompiliert
ist. Letzteres hat einen konkreten Grund: contractmanager importiert
`css/main.scss` aus `src/main.ts` — in `css/` wohnt also nicht nur Ausgabe.

## Tests

```bash
npm test
```

Sie bauen sich eine Wegwerf-App mit eigenem Build-Skript, brauchen weder
Nextcloud noch eine der fünf Apps und laufen in Sekunden. In der CI gegen
Node 20 und 24.

Vier Werkzeuge prüfen fünf Apps — und bis zum 15.08.2026 prüfte niemand die
vier Werkzeuge. Vier der Werkzeugfehler, die in den Apps aufgefallen sind,
wären hier aufgefallen.

## Beitragen

Änderungen wirken auf alle fünf Apps. Vor dem Tag gegen jede laufen lassen:

```bash
for a in worktime contractmanager rechnungswerk vinarium projektwerk; do
  ( cd ../$a && node ../nc-app-tooling/bin/l10n-check.mjs )
done
```

Für `nc-bundle-fresh` derselbe Lauf mit `bin/bundle-fresh.mjs`. Er dauert je App
6 bis 17 Sekunden, weil er wirklich installiert und baut.

Dann Tag **und** `version` im selben Commit setzen, danach die Apps nachziehen.

Keine Laufzeit-Abhängigkeiten. Läuft mit dem Node, das ohnehin da ist.

## Lizenz

AGPL-3.0-or-later, wie die Apps.
