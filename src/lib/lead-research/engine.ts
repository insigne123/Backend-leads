import { buildCrossReport, buildEnhancedReport } from './compat';
import { buildResearchSectionPlans, ResearchSectionPlan } from './query-plan';
import {
    BuyerIntelligence,
    CompanyContext,
    CompetitiveContext,
    Diagnostics,
    IceBreaker,
    LeadResearchCostEstimate,
    LeadContext,
    LeadResearchApiResponse,
    LeadResearchReport,
    LeadResearchSource,
    NormalizedLeadResearchInput,
    OutreachPack,
    ProcessedLeadResearchResult,
    SectionExecutionDiagnostics,
    SignalItem,
    WebsiteSummary,
} from './types';
import { callVaneSearch, extractJsonFromMessage } from './vane';

type SourceCatalogEntry = LeadResearchSource & {
    url: string;
};

type SectionExecutionResult = SectionExecutionDiagnostics & {
    payload: Record<string, any>;
    providerVersion: string | null;
    sources: Array<{ title: string; url: string; content: string }>;
    referencedUrls: string[];
};

function buildEmptyCostEstimate(): LeadResearchCostEstimate {
    return {
        currency: 'USD',
        model: null,
        estimated_input_tokens: 0,
        estimated_output_tokens: 0,
        estimated_total_tokens: 0,
        estimated_cost_usd: null,
        methodology: 'heuristic',
        note: 'Estimated from Vane request/response sizes and model pricing. It is not exact because Vane does not expose provider usage per request.',
    };
}

function defaultWebsiteSummary(): WebsiteSummary {
    return {
        overview: null,
        services: [],
        positioning: null,
        source_ids: [],
    };
}

function defaultLeadContext(): LeadContext {
    return {
        profile_summary: null,
        role_summary: null,
        likely_responsibilities: [],
        seniority_assessment: 'unknown',
        department: null,
        tenure_hint: null,
        recent_activity_summary: null,
        found_recent_activity: false,
        ice_breakers: [],
    };
}

function defaultCompanyContext(): CompanyContext {
    return {
        overview: null,
        business_model: null,
        industry_context: null,
        likely_priorities: [],
        growth_signals: [],
        pain_hypotheses: [],
        opportunity_hypotheses: [],
        risks: [],
    };
}

function defaultBuyerIntelligence(): BuyerIntelligence {
    return {
        relevance_summary: null,
        fit_score: null,
        fit_reasons: [],
        urgency_signals: [],
        recommended_angle: 'custom',
        recommended_channel: 'email',
        recommended_cta: '15 min intro call',
        best_contact_timing_hint: null,
        likely_objections: [],
    };
}

function defaultOutreachPack(): OutreachPack {
    return {
        one_liner: null,
        personalized_openers: [],
        talk_tracks: [],
        subject_lines: [],
        email_drafts: {
            short: { subject: null, body: null },
            medium: { subject: null, body: null },
            challenger: { subject: null, body: null },
        },
        linkedin_dm_variants: [],
        call_openers: [],
        call_script: {
            opening: null,
            discovery_questions: [],
            value_bridge: null,
            cta: null,
        },
        voicemail_script: null,
        follow_up_sequence: [],
    };
}

function defaultCompetitiveContext(): CompetitiveContext {
    return {
        competitor_mentions: [],
        tech_stack_detected: [],
        buying_committee_suggestions: [],
        source_ids: [],
    };
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function normalizeSourceUrls(value: unknown): string[] {
    return normalizeStringArray(value);
}

function normalizeConfidence(value: unknown, fallback = 0.5): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value));
    }

    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.min(1, parsed));
        }
    }

    return fallback;
}

function inferSourceType(url: string, companyDomain: string | null): LeadResearchSource['type'] {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
        const path = parsed.pathname.toLowerCase();

        if (hostname.includes('linkedin.com')) return 'linkedin';
        if (companyDomain && hostname === companyDomain) return 'company_site';
        if (path.includes('/careers') || path.includes('/jobs')) return 'job_post';
        if (hostname.includes('facebook.com') || hostname.includes('x.com') || hostname.includes('twitter.com') || hostname.includes('instagram.com')) return 'social';
        if (hostname.includes('news') || hostname.includes('medium.com') || path.includes('/news') || path.includes('/blog')) return 'news';
        if (path.includes('/blog')) return 'blog';
        if (hostname.includes('crunchbase') || hostname.includes('apollo') || hostname.includes('zoominfo')) return 'directory';
    } catch {
        return 'other';
    }

    return 'other';
}

