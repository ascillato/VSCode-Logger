/**
 * Custom error types for log session orchestration.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import type { HostEndpoint } from '../hostEndpoints';

/** Error raised when the remote host key does not match the expected fingerprint. */
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
