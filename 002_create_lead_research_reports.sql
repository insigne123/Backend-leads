create table if not exists public.lead_research_reports (
    report_id text primary key,
    lead_ref text,
    user_id text,
    organization_id text,
    status text not null check (status in ('queued', 'in_progress', 'completed', 'partial', 'insufficient_data', 'failed')),
    requested_depth text not null check (requested_depth in ('light', 'standard', 'deep')),
    completed_depth text check (completed_depth in ('light', 'standard', 'deep')),
    provider text not null default 'vane',
    cache_key text not null,
    base_cache_key text not null,
    cache_hit boolean not null default false,
    normalized_lead jsonb not null default '{}'::jsonb,
    normalized_company jsonb not null default '{}'::jsonb,
    seller_context jsonb not null default '{}'::jsonb,
    user_context jsonb not null default '{}'::jsonb,
    options jsonb not null default '{}'::jsonb,
    report_json jsonb,
    warnings jsonb not null default '[]'::jsonb,
    errors jsonb not null default '[]'::jsonb,
    diagnostics jsonb not null default '{}'::jsonb,
    duration_ms integer,
    parent_report_id text references public.lead_research_reports(report_id) on delete set null,
    request_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    expires_at timestamptz
);

create index if not exists idx_lead_research_reports_cache_key
    on public.lead_research_reports (cache_key);

create index if not exists idx_lead_research_reports_base_cache_key
    on public.lead_research_reports (base_cache_key);

create index if not exists idx_lead_research_reports_status_created
    on public.lead_research_reports (status, created_at asc);

create index if not exists idx_lead_research_reports_expires_at
    on public.lead_research_reports (expires_at desc);
