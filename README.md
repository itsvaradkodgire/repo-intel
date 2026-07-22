# Repository Intelligence Platform

Analyze **any** public or private Git repository and turn it into an interactive,
AI-powered architecture explorer. Paste a URL (or local path), and the platform
clones it, runs universal static analysis across 15+ languages, builds a unified
knowledge graph, and serves a searchable, clickable web app. AI is **optional**:
bring any provider for grounded explanations and repository Q&A.

> "Google Maps for any code repository" &mdash; every component discoverable,
> interconnected, searchable, and explainable.

## Quick start

```bash
npm install
npm start           # -> http://localhost:4477
```

Open the URL, paste a repo (e.g. `https://github.com/pallets/flask` or a local
path), and click **Analyze**. No AI key required.

CLI (headless, writes a JSON index):

```bash
npm run analyze -- https://github.com/gin-gonic/gin --out ./output
npm run analyze -- /path/to/local/repo --ref v1.2.0
```

## What it does

### Universal static analysis (grammar-based, not regex)
Uses **tree-sitter** WASM grammars to parse every code file into a real AST, then
extracts with per-language queries:
- functions / methods (with signatures, line spans, cyclomatic complexity, calls)
- classes / structs / interfaces / enums / traits
- imports / requires / uses (resolved to in-repo files where possible)
- a symbol-resolved **call graph** (calls + called-by)

Supported code languages: **TypeScript, JavaScript, Python, Java, Kotlin, Go,
Rust, C#, PHP, Ruby, C, C++, Swift, Dart, Scala** (plus Lua, Elixir, Solidity,
Shell, and config formats JSON/YAML/TOML/HTML/CSS/Vue). Adding a language is a
grammar name + a query block; the extractor is language-agnostic.

### Detectors (cross-framework)
- **API routes**: Express/Koa/Fastify, Flask/FastAPI, Spring, Go net/http & mux,
  Rails, Laravel, ASP.NET, Django, and file-based routing (Next.js app & pages,
  SvelteKit).
- **Database / ORM**: SQL DDL + DML, Supabase, Prisma, Drizzle, TypeORM, Django
  ORM, Mongoose &mdash; guarded to avoid false positives.
- **Env vars, dependencies, CI/CD, containers, background jobs/cron**, and
  **security signals** (secrets, `eval`/command-exec, XSS sinks, SQL-injection
  patterns, disabled TLS, weak hashes).

### Knowledge graph + metrics
A unified graph of files, functions, classes, routes, tables, dependencies, and
env vars connected by imports / calls / reads / writes / exposes / contains /
uses. Metrics: circular dependencies (Tarjan SCC), dead files, large & complex
functions, duplicate logic, layer violations, parse errors.

### Business flow inference
Workflows are inferred mechanically by seeding from API routes and domain-keyword
files, then walking the call graph to collect the function chain and the database
tables written along the way. Each flow has a step diagram and a copyable Mermaid
source.

### Interactive web app
Dashboard, Architecture (layered / module / DB graphs with zoom/pan/drag/
highlight), Files, Functions, Classes, API Explorer, Database, Dependencies,
Business Flows, Dependency Graph, Code Quality, Security, Version Compare, plus a
global search over everything. Every item drills into a detail page.

### Version comparison
Analyze two refs (branches / tags / commits) and diff files, functions, routes,
tables, and dependencies, with a coarse risk score.

### Optional AI (provider-agnostic)
A single abstraction speaks to:
- **OpenAI-compatible**: OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral,
  LM Studio, and any `/v1/chat/completions` endpoint (custom base URL)
- **Anthropic** (Claude), **Google Gemini**, **Ollama** (local)

Configure provider, base URL, key, model (with automatic model discovery when the
provider supports it, else manual entry), temperature, max tokens, streaming.
Answers are **grounded**: the model only sees a context assembled from the static
analysis index and is instructed to cite `file:line` and to say *"Unable to
determine from repository analysis."* when evidence is missing. Keys live in the
browser and are relayed by the local server per-request, never persisted.

## Architecture

