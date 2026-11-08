import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogService } from '../../src/services/logService';

afterEach(() => {
  vi.useRealTimers();
});

describe('LogService', () => {
  it('returns empty snapshots and disconnected state for an unknown device', () => {
    const logs = new LogService();
    expect(logs.snapshot('unknown')).toEqual([]);
    expect(logs.sources('unknown')).toEqual([]);
    expect(logs.getState('unknown')).toEqual({ state: 'disconnected' });
  });

  it('assigns unique entry IDs across devices and captures the timestamp and source', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const logs = new LogService();
    const first = logs.append('a', 'started');
    const second = logs.append('b', 'INFO ready', 'journal');

    expect(first).toEqual({
      entryId: 'a:1',
      timestamp: '2026-01-02T03:04:05.000Z',
      level: undefined,
      source: 'live',
      message: 'started',
    });
    expect(second).toEqual({
      entryId: 'b:2',
      timestamp: '2026-01-02T03:04:05.000Z',
      level: 'info',
      source: 'journal',
      message: 'INFO ready',
    });
    expect(logs.snapshot('a')).toEqual([first]);
    expect(logs.snapshot('b')).toEqual([second]);
  });

  it.each([
    ['[WARNING] high temperature', 'warn'],
    ['Error: failed', 'error'],
    ['trace output', 'trace'],
    ['critical failure', 'critical'],
    ['information is available', undefined],
    ['debugger started', undefined],
    ['', undefined],
  ])('extracts whole-word levels from %s', (message, level) => {
    const logs = new LogService();
    expect(logs.append('device', message).level).toBe(level);
  });

  it('evicts the oldest entries independently for each device', () => {
    const logs = new LogService(2);
    logs.append('a', 'old', 'archive');
    const otherDevice = logs.append('b', 'retained', 'archive');
    const retained = logs.append('a', 'retained', 'live');
    const latest = logs.append('a', 'latest', 'live');

    expect(logs.snapshot('a')).toEqual([retained, latest]);
    expect(logs.snapshot('b')).toEqual([otherDevice]);
    expect(logs.sources('a')).toEqual(['live']);
    expect(logs.sources('b')).toEqual(['archive']);
  });

  it('lists each source once in order of the retained entries', () => {
    const logs = new LogService();
    logs.append('device', 'one', 'journal');
    logs.append('device', 'two');
    logs.append('device', 'three', 'journal');

    expect(logs.sources('device')).toEqual(['journal', 'live']);
  });

  it('returns a snapshot array that cannot change the retained list', () => {
    const logs = new LogService();
    const entry = logs.append('device', 'original');
    const snapshot = logs.snapshot('device');
    logs.append('device', 'new');

    expect(snapshot).toEqual([entry]);
    (snapshot as (typeof entry)[]).pop();
    expect(logs.snapshot('device').map((item) => item.message)).toEqual(['original', 'new']);
  });

  it('copies state on both write and read and keeps devices independent', () => {
    const logs = new LogService();
    const state = { state: 'error' as const, lastError: 'connection refused' };
    logs.setState('a', state);
    state.lastError = 'changed by caller';
    const snapshot = logs.getState('a');
    expect(snapshot).toEqual({ state: 'error', lastError: 'connection refused' });

    snapshot.state = 'connected';
    snapshot.lastError = 'changed by reader';
    expect(logs.getState('a')).toEqual({ state: 'error', lastError: 'connection refused' });
    expect(logs.getState('b')).toEqual({ state: 'disconnected' });

    logs.setState('a', { state: 'connected' });
    expect(logs.getState('a')).toEqual({ state: 'connected' });
  });
});
