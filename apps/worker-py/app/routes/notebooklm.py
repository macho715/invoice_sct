"""POST /v1/notebooklm/run — orchestrate MarkItDown + NotebookLM extraction."""
import logging
from fastapi import APIRouter, HTTPException

from app.notebooklm.schemas import NotebookLmRunRequest, NotebookLmRunResponse
from app.notebooklm.orchestrator import NotebookLmOrchestrator

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/notebooklm/run", response_model=NotebookLmRunResponse)
async def run_notebooklm(request: NotebookLmRunRequest) -> NotebookLmRunResponse:
    try:
        orchestrator = NotebookLmOrchestrator()
        result = await orchestrator.run(
            job_id=request.job_id,
            blob_url=request.blob_url,
            notebook_id=request.notebook_id,
        )
    except Exception as e:
        # Log error code, not raw input
        logger.error("notebooklm run failed: %s", type(e).__name__)
        return NotebookLmRunResponse(
            job_id=request.job_id,
            status="NOTEBOOKLM_UNAVAILABLE",
            error_code=type(e).__name__,
        )

    return NotebookLmRunResponse(
        job_id=request.job_id,
        status=result.get("status", "NOTEBOOKLM_UNAVAILABLE"),
        notebooklm_source_id=result.get("notebooklm_source_id"),
        markdown_sha256=result.get("markdown_sha256"),
        source_sha256=result.get("source_sha256"),
        callback_status=result.get("callback_status"),
        error_code=result.get("error_code"),
    )
