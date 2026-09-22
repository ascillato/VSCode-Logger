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
- Run **one-off SSH commands** and optionally upload a script to `/tmp`, `chmod 777` it, and execute it after the command.
- Open **SSH terminals**, including command panels that can optionally re-run after reconnecting and run uploaded scripts.
- Open device URLs in an **external browser** or in VS Code's **embedded browser**.
- Optionally **ping all configured devices**, with manual or scheduled checks and reachability dots in the Devices view.
- Browse files with the built-in **SFTP explorer**, including quick search, `find`/`grep` result views, and keyboard shortcuts.
- Assign **per-device colors** to make tabs and device lists easier to scan.
- Organize devices with **collapsible groups** in the Embedded Devices view.
- Choose the extension UI language from **English**, **Spanish**, **Italian**, **Simplified Chinese**, **Traditional Chinese**, **French**, **German**, **Japanese**, **Korean**, **Russian**, **Portuguese (Brazil)**, **Turkish**, **Polish**, **Czech**, or **Hungarian**, following VS Code's display language by default and falling back to English for missing strings.
- **Secure by default**: passwords and key passphrases live in VS Code Secret Storage.
- **Privacy focused**. **No telemetry**. Everything **runs locally**.

## Getting started

1. **Install** the extension (see below).
2. Open the **Embedded Logger** view from the Activity Bar (terminal icon).
3. Open the configuration with the edit icon (🖍) to launch the Device Manager, add your devices and start streaming logs.

For the full setup and configuration reference, see the [Detailed Usage and Configuration guide](https://ascillato.github.io/VSCode-Logger/detailed-usage.html).

## Installation

- From the VS Code Extensions view, search for **Embedded Device Logger** (Publisher: Scallant),
- or from Quick Open (Ctrl/Cmd+P): `ext install Scallant.embedded-device-logger`,
- or from a terminal: `code --install-extension Scallant.embedded-device-logger`.

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

Want to build from source or contribute? `npm run compile` now type-checks the extension and bundles the extension host into `out/extension.js`, while `npm run watch` keeps that bundled output up to date during development. See the [Developer Setup and Workflow](https://ascillato.github.io/VSCode-Logger/developer-guide.html) for packaging, local installs, and contribution guidelines. The project is open to pull requests. Please, check the [CONTRIBUTING guide](https://ascillato.github.io/VSCode-Logger/code-development.html) and the [Code Architecture Overview](https://ascillato.github.io/VSCode-Logger/extension-overview.html) before submitting.

## AI / MCP integration

Embedded Device Logger includes a disabled-by-default local MCP server for coding and debugging agents. It uses MCP Streamable HTTP at `http://127.0.0.1:39070/mcp` because an external client can attach to the running extension, which owns device authentication. The port is configurable, but the server always binds to `127.0.0.1`; there is no LAN bind setting.

> **MCP clients do not receive device SSH credentials. Device authentication remains managed by Embedded Device Logger and its existing secure credential storage.**
>
> **MCP does not provide arbitrary remote shell access. Device-changing operations are limited to existing custom commands explicitly authorized by the user for MCP access.**

### Configuration and connection

Use **Embedded Logger: Enable MCP Server**, **Disable MCP Server**, **Show MCP Status**, **Show MCP Connection Configuration**, and **Show MCP Task Logs**. The configuration command displays and copies this client configuration:

```json
{"servers":{"embeddedLogger":{"type":"http","url":"http://127.0.0.1:39070/mcp"}}}
```

| Setting | Secure default | Meaning |
| --- | --- | --- |
| `embeddedLogger.mcp.enabled` | `false` | Enable the local endpoint. |
| `embeddedLogger.mcp.port` | `39070` | Loopback port. |
| `embeddedLogger.mcp.redactSensitiveData` | `true` | Redact common credentials, tokens, authorization headers, and URL secrets. |
| `embeddedLogger.mcp.allowCustomCommands` | `false` | Globally permit individually authorized commands. |

### Capabilities and security

Log/data tools are `list_devices`, `get_device_status`, `get_recent_logs`, `search_logs`, `get_logs_around`, and `list_log_sources`. They read immutable, bounded snapshots without modifying UI filters. Diagnostic tools are `get_system_info`, `get_service_status`, `get_service_logs`, `get_processes`, `get_disk_usage`, `get_memory_info`, `get_network_info`, and `get_device_uptime`. They use predetermined, read-only Linux commands through the extension's existing SSH/authentication infrastructure; validated parameters cannot supply shell syntax. Devices must already have an active connected log panel.

Authorized-action tools are `list_custom_commands` and `run_custom_command`. Enable `embeddedLogger.mcp.allowCustomCommands` and the command's **Allow MCP** checkbox. Existing commands default to denied. `mcpConfirmation` defaults to `always`, causing a modal VS Code confirmation; dismissal denies execution. The agent receives an opaque command ID and name, never its shell text, and cannot provide arguments, environment, working directory, hosts, or credentials.

All MCP output and safe errors pass through centralized redaction and size limits; original UI/saved logs are unchanged. Requests, logs, searches, journal lines, diagnostic execution time, and outputs are bounded. Secret Storage is not reachable. Device metadata omits hosts, usernames, key paths, fingerprints, passwords, passphrases, and bastions. Custom actions write metadata-only audit events (timestamp, device, command, success, duration) to the MCP Output Channel without stdout/stderr or secrets. The listener and sockets are unreferenced so MCP cannot keep VS Code alive.

Current limitations: live MCP history starts when a remote log panel collects lines; imported offline files remain UI-only. Diagnostics require common Linux utilities such as systemd/journalctl, `ip`, `ss`, and `/proc`. Diagnostic execution reuses the existing bounded SSH command runner rather than exposing the underlying connection or credentials.