function inferTrustLevel(url: string, companyDomain: string | null): LeadResearchSource['trust_level'] {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

        if (companyDomain && hostname === companyDomain) return 'high';
        if (hostname.includes('linkedin.com')) return 'high';
        if (hostname.includes('gov') || hostname.includes('edu')) return 'high';
        if (hostname.includes('crunchbase') || hostname.includes('techcrunch') || hostname.includes('forbes') || hostname.includes('bloomberg')) {
            return 'medium';
        }
    } catch {
        return 'low';
    }

    return 'medium';
}

function urlDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

function collectSourceUrls(value: unknown, collector: Set<string>) {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
        value.forEach((entry) => collectSourceUrls(entry, collector));
        return;
    }

    const record = value as Record<string, any>;

    if (Array.isArray(record.source_urls)) {
        record.source_urls
            .filter((entry: unknown): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .forEach((url) => collector.add(url));
    }

    Object.values(record).forEach((entry) => collectSourceUrls(entry, collector));
}

function applySourceIds<T>(value: T, sourceIdByUrl: Map<string, string>): T {
    if (!value || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
        return value.map((entry) => applySourceIds(entry, sourceIdByUrl)) as T;
    }

    const record = value as Record<string, any>;
    const next: Record<string, any> = {};

    for (const [key, entry] of Object.entries(record)) {
        if (key === 'source_urls') {
            const ids = Array.isArray(entry)
                ? Array.from(
                    new Set(
                        entry
                            .filter((url): url is string => typeof url === 'string')
                            .map((url) => sourceIdByUrl.get(url.trim()))
                            .filter((id): id is string => Boolean(id))
                    )
                )
                : [];

            next.source_ids = ids;
            continue;
        }

        next[key] = applySourceIds(entry, sourceIdByUrl);
    }

    return next as T;
}

function collectSourceIds(value: unknown, collector: Set<string>) {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
        value.forEach((entry) => collectSourceIds(entry, collector));
        return;
    }

    const record = value as Record<string, any>;

    if (Array.isArray(record.source_ids)) {
        record.source_ids
            .filter((entry: unknown): entry is string => typeof entry === 'string')
            .forEach((id) => collector.add(id));
    }

    Object.values(record).forEach((entry) => collectSourceIds(entry, collector));
}

function normalizeSignals(value: unknown): SignalItem[] {
    if (!Array.isArray(value)) return [];

    const signals: SignalItem[] = [];

    value.forEach((entry) => {
        const item = entry as Record<string, any>;
        const title = normalizeString(item.title);
        const summary = normalizeString(item.summary);
        const url = normalizeString(item.url);

        if (!title || !summary || !url) return;

        const type = normalizeString(item.type) as SignalItem['type'] | null;
        const importance = normalizeString(item.importance) as SignalItem['importance'] | null;

        signals.push({
            type: type && ['news', 'hiring', 'tech', 'site', 'social', 'financial', 'product', 'expansion'].includes(type)
                ? type
                : 'news',
            title,
            summary,
            url,
            published_at: normalizeString(item.published_at),
            importance: importance && ['high', 'medium', 'low'].includes(importance)
                ? importance
                : 'medium',
            source_ids: [],
            source_urls: normalizeSourceUrls(item.source_urls),
        } as SignalItem & { source_urls: string[] });
    });

    return signals;
}

function normalizeIceBreakers(value: unknown): IceBreaker[] {
    if (!Array.isArray(value)) return [];

    const iceBreakers: IceBreaker[] = [];

    value.forEach((entry) => {
        const item = entry as Record<string, any>;
        const text = normalizeString(item.text);
        const whyItWorks = normalizeString(item.why_it_works);

        if (!text || !whyItWorks) return;

        iceBreakers.push({
            text,
            why_it_works: whyItWorks,
            source_ids: [],
            source_urls: normalizeSourceUrls(item.source_urls),
        } as IceBreaker & { source_urls: string[] });
    });

    return iceBreakers;
}

