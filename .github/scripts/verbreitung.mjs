#!/usr/bin/env node
/**
 * Misst die Verbreitung der Flotten-Apps an den Download-Zaehlern ihrer
 * GitHub-Release-Tarballs und schreibt das Ergebnis als Kommentar ins Mess-Issue.
 *
 *   node .github/scripts/verbreitung.mjs            # nur ausgeben
 *   node .github/scripts/verbreitung.mjs --post     # als Kommentar posten
 *
 * Der App Store nennt keine Installationszahlen. Jede Installation und jedes
 * Update zieht aber den Tarball von GitHub. Die Gesamtsumme ist deshalb kein
 * Instanz-Zaehler. Als Naeherung dient der Zaehler des juengsten Releases, das
 * schon ausgerollt ist (mindestens 21 Tage alt).
 *
 * Jeder Kommentar traegt die Messung maschinenlesbar in sich. Daraus rechnet
 * der naechste Lauf die Veraenderung, eine eigene Ablage braucht es nicht.
 */

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ORG = 'cpcMomentum'
const APPS = ['worktime', 'contractmanager', 'rechnungswerk', 'vinarium', 'projektwerk']
const MESS_REPO = process.env.VERBREITUNG_REPO ?? 'cpcMomentum/nc-app-tooling'
const MESS_ISSUE = process.env.VERBREITUNG_ISSUE ?? '19'
const AUSGEROLLT_TAGE = 21
const MARKE = 'verbreitung-messung:'

const tarballSumme = (release) => (release.assets ?? [])
	.filter((a) => a.name.endsWith('.tar.gz'))
	.reduce((summe, a) => summe + a.download_count, 0)

/** Verdichtet die Releases einer App zu den drei Zahlen der Messung. */
export function auswerten(releases, heute) {
	const echte = releases.filter((r) => !r.draft && (r.assets ?? []).some((a) => a.name.endsWith('.tar.gz')))
	const grenze = heute.getTime() - AUSGEROLLT_TAGE * 86_400_000
	const ausgerollt = echte
		.filter((r) => !r.prerelease && new Date(r.published_at).getTime() <= grenze)
		.sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0]
	return {
		gesamt: echte.reduce((summe, r) => summe + tarballSumme(r), 0),
		releases: echte.length,
		ausgerollt: ausgerollt
			? { tag: ausgerollt.tag_name, datum: ausgerollt.published_at.slice(0, 10), downloads: tarballSumme(ausgerollt) }
			: null,
	}
}

const zahl = (n) => n.toLocaleString('de-DE')
const delta = (neu, alt) => (alt === undefined || alt === null ? '–' : `${neu - alt >= 0 ? '+' : '−'}${zahl(Math.abs(neu - alt))}`)

/** Baut den Kommentar. `vorher` ist die Messung aus dem letzten Kommentar oder null. */
export function kommentar(messung, vorher) {
	const zeilen = APPS.filter((app) => messung.apps[app]).map((app) => {
		const m = messung.apps[app]
		const v = vorher?.apps?.[app]
		const gleichesRelease = v?.ausgerollt && m.ausgerollt && v.ausgerollt.tag === m.ausgerollt.tag
		const ausgerollt = m.ausgerollt ? `${m.ausgerollt.tag} (${m.ausgerollt.datum})` : '–'
		const downloads = m.ausgerollt ? zahl(m.ausgerollt.downloads) : '–'
		const deltaAusgerollt = !m.ausgerollt || !v ? '–'
			: gleichesRelease ? delta(m.ausgerollt.downloads, v.ausgerollt.downloads)
				: `neues Release (vorher ${v.ausgerollt ? `${v.ausgerollt.tag}: ${zahl(v.ausgerollt.downloads)}` : '–'})`
		return `| ${app} | ${zahl(m.gesamt)} | ${delta(m.gesamt, v?.gesamt)} | ${m.releases} | ${ausgerollt} | ${downloads} | ${deltaAusgerollt} |`
	})
	const bezug = vorher ? `Veränderung gegenüber der Messung vom ${vorher.datum}.` : 'Erste Messung in diesem Format, deshalb ohne Veränderung.'
	return [
		`## Fleet-Downloads: Messung ${messung.datum}`,
		'',
		`| App | Downloads gesamt | Δ gesamt | Releases | Ausgerolltes Release (≥ ${AUSGEROLLT_TAGE} Tage) | dessen Downloads | Δ ausgerollt |`,
		'|---|---:|---:|---:|---|---:|---|',
		...zeilen,
		'',
		bezug,
		'',
		'**Lesart:** „Downloads gesamt" sind Installationen, Updates und Abrufe des App Stores zusammen, nicht die Zahl der Instanzen. Die Näherung für Instanzen ist die Spalte „dessen Downloads". projektwerk liegt nicht im App Store.',
		'',
		`<!-- ${MARKE} ${JSON.stringify(messung)} -->`,
	].join('\n')
}

