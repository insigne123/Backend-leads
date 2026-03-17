import { buildLeadResearchAnchorSummary } from './normalize';
import {
    LeadResearchDepth,
    NormalizedLeadResearchInput,
    SearchSourceType,
} from './types';

export type ResearchSectionKey =
    | 'company_research'
    | 'recent_signals'
    | 'lead_research'
    | 'buyer_intelligence'
    | 'competitive_context'
    | 'call_prep';

export type ResearchSectionPlan = {
    key: string;
    sections: ResearchSectionKey[];
    query: string;
    systemInstructions: string;
    sources: SearchSourceType[];
    optimizationMode: 'speed' | 'balanced' | 'quality';
    fallbackPlans?: ResearchSectionPlan[];
};

function languageInstruction(language: 'es' | 'en'): string {
    return language === 'es'
        ? 'Write all narrative fields in neutral, professional Spanish.'
        : 'Write all narrative fields in professional English.';
}

function sharedRules(language: 'es' | 'en'): string {
    return [
        languageInstruction(language),
        'Return ONLY valid JSON. No markdown fences. No commentary outside JSON.',
        'Do not invent facts. If evidence is weak or unavailable, use null, empty arrays, and lower confidence.',
        'For every major claim, include source_urls with exact URLs from the evidence.',
        'If something is a hypothesis, make it clearly inferential and assign a confidence between 0 and 1.',
    ].join(' ');
}

function buildSellerContextText(input: NormalizedLeadResearchInput): string {
    const seller = input.seller_context;

    const parts = [
        seller.company_name ? `Seller company: ${seller.company_name}.` : '',
        seller.company_domain ? `Seller domain: ${seller.company_domain}.` : '',
        seller.sector ? `Seller sector: ${seller.sector}.` : '',
        seller.description ? `Seller description: ${seller.description}.` : '',
        seller.services.length > 0 ? `Seller services: ${seller.services.join(', ')}.` : '',
        seller.value_proposition ? `Value proposition: ${seller.value_proposition}.` : '',
        seller.proof_points.length > 0 ? `Proof points: ${seller.proof_points.join('; ')}.` : '',
        seller.target_market.length > 0 ? `Target market: ${seller.target_market.join(', ')}.` : '',
    ];

    return parts.filter(Boolean).join(' ');
}

function buildEntityContextText(input: NormalizedLeadResearchInput): string {
    const anchors = buildLeadResearchAnchorSummary(input);
    const lead = input.lead;

    const extra = [
        lead.headline ? `Headline: ${lead.headline}.` : '',
        lead.location ? `Location: ${lead.location}.` : '',
        lead.seniority ? `Seniority: ${lead.seniority}.` : '',
        lead.department ? `Department: ${lead.department}.` : '',
    ].filter(Boolean);

    return [...anchors, ...extra].join(' ');
}

function sectionMode(depth: LeadResearchDepth): 'speed' | 'balanced' | 'quality' {
    if (depth === 'light') return 'speed';
    if (depth === 'standard') return 'speed';
    if (depth === 'deep') return 'quality';
    return 'speed';
}

function companyResearchInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Focus on official website, company pages, newsroom, careers pages, reliable directories, and credible public sources.',
        'Return JSON with this schema:',
        '{"website_summary":{"overview":string|null,"services":string[],"positioning":string|null,"source_urls":string[]},"company_context":{"overview":string|null,"business_model":string|null,"industry_context":string|null,"likely_priorities":string[],"growth_signals":string[],"pain_hypotheses":[{"title":string,"detail":string,"confidence":number,"source_urls":string[]}],"opportunity_hypotheses":[{"title":string,"detail":string,"confidence":number,"source_urls":string[]}],"risks":[{"title":string,"detail":string,"source_urls":string[]}]}}',
    ].join(' ');
}

