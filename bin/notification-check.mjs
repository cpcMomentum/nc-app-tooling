#!/usr/bin/env node
/**
 * nc-notification-check — prueft, ob die Notifier der App die Setter-Vertraege
 * von Nextcloud einhalten.
 *
 *   npx nc-notification-check          # im Wurzelverzeichnis der App
 *
 * ANLASS: worktime setzte das Icon mit einer relativen URL.
 *
 *   $notification->setIcon($this->urlGenerator->imagePath('worktime', 'app-dark.svg'));
 *   // => '/custom_apps/worktime/img/app-dark.svg'
 *
 * NC 34 verlangt eine absolute http(s)-URL und wirft sonst InvalidValueException.
 * NC 33 nahm die relative noch. Die Folge auf NC 34 war nicht "kein Icon",
 * sondern: prepare() bricht an der Stelle ab, und weil setIcon VOR setLink
 * stand, kam jede Benachrichtigung ohne Icon UND ohne Link an — bei jedem
 * Subject, unabhaengig von den Daten. Dazu Log-Spam im Minutentakt
 * (worktime#551, nc-app-tooling#8).
 *
 * WARUM NICHTS DAS GEFANGEN HAT: die Unit-Tests mocken INotification und
 * stubben die Setter auf willReturnSelf(). Ein Mock kann einen ungueltigen Wert
 * gar nicht ablehnen — der Test prueft unsere Annahme ueber NC, nicht NCs
 * Verhalten. Der canary laeuft gegen die ocp-Stubs, das sind leere
 * Methodenruempfe. Und die Release-Checks rufen Manager::prepare() nie auf. In
 * der ganzen Pipeline geht keine einzige Benachrichtigung durch ein echtes NC.
 *
 * WAS HIER GEPRUEFT WIRD: die Vertraege aus lib/private/Notification/
 * Notification.php und Action.php, nachgelesen in 34.0.0 — nicht aus der
 * Dokumentation und nicht aus dem Gedaechtnis. setIcon() und setLink() lassen
 * nur absolute http(s)-URLs zu, leere Werte weist jeder Setter ab, und
 * IAction::setLink() nimmt nur fuenf Anfragearten.
 *
 * WAS ER NICHT KANN: ausrechnen, was zur Laufzeit in einer Variablen steht. Er
 * urteilt ueber den Ausdruck im Quelltext — welche Methode des IURLGenerator
 * gerufen wird, und was ein Literal enthaelt. Ein Wert, der aus einer Variablen
 * kommt, ist fuer ihn unklar, und unklar sagt er auch. Der vollstaendige Weg
 * waere, jedes Subject durch Manager::prepare() eines echten NC zu schicken;
 * das braucht je App und je NC-Version einen Container. Fuer die Klasse von
 * Fehlern, die hier aufgetreten ist, steht das nicht im Verhaeltnis.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { alsName, argumente, zeileVon } from './php-lesen.mjs'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

// IURLGenerator, nachgelesen in lib/public/IURLGenerator.php. Die Trennung ist
// der ganze Kern der Pruefung: die eine Haelfte liefert Pfade, die andere URLs,
// und beide sehen im Quelltext gleich aus.
const ABSOLUT = new Set([
	'getAbsoluteURL', 'linkToRouteAbsolute', 'linkToOCSRouteAbsolute', 'getBaseUrl', 'linkToDocs',
])
const RELATIV = new Set(['imagePath', 'linkTo', 'linkToRoute'])

// Action::setLink prueft die Anfrageart gegen genau diese Liste.
const ANFRAGEARTEN = new Set(['GET', 'POST', 'PUT', 'DELETE', 'WEB'])

// Setter, die einen Leerwert abweisen (Notification.php). setIcon und setLink
// stehen nicht dabei, weil sie eine eigene, schaerfere Pruefung bekommen.
const NICHT_LEER = new Set([
	'setApp', 'setUser', 'setSubject', 'setParsedSubject', 'setRichSubject',
	'setMessage', 'setParsedMessage', 'setRichMessage',
])

if (!existsSync('appinfo/info.xml')) {
	console.error(red('nc-notification-check: appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.'))
	process.exit(2)
}

function phpDateien(verzeichnis) {
	if (!existsSync(verzeichnis)) return []
	const raus = []
	for (const eintrag of readdirSync(verzeichnis).sort()) {
		const pfad = join(verzeichnis, eintrag)
		if (statSync(pfad).isDirectory()) raus.push(...phpDateien(pfad))
		else if (eintrag.endsWith('.php')) raus.push(pfad)
	}
	return raus
}

const dateien = phpDateien(join('lib', 'Notification'))
if (!dateien.length) {
	console.log(green('✓ nc-notification-check: kein lib/Notification, nichts zu pruefen.'))
	process.exit(0)
}

const befunde = []
const unklar = []
const melde = (datei, zeile, regel, text, hinweis) => befunde.push({ datei, zeile, regel, text, hinweis })

const kurz = (s) => {
	const einzeilig = s.replace(/\s+/g, ' ').trim()
	return einzeilig.length > 110 ? `${einzeilig.slice(0, 107)}…` : einzeilig
}

/** Der aeusserste Methodenaufruf eines Ausdrucks — `$a->b->c(...)` ergibt `c`. */
const aeussersteMethode = (ausdruck) => (ausdruck.match(/->\s*(\w+)\s*\(/) || [])[1] ?? null

/**
 * Urteilt, ob ein Ausdruck eine absolute URL liefert.
 * → 'absolut' | 'relativ' | 'leer' | 'unklar'
 *
 * `rumpf` ist der Methodenkoerper, in dem der Ausdruck steht — daraus loest
 * sich eine blanke Variable auf. Ohne diesen Schritt waere der einzige gesunde
 * Fall der Flotte ein Dauerhinweis (projektwerk baut den Link in einer
 * Hilfsmethode und gibt ihn ueber eine Variable zurueck), und ein Hinweis, der
 * immer steht, wird ignoriert.
 */
function urteil(ausdruck, quelle, rumpf = null, tiefe = 0) {
	const a = ausdruck.trim()
	if (!a) return 'unklar'

	// Literale zuerst: ein Ausdruck, der mit einer Zeichenkette beginnt, wird
	// durch keine spaetere Verkettung mehr absolut.
	const literal = a.match(/^'((?:[^'\\]|\\.)*)'|^"((?:[^"\\]|\\.)*)"/)
	if (literal) {
		const wert = literal[1] ?? literal[2] ?? ''
		if (wert === '' && a === literal[0]) return 'leer'
		return /^https?:\/\//.test(wert) ? 'absolut' : 'relativ'
	}

	// Eine blanke Variable: die Zuweisung im selben Rumpf nachschlagen.
	const variable = a.match(/^(\$\w+)$/)
	if (variable && rumpf && tiefe < 4) {
		const zuweisung = new RegExp(`\\${variable[1]}\\s*=\\s*([\\s\\S]*?);`).exec(rumpf)
		if (zuweisung) return urteil(zuweisung[1], quelle, rumpf, tiefe + 1)
	}

	const methode = aeussersteMethode(a)
	if (!methode) return 'unklar'
	if (ABSOLUT.has(methode)) return 'absolut'
	if (RELATIV.has(methode)) return 'relativ'

	// Eine Hilfsmethode derselben Klasse aufloesen.
	if (tiefe < 3 && /^\$this\s*->/.test(a)) {
		const eigen = methodenRumpf(quelle, methode)
		if (eigen && eigen.rueckgaben.length) {
			const urteile = eigen.rueckgaben
				.flatMap(zweige)
				.map((r) => urteil(r, quelle, eigen.rumpf, tiefe + 1))
			if (urteile.every((u) => u === 'absolut')) return 'absolut'
			if (urteile.some((u) => u === 'relativ' || u === 'leer')) return 'relativ'
		}
	}
	return 'unklar'
}

