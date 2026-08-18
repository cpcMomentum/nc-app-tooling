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

## `nc-schema-check`

Prüft Migrationen auf Schema-Portabilität über die von Nextcloud unterstützten
Datenbanken. Läuft im Pre-Commit und in der CI.

```bash
npx nc-schema-check          # im Wurzelverzeichnis der App
```

Anlass ist worktime v0.16.0: die Migration legte eine `Types::BOOLEAN`-Spalte
mit `'notnull' => true` an. Alle 15 Tarball-Checks und der Upgrade-Test waren
grün, beim Nutzer brach das App-Update ab.

```
Column "oc_wt_employees"."vacation_transferred" is type Bool and also NotNull,
so it can not store "false".
```

Durchgerutscht ist das, weil Migrationen in der gesamten Pipeline **genau
einmal** ausgeführt werden: im Upgrade-Test des Release, gegen die lokale
Dev-Instanz. Die ist Postgres, und Postgres nimmt eine NOT-NULL-Boolean
klaglos. Die Unit-Tests laufen gegen die `nextcloud/ocp`-Stubs und führen gar
keine Migration aus (#7).

Geprüft wird gegen NCs eigene Regeln aus
`lib/private/DB/MigrationService.php` — nachgelesen in v32.0.0, v33.0.0 und
34.0.0, nicht aus der Dokumentation übernommen:

| Regel | Wirkung |
|---|---|
| `Types::BOOLEAN` mit `notnull => true` — oder ganz ohne die Option | blockiert |
| `notnull` mit `default => ''`, Spalte an bestehende Tabelle | blockiert |
| `Types::STRING` mit `length` über 4000 | blockiert |
| Tabellen-, Spalten-, Index- und Schlüsselnamen über dem Limit | blockiert |

Die zweite Zeile der Tabelle liest sich harmlos und ist die unauffälligste
Falle: Doctrine setzt `Column::$_notnull` auf **true**, wenn die Option fehlt.
Wer `notnull` weglässt, bekommt NOT NULL — und bei einer Boolean-Spalte damit
denselben Abbruch wie der, der es hinschreibt.

### Die zwei Gültigkeitsbedingungen

Ohne sie meldet der Prüfer die halbe Flotte falsch rot — beides steht so im
Quelltext von Nextcloud:

1. **Die `<database>`-Deklaration.** `ensureOracleConstraints()` läuft nur, wenn
   `checkOracle` gesetzt ist, und das passiert, wenn `info.xml` **keine**
   `<database>`-Abhängigkeit nennt oder ausdrücklich `oci`. rechnungswerk und
   projektwerk deklarieren `sqlite`/`mysql`/`pgsql` und sind von den ersten drei
   Regeln ausgenommen; worktime, contractmanager und vinarium nicht.
2. **Die NC-Version.** In v32 wirft die NOT-NULL-Boolean, seit v33 wird sie auf
   Oracle still auf nullable gesetzt (nextcloud/server#55156). Die
   Namenslängen sind umgekehrt gewandert: v32 kannte die scharfen
   Oracle-Grenzen (30 für Spalten und Indizes, 27 für Tabellen, **22** wenn der
   Primärschlüssel keinen eigenen Namen bekommt), seit v33 gilt eine glatte 63
   für alle. Welche greifen, entscheidet `min-version` aus `info.xml`.

Die Flotte sitzt bei den Namen dicht an der Grenze: 29 Zeichen beim längsten
Index, 22 bei `contractmgr_categories`. Der nächste Name ist der, der sie reißt
— und contractmanager läuft ab NC 32.

### Was er nicht sieht

Bezeichner, die erst zur Laufzeit feststehen — vinarium legt zwei Spalten in
einer Schleife an (`addColumn($column, …)`). Typ und Optionen stehen trotzdem
im Quelltext und werden geprüft, die Länge nicht. Solche Stellen **nennt** er,
statt sie still zu überspringen: ein Grün, das über eine ungeprüfte Stelle
schweigt, liest sich wie eine Zusage, die der Prüfer nicht gibt.

Geprüft wird statisch. Der gründlichere Weg wäre, NCs eigenen Validator gegen
das erzeugte Schema laufen zu lassen — das braucht je App und je NC-Version
einen NC-Container samt Datenbank. Für vier klar umrissene Regeln, deren
Quelltext hier zeilengenau nachgelesen ist, steht das nicht im Verhältnis.

| Exit | Bedeutung |
|---|---|
| 0 | Schema ist portabel |
| 1 | Regelverstoß — **nicht mergen** |
| 2 | Kein App-Verzeichnis (`appinfo/info.xml` fehlt) |

### Im CI

```yaml
- name: Schema-Portabilitaet
  run: npx nc-schema-check
```

## `nc-notification-check`

Prüft, ob die Notifier der App die Setter-Verträge von Nextcloud einhalten.
Läuft im Pre-Commit und in der CI.

```bash
npx nc-notification-check          # im Wurzelverzeichnis der App
```

Anlass ist worktime auf NC 34: das Icon wurde mit einer **relativen** URL
gesetzt.

```php
$notification->setIcon($this->urlGenerator->imagePath('worktime', 'app-dark.svg'));
// => '/custom_apps/worktime/img/app-dark.svg'
```

`setIcon()` lässt nur absolute `http(s)`-URLs zu und wirft sonst
`InvalidValueException`. Die Folge war nicht „kein Icon": `prepare()` bricht an
der Stelle ab, und weil `setIcon` **vor** `setLink` stand, kam jede
Benachrichtigung ohne Icon **und** ohne Link an — bei jedem Subject,
unabhängig von den Daten. Dazu Log-Spam im Minutentakt (#8).

Gefangen hat es niemand, weil die Unit-Tests `INotification` mocken und die
Setter auf `willReturnSelf()` stubben. **Ein Mock kann einen ungültigen Wert
gar nicht ablehnen** — der Test prüft unsere Annahme über NC, nicht NCs
Verhalten. Der canary läuft gegen die `ocp`-Stubs, das sind leere
Methodenrümpfe. Und die Release-Checks rufen `Manager::prepare()` nie auf. In
der gesamten Pipeline geht keine einzige Benachrichtigung durch ein echtes
Nextcloud.

Geprüft wird gegen `lib/private/Notification/Notification.php` und
`Action.php`, nachgelesen in 34.0.0:

| Regel | Wirkung |
|---|---|
| `setIcon`/`setLink` mit nachweislich relativem Wert | blockiert |
| `setIcon`/`setLink` mit Leerwert | blockiert |
| `setApp`, `setUser`, `set*Subject`, `set*Message` mit Leerwert | blockiert |
| `Action::setLink` mit einer Anfrageart außerhalb GET/POST/PUT/DELETE/WEB | blockiert |

Die Trennung, um die sich alles dreht, steht in `IURLGenerator` und ist im
Quelltext acht Zeichen breit:

| liefert einen Pfad | liefert eine URL |
|---|---|
| `imagePath()`, `linkTo()`, `linkToRoute()` | `getAbsoluteURL()`, `linkToRouteAbsolute()`, `linkToOCSRouteAbsolute()`, `getBaseUrl()` |

`Action::setLink()` verlangt dasselbe wie `Notification::setLink()` — der
Riegel hängt deshalb am Setter, nicht am Empfänger.

### Was er nicht sieht

Er urteilt über den **Ausdruck** im Quelltext, nicht über den Wert zur
Laufzeit. Eine Hilfsmethode derselben Klasse löst er auf, samt Variablen und
ternären Zweigen — projektwerk baut seinen Deep-Link so, und ohne diesen
Schritt stünde dort ein Hinweis, der nie verschwindet. Kommt der Wert von
außerhalb der Datei, sagt er das und blockiert nicht.

Der vollständige Weg wäre, jedes Subject durch `Manager::prepare()` eines
echten Nextcloud zu schicken, in einer Versionsmatrix. Das braucht je App und
je NC-Version einen Container samt Datenbank. Für die Klasse von Fehlern, die
hier aufgetreten ist, steht das nicht im Verhältnis — und der Riegel greift
schon vor dem Commit statt erst in der CI.

| Exit | Bedeutung |
|---|---|
| 0 | Verträge eingehalten |
| 1 | Vertragsverletzung — **nicht mergen** |
| 2 | Kein App-Verzeichnis (`appinfo/info.xml` fehlt) |

### Im CI

```yaml
- name: Notification-Vertraege
  run: npx nc-notification-check
```

## Abgelöst: `nc-bundle-check`

Gab es von v1.6.0 bis v1.10.0. Er fing vergessene Frontend-Builds über eine
Heuristik: „`src/` geändert, `js/` nicht → Build vergessen". Beides war ungenau.
Typangaben und Kommentare verschwinden beim Kompilieren, „Quelle geändert,
Bundle unverändert" ist also oft ein **korrekter** Zustand — und umgekehrt galt
jede beliebige Änderung unter `js/` als „mitgebaut", ein Bundle aus einem
fremden Stand bestand die Prüfung. Sein Ausweg `[skip bundle-check]` schaltete
ihn flottenweit ab.

Der naheliegende Byte-Diff galt als unmöglich, weil die CI das Lockfile wegwarf
(`rm -f package-lock.json`, mit Verweis auf npm/cli#4828). Das hielt der
Gegenprüfung nicht stand: der Fehler, der bei `npm ci` tatsächlich auftrat, war
ein Auflösungsfehler von npm 10 auf einem synchronen Lockfile. Mit npm 11 läuft
`npm ci` durch, und danach bauen alle fünf Apps unter Linux **byte-identisch**
zum eingecheckten Bundle.

Seit 08/2026 steht deshalb in der CI der Apps ein echter Vergleich:

```yaml
      - name: Produktions-Build
        run: npm run build

      - name: Bundle passt zum Quellstand
        run: git diff --exit-code -- js/ css/
```

Kein eigenes Werkzeug nötig — gebaut wurde ohnehin schon. Für den Release, wo
gegen HEAD statt gegen den Arbeitsbaum verglichen werden muss, gibt es
`nc-bundle-fresh`.

## Tests

```bash
npm test
```

Sie bauen sich eine Wegwerf-App mit eigenem Build-Skript, brauchen weder
Nextcloud noch eine der fünf Apps und laufen in Sekunden. In der CI gegen
Node 20 und 24.

Sechs Werkzeuge prüfen fünf Apps — und bis zum 15.08.2026 prüfte niemand die
Werkzeuge. Vier der Werkzeugfehler, die in den Apps aufgefallen sind, wären
hier aufgefallen. Der fünfte fiel beim Bau des Schema-Prüfers auf: er meldete
„Indexnname zu lang", weil sich aus „Index" und „Spalte" kein gemeinsames Wort
bilden lässt. Das hat der Test gefunden, nicht das Lesen.

## Beitragen

Änderungen wirken auf alle fünf Apps. Vor dem Tag gegen jede laufen lassen:

```bash
for a in worktime contractmanager rechnungswerk vinarium projektwerk; do
  ( cd ../$a && node ../nc-app-tooling/bin/l10n-check.mjs )
done
```

Für `nc-bundle-fresh` derselbe Lauf mit `bin/bundle-fresh.mjs`. Er dauert je App
6 bis 17 Sekunden, weil er wirklich installiert und baut. `nc-schema-check` und
`nc-notification-check` laufen in Millisekunden und müssen über alle fünf grün
sein, bevor sie ausgerollt werden — ein Fehlalarm im Pre-Commit blockiert sonst
flottenweit jeden Commit an einer Migration oder einem Notifier.

Dann Tag **und** `version` im selben Commit setzen, danach die Apps nachziehen.

Keine Laufzeit-Abhängigkeiten. Läuft mit dem Node, das ohnehin da ist.

## Lizenz

AGPL-3.0-or-later, wie die Apps.
