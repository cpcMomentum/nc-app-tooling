/**
 * Gemeinsames Lesen von PHP-Quelltext fuer die Pruefer dieses Repos.
 *
 * Kein Parser und keiner, der es werden will — nur so viel, wie zwei Werkzeuge
 * brauchen, um einen Methodenaufruf samt seiner Argumente zu finden. Es steht
 * hier, weil dieses Repo gegen genau ein Problem gebaut ist: dieselbe Logik
 * zweimal, und zwei Kopien laufen auseinander (README, "Warum es dieses Repo
 * gibt"). Das gilt innerhalb des Repos genauso wie zwischen den Apps.
 */

/**
 * Zerlegt die Argumentliste eines Aufrufs ab der oeffnenden Klammer.
 * Beachtet Verschachtelung und Zeichenketten, damit ein Komma in einem
 * Array-Literal oder in einer Meldung die Liste nicht zerreisst.
 */
export function argumente(quelle, klammerAuf) {
	const args = []
	let tiefe = 0
	let start = klammerAuf + 1
	let quote = null
	for (let i = start; i < quelle.length; i++) {
		const c = quelle[i]
		if (quote) {
			if (c === '\\') i++
			else if (c === quote) quote = null
			continue
		}
		if (c === "'" || c === '"') { quote = c; continue }
		if (c === '(' || c === '[' || c === '{') tiefe++
		else if (c === ')' || c === ']' || c === '}') {
			if (c === ')' && tiefe === 0) {
				args.push(quelle.slice(start, i))
				return { args, ende: i }
			}
			tiefe--
		} else if (c === ',' && tiefe === 0) {
			args.push(quelle.slice(start, i))
			start = i + 1
		}
	}
	return { args, ende: quelle.length }
}

/** Zeilennummer zu einer Position im Quelltext. */
export const zeileVon = (quelle, index) => quelle.slice(0, index).split('\n').length

/** Der Inhalt eines Zeichenketten-Literals, sonst null. */
export const alsName = (arg) => (arg.trim().match(/^['"]([^'"]*)['"]$/) || [])[1] ?? null
