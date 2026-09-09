# Talai middleware — LAN deployment image.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    HOST=0.0.0.0 \
    PORT=8000

RUN pip install --no-cache-dir uv==0.8.17

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the lock file.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY talai_middleware ./talai_middleware
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
RUN uv sync --frozen --no-dev

EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
