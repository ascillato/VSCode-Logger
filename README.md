# Embedded Device Logger

The Embedded Device Logger is a Visual Studio Code extension that can connect to your devices over SSH, tail their logs, and help you analyze the data with loglevel colorization, quick filters, custom keywords highlights and filtered export. It provides also an SFTP client, SSH terminals and one-off SSH commands to help you develop, debug and maintain your Linux-based devices.

- **Live logs view:**

![Live Log panel screenshot](docs/images/screenshot_example_live.png)

- **SFTP Panel view and SSH terminal:**

![SFTP panel screenshot](docs/images/screenshot_example_sftp.png)

- **Offline logs view:**

![Offline Log panel screenshot](docs/images/screenshot_example_log.png)

If you like the extension, please [rate it](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger&ssr=false#review-details). We welcome issue reports and feature requests.

## Key Features

- Stream device **logs over SSH** with real-time **log-level parsing** and **colorization**.
- **Search**, **filter**, **bookmark**, and **export** the exact lines you need.
- **Highlight** up to 10 keywords per panel to spot critical events fast.
- Run **one-off SSH commands**.
- Open **SSH terminals**.
- Open device URLs in an **external browser** or in VS Code's **embedded browser**.
- Browse files with the built-in **SFTP explorer**, including quick search and keyboard shortcuts.
- Assign **per-device colors** to make tabs and device lists easier to scan.
- **Secure by default**: passwords and key passphrases live in VS Code Secret Storage.
- **Privacy focused**. **No telemetry**. Everything **runs locally**.

## Getting started

1. **Install** the extension (see below).
2. Open the **Embedded Logger** view from the Activity Bar (terminal icon).
3. Open the configuration with the edit icon (🖍) to launch the Device Manager, add your devices in the table UI (or edit the JSON) under `embeddedLogger.devices`, and start streaming logs. The manager can also import/export the full Embedded Logger settings block as JSON for backup or sharing.

For the full setup and configuration reference, see the [Detailed Usage and Configuration guide](https://ascillato.github.io/VSCode-Logger/detailed-usage.html).

## Installation

- From the VS Code Extensions view, search for **Embedded Device Logger** (Publisher: Scallant).
- From Quick Open (Ctrl/Cmd+P): `ext install Scallant.embedded-device-logger`.
- From a terminal: `code --install-extension Scallant.embedded-device-logger`.

Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=Scallant.embedded-device-logger) for more details.

## Motivation behind the development of this VSCode Extension

When you develop, debug, or audit software for **embedded Linux devices**, logs are everything.

They tell you *what happened*, *when it happened*, and often *why it happened*.

Yet in practice, working with logs on embedded systems is still surprisingly awkward.

Most of us rely on:

- SSH into the device
- Running `tail -f`, `journalctl`, or custom scripts
- Copy-pasting outputs
- Repeating the same commands again and again

And while VS Code has become the de-facto development environment for many engineers, log inspection still lives mostly **outside** the editor.

I tried to find a VS Code extension that was:

- Fast
- Simple
- Designed for **embedded Linux**, not servers
- Capable of real-time and offline log analysis

I couldn’t find one that fully fit that workflow.

So I built it.

More about this story at [Medium Article](https://medium.com/@ascillato/debugging-embedded-linux-devices-from-vs-code-without-living-in-the-terminal-3c93d9342ab8?source=friends_link&sk=dd4fc69407ac03fd81c42f304855cdcf)

## For developers

Want to build from source or contribute? See the [Developer Setup and Workflow](https://ascillato.github.io/VSCode-Logger/developer-guide.html) for packaging, local installs, and contribution guidelines. The project is open to pull requests. Please, check the [CONTRIBUTING guide](https://ascillato.github.io/VSCode-Logger/code-development.html) and the [Code Architecture Overview](https://ascillato.github.io/VSCode-Logger/extension-overview.html) before submitting.
