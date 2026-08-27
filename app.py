"""
subsonic-proxy — a transparent Subsonic API reverse proxy in front of Navidrome,
with hooks (added in later phases) to inject YouTube search results, stream them
on demand, and trigger Antra downloads.

Phase 1: PURE PASSTHROUGH. Every /rest/* request is forwarded to Navidrome
untouched (method, query, headers, body) and the response streamed straight back.
Goal: prove Amperfy works exactly as it does today when pointed at this proxy.

Env:
  NAVIDROME_URL   upstream Navidrome (default http://127.0.0.1:4533)
  ANTRA_URL       Antra API base    (default http://127.0.0.1:8288)
  LISTEN_PORT     port to serve on   (default 4544)
"""
import os
import json
import uuid
import asyncio
import logging

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response, StreamingResponse, RedirectResponse, JSONResponse, FileResponse

import youtube
import youtube_music
import subsonic
import antra
import deezer
import devices as devices_registry

NAVIDROME_URL = os.environ.get("NAVIDROME_URL", "http://127.0.0.1:4533").rstrip("/")
ANTRA_URL = os.environ.get("ANTRA_URL", "http://127.0.0.1:8288").rstrip("/")
YT_SEARCH_LIMIT = int(os.environ.get("YT_SEARCH_LIMIT", "8"))
MAGIC_PLAYLIST = os.environ.get("MAGIC_PLAYLIST_NAME", "Download via Antra").strip().lower()
FALLBACK_DIR = os.environ.get("FALLBACK_DIR", "/music/YouTube")
ANTRA_FLAC_FORMAT = os.environ.get("ANTRA_FORMAT", "flac")
WEB_DIR = os.environ.get("WEB_DIR", "/app/web")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("subsonic-proxy")

app = FastAPI(title="subsonic-proxy")

# One shared client. No timeout on reads so long audio streams aren't cut off.
client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, read=None))

# Hop-by-hop headers must not be forwarded (RFC 7230 §6.1).
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
}


def _clean_headers(headers) -> dict:
    return {k: v for k, v in headers.items() if k.lower() not in HOP_BY_HOP}


async def passthrough(request: Request, path: str) -> Response:
    """Forward a request to Navidrome verbatim and stream the response back."""
    url = f"{NAVIDROME_URL}/{path}"
    body = await request.body()
    upstream = client.build_request(
        request.method,
        url,
        params=request.query_params,
        headers=_clean_headers(request.headers),
        content=body if body else None,
    )
    resp = await client.send(upstream, stream=True)

    async def body_iter():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await resp.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=resp.status_code,
        headers=_clean_headers(resp.headers),
        media_type=resp.headers.get("content-type"),
    )


async def forward_buffered(request: Request, path: str):
    """Forward a request and return (upstream_response, decoded_body_bytes).

    Uses a non-streaming request so httpx transparently decompresses the body,
    letting us parse and rewrite it. Only for small JSON/XML endpoints.
    """
    url = f"{NAVIDROME_URL}/{path}"
    body = await request.body()
    resp = await client.request(
        request.method,
        url,
        params=request.query_params,
        headers=_clean_headers(request.headers),
        content=body if body else None,
    )
    return resp, resp.content


def _endpoint(path: str) -> str:
    """Last path segment without the optional .view suffix, e.g. 'search3'."""
    seg = path.rsplit("/", 1)[-1]
    return seg[:-5] if seg.endswith(".view") else seg


