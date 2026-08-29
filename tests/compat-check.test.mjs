/**
 * nc-compat-check — Abnahme aus nc-app-tooling#17.
 *
 * Hermetisch: die neueste NC-Version kommt im Test aus NC_COMPAT_LATEST_MAJOR
 * statt von Packagist, damit die Faelle ohne Netz und deterministisch laufen.
 * Geprueft wird die ENTSCHEIDUNG (neu vs. nichts zu tun) und das
 * Maschinenformat (stdout + $GITHUB_OUTPUT), auf das der Workflow baut.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

/** Wegwerf-App mit gegebener min/max-version. */
function app({ min = 32, max = 34, id = 'testapp', ohneMax = false } = {}) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-compat-'))
	angelegt.push(wurzel)
	mkdirSync(join(wurzel, 'appinfo'), { recursive: true })
	const nc = ohneMax
		? `<nextcloud min-version="${min}"/>`
		: `<nextcloud min-version="${min}" max-version="${max}"/>`
	writeFileSync(join(wurzel, 'appinfo', 'info.xml'),
		`<?xml version="1.0"?>\n<info>\n\t<id>${id}</id>\n\t<dependencies>\n\t\t${nc}\n\t</dependencies>\n</info>\n`)
	return wurzel
}

/** Ruft compat-check mit kontrolliertem "neuestem Major" und optionalem GITHUB_OUTPUT. */
function lauf(wurzel, { latest = null, githubOutput = null } = {}) {
	const env = { ...process.env, NO_COLOR: '1' }
	delete env.GITHUB_OUTPUT
	if (latest !== null) env.NC_COMPAT_LATEST_MAJOR = String(latest)
	if (githubOutput) env.GITHUB_OUTPUT = githubOutput
	const r = spawnSync('node', [join(BIN, 'compat-check.mjs')], { cwd: wurzel, encoding: 'utf8', env })
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// --- Die Entscheidung -------------------------------------------------------

test('aktuell: neuestes NC == max-version → neu leer, nichts zu tun', () => {
	const { code, stdout, stderr } = lauf(app({ max: 34 }), { latest: 34 })
	assert.equal(code, 0)
	assert.match(stdout, /^neu=\s*$/m)
	assert.match(stderr, /Nichts zu tun/)
})

test('neues Major: NC 35 > max-version 34 → neu=35, constraint=^35.0', () => {
	const { code, stdout, stderr } = lauf(app({ max: 34 }), { latest: 35 })
	assert.equal(code, 0)
	assert.match(stdout, /^neu=35$/m)
	assert.match(stdout, /^constraint=\^35\.0$/m)
	assert.match(stderr, /NC 35 ist erschienen/)
})

test('mehrere hinterher: max-version 33, neuestes 34 → neu=34', () => {
	const { stdout } = lauf(app({ max: 33 }), { latest: 34 })
	assert.match(stdout, /^neu=34$/m)
})

test('aeltere App laeuft NICHT rueckwaerts: max 34, neuestes 32 → nichts zu tun', () => {
	const { stdout } = lauf(app({ max: 34 }), { latest: 32 })
	assert.match(stdout, /^neu=\s*$/m)
})

// --- Das Maschinenformat ----------------------------------------------------

test('schreibt neu/constraint auch nach $GITHUB_OUTPUT', () => {
	const out = join(mkdtempSync(join(tmpdir(), 'nc-tooling-ghout-')), 'out.txt')
	angelegt.push(out)
	lauf(app({ max: 34 }), { latest: 35, githubOutput: out })
	const inhalt = readFileSync(out, 'utf8')
	assert.match(inhalt, /neu=35/)
	assert.match(inhalt, /constraint=\^35\.0/)
})

// --- Fehlerfaelle -----------------------------------------------------------

test('kein App-Verzeichnis → exit 1', () => {
	const leer = mkdtempSync(join(tmpdir(), 'nc-tooling-leer-'))
	angelegt.push(leer)
	const { code, stderr } = lauf(leer, { latest: 34 })
	assert.equal(code, 1)
	assert.match(stderr, /kein App-Verzeichnis/)
})

test('keine max-version in info.xml → exit 1', () => {
	const { code, stderr } = lauf(app({ ohneMax: true }), { latest: 34 })
	assert.equal(code, 1)
	assert.match(stderr, /keine max-version/)
})
