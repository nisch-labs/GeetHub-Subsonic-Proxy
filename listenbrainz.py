"""Thin client for ListenBrainz's similar-recordings endpoint.

Powers the cross-artist "radio" mode: given a seed recording MBID we ask
ListenBrainz for tracks scrobble-adjacent to it, then the caller resolves the
returned MBIDs/artist-title pairs against the local Navidrome library.
"""
import os
import logging

import httpx

log = logging.getLogger("subsonic-proxy.listenbrainz")

LISTENBRAINZ_URL = os.environ.get(
    "LISTENBRAINZ_URL", "https://labs.api.listenbrainz.org"
).rstrip("/")
# Default algo is the one ListenBrainz's own "Similar Tracks" tab uses.
RADIO_ALGORITHM = os.environ.get(
    "RADIO_ALGORITHM",
    "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30",
)

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))


async def similar_recordings(mbid: str, count: int = 50) -> list[dict]:
    """Return [{mbid, artist, title, score}, ...] most similar to ``mbid``.

    Empty list on any failure — this feature always has a fallback path, so
    swallowing errors here lets the caller degrade gracefully rather than 500.
    """
    if not mbid:
        return []
    url = f"{LISTENBRAINZ_URL}/similar-recordings/json"
    payload = [{"recording_mbid": mbid, "algorithm": RADIO_ALGORITHM}]
    try:
        r = await _client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("listenbrainz similar-recordings failed for %s: %s", mbid, exc)
        return []

    # Endpoint returns a list of rows keyed by recording_mbid / artist_credit_name /
    # recording_name / score. Some algorithms wrap in {"payload": [...]}.
    rows = data.get("payload") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []

    out: list[dict] = []
    for row in rows:
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


async def aclose() -> None:
    await _client.aclose()
