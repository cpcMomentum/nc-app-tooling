#!/usr/bin/env node
/**
 * nc-dev-testkonten — stellt die festen Testkonten der lokalen Dev-Instanz her.
 *
 *   npx nc-dev-testkonten            # fehlende Konten anlegen, alle auf ihr festes Passwort setzen
 *   npx nc-dev-testkonten --list     # nur die Liste zeigen, nichts aendern
 *
 * Alle Apps testen gegen dieselbe Instanz. Die Liste in dev-testkonten.json ist
 * die eine Stelle, an der Konten und Passwoerter stehen. Konten, die nicht in
 * der Liste stehen, fasst das Werkzeug nie an, und es loescht nichts.
 *
 * Der occ-Aufruf kommt aus NC_OCC (Standard: der Container nextcloud-dev).
 * Das Passwort geht ueber OC_PASS in die Umgebung, nicht in die Prozessliste.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const KONTEN = JSON.parse(readFileSync(new URL('./dev-testkonten.json', import.meta.url), 'utf8'))
const STANDARD_OCC = ['docker', 'exec', '-u', 'www-data', '-e', 'OC_PASS', '-i', 'nextcloud-dev', 'php', 'occ']

const argumente = process.argv.slice(2)
const unbekannt = argumente.filter((a) => a !== '--list')
if (unbekannt.length) {
	process.stderr.write(`FEHLER: unbekanntes Argument ${unbekannt.join(' ')}. Erlaubt ist nur --list.\n`)
	process.exit(2)
}

if (argumente.includes('--list')) {
	const breite = (feld) => Math.max(...KONTEN.map((k) => k[feld].length))
	for (const k of KONTEN) {
		process.stdout.write(`${k.uid.padEnd(breite('uid'))}  ${k.passwort.padEnd(breite('passwort'))}  ${k.zweck}\n`)
	}
	process.exit(0)
}

const occBefehl = process.env.NC_OCC ? process.env.NC_OCC.trim().split(/\s+/) : STANDARD_OCC

function occ(args, passwort = null) {
	const env = { ...process.env }
	delete env.OC_PASS
	// Nextcloud zieht NC_PASS vor: ein Wert aus der Shell des Aufrufers wuerde das feste Passwort ersetzen.
	delete env.NC_PASS
	if (passwort !== null) env.OC_PASS = passwort
	return spawnSync(occBefehl[0], [...occBefehl.slice(1), ...args], { env, encoding: 'utf8' })
}

function pflicht(ergebnis, was) {
	if (ergebnis.error || ergebnis.status !== 0) {
		const grund = ergebnis.error
			? ergebnis.error.message
			: (ergebnis.stderr || ergebnis.stdout).trim() || `Abbruch durch Signal ${ergebnis.signal}`
		throw new Error(`${was} gescheitert: ${grund}`)
	}
	return ergebnis
}

// Unterscheidet "Instanz nicht erreichbar" von "Konto fehlt": user:info endet in beiden Faellen mit Exit != 0.
const erreichbar = occ(['status', '--output=json'])
if (erreichbar.error || erreichbar.status !== 0) {
	const grund = erreichbar.error ? ` ${erreichbar.error.message}.` : ''
	process.stderr.write(`FEHLER: occ nicht erreichbar (${occBefehl.join(' ')}).${grund} Laeuft die Dev-Instanz?\n`)
	process.exit(1)
}

// Nur "user not found" heisst "fehlt": ein Aussetzer von occ darf nicht zum Anlegen fuehren.
function existiert(uid) {
	const info = occ(['user:info', uid])
	if (info.status === 0) return true
	if (info.status === 1 && /not found/i.test(info.stdout + info.stderr)) return false
	pflicht(info, 'Konto pruefen')
	throw new Error('Konto pruefen gescheitert')
}

function gruppeSicherstellen(gruppe) {
	const neu = occ(['group:add', gruppe])
	if (neu.status !== 0 && !/already exists/i.test(neu.stdout + neu.stderr)) pflicht(neu, `Gruppe ${gruppe} anlegen`)
}

let fehler = 0
for (const konto of KONTEN) {
	try {
		const schritte = []
		if (!existiert(konto.uid)) {
			pflicht(occ(['user:add', '--password-from-env', '--display-name', konto.name, konto.uid], konto.passwort), 'Anlegen')
			schritte.push('angelegt')
		} else {
			pflicht(occ(['user:enable', konto.uid]), 'Aktivieren')
			pflicht(occ(['user:resetpassword', '--password-from-env', konto.uid], konto.passwort), 'Passwort setzen')
			schritte.push('aktiv, Passwort gesetzt')
		}
		for (const gruppe of konto.gruppen) {
			gruppeSicherstellen(gruppe)
			pflicht(occ(['group:adduser', gruppe, konto.uid]), `Gruppe ${gruppe}`)
			schritte.push(`Gruppe ${gruppe}`)
		}
		process.stdout.write(`ok      ${konto.uid}: ${schritte.join(', ')}\n`)
	} catch (e) {
		fehler++
		process.stdout.write(`FEHLER  ${konto.uid}: ${e.message}\n`)
	}
}

process.exit(fehler ? 1 : 0)
