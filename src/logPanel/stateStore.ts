import type * as vscode from 'vscode';
import type { HighlightDefinition } from '../highlights';
import type { FilterPreset } from './types';

export interface StateStore {
  getStoredPresets(): FilterPreset[];
  savePreset(preset: FilterPreset): Promise<FilterPreset[]>;
  deletePreset(name: string): Promise<FilterPreset[]>;
  getStoredHighlights(): HighlightDefinition[];
  saveHighlights(values: HighlightDefinition[]): Promise<HighlightDefinition[]>;
}

export class WorkspaceStateStore implements StateStore {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly presetsKey: string,
    private readonly highlightsKey: string
  ) {}

  getStoredPresets(): FilterPreset[] {
    return this.context.workspaceState.get<FilterPreset[]>(this.presetsKey, []);
  }

  async savePreset(preset: FilterPreset): Promise<FilterPreset[]> {
    const presets = this.getStoredPresets();
    const filtered = presets.filter((p) => p.name !== preset.name);
    filtered.push(preset);
    await this.context.workspaceState.update(this.presetsKey, filtered);
    return filtered;
  }

  async deletePreset(name: string): Promise<FilterPreset[]> {
    const presets = this.getStoredPresets();
    const filtered = presets.filter((p) => p.name !== name);
    await this.context.workspaceState.update(this.presetsKey, filtered);
    return filtered;
  }

  getStoredHighlights(): HighlightDefinition[] {
    return this.context.workspaceState.get<HighlightDefinition[]>(this.highlightsKey, []);
  }

  async saveHighlights(values: HighlightDefinition[]): Promise<HighlightDefinition[]> {
    const sanitized = values
      .filter((highlight) => typeof highlight?.key === 'string')
      .slice(0, 10)
      .map((highlight, index) => ({
        id: highlight.id || index + 1,
        key: highlight.key,
        baseColor: highlight.baseColor,
        color: highlight.color,
        backgroundColor: highlight.backgroundColor,
      }));

    await this.context.workspaceState.update(this.highlightsKey, sanitized);
    return sanitized;
  }
}
