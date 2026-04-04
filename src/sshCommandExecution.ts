/**
 * Shared helpers for SSH commands and optional uploaded scripts.
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Client } from 'ssh2';

export interface SshCommandExecutionLike {
  name: string;
  command?: string;
  openSshPanel?: boolean;
  rerunOnReconnection?: boolean;
  copyAndRunScript?: boolean;
  script?: string;
}

export interface PreparedSshExecution {
  command?: string;
  script?: string;
  remoteScriptPath?: string;
  remoteCommand: string;
}

export function normalizeStoredCommand(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeStoredScript(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\r\n/g, '\n');
  return normalized.trim().length > 0 ? normalized : undefined;
}

export function sanitizeRunnableCommand(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/\r|\n/.test(trimmed)) {
    throw new Error('SSH command must not contain control characters or new lines.');
  }

  return trimmed;
}

export function buildRemoteExecution(
  command: string | undefined,
  script: string | undefined
): PreparedSshExecution {
  const sanitizedCommand = sanitizeRunnableCommand(command);
  const normalizedScript = normalizeStoredScript(script);

  if (!sanitizedCommand && !normalizedScript) {
    throw new Error('SSH command is empty.');
  }

  if (!normalizedScript) {
    return {
      command: sanitizedCommand,
      remoteCommand: sanitizedCommand ?? '',
    };
  }

  const remoteScriptPath = buildRemoteScriptPath();
  const scriptCommand = `chmod 0777 ${quoteShellArg(remoteScriptPath)} && ${quoteShellArg(remoteScriptPath)}`;
  const remoteCommand = sanitizedCommand
    ? `${sanitizedCommand} && ${scriptCommand}`
    : scriptCommand;

  return {
    command: sanitizedCommand,
    script: normalizedScript,
    remoteScriptPath,
    remoteCommand,
  };
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function uploadScriptToRemote(
  client: Client,
  remoteScriptPath: string,
  script: string
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'embedded-logger-script-'));
  const tempPath = path.join(tempDir, 'command.sh');

  try {
    await fs.writeFile(tempPath, script, 'utf8');
    await new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          reject(err ?? new Error('Failed to open SFTP session.'));
          return;
        }

        sftp.fastPut(tempPath, remoteScriptPath, (uploadError) => {
          sftp.end();
          if (uploadError) {
            reject(uploadError);
            return;
          }
          resolve();
        });
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function buildRemoteScriptPath(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `/tmp/embedded-logger-${timestamp}-${random}.sh`;
}
