import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerMessageHandlers } from '../../media/loggerPanel/messaging.js';

describe('logger panel messaging', () => {
  let messageHandler: ((event: { data: unknown }) => void) | null = null;

  beforeEach(() => {
    messageHandler = null;
    globalThis.window = {
      addEventListener: vi.fn((eventName: string, handler: (event: { data: unknown }) => void) => {
        if (eventName === 'message') {
          messageHandler = handler;
        }
      }),
    } as unknown as Window;
  });

  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
  });

  it('routes reconnect errors through the connection-loss handler while connecting', () => {
    const state = { isLiveLog: true, connectionState: 'connecting' };
    const setSecondaryStatus = vi.fn();
    const updateStatus = vi.fn();
    const handleConnectionLoss = vi.fn();

    registerMessageHandlers({
      state,
      elements: {},
      handlers: {
        setSecondaryStatus,
        updateStatus,
        handleConnectionLoss,
      },
      setToggleState: vi.fn(),
      isDefaultLogCommandMessage: vi.fn(() => false),
    });

    if (!messageHandler) {
      throw new Error('Message handler was not registered.');
    }

    messageHandler({ data: { type: 'error', message: 'Handshake timeout' } });

    expect(handleConnectionLoss).toHaveBeenCalledWith('Handshake timeout');
    expect(updateStatus).not.toHaveBeenCalled();
    expect(setSecondaryStatus).not.toHaveBeenCalled();
  });
});
