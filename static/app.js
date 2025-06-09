// Performance optimizations and state management
let activitiesSeen = true
let unreadActivities = 0
let isLoading = false
let currentContainerLogs = null
const logRefreshInterval = null
let lastHighlightTime = 0;
const HIGHLIGHT_COOLDOWN_MS = 5000; // 5 seconds cooldown
let statsLoaded = false;
let containersLoaded = false;
let currentWsLogs = null;
let wsSystem = null;
let wsContainers = null;
let wsLogs = null;

function connectSystemWebSocket() {
  if (wsSystem) wsSystem.close();

  wsSystem = new WebSocket(
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws/system"
  );

  wsSystem.onopen = function () {
    const refreshInterval = settings.refreshInterval || 10; // Default to 10 seconds
    wsSystem.send(JSON.stringify({ refresh_interval: refreshInterval }));
  };

  wsSystem.onmessage = function (event) {
    const data = JSON.parse(event.data);
    if (data.system_stats) {
      updateSystemStatsRealtime(data.system_stats);
      statsLoaded = true;
    }
    if (data.containers) {
      updateContainersRealtime(data.containers);
      containersLoaded = true;
    }
    if (data.networks) {
      networksData = data.networks; // Update global networksData
      if (settings.groupByNetwork) {
        updateNetworkSidebar(networksData);
      }
    }
    // Hide loading overlay only after both are loaded
    if (statsLoaded && containersLoaded) {
      hideLoading();
    }
  };
}

function connectContainersWebSocket() {
  if (wsContainers) wsContainers.close();

  wsContainers = new WebSocket(
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws/containers"
  );

  wsContainers.onmessage = function (event) {
    const data = JSON.parse(event.data);
    if (data.containers) {
      updateContainersRealtime(data.containers);
      containersLoaded = true;
      // Hide loading if both stats and containers are loaded
      if (statsLoaded && containersLoaded) hideLoading();
    }
  };

  wsContainers.onclose = function () {
    // Optionally: try to reconnect after a delay
    setTimeout(connectContainersWebSocket, 3000);
  };
}

function updateSystemStatsRealtime(stats) {
  if (isLoading) return;

  try {
    // Use the stats object directly (do NOT parse JSON again)
    const memUsage = stats.memory?.used_percent || 0;
    const diskUsed = stats.disk?.used_gb || 0;
    const diskTotal = stats.disk?.total_gb || 1;
    const diskPercent = stats.disk?.used_percent || 0;
    const loadAvg = stats.load_average || {};

    // Update CPU Usage
    const cpuUsage = document.getElementById("cpu-usage");
    const cpuExtra = document.getElementById("cpu-extra");
    if (cpuUsage) {
      const cpuVal = Number(stats.cpu_usage_percent || 0);
      cpuUsage.textContent = `${cpuVal.toFixed(1)} %`;
      setUsageColor(cpuUsage, cpuVal);
    }
    if (cpuExtra) cpuExtra.textContent = `${stats.cpu_cores || 1}`;

    if (cpuChart) cpuChart.update(stats.cpu_usage_percent || 0);

    // Update Memory
    const memoryUsage = document.getElementById("memory-usage");
    const memoryExtra = document.getElementById("memory-extra");
    if (memoryUsage) {
      const memVal = Number(stats.memory?.used_percent?.toFixed(1) || 0);
      memoryUsage.textContent = `${memVal} %`;
      setUsageColor(memoryUsage, memVal);
    }
    if (memoryExtra) {
      const used = stats.memory?.used_memory || 0;
      const total = stats.memory?.total_gb || 0;
      memoryExtra.textContent = `${used.toFixed(1)} / ${total.toFixed(1)} GB`;
    }
    if (memoryChart) memoryChart.update(memUsage);

    // Update Network
    const networkIn = stats.network?.bytes_recv || 0;
    const networkOut = stats.network?.bytes_sent || 0;
    document.getElementById("network-in").textContent = formatBytes(networkIn) + "/s";
    document.getElementById("network-out").textContent = formatBytes(networkOut) + "/s";

    if (networkChart) networkChart.update(networkIn + networkOut);

    // Update system health
    const uptimeSeconds = stats.uptime_seconds || 0;
    document.getElementById("system-uptime").textContent = formatUptime(uptimeSeconds);
    document.getElementById("disk-usage").textContent = `${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB`;

    // Handle load average
    let loadAvgText = "N/A";
    if (loadAvg && typeof loadAvg === "object") {
      const load1 = loadAvg["1min"];
      const load5 = loadAvg["5min"];
      const load15 = loadAvg["15min"];

      if (
        load1 !== null &&
        load1 !== undefined &&
        load5 !== null &&
        load5 !== undefined &&
        load15 !== null &&
        load15 !== undefined
      ) {
        if (settings.loadAvgPeriod === "all") {
          loadAvgText = `${load1} / ${load5} / ${load15}`;
        } else {
          const selectedLoad = loadAvg[settings.loadAvgPeriod];
          loadAvgText = selectedLoad !== undefined && selectedLoad !== null ? `${selectedLoad}` : "N/A";
        }
      }
    }
    document.getElementById("load-average").textContent = loadAvgText;

    // Update health indicator
    let healthStatus = "Healthy";
    let healthColor = "#22c55e";
    let bgColor = "rgba(34, 197, 94, 0.1)";
    let borderColor = "rgba(34, 197, 94, 0.2)";

    const cpuCores = stats.cpu_cores || 1;
    const load1min = loadAvg["1min"] || 0;

    if (cpuUsage > 90 || memUsage > 95 || diskPercent > 95 || load1min > 2 * cpuCores) {
      healthStatus = "Critical";
      healthColor = "#ef4444";
      bgColor = "rgba(239, 68, 68, 0.1)";
      borderColor = "rgba(239, 68, 68, 0.2)";
    } else if (cpuUsage > 75 || memUsage > 80 || diskPercent > 85 || load1min > cpuCores) {
      healthStatus = "Warning";
      healthColor = "#f59e0b";
      bgColor = "rgba(245, 158, 11, 0.1)";
      borderColor = "rgba(245, 158, 11, 0.2)";
    }

    const healthIndicator = document.getElementById("health-indicator");
    const healthDot = healthIndicator?.querySelector(".health-dot");
    const healthText = healthIndicator?.querySelector("span");

    if (healthDot && healthText && healthIndicator) {
      healthDot.style.backgroundColor = healthColor;
      healthText.textContent = `System ${healthStatus}`;
      healthIndicator.style.backgroundColor = bgColor;
      healthIndicator.style.borderColor = borderColor;
    }

    systemStatsErrorCount = 0;
  } catch (error) {
    console.error("Error loading system stats:", error)
    systemStatsErrorCount++

    if (systemStatsErrorCount >= SYSTEM_STATS_ERROR_THRESHOLD) {
      addActivity("error", "System Stats Error", `Failed to load system statistics: ${error.message}`)
      systemStatsErrorCount = 0
    }

    const elements = [
      "cpu-usage",
      "memory-usage",
      "network-in",
      "network-out",
      "system-uptime",
      "disk-usage",
      "load-average",
    ]

    elements.forEach((id) => {
      const element = document.getElementById(id)
      if (element && element.textContent === "--") {
        element.textContent = "Error"
      }
    })
  }
}