function companyBundleInstructions(language: 'es' | 'en', includeCompanyResearch: boolean, includeRecentSignals: boolean): string {
    const schemaParts: string[] = [];

    if (includeCompanyResearch) {
        schemaParts.push('"website_summary":{"overview":string|null,"services":string[],"positioning":string|null,"source_urls":string[]}');
        schemaParts.push('"company_context":{"overview":string|null,"business_model":string|null,"industry_context":string|null,"likely_priorities":string[],"growth_signals":string[],"pain_hypotheses":[{"title":string,"detail":string,"confidence":number,"source_urls":string[]}],"opportunity_hypotheses":[{"title":string,"detail":string,"confidence":number,"source_urls":string[]}],"risks":[{"title":string,"detail":string,"source_urls":string[]}]}');
    }

    if (includeRecentSignals) {
        schemaParts.push('"signals":[{"type":"news|hiring|tech|site|social|financial|product|expansion","title":string,"summary":string,"url":string,"published_at":string|null,"importance":"high|medium|low","source_urls":string[]}]}');
    }

    return [
        sharedRules(language),
        'Focus on official website, public signals, newsroom, careers pages, reliable directories, and commercially relevant evidence.',
        'Return JSON with this schema:',
        `{${schemaParts.join(',')}}`,
    ].join(' ');
}

function recentSignalsInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Prioritize recent, commercial, public signals: hiring, expansion, launches, partnerships, funding, executive moves, major content, or strategic changes.',
        'Return JSON with this schema:',
        '{"signals":[{"type":"news|hiring|tech|site|social|financial|product|expansion","title":string,"summary":string,"url":string,"published_at":string|null,"importance":"high|medium|low","source_urls":string[]}]}',
    ].join(' ');
}

function leadResearchInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Focus on the person, their public profile, role context, likely responsibilities, public activity, and safe conversational ice breakers.',
        'Return JSON with this schema:',
        '{"lead_context":{"profile_summary":string|null,"role_summary":string|null,"likely_responsibilities":string[],"seniority_assessment":"decision_maker|influencer|champion|unknown","department":string|null,"tenure_hint":string|null,"recent_activity_summary":string|null,"found_recent_activity":boolean,"ice_breakers":[{"text":string,"why_it_works":string,"source_urls":string[]}]}}',
    ].join(' ');
}

function leadStrategyBundleInstructions(language: 'es' | 'en', includeLeadResearch: boolean, includeBuyer: boolean): string {
    const schemaParts: string[] = [];

    if (includeLeadResearch) {
        schemaParts.push('"lead_context":{"profile_summary":string|null,"role_summary":string|null,"likely_responsibilities":string[],"seniority_assessment":"decision_maker|influencer|champion|unknown","department":string|null,"tenure_hint":string|null,"recent_activity_summary":string|null,"found_recent_activity":boolean,"ice_breakers":[{"text":string,"why_it_works":string,"source_urls":string[]}]}}');
    }

    if (includeBuyer) {
        schemaParts.push('"buyer_intelligence":{"relevance_summary":string|null,"fit_score":number|null,"fit_reasons":string[],"urgency_signals":string[],"recommended_angle":"cost_saving|efficiency|growth|risk|speed|talent|custom","recommended_channel":"email|linkedin|call","recommended_cta":string|null,"best_contact_timing_hint":string|null,"likely_objections":[{"objection":string,"rebuttal":string,"confidence":number}]}');
        schemaParts.push('"outreach_pack":{"one_liner":string|null,"personalized_openers":[{"channel":"email|linkedin|call","text":string,"source_urls":string[]}],"talk_tracks":string[],"subject_lines":string[],"email_drafts":{"short":{"subject":string|null,"body":string|null},"medium":{"subject":string|null,"body":string|null},"challenger":{"subject":string|null,"body":string|null}},"linkedin_dm_variants":[{"style":"soft|direct|executive","text":string}],"call_openers":string[],"call_script":{"opening":string|null,"discovery_questions":string[],"value_bridge":string|null,"cta":string|null},"voicemail_script":string|null,"follow_up_sequence":[{"step":number,"channel":"email|linkedin|call","delay_days":number,"goal":string,"subject":string|null,"body":string}]}}');
    }

    return [
        sharedRules(language),
        'Focus on the person, their role, responsibilities, public context, and build a commercially useful outreach strategy grounded in public evidence.',
        'Think like a B2B sales researcher and strategist. Keep drafts concise, credible, and backed by sources.',
        'Return JSON with this schema:',
        `{${schemaParts.join(',')}}`,
    ].join(' ');
}

function buyerInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Think like a B2B sales researcher and strategist. Build actionable outreach for email, LinkedIn, and calls.',
        'Do not use unsupported claims. Keep drafts concise and credible.',
        'Return JSON with this schema:',
        '{"buyer_intelligence":{"relevance_summary":string|null,"fit_score":number|null,"fit_reasons":string[],"urgency_signals":string[],"recommended_angle":"cost_saving|efficiency|growth|risk|speed|talent|custom","recommended_channel":"email|linkedin|call","recommended_cta":string|null,"best_contact_timing_hint":string|null,"likely_objections":[{"objection":string,"rebuttal":string,"confidence":number}]},"outreach_pack":{"one_liner":string|null,"personalized_openers":[{"channel":"email|linkedin|call","text":string,"source_urls":string[]}],"talk_tracks":string[],"subject_lines":string[],"email_drafts":{"short":{"subject":string|null,"body":string|null},"medium":{"subject":string|null,"body":string|null},"challenger":{"subject":string|null,"body":string|null}},"linkedin_dm_variants":[{"style":"soft|direct|executive","text":string}],"call_openers":string[],"call_script":{"opening":string|null,"discovery_questions":string[],"value_bridge":string|null,"cta":string|null},"voicemail_script":string|null,"follow_up_sequence":[{"step":number,"channel":"email|linkedin|call","delay_days":number,"goal":string,"subject":string|null,"body":string}]}}',
    ].join(' ');
}

function competitiveInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Focus on competitive context, adjacent alternatives, likely buying committee, and any public tech-stack or tooling clues.',
        'Return JSON with this schema:',
        '{"competitive_context":{"competitor_mentions":string[],"tech_stack_detected":string[],"buying_committee_suggestions":string[],"source_urls":string[]}}',
    ].join(' ');
}

function callPrepInstructions(language: 'es' | 'en'): string {
    return [
        sharedRules(language),
        'Focus on call preparation and practical next steps. Improve the outreach pack with call-centric detail.',
        'Return JSON with this schema:',
        '{"outreach_pack":{"one_liner":string|null,"personalized_openers":[{"channel":"email|linkedin|call","text":string,"source_urls":string[]}],"talk_tracks":string[],"subject_lines":string[],"email_drafts":{"short":{"subject":string|null,"body":string|null},"medium":{"subject":string|null,"body":string|null},"challenger":{"subject":string|null,"body":string|null}},"linkedin_dm_variants":[{"style":"soft|direct|executive","text":string}],"call_openers":string[],"call_script":{"opening":string|null,"discovery_questions":string[],"value_bridge":string|null,"cta":string|null},"voicemail_script":string|null,"follow_up_sequence":[{"step":number,"channel":"email|linkedin|call","delay_days":number,"goal":string,"subject":string|null,"body":string}]}}',
    ].join(' ');
}

