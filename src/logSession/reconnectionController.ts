import type { HostEndpoint } from '../hostEndpoints';
import { HostKeyMismatchError } from './errors';

export interface ReconnectOptions {
  endpoints: HostEndpoint[];
  maxAttempts: number;
  isDisposed: () => boolean;
  connect: (endpoint: HostEndpoint) => Promise<void>;
  onHostKeyMismatch: (error: HostKeyMismatchError) => Promise<boolean>;
}

export class ReconnectionController {
  constructor(private readonly options: ReconnectOptions) {}

  async connect(): Promise<void> {
    const { endpoints, maxAttempts } = this.options;
    if (endpoints.length === 0) {
      throw new Error('No endpoints available for connection.');
    }

    let endpointIndex = 0;
    let attempts = 0;
    let lastError: unknown;

    while (!this.options.isDisposed() && attempts < maxAttempts) {
      const endpoint = endpoints[endpointIndex];

      try {
        await this.options.connect(endpoint);
        return;
      } catch (err: unknown) {
        if (err instanceof HostKeyMismatchError) {
          const retry = await this.options.onHostKeyMismatch(err);
          if (retry) {
            continue;
          }
        }

        lastError = err;
        attempts++;

        if (endpoints.length > 1) {
          endpointIndex = (endpointIndex + 1) % endpoints.length;
          continue;
        }

        break;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Failed to connect to the device.');
  }
}
