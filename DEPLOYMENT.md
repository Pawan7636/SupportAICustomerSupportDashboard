# Deployment Guide

This project has two independent parts that must be deployed separately:

| Part | Deploy to | Notes |
|------|-----------|-------|
| **Backend API** (Node.js + Express + SQLite) | [Render](https://render.com) | Web Service — persistent disk for SQLite |
| **Frontend** (React + Vite) | [Vercel](https://vercel.com) | Static site — points to the Render backend |

---

## Part 1 — Backend on Render

### Why Render?
Render provides persistent disk storage, which SQLite requires. Vercel and Netlify are serverless and cannot persist a SQLite file between requests.

### Step 1 — Push your code to GitHub

If you haven't already:
```bash
git init
git add .
git commit -m "initial commit"
gh repo create supportai --public --push
# or push to an existing repo
```

Make sure `server/.env` is in `.gitignore` (it is by default). Never commit it.

### Step 2 — Create a Web Service on Render

1. Go to [render.com](https://render.com) and sign in.
2. Click **New → Web Service**.
3. Connect your GitHub repo.
4. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | `supportai-backend` |
| **Region** | Closest to your users |
| **Branch** | `main` |
| **Root Directory** | `server` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | Starter ($7/mo) — needed for persistent disk |

### Step 3 — Add a Persistent Disk

SQLite needs a disk that survives deploys and restarts.

1. In your Render service, go to **Disks** → **Add Disk**.
2. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `supportai-data` |
| **Mount Path** | `/data` |
| **Size** | 1 GB (free tier gives 1 GB) |

3. Set the database path in environment variables (next step):
   ```
   DB_PATH=/data/support.db
   ```

### Step 4 — Set Environment Variables on Render

In your Render service go to **Environment** and add each variable:

```
NODE_ENV=production
PORT=3001
DB_PATH=/data/support.db

JWT_ACCESS_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<generate a different one>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

GEMINI_API_KEY=<your key from aistudio.google.com/app/apikey>
GEMINI_MODEL=gemini-3.8-flash

BCRYPT_ROUNDS=10

# Set this AFTER you know your Vercel frontend URL (Step 2 of Part 2)
CORS_ORIGINS=https://your-app.vercel.app
```

> Generate secrets with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```
> Run it twice — once for each secret. They must be different.

### Step 5 — Deploy

Click **Deploy**. Render will:
1. Pull your code
2. Run `npm install && npm run build` (compiles TypeScript → `dist/`)
3. Start the server with `npm start`
4. Auto-apply the database schema on first boot

Your API will be live at:
```
https://supportai-backend.onrender.com
```

Test it:
```bash
curl https://supportai-backend.onrender.com/health
# → {"success":true,"data":{"status":"ok","ts":"..."}}
```

### Step 6 — Seed the Knowledge Base (optional but recommended)

After the backend is live, run the seed script once from your local machine:
```bash
cd server
GEMINI_API_KEY=<your key> npx tsx src/db/seedKnowledge.ts
```

Or use Render's **Shell** tab to run it directly on the server:
```bash
npx tsx src/db/seedKnowledge.ts
```

---

## Part 2 — Frontend on Vercel

### Step 1 — Update the API base URL

The frontend uses a relative `API_BASE = ""` which works through the Vite proxy in development. In production on Vercel there is no proxy, so API calls need to point directly to your Render backend.

The cleanest solution is to use a Vercel rewrite rule so `API_BASE` can stay as `""` and `/api/*` is forwarded to Render server-side.

Create a `vercel.json` file in the **project root**:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://supportai-backend.onrender.com/api/:path*"
    }
  ]
}
```

Replace `supportai-backend.onrender.com` with your actual Render URL.

This means:
- Frontend calls `/api/chat/stream` (relative, same-origin)
- Vercel rewrites it to `https://supportai-backend.onrender.com/api/chat/stream`
- No CORS issues, no hardcoded URLs in the React code

### Step 2 — Create a Vercel project

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New → Project**.
3. Import your GitHub repo.
4. Configure:

| Setting | Value |
|---------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `.` (project root, not `server/`) |
| **Build Command** | `pnpm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `pnpm install` |

### Step 3 — Set Environment Variables on Vercel

Go to **Settings → Environment Variables** and add:

```
NODE_ENV=production
```

No other env vars needed on the frontend — API keys and secrets stay on the backend (Render).

### Step 4 — Deploy

Click **Deploy**. Vercel will build the React app and publish it.

Your frontend will be live at:
```
https://your-app.vercel.app
```

### Step 5 — Update CORS on Render

Go back to your Render service **Environment** and update `CORS_ORIGINS` to your Vercel URL:
```
CORS_ORIGINS=https://your-app.vercel.app
```

Then click **Save Changes** — Render will redeploy automatically.

---

## Verifying the full deployment

1. Open your Vercel URL in a browser.
2. Sign in (use the seeded accounts or register a new one).
3. Go to **AI Assistant**, type a question, click **Generate response**.
4. You should see a streaming response with RAG source citations.

Check the Render logs if something goes wrong — go to your Render service → **Logs**.

---

## Custom Domain (optional)

**Vercel:**
1. Settings → Domains → Add your domain.
2. Update your DNS with the CNAME Vercel provides.

**Render:**
1. Settings → Custom Domains → Add domain.
2. Update your DNS with the records Render provides.
3. Update `CORS_ORIGINS` on Render to include your custom frontend domain.

---

## Re-deployments

| What changed | What to do |
|---|---|
| Frontend code | Push to `main` — Vercel auto-deploys |
| Backend code | Push to `main` — Render auto-deploys |
| Environment variables | Update in Render/Vercel dashboard — triggers redeploy |
| Knowledge base articles | Use the Knowledge Base screen in the app (agents/admins only) |
| Database schema | Schema is auto-applied on every server start (idempotent) |

---

## Architecture diagram

```
Browser (Vercel CDN)
        │
        │  GET /  → serves React SPA (static)
        │  POST /api/chat/stream
        ▼
   Vercel Edge (rewrite)
        │
        │  forwards /api/* →
        ▼
  Render Web Service
  (Node.js + Express)
        │
        ├── SQLite DB (/data/support.db on persistent disk)
        └── Google Gemini API (text-embedding-004 + gemini-3.8-flash)
```

---

## Troubleshooting

**Render: "No such file or directory: dist/index.js"**
Make sure the build command is `npm install && npm run build` and the start command is `npm start`. The TypeScript build outputs to `server/dist/`.

**Vercel: API calls return 404**
Check that `vercel.json` exists in the project root with the correct Render URL. Redeploy after adding it.

**Render: Database resets on every deploy**
You must add a **Persistent Disk** mounted at `/data` and set `DB_PATH=/data/support.db`. Without the disk, the database is in the ephemeral filesystem and is wiped on redeploy.

**CORS errors in browser console**
Update `CORS_ORIGINS` on Render to exactly match your Vercel URL (no trailing slash). Then trigger a redeploy on Render.

**Gemini 503 errors**
The backend has automatic retry with exponential backoff built in (up to 3 retries). If errors persist, check that `GEMINI_API_KEY` is set correctly on Render and that `GEMINI_MODEL=gemini-3.8-flash` is set.

**Render free tier spins down after inactivity**
The free Render tier sleeps after 15 minutes of inactivity, causing a ~30 second cold start on the next request. Upgrade to the Starter plan ($7/mo) or use a cron job to ping `/health` every 10 minutes to keep it warm.
