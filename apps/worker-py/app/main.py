"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.middleware.audit_log import AuditLogMiddleware
from app.routes.health import router as health_router
from app.routes.parse import router as parse_router
from app.routes.export import router as export_router
from app.routes.notebooklm import router as notebooklm_router
from app.routes.vision import router as vision_router
from app.telemetry import init_telemetry


def create_app() -> FastAPI:
    app = FastAPI(title='Invoice Audit Parser', version='0.1.0')

    # CORS — registered first so it wraps all subsequent middleware (incl. audit log).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # FR-025 audit log middleware — must be added AFTER CORS so it sees the
    # fully-resolved request (origin headers, etc.) and runs INSIDE the
    # CORS response handling.
    app.add_middleware(AuditLogMiddleware)

    app.include_router(health_router)
    app.include_router(parse_router)
    app.include_router(export_router, prefix="/v1")
    app.include_router(notebooklm_router, prefix="/v1")
    app.include_router(vision_router, prefix="")
    return app


app = create_app()
init_telemetry()