function deepMergeReport(report: LeadResearchReport, payload: Record<string, any>) {
    if (payload.website_summary) {
        report.website_summary = {
            overview: normalizeString(payload.website_summary.overview),
            services: normalizeStringArray(payload.website_summary.services),
            positioning: normalizeString(payload.website_summary.positioning),
            source_ids: [],
            source_urls: normalizeSourceUrls(payload.website_summary.source_urls),
        } as WebsiteSummary & { source_urls: string[] };
    }

    if (payload.company_context) {
        report.company_context = {
            overview: normalizeString(payload.company_context.overview),
            business_model: normalizeString(payload.company_context.business_model),
            industry_context: normalizeString(payload.company_context.industry_context),
            likely_priorities: normalizeStringArray(payload.company_context.likely_priorities),
            growth_signals: normalizeStringArray(payload.company_context.growth_signals),
            pain_hypotheses: Array.isArray(payload.company_context.pain_hypotheses)
                ? payload.company_context.pain_hypotheses
                    .map((entry: any) => {
                        const title = normalizeString(entry?.title);
                        const detail = normalizeString(entry?.detail);
                        if (!title || !detail) return null;
                        return {
                            title,
                            detail,
                            confidence: normalizeConfidence(entry?.confidence, 0.55),
                            source_ids: [],
                            source_urls: normalizeSourceUrls(entry?.source_urls),
                        };
                    })
                    .filter(Boolean)
                : [],
            opportunity_hypotheses: Array.isArray(payload.company_context.opportunity_hypotheses)
                ? payload.company_context.opportunity_hypotheses
                    .map((entry: any) => {
                        const title = normalizeString(entry?.title);
                        const detail = normalizeString(entry?.detail);
                        if (!title || !detail) return null;
                        return {
                            title,
                            detail,
                            confidence: normalizeConfidence(entry?.confidence, 0.55),
                            source_ids: [],
                            source_urls: normalizeSourceUrls(entry?.source_urls),
                        };
                    })
                    .filter(Boolean)
                : [],
            risks: Array.isArray(payload.company_context.risks)
                ? payload.company_context.risks
                    .map((entry: any) => {
                        const title = normalizeString(entry?.title);
                        const detail = normalizeString(entry?.detail);
                        if (!title || !detail) return null;
                        return {
                            title,
                            detail,
                            source_ids: [],
                            source_urls: normalizeSourceUrls(entry?.source_urls),
                        };
                    })
                    .filter(Boolean)
                : [],
        };
    }

    if (payload.signals) {
        report.signals = normalizeSignals(payload.signals);
    }

    if (payload.lead_context) {
        report.lead_context = {
            profile_summary: normalizeString(payload.lead_context.profile_summary),
            role_summary: normalizeString(payload.lead_context.role_summary),
            likely_responsibilities: normalizeStringArray(payload.lead_context.likely_responsibilities),
            seniority_assessment: ['decision_maker', 'influencer', 'champion', 'unknown'].includes(payload.lead_context.seniority_assessment)
                ? payload.lead_context.seniority_assessment
                : 'unknown',
            department: normalizeString(payload.lead_context.department),
            tenure_hint: normalizeString(payload.lead_context.tenure_hint),
            recent_activity_summary: normalizeString(payload.lead_context.recent_activity_summary),
            found_recent_activity: Boolean(payload.lead_context.found_recent_activity),
            ice_breakers: normalizeIceBreakers(payload.lead_context.ice_breakers),
        };
    }

    if (payload.buyer_intelligence) {
        report.buyer_intelligence = {
            relevance_summary: normalizeString(payload.buyer_intelligence.relevance_summary),
            fit_score: typeof payload.buyer_intelligence.fit_score === 'number'
                ? Math.max(0, Math.min(100, Math.round(payload.buyer_intelligence.fit_score)))
                : null,
            fit_reasons: normalizeStringArray(payload.buyer_intelligence.fit_reasons),
            urgency_signals: normalizeStringArray(payload.buyer_intelligence.urgency_signals),
            recommended_angle: ['cost_saving', 'efficiency', 'growth', 'risk', 'speed', 'talent', 'custom'].includes(payload.buyer_intelligence.recommended_angle)
                ? payload.buyer_intelligence.recommended_angle
                : 'custom',
            recommended_channel: ['email', 'linkedin', 'call'].includes(payload.buyer_intelligence.recommended_channel)
                ? payload.buyer_intelligence.recommended_channel
                : 'email',
            recommended_cta: normalizeString(payload.buyer_intelligence.recommended_cta),
            best_contact_timing_hint: normalizeString(payload.buyer_intelligence.best_contact_timing_hint),
            likely_objections: Array.isArray(payload.buyer_intelligence.likely_objections)
                ? payload.buyer_intelligence.likely_objections
                    .map((entry: any) => {
                        const objection = normalizeString(entry?.objection);
                        const rebuttal = normalizeString(entry?.rebuttal);
                        if (!objection || !rebuttal) return null;
                        return {
                            objection,
                            rebuttal,
                            confidence: normalizeConfidence(entry?.confidence, 0.55),
                        };
                    })
                    .filter(Boolean)
                : [],
        };
    }

    if (payload.outreach_pack) {
        report.outreach_pack = {
            one_liner: normalizeString(payload.outreach_pack.one_liner),
            personalized_openers: Array.isArray(payload.outreach_pack.personalized_openers)
                ? payload.outreach_pack.personalized_openers
                    .map((entry: any) => {
                        const text = normalizeString(entry?.text);
                        const channel = normalizeString(entry?.channel) as 'email' | 'linkedin' | 'call' | null;
                        if (!text || !channel || !['email', 'linkedin', 'call'].includes(channel)) return null;
                        return { channel, text, source_ids: [], source_urls: normalizeSourceUrls(entry?.source_urls) };
                    })
                    .filter(Boolean)
                : [],
            talk_tracks: normalizeStringArray(payload.outreach_pack.talk_tracks),
            subject_lines: normalizeStringArray(payload.outreach_pack.subject_lines),
            email_drafts: {
                short: {
                    subject: normalizeString(payload.outreach_pack.email_drafts?.short?.subject),
                    body: normalizeString(payload.outreach_pack.email_drafts?.short?.body),
                },
                medium: {
                    subject: normalizeString(payload.outreach_pack.email_drafts?.medium?.subject),
                    body: normalizeString(payload.outreach_pack.email_drafts?.medium?.body),
                },
                challenger: {
                    subject: normalizeString(payload.outreach_pack.email_drafts?.challenger?.subject),
                    body: normalizeString(payload.outreach_pack.email_drafts?.challenger?.body),
                },
            },
            linkedin_dm_variants: Array.isArray(payload.outreach_pack.linkedin_dm_variants)
                ? payload.outreach_pack.linkedin_dm_variants
                    .map((entry: any) => {
                        const style = normalizeString(entry?.style) as 'soft' | 'direct' | 'executive' | null;
                        const text = normalizeString(entry?.text);
                        if (!text || !style || !['soft', 'direct', 'executive'].includes(style)) return null;
                        return { style, text };
                    })
                    .filter(Boolean)
                : [],
            call_openers: normalizeStringArray(payload.outreach_pack.call_openers),
            call_script: {
                opening: normalizeString(payload.outreach_pack.call_script?.opening),
                discovery_questions: normalizeStringArray(payload.outreach_pack.call_script?.discovery_questions),
                value_bridge: normalizeString(payload.outreach_pack.call_script?.value_bridge),
                cta: normalizeString(payload.outreach_pack.call_script?.cta),
            },
            voicemail_script: normalizeString(payload.outreach_pack.voicemail_script),
            follow_up_sequence: Array.isArray(payload.outreach_pack.follow_up_sequence)
                ? payload.outreach_pack.follow_up_sequence
                    .map((entry: any, index: number) => {
                        const channel = normalizeString(entry?.channel) as 'email' | 'linkedin' | 'call' | null;
                        const body = normalizeString(entry?.body);
                        if (!channel || !body || !['email', 'linkedin', 'call'].includes(channel)) return null;
                        return {
                            step: typeof entry?.step === 'number' ? entry.step : index + 1,
                            channel,
                            delay_days: typeof entry?.delay_days === 'number' ? entry.delay_days : 0,
                            goal: normalizeString(entry?.goal) || 'follow_up',
                            subject: normalizeString(entry?.subject),
                            body,
                        };
                    })
                    .filter(Boolean)
                : [],
        };
    }

    if (payload.competitive_context) {
        report.competitive_context = {
            competitor_mentions: normalizeStringArray(payload.competitive_context.competitor_mentions),
            tech_stack_detected: normalizeStringArray(payload.competitive_context.tech_stack_detected),
            buying_committee_suggestions: normalizeStringArray(payload.competitive_context.buying_committee_suggestions),
            source_ids: [],
            source_urls: normalizeSourceUrls(payload.competitive_context.source_urls),
        } as CompetitiveContext & { source_urls: string[] };
    }
}

