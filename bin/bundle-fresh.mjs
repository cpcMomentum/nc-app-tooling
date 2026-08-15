#!/usr/bin/env node
/**
 * nc-bundle-fresh — prueft, ob das vorliegende Bundle zum Quellstand passt.
 *
 *   npx nc-bundle-fresh          # im Wurzelverzeichnis der App
 *
 * Der Release baut in Schritt 3.1, packt aber in Schritt 5.1 einfach, was im
 * Arbeitsbaum liegt. Dazwischen prueft nichts, ob dieses Bundle zum Quellstand
 * passt — keiner der 15 Tarball-Checks vergleicht Bundle gegen src/. Ein
 * veraltetes, aber vorhandenes Bundle besteht damit jede Pruefung
 * (nc-app-tooling#2).
 *
 * WAS GENAU VERGLICHEN WIRD, UND WARUM AUSGERECHNET DAS:
 * Der Release liefert `git archive HEAD` plus das `js/` und `css/` aus dem
 * Arbeitsbaum aus (Sign-Tree in Schritt 4.1, Tarball in Schritt 5.1). Also:
 *
 *   Quellen  = HEAD          →  hier wird daraus neu gebaut
 *   Bundle   = Arbeitsbaum   →  dagegen wird verglichen
 *
 * Das ist genau das Paar, das beim Nutzer landet. Ein schmutziger Arbeitsbaum
 * verfaelscht das Ergebnis deshalb NICHT: was nicht committet ist, wird auch
 * nicht ausgeliefert.
 *
 * WARUM DER VERGLEICH TRAEGT: Der Build ist nachweislich deterministisch —
 * drei Laeufe je App (projektwerk, vinarium), auch mit kaltem Cache,
 * byte-identisch. Der frueher gemessene Byte-Unterschied (contractmanager#251)
 * kam von einer floatenden Installation, nicht vom Build: die CI wirft den Lock
 * weg (npm/cli#4828). Hier wird deshalb mit `npm ci` aus dem Lockfile von HEAD
 * installiert. Gegenprobe am 15.08.2026: alle fuenf Apps laufen so durch,
 * contractmanager eingeschlossen.
 *
 * (Die Annahme „keine Content-Hashes in den Dateinamen" aus dem Issue stimmt
 * nur fuer drei Apps. worktime und rechnungswerk haben welche. Fuer den
 * Vergleich macht das nichts — er haengt am Inhalt, nicht am Namen.)
 *
 * Nicht verglichen werden `*.map` und `*.LICENSE.txt`: beide stehen in den
 * Tarball-Excludes des Release-Skills, erreichen also nie einen Nutzer.
 * Sourcemaps tragen ausserdem den Build-Pfad im Inhalt und wuerden allein
 * deshalb immer abweichen.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const argv = process.argv.slice(2)
const AUSFUEHRLICH = argv.includes('--verbose')
const BEHALTEN = argv.includes('--keep')

if (!existsSync('appinfo/info.xml')) {
	console.error(red('nc-bundle-fresh: appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.'))
	process.exit(2)
}
if (!existsSync('package.json')) {
	console.error(red('nc-bundle-fresh: package.json nicht gefunden.'))
	process.exit(2)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (!pkg.scripts?.build) {
	console.error(red('nc-bundle-fresh: package.json hat kein "build"-Skript — nichts zu vergleichen.'))
	process.exit(2)
}
if (!existsSync('package-lock.json')) {
	console.error(red('nc-bundle-fresh: package-lock.json fehlt.'))
	console.error('Ohne Lockfile ist die Installation nicht reproduzierbar und der Vergleich waere Rauschen.')
	process.exit(2)
}

// Verglichen wird das kompilierte Bundle, sonst nichts. In `js/` und `css/`
// wohnt naemlich nicht nur Ausgabe: contractmanager importiert `css/main.scss`
// aus `src/main.ts` — eine Build-EINGABE im Ausgabeordner.
const KOMPILIERT = /\.(m|c)?js$|\.css$/
// `*.map` und `*.LICENSE.txt` stehen in den Tarball-Excludes (Release-Skill
// 5.1) und erreichen nie einen Nutzer. Sourcemaps tragen zusaetzlich den
// Build-Pfad im Inhalt und wuerden allein deshalb immer abweichen. Sie fliegen
// aus dem Vergleich, werden im Referenz-Verzeichnis aber trotzdem geloescht —
// sonst laege dort noch der alte Stand herum.
const NICHT_AUSGELIEFERT = /\.map$|\.LICENSE\.txt$/

const ORDNER = ['js', 'css']

/** Alle Dateien unterhalb von <wurzel>/js und <wurzel>/css, relativ zu <wurzel>. */
function dateienUnter(wurzel) {
	const gefunden = []
	const ab = (verzeichnis) => {
		for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
			const p = join(verzeichnis, eintrag.name)
			if (eintrag.isDirectory()) ab(p)
			else if (eintrag.isFile()) gefunden.push(relative(wurzel, p).split(sep).join('/'))
		}
	}
	for (const ordner of ORDNER) {
		const start = join(wurzel, ordner)
		if (existsSync(start)) ab(start)
	}
	return gefunden
}

