# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2025-05-28
### Added
- Stacked logs: Show logs from all containers in a network, merged and sorted by timestamp.
- Click on the number of containers in a stack to view the stacked logs.
- Human-readable timestamps and improved log formatting for both stacked and individual container logs.
- Settings option to select preferred load average period (1 min, 5 min, 15 min or all).
- Disk usage (used/total) and all load averages (1/5/15 min) now shown in System Health.
- Auto-scroll to bottom for logs (newest logs visible first).
- UI enhancements, including sidebar improvements.
- Container names now scroll on hover if too long.

### Fixed
- System Health now accurately reflects status based on disk, memory, CPU, and load averages.
- Settings are now persistent and applied immediately after changes.
- Reduced sidebar spacing for a more compact look.
- Actions column and headings alignment improved in Container Overview.
- Sidebar container/network order no longer jumps after refresh.

### Changed
- Load average is now represented as an object with 1min, 5min, and 15min keys.
- Enhanced error handling for missing or unavailable system statistics.
- Improved sorting logic in the sidebar and data tables.
- Removed container ID and network usage columns from the main screen for a cleaner UI.
