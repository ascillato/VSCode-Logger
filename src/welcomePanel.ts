import * as vscode from 'vscode';

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    possible.charAt(Math.floor(Math.random() * possible.length))
  ).join('');
}

function getWelcomeHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const stylesheet = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'welcomePanel.css'))
    .toString();

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="${stylesheet}" />
        <title>Extension Template</title>
      </head>
      <body>
        <header>
          <h1>VS Code Extension Template</h1>
          <p>Use this webview as a starting point for your own UI.</p>
        </header>
        <main>
          <section>
            <h2>Next steps</h2>
            <ol>
              <li>Replace this content with instructions specific to your extension.</li>
              <li>Update <code>src/welcomePanel.ts</code> to shape the HTML you need.</li>
              <li>Wire messages back to the extension host with <code>vscode.postMessage</code>.</li>
            </ol>
          </section>
          <section>
            <h2>Data from the extension</h2>
            <pre id="payload">Waiting for sample payload…</pre>
          </section>
        </main>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          window.addEventListener("message", (event) => {
            const { payload } = event.data || {};
            const target = document.getElementById("payload");
            if (target) {
              target.textContent = JSON.stringify(payload, null, 2);
            }
          });

          vscode.postMessage({ type: "ready" });
        </script>
      </body>
    </html>
  `;
}

export class WelcomePanel {
  private static instance: WelcomePanel | undefined;

  public static createOrShow(context: vscode.ExtensionContext): void {
    if (WelcomePanel.instance) {
      WelcomePanel.instance.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'extensionTemplateWelcome',
      'Extension Template',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    WelcomePanel.instance = new WelcomePanel(panel, context.extensionUri);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel.webview.html = getWelcomeHtml(this.panel.webview, this.extensionUri);

    this.panel.onDidDispose(() => {
      WelcomePanel.instance = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'ready') {
        this.panel.webview.postMessage({
          payload: {
            message: 'Replace me with data from your extension host!',
            timestamp: new Date().toISOString(),
          },
        });
      }
    });
  }
}

export function getWelcomeMarkupForTesting(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  extensionUri: vscode.Uri
): string {
  return getWelcomeHtml(webview as vscode.Webview, extensionUri);
}
