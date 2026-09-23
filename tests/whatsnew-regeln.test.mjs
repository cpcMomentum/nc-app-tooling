/**
 * whatsnew-regeln + nc-whatsnew-check — Abnahme aus nc-app-tooling#27.
 *
 * Die reinen Regeln (pruefeSchema, versionsBefund, semverVergleich) werden
 * direkt importiert; das CLI laeuft gegen eine Wegwerf-App. Beide teilen sich
 * die Regeln — hier steht, was sie garantieren.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN } from './helfer.mjs'
import { pruefeSchema, versionsBefund, semverVergleich } from '../bin/whatsnew-regeln.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

/** Ein gueltiger Eintrag als Basis, den einzelne Tests kaputt machen. */
const guelt = () => ({
	title: { de: 'Titel', en: 'Title' },
	text: { de: 'Text', en: 'Text' },
	plus: false,
})

// --- semverVergleich --------------------------------------------------------

test('semverVergleich: gleich, kleiner, groesser', () => {
	assert.equal(semverVergleich('0.5.3', '0.5.3'), 0)
	assert.equal(semverVergleich('0.5.2', '0.5.3'), -1)
	assert.equal(semverVergleich('0.6.0', '0.5.9'), 1)
})

test('semverVergleich: numerisch, nicht als String (0.10.0 > 0.9.0)', () => {
	assert.equal(semverVergleich('0.10.0', '0.9.0'), 1)
})

test('semverVergleich: fehlende Stellen zaehlen als 0 (0.5 == 0.5.0)', () => {
	assert.equal(semverVergleich('0.5', '0.5.0'), 0)
})

// --- pruefeSchema: gueltig --------------------------------------------------

test('pruefeSchema: gueltiger Katalog -> keine Fehler', () => {
	const k = {
		'0.5.1': [guelt()],
		'0.5.3': [
			{ ...guelt(), icon: 'star', where: { de: 'Kunden', en: 'Customers' }, adminOnly: true },
		],
	}
	assert.deepEqual(pruefeSchema(k), [])
})

test('pruefeSchema: minimaler Eintrag (ohne where/icon) -> gueltig', () => {
	assert.deepEqual(pruefeSchema({ '1.0.0': [guelt()] }), [])
})

test('pruefeSchema: plus ist optional — fehlt ist gueltig (vinarium verbietet es)', () => {
	const e = guelt(); delete e.plus
	assert.deepEqual(pruefeSchema({ '1.0.0': [e] }), [])
})

test('pruefeSchema: leeres Array fuer eine Version ist gueltig (Wartungsrelease)', () => {
	assert.deepEqual(pruefeSchema({ '1.0.0': [] }), [])
})

// --- pruefeSchema: ungueltig ------------------------------------------------

test('pruefeSchema: kein Objekt', () => {
	assert.equal(pruefeSchema([]).length, 1)
	assert.match(pruefeSchema([])[0], /kein Objekt/)
})

test('pruefeSchema: leeres Objekt', () => {
	assert.match(pruefeSchema({})[0], /leer/)
})

test('pruefeSchema: Versionsschluessel kein x.y.z', () => {
	const f = pruefeSchema({ '0.5': [guelt()] })
	assert.ok(f.some((m) => /Versionsschluessel "0\.5"/.test(m)))
})

test('pruefeSchema: Wert kein Array', () => {
	const f = pruefeSchema({ '1.0.0': { nicht: 'array' } })
	assert.ok(f.some((m) => /kein Array/.test(m)))
})

test('pruefeSchema: Eintrag ohne title', () => {
	const e = guelt(); delete e.title
	const f = pruefeSchema({ '1.0.0': [e] })
	assert.ok(f.some((m) => /title fehlt/.test(m)))
})

test('pruefeSchema: title ohne en', () => {
	const e = guelt(); e.title = { de: 'Nur DE' }
	const f = pruefeSchema({ '1.0.0': [e] })
	assert.ok(f.some((m) => /title\.en fehlt oder ist leer/.test(m)))
})