```
repo-intel/
  bin/analyze.js            CLI: ingest + analyze -> JSON index
  src/analyzer/
    languages.js            tree-sitter grammar registry (ext -> language)
    queries.js              per-language extraction queries
    walk.js                 file discovery + language detection
    extract.js              AST symbol extraction (functions/classes/imports/calls)
    resolve.js              import resolution to in-repo files
    detectors.js            routes / db / env / security detection
    config.js               manifests / deps / CI / containers / jobs
    graph.js                unified knowledge graph + call graph
    metrics.js              code-quality + cycle metrics
    flows.js                business-flow inference
    compare.js              two-ref diff
    ingest.js               git clone / local path + git metadata
    analyze.js              orchestrator
  src/ai/
    providers.js            provider-agnostic chat + model discovery
    grounding.js            retrieval + grounded context assembly
  src/server/server.js      HTTP server (analyze SSE, index, refs, compare, AI proxy, static)
  web/                      the interactive SPA (vanilla JS, self-contained graph renderer)
```

## Design principles

- **Prefer static analysis over assumptions.** Facts carry `file:line` evidence.
- **AI is never required.** The whole platform works offline without a key.
- **Never hallucinate.** AI is grounded in the index and told to admit gaps.
- **Reproducible.** Same repo + ref -> same index. The CLI emits the JSON index.
- **Extensible.** New languages = a grammar + query block; new AI providers = an
  adapter; core logic is unchanged.

## Validated on

Flask (Python), Gin (Go), Vue core (TypeScript, 162K LOC), and a Next.js/Supabase
app &mdash; cross-checked against ground truth (e.g. route counts matched an
independent language-specific analyzer exactly).

## Notes & limits

- Call-graph resolution is name + import-scope based (unambiguous or same-file /
  imported-file wins); ambiguous dynamic dispatch is left unlinked but the raw
  call names are retained.
- Detectors are heuristics tuned for precision; anything uncertain is labeled and
  never asserted as fact.
- Very large monorepos are bounded (2 MB/file cap, vendor/build dirs skipped).

## Phase 2 — AI Semantic Intelligence Layer (additive)

Phase 2 adds a semantic layer **on top of** the static engine without changing
Phase 1. Static analysis stays the source of truth; AI only explains it.

Mechanical (works with AI OFF), computed at analyze time into `index.semantic`:
- **Modules & Domains** — business/technical modules clustered from directories +
  naming + routes + data access.
- **Repository Health** — 8 sub-scores (architecture, documentation, testing,
  security, maintainability, coupling, complexity, dead code) + overall, each with
  the evidence behind it.
- **Critical modules / risk areas** — ranked by knowledge-graph centrality.
- **Learn Repository** — an ordered reading path with a time estimate.
- **Trace & Impact** — "what breaks if I delete this?" (files/functions/routes/
  tables/tests/flows), Follow Request (client→middleware→route→services→db→
  response), Follow Data (table lifecycle), Follow Business Flow. All are graph
  walks, rendered interactively.

AI-enhanced (optional; degrade to a "configure AI" prompt when off):
- **AI Overview** — plain-English repo brief (architecture, domains, stack,
  request lifecycle, data flow, DB summary, extension points, risks).
- **Learn "Teach me this"** — per-module mentor notes.
- **AI Explain** — a widget on every file/function/table/module with Beginner,
  Senior, Architecture, Performance, and Security modes.
- **AI Assistant** — grounded chat using a graph-expanded evidence subgraph;
  answers cite file:line and end with a confidence level.
- **Commit Intelligence** — narrative impact of a structural diff between two refs.

Context builder (`src/ai/context-builder.js`): question → lexical seed match →
knowledge-graph neighbor expansion → ranked, compact evidence subgraph. The AI
never receives the whole repo. AI Settings supports multiple saved provider
profiles, top_p, and a connection test, with instant switching.

New server endpoints (all additive): `/api/ai/test`, `/api/ai/generate`,
`/api/impact`, `/api/trace`, `/api/commit-intel`. New analyzer modules:
`semantic.js`, `trace.js`. New AI modules: `context-builder.js`, `generators.js`.
New web module: `pages3.js` (Phase 1 files unchanged).


## Phase 3 — AI Semantic Graph Engine (additive)

Phase 3 makes every graph **AI-aware** while the AST-derived graph stays the
single source of truth. AI only adds labels, clusters, summaries, explanations,
workflows — never nodes or edges.

Mechanical (works with AI OFF), computed into `index.semanticGraph`:
- **Hierarchical semantic graph** — repo > domain > subsystem/module > file >
  class > function, with unlimited nesting and Google-Maps-style progressive
  expand/collapse.
- **Semantic edges** — real import/call/read/write edges aggregated into verbs
  (`uses`, `calls`, `persists`, `reads`, `exposes`, `depends on`, ...), each with
  a hover explanation and an evidence count.
- **Graph layers** — Technical, Business, Data, API, Database, Security,
  Performance, Testing, Infrastructure, Dependency. Switch instantly.
