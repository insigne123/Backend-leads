import crypto from 'crypto';
import { getServiceSupabase } from '@/lib/supabase';
import {
    LeadResearchApiResponse,
    LeadResearchDepth,
    LeadResearchRecord,
    LeadResearchStatus,
    NormalizedLeadResearchInput,
} from './types';

const TABLE_NAME = 'lead_research_reports';

type ReportRow = Record<string, any>;

export function hashCacheKey(payload: string): string {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function isMissingTableError(error: any): boolean {
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return text.includes('lead_research_reports') && (
        text.includes('does not exist') ||
        text.includes('not found') ||
        text.includes('schema cache') ||
        text.includes('could not find the table')
    );
}

function isMissingServiceRoleError(error: any): boolean {
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return text.includes('supabase_service_role_key');
}

function mapRow(row: ReportRow): LeadResearchRecord {
    return {
        report_id: row.report_id,
        lead_ref: row.lead_ref ?? null,
        user_id: row.user_id ?? null,
        organization_id: row.organization_id ?? null,
        status: row.status,
        requested_depth: row.requested_depth,
        completed_depth: row.completed_depth ?? null,
        provider: row.provider,
        cache_key: row.cache_key,
        base_cache_key: row.base_cache_key,
        cache_hit: Boolean(row.cache_hit),
        normalized_lead: row.normalized_lead || {},
        normalized_company: row.normalized_company || {},
        seller_context: row.seller_context || {},
        user_context: row.user_context || {},
        options: row.options || {},
        report_json: row.report_json || null,
        warnings: Array.isArray(row.warnings) ? row.warnings : [],
        errors: Array.isArray(row.errors) ? row.errors : [],
        diagnostics: row.diagnostics || {},
        duration_ms: typeof row.duration_ms === 'number' ? row.duration_ms : null,
        parent_report_id: row.parent_report_id ?? null,
        request_payload: row.request_payload || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        started_at: row.started_at ?? null,
        completed_at: row.completed_at ?? null,
        expires_at: row.expires_at ?? null,
    } as LeadResearchRecord;
}

export function computeExpiry(depth: LeadResearchDepth): string {
    const now = Date.now();
    const ttlHours = depth === 'light'
        ? Number(process.env.LEAD_RESEARCH_CACHE_TTL_HOURS_LIGHT || '24')
        : depth === 'deep'
            ? Number(process.env.LEAD_RESEARCH_CACHE_TTL_HOURS_DEEP || '6')
            : Number(process.env.LEAD_RESEARCH_CACHE_TTL_HOURS_STANDARD || '12');

    return new Date(now + ttlHours * 60 * 60 * 1000).toISOString();
}

export async function getCachedReport(cacheKey: string): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('cache_key', cacheKey)
            .in('status', ['completed', 'partial', 'insufficient_data'])
            .gt('expires_at', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ? mapRow(data) : null;
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}

export async function getExistingDeepJob(cacheKey: string): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('cache_key', cacheKey)
            .in('status', ['queued', 'in_progress'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ? mapRow(data) : null;
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}

export async function getLatestCompletedByBaseCacheKey(baseCacheKey: string): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('base_cache_key', baseCacheKey)
            .in('status', ['completed', 'partial', 'insufficient_data'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ? mapRow(data) : null;
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}

export async function getReportById(reportId: string): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('report_id', reportId)
            .maybeSingle();

        if (error) throw error;
        return data ? mapRow(data) : null;
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}

export async function createQueuedDeepReport(params: {
    reportId: string;
    cacheKey: string;
    baseCacheKey: string;
    input: NormalizedLeadResearchInput;
    parentReportId: string | null;
}): Promise<LeadResearchRecord> {
    const supabase = getServiceSupabase();
    const now = new Date().toISOString();

    const row = {
        report_id: params.reportId,
        lead_ref: params.input.lead_ref,
        user_id: params.input.user_id,
        organization_id: params.input.organization_id,
        status: 'queued',
        requested_depth: 'deep',
        completed_depth: params.parentReportId ? 'standard' : null,
        provider: 'vane',
        cache_key: params.cacheKey,
        base_cache_key: params.baseCacheKey,
        cache_hit: false,
        normalized_lead: params.input.lead,
        normalized_company: params.input.company,
        seller_context: params.input.seller_context,
        user_context: params.input.user_context,
        options: params.input.options,
        report_json: null,
        warnings: [],
        errors: [],
        diagnostics: {},
        duration_ms: null,
        parent_report_id: params.parentReportId,
        request_payload: params.input,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        expires_at: computeExpiry('deep'),
    };

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert(row)
        .select('*')
        .single();

    if (error) throw error;
    return mapRow(data);
}

export async function saveCompletedReport(params: {
    reportId: string;
    cacheKey: string;
    baseCacheKey: string;
    input: NormalizedLeadResearchInput;
    report: LeadResearchApiResponse;
    status: LeadResearchStatus;
    parentReportId?: string | null;
    createdAt?: string | null;
    startedAt?: string | null;
}): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const now = new Date().toISOString();
        const row = {
            report_id: params.reportId,
            lead_ref: params.input.lead_ref,
            user_id: params.input.user_id,
            organization_id: params.input.organization_id,
            status: params.status,
            requested_depth: params.input.options.depth,
            completed_depth: params.report.completed_depth,
            provider: params.report.provider,
            cache_key: params.cacheKey,
            base_cache_key: params.baseCacheKey,
            cache_hit: params.report.cache_hit,
            normalized_lead: params.input.lead,
            normalized_company: params.input.company,
            seller_context: params.input.seller_context,
            user_context: params.input.user_context,
            options: params.input.options,
            report_json: params.report,
            warnings: params.report.warnings,
            errors: params.report.errors,
            diagnostics: params.report.diagnostics,
            duration_ms: params.report.duration_ms,
            parent_report_id: params.parentReportId ?? null,
            request_payload: params.input,
            created_at: params.createdAt || now,
            updated_at: now,
            started_at: params.startedAt || now,
            completed_at: now,
            expires_at: computeExpiry(params.input.options.depth),
        };

        const { data, error } = await supabase
            .from(TABLE_NAME)
            .upsert(row, { onConflict: 'report_id' })
            .select('*')
            .single();

        if (error) throw error;
        return mapRow(data);
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}

export async function markReportInProgress(reportId: string): Promise<LeadResearchRecord> {
    const supabase = getServiceSupabase();
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({
            status: 'in_progress',
            started_at: now,
            updated_at: now,
        })
        .eq('report_id', reportId)
        .select('*')
        .single();

    if (error) throw error;
    return mapRow(data);
}

export async function markReportFailed(reportId: string, errorMessage: string, details: Record<string, any> = {}): Promise<void> {
    const supabase = getServiceSupabase();
    const now = new Date().toISOString();
    const { error } = await supabase
        .from(TABLE_NAME)
        .update({
            status: 'failed',
            errors: [errorMessage],
            diagnostics: details,
            updated_at: now,
            completed_at: now,
        })
        .eq('report_id', reportId);

    if (error) throw error;
}

export async function getNextQueuedDeepReport(): Promise<LeadResearchRecord | null> {
    try {
        const supabase = getServiceSupabase();
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .eq('status', 'queued')
            .eq('requested_depth', 'deep')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data ? mapRow(data) : null;
    } catch (error: any) {
        if (isMissingTableError(error) || isMissingServiceRoleError(error)) return null;
        throw error;
    }
}
