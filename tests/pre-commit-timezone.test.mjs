// Der Schritt greift nur in Apps mit dem Skript: sonst blockiert ein Tooling-Sprung jede App mit Bestand.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN, git, schreibe } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

const MIT_SKRIPT = JSON.stringify({ name: 'testapp', scripts: { 'timezone:check': 'nc-timezone-check' } })
const OHNE_SKRIPT = JSON.stringify({ name: 'testapp', scripts: {} })
const php = (zeile) => `<?php\nclass A {\n\tfunction f() {\n\t\t${zeile}\n\t}\n}\n`
const KALENDERTAG = php('$jahr = (int)date(\'Y\');')

function app({ paket = MIT_SKRIPT, werkzeug = true, dateien = { 'lib/Service/A.php': KALENDERTAG }, stage = Object.keys(dateien) }) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-pc-tz-'))
	angelegt.push(wurzel)
	git(wurzel, 'init', '-q')
	schreibe(wurzel, 'appinfo/info.xml', '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n')
	if (paket !== null) schreibe(wurzel, 'package.json', paket + '\n')
	if (werkzeug) {
		mkdirSync(join(wurzel, 'node_modules', '.bin'), { recursive: true })
		symlinkSync(join(BIN, 'timezone-check.mjs'), join(wurzel, 'node_modules', '.bin', 'nc-timezone-check'))
	}
	for (const [pfad, inhalt] of Object.entries(dateien)) schreibe(wurzel, pfad, inhalt)
	for (const pfad of stage) git(wurzel, 'add', pfad)
	return wurzel
}

const lauf = (wurzel) => spawnSync('node', [join(BIN, 'pre-commit.mjs')], { cwd: wurzel, encoding: 'utf8' })

test('mit Skript timezone:check blockiert ein Kalendertag aus UTC', () => {
	const ergebnis = lauf(app({}))
	assert.equal(ergebnis.status, 1, ergebnis.stdout)
	assert.match(ergebnis.stdout, /\[Timezone Check\] BLOCKED/)
})

test('ohne das Skript bleibt der Schritt aus', () => {
	const ergebnis = lauf(app({ paket: OHNE_SKRIPT }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr)
	assert.doesNotMatch(ergebnis.stdout, /[Tt]imezone/)
})

for (const [name, paket] of [['fehlendes', null], ['kaputtes', '{ kaputt'], ['leeres', 'null']]) {
	test(`${name} package.json laesst den Hook nicht abstuerzen`, () => {
		const ergebnis = lauf(app({ paket }))
		assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr)
		assert.equal(ergebnis.stderr, '')
		assert.doesNotMatch(ergebnis.stdout, /[Tt]imezone/)
	})
}

test('mit Skript und sauberem Code laeuft der Check wirklich und der Hook geht durch', () => {
	const ergebnis = lauf(app({ dateien: { 'lib/Service/A.php': php('$e->setCreatedAt(new DateTime());') } }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout)
	assert.match(ergebnis.stdout, /nc-timezone-check: keine Befunde/)
})

test('eine Datei unter src/ loest den Schritt aus', () => {
	const ergebnis = lauf(app({ dateien: { 'src/a.mts': 'export const tag = new Date().toISOString().slice(0, 10)\n' } }))
	assert.equal(ergebnis.status, 1, ergebnis.stdout)
	assert.match(ergebnis.stdout, /\[Timezone Check\] BLOCKED/)
})

test('ist nur eine andere Datei vorgemerkt, bleibt der Schritt aus', () => {
	const ergebnis = lauf(app({ dateien: { 'lib/Service/A.php': KALENDERTAG, 'README.md': 'x\n' }, stage: ['README.md'] }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout)
	assert.doesNotMatch(ergebnis.stdout, /[Tt]imezone/)
})

test('fehlt das Werkzeug, wird der Schritt mit Hinweis uebersprungen', () => {
	const ergebnis = lauf(app({ werkzeug: false }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout)
	assert.match(ergebnis.stdout, /\[Timezone Check\] uebersprungen/)
})
