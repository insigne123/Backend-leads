export type LeadResearchDepth = 'light' | 'standard' | 'deep';

export type LeadResearchStatus =
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'partial'
    | 'insufficient_data'
    | 'failed';

export type CoverageLevel = 'high' | 'medium' | 'low';

export type ResearchLanguage = 'es' | 'en';

export type SearchSourceType = 'web' | 'discussions' | 'academic';

export type LeadResearchSource = {
    id: string;
    type: 'company_site' | 'linkedin' | 'news' | 'blog' | 'job_post' | 'directory' | 'social' | 'other';
    title: string;
    url: string;
    domain: string;
    published_at: string | null;
    snippet: string;
    relevance_score: number;
    trust_level: 'high' | 'medium' | 'low';
};

export type NormalizedLead = {
    id: string | null;
    apollo_id: string | null;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    headline: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    location: string | null;
    city: string | null;
    country: string | null;
    seniority: string | null;
    department: string | null;
};

export type NormalizedCompany = {
    name: string | null;
    domain: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    size: string | null;
    country: string | null;
};

export type NormalizedSellerContext = {
    company_name: string | null;
    company_domain: string | null;
    sector: string | null;
    description: string | null;
    services: string[];
    value_proposition: string | null;
    proof_points: string[];
    target_market: string[];
};

export type NormalizedUserContext = {
    id: string | null;
    name: string | null;
    job_title: string | null;
};

export type LeadResearchOptions = {
    language: ResearchLanguage;
    depth: LeadResearchDepth;
    include_outreach_pack: boolean;
    include_company_research: boolean;
    include_lead_research: boolean;
    include_recent_signals: boolean;
    include_call_prep: boolean;
    include_competitive_context: boolean;
    include_raw_sources: boolean;
    max_sources: number;
    force_refresh: boolean;
};

export type NormalizedLeadResearchInput = {
    user_id: string | null;
    organization_id: string | null;
    lead_ref: string | null;
    lead: NormalizedLead;
    company: NormalizedCompany;
    seller_context: NormalizedSellerContext;
    user_context: NormalizedUserContext;
    options: LeadResearchOptions;
};

export type WebsiteSummary = {
    overview: string | null;
    services: string[];
    positioning: string | null;
    source_ids: string[];
};

export type Hypothesis = {
    title: string;
    detail: string;
    confidence: number;
    source_ids: string[];
};

export type RiskItem = {
    title: string;
    detail: string;
    source_ids: string[];
};

export type SignalItem = {
    type: 'news' | 'hiring' | 'tech' | 'site' | 'social' | 'financial' | 'product' | 'expansion';
    title: string;
    summary: string;
    url: string;
    published_at: string | null;
    importance: 'high' | 'medium' | 'low';
    source_ids: string[];
};

export type IceBreaker = {
    text: string;
    why_it_works: string;
    source_ids: string[];
};

export type LikelyObjection = {
    objection: string;
    rebuttal: string;
    confidence: number;
};

export type PersonalizedOpener = {
    channel: 'email' | 'linkedin' | 'call';
    text: string;
    source_ids: string[];
};

export type LinkedinDmVariant = {
    style: 'soft' | 'direct' | 'executive';
    text: string;
};

export type FollowUpStep = {
    step: number;
    channel: 'email' | 'linkedin' | 'call';
    delay_days: number;
    goal: string;
    subject: string | null;
    body: string;
};

export type LeadContext = {
    profile_summary: string | null;
    role_summary: string | null;
    likely_responsibilities: string[];
    seniority_assessment: 'decision_maker' | 'influencer' | 'champion' | 'unknown';
    department: string | null;
    tenure_hint: string | null;
    recent_activity_summary: string | null;
    found_recent_activity: boolean;
    ice_breakers: IceBreaker[];
};

export type CompanyContext = {
    overview: string | null;
    business_model: string | null;
    industry_context: string | null;
    likely_priorities: string[];
    growth_signals: string[];
    pain_hypotheses: Hypothesis[];
    opportunity_hypotheses: Hypothesis[];
    risks: RiskItem[];
};

export type BuyerIntelligence = {
    relevance_summary: string | null;
    fit_score: number | null;
    fit_reasons: string[];
    urgency_signals: string[];
    recommended_angle: 'cost_saving' | 'efficiency' | 'growth' | 'risk' | 'speed' | 'talent' | 'custom';
    recommended_channel: 'email' | 'linkedin' | 'call';
    recommended_cta: string | null;
    best_contact_timing_hint: string | null;
    likely_objections: LikelyObjection[];
};

