"""Cross-artist "radio" queue built from ListenBrainz similar-recordings.

Given a seed Navidrome song id, we:
  1. fetch the seed's metadata (MBID + artist/title) via Navidrome getSong,
  2. ask ListenBrainz for songs listened to alongside the seed,
  3. resolve each recommendation to a track in the local library via search3,
  4. return a Subsonic-shaped list of ``<song>`` dicts.

If the seed has no MBID or the resolution rate is too low, the caller falls
back to Navidrome's own artist-based getSimilarSongs2.
"""
import os
import logging

import httpx

import listenbrainz

log = logging.getLogger("subsonic-proxy.radio")

# Below this many resolved local tracks we bail out and let the caller fall
# back to Navidrome's artist-radio — keeps the queue from feeling sparse.
RADIO_MIN_RESULTS = int(os.environ.get("RADIO_MIN_RESULTS", "10"))
RADIO_ENABLED = os.environ.get("RADIO_ENABLED", "true").strip().lower() != "false"

# Subsonic auth params we pass through when talking to Navidrome on the caller's
# behalf. `f` is forced to json in our own requests regardless of what the
# client asked for — the caller re-serializes if needed.
_AUTH_KEYS = ("u", "p", "t", "s", "c", "v")


def _auth_from(query_params) -> list[tuple[str, str]]:
    out = [(k, v) for k, v in query_params.multi_items() if k in _AUTH_KEYS]
    out.append(("f", "json"))
    return out


def _normalize(s: str) -> str:
    return (s or "").strip().lower()


async def _get_song(client: httpx.AsyncClient, base: str,
                    auth: list[tuple[str, str]], song_id: str) -> dict | None:
    """Fetch a Navidrome song by id. Returns the Subsonic Child dict or None."""
    try:
        r = await client.get(f"{base}/rest/getSong.view",
                             params=auth + [("id", song_id)])
        r.raise_for_status()
        return (r.json().get("subsonic-response", {}).get("song")) or None
    except Exception as exc:
        log.warning("getSong %s failed: %s", song_id, exc)
        return None


async def _search_one(client: httpx.AsyncClient, base: str,
                      auth: list[tuple[str, str]], query: str) -> list[dict]:
    """Run a search3 songs-only query, return the ``song`` list."""
    params = auth + [("query", query), ("songCount", "5"),
                     ("artistCount", "0"), ("albumCount", "0")]
    try:
        r = await client.get(f"{base}/rest/search3.view", params=params)
        r.raise_for_status()
        result = r.json().get("subsonic-response", {}).get("searchResult3", {})
        return result.get("song") or []
    except Exception as exc:
        log.warning("search3 %r failed: %s", query, exc)
        return []


def _best_match(candidates: list[dict], want_artist: str, want_title: str) -> dict | None:
    """Pick the candidate whose (artist, title) most closely matches. We prefer
    an exact case-insensitive match; otherwise fall back to the first result
    Navidrome ranked highest."""
    if not candidates:
        return None
    wa, wt = _normalize(want_artist), _normalize(want_title)
    for c in candidates:
        if _normalize(c.get("artist", "")) == wa and _normalize(c.get("title", "")) == wt:
            return c
    for c in candidates:
        if _normalize(c.get("title", "")) == wt:
            return c
    return candidates[0]


async def build_radio(client: httpx.AsyncClient, base: str, query_params,
                      seed_id: str, count: int) -> tuple[list[dict], dict]:
    """Build a radio queue seeded on ``seed_id``.

    Returns ``(songs, debug)``. ``songs`` is a list of Subsonic Child dicts,
    empty when the caller should fall back to Navidrome's own similar-songs.
    ``debug`` carries counts + the seed MBID so the diagnostic endpoint can
    surface what happened without a second run.
    """
    debug = {"seed_id": seed_id, "seed_mbid": None, "seed_artist": None,
             "seed_title": None, "lb_returned": 0, "resolved": 0}

    if not RADIO_ENABLED:
        debug["skipped"] = "RADIO_ENABLED=false"
        return [], debug

    auth = _auth_from(query_params)
    seed = await _get_song(client, base, auth, seed_id)
    if not seed:
        debug["skipped"] = "seed not found in Navidrome"
        return [], debug

    # Navidrome exposes the recording MBID as ``musicBrainzId`` on the Child.
    mbid = (seed.get("musicBrainzId") or "").strip()
    seed_artist = seed.get("artist") or ""
    seed_title = seed.get("title") or ""
    debug.update(seed_mbid=mbid or None,
                 seed_artist=seed_artist, seed_title=seed_title)

    # Build a list of MBIDs to try. If the tag is present, start there. Then
    # search MusicBrainz for alternative recordings of the same track —
    # different releases have different MBIDs, and ListenBrainz only has
    # scrobble data for some of them. We try each until one returns hits.
    candidates: list[str] = []
    if mbid:
        candidates.append(mbid)
    mb_candidates = await listenbrainz.search_mb_recordings(seed_artist, seed_title, limit=6)
    for c in mb_candidates:
        if c not in candidates:
            candidates.append(c)
    debug["candidate_mbids"] = candidates[:6]
    if not candidates:
        debug["skipped"] = "no MBID (tag missing + MB search empty)"
        return [], debug

    recs: list[dict] = []
    used_mbid = ""
    for cand in candidates:
        # Ask for extra so we still hit ``count`` after dedupe + library misses.
        rec_batch = await listenbrainz.similar_recordings(cand, count=max(count * 3, 40))
        if rec_batch:
            recs = rec_batch
            used_mbid = cand
            break
    debug["seed_mbid_used"] = used_mbid or None
    debug["lb_returned"] = len(recs)
    if not recs:
        debug["skipped"] = "no ListenBrainz similarities for any candidate MBID"
        return [], debug

    songs: list[dict] = []
    seen_ids: set[str] = set()
    seen_ids.add(seed_id)  # never re-queue the seed itself

    for rec in recs:
        # Search by "<artist> <title>" first — Navidrome doesn't index by MBID.
        candidates = await _search_one(client, base, auth,
                                       f"{rec['artist']} {rec['title']}")
        match = _best_match(candidates, rec["artist"], rec["title"])
        if not match:
            continue
        sid = match.get("id")
        if not sid or sid in seen_ids:
            continue
        seen_ids.add(sid)
        songs.append(match)
        if len(songs) >= count:
            break

    debug["resolved"] = len(songs)
    if len(songs) < RADIO_MIN_RESULTS:
        # Too few local hits — let the caller fall back so the user isn't stuck
        # with a two-song radio.
        debug["skipped"] = f"only {len(songs)} local matches (< {RADIO_MIN_RESULTS})"
        return [], debug
    return songs, debug
