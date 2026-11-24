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

// --- Zeilengroesse auf MySQL/MariaDB (#50) -----------------------------------
//
// Die Byte-Werte sind am 25.11.2026 gegen mariadb:11 und mysql:8.4 gemessen
// (utf8mb4, Binaersuche je Typ), nicht aus der Dokumentation uebernommen.
// Die Oracle-Regeln stehen bei diesen Faellen aus (`mysql` deklariert), damit
// eine lange STRING-Spalte nicht schon an "String ueber 4000" scheitert.

const OHNE_ORACLE = ['mysql', 'pgsql', 'sqlite']

/** pwerk_projects vor projektwerk#511, auf das Wesentliche gekuerzt. */
const projekteTabelle = (vierte) => `		$table = $schema->createTable('pwerk_projects');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$table->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
		$table->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('folder_public_path', Types::STRING, ['notnull' => false, 'length' => 4000]);
		$table->addColumn('folder_internal_path', Types::STRING, ['notnull' => false, 'length' => 4000]);
		$table->addColumn('chat_url', Types::STRING, ['notnull' => false, 'length' => 4000]);
		$table->addColumn('folder_root_path', ${vierte}, ['notnull' => false, 'length' => 4000]);
		$table->addColumn('created_at', Types::DATETIME, ['notnull' => true]);
		$table->setPrimaryKey(['id']);`

test('Zeilengroesse: Tabelle ueber 65.535 Byte wird abgewiesen', () => {
	// 4 x 16.002 + 1.022 + 258 + 8 + 5 + Null-Bitmap 1 = 65.302, noch gruen.
	// Eine weitere 255er-Spalte (1.022) reisst die Grenze.
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: projekteTabelle('Types::STRING').replace("$table->setPrimaryKey", "$table->addColumn('beschreibung', Types::STRING, ['notnull' => false, 'length' => 255]);\n\t\t$table->setPrimaryKey"),
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Zeilengroesse MySQL\/MariaDB/)
	assert.match(ausgabe, /"pwerk_projects"/)
	assert.match(ausgabe, /66\.324/)
	// Der Ausweg muss in der Meldung stehen.
	assert.match(ausgabe, /Types::TEXT/)
	assert.match(ausgabe, /folder_public_path/)
})

test('Zeilengroesse: dieselbe Tabelle mit TEXT ist gruen', () => {
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: projekteTabelle('Types::TEXT').replace("$table->setPrimaryKey", "$table->addColumn('beschreibung', Types::STRING, ['notnull' => false, 'length' => 255]);\n\t\t$table->setPrimaryKey"),
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: vier STRING 4000 allein passen (64.016 Byte)', () => {
	// Die Rechnung in #50 ("4 x 16.000 > 65.535") geht nicht auf. Gegen
	// mariadb:11 und mysql:8.4 nachgemessen: diese Tabelle laesst sich anlegen.
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: `		$table = $schema->createTable('vier');
		$table->addColumn('id', Types::BIGINT, ['notnull' => true]);
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('c', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('d', Types::STRING, ['notnull' => true, 'length' => 4000]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: genau 65.535 ist gruen, ein Byte mehr rot', () => {
	const rumpf = (zusatz) => `		$table = $schema->createTable('grenze');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16383]);
		${zusatz}`
	// 16.383 x 4 + 2 = 65.534, dazu BOOLEAN NOT NULL (1) = 65.535.
	const genau = pruefe(schemaApp({ datenbanken: OHNE_ORACLE, migrationen: { V1: rumpf("$table->addColumn('x', Types::BOOLEAN, ['notnull' => true]);") } }))
	assert.equal(genau.code, 0, genau.ausgabe)
	// SMALLINT (2) statt BOOLEAN: 65.536.
	const drueber = pruefe(schemaApp({ datenbanken: OHNE_ORACLE, migrationen: { V1: rumpf("$table->addColumn('x', Types::SMALLINT, ['notnull' => true]);") } }))
	assert.equal(drueber.code, 1, drueber.ausgabe)
})

test('Zeilengroesse: nullable Spalten kosten das Null-Bitmap', () => {
	// Wie oben genau 65.535 — aber die BOOLEAN ist nullable, also ein Byte
	// Bitmap mehr. MariaDB und MySQL lehnen das ab.
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			V1: `		$table = $schema->createTable('grenze');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16383]);
		$table->addColumn('x', Types::BOOLEAN, ['notnull' => false]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /65\.536/)
})