function buildEmptyReport(input: NormalizedLeadResearchInput, reportId: string): LeadResearchReport {
    return {
        report_id: reportId,
        lead_ref: input.lead_ref,
        status: 'insufficient_data',
        requested_depth: input.options.depth,
        completed_depth: input.options.depth,
        generated_at: new Date().toISOString(),
        cache_hit: false,
        provider: 'vane',
        provider_version: null,
        duration_ms: 0,
        warnings: [],
        errors: [],
        coverage: {
            company: 'low',
            lead: 'low',
            recent_signals: 'low',
            contact_strategy: 'low',
        },
        lead: input.lead,
        company: input.company,
        website_summary: defaultWebsiteSummary(),
        signals: [],
        lead_context: defaultLeadContext(),
        company_context: defaultCompanyContext(),
        buyer_intelligence: defaultBuyerIntelligence(),
        outreach_pack: defaultOutreachPack(),
        competitive_context: defaultCompetitiveContext(),
        existing_compat: {
            cross: {} as any,
            enhanced: {} as any,
        },
        sources: [],
        diagnostics: {
            queries: [],
            searched_domains: [input.company.domain, input.company.website_url, input.lead.linkedin_url]
                .filter(Boolean)
                .map((value) => (value as string).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]),
            search_depth: input.options.depth,
            sections_completed: [],
            sections_missing: [],
            raw_hits_count: 0,
            vane_calls: [],
            total_vane_duration_ms: 0,
            estimated_cost: buildEmptyCostEstimate(),
        },
        can_upgrade_to_deep: input.options.depth !== 'deep',
        deep_available: input.options.depth !== 'deep',
    };
}

