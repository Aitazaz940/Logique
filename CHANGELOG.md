# Changelog

All notable changes to this project will be documented in this file.

# Changelog

## [3.0.0] - 2025-06-09

### Added
- **Completely redesigned UI:** Modern, compact, and professional look across the entire interface, including dashboard, setup and login.
- **User management:** Admins can add child users directly from the dashboard. The first user is always an admin.
- **Child user roles:** Child users can view logs and modify their own settings, but cannot control containers.
- **Real-time updates via WebSocket:** System stats and container data now update instantly without polling.
- **Stacked network logs:** View merged, timestamp-sorted logs from all containers in a network with enhanced formatting.
- **Show/hide password toggle:** Available in setup, login, and add user forms for improved UX.
- **Per-user settings:** Each user’s preferences are stored and applied independently.
- **Quick access Add User button:** Visible only to admins in the top bar.

### Changed
- **Dashboard charts:** Unified visual style, consistent layout, and improved spacing for CPU, Memory, and Network graphs.
- **Log formatting:** Enhanced for clarity, color-coded output, and improved readability in both single and stacked views.
- **Activity and error feedback:** More informative messages with clear icons for success, warning, and errors.
- **Action buttons:** Container controls are now visible only to admins.

### Fixed
- **Login/setup validation:** Clear feedback for password mismatch, incorrect credentials, and user creation errors.
- **WebSocket reconnect logic:** Improved stability and error handling for all real-time updates.
- **Dashboard alignment issues:** Resolved inconsistent chart/table spacing and sidebar order.
- **Scrollbar behavior:** Improved scrolling and overflow handling in modals and tables.

### Removed
- **Unused columns:** Removed container ID and network usage from the main dashboard for a cleaner layout.

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
