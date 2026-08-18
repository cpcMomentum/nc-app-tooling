/**
 * nc-schema-check — Abnahme aus nc-app-tooling#7.
 *
 * Der Kern jedes Falls: ein Schema, das gegen Postgres klaglos durchlaeuft und
 * auf einer anderen unterstuetzten Datenbank das App-Update abbricht. Genau so
 * kam worktime v0.16.0 in den App Store (worktime#596).
 *
 * Die Erwartungen sind gegen NCs eigenen Quelltext gesetzt, nicht gegen die
 * Dokumentation: lib/private/DB/MigrationService.php in v32.0.0, v33.0.0 und
 * 34.0.0. Wo sich die Fassungen unterscheiden, steht es am Fall.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { lauf, schemaApp, schreibe } from './helfer.mjs'

const pruefe = (app) => lauf('schema-check.mjs', app)

// --- Der Vorfall ------------------------------------------------------------

test('Gegenprobe worktime#596: NOT-NULL-Boolean wird abgewiesen', () => {
	const app = schemaApp({
		migrationen: {
			Version000025Date20260816000000: `		$table = $schema->getTable('wt_employees');
		if (!$table->hasColumn('vacation_transferred')) {
			$table->addColumn('vacation_transferred', Types::BOOLEAN, [
				'notnull' => true,
				'default' => false,
			]);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /NOT-NULL-Boolean/)
	assert.match(ausgabe, /"wt_employees"\."vacation_transferred"/)
	// Die Meldung muss den Ausweg nennen, sonst wird der Riegel umgangen.
	assert.match(ausgabe, /SMALLINT/)
})

test('die ausgelieferte Fassung derselben Migration ist gruen', () => {
	// So steht es seit dem Hotfix v0.16.1 im Repo.
	const app = schemaApp({
		migrationen: {
			Version000025Date20260816000000: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('vacation_transferred', Types::BOOLEAN, [
			'notnull' => false,
			'default' => false,
		]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

// --- Falsch-Positiv-Proben --------------------------------------------------

test('SMALLINT als Ja/Nein-Spalte bleibt gruen', () => {
	// Die Konvention der Flotte: worktime legt is_active, is_billable,
	// is_central, is_half_day und is_manual genau so an.
	const app = schemaApp({
		migrationen: {
			Version000001: `		$table = $schema->createTable('wt_employees');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('is_active', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
		$table->setPrimaryKey(['id']);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('nullable Boolean bleibt gruen', () => {
	// vinariums would_rebuy — die zweite zulaessige Form.
	const app = schemaApp({
		migrationen: {
			Version000105: `		$table = $schema->getTable('vinarium_tasting');
		$table->addColumn('would_rebuy', Types::BOOLEAN, ['notnull' => false, 'default' => null]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

// --- Gueltigkeitsbedingung 1: die <database>-Deklaration --------------------

test('deklarierte Datenbanken schalten die Oracle-Regeln ab', () => {
	// MigrationService setzt checkOracle nur, wenn info.xml keine
	// <database>-Abhaengigkeit nennt. rechnungswerk und projektwerk tun es —
	// fuer sie waere ein Befund hier ein Fehlalarm gegen Code, den NC durchlaesst.
	const app = schemaApp({
		datenbanken: ['sqlite', 'mysql', 'pgsql'],
		migrationen: {
			Version000001: `		$table = $schema->getTable('rw_invoice');
		$table->addColumn('is_paid', Types::BOOLEAN, ['notnull' => true, 'default' => false]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /Oracle-Regeln uebersprungen/)
})

test('ausdruecklich deklariertes oci schaltet sie wieder an', () => {
	const app = schemaApp({
		datenbanken: ['sqlite', 'mysql', 'pgsql', 'oci'],
		migrationen: {
			Version000001: `		$table = $schema->getTable('rw_invoice');
		$table->addColumn('is_paid', Types::BOOLEAN, ['notnull' => true, 'default' => false]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /NOT-NULL-Boolean/)
})

// --- Die uebrigen Datenregeln ----------------------------------------------

test('NOT NULL mit Leerstring-Vorgabe wird beim Erweitern abgewiesen', () => {
	const app = schemaApp({
		migrationen: {
			Version000002: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('remark', Types::STRING, ['notnull' => true, 'default' => '', 'length' => 64]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Leer-Vorgabe/)
})

test('dieselbe Spalte in einer NEUEN Tabelle bleibt gruen', () => {
	// NC prueft diese Regel nur, wenn die Tabelle schon existiert: ohne
	// sourceTable faellt die Bedingung durch (MigrationService v32, Zeile 578).
	// Wer hier blockiert, meldet Code rot, den NC anstandslos migriert.
	const app = schemaApp({
		migrationen: {
			Version000001: `		$table = $schema->createTable('wt_notes');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('remark', Types::STRING, ['notnull' => true, 'default' => '', 'length' => 64]);
		$table->setPrimaryKey(['id']);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('String ueber 4000 Zeichen wird abgewiesen', () => {
	const app = schemaApp({
		migrationen: {
			Version000003: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('notiz', Types::STRING, ['notnull' => false, 'length' => 5000]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /String ueber 4000/)
	assert.match(ausgabe, /TEXT/)
})

// --- Gueltigkeitsbedingung 2: die NC-Version --------------------------------

test('Tabellenname ueber 22 Zeichen ohne eigenen Schluesselnamen: rot auf NC 32', () => {
	// v32: strlen(name) - prefix >= 23 wirft, wenn der Primaerschluessel den
	// Standardnamen traegt. contractmanager sitzt mit 22 genau an der Grenze.
	const app = schemaApp({
		minVersion: 32,
		migrationen: {
			Version000001: `		$table = $schema->createTable('contractmgr_categories_x');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->setPrimaryKey(['id']);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Tabellenname zu lang/)
	assert.match(ausgabe, /hoechstens 22/)
})

test('derselbe Name mit eigenem Schluesselnamen bleibt gruen', () => {
	// Mit eigenem Namen leitet die Datenbank nichts vom Tabellennamen ab, dann
	// gilt die weitere Grenze von 27.
	const app = schemaApp({
		minVersion: 32,
		migrationen: {
			Version000001: `		$table = $schema->createTable('contractmgr_categories_x');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->setPrimaryKey(['id'], 'cm_cat_x_pk');`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('derselbe Name bleibt gruen, wenn die App erst ab NC 33 laeuft', () => {
	// Seit v33 gilt eine glatte Grenze von 63 fuer alle, die scharfen
	// Oracle-Grenzen sind entfallen. projektwerk faellt in diesen Fall.
	const app = schemaApp({
		minVersion: 33,
		migrationen: {
			Version000001: `		$table = $schema->createTable('contractmgr_categories_x');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->setPrimaryKey(['id']);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Indexname ueber 30 Zeichen: rot auf NC 32, gruen ab NC 33', () => {
	// Die Flotte sitzt mit 29 Zeichen dicht unter der Grenze — der naechste
	// Index ist der, der sie reisst.
	const rumpf = `		$table = $schema->getTable('wt_archive_queue');
		$table->addIndex(['employee_id'], 'wt_archive_queue_employee_x_idx');`
	const rot = pruefe(schemaApp({ minVersion: 32, migrationen: { Version000001: rumpf } }))
	assert.equal(rot.code, 1, rot.ausgabe)
	assert.match(rot.ausgabe, /Indexname zu lang/)

	const gruen = pruefe(schemaApp({ minVersion: 33, migrationen: { Version000001: rumpf } }))
	assert.equal(gruen.code, 0, gruen.ausgabe)
})

test('Spaltenname ueber 63 Zeichen ist auf jeder Fassung rot', () => {
	const lang = 'a'.repeat(64)
	const app = schemaApp({
		minVersion: 33,
		datenbanken: ['sqlite', 'mysql', 'pgsql'],
		migrationen: {
			Version000001: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('${lang}', Types::STRING, ['notnull' => false, 'length' => 64]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Spaltenname zu lang/)
})

// --- Was der Pruefer nicht sehen kann, sagt er ------------------------------

test('Bezeichner aus einer Variablen wird gemeldet, blockiert aber nicht', () => {
	// vinarium legt zwei Spalten in einer Schleife an. Typ und Optionen stehen
	// im Quelltext, der Name nicht — und ein stilles Ueberspringen liesse das
	// Gruen wie eine Zusage aussehen, die der Pruefer nicht gibt.
	const app = schemaApp({
		migrationen: {
			Version000107: `		$table = $schema->getTable('vinarium_vintage');
		foreach (['photo_front_file_id', 'photo_back_file_id'] as $column) {
			$table->addColumn($column, Types::BIGINT, ['notnull' => false, 'default' => null]);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /erst zur Laufzeit fest/)
	assert.match(ausgabe, /\$column/)
})

test('Typ und Optionen werden auch bei dynamischem Namen geprueft', () => {
	const app = schemaApp({
		migrationen: {
			Version000107: `		$table = $schema->getTable('vinarium_vintage');
		foreach (['a', 'b'] as $column) {
			$table->addColumn($column, Types::BOOLEAN, ['notnull' => true, 'default' => false]);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /NOT-NULL-Boolean/)
})

// --- Randfaelle -------------------------------------------------------------

test('App ohne Migrationen laeuft durch', () => {
	const { code, ausgabe } = pruefe(schemaApp({}))
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /keine Migrationen/)
})

test('ausserhalb einer App bricht der Pruefer mit Exit 2 ab', () => {
	const app = schemaApp({})
	rmSync(join(app, 'appinfo', 'info.xml'))
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 2, ausgabe)
	assert.match(ausgabe, /info\.xml nicht gefunden/)
})

test('mehrere Migrationen werden alle gelesen', () => {
	const app = schemaApp({
		migrationen: {
			Version000001: `		$table = $schema->getTable('a');
		$table->addColumn('x', Types::SMALLINT, ['notnull' => true, 'default' => 0]);`,
			Version000002: `		$table = $schema->getTable('b');
		$table->addColumn('y', Types::BOOLEAN, ['notnull' => true, 'default' => false]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /"b"\."y"/)
})

test('eine zweite Tabelle in derselben Migration wird nicht der ersten zugeschlagen', () => {
	const app = schemaApp({
		migrationen: {
			Version000001: `		$erste = $schema->createTable('tab_eins');
		$erste->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$erste->setPrimaryKey(['id']);

		$zweite = $schema->createTable('tab_zwei');
		$zweite->addColumn('flag', Types::BOOLEAN, ['notnull' => true, 'default' => false]);
		$zweite->setPrimaryKey(['flag']);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /"tab_zwei"\."flag"/)
})

// --- Was Doctrine still voraussetzt -----------------------------------------

test('Boolean ganz ohne notnull-Option wird abgewiesen', () => {
	// Doctrine setzt Column::$_notnull auf true, wenn die Option fehlt
	// (3rdparty/doctrine/dbal/src/Schema/Column.php:37). Wer sie weglaesst,
	// bekommt NOT NULL — die Falle ist dieselbe, nur unsichtbar.
	const app = schemaApp({
		migrationen: {
			Version000001: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('flag', Types::BOOLEAN, ['default' => false]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /NOT-NULL-Boolean/)
	assert.match(ausgabe, /Doctrine setzt NOT NULL/)
})

test('NOT NULL ohne jede Vorgabe bleibt gruen', () => {
	// NC prueft strikt auf den Leerstring (getDefault() === ''). Fehlt der
	// Default, ist er null — und null === '' ist falsch, NC wirft nicht.
	// Wer hier blockiert, meldet die halbe Flotte rot: fast jede id-Spalte
	// steht so da.
	const app = schemaApp({
		migrationen: {
			Version000001: `		$table = $schema->getTable('wt_employees');
		$table->addColumn('nummer', Types::BIGINT, ['notnull' => true]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('zwei Tabellen ohne Zwischenvariable werden beide gemessen', () => {
	const app = schemaApp({
		minVersion: 32,
		migrationen: {
			Version000001: `		$schema->createTable('kurz');
		$schema->createTable('viel_zu_langer_tabellenname_hier');`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /viel_zu_langer_tabellenname_hier/)
})
