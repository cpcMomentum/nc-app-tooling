# Design-System der App-Flotte

Gilt für **RechnungsWerk**, **ProjektWerk**, **WorkTime**, **VertragsWerk**
(`contractmanager`) und **Vinarium**. Der Abschnitt [WerkPlus](#5-werkplus-abschnitt)
gilt nur für die vier Werk-Apps.

## Warum es dieses Dokument gibt

Drei Apps hatten im November 2026 dieselbe Einstellungsseite: Gruppen mit
Überschrift, Symbole, 240 px Seitenleiste, 1100 px Breite. Das Muster stammt aus
einem WorkTime-Entwurf vom Juni 2026 (`worktime/docs/20260601_mockup-settings-navigation.html`).
Es stand nirgends als Regel. ProjektWerk hat seine Seite deshalb anders gebaut
(flache Liste ohne Symbole), RechnungsWerk hat sie von ProjektWerk
kopiert und wieder um Gruppen und Symbole ergänzt. Auch das „Was ist neu?“-Fenster
liegt in fünf eigenen Fassungen vor.

Jede Session baut für sich vernünftig, aber jede anders. Dieses Dokument legt fest,
was in allen Apps gleich aussieht.

## Wie es zu lesen ist

- **Nextcloud zuerst.** Was `@nextcloud/vue` mitbringt, wird benutzt und nicht
  nachgebaut: Navigation, Buttons, Hinweiskarten, Dialoge, Eingabefelder. Das Dokument
  regelt nur, was Nextcloud offenlässt.
- **Muss** heißt verbindlich. **Soll** heißt: Abweichung nur mit Begründung im
  Code-Kommentar.
- Feste Texte stehen hier im Wortlaut (Quellsprache Deutsch, „du“; siehe
  [Sprache](#7-sprache)). `<App>` steht für den Produktnamen.
- Ändert sich eine Regel, ändert sie sich **hier zuerst**, danach in den Apps.

---

## 1. Grundlagen

| Regel | Stufe |
|---|---|
| Farben nur aus Nextcloud-Variablen (`--color-*`). Eigene Farben nur für fachliche Bedeutung (etwa die Abwesenheitsarten in WorkTime), dann als `--<kürzel>-*`-Variable an einer Stelle. | Muss |
| Abstände, Radien: `--border-radius-element`, `--border-radius-large`, `--default-grid-baseline`, wo es passt. Keine Pixel-Radien. | Soll |
| Symbole aus `vue-material-design-icons`. 20 px in der App-Navigation, 18 px in der Einstellungs-Navigation, 20 px in Buttons. | Muss |
| Jede View-Wurzel hat `padding-left: 50px` (mindestens), sonst überdeckt der Knopf der Nextcloud-Seitenleiste die Überschrift. | Muss |
| `img/app.svg` mit `fill="#fff"`, `img/app-dark.svg` ohne `fill`. | Muss |
| Seitentitel als `h2` in der View, ohne eigene Schriftgröße. | Soll |

Die beiden Pflichtregeln zu Abstand und App-Symbol stehen auch in
`AAB_Coding_Projekte/.claude/standards/reference/vue-nextcloud-patterns.md`.
Maßgeblich ist dieses Dokument.

## 2. App-Navigation

Hauptpunkte sind je App verschieden. **Der Fuß der Navigation** (`#footer` von
`NcAppNavigation`) ist in allen Apps gleich, in dieser Reihenfolge:

| Punkt | Symbol | Sichtbar für | Stufe |
|---|---|---|---|
| App-eigene Punkte (etwa „Protokoll“) | je App | je App | – |
| Neuerungen | `BullhornOutlineIcon` | alle außer Gäste | Muss |
| Einstellungen | `CogIcon` | alle, wenn es persönliche Einstellungen gibt | Muss |
| Verwaltung | `ShieldAccountIcon` | wer verwalten darf (Nextcloud-Admin oder App-Rolle) | Muss |

- Es gibt zwei Seiten mit festen Namen:
  - **Einstellungen**: persönlich, gilt nur für den angemeldeten Nutzer
    (eigene Benachrichtigungen, eigener Kontakt, Ansicht). Was bisher
    „Meine Einstellungen“ oder „Mein Kontakt“ heißt, heißt künftig so.
  - **Verwaltung**: app-weit, für alle Nutzer der App wirksam (Firma,
    Nummernkreise, Mitarbeiter, WerkPlus).
- Nicht „Admin“ oder „Administration“: In WorkTime verwalten auch App-Rollen,
  die keine Nextcloud-Admins sind. „Verwaltung“ entspricht Nextclouds eigenem
  Begriff „Verwaltungseinstellungen“.
- Persönliches steht nie als Gruppe in der Verwaltung, App-weites nie in den
  Einstellungen.
- Ein Punkt, der für den Nutzer ins Leere liefe, wird ausgeblendet. Die Sperre
  selbst sitzt serverseitig.

## 3. Einstellungsseite

Gilt für **Einstellungen** und **Verwaltung** gleichermaßen. Beispiele unten zeigen die Verwaltung.

### Aufbau

```
Verwaltung                                            ← h2
┌──────────────────┬─────────────────────────────────┐
│ GRUPPE           │ ┌─────────────────────────────┐ │
│  ⚙ Punkt         │ │ ABSCHNITTSTITEL             │ │
│  ▣ Punkt (aktiv) │ │ Inhalt                      │ │
│ ──────────────── │ │                             │ │
│ GRUPPE           │ └─────────────────────────────┘ │
│  ⚙ Punkt         │                                 │
└──────────────────┴─────────────────────────────────┘
   240 px    gap 24 px         Rest, max. 1100 px gesamt
```

| Regel | Stufe |
|---|---|
| View: `padding: 20px; padding-left: 50px; max-width: 1100px`. | Muss |
| Raster: `grid-template-columns: 240px 1fr; gap: 24px; align-items: start`. Unter 900 px eine Spalte, Navigation nicht mehr `sticky`. | Muss |
| Navigation ist ein `<nav>` mit `aria-label` („Einstellungs-Navigation“), Punkte sind `<button>` mit `aria-current="page"` am aktiven. | Muss |
| Punkte sind in **Gruppen** mit Überschrift geordnet, auch wenn es nur eine Gruppe gibt. | Muss |
| Jeder Punkt hat ein **Symbol** (18 px). | Muss |
| Es ist immer **genau ein Abschnitt** sichtbar, der zum aktiven Punkt. | Muss |
| Der aktive Punkt steht in der URL (Query oder Hash), damit ein Link und „Zurück“ funktionieren. | Soll |

### Navigation, Aussehen

```css
.settings-nav { position: sticky; top: 0; display: flex; flex-direction: column;
  padding: 0 16px 0 0; border-right: 1px solid var(--color-border-dark, var(--color-border)); }

.settings-nav-group { font-size: 11px; font-weight: 700; letter-spacing: .5px;
  text-transform: uppercase; color: var(--color-text-maxcontrast);
  padding: 16px 12px 6px; margin-top: 8px;
  border-top: 1px solid var(--color-border-dark, var(--color-border)); }
.settings-nav-group:first-child { padding-top: 0; margin-top: 0; border-top: none; }

.settings-nav-item { display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 12px; border: none; background: none; text-align: left;
  color: var(--color-main-text); font-size: 14px; font-weight: 500;
  border-radius: var(--border-radius-element, 8px); cursor: pointer; }
.settings-nav-item .material-design-icon { color: var(--color-text-maxcontrast); }
.settings-nav-item:hover { background: var(--color-background-hover); }
.settings-nav-item.active { background: var(--color-primary-element-light);
  color: var(--color-primary-element); font-weight: 600; }
.settings-nav-item.active .material-design-icon { color: var(--color-primary-element); }
.settings-nav-item:focus-visible { outline: 2px solid var(--color-primary-element); outline-offset: -2px; }
```

Klassennamen dürfen ein App-Kürzel tragen (`rw-subnav__item`), die Werte nicht
abweichen. Referenz: `worktime/src/views/SettingsView.vue`.

### Abschnitt

| Regel | Stufe |
|---|---|
| Ein Abschnitt ist eine **Karte**: `border: 1px solid var(--color-border); border-radius: var(--border-radius-large); padding: 18px 20px; background: var(--color-main-background)`. | Muss |
| Abschnittstitel = Name des Navigationspunkts, `h3`, 13 px, 600, Großbuchstaben, `letter-spacing: .04em`, `color: var(--color-text-maxcontrast)`. | Muss |
| Unter dem Titel optional ein Satz Erklärung in `--color-text-maxcontrast`. | Soll |
| Zwischenüberschriften im Abschnitt: normaler Text, `font-weight: 600`, keine Großbuchstaben. | Muss |

Referenz: `rechnungswerk/src/css/app.css` (`.rw-section`).

### Felder

| Regel | Stufe |
|---|---|
| Beschriftung **über** dem Feld, 6 px Abstand; 16 px zwischen zwei Feldern. | Muss |
| Eingabefelder mit sichtbarem Rand `var(--color-border-dark)`, im Fokus `var(--color-primary-element)`. | Soll |
| Felder füllen die Kartenbreite, höchstens 480 px, wenn der Inhalt kurz ist (Nummern, Kürzel). | Soll |
| Hilfetext unter dem Feld, `--color-text-maxcontrast`, 13 px. | Soll |

### Fakten (Beschriftung und Wert nebeneinander)

Für reine Anzeige (Tarif, Gültig bis, Version …) eine `dl`:

```css
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 16px; }
/* Nextcloud gibt dt/dd global feste Breite, Rechtsbündigkeit und Innenabstand. */
.facts dt, .facts dd { width: auto; margin: 0; padding: 0; text-align: start; }
.facts dt { color: var(--color-text-maxcontrast); }
```

**Muss.** Ohne das Zurücksetzen von `dt`/`dd` stehen die Beschriftungen
rechtsbündig in einer zu schmalen Spalte und überlappen den Wert (ProjektWerk,
WerkPlus-Abschnitt, November 2026).

### Speichern

| Regel | Stufe |
|---|---|
| Ein Abschnitt mit Feldern hat **einen** Speichern-Knopf (`NcButton variant="primary"`, Text „Speichern“) unten links im Abschnitt. | Soll |
| Abschnitte mit eigenen Aktionen (WerkPlus) haben keinen gemeinsamen Speichern-Knopf. | Muss |
| Erfolg und Fehler als `NcNoteCard` im Abschnitt oder als Toast (`@nextcloud/dialogs`), nicht als `alert`. | Muss |

## 4. Hinweise, Dialoge, Leerzustände

| Regel | Stufe |
|---|---|
| Zustandsmeldungen im Inhalt: `NcNoteCard` (`success`, `info`, `warning`, `error`). | Muss |
| Bestätigungen vor dem Löschen oder Entfernen: `NcDialog`, Titel nennt die Aktion, Bestätigungsknopf nennt das Verb („Entfernen“, nicht „OK“). | Muss |
| Leere Listen: `NcEmptyContent` mit Symbol und einem Satz, was hier erscheinen wird. | Soll |
| Laden: `NcLoadingIcon` (44 px bei ganzer Seite). | Soll |

## 5. WerkPlus-Abschnitt

Nur Werk-Apps. Der Abschnitt sieht in allen vier Apps gleich aus. Was je App
abweicht, ist unten markiert. Vertrag und Verhalten: `werkplus-backend/docs/contracts/entitlement-v1.md`.

### Ort

Letzte Gruppe **„Lizenz“** auf der Seite **Verwaltung**, Punkt **„WerkPlus“**,
Symbol `KeyOutlineIcon`. **Muss.**

### Reihenfolge im Abschnitt (Muss)

1. Titel „WerkPlus“ (Abschnittstitel, siehe oben)
2. Einleitung, zwei Sätze:
   - **je App:** was ohne Schlüssel frei ist und was der Schlüssel freischaltet
   - **fest:** „Der Schlüssel gilt für alle Werk-Apps dieser Nextcloud und muss nur in einer davon eingetragen werden.“
3. Hinweiskarte zum Zustand (`NcNoteCard`), siehe Texte unten
4. Fakten als `dl` (nur wenn ein Schlüssel hinterlegt ist), in dieser Reihenfolge:
   Tarif · Lizenzierte Mitarbeitende (nur wenn gesetzt) · Gültig bis · Letzte erfolgreiche Prüfung · Schlüssel
5. Für Nicht-Admins: „Den Schlüssel können nur Nextcloud-Admins eintragen oder entfernen, weil er für alle Werk-Apps dieser Nextcloud gilt.“
6. Feld „WerkPlus-Schlüssel“, Platzhalter `wp_…` bzw. „gespeichert, leer lassen“
7. Knöpfe, in dieser Reihenfolge:
   - „Schlüssel prüfen und speichern“ / „Speichern und prüfen“ (primary)
   - „30 Tage testen“ (nur ohne Schlüssel)
   - „Jetzt prüfen“ (nur mit Schlüssel)
   - „Schlüssel entfernen“ (tertiary, nur mit Schlüssel)
8. Zwischenüberschrift „Was an WerkPlus übertragen wird“ (fett, keine Großbuchstaben), darunter:
   - **je App (nur die Datenarten):** „Eine aus dieser Nextcloud abgeleitete Kennung, die Versionen der aktivierten Werk-Apps und, sobald vorhanden, der Schlüssel. Nicht übertragen werden <Datenarten der App>, Nextcloud-Benutzer- oder Datei-IDs.“
   - **fest:** „Die Lizenz wird auf diesem Server geprüft. Ist WerkPlus nicht erreichbar, arbeitet <App> normal weiter.“
   - **fest:** „Kennung dieser Nextcloud:“ + UUID als `<code>`

„aktivierten“, nicht „installierten“: gemeldet werden nur aktivierte Apps.

### Feste Texte

| Zustand | Karte | Text |
|---|---|---|
| gültig | success | WerkPlus ist aktiv. |
| Nachfrist | warning | Die Lizenz ist abgelaufen und konnte noch nicht erneuert werden. Die Funktionen bleiben bis {date} erhalten. |
| abgelaufen | error | Die Lizenz ist abgelaufen. <App> arbeitet im freien Umfang weiter. |
| ungültig | error | Der gespeicherte Lizenznachweis ist ungültig. Bitte prüfe die Lizenz erneut. |
| Ablage zu neu | warning | Eine andere Werk-App hat die Lizenz in einem neueren Format gespeichert. Bitte aktualisiere <App>. |

| Dialog | Titel | Text | Knopf |
|---|---|---|---|
| Testzeitraum | WerkPlus 30 Tage testen | Der Testzeitraum läuft 30 Tage, braucht keine Zahlungsdaten, gilt für alle Werk-Apps dieser Nextcloud und ist je Nextcloud nur einmal möglich. Jetzt starten? | Testzeitraum starten |
| Entfernen | WerkPlus-Schlüssel entfernen | Der Schlüssel wird für alle Werk-Apps dieser Nextcloud entfernt, sie arbeiten danach im freien Umfang. Den Schlüssel kannst du jederzeit wieder eintragen. Fortfahren? | Entfernen |

Referenz: `rechnungswerk/src/components/WerkPlusSettings.vue`.

### Alte Fehlermeldung

Die letzte Fehlermeldung speichert jede App für sich. Ist das Token in der
gemeinsamen Ablage **neuer** als der gespeicherte Fehler (eine andere Werk-App
hat inzwischen erfolgreich geprüft), wird der Fehler nicht mehr angezeigt.
**Muss.** Sonst steht neben „WerkPlus ist aktiv.“ eine veraltete Warnung.

## 6. Neuerungen

| Regel | Stufe |
|---|---|
| „Was ist neu?“-Fenster: einmal je Nutzer und Version nach einem Update, erst wenn der Zugriff feststeht, wegklickbar, blockiert nie. | Muss |
| Titel: „Was ist neu in <App>“. | Muss |
| Inhalt aus `whatsnew/whatsnew.json`, geprüft mit `nc-whatsnew-check`. Texte ohne Anrede. | Muss |
| Punkt „Neuerungen“ im Fuß der Navigation öffnet dasselbe Fenster mit allen bisherigen Einträgen (Archiv). Kein eigenes Router-Ziel. | Muss |
| Ohne Einträge: „Noch keine Neuerungen.“ | Muss |
| Gäste sehen weder Fenster noch Punkt. | Muss |
| Werk-Apps: WerkPlus-Funktionen tragen `plus: true` und ein WerkPlus-Abzeichen. Vinarium kennt kein `plus`. | Muss |

## 7. Sprache

- Quellsprache Deutsch mit „du“, `de_DE` mit „Sie“ (Regeln: `nc-l10n-check`, README).
- Begriffe einheitlich: **Einstellungen** (persönlich), **Verwaltung** (app-weit), **Neuerungen**,
  **Speichern**, **Entfernen** (Schlüssel, Zuordnung), **Löschen** (Daten weg).
- Knöpfe nennen das Verb, nicht „OK“ oder „Ja“.
- Keine Ausrufezeichen in Hinweisen.

---

## Abweichungen, Stand 16.11.2026

| App | Abweichung |
|---|---|
| ProjektWerk | „Meine Einstellungen“ statt „Einstellungen“; Navigation flach, ohne Symbole; keine Karten; keine Breitenbegrenzung; `dt`/`dd` nicht zurückgesetzt (Überlappung); Zwischenüberschrift im WerkPlus-Abschnitt in Großbuchstaben; alte Fehlermeldung bleibt stehen |
| RechnungsWerk | Kein Punkt „Neuerungen“; app-weite Seite heißt „Einstellungen“ statt „Verwaltung“; „Mein Kontakt“ statt „Einstellungen“; „installierten“ statt „aktivierten“ |
| WorkTime | app-weite Seite heißt „Einstellungen“ statt „Verwaltung“, persönliche „Meine Einstellungen“ statt „Einstellungen“; Abschnitte als `NcSettingsSection` statt Karte; WerkPlus-Abschnitt fehlt (worktime#871); Vue 2 |
| VertragsWerk | Persönliches und App-weites auf einer Seite „Einstellungen“ statt zwei Seiten; Reihenfolge im Fuß; WerkPlus-Abschnitt fehlt (contractmanager#523) |
| Vinarium | Keine Einstellungsseite (nur nötig, wenn es etwas einzustellen gibt) |

Die Liste ist eine Bestandsaufnahme, keine Vollständigkeitsprüfung.

## Durchsetzung

Geplant: `nc-design-check` in diesem Repo prüft, was sich am Code prüfen lässt
(Seitennamen „Einstellungen“/„Verwaltung“, Symbol an jedem Navigationspunkt, Punkt „Neuerungen“,
`padding-left: 50px`). Bis dahin prüfen Design-Review und Code-Review gegen
dieses Dokument.

Gemeinsame Vue-Bausteine (WerkPlus-Abschnitt, „Was ist neu?“-Fenster,
Einstellungsgerüst) erst, wenn alle Apps auf Vue 3 sind. WorkTime läuft noch
auf Vue 2.
