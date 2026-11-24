// Bewertungsregeln von nc-install-check, ohne Docker testbar.

/** Bestanden nur bei Exit 0 und leerer Ausgabe; "require upgrade" kommt mit Exit 0. */
export function integritaetOk(code, ausgabe) {
	return code === 0 && ausgabe.trim() === ''
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

function vergleiche(a, b) {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
	return 0
}

/** Hoechster Release-Tag unter `version`, ohne fuehrendes v; null beim ersten Release. */
export function vorversion(tags, version) {
	const neu = version.match(SEMVER)?.slice(1).map(Number)
	if (!neu) return null
	const kandidaten = tags
		.map((t) => t.trim().match(SEMVER)?.slice(1).map(Number))
		.filter((v) => v && vergleiche(v, neu) < 0)
		.sort((a, b) => vergleiche(b, a))
	return kandidaten.length ? kandidaten[0].join('.') : null
}

/** Check 8 und der NC-Filter: Befunde aus dem Einspielen ueber Archive_Tar. */
export function bewerteEinspielen(stats, app) {
	const befunde = []
	if (stats.top.length !== 1 || stats.top[0] !== app) {
		befunde.push(`Tarball muss genau den Ordner "${app}" enthalten, gefunden: ${stats.top.join(', ') || '(nichts)'}`)
	}
	if (stats.entpackt !== stats.imTar) {
		befunde.push(`${stats.imTar} Dateien im Tarball, Archive_Tar hat nur ${stats.entpackt} entpackt (lange Pfade aus bsdtar?)`)
	}
	if (stats.gefiltert.length) {
		befunde.push(`Der NC-Filter entfernt beim Installieren: ${stats.gefiltert.join(', ')}`)
	}
	return befunde
}

/** null bei Erfolg, sonst der Befund. */
export function bewerteUpgrade(code, ausgabe) {
	if (code !== 0) return `occ upgrade endete mit Exit ${code}`
	const treffer = ausgabe.match(/^.*\b(error|fatal|exception)\b.*$/im)
	return treffer ? `occ upgrade meldet: ${treffer[0].trim()}` : null
}

/** 4xx ist nur ein Hinweis: nicht jede App hat eine Startseite. */
export function bewerteHttp(status) {
	const n = Number(status)
	if (n >= 200 && n < 400) return { stufe: 'ok', text: `HTTP ${status}` }
	if (n >= 400 && n < 500) return { stufe: 'hinweis', text: `HTTP ${status} (keine Startseite?)` }
	return { stufe: 'fehler', text: `HTTP ${status}` }
}
