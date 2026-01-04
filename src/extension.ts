import * as vscode from 'vscode';
import { buildGreeting } from './greeting';
import { WelcomePanel } from './welcomePanel';

export function activate(context: vscode.ExtensionContext): void {
  const sayHello = vscode.commands.registerCommand('extension-template.sayHello', () => {
    const greeting = buildGreeting('Developer', vscode.workspace.getConfiguration());
    void vscode.window.showInformationMessage(greeting);
  });

  const showWelcomePanel = vscode.commands.registerCommand(
    'extension-template.showWelcomePanel',
    () => {
      WelcomePanel.createOrShow(context);
    }
  );

  context.subscriptions.push(sayHello, showWelcomePanel);
}

export function deactivate(): void {
  // Intentionally empty: add cleanup logic if your extension allocates resources.
}
