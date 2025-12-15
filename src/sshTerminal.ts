/**
 * @file sshTerminal.ts
 * @brief Provides a pseudoterminal that opens an interactive SSH shell for a device.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { BastionConfig, EmbeddedDevice } from './deviceTree';
import { HostEndpoint, getHostEndpoints } from './hostEndpoints';
import { PasswordManager } from './passwordManager';

type ForwardingClient = Client & {
    forwardOut(
        srcIP: string,
        srcPort: number,
        dstIP: string,
        dstPort: number,
        callback: (err: Error | undefined, stream: any) => void
    ): void;
};

type SocketConnectConfig = ConnectConfig & { sock?: any };

/**
 * @brief Pseudoterminal that proxies input/output to an SSH shell session.
 */
export class SshTerminalSession implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<void>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    private client: Client | undefined;
    private bastionClient: Client | undefined;
    private shell: ClientChannel | undefined;
    private closed = false;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private isReconnecting = false;
    private lastDimensions: vscode.TerminalDimensions | undefined;
    private readonly passwordManager: PasswordManager;

    constructor(
        private readonly device: EmbeddedDevice,
        private readonly context: vscode.ExtensionContext,
        private readonly initialPath?: string
    ) {
        this.passwordManager = new PasswordManager(this.context);
    }

    open(initialDimensions?: vscode.TerminalDimensions): void {
        this.lastDimensions = initialDimensions ?? this.lastDimensions;
        void this.start(initialDimensions);
    }

    close(): void {
        if (!this.closed) {
            this.closed = true;
            this.clearReconnectTimer();
            this.disposeClients();
            this.closeEmitter.fire();
        }
    }

    handleInput(data: string): void {
        this.shell?.write(data);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        if (this.shell) {
            this.shell.setWindow(dimensions.rows, dimensions.columns, dimensions.rows, dimensions.columns);
        }
        this.lastDimensions = dimensions;
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

            const bastion = this.getBastionConfig();
            const bastionAuthentication = bastion ? await this.getBastionAuthentication(bastion) : undefined;

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
                    await this.connect(endpoint, authentication, bastion, bastionAuthentication, initialDimensions);
                    this.isReconnecting = false;
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
            if (this.closed) {
                return;
            }

            if (this.isReconnecting) {
                this.scheduleReconnect();
                return;
            }

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
        const bastion = this.device.bastion;
        if (bastion) {
            if (!bastion.host?.trim()) {
                return `Device "${this.device.name}" is missing a bastion host.`;
            }
            if (!bastion.username?.trim()) {
                return `Device "${this.device.name}" is missing a bastion username.`;
            }
            if (bastion.port !== undefined && (!Number.isInteger(bastion.port) || bastion.port <= 0)) {
                return `Device "${this.device.name}" has an invalid bastion port.`;
            }
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

    private getBastionConfig(): BastionConfig | undefined {
        const bastion = this.device.bastion;
        if (!bastion?.host?.trim() || !bastion.username?.trim()) {
            return undefined;
        }

        return {
            ...bastion,
            host: bastion.host.trim(),
            username: bastion.username.trim(),
            port: bastion.port ?? 22,
            hostFingerprint: bastion.hostFingerprint?.trim(),
            privateKeyPath: bastion.privateKeyPath?.trim(),
        };
    }

    private async getBastionAuthentication(
        bastion: BastionConfig
    ): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
        if (bastion.privateKeyPath) {
            const privateKey = await this.loadPrivateKey(bastion.privateKeyPath);
            const bastionDevice = this.getBastionDevice(bastion);
            const passphrase = await this.passwordManager.getPassphrase(bastionDevice);
            return { privateKey, passphrase: passphrase || undefined };
        }

        const bastionDevice = this.getBastionDevice(bastion);
        const password = await this.passwordManager.getPassword(bastionDevice);
        if (!password) {
            throw new Error('Password or private key is required to connect to the bastion host.');
        }

        return { password };
    }

    private getBastionDevice(bastion: BastionConfig): EmbeddedDevice {
        return {
            id: `${this.device.id}-bastion`,
            name: `${this.device.name} bastion`,
            host: bastion.host,
            username: bastion.username,
        } as EmbeddedDevice;
    }

    private connect(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        bastion?: BastionConfig,
        bastionAuthentication?: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        initialDimensions?: vscode.TerminalDimensions
    ): Promise<void> {
        if (bastion && bastionAuthentication) {
            return this.connectThroughBastion(endpoint, authentication, bastion, bastionAuthentication, initialDimensions);
        }

        return this.connectDirect(endpoint, authentication, initialDimensions);
    }

    private connectThroughBastion(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        bastion: BastionConfig,
        bastionAuthentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        initialDimensions?: vscode.TerminalDimensions
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const bastionClient = new Client() as ForwardingClient;
            this.bastionClient = bastionClient;
            const bastionPort = bastion.port ?? 22;

            bastionClient
                .on('ready', () => {
                    bastionClient.forwardOut('127.0.0.1', 0, endpoint.host, this.device.port ?? 22, (err: Error | undefined, stream: any) => {
                        if (err) {
                            bastionClient.end();
                            reject(err);
                            return;
                        }

                        void this.connectDirect(endpoint, authentication, initialDimensions, stream)
                            .then(resolve)
                            .catch((error) => {
                                bastionClient.end();
                                reject(error);
                            });
                    });
                })
                .on('error', (err) => {
                    bastionClient.end();
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    this.handleConnectionLost();
                })
                .connect({
                    host: bastion.host,
                    port: bastionPort,
                    username: bastion.username,
                    ...bastionAuthentication,
                });
        });
    }

    private connectDirect(
        endpoint: HostEndpoint,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        initialDimensions?: vscode.TerminalDimensions,
        sock?: any
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
                                this.handleConnectionLost();
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
                    this.handleConnectionLost();
                })
                .connect({
                    host,
                    port,
                    username,
                    sock,
                    ...authentication,
                } as SocketConnectConfig);
        });
    }

    private handleConnectionLost(): void {
        if (this.closed) {
            return;
        }

        this.disposeClients();
        this.isReconnecting = true;
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.closed || this.reconnectTimer) {
            return;
        }

        const timestamp = new Date().toLocaleString();
        const message = `\r\n\u001b[1m\u001b[41mSSH Connection lost at ${timestamp}. Retrying in 5 seconds...\u001b[0m\r\n\r\n`;
        this.writeEmitter.fire(message);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.closed) {
                return;
            }
            void this.start(this.lastDimensions);
        }, 5000);
    }

    private disposeClients(): void {
        this.shell?.removeAllListeners();
        this.shell?.end();
        this.shell = undefined;

        this.client?.removeAllListeners();
        this.client?.end();
        this.client = undefined;

        this.bastionClient?.removeAllListeners();
        this.bastionClient?.end();
        this.bastionClient = undefined;

        this.clearReconnectTimer();
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
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
