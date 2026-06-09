# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JSON — Agent flow definition (`cinatra/oas.json`), package manifest (`package.json`)
- Markdown — Skill prompt (`skills/drupal-agent/SKILL.md`), documentation (`README.md`, `AGENTS.md`)

**Secondary:**
- JavaScript (ESM) — CI gate utility (`extension-kind-gate.mjs`), zero-dependency, Node builtins only
- TypeScript — Declared via `tsconfig.json` targeting `src/` directory; no TypeScript source files are currently tracked (content-only extension — the monorepo owns TS compilation)

## Runtime

**Environment:**
- Node.js 24 (specified in `.github/workflows/ci.yml` via `actions/setup-node@v4`)

**Package Manager:**
- pnpm via corepack (enabled in CI with `corepack enable`)
- Lockfile: not committed (CI runs `pnpm install --no-frozen-lockfile`)

## Frameworks

**Core:**
- Cinatra WayFlow — Agent orchestration platform. This repo defines a WayFlow `Flow`-type agent (`cinatra/oas.json`, `agentspec_version: 26.1.0`) composed of `StartNode`, `ApiNode`, `OutputMessageNode`, and `EndNode` components.

**Testing:**
- Not applicable — no test files tracked. Tests for this source-mirror repo run in the cinatra monorepo.

**Build/Dev:**
- No build tooling — content-only extension (no TypeScript sources in `src/`). `tsconfig.json` exists for potential future TS sources.
- `extension-kind-gate.mjs` — self-contained CI validation script (zero dependencies, plain Node builtins)

## Key Dependencies

**Critical:**
- `@cinatra-ai/drupal-connector` (optional peerDependency, provided by cinatra monorepo) — Registers `drupal_*` MCP primitives via `src/lib/mcp-server.ts` in the connector package. The agent accesses Drupal through these primitives.

**Infrastructure:**
- No direct npm dependencies declared in `package.json`. The `cinatra.dependencies` field is an empty array.

## Configuration

**Environment:**
- `DRUPAL_CONTENT_EDITOR_A2A_URL` — Overrides the default WayFlow agent URL (`http://localhost:3020`). Used by the parent `chat/route.ts` caller. Set in `.env.local` of the host Cinatra app.
- `CINATRA_BASE_URL` — Template variable used inside `cinatra/oas.json` `ApiNode.url` (`{{CINATRA_BASE_URL}}/api/llm-bridge`). Resolved at runtime by the WayFlow engine.
- `.env` / `.env.local` files — existence noted, contents not read.
- `.npmrc` — sets `auto-install-peers=false`

**Build:**
- `tsconfig.json` — Standalone strict TypeScript config; targets `ES2023`, `ESNext` modules, `bundler` module resolution, outputs to `dist/`, roots at `src/`. Not actively used (no tracked TS sources).

## Platform Requirements

**Development:**
- Docker with `drupal` compose profile: `docker compose --profile drupal up -d` starts the WayFlow agent at `http://localhost:3020`
- Node.js 24+

**Production:**
- Cinatra Marketplace — published via GitHub Release triggering `.github/workflows/release.yml`, which delegates to the reusable `cinatra-ai/.github` workflow. Requires `CINATRA_MARKETPLACE_VENDOR_TOKEN` org secret.
- The agent runs inside the Cinatra WayFlow runtime; the `ApiNode` calls `{{CINATRA_BASE_URL}}/api/llm-bridge` with `preferredProvider: "openai"` and `preferredModel: "gpt-5.5"`.

---

*Stack analysis: 2026-06-09*
