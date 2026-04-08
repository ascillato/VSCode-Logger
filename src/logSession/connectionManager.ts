/**
 * Establishes SSH connections (optionally through bastion hosts) and streams log data.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import type { Client, ClientChannel, ConnectConfig } from 'ssh2';
import type { BastionConfig, EmbeddedDevice } from '../deviceTree';
import type { HostEndpoint } from '../hostEndpoints';
import { HostKeyMismatchError } from './errors';
import type { AuthenticationResult } from './authenticationProvider';
import type { FingerprintPersistence } from './fingerprintPersistence';
import type { HostKeyVerifier } from './hostKeyVerifier';

const SSH_KEEPALIVE_INTERVAL_MS = 5000;
const SSH_KEEPALIVE_COUNT_MAX = 3;

type ForwardingClient = Client & {
  forwardOut(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (err: Error | undefined, stream: ClientChannel) => void
  ): void;
};

export interface ClientFactory {
  createClient(): Client;
  createForwardingClient(): ForwardingClient;
}

export interface ConnectionCallbacks {
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface ConnectionRequest {
  endpoint: HostEndpoint;
  authentication: AuthenticationResult;
  logCommand: string;
  device: EmbeddedDevice;
  bastion?: BastionConfig;
  bastionAuthentication?: AuthenticationResult;
  onStreamReady?: (stream: ClientChannel) => void;
}

export interface ActiveConnection {
  client: Client;
  stream: ClientChannel;
  bastionClient?: Client;
}

/**
 * Manages SSH client lifecycles and host-key verification for log streaming.
 */
export class ConnectionManager {
  constructor(
    private readonly callbacks: ConnectionCallbacks,
    private readonly persistence: FingerprintPersistence,
    private readonly hostVerifier: HostKeyVerifier,
    private readonly clientFactory: ClientFactory,
    private readonly bastionVerifier?: HostKeyVerifier
  ) {}

  /**
   * Connects to the requested endpoint, optionally tunneling through a bastion.
   */
  async connect(request: ConnectionRequest): Promise<ActiveConnection> {
    if (request.bastion && request.bastionAuthentication) {
      return this.connectThroughBastion(request);
    }

    return this.connectToEndpoint(request);
  }

  /**
   * Connects to the device via a bastion host and forwards the resulting stream.
   */
  private connectThroughBastion(request: ConnectionRequest): Promise<ActiveConnection> {
    const bastion = request.bastion;
    if (!bastion) {
      return this.connectToEndpoint(request);
    }

    const bastionEndpoint: HostEndpoint = {
      host: bastion.host,
      fingerprint: bastion.hostFingerprint,
      label: 'bastion',
    };
    const expectedBastionFingerprint =
      this.bastionVerifier?.getExpectedFingerprint(bastionEndpoint);

    this.bastionVerifier?.reset();

    return new Promise<ActiveConnection>((resolve, reject) => {
      const bastionClient = this.clientFactory.createForwardingClient();
      const bastionPort = bastion.port ?? 22;

      this.callbacks.onStatus(`Connecting to bastion ${bastion.host}:${bastionPort} ...`);

      bastionClient
        .on('ready', () => {
          void this.persistence.persistIfMissing(
            bastionEndpoint,
            this.bastionVerifier?.getLastSeen()
          );
          this.callbacks.onStatus(
            `Connected to bastion. Tunneling to ${request.endpoint.host}:${
              request.device.port ?? 22
            } ...`
          );
          bastionClient.forwardOut(
            '127.0.0.1',
            0,
            request.endpoint.host,
            request.device.port ?? 22,
            (err: Error | undefined, stream: ClientChannel) => {
              if (err) {
                reject(err);
                return;
              }

              request.onStreamReady?.(stream);
              void this.connectToEndpoint(request, stream)
                .then((connection) => resolve({ ...connection, bastionClient }))
                .catch((connectionError: unknown) => {
                  bastionClient.end();
                  reject(
                    this.normalizeError(connectionError, 'Failed to connect through bastion.')
                  );
                });
            }
          );
        })
        .on('error', (err) => {
          const failure = this.bastionVerifier?.getFailure();
          if (failure) {
            const message = `Host key verification failed for bastion ${bastion.host}:${bastionPort}. Expected ${failure.expected} but received ${failure.received}.`;
            reject(
              new HostKeyMismatchError(message, failure.expected, failure.received, bastionEndpoint)
            );
            return;
          }
          this.callbacks.onError(`SSH error: ${err.message}`);
          reject(err);
        })
        .on('close', () => {
          this.callbacks.onStatus('Bastion connection closed.');
        })
        .connect({
          host: bastion.host,
          port: bastionPort,
          username: bastion.username,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
          ...request.bastionAuthentication,
          hostHash: 'sha256',
          hostVerifier: (key) =>
            this.bastionVerifier
              ? this.bastionVerifier.verify(key, expectedBastionFingerprint)
              : true,
        });
    });
  }

  /**
   * Connects directly to the provided endpoint and starts the log command.
   */
  private connectToEndpoint(
    request: ConnectionRequest,
    sock?: ClientChannel
  ): Promise<ActiveConnection> {
    const expectedFingerprint = this.hostVerifier.getExpectedFingerprint(request.endpoint);
    this.hostVerifier.reset();
    return new Promise<ActiveConnection>((resolve, reject) => {
      const client = this.clientFactory.createClient();
      const port = request.device.port ?? 22;
      const host = request.endpoint.host;
      const username = request.device.username.trim();

      this.callbacks.onStatus(`Connecting to ${host}:${port} ...`);

      client
        .on('ready', () => {
          void this.persistence.persistIfMissing(request.endpoint, this.hostVerifier.getLastSeen());
          this.callbacks.onStatus('Connected. Streaming logs...');
          client.exec(request.logCommand, (err, stream) => {
            if (err) {
              reject(err);
              return;
            }
            request.onStreamReady?.(stream);
            resolve({ client, stream });
          });
        })
        .on('error', (err) => {
          const failure = this.hostVerifier.getFailure();
          if (failure) {
            const message = `Host key verification failed for ${host}:${port}. Expected ${failure.expected} but received ${failure.received}.`;
            reject(
              new HostKeyMismatchError(
                message,
                failure.expected,
                failure.received,
                request.endpoint
              )
            );
            return;
          }
          this.callbacks.onError(`SSH error: ${err.message}`);
          reject(err);
        })
        .on('close', () => {
          this.callbacks.onStatus('Connection closed.');
          this.callbacks.onClose();
        })
        .connect({
          host,
          port,
          username,
          sock,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
          ...request.authentication,
          hostHash: 'sha256',
          hostVerifier: (key) => this.hostVerifier.verify(key, expectedFingerprint),
        } as ConnectConfig & { sock?: ClientChannel });
    });
  }

  private normalizeError(err: unknown, fallbackMessage: string): Error {
    if (err instanceof Error) {
      return err;
    }
    const message = typeof err === 'string' ? err : fallbackMessage;
    return new Error(message || fallbackMessage);
  }
}
