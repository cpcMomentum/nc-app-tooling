#!/usr/bin/env node
/**
 * nc-schema-check — prueft Migrationen auf Schema-Portabilitaet ueber die von
 * Nextcloud unterstuetzten Datenbanken.
 *
 *   npx nc-schema-check          # im Wurzelverzeichnis der App
 *
 * ANLASS: worktime v0.16.0 legte eine Types::BOOLEAN-Spalte mit
 * 'notnull' => true an. Alle 15 Tarball-Checks und der Upgrade-Test waren
 * gruen — beim Nutzer brach das App-Update ab:
 *
 *   Column "oc_wt_employees"."vacation_transferred" is type Bool and also
 *   NotNull, so it can not store "false".
 *
 * WARUM NICHTS DAS GEFANGEN HAT: Migrationen werden in der ganzen Pipeline
 * genau einmal ausgefuehrt — im Upgrade-Test des Release, und der laeuft gegen
 * die lokale Dev-Instanz. Die ist Postgres, und Postgres nimmt eine NOT-NULL-
 * Boolean klaglos. Die Unit-Tests laufen gegen die nextcloud/ocp-Stubs und
 * fuehren gar keine Migration aus (nc-app-tooling#7).
 *
 * WAS HIER GEPRUEFT WIRD, UND WOHER DIE REGELN STAMMEN: aus
 * lib/private/DB/MigrationService.php von Nextcloud selbst, gelesen in v32.0.0,
 * v33.0.0 und 34.0.0 — nicht aus der Dokumentation und nicht aus dem
 * Gedaechtnis. Die Regeln haben zwei Gueltigkeitsbedingungen, und ohne sie
 * meldet der Pruefer die halbe Flotte falsch rot:
 *
 *   1. ensureOracleConstraints() laeuft nur, wenn checkOracle gesetzt ist.
 *      Gesetzt wird es, wenn info.xml GAR KEINE <database>-Abhaengigkeit
 *      deklariert — oder ausdruecklich 'oci'. Wer sqlite/mysql/pgsql angibt,
 *      ist von diesen Regeln ausgenommen (MigrationService, Konstruktor).
 *   2. Die Regeln haben sich zwischen den NC-Versionen verschoben. In v32
 *      wirft die NOT-NULL-Boolean; seit v33 wird sie auf Oracle still auf
 *      nullable gesetzt (nextcloud/server#55156). Die Laengengrenzen sind
 *      umgekehrt gewandert: v32 kannte die scharfen Oracle-Grenzen (30/27/22),
 *      seit v33 gilt eine glatte 63 fuer alle. Welche gelten, haengt an
 *      min-version in info.xml.
 *
 * Geprueft wird STATISCH. Der ehrliche Weg waere, NCs eigenen Validator gegen
 * das erzeugte Schema laufen zu lassen — das braucht aber je App und je
 * NC-Version einen NC-Container samt Datenbank. Fuer vier klar umrissene
 * Regeln, deren Quelltext hier zeilengenau nachgelesen ist, steht das nicht im
 * Verhaeltnis. Die Grenze des Verfahrens steht in der README.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

// Das Standard-Praefix einer Nextcloud-Installation. Es geht in die
// Tabellennamen-Grenze ein (MigrationService bekommt strlen($prefix) gereicht).
// Eine Instanz kann ein laengeres setzen; dann ist diese Pruefung die
// nachsichtigere von beiden, nie die strengere.
const PRAEFIX_LAENGE = 3

if (!existsSync('appinfo/info.xml')) {
	console.error(red('nc-schema-check: appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.'))
	process.exit(2)
}

// --- info.xml: welche Regeln gelten ueberhaupt ------------------------------

const info = readFileSync('appinfo/info.xml', 'utf8')

const datenbanken = [...info.matchAll(/<database\b[^>]*>([^<]*)<\/database>/g)].map((m) => m[1].trim())
// Der Konstruktor von MigrationService: keine <database>-Deklaration heisst
// "koennte auf Oracle laufen" — und dann greifen die Oracle-Regeln.
const oracleRelevant = datenbanken.length === 0 || datenbanken.includes('oci')

const minTreffer = info.match(/<nextcloud[^>]*\bmin-version="(\d+)"/)
const minVersion = minTreffer ? Number(minTreffer[1]) : 0
// Ohne min-version wird der strengere Satz angenommen: lieber ein Hinweis zu
// viel als ein gebrochenes Update auf einer alten Instanz.
const nc32Regeln = oracleRelevant && minVersion <= 32

// --- Migrationen einlesen ---------------------------------------------------

const VERZEICHNIS = join('lib', 'Migration')
const dateien = existsSync(VERZEICHNIS)
	? readdirSync(VERZEICHNIS).filter((f) => f.endsWith('.php')).sort().map((f) => join(VERZEICHNIS, f))
	: []

if (!dateien.length) {
	console.log(green('✓ nc-schema-check: keine Migrationen gefunden, nichts zu pruefen.'))
	process.exit(0)
}

/**
 * Zerlegt die Argumentliste eines Aufrufs ab der oeffnenden Klammer.
 * Beachtet Verschachtelung und Zeichenketten, damit ein Komma in einem
 * Array-Literal oder in einer Meldung die Liste nicht zerreisst.
 */
