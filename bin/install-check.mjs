#!/usr/bin/env node
// Release-Checks 8, 11, 14 in Wegwerf-Containern, weil /var/www/html der Dev-Instanz vom Mac eingehaengt ist.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
	bewerteEinspielen, bewerteHttp, bewerteUpgrade, bewerteVorversion, githubRepo, integritaetOk, upgradePlan,
} from './install-regeln.mjs'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function abbruch(text) {
	console.error(red(`nc-install-check: ${text}`))
	process.exit(2)
}

const OPTIONEN_MIT_WERT = ['--image', '--vorversion']
const SCHALTER = ['--keep', '--ohne-upgrade']
const optionen = {}
const positionen = []
const roh = process.argv.slice(2)
for (let i = 0; i < roh.length; i++) {
	const [name, gleich] = roh[i].split(/=(.*)/s)
	if (OPTIONEN_MIT_WERT.includes(name)) optionen[name] = gleich ?? roh[++i]
	else if (SCHALTER.includes(roh[i])) optionen[roh[i]] = true
	else if (roh[i].startsWith('-')) abbruch(`unbekannte Option ${roh[i]}`)
	else positionen.push(roh[i])
}
const wert = (name) => optionen[name]
const tarballArg = positionen[0]
const BEHALTEN = Boolean(optionen['--keep'])
const OHNE_UPGRADE = Boolean(optionen['--ohne-upgrade'])

if (!tarballArg || !existsSync(tarballArg)) {
	abbruch(`Tarball nicht gefunden — ${tarballArg ?? '(kein Argument)'}\nAufruf: nc-install-check <app>-vX.Y.Z.tar.gz  (im Wurzelverzeichnis der App)`)
}
if (!existsSync('appinfo/info.xml')) abbruch('appinfo/info.xml nicht gefunden — im Wurzelverzeichnis der App ausfuehren.')
const APP = readFileSync('appinfo/info.xml', 'utf8').match(/<id>\s*([^<\s]+)\s*<\/id>/)?.[1]
if (!APP || !/^[a-z0-9_]+$/.test(APP)) abbruch(`appinfo/info.xml: ungueltige oder fehlende <id> (${APP ?? '-'})`)
const TARBALL = resolve(tarballArg)

class Abbruch extends Error {}
const scheitern = (text) => { throw new Abbruch(text) }

