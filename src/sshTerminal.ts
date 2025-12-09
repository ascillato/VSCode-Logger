/**
 * @file sshTerminal.ts
 * @brief Provides a pseudoterminal that opens an interactive SSH shell for a device.
 */

import * as vscode from 'vscode';
import { Client, ClientChannel } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';
import { PasswordManager } from './passwordManager';

/**
 * @brief Pseudoterminal that proxies input/output to an SSH shell session.
 */
export class SshTerminalSession implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<void>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    private client: Client | undefined;
    private shell: ClientChannel | undefined;
    private closed = false;
    private readonly passwordManager: PasswordManager;

    constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {
        this.passwordManager = new PasswordManager(this.context);
    }

    open(initialDimensions?: vscode.TerminalDimensions): void {
        void this.start(initialDimensions);
    }

    close(): void {
        if (!this.closed) {
            this.closed = true;
            this.closeEmitter.fire();
        }
        this.shell?.end();
        this.client?.end();
    }

    handleInput(data: string): void {
        this.shell?.write(data);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        if (this.shell) {
            this.shell.setWindow(dimensions.rows, dimensions.columns, dimensions.rows, dimensions.columns);
        }
    }

    private async start(initialDimensions?: vscode.TerminalDimensions): Promise<void> {
        try {
            if (!vscode.workspace.isTrusted) {
                throw new Error('Workspace trust is required before connecting to devices.');
            }

            const validationError = this.validateDeviceConfiguration();
            if (validationError) {
                throw new Error(validationError);
            }

            if (this.closed) {
                return;
            }

            const password = await this.passwordManager.getPassword(this.device);
            if (!password) {
                throw new Error('Password is required to connect to the device.');
            }

            if (this.closed) {
                return;
            }

            await this.connect(password, initialDimensions);
        } catch (err: any) {
            const message = err?.message ?? String(err);
            this.writeEmitter.fire(`Connection error: ${message}\r\n`);
            vscode.window.showErrorMessage(message);
            this.close();
        }
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

    private connect(password: string, initialDimensions?: vscode.TerminalDimensions): Promise<void> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            this.client = client;
            const port = this.device.port ?? 22;
            const host = this.device.host.trim();
            const username = this.device.username.trim();

            client
                .on('ready', () => {
                    if (this.closed) {
                        client.end();
                        return;
                    }

                    const cols = initialDimensions?.columns ?? 80;
                    const rows = initialDimensions?.rows ?? 24;
                    client.shell({ term: 'xterm-color', cols, rows }, (err, stream) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        this.shell = stream;
                        this.writeEmitter.fire(`Connected to ${this.device.name}\r\n`);

                        stream
                            .on('data', (data: Buffer) => {
                                this.writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
                            })
                            .on('close', () => {
                                this.close();
                            });

                        stream.stderr.on('data', (data: Buffer) => {
                            this.writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
                        });

                        resolve();
                    });
                })
                .on('error', (err) => {
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    this.close();
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
