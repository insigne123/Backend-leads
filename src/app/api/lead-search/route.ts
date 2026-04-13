import { NextResponse } from 'next/server';
import { getServiceSupabase, supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_APOLLO_WEBHOOK_BASE_URL = process.env.APOLLO_WEBHOOK_BASE_URL?.trim() || '';
const LINKEDIN_PROFILE_TABLE_NAME = 'people_search_leads';
const MAX_LEAD_SEARCH_RESULTS = 50;
const LEAD_SEARCH_CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

type SearchMode = 'batch' | 'linkedin_profile' | 'company_name';

// Types for the request body
interface LeadSearchRequest {
    user_id: string; // Added user_id
    search_mode?: SearchMode;
    searchMode?: SearchMode | string;
    linkedin_url?: string;
    linkedin_profile_url?: string;
    linkedinUrl?: string;
    linkedinProfileUrl?: string;
    company_name?: string;
    companyName?: string;
    organization_domains?: string[] | string;
    organizationDomains?: string[] | string;
    organization_domain_list?: string[] | string;
    organizationDomainList?: string[] | string;
    organization_domain?: string;
    organizationDomain?: string;
    company_domain?: string;
    companyDomain?: string;
    selected_organization_id?: string;
    selectedOrganizationId?: string;
    selected_organization_name?: string;
    selectedOrganizationName?: string;
    selected_organization_domain?: string;
    selectedOrganizationDomain?: string;
    selected_organization_website?: string;
    selectedOrganizationWebsite?: string;
    selected_organization_industry?: string;
    selectedOrganizationIndustry?: string;
    selected_organization_size?: number | string;
    selectedOrganizationSize?: number | string;
    include_similar_titles?: boolean | string | number;
    includeSimilarTitles?: boolean | string | number;
    reveal_email?: boolean | string | number;
    reveal_phone?: boolean | string | number;
    revealEmail?: boolean | string | number;
    revealPhone?: boolean | string | number;
    industry_keywords?: string[];
    company_keyword_tags?: string[];
    company_location?: string[];
    titles?: string[];
    seniorities?: string[];
    employee_ranges?: string[];
    employeeRanges?: string[] | string;
    employee_range?: string[] | string;
    employeeRange?: string[] | string;
    max_results?: number | string;
    companies_only?: boolean;
    resume_search_progress?: boolean | string | number;
    resumeSearchProgress?: boolean | string | number;
}

// Apollo API Types (Simplified)
interface ApolloCompany {
    id: string;
    name: string;
    primary_domain: string;
    website_url?: string;
    linkedin_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    city?: string;
    state?: string;
    country?: string;
    naics_codes?: string[];
    sic_codes?: string[];
    owned_by_organization_id?: string;
    owned_by_organization?: {
        id?: string;
        name?: string;
        website_url?: string;
        primary_domain?: string;
        industry?: string;
        estimated_num_employees?: number;
    };
}

interface ApolloPerson {
    id: string;
    first_name?: string;
    last_name?: string;
    last_name_obfuscated?: string;
    email?: string;
    linkedin_url?: string;
    organization?: {
        id?: string | null;
        name?: string | null;
        primary_domain?: string | null;
        website_url?: string | null;
        industry?: string | null;
        estimated_num_employees?: number | null;
    };
    organization_id?: string | null;
    organization_name?: string | null;
    organization_domain?: string | null;
    organization_website?: string | null;
    organization_industry?: string | null;
    organization_size?: number | null;
    title?: string;
}

type LinkedInRevealPreferences = {
    revealEmail: boolean;
    revealPhone: boolean;
};

type LinkedInLookupResult = {
    apolloResponse: any | null;
    error: string | null;
    details: string | null;
    appliedReveal: LinkedInRevealPreferences;
    providerWarnings: string[];
};

type PhoneEnrichmentQueueResult = {
    requested: boolean;
    queued: boolean;
    status: 'not_requested' | 'queued' | 'skipped' | 'failed';
    message: string | null;
    webhook_url: string | null;
    provider_status: number | null;
    provider_details: string | null;
};

type OrganizationCandidate = {
    id: string;
    name: string;
    primary_domain: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    match_score: number;
};

type OrganizationFallback = {
    id: string | null;
    name: string | null;
    primary_domain: string | null;
    website_url: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
};

type SparseLeadSummary = {
    missing_organization_id_count: number;
    missing_organization_domain_count: number;
    missing_organization_industry_count: number;
    missing_email_count: number;
    warnings: string[];
};

type SelectedOrganizationRequest = {
    id: string;
    name: string | null;
    primary_domain: string | null;
    website_url: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
};

type OrganizationHydrationCache = {
    byDomain: Map<string, OrganizationCandidate | null>;
};

function getServerSupabase(log?: (msg: string, data?: any) => void) {
    try {
        return getServiceSupabase();
    } catch (error: any) {
        log?.('Warning: Missing service role key. Falling back to anonymous Supabase client.', {
            error: error?.message || String(error),
        });
        return supabase;
    }
}

function normalizeRequestedMode(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function resolveSearchMode(body: LeadSearchRequest): SearchMode {
    const mode = normalizeRequestedMode(body.search_mode ?? body.searchMode);

    if (mode === 'linkedin_profile' || mode === 'linkedin' || mode === 'profile') {
        return 'linkedin_profile';
    }

    if (mode === 'company_name' || mode === 'company' || mode === 'organization') {
        return 'company_name';
    }

    if (mode === 'batch') {
        return 'batch';
    }

    const linkedinUrlCandidate =
        body.linkedin_url ||
        body.linkedin_profile_url ||
        body.linkedinUrl ||
        body.linkedinProfileUrl ||
        '';

    const hasLinkedInUrl = typeof linkedinUrlCandidate === 'string' && linkedinUrlCandidate.trim() !== '';
    if (hasLinkedInUrl) return 'linkedin_profile';

    const companyNameCandidate = body.company_name || body.companyName || '';
    const organizationDomains = resolveOrganizationDomains(body);
    const selectedOrganizationId = body.selected_organization_id || body.selectedOrganizationId || '';

    if (
        (typeof companyNameCandidate === 'string' && companyNameCandidate.trim() !== '') ||
        organizationDomains.length > 0 ||
        (typeof selectedOrganizationId === 'string' && selectedOrganizationId.trim() !== '')
    ) {
        return 'company_name';
    }

    return 'batch';
}

function normalizeLinkedInProfileUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        throw new Error('Missing linkedin_url for LinkedIn profile search mode');
    }

    const normalizedInput = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    let parsed: URL;
    try {
        parsed = new URL(normalizedInput);
    } catch {
        throw new Error('Invalid linkedin_url format');
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLinkedInHost = hostname === 'linkedin.com' || hostname === 'www.linkedin.com' || hostname.endsWith('.linkedin.com');
    if (!isLinkedInHost) {
        throw new Error('linkedin_url must belong to linkedin.com');
    }

    const path = parsed.pathname.replace(/\/+$/, '');
    const normalizedPath = path.toLowerCase();
    const isProfilePath =
        normalizedPath.startsWith('/in/') ||
        normalizedPath.startsWith('/pub/') ||
        normalizedPath.startsWith('/sales/lead/');

    if (!path || path === '' || !isProfilePath) {
        throw new Error('linkedin_url must include a profile path');
    }

    parsed.search = '';
    parsed.hash = '';

    return parsed.toString().replace(/\/+$/, '');
}

function parseBooleanFlag(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    }

    return null;
}

function resolveLinkedInRevealPreferences(body: LeadSearchRequest): LinkedInRevealPreferences {
    const revealEmail = parseBooleanFlag(body.reveal_email ?? body.revealEmail);
    const revealPhone = parseBooleanFlag(body.reveal_phone ?? body.revealPhone);

    return {
        revealEmail: revealEmail ?? true,
        revealPhone: revealPhone ?? true,
    };
}

function extractPeopleCandidatesFromApolloResponse(response: any): ApolloPerson[] {
    const candidates: ApolloPerson[] = [];

    const pushCandidate = (entry: any) => {
        if (!entry || typeof entry !== 'object') return;
        if (!entry.id) return;
        candidates.push(entry as ApolloPerson);
    };

    if (response?.person && typeof response.person === 'object') {
        pushCandidate(response.person);
    }

    if (Array.isArray(response?.matches)) {
        for (const entry of response.matches) {
            pushCandidate(entry);
        }
    }

    if (Array.isArray(response?.people)) {
        for (const entry of response.people) {
            pushCandidate(entry);
        }
    }

    if (response && typeof response === 'object' && response.id) {
        pushCandidate(response);
    }

    const deduped = new Map<string, ApolloPerson>();
    for (const candidate of candidates) {
        const id = candidate.id?.toString?.() || '';
        if (!id) continue;
        if (!deduped.has(id)) deduped.set(id, candidate);
    }

    return Array.from(deduped.values());
}

function extractPersonFromApolloResponse(response: any): ApolloPerson | null {
    const candidates = extractPeopleCandidatesFromApolloResponse(response);
    return candidates[0] || null;
}

function normalizeEmail(value: any): string | null {
    if (typeof value !== 'string') return null;

    const email = value.trim();
    if (!email) return null;
    if (email.toLowerCase().startsWith('email_not_unlocked@')) return null;

    return email;
}

function normalizePhoneNumbers(value: unknown): any[] | null {
    if (!Array.isArray(value)) return null;

    const phoneNumbers = value.filter(Boolean);
    return phoneNumbers.length > 0 ? phoneNumbers : null;
}

function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolvePrimaryPhoneFromLead(lead: any): string | null {
    if (typeof lead?.primary_phone === 'string' && lead.primary_phone.trim()) {
        return lead.primary_phone.trim();
    }

    if (!Array.isArray(lead?.phone_numbers) || lead.phone_numbers.length === 0) {
        return null;
    }

    const mobile = lead.phone_numbers.find((phone: any) => {
        const type = (phone?.type || phone?.type_cd || '').toString().toLowerCase();
        return type.includes('mobile');
    });

    const selected = mobile || lead.phone_numbers[0];
    const rawValue = selected?.sanitized_number || selected?.number || selected?.raw_number || null;

    if (typeof rawValue !== 'string') return null;

    const value = rawValue.trim();
    return value || null;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return Array.from(
        new Set(
            value
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter(Boolean)
        )
    );
}

function normalizeFlexibleStringArray(value: unknown): string[] {
    const rawValues: string[] = [];

    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === 'string') {
                rawValues.push(entry);
            } else if (typeof entry === 'number' && Number.isFinite(entry)) {
                rawValues.push(String(entry));
            }
        }
    } else if (typeof value === 'string') {
        rawValues.push(...value.split(','));
    } else if (typeof value === 'number' && Number.isFinite(value)) {
        rawValues.push(String(value));
    }

    return Array.from(
        new Set(
            rawValues
                .map((entry) => entry.trim())
                .filter(Boolean)
        )
    );
}

