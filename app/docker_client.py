import docker
import psutil
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from functools import lru_cache
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DockerClient:
    def __init__(self):
        try:
            self.client = docker.from_env()
            # Test connection
            self.client.ping()
            logger.info("Docker client initialized successfully")

            # Performance optimization: Cache frequently accessed data
            self._stats_cache = {}
            self._cache_lock = threading.Lock()
            self._cache_timeout = 5  # seconds

        except Exception as e:
            logger.error(f"Failed to initialize Docker client: {e}")
            raise

    @lru_cache(maxsize=1)
    def _get_cpu_count(self):
        """Cache CPU count as it doesn't change"""
        return psutil.cpu_count(logical=True)

    def get_system_stats(self):
        """Get comprehensive system statistics with caching"""
        try:
            # Check cache first
            with self._cache_lock:
                now = time.time()
                if 'system_stats' in self._stats_cache:
                    cache_time, cached_data = self._stats_cache['system_stats']
                    if now - cache_time < self._cache_timeout:
                        return cached_data

            # Get boot time for accurate uptime
            boot_time = psutil.boot_time()
            uptime_seconds = time.time() - boot_time

            # Get load averages (Unix-like systems) with error handling
            try:
                load_avg = psutil.getloadavg()
                load_1min = round(load_avg[0], 2)
                load_5min = round(load_avg[1], 2)
                load_15min = round(load_avg[2], 2)
            except (AttributeError, OSError):
                # Windows doesn't have load average
                load_1min = load_5min = load_15min = None

            # Network I/O stats with error handling
            try:
                net_io = psutil.net_io_counters()
                network_data = {
                    "bytes_sent": net_io.bytes_sent,
                    "bytes_recv": net_io.bytes_recv,
                    "packets_sent": net_io.packets_sent,
                    "packets_recv": net_io.packets_recv
                }
            except Exception as e:
                logger.warning(f"Could not get network stats: {e}")
                network_data = {
                    "bytes_sent": 0,
                    "bytes_recv": 0,
                    "packets_sent": 0,
                    "packets_recv": 0
                }

            # Memory stats with error handling
            try:
                memory = psutil.virtual_memory()
                memory_data = {
                    "total_gb": round(memory.total / (1024**3), 2),
                    "used_memory": round(memory.used / (1024**3), 2),
                    "used_percent": round(memory.percent, 2),
                    "available_gb": round(memory.available / (1024**3), 2)
                }
            except Exception as e:
                logger.warning(f"Could not get memory stats: {e}")
                memory_data = {
                    "total_gb": 0,
                    "used_memory": 0,
                    "used_percent": 0,
                    "available_gb": 0
                }

            # Disk stats with error handling
            try:
                disk = psutil.disk_usage('/')
                disk_data = {
                    "total_gb": round(disk.total / (1024**3), 2),
                    "used_gb": round(disk.used / (1024**3), 2),
                    "used_percent": round((disk.used / disk.total) * 100, 2),
                    "free_gb": round(disk.free / (1024**3), 2)
                }
            except Exception as e:
                logger.warning(f"Could not get disk stats: {e}")
                disk_data = {
                    "total_gb": 0,
                    "used_gb": 0,
                    "used_percent": 0,
                    "free_gb": 0
                }

            # CPU usage with timeout
            try:
                # Warm up psutil's CPU percent calculation if needed
                if not hasattr(self, "_cpu_percent_warmed"):
                    psutil.cpu_percent(interval=None)
                    self._cpu_percent_warmed = True
                cpu_percent = psutil.cpu_percent(interval=None)
            except Exception as e:
                logger.warning(f"Could not get CPU stats: {e}")
                cpu_percent = 0.0

            stats_data = {
                "cpu_cores": self._get_cpu_count(),
                "cpu_usage_percent": round(cpu_percent, 2),
                "memory": memory_data,
                "disk": disk_data,
                "network": network_data,
                "load_average": {
                    "1min": load_1min,
                    "5min": load_5min,
                    "15min": load_15min
                },
                "uptime_seconds": int(uptime_seconds),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

            # Cache the result
            with self._cache_lock:
                self._stats_cache['system_stats'] = (time.time(), stats_data)

            return stats_data

        except Exception as e:
            logger.error(f"Error getting system stats: {e}")
            return self._get_fallback_system_stats()

    def _get_fallback_system_stats(self):
        """Fallback system stats in case of errors"""
        return {
            "cpu_cores": 1,
            "cpu_usage_percent": 0.0,
            "memory": {"total_gb": 0, "used_memory": 0, "used_percent": 0, "available_gb": 0},
            "disk": {"total_gb": 0, "used_gb": 0, "used_percent": 0, "free_gb": 0},
            "network": {"bytes_sent": 0, "bytes_recv": 0, "packets_sent": 0, "packets_recv": 0},
            "uptime_seconds": 0,
            "load_average": {"1min": 0.0, "5min": 0.0, "15min": 0.0},
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    def get_containers_info(self):
        """Get detailed information about all containers with optimized parallel processing"""
        try:
            containers = self.client.containers.list(all=True)
            container_info_list = []

            def process_container(container):
                try:
                    # Initialize default values
                    cpu_percent = 0.0
                    mem_usage_mb = 0.0
                    mem_limit_mb = 1.0
                    mem_percent = 0.0
                    network_rx_mb = 0.0
                    network_tx_mb = 0.0

                    # Get container creation time with error handling
                    created_time = container.attrs.get('Created', '')
                    if created_time:
                        try:
                            created_dt = datetime.fromisoformat(created_time.replace('Z', '+00:00'))
                            created_time = created_dt.isoformat()
                        except Exception:
                            pass

                    # Get network information with error handling
                    networks = []
                    try:
                        network_settings = container.attrs.get('NetworkSettings', {})
                        if network_settings.get('Networks'):
                            networks = list(network_settings['Networks'].keys())
                    except Exception:
                        pass

                    # Get image name with fallback
                    try:
                        image_name = container.image.tags[0] if container.image.tags else container.image.id[:12]
                    except Exception:
                        image_name = "unknown"

                    # Get stats for running containers only (performance optimization)
                    if container.status == "running":
                        try:
                            # Use timeout to prevent hanging
                            stats = container.stats(stream=False)

                            # Calculate CPU percentage with error handling
                            cpu_percent = self._calculate_cpu_percent(stats)

                            # Calculate memory usage with error handling
                            memory_stats = stats.get("memory_stats", {})
                            mem_usage_bytes = memory_stats.get("usage", 0)
                            mem_limit_bytes = memory_stats.get("limit", 1)

                            if mem_usage_bytes and mem_limit_bytes:
                                mem_usage_mb = mem_usage_bytes / (1024 ** 2)
                                mem_limit_mb = mem_limit_bytes / (1024 ** 2)
                                mem_percent = (mem_usage_mb / mem_limit_mb) * 100 if mem_limit_mb else 0

                            # Calculate network I/O with error handling
                            networks_stats = stats.get("networks", {})
                            if networks_stats:
                                total_rx = sum(net.get("rx_bytes", 0) for net in networks_stats.values())
                                total_tx = sum(net.get("tx_bytes", 0) for net in networks_stats.values())
                                network_rx_mb = total_rx / (1024 ** 2)
                                network_tx_mb = total_tx / (1024 ** 2)

                        except Exception as e:
                            logger.debug(f"Could not retrieve stats for container {container.name}: {e}")

                    return {
                        "id": container.id,
                        "short_id": container.short_id,
                        "name": container.name,
                        "status": container.status,
                        "image": image_name,
                        "created": created_time,
                        "cpu_percent": round(cpu_percent, 2),
                        "memory_usage_mb": round(mem_usage_mb, 2),
                        "memory_limit_mb": round(mem_limit_mb, 2),
                        "memory_percent": round(mem_percent, 2),
                        "network_rx_mb": round(network_rx_mb, 2),
                        "network_tx_mb": round(network_tx_mb, 2),
                        "networks": networks,
                        "ports": self._get_container_ports(container),
                        "labels": container.labels or {},
                        "state": container.attrs.get('State', {}),
                        "restart_count": container.attrs.get('RestartCount', 0)
                    }
                except Exception as e:
                    logger.error(f"Error processing container {getattr(container, 'name', 'unknown')}: {e}")
                    return None

            # Process containers in parallel with reduced thread count for better performance
            max_workers = min(8, len(containers))  # Limit concurrent threads
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(process_container, c): c for c in containers}
                for future in as_completed(futures):
                    result = future.result()
                    if result:
                        container_info_list.append(result)

            return container_info_list
        except Exception as e:
            logger.error(f"Error getting containers info: {e}")
            return []

    def _get_container_ports(self, container):
        """Extract port mappings from container with error handling"""
        try:
            ports = container.attrs.get('NetworkSettings', {}).get('Ports', {})
            port_mappings = []
            for container_port, host_bindings in ports.items():
                if host_bindings:
                    for binding in host_bindings:
                        port_mappings.append(f"{binding['HostPort']}:{container_port}")
                else:
                    port_mappings.append(container_port)
            return port_mappings
        except Exception:
            return []

    def _calculate_cpu_percent(self, stats):
        """Calculate CPU percentage with improved accuracy and error handling"""
        try:
            cpu_stats = stats.get("cpu_stats", {})
            precpu_stats = stats.get("precpu_stats", {})

            cpu_usage = cpu_stats.get("cpu_usage", {})
            precpu_usage = precpu_stats.get("cpu_usage", {})

            cpu_total = cpu_usage.get("total_usage", 0)
            cpu_prev_total = precpu_usage.get("total_usage", 0)

            system_cpu = cpu_stats.get("system_cpu_usage", 0)
            system_prev_cpu = precpu_stats.get("system_cpu_usage", 0)

            cpu_delta = cpu_total - cpu_prev_total
            system_delta = system_cpu - system_prev_cpu

            online_cpus = cpu_stats.get("online_cpus", len(cpu_usage.get("percpu_usage", [1])))

            if system_delta > 0 and cpu_delta >= 0:
                return (cpu_delta / system_delta) * online_cpus * 100.0
            return 0.0
        except Exception as e:
            logger.debug(f"Error calculating CPU percent: {e}")
            return 0.0

    def get_container_details(self, container_id):
        """Get detailed information about a specific container with caching"""
        try:
            # Check cache first
            cache_key = f"container_details_{container_id}"
            with self._cache_lock:
                if cache_key in self._stats_cache:
                    cache_time, cached_data = self._stats_cache[cache_key]
                    if time.time() - cache_time < 2:  # 2 second cache for container details
                        return cached_data

            container = self.client.containers.get(container_id)

            # Get basic container info
            container_info = {
                "id": container.id,
                "short_id": container.short_id,
                "name": container.name,
                "status": container.status,
                "image": container.image.tags[0] if container.image.tags else container.image.id[:12],
                "created": container.attrs.get('Created', ''),
                "started": container.attrs.get('State', {}).get('StartedAt', ''),
                "finished": container.attrs.get('State', {}).get('FinishedAt', ''),
                "restart_count": container.attrs.get('RestartCount', 0),
                "platform": container.attrs.get('Platform', 'unknown'),
                "networks": list(container.attrs.get('NetworkSettings', {}).get('Networks', {}).keys()),
                "ports": self._get_container_ports(container),
                "mounts": [mount['Source'] + ':' + mount['Destination'] for mount in container.attrs.get('Mounts', [])],
                "env_vars": container.attrs.get('Config', {}).get('Env', []),
                "labels": container.labels or {},
                "state": container.attrs.get('State', {})
            }

            # Get real-time stats for running containers
            if container.status == "running":
                try:
                    stats = container.stats(stream=False)

                    # CPU stats
                    cpu_percent = self._calculate_cpu_percent(stats)

                    # Memory stats
                    memory_stats = stats.get("memory_stats", {})
                    mem_usage = memory_stats.get("usage", 0)
                    mem_limit = memory_stats.get("limit", 1)
                    mem_cache = memory_stats.get("stats", {}).get("cache", 0)

                    # Network stats
                    networks_stats = stats.get("networks", {})
                    total_rx = sum(net.get("rx_bytes", 0) for net in networks_stats.values())
                    total_tx = sum(net.get("tx_bytes", 0) for net in networks_stats.values())

                    # Block I/O stats
                    blkio_stats = stats.get("blkio_stats", {})
                    io_read = sum(item.get("value", 0) for item in blkio_stats.get("io_service_bytes_recursive", []) if item.get("op") == "Read")
                    io_write = sum(item.get("value", 0) for item in blkio_stats.get("io_service_bytes_recursive", []) if item.get("op") == "Write")

                    container_info.update({
                        "cpu_percent": round(cpu_percent, 2),
                        "memory_usage_mb": round(mem_usage / (1024**2), 2),
                        "memory_limit_mb": round(mem_limit / (1024**2), 2),
                        "memory_percent": round((mem_usage / mem_limit) * 100, 2) if mem_limit else 0,
                        "memory_cache_mb": round(mem_cache / (1024**2), 2),
                        "network_rx_mb": round(total_rx / (1024**2), 2),
                        "network_tx_mb": round(total_tx / (1024**2), 2),
                        "block_read_mb": round(io_read / (1024**2), 2),
                        "block_write_mb": round(io_write / (1024**2), 2)
                    })

                    # Calculate uptime for running containers
                    started_at = container_info.get('started')
                    if started_at:
                        try:
                            started_dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                            uptime_seconds = (datetime.now(timezone.utc) - started_dt).total_seconds()
                            container_info['uptime_seconds'] = int(uptime_seconds)
                        except Exception:
                            container_info['uptime_seconds'] = 0

                except Exception as e:
                    logger.warning(f"Could not retrieve real-time stats for container {container.name}: {e}")
                    # Set default values for stats
                    container_info.update({
                        "cpu_percent": 0.0,
                        "memory_usage_mb": 0.0,
                        "memory_limit_mb": 0.0,
                        "memory_percent": 0.0,
                        "memory_cache_mb": 0.0,
                        "network_rx_mb": 0.0,
                        "network_tx_mb": 0.0,
                        "block_read_mb": 0.0,
                        "block_write_mb": 0.0,
                        "uptime_seconds": 0
                    })
            else:
                # Container is not running, set stats to zero
                container_info.update({
                    "cpu_percent": 0.0,
                    "memory_usage_mb": 0.0,
                    "memory_limit_mb": 0.0,
                    "memory_percent": 0.0,
                    "memory_cache_mb": 0.0,
                    "network_rx_mb": 0.0,
                    "network_tx_mb": 0.0,
                    "block_read_mb": 0.0,
                    "block_write_mb": 0.0,
                    "uptime_seconds": 0
                })

            # Cache the result
            with self._cache_lock:
                self._stats_cache[cache_key] = (time.time(), container_info)

            return container_info

        except docker.errors.NotFound:
            logger.error(f"Container {container_id} not found")
            return None
        except Exception as e:
            logger.error(f"Error getting container details for {container_id}: {e}")
            return None

    def get_container_logs(self, container_id, tail=1000, since=None, follow=False):
        """Get container logs with enhanced options and error handling"""
        try:
            container = self.client.containers.get(container_id)

            # Prepare log options
            log_options = {
                'stdout': True,
                'stderr': True,
                'timestamps': True,
                'tail': min(tail, 5000)  # Limit max tail for performance
            }

            if since:
                log_options['since'] = since

            if follow:
                log_options['stream'] = True
                log_options['follow'] = True

            logs = container.logs(**log_options)

            if follow:
                return logs  # Return generator for streaming
            else:
                return logs.decode('utf-8', errors='replace')

        except docker.errors.NotFound:
            logger.error(f"Container {container_id} not found")
            return ""
        except Exception as e:
            logger.error(f"Error getting logs for container {container_id}: {e}")
            return ""

    def get_container_networks(self):
        """Return all Docker networks with the containers connected to each - optimized"""
        try:
            # Check cache first
            cache_key = "container_networks"
            with self._cache_lock:
                if cache_key in self._stats_cache:
                    cache_time, cached_data = self._stats_cache[cache_key]
                    if time.time() - cache_time < 10:  # 10 second cache for networks
                        return cached_data

            networks = self.client.networks.list()
            network_info = {}

            # Step 1: Initialize each network
            for network in networks:
                try:
                    config = network.attrs.get('IPAM', {}).get('Config')
                    if isinstance(config, list) and config and isinstance(config[0], dict):
                        subnet = config[0].get('Subnet', 'unknown')
                    else:
                        subnet = 'unknown'

                    network_info[network.name] = {
                        'id': network.id,
                        'name': network.name,
                        'driver': network.attrs.get('Driver', 'unknown'),
                        'scope': network.attrs.get('Scope', 'unknown'),
                        'created': network.attrs.get('Created', ''),
                        'containers': [],
                        'subnet': subnet
                    }
                except Exception as e:
                    logger.warning(f"Error processing network {network.name}: {e}")

            # Step 2: Add containers into networks based on their NetworkSettings
            containers = self.client.containers.list(all=True)
            for container in containers:
                try:
                    container_id = container.id
                    container_name = container.name
                    container_status = container.status
                    container_networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})

                    for net_name, net_info in container_networks.items():
                        if net_name in network_info:
                            network_info[net_name]["containers"].append({
                                'id': container_id,
                                'name': container_name,
                                'status': container_status,
                                'ip_address': net_info.get('IPAddress', '')
                            })
                except Exception as e:
                    logger.warning(f"Error processing container {container.name} networks: {e}")

            # Cache the result
            with self._cache_lock:
                self._stats_cache[cache_key] = (time.time(), network_info)

            return network_info
        except Exception as e:
            logger.error(f"Error getting network information: {e}")
            return {}

    # Container control methods with better error handling
    def start_container(self, container_id):
        """Start a container"""
        try:
            container = self.client.containers.get(container_id)
            container.start()
            logger.info(f"Started container {container.name}")

            # Clear cache for this container
            self._clear_container_cache(container_id)
            return True
        except Exception as e:
            logger.error(f"Error starting container {container_id}: {e}")
            raise

    def stop_container(self, container_id):
        """Stop a container"""
        try:
            container = self.client.containers.get(container_id)
            container.stop(timeout=10)  # Add timeout for better performance
            logger.info(f"Stopped container {container.name}")

            # Clear cache for this container
            self._clear_container_cache(container_id)
            return True
        except Exception as e:
            logger.error(f"Error stopping container {container_id}: {e}")
            raise

    def restart_container(self, container_id):
        """Restart a container"""
        try:
            container = self.client.containers.get(container_id)
            container.restart(timeout=10)  # Add timeout for better performance
            logger.info(f"Restarted container {container.name}")

            # Clear cache for this container
            self._clear_container_cache(container_id)
            return True
        except Exception as e:
            logger.error(f"Error restarting container {container_id}: {e}")
            raise

    def remove_container(self, container_id, force=False):
        """Remove a container"""
        try:
            container = self.client.containers.get(container_id)
            container_name = container.name
            container.remove(force=force)
            logger.info(f"Removed container {container_name}")

            # Clear cache for this container
            self._clear_container_cache(container_id)
            return True
        except Exception as e:
            logger.error(f"Error removing container {container_id}: {e}")
            raise

    def _clear_container_cache(self, container_id):
        """Clear cache entries for a specific container"""
        with self._cache_lock:
            keys_to_remove = [key for key in self._stats_cache.keys()
                            if key.startswith(f"container_details_{container_id}")]
            for key in keys_to_remove:
                del self._stats_cache[key]

            # Also clear network cache as container state changed
            if "container_networks" in self._stats_cache:
                del self._stats_cache["container_networks"]

    def get_docker_info(self):
        """Get Docker daemon information with caching"""
        try:
            # Check cache first
            cache_key = "docker_info"
            with self._cache_lock:
                if cache_key in self._stats_cache:
                    cache_time, cached_data = self._stats_cache[cache_key]
                    if time.time() - cache_time < 60:  # 1 minute cache for docker info
                        return cached_data

            info = self.client.info()

            # Cache the result
            with self._cache_lock:
                self._stats_cache[cache_key] = (time.time(), info)

            return info
        except Exception as e:
            logger.error(f"Error getting Docker info: {e}")
            return {}