#!/usr/bin/env node
/**
 * nc-whatsnew-check — prueft den AUFBAU der whatsnew.json einer App.
 *
 *   npx nc-whatsnew-check          # im Wurzelverzeichnis der App
 *
 * ANLASS (nc-app-tooling#27): Die Schema-Pruefung des „Was ist neu?"-Fensters
 * (de/en Pflicht, where zweisprachig, plus boolean, Versionsschluessel x.y.z)
 * lag als PHPUnit-Test in jeder App einzeln. Dieses Werkzeug fuehrt sie einmal
 * zentral — dieselben Regeln, die nc-release-check beim Release anlegt
 * (bin/whatsnew-regeln.mjs).
 *
 * BEWUSST NUR SCHEMA, keine Versionspruefung: ob der Schluessel zur Version
 * passt, laesst sich in der App-CI nicht sauber pruefen — der Eintrag wird ja
 * FUER das kommende Release gepflegt und waere zwischen Feature-Merge und
 * Version-Bump zwangslaeufig rot. Diese Frage beantwortet nc-release-check zum
 * Release-Zeitpunkt, wenn die Version feststeht.
 *
 * Fehlt whatsnew/whatsnew.json, gibt es nichts zu pruefen: Exit 0.
 */

import { readFileSync, existsSync } from 'node:fs'

import { pruefeSchema } from './whatsnew-regeln.mjs'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const DATEI = 'whatsnew/whatsnew.json'

if (!existsSync(DATEI)) {
	console.log(dim(`nc-whatsnew-check: ${DATEI} nicht vorhanden — nichts zu pruefen.`))
	process.exit(0)
}

let katalog
try {
	katalog = JSON.parse(readFileSync(DATEI, 'utf8'))
} catch (e) {
	console.error(red(`nc-whatsnew-check: ${DATEI} ist kein gueltiges JSON — ${e.message}`))
	process.exit(1)
}

const fehler = pruefeSchema(katalog)
if (fehler.length) {
	console.error(red(`✗ nc-whatsnew-check: ${fehler.length} Schema-Fehler in ${DATEI}:`))
	fehler.forEach((f) => console.error(red(`  • ${f}`)))
	process.exit(1)
}

const versionen = Object.keys(katalog).length
console.log(green(`✓ nc-whatsnew-check: ${DATEI} ist gueltig (${versionen} Version(en)).`))
