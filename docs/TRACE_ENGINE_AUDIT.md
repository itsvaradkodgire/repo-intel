# TRACE_ENGINE_AUDIT.md

Audit of the existing Repository Intelligence analyzer, performed before building
the **Verified Feature & Data Tracing Engine** (the new core product). Goal: reuse
everything that can support symbol/variable/expression-level tracing; extend or add
only what is missing. Java + Spring is the reference deep-analysis target.

## 1. What already exists (inventory)

| Capability | File(s) | Granularity today | Verdict |
|---|---|---|---|
| Repo ingestion / clone | `src/analyzer/ingest.js` | repo | **reuse** |
| Language detection | `src/analyzer/languages.js` (Java grammar present) | file | **reuse** |
| AST parsing (tree-sitter, 20+ langs) | `src/analyzer/languages.js`, `extract.js` | file | **reuse + extend** |
| Symbol extraction | `extract.js` + `queries.js` | function + class name/line only | **extend** (no fields/params/locals/types) |
| Import resolution | `resolve.js` | file → file | **reuse** |
| Call graph | `graph.js` | function → function, resolved by **name** + import scope | **extend** (name-only; no type/receiver resolution, no iface→impl) |
| Dependency graph | `graph.js` | file/function | **reuse** |
| DB access detection | `detectors.js` | file-level regex (table names, ORM ops) | **extend** (no column-level, no entity mapping) |
| API route detection | `detectors.js` | file-level regex (incl. Spring `@*Mapping`) | **extend** (no request/response DTO binding) |
| Env var detection | `detectors.js` | file | reuse |
| Impact / trace | `trace.js` | **file & function level** (impact, follow-data, follow-request, follow-flow) | **extend** (all file/function; no variable, no expression) |
| Business flows | `flows.js` | file/route/table heuristic chains | keep as secondary |
| Semantic layer / graph | `semantic.js`, `semantic-graph.js` | file/domain clustering | keep as secondary |
| Intel (capabilities/systems) | `src/intel/*` | capability/system | keep as secondary |
| Repository brain / embeddings | `src/brain/*` | file/symbol text embeddings | **reuse** (feature-discovery signal) |
| AI providers (grounded) | `src/ai/*` | n/a | **reuse** (explanation only) |
| Graph visualization | `web/assets/graph.js`, `graph-layout.js` | generic graph | **reuse** for the focused evidence graph |

## 2. What needs extending

- **Symbol index**: today a "symbol" is just `{name,line,loc,complexity,calls[]}`. Needs
  stable IDs, FQN, kind (field/param/local/dto/entity/controller/service/repository),
  declared/return/param **types**, annotations, containing class/module, visibility.
- **Call graph**: resolves by bare name. Needs **type-aware receiver resolution**
  (`this.payrollService.generate()` → `PayrollService#generate`) and
  **interface → implementation** linking (Spring DI).
- **DB detection**: file-level table names only. Needs **column-level** access and
  **entity ↔ table ↔ column** mapping (JPA `@Entity`, `@Table`, `@Column`).
- **API detection**: routes only. Needs **request/response DTO binding** for contract
  verification.
- **Trace engine**: file/function only. Needs the variable + expression layers.

## 3. What needs replacing / adding new

Net-new modules (added under `src/trace/`), because none of the above operate below
the function level:

- **Java deep symbol resolver** (fields, params, locals, types, annotations, Spring
  stereotypes, JPA entities/DTOs).
- **Control-flow analysis** (per-method branches affecting assignments).
- **Data-flow / variable lineage** (backward + forward).
- **Expression / calculation extraction** (real formulas from the AST).
- **Evidence graph** (typed nodes/edges, each with source evidence + confidence:
  VERIFIED / INFERRED / POSSIBLE / UNKNOWN).
- **Feature discovery** (multi-signal candidate flows) and **cross-layer / DB-lineage /
  contract / loose-end** verification.
- **Investigation UI** (Investigate Feature / Trace Variable / Explain Calculation).

## 4. Currently file-level only

Import graph, DB access, API routes, security findings, impact-of-file, follow-data,
follow-request, business flows, semantic clustering, health/insights.

## 5. Already works at function/symbol level

Function extraction (name/line/complexity/calls), class extraction (name/kind/line),
name-based call graph (`resolvedCalls` / `calledBy`), impact-of-function.

## 6. Variable-level analysis

**Does not exist.** No locals, parameters, fields, or assignments are extracted. This
is the single biggest gap and the most important engine to build (data-flow / lineage).

## 7. Control-flow analysis

**Does not exist.** `complexityOf()` merely *counts* branch nodes for a cyclomatic
score; it does not model which branch assigns which value. Needed to explain *why* a
value changes.

## 8. Data-flow analysis

**Does not exist.** No assignment tracking, no def-use chains, no backward/forward
value tracing.

## 9. Type resolution

**Does not exist.** No declared/return/parameter types are captured; the call graph is
name-only. Java's explicit types make this tractable and are the reason Java is the
reference language.

## 10. Cross-language / cross-layer tracing

**Partial.** `traceRequest()` walks route → handler files → DB tables at the file
level, and detectors span languages, but there is no symbol-accurate cross-layer
trace (React button → API client → controller → DTO → service → repository → entity →
column → response DTO → frontend state). This is a core new capability.

## Design decision

Build the new engine as an **additive `src/trace/` layer** consumed at analyze time
(attached as `index.trace`), plus server endpoints `/api/trace2/*` and an
Investigation UI. Do not remove any existing analyzer output or page. Java gets the
deepest resolver; other languages keep their current (shallower) support and degrade
gracefully. Static analysis produces the evidence; AI only explains it.
