import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lauf, schreibe } from './helfer.mjs'

const katalog = (map, plural = 'nplurals=2; plural=(n != 1);') => ({
	js: `OC.L10N.register(\n    "testapp",\n    {\n${Object.entries(map).map(([k, v]) => `    ${JSON.stringify(k)} : ${JSON.stringify(v)}`).join(',\n')}\n},\n"${plural}");\n`,
	json: JSON.stringify({ translations: map, pluralForm: plural }, null, '\t') + '\n',
})

function l10nApp({ quelle, en, extra = {} }) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-l10n-'))
	process.on('exit', () => rmSync(wurzel, { recursive: true, force: true }))
	schreibe(wurzel, 'appinfo/info.xml', '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n')
	schreibe(wurzel, 'src/App.vue', quelle.map((s) => `t('testapp', ${JSON.stringify(s).replace(/^"|"$/g, "'")})`).join('\n') + '\n')
	const kataloge = { de: Object.fromEntries(quelle.map((s) => [s, s])), en, ...extra }
	for (const [lang, map] of Object.entries(kataloge)) {
		const { js, json } = katalog(map)
		schreibe(wurzel, `l10n/${lang}.js`, js)
		schreibe(wurzel, `l10n/${lang}.json`, json)
	}
	return wurzel
}

const lies = (wurzel, datei) => readFileSync(join(wurzel, 'l10n', datei), 'utf8')

test('ohne Varianten: gruen, nur Hinweise', () => {
	const app = l10nApp({ quelle: ['Speichern'], en: { Speichern: 'Save' } })
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.match(r.ausgabe, /en_GB fehlt/)
	assert.match(r.ausgabe, /de_DE fehlt/)
})

test('--fix legt en_GB als exakte Kopie von en an', () => {
	const app = l10nApp({ quelle: ['Speichern'], en: { Speichern: 'Save' } })
	assert.equal(lauf('l10n-check.mjs', app, ['--fix']).code, 0)
	assert.equal(lies(app, 'en_GB.json'), lies(app, 'en.json'))
	assert.equal(lies(app, 'en_GB.js'), lies(app, 'en.js'))
	assert.ok(!existsSync(join(app, 'l10n', 'de_DE.json')), '--fix allein legt kein de_DE an')
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.doesNotMatch(r.ausgabe, /en_GB fehlt/)
})

test('abweichendes en_GB blockiert, --fix gleicht an', () => {
	const app = l10nApp({ quelle: ['Speichern'], en: { Speichern: 'Save' }, extra: { en_GB: { Speichern: 'Store' } } })
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 1, r.ausgabe)
	assert.match(r.ausgabe, /en_GB: weicht von en ab/)
	lauf('l10n-check.mjs', app, ['--fix'])
	assert.equal(lies(app, 'en_GB.json'), lies(app, 'en.json'))
})

test('--add-de_DE legt de_DE an; duzende Eintraege blockieren dort', () => {
	const app = l10nApp({ quelle: ['Speichern', 'Bitte prüfe deine Eingabe.'], en: { Speichern: 'Save', 'Bitte prüfe deine Eingabe.': 'Please check your input.' } })
	assert.equal(lauf('l10n-check.mjs', app, ['--add-de_DE']).code, 0)
	assert.equal(lies(app, 'de_DE.json'), lies(app, 'de.json'))
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 1, r.ausgabe)
	assert.match(r.ausgabe, /de_DE: 1 Eintrag\/Eintraege duzen/)

	const map = JSON.parse(lies(app, 'de_DE.json')).translations
	map['Bitte prüfe deine Eingabe.'] = 'Bitte prüfen Sie Ihre Eingabe.'
	const { js, json } = katalog(map)
	writeFileSync(join(app, 'l10n', 'de_DE.js'), js)
	writeFileSync(join(app, 'l10n', 'de_DE.json'), json)
	const ok = lauf('l10n-check.mjs', app)
	assert.equal(ok.code, 0, ok.ausgabe)
})

test('Sie mitten im Quelltext blockiert, sobald de_DE da ist', () => {
	const quelle = ['Möchten Sie das löschen?']
	const app = l10nApp({ quelle, en: { [quelle[0]]: 'Delete?' }, extra: { de_DE: { [quelle[0]]: quelle[0] } } })
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 1, r.ausgabe)
	assert.match(r.ausgabe, /de: 1 Quelltext\(e\) siezen/)
})

