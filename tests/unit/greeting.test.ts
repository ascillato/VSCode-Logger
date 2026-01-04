import type { WorkspaceConfiguration } from 'vscode';
import { describe, expect, it } from 'vitest';
import { buildGreeting } from '../../src/greeting';

describe('buildGreeting', () => {
  it('returns a greeting with the default prefix', () => {
    expect(buildGreeting('Developer')).toBe('Hello, Developer!');
  });

  it('uses the prefix provided by configuration', () => {
    const fakeConfig = {
      get: (key: string) => (key === 'template.greetingPrefix' ? 'Welcome' : undefined),
    } as unknown as WorkspaceConfiguration;

    expect(buildGreeting('Developer', fakeConfig)).toBe('Welcome, Developer!');
  });
});
