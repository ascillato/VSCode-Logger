/**
 * Builds the HTML scaffold for the log panel Webview.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

/* eslint-disable spellcheck/spell-checker */

import * as path from 'path';
import * as vscode from 'vscode';
import { escapeHtml, formatLocalizedString, getLocalizedStrings } from '../localization';

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
  const strings = getLocalizedStrings();
  const l = strings.logPanel;
  const e = escapeHtml;
  const panelTitle = formatLocalizedString(l.logsTitle, { name: targetName });

  return `<!DOCTYPE html>
<html lang="${e(strings.htmlLang)}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUriString}" rel="stylesheet" />
    <title>${e(panelTitle)}</title>
</head>
<body>
    <div class="top-bar">
        <label class="stacked-field">${e(l.minLevel)}
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
        <label class="stacked-field">${e(l.textFilter)}
            <div class="text-filter-with-presets" id="textFilterContainer">
                <div class="text-filter-input">
                    <input type="text" id="textFilter" placeholder="${e(l.filterSubstring)}" />
                    <div id="presetDropdown" class="preset-dropdown hidden" role="listbox" aria-label="${e(l.filteringPresets)}"></div>
                </div>
                <button id="presetDropdownButton" class="toolbar-button toolbar-button--icon preset-dropdown__trigger" type="button" title="${e(l.filterPresets)}" aria-label="${e(l.filterPresets)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="presetDropdown">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M7 10l5 5 5-5z" />
                        </svg>
                    </span>
                    <span class="sr-only">${e(l.filterPresets)}</span>
                </button>
            </div>
        </label>
        <div class="toolbar-actions">
            <div class="toolbar-actions__item">
                <button id="savePreset" class="toolbar-button toolbar-button--icon" type="button" title="${e(l.savePreset)}" aria-label="${e(l.savePreset)}">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M17 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V7l-4-4Zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm3-10H5V5h10v4Z" />
                        </svg>
                    </span>
                    <span class="sr-only">${e(l.savePreset)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="deletePreset" class="toolbar-button toolbar-button--icon" type="button" title="${e(l.deletePreset)}" aria-label="${e(l.deletePreset)}">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 5h12l-1 12H7L6 8Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">${e(l.deletePreset)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="exportLogs" class="toolbar-button toolbar-button--icon" type="button" title="${e(l.exportLogs)}" aria-label="${e(l.exportLogs)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">➜]</span>
                    <span class="sr-only">${e(l.exportLogs)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="editLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="${e(l.editLogFile)}" aria-label="${e(l.editLogFile)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">📝</span>
                    <span class="sr-only">${e(l.editLogFile)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="refreshLogFile" class="toolbar-button toolbar-button--icon hidden" type="button" title="${e(l.refreshLogFile)}" aria-label="${e(l.refreshLogFile)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⟳</span>
                    <span class="sr-only">${e(l.refreshLogFile)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="autoSaveToggle" class="toolbar-button toolbar-button--icon" type="button" title="${e(l.startAutoSave)}" aria-label="${e(l.startAutoSave)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🗄️</span>
                    <span class="sr-only">${e(l.startAutoSave)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="clearLogs" class="toolbar-button toolbar-button--icon" type="button" title="${e(l.clearLogs)}" aria-label="${e(l.clearLogs)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🧹</span>
                    <span class="sr-only">${e(l.clearLogs)}</span>
                </button>
            </div>
            <div class="toolbar-actions__item">
                <button id="highlightToggle" class="toolbar-button" type="button">${e(l.highlight)}</button>
            </div>
        </div>
        <div class="toggle-actions">
            <div class="toggle-actions__item">
                <button id="wordWrapToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="${e(l.wordWrap)}" title="${e(l.wordWrap)}">
                    <span class="toolbar-button__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                            <path d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h8v2H4v-2Zm12 0h2v-2h-2v-2h-2v6h4v-2Z" />
                        </svg>
                    </span>
                    <span class="sr-only">${e(l.wordWrap)}</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoScrollContainer">
                <button id="autoScrollToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="${e(l.autoScroll)}" title="${e(l.autoScroll)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">⏭️</span>
                    <span class="sr-only">${e(l.autoScroll)}</span>
                </button>
            </div>
            <div class="toggle-actions__item" id="autoReconnectContainer">
                <button id="autoReconnectToggle" class="toolbar-button toolbar-button--icon toggle-button" type="button" aria-pressed="false" data-label="${e(l.autoReconnect)}" title="${e(l.autoReconnect)}">
                    <span class="toolbar-button__icon" aria-hidden="true" role="img">🔁</span>
                    <span class="sr-only">${e(l.autoReconnect)}</span>
                </button>
            </div>
        </div>
        <div class="search-bar">
            <label class="stacked-field">${e(l.find)}
                <input type="text" id="searchInput" placeholder="${e(l.findInLogs)}" />
            </label>
            <button id="searchClear" class="toolbar-button toolbar-button--icon" title="${e(l.clearSearch)}" aria-label="${e(l.clearSearch)}">&times;</button>
            <div class="search-controls">
                <button id="searchPrev" class="toolbar-button" title="${e(l.previousMatch)}">${e(l.prev)}</button>
                <button id="searchNext" class="toolbar-button" title="${e(l.nextMatch)}">${e(l.next)}</button>
                <span id="searchCount">0 / 0</span>
            </div>
        </div>
        <div class="top-bar-spacer"></div>
        <div class="status-area">
            <span id="status"></span>
            <button id="reconnectButton" class="toolbar-button status-action" hidden>${e(l.reconnect)}</button>
        </div>
    </div>
    <div class="log-area">
        <div id="highlightPopover" class="highlight-popover hidden" role="dialog" aria-label="${e(l.highlightKeywords)}">
            <div class="highlight-header">
                <span class="highlight-title">${e(l.highlights)}</span>
                <div class="highlight-actions">
                    <button id="highlightAdd" class="toolbar-button">${e(l.addHighlight)}</button>
                    <button id="highlightClear" class="toolbar-button">${e(l.removeAllHighlights)}</button>
                </div>
            </div>
            <div id="highlightStatus" class="highlight-status"></div>
            <div id="highlightRows" class="highlight-rows"></div>
        </div>
        <div id="highlightBackdrop" class="highlight-backdrop hidden" aria-hidden="true"></div>
        <div id="logContainer">
            <div id="lineLimitNotice" class="line-limit-notice hidden">${e(l.lineLimitLive)}</div>
            <div id="logContent"></div>
        </div>
    </div>
    <script nonce="${nonce}">window.embeddedLoggerI18n = ${JSON.stringify(strings)};</script>
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
