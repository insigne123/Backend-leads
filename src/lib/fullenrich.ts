import type { GatewayConfig, GatewayEnvironment } from './gateway';
import type { LeadSearchInput } from './validation';

const FULLENRICH_BASE_URL = 'https://app.fullenrich.com/api/v2';

type JsonRecord = Record<string, unknown>;
type FullEnrichPath = '/people/search' | '/company/search' | '/people/lookup';

export class FullEnrichGatewayError extends Error {
  constructor(
    readonly status: 429 | 502 | 503 | 504,
    readonly code: 'FULLENRICH_PROVIDER_NOT_CONFIGURED' | 'FULLENRICH_RATE_LIMITED' | 'FULLENRICH_UPSTREAM_ERROR' | 'FULLENRICH_UPSTREAM_TIMEOUT' | 'FULLENRICH_UPSTREAM_INVALID_RESPONSE',
  ) {
    super(code);
  }
}

type FullEnrichTextFilter = {
  value: string;
  exact_match?: boolean;
  exclude?: boolean;
};

type FullEnrichRangeFilter = {
  min: number;
  max: number;
  exclude?: boolean;
};

type FullEnrichPeopleSearchRequest = {
  limit: number;
  current_position_titles?: FullEnrichTextFilter[];
  current_position_seniority_level?: FullEnrichTextFilter[];
  current_company_industries?: FullEnrichTextFilter[];
  current_company_specialties?: FullEnrichTextFilter[];
  current_company_headquarters?: FullEnrichTextFilter[];
  current_company_headcounts?: FullEnrichRangeFilter[];
  current_company_domains?: FullEnrichTextFilter[];
  current_company_ids?: FullEnrichTextFilter[];
  person_locations?: FullEnrichTextFilter[];
};

type FullEnrichCompanySearchRequest = {
  limit: number;
  names?: FullEnrichTextFilter[];
};

type FullEnrichPeopleLookupRequest = {
  person_name?: string;
  person_professional_network_url?: string;
  company_domain?: string;
};

type FullEnrichLocation = {
  city?: string;
  region?: string;
  country?: string;
};

type FullEnrichProfessionalNetwork = {
  url?: string;
};

type FullEnrichCompany = {
  id?: string;
  name?: string;
  domain?: string;
  website?: string;
  headcount?: number;
  industry?: { main_industry?: string };
  locations?: { headquarters?: FullEnrichLocation };
  social_profiles?: { professional_network?: FullEnrichProfessionalNetwork };
};

type FullEnrichPerson = {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  photo_url?: string;
  location?: FullEnrichLocation;
  social_profiles?: { professional_network?: FullEnrichProfessionalNetwork };
  employment?: {
    current?: {
      title?: string;
      seniority?: string;
      job_functions?: Array<{ function?: string; sub_function?: string }>;
      company?: FullEnrichCompany;
    };
  };
};

type FullEnrichPeopleResponse = {
  people: FullEnrichPerson[];
};

type FullEnrichCompanyResponse = {
  companies: FullEnrichCompany[];
};

type NormalizedOrganization = {
  id?: string;
  name?: string;
  domain?: string;
  industry?: string;
  website_url?: string;
  linkedin_url?: string;
};

type NormalizedOrganizationCandidate = {
  id: string;
  name: string;
  primary_domain?: string;
  website_url?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  city?: string;
  state?: string;
  country?: string;
};

type NormalizedLead = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_status?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  photo_url?: string;
  source_provider: 'fullenrich';
  source_provider_id: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments: string[];
  primary_phone?: string;
  phone_numbers: Array<{ raw_number: string; sanitized_number: string; type: string }>;
  organization_name?: string;
  organization_domain?: string;
  organization_industry?: string;
  organization_size?: number;
  organization: NormalizedOrganization;
};

export type FullEnrichLeadSearchResponse = {
  count: number;
  leads: NormalizedLead[];
  search_mode: LeadSearchInput['searchMode'];
  [key: string]: unknown;
};

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

