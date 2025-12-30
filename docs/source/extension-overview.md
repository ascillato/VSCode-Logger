# VSCode-Logger Architecture Overview

This document explains how the VSCode-Logger extension streams logs from embedded Linux devices into Visual Studio Code. It covers the activation lifecycle, major components, data flows between the extension host and the Webview, and key configuration or security considerations.

## Activation and configuration
- **Activation trigger**: The extension activates when VS Code loads the workspace or when a contributed command or view is invoked.
- **Configuration resolution**: Devices come from `embeddedLogger.devices` and are enriched with defaults from `embeddedLogger.defaultPort`, `embeddedLogger.defaultLogCommand`, `embeddedLogger.defaultEnableSshTerminal`, `embeddedLogger.defaultEnableSftpExplorer`, and `embeddedLogger.defaultSshCommands`. The max in-memory log history per tab comes from `embeddedLogger.maxLinesPerTab`.
- **Password migration**: During activation, legacy plaintext passwords from settings are migrated into VS Code Secret Storage so future connections prompt the user instead of persisting raw secrets in configuration.
- **View and command registration**: Activation registers the devices sidebar Webview, highlight-row commands, device-level SSH command/terminal handlers, and `embeddedLogger.openDevice` so selecting a device item opens its log panel or launches auxiliary actions.

## Major components
- **Configuration helpers (`src/configuration.ts`)**: Centralizes reading extension settings and applying default SSH port, log command, terminal enablement, and shared SSH commands to each device, while surfacing the max-lines limit.
- **Sidebar view (`src/sidebarView.ts` + `media/sidebarView.*`)**: Renders devices and highlight rows in a Webview. Users can open devices, run per-device SSH commands, open a dedicated SSH terminal when enabled, or manage highlight definitions that synchronize across log panels.
- **Device tree (`src/deviceTree.ts`)**: Supplies device metadata to the sidebar view and tree interactions.
- **Log panel (`src/logPanel.ts`)**: Creates a Webview panel per remote or local log source, injects assets, and wires callbacks for presets, exports, highlights, bookmarks, find/highlight rows, and status updates. It owns a `LogSession` for remote devices.
- **`LogSession` (`src/logSession.ts`)**: Manages the SSH connection to a device, pulls credentials from secret storage or prompts the user, runs the log command, and forwards complete lines to the panel callbacks. It reports status changes and errors back to the Webview so the UI can react.
- **SSH helpers (`src/sshCommandRunner.ts`, `src/sshTerminal.ts`)**: Execute one-off SSH commands from the sidebar or spawn an interactive SSH terminal using stored or prompted credentials.
- **Webview clients (`media/loggerPanel.js` + `media/loggerPanel.css`)**: Receive log lines, parse severity, apply filters, manage presets and bookmarks, enforce the max-lines cap, and render the terminal-like UI. They can request preset persistence, deletion, exports, bookmark toggles, and highlight updates via `postMessage` events.

## Data and control flow

```mermaid
:zoom: 100%
graph TD
    A[Extension activation] --> B[getEmbeddedLoggerConfiguration]
    B --> C[Register sidebar view & commands]
    C --> D[Sidebar renders devices, highlights, SSH commands]
    D -- Open device --> E[embeddedLogger.openDevice]
    D -- Run SSH command --> M[SshCommandRunner executes via ssh2]
    D -- Open SSH terminal --> N[Create terminal using SshTerminalSession]
    E --> F["Create LogPanel (remote or local)"]
    F --> G["Start LogSession for remote devices"]
    G --> H[Fetch credentials from Secret Storage or prompt]
    H --> I[Run logCommand via ssh2]
    I --> J[Stream stdout/stderr data]
    J --> K[Parse lines, levels, highlights, bookmarks in loggerPanel.js]
    K --> L[Apply filters, presets, max-line cap, and formatting]
    L --> O[Render log entries and statuses in Webview]
    O -- Export/preset/bookmark requests --> P[Extension persists workspace state or writes file]
    F -- Status updates --> O
```

## Lifecycle details
1. **Panel creation**: Each device or imported log opens in its own Webview panel. Existing panels re-activate instead of spawning duplicates when the same source is selected again.
2. **Session management**: `LogSession` tracks connection lifecycle events (connecting, streaming, disconnecting, error) and disposes of SSH resources when panels close or the extension deactivates.
3. **Back-pressure handling**: Incoming data is buffered until complete lines are available to avoid splitting log entries mid-line.
4. **Presets, filters, and bookmarks**: Presets are stored per device in workspace state keyed by device ID. Bookmark toggles, auto-save, highlight rows, find navigation, and colour-coded level filtering live in the Webview state so they restore when a panel gains focus.
5. **Exports**: The Webview requests exports for only the currently visible (filtered) lines. The extension host asks the user for a destination path and writes the collected text.
6. **Configuration changes**: When any `embeddedLogger` setting changes, the sidebar refreshes device metadata (including defaults). Active panels continue streaming with their existing session until closed.
7. **Security**: Password prompts rely on VS Code’s secure input. Secrets are never written to the Webview or logs; they remain in secret storage or transient prompts. SSH sessions close on disposal to avoid leaving hanging connections.

