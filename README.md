# Next.js Lead Search Microservice

This project is a microservice for B2B lead prospecting using the Apollo.io API and Supabase.

## Features

- **Lead Search API**: `/api/lead-search` endpoint to automate prospecting.
- **Lead Research API**: `/api/lead-research` endpoint to generate structured commercial research using Vane.
- **Dashboard**: `/lead-search` UI to manage and view searches.
- **Supabase Integration**: Persists leads to a PostgreSQL database.
- **Apollo.io Integration**: Advanced filtering and pagination for companies and people.

## Installation

1.  **Clone the repository** (if not already done).
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Setup**:
    Create a `.env.local` file in the root directory with the following keys:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
    APOLLO_API_KEY=your_apollo_api_key
    VANE_BASE_URL=https://your-vane-instance
    VANE_PROVIDER_NAME=OpenAI
    VANE_CHAT_MODEL_KEY=gpt-5-mini
    VANE_EMBEDDING_MODEL_KEY=text-embedding-3-large
    LEAD_RESEARCH_WORKER_SECRET=your_internal_worker_secret
    ```
4.  **Database Setup**:
    Ensure your existing `people_search_leads` table is present, then run `002_create_lead_research_reports.sql` in your Supabase SQL Editor.

## Usage

### Running Locally
```bash
npm run dev
```
Visit `http://localhost:3000/lead-search` to use the dashboard.

### API Usage
**POST** `/api/lead-search`

Body:
```json
{
  "industry_keywords": ["software", "saas"],
  "company_location": ["United States"],
  "titles": ["CEO", "Founder"],
  "max_results": 50
}
```

**POST** `/api/lead-research`

Body:
```json
{
  "user_id": "user-123",
  "lead_ref": "lead-uuid",
  "lead": {
    "full_name": "Juan Perez",
    "title": "Gerente Comercial",
    "linkedin_url": "https://www.linkedin.com/in/juan-perez"
  },
  "company": {
    "name": "GrupoExpro",
    "domain": "grupoexpro.com"
  },
  "seller_context": {
    "company_name": "Mi Empresa",
    "services": ["Servicio 1", "Servicio 2"],
    "value_proposition": "Ayudamos a reducir tiempos de contratacion"
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

`light` and `standard` are synchronous. `deep` is queued for asynchronous processing and should be polled via:

- `GET /api/lead-research/:reportId`
- `POST /api/internal/lead-research/process` (protected by `LEAD_RESEARCH_WORKER_SECRET`)
