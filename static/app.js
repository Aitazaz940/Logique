// Performance optimizations - Reduced CPU usage
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Throttle function for high-frequency events
const throttle = (func, limit) => {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
};

// Chart data storage with performance optimization
const chartData = {
    cpu: [],
    memory: [],
    network: []
};

// Chart instances
let cpuChart, memoryChart, networkChart;

// Loading state management
let isLoading = false;

// Settings with performance defaults
let settings = {
    showExited: true,
    showTimestamps: true,
    autoRefreshLogs: false,
    logLevel: 'all',
    refreshInterval: 10,
    chartPoints: 50,
    groupByNetwork: true
};

// Activities storage
let activities = [];

// Network data
let networksData = {};

// Initialize charts with better performance
function initializeCharts() {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Disable animations for better performance
    };

    // CPU Chart
    const cpuCtx = document.getElementById('cpu-chart');
    if (cpuCtx) {
        cpuChart = createLineChart(cpuCtx, chartOptions, '#4A9EFF');
    }

    // Memory Chart
    const memoryCtx = document.getElementById('memory-chart');
    if (memoryCtx) {
        memoryChart = createLineChart(memoryCtx, chartOptions, '#22c55e');
    }

    // Network Chart
    const networkCtx = document.getElementById('network-chart');
    if (networkCtx) {
        networkChart = createLineChart(networkCtx, chartOptions, '#f59e0b');
    }
}

// Optimized line chart using Canvas API with reduced redraws
function createLineChart(canvas, options, color) {
    const ctx = canvas.getContext('2d');
    const data = [];
    let animationId;
    let lastDrawTime = 0;

    // Set canvas size for better performance
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    return {
        data: data,
        update: throttle(function(newValue) {
            this.data.push(newValue);
            if (this.data.length > settings.chartPoints) {
                this.data.shift();
            }
            
            // Throttle redraws to reduce CPU usage
            const now = Date.now();
            if (now - lastDrawTime > 100) { // Max 10 FPS
                if (animationId) {
                    cancelAnimationFrame(animationId);
                }
                animationId = requestAnimationFrame(() => this.draw());
                lastDrawTime = now;
            }
        }, 100),
        draw: function() {
            const width = rect.width;
            const height = rect.height;
            
            ctx.clearRect(0, 0, width, height);
            
            if (this.data.length < 2) return;
            
            const max = Math.max(...this.data, 1);
            const min = Math.min(...this.data, 0);
            const range = max - min || 1;
            
            // Create gradient for better visual appeal
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, color + '40');
            gradient.addColorStop(1, color + '10');
            
            // Draw area fill
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(0, height);
            
            this.data.forEach((value, index) => {
                const x = (index / (this.data.length - 1)) * width;
                const y = height - ((value - min) / range) * height;
                ctx.lineTo(x, y);
            });
            
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fill();
            
            // Draw line
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            this.data.forEach((value, index) => {
                const x = (index / (this.data.length - 1)) * width;
                const y = height - ((value - min) / range) * height;
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            
            ctx.stroke();
        }
    };
}

// Utility functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Add activity
function addActivity(type, title, description) {
    const activity = {
        id: Date.now(),
        type,
        title,
        description,
        timestamp: new Date()
    };

    activities.unshift(activity);
    if (activities.length > 10) {
        activities = activities.slice(0, 10);
    }

    updateActivitiesList();
}

// Update activities list
function updateActivitiesList() {
    const activitiesList = document.getElementById('activities-list');
    if (!activitiesList) return;

    if (activities.length === 0) {
        activitiesList.innerHTML = `
            <div class="activity-item">
                <div class="activity-content">
                    <div class="activity-title">No recent activities</div>
                    <div class="activity-description">Container actions will appear here</div>
                </div>
            </div>
        `;
        return;
    }

    activitiesList.innerHTML = activities.map(activity => `
        <div class="activity-item">
            <div class="activity-icon ${activity.type}">
                ${activity.type === 'success' ? 
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' :
                    activity.type === 'error' ?
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' :
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
                }
            </div>
            <div class="activity-content">
                <div class="activity-title">${activity.title}</div>
                <div class="activity-description">${activity.description}</div>
            </div>
            <div class="activity-time">${formatTimeAgo(activity.timestamp)}</div>
        </div>
    `).join('');
}

// Show loading state
function showLoading() {
    isLoading = true;
    document.body.classList.add('loading');
}

// Hide loading state
function hideLoading() {
    isLoading = false;
    document.body.classList.remove('loading');
}

// Show confirmation modal
function showConfirmModal(title, message, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="close-btn" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="confirmAction()">Confirm</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Show modal with animation
    setTimeout(() => modal.classList.add('show'), 10);

    // Set up event handlers
    window.closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => document.body.removeChild(modal), 200);
        delete window.closeModal;
        delete window.confirmAction;
    };

    window.confirmAction = () => {
        onConfirm();
        window.closeModal();
    };

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            window.closeModal();
        }
    });
}

