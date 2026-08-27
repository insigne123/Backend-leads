import {
  FullEnrichGatewayError,
  executeFullEnrichLeadSearch,
  getFullEnrichApiKey,
} from './fullenrich';
import type { GatewayConfig, GatewayEnvironment } from './gateway';
import type { LeadSearchInput } from './validation';

export type LeadProviderGatewayError = FullEnrichGatewayError;

export function isLeadProviderGatewayError(error: unknown): error is LeadProviderGatewayError {
  return error instanceof FullEnrichGatewayError;
}

export async function executeProviderLeadSearch(
  input: LeadSearchInput,
  config: GatewayConfig,
  environment: GatewayEnvironment = process.env,
) {
  return executeFullEnrichLeadSearch(input, getFullEnrichApiKey(environment), config);
}