## How to extend safely
- Keep UI logic inside the Webview scripts and backend logic in the extension host files.
- When adding device fields, update `EmbeddedDevice` and the contributed configuration schema so the tree view and Webview receive consistent data.
- If altering log parsing or styling, adjust both `loggerPanel.js` and `loggerPanel.css` to ensure new levels or formats render correctly.
- Preserve default behaviours (e.g., default log command, maximum retained lines) unless there is a clear reason to change them, and document new settings.

## Security Overview

### Strengths
- Workspace trust gating prevents connections in untrusted workspaces before prompting for credentials. The log command is trimmed and checked for control characters to avoid obvious injection via newlines.
- Secrets are stored in VS Code Secret Storage after prompting users, keeping interactive credentials off disk by default.
- Webview UIs render log lines using `textContent` with a restrictive Content-Security-Policy that disallows remote scripts and limits styles to extension resources.
- Webview CSPs block external scripts and restrict styles to bundled assets, reducing XSS risk. Log lines are inserted as text nodes, preventing HTML injection from streamed content.
- Auto-reconnect logic includes visible status updates and timers

------------------------------------------------------------------------

# Code Quality Review

## Overview

VSCode‑Logger is a Visual Studio Code extension designed to stream logs
from embedded Linux devices over SSH, providing filtering, highlighting,
bookmarking, search, and optional SSH command execution.

This review evaluates the codebase in terms of architecture,
maintainability, security, performance, and UI implementation.

------------------------------------------------------------------------

## Architecture Review

### Strengths

-   **Clear modular structure**: Components such as `logSession`,
    `logPanel`, `sshCommandRunner`, `sshTerminal`, and the device
    tree/side panel are well separated.
-   **Good use of VS Code APIs**: Webview messaging, pseudoterminals,
    secrets API, configuration API, etc.
-   **Consistent TypeScript typings** across modules.

### Areas for Improvement

-   **Centralized error-handling strategy** could improve reliability.
-   **Refactor large modules** (e.g., `loggerPanel.js` and
    `sidebarView.js`) into smaller logical chunks.

------------------------------------------------------------------------

## Performance Review

### Strengths

-   Efficient incremental rendering of logs.
-   Avoids expensive DOM operations by batching messages.

### Bottlenecks & Opportunities

-   Large logs may exceed DOM performance limits --- consider
    **virtualized lists**.
-   Syntax highlighting and dynamic search could benefit from **Web
    Workers**.

------------------------------------------------------------------------

## Maintainability Review

### Strengths

-   Good organization and naming conventions.
-   Clear TypeDoc comments on most functions.

------------------------------------------------------------------------

## UI/UX Review

### Strengths

-   Clean interface.
-   Highlight palette and bookmarks improve usability.
-   Responsive layout.

### Improvements

-   Make search controls collapsible.

------------------------------------------------------------------------

## Security Review

The **VSCode‑Logger** extension streams logs from remote embedded devices via SSH. It provides a webview panel for real‑time log viewing, filtering and highlighting, and exposes commands to run one‑off SSH commands or open an interactive terminal. Because it handles credentials and executes remote commands, security is critical. This review evaluates the repository’s security posture, highlighting strengths and potential weaknesses.

### Strengths

-   Uses **VS Code Secrets API** for storing passwords and passphrases
    securely.
-   Sanitizes SSH commands to avoid injection risks.
-   Enforces workspace trust before connecting to devices.

### Workspace trust and configuration validation

* **Workspace trust gating.** Both the one‑off command runner and the log session check `vscode.workspace.isTrusted` before connecting or executing commands. This ensures that the extension only performs SSH operations in trusted workspaces.
* **Device configuration validation.** The command runner and log session validate the device’s `host`, `username` and `port` before attempting a connection. Invalid entries result in descriptive errors.
* **Sanitization of newlines.** `sanitizeCommand` disallows control characters or newlines in user‑supplied commands, and the log session’s `getLogCommand` does the same. This prevents multi‑line payloads that could lead to injection attacks.

### Secure SSH handling

* **Host‑key verification and fingerprint capture.** When establishing an SSH connection, the session uses `hostHash: 'sha256'` and a `hostVerifier` that computes the server’s fingerprint and compares it against the stored fingerprint. If the fingerprint does not match, the session throws a `HostKeyMismatchError` and prompts the user to update or reject the new fingerprint. Unknown fingerprints can be persisted only after user confirmation.
* **Authentication management.** Passwords, passphrases and private keys are retrieved from a secure secret store. `PasswordManager` stores secrets using a key derived from the hashed device host and username and the workspace ID. Secrets are not persisted in code or configuration, and metadata is stored separately to support reuse across workspaces. If a secret is reused from another workspace or a legacy key, the manager prompts the user for confirmation.
* **Session lifecycle management.** The log session disposes SSH resources in a `dispose()` method and ensures that stream closures trigger UI notifications. Auto‑save streams are closed gracefully and error conditions are propagated back to the UI.

