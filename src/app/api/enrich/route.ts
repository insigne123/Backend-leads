import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateInternalRequest,
  auditGatewayRequest,
  consumeEndpointRateLimit,
  getGatewayConfig,
  getRequestId,
} from '../../../lib/gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function response(body: Record<string, unknown>, status: number, requestId: string) {
  const result = NextResponse.json({ ...body, request_id: requestId }, { status });
  result.headers.set('cache-control', 'no-store');
  result.headers.set('x-content-type-options', 'nosniff');
  result.headers.set('x-request-id', requestId);
  return result;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = getRequestId(request.headers);
  const config = getGatewayConfig();
  const finish = (status: number, outcome: string, metrics?: Record<string, number | boolean | string | undefined>) => {
    auditGatewayRequest({
      route: 'enrich',
      requestId,
      status,
      outcome,
      durationMs: Date.now() - startedAt,
      metrics,
    });
  };

  const authentication = authenticateInternalRequest(request.headers);
  if (!authentication.ok) {
    finish(authentication.status, authentication.code);
    return response({ error: authentication.code }, authentication.status, requestId);
  }

  const rateLimit = consumeEndpointRateLimit('enrich', config);
  if (!rateLimit.allowed) {
    finish(429, 'RATE_LIMITED', { rateLimit: rateLimit.limit });
    const result = response({ error: 'RATE_LIMITED' }, 429, requestId);
    result.headers.set('retry-after', String(rateLimit.retryAfterSeconds));
    result.headers.set('x-rate-limit-limit', String(rateLimit.limit));
    return result;
  }

  // FullEnrich enrichment is asynchronous and requires callback records owned
  // by the root BFF. This legacy internal endpoint deliberately cannot fall
  // back to the old synchronous provider implementation.
  finish(410, 'FULLENRICH_ENRICHMENT_BFF_ONLY', {
    rateLimitRemaining: rateLimit.remaining,
  });
  return response({ error: 'FULLENRICH_ENRICHMENT_BFF_ONLY' }, 410, requestId);
}
