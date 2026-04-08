import { describe, expect, it } from 'vitest';

import { parseWebviewMessage } from '../../src/logPanel/messageParser';

describe('messageParser', () => {
  it('rejects non-object messages', () => {
    expect(parseWebviewMessage(undefined)).toBeUndefined();
    expect(parseWebviewMessage(null)).toBeUndefined();
    expect(parseWebviewMessage('ready')).toBeUndefined();
  });

  it('parses valid save preset requests and rejects invalid payloads', () => {
    expect(
      parseWebviewMessage({
        type: 'requestSavePreset',
        minLevel: 'warn',
        textFilter: 'kernel',
        name: 'Important',
      })
    ).toEqual({
      type: 'requestSavePreset',
      minLevel: 'warn',
      textFilter: 'kernel',
      name: 'Important',
    });

    expect(
      parseWebviewMessage({
        type: 'requestSavePreset',
        minLevel: 'warn',
        textFilter: 'kernel',
        name: '   ',
      })
    ).toBeUndefined();

    expect(
      parseWebviewMessage({
        type: 'requestSavePreset',
        minLevel: 'warn',
        textFilter: 42,
        name: 'Invalid',
      })
    ).toBeUndefined();
  });

  it('validates delete and export message payloads', () => {
    expect(parseWebviewMessage({ type: 'deletePreset', name: 'Noise' })).toEqual({
      type: 'deletePreset',
      name: 'Noise',
    });
    expect(parseWebviewMessage({ type: 'deletePreset', name: '' })).toBeUndefined();

    expect(parseWebviewMessage({ type: 'exportLogs', lines: ['one', 'two'] })).toEqual({
      type: 'exportLogs',
      lines: ['one', 'two'],
    });
    expect(parseWebviewMessage({ type: 'exportLogs', lines: ['one', 2] })).toBeUndefined();
  });

  it('validates highlight payloads strictly', () => {
    expect(
      parseWebviewMessage({
        type: 'highlightsChanged',
        highlights: [
          {
            id: 1,
            key: 'error',
            baseColor: '#f00',
            color: '#fff',
            backgroundColor: '#000',
          },
        ],
      })
    ).toEqual({
      type: 'highlightsChanged',
      highlights: [
        {
          id: 1,
          key: 'error',
          baseColor: '#f00',
          color: '#fff',
          backgroundColor: '#000',
        },
      ],
    });

    expect(
      parseWebviewMessage({
        type: 'highlightsChanged',
        highlights: [
          {
            id: 1,
            key: 'error',
            baseColor: '#f00',
            color: '#fff',
          },
        ],
      })
    ).toBeUndefined();
  });

  it('parses simple control messages and optional auto-save stop messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'openSourceFile' })).toEqual({ type: 'openSourceFile' });
    expect(parseWebviewMessage({ type: 'refreshSourceFile' })).toEqual({
      type: 'refreshSourceFile',
    });
    expect(parseWebviewMessage({ type: 'requestReconnect' })).toEqual({
      type: 'requestReconnect',
    });
    expect(parseWebviewMessage({ type: 'requestDisconnect' })).toEqual({
      type: 'requestDisconnect',
    });
    expect(parseWebviewMessage({ type: 'startAutoSave' })).toEqual({ type: 'startAutoSave' });
    expect(parseWebviewMessage({ type: 'stopAutoSave' })).toEqual({ type: 'stopAutoSave' });
    expect(parseWebviewMessage({ type: 'stopAutoSave', message: 'manual stop' })).toEqual({
      type: 'stopAutoSave',
      message: 'manual stop',
    });
    expect(parseWebviewMessage({ type: 'unknown' })).toBeUndefined();
  });
});
