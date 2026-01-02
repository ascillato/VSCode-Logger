/**
 * Computes and validates SSH host key fingerprints for devices and bastions.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import type { HostEndpoint } from '../hostEndpoints';

export interface FingerprintDetails {
  display: string;
  hex: string;
}

/**
 * Verifies host keys against expected fingerprints and captures the last seen value.
 */
export class HostKeyVerifier {
  private lastSeen: FingerprintDetails | undefined;
  private failure: { expected: string; received: string } | undefined;

  constructor(
    private readonly deviceName: string,
    private readonly endpointLabel: string,
    private readonly onMismatch?: (details: { expected: string; received: string }) => void
  ) {}

  reset(): void {
    this.failure = undefined;
    this.lastSeen = undefined;
  }

  /**
   * Returns the most recently observed fingerprint.
   */
  getLastSeen(): FingerprintDetails | undefined {
    return this.lastSeen;
  }

  /**
   * Returns the last mismatch if verification failed.
   */
  getFailure(): { expected: string; received: string } | undefined {
    return this.failure;
  }

  /**
   * Normalizes a configured fingerprint string into details for comparison.
   */
  getExpectedFingerprint(endpoint: HostEndpoint): FingerprintDetails | undefined {
    const fingerprint = endpoint.fingerprint;
    if (!fingerprint) {
      return undefined;
    }
    return this.parseFingerprint(fingerprint);
  }

  /**
   * Validates the provided host key against the expected fingerprint.
   */
  verify(key: string | Buffer, expected?: FingerprintDetails): boolean {
    const actual = this.computeHostKeyFingerprints(key);
    this.lastSeen = actual;
    if (!expected) {
      return true;
    }

    const matches = actual.hex === expected.hex;
    if (!matches) {
      this.failure = { expected: expected.display, received: actual.display };
      this.onMismatch?.(this.failure);
    }

    return matches;
  }

  private parseFingerprint(value: string): FingerprintDetails {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(
        `Device "${this.deviceName}" is missing an SSH host key fingerprint for the ${this.endpointLabel} endpoint.`
      );
    }

    const base64Candidate = trimmed.startsWith('SHA256:') ? trimmed.slice(7) : trimmed;
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    if (base64Pattern.test(base64Candidate)) {
      try {
        const hex = Buffer.from(base64Candidate, 'base64').toString('hex').toLowerCase();
        if (!hex) {
          throw new Error();
        }
        return {
          display: trimmed.startsWith('SHA256:') ? trimmed : `SHA256:${base64Candidate}`,
          hex,
        };
      } catch {
        // fall through to validation error below
      }
    }

    const hexCandidate = trimmed.replace(/:/g, '').toLowerCase();
    const isValidHex = /^[0-9a-f]+$/.test(hexCandidate) && hexCandidate.length === 64;
    if (isValidHex) {
      return { display: trimmed, hex: hexCandidate };
    }

    throw new Error(
      `Device "${this.deviceName}" has an invalid SSH host key fingerprint for the ${this.endpointLabel} endpoint. Provide the SHA256 fingerprint (for example, "SHA256:..." from ssh-keygen).`
    );
  }

  private computeHostKeyFingerprints(key: string | Buffer): FingerprintDetails {
    if (typeof key === 'string') {
      const normalized = key.replace(/:/g, '').toLowerCase();
      const display = `SHA256:${Buffer.from(normalized, 'hex').toString('base64')}`;
      return { display, hex: normalized };
    }

    const digest = createHash('sha256').update(key).digest();
    return {
      display: `SHA256:${digest.toString('base64')}`,
      hex: digest.toString('hex'),
    };
  }
}
