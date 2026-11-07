import * as vscode from 'vscode';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DownloadError, findLatestRelease, installRelease, type InstalledCli } from './download';
import { cliFileName, knownInstallPaths } from './platform';

export type CliSource = 'setting' | 'downloaded' | 'installed';

export interface Cli {
  path: string;
  source: CliSource;
}

const STATE_KEY = 'downloadedCli';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Finds vectorcraft-cli and downloads it on request. */
export class CliManager implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the CLI in use may have changed, or a download starts or ends. */
  readonly onDidChange = this.changed.event;
  private download: Promise<void> | undefined;
  private readonly configListener: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vectorcraftViewer.cliPath')) {
        this.changed.fire();
      }
    });
  }

  dispose(): void {
    this.configListener.dispose();
    this.changed.dispose();
  }

  get downloading(): boolean {
    return this.download !== undefined;
  }

  private get root(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'cli');
  }

  /**
   * The CLI to use: the `cliPath` setting (machine scope, so a workspace can't set it),
   * then the copy this extension downloaded, then an installed VectorCraft.
   * Returns undefined when none is found; throws when the setting points nowhere.
   */
  resolve(): Cli | undefined {
    const configured = vscode.workspace.getConfiguration('vectorcraftViewer').get<string>('cliPath')?.trim();
    if (configured) {
      if (!isFile(configured)) {
        throw new Error(
          vscode.l10n.t('The vectorcraftViewer.cliPath setting points to a missing file: {0}', configured),
        );
      }
      return { path: configured, source: 'setting' };
    }

    const downloaded = this.context.globalState.get<InstalledCli>(STATE_KEY);
    if (downloaded && isFile(downloaded.cliPath)) {
      return { path: downloaded.cliPath, source: 'downloaded' };
    }

    const exe = cliFileName();
    const onPath = (process.env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, exe));
    for (const candidate of [...onPath, ...knownInstallPaths(process.platform, process.env)]) {
      if (isFile(candidate)) {
        return { path: candidate, source: 'installed' };
      }
    }
    return undefined;
  }

  /** Downloads (or updates) vectorcraft-cli. Concurrent calls share one download. */
  downloadLatest(): Promise<void> {
    if (!this.download) {
      this.download = this.runDownload().finally(() => {
        this.download = undefined;
        this.changed.fire();
      });
      this.changed.fire();
    }
    return this.download;
  }

  private async runDownload(): Promise<void> {
    const controller = new AbortController();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('VectorCraft Viewer'),
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => controller.abort());
          progress.report({ message: vscode.l10n.t('Looking for the latest VectorCraft release…') });
          const release = await findLatestRelease(process.platform, process.arch, controller.signal);

          const previous = this.context.globalState.get<InstalledCli>(STATE_KEY);
          if (previous?.version === release.tag && isFile(previous.cliPath)) {
            void vscode.window.showInformationMessage(
              vscode.l10n.t('vectorcraft-cli {0} is already the latest version.', release.tag),
            );
            return;
          }

          this.log.info(`Downloading ${release.archive.name} (${release.tag}) from ${release.archive.url}`);
          let last = 0;
          const installed = await installRelease(
            release,
            this.root,
            process.platform,
            (event) => {
              if (event.stage === 'download') {
                const percent = Math.floor((event.done / event.total) * 100);
                progress.report({
                  message: vscode.l10n.t(
                    'Downloading VectorCraft {0}: {1} / {2} MB',
                    release.tag,
                    (event.done / 1048576).toFixed(0),
                    (event.total / 1048576).toFixed(0),
                  ),
                  increment: percent - last,
                });
                last = percent;
              } else if (event.stage === 'extract') {
                progress.report({ message: vscode.l10n.t('Extracting…') });
              } else {
                progress.report({ message: vscode.l10n.t('Checking vectorcraft-cli…') });
              }
            },
            controller.signal,
          );

          await this.carryOverPortableData(previous, installed);
          await this.context.globalState.update(STATE_KEY, installed);
          this.log.info(`Installed vectorcraft-cli ${installed.version} at ${installed.cliPath}`);
          await this.removeOtherVersions(installed);
          void vscode.window.showInformationMessage(
            vscode.l10n.t('vectorcraft-cli {0} is installed.', installed.version),
          );
        },
      );
    } catch (err: any) {
      if (controller.signal.aborted) {
        this.log.info('Download cancelled');
        return;
      }
      this.log.error(`Download failed: ${err?.stack ?? err}`);
      const detail = err instanceof DownloadError ? err.message : String(err?.message ?? err);
      const showLog = vscode.l10n.t('Show Log');
      const choice = await vscode.window.showErrorMessage(
        vscode.l10n.t('Could not download vectorcraft-cli: {0}', detail),
        showLog,
      );
      if (choice === showLog) {
        this.log.show();
      }
    }
  }

  /** Windows portable builds keep their settings in VectorCraftData beside the exe. */
  private async carryOverPortableData(previous: InstalledCli | undefined, next: InstalledCli): Promise<void> {
    if (!previous) {
      return;
    }
    const from = path.join(path.dirname(previous.cliPath), 'VectorCraftData');
    const to = path.join(path.dirname(next.cliPath), 'VectorCraftData');
    if (existsSync(from) && !existsSync(to)) {
      await fs.rename(from, to).catch((e) => this.log.warn(`Could not move VectorCraftData: ${e}`));
    }
  }

  private async removeOtherVersions(keep: InstalledCli): Promise<void> {
    const keepDir = path.relative(this.root, keep.cliPath).split(/[\\/]/)[0];
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== keepDir) {
        // May fail while an old VectorCraft is still running; it is retried on the next update.
        await fs
          .rm(path.join(this.root, entry.name), { recursive: true, force: true })
          .catch((e) => this.log.warn(`Could not remove ${entry.name}: ${e}`));
      }
    }
  }

  /** Lets the user pick an existing vectorcraft-cli and saves it in the user settings. */
  async selectExisting(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: vscode.l10n.t('Use this vectorcraft-cli'),
      title: vscode.l10n.t('Select vectorcraft-cli'),
      filters: process.platform === 'win32' ? { [vscode.l10n.t('Programs')]: ['exe'] } : undefined,
    });
    const file = picked?.[0]?.fsPath;
    if (!file) {
      return;
    }
    if (!path.basename(file).toLowerCase().startsWith('vectorcraft-cli')) {
      const useAnyway = vscode.l10n.t('Use Anyway');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('{0} does not look like vectorcraft-cli.', path.basename(file)),
        { modal: true },
        useAnyway,
      );
      if (choice !== useAnyway) {
        return;
      }
    }
    await vscode.workspace
      .getConfiguration('vectorcraftViewer')
      .update('cliPath', file, vscode.ConfigurationTarget.Global);
  }
}
