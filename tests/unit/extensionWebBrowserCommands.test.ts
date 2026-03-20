import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../mocks/vscode'));

import type { EmbeddedDevice } from '../../src/deviceTree';
import { activate } from '../../src/extension';
import {
  commands,
  createExtensionContext,
  env,
  resetWorkspaceConfiguration,
  resetWindowResponses,
} from '../mocks/vscode';

type CommandHandler = (...args: unknown[]) => unknown;

const device: EmbeddedDevice = {
  id: 'device-a',
  name: 'Device A',
  host: '10.0.0.10',
  username: 'root',
};

const getHandler = (commandId: string): CommandHandler => {
  const registrations = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
  const registration = registrations.find((call) => call[0] === commandId);
  if (!registration) {
    throw new Error(`${commandId} command was not registered`);
  }
  return registration[1] as CommandHandler;
};

afterEach(() => {
  resetWorkspaceConfiguration();
  resetWindowResponses();
});

describe('web browser commands', () => {
  it('opens the external browser with a normalized device URL', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openWebBrowser');
    (env.openExternal as ReturnType<typeof vi.fn>).mockClear();

    await command(device);

    expect(env.openExternal).toHaveBeenCalledTimes(1);
    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: 'http://10.0.0.10' })
    );
  });

  it('opens the embedded browser with the integrated browser command when available', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openEmbeddedWebBrowser');
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'workbench.action.browser.open',
      'simpleBrowser.show',
    ]);

    await command({ ...device, webBrowserUrl: 'https://device.local' });

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.browser.open',
      'https://device.local'
    );
  });

  it('falls back to the simple browser command when the integrated browser command is unavailable', async () => {
    const context = createExtensionContext();
    await activate(context);

    const command = getHandler('embeddedLogger.openEmbeddedWebBrowser');
    (commands.executeCommand as ReturnType<typeof vi.fn>).mockClear();
    (commands.getCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'simpleBrowser.show',
    ]);

    await command(device);

    expect(commands.executeCommand).toHaveBeenCalledWith('simpleBrowser.show', 'http://10.0.0.10');
  });
});
