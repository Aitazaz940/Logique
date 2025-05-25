from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from .docker_client import DockerClient
from datetime import datetime
import logging
import json
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Logique - Docker Management",
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
        
        containers = docker_client.get_containers_info()
        system_stats = docker_client.get_system_stats()
        networks = docker_client.get_container_networks()
        
        return templates.TemplateResponse("index.html", {
            "request": request,
            "containers": containers,
            "system_stats": system_stats,
            "networks": networks
        })
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
async def start_container(container_id: str):
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
async def stop_container(container_id: str):
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
async def restart_container(container_id: str):
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
#     uvicorn.run(
#         app,
#         host="0.0.0.0",
#         port=8000,
#         log_level="info",
#         access_log=True
#     )