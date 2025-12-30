const assert = require('assert');
const vscode = require('vscode');
const { describe, it } = require('mocha');

describe('VS Code Extension E2E Suite', () => {
  it('activates the extension', async () => {
    const extension = vscode.extensions.getExtension('Scallant.embedded-device-logger');
    assert.ok(extension, 'Extension should be available');

    await extension.activate();

    assert.ok(extension.isActive, 'Extension should activate successfully');
  });
});
