import { z } from 'zod';
import type { GatewayConfig, LeadProvider } from './gateway';

const MAX_FILTER_ITEMS = 20;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: Array<{ path: string; message: string }> };

export type LeadSearchInput = {
  provider: LeadProvider;
  searchMode: 'batch' | 'company_name';
  userId?: string;
  revealEmail: boolean;
  revealPhone: boolean;
  companyName?: string;
  organizationDomains: string[];
  selectedOrganizationId?: string;
  selectedOrganizationName?: string;
  selectedOrganizationDomain?: string;
  titles: string[];
  seniorities: string[];
  industryKeywords: string[];
  companyKeywords: string[];
  companyLocations: string[];
  personLocations: string[];
  employeeRanges: string[];
  includeSimilarTitles: boolean;
  maxResults: number;
};

export type EnrichmentInput = {
  recordId?: string;
  tableName?: 'enriched_opportunities' | 'enriched_leads' | 'people_search_leads';
  lead: {
    id?: string;
    sourceProviderId?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    linkedinUrl?: string;
    organizationName?: string;
    organizationDomain?: string;
  };
  revealEmail: boolean;
  revealPhone: boolean;
  enrichmentLevel: 'basic' | 'deep';
  webhookUrl?: string;
  matchOnly: boolean;
};

export type OrganizationEnrichmentInput = {
  domain: string;
};

function boundedText(maxLength = 160) {
  return z.string().trim().min(1, 'must not be empty').max(maxLength, `must be at most ${maxLength} characters`);
}

function boundedTextList(maxLength = 160) {
  return z.array(boundedText(maxLength)).max(MAX_FILTER_ITEMS, `must contain at most ${MAX_FILTER_ITEMS} values`).optional().default([]);
}

export function normalizeEmployeeRange(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+empleados?$/, '').trim();
  const bounded = normalized.match(/^(\d+)\s*(?:-|,|a)\s*(\d+)$/);
  if (bounded) {
    const minimum = Number(bounded[1]);
    const maximum = Number(bounded[2]);
    if (minimum >= 0 && maximum >= minimum && maximum <= 10_000_000) return `${minimum},${maximum}`;
    return null;
  }

  const openEnded = normalized.match(/^(\d+)\s*\+$/);
  if (openEnded) {
    const minimum = Number(openEnded[1]);
    return minimum <= 10_000_000 ? `${minimum},10000000` : null;
  }
  return null;
}

function employeeRangeList() {
  const employeeRange = boundedText(80)
    .refine((value) => normalizeEmployeeRange(value) !== null, 'must use min,max, min-max, or min+')
    .transform((value) => normalizeEmployeeRange(value)!);
  return z.array(employeeRange).max(MAX_FILTER_ITEMS, `must contain at most ${MAX_FILTER_ITEMS} values`).optional().default([]);
}

function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!candidate || candidate.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(candidate)) {
    return null;
  }
  return candidate.startsWith('www.') ? candidate.slice(4) : candidate;
}

function boundedDomain() {
  return z.string().trim().min(1).max(500)
    .refine((value) => normalizeDomain(value) !== null, 'must be a valid domain')
    .transform((value) => normalizeDomain(value)!);
}

function optionalIdentifier() {
  return boundedText(200).optional();
}

function issuesFrom(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

function validLinkedinUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function validWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.hostname !== 'localhost'
      && url.hostname !== '127.0.0.1'
      && url.hostname !== '::1';
  } catch {
    return false;
  }
}

