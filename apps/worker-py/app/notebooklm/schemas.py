from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class NotebookLmRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=1)
    blob_url: str = Field(min_length=1)
    notebook_id: Optional[str] = None


class NotebookLmRunResponse(BaseModel):
    job_id: str
    status: str  # CALLBACK_SENT | NOTEBOOKLM_UNAVAILABLE
    notebooklm_source_id: Optional[str] = None
    markdown_sha256: Optional[str] = None
    source_sha256: Optional[str] = None
    callback_status: Optional[int] = None
    error_code: Optional[str] = None


class NotebookLmCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    job_id: str
    notebooklm_source_id: Optional[str] = None
    source_id: Optional[str] = None
    summary: Optional[dict] = None
    summary_json: Optional[dict] = None
    markdown_sha256: Optional[str] = None
    source_sha256: Optional[str] = None
    source_hash: Optional[str] = None
    received_at: Optional[str] = None
