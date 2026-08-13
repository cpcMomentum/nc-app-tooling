#!/usr/bin/env node
/**
 * l10n-check — Konsistenz-Waechter fuer die Uebersetzungskataloge einer NC-App.
 *
 * Herkunft: worktime/scripts/l10n-check.mjs (worktime#259, Lehre aus
 * 0.12.0-Review #394). Hier app-unabhaengig gemacht, damit es genau eine
 * Fassung gibt statt einer Kopie pro Repo — es gab zwischenzeitlich drei
 * verschiedene Loesungen in drei Apps (contractmanager#340).
 *
 * Der `t('<app>', '…')`-Lookup ist byte-genau. Die Kataloge in l10n/ werden von
 * Hand gepflegt, also driften sie: fehlende Keys, tote Keys, typografische
 * Mismatches (`…` vs `...`), .js und .json laufen auseinander. Nextcloud zeigt
 * bei fehlendem Eintrag kommentarlos den Quelltext — nichts geht kaputt, der
 * Text ist bloss in der falschen Sprache. Deshalb faellt es im Alltag nie auf.
 *
 * Der Waechter leitet die Wahrheit aus dem CODE ab und prueft die Kataloge
 * dagegen. Frontend UND Backend: eine Pruefung, die nur `src/` ansieht, meldet
 * gruen, waehrend Backend-Meldungen unuebersetzt ausgeliefert werden — genau so
 * blieben 29 Meldungen fuenf Monate unentdeckt.
 *
 *   npx nc-l10n-check          → pruefen (Exit 1 bei struktureller Drift)
 *   npx nc-l10n-check --fix    → Kataloge aus dem Code regenerieren
 *
 * Laeuft im Wurzelverzeichnis der App (cwd). Alles Weitere wird erkannt:
 * die App-ID aus appinfo/info.xml, die Sprachen aus den vorhandenen
 * l10n/*.json. Es gibt bewusst nichts zu konfigurieren — jeder Schalter waere
 * eine Stelle, an der die Apps wieder auseinanderlaufen koennen.
 *
 * Keine Laufzeit-Abhaengigkeiten.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const ROOT = process.cwd()
const L10N_DIR = join(ROOT, 'l10n')
const FIX = process.argv.includes('--fix')

// Quellsprache. Alle Apps der Flotte schreiben deutsche Quellstrings; in dieser
// Sprache gilt Wert == Key. Ein englischer Quellstring in einer deutschen App
// sieht uebersetzt aus, ist es aber nicht.
const SOURCE_LANG = 'de'

// Quellen der uebersetzbaren Strings. Frontend .ts gehoert dazu: die aelteren
// Apps sind Vue 2, die neueren Vue 3 mit TypeScript. Fehlt die Endung, waere ein
// t() in einer .ts-Datei unsichtbar — und --fix wuerde dessen Katalogeintrag als
// "tot" loeschen.
const FRONTEND_DIRS = ['src']
const FRONTEND_EXT = /\.(js|ts|vue)$/
const IS_TEST = /\.(test|spec)\.[jt]s$/
const BACKEND_DIRS = ['lib', 'templates', 'appinfo']
const BACKEND_EXT = /\.php$/

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function fail(msg) {
	console.error(red(`l10n-check: ${msg}`))
	process.exit(2)
}

// --- 0. App erkennen --------------------------------------------------------

/**
 * App-ID aus appinfo/info.xml. Bewusst nicht aus package.json: info.xml ist die
 * Quelle, auf die sich auch Nextcloud selbst und der t()-Aufruf beziehen.
 */
function detectAppId() {
	const path = join(ROOT, 'appinfo', 'info.xml')
	if (!existsSync(path)) fail(`appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren (cwd: ${ROOT})`)
	const m = readFileSync(path, 'utf8').match(/<id>\s*([^<\s]+)\s*<\/id>/)
	if (!m) fail('appinfo/info.xml enthaelt kein <id>-Element')
	return m[1]
}

/** Sprachen aus den vorhandenen l10n/<lang>.json. */
function detectLangs() {
	if (!existsSync(L10N_DIR)) fail('l10n/ nicht gefunden')
	const langs = readdirSync(L10N_DIR)
		.filter((f) => f.endsWith('.json'))
		.map((f) => f.slice(0, -5))
		.sort()
	if (!langs.length) fail('l10n/ enthaelt keine *.json')
	if (!langs.includes(SOURCE_LANG)) fail(`l10n/${SOURCE_LANG}.json fehlt — die Quellsprache muss vorhanden sein`)
	for (const lang of langs) {
		if (!existsSync(join(L10N_DIR, `${lang}.js`))) {
			fail(`l10n/${lang}.js fehlt. NC braucht beide Formate; ohne .js laedt der Browser keine Uebersetzung.`)
		}
	}
	return langs
}

