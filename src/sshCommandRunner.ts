/**
 * Executes one-off SSH commands for configured devices.
 *
 * @packageDocumentation
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
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
 * Represents a named SSH command configured for a device.
 */
export interface DeviceCommand {
    name: string;
    command: string;
}

/**
 * Error describing a failed SSH command execution.
 */
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

/**
 * Runs sanitized SSH commands for a configured device.
 */
export class SshCommandRunner {
    private readonly passwordManager: PasswordManager;

    /**
     * Creates a runner bound to a device and extension context.
     *
     * @param device The device configuration for the command.
     * @param context The extension context for secret storage access.
     */
    constructor(private readonly device: EmbeddedDevice, private readonly context: vscode.ExtensionContext) {
        this.passwordManager = new PasswordManager(this.context);
    }

    /**
     * Executes a configured command over SSH.
     *
     * @param command The command definition to run.
     * @returns The command output as a string.
     */
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
        const bastion = this.getBastionConfig();
        const bastionAuthentication = bastion ? await this.getBastionAuthentication(bastion) : undefined;
        const endpoints = getHostEndpoints(this.device);

        if (endpoints.length === 0) {
            throw new Error(`Device "${this.device.name}" is missing a host.`);
        }

        const maxAttempts = endpoints.length > 1 ? 3 : 1;
        let endpointIndex = 0;
        let attempts = 0;
        let lastError: unknown;

        while (attempts < maxAttempts) {
            const endpoint = endpoints[endpointIndex];
            try {
                return await this.executeCommand(
                    endpoint,
                    sanitizedCommand,
                    authentication,
                    bastion,
                    bastionAuthentication
                );
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

        throw lastError ?? new Error(`Failed to run command "${command.name}".`);
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

    private executeCommand(
        endpoint: HostEndpoint,
        command: string,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        bastion?: BastionConfig,
        bastionAuthentication?: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>
    ): Promise<string> {
        if (bastion && bastionAuthentication) {
            return this.executeCommandThroughBastion(
                endpoint,
                command,
                authentication,
                bastion,
                bastionAuthentication
            );
        }

        return this.executeAgainstEndpoint(endpoint, command, authentication);
    }

    private executeCommandThroughBastion(
        endpoint: HostEndpoint,
        command: string,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        bastion: BastionConfig,
        bastionAuthentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const bastionClient = new Client() as ForwardingClient;
            const bastionPort = bastion.port ?? 22;

            bastionClient
                .on('ready', () => {
                    bastionClient.forwardOut('127.0.0.1', 0, endpoint.host, this.device.port ?? 22, (err: Error | undefined, stream: any) => {
                        if (err) {
                            bastionClient.end();
                            reject(err);
                            return;
                        }

                        void this.executeAgainstEndpoint(endpoint, command, authentication, stream, () =>
                            bastionClient.end()
                        )
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
                    // Tunnel closure handled after the command completes.
                })
                .connect({
                    host: bastion.host,
                    port: bastionPort,
                    username: bastion.username,
                    ...bastionAuthentication,
                });
        });
    }

    private executeAgainstEndpoint(
        endpoint: HostEndpoint,
        command: string,
        authentication: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
        sock?: any,
        onComplete?: () => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const port = this.device.port ?? 22;
            const host = endpoint.host;
            const username = this.device.username.trim();
            let stdout = '';
            let stderr = '';
            let exitCode: number | null = null;
            let exitSignal: string | null = null;
            let completed = false;

            const finalize = () => {
                if (!completed) {
                    completed = true;
                    onComplete?.();
                }
            };

            client
                .on('ready', () => {
                    client.exec(command, (err, stream) => {
                        if (err) {
                            finalize();
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
                                finalize();
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
                    finalize();
                    reject(new Error(`SSH error: ${err.message}`));
                })
                .on('close', () => {
                    finalize();
                    client.end();
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
