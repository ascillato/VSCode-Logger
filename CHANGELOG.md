# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

----------------------------------------

## [1.8.1] - 2026-03-26 [EXPORT-CONFIG]

### Added
- Save SFTP presets globally.

### Changed
- None.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- Updated dependencies to latest.

----------------------------------------

## [1.8.0] - 2026-03-20 [EMBEDDED-BROWSER]

### Added
- Added per-device and global settings for an embedded web browser action in the Devices view.
- Added an `Open Embedded Web Browser` command that opens device URLs inside VS Code.

### Changed
- Renamed the Device Manager `Web` column to `External Web Browser`.
- Renamed the sidebar browser action label to `Open External Web Browser`.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- Updated dependencies to latest.

----------------------------------------

## [1.7.5] - 2026-03-01 [DEVICE-ORDER]

### Added
- Added reorder control to device list.

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

## [1.7.4] - 2026-02-28 [DEP-UPDT-2]

### Added
- Add per-device "Reset password" action in the Device Manager table.

### Changed
- Updated dependencies to latest.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.7.3] - 2026-01-20 [DEP-UPDT-1]

### Added
- None.

### Changed
- Updated dependencies to latest.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.7.2] - 2026-01-20 [RECONNECT-FIX]

### Added
- Added tests for auto-reconnection functions.
- Docs: Added Code Complexity Reports to Code Metrics page.

### Changed
- None.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fixed log panel auto-reconnection.

### Security
- None.

----------------------------------------

## [1.7.1] - 2026-01-17 [SFTP-KEYS-NAV]

### Added
- None.

### Changed
- Add left/right arrow navigation to switch focus between SFTP panes.

### Deprecated
- None.

### Removed
- Remove the Ctrl+P shortcut for SFTP permission edits.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.7.0] - 2026-01-17 [SFTP-QUICK-SEARCH]

### Added
- Add quick search to SFTP explorer panes.
- Add keys support to SFTP explorer panes to navigate and perform actions over files and directories.
- Add edit SFTP path presets from settings page.
- Add customizable identification color for all tabs of a device.
- Add e2e tests for SFTP UI.
- Add Clean Tests to makefile and to code-workspace (VSCode UI - bottom bar).

### Changed
- Updated developer-guide.md with URL of repository template.
- Bump @types/node from 22.19.3 to 25.0.9
- Bump typescript from 5.8.3 to 5.9.3
- Bump typedoc from 0.27.9 to 0.28.15
- Bump vitest from 4.0.16 to 4.0.17
- Bump coverage-v8 to 4.0.17
- Bump @types/vscode from 1.107.0 to 1.108.1
- Bump @typescript-eslint/eslint-plugin from 8.51.0 to 8.53.0
- Bump @typescript-eslint/parser from 8.51.0 to 8.53.0
- Updated code-workspace file to include node path.

### Deprecated
- None.

### Removed
- Remove from CI unneeded concurrency check for build docs.

### Fixed
- Make docs build to have access to test report.
- Fix log panel disconnection issue.
- Fix use default settings unless an override exists for a particular device.
- Fix makefile to use constants for colors.

### Security
- Enable npm version updates in dependabot configuration.

----------------------------------------

## [1.6.0] - 2026-01-03 [SETTINGS-UI]

### Added
- Add unit and integration tests for logging components.
- Add Device Manager UI for devices settings.
- Add spelling check to linter.
- Add spelling check for docs.

### Changed
- Refactor LogSession and LogPanel modules for testability.
- Updated Docs with Refactor changes.
- Sanitize log lines before rendering.
- Change Filter Preset to dropdown button.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fix Highlights pop-up position on small screens.

### Security
- None.

----------------------------------------

## [1.5.1] - 2026-01-02 [DOCS]

### Added
- Add coverage reporting to tests and surface metrics in docs.
- Add git branches typical usage for this project in dev docs.

### Changed
- Consolidate e2e tests under unified tests directory.
- Improved Architecture Overview doc.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.5.0] - 2025-12-31 [QA]

### Added
- Add unit test suite with mocks and integrations.
- Add documentation for automated testing.
- Add Code Overview Section in Architecture Document.
- Add Code Line Count Report to documentation build.

