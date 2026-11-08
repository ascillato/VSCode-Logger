import { describe, expect, it } from 'vitest';
import { McpSanitizer, safeError } from '../../src/mcp/sanitizer';

describe('McpSanitizer', () => {
  it.each([
    ['Authorization: Bearer credential, next', 'Authorization: Bearer [REDACTED], next'],
    ['AUTHORIZATION: Basic credential; next', 'AUTHORIZATION: Basic [REDACTED]; next'],
    ['password=hunter passwd: hunter passphrase=hunter', '[REDACTED] [REDACTED] [REDACTED]'],
    ['token=credential API_KEY=credential secret=credential', '[REDACTED] [REDACTED] [REDACTED]'],
    [
      'https://host/?access_token=credential&next=yes',
      'https://host/?access_token=[REDACTED]&next=yes',
    ],
    [
      'https://host/?next=yes&access_token=credential#part',
      'https://host/?next=yes&access_token=[REDACTED]#part',
    ],
    ['https://user:credential@host/path', 'https[REDACTED]host/path'],
    [
      'SUPER_SECRET_PASSWORD_123 SECRET_TOKEN_ABC123 VERY_PRIVATE_API_KEY',
      '[REDACTED] [REDACTED] [REDACTED]',
    ],
  ])('redacts sensitive output: %s', (input, expected) => {
    const sanitizer = new McpSanitizer(true);
    expect(sanitizer.text(input)).toBe(expected);
    // Reusing global patterns must not skip matches in later calls.
    expect(sanitizer.text(input)).toBe(expected);
  });

  it('preserves ordinary output and explicitly disabled redaction', () => {
    expect(new McpSanitizer(true).text('Service started successfully.')).toBe(
      'Service started successfully.'
    );
    expect(new McpSanitizer(true).text('')).toBe('');
    expect(new McpSanitizer(false).text('token=credential')).toBe('token=credential');
  });

  it('limits output by bytes and preserves output exactly at the boundary', () => {
    const sanitizer = new McpSanitizer(false);
    expect(sanitizer.text('éé', 4)).toBe('éé');
    expect(sanitizer.text('éé!', 4)).toBe('éé\n[OUTPUT TRUNCATED]');
    expect(sanitizer.text('text', 0)).toBe('\n[OUTPUT TRUNCATED]');
    expect(sanitizer.text('x'.repeat(65537))).toBe(`${'x'.repeat(65536)}\n[OUTPUT TRUNCATED]`);
  });

  it('redacts secrets before applying the output limit', () => {
    expect(new McpSanitizer(true).text(`password=${'x'.repeat(1000)}`, 10)).toBe('[REDACTED]');
  });
});

describe('safeError', () => {
  it('returns a fresh error with redacted text', () => {
    const original = new Error('Connection failed: password=credential');
    const error = safeError(original, new McpSanitizer(true));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(original);
    expect(error.message).toBe('Connection failed: [REDACTED]');
    expect(original.message).toContain('credential');
  });

  it.each(['token=credential', null, 42])('handles a non-Error rejection: %s', (value) => {
    const error = safeError(value, new McpSanitizer(true));
    expect(error.message).toBe(value === 'token=credential' ? '[REDACTED]' : String(value));
  });

  it('bounds error messages to 2048 bytes plus the truncation marker', () => {
    expect(safeError(new Error('x'.repeat(3000)), new McpSanitizer(true)).message).toBe(
      `${'x'.repeat(2048)}\n[OUTPUT TRUNCATED]`
    );
  });
});
