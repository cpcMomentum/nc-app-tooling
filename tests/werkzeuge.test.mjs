/**
 * Was jedes Werkzeug erfuellen muss, bevor es in eine App kommt.
 *
 * Anlass ist ein Fehler beim Bau von nc-notification-check: die Datei hatte
 * kein Ausfuehrungsrecht. Der Hook ruft die Werkzeuge ueber node_modules/.bin
 * auf, fing die EACCES-Ausnahme in seinem catch — und meldete BLOCKED, ohne
 * dass etwas an der Migration falsch war. Ein Riegel, der aus dem falschen
 * Grund zuschlaegt, wird als erstes umgangen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, accessSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const paket = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8'))

test('jedes registrierte Werkzeug ist ausfuehrbar', () => {
	for (const [name, pfad] of Object.entries(paket.bin)) {
		accessSync(join(WURZEL, pfad), constants.X_OK)
		assert.match(readFileSync(join(WURZEL, pfad), 'utf8'), /^#!\/usr\/bin\/env node/,
			`${name} braucht eine Shebang-Zeile`)
	}
})

test('package.json und bin/ stimmen ueberein', () => {
	// Ein Werkzeug, das niemand aufrufen kann, ist keins — und `files` bestimmt,
	// was ueberhaupt in der App ankommt.
	assert.ok(paket.files.includes('bin'), 'bin muss ausgeliefert werden')
	for (const pfad of Object.values(paket.bin)) {
		assert.ok(pfad.startsWith('bin/'), `${pfad} liegt nicht in bin/`)
	}
})

test('kein geteilter Workflow legt Pull Requests an', () => {
	// Die Organisation verbietet es dem GITHUB_TOKEN, der Lauf wuerde rot.
	const ordner = join(WURZEL, '.github', 'workflows')
	for (const datei of readdirSync(ordner)) {
		assert.doesNotMatch(readFileSync(join(ordner, datei), 'utf8'), /gh\s+pr\s+(create|review|merge)/,
			`${datei} ruft gh pr auf`)
	}
})

const LOCKFILE_GELOESCHT = /\brm\b[^\n;&|]*package-lock\.json/
const NPM_INSTALL = /(^|[\s;&|("'])npm\s+(install|i)(?![\w-])(?!\s+(-g|--global)\b)/m

test('die Lockfile-Muster treffen die gaengigen Schreibweisen und nichts Harmloses', () => {
	for (const boese of ['rm -f package-lock.json', 'rm -rf node_modules package-lock.json', 'rm --force ./package-lock.json']) {
		assert.match(boese, LOCKFILE_GELOESCHT, boese)
	}
	for (const boese of ['run: npm install', 'cd app && npm install --no-audit', 'then npm i; fi', 'run: "npm install"']) {
		assert.match(boese, NPM_INSTALL, boese)
	}
	for (const harmlos of ['run: npm ci', 'npm install -g npm@11', 'npm install-ci-test', 'pnpm-install']) {
		assert.doesNotMatch(harmlos, NPM_INSTALL, harmlos)
	}
})

test('kein geteilter Workflow loest Abhaengigkeiten am Lockfile vorbei auf', () => {
	// Live gegen die Registry aufgeloest flakt der Lauf bei frisch veroeffentlichten Versionen.
	const ordner = join(WURZEL, '.github', 'workflows')
	for (const datei of readdirSync(ordner)) {
		const text = readFileSync(join(ordner, datei), 'utf8')
			.split('\n').filter((zeile) => !zeile.trim().startsWith('#')).join('\n')
		assert.doesNotMatch(text, LOCKFILE_GELOESCHT, `${datei} loescht das Lockfile`)
		assert.doesNotMatch(text, NPM_INSTALL, `${datei} ruft npm install statt npm ci auf`)
	}
})
