export interface LogSessionCallbacks {
  onLine: (line: string) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onClose: () => void;
  onHostKeyMismatch?: (details: { expected: string; received: string }) => void;
}
