const vscode = acquireVsCodeApi();

const state = {
  groups: [],
  devices: [],
  defaults: {
    defaultPort: 22,
    defaultLogCommand: 'tail -F /var/log/syslog',
    defaultEnableSshTerminal: true,
    defaultEnableSftpExplorer: true,
    defaultEnableWebBrowser: false,
    defaultEnableEmbeddedWebBrowser: false,
    defaultSshCommands: [],
    maxLinesPerTab: 100000,
  },
};

const selectedDevices = new Set();
const selectedGroups = new Set();

const deviceColumns = [
  { key: '__selected', label: 'Select', type: 'rowSelect' },
  { key: 'id', label: 'ID', type: 'text' },
  { key: 'group', label: 'Group', type: 'groupSelect' },
  { key: 'color', label: 'Color', type: 'color' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'host', label: 'Host', type: 'text' },
  { key: 'port', label: 'Port', type: 'number', min: 1 },
  { key: 'username', label: 'User', type: 'text' },
  { key: 'logCommand', label: 'Log command', type: 'text' },
  { key: 'hostFingerprint', label: 'Host fingerprint', type: 'text' },
  { key: 'secondaryHost', label: 'Secondary host', type: 'text' },
  { key: 'secondaryHostFingerprint', label: 'Secondary fingerprint', type: 'text' },
  { key: 'enableSshTerminal', label: 'SSH terminal', type: 'triState' },
  { key: 'enableSftpExplorer', label: 'SFTP', type: 'triState' },
  { key: 'sftpPresetsRemote', label: 'SFTP presets (remote)', type: 'textarea' },
  { key: 'sftpPresetsLocal', label: 'SFTP presets (local)', type: 'textarea' },
  { key: 'enableWebBrowser', label: 'External Web Browser', type: 'triState' },
  { key: 'enableEmbeddedWebBrowser', label: 'Embedded Web Browser', type: 'triState' },
  { key: 'webBrowserUrl', label: 'Web URL', type: 'text' },
  { key: 'privateKeyPath', label: 'Private key path', type: 'text' },
  { key: 'privateKeyPassphrase', label: 'Key passphrase (write only)', type: 'text' },
  { key: 'password', label: 'Password (write only)', type: 'text' },
  // eslint-disable-next-line spellcheck/spell-checker
  { key: 'showDefaultSshCommands', label: 'Show default SSH cmnds', type: 'checkbox' },
  { key: 'sshCommands', label: 'SSH commands', type: 'sshCommands' },
  { key: 'bastionHost', label: 'Bastion host', type: 'text' },
  { key: 'bastionPort', label: 'Bastion port', type: 'number', min: 1 },
  { key: 'bastionUsername', label: 'Bastion user', type: 'text' },
  { key: 'bastionHostFingerprint', label: 'Bastion fingerprint', type: 'text' },
  { key: 'bastionPrivateKeyPath', label: 'Bastion key path', type: 'text' },
  { key: 'bastionPrivateKeyPassphrase', label: 'Bastion key passphrase', type: 'text' },
  { key: 'bastionPassword', label: 'Bastion password (write only)', type: 'text' },
];

let activeColumnResize = null;
let helpModal;
let helpContent;
let helpCopyButton;
let helpCloseButton;
let scriptEditorModal;
let scriptEditorTitle;
let scriptEditorTextarea;
let scriptEditorSaveButton;
let scriptEditorCancelButton;
let activeScriptEditor;
let isSyncingScroll = false;

function postReady() {
  vscode.postMessage({ type: 'requestState' });
}

function handleInit(message) {
  const { groups = [], devices = [], defaults } = message;
  selectedGroups.clear();
  selectedDevices.clear();
  state.groups = groups.map((group) => ({ name: group?.name ?? '' }));
  state.defaults = {
    ...state.defaults,
    ...defaults,
    defaultSshCommands: Array.isArray(defaults?.defaultSshCommands)
      ? defaults.defaultSshCommands.map(toViewSshCommand)
      : [],
  };
  state.devices = devices.map(toViewDevice);
  render();
}

function toViewSshCommand(command) {
  return {
    name: command?.name ?? '',
    command: command?.command ?? '',
    openSshPanel: command?.openSshPanel === true,
    rerunOnReconnection: command?.openSshPanel === true && command?.rerunOnReconnection === true,
    copyAndRunScript: command?.copyAndRunScript === true,
    script: command?.script ?? '',
  };
}