const VERTRAUT = ['OWNER', 'MEMBER', 'COLLABORATOR']
const vonUns = (k) => k.user?.login === 'github-actions[bot]' || VERTRAUT.includes(k.author_association)

const istZahl = (n) => Number.isInteger(n) && n >= 0
const istAusgerollt = (a) => a === null
	|| (typeof a === 'object' && /^[\w.+-]+$/.test(a.tag ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(a.datum ?? '') && istZahl(a.downloads))

/** Eine Messung aus einem Kommentar geht ungefiltert in den naechsten Kommentar: nur exakt die erwartete Form zaehlt. */
export function gueltig(m) {
	return typeof m === 'object' && m !== null
		&& /^\d{4}-\d{2}-\d{2}$/.test(m.datum ?? '')
		&& typeof m.apps === 'object' && m.apps !== null
		&& Object.entries(m.apps).every(([app, a]) => APPS.includes(app)
			&& typeof a === 'object' && a !== null && istZahl(a.gesamt) && istZahl(a.releases) && istAusgerollt(a.ausgerollt))
}

/** Liest die juengste Messung aus den Kommentaren des Issues. Das Issue ist oeffentlich, Fremdkommentare zaehlen nicht. */
export function letzteMessung(kommentare) {
	for (const k of [...kommentare].reverse()) {
		if (!vonUns(k)) continue
		const treffer = (k.body ?? '').match(new RegExp(`<!-- ${MARKE} (\\{.*\\}) -->`))
		if (!treffer) continue
		try {
			const messung = JSON.parse(treffer[1])
			if (gueltig(messung)) return messung
		} catch {
			continue
		}
	}
	return null
}

async function github(pfad, optionen = {}) {
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
	const antwort = await fetch(`https://api.github.com/${pfad}`, {
		signal: AbortSignal.timeout(30_000),
		...optionen,
		headers: {
			'User-Agent': 'nc-app-tooling-verbreitung',
			Accept: 'application/vnd.github+json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...optionen.headers,
		},
	})
	if (!antwort.ok) {
		const limit = antwort.status === 403 && !token ? ' (ohne GH_TOKEN gilt ein enges Anfragelimit)' : ''
		throw new Error(`GitHub ${antwort.status} bei ${pfad}${limit}`)
	}
	return antwort.json()
}

export async function alleSeiten(pfad, hole = github) {
	const alles = []
	for (let seite = 1; ; seite++) {
		const teil = await hole(`${pfad}${pfad.includes('?') ? '&' : '?'}per_page=100&page=${seite}`)
		alles.push(...teil)
		if (teil.length < 100) return alles
	}
}

async function main() {
	const heute = new Date()
	const messung = { datum: heute.toISOString().slice(0, 10), apps: {} }
	for (const app of APPS) messung.apps[app] = auswerten(await alleSeiten(`repos/${ORG}/${app}/releases`), heute)

	const vorher = letzteMessung(await alleSeiten(`repos/${MESS_REPO}/issues/${MESS_ISSUE}/comments`))
	const text = kommentar(messung, vorher)
	process.stdout.write(text + '\n')

	if (process.argv.includes('--post')) {
		const antwort = await github(`repos/${MESS_REPO}/issues/${MESS_ISSUE}/comments`, {
			method: 'POST', body: JSON.stringify({ body: text }),
		})
		process.stderr.write(`gepostet: ${antwort.html_url}\n`)
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	main().catch((e) => {
		process.stderr.write(`FEHLER: ${e.message}\n`)
		process.exit(1)
	})
}