export function validateLeadSearchInput(value: unknown, config: GatewayConfig): ValidationResult<LeadSearchInput> {
  const schema = z.object({
    provider: z.literal('apollo').optional(),
    user_id: optionalIdentifier(),
    search_mode: z.enum(['batch', 'company_name']),
    reveal_email: z.boolean().optional(),
    reveal_phone: z.boolean().optional(),
    company_name: boundedText(200).optional(),
    organization_domains: z.array(boundedDomain()).max(MAX_FILTER_ITEMS).optional().default([]),
    selected_organization_id: optionalIdentifier(),
    selected_organization_name: boundedText(200).optional(),
    selected_organization_domain: boundedDomain().optional(),
    selected_organization_website: z.string().trim().max(500).optional(),
    selected_organization_industry: boundedText(160).optional(),
    selected_organization_size: z.number().int().min(0).max(10_000_000).nullable().optional(),
    titles: boundedTextList(),
    seniorities: boundedTextList(),
    industry_keywords: boundedTextList(),
    company_keywords: boundedTextList(),
    company_location: boundedTextList(),
    person_locations: boundedTextList(),
    employee_range: employeeRangeList(),
    employee_ranges: employeeRangeList(),
    include_similar_titles: z.boolean().optional().default(true),
    // The BFF historically accepts up to 5,000. Keep that contract bounded,
    // then clamp provider work to the backend's stricter runtime cap below.
    max_results: z.number().int().min(1).max(5_000).optional(),
  }).strict().superRefine((input, context) => {
    if (input.search_mode === 'company_name'
      && !input.company_name
      && input.organization_domains.length === 0
      && !input.selected_organization_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['company_name'], message: 'a company name, domain, or organization id is required' });
    }

    if (input.search_mode === 'batch'
      && input.titles.length === 0
      && input.seniorities.length === 0
      && input.industry_keywords.length === 0
      && input.company_keywords.length === 0
      && input.company_location.length === 0
      && input.person_locations.length === 0
      && input.employee_range.length === 0
      && input.employee_ranges.length === 0
      && input.organization_domains.length === 0
      && !input.selected_organization_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['search_mode'], message: 'at least one bounded search filter is required' });
    }
  });

  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };

  const input = parsed.data;
  return {
    ok: true,
    value: {
      provider: input.provider ?? config.defaultProvider,
      searchMode: input.search_mode,
      userId: input.user_id,
      revealEmail: input.reveal_email ?? true,
      revealPhone: input.reveal_phone ?? false,
      companyName: input.company_name,
      organizationDomains: input.selected_organization_id
        ? []
        : [...new Set([
          ...input.organization_domains,
          ...(input.selected_organization_domain ? [input.selected_organization_domain] : []),
        ])],
      selectedOrganizationId: input.selected_organization_id,
      selectedOrganizationName: input.selected_organization_name,
      selectedOrganizationDomain: input.selected_organization_domain,
      titles: input.titles,
      seniorities: input.seniorities,
      industryKeywords: input.industry_keywords,
      companyKeywords: input.company_keywords,
      companyLocations: input.company_location,
      personLocations: input.person_locations,
      employeeRanges: [...new Set([...input.employee_range, ...input.employee_ranges])],
      includeSimilarTitles: input.include_similar_titles,
      maxResults: Math.min(input.max_results ?? 50, config.maxSearchResults),
    },
  };
}

