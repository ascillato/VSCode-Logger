import { createHash } from 'crypto';
import { vi } from 'vitest';
import type * as vscode from 'vscode';

interface StoredSecret {
  key: string;
  value: string;
}

interface MockSecretStorage extends vscode.SecretStorage {
  readonly __data: Map<string, string>;
}

const configurationState: Record<string, unknown> = {
  devices: [],
};

let trustedWorkspace = true;
let warningMessageResponse: string | undefined;
let inputBoxResponse: string | undefined;

const createSecretStorage = (): MockSecretStorage => {
  const data = new Map<string, string>();
  return {
    __data: data,
    async get(key: string): Promise<string | undefined> {
      return data.get(key);
    },
    async store(key: string, value: string): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<void> {
      data.delete(key);
    },
    onDidChange: () => ({ dispose: () => undefined }),
  } as unknown as MockSecretStorage;
};

const workspaceConfiguration = {
  get: <T>(key: string, defaultValue?: T): T => {
    const value = configurationState[key];
    return (value === undefined ? defaultValue : value) as T;
  },
  update: async (key: string, value: unknown): Promise<void> => {
    configurationState[key] = value;
  },
  inspect: (key: string): ReturnType<NonNullable<vscode.WorkspaceConfiguration['inspect']>> =>
    ({
      workspaceValue: configurationState[key],
      defaultValue: configurationState[key],
    }) as ReturnType<NonNullable<vscode.WorkspaceConfiguration['inspect']>>,
};

export const workspace: typeof vscode.workspace = {
  get isTrusted() {
    return trustedWorkspace;
  },
  set isTrusted(value: boolean) {
    trustedWorkspace = value;
  },
  workspaceFile: undefined,
  workspaceFolders: [
    {
      uri: {
        toString: () => 'file:///workspace',
      },
    },
  ] as unknown as vscode.WorkspaceFolder[],
  name: 'mock-workspace',
  getConfiguration: () => workspaceConfiguration as unknown as vscode.WorkspaceConfiguration,
} as unknown as typeof vscode.workspace;

export const window: typeof vscode.window = {
  showInputBox: vi.fn(async () => inputBoxResponse),
  showWarningMessage: vi.fn(
    async (_message: string, _options: vscode.MessageOptions, ...items: string[]) => {
      return warningMessageResponse && items.includes(warningMessageResponse)
        ? (warningMessageResponse as typeof items[number])
        : undefined;
    }
  ),
} as unknown as typeof vscode.window;

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export const env: typeof vscode.env = {
  uiKind: 1,
} as unknown as typeof vscode.env;

export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export const commands: typeof vscode.commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
} as unknown as typeof vscode.commands;

export const extensions: typeof vscode.extensions = {
  getExtension: vi.fn(),
  all: [],
} as unknown as typeof vscode.extensions;

export const SecretStorageChangeEvent = class MockSecretStorageChangeEvent
  implements vscode.SecretStorageChangeEvent
{
  key = '';
} as unknown as typeof vscode.SecretStorageChangeEvent;

export const MarkdownString = class MockMarkdownString implements vscode.MarkdownString {
  value = '';
} as unknown as typeof vscode.MarkdownString;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

export const workspaceState = new Map<string, unknown>();

export const createExtensionContext = (): vscode.ExtensionContext =>
  ({
    secrets: createSecretStorage(),
    globalState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: async (key: string, value: unknown) => workspaceState.set(key, value),
    },
    workspaceState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: async (key: string, value: unknown) => workspaceState.set(key, value),
    },
  } as unknown as vscode.ExtensionContext);

export const resetWorkspaceConfiguration = (): void => {
  configurationState.devices = [];
};

export const resetSecrets = (context: vscode.ExtensionContext): void => {
  const storage = (context.secrets as MockSecretStorage).__data;
  storage.clear();
};

export const setInputBoxResponse = (value?: string): void => {
  inputBoxResponse = value;
};

export const setWarningMessageResponse = (value?: string): void => {
  warningMessageResponse = value;
};

export const resetWindowResponses = (): void => {
  warningMessageResponse = undefined;
  inputBoxResponse = undefined;
  (window.showInputBox as ReturnType<typeof vi.fn>).mockClear();
  (window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();
};

export const getStoredSecrets = (context: vscode.ExtensionContext): StoredSecret[] => {
  const storage = (context.secrets as MockSecretStorage).__data;
  return Array.from(storage.entries()).map(([key, value]) => ({ key, value }));
};

export const computeHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export default {
  workspace,
  window,
  ConfigurationTarget,
  env,
  Uri,
  commands,
  extensions,
  SecretStorageChangeEvent,
  MarkdownString,
  StatusBarAlignment,
  ViewColumn,
};
