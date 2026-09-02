import type { GatewayConfig, GatewayEnvironment } from './gateway';
import type { EnrichmentInput, LeadSearchInput, OrganizationEnrichmentInput } from './validation';

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';

type JsonRecord = Record<string, unknown>;
type ApolloRequestOptions = {
  method?: 'GET' | 'POST';
  query?: URLSearchParams;
  body?: JsonRecord;
  acceptErrorPayload?: boolean;
};

export class ApolloGatewayError extends Error {
  constructor(
    readonly status: 429 | 502 | 503 | 504,
    readonly code:
      | 'APOLLO_PROVIDER_NOT_CONFIGURED'
      | 'APOLLO_CREDITS_EXHAUSTED'
      | 'APOLLO_RATE_LIMITED'
      | 'APOLLO_UPSTREAM_ERROR'
      | 'APOLLO_UPSTREAM_TIMEOUT'
      | 'APOLLO_UPSTREAM_INVALID_RESPONSE',
  ) {
    super(code);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function firstText(...values: unknown[]) {
  return values.map(asText).find(Boolean) || undefined;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function sanitizeUsageValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeUsageValue(item, depth + 1));
  const source = asRecord(value) || {};
  return Object.keys(source)
    .filter((key) => !/(api[_-]?key|token|secret|password|authorization|cookie)/i.test(key))
    .slice(0, 200)
    .reduce<JsonRecord>((result, key) => {
      result[key] = /(^|_)(email|phone|mobile)(_|$)/i.test(key)
        ? '[REDACTED]'
        : sanitizeUsageValue(source[key], depth + 1);
      return result;
    }, {});
}

function normalizeComparable(value: unknown) {
  return asText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const INDUSTRY_ALIASES: Record<string, string> = {
  'recursos humanos': 'human resources',
  tecnologia: 'technology',
  salud: 'healthcare',
  finanzas: 'finance',
  fabricacion: 'manufacturing',
  educacion: 'education',
  construccion: 'construction',
};

const INDUSTRY_TAG_IDS = Object.fromEntries(Object.entries({
  'Human Resources': '5567e0e37369640e5ac10c00',
  Technology: '5494458a746564006c840200',
  Healthcare: '5494458a746564006c840100',
  Finance: '5494458a746564006c840000',
  Manufacturing: '5494458a746564006c840300',
  Retail: '5567ced173696450cb580000',
  Education: '5494458a746564006c840500',
  Accounting: '5567ce1f7369643b78570000',
  'Architecture & Planning': '5567cdb77369645401080000',
  'Apparel & Fashion': '5567cd82736964540d0b0000',
  Automotive: '5567cdf27369644cfd800000',
  'Building Materials': '5567e1a17369641ea9d30100',
  Biotechnology: '5567d08e7369645dbc4b0000',
  'Environment Services': '5567ce5b736964540d280000',
  'Electrical/Electronic Manufacturing': '5567cd4c73696439c9030000',
  'Computer Software': '5567cd4e7369643b70010000',
  Entertainment: '5567cdd37369643b80510000',
  'Education Management': '5567ce9e736964540d540000',
  Construction: '5567cd4773696439dd350000',
  'Financial Services': '5567cdd67369643e64020000',
  'Government Administration': '5567cd527369643981050000',
  Hospitality: '5567ce9d7369643bc19c0000',
  'Health, Wellness & Fitness': '5567cddb7369644d250c0000',
  'Higher Education': '5567cd4c73696453e1300000',
  'Information Services': '5567e0c97369640d2b3b1600',
}).map(([name, id]) => [normalizeComparable(name), id])) as Record<string, string>;

function canonicalIndustry(value: unknown) {
  const normalized = normalizeComparable(value);
  return INDUSTRY_ALIASES[normalized] || normalized;
}

export function resolveApolloIndustryFilters(requestedIndustries: string[]) {
  const tagIds = new Set<string>();
  const keywordFallbacks = new Set<string>();

  for (const requestedIndustry of requestedIndustries) {
    const canonical = canonicalIndustry(requestedIndustry);
    const tagId = INDUSTRY_TAG_IDS[canonical];
    if (tagId) tagIds.add(tagId);
    else if (requestedIndustry.trim()) keywordFallbacks.add(requestedIndustry.trim());
  }

  return { tagIds: [...tagIds], keywordFallbacks: [...keywordFallbacks] };
}

function mapOrganization(value: unknown) {
  const organization = asRecord(value);
  if (!organization) return null;
  const id = firstText(organization.id);
  const name = firstText(organization.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    primary_domain: firstText(organization.primary_domain, organization.domain),
    website_url: firstText(organization.website_url),
    linkedin_url: firstText(organization.linkedin_url, organization.linkedin_url_clean),
    industry: firstText(organization.industry),
    estimated_num_employees: asNumber(organization.estimated_num_employees),
    city: firstText(organization.city),
    state: firstText(organization.state),
    country: firstText(organization.country),
    short_description: firstText(organization.short_description),
    founded_year: asNumber(organization.founded_year),
  };
}

function mapEnrichedOrganization(value: unknown) {
  const organization = asRecord(value);
  const base = mapOrganization(value);
  if (!organization || !base) return null;
  return {
    ...base,
    short_description: firstText(organization.short_description, organization.seo_description),
    keywords: asArray(organization.keywords).map(asText).filter(Boolean).slice(0, 100),
    annual_revenue: asNumber(organization.annual_revenue),
    total_funding: asNumber(organization.total_funding),
  };
}

function buildPhoneNumbers(person: JsonRecord) {
  const candidates: Array<{ value: unknown; type: string }> = [
    ...asArray(person.phone_numbers).map((value) => ({ value, type: 'phone' })),
    { value: person.phone_number, type: 'phone' },
    { value: person.mobile_phone, type: 'mobile' },
    { value: person.work_phone, type: 'work' },
  ];
  const unique = new Map<string, { raw_number: string; sanitized_number: string; type: string }>();

  for (const candidate of candidates) {
    const record = asRecord(candidate.value);
    const phone = record
      ? firstText(record.sanitized_number, record.raw_number, record.number, record.phone_number)
      : asText(candidate.value);
    if (!phone || phone.length > 64 || unique.has(phone)) continue;
    unique.set(phone, {
      raw_number: phone,
      sanitized_number: phone,
      type: firstText(record?.type, record?.type_cd) || candidate.type,
    });
    if (unique.size >= 10) break;
  }

  return [...unique.values()];
}

function mapPerson(
  value: unknown,
  options: {
    includeContact: boolean;
    organizations?: Array<NonNullable<ReturnType<typeof mapOrganization>>>;
  },
) {
  const person = asRecord(value);
  if (!person) return null;

  const organization = asRecord(person.organization) || {};
  const organizationId = firstText(organization.id, person.organization_id);
  const organizationName = firstText(organization.name, person.organization_name);
  const organizationContext = options.organizations?.find((candidate) => (
    (organizationId && candidate.id === organizationId)
    || (organizationName && normalizeComparable(candidate.name) === normalizeComparable(organizationName))
  ));
  const id = firstText(person.id, person.person_id, person.apollo_id, person.linkedin_url);
  if (!id) return null;

  const firstName = firstText(person.first_name);
  const lastName = firstText(person.last_name, person.last_name_obfuscated);
  const fullName = firstText(person.name, person.full_name, [firstName, lastName].filter(Boolean).join(' '));
  const organizationDomain = firstText(
    organization.primary_domain,
    organization.domain,
    person.organization_domain,
    organizationContext?.primary_domain,
  );
  const organizationIndustry = firstText(
    organization.industry,
    person.organization_industry,
    organizationContext?.industry,
  );
  const phoneNumbers = options.includeContact ? buildPhoneNumbers(person) : [];

  return {
    id,
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    email: options.includeContact ? firstText(person.email, person.work_email) : undefined,
    email_status: options.includeContact ? firstText(person.email_status) : undefined,
    has_email: asBoolean(person.has_email),
    has_direct_phone: asBoolean(person.has_direct_phone),
    title: firstText(person.title, person.headline),
    headline: firstText(person.headline),
    linkedin_url: firstText(person.linkedin_url),
    photo_url: firstText(person.photo_url, person.photoUrl),
    apollo_id: firstText(person.id, person.person_id, person.apollo_id),
    source_provider: 'apollo' as const,
    source_provider_id: firstText(person.id, person.person_id, person.apollo_id) || id,
    city: firstText(person.city),
    state: firstText(person.state),
    country: firstText(person.country),
    seniority: firstText(person.seniority),
    departments: asArray(person.departments).map(asText).filter(Boolean).slice(0, 20),
    primary_phone: options.includeContact
      ? firstText(person.phone_number, person.mobile_phone, person.work_phone) || phoneNumbers[0]?.sanitized_number
      : undefined,
    phone_numbers: phoneNumbers,
    organization_name: firstText(organization.name, person.organization_name, organizationContext?.name),
    organization_domain: organizationDomain,
    organization_industry: organizationIndustry,
    organization_size: asNumber(
      organization.estimated_num_employees
      ?? person.organization_size
      ?? organizationContext?.estimated_num_employees,
    ),
    organization: {
      id: firstText(organization.id, person.organization_id, organizationContext?.id),
      name: firstText(organization.name, person.organization_name, organizationContext?.name),
      domain: organizationDomain,
      industry: organizationIndustry,
      website_url: firstText(organization.website_url, person.organization_website, organizationContext?.website_url),
      linkedin_url: firstText(organization.linkedin_url, organizationContext?.linkedin_url),
      short_description: firstText(organization.short_description, organizationContext?.short_description),
    },
  };
}

async function requestApollo(
  path: string,
  apiKey: string,
  config: GatewayConfig,
  options: ApolloRequestOptions = {},
) {
  const url = new URL(`${APOLLO_BASE_URL}${path}`);
  if (options.query) {
    for (const [key, value] of options.query) url.searchParams.append(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);
  try {
    const method = options.method || 'POST';
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': apiKey,
        'Cache-Control': 'no-store',
      },
      ...(method === 'POST' ? { body: JSON.stringify(options.body || {}) } : {}),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new ApolloGatewayError(429, 'APOLLO_RATE_LIMITED');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
    }
    const record = asRecord(payload);
    if (!record) throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
    if (!response.ok) {
      if (options.acceptErrorPayload) return { ...record, http_status: response.status };
      const errorDetails = asRecord(record.error_details);
      if (firstText(errorDetails?.code, record.code) === 'BILLING.LIMIT.CREDITS_EXHAUSTED') {
        throw new ApolloGatewayError(429, 'APOLLO_CREDITS_EXHAUSTED');
      }
      throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_ERROR');
    }
    return record;
  } catch (error) {
    if (error instanceof ApolloGatewayError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new ApolloGatewayError(504, 'APOLLO_UPSTREAM_TIMEOUT');
    }
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

function appendAll(params: URLSearchParams, key: string, values: string[]) {
  for (const value of values) params.append(key, value);
}

async function searchPeople(params: {
  input: LeadSearchInput;
  domains?: string[];
  organizationIds?: string[];
  apiKey: string;
  config: GatewayConfig;
  organizations?: Array<NonNullable<ReturnType<typeof mapOrganization>>>;
}) {
  const organizationIdChunks = params.organizationIds?.length
    ? Array.from({ length: Math.ceil(params.organizationIds.length / 50) }, (_, index) => (
      params.organizationIds!.slice(index * 50, (index + 1) * 50)
    ))
    : [[]];
  const people = new Map<string, NonNullable<ReturnType<typeof mapPerson>>>();
  const industryFilters = resolveApolloIndustryFilters(params.input.industryKeywords);

  for (const organizationIds of organizationIdChunks) {
    const remaining = params.input.maxResults - people.size;
    if (remaining <= 0) break;

    const query = new URLSearchParams();
    query.set('per_page', String(Math.min(100, remaining)));
    query.set('page', '1');
    appendAll(query, 'person_titles[]', params.input.titles);
    if (params.input.titles.length > 0) query.set('include_similar_titles', String(params.input.includeSimilarTitles));
    appendAll(query, 'person_seniorities[]', params.input.seniorities);
    appendAll(query, 'person_locations[]', params.input.personLocations);
    appendAll(query, 'organization_locations[]', params.input.companyLocations);
    appendAll(query, 'organization_num_employees_ranges[]', params.input.employeeRanges);
    appendAll(query, 'q_organization_domains_list[]', params.domains || []);
    appendAll(query, 'organization_ids[]', organizationIds);
    appendAll(query, 'organization_industry_tag_ids[]', industryFilters.tagIds);
    appendAll(query, 'q_organization_keyword_tags[]', [
      ...params.input.companyKeywords,
      ...industryFilters.keywordFallbacks,
    ]);

    const payload = await requestApollo('/mixed_people/api_search', params.apiKey, params.config, { query });
    if (!Array.isArray(payload.people)) {
      throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
    }
    for (const value of payload.people) {
      const person = mapPerson(value, { includeContact: false, organizations: params.organizations });
      if (person && !people.has(person.id)) people.set(person.id, person);
      if (people.size >= params.input.maxResults) break;
    }
  }

  return [...people.values()];
}

async function findOrganizations(name: string, apiKey: string, config: GatewayConfig) {
  const query = new URLSearchParams();
  query.set('per_page', '5');
  query.set('page', '1');
  query.set('q_organization_name', name);
  const payload = await requestApollo('/mixed_companies/search', apiKey, config, { query });
  if (!Array.isArray(payload.organizations)) {
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
  }
  return payload.organizations
    .map(mapOrganization)
    .filter((organization): organization is NonNullable<typeof organization> => organization !== null);
}

export function getApolloApiKey(environment: GatewayEnvironment = process.env) {
  return String(environment.APOLLO_API_KEY || '').trim();
}

export async function executeApolloLeadSearch(input: LeadSearchInput, apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');

  if (input.searchMode === 'company_name') {
    const domains = [...input.organizationDomains];
    const organizationIds = input.selectedOrganizationId ? [input.selectedOrganizationId] : [];
    let candidates: Array<NonNullable<ReturnType<typeof mapOrganization>>> = [];

    if (domains.length === 0 && organizationIds.length === 0 && input.companyName) {
      candidates = await findOrganizations(input.companyName, apiKey, config);
      if (candidates.length === 0) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name' as const,
          company_name: input.companyName,
          organization_candidates: [],
          organization_search_credits: 1,
        };
      }
      if (candidates.length > 1) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name' as const,
          company_name: input.companyName,
          requires_organization_selection: true,
          organization_candidates: candidates,
          organization_search_credits: 1,
        };
      }
      if (candidates[0].primary_domain) domains.push(candidates[0].primary_domain);
      else organizationIds.push(candidates[0].id);
    }