/**
 * Die Zweige eines ternaeren Ausdrucks — die Bedingung faellt weg, sie ist
 * keine Rueckgabe. `::` bleibt unangetastet, sonst zerreisst jede
 * Klassenkonstante den Ausdruck.
 */
function zweige(ausdruck) {
	const frage = ausdruck.indexOf('?')
	if (frage === -1) return [ausdruck]
	return ausdruck.slice(frage + 1).split(/(?<!:):(?!:)/)
}

/** Rumpf und return-Ausdruecke einer Methode derselben Datei. */
function methodenRumpf(quelle, name) {
	const kopf = new RegExp(`function\\s+${name}\\s*\\(`).exec(quelle)
	if (!kopf) return null
	const auf = quelle.indexOf('{', kopf.index)
	if (auf === -1) return null
	let tiefe = 0
	let zu = -1
	for (let i = auf; i < quelle.length; i++) {
		if (quelle[i] === '{') tiefe++
		else if (quelle[i] === '}' && --tiefe === 0) { zu = i; break }
	}
	if (zu === -1) return null
	const rumpf = quelle.slice(auf, zu)
	const rueckgaben = [...rumpf.matchAll(/\breturn\b([^;]*);/g)].map((m) => m[1].trim()).filter(Boolean)
	return { rumpf, rueckgaben }
}