function reconnectSystemWebSocket() {
  if (wsSystem) wsSystem.close();
  statsLoaded = false;
  connectSystemWebSocket();
}

// Optimized debounce and throttle functions
const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

const throttle = (func, limit) => {
  let inThrottle
  return function () {
    const args = arguments

    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

// Chart data storage with performance optimization
const chartData = {
  cpu: [],
  memory: [],
  network: [],
}

// Chart instances
let cpuChart, memoryChart, networkChart

// Settings with performance defaults
let settings = {
  showExited: true,
  showTimestamps: true,
  autoRefreshLogs: false,
  logLevel: "all",
  refreshInterval: 10,
  chartPoints: 50,
  groupByNetwork: true,
  loadAvgPeriod: "all",
}

// Activities storage
let activities = []

// Network data
let networksData = {}

// Performance optimization: Enable scroll on overflow
function enableScrollOnOverflow() {
  document.querySelectorAll(".scrollable-name").forEach((el) => {
    const inner = el.querySelector(".scrollable-inner")
    if (!inner) return
    const scrollWidth = inner.scrollWidth
    const clientWidth = el.clientWidth

    if (scrollWidth > clientWidth) {
      el.classList.add("scroll-on-hover")
      el.style.setProperty("--scroll-amount", `-${scrollWidth - clientWidth}px`)
    } else {
      el.classList.remove("scroll-on-hover")
      el.style.removeProperty("--scroll-amount")
    }
  })
}

function enableImageScrollOnOverflow() {
  document.querySelectorAll(".image-name.scrollable-image").forEach((el) => {
    const inner = el.querySelector(".scrollable-inner")
    if (!inner) return
    const scrollWidth = inner.scrollWidth
    const clientWidth = el.clientWidth
    if (scrollWidth > clientWidth) {
      el.classList.add("scroll-on-hover")
      el.style.setProperty("--scroll-amount", `-${scrollWidth - clientWidth}px`)
    } else {
      el.classList.remove("scroll-on-hover")
      el.style.removeProperty("--scroll-amount")
    }
  })
}

// Initialize charts with better performance
function initializeCharts() {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
  }

  const cpuCtx = document.getElementById("cpu-chart")
  if (cpuCtx) {
    cpuChart = createLineChart(cpuCtx, chartOptions, "#4A9EFF")
  }

  const memoryCtx = document.getElementById("memory-chart")
  if (memoryCtx) {
    memoryChart = createLineChart(memoryCtx, chartOptions, "#22c55e")
  }

  const networkCtx = document.getElementById("network-chart")
  if (networkCtx) {
    networkChart = createLineChart(networkCtx, chartOptions, "#f59e0b")
  }

  if (cpuChart) cpuChart.update(0);
  if (memoryChart) memoryChart.update(0);
  if (networkChart) networkChart.update(0);
}

// Optimized line chart using Canvas API with higher resolution
function createLineChart(canvas, options, color) {
  const ctx = canvas.getContext("2d")
  const data = []
  let animationId
  let lastDrawTime = 0

  // Set high DPI scaling for crisp rendering
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  // Enable anti-aliasing
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  return {
    data: data,
    update: throttle(function (newValue) {
      this.data.push(newValue)
      if (this.data.length > settings.chartPoints) {
        this.data.shift()
      }

      const now = Date.now()
      if (now - lastDrawTime > 100) {
        if (animationId) {
          cancelAnimationFrame(animationId)
        }
        animationId = requestAnimationFrame(() => this.draw())
        lastDrawTime = now
      }
    }, 100),
    draw: function () {
      const width = rect.width
      const height = rect.height

      // Clear with anti-aliasing
      ctx.clearRect(0, 0, width, height)

      if (this.data.length < 2) return

      const max = Math.max(...this.data, 1)
      const min = Math.min(...this.data, 0)
      const range = max - min || 1

      // Create smooth gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, color + "40")
      gradient.addColorStop(1, color + "10")

      // Draw area with smooth curves
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(0, height)

      // Use quadratic curves for smoother lines
      for (let i = 0; i < this.data.length; i++) {
        const x = (i / (this.data.length - 1)) * width
        const y = height - ((this.data[i] - min) / range) * height

        if (i === 0) {
          ctx.lineTo(x, y)
        } else {
          const prevX = ((i - 1) / (this.data.length - 1)) * width
          const prevY = height - ((this.data[i - 1] - min) / range) * height
          const cpX = (prevX + x) / 2
          ctx.quadraticCurveTo(cpX, prevY, x, y)
        }
      }

      ctx.lineTo(width, height)
      ctx.closePath()
      ctx.fill()

      // Draw smooth line
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()

      for (let i = 0; i < this.data.length; i++) {
        const x = (i / (this.data.length - 1)) * width
        const y = height - ((this.data[i] - min) / range) * height

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          const prevX = ((i - 1) / (this.data.length - 1)) * width
          const prevY = height - ((this.data[i - 1] - min) / range) * height
          const cpX = (prevX + x) / 2
          ctx.quadraticCurveTo(cpX, prevY, x, y)
        }
      }

      ctx.stroke()
    },
  }
}

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now - date) / 1000)

  if (diffInSeconds < 60) return "Just now"
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  return `${Math.floor(diffInSeconds / 86400)}d ago`
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// Enhanced activity management with external state detection
const lastContainerStates = new Map()

