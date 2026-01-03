const vscode = acquireVsCodeApi();

const state = {
  devices: [],
  defaults: {
    defaultPort: 22,
    defaultLogCommand: 'tail -F /var/log/syslog',
    defaultEnableSshTerminal: true,
    defaultEnableSftpExplorer: true,
    defaultEnableWebBrowser: false,
    defaultSshCommandsText: '[]',
    maxLinesPerTab: 100000,
  },
};

const deviceColumns = [
  { key: 'id', label: 'ID', type: 'text' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'host', label: 'Host', type: 'text' },
  { key: 'port', label: 'Port', type: 'number', min: 1 },
  { key: 'username', label: 'User', type: 'text' },
  { key: 'logCommand', label: 'Log command', type: 'text' },
  { key: 'hostFingerprint', label: 'Host fingerprint', type: 'text' },
  { key: 'secondaryHost', label: 'Secondary host', type: 'text' },
  { key: 'secondaryHostFingerprint', label: 'Secondary fingerprint', type: 'text' },
  { key: 'enableSshTerminal', label: 'SSH terminal', type: 'checkbox' },
  { key: 'enableSftpExplorer', label: 'SFTP', type: 'checkbox' },
  { key: 'enableWebBrowser', label: 'Web', type: 'checkbox' },
  { key: 'webBrowserUrl', label: 'Web URL', type: 'text' },
  { key: 'privateKeyPath', label: 'Private key path', type: 'text' },
  { key: 'privateKeyPassphrase', label: 'Key passphrase (legacy)', type: 'text' },
  { key: 'password', label: 'Password (legacy)', type: 'text' },
  { key: 'sshCommandsText', label: 'SSH commands (JSON array)', type: 'textarea' },
  { key: 'bastionHost', label: 'Bastion host', type: 'text' },
  { key: 'bastionPort', label: 'Bastion port', type: 'number', min: 1 },
  { key: 'bastionUsername', label: 'Bastion user', type: 'text' },
  { key: 'bastionHostFingerprint', label: 'Bastion fingerprint', type: 'text' },
  { key: 'bastionPrivateKeyPath', label: 'Bastion key path', type: 'text' },
  { key: 'bastionPrivateKeyPassphrase', label: 'Bastion key passphrase', type: 'text' },
  { key: 'bastionPassword', label: 'Bastion password (legacy)', type: 'text' },
];

let activeColumnResize = null;

function postReady() {
  vscode.postMessage({ type: 'requestState' });
}

function handleInit(message) {
  const { devices = [], defaults } = message;
  state.defaults = {
    ...state.defaults,
    ...defaults,
    defaultSshCommandsText: defaults?.defaultSshCommandsText ?? '[]',
  };
  state.devices = devices.map(toViewDevice);
  render();
}

function toViewDevice(device) {
  return {
    id: device.id ?? '',
    name: device.name ?? '',
    host: device.host ?? '',
    port: device.port ?? '',
    username: device.username ?? '',
    logCommand: device.logCommand ?? '',
    hostFingerprint: device.hostFingerprint ?? '',
    secondaryHost: device.secondaryHost ?? '',
    secondaryHostFingerprint: device.secondaryHostFingerprint ?? '',
    enableSshTerminal: Boolean(device.enableSshTerminal),
    enableSftpExplorer: Boolean(device.enableSftpExplorer),
    enableWebBrowser: Boolean(device.enableWebBrowser),
    webBrowserUrl: device.webBrowserUrl ?? '',
    privateKeyPath: device.privateKeyPath ?? '',
    privateKeyPassphrase: device.privateKeyPassphrase ?? '',
    password: device.password ?? '',
    sshCommandsText: JSON.stringify(device.sshCommands ?? [], null, 2),
    bastionHost: device.bastion?.host ?? '',
    bastionPort: device.bastion?.port ?? '',
    bastionUsername: device.bastion?.username ?? '',
    bastionHostFingerprint: device.bastion?.hostFingerprint ?? '',
    bastionPrivateKeyPath: device.bastion?.privateKeyPath ?? '',
    bastionPrivateKeyPassphrase: device.bastion?.privateKeyPassphrase ?? '',
    bastionPassword: device.bastion?.password ?? '',
  };
}

