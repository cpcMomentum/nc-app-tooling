#!/usr/bin/env node
/**
 * nc-compat-check — meldet, wenn ein neues Nextcloud-Major ueber der
 * max-version der App erschienen ist.
 *
 *   npx nc-compat-check          # im Wurzelverzeichnis der App
 *
 * ANLASS (nc-app-tooling#17, aus #13): Nextcloud released 2x/Jahr ein neues
 * Major. Bisher wird die max-version in info.xml von Hand nachgezogen — leicht
 * zu vergessen, und ein Bump ohne Test ist eine ungepruefte Zusage. Dieses
 * Werkzeug ist der ERKENNUNGS-Schritt eines geplanten Workflows: es sagt, OB
 * ein neues Major da ist und WELCHES. Der Workflow testet dann die App gegen
 * dessen nextcloud/ocp-Stubs und macht daraus einen PR (gruen) oder ein Issue
 * (rot) — die Zusage wird geprueft, nicht geraten.
 *
 * BEWUSST NUR ERKENNUNG: das Bauen/Testen und das Anlegen von PR/Issue braucht
 * PHP, composer und gh — das gehoert in den Workflow, nicht in dieses Tool.
 * Hier steht die eine Wahrheit "gibt es ein neues Major, und welches".
 *
 * QUELLE der neuesten NC-Version: die nextcloud/ocp-Versionen auf Packagist —
 * genau das Paket, gegen dessen Stubs getestet wird. Stabile Releases sind
 * `vMAJOR.MINOR.PATCH`; dev-stableXX-Branches werden ignoriert. Fuer Tests (und
 * manuelle Laeufe) laesst sich die Antwort per NC_COMPAT_LATEST_MAJOR
 * ueberschreiben, damit die Faelle hermetisch pruefbar sind.
 *
 * AUSGABE: Schluessel=Wert auf stdout und, falls in GitHub Actions, in
 * $GITHUB_OUTPUT — damit ein `if: steps.x.outputs.neu != ''` daran haengen kann:
 *   neu=            (leer) oder neu=35
 *   constraint=     (leer) oder constraint=^35.0
 * Diagnose geht auf stderr. Exit 0 auch bei "nichts zu tun" — ein neues Major
 * ist kein Fehler. Exit 1 nur, wenn die Erkennung selbst scheitert
 * (kein info.xml, Packagist nicht erreichbar).
 */

import { readFileSync, appendFileSync } from 'node:fs'

const PACKAGIST = 'https://repo.packagist.org/p2/nextcloud/ocp.json'

// --- info.xml der App lesen -------------------------------------------------
let info
try {
	info = readFileSync('appinfo/info.xml', 'utf8')
} catch {
	process.stderr.write('FEHLER: appinfo/info.xml nicht gefunden — hier ist kein App-Verzeichnis.\n')
	process.exit(1)
}
const idTreffer = info.match(/<id>([^<]+)<\/id>/)
const appId = idTreffer ? idTreffer[1].trim() : '(unbekannt)'
const maxTreffer = info.match(/<nextcloud[^>]*\bmax-version="(\d+)"/)
if (!maxTreffer) {
	process.stderr.write('FEHLER: keine max-version in info.xml (<nextcloud max-version="…"/>).\n')
	process.exit(1)
}
const maxVersion = Number(maxTreffer[1])

// --- neuestes stabiles NC-Major bestimmen -----------------------------------
async function neuestesMajor() {
	const override = process.env.NC_COMPAT_LATEST_MAJOR
	if (override) return Number(override)

	const antwort = await fetch(PACKAGIST, { headers: { 'User-Agent': 'nc-compat-check' } })
	if (!antwort.ok) throw new Error(`Packagist HTTP ${antwort.status}`)
	const daten = await antwort.json()
	const versionen = daten?.packages?.['nextcloud/ocp'] ?? []
	let hoechstes = 0
	for (const v of versionen) {
		// nur stabile vMAJOR.MINOR.PATCH — dev-*, -RC, -beta ignorieren
		const m = String(v.version ?? '').match(/^v?(\d+)\.\d+\.\d+$/)
		if (m) hoechstes = Math.max(hoechstes, Number(m[1]))
	}
	if (!hoechstes) throw new Error('keine stabile nextcloud/ocp-Version gefunden')
	return hoechstes
}

let latest
try {
	latest = await neuestesMajor()
} catch (e) {
	process.stderr.write(`FEHLER: neueste NC-Version nicht bestimmbar — ${e.message}\n`)
	process.exit(1)
}

// --- vergleichen und melden -------------------------------------------------
function melde(paare) {
	const zeilen = Object.entries(paare).map(([k, v]) => `${k}=${v}`)
	process.stdout.write(zeilen.join('\n') + '\n')
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, zeilen.join('\n') + '\n')
}

if (latest > maxVersion) {
	process.stderr.write(
		`nc-compat-check: ${appId} — NC ${latest} ist erschienen, max-version steht auf ${maxVersion}. `
		+ `Kompatibilitaet gegen NC ${latest} pruefen.\n`,
	)
	melde({ neu: latest, constraint: `^${latest}.0` })
} else {
	process.stderr.write(
		`nc-compat-check: ${appId} — aktuell (max-version=${maxVersion}, neuestes NC=${latest}). Nichts zu tun.\n`,
	)
	melde({ neu: '', constraint: '' })
}
