#!/usr/bin/env node
/**
 * nc-pack — erzeugt den Release-Baum (Sign-Tree = Tarball-Tree) aus EINER Quelle.
 *
 *   npx nc-pack [--out <dir>] [--verbose]
 *
 * Im Wurzelverzeichnis der App ausfuehren. Ergebnis: <out>/<app>/ —
 * signierfertig. Ohne --out ein frisches Temp-Verzeichnis; der Pfad steht als
 * letzte Zeile der Ausgabe.
 *
 * WARUM (nc-app-tooling#20): Die Exclude-Menge lag an drei Stellen im
 * /release-Skill (rm-Liste in 4.1, find-delete in 4.2, tar --exclude in 5.1)
 * plus der Whitelist in nc-release-check. Vier Quellen, die drifteten — .nvmrc,
 * *.crt, spike/ rutschten wiederholt durch, und Check 9 schlug erst NACH dem
 * kompletten Signier- und Packlauf an. Prosa als Regelquelle hat keinen
 * Fehlerfall; ein Werkzeug schon.
 *
 * WIE:
 *   1. `git archive HEAD` — alle Quellen aus HEAD, respektiert die App-
 *      `.gitattributes export-ignore` (nc-app-tooling#21). So kann kein
 *      uncommitteter Feature-Code in den signierten Baum geraten.
 *   2. Build-Ausgabe js/ css/ vendor/ aus dem Arbeitsbaum darueberlegen — die
 *      entsteht erst beim Bauen, liegt also nicht in HEAD. (Dass js/ zu HEAD
 *      passt, sichert nc-bundle-fresh im Schritt davor.)
 *   3. Die NC-/Store-Strips raus (istNcStrip) — *.crt, .htaccess, *.map …
 *   4. Selbst-Check gegen die Whitelist — fail-fast VOR dem Signieren.
 *
 * Die Regeln (WHITELIST, istNcStrip, brauchtVendor) stehen in release-regeln.mjs
 * und werden von nc-release-check GEGEN den fertigen Tarball geprueft. Eine
 * Quelle fuer Bauen und Pruefen.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

import { APPINFO_ERLAUBT, BUILD_OVERLAY, WHITELIST, appId, brauchtVendor, istNcStrip } from './release-regeln.mjs'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const argv = process.argv.slice(2)
const AUSFUEHRLICH = argv.includes('--verbose')
const outArg = (() => {
	const i = argv.indexOf('--out')
	return i >= 0 ? argv[i + 1] : null
})()

if (!existsSync('appinfo/info.xml')) {
	console.error(red('nc-pack: appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.'))
	process.exit(2)
}
const APP = appId(readFileSync('appinfo/info.xml', 'utf8'))
if (!APP) {
	console.error(red('nc-pack: appinfo/info.xml enthaelt kein <id>-Element'))
	process.exit(2)
}

const HEAD = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
console.log(`${APP} — Release-Baum aus HEAD ${HEAD}\n`)

const out = outArg ?? mkdtempSync(join(tmpdir(), 'nc-pack-'))
const bau = join(out, APP)
rmSync(bau, { recursive: true, force: true })
mkdirSync(bau, { recursive: true })

const schritt = (text) => process.stdout.write(dim(`  ${text} … `))
const fertig = () => console.log(green('ok'))

// 1. Quellen aus HEAD (export-ignore-gefiltert).
schritt('git archive HEAD')
execFileSync('bash', ['-c', `git archive HEAD | tar -x -C '${bau}'`],
	{ stdio: AUSFUEHRLICH ? 'inherit' : ['ignore', 'ignore', 'inherit'] })
fertig()

// 2. Build-Ausgabe aus dem Arbeitsbaum darueberlegen. vendor nur, wenn die App
//    eine Runtime ausliefert — sonst bliebe (Dev-)vendor aussen vor, genau wie
//    nc-release-check es erwartet.
const liefertVendor = existsSync('composer.json') && brauchtVendor(readFileSync('composer.json', 'utf8'))
schritt('Build-Ausgabe js/ css/ vendor/')
for (const ordner of BUILD_OVERLAY) {
	if (ordner === 'vendor' && !liefertVendor) continue
	if (!existsSync(ordner)) continue
	rmSync(join(bau, ordner), { recursive: true, force: true })
	cpSync(ordner, join(bau, ordner), { recursive: true })
}
fertig()

/** Alle Dateien unterhalb <wurzel>, relativ zu <wurzel>, POSIX-Trenner. */
function dateienUnter(wurzel) {
	const gefunden = []
	const ab = (verzeichnis) => {
		for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
			const p = join(verzeichnis, eintrag.name)
			if (eintrag.isDirectory()) ab(p)
			else gefunden.push(relative(wurzel, p).split(sep).join('/'))
		}
	}
	ab(wurzel)
	return gefunden
}

// 3. NC-/Store-Strips raus.
schritt('NC-/Store-Strips')
let entfernt = 0
for (const rel of dateienUnter(bau)) {
	if (istNcStrip(rel)) { rmSync(join(bau, rel), { force: true }); entfernt++ }
}
console.log(green(`ok`) + dim(` (${entfernt} entfernt)`))

// 4. Selbst-Check gegen die Whitelist — dieselben Regeln wie nc-release-check.
const befunde = []
const top = [...new Set(readdirSync(bau, { withFileTypes: true }).map((e) => e.name))]
const fremd = top.filter((e) => !WHITELIST.has(e))
if (fremd.length) befunde.push(['unerwartete Eintraege oben im Baum', fremd])

const appinfoFremd = existsSync(join(bau, 'appinfo'))
	? dateienUnter(join(bau, 'appinfo')).filter((rel) => !APPINFO_ERLAUBT.has(rel))
	: []
if (appinfoFremd.length) befunde.push(['nur info.xml, routes.php, signature.json gehoeren nach appinfo/', appinfoFremd])

if (befunde.length) {
	console.log('')
	console.log(red('✗ Release-Baum verletzt die Whitelist — nicht signieren.') + '\n')
	for (const [text, treffer] of befunde) {
		console.log(`  ${text}:`)
		treffer.slice(0, 12).forEach((t) => console.log(dim(`    • ${t}`)))
		if (treffer.length > 12) console.log(dim(`    … und ${treffer.length - 12} weitere`))
		console.log(dim('    → in die App-.gitattributes (export-ignore) oder in istNcStrip (release-regeln.mjs).'))
	}
	// Der halbfertige Baum ist wertlos — nicht liegen lassen, wenn wir ihn selbst
	// angelegt haben.
	if (!outArg) rmSync(out, { recursive: true, force: true })
	process.exit(2)
}

const anzahl = dateienUnter(bau).length
console.log('\n' + green(`✓ Release-Baum bereit (${anzahl} Datei(en)) — signierfertig.`))
console.log(bau)
