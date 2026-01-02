import type { HostEndpoint } from '../hostEndpoints';

export class HostKeyMismatchError extends Error {
  constructor(
    message: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly endpoint: HostEndpoint
  ) {
    super(message);
    this.name = 'HostKeyMismatchError';
  }
}
