"""Clients for ListenBrainz's similar-recordings + MusicBrainz recording search.

Powers the cross-artist "radio" mode:
  1. Seed comes in with (or without) a recording MBID.
  2. If no MBID, search MusicBrainz by (artist, title) — returns candidate MBIDs.
  3. For each candidate, ask ListenBrainz for similar recordings; first hit wins.
  4. Caller resolves the returned artist/title pairs against Navidrome.
"""
import os
import logging

import httpx

log = logging.getLogger("subsonic-proxy.listenbrainz")

LISTENBRAINZ_URL = os.environ.get(
    "LISTENBRAINZ_URL", "https://labs.api.listenbrainz.org"
).rstrip("/")
MUSICBRAINZ_URL = os.environ.get(
    "MUSICBRAINZ_URL", "https://musicbrainz.org"
).rstrip("/")
# Must be one of LB's enum values — a wrong name 400s.
RADIO_ALGORITHM = os.environ.get(
    "RADIO_ALGORITHM",
    "session_based_days_7500_session_300_contribution_5_threshold_15_limit_50_skip_30",
)
# MusicBrainz asks for a UA that identifies the app + contact per their code of conduct.
_MB_UA = os.environ.get(
    "MUSICBRAINZ_UA",
    "GeetHub-Subsonic-Proxy/1.0 ( https://github.com/nisch-labs/GeetHub-Subsonic-Proxy )",
)

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))

# (artist_lower, title_lower) → [mbid, mbid, ...]  — cached MB search results.
_MB_CACHE: dict[tuple[str, str], list[str]] = {}


async def similar_recordings(mbid: str, count: int = 50) -> list[dict]:
    """Return [{mbid, artist, title, score}, ...] most similar to ``mbid``.

    Empty list on any failure — radio always has a fallback path, so swallowing
    errors here lets the caller degrade gracefully rather than 500.
    """
    if not mbid:
        return []
    url = f"{LISTENBRAINZ_URL}/similar-recordings/json"
    payload = [{
        "recording_mbids": [mbid],
        "algorithm": RADIO_ALGORITHM,
    }]
    try:
        r = await _client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("listenbrainz similar-recordings failed for %s: %s", mbid, exc)
        return []

    # Response is a flat list of rows; each row has recording_mbid /
    # recording_name / artist_credit_name / score / reference_mbid.
    rows = data if isinstance(data, list) else data.get("payload", [])
    if not isinstance(rows, list):
        return []

    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        rec_mbid = (row.get("recording_mbid") or "").strip()
        title = (row.get("recording_name") or "").strip()
        artist = (row.get("artist_credit_name") or "").strip()
        if not title or not artist:
            continue
        out.append({
            "mbid": rec_mbid,
            "artist": artist,
            "title": title,
            "score": row.get("score", 0),
        })
        if len(out) >= count:
            break
    return out


async def search_mb_recordings(artist: str, title: str, limit: int = 5) -> list[str]:
    """Search MusicBrainz for recordings matching (artist, title). Returns up to
    ``limit`` candidate MBIDs in relevance order. Different releases / mixes of
    the same track have distinct MBIDs, and ListenBrainz only has scrobble data
    for a subset — so the caller iterates until one comes back with hits.
    """
    if not artist or not title:
        return []
    key = (artist.strip().lower(), title.strip().lower())
    if key in _MB_CACHE:
        return _MB_CACHE[key]

    query = f'recording:"{title}" AND artist:"{artist}"'
    try:
        r = await _client.get(
            f"{MUSICBRAINZ_URL}/ws/2/recording/",
            params={"query": query, "fmt": "json", "limit": str(limit)},
            headers={"User-Agent": _MB_UA},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("musicbrainz search failed for %r / %r: %s", artist, title, exc)
        _MB_CACHE[key] = []
        return []
    mbids = [(rec.get("id") or "").strip()
             for rec in (data.get("recordings") or [])
             if rec.get("id")]
    _MB_CACHE[key] = mbids
    return mbids


async def aclose() -> None:
    await _client.aclose()