function render() {
  renderDefaults();
  renderDevices();
  setStatus('');
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
  document.getElementById('defaultSshCommands').value =
    state.defaults.defaultSshCommandsText ?? '[]';
}

function renderDevices() {
  const tbody = document.getElementById('devicesBody');
  tbody.innerHTML = '';

  state.devices.forEach((device, index) => {
    const row = document.createElement('tr');
    deviceColumns.forEach((col) => {
      const cell = document.createElement('td');
      const input = createInput(col, device[col.key], index, col.key);
      cell.appendChild(input);
      row.appendChild(cell);
    });
    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.className = 'button button-danger';
    removeButton.addEventListener('click', () => removeDevice(index));
    removeCell.appendChild(removeButton);
    row.appendChild(removeCell);
    tbody.appendChild(row);
  });
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
  if (col.type === 'checkbox') {
    return '12ch';
  }
  if (col.type === 'number') {
    return '20ch';
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
      col.type === 'checkbox' ? '12ch' : col.type === 'textarea' ? '24ch' : '20ch';
    colElement.style.width = widthValue;
    colElement.style.minWidth = minWidthValue;
    colElement.dataset.minWidthPx = String(measureWidth(minWidthValue));
    colgroup.appendChild(colElement);
  });

  const actionCol = document.createElement('col');
  actionCol.style.width = '12ch';
  actionCol.style.minWidth = '10ch';
  actionCol.dataset.minWidthPx = String(measureWidth('10ch'));
  colgroup.appendChild(actionCol);
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
    name: '',
    host: '',
    port: '',
    username: '',
    logCommand: '',
    hostFingerprint: '',
    secondaryHost: '',
    secondaryHostFingerprint: '',
    enableSshTerminal: true,
    enableSftpExplorer: true,
    enableWebBrowser: false,
    webBrowserUrl: '',
    privateKeyPath: '',
    privateKeyPassphrase: '',
    password: '',
    sshCommandsText: '[]',
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

function removeDevice(index) {
  state.devices.splice(index, 1);
  renderDevices();
}

function collectDefaults() {
  return {
    defaultPort: document.getElementById('defaultPort').value,
    defaultLogCommand: document.getElementById('defaultLogCommand').value,
    maxLinesPerTab: document.getElementById('maxLinesPerTab').value,
    defaultEnableSshTerminal: document.getElementById('defaultEnableSshTerminal').checked,
    defaultEnableSftpExplorer: document.getElementById('defaultEnableSftpExplorer').checked,
    defaultEnableWebBrowser: document.getElementById('defaultEnableWebBrowser').checked,
    defaultSshCommandsText: document.getElementById('defaultSshCommands').value,
  };
}

function save() {
  setStatus('Saving...', 'info');
  vscode.postMessage({
    type: 'save',
    defaults: collectDefaults(),
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

function setStatus(message, variant = '') {
  const el = document.getElementById('status');
  el.textContent = message || '';
  el.className = variant ? `status ${variant}` : 'status';
}

function handleSaveResult(message) {
  if (message.success) {
    setStatus('Saved settings.', 'success');
  } else {
    setStatus(message.message || 'Failed to save settings.', 'error');
  }
}

function handleMessage(event) {
  const { type, ...rest } = event.data;
  switch (type) {
    case 'init':
      handleInit(rest);
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
  addColumnResizers();
  document.getElementById('addDevice').addEventListener('click', addDevice);
  document.getElementById('editJson').addEventListener('click', editJson);
  document.getElementById('clearPasswords').addEventListener('click', clearStoredPasswords);
  document.getElementById('saveChanges').addEventListener('click', save);
  window.addEventListener('message', handleMessage);
  postReady();
}

init();
