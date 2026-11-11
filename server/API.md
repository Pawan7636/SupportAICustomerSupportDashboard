# SupportAI Backend — API Reference

Base URL: `http://localhost:3001`

All endpoints except `/health`, `POST /api/auth/register`, and `POST /api/auth/login`
require a valid JWT access token.

---

## Authentication

Add the access token to every protected request:

```
Authorization: Bearer <access_token>
```

Access tokens expire in **15 minutes**. Use `POST /api/auth/refresh` to rotate them.

---

## Response Envelope

Every response uses a consistent JSON envelope.

**Success**
```json
{ "success": true, "data": <payload>, "meta": <pagination — list endpoints only> }
```

**Error**
```json
{ "success": false, "error": "<human-readable message>", "details": [...] }
```

Validation errors include a `details` array with `{ field, message }` objects.

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200  | OK |
| 201  | Created |
| 204  | No Content (successful delete) |
| 400  | Bad Request / Validation Error |
| 401  | Unauthenticated |
| 403  | Forbidden (authenticated but insufficient role) |
| 404  | Not Found |
| 409  | Conflict (e.g. duplicate email) |
| 429  | Too Many Requests |
| 500  | Internal Server Error |

---

## Roles & Permissions

| Role       | What they can do |
|------------|-----------------|
| `customer` | Register, login, create tickets, view **own** tickets, add public replies |
| `agent`    | View/manage all tickets, add internal notes, change status/assignment/priority |
| `admin`    | Everything agents can do, plus manage user accounts, delete tickets/replies |

Customers attempting to read another customer's ticket receive **404** (not 403) to avoid
leaking ticket existence.

---

## Rate Limits

| Scope | Window | Max Requests |
|-------|--------|-------------|
| All endpoints | 15 min | 200 |
| `/api/auth/*` | 15 min | 20 |

---

## Pagination

List endpoints accept:

| Param    | Type | Default | Max | Description |
|----------|------|---------|-----|-------------|
| page     | int  | 1       | —   | Page number (1-indexed) |
| pageSize | int  | 20      | 100 | Items per page |
| sort     | enum | varies  | —   | Column to sort by |
| order    | enum | desc    | —   | `asc` or `desc` |

Paginated responses include a `meta` object:
```json
{ "page": 1, "pageSize": 20, "total": 47, "totalPages": 3 }
```

---

## Data Models

### User
```json
{
  "id":         "uuid",
  "email":      "user@example.com",
  "full_name":  "Jane Doe",
  "role":       "customer | agent | admin",
  "is_active":  true,
  "created_at": "2026-11-09T10:00:00.000Z",
  "updated_at": "2026-11-09T10:00:00.000Z"
}
```

### Ticket
```json
{
  "id":                "uuid",
  "subject":           "Order not received",
  "description":       "I placed order #1234 ...",
  "status":            "open | pending | in_progress | resolved | closed",
  "priority":          "low | medium | high | urgent",
  "category":          "orders | payments | refunds | account | technical | general",
  "customer_id":       "uuid",
  "customer_name":     "Jane Doe",
  "customer_email":    "jane@example.com",
  "assigned_agent_id": "uuid | null",
  "agent_name":        "Olivia Martin | null",
  "created_at":        "...",
  "updated_at":        "...",
  "closed_at":         "... | null"
}
```

### Reply / Internal Note
```json
{
  "id":               "uuid",
  "ticket_id":        "uuid",
  "author_id":        "uuid",
  "author_name":      "Olivia Martin",
  "author_email":     "agent@supportai.dev",
  "author_role":      "agent",
  "body":             "We are looking into this now.",
  "is_internal_note": false,
  "created_at":       "...",
  "updated_at":       "..."
}
```
`is_internal_note: true` replies are **never returned to customers**.

### Audit Entry
```json
{
  "id":          "uuid",
  "ticket_id":   "uuid",
  "actor_id":    "uuid",
  "actor_name":  "Olivia Martin",
  "actor_email": "agent@supportai.dev",
  "action":      "status_changed",
  "old_value":   "open",
  "new_value":   "in_progress",
  "created_at":  "..."
}
```

