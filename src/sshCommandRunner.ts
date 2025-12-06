/**
 * @file sshCommandRunner.ts
 * @brief Executes one-off SSH commands for configured devices.
 */

import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';

export interface DeviceCommand {
    name: string;
    command: string;
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
        const password = await this.getPassword();
        if (!password) {
            throw new Error('Password is required to connect to the device.');
        }

        return this.executeCommand(sanitizedCommand, password);
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

    private async getPassword(): Promise<string | undefined> {
        const key = `embeddedLogger.password.${this.device.id}`;
        const stored = await this.context.secrets.get(key);
        if (stored) {
            return stored;
        }

        const input = await vscode.window.showInputBox({
            prompt: `Enter SSH password for ${this.device.name}`,
            password: true,
            ignoreFocusOut: true,
        });

        if (input) {
            await this.context.secrets.store(key, input);
        }

        return input;
    }

    private executeCommand(command: string, password: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();
            let stdout = '';
            let stderr = '';

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
                            .stderr.on('data', (data: Buffer) => {
                                stderr += data.toString();
                            })
                            .on('close', () => {
                                client.end();
                                resolve(stdout || stderr);
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
                    password,
                });
        });
    }
}