function createSourceCatalog(companyDomain: string | null) {
    const entries = new Map<string, SourceCatalogEntry>();

    return {
        add(url: string, title: string, snippet: string) {
            const cleanUrl = url.trim();
            if (!cleanUrl) return;

            if (!entries.has(cleanUrl)) {
                const id = `src_${entries.size + 1}`;
                entries.set(cleanUrl, {
                    id,
                    type: inferSourceType(cleanUrl, companyDomain),
                    title: title || urlDomain(cleanUrl) || cleanUrl,
                    url: cleanUrl,
                    domain: urlDomain(cleanUrl),
                    published_at: null,
                    snippet: snippet || '',
                    relevance_score: Math.max(0.1, 1 - entries.size * 0.03),
                    trust_level: inferTrustLevel(cleanUrl, companyDomain),
                });
            } else if (snippet) {
                const current = entries.get(cleanUrl)!;
                if (!current.snippet) {
                    current.snippet = snippet;
                }
            }
        },
        toArray(): LeadResearchSource[] {
            return Array.from(entries.values());
        },
        idByUrl(): Map<string, string> {
            const map = new Map<string, string>();
            entries.forEach((value, key) => map.set(key, value.id));
            return map;
        },
    };
}

function computeCoverage(report: LeadResearchReport): LeadResearchReport['coverage'] {
    const companyEvidence = Number(Boolean(report.website_summary.overview)) + report.company_context.pain_hypotheses.length + report.company_context.opportunity_hypotheses.length;
    const leadEvidence = Number(Boolean(report.lead_context.profile_summary)) + Number(Boolean(report.lead_context.role_summary)) + report.lead_context.ice_breakers.length;
    const signalEvidence = report.signals.length;
    const contactEvidence = report.outreach_pack.talk_tracks.length + report.outreach_pack.subject_lines.length + Number(Boolean(report.outreach_pack.email_drafts.medium.body));

    const toLevel = (score: number): 'high' | 'medium' | 'low' => {
        if (score >= 4) return 'high';
        if (score >= 2) return 'medium';
        return 'low';
    };

    return {
        company: toLevel(companyEvidence),
        lead: toLevel(leadEvidence),
        recent_signals: toLevel(signalEvidence),
        contact_strategy: toLevel(contactEvidence),
    };
}

