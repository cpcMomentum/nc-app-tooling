/**
 * Gemeinsame Helfer der Tests.
 *
 * Die Tests bauen sich eine Wegwerf-App, statt gegen eine der fuenf echten Apps
 * zu laufen: hermetisch, in Sekunden, und sie darf absichtlich kaputt gemacht
 * werden. Gegen die echten Apps laeuft der Abnahmelauf vor jedem Tag (README).
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin')

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

export function schreibe(wurzel, pfad, inhalt) {
	const ziel = join(wurzel, pfad)
	mkdirSync(dirname(ziel), { recursive: true })
	writeFileSync(ziel, inhalt)
}

export const git = (wurzel, ...args) =>
	execFileSync('git', args, { cwd: wurzel, encoding: 'utf8' })

// Das Build-Skript der Wegwerf-App: kopiert die Quelle nach js/ und css/.
// Deterministisch und ohne Abhaengigkeiten — geprueft werden soll der
// Vergleich, nicht Vite. Die .map traegt bewusst den Build-Pfad im Inhalt:
// damit belegt der Test, dass Sourcemaps ignoriert werden. Ohne diese
// Ausnahme wuerde jeder Lauf allein am Temp-Pfad scheitern.
const BAUSKRIPT = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const quelle = readFileSync('src/eingabe.txt', 'utf8').trim()
mkdirSync('js', { recursive: true })
mkdirSync('css', { recursive: true })
writeFileSync('js/testapp-main.js', 'console.log("' + quelle + '")\\n')
writeFileSync('js/testapp-main.js.map', '{"pfad":"' + process.cwd() + '"}\\n')
writeFileSync('css/testapp-main.css', '.' + quelle + ' { color: red }\\n')
`

/** Legt eine minimale, gebaute und committete App an. */
export function wegwerfApp() {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-test-'))
	angelegt.push(wurzel)

	schreibe(wurzel, 'appinfo/info.xml', '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n')
	schreibe(wurzel, 'package.json', JSON.stringify({
		name: 'testapp', version: '1.0.0', private: true, type: 'module',
		scripts: { build: 'node bauen.mjs' },
	}, null, 2) + '\n')
	// Lockfile ohne Abhaengigkeiten: `npm ci` verlangt eines, installiert aber nichts.
	schreibe(wurzel, 'package-lock.json', JSON.stringify({
		name: 'testapp', version: '1.0.0', lockfileVersion: 3, requires: true,
		packages: { '': { name: 'testapp', version: '1.0.0' } },
	}, null, 2) + '\n')
	schreibe(wurzel, 'bauen.mjs', BAUSKRIPT)
	schreibe(wurzel, 'src/eingabe.txt', 'eins\n')

	git(wurzel, 'init', '-q')
	git(wurzel, 'config', 'user.email', 'test@example.com')
	git(wurzel, 'config', 'user.name', 'Test')
	git(wurzel, 'config', 'commit.gpgsign', 'false')
	bauen(wurzel)
	commit(wurzel, 'erster Stand')
	return wurzel
}

export const bauen = (wurzel) =>
	execFileSync('npm', ['run', '--silent', 'build'], { cwd: wurzel, encoding: 'utf8' })

export function commit(wurzel, nachricht) {
	git(wurzel, 'add', '-A')
	git(wurzel, 'commit', '-q', '--no-verify', '-m', nachricht)
}

/**
 * Fuehrt ein Werkzeug in der App aus. Ein Exit-Code ungleich 0 ist hier der
 * Normalfall, nicht die Ausnahme — deshalb spawnSync statt execFileSync.
 */
export function lauf(werkzeug, wurzel, args = []) {
	const r = spawnSync('node', [join(BIN, werkzeug), ...args], {
		cwd: wurzel, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
	})
	return { code: r.status, ausgabe: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