const APP_ID = detectAppId()
const LANGS = detectLangs()

// --- 1. Kanonische Keys aus dem Quellcode -----------------------------------

function filesUnder(dir, re) {
	const out = []
	let entries
	try { entries = readdirSync(dir) } catch { return out } // Verzeichnis fehlt → leer
	for (const name of entries) {
		if (name === 'node_modules' || name === 'vendor' || name === '.git') continue
		const p = join(dir, name)
		if (statSync(p).isDirectory()) out.push(...filesUnder(p, re))
		else if (re.test(name)) out.push(p)
	}
	return out
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SQ = "'((?:[^'\\\\]|\\\\.)*)'"
// Frontend: t('<app>', '<literal>') — single-quoted, erstes Argument.
const T_FRONTEND = new RegExp(`\\bt\\(\\s*'${esc(APP_ID)}'\\s*,\\s*${SQ}`, 'g')
// Backend (PHP): $l->t('…') / ->t("…"); Whitespace toleriert (mehrzeilige Aufrufe).
const T_BACKEND_SQ = /->t\(\s*'((?:[^'\\]|\\.)*)'/g
const T_BACKEND_DQ = /->t\(\s*"((?:[^"\\]|\\.)*)"/g

// Plural: n('<app>', '<singular>', '<plural>') bzw. $l->n('…', '…', …).
// Nextcloud legt beides unter EINEM Katalogschluessel `_sing_::_plur_` ab, der
// Wert ist ein Array [sing, plur]. Ohne diese Erfassung haelt der Waechter genau
// diese Eintraege fuer tot und --fix loescht sie — projektwerk und vinarium
// nutzen Plurale.
const N_FRONTEND = new RegExp(`\\bn\\(\\s*'${esc(APP_ID)}'\\s*,\\s*${SQ}\\s*,\\s*${SQ}`, 'g')
const N_BACKEND = /->n\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g

/** Katalogschluessel einer Pluralform, so wie Nextcloud ihn bildet. */
const pluralKey = (sing, plur) => `_${sing}_::_${plur}_`

/** Zerlegt einen Pluralschluessel wieder in seine beiden Teile. */
function pluralParts(key) {
	const m = /^_([\s\S]*)_::_([\s\S]*)_$/.exec(key)
	return m ? [m[1], m[2]] : null
}

/**
 * Der Wert, den ein Schluessel in der Quellsprache traegt: bei einfachen Texten
 * der Schluessel selbst, bei Pluralen das Array [Singular, Plural].
 */
function sourceValue(key) {
	return pluralParts(key) ?? key
}