async def handle_search3(request: Request, path: str) -> Response:
    query = request.query_params.get("query", "")
    is_json = request.query_params.get("f", "xml").lower() in ("json", "jsonp")
    # Client picks the augment source per-request: `ytSource=youtube` (yt-dlp
    # ytsearch, noisy but broad) or `ytSource=ytmusic` (ytmusicapi, cleaner,
    # song-only). Unknown / missing → default to YT Music.
    source = (request.query_params.get("ytSource", "") or "ytmusic").lower()
    # Amperfy issues search3 three times per keystroke (artists-only, albums-only,
    # songs-only). Only inject on the songs variant to avoid 3x YouTube lookups.
    try:
        song_count = int(request.query_params.get("songCount", "20"))
    except ValueError:
        song_count = 20

    resp, body = await forward_buffered(request, path)

    # Only augment the songs-variant of a successful response.
    if resp.status_code == 200 and query.strip() and song_count > 0:
        engine = youtube_music if source == "ytmusic" else youtube
        virtuals = await engine.search(query, YT_SEARCH_LIMIT)
        if virtuals:
            body = subsonic.inject_search3(body, is_json, virtuals)

    # We decoded the body, so drop transfer/encoding/length headers and let
    # Starlette recompute them for the (now identity-encoded) body.
    headers = {k: v for k, v in _clean_headers(resp.headers).items()
               if k.lower() not in ("content-encoding", "content-length")}
    return Response(
        content=body,
        status_code=resp.status_code,
        headers=headers,
        media_type=resp.headers.get("content-type"),
    )


async def _ffmpeg_mp3(url: str):
    """Transcode a remote audio URL to a live mp3 stream via ffmpeg."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
        "-i", url, "-vn", "-f", "mp3", "-b:a", "192k", "pipe:1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        while True:
            chunk = await proc.stdout.read(65536)
            if not chunk:
                break
            yield chunk
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()


async def handle_stream(request: Request, track_id: str) -> Response:
    if request.method == "HEAD":
        return Response(status_code=200, media_type="audio/mpeg",
                        headers={"Accept-Ranges": "none"})
    info = await youtube.resolve_audio(track_id)
    if not info or not info.get("url"):
        return Response(status_code=404, content=b"youtube resolve failed")
    return StreamingResponse(
        _ffmpeg_mp3(info["url"]),
        media_type="audio/mpeg",
        headers={"Accept-Ranges": "none", "Content-Type": "audio/mpeg"},
    )


def handle_coverart(track_id: str) -> Response:
    vid = youtube.video_id(track_id)
    return RedirectResponse(f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", status_code=302)


def handle_getsong(request: Request, track_id: str) -> Response:
    is_json = request.query_params.get("f", "xml").lower() in ("json", "jsonp")
    m = youtube.meta(track_id) or {"title": "YouTube track", "artist": "YouTube",
                                    "album": "YouTube", "duration": 0}
    v = {"id": track_id, **m}
    if is_json:
        doc = {"subsonic-response": {"status": "ok", "version": "1.16.1",
                                     "type": "navidrome", "song": subsonic.song_json(v)}}
        return Response(content=json.dumps(doc).encode(), media_type="application/json")
    attrs = subsonic._song_xml_attrs(v)
    attr_str = " ".join(f'{k}="{subsonic._xml_escape(val)}"' for k, val in attrs.items())
    xml = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1">'
           f'<song {attr_str}/></subsonic-response>')
    return Response(content=xml.encode(), media_type="application/xml")


async def _playlist_name(request: Request, playlist_id: str) -> str:
    """Look up a playlist's name via Navidrome (best-effort, lowercased)."""
    if not playlist_id:
        return ""
    params = [(k, v) for k, v in request.query_params.multi_items()
              if k not in ("playlistId", "id", "songIdToAdd", "songIdToRemove")]
    params += [("id", playlist_id), ("f", "json")]
    try:
        r = await client.get(f"{NAVIDROME_URL}/rest/getPlaylist.view", params=params)
        name = r.json()["subsonic-response"]["playlist"]["name"]
        return (name or "").strip().lower()
    except Exception as exc:
        log.warning("could not resolve playlist %s name: %s", playlist_id, exc)
        return ""


async def _forward_params(request: Request, path: str, params_items) -> Response:
    """Forward a request to Navidrome with an explicit (possibly edited) query."""
    body = await request.body()
    r = await client.request(
        request.method, f"{NAVIDROME_URL}/{path}",
        params=params_items, headers=_clean_headers(request.headers),
        content=body if body else None,
    )
    headers = {k: v for k, v in _clean_headers(r.headers).items()
               if k.lower() not in ("content-encoding", "content-length")}
    return Response(content=r.content, status_code=r.status_code,
                    headers=headers, media_type=r.headers.get("content-type"))


_AUTH_KEYS = ("u", "p", "t", "s", "c", "v")


