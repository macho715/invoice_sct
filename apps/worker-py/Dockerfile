# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Invoice Audit Parser — Python Worker
# Runtime: Fly.io (Q-002 resolved)
# PDF: pdfplumber (current); OpenDataLoader (Java) ready for activation
# ----------------------------------------------------------------------------

# ---------- Stage 1: builder (uv sync in isolated env) -----------------------
FROM python:3.11-slim AS builder

# System deps required to build wheels for pdfplumber transitive deps
# (lxml/libxml2, Pillow/libjpeg/libpng) and the runtime libs that get copied
# in the runtime stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        libpoppler-cpp-dev \
        libjpeg-dev \
        libpng-dev \
        libxml2-dev \
        libxslt1-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager, Astral)
# Pinned to a known-good version; bump deliberately.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

# Compile bytecode for faster cold start; copy mode = "copy" to keep symlinks
# readable inside the venv.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# ---- Dependency layer (cache-friendly) ------------------------------------
# Copy ONLY the project metadata first so dependency resolution is cached
# when only source files change.
COPY pyproject.toml uv.lock ./

# --frozen: fail if uv.lock would be modified (CI safety)
# --no-dev: production runtime; dev deps (pytest) excluded
# --no-install-project: install deps first, project added in next layer
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ---- Source layer ----------------------------------------------------------
COPY app ./app

# Install the project itself (editable not needed in image)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


# ---------- Stage 2: runtime (slim, non-root) --------------------------------
FROM python:3.11-slim AS runtime

LABEL org.opencontainers.image.title="invoice-audit-parser" \
      org.opencontainers.image.description="HVDC Invoice Audit Python worker (Fly.io runtime)" \
      org.opencontainers.image.source="https://github.com/samsungct/hvdc-invoice-audit"

# ---- System runtime deps ---------------------------------------------------
# - libpoppler-cpp: pdfplumber's pdftotext/PDFMiner backend
# - default-jre-headless: OpenJDK 21 for OpenDataLoader (activated later)
# - fonts: improved CJK rendering for any PDF text extraction
# - curl: for Fly.io health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libpoppler-cpp-dev \
        libjpeg62-turbo \
        libpng16-16 \
        libxml2 \
        libxslt1.1 \
        zlib1g \
        fonts-noto-cjk \
        fonts-noto-core \
        openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Java is present for OpenDataLoader; not required by current pdfplumber code.
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
    OPENDATALOADER_HOME=/opt/opendataloader \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Non-root user (Fly.io + security baseline)
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home --shell /bin/bash app

WORKDIR /app

# ---- Copy the prepared venv and app code from builder ---------------------
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/app /app/app

# uv binary inside the runtime stage (needed for `uv run` in CMD)
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# Ensure the venv's binaries are on PATH
ENV PATH="/app/.venv/bin:$PATH" \
    VIRTUAL_ENV=/app/.venv

USER app

EXPOSE 8000

# Health check — Fly.io will hit this on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

# Default CMD: FastAPI on 0.0.0.0:8000
# `uv run` ensures the venv is activated even if PATH is overridden.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
