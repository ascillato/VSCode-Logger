/**
 * Manages streaming log data to an on-disk file for the log panel.
 *
 * @copyright Copyright (c) 2025 A. Scillato
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Coordinates creation, writing, and disposal of the auto-save stream.
 */
export class AutoSaveManager {
  private stream?: fs.WriteStream;
  private filePath?: string;
  private onStreamError?: (message: string) => void;
  private onStreamStop?: () => void;

  get isActive(): boolean {
    return !!this.stream;
  }

  get activePath(): string | undefined {
    return this.filePath;
  }

  get activeFileName(): string | undefined {
    return this.filePath ? path.basename(this.filePath) : undefined;
  }

  /**
   * Opens a write stream for the provided file path and wires callbacks for lifecycle events.
   */
  async start(
    filePath: string,
    onError: (message: string) => void,
    onStop: () => void
  ): Promise<void> {
    await this.stop({ silent: true });
    this.filePath = filePath;
    this.onStreamError = onError;
    this.onStreamStop = onStop;
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.stream.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.onStreamError?.(message ? `Auto-save failed: ${message}` : 'Auto-save failed.');
      void this.stop({ silent: true }).then(() => this.onStreamStop?.());
    });
  }

  /**
   * Closes the active auto-save stream if present.
   *
   * @returns whether a notification should be sent to the Webview.
   */
  async stop(options: { silent?: boolean; message?: string } = {}): Promise<boolean> {
    const { silent = false } = options;
    const hadAutoSave = !!(this.stream || this.filePath);

    if (this.stream) {
      await new Promise<void>((resolve) => {
        const stream = this.stream;
        if (!stream) {
          resolve();
          return;
        }

        if (stream.closed) {
          resolve();
          return;
        }

        stream.once('close', () => resolve());
        stream.end();
      });
      this.stream = undefined;
    }

    this.filePath = undefined;
    return !silent && hadAutoSave;
  }

  /**
   * Writes a single line to the active auto-save stream and reports failures to the caller.
   */
  writeLine(line: string, onError: (message: string) => void, onStop: () => void): void {
    if (!this.stream) {
      return;
    }

    try {
      this.stream.write(`${line}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message ? `Auto-save failed: ${message}` : 'Auto-save failed.');
      void this.stop({ silent: true }).then(onStop).catch(onStop);
    }
  }
}
