# Backend Handoff

## What this app does

This backend is a Next.js server app focused on three sales workflows:

1. Lead search using Apollo
2. Lead enrichment using Apollo (email/phone, including webhook-based phone completion)
3. Lead/company research using Vane for commercial intelligence

Apollo remains the source of truth for people/company identity and contact enrichment.
Vane is used for web research and commercial context.

## Main tables used

- `people_search_leads`
  - stores leads found by `/api/lead-search`
  - LinkedIn profile search also stores results here
  - webhook phone enrichment for LinkedIn profile search updates this table

- `enriched_leads`
  - used by the generic enrichment flow (`/api/enrich`)

- `enrichment_logs`
  - stores enrichment execution/webhook logs

- `lead_research_reports`
  - stores cached and async lead research reports
  - created by `002_create_lead_research_reports.sql`

## API endpoints

### 1) `POST /api/lead-search`

Main Apollo search endpoint.

Supports these modes:

- `search_mode = "batch"`
- `search_mode = "linkedin_profile"`
- `search_mode = "company_name"`

#### A. Batch mode

Searches Apollo companies, then Apollo people.

Typical request:

```json
{
  "user_id": "user-123",
  "search_mode": "batch",
  "industry_keywords": ["outsourcing"],
  "company_location": ["Chile"],
  "titles": ["CEO"],
  "max_results": 50
}
```

#### B. LinkedIn profile mode

Single-person lookup by LinkedIn profile URL.

Accepted aliases:

- `search_mode`: `linkedin_profile | linkedin | profile`
- `linkedin_url | linkedin_profile_url | linkedinUrl | linkedinProfileUrl`
- `reveal_email | revealEmail`
- `reveal_phone | revealPhone`

Typical request:

```json
{
  "user_id": "user-123",
  "search_mode": "linkedin_profile",
  "linkedin_url": "https://www.linkedin.com/in/username",
  "reveal_email": true,
  "reveal_phone": true
}
```

Behavior:

- first resolves the person synchronously without phone
- stores/upserts the person in `people_search_leads`
- if `reveal_phone=true`, queues async phone enrichment through Apollo webhook
- returns:
  - `requested_reveal`
  - `applied_reveal`
  - `provider_warnings`
  - `phone_enrichment`

Important note:

- phone is completed asynchronously through `/api/apollo-webhook`
- reconciliation key is `id = Apollo person id`

#### C. Company name mode

Search by company name, optionally constrained by domain, then search employees.

Accepted domain fields:

- `organization_domains`
- `organizationDomains`
- `organization_domain_list`
- `organizationDomainList`
- `organization_domain`
- `organizationDomain`
- `company_domain`
- `companyDomain`

Typical request:

```json
{
  "user_id": "user-123",
  "search_mode": "company_name",
  "company_name": "GrupoExpro",
  "organization_domains": ["grupoexpro.com"],
  "seniorities": ["director", "vp", "c_suite"],
  "titles": ["CEO"],
  "max_results": 25
}
```

Behavior:

- if domain is present, backend first resolves organization by domain
- if organization is ambiguous, returns `requires_organization_selection=true`
- then runs Apollo People Search with `organization_ids[]`, optional `person_seniorities[]`, optional `person_titles[]`

### 2) `POST /api/enrich`

Generic Apollo enrichment worker.

Used for enriching a known record in a known table.

Requires backend auth:

- `x-api-secret-key` must match `API_SECRET_KEY`

Typical request:

```json
{
  "record_id": "uuid",
  "table_name": "enriched_leads",
  "lead": {
    "first_name": "Juan",
    "last_name": "Perez",
    "organization_name": "Empresa X",
    "organization_domain": "empresax.com",
    "apollo_id": "apollo-person-id"
  },
  "reveal_email": true,
  "reveal_phone": false,
  "enrichment_level": "basic"
}
```

Behavior:

- supports `basic` vs `deep`
- respects `reveal_email` / `reveal_phone`
- builds Apollo `webhook_url` and sends async enrichment requests
- updates target table and logs to `enrichment_logs`

### 3) `POST /api/apollo-webhook`

Receiver for Apollo webhook callbacks.

Used by both:

- `/api/enrich`
- LinkedIn phone enrichment in `/api/lead-search`

Query params used:

- `record_id`
- `table_name`
- `reveal_email`
- `reveal_phone`

Behavior:

- parses person payload from webhook
- updates row in the table indicated by `table_name`
- uses `record_id` to locate the row (`id = record_id`)
- writes `enrichment_logs`

### 4) `POST /api/lead-research`

Commercial lead research endpoint powered by Vane.

Supports:

- `depth = light`
- `depth = standard`
- `depth = deep`

Behavior:

- `light` and `standard` are synchronous
- `deep` is queued and processed asynchronously

Typical request:

