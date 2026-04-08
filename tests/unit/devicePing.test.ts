import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn<(...args: unknown[]) => EventEmitter>();

vi.mock('child_process', () => ({
  spawn: (...args: Parameters<typeof spawnMock>) => spawnMock(...args),
}));

import { isDetailedPingTooltipIntervalEligible, pingHost } from '../../src/devicePing';

beforeEach(() => {
  spawnMock.mockReset();
});

describe('devicePing', () => {
  it('returns false for empty hosts', async () => {
    await expect(pingHost('   ')).resolves.toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns true when ping exits successfully', async () => {
    spawnMock.mockImplementation(() => {
      const emitter = new EventEmitter();
      queueMicrotask(() => emitter.emit('close', 0));
      return emitter;
    });

    await expect(pingHost('192.168.0.10')).resolves.toBe(true);
  });

  it('returns false when ping fails', async () => {
    spawnMock.mockImplementation(() => {
      const emitter = new EventEmitter();
      queueMicrotask(() => emitter.emit('error', new Error('spawn failed')));
      return emitter;
    });

    await expect(pingHost('device.local')).resolves.toBe(false);
  });

  it('marks blank or long intervals as eligible for detailed tooltips', () => {
    expect(isDetailedPingTooltipIntervalEligible(undefined)).toBe(true);
    expect(isDetailedPingTooltipIntervalEligible(3601)).toBe(true);
  });

  it('keeps short or one-hour intervals on the simple tooltip', () => {
    expect(isDetailedPingTooltipIntervalEligible(3600)).toBe(false);
    expect(isDetailedPingTooltipIntervalEligible(30)).toBe(false);
  });
});
