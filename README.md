# Embedded Device Logger

A Visual Studio Code extension that connects to embedded Linux devices over SSH, tails their logs, and displays them with filtering, colorization, presets, and export.

## Features
- Activity Bar view listing configured devices.
- Real-time log streaming over SSH using a configurable command (default: `tail -F /var/log/syslog`).
- Log level parsing, filtering, and colorization inside a Webview panel per device.
- Saved filter presets stored per device.
- Export currently visible (filtered) logs to a file.
- SSH passwords are stored securely with VS Code Secret Storage.

## Configuration
Add devices in your VS Code settings under `embeddedLogger.devices`:

```json
"embeddedLogger.devices": [
  {
    "id": "deviceA",
    "name": "Device A",
    "host": "192.168.1.10",
    "port": 22,
    "username": "root",
    "logCommand": "tail -F /var/log/syslog"
  }
]
```

If no password is stored yet, the extension prompts for it when connecting and saves it locally and securely.

## Notes
- Presets are stored per-device in the workspace state using the key `embeddedLogger.presets.<deviceId>`.
- Exports only include log lines currently visible after applying filters.

## Installation From VSCode Marketplace**
Search for Embedded Device Logger (AScillato).

----

## For Developers

### Source Code
See [Source Code](https://github.com/ascillato/VSCode-Logger)

### Source Code Documentation
See [Documentation](https://ascillato.github.io/VSCode-Logger/index.html)

### Running The Extension Locally
1. Clone the repository
2. Run `npm install` to install dependencies.
3. Run `npm run compile` to build the TypeScript.
4. Press `F5` in VS Code to launch the extension development host and open the **Embedded Logger** view.

### Clean and re-compile
 `rm -rf node_modules; rm -rf out; npm install; npm run compile`

### Package Generation
Requires: `npm install -g @vscode/vsce`
Run: `vsce package` to generate vsix file to be installed into VSCode
Install locally on VSCode: `code --install-extension embedded-device-logger-0.1.0.vsix`

### Generating Source Code Documentation
1. Ensure Doxygen is available locally (`sudo apt-get install doxygen`).
2. From the repository root, run `doxygen Doxyfile` to build the documentation into `docs/html`.
3. Open `docs/html/index.html` in a browser to review the generated API reference.