function parseOptionalNumberish(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveMaxResults(value: unknown): number {
    const parsed = parseOptionalNumberish(value);
    if (parsed === null) return MAX_LEAD_SEARCH_RESULTS;

    return Math.min(Math.max(Math.floor(parsed), 1), MAX_LEAD_SEARCH_RESULTS);
}

function normalizeDomain(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';

    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(withProtocol);
        return parsed.hostname.replace(/^www\./, '').trim().toLowerCase();
    } catch {
        return trimmed
            .replace(/^https?:\/\//i, '')
            .split('/')[0]
            .replace(/^www\./, '')
            .trim()
            .toLowerCase();
    }
}

function isLowSignalOrganizationDomain(domain: string): boolean {
    const normalized = normalizeDomain(domain);
    if (!normalized) return true;

    const blockedDomains = new Set([
        'linktr.ee',
        'linkedin.com',
        'facebook.com',
        'instagram.com',
        'twitter.com',
        'x.com',
        'youtube.com',
        'tiktok.com',
        'medium.com',
        'substack.com',
        'beacons.ai',
    ]);

    return blockedDomains.has(normalized);
}

function inferIndustryFromClassificationCodes(company: Pick<ApolloCompany, 'naics_codes' | 'sic_codes'>): string | null {
    const naicsCodes = Array.isArray(company.naics_codes)
        ? company.naics_codes.filter((code): code is string => typeof code === 'string')
        : [];
    const sicCodes = Array.isArray(company.sic_codes)
        ? company.sic_codes.filter((code): code is string => typeof code === 'string')
        : [];

    const firstNaics = naicsCodes[0]?.trim() || '';
    const firstSic = sicCodes[0]?.trim() || '';

    if (/^(48|49)/.test(firstNaics)) return 'transportation and warehousing';
    if (/^(44|45)/.test(firstNaics)) return 'retail';
    if (/^42/.test(firstNaics)) return 'wholesale';
    if (/^51/.test(firstNaics)) return 'information services';
    if (/^52/.test(firstNaics)) return 'financial services';
    if (/^54/.test(firstNaics)) return 'professional services';
    if (/^56/.test(firstNaics)) return 'administrative services';
    if (/^61/.test(firstNaics)) return 'education';
    if (/^62/.test(firstNaics)) return 'healthcare';

    if (/^45/.test(firstSic)) return 'transportation';
    if (/^59/.test(firstSic)) return 'retail';
    if (/^73/.test(firstSic)) return 'business services';
    if (/^80/.test(firstSic)) return 'healthcare';

    return null;
}

function normalizeDomainArray(value: unknown): string[] {
    const rawValues: string[] = [];

    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === 'string') rawValues.push(entry);
        }
    } else if (typeof value === 'string') {
        rawValues.push(...value.split(','));
    }

    return Array.from(
        new Set(
            rawValues
                .map((entry) => normalizeDomain(entry))
                .filter(Boolean)
        )
    );
}

function resolveOrganizationDomains(body: LeadSearchRequest): string[] {
    const values = [
        body.organization_domains,
        body.organizationDomains,
        body.organization_domain_list,
        body.organizationDomainList,
        body.organization_domain,
        body.organizationDomain,
        body.company_domain,
        body.companyDomain,
    ];

    const domains = values.flatMap((value) => normalizeDomainArray(value));
    return Array.from(new Set(domains));
}

function resolveEmployeeRanges(body: LeadSearchRequest): string[] {
    const values = [
        body.employee_ranges,
        body.employeeRanges,
        body.employee_range,
        body.employeeRange,
    ];

    const ranges = values.flatMap((value) => normalizeFlexibleStringArray(value));
    return Array.from(new Set(ranges));
}

function candidateMatchesAnyDomain(candidate: OrganizationCandidate, domains: string[]): boolean {
    if (domains.length === 0) return true;

    const primaryDomain = normalizeDomain(candidate.primary_domain || '');
    const websiteDomain = normalizeDomain(candidate.website_url || '');

    return domains.some((domain) => primaryDomain === domain || websiteDomain === domain);
}

function normalizeCompanyName(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function toOrganizationFallback(
    value: Pick<ApolloCompany, 'id' | 'name' | 'primary_domain' | 'website_url' | 'industry' | 'estimated_num_employees'>
): OrganizationFallback {
    return {
        id: normalizeOptionalString(value.id),
        name: normalizeOptionalString(value.name),
        primary_domain: normalizeOptionalString(value.primary_domain),
        website_url: normalizeOptionalString(value.website_url),
        industry: normalizeOptionalString(value.industry),
        estimated_num_employees: normalizeOptionalNumber(value.estimated_num_employees),
    };
}

function toOrganizationFallbackFromCandidate(candidate: OrganizationCandidate): OrganizationFallback {
    return {
        id: normalizeOptionalString(candidate.id),
        name: normalizeOptionalString(candidate.name),
        primary_domain: normalizeOptionalString(candidate.primary_domain),
        website_url: normalizeOptionalString(candidate.website_url),
        industry: normalizeOptionalString(candidate.industry),
        estimated_num_employees: normalizeOptionalNumber(candidate.estimated_num_employees),
    };
}

function buildOrganizationFallbackMap(companies: ApolloCompany[]): Map<string, OrganizationFallback> {
    const map = new Map<string, OrganizationFallback>();

    for (const company of companies) {
        const fallback = toOrganizationFallback(company);
        if (!fallback.id) continue;
        map.set(fallback.id, fallback);
    }

    return map;
}

function normalizeCompanyToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveSelectedOrganizationId(body: LeadSearchRequest): string {
    const value = body.selected_organization_id || body.selectedOrganizationId || '';
    if (typeof value !== 'string') return '';
    return value.trim();
}

function resolveSelectedOrganizationRequest(
    body: LeadSearchRequest,
    fallbackCompanyName: string
): SelectedOrganizationRequest | null {
    const id = resolveSelectedOrganizationId(body);
    if (!id) return null;

    const name = normalizeOptionalString(
        body.selected_organization_name ?? body.selectedOrganizationName ?? fallbackCompanyName
    );
    const domain = normalizeOptionalString(
        body.selected_organization_domain ?? body.selectedOrganizationDomain
    );
    const website = normalizeOptionalString(
        body.selected_organization_website ?? body.selectedOrganizationWebsite
    );

    return {
        id,
        name,
        primary_domain: domain ? normalizeDomain(domain) : null,
        website_url: website,
        industry: normalizeOptionalString(
            body.selected_organization_industry ?? body.selectedOrganizationIndustry
        ),
        estimated_num_employees: parseOptionalNumberish(
            body.selected_organization_size ?? body.selectedOrganizationSize
        ),
    };
}

function toOrganizationCandidateFromSelectedRequest(
    selectedOrganization: SelectedOrganizationRequest
): OrganizationCandidate {
    return {
        id: selectedOrganization.id,
        name: selectedOrganization.name || 'Selected organization',
        primary_domain: selectedOrganization.primary_domain,
        website_url: selectedOrganization.website_url,
        linkedin_url: null,
        industry: selectedOrganization.industry,
        estimated_num_employees: selectedOrganization.estimated_num_employees,
        city: null,
        state: null,
        country: null,
        match_score: selectedOrganization.name ? 100 : 0,
    };
}

function mergeOrganizationCandidate(
    base: OrganizationCandidate,
    overlay: Partial<OrganizationCandidate> | null | undefined
): OrganizationCandidate {
    if (!overlay) return base;

    return {
        id: overlay.id || base.id,
        name: overlay.name || base.name,
        primary_domain: overlay.primary_domain || base.primary_domain,
        website_url: overlay.website_url || base.website_url,
        linkedin_url: overlay.linkedin_url || base.linkedin_url,
        industry: overlay.industry || base.industry,
        estimated_num_employees:
            normalizeOptionalNumber(overlay.estimated_num_employees) ?? base.estimated_num_employees,
        city: overlay.city || base.city,
        state: overlay.state || base.state,
        country: overlay.country || base.country,
        match_score: Math.max(base.match_score, normalizeOptionalNumber(overlay.match_score) ?? 0),
    };
}

function mergeApolloCompanyWithCandidate(
    company: ApolloCompany,
    candidate: OrganizationCandidate
): ApolloCompany {
    const preferCandidatePrimaryDomain =
        !normalizeDomain(company.primary_domain || '') ||
        isLowSignalOrganizationDomain(company.primary_domain || '');
    const preferCandidateWebsite =
        !normalizeDomain(company.website_url || '') ||
        isLowSignalOrganizationDomain(company.website_url || '');

    return {
        ...company,
        id: company.id || candidate.id,
        name: company.name || candidate.name,
        primary_domain: preferCandidatePrimaryDomain
            ? candidate.primary_domain || company.primary_domain || ''
            : company.primary_domain || candidate.primary_domain || '',
        website_url: preferCandidateWebsite
            ? candidate.website_url || company.website_url || undefined
            : company.website_url || candidate.website_url || undefined,
        linkedin_url: company.linkedin_url || candidate.linkedin_url || undefined,
        industry: company.industry || candidate.industry || undefined,
        estimated_num_employees:
            normalizeOptionalNumber(company.estimated_num_employees) ??
            candidate.estimated_num_employees ??
            undefined,
        city: company.city || candidate.city || undefined,
        state: company.state || candidate.state || undefined,
        country: company.country || candidate.country || undefined,
    };
}

function pickMatchingOrganizationCandidate(
    candidates: OrganizationCandidate[],
    target: Pick<OrganizationCandidate, 'id' | 'name' | 'primary_domain'>
): OrganizationCandidate | null {
    if (candidates.length === 0) return null;

    const normalizedTargetId = normalizeOptionalString(target.id);
    const normalizedTargetDomain = normalizeDomain(target.primary_domain || '');
    const normalizedTargetName = normalizeCompanyToken(target.name || '');

    if (normalizedTargetId) {
        const exactIdMatch = candidates.find((candidate) => candidate.id === normalizedTargetId);
        if (exactIdMatch) return exactIdMatch;
    }

    if (normalizedTargetDomain) {
        const exactDomainMatch = candidates.find((candidate) => {
            const primaryDomain = normalizeDomain(candidate.primary_domain || '');
            const websiteDomain = normalizeDomain(candidate.website_url || '');
            return primaryDomain === normalizedTargetDomain || websiteDomain === normalizedTargetDomain;
        });
        if (exactDomainMatch) return exactDomainMatch;
    }

    if (normalizedTargetName) {
        const exactNameMatch = candidates.find(
            (candidate) => normalizeCompanyToken(candidate.name) === normalizedTargetName
        );
        if (exactNameMatch) return exactNameMatch;
    }

    return candidates[0] || null;
}

function resolveIncludeSimilarTitles(body: LeadSearchRequest, searchMode: SearchMode): boolean | undefined {
    const explicit = parseBooleanFlag(body.include_similar_titles ?? body.includeSimilarTitles);
    if (explicit !== null) return explicit;

    if (searchMode === 'company_name') {
        return false;
    }

    return undefined;
}

function toOrganizationCandidate(
    company: any,
    companyNameQuery: string,
    preferredDomains: string[] = []
): OrganizationCandidate | null {
    const id = (company?.id || '').toString().trim();
    const name = (company?.name || '').toString().trim();
    if (!id || !name) return null;

    const rawPrimaryDomain = typeof company?.primary_domain === 'string' ? company.primary_domain.trim() : null;
    const rawWebsiteUrl = typeof company?.website_url === 'string' ? company.website_url.trim() : null;
    const ownerWebsiteUrl =
        typeof company?.owned_by_organization?.website_url === 'string'
            ? company.owned_by_organization.website_url.trim()
            : null;
    const ownerPrimaryDomain =
        typeof company?.owned_by_organization?.primary_domain === 'string'
            ? company.owned_by_organization.primary_domain.trim()
            : null;
    const ownerDomain = normalizeDomain(ownerPrimaryDomain || ownerWebsiteUrl || '');
    const normalizedRawPrimaryDomain = normalizeDomain(rawPrimaryDomain || '');
    const shouldReplacePrimaryDomain = !normalizedRawPrimaryDomain || isLowSignalOrganizationDomain(normalizedRawPrimaryDomain);
    const primaryDomain = shouldReplacePrimaryDomain && ownerDomain
        ? ownerDomain
        : rawPrimaryDomain;
    const websiteUrl = (shouldReplacePrimaryDomain && ownerWebsiteUrl) || rawWebsiteUrl;
    const linkedinUrl = typeof company?.linkedin_url === 'string' ? company.linkedin_url.trim() : null;
    const industry =
        normalizeOptionalString(company?.industry) ||
        normalizeOptionalString(company?.owned_by_organization?.industry) ||
        inferIndustryFromClassificationCodes(company);
    const city = typeof company?.city === 'string' ? company.city.trim() : null;
    const state = typeof company?.state === 'string' ? company.state.trim() : null;
    const country = typeof company?.country === 'string' ? company.country.trim() : null;
    const employees =
        normalizeOptionalNumber(company?.estimated_num_employees) ||
        normalizeOptionalNumber(company?.owned_by_organization?.estimated_num_employees);

    const normalizedQuery = normalizeCompanyToken(companyNameQuery);
    const normalizedName = normalizeCompanyToken(name);
    const normalizedDomain = normalizeCompanyToken(primaryDomain || '');
    const normalizedPrimaryDomain = normalizeDomain(primaryDomain || '');
    const normalizedWebsiteDomain = normalizeDomain(websiteUrl || '');

    let matchScore = 0;
    if (normalizedQuery && normalizedName === normalizedQuery) {
        matchScore += 100;
    } else if (normalizedQuery && normalizedName.startsWith(normalizedQuery)) {
        matchScore += 80;
    } else if (normalizedQuery && normalizedName.includes(normalizedQuery)) {
        matchScore += 60;
    }

    if (normalizedQuery && normalizedDomain && normalizedDomain.includes(normalizedQuery)) {
        matchScore += 20;
    }

    if (preferredDomains.length > 0) {
        const exactDomainMatch = preferredDomains.includes(normalizedPrimaryDomain) || preferredDomains.includes(normalizedWebsiteDomain);
        if (exactDomainMatch) {
            matchScore += 500;
        }
    }

    if (primaryDomain) matchScore += 5;
    if (linkedinUrl) matchScore += 2;

    return {
        id,
        name,
        primary_domain: primaryDomain,
        website_url: websiteUrl,
        linkedin_url: linkedinUrl,
        industry,
        estimated_num_employees: employees,
        city,
        state,
        country,
        match_score: matchScore,
    };
}

function pickBestOrganizationCandidate(
    candidates: OrganizationCandidate[],
    companyNameQuery: string
): { selected: OrganizationCandidate | null; ambiguous: boolean } {
    if (candidates.length === 0) {
        return { selected: null, ambiguous: false };
    }

    if (candidates.length === 1) {
        return { selected: candidates[0], ambiguous: false };
    }

    const normalizedQuery = normalizeCompanyToken(companyNameQuery);
    const exactNameMatches = candidates.filter(
        (candidate) => normalizeCompanyToken(candidate.name) === normalizedQuery
    );

    if (exactNameMatches.length === 1) {
        return { selected: exactNameMatches[0], ambiguous: false };
    }

    return { selected: null, ambiguous: true };
}

function firstHeaderValue(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const first = value.split(',')[0]?.trim();
    return first || null;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) return true;

    const blocked = new Set(['localhost', '0.0.0.0', '::1', '[::1]']);
    if (blocked.has(normalized)) return true;

    if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return true;

    const ipv4Parts = normalized.split('.').map((part) => Number(part));
    const looksLikeIpv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);

    if (looksLikeIpv4) {
        const [a, b] = ipv4Parts;

        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        return false;
    }

    // Hostnames without dots are usually internal service names.
    if (!normalized.includes('.')) return true;

    return false;
}

