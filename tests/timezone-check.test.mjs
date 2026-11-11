/**
 * nc-timezone-check: jede Regel einmal als Befund, jede Ausnahme einmal als
 * Nicht-Befund. Die Faelle stammen aus dem Audit der Flotte (nc-app-tooling#35).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { BIN, schreibe } from './helfer.mjs'

const angelegt = []
process.on('exit', () => angelegt.forEach((p) => rmSync(p, { recursive: true, force: true })))

function app(dateien) {
	const wurzel = mkdtempSync(join(tmpdir(), 'nc-tooling-tz-'))
	angelegt.push(wurzel)
	schreibe(wurzel, 'appinfo/info.xml', '<?xml version="1.0"?>\n<info><id>testapp</id></info>\n')
	for (const [pfad, inhalt] of Object.entries(dateien)) schreibe(wurzel, pfad, inhalt)
	return wurzel
}

const lauf = (wurzel) => spawnSync('node', [join(BIN, 'timezone-check.mjs')], { cwd: wurzel, encoding: 'utf8' })

const php = (zeile) => `<?php\nclass A {\n\tfunction f() {\n\t\t${zeile}\n\t}\n}\n`

const BEFUNDE = [
	'$now = new DateTime();',
	'$now = new \\DateTimeImmutable();',
	'$d = $x->getIssueDate() ?? new DateTime;',
	'return new DateTime(\'today\');',
	'if ($deadline < new DateTime("today")) {}',
	'$since = (new DateTime())->modify(\'-30 days\');',
	'$limit = new DateTime(\'tomorrow 00:00:00\', new \\DateTimeZone(\'UTC\'));',
	'$now = new DateTime(\'now\', new DateTimeZone("UTC"));',
	'$year = (int)date(\'Y\');',
	'$name = \'export-\' . date(\'Y-m-d\') . \'.csv\';',
	'$t = strtotime(\'today\');',
	'return $due->format(\'Y-m-d\') < $this->time->getDateTime()->format(\'Y-m-d\');',
	'$settings->setNumberCounterYear((int)(new DateTime())->format(\'Y\'));',
	'$purchase->setPurchasedAt($this->parseDate($x) ?? new DateTime());',
	'$invoice->setDueAt(new DateTime());',
	'$invoice->setPaidAt(new DateTime(\'today\'));',
	'$x->setTimestamp(strtotime(\'today\'));',
	'$qb->andWhere($qb->expr()->lt(\'due_at\', $qb->createNamedParameter(date(\'Y-m-d\'))));',
	'if ($row[\'created_at\'] < date(\'Y-m-d\')) {}',
	'$tag = date(\'Y-m-d\', time());',
	'$tag = date(\'Y-m-d\', $this->timeFactory->getTime());',
	'$tag = gmdate(\'Y-m-d\');',
	'$jahr = idate(\'Y\');',
	'$d = date_create();',
	'$d = date_create_immutable(\'today\');',
	'$tag = $this->timeFactory->now()->format(\'Y-m-d\');',
	'$d = new DateTime(\'monday this week\');',
	'$d = new DateTime("next month");',
	'$d = new DateTime(\'1 month ago\');',
	'$d = new DateTime(null);',
	'$d = new DateTime(\'\');',
	'$d = new \\Datetime();',
	'$d = new DateTime(datetime: \'now\');',
	'$d = new DateTime(',
	'$d = $this->timeFactory->getDateTime(\'today\', new \\DateTimeZone(\'UTC\'));',
	'/** doc */ $c = new DateTime();',
	'#[Pure] function g() { return date(\'Y\'); }',
	'$a = 1; $today = new DateTime(); $s = \'tz-ok: nur im String\';',
	'$e->setUpdatedAt($now)->setDueDate(new DateTime());',
	'$e->setCreatedAt($now); $e->setDueDate(new DateTime(\'+14 days\'));',
	'return [\'createdAt\' => $now, \'dueDate\' => new DateTime(\'today\')];',
	'return [\'exportedAt\' => date(\'c\'), \'year\' => date(\'Y\')];',
	'$y = \\date(\'Y\');',
	'$t = \\strtotime(\'today\');',
	'$now = $this->time->now();',
	'$e->setSpreadAt(new DateTime());',
]