test('Zeilengroesse: die Spalte einer spaeteren Migration wird mitgezaehlt', () => {
	// Genau der Weg aus projektwerk#510: Migration 22 haengt die vierte
	// lange Spalte an eine bestehende Tabelle.
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: projekteTabelle('Types::STRING').replace(/\n.*folder_root_path.*/, ''),
			Version000022: `		$projects = $schema->getTable('pwerk_projects');
		if (!$projects->hasColumn('folder_root_path')) {
			$projects->addColumn('folder_root_path', Types::STRING, ['notnull' => false, 'length' => 4000]);
		}
		if (!$projects->hasColumn('notiz')) {
			$projects->addColumn('notiz', Types::STRING, ['notnull' => false, 'length' => 255]);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Version000022\.php:\d+/)
})

test('Zeilengroesse: dieselbe Spalte erneut angelegt zaehlt einmal', () => {
	// projektwerk Migration 13 legt die Pfadspalten hinter hasColumn() noch
	// einmal an. Doppelt gezaehlt waere das ein Fehlalarm.
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: projekteTabelle('Types::STRING'),
			Version000013: `		$projects = $schema->getTable('pwerk_projects');
		if (!$projects->hasColumn('chat_url')) {
			$projects->addColumn('chat_url', Types::STRING, ['notnull' => false, 'length' => 4000]);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: dropColumn gibt den Platz frei', () => {
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			Version000001: projekteTabelle('Types::STRING'),
			Version000002: `		$table = $schema->getTable('pwerk_projects');
		$table->dropColumn('chat_url');
		$table->addColumn('notiz', Types::STRING, ['notnull' => false, 'length' => 255]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: setType und setLength auf getColumn werden nachgezogen', () => {
	const zuGross = `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 16000]);
		$table->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 1000]);`
	assert.equal(pruefe(schemaApp({ datenbanken: OHNE_ORACLE, migrationen: { V1: zuGross } })).code, 1)
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			V1: zuGross.replace("'length' => 1000", "'length' => 10"),
			// In V2 waechst b — aber a wird vorher kleiner (brandmail-Muster).
			V2: `		$table = $schema->getTable('t');
		$column = $table->getColumn('a');
		$column->setType(\\Doctrine\\DBAL\\Types\\Type::getType('text'));
		$table->getColumn('b')->setLength(1000);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: Apps ohne mysql in info.xml sind ausgenommen', () => {
	const app = schemaApp({
		datenbanken: ['pgsql', 'sqlite'],
		migrationen: {
			V1: `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 16383]);
		$table->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 16383]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('Zeilengroesse: ohne <database> gilt die Regel', () => {
	// Keine Deklaration heisst: die App darf auf MySQL laufen.
	const app = schemaApp({
		minVersion: 33,
		migrationen: {
			V1: `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('c', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('d', Types::STRING, ['notnull' => true, 'length' => 4000]);
		$table->addColumn('e', Types::STRING, ['notnull' => true, 'length' => 400]);`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Zeilengroesse/)
})

test('Zeilengroesse: unbekannter Typ und Laufzeit-Drop werden genannt', () => {
	const app = schemaApp({
		datenbanken: OHNE_ORACLE,
		migrationen: {
			V1: `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true]);
		$table->addColumn('b', $typ, ['notnull' => true]);
		foreach (['x', 'y'] as $col) {
			$table->dropColumn($col);
		}`,
		},
	})
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /Typ \$typ/)
	assert.match(ausgabe, /dropColumn\(\$col\)/)
})

test('Zeilengroesse: TEXT zaehlt 12 Byte, nicht null', () => {
	// 16.380 x 4 + 2 = 65.522. Eine TEXT-Spalte: 65.534, gruen. Zwei: 65.546, rot.
	const rumpf = (texte) => `		$table = $schema->createTable('t');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16380]);
${texte.map((n) => `		$table->addColumn('${n}', Types::TEXT, ['notnull' => true]);`).join('\n')}`
	assert.equal(pruefe(schemaApp({ datenbanken: OHNE_ORACLE, migrationen: { V1: rumpf(['a']) } })).code, 0)
	assert.equal(pruefe(schemaApp({ datenbanken: OHNE_ORACLE, migrationen: { V1: rumpf(['a', 'b']) } })).code, 1)
})

const zeile = (migrationen, datenbanken = OHNE_ORACLE) => pruefe(schemaApp({ datenbanken, migrationen }))
const basis = `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 16000]);
		$table->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 10]);`

test('Zeilengroesse: verkettetes getTable()->getColumn()->setLength() zaehlt', () => {
	// Nur die Kette selbst reisst die Grenze: b waechst von 41 auf 4.002 Byte.
	assert.equal(zeile({ V1: basis, V2: "		$schema->getTable('t')->getColumn('b')->setLength(1000);" }).code, 1)
	assert.equal(zeile({ V1: basis, V2: "		$schema->getTable('t')->getColumn('b')->setLength(100);" }).code, 0)
})

test('Zeilengroesse: voll qualifiziertes Types::TEXT in setType und changeColumn wird erkannt', () => {
	const danach = "		$table->addColumn('c', Types::STRING, ['notnull' => true, 'length' => 1000]);"
	const perSetType = `		$table = $schema->getTable('t');
		$column = $table->getColumn('a');
		$column->setType(Type::getType(\\OCP\\DB\\Types::TEXT));
		$column->setLength(null);
${danach}`
	const perChange = `		$table = $schema->getTable('t');
		$table->changeColumn('a', ['type' => Type::getType(\\Doctrine\\DBAL\\Types\\Types::TEXT), 'length' => null]);
