import { createHash } from 'crypto';
import * as path from 'path';
import { vi } from 'vitest';
import type * as vscode from 'vscode';

interface StoredSecret {
  key: string;
  value: string;
}

interface MockSecretStorage extends vscode.SecretStorage {
  readonly __data: Map<string, string>;
}

interface MockUri {
  fsPath: string;
  scheme?: string;
  toString: () => string;
}

interface MockWebview {
  html: string;
  options: vscode.WebviewOptions & vscode.WebviewPanelOptions;
  postMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
  onDidReceiveMessage: (listener: (message: unknown) => void) => vscode.Disposable;
  cspSource: string;
}

export interface MockWebviewPanel extends vscode.WebviewPanel {
  webview: MockWebview;
  __fireMessage: (message: unknown) => void;
}

interface MockWebviewView extends vscode.WebviewView {
  webview: MockWebview;
  __fireMessage: (message: unknown) => void;
}

const initialConfigurationState: Record<string, unknown> = {
  devices: [],
};
const configurationState: Record<string, unknown> = {
  ...initialConfigurationState,
};

let trustedWorkspace = true;
let warningMessageResponse: string | undefined;
let inputBoxResponse: string | undefined;
let saveDialogResponse: MockUri | undefined;
let openTextDocumentContent = '';
let clipboardText = '';
const mockFileSystem = new Map<string, Uint8Array>();
const createdWebviews: MockWebviewPanel[] = [];

const createMockWebview = (): MockWebview => {
  const listeners: Array<(message: unknown) => void> = [];
  const webview: MockWebview = {
    html: '',
    options: {} as vscode.WebviewOptions & vscode.WebviewPanelOptions,
    postMessage: vi.fn(async () => true),
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
    cspSource: 'mock-csp',
  };
  (webview as MockWebview & { __fireMessage?: (message: unknown) => void }).__fireMessage = (
    message: unknown
  ) => listeners.forEach((listener) => listener(message));
  return webview;
};

const createMockUri = (value: string, scheme?: string): MockUri =>
  ({
    fsPath: value,
    scheme,
    toString: () => value,
  }) satisfies MockUri;

export const getCreatedWebviews = (): MockWebviewPanel[] => createdWebviews;
export const resetCreatedWebviews = (): void => {
  createdWebviews.length = 0;
};

const createSecretStorage = (): MockSecretStorage => {
  const data = new Map<string, string>();
  return {
    __data: data,
    get(key: string): Promise<string | undefined> {
      return Promise.resolve(data.get(key));
    },
    store(key: string, value: string): Promise<void> {
      data.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      data.delete(key);
      return Promise.resolve();
    },
    onDidChange: () => ({ dispose: () => undefined }),
  } as unknown as MockSecretStorage;
};

const workspaceConfiguration = {
  get: <T>(key: string, defaultValue?: T): T => {
    const value = configurationState[key];
    return (value === undefined ? defaultValue : value) as T;
  },
  update: (key: string, value: unknown): Promise<void> => {
    configurationState[key] = value;
    return Promise.resolve();
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
        fsPath: '/workspace',
        toString: () => 'file:///workspace',
      },
    },
  ] as unknown as vscode.WorkspaceFolder[],
  name: 'mock-workspace',
  getConfiguration: () => workspaceConfiguration as unknown as vscode.WorkspaceConfiguration,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: () => undefined })),
  fs: {
    writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
      mockFileSystem.set((uri as unknown as MockUri).fsPath, content);
    },
    readFile: async (uri: vscode.Uri) => {
      const buffer = mockFileSystem.get((uri as unknown as MockUri).fsPath);
      if (!buffer) {
        throw new Error('File not found');
      }
      return buffer;
    },
  },
  openTextDocument: async (uri: vscode.Uri) =>
    ({
      uri,
      getText: () => openTextDocumentContent,
    }) as unknown as vscode.TextDocument,
} as unknown as typeof vscode.workspace;

export const window: typeof vscode.window = {
  showInputBox: vi.fn(() => Promise.resolve(inputBoxResponse)),
  showWarningMessage: vi.fn(
    (_message: string, _options: vscode.MessageOptions, ...items: string[]) =>
      Promise.resolve(
        warningMessageResponse && items.includes(warningMessageResponse)
          ? warningMessageResponse
          : undefined
      )
  ),
  showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
  showSaveDialog: vi.fn(() => Promise.resolve(saveDialogResponse)),
  createWebviewPanel: vi.fn(
    (
      _viewType,
      _title,
      _showOptions,
      options: vscode.WebviewPanelOptions & vscode.WebviewOptions
    ) => {
      const webview = createMockWebview();
      webview.options = options;
      const disposables: Array<() => void> = [];
      const panel = {
        webview,
        onDidDispose: (listener: () => void) => {
          disposables.push(listener);
          return { dispose: () => undefined };
        },
        dispose: () => disposables.forEach((listener) => listener()),
        reveal: vi.fn(),
      } as unknown as MockWebviewPanel;
      panel.__fireMessage = (message: unknown) =>
        (webview as MockWebview & { __fireMessage?: (message: unknown) => void }).__fireMessage?.(
          message
        );
      createdWebviews.push(panel);
      return panel;
    }
  ),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: () => undefined })),
  showTextDocument: vi.fn(() => Promise.resolve(undefined)),
} as unknown as typeof vscode.window;

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export const env: typeof vscode.env = {
  uiKind: 1,
  openExternal: vi.fn(() => Promise.resolve(true)),
  clipboard: {
    writeText: vi.fn((value: string) => {
      clipboardText = value;
      return Promise.resolve(value);
    }),
    readText: vi.fn(() => Promise.resolve(clipboardText)),
  },
} as unknown as typeof vscode.env;

