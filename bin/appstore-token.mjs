#!/usr/bin/env node
/**
 * nc-appstore-token — loest den App-Store-Token maschinell auf.
 *
 *   TOKEN="$(npx nc-appstore-token)" || exit 1
 *
 * ANLASS: rechnungswerk v0.5.1 (19.08.2026) wurde von Hand deployt statt in den
 * App Store geladen, weil die Umgebungsvariable NC_APPSTORE_TOKEN leer war und
 * daraus falsch geschlossen wurde, der Token liege "nicht auf dem Rechner".
 * Tatsaechlich lag er die ganze Zeit als Datei vor (~/.nextcloud/appstore-token)
 * — dieselbe Quelle, aus der alle Flotten-Apps ihren Upload speisen. Der Store-
 * Upload liess sich damit nachtraeglich problemlos abschliessen (nc-app-tooling#12).
 *
 * Die Regel "Token = Datei, Env nur Fallback" stand bis dahin nur als Prosa im
 * Release-Skill — und Prosa erodiert: die Vorgaenger-Fassung nannte sogar nur
 * die Env-Variable. Dieses Werkzeug macht die Aufloesung maschinell, damit der
 * Fehlschluss nicht wieder moeglich ist (dasselbe Muster wie nc-bundle-fresh
 * fuer nc-app-tooling#2).
 *
 * VERTRAG:
 * - Reihenfolge: zuerst die Datei ~/.nextcloud/appstore-token, dann die
 *   Umgebungsvariable NC_APPSTORE_TOKEN. Die Datei ist die verbindliche Quelle.
 * - Erfolg: der Token — und NUR der Token — geht auf stdout, damit
 *   `TOKEN="$(npx nc-appstore-token)"` sauber ist. Jede Diagnose geht auf stderr.
 * - Fehlt der Token in BEIDEN Quellen: exit 1 mit klarer Meldung auf stderr,
 *   statt still einen Leerwert zu liefern. Ein lautes Scheitern hier ist besser
 *   als ein stiller Hand-Deploy.
 * - Der Token-Wert selbst wird NIE geloggt (nur seine Herkunft und Laenge).
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const datei = join(homedir(), '.nextcloud', 'appstore-token')

let token = ''
let quelle = ''

// 1. Datei — die verbindliche Quelle. Fehlt sie, ist das kein Fehler: die Env
//    ist der Fallback. Deshalb wird der Lesefehler geschluckt.
try {
	const inhalt = readFileSync(datei, 'utf8').trim()
	if (inhalt) {
		token = inhalt
		quelle = datei
	}
} catch { /* Datei fehlt oder ist nicht lesbar — weiter zum Fallback */ }

// 2. Env-Fallback.
if (!token) {
	const inhalt = (process.env.NC_APPSTORE_TOKEN ?? '').trim()
	if (inhalt) {
		token = inhalt
		quelle = 'NC_APPSTORE_TOKEN'
	}
}

// 3. Beides leer — laut scheitern, nicht still leer liefern.
if (!token) {
	process.stderr.write(
		'FEHLER: App-Store-Token nicht gefunden.\n'
		+ `  Weder die Datei ${datei} noch die Umgebungsvariable NC_APPSTORE_TOKEN `
		+ 'enthaelt einen Wert.\n'
		+ '  Die Datei ist die verbindliche Quelle (mode 0600), die Env nur Fallback.\n',
	)
	process.exit(1)
}

process.stderr.write(
	`nc-appstore-token: Token aus ${quelle === datei ? 'Datei ' + datei : 'NC_APPSTORE_TOKEN'} `
	+ `(${token.length} Zeichen).\n`,
)
process.stdout.write(token + '\n')
