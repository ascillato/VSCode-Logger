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

type EventListener<T> = (event: T) => unknown;

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
let openDialogResponse: MockUri[] | undefined;
let quickPickResponse: unknown;
let openTextDocumentContent = '';
let clipboardText = '';
const mockFileSystem = new Map<string, Uint8Array>();
const createdWebviews: MockWebviewPanel[] = [];
const configurationChangeListeners: Array<(event: vscode.ConfigurationChangeEvent) => void> = [];
const saveTextDocumentListeners: Array<(doc: vscode.TextDocument) => void> = [];
const closeTextDocumentListeners: Array<(doc: vscode.TextDocument) => void> = [];
const closeTerminalListeners: Array<(terminal: vscode.Terminal) => void> = [];

const createMockWebview = (): MockWebview => {
  const listeners: Array<(message: unknown) => void> = [];
  const webview: MockWebview = {
    html: '',
    options: {},
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
  onDidChangeConfiguration: vi.fn((listener: (event: vscode.ConfigurationChangeEvent) => void) => {
    configurationChangeListeners.push(listener);
    return {
      dispose: () => {
        const index = configurationChangeListeners.indexOf(listener);
        if (index >= 0) {
          configurationChangeListeners.splice(index, 1);
        }
      },
    };
  }),
  onDidSaveTextDocument: vi.fn((listener: (doc: vscode.TextDocument) => void) => {
    saveTextDocumentListeners.push(listener);
    return {
      dispose: () => {
        const index = saveTextDocumentListeners.indexOf(listener);
        if (index >= 0) {
          saveTextDocumentListeners.splice(index, 1);
        }
      },
    };
  }),
  onDidCloseTextDocument: vi.fn((listener: (doc: vscode.TextDocument) => void) => {
    closeTextDocumentListeners.push(listener);
    return {
      dispose: () => {
        const index = closeTextDocumentListeners.indexOf(listener);
        if (index >= 0) {
          closeTextDocumentListeners.splice(index, 1);
        }
      },
    };
  }),
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
  showOpenDialog: vi.fn(() => Promise.resolve(openDialogResponse)),
  showQuickPick: vi.fn((items: unknown[]) => Promise.resolve(quickPickResponse ?? items[0])),
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
        onDidChangeViewState: vi.fn((listener: (event: unknown) => void) => {
          void listener;
          return { dispose: () => undefined };
        }),
        active: true,
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
  createTerminal: vi.fn((options?: vscode.TerminalOptions | vscode.ExtensionTerminalOptions) => {
    const name =
      typeof options === 'object' &&
      options &&
      'name' in options &&
      typeof options.name === 'string'
        ? options.name
        : '';
    const terminal = {
      name,
      show: vi.fn(),
      dispose: vi.fn(() => {
        closeTerminalListeners.forEach((listener) => listener(terminal as vscode.Terminal));
      }),
    };
    return terminal;
  }),
  onDidCloseTerminal: vi.fn((listener: (terminal: vscode.Terminal) => void) => {
    closeTerminalListeners.push(listener);
    return {
      dispose: () => {
        const index = closeTerminalListeners.indexOf(listener);
        if (index >= 0) {
          closeTerminalListeners.splice(index, 1);
        }
      },
    };
  }),
  withProgress: vi.fn((_options: unknown, task: () => unknown) => Promise.resolve(task())),
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

export const EventEmitter = class MockEventEmitter<T> implements vscode.EventEmitter<T> {
  private readonly listeners = new Set<EventListener<T>>();

  readonly event: vscode.Event<T> = (listener: EventListener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
} as unknown as typeof vscode.EventEmitter;

export const ThemeColor = class MockThemeColor implements vscode.ThemeColor {
  constructor(public readonly id: string) {}
};

export const ThemeIcon = class MockThemeIcon implements vscode.ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: vscode.ThemeColor
  ) {}
} as unknown as typeof vscode.ThemeIcon;

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const TreeItem = class MockTreeItem implements vscode.TreeItem {
  tooltip?: string | vscode.MarkdownString;
  description?: string | boolean;
  iconPath?: vscode.IconPath;
  command?: vscode.Command;
  contextValue?: string;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {}
} as unknown as typeof vscode.TreeItem;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const ProgressLocation = {
  Notification: 15,
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
  const updateMemento = (key: string, value: unknown): Promise<void> => {
    if (value === undefined) {
      workspaceState.delete(key);
      return Promise.resolve();
    }

    workspaceState.set(key, value);
    return Promise.resolve();
  };

  return {
    extensionPath: '/workspace',
    extensionUri: Uri.file('/workspace') as unknown as vscode.Uri,
    extensionMode: ExtensionMode.Test,
    subscriptions: [],
    secrets: createSecretStorage(),
    globalState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: updateMemento,
    },
    workspaceState: {
      get: (key: string, defaultValue?: unknown) => workspaceState.get(key) ?? defaultValue,
      update: updateMemento,
    },
    extension: {
      packageJSON: {
        version: '1.2.3',
      },
    },
  } as unknown as vscode.ExtensionContext;
};