function checkContainerStateChanges(containers) {
  containers.forEach((container) => {
    const currentState = container.status.toLowerCase()
    const lastState = lastContainerStates.get(container.id)

    if (lastState && lastState !== currentState) {
      // Container state changed
      let activityType = "success"
      let title = `Container ${currentState}`

      if (currentState === "exited" || currentState === "stopped") {
        activityType = "error"
        title = "Container Stopped"
        activitiesSeen = false
        unreadActivities++
      } else if (currentState === "running") {
        activityType = "success"
        title = "Container Started"
      } else if (currentState === "paused") {
        activityType = "warning"
        title = "Container Paused"
      }

      addActivity(activityType, title, `Container ${container.name} changed from ${lastState} to ${currentState}`)
    }

    lastContainerStates.set(container.id, currentState)
  })

  updateActivityBadgeWithState()
}

function updateActivityBadgeWithState() {
  let badge = document.getElementById("activity-badge");
  if (!badge) {
    const activitiesBtn = document.querySelector('.header-btn[onclick="showActivities()"]');
    if (!activitiesBtn) return;
    badge = document.createElement("span");
    badge.id = "activity-badge";
    badge.className = "activity-badge";
    activitiesBtn.appendChild(badge);
  }

  // Determine badge type based on recent activities
  let badgeType = "normal";
  let criticalCount = 0;
  let warningCount = 0;
  let refreshCount = 0;

  activities.slice(0, 5).forEach((activity) => {
    if (activity.type === "error") criticalCount++;
    else if (activity.type === "warning") warningCount++;
    else if (activity.type === "refresh") refreshCount++;
  });

  if (criticalCount > 0) {
    badgeType = "critical";
  } else if (refreshCount > 0 && unreadActivities > 0) {
    badgeType = "refresh";
  } else if (warningCount > 0) {
    badgeType = "warning";
  }

  badge.className = `activity-badge ${badgeType}`;

  if (!activitiesSeen && unreadActivities > 0) {
    badge.textContent = unreadActivities;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
    badge.textContent = "";
  }
}

// Activities state management
function saveActivitiesState() {
  const state = {
    activitiesSeen: activitiesSeen,
    unreadActivities: unreadActivities,
    lastSeen: Date.now(),
  }
  localStorage.setItem("logique-activities-state", JSON.stringify(state))
}

function loadActivitiesState(activitiesArr) {
  const saved = localStorage.getItem("logique-activities-state");
  if (saved) {
    const state = JSON.parse(saved);
    activitiesSeen = state.activitiesSeen;
    unreadActivities = state.unreadActivities;

    // Reset if more than 1 hour has passed
    if (Date.now() - state.lastSeen > 3600000) {
      activitiesSeen = true;
      unreadActivities = 0;
    }
  }
  // --- Always recalculate unreadActivities based on activitiesArr ---
  if (!activitiesSeen && Array.isArray(activitiesArr)) {
    unreadActivities = activitiesArr.length;
  } else if (activitiesSeen) {
    unreadActivities = 0;
  }
}

// Enhanced activity management with critical notifications
function addActivity(type, title, description) {
  const now = Date.now();

  // Prevent duplicates within 60 seconds
  const duplicate = activities.find(
    (a) =>
      a.type === type &&
      a.title === title &&
      a.description === description &&
      now - new Date(a.timestamp).getTime() < 60000
  );
  if (duplicate) return;

  const activity = {
    id: now,
    type,
    title,
    description,
    timestamp: new Date(),
  };

  activities.unshift(activity);
  if (activities.length > 10) {
    activities = activities.slice(0, 10);
  }

  localStorage.setItem("logique-activities", JSON.stringify(activities));
  updateActivitiesList();

  // Set unread count and seen state
  if (!activitiesSeen) {
    unreadActivities++;
  } else {
    activitiesSeen = false;
    unreadActivities = 1;
  }

  saveActivitiesState();
  updateActivityBadgeWithState();

  // Highlight only if critical
  const isCritical =
    type === "error" ||
    title.toLowerCase().includes("stopped") ||
    title.toLowerCase().includes("failed") ||
    description.toLowerCase().includes("not accessible") ||
    description.toLowerCase().includes("system resources");

  if (isCritical) {
    highlightActivitiesButton();
  }
}

function highlightActivitiesButton() {
  const now = Date.now();
  if (now - lastHighlightTime < HIGHLIGHT_COOLDOWN_MS) return; // prevent repeat highlight

  const activitiesBtn = document.querySelector('.header-btn[onclick="showActivities()"]');
  if (activitiesBtn) {
    activitiesBtn.classList.add("activities-highlight");

    // Remove highlight class after a short duration (e.g., for animation)
    setTimeout(() => {
      activitiesBtn.classList.remove("activities-highlight");
    }, 1000); // duration of your CSS animation

    lastHighlightTime = now;
  }
}

function updateActivityBadge() {
  let badge = document.getElementById("activity-badge");
  if (!badge) {
    const activitiesBtn = document.querySelector('.header-btn[onclick="showActivities()"]');
    if (!activitiesBtn) return;
    badge = document.createElement("span");
    badge.id = "activity-badge";
    badge.className = "activity-badge";
    activitiesBtn.appendChild(badge);
  }
  if (!activitiesSeen && unreadActivities > 0) {
    badge.textContent = unreadActivities;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
    badge.textContent = "";
  }
}

function updateActivitiesList() {
  const activitiesList = document.getElementById("activities-list")
  if (!activitiesList) return

  if (activities.length === 0) {
    activitiesList.innerHTML = `
            <div class="activity-item">
                <div class="activity-content">
                    <div class="activity-title">No recent activities</div>
                    <div class="activity-description">Container actions will appear here</div>
                </div>
            </div>
        `
    return
  }

  activitiesList.innerHTML = activities
    .map(
      (activity) => `
        <div class="activity-item">
            <div class="activity-icon ${activity.type}">
                ${
                  activity.type === "success"
                    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
                    : activity.type === "error"
                      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
                      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
                }
            </div>
            <div class="activity-content">
                <div class="activity-title">${activity.title}</div>
                <div class="activity-description">${activity.description}</div>
            </div>
            <div class="activity-time">${formatTimeAgo(activity.timestamp)}</div>
        </div>
    `,
    )
    .join("")
}

// Loading state management
function showLoading() {
  isLoading = true
  document.body.classList.add("loading")
}

function hideLoading() {
  isLoading = false
  document.body.classList.remove("loading")
}

// Activities modal functions
function showActivities() {
  document.getElementById("activities-modal").classList.add("show");
  activitiesSeen = true;
  unreadActivities = 0;

  saveActivitiesState();
  updateActivitiesList();
  updateActivityBadge();
  updateActivityBadgeWithState();

  const activitiesBtn = document.querySelector('.header-btn[onclick="showActivities()"]');
  if (activitiesBtn) activitiesBtn.classList.remove("activities-highlight");
}

