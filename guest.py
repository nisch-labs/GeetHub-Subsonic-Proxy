"""Guest Request — short-lived token sessions that let a passenger scan a QR,
land on a public web page, and remote-control the host's playback.

State is in-memory (hobby scale, one proxy process). A session ties a
random URL-safe token to (user, host_device_id) and expires after
``SESSION_TTL_SECONDS``. The token is the ONLY credential — the guest never
authenticates. Endpoints exposed under /api/guest/* are gated to search and a
single "replace now playing on host" action; the guest cannot reach the host's
library, star tracks, or admin the account.

Search on behalf of a guest uses the server-configured
``NAVIDROME_USER`` / ``NAVIDROME_PASS`` env vars so no host credentials
ever leave the client.
"""
from __future__ import annotations

import secrets
import time

SESSION_TTL_SECONDS = 30 * 60  # 30 minutes

# token -> {token, user, host_device_id, expires_at, revoked}
_sessions: dict[str, dict] = {}


def _prune() -> None:
    now = time.time()
    stale = [t for t, s in _sessions.items()
             if s.get("revoked") or s.get("expires_at", 0) < now]
    for t in stale:
        _sessions.pop(t, None)


def create(user: str, host_device_id: str) -> dict:
    """Mint a fresh guest-session token bound to (user, host_device_id)."""
    _prune()
    token = secrets.token_urlsafe(16)
    session = {
        "token": token,
        "user": user,
        "host_device_id": host_device_id,
        "expires_at": time.time() + SESSION_TTL_SECONDS,
        "revoked": False,
    }
    _sessions[token] = session
    return session


def get(token: str) -> dict | None:
    """Return the session record if still valid, else None."""
    _prune()
    s = _sessions.get(token)
    if not s or s.get("revoked") or s.get("expires_at", 0) < time.time():
        return None
    return s


def revoke(token: str) -> bool:
    """Explicitly end a session (host tapped 'End Session')."""
    s = _sessions.pop(token, None)
    return s is not None