export const resetWorkspaceConfiguration = (): void => {
  Object.keys(configurationState).forEach((key) => {
    delete configurationState[key];
  });
  Object.assign(configurationState, initialConfigurationState);
};

export const resetWorkspaceState = (): void => {
  workspaceState.clear();
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

export const setOpenDialogResponse = (...values: string[]): void => {
  openDialogResponse = values.length ? values.map((value) => createMockUri(value)) : undefined;
};

export const setQuickPickResponse = (value?: unknown): void => {
  quickPickResponse = value;
};

export const setOpenTextDocumentContent = (value: string): void => {
  openTextDocumentContent = value;
};

export const resetWindowResponses = (): void => {
  warningMessageResponse = undefined;
  inputBoxResponse = undefined;
  saveDialogResponse = undefined;
  openDialogResponse = undefined;
  quickPickResponse = undefined;
  clipboardText = '';
  createdWebviews.length = 0;
  configurationChangeListeners.length = 0;
  closeTerminalListeners.length = 0;
  (window.showInputBox as ReturnType<typeof vi.fn>).mockClear();
  (window.showWarningMessage as ReturnType<typeof vi.fn>).mockClear();
  (window.showInformationMessage as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showErrorMessage as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showSaveDialog as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showOpenDialog as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showQuickPick as ReturnType<typeof vi.fn>).mockClear?.();
  (window.showTextDocument as ReturnType<typeof vi.fn>).mockClear?.();
  (window.createWebviewPanel as ReturnType<typeof vi.fn>).mockClear?.();
  (window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mockClear?.();
  (window.createTerminal as ReturnType<typeof vi.fn>).mockClear?.();
  (window.onDidCloseTerminal as ReturnType<typeof vi.fn>).mockClear?.();
  (window.withProgress as ReturnType<typeof vi.fn>).mockClear?.();
  (workspace.onDidChangeConfiguration as ReturnType<typeof vi.fn>).mockClear?.();
  (workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mockClear?.();
  (workspace.onDidCloseTextDocument as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.registerCommand as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear?.();
  (commands.getCommands as ReturnType<typeof vi.fn>).mockClear?.();
  (env.openExternal as ReturnType<typeof vi.fn>).mockClear?.();
};

export const fireDidChangeConfiguration = (section: string): void => {
  const event = {
    affectsConfiguration: (candidate: string) => candidate === section,
  };
  configurationChangeListeners.forEach((listener) => listener(event));
};

export const fireDidSaveTextDocument = (doc: vscode.TextDocument): void => {
  saveTextDocumentListeners.forEach((listener) => listener(doc));
};

export const fireDidCloseTextDocument = (doc: vscode.TextDocument): void => {
  closeTextDocumentListeners.forEach((listener) => listener(doc));
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
  EventEmitter,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  StatusBarAlignment,
  ProgressLocation,
  ViewColumn,
};