function closeActivities() {
  document.getElementById("activities-modal").classList.remove("show");

  // Clear activities when closing the modal
  activities = [];
  localStorage.setItem("logique-activities", JSON.stringify(activities));
  updateActivitiesList();
  updateActivityBadge();
  updateActivityBadgeWithState();
}

// Settings functionality
function openSettings() {
  document.getElementById("settings-modal").classList.add("show")
  loadSettings()
}

function closeSettings() {
  document.getElementById("settings-modal").classList.remove("show")
}

function loadSettings() {
  const savedSettings = localStorage.getItem("logique-settings")
  if (savedSettings) {
    settings = { ...settings, ...JSON.parse(savedSettings) }
  }

  document.getElementById("show-exited").checked = settings.showExited
  document.getElementById("show-timestamps").checked = settings.showTimestamps
  document.getElementById("auto-refresh-logs").checked = settings.autoRefreshLogs
  document.getElementById("group-by-network").checked = settings.groupByNetwork
  document.getElementById("log-level").value = settings.logLevel
  document.getElementById("refresh-interval").value = settings.refreshInterval
  document.getElementById("chart-points").value = settings.chartPoints
  document.getElementById("load-avg-period").value = settings.loadAvgPeriod || "all"
}

function saveSettings() {
  settings = {
    showExited: document.getElementById("show-exited").checked,
    showTimestamps: document.getElementById("show-timestamps").checked,
    autoRefreshLogs: document.getElementById("auto-refresh-logs").checked,
    groupByNetwork: document.getElementById("group-by-network").checked,
    logLevel: document.getElementById("log-level").value,
    refreshInterval: Number.parseInt(document.getElementById("refresh-interval").value),
    chartPoints: Number.parseInt(document.getElementById("chart-points").value),
    loadAvgPeriod: document.getElementById("load-avg-period").value,
  }

  localStorage.setItem("logique-settings", JSON.stringify(settings))
  closeSettings()

  // Apply settings immediately
  applySettingsImmediately()
  addActivity("success", "Settings Updated", "Application settings have been saved and applied")
}

function applySettingsImmediately() {
  // Clear existing intervals
  clearInterval(window.systemStatsInterval)
  clearInterval(window.containersInterval)

  // Restart intervals with new settings
  // window.systemStatsInterval = setInterval(loadSystemStats, 5000)
  // window.containersInterval = setInterval(loadContainers, settings.refreshInterval * 1000)

  // Reload data immediately
  // Promise.all([loadSystemStats(), loadContainers()])

  // Update chart points limit
  if (cpuChart && cpuChart.data.length > settings.chartPoints) {
    cpuChart.data = cpuChart.data.slice(-settings.chartPoints)
  }
  if (memoryChart && memoryChart.data.length > settings.chartPoints) {
    memoryChart.data = memoryChart.data.slice(-settings.chartPoints)
  }
  if (networkChart && networkChart.data.length > settings.chartPoints) {
    networkChart.data = networkChart.data.slice(-settings.chartPoints)
  }
}

function applySettings() {
  clearInterval(window.systemStatsInterval)
  clearInterval(window.containersInterval)

  // window.systemStatsInterval = setInterval(loadSystemStats, 5000)
  // window.containersInterval = setInterval(loadContainers, settings.refreshInterval * 1000)
  // loadContainers()
}

function refreshAll() {
  // Reload activities and badge state
  const savedActivities = localStorage.getItem("logique-activities");
  if (savedActivities) {
    activities = JSON.parse(savedActivities);
  }
  loadActivitiesState(activities);
  updateActivitiesList();
  updateActivityBadgeWithState();

  // Add the Manual Refresh activity with type "refresh"
  addActivity("refresh", "Manual Refresh", "All data has been refreshed");

  Promise.all([loadSystemStats(), loadContainers()]);
}

function setUsageColor(element, value) {
  element.classList.remove("usage-yellow", "usage-orange", "usage-red", "usage-green");
  if (value >= 90) {
    element.classList.add("usage-red");
  } else if (value >= 75) {
    element.classList.add("usage-orange");
  } else if (value >= 60) {
    element.classList.add("usage-yellow");
  }
}

let systemStatsErrorCount = 0
const SYSTEM_STATS_ERROR_THRESHOLD = 3

function updateContainersRealtime(containers) {
  if (isLoading) return;

  try {
    checkContainerStateChanges(containers);

    let filteredContainers = containers;
    if (!settings.showExited) {
      filteredContainers = containers.filter((container) => container.status.toLowerCase() !== "exited");
    }

    document.getElementById("total-containers").textContent = filteredContainers.length;
    document.getElementById("running-containers").textContent = filteredContainers.filter(
      (c) => c.status.toLowerCase() === "running"
    ).length;

    // Only update sidebar if not grouping by network
    if (!settings.groupByNetwork) {
      updateSidebar(filteredContainers);
    }
    updateContainersTable(filteredContainers);
  } catch (error) {
    console.error("Error loading containers:", error)
    addActivity("error", "Container Load Error", "Failed to load container information")
  }
}

