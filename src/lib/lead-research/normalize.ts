import {
    LeadResearchOptions,
    LeadResearchDepth,
    NormalizedCompany,
    NormalizedLead,
    NormalizedLeadResearchInput,
    NormalizedSellerContext,
    NormalizedUserContext,
    ResearchLanguage,
} from './types';

type AnyRecord = Record<string, any>;

function asRecord(value: unknown): AnyRecord {
    return value && typeof value === 'object' ? (value as AnyRecord) : {};
}

function firstNonEmptyString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
        }
    }

    return null;
}

function stringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(
            new Set(
                value
                    .filter((entry): entry is string => typeof entry === 'string')
                    .map((entry) => entry.trim())
                    .filter(Boolean)
            )
        );
    }

    if (typeof value === 'string') {
        return Array.from(
            new Set(
                value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean)
            )
        );
    }

    return [];
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }

    return fallback;
}

function parseDepth(value: unknown): LeadResearchDepth {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'light' || normalized === 'standard' || normalized === 'deep') {
            return normalized;
        }
    }

    return 'standard';
}

function parseLanguage(value: unknown): ResearchLanguage {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'es' || normalized === 'en') return normalized;
    }

    return 'es';
}

function parseInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return Math.round(parsed);
    }

    return fallback;
}

function normalizeDomain(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;

    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(withProtocol);
        return parsed.hostname.replace(/^www\./, '').trim().toLowerCase() || null;
    } catch {
        const domain = trimmed
            .replace(/^https?:\/\//i, '')
            .split('/')[0]
            .replace(/^www\./, '')
            .trim()
            .toLowerCase();
        return domain || null;
    }
}

function buildLocation(city: string | null, country: string | null, fallback: string | null): string | null {
    const combined = [city, country].filter(Boolean).join(', ');
    return combined || fallback;
}

function normalizeLead(body: AnyRecord): NormalizedLead {
    const lead = asRecord(body.lead);

    const firstName = firstNonEmptyString(lead.first_name, lead.firstName, body.first_name, body.firstName);
    const lastName = firstNonEmptyString(lead.last_name, lead.lastName, body.last_name, body.lastName);
    const fullName =
        firstNonEmptyString(lead.full_name, lead.fullName, body.full_name, body.fullName) ||
        [firstName, lastName].filter(Boolean).join(' ').trim() ||
        null;

    const city = firstNonEmptyString(lead.city, body.city);
    const country = firstNonEmptyString(lead.country, body.country);
    const fallbackLocation = firstNonEmptyString(lead.location, body.location);

    return {
        id: firstNonEmptyString(lead.id, body.leadId),
        apollo_id: firstNonEmptyString(lead.apollo_id, lead.apolloId, body.apollo_id, body.apolloId),
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        title: firstNonEmptyString(lead.title, body.title),
        headline: firstNonEmptyString(lead.headline, body.headline),
        email: firstNonEmptyString(lead.email, body.email),
        phone: firstNonEmptyString(lead.phone, body.phone),
        linkedin_url: firstNonEmptyString(
            lead.linkedin_url,
            lead.linkedinUrl,
            body.linkedin_url,
            body.linkedin_profile_url,
            body.linkedinUrl,
            body.linkedinProfileUrl
        ),
        location: buildLocation(city, country, fallbackLocation),
        city,
        country,
        seniority: firstNonEmptyString(lead.seniority, body.seniority),
        department: firstNonEmptyString(lead.department, body.department),
    };
}

function normalizeCompany(body: AnyRecord): NormalizedCompany {
    const company = asRecord(body.company);

    const domain = normalizeDomain(
        firstNonEmptyString(
            company.domain,
            company.companyDomain,
            body.company_domain,
            body.companyDomain,
            body.domain
        )
    );

    const websiteUrl = firstNonEmptyString(company.website_url, company.websiteUrl, body.website_url, body.websiteUrl);

    return {
        name: firstNonEmptyString(company.name, company.companyName, body.company_name, body.companyName),
        domain,
        website_url: websiteUrl,
        linkedin_url: firstNonEmptyString(
            company.linkedin_url,
            company.linkedinUrl,
            body.company_linkedin_url,
            body.companyLinkedinUrl
        ),
        industry: firstNonEmptyString(company.industry, body.industry),
        size: firstNonEmptyString(company.size, company.employee_range, body.size, body.employee_range),
        country: firstNonEmptyString(company.country, body.company_country, body.country),
    };
}

function normalizeSellerContext(body: AnyRecord): NormalizedSellerContext {
    const seller = asRecord(body.seller_context);
    const sellerAlt = asRecord(body.sellerContext);
    const profile = asRecord(body.userCompanyProfile);

    return {
        company_name: firstNonEmptyString(seller.company_name, sellerAlt.company_name, profile.company_name, profile.companyName),
        company_domain: normalizeDomain(
            firstNonEmptyString(seller.company_domain, sellerAlt.company_domain, profile.company_domain, profile.companyDomain)
        ),
        sector: firstNonEmptyString(seller.sector, sellerAlt.sector, profile.sector),
        description: firstNonEmptyString(seller.description, sellerAlt.description, profile.description),
        services: stringArray(seller.services).length > 0 ? stringArray(seller.services) : stringArray(profile.services),
        value_proposition: firstNonEmptyString(seller.value_proposition, sellerAlt.value_proposition, profile.value_proposition, profile.valueProposition),
        proof_points: stringArray(seller.proof_points).length > 0 ? stringArray(seller.proof_points) : stringArray(profile.proof_points ?? profile.proofPoints),
        target_market: stringArray(seller.target_market).length > 0 ? stringArray(seller.target_market) : stringArray(profile.target_market ?? profile.targetMarket),
    };
}

