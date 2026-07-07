# Stadium Copilot
### A unified GenAI assistant for FIFA World Cup 2026 stadium operations

Stadium Copilot is **one system, four personas**. Instead of building four separate
tools, this project builds a single assistant that adapts its priorities, tone,
and data access to whoever is using it — a **Fan**, a **Volunteer**, **Venue Staff**,
or a **Tournament Organizer** — while all four draw from the same live operational
truth: gate crowd levels, transport options, active incidents, and volunteer
availability.

---

## 1. Chosen vertical

**All four personas from the challenge, unified into one system**, rather than a
single vertical. The reasoning:

- On a real matchday, a fan's question ("which gate is quickest?"), a volunteer's
  question ("which zone needs me?"), and a staff member's question ("what needs
  triage right now?") are really the **same underlying data, viewed through a
  different lens**. Building one grounded system and layering role-aware behavior
  on top is more realistic than four disconnected demos.
- It also demonstrates **logical decision-making based on user context** more
  clearly: the same `/api/chat` endpoint, given the same live data, produces
  different framing, depth, and recommendations depending on the caller's role —
  which is exactly the kind of contextual reasoning the challenge asks for.

## 2. Approach and logic

The core design decision: **the LLM never invents facts**. A deterministic
**decision engine** (`server/decisionEngine.js`) computes real recommendations
from the live data — best gate, transport ETA, incident triage order, nearest
available volunteer, crowd alerts — using plain, testable business rules (e.g.
"a gate is busy if flow/capacity ≥ 85% or the queue is ≥ 12 minutes"). This
snapshot is then handed to the LLM as `LIVE_CONTEXT`, and the LLM's job is only
to **explain it naturally, in the right tone, in the right language** — never to
guess numbers.

This matters for a stadium-scale tool: it means

- Simple dashboard widgets never need to call the LLM at all (fast, cheap, and
  works even if the AI provider is briefly unavailable — the deterministic
  engine still computes a correct recommendation).
- The conversational assistant is grounded and auditable — every claim it makes
  can be traced back to a JSON snapshot, not a hallucination.
- The system prompt per role (`server/rolePrompts.js`) encodes *what each
  persona should hear and how*, while the facts themselves come from one shared
  source of truth.

### Role-aware logic, concretely

| Role | What the engine surfaces | What the AI emphasizes |
|---|---|---|
| **Fan** | Best entry gate (with accessibility filter), fastest transport option, nearby congestion | Plain language, warm tone, no jargon |
| **Volunteer** | Zones needing support, open tasks, active incidents in their area | Short, instructional, escalation guidance |
| **Staff** | Full gate status, triaged incident queue (severity + recency), escalation flags | Precise, professional, action-first |
| **Organizer** | Cross-venue KPIs (gates over threshold, high-severity incidents, open volunteer tasks) | Concise, analytical, decision-oriented |

### Multilingual assistance

The chat request includes a `language` field driven by a dropdown in the UI.
The system prompt instructs the model to reply in that language regardless of
the (English) source data — demonstrating multilingual assistance without
needing to maintain translated data files.

### Real-time decision support (simulated)

There's no live stadium sensor feed available for a hackathon build, so
`server/index.js` simulates live movement by jittering gate flow/queue numbers
on every request. This is intentionally isolated in one function (`liveData()`)
so swapping in a real feed (turnstile API, transit API, an incident-management
system) later means changing one function, not the rest of the app.

## 3. How the solution works

```
Browser (public/)
  ├─ index.html      role tabs, live gate-ring map, role dashboard, chat
  ├─ app.js          fetches /api/context/:role, renders widgets, drives chat
  └─ styles.css       stadium-ops visual identity (see design notes below)
        │
        ▼  fetch()
Server (server/)
  ├─ index.js          Express routes (dashboard data + chat)
  ├─ decisionEngine.js  pure, tested functions: gate/transport/incident/volunteer logic
  ├─ rolePrompts.js      one system prompt per persona
  ├─ llmClient.js         thin wrapper around the Anthropic Messages API
  └─ data/*.json           simulated live stadium data (gates, transport, incidents, volunteers)
```

**Dashboard flow:** `GET /api/context/:role` → decision engine builds a
role-specific snapshot from the live (simulated) data → frontend renders it as
widgets and a live gate map. No LLM call, so it's instant.

**Chat flow:** `POST /api/chat { role, message, language }` → server builds the
same kind of snapshot → sends it + the role's system prompt + the user's
message to Claude → returns a grounded, role-appropriate, multilingual answer.

**Failure handling:** if the LLM call fails (missing/invalid API key, network
issue, provider outage), the chat endpoint returns a clear, friendly error
instead of crashing or hanging — the dashboard widgets keep working regardless,
since they never depended on the LLM in the first place.

## 4. Running it locally

```bash
npm install
cp .env.example .env      # then add your ANTHROPIC_API_KEY
npm start                 # serves the app at http://localhost:3000
```

Run the automated tests for the decision engine:

```bash
npm test
```

The dashboard and widgets work immediately with no API key. The chat panel
requires a valid `ANTHROPIC_API_KEY` in `.env` to get real replies (without one,
it returns a graceful error message rather than failing silently).

## 5. Design notes

The visual identity is built around the venue itself rather than a generic
chat-app look: a dark "under the floodlights" palette, a scoreboard-style
display face for headings, and a **live gate-ring map** — an SVG pitch outline
with gates plotted around it, color-coded green/amber/red by real crowd
status — as the signature element. Status colors are functional (they mirror
how a real operations control room communicates state), not decorative.

## 6. Security & responsible-implementation notes

- The Anthropic API key is read from `.env` (git-ignored) and used **only
  server-side** — it is never sent to the browser.
- User chat input is validated (non-empty, length-capped) before being sent to
  the model.
- The assistant is explicitly instructed not to give medical, legal, or
  safety-critical instructions — it directs people to on-site staff, medical
  points, or emergency services instead.
- All "live" data in this repo is synthetic/simulated — no real personal or
  attendee data is used or stored anywhere.

## 7. Assumptions made

- No real stadium sensor/ticketing/transit feed was available, so live data is
  simulated in `server/index.js` (`liveData()`) with small randomized jitter on
  top of static fixtures in `server/data/`. This is isolated behind one
  function specifically so it can be swapped for a real feed later.
- One venue is modeled (5 gates, a handful of incidents/volunteers) rather than
  all 2026 host stadiums, to keep the demo focused and the repo small.
- Role selection is manual (tabs) rather than tied to real authentication,
  since login/identity systems are out of scope for this challenge.
- The LLM provider assumed is Anthropic Claude (`claude-sonnet-4-6` by
  default), configurable via `ANTHROPIC_MODEL` in `.env`.

## 8. Project structure

```
smart-stadium-copilot/
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── server/
    ├── index.js
    ├── decisionEngine.js
    ├── rolePrompts.js
    ├── llmClient.js
    ├── data/
    │   ├── gates.json
    │   ├── transport.json
    │   ├── incidents.json
    │   └── volunteers.json
    └── tests/
        └── decisionEngine.test.js
```
