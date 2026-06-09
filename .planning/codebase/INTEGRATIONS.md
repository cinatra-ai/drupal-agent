# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra LLM Bridge:**
- Service: `{{CINATRA_BASE_URL}}/api/llm-bridge` — Internal Cinatra endpoint used by the `load_node` ApiNode in `cinatra/oas.json`
- Auth: Resolved automatically by the WayFlow runtime via `CINATRA_BASE_URL`
- LLM config: `preferredProvider: "openai"`, `preferredModel: "gpt-5.5"` (declared in `cinatra/oas.json` under `load_node.data.cinatra_llm`)

**Drupal CMS:**
- Service: Any connected Drupal instance, identified by `instanceId` at runtime
- Access: Indirect — via `drupal_*` MCP primitives registered by `@cinatra-ai/drupal-connector`
- No direct HTTP calls from this repo; all Drupal I/O is mediated through the MCP server in the connector package
- Operations used (defined in `AGENTS.md`):
  - `drupal_node_get` — Read current node content
  - `drupal_node_create_draft_revision` — Demote published node to draft before editing
  - `drupal_node_update` — Apply field changes
  - `drupal_node_publish` — Publish node (only on explicit user request)

**OpenAI:**
- Service: OpenAI API (accessed indirectly through Cinatra's LLM bridge)
- Auth: Managed by the Cinatra platform, not this repo
- Model: `gpt-5.5` (configured in `cinatra/oas.json`)

## Data Storage

**Databases:**
- Not applicable — this agent does not directly connect to any database. Drupal's database is managed by the Drupal instance and accessed through MCP primitives.

**File Storage:**
- Not applicable

**Caching:**
- Not applicable

## Authentication & Identity

**Auth Provider:**
- Not applicable — this repo contains no auth logic. Authentication to Drupal and to the LLM bridge is handled by the Cinatra platform and the `@cinatra-ai/drupal-connector` package respectively.

## Monitoring & Observability

**Error Tracking:**
- Not detected in this repo

**Logs:**
- Not detected — logging is handled by the WayFlow runtime host

## CI/CD & Deployment

**Hosting:**
- Cinatra Marketplace — distribution target for the packaged agent
- WayFlow runtime — execution environment; default dev URL is `http://localhost:3020`
- Docker — local development via `docker compose --profile drupal up -d` (per `AGENTS.md`)

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml` and `.github/workflows/release.yml`
- CI runs on Node 24, validates package shape, runs `extension-kind-gate.mjs` for OAS validation
- Release workflow delegates to `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml@main`; requires `CINATRA_MARKETPLACE_VENDOR_TOKEN` org secret

## Environment Configuration

**Required env vars (in host Cinatra app, not this repo):**
- `CINATRA_BASE_URL` — Base URL for the LLM bridge endpoint (used in `cinatra/oas.json`)
- `DRUPAL_CONTENT_EDITOR_A2A_URL` — Overrides WayFlow agent URL; defaults to `http://localhost:3020` (set in `.env.local`)

**Secrets location:**
- `.npmrc` present — sets `auto-install-peers=false`; no tokens detected
- Secrets managed at org level (`CINATRA_MARKETPLACE_VENDOR_TOKEN`) via GitHub Actions; not stored in this repo

## Webhooks & Callbacks

**Incoming:**
- The agent is invoked via A2A (Agent-to-Agent) blocking dispatch from `/api/drupal-widget/chat/route.ts` in the host Cinatra app. This is not a webhook — it is a synchronous call to the WayFlow agent endpoint.
- Timeout: 600,000 ms (10 minutes), configured in the caller (`chat/route.ts`)

**Outgoing:**
- None — the agent returns a JSON diff payload to the A2A caller synchronously

---

*Integration audit: 2026-06-09*
