/* global suite, test */

const assert = require('assert');
const vscode = require('vscode');

suite('VS Code Extension E2E Suite', () => {
  test('activates the template extension', async () => {
    const extension = vscode.extensions.getExtension('template.vscode-extension-template');
    assert.ok(extension, 'Extension should be available');

    await extension.activate();

    assert.ok(extension.isActive, 'Extension should activate successfully');
  });
});
