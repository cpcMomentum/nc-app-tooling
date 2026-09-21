/**
 * Gemeinsame Release-Regeln der Flotte — die EINE Quelle fuer:
 *   - WHITELIST:        was oben im Release-Baum stehen darf (App-Store-Whitelist).
 *   - APPINFO_ERLAUBT:  was unter appinfo/ bleibt.
 *   - istNcStrip():     NC-/Store-vorgeschriebene Dateien, die vor dem Signieren
 *                       raus muessen (sonst FILE_MISSING / Whitelist-Bruch).
 *
 * nc-pack ERZEUGT den Release-Baum nach diesen Regeln, nc-release-check PRUEFT
 * den fertigen Tarball dagegen. Eine Quelle, kein Drift (nc-app-tooling#20).
 *
 * Abgrenzung zu den App-`.gitattributes` (nc-app-tooling#21): dort stehen die
 * DEV-Dateien, die der App-Autor nicht ausliefert (src/, package.json, Configs,
 * tests/) — `git archive HEAD` laesst sie git-nativ weg. Hier stehen die
 * NC-/Store-vorgeschriebenen Strips: fleet-universell, NC-semantisch, an einer
 * getesteten Stelle statt in fuenf .gitattributes einzeln nachgepflegt.
 */

// Oberste Ebene des Release-Baums (App-Store-Whitelist).
export const WHITELIST = new Set([
	'appinfo', 'CHANGELOG.md', 'css', 'img', 'js', 'l10n',
	'lib', 'LICENSE', 'README.md', 'templates', 'vendor',
	// „Was ist neu?"-Fenster (Baustein 0b): whatsnew.json + Bilder liegen als
	// getrackter Ordner im App-Paket und gehoeren ausgeliefert. Ohne diesen
	// Eintrag wiese nc-pack (und nc-release-check Check 9) den Ordner als Stray
	// ab, und das erste Release mit Fenster fiele auf die Nase.
	'whatsnew',
])

// Unter appinfo/ gehoert nur das hin. signature.json entsteht erst beim
// Signieren — im Pre-Sign-Baum fehlt es, im fertigen Tarball ist es da; beides
// ist erlaubt.
export const APPINFO_ERLAUBT = new Set(['info.xml', 'routes.php', 'signature.json'])

// Build-Ausgabe: diese Ordner kommen aus dem Arbeitsbaum, nicht aus HEAD — sie
// entstehen erst beim Bauen. Alles andere kommt aus `git archive HEAD`.
// (vendor nur, wenn die App eine Runtime ausliefert, s. brauchtVendor.)
export const BUILD_OVERLAY = ['js', 'css', 'vendor']

/**
 * NC-/Store-vorgeschriebene Strips. `rel` ist ein Pfad relativ zur App-Wurzel
 * (POSIX-Trenner). Trifft zu → die Datei darf nicht in den Release-Baum.
 *
 * Jede Regel traegt ihren Vorfall:
 *   - *.crt/*.key: das App-Store-Zertifikat (appinfo/<app>.crt) ist im Git
 *     getrackt; signiert NC es mit, fehlt es im Tarball → Check 10 FILE_MISSING
 *     (worktime 0.9.1).
 *   - .htaccess/.user.ini: NCs FilenameValidator strippt sie beim Install →
 *     FILE_MISSING, wenn sie signiert wurden (auch tief im vendor/, z. B.
 *     tcpdf/tools/.htaccess).
 *   - *.map/*.LICENSE.txt: Build-Sidecars in js/, erreichen nie einen Nutzer.
 *   - .DS_Store/._*: macOS-Artefakte.
 *   - .phpunit.cache: Dev-Artefakt.
 */
export function istNcStrip(rel) {
	const segs = rel.split('/')
	const name = segs[segs.length - 1]
	if (segs.includes('.phpunit.cache')) return true
	if (name === '.htaccess' || name === '.user.ini') return true
	if (name === '.DS_Store' || name.startsWith('._')) return true
	return rel.endsWith('.crt') || rel.endsWith('.key')
		|| rel.endsWith('.map') || rel.endsWith('.LICENSE.txt')
}

/** App-ID aus dem Inhalt von appinfo/info.xml (oder null). */
export function appId(infoXml) {
	return infoXml.match(/<id>\s*([^<\s]+)\s*<\/id>/)?.[1] ?? null
}

/**
 * Liefert die App eine vendor/-Runtime aus? Dieselbe Frage, die
 * nc-release-check (Check 15) stellt: composer.json mit einer non-php-require.
 */
export function brauchtVendor(composerJson) {
	const req = JSON.parse(composerJson).require ?? {}
	return Object.keys(req).some((k) => k !== 'php')
}
