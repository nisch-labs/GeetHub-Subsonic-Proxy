"""Resolve an (artist, title) to a clean Deezer track link via Deezer's public
search API (no auth). Antra sources this reliably from its lossless catalog."""
import logging
import urllib.parse

import httpx

log = logging.getLogger("subsonic-proxy.deezer")

API = "https://api.deezer.com/search"


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


async def search(artist: str, title: str):
    """Return a deezer.com/track/<id> link for the best match, or None."""
    if not title:
        return None
    q = f'track:"{title}" artist:"{artist}"' if artist else title
    url = f"{API}?q={urllib.parse.quote(q)}&limit=5"
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(url)
            data = (r.json() or {}).get("data", [])
    except Exception as exc:
        log.warning("deezer search failed for %r/%r: %s", artist, title, exc)
        return None
    if not data:
        # Retry as a loose free-text query (artist may be a YouTube channel name).
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.get(f"{API}?q={urllib.parse.quote(f'{artist} {title}')}&limit=5")
                data = (r.json() or {}).get("data", [])
        except Exception:
            return None
    if not data:
        return None
    # Prefer a hit whose title token-matches; else take Deezer's top relevance.
    want = _norm(title)
    for t in data:
        if _norm(t.get("title", "")) == want or want in _norm(t.get("title", "")):
            log.info("deezer match: %s - %s", t["artist"]["name"], t["title"])
            return t.get("link")
    top = data[0]
    log.info("deezer top: %s - %s", top["artist"]["name"], top["title"])
    return top.get("link")
