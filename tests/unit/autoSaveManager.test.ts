import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockWriteStream extends EventEmitter {
  closed = false;
  readonly writes: string[] = [];
  end = vi.fn(() => {
    this.closed = true;
    this.emit('close');
    return this;
  });
  write = vi.fn((value: string) => {
    this.writes.push(value);
    return true;
  });
}

const { createWriteStreamMock } = vi.hoisted(() => ({
  createWriteStreamMock: vi.fn(),
}));

vi.mock('fs', () => ({
  createWriteStream: createWriteStreamMock,
}));

import { AutoSaveManager } from '../../src/logPanel/autoSaveManager';

describe('AutoSaveManager', () => {
  beforeEach(() => {
    createWriteStreamMock.mockReset();
  });

  it('starts auto-save streams and exposes active path metadata', async () => {
    const stream = new MockWriteStream();
    createWriteStreamMock.mockReturnValue(stream);
    const manager = new AutoSaveManager();

    await manager.start('/tmp/session.log', vi.fn(), vi.fn());

    expect(createWriteStreamMock).toHaveBeenCalledWith('/tmp/session.log', { flags: 'a' });
    expect(manager.isActive).toBe(true);
    expect(manager.activePath).toBe('/tmp/session.log');
    expect(manager.activeFileName).toBe('session.log');
  });

  it('stops the previous stream before starting a new one', async () => {
    const first = new MockWriteStream();
    const second = new MockWriteStream();
    createWriteStreamMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const manager = new AutoSaveManager();

    await manager.start('/tmp/one.log', vi.fn(), vi.fn());
    await manager.start('/tmp/two.log', vi.fn(), vi.fn());

    expect(first.end).toHaveBeenCalledOnce();
    expect(manager.activePath).toBe('/tmp/two.log');
    expect(manager.activeFileName).toBe('two.log');
  });

  it('reports stream errors, stops auto-save, and triggers the stop callback', async () => {
    const stream = new MockWriteStream();
    createWriteStreamMock.mockReturnValue(stream);
    const manager = new AutoSaveManager();
    const onError = vi.fn();
    const onStop = vi.fn();

    await manager.start('/tmp/error.log', onError, onStop);
    stream.emit('error', new Error('disk full'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledWith('Auto-save failed: disk full');
    expect(onStop).toHaveBeenCalledOnce();
    expect(manager.isActive).toBe(false);
    expect(manager.activePath).toBeUndefined();
  });

  it('writes lines with trailing newlines and handles synchronous write failures', async () => {
    const stream = new MockWriteStream();
    createWriteStreamMock.mockReturnValue(stream);
    const manager = new AutoSaveManager();
    const onError = vi.fn();
    const onStop = vi.fn();

    await manager.start('/tmp/write.log', vi.fn(), vi.fn());
    manager.writeLine('first line', onError, onStop);

    expect(stream.write).toHaveBeenCalledWith('first line\n');

    stream.write.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    manager.writeLine('second line', onError, onStop);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledWith('Auto-save failed: permission denied');
    expect(onStop).toHaveBeenCalledOnce();
    expect(manager.isActive).toBe(false);
  });

  it('returns whether a visible stop notification should be sent', async () => {
    const manager = new AutoSaveManager();
    const stream = new MockWriteStream();
    createWriteStreamMock.mockReturnValue(stream);

    await manager.start('/tmp/visible.log', vi.fn(), vi.fn());

    await expect(manager.stop()).resolves.toBe(true);
    await expect(manager.stop({ silent: true })).resolves.toBe(false);
  });
});
