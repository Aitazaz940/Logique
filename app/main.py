from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi import Form, Cookie, WebSocket, WebSocketDisconnect
from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from dateutil.parser import parse as parse_dt
from fastapi.staticfiles import StaticFiles
from .docker_client import DockerClient
from datetime import datetime
from .auth import AuthManager
from typing import Optional
import concurrent.futures
import threading
import asyncio
import logging
import queue
import json

auth_manager = AuthManager()
connected_websockets = set()
connected_container_websockets = set()
container_update_queue = asyncio.Queue()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Logique - Where Logs Make Sense",
    description="Advanced Docker container management and monitoring",
    version="2.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup templates and static files
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize Docker client
try:
    docker_client = DockerClient()
    logger.info("Docker client initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize Docker client: {e}")
    docker_client = None

def get_current_user(request: Request):
    token = request.cookies.get("logique_token")
    if not token:
        return None
    return auth_manager.verify_token(token)

@app.websocket("/ws/system")
async def websocket_system(websocket: WebSocket):
    await websocket.accept()
    connected_websockets.add(websocket)
    try:
        data = await websocket.receive_json()
        refresh_interval = data.get("refresh_interval", 10)
        # Send initial data immediately
        stats = docker_client.get_system_stats()
        containers = docker_client.get_containers_info()
        networks = docker_client.get_container_networks()
        await websocket.send_json({
            "system_stats": stats,
            "containers": containers,
            "networks": networks
        })
        while True:
            stats = docker_client.get_system_stats()
            networks = docker_client.get_container_networks()
            await websocket.send_json({
                "system_stats": stats,
                "networks": networks
            })
            await asyncio.sleep(refresh_interval)
    except WebSocketDisconnect:
        connected_websockets.discard(websocket)

@app.websocket("/ws/containers")
async def websocket_containers(websocket: WebSocket):
    await websocket.accept()
    connected_container_websockets.add(websocket)
    try:
        # Send initial container info
        containers = docker_client.get_containers_info()
        await websocket.send_json({"containers": containers})
        while True:
            # Wait for container update event
            containers = await container_update_queue.get()
            await websocket.send_json({"containers": containers})
    except WebSocketDisconnect:
        connected_container_websockets.discard(websocket)

def docker_event_listener():
    for event in docker_client.client.events(decode=True):
        if event.get("Type") == "container":
            containers = docker_client.get_containers_info()
            # Notify all connected /ws/containers clients
            for ws in list(connected_container_websockets):
                try:
                    asyncio.run_coroutine_threadsafe(
                        ws.send_json({"containers": containers}),
                        asyncio.get_event_loop()
                    )
                except Exception:
                    connected_container_websockets.discard(ws)

@app.websocket("/ws/container/{container_id}/logs")
async def websocket_container_logs(websocket: WebSocket, container_id: str, tail: int = 10):
    await websocket.accept()
    tail = min(tail, 1000)  # Limit to 1000 lines to prevent overload
    stop_event = threading.Event()
    log_queue = queue.Queue(maxsize=100)

    def log_streamer():
        try:
            container = docker_client.client.containers.get(container_id)
            for log in container.logs(stream=True, follow=True, tail=tail, timestamps=True):
                if stop_event.is_set():
                    break
                log_line = log.decode("utf-8", errors="replace").rstrip("\n")
                # Split timestamp and message
                parts = log_line.split(" ", 1)
                if len(parts) == 2:
                    timestamp, message = parts
                else:
                    timestamp, message = "", log_line
                log_obj = {"timestamp": timestamp, "line": message}
                log_queue.put(json.dumps(log_obj), timeout=1)
        except Exception as e:
            try:
                log_queue.put(f"Error: {str(e)}", timeout=1)
            except queue.Full:
                pass

    thread = threading.Thread(target=log_streamer, daemon=True)
    thread.start()

    try:
        while True:
            try:
                log_line = await asyncio.get_event_loop().run_in_executor(None, log_queue.get, True, 1)
                await websocket.send_text(log_line)
            except queue.Empty:
                # Check if websocket is still open
                if websocket.client_state.name != "CONNECTED":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        stop_event.set()
        thread.join(timeout=2)
        
