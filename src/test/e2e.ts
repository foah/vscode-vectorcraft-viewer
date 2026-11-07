// End-to-end check, run in CI on Windows, macOS and Linux:
// download the latest vectorcraft-cli for this machine, then render a sample to PNG and SVG.
// Usage: node out/test/e2e.js [sample.vectorcraft]

import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findLatestRelease, installRelease, run } from '../download';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const sample = path.resolve(process.argv[2] ?? path.join(root, 'samples', 'neon-drive.vectorcraft'));
  const work = await mkdtemp(path.join(os.tmpdir(), 'vectorcraft-viewer-e2e-'));
  try {
    const release = await findLatestRelease(process.platform, process.arch);
    console.log(`release ${release.tag}: ${release.archive.name} (${(release.archive.size / 1048576).toFixed(0)} MB)`);

    let lastPercent = -10;
    const cli = await installRelease(release, path.join(work, 'cli'), process.platform, (e) => {
      if (e.stage === 'download') {
        const percent = Math.floor((e.done / e.total) * 100);
        if (percent >= lastPercent + 10) {
          lastPercent = percent;
          console.log(`  download ${percent}%`);
        }
      } else {
        console.log(`  ${e.stage}`);
      }
    });
    console.log(`cli: ${cli.cliPath}`);
    console.log((await run(cli.cliPath, ['--version'], 60_000)).trim());

    const png = path.join(work, 'out.png');
    await run(cli.cliPath, ['convert', sample, png, '--artboard', '0', '--scale', '1'], 120_000);
    const pngBytes = await readFile(png);
    if (pngBytes.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('output is not a PNG');
    console.log(`png: ${pngBytes.readUInt32BE(16)}x${pngBytes.readUInt32BE(20)}, ${pngBytes.length} bytes`);

    const svg = path.join(work, 'out.svg');
    await run(cli.cliPath, ['convert', sample, svg, '--artboard', '0'], 120_000);
    const svgText = await readFile(svg, 'utf8');
    if (!svgText.includes('<svg')) throw new Error('output is not an SVG');
    console.log(`svg: ${svgText.length} chars`);
    console.log('OK');
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
