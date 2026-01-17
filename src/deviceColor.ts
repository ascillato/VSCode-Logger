/**
 * Helpers for creating device color icons for tree items and webview tabs.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';

const DEFAULT_ICON_COLOR = new vscode.ThemeColor('tab.activeForeground');
const DEFAULT_ICON = new vscode.ThemeIcon('primitive-square', DEFAULT_ICON_COLOR);

const SQUARE_SVG_TEMPLATE = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
  `<rect x="2" y="2" width="12" height="12" rx="2" fill="${fill}" /></svg>`;

function svgToUri(svg: string): vscode.Uri {
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

/**
 * Returns an icon path for a device color, defaulting to the theme tab title color.
 */
export function getDeviceColorIcon(color?: string): vscode.IconPath {
  const trimmed = color?.trim();
  if (!trimmed) {
    return DEFAULT_ICON;
  }

  const uri = svgToUri(SQUARE_SVG_TEMPLATE(trimmed));
  return { light: uri, dark: uri };
}
