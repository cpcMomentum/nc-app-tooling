#!/usr/bin/env node
/**
 * nc-release-check — prueft einen fertigen Release-Tarball.
 *
 *   npx nc-release-check <app>-vX.Y.Z.tar.gz
 *
 * Im Wurzelverzeichnis der App ausfuehren: die App-ID kommt aus
 * appinfo/info.xml, und zwei Pruefungen vergleichen den Tarball gegen den
 * Arbeitsbaum.
 *
 * Die Pruefungen standen bis 08/2026 als Fliesstext im Release-Skill
 * (contractmanager#339). Vier davon mussten allein am 12.08. korrigiert werden,
 * nachdem sie im echten Lauf danebenlagen — Prosa laesst sich nicht ausfuehren
 * und niemand merkt, wenn sie falsch ist.
 *
 * ENTHALTEN sind die Pruefungen, die allein am Tarball haengen. Die vier
 * uebrigen (Archive_Tar-Extraktion, NC-Filter-Simulation, Installations- und
 * Upgrade-Test) brauchen eine laufende Nextcloud und bleiben im Skill.
 *
 * Jede Pruefung traegt den Vorfall, aus dem sie entstanden ist. Wer sie
 * lockern will, soll erst lesen, was dann wieder passieren kann.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const tarball = process.argv[2]
if (!tarball || !existsSync(tarball)) {
	console.error(red(`nc-release-check: Tarball nicht gefunden — ${tarball ?? '(kein Argument)'}`))
	console.error('Aufruf: nc-release-check <app>-vX.Y.Z.tar.gz  (im Wurzelverzeichnis der App)')
	process.exit(2)
}
if (!existsSync('appinfo/info.xml')) {
	console.error(red('nc-release-check: appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.'))
	process.exit(2)
}

const APP = readFileSync('appinfo/info.xml', 'utf8').match(/<id>\s*([^<\s]+)\s*<\/id>/)?.[1]
if (!APP) {
	console.error(red('nc-release-check: appinfo/info.xml enthaelt kein <id>-Element'))
	process.exit(2)
}

const eintraege = execFileSync('tar', ['tzf', tarball], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
	.split('\n').filter(Boolean)

const befunde = []
const ok = (nr, titel) => console.log(`  ${green('✓')} ${dim(`Check ${nr}`)} ${titel}`)
const warn = (nr, titel, text) => console.log(`  ${yellow('⚐')} ${dim(`Check ${nr}`)} ${titel} — ${text}`)
function fail(nr, titel, text, treffer = []) {
	console.log(`  ${red('✗')} ${dim(`Check ${nr}`)} ${titel}`)
	console.log(`      ${text}`)
	treffer.slice(0, 8).forEach((t) => console.log(dim(`      ${t}`)))
	if (treffer.length > 8) console.log(dim(`      … und ${treffer.length - 8} weitere`))
	befunde.push(`Check ${nr}: ${titel}`)
}

console.log(`${APP} — ${tarball} (${eintraege.length} Eintraege)\n`)

// --- 1: genau ein Top-Level-Ordner -----------------------------------------
{
	const top = [...new Set(eintraege.map((e) => e.split('/')[0]).filter(Boolean))]
	if (top.length === 1 && top[0] === APP) ok(1, 'genau ein Top-Level-Ordner')
	else fail(1, 'genau ein Top-Level-Ordner', `erwartet nur "${APP}", gefunden:`, top)
}

// --- 2: keine macOS-Artefakte ----------------------------------------------
{
	const t = eintraege.filter((e) => /ds_store|__MACOSX|(^|\/)\._/i.test(e))
	t.length ? fail(2, 'keine macOS-Artefakte', 'COPYFILE_DISABLE=1 beim Packen setzen:', t) : ok(2, 'keine macOS-Artefakte')
}

// --- 3: keine Dev-Dateien ---------------------------------------------------
// An der App-Wurzel VERANKERT pruefen. Die frueher unverankerte Suche meldete
// bei rechnungswerk 1808 Treffer, alle aus vendor/ — fast jedes Composer-Paket
// hat ein src/ (11.08.2026, v0.4.1). node_modules und .git bleiben ueberall
// verboten.
{
	const wurzel = new RegExp(`^${APP}/(src|tests|docs|screenshots|sessions|dist)/`)
	const ueberall = /node_modules|\/\.git\//
	const t = eintraege.filter((e) => wurzel.test(e) || ueberall.test(e))
	t.length ? fail(3, 'keine Dev-Dateien', 'an der App-Wurzel verboten (in vendor/ waeren src/ und tests/ normal):', t) : ok(3, 'keine Dev-Dateien')
}

// --- 4: keine Source Maps ---------------------------------------------------
{
	const t = eintraege.filter((e) => e.endsWith('.map'))
	t.length ? fail(4, 'keine Source Maps', 'gehoeren nicht ins Release:', t) : ok(4, 'keine Source Maps')
}

// --- 5: keine Verschachtelung -----------------------------------------------
{
	const t = eintraege.filter((e) => e.startsWith(`${APP}/${APP}/`))
	t.length ? fail(5, 'keine Verschachtelung', 'Tarball ist doppelt verschachtelt:', t) : ok(5, 'keine Verschachtelung')
}

// --- 6: signature.json vorhanden --------------------------------------------
const hatSignatur = eintraege.some((e) => e === `${APP}/appinfo/signature.json`)
hatSignatur ? ok(6, 'signature.json vorhanden')
	: fail(6, 'signature.json vorhanden', 'ohne Signatur weist der App Store den Upload ab')

// --- 7: Groesse --------------------------------------------------------------
{
	const mb = statSync(tarball).size / 1024 / 1024
	// Der App Store lehnt ueber 30 MB ab; ab 5 MB lohnt ein Blick, was drin ist.
	if (mb > 30) fail(7, 'Groesse', `${mb.toFixed(1)} MB — der App Store nimmt hoechstens 30 MB`)
	else if (mb > 5) warn(7, 'Groesse', `${mb.toFixed(1)} MB, ueber 5 MB — kurz nachsehen, was drin ist`)
	else ok(7, `Groesse (${mb.toFixed(1)} MB)`)
}

// --- 9: Whitelist ------------------------------------------------------------
{
	const ERLAUBT = new Set(['appinfo', 'CHANGELOG.md', 'css', 'img', 'js', 'l10n',
		'lib', 'LICENSE', 'README.md', 'templates', 'vendor'])
	const top = [...new Set(eintraege
		.filter((e) => e.startsWith(`${APP}/`))
		.map((e) => e.slice(APP.length + 1).split('/')[0])
		.filter(Boolean))]
	const fremd = top.filter((e) => !ERLAUBT.has(e))
	fremd.length ? fail(9, 'Whitelist', 'unerwartete Eintraege — Tarball-Excludes anpassen:', fremd)
		: ok(9, 'Whitelist')

	const APPINFO_ERLAUBT = new Set(['info.xml', 'routes.php', 'signature.json'])
	const appinfo = eintraege
		.filter((e) => e.startsWith(`${APP}/appinfo/`) && !e.endsWith('/'))
		.map((e) => e.slice(`${APP}/appinfo/`.length))
		.filter((e) => e && !APPINFO_ERLAUBT.has(e))
	appinfo.length ? fail(9, 'Whitelist appinfo/', 'nur info.xml, routes.php und signature.json gehoeren dorthin:', appinfo)
		: ok(9, 'Whitelist appinfo/')
}

// --- 12: keine NC-gestrippten Dateien ---------------------------------------
// Nextclouds FilenameValidator entfernt diese beim Installieren. Bleiben sie in
// der Signatur, meldet die Integritaetspruefung bei jedem Nutzer FILE_MISSING.
const GESTRIPPT = /(^|\/)(\.htaccess|\.user\.ini)$/
{
	const t = eintraege.filter((e) => GESTRIPPT.test(e))
	t.length ? fail(12, 'keine NC-gestrippten Dateien', 'werden beim Install entfernt und verursachen FILE_MISSING:', t)
		: ok(12, 'keine NC-gestrippten Dateien')
}

// --- 10 + 13 + 15: brauchen den entpackten Inhalt ---------------------------
let tmp
try {
	tmp = mkdtempSync(join(tmpdir(), 'nc-release-'))
	execFileSync('tar', ['xzf', tarball, '-C', tmp])
	const wurzel = join(tmp, APP)

	// --- 10: jede signierte Datei liegt auch im Tarball ---------------------
	if (hatSignatur) {
		const sig = JSON.parse(readFileSync(join(wurzel, 'appinfo/signature.json'), 'utf8'))
		const signiert = Object.keys(sig.hashes ?? {})
		const fehlend = signiert.filter((rel) => !existsSync(join(wurzel, rel)))
		fehlend.length
			? fail(10, 'Signatur ⊆ Tarball', `${fehlend.length} signierte Datei(en) fehlen im Tarball — jeder Nutzer bekaeme FILE_MISSING:`, fehlend)
			: ok(10, `Signatur ⊆ Tarball (${signiert.length} Dateien)`)

		// --- 13: Signatur referenziert keine gestrippten Dateien ------------
		const strippt = signiert.filter((rel) => GESTRIPPT.test(rel))
		strippt.length
			? fail(13, 'Signatur ohne gestrippte Dateien', 'NC entfernt diese beim Install, die Signatur bliebe unerfuellbar:', strippt)
			: ok(13, 'Signatur ohne gestrippte Dateien')
	}

	// --- 15: Packaging-Guard, CSS und vendor-Runtime ------------------------
	// Die v1.2.0-Regression (#245) entstand, weil git-basiertes Packen zwei
	// gitignorierte Pflicht-Artefakte fallen liess: das CSS-Bundle (ungestylte
	// UI) und vendor/ (PDF-Extraktion kaputt). Der Arbeitsbaum ist die Quelle
	// der Wahrheit, NICHT Git — genau das war der Fehler.
	{
		let schaden = []
		const css = `css/${APP}-main.css`
		if (existsSync(css)) {
			const imTar = join(wurzel, css)
			if (!existsSync(imTar) || statSync(imTar).size === 0) {
				schaden.push(`${css} fehlt oder ist leer — die Oberflaeche waere ungestylt (#245)`)
			}
		}
		if (existsSync('composer.json')) {
			const req = JSON.parse(readFileSync('composer.json', 'utf8')).require ?? {}
			const brauchtVendor = Object.keys(req).some((k) => k !== 'php')
			if (brauchtVendor) {
				const autoload = join(wurzel, 'vendor/autoload.php')
				if (!existsSync(autoload) || statSync(autoload).size === 0) {
					schaden.push('vendor/autoload.php fehlt — composer.json deklariert Runtime-Abhaengigkeiten (#245/#249)')
				}
			}
		}
		schaden.length ? fail(15, 'Packaging-Guard', 'Pflicht-Artefakte fehlen im Tarball:', schaden)
			: ok(15, 'Packaging-Guard (CSS + vendor-Runtime)')
	}
} finally {
	if (tmp) rmSync(tmp, { recursive: true, force: true })
}

console.log('')
console.log(dim('Nicht enthalten, weil sie eine laufende Nextcloud brauchen: Check 8'))
console.log(dim('(Archive_Tar), 11 (NC-Filter-Simulation), 14 (Upgrade-Test). Siehe Release-Skill.'))
console.log('')

if (befunde.length) {
	console.log(red(`✗ ${befunde.length} Befund(e) — dieser Tarball darf nicht raus:`))
	befunde.forEach((b) => console.log(red(`  • ${b}`)))
	process.exit(1)
}
console.log(green('✓ Alle tarball-basierten Pruefungen bestanden.'))