function normalizeComparable(value: unknown) {
  return asText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function professionalNetwork(value: JsonRecord) {
  const socialProfiles = asRecord(value.social_profiles);
  return asRecord(socialProfiles?.professional_network) || {};
}

function mapFullEnrichOrganization(value: unknown): NormalizedOrganizationCandidate | null {
  const organization = asRecord(value);
  if (!organization) return null;

  const id = firstText(organization.id);
  const name = firstText(organization.name);
  if (!id || !name) return null;

  const locations = asRecord(organization.locations);
  const headquarters = asRecord(locations?.headquarters) || {};
  const industry = asRecord(organization.industry) || {};
  const network = professionalNetwork(organization);

  return {
    id,
    name,
    primary_domain: firstText(organization.domain),
    website_url: firstText(organization.website),
    linkedin_url: firstText(network.url),
    industry: firstText(industry.main_industry),
    estimated_num_employees: asNumber(organization.headcount),
    city: firstText(headquarters.city),
    state: firstText(headquarters.region),
    country: firstText(headquarters.country),
  };
}

function mapFullEnrichPerson(
  value: unknown,
  organizations: NormalizedOrganizationCandidate[] = [],
): NormalizedLead | null {
  const person = asRecord(value);
  if (!person) return null;

  const employment = asRecord(person.employment);
  const currentEmployment = asRecord(employment?.current) || {};
  const organization = asRecord(currentEmployment.company) || {};
  const organizationNetwork = professionalNetwork(organization);
  const personNetwork = professionalNetwork(person);
  const location = asRecord(person.location) || {};
  const industry = asRecord(organization.industry) || {};
  const organizationId = firstText(organization.id);
  const organizationName = firstText(organization.name);
  const organizationContext = organizations.find((candidate) => (
    (organizationId && candidate.id === organizationId)
    || (organizationName && normalizeComparable(candidate.name) === normalizeComparable(organizationName))
  ));
  const id = firstText(person.id, personNetwork.url);
  if (!id) return null;

  const firstName = firstText(person.first_name);
  const lastName = firstText(person.last_name);
  const fullName = firstText(person.full_name, [firstName, lastName].filter(Boolean).join(' '));
  const organizationDomain = firstText(organization.domain, organizationContext?.primary_domain);
  const organizationIndustry = firstText(industry.main_industry, organizationContext?.industry);
  const departments = asArray(currentEmployment.job_functions)
    .map((value) => {
      const jobFunction = asRecord(value);
      return firstText(jobFunction?.function, jobFunction?.sub_function) || '';
    })
    .filter(Boolean)
    .slice(0, 20);

  return {
    id,
    source_provider: 'fullenrich',
    source_provider_id: id,
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    title: firstText(currentEmployment.title),
    headline: firstText(person.headline),
    linkedin_url: firstText(personNetwork.url),
    photo_url: firstText(person.photo_url),
    city: firstText(location.city),
    state: firstText(location.region),
    country: firstText(location.country),
    seniority: firstText(currentEmployment.seniority),
    departments,
    phone_numbers: [],
    organization_name: firstText(organization.name, organizationContext?.name),
    organization_domain: organizationDomain,
    organization_industry: organizationIndustry,
    organization_size: asNumber(organization.headcount ?? organizationContext?.estimated_num_employees),
    organization: {
      id: firstText(organization.id, organizationContext?.id),
      name: firstText(organization.name, organizationContext?.name),
      domain: organizationDomain,
      industry: organizationIndustry,
      website_url: firstText(organization.website, organizationContext?.website_url),
      linkedin_url: firstText(organizationNetwork.url, organizationContext?.linkedin_url),
    },
  };
}

function textFilters(values: string[], exactMatch = false): FullEnrichTextFilter[] | undefined {
  return values.length > 0
    ? values.map((value) => ({ value, exact_match: exactMatch }))
    : undefined;
}

function headcountFilters(ranges: string[]): FullEnrichRangeFilter[] | undefined {
  const filters: FullEnrichRangeFilter[] = [];
  for (const range of ranges) {
    const [minimum, maximum] = range.split(',').map(Number);
    if (Number.isInteger(minimum) && Number.isInteger(maximum) && minimum >= 0 && maximum >= minimum) {
      filters.push({ min: minimum, max: maximum });
    }
  }
  return filters.length > 0 ? filters : undefined;
}

function buildPeopleSearchRequest(input: LeadSearchInput, params: {
  domains?: string[];
  organizationIds?: string[];
} = {}): FullEnrichPeopleSearchRequest {
  return {
    limit: input.maxResults,
    current_position_titles: textFilters(input.titles, !input.includeSimilarTitles),
    current_position_seniority_level: textFilters(input.seniorities),
    current_company_industries: textFilters(input.industryKeywords),
    current_company_specialties: textFilters(input.companyKeywords),
    current_company_headquarters: textFilters(input.companyLocations),
    current_company_headcounts: headcountFilters(input.employeeRanges),
    current_company_domains: textFilters(params.domains || [], true),
    current_company_ids: textFilters(params.organizationIds || [], true),
    person_locations: textFilters(input.personLocations),
  };
}

function peopleResponse(payload: JsonRecord): FullEnrichPeopleResponse {
  if (!Array.isArray(payload.people)) {
    throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_INVALID_RESPONSE');
  }
  return { people: payload.people as FullEnrichPerson[] };
}

function companyResponse(payload: JsonRecord): FullEnrichCompanyResponse {
  if (!Array.isArray(payload.companies)) {
    throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_INVALID_RESPONSE');
  }
  return { companies: payload.companies as FullEnrichCompany[] };
}

async function requestFullEnrich(
  path: FullEnrichPath,
  payload: object,
  apiKey: string,
  config: GatewayConfig,
): Promise<JsonRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);

  try {
    const response = await fetch(`${FULLENRICH_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new FullEnrichGatewayError(429, 'FULLENRICH_RATE_LIMITED');
    }
    if (!response.ok) {
      throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_ERROR');
    }

    let responsePayload: unknown;
    try {
      responsePayload = await response.json();
    } catch {
      throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_INVALID_RESPONSE');
    }

    const record = asRecord(responsePayload);
    if (!record) {
      throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_INVALID_RESPONSE');
    }
    return record;
  } catch (error) {
    if (error instanceof FullEnrichGatewayError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new FullEnrichGatewayError(504, 'FULLENRICH_UPSTREAM_TIMEOUT');
    }
    throw new FullEnrichGatewayError(502, 'FULLENRICH_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

async function searchPeople(params: {
  input: LeadSearchInput;
  domains?: string[];
  organizationIds?: string[];
  apiKey: string;
  config: GatewayConfig;
  organizations?: NormalizedOrganizationCandidate[];
}) {
  const payload = buildPeopleSearchRequest(params.input, {
    domains: params.domains,
    organizationIds: params.organizationIds,
  });
  const response = peopleResponse(await requestFullEnrich('/people/search', payload, params.apiKey, params.config));
  const leads = new Map<string, NormalizedLead>();

  for (const value of response.people) {
    const lead = mapFullEnrichPerson(value, params.organizations);
    if (lead && !leads.has(lead.id)) leads.set(lead.id, lead);
    if (leads.size >= params.input.maxResults) break;
  }

  return [...leads.values()];
}

async function findOrganizations(name: string, apiKey: string, config: GatewayConfig) {
  const payload: FullEnrichCompanySearchRequest = {
    limit: 5,
    names: textFilters([name]),
  };
  const response = companyResponse(await requestFullEnrich('/company/search', payload, apiKey, config));
  return response.companies
    .map(mapFullEnrichOrganization)
    .filter((organization): organization is NormalizedOrganizationCandidate => organization !== null);
}

export function getFullEnrichApiKey(environment: GatewayEnvironment = process.env) {
  return String(environment.FULLENRICH_API_KEY || '').trim();
}

export async function executeFullEnrichLeadSearch(
  input: LeadSearchInput,
  apiKey: string,
  config: GatewayConfig,
): Promise<FullEnrichLeadSearchResponse> {
  if (!apiKey) throw new FullEnrichGatewayError(503, 'FULLENRICH_PROVIDER_NOT_CONFIGURED');

  if (input.searchMode === 'linkedin_profile') {
    const payload: FullEnrichPeopleLookupRequest = {
      person_professional_network_url: input.linkedinUrl!,
    };
    const response = peopleResponse(await requestFullEnrich('/people/lookup', payload, apiKey, config));
    const matchedLead = mapFullEnrichPerson(response.people[0]);
    const lead = matchedLead && {
      ...matchedLead,
      email: undefined,
      email_status: undefined,
      primary_phone: undefined,
      phone_numbers: [],
    };

    return {
      count: lead ? 1 : 0,
      leads: lead ? [lead] : [],
      search_mode: 'linkedin_profile',
      requested_reveal: { email: input.revealEmail, phone: input.revealPhone },
      // Search API v2 does not reveal contact data, so do not imply it did.
      applied_reveal: { email: false, phone: false },
      effective_reveal: { email: false, phone: false },
    };
  }

  if (input.searchMode === 'company_name') {
    const domains = [...input.organizationDomains];
    const organizationIds = input.selectedOrganizationId ? [input.selectedOrganizationId] : [];
    let candidates: NormalizedOrganizationCandidate[] = [];

    if (domains.length === 0 && organizationIds.length === 0 && input.companyName) {
      candidates = await findOrganizations(input.companyName, apiKey, config);
      if (candidates.length === 0) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name',
          company_name: input.companyName,
          organization_candidates: [],
        };
      }
      if (candidates.length > 1) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name',
          company_name: input.companyName,
          requires_organization_selection: true,
          organization_candidates: candidates,
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
      search_mode: 'company_name',
      company_name: input.companyName || input.selectedOrganizationName,
      enrichment_requested: false,
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
    search_mode: 'batch',
    search_strategy: 'people',
    enrichment_requested: false,
  };
}
