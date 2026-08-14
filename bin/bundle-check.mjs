#!/usr/bin/env node
/**
 * nc-bundle-check — faengt vergessene Frontend-Builds.
 *
 *   npx nc-bundle-check <base-ref>      # z.B. origin/develop
 *
 * Die Apps liefern ihr kompiliertes `js/` und `css/` mit aus. Wer die Quellen
 * aendert und den Build vergisst, deployt alten Code — und niemand merkt es,
 * weil alle Tests gegen die Quellen laufen.
 *
 * Zwei belegte Faelle:
 *   - contractmanager#327: Dependabot hob dompurify, das Bundle wurde nicht neu
 *     gebaut. Die ausgelieferte Datei trug weiter die verwundbare Version.
 *   - contractmanager#245: CSS und vendor fehlten im Release, die Oberflaeche
 *     war ungestylt und die PDF-Extraktion kaputt.
 *
 * WARUM NICHT DER BYTE-DIFF (contractmanager#251): Der naheliegende Weg waere
 * `npm run build && git diff --exit-code js/ css/`. Der schlaegt aber IMMER an,
 * weil der Build nicht reproduzierbar ist: die CI wirft den Lock weg
 * (npm/cli#4828) und installiert damit floatende Versionen, und sie baut mit
 * einer anderen Node-Version als der, mit der das committete Bundle entstand.
 * Nachgemessen am 12.08.2026: ein Rebuild ohne jede Quelltextaenderung
 * erzeugte 315 Byte Unterschied, ausschliesslich andere Minifier-Kuerzel.
 *
 * Diese Pruefung vergleicht deshalb nicht Bytes, sondern die Frage: wurden
 * Eingaben geaendert, ohne dass sich die Ausgaben geaendert haben?
 *
 * Ausweg fuer den seltenen Fall, dass eine Quelltextaenderung das Bundle
 * nachweislich nicht beruehrt (z.B. reine Kommentare): "[skip bundle-check]"
 * in die Commit-Nachricht. Bewusst sichtbar im Verlauf statt als stiller
 * Schalter.
 */

import { execFileSync } from 'node:child_process'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const base = process.argv[2]
if (!base) {
	console.error(red('nc-bundle-check: Basis-Ref fehlt. Aufruf: nc-bundle-check origin/develop'))
	process.exit(2)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

let geaendert
try {
	geaendert = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
} catch {
	console.error(red(`nc-bundle-check: Diff gegen ${base} nicht moeglich.`))
	console.error('Im CI braucht der Checkout fetch-depth: 0, sonst fehlt die Merge-Base.')
	process.exit(2)
}

if (!geaendert.length) {
	console.log(green('✓ Keine Aenderungen gegenueber ' + base + '.'))
	process.exit(0)
}

// Tests und Typdeklarationen landen nicht im Bundle.
const IST_TEST = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/
// package.json bewusst NICHT: dort aendern sich meist nur npm-Skripte oder
// Metadaten, und das beruehrt kein Bundle — contractmanager#341 und #342 sind
// genau solche Faelle. Abhaengigkeits-Aenderungen schlagen sich ohnehin immer
// auch im Lockfile nieder; das ist der #327-Fall, den diese Pruefung fangen soll.
const EINGABE = (f) => (f.startsWith('src/') && !IST_TEST.test(f)) || f === 'package-lock.json'
const AUSGABE = (f) => f.startsWith('js/') || f.startsWith('css/')

/**
 * Beruehrt die Lockfile-Aenderung ueberhaupt das Bundle?
 *
 * Eine reine Entwicklungs-Abhaengigkeit landet nie im ausgelieferten
 * JavaScript. Ohne diese Unterscheidung wuerde jeder Dependabot-Bump auf
 * eslint, vite oder vitest falsch anschlagen — und ein Check, der staendig
 * falsch anschlaegt, wird abgeschaltet.
 *
 * Das Lockfile sagt es selbst: Eintraege unter `packages` tragen `dev: true`,
 * wenn sie ausschliesslich fuer die Entwicklung gebraucht werden. Geprueft an
 * contractmanager: dompurify (Laufzeit) steht auf `dev: false`, vite und
 * nc-app-tooling auf `dev: true`.
 */
function lockBetrifftBundle() {
	let vorher, nachher
	try {
		vorher = JSON.parse(git('show', `${base}:package-lock.json`))
		nachher = JSON.parse(git('show', 'HEAD:package-lock.json'))
	} catch {
		return true // nicht entscheidbar → im Zweifel melden
	}
	const paketeVon = (l) => l.packages ?? {}
	const a = paketeVon(vorher)
	const b = paketeVon(nachher)
	const namen = new Set([...Object.keys(a), ...Object.keys(b)])
	for (const n of namen) {
		if (!n) continue // der Wurzeleintrag "" beschreibt das Projekt selbst
		const va = a[n]
		const vb = b[n]
		if (JSON.stringify(va?.version) === JSON.stringify(vb?.version)
			&& JSON.stringify(va?.resolved) === JSON.stringify(vb?.resolved)) continue
		// Geaendert: nur dann relevant, wenn es NICHT reine Entwicklung ist.
		const nurDev = (vb ?? va)?.dev === true
		if (!nurDev) return true
	}
	return false
}

let eingaben = geaendert.filter(EINGABE)
const ausgaben = geaendert.filter(AUSGABE)

if (eingaben.length && eingaben.every((f) => f === 'package-lock.json') && !lockBetrifftBundle()) {
	console.log(green('✓ Nur Entwicklungs-Abhaengigkeiten geaendert — kein Bundle betroffen.'))
	process.exit(0)
}

if (!eingaben.length) {
	console.log(green('✓ Keine Bundle-Eingaben geaendert.'))
	process.exit(0)
}
if (ausgaben.length) {
	console.log(green(`✓ ${eingaben.length} Eingabe(n) geaendert, Bundle mitgebaut (${ausgaben.length} Datei(en)).`))
	process.exit(0)
}

// Ausweg pruefen: steht der Marker in einer der Commit-Nachrichten?
const nachrichten = git('log', '--format=%B', `${base}...HEAD`)
if (nachrichten.includes('[skip bundle-check]')) {
	console.log(green('✓ Uebersprungen — "[skip bundle-check]" steht in einer Commit-Nachricht.'))
	process.exit(0)
}

console.log(red('✗ Bundle-Check: Quellen geaendert, Bundle nicht.') + '\n')
console.log('Geaenderte Eingaben:')
eingaben.slice(0, 10).forEach((f) => console.log(`  • ${f}`))
if (eingaben.length > 10) console.log(dim(`  … und ${eingaben.length - 10} weitere`))
console.log('')
console.log('In js/ und css/ hat sich nichts geaendert. Die Apps liefern ihr')
console.log('kompiliertes Bundle mit aus — ohne Neubau wird alter Code deployt,')
console.log('und keine Testsuite faellt darueber, weil alle gegen die Quellen laufen.')
console.log('')
console.log('  npm run build   und das Ergebnis mitcommitten')
console.log('')
console.log(dim('Beruehrt die Aenderung das Bundle nachweislich nicht (z.B. reine'))
console.log(dim('Kommentare), dann "[skip bundle-check]" in die Commit-Nachricht.'))
process.exit(1)
