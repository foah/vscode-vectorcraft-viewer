// Pure helpers (no `vscode` import) so they can be unit-tested with node:test.

export interface Artboard {
  name: string;
  width: number;
  height: number;
}

/** Reads the artboard list from a .vectorcraft file (documented JSON format). */
export function readArtboards(bytes: Uint8Array): Artboard[] {
  try {
    const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const boards = json?.document?.artboards;
    if (!Array.isArray(boards)) {
      return [];
    }
    return boards.map((b: any, i: number) => ({
      name: typeof b?.name === 'string' && b.name ? b.name : `Artboard ${i + 1}`,
      width: Math.abs(num(b?.rect?.x1) - num(b?.rect?.x0)),
      height: Math.abs(num(b?.rect?.y1) - num(b?.rect?.y0)),
    }));
  } catch {
    return [];
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** `vectorcraft-cli convert` prints one JSON line per result; returns its warnings. */
export function parseWarnings(stdout: string): string[] {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed?.warnings)) {
        return parsed.warnings.map(String);
      }
    } catch {
      // not a JSON line
    }
  }
  return [];
}
