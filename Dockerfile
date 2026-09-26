# ─── Stage 1: build the Svelte web app ────────────────────────────────
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # → /web/dist


# ─── Stage 2: runtime (Python + FastAPI + ffmpeg + yt-dlp) ────────────
FROM python:3.12-slim

# ffmpeg is needed in Phase 3 (transcode YouTube audio -> mp3 on the fly).
# Installed now so later phases need no image rebuild.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# yt-dlp nightly: YouTube extraction breaks against stale releases, so track the
# pre-release channel. Rebuild --no-cache periodically (or exec `pip install -U
# --pre yt-dlp[default]`) if extraction ever starts failing.
RUN pip install --no-cache-dir -U --pre "yt-dlp[default]"

COPY app.py youtube.py youtube_music.py subsonic.py antra.py deezer.py devices.py guest.py listenbrainz.py radio.py .

# Bring in the built web app; app.py serves it as static files at /.
COPY --from=web /web/dist /app/web

ENV LISTEN_PORT=4544
EXPOSE 4544

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${LISTEN_PORT}"]
