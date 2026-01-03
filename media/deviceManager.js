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
  document.getElementById('addDevice').addEventListener('click', addDevice);
  document.getElementById('saveChanges').addEventListener('click', save);
  window.addEventListener('message', handleMessage);
  postReady();
}

init();
