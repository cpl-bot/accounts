#!/bin/sh
# Migrate, then serve. HOST/PORT come from the environment (see .env.example).
set -e
: "${HOST:=0.0.0.0}"
: "${PORT:=8000}"
echo "talai-middleware: running migrations"
uv run alembic upgrade head
echo "talai-middleware: serving on ${HOST}:${PORT}"
exec uv run uvicorn talai_middleware.main:app --host "${HOST}" --port "${PORT}"
