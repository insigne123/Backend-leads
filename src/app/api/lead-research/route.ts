import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { runLeadResearch } from '@/lib/lead-research/engine';
import {
    createQueuedDeepReport,
    getCachedReport,
    getExistingDeepJob,
    getLatestCompletedByBaseCacheKey,
    hashCacheKey,
    saveCompletedReport,
} from '@/lib/lead-research/persistence';
import { normalizeLeadResearchRequest, createCacheFingerprint } from '@/lib/lead-research/normalize';
import { buildPendingResearchResponse, ensureApiResponse } from '@/lib/lead-research/response';
import { LeadResearchApiResponse } from '@/lib/lead-research/types';

export const runtime = 'nodejs';

function withCacheHit(response: LeadResearchApiResponse): LeadResearchApiResponse {
    const report = {
        ...response.report,
        cache_hit: true,
    };

    return ensureApiResponse(report);
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const normalizedInput = normalizeLeadResearchRequest(body);
        const cacheKey = hashCacheKey(createCacheFingerprint(normalizedInput, true));
        const baseCacheKey = hashCacheKey(createCacheFingerprint(normalizedInput, false));

        if (!normalizedInput.options.force_refresh) {
            const cachedReport = await getCachedReport(cacheKey);
            if (cachedReport?.report_json) {
                return NextResponse.json(withCacheHit(cachedReport.report_json), { status: 200 });
            }
        }

        if (normalizedInput.options.depth === 'deep') {
            if (!normalizedInput.options.force_refresh) {
                const pending = await getExistingDeepJob(cacheKey);
                if (pending) {
                    const parent = pending.parent_report_id
                        ? await getLatestCompletedByBaseCacheKey(baseCacheKey)
                        : null;
                    const pendingResponse = buildPendingResearchResponse({
                        record: pending,
                        input: normalizedInput,
                        parentReport: parent?.report_json || null,
                    });
                    return NextResponse.json(pendingResponse, { status: 202 });
                }
            }

            const parent = await getLatestCompletedByBaseCacheKey(baseCacheKey);
            const reportId = uuidv4();

            try {
                const queued = await createQueuedDeepReport({
                    reportId,
                    cacheKey,
                    baseCacheKey,
                    input: normalizedInput,
                    parentReportId: parent?.report_id || null,
                });

                const response = buildPendingResearchResponse({
                    record: queued,
                    input: normalizedInput,
                    parentReport: parent?.report_json || null,
                });

                return NextResponse.json(response, { status: 202 });
            } catch (error: any) {
                return NextResponse.json(
                    {
                        error: 'RESEARCH_STORAGE_UNAVAILABLE',
                        message: 'Deep research requires persistence. Please create the lead_research_reports table first.',
                        details: error?.message || String(error),
                    },
                    { status: 500 }
                );
            }
        }

        const reportId = uuidv4();
        const result = await runLeadResearch(normalizedInput, reportId);
        await saveCompletedReport({
            reportId,
            cacheKey,
            baseCacheKey,
            input: normalizedInput,
            report: result.report,
            status: result.report.status,
        });

        return NextResponse.json(result.report, { status: 200 });
    } catch (error: any) {
        const message = error?.message || 'Unexpected lead research error';
        const normalizedMessage = message.toLowerCase();
        const isValidationError =
            normalizedMessage.includes('required') ||
            normalizedMessage.includes('missing') ||
            normalizedMessage.includes('at least one') ||
            normalizedMessage.includes('invalid');

        return NextResponse.json(
            {
                error: isValidationError ? 'INVALID_LEAD_RESEARCH_REQUEST' : 'RESEARCH_PROVIDER_ERROR',
                message,
                provider: 'vane',
            },
            { status: isValidationError ? 400 : 502 }
        );
    }
}
