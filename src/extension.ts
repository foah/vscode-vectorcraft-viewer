import * as vscode from 'vscode';
import { CliManager } from './cli';
import { PreviewProvider, VIEW_TYPE } from './preview';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('VectorCraft Viewer', { log: true });
  const cli = new CliManager(context, log);

  context.subscriptions.push(
    log,
    cli,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new PreviewProvider(context, cli, log), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('vectorcraftViewer.openPreview', (uri?: vscode.Uri) => {
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (target) {
        void vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
      }
    }),
    vscode.commands.registerCommand('vectorcraftViewer.downloadCli', () => cli.downloadLatest()),
    vscode.commands.registerCommand('vectorcraftViewer.selectCli', () => cli.selectExisting()),
    vscode.commands.registerCommand('vectorcraftViewer.showLog', () => log.show()),
  );
}

export function deactivate(): void {}
