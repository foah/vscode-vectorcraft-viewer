import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';

// Tests run from out/test; sources and translations sit at the package root.
const root = path.resolve(__dirname, '..', '..');

function sourceStrings(): Set<string> {
  const found = new Set<string>();
  const dir = path.join(root, 'src');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(path.join(dir, file), 'utf8');
    // l10n.t('…') / t('…') / t("…") with a literal first argument
    for (const m of text.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      found.add(m[2].replace(/\\(['"\\])/g, '$1'));
    }
  }
  return found;
}

test('every runtime string has a French translation, and none is stale', () => {
  const fr = JSON.parse(readFileSync(path.join(root, 'l10n', 'bundle.l10n.fr.json'), 'utf8'));
  const used = sourceStrings();
  assert.ok(used.size > 20, `only ${used.size} strings found: is the regex broken?`);
  assert.deepEqual([...used].filter((s) => !(s in fr)), [], 'missing in bundle.l10n.fr.json');
  assert.deepEqual(Object.keys(fr).filter((s) => !used.has(s)), [], 'unused in bundle.l10n.fr.json');
});

test('package.nls.fr.json has the same keys as package.nls.json', () => {
  const en = Object.keys(JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))).sort();
  const fr = Object.keys(JSON.parse(readFileSync(path.join(root, 'package.nls.fr.json'), 'utf8'))).sort();
  assert.deepEqual(fr, en);
});

test('every %key% in package.json is defined in package.nls.json', () => {
  const manifest = readFileSync(path.join(root, 'package.json'), 'utf8');
  const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  const keys = [...manifest.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
  assert.deepEqual(keys.filter((k) => !(k in nls)), []);
});
