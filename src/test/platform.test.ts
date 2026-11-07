import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { archiveName, cliFileName, knownInstallPaths, parseChecksums } from '../platform';

test('archive names match the v0.22.0 release assets', () => {
  assert.equal(archiveName('v0.22.0', 'win32', 'x64'), 'vectorcraft-0.22.0-windows-x64-portable.zip');
  assert.equal(archiveName('v0.22.0', 'win32', 'arm64'), 'vectorcraft-0.22.0-windows-arm64-portable.zip');
  assert.equal(archiveName('v0.22.0', 'win32', 'ia32'), 'vectorcraft-0.22.0-windows-x86-portable.zip');
  assert.equal(archiveName('v0.22.0', 'darwin', 'arm64'), 'vectorcraft-cli-0.22.0-macos-universal.zip');
  assert.equal(archiveName('v0.22.0', 'darwin', 'x64'), 'vectorcraft-cli-0.22.0-macos-universal.zip');
  assert.equal(archiveName('v0.22.0', 'linux', 'x64'), 'vectorcraft-0.22.0-linux-x86_64.tar.gz');
  assert.equal(archiveName('v0.22.0', 'linux', 'arm64'), 'vectorcraft-0.22.0-linux-aarch64.tar.gz');
  assert.equal(archiveName('v0.22.0', 'linux', 'riscv64'), 'vectorcraft-0.22.0-linux-riscv64.tar.gz');
  assert.equal(archiveName('v0.22.0', 'freebsd', 'x64'), 'vectorcraft-0.22.0-freebsd-x86_64.tar.gz');
});

test('unsupported platforms have no archive', () => {
  assert.equal(archiveName('v0.22.0', 'linux', 'ia32'), undefined);
  assert.equal(archiveName('v0.22.0', 'aix', 'ppc64'), undefined);
  assert.equal(archiveName('v0.22.0', 'darwin', 'ia32'), undefined);
});

test('cli file name', () => {
  assert.equal(cliFileName('win32'), 'vectorcraft-cli.exe');
  assert.equal(cliFileName('linux'), 'vectorcraft-cli');
});

test('parseChecksums reads text and binary sha256sum lines', () => {
  const a = 'a'.repeat(64);
  const b = 'B'.repeat(64);
  const sums = parseChecksums(`${a}  one.zip\r\n${b} *two.tar.gz\nnot a line\n\n`);
  assert.equal(sums.get('one.zip'), a);
  assert.equal(sums.get('two.tar.gz'), 'b'.repeat(64));
  assert.equal(sums.size, 2);
});

test('known Windows install paths include the ArtCraft launcher location', () => {
  const paths = knownInstallPaths('win32', { ProgramFiles: 'C:\\Program Files' });
  assert.ok(paths.includes('C:\\Program Files\\ArtCraft\\VectorCraft\\vectorcraft-cli.exe'));
});