// Activities modal functions
function showActivities() {
    document.getElementById('activities-modal').classList.add('show');
}

function closeActivities() {
    document.getElementById('activities-modal').classList.remove('show');
}

// Settings functionality
function openSettings() {
    document.getElementById('settings-modal').classList.add('show');
    loadSettings();
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('show');
}

function loadSettings() {
    const savedSettings = localStorage.getItem('logique-settings');
    if (savedSettings) {
        settings = { ...settings, ...JSON.parse(savedSettings) };
    }

    // Update UI
    document.getElementById('show-exited').checked = settings.showExited;
    document.getElementById('show-timestamps').checked = settings.showTimestamps;
    document.getElementById('auto-refresh-logs').checked = settings.autoRefreshLogs;
    document.getElementById('group-by-network').checked = settings.groupByNetwork;
    document.getElementById('log-level').value = settings.logLevel;
    document.getElementById('refresh-interval').value = settings.refreshInterval;
    document.getElementById('chart-points').value = settings.chartPoints;
}

function saveSettings() {
    // Get settings from UI
    settings = {
        showExited: document.getElementById('show-exited').checked,
        showTimestamps: document.getElementById('show-timestamps').checked,
        autoRefreshLogs: document.getElementById('auto-refresh-logs').checked,
        groupByNetwork: document.getElementById('group-by-network').checked,
        logLevel: document.getElementById('log-level').value,
        refreshInterval: parseInt(document.getElementById('refresh-interval').value),
        chartPoints: parseInt(document.getElementById('chart-points').value)
    };

    // Save to localStorage
    localStorage.setItem('logique-settings', JSON.stringify(settings));
    closeSettings();

    // Apply settings immediately
    applySettings();

    addActivity('success', 'Settings Updated', 'Application settings have been saved');
}

function applySettings() {
    // Update refresh intervals
    clearInterval(window.systemStatsInterval);
    clearInterval(window.containersInterval);

    window.systemStatsInterval = setInterval(loadSystemStats, 5000);
    window.containersInterval = setInterval(loadContainers, settings.refreshInterval * 1000);

    // Reload containers to apply settings
    loadContainers();
}

// Refresh all data
function refreshAll() {
    addActivity('success', 'Manual Refresh', 'All data has been refreshed');
    Promise.all([
        loadSystemStats(),
        loadContainers()
    ]);
}

