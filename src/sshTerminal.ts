/**
 * @file sshTerminal.ts
 * @brief Provides a pseudoterminal that opens an interactive SSH shell for a device.
 */

import * as vscode from 'vscode';
import { Client, ClientChannel } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';

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
    private reconnectTimer: NodeJS.Timeout | undefined;
    private readonly reconnectDelayMs = 5000;
    private passwordCache: string | undefined;
    private hasConnected = false;
    private lastDimensions: vscode.TerminalDimensions | undefined;

    constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {}

    open(initialDimensions?: vscode.TerminalDimensions): void {
        this.lastDimensions = initialDimensions;
        void this.start(initialDimensions);
    }

    close(): void {
        if (!this.closed) {
            this.closed = true;
            this.closeEmitter.fire();
        }
        this.clearReconnectTimer();
        this.shell?.end();
        this.client?.end();
    }

    handleInput(data: string): void {
        this.shell?.write(data);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.lastDimensions = dimensions;
        if (this.shell) {
            this.shell.setWindow(dimensions.rows, dimensions.columns, dimensions.rows, dimensions.columns);
        }
    }

    private async start(initialDimensions?: vscode.TerminalDimensions): Promise<void> {
        if (!vscode.workspace.isTrusted) {
            const message = 'Workspace trust is required before connecting to devices.';
            this.writeEmitter.fire(`${message}\r\n`);
            vscode.window.showErrorMessage(message);
            this.close();
            return;
        }

        const validationError = this.validateDeviceConfiguration();
        if (validationError) {
            this.writeEmitter.fire(`Connection error: ${validationError}\r\n`);
            vscode.window.showErrorMessage(validationError);
            this.close();
            return;
        }

        if (this.closed) {
            return;
        }

        const password = this.passwordCache ?? (await this.getPassword());
        if (!password) {
            const message = 'Password is required to connect to the device.';
            this.writeEmitter.fire(`${message}\r\n`);
            vscode.window.showErrorMessage(message);
            this.close();
            return;
        }

        this.passwordCache = password;

        if (this.closed) {
            return;
        }

        try {
            await this.connect(password, initialDimensions);
            this.hasConnected = true;
        } catch (err: any) {
            const message = err?.message ?? String(err);
            this.writeEmitter.fire(`Connection error: ${message}\r\n`);
            if (!this.closed) {
                this.scheduleReconnect();
            }
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

                    const dims = initialDimensions ?? this.lastDimensions;
                    const cols = dims?.columns ?? 80;
                    const rows = dims?.rows ?? 24;
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
                                this.handleDisconnect('Connection closed.');
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
                    this.handleDisconnect('Connection closed.');
                })
                .connect({
                    host,
                    port,
                    username,
                    password,
                });
        });
    }

    private handleDisconnect(reason: string): void {
        if (this.closed) {
            return;
        }

        const alreadyScheduled = Boolean(this.reconnectTimer);
        this.cleanupConnection(alreadyScheduled);
        if (!alreadyScheduled) {
            this.writeEmitter.fire(`\r\n\r\n\x1b[41m${reason}\x1b[0m\r\n`);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.closed || this.reconnectTimer) {
            return;
        }

        this.writeEmitter.fire(`Trying to reconnect in ${this.reconnectDelayMs / 1000} seconds...\r\n`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.start();
        }, this.reconnectDelayMs);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private cleanupConnection(preserveReconnectTimer = false): void {
        if (!preserveReconnectTimer) {
            this.clearReconnectTimer();
        }
        this.shell?.end();
        this.client?.end();
        this.shell = undefined;
        this.client = undefined;
    }
}