@app.websocket("/ws/network/{network_name}/logs")
async def websocket_network_logs(websocket: WebSocket, network_name: str, tail: int = 10):
    await websocket.accept()
    tail = min(tail, 1000)  # Limit to 1000 lines per container to prevent overload
    stop_event = threading.Event()
    log_queue = queue.Queue(maxsize=100)

    try:
        # Get the list of containers in the specified network
        networks = docker_client.get_container_networks()
        if network_name not in networks:
            await websocket.send_text(json.dumps({"error": "Network not found"}))
            return

        container_ids = [c['id'] for c in networks[network_name]['containers']]

        def log_streamer(container_id):
            try:
                container = docker_client.client.containers.get(container_id)
                for log in container.logs(stream=True, follow=True, tail=tail, timestamps=True):
                    if stop_event.is_set():
                        break
                    log_line = log.decode("utf-8", errors="replace").rstrip("\n")
                    # Split Docker's timestamp and message
                    parts = log_line.split(" ", 1)
                    if len(parts) == 2:
                        timestamp, message = parts
                    else:
                        timestamp, message = "", log_line
                    log_obj = {
                        "container": container.name,
                        "timestamp": timestamp,
                        "line": message
                    }
                    log_queue.put(json.dumps(log_obj), timeout=1)
            except Exception as e:
                try:
                    log_queue.put(json.dumps({"error": str(e)}), timeout=1)
                except queue.Full:
                    pass

        # Start a thread for each container's log stream
        threads = []
        for container_id in container_ids:
            thread = threading.Thread(target=log_streamer, args=(container_id,), daemon=True)
            thread.start()
            threads.append(thread)

        try:
            while True:
                try:
                    log_line = await asyncio.get_event_loop().run_in_executor(None, log_queue.get, True, 1)
                    await websocket.send_text(log_line)
                except queue.Empty:
                    # Check if websocket is still open
                    if websocket.client_state.name != "CONNECTED":
                        break
        except WebSocketDisconnect:
            pass
        finally:
            stop_event.set()
            for thread in threads:
                thread.join(timeout=2)
    except Exception as e:
        await websocket.send_text(json.dumps({"error": str(e)}))

@app.get("/add-user", response_class=HTMLResponse)
async def add_user_get(request: Request):
    user = get_current_user(request)
    if not user or user.get("role") != "admin":
        return RedirectResponse("/")
    return templates.TemplateResponse("add_user.html", {"request": request})

@app.post("/add-user", response_class=HTMLResponse)
async def add_user_post(request: Request):
    user = get_current_user(request)
    if not user or user.get("role") != "admin":
        return RedirectResponse("/")
    form = await request.form()
    username = form.get("username")
    password = form.get("password")
    confirm_password = form.get("confirm_password")
    error = None
    if not username or not password or not confirm_password:
        error = "All fields are required."
    elif password != confirm_password:
        error = "Passwords do not match."
    else:
        try:
            auth_manager.create_user(username, password, role="child")
            return RedirectResponse("/", status_code=302)
        except Exception as e:
            error = str(e)
    return templates.TemplateResponse("add_user.html", {"request": request, "error": error})

@app.get("/setup", response_class=HTMLResponse)
async def setup_get(request: Request):
    if auth_manager.has_users():
        return RedirectResponse("/")
    return templates.TemplateResponse("setup.html", {"request": request})

