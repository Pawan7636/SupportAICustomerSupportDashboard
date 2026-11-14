import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Bot,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Clock3,
  Copy,
  Edit3,
  FileQuestion,
  Headphones,
  History,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react"

// API calls go through the Vite dev proxy (/api → http://localhost:3001).
// Using a relative base means this works in both dev and production without
// any hardcoded host/port.
const API_BASE = ""

type Screen = "dashboard" | "assistant" | "human" | "faqs" | "history" | "escalations"
type BadgeTone = "green" | "amber" | "red" | "blue" | "purple" | "gray"

const navItems = [
  { id: "dashboard" as Screen, label: "Dashboard", icon: LayoutDashboard },
  { id: "assistant" as Screen, label: "AI Assistant", icon: Sparkles },
  { id: "human" as Screen, label: "Human Escalation", icon: Headphones },
  { id: "faqs" as Screen, label: "FAQ Management", icon: FileQuestion },
  { id: "history" as Screen, label: "Query History", icon: History },
  { id: "escalations" as Screen, label: "Escalations", icon: Users, count: 4 },
]

// KB article shape returned by the backend
type KbCategory = "orders" | "payments" | "refunds" | "account" | "technical" | "general"

interface KbArticle {
  id: string
  title: string
  content: string
  category: KbCategory
  tags: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

// RAG source citation returned alongside Gemini responses
interface RagSource {
  id: string
  title: string
  category: string
  score: number
}

const recentQueries = [
  {
    id: "#Q-1048",
    customer: "Maya Thompson",
    email: "maya@north.co",
    query: "Where is my order #8721?",
    category: "Orders",
    status: "Answered",
    time: "4 min ago",
  },
  {
    id: "#Q-1047",
    customer: "Liam Walker",
    email: "liam@acme.io",
    query: "Charged twice for my plan",
    category: "Payments",
    status: "Escalated",
    time: "18 min ago",
  },
  {
    id: "#Q-1046",
    customer: "Sofia Chen",
    email: "sofia@studio.co",
    query: "How do I update my email?",
    category: "Account",
    status: "Answered",
    time: "32 min ago",
  },
  {
    id: "#Q-1045",
    customer: "Noah Williams",
    email: "noah@orbit.ai",
    query: "Refund still not received",
    category: "Refunds",
    status: "Pending",
    time: "1 hr ago",
  },
  {
    id: "#Q-1044",
    customer: "Emma Davis",
    email: "emma@leaf.com",
    query: "Can I change delivery date?",
    category: "Orders",
    status: "Answered",
    time: "2 hrs ago",
  },
]

const escalationRows = [
  { id: "#E-029", customer: "Liam Walker",    subject: "Duplicate payment charged",          priority: "Urgent", agent: "Olivia M.",  state: "Pending",     time: "12 min"    },
  { id: "#E-028", customer: "Noah Williams",  subject: "Refund not received after 10 days",  priority: "High",   agent: "Unassigned", state: "Pending",     time: "43 min"    },
  { id: "#E-027", customer: "Ava Robinson",   subject: "Account access blocked",             priority: "High",   agent: "Marcus L.",  state: "In Progress", time: "1 hr"      },
  { id: "#E-026", customer: "Ethan Clark",    subject: "Custom invoice request",             priority: "Medium", agent: "Priya S.",   state: "In Progress", time: "3 hrs"     },
  { id: "#E-025", customer: "Isabella Lee",   subject: "Order delivered to wrong address",   priority: "Urgent", agent: "Olivia M.",  state: "Resolved",    time: "Yesterday" },
]

// ─── Primitive components ─────────────────────────────────────────────────────

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark"><MessageSquareText size={22} /></span>
      {!compact && <span className="brand-name">Support<span>AI</span></span>}
    </div>
  )
}

function Button({
  children, variant = "primary", icon, onClick, type = "button", disabled = false, className = "",
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  disabled?: boolean
  className?: string
}) {
  return (
    <button className={`btn btn-${variant} ${className}`} onClick={onClick} type={type} disabled={disabled}>
      {icon}{children}
    </button>
  )
}

function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />{children}
    </span>
  )
}

