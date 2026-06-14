"""OpenTelemetry helpers for worker-py FastAPI service.

All public functions are no-ops when OTEL_ENABLED != 'true'.
P2 attribute keys are automatically redacted before export.
"""
from __future__ import annotations

import logging
import os
import re
from contextlib import asynccontextmanager, contextmanager
from typing import Any, AsyncGenerator, Generator

logger = logging.getLogger(__name__)

_ENABLED = os.environ.get("OTEL_ENABLED", "").lower() == "true"

_P2_PATTERN = re.compile(
    r"rate|amount|price|cost|trn|boe|bl_|bol|container|vessel|email|phone|pii|password|secret|token|key",
    re.IGNORECASE,
)

_sdk_started = False


def _redact(attrs: dict[str, Any]) -> dict[str, Any]:
    """Mask attribute values whose keys match P2 patterns."""
    return {
        k: "[REDACTED]" if _P2_PATTERN.search(k) else v
        for k, v in attrs.items()
    }


def init_telemetry(service_name: str = "sct-worker-py") -> None:
    """Bootstrap OTel SDK. Call once at app startup if OTEL_ENABLED=true."""
    global _sdk_started
    if not _ENABLED or _sdk_started:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME

        resource = Resource.create({SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)
        endpoint = os.environ.get(
            "OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318/v1/traces"
        )
        exporter = OTLPSpanExporter(endpoint=endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        _sdk_started = True
        logger.info("OTel SDK started for %s → %s", service_name, endpoint)
    except ImportError:
        logger.warning("opentelemetry packages not installed; tracing disabled")


def get_tracer(name: str = "sct-worker-py"):
    """Return a tracer. Returns a no-op tracer when OTel is disabled."""
    if not _ENABLED:
        return _NoOpTracer()
    try:
        from opentelemetry import trace
        return trace.get_tracer(name)
    except Exception:
        return _NoOpTracer()


@contextmanager
def span(
    name: str,
    attributes: dict[str, Any] | None = None,
    tracer_name: str = "sct-worker-py",
) -> Generator[Any, None, None]:
    """Synchronous context manager for a trace span."""
    if not _ENABLED:
        yield None
        return
    t = get_tracer(tracer_name)
    with t.start_as_current_span(name, attributes=_redact(attributes or {})) as s:
        yield s


@asynccontextmanager
async def async_span(
    name: str,
    attributes: dict[str, Any] | None = None,
    tracer_name: str = "sct-worker-py",
) -> AsyncGenerator[Any, None]:
    """Async context manager for a trace span."""
    if not _ENABLED:
        yield None
        return
    t = get_tracer(tracer_name)
    with t.start_as_current_span(name, attributes=_redact(attributes or {})) as s:
        yield s


def current_trace_id() -> str | None:
    """Return current trace ID for log correlation. Never contains P2 data."""
    if not _ENABLED:
        return None
    try:
        from opentelemetry import trace
        ctx = trace.get_current_span().get_span_context()
        return format(ctx.trace_id, "032x") if ctx.trace_id else None
    except Exception:
        return None


class _NoOpTracer:
    """Minimal no-op tracer for when OTel is disabled."""

    def start_as_current_span(self, name: str, **_kwargs):
        from contextlib import nullcontext
        return nullcontext(enter_result=_NoOpSpan())


class _NoOpSpan:
    def set_status(self, *a, **kw): pass
    def record_exception(self, *a, **kw): pass
    def set_attribute(self, *a, **kw): pass
    def end(self): pass
