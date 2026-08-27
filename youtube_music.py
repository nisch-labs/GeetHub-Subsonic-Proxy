"""YouTube Music search via ``ytmusicapi``.

Songs-only, cleaner metadata than ``ytsearch:`` — real artist(s) and album,
no lyric-video / karaoke / vlog noise, so we can skip the title-cleanup and
``_looks_like_music`` filtering that ``youtube.py`` needs.

Downstream ops (stream, cover, getSong, download) stay unchanged: YT Music
songs are hosted on YouTube's video infrastructure, so yt-dlp resolves them
via the same ``youtube.com/watch?v=<videoId>`` URL. This module just populates
``youtube.META_CACHE`` so those handlers find the label metadata they need.
"""
import asyncio
import logging

from ytmusicapi import YTMusic

import youtube

log = logging.getLogger("subsonic-proxy.youtube_music")


_client: YTMusic | None = None


def _get() -> YTMusic:
    global _client
    if _client is None:
        _client = YTMusic()  # unauthenticated is fine for song search
    return _client


def _search_sync(query: str, limit: int):
    results = _get().search(query, filter="songs", limit=limit * 2) or []
    out = []
    for r in results:
        vid = r.get("videoId")
        if not vid:
            continue
        title = (r.get("title") or "").strip()
        artists = r.get("artists") or []
        artist = ", ".join(a.get("name", "").strip() for a in artists if a.get("name")) \
            or "YouTube Music"
        album = ((r.get("album") or {}).get("name") or "YouTube Music").strip()
        dur = int(r.get("duration_seconds") or 0)
        out.append({
            "id": f"{youtube.MUSIC_PREFIX}{vid}",
            "title": title,
            "artist": artist,
            "album": album,
            "duration": dur,
        })
        if len(out) >= limit:
            break
    return out


_QUERY_CACHE: dict = {}


async def search(query: str, limit: int = 8):
    """Return virtual-track dicts for ``query`` from YouTube Music (cached,
    never raises — falls back to an empty list so search3 still returns the
    real library results)."""
    if not query or not query.strip():
        return []
    key = query.strip().lower()
    if key in _QUERY_CACHE:
        for v in _QUERY_CACHE[key]:
            youtube.remember(v)
        return _QUERY_CACHE[key]
    try:
        results = await asyncio.to_thread(_search_sync, query.strip(), limit)
        for v in results:
            youtube.remember(v)
        _QUERY_CACHE[key] = results
        return results
    except Exception as exc:
        log.warning("yt-music search failed for %r: %s", query, exc)
        return []
