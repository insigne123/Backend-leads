import {
  ApolloGatewayError,
  executeApolloLeadSearch,
  getApolloApiKey,
} from './apollo';
import type { GatewayConfig, GatewayEnvironment } from './gateway';
import type { LeadSearchInput } from './validation';

export type LeadProviderGatewayError = ApolloGatewayError;

export function isLeadProviderGatewayError(error: unknown): error is LeadProviderGatewayError {
  return error instanceof ApolloGatewayError;
}

export async function executeProviderLeadSearch(
  input: LeadSearchInput,
  config: GatewayConfig,
  environment: GatewayEnvironment = process.env,
) {
  return executeApolloLeadSearch(input, getApolloApiKey(environment), config);
}