export const Uri = {
  parse: (value: string) => {
    try {
      const parsed = new URL(value);
      return createMockUri(value, parsed.protocol.replace(/:$/, ''));
    } catch {
      const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):/i);
      return createMockUri(value, schemeMatch?.[1]);
    }
  },
  file: (value: string) => createMockUri(path.normalize(value), 'file'),
  joinPath: (base: vscode.Uri, ...pathSegments: string[]) => {
    const fsPath = (base as unknown as MockUri).fsPath;
    return createMockUri(path.join(fsPath, ...pathSegments), (base as unknown as MockUri).scheme);
  },
};

export const commands: typeof vscode.commands = {
  registerCommand: vi.fn(() => ({ dispose: () => undefined })),
  executeCommand: vi.fn(),
  getCommands: vi.fn(() =>
    Promise.resolve([
      'workbench.action.browser.open',
      'simpleBrowser.show',
      'embeddedLogger.openWebBrowser',
      'embeddedLogger.openEmbeddedWebBrowser',
    ])
  ),
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

export const ThemeColor = class MockThemeColor implements vscode.ThemeColor {
  constructor(public readonly id: string) {}
} as unknown as typeof vscode.ThemeColor;

export const ThemeIcon = class MockThemeIcon implements vscode.ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: vscode.ThemeColor
  ) {}
} as unknown as typeof vscode.ThemeIcon;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const ViewColumn = {
  Active: -1,
  One: 1,
  Two: 2,
  Three: 3,
};

export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
};

export const workspaceState = new Map<string, unknown>();

export const createExtensionContext = (): vscode.ExtensionContext => {
  return {
    extensionPath: '/workspace',
    extensionUri: Uri.file('/workspace') as unknown as vscode.Uri,
    extensionMode: ExtensionMode.Test as unknown as vscode.ExtensionMode,
    subscriptions: [],
    secrets: createSecretStorage(),
    globalState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: (key: string, value: unknown) => Promise.resolve(workspaceState.set(key, value)),
    },
    workspaceState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: (key: string, value: unknown) => Promise.resolve(workspaceState.set(key, value)),
    },
  } as unknown as vscode.ExtensionContext;
};

export const resetWorkspaceConfiguration = (): void => {
  Object.keys(configurationState).forEach((key) => {
    delete configurationState[key];
  });
  Object.assign(configurationState, initialConfigurationState);
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

export const setSaveDialogResponse = (value?: string): void => {
  saveDialogResponse = value ? createMockUri(value) : undefined;
};

export const setOpenTextDocumentContent = (value: string): void => {
  openTextDocumentContent = value;
};

export const resetWindowResponses = (): void => {
  warningMessageResponse = undefined;
  inputBoxResponse = undefined;
  saveDialogResponse = undefined;
  clipboardText = '';
  createdWebviews.length = 0;
  (window.showInputBox as ReturnType<typeof vi.fn>).mockClear();
  (window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();
  (window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showErrorMessage as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showSaveDialog as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showTextDocument as ReturnType<typeof vi.fn>).mockClear?.();
  (window.createWebviewPanel as ReturnType<typeof vi.fn>).mockClear?.();
  (window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mockClear?.();
  (workspace.onDidChangeConfiguration as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.registerCommand as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.getCommands as ReturnType<typeof vi.fn>).mockClear?.();
  (env.openExternal as ReturnType<typeof vi.fn>).mockClear?.();
};

export const getStoredSecrets = (context: vscode.ExtensionContext): StoredSecret[] => {
  const storage = (context.secrets as MockSecretStorage).__data;
  return Array.from(storage.entries()).map(([key, value]) => ({ key, value }));
};

export const computeHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const createWebviewView = (): MockWebviewView => {
  const webview = createMockWebview();
  const disposables: Array<() => void> = [];
  const view = {
    webview,
    onDidDispose: (listener: () => void) => {
      disposables.push(listener);
      return { dispose: () => undefined };
    },
    dispose: () => disposables.forEach((listener) => listener()),
  } as unknown as MockWebviewView;
  view.__fireMessage = (message: unknown) =>
    (webview as MockWebview & { __fireMessage?: (message: unknown) => void }).__fireMessage?.(
      message
    );
  return view;
};

export default {
  workspace,
  window,
  ConfigurationTarget,
  ExtensionMode,
  env,
  Uri,
  commands,
  extensions,
  SecretStorageChangeEvent,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  StatusBarAlignment,
  ViewColumn,
};