function toViewDevice(device) {
  return {
    id: device.id ?? '',
    group: device.group ?? '',
    color: device.color ?? '',
    name: device.name ?? '',
    host: device.host ?? '',
    port: device.port ?? '',
    username: device.username ?? '',
    logCommand: device.logCommand ?? '',
    hostFingerprint: device.hostFingerprint ?? '',
    secondaryHost: device.secondaryHost ?? '',
    secondaryHostFingerprint: device.secondaryHostFingerprint ?? '',
    enableSshTerminal: toTriState(device.enableSshTerminal),
    enableSftpExplorer: toTriState(device.enableSftpExplorer),
    sftpPresetsRemote: Array.isArray(device.sftpPresetsRemote)
      ? device.sftpPresetsRemote.join('\n')
      : (device.sftpPresetsRemote ?? ''),
    sftpPresetsLocal: Array.isArray(device.sftpPresetsLocal)
      ? device.sftpPresetsLocal.join('\n')
      : (device.sftpPresetsLocal ?? ''),
    enableWebBrowser: toTriState(device.enableWebBrowser),
    enableEmbeddedWebBrowser: toTriState(device.enableEmbeddedWebBrowser),
    webBrowserUrl: device.webBrowserUrl ?? '',
    showDefaultSshCommands: device.showDefaultSshCommands ?? true,
    privateKeyPath: device.privateKeyPath ?? '',
    privateKeyPassphrase: device.privateKeyPassphrase ?? '',
    password: device.password ?? '',
    sshCommands: Array.isArray(device.sshCommands) ? device.sshCommands.map(toViewSshCommand) : [],
    bastionHost: device.bastion?.host ?? '',
    bastionPort: device.bastion?.port ?? '',
    bastionUsername: device.bastion?.username ?? '',
    bastionHostFingerprint: device.bastion?.hostFingerprint ?? '',
    bastionPrivateKeyPath: device.bastion?.privateKeyPath ?? '',
    bastionPrivateKeyPassphrase: device.bastion?.privateKeyPassphrase ?? '',
    bastionPassword: device.bastion?.password ?? '',
  };
}

function toTriState(value) {
  if (value === true) {
    return 'enabled';
  }
  if (value === false) {
    return 'disabled';
  }
  return 'default';
}

function render() {
  renderDefaults();
  renderGroups();
  renderDevices();
  setStatus('');
}

function renderGroups() {
  const tbody = document.getElementById('groupsBody');
  tbody.innerHTML = '';

  state.groups.forEach((group, index) => {
    const row = document.createElement('tr');
    row.className = selectedGroups.has(group) ? 'device-row-selected' : '';

    const selectCell = document.createElement('td');
    selectCell.className = 'cell-center';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedGroups.has(group);
    checkbox.addEventListener('change', (event) => {
      if (event.target.checked) {
        selectedGroups.add(group);
      } else {
        selectedGroups.delete(group);
      }
      updateSelectedGroupActions();
      renderGroups();
    });
    selectCell.appendChild(checkbox);

    const nameCell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = group.name ?? '';
    input.placeholder = 'Group name';
    input.addEventListener('input', (event) => {
      state.groups[index].name = event.target.value;
      renderDevices();
    });
    nameCell.appendChild(input);

    row.appendChild(selectCell);
    row.appendChild(nameCell);
    tbody.appendChild(row);
  });

  updateSelectedGroupActions();
}

function renderDefaults() {
  document.getElementById('defaultPort').value = state.defaults.defaultPort ?? '';
  document.getElementById('defaultLogCommand').value = state.defaults.defaultLogCommand ?? '';
  document.getElementById('maxLinesPerTab').value = state.defaults.maxLinesPerTab ?? '';
  document.getElementById('defaultEnableSshTerminal').checked =
    !!state.defaults.defaultEnableSshTerminal;
  document.getElementById('defaultEnableSftpExplorer').checked =
    !!state.defaults.defaultEnableSftpExplorer;
  document.getElementById('defaultEnableWebBrowser').checked =
    !!state.defaults.defaultEnableWebBrowser;
  document.getElementById('defaultEnableEmbeddedWebBrowser').checked =
    !!state.defaults.defaultEnableEmbeddedWebBrowser;
  renderSshCommandsEditor(
    state.defaults.defaultSshCommands,
    document.getElementById('defaultSshCommands'),
    (next, options = {}) => {
      state.defaults.defaultSshCommands = next;
      if (options.rebuild) {
        renderDefaults();
      }
    }
  );
}

