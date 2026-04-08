import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice, EmbeddedDeviceGroup } from '../../src/deviceTree';
import type * as vscode from 'vscode';
import { LogSession } from '../../src/logSession';
import { SshCommandRunner } from '../../src/sshCommandRunner';
import { SidebarViewProvider } from '../../src/sidebarView';
import { createMockClient } from '../mocks/ssh';
import type { DevicePingState } from '../../src/devicePing';
import {
  createExtensionContext,
  createWebviewView,
  resetWorkspaceConfiguration,
} from '../mocks/vscode';

describe('Sidebar integration', () => {
  it('opens devices and runs commands from sidebar messages', async () => {
    resetWorkspaceConfiguration();
    const context = createExtensionContext();
    const device: EmbeddedDevice = {
      id: 'device-1',
      name: 'Integration Device',
      host: 'logs.example.com',
      username: 'root',
      logCommand: 'tail -f /var/log/syslog',
    };

    const logLines: string[] = [];
    const commandOutputs: string[] = [];
    const openInPanelFlags: boolean[] = [];
    const startPromises: Promise<void>[] = [];
    const commandPromises: Promise<void>[] = [];

    const sessionFactory = () =>
      new LogSession(
        device,
        context,
        {
          onLine: (line) => logLines.push(line),
          onStatus: () => undefined,
          onError: () => undefined,
          onClose: () => undefined,
          onHostKeyMismatch: () => undefined,
        },
        {
          createClient: () =>
            createMockClient({
              onExec: (_command, stream) => {
                stream.emitData('primary line\nnext\n');
                stream.emitExit(0, null);
                stream.emitClose();
              },
            }),
        }
      );

    const runnerFactory = () =>
      new SshCommandRunner(device, context, {
        createClient: () =>
          createMockClient({
            onExec: (_command, stream) => {
              stream.emitData('command ok');
              stream.emitExit(0, null);
              stream.emitClose();
            },
          }),
      });

    const sidebar = new SidebarViewProvider(
      context,
      () => [device],
      () => [],
      (deviceId) => {
        if (deviceId !== device.id) {
          return;
        }
        const session = sessionFactory();
        startPromises.push(session.start());
      },
      (deviceId, commandName, command, openSshPanel) => {
        if (deviceId !== device.id) {
          return;
        }
        openInPanelFlags.push(openSshPanel === true);
        const runner = runnerFactory();
        const promise = runner
          .run({ name: commandName, command })
          .then((output) => commandOutputs.push(output.trim()));
        commandPromises.push(promise);
      },
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => false,
      () => new Map()
    );

    const view = createWebviewView();
    sidebar.resolveWebviewView(view as unknown as vscode.WebviewView);

    view.__fireMessage({ type: 'openDevice', deviceId: device.id });
    await Promise.all(startPromises);
    await new Promise((resolve) => setTimeout(resolve, 0));

    view.__fireMessage({
      type: 'runDeviceCommand',
      deviceId: device.id,
      commandName: 'List',
      command: 'ls',
      openSshPanel: true,
    });
    await Promise.all(commandPromises);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logLines).toEqual(['primary line', 'next']);
    expect(commandOutputs).toEqual(['command ok']);
    expect(openInPanelFlags).toEqual([true]);
  });

  it('posts configured groups alongside devices for the sidebar webview', () => {
    resetWorkspaceConfiguration();
    const context = createExtensionContext();
    const device: EmbeddedDevice = {
      id: 'device-1',
      group: 'Lab',
      name: 'Grouped Device',
      host: 'logs.example.com',
      username: 'root',
    };
    const groups: EmbeddedDeviceGroup[] = [{ name: 'Lab' }, { name: 'Field' }];

    const sidebar = new SidebarViewProvider(
      context,
      () => [device],
      () => groups,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => false,
      () => new Map()
    );

    const view = createWebviewView();
    sidebar.resolveWebviewView(view as unknown as vscode.WebviewView);

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: 'initDevices',
      devices: [
        expect.objectContaining({
          id: 'device-1',
          group: 'Lab',
          name: 'Grouped Device',
        }),
      ],
      groups: [{ name: 'Lab' }, { name: 'Field' }],
      isDevicePingEnabled: false,
    });
  });

  it('posts ping tooltip metadata for sidebar status rendering', () => {
    resetWorkspaceConfiguration();
    const context = createExtensionContext();
    const devices: EmbeddedDevice[] = [
      {
        id: 'device-1',
        name: 'Detailed Ping Device',
        host: 'logs.example.com',
        username: 'root',
      },
      {
        id: 'device-2',
        name: 'Simple Ping Device',
        host: 'logs-2.example.com',
        username: 'root',
      },
    ];
    const pingStates = new Map<string, DevicePingState>([
      [
        'device-1',
        {
          status: 'ok',
          completedAt: 1712515200000,
          showDetailedTooltip: true,
        },
      ],
      [
        'device-2',
        {
          status: 'error',
        },
      ],
    ]);

    const sidebar = new SidebarViewProvider(
      context,
      () => devices,
      () => [],
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => true,
      () => pingStates
    );

    const view = createWebviewView();
    sidebar.resolveWebviewView(view as unknown as vscode.WebviewView);

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: 'initDevices',
      devices: [
        expect.objectContaining({
          id: 'device-1',
          pingStatus: 'ok',
          pingCompletedAt: 1712515200000,
          pingShowDetailedTooltip: true,
        }),
        expect.objectContaining({
          id: 'device-2',
          pingStatus: 'error',
          pingCompletedAt: undefined,
          pingShowDetailedTooltip: undefined,
        }),
      ],
      groups: [],
      isDevicePingEnabled: true,
    });
  });
});
