# Embedded Device Logger

Embedded Device Logger is a Visual Studio Code extension built for Linux and embedded engineers. Connect to your devices over SSH, tail their logs, and stay in control with quick filters and highlights.

![Screenshot1](docs/images/screenshot_example1.png)

If you like the extension, please [rate it](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger&ssr=false#review-details). We welcome issue reports and feature requests.

## Highlights

- Stream device logs over SSH with real-time level parsing and colorization.
- Search, filter, bookmark, and export the exact lines you need.
- Highlight up to 10 keywords per panel to spot critical events fast.
- Run one-off SSH commands, open terminals, or browse files with the built-in SFTP explorer.
- Secure by default: passwords and key passphrases live in VS Code Secret Storage.

## Getting started

1. **Install** the extension (see below).
2. Open the **Embedded Logger** view from the Activity Bar (terminal icon).
3. Add your devices under `embeddedLogger.devices` and start streaming logs.

For the full setup and configuration reference, see the [Detailed Usage and Configuration guide](https://ascillato.github.io/VSCode-Logger/detailed-usage.html).

## Installation

- From the VS Code Extensions view, search for **Embedded Device Logger** (Publisher: Scallant).
- From Quick Open (Ctrl/Cmd+P): `ext install Scallant.embedded-device-logger`.
- From a terminal: `code --install-extension Scallant.embedded-device-logger`.

Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger) for more details.

## For developers

Want to build from source or contribute? See the [Developer Setup and Workflow](https://ascillato.github.io/VSCode-Logger/developer-guide.html) for packaging, local installs, and contribution guidelines. The project is open to pull requests—check the [CONTRIBUTING guide](https://github.com/ascillato/VSCode-Logger/blob/main/CONTRIBUTING.md) before submitting.