function computeStatus(report: LeadResearchReport): LeadResearchReport['status'] {
    const sectionCount = report.diagnostics.sections_completed.length;
    const sourceCount = report.sources.length;

    if (sectionCount === 0 || sourceCount < 2) return 'insufficient_data';
    if (report.diagnostics.sections_missing.length > 0) return 'partial';
    return 'completed';
}

function buildApiResponse(report: LeadResearchReport): LeadResearchApiResponse {
    return {
        ...report,
        report,
        reports: [report],
    };
}

function hasDataForSection(planSection: ResearchSectionPlan['sections'][number], report: LeadResearchReport): boolean {
    switch (planSection) {
        case 'company_research':
            return Boolean(report.website_summary.overview || report.company_context.overview);
        case 'recent_signals':
            return report.signals.length > 0;
        case 'lead_research':
            return Boolean(
                report.lead_context.profile_summary ||
                report.lead_context.role_summary ||
                report.lead_context.ice_breakers.length > 0
            );
        case 'buyer_intelligence':
            return Boolean(
                report.buyer_intelligence.relevance_summary ||
                report.outreach_pack.talk_tracks.length > 0 ||
                report.outreach_pack.subject_lines.length > 0
            );
        case 'competitive_context':
            return report.competitive_context.competitor_mentions.length > 0 || report.competitive_context.tech_stack_detected.length > 0;
        case 'call_prep':
            return Boolean(report.outreach_pack.call_script.opening || report.outreach_pack.follow_up_sequence.length > 0);
        default:
            return false;
    }
}

function applyPlanDiagnostics(
    plan: ResearchSectionPlan,
    sectionDiagnostics: SectionExecutionResult,
    report: LeadResearchReport,
    sourceCatalog: ReturnType<typeof createSourceCatalog>,
    rawSectionDiagnostics: SectionExecutionDiagnostics[]
) {
    rawSectionDiagnostics.push({
        section: sectionDiagnostics.section,
        query: sectionDiagnostics.query,
        raw_source_count: sectionDiagnostics.raw_source_count,
        warnings: sectionDiagnostics.warnings,
        duration_ms: sectionDiagnostics.duration_ms,
        estimated_input_tokens: sectionDiagnostics.estimated_input_tokens,
        estimated_output_tokens: sectionDiagnostics.estimated_output_tokens,
        estimated_total_tokens: sectionDiagnostics.estimated_total_tokens,
        estimated_cost_usd: sectionDiagnostics.estimated_cost_usd,
        model: sectionDiagnostics.model,
        sections: sectionDiagnostics.sections,
    });

    if (sectionDiagnostics.providerVersion) {
        report.provider_version = sectionDiagnostics.providerVersion;
    }

    sectionDiagnostics.sources.forEach((source) => {
        sourceCatalog.add(source.url, source.title, source.content);
    });
    sectionDiagnostics.referencedUrls.forEach((url) => {
        sourceCatalog.add(url, urlDomain(url) || 'Referenced source', '');
    });

    if (Object.keys(sectionDiagnostics.payload).length > 0) {
        deepMergeReport(report, sectionDiagnostics.payload);
    }

    if (sectionDiagnostics.warnings.length > 0) {
        report.warnings.push(...sectionDiagnostics.warnings);
    }

    report.diagnostics.raw_hits_count += sectionDiagnostics.raw_source_count;
    report.diagnostics.total_vane_duration_ms += sectionDiagnostics.duration_ms;
    report.diagnostics.vane_calls.push({
        key: plan.key,
        sections: plan.sections,
        duration_ms: sectionDiagnostics.duration_ms,
        raw_source_count: sectionDiagnostics.raw_source_count,
        estimated_input_tokens: sectionDiagnostics.estimated_input_tokens,
        estimated_output_tokens: sectionDiagnostics.estimated_output_tokens,
        estimated_total_tokens: sectionDiagnostics.estimated_total_tokens,
        estimated_cost_usd: sectionDiagnostics.estimated_cost_usd,
        model: sectionDiagnostics.model,
        warnings: sectionDiagnostics.warnings,
    });

    plan.sections.forEach((section) => {
        const sectionHasData = hasDataForSection(section, report);

        if (sectionHasData) {
            if (!report.diagnostics.sections_completed.includes(section)) {
                report.diagnostics.sections_completed.push(section);
            }
            report.diagnostics.sections_missing = report.diagnostics.sections_missing.filter((item) => item !== section);
        } else if (!report.diagnostics.sections_missing.includes(section)) {
            report.diagnostics.sections_missing.push(section);
        }
    });
}

