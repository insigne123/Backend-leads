import { SearchSourceType } from './types';

type VaneProviderModel = {
    key: string;
    name: string;
};

type VaneProvider = {
    id: string;
    name: string;
    chatModels: VaneProviderModel[];
    embeddingModels: VaneProviderModel[];
};

type VaneProvidersResponse = {
    providers: VaneProvider[];
};

type VaneSource = {
    content?: string;
    metadata?: {
        title?: string;
        url?: string;
    };
};

type VaneSearchResponse = {
    message?: string;
    sources?: VaneSource[];
};

type ProviderSelection = {
    providerId: string;
    providerName: string;
    chatModelKey: string;
    embeddingModelKey: string;
};

export type VaneSearchRequest = {
    query: string;
    sources: SearchSourceType[];
    optimizationMode: 'speed' | 'balanced' | 'quality';
    systemInstructions: string;
};

export type VaneSearchResult = {
    message: string;
    sources: Array<{ title: string; url: string; content: string }>;
    providerName: string;
    providerVersion: string | null;
    model: string;
    durationMs: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedTotalTokens: number;
    estimatedCostUsd: number | null;
};

type VaneConfig = {
    baseUrl: string;
    timeoutMs: number;
    providerName: string | null;
    chatModelKey: string | null;
    embeddingModelKey: string | null;
    providerVersion: string | null;
    authHeaderName: string | null;
    authHeaderValue: string | null;
};

const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

let providerCache: {
    baseUrl: string;
    expiresAt: number;
    selection: ProviderSelection;
} | null = null;

function normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
}

function getVaneConfig(): VaneConfig {
    const baseUrl = process.env.VANE_BASE_URL?.trim();

    if (!baseUrl) {
        throw new Error('Missing VANE_BASE_URL');
    }

    const authHeaderName = process.env.VANE_AUTH_HEADER_NAME?.trim() ||
        (process.env.VANE_API_KEY ? 'Authorization' : null);
    const authHeaderValue = process.env.VANE_AUTH_HEADER_VALUE?.trim() ||
        (process.env.VANE_API_KEY ? `Bearer ${process.env.VANE_API_KEY.trim()}` : null);

    return {
        baseUrl: normalizeBaseUrl(baseUrl),
        timeoutMs: Number(process.env.VANE_TIMEOUT_MS || '90000'),
        providerName: process.env.VANE_PROVIDER_NAME?.trim() || null,
        chatModelKey: process.env.VANE_CHAT_MODEL_KEY?.trim() || null,
        embeddingModelKey: process.env.VANE_EMBEDDING_MODEL_KEY?.trim() || null,
        providerVersion: process.env.VANE_PROVIDER_VERSION?.trim() || null,
        authHeaderName,
        authHeaderValue,
    };
}

function buildHeaders(config: VaneConfig): HeadersInit {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'accept': 'application/json',
    };

    if (config.authHeaderName && config.authHeaderValue) {
        headers[config.authHeaderName] = config.authHeaderValue;
    }

    return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchJsonWithRetry<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    retries = 2
): Promise<T> {
    const response = await fetchWithTimeout(url, init, timeoutMs);

    if (!response.ok) {
        const details = await response.text();

        if ((response.status === 429 || response.status >= 500) && retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1200 * (3 - retries)));
            return fetchJsonWithRetry<T>(url, init, timeoutMs, retries - 1);
        }

        throw new Error(`VANE_REQUEST_FAILED:${response.status}:${details}`);
    }

    return response.json();
}

async function resolveProviderSelection(config: VaneConfig): Promise<ProviderSelection> {
    if (providerCache && providerCache.baseUrl === config.baseUrl && providerCache.expiresAt > Date.now()) {
        return providerCache.selection;
    }

    const url = `${config.baseUrl}/api/providers`;
    const data = await fetchJsonWithRetry<VaneProvidersResponse>(
        url,
        {
            method: 'GET',
            headers: buildHeaders(config),
            cache: 'no-store',
        },
        config.timeoutMs,
    );

    if (!Array.isArray(data.providers) || data.providers.length === 0) {
        throw new Error('No Vane providers are configured');
    }

    const provider = config.providerName
        ? data.providers.find((item) => item.name.toLowerCase() === config.providerName?.toLowerCase())
        : data.providers[0];

    if (!provider) {
        throw new Error(`Configured Vane provider not found: ${config.providerName}`);
    }

    const chatModel = config.chatModelKey
        ? provider.chatModels.find((item) => item.key === config.chatModelKey)
        : provider.chatModels[0];

    const embeddingModel = config.embeddingModelKey
        ? provider.embeddingModels.find((item) => item.key === config.embeddingModelKey)
        : provider.embeddingModels[0];

    if (!chatModel) {
        throw new Error(`Configured Vane chat model not found for provider ${provider.name}`);
    }

    if (!embeddingModel) {
        throw new Error(`Configured Vane embedding model not found for provider ${provider.name}`);
    }

    const selection: ProviderSelection = {
        providerId: provider.id,
        providerName: provider.name,
        chatModelKey: chatModel.key,
        embeddingModelKey: embeddingModel.key,
    };

    providerCache = {
        baseUrl: config.baseUrl,
        selection,
        expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
    };

    return selection;
}

