# Embedded Device Logger

A Visual Studio Code extension that connects to embedded Linux devices over SSH, tails their logs, and displays them with loglevel colorization, filtering presets, custom keywords highlighting and filtered export.

![Screenshot1](docs/images/screenshot_example1.png)

## Features

- Activity Bar view listing configured devices.
- **Real-time log streaming over SSH** using a configurable command (default: `tail -F /var/log/syslog`).
- **Log level parsing, filtering, and colorization** inside a Webview panel per device.
- Saved filter presets stored per device.
- **Highlight up to 10 custom keywords** with color-coded, bold, underlined text in both live and imported logs.
- **Find text inside live or imported logs** with Ctrl/Cmd+F, including next/previous navigation.
- **Reconnect closed SSH sessions** directly from the log panel and automatically mark the log when a device closes a session.
- **Export** currently visible (filtered) logs to a file.
- **Auto-save** to file option for live SSH logs.
- **Open any log files and filter them** with the same interface.
- Add, edit and remove **Bookmarks** in live logs and imported logs.
- Run optional **on-demand SSH commands** configured per device from the Devices view.
- Optionally **launch an SSH terminal** directly from a device card when enabled in settings.
- Optionally open a dual-pane **SFTP explorer** to browse remote and local files side-by-side and transfer files.
- Optionally open the configured device URL in your default **web browser** from the device card when enabled.
- Authenticate with SSH passwords or private keys.
- SSH passwords and private key passphrases are **stored securely** with VS Code Secret Storage.
- **Privacy focused**. **No telemetry**. Everything **runs locally**.
- **Built with security in mind**.

## Configuration

![Screenshot2](docs/images/screenshot_example_setup.png)

Add devices in your VS Code settings under `embeddedLogger.devices`:

```json
"embeddedLogger.maxLinesPerTab": 100000,
"embeddedLogger.devices": [
  {
    "id": "deviceA",
    "name": "Device A",
    "host": "192.168.1.10",
    "hostFingerprint": "SHA256:your-device-fingerprint",
    "secondaryHost": "192.168.1.11",
    "secondaryHostFingerprint": "SHA256:backup-device-fingerprint",
    "bastion": {
      "host": "bastion.example.com",
      "hostFingerprint": "SHA256:bastion-fingerprint",
      "port": 22,
      "username": "jump-user"
    },
    "port": 22,
    "privateKeyPath": "${env:HOME}/.ssh/id_ed25519",
    "username": "root",
    "logCommand": "tail -F /var/log/syslog",
    "enableSshTerminal": true,
    "enableSftpExplorer": true,
    "enableWebBrowser": false,
    "webBrowserUrl": "http://192.168.1.10",
    "sshCommands": [
      {
        "name": "Restart IOT",
        "command": "systemctl restart fw-iot"
      }
    ]
  }
]
```

Names for commands support emojis that can be copied from: https://emojidb.org

If no password is stored yet, the extension prompts for it when connecting and saves it locally and securely. When using an encrypted private key, the passphrase is requested once and stored securely in VS Code Secret Storage. Private key paths may include `~` or `${env:VAR}` tokens for convenience.