// Optimized system stats loading
const loadSystemStats = debounce(async () => {
  if (isLoading) return

  try {
    const response = await fetch("/api/system-stats")

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    let stats
    try {
      stats = await response.json()
    } catch (parseError) {
      throw new Error("Invalid JSON response from server")
    }

    if (!stats || typeof stats !== "object") {
      throw new Error("Invalid system stats data structure")
    }

    // const cpuUsage = typeof stats.cpu_usage_percent === "number" ? stats.cpu_usage_percent : 0
    const memUsage = stats.memory?.used_percent || 0
    const diskUsed = stats.disk?.used_gb || 0
    const diskTotal = stats.disk?.total_gb || 1
    const diskPercent = stats.disk?.used_percent || 0
    const loadAvg = stats.load_average || {}

    // Update CPU Usage
    const cpuUsage = document.getElementById("cpu-usage");
    const cpuExtra = document.getElementById("cpu-extra");
    if (cpuUsage) {
      const cpuVal = Number(stats.cpu_usage_percent || 0);
      cpuUsage.textContent = `${cpuVal.toFixed(1)} %`;
      setUsageColor(cpuUsage, cpuVal);
    }
    if (cpuExtra) cpuExtra.textContent = `${stats.cpu_cores || 1}`;

    if (cpuChart) cpuChart.update(stats.cpu_usage_percent || 0);

    // Update Memory
    const memoryUsage = document.getElementById("memory-usage");
    const memoryExtra = document.getElementById("memory-extra");
    if (memoryUsage) {
      const memVal = Number(stats.memory?.used_percent?.toFixed(1) || 0);
      memoryUsage.textContent = `${memVal} %`;
      setUsageColor(memoryUsage, memVal);
    };
    if (memoryExtra) {
      const used = stats.memory?.used_memory || 0;
      const total = stats.memory?.total_gb || 0;
      memoryExtra.textContent = `${used.toFixed(1)} / ${total.toFixed(1)} GB`;
    }
    if (memoryChart) memoryChart.update(memUsage);

    // Update Network
    const networkIn = stats.network?.bytes_recv || 0
    const networkOut = stats.network?.bytes_sent || 0
    document.getElementById("network-in").textContent = formatBytes(networkIn) + "/s"
    document.getElementById("network-out").textContent = formatBytes(networkOut) + "/s"

    if (networkChart) networkChart.update(networkIn + networkOut)

    // Update system health
    const uptimeSeconds = stats.uptime_seconds || 0
    document.getElementById("system-uptime").textContent = formatUptime(uptimeSeconds)
    document.getElementById("disk-usage").textContent = `${diskUsed.toFixed(1)} / ${diskTotal.toFixed(1)} GB`

    // Handle load average
    let loadAvgText = "N/A"
    if (loadAvg && typeof loadAvg === "object") {
      const load1 = loadAvg["1min"]
      const load5 = loadAvg["5min"]
      const load15 = loadAvg["15min"]

      if (
        load1 !== null &&
        load1 !== undefined &&
        load5 !== null &&
        load5 !== undefined &&
        load15 !== null &&
        load15 !== undefined
      ) {
        if (settings.loadAvgPeriod === "all") {
          loadAvgText = `${load1} / ${load5} / ${load15}`
        } else {
          const selectedLoad = loadAvg[settings.loadAvgPeriod]
          loadAvgText = selectedLoad !== undefined && selectedLoad !== null ? `${selectedLoad}` : "N/A"
        }
      }
    }
    document.getElementById("load-average").textContent = loadAvgText

    // Update health indicator
    let healthStatus = "Healthy"
    let healthColor = "#22c55e"
    let bgColor = "rgba(34, 197, 94, 0.1)"
    let borderColor = "rgba(34, 197, 94, 0.2)"

    const cpuCores = stats.cpu_cores || 1
    const load1min = loadAvg["1min"] || 0

    if (cpuUsage > 90 || memUsage > 95 || diskPercent > 95 || load1min > 2 * cpuCores) {
      healthStatus = "Critical"
      healthColor = "#ef4444"
      bgColor = "rgba(239, 68, 68, 0.1)"
      borderColor = "rgba(239, 68, 68, 0.2)"
    } else if (cpuUsage > 75 || memUsage > 80 || diskPercent > 85 || load1min > cpuCores) {
      healthStatus = "Warning"
      healthColor = "#f59e0b"
      bgColor = "rgba(245, 158, 11, 0.1)"
      borderColor = "rgba(245, 158, 11, 0.2)"
    }

    const healthIndicator = document.getElementById("health-indicator")
    const healthDot = healthIndicator?.querySelector(".health-dot")
    const healthText = healthIndicator?.querySelector("span")

    if (healthDot && healthText && healthIndicator) {
      healthDot.style.backgroundColor = healthColor
      healthText.textContent = `System ${healthStatus}`
      healthIndicator.style.backgroundColor = bgColor
      healthIndicator.style.borderColor = borderColor
    }

    systemStatsErrorCount = 0
  } catch (error) {
    console.error("Error loading system stats:", error)
    systemStatsErrorCount++

    if (systemStatsErrorCount >= SYSTEM_STATS_ERROR_THRESHOLD) {
      addActivity("error", "System Stats Error", `Failed to load system statistics: ${error.message}`)
      systemStatsErrorCount = 0
    }

    const elements = [
      "cpu-usage",
      "memory-usage",
      "network-in",
      "network-out",
      "system-uptime",
      "disk-usage",
      "load-average",
    ]

    elements.forEach((id) => {
      const element = document.getElementById(id)
      if (element && element.textContent === "--") {
        element.textContent = "Error"
      }
    })
  }
}, 200)

// Update loadContainers to check for state changes
const loadContainers = debounce(async () => {
  if (isLoading) return

  try {
    const [containersRes, networksRes] = await Promise.all([fetch("/api/containers"), fetch("/api/networks")])
    const containers = await containersRes.json()
    const networks = await networksRes.json()

    // Check for container state changes
    checkContainerStateChanges(containers)

    networksData = networks

    let filteredContainers = containers
    if (!settings.showExited) {
      filteredContainers = containers.filter((container) => container.status.toLowerCase() !== "exited")
    }

    document.getElementById("total-containers").textContent = filteredContainers.length
    document.getElementById("running-containers").textContent = filteredContainers.filter(
      (c) => c.status.toLowerCase() === "running",
    ).length

    if (settings.groupByNetwork) {
      updateNetworkSidebar(networks)
    } else {
      updateSidebar(filteredContainers)
    }

    updateContainersTable(filteredContainers)
  } catch (error) {
    console.error("Error loading containers:", error)
    addActivity("error", "Container Load Error", "Failed to load container information")
  }
}, 200)

function updateNetworkSidebar(networks) {
  const networksContainer = document.getElementById("networks-container")
  if (!networksContainer) return

  const sortedNetworkNames = Object.keys(networks)
    .filter((name) => networks[name].containers && networks[name].containers.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))

  networksContainer.innerHTML = sortedNetworkNames
    .map((networkName) => {
      const network = networks[networkName]
      const sortedContainers = network.containers
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      return `
            <div class="network-group">
                <div class="network-header" onclick="viewNetworkLogsMain('${network.name}')">
                    <div class="network-info">
                        <span class="network-name">${network.name}</span>
                    </div>
                    <div class="network-badge" style="cursor:pointer;" title="View stacked logs">${sortedContainers.length}</div>
                </div>
                <div class="network-containers" id="network-${network.name}">
                    ${sortedContainers
                      .map(
                        (container) => `
                        <div class="container-item" onclick="viewContainerLogsInline('${container.id}', '${container.name}')">
                            <div class="status-dot status-${container.status.toLowerCase()}"></div>
                            <span class="container-name scrollable-name"><span class="scrollable-inner">${container.name}</span></span>
                        </div>
                    `,
                      )
                      .join("")}
                </div>
            </div>
        `
    })
    .join("")
  enableScrollOnOverflow()
}