Audit actions: `created`, `status_changed`, `priority_changed`, `assigned`, `unassigned`,
`reply_added`, `note_added`, `closed`.

---

## Endpoints

### Health

#### `GET /health`
No auth. Returns server status.

```json
{ "success": true, "data": { "status": "ok", "ts": "2026-11-09T10:00:00.000Z" } }
```

---

### Auth

#### `POST /api/auth/register`
Self-registration — always creates a `customer` account.

**Body**
```json
{
  "email":     "jane@example.com",
  "password":  "Str0ng!Pass",
  "full_name": "Jane Doe"
}
```

Password requirements: ≥ 8 characters, at least one uppercase, lowercase, digit, and
special character.

**201 Created**
```json
{
  "success": true,
  "data": {
    "user":          { ...User },
    "access_token":  "eyJ...",
    "refresh_token": "eyJ..."
  }
}
```

---

#### `POST /api/auth/login`

**Body**
```json
{ "email": "jane@example.com", "password": "Str0ng!Pass" }
```

**200 OK** — same shape as `/register`.

Inactive accounts receive `401`.

---

#### `POST /api/auth/refresh`

**Body**
```json
{ "refresh_token": "eyJ..." }
```

**200 OK**
```json
{ "success": true, "data": { "access_token": "...", "refresh_token": "..." } }
```

The supplied refresh token is **revoked** and a new pair is issued (rotation). Replaying
an old token returns `401`.

---

#### `POST /api/auth/logout`

**Body**
```json
{ "refresh_token": "eyJ..." }
```

Revokes the refresh token. **200 OK**.

---

#### `GET /api/auth/me` 🔒 Any role

Returns the authenticated user's profile (no `password_hash`).

---

### Users

#### `GET /api/users` 🔒 Admin

List all users.

**Query params**: `role`, `page`, `pageSize`, `sort` (`created_at|full_name|email`), `order`.

---

#### `POST /api/users` 🔒 Admin

Create an `agent` or `admin` account (staff provisioning).

**Body**
```json
{
  "email":     "agent@supportai.dev",
  "password":  "Str0ng!Pass",
  "full_name": "Bob Agent",
  "role":      "agent"
}
```

**201 Created** — returns the new user (no password hash).

---

#### `GET /api/users/:id` 🔒 Any role

- Admin/agent: view any user.
- Customer: view own profile only. Returns `403` for another user's id.

---

#### `PATCH /api/users/:id` 🔒 Any role

Update user fields.

**Body** (all optional)
```json
{
  "full_name": "New Name",
  "password":  "NewPass1!",
  "is_active": false,
  "role":      "admin"
}
```

| Field       | Customer (own) | Agent (own) | Admin (any) |
|-------------|:--------------:|:-----------:|:-----------:|
| `full_name` | ✓ | ✓ | ✓ |
| `password`  | ✓ | ✓ | ✓ |
| `is_active` | ✗ | ✗ | ✓ |
| `role`      | ✗ | ✗ | ✓ |

---

#### `DELETE /api/users/:id` 🔒 Admin

Soft-deactivates the account (`is_active = false`). The account cannot log in afterward.
**204 No Content**.

---

### Tickets

#### `GET /api/tickets` 🔒 Any role

- **Customer**: returns only their own tickets.
- **Agent/Admin**: returns all tickets, with optional filters.

**Query params**

| Param              | Values | Description |
|--------------------|--------|-------------|
| `status`           | `open\|pending\|in_progress\|resolved\|closed` | Filter |
| `priority`         | `low\|medium\|high\|urgent` | Filter |
| `category`         | `orders\|payments\|refunds\|account\|technical\|general` | Filter |
| `customer_id`      | uuid | Filter by customer (agent/admin only) |
| `assigned_agent_id`| uuid | Filter by assigned agent (agent/admin only) |
| `q`                | string | Full-text search on subject and description |
| `page`             | int | Default 1 |
| `pageSize`         | int | Default 20, max 100 |
| `sort`             | `created_at\|updated_at\|priority\|status` | Default `created_at` |
| `order`            | `asc\|desc` | Default `desc` |

