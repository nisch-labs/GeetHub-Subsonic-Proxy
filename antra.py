"""Trigger an Antra download and wait for it to actually source the track."""
import os
import re
import asyncio
import logging

import httpx

log = logging.getLogger("subsonic-proxy.antra")

ANTRA_URL = os.environ.get("ANTRA_URL", "http://127.0.0.1:8288").rstrip("/")
ADMIN_KEY = os.environ.get("ANTRA_ADMIN_KEY", "")
SOURCE = os.environ.get("ANTRA_SOURCE", "deezer")
FORMAT = os.environ.get("ANTRA_FORMAT", "flac")
FOLDER = os.environ.get("ANTRA_FOLDER", "")


_ADDED_RE = re.compile(r"Tracks added\s*:\s*(\d+)\s*/\s*(\d+)", re.I)
_INLIB_RE = re.compile(r"Already in library\s*:\s*(\d+)", re.I)
# yt-dlp / Antra download-progress lines like "  27.4% of 3.10MiB at 1.23MiB/s".
_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
# Playlist-scale progress markers like "[42/100] Artist — Track".
_TRACK_MARK_RE = re.compile(r"\[(\d+)\s*/\s*(\d+)\]", re.M)


def parse_progress(log_text: str) -> int | None:
    """Best-effort percent estimate for an Antra job from its log tail.

    Prefers `[N/M]` markers with M > 1 (real playlist/album progress) — a bare
    `[1/1]` appears in Antra's resolver phase before the playlist is expanded
    and would spuriously read 100% otherwise. Falls back to per-track yt-dlp
    `NN.N%` for single-track jobs, then to any [N/M] as a last resort.
    Returns 0-99 or None."""
    tail = log_text[-8000:] if len(log_text) > 8000 else log_text
    marks = _TRACK_MARK_RE.findall(tail)
    playlist_marks = [(n, m) for (n, m) in marks if int(m) > 1]
    if playlist_marks:
        n, m = int(playlist_marks[-1][0]), int(playlist_marks[-1][1])
        return min(99, max(0, int(n * 100 / m)))
    pcts = _PCT_RE.findall(tail)
    if pcts:
        return min(99, max(0, int(float(pcts[-1]))))
    if marks:
        n, m = int(marks[-1][0]), int(marks[-1][1])
        if int(m) > 0:
            return min(99, max(0, int(n * 100 / m)))
    return None


# Per-track state parsing: each track's log block starts with a "[N/M] Artist
# — Title" header followed by state keywords in the next few lines.
_TRACK_HEADER_RE = re.compile(r"\[(\d+)\s*/\s*(\d+)\]\s+(.+?)(?:\n|\r\n|$)")


def parse_tracks(log_text: str) -> list[dict]:
    """Structured per-track progress for a playlist/album job. Newest-first is
    the natural log order, but we return them index-ordered (1..N) for the
    UI to render as a checklist."""
    # Look at more of the log than parse_progress — we want history, not just
    # the tip.
    tail = log_text[-60000:] if len(log_text) > 60000 else log_text
    matches = list(_TRACK_HEADER_RE.finditer(tail))
    tracks: list[dict] = []
    for i, m in enumerate(matches):
        n_str, total_str, header = m.group(1), m.group(2), m.group(3).strip()
        # Ignore single-item [1/1] resolver noise
        if int(total_str) <= 1:
            continue
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(tail)
        body = tail[body_start:body_end]

        state = "queued"
        # Order matters: "Complete" is the most decisive marker.
        if "[Complete]" in body or "✨" in body:
            state = "done"
        elif "[SKIP]" in body or "Skipping (already downloaded)" in body:
            state = "skipped"
        elif "[Resolver] No source found" in body \
             or "Could not source" in body \
             or "failed" in body.lower() and "Attempt" not in body:
            state = "failed"
        elif "[Downloading]" in body or "📥" in body:
            state = "downloading"

        # Split "Artist — Title" (em-dash) — some entries omit the artist half.
        if " — " in header:
            artist, title = header.split(" — ", 1)
            artist, title = artist.strip(), title.strip()
        else:
            artist, title = None, header

        tracks.append({
            "index": int(n_str),
            "total": int(total_str),
            "artist": artist,
            "title": title,
            "state": state,
        })

    # De-dupe on index (Antra re-logs the same track for phased retries) —
    # keep the *last* seen state per index since it reflects the final outcome.
    by_index: dict[int, dict] = {}
    for t in tracks:
        by_index[t["index"]] = t
    return sorted(by_index.values(), key=lambda t: t["index"])


async def list_folders() -> list[str]:
    """Read the library folders Antra exposes (for the app's folder picker)."""
    if not ADMIN_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            m = await c.get(f"{ANTRA_URL}/api/meta")
            return list((m.json() or {}).get("folders") or [])
    except Exception as exc:
        log.warning("list_folders failed: %s", exc)
        return []


