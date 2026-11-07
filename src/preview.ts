import * as vscode from 'vscode';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { CliManager } from './cli';
import { parseWarnings, readArtboards } from './document';
import { appFileName } from './platform';

export const VIEW_TYPE = 'vectorcraftViewer.preview';

export class PreviewProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cli: CliManager,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    new PreviewSession(this.context, this.cli, this.log, document.uri, panel);
  }
}

class PreviewSession {
  private readonly disposables: vscode.Disposable[] = [];
  private artboard = 0;
  private seq = 0;
  private child: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly cli: CliManager,
    private readonly log: vscode.LogOutputChannel,
    private readonly uri: vscode.Uri,
    private readonly panel: vscode.WebviewPanel,
  ) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(media);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg)),
      cli.onDidChange(() => this.schedule(0)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vectorcraftViewer.format') || e.affectsConfiguration('vectorcraftViewer.scale')) {
          this.schedule(0);
        }
      }),
    );

    if (uri.scheme === 'file') {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)),
      );
      watcher.onDidChange(() => this.schedule(250));
      watcher.onDidCreate(() => this.schedule(250));
      this.disposables.push(watcher);
    }

    panel.onDidDispose(() => this.dispose());
  }

  private dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.child?.kill();
    this.disposables.forEach((d) => d.dispose());
  }

  private onMessage(msg: any): void {
    switch (msg?.type) {
      case 'ready':
      case 'refresh':
        this.schedule(0);
        break;
      case 'artboard':
        this.artboard = Number(msg.index) || 0;
        this.schedule(0);
        break;
      case 'download':
        void this.cli.downloadLatest();
        break;
      case 'selectCli':
        void this.cli.selectExisting();
        break;
      case 'openInApp':
        void this.openInApp();
        break;
      case 'openSource':
        void vscode.commands.executeCommand('vscode.openWith', this.uri, 'default');
        break;
    }
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.render(), delayMs);
  }

  private async render(): Promise<void> {
    const seq = ++this.seq;
    this.child?.kill();

    let cli;
    try {
      cli = this.cli.resolve();
    } catch (err: any) {
      this.post({ type: 'error', message: String(err?.message ?? err) });
      return;
    }
    if (!cli) {
      this.post({ type: 'setup', downloading: this.cli.downloading });
      return;
    }

    const config = vscode.workspace.getConfiguration('vectorcraftViewer');
    const format = config.get<string>('format') === 'svg' ? 'svg' : 'png';
    const scale = format === 'png' ? Math.min(8, Math.max(0.25, config.get<number>('scale') ?? 2)) : 1;

    const tag = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const output = path.join(os.tmpdir(), `vectorcraft-viewer-${tag}.${format}`);
    let tempInput: string | undefined;

    this.post({ type: 'loading' });
    const started = Date.now();
    try {
      const bytes = await vscode.workspace.fs.readFile(this.uri);
      const artboards = readArtboards(bytes);
      this.artboard = Math.min(Math.max(0, this.artboard), Math.max(0, artboards.length - 1));

      // The CLI needs a real path: git: and other virtual documents go through a temp copy.
      let input = this.uri.fsPath;
      if (this.uri.scheme !== 'file') {
        tempInput = path.join(os.tmpdir(), `vectorcraft-viewer-${tag}.vectorcraft`);
        await fs.writeFile(tempInput, bytes);
        input = tempInput;
      }

      const args = ['convert', input, output, '--artboard', String(this.artboard)];
      if (format === 'png') {
        args.push('--scale', String(scale));
      }
      this.log.debug(`${cli.path} ${args.join(' ')}`);
      const stdout = await this.run(cli.path, args);
      if (seq !== this.seq) {
        return;
      }

      const data = await fs.readFile(output);
      const mime = format === 'png' ? 'image/png' : 'image/svg+xml';
      this.post({
        type: 'image',
        src: `data:${mime};base64,${data.toString('base64')}`,
        scale,
        format,
        artboards: artboards.map((a) => `${a.name} (${Math.round(a.width)}×${Math.round(a.height)} pt)`),
        index: this.artboard,
        ms: Date.now() - started,
        warnings: parseWarnings(stdout),
      });
    } catch (err: any) {
      if (seq === this.seq) {
        this.log.warn(`Render failed for ${this.uri.toString()}: ${err?.message ?? err}`);
        this.post({ type: 'error', message: String(err?.message ?? err) });
      }
    } finally {
      void fs.rm(output, { force: true });
      if (tempInput) {
        void fs.rm(tempInput, { force: true });
      }
    }
  }

  private run(cli: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.child = execFile(
        cli,
        args,
        { timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || '').trim() || error.message));
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  /** Opens the file in the VectorCraft app beside the CLI, else with the system's default app. */
  private async openInApp(): Promise<void> {
    if (this.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage(vscode.l10n.t('Only a file on disk can be opened in VectorCraft.'));
      return;
    }
    let cliPath: string | undefined;
    try {
      cliPath = this.cli.resolve()?.path;
    } catch {
      // fall back to the system association
    }
    const app = cliPath ? path.join(path.dirname(cliPath), appFileName()) : undefined;
    if (app && existsSync(app)) {
      this.log.info(`Opening ${this.uri.fsPath} with ${app}`);
      spawn(app, [this.uri.fsPath], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (!(await vscode.env.openExternal(this.uri))) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('No VectorCraft app was found to open this file. Install VectorCraft from getartcraft.com.'),
      );
    }
  }

  private post(message: unknown): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }

  private html(media: vscode.Uri): string {
    const t = vscode.l10n.t;
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'preview.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'preview.js'));
    const strings = {
      rendering: t('Rendering…'),
      error: t('Error'),
      imageFailed: t("The rendered image couldn't be displayed."),
      warnings: t('{0} warning(s)'),
      downloading: t('Downloading vectorcraft-cli… Progress is shown in the notification.'),
    };
    const lang = vscode.env.language.split('-')[0];
    return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body data-strings="${esc(JSON.stringify(strings))}">
<div class="toolbar">
  <select id="artboard" title="${esc(t('Artboard'))}" hidden></select>
  <span class="group">
    <button id="zoomOut" title="${esc(t('Zoom out'))}">−</button>
    <span id="zoomLabel">100%</span>
    <button id="zoomIn" title="${esc(t('Zoom in'))}">+</button>
    <button id="fit" title="${esc(t('Fit to window (double-click)'))}">${esc(t('Fit'))}</button>
    <button id="actual" title="${esc(t('Actual size'))}">1:1</button>
  </span>
  <button id="background" title="${esc(t('Change background'))}">${esc(t('Background'))}</button>
  <span class="spacer"></span>
  <span id="status"></span>
  <button id="refresh" title="${esc(t('Render again'))}">↻</button>
  <button id="openSource" title="${esc(t('View the JSON source'))}">JSON</button>
  <button id="openInApp" class="primary">${esc(t('Open in VectorCraft'))}</button>
</div>
<div id="stage" class="bg-checker">
  <img id="image" alt="" draggable="false">
  <div id="message"></div>
  <div id="setup" hidden>
    <h2>${esc(t('vectorcraft-cli is needed'))}</h2>
    <p>${esc(t('VectorCraft Viewer renders files with vectorcraft-cli, the command-line tool of VectorCraft. None was found on this computer.'))}</p>
    <div class="actions">
      <button id="download" class="primary">${esc(t('Download vectorcraft-cli (about 150 MB)'))}</button>
      <button id="selectCli">${esc(t('Use an existing vectorcraft-cli…'))}</button>
    </div>
    <p class="note">${esc(t('The download comes from the official VectorCraft releases on GitHub (github.com/storytold/vectorcraft), its SHA-256 checksum is verified, and it is kept in the extension storage of VS Code.'))}</p>
    <p class="note" id="setupStatus"></p>
  </div>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
