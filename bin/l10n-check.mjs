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
 *   npx nc-l10n-check              → pruefen (Exit 1 bei struktureller Drift)
 *   npx nc-l10n-check --fix        → Kataloge aus dem Code regenerieren
 *   npx nc-l10n-check --add-de_DE  → wie --fix, legt zusaetzlich l10n/de_DE an
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
const ADD_FORMAL = process.argv.includes('--add-de_DE')
const FIX = ADD_FORMAL || process.argv.includes('--fix')

// Quellsprache. Alle Apps der Flotte schreiben deutsche Quellstrings; in dieser
// Sprache gilt Wert == Key. Ein englischer Quellstring in einer deutschen App
// sieht uebersetzt aus, ist es aber nicht.
const SOURCE_LANG = 'de'

// NC nimmt die Nutzersprache nur bei exaktem Katalog, ohne Rueckfall en_GB → en.
const COPY_VARIANTS = { en_GB: 'en' }
// NC: de = "Du", de_DE = "Sie". Gepflegt, weicht nur bei Anrede von der Quelle ab.
const FORMAL_LANG = 'de_DE'
// Nur Pronomen; Imperative ("Waehle" / "Waehlen Sie") sind per Regex nicht sicher.
const DU_WORDS = /\b(du|dich|dir|dein|deine|deinem|deinen|deiner|deines)\b/i
const SIE_WORDS = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/g
// Am Satzanfang kann "Sie"/"Ihr" auch 3. Person sein: dort nur Hinweis.
const SENTENCE_START = /(^|[.!?:;„"“(\n]\s*)$/

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

/**
 * Liest ab `pos` ein String-Literal und alle per `.` angehaengten weiteren
 * Literale, und gibt den zusammengesetzten Wert zurueck.
 *
 * PHP setzt lange Meldungen ueber mehrere Zeilen zusammen:
 *
 *     $this->l10n->t(
 *         'Erster Teil. '
 *         . 'Zweiter Teil.',
 *         [$wert],
 *     )
 *
 * Der Katalogschluessel ist der GANZE Satz. Wer nur das erste Literal liest,
 * traegt ein Fragment ein, das nie nachgeschlagen wird — der echte Schluessel
 * fehlt weiter, und die Meldung bleibt unuebersetzt. Genau so entstanden in
 * projektwerk fuenf unbrauchbare Eintraege, erkennbar am Leerzeichen am Ende.
 *
 * @return {{value: string, end: number}|null}
 */
function readConcatenatedLiteral(code, pos) {
	const parts = []
	let i = pos
	for (;;) {
		while (i < code.length && /\s/.test(code[i])) i++
		const quote = code[i]
		if (quote !== "'" && quote !== '"') break
		let j = i + 1
		let lit = ''
		while (j < code.length) {
			if (code[j] === '\\') { lit += code[j] + code[j + 1]; j += 2; continue }
			if (code[j] === quote) break
			lit += code[j]; j++
		}
		if (j >= code.length) return null // unabgeschlossenes Literal
		parts.push(unescapeQuoted(lit, quote))
		i = j + 1
		// Fortsetzung? Nur ein `.` zwischen zwei Literalen zaehlt.
		let k = i
		while (k < code.length && /\s/.test(code[k])) k++
		if (code[k] !== '.') break
		i = k + 1
	}
	return parts.length ? { value: parts.join(''), end: i } : null
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
			// ->t( und ->n( zeichengenau lesen statt per Regex: nur so kommen
			// ueber mehrere Zeilen zusammengesetzte Meldungen vollstaendig an.
			for (const m of code.matchAll(/->(t|n)\(/g)) {
				const erst = readConcatenatedLiteral(code, m.index + m[0].length)
				if (!erst) continue
				if (m[1] === 't') { keys.add(erst.value); continue }
				let i = erst.end
				while (i < code.length && /\s/.test(code[i])) i++
				if (code[i] !== ',') continue
				const zweit = readConcatenatedLiteral(code, i + 1)
				if (zweit) keys.add(pluralKey(erst.value, zweit.value))
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

/** Sprachen, die von Hand uebersetzt werden: ohne Quelle und ohne Kopien. */
const maintainedLangs = (langs) => langs.filter((l) => l !== SOURCE_LANG && !(l in COPY_VARIANTS))

const flat = (v) => (Array.isArray(v) ? v.join(' ') : v)
const sample = (keys) => keys.slice(0, 5).map((k) => `      ${JSON.stringify(k)}`).join('\n')
	+ (keys.length > 5 ? `\n      … und ${keys.length - 5} weitere` : '')

/** du-Formen in de_DE und Sie-Formen in der Quelle. */
function checkAddress(canonical, formal) {
	const problems = []
	const info = []

	const duInFormal = Object.keys(formal).filter((k) => DU_WORDS.test(flat(formal[k])))
	if (duInFormal.length) {
		problems.push(`${FORMAL_LANG}: ${duInFormal.length} Eintrag/Eintraege duzen — dort gehoert "Sie" hin:\n`
			+ sample(duInFormal))
	}

	const sieMid = []
	const sieStart = []
	for (const k of canonical) {
		const hits = [].concat(sourceValue(k)).flatMap((text) =>
			[...text.matchAll(SIE_WORDS)].map((m) => SENTENCE_START.test(text.slice(0, m.index))))
		if (hits.includes(false)) sieMid.push(k)
		else if (hits.length) sieStart.push(k)
	}
	if (sieMid.length) {
		problems.push(`${SOURCE_LANG}: ${sieMid.length} Quelltext(e) siezen — die Quelle duzt, "Sie" gehoert nach ${FORMAL_LANG}:\n`
			+ sample(sieMid))
	}
	if (sieStart.length) {
		info.push(`${SOURCE_LANG}: ${sieStart.length} Quelltext(e) beginnen mit "Sie"/"Ihr" — bitte pruefen, `
			+ `ob foermliche Anrede (dann umstellen) oder 3. Person:\n${sample(sieStart)}`)
	}
	return { problems, info }
}

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
		if (lang !== SOURCE_LANG && lang !== FORMAL_LANG && !(lang in COPY_VARIANTS)) {
			const untranslated = [...jsonKeys].filter((k) => canonical.has(k)
				&& sameValue(json.translations[k], sourceValue(k)))
			if (untranslated.length) {
				info.push(`${lang}: ${untranslated.length} Eintrag/Eintraege noch unuebersetzt (== Quelltext)`)
			}
		}
	}

	// (e) Sprachen untereinander: gleicher Schluesselsatz.
	//
	// Die Pruefungen (a) bis (d) laufen je Sprache und koennen das nicht sehen:
	// steht ein Schluessel nur in de und nicht in en, ist er fuer de weder
	// fehlend noch tot, und fuer en fehlt er auch nicht, weil er nicht im Code
	// steht. Beide Seiten melden gruen, der Katalog ist trotzdem schief.
	// Genau so lagen in vinarium drei veraltete Pluralschluessel nur noch in de.
	const refKeys = new Set(Object.keys(catalogs[SOURCE_LANG].json.translations))
	for (const lang of LANGS) {
		if (lang === SOURCE_LANG) continue
		const keys = new Set(Object.keys(catalogs[lang].json.translations))
		const fehlt = diff(refKeys, keys)
		const zuviel = diff(keys, refKeys)
		if (fehlt.length || zuviel.length) {
			problems.push(`${lang}: Schluesselsatz weicht von ${SOURCE_LANG} ab `
				+ `(fehlen: ${fehlt.length}, zusaetzlich: ${zuviel.length}`
				+ `${fehlt.length ? `, z.B. ${JSON.stringify(fehlt[0])}` : ''})`)
		}
	}

	// (f) Regionale Varianten: Kopie aktuell, foermliche Anrede getrennt
	for (const [variant, base] of Object.entries(COPY_VARIANTS)) {
		if (!LANGS.includes(base)) continue
		if (!LANGS.includes(variant)) {
			info.push(`${variant} fehlt — Nutzer mit dieser Sprache sehen die App in der Browsersprache. `
				+ `--fix legt ihn als Kopie von ${base} an.`)
		} else if (!sameValue(catalogs[variant].json, catalogs[base].json)) {
			problems.push(`${variant}: weicht von ${base} ab — muss eine exakte Kopie sein, --fix gleicht an`)
		}
	}
	if (!LANGS.includes(FORMAL_LANG)) {
		info.push(`${FORMAL_LANG} fehlt — Nutzer mit "Deutsch (Foermlich: Sie)" sehen die App in der `
			+ 'Browsersprache. --add-de_DE legt ihn an.')
	} else {
		const anrede = checkAddress(canonical, catalogs[FORMAL_LANG].json.translations)
		problems.push(...anrede.problems)
		info.push(...anrede.info)
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
	const others = maintainedLangs(LANGS).join(',')
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

	const langs = LANGS.filter((l) => !(l in COPY_VARIANTS && LANGS.includes(COPY_VARIANTS[l])))
	if (ADD_FORMAL && !langs.includes(FORMAL_LANG)) {
		const src = catalogs[SOURCE_LANG]
		catalogs[FORMAL_LANG] = {
			js: { map: { ...src.js.map }, plural: src.js.plural },
			json: { translations: { ...src.json.translations }, pluralForm: src.json.pluralForm },
		}
		langs.push(FORMAL_LANG)
	}
	const written = {}

	for (const lang of langs) {
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

		const plural = js.plural || json.pluralForm
		const pluralForm = json.pluralForm || js.plural
		writeJs(lang, map, plural)
		writeJson(lang, map, pluralForm)
		written[lang] = { map, plural, pluralForm }

		const removed = keepAll ? 0 : Object.keys(existing).filter((k) => !canonical.has(k)).length
		console.log(`  ${lang}: ${green(`+${newKeys.length}`)} neu, ${red(`-${removed}`)} tot, ${orderedKeys.length} gesamt`)
	}

	for (const [variant, base] of Object.entries(COPY_VARIANTS)) {
		if (!written[base]) continue
		const { map, plural, pluralForm } = written[base]
		const old = catalogs[variant]?.json
		if (!old || !sameValue(old, { translations: map, pluralForm })) changed++
		writeJs(variant, map, plural)
		writeJson(variant, map, pluralForm)
		console.log(`  ${variant}: Kopie von ${base}${old ? '' : green(' (neu angelegt)')}`)
	}

	if (ADD_FORMAL && !LANGS.includes(FORMAL_LANG)) {
		console.log(yellow(`\n  ${FORMAL_LANG} angelegt als Kopie von ${SOURCE_LANG}. Jetzt die Texte mit Anrede dort auf "Sie"`
			+ ' umstellen — npx nc-l10n-check listet sie auf.'))
	}

	const others = maintainedLangs(langs).join('/')
	console.log(changed
		? green(`\n✓ Kataloge regeneriert.${others ? ` Bitte neue Keys in ${others} uebersetzen und committen.` : ''}`)
		: green('\n✓ Bereits konsistent — nichts zu tun.'))
}

main()