// Strg-C trifft den laufenden Kindprozess; dessen Signal bricht den Lauf ab, damit finally aufraeumt.
function lauf(befehl, args, eingabe) {
	const r = spawnSync(befehl, args, { encoding: 'utf8', input: eingabe, maxBuffer: 64 * 1024 * 1024 })
	if (r.signal || r.status === 130) scheitern('abgebrochen')
	return { code: r.status, aus: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' }
}
const docker = (...args) => lauf('docker', args)
const LABEL = 'nc-install-check.pid'

try {
	gunzipSync(readFileSync(resolve(tarballArg)))
} catch (e) {
	abbruch(`Tarball ist kein vollstaendiges gzip-Archiv (${e.message})`)
}

if (spawnSync('docker', ['info']).status !== 0) abbruch('Docker laeuft nicht.')

// Reste eines abgeschossenen Laufs (SIGTERM, Terminal zu) raeumen; laufende Laeufe anderer Prozesse bleiben.
const lebt = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
for (const zeile of spawnSync('docker', ['ps', '-a', '--filter', `label=${LABEL}`, '--format', `{{.Names}} {{.Label "${LABEL}"}}`],
	{ encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) {
	const [name, pid] = zeile.split(' ')
	if (!lebt(Number(pid))) {
		console.log(yellow(`Liegengebliebenen Container entfernt: ${name}`))
		spawnSync('docker', ['rm', '-f', name])
	}
}
const IMAGE = wert('--image') ?? docker('inspect', '--format', '{{.Config.Image}}', 'nextcloud-dev').stdout.trim()
if (!IMAGE) abbruch('Kein Image: nextcloud-dev nicht gefunden, bitte --image nextcloud:<version> angeben.')

// Bildet Installer::downloadApp aus dem Core nach: Archive_Tar, alten Ordner loeschen, copyRecursive mit Filter.
const HELFER = String.raw`<?php
require '/var/www/html/lib/base.php';
[, $befehl, $app] = $argv;
$ziel = "/var/www/html/custom_apps/$app";

function loesche(string $pfad): void {
	if (is_dir($pfad) && !is_link($pfad)) {
		foreach (array_diff(scandir($pfad), ['.', '..']) as $f) loesche("$pfad/$f");
		rmdir($pfad);
	} elseif (file_exists($pfad) || is_link($pfad)) {
		unlink($pfad);
	}
}
function dateien(string $wurzel): array {
	if (!is_dir($wurzel)) return [];
	$liste = [];
	$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS));
	foreach ($it as $f) if ($f->isFile()) $liste[] = substr($f->getPathname(), strlen($wurzel) + 1);
	sort($liste);
	return $liste;
}

if ($befehl === 'einspielen') {
	$tarball = $argv[3];
	$validator = \OCP\Server::get(\OCP\Files\IFilenameValidator::class);
	// isForbidden steht nicht in OCP; der Core-Installer nutzt genau diese Methode.
	if (!method_exists($validator, 'isForbidden')) { fwrite(STDERR, "FilenameValidator::isForbidden fehlt in dieser NC-Version\n"); exit(3); }
	$tmp = sys_get_temp_dir() . '/ic-' . bin2hex(random_bytes(4));
	mkdir($tmp);
	$tar = new Archive_Tar($tarball);
	$liste = $tar->listContent();
	$imTar = 0;
	foreach ($liste ?: [] as $e) if (in_array($e['typeflag'] ?? '', ['0', '', "\0"], true)) $imTar++;
	$entpacktOk = $liste !== false && $tar->extract($tmp) === true;
	$top = array_values(array_diff(scandir($tmp), ['.', '..']));
	$quelle = count($top) === 1 ? "$tmp/{$top[0]}" : $tmp;
	$entpackt = count(dateien($tmp));
	$gefiltert = [];
	$kopiere = function (string $src, string $dest) use (&$kopiere, $validator, &$gefiltert, $quelle): void {
		if (is_dir($src)) {
			if (!is_dir($dest)) mkdir($dest);
			foreach (array_diff(scandir($src), ['.', '..']) as $f) $kopiere("$src/$f", "$dest/$f");
		} elseif ($validator->isForbidden($src)) {
			$gefiltert[] = substr($src, strlen($quelle) + 1);
		} else {
			copy($src, $dest);
		}
	};
	loesche($ziel);
	mkdir($ziel);
	$kopiere($quelle, $ziel);
	$info = @simplexml_load_string((string)@file_get_contents("$quelle/appinfo/info.xml"));
	echo json_encode(['entpacktOk' => $entpacktOk, 'id' => $info ? (string)$info->id : '', 'top' => $top, 'imTar' => $imTar, 'entpackt' => $entpackt, 'kopiert' => count(dateien($ziel)),
		'gefiltert' => $gefiltert, 'version' => $info ? (string)$info->version : '']);
	loesche($tmp);
} elseif ($befehl === 'laden') {
	try {
		\OCP\Server::get(\OCP\App\IAppManager::class)->loadApp($app);
		echo 'OK';
	} catch (\Throwable $e) {
		echo 'FAIL: ' . $e->getMessage();
		exit(1);
	}
} elseif ($befehl === 'gegenprobe') {
	$sig = json_decode(file_get_contents("$ziel/appinfo/signature.json"), true);
	$kandidaten = array_values(array_filter(array_keys($sig['hashes'] ?? []), fn ($p) => str_starts_with($p, 'lib/') && is_file("$ziel/$p")));
	if (!$kandidaten) { fwrite(STDERR, "keine signierte Datei unter lib/\n"); exit(1); }
	unlink("$ziel/{$kandidaten[0]}");
	echo $kandidaten[0];
}
`

const befunde = []
const container = []
const ok = (nr, text) => console.log(`  ${green('✓')} ${dim(`Check ${nr}`)} ${text}`)
const hinweis = (nr, text) => console.log(`  ${yellow('⚐')} ${dim(`Check ${nr}`)} ${text}`)
function fehler(nr, text, details = '') {
	console.log(`  ${red('✗')} ${dim(`Check ${nr}`)} ${text}`)
	details.trim().split('\n').filter(Boolean).slice(0, 12).forEach((z) => console.log(dim(`      ${z}`)))
	befunde.push(`Check ${nr}: ${text}`)
}

const tempOrdner = []

function aufraeumen() {
	for (const ordner of tempOrdner.splice(0)) rmSync(ordner, { recursive: true, force: true })
	if (BEHALTEN && befunde.length) {
		if (container.length) console.log(yellow(`\nContainer behalten: ${container.join(', ')} (docker rm -f …)`))
		return
	}
	for (const name of container) spawnSync('docker', ['rm', '-f', name])
	container.length = 0
}
// Der Ablauf ist synchron, Signal-Handler kaemen nie dran; ein abgekoppelter Waechter raeumt nach jedem Ende auf.
if (!BEHALTEN) {
	spawn('sh', ['-c', `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; `
		+ `docker ps -aq --filter label=${LABEL}=${process.pid} | xargs docker rm -f >/dev/null 2>&1`],
	{ detached: true, stdio: 'ignore' }).unref()
}

class Instanz {
	constructor(rolle) {
		this.name = `nc-install-check-${APP}-${rolle}-${randomBytes(3).toString('hex')}`
		this.passwort = randomBytes(12).toString('hex')
	}

	occ(...args) {
		return docker('exec', '-u', 'www-data', this.name, 'php', '/var/www/html/occ', ...args)
	}

	php(...args) {
		return docker('exec', '-u', 'www-data', this.name, 'php', '/tmp/ic-helfer.php', ...args)
	}

	starten() {
		const r = docker('run', '-d', '--rm', '--label', `${LABEL}=${process.pid}`, '--name', this.name, IMAGE)
		if (r.code !== 0) scheitern(`Container startet nicht (${IMAGE}): ${r.aus.trim()}`)
		container.push(this.name)
		// Solange PID 1 das Entrypoint-Skript ist, kopiert es noch den Server nach /var/www/html.
		const bereit = Date.now() + 180_000
		while (docker('exec', this.name, 'grep', '-q', 'entrypoint', '/proc/1/cmdline').code === 0
			|| docker('exec', this.name, 'test', '-f', '/var/www/html/version.php').code !== 0) {
			if (Date.now() > bereit) scheitern(`${this.name}: Nextcloud nach 180 s nicht bereit`)
			if (docker('inspect', '-f', '{{.State.Running}}', this.name).stdout.trim() !== 'true') {
				scheitern(`${this.name}: Container ist beim Start beendet`)
			}
			spawnSync('sleep', ['1'])
		}
		const install = this.occ('maintenance:install', '--database', 'sqlite', '--admin-user', 'admin', '--admin-pass', this.passwort)
		if (install.code !== 0) scheitern(`${this.name}: maintenance:install scheitert: ${install.aus.trim()}`)
		lauf('docker', ['exec', '-i', '-u', 'www-data', this.name, 'sh', '-c', 'cat > /tmp/ic-helfer.php'], HELFER)
	}

	einspielen(tarball) {
		docker('cp', tarball, `${this.name}:/tmp/ic-app.tar.gz`)
		docker('exec', this.name, 'chown', 'www-data', '/tmp/ic-app.tar.gz')
		const r = this.php('einspielen', APP, '/tmp/ic-app.tar.gz')
		if (r.code !== 0) scheitern(`${this.name}: Einspielen scheitert: ${r.aus.trim()}`)
		try {
			return JSON.parse(r.stdout)
		} catch {
			return scheitern(`${this.name}: Ausgabe des Einspielens nicht lesbar: ${r.aus.trim().slice(0, 500)}`)
		}
	}

	installierteVersion() {
		return this.occ('config:app:get', APP, 'installed_version').stdout.trim().split('\n').pop().trim()
	}

	integritaet(nr) {
		const r = this.occ('integrity:check-app', APP)
		if (integritaetOk(r.code, r.aus)) ok(nr, 'Integritaetspruefung ohne Befund')
		else fehler(nr, `Integritaetspruefung nicht bestanden (Exit ${r.code})`, r.aus)
	}

	laden(nr) {
		const r = this.php('laden', APP)
		if (r.code === 0) ok(nr, 'App laedt (IAppManager::loadApp)')
		else fehler(nr, 'App laedt nicht', r.aus)
		const [http = '000', umleitung = ''] = docker('exec', this.name, 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}',
			'-u', `admin:${this.passwort}`, `http://localhost/index.php/apps/${APP}/`).stdout.trim().split(' ')
		const b = bewerteHttp(http, umleitung)
		if (b.stufe === 'ok') ok(nr, `Startseite ${b.text}`)
		else if (b.stufe === 'hinweis') hinweis(nr, `Startseite ${b.text}`)
		else fehler(nr, `Startseite ${b.text}`, docker('exec', this.name, 'tail', '-n', '20', '/var/www/html/data/nextcloud.log').aus)
	}

	status() {
		const r = this.occ('status', '--output=json')
		try {
			return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
		} catch {
			return null
		}
	}
}

function pruefeEinspielen(nr, stats) {
	const liste = bewerteEinspielen(stats, APP)
	if (liste.length) liste.forEach((b) => fehler(nr, b))
	else ok(nr, `Archive_Tar: ein Ordner, ${stats.imTar} Dateien entpackt, keine vom NC-Filter entfernt`)
}

function pruefeAktivieren(nr, instanz, version) {
	const r = instanz.occ('app:enable', APP)
	if (r.code !== 0) {
		fehler(nr, 'occ app:enable scheitert', r.aus)
		return false
	}
	const installiert = instanz.installierteVersion()
	if (installiert === version) ok(nr, `app:enable, installed_version ${installiert}`)
	else fehler(nr, `installed_version ist "${installiert}", erwartet ${version}`)
	return installiert === version
}

/** Release-Tags von origin, damit ein nicht geholter Tag nicht die falsche Vorversion liefert; null bei Fehler. */
function releaseTags() {
	const r = lauf('git', ['ls-remote', '--tags', '--refs', 'origin'])
	if (r.code !== 0) return null
	return r.stdout.split('\n').map((z) => z.split('refs/tags/')[1]).filter(Boolean)
}

/** Vorgaenger-Tarball: --vorversion, ../<app>-vX.tar.gz wie im Release-Skill, sonst GitHub; null nur bei --ohne-upgrade. */
function vorgaengerTarball(version) {
	const ohneTags = OHNE_UPGRADE || wert('--vorversion')
	const plan = upgradePlan({ ohneUpgrade: OHNE_UPGRADE, vorversionArg: wert('--vorversion'), version, tags: ohneTags ? [] : releaseTags() })
	if (plan.art === 'ueberspringen') return null
	if (plan.art === 'abbruch') scheitern(plan.grund)
	if (plan.art === 'datei') return { pfad: resolve(plan.pfad) }
	const vor = plan.version
	const lokal = resolve('..', `${APP}-v${vor}.tar.gz`)
	if (existsSync(lokal)) return { pfad: lokal, version: vor }
	const repo = githubRepo(lauf('git', ['remote', 'get-url', 'origin']).stdout) ?? `cpcMomentum/${APP}`
	const ordner = mkdtempSync(join(tmpdir(), 'nc-install-check-'))
	tempOrdner.push(ordner)
	const pfad = join(ordner, `${APP}-v${vor}.tar.gz`)
	const url = `https://github.com/${repo}/releases/download/v${vor}/${APP}-v${vor}.tar.gz`
	if (lauf('curl', ['-sfL', '-o', pfad, url]).code !== 0) {
		scheitern(`Vorversion v${vor} nicht ladbar (${url}). --vorversion <tarball> oder --ohne-upgrade angeben.`)
	}
	return { pfad, version: vor }
}

function main() {
	console.log(`${APP} — ${TARBALL}\n${dim(`Image ${IMAGE}, Wegwerf-Container; die Dev-Instanz bleibt unberuehrt.`)}\n`)

	console.log('Frischinstallation')
	const frisch = new Instanz('frisch')
	frisch.starten()
	const stats = frisch.einspielen(TARBALL)
	const VERSION = stats.version
	pruefeEinspielen(8, stats)
	if (pruefeAktivieren(11, frisch, VERSION)) {
		frisch.integritaet(11)
		frisch.laden(11)
	}
	let letzte = frisch

	const vor = vorgaengerTarball(VERSION)
	console.log('\nUpgrade')
	if (!vor) {
		hinweis(14, 'uebersprungen (--ohne-upgrade)')
	} else {
		aufraeumen()
		const upgrade = new Instanz('upgrade')
		upgrade.starten()
		const alt = upgrade.einspielen(vor.pfad)
		console.log(dim(`  von ${alt.version} auf ${VERSION}`))
		const unplausibel = bewerteVorversion(alt.version, VERSION, vor.version)
		if (unplausibel) fehler(14, unplausibel)
		else if (pruefeAktivieren(14, upgrade, alt.version)) {
			pruefeEinspielen(14, upgrade.einspielen(TARBALL))
			const r = upgrade.occ('upgrade')
			const befund = bewerteUpgrade(r.code, r.aus)
			if (befund) fehler(14, befund, r.aus)
			else ok(14, 'occ upgrade')
			const status = upgrade.status()
			if (status?.needsDbUpgrade === false) ok(14, 'occ status: needsDbUpgrade false')
			else fehler(14, 'occ status meldet ausstehendes Upgrade oder ist nicht lesbar', JSON.stringify(status))
			const installiert = upgrade.installierteVersion()
			if (installiert === VERSION) ok(14, `installed_version ${installiert}`)
			else fehler(14, `installed_version ist "${installiert}", erwartet ${VERSION}`)
			upgrade.integritaet(14)
			upgrade.laden(14)
		}
		letzte = upgrade
	}

	// Gegenprobe: greift die Integritaetspruefung in diesem Image ueberhaupt (Kanal git/leer prueft nichts)?
	console.log('\nGegenprobe')
	if (!befunde.length) {
		const geloescht = letzte.php('gegenprobe', APP)
		const r = letzte.occ('integrity:check-app', APP)
		if (geloescht.code === 0 && !integritaetOk(r.code, r.aus)) ok('G', `fehlende ${geloescht.stdout.trim()} wird erkannt`)
		else fehler('G', 'Integritaetspruefung erkennt eine fehlende signierte Datei nicht, das Ergebnis oben traegt nicht', `${geloescht.aus}\n${r.aus}`)
	} else {
		hinweis('G', 'uebersprungen, es gibt schon Befunde')
	}
}

try {
	main()
} catch (e) {
	aufraeumen()
	console.error(red(`\nnc-install-check: ${e instanceof Abbruch ? e.message : e.stack}`))
	process.exit(2)
} finally {
	aufraeumen()
}

console.log('')
if (befunde.length) {
	console.log(red(`✗ ${befunde.length} Befund(e) — dieser Tarball darf nicht raus:`))
	befunde.forEach((b) => console.log(red(`  • ${b}`)))
	process.exit(1)
}
console.log(green(OHNE_UPGRADE
	? '✓ nc-install-check: Installation und Integritaet bestanden. Upgrade NICHT geprueft (--ohne-upgrade).'
	: '✓ nc-install-check: Installation, Upgrade und Integritaet bestanden.'))
