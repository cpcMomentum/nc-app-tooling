#!/usr/bin/env node
/**
 * ocp-versionen — leitet die zu testenden nextcloud/ocp-Versionen aus
 * appinfo/info.xml ab und filtert sie nach der PHP-Version des Jobs.
 *
 *   PHPV=8.2 node ocp-versionen.mjs      # im Wurzelverzeichnis der App
 *
 * ANLASS (nc-app-tooling#28, aus contractmanager#414/#416): NC 35 laesst PHP 8.2
 * fallen (nextcloud/ocp v35 verlangt ~8.3 || ~8.4 || ~8.5). Die Apps pinnen
 * config.platform.php aber auf ihre eigene Untergrenze (8.2), damit das
 * ausgelieferte vendor/ dort laeuft. Fuer den Testlauf ist der Pin falsch:
 * ohne diesen Filter scheitert der Job "PHP 8.2" schon an der composer-
 * Aufloesung — genau die Fehldiagnose, die nc-compat als "API-Aenderung in
 * NC 35" gemeldet hat. Der Fix lief zuerst als Inline-Bash in contractmanager;
 * dieses Werkzeug hebt ihn ins Tooling, statt ihn in fuenf Apps zu kopieren.
 *
 * EINGABE: PHP-Version des Jobs ueber die Umgebungsvariable PHPV (z.B. 8.2).
 * Bewusst ueber env, nicht per ${{ }}-Interpolation ins Skript: info.xml ist in
 * einem PR aenderbar, direkte Interpolation waere eine Script-Injection-Luecke.
 *
 * AUSGABE: Schluessel=Wert auf stdout und, falls in GitHub Actions, in
 * $GITHUB_OUTPUT — damit die bestehende Testschleife daran haengen kann:
 *   ocp=^32.0 ^33.0 ^34.0            (leerzeichengetrennt)
 *   uebersprungen=^35.0 (braucht PHP >= 8.3)
 * Diagnose geht auf stderr. Exit 1 nur, wenn die Ableitung selbst scheitert
 * (kein info.xml/min-max, Packagist nicht erreichbar, leere Ergebnisliste).
 *
 * QUELLE der PHP-Untergrenzen: die require.php der jeweiligen nextcloud/ocp-
 * Version auf Packagist — gelesen wird die kleinste dort genannte Version, was
 * gegen die Schreibweise (~8.3, >=8.3, ^8.3) unempfindlich ist. Fuer Tests
 * laesst sich die Antwort per OCP_PACKAGIST_FILE aus einer lokalen Datei
 * ziehen, damit die Faelle netzfrei und deterministisch laufen.
 */

import { readFileSync, appendFileSync } from 'node:fs'

const PACKAGIST = 'https://repo.packagist.org/p2/nextcloud/ocp.json'

/** Beendet mit einer GitHub-Annotation und Exit 1. */
function fehler(text) {
	process.stderr.write(`::error::${text}\n`)
	process.exit(1)
}

// --- PHP-Version des Jobs ----------------------------------------------------
const phpv = (process.env.PHPV ?? '').trim()
if (!phpv) {
	fehler('Keine PHP-Version — PHPV ist nicht gesetzt (php-version-Eingabe der Action).')
}

// --- min/max-version aus info.xml -------------------------------------------
let info
try {
	info = readFileSync('appinfo/info.xml', 'utf8')
} catch {
	fehler('appinfo/info.xml nicht gefunden — hier ist kein App-Verzeichnis.')
}
const minTreffer = info.match(/<nextcloud[^>]*\bmin-version="(\d+)"/)
const maxTreffer = info.match(/<nextcloud[^>]*\bmax-version="(\d+)"/)
if (!minTreffer || !maxTreffer) {
	fehler('Konnte min/max-version nicht aus info.xml lesen (<nextcloud min-version="…" max-version="…"/>).')
}
const min = Number(minTreffer[1])
const max = Number(maxTreffer[1])

// --- Packagist-Antwort holen (netzfreier Test-Seam) -------------------------
async function packagist() {
	const datei = process.env.OCP_PACKAGIST_FILE
	if (datei) {
		// Test-Seam: lokale Fixture statt Netz. Fehlt sie, ist das derselbe
		// Fall wie "Packagist nicht erreichbar" — hart scheitern, nicht still
		// alles ueberspringen.
		return JSON.parse(readFileSync(datei, 'utf8'))
	}
	const antwort = await fetch(PACKAGIST, { headers: { 'User-Agent': 'nc-app-tooling ocp-versionen' } })
	if (!antwort.ok) throw new Error(`Packagist HTTP ${antwort.status}`)
	return antwort.json()
}

let daten
try {
	daten = await packagist()
} catch (e) {
	fehler(`Packagist nicht erreichbar — PHP-Untergrenzen nicht ermittelbar (${e.message}).`)
}
const versionen = daten?.packages?.['nextcloud/ocp'] ?? []

/**
 * PHP-Untergrenze einer ocp-Version: kleinste in require.php genannte x.y.
 * Leerer String, wenn Packagist die Version nicht kennt oder sie kein php
 * fordert — dann wird sie eingeschlossen (s.u.).
 */
function untergrenze(major) {
	const re = new RegExp(`^v?${major}\\.\\d+\\.\\d+$`)
	// Packagist listet neueste zuerst; die erste passende ist die aktuellste
	// vMAJOR.MINOR.PATCH dieses Majors.
	const treffer = versionen.find((v) => re.test(String(v.version ?? '')))
	const req = treffer?.require?.php ?? ''
	const teile = String(req).match(/\d+\.\d+/g) ?? []
	return teile.sort(vergleich)[0] ?? ''
}

/** Vergleicht x.y-Versionen numerisch (nicht als String: 8.10 > 8.9). */
function vergleich(a, b) {
	const [ax, ay] = a.split('.').map(Number)
	const [bx, by] = b.split('.').map(Number)
	return ax - bx || ay - by
}

// --- ableiten und filtern ----------------------------------------------------
const ocp = []
const uebersprungen = []
for (let v = min; v <= max; v++) {
	const floor = untergrenze(v)
	// Unbekannte Version (floor leer) wird EINGESCHLOSSEN, nicht uebersprungen:
	// sie scheitert dann laut am composer require, statt lautlos zu verschwinden.
	if (!floor || vergleich(floor, phpv) <= 0) {
		ocp.push(`^${v}.0`)
	} else {
		uebersprungen.push(`^${v}.0 (braucht PHP >= ${floor})`)
	}
}

if (ocp.length === 0) {
	fehler(`Keine ocp-Version laeuft auf PHP ${phpv} — Matrix und info.xml passen nicht zusammen.`)
}

// --- melden ------------------------------------------------------------------
const paare = {
	ocp: ocp.join(' '),
	uebersprungen: uebersprungen.join(' '),
}
const zeilen = Object.entries(paare).map(([k, v]) => `${k}=${v}`)
process.stdout.write(zeilen.join('\n') + '\n')
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, zeilen.join('\n') + '\n')
}
process.stderr.write(`Abgeleitete ocp-Versionen fuer PHP ${phpv}: ${paare.ocp}\n`)
if (uebersprungen.length) {
	process.stderr.write(`Uebersprungen: ${paare.uebersprungen}\n`)
}