function isValidPublicHttpsUrl(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    if (isPrivateOrLocalHostname(url.hostname)) return false;
    return true;
}

function resolveRequestPublicOrigin(req: Request): string | null {
    const forwardedHost = firstHeaderValue(req.headers.get('x-forwarded-host'));
    const forwardedProto = firstHeaderValue(req.headers.get('x-forwarded-proto')) || 'https';

    if (forwardedHost) {
        try {
            const forwardedOrigin = new URL(`${forwardedProto}://${forwardedHost}`);
            if (isValidPublicHttpsUrl(forwardedOrigin)) {
                return forwardedOrigin.origin;
            }
        } catch {
            // ignore invalid forwarded headers
        }
    }

    const hostHeader = firstHeaderValue(req.headers.get('host'));
    if (hostHeader) {
        try {
            const hostOrigin = new URL(`${forwardedProto}://${hostHeader}`);
            if (isValidPublicHttpsUrl(hostOrigin)) {
                return hostOrigin.origin;
            }
        } catch {
            // ignore invalid host header
        }
    }

    try {
        const urlOrigin = new URL(req.url);
        if (isValidPublicHttpsUrl(urlOrigin)) {
            return urlOrigin.origin;
        }
    } catch {
        // ignore malformed req.url
    }

    return null;
}

function resolveLinkedInProfileWebhookUrl(
    recordId: string,
    revealPreferences: Pick<LinkedInRevealPreferences, 'revealEmail'>,
    requestOrigin?: string | null
): string | null {
    const candidates = [
        process.env.APOLLO_LINKEDIN_PROFILE_WEBHOOK_URL,
        process.env.LINKEDIN_PROFILE_WEBHOOK_URL,
        process.env.APOLLO_PROFILE_WEBHOOK_URL,
        process.env.APOLLO_WEBHOOK_URL,
        process.env.APOLLO_WEBHOOK_BASE_URL,
        process.env.LEAD_SEARCH_WEBHOOK_BASE_URL,
        process.env.APP_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        requestOrigin,
        DEFAULT_APOLLO_WEBHOOK_BASE_URL,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;

        const trimmed = candidate.trim();
        if (!trimmed) continue;

        try {
            let parsed = new URL(trimmed);

            if (!parsed.pathname.toLowerCase().endsWith('/api/apollo-webhook')) {
                parsed = new URL('/api/apollo-webhook', parsed);
            }

            if (!isValidPublicHttpsUrl(parsed)) continue;

            parsed.searchParams.set('record_id', recordId);
            parsed.searchParams.set('table_name', LINKEDIN_PROFILE_TABLE_NAME);
            parsed.searchParams.set('reveal_email', String(revealPreferences.revealEmail));
            parsed.searchParams.set('reveal_phone', 'true');

            return parsed.toString();
        } catch {
            continue;
        }
    }

    return null;
}

