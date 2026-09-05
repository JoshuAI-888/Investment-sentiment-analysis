import { describe, expect, it } from 'vitest';
import { htmlToText } from '@/services/substack/html';

describe('htmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello   <em>world</em></p>')).toBe('Hello world');
  });

  it('inserts a break at block boundaries so adjacent words do not fuse', () => {
    // Without a boundary space this yields "TeslaNvidia", a token matching no security — the
    // failure mode is a silently missed attribution, not a visible error.
    expect(htmlToText('<p>Tesla</p><p>Nvidia</p>')).toBe('Tesla Nvidia');
    expect(htmlToText('<li>Tesla</li><li>Nvidia</li>')).toBe('Tesla Nvidia');
    expect(htmlToText('Tesla<br/>Nvidia')).toBe('Tesla Nvidia');
  });

  it('drops script and style bodies rather than scoring them as prose', () => {
    expect(htmlToText('<p>Real</p><script>var x = "Tesla";</script>')).toBe('Real');
    expect(htmlToText('<style>.a{content:"Nvidia"}</style><p>Real</p>')).toBe('Real');
    // Attributes on the open tag must not defeat the match.
    expect(htmlToText('<script type="text/javascript">bad("AAPL")</script><p>Real</p>')).toBe('Real');
  });

  it('drops comments', () => {
    expect(htmlToText('<p>Real</p><!-- Tesla -->')).toBe('Real');
  });

  it('decodes the named entities Substack actually emits', () => {
    expect(htmlToText('<p>AT&amp;T</p>')).toBe('AT&T');
    expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
    expect(htmlToText('<p>it&rsquo;s</p>')).toBe('it’s');
  });

  it('decodes numeric entities in both bases', () => {
    expect(htmlToText('<p>&#65;&#x42;</p>')).toBe('AB');
  });

  it('drops an out-of-range or surrogate numeric entity instead of throwing', () => {
    // String.fromCodePoint throws RangeError on both. One malformed entity in one post must not
    // fail a whole publication's poll under D-16's forward-only clock.
    // The entity is dropped, not replaced with a space: the neighbours close up ('ab'). That is
    // the intended trade — a malformed entity degrades one word rather than failing the poll.
    expect(() => htmlToText('<p>a&#xFFFFFFF;b</p>')).not.toThrow();
    expect(htmlToText('<p>a&#xFFFFFFF;b</p>')).toBe('ab');
    expect(htmlToText('<p>a&#xD800;b</p>')).toBe('ab');
  });

  it('leaves an unknown named entity alone rather than mangling it', () => {
    expect(htmlToText('<p>&notarealentity;</p>')).toBe('&notarealentity;');
  });

  it('returns an empty string for markup with no text', () => {
    expect(htmlToText('<div><span></span></div>')).toBe('');
  });
});
