/**
 * Device ping helpers.
 *
 * @packageDocumentation
 */

import { spawn } from 'child_process';

export type DevicePingStatus = 'pending' | 'ok' | 'error';

export interface DevicePingState {
  status: DevicePingStatus;
  completedAt?: number;
  showDetailedTooltip?: boolean;
}

export function isDetailedPingTooltipIntervalEligible(
  intervalSeconds: number | undefined
): boolean {
  return intervalSeconds === undefined || intervalSeconds > 3600;
}

function getPingCommand(host: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'ping',
      args: ['-n', '1', '-w', '1000', host],
    };
  }

  return {
    command: 'ping',
    args: ['-c', '1', '-W', '1', host],
  };
}

export async function pingHost(host: string): Promise<boolean> {
  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return false;
  }

  const { command, args } = getPingCommand(trimmedHost);

  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    let settled = false;

    const done = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.once('error', () => done(false));
    child.once('close', (code) => done(code === 0));
  });
}