async function queueLinkedInPhoneEnrichment(
    apiKey: string,
    apolloPersonId: string,
    revealPreferences: LinkedInRevealPreferences,
    requestOrigin: string | null,
    log: (msg: string, data?: any) => void,
    retries = 2
): Promise<PhoneEnrichmentQueueResult> {
    if (!revealPreferences.revealPhone) {
        return {
            requested: false,
            queued: false,
            status: 'not_requested',
            message: null,
            webhook_url: null,
            provider_status: null,
            provider_details: null,
        };
    }

    const webhookUrl = resolveLinkedInProfileWebhookUrl(apolloPersonId, {
        revealEmail: revealPreferences.revealEmail,
    }, requestOrigin);

    if (!webhookUrl) {
        return {
            requested: true,
            queued: false,
            status: 'skipped',
            message: 'Phone enrichment was not queued because no valid public HTTPS webhook URL is configured.',
            webhook_url: null,
            provider_status: null,
            provider_details: null,
        };
    }

    const requestQueue = async (
        retryCount: number
    ): Promise<PhoneEnrichmentQueueResult> => {
        const params = new URLSearchParams();
        params.set('id', apolloPersonId);
        params.set('reveal_personal_emails', String(revealPreferences.revealEmail));
        params.set('reveal_phone_number', 'true');
        params.set('webhook_url', webhookUrl);

        const url = `https://api.apollo.io/api/v1/people/match?${params.toString()}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'accept': 'application/json',
                'x-api-key': apiKey,
            },
            body: '{}',
        });

        if (response.status === 429 && retryCount > 0) {
            log('Apollo rate limit reached while queueing phone enrichment. Retrying...');
            await delay(1200 * (3 - retryCount));
            return requestQueue(retryCount - 1);
        }

        if (!response.ok) {
            const details = await response.text();
            return {
                requested: true,
                queued: false,
                status: 'failed',
                message: `Phone enrichment queue failed (${response.status}).`,
                webhook_url: webhookUrl,
                provider_status: response.status,
                provider_details: details,
            };
        }

        return {
            requested: true,
            queued: true,
            status: 'queued',
            message: 'Phone enrichment queued via webhook.',
            webhook_url: webhookUrl,
            provider_status: response.status,
            provider_details: null,
        };
    };

    try {
        const queueResult = await requestQueue(retries);

        if (queueResult.queued) {
            log('Queued async phone enrichment for LinkedIn profile search.', {
                apollo_id: apolloPersonId,
                webhook_url: queueResult.webhook_url,
            });
        } else if (queueResult.status === 'skipped') {
            log('Skipped async phone enrichment for LinkedIn profile search.', {
                apollo_id: apolloPersonId,
                reason: queueResult.message,
            });
        } else {
            log('Failed to queue async phone enrichment for LinkedIn profile search.', {
                apollo_id: apolloPersonId,
                status: queueResult.provider_status,
                details: queueResult.provider_details,
            });
        }

        return queueResult;
    } catch (error: any) {
        return {
            requested: true,
            queued: false,
            status: 'failed',
            message: 'Phone enrichment queue failed due to internal error.',
            webhook_url: webhookUrl,
            provider_status: null,
            provider_details: error?.message || String(error),
        };
    }
}

async function markLeadAsPendingPhoneEnrichment(recordId: string, log: (msg: string, data?: any) => void) {
    const dbClient = getServerSupabase(log);
    const { error } = await dbClient
        .from(LINKEDIN_PROFILE_TABLE_NAME)
        .update({
            enrichment_status: 'pending',
            updated_at: new Date().toISOString(),
        })
        .eq('id', recordId);

    if (error) {
        log('Warning: Failed to mark lead as pending phone enrichment.', {
            record_id: recordId,
            error: error.message,
        });
        return;
    }

    log('Marked lead as pending phone enrichment.', { record_id: recordId });
}

async function fetchLeadSnapshot(
    dbClient: any,
    recordId: string,
    log?: (msg: string, data?: any) => void
): Promise<any | null> {
    const { data, error } = await dbClient
        .from(LINKEDIN_PROFILE_TABLE_NAME)
        .select('*')
        .eq('id', recordId)
        .maybeSingle();

    if (error) {
        log?.('Warning: Failed to fetch persisted lead snapshot.', {
            record_id: recordId,
            error: error.message,
        });
        return null;
    }

    return data || null;
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: LEAD_SEARCH_CORS_HEADERS,
    });
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const recordId =
        url.searchParams.get('record_id')?.trim() ||
        url.searchParams.get('recordId')?.trim() ||
        '';

    if (!recordId) {
        return NextResponse.json({ error: 'Missing record_id' }, { status: 400 });
    }

    const dbClient = getServerSupabase();
    const lead = await fetchLeadSnapshot(dbClient, recordId);

    if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(
        { lead },
        {
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    );
}

async function fetchOrganizationCandidatesByDomains(
    apiKey: string,
    domains: string[],
    companyName: string,
    log: (msg: string, data?: any) => void
): Promise<OrganizationCandidate[]> {
    const candidatesMap = new Map<string, OrganizationCandidate>();

    for (const domain of domains) {
        try {
            const url = `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`;
            log('Enriching organization by domain', { domain });

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'accept': 'application/json',
                    'x-api-key': apiKey,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`Apollo API Error (Organization Enrichment): ${response.status} - ${errorText}`, { domain });
                continue;
            }

            const data = await response.json();
            const organization = data?.organization || data;
            const candidate = toOrganizationCandidate(organization, companyName, domains);

            if (candidate) {
                candidatesMap.set(candidate.id, candidate);
            }
        } catch (error: any) {
            log('Error enriching organization by domain:', {
                domain,
                error: error?.message || String(error),
            });
        }
    }

    return Array.from(candidatesMap.values()).sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        return a.name.localeCompare(b.name);
    });
}

export async function POST(req: Request) {
    const debugLogs: string[] = [];
    const log = (msg: string, data?: any) => {
        const timestamp = new Date().toISOString();
        const message = data ? `${msg} ${JSON.stringify(data, null, 2)}` : msg;
        console.log(`[${timestamp}] ${message}`);
        debugLogs.push(`[${timestamp}] ${message}`);
    };

    try {
        const body: LeadSearchRequest = await req.json();
        const dbClient = getServerSupabase(log);
        const {
            user_id,
            search_mode,
            searchMode,
            linkedin_url,
            linkedin_profile_url,
            linkedinUrl,
            linkedinProfileUrl,
            company_name,
            companyName,
            organization_domains,
            organizationDomains,
            organization_domain_list,
            organizationDomainList,
            organization_domain,
            organizationDomain,
            company_domain,
            companyDomain,
            selected_organization_id,
            selectedOrganizationId,
            selected_organization_name,
            selectedOrganizationName,
            selected_organization_domain,
            selectedOrganizationDomain,
            selected_organization_website,
            selectedOrganizationWebsite,
            selected_organization_industry,
            selectedOrganizationIndustry,
            selected_organization_size,
            selectedOrganizationSize,
            industry_keywords,
            company_keyword_tags,
            company_location,
            titles,
            seniorities,
            employee_ranges,
            employeeRanges,
            employee_range,
            employeeRange,
            max_results = MAX_LEAD_SEARCH_RESULTS,
            companies_only = false,
            resume_search_progress,
            resumeSearchProgress,
        } = body;

        if (!user_id) {
            return NextResponse.json(
                { error: 'Missing user_id' },
                { status: 400 }
            );
        }

        const apiKey = process.env.APOLLO_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing APOLLO_API_KEY' },
                { status: 500 }
            );
        }

        const requestedMode = normalizeRequestedMode(search_mode ?? searchMode);

        let resolvedSearchMode = resolveSearchMode({
            user_id,
            search_mode,
            searchMode,
            linkedin_url,
            linkedin_profile_url,
            linkedinUrl,
            linkedinProfileUrl,
            company_name,
            companyName,
            organization_domains,
            organizationDomains,
            organization_domain_list,
            organizationDomainList,
            organization_domain,
            organizationDomain,
            company_domain,
            companyDomain,
            selected_organization_id,
            selectedOrganizationId,
            selected_organization_name,
            selectedOrganizationName,
            selected_organization_domain,
            selectedOrganizationDomain,
            selected_organization_website,
            selectedOrganizationWebsite,
            selected_organization_industry,
            selectedOrganizationIndustry,
            selected_organization_size,
            selectedOrganizationSize,
            industry_keywords,
            company_keyword_tags,
            company_location,
            titles,
            seniorities,
            employee_ranges,
            employeeRanges,
            employee_range,
            employeeRange,
            max_results,
            companies_only,
        });

        if (requestedMode === 'linkedin_profile' || requestedMode === 'linkedin' || requestedMode === 'profile') {
            resolvedSearchMode = 'linkedin_profile';
        } else if (requestedMode === 'company_name' || requestedMode === 'company' || requestedMode === 'organization') {
            resolvedSearchMode = 'company_name';
        } else if (requestedMode === 'batch') {
            resolvedSearchMode = 'batch';
        }

        let normalizedLinkedInUrl: string | null = null;
        const revealPreferences = resolveLinkedInRevealPreferences(body);
        const includeSimilarTitles = resolveIncludeSimilarTitles(body, resolvedSearchMode);
        const normalizedTitles = normalizeStringArray(titles);
        const normalizedSeniorities = normalizeStringArray(seniorities);
        const normalizedEmployeeRanges = resolveEmployeeRanges(body);

        const normalizedCompanyName = normalizeCompanyName(company_name || companyName || '');
        const normalizedOrganizationDomains = resolveOrganizationDomains(body);
        const maxResults = resolveMaxResults(max_results);
        const explicitSelectedOrganizationId = resolveSelectedOrganizationId(body);
        const selectedOrganizationRequest = resolveSelectedOrganizationRequest(body, normalizedCompanyName);
        const shouldResumeSearchProgress = parseBooleanFlag(
            resume_search_progress ?? resumeSearchProgress
        ) === true;

        if (resolvedSearchMode === 'linkedin_profile') {
            const linkedInUrlRaw = linkedin_url || linkedin_profile_url || linkedinUrl || linkedinProfileUrl || '';
            try {
                normalizedLinkedInUrl = normalizeLinkedInProfileUrl(linkedInUrlRaw);
            } catch (error: any) {
                return NextResponse.json(
                    { error: error.message || 'Invalid linkedin_url' },
                    { status: 400 }
                );
            }
        }

        const batchRunId = uuidv4();
        const organizationHydrationCache: OrganizationHydrationCache = {
            byDomain: new Map<string, OrganizationCandidate | null>(),
        };
        const requestOrigin = resolveRequestPublicOrigin(req);

        log(`Starting batch run: ${batchRunId} for user: ${user_id}`);
        log('Request Body:', body);
        log('Resolved Search Mode:', {
            requested_mode: requestedMode || null,
            search_mode: resolvedSearchMode,
            linkedin_url: normalizedLinkedInUrl,
            reveal_email: revealPreferences.revealEmail,
            reveal_phone: revealPreferences.revealPhone,
            company_name: normalizedCompanyName,
            organization_domains: normalizedOrganizationDomains,
            selected_organization_id: explicitSelectedOrganizationId || null,
            include_similar_titles: includeSimilarTitles,
            resume_search_progress: shouldResumeSearchProgress,
            request_origin: requestOrigin,
        });
        log('Applied Search Filters:', {
            titles: normalizedTitles,
            seniorities: normalizedSeniorities,
            organization_num_employees_ranges: normalizedEmployeeRanges,
            company_keyword_tags: (company_keyword_tags && company_keyword_tags.length > 0
                ? company_keyword_tags
                : industry_keywords
            )
                ?.map((tag) => tag?.trim())
                .filter((tag): tag is string => Boolean(tag)) || [],
            organization_locations: company_location
                ?.map((location) => location?.trim())
                .filter((location): location is string => Boolean(location)) || [],
            selected_organization: selectedOrganizationRequest,
        });

        if (
            (requestedMode === 'linkedin_profile' || requestedMode === 'linkedin' || requestedMode === 'profile') &&
            resolvedSearchMode !== 'linkedin_profile'
        ) {
            log('LinkedIn mode mismatch detected. Forcing linkedin_profile execution.', {
                requested_mode: requestedMode,
                resolved_search_mode: resolvedSearchMode,
            });
            resolvedSearchMode = 'linkedin_profile';
        }

        if (resolvedSearchMode === 'company_name') {
            let selectedOrganization: OrganizationCandidate | null = null;
            let organizationCandidates: OrganizationCandidate[] = [];

            if (explicitSelectedOrganizationId) {
                selectedOrganization = toOrganizationCandidateFromSelectedRequest(
                    selectedOrganizationRequest || {
                        id: explicitSelectedOrganizationId,
                        name: normalizeOptionalString(normalizedCompanyName),
                        primary_domain: null,
                        website_url: null,
                        industry: null,
                        estimated_num_employees: null,
                    }
                );

                organizationCandidates = [selectedOrganization];
            } else {
                if (!normalizedCompanyName && normalizedOrganizationDomains.length === 0) {
                    return NextResponse.json(
                        {
                            error: 'Missing company_name or organization_domains for company search mode',
                            debug_logs: debugLogs,
                        },
                        { status: 400 }
                    );
                }

                if (normalizedOrganizationDomains.length > 0) {
                    organizationCandidates = await fetchOrganizationCandidatesByDomains(
                        apiKey,
                        normalizedOrganizationDomains,
                        normalizedCompanyName,
                        log
                    );
                }

                if (organizationCandidates.length === 0 && normalizedCompanyName) {
                    organizationCandidates = await fetchOrganizationCandidatesByName(
                        apiKey,
                        normalizedCompanyName,
                        normalizedOrganizationDomains,
                        log
                    );
                } else if (organizationCandidates.length > 0 && normalizedOrganizationDomains.length > 0) {
                    organizationCandidates = organizationCandidates.filter((candidate) =>
                        candidateMatchesAnyDomain(candidate, normalizedOrganizationDomains)
                    );
                }

                if (organizationCandidates.length === 0) {
                    return NextResponse.json({
                        batch_run_id: batchRunId,
                        search_mode: resolvedSearchMode,
                        company_name: normalizedCompanyName,
                        organization_domains: normalizedOrganizationDomains,
                        organization_candidates: [],
                        leads_count: 0,
                        leads: [],
                        missing_organization_id_count: 0,
                        missing_organization_domain_count: 0,
                        missing_organization_industry_count: 0,
                        missing_email_count: 0,
                        warnings: [],
                        debug_logs: debugLogs,
                    });
                }

                const { selected, ambiguous } = pickBestOrganizationCandidate(
                    organizationCandidates,
                    normalizedCompanyName
                );

                if (ambiguous) {
                    return NextResponse.json({
                        batch_run_id: batchRunId,
                        search_mode: resolvedSearchMode,
                        company_name: normalizedCompanyName,
                        organization_domains: normalizedOrganizationDomains,
                        requires_organization_selection: true,
                        organization_candidates: organizationCandidates,
                        leads_count: 0,
                        leads: [],
                        missing_organization_id_count: 0,
                        missing_organization_domain_count: 0,
                        missing_organization_industry_count: 0,
                        missing_email_count: 0,
                        warnings: [],
                        debug_logs: debugLogs,
                    });
                }

                selectedOrganization = selected;
            }

            if (!selectedOrganization) {
                return NextResponse.json(
                    {
                        error: 'No organization selected for company search mode',
                        debug_logs: debugLogs,
                    },
                    { status: 400 }
                );
            }

            selectedOrganization = await hydrateOrganizationCandidate(
                apiKey,
                selectedOrganization,
                log,
                organizationHydrationCache
            );
            organizationCandidates = organizationCandidates.map((candidate) =>
                candidate.id === selectedOrganization?.id
                    ? mergeOrganizationCandidate(candidate, selectedOrganization)
                    : candidate
            );

            log('Selected organization for company search mode', selectedOrganization);

            const leads = await fetchPeople(
                apiKey,
                [selectedOrganization.id],
                {
                    titles: normalizedTitles,
                    seniorities: normalizedSeniorities,
                    include_similar_titles: includeSimilarTitles,
                    max_results: maxResults,
                },
                log
            );

            const hydratedLeads = applyOrganizationContextToLeads(leads, [selectedOrganization]);

            const savedLeads = await saveToSupabase(dbClient, hydratedLeads, batchRunId, log, {
                defaultOrganization: toOrganizationFallbackFromCandidate(selectedOrganization),
            });
            const sparseLeadSummary = summarizeSparseLeads(savedLeads);
            if (sparseLeadSummary.warnings.length > 0) {
                log('Sparse lead warnings', sparseLeadSummary);
            }

            return NextResponse.json({
                batch_run_id: batchRunId,
                search_mode: resolvedSearchMode,
                company_name: normalizedCompanyName || selectedOrganization.name,
                organization_domains: normalizedOrganizationDomains,
                selected_organization: selectedOrganization,
                organization_candidates: organizationCandidates,
                includes_similar_titles: includeSimilarTitles,
                leads_count: savedLeads.length,
                leads: savedLeads,
                ...sparseLeadSummary,
                debug_logs: debugLogs,
            });
        }

        if (resolvedSearchMode === 'linkedin_profile') {
            if (!normalizedLinkedInUrl) {
                return NextResponse.json(
                    { error: 'Missing linkedin_url for linkedin_profile mode' },
                    { status: 400 }
                );
            }

            const fallbackPhoneEnrichment: PhoneEnrichmentQueueResult = {
                requested: revealPreferences.revealPhone,
                queued: false,
                status: revealPreferences.revealPhone ? 'skipped' : 'not_requested',
                message: revealPreferences.revealPhone
                    ? 'Phone enrichment was not queued.'
                    : null,
                webhook_url: null,
                provider_status: null,
                provider_details: null,
            };

            log('Executing single-profile LinkedIn search path', {
                linkedin_url: normalizedLinkedInUrl,
            });

            const apolloResponse = await fetchPersonByLinkedInUrl(
                apiKey,
                normalizedLinkedInUrl,
                revealPreferences,
                log
            );

            const appliedReveal = apolloResponse.appliedReveal || {
                revealEmail: revealPreferences.revealEmail,
                revealPhone: false,
            };
            const providerWarnings = Array.isArray(apolloResponse.providerWarnings)
                ? apolloResponse.providerWarnings
                : [];

            if (apolloResponse?.error) {
                return NextResponse.json(
                    {
                        error: apolloResponse.error,
                        details: apolloResponse.details || null,
                        requested_reveal: {
                            email: revealPreferences.revealEmail,
                            phone: revealPreferences.revealPhone,
                        },
                        applied_reveal: {
                            email: appliedReveal.revealEmail,
                            phone: appliedReveal.revealPhone,
                        },
                        provider_warnings: providerWarnings,
                        phone_enrichment: {
                            ...fallbackPhoneEnrichment,
                            message: revealPreferences.revealPhone
                                ? 'Phone enrichment was not queued because profile lookup failed.'
                                : null,
                        },
                        debug_logs: debugLogs,
                    },
                    { status: 502 }
                );
            }

            const providerResponse = apolloResponse.apolloResponse;

            const personCandidates = extractPeopleCandidatesFromApolloResponse(providerResponse);

            if (personCandidates.length > 1) {
                log('LinkedIn profile search returned multiple people. Rejecting response.', {
                    candidate_count: personCandidates.length,
                    candidate_ids: personCandidates.map((candidate) => candidate.id).slice(0, 10),
                });

                return NextResponse.json(
                    {
                        error: 'PROFILE_SEARCH_BACKEND_MISMATCH',
                        details: 'LinkedIn profile search returned multiple people.',
                        search_mode: resolvedSearchMode,
                        requested_reveal: {
                            email: revealPreferences.revealEmail,
                            phone: revealPreferences.revealPhone,
                        },
                        applied_reveal: {
                            email: appliedReveal.revealEmail,
                            phone: appliedReveal.revealPhone,
                        },
                        provider_warnings: providerWarnings,
                        phone_enrichment: {
                            ...fallbackPhoneEnrichment,
                            message: revealPreferences.revealPhone
                                ? 'Phone enrichment was not queued because profile search returned multiple candidates.'
                                : null,
                        },
                        debug_logs: debugLogs,
                    },
                    { status: 502 }
                );
            }

            const person = extractPersonFromApolloResponse(providerResponse);

            if (!person) {
                log('No person found for provided LinkedIn URL.');
                return NextResponse.json({
                    batch_run_id: batchRunId,
                    search_mode: resolvedSearchMode,
                    requested_reveal: {
                        email: revealPreferences.revealEmail,
                        phone: revealPreferences.revealPhone,
                    },
                    applied_reveal: {
                        email: appliedReveal.revealEmail,
                        phone: appliedReveal.revealPhone,
                    },
                    provider_warnings: providerWarnings,
                    phone_enrichment: {
                        ...fallbackPhoneEnrichment,
                        message: revealPreferences.revealPhone
                            ? 'Phone enrichment was not queued because no profile match was found.'
                            : null,
                    },
                    leads_count: 0,
                    leads: [],
                    debug_logs: debugLogs,
                });
            }

            if (!person.id) {
                log('Apollo returned person without id in LinkedIn profile search mode.', apolloResponse);
                return NextResponse.json(
                    {
                        error: 'Apollo response missing person id',
                        requested_reveal: {
                            email: revealPreferences.revealEmail,
                            phone: revealPreferences.revealPhone,
                        },
                        applied_reveal: {
                            email: appliedReveal.revealEmail,
                            phone: appliedReveal.revealPhone,
                        },
                        provider_warnings: providerWarnings,
                        phone_enrichment: {
                            ...fallbackPhoneEnrichment,
                            message: revealPreferences.revealPhone
                                ? 'Phone enrichment was not queued because Apollo response was invalid.'
                                : null,
                        },
                        debug_logs: debugLogs,
                    },
                    { status: 502 }
                );
            }

            const savedLeads = await saveToSupabase(dbClient, [person], batchRunId, log);

            const phoneEnrichment = await queueLinkedInPhoneEnrichment(
                apiKey,
                person.id,
                revealPreferences,
                requestOrigin,
                log
            );

            if (phoneEnrichment.queued) {
                await markLeadAsPendingPhoneEnrichment(person.id, log);
            } else if (phoneEnrichment.requested && phoneEnrichment.message) {
                providerWarnings.push(phoneEnrichment.message);
            }

            const persistedLead = await fetchLeadSnapshot(dbClient, person.id, log);
            const responseLead = persistedLead || savedLeads[0] || person;

            if (phoneEnrichment.requested && phoneEnrichment.status === 'failed' && phoneEnrichment.provider_details) {
                log('Phone enrichment queue provider details', {
                    apollo_id: person.id,
                    provider_status: phoneEnrichment.provider_status,
                    provider_details: phoneEnrichment.provider_details,
                });
            }

            return NextResponse.json({
                batch_run_id: batchRunId,
                search_mode: resolvedSearchMode,
                requested_reveal: {
                    email: revealPreferences.revealEmail,
                    phone: revealPreferences.revealPhone,
                },
                applied_reveal: {
                    email: appliedReveal.revealEmail,
                    phone: appliedReveal.revealPhone,
                },
                provider_warnings: providerWarnings,
                phone_enrichment: phoneEnrichment,
                leads_count: 1,
                leads: [responseLead],
                debug_logs: debugLogs,
            });
        }

        const normalizedKeywordTags = (company_keyword_tags && company_keyword_tags.length > 0
            ? company_keyword_tags
            : industry_keywords
        )
            ?.map((tag) => tag?.trim())
            .filter((tag): tag is string => Boolean(tag));

        const normalizedLocations = company_location
            ?.map((location) => location?.trim())
            .filter((location): location is string => Boolean(location));

        log('Resolved Company Filters:', {
            company_keyword_tags: normalizedKeywordTags,
            organization_locations: normalizedLocations,
            organization_num_employees_ranges: normalizedEmployeeRanges,
            person_titles: normalizedTitles,
            person_seniorities: normalizedSeniorities,
            companies_only,
        });

        // --- Pagination Logic Start ---
        // 1. Generate Filter Hash
        const filtersForHash = {
            search_mode: resolvedSearchMode,
            company_keyword_tags: normalizedKeywordTags,
            company_location: normalizedLocations,
            employee_ranges: normalizedEmployeeRanges,
            titles: normalizedTitles,
            seniorities: normalizedSeniorities,
            include_similar_titles: includeSimilarTitles,
        };
        const filtersHash = crypto
            .createHash('md5')
            .update(JSON.stringify(filtersForHash))
            .digest('hex');

        log(`Filters Hash: ${filtersHash}`);

        // 2. Check Search Progress
        let startPage = 1;
        if (shouldResumeSearchProgress) {
            const { data: progressData, error: progressError } = await dbClient
                .from('search_progress')
                .select('last_company_page')
                .eq('user_id', user_id)
                .eq('filters_hash', filtersHash)
                .maybeSingle();

            if (progressError) {
                log('Warning: Failed to load previous search progress. Starting from Company Page 1.', {
                    error: progressError.message,
                });
            } else if (progressData) {
                startPage = progressData.last_company_page + 1;
                log(`Found previous progress. Resuming from Company Page ${startPage}`);
            } else {
                log('No previous progress found. Starting from Company Page 1');
            }
        } else {
            log('Search progress resume disabled. Starting from Company Page 1');
        }
        // --- Pagination Logic End ---

        // Step 1: Search Companies
        const { companies: rawCompanies, lastPageFetched } = await fetchCompanies(apiKey, {
            company_keyword_tags: normalizedKeywordTags,
            company_location: normalizedLocations,
            employee_ranges: normalizedEmployeeRanges,
            max_results: maxResults,
            start_page: startPage
        }, log);

        const companyCandidates = rawCompanies
            .map((company) => toOrganizationCandidate(company, company.name || ''))
            .filter((candidate: OrganizationCandidate | null): candidate is OrganizationCandidate => Boolean(candidate));
        const hydratedCompanyCandidates = await hydrateOrganizationCandidates(
            apiKey,
            companyCandidates,
            log,
            organizationHydrationCache
        );
        const hydratedCompanyCandidatesById = new Map(
            hydratedCompanyCandidates.map((candidate) => [candidate.id, candidate])
        );
        const companies = rawCompanies.map((company) => {
            const hydratedCandidate = hydratedCompanyCandidatesById.get(company.id);
            return hydratedCandidate
                ? mergeApolloCompanyWithCandidate(company, hydratedCandidate)
                : company;
        });

        log(`Found ${companies.length} companies.`);
        log('Hydrated batch organization metadata:', {
            companies_with_domain: companies.filter((company) => normalizeDomain(company.primary_domain || company.website_url || '')).length,
            companies_with_industry: companies.filter((company) => normalizeOptionalString(company.industry)).length,
            companies_with_size: companies.filter((company) => normalizeOptionalNumber(company.estimated_num_employees)).length,
        });

        // Update Progress if we fetched anything
        if (shouldResumeSearchProgress && lastPageFetched >= startPage) {
            const { error: upsertError } = await dbClient
                .from('search_progress')
                .upsert({
                    user_id,
                    filters_hash: filtersHash,
                    last_company_page: lastPageFetched,
                    updated_at: new Date().toISOString()
                });

            if (upsertError) {
                log('Warning: Failed to save search progress:', upsertError);
            } else {
                log(`Saved search progress. Last Company Page: ${lastPageFetched}`);
            }
        }

        if (companies.length === 0) {
            return NextResponse.json({
                batch_run_id: batchRunId,
                search_mode: resolvedSearchMode,
                companies_count: 0,
                companies: [],
                leads_count: 0,
                leads: [],
                missing_organization_id_count: 0,
                missing_organization_domain_count: 0,
                missing_organization_industry_count: 0,
                missing_email_count: 0,
                warnings: [],
                debug_logs: debugLogs,
            });
        }

        if (companies_only) {
            return NextResponse.json({
                batch_run_id: batchRunId,
                search_mode: resolvedSearchMode,
                companies_count: companies.length,
                companies,
                debug_logs: debugLogs,
            });
        }

        // Step 2: Extract Organization IDs
        const orgIds = Array.from(
            new Set(
                companies
                    .map((c) => c.id)
                    .filter((id) => id && id.trim() !== '')
            )
        );
        log(`Extracted ${orgIds.length} unique organization IDs.`);

        // Chunk IDs
        const chunkSize = 25;
        const idChunks = [];
        for (let i = 0; i < orgIds.length; i += chunkSize) {
            idChunks.push(orgIds.slice(i, i + chunkSize));
        }

        // Step 3: Search People
        let allLeads: ApolloPerson[] = [];

        for (const chunk of idChunks) {
            if (allLeads.length >= maxResults) break;

            const remaining = maxResults - allLeads.length;
            const chunkOrganizations = chunk
                .map((organizationId) => hydratedCompanyCandidatesById.get(organizationId))
                .filter((candidate): candidate is OrganizationCandidate => Boolean(candidate));
            const leads = await fetchPeople(apiKey, chunk, {
                titles: normalizedTitles,
                seniorities: normalizedSeniorities,
                include_similar_titles: includeSimilarTitles,
                max_results: remaining,
            }, log);
            allLeads = [...allLeads, ...applyOrganizationContextToLeads(leads, chunkOrganizations)];
        }

        log(`Found ${allLeads.length} leads.`);

        // Step 4: Persist to Supabase
        const savedLeads = await saveToSupabase(dbClient, allLeads, batchRunId, log, {
            organizationsById: buildOrganizationFallbackMap(companies),
        });
        const sparseLeadSummary = summarizeSparseLeads(savedLeads);
        if (sparseLeadSummary.warnings.length > 0) {
            log('Sparse lead warnings', sparseLeadSummary);
        }

        return NextResponse.json({
            batch_run_id: batchRunId,
            search_mode: resolvedSearchMode,
            leads_count: savedLeads.length,
            leads: savedLeads,
            ...sparseLeadSummary,
            debug_logs: debugLogs,
        });
    } catch (error: any) {
        log('Error in lead search:', error.message);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error', debug_logs: debugLogs },
            { status: 500 }
        );
    }
}

async function fetchOrganizationCandidatesByName(
    apiKey: string,
    companyName: string,
    preferredDomains: string[],
    log: (msg: string, data?: any) => void,
    retries = 2
): Promise<OrganizationCandidate[]> {
    try {
        const params = new URLSearchParams();
        params.set('q_organization_name', companyName);
        params.set('page', '1');
        params.set('per_page', '15');

        const url = `https://api.apollo.io/api/v1/mixed_companies/search?${params.toString()}`;
        log('Searching organizations by company name', {
            company_name: companyName,
            per_page: 15,
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'accept': 'application/json',
                'x-api-key': apiKey,
            },
            body: '{}',
        });

        if (response.status === 429 && retries > 0) {
            log('Apollo rate limit reached for organization search. Retrying...');
            await delay(1200 * (3 - retries));
            return fetchOrganizationCandidatesByName(apiKey, companyName, preferredDomains, log, retries - 1);
        }

        if (!response.ok) {
            const errorText = await response.text();
            log(`Apollo API Error (Organization Search): ${response.status} - ${errorText}`);
            return [];
        }

        const data = await response.json();
        const organizations = Array.isArray(data?.organizations) ? data.organizations : [];

        const candidates: OrganizationCandidate[] = organizations
            .map((organization: any) => toOrganizationCandidate(organization, companyName, preferredDomains))
            .filter((candidate: OrganizationCandidate | null): candidate is OrganizationCandidate => Boolean(candidate));

        const dedupedMap = new Map<string, OrganizationCandidate>();
        for (const candidate of candidates) {
            if (!dedupedMap.has(candidate.id)) {
                dedupedMap.set(candidate.id, candidate);
            }
        }

        const deduped: OrganizationCandidate[] = Array.from(dedupedMap.values());

        deduped.sort((a, b) => {
            if (b.match_score !== a.match_score) return b.match_score - a.match_score;
            if ((b.primary_domain ? 1 : 0) !== (a.primary_domain ? 1 : 0)) {
                return (b.primary_domain ? 1 : 0) - (a.primary_domain ? 1 : 0);
            }
            return a.name.localeCompare(b.name);
        });

        return deduped;
    } catch (error: any) {
        log('Error searching organizations by company name:', error?.message || error);
        return [];
    }
}

