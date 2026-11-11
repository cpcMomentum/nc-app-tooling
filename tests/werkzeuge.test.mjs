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

test('kein geteilter Workflow loest Abhaengigkeiten am Lockfile vorbei auf', () => {
	// Live gegen die Registry aufgeloest flakt der Lauf bei frisch veroeffentlichten Versionen.
	const ordner = join(WURZEL, '.github', 'workflows')
	for (const datei of readdirSync(ordner)) {
		const text = readFileSync(join(ordner, datei), 'utf8')
		assert.doesNotMatch(text, /rm\s+(-\w+\s+)*package-lock\.json/, `${datei} loescht das Lockfile`)
		assert.doesNotMatch(text, /^\s*(run:|-\s*run:)?\s*npm\s+(install|i)\b/m, `${datei} ruft npm install statt npm ci auf`)
	}
})
