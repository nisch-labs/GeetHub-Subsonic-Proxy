"""YouTube search + audio-stream resolution via yt-dlp.

Virtual track IDs are of the form ``yt-<videoId>`` so the proxy can recognise
them coming back on stream / coverArt / playlist requests.
"""
import os
import re
import asyncio
import logging

from yt_dlp import YoutubeDL

log = logging.getLogger("subsonic-proxy.youtube")

VIRTUAL_PREFIX = "yt-"
# Second prefix used by the ytmusicapi path (youtube_music.py). Same underlying
# YouTube video URL for streaming, but a separate id namespace so the client
# can render a distinct "YT Music" tag on results from that source.
MUSIC_PREFIX = "ytm-"

_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,      # metadata only, no per-video network calls
    "skip_download": True,
    "default_search": "ytsearch",
    "noplaylist": True,
}


# id -> {title, artist, album, duration}; populated on search so that later
# getSong / getCoverArt / stream calls can label a track without re-resolving.
META_CACHE: dict = {}


def remember(v: dict) -> None:
    META_CACHE[v["id"]] = {
        "title": v["title"], "artist": v["artist"],
        "album": v.get("album", "YouTube"), "duration": v.get("duration", 0),
    }


def meta(track_id: str):
    return META_CACHE.get(track_id)


def is_virtual(track_id: str) -> bool:
    return bool(track_id) and (track_id.startswith(MUSIC_PREFIX)
                               or track_id.startswith(VIRTUAL_PREFIX))


def video_id(track_id: str) -> str:
    if track_id.startswith(MUSIC_PREFIX):
        return track_id[len(MUSIC_PREFIX):]
    return track_id[len(VIRTUAL_PREFIX):]


def video_url(track_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id(track_id)}"


# Bracketed junk that pollutes catalog matching (keeps things like "(Live)").
_JUNK = re.compile(
    r"[\(\[][^\)\]]*\b(official|video|audio|lyrics?|hd|hq|4k|8k|mv|"
    r"visuali[sz]er|remaster(ed)?|explicit|full\s+song|hi-?res|m/?v)\b[^\)\]]*[\)\]]",
    re.I,
)


def clean_title(raw: str) -> str:
    t = _JUNK.sub("", raw or "")
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—")
    return t or (raw or "").strip()


def clean_artist(raw: str) -> str:
    return re.sub(r"\s*-\s*Topic\s*$", "", raw or "", flags=re.I).strip()


def _safe(name: str) -> str:
    return re.sub(r'[/\\:*?"<>|]', "_", name).strip() or "Unknown"


def _split_title(raw: str, uploader: str):
    """YouTube titles are often 'Artist - Song'. Best-effort split for display."""
    if raw and " - " in raw:
        artist, _, title = raw.partition(" - ")
        return artist.strip(), title.strip()
    return (uploader or "YouTube").strip(), (raw or "Unknown").strip()


MAX_MUSIC_SECONDS = 660   # 11 min — songs are shorter; cuts vlogs/mixes/novels
MIN_MUSIC_SECONDS = 45
# Titles that are almost never a song we'd want in the library.
_NONMUSIC = re.compile(
    r"\b(vlog|nightlife|podcast|documentary|full\s+day|tutorial|reaction|"
    r"interview|news|upanyash|katha|story|audiobook|full\s+movie|episode|"
    r"live\s*stream|livestream|gameplay|highlights|compilation\s+\d+\s*hour|"
    r"\d+\s*hours?\b|lofi\s+radio|24/?7)\b",
    re.I,
)


def _looks_like_music(title: str, duration) -> bool:
    if duration:
        if duration > MAX_MUSIC_SECONDS or duration < MIN_MUSIC_SECONDS:
            return False
    if _NONMUSIC.search(title or ""):
        return False
    return True