async function fetchOrganizationCandidateByDomain(
    apiKey: string,
    domain: string,
    companyName: string,
    log: (msg: string, data?: any) => void
): Promise<OrganizationCandidate | null> {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) return null;

    const candidates = await fetchOrganizationCandidatesByDomains(
        apiKey,
        [normalizedDomain],
        companyName,
        log
    );

    if (candidates.length === 0) return null;

    return (
        candidates.find((candidate) => candidateMatchesAnyDomain(candidate, [normalizedDomain])) ||
        candidates[0] ||
        null
    );
}

async function hydrateOrganizationCandidate(
    apiKey: string,
    candidate: OrganizationCandidate,
    log: (msg: string, data?: any) => void,
    cache: OrganizationHydrationCache
): Promise<OrganizationCandidate> {
    if (candidate.industry && candidate.primary_domain && candidate.estimated_num_employees) {
        return candidate;
    }

    let resolvedCandidate = candidate;
    let normalizedDomain = normalizeDomain(candidate.primary_domain || candidate.website_url || '');

    if (!normalizedDomain && candidate.name) {
        const nameCandidates = await fetchOrganizationCandidatesByName(
            apiKey,
            candidate.name,
            [],
            log
        );
        const nameMatch = pickMatchingOrganizationCandidate(nameCandidates, candidate);
        if (nameMatch) {
            resolvedCandidate = mergeOrganizationCandidate(resolvedCandidate, nameMatch);
            normalizedDomain = normalizeDomain(
                resolvedCandidate.primary_domain || resolvedCandidate.website_url || ''
            );
        }
    }

    let hydratedCandidate: OrganizationCandidate | null = null;

    if (normalizedDomain) {
        if (!cache.byDomain.has(normalizedDomain)) {
            cache.byDomain.set(
                normalizedDomain,
                await fetchOrganizationCandidateByDomain(apiKey, normalizedDomain, resolvedCandidate.name, log)
            );
        }

        hydratedCandidate = cache.byDomain.get(normalizedDomain) || null;
    }

    const needsMoreMetadata = !hydratedCandidate || !hydratedCandidate.industry || !hydratedCandidate.estimated_num_employees;

    if (needsMoreMetadata && resolvedCandidate.name) {
        const nameCandidates = await fetchOrganizationCandidatesByName(
            apiKey,
            resolvedCandidate.name,
            normalizedDomain ? [normalizedDomain] : [],
            log
        );
        const nameMatch = pickMatchingOrganizationCandidate(nameCandidates, resolvedCandidate);
        if (nameMatch) {
            hydratedCandidate = hydratedCandidate
                ? mergeOrganizationCandidate(hydratedCandidate, nameMatch)
                : nameMatch;
        }
    }

    return mergeOrganizationCandidate(resolvedCandidate, hydratedCandidate);
}

