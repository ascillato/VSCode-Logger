import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { activate, deactivate } from '../../src/extension';
import { LogPanel } from '../../src/logPanel';
import { SftpExplorerPanel } from '../../src/sftpExplorer';
import { SshCommandRunner } from '../../src/sshCommandRunner';
import {
  commands,
  createExtensionContext,
  createWebviewView,
  fireDidChangeConfiguration,
  env,
  getCreatedWebviews,
  resetWorkspaceConfiguration,
  resetWindowResponses,
  setOpenDialogResponse,
  window,
  workspace,
  Uri,
  ExtensionMode,
} from '../mocks/vscode';

type CommandHandler = (...args: unknown[]) => unknown;

const device: EmbeddedDevice = {
  id: 'device-a',
  name: 'Device A',
  host: '10.0.0.10',
  username: 'root',
};

const getHandler = (commandId: string): CommandHandler => {
  const registrations = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
  const registration = registrations.find((call) => call[0] === commandId);
  if (!registration) {
    throw new Error(`${commandId} command was not registered`);
  }
  return registration[1] as CommandHandler;
};

const getRegisteredSidebarProvider = (): { resolveWebviewView(view: unknown): void } => {
  const registrations = (window.registerWebviewViewProvider as ReturnType<typeof vi.fn>).mock.calls;
  const registration = registrations.find((call) => call[0] === 'embeddedLogger.devicesView');
  if (!registration) {
    throw new Error('embeddedLogger.devicesView provider was not registered');
  }
  return registration[1] as { resolveWebviewView(view: unknown): void };
};

const flushAsync = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

afterEach(() => {
  deactivate();
  resetWorkspaceConfiguration();
  resetWindowResponses();
});

