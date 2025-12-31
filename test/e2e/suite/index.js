const fs = require('fs');
const path = require('path');
const Mocha = require('mocha');

async function collectTestFiles(directory) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith('.test.js') ? [fullPath] : [];
    })
  );

  return files.flat();
}

async function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname);
  const testFiles = await collectTestFiles(testsRoot);

  testFiles.forEach((file) => mocha.addFile(file));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures) {
        reject(new Error(`${failures} tests failed.`));
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  run,
};