/** Tiefer Vergleich — Pluralwerte sind Arrays, `!==` wuerde immer anschlagen. */
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Dynamische Uebersetzung: t('<app>', variable) statt t('<app>', 'Literal').
// rechnungswerk uebersetzt so seine Einheiten- und Statuslabel ueber
// Konstanten-Maps: t('rechnungswerk', UNIT_CODE_LABELS[code]).
//
// Fuer solche Aufrufe kann kein Regex sagen, welcher Schluessel gemeint ist.
// Damit ist "tot" nicht mehr beweisbar — ein Katalogeintrag kann sehr wohl
// benutzt sein. Wo das vorkommt, wird aus dem harten Befund ein Hinweis, und
// --fix loescht nichts mehr. Fehlende Schluessel bleiben blockierend: die sind
// aus einem literalen Aufruf beweisbar.
const DYN_FRONTEND = new RegExp(`\\b[tn]\\(\\s*'${esc(APP_ID)}'\\s*,\\s*[^'\\s)]`, 'g')
const DYN_BACKEND = /->[tn]\(\s*[^'"\s)]/g

function findDynamicCalls() {
	const hits = []
	const scan = (dirs, ext, re, skipTests) => {
		for (const base of dirs) {
			for (const file of filesUnder(join(ROOT, base), ext)) {
				if (skipTests && IS_TEST.test(file)) continue
				const code = readFileSync(file, 'utf8')
				for (const m of code.matchAll(re)) {
					hits.push(`${file.slice(ROOT.length + 1)}: ${m[0].trim()}…`)
				}
			}
		}
	}
	scan(FRONTEND_DIRS, FRONTEND_EXT, DYN_FRONTEND, true)
	scan(BACKEND_DIRS, BACKEND_EXT, DYN_BACKEND, false)
	return hits
}

/** Escapes eines single-/double-quoted PHP/JS-Literals aufloesen. */
function unescapeQuoted(lit, quote) {
	return lit.replace(new RegExp(`\\\\([${quote}\\\\])`, 'g'), '$1')
}

function extractCanonicalKeys() {
	const keys = new Set()
	for (const base of FRONTEND_DIRS) {
		for (const file of filesUnder(join(ROOT, base), FRONTEND_EXT)) {
			if (IS_TEST.test(file)) continue // Teststrings gehoeren nicht in den Katalog
			const code = readFileSync(file, 'utf8')
			for (const m of code.matchAll(T_FRONTEND)) keys.add(unescapeQuoted(m[1], "'"))
			for (const m of code.matchAll(N_FRONTEND)) {
				keys.add(pluralKey(unescapeQuoted(m[1], "'"), unescapeQuoted(m[2], "'")))
			}
		}
	}
	for (const base of BACKEND_DIRS) {
		for (const file of filesUnder(join(ROOT, base), BACKEND_EXT)) {
			const code = readFileSync(file, 'utf8')
			for (const m of code.matchAll(T_BACKEND_SQ)) keys.add(unescapeQuoted(m[1], "'"))
			for (const m of code.matchAll(T_BACKEND_DQ)) keys.add(unescapeQuoted(m[1], '"'))
			for (const m of code.matchAll(N_BACKEND)) {
				keys.add(pluralKey(unescapeQuoted(m[1], "'"), unescapeQuoted(m[2], "'")))
			}
		}
	}
	return keys
}

// --- 2. Kataloge laden ------------------------------------------------------

/** l10n/<lang>.js → { map, plural }. Per kontrolliertem Eval (eigene Datei). */
function loadJs(lang) {
	const code = readFileSync(join(L10N_DIR, `${lang}.js`), 'utf8')
	let captured = null
	const sandbox = { OC: { L10N: { register(app, map, plural) { captured = { map, plural } } } } }
	runInNewContext(code, sandbox, { filename: `${lang}.js` })
	if (!captured) fail(`${lang}.js hat OC.L10N.register nicht aufgerufen`)
	return captured
}

/** l10n/<lang>.json → { translations, pluralForm }. */
function loadJson(lang) {
	const data = JSON.parse(readFileSync(join(L10N_DIR, `${lang}.json`), 'utf8'))
	return { translations: data.translations ?? {}, pluralForm: data.pluralForm ?? '' }
}

// --- 3. Kataloge schreiben (Format byte-genau wie Bestand) ------------------

function writeJs(lang, map, plural) {
	const entries = Object.entries(map)
		.map(([k, v]) => `    ${JSON.stringify(k)} : ${JSON.stringify(v)}`)
		.join(',\n')
	writeFileSync(join(L10N_DIR, `${lang}.js`),
		`OC.L10N.register(\n    "${APP_ID}",\n    {\n${entries}\n},\n"${plural}");\n`)
}

function writeJson(lang, translations, pluralForm) {
	writeFileSync(join(L10N_DIR, `${lang}.json`),
		JSON.stringify({ translations, pluralForm }, null, '\t') + '\n')
}

// --- 4. Pruefen -------------------------------------------------------------

const diff = (a, b) => [...a].filter((x) => !b.has(x))

function main() {
	const canonical = extractCanonicalKeys()
	const dynamic = findDynamicCalls()
	const problems = []
	const info = []

	const catalogs = {}
	for (const lang of LANGS) catalogs[lang] = { js: loadJs(lang), json: loadJson(lang) }

	for (const lang of LANGS) {
		const { js, json } = catalogs[lang]
		const jsKeys = new Set(Object.keys(js.map))
		const jsonKeys = new Set(Object.keys(json.translations))

		// (a) .js vs .json: identische Keys
		const onlyJs = diff(jsKeys, jsonKeys)
		const onlyJson = diff(jsonKeys, jsKeys)
		if (onlyJs.length || onlyJson.length) {
			problems.push(`${lang}: .js und .json haben unterschiedliche Keys `
				+ `(nur in .js: ${onlyJs.length}, nur in .json: ${onlyJson.length})`)
		}
		// (b) .js vs .json: identische Werte — faengt typografische Drift
		const valMismatch = [...jsKeys].filter((k) => jsonKeys.has(k) && !sameValue(js.map[k], json.translations[k]))
		if (valMismatch.length) {
			problems.push(`${lang}: ${valMismatch.length} Wert(e) weichen zwischen .js und .json ab `
				+ `(z.B. ${JSON.stringify(valMismatch[0])})`)
		}
		// (c) Key-Set vs Code
		const missing = diff(canonical, jsonKeys)
		const orphan = diff(jsonKeys, canonical)
		if (missing.length) {
			const label = lang === SOURCE_LANG ? 'fehlt im Quellkatalog' : 'fehlende Uebersetzung'
			problems.push(`${lang}: ${missing.length} Key(s) ${label} (z.B. ${JSON.stringify(missing[0])})`)
		}
		if (orphan.length) {
			const msg = `${lang}: ${orphan.length} Key(s) im Katalog, aber nicht im Code `
				+ `(z.B. ${JSON.stringify(orphan[0])})`
			if (dynamic.length) info.push(`${msg} — nicht beweisbar tot, siehe unten`)
			else problems.push(msg)
		}
		// (d) Hinweis, nicht blockierend: noch unuebersetzt
		if (lang !== SOURCE_LANG) {
			const untranslated = [...jsonKeys].filter((k) => canonical.has(k)
				&& sameValue(json.translations[k], sourceValue(k)))
			if (untranslated.length) {
				info.push(`${lang}: ${untranslated.length} Eintrag/Eintraege noch unuebersetzt (== Quelltext)`)
			}
		}
	}

	console.log(dim(`${APP_ID}: ${canonical.size} eindeutige Keys aus src/, lib/, templates/, appinfo/ `
		+ `— Sprachen: ${LANGS.join(', ')}`))

	if (FIX) return applyFix(canonical, catalogs, dynamic)

	for (const i of info) console.log(yellow('  ⚐ ' + i))
	if (dynamic.length) {
		console.log(yellow(`  ⚐ ${dynamic.length} dynamische(r) Aufruf(e) — welcher Schluessel gemeint ist,`
			+ ' laesst sich nicht ablesen. "Tot" ist hier nicht beweisbar und blockiert nicht.'))
		for (const d of dynamic.slice(0, 3)) console.log(dim(`      ${d}`))
		if (dynamic.length > 3) console.log(dim(`      … und ${dynamic.length - 3} weitere`))
	}

	if (!problems.length) {
		console.log(green('✓ l10n-Kataloge konsistent — keine Drift.'))
		process.exit(0)
	}

	console.log(red(`\n✗ ${problems.length} Konsistenz-Problem(e):`))
	for (const p of problems) console.log(red('  • ' + p))
	const others = LANGS.filter((l) => l !== SOURCE_LANG).join(',')
	console.log(dim('\n  Beheben:  npx nc-l10n-check --fix   (regeneriert die Kataloge aus dem Code)'))
	if (others) console.log(dim(`  Danach die neuen Keys in l10n/{${others}}.{js,json} uebersetzen.`))
	process.exit(1)
}

// --- 5. Fix: Kataloge aus Code regenerieren, vorhandene Werte erhalten -------

function applyFix(canonical, catalogs, dynamic) {
	const canonicalList = [...canonical]
	let changed = 0

	// Bei dynamischen Aufrufen wird NICHTS geloescht: ein Schluessel, der im Code
	// nicht als Literal steht, kann trotzdem ueber eine Variable benutzt werden.
	// Loeschen hiesse, lebende Uebersetzungen wegzuwerfen — in rechnungswerk
	// waeren das die Einheiten- und Statuslabel gewesen.
	const keepAll = dynamic.length > 0
	if (keepAll) {
		console.log(yellow(`  ⚐ ${dynamic.length} dynamische(r) Aufruf(e): es wird nur ergaenzt, nichts entfernt.`))
	}

	for (const lang of LANGS) {
		const { js, json } = catalogs[lang]
		const existing = json.translations
		const existingOrder = Object.keys(existing).filter((k) => keepAll || canonical.has(k))
		const newKeys = canonicalList.filter((k) => !(k in existing))
		const orderedKeys = [...existingOrder, ...newKeys]

		const map = {}
		for (const k of orderedKeys) {
			// Quellsprache: Wert == Quelltext (bei Pluralen das Array aus dem
			// Schluessel). In den uebrigen Sprachen bleibt ein vorhandener Wert
			// stehen; neue Keys bekommen den Quelltext als Platzhalter und
			// muessen von Hand uebersetzt werden.
			if (lang === SOURCE_LANG) map[k] = sourceValue(k)
			else map[k] = k in existing ? existing[k] : sourceValue(k)
		}

		if (JSON.stringify(existing) !== JSON.stringify(map)
			|| Object.keys(js.map).length !== orderedKeys.length) changed++

		writeJs(lang, map, js.plural || json.pluralForm)
		writeJson(lang, map, json.pluralForm || js.plural)

		const removed = keepAll ? 0 : Object.keys(existing).filter((k) => !canonical.has(k)).length
		console.log(`  ${lang}: ${green(`+${newKeys.length}`)} neu, ${red(`-${removed}`)} tot, ${orderedKeys.length} gesamt`)
	}

	const others = LANGS.filter((l) => l !== SOURCE_LANG).join('/')
	console.log(changed
		? green(`\n✓ Kataloge regeneriert.${others ? ` Bitte neue Keys in ${others} uebersetzen und committen.` : ''}`)
		: green('\n✓ Bereits konsistent — nichts zu tun.'))
}

main()
