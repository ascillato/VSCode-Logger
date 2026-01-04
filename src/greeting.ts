import type { WorkspaceConfiguration } from 'vscode';

/**
 * Build a friendly greeting used by the template commands.
 *
 * The optional configuration value lets projects demonstrate how to plumb
 * workspace settings into user-visible strings without shipping any sensitive
 * defaults.
 */
export function buildGreeting(
  name: string = 'VS Code',
  configuration?: WorkspaceConfiguration
): string {
  const prefix = configuration?.get<string>('template.greetingPrefix') ?? 'Hello';
  const subject = name.trim() || 'VS Code';
  return `${prefix}, ${subject}!`;
}
