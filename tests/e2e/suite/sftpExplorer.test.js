/* global suite, test */

const assert = require('assert');
const vscode = require('vscode');

suite('SFTP Explorer keyboard E2E', function () {
  this.timeout(20000);

  let panel;
  let webview;
  let messageQueue = [];
  let requestSeq = 0;
  let messageDisposable;

  function drainMessages() {
    messageQueue = [];
  }

  function waitForMessage(predicate, timeoutMs = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const index = messageQueue.findIndex(predicate);
        if (index >= 0) {
          const message = messageQueue.splice(index, 1)[0];
          resolve(message);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error('Timed out waiting for message.'));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  async function expectNoMessage(predicate, timeoutMs = 700) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (messageQueue.some(predicate)) {
          reject(new Error('Unexpected message received.'));
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  async function sendTestCommand(command) {
    await webview.postMessage({ type: 'testCommand', ...command });
  }

  async function getState() {
    const requestId = `state-${requestSeq++}`;
    await sendTestCommand({ command: 'getState', requestId });
    const message = await waitForMessage(
      (entry) => entry.type === 'testState' && entry.requestId === requestId
    );
    return message.state;
  }

  async function waitForStateMatch(predicate, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await getState();
      if (predicate(state)) {
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for state match.');
  }

  async function simulateKey(side, key, options = {}) {
    await sendTestCommand({
      command: 'simulateKey',
      side,
      key,
      code: options.code || key,
      ctrlKey: Boolean(options.ctrlKey),
      metaKey: Boolean(options.metaKey),
      altKey: Boolean(options.altKey),
      shiftKey: Boolean(options.shiftKey),
    });
  }

  async function selectEntry(side, name) {
    await sendTestCommand({ command: 'selectEntry', side, name });
  }

  async function clearQuickSearch(side) {
    await sendTestCommand({ command: 'clearQuickSearch', side });
  }

  async function clearSelection(side) {
    await sendTestCommand({ command: 'clearSelection', side });
  }

  async function confirmDialog(confirmed = true) {
    await sendTestCommand({ command: 'confirmDialog', confirmed });
  }

  async function contextSelect(side) {
    await sendTestCommand({ command: 'contextSelect', side });
  }

  async function openFindDialog(side) {
    await sendTestCommand({ command: 'openFindDialog', side });
  }

  async function setFindOptions(options) {
    await sendTestCommand({ command: 'setFindOptions', options });
  }

  async function submitFind() {
    await sendTestCommand({ command: 'submitFind' });
  }

  async function setRightMode(mode) {
    await sendTestCommand({ command: 'setRightMode', mode });
  }

  async function waitForStateReady() {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const state = await getState();
      if (state.remote.path) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for SFTP explorer state.');
  }

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('Scallant.embedded-device-logger');
    assert.ok(extension, 'Extension should be available');
    const api = await extension.activate();
    assert.ok(api && api.openSftpExplorerForTest, 'Test API should be available');

    panel = await api.openSftpExplorerForTest({
      id: 'test-device',
      name: 'Test Device',
      host: 'test-host',
      username: 'tester',
    });
    assert.ok(panel, 'SFTP explorer panel should be created');
    webview = panel.getWebview();
    messageDisposable = webview.onDidReceiveMessage((message) => {
      messageQueue.push(message);
    });
    await waitForStateReady();
    drainMessages();
  });

  suiteTeardown(() => {
    messageDisposable?.dispose();
    panel?.dispose();
  });

  test('quick search Enter cycles matches', async () => {
    drainMessages();
    await clearQuickSearch('remote');
    await selectEntry('remote', 'alpha');
    await simulateKey('remote', 'a', { code: 'KeyA' });
    let state = await getState();
    assert.strictEqual(state.quickSearch.remote, 'a');
    assert.strictEqual(state.remote.selected[0], 'alpha');

    await simulateKey('remote', 'Enter', { code: 'Enter' });
    state = await getState();
    assert.strictEqual(state.remote.selected[0], 'alpha-file.txt');
  });

  test('Arrow keys move selection', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    await simulateKey('remote', 'ArrowDown', { code: 'ArrowDown' });
    let state = await getState();
    assert.strictEqual(state.remote.selected[0], 'alpha-two.log');

    await simulateKey('remote', 'ArrowUp', { code: 'ArrowUp' });
    state = await getState();
    assert.strictEqual(state.remote.selected[0], 'alpha-file.txt');
  });

  test('Delete triggers deleteEntry after confirmation', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    const waitDelete = waitForMessage((message) => message.type === 'deleteEntry');
    await simulateKey('remote', 'Delete', { code: 'Delete' });
    await confirmDialog(true);
    const deleteMessage = await waitDelete;
    assert.strictEqual(deleteMessage.path, '/alpha-file.txt');
  });

  test('F2 rename sends renameEntry with input value', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    panel.enqueueTestInput('renamed.txt');
    const waitRename = waitForMessage((message) => message.type === 'renameEntry');
    await simulateKey('remote', 'F2', { code: 'F2' });
    const renameMessage = await waitRename;
    assert.strictEqual(renameMessage.newName, 'renamed.txt');
    assert.strictEqual(renameMessage.path, '/alpha-file.txt');
  });

  test('Ctrl+D duplicates selected entry', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    const waitDuplicate = waitForMessage((message) => message.type === 'duplicateEntry');
    await simulateKey('remote', 'd', { code: 'KeyD', ctrlKey: true });
    const duplicateMessage = await waitDuplicate;
    assert.strictEqual(duplicateMessage.path, '/alpha-file.txt');
  });

  test('Arrow left/right switches between panes', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    await simulateKey('remote', 'ArrowRight', { code: 'ArrowRight' });
    let state = await getState();
    assert.strictEqual(state.focusedSide, 'right');

    await simulateKey('right', 'ArrowLeft', { code: 'ArrowLeft' });
    state = await getState();
    assert.strictEqual(state.focusedSide, 'remote');
  });

  test('Arrow pane switching selects first entry when none is selected', async () => {
    drainMessages();
    await clearSelection('right');
    await simulateKey('remote', 'ArrowRight', { code: 'ArrowRight' });
    const state = await getState();
    assert.strictEqual(state.focusedSide, 'right');
    assert.strictEqual(state.right.selected[0], 'alpha');
  });

  test('Ctrl+P no longer requests permissions info', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha-file.txt');
    await simulateKey('remote', 'p', { code: 'KeyP', ctrlKey: true });
    await expectNoMessage((message) => message.type === 'requestPermissionsInfo');
  });

  test('Context Select keeps focus for arrow navigation', async () => {
    drainMessages();
    await selectEntry('remote', 'alpha');
    await contextSelect('remote');
    let state = await getState();
    assert.strictEqual(state.focusedSide, 'remote');

    await simulateKey('remote', 'ArrowDown', { code: 'ArrowDown' });
    state = await getState();
    assert.strictEqual(state.remote.selected[0], 'alpha-file.txt');
  });

  test('Enter opens folders and Backspace selects first entry after going up', async () => {
    drainMessages();
    await clearQuickSearch('remote');
    await selectEntry('remote', 'alpha');
    const waitEnter = waitForMessage(
      (message) => message.type === 'testListResponse' && message.requestId === 'remote'
    );
    await simulateKey('remote', 'Enter', { code: 'Enter' });
    await waitEnter;
    let state = await getState();
    assert.strictEqual(state.remote.path, '/alpha');
    assert.strictEqual(state.remote.selected[0], 'alpha-child.txt');

    const waitBack = waitForMessage(
      (message) => message.type === 'testListResponse' && message.requestId === 'remote'
    );
    await simulateKey('remote', 'Backspace', { code: 'Backspace' });
    await waitBack;
    state = await getState();
    assert.strictEqual(state.remote.path, '/');
    assert.strictEqual(state.remote.selected[0], 'alpha');
  });

  test('Enter on file opens view content when quick search is hidden', async () => {
    drainMessages();
    await clearQuickSearch('remote');
    await selectEntry('remote', 'charlie.txt');
    const waitView = waitForMessage((message) => message.type === 'viewContent');
    await simulateKey('remote', 'Enter', { code: 'Enter' });
    const viewMessage = await waitView;
    assert.strictEqual(viewMessage.path, '/charlie.txt');
  });

  test('Enter cycles quick search without navigating', async () => {
    drainMessages();
    await clearQuickSearch('remote');
    await selectEntry('remote', 'alpha');
    await simulateKey('remote', 'a', { code: 'KeyA' });
    const before = await getState();
    await simulateKey('remote', 'Enter', { code: 'Enter' });
    const after = await getState();
    assert.strictEqual(after.remote.path, before.remote.path);
    assert.notStrictEqual(after.remote.selected[0], before.remote.selected[0]);
    await expectNoMessage(
      (message) => message.type === 'viewContent' || message.type === 'listEntries'
    );
  });

  test('find dialog previews and submits a remote search', async () => {
    drainMessages();
    await openFindDialog('remote');
    await setFindOptions({ name: 'alpha' });
    let state = await waitForStateMatch(
      (candidate) =>
        candidate.search.dialogOpen && candidate.search.previewCommand.includes('find .')
    );
    assert.strictEqual(state.search.dialogOpen, true);
    assert.ok(state.search.previewCommand.includes('find .'));

    const waitSearch = waitForMessage((message) => message.type === 'searchEntries');
    await submitFind();
    const searchMessage = await waitSearch;
    assert.strictEqual(searchMessage.location, 'remote');
    assert.strictEqual(searchMessage.basePath, '/');
    assert.strictEqual(searchMessage.options.name, 'alpha');
  });

  test('remote search results activate result mode on the right pane', async () => {
    drainMessages();
    await setRightMode('remote');
    await openFindDialog('right');
    await setFindOptions({ name: 'bravo' });
    const waitSearch = waitForMessage(
      (message) => message.type === 'searchEntries' && message.requestId === 'rightRemote'
    );
    await submitFind();
    await waitSearch;

    const state = await getState();
    assert.strictEqual(state.right.mode, 'remote');
    assert.strictEqual(state.search.rightActive, true);
  });
});
