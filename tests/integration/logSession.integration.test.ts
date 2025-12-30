import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { LogSession } from '../../src/logSession';
import { createExtensionContext, resetWorkspaceConfiguration, workspace } from '../mocks/vscode';
import { createMockClient } from '../mocks/ssh';
import type { MockSshChannel } from '../mocks/ssh';

describe('LogSession (integration)', () => {
  it('streams log lines and captures host fingerprints', async () => {
    resetWorkspaceConfiguration();
    const context = createExtensionContext();
    const device: EmbeddedDevice = {
      id: 'log-device',
      name: 'Log Device',
      host: 'logs.example.com',
      username: 'root',
      logCommand: 'journalctl -f',
    };

    const lines: string[] = [];
    const statuses: string[] = [];
    let closed = 0;
    const client = createMockClient({
      onExec: (_command, stream: MockSshChannel) => {
        stream.emitData('first line\nsecond line\npartial');
        stream.emitExit(0, null);
        stream.emitClose();
      },
    });

    const session = new LogSession(
      device,
      context,
      {
        onLine: (line): void => {
          lines.push(line);
        },
        onError: (msg): void => {
          statuses.push(`error:${msg}`);
        },
        onStatus: (msg): void => {
          statuses.push(msg);
        },
        onClose: (): void => {
          closed += 1;
        },
      },
      {
        createClient: () => client,
      }
    );

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toEqual(['first line', 'second line']);
    expect(closed).toBe(1);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
    const configuration = workspace.getConfiguration('embeddedLogger');
    const devices = configuration.get<EmbeddedDevice[]>('devices', []);
    expect(devices.find((entry) => entry.id === device.id)?.hostFingerprint).toBeDefined();
  });
});