export function validateEnrichmentInput(value: unknown): ValidationResult<EnrichmentInput> {
  const leadSchema = z.object({
    id: optionalIdentifier(),
    source_provider_id: optionalIdentifier(),
    first_name: boundedText(100).optional(),
    last_name: boundedText(100).optional(),
    full_name: boundedText(200).optional(),
    linkedin_url: z.string().trim().max(500).optional()
      .refine((item) => item === undefined || validLinkedinUrl(item), 'must be a valid https LinkedIn URL'),
    organization_name: boundedText(200).optional(),
    organization_domain: boundedDomain().optional(),
  }).strict();

  const schema = z.object({
    record_id: optionalIdentifier(),
    table_name: z.enum(['enriched_opportunities', 'enriched_leads', 'people_search_leads']).optional(),
    lead: leadSchema,
    reveal_email: z.boolean().optional(),
    reveal_phone: z.boolean().optional(),
    revealEmail: z.boolean().optional(),
    revealPhone: z.boolean().optional(),
    enrichment_level: z.enum(['basic', 'deep']).optional(),
    requested_data: z.object({ email: z.boolean().optional(), phone: z.boolean().optional() }).strict().optional(),
    requested_fields: z.array(z.enum(['email', 'phone'])).max(2).optional(),
    match_only: z.boolean().optional().default(false),
    webhook_url: z.string().trim().max(2_000).optional()
      .refine((item) => item === undefined || validWebhookUrl(item), 'must be a public https URL'),
  }).strict();

  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };

  const input = parsed.data;
  const issues: Array<{ path: string; message: string }> = [];
  const revealEmail = input.reveal_email ?? input.revealEmail ?? true;
  const revealPhone = input.reveal_phone ?? input.revealPhone ?? false;

  if (input.reveal_email !== undefined && input.revealEmail !== undefined && input.reveal_email !== input.revealEmail) {
    issues.push({ path: 'reveal_email', message: 'conflicts with revealEmail' });
  }
  if (input.reveal_phone !== undefined && input.revealPhone !== undefined && input.reveal_phone !== input.revealPhone) {
    issues.push({ path: 'reveal_phone', message: 'conflicts with revealPhone' });
  }
  if (!revealEmail && !revealPhone && !input.match_only) {
    issues.push({ path: 'reveal_email', message: 'at least one enrichment field is required' });
  }
  if (input.match_only && !input.lead.linkedin_url) {
    issues.push({ path: 'match_only', message: 'requires a LinkedIn URL' });
  }
  if (revealPhone && !input.webhook_url) {
    issues.push({ path: 'webhook_url', message: 'is required when phone enrichment is requested' });
  }
  if (input.requested_data?.email !== undefined && input.requested_data.email !== revealEmail) {
    issues.push({ path: 'requested_data.email', message: 'must match reveal_email' });
  }
  if (input.requested_data?.phone !== undefined && input.requested_data.phone !== revealPhone) {
    issues.push({ path: 'requested_data.phone', message: 'must match reveal_phone' });
  }
  if (input.requested_fields) {
    if (input.requested_fields.includes('email') !== revealEmail) {
      issues.push({ path: 'requested_fields', message: 'must match requested email field' });
    }
    if (input.requested_fields.includes('phone') !== revealPhone) {
      issues.push({ path: 'requested_fields', message: 'must match requested phone field' });
    }
  }

  const enrichmentLevel = input.enrichment_level ?? (revealPhone ? 'deep' : 'basic');
  if ((enrichmentLevel === 'deep') !== revealPhone) {
    issues.push({ path: 'enrichment_level', message: 'must match the requested phone field' });
  }

  const lead = input.lead;
  if (!lead.id && !lead.source_provider_id && !lead.linkedin_url && !(lead.first_name && lead.organization_name)) {
    issues.push({ path: 'lead', message: 'a provider id, LinkedIn URL, or first name plus organization is required' });
  }

  if (issues.length > 0) return { ok: false, issues: issues.slice(0, 10) };

  return {
    ok: true,
    value: {
      recordId: input.record_id,
      tableName: input.table_name,
      lead: {
        id: input.lead.id,
        sourceProviderId: input.lead.source_provider_id,
        firstName: input.lead.first_name,
        lastName: input.lead.last_name,
        fullName: input.lead.full_name,
        linkedinUrl: input.lead.linkedin_url,
        organizationName: input.lead.organization_name,
        organizationDomain: input.lead.organization_domain,
      },
      revealEmail,
      revealPhone,
      enrichmentLevel,
      webhookUrl: input.webhook_url,
      matchOnly: input.match_only,
    },
  };
}

export function validateOrganizationEnrichmentInput(value: unknown): ValidationResult<OrganizationEnrichmentInput> {
  const parsed = z.object({ domain: boundedDomain() }).strict().safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesFrom(parsed.error) };
  return { ok: true, value: parsed.data };
}