async def queue_job(url: str, fmt: str | None = None, folder: str | None = None) -> int | None:
    """Queue an Antra job and return its id. Fire-and-forget from our POV — the
    caller polls status via `job(id)`. Used by /api/antra/download."""
    if not ADMIN_KEY:
        log.error("ANTRA_ADMIN_KEY not set — cannot queue %s", url)
        return None
    fmt = fmt or FORMAT
    job_folder = folder if folder is not None else FOLDER
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            job = await c.post(f"{ANTRA_URL}/api/jobs", json={
                "url": url, "source": SOURCE, "format": fmt, "folder": job_folder,
            })
            job.raise_for_status()
            jid = job.json().get("id")
            log.info("queued Antra job %s (%s, %s, folder=%r)", jid, url, fmt, job_folder)
            return jid
    except Exception as exc:
        log.error("Antra queue errored for %s: %s", url, exc)
        return None


async def list_jobs() -> list[dict]:
    """List all Antra jobs. Progress is not filled in here — call `job(id)` for
    a single job with progress parsed from its log."""
    if not ADMIN_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            jobs = (await c.get(f"{ANTRA_URL}/api/jobs")).json()
            return jobs if isinstance(jobs, list) else []
    except Exception as exc:
        log.warning("list_jobs failed: %s", exc)
        return []


async def job_tracks(job_id: int) -> list[dict]:
    """Per-track state list for a playlist/album job. Empty for single-track
    jobs (or jobs whose logs haven't got any track headers yet)."""
    if not ADMIN_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            text = (await c.get(f"{ANTRA_URL}/api/jobs/{job_id}/log")).text
            return parse_tracks(text)
    except Exception as exc:
        log.warning("job_tracks(%s) failed: %s", job_id, exc)
        return []


async def job(job_id: int) -> dict | None:
    """One Antra job with its parsed progress percent added under `progress`."""
    if not ADMIN_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            jobs = (await c.get(f"{ANTRA_URL}/api/jobs")).json()
            this = next((j for j in jobs if j.get("id") == job_id), None)
            if not this:
                return None
            try:
                log_text = (await c.get(f"{ANTRA_URL}/api/jobs/{job_id}/log")).text
                this["progress"] = parse_progress(log_text)
            except Exception:
                this["progress"] = None
            return this
    except Exception as exc:
        log.warning("job(%s) failed: %s", job_id, exc)
        return None


async def download_wait(url: str, fmt: str = None, folder: str = None,
                        timeout_s: int = 180, status: dict = None) -> bool:
    """Queue an Antra job and poll until it finishes. Returns True only if at
    least one track was actually added (a 'done' job may still have sourced 0).

    If ``status`` is given, updates ``status['percent']`` and ``status['detail']``
    as the Antra job progresses (percent parsed from the job log tail)."""
    if not ADMIN_KEY:
        log.error("ANTRA_ADMIN_KEY not set — cannot download %s", url)
        return False
    fmt = fmt or FORMAT
    job_folder = folder if folder is not None else FOLDER
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{ANTRA_URL}/api/login", json={"key": ADMIN_KEY})
            r.raise_for_status()
            job = await c.post(f"{ANTRA_URL}/api/jobs", json={
                "url": url, "source": SOURCE, "format": fmt, "folder": job_folder,
            })
            job.raise_for_status()
            job_id = job.json().get("id")
            log.info("queued Antra job %s (%s, %s, folder=%r)", job_id, url, fmt, job_folder)

            waited = 0
            while waited < timeout_s:
                await asyncio.sleep(3)
                waited += 3
                jobs = (await c.get(f"{ANTRA_URL}/api/jobs")).json()
                this = next((j for j in jobs if j.get("id") == job_id), None)
                if status is not None:
                    try:
                        tail = (await c.get(f"{ANTRA_URL}/api/jobs/{job_id}/log")).text[-4000:]
                        pcts = _PCT_RE.findall(tail)
                        if pcts:
                            status["percent"] = max(status.get("percent", 0),
                                                    min(99, int(float(pcts[-1]))))
                    except Exception:
                        pass
                if this and this.get("status") in ("done", "error", "failed"):
                    break

            text = (await c.get(f"{ANTRA_URL}/api/jobs/{job_id}/log")).text
            m = _ADDED_RE.search(text)
            added = int(m.group(1)) if m else 0
            inlib = int(_INLIB_RE.search(text).group(1)) if _INLIB_RE.search(text) else 0
            log.info("Antra job %s finished: %s added, %s already in library", job_id, added, inlib)
            return (added + inlib) >= 1
    except Exception as exc:
        log.error("Antra download errored for %s: %s", url, exc)
        return False