function argumente(quelle, klammerAuf) {
	const args = []
	let tiefe = 0
	let start = klammerAuf + 1
	let quote = null
	for (let i = start; i < quelle.length; i++) {
		const c = quelle[i]
		if (quote) {
			if (c === '\\') i++
			else if (c === quote) quote = null
			continue
		}
		if (c === "'" || c === '"') { quote = c; continue }
		if (c === '(' || c === '[' || c === '{') tiefe++
		else if (c === ')' || c === ']' || c === '}') {
			if (c === ')' && tiefe === 0) {
				args.push(quelle.slice(start, i))
				return { args, ende: i }
			}
			tiefe--
		} else if (c === ',' && tiefe === 0) {
			args.push(quelle.slice(start, i))
			start = i + 1
		}
	}
	return { args, ende: quelle.length }
}

const zeileVon = (quelle, index) => quelle.slice(0, index).split('\n').length
const alsName = (arg) => (arg.trim().match(/^['"]([^'"]*)['"]$/) || [])[1] ?? null

/** Types::BOOLEAN → boolean, 'string' → string. Sonst null. */
function alsTyp(arg) {
	const t = arg.trim()
	const konstante = t.match(/Types::([A-Z_]+)/)
	if (konstante) return konstante[1].toLowerCase()
	const literal = alsName(t)
	return literal ? literal.toLowerCase() : null
}

