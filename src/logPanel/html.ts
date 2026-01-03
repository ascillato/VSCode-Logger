/**
 * Builds the HTML scaffold for the log panel Webview.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Creates the HTML document for the log panel, wiring assets with CSP-safe URIs.
 */
export function buildLogPanelHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  targetName: string
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'loggerPanel.js'))
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'media', 'loggerPanel.css'))
  );
  const scriptUriString = scriptUri.toString(true);
  const styleUriString = styleUri.toString(true);
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUriString}" rel="stylesheet" />
    <title>${targetName} Logs</title>
</head>
<body>
    <div class="top-bar">
        <label class="stacked-field">Min Level
            <select id="minLevel">
                <option selected>ALL</option>
                <option>DEBUG</option>
                <option>INFO</option>
                <option>NOTICE</option>
                <option>WARNING</option>
                <option>ERR</option>
                <option>CRIT</option>
                <option>ALERT</option>
                <option>EMERG</option>
            </select>
        </label>
        <label class="stacked-field">Text Filter
            <div class="text-filter-with-presets" id="textFilterContainer">
                <div class="text-filter-input">
                    <input type="text" id="textFilter" placeholder="Filter substring" />
                    <div id="presetDropdown" class="preset-dropdown hidden" role="listbox" aria-label="Filtering Presets"></div>
                </div>
                <button id="presetDropdownButton" class="toolbar-button toolbar-button--icon preset-dropdown__trigger" type="button" title="Filter presets" aria-label="Filter presets" aria-haspopup="listbox" aria-expanded="false" aria-controls="presetDropdown">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M7 10l5 5 5-5z" />
                        </svg>
                    </span>
                    <span class="sr-only">Filter presets</span>
                </button>
            </div>
        </label>
        <div class="toolbar-actions">
            <div class="toolbar-actions__item">
                <button id="savePreset" class="toolbar-button toolbar-button--icon" type="button" title="Save preset" aria-label="Save preset">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M17 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Save preset</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="deletePreset" class="toolbar-button toolbar-button--icon" type="button" title="Delete preset" aria-label="Delete preset">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 5h12l-1 12H7L6 8Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Delete preset</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="exportLogs" class="toolbar-button toolbar-button--icon" type="button" title="Export logs" aria-label="Export logs">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">➜]</span>
                    <span class="sr-only">Export logs</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="editLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="Edit log file" aria-label="Edit log file">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">📝</span>
                    <span class="sr-only">Edit log file</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="refreshLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="Refresh log file" aria-label="Refresh log file">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⟳</span>
                    <span class="sr-only">Refresh log file</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="autoSaveToggle" class="toolbar-button toolbar-button--icon" type="button" title="Start auto-save" aria-label="Start auto-save">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🗄️</span>
                    <span class="sr-only">Start auto-save</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="clearLogs" class="toolbar-button toolbar-button--icon" type="button" title="Clear logs" aria-label="Clear logs">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🧹</span>
                    <span class="sr-only">Clear logs</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="highlightToggle" class="toolbar-button" type="button">Highlight</button>
            </div>
        </div>
        <div class="toggle-actions">
            <div class="toggle-actions__item">
                <button id="wordWrapToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Word wrap" title="Word wrap">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h8v2H4v-2Zm12 0h2v-2h-2v-2h-2v6h4v-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">Word wrap</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoScrollContainer">
                <button id="autoScrollToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Auto-scroll" title="Auto-scroll">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⏭️</span>
                    <span class="sr-only">Auto-scroll</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoReconnectContainer">
                <button id="autoReconnectToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="Auto-reconnect" title="Auto-reconnect">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🔁</span>
                    <span class="sr-only">Auto-reconnect</span>
                </button>
            </div>
        </div>
        <div class="search-bar">
            <label class="stacked-field">Find
                <input type="text" id="searchInput" placeholder="Find in logs (Ctrl/Cmd+F)" />
            </label>
            <button id="searchClear" class="toolbar-button toolbar-button--icon" title="Clear search" aria-label="Clear search">&times;</button>
            <div class="search-controls">
                <button id="searchPrev" class="toolbar-button" title="Previous match">Prev</button>
                <button id="searchNext" class="toolbar-button" title="Next match">Next</button>
                <span id="searchCount">0 / 0</span>
            </div>
        </div>
        <div class="top-bar-spacer"></div>
        <div class="status-area">
            <span id="status"></span>
            <button id="reconnectButton" class="toolbar-button status-action" hidden>Reconnect</button>
        </div>
    </div>
    <div id="highlightPopover" class="highlight-popover hidden" role="dialog" aria-label="Highlight keywords">
        <div class="highlight-header">
            <span class="highlight-title">Highlights</span>
            <div class="highlight-actions">
                <button id="highlightAdd" class="toolbar-button">add</button>
                <button id="highlightClear" class="toolbar-button">remove all</button>
            </div>
        </div>
        <div id="highlightStatus" class="highlight-status"></div>
        <div id="highlightRows" class="highlight-rows"></div>
    </div>
    <div id="highlightBackdrop" class="highlight-backdrop hidden" aria-hidden="true"></div>
    <div id="logContainer">
        <div id="lineLimitNotice" class="line-limit-notice hidden">Configured display line limit reached. Older lines are being replaced with newer entries.</div>
        <div id="logContent"></div>
    </div>
    <script nonce="${nonce}" type="module" src="${scriptUriString}"></script>
</body>
</html>`;
}

/**
 * Produces a random nonce for the Webview CSP.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