const KEINE_BEFUNDE = [
	'$entity->setCreatedAt(new DateTime());',
	'$entity->setUpdatedAt(new \\DateTimeImmutable());',
	'$notification->setDateTime(new \\DateTime());',
	'->set(\'updated_at\', $qb->createNamedParameter(new DateTime(), IQueryBuilder::PARAM_DATETIME_MUTABLE))',
	'\'exportedAt\' => $this->timeFactory->getDateTime()->format(\'c\'),',
	'$heute = new DateTime(\'now\', $tz);',
	'$heute = new DateTime(\'today\', $this->zone->getTimeZone());',
	'$start = new DateTime($startDate);',
	'$start = new DateTime("$year-$month-01");',
	'$label = date(\'d.m.Y\', $timestamp);',
	'$ts = strtotime($eingabe);',
	'$a = $entity->getUpdatedAt()->format(\'Y-m-d\');',
	'$this->update($entity);',
	'$since = (new DateTime())->modify(\'-30 days\'); // tz-ok: rollendes Fenster, kein Kalendertag',
	'// alt: $now = new DateTime();',
	'$x = 5; // frueher new DateTime()',
	'$x = 5; /* new DateTime() */',
	'$x = 5; # date(\'Y\')',
	'$x = $this->date(\'Y\');',
	'$x = Util::date(\'Y\');',
	'$x = $obj->getDateTime($y);',
	'$z = new DateTimeZone(\'UTC\');',
	'$d = new DateTime(\'2024-01-01\');',
	'$t = strtotime(\'-1 day\', $basis);',
	'$e->setLastUsedAt(new DateTime());',
	'$e->setDatevStatusAt(new DateTime());',
	'\'deletedAt\' => (new DateTime())->format(\'c\'),',
	'$since = (new DateTime())->modify(\'-30 days\'); // TZ-OK: rollendes Fenster',
	'$lokal = $this->timeFactory->getDateTime()->setTimezone($this->zone->getTimeZone(false, $uid));',
	'$d = $this->timeFactory->getDateTime(\'2024-01-01\');',
	'$e->setCreatedAt($x ?? new DateTime());',
	'$now = $this->now();',
	'$e->setUpdatedAt((new DateTime())->setTimezone($utc));',
	'return [\'createdAt\' => new DateTime(), \'name\' => $name];',
	'$qb->set(\'updated_at\', $qb->createNamedParameter(new DateTime(), IQueryBuilder::PARAM_DATETIME_MUTABLE));',
]

for (const zeile of BEFUNDE) {
	test(`Befund: ${zeile}`, () => {
		const ergebnis = lauf(app({ 'lib/Service/A.php': php(zeile) }))
		assert.equal(ergebnis.status, 1, ergebnis.stdout)
		assert.match(ergebnis.stdout, /lib\/Service\/A\.php:4 /)
	})
}

for (const zeile of KEINE_BEFUNDE) {
	test(`kein Befund: ${zeile}`, () => {
		const ergebnis = lauf(app({ 'lib/Service/A.php': php(zeile) }))
		assert.equal(ergebnis.status, 0, ergebnis.stdout)
	})
}

test('die Begruendung darf in der Zeile davor stehen, braucht aber einen Grund', () => {
	const mit = lauf(app({ 'lib/A.php': php('// tz-ok: Zeitstempel fuer mehrere Felder\n\t\t$now = new DateTime();') }))
	assert.equal(mit.status, 0, mit.stdout)
	const ohne = lauf(app({ 'lib/A.php': php('// tz-ok:\n\t\t$now = new DateTime();') }))
	assert.equal(ohne.status, 1)
})

test('eine Marke am Zeilenende gilt nur fuer ihre Zeile', () => {
	const ergebnis = lauf(app({ 'lib/A.php': php('$a = new DateTime(); // tz-ok: Zeitstempel\n\t\t$today = new DateTime();') }))
	assert.equal(ergebnis.status, 1)
	assert.ok(ergebnis.stdout.includes('lib/A.php:5 '), ergebnis.stdout)
	assert.ok(!ergebnis.stdout.includes('lib/A.php:4 '))
})

