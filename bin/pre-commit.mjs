#!/usr/bin/env node
/**
 * nc-pre-commit — die Pre-Commit-Pruefungen der App-Flotte, an einer Stelle.
 *
 * Bis 08/2026 lag dieselbe Datei fuenfmal als Kopie in den App-Repos. Die
 * Kopien liefen auseinander: 16 bis 79 abweichende Zeilen, teils entstanden
 * beim Einfuegen ein und desselben Blocks von Hand. Die App-Hooks sind jetzt
 * ein Aufruf, die Logik steht hier (contractmanager#339).
 *
 * Fuenf Pruefungen, alle gegen den GESTAGTEN Stand (`git show :datei`), nicht
 * gegen den Arbeitsbaum — sonst prueft der Hook etwas anderes als das, was
 * committet wird. Ausnahmen sind die l10n- und die Schema-Pruefung, siehe dort.
 *
 *   1. Merge-Konfliktmarker
 *   2. Zugangsschluessel (Secrets)
 *   3. l10n-Katalog-Konsistenz
 *   4. OCP-only (keine internen OC_-Klassen, kein \OC\-Namensraum)
 *   5. Schema-Portabilitaet der Migrationen
 *
 * Reihenfolge ist bewusst: Die Secret-Pruefung stand frueher NACH einer
 * Pruefung, die bei "keine PHP-Dateien gestaged" mit exit 0 ausstieg — der
 * belegte Leak kam ueber eine .md-Datei. Hier laufen alle fuenf immer.
 *
 * Umgehung nur mit `git commit --no-verify`, und das ist keine Loesung.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`

const git = (...args) => {
	try {
		return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	} catch {
		return ''
	}
}

/** Gestagte Dateien (hinzugefuegt, kopiert, geaendert). */
const stagedFiles = () =>
	git('diff', '--cached', '--name-only', '--diff-filter=ACM').split('\n').filter(Boolean)

/** Inhalt einer Datei so, wie er committet wuerde. */
const stagedContent = (file) => git('show', `:${file}`)

/** Zeilennummerierte Treffer eines Musters. */
function matches(content, re) {
	const out = []
	content.split('\n').forEach((line, i) => {
		re.lastIndex = 0
		if (re.test(line)) out.push(`${i + 1}:${line.trim().slice(0, 160)}`)
	})
	return out
}

function block(titel, text, funde) {
	console.log(red(`[${titel}] BLOCKED`) + '\n')
	console.log(text)
	for (const [file, treffer] of funde) {
		console.log(`${file}:`)
		treffer.forEach((t) => console.log(`  ${t}`))
		console.log('')
	}
	console.log('Umgehung (nicht empfohlen): git commit --no-verify')
	process.exit(1)
}

const dateien = stagedFiles()
if (!dateien.length) process.exit(0)

// --- 1. Merge-Konfliktmarker ------------------------------------------------
// Anlass: Konfliktmarker in JS brachen das worktime-Release v0.6.2.
{
	const re = /^(<{7,}|={7,}|>{7,}|\|{7,})/
	const funde = []
	for (const file of dateien) {
		const treffer = matches(stagedContent(file), re)
		if (treffer.length) funde.push([file, treffer])
	}
	if (funde.length) {
		block('Conflict-Marker Check',
			'Merge-Konfliktmarker in einer gestagten Datei.\n', funde)
	}
}