### Changed
- Updated dependencies to fix deprecations.
- Updated documentation and images.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.4.9] - 2025-12-30 [SFTP-MORE-IMPROVEMENTS]

### Added
- Add view file content option to the right of the SFTP panel.

### Changed
- Review and updated documentation.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Linter Checks.
- Fix exit command behavior in SSH terminal.
- Clear text filter on no preset select on log panel.
- Fix disconnect button state after detaching on log panel.

### Security
- None.

----------------------------------------

## [1.4.8] - 2025-12-28 [LOG-PANEL-RESTYLE]

### Added
- Live log status context menu option to restore the default connected message.
- Add extension version to documentation.
- Update contribution note about repository branches usage.

### Changed
- Restyle Log Panel toolbar.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Ensure reconnects retry secondary host.

### Security
- None.

----------------------------------------

## [1.4.7] - 2025-12-26 [SFTP-RESTYLE]

### Added
- Log build result in `make <option>`.

### Changed
- Refactor README and update documentation structure.
- Restyle SFTP explorer toolbar.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.4.5] - 2025-12-23 [DETACH-SUPPORT]

### Added
- Persist log panel state across detaches.
- Ensure detached SFTP panels restore presets.

### Changed
- None.

### Deprecated
- None.

### Removed
- Removed unnecessary files from extension package.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.4.3] - 2025-12-22 [SFTP-IMPROVEMENTS]

### Added
- Show SFTP presets in dropdown menu.
- Docs: Added function descriptions.
- Auto-deploy to VSCode marketplace when a release tag is generated.

### Changed
- None.

### Deprecated
- None.

### Removed
- Removed unnecessary files from extension package.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.4.1] - 2025-12-21 [SFTP-MORE-PRESETS]

### Added
- Add SFTP presets to the right panel.
- Add code-workspace file with optional config for buttons for several compile tasks for VSCode UI.

### Changed
- Changed `make` and `make all` to not compile docs by default but install the extension instead. See `make help` for all possible commands.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.4.0] - 2025-12-21 [INDEPENDENT-HIGHLIGHTING]

### Added
- Add a Highlight popup to both live and imported log panels for managing keyword highlights directly in the viewer.
- Add SFTP path presets UI and per-device persistence.

### Changed
- Store highlight keywords per log panel instead of sharing them across the Devices view.

### Deprecated
- None.

### Removed
- Remove the highlight action from the Devices view title bar.

### Fixed
- None.

### Security
- None.

----------------------------------------

## [1.3.0] - 2025-12-20 [TERMINAL-RECONNECT]

### Added
- Keep SSH terminals open when connections drop and automatically retry every five seconds with an in-terminal reconnect notice.
- Allow multiple SFTP instances.
- Add context menu to copy device details on devices view.
- Add `embeddedLogger.defaultEnableWebBrowser` default setting for the per-device web browser action.
- Add Makefile for packaging and docs generation.
- Show waiting status during password prompts.
- Add CI checks.
- Add Local Linter checks.

### Changed
- Migrated documentation system and publishing workflow to Sphinx + TypeDoc + Mermaid.

### Deprecated
- None.

### Removed
- None.

### Fixed
- Fix context menu rendering in log panel.
- Prompt user before overwriting existing files during SFTP copy operations instead of failing immediately.
- Carry source permissions through copies, uploads, downloads, and duplicates for files and directories during SFTP.

### Security
- None.

----------------------------------------

## [1.2.0] - 2025-12-15 [BASTION]

### Added
- (Experimental) Allow devices to tunnel log streaming, terminals, and one-off SSH commands through an optional bastion host with its own credentials and host key pinning.
- Optional **Open WEB Browser** button on device cards that launches the configured URL in the system browser, defaulting to `http://<host>` when no `webBrowserUrl` is set.
- New per-device settings `enableWebBrowser` and `webBrowserUrl` to control and customize the browser action.

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

## [1.1.0] - 2025-12-11 [SFTP]

### Added
- Optional SFTP explorer panel with dual-pane remote/local navigation, per-pane file operations, and arrows to transfer selected files between remote and local (or remote-to-remote when the right pane is set to remote).
- Device-level and default settings to surface the **Open SFTP Explorer** action alongside existing SSH terminal and command options.
- Add secondary host fallback support.

### Changed
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
