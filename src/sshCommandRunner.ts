/**
 * @file sshCommandRunner.ts
 * @brief Executes one-off SSH commands for configured devices.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';
import { PasswordManager } from './passwordManager';

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
    private readonly passwordManager: PasswordManager;

    constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {
        this.passwordManager = new PasswordManager(this.context);
    }

    async run(command: DeviceCommand): Promise<string> {
        if (!vscode.workspace.isTrusted) {
            throw new Error('Workspace trust is required before connecting to devices.');
        }

        const validationError = this.validateDeviceConfiguration();
        if (validationError) {
            throw new Error(validationError);
        }

        const sanitizedCommand = this.sanitizeCommand(command.command);
        const authentication = await this.getAuthentication();

        return this.executeCommand(sanitizedCommand, authentication);
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

    private async getAuthentication(): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        const privateKeyPath = this.device.privateKeyPath?.trim();
        if (privateKeyPath) {
            const privateKey = await this.loadPrivateKey(privateKeyPath);
            const passphrase = await this.passwordManager.getPassphrase(this.device);
            return { privateKey, passphrase: passphrase || undefined };
        }

        const password = await this.passwordManager.getPassword(this.device);
        if (!password) {
            throw new Error('Password or private key is required to connect to the device.');
        }

        return { password };
    }

    private executeCommand(
        command: string,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();
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
                    ...authentication,
                });
        });
    }

    private async loadPrivateKey(filePath: string): Promise<Buffer> {
        const expanded = this.expandPath(filePath);
        try {
            const content = await fs.readFile(expanded);
            if (!content.length) {
                throw new Error('The private key file is empty.');
            }
            return content;
        } catch (err: any) {
            const reason = err?.message ?? String(err);
            throw new Error(`Failed to read private key from ${expanded}: ${reason}`);
        }
    }

    private expandPath(value: string): string {
        const envExpanded = value.replace(/\$\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
        const tildeExpanded = envExpanded.startsWith('~')
            ? path.join(os.homedir(), envExpanded.slice(1))
            : envExpanded;
        return path.resolve(tildeExpanded);
    }
}