/** Liest die Optionen eines addColumn-Aufrufs aus dem Array-Literal. */
function optionen(arg) {
	const o = {}
	const notnull = arg.match(/['"]notnull['"]\s*=>\s*(true|false)/i)
	if (notnull) o.notnull = notnull[1].toLowerCase() === 'true'
	const laenge = arg.match(/['"]length['"]\s*=>\s*(\d+)/i)
	if (laenge) o.length = Number(laenge[1])
	const vorgabe = arg.match(/['"]default['"]\s*=>\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\]\s]+)/i)
	if (vorgabe) o.default = vorgabe[1].trim()
	return o
}

const befunde = []
const melde = (datei, zeile, regel, text, hinweis) =>
	befunde.push({ datei, zeile, regel, text, hinweis })

let spalten = 0
let tabellen = 0
// Bezeichner, die erst zur Laufzeit feststehen (`addColumn($spalte, ...)`).
// Ihre Optionen sind trotzdem pruefbar, ihre Laenge nicht — und was ein
// Pruefer nicht sehen kann, muss er sagen, sonst liest sich sein Gruen wie
// eine Zusage, die er nicht gibt.
const unklar = []

const AUFRUF = /(\$[A-Za-z_]\w*)\s*->\s*(createTable|getTable|addColumn|addIndex|addUniqueIndex|setPrimaryKey)\s*\(/g

for (const datei of dateien) {
	const quelle = readFileSync(datei, 'utf8')
	// Variable → Tabelle. `neu` unterscheidet createTable von getTable: einige
	// Regeln greifen nur beim Anlegen, andere nur beim Erweitern.
	const bindung = new Map()
	const angelegte = []
	let letzte = null

	AUFRUF.lastIndex = 0
	let m
	while ((m = AUFRUF.exec(quelle)) !== null) {
		const [treffer, empfaenger, methode] = m
		const klammerAuf = m.index + treffer.length - 1
		const { args } = argumente(quelle, klammerAuf)
		const zeile = zeileVon(quelle, m.index)

		if (methode === 'createTable' || methode === 'getTable') {
			const name = alsName(args[0] ?? '')
			if (!name) continue
			const tabelle = { name, neu: methode === 'createTable', zeile, pkStandardname: false }
			letzte = tabelle
			// `$table = $schema->createTable('x');` — die Zuweisung steht links
			// vom Aufruf, in derselben Anweisung.
			const davor = quelle.slice(Math.max(0, m.index - 120), m.index)
			const zuweisung = davor.match(/(\$[A-Za-z_]\w*)\s*=\s*[^;]*$/)
			if (zuweisung) bindung.set(zuweisung[1], tabelle)
			if (tabelle.neu) {
				tabellen++
				angelegte.push(tabelle)
			}
			continue
		}

		// Fuer alles andere: die Tabelle hinter der Empfaengervariablen. Ist sie
		// unbekannt (verketteter Aufruf), gilt die zuletzt gesehene.
		const tabelle = bindung.get(empfaenger) ?? letzte
		if (!tabelle) continue

		if (methode === 'addColumn') {
			const roh = (args[0] ?? '').trim()
			const name = alsName(roh)
			const typ = alsTyp(args[1] ?? '')
			const opt = optionen(args[2] ?? '')
			if (!roh) continue
			spalten++
			if (!name) unklar.push(`${datei}:${zeile}  Spalte ${roh}`)
			pruefeSpalte(datei, zeile, tabelle, name, roh, typ, opt)
			continue
		}

		if (methode === 'addIndex' || methode === 'addUniqueIndex') {
			// addIndex(['spalte'], 'name') — ohne zweites Argument vergibt
			// Doctrine den Namen selbst, dann gibt es nichts zu messen.
			const roh = (args[1] ?? '').trim()
			const name = alsName(roh)
			if (name) pruefeName(datei, zeile, 'Indexname', `"${tabelle.name}"."${name}"`, name)
			else if (roh) unklar.push(`${datei}:${zeile}  Index ${roh}`)
			continue
		}

		if (methode === 'setPrimaryKey') {
			const name = alsName(args[1] ?? '')
			if (name) pruefeName(datei, zeile, 'Primaerschluesselname', `"${tabelle.name}"."${name}"`, name)
			// Ohne eigenen Namen benennt die Datenbank den Schluessel selbst —
			// dann greift in NC 32 die schaerfere Tabellennamen-Grenze.
			else if (tabelle.neu) tabelle.pkStandardname = true
			continue
		}
	}

	// Tabellennamen erst am Ende der Datei bewerten: ob der Primaerschluessel
	// einen eigenen Namen bekommt, steht erst nach den Spalten fest.
	for (const tabelle of angelegte) pruefeTabellenname(datei, tabelle)
}

// --- Die Regeln -------------------------------------------------------------

function pruefeSpalte(datei, zeile, tabelle, name, roh, typ, opt) {
	// Steht der Name erst zur Laufzeit fest, bleiben Typ und Optionen trotzdem
	// im Quelltext sichtbar — nur die Laenge nicht.
	const bezeichner = name ?? roh
	// Doctrine setzt Column::$_notnull auf true, wenn die Option fehlt
	// (3rdparty/doctrine/dbal/src/Schema/Column.php). Wer sie weglaesst, bekommt
	// NOT NULL — und faellt in dieselbe Falle wie der, der es hinschreibt.
	const notnull = opt.notnull ?? true
	// Regel 1: NOT-NULL-Boolean. Der Vorfall.
	if (oracleRelevant && typ === 'boolean' && notnull) {
		melde(datei, zeile, 'NOT-NULL-Boolean',
			`"${tabelle.name}"."${bezeichner}" ist Types::BOOLEAN `
				+ (opt.notnull === true ? "mit 'notnull' => true" : "ohne 'notnull' => false (Doctrine setzt NOT NULL)"),
			minVersion <= 32
				? 'NC 32 bricht das Update ab ("is type Bool and also NotNull"). Portabel: '
					+ "'notnull' => false mit 'default' => false, oder Types::SMALLINT (0/1)."
				: 'Auf Oracle setzt NC das NOT NULL still zurueck — das Schema weicht dann '
					+ "vom Entwurf ab. Portabel: 'notnull' => false, oder Types::SMALLINT (0/1).")
	}

	// Regel 2: NOT NULL mit leerer Vorgabe. NC wirft nur, wenn die Spalte einer
	// BESTEHENDEN Tabelle hinzugefuegt wird — beim Anlegen einer neuen Tabelle
	// ist sourceTable null und die Bedingung faellt durch. Genau so hier, sonst
	// waere es ein Fehlalarm gegen Code, den NC durchlaesst.
	if (oracleRelevant && !tabelle.neu && notnull
		&& (opt.default === "''" || opt.default === '""')) {
		melde(datei, zeile, 'NOT NULL mit Leer-Vorgabe',
			`"${tabelle.name}"."${bezeichner}" ist notnull mit ${opt.default} als default`,
			'Auf Oracle sind Leerstring und NULL dasselbe — NC lehnt die Kombination ab. '
				+ 'Entweder eine echte Vorgabe setzen oder die Spalte nullable machen.')
	}

	// Regel 3: string laenger als 4000.
	if (oracleRelevant && typ === 'string' && (opt.length ?? 0) > 4000) {
		melde(datei, zeile, 'String ueber 4000',
			`"${tabelle.name}"."${bezeichner}" ist Types::STRING mit 'length' => ${opt.length}`,
			'Ueber 4.000 Zeichen verlangt NC Types::TEXT.')
	}

	// Regel 4: Spaltenname. Nur messbar, wenn er im Quelltext steht.
	if (name) pruefeName(datei, zeile, 'Spaltenname', `"${tabelle.name}"."${name}"`, name)
}

/** Laengengrenzen fuer Spalten-, Index- und Schluesselnamen. */
function pruefeName(datei, zeile, art, bezeichnung, name) {
	// `art` ist die fertige Bezeichnung, nicht der Wortstamm: aus "Index" und
	// "Spalte" laesst sich kein gemeinsames Wort bilden, das in beiden Faellen
	// stimmt.
	if (name.length > 63) {
		melde(datei, zeile, `${art} zu lang`,
			`${bezeichnung} hat ${name.length} Zeichen`,
			'NC 33+ laesst hoechstens 63 zu (ensureNamingConstraints).')
		return
	}
	if (nc32Regeln && name.length > 30) {
		melde(datei, zeile, `${art} zu lang`,
			`${bezeichnung} hat ${name.length} Zeichen`,
			`NC ${minVersion} laesst fuer diese App hoechstens 30 zu (Oracle-Grenze, `
				+ 'greift weil info.xml keine <database>-Abhaengigkeit deklariert).')
	}
}

/** Laengengrenzen fuer neu angelegte Tabellen. */
function pruefeTabellenname(datei, tabelle) {
	const n = tabelle.name.length
	if (n + PRAEFIX_LAENGE > 63) {
		melde(datei, tabelle.zeile, 'Tabellenname zu lang',
			`"${tabelle.name}" hat ${n} Zeichen (+${PRAEFIX_LAENGE} Praefix)`,
			'NC 33+ laesst mit Praefix hoechstens 63 zu.')
		return
	}
	if (!nc32Regeln) return
	// NC 32: 27 Zeichen fuer den blanken Namen — aber nur 22, wenn der
	// Primaerschluessel keinen eigenen Namen bekommt, weil die Datenbank ihren
	// Standardnamen daraus ableitet.
	const grenze = tabelle.pkStandardname ? 22 : 27
	if (n > grenze) {
		melde(datei, tabelle.zeile, 'Tabellenname zu lang',
			`"${tabelle.name}" hat ${n} Zeichen`,
			`NC ${minVersion} laesst hier hoechstens ${grenze} zu`
				+ (tabelle.pkStandardname
					? ' (setPrimaryKey ohne eigenen Namen — die Datenbank leitet ihn vom Tabellennamen ab).'
					: ' (Oracle-Grenze).'))
	}
}

// --- Ergebnis ---------------------------------------------------------------

const umfang = `${dateien.length} Migration(en), ${tabellen} neue Tabelle(n), ${spalten} Spalte(n)`

function nenneUnklare() {
	if (!unklar.length) return
	console.log(yellow(`⚐ ${unklar.length} Bezeichner steht erst zur Laufzeit fest — Laenge ungeprueft:`))
	unklar.forEach((u) => console.log(`  ${u}`))
	console.log(dim('  Typ und Optionen sind trotzdem geprueft.'))
	console.log('')
}

if (!befunde.length) {
	nenneUnklare()
	console.log(green(`✓ nc-schema-check: Schema ist portabel (${umfang}).`))
	if (!oracleRelevant) {
		console.log(dim(`  Oracle-Regeln uebersprungen — info.xml deklariert ${datenbanken.join(', ')}.`))
	}
	process.exit(0)
}

console.log(red(`✗ nc-schema-check: ${befunde.length} Portabilitaetsproblem(e) (${umfang}).`) + '\n')
nenneUnklare()
for (const b of befunde) {
	console.log(`${b.datei}:${b.zeile}  ${yellow(b.regel)}`)
	console.log(`  ${b.text}`)
	console.log(dim(`  ${b.hinweis}`))
	console.log('')
}
console.log('So ein Schema besteht jeden Tarball-Check und den Upgrade-Test gegen')
console.log('Postgres — und bricht beim Nutzer das App-Update ab (worktime#596).')
process.exit(1)