// Function to generate a unique color for each container
function generateColorPalette(count) {
  const professionalColors = [
    "#4A9EFF", // Blue
    "#22c55e", // Green
    "#f59e0b", // Orange
    "#ef4444", // Red
    "#a855f7", // Purple
    "#06b6d4", // Cyan
    "#eab308", // Yellow
    "#64748b", // Slate
    "#4b5563", // Gray
  ];
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(professionalColors[i % professionalColors.length]);
  }
  return colors;
}

// Close existing WebSocket if any
async function viewContainerLogsInline(containerId, containerName) {
  if (currentWsLogs) {
    currentWsLogs.close();
    currentWsLogs = null;
  }

  // Clear current logs and show loading state
  currentContainerLogs = { containerId, containerName, logs: [] };
  const logsContent = document.getElementById("network-logs-content");
  if (logsContent) {
    logsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">Loading logs...</div>';
  }

  // Set modal title and show it
  document.getElementById("network-logs-title").textContent = `${containerName} - Logs`;
  document.getElementById("network-logs-modal").classList.add("show");
  currentNetworkName = "";

  // Establish WebSocket connection
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/container/${containerId}/logs?tail=100`;
  currentWsLogs = new WebSocket(wsUrl);

  currentWsLogs.onopen = function() {
    console.log(`WebSocket connected for container ${containerName}`);
    logsContent.innerHTML = ''; // Clear loading message once connected
  };

  currentWsLogs.onmessage = function(event) {
    const logObj = JSON.parse(event.data);
    const logEntry = {
      container: containerName,
      line: logObj.line,
      timestamp: logObj.timestamp
    };
    currentContainerLogs.logs.push(logEntry);
    appendLogEntry(logEntry);
  };

  currentWsLogs.onerror = function(error) {
    console.error(`WebSocket error for container ${containerName}:`, error);
    logsContent.innerHTML += '<div style="color: red;">Error: Could not connect to logs stream</div>';
  };

  currentWsLogs.onclose = function() {
    console.log(`WebSocket closed for container ${containerName}`);
    logsContent.innerHTML += '<div style="color: orange;">Log stream disconnected</div>';
  };
}

// Updated appendLogEntry with unique colors and conditional scrolling
function appendLogEntry(logEntry) {
  const logsContent = document.getElementById("network-logs-content");
  
  const logLevel = document.getElementById("network-log-level-filter").value;
  const msg = logEntry.line.toLowerCase();
  
  if (
    logLevel === "error" && !msg.includes("error") ||
    logLevel === "warning" && !(msg.includes("warn") || msg.includes("error")) ||
    logLevel === "info" && !(msg.includes("info") || msg.includes("warn") || msg.includes("error"))
  ) {
     return; // Skip log if it doesn't match filter
  }

  if (!logsContent) return;

  const containerColor = currentContainerColors[logEntry.container] || "#4A9EFF";
  const shortName = logEntry.container.length > 12 ? "..." + logEntry.container.slice(-12) : logEntry.container;

  let humanTime = "";
  if (logEntry.timestamp) {
    const d = new Date(logEntry.timestamp);
    if (!isNaN(d)) {
      humanTime = d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } else {
      humanTime = logEntry.timestamp;
    }
  }

  const sanitizedLine = logEntry.line.replace(/\n{2,}/g, "\n").trim();
  const levelClass = getLogLevelClass(sanitizedLine); // <-- Add this line

  const logHtml = `<div class="network-log-row ${levelClass}">
    <span class="network-log-container" style="color:${containerColor}">${shortName}</span>
    <span class="network-log-timestamp">${humanTime}</span>
    <span class="network-log-message">${escapeHtml(sanitizedLine)}</span>
  </div>`;

  // Check if user is near the bottom (within 50px)
  const isAtBottom = logsContent.scrollHeight - logsContent.scrollTop <= logsContent.clientHeight + 50;
  logsContent.innerHTML += logHtml;

  // Limit to 1000 lines to prevent performance issues
  while (logsContent.childElementCount > 1000) {
    logsContent.removeChild(logsContent.firstChild);
  }

  // Auto-scroll only if user is near the bottom
  if (isAtBottom) {
    logsContent.scrollTop = logsContent.scrollHeight;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

let currentNetworkLogs = []
let currentNetworkName = ""
let currentContainerColors = {}
let currentMaxNameLen = 10

// Network logs functionality (unchanged but optimized)
async function viewNetworkLogsMain(networkName) {
  if (currentWsLogs) {
    currentWsLogs.close();
    currentWsLogs = null;
  }

  // Clear current logs and show loading state
  currentNetworkLogs = [];
  currentNetworkName = networkName;
  const logsContent = document.getElementById("network-logs-content");
  if (logsContent) {
    logsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">Loading network logs...</div>';
  }

  // Set modal title and show it
  document.getElementById("network-logs-title").textContent = `${networkName} - Network Logs`;
  document.getElementById("network-logs-modal").classList.add("show");

  // Get containers in the network
  const containers = networksData[networkName]?.containers || [];
  const containerNames = containers.map(c => c.name);

  // Generate unique colors for each container
  const colors = generateColorPalette(containerNames.length);
  currentContainerColors = {};
  containerNames.forEach((name, index) => {
    currentContainerColors[name] = colors[index];
  });

  // Establish WebSocket connection
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/network/${networkName}/logs?tail=100`;
  currentWsLogs = new WebSocket(wsUrl);

  currentWsLogs.onopen = function() {
    console.log(`WebSocket connected for network ${networkName}`);
    logsContent.innerHTML = ''; // Clear loading message once connected
  };

  currentWsLogs.onmessage = function(event) {
    const logObj = JSON.parse(event.data);
    if (logObj.error) {
      logsContent.innerHTML += `<div style="color: red;">Error: ${logObj.error}</div>`;
      return;
    }
    const logEntry = {
      container: logObj.container,
      line: logObj.line,
      timestamp: logObj.timestamp
    };
    currentNetworkLogs.push(logEntry);
    appendLogEntry(logEntry);
  };

  currentWsLogs.onerror = function(error) {
    console.error(`WebSocket error for network ${networkName}:`, error);
    logsContent.innerHTML += '<div style="color: red;">Error: Could not connect to network logs stream</div>';
  };

  currentWsLogs.onclose = function() {
    console.log(`WebSocket closed for network ${networkName}`);
    logsContent.innerHTML += '<div style="color: orange;">Network log stream disconnected</div>';
  };
}

