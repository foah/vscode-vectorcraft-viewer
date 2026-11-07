// Downloads vectorcraft-cli from VectorCraft's GitHub releases.
// No `vscode` import: also used by the end-to-end test that runs in CI on every OS.

import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import type { IncomingMessage } from 'http';
import * as https from 'https';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { archiveName, cliFileName, parseChecksums, REPO } from './platform';

const USER_AGENT = 'vectorcraft-viewer (VS Code extension)';

export interface Release {
  tag: string;
  archive: { name: string; url: string; size: number };
  sha256: string;
}

export interface InstalledCli {
  version: string;
  cliPath: string;
}

export type ProgressEvent =
  | { stage: 'download'; done: number; total: number }
  | { stage: 'extract' }
  | { stage: 'check' };

export type ProgressFn = (event: ProgressEvent) => void;

export class DownloadError extends Error {}

/** Finds the latest release and the archive + checksum for this platform. */
export async function findLatestRelease(platform: string, arch: string, signal?: AbortSignal): Promise<Release> {
  const json = JSON.parse(await getText(`https://api.github.com/repos/${REPO}/releases/latest`, signal));
  const tag = String(json.tag_name ?? '');
  const name = archiveName(tag, platform, arch);
  if (!name) {
    throw new DownloadError(`VectorCraft publishes no command-line build for ${platform}-${arch}.`);
  }
  const assets: any[] = Array.isArray(json.assets) ? json.assets : [];
  const archive = assets.find((a) => a?.name === name);
  if (!archive) {
    throw new DownloadError(`${name} is missing from VectorCraft ${tag}.`);
  }
  const sums = assets.find((a) => a?.name === 'SHA256SUMS.txt');
  if (!sums) {
    throw new DownloadError(`VectorCraft ${tag} has no SHA256SUMS.txt: download refused.`);
  }
  const sha256 = parseChecksums(await getText(sums.browser_download_url, signal)).get(name);
  if (!sha256) {
    throw new DownloadError(`SHA256SUMS.txt of VectorCraft ${tag} has no entry for ${name}: download refused.`);
  }
  return { tag, archive: { name, url: archive.browser_download_url, size: Number(archive.size) || 0 }, sha256 };
}

/**
 * Downloads the archive, checks its SHA-256, extracts it into `<root>/<tag>` and checks
 * that the CLI runs. Returns the CLI path.
 */
export async function installRelease(
  release: Release,
  root: string,
  platform: string,
  progress: ProgressFn,
  signal?: AbortSignal,
): Promise<InstalledCli> {
  await fs.mkdir(root, { recursive: true });
  const work = path.join(root, `.download-${randomBytes(6).toString('hex')}`);
  await fs.mkdir(work);
  try {
    const archive = path.join(work, release.archive.name);
    const actual = await downloadTo(release.archive.url, archive, release.archive.size, progress, signal);
    if (actual !== release.sha256) {
      throw new DownloadError(`Checksum mismatch for ${release.archive.name}: expected ${release.sha256}, got ${actual}.`);
    }

    progress({ stage: 'extract' });
    const dest = path.join(root, safeName(release.tag));
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    await run(tarCommand(platform), ['-xf', archive, '-C', dest], 10 * 60_000);

    const cliPath = await findFile(dest, cliFileName(platform), 4);
    if (!cliPath) {
      throw new DownloadError(`${cliFileName(platform)} was not found in ${release.archive.name}.`);
    }
    if (platform !== 'win32') {
      await fs.chmod(cliPath, 0o755);
    }
    progress({ stage: 'check' });
    await run(cliPath, ['--version'], 60_000);
    return { version: release.tag, cliPath };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** System tar: bsdtar on Windows 10+ and macOS reads .zip as well as .tar.gz. */
export function tarCommand(platform: string): string {
  if (platform === 'win32') {
    return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  }
  return 'tar';
}

function safeName(tag: string): string {
  return tag.replace(/[^A-Za-z0-9._-]/g, '_') || 'latest';
}

function request(url: string, signal?: AbortSignal, redirects = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          reject(new DownloadError(`Too many redirects for ${url}`));
        } else {
          resolve(request(new URL(res.headers.location, url).toString(), signal, redirects - 1));
        }
        return;
      }
      if (status !== 200) {
        res.resume();
        const hint = status === 403 || status === 429 ? ' (GitHub rate limit? Try again later.)' : '';
        reject(new DownloadError(`HTTP ${status} for ${url}${hint}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await request(url, signal);
  res.setEncoding('utf8');
  let text = '';
  for await (const chunk of res) {
    text += chunk;
  }
  return text;
}

/** Streams `url` to `file` and returns its SHA-256 (hex). */
async function downloadTo(
  url: string,
  file: string,
  expectedSize: number,
  progress: ProgressFn,
  signal?: AbortSignal,
): Promise<string> {
  const res = await request(url, signal);
  const total = Number(res.headers['content-length']) || expectedSize;
  const hash = createHash('sha256');
  let done = 0;
  let reported = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      done += chunk.length;
      if (total && (done - reported >= total / 100 || done === total)) {
        reported = done;
        progress({ stage: 'download', done, total });
      }
      callback(null, chunk);
    },
  });
  await pipeline(res, meter, createWriteStream(file), { signal });
  return hash.digest('hex');
}

async function findFile(dir: string, name: string, depth: number): Promise<string | undefined> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const hit = entries.find((e) => e.isFile() && e.name === name);
  if (hit) {
    return path.join(dir, hit.name);
  }
  if (depth > 0) {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await findFile(path.join(dir, entry.name), name, depth - 1);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
}

export function run(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || '').trim() || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}
