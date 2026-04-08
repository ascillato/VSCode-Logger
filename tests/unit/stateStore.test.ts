import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import { WorkspaceStateStore } from '../../src/logPanel/stateStore';
import { createExtensionContext, resetWorkspaceState, workspaceState } from '../mocks/vscode';

describe('WorkspaceStateStore', () => {
  beforeEach(() => {
    resetWorkspaceState();
  });

  it('returns empty defaults when nothing is stored', () => {
    const store = new WorkspaceStateStore(
      createExtensionContext(),
      'presets-key',
      'highlights-key'
    );

    expect(store.getStoredPresets()).toEqual([]);
    expect(store.getStoredHighlights()).toEqual([]);
  });

  it('replaces presets with the same name and persists the updated list', async () => {
    const store = new WorkspaceStateStore(
      createExtensionContext(),
      'presets-key',
      'highlights-key'
    );

    await store.savePreset({ name: 'Errors', minLevel: 'error', textFilter: 'panic' });
    const presets = await store.savePreset({
      name: 'Errors',
      minLevel: 'warn',
      textFilter: 'kernel',
    });

    expect(presets).toEqual([{ name: 'Errors', minLevel: 'warn', textFilter: 'kernel' }]);
    expect(workspaceState.get('presets-key')).toEqual(presets);
  });

  it('deletes presets by name and persists the remaining list', async () => {
    const store = new WorkspaceStateStore(
      createExtensionContext(),
      'presets-key',
      'highlights-key'
    );

    await store.savePreset({ name: 'Errors', minLevel: 'error', textFilter: 'panic' });
    await store.savePreset({ name: 'Warnings', minLevel: 'warn', textFilter: 'warn' });

    const presets = await store.deletePreset('Errors');

    expect(presets).toEqual([{ name: 'Warnings', minLevel: 'warn', textFilter: 'warn' }]);
    expect(workspaceState.get('presets-key')).toEqual(presets);
  });

  it('sanitizes, limits, and persists highlights', async () => {
    const store = new WorkspaceStateStore(
      createExtensionContext(),
      'presets-key',
      'highlights-key'
    );

    const highlights = await store.saveHighlights([
      {
        id: 99,
        key: 'error',
        baseColor: '#f00',
        color: '#fff',
        backgroundColor: '#000',
      },
      {
        id: 0,
        key: 'warn',
        baseColor: '#ff0',
        color: '#000',
        backgroundColor: '#111',
      },
      {
        id: 2,
        key: 123 as unknown as string,
        baseColor: '#0f0',
        color: '#000',
        backgroundColor: '#fff',
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: 0,
        key: `extra-${index}`,
        baseColor: '#123',
        color: '#456',
        backgroundColor: '#789',
      })),
    ]);

    expect(highlights).toHaveLength(10);
    expect(highlights[0]).toEqual({
      id: 99,
      key: 'error',
      baseColor: '#f00',
      color: '#fff',
      backgroundColor: '#000',
    });
    expect(highlights[1]).toEqual({
      id: 2,
      key: 'warn',
      baseColor: '#ff0',
      color: '#000',
      backgroundColor: '#111',
    });
    expect(highlights.at(-1)).toEqual({
      id: 10,
      key: 'extra-7',
      baseColor: '#123',
      color: '#456',
      backgroundColor: '#789',
    });
    expect(workspaceState.get('highlights-key')).toEqual(highlights);
  });
});
