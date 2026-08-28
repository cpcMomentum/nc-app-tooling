/**
 * nc-appstore-token — Abnahme aus nc-app-tooling#12.
 *
 * Der Kern des Vorfalls (rechnungswerk v0.5.1): die Env war leer, daraus wurde
 * falsch "Token fehlt" geschlossen, obwohl die Datei vorlag. Diese Tests binden
 * beide Wahrheiten (Datei vor Env) und den harten Abbruch fest.
 *
 * Eigene Aufruf-Form statt lauf(): der Resolver arbeitet nicht auf einem
 * App-Ordner, sondern auf HOME und Env — und die Tests muessen stdout und
 * stderr GETRENNT sehen, weil der Vertrag lautet: nur der Token auf stdout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

/**
 * Ruft den Resolver mit kontrolliertem HOME und Env auf.
 * @param dateiInhalt  Inhalt von $HOME/.nextcloud/appstore-token, oder null = keine Datei
 * @param envWert      Wert von NC_APPSTORE_TOKEN, oder null = nicht gesetzt
 */
function resolver({ dateiInhalt = null, envWert = null } = {}) {
	const home = mkdtempSync(join(tmpdir(), 'nc-tooling-token-'))
	angelegt.push(home)
	if (dateiInhalt !== null) {
		mkdirSync(join(home, '.nextcloud'), { recursive: true })
		writeFileSync(join(home, '.nextcloud', 'appstore-token'), dateiInhalt)
	}
	// Env explizit aufbauen — NIE das echte NC_APPSTORE_TOKEN erben, sonst
	// waeren die Tests nicht hermetisch.
	const env = { ...process.env, HOME: home, NO_COLOR: '1' }
	delete env.NC_APPSTORE_TOKEN
	if (envWert !== null) env.NC_APPSTORE_TOKEN = envWert

	const r = spawnSync('node', [join(BIN, 'appstore-token.mjs')], { encoding: 'utf8', env })
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// --- Der Vorfall ------------------------------------------------------------

test('Gegenprobe rechnungswerk v0.5.1: Env leer, Datei liegt vor → Token kommt aus der Datei', () => {
	const { code, stdout } = resolver({ dateiInhalt: 'abc123token\n', envWert: '' })
	assert.equal(code, 0)
	assert.equal(stdout.trim(), 'abc123token')
})

test('Falsch-Positiv-Test: gar nichts gesetzt → exit 1, keine leere Ausgabe', () => {
	const { code, stdout, stderr } = resolver({ dateiInhalt: null, envWert: null })
	assert.equal(code, 1)
	assert.equal(stdout, '')
	assert.match(stderr, /nicht gefunden/i)
})

// --- Der Vertrag ------------------------------------------------------------

test('Datei schlaegt Env (Datei-first)', () => {
	const { code, stdout } = resolver({ dateiInhalt: 'aus-datei', envWert: 'aus-env' })
	assert.equal(code, 0)
	assert.equal(stdout.trim(), 'aus-datei')
})

test('Env-Fallback, wenn keine Datei da ist', () => {
	const { code, stdout } = resolver({ dateiInhalt: null, envWert: 'aus-env' })
	assert.equal(code, 0)
	assert.equal(stdout.trim(), 'aus-env')
})

test('leere/whitespace-Datei zaehlt nicht — faellt auf Env zurueck', () => {
	const { code, stdout } = resolver({ dateiInhalt: '   \n\t', envWert: 'aus-env' })
	assert.equal(code, 0)
	assert.equal(stdout.trim(), 'aus-env')
})

test('Whitespace wird getrimmt', () => {
	const { stdout } = resolver({ dateiInhalt: '  token-mit-rand  \n' })
	assert.equal(stdout.trim(), 'token-mit-rand')
})

test('nur der Token auf stdout — Diagnose ausschliesslich auf stderr', () => {
	const { stdout, stderr } = resolver({ dateiInhalt: 'genau-das\n' })
	// stdout ist exakt der Token plus ein abschliessendes Newline, nichts sonst.
	assert.equal(stdout, 'genau-das\n')
	// Die Herkunft steht auf stderr, nicht auf stdout.
	assert.match(stderr, /nc-appstore-token: Token aus Datei/)
})

test('der Token-Wert selbst wird nie geloggt (nur Herkunft und Laenge)', () => {
	const geheim = 'streng-geheimer-wert-42'
	const { stderr } = resolver({ dateiInhalt: geheim })
	assert.ok(!stderr.includes(geheim), 'stderr darf den Token-Wert nicht enthalten')
	assert.match(stderr, new RegExp(`${geheim.length} Zeichen`))
})
