const assert = require('assert');
const vscode = require('vscode');

suite('VS Code Extension E2E Suite', () => {
  test('activates the extension', async () => {
    const extension = vscode.extensions.getExtension('Scallant.embedded-device-logger');
    assert.ok(extension, 'Extension should be available');

    await extension.activate();

    assert.ok(extension.isActive, 'Extension should activate successfully');
  });
});
