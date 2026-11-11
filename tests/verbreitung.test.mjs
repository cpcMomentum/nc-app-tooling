/**
 * Verbreitungs-Messung: geprueft wird die Auswertung, nicht das Netz. Die
 * Releases kommen als feste Daten in der Form der GitHub-API.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { auswerten, kommentar, letzteMessung } from '../.github/scripts/verbreitung.mjs'

const HEUTE = new Date('2026-11-11T08:00:00Z')
const release = (tag, datum, downloads, mehr = {}) => ({
	tag_name: tag, published_at: `${datum}T10:00:00Z`, draft: false, prerelease: false,
	assets: [{ name: `app-${tag}.tar.gz`, download_count: downloads }], ...mehr,
})

test('Gesamtsumme zaehlt nur Tarballs, Entwuerfe und Releases ohne Tarball fallen raus', () => {
	const m = auswerten([
		release('v2', '2026-11-05', 10),
		release('v1', '2026-10-01', 100, { assets: [
			{ name: 'app-v1.tar.gz', download_count: 100 }, { name: 'app-v1.tar.gz.sig', download_count: 7 },
		] }),
		release('v3', '2026-11-10', 999, { draft: true }),
		{ tag_name: 'v0', published_at: '2026-01-01T00:00:00Z', draft: false, prerelease: false, assets: [] },
	], HEUTE)
	assert.equal(m.gesamt, 110)
	assert.equal(m.releases, 2)
})

test('ausgerollt ist das juengste Release, das mindestens 21 Tage alt ist', () => {
	const m = auswerten([
		release('v3', '2026-11-05', 10),
		release('v2', '2026-10-20', 300),
		release('v1', '2026-09-01', 500),
		release('v2.1-rc', '2026-10-15', 5, { prerelease: true }),
	], HEUTE)
	assert.deepEqual(m.ausgerollt, { tag: 'v2', datum: '2026-10-20', downloads: 300 })
})

test('20 Tage alt zaehlt noch nicht, ohne altes Release gibt es keine Naeherung', () => {
	assert.equal(auswerten([release('v1', '2026-10-22', 50)], HEUTE).ausgerollt, null)
	assert.equal(auswerten([], HEUTE).gesamt, 0)
})

const messung = (datum, gesamt, tag, downloads) => ({
	datum, apps: { worktime: { gesamt, releases: 3, ausgerollt: { tag, datum: '2026-09-30', downloads } } },
})

test('erste Messung: keine Veraenderung, Messung steckt maschinenlesbar im Kommentar', () => {
	const text = kommentar(messung('2026-11-11', 20188, 'v0.24.1', 1376), null)
	assert.match(text, /\| worktime \| 20\.188 \| – \| 3 \| v0\.24\.1 \(2026-09-30\) \| 1\.376 \| – \|/)
	assert.match(text, /Erste Messung/)
	assert.deepEqual(letzteMessung([{ body: text }]), messung('2026-11-11', 20188, 'v0.24.1', 1376))
})

test('Folgemessung: Veraenderung gesamt und beim selben ausgerollten Release', () => {
	const text = kommentar(messung('2027-01-01', 21000, 'v0.24.1', 1400), messung('2026-11-11', 20188, 'v0.24.1', 1376))
	assert.match(text, /\| 21\.000 \| \+812 \|/)
	assert.match(text, /\| 1\.400 \| \+24 \|/)
	assert.match(text, /gegenüber der Messung vom 2026-11-11/)
})

test('hat das ausgerollte Release gewechselt, wird nicht verrechnet', () => {
	const text = kommentar(messung('2027-01-01', 21000, 'v0.25.0', 200), messung('2026-11-11', 20188, 'v0.24.1', 1376))
	assert.match(text, /\| 200 \| neues Release \(vorher v0\.24\.1: 1\.376\) \|/)
})

test('letzteMessung nimmt den juengsten Kommentar mit Messung und uebergeht alles andere', () => {
	const alt = kommentar(messung('2026-11-11', 1, 'v1', 1), null)
	const neu = kommentar(messung('2027-01-01', 2, 'v1', 2), null)
	const kommentare = [{ body: alt }, { body: 'Handkommentar' }, { body: neu }, { body: '<!-- verbreitung-messung: {kaputt -->' }, { body: null }]
	assert.equal(letzteMessung(kommentare).datum, '2027-01-01')
	assert.equal(letzteMessung([{ body: 'nichts' }]), null)
})