export function buildResearchSectionPlans(input: NormalizedLeadResearchInput): ResearchSectionPlan[] {
    const language = input.options.language;
    const sellerContext = buildSellerContextText(input);
    const entityContext = buildEntityContextText(input);
    const mode = sectionMode(input.options.depth);
    const plans: ResearchSectionPlan[] = [];

    const includeCompanyBundle = input.options.include_company_research || input.options.include_recent_signals;
    if (includeCompanyBundle) {
        const domainClause = input.company.domain
            ? `Prioritize site:${input.company.domain}, official company sources, newsroom, and careers pages.`
            : 'Prioritize official company sources, newsroom, and careers pages.';

        const companyTargets = [
            input.options.include_company_research
                ? 'website summary, services, positioning, business model, industry context, likely priorities, growth signals, pain hypotheses, opportunity hypotheses, and risks'
                : null,
            input.options.include_recent_signals
                ? 'recent public commercial signals like hiring, partnerships, launches, expansion, executive moves, and strategic updates'
                : null,
        ].filter(Boolean).join(', plus ');

        plans.push({
            key: 'company_bundle',
            sections: [
                ...(input.options.include_company_research ? ['company_research' as const] : []),
                ...(input.options.include_recent_signals ? ['recent_signals' as const] : []),
            ],
            query: `Research this company for B2B sales intelligence. ${entityContext} ${domainClause} Find ${companyTargets}.`,
            systemInstructions: companyBundleInstructions(language, input.options.include_company_research, input.options.include_recent_signals),
            sources: ['web'],
            optimizationMode: mode,
            fallbackPlans: [
                ...(input.options.include_company_research
                    ? [{
                        key: 'company_research',
                        sections: ['company_research' as const],
                        query: `Research this company for B2B sales intelligence. ${entityContext} ${domainClause} Find website summary, services, positioning, business model, industry context, likely priorities, growth signals, pain hypotheses, opportunity hypotheses, and risks.`,
                        systemInstructions: companyResearchInstructions(language),
                        sources: ['web'] as SearchSourceType[],
                        optimizationMode: mode,
                    } satisfies ResearchSectionPlan]
                    : []),
                ...(input.options.include_recent_signals
                    ? [{
                        key: 'recent_signals',
                        sections: ['recent_signals' as const],
                        query: `Find recent public commercial signals for this company and lead. ${entityContext} Focus on news, hiring, expansion, launches, partnerships, social activity, and strategic changes relevant for outbound sales.`,
                        systemInstructions: recentSignalsInstructions(language),
                        sources: ['web'] as SearchSourceType[],
                        optimizationMode: mode,
                    } satisfies ResearchSectionPlan]
                    : []),
            ],
        });
    }

    const includeLeadBundle = input.options.include_lead_research || input.options.include_outreach_pack || input.options.include_call_prep;
    if (includeLeadBundle) {
        const leadTargets = [
            input.options.include_lead_research
                ? 'public profile context, role summary, likely responsibilities, recent public activity, and evidence-based ice breakers'
                : null,
            (input.options.include_outreach_pack || input.options.include_call_prep)
                ? 'fit, urgency signals, recommended angle, channel, CTA, likely objections, email drafts, LinkedIn DM variants, call openers, and follow-up sequence'
                : null,
        ].filter(Boolean).join(', plus ');

        plans.push({
            key: 'lead_strategy_bundle',
            sections: [
                ...(input.options.include_lead_research ? ['lead_research' as const] : []),
                ...((input.options.include_outreach_pack || input.options.include_call_prep) ? ['buyer_intelligence' as const] : []),
            ],
            query: `Research this lead and build sales strategy. ${entityContext} ${sellerContext} Find ${leadTargets}.`,
            systemInstructions: leadStrategyBundleInstructions(
                language,
                input.options.include_lead_research,
                input.options.include_outreach_pack || input.options.include_call_prep,
            ),
            sources: ['web', 'discussions'],
            optimizationMode: mode,
            fallbackPlans: [
                ...(input.options.include_lead_research
                    ? [{
                        key: 'lead_research',
                        sections: ['lead_research' as const],
                        query: `Research this person for outbound sales preparation. ${entityContext} Find public profile context, role summary, likely responsibilities, recent public activity, and evidence-based ice breakers.`,
                        systemInstructions: leadResearchInstructions(language),
                        sources: ['web', 'discussions'] as SearchSourceType[],
                        optimizationMode: mode,
                    } satisfies ResearchSectionPlan]
                    : []),
                ...((input.options.include_outreach_pack || input.options.include_call_prep)
                    ? [{
                        key: 'buyer_intelligence',
                        sections: ['buyer_intelligence' as const],
                        query: `Create sales intelligence and outreach strategy for this lead and company. ${entityContext} ${sellerContext} Identify fit, urgency signals, recommended angle, channel, CTA, likely objections, email drafts, LinkedIn DM variants, call script, and follow-up sequence.`,
                        systemInstructions: buyerInstructions(language),
                        sources: ['web', 'discussions'] as SearchSourceType[],
                        optimizationMode: mode,
                    } satisfies ResearchSectionPlan]
                    : []),
            ],
        });
    }

    if (input.options.depth === 'deep' && input.options.include_competitive_context) {
        plans.push({
            key: 'competitive_context',
            sections: ['competitive_context'],
            query: `Research competitive and strategic context for this account. ${entityContext} ${sellerContext} Identify competitors, alternatives, tech stack clues, and buying committee suggestions relevant for a deep B2B sales strategy.`,
            systemInstructions: competitiveInstructions(language),
            sources: ['web', 'discussions'],
            optimizationMode: 'quality',
        });
    }

    if (input.options.depth === 'deep' && input.options.include_call_prep) {
        plans.push({
            key: 'call_prep',
            sections: ['call_prep'],
            query: `Produce advanced call preparation for this prospect. ${entityContext} ${sellerContext} Focus on opening, discovery questions, value bridge, CTA, voicemail, and follow-up cadence grounded in public evidence.`,
            systemInstructions: callPrepInstructions(language),
            sources: ['web', 'discussions'],
            optimizationMode: 'quality',
        });
    }

    return plans;
}
