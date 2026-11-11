/**
 * Verbreitungs-Messung: geprueft wird die Auswertung, nicht das Netz. Die
 * Releases kommen als feste Daten in der Form der GitHub-API.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { alleSeiten, auswerten, gueltig, kommentar, letzteMessung } from '../.github/scripts/verbreitung.mjs'

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
		release('v1', '2026-09-01', 500),
		release('v3', '2026-11-05', 10),
		release('v2', '2026-10-19', 300),
		release('v2.1-rc', '2026-10-20', 5, { prerelease: true }),
	], HEUTE)
	assert.deepEqual(m.ausgerollt, { tag: 'v2', datum: '2026-10-19', downloads: 300 })
})

test('genau 21 Tage alt zaehlt schon', () => {
	const m = auswerten([{ ...release('v1', '2026-10-21', 50), published_at: '2026-10-21T08:00:00Z' }], HEUTE)
	assert.equal(m.ausgerollt.tag, 'v1')
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
	assert.deepEqual(letzteMessung([{ user: { login: 'github-actions[bot]' }, body: text }]), messung('2026-11-11', 20188, 'v0.24.1', 1376))
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

const VON_UNS = { user: { login: 'github-actions[bot]' }, author_association: 'NONE' }
const FREMD = { user: { login: 'irgendwer' }, author_association: 'NONE' }

test('Rueckgang, App neu in der Messung und Release ohne Vorgaenger', () => {
	const weniger = kommentar(messung('2027-01-01', 20000, 'v0.24.1', 1300), messung('2026-11-11', 20188, 'v0.24.1', 1376))
	assert.match(weniger, /\| 20\.000 \| −188 \|/)
	assert.match(weniger, /\| 1\.300 \| −76 \|/)
	const neueApp = kommentar(messung('2027-01-01', 5, 'v1', 5), { datum: '2026-11-11', apps: {} })
	assert.match(neueApp, /\| worktime \| 5 \| – \| 3 \| v1 \(2026-09-30\) \| 5 \| – \|/)
	const vorherOhne = { datum: '2026-11-11', apps: { worktime: { gesamt: 1, releases: 1, ausgerollt: null } } }
	assert.match(kommentar(messung('2027-01-01', 5, 'v1', 5), vorherOhne), /neues Release \(vorher –\)/)
	const jetztOhne = { datum: '2027-01-01', apps: { worktime: { gesamt: 5, releases: 1, ausgerollt: null } } }
	assert.match(kommentar(jetztOhne, vorherOhne), /\| worktime \| 5 \| \+4 \| 1 \| – \| – \| – \|/)
})

test('eine Messung aus einem Fremdkommentar zaehlt nicht', () => {
	const echt = kommentar(messung('2026-11-11', 1, 'v1', 1), null)
	const falsch = kommentar(messung('2027-01-01', 999, 'v1', 999), null)
	const gelesen = letzteMessung([{ ...VON_UNS, body: echt }, { ...FREMD, body: falsch }])
	assert.equal(gelesen.datum, '2026-11-11')
	assert.equal(letzteMessung([{ ...FREMD, body: falsch }]), null)
	assert.equal(letzteMessung([{ user: { login: 'axel' }, author_association: 'MEMBER', body: falsch }]).datum, '2027-01-01')
})

test('eine Messung in falscher Form wird uebergangen, auch von uns', () => {
	const basis = messung('2026-11-11', 1, 'v1', 1)
	const kaputt = [
		{ ...basis, datum: 'heute. @alle [Update](https://evil.example)' },
		{ ...basis, apps: { worktime: { ...basis.apps.worktime, gesamt: 'x' } } },
		{ ...basis, apps: { worktime: { ...basis.apps.worktime, ausgerollt: { tag: 'v1 | [klick](https://evil.example)', datum: '2026-09-30', downloads: 1 } } } },
		{ ...basis, apps: { worktime: { ...basis.apps.worktime, ausgerollt: { tag: 'v1', datum: '2026-09-30', downloads: '<b>9</b>' } } } },
		{ ...basis, apps: { worktime: { ...basis.apps.worktime, ausgerollt: { tag: 'x', datum: '2026-09-30', downloads: null } } } },
		{ ...basis, apps: { fremdeapp: basis.apps.worktime } },
		{ apps: {} },
		{},
	]
	for (const m of kaputt) {
		assert.equal(gueltig(m), false, JSON.stringify(m))
		const body = `<!-- verbreitung-messung: ${JSON.stringify(m)} -->`
		assert.equal(letzteMessung([{ ...VON_UNS, body }]), null)
	}
	assert.equal(gueltig(basis), true)
	assert.equal(gueltig({ datum: '2026-11-11', apps: { worktime: { gesamt: 0, releases: 0, ausgerollt: null } } }), true)
})

test('alleSeiten holt weiter, solange eine Seite voll ist, und haengt die Seitenangabe richtig an', async () => {
	const aufrufe = []
	const hole = async (pfad) => {
		aufrufe.push(pfad)
		return aufrufe.length === 1 ? Array.from({ length: 100 }, (_, i) => i) : []
	}
	assert.equal((await alleSeiten('repos/x/y/releases', hole)).length, 100)
	assert.deepEqual(aufrufe, ['repos/x/y/releases?per_page=100&page=1', 'repos/x/y/releases?per_page=100&page=2'])
	const mitFrage = []
	await alleSeiten('repos/x/y/issues?state=all', async (pfad) => { mitFrage.push(pfad); return [] })
	assert.deepEqual(mitFrage, ['repos/x/y/issues?state=all&per_page=100&page=1'])
})

test('letzteMessung nimmt den juengsten Kommentar mit Messung und uebergeht alles andere', () => {
	const alt = kommentar(messung('2026-11-11', 1, 'v1', 1), null)
	const neu = kommentar(messung('2027-01-01', 2, 'v1', 2), null)
	const kommentare = [alt, 'Handkommentar', neu, '<!-- verbreitung-messung: {kaputt -->', null].map((body) => ({ ...VON_UNS, body }))
	assert.equal(letzteMessung(kommentare).datum, '2027-01-01')
	assert.equal(letzteMessung([{ ...VON_UNS, body: 'nichts' }]), null)
})
