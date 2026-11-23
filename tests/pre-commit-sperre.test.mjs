// Die Sperre selbst liegt im Parent-Ordner; hier zaehlt nur, dass der Hook sie findet und ihr Urteil befolgt.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN, git, schreibe } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

const SPERRE_FREI = `import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./aufruf.txt', import.meta.url), process.argv.slice(2).join(' '))
`
const SPERRE_BELEGT = `process.stderr.write('[App-Sperre] testapp bearbeitet gerade sven\\n')
process.exit(1)
`

function ordner(sperre) {
	const parent = mkdtempSync(join(tmpdir(), 'nc-tooling-pc-sperre-'))
	angelegt.push(parent)
	if (sperre !== null) schreibe(parent, '.claude/hooks/app-lock.mjs', sperre)
	const wurzel = join(parent, 'testapp')
	mkdirSync(wurzel)
	git(wurzel, 'init', '-q')
	schreibe(wurzel, 'README.md', 'x\n')
	git(wurzel, 'add', 'README.md')
	return { parent, wurzel }
}

const lauf = (wurzel) => spawnSync('node', [join(BIN, 'pre-commit.mjs')], { cwd: wurzel, encoding: 'utf8' })

test('ohne Sperre im Parent-Ordner entfaellt der Schritt', () => {
	const ergebnis = lauf(ordner(null).wurzel)
	assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr)
	assert.doesNotMatch(ergebnis.stdout, /App-Sperre/)
})

test('belegte Sperre blockiert den Commit und nennt den Grund', () => {
	const ergebnis = lauf(ordner(SPERRE_BELEGT).wurzel)
	assert.equal(ergebnis.status, 1, ergebnis.stdout)
	assert.match(ergebnis.stdout, /\[App-Sperre\] BLOCKED/)
	assert.match(ergebnis.stdout, /bearbeitet gerade sven/)
})

test('freie Sperre laesst den Commit durch und bekommt den Repo-Pfad', () => {
	const { parent, wurzel } = ordner(SPERRE_FREI)
	const ergebnis = lauf(wurzel)
	assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr)
	const aufruf = readFileSync(join(parent, '.claude', 'hooks', 'aufruf.txt'), 'utf8')
	assert.match(aufruf, /^--check .*testapp$/)
})
