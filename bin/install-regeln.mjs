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

/** Gibt aus, woher die Vorversion kommt; ein Upgrade wird nur mit --ohne-upgrade still uebersprungen. */
export function upgradePlan({ ohneUpgrade, vorversionArg, version, tags }) {
	if (ohneUpgrade) return { art: 'ueberspringen' }
	if (vorversionArg) return { art: 'datei', pfad: vorversionArg }
	if (!SEMVER.test(version ?? '')) {
		return { art: 'abbruch', grund: `Version "${version}" ist nicht X.Y.Z; --vorversion <tarball> angeben` }
	}
	if (tags === null) return { art: 'abbruch', grund: 'Release-Tags nicht lesbar; --vorversion <tarball> angeben' }
	const vor = vorversion(tags, version)
	if (!vor) {
		return { art: 'abbruch', grund: `kein Release-Tag unter ${version}; beim ersten Release --ohne-upgrade angeben` }
	}
	return { art: 'tag', version: vor }
}

/** Befund, wenn die eingespielte Vorversion kein echtes Upgrade ergibt. */
export function bewerteVorversion(alt, neu, erwartet) {
	const a = alt?.match(SEMVER)?.slice(1).map(Number)
	const n = neu?.match(SEMVER)?.slice(1).map(Number)
	if (erwartet && alt !== erwartet) return `Vorversions-Tarball enthaelt ${alt || '(keine Version)'}, erwartet ${erwartet}`
	if (!a || !n || vergleiche(a, n) >= 0) return `Vorversion ${alt || '(keine)'} liegt nicht unter ${neu}, das waere kein Upgrade`
	return null
}

/** owner/repo aus der origin-URL, sonst null. */
export function githubRepo(url) {
	return url?.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)?.slice(1).join('/') ?? null
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
	if (!stats.entpacktOk) befunde.push('Archive_Tar kann den Tarball nicht vollstaendig lesen')
	if (stats.id !== app) befunde.push(`info.xml im Tarball hat die ID "${stats.id}", erwartet "${app}"`)
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

/** 4xx ist nur ein Hinweis: nicht jede App hat eine Startseite. Umleitung zum Login heisst: nicht angemeldet. */
export function bewerteHttp(status, umleitung = '') {
	const n = Number(status)
	if (/\/login\b/.test(umleitung)) return { stufe: 'fehler', text: `HTTP ${status} zum Login, die Seite lief nicht` }
	if (n >= 200 && n < 400) return { stufe: 'ok', text: `HTTP ${status}` }
	if (n >= 400 && n < 500) return { stufe: 'hinweis', text: `HTTP ${status} (keine Startseite?)` }
	return { stufe: 'fehler', text: `HTTP ${status}` }
}
