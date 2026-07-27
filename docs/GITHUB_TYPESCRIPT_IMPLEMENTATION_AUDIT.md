# GITHUB_TYPESCRIPT_IMPLEMENTATION_AUDIT.md

Pre-implementation audit for two gaps: (1) GitHub product integration for the
deployed app, and (2) making TypeScript/TSX/JavaScript first-class **deep**-trace
languages (today they only get structural/semantic analysis; deep investigation
targets Java only). Java support must not weaken. Static analysis stays the source
of truth; AI only explains.

## Current architecture (inventory)

| Concern | Where | State |
|---|---|---|
| Repo ingestion | `src/analyzer/ingest.js` | Clones any git URL (GitHub/GitLab/Bitbucket) or uses a local path; reads git meta. **No auth** (public only). |
| GitHub URL handling | `ingest.js` `normalizeRepoUrl()` | scp + https normalization, strips `/tree/branch`. |
| Auth / DB provider | none | The app is currently a **local, single-user** Node server (`src/server/server.js`); no login, no DB. |
| Language registry | `src/analyzer/languages.js` | tree-sitter grammars for 20+ langs incl. `typescript`, `tsx`, `javascript`. |
| Shallow extraction | `src/analyzer/extract.js` + `queries.js` | function/class names + calls (all languages, name-level). |
| **Deep trace (Java)** | `src/trace/*` | `java-analyzer.js` (structural walk) → `symbol-index.js` (type-aware call graph, DI) → `lineage.js` (backward/forward data-flow, formulas) → `engine.js` (feature discovery, cross-layer, loose-ends). |
| Evidence model | `src/trace/lineage.js` (`CONF`), `engine.js` | Typed evidence edges + confidence (VERIFIED/INFERRED/POSSIBLE). |
| Investigation pipeline | `src/trace/index.js` | `buildTraceModel()` + `investigateFeature/explainCalculation/traceVariable/getMethodDetail`. Gated on `f.lang === 'java'`. |
| Investigation UI | `web/assets/pages8.js` | Investigate page; shows "targets Java/Spring" when `trace.available===false`. |
| AI providers | `src/ai/providers.js` | Provider-agnostic; grounded generators (`trace-generators.js`). |

## The core insight for reuse

The trace engine is **already split into stages that are conceptually a language
adapter**: `java-analyzer.js` produces a per-file structural model; everything
downstream (`symbol-index`, `lineage`, `engine`, server, UI) consumes a
**normalized shape**:

```
file -> { path, package, imports[], classes[ { fqn, kind, stereotype, tableName,
          fields[ {name,type,columnName,annotations} ],
          methods[ {name,returnType,params[],locals[],assignments[],calls[],returns[]} ] } ] }
```

`symbol-index.js` only reads that shape. So the fastest correct path is:

- Define a **LanguageAnalyzer** contract that returns exactly this normalized
  per-file model (plus API/DB/framework evidence). `java-analyzer.js` becomes the
  Java implementation unchanged.
- Add `ts-analyzer.js` (TypeScript/TSX/JS) that emits the SAME normalized shape,
  so `symbol-index` / `lineage` / `engine` / server / UI work with **zero changes**
  for the deep pipeline. Cross-language works because the Evidence Graph is keyed
  by the normalized model, not by language.

## What can be reused
- `symbol-index.js`, `lineage.js`, `engine.js`, `src/trace/index.js` server
  endpoints, `pages8.js` UI, evidence/confidence model, AI generators — all
  language-independent already. TS just needs to feed them the normalized model.
- `languages.js` tree-sitter TS/TSX/JS grammars (already installed) for parsing.
- `ingest.js` for cloning (extend with an optional auth token for private repos).

## What requires extension
- **New**: `src/trace/languages/` adapter layer + `ts-analyzer.js` (deep TS/TSX/JS).
- **Extend**: `symbol-index.js` to accept multiple language models and merge them
  into one graph (Java + TS in the same repo → cross-language).
- **Extend**: `engine.js` feature discovery + cross-layer to match frontend
  `fetch()/axios` calls to backend routes across languages (framework-aware
  evidence: `VERIFIED_HTTP_ROUTE`, `VERIFIED_NEXT_ROUTE`, `VERIFIED_SUPABASE_QUERY`).
- **New**: a **capability model** so the UI reports Java=Full, TS=Full, others=
  Structural, derived from analyzer support (not hardcoded messages).
- **Extend**: `ingest.js` to accept a short-lived token for private clones.

## What should be refactored
- The `f.lang === 'java'` gate in `src/trace/index.js` → iterate all languages
  with a registered deep analyzer.
- The hardcoded "targets Java/Spring" UI copy → capability table.

## TypeScript parser choice
`ts-morph` / the TS Compiler API give the best type resolution, but add a heavy
dependency and are awkward under the repo's ESM + offline constraints. The project
already ships **tree-sitter** TS/TSX/JS grammars and uses them everywhere else.
Decision: use **tree-sitter (web-tree-sitter)** for the structural + data-flow
walk (same technique proven for Java), with a lightweight local type/type-inference
pass (declared types, `useState` tuples, return-type inference, import-based
resolution). This is a proper parser (not regex, as the prompt forbids), stays
offline, and shares infrastructure. Type precision is slightly below the TS
compiler but sufficient for symbol/call/data-flow/calculation tracing. (A
ts-morph backend can be added later behind the same adapter if deeper type
resolution is needed.)

## How TS shares the Evidence Graph
`ts-analyzer.js` emits the same normalized `{classes[{methods[{locals,assignments,
calls,returns}]}]}` model. Module-scope functions/consts are wrapped in a synthetic
"module class" so the existing method/field machinery applies. React components are
methods; hooks/handlers are calls; `fetch()`/`axios`/api-wrapper calls become
`apiCall` evidence with method+URL; Supabase/Prisma chains become `dbAccess`
evidence with table+op+columns. `symbol-index` then builds one call graph over Java
+ TS symbols, and `engine` links frontend API calls to backend routes by
method+path → one end-to-end cross-language flow.

## GitHub integration (deployed architecture)
The app currently runs locally with no auth/DB. Full production GitHub-App +
OAuth + Postgres cannot be exercised in this local, offline dev environment, so
this phase delivers the **architecture + secure scaffolding**, cleanly separated
so it can be wired to a deployment:

- **Separation**: application login ("who is the user") vs GitHub App installation
  ("which repos may be accessed") kept as distinct modules.
- **Token flow** (documented + implemented in a `src/github/` module):
  `installation_id → App JWT (RS256 from private key, server-side) → short-lived
  installation token → clone → token discarded`. Private key + tokens never reach
  the browser.
- **Ingestion**: `ingest.js` extended to accept an optional `authToken` for
  `https://x-access-token:<token>@github.com/...` clones (used by the server only).
- **Analysis-job abstraction**: wrap analysis in a job (`src/jobs/`) with
  create → run (server-side clone + analyze) → progress → result, so a worker can
  later move to dedicated compute. Local dev runs the job in-process.
- **Data model** (documented; adapter-based so a real DB can back it): `users`,
  `github_installations`, `repositories` (store GitHub repo **id**, not just name),
  `repository_access`, `analysis_runs`, `investigations`. A local JSON-file store
  implements the interface for dev; a Postgres impl can replace it in prod.
- **Authorization rule**: every private-repo op verifies user → installation →
  repo access server-side; browser-supplied repo ids are never trusted.

## Implementation order (this phase)
Deep TS tracing first (unblocks the current TypeScript "nothing to show" bug), then
React/API/DB/cross-language, then the capability model + UI, then the GitHub
architecture module + analysis-job abstraction, then acceptance tests.