const AUFRUF = /->\s*(setIcon|setLink|setApp|setUser|setSubject|setParsedSubject|setRichSubject|setMessage|setParsedMessage|setRichMessage)\s*\(/g

let geprueft = 0

for (const datei of dateien) {
	const quelle = readFileSync(datei, 'utf8')
	AUFRUF.lastIndex = 0
	let m
	while ((m = AUFRUF.exec(quelle)) !== null) {
		const methode = m[1]
		const { args } = argumente(quelle, m.index + m[0].length - 1)
		const zeile = zeileVon(quelle, m.index)
		const ausdruck = (args[0] ?? '').trim()
		geprueft++

		if (methode === 'setIcon' || methode === 'setLink') {
			const u = urteil(ausdruck, quelle)
			if (u === 'relativ') {
				melde(datei, zeile, `${methode} mit relativer URL`,
					kurz(ausdruck),
					'NC laesst nur absolute http(s)-URLs zu und wirft sonst InvalidValueException — '
					+ 'prepare() bricht dann mitten in der Benachrichtigung ab. Richtig: '
					+ '$urlGenerator->getAbsoluteURL($urlGenerator->imagePath(APP_ID, "…")) '
					+ 'fuers Icon, linkToRouteAbsolute(…) fuer den Link.')
			} else if (u === 'leer') {
				melde(datei, zeile, `${methode} mit Leerwert`, kurz(ausdruck),
					'Ein leerer Wert wird abgewiesen (Notification.php).')
			} else if (u === 'unklar') {
				unklar.push(`${datei}:${zeile}  ${methode}(${kurz(ausdruck)})`)
			}

			// Zweites Argument von IAction::setLink: die Anfrageart.
			const art = alsName(args[1] ?? '')
			if (methode === 'setLink' && art !== null && !ANFRAGEARTEN.has(art)) {
				melde(datei, zeile, 'setLink mit unbekannter Anfrageart', `'${art}'`,
					`Action::setLink laesst nur ${[...ANFRAGEARTEN].join(', ')} zu.`)
			}
			continue
		}

		if (NICHT_LEER.has(methode) && urteil(ausdruck, quelle) === 'leer') {
			melde(datei, zeile, `${methode} mit Leerwert`, kurz(ausdruck),
				'Ein leerer Wert wird abgewiesen (Notification.php).')
		}
	}
}

function nenneUnklare() {
	if (!unklar.length) return
	console.log(yellow(`⚐ ${unklar.length} Wert steht erst zur Laufzeit fest — nicht beurteilbar:`))
	unklar.forEach((u) => console.log(`  ${u}`))
	console.log(dim('  Der Pruefer sieht nur den Ausdruck. Wo er nichts sieht, sagt er nichts zu.'))
	console.log('')
}

const umfang = `${dateien.length} Datei(en), ${geprueft} Setter-Aufruf(e)`

if (!befunde.length) {
	nenneUnklare()
	console.log(green(`✓ nc-notification-check: Setter-Vertraege eingehalten (${umfang}).`))
	process.exit(0)
}

console.log(red(`✗ nc-notification-check: ${befunde.length} Vertragsverletzung(en) (${umfang}).`) + '\n')
nenneUnklare()
for (const b of befunde) {
	console.log(`${b.datei}:${b.zeile}  ${yellow(b.regel)}`)
	console.log(`  ${b.text}`)
	console.log(dim(`  ${b.hinweis}`))
	console.log('')
}
console.log('So ein Notifier besteht jeden Unit-Test — die Mocks stubben die Setter')
console.log('auf willReturnSelf() und koennen einen ungueltigen Wert gar nicht')
console.log('ablehnen. Beim Nutzer kommt die Benachrichtigung ohne Icon und ohne')
console.log('Link an, jedes Subject (worktime#551).')
process.exit(1)