async function executeSection(
    plan: ResearchSectionPlan,
): Promise<SectionExecutionResult> {
    const warnings: string[] = [];

    const searchResult = await callVaneSearch({
        query: plan.query,
        systemInstructions: plan.systemInstructions,
        sources: plan.sources,
        optimizationMode: plan.optimizationMode,
    });

    let parsedPayload: Record<string, any> = {};

    try {
        parsedPayload = extractJsonFromMessage<Record<string, any>>(searchResult.message);
    } catch (error: any) {
        warnings.push(`Could not parse JSON for section ${plan.key}: ${error.message}`);
    }

    const discoveredUrls = new Set<string>();
    collectSourceUrls(parsedPayload, discoveredUrls);

    return {
        section: plan.key,
        query: plan.query,
        raw_source_count: searchResult.sources.length,
        warnings,
        duration_ms: searchResult.durationMs,
        estimated_input_tokens: searchResult.estimatedInputTokens,
        estimated_output_tokens: searchResult.estimatedOutputTokens,
        estimated_total_tokens: searchResult.estimatedTotalTokens,
        estimated_cost_usd: searchResult.estimatedCostUsd,
        model: searchResult.model,
        sections: plan.sections,
        payload: parsedPayload,
        providerVersion: searchResult.providerVersion,
        sources: searchResult.sources,
        referencedUrls: Array.from(discoveredUrls),
    };
}

