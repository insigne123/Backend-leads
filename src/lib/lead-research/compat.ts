import { CrossReport, EnhancedReport, LeadResearchReport } from './types';

function takeTitles(items: Array<{ title: string }>, limit = 4): string[] {
    return items.map((item) => item.title).filter(Boolean).slice(0, limit);
}

export function buildCrossReport(report: LeadResearchReport): CrossReport {
    return {
        company: {
            name: report.company.name,
            domain: report.company.domain,
            linkedin: report.company.linkedin_url,
            industry: report.company.industry,
            country: report.company.country,
            website: report.company.website_url,
        },
        overview: report.website_summary.overview || report.company_context.overview,
        pains: takeTitles(report.company_context.pain_hypotheses),
        opportunities: takeTitles(report.company_context.opportunity_hypotheses),
        risks: report.company_context.risks.map((risk) => risk.title).filter(Boolean).slice(0, 4),
        valueProps: report.buyer_intelligence.fit_reasons.slice(0, 4),
        useCases: report.company_context.opportunity_hypotheses.map((item) => item.detail).filter(Boolean).slice(0, 4),
        talkTracks: report.outreach_pack.talk_tracks.slice(0, 5),
        subjectLines: report.outreach_pack.subject_lines.slice(0, 5),
        emailDraft: {
            subject: report.outreach_pack.email_drafts.medium.subject,
            body: report.outreach_pack.email_drafts.medium.body,
        },
        sources: report.sources.slice(0, 10).map((source) => ({
            title: source.title,
            url: source.url,
        })),
        leadContext: {
            iceBreaker: report.lead_context.ice_breakers[0]?.text || null,
            recentActivitySummary: report.lead_context.recent_activity_summary,
            foundRecentActivity: report.lead_context.found_recent_activity,
            profileSummary: report.lead_context.profile_summary,
        },
    };
}

export function buildEnhancedReport(report: LeadResearchReport): EnhancedReport {
    return {
        overview: report.company_context.overview || report.website_summary.overview,
        pains: takeTitles(report.company_context.pain_hypotheses),
        opportunities: takeTitles(report.company_context.opportunity_hypotheses),
        risks: report.company_context.risks.map((risk) => risk.title).filter(Boolean).slice(0, 4),
        valueProps: report.buyer_intelligence.fit_reasons.slice(0, 4),
        useCases: report.company_context.opportunity_hypotheses.map((item) => item.detail).filter(Boolean).slice(0, 4),
        suggestedContacts: report.competitive_context.buying_committee_suggestions.slice(0, 5),
        talkTracks: report.outreach_pack.talk_tracks.slice(0, 5),
        subjectLines: report.outreach_pack.subject_lines.slice(0, 5),
        emailDraft: {
            subject: report.outreach_pack.email_drafts.medium.subject,
            body: report.outreach_pack.email_drafts.medium.body,
        },
    };
}
