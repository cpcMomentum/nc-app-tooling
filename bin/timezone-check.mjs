#!/usr/bin/env node
/**
 * nc-timezone-check — meldet Stellen, an denen aus "jetzt" ein Kalendertag in UTC wird.
 *
 *   npx nc-timezone-check          # im Wurzelverzeichnis der App
 *
 * Nextcloud setzt die PHP-Laufzeitzone fest auf UTC, toISOString() im Browser
 * liefert ebenfalls UTC. Fuer Zeitstempel ist das richtig. Fuer einen
 * Kalendertag ("heute", Rechnungsdatum, Faelligkeit) ist es zwischen 00:00 und
 * 02:00 Uhr Ortszeit noch der Vortag.
 *
 * Ein Muster kann Zeitstempel und Kalendertag nicht unterscheiden. Deshalb gilt
 * die Regel: jede "jetzt"-Stelle ist entweder erkennbar ein Zeitstempel, rechnet
 * mit einer uebergebenen Zeitzone oder traegt die Begruendung `tz-ok: <Grund>`
 * in einem Kommentar derselben Zeile oder in der Kommentarzeile davor.
 *
 * Exit 0 ohne Befund, Exit 1 mit Befunden.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TAG = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)day`
const JETZT_WORT = String.raw`(?:now|today|tomorrow|yesterday|midnight|noon|first day|last day|this\b|next\b|last\b|${TAG}|[+-]\s*\d|\d+\s+\w+\s+ago)`
const JETZT_TEXT = String.raw`['"](?:${JETZT_WORT}[^'"]*)?['"]`
const KLASSE = String.raw`new\s+\\?DateTime(?:Immutable)?`
const UTC = String.raw`new\s+\\?DateTimeZone\s*\(\s*['"]UTC['"]\s*\)`
const FREI = String.raw`(?<![\w>:$])\\?`

const PHP_REGELN = [
	{ name: 'new DateTime() ohne Zeitzone', muster: new RegExp(String.raw`${KLASSE}\s*(?:\(\s*(?:null|(?:datetime:\s*)?${JETZT_TEXT})?\s*(?:,\s*null\s*)?\)|\(\s*$|(?![\s(\\\w]))`, 'i') },
	{ name: 'new DateTime(…, UTC)', muster: new RegExp(String.raw`${KLASSE}\s*\(\s*(?:null|${JETZT_TEXT})?\s*,\s*${UTC}`, 'i') },
	{ name: 'date_create() ohne Zeitzone', muster: new RegExp(String.raw`${FREI}date_create(?:_immutable)?\s*\(\s*(?:${JETZT_TEXT})?\s*\)`, 'i') },
	{ name: 'date() ohne Zeitpunkt', muster: new RegExp(String.raw`${FREI}(?:gm|i)?date\s*\(\s*(['"])[^'"]*\1\s*(?:,\s*(?:time\s*\(\s*\)|[^,()]*->getTime\s*\(\s*\))\s*)?\)`, 'i') },
	{ name: 'strtotime(\'jetzt\')', muster: new RegExp(String.raw`${FREI}strtotime\s*\(\s*${JETZT_TEXT}\s*\)`, 'i') },
	{ name: 'ITimeFactory ohne Zeitzone', muster: new RegExp(String.raw`(?:->getDateTime\s*\(\s*(?:${JETZT_TEXT})?\s*(?:,\s*${UTC}\s*)?\)(?!\s*->\s*setTimezone\s*\()|(?<!\$this)->now\s*\(\s*\))`, 'i') },
]

const NAMEN = ['Created', 'Updated', 'Modified', 'Deleted', 'Sent', 'Seen', 'Read', 'Processed', 'Approved', 'Submitted', 'Locked', 'Cancelled', 'Archived', 'Closed', 'Revoked', 'Added', 'Assigned', 'Done', 'Frozen', 'Committed', 'Exported', 'Imported', 'LastUsed', 'Status']
const GROSS = `(?:${NAMEN.join('|')})`
const KLEIN = `(?:${NAMEN.map((n) => n[0].toLowerCase() + n.slice(1)).join('|')})`
const SNAKE = `(?:${NAMEN.map((n) => n.replace(/(?!^)([A-Z])/g, '_$1').toLowerCase()).join('|')})`

// Erkennbar ein Zeitstempel: der Wert steht im Argument eines bekannten ...At-Setters oder ..._at-Feldes.
const PHP_ZEITSTEMPEL = [
	{ tiefe: 1, muster: new RegExp(String.raw`->set(?:\w*[a-z0-9])?${GROSS}At\s*\(|->setDateTime\s*\(|->set\s*\(\s*['"](?:\w+_)?${SNAKE}_at['"]\s*,`, 'g') },
	{ tiefe: 0, muster: new RegExp(String.raw`['"](?:${KLEIN}|\w*[a-z0-9]${GROSS})At['"]\s*=>|['"](?:\w+_)?${SNAKE}_at['"]\s*=>`, 'g') },
]

/** Liegt `bis` noch im Argument, das bei `von` beginnt? `tiefe` ist die Klammertiefe direkt hinter dem Ausnahme-Treffer. */
function imArgument(code, von, bis, tiefe) {
	const start = tiefe
	for (const zeichen of code.slice(von, bis)) {
		if ('([{'.includes(zeichen)) tiefe++
		else if (')]}'.includes(zeichen)) tiefe--
		else if (zeichen === ',' && tiefe === 0) return false
		if (tiefe < start) return false
	}
	return true
}

