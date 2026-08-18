/**
 * nc-notification-check — Abnahme aus nc-app-tooling#8.
 *
 * Der Kern jedes Falls: ein Notifier, der jeden Unit-Test besteht und beim
 * Nutzer eine Benachrichtigung ohne Icon und ohne Link abliefert. Genau so lief
 * worktime auf NC 34 (worktime#551).
 *
 * Die Erwartungen sind gegen NCs eigenen Quelltext gesetzt:
 * lib/private/Notification/Notification.php und Action.php in 34.0.0.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { lauf, notifierApp } from './helfer.mjs'

const pruefe = (app) => lauf('notification-check.mjs', app)

// --- Der Vorfall ------------------------------------------------------------

test('Gegenprobe worktime#551: setIcon mit imagePath wird abgewiesen', () => {
	const app = notifierApp(`		$notification->setIcon(
			$this->urlGenerator->imagePath('worktime', 'app-dark.svg')
		);
		$notification->setLink(
			$this->urlGenerator->linkToRouteAbsolute('worktime.page.index')
		);`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /setIcon mit relativer URL/)
	// Die Meldung muss den Ausweg nennen, sonst wird der Riegel umgangen.
	assert.match(ausgabe, /getAbsoluteURL/)
})

test('die ausgelieferte Fassung derselben Zeile ist gruen', () => {
	// So steht es seit dem Fix in worktime.
	const app = notifierApp(`		$notification->setIcon(
			$this->urlGenerator->getAbsoluteURL(
				$this->urlGenerator->imagePath('worktime', 'app-dark.svg')
			)
		);
		$notification->setLink(
			$this->urlGenerator->linkToRouteAbsolute('worktime.page.index')
		);`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
})

test('setLink mit linkToRoute wird abgewiesen', () => {
	// linkToRoute liefert einen Pfad, linkToRouteAbsolute eine URL — im
	// Quelltext unterscheiden sie sich um acht Zeichen.
	const app = notifierApp(`		$notification->setLink($this->urlGenerator->linkToRoute('testapp.page.index'));`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /setLink mit relativer URL/)
})

// --- Literale ---------------------------------------------------------------

test('absolutes Literal bleibt gruen, relatives nicht', () => {
	const gruen = pruefe(notifierApp(`		$notification->setLink('https://example.com/apps/testapp');`))
	assert.equal(gruen.code, 0, gruen.ausgabe)

	const rot = pruefe(notifierApp(`		$notification->setLink('/apps/testapp');`))
	assert.equal(rot.code, 1, rot.ausgabe)
	assert.match(rot.ausgabe, /relativer URL/)
})

test('Leerwert wird abgewiesen', () => {
	const { code, ausgabe } = pruefe(notifierApp(`		$notification->setIcon('');`))
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /Leerwert/)
})

test('leeres Subject wird abgewiesen', () => {
	// Notification::setSubject wirft bei einem leeren Wert genauso.
	const { code, ausgabe } = pruefe(notifierApp(`		$notification->setParsedSubject('');`))
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /setParsedSubject mit Leerwert/)
})

// --- Hilfsmethoden ----------------------------------------------------------

test('Hilfsmethode mit absoluten Rueckgaben wird aufgeloest', () => {
	// Die Form aus projektwerk: ternaere Rueckgabe ueber eine Variable. Ohne
	// Aufloesung stuende hier ein Hinweis, der nie verschwindet — und ein
	// Hinweis, der immer steht, wird ignoriert.
	const app = notifierApp(
		`		$notification->setLink($this->linkZu(42));`,
		`
	private function linkZu(int $id): string {
		$link = $this->urlGenerator->linkToRouteAbsolute('testapp.deepLink.ticket', ['id' => $id]);

		return str_contains($link, '/t/' . $id)
			? $link
			: $this->urlGenerator->getAbsoluteURL('/index.php/apps/testapp/t/' . $id);
	}`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.doesNotMatch(ausgabe, /zur Laufzeit/)
})

test('Hilfsmethode mit relativer Rueckgabe wird abgewiesen', () => {
	const app = notifierApp(
		`		$notification->setLink($this->linkZu(42));`,
		`
	private function linkZu(int $id): string {
		return $this->urlGenerator->linkToRoute('testapp.page.index', ['id' => $id]);
	}`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /relativer URL/)
})

test('ein Wert von aussen wird gemeldet, blockiert aber nicht', () => {
	const app = notifierApp(`		$ziel = $notification->getObjectId();
		$notification->setLink($ziel);`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /zur Laufzeit/)
	assert.match(ausgabe, /setLink/)
})

// --- IAction ----------------------------------------------------------------

test('Anfrageart der Aktion wird geprueft', () => {
	const gruen = pruefe(notifierApp(
		`		$action->setLink($this->urlGenerator->linkToRouteAbsolute('testapp.api.ok'), 'POST');`))
	assert.equal(gruen.code, 0, gruen.ausgabe)

	const rot = pruefe(notifierApp(
		`		$action->setLink($this->urlGenerator->linkToRouteAbsolute('testapp.api.ok'), 'PATCH');`))
	assert.equal(rot.code, 1, rot.ausgabe)
	assert.match(rot.ausgabe, /unbekannter Anfrageart/)
})

test('auch die Aktion braucht eine absolute URL', () => {
	// Action::setLink prueft dasselbe wie Notification::setLink — der Riegel
	// darf also nicht am Empfaenger haengen.
	const { code, ausgabe } = pruefe(notifierApp(
		`		$action->setLink($this->urlGenerator->linkToRoute('testapp.api.ok'), 'GET');`))
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /relativer URL/)
})

// --- Randfaelle -------------------------------------------------------------

test('App ohne Notifier laeuft durch', () => {
	const app = notifierApp(`		$notification->setLink('https://example.com/');`)
	rmSync(join(app, 'lib', 'Notification'), { recursive: true })
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 0, ausgabe)
	assert.match(ausgabe, /kein lib\/Notification/)
})

test('ausserhalb einer App bricht der Pruefer mit Exit 2 ab', () => {
	const app = notifierApp(`		$notification->setLink('https://example.com/');`)
	rmSync(join(app, 'appinfo', 'info.xml'))
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 2, ausgabe)
	assert.match(ausgabe, /info\.xml nicht gefunden/)
})

test('mehrere Verletzungen werden alle genannt', () => {
	const app = notifierApp(`		$notification->setIcon($this->urlGenerator->imagePath('testapp', 'app.svg'));
		$notification->setLink($this->urlGenerator->linkToRoute('testapp.page.index'));`)
	const { code, ausgabe } = pruefe(app)
	assert.equal(code, 1, ausgabe)
	assert.match(ausgabe, /2 Vertragsverletzung/)
})
