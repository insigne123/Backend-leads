import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateInternalRequest,
  auditGatewayRequest,
  consumeEndpointRateLimit,
  getGatewayConfig,
  getRequestId,
  readBoundedJsonBody,
} from '../../../lib/gateway';
import { executeProviderLeadSearch, isLeadProviderGatewayError } from '../../../lib/lead-provider';
import { validateLeadSearchInput } from '../../../lib/validation';

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
      route: 'lead-search',
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

  const rateLimit = consumeEndpointRateLimit('lead-search', config);
  if (!rateLimit.allowed) {
    finish(429, 'RATE_LIMITED', { rateLimit: rateLimit.limit });
    const result = response({ error: 'RATE_LIMITED' }, 429, requestId);
    result.headers.set('retry-after', String(rateLimit.retryAfterSeconds));
    result.headers.set('x-rate-limit-limit', String(rateLimit.limit));
    return result;
  }

  const body = await readBoundedJsonBody(request, config.maxRequestBytes);
  if (!body.ok) {
    finish(body.status, body.code);
    return response({ error: body.code }, body.status, requestId);
  }

  const input = validateLeadSearchInput(body.value, config);
  if (!input.ok) {
    finish(400, 'INVALID_REQUEST');
    return response({ error: 'INVALID_REQUEST', details: input.issues }, 400, requestId);
  }

  try {
    const result = await executeProviderLeadSearch(input.value, config);
    finish(200, 'COMPLETED', {
      provider: input.value.provider,
      searchMode: input.value.searchMode,
      requestedResults: input.value.maxResults,
      returnedResults: Number(result.count) || 0,
      rateLimitRemaining: rateLimit.remaining,
    });
    return response(result, 200, requestId);
  } catch (error) {
    if (isLeadProviderGatewayError(error)) {
      finish(error.status, error.code, {
        provider: input.value.provider,
        searchMode: input.value.searchMode,
      });
      return response({ error: error.code }, error.status, requestId);
    }

    console.error('[apollo-backend] lead-search failed', { requestId, code: 'BACKEND_ERROR' });
    finish(500, 'BACKEND_ERROR', {
      provider: input.value.provider,
      searchMode: input.value.searchMode,
    });
    return response({ error: 'BACKEND_ERROR' }, 500, requestId);
  }
}