- **Intent modes** — Show Authentication / Database Writes / External APIs /
  Background Jobs / Notifications / Frontend / Backend / Infrastructure /
  Security / Critical Modules (inferred from structure, never hardcoded names).
- **Heatmap overlays** — Criticality, Most-imported, Most-coupled, Complexity,
  Least-tested, Highest-risk (aggregated to container nodes as hotspots).
- **In-graph search** highlighting, node/edge inspector with facts + drill-in.
- **Time Machine** — animated semantic diff between two refs (added/removed/
  changed routes, tables, files) with staggered reveal.

AI-enhanced (optional; grounded in the graph):
- **Explain This Graph** (story mode) narrates the current view for a chosen
  audience (Beginner / Intermediate / Senior / Architecture / Security /
  Performance), referencing real node labels.
- **Node reasoning** — "Why is this here?" explains a node's purpose,
  responsibilities, criticality, and dependents.
- **Repository Brain** — a disk-persisted, incremental cache of AI node
  explanations keyed by (index + node + model). Stable explanations are reused
  across sessions and only recomputed when the node/model changes; nothing is
  regenerated wholesale.

New endpoint: `/api/ai/graph` (story + node). New analyzer module
`semantic-graph.js`; new AI generators `graphStoryMessages` / `graphNodeMessages`;
new web modules `sgraph.js` (renderer) + `pages4.js` (Semantic Graph + Time
Machine). graph.js and all Phase 1/2 modules are unchanged.

## Phase 4 — Repository Brain & Live Knowledge Engine (additive)

Phase 4 formalizes a persistent **Repository Brain** as the central intelligence
layer. It wraps (never replaces) the analysis index and becomes the single source
of truth every page queries. Fully backward compatible.

Brain contents (persisted at `<cache>/brain/<id>/`):
- the analysis **index** (knowledge graph, semantic graph, domains, flows...)
- an offline **embedding index** (hashed token vectors; no model/network)
- ranked **insights** (critical / complex / coupled / most-modified via git churn
  / least-documented / highest-risk / most-unstable / fastest-growing)
- **plugin contributions** (extra graph nodes/layers/insights)
- **AI memory** (cached summaries/explanations, unified with Phase 3)
- an append-only **change history**
- a lazily-built commit **timeline**

Key capabilities:
- **Semantic search** — natural-language queries answered **first from the Brain**
  (offline embeddings + lexical), with an optional AI narrative. No AI required.
- **Incremental analysis** — `/api/brain/reindex` hashes the working tree, detects
  added/modified/deleted files, and **re-parses only those** (verified: a 1-file
  edit re-parses exactly 1 file; no changes → full skip). Nothing else rebuilds.
- **Repository Insights** page — the continuously ranked signal lists.
- **Graph Timeline** page — architecture growth sampled across commits.
- **Plugin system + SDK** — a documented contract lets analyzers add graph
  nodes/edges/layers/insights without touching core. Built-ins: Infrastructure,
  Security, External-dependencies. `registerPlugin()` adds more (Terraform, K8s,
  Docker, Cloud, etc.).
- **AI memory + smart invalidation** — stable node explanations are cached and
  reused across sessions; reindex invalidates only affected derived caches.

New modules: `src/brain/{brain,embeddings,insights,timeline,incremental,plugins}.js`.
New endpoints: `/api/brain`, `/api/brain/{search,insights,timeline,reindex,memory,
similar,plugins}`. New web module `web/assets/pages5.js`. All Phase 1-3 code
unchanged; the Brain initializes automatically right after analysis.

## Phase 5 — Intent & Business Intelligence (additive)

Phase 5 changes how the platform *thinks*. Phases 1-4 know WHAT exists; Phase 5
infers WHY it exists. It stops organizing code like a filesystem (services,
routes, utils) and instead organizes it by **intent** — the business and
technical capabilities a product is actually built from. Fully backward
compatible: a new mechanical layer (`index.intel`) plus new pages; nothing
existing changed.

Everything is grounded: capabilities, systems, journeys, and reasons are derived
from real static-analysis evidence (file/dir names, function & class names, HTTP
routes, DB tables, dependencies, env vars). The AI layer only *narrates* this
model; it never invents features. Every conclusion carries a **confidence**
(`confident` / `likely` / `possibly`); when evidence is missing the output says
"Unable to determine from repository analysis."

