import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_APOLLO_WEBHOOK_BASE_URL = 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app';
const LINKEDIN_PROFILE_TABLE_NAME = 'people_search_leads';

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
    selected_organization_id?: string;
    selectedOrganizationId?: string;
    selected_organization_name?: string;
    selectedOrganizationName?: string;
    selected_organization_domain?: string;
    selectedOrganizationDomain?: string;
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
    max_results?: number;
    companies_only?: boolean;
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
}

interface ApolloPerson {
    id: string;
    first_name?: string;
    last_name?: string;
    last_name_obfuscated?: string;
    email?: string;
    linkedin_url?: string;
    organization?: {
        name?: string;
    };
    organization_name?: string;
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
    const selectedOrganizationId = body.selected_organization_id || body.selectedOrganizationId || '';

    if (
        (typeof companyNameCandidate === 'string' && companyNameCandidate.trim() !== '') ||
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

function normalizeCompanyName(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function normalizeCompanyToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveSelectedOrganizationId(body: LeadSearchRequest): string {
    const value = body.selected_organization_id || body.selectedOrganizationId || '';
    if (typeof value !== 'string') return '';
    return value.trim();
}

function resolveIncludeSimilarTitles(body: LeadSearchRequest, searchMode: SearchMode): boolean | undefined {
    const explicit = parseBooleanFlag(body.include_similar_titles ?? body.includeSimilarTitles);
    if (explicit !== null) return explicit;

    if (searchMode === 'company_name') {
        return false;
    }

    return undefined;
}

function toOrganizationCandidate(company: any, companyNameQuery: string): OrganizationCandidate | null {
    const id = (company?.id || '').toString().trim();
    const name = (company?.name || '').toString().trim();
    if (!id || !name) return null;

    const primaryDomain = typeof company?.primary_domain === 'string' ? company.primary_domain.trim() : null;
    const websiteUrl = typeof company?.website_url === 'string' ? company.website_url.trim() : null;
    const linkedinUrl = typeof company?.linkedin_url === 'string' ? company.linkedin_url.trim() : null;
    const industry = typeof company?.industry === 'string' ? company.industry.trim() : null;
    const city = typeof company?.city === 'string' ? company.city.trim() : null;
    const state = typeof company?.state === 'string' ? company.state.trim() : null;
    const country = typeof company?.country === 'string' ? company.country.trim() : null;
    const employees = typeof company?.estimated_num_employees === 'number' ? company.estimated_num_employees : null;

    const normalizedQuery = normalizeCompanyToken(companyNameQuery);
    const normalizedName = normalizeCompanyToken(name);
    const normalizedDomain = normalizeCompanyToken(primaryDomain || '');

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

            if (parsed.protocol !== 'https:') {
                continue;
            }

            if (!parsed.pathname.toLowerCase().endsWith('/api/apollo-webhook')) {
                parsed = new URL('/api/apollo-webhook', parsed);
            }

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
            message: 'Phone enrichment was not queued because no webhook URL is configured.',
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
    const { error } = await supabase
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
            selected_organization_id,
            selectedOrganizationId,
            selected_organization_name,
            selectedOrganizationName,
            selected_organization_domain,
            selectedOrganizationDomain,
            industry_keywords,
            company_keyword_tags,
            company_location,
            titles,
            seniorities,
            employee_ranges,
            max_results = 100,
            companies_only = false,
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
            selected_organization_id,
            selectedOrganizationId,
            industry_keywords,
            company_keyword_tags,
            company_location,
            titles,
            seniorities,
            employee_ranges,
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

        const normalizedCompanyName = normalizeCompanyName(company_name || companyName || '');
        const explicitSelectedOrganizationId = resolveSelectedOrganizationId(body);

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
        const requestOrigin = (() => {
            try {
                return new URL(req.url).origin;
            } catch {
                return null;
            }
        })();

        log(`Starting batch run: ${batchRunId} for user: ${user_id}`);
        log('Request Body:', body);
        log('Resolved Search Mode:', {
            requested_mode: requestedMode || null,
            search_mode: resolvedSearchMode,
            linkedin_url: normalizedLinkedInUrl,
            reveal_email: revealPreferences.revealEmail,
            reveal_phone: revealPreferences.revealPhone,
            company_name: normalizedCompanyName,
            selected_organization_id: explicitSelectedOrganizationId || null,
            include_similar_titles: includeSimilarTitles,
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
                const selectedOrgName = normalizeCompanyName(
                    selected_organization_name || selectedOrganizationName || normalizedCompanyName || ''
                );
                const selectedOrgDomain = normalizeCompanyName(
                    selected_organization_domain || selectedOrganizationDomain || ''
                );

                selectedOrganization = {
                    id: explicitSelectedOrganizationId,
                    name: selectedOrgName || 'Selected organization',
                    primary_domain: selectedOrgDomain || null,
                    website_url: null,
                    linkedin_url: null,
                    industry: null,
                    estimated_num_employees: null,
                    city: null,
                    state: null,
                    country: null,
                    match_score: selectedOrgName ? 100 : 0,
                };

                organizationCandidates = [selectedOrganization];
            } else {
                if (!normalizedCompanyName) {
                    return NextResponse.json(
                        {
                            error: 'Missing company_name for company search mode',
                            debug_logs: debugLogs,
                        },
                        { status: 400 }
                    );
                }

                organizationCandidates = await fetchOrganizationCandidatesByName(
                    apiKey,
                    normalizedCompanyName,
                    log
                );

                if (organizationCandidates.length === 0) {
                    return NextResponse.json({
                        batch_run_id: batchRunId,
                        search_mode: resolvedSearchMode,
                        company_name: normalizedCompanyName,
                        organization_candidates: [],
                        leads_count: 0,
                        leads: [],
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
                        requires_organization_selection: true,
                        organization_candidates: organizationCandidates,
                        leads_count: 0,
                        leads: [],
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

            log('Selected organization for company search mode', selectedOrganization);

            const leads = await fetchPeople(
                apiKey,
                [selectedOrganization.id],
                {
                    titles: normalizedTitles,
                    seniorities: normalizedSeniorities,
                    include_similar_titles: includeSimilarTitles,
                    max_results,
                },
                log
            );

            await saveToSupabase(leads, batchRunId, log);

            return NextResponse.json({
                batch_run_id: batchRunId,
                search_mode: resolvedSearchMode,
                company_name: normalizedCompanyName || selectedOrganization.name,
                selected_organization: selectedOrganization,
                organization_candidates: organizationCandidates,
                includes_similar_titles: includeSimilarTitles,
                leads_count: leads.length,
                leads,
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

            await saveToSupabase([person], batchRunId, log);

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
                leads: [person],
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
            organization_num_employees_ranges: employee_ranges,
            companies_only,
        });

        // --- Pagination Logic Start ---
        // 1. Generate Filter Hash
        const filtersForHash = {
            company_keyword_tags: normalizedKeywordTags,
            company_location: normalizedLocations,
            employee_ranges,
            // We only hash company filters because that's what we paginate
        };
        const filtersHash = crypto
            .createHash('md5')
            .update(JSON.stringify(filtersForHash))
            .digest('hex');

        log(`Filters Hash: ${filtersHash}`);

        // 2. Check Search Progress
        let startPage = 1;
        const { data: progressData, error: progressError } = await supabase
            .from('search_progress')
            .select('last_company_page')
            .eq('user_id', user_id)
            .eq('filters_hash', filtersHash)
            .single();

        if (progressData) {
            startPage = progressData.last_company_page + 1;
            log(`Found previous progress. Resuming from Company Page ${startPage}`);
        } else {
            log('No previous progress found. Starting from Company Page 1');
        }
        // --- Pagination Logic End ---

        // Step 1: Search Companies
        const { companies, lastPageFetched } = await fetchCompanies(apiKey, {
            company_keyword_tags: normalizedKeywordTags,
            company_location: normalizedLocations,
            employee_ranges,
            max_results,
            start_page: startPage
        }, log);

        log(`Found ${companies.length} companies.`);

        // Update Progress if we fetched anything
        if (lastPageFetched >= startPage) {
            const { error: upsertError } = await supabase
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
            if (allLeads.length >= max_results) break;

            const remaining = max_results - allLeads.length;
            const leads = await fetchPeople(apiKey, chunk, {
                titles: normalizedTitles,
                seniorities: normalizedSeniorities,
                include_similar_titles: includeSimilarTitles,
                max_results: remaining,
            }, log);
            allLeads = [...allLeads, ...leads];
        }

        log(`Found ${allLeads.length} leads.`);

        // Step 4: Persist to Supabase
        await saveToSupabase(allLeads, batchRunId, log);

        return NextResponse.json({
            batch_run_id: batchRunId,
            search_mode: resolvedSearchMode,
            leads_count: allLeads.length,
            leads: allLeads,
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
            return fetchOrganizationCandidatesByName(apiKey, companyName, log, retries - 1);
        }

        if (!response.ok) {
            const errorText = await response.text();
            log(`Apollo API Error (Organization Search): ${response.status} - ${errorText}`);
            return [];
        }

        const data = await response.json();
        const organizations = Array.isArray(data?.organizations) ? data.organizations : [];

        const candidates: OrganizationCandidate[] = organizations
            .map((organization: any) => toOrganizationCandidate(organization, companyName))
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

async function saveToSupabase(leads: ApolloPerson[], batchRunId: string, log: (msg: string, data?: any) => void) {
    if (leads.length === 0) return;

    // Remove filter and debug logs
    // The new API may return sparse data (no linkedin_url, obfuscated last_name).
    // We map missing required fields to empty strings to satisfy DB constraints.

    const records = leads
        .filter((lead: any) => Boolean(lead?.id))
        .map((lead: any) => {
            const firstName = (lead.first_name || '').toString().trim();
            const lastName = (lead.last_name || lead.last_name_obfuscated || '').toString().trim();
            const fullName = `${firstName} ${lastName}`.trim() || null;
            const organizationName = lead.organization?.name || lead.organization_name || null;
            const organizationDomain = lead.organization?.primary_domain || lead.organization_domain || null;
            const organizationIndustry = lead.organization?.industry || lead.organization_industry || null;
            const organizationSize = lead.organization?.estimated_num_employees || lead.organization_size || null;
            const phoneNumbers = Array.isArray(lead.phone_numbers)
                ? lead.phone_numbers.filter(Boolean)
                : null;

            return {
                id: lead.id,
                name: fullName,
                first_name: firstName,
                last_name: lastName,
                email: normalizeEmail(lead.email),
                email_status: lead.email_status || null,
                linkedin_url: lead.linkedin_url || '',
                org_name: organizationName,
                organization_name: organizationName,
                organization_id: lead.organization?.id || lead.organization_id || null,
                organization_website: lead.organization?.website_url || lead.organization_website || null,
                industry: organizationIndustry || lead.industry || null,
                title: lead.title || null,
                photo_url: lead.photo_url || null,
                city: lead.city || null,
                state: lead.state || null,
                country: lead.country || null,
                headline: lead.headline || null,
                seniority: lead.seniority || null,
                departments: Array.isArray(lead.departments) && lead.departments.length > 0 ? lead.departments : null,
                phone_numbers: phoneNumbers,
                primary_phone: resolvePrimaryPhoneFromLead(lead),
                enrichment_status: 'completed',
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
        return;
    }

    // Perform upsert and select the inserted rows to verify visibility
    const { data, error } = await supabase
        .from('people_search_leads')
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
        const { count, error: countError } = await supabase
            .from('people_search_leads')
            .select('*', { count: 'exact', head: true })
            .eq('batch_run_id', batchRunId);

        if (countError) {
            log('Verification Error (Count):', countError);
        } else {
            log(`Verification: Total rows in DB for this batch: ${count}`);
        }
    }
}