async def navidrome_scan(auth):
    """Ask Navidrome to rescan so a freshly-saved file appears promptly."""
    try:
        await client.get(f"{NAVIDROME_URL}/rest/startScan.view", params=list(auth))
        log.info("triggered Navidrome scan")
    except Exception as exc:
        log.warning("navidrome scan failed: %s", exc)


# In-memory registry for POST /api/download → GET /api/download/status.
# Keyed by short download_id (uuid4 hex, first 12 chars). Not persisted; the
# client only polls until it sees done/failed, then forgets it.
DOWNLOADS: dict[str, dict] = {}


def _new_download(track_id: str, folder: str) -> tuple[str, dict]:
    did = uuid.uuid4().hex[:12]
    status = {"id": track_id, "folder": folder, "state": "queued",
              "percent": 0, "detail": ""}
    DOWNLOADS[did] = status
    return did, status


def _set(status: dict | None, **kw) -> None:
    if status is not None:
        status.update(kw)


async def process_download(track_id: str, auth, status: dict | None = None,
                           folder: str = "") -> None:
    """Hybrid: Deezer link -> Antra (lossless); on failure, save YouTube audio."""
    m = youtube.meta(track_id)
    if not m:
        _set(status, state="sourcing", detail="Resolving YouTube")
        info = await youtube.resolve_audio(track_id)
        if info:
            artist, title = youtube._split_title(info.get("title", ""), None)
            m = {"artist": artist, "title": title}
    if not m:
        log.error("no metadata for %s — cannot download", track_id)
        _set(status, state="failed", detail="no metadata for track")
        return

    artist = youtube.clean_artist(m["artist"])
    title = youtube.clean_title(m["title"])
    log.info("download requested: %s — %s (folder=%r)", artist, title, folder)

    # 1) Try Antra via a clean Deezer link (best quality when in catalog).
    _set(status, state="sourcing", percent=5,
         detail=f"Finding {artist} — {title} on Deezer")
    link = await deezer.search(artist, title)
    if link:
        _set(status, state="downloading", percent=15, detail="Downloading via Antra")
        if await antra.download_wait(link, ANTRA_FLAC_FORMAT, folder=folder, status=status):
            log.info("downloaded via Antra: %s — %s", artist, title)
            await navidrome_scan(auth)
            _set(status, state="done", percent=100, detail="Saved to library")
            return

    # 2) Fallback: save the YouTube audio we can already play. If the user
    # picked a folder, honour it (write into /music/<folder>); otherwise use
    # the segregated FALLBACK_DIR (/music/YouTube by default).
    log.info("Antra path failed — saving YouTube audio for %s — %s", artist, title)
    _set(status, state="saving-youtube", percent=15, detail="Falling back to YouTube audio")
    dest = f"/music/{folder}" if folder else FALLBACK_DIR
    path = await youtube.download_audio(track_id, dest, artist, title, status=status)
    if path:
        log.info("saved YouTube audio: %s", path)
        await navidrome_scan(auth)
        _set(status, state="done", percent=100, detail="Saved from YouTube")
    else:
        log.error("download FAILED for %s — %s", artist, title)
        _set(status, state="failed", detail="both Antra and YouTube failed")


async def handle_playlist_edit(request: Request, path: str, endpoint: str) -> Response:
    """Intercept createPlaylist/updatePlaylist: a yt- track added to the magic
    playlist kicks off a background hybrid download; yt- ids are stripped before
    forwarding so Navidrome never sees an id it doesn't know."""
    items = request.query_params.multi_items()
    add_key = "songId" if endpoint == "createPlaylist" else "songIdToAdd"
    yt_ids = [v for k, v in items if k == add_key and youtube.is_virtual(v)]

    if yt_ids:
        if endpoint == "createPlaylist":
            target = request.query_params.get("name", "").strip().lower()
        else:
            target = await _playlist_name(request, request.query_params.get("playlistId", ""))
        if target == MAGIC_PLAYLIST:
            auth = [(k, v) for k, v in items if k in _AUTH_KEYS]
            for tid in yt_ids:
                # Fire-and-forget: downloads take ~20-60s, must not block Amperfy.
                asyncio.create_task(process_download(tid, auth))
        else:
            log.info("yt id added to non-magic playlist %r — stripped, no download", target)

    # Strip yt- ids from the add list; keep everything else intact.
    cleaned = [(k, v) for k, v in items if not (k == add_key and youtube.is_virtual(v))]
    return await _forward_params(request, path, cleaned)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "navidrome": NAVIDROME_URL, "antra": ANTRA_URL,
            "magic_playlist": MAGIC_PLAYLIST}


