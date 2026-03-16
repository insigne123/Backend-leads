import { NextResponse } from 'next/server';
import { getReportById } from '@/lib/lead-research/persistence';
import { buildPendingResearchResponse } from '@/lib/lead-research/response';

export const runtime = 'nodejs';

type RouteContext = {
    params: Promise<{
        reportId: string;
    }>;
};

export async function GET(_: Request, context: RouteContext) {
    const { reportId } = await context.params;

    const report = await getReportById(reportId);
    if (!report) {
        return NextResponse.json(
            {
                error: 'LEAD_RESEARCH_NOT_FOUND',
                message: `No lead research report was found for id ${reportId}`,
            },
            { status: 404 }
        );
    }

    if (report.report_json) {
        return NextResponse.json(report.report_json, { status: 200 });
    }

    const parentReport = report.parent_report_id
        ? await getReportById(report.parent_report_id)
        : null;

    const pendingResponse = buildPendingResearchResponse({
        record: report,
        input: report.request_payload,
        parentReport: parentReport?.report_json || null,
    });

    return NextResponse.json(pendingResponse, { status: 200 });
}
