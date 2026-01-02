import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('../../src/passwordManager', () => ({
  PasswordManager: class {
    getPassword = vi.fn(async () => 'mock-password');
    getPassphrase = vi.fn(async () => undefined);
  },
}));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { LogSession } from '../../src/logSession';
import { ConnectionManager } from '../../src/logSession/connectionManager';
import { HostKeyMismatchError } from '../../src/logSession/errors';
import {
  createExtensionContext,
  resetWorkspaceConfiguration,
  setWarningMessageResponse,
  workspace,
} from '../mocks/vscode';
import { MockSshChannel } from '../mocks/ssh';

const mockFingerprint = (): string => {
  const digest = createHash('sha256').update(Buffer.from('mock-host-key')).digest('base64');
  return `SHA256:${digest}`;
};

const baseDevice: EmbeddedDevice = {
  id: 'device-1',
  name: 'Primary Device',
  host: 'primary.example.com',
  username: 'root',
  secondaryHost: 'backup.example.com',
};

beforeEach(() => {
  resetWorkspaceConfiguration();
  setWarningMessageResponse(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LogSession (unit)', () => {
  it('prompts to update fingerprints on mismatches and retries successfully', async () => {
    const context = createExtensionContext();
    const statuses: string[] = [];
    const lines: string[] = [];
    const onMismatch = vi.fn();
    const device: EmbeddedDevice = {
      ...baseDevice,
      hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    };

    setWarningMessageResponse('Update fingerprint and connect');

    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    const stream = new MockSshChannel();

    connectSpy.mockImplementationOnce(async () => {
      onMismatch({ expected: 'expected-value', received: mockFingerprint() });
      throw new HostKeyMismatchError('Mismatch', 'expected-value', mockFingerprint(), {
        host: device.host,
        label: 'primary',
      });
    });
    connectSpy.mockImplementationOnce(async () => {
      statuses.push('Connected. Streaming logs...');
      setTimeout(() => {
        stream.emitData('line one\n');
        stream.emitClose();
      });
      return {
        client: { end: vi.fn() } as unknown as object,
        stream,
      };
    });

    const session = new LogSession(device, context, {
      onLine: (line) => lines.push(line),
      onStatus: (message) => statuses.push(message),
      onError: (message) => statuses.push(`error:${message}`),
      onClose: () => statuses.push('closed'),
      onHostKeyMismatch: onMismatch,
    });

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const devices = workspace
      .getConfiguration('embeddedLogger')
      .get<EmbeddedDevice[]>('devices', []);
    expect(devices.find((entry) => entry.id === device.id)?.hostFingerprint).toBe(
      mockFingerprint()
    );
    expect(onMismatch).toHaveBeenCalled();
    expect(lines).toEqual(['line one']);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
    expect(statuses).toContain('closed');
  });

  it('falls back to the secondary endpoint when primary fingerprint is rejected', async () => {
    const context = createExtensionContext();
    const statuses: string[] = [];
    const lines: string[] = [];
    const attemptedHosts: string[] = [];
    const onMismatch = vi.fn();
    const device: EmbeddedDevice = {
      ...baseDevice,
      hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      secondaryHostFingerprint: undefined,
    };

    setWarningMessageResponse('Stop connection');

    const connectSpy = vi.spyOn(ConnectionManager.prototype, 'connect');
    const stream = new MockSshChannel();

    connectSpy.mockImplementationOnce(async () => {
      attemptedHosts.push(device.host);
      onMismatch({ expected: 'expected', received: 'received' });
      throw new HostKeyMismatchError('Mismatch', 'expected', 'received', {
        host: device.host,
        label: 'primary',
      });
    });
    connectSpy.mockImplementationOnce(async (request) => {
      attemptedHosts.push(request.endpoint.host);
      setTimeout(() => {
        stream.emitData('secondary ok\n');
        stream.emitClose();
      });
      statuses.push('Connected. Streaming logs...');
      return { client: { end: vi.fn() } as unknown as object, stream };
    });

    const session = new LogSession(device, context, {
      onLine: (line) => lines.push(line),
      onStatus: (message) => statuses.push(message),
      onError: (message) => statuses.push(`error:${message}`),
      onClose: () => statuses.push('closed'),
      onHostKeyMismatch: onMismatch,
    });

    await session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onMismatch).toHaveBeenCalled();
    expect(attemptedHosts).toContain('primary.example.com');
    expect(attemptedHosts).toContain('backup.example.com');
    expect(lines).toEqual(['secondary ok']);
    expect(statuses.some((status) => status.includes('Streaming logs'))).toBe(true);
  });
});