@app.get("/api/folders")
async def api_folders():
    """List the library folders Antra exposes — used by the app's folder picker."""
    return {"folders": await antra.list_folders()}


@app.post("/api/download")
async def api_download(request: Request):
    """Clean 'Save to Library' endpoint for first-party clients (Geet-Hub).
    Body: {"id": "yt-<videoId>", "folder": "<optional folder>"}. Runs the same
    hybrid download in the background (Deezer→Antra flac, else save YouTube
    audio). This is the tidy alternative to the magic-playlist trigger, which
    stays for other clients. Optional Subsonic auth query params (u/t/s) are
    used for the post-save Navidrome scan. Returns a ``download_id`` clients can
    poll via ``GET /api/download/status``. Older clients that ignore the id
    still work — same background behavior as before, folder defaults to root.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    track_id = (body.get("id") or "").strip()
    folder = (body.get("folder") or "").strip()
    if not youtube.is_virtual(track_id):
        raise HTTPException(status_code=400, detail="id must be a yt-<videoId> track")
    auth = [(k, v) for k, v in request.query_params.multi_items() if k in _AUTH_KEYS]
    did, status = _new_download(track_id, folder)
    asyncio.create_task(process_download(track_id, auth, status=status, folder=folder))
    return {"status": "queued", "id": track_id, "download_id": did}


@app.get("/api/download/status")
async def api_download_status(id: str):
    """Poll status of a download started via POST /api/download."""
    s = DOWNLOADS.get(id)
    if not s:
        raise HTTPException(status_code=404, detail="unknown download id")
    # Never let URLCache / Cloudflare hold a stale in-progress reading — the
    # whole endpoint is 'return the latest state, always'.
    return JSONResponse(s, headers={"Cache-Control": "no-store"})


# ─── Antra pass-through: paste any URL and queue it as an Antra job ────
# These endpoints wrap Antra's /api/jobs so first-party clients (Geet-Hub app)
# can queue and monitor downloads without needing Antra's ADMIN_KEY themselves.

@app.post("/api/antra/download")
async def api_antra_download(request: Request):
    """Queue a Spotify / YouTube / Deezer / Apple Music / Tidal / etc. link as
    an Antra job. Body: ``{"url": "...", "format": "mp3|flac|...", "folder": "..."}``.
    Returns ``{"job_id": <int>}``."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    url = (body.get("url") or "").strip()
    fmt = (body.get("format") or "").strip() or None
    folder = body.get("folder") or None
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    jid = await antra.queue_job(url, fmt=fmt, folder=folder)
    if jid is None:
        raise HTTPException(status_code=502, detail="Antra rejected the job")
    return {"job_id": jid}


@app.get("/api/antra/jobs")
async def api_antra_jobs():
    """List all Antra jobs (id/url/title/status/format/folder/created/finished)."""
    jobs = await antra.list_jobs()
    return JSONResponse(jobs, headers={"Cache-Control": "no-store"})


@app.get("/api/antra/jobs/{job_id}")
async def api_antra_job(job_id: int):
    """One Antra job with a `progress` field parsed from its log tail (0-99)."""
    j = await antra.job(job_id)
    if j is None:
        raise HTTPException(status_code=404, detail="unknown job id")
    return JSONResponse(j, headers={"Cache-Control": "no-store"})


@app.get("/api/antra/jobs/{job_id}/tracks")
async def api_antra_job_tracks(job_id: int):
    """Structured per-track state for a playlist/album job. Each entry has
    {index, total, artist, title, state} — state ∈ queued|downloading|done|skipped|failed."""
    tracks = await antra.job_tracks(job_id)
    return JSONResponse(tracks, headers={"Cache-Control": "no-store"})


