/**
 * nc-dev-testkonten gegen ein nachgestelltes occ: geprueft wird, WELCHE
 * occ-Aufrufe entstehen und dass das Passwort nie in der Argumentliste steht.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN } from './helfer.mjs'

const KONTEN = JSON.parse(readFileSync(join(BIN, 'dev-testkonten.json'), 'utf8'))
const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

// Kennt die Konten aus FAKE_VORHANDEN, schreibt jeden Aufruf samt OC_PASS ins Protokoll.
const FAKE_OCC = `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_PROTOKOLL, JSON.stringify({ args, pass: process.env.OC_PASS ?? null, ncPass: process.env.NC_PASS ?? null }) + '\\n')
if (process.env.FAKE_AUS === '1') process.exit(1)
const vorhanden = (process.env.FAKE_VORHANDEN ?? '').split(',').filter(Boolean)
if (args[0] === 'user:info' && process.env.FAKE_INFO_KAPUTT === '1') { process.stderr.write('Datenbank weg'); process.exit(2) }
if (args[0] === 'user:info') {
	if (vorhanden.includes(args[1])) process.exit(0)
	process.stdout.write('user not found'); process.exit(1)
}
if (args[0] === 'group:add') { process.stdout.write('Group "' + args[1] + '" already exists.'); process.exit(1) }
if (args[0] === process.env.FAKE_SCHEITERT) { process.stderr.write('kaputt'); process.exit(1) }
process.exit(0)
`

function lauf(argumente = [], { vorhanden = [], aus = false, scheitert = '', infoKaputt = false } = {}) {
	const ordner = mkdtempSync(join(tmpdir(), 'nc-tooling-konten-'))
	angelegt.push(ordner)
	const fake = join(ordner, 'occ.mjs')
	const protokoll = join(ordner, 'protokoll.jsonl')
	writeFileSync(fake, FAKE_OCC)
	const ergebnis = spawnSync('node', [join(BIN, 'dev-testkonten.mjs'), ...argumente], {
		encoding: 'utf8',
		env: {
			...process.env,
			NC_OCC: `node ${fake}`,
			FAKE_PROTOKOLL: protokoll,
			FAKE_VORHANDEN: vorhanden.join(','),
			FAKE_AUS: aus ? '1' : '0',
			FAKE_SCHEITERT: scheitert,
			FAKE_INFO_KAPUTT: infoKaputt ? '1' : '0',
			NC_PASS: 'fremd-aus-der-shell',
			OC_PASS: 'aus-der-umgebung-des-aufrufers',
		},
	})
	const aufrufe = existsSync(protokoll)
		? readFileSync(protokoll, 'utf8').trim().split('\n').map((z) => JSON.parse(z))
		: []
	return { ...ergebnis, aufrufe }
}

test('die Liste: admin/admin steht fest, jede uid nur einmal, alle Felder da', () => {
	const admin = KONTEN.find((k) => k.uid === 'admin')
	assert.equal(admin.passwort, 'admin')
	assert.deepEqual(admin.gruppen, ['admin'])
	assert.equal(new Set(KONTEN.map((k) => k.uid)).size, KONTEN.length)
	for (const k of KONTEN) {
		for (const feld of ['uid', 'passwort', 'name', 'zweck']) assert.ok(k[feld], `${k.uid}: ${feld} fehlt`)
		assert.ok(Array.isArray(k.gruppen), `${k.uid}: gruppen fehlt`)
	}
})

test('fehlendes Konto wird angelegt, vorhandenes bekommt sein festes Passwort', () => {
	const { status, aufrufe } = lauf([], { vorhanden: ['admin'] })
	assert.equal(status, 0)
	const admin = aufrufe.find((a) => a.args[0] === 'user:resetpassword' && a.args.includes('admin'))
	assert.equal(admin.pass, 'admin')
	assert.ok(aufrufe.some((a) => a.args[0] === 'group:adduser' && a.args[1] === 'admin' && a.args[2] === 'admin'))
	for (const k of KONTEN.filter((k) => k.uid !== 'admin')) {
		const neu = aufrufe.find((a) => a.args[0] === 'user:add' && a.args.at(-1) === k.uid)
		assert.ok(neu, `${k.uid} nicht angelegt`)
		assert.equal(neu.pass, k.passwort)
		assert.ok(neu.args.includes(k.name))
	}
	assert.ok(!aufrufe.some((a) => a.args[0] === 'user:add' && a.args.at(-1) === 'admin'))
})

test('das Passwort steht nie in der Argumentliste und nur bei Passwort-Aufrufen in der Umgebung', () => {
	const { aufrufe } = lauf([], { vorhanden: ['admin'] })
	const passwoerter = new Set(KONTEN.map((k) => k.passwort).filter((p) => p !== 'admin'))
	for (const a of aufrufe) {
		for (const p of passwoerter) assert.ok(!a.args.includes(p), `Passwort in Argumenten: ${a.args.join(' ')}`)
		const brauchtPasswort = ['user:add', 'user:resetpassword'].includes(a.args[0])
		assert.equal(a.pass !== null, brauchtPasswort, `OC_PASS bei ${a.args[0]}`)
		assert.equal(a.ncPass, null, 'NC_PASS des Aufrufers darf nicht durchsickern')
	}
})

test('fasst nur Konten aus der Liste an und loescht nichts', () => {
	const { aufrufe } = lauf([], { vorhanden: KONTEN.map((k) => k.uid) })
	const uids = new Set(KONTEN.map((k) => k.uid))
	for (const a of aufrufe) {
		assert.ok(['status', 'user:info', 'user:enable', 'user:resetpassword', 'group:add', 'group:adduser'].includes(a.args[0]), a.args[0])
		if (!['status', 'group:add'].includes(a.args[0])) assert.ok(uids.has(a.args.at(-1)), `fremdes Konto: ${a.args.join(' ')}`)
	}
})

test('--list aendert nichts', () => {
	const { status, stdout, aufrufe } = lauf(['--list'])
	assert.equal(status, 0)
	assert.equal(aufrufe.length, 0)
	assert.match(stdout, /^admin\s+admin\s/m)
})

test('Instanz nicht erreichbar -> Exit 1, kein Konto angefasst', () => {
	const { status, stderr, aufrufe } = lauf([], { aus: true })
	assert.equal(status, 1)
	assert.match(stderr, /nicht erreichbar/)
	assert.equal(aufrufe.length, 1)
})

test('ein gescheiterter Schritt -> Exit 1, die uebrigen Konten laufen trotzdem', () => {
	const { status, stdout } = lauf([], { vorhanden: ['admin'], scheitert: 'user:resetpassword' })
	assert.equal(status, 1)
	assert.match(stdout, /^FEHLER {2}admin: Passwort setzen gescheitert: kaputt/m)
	assert.match(stdout, /^ok {6}testlea: angelegt/m)
})

test('vorhandenes Konto: pruefen, aktivieren, Passwort, Gruppe, in dieser Reihenfolge', () => {
	const { aufrufe } = lauf([], { vorhanden: KONTEN.map((k) => k.uid) })
	const admin = aufrufe.filter((a) => a.args.includes('admin')).map((a) => a.args[0])
	assert.deepEqual(admin, ['user:info', 'user:enable', 'user:resetpassword', 'group:add', 'group:adduser'])
})

test('occ-Aussetzer bei user:info fuehrt nicht zum Anlegen', () => {
	const { status, stdout, aufrufe } = lauf([], { infoKaputt: true })
	assert.equal(status, 1)
	assert.match(stdout, /^FEHLER {2}admin: Konto pruefen gescheitert: Datenbank weg/m)
	assert.ok(!aufrufe.some((a) => a.args[0] === 'user:add'))
})

test('Anlegen oder Gruppenzuordnung scheitert -> Exit 1 mit Grund', () => {
	const anlegen = lauf([], { scheitert: 'user:add' })
	assert.equal(anlegen.status, 1)
	assert.match(anlegen.stdout, /^FEHLER {2}testlea: Anlegen gescheitert: kaputt/m)
	const gruppe = lauf([], { vorhanden: KONTEN.map((k) => k.uid), scheitert: 'group:adduser' })
	assert.equal(gruppe.status, 1)
	assert.match(gruppe.stdout, /^FEHLER {2}admin: Gruppe admin gescheitert: kaputt/m)
	assert.match(gruppe.stdout, /^ok {6}testlea: aktiv, Passwort gesetzt/m)
})

test('occ-Programm fehlt -> Exit 1 mit Ursache', () => {
	const ergebnis = spawnSync('node', [join(BIN, 'dev-testkonten.mjs')], {
		encoding: 'utf8', env: { ...process.env, NC_OCC: '/gibt/es/nicht/occ' },
	})
	assert.equal(ergebnis.status, 1)
	assert.match(ergebnis.stderr, /nicht erreichbar.*ENOENT/)
})

test('unbekanntes Argument -> Exit 2', () => {
	assert.equal(lauf(['--loeschen']).status, 2)
})
