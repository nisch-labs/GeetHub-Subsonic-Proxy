# GeetHub-Subsonic-Proxy

A thin **FastAPI layer that sits in front of Navidrome** — plus a
**Svelte web player** served from the same container.

Part of the [Geet-Hub](https://github.com/nisch-labs/GeetHub) self-hosted
music ecosystem.

## What it adds on top of Navidrome

- **YouTube / YouTube Music search injection** — Subsonic `search3` responses
  are merged with live YouTube results as virtual tracks (`yt-` / `ytm-`
  prefixes) that stream on demand via yt-dlp + ffmpeg.
- **Save-to-Library** — a virtual YouTube track can be permanently downloaded
  into your Navidrome library through Antra (or a yt-dlp fallback if Antra
  can't source it), with progress polling.
- **Downloader pass-through** — REST endpoints for queueing Antra jobs from
  any Spotify / YouTube / Apple Music / Deezer / Tidal / etc. URL and
  reading per-track progress.
- **Multi-device sync** — an in-memory registry keyed by `(user, device_id)`
  with `heartbeat` / `list` / `transfer` / `poll_commands` endpoints so
  every signed-in client (iPhone, iPad, Mac, web) can see the others and
  hand off playback like Spotify Connect.
- **Web player** — the Svelte SPA under `web/` is built into `/app/web` and
  served from the same FastAPI process at `/`. Same feature set as the iOS
  app; runs in any modern browser.

Everything else it just forwards straight to Navidrome, unmodified.

## Architecture

```
┌─────────────────┐            ┌─────────────────┐
│  Geet-Hub iOS   │            │  Web player     │
│  (iPhone/iPad/  │            │  (this repo,    │
│   Mac Catalyst) │            │   web/)         │
└────────┬────────┘            └────────┬────────┘
         │                              │
         └───────────┬──────────────────┘
                     ▼
            ┌────────────────┐
            │ subsonic-proxy │  ← this repo (FastAPI)
            └───┬────────┬───┘
                │        │
                ▼        ▼
        ┌───────────┐  ┌───────────┐
        │ Navidrome │  │  Antra    │
        │ (streams  │  │  (fetches │
        │  files)   │  │  audio)   │
        └─────┬─────┘  └─────┬─────┘
              └──────┬───────┘
                     ▼
              shared /music dir
```

## Quick start (Docker)

Recommended for real deployments. This assumes you already have Navidrome
and Antra running on the same host.

```sh
git clone https://github.com/nisch-labs/GeetHub-Subsonic-Proxy.git
cd GeetHub-Subsonic-Proxy
cp .env.example .env
$EDITOR .env          # set MUSIC_DIR + ANTRA_ADMIN_KEY
docker compose up -d --build
```

The proxy listens on **port 4544**. Point Geet-Hub iOS or open the web
player at `http://<host>:4544` and log in with your Navidrome credentials.

For a **complete stack** (Navidrome + Antra + subsonic-proxy in one
compose file), see the [umbrella repo](https://github.com/nisch-labs/GeetHub).

## Configuration

All configuration is via environment variables (see `docker-compose.yml`):

| Var | Default | Meaning |
|---|---|---|
| `NAVIDROME_URL` | `http://127.0.0.1:4533` | Where your Navidrome is |
| `ANTRA_URL` | `http://127.0.0.1:8288` | Where your Antra is |
| `LISTEN_PORT` | `4544` | HTTP port the proxy serves on |
| `MUSIC_DIR` | `./music` | Host path to shared music library (set in `.env`) |
| `FALLBACK_DIR` | `/music/YouTube` | Where the yt-dlp fallback writes new files |
| `YT_SEARCH_LIMIT` | `5` | Max YouTube results merged into `search3` |
| `MAGIC_PLAYLIST_NAME` | `Download via Antra` | Navidrome playlist that triggers Antra saves |
| `ANTRA_SOURCE` | `deezer` | Source preference passed to Antra |
| `ANTRA_FORMAT` | `mp3` | Format passed to Antra |
| `ANTRA_FOLDER` | `` | Subfolder under MUSIC_DIR for Antra jobs |
| `ANTRA_ADMIN_KEY` | *(required)* | Antra admin token — set in `.env`, never committed |

## Repository layout

```
subsonic-proxy/
├── app.py               FastAPI app — Subsonic pass-through + custom endpoints
├── youtube.py           yt-dlp integration (search, stream, download)
├── youtube_music.py     ytmusicapi integration
├── subsonic.py          Navidrome HTTP client (salted-MD5 auth)
├── antra.py             Antra REST client
├── deezer.py            Deezer metadata lookups
├── devices.py           Multi-device registry (in-memory, per-user)
├── requirements.txt     Python deps
├── Dockerfile           Two-stage build: web (Node) → runtime (Python)
├── docker-compose.yml   Reference deployment
└── web/                 Svelte + Vite web player
    ├── src/
    │   ├── lib/subsonic/  API client + models (mirrors GeetHubKit)
    │   ├── lib/stores/    session, player, download stores
    │   ├── lib/components/ PlayerDock, DevicesSheet, etc.
    │   └── routes/        Home, Library, Search, Downloader, Settings
    ├── package.json
    └── vite.config.ts
```

## Local development

The Python side wants Python 3.12+; the web side wants Node 20+.

```sh
# Backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 4544

# Web (in another shell)
cd web
npm install
VITE_UPSTREAM=http://localhost:4544 npm run dev
# open http://localhost:5173
```

The Vite dev server proxies `/rest`, `/api`, `/healthz` to `VITE_UPSTREAM`
(defaults to `http://localhost:4544`) so the web app can talk to a running
proxy during development.

## Contributing

Issues and PRs welcome. If you're planning something bigger than a bug fix,
please open an issue first.

## License

MIT — see [LICENSE](LICENSE).

## Related repos

- **[GeetHub](https://github.com/nisch-labs/GeetHub)** — umbrella: architecture
  overview + docker-compose for the full stack
- **[GeetHub-iOS](https://github.com/nisch-labs/GeetHub-iOS)** — the SwiftUI
  client (iPhone / iPad / Mac Catalyst)
- **[GeetHub-Antra](https://github.com/nisch-labs/GeetHub-Antra)** — Antra
  fork used for URL-based downloads (Elastic License 2.0)
- **[Navidrome](https://www.navidrome.org/)** — the underlying music server
  (third-party, MIT)
