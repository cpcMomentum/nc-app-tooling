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
 * als Kommentar in derselben oder der Zeile davor.
 *
 * Exit 0 ohne Befund, Exit 1 mit Befunden.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const JETZT_WORT = String.raw`(?:now|today|tomorrow|yesterday|midnight|noon|first day|last day|[+-]\s*\d)`

const PHP_REGELN = [
	{ name: 'new DateTime() ohne Zeitzone', muster: new RegExp(String.raw`new\s+\\?DateTime(?:Immutable)?\s*(?:\(\s*\)|(?![\s(\\\w]))`) },
	{ name: 'new DateTime(\'jetzt\') ohne Zeitzone', muster: new RegExp(String.raw`new\s+\\?DateTime(?:Immutable)?\s*\(\s*['"]${JETZT_WORT}[^'"]*['"]\s*\)`, 'i') },
	{ name: 'new DateTime(…, UTC)', muster: new RegExp(String.raw`new\s+\\?DateTime(?:Immutable)?\s*\(\s*(?:['"]${JETZT_WORT}[^'"]*['"])?\s*,\s*new\s+\\?DateTimeZone\s*\(\s*['"]UTC['"]`, 'i') },
	{ name: 'date() ohne Zeitpunkt', muster: /(?<![\w>:$])date\s*\(\s*(['"])[^'"]*\1\s*\)/ },
	{ name: 'strtotime(\'jetzt\')', muster: new RegExp(String.raw`(?<![\w>:$])strtotime\s*\(\s*['"]${JETZT_WORT}[^'"]*['"]\s*\)`, 'i') },
	{ name: 'ITimeFactory::getDateTime() ohne Zeitzone', muster: /->getDateTime\s*\(\s*(?:['"][^'"]*['"])?\s*\)/ },
]

// Erkennbar ein Zeitstempel: der Wert geht in derselben Zeile in einen ...At-Setter, ein ..._at-Feld oder einen ...At-Schluessel.
const PHP_ZEITSTEMPEL = /->set\w*(?:At|Timestamp)\s*\(|->setDateTime\s*\(|['"]\w+_at['"]|['"]\w+At['"]\s*=>/

const JS_REGELN = [
	{ name: 'toISOString() als Kalendertag', muster: /toISOString\(\)\s*\.\s*(?:substring|slice|substr)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/ },
]

const MARKE = /tz-ok:\s*\S/

function dateien(ordner, passt, liste = []) {
	if (!existsSync(ordner)) return liste
	for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
		const pfad = join(ordner, eintrag.name)
		if (eintrag.isDirectory()) {
			if (!['Migration', 'node_modules', '__tests__', '__mocks__'].includes(eintrag.name)) dateien(pfad, passt, liste)
		} else if (passt(eintrag.name)) {
			liste.push(pfad)
		}
	}
	return liste
}

function pruefe(pfad, regeln, zeitstempel) {
	const zeilen = readFileSync(pfad, 'utf8').split('\n')
	const befunde = []
	zeilen.forEach((zeile, i) => {
		const code = zeile.replace(/^\s*(\/\/|\*|\/\*|#).*$/, '')
		const regel = regeln.find((r) => r.muster.test(code))
		if (!regel) return
		if (zeitstempel?.test(code)) return
		if (MARKE.test(zeile) || (i > 0 && MARKE.test(zeilen[i - 1]))) return
		befunde.push({ pfad, zeile: i + 1, regel: regel.name, text: zeile.trim() })
	})
	return befunde
}

if (!existsSync('appinfo/info.xml')) {
	process.stderr.write('FEHLER: appinfo/info.xml nicht gefunden, hier ist kein App-Verzeichnis.\n')
	process.exit(1)
}

const befunde = [
	...dateien('lib', (n) => n.endsWith('.php')).flatMap((p) => pruefe(p, PHP_REGELN, PHP_ZEITSTEMPEL)),
	...dateien('src', (n) => /\.(js|ts|vue)$/.test(n) && !/\.(spec|test)\.[jt]s$/.test(n)).flatMap((p) => pruefe(p, JS_REGELN, null)),
]

if (!befunde.length) {
	process.stdout.write('nc-timezone-check: keine Befunde.\n')
	process.exit(0)
}

for (const b of befunde) process.stdout.write(`${b.pfad}:${b.zeile}  ${b.regel}\n    ${b.text}\n`)
process.stdout.write(
	`\nnc-timezone-check: ${befunde.length} Stelle(n) leiten ein Datum aus "jetzt" in UTC ab.\n`
	+ 'Ist ein Kalendertag gemeint: ueber die Zeitzone des Nutzers rechnen.\n'
	+ 'Ist es ein Zeitstempel: mit `// tz-ok: <Grund>` in derselben oder der Zeile davor begruenden.\n',
)
process.exit(1)