# ─── Multi-device registry ─────────────────────────────────────────────
# Every client (iOS / iPadOS / Mac Catalyst / Web) heartbeats here every
# ~15s so all of a user's devices can see each other and initiate transfers.
# The `u=` query param identifies the account.

def _user_from(request: Request) -> str:
    user = (request.query_params.get("u") or "").strip()
    if not user:
        raise HTTPException(status_code=400, detail="missing user (u query param)")
    return user


@app.post("/api/devices/heartbeat")
async def api_devices_heartbeat(request: Request):
    """Register / update this device's state. Body: {id, name, kind, isPlaying,
    currentSong, position, duration}. `id` may be omitted on first call — the
    server allocates one and returns it in the response."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    user = _user_from(request)
    stored = devices_registry.heartbeat(user, body)
    return JSONResponse(stored, headers={"Cache-Control": "no-store"})


@app.get("/api/devices")
async def api_devices_list(request: Request):
    """List all this user's currently-registered devices (heartbeated within 2min)."""
    user = _user_from(request)
    return JSONResponse(devices_registry.list_for(user), headers={"Cache-Control": "no-store"})


@app.post("/api/devices/{target_id}/transfer")
async def api_devices_transfer(target_id: str, request: Request):
    """Transfer playback to `target_id`. Body: {song, position, source_id?}.
    Queues a `play` command for the target and a `pause` command for the
    source (if provided). Returns 404 if the target isn't registered."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    user = _user_from(request)
    ok = devices_registry.transfer(
        user, target_id,
        source_id=(body.get("source_id") or "").strip() or None,
        song=body.get("song"),
        position=body.get("position") or 0,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="target device not registered")
    return {"ok": True}


@app.get("/api/devices/{device_id}/commands")
async def api_devices_commands(device_id: str, request: Request):
    """Drain pending commands for `device_id` — called by clients on their
    3-second poll cycle. Each command is `{type: 'play' | 'pause', ...}`."""
    user = _user_from(request)
    cmds = devices_registry.poll_commands(user, device_id)
    return JSONResponse(cmds, headers={"Cache-Control": "no-store"})


def _serve_web(path: str) -> Response:
    """Serve the Vite-built web app (Geet-Hub web) from ``WEB_DIR``.

    Handles asset fetches directly, and falls back to ``index.html`` for any
    unknown path so client-side hash routes and page reloads keep working."""
    if not os.path.isdir(WEB_DIR):
        return Response(status_code=404, content=b"web app not built (WEB_DIR missing)")
    if path:
        candidate = os.path.normpath(os.path.join(WEB_DIR, path))
        # Guard against path traversal — candidate must stay inside WEB_DIR.
        if candidate.startswith(WEB_DIR) and os.path.isfile(candidate):
            return FileResponse(candidate)
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


@app.api_route("/{path:path}", methods=["GET", "POST", "HEAD", "OPTIONS"])
async def catch_all(request: Request, path: str):
    # Anything that isn't a Subsonic API call, our /api/*, or /healthz is a
    # request for the web app (index.html or a built asset). Handle it before
    # falling through to the Navidrome passthrough.
    if request.method == "GET" and not (
        path.startswith("rest/") or path.startswith("api/") or path == "healthz"
    ):
        return _serve_web(path)

    endpoint = _endpoint(path)

    # Phase 2: augment search results with YouTube matches.
    if endpoint == "search3":
        return await handle_search3(request, path)

    # Phase 4: adding a yt- track to the magic playlist triggers an Antra download.
    if endpoint in ("updatePlaylist", "createPlaylist"):
        return await handle_playlist_edit(request, path, endpoint)

    # Phase 3: virtual (yt-) tracks are served by us, not Navidrome.
    track_id = request.query_params.get("id", "")
    if youtube.is_virtual(track_id):
        if endpoint in ("stream", "download"):
            return await handle_stream(request, track_id)
        if endpoint == "getCoverArt":
            return handle_coverart(track_id)
        if endpoint == "getSong":
            return handle_getsong(request, track_id)

    # Everything else: transparent passthrough (Phase 4 adds the playlist hook).
    return await passthrough(request, path)


@app.on_event("shutdown")
async def _shutdown():
    await client.aclose()
