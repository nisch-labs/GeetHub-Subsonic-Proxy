"""Helpers to model virtual tracks as Subsonic <song> entries and inject them
into a Navidrome search3 response — for both JSON (f=json) and XML responses.
"""
import re
import json
import logging

log = logging.getLogger("subsonic-proxy.subsonic")


def _xml_escape(s) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# All virtual tracks hang off one synthetic "YouTube" album so Amperfy's search
# display predicate (which needs an attached album with remoteStatus=available)
# is satisfied. Its artist id is per-track.
YT_ALBUM_ID = "yt-album-youtube"


def _size_estimate(duration: int) -> int:
    # Amperfy hides uncached songs with size<=0; give a plausible byte count.
    d = int(duration or 0)
    return d * 32000 if d else 5_000_000


def song_json(v: dict) -> dict:
    """A virtual track as a Subsonic 'Child' object (JSON shape)."""
    return {
        "id": v["id"],
        "isDir": False,
        "title": v["title"],
        "album": v.get("album", "YouTube"),
        "albumId": YT_ALBUM_ID,
        "artist": v.get("artist", "YouTube"),
        "artistId": "yta-" + v["id"],
        "coverArt": v["id"],
        "duration": v.get("duration", 0),
        "size": _size_estimate(v.get("duration", 0)),
        "contentType": "audio/mpeg",
        "suffix": "mp3",
        "type": "music",
        "isVideo": False,
    }


def _song_xml_attrs(v: dict) -> dict:
    return {
        "id": v["id"],
        "isDir": "false",
        "title": v["title"],
        "album": v.get("album", "YouTube"),
        "albumId": YT_ALBUM_ID,
        "artist": v.get("artist", "YouTube"),
        "artistId": "yta-" + v["id"],
        "coverArt": v["id"],
        "duration": str(v.get("duration", 0)),
        "size": str(_size_estimate(v.get("duration", 0))),
        "contentType": "audio/mpeg",
        "suffix": "mp3",
        "type": "music",
        "isVideo": "false",
    }


def _existing_keys(songs) -> set:
    keys = set()
    for s in songs or []:
        t = (s.get("title") if isinstance(s, dict) else s.get("title", "")) or ""
        a = (s.get("artist") if isinstance(s, dict) else s.get("artist", "")) or ""
        keys.add((t.lower().strip(), a.lower().strip()))
    return keys


def inject_json(body: bytes, virtuals: list) -> bytes:
    doc = json.loads(body)
    resp = doc.get("subsonic-response", {})
    result = resp.setdefault("searchResult3", {})
    songs = result.get("song") or []
    existing = _existing_keys(songs)
    added = [song_json(v) for v in virtuals
             if (v["title"].lower().strip(), v["artist"].lower().strip()) not in existing]
    result["song"] = songs + added
    return json.dumps(doc).encode("utf-8")


def _song_xml(v: dict) -> str:
    attrs = " ".join(f'{k}="{_xml_escape(val)}"' for k, val in _song_xml_attrs(v).items())
    return f"<song {attrs}/>"


def inject_xml(body: bytes, virtuals: list) -> bytes:
    """Insert <song> elements just before </searchResult3>, leaving the rest of
    Navidrome's XML byte-for-byte intact (re-serializing the whole doc can make
    strict clients like Amperfy reject it and show nothing)."""
    text = body.decode("utf-8")
    # Skip virtuals whose title already appears in the real results.
    fresh = [v for v in virtuals
             if f'title="{_xml_escape(v["title"])}"'.lower() not in text.lower()]
    if not fresh:
        return body
    songs = "".join(_song_xml(v) for v in fresh)

    if "</searchResult3>" in text:
        return text.replace("</searchResult3>", songs + "</searchResult3>", 1).encode("utf-8")
    # Empty self-closing element: <searchResult3/> or <searchResult3 .../>
    m = re.search(r"<searchResult3(\s[^>]*?)?/>", text)
    if m:
        opened = f"<searchResult3{m.group(1) or ''}>{songs}</searchResult3>"
        return text.replace(m.group(0), opened, 1).encode("utf-8")
    log.warning("no searchResult3 element found in XML; leaving body unchanged")
    return body


def inject_search3(body: bytes, is_json: bool, virtuals: list) -> bytes:
    if not virtuals:
        return body
    try:
        return inject_json(body, virtuals) if is_json else inject_xml(body, virtuals)
    except Exception as exc:
        log.warning("search3 injection failed, returning upstream body: %s", exc)
        return body