export type OutreachPack = {
    one_liner: string | null;
    personalized_openers: PersonalizedOpener[];
    talk_tracks: string[];
    subject_lines: string[];
    email_drafts: {
        short: { subject: string | null; body: string | null };
        medium: { subject: string | null; body: string | null };
        challenger: { subject: string | null; body: string | null };
    };
    linkedin_dm_variants: LinkedinDmVariant[];
    call_openers: string[];
    call_script: {
        opening: string | null;
        discovery_questions: string[];
        value_bridge: string | null;
        cta: string | null;
    };
    voicemail_script: string | null;
    follow_up_sequence: FollowUpStep[];
};

export type CompetitiveContext = {
    competitor_mentions: string[];
    tech_stack_detected: string[];
    buying_committee_suggestions: string[];
    source_ids: string[];
};

export type CrossReport = {
    company: {
        name: string | null;
        domain: string | null;
        linkedin: string | null;
        industry: string | null;
        country: string | null;
        website: string | null;
    };
    overview: string | null;
    pains: string[];
    opportunities: string[];
    risks: string[];
    valueProps: string[];
    useCases: string[];
    talkTracks: string[];
    subjectLines: string[];
    emailDraft: {
        subject: string | null;
        body: string | null;
    };
    sources: Array<{ title: string; url: string }>;
    leadContext: {
        iceBreaker: string | null;
        recentActivitySummary: string | null;
        foundRecentActivity: boolean;
        profileSummary: string | null;
    };
};

export type EnhancedReport = {
    overview: string | null;
    pains: string[];
    opportunities: string[];
    risks: string[];
    valueProps: string[];
    useCases: string[];
    suggestedContacts: string[];
    talkTracks: string[];
    subjectLines: string[];
    emailDraft: {
        subject: string | null;
        body: string | null;
    };
};

export type Diagnostics = {
    queries: string[];
    searched_domains: string[];
    search_depth: LeadResearchDepth;
    sections_completed: string[];
    sections_missing: string[];
    raw_hits_count: number;
};

export type LeadResearchReport = {
    report_id: string;
    lead_ref: string | null;
    status: LeadResearchStatus;
    requested_depth: LeadResearchDepth;
    completed_depth: 'light' | 'standard' | 'deep' | null;
    generated_at: string;
    cache_hit: boolean;
    provider: 'vane';
    provider_version: string | null;
    duration_ms: number;
    warnings: string[];
    errors: string[];
    coverage: {
        company: CoverageLevel;
        lead: CoverageLevel;
        recent_signals: CoverageLevel;
        contact_strategy: CoverageLevel;
    };
    lead: NormalizedLead;
    company: NormalizedCompany;
    website_summary: WebsiteSummary;
    signals: SignalItem[];
    lead_context: LeadContext;
    company_context: CompanyContext;
    buyer_intelligence: BuyerIntelligence;
    outreach_pack: OutreachPack;
    competitive_context: CompetitiveContext;
    existing_compat: {
        cross: CrossReport;
        enhanced: EnhancedReport;
    };
    sources: LeadResearchSource[];
    diagnostics: Diagnostics;
    can_upgrade_to_deep: boolean;
    deep_available: boolean;
};

export type LeadResearchApiResponse = LeadResearchReport & {
    report: LeadResearchReport;
    reports: LeadResearchReport[];
};

export type ReportRecordStatus = LeadResearchStatus;

export type LeadResearchRecord = {
    report_id: string;
    lead_ref: string | null;
    user_id: string | null;
    organization_id: string | null;
    status: ReportRecordStatus;
    requested_depth: LeadResearchDepth;
    completed_depth: 'light' | 'standard' | 'deep' | null;
    provider: string;
    cache_key: string;
    base_cache_key: string;
    cache_hit: boolean;
    normalized_lead: NormalizedLead;
    normalized_company: NormalizedCompany;
    seller_context: NormalizedSellerContext;
    user_context: NormalizedUserContext;
    options: LeadResearchOptions;
    report_json: LeadResearchApiResponse | null;
    warnings: string[];
    errors: string[];
    diagnostics: Diagnostics | Record<string, any>;
    duration_ms: number | null;
    parent_report_id: string | null;
    request_payload: NormalizedLeadResearchInput;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
    expires_at: string | null;
};

export type SectionExecutionDiagnostics = {
    section: string;
    query: string;
    raw_source_count: number;
    warnings: string[];
};

export type ProcessedLeadResearchResult = {
    report: LeadResearchApiResponse;
    diagnostics: Diagnostics;
    raw_section_diagnostics: SectionExecutionDiagnostics[];
};