    const organizationContext = candidates.length === 1 ? candidates : [];
    const leads = await searchPeople({
      input,
      domains,
      organizationIds,
      apiKey,
      config,
      organizations: organizationContext,
    });
    return {
      count: leads.length,
      leads,
      search_mode: 'company_name' as const,
      company_name: input.companyName || input.selectedOrganizationName,
      enrichment_requested: false,
      organization_search_credits: candidates.length > 0 ? 1 : 0,
      ...(organizationContext.length === 1 ? { selected_organization: organizationContext[0] } : {}),
    };
  }

  const leads = await searchPeople({
    input,
    domains: input.organizationDomains,
    organizationIds: input.selectedOrganizationId ? [input.selectedOrganizationId] : [],
    apiKey,
    config,
  });
  return {
    count: leads.length,
    leads,
    search_mode: 'batch' as const,
    search_strategy: 'people' as const,
    enrichment_requested: false,
    organization_search_credits: 0,
  };
}

export async function executeApolloEnrichment(input: EnrichmentInput, apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');

  const query = new URLSearchParams();
  const personId = input.lead.sourceProviderId || input.lead.id;
  if (personId) query.set('id', personId);
  if (input.lead.linkedinUrl) query.set('linkedin_url', input.lead.linkedinUrl);
  if (input.lead.firstName) query.set('first_name', input.lead.firstName);
  if (input.lead.lastName) query.set('last_name', input.lead.lastName);
  if (input.lead.fullName && !input.lead.firstName) query.set('name', input.lead.fullName);
  if (input.lead.organizationName) query.set('organization_name', input.lead.organizationName);
  if (input.lead.organizationDomain) query.set('domain', input.lead.organizationDomain);
  query.set('reveal_personal_emails', String(input.revealEmail));
  query.set('reveal_phone_number', String(input.revealPhone));
  query.set('run_waterfall_email', 'false');
  query.set('run_waterfall_phone', 'false');
  if (input.webhookUrl) query.set('webhook_url', input.webhookUrl);

  const payload = await requestApollo('/people/match', apiKey, config, { query });
  const lead = mapPerson(payload.person, { includeContact: true });
  const providerRequestId = firstText(payload.request_id, payload.requestId);
  if (!lead) {
    return {
      success: false,
      enrichment_status: 'not_found',
      provider_request_id: providerRequestId,
      credits_consumed: asNumber(payload.credits_consumed),
      extracted_data: null,
    };
  }

  const phoneNumbers = lead.phone_numbers || [];
  const pendingPhone = input.revealPhone && phoneNumbers.length === 0 && !lead.primary_phone && Boolean(providerRequestId);
  return {
    success: true,
    enrichment_status: pendingPhone ? 'pending_phone' : 'completed',
    provider_request_id: providerRequestId,
    credits_consumed: asNumber(payload.credits_consumed),
    extracted_data: {
      apollo_id: lead.apollo_id,
      source_provider: 'apollo',
      source_provider_id: lead.source_provider_id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      full_name: lead.name,
      email: input.revealEmail ? lead.email : null,
      email_status: input.revealEmail ? lead.email_status : null,
      title: lead.title,
      linkedin_url: lead.linkedin_url,
      organization_name: lead.organization_name,
      organization_domain: lead.organization_domain,
      organization_industry: lead.organization_industry,
      organization_size: lead.organization_size,
      organization: lead.organization,
      city: lead.city,
      state: lead.state,
      country: lead.country,
      headline: lead.headline,
      photo_url: lead.photo_url,
      seniority: lead.seniority,
      departments: lead.departments,
      primary_phone: input.revealPhone ? lead.primary_phone : null,
      phone_numbers: input.revealPhone ? phoneNumbers : [],
      enrichment_status: pendingPhone ? 'pending_phone' : 'completed',
    },
  };
}