function normalizeSearchSources(sources: SearchSourceType[]): SearchSourceType[] {
    const unique = Array.from(new Set(sources));
    return unique.length > 0 ? unique : ['web'];
}

function approximateTokens(value: string): number {
    const chars = value.trim().length;
    if (!chars) return 0;
    return Math.max(1, Math.ceil(chars / 4));
}

function getModelPricing(model: string): { inputPerMillion: number; outputPerMillion: number } | null {
    const envInput = process.env.VANE_INPUT_COST_PER_1M_USD;
    const envOutput = process.env.VANE_OUTPUT_COST_PER_1M_USD;

    if (envInput && envOutput) {
        const inputPerMillion = Number(envInput);
        const outputPerMillion = Number(envOutput);

        if (Number.isFinite(inputPerMillion) && Number.isFinite(outputPerMillion)) {
            return { inputPerMillion, outputPerMillion };
        }
    }

    switch (model) {
        case 'gpt-4o-mini':
            return { inputPerMillion: 0.15, outputPerMillion: 0.6 };
        case 'gpt-5-mini':
            return { inputPerMillion: 0.25, outputPerMillion: 2.0 };
        case 'gpt-5.4':
            return { inputPerMillion: 2.5, outputPerMillion: 15.0 };
        default:
            return null;
    }
}

export async function callVaneSearch(request: VaneSearchRequest): Promise<VaneSearchResult> {
    const config = getVaneConfig();
    const selection = await resolveProviderSelection(config);

    const payload = {
        chatModel: {
            providerId: selection.providerId,
            key: selection.chatModelKey,
        },
        embeddingModel: {
            providerId: selection.providerId,
            key: selection.embeddingModelKey,
        },
        optimizationMode: request.optimizationMode,
        sources: normalizeSearchSources(request.sources),
        query: request.query,
        history: [],
        systemInstructions: request.systemInstructions,
        stream: false,
    };

    const url = `${config.baseUrl}/api/search`;
    const startedAt = Date.now();
    const response = await fetchJsonWithRetry<VaneSearchResponse>(
        url,
        {
            method: 'POST',
            headers: buildHeaders(config),
            body: JSON.stringify(payload),
            cache: 'no-store',
        },
        config.timeoutMs,
    );

    const normalizedSources = Array.isArray(response.sources)
        ? response.sources
            .map((source) => {
                const title = source.metadata?.title?.trim() || 'Untitled source';
                const url = source.metadata?.url?.trim() || '';
                const content = source.content?.trim() || '';

                if (!url) return null;

                return {
                    title,
                    url,
                    content,
                };
            })
            .filter((source): source is { title: string; url: string; content: string } => Boolean(source))
        : [];

    const queryTokens = approximateTokens(request.query);
    const instructionTokens = approximateTokens(request.systemInstructions);
    const sourceContextTokens = normalizedSources.reduce(
        (sum, source) => sum + approximateTokens(`${source.title}\n${source.url}\n${source.content}`),
        0,
    );
    const messageTokens = approximateTokens(typeof response.message === 'string' ? response.message : '');

    const inputMultiplier = Number(process.env.VANE_COST_INPUT_MULTIPLIER || '3');
    const outputMultiplier = Number(process.env.VANE_COST_OUTPUT_MULTIPLIER || '1.15');
    const estimatedInputTokens = Math.max(
        queryTokens + instructionTokens,
        Math.round((queryTokens + instructionTokens) * (Number.isFinite(inputMultiplier) ? inputMultiplier : 3) + sourceContextTokens),
    );
    const estimatedOutputTokens = Math.max(
        messageTokens,
        Math.round(messageTokens * (Number.isFinite(outputMultiplier) ? outputMultiplier : 1.15)),
    );
    const pricing = getModelPricing(selection.chatModelKey);
    const estimatedCostUsd = pricing
        ? Number((((estimatedInputTokens / 1_000_000) * pricing.inputPerMillion) + ((estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion)).toFixed(6))
        : null;

    return {
        message: typeof response.message === 'string' ? response.message : '',
        sources: normalizedSources,
        providerName: selection.providerName,
        providerVersion: config.providerVersion,
        model: selection.chatModelKey,
        durationMs: Date.now() - startedAt,
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
        estimatedCostUsd,
    };
}

export function extractJsonFromMessage<T = Record<string, any>>(message: string): T {
    const trimmed = message.trim();

    const clean = trimmed
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    try {
        return JSON.parse(clean) as T;
    } catch {
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const slice = clean.slice(firstBrace, lastBrace + 1);
            return JSON.parse(slice) as T;
        }

        throw new Error('Unable to parse JSON payload from Vane message');
    }
}
