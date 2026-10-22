// Unit tests of the hard reload shortcut in recover.ts. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reloadShortcut } from './recover.ts';

const UA = {
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

test('macOS Chrome and Firefox: Cmd + Shift + R', () => {
  for (const ua of [UA.macChrome, UA.macFirefox]) {
    assert.deepEqual(reloadShortcut('MacIntel', ua).keys, [['⌘ Cmd', '⇧ Shift', 'R']]);
  }
  // Chromium User-Agent Client Hints give "macOS".
  assert.deepEqual(reloadShortcut('macOS', UA.macChrome).keys, [['⌘ Cmd', '⇧ Shift', 'R']]);
});

test('macOS Safari: Option + Cmd + R', () => {
  const s = reloadShortcut('MacIntel', UA.macSafari);
  assert.deepEqual(s.keys, [['⌥ Option', '⌘ Cmd', 'R']]);
  assert.equal(s.text, '⌥ Option + ⌘ Cmd + R');
});

test('Windows, Linux and ChromeOS: Ctrl + Shift + R or Ctrl + F5', () => {
  for (const [platform, ua] of [
    ['Win32', UA.windows],
    ['Windows', UA.windows],
    ['Linux x86_64', UA.linux],
    ['Chrome OS', UA.chromeos],
  ] as const) {
    const s = reloadShortcut(platform, ua);
    assert.deepEqual(s.keys, [['Ctrl', 'Shift', 'R'], ['Ctrl', 'F5']], platform);
    assert.equal(s.text, 'Ctrl + Shift + R or Ctrl + F5');
  }
});

test('iOS, iPadOS and Android: no shortcut, close the tab', () => {
  for (const [platform, ua, touch] of [
    ['iPhone', UA.iphone, 5],
    ['Linux armv8l', UA.android, 5],
    ['Android', UA.android, 5],
    // iPadOS sends the macOS platform and user agent; the touch points show the iPad.
    ['MacIntel', UA.macSafari, 5],
  ] as const) {
    const s = reloadShortcut(platform, ua, touch);
    assert.equal(s.keys, null, platform);
    assert.match(s.text, /close the tab/);
  }
});

test('empty platform: the user agent decides', () => {
  assert.deepEqual(reloadShortcut('', UA.macChrome).keys, [['⌘ Cmd', '⇧ Shift', 'R']]);
  assert.deepEqual(reloadShortcut('', UA.windows).keys?.[0], ['Ctrl', 'Shift', 'R']);
});
