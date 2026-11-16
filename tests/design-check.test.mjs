/**
 * nc-design-check: jede Regel einmal als Fehler, der gruene Fall einmal ohne.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { lauf, schreibe } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

const HELL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M0 0"/></svg>\n'
const DUNKEL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>\n'
const item = (name) => `<NcAppNavigationItem :name="t('testapp', '${name}')" :to="{ name: 'x' }" />`
const appVue = (...namen) => `<template>\n<NcAppNavigation>\n${namen.map(item).join('\n')}\n</NcAppNavigation>\n</template>\n`

/** Gueltige Basis; `ueberschreibe` ersetzt oder (mit null) entfernt Dateien. */
function app(ueberschreibe = {}) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-design-'))
	angelegt.push(wurzel)
	const dateien = {
		'appinfo/info.xml': '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n',
		'src/App.vue': appVue('Rechnungen', 'Neuerungen', 'Einstellungen', 'Verwaltung'),
		'img/app.svg': HELL,
		'img/app-dark.svg': DUNKEL,
		...ueberschreibe,
	}
	for (const [pfad, inhalt] of Object.entries(dateien)) if (inhalt !== null) schreibe(wurzel, pfad, inhalt)
	return wurzel
}

test('gueltige App: Exit 0', () => {
	const r = lauf('design-check.mjs', app())
	assert.equal(r.code, 0, r.ausgabe)
	assert.match(r.ausgabe, /keine Fehler/)
})

test('ohne info.xml: Exit 1', () => {
	const r = lauf('design-check.mjs', app({ 'appinfo/info.xml': null }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /info\.xml/)
})

test('kein Punkt Neuerungen: Fehler', () => {
	const r = lauf('design-check.mjs', app({ 'src/App.vue': appVue('Rechnungen', 'Einstellungen') }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /Neuerungen/)
})

test('Neuerungen mit fremder App-Id zaehlt nicht', () => {
	const r = lauf('design-check.mjs', app({ 'src/App.vue': appVue('Rechnungen').replace('</NcAppNavigation>', `<NcAppNavigationItem :name="t('andere', 'Neuerungen')" />\n</NcAppNavigation>`) }))
	assert.equal(r.code, 1)
})

test('mehrzeiliges Tag mit => im Attribut wird erkannt', () => {
	const vue = `<NcAppNavigationItem\n\t:to="{ name: 'x' }"\n\t:active="() => true"\n\t:name="t('testapp', 'Neuerungen')"\n>\n</NcAppNavigationItem>\n`
	const r = lauf('design-check.mjs', app({ 'src/App.vue': vue }))
	assert.equal(r.code, 0, r.ausgabe)
})

for (const alt of ['Meine Einstellungen', 'Mein Kontakt', 'Administration', 'Admin']) {
	test(`abgeloester Seitenname "${alt}": Fehler mit Ersatz`, () => {
		const r = lauf('design-check.mjs', app({ 'src/App.vue': appVue('Neuerungen', alt) }))
		assert.equal(r.code, 1)
		assert.ok(r.ausgabe.includes(`"${alt}" ist abgeloest`), r.ausgabe)
		assert.match(r.ausgabe, /Einstellungen|Verwaltung/)
	})
}

test('Seitenname nur als Teil eines Namens ("Admin-Log") ist kein Fehler', () => {
	const r = lauf('design-check.mjs', app({ 'src/App.vue': appVue('Neuerungen', 'Admin-Log') }))
	assert.equal(r.code, 0, r.ausgabe)
})

test('app.svg ohne fill: Fehler', () => {
	const r = lauf('design-check.mjs', app({ 'img/app.svg': DUNKEL }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /img\/app\.svg/)
})

test('fill nur an einem Kindelement zaehlt nicht fuer die Wurzel', () => {
	const r = lauf('design-check.mjs', app({ 'img/app.svg': '<svg viewBox="0 0 24 24"><path fill="#fff" d="M0 0"/></svg>' }))
	assert.equal(r.code, 1)
})

test('app-dark.svg mit fill: Fehler', () => {
	const r = lauf('design-check.mjs', app({ 'img/app-dark.svg': HELL }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /app-dark\.svg/)
})

test('fehlende app-dark.svg: Fehler', () => {
	const r = lauf('design-check.mjs', app({ 'img/app-dark.svg': null }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /app-dark\.svg\s*\n\s*fehlt/)
})

test('abgeloeste Formulierung "installierten Werk-Apps": Fehler mit Zeile', () => {
	const vue = `<script>\nconst a = t('testapp', 'Versionen der installierten Werk-Apps')\n</script>\n`
	const r = lauf('design-check.mjs', app({ 'src/components/X.vue': vue }))
	assert.equal(r.code, 1)
	assert.match(r.ausgabe, /src\/components\/X\.vue:2/)
	assert.match(r.ausgabe, /aktivierten/)
})

test('"aktivierten Werk-Apps" und fremde Id sind kein Fehler', () => {
	const vue = `const a = t('testapp', 'Versionen der aktivierten Werk-Apps')\nconst b = t('andere', 'installierten Werk-Apps')\n`
	const r = lauf('design-check.mjs', app({ 'src/x.js': vue }))
	assert.equal(r.code, 0, r.ausgabe)
})
