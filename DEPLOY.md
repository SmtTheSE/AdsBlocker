# ClearStream deployment

## Option A — Full stack (recommended for playback)

Deploy the Docker image to **Railway**, **Render**, or **Fly.io**.

### Render (dashboard)

1. [render.com](https://render.com) → **New** → **Web Service** → connect GitHub repo
2. **Runtime:** Docker | **Health check:** `/api/health`
3. Optional env vars on Render:

| Name | Value |
|------|-------|
| `YTDL_NO_UPDATE` | `1` (silences update-check 403 warnings) |
| `YTDLP_PLAYER_CLIENT` | `android,web` (default in Dockerfile) |

4. Deploy → copy URL, e.g. `https://adsblocker-cqaa.onrender.com`
5. Test: `curl https://YOUR-APP.onrender.com/api/health`

The `Error checking for updates: Status code: 403` line in Render logs is **harmless** — the service is still live.

The container installs the **latest yt-dlp** release (not Debian’s old package).

## Option B — Vercel frontend + media backend

1. Deploy this repo with **Docker** to Railway/Render (Option A).
2. Copy your backend URL, e.g. `https://clearstream-api.up.railway.app`
3. In **Vercel** → Project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `MEDIA_BACKEND_URL` | `https://your-railway-app.up.railway.app` |

4. Redeploy Vercel.

Vercel will serve the UI + search/metadata APIs. `/api/media` forwards to your Docker backend for actual playback.

## Local development

```bash
npm install
brew install yt-dlp   # macOS
npm run dev
```

Open http://localhost:3000

## Why Vercel alone cannot stream

YouTube blocks datacenter IPs (including Vercel). Public Piped/Invidious instances are frequently down. A backend with `yt-dlp` (Docker) is required for reliable playback in production.
