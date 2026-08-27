"""In-memory multi-device registry — powers the Spotify-style "Devices" menu.

Each Geet-Hub client (iOS / iPadOS / Mac Catalyst / Web) registers itself by
sending a periodic heartbeat with `(device_id, name, kind, currentSong,
position, isPlaying)`. Any device can then transfer playback to any other of
the same user's devices by dropping a command onto the target's queue; the
target picks it up on its next `poll_commands` call.

State is intentionally in-memory: hobby scale, one proxy process, restarts are
fine (clients heartbeat back in within 15s of coming online)."""
from __future__ import annotations

import time
import uuid
from typing import Any

# (user, device_id) -> device dict
_devices: dict[tuple[str, str], dict] = {}
# (user, device_id) -> list of queued commands
_commands: dict[tuple[str, str], list[dict]] = {}

DEVICE_TTL_SECONDS = 120


def _prune() -> None:
    """Drop devices we haven't heard from in >2 minutes."""
    now = time.time()
    stale = [k for k, v in _devices.items() if v.get("last_seen", 0) < now - DEVICE_TTL_SECONDS]
    for k in stale:
        _devices.pop(k, None)
        _commands.pop(k, None)


def heartbeat(user: str, payload: dict) -> dict:
    """Upsert a device record. Returns the stored dict (with `id` filled)."""
    device_id = (payload.get("id") or "").strip() or uuid.uuid4().hex[:16]
    record = {
        "id": device_id,
        "name": (payload.get("name") or "Unknown").strip(),
        "kind": (payload.get("kind") or "other").strip().lower(),
        "isPlaying": bool(payload.get("isPlaying", False)),
        "currentSong": payload.get("currentSong"),
        "position": float(payload.get("position") or 0),
        "duration": float(payload.get("duration") or 0),
        "last_seen": time.time(),
    }
    _devices[(user, device_id)] = record
    return record


def list_for(user: str) -> list[dict]:
    _prune()
    return [d for (u, _id), d in _devices.items() if u == user]


def transfer(user: str, target_id: str, source_id: str | None,
             song: Any, position: float) -> bool:
    """Queue a `play(song, position)` command for the target device and,
    if the source device is known, a matching `pause` command for the
    source. Returns True if the target is known."""
    _prune()
    if (user, target_id) not in _devices:
        return False
    _commands.setdefault((user, target_id), []).append({
        "type": "play", "song": song, "position": float(position or 0),
    })
    if source_id and (user, source_id) in _devices:
        _commands.setdefault((user, source_id), []).append({"type": "pause"})
    return True


def poll_commands(user: str, device_id: str) -> list[dict]:
    """Read and clear pending commands for a device. Idempotent — subsequent
    calls with no new commands return []."""
    cmds = _commands.pop((user, device_id), [])
    return cmds