function normalizeUserContext(body: AnyRecord): NormalizedUserContext {
    const user = asRecord(body.user_context);
    const userAlt = asRecord(body.userContext);

    return {
        id: firstNonEmptyString(user.id, userAlt.id, body.user_id, body.userId),
        name: firstNonEmptyString(user.name, userAlt.name, body.user_name, body.userName),
        job_title: firstNonEmptyString(user.job_title, user.jobTitle, userAlt.job_title, userAlt.jobTitle, body.user_job_title, body.userJobTitle),
    };
}

function normalizeOptions(body: AnyRecord): LeadResearchOptions {
    const options = asRecord(body.options);

    return {
        language: parseLanguage(options.language ?? body.language),
        depth: parseDepth(options.depth ?? body.depth),
        include_outreach_pack: parseBoolean(options.include_outreach_pack ?? options.includeOutreachPack ?? body.include_outreach_pack, true),
        include_company_research: parseBoolean(options.include_company_research ?? options.includeCompanyResearch ?? body.include_company_research, true),
        include_lead_research: parseBoolean(options.include_lead_research ?? options.includeLeadResearch ?? body.include_lead_research, true),
        include_recent_signals: parseBoolean(options.include_recent_signals ?? options.includeRecentSignals ?? body.include_recent_signals, true),
        include_call_prep: parseBoolean(options.include_call_prep ?? options.includeCallPrep ?? body.include_call_prep, true),
        include_competitive_context: parseBoolean(options.include_competitive_context ?? options.includeCompetitiveContext ?? body.include_competitive_context, true),
        include_raw_sources: parseBoolean(options.include_raw_sources ?? options.includeRawSources ?? body.include_raw_sources, true),
        max_sources: Math.min(Math.max(parseInteger(options.max_sources ?? options.maxSources ?? body.max_sources, 15), 3), 30),
        force_refresh: parseBoolean(options.force_refresh ?? options.forceRefresh ?? body.force_refresh, false),
    };
}

export function normalizeLeadResearchRequest(body: unknown): NormalizedLeadResearchInput {
    const input = asRecord(body);
    const lead = normalizeLead(input);
    const company = normalizeCompany(input);
    const sellerContext = normalizeSellerContext(input);
    const userContext = normalizeUserContext(input);
    const options = normalizeOptions(input);

    const leadRef =
        firstNonEmptyString(input.lead_ref, input.leadRef, lead.id, lead.apollo_id, lead.linkedin_url, company.domain, company.name) ||
        null;

    const normalized: NormalizedLeadResearchInput = {
        user_id: firstNonEmptyString(input.user_id, input.userId, userContext.id),
        organization_id: firstNonEmptyString(input.organization_id, input.organizationId),
        lead_ref: leadRef,
        lead,
        company,
        seller_context: sellerContext,
        user_context: userContext,
        options,
    };

    const hasLeadAnchor = Boolean(normalized.lead.full_name || normalized.lead.linkedin_url || normalized.lead.apollo_id);
    const hasCompanyAnchor = Boolean(normalized.company.name || normalized.company.domain);

    if (!hasLeadAnchor && !hasCompanyAnchor) {
        throw new Error('At least one lead or company identifier is required');
    }

    return normalized;
}

export function buildLeadResearchAnchorSummary(input: NormalizedLeadResearchInput): string[] {
    const anchors: string[] = [];

    if (input.lead.full_name) anchors.push(`Lead: ${input.lead.full_name}`);
    if (input.lead.title) anchors.push(`Role: ${input.lead.title}`);
    if (input.lead.linkedin_url) anchors.push(`Lead LinkedIn: ${input.lead.linkedin_url}`);
    if (input.company.name) anchors.push(`Company: ${input.company.name}`);
    if (input.company.domain) anchors.push(`Company domain: ${input.company.domain}`);
    if (input.company.website_url) anchors.push(`Company website: ${input.company.website_url}`);
    if (input.company.industry) anchors.push(`Industry: ${input.company.industry}`);

    return anchors;
}

export function createCacheFingerprint(input: NormalizedLeadResearchInput, includeDepth = true): string {
    const payload = {
        user_id: input.user_id,
        organization_id: input.organization_id,
        lead_ref: input.lead_ref,
        lead: input.lead,
        company: input.company,
        seller_context: input.seller_context,
        user_context: input.user_context,
        options: includeDepth
            ? input.options
            : {
                ...input.options,
                depth: undefined,
                force_refresh: undefined,
            },
    };

    return JSON.stringify(payload);
}