async function hydrateOrganizationCandidates(
    apiKey: string,
    candidates: OrganizationCandidate[],
    log: (msg: string, data?: any) => void,
    cache: OrganizationHydrationCache
): Promise<OrganizationCandidate[]> {
    const hydrated: OrganizationCandidate[] = [];

    const concurrency = 5;
    for (let index = 0; index < candidates.length; index += concurrency) {
        const slice = candidates.slice(index, index + concurrency);
        const sliceResults = await Promise.all(
            slice.map((candidate) => hydrateOrganizationCandidate(apiKey, candidate, log, cache))
        );
        hydrated.push(...sliceResults);
    }

    return hydrated;
}

function applyOrganizationContextToLeads(
    leads: ApolloPerson[],
    organizations: OrganizationCandidate[]
): ApolloPerson[] {
    if (leads.length === 0 || organizations.length === 0) return leads;

    const organizationsById = new Map<string, OrganizationCandidate>();
    const organizationsByDomain = new Map<string, OrganizationCandidate>();
    const organizationsByName = new Map<string, OrganizationCandidate>();

    for (const organization of organizations) {
        organizationsById.set(organization.id, organization);

        const primaryDomain = normalizeDomain(organization.primary_domain || '');
        if (primaryDomain && !organizationsByDomain.has(primaryDomain)) {
            organizationsByDomain.set(primaryDomain, organization);
        }

        const websiteDomain = normalizeDomain(organization.website_url || '');
        if (websiteDomain && !organizationsByDomain.has(websiteDomain)) {
            organizationsByDomain.set(websiteDomain, organization);
        }

        const normalizedName = normalizeCompanyToken(organization.name || '');
        if (normalizedName && !organizationsByName.has(normalizedName)) {
            organizationsByName.set(normalizedName, organization);
        }
    }

    return leads.map((lead) => {
        const normalizedLeadOrganizationId = normalizeOptionalString(
            lead.organization?.id || lead.organization_id
        );
        const normalizedLeadDomain = normalizeDomain(
            (lead.organization?.primary_domain || lead.organization_domain || lead.organization?.website_url || lead.organization_website || '')
        );
        const normalizedLeadName = normalizeCompanyToken(
            lead.organization?.name || lead.organization_name || ''
        );

        const matchedOrganization =
            (normalizedLeadOrganizationId ? organizationsById.get(normalizedLeadOrganizationId) : null) ||
            (normalizedLeadDomain ? organizationsByDomain.get(normalizedLeadDomain) : null) ||
            (normalizedLeadName ? organizationsByName.get(normalizedLeadName) : null) ||
            (organizations.length === 1 ? organizations[0] : null);

        if (!matchedOrganization) return lead;

        return {
            ...lead,
            organization_id:
                normalizeOptionalString(lead.organization_id || lead.organization?.id) ||
                matchedOrganization.id,
            organization_name:
                normalizeOptionalString(lead.organization_name) ||
                normalizeOptionalString(lead.organization?.name) ||
                matchedOrganization.name,
            organization_domain:
                normalizeOptionalString(lead.organization_domain) ||
                normalizeOptionalString(lead.organization?.primary_domain) ||
                matchedOrganization.primary_domain,
            organization_website:
                normalizeOptionalString(lead.organization_website) ||
                normalizeOptionalString(lead.organization?.website_url) ||
                matchedOrganization.website_url,
            organization_industry:
                normalizeOptionalString(lead.organization_industry) ||
                normalizeOptionalString(lead.organization?.industry) ||
                matchedOrganization.industry,
            organization_size:
                normalizeOptionalNumber(lead.organization_size) ||
                normalizeOptionalNumber(lead.organization?.estimated_num_employees) ||
                matchedOrganization.estimated_num_employees,
            industry:
                normalizeOptionalString((lead as any).industry) ||
                normalizeOptionalString(lead.organization_industry) ||
                normalizeOptionalString(lead.organization?.industry) ||
                matchedOrganization.industry,
            organization: {
                ...(lead.organization || {}),
                id: normalizeOptionalString(lead.organization?.id) || matchedOrganization.id,
                name: normalizeOptionalString(lead.organization?.name) || matchedOrganization.name,
                primary_domain:
                    normalizeOptionalString(lead.organization?.primary_domain) ||
                    matchedOrganization.primary_domain,
                website_url:
                    normalizeOptionalString(lead.organization?.website_url) ||
                    matchedOrganization.website_url,
                industry:
                    normalizeOptionalString(lead.organization?.industry) || matchedOrganization.industry,
                estimated_num_employees:
                    normalizeOptionalNumber(lead.organization?.estimated_num_employees) ||
                    matchedOrganization.estimated_num_employees,
            },
        };
    });
}

