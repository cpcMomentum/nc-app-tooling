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

function app({ skript, php }) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-pc-tz-'))
	angelegt.push(wurzel)
	git(wurzel, 'init', '-q')
	schreibe(wurzel, 'appinfo/info.xml', '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n')
	schreibe(wurzel, 'package.json', JSON.stringify({ name: 'testapp', scripts: skript ? { 'timezone:check': 'nc-timezone-check' } : {} }) + '\n')
	mkdirSync(join(wurzel, 'node_modules', '.bin'), { recursive: true })
	symlinkSync(join(BIN, 'timezone-check.mjs'), join(wurzel, 'node_modules', '.bin', 'nc-timezone-check'))
	schreibe(wurzel, 'lib/Service/A.php', `<?php\nclass A {\n\tfunction f() {\n\t\t${php}\n\t}\n}\n`)
	git(wurzel, 'add', 'lib/Service/A.php')
	return wurzel
}

const lauf = (wurzel) => spawnSync('node', [join(BIN, 'pre-commit.mjs')], { cwd: wurzel, encoding: 'utf8' })

test('mit Skript timezone:check blockiert ein Kalendertag aus UTC', () => {
	const ergebnis = lauf(app({ skript: true, php: '$jahr = (int)date(\'Y\');' }))
	assert.equal(ergebnis.status, 1, ergebnis.stdout)
	assert.match(ergebnis.stdout, /\[Timezone Check\] BLOCKED/)
})

test('ohne das Skript bleibt der Schritt aus', () => {
	const ergebnis = lauf(app({ skript: false, php: '$jahr = (int)date(\'Y\');' }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout)
	assert.doesNotMatch(ergebnis.stdout, /Timezone Check/)
})

test('mit Skript und sauberem Code laeuft der Hook durch', () => {
	const ergebnis = lauf(app({ skript: true, php: '$e->setCreatedAt(new DateTime());' }))
	assert.equal(ergebnis.status, 0, ergebnis.stdout)
})