function renderNetworkLogs(logs, containerColors, maxNameLen, logLevel = "all") {
  let filteredLogs = logs;
  if (logLevel !== "all") {
    filteredLogs = logs.filter((log) => {
      const msg = log.line.toLowerCase();
      if (logLevel === "error") return msg.includes("error");
      if (logLevel === "warning") return msg.includes("warn") || msg.includes("error");
      if (logLevel === "info") return msg.includes("info") || msg.includes("warn") || msg.includes("error");
      return true;
    });
  }

  return filteredLogs
    .map((log) => {
      const shortName = log.container.length > 12 ? "..." + log.container.slice(-12) : log.container;

      let humanTime = "";
      if (log.timestamp) {
        const d = new Date(log.timestamp);
        if (!isNaN(d)) {
          humanTime = d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });
        } else {
          humanTime = log.timestamp;
        }
      }

      const sanitizedLine = log.line.replace(/\n{2,}/g, "\n").trim();
      const levelClass = getLogLevelClass(sanitizedLine);

      return `<div class="network-log-row ${levelClass}">
        <span class="network-log-container" style="color:${containerColors[log.container]}">${shortName}</span>
        <span class="network-log-timestamp">${humanTime}</span>
        <span class="network-log-message">${escapeHtml(sanitizedLine)}</span>
      </div>`;
    })
    .join("");
}

function renderContainerLogs(logs, containerName, logLevel = "all") {
  let filteredLogs = logs;
  if (logLevel !== "all") {
    filteredLogs = logs.filter((log) => {
      const msg = log.line.toLowerCase();
      if (logLevel === "error") return msg.includes("error");
      if (logLevel === "warning") return msg.includes("warn") || msg.includes("error");
      if (logLevel === "info") return msg.includes("info") || msg.includes("warn") || msg.includes("error");
      return true;
    });
  }

  const containerColor = currentContainerColors[containerName] || "#4A9EFF";
  const maxNameLen = containerName.length;

  return filteredLogs
    .map((log) => {
      const shortName = log.container.length > 12 ? "..." + log.container.slice(-12) : log.container;

      let humanTime = "";
      if (log.timestamp) {
        const d = new Date(log.timestamp);
        if (!isNaN(d)) {
          humanTime = d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });
        } else {
          humanTime = log.timestamp;
        }
      }

      const sanitizedLine = log.line.replace(/\n{2,}/g, "\n").trim();
      const levelClass = getLogLevelClass(sanitizedLine);

      return `<div class="network-log-row ${levelClass}">
        <span class="network-log-container" style="color:${containerColor}">${shortName}</span>
        <span class="network-log-timestamp">${humanTime}</span>
        <span class="network-log-message">${escapeHtml(sanitizedLine)}</span>
      </div>`;
    })
    .join("");
}

function refreshNetworkLogs() {
  if (currentContainerLogs) {
    viewContainerLogsInline(currentContainerLogs.containerId, currentContainerLogs.containerName)
  } else if (currentNetworkName) {
    viewNetworkLogsMain(currentNetworkName)
  }
}

function getLogLevelClass(line) {
  const msg = line.toLowerCase();
  if (msg.includes("critical")) return "log-critical";
  if (msg.includes("error") || msg.includes("err")) return "log-error";
  if (msg.includes("warn")) return "log-warning";
  if (msg.includes("info")) return "log-info";
  if (msg.includes("debug")) return "log-debug";
  return "log-default";
}

function filterNetworkLogs() {
  const logLevel = document.getElementById("network-log-level-filter").value;
  const logsContent = document.getElementById("network-logs-content");
  if (currentContainerLogs) {
    if (logsContent) {
      logsContent.innerHTML = renderContainerLogs(
        currentContainerLogs.logs,
        currentContainerLogs.containerName,
        logLevel
      );
    }
  } else {
    if (logsContent) {
      logsContent.innerHTML = renderNetworkLogs(
        currentNetworkLogs,
        currentContainerColors,
        currentMaxNameLen,
        logLevel
      );
    }
  }
}

function downloadNetworkLogs() {
  let logs, filename
  if (currentContainerLogs) {
    logs = currentContainerLogs.logs
    filename = `${currentContainerLogs.containerName}-logs-${new Date().toISOString().slice(0, 19)}.txt`
  } else {
    logs = currentNetworkLogs.map((log) => `[${log.container}] ${log.line}`).join("\n")
    filename = `${currentNetworkName}-network-logs-${new Date().toISOString().slice(0, 19)}.txt`
  }

  const blob = new Blob([logs], { type: "text/plain" })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

function closeNetworkLogs() {
  document.getElementById("network-logs-modal").classList.remove("show");
  if (currentWsLogs) {
    currentWsLogs.close();
    currentWsLogs = null;
  }
  currentContainerLogs = null;
  currentNetworkName = "";
}

function updateSidebar(containers) {
  const networksContainer = document.getElementById("networks-container")
  if (!networksContainer) return

  containers = containers.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))

  networksContainer.innerHTML = `
        <div class="network-group">
            <div class="network-header">
                <div class="network-info">
                    <span class="network-name">All Containers</span>
                    <span class="network-badge">${containers.length}</span>
                </div>
            </div>
            <div class="network-containers">
                ${containers
                  .map(
                    (container) => `
                    <div class="container-item" onclick="viewContainerLogsInline('${container.id}', '${container.name}')">
                        <div class="status-dot status-${container.status.toLowerCase()}"></div>
                        <span class="scrollable-name"><span class="scrollable-inner">${container.name}</span></span>
                    </div>
                `,
                  )
                  .join("")}
            </div>
        </div>
    `
  enableScrollOnOverflow()
}

const tableSort = { key: "name", asc: true }
let lastContainersData = []

function setTableSort(key) {
  if (tableSort.key === key) {
    tableSort.asc = !tableSort.asc
  } else {
    tableSort.key = key
    tableSort.asc = true
  }
  updateContainersTable(lastContainersData)
}