def _search_sync(query: str, limit: int):
    # Over-fetch, then filter down to things that look like actual songs.
    with YoutubeDL(_SEARCH_OPTS) as ydl:
        info = ydl.extract_info(f"ytsearch{limit * 3}:{query}", download=False)
    out = []
    for e in (info or {}).get("entries", []) or []:
        vid = e.get("id")
        if not vid:
            continue
        raw_title = e.get("title", "")
        dur = e.get("duration")
        if not _looks_like_music(raw_title, dur):
            continue
        artist, title = _split_title(raw_title, e.get("uploader") or e.get("channel"))
        out.append({
            "id": f"{VIRTUAL_PREFIX}{vid}",
            "title": title,
            "artist": artist,
            "album": "YouTube",
            "duration": int(dur) if dur else 0,
        })
        if len(out) >= limit:
            break
    return out


_QUERY_CACHE: dict = {}  # normalized query -> results (process-lifetime)


async def search(query: str, limit: int = 8):
    """Return a list of virtual-track dicts for a query (never raises, cached)."""
    if not query or not query.strip():
        return []
    key = query.strip().lower()
    if key in _QUERY_CACHE:
        for v in _QUERY_CACHE[key]:
            remember(v)
        return _QUERY_CACHE[key]
    try:
        results = await asyncio.to_thread(_search_sync, query.strip(), limit)
        for v in results:
            remember(v)
        _QUERY_CACHE[key] = results
        return results
    except Exception as exc:  # search must never break the proxy
        log.warning("yt search failed for %r: %s", query, exc)
        return []


_STREAM_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "format": "bestaudio[protocol^=https]/bestaudio/best",
    "noplaylist": True,
}


def _resolve_audio_sync(track_id: str):
    with YoutubeDL(_STREAM_OPTS) as ydl:
        info = ydl.extract_info(video_url(track_id), download=False)
    return {
        "url": info.get("url"),
        "duration": int(info.get("duration") or 0),
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
    }


async def resolve_audio(track_id: str):
    """Resolve a direct audio stream URL for a virtual track (or None)."""
    try:
        return await asyncio.to_thread(_resolve_audio_sync, track_id)
    except Exception as exc:
        log.warning("yt resolve failed for %s: %s", track_id, exc)
        return None


def _download_audio_sync(track_id: str, dest_dir: str, artist: str, title: str,
                         status: dict = None):
    os.makedirs(dest_dir, exist_ok=True)
    stem = f"{_safe(artist)} - {_safe(title)}"

    def _hook(d):
        if status is None:
            return
        st = d.get("status")
        if st == "downloading":
            tb = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            db = d.get("downloaded_bytes") or 0
            if tb:
                pct = min(95, int(db * 100 / tb))
                status["percent"] = max(status.get("percent", 0), pct)
        elif st == "finished":
            status["percent"] = max(status.get("percent", 0), 95)

    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": os.path.join(dest_dir, stem + ".%(ext)s"),
        "writethumbnail": True,
        "progress_hooks": [_hook],
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"},
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ],
    }
    with YoutubeDL(opts) as ydl:
        ydl.extract_info(video_url(track_id), download=True)
    path = os.path.join(dest_dir, stem + ".mp3")

    # Overwrite the (messy YouTube) tags with our clean metadata.
    try:
        from mutagen.easyid3 import EasyID3
        from mutagen.mp3 import MP3
        try:
            tags = EasyID3(path)
        except Exception:
            m = MP3(path)
            m.add_tags()
            m.save()
            tags = EasyID3(path)
        tags["title"] = title
        tags["artist"] = artist
        tags["album"] = "YouTube"
        tags.save()
    except Exception as exc:
        log.warning("tagging failed for %s: %s", path, exc)
    return path


async def download_audio(track_id: str, dest_dir: str, artist: str, title: str,
                         status: dict = None):
    """Download+transcode a virtual track to a tagged mp3 on disk (or None)."""
    try:
        return await asyncio.to_thread(_download_audio_sync, track_id, dest_dir,
                                       artist, title, status)
    except Exception as exc:
        log.error("yt download failed for %s: %s", track_id, exc)
        return None
