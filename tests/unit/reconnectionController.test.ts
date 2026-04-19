import { describe, expect, it, vi } from 'vitest';

import type { HostEndpoint } from '../../src/hostEndpoints';
import { HostKeyMismatchError } from '../../src/logSession/errors';
import { ReconnectionController } from '../../src/logSession/reconnectionController';

const endpoints: HostEndpoint[] = [
  { host: 'primary.local', label: 'primary' },
  { host: 'secondary.local', label: 'secondary' },
];

describe('ReconnectionController', () => {
  it('throws when no endpoints are available', async () => {
    const controller = new ReconnectionController({
      endpoints: [],
      maxAttempts: 1,
      isDisposed: () => false,
      connect: vi.fn(),
      onHostKeyMismatch: vi.fn(),
    });

    await expect(controller.connect()).rejects.toThrow('No endpoints available for connection.');
  });

  it('retries the same endpoint when the user updates a mismatched fingerprint', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(
        new HostKeyMismatchError('Mismatch', 'SHA256:old', 'SHA256:new', endpoints[0])
      )
      .mockResolvedValueOnce(undefined);
    const onHostKeyMismatch = vi.fn(async () => true);

    const controller = new ReconnectionController({
      endpoints: [endpoints[0]],
      maxAttempts: 2,
      isDisposed: () => false,
      connect,
      onHostKeyMismatch,
    });

    await controller.connect();

    expect(onHostKeyMismatch).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenNthCalledWith(1, endpoints[0]);
    expect(connect).toHaveBeenNthCalledWith(2, endpoints[0]);
  });

  it('rotates through endpoints and throws the last error when retries are exhausted', async () => {
    const secondaryError = new Error('secondary failed');
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(secondaryError);

    const controller = new ReconnectionController({
      endpoints,
      maxAttempts: 2,
      isDisposed: () => false,
      connect,
      onHostKeyMismatch: vi.fn(async () => false),
    });

    await expect(controller.connect()).rejects.toBe(secondaryError);
    expect(connect).toHaveBeenNthCalledWith(1, endpoints[0]);
    expect(connect).toHaveBeenNthCalledWith(2, endpoints[1]);
  });

  it('stops retrying when disposed and reports a generic failure if no attempt error exists', async () => {
    const controller = new ReconnectionController({
      endpoints,
      maxAttempts: 2,
      isDisposed: () => true,
      connect: vi.fn(),
      onHostKeyMismatch: vi.fn(),
    });

    await expect(controller.connect()).rejects.toThrow('Failed to connect to the device.');
  });
});