```json
{
  "user_id": "user-123",
  "organization_id": "org-123",
  "lead_ref": "lead-uuid",
  "lead": {
    "full_name": "Juan Perez",
    "title": "Gerente Comercial",
    "linkedin_url": "https://www.linkedin.com/in/juan-perez"
  },
  "company": {
    "name": "GrupoExpro",
    "domain": "grupoexpro.com",
    "website_url": "https://grupoexpro.com"
  },
  "seller_context": {
    "company_name": "Mi Empresa",
    "services": ["Prospeccion", "Automatizacion comercial"],
    "value_proposition": "Damos contexto comercial accionable"
  },
  "options": {
    "language": "es",
    "depth": "standard",
    "include_outreach_pack": true,
    "include_company_research": true,
    "include_lead_research": true,
    "include_recent_signals": true,
    "include_call_prep": true,
    "include_competitive_context": true,
    "include_raw_sources": true,
    "max_sources": 15,
    "force_refresh": false
  }
}
```

Response includes:

- normalized lead/company
- `website_summary`
- `signals`
- `lead_context`
- `company_context`
- `buyer_intelligence`
- `outreach_pack`
- `existing_compat.cross`
- `existing_compat.enhanced`
- `sources`
- `diagnostics`

Important diagnostics fields:

- `diagnostics.vane_calls`
- `diagnostics.total_vane_duration_ms`
- `diagnostics.estimated_cost`

Cost note:

- `estimated_cost` is heuristic, not exact provider billing

### 5) `GET /api/lead-research/[reportId]`

Returns research report by id.

- if completed, returns the stored report
- if queued/in progress, returns the latest known report shape with status

### 6) `POST /api/internal/lead-research/process`

Internal worker endpoint for deep research.

Auth:

- `Authorization: Bearer <LEAD_RESEARCH_WORKER_SECRET>`
  or
- `x-worker-secret: <LEAD_RESEARCH_WORKER_SECRET>`

Behavior:

- processes a specific queued `report_id`, or the next queued deep job
- marks job `in_progress`
- runs deep research
- stores the completed report in `lead_research_reports`

### 7) Utility endpoints

- `GET/POST /api/enrich-health`
  - simple health/debug endpoint for enrichment reachability

- `GET /api/debug-check`
  - debugging endpoint against `enriched_leads`

## Current research architecture

### Lead research provider

Lead research uses Vane.

Current required runtime env vars:

- `VANE_BASE_URL`
- `VANE_PROVIDER_NAME`
- `VANE_CHAT_MODEL_KEY`
- `VANE_EMBEDDING_MODEL_KEY`
- `VANE_AUTH_HEADER_NAME`
- `VANE_AUTH_HEADER_VALUE`
- `VANE_TIMEOUT_MS`

Recommended initial values:

- `VANE_PROVIDER_NAME=OpenAI`
- `VANE_CHAT_MODEL_KEY=gpt-4o-mini`
- `VANE_EMBEDDING_MODEL_KEY=text-embedding-3-small`

### Deep research

Deep research is async and needs:

- `LEAD_RESEARCH_WORKER_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `lead_research_reports` table
- a worker/cron hitting `/api/internal/lead-research/process`

## Apollo webhook phone enrichment for LinkedIn profile search

The sender and receiver both exist in this repo.

### Sender

File:

- `src/app/api/lead-search/route.ts`

Main functions:

- `resolveLinkedInProfileWebhookUrl(...)`
- `queueLinkedInPhoneEnrichment(...)`

Flow:

1. Search person by LinkedIn URL
2. Save person in `people_search_leads`
3. If `reveal_phone=true`, queue Apollo request by `id` with:
   - `reveal_phone_number=true`
   - `webhook_url=/api/apollo-webhook?...`
4. Apollo webhook updates `people_search_leads`

### Receiver

File:

- `src/app/api/apollo-webhook/route.ts`

Reconciliation key:

- `record_id` query param
- row is updated with `.eq('id', record_id)`

For LinkedIn profile search specifically:

- `record_id = Apollo person id`
- target table = `people_search_leads`

## How another app should use this backend

### If it needs people/company search

Use `POST /api/lead-search`

### If it needs enrichment

Use `POST /api/enrich`

### If it needs commercial research

Use `POST /api/lead-research`

Recommended frontend behavior for research:

- `standard`: synchronous call, show loading state
- `deep`: queue async and poll `GET /api/lead-research/[reportId]`

### Current practical recommendation

- use `depth=standard` first
- do not run `deep` automatically
- cache aggressively
- only use `force_refresh=true` when needed

## Important caveats

- `estimated_cost` is approximate, not exact provider billing
- `standard` may still be slow because Vane itself is expensive internally
- production behavior depends on Vane availability and correct env/secret mapping in App Hosting
- `apphosting.yaml` must explicitly expose Vane/runtime variables and secrets
