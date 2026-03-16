import { NextResponse } from 'next/server';
import { runLeadResearch } from '@/lib/lead-research/engine';
import {
    getNextQueuedDeepReport,
    getReportById,
    markReportFailed,
    markReportInProgress,
    saveCompletedReport,
} from '@/lib/lead-research/persistence';

export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
    const secret = process.env.LEAD_RESEARCH_WORKER_SECRET?.trim();
    if (!secret) return false;

    const headerSecret = req.headers.get('x-worker-secret')?.trim();
    if (headerSecret && headerSecret === secret) return true;

    const authHeader = req.headers.get('authorization')?.trim();
    if (authHeader === `Bearer ${secret}`) return true;

    return false;
}

export async function POST(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json(
            {
                error: 'UNAUTHORIZED_WORKER',
                message: 'Missing or invalid lead research worker secret.',
            },
            { status: 401 }
        );
    }

    try {
        const body = await req.json().catch(() => ({}));
        const requestedId = typeof body?.report_id === 'string' ? body.report_id.trim() : '';

        const record = requestedId
            ? await getReportById(requestedId)
            : await getNextQueuedDeepReport();

        if (!record) {
            return NextResponse.json(
                {
                    status: 'idle',
                    processed: false,
                    message: 'No queued deep lead research jobs were found.',
                },
                { status: 200 }
            );
        }

        if (record.report_json && ['completed', 'partial', 'insufficient_data'].includes(record.status)) {
            return NextResponse.json(record.report_json, { status: 200 });
        }

        await markReportInProgress(record.report_id);

        try {
            const result = await runLeadResearch(record.request_payload, record.report_id);

            await saveCompletedReport({
                reportId: record.report_id,
                cacheKey: record.cache_key,
                baseCacheKey: record.base_cache_key,
                input: record.request_payload,
                report: result.report,
                status: result.report.status,
                parentReportId: record.parent_report_id,
                createdAt: record.created_at,
                startedAt: record.started_at,
            });

            return NextResponse.json(result.report, { status: 200 });
        } catch (error: any) {
            await markReportFailed(record.report_id, error?.message || 'Deep research worker failed', {
                provider: 'vane',
                report_id: record.report_id,
            });

            return NextResponse.json(
                {
                    error: 'RESEARCH_PROVIDER_ERROR',
                    message: error?.message || 'Deep research worker failed',
                    provider: 'vane',
                    report_id: record.report_id,
                },
                { status: 502 }
            );
        }
    } catch (error: any) {
        return NextResponse.json(
            {
                error: 'RESEARCH_PROVIDER_ERROR',
                message: error?.message || 'Unexpected deep research worker error',
                provider: 'vane',
            },
            { status: 500 }
        );
    }
}