function Input({
  label, icon, type = "text", placeholder, value, onChange, required,
}: {
  label?: string; icon?: ReactNode; type?: string; placeholder?: string
  value?: string; onChange?: (value: string) => void; required?: boolean
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className={`input-wrap ${icon ? "has-icon" : ""}`}>
        {icon && <span className="input-icon">{icon}</span>}
        <input type={type} placeholder={placeholder} value={value}
          onChange={(e) => onChange?.(e.target.value)} required={required} />
      </span>
    </label>
  )
}

function SelectField({ label, value, onChange, children }: {
  label?: string; value: string; onChange: (value: string) => void; children: ReactNode
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className="select-wrap">
        <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
        <ChevronDown size={16} />
      </span>
    </label>
  )
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  )
}

function Avatar({ name, color = "purple" }: { name: string; color?: string }) {
  return (
    <span className={`avatar avatar-${color}`}>
      {name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
    </span>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function Login({ onLogin }: { onLogin: () => void }) {
  const [remember, setRemember] = useState(true)
  const submit = (e: FormEvent) => { e.preventDefault(); onLogin() }
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-decoration decoration-one" />
        <div className="login-decoration decoration-two" />
        <div className="login-copy">
          <Brand />
          <div className="login-hero">
            <span className="eyebrow"><Sparkles size={15} /> AI-powered customer care</span>
            <h1>Resolve customer questions with confidence.</h1>
            <p>Draft accurate, on-brand responses in seconds and know exactly when to bring in a human.</p>
            <div className="trust-row">
              <span className="avatar-stack">
                <Avatar name="MS" /><Avatar name="DW" color="blue" /><Avatar name="AK" color="green" />
              </span>
              <span>
                <strong>2,400+ support teams</strong>
                <small>resolve faster with SupportAI</small>
              </span>
            </div>
          </div>
          <p className="login-quote">"Our first response time dropped by 64% in the first month."</p>
        </div>
        <div className="login-form-side">
          <form className="login-form" onSubmit={submit}>
            <div className="mobile-brand"><Brand /></div>
            <span className="login-icon"><Zap size={22} /></span>
            <h2>Welcome back</h2>
            <p>Sign in to continue to your workspace</p>
            <div className="form-stack">
              <Input label="Work email" icon={<Mail size={17} />} type="email" placeholder="you@company.com" required />
              <Input label="Password" icon={<ShieldCheck size={17} />} type="password" placeholder="Enter your password" required />
            </div>
            <div className="form-options">
              <label className="checkbox-row">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span><Check size={12} /></span>
                Remember me
              </label>
              <button type="button" className="text-button">Forgot password?</button>
            </div>
            <Button type="submit" className="full-button">Sign in <ArrowRight size={17} /></Button>
            <p className="signup-copy">
              New to SupportAI?{" "}
              <button type="button" className="text-button">Create an account</button>
            </p>
          </form>
          <p className="legal-copy">By continuing, you agree to our Terms and Privacy Policy.</p>
        </div>
      </section>
    </main>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Sidebar({ active, onNavigate, onLogout, open, onClose }: {
  active: Screen; onNavigate: (screen: Screen) => void
  onLogout: () => void; open: boolean; onClose: () => void
}) {
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button className="mobile-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-icon">AC</span>
          <span><strong>Acme Workspace</strong><small>Business plan</small></span>
          <ChevronDown size={15} />
        </div>
        <nav className="nav-list">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ id, label, icon: Icon, count }) => (
            <button key={id} className={`nav-item ${active === id ? "active" : ""}`}
              onClick={() => { onNavigate(id); onClose() }}>
              <Icon size={18} strokeWidth={2} /><span>{label}</span>
              {count && <em>{count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="usage-card">
            <span className="usage-icon"><Zap size={16} /></span>
            <div><strong>Monthly usage</strong><small>742 of 1,000 responses</small></div>
            <div className="progress"><span /></div>
            <button onClick={() => onNavigate("assistant")}>View plan <ArrowRight size={13} /></button>
          </div>
          <button className="user-menu" onClick={onLogout}>
            <Avatar name="Alex Morgan" />
            <span><strong>Alex Morgan</strong><small>alex@acme.com</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  )
}

function Topbar({ active, onMenu }: { active: Screen; onMenu: () => void }) {
  const label = navItems.find((item) => item.id === active)?.label
  return (
    <header className="topbar">
      <button className="menu-button" onClick={onMenu}><Menu size={21} /></button>
      <div className="breadcrumbs">
        <span>SupportAI</span><i>/</i><strong>{label}</strong>
      </div>
      <div className="top-actions">
        <label className="top-search">
          <Search size={16} /><input placeholder="Search anything..." /><kbd>⌘ K</kbd>
        </label>
        <button className="icon-button"><CircleHelp size={19} /></button>
        <button className="icon-button notification"><Bell size={19} /><span /></button>
      </div>
    </header>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const stats = [
    { label: "Total Queries",    value: "1,284", change: "+12.5%", icon: Inbox,       tone: "indigo"  },
    { label: "AI Answered",      value: "1,096", change: "+18.2%", icon: Bot,         tone: "purple"  },
    { label: "Escalated",        value: "188",   change: "-4.3%",  icon: Headphones,  tone: "amber"   },
    { label: "Resolution Rate",  value: "85.4%", change: "+6.8%",  icon: TrendingUp,  tone: "green"   },
  ]
  const chart = [48, 62, 51, 73, 66, 82, 69, 78, 88, 75, 92, 84, 96, 90]
  return (
    <>
      <PageHeader title="Good morning, Alex"
        description="Here's what's happening with your support queries today."
        action={<Button icon={<Sparkles size={17} />} onClick={() => onNavigate("assistant")}>Generate response</Button>}
      />
      <div className="stats-grid">
        {stats.map(({ label, value, change, icon: Icon, tone }) => (
          <Card key={label} className="stat-card">
            <div className={`stat-icon stat-${tone}`}><Icon size={20} /></div>
            <span className="stat-label">{label}</span>
            <div className="stat-value-row">
              <strong>{value}</strong>
              <span className={change.startsWith("-") ? "negative" : ""}>{change}</span>
            </div>
            <small>vs. previous 30 days</small>
          </Card>
        ))}
      </div>
      <div className="dashboard-grid">
        <Card className="chart-card">
          <div className="card-heading">
            <div><h2>Support activity</h2><p>Queries handled over the last 14 days</p></div>
            <SelectField value="14 days" onChange={() => {}}>
              <option>14 days</option><option>30 days</option>
            </SelectField>
          </div>
          <div className="chart-legend">
            <span><i className="legend-ai" />AI answered</span>
            <span><i className="legend-human" />Escalated</span>
          </div>
          <div className="chart-area">
            <div className="y-axis"><span>120</span><span>90</span><span>60</span><span>30</span><span>0</span></div>
            <div className="bars">
              {chart.map((height, i) => (
                <div className="bar-group" key={i}>
                  <span className="bar-ai" style={{ height: `${height}%` }} />
                  <span className="bar-human" style={{ height: `${Math.max(13, height * 0.22)}%` }} />
                </div>
              ))}
            </div>
            <div className="x-axis">
              <span>May 8</span><span>May 11</span><span>May 14</span><span>May 17</span><span>Today</span>
            </div>
          </div>
        </Card>
        <Card className="insights-card">
          <div className="card-heading">
            <div><h2>AI insights</h2><p>Performance highlights</p></div>
            <span className="ai-spark"><Sparkles size={17} /></span>
          </div>
          <div className="insight-highlight">
            <span><TrendingUp size={18} /></span>
            <div><strong>18% faster this week</strong><p>Your average response time is now 42 seconds.</p></div>
          </div>
          <div className="topic-block">
            <p>Top query categories</p>
            {[["Orders","38%",82],["Payments","24%",62],["Account","19%",48],["Refunds","12%",34]].map(([name, value, width]) => (
              <div className="topic-row" key={name as string}>
                <span>{name}</span>
                <div><i style={{ width: `${width}%` }} /></div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <button className="link-button" onClick={() => onNavigate("history")}>
            View detailed analytics <ArrowRight size={15} />
          </button>
        </Card>
      </div>
      <Card className="table-card">
        <div className="card-heading table-heading">
          <div><h2>Recent queries</h2><p>Latest customer conversations across your workspace</p></div>
          <Button variant="secondary" onClick={() => onNavigate("history")}>View all queries <ArrowRight size={15} /></Button>
        </div>
        <QueryTable rows={recentQueries.slice(0, 4)} />
      </Card>
    </>
  )
}

function QueryTable({ rows }: { rows: typeof recentQueries }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>Customer</th><th>Query</th><th>Category</th><th>Status</th><th>Received</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id}>
              <td>
                <div className="customer-cell">
                  <Avatar name={row.customer} color={["purple", "blue", "green"][i % 3]} />
                  <span><strong>{row.customer}</strong><small>{row.id}</small></span>
                </div>
              </td>
              <td className="query-cell">{row.query}</td>
              <td>{row.category}</td>
              <td>
                <Badge tone={row.status === "Answered" ? "green" : row.status === "Escalated" ? "red" : "amber"}>
                  {row.status}
                </Badge>
              </td>
              <td className="muted">{row.time}</td>
              <td><button className="row-action"><MoreHorizontal size={18} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── AI Assistant (Gemini + RAG) ─────────────────────────────────────────────

function Assistant({ onToast }: { onToast: (text: string) => void }) {
  const [query, setQuery] = useState(
    "Hi, I placed an order three days ago but I still haven't received a tracking link. Can you help me find out where my package is?",
  )
  const [category, setCategory] = useState("Orders")
  const [tone, setTone] = useState("Friendly & professional")
  const [response, setResponse] = useState("")
  const [generated, setGenerated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sources, setSources] = useState<RagSource[]>([])
  const [ragEnabled, setRagEnabled] = useState(false)
  const abortRef = useMemo(() => ({ current: null as AbortController | null }), [])

  const generate = async () => {
    if (!query.trim() || loading) return
    setLoading(true)
    setGenerated(false)
    setResponse("")
    setError("")
    setSources([])
    setRagEnabled(false)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, category, tone }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `Server error (HTTP ${res.status})`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let full = ""
      if (!reader) throw new Error("No response body from server")

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue
          try {
            const payload = JSON.parse(line.slice(6)) as {
              chunk?: string
              done?: boolean
              error?: string
              sources?: RagSource[]
              ragEnabled?: boolean
            }
            if (payload.error) throw new Error(payload.error)
            // First event carries RAG sources
            if (payload.sources !== undefined) {
              setSources(payload.sources)
              setRagEnabled(payload.ragEnabled ?? false)
            }
            if (payload.chunk) { full += payload.chunk; setResponse(full) }
            if (payload.done) break outer
          } catch (parseErr) {
            if ((parseErr as Error).message !== "Unexpected end of JSON input") throw parseErr
          }
        }
      }

      setGenerated(true)
      onToast("Response generated by Gemini AI")
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      const msg = (err as Error).message ?? "Failed to generate response"
      setError(msg)
      onToast("Error: " + msg)
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard?.writeText(response)
    onToast("Response copied to clipboard")
  }

  return (
    <>
      <PageHeader
        title="AI Response Assistant"
        description="Turn customer questions into accurate, on-brand responses using Gemini AI."
        action={
          <span className="safe-label">
            <Sparkles size={16} /> Powered by Gemini
          </span>
        }
      />
      <div className="assistant-grid">
        {/* ── Left: Composer ── */}
        <Card className="composer-card">
          <div className="panel-title">
            <span className="step-number">1</span>
            <div>
              <h2>Customer query</h2>
              <p>Paste the message you received from your customer.</p>
            </div>
          </div>
          <label className="field textarea-field">
            <span className="field-label">Message</span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste the customer's question here..."
              maxLength={2000}
            />
            <small>{query.length} / 2,000 characters</small>
          </label>
          <div className="field-row">
            <SelectField label="Category" value={category} onChange={setCategory}>
              {["Orders", "Payments", "Refunds", "Account", "General"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </SelectField>
            <SelectField label="Tone" value={tone} onChange={setTone}>
              <option>Friendly &amp; professional</option>
              <option>Concise</option>
              <option>Empathetic</option>
            </SelectField>
          </div>
          <div className="composer-note">
            <Bot size={16} />
            <span>
              <strong>Gemini AI + RAG</strong>Responses are grounded in your
              knowledge base and generated live by Google Gemini.
            </span>
          </div>
          <Button
            className="full-button generate-button"
            onClick={generate}
            disabled={loading || !query.trim()}
            icon={loading ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
          >
            {loading ? "Generating response…" : "Generate response"}
          </Button>
        </Card>

        {/* ── Right: Response ── */}
        <Card className="response-card">
          <div className="panel-title response-title">
            <span className="step-number"><Bot size={17} /></span>
            <div>
              <h2>AI-generated response</h2>
              <p>Review and edit before sending.</p>
            </div>
            {loading && <Badge tone="blue">Streaming…</Badge>}
            {generated && !loading && <Badge tone="green">Ready</Badge>}
          </div>

          {error ? (
            <div className="response-empty">
              <span style={{ background: "var(--red-soft)", color: "var(--red)" }}>
                <AlertCircle size={27} />
              </span>
              <h3>Something went wrong</h3>
              <p style={{ color: "var(--red)" }}>{error}</p>
              <Button variant="secondary" onClick={generate} icon={<RefreshCw size={15} />} className="mt-3">
                Try again
              </Button>
            </div>
          ) : response ? (
            <>
              <div className="generated-copy" style={{ flex: 1 }}>
                {response.split("\n").map((line, i) => (
                  <p key={i}>{line || <br />}</p>
                ))}
                {loading && <span className="typing-cursor" />}
              </div>

              {/* ── RAG source citations ── */}
              {ragEnabled && sources.length > 0 && (
                <div className="rag-sources">
                  <div className="rag-sources-header">
                    <BookOpen size={14} />
                    <span>Sources from knowledge base</span>
                  </div>
                  <div className="rag-source-list">
                    {sources.map((src, i) => (
                      <span key={src.id} className="rag-source-chip">
                        <span className="rag-source-num">{i + 1}</span>
                        {src.title}
                        <span className="rag-source-score">{Math.round(src.score * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!loading && (
                <div className="response-footer">
                  <div>
                    <Button variant="secondary" icon={<Copy size={16} />} onClick={copy}>
                      Copy response
                    </Button>
                    <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={generate}>
                      Regenerate
                    </Button>
                  </div>
                  <span>
                    <CheckCircle2 size={15} />
                    {ragEnabled ? "RAG · Gemini AI" : "Gemini AI"}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="response-empty">
              <span><Bot size={27} /></span>
              <h3>{loading ? "Crafting your response…" : "Ready when you are"}</h3>
              <p>
                {loading
                  ? "Gemini is searching the knowledge base and writing a tailored response."
                  : "Select a category and tone, then click Generate response."}
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ─── Human Escalation ─────────────────────────────────────────────────────────

function HumanEscalation({ onEscalate }: { onEscalate: () => void }) {
  const [reason, setReason] = useState("No matching FAQ or verified source")
  const [note, setNote] = useState("")
  return (
    <>
      <PageHeader
        title="Human Escalation"
        description="Route questions to your team when the knowledge base can't provide a reliable answer."
      />
      <div className="escalation-layout">
        <Card className="warning-card">
          <span className="warning-symbol"><AlertCircle size={24} /></span>
          <div>
            <Badge tone="amber">Human review required</Badge>
            <h2>We couldn't find reliable information</h2>
            <p>
              There isn't enough verified FAQ content to answer this customer's question
              accurately. To prevent a fabricated response, SupportAI has paused generation.
            </p>
          </div>
        </Card>
        <div className="escalation-columns">
          <Card className="query-preview">
            <div className="panel-title">
              <span className="step-number"><MessageSquareText size={17} /></span>
              <div><h2>Customer question</h2><p>Received today at 10:42 AM</p></div>
            </div>
            <div className="customer-summary">
              <Avatar name="Jordan Bell" color="blue" />
              <span><strong>Jordan Bell</strong><small>jordan@paperlane.co</small></span>
              <Badge tone="gray">General</Badge>
            </div>
            <blockquote>
              "Can you transfer my annual subscription to a different company entity and keep the same billing anniversary?"
            </blockquote>
            <div className="detection-list">
              <span><CheckCircle2 size={16} />Intent identified: Subscription transfer</span>
              <span><AlertCircle size={16} />No matching policy found</span>
              <span><ShieldCheck size={16} />Answer generation blocked</span>
            </div>
          </Card>
          <Card className="route-card">
            <div className="panel-title">
              <span className="step-number">2</span>
              <div><h2>Route to your team</h2><p>Add context to help an agent resolve it faster.</p></div>
            </div>
            <SelectField label="Escalation reason" value={reason} onChange={setReason}>
              <option>No matching FAQ or verified source</option>
              <option>Account-specific action required</option>
              <option>Sensitive or high-risk request</option>
              <option>Customer requested a human</option>
            </SelectField>
            <SelectField label="Assign to" value="Billing support · 4 agents" onChange={() => {}}>
              <option>Billing support · 4 agents</option>
              <option>General support · 8 agents</option>
              <option>Account specialists · 3 agents</option>
            </SelectField>
            <label className="field textarea-field compact">
              <span className="field-label">Internal note <em>Optional</em></span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Add helpful context for the agent..." />
            </label>
            <div className="priority-choice">
              <span className="field-label">Priority</span>
              <div>
                <button>Low</button>
                <button className="selected">Normal</button>
                <button>High</button>
                <button>Urgent</button>
              </div>
            </div>
            <Button className="full-button" icon={<Send size={17} />} onClick={onEscalate}>
              Escalate to human
            </Button>
            <p className="route-footnote">
              <Clock3 size={14} /> Average team response time: 18 minutes
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}

// ─── FAQ Management (Knowledge Base) ─────────────────────────────────────────

// Map KB category strings (lowercase) to display labels
const CATEGORY_LABELS: Record<string, string> = {
  orders: "Orders", payments: "Payments", refunds: "Refunds",
  account: "Account", technical: "Technical", general: "General",
}

function FaqManagement({ onToast }: { onToast: (text: string) => void }) {
  const [articles, setArticles] = useState<KbArticle[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [modal, setModal] = useState<null | {
    id?: string
    title: string
    content: string
    category: KbCategory
    tags: string[]
    tagsInput: string
  }>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Fetch articles from the backend ────────────────────────────────────────
  const fetchArticles = async (cat?: string) => {
    setLoadingList(true)
    setListError("")
    try {
      const url = cat && cat !== "all"
        ? `${API_BASE}/api/kb?category=${cat}`
        : `${API_BASE}/api/kb`
      const res = await fetch(url)
      const json = await res.json() as { success: boolean; data: KbArticle[]; error?: string }
      if (!json.success) throw new Error(json.error ?? "Failed to load articles")
      setArticles(json.data)
    } catch (err) {
      setListError((err as Error).message ?? "Failed to load knowledge base")
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => { fetchArticles(category) }, [category])

  // ── Client-side text filter ─────────────────────────────────────────────────
  const filtered = articles.filter(
    (a) => a.title.toLowerCase().includes(query.toLowerCase()) ||
           a.content.toLowerCase().includes(query.toLowerCase()),
  )

  // ── Save (create or update) ─────────────────────────────────────────────────
  const save = async () => {
    if (!modal?.title.trim() || !modal.content.trim()) return
    setSaving(true)
    try {
      const isEdit = Boolean(modal.id)
      const url    = isEdit ? `${API_BASE}/api/kb/${modal.id}` : `${API_BASE}/api/kb`
      const method = isEdit ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:    modal.title,
          content:  modal.content,
          category: modal.category,
          tags:     modal.tags,
        }),
      })
      const json = await res.json() as { success: boolean; data: KbArticle; error?: string }
      if (!json.success) throw new Error(json.error ?? "Save failed")

      if (isEdit) {
        setArticles(articles.map((a) => a.id === modal.id ? json.data : a))
      } else {
        setArticles([json.data, ...articles])
      }
      setModal(null)
      onToast(isEdit ? "Article updated — embedding refreshing in background" : "Article added to knowledge base")
    } catch (err) {
      onToast("Error: " + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const remove = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`${API_BASE}/api/kb/${id}`, { method: "DELETE" })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) throw new Error(json.error ?? "Delete failed")
      setArticles(articles.filter((a) => a.id !== id))
      onToast("Article removed from knowledge base")
    } catch (err) {
      onToast("Error: " + (err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const openAdd = () => setModal({
    title: "", content: "", category: "general", tags: [], tagsInput: "",
  })

  const openEdit = (a: KbArticle) => setModal({
    id: a.id, title: a.title, content: a.content,
    category: a.category, tags: a.tags, tagsInput: a.tags.join(", "),
  })

  const syncTags = (raw: string) => {
    if (!modal) return
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean)
    setModal({ ...modal, tagsInput: raw, tags })
  }

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        description="Manage the verified articles SupportAI uses to ground its AI responses (RAG)."
        action={
          <Button icon={<Plus size={17} />} onClick={openAdd}>
            Add article
          </Button>
        }
      />
      <Card className="faq-card">
        <div className="faq-toolbar">
          <Input icon={<Search size={17} />} placeholder="Search articles..." value={query} onChange={setQuery} />
          <div className="filter-tabs">
            {["all", "orders", "payments", "refunds", "account", "technical", "general"].map((item) => (
              <button
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item)}
                key={item}
              >
                {item === "all" ? "All" : CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
        </div>

        {loadingList ? (
          <div className="empty-list">
            <Loader2 size={26} className="spin" />
            <h3>Loading knowledge base…</h3>
          </div>
        ) : listError ? (
          <div className="empty-list">
            <AlertCircle size={26} style={{ color: "var(--red)" }} />
            <h3>Failed to load</h3>
            <p style={{ color: "var(--red)" }}>{listError}</p>
            <Button variant="secondary" onClick={() => fetchArticles(category)} icon={<RefreshCw size={15} />} className="mt-3">
              Retry
            </Button>
          </div>
        ) : (
          <div className="faq-list">
            {filtered.map((article) => (
              <div className="faq-row" key={article.id}>
                <span className={`faq-category faq-${article.category}`}><FileQuestion size={18} /></span>
                <div className="faq-content">
                  <div>
                    <h3>{article.title}</h3>
                    <Badge tone="purple">{CATEGORY_LABELS[article.category] ?? article.category}</Badge>
                  </div>
                  <p>{article.content.slice(0, 160)}{article.content.length > 160 ? "…" : ""}</p>
                  {article.tags.length > 0 && (
                    <div className="kb-tags">
                      <Tag size={12} />
                      {article.tags.map((t) => <span key={t}>{t}</span>)}
                    </div>
                  )}
                  <small>Updated {new Date(article.updated_at).toLocaleDateString()}</small>
                </div>
                <div className="faq-actions">
                  <button onClick={() => openEdit(article)}><Edit3 size={17} /></button>
                  <button
                    className="delete"
                    disabled={deletingId === article.id}
                    onClick={() => remove(article.id)}
                  >
                    {deletingId === article.id
                      ? <Loader2 size={17} className="spin" />
                      : <Trash2 size={17} />}
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="empty-list">
                <Search size={26} /><h3>No articles found</h3>
                <p>Try a different search or category.</p>
              </div>
            )}
          </div>
        )}

        <div className="list-footer">
          <span>Showing {filtered.length} of {articles.length} articles</span>
          <span><CheckCircle2 size={15} /> Knowledge base synced with Gemini RAG</span>
        </div>
      </Card>

      {modal && (
        <Modal
          title={modal.id ? "Edit article" : "Add knowledge base article"}
          description="SupportAI will use this verified content to ground AI-generated responses."
          onClose={() => setModal(null)}
        >
          <SelectField
            label="Category"
            value={modal.category}
            onChange={(value) => setModal({ ...modal, category: value as KbCategory })}
          >
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </SelectField>
          <Input
            label="Title"
            value={modal.title}
            onChange={(value) => setModal({ ...modal, title: value })}
            placeholder="e.g. How to track your order"
          />
          <label className="field textarea-field compact">
            <span className="field-label">Content</span>
            <textarea
              value={modal.content}
              onChange={(e) => setModal({ ...modal, content: e.target.value })}
              placeholder="Write the full answer here — be specific and accurate..."
              rows={6}
            />
          </label>
          <Input
            label="Tags (comma-separated)"
            value={modal.tagsInput}
            onChange={syncTags}
            placeholder="e.g. tracking, shipment, delivery"
            icon={<Tag size={15} />}
          />
          {modal.tags.length > 0 && (
            <div className="kb-tags" style={{ marginTop: "0.25rem" }}>
              {modal.tags.map((t) => <span key={t}>{t}</span>)}
            </div>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={saving || !modal.title.trim() || !modal.content.trim()}
              icon={saving ? <Loader2 size={15} className="spin" /> : undefined}
            >
              {saving ? "Saving…" : modal.id ? "Save changes" : "Add article"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Modal({ title, description, onClose, children }: {
  title: string; description: string; onClose: () => void; children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{title}</h2><p>{description}</p></div>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ─── Query History ────────────────────────────────────────────────────────────

function QueryHistory() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("All statuses")
  const rows = useMemo(
    () => recentQueries.filter(
      (row) =>
        (row.customer + row.query).toLowerCase().includes(search.toLowerCase()) &&
        (status === "All statuses" || row.status === status),
    ),
    [search, status],
  )
  return (
    <>
      <PageHeader
        title="Query History"
        description="Review every customer question and response generated by your team."
        action={<Button variant="secondary" icon={<Clipboard size={16} />}>Export CSV</Button>}
      />
      <div className="history-summary">
        <span><strong>1,284</strong>Total queries</span>
        <i />
        <span><strong>42 sec</strong>Avg. response time</span>
        <i />
        <span><strong>85.4%</strong>Resolved by AI</span>
      </div>
      <Card className="table-card history-card">
        <div className="history-toolbar">
          <Input icon={<Search size={17} />} placeholder="Search customer or query..." value={search} onChange={setSearch} />
          <div className="history-filters">
            <SelectField value={status} onChange={setStatus}>
              <option>All statuses</option><option>Answered</option><option>Escalated</option><option>Pending</option>
            </SelectField>
            <SelectField value="Last 30 days" onChange={() => {}}>
              <option>Last 30 days</option><option>Last 7 days</option><option>Today</option>
            </SelectField>
          </div>
        </div>
        <QueryTable rows={rows} />
        <div className="pagination">
          <span>Showing 1–{rows.length} of 1,284</span>
          <div>
            <Button variant="secondary" disabled>Previous</Button>
            <button className="page-active">1</button>
            <button>2</button><button>3</button><span>…</span><button>64</button>
            <Button variant="secondary">Next</Button>
          </div>
        </div>
      </Card>
    </>
  )
}

// ─── Escalations ──────────────────────────────────────────────────────────────

function Escalations() {
  const [tab, setTab] = useState("Pending")
  const visible = escalationRows.filter((row) => row.state === tab)
  return (
    <>
      <PageHeader
        title="Escalations"
        description="Track and resolve queries that need a human touch."
        action={<div className="live-status"><span /> Live queue</div>}
      />
      <div className="queue-tabs">
        {[["Pending", "2"], ["In Progress", "2"], ["Resolved", "124"]].map(([name, count]) => (
          <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
            <span>{name}</span><em>{count}</em>
          </button>
        ))}
      </div>
      <Card className="table-card escalation-table">
        <div className="card-heading table-heading">
          <div>
            <h2>{tab} queries</h2>
            <p>
              {tab === "Pending" ? "Waiting to be picked up by an agent"
                : tab === "In Progress" ? "Currently being handled by your team"
                : "Recently completed escalations"}
            </p>
          </div>
          <div className="mini-search"><Search size={16} /><input placeholder="Search queue..." /></div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Query</th><th>Customer</th><th>Priority</th><th>Assigned agent</th><th>Waiting</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><div className="subject-cell"><strong>{row.subject}</strong><small>{row.id}</small></div></td>
                  <td>{row.customer}</td>
                  <td>
                    <Badge tone={row.priority === "Urgent" ? "red" : row.priority === "High" ? "amber" : "blue"}>
                      {row.priority}
                    </Badge>
                  </td>
                  <td>
                    <div className="agent-cell">
                      <Avatar name={row.agent} color="green" /><span>{row.agent}</span>
                    </div>
                  </td>
                  <td className="muted">{row.time}</td>
                  <td><Button variant="secondary">{tab === "Pending" ? "Assign" : "Open"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="empty-list">
            <CheckCircle2 size={27} /><h3>Queue is clear</h3><p>There are no {tab.toLowerCase()} escalations.</p>
          </div>
        )}
      </Card>
      <div className="queue-insight">
        <span><Clock3 size={19} /></span>
        <div><strong>Healthy response time</strong><p>Your team is responding 6 minutes faster than last week.</p></div>
        <Button variant="ghost">View team performance <ArrowRight size={15} /></Button>
      </div>
    </>
  )
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [screen, setScreen] = useState<Screen>("dashboard")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState("")

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(""), 2800)
  }

  const escalate = () => {
    showToast("Query escalated to Billing support")
    window.setTimeout(() => setScreen("escalations"), 650)
  }

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />

  return (
    <div className="app-shell">
      <Sidebar
        active={screen}
        onNavigate={setScreen}
        onLogout={() => setLoggedIn(false)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <Topbar active={screen} onMenu={() => setSidebarOpen(true)} />
        <main className="page-content">
          {screen === "dashboard"   && <Dashboard onNavigate={setScreen} />}
          {screen === "assistant"   && <Assistant onToast={showToast} />}
          {screen === "human"       && <HumanEscalation onEscalate={escalate} />}
          {screen === "faqs"        && <FaqManagement onToast={showToast} />}
          {screen === "history"     && <QueryHistory />}
          {screen === "escalations" && <Escalations />}
        </main>
      </div>
      {toast && (
        <div className="toast">
          <CheckCircle2 size={18} />{toast}
        </div>
      )}
    </div>
  )
}