function summarizeSparseLeads(leads: any[]): SparseLeadSummary {
    const summary: SparseLeadSummary = {
        missing_organization_id_count: 0,
        missing_organization_domain_count: 0,
        missing_organization_industry_count: 0,
        missing_email_count: 0,
        warnings: [],
    };

    const total = Array.isArray(leads) ? leads.length : 0;
    if (total === 0) return summary;

    for (const lead of leads) {
        if (!normalizeOptionalString(lead?.organization_id)) {
            summary.missing_organization_id_count++;
        }

        if (!normalizeOptionalString(lead?.organization_domain || lead?.organization?.primary_domain)) {
            summary.missing_organization_domain_count++;
        }

        if (!normalizeOptionalString(lead?.organization_industry || lead?.organization?.industry)) {
            summary.missing_organization_industry_count++;
        }

        if (!normalizeEmail(lead?.email)) {
            summary.missing_email_count++;
        }
    }

    const sparseWarnings: Array<[number, string]> = [
        [summary.missing_organization_id_count, 'organization_id'],
        [summary.missing_organization_domain_count, 'organization_domain'],
        [summary.missing_organization_industry_count, 'organization_industry'],
        [summary.missing_email_count, 'email'],
    ];

    for (const [count, label] of sparseWarnings) {
        if (count <= 0) continue;
        summary.warnings.push(`Sparse lead coverage: ${count}/${total} leads are missing ${label}.`);
    }

    return summary;
}

async function fetchPersonByLinkedInUrl(
    apiKey: string,
    linkedInUrl: string,
    revealPreferences: LinkedInRevealPreferences,
    log: (msg: string, data?: any) => void,
    retries = 2
): Promise<LinkedInLookupResult> {
    const requestApolloProfile = async (
        retryCount: number
    ): Promise<{ ok: true; data: any } | { ok: false; status: number; details: string }> => {
        const params = new URLSearchParams();
        params.set('linkedin_url', linkedInUrl);
        params.set('reveal_personal_emails', String(revealPreferences.revealEmail));
        // NOTE: Phone reveal is queued asynchronously via webhook after we know the person ID.
        params.set('reveal_phone_number', 'false');

        const url = `https://api.apollo.io/api/v1/people/match?${params.toString()}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'accept': 'application/json',
                'x-api-key': apiKey,
            },
            body: '{}',
        });

        if (response.status === 429 && retryCount > 0) {
            log('Apollo rate limit reached for LinkedIn profile search. Retrying...');
            await delay(1200 * (3 - retryCount));
            return requestApolloProfile(retryCount - 1);
        }

        if (!response.ok) {
            const errorText = await response.text();
            return {
                ok: false,
                status: response.status,
                details: errorText,
            };
        }

        return {
            ok: true,
            data: await response.json(),
        };
    };

    try {
        const providerWarnings: string[] = [];
        const appliedReveal = {
            revealEmail: revealPreferences.revealEmail,
            revealPhone: false,
        };

        if (revealPreferences.revealPhone) {
            providerWarnings.push('Phone reveal deferred to asynchronous webhook enrichment step.');
        }

        log('Fetching Person by LinkedIn URL', {
            linkedin_url: linkedInUrl,
            requested_reveal_email: revealPreferences.revealEmail,
            requested_reveal_phone: revealPreferences.revealPhone,
            applied_reveal_email: appliedReveal.revealEmail,
            applied_reveal_phone: appliedReveal.revealPhone,
        });

        const profileResult = await requestApolloProfile(retries);

        if (!profileResult.ok) {
            log(`Apollo API Error (People Enrichment): ${profileResult.status} - ${profileResult.details}`);
            return {
                apolloResponse: null,
                error: `Apollo API Error (${profileResult.status})`,
                details: profileResult.details,
                appliedReveal,
                providerWarnings,
            };
        }

        return {
            apolloResponse: profileResult.data,
            error: null,
            details: null,
            appliedReveal,
            providerWarnings,
        };
    } catch (error: any) {
        log('Error fetching person by LinkedIn URL:', error?.message || error);
        return {
            apolloResponse: null,
            error: error?.message || 'Unknown error while fetching person by LinkedIn URL',
            details: null,
            appliedReveal: {
                revealEmail: revealPreferences.revealEmail,
                revealPhone: false,
            },
            providerWarnings: [],
        };
    }
}

async function fetchCompanies(
    apiKey: string,
    filters: {
        company_keyword_tags?: string[];
        company_location?: string[];
        employee_ranges?: string[];
        max_results: number;
        start_page: number;
    },
    log: (msg: string, data?: any) => void
): Promise<{ companies: ApolloCompany[], lastPageFetched: number }> {
    let companies: ApolloCompany[] = [];
    let page = filters.start_page;
    const perPage = 100;
    const maxCompanies = filters.max_results || 100;
    let lastPageFetched = page - 1;

    while (companies.length < maxCompanies) {
        try {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('per_page', String(perPage));

            for (const location of filters.company_location ?? []) {
                params.append('organization_locations[]', location);
            }

            for (const keywordTag of filters.company_keyword_tags ?? []) {
                params.append('q_organization_keyword_tags[]', keywordTag);
            }

            for (const employeeRange of filters.employee_ranges ?? []) {
                params.append('organization_num_employees_ranges[]', employeeRange);
            }

            const url = `https://api.apollo.io/api/v1/mixed_companies/search?${params.toString()}`;
            log(`Fetching Companies (Page ${page}) Params: ${params.toString()}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'accept': 'application/json',
                    'x-api-key': apiKey,
                },
                body: '{}',
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`Apollo API Error (Companies): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newCompanies = data.organizations || [];

            if (newCompanies.length === 0) {
                log('No companies found in this page.');
                break;
            }

            companies = [...companies, ...newCompanies];
            lastPageFetched = page;
            page++;

            // Safety break to avoid infinite loops, but allow fetching enough pages
            if (page > filters.start_page + 10) break;

        } catch (error) {
            log('Error fetching companies:', error);
            break;
        }
    }

    return { companies: companies.slice(0, maxCompanies), lastPageFetched };
}

