#!/usr/bin/env node
/**
 * nc-design-check — prueft den Teil von docs/design-system.md, der sich sicher am Code ablesen laesst.
 *
 *   npx nc-design-check          # im Wurzelverzeichnis der App
 *
 * Geprueft wird nur, was ohne Heuristik eindeutig ist:
 *   1. src/App.vue hat einen NcAppNavigationItem "Neuerungen" (Abschnitt 2/6).
 *   2. Kein NcAppNavigationItem traegt einen abgeloesten Seitennamen (Abschnitt 2).
 *   3. img/app.svg hat fill="#fff" an der Wurzel, img/app-dark.svg kein fill (Abschnitt 1).
 *   4. Keine abgeloeste Formulierung in t('<app>', '...')-Texten (Abschnitt 5).
 *
 * BEWUSST NICHT GEPRUEFT: Layout und CSS-Werte, Symbole der Einstellungs-Navigation,
 * Kartenoptik. Das beurteilt das Review gegen docs/design-system.md.
 *
 * Exit 0 ohne Fehler, Exit 1 bei mindestens einem Fehler.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

// Abgeloeste Seitennamen und ihr Ersatz (design-system.md, Abschnitt 2).
const ABGELOESTE_NAMEN = [
	{ name: 'Meine Einstellungen', ersatz: 'Einstellungen (persoenliche Seite)' },
	{ name: 'Mein Kontakt', ersatz: 'Einstellungen (persoenliche Seite)' },
	{ name: 'Administration', ersatz: 'Verwaltung (app-weite Seite)' },
	{ name: 'Admin', ersatz: 'Verwaltung (app-weite Seite)' },
]

// Abgeloeste Formulierungen in t()-Texten. Weitere Eintraege hier ergaenzen.
const ABGELOESTE_TEXTE = [
	{ enthaelt: 'installierten Werk-Apps', ersatz: '"aktivierten" statt "installierten" (gemeldet werden nur aktivierte Apps)' },
]

const fehler = []
const melde = (ort, text) => fehler.push({ ort, text })

if (!existsSync('appinfo/info.xml')) {
	process.stderr.write('FEHLER: appinfo/info.xml nicht gefunden, hier ist kein App-Verzeichnis.\n')
	process.exit(1)
}
const APP = readFileSync('appinfo/info.xml', 'utf8').match(/<id>\s*([^<\s]+)\s*<\/id>/)?.[1]
if (!APP) {
	process.stderr.write('FEHLER: keine <id> in appinfo/info.xml.\n')
	process.exit(1)
}

const maskiere = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Liefert die Anfangs-Tags aller NcAppNavigationItem mit Zeilennummer; Anfuehrungszeichen werden beachtet (`=>` im Attribut). */
function navigationsTags(quelle) {
	const tags = []
	for (const m of quelle.matchAll(/<NcAppNavigationItem\b/g)) {
		let quote = null
		let ende = m.index
		for (; ende < quelle.length; ende++) {
			const z = quelle[ende]
			if (quote) { if (z === quote) quote = null } else if (z === '"' || z === '\'') quote = z
			else if (z === '>') break
		}
		tags.push({ text: quelle.slice(m.index, ende + 1), zeile: quelle.slice(0, m.index).split('\n').length })
	}
	return tags
}

const NAME_MUSTER = new RegExp(String.raw`\s:name\s*=\s*"t\(\s*'${maskiere(APP)}'\s*,\s*'((?:[^'\\]|\\.)*)'`)

// --- 1 und 2: App.vue ---------------------------------------------------------
const APP_VUE = join('src', 'App.vue')
if (!existsSync(APP_VUE)) {
	melde(APP_VUE, 'fehlt, der Punkt "Neuerungen" laesst sich nicht pruefen')
} else {
	const tags = navigationsTags(readFileSync(APP_VUE, 'utf8'))
	const namen = tags.map((t) => ({ ...t, wert: t.text.match(NAME_MUSTER)?.[1] }))
	if (!namen.some((n) => n.wert === 'Neuerungen')) {
		melde(APP_VUE, `kein NcAppNavigationItem mit :name="t('${APP}', 'Neuerungen')" (design-system.md, Abschnitt 2)`)
	}
	for (const n of namen) {
		const alt = ABGELOESTE_NAMEN.find((a) => a.name === n.wert)
		if (alt) melde(`${APP_VUE}:${n.zeile}`, `Seitenname "${alt.name}" ist abgeloest, stattdessen: ${alt.ersatz}`)
	}
}

// --- 3: Symbole ---------------------------------------------------------------
function wurzelFill(pfad) {
	const wurzel = readFileSync(pfad, 'utf8').match(/<svg\b[^>]*>/i)?.[0]
	if (!wurzel) return undefined
	return wurzel.match(/\sfill\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
}
for (const [pfad, soll] of [[join('img', 'app.svg'), 'hell'], [join('img', 'app-dark.svg'), 'dunkel']]) {
	if (!existsSync(pfad)) { melde(pfad, 'fehlt'); continue }
	const fill = wurzelFill(pfad)
	if (fill === undefined) melde(pfad, 'kein <svg>-Element gefunden')
	else if (soll === 'hell' && !/^#(?:fff|ffffff)$/i.test(fill ?? '')) melde(pfad, `Wurzel-svg braucht fill="#fff" (ist: ${fill === null ? 'kein fill' : `fill="${fill}"`})`)
	else if (soll === 'dunkel' && fill !== null) melde(pfad, `Wurzel-svg darf kein fill tragen (ist: fill="${fill}")`)
}

// --- 4: abgeloeste Formulierungen ------------------------------------------------
function dateien(ordner, liste = []) {
	if (!existsSync(ordner)) return liste
	for (const e of readdirSync(ordner, { withFileTypes: true })) {
		const pfad = join(ordner, e.name)
		if (e.isDirectory()) { if (!['node_modules', '__tests__', '__mocks__'].includes(e.name)) dateien(pfad, liste) }
		else if (/\.(?:[cm]?[jt]sx?|vue)$/.test(e.name) && !/\.(?:spec|test)\.\w+$/.test(e.name) && !e.name.endsWith('.d.ts')) liste.push(pfad)
	}
	return liste
}
const T_AUFRUF = new RegExp(String.raw`\bt\(\s*'${maskiere(APP)}'\s*,\s*(['"])((?:\\.|(?!\1)[^\\])*)\1`, 'g')
const quellen = dateien('src')
for (const pfad of quellen) {
	const text = readFileSync(pfad, 'utf8')
	for (const m of text.matchAll(T_AUFRUF)) {
		const alt = ABGELOESTE_TEXTE.find((a) => m[2].includes(a.enthaelt))
		if (alt) melde(`${pfad}:${text.slice(0, m.index).split('\n').length}`, `abgeloeste Formulierung "${alt.enthaelt}", stattdessen: ${alt.ersatz}`)
	}
}

if (!fehler.length) {
	console.log(green(`nc-design-check: keine Fehler (App ${APP}, ${quellen.length} Dateien in src/ geprueft).`))
	process.exit(0)
}
for (const f of fehler) console.log(`${red('FEHLER')} ${f.ort}\n    ${f.text}`)
console.log(`\n${red(`nc-design-check: ${fehler.length} Fehler.`)}`)
console.log(dim('Regeln: docs/design-system.md (im Paket: node_modules/nc-app-tooling/docs/design-system.md).'))
process.exit(1)
