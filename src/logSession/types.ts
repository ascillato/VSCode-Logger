/**
 * Shared types for log session orchestration.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import type { HostEndpoint } from '../hostEndpoints';

/** Callbacks surfaced by a log session to its consumer. */
export interface LogSessionCallbacks {
  onLine: (line: string) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onClose: () => void;
  onHostKeyMismatch?: (details: { expected: string; received: string }) => void;
  onConnectedEndpoint?: (endpoint: HostEndpoint) => void;
}
