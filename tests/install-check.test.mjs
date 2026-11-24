// Der Lauf braucht Docker; hier stehen nur die Schluesse aus den Ausgaben, dort lag der Fehler.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bewerteEinspielen, bewerteHttp, bewerteUpgrade, integritaetOk, vorversion } from '../bin/install-regeln.mjs'

// --- Integritaet -------------------------------------------------------------

test('integritaet: leere Ausgabe mit Exit 0 ist bestanden', () => {
	assert.equal(integritaetOk(0, ''), true)
	assert.equal(integritaetOk(0, '\n  \n'), true)
})

test('integritaet: "require upgrade" mit Exit 0 ist NICHT bestanden', () => {
	// Gegen nextcloud:34 gemessen: genau diese Ausgabe mit Exit 0.
	const ausgabe = 'Nextcloud or one of the apps require upgrade - only a limited number of commands are available\n'
		+ 'You may use your browser or the occ upgrade command to do the upgrade\n'
	assert.equal(integritaetOk(0, ausgabe), false)
})

test('integritaet: Befund mit Exit 1 ist nicht bestanden', () => {
	assert.equal(integritaetOk(1, 'projektwerk: 1 errors found:\n  - FILE_MISSING:\n'), false)
})

test('integritaet: Exit ungleich 0 ohne Ausgabe ist nicht bestanden', () => {
	assert.equal(integritaetOk(1, ''), false)
	assert.equal(integritaetOk(null, ''), false)
})

// --- Vorversion --------------------------------------------------------------

test('vorversion: der hoechste Tag unter der neuen Version', () => {
	const tags = ['v0.5.9', 'v0.6.0', 'v0.6.1', 'v0.6.2', 'v0.10.0']
	assert.equal(vorversion(tags, '0.6.2'), '0.6.1')
	// Numerisch, nicht alphabetisch: 0.10.0 liegt ueber 0.6.x.
	assert.equal(vorversion(tags, '0.11.0'), '0.10.0')
})

test('vorversion: Tags ohne v, Vorabversionen und Fremdes werden ignoriert', () => {
	const tags = ['1.2.0', 'v1.3.0-rc.1', 'nc-compat-34', 'v1.2.5', 'latest']
	assert.equal(vorversion(tags, '1.3.0'), '1.2.5')
})

test('vorversion: erstes Release hat keine', () => {
	assert.equal(vorversion([], '0.1.0'), null)
	assert.equal(vorversion(['v0.1.0'], '0.1.0'), null)
})

// --- Einspielen (Check 8) ----------------------------------------------------

const stats = (ueber = {}) => ({
	top: ['testapp'], imTar: 120, entpackt: 120, kopiert: 120, gefiltert: [], version: '1.2.3', ...ueber,
})

test('einspielen: sauberer Tarball hat keinen Befund', () => {
	assert.deepEqual(bewerteEinspielen(stats(), 'testapp'), [])
})

test('einspielen: mehr als ein Top-Level-Eintrag ist ein Befund', () => {
	const befunde = bewerteEinspielen(stats({ top: ['testapp', '._testapp'] }), 'testapp')
	assert.equal(befunde.length, 1)
	assert.match(befunde[0], /\._testapp/)
})

test('einspielen: falscher Ordnername ist ein Befund', () => {
	assert.equal(bewerteEinspielen(stats({ top: ['testapp-1.2.3'] }), 'testapp').length, 1)
})

test('einspielen: beim Entpacken verlorene Dateien sind ein Befund', () => {
	// Lange Pfade aus bsdtar: die Ordnerzahl stimmt, Dateien fehlen.
	const befunde = bewerteEinspielen(stats({ entpackt: 118 }), 'testapp')
	assert.equal(befunde.length, 1)
	assert.match(befunde[0], /120.*118/)
})

test('einspielen: vom NC-Filter entfernte Dateien sind ein Befund', () => {
	const befunde = bewerteEinspielen(stats({ kopiert: 119, gefiltert: ['vendor/x/.htaccess'] }), 'testapp')
	assert.equal(befunde.length, 1)
	assert.match(befunde[0], /\.htaccess/)
})

// --- Upgrade -----------------------------------------------------------------

test('upgrade: Exit 0 ohne Fehlerwort ist bestanden', () => {
	assert.equal(bewerteUpgrade(0, 'Updating database schema\nUpdated database\nTurned off maintenance mode\n'), null)
})

test('upgrade: Exit ungleich 0 ist ein Befund', () => {
	assert.match(bewerteUpgrade(1, ''), /Exit 1/)
})

test('upgrade: Exception in der Ausgabe ist ein Befund, auch bei Exit 0', () => {
	assert.match(bewerteUpgrade(0, 'Exception: Column "x" is type Bool and also NotNull'), /Exception/)
})

// --- HTTP --------------------------------------------------------------------

test('http: 200 bestanden, 5xx und 000 Befund, 4xx Hinweis', () => {
	assert.equal(bewerteHttp('200').stufe, 'ok')
	assert.equal(bewerteHttp('303').stufe, 'ok')
	assert.equal(bewerteHttp('500').stufe, 'fehler')
	assert.equal(bewerteHttp('000').stufe, 'fehler')
	assert.equal(bewerteHttp('404').stufe, 'hinweis')
})
