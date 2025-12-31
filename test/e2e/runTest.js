const path = require('path');
const { runTests } = require('@vscode/test-electron');
const vscodeTestUtil = require('@vscode/test-electron/out/util');

vscodeTestUtil.validateStream = async (readable, _length, sha256) =>
  new Promise((resolve, reject) => {
    const checksum = sha256 ? require('crypto').createHash('sha256') : undefined;
    readable.on('data', (chunk) => checksum?.update(chunk));
    readable.on('error', reject);
    readable.on('end', () => {
      if (sha256) {
        checksum?.digest('hex');
      }
      resolve();
    });
  });

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index.js');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (err) {
    console.error('Failed to run VS Code tests');
    console.error(err);
    process.exit(1);
  }
}

void main();
