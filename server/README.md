# SupportAI Backend

Production-ready REST API for the SupportAI customer support system.

Built with **Node.js · Express · TypeScript · SQLite (node:sqlite built-in) · JWT (jose) · Zod**.

---

## Quick Start

### 1 — Install dependencies
```bash
cd server
npm install
```

### 2 — Configure environment
```bash
cp .env.example .env
# Edit .env — at minimum, change the two JWT secrets
```

Generate strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run that twice and put the outputs in `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

### 3 — Start development server
```bash
npm run dev
```

The server starts on **http://localhost:3001** (or `PORT` from `.env`).
The schema is applied automatically on first boot — no separate migration step needed.

### 4 — Seed demo data (optional)
```bash
npm run seed
```

Creates five demo accounts (all with password `Password1!`):

| Email | Role |
|-------|------|
| admin@supportai.dev | admin |
| agent1@supportai.dev | agent |
| agent2@supportai.dev | agent |
| customer1@example.com | customer |
| customer2@example.com | customer |

Also creates three sample tickets with replies and audit history.

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot-reload via `tsx watch` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output (production) |
| `npm run migrate` | Re-apply schema manually |
| `npm run seed` | Insert demo data (dev only) |
| `npm run lint` | Type-check without emitting files |

---

## Project Structure

```
server/
├── src/
│   ├── db/
│   │   ├── schema.sql          # Database schema + FTS + triggers
│   │   ├── database.ts         # SQLite singleton (better-sqlite3)
│   │   ├── autoMigrate.ts      # Schema applied on every server boot
│   │   ├── migrate.ts          # Standalone migration CLI
│   │   └── seed.ts             # Development seed data
│   ├── middleware/
│   │   ├── authenticate.ts     # JWT verification + requireRoles()
│   │   ├── validate.ts         # Zod schema middleware factory
│   │   └── errorHandler.ts     # Global error handler
│   ├── routes/
│   │   ├── auth.ts             # Register, login, refresh, logout, /me
│   │   ├── tickets.ts          # Full ticket CRUD + status/assign/audit
│   │   ├── replies.ts          # Replies + internal notes
│   │   └── users.ts            # User management (admin)
│   ├── types/
│   │   └── index.ts            # Shared TypeScript types + Express augmentation
│   ├── utils/
│   │   ├── jwt.ts              # Token sign/verify helpers (jose)
│   │   ├── logger.ts           # Structured JSON logger
│   │   └── response.ts         # Consistent JSON envelope helpers
│   └── index.ts                # App bootstrap, middleware registration
├── .env                        # Local secrets (gitignored)
├── .env.example                # Template — safe to commit
├── API.md                      # Full API reference
├── package.json
└── tsconfig.json
```

---

## Architecture Decisions

| Concern | Choice | Reason |
|---------|--------|--------|
| Runtime | Node.js + TypeScript | Matches existing frontend; strong ecosystem |
| Framework | Express 4 | Minimal, auditable, no magic |
| Database | SQLite via `node:sqlite` (built-in) | Zero infrastructure, ACID, WAL mode, FTS5, no native compilation |
| Auth | JWT (HS256) via jose | Modern, audited library; no legacy vulnerabilities |
| Password hashing | bcryptjs | Industry standard, configurable cost factor |
| Validation | Zod | Runtime + compile-time safety in one step |
| Rate limiting | express-rate-limit | Brute-force & DDoS mitigation |
| Security headers | helmet | HSTS, CSP, X-Frame-Options etc. in one call |

---

## Security Notes

- Passwords are hashed with bcrypt (cost factor configurable, default 12 in prod).
- Refresh tokens are stored as SHA-256 hashes — the raw token is never persisted.
- Refresh token rotation: using a token revokes it and issues a new pair.
- Access tokens expire in 15 minutes; refresh tokens in 7 days.
- Login uses a constant-time comparison to prevent user-enumeration via timing.
- Customers receive 404 (not 403) when accessing another customer's ticket.
- Internal notes are stripped from all customer-facing responses at the query level.
- All SQL uses parameterized statements — no string interpolation of user input.
- Sorting columns are validated by Zod enums before being interpolated into queries.
- Input is size-limited (request body ≤ 1 MB, individual text fields ≤ 20 000 chars).

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Replace both JWT secrets with cryptographically random 64-byte hex strings
- [ ] Set `BCRYPT_ROUNDS=12` (or higher)
- [ ] Move the SQLite database to a persistent volume (not inside the container)
- [ ] Put a reverse proxy (nginx/Caddy) in front and terminate TLS there
- [ ] Set `CORS_ORIGINS` to your actual frontend domain
- [ ] Enable log aggregation (pipe stdout/stderr to Datadog, CloudWatch, etc.)
- [ ] Set up automated database backups (`.backup` SQLite command or file copy during low traffic)

---

## API Reference

See **[API.md](./API.md)** for the full endpoint reference.