// Optimized system stats loading with reduced frequency
const loadSystemStats = debounce(async () => {
    if (isLoading) return;

    try {
        const response = await fetch('/api/system-stats');
        const stats = await response.json();
        
        // Update CPU
        const cpuUsage = stats.cpu_usage_percent;
        document.getElementById('cpu-usage').textContent = `${cpuUsage}%`;
        if (cpuChart) cpuChart.update(cpuUsage);
        
        // Update Memory
        const memoryUsed = stats.memory.used_memory;
        document.getElementById('memory-usage').textContent = `${memoryUsed.toFixed(1)} GB`;
        if (memoryChart) memoryChart.update(stats.memory.used_percent);
        
        document.getElementById('network-in').textContent = formatBytes(stats.network.bytes_recv) + '/s';
        document.getElementById('network-out').textContent = formatBytes(stats.network.bytes_sent) + '/s';
        
        if (networkChart) networkChart.update(stats.network.bytes_recv + stats.network.bytes_sent);
        
        // Update system health
        document.getElementById('system-uptime').textContent = formatUptime(stats.uptime_seconds);
        document.getElementById('load-average').textContent = stats.load_average;
        
        // Update health indicator
        const healthIndicator = document.getElementById('health-indicator');
        const healthDot = healthIndicator.querySelector('.health-dot');
        const healthText = healthIndicator.querySelector('span');
        
        if (cpuUsage > 80 || stats.memory.used_percent > 90) {
            healthDot.style.backgroundColor = '#ef4444';
            healthText.textContent = 'System Under Load';
            healthIndicator.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            healthIndicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        } else if (cpuUsage > 60 || stats.memory.used_percent > 70) {
            healthDot.style.backgroundColor = '#f59e0b';
            healthText.textContent = 'System Moderate Load';
            healthIndicator.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
            healthIndicator.style.borderColor = 'rgba(245, 158, 11, 0.2)';
        } else {
            healthDot.style.backgroundColor = '#22c55e';
            healthText.textContent = 'System Healthy';
            healthIndicator.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
            healthIndicator.style.borderColor = 'rgba(34, 197, 94, 0.2)';
        }
        
    } catch (error) {
        console.error('Error loading system stats:', error);
        addActivity('error', 'System Stats Error', 'Failed to load system statistics');
    }
}, 200);

// Optimized container loading with network grouping
const loadContainers = debounce(async () => {
    if (isLoading) return;

    try {
        const response = await fetch('/api/containers');
        let containers = await response.json();
        
        // Filter containers based on settings
        if (!settings.showExited) {
            containers = containers.filter(container => container.status.toLowerCase() !== 'exited');
        }
        
        // Update header stats
        document.getElementById('total-containers').textContent = containers.length;
        document.getElementById('running-containers').textContent = 
            containers.filter(c => c.status.toLowerCase() === 'running').length;
        
        // Group containers by network if enabled
        if (settings.groupByNetwork) {
            await groupContainersByNetwork(containers);
        } else {
            updateSidebar(containers);
        }
        
        // Update main view (only table view now)
        updateContainersTable(containers);
        
    } catch (error) {
        console.error('Error loading containers:', error);
        addActivity('error', 'Container Load Error', 'Failed to load container information');
    }
}, 200);

// Group containers by network
async function groupContainersByNetwork(containers) {
    try {
        // Simulate network data - in real implementation, this would come from Docker API
        const networks = {
            'bridge': { name: 'bridge', containers: [] },
            'host': { name: 'host', containers: [] },
            'none': { name: 'none', containers: [] }
        };
        
        // Group containers by network (simplified logic)
        containers.forEach(container => {
            const networkName = container.network || 'bridge';
            if (!networks[networkName]) {
                networks[networkName] = { name: networkName, containers: [] };
            }
            networks[networkName].containers.push(container);
        });
        
        networksData = networks;
        updateNetworkSidebar(networks);
        
    } catch (error) {
        console.error('Error grouping containers by network:', error);
        updateSidebar(containers);
    }
}