@app.post("/setup", response_class=HTMLResponse)
async def setup_post(request: Request):
    if auth_manager.has_users():
        return RedirectResponse("/")
    form = await request.form()
    username = form.get("username")
    password = form.get("password")
    confirm_password = form.get("confirm_password")
    error = None

    if not username or not password or not confirm_password:
        error = "All fields are required."
    elif password != confirm_password:
        error = "Passwords do not match."
    else:
        try:
            auth_manager.create_user(username, password)
            # Auto-login after setup
            token = auth_manager.create_token(username)
            response = RedirectResponse("/", status_code=302)
            response.set_cookie("logique_token", token, httponly=True)
            return response
        except Exception as e:
            error = str(e)

    return templates.TemplateResponse("setup.html", {"request": request, "error": error})

@app.get("/login", response_class=HTMLResponse)
async def login_get(request: Request):
    if not auth_manager.has_users():
        return RedirectResponse("/setup")
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/login", response_class=HTMLResponse)
async def login_post(request: Request):
    form = await request.form()
    username = form.get("username")
    password = form.get("password")
    error = None

    if auth_manager.verify_password(username, password):
        token = auth_manager.create_token(username)
        response = RedirectResponse("/", status_code=302)
        response.set_cookie("logique_token", token, httponly=True)
        return response
    else:
        error = "Invalid username or password."
        return templates.TemplateResponse("login.html", {
            "request": request,
            "error": error,
            "username": username
        })

@app.get("/logout")
async def logout():
    response = RedirectResponse("/login")
    response.delete_cookie("logique_token")
    return response

def format_uptime(seconds):
    seconds = int(seconds)
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"

def current_time():
    return datetime.now().strftime("%H:%M:%S")

templates.env.filters['format_uptime'] = format_uptime

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Main dashboard page"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        if not auth_manager.has_users():
            return RedirectResponse("/setup")
        user = get_current_user(request)
        if not user:
            return RedirectResponse("/login")
        
        containers = docker_client.get_containers_info()
        system_stats = docker_client.get_system_stats()
        networks = docker_client.get_container_networks()

        response = templates.TemplateResponse("index.html", {
            "request": request,
            "containers": containers,
            "system_stats": system_stats,
            "networks": networks,
            "user": user,  # <-- ADD THIS LINE
        })    
        return response
    except Exception as e:
        logger.error(f"Error in root endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/api/system-stats")
async def get_system_stats():
    """Get current system statistics"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        return docker_client.get_system_stats()
    except Exception as e:
        logger.error(f"Error getting system stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/containers")
async def get_containers_info():
    """Get information about all containers"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        return docker_client.get_containers_info()
    except Exception as e:
        logger.error(f"Error getting containers info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/networks")
async def get_networks():
    """Get Docker networks information"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        return docker_client.get_container_networks()
    except Exception as e:
        logger.error(f"Error getting networks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/network/{network_name}/logs")
async def get_network_logs(network_name: str, tail: int = 500):
    """Get merged logs for all containers in a network, sorted by Docker timestamp"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        networks = docker_client.get_container_networks()
        if network_name not in networks:
            raise HTTPException(status_code=404, detail="Network not found")

        containers = networks[network_name]['containers']
        merged_logs = []

        for c in containers:
            logs = docker_client.get_container_logs(c['id'], tail=tail)
            if not logs.strip():
                continue
            for line in logs.splitlines():
                # Always use the first space-separated part as the Docker timestamp
                parts = line.split(' ', 1)
                if len(parts) == 2:
                    docker_ts = parts[0]
                    message = parts[1]
                else:
                    docker_ts = ""
                    message = line
                merged_logs.append({
                    "container": c['name'],
                    "line": message,
                    "timestamp": docker_ts
                })

        # Sort logs by Docker timestamp (ISO8601)
        def parse_ts(log):
            try:
                return parse_dt(log["timestamp"])
            except Exception:
                return datetime.min
        merged_logs.sort(key=parse_ts)

        return merged_logs

    except Exception as e:
        logger.error(f"Error getting network logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/container/{container_id}", response_class=HTMLResponse)