- **Pin each device's host key** by setting `hostFingerprint` to the device's SSH host key fingerprint (for example, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256`). If no fingerprint is configured, the extension records the server's fingerprint on the first successful connection. When a server presents a different fingerprint later, you'll be prompted to accept the new value before reconnecting.

- **Optionally configure a secondary host** via `secondaryHost` (and `secondaryHostFingerprint` when pinning). Connections start with the primary host and automatically fall back to the secondary host when the primary connection fails; if the secondary host also fails, the extension retries the primary host.

- **[EXPERIMENTAL] Tunnel through a bastion/jump host** by supplying a `bastion` block with its `host`, `username`, optional `port`, and optional `hostFingerprint` plus password or private key authentication. Secrets and host key fingerprints for the bastion are stored independently in Secret Storage and captured on first connect when omitted.

- Set `enableSshTerminal` to control visibility of the **Open SSH Terminal** button alongside any configured SSH commands for that device (the action is enabled by default; set it to `false` to hide it). The **Open SSH Terminal** action opens a dedicated VS Code terminal tab for the device and authenticates using the stored password or private key (prompting for and saving the credential securely when missing).

- Set `enableSftpExplorer` to control visibility of the **Open SFTP Explorer** button on the device card (enabled by default; set it to `false` to hide it). The explorer opens a dual-pane view with the remote home on the left and the local home on the right, including navigation, rename/delete/duplicate actions, and arrows to transfer selected files between panes (or between two remote panes when the right-side mode is switched to remote). If the SSH link drops, the explorer stays open, greys out, shows a reconnection countdown beside the title, and automatically retries every five seconds without losing the active remote paths.

- Set `enableWebBrowser` to surface the **Open WEB Browser** button beneath each device. The button is disabled by default; when enabled, clicking it opens the configured `webBrowserUrl` if provided, otherwise the extension opens `http://<host>` derived from the device host (including any port in the custom URL when supplied). Both `http://` and `https://` URLs are supported.

- Control memory usage by capping retained lines per log tab with `embeddedLogger.maxLinesPerTab` (default: 100000). For auto-save, this limit is not applied to a file. Everything is saved.

All options are available through the VS Code Settings UI under **Embedded Device Logger**, including defaults for omitted device values:

- `embeddedLogger.defaultPort` – applied when a device does not specify a port.
- `embeddedLogger.defaultLogCommand` – used when `logCommand` is omitted.
- `embeddedLogger.defaultEnableSshTerminal` – toggles whether the SSH terminal action is shown by default (default: true).
- `embeddedLogger.defaultEnableSftpExplorer` – toggles whether the SFTP explorer action is shown by default (default: true).
- `embeddedLogger.defaultEnableWebBrowser` – toggles whether the web browser action is shown by default (default: false).
- `enableWebBrowser` – when set to true per device, the **Open WEB Browser** button opens `webBrowserUrl` if configured or `http://<host>` otherwise.
- `embeddedLogger.defaultSshCommands` – shared SSH actions applied to devices that do not define their own list.

## Notes

- **Colorization of lines** is performed based on the loglevel (DEBUG, INFO, ERROR, etc). If these keys are not present in the log, no colorization is be applied.
- **Filtering presets** are stored per-device in the workspace state using the key `embeddedLogger.presets.<deviceId>`.
- Exports only include log lines currently visible after applying filters.
- When an SSH session closes, the log view appends `--- SSH session closed on <timestamp>` and offers a **Reconnect** button next to the status text to restart streaming.
- Click the highlight icon in the Embedded Logger devices view to add up to ten highlight rows, each with its own colour and editable keyword that updates live and imported logs instantly.
- Use the **Open Local Log File** button in the Embedded Logger devices view (or run the command with the same name) to select a `.log` or `.txt` file from your machine. The chosen file is loaded into the log viewer so you can reuse filtering, presets, export filtered logs and highlights just like a live connection.
- **Status** text also shows messages from the log command used in the configuration like `tail -F /var/log/syslog`. So, some messages like: `tail: '/var/log/syslog' has appeared; following new file` may appear. This message in particular happens when the log file is rotated or recreated. The `-F` flag tells `tail` to keep watching for the file to reappear, so the message is informational and indicates that log streaming will continue with the new file. If you prefer a different log source, update the `logCommand` in your device configuration.
- The Embedded Device Logger extension supports **sharing the VSCode Activity Bar** with other extensions. To merge an extension into the Activity Bar, simply select its icon from the Side Bar, then drag and drop it into your desired position within the Activity Bar.
- This extension also supports connecting to devices through a VPN (already running on the machine with VSCode).

## Installation

**From VSCode:**
- Click on Extensions in the side bar and Search for Embedded Device Logger (Publisher: Scallant, Author: A. Scillato).
- Or from the VS Code Quick Open (Ctrl+P), paste the command: `ext install Scallant.embedded-device-logger`, and press enter.
- Or from the console: `code --install-extension Scallant.embedded-device-logger`

**For more information visit the [Embedded Device Logger Extension](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger) in the VSCode Marketplace.**

If you find this extension useful, please [rate it](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger&ssr=false#review-details).

----

## For Developers

### Source Code

- See [Source Code](https://github.com/ascillato/VSCode-Logger)
- **License:** MIT

### Source Code Documentation

- See [Documentation](https://ascillato.github.io/VSCode-Logger/index.html)

### Running The Extension Locally

1. Clone the repository
2. Run `npm install` to install dependencies.
3. Run `npm run compile` to build the TypeScript.
4. Press `F5` in VS Code to launch the extension development host and open the **Embedded Logger** view.

### Package Generation

- Requires: `npm install -g @vscode/vsce`
- Run: `vsce package` to generate vsix file to be installed into VSCode
- Install locally on VSCode: `code --install-extension embedded-device-logger-1.2.0.vsix`

### Clean and re-compile

- `clear; rm -rf node_modules; rm -rf out; rm *.vsix; npm install; npm run compile; vsce package`
- `code --install-extension embedded-device-logger-1.2.0.vsix`

### Generating Source Code Documentation

1. Ensure Doxygen is available locally (`sudo apt-get install doxygen`).
2. Install Python documentation dependencies: `pip install -r docs/requirements.txt`.
3. From the repository root, run `doxygen Doxyfile` to build the XML output into `docs/xml`.
4. Build the full site with Sphinx: `sphinx-build -b html docs/source docs/build/html`.
5. Open `docs/build/html/index.html` locally or visit the published docs at https://ascillato.github.io/VSCode-Logger/.

> GitHub Actions automatically runs this pipeline on pushes to `main` with tag and publishes to the `gh-pages` branch.