---

#### `POST /api/tickets` 🔒 Any role

Create a ticket. The authenticated user's id becomes the `customer_id`.

**Body**
```json
{
  "subject":     "Cannot track my order",
  "description": "I placed order #8721 three days ago and there is no tracking link.",
  "priority":    "high",
  "category":    "orders"
}
```

**201 Created** — returns the ticket.

---

#### `GET /api/tickets/:id` 🔒 Any role

Fetch a single ticket with joined `customer_name`, `customer_email`, `agent_name`, `agent_email`.

Customers requesting another customer's ticket receive **404** (not 403).

---

#### `PATCH /api/tickets/:id` 🔒 Any role

Update `subject`, `description`, `priority`, and/or `category`.

- Customers can only edit their own tickets, and **cannot change priority**.

---

#### `PATCH /api/tickets/:id/status` 🔒 Agent/Admin

Change the ticket's status. Records an audit entry.

**Body**
```json
{ "status": "in_progress" }
```

Setting `closed` also populates `closed_at`. If a customer later replies on a `resolved`
ticket, it automatically re-opens to `open`.

---

#### `PATCH /api/tickets/:id/assign` 🔒 Agent/Admin

Assign or unassign an agent. The `agent_id` must belong to a user with role `agent` or
`admin`. Pass `null` to unassign.

**Body**
```json
{ "agent_id": "uuid-of-agent" }
```
or
```json
{ "agent_id": null }
```

---

#### `DELETE /api/tickets/:id` 🔒 Admin

Permanently deletes the ticket and all its replies (cascade). **204 No Content**.

---

#### `GET /api/tickets/:id/audit` 🔒 Agent/Admin

Returns the full ordered audit history for a ticket.

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "ticket_id": "...",
      "actor_id": "...",
      "actor_name": "Olivia Martin",
      "actor_email": "agent1@supportai.dev",
      "action": "status_changed",
      "old_value": "open",
      "new_value": "in_progress",
      "created_at": "2026-11-09T10:00:00.000Z"
    }
  ]
}
```

---

### Replies & Internal Notes

Replies and internal notes share the same endpoints. An `is_internal_note: true` reply
is visible only to agents and admins — never returned to customers.

#### `GET /api/tickets/:ticketId/replies` 🔒 Any role

Returns all replies on a ticket.
- Customers see only `is_internal_note: false` replies.
- Agents/admins see all replies including internal notes.

---

#### `POST /api/tickets/:ticketId/replies` 🔒 Any role

Add a reply or internal note.

**Body**
```json
{
  "body":             "We are looking into this now.",
  "is_internal_note": false
}
```

- Customers: `is_internal_note` must be `false` (or omitted). Returns `403` otherwise.
- Customers cannot reply to `closed` tickets.
- If a customer replies to a `resolved` ticket, it automatically re-opens to `open`.

**201 Created** — returns the reply with author details.

---

#### `PATCH /api/tickets/:ticketId/replies/:id` 🔒 Any role

Edit a reply body. Only the original author or an admin may edit.
Customers cannot see or edit internal notes (returns `404`).

**Body**
```json
{ "body": "Updated reply text." }
```

---

#### `DELETE /api/tickets/:ticketId/replies/:id` 🔒 Admin

Permanently delete a reply. **204 No Content**.

---

## Error Examples

**Validation error (400)**
```json
{
  "success": false,
  "error": "Validation error",
  "details": [
    { "field": "email", "message": "Invalid email" },
    { "field": "password", "message": "Must contain an uppercase letter" }
  ]
}
```

**Unauthorized (401)**
```json
{ "success": false, "error": "Invalid or expired token" }
```

**Forbidden (403)**
```json
{ "success": false, "error": "Forbidden" }
```

**Not Found (404)**
```json
{ "success": false, "error": "Not found" }
```

**Rate limited (429)**
```json
{ "success": false, "error": "Too many authentication attempts" }
```
