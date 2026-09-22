/**
 * ocp-versionen — Abnahme aus nc-app-tooling#28.
 *
 * Hermetisch: die Packagist-Antwort kommt im Test aus einer Fixture-Datei
 * (OCP_PACKAGIST_FILE) statt aus dem Netz, damit die Faelle ohne Netz und
 * deterministisch laufen. Geprueft wird die ENTSCHEIDUNG (welche ocp-Versionen
 * je PHP) und das Maschinenformat (stdout + $GITHUB_OUTPUT), auf das der
 * Workflow baut.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HIER = dirname(fileURLToPath(import.meta.url))
const ACTION = join(HIER, '..', '.github', 'actions', 'ocp-versionen', 'ocp-versionen.mjs')

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

/** Wegwerf-App mit gegebener min/max-version. */
function app({ min = 32, max = 35, id = 'testapp', ohneMax = false } = {}) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-ocp-'))
	angelegt.push(wurzel)
	mkdirSync(join(wurzel, 'appinfo'), { recursive: true })
	const nc = ohneMax
		? `<nextcloud min-version="${min}"/>`
		: `<nextcloud min-version="${min}" max-version="${max}"/>`
	writeFileSync(join(wurzel, 'appinfo', 'info.xml'),
		`<?xml version="1.0"?>\n<info>\n\t<id>${id}</id>\n\t<dependencies>\n\t\t${nc}\n\t</dependencies>\n</info>\n`)
	return wurzel
}

/**
 * Packagist-Fixture in eine Wegwerf-Datei schreiben. Bewusst neueste-zuerst und
 * mit einem RC vor der stabilen v35: der Test belegt damit, dass die kleinste
 * PHP-Untergrenze aus der neuesten STABILEN Version je Major kommt (-RC wird
 * ignoriert). Nur die PHP-Untergrenzen sind hier relevant.
 */
function packagist() {
	const p = (php) => ({ require: { php } })
	const daten = {
		packages: {
			'nextcloud/ocp': [
				{ version: 'dev-master', ...p('~8.3 || ~8.4 || ~8.5') },
				{ version: 'v35.0.0-RC1', ...p('~8.4 || ~8.5') },   // muss ignoriert werden
				{ version: 'v35.0.0', ...p('~8.3 || ~8.4 || ~8.5') }, // floor 8.3
				{ version: 'v34.0.1', ...p('~8.2 || ~8.3 || ~8.4 || ~8.5') }, // floor 8.2
				{ version: 'v34.0.0', ...p('~8.2 || ~8.3') },
				{ version: 'v33.0.0', ...p('~8.1 || ~8.2 || ~8.3 || ~8.4') }, // floor 8.1
				{ version: 'v32.0.0', ...p('~8.1 || ~8.2 || ~8.3 || ~8.4') }, // floor 8.1
			],
		},
	}
	const datei = join(mkdtempSync(join(tmpdir(), 'nc-tooling-pkg-')), 'ocp.json')
	angelegt.push(dirname(datei))
	writeFileSync(datei, JSON.stringify(daten))
	return datei
}

