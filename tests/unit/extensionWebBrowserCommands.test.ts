import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { activate, deactivate } from '../../src/extension';
import {
  commands,
  createExtensionContext,
  env,
  getCreatedWebviews,
  resetWorkspaceConfiguration,
  resetWindowResponses,
  setOpenDialogResponse,
  window,
  workspace,
  Uri,
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