export async function getApolloWebhookResult(requestId: string, apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');
  const normalizedRequestId = requestId.trim();
  if (!normalizedRequestId || normalizedRequestId.length > 255) {
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
  }

  const payload = await requestApollo(
    `/webhook_result/${encodeURIComponent(normalizedRequestId)}`,
    apiKey,
    config,
    { method: 'GET', acceptErrorPayload: true },
  );
  const result = asRecord(payload.result) || payload;
  const httpStatus = asNumber(payload.http_status);
  const fallbackStatus = httpStatus === 404 ? 'request_id_unknown'
    : httpStatus === 410 ? 'request_id_expired'
      : httpStatus === 400 ? 'invalid_request_id'
        : 'unknown';
  const person = mapPerson(result.person || payload.person, { includeContact: true });
  return {
    provider_request_id: firstText(payload.request_id, result.request_id, normalizedRequestId),
    status: firstText(payload.status, result.status, payload.code, result.code) || fallbackStatus,
    retry_after_seconds: asNumber(payload.retry_after_seconds ?? result.retry_after_seconds),
    candidate: person ? {
      apollo_person_id: person.apollo_id,
      email: person.email,
      email_status: person.email_status,
      primary_phone: person.primary_phone,
      phone_numbers: person.phone_numbers,
    } : null,
  };
}