test('Sie am Satzanfang ist nur ein Hinweis (kann 3. Person sein)', () => {
	const quelle = ['Abwesenheit stornieren? Sie bleibt sichtbar.']
	const app = l10nApp({ quelle, en: { [quelle[0]]: 'Cancel?' }, extra: { de_DE: { [quelle[0]]: quelle[0] } } })
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.match(r.ausgabe, /beginnen mit "Sie"\/"Ihr"/)
})

test('ohne de_DE wird die Anrede nicht geprueft', () => {
	const quelle = ['Möchten Sie das löschen?']
	const app = l10nApp({ quelle, en: { [quelle[0]]: 'Delete?' } })
	assert.equal(lauf('l10n-check.mjs', app).code, 0)
})

test('--add-de_DE uebernimmt bei dynamischen Aufrufen auch Schluessel ausserhalb des Codes', () => {
	const app = l10nApp({ quelle: ['Speichern'], en: { Speichern: 'Save', Stück: 'Piece' } })
	schreibe(app, 'src/Einheit.vue', "t('testapp', LABELS[code])\n")
	const de = { Speichern: 'Speichern', Stück: 'Stück' }
	const { js, json } = katalog(de)
	writeFileSync(join(app, 'l10n', 'de.js'), js)
	writeFileSync(join(app, 'l10n', 'de.json'), json)
	assert.equal(lauf('l10n-check.mjs', app, ['--add-de_DE']).code, 0)
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.ok('Stück' in JSON.parse(lies(app, 'de_DE.json')).translations)
})

test('Plural: "Sie" am Anfang beider Formen ist nur ein Hinweis', () => {
	const app = l10nApp({ quelle: [], en: {} })
	schreibe(app, 'src/App.vue', "n('testapp', 'Sie enthält %n Datei', 'Sie enthält %n Dateien', n)\n")
	const key = '_Sie enthält %n Datei_::_Sie enthält %n Dateien_'
	const werte = { de: ['Sie enthält %n Datei', 'Sie enthält %n Dateien'], en: ['It contains %n file', 'It contains %n files'] }
	for (const lang of ['de', 'en', 'de_DE']) {
		const { js, json } = katalog({ [key]: werte[lang] ?? werte.de })
		writeFileSync(join(app, 'l10n', `${lang}.js`), js)
		writeFileSync(join(app, 'l10n', `${lang}.json`), json)
	}
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.match(r.ausgabe, /beginnen mit "Sie"\/"Ihr"/)
})

function formalApp(dateien, quelle) {
	const app = l10nApp({ quelle: [], en: {} })
	rmSync(join(app, 'src', 'App.vue'))
	for (const [pfad, inhalt] of Object.entries(dateien)) schreibe(app, pfad, inhalt)
	const map = Object.fromEntries(quelle.map((s) => [s, s]))
	for (const lang of ['de', 'en', 'de_DE']) {
		const { js, json } = katalog(map)
		writeFileSync(join(app, 'l10n', `${lang}.js`), js)
		writeFileSync(join(app, 'l10n', `${lang}.json`), json)
	}
	return app
}

test('TRANSLATORS: formal nimmt Kundentexte von der Sie-Pruefung aus (Zeile davor, gleiche Zeile, PHP)', () => {
	const app = formalApp({
		'src/Mail.vue': "// TRANSLATORS: formal\nconst a = t('testapp', 'anbei erhalten Sie Ihre Rechnung.')\n"
			+ "const b = t('testapp', 'Ihre Rechnung') // TRANSLATORS: formal\n",
		'lib/Mail.php': "<?php\n/* TRANSLATORS: formal */\n$this->l->t('wir danken Ihnen für Ihren Auftrag.');\n",
	}, ['anbei erhalten Sie Ihre Rechnung.', 'Ihre Rechnung', 'wir danken Ihnen für Ihren Auftrag.'])
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.doesNotMatch(r.ausgabe, /siezen|beginnen mit "Sie"/)
})

