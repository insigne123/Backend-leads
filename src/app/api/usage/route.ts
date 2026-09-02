import { NextRequest, NextResponse } from 'next/server';

import { ApolloGatewayError, getApolloApiKey, getApolloUsageSnapshot } from '../../../lib/apollo';
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
  const finish = (status: number, outcome: string) => auditGatewayRequest({
    route: 'usage',
    requestId,
    status,
    outcome,
    durationMs: Date.now() - startedAt,
  });

  const authentication = authenticateInternalRequest(request.headers);
  if (!authentication.ok) {
    finish(authentication.status, authentication.code);
    return response({ error: authentication.code }, authentication.status, requestId);
  }
  const rateLimit = consumeEndpointRateLimit('enrich', config);
  if (!rateLimit.allowed) {
    finish(429, 'RATE_LIMITED');
    const result = response({ error: 'RATE_LIMITED' }, 429, requestId);
    result.headers.set('retry-after', String(rateLimit.retryAfterSeconds));
    return result;
  }

  try {
    const result = await getApolloUsageSnapshot(getApolloApiKey(), config);
    finish(200, 'COMPLETED');
    return response(result, 200, requestId);
  } catch (error) {
    if (error instanceof ApolloGatewayError) {
      finish(error.status, error.code);
      return response({ error: error.code }, error.status, requestId);
    }
    finish(500, 'BACKEND_ERROR');
    return response({ error: 'BACKEND_ERROR' }, 500, requestId);
  }
}
