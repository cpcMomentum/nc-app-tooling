# Wie eine App auf die Produktiv-Instanz kommt

Stand 15.08.2026. Grundlage für nc-app-tooling#3. Gedacht zur Weitergabe an die
Server-Instanz.

## Ausgangslage, gemessen

Abfrage der App-Store-API am 15.08.2026 (`apps.nextcloud.com/api/v1/platform/<v>/apps.json`):

| App | im Store | dort neueste | lokal | Zertifikat |
|---|---|---|---|---|
| contractmanager | ja | 1.3.0 | 1.3.0 | vorhanden |
| worktime | ja | 0.15.3 | 0.15.3 | vorhanden |
| rechnungswerk | ja | 0.5.0 | 0.5.0 | vorhanden |
| vinarium | ja | 0.5.2 | 0.5.2 | vorhanden |
| **projektwerk** | **nein** | — | 0.3.0 | **fehlt** |

Vier von fünf Apps gehen den Store-Weg und sind dort auf dem lokalen Stand.
ProjektWerk kann diesen Weg heute nicht gehen: der Zertifikatsantrag
[nextcloud/app-certificate-requests#1144](https://github.com/nextcloud/app-certificate-requests/pull/1144)
ist seit dem 11.08.2026 **offen**, und ohne `.crt` gibt es keine Signatur und
damit keinen Store-Upload. ProjektWerk hat ausserdem noch keinen Tag und alles
im CHANGELOG steht unter `[Unreleased]`.

Die Produktiv-Instanz ist Nextcloud AIO auf dem Hetzner-VPS. Der App-Ordner ist
das Docker-Volume `nextcloud_aio_nextcloud`, darin `_data/custom_apps`.

## Die vier Wege, und was sie taugen

### 1. App Store — der Regelweg

Der Release-Skill baut, signiert, prüft (15 Checks) und lädt hoch. Auf der
Instanz kommt das Update im Admin-Bereich an, `occ app:update <app>` zieht es.

Das ist der einzige Weg, auf dem die **Integritätsprüfung** von Nextcloud
trägt: `signature.json` liegt im Tarball, das Zertifikat ist von Nextcloud
gegengezeichnet, und der Nutzer sieht in der Admin-Übersicht, ob die
Installation unversehrt ist. Alles andere umgeht sie.

Kosten: eine Version pro Auslieferung, und der Store-Cache braucht manchmal
einen Moment. Beides ist bekannt und im Skill beschrieben.

**Für alles ausser ProjektWerk: dieser Weg, ohne Ausnahme.**

### 2. Signierter Release-Tarball von Hand entpacken

Der offizielle Weg für Apps, die (noch) nicht im Store sind. Die AIO-Doku sagt
dazu: Apps, die es im Store nicht gibt, kommen direkt in das App-Verzeichnis,
bei AIO also nach
`/var/lib/docker/volumes/nextcloud_aio_nextcloud/_data/custom_apps/`.

Wichtig ist der Unterschied zum heutigen rsync: ausgeliefert wird der
**Release-Tarball**, also genau der Stand, der Build, Signierung und alle 15
Checks durchlaufen hat. Kein Arbeitsbaum, kein „was gerade dalag".

```bash
# auf dem Server, Tarball liegt bereits dort
docker exec nextcloud-aio-nextcloud rm -rf /var/www/html/custom_apps/<app>
tar xzf <app>-vX.Y.Z.tar.gz -C /var/lib/docker/volumes/nextcloud_aio_nextcloud/_data/custom_apps/
docker exec nextcloud-aio-nextcloud chown -R www-data:www-data /var/www/html/custom_apps/<app>
docker exec -u www-data nextcloud-aio-nextcloud php occ app:enable <app>
docker exec -u www-data nextcloud-aio-nextcloud php occ upgrade
docker restart nextcloud-aio-nextcloud      # OPcache
```

Ohne Zertifikat ist der Tarball unsigniert. Die App läuft, aber die
Integritätsprüfung kennt sie nicht. Das ist für eine noch nicht
zertifizierte App der erwartete Zustand und kein Fehler.

**Für ProjektWerk, bis #1144 gemergt ist: dieser Weg.**

### 3. rsync aus dem Arbeitsbaum — was das Skript heute tut

`deploy-nc-app.sh` synchronisiert den lokalen Arbeitsbaum direkt in das
Volume. Kein Build, keine Signatur, keine Checks. Es zeigt Branch, „dirty" und
„behind" an und bricht ausdrücklich nicht ab (`:101-104`).

Das ist der Punkt aus nc-app-tooling#3: ausgeliefert wird das `js/` und `css/`,
das gerade im Ordner liegt, egal wie alt. Genau die Lücke, die
`nc-bundle-fresh` beim Release schliesst.

Berechtigt bleibt der Weg für **einen bewussten Zwischenstand zum Testen** —
dafür wurde er gebaut, und dafür soll er bleiben. Er darf nur nicht der Weg
sein, auf dem eine Version dauerhaft auf Produktiv landet.

Was #3 daran ändern sollte:

- vor dem rsync bauen, bei Build-Fehler abbrechen
- ist der Arbeitsbaum nach dem Build schmutzig, war das Bundle veraltet: melden
  und entscheiden lassen
- ProjektWerk und Vinarium fehlen in `VALID_APPS`

### 4. Eigener App Store — verworfen

Nextcloud unterstützt einen selbst gehosteten Store:

```php
'appstoreenabled' => true,
'appstoreurl' => 'https://mein.store/v1',
```

Nextcloud holt von dort `apps.json` und `categories.json`. Technisch tragfähig,
aber es ist eine eigene Django-Anwendung samt Betrieb, Zertifikatskette und
Pflege — für fünf Apps, von denen vier bereits im offiziellen Store stehen,
steht das in keinem Verhältnis. Ausserdem gilt die Einstellung
instanzweit: die Instanz sähe dann den offiziellen Store nicht mehr.

## Empfehlung

1. **Regelweg bleibt der App Store.** Vier Apps tun das bereits.
2. **ProjektWerk über Weg 2** (signierter Release-Tarball, entpackt), bis #1144
   gemergt ist. Danach sofort auf Weg 1 umstellen.
3. **#1144 anstossen.** Der Antrag liegt seit dem 11.08. ohne Bewegung. Ohne
   ihn bleibt ProjektWerk dauerhaft am Sonderweg.
4. **Weg 3 behalten, aber härten** (#3). Er ist das Werkzeug für Zwischenstände,
   nicht für Auslieferungen.

Damit gilt in jedem Fall derselbe Satz: auf Produktiv geht nur, was gebaut und
geprüft wurde. Der Unterschied zwischen Weg 1 und Weg 2 ist nur, wer den
Tarball verteilt.

## Quellen

- [Nextcloud Admin Manual — Apps Management](https://docs.nextcloud.com/server/stable/admin_manual/apps_management.html)
- [config.sample.php — appstoreurl, appstoreenabled, apps_paths](https://github.com/nextcloud/server/blob/master/config/config.sample.php)
- [nextcloud/all-in-one — Apps ausserhalb des Stores installieren (Discussion #1287)](https://github.com/nextcloud/all-in-one/discussions/1287)
- [app-certificate-requests#1144 — ProjektWerk](https://github.com/nextcloud/app-certificate-requests/pull/1144)