test('Marker zwei Zeilen ueber dem Aufruf zaehlt nicht', () => {
	const app = formalApp({
		'src/Mail.vue': "// TRANSLATORS: formal\n\nconst a = t('testapp', 'anbei erhalten Sie Ihre Rechnung.')\n",
	}, ['anbei erhalten Sie Ihre Rechnung.'])
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 1, r.ausgabe)
	assert.match(r.ausgabe, /siezen/)
})

const IMPERATIV_TREFFER = [
	'Bitte bewahre ihn sicher auf. Er ist hinterlegt, wird aber nur jetzt vollständig angezeigt.',
	'Bitte bewahre ihn sicher auf. Er wird nie wieder angezeigt.',
	'Bitte gib einen gültigen WerkPlus-Schlüssel ein.',
	'Bitte wähle eine gültige Größenklasse.',
	'Der gespeicherte Lizenznachweis ist ungültig. Bitte prüfe die Lizenz erneut.',
	'Die Anfrage an WerkPlus war fehlerhaft. Bitte melde den Fehler dem Anbieter.',
	'Dieser Schlüssel ist nicht bekannt. Bitte prüfe die Schreibweise.',
	'Lege fest, wer RechnungsWerk nutzen darf. Nextcloud-Server-Administratoren sind immer Admin.',
	'Lege wiederkehrende Einleitungs- und Schlusstexte an, um sie schnell in Dokumente zu übernehmen.',
	'Tippe einen Namen (mind. 2 Zeichen), um Nutzer oder Gruppen zu finden.',
	'WerkPlus hat einen Fehler gemeldet. Bitte versuche es später erneut.',
	'WerkPlus ist gerade nicht erreichbar. Bitte versuche es später erneut.',
	'Zu viele Versuche. Bitte versuche es später erneut.',
	'Mit eigenem Konto gehen Rechnungs-Mails über diesen Server – nutze ein Konto, das die Absenderadresse besitzt.',
]
const IMPERATIV_KEINE = [
	'Bitte aus der Liste wählen.',
	'Bitte eine gültige E-Mail-Adresse angeben.',
	'Zu viele Versuche.',
	'Frage löschen?',
	'Diese Rechnung ist festgeschrieben.',
	'Keine Kunden vorhanden.',
	'Neue Rechnung',
]

test('Imperativ ohne Pronomen: Hinweis fuer alle Pilot-Treffer, nicht blockierend', () => {
	const alle = [...IMPERATIV_TREFFER, ...IMPERATIV_KEINE]
	const app = formalApp({ 'src/App.vue': alle.map((s) => `t('testapp', '${s}')`).join('\n') + '\n' }, alle)
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.match(r.ausgabe, new RegExp(`de_DE: ${IMPERATIV_TREFFER.length} Eintrag/Eintraege wirken wie Imperativ`))
})

test('Imperativ: kein Hinweis bei Fehlalarm-Kandidaten, umgestelltem de_DE oder Marker', () => {
	const umgestellt = 'Bitte prüfe die Schreibweise.'
	const markiert = 'Lege den Kunden an.'
	const app = formalApp({
		'src/App.vue': [...IMPERATIV_KEINE, umgestellt].map((s) => `t('testapp', '${s}')`).join('\n')
			+ `\n// TRANSLATORS: formal\nt('testapp', '${markiert}')\n`,
	}, [...IMPERATIV_KEINE, umgestellt, markiert])
	const map = JSON.parse(lies(app, 'de_DE.json')).translations
	map[umgestellt] = 'Bitte prüfen Sie die Schreibweise.'
	const { js, json } = katalog(map)
	writeFileSync(join(app, 'l10n', 'de_DE.js'), js)
	writeFileSync(join(app, 'l10n', 'de_DE.json'), json)
	const r = lauf('l10n-check.mjs', app)
	assert.equal(r.code, 0, r.ausgabe)
	assert.doesNotMatch(r.ausgabe, /wirken wie Imperativ/)
})

test('Imperativ nach und/oder/dann wird erkannt', () => {
	const text = 'Der Export ist fertig oder kopiere den Link aus der Liste.'
	const app = formalApp({ 'src/App.vue': `t('testapp', '${text}')\n` }, [text])
	assert.match(lauf('l10n-check.mjs', app).ausgabe, /de_DE: 1 Eintrag\/Eintraege wirken wie Imperativ/)
})
