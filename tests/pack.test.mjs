/**
 * nc-pack — Abnahme aus nc-app-tooling#20.
 *
 * nc-pack erzeugt den Release-Baum (Sign-Tree = Tarball-Tree) aus EINER
 * Regelquelle: `git archive HEAD` (respektiert .gitattributes export-ignore) +
 * Build-Ausgabe aus dem Arbeitsbaum - NC-/Store-Strips, dann Selbst-Check gegen
 * dieselbe Whitelist, gegen die nc-release-check prueft.
 *
 * Der Baum wird nach <app>/packout/<app> gebaut (--out), damit ihn die
 * Wegwerf-App-Aufraeumung miterwischt statt ins os-tmp zu lecken.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { commit, lauf, schreibe, wegwerfApp } from './helfer.mjs'

/** Baut den Baum und liefert {code, ausgabe, baum}. */
function pack(app, args = []) {
	const out = join(app, 'packout')
	const { code, ausgabe } = lauf('pack.mjs', app, ['--out', out, ...args])
	return { code, ausgabe, baum: join(out, 'testapp') }
}

/**
 * Macht die Wegwerf-App release-fertig: die #21-`.gitattributes`, die die
 * Dev-Dateien (src/, package.json, bauen.mjs) git-nativ aus `git archive` nimmt.
 * Ohne sie laegen sie im Archiv-Top-Level und nc-pack wiese sie zu Recht ab —
 * genau das setzt der export-ignore-Rollout voraus.
 */
function releaseFertig(app) {
	schreibe(app, '.gitattributes',
		['/src', 'package.json', 'package-lock.json', 'bauen.mjs', '.gitattributes']
			.map((p) => `${p} export-ignore`).join('\n') + '\n')
	commit(app, 'export-ignore fuer Dev-Dateien (nc-app-tooling#21)')
	return app
}

test('frischer Stand: whitelist-sauberer, signierfertiger Baum', () => {
	const app = releaseFertig(wegwerfApp())
	const { code, ausgabe, baum } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /Release-Baum bereit/)
	// Quellen aus HEAD + Build-Ausgabe da.
	assert.ok(existsSync(join(baum, 'appinfo/info.xml')), 'appinfo/info.xml fehlt')
	assert.ok(existsSync(join(baum, 'js/testapp-main.js')), 'js-Bundle fehlt')
	assert.ok(existsSync(join(baum, 'css/testapp-main.css')), 'css-Bundle fehlt')
})

test('Build-Sidecars (*.map) landen nicht im Baum', () => {
	const app = releaseFertig(wegwerfApp())
	// Die Wegwerf-App baut js/testapp-main.js.map — ein NC-/Store-Strip.
	const { code, baum, ausgabe } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.ok(existsSync(join(baum, 'js/testapp-main.js')), 'js-Bundle fehlt')
	assert.ok(!existsSync(join(baum, 'js/testapp-main.js.map')), '.map haette gestrippt werden muessen')
})

test('App-Store-Zertifikat und .htaccess werden gestrippt', () => {
	const app = releaseFertig(wegwerfApp())
	schreibe(app, 'appinfo/testapp.crt', '-----BEGIN CERTIFICATE-----\n')
	schreibe(app, 'lib/vendor/tool/.htaccess', 'Deny from all\n')
	commit(app, 'Zertifikat und vendored .htaccess')

	const { code, baum, ausgabe } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.ok(!existsSync(join(baum, 'appinfo/testapp.crt')), '*.crt haette raus gemusst (Check-10-Klasse)')
	assert.ok(!existsSync(join(baum, 'lib/vendor/tool/.htaccess')), '.htaccess haette raus gemusst (FilenameValidator)')
})

test('export-ignore-Dev-Dateien kommen gar nicht erst in den Baum', () => {
	const app = releaseFertig(wegwerfApp())

	const { code, baum, ausgabe } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.ok(!existsSync(join(baum, 'src')), 'src/ haette weg sein muessen')
	assert.ok(!existsSync(join(baum, 'package.json')), 'package.json haette weg sein muessen')
})

test('whatsnew/ gehoert ins Release und bleibt im Baum', () => {
	const app = releaseFertig(wegwerfApp())
	// Das „Was ist neu?"-Fenster (Baustein 0b) liefert whatsnew.json + Bilder als
	// getrackten Ordner mit aus. Er steht in der Whitelist (release-regeln.mjs) —
	// nc-pack darf ihn also NICHT als Stray abweisen, sonst kippt das erste
	// Release mit Fenster.
	schreibe(app, 'whatsnew/whatsnew.json',
		'{"1.0.0":[{"title":{"de":"Neu","en":"New"}}]}\n')
	schreibe(app, 'whatsnew/reply.png', 'PNG\n')
	commit(app, 'whatsnew-Fenster-Inhalte')

	const { code, baum, ausgabe } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.ok(existsSync(join(baum, 'whatsnew/whatsnew.json')), 'whatsnew.json fehlt im Baum')
	assert.ok(existsSync(join(baum, 'whatsnew/reply.png')), 'whatsnew-Bild fehlt im Baum')
})

test('ein unerlaubter Top-Level-Eintrag bricht VOR dem Signieren ab', () => {
	const app = releaseFertig(wegwerfApp())
	// Nicht export-ignored, nicht in der Whitelist — genau der Fall (.nvmrc,
	// spike/), der frueher erst nach dem Signieren an Check 9 riss.
	schreibe(app, 'extras/streu.txt', 'gehoert nicht ins Release\n')
	commit(app, 'streunender Top-Level-Ordner')

	const { code, ausgabe } = pack(app)
	assert.equal(code, 2, ausgabe)
	assert.match(ausgabe, /verletzt die Whitelist/)
	assert.match(ausgabe, /extras/)
})

test('ohne composer-Runtime landet kein vendor/ im Baum', () => {
	const app = releaseFertig(wegwerfApp())
	// Arbeitsbaum-vendor ohne composer.json-Runtime = Dev-vendor: darf nicht
	// mit ausgeliefert werden (nc-release-check Check 15 stellt dieselbe Frage).
	schreibe(app, 'vendor/autoload.php', '<?php\n')

	const { code, baum, ausgabe } = pack(app)
	assert.equal(code, 0, ausgabe)
	assert.ok(!existsSync(join(baum, 'vendor')), 'Dev-vendor haette nicht ausgeliefert werden duerfen')
})