test('pruefeSchema: text.de leer', () => {
	const e = guelt(); e.text = { de: '   ', en: 'ok' }
	const f = pruefeSchema({ '1.0.0': [e] })
	assert.ok(f.some((m) => /text\.de fehlt oder ist leer/.test(m)))
})

test('pruefeSchema: plus vorhanden aber nicht boolean', () => {
	const e = guelt(); e.plus = 'nein'
	const f = pruefeSchema({ '1.0.0': [e] })
	assert.ok(f.some((m) => /plus ist nicht true\/false/.test(m)))
})

test('pruefeSchema: where vorhanden aber ohne en', () => {
	const e = guelt(); e.where = { de: 'Kunden' }
	const f = pruefeSchema({ '1.0.0': [e] })
	assert.ok(f.some((m) => /where\.en fehlt oder ist leer/.test(m)))
})

// --- versionsBefund ---------------------------------------------------------

test('versionsBefund: Schluessel == Release -> gruen', () => {
	assert.equal(versionsBefund({ '0.5.3': [guelt()] }, '0.5.3').art, 'grün')
})

test('versionsBefund: gruen auch bei leerem Array (Wartungsrelease mit Schluessel)', () => {
	assert.equal(versionsBefund({ '0.5.3': [] }, '0.5.3').art, 'grün')
})

test('versionsBefund: nur aeltere Schluessel -> Warnung', () => {
	const b = versionsBefund({ '0.5.1': [guelt()] }, '0.5.3')
	assert.equal(b.art, 'warnung')
	assert.match(b.text, /kein Eintrag fuer die Release-Version 0\.5\.3/)
})

test('versionsBefund: Schluessel neuer als Release -> Fehler', () => {
	const b = versionsBefund({ '0.6.0': [guelt()] }, '0.5.3')
	assert.equal(b.art, 'fehler')
	assert.match(b.text, /Zukunft/)
})

test('versionsBefund: Release-Schluessel da, aber auch ein Zukunfts-Schluessel -> Fehler', () => {
	const b = versionsBefund({ '0.5.3': [guelt()], '0.9.0': [guelt()] }, '0.5.3')
	assert.equal(b.art, 'fehler')
})

test('versionsBefund: Release da plus aeltere -> gruen', () => {
	const b = versionsBefund({ '0.5.1': [guelt()], '0.5.3': [guelt()] }, '0.5.3')
	assert.equal(b.art, 'grün')
})

// --- CLI nc-whatsnew-check --------------------------------------------------

/** Wegwerf-App mit optionalem whatsnew.json-Inhalt (roher String, damit auch kaputtes JSON geht). */
function app(inhalt = null) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-wn-'))
	angelegt.push(wurzel)
	if (inhalt !== null) {
		mkdirSync(join(wurzel, 'whatsnew'), { recursive: true })
		writeFileSync(join(wurzel, 'whatsnew', 'whatsnew.json'), inhalt)
	}
	return wurzel
}

function lauf(wurzel) {
	const r = spawnSync('node', [join(BIN, 'whatsnew-check.mjs')], {
		cwd: wurzel, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
	})
	return { code: r.status, ausgabe: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

test('CLI: keine Datei -> Exit 0', () => {
	const { code, ausgabe } = lauf(app(null))
	assert.equal(code, 0)
	assert.match(ausgabe, /nichts zu pruefen/)
})

test('CLI: gueltige Datei -> Exit 0', () => {
	const { code, ausgabe } = lauf(app(JSON.stringify({ '1.0.0': [guelt()] })))
	assert.equal(code, 0)
	assert.match(ausgabe, /gueltig/)
})

test('CLI: Schema-Fehler -> Exit 1', () => {
	const e = guelt(); e.title = { de: 'Nur DE' }   // en fehlt
	const { code, ausgabe } = lauf(app(JSON.stringify({ '1.0.0': [e] })))
	assert.equal(code, 1)
	assert.match(ausgabe, /title\.en fehlt/)
})

test('CLI: kaputtes JSON -> Exit 1', () => {
	const { code, ausgabe } = lauf(app('{ das ist kein JSON'))
	assert.equal(code, 1)
	assert.match(ausgabe, /kein gueltiges JSON/)
})
