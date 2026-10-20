FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements-backend.lock ./
RUN pip install --no-cache-dir -r requirements-backend.lock
COPY backend ./backend
COPY migrations ./migrations
COPY alembic.ini ./
COPY js ./js
COPY css ./css
COPY assets ./assets
COPY *.html ./
ENV CRISIS_RUNTIME=/data MPLCONFIGDIR=/tmp/matplotlib
RUN useradd --uid 10001 --create-home crisis && mkdir -p /data && chown crisis /data
USER crisis
EXPOSE 8000
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