export async function getApolloUsageSnapshot(apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');
  const [creditUsage, apiUsage, profile] = await Promise.all([
    requestApollo('/usage_stats/credit_usage_stats', apiKey, config),
    requestApollo('/usage_stats/api_usage_stats', apiKey, config),
    requestApollo('/users/api_profile?include_credit_usage=true', apiKey, config, { method: 'GET' }),
  ]);
  const user = asRecord(profile.user) || profile;
  const team = asRecord(profile.team) || asRecord(creditUsage.team) || {};
  return {
    captured_at: new Date().toISOString(),
    identity: {
      user_id: firstText(user.id, profile.user_id),
      team_id: firstText(team.id, profile.team_id, creditUsage.team_id),
    },
    credit_usage: sanitizeUsageValue(creditUsage),
    api_usage: sanitizeUsageValue(apiUsage),
    profile_credit_usage: sanitizeUsageValue(
      profile.credit_usage || profile.credit_usage_stats || profile.usage || profile.stats || {},
    ),
  };
}

export async function executeApolloOrganizationEnrichment(
  input: OrganizationEnrichmentInput,
  apiKey: string,
  config: GatewayConfig,
) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');
  const payload = await requestApollo('/organizations/enrich', apiKey, config, {
    method: 'GET',
    query: new URLSearchParams({ domain: input.domain }),
  });
  const organization = mapEnrichedOrganization(payload.organization || payload.data);
  return {
    provider: 'apollo' as const,
    status: organization ? 'completed' as const : 'no_data' as const,
    credits_consumed: Math.max(0, asNumber(payload.credits_consumed ?? payload.credits) || 0),
    organization,
  };
}