function renderDevices() {
  const tbody = document.getElementById('devicesBody');
  tbody.innerHTML = '';

  state.devices.forEach((device, index) => {
    const row = document.createElement('tr');
    row.className = selectedDevices.has(device) ? 'device-row-selected' : '';
    deviceColumns.forEach((col) => {
      const cell = document.createElement('td');
      const input = createInput(col, device[col.key], index, col.key);
      cell.appendChild(input);
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });

  addColumnResizers();
  updateSelectedDeviceActions();
}

function getSelectedDevices() {
  return state.devices.filter((device) => selectedDevices.has(device));
}

function getSelectedGroups() {
  return state.groups.filter((group) => selectedGroups.has(group));
}

function updateSelectedGroupActions() {
  const hasSelection = getSelectedGroups().length > 0;
  document.getElementById('removeSelectedGroups').disabled = !hasSelection;
  document.getElementById('moveSelectedGroupsUp').disabled = !hasSelection;
  document.getElementById('moveSelectedGroupsDown').disabled = !hasSelection;
}

function updateSelectedDeviceActions() {
  const selectedCount = getSelectedDevices().length;
  const hasSelection = selectedCount > 0;

  const moveUpButton = document.getElementById('moveSelectedUp');
  const moveDownButton = document.getElementById('moveSelectedDown');
  const clearPasswordsButton = document.getElementById('clearSelectedPasswords');
  const removeButton = document.getElementById('removeSelectedDevices');

  if (moveUpButton) {
    moveUpButton.disabled = !hasSelection;
  }
  if (moveDownButton) {
    moveDownButton.disabled = !hasSelection;
  }
  if (clearPasswordsButton) {
    clearPasswordsButton.disabled = !hasSelection;
  }
  if (removeButton) {
    removeButton.disabled = !hasSelection;
  }
}

function moveSelectedDevicesUp() {
  if (!getSelectedDevices().length) {
    return;
  }

  for (let index = 1; index < state.devices.length; index += 1) {
    const current = state.devices[index];
    const previous = state.devices[index - 1];
    if (selectedDevices.has(current) && !selectedDevices.has(previous)) {
      state.devices[index - 1] = current;
      state.devices[index] = previous;
    }
  }

  renderDevices();
}

function addGroup() {
  const newGroup = { name: '' };
  state.groups.push(newGroup);
  renderGroups();
  renderDevices();
}

function removeSelectedGroups() {
  const selected = getSelectedGroups();
  if (!selected.length) {
    return;
  }

  const removedNames = new Set(
    selected.map((group) => (group.name ?? '').trim()).filter((name) => !!name)
  );
  state.groups = state.groups.filter((group) => !selectedGroups.has(group));
  selectedGroups.clear();
  state.devices.forEach((device) => {
    if (removedNames.has((device.group ?? '').trim())) {
      device.group = '';
    }
  });
  renderGroups();
  renderDevices();
}

function moveSelectedGroupsUp() {
  if (!getSelectedGroups().length) {
    return;
  }

  for (let index = 1; index < state.groups.length; index += 1) {
    const current = state.groups[index];
    const previous = state.groups[index - 1];
    if (selectedGroups.has(current) && !selectedGroups.has(previous)) {
      state.groups[index - 1] = current;
      state.groups[index] = previous;
    }
  }

  renderGroups();
}

function moveSelectedGroupsDown() {
  if (!getSelectedGroups().length) {
    return;
  }

  for (let index = state.groups.length - 2; index >= 0; index -= 1) {
    const current = state.groups[index];
    const next = state.groups[index + 1];
    if (selectedGroups.has(current) && !selectedGroups.has(next)) {
      state.groups[index] = next;
      state.groups[index + 1] = current;
    }
  }

  renderGroups();
}

function moveSelectedDevicesDown() {
  if (!getSelectedDevices().length) {
    return;
  }

  for (let index = state.devices.length - 2; index >= 0; index -= 1) {
    const current = state.devices[index];
    const next = state.devices[index + 1];
    if (selectedDevices.has(current) && !selectedDevices.has(next)) {
      state.devices[index] = next;
      state.devices[index + 1] = current;
    }
  }

  renderDevices();
}

function setupScriptEditorModal() {
  scriptEditorModal = document.createElement('div');
  scriptEditorModal.className = 'modal modal--script-editor hidden';

  const dialog = document.createElement('div');
  dialog.className = 'modal__dialog modal__dialog--script-editor';

  const header = document.createElement('div');
  header.className = 'modal__header';

  scriptEditorTitle = document.createElement('h3');
  scriptEditorTitle.textContent = 'Edit script';

  const description = document.createElement('p');
  description.textContent = 'Write the script that will be copied to /tmp and executed.';

  header.appendChild(scriptEditorTitle);
  header.appendChild(description);

  scriptEditorTextarea = document.createElement('textarea');
  scriptEditorTextarea.className = 'modal__textarea';
  scriptEditorTextarea.spellcheck = false;
  scriptEditorTextarea.setAttribute('aria-label', 'SSH command script editor');

  const actions = document.createElement('div');
  actions.className = 'modal__actions modal__actions--sticky';

  scriptEditorSaveButton = document.createElement('button');
  scriptEditorSaveButton.className = 'button button-primary';
  scriptEditorSaveButton.textContent = 'Save';
  scriptEditorSaveButton.addEventListener('click', saveScriptEditor);

  scriptEditorCancelButton = document.createElement('button');
  scriptEditorCancelButton.className = 'button button-secondary';
  scriptEditorCancelButton.textContent = 'Cancel';
  scriptEditorCancelButton.addEventListener('click', closeScriptEditor);

  actions.appendChild(scriptEditorSaveButton);
  actions.appendChild(scriptEditorCancelButton);

  dialog.appendChild(header);
  dialog.appendChild(scriptEditorTextarea);
  dialog.appendChild(actions);
  scriptEditorModal.appendChild(dialog);

  scriptEditorModal.addEventListener('click', (event) => {
    if (event.target === scriptEditorModal) {
      closeScriptEditor();
    }
  });

  document.body.appendChild(scriptEditorModal);
}

function openScriptEditor(title, initialValue, onSave) {
  if (!scriptEditorModal) {
    setupScriptEditorModal();
  }

  activeScriptEditor = { onSave };
  scriptEditorTitle.textContent = title || 'Edit script';
  scriptEditorTextarea.value = initialValue || '';
  scriptEditorModal.classList.remove('hidden');
  setTimeout(() => {
    scriptEditorTextarea.focus();
    scriptEditorTextarea.setSelectionRange(
      scriptEditorTextarea.value.length,
      scriptEditorTextarea.value.length
    );
  }, 0);
}

function closeScriptEditor() {
  activeScriptEditor = null;
  if (scriptEditorModal) {
    scriptEditorModal.classList.add('hidden');
  }
}

function saveScriptEditor() {
  activeScriptEditor?.onSave(scriptEditorTextarea.value);
  closeScriptEditor();
}

function renderSshCommandsEditor(commands, mountPoint, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'ssh-commands-editor';

  const table = document.createElement('table');
  table.className = 'ssh-commands-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const nameTh = document.createElement('th');
  nameTh.textContent = 'Name';
  nameTh.title = 'Command names support emojis from https://emojidb.org/';
  headerRow.appendChild(nameTh);

  const commandTh = document.createElement('th');
  commandTh.textContent = 'Command';
  headerRow.appendChild(commandTh);

  const openPanelTh = document.createElement('th');
  openPanelTh.textContent = 'Open SSH Panel';
  headerRow.appendChild(openPanelTh);

  const rerunOnReconnectionTh = document.createElement('th');
  rerunOnReconnectionTh.textContent = 'Re-run on reconnection';
  headerRow.appendChild(rerunOnReconnectionTh);

  const copyAndRunScriptTh = document.createElement('th');
  copyAndRunScriptTh.textContent = 'Copy and Run Script';
  headerRow.appendChild(copyAndRunScriptTh);

  const addTh = document.createElement('th');
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'button button-icon';
  addButton.textContent = '+';
  addButton.title = 'Add command';
  addButton.addEventListener('click', () => {
    const updated = [
      ...list,
      {
        name: '',
        command: '',
        openSshPanel: false,
        rerunOnReconnection: false,
        copyAndRunScript: false,
        script: '',
      },
    ];
    list = updated;
    onChange(updated, { rebuild: true });
  });
  addTh.appendChild(addButton);
  headerRow.appendChild(addTh);
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let list = Array.isArray(commands) ? commands : [];

  list.forEach((item, idx) => {
    const row = document.createElement('tr');
    row.className = 'ssh-commands-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Name';
    nameInput.value = item?.name ?? '';
    nameInput.addEventListener('input', (event) => {
      const updated = [...list];
      updated[idx] = { ...updated[idx], name: event.target.value };
      list = updated;
      onChange(updated, { rebuild: false });
    });
    const nameCell = document.createElement('td');
    nameCell.appendChild(nameInput);

    const commandInput = document.createElement('input');
    commandInput.type = 'text';
    commandInput.placeholder = 'Command';
    commandInput.value = item?.command ?? '';
    commandInput.addEventListener('input', (event) => {
      const updated = [...list];
      updated[idx] = { ...updated[idx], command: event.target.value };
      list = updated;
      onChange(updated, { rebuild: false });
    });
    const commandCell = document.createElement('td');
    commandCell.appendChild(commandInput);

    const openPanelInput = document.createElement('input');
    openPanelInput.type = 'checkbox';
    openPanelInput.checked = item?.openSshPanel === true;
    openPanelInput.title = 'Open this command in an SSH panel';
    openPanelInput.setAttribute('aria-label', `Open ${item?.name || 'command'} in SSH panel`);
    openPanelInput.addEventListener('change', (event) => {
      const updated = [...list];
      const openSshPanel = event.target.checked;
      updated[idx] = {
        ...updated[idx],
        openSshPanel,
        rerunOnReconnection: openSshPanel ? updated[idx]?.rerunOnReconnection === true : false,
      };
      list = updated;
      onChange(updated, { rebuild: false });
      rerunOnReconnectionInput.disabled = !openSshPanel;
      if (!openSshPanel) {
        rerunOnReconnectionInput.checked = false;
      }
    });
    const openPanelCell = document.createElement('td');
    openPanelCell.className = 'ssh-command-open-panel';
    openPanelCell.appendChild(openPanelInput);

    const rerunOnReconnectionInput = document.createElement('input');
    rerunOnReconnectionInput.type = 'checkbox';
    rerunOnReconnectionInput.checked =
      item?.openSshPanel === true && item?.rerunOnReconnection === true;
    rerunOnReconnectionInput.disabled = item?.openSshPanel !== true;
    rerunOnReconnectionInput.title = 'Re-run this command after the SSH panel reconnects';
    rerunOnReconnectionInput.setAttribute(
      'aria-label',
      `Re-run ${item?.name || 'command'} on reconnection`
    );
    rerunOnReconnectionInput.addEventListener('change', (event) => {
      const updated = [...list];
      updated[idx] = {
        ...updated[idx],
        rerunOnReconnection: updated[idx]?.openSshPanel === true && event.target.checked === true,
      };
      list = updated;
      onChange(updated, { rebuild: false });
    });
    const rerunOnReconnectionCell = document.createElement('td');
    rerunOnReconnectionCell.className = 'ssh-command-open-panel';
    rerunOnReconnectionCell.appendChild(rerunOnReconnectionInput);

    const copyAndRunScriptInput = document.createElement('input');
    copyAndRunScriptInput.type = 'checkbox';
    copyAndRunScriptInput.checked = item?.copyAndRunScript === true;
    copyAndRunScriptInput.title = 'Copy a script to /tmp and run it after the command';
    copyAndRunScriptInput.setAttribute(
      'aria-label',
      `Copy and run script for ${item?.name || 'command'}`
    );

    const editScriptButton = document.createElement('button');
    editScriptButton.type = 'button';
    editScriptButton.className = 'button button-icon';
    editScriptButton.textContent = '✎';
    editScriptButton.title = 'Edit script';
    editScriptButton.disabled = item?.copyAndRunScript !== true;
    editScriptButton.addEventListener('click', () => {
      if (editScriptButton.disabled) {
        return;
      }

      openScriptEditor(
        `Edit script for ${list[idx]?.name || 'SSH command'}`,
        list[idx]?.script ?? '',
        (value) => {
          const updated = [...list];
          updated[idx] = {
            ...updated[idx],
            script: value,
          };
          list = updated;
          onChange(updated, { rebuild: false });
        }
      );
    });

    copyAndRunScriptInput.addEventListener('change', (event) => {
      const updated = [...list];
      updated[idx] = {
        ...updated[idx],
        copyAndRunScript: event.target.checked === true,
      };
      list = updated;
      onChange(updated, { rebuild: false });
      editScriptButton.disabled = event.target.checked !== true;
    });

    const copyAndRunScriptCell = document.createElement('td');
    copyAndRunScriptCell.className = 'ssh-command-copy-script';
    copyAndRunScriptCell.appendChild(copyAndRunScriptInput);
    copyAndRunScriptCell.appendChild(editScriptButton);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'button button-danger button-icon';
    removeButton.title = 'Remove command';
    removeButton.textContent = '✕';
    removeButton.addEventListener('click', () => {
      const updated = [...list.slice(0, idx), ...list.slice(idx + 1)];
      list = updated;
      onChange(updated, { rebuild: true });
    });
    const removeCell = document.createElement('td');
    removeCell.className = 'ssh-command-remove';
    removeCell.appendChild(removeButton);

    row.appendChild(nameCell);
    row.appendChild(commandCell);
    row.appendChild(openPanelCell);
    row.appendChild(rerunOnReconnectionCell);
    row.appendChild(copyAndRunScriptCell);
    row.appendChild(removeCell);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  wrapper.appendChild(table);

  if (mountPoint) {
    mountPoint.innerHTML = '';
    mountPoint.appendChild(wrapper);
  }

  return wrapper;
}

function measureWidth(value) {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.height = '0';
  probe.style.width = value;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width || 0;
  document.body.removeChild(probe);
  return width;
}

function getInitialWidthValue(col) {
  if (col.type === 'rowSelect') {
    return '8ch';
  }
  if (col.type === 'checkbox' || col.type === 'triState') {
    return '12ch';
  }
  if (col.type === 'number') {
    return '20ch';
  }
  if (col.type === 'color') {
    return '10ch';
  }
  if (col.type === 'sshCommands') {
    return '24ch';
  }
  if (col.type === 'textarea') {
    return '24ch';
  }
  return '20ch';
}

function setupTableColumns() {
  const colgroup = document.getElementById('devicesColGroup');
  if (!colgroup) {
    return;
  }

  colgroup.innerHTML = '';
  deviceColumns.forEach((col) => {
    const colElement = document.createElement('col');
    const widthValue = getInitialWidthValue(col);
    const minWidthValue =
      col.type === 'rowSelect'
        ? '8ch'
        : col.type === 'checkbox' || col.type === 'triState'
          ? '12ch'
          : col.type === 'textarea' || col.type === 'sshCommands'
            ? '24ch'
            : col.type === 'color'
              ? '10ch'
              : '20ch';
    colElement.style.width = widthValue;
    colElement.style.minWidth = minWidthValue;
    colElement.dataset.minWidthPx = String(measureWidth(minWidthValue));
    colgroup.appendChild(colElement);
  });
}

function startColumnResize(event, index) {
  event.preventDefault();
  const colgroup = document.getElementById('devicesColGroup');
  const col = colgroup?.children[index];
  if (!col) {
    return;
  }

  const startWidth = col.getBoundingClientRect().width || measureWidth(col.style.width || '0px');
  const minWidth = Number(col.dataset.minWidthPx || '80');
  activeColumnResize = {
    startX: event.clientX,
    startWidth,
    minWidth,
    col,
  };
  document.addEventListener('mousemove', handleColumnResize);
  document.addEventListener('mouseup', stopColumnResize);
}

function handleColumnResize(event) {
  if (!activeColumnResize) {
    return;
  }
  const delta = event.clientX - activeColumnResize.startX;
  const newWidth = Math.max(activeColumnResize.minWidth, activeColumnResize.startWidth + delta);
  activeColumnResize.col.style.width = `${newWidth}px`;
}

function stopColumnResize() {
  if (!activeColumnResize) {
    return;
  }
  document.removeEventListener('mousemove', handleColumnResize);
  document.removeEventListener('mouseup', stopColumnResize);
  activeColumnResize = null;
}

function addColumnResizers() {
  const headers = Array.from(document.querySelectorAll('#devicesTable thead th'));
  headers.forEach((th, index) => {
    if (index === headers.length - 1) {
      return;
    }
    if (th.querySelector('.col-resizer')) {
      return;
    }
    th.classList.add('resizable');
    const resizer = document.createElement('span');
    resizer.className = 'col-resizer';
    resizer.title = 'Drag to resize';
    resizer.addEventListener('mousedown', (event) => startColumnResize(event, index));
    th.appendChild(resizer);
  });
}

function createInput(col, value, index, key) {
  if (col.type === 'rowSelect') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selectedDevices.has(state.devices[index]);
    input.title = 'Select device row';
    input.setAttribute('aria-label', 'Select device row');
    input.addEventListener('change', (event) => {
      const device = state.devices[index];
      if (!device) {
        return;
      }
      if (event.target.checked) {
        selectedDevices.add(device);
      } else {
        selectedDevices.delete(device);
      }
      updateSelectedDeviceActions();
      renderDevices();
    });
    return input;
  }

  if (col.type === 'sshCommands') {
    return renderSshCommandsEditor(value || [], null, (next, options = {}) => {
      state.devices[index][key] = next;
      if (options.rebuild) {
        renderDevices();
      }
    });
  }
  if (col.type === 'triState') {
    const select = document.createElement('select');
    const options = [
      { value: 'default', label: 'Default' },
      { value: 'enabled', label: 'Enabled' },
      { value: 'disabled', label: 'Disabled' },
    ];
    options.forEach((option) => {
      const entry = document.createElement('option');
      entry.value = option.value;
      entry.textContent = option.label;
      select.appendChild(entry);
    });
    select.value = value || 'default';
    select.addEventListener('change', (event) => {
      state.devices[index][key] = event.target.value;
    });
    return select;
  }
  if (col.type === 'groupSelect') {
    const select = document.createElement('select');
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    select.appendChild(noneOption);

    const groupNames = state.groups
      .map((group) => (group.name ?? '').trim())
      .filter((name, idx, list) => !!name && list.indexOf(name) === idx);
    groupNames.forEach((groupName) => {
      const option = document.createElement('option');
      option.value = groupName;
      option.textContent = groupName;
      select.appendChild(option);
    });

    select.value = value || '';
    select.addEventListener('change', (event) => {
      state.devices[index][key] = event.target.value;
    });
    return select;
  }
  if (col.type === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.addEventListener('change', (event) => {
      state.devices[index][key] = event.target.checked;
    });
    return input;
  }

  if (col.type === 'textarea') {
    const input = document.createElement('textarea');
    input.value = value ?? '';
    input.rows = 3;
    input.spellcheck = false;
    input.addEventListener('input', (event) => {
      state.devices[index][key] = event.target.value;
    });
    return input;
  }

  if (col.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'color-input';
    const defaultColor = getDefaultTabTitleColor();
    const normalized = normalizeColorValue(value);
    input.value = normalized || defaultColor;
    input.addEventListener('input', (event) => {
      state.devices[index][key] = event.target.value;
    });
    return input;
  }

  const input = document.createElement('input');
  input.type = col.type || 'text';
  if (col.min) {
    input.min = col.min;
  }
  input.value = value ?? '';
  input.addEventListener('input', (event) => {
    state.devices[index][key] = event.target.value;
  });
  return input;
}

function addDevice() {
  state.devices.push({
    id: '',
    group: '',
    color: randomDeviceColor(),
    name: '',
    host: '',
    port: '',
    username: '',
    logCommand: '',
    hostFingerprint: '',
    secondaryHost: '',
    secondaryHostFingerprint: '',
    enableSshTerminal: 'default',
    enableSftpExplorer: 'default',
    sftpPresetsRemote: '',
    sftpPresetsLocal: '',
    enableWebBrowser: 'default',
    enableEmbeddedWebBrowser: 'default',
    webBrowserUrl: '',
    showDefaultSshCommands: true,
    privateKeyPath: '',
    privateKeyPassphrase: '',
    password: '',
    sshCommands: [],
    bastionHost: '',
    bastionPort: '',
    bastionUsername: '',
    bastionHostFingerprint: '',
    bastionPrivateKeyPath: '',
    bastionPrivateKeyPassphrase: '',
    bastionPassword: '',
  });
  renderDevices();
}

function getDefaultTabTitleColor() {
  const computed = getComputedStyle(document.documentElement).getPropertyValue(
    '--vscode-tab-activeForeground'
  );
  return normalizeColorValue(computed) || '#ffffff';
}

function randomDeviceColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 70;
  const lightness = 55;
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeColorValue(value) {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.toLowerCase();
    if (hex.length === 4) {
      const [r, g, b] = hex.slice(1).split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (hex.length >= 7) {
      return hex.slice(0, 7);
    }
    return '';
  }

  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1, 4).map((entry) => {
      const parsed = Number(entry);
      const safe = Number.isFinite(parsed) ? parsed : 0;
      return Math.max(0, Math.min(255, safe));
    });
    const toHex = (entry) => entry.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return '';
}

function removeSelectedDevices() {
  const selected = getSelectedDevices();
  if (!selected.length) {
    return;
  }

  state.devices = state.devices.filter((device) => !selectedDevices.has(device));
  selectedDevices.clear();
  renderDevices();
  setStatus(
    selected.length === 1
      ? 'Removed selected device.'
      : `Removed ${selected.length} selected devices.`,
    'info'
  );
}

function collectDefaults() {
  return {
    defaultPort: document.getElementById('defaultPort').value,
    defaultLogCommand: document.getElementById('defaultLogCommand').value,
    maxLinesPerTab: document.getElementById('maxLinesPerTab').value,
    defaultEnableSshTerminal: document.getElementById('defaultEnableSshTerminal').checked,
    defaultEnableSftpExplorer: document.getElementById('defaultEnableSftpExplorer').checked,
    defaultEnableWebBrowser: document.getElementById('defaultEnableWebBrowser').checked,
    defaultEnableEmbeddedWebBrowser: document.getElementById('defaultEnableEmbeddedWebBrowser')
      .checked,
    defaultSshCommands: state.defaults.defaultSshCommands,
  };
}

function save() {
  setStatus('Saving...', 'info');
  vscode.postMessage({
    type: 'save',
    defaults: collectDefaults(),
    groups: state.groups,
    devices: state.devices,
  });
}

function editJson() {
  setStatus('Opening settings.json...', 'info');
  vscode.postMessage({ type: 'editJson' });
}

function clearStoredPasswords() {
  setStatus('Removing stored passwords...', 'info');
  vscode.postMessage({ type: 'clearPasswords' });
}

function exportSettings() {
  setStatus('Exporting settings...', 'info');
  vscode.postMessage({
    type: 'exportSettings',
    defaults: collectDefaults(),
    groups: state.groups,
    devices: state.devices,
  });
}

function importSettings() {
  setStatus('Importing settings...', 'info');
  vscode.postMessage({ type: 'importSettings' });
}

function clearSelectedDeviceStoredPasswords() {
  const selected = getSelectedDevices();
  if (!selected.length) {
    return;
  }

  const ids = selected
    .map((device) => (device?.id || '').trim())
    .filter((deviceId, index, list) => !!deviceId && list.indexOf(deviceId) === index);

  if (!ids.length) {
    setStatus('Set at least one selected device ID before resetting stored password.', 'error');
    return;
  }

  ids.forEach((deviceId) => {
    vscode.postMessage({ type: 'clearDevicePassword', deviceId });
  });

  if (ids.length === 1) {
    setStatus(`Removing stored password for ${ids[0]}...`, 'info');
    return;
  }

  setStatus(`Removing stored passwords for ${ids.length} selected devices...`, 'info');
}

function setupHelpModal() {
  helpModal = document.createElement('div');
  helpModal.className = 'modal hidden';

  const dialog = document.createElement('div');
  dialog.className = 'modal__dialog';

  const header = document.createElement('div');
  header.className = 'modal__header';

  const title = document.createElement('h3');
  title.textContent = 'Configuration example';

  const description = document.createElement('p');
  description.textContent = 'Copy and paste these defaults into your settings.json.';

  header.appendChild(title);
  header.appendChild(description);

  helpContent = document.createElement('pre');
  helpContent.className = 'modal__code';

  const actions = document.createElement('div');
  actions.className = 'modal__actions';

  helpCopyButton = document.createElement('button');
  helpCopyButton.className = 'button';
  helpCopyButton.textContent = 'Copy';
  helpCopyButton.addEventListener('click', copyHelpJson);

  helpCloseButton = document.createElement('button');
  helpCloseButton.className = 'button button-secondary';
  helpCloseButton.textContent = 'Close';
  helpCloseButton.addEventListener('click', closeHelp);

  actions.appendChild(helpCopyButton);
  actions.appendChild(helpCloseButton);

  dialog.appendChild(header);
  dialog.appendChild(helpContent);
  dialog.appendChild(actions);
  helpModal.appendChild(dialog);

  helpModal.addEventListener('click', (event) => {
    if (event.target === helpModal) {
      closeHelp();
    }
  });

  document.body.appendChild(helpModal);
}

function openHelp() {
  if (!helpModal) {
    setupHelpModal();
  }
  helpContent.textContent = buildHelpJson();
  helpModal.classList.remove('hidden');
}

function closeHelp() {
  if (helpModal) {
    helpModal.classList.add('hidden');
  }
}

async function copyHelpJson() {
  try {
    await navigator.clipboard.writeText(helpContent.textContent || '');
    setStatus('Copied configuration example.', 'success');
  } catch (error) {
    setStatus('Failed to copy configuration example.', 'error');
    console.error(error);
  }
}

function buildHelpJson() {
  const defaults = state.defaults;
  const exampleSshCommands = [
    {
      name: '🔁 Reboot',
      command: 'reboot',
      openSshPanel: false,
      rerunOnReconnection: false,
      copyAndRunScript: false,
    },
    {
      name: '⚙️ Restart Service',
      command: 'systemctl restart my-service',
      openSshPanel: false,
      rerunOnReconnection: false,
      copyAndRunScript: false,
    },
    {
      name: '📈 Processes',
      command: 'top',
      openSshPanel: true,
      rerunOnReconnection: true,
      copyAndRunScript: false,
    },
    {
      name: '🚀 Deploy helper',
      command: 'echo Preparing deployment',
      openSshPanel: false,
      rerunOnReconnection: false,
      copyAndRunScript: true,
      script: '#!/bin/sh\necho "Deploying on $(hostname)"\n',
    },
  ];
  const example = {
    'embeddedLogger.defaultPort': defaults.defaultPort ?? 22,
    'embeddedLogger.defaultLogCommand': defaults.defaultLogCommand ?? 'tail -F /var/log/syslog',
    'embeddedLogger.defaultEnableSshTerminal': !!defaults.defaultEnableSshTerminal,
    'embeddedLogger.defaultEnableSftpExplorer': !!defaults.defaultEnableSftpExplorer,
    'embeddedLogger.defaultEnableWebBrowser': !!defaults.defaultEnableWebBrowser,
    'embeddedLogger.defaultEnableEmbeddedWebBrowser': !!defaults.defaultEnableEmbeddedWebBrowser,
    'embeddedLogger.maxLinesPerTab': defaults.maxLinesPerTab ?? 100000,
    'embeddedLogger.defaultSshCommands': defaults.defaultSshCommands ?? [],
    'embeddedLogger.groups': state.groups.filter((group) => (group.name ?? '').trim().length > 0),
    'embeddedLogger.devices': [
      {
        id: 'device-1',
        group: 'Lab',
        color: '#4fc3f7',
        name: 'My device',
        host: '192.168.0.10',
        port: defaults.defaultPort ?? 22,
        username: 'root',
        logCommand: defaults.defaultLogCommand ?? 'tail -F /var/log/syslog',
        enableSshTerminal: !!defaults.defaultEnableSshTerminal,
        enableSftpExplorer: !!defaults.defaultEnableSftpExplorer,
        enableWebBrowser: !!defaults.defaultEnableWebBrowser,
        enableEmbeddedWebBrowser: !!defaults.defaultEnableEmbeddedWebBrowser,
        webBrowserUrl: 'http://192.168.0.10',
        showDefaultSshCommands: true,
        sshCommands: exampleSshCommands,
      },
    ],
  };

  return JSON.stringify(example, null, 2);
}

function setStatus(message, variant = '') {
  const el = document.getElementById('status');
  el.textContent = message || '';
  const base = 'status align-end';
  el.className = variant ? `${base} ${variant}` : base;
}

function handleSaveResult(message) {
  if (message.success) {
    setStatus(message.message || 'Saved settings.', 'success');
  } else {
    setStatus(message.message || 'Failed to save settings.', 'error');
  }
}

function handleOperationResult(message) {
  setStatus(message.message || '', message.variant || 'info');
}

function handleImportResult(message) {
  if (message.success && message.defaults && message.devices) {
    handleInit(message);
    setStatus(
      message.message || 'Imported settings. Review them and click Save changes to apply them.',
      'success'
    );
    return;
  }

  setStatus(message.message || 'Failed to import settings.', 'error');
}

function handleMessage(event) {
  const { type, ...rest } = event.data;
  switch (type) {
    case 'init':
      handleInit(rest);
      break;
    case 'importResult':
      handleImportResult(rest);
      break;
    case 'operationResult':
      handleOperationResult(rest);
      break;
    case 'saveResult':
      handleSaveResult(rest);
      break;
    default:
      break;
  }
}

function init() {
  setupTableColumns();
  document.getElementById('addGroup').addEventListener('click', addGroup);
  document.getElementById('moveSelectedGroupsUp').addEventListener('click', moveSelectedGroupsUp);
  document
    .getElementById('moveSelectedGroupsDown')
    .addEventListener('click', moveSelectedGroupsDown);
  document.getElementById('removeSelectedGroups').addEventListener('click', removeSelectedGroups);
  document.getElementById('addDevice').addEventListener('click', addDevice);
  document.getElementById('moveSelectedUp').addEventListener('click', moveSelectedDevicesUp);
  document.getElementById('moveSelectedDown').addEventListener('click', moveSelectedDevicesDown);
  document
    .getElementById('clearSelectedPasswords')
    .addEventListener('click', clearSelectedDeviceStoredPasswords);
  document.getElementById('removeSelectedDevices').addEventListener('click', removeSelectedDevices);
  document.getElementById('editJson').addEventListener('click', editJson);
  document.getElementById('helpButton').addEventListener('click', openHelp);
  document.getElementById('importSettings').addEventListener('click', importSettings);
  document.getElementById('exportSettings').addEventListener('click', exportSettings);
  document.getElementById('clearPasswords').addEventListener('click', clearStoredPasswords);
  document.getElementById('saveChanges').addEventListener('click', save);
  window.addEventListener('message', handleMessage);
  window.addEventListener('resize', () => {
    setupTableColumns();
    addColumnResizers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    closeHelp();
    closeScriptEditor();
  });
  setupHelpModal();
  setupScriptEditorModal();
  postReady();
}

init();