### Webview security

* **Content‑Security‑Policy (CSP).** The webviews for both the log panel and sidebar set a strict CSP: `default-src 'none'`, `script-src 'nonce‑…'` and `style-src` limited to the extension’s own origin. No external scripts or inline scripts are allowed. The script tag includes a random nonce generated with `getNonce()` to prevent injection attacks.
* **Safe HTML rendering.** Log lines and user‑supplied highlight keys are inserted into the DOM using `createTextNode` or by setting `textContent`. Highlight markers are built by splitting text and wrapping matches in `<span>` elements, never via `innerHTML`. This design avoids cross‑site scripting (XSS) even when log lines contain HTML or markup.
* **User interaction isolation.** The sidebar view uses a nonce‑restricted script and a strict CSP. Inputs for highlight keywords are treated purely as text and not executed, and highlight colours come from a fixed palette, preventing CSS injection.

### Logging and file operations

* **Controlled file access.** When exporting logs or starting auto‑save, the extension prompts the user via `showSaveDialog` to pick a destination file. It writes logs using VS Code’s `workspace.fs.writeFile` or Node’s `fs.createWriteStream`, and errors are reported to the webview.
* **Line limit enforcement.** The log panel enforces a maximum number of log entries (100 000 by default) to prevent excessive memory consumption and DOM size. When the limit is reached, older entries are discarded and the user is notified.

------------------------------------------------------------------------

## Security Concerns and Recommendations

While the extension follows many best practices, several areas could be improved to reduce attack surface and harden the codebase:

### Incomplete command sanitization

`SshCommandRunner.sanitizeCommand()` trims the command and only forbids newlines. It does **not** restrict other shell metacharacters such as semicolons (`;`), pipes (`|`), backticks or `$(…)`. This means that a misconfigured `embeddedLogger.sshCommands` entry could execute arbitrary shell commands on the device. Likewise, `LogSession.getLogCommand()` trusts the `logCommand` from configuration with only newline stripping.

* **Recommendation:** restrict allowed command patterns. Accept only a whitelist of pre‑defined commands or simple program names with arguments. Alternatively, validate against a regular expression that forbids dangerous metacharacters and shell expansions. For advanced use cases, provide explicit warnings that commands are executed verbatim and may be dangerous.

### Limited host‑key algorithm restrictions

The SSH client sets `hostHash: 'sha256'` but relies on the default key algorithms of `ssh2`. While host‑key verification is performed, other SSH security settings (cipher suites, MACs, key‑exchange algorithms) are not configured. Attackers with downgrade capabilities could negotiate weak algorithms.

* **Recommendation:** explicitly set strong algorithms when creating the SSH client, such as `kexAlgorithms`, `cipher`, `serverHostKey` and `hmac` lists. Encourage the use of modern algorithms (e.g., `diffie‑hellman‑group-exchange-sha256`, `chacha20-poly1305@openssh.com`).

### Potential for unauthorized credential reuse

`PasswordManager.tryReuseStoredSecret()` prompts the user before reusing a secret saved for another workspace, host or username. However, there is no expiration or rotation of stored credentials. If a secret is compromised, it may remain accessible indefinitely.

* **Recommendation:** add an optional expiration or a command to manage and delete stored credentials. Provide an option to save secrets per session only.

### Outbound connection transparency

The extension opens an SSH connection and executes commands, but there is no user confirmation when the connection is initiated. Malicious `embeddedLogger.devices` entries could exfiltrate data.

* **Recommendation:** display a confirmation prompt when connecting to a new device or running a custom SSH command, listing the host, port and command to be executed.

### Minor webview considerations

* **Message origin verification.** The webview’s `onDidReceiveMessage` handlers check that `message.type` is a string but do not verify that the message originates from the extension’s own script. Although VS Code webviews isolate messages, adding an origin check (e.g., verifying a secret token) would further harden against spoofing.
* **Highlight colour validation.** Highlight colours are pre‑defined, but future extensions allowing user‑selected colours should validate CSS values to prevent arbitrary injection into style attributes.

### Dependency and supply‑chain considerations

* **Keep dependencies up‑to‑date.** The extension depends on the `ssh2` library. Ensure that this dependency is regularly updated to receive security patches. Run `npm audit` and fix vulnerabilities.
* **Binary file handling.** The extension streams logs as UTF‑8 text. If a log contains binary data or untrusted escape sequences, the UI could behave unexpectedly. Consider encoding binary output or filtering control characters.

## Conclusion

The VSCode‑Logger extension demonstrates strong security practices: it enforces workspace trust, validates configuration, uses secure secret storage, verifies SSH host keys and implements strict webview CSPs. Its UI avoids XSS by using text nodes and nonces. However, it currently trusts arbitrary commands in configuration, has limited SSH algorithm hardening and lacks expiration for stored credentials. By restricting command inputs, enhancing SSH settings, offering credential management and adding connection confirmations, the extension can further reduce risks while maintaining its powerful logging features.
