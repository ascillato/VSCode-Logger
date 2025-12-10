# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

----------------------------------------

## [1.1.0] - 2025-12-09 [SFTP]

### Added
- Optional SFTP explorer panel with dual-pane remote/local navigation, per-pane file operations, and arrows to transfer selected files between remote and local (or remote-to-remote when the right pane is set to remote).
- Device-level and default settings to surface the **Open SFTP Explorer** action alongside existing SSH terminal and command options.

### Changed
- Bump extension version to 1.1.0.
- Keep the SFTP explorer open when the SSH session drops, greying out the UI, colouring the remote pane to reflect disconnect/reconnect attempts, showing a countdown beside the title, and retrying every five seconds without losing the current paths.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.0.0] - 2025-12-08 [SSH-KEYS]

### Added
- Support authenticating with SSH private keys (including passphrases) for log streaming, SSH commands, and interactive terminals.
- Expand private key paths that include `~` or `${env:VAR}` tokens for convenience.

### Changed
- Migrate legacy private key passphrases into VS Code Secret Storage alongside passwords.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- Store SSH private key passphrases securely in Secret Storage and sanitize configuration to remove inlined secrets when possible.

----------------------------------------

## [0.9.0] - 2025-12-07 [SETTINGS]

### Added
- Surface default device options (port, log command, SSH terminal toggle, and shared SSH commands) plus the max-line limit as configurable fields in the VS Code Settings UI.
- Provide JSON examples for device definitions and default SSH commands directly in the Settings descriptions.
- Add Design Overview Document.

### Changed
- Consolidate configuration resolution so default values apply consistently when loading devices and log panels.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- Migrate legacy device passwords to Secret Storage and clear plaintext values from settings when possible.
- Enforce SSH host key verification.
- Scope stored device passwords to the host, username, and workspace with confirmation prompts before reusing secrets when device metadata changes.

----------------------------------------

## [0.8.0] - 2025-12-06 [CONSOLE]

### Added
- Add Open SSH Terminal action alongside SSH commands in the Devices view when enabled, to open a dedicated terminal tab that uses stored or prompted passwords for authentication.

### Changed
- None.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [0.7.0] - 2025-12-06 [COMMANDS]

### Added
- Allow configuring optional SSH commands per device and show them as collapsible lists in the Devices view.
- Run one-off SSH commands from the Devices view and surface command output in VS Code notifications.

### Changed
- None.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [0.6.0] - 2025-12-06 [BOOKMARKS]

### Added
- Add Bookmarks to live logs and imported logs.
- Add line limit display notice to log panel.
- Highlight session closed markers in imported logs.
- Add Edit button to imported log tabs for opening files in a separated editor tab.
- Add Refresh button to imported log tabs for reloading content in case it was externally updated.

### Changed
- Surround auto-saved SSH session closed markers with blank lines to improve visibility.
- Increase log panel SSH message height to improve visibility.
- Update log message handling behavior. Messages from auto-save or from logger commands are handled in a secondary line from the connection status.
- When loglevel filter is set to ALL, do not hide blank lines and lines without a log tag.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fix spacing for word wrapped lines.

### Security
- None.

----------------------------------------

## [0.5.0] - 2025-12-03 [AUTO-AUTOSCROLL]

### Added
- Introduce `embeddedLogger.maxLinesPerTab` to configure how many log lines each tab retains (default: 100000).
- Add full-width background color to SSH session closed message for better spotting.
- Adjust auto-scroll behavior based on log panel scrolling.
- Add clear button for find textbox.
- Add auto-save option for live SSH logs.
- Update find functionality for log navigation.
- Add visual indicators for wrapped log lines.

### Changed
- None.

### Deprecated
- None.

### Removed
- Removed Port from device list view.

### Fixed
- Preserve log panel scroll during highlight updates.
- Load offline log files in a single batch to reduce tab initialization time.

### Security
- None.

----------------------------------------

## [0.4.0] - 2025-12-01 [RECONNECT]

### Added
- Add auto-scroll toggle to log panel.
- Append a marker line to the log output when an SSH session closes, including a timestamp.
- Add auto-reconnect controls to live logs.
- Update log panel frame colors depending if the SSH session is connected (green), re-connecting (yellow) or disconnected (red).
- Add Clear Logs button.

### Changed
- None.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fix sidebar device list not loading after switching views.

### Security
- None.

----------------------------------------

## [0.3.0] - 2025-11-30 [SEARCH-AND-HIGHLIGHTS]

### Added
- Add Ctrl/Cmd+F find support in the log panel, including navigation across matches in both live and imported logs.
- Add a title bar highlight button that spawns up to ten colour-coded rows for emphasizing custom keywords across live and imported logs.
- Render highlighted matches in bold, underlined text with the same colour as their corresponding search row.

### Changed
- Restructure the log panel header to accommodate the new highlight controls and preserve readability on smaller widths.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [0.2.0] - 2025-11-30 [LOG-FILES]

### Added
- Open local log files directly from the Embedded Logger view title button or command palette and reuse the existing log viewer workflow.
- Add word wrap toggle to log panel.
- Add device view title action to edit configuration.
- Add device view title action to clear stored passwords.
- Provide a default device configuration template matching the README example.

### Changed
- Default log filtering now starts at **ALL** to show every level on initial load.
- Colorize based on loglevel now accepts a wider range of log formats.
- Align Presets buttons with combo boxes.
- Improve Issues Templates for GH repository.
- Improved Readme file.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fix top bar when status plus buttons are wider than screen's width.

### Security
- Send webview initialization data securely.
- Fixed Workflow not containing GH permissions.

----------------------------------------

## [0.1.1] - 2025-11-29 [INITIAL]

### Added
- Initial publication of the extension.
