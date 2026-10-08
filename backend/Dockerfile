# build from the repo root: docker build -f backend/Dockerfile -t askuoc-api .
# Hugging Face Spaces expects port 7860 and uid 1000
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd -m -u 1000 user
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=user backend/app ./app
RUN mkdir -p /app/data && chown -R user /app/data

USER user
ENV PORT=7860 DATA_DIR=/app/data
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"7860\")}/livez', timeout=3)"
# --proxy-headers: rate limits need the client IP from X-Forwarded-For
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
