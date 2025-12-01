# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

----------------------------------------

## [0.4.0] - 2025-12-01 [SEARCH]

### Added
- Add Ctrl/Cmd+F find support in the log panel, including navigation across matches in both live and imported logs.

### Changed
- None

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None

----------------------------------------

## [0.3.0] - 2025-11-30 [HIGHLIGHTS]

### Added
- Add a title bar highlight button that spawns up to ten colour-coded rows for emphasizing custom keywords across live and imported logs.
- Render highlighted matches in bold, underlined text with the same colour as their corresponding search row.

### Changed
- Restructure the log panel header to accommodate the new highlight controls and preserve readability on smaller widths.

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None

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
- None

### Removed
- None

### Fixed
- Fix top bar when status plus buttons are wider than screen's width.

### Security
- Send webview initialization data securely.
- Fixed Workflow not containing GH permissions.

----------------------------------------

## [0.1.1] - 2025-11-29 [INITIAL]

### Added
- Initial publication of the extension

### Changed
- None

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None
