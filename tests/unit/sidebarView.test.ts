import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { SidebarViewProvider } from '../../src/sidebarView';
import { createExtensionContext, createWebviewView, env, window } from '../mocks/vscode';

const device: EmbeddedDevice = {
  id: 'device-1',
  name: 'Sidebar Device',
  host: 'device.local',
  username: 'root',
};

describe('SidebarViewProvider', () => {
  it('refreshes devices with normalized flags and routes action messages', async () => {
    const onOpenDevice = vi.fn();
    const onRunDeviceCommand = vi.fn();
    const onOpenSshTerminal = vi.fn();
    const onOpenSftpExplorer = vi.fn();
    const onOpenWebBrowser = vi.fn();
    const onOpenEmbeddedWebBrowser = vi.fn();

    const provider = new SidebarViewProvider(
      createExtensionContext(),
      () => [
        {
          ...device,
          enableSshTerminal: 1 as never,
          enableSftpExplorer: undefined,
          enableWebBrowser: true,
          sshCommands: undefined,
        },
      ],
      () => [{ name: 'Lab' }],
      onOpenDevice,
      onRunDeviceCommand,
      onOpenSshTerminal,
      onOpenSftpExplorer,
      onOpenWebBrowser,
      onOpenEmbeddedWebBrowser,
      () => true,
      () =>
        new Map([
          [
            'device-1',
            {
              status: 'ok',
              completedAt: 1000,
              showDetailedTooltip: true,
            },
          ],
        ])
    );

    const view = createWebviewView();
    provider.resolveWebviewView(view as never);
    view.webview.postMessage.mockClear();

    provider.refreshDevices();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: 'devicesUpdated',
      devices: [
        expect.objectContaining({
          id: 'device-1',
          enableSshTerminal: true,
          enableSftpExplorer: false,
          enableWebBrowser: true,
          enableEmbeddedWebBrowser: false,
          sshCommands: [],
          pingStatus: 'ok',
          pingCompletedAt: 1000,
          pingShowDetailedTooltip: true,
        }),
      ],
      groups: [{ name: 'Lab' }],
      isDevicePingEnabled: true,
    });

    view.__fireMessage({ type: 'openDevice', deviceId: 'device-1' });
    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: 'device-1',
      commandName: 'Logs',
      command: 'journalctl -f',
      openSshPanel: true,
      rerunOnReconnection: true,
      copyAndRunScript: true,
      script: '#!/bin/sh\necho hi\n',
    });
    view.__fireMessage({ type: 'openSshTerminal', deviceId: 'device-1' });
    view.__fireMessage({ type: 'openSftpExplorer', deviceId: 'device-1' });
    view.__fireMessage({ type: 'openWebBrowser', deviceId: 'device-1' });
    view.__fireMessage({ type: 'openEmbeddedWebBrowser', deviceId: 'device-1' });

    expect(onOpenDevice).toHaveBeenCalledWith('device-1');
    expect(onRunDeviceCommand).toHaveBeenCalledWith(
      'device-1',
      'Logs',
      'journalctl -f',
      true,
      true,
      true,
      '#!/bin/sh\necho hi\n'
    );
    expect(onOpenSshTerminal).toHaveBeenCalledWith('device-1');
    expect(onOpenSftpExplorer).toHaveBeenCalledWith('device-1');
    expect(onOpenWebBrowser).toHaveBeenCalledWith('device-1');
    expect(onOpenEmbeddedWebBrowser).toHaveBeenCalledWith('device-1');
  });

  it('copies device names and URLs to the clipboard and acknowledges the action', async () => {
    const provider = new SidebarViewProvider(
      createExtensionContext(),
      () => [device],
      () => [],
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => false,
      () => new Map()
    );

    const view = createWebviewView();
    provider.resolveWebviewView(view as never);
    const clipboard = env.clipboard as { writeText: ReturnType<typeof vi.fn> };

    view.__fireMessage({ type: 'copyDeviceName', deviceId: 'device-1', name: 'Sidebar Device' });
    view.__fireMessage({
      type: 'copyDeviceUrl',
      deviceId: 'device-1',
      url: 'http://device.local',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clipboard.writeText).toHaveBeenCalledWith('Sidebar Device');
    expect(clipboard.writeText).toHaveBeenCalledWith('http://device.local');
    expect(window.showInformationMessage).toHaveBeenCalledWith('Device name copied to clipboard.');
    expect(window.showInformationMessage).toHaveBeenCalledWith('Device URL copied to clipboard.');
  });
});