function istZeitstempel(code, position) {
	return PHP_ZEITSTEMPEL.some(({ tiefe, muster }) => [...code.matchAll(muster)]
		.some((z) => z.index < position && imArgument(code, z.index + z[0].length, position, tiefe)))
}

const JS_REGELN = [
	{ name: 'toISOString() als Kalendertag', muster: /to(?:ISOString|JSON)\(\)\s*\??\.\s*(?:substring|slice|substr)\(\s*0\s*,\s*(?:4|7|10)\s*\)|to(?:ISOString|JSON)\(\)\s*\??\.\s*split\(\s*(?:['"`]T['"`]|\/T\/)\s*\)(?!\s*\[\s*1\s*\])/ },
]

const MARKE = /tz-ok:\s*\S/i

/** Trennt eine Zeile in Code und Kommentar. Zeichenketten bleiben Code, `inBlock` traegt Blockkommentare ueber Zeilen. */
function trenne(zeile, inBlock, php) {
	let code = ''
	let kommentar = ''
	let quote = null
	for (let i = 0; i < zeile.length; i++) {
		const rest = zeile.slice(i)
		if (inBlock) {
			const ende = rest.startsWith(inBlock)
			kommentar += zeile[i]
			if (ende) {
				kommentar += inBlock.slice(1)
				i += inBlock.length - 1
				inBlock = null
			}
			continue
		}
		if (quote) {
			code += zeile[i]
			if (zeile[i] === '\\') code += zeile[++i] ?? ''
			else if (zeile[i] === quote) quote = null
			continue
		}
		// Hinter einem Backslash ist es ein Regex-Literal (/\/*$/), kein Kommentar.
		const maskiert = zeile[i - 1] === '\\'
		if (!maskiert && rest.startsWith('/*')) { inBlock = '*/'; kommentar += '/*'; i++; continue }
		if (rest.startsWith('<!--')) { inBlock = '-->'; kommentar += '<!--'; i += 3; continue }
		if ((!maskiert && rest.startsWith('//')) || (php && zeile[i] === '#' && zeile[i + 1] !== '[')) { kommentar += rest; break }
		if (zeile[i] === '\'' || zeile[i] === '"' || zeile[i] === '`') quote = zeile[i]
		code += zeile[i]
	}
	return { code, kommentar, inBlock }
}

function dateien(ordner, passt, liste = []) {
	if (!existsSync(ordner)) return liste
	for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
		const pfad = join(ordner, eintrag.name)
		if (eintrag.isDirectory()) {
			if (!['node_modules', '__tests__', '__mocks__'].includes(eintrag.name) && pfad !== join('lib', 'Migration')) dateien(pfad, passt, liste)
		} else if (passt(eintrag.name)) {
			liste.push(pfad)
		}
	}
	return liste
}

function pruefe(pfad, regeln, php) {
	const befunde = []
	let inBlock = null
	let davor = { code: '', kommentar: '' }
	readFileSync(pfad, 'utf8').split('\n').forEach((zeile, i) => {
		const teile = trenne(zeile, inBlock, php)
		inBlock = teile.inBlock
		const vorzeile = davor
		davor = teile
		if (MARKE.test(teile.kommentar) || (vorzeile.code.trim() === '' && MARKE.test(vorzeile.kommentar))) return
		for (const regel of regeln) {
			const offen = [...teile.code.matchAll(new RegExp(regel.muster.source, regel.muster.flags.replace('g', '') + 'g'))]
				.some((treffer) => !(php && istZeitstempel(teile.code, treffer.index)))
			if (!offen) continue
			befunde.push({ pfad, zeile: i + 1, regel: regel.name, text: zeile.trim() })
			break
		}
	})
	return befunde
}

if (!existsSync('appinfo/info.xml')) {
	process.stderr.write('FEHLER: appinfo/info.xml nicht gefunden, hier ist kein App-Verzeichnis.\n')
	process.exit(1)
}

const phpDateien = dateien('lib', (n) => n.endsWith('.php'))
const jsDateien = dateien('src', (n) => /\.(?:[cm]?[jt]sx?|vue)$/.test(n) && !/\.(?:spec|test)\.\w+$/.test(n) && !n.endsWith('.d.ts'))
const befunde = [
	...phpDateien.flatMap((p) => pruefe(p, PHP_REGELN, true)),
	...jsDateien.flatMap((p) => pruefe(p, JS_REGELN, false)),
]

if (!befunde.length) {
	process.stdout.write(`nc-timezone-check: keine Befunde (${phpDateien.length} PHP-Dateien in lib/, ${jsDateien.length} Dateien in src/ geprueft).\n`)
	process.exit(0)
}

for (const b of befunde) process.stdout.write(`${b.pfad}:${b.zeile}  ${b.regel}\n    ${b.text}\n`)
process.stdout.write(
	`\nnc-timezone-check: ${befunde.length} Stelle(n) leiten ein Datum aus "jetzt" in UTC ab.\n`
	+ 'Ist ein Kalendertag gemeint: ueber die Zeitzone des Nutzers rechnen.\n'
	+ 'Ist es ein Zeitstempel: mit `// tz-ok: <Grund>` in derselben oder der Zeile davor begruenden.\n',
)
process.exit(1)