/** Ruft ocp-versionen.mjs mit PHP-Version, Packagist-Fixture und optionalem $GITHUB_OUTPUT. */
function lauf(wurzel, { php = null, fixture = packagist(), githubOutput = null, ohneFixture = false } = {}) {
	const env = { ...process.env, NO_COLOR: '1' }
	delete env.GITHUB_OUTPUT
	delete env.PHPV
	if (php !== null) env.PHPV = String(php)
	if (!ohneFixture) env.OCP_PACKAGIST_FILE = fixture
	if (githubOutput) env.GITHUB_OUTPUT = githubOutput
	const r = spawnSync('node', [ACTION], { cwd: wurzel, encoding: 'utf8', env })
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const zeile = (stdout, key) => (stdout.match(new RegExp(`^${key}=(.*)$`, 'm')) ?? [])[1]

// --- Die Entscheidung -------------------------------------------------------

test('PHP 8.2: NC 35 faellt raus (braucht 8.3), Rest bleibt', () => {
	const { code, stdout, stderr } = lauf(app({ min: 32, max: 35 }), { php: '8.2' })
	assert.equal(code, 0)
	assert.equal(zeile(stdout, 'ocp'), '^32.0 ^33.0 ^34.0')
	assert.equal(zeile(stdout, 'uebersprungen'), '^35.0 (braucht PHP >= 8.3)')
	assert.match(stderr, /Uebersprungen: \^35\.0 \(braucht PHP >= 8\.3\)/)
})

test('PHP 8.5: alle vier Versionen laufen', () => {
	const { code, stdout } = lauf(app({ min: 32, max: 35 }), { php: '8.5' })
	assert.equal(code, 0)
	assert.equal(zeile(stdout, 'ocp'), '^32.0 ^33.0 ^34.0 ^35.0')
	assert.equal(zeile(stdout, 'uebersprungen'), '')
})

test('PHP 8.3: NC 35 laeuft gerade noch (floor == PHP)', () => {
	const { stdout } = lauf(app({ min: 34, max: 35 }), { php: '8.3' })
	assert.equal(zeile(stdout, 'ocp'), '^34.0 ^35.0')
	assert.equal(zeile(stdout, 'uebersprungen'), '')
})

// --- Randfaelle aus dem Issue -----------------------------------------------

test('im Bereich liegende, aber Packagist-unbekannte Version -> Exit 1', () => {
	// max-version 99 kennt Packagist nicht. Das ist ein Fehler, kein "keine
	// Einschraenkung": sonst faellt der Filter still auf ungefiltert zurueck
	// (Tag-Schreibweise geaendert?). Uebernommen aus worktime/vinarium.
	const { code, stderr } = lauf(app({ min: 99, max: 99 }), { php: '8.5' })
	assert.equal(code, 1)
	assert.match(stderr, /::error::/)
	assert.match(stderr, /kennt keine Freigabe nextcloud\/ocp 99\.x/)
	assert.match(stderr, /Tag-Schreibweise geaendert/)
})

test('gefunden, aber ohne php-Anforderung -> eingeschlossen', () => {
	// v40.0.0 steht auf Packagist, fordert aber kein php -> laeuft ueberall.
	// Das ist NICHT derselbe Fall wie "unbekannt": gefunden heisst gefunden.
	const p = (php) => ({ require: { php } })
	const daten = {
		packages: {
			'nextcloud/ocp': [
				{ version: 'v40.0.0' },                 // kein require -> floor leer
				{ version: 'v39.0.0', ...p('~8.4') },
			],
		},
	}
	const datei = join(mkdtempSync(join(tmpdir(), 'nc-tooling-pkg-')), 'ocp.json')
	angelegt.push(dirname(datei))
	writeFileSync(datei, JSON.stringify(daten))

	const { code, stdout } = lauf(app({ min: 40, max: 40 }), { php: '8.5', fixture: datei })
	assert.equal(code, 0)
	assert.equal(zeile(stdout, 'ocp'), '^40.0')
})

test('leere Ergebnisliste -> Exit 1 (Matrix und info.xml passen nicht)', () => {
	// PHP 8.2, aber nur NC 35 im Bereich (braucht 8.3) -> nichts laeuft.
	const { code, stderr } = lauf(app({ min: 35, max: 35 }), { php: '8.2' })
	assert.equal(code, 1)
	assert.match(stderr, /::error::/)
	assert.match(stderr, /passen nicht zusammen/)
})

// --- Fehlerfaelle -----------------------------------------------------------

test('keine max-version in info.xml -> Exit 1', () => {
	const { code, stderr } = lauf(app({ ohneMax: true }), { php: '8.2' })
	assert.equal(code, 1)
	assert.match(stderr, /min\/max-version/)
})

test('kein App-Verzeichnis -> Exit 1', () => {
	const leer = mkdtempSync(join(tmpdir(), 'nc-tooling-leer-'))
	angelegt.push(leer)
	const { code, stderr } = lauf(leer, { php: '8.2' })
	assert.equal(code, 1)
	assert.match(stderr, /kein App-Verzeichnis/)
})

test('PHPV nicht gesetzt -> Exit 1', () => {
	const { code, stderr } = lauf(app(), { php: null })
	assert.equal(code, 1)
	assert.match(stderr, /PHPV/)
})

test('Packagist nicht erreichbar (Fixture fehlt) -> Exit 1', () => {
	const fehlt = join(tmpdir(), 'gibt-es-nicht-ocp.json')
	const { code, stderr } = lauf(app(), { php: '8.2', fixture: fehlt })
	assert.equal(code, 1)
	assert.match(stderr, /Packagist nicht erreichbar/)
})

// --- Das Maschinenformat ----------------------------------------------------

test('schreibt ocp/uebersprungen auch nach $GITHUB_OUTPUT', () => {
	const out = join(mkdtempSync(join(tmpdir(), 'nc-tooling-ghout-')), 'out.txt')
	angelegt.push(dirname(out))
	lauf(app({ min: 32, max: 35 }), { php: '8.2', githubOutput: out })
	const inhalt = readFileSync(out, 'utf8')
	assert.match(inhalt, /^ocp=\^32\.0 \^33\.0 \^34\.0$/m)
	assert.match(inhalt, /^uebersprungen=\^35\.0 \(braucht PHP >= 8\.3\)$/m)
})
