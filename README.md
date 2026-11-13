# SupportAI — AI-Powered Customer Support Dashboard

A full-stack customer support platform that uses **Google Gemini** and **RAG (Retrieval-Augmented Generation)** to generate accurate, knowledge-grounded responses to customer queries — in real time.

![Dashboard](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Backend](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![AI](https://img.shields.io/badge/Gemini-3.8_Flash-4285F4?logo=google&logoColor=white)
![Database](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?logo=sqlite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)

---

## What it does

Support agents paste a customer query, choose a category and tone, and Gemini generates a response grounded in a custom knowledge base. Responses stream in real time via Server-Sent Events, with citations showing which knowledge base articles were used.

**Core features:**
- 🤖 **RAG-based AI assistant** — responses grounded in your knowledge base, not hallucinated
- 📚 **Knowledge base management** — full CRUD for articles, auto-embedded with `text-embedding-004`
- 🎫 **Ticket management** — full lifecycle with status, priority, assignment, and audit trail
- 🔐 **JWT authentication** — access + refresh tokens, role-based access control (customer / agent / admin)
- 📡 **Real-time streaming** — Gemini responses stream token-by-token via SSE
- 🔄 **Automatic retry** — exponential backoff on Gemini 503/429 errors

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Tailwind CSS v4, TypeScript 5.7 |
| Backend | Node.js 22, Express 4, TypeScript 5.7 |
| Database | SQLite (Node built-in `node:sqlite`, WAL mode) |
| AI — Chat | Google Gemini 3.8 Flash |
| AI — Embeddings | Google `text-embedding-004` (768 dims) |
| Auth | JWT HS256 (`jose`), bcrypt, refresh token rotation |
| Validation | Zod |

---

## Project Structure

```
SupportAICustomerSupportDashboard/
├── src/                     # React frontend
│   ├── App.tsx              # All screens and components
│   ├── index.css            # Tailwind + custom design tokens
│   └── main.tsx             # Entry point
├── public/                  # Static assets
├── index.html               # Vite HTML shell
├── vite.config.ts           # Vite + dev proxy config
├── vercel.json              # Production API rewrite (create before deploying)
│
└── server/                  # Express backend (independent Node project)
    ├── src/
    │   ├── index.ts         # Server entry — middleware + routes
    │   ├── routes/
    │   │   ├── auth.ts      # Register, login, refresh, logout
    │   │   ├── chat.ts      # RAG + Gemini chat (streaming + non-streaming)
    │   │   ├── knowledgeBase.ts  # KB CRUD + semantic search
    │   │   ├── tickets.ts   # Ticket lifecycle + audit
    │   │   ├── replies.ts   # Replies + internal notes
    │   │   └── users.ts     # User management
    │   ├── db/
    │   │   ├── schema.sql   # SQLite schema (auto-applied on startup)
    │   │   ├── database.ts  # Singleton DB connection (WAL mode)
    │   │   ├── knowledgeBase.ts  # KB CRUD helpers
    │   │   ├── autoMigrate.ts    # Idempotent schema runner
    │   │   ├── seed.ts      # Demo accounts and tickets
    │   │   └── seedKnowledge.ts  # 20 RAG knowledge base articles
    │   ├── middleware/
    │   │   ├── authenticate.ts  # JWT verification + requireRoles
    │   │   ├── validate.ts      # Zod request validation
    │   │   └── errorHandler.ts  # Global error handler
    │   ├── utils/
    │   │   ├── embeddings.ts  # text-embedding-004 + cosine similarity
    │   │   ├── jwt.ts         # Token sign/verify/hash
    │   │   ├── logger.ts      # Structured JSON logger
    │   │   └── response.ts    # Consistent JSON envelope helpers
    │   └── types/index.ts     # Shared TypeScript types
    ├── .env.example         # Environment variable template
    └── package.json         # Backend dependencies
```

---

## Getting Started

### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org)
- **pnpm 10+** — `npm install -g pnpm`
- **Google Gemini API key** — [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (free)

### 1 — Clone and install

```bash
git clone https://github.com/your-username/SupportAICustomerSupportDashboard.git
cd SupportAICustomerSupportDashboard

# Frontend dependencies
pnpm install

# Backend dependencies
cd server && npm install && cd ..
```

### 2 — Configure the backend

```bash
cp server/.env.example server/.env
```

Open `server/.env` and fill in the required values:

```env
PORT=3001
NODE_ENV=development
CORS_ORIGINS=http://localhost:8443,http://localhost:5173

JWT_ACCESS_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<run the command again for a different value>

GEMINI_API_KEY=<your key from aistudio.google.com>
GEMINI_MODEL=gemini-3.8-flash
```

Generate the two JWT secrets by running this command **twice** in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3 — Run the app

You need **two terminals open at the same time.**

**Terminal 1 — Backend:**
```bash
cd server
npm run dev
```
Server starts at **http://localhost:3001**

**Terminal 2 — Frontend:**
```bash
pnpm dev
```
App opens at **http://localhost:8443**

### 4 — Seed demo data (optional but recommended)

```bash
# Demo accounts and sample tickets
cd server && npm run seed

# Knowledge base articles with embeddings (requires GEMINI_API_KEY)
npx tsx src/db/seedKnowledge.ts
```

This creates 5 demo accounts — all use password `Password1!`:

| Email | Role |
|-------|------|
| admin@supportai.dev | Admin |
| agent1@supportai.dev | Agent |
| agent2@supportai.dev | Agent |
| customer1@example.com | Customer |
| customer2@example.com | Customer |

---

## How the RAG Pipeline Works

```
User query
    │
    ▼
Embed with text-embedding-004  →  768-dimensional vector
    │
    ▼
Cosine similarity vs all KB article embeddings
    │
    ▼
Top 3 articles above 0.5 similarity threshold
    │
    ▼
Inject articles into Gemini system prompt
    │
    ▼
gemini-3.8-flash generates response (streamed via SSE)
    │
    ▼
Response + source citations returned to frontend
```

If the embedding API fails, the system degrades gracefully — Gemini still runs without RAG context rather than returning an error.

---

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | Liveness check |
| `POST` | `/api/auth/register` | — | Create customer account |
| `POST` | `/api/auth/login` | — | Get token pair |
| `POST` | `/api/auth/refresh` | — | Rotate refresh token |
| `POST` | `/api/chat/stream` | — | RAG chat (SSE streaming) |
| `GET` | `/api/kb` | — | List knowledge base articles |
| `POST` | `/api/kb` | Agent/Admin | Create article + auto-embed |
| `POST` | `/api/kb/search` | — | Semantic similarity search |
| `GET` | `/api/tickets` | Auth | List tickets |
| `POST` | `/api/tickets` | Auth | Create ticket |
| `PATCH` | `/api/tickets/:id/status` | Agent/Admin | Change ticket status |

Full API reference: [`server/API.md`](server/API.md)

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Backend port |
| `NODE_ENV` | No | `development` | Environment |
| `CORS_ORIGINS` | No | — | Allowed frontend origins (comma-separated) |
| `DB_PATH` | No | `./data/support.db` | SQLite file path |
| `JWT_ACCESS_SECRET` | **Yes** | — | Access token signing key (≥32 chars) |
| `JWT_REFRESH_SECRET` | **Yes** | — | Refresh token signing key (≥32 chars) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token lifetime |
| `GEMINI_API_KEY` | **Yes** | — | Google Generative AI API key |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Gemini model for chat |
| `BCRYPT_ROUNDS` | No | `12` | bcrypt cost factor |

---

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for full instructions.

**Short version:**
- **Backend** → [Render](https://render.com) Web Service with a Persistent Disk (for SQLite)
- **Frontend** → [Vercel](https://vercel.com) with a `/api/*` rewrite to your Render URL

Add `vercel.json` to the project root before deploying to Vercel:
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend.onrender.com/api/:path*"
    }
  ]
}
```

---

## Security

- Passwords hashed with bcrypt (cost factor 12)
- JWT access tokens expire in 15 minutes; refresh tokens rotate on every use
- Refresh tokens stored as SHA-256 hashes — raw tokens never persisted
- Constant-time bcrypt comparison prevents timing attacks on login
- Role-based access: `customer < agent < admin`
- Customers receive `404` (not `403`) on other users' tickets to prevent enumeration
- `helmet` security headers on every response
- Rate limiting: 200 req/15min globally, 20 req/15min on auth endpoints

---

## License

MIT
