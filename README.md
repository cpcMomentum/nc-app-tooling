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

## `nc-appstore-token`

Löst den App-Store-Token **maschinell** auf — Datei zuerst, Env als Fallback,
lautes Scheitern statt still leer.

```bash
TOKEN="$(npx nc-appstore-token)" || exit 1
```

Anlass ist rechnungswerk v0.5.1 (19.08.2026): der Release wurde von Hand
deployt statt in den App Store geladen, weil die Umgebungsvariable
`NC_APPSTORE_TOKEN` leer war — und daraus falsch geschlossen wurde, der Token
liege „nicht auf dem Rechner". Tatsächlich lag er die ganze Zeit als Datei vor
(`~/.nextcloud/appstore-token`, mode 0600), dieselbe Quelle, aus der alle
Flotten-Apps ihren Upload speisen. Der Store-Upload ließ sich damit nachträglich
problemlos abschließen (#12).

Die Regel „Token = Datei, Env nur Fallback" stand bis dahin nur als Prosa im
Release-Skill — und Prosa erodiert: die Vorgänger-Fassung nannte sogar **nur**
die Env-Variable, genau der Fehlschluss, der zum Vorfall führte. Dieses Werkzeug
ist die eine Wahrheit über die Herkunft.

| Regel | Wirkung |
|---|---|
| Datei `~/.nextcloud/appstore-token` nicht leer | gewinnt, auch wenn die Env gesetzt ist |
| Datei fehlt/leer, `NC_APPSTORE_TOKEN` gesetzt | Env-Fallback |
| beide leer | **exit 1** mit klarer Meldung, statt einen Leerwert zu liefern |

Der Vertrag hält `TOKEN="$(npx nc-appstore-token)"` sauber: **nur** der Token
geht auf stdout, jede Diagnose auf stderr, und der Token-Wert selbst wird nie
geloggt (nur Herkunft und Länge). Ein lautes Scheitern hier ist besser als ein
stiller Hand-Deploy.

| Exit | Bedeutung |
|---|---|
| 0 | Token aufgelöst — steht auf stdout |
| 1 | Token weder in Datei noch in Env |

## `nc-compat-check`

Meldet, wenn ein neues Nextcloud-**Major** über der `max-version` der App
erschienen ist. Der Erkennungs-Schritt eines geplanten Workflows, der die
`max-version` nicht blind hebt, sondern **prüft**.

```bash
npx nc-compat-check          # im Wurzelverzeichnis der App
```

Nextcloud released 2×/Jahr ein neues Major. Die `max-version` von Hand
nachzuziehen ist leicht vergessen — und ein Bump ohne Test ist eine ungeprüfte
Zusage (nc-app-tooling#17, aus #13). Dieses Werkzeug sagt nur, **ob** ein neues
Major da ist und **welches**; der Workflow drumherum testet die App gegen dessen
`nextcloud/ocp`-Stubs und macht daraus einen **PR** (grün, hebt `max-version`)
oder ein **Issue** (rot, mit Log). So wird die Zusage geprüft, nicht geraten.

Quelle der neuesten NC-Version sind die `nextcloud/ocp`-Releases auf Packagist —
genau das Paket, gegen dessen Stubs getestet wird. Stabile Releases sind
`vMAJOR.MINOR.PATCH`; `dev-stableXX`-Branches werden ignoriert. Für Tests und
manuelle Läufe lässt sich die Antwort per `NC_COMPAT_LATEST_MAJOR`
überschreiben.

Die Ausgabe ist auf den Workflow zugeschnitten — `key=value` auf stdout und,
in GitHub Actions, in `$GITHUB_OUTPUT`, sodass ein `if:` daran hängen kann:

```
neu=            (leer)   oder  neu=35
constraint=     (leer)   oder  constraint=^35.0
```

| Exit | Bedeutung |
|---|---|
| 0 | erkannt (auch „nichts zu tun" — ein neues Major ist kein Fehler) |
| 1 | Erkennung gescheitert (kein `info.xml`, keine `max-version`, Packagist nicht erreichbar) |

### Der Workflow drumherum

Geplant (wöchentlich) plus `workflow_dispatch`. Läuft nur vom **Default-Branch**.
Echte Arbeit nur, wenn `neu` gesetzt ist:

```yaml
on:
  schedule: [{ cron: '17 6 * * 1' }]   # Montag früh
  workflow_dispatch:
jobs:
  compat:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - id: detect
        run: npx nc-compat-check
      # ab hier nur, wenn steps.detect.outputs.neu != '':
      # composer require nextcloud/ocp:${{ steps.detect.outputs.constraint }} + phpunit
      #   grün → PR, der max-version hebt · rot → Issue mit Log (idempotent)
```

## `nc-whatsnew-check`

Prüft den **Aufbau** der `whatsnew/whatsnew.json` des „Was ist neu?"-Fensters
(Baustein 0b) — dieselben Regeln, die `nc-release-check` beim Release anlegt
(`bin/whatsnew-regeln.mjs`, nc-app-tooling#27).

```bash
npx nc-whatsnew-check          # im Wurzelverzeichnis der App
```

```jsonc
// package.json der App
"scripts": {
    "whatsnew:check": "nc-whatsnew-check"
}
```

Bis v1.16.0 lag diese Prüfung als PHPUnit-Test (`testDieAusgelieferteDateiIstGueltig`)
in jeder App einzeln. Geprüft wird universell:

- jeder Versionsschlüssel ist `x.y.z`
- jeder Eintrag hat `title` und `text`, je mit **`de` und `en`** (nicht leer)
- `where` ist optional, aber wenn da, dann zweisprachig
- `plus` ist optional (je App Pflicht **oder** verboten — vinarium etwa verbietet
  es); wenn vorhanden, muss es `true`/`false` sein

**Bewusst app-spezifisch und deshalb nicht hier:** die Icon-Whitelist (kennt nur
`WhatsNewDialog.vue`) und ob `plus` Pflicht oder verboten ist. Solche Regeln
bleiben als schlanke Prüfung in der App.

**Bewusst keine Versionsprüfung** („Schlüssel == Release-Version"): in der
App-CI wäre sie zwischen Feature-Merge und Version-Bump zwangsläufig rot — der
Eintrag wird ja *für* das kommende Release gepflegt. Diese Frage beantwortet
`nc-release-check` zum Release-Zeitpunkt, wenn die Version feststeht (Check 16):
Schlüssel für die Release-Version da → grün, keiner → Warnung mit Quittung, ein
Schlüssel **neuer** als das Release → Fehler (er könnte nie erscheinen).

| Exit | Bedeutung |
|---|---|
| 0 | gültig — oder keine `whatsnew/whatsnew.json` (nichts zu prüfen) |
| 1 | Schema-Fehler oder kaputtes JSON |

## Composite Action `ocp-versionen`

Leitet die zu testenden `nextcloud/ocp`-Versionen aus `appinfo/info.xml` ab und
**filtert sie nach der PHP-Version des Jobs**. Ersetzt die ~25 Zeilen Bash, die
sonst je App in `phpunit.yml` kopiert würden (nc-app-tooling#28).

```yaml
      - uses: cpcMomentum/nc-app-tooling/.github/actions/ocp-versionen@v1.16.0
        id: derive
        with:
          php-version: ${{ matrix.php-version }}
      - env:
          OCP_VERSIONS: ${{ steps.derive.outputs.ocp }}
        run: |
          for ocp in $OCP_VERSIONS; do
            composer require --dev --no-update "nextcloud/ocp:$ocp"
            composer update --no-interaction --prefer-dist
            composer test
          done
```

**Warum es das braucht.** NC 35 lässt PHP 8.2 fallen (`nextcloud/ocp` v35
verlangt `~8.3 || ~8.4 || ~8.5`). Die Apps pinnen `config.platform.php` aber auf
ihre eigene Untergrenze (8.2), damit das ausgelieferte `vendor/` dort läuft. Der
Pin ist richtig — er gilt dem Release. Für den Testlauf ist er falsch: ohne
diesen Filter scheitert der Job „PHP 8.2" schon an der `composer`-Auflösung, und
genau diese Fehldiagnose meldete `nc-compat` als „API-Änderung in NC 35"
(contractmanager#414). Betrifft alle fünf Apps und kommt bei jedem neuen
NC-Major wieder.

Läuft mit dem auf dem Runner vorinstallierten Node (nur Builtins + `fetch`) —
**kein `setup-node`, kein `npm ci`**, damit die kurzen PHP-Jobs kurz bleiben.

| Ein-/Ausgabe | |
|---|---|
| Eingabe `php-version` | PHP-Version des Jobs, z. B. `8.2` |
| Ausgabe `ocp` | `^32.0 ^33.0 ^34.0` (leerzeichengetrennt, für die Schleife) |
| Ausgabe `uebersprungen` | `^35.0 (braucht PHP >= 8.3)`, fürs Protokoll |

`min`/`max` kommen aus `<nextcloud min-version max-version/>`; ein `max-version`-
Bump zieht die getesteten Versionen automatisch mit. Die PHP-Untergrenze je
`ocp`-Version wird aus deren `require.php` auf Packagist gelesen (kleinste
genannte `x.y`), nicht aus einer Tabelle. Verhalten in den Randfällen:

| Fall | Verhalten |
|---|---|
| `min`/`max` fehlt in `info.xml` | Exit 1 |
| Packagist nicht erreichbar | Exit 1 (ein stummer Netzfehler darf nicht als „alles grün" durchgehen) |
| Version im Bereich, aber auf Packagist **nicht gefunden** | Exit 1 („Tag-Schreibweise geändert?") — nicht als „keine Einschränkung" verkleiden, sonst fällt der Filter still auf ungefiltert zurück |
| Version gefunden, aber **ohne** `php`-Anforderung | eingeschlossen (läuft überall) |
| keine Version läuft auf diesem PHP | Exit 1 (Matrix und `info.xml` passen nicht zusammen) |

Für Tests liest die Action die Packagist-Antwort per `OCP_PACKAGIST_FILE` aus
einer lokalen Datei statt aus dem Netz — dieselbe Idee wie
`NC_COMPAT_LATEST_MAJOR` bei `nc-compat-check`.

### Die eine Zeile daneben (bewusst nicht in der Action)

Der Filter sagt nur, **welche** `ocp`-Versionen laufen. Damit `composer` sie auf
dem Job-PHP auch auflöst, muss der Platform-Pin für den Wegwerf-Testlauf weichen
— das ist je eine Zeile und bleibt im Workflow, nicht in der Action:

- **`phpunit.yml`**, vor dem Testlauf: `composer config platform.php "$MATRIX_PHP"`
  (nur im Arbeitsverzeichnis des Laufs, nichts davon wird committet).
- **`nc-compat.yml`**, vor dem Kompat-Test: `composer config --unset platform.php`,
  damit der Wächter beim nächsten Major wirklich testet.

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
