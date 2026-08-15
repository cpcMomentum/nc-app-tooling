/**
 * nc-bundle-fresh — Abnahme aus nc-app-tooling#2.
 *
 * Der Kern jedes Falls: das Bundle im Arbeitsbaum passt nicht mehr zu den
 * Quellen in HEAD. Genau so gelangte veralteter Code in den App Store, ohne
 * dass einer der 15 Tarball-Checks angeschlagen haette.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { bauen, commit, lauf, schreibe, wegwerfApp } from './helfer.mjs'

test('frisch gebauter Stand laeuft durch', () => {
	const app = wegwerfApp()
	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /Bundle passt zum Quellstand/)
})

test('veraltetes Bundle wird abgewiesen', () => {
	const app = wegwerfApp()
	// Quelle geaendert und committet, aber nicht neu gebaut — der Fall, den der
	// Release bisher ungeprueft gepackt haette.
	schreibe(app, 'src/eingabe.txt', 'zwei\n')
	commit(app, 'Quelle geaendert, Build vergessen')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Bundle passt NICHT zum Quellstand/)
	assert.match(ausgabe, /js\/testapp-main\.js/)
	assert.match(ausgabe, /css\/testapp-main\.css/)
})

test('Bot-Auto-Fix nach dem Build wird abgewiesen', () => {
	const app = wegwerfApp()
	// Regel 8 des Release-Skills: der Bot pusht Fix-Commits auf den
	// Release-Branch, nachdem gebaut und signiert wurde. Sign-Tree und Tarball
	// sind danach in sich konsistent — und beide veraltet.
	schreibe(app, 'src/eingabe.txt', 'botfix\n')
	commit(app, 'fix: Auto-Fix des Bots')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Inhalt weicht ab/)
})

test('Bundle aus einem fremden Stand wird abgewiesen', () => {
	const app = wegwerfApp()
	// Quelle und Bundle passen einzeln zu je einem Stand, nur nicht zueinander.
	// Der alte nc-bundle-check sieht hier zwei geaenderte Seiten und meldet
	// gruen — das ist sein Falsch-Negativ (nc-app-tooling#1).
	writeFileSync(join(app, 'js/testapp-main.js'), 'console.log("fremd")\n')
	commit(app, 'Bundle aus einem anderen Stand')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Inhalt weicht ab/)
})

test('ueberzaehlige Datei aus einem aelteren Build wird genannt, blockiert aber nicht', () => {
	const app = wegwerfApp()
	// Die Vite-Apps bauen mit `cp -r dist/js/* js/` — das raeumt nicht auf.
	// Eine Datei, die der Build nicht mehr anlegt, bleibt liegen. Von aussen
	// ist sie nicht von einer Build-Eingabe zu unterscheiden, die dort wohnt
	// (contractmanager: css/main.scss). Deshalb: nennen, nicht blockieren.
	writeFileSync(join(app, 'js/testapp-alt.js'), 'console.log("rest")\n')
	commit(app, 'Rest eines aelteren Builds')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /Ueberzaehlig im Arbeitsbaum/)
	assert.match(ausgabe, /js\/testapp-alt\.js/)
})

test('eine Build-Eingabe in css/ laesst den Lauf nicht scheitern', () => {
	const app = wegwerfApp()
	// Der Fall, an dem das Leeren der Ordner gescheitert ist: contractmanager
	// importiert `../css/main.scss` aus `src/main.ts`. Die Eingabe wohnt im
	// Ausgabeordner und muss den Build ueberleben.
	schreibe(app, 'css/main.scss', '$farbe: red;\n')
	commit(app, 'Build-Eingabe in css/')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 0, ausgabe)
	// Sie steht nicht im Vergleich: sie ist nicht kompiliert, also kein Bundle.
	assert.doesNotMatch(ausgabe, /main\.scss/)
})

test('fehlende Bundle-Datei wird gemeldet', () => {
	const app = wegwerfApp()
	rmSync(join(app, 'css/testapp-main.css'))
	commit(app, 'CSS-Bundle verloren')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Fehlt im Arbeitsbaum/)
	assert.match(ausgabe, /css\/testapp-main\.css/)
})

test('Sourcemaps werden ignoriert', () => {
	const app = wegwerfApp()
	// Die .map der Wegwerf-App traegt den Build-Pfad im Inhalt. Wuerde sie
	// mitverglichen, scheiterte jeder Lauf allein am Temp-Verzeichnis. Sie
	// steht in den Tarball-Excludes und erreicht nie einen Nutzer.
	const map = readFileSync(join(app, 'js/testapp-main.js.map'), 'utf8')
	assert.match(map, /"pfad"/)

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 0, ausgabe)
	assert.doesNotMatch(ausgabe, /\.map/)
})

test('ein schmutziger Arbeitsbaum aendert das Urteil nicht', () => {
	const app = wegwerfApp()
	// Verglichen wird HEAD gegen das Bundle im Arbeitsbaum — genau das Paar,
	// das der Release ausliefert. Eine uncommittete Quelltextaenderung geht
	// nicht mit raus und darf deshalb auch nicht anschlagen.
	schreibe(app, 'src/eingabe.txt', 'nicht committet\n')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 0, ausgabe)
})

test('ohne Lockfile bricht das Werkzeug ab, statt zu raten', () => {
	const app = wegwerfApp()
	rmSync(join(app, 'package-lock.json'))
	commit(app, 'Lockfile entfernt')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 2, ausgabe)
	assert.match(ausgabe, /package-lock\.json fehlt/)
})

test('ein fehlgeschlagener Build meldet Exit 2, nicht Exit 1', () => {
	const app = wegwerfApp()
	// Ein kaputter Build ist etwas anderes als ein veraltetes Bundle. Wer
	// beides gleich behandelt, liest „Bundle veraltet" und baut neu — und
	// wundert sich, warum es nicht besser wird.
	schreibe(app, 'bauen.mjs', 'process.exit(3)\n')
	commit(app, 'Build kaputt')

	const { code, ausgabe } = lauf('bundle-fresh.mjs', app)
	assert.equal(code, 2, ausgabe)
	assert.match(ausgabe, /schlug fehl/)
})

test('bauen() der Wegwerf-App ist deterministisch', () => {
	const app = wegwerfApp()
	const vorher = readFileSync(join(app, 'js/testapp-main.js'), 'utf8')
	bauen(app)
	assert.equal(readFileSync(join(app, 'js/testapp-main.js'), 'utf8'), vorher)
})