// --- 2. Zugangsschluessel ---------------------------------------------------
// Anlass: der App-Store-Token stand von 04/2026 bis 08/2026 hartkodiert in
// techstack.md — in einem oeffentlichen Repo (contractmanager#308). GitHubs
// Secret Scanning faengt das NICHT: es gibt kein Nextcloud-Muster, und ein
// blanker 40-Zeichen-Hex-String ist von einem Commit-Hash nicht zu
// unterscheiden. Deshalb kontextgebunden statt "40 Hex" allein — sonst schlaegt
// jeder Commit-Hash in CHANGELOG.md oder composer.lock an.
{
	const MUSTER = [
		/Authorization:\s*Token\s+[0-9a-f]{40}/i,
		/(token|secret|api[_-]?key|passwor[dt])["']?\s*[:=]+\s*["']?[0-9a-f]{32,}/i,
		/^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	]
	// appinfo/signature.json ist eine generierte Liste aus Pfaden und
	// SHA-512-Hashes — sieht wie ein Geheimnis aus, ist keins, und wird bei
	// jedem Release neu erzeugt.
	const AUSGENOMMEN = new Set(['appinfo/signature.json'])
	const funde = []
	for (const file of dateien) {
		if (AUSGENOMMEN.has(file)) continue
		const content = stagedContent(file)
		if (!content) continue
		const treffer = new Map() // Zeile → Text; a und b greifen beim Leak-Fall beide
		for (const re of MUSTER) {
			for (const t of matches(content, re)) treffer.set(t.split(':')[0], t)
		}
		if (treffer.size) funde.push([file, [...treffer.values()]])
	}
	if (funde.length) {
		block('Secret Check',
			'Moeglicher Zugangsschluessel in einer gestagten Datei.\n\n'
			+ 'Secrets gehoeren nach .claude/settings.local.json (gitignored),\n'
			+ 'im Code stattdessen die Variable lesen, z.B. $NC_APPSTORE_TOKEN.\n'
			+ 'Private Schluessel gehoeren nach ~/.nextcloud/certificates/.\n\n'
			+ 'Fehlalarm? Dann das Muster in nc-app-tooling schaerfen —\n'
			+ 'nicht den Hook mit --no-verify umgehen.\n', funde)
	}
}

// --- 3. l10n-Katalog-Konsistenz --------------------------------------------
// Ausloeser haengt am CODE, nicht an den l10n-Dateien: wer den Katalogeintrag
// vergisst, fasst keine l10n-Datei an (contractmanager#340).
//
// Diese Pruefung liest bewusst den ARBEITSBAUM, nicht den gestagten Stand: sie
// braucht den ganzen Quellbaum und alle Kataloge, nicht einzelne Dateien. Bei
// teilweise gestagten Aenderungen kann ihr Ergebnis deshalb vom committeten
// Stand abweichen. Der CI-Lauf prueft den echten Stand nach.
{
	const RELEVANT = /^(src|lib|templates|appinfo|l10n)\/.*\.(js|ts|vue|php|json)$/
	if (dateien.some((f) => RELEVANT.test(f))) {
		const bin = join('node_modules', '.bin', 'nc-l10n-check')
		if (!existsSync(bin)) {
			console.log(yellow('[l10n Check] uebersprungen — nc-l10n-check fehlt.'))
			console.log('Einmalig  npm install  ausfuehren; im CI laeuft die Pruefung ohnehin.')
		} else {
			try {
				execFileSync(bin, [], { stdio: 'inherit' })
			} catch {
				console.log(red('\n[l10n Check] BLOCKED') + '\n')
				console.log('Uebersetzungskataloge sind inkonsistent zum Code.')
				console.log('Beheben:  npm run l10n:fix   (dann uebersetzen und stagen)\n')
				console.log('Umgehung (nicht empfohlen): git commit --no-verify')
				process.exit(1)
			}
		}
	}
}

// --- 4. OCP-only ------------------------------------------------------------
// Anlass: OC_App::getAppPath() war seit NC 11 veraltet und ist in NC 33
// entfallen — laufende Installationen stuerzten beim Upgrade ab (worktime#88,
// contractmanager#86). Nur OCP\ und OCA\ sind oeffentlich und stabil.
{
	const re = /(^|[^A-Za-z])OC_[A-Z][a-zA-Z_]*::|\\OC::|\\OC\\[A-Z]|^use OC\\[A-Z]|^use OC;/
	const funde = []
	for (const file of dateien.filter((f) => f.endsWith('.php'))) {
		const treffer = matches(stagedContent(file), re)
		if (treffer.length) funde.push([file, treffer])
	}
	if (funde.length) {
		block('OCP-API Check',
			'Interne OC_*/\\OC\\-API benutzt. Stattdessen \\OCP\\ verwenden.\n'
			+ '(worktime#88, contractmanager#86 — OC_App::getAppPath entfiel in NC 33.)\n', funde)
	}
}

// --- 5. Schema-Portabilitaet ------------------------------------------------
// Anlass: worktime v0.16.0 legte eine NOT-NULL-Boolean an. Alle 15
// Tarball-Checks und der Upgrade-Test waren gruen — beim Nutzer brach das
// App-Update ab (worktime#596, nc-app-tooling#7). Migrationen laufen in der
// ganzen Pipeline genau einmal, gegen Postgres, und Postgres nimmt das klaglos.
//
// Wie die l10n-Pruefung liest diese den ARBEITSBAUM: sie braucht alle
// Migrationen und die info.xml, nicht einzelne Dateien. Der CI-Lauf prueft den
// committeten Stand nach.
{
	if (dateien.some((f) => /^lib\/Migration\/.*\.php$/.test(f))) {
		const bin = join('node_modules', '.bin', 'nc-schema-check')
		if (!existsSync(bin)) {
			console.log(yellow('[Schema Check] uebersprungen — nc-schema-check fehlt.'))
			console.log('Einmalig  npm install  ausfuehren; im CI laeuft die Pruefung ohnehin.')
		} else {
			try {
				execFileSync(bin, [], { stdio: 'inherit' })
			} catch {
				console.log(red('\n[Schema Check] BLOCKED') + '\n')
				console.log('Die Migration erzeugt ein Schema, das nicht auf allen von')
				console.log('Nextcloud unterstuetzten Datenbanken zulaessig ist.\n')
				console.log('Umgehung (nicht empfohlen): git commit --no-verify')
				process.exit(1)
			}
		}
	}
}

console.log(green('✓ Pre-Commit-Pruefungen bestanden.'))
process.exit(0)
