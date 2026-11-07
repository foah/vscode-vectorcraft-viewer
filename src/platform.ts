// Pure helpers (no `vscode` import) so they can be unit-tested with node:test.

export const REPO = 'storytold/vectorcraft';

export function cliFileName(platform: string = process.platform): string {
  return platform === 'win32' ? 'vectorcraft-cli.exe' : 'vectorcraft-cli';
}

export function appFileName(platform: string = process.platform): string {
  return platform === 'win32' ? 'vectorcraft.exe' : 'vectorcraft';
}

/**
 * Name of the release archive that holds `vectorcraft-cli` for a platform, or
 * undefined when VectorCraft publishes no command-line build for it.
 *
 * Layouts (v0.22.0): Windows `<dir>/vectorcraft-cli.exe` (portable, with the app),
 * macOS `<dir>/vectorcraft-cli` (CLI only), Linux and FreeBSD `<dir>/bin/vectorcraft-cli`.
 */
export function archiveName(version: string, platform: string, arch: string): string | undefined {
  const v = version.replace(/^v/, '');
  switch (platform) {
    case 'win32': {
      const a = ({ x64: 'x64', arm64: 'arm64', ia32: 'x86' } as Record<string, string>)[arch];
      return a ? `vectorcraft-${v}-windows-${a}-portable.zip` : undefined;
    }
    case 'darwin':
      return arch === 'x64' || arch === 'arm64' ? `vectorcraft-cli-${v}-macos-universal.zip` : undefined;
    case 'linux': {
      const a = ({ x64: 'x86_64', arm64: 'aarch64', riscv64: 'riscv64' } as Record<string, string>)[arch];
      return a ? `vectorcraft-${v}-linux-${a}.tar.gz` : undefined;
    }
    case 'freebsd': {
      const a = ({ x64: 'x86_64', arm64: 'aarch64' } as Record<string, string>)[arch];
      return a ? `vectorcraft-${v}-freebsd-${a}.tar.gz` : undefined;
    }
    default:
      return undefined;
  }
}

/** Parses a `sha256sum` listing (`<hex>  <name>` or `<hex> *<name>`) into name → lowercase hash. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) {
      sums.set(match[2], match[1].toLowerCase());
    }
  }
  return sums;
}

/** Places where an installed VectorCraft may keep its CLI, besides PATH. */
export function knownInstallPaths(platform: string, env: Record<string, string | undefined>): string[] {
  const exe = cliFileName(platform);
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Programs`];
    return roots
      .filter((r): r is string => Boolean(r))
      .flatMap((r) => [`${r}\\ArtCraft\\VectorCraft\\${exe}`, `${r}\\VectorCraft\\${exe}`]);
  }
  if (platform === 'darwin') {
    return [`/Applications/VectorCraft.app/Contents/MacOS/${exe}`, `/opt/homebrew/bin/${exe}`, `/usr/local/bin/${exe}`];
  }
  return [];
}
