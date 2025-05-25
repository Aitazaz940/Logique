import docker
import psutil
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging

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
        except Exception as e:
            logger.error(f"Failed to initialize Docker client: {e}")
            raise

    def get_system_stats(self):
        """Get comprehensive system statistics"""
        try:
            # Get boot time for accurate uptime
            boot_time = psutil.boot_time()
            uptime_seconds = time.time() - boot_time
            
            # Get load averages (Unix-like systems)
            try:
                load_avg = psutil.getloadavg()
                load_1min = round(load_avg[0], 2)
            except (AttributeError, OSError):
                # Windows doesn't have load average
                load_1min = round(psutil.cpu_percent(interval=0.1) / 100, 2)
            
            # Network I/O stats
            net_io = psutil.net_io_counters()
            
            return {
                "cpu_cores": psutil.cpu_count(logical=True),
                "cpu_usage_percent": round(psutil.cpu_percent(interval=1), 2),
                "memory": {
                    "total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
                    "used_memory": round(psutil.virtual_memory().used / (1024**3), 2),
                    "used_percent": round(psutil.virtual_memory().percent, 2),
                    "available_gb": round(psutil.virtual_memory().available / (1024**3), 2)
                },
                "disk": {
                    "total_gb": round(psutil.disk_usage('/').total / (1024**3), 2),
                    "used_gb": round(psutil.disk_usage('/').used / (1024**3), 2),
                    "used_percent": round(psutil.disk_usage('/').percent, 2),
                    "free_gb": round(psutil.disk_usage('/').free / (1024**3), 2)
                },
                "network": {
                    "bytes_sent": net_io.bytes_sent,
                    "bytes_recv": net_io.bytes_recv,
                    "packets_sent": net_io.packets_sent,
                    "packets_recv": net_io.packets_recv
                },
                "uptime_seconds": int(uptime_seconds),
                "load_average": load_1min,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
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
            "load_average": 0.0,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    def get_containers_info(self):
        """Get detailed information about all containers"""
        try:
            containers = self.client.containers.list(all=True)
            container_info_list = []

            def process_container(container):
                try:
                    cpu_percent = 0.0
                    mem_usage_mb = 0.0
                    mem_limit_mb = 1.0
                    mem_percent = 0.0
                    network_rx_mb = 0.0
                    network_tx_mb = 0.0

                    # Get container creation time
                    created_time = container.attrs.get('Created', '')
                    if created_time:
                        try:
                            created_dt = datetime.fromisoformat(created_time.replace('Z', '+00:00'))
                            created_time = created_dt.isoformat()
                        except:
                            pass

                    # Get network information
                    networks = []
                    network_settings = container.attrs.get('NetworkSettings', {})
                    if network_settings.get('Networks'):
                        networks = list(network_settings['Networks'].keys())

                    # Get stats for running containers
                    if container.status == "running":
                        try:
                            stats = container.stats(stream=False)
                            
                            # Calculate CPU percentage
                            cpu_percent = self._calculate_cpu_percent(stats)
                            
                            # Calculate memory usage
                            memory_stats = stats.get("memory_stats", {})
                            mem_usage_bytes = memory_stats.get("usage", 0)
                            mem_limit_bytes = memory_stats.get("limit", 1)
                            
                            mem_usage_mb = mem_usage_bytes / (1024 ** 2)
                            mem_limit_mb = mem_limit_bytes / (1024 ** 2)
                            mem_percent = (mem_usage_mb / mem_limit_mb) * 100 if mem_limit_mb else 0
                            
                            # Calculate network I/O
                            networks_stats = stats.get("networks", {})
                            total_rx = sum(net.get("rx_bytes", 0) for net in networks_stats.values())
                            total_tx = sum(net.get("tx_bytes", 0) for net in networks_stats.values())
                            network_rx_mb = total_rx / (1024 ** 2)
                            network_tx_mb = total_tx / (1024 ** 2)
                            
                        except Exception as e:
                            logger.warning(f"Could not retrieve stats for container {container.name}: {e}")

                    return {
                        "id": container.id,
                        "short_id": container.short_id,
                        "name": container.name,
                        "status": container.status,
                        "image": container.image.tags[0] if container.image.tags else container.image.id[:12],
                        "created": created_time,
                        "cpu_percent": round(cpu_percent, 2),
                        "memory_usage_mb": round(mem_usage_mb, 2),
                        "memory_limit_mb": round(mem_limit_mb, 2),
                        "memory_percent": round(mem_percent, 2),
                        "network_rx_mb": round(network_rx_mb, 2),
                        "network_tx_mb": round(network_tx_mb, 2),
                        "networks": networks,
                        "ports": self._get_container_ports(container),
                        "labels": container.labels,
                        "state": container.attrs.get('State', {}),
                        "restart_count": container.attrs.get('RestartCount', 0)
                    }
                except Exception as e:
                    logger.error(f"Error processing container {getattr(container, 'name', 'unknown')}: {e}")
                    return None

            # Process containers in parallel
            with ThreadPoolExecutor(max_workers=10) as executor:
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
        """Extract port mappings from container"""
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
        except:
            return []

    def _calculate_cpu_percent(self, stats):
        """Calculate CPU percentage with improved accuracy"""
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
            logger.error(f"Error calculating CPU percent: {e}")
            return 0.0

    def get_container_details(self, container_id):
        """Get detailed information about a specific container"""
        try:
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
                "labels": container.labels,
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
                        except:
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
            
            return container_info
            
        except docker.errors.NotFound:
            logger.error(f"Container {container_id} not found")
            return None
        except Exception as e:
            logger.error(f"Error getting container details for {container_id}: {e}")
            return None

    def get_container_logs(self, container_id, tail=1000, since=None, follow=False):
        """Get container logs with enhanced options"""
        try:
            container = self.client.containers.get(container_id)
            
            # Prepare log options
            log_options = {
                'stdout': True,
                'stderr': True,
                'timestamps': True,
                'tail': tail
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
            return f"Error: Container {container_id} not found"
        except Exception as e:
            logger.error(f"Error getting logs for container {container_id}: {e}")
            return f"Error retrieving logs: {str(e)}"

    def get_container_networks(self):
        """Get all Docker networks and their containers"""
        try:
            networks = self.client.networks.list()
            network_info = {}
            
            for network in networks:
                containers_in_network = []
                for container_id, container_info in network.attrs.get('Containers', {}).items():
                    try:
                        container = self.client.containers.get(container_id)
                        containers_in_network.append({
                            'id': container.id,
                            'name': container.name,
                            'status': container.status,
                            'ip_address': container_info.get('IPv4Address', '').split('/')[0]
                        })
                    except:
                        continue
                
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
                    'containers': containers_in_network,
                    'subnet': subnet
                }
            
            return network_info
        except Exception as e:
            logger.error(f"Error getting network information: {e}")
            return {}

    # Container control methods
    def start_container(self, container_id):
        """Start a container"""
        try:
            container = self.client.containers.get(container_id)
            container.start()
            logger.info(f"Started container {container.name}")
            return True
        except Exception as e:
            logger.error(f"Error starting container {container_id}: {e}")
            raise

    def stop_container(self, container_id):
        """Stop a container"""
        try:
            container = self.client.containers.get(container_id)
            container.stop()
            logger.info(f"Stopped container {container.name}")
            return True
        except Exception as e:
            logger.error(f"Error stopping container {container_id}: {e}")
            raise

    def restart_container(self, container_id):
        """Restart a container"""
        try:
            container = self.client.containers.get(container_id)
            container.restart()
            logger.info(f"Restarted container {container.name}")
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
            return True
        except Exception as e:
            logger.error(f"Error removing container {container_id}: {e}")
            raise

    def get_docker_info(self):
        """Get Docker daemon information"""
        try:
            return self.client.info()
        except Exception as e:
            logger.error(f"Error getting Docker info: {e}")
            return {}