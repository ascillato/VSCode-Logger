import type { HighlightDefinition } from '../highlights';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestSavePreset'; minLevel: string; textFilter: string }
  | { type: 'deletePreset'; name: string }
  | { type: 'exportLogs'; lines: string[] }
  | { type: 'highlightsChanged'; highlights: HighlightDefinition[] }
  | { type: 'openSourceFile' }
  | { type: 'refreshSourceFile' }
  | { type: 'requestReconnect' }
  | { type: 'requestDisconnect' }
  | { type: 'startAutoSave' }
  | { type: 'stopAutoSave'; message?: string };

export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const message = raw as Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return { type: 'ready' };
    case 'requestSavePreset':
      if (isValidPresetPayload(message)) {
        return {
          type: 'requestSavePreset',
          minLevel: message.minLevel,
          textFilter: message.textFilter,
        };
      }
      return undefined;
    case 'deletePreset':
      return typeof message.name === 'string' && message.name
        ? { type: 'deletePreset', name: message.name }
        : undefined;
    case 'exportLogs':
      return isStringArray(message.lines)
        ? { type: 'exportLogs', lines: message.lines }
        : undefined;
    case 'highlightsChanged':
      return isValidHighlightPayload(message.highlights)
        ? { type: 'highlightsChanged', highlights: message.highlights }
        : undefined;
    case 'openSourceFile':
      return { type: 'openSourceFile' };
    case 'refreshSourceFile':
      return { type: 'refreshSourceFile' };
    case 'requestReconnect':
      return { type: 'requestReconnect' };
    case 'requestDisconnect':
      return { type: 'requestDisconnect' };
    case 'startAutoSave':
      return { type: 'startAutoSave' };
    case 'stopAutoSave':
      return typeof message.message === 'string'
        ? { type: 'stopAutoSave', message: message.message }
        : { type: 'stopAutoSave' };
    default:
      return undefined;
  }
}

function isValidPresetPayload(
  message: unknown
): message is { minLevel: string; textFilter: string } {
  const candidate = message as { minLevel?: unknown; textFilter?: unknown };
  return typeof candidate?.minLevel === 'string' && typeof candidate?.textFilter === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isValidHighlightPayload(value: unknown): value is HighlightDefinition[] {
  return (
    Array.isArray(value) &&
    value.every((highlight: unknown) => {
      if (!highlight || typeof highlight !== 'object') {
        return false;
      }
      const candidate = highlight as Partial<HighlightDefinition>;
      return (
        typeof candidate.key === 'string' &&
        typeof candidate.baseColor === 'string' &&
        typeof candidate.color === 'string' &&
        typeof candidate.backgroundColor === 'string'
      );
    })
  );
}
