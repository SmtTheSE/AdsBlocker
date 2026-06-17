# ClearStream deployment

## Option A — Full stack (recommended for playback)

Deploy the Docker image to **Railway**, **Render**, or **Fly.io**:

```bash
# Railway (install CLI first)
railway login
railway init
railway up
```

The container includes `yt-dlp` for reliable media streaming and disk caching.

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