function hashesVon(wurzel) {
	const map = new Map()
	for (const rel of dateienUnter(wurzel)) {
		if (!KOMPILIERT.test(rel) || NICHT_AUSGELIEFERT.test(rel)) continue
		map.set(rel, createHash('sha256').update(readFileSync(join(wurzel, rel))).digest('hex'))
	}
	return map
}

const APP = readFileSync('appinfo/info.xml', 'utf8').match(/<id>\s*([^<\s]+)\s*<\/id>/)?.[1] ?? pkg.name
const HEAD = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
console.log(`${APP} — Bundle-Frische gegen HEAD ${HEAD}\n`)

const vorhanden = hashesVon(process.cwd())
if (!vorhanden.size) {
	console.error(red('nc-bundle-fresh: weder js/ noch css/ enthalten vergleichbare Dateien.'))
	process.exit(2)
}

// Aufraeumen ueber das exit-Ereignis statt ueber finally: `process.exit()`
// wickelt den Stack nicht ab, ein finally-Block liefe also bei jedem
// Fehlerausgang unterhalb nicht — und jeder Lauf liesse ein node_modules
// im Temp-Verzeichnis zurueck.
let tmp = mkdtempSync(join(tmpdir(), 'nc-bundle-fresh-'))
process.on('exit', () => {
	if (BEHALTEN) console.log(dim(`\nBuild-Verzeichnis behalten: ${tmp}`))
	else rmSync(tmp, { recursive: true, force: true })
})

