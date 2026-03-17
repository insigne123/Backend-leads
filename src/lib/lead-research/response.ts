import {
    LeadResearchApiResponse,
    LeadResearchDepth,
    LeadResearchRecord,
    LeadResearchReport,
    NormalizedLeadResearchInput,
} from './types';

function emptyReport(input: NormalizedLeadResearchInput, reportId: string, status: LeadResearchRecord['status'], requestedDepth: LeadResearchDepth): LeadResearchReport {
    return {
        report_id: reportId,
        lead_ref: input.lead_ref,
        status,
        requested_depth: requestedDepth,
        completed_depth: requestedDepth === 'deep' ? null : requestedDepth,
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
        website_summary: {
            overview: null,
            services: [],
            positioning: null,
            source_ids: [],
        },
        signals: [],
        lead_context: {
            profile_summary: null,
            role_summary: null,
            likely_responsibilities: [],
            seniority_assessment: 'unknown',
            department: null,
            tenure_hint: null,
            recent_activity_summary: null,
            found_recent_activity: false,
            ice_breakers: [],
        },
        company_context: {
            overview: null,
            business_model: null,
            industry_context: null,
            likely_priorities: [],
            growth_signals: [],
            pain_hypotheses: [],
            opportunity_hypotheses: [],
            risks: [],
        },
        buyer_intelligence: {
            relevance_summary: null,
            fit_score: null,
            fit_reasons: [],
            urgency_signals: [],
            recommended_angle: 'custom',
            recommended_channel: 'email',
            recommended_cta: null,
            best_contact_timing_hint: null,
            likely_objections: [],
        },
        outreach_pack: {
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
        },
        competitive_context: {
            competitor_mentions: [],
            tech_stack_detected: [],
            buying_committee_suggestions: [],
            source_ids: [],
        },
        existing_compat: {
            cross: {
                company: {
                    name: input.company.name,
                    domain: input.company.domain,
                    linkedin: input.company.linkedin_url,
                    industry: input.company.industry,
                    country: input.company.country,
                    website: input.company.website_url,
                },
                overview: null,
                pains: [],
                opportunities: [],
                risks: [],
                valueProps: [],
                useCases: [],
                talkTracks: [],
                subjectLines: [],
                emailDraft: { subject: null, body: null },
                sources: [],
                leadContext: {
                    iceBreaker: null,
                    recentActivitySummary: null,
                    foundRecentActivity: false,
                    profileSummary: null,
                },
            },
            enhanced: {
                overview: null,
                pains: [],
                opportunities: [],
                risks: [],
                valueProps: [],
                useCases: [],
                suggestedContacts: [],
                talkTracks: [],
                subjectLines: [],
                emailDraft: { subject: null, body: null },
            },
        },
        sources: [],
        diagnostics: {
            queries: [],
            searched_domains: [],
            search_depth: requestedDepth,
            sections_completed: [],
            sections_missing: [],
            raw_hits_count: 0,
            vane_calls: [],
            total_vane_duration_ms: 0,
            estimated_cost: {
                currency: 'USD',
                model: null,
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_tokens: 0,
                estimated_cost_usd: null,
                methodology: 'heuristic',
                note: 'Estimated from Vane request/response sizes and model pricing. It is not exact because Vane does not expose provider usage per request.',
            },
        },
        can_upgrade_to_deep: requestedDepth !== 'deep',
        deep_available: requestedDepth !== 'deep',
    };
}

export function ensureApiResponse(report: LeadResearchReport): LeadResearchApiResponse {
    return {
        ...report,
        report,
        reports: [report],
    };
}

export function buildPendingResearchResponse(params: {
    record: LeadResearchRecord;
    input: NormalizedLeadResearchInput;
    parentReport?: LeadResearchApiResponse | null;
}): LeadResearchApiResponse {
    const queueWarning = params.record.status === 'queued'
        ? 'Deep research is queued and the latest completed report remains available while it processes.'
        : 'Deep research is currently in progress and the latest completed report remains available while it processes.';

    const parent = params.parentReport?.report || null;
    const baseReport = parent
        ? {
            ...parent,
            report_id: params.record.report_id,
            status: params.record.status,
            requested_depth: params.record.requested_depth,
            completed_depth: parent.completed_depth,
            cache_hit: false,
            warnings: Array.from(new Set([...(parent.warnings || []), ...(params.record.warnings || []), queueWarning])),
            errors: params.record.errors || [],
            generated_at: params.record.updated_at || new Date().toISOString(),
            can_upgrade_to_deep: false,
            deep_available: false,
        }
        : emptyReport(params.input, params.record.report_id, params.record.status, params.record.requested_depth);

    if (!parent) {
        baseReport.warnings = Array.from(new Set([...(baseReport.warnings || []), queueWarning]));
    }

    return ensureApiResponse(baseReport);
}
