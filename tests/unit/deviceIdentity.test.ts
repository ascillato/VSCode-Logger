import { describe, expect, it } from 'vitest';
import { createUniqueDeviceId, ensureUniqueDeviceIds } from '../../src/deviceIdentity';

describe('device identities', () => {
  it.each([
    ['  Lab Device #1  ', 'lab-device-1'],
    ['192.168.1.50', '192-168-1-50'],
    ['***', 'device'],
    ['', 'device'],
  ])('creates a stable identifier from %s', (seed, expected) => {
    expect(createUniqueDeviceId(seed, new Set())).toBe(expected);
  });

  it('skips occupied suffixes without changing the unavailable IDs', () => {
    const occupied = new Set(['device', 'device-2', 'device-3', 'device-5']);
    expect(createUniqueDeviceId('Device', occupied)).toBe('device-4');
    expect([...occupied]).toEqual(['device', 'device-2', 'device-3', 'device-5']);
  });

  it('uses names, then hosts, then list positions when identifiers are missing', () => {
    const devices = [
      { id: 42, name: ' Lab Board ', host: 'first.example' },
      { id: ' ', name: ' ', host: 'second.example' },
      { name: undefined, host: '  third.example  ' },
      { name: null, host: null },
      { name: '', host: '' },
    ];
    expect(ensureUniqueDeviceIds(devices).map((device) => device.id)).toEqual([
      'lab-board',
      'second-example',
      'third-example',
      'device-4',
      'device-5',
    ]);
  });

  it('reserves unique IDs before repairing earlier missing or duplicate IDs', () => {
    const devices = [
      { name: 'Board', host: 'one.example' },
      { id: ' board ', name: 'Keep This ID', host: 'two.example' },
      { id: 'duplicate', host: 'three.example' },
      { id: ' duplicate ', host: 'four.example' },
      { id: 'duplicate-2', host: 'five.example' },
    ];
    const original = structuredClone(devices);
    const result = ensureUniqueDeviceIds(devices);

    expect(result.map((device) => device.id)).toEqual([
      'board-2',
      'board',
      'duplicate',
      'duplicate-3',
      'duplicate-2',
    ]);
    expect(devices).toEqual(original);
    expect(result[0]).not.toBe(devices[0]);
    expect(result[1].name).toBe('Keep This ID');
    expect(ensureUniqueDeviceIds(result)).toEqual(result);
  });

  it('keeps unique custom IDs intact apart from surrounding spaces', () => {
    expect(ensureUniqueDeviceIds([{ id: ' Custom_ID.1 ', name: 'Board' }])).toEqual([
      { id: 'Custom_ID.1', name: 'Board' },
    ]);
    expect(ensureUniqueDeviceIds([])).toEqual([]);
  });
});
