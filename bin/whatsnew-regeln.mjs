/**
 * Regeln des „Was ist neu?"-Fensters (Baustein 0b) — die EINE Quelle fuer:
 *   - pruefeSchema():    Aufbau der whatsnew.json (de/en Pflicht, where
 *                        zweisprachig, plus boolean, Versionsschluessel x.y.z).
 *   - versionsBefund():  passt der Datei-Inhalt zur Release-Version?
 *
 * Bis v1.16.0 lag die Schema-Pruefung als PHPUnit-Test in jeder App einzeln
 * (testDieAusgelieferteDateiIstGueltig), die Versionspruefung nirgends
 * (nc-app-tooling#27). Beides gehoert an eine Stelle: nc-whatsnew-check faehrt
 * das Schema in der App-CI, nc-release-check faehrt Schema UND Version beim
 * Release. Diese Datei ist die geteilte Wahrheit fuer beide.
 *
 * BEWUSST NICHT hier: alles App-Spezifische. Die Icon-Whitelist kennt nur der
 * Dialog der jeweiligen App (WhatsNewDialog.vue). Und `plus` ist je App
 * verschieden — rechnungswerk/worktime verlangen es, vinarium VERBIETET es
 * ausdruecklich (kein Plus-Tier, testAssertArrayNotHasKey). Ein universeller
 * Check darf so etwas nicht erzwingen: hier gilt nur „wenn plus da ist, dann
 * boolean". Ob es Pflicht oder verboten ist, bleibt eine app-eigene Pruefung.
 */

const VERSION_RE = /^\d+\.\d+\.\d+$/

/** Vergleicht Punkt-Versionen (x.y.z) numerisch je Stelle. */
export function semverVergleich(a, b) {
	const as = String(a).split('.').map(Number)
	const bs = String(b).split('.').map(Number)
	const n = Math.max(as.length, bs.length)
	for (let i = 0; i < n; i++) {
		const d = (as[i] ?? 0) - (bs[i] ?? 0)
		if (d !== 0) return d < 0 ? -1 : 1
	}
	return 0
}

/**
 * Prueft den Aufbau eines whatsnew-Katalogs. Liefert eine Liste von Fehlern;
 * leer heisst gueltig. Die Meldungen nennen Version und Feld, damit im
 * CI-Protokoll steht, WO es klemmt.
 *
 * @param {unknown} katalog  bereits geparster whatsnew.json-Inhalt
 * @returns {string[]}
 */
export function pruefeSchema(katalog) {
	const fehler = []
	if (katalog === null || typeof katalog !== 'object' || Array.isArray(katalog)) {
		return ['whatsnew.json ist kein Objekt { "x.y.z": [ … ] }']
	}
	const versionen = Object.keys(katalog)
	if (versionen.length === 0) {
		return ['whatsnew.json ist leer — kein einziger Versionsschluessel']
	}

	for (const version of versionen) {
		if (!VERSION_RE.test(version)) {
			fehler.push(`Versionsschluessel "${version}" ist kein x.y.z`)
		}
		const eintraege = katalog[version]
		if (!Array.isArray(eintraege)) {
			fehler.push(`${version}: Wert ist kein Array von Eintraegen`)
			continue
		}
		eintraege.forEach((eintrag, i) => {
			const wo = `${version} Eintrag ${i + 1}`
			if (eintrag === null || typeof eintrag !== 'object' || Array.isArray(eintrag)) {
				fehler.push(`${wo}: kein Objekt`)
				return
			}
			// title und text sind Pflicht, je mit de UND en, nicht leer.
			for (const feld of ['title', 'text']) {
				const wert = eintrag[feld]
				if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
					fehler.push(`${wo}: ${feld} fehlt oder ist nicht mehrsprachig`)
					continue
				}
				for (const sprache of ['de', 'en']) {
					const text = wert[sprache]
					if (typeof text !== 'string' || text.trim() === '') {
						fehler.push(`${wo}: ${feld}.${sprache} fehlt oder ist leer`)
					}
				}
			}
			// plus ist optional (je App Pflicht ODER verboten) — hier nur:
			// wenn vorhanden, dann boolean.
			if (eintrag.plus !== undefined && typeof eintrag.plus !== 'boolean') {
				fehler.push(`${wo}: plus ist nicht true/false`)
			}
			// where ist optional, aber wenn da, dann zweisprachig.
			if (eintrag.where !== undefined) {
				const w = eintrag.where
				if (w === null || typeof w !== 'object' || Array.isArray(w)) {
					fehler.push(`${wo}: where ist nicht mehrsprachig`)
				} else {
					for (const sprache of ['de', 'en']) {
						if (typeof w[sprache] !== 'string' || w[sprache].trim() === '') {
							fehler.push(`${wo}: where.${sprache} fehlt oder ist leer`)
						}
					}
				}
			}
		})
	}
	return fehler
}

/**
 * Passt der Katalog zur Release-Version? Erwartet einen bereits schema-gueltigen
 * Katalog (die Versionsschluessel muessen x.y.z sein).
 *
 *   grün     Schluessel fuer die Release-Version vorhanden (auch leeres Array —
 *            ein Wartungsrelease ohne Berichtenswertes ist vorgesehen).
 *   warnung  kein Schluessel fuer die Release-Version — bewusst? (kein Abbruch)
 *   fehler   ein Schluessel liegt NEUER als das Release — koennte nie erscheinen
 *            (WhatsNewService deckelt nach der installierten Version).
 *
 * @param {Record<string, unknown>} katalog
 * @param {string} releaseVersion  z. B. "0.5.3"
 * @returns {{art: 'grün'|'warnung'|'fehler', text: string}}
 */
export function versionsBefund(katalog, releaseVersion) {
	const schluessel = Object.keys(katalog)
	const zukunft = schluessel.filter((v) => semverVergleich(v, releaseVersion) > 0)
	if (zukunft.length) {
		return {
			art: 'fehler',
			text: `Schluessel aus der Zukunft (${zukunft.join(', ')}) — neuer als das Release ${releaseVersion}, `
				+ 'kann bei niemandem erscheinen (das Fenster deckelt nach der installierten Version)',
		}
	}
	if (schluessel.includes(releaseVersion)) {
		return { art: 'grün', text: `Eintrag fuer ${releaseVersion} vorhanden` }
	}
	return {
		art: 'warnung',
		text: `kein Eintrag fuer die Release-Version ${releaseVersion} — das Fenster bleibt aus. `
			+ 'Bei einem Wartungsrelease ohne Berichtenswertes ist das in Ordnung, es muss nur bewusst sein',
	}
}