function sortContainers(containers) {
  const key = tableSort.key
  const asc = tableSort.asc ? 1 : -1
  return containers.slice().sort((a, b) => {
    if (key === "cpu_percent" || key === "memory_usage_mb") {
      return asc * (a[key] - b[key])
    }
    if (key === "status") {
      return asc * a.status.localeCompare(b.status, undefined, { sensitivity: "base" })
    }
    return asc * a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
}

function updateSortArrows() {
  const columns = ["name", "status", "cpu_percent", "memory_usage_mb"]
  columns.forEach((col) => {
    const arrow = document.getElementById("sort-arrow-" + col)
    if (!arrow) return
    if (tableSort.key === col) {
      arrow.textContent = tableSort.asc ? "▲" : "▼"
      arrow.style.color = "#4A9EFF"
    } else {
      arrow.textContent = ""
    }
  })
}

function updateContainersTable(containers) {
  lastContainersData = containers.slice()

  const tableBody = document.getElementById("containers-table-body")
  if (!tableBody) return

  containers = sortContainers(containers)

  tableBody.innerHTML = containers
    .map(
      (container) => `
        <tr>
            <td data-label="Name">
                <div class="container-name-cell">
                    <span class="scrollable-name" style="color: #4A9EFF; text-decoration: none; cursor:pointer;"
                        onclick="viewContainerLogsInline('${container.id}', '${container.name}')">
                      <span class="scrollable-inner">${container.name}</span>
                    </span>
                </div>
            </td>
            <td data-label="Status">
                <span class="status-badge status-${container.status.toLowerCase()}">
                    <div class="status-dot status-${container.status.toLowerCase()}"></div>
                    ${container.status}
                </span>
            </td>
            <td data-label="CPU">${container.cpu_percent.toFixed(2)}%</td>
            <td data-label="RAM">${container.memory_usage_mb.toFixed(0)} MiB</td>
            <td data-label="Image">
                <span class="image-name scrollable-image">
                    <span class="scrollable-inner">${container.image}</span>
                </span>
            </td>
            <td data-label="Actions">
              <div class="action-buttons">
                ${
                  window.currentUserRole === "admin"
                    ? (
                        container.status.toLowerCase() === "running"
                          ? `<button class="action-btn stop" onclick="controlContainer('${container.id}', 'stop')">Stop</button>`
                          : `<button class="action-btn start" onclick="controlContainer('${container.id}', 'start')">Start</button>`
                      ) +
                      `<button class="action-btn restart" onclick="controlContainer('${container.id}', 'restart')" ${container.status.toLowerCase() !== "running" ? "disabled" : ""}>Restart</button>
                      <button class="action-btn remove" onclick="confirmRemoveContainer('${container.id}', '${container.name}')">Remove</button>`
                    : `<span style="color:#888;">View only</span>`
                }
              </div>
            </td>
        </tr>
    `,
    )
    .join("")
  enableScrollOnOverflow()
  enableImageScrollOnOverflow()
  updateSortArrows()
}

// Enhanced container control with better UX
async function controlContainer(containerId, action) {
  if (isLoading) return

  const button = event.target
  const originalText = button.textContent

  button.disabled = true
  button.innerHTML = '<span class="spinner"></span>'

  try {
    const response = await fetch(`/container/${containerId}/${action}`, {
      method: "POST",
    })

    if (response.ok) {
      button.textContent = "Done!"
      button.style.backgroundColor = "rgba(34, 197, 94, 0.3)"

      addActivity(
        "success",
        `Container ${action}`,
        `Successfully ${action}ed container ${containerId.substring(0, 12)}`,
      )

      setTimeout(() => {
        loadContainers()
      }, 1000)
    } else {
      throw new Error(`Failed to ${action} container`)
    }
  } catch (error) {
    console.error(`Error ${action} container:`, error)
    button.textContent = "Error"
    button.style.backgroundColor = "rgba(239, 68, 68, 0.3)"

    addActivity("error", `Container ${action} Failed`, `Failed to ${action} container ${containerId.substring(0, 12)}`)

    setTimeout(() => {
      button.textContent = originalText
      button.style.backgroundColor = ""
      button.disabled = false
    }, 2000)
  }
}

function confirmRemoveContainer(containerId, containerName) {
  if (confirm(`Are you sure you want to remove container "${containerName}"? This action cannot be undone.`)) {
    controlContainer(containerId, "remove")
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", async () => {
  // Show Add User button only for admin users
  if (window.currentUserRole === "admin") {
    const btn = document.getElementById("add-user-btn");
    if (btn) btn.style.display = "";
  }
  
  showLoading();
  connectSystemWebSocket();
  connectContainersWebSocket();
  
  try {
    loadSettings();

    // Load activities from storage
    const savedActivities = localStorage.getItem("logique-activities");
    if (savedActivities) {
      activities = JSON.parse(savedActivities);
    }

    // Load state and recalculate unread count if needed
    loadActivitiesState(activities);

    updateActivitiesList();
    updateActivityBadgeWithState();
    initializeCharts();

    // await Promise.all([loadSystemStats(), loadContainers()]);

    // window.systemStatsInterval = setInterval(loadSystemStats, 5000);
    applySettings();
  } catch (error) {
    console.error("Error initializing application:", error);
    addActivity("error", "Initialization Error", "Failed to initialize application");
  } // } finally {
  //   hideLoading();
  // }
});

// Handle window resize for charts
window.addEventListener(
  "resize",
  throttle(() => {
    if (cpuChart) cpuChart.draw()
    if (memoryChart) memoryChart.draw()
    if (networkChart) networkChart.draw()
  }, 250),
)

// Global functions
window.controlContainer = controlContainer
window.confirmRemoveContainer = confirmRemoveContainer
window.showActivities = showActivities
window.closeActivities = closeActivities
window.openSettings = openSettings
window.closeSettings = closeSettings
window.saveSettings = saveSettings
window.refreshAll = refreshAll
window.viewNetworkLogsMain = viewNetworkLogsMain
window.viewContainerLogsInline = viewContainerLogsInline;
window.closeNetworkLogs = closeNetworkLogs
window.filterNetworkLogs = filterNetworkLogs
window.refreshNetworkLogs = refreshNetworkLogs
window.downloadNetworkLogs = downloadNetworkLogs
window.setTableSort = setTableSort

// Cleanup intervals on page unload
window.addEventListener("beforeunload", () => {
  if (window.systemStatsInterval) clearInterval(window.systemStatsInterval)
  if (window.containersInterval) clearInterval(window.containersInterval)
  if (logRefreshInterval) clearInterval(logRefreshInterval)
})