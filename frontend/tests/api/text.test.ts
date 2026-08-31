import { describe, expect, it } from 'vitest'

import { decodeEntities } from '../../src/api/text'

/**
 * 2,030 of the 19,449 populated session notes carry emoji written as character
 * references. React escapes text, so undecoded they render as literal "&#128218;".
 */
describe('decodeEntities', () => {
  it('decodes the numeric references the exports actually contain', () => {
    expect(decodeEntities('Good luck with your CBE! &#128218;&#127919;')).toBe(
      'Good luck with your CBE! 📚🎯',
    )
  })

  it('decodes astral code points to a single emoji, not two broken halves', () => {
    // 128077 is above 0xFFFF, so a naive fromCharCode would produce mojibake here.
    expect(decodeEntities('&#128077;')).toBe('👍')
    expect([...decodeEntities('&#128077;')]).toHaveLength(1)
  })

  it('decodes hex references and the five named ones', () => {
    expect(decodeEntities('&#x1F44D;')).toBe('👍')
    expect(decodeEntities('Fractions &amp; Decimals')).toBe('Fractions & Decimals')
    expect(decodeEntities('&lt;&gt;&quot;&apos;')).toBe('<>"\'')
  })

  it('leaves text without an ampersand exactly as it was', () => {
    const plain = 'Worked on linear functions today.'
    expect(decodeEntities(plain)).toBe(plain)
  })

  it('leaves anything it cannot decode alone rather than dropping it', () => {
    // An unknown or out-of-range reference must survive as written -- losing characters
    // from a note about a child is worse than showing an odd one.
    expect(decodeEntities('&notareference; &#999999999; &#xZZ;')).toBe(
      '&notareference; &#999999999; &#xZZ;',
    )
  })

  it('resolves references to text, never to markup', () => {
    // The decoder must not become an HTML parser: this returns the literal characters,
    // and React still escapes them on render. No row in the data contains a tag.
    expect(decodeEntities('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '<script>alert(1)</script>',
    )
  })
})
