import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';

// No test may reach the network. The page's real `fetch` is replaced by a
// tripwire that records and refuses; `vi.unstubAllGlobals()` restores a test's
// stub to this, so a request sent after a test unstubs (an unmount flush, say)
// lands here and fails the test.
const escaped: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
  escaped.push(String(input instanceof Request ? input.url : input));
  return Promise.reject(new Error('a test reached the real network'));
}) as typeof fetch;

afterEach(() => {
  cleanup();
  expect(escaped.splice(0), 'requests that reached the real fetch').toEqual([]);
});
