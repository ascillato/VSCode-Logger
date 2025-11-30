# Embedded Device Logger

A Visual Studio Code extension that connects to embedded Linux devices over SSH, tails their logs, and displays them with filtering, colorization, presets, and export.

![Screenshot1](docs/images/screenshot_example1.png)

## Features
- Activity Bar view listing configured devices.
- **Real-time log streaming over SSH** using a configurable command (default: `tail -F /var/log/syslog`).
- **Log level parsing, filtering, and colorization** inside a Webview panel per device.
- Saved filter presets stored per device.
- **Export** currently visible (filtered) logs to a file.
- **Open any log files and filter them** with the same interface.
- SSH passwords are **stored securely** with VS Code Secret Storage.
- Privacy focused. **No telemetry**. Everything **runs locally**.
- **Built with security in mind**.

## Configuration

![Screenshot2](docs/images/screenshot_example_setup.png)

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
- Use the **Open Local Log File** title button in the Embedded Logger devices view (or run the command with the same name) to select a `.log` or `.txt` file from your machine.
- The chosen file is loaded into the log viewer so you can reuse filtering, presets, and export just like a live connection.

## Share Activity Bar with other extensions

The **Embedded Device Logger** extension supports sharing the VSCode Activity Bar with other extensions. To merge an extension into the Activity Bar, simply select its icon from the Side Bar, then drag and drop it into your desired position within the Activity Bar.

![Screenshot3](docs/images/screenshot_example2_coop.png)

In the example, the other extensions (from other publishers) are:
- `elcamilet.ssh-connect`
- `ikoamu.side-clipboard`

## Installation
* **From VSCode:** Search for Embedded Device Logger (Publisher: Scallant, Author: A. Scillato).
* **From VSCode Marketplace:** https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger

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

### Clean and re-compile
- `rm -rf node_modules; rm -rf out; npm install; npm run compile`

### Package Generation
- Requires: `npm install -g @vscode/vsce`
- Run: `vsce package` to generate vsix file to be installed into VSCode
- Install locally on VSCode: `code --install-extension embedded-device-logger-0.2.0.vsix`

### Generating Source Code Documentation
1. Ensure Doxygen is available locally (`sudo apt-get install doxygen`).
2. From the repository root, run `doxygen Doxyfile` to build the documentation into `docs/html`.
3. Open `docs/html/index.html` in a browser to review the generated API reference.
