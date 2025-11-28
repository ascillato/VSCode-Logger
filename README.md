# Embedded Device Logger

A Visual Studio Code extension that connects to embedded Linux devices over SSH, tails their logs, and displays them with filtering, colorization, presets, and export.

## Features
- Activity Bar view listing configured devices.
- Real-time log streaming over SSH using a configurable command (default: `tail -F /var/log/syslog`).
- Log level parsing, filtering, and colorization inside a Webview panel per device.
- Saved filter presets stored per device.
- Export currently visible (filtered) logs to a file.
- SSH passwords are stored securely with VS Code Secret Storage; legacy plain-text passwords in settings are migrated on activation.

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
    "password": "myPassword", // optional legacy field; will be saved to secret storage
    "logCommand": "tail -F /var/log/syslog"
  }
]
```

The `password` field is only read to migrate the value into secret storage. If no secret is stored yet, the extension prompts for a password when connecting and saves it securely.

## Running
1. Run `npm install` to install dependencies.
2. Run `npm run compile` to build the TypeScript.
3. Press `F5` in VS Code to launch the extension development host and open the **Embedded Logger** view.

## Generating documentation
1. Ensure Doxygen is available locally (`sudo apt-get install doxygen`).
2. From the repository root, run `doxygen Doxyfile` to build the documentation into `docs/html`.
3. Open `docs/html/index.html` in a browser to review the generated API reference.

## Notes
- Presets are stored per-device in the workspace state using the key `embeddedLogger.presets.<deviceId>`.
- Exports only include log lines currently visible after applying filters.
