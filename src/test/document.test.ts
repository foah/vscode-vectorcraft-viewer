import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseWarnings, readArtboards } from '../document';

const bytes = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));

test('readArtboards returns names and sizes', () => {
  const boards = readArtboards(
    bytes({
      format: 'vectorcraft',
      document: {
        artboards: [
          { name: 'Cover', rect: { x0: 0, y0: 0, x1: 600, y1: 800 } },
          { name: '', rect: { x0: 760, y0: 10, x1: 1460, y1: 710 } },
        ],
      },
    }),
  );
  assert.deepEqual(boards, [
    { name: 'Cover', width: 600, height: 800 },
    { name: 'Artboard 2', width: 700, height: 700 },
  ]);
});

test('readArtboards tolerates broken or unexpected input', () => {
  assert.deepEqual(readArtboards(bytes('{"broken')), []);
  assert.deepEqual(readArtboards(bytes({ document: {} })), []);
  assert.deepEqual(readArtboards(bytes({ document: { artboards: [{ rect: { x1: 'x' } }] } })), [
    { name: 'Artboard 1', width: 0, height: 0 },
  ]);
});

test('parseWarnings reads the last JSON result line', () => {
  assert.deepEqual(parseWarnings('noise\n{"bytes":1,"warnings":["a","b"]}\n'), ['a', 'b']);
  assert.deepEqual(parseWarnings('{"bytes":1,"warnings":[]}'), []);
  assert.deepEqual(parseWarnings('not json'), []);
});
