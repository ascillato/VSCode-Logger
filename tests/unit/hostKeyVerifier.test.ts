import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

import { HostKeyVerifier } from '../../src/logSession/hostKeyVerifier';

describe('HostKeyVerifier', () => {
  it('parses configured SHA256 fingerprints and accepts matching host keys', () => {
    const verifier = new HostKeyVerifier('Device A', 'primary');
    const hostKey = Buffer.from('host-key-material');
    const fingerprint = `SHA256:${createHash('sha256').update(hostKey).digest('base64')}`;

    const expected = verifier.getExpectedFingerprint({
      host: 'device-a.local',
      label: 'primary',
      fingerprint,
    });

    expect(expected).toEqual({
      display: fingerprint,
      hex: createHash('sha256').update(hostKey).digest('hex'),
    });
    expect(verifier.verify(hostKey, expected)).toBe(true);
    expect(verifier.getLastSeen()).toEqual(expected);
    expect(verifier.getFailure()).toBeUndefined();
  });

  it('accepts colon-delimited hex fingerprints and normalizes string host keys', () => {
    const verifier = new HostKeyVerifier('Device A', 'secondary');
    const hex = 'aa'.repeat(32);
    const expected = verifier.getExpectedFingerprint({
      host: 'backup.local',
      label: 'secondary',
      fingerprint: hex.match(/.{1,2}/g)?.join(':'),
    });

    const accepted = verifier.verify(hex, expected);

    expect(accepted).toBe(true);
    expect(verifier.getLastSeen()).toEqual({
      display: `SHA256:${Buffer.from(hex, 'hex').toString('base64')}`,
      hex,
    });
  });

  it('captures mismatches and notifies callers', () => {
    const onMismatch = vi.fn();
    const verifier = new HostKeyVerifier('Device A', 'primary', onMismatch);
    const expected = verifier.getExpectedFingerprint({
      host: 'device-a.local',
      label: 'primary',
      fingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    const actualKey = Buffer.from('unexpected-key');

    const accepted = verifier.verify(actualKey, expected);
    const actualDigest = `SHA256:${createHash('sha256').update(actualKey).digest('base64')}`;

    expect(accepted).toBe(false);
    expect(onMismatch).toHaveBeenCalledWith({
      expected: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      received: actualDigest,
    });
    expect(verifier.getFailure()).toEqual({
      expected: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      received: actualDigest,
    });
  });

  it('throws clear errors for missing and invalid configured fingerprints', () => {
    const verifier = new HostKeyVerifier('Device A', 'bastion');

    expect(() =>
      verifier.getExpectedFingerprint({
        host: 'bastion.local',
        label: 'bastion',
        fingerprint: '   ',
      })
    ).toThrow('Device "Device A" is missing an SSH host key fingerprint for the bastion endpoint.');

    expect(() =>
      verifier.getExpectedFingerprint({
        host: 'bastion.local',
        label: 'bastion',
        fingerprint: 'not-a-fingerprint',
      })
    ).toThrow(
      'Device "Device A" has an invalid SSH host key fingerprint for the bastion endpoint.'
    );
  });

  it('resets cached verification state', () => {
    const verifier = new HostKeyVerifier('Device A', 'primary', vi.fn());
    const expected = verifier.getExpectedFingerprint({
      host: 'device-a.local',
      label: 'primary',
      fingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });

    verifier.verify(Buffer.from('unexpected-key'), expected);
    verifier.reset();

    expect(verifier.getLastSeen()).toBeUndefined();
    expect(verifier.getFailure()).toBeUndefined();
  });
});
