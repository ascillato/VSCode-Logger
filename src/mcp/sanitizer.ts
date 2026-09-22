const PATTERNS = [
  /\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
  /\b(password|passwd|passphrase|token|api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)/gi,
  /([?&](?:access_token|token|api[_-]?key|password)=)[^&#\s]+/gi,
  /:\/\/([^/@:\s]+):([^/@\s]+)@/g,
  /\b(?:SUPER_SECRET_PASSWORD_123|SECRET_TOKEN_ABC123|VERY_PRIVATE_API_KEY)\b/g,
];
export class McpSanitizer {
  constructor(private enabled: boolean) {}
  text(value: string, maxBytes = 65536): string {
    let result = value;
    if (this.enabled)
      for (const pattern of PATTERNS)
        result = result.replace(pattern, (match, prefix: string | undefined) =>
          prefix && /[:=?&@]/.test(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]'
        );
    const bytes = Buffer.from(result);
    return bytes.length <= maxBytes
      ? result
      : `${bytes.subarray(0, maxBytes).toString('utf8')}\n[OUTPUT TRUNCATED]`;
  }
}
export function safeError(error: unknown, s: McpSanitizer): Error {
  return new Error(s.text(error instanceof Error ? error.message : String(error), 2048));
}