async function fetchPeople(
    apiKey: string,
    organizationIds: string[],
    filters: {
        titles?: string[];
        seniorities?: string[];
        include_similar_titles?: boolean;
        max_results: number;
    },
    log: (msg: string, data?: any) => void
): Promise<ApolloPerson[]> {
    let people: ApolloPerson[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 500;

    while (people.length < filters.max_results) {
        try {
            // Build query params (Apollo docs show arrays using [] in the URL)
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("per_page", String(perPage));

            for (const id of organizationIds ?? []) params.append("organization_ids[]", id);
            for (const t of filters.titles ?? []) params.append("person_titles[]", t);
            for (const s of filters.seniorities ?? []) params.append("person_seniorities[]", s);
            if (typeof filters.include_similar_titles === 'boolean') {
                params.set('include_similar_titles', String(filters.include_similar_titles));
            }

            // Keep a payload for logging/debug (even if request uses query params)
            const debugPayload = {
                organization_ids: organizationIds,
                page,
                per_page: perPage,
                person_titles: filters.titles,
                person_seniorities: filters.seniorities,
                include_similar_titles: filters.include_similar_titles,
            };

            log(`Fetching People (Page ${page}) Params: ${params.toString()}`, debugPayload);

            const url = `https://api.apollo.io/api/v1/mixed_people/api_search?${params.toString()}`;

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "accept": "application/json",
                    "x-api-key": apiKey,
                },
                // Apollo allows raw body, but official example uses query params with empty body
                body: "{}",
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`Apollo API Error (People): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newPeople = data.people || [];

            if (newPeople.length === 0) {
                log("No people found in this page.");
                break;
            }

            people = people.concat(newPeople);
            page++;

            if (people.length >= filters.max_results) break;
            if (page > maxPages) {
                log(`Reached Apollo page limit (${maxPages}) for people search.`);
                break;
            }
        } catch (error) {
            log("Error fetching people:", error);
            break;
        }
    }

    return people.slice(0, filters.max_results);
}

async function saveToSupabase(
    dbClient: any,
    leads: ApolloPerson[],
    batchRunId: string,
    log: (msg: string, data?: any) => void,
    options: {
        organizationsById?: Map<string, OrganizationFallback>;
        defaultOrganization?: OrganizationFallback | null;
    } = {}
) {
    if (leads.length === 0) return [];

    const leadIds = leads
        .map((lead: any) => lead?.id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '');

    const existingById = new Map<string, any>();

    if (leadIds.length > 0) {
        const { data: existingRows, error: existingError } = await dbClient
            .from(LINKEDIN_PROFILE_TABLE_NAME)
            .select('id, email, email_status, linkedin_url, phone_numbers, primary_phone, enrichment_status, org_name, organization_name, organization_id, organization_website, industry, organization_domain, organization_industry, organization_size')
            .in('id', leadIds);

        if (existingError) {
            log('Warning: Failed to load existing lead snapshots before upsert.', {
                error: existingError.message,
            });
        } else {
            for (const row of existingRows || []) {
                if (typeof row?.id === 'string' && row.id.trim() !== '') {
                    existingById.set(row.id, row);
                }
            }
        }
    }

    // Remove filter and debug logs
    // The new API may return sparse data (no linkedin_url, obfuscated last_name).
    // We map missing required fields to empty strings to satisfy DB constraints.

    const records = leads
        .filter((lead: any) => Boolean(lead?.id))
        .map((lead: any) => {
            const existing = existingById.get(lead.id) || null;
            const firstName = (lead.first_name || '').toString().trim();
            const lastName = (lead.last_name || lead.last_name_obfuscated || '').toString().trim();
            const fullName = `${firstName} ${lastName}`.trim() || null;
            const leadOrganizationId = normalizeOptionalString(lead.organization?.id || lead.organization_id);
            const shouldUseDefaultOrganization = Boolean(
                options.defaultOrganization &&
                (!leadOrganizationId || leadOrganizationId === options.defaultOrganization.id)
            );
            const fallbackOrganization =
                (leadOrganizationId ? options.organizationsById?.get(leadOrganizationId) : null) ||
                (shouldUseDefaultOrganization ? options.defaultOrganization || null : null);
            const existingOrganizationName = normalizeOptionalString(existing?.organization_name || existing?.org_name);
            const existingOrganizationId = normalizeOptionalString(existing?.organization_id);
            const existingOrganizationWebsite = normalizeOptionalString(existing?.organization_website);
            const existingOrganizationDomain = normalizeOptionalString(existing?.organization_domain);
            const existingOrganizationIndustry = normalizeOptionalString(existing?.organization_industry || existing?.industry);
            const organizationName =
                normalizeOptionalString(lead.organization?.name || lead.organization_name) ||
                fallbackOrganization?.name ||
                existingOrganizationName;
            const organizationId = leadOrganizationId || fallbackOrganization?.id || existingOrganizationId;
            const organizationWebsite =
                normalizeOptionalString(lead.organization?.website_url || lead.organization_website) ||
                fallbackOrganization?.website_url ||
                existingOrganizationWebsite;
            const organizationDomain =
                normalizeOptionalString(lead.organization?.primary_domain || lead.organization_domain) ||
                fallbackOrganization?.primary_domain ||
                existingOrganizationDomain;
            const organizationIndustry =
                normalizeOptionalString(lead.organization?.industry || lead.organization_industry) ||
                fallbackOrganization?.industry ||
                existingOrganizationIndustry;
            const organizationSize =
                normalizeOptionalNumber(lead.organization?.estimated_num_employees || lead.organization_size) ||
                fallbackOrganization?.estimated_num_employees ||
                normalizeOptionalNumber(existing?.organization_size);
            const nextEmail = normalizeEmail(lead.email);
            const existingEmail = normalizeEmail(existing?.email);
            const resolvedEmail = nextEmail || existingEmail;
            const nextEmailStatus = normalizeOptionalString(lead.email_status);
            const existingEmailStatus = normalizeOptionalString(existing?.email_status);
            const nextPhoneNumbers = normalizePhoneNumbers(lead.phone_numbers);
            const existingPhoneNumbers = normalizePhoneNumbers(existing?.phone_numbers);
            const resolvedPhoneNumbers = nextPhoneNumbers || existingPhoneNumbers;
            const nextPrimaryPhone = resolvePrimaryPhoneFromLead(lead);
            const existingPrimaryPhone = normalizeOptionalString(existing?.primary_phone);
            const resolvedPrimaryPhone = nextPrimaryPhone || existingPrimaryPhone;
            const nextLinkedInUrl = normalizeOptionalString(lead.linkedin_url);
            const existingLinkedInUrl = normalizeOptionalString(existing?.linkedin_url);
            const existingEnrichmentStatus = normalizeOptionalString(existing?.enrichment_status);
            const resolvedEnrichmentStatus = resolvedPrimaryPhone || resolvedPhoneNumbers
                ? 'completed'
                : existingEnrichmentStatus || 'completed';

            return {
                id: lead.id,
                name: fullName,
                first_name: firstName,
                last_name: lastName,
                email: resolvedEmail,
                email_status: resolvedEmail ? nextEmailStatus || existingEmailStatus : null,
                linkedin_url: nextLinkedInUrl || existingLinkedInUrl || '',
                org_name: organizationName,
                organization_name: organizationName,
                organization_id: organizationId,
                organization_website: organizationWebsite,
                industry: organizationIndustry || normalizeOptionalString(lead.industry) || existingOrganizationIndustry,
                title: lead.title || null,
                photo_url: lead.photo_url || null,
                city: lead.city || null,
                state: lead.state || null,
                country: lead.country || null,
                headline: lead.headline || null,
                seniority: lead.seniority || null,
                departments: Array.isArray(lead.departments) && lead.departments.length > 0 ? lead.departments : null,
                phone_numbers: resolvedPhoneNumbers,
                primary_phone: resolvedPrimaryPhone,
                enrichment_status: resolvedEnrichmentStatus,
                organization_domain: organizationDomain,
                organization_industry: organizationIndustry,
                organization_size: organizationSize,
                page: typeof lead.page === 'number' ? lead.page : 1,
                batch_run_id: batchRunId,
                updated_at: new Date().toISOString(),
            };
        });

    if (records.length === 0) {
        log('No valid leads with id to save into Supabase.');
        return [];
    }

    // Perform upsert and select the inserted rows to verify visibility
    const { data, error } = await dbClient
        .from(LINKEDIN_PROFILE_TABLE_NAME)
        .upsert(records, { onConflict: 'id' })
        .select();

    if (error) {
        log('Error saving to Supabase:', error);
        throw new Error(`Supabase Error: ${error.message}`);
    } else {
        log(`Saved ${records.length} leads to Supabase.`);

        if (data) {
            log(`Verification: API successfully read back ${data.length} rows.`);
        } else {
            log('Verification: API read back 0 rows (RLS might be blocking SELECT).');
        }

        // Double check count for this batch
        const { count, error: countError } = await dbClient
            .from(LINKEDIN_PROFILE_TABLE_NAME)
            .select('*', { count: 'exact', head: true })
            .eq('batch_run_id', batchRunId);

        if (countError) {
            log('Verification Error (Count):', countError);
        } else {
            log(`Verification: Total rows in DB for this batch: ${count}`);
        }
    }

    return Array.isArray(data) ? data : records;
}
