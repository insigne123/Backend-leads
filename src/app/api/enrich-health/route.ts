import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    return NextResponse.json({
        status: 'ok',
        message: 'Enrichment endpoint is reachable',
        timestamp: new Date().toISOString(),
        url: req.url
    });
}

export async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));

    return NextResponse.json({
        status: 'ok',
        message: 'Enrichment endpoint is reachable via POST',
        timestamp: new Date().toISOString(),
        received_body: body,
        headers: {
            'x-api-secret-key': req.headers.get('x-api-secret-key') ? 'present' : 'missing'
        }
    });
}
