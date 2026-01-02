/**
 * Shared types for the log panel host.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import type { EmbeddedDevice } from '../deviceTree';
import type { HighlightDefinition } from '../highlights';

/** Saved filter preset definition. */
export interface FilterPreset {
  name: string;
  minLevel: string;
  textFilter: string;
}

export type RemoteLogTarget = {
  type: 'remote';
  device: EmbeddedDevice;
};

export type LocalLogTarget = {
  type: 'local';
  id: string;
  name: string;
  lines: string[];
  filePath: string;
};

export type LogPanelTarget = RemoteLogTarget | LocalLogTarget;

export interface HighlightUpdate {
  highlights: HighlightDefinition[];
}
