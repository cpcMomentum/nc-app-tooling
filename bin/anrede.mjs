// Anrede-Erkennung, geteilt von nc-l10n-check und nc-whatsnew-check.

export const DU_WORDS = /\b(du|dich|dir|dein|deine|deinem|deinen|deiner|deines)\b/i
export const SIE_WORDS = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/g
// Am Satzanfang kann "Sie"/"Ihr" auch 3. Person sein: dort nur Hinweis.
const SENTENCE_START = /(^|[.!?:;„"“(\n]\s*)$/

/** Sie-Formen eines Textes, getrennt nach Satzanfang und Satzmitte. */
export function sieFormen(text) {
	const amAnfang = [...text.matchAll(SIE_WORDS)].map((m) => SENTENCE_START.test(text.slice(0, m.index)))
	return { mitte: amAnfang.includes(false), anfang: amAnfang.includes(true) }
}

/** Duzt oder siezt der Text (Sie nur mitten im Satz)? */
export const hatAnrede = (text) => DU_WORDS.test(text) || sieFormen(text).mitte