function updateNetworkSidebar(networks) {
    const networksContainer = document.getElementById('networks-container');
    if (!networksContainer) return;

    networksContainer.innerHTML = Object.values(networks)
        .filter(network => network.containers && network.containers.length > 0) // Only show non-empty groups
        .map(network => `
            <div class="network-group">
                <div class="network-header" onclick="toggleNetwork('${network.name}')">
                    <div class="network-info">
                        <span class="network-name">${network.name}</span>
                        <span class="network-badge">${network.containers.length}</span>
                    </div>
                    <div class="network-actions"></div>
                </div>
                <div class="network-containers" id="network-${network.name}">
                    ${network.containers.map(container => `
                        <div class="container-item" onclick="window.location.href='/container/${container.id}'">
                            <div class="status-dot status-${container.status.toLowerCase()}"></div>
                            <span class="container-name">${container.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
}

// Toggle network visibility
function toggleNetwork(networkName) {
    const networkContainers = document.getElementById(`network-${networkName}`);
    if (networkContainers) {
        networkContainers.style.display = networkContainers.style.display === 'none' ? 'flex' : 'none';
    }
}

// View network logs
// function viewNetworkLogs(networkName) {
//     document.getElementById('network-logs-title').textContent = `${networkName} Network Logs`;
//     document.getElementById('network-logs-modal').classList.add('show');

//     // Simulate network logs
//     const logs = generateNetworkLogs(networkName);
//     document.getElementById('network-logs-content').textContent = logs;
// }

// let currentNetworkLogs = [];
// let currentNetworkName = '';
// let currentContainerColors = {};
// let currentMaxNameLen = 10;

// Helper: Format and render logs
// function renderNetworkLogs(logs, containerColors, maxNameLen, logLevel = 'all') {
//     // Optionally filter by log level
//     let filteredLogs = logs;
//     if (logLevel !== 'all') {
//         filteredLogs = logs.filter(log => {
//             const msg = log.line.toLowerCase();
//             if (logLevel === 'error') return msg.includes('error');
//             if (logLevel === 'warning') return msg.includes('warn') || msg.includes('error');
//             if (logLevel === 'info') return msg.includes('info') || msg.includes('warn') || msg.includes('error');
//             return true;
//         });
//     }

//     return filteredLogs.map(log => {
//         const paddedName = log.container.padEnd(maxNameLen, ' ');
//         const rest = log.line.replace(/^\[.*?\]\s*/, '');
//         const tsMatch = rest.match(/^\[(.*?)\]/);
//         let timestamp = '';
//         let message = rest;
//         if (tsMatch) {
//             timestamp = tsMatch[1];
//             message = rest.replace(/^\[.*?\]\s*/, '');
//         }
//         let humanTime = '';
//         if (timestamp) {
//             const d = new Date(timestamp);
//             humanTime = !isNaN(d) ? d.toLocaleString() : timestamp;
//         }
//         return `<span style="color:${containerColors[log.container]};font-weight:bold;">${paddedName}</span>  <span style="color:#93c5fd;">${humanTime}</span>  ${escapeHtml(message)}`;
//     }).join('<br>');
// }

// Main function to show network logs
// async function viewNetworkLogs(networkName) {
//     document.getElementById('network-logs-title').textContent = `${networkName} Network Logs`;
//     document.getElementById('network-logs-modal').classList.add('show');
//     currentNetworkName = networkName;

//     // Get containers in this network
//     const containers = networksData[networkName]?.containers || [];
//     let mergedLogs = [];

//     // Assign a color to each container
//     const colorPalette = [
//         '#4A9EFF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f472b6', '#eab308'
//     ];
//     const containerColors = {};
//     containers.forEach((container, idx) => {
//         containerColors[container.name] = colorPalette[idx % colorPalette.length];
//     });

//     // Collect logs with container name and timestamp
//     containers.forEach(container => {
//         const logs = generateContainerLogs(container.name).split('\n');
//         logs.forEach(line => {
//             if (line.trim()) {
//                 const tsMatch = line.match(/\[(.*?)\]/);
//                 mergedLogs.push({
//                     container: container.name,
//                     line: line,
//                     timestamp: tsMatch ? tsMatch[1] : ''
//                 });
//             }
//         });
//     });

//     // Sort by timestamp
//     mergedLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
//     const maxNameLen = Math.max(...containers.map(c => c.name.length), 10);

//     // Store for refresh/filter
//     currentNetworkLogs = mergedLogs;
//     currentContainerColors = containerColors;
//     currentMaxNameLen = maxNameLen;

//     // Render
//     document.getElementById('network-logs-content').innerHTML =
//         renderNetworkLogs(mergedLogs, containerColors, maxNameLen, document.getElementById('network-log-level-filter').value);
// }

// // Refresh network logs
// function refreshNetworkLogs() {
//     if (currentNetworkName) {
//         viewNetworkLogs(currentNetworkName);
//     }
// }

// // Filter network logs
// function filterNetworkLogs() {
//     document.getElementById('network-logs-content').innerHTML =
//         renderNetworkLogs(currentNetworkLogs, currentContainerColors, currentMaxNameLen, document.getElementById('network-log-level-filter').value);
// }

// // Generate simulated network logs
// function generateNetworkLogs(networkName) {
//     const logEntries = [];
//     const containers = networksData[networkName]?.containers || [];

//     for (let i = 0; i < 50; i++) {
//         const timestamp = new Date(Date.now() - Math.random() * 3600000).toISOString();
//         const container = containers[Math.floor(Math.random() * containers.length)];
//         const logTypes = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
//         const logType = logTypes[Math.floor(Math.random() * logTypes.length)];
        
//         const messages = [
//             `Container ${container?.name || 'unknown'} connected to network ${networkName}`,
//             `Network traffic: ${Math.floor(Math.random() * 1000)}KB/s`,
//             `DNS resolution for ${container?.name || 'unknown'}`,
//             `Port mapping updated for container ${container?.name || 'unknown'}`,
//             `Network bridge configuration changed`,
//             `Container ${container?.name || 'unknown'} disconnected from network`
//         ];
        
//         const message = messages[Math.floor(Math.random() * messages.length)];
//         logEntries.push(`[${timestamp}] ${logType}: ${message}`);
//     }

//     return logEntries.join('\n');
// }

// // Close network logs modal
// function closeNetworkLogs() {
//     document.getElementById('network-logs-modal').classList.remove('show');
// }

// // Filter network logs
// function filterNetworkLogs() {
//     const level = document.getElementById('network-log-level-filter').value;
//     const logsContent = document.getElementById('network-logs-content');
//     const allLogs = logsContent.textContent;

//     if (level === 'all') {
//         return;
//     }

//     const lines = allLogs.split('\n');
//     const filtered = lines.filter(line => {
//         const lowerLine = line.toLowerCase();
//         switch(level) {
//             case 'error':
//                 return lowerLine.includes('error');
//             case 'warning':
//                 return lowerLine.includes('warn') || lowerLine.includes('error');
//             case 'info':
//                 return lowerLine.includes('info') || lowerLine.includes('warn') || lowerLine.includes('error');
//             default:
//                 return true;
//         }
//     });

//     logsContent.textContent = filtered.join('\n');
// }

// // Refresh network logs
// function refreshNetworkLogs() {
//     const networkName = document.getElementById('network-logs-title').textContent.split(' ')[0];
//     const logs = generateNetworkLogs(networkName);
//     document.getElementById('network-logs-content').textContent = logs;
// }

// // Download network logs
// function downloadNetworkLogs() {
//     const networkName = document.getElementById('network-logs-title').textContent.split(' ')[0];
//     const logs = document.getElementById('network-logs-content').textContent;
//     const blob = new Blob([logs], { type: 'text/plain' });
//     const url = window.URL.createObjectURL(blob);
//     const a = document.createElement('a');
//     a.href = url;
//     a.download = `${networkName}-network-logs-${new Date().toISOString().slice(0, 19)}.txt`;
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     window.URL.revokeObjectURL(url);
// }

// Update sidebar containers (fallback when not grouping by network)
function updateSidebar(containers) {
    const networksContainer = document.getElementById('networks-container');
    if (!networksContainer) return;

    networksContainer.innerHTML = `
        <div class="network-group">
            <div class="network-header">
                <div class="network-info">
                    <span class="network-name">All Containers</span>
                    <span class="network-badge">${containers.length}</span>
                </div>
            </div>
            <div class="network-containers">
                ${containers.map(container => `
                    <div class="container-item" onclick="window.location.href='/container/${container.id}'">
                        <div class="status-dot status-${container.status.toLowerCase()}"></div>
                        <span class="container-name">${container.name}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Update containers table
function updateContainersTable(containers) {
    const tableBody = document.getElementById('containers-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = containers.map(container => `
        <tr>
            <td data-label="Name">
                <div class="container-name-cell">
                    <div class="status-dot status-${container.status.toLowerCase()}"></div>
                    <a href="/container/${container.id}" style="color: #4A9EFF; text-decoration: none;">
                        ${container.name}
                    </a>
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
            <td data-label="Network">${(Math.random() * 10).toFixed(1)} KB/s</td>
            <td data-label="Image">${container.image}</td>
            <td data-label="Container ID"><code>${container.id.substring(0, 12)}</code></td>
            <td data-label="Created">${formatTimeAgo(container.created)}</td>
            <td data-label="Actions">
                <div class="action-buttons">
                    ${container.status.toLowerCase() === 'running' ? 
                        `<button class="action-btn stop tooltip" data-tooltip="Stop container" onclick="controlContainer('${container.id}', 'stop')">Stop</button>` :
                        `<button class="action-btn start tooltip" data-tooltip="Start container" onclick="controlContainer('${container.id}', 'start')">Start</button>`
                    }
                    <button class="action-btn restart tooltip" data-tooltip="Restart container" onclick="controlContainer('${container.id}', 'restart')" ${container.status.toLowerCase() !== 'running' ? 'disabled' : ''}>Restart</button>
                    <button class="action-btn remove tooltip" data-tooltip="Remove container" onclick="confirmRemoveContainer('${container.id}', '${container.name}')">Remove</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Container control functions with better UX and activity logging
async function controlContainer(containerId, action) {
    if (isLoading) return;

    const button = event.target;
    const originalText = button.textContent;

    // Show loading state
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>';

    try {
        const response = await fetch(`/container/${containerId}/${action}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            // Show success feedback
            button.textContent = 'Done!';
            button.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
            
            // Add activity
            addActivity('success', `Container ${action}`, `Successfully ${action}ed container ${containerId.substring(0, 12)}`);
            
            // Reload containers after action
            setTimeout(() => {
                loadContainers();
            }, 1000);
        } else {
            throw new Error(`Failed to ${action} container`);
        }
    } catch (error) {
        console.error(`Error ${action} container:`, error);
        button.textContent = 'Error';
        button.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        
        // Add error activity
        addActivity('error', `Container ${action} Failed`, `Failed to ${action} container ${containerId.substring(0, 12)}`);
        
        // Reset button after 2 seconds
        setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = '';
            button.disabled = false;
        }, 2000);
    }
}

// Confirm remove container with modal
function confirmRemoveContainer(containerId, containerName) {
    showConfirmModal(
        'Remove Container',
        `Are you sure you want to remove container "${containerName}"? This action cannot be undone.`,
        () => controlContainer(containerId, 'remove')
    );
}

// Intersection Observer for performance optimization
const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Show initial loading
    showLoading();

    try {
        // Load settings
        loadSettings();
        
        // Initialize charts
        initializeCharts();
        
        // Initialize activities
        updateActivitiesList();
        
        // Load initial data
        await Promise.all([
            loadSystemStats(),
            loadContainers()
        ]);
        
        window.systemStatsInterval = setInterval(loadSystemStats, 5000);

        // Apply settings
        applySettings();
        
        // Observe elements for performance
        document.querySelectorAll('.resource-card, .container-overview').forEach(el => {
            observer.observe(el);
        });
        
    } catch (error) {
        console.error('Error initializing application:', error);
        addActivity('error', 'Initialization Error', 'Failed to initialize application');
    } finally {
        hideLoading();
    }
});

// Handle window resize for charts with throttling
window.addEventListener('resize', throttle(() => {
    if (cpuChart) cpuChart.draw();
    if (memoryChart) memoryChart.draw();
    if (networkChart) networkChart.draw();
}, 250));

// Global functions
window.controlContainer = controlContainer;
window.confirmRemoveContainer = confirmRemoveContainer;
window.showActivities = showActivities;
window.closeActivities = closeActivities;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.refreshAll = refreshAll;
window.toggleNetwork = toggleNetwork;
window.viewNetworkLogs = viewNetworkLogs;
window.closeNetworkLogs = closeNetworkLogs;
window.filterNetworkLogs = filterNetworkLogs;
window.refreshNetworkLogs = refreshNetworkLogs;
window.downloadNetworkLogs = downloadNetworkLogs;

// Cleanup intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
    if (window.systemStatsInterval) clearInterval(window.systemStatsInterval);
    if (window.containersInterval) clearInterval(window.containersInterval);
});