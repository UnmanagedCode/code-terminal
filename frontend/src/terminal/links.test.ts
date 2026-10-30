import { describe, expect, test, vi } from 'vitest';
import { activateLink, safeLinkHref } from './links';

const click = (mods: Partial<MouseEvent> = { ctrlKey: true }) => ({ ctrlKey: false, metaKey: false, ...mods }) as MouseEvent;

describe('activateLink', () => {
  test('javascript:, data:, file:, relative and protocol-relative URLs never open', () => {
    const open = vi.fn();
    for (const uri of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd',
      'relative/x', '//evil.test/x', '/root', 'vbscript:x', ' javascript:alert(1)', 'blob:https://x/1']) {
      expect(activateLink(click(), uri, open), uri).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });
  test('an http(s) link opens in a new window with noopener and noreferrer', () => {
    const open = vi.fn();
    expect(activateLink(click(), 'https://example.com/a?b#c', open)).toBe(true);
    expect(activateLink(click({ metaKey: true }), 'http://example.com/', open)).toBe(true);
    expect(open.mock.calls).toEqual([
      ['https://example.com/a?b#c', '_blank', 'noopener,noreferrer'],
      ['http://example.com/', '_blank', 'noopener,noreferrer'],
    ]);
  });
  test('a plain click without Ctrl or Cmd opens nothing', () => {
    const open = vi.fn();
    expect(activateLink(click({}), 'https://example.com/', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

test('the hover text is the real target, never the link text', () => {
  expect(safeLinkHref('https://real.test/x')).toBe('https://real.test/x');
  expect(safeLinkHref('javascript:alert(1)')).toBeNull();
});