{
	const bau = join(tmp, APP)

	// Quellstand aus HEAD auspacken — nicht aus dem Arbeitsbaum. Ausgeliefert
	// wird HEAD; was nur im Arbeitsbaum liegt, geht den Nutzer nichts an.
	execFileSync('bash', ['-c', `mkdir -p '${bau}' && git archive HEAD | tar -x -C '${bau}'`], { stdio: 'inherit' })

	// Das alte Bundle kommt mit dem Archiv mit, denn js/ und css/ sind in Git
	// getrackt. Es muss weg, sonst ist die Referenz kein Neubau, sondern der
	// alte Stand mit ein paar ueberschriebenen Dateien. Zwei Gruende, warum das
	// nicht egal ist:
	//   - Die Vite-Apps bauen mit `cp -r dist/js/* js/`, das raeumt nicht auf.
	//     Ein Rest aus einem aelteren Build bliebe unsichtbar.
	//   - Webpack schreibt eine Datei nicht neu, wenn der Inhalt gleich bleibt
	//     (`output.compareBeforeEmit`). Bei worktime blieben so drei von vier
	//     Bundle-Dateien ununterscheidbar von Build-EINGABEN.
	//
	// Geloescht wird nur, was kompiliert ist. Der ganze Ordner darf es nicht
	// sein: contractmanager importiert `css/main.scss` aus `src/main.ts`, und
	// ohne diese Datei bricht der Build ab ("Could not resolve ../css/main.scss",
	// gemessen 15.08.2026). Genau derselbe Grund, aus dem der Vergleich sich
	// auf kompilierte Dateien beschraenkt.
	for (const rel of dateienUnter(bau)) {
		if (KOMPILIERT.test(rel) || NICHT_AUSGELIEFERT.test(rel)) rmSync(join(bau, rel), { force: true })
	}

	const lauf = (titel, befehl, args) => {
		process.stdout.write(dim(`  ${titel} … `))
		const r = spawnSync(befehl, args, {
			cwd: bau,
			encoding: 'utf8',
			stdio: AUSFUEHRLICH ? 'inherit' : 'pipe',
			env: { ...process.env, CI: '1' },
		})
		if (r.status !== 0) {
			console.log(red('fehlgeschlagen'))
			if (!AUSFUEHRLICH) {
				console.log(dim((r.stderr || r.stdout || '').split('\n').slice(-25).join('\n')))
			}
			console.error(red(`\n✗ ${titel} schlug fehl. Ohne Referenz-Build gibt es nichts zu vergleichen.`))
			console.error('Mit --verbose laeuft der Build sichtbar.')
			process.exit(2)
		}
		console.log(green('ok'))
	}

	lauf('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'])
	lauf('npm run build', 'npm', ['run', 'build'])

	const referenz = hashesVon(bau)
	if (!referenz.size) {
		console.error(red('\nnc-bundle-fresh: der Build erzeugte weder unter js/ noch unter css/ etwas — Vergleich nicht moeglich.'))
		process.exit(2)
	}

	const alle = [...new Set([...vorhanden.keys(), ...referenz.keys()])].sort()
	const abweichend = []
	const fehlend = []
	const ueberzaehlig = []
	for (const rel of alle) {
		const a = vorhanden.get(rel)
		const b = referenz.get(rel)
		if (a && !b) ueberzaehlig.push(rel)
		else if (!a && b) fehlend.push(rel)
		else if (a !== b) abweichend.push(rel)
	}

	const zeigen = (titel, liste, erklaerung) => {
		if (!liste.length) return
		console.log(`${titel} (${liste.length}):`)
		liste.slice(0, 12).forEach((f) => console.log(`  • ${f}`))
		if (liste.length > 12) console.log(dim(`  … und ${liste.length - 12} weitere`))
		console.log(dim(`  ${erklaerung}`))
		console.log('')
	}

	console.log('')
	// Nicht blockierend: eine ueberzaehlige Datei ist Totgewicht, kein alter
	// ausgelieferter Code. Was auf sie zeigen wuerde, ist die Einstiegsdatei —
	// und die wird byte-genau verglichen. Genannt wird sie trotzdem, sonst
	// sammelt sich das ueber Jahre an.
	if (ueberzaehlig.length) {
		zeigen(yellow('⚐ Ueberzaehlig im Arbeitsbaum'), ueberzaehlig,
			'Rest eines aelteren Builds — der Build legt sie nicht mehr an.')
	}

	if (!abweichend.length && !fehlend.length) {
		console.log(green(`✓ Bundle passt zum Quellstand (${referenz.size} Datei(en) verglichen).`))
		process.exit(0)
	}

	console.log(red('✗ Bundle passt NICHT zum Quellstand von HEAD.') + '\n')
	zeigen('Inhalt weicht ab', abweichend, 'Das ausgelieferte Bundle stammt aus einem anderen Quellstand.')
	zeigen('Fehlt im Arbeitsbaum', fehlend, 'Der Build erzeugt diese Datei, ausgeliefert wuerde sie nicht.')

	console.log('Der Release packt die Quellen aus HEAD und das Bundle aus dem')
	console.log('Arbeitsbaum. Beides passt hier nicht zusammen — es ginge alter')
	console.log('Code raus, und keine Testsuite faellt darueber.')
	console.log('')
	console.log('  rm -rf js/ css/ && npm ci && npm run build')
	console.log('  und das Ergebnis mitcommitten, dann Signatur und Tarball neu bauen')
	console.log('')
	console.log(dim('Haeufigster Grund: Auto-Fix-Commits des Bots kamen nach dem Build'))
	console.log(dim('auf den Release-Branch (Release-Skill, Regel 8).'))
	process.exit(1)
}