export async function runLeadResearch(
    input: NormalizedLeadResearchInput,
    reportId: string
): Promise<ProcessedLeadResearchResult> {
    const start = Date.now();
    const report = buildEmptyReport(input, reportId);
    const plans = buildResearchSectionPlans(input);
    const sourceCatalog = createSourceCatalog(input.company.domain);
    const rawSectionDiagnostics: SectionExecutionDiagnostics[] = [];

    const sectionResults = await Promise.allSettled(plans.map((plan) => executeSection(plan)));

    for (let index = 0; index < sectionResults.length; index += 1) {
        const result = sectionResults[index];
        const plan = plans[index];
        report.diagnostics.queries.push(plan.query);

        if (result.status === 'rejected') {
            const errorMessage = result.reason?.message || String(result.reason);
            rawSectionDiagnostics.push({
                section: plan.key,
                query: plan.query,
                raw_source_count: 0,
                warnings: [`Section ${plan.key} failed: ${errorMessage}`],
                duration_ms: 0,
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_tokens: 0,
                estimated_cost_usd: null,
                model: null,
                sections: plan.sections,
            });
            report.warnings.push(`Section ${plan.key} failed: ${errorMessage}`);
            plan.sections.forEach((section) => {
                if (!report.diagnostics.sections_missing.includes(section)) {
                    report.diagnostics.sections_missing.push(section);
                }
            });
            continue;
        }

        const sectionDiagnostics = result.value;
        applyPlanDiagnostics(plan, sectionDiagnostics, report, sourceCatalog, rawSectionDiagnostics);

        const parseFailed = sectionDiagnostics.warnings.some((warning) => warning.includes('Could not parse JSON'));
        if (parseFailed && plan.fallbackPlans && plan.fallbackPlans.length > 0) {
            report.warnings.push(`Bundle fallback activated for ${plan.key}.`);

            const fallbackResults = await Promise.allSettled(plan.fallbackPlans.map((fallbackPlan) => executeSection(fallbackPlan)));

            fallbackResults.forEach((fallbackResult, fallbackIndex) => {
                const fallbackPlan = plan.fallbackPlans![fallbackIndex];
                report.diagnostics.queries.push(fallbackPlan.query);

                if (fallbackResult.status === 'rejected') {
                    const errorMessage = fallbackResult.reason?.message || String(fallbackResult.reason);
                    rawSectionDiagnostics.push({
                        section: fallbackPlan.key,
                        query: fallbackPlan.query,
                        raw_source_count: 0,
                        warnings: [`Section ${fallbackPlan.key} failed: ${errorMessage}`],
                        duration_ms: 0,
                        estimated_input_tokens: 0,
                        estimated_output_tokens: 0,
                        estimated_total_tokens: 0,
                        estimated_cost_usd: null,
                        model: null,
                        sections: fallbackPlan.sections,
                    });
                    report.warnings.push(`Section ${fallbackPlan.key} failed: ${errorMessage}`);
                    fallbackPlan.sections.forEach((section) => {
                        if (!report.diagnostics.sections_missing.includes(section)) {
                            report.diagnostics.sections_missing.push(section);
                        }
                    });
                    return;
                }

                applyPlanDiagnostics(fallbackPlan, fallbackResult.value, report, sourceCatalog, rawSectionDiagnostics);
            });
        }
    }

    const allSources = sourceCatalog.toArray();
    const sourceIdByUrl = new Map(allSources.map((source) => [source.url, source.id]));

    report.website_summary = applySourceIds(report.website_summary, sourceIdByUrl);
    report.company_context = applySourceIds(report.company_context, sourceIdByUrl);
    report.lead_context = applySourceIds(report.lead_context, sourceIdByUrl);
    report.buyer_intelligence = applySourceIds(report.buyer_intelligence, sourceIdByUrl);
    report.outreach_pack = applySourceIds(report.outreach_pack, sourceIdByUrl);
    report.competitive_context = applySourceIds(report.competitive_context, sourceIdByUrl);
    report.signals = applySourceIds(report.signals, sourceIdByUrl);

    const referencedSourceIds = new Set<string>();
    collectSourceIds(report.website_summary, referencedSourceIds);
    collectSourceIds(report.company_context, referencedSourceIds);
    collectSourceIds(report.lead_context, referencedSourceIds);
    collectSourceIds(report.buyer_intelligence, referencedSourceIds);
    collectSourceIds(report.outreach_pack, referencedSourceIds);
    collectSourceIds(report.competitive_context, referencedSourceIds);
    collectSourceIds(report.signals, referencedSourceIds);

    const essentialSources = allSources.filter((source) => referencedSourceIds.has(source.id));
    const additionalSources = allSources.filter((source) => !referencedSourceIds.has(source.id));
    const sourceLimit = Math.max(input.options.max_sources, essentialSources.length);
    report.sources = input.options.include_raw_sources
        ? [...essentialSources, ...additionalSources].slice(0, sourceLimit)
        : essentialSources;

    report.coverage = computeCoverage(report);
    report.status = computeStatus(report);
    report.duration_ms = Date.now() - start;
    report.generated_at = new Date().toISOString();
    const totalEstimatedInputTokens = report.diagnostics.vane_calls.reduce((sum, call) => sum + call.estimated_input_tokens, 0);
    const totalEstimatedOutputTokens = report.diagnostics.vane_calls.reduce((sum, call) => sum + call.estimated_output_tokens, 0);
    const estimatedCosts = report.diagnostics.vane_calls
        .map((call) => call.estimated_cost_usd)
        .filter((value): value is number => typeof value === 'number');
    report.diagnostics.estimated_cost = {
        currency: 'USD',
        model: report.diagnostics.vane_calls[0]?.model || null,
        estimated_input_tokens: totalEstimatedInputTokens,
        estimated_output_tokens: totalEstimatedOutputTokens,
        estimated_total_tokens: totalEstimatedInputTokens + totalEstimatedOutputTokens,
        estimated_cost_usd: estimatedCosts.length > 0
            ? Number(estimatedCosts.reduce((sum, value) => sum + value, 0).toFixed(6))
            : null,
        methodology: 'heuristic',
        note: 'Estimated from Vane request/response sizes and known model pricing. It is useful for budgeting, but not exact provider billing.',
    };
    report.existing_compat = {
        cross: buildCrossReport(report),
        enhanced: buildEnhancedReport(report),
    };

    const response = buildApiResponse(report);

    return {
        report: response,
        diagnostics: report.diagnostics,
        raw_section_diagnostics: rawSectionDiagnostics,
    };
}
