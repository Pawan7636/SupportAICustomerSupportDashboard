# Running SupportAI Locally

This project has two parts that run side-by-side:

| Part | Technology | Port |
|------|-----------|------|
| Frontend | React + Vite + Tailwind CSS | http://localhost:8443 |
| Backend API | Node.js + Express + SQLite | http://localhost:3001 |

You need **two terminal windows** — one for each.

---

## Prerequisites

- **Node.js 22** — download from https://nodejs.org or use a version manager
- **pnpm 10** — install with `npm install -g pnpm`

Verify you have them:
```bash
node --version   # should print v22.x.x
pnpm --version   # should print 10.x.x
npm --version    # comes with Node
```

---

## First-Time Setup

Do this once when you first clone the repo.

### 1 — Install frontend dependencies

Open a terminal in the project root:
```bash
pnpm install
```

### 2 — Install backend dependencies

```bash
cd server
npm install
```

### 3 — Configure backend secrets

```bash
cd server
copy .env.example .env
```

Open `server/.env` in any text editor and replace the two placeholder JWT secrets and the Gemini API key.
You can generate real secrets by running this command **twice** (once per secret):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Paste the first output as `JWT_ACCESS_SECRET` and the second as `JWT_REFRESH_SECRET`.

Your `server/.env` should look like this when done:

```env
NODE_ENV=development
PORT=3001
DB_PATH=./data/support.db
JWT_ACCESS_SECRET=<64-char hex string you generated>
JWT_REFRESH_SECRET=<different 64-char hex string>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
CORS_ORIGINS=http://localhost:5173,http://localhost:8443
GEMINI_API_KEY=<your key from https://aistudio.google.com/app/apikey>
GEMINI_MODEL=gemini-2.0-flash
```

> The `.env` file is gitignored — it will never be committed.

---

## Running the App

You need **two terminals open at the same time**.

### Terminal 1 — Backend API

```bash
cd server
npm run dev
```

You should see output like:
```
{"ts":"...","level":"info","message":"Database opened","path":"..."}
{"ts":"...","level":"info","message":"Schema applied","statements":42}
{"ts":"...","level":"info","message":"Server started","port":3001,"env":"development"}
```

The API is ready at **http://localhost:3001**

### Terminal 2 — Frontend

Open a second terminal in the **project root** (not inside `server/`):

```bash
pnpm dev
```

You should see:
```
  VITE v8.x.x  ready in xxx ms

  ➜  Local:   http://localhost:8443/
```

Open **http://localhost:8443** in your browser.

---

## Optional: Load Demo Data

After the backend is running, seed it with demo accounts and sample tickets:

```bash
cd server
npm run seed
```

This creates five accounts (all use password **`Password1!`**):

| Email | Role | What they can do |
|-------|------|-----------------|
| admin@supportai.dev | Admin | Full access — manage users, all tickets |
| agent1@supportai.dev | Agent | View/manage all tickets, add internal notes |
| agent2@supportai.dev | Agent | View/manage all tickets, add internal notes |
| customer1@example.com | Customer | View own tickets only |
| customer2@example.com | Customer | View own tickets only |

It also creates three sample tickets with replies and audit history.

> Run `npm run seed` only once. Running it again is safe (uses `INSERT OR IGNORE`) but won't add new data.

---

## Verify Everything is Working

With both servers running, test the API health endpoint:

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{"success":true,"data":{"status":"ok","ts":"2026-11-09T10:00:00.000Z"}}
```

Test a login (after seeding):

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@supportai.dev\",\"password\":\"Password1!\"}"
```

---

## Stopping the Servers

- Press **Ctrl + C** in each terminal to stop the server running there.
- The SQLite database is saved at `server/data/support.db` and persists between restarts.

---

## Troubleshooting

**Port already in use**

If port 3001 or 8443 is taken, change the port:
- Backend: edit `PORT=3001` in `server/.env`
- Frontend: edit the `port` value in `vite.config.ts` (under `server.port`)

Remember to update `CORS_ORIGINS` in `server/.env` if you change the frontend port.

**`node: command not found`**

Node.js is not installed or not on your PATH. Download it from https://nodejs.org and restart your terminal.

**`pnpm: command not found`**

```bash
npm install -g pnpm
```

**Frontend shows blank page / network errors**

Make sure the backend is running (`npm run dev` in `server/`) before loading the frontend. Check the browser console for failed requests to `localhost:3001`.

**JWT secret errors on startup**

Your `server/.env` secrets must be at least 32 characters. Re-generate them with the `node -e "..."` command above.

---

## File Layout Reference

```
SupportAICustomerSupportDashboard/
├── src/               ← React frontend source
├── public/            ← Static assets
├── index.html         ← Vite HTML entry
├── vite.config.ts     ← Frontend build config (port 8443)
├── package.json       ← Frontend deps (managed by pnpm)
│
└── server/            ← Backend (separate Node project)
    ├── src/           ← TypeScript source
    ├── data/          ← SQLite database lives here (gitignored)
    ├── .env           ← Your local secrets (gitignored)
    ├── .env.example   ← Template for .env
    ├── package.json   ← Backend deps (managed by npm)
    ├── README.md      ← Backend-specific docs
    └── API.md         ← Full API endpoint reference
```
