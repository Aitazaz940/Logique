# Logique

**Logique: Where Logs Make Sense.**

Logique is a lightweight, web-based application built with FastAPI to monitor and manage Docker containers. It provides a modern UI to view system stats, manage containers, and stream container logs in real-time with advanced filtering and search capabilities.

---

## 🚀 Features

### ✅ Real-Time System Monitoring
- Live updates for CPU usage, RAM, disk space, and network I/O.
- System health indicator based on resource usage.
- Uptime and load average display.

### 🐳 Container Management
- List all containers with their statuses (running/exited).
- Group containers by Docker network.
- Perform container actions: start, stop, restart, or remove.
- View resource usage for running containers (CPU, RAM, uptime).

### 📜 Log Streaming Utility
- Stream container logs in real-time.
- Filter logs by level: All, Errors, Warnings, Info, Debug (color-coded).
- Search logs with keyword filters.
- Toggle timestamps and auto-scrolling.
- Download logs for offline analysis.
- Syntax highlighting for log levels, timestamps, numbers, JSON, URLs, and IPs.

### 🎨 User-Friendly Interface
- Modern dark theme.
- Sidebar with network/container grouping.
- Responsive design with smooth transitions.
- Searchable container list with status indicators.

### ⚙️ Customizable Settings
- Toggle visibility of running or exited containers.
- Enable/disable log timestamps.
- Set refresh intervals and chart data points.
- Group containers by network.

---

## 🚧 Work in Progress

**This project is a work in progress.**

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
