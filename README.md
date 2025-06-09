# Logique

**Logique: Where Logs Make Sense.**

Logique is a lightweight, web-based application built with FastAPI to monitor and manage Docker containers. It provides a modern UI to view system stats, manage containers, and stream container logs in real-time with advanced filtering and search capabilities.

---

## 🚀 Features

### ✅ Real-Time System Monitoring
- Instant updates for CPU usage, RAM, disk space, and network I/O.
- System health indicator based on resource usage.
- Uptime and load average display (1m, 5m, 15m).
- Per-user system settings and preferences.

### 🐳 Container & Network Management
- List all containers with their statuses (running/exited).
- Group containers by Docker network.
- Perform container actions: start, stop, restart, or remove (admin only).
- View resource usage for running containers (CPU, RAM, uptime).
- Stacked network logs: view merged logs from all containers in a network, sorted by timestamp.

### 📜 Log Streaming Utility
- Stream logs in near real-time with minimal latency.
- Filter logs by level: All, Errors, Warnings, Info, Debug (color-coded).
- Search logs with keyword filters.
- Download logs for offline analysis.

### 👥 Multi-User Support
- Admin and child user roles.
- Admins can add child users directly from the dashboard.
- Child users can view logs and change their own settings, but cannot manage containers.
- Per-user settings stored and applied independently.
- Role-based UI and access restrictions (frontend + backend enforced).

### 🎨 User-Friendly Interface
- Completely redesigned modern UI (v3.0.0): compact, responsive, and professional look.
- Sidebar with network/container grouping.
- Quick access "Add User" button for admins.
- Consistent charts, activity feedback with clear status icons.

### ⚙️ Customizable Settings
- Toggle visibility of running or exited containers.
- Enable/disable log timestamps.
- Set refresh intervals and chart data points.
- Select preferred load average period (1, 5, 15 min).
- Customize display and grouping by network.

---

## 🚧 Work in Progress

**This project is a work in progress.** Feedback and contributions are welcome!

---

## 🛠️ Prerequisites

Make sure you have the following installed:

- **Docker** (for containerized deployment)
- **Python 3.11** (for local development)
- **pip** (Python package manager)

---

## 🔧 Installation

**Run with Docker:**
```bash
sudo docker run --restart unless-stopped --name Logique -d -p 9075:8000 \
   -v /var/run/docker.sock:/var/run/docker.sock \
   aitazaz91/logique:latest
```