${danach}`
	for (const V2 of [perSetType, perChange]) {
		const { code, ausgabe } = zeile({ V1: basis, V2 })
		assert.equal(code, 0, ausgabe)
		assert.doesNotMatch(ausgabe, /teilweise geprueft/)
	}
})

test('Zeilengroesse: nicht lesbares setType nimmt die Spalte aus der Summe und nennt sie', () => {
	const { code, ausgabe } = zeile({ V1: basis, V2: `		$table = $schema->getTable('t');
		$table->getColumn('a')->setType($neuerTyp);
		$table->addColumn('c', Types::STRING, ['notnull' => true, 'length' => 1000]);` })
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /setType\(\$neuerTyp\)/)
})

test('Zeilengroesse: changeColumn mit length wird nachgezogen', () => {
	const V2 = (n) => `		$table = $schema->getTable('t');
		$table->changeColumn('b', ['length' => ${n}]);`
	assert.equal(zeile({ V1: basis, V2: V2(1000) }).code, 1)
	assert.equal(zeile({ V1: basis, V2: V2(100) }).code, 0)
})

test('Zeilengroesse: verkettetes getTable()->dropColumn() gibt Platz frei', () => {
	const V1 = basis.replace("'length' => 10]", "'length' => 1000]")
	assert.equal(zeile({ V1 }).code, 1)
	// V1 allein ist schon rot; V2 auf eine zweite Tabelle, die erst nach dem Drop passt.
	const zwei = `		$table = $schema->createTable('u');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 16000]);`
	const V2 = `		$schema->getTable('u')->dropColumn('a');
		$schema->getTable('u')->addColumn('b', Types::STRING, ['notnull' => true, 'length' => 16000]);`
	assert.equal(zeile({ V1: zwei, V2 }).code, 0)
})

test('Zeilengroesse: setNotnull(false) kostet das Null-Bitmap', () => {
	const V1 = `		$table = $schema->createTable('grenze');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16383]);
		$table->addColumn('x', Types::BOOLEAN, ['notnull' => true]);`
	assert.equal(zeile({ V1 }).code, 0)
	assert.equal(zeile({ V1, V2: "		$schema->getTable('grenze')->getColumn('x')->setNotnull(false);" }).code, 1)
})

test('Zeilengroesse: ein spaeterer dropColumn rettet die fruehere Migration nicht, gemeldet wird einmal', () => {
	const V1 = `		$table = $schema->createTable('grenze');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16383]);
		$table->addColumn('x', Types::SMALLINT, ['notnull' => true]);`
	const V2 = `		$table = $schema->getTable('grenze');
		$table->addColumn('y', Types::SMALLINT, ['notnull' => true]);
		$table->dropColumn('x');`
	const { code, ausgabe } = zeile({ V1, V2 })
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /V1\.php/)
	assert.equal(ausgabe.match(/braucht [\d.]+ Byte je Zeile/g)?.length, 1)
})

test('Zeilengroesse: DECIMAL, BINARY und GUID mit gemessenen Groessen', () => {
	// 16.380 x 4 + 2 = 65.522; der Rest bis 65.535 sind 13 Byte.
	const mit = (zusatz) => zeile({ V1: `		$table = $schema->createTable('t');
		$table->addColumn('lang', Types::STRING, ['notnull' => true, 'length' => 16380]);
		${zusatz}` }).code
	assert.equal(mit("$table->addColumn('d', Types::DECIMAL, ['notnull' => true, 'precision' => 10, 'scale' => 2]);"), 0)
	assert.equal(mit("$table->addColumn('d', Types::DECIMAL, ['notnull' => true, 'precision' => 30, 'scale' => 10]);"), 1)
	assert.equal(mit("$table->addColumn('b', Types::BINARY, ['notnull' => true, 'length' => 12]);"), 0)
	assert.equal(mit("$table->addColumn('b', Types::BINARY, ['notnull' => true, 'length' => 13]);"), 1)
	assert.equal(mit("$table->addColumn('g', 'guid', ['notnull' => true]);"), 1)
})

test('Zeilengroesse: neu zugewiesene Variable bekommt die Aenderung, nicht die alte Spalte', () => {
	const V1 = `		$table = $schema->createTable('t');
		$table->addColumn('a', Types::STRING, ['notnull' => true, 'length' => 16000]);
		$column = $table->getColumn('a');
		$column = $table->addColumn('c', Types::STRING, ['notnull' => true, 'length' => 10]);
		$column->setLength(16300);`
	assert.equal(zeile({ V1 }).code, 1)
})

test('Zeilengroesse: Apps ohne mysql bekommen keine Hinweise dazu', () => {
	const { ausgabe } = zeile({ V1: `		$table = $schema->createTable('t');
		$table->dropColumn($col);` }, ['pgsql', 'sqlite'])
	assert.doesNotMatch(ausgabe, /Zeilengroesse/)
})
