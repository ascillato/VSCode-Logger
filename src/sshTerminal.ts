/**
 * @file sshTerminal.ts
 * @brief Provides a pseudoterminal that opens an interactive SSH shell for a device.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { EmbeddedDevice } from './deviceTree';
import { HostEndpoint, getHostEndpoints } from './hostEndpoints';
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

    constructor(
        private readonly device: EmbeddedDevice,
        private readonly context: vscode.ExtensionContext,
        private readonly initialPath?: string
    ) {
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

            const authentication = await this.getAuthentication();

            if (this.closed) {
                return;
            }

            const endpoints = getHostEndpoints(this.device);

            if (endpoints.length === 0) {
                throw new Error(`Device "${this.device.name}" is missing a host.`);
            }

            const maxAttempts = endpoints.length > 1 ? 3 : 1;
            let endpointIndex = 0;
            let attempts = 0;
            let lastError: unknown;

            while (attempts < maxAttempts && !this.closed) {
                const endpoint = endpoints[endpointIndex];
                try {
                    await this.connect(endpoint, authentication, initialDimensions);
                    return;
                } catch (err) {
                    lastError = err;
                    attempts++;

                    if (endpoints.length > 1) {
                        endpointIndex = (endpointIndex + 1) % endpoints.length;
                        continue;
                    }

                    break;
                }
            }

            throw lastError ?? new Error('Failed to open SSH terminal.');
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

    private connect(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        initialDimensions?: vscode.TerminalDimensions
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            this.client = client;
            const port = this.device.port ?? 22;
            const host = endpoint.host;
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

                        if (this.initialPath) {
                            stream.write(`cd -- ${this.quotePath(this.initialPath)}\n`);
                        }

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

    private quotePath(value: string): string {
        return `'${value.replace(/'/g, "'\\''")}'`;
    }
}