async def container_detail(request: Request, container_id: str):
    """Container detail page"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        container_details = docker_client.get_container_details(container_id)
        if not container_details:
            raise HTTPException(status_code=404, detail="Container not found")

        container_logs = docker_client.get_container_logs(container_id, tail=500)

        return templates.TemplateResponse("container_detail.html", {
            "request": request,
            "container": container_details,
            "logs": container_logs,
            "container_id": container_id,
            "current_time": current_time,  # <-- Add this line
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in container detail endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/container/{container_id}")
async def get_container_details(container_id: str):
    """Get detailed information about a specific container"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        container_details = docker_client.get_container_details(container_id)
        if not container_details:
            raise HTTPException(status_code=404, detail="Container not found")

        return container_details
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting container details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/container/{container_id}/logs")
async def get_container_logs(
    container_id: str,
    tail: Optional[int] = Query(1000, description="Number of lines to tail"),
    since: Optional[str] = Query(None, description="Show logs since timestamp"),
    follow: Optional[bool] = Query(False, description="Follow log output")
):
    """Get container logs with options"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        if follow:
            # Return streaming response for real-time logs
            def generate_logs():
                try:
                    log_stream = docker_client.get_container_logs(
                        container_id, tail=tail, since=since, follow=True
                    )
                    for log_line in log_stream:
                        yield f"data: {log_line.decode('utf-8', errors='replace')}\n\n"
                except Exception as e:
                    yield f"data: Error: {str(e)}\n\n"

            return StreamingResponse(
                generate_logs(),
                media_type="text/plain",
                headers={"Cache-Control": "no-cache"}
            )
        else:
            logs = docker_client.get_container_logs(container_id, tail=tail, since=since)
            return PlainTextResponse(logs)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting container logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Container control endpoints
@app.post("/container/{container_id}/start")
async def start_container(request: Request, container_id: str):
    """Check USER Role"""
    user = get_current_user(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")
    """Start a container"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")
        
        docker_client.start_container(container_id)
        return {"status": "started", "container_id": container_id}
    except Exception as e:
        logger.error(f"Error starting container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/container/{container_id}/stop")
async def stop_container(request: Request, container_id: str):
    """Check USER Role"""
    user = get_current_user(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")    
    """Stop a container"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        docker_client.stop_container(container_id)
        return {"status": "stopped", "container_id": container_id}
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/container/{container_id}/restart")
async def restart_container(request: Request, container_id: str):
    """Check USER Role"""
    user = get_current_user(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")    
    """Restart a container"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        docker_client.restart_container(container_id)
        return {"status": "restarted", "container_id": container_id}
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/container/{container_id}/remove")
async def remove_container(container_id: str, force: bool = Query(False)):
    """Remove a container"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        docker_client.remove_container(container_id, force=force)
        return {"status": "removed", "container_id": container_id}
    except Exception as e:
        logger.error(f"Error removing container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/docker/info")
async def get_docker_info():
    """Get Docker daemon information"""
    try:
        if not docker_client:
            raise HTTPException(status_code=500, detail="Docker client not available")

        return docker_client.get_docker_info()
    except Exception as e:
        logger.error(f"Error getting Docker info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        if not docker_client:
            return {"status": "unhealthy", "message": "Docker client not available"}

        # Test Docker connection
        docker_client.client.ping()
        return {"status": "healthy", "message": "All systems operational"}
    except Exception as e:
        return {"status": "unhealthy", "message": str(e)}

# Error handlers
@app.exception_handler(404)
async def not_found_handler(request: Request, exc: HTTPException):
    return templates.TemplateResponse("404.html", {"request": request}, status_code=404)

@app.exception_handler(500)
async def internal_error_handler(request: Request, exc: HTTPException):
    return templates.TemplateResponse("500.html", {"request": request}, status_code=500)

# if __name__ == "__main__":
#     import uvicorn
#     try:
#         uvicorn.run(
#             app,
#             host="0.0.0.0",
#             port=8000,
#             log_level="info",
#             access_log=True,
#             lifespan="off",
#         )
#     except KeyboardInterrupt:
#         print("\nShutting down gracefully. Bye!")