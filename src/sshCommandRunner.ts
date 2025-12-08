/**
 * @file sshCommandRunner.ts
 * @brief Executes one-off SSH commands for configured devices.
 */

import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';
import { resolveSshAuthentication, SshAuthentication } from './sshAuthentication';

export interface DeviceCommand {
    name: string;
    command: string;
}

export class SshCommandError extends Error {
    constructor(
        message: string,
        public readonly exitCode: number | null,
        public readonly signal: string | null,
        public readonly stdout: string,
        public readonly stderr: string
    ) {
        super(message);
        this.name = 'SshCommandError';
    }
}

export class SshCommandRunner {
    constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {}

    async run(command: DeviceCommand): Promise<string> {
        if (!vscode.workspace.isTrusted) {
            throw new Error('Workspace trust is required before connecting to devices.');
        }

        const validationError = this.validateDeviceConfiguration();
        if (validationError) {
            throw new Error(validationError);
        }

        const sanitizedCommand = this.sanitizeCommand(command.command);
        const auth = await resolveSshAuthentication(this.device, this.context);

        return this.executeCommand(sanitizedCommand, auth);
    }

    private validateDeviceConfiguration(): string | undefined {
        const host = this.device.host?.trim();
        const username = this.device.username?.trim();
        if (!host) {
            return `Device "${this.device.name}" is missing a host.`;
        }
        if (!username) {
            return `Device "${this.device.name}" is missing a username.`;
        }
        if (this.device.port !== undefined && (!Number.isInteger(this.device.port) || this.device.port <= 0)) {
            return `Device "${this.device.name}" has an invalid port.`;
        }
        return undefined;
    }

    private sanitizeCommand(command: string): string {
        const trimmed = command.trim();
        if (/\r|\n/.test(trimmed)) {
            throw new Error('SSH command must not contain control characters or new lines.');
        }
        if (!trimmed) {
            throw new Error('SSH command is empty.');
        }
        return trimmed;
    }

    private executeCommand(command: string, auth: SshAuthentication): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();
            const authOptions =
                auth.type === 'password'
                    ? { password: auth.password }
                    : { privateKey: auth.privateKey, passphrase: auth.passphrase };
            let stdout = '';
            let stderr = '';
            let exitCode: number | null = null;
            let exitSignal: string | null = null;

            client
                .on('ready', () => {
                    client.exec(command, (err, stream) => {
                        if (err) {
                            reject(err);
                            client.end();
                            return;
                        }

                        stream
                            .on('data', (data: Buffer) => {
                                stdout += data.toString();
                            })
                            .on('exit', (code: number | null, signal: string | null) => {
                                exitCode = code;
                                exitSignal = signal;
                            })
                            .on('close', () => {
                                client.end();
                                const terminatedBySignal = !!exitSignal;
                                const hasErrorCode = exitCode !== null && exitCode !== 0;
                                if (terminatedBySignal || hasErrorCode) {
                                    const output = [stderr, stdout].filter(Boolean).join('\n').trim();
                                    const reason = terminatedBySignal
                                        ? `signal ${exitSignal}`
                                        : `exit code ${exitCode}`;
                                    const message = output
                                        ? `Command "${command}" failed on ${this.device.name} (${reason}). Output:\n${output}`
                                        : `Command "${command}" failed on ${this.device.name} (${reason}).`;
                                    reject(
                                        new SshCommandError(message, exitCode, exitSignal, stdout, stderr)
                                    );
                                    return;
                                }

                                const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
                                resolve(combinedOutput);
                            });

                        stream.stderr.on('data', (data: Buffer) => {
                            stderr += data.toString();
                        });
                    });
                })
                .on('error', (err) => {
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    client.end();
                })
                .connect({
                    host,
                    port,
                    username,
                    ...authOptions,
                });
        });
    }
}
