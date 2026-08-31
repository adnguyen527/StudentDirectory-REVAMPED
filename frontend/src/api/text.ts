/**
 * Source-data cleanup for the free-text fields.
 *
 * The Excel exports carry emoji as HTML character references rather than characters:
 * 2,030 of the 19,449 populated session_summary_notes contain them (10.4%), and every
 * one seen is an emoji -- "Good luck with your CBE! &#128218;&#127919;". React escapes
 * text by design, so left alone they render as that literal gibberish.
 */

// Only these five. The dataset has 29 rows with a named reference and none at all
// containing tag-like text, so an exhaustive table would be dead weight.
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Character references -> the characters they name.
 *
 * Deliberately not an HTML parse: this resolves references to text and hands back a
 * string, which still goes through React's normal escaping. Nothing here can introduce
 * markup, so a note containing "<script>" stays the literal words "<script>" -- which is
 * also what the data actually holds, since no row contains a tag.
 */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value

  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    const token = body.toLowerCase()

    if (token.startsWith('#')) {
      const codePoint = token.startsWith('#x')
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10)
      // Surrogates and out-of-range values would make fromCodePoint throw; an
      // undecodable reference is left exactly as it was rather than lost.
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return whole
      return String.fromCodePoint(codePoint)
    }

    return NAMED[token] ?? whole
  })
}