test('eine Marke in einer Zeichenkette oder hinter fremdem Code der Vorzeile zaehlt nicht', () => {
	for (const vorzeile of ['$s = \'tz-ok: im String\';', '$log->info(1); // tz-ok: nur Log']) {
		const ergebnis = lauf(app({ 'lib/A.php': php(`${vorzeile}\n\t\t$today = new DateTime();`) }))
		assert.equal(ergebnis.status, 1, vorzeile)
	}
})

test('Blockkommentare ueber mehrere Zeilen sind kein Code, danach wird wieder geprueft', () => {
	const ergebnis = lauf(app({ 'lib/A.php': php('/*\n\t\t$alt = new DateTime();\n\t\t*/\n\t\t$neu = new DateTime();') }))
	assert.equal(ergebnis.status, 1)
	assert.ok(ergebnis.stdout.includes('lib/A.php:7 '), ergebnis.stdout)
	assert.match(ergebnis.stdout, /1 Stelle\(n\)/)
})

test('nur lib/Migration ist ausgenommen, kein gleichnamiger Ordner tiefer', () => {
	const ergebnis = lauf(app({ 'lib/Db/Migration/X.php': php('$x = date(\'Y\');') }))
	assert.equal(ergebnis.status, 1)
})

test('Frontend: toISOString() als Kalendertag ist ein Befund, lokale Bestandteile nicht', () => {
	const ergebnis = lauf(app({
		'src/a.vue': '<script>\nconst d = new Date().toISOString().substring(0, 10)\n</script>\n',
		'src/b.ts': 'export const t = (d: Date) => d.toISOString().slice(0, 10)\n',
		'src/c.js': 'const tag = jetzt.toISOString().split(\'T\')[0]\n',
		'src/d.ts': 'export const ok = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`\nexport const iso = (d: Date) => d.toISOString()\n',
		'src/e.spec.ts': 'const d = new Date().toISOString().slice(0, 10)\n',
		'src/f.spec.vue': '<script>\nconst d = new Date().toISOString().slice(0, 10)\n</script>\n',
		'src/g.vue': '<template>\n<!-- d.toISOString().slice(0, 10) -->\n</template>\n<script>\nconst uhr = d.toISOString().split(\'T\')[1]\n</script>\n',
		'src/h.tsx': 'const monat = d.toISOString()?.substring(0, 7)\n',
		'src/i.ts': 'const p = pfad.replace(/\\/*$/, \'\')\nconst tag = new Date().toISOString().slice(0, 10)\nconst u = url.replace(/^https?:\\/\\//, \'\') + d.toISOString().slice(0, 10)\n',
	}))
	assert.equal(ergebnis.status, 1)
	for (const datei of ['src/a.vue:2', 'src/b.ts:1', 'src/c.js:1', 'src/h.tsx:1', 'src/i.ts:2', 'src/i.ts:3']) assert.ok(ergebnis.stdout.includes(datei), datei)
	assert.ok(!ergebnis.stdout.includes('src/d.ts'))
	for (const datei of ['src/e.spec.ts', 'src/f.spec.vue', 'src/g.vue']) assert.ok(!ergebnis.stdout.includes(datei), datei)
	assert.match(ergebnis.stdout, /6 Stelle\(n\)/)
})

test('Migrationen werden nicht geprueft', () => {
	const ergebnis = lauf(app({ 'lib/Migration/V1.php': php('$x = date(\'Y-m-d H:i:s\');') }))
	assert.equal(ergebnis.status, 0)
})

test('ausserhalb einer App -> Exit 1 mit Meldung', () => {
	const leer = mkdtempSync(join(tmpdir(), 'nc-tooling-tz-leer-'))
	angelegt.push(leer)
	const ergebnis = lauf(leer)
	assert.equal(ergebnis.status, 1)
	assert.match(ergebnis.stderr, /kein App-Verzeichnis/)
})