Mechanical engines (`src/intel/`):
- **Domain Discovery Engine** (`taxonomy.js` + `capabilities.js`) — matches a
  curated catalog of ~40 capabilities (Authentication, Payroll, Attendance,
  Resume Processing, Search, Payments, Notifications, AI Features, Caching,
  Jobs, ...) against multi-signal evidence, weighting implementation over tests
  so a feature that is only *referenced* in tests never reads as *implemented*.
- **System Map + Why-Graph** (`systemmap.js`) — a graph whose nodes are systems
  (not folders) and whose edges carry a business-level reason ("Payroll reads
  Attendance because salary depends on worked hours"), derived from real
  imports/calls/shared-table hand-offs.
- **Product engine** (`product.js`) — Product Overview (what/who/why/features/
  stack), Capability Map (capability → sub-capability → files/APIs/tables/tests/
  docs), inferred User Journeys, per-system Stories (purpose/inputs/outputs/
  dependencies/consumers/value/risks), and a Product Scorecard (architecture,
  business/technical modularity, domain separation, AI readiness, onboarding,
  ...) with recommendations.
- **Intent engine** (`intent.js`) — translates natural-language questions ("how
  are users authenticated?", "where is salary calculated?") into graph queries
  and returns focused evidence; plus Conversational Maps ("show systems touching
  Redis", "show database writes").
- **Guided Tour** (`intel.js`) — an adaptive, ordered walkthrough of the systems
  a newcomer should learn, with a complexity-based time estimate.

AI narration (`src/ai/intel-generators.js`, all optional/grounded): product
overview, system story, tour stop, journey, why-edge, intent answer, scorecard.

New endpoints: `/api/intel` (+ `?section=`), `/api/intel/query` (intent + map
modes), `/api/ai/intel`. New web module `web/assets/pages6.js` with pages:
**System Map** (new default landing when intel is available), Product Overview,
Capability Map, User Journeys, System Stories, Guided Tour, Ask the Repo, Product
Scorecard, and Beginner Mode. All Phase 1-4 pages unchanged (37/37 render OK).

Validated on real repos: HRMS → full-stack HR app (Payroll/Attendance/Leave/
Employee, HR Operations Cycle journey, salary→Payroll intent); Flask → correctly
reported as technical/library code with no invented product features.

## Phase 6 — Product Consolidation & UX Excellence (additive)

Phase 6 is a refinement phase, not a feature expansion. It turns a collection of
37 powerful tools into one coherent product around a single mission: **help a
developer understand any unfamiliar repository as fast and accurately as
possible.** Nothing was removed; every prior route still works. The *visible*
surface was dramatically simplified.

One front door, four experiences. The sidebar now leads with **Home** and the
flagship **Repository Map**, then groups everything into the four questions a
newcomer actually asks:
- **Understand** — Overview, Architecture, Capabilities, Health & Quality
- **Explore** — Files, Functions, Classes, API Explorer, Database, Dependencies
- **Explain** — AI Assistant, Guided Tour, Beginner Mode, System Stories, Ask
- **Trace** — Business Flows, User Journeys, Trace & Impact, Security, Compare

Advanced/duplicate tools (Semantic Graph, Dependency Graph, Insights, Timeline,
Time Machine, Scorecard, Classic Dashboard, the internal "Knowledge Store"...)
stay fully functional but move off the primary nav into a **command palette**.

Highlights:
- **Redesigned Home** answers in ~10 seconds: what the project is, how big, how
  healthy (animated ring), how it's organized, its top capabilities, quick
  actions, and a suggested place to start.
- **Repository Map** — the flagship. ONE graph, MANY lenses (Business /
  Technical / API / Database / Infrastructure / Security). Same repository, a
  different perspective per lens, instead of four separate graph pages.
- **Command palette** (Cmd/Ctrl-K) jumps to any page, file, function, or table.
- **Hidden internal jargon** — "Repository Brain / Semantic Layer / Embedding
  Index" are presented as user concepts (Knowledge Store, Search, the Map).
- **Premium polish** — refined typography/spacing, soft card depth, hover lift,
  page transitions, focus-visible states, skeleton/loading, an onboarding coach,
  a responsive collapsible sidebar, and ARIA roles/labels for keyboard users.
- **Graceful degradation** — repositories analyzed before the intelligence layer
  still get a polished Home, Map fallback, and clear empty states (no crashes).

New web module `web/assets/pages7.js` (Home, Repository Map, command palette,
onboarding) plus consolidated navigation in `app.js` and a large additive CSS
polish pass. Backend unchanged. Validated in-browser: 38/38 routes render, lenses
switch live, command palette resolves real symbols, and a no-intel repo degrades
cleanly.