describe('web browser commands', () => {
  it('opens the external browser with a normalized device URL', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openWebBrowser');
    (env.openExternal as ReturnType<typeof vi.fn>).mockClear();

    await command(device);

    expect(env.openExternal).toHaveBeenCalledTimes(1);
    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: 'http://10.0.0.10' })
    );
  });

  it('opens the embedded browser with the integrated browser command when available', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openEmbeddedWebBrowser');
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'workbench.action.browser.open',
      'simpleBrowser.show',
    ]);

    await command({ ...device, webBrowserUrl: 'https://device.local' });

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.browser.open',
      'https://device.local'
    );
  });

  it('falls back to the simple browser command when the integrated browser command is unavailable', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openEmbeddedWebBrowser');
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'simpleBrowser.show',
    ]);

    await command(device);

    expect(commands.executeCommand).toHaveBeenCalledWith('simpleBrowser.show', 'http://10.0.0.10');
  });

  it('covers browser error paths and quick-pick selection flows', async () => {
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    await activate(context);

    const openExternal = getHandler('embeddedLogger.openWebBrowser');
    const openEmbedded = getHandler('embeddedLogger.openEmbeddedWebBrowser');

    (env.openExternal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('blocked'));
    await openExternal({ ...device, webBrowserUrl: 'https://device.local/ui' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to open https://device.local/ui: blocked'
    );

    (env.openExternal as ReturnType<typeof vi.fn>).mockClear();
    await openExternal();
    expect(window.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'Device A', description: '10.0.0.10' })],
      { placeHolder: 'Select a device to open in the external web browser' }
    );
    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: 'http://10.0.0.10' })
    );

    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await openEmbedded(device);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'VS Code embedded browser support is unavailable.'
    );
  });

  it('opens a local log file panel and reuses it on subsequent opens', async () => {
    const context = createExtensionContext();
    await activate(context);
    await workspace.fs.writeFile(Uri.file('/tmp/device.log'), Buffer.from('one\ntwo', 'utf8'));
    setOpenDialogResponse('/tmp/device.log');
    const openLocal = getHandler('embeddedLogger.openLocalLogFile');

    const firstOpen = openLocal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const panel = getCreatedWebviews()[0];
    panel.__fireMessage({ type: 'ready' });
    await firstOpen;

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'initialLines',
      lines: ['one', 'two'],
    });

    const panelWithRevealMock = panel as unknown as { reveal: ReturnType<typeof vi.fn> };
    await openLocal();

    expect(panelWithRevealMock.reveal).toHaveBeenCalled();
  });

  it('shows local log file command errors and no-device selection errors', async () => {
    const context = createExtensionContext();
    await activate(context);
    const openLocal = getHandler('embeddedLogger.openLocalLogFile');
    const openWeb = getHandler('embeddedLogger.openWebBrowser');

    setOpenDialogResponse('/tmp/missing.log');
    await openLocal();
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to read log file: File not found');

    resetWorkspaceConfiguration();
    await openWeb();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'No devices configured. Check embeddedLogger.devices.'
    );
  });

  it('opens the SFTP explorer from quick-pick selection', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    await activate(context);
    const openSftp = getHandler('embeddedLogger.openSftpExplorer');

    const openPromise = openSftp();
    await flushAsync();
    const sftpPanel = getCreatedWebviews()[0];
    sftpPanel.__fireMessage({ type: 'requestInit' });
    await openPromise;

    expect(window.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'Device A', description: '10.0.0.10' })],
      { placeHolder: 'Select a device to open the SFTP explorer' }
    );
    expect(sftpPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init', remoteHome: '/' })
    );
  });

  it('routes sidebar actions registered during activation', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    await activate(context);
    const provider = getRegisteredSidebarProvider();
    const view = createWebviewView();

    provider.resolveWebviewView(view);
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    (window.createTerminal as ReturnType<typeof vi.fn>).mockClear();
    (env.openExternal as ReturnType<typeof vi.fn>).mockClear();

    view.__fireMessage({ type: 'openDevice', deviceId: device.id });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'embeddedLogger.openDevice',
      expect.objectContaining({ id: device.id, host: device.host, username: device.username })
    );

    view.__fireMessage({ type: 'openSshTerminal', deviceId: device.id });
    expect(window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Device A SSH', pty: expect.any(Object) })
    );

    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: device.id,
      commandName: 'Inspect',
      command: ' uptime ',
      openSshPanel: true,
      rerunOnReconnection: true,
      copyAndRunScript: true,
      script: '#!/bin/sh\necho ok\n',
    });
    expect(window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Device A SSH: Inspect', pty: expect.any(Object) })
    );

    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: device.id,
      commandName: 'Bad',
      command: 'echo one\necho two',
      openSshPanel: true,
    });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'SSH command must not contain control characters or new lines.'
    );

    const runSpy = vi.spyOn(SshCommandRunner.prototype, 'run').mockResolvedValueOnce('');
    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: device.id,
      commandName: 'Status',
      command: 'uptime',
    });
    await flushAsync();
    expect(window.withProgress).toHaveBeenCalledWith(
      {
        title: 'Running "Status" on Device A',
        location: expect.any(Number),
      },
      expect.any(Function)
    );
    expect(runSpy).toHaveBeenCalledWith({
      name: 'Status',
      command: 'uptime',
      openSshPanel: undefined,
      rerunOnReconnection: undefined,
      copyAndRunScript: undefined,
      script: undefined,
    });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Command "Status" finished on Device A.'
    );

    runSpy.mockRejectedValueOnce(new Error('command failed'));
    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: device.id,
      commandName: 'Failing',
      command: 'false',
    });
    await flushAsync();
    expect(window.showErrorMessage).toHaveBeenCalledWith('command failed');
    runSpy.mockRestore();

    view.__fireMessage({ type: 'openWebBrowser', deviceId: device.id });
    await flushAsync();
    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: 'http://10.0.0.10' })
    );

    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'simpleBrowser.show',
    ]);
    view.__fireMessage({ type: 'openEmbeddedWebBrowser', deviceId: device.id });
    await flushAsync();
    expect(commands.executeCommand).toHaveBeenCalledWith('simpleBrowser.show', 'http://10.0.0.10');

    view.__fireMessage({ type: 'openDevice', deviceId: 'missing' });
    view.__fireMessage({ type: 'runDeviceCommand', deviceId: 'missing', commandName: 'Nope' });
    view.__fireMessage({ type: 'openSshTerminal', deviceId: 'missing' });
    view.__fireMessage({ type: 'openSftpExplorer', deviceId: 'missing' });
    view.__fireMessage({ type: 'openWebBrowser', deviceId: 'missing' });
    view.__fireMessage({ type: 'openEmbeddedWebBrowser', deviceId: 'missing' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Device not found. Check embeddedLogger.devices.'
    );
  });

  it('covers browser validation, trust checks, SFTP start failures, and device panels', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    await activate(context);

    const openWeb = getHandler('embeddedLogger.openWebBrowser');
    const openEmbedded = getHandler('embeddedLogger.openEmbeddedWebBrowser');
    const openSftp = getHandler('embeddedLogger.openSftpExplorer');
    const openDevice = getHandler('embeddedLogger.openDevice');

    await openWeb({ ...device, host: ' ', webBrowserUrl: ' ' });
    expect(window.showErrorMessage).toHaveBeenCalledWith('No host found for the selected device.');

    workspace.isTrusted = false;
    await openWeb(device);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Workspace trust is required before opening device resources.'
    );
    await openEmbedded(device);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Workspace trust is required before opening device resources.'
    );
    workspace.isTrusted = true;

    (commands.executeCommand as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('browser failed')
    );
    await openEmbedded({ ...device, webBrowserUrl: 'https://device.local/ui' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to open https://device.local/ui: browser failed'
    );

    await openSftp({ ...device, username: ' ' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Device "Device A" is missing a username.'
    );
    await openSftp({ ...device, port: 0 });
    expect(window.showErrorMessage).toHaveBeenCalledWith('Device "Device A" has an invalid port.');

    const sftpStartSpy = vi
      .spyOn(SftpExplorerPanel.prototype, 'start')
      .mockRejectedValueOnce(new Error('SFTP failed to start'));
    await openSftp(device);
    expect(window.showErrorMessage).toHaveBeenCalledWith('SFTP failed to start');
    sftpStartSpy.mockRestore();

    const logStartSpy = vi.spyOn(LogPanel.prototype, 'start').mockResolvedValue(undefined);
    await openDevice(undefined);
    expect(window.showErrorMessage).toHaveBeenCalledWith('No device information supplied.');

    await openDevice(device);
    expect(logStartSpy).toHaveBeenCalledTimes(1);
    const remotePanel = getCreatedWebviews()[getCreatedWebviews().length - 1] as unknown as {
      reveal: ReturnType<typeof vi.fn>;
    };

    await openDevice(device);
    expect(remotePanel.reveal).toHaveBeenCalled();
    logStartSpy.mockRestore();
  });

  it('blocks SFTP and SSH terminal actions when production workspace trust is disabled', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = {
      ...createExtensionContext(),
      extensionMode: ExtensionMode.Production,
    };
    workspace.isTrusted = false;
    await activate(context);
    const openSftp = getHandler('embeddedLogger.openSftpExplorer');
    const provider = getRegisteredSidebarProvider();
    const view = createWebviewView();

    await openSftp(device);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Workspace trust is required before connecting to devices.'
    );

    provider.resolveWebviewView(view);
    view.__fireMessage({ type: 'openSshTerminal', deviceId: device.id });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Workspace trust is required before connecting to devices.'
    );
    workspace.isTrusted = true;
  });

  it('refreshes sidebar devices when embedded logger configuration changes', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    await activate(context);
    const provider = getRegisteredSidebarProvider();
    const view = createWebviewView();

    provider.resolveWebviewView(view);
    const postMessage = view.webview.postMessage as unknown as vi.Mock;
    postMessage.mockClear();
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();

    fireDidChangeConfiguration('embeddedLogger');
    await flushAsync();

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'embeddedLogger.devicePingEnabled',
      false
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'devicesUpdated',
        devices: [expect.objectContaining({ id: 'device-a' })],
      })
    );
  });

  it('covers device manager, SFTP command validation, and SFTP test API lifecycle', async () => {
    await workspace.getConfiguration('embeddedLogger').update('enableDevicePing', false);
    await workspace.getConfiguration('embeddedLogger').update('devices', [device]);
    const context = createExtensionContext();
    const api = await activate(context);

    await getHandler('embeddedLogger.editDevicesConfig')();
    expect(getCreatedWebviews()[0].webview.html).toContain('Embedded Device Logger v1.2.3');

    const openSftp = getHandler('embeddedLogger.openSftpExplorer');
    await openSftp({ ...device, host: ' ' });
    expect(window.showErrorMessage).toHaveBeenCalledWith('Device "Device A" is missing a host.');

    const sftpOpen = openSftp(device);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sftpPanel = getCreatedWebviews()[1];
    sftpPanel.__fireMessage({ type: 'requestInit' });
    await sftpOpen;
    expect(sftpPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init', remoteHome: '/' })
    );

    expect(api).toEqual(
      expect.objectContaining({
        openSftpExplorerForTest: expect.any(Function),
        getSftpPanels: expect.any(Function),
      })
    );
    const testApi = api as NonNullable<typeof api>;
    expect(testApi.getSftpPanels().length).toBeGreaterThan(0);

    await getHandler('embeddedLogger.pingAllDevices')();
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'embeddedLogger.devicePingEnabled',
      false
    );
  });
});
