import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const BASE_URL = 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app';

type RevealPreferences = {
    revealEmail: boolean;
    revealPhone: boolean;
    enrichmentLevel: 'basic' | 'deep' | null;
    requestedFields: string[];
};

function parseBooleanFlag(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    }

    return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
    for (const value of values) {
        const parsed = parseBooleanFlag(value);
        if (parsed !== null) return parsed;
    }

    return null;
}

function normalizeRequestedFields(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function resolveRevealPreferences(body: any): RevealPreferences {
    const config = body?.config && typeof body.config === 'object' ? body.config : {};
    const requestedData = body?.requested_data && typeof body.requested_data === 'object'
        ? body.requested_data
        : body?.requestedData && typeof body.requestedData === 'object'
            ? body.requestedData
            : config?.requested_data && typeof config.requested_data === 'object'
                ? config.requested_data
                : config?.requestedData && typeof config.requestedData === 'object'
                    ? config.requestedData
                    : {};

    const requestedFields = normalizeRequestedFields(
        body?.requested_fields ??
        body?.requestedFields ??
        config?.requested_fields ??
        config?.requestedFields
    );

    const levelCandidate =
        (typeof body?.enrichment_level === 'string' && body.enrichment_level) ||
        (typeof body?.enrichmentLevel === 'string' && body.enrichmentLevel) ||
        (typeof config?.enrichment_level === 'string' && config.enrichment_level) ||
        (typeof config?.enrichmentLevel === 'string' && config.enrichmentLevel) ||
        '';

    const normalizedLevel = levelCandidate.trim().toLowerCase();
    const enrichmentLevel: RevealPreferences['enrichmentLevel'] =
        normalizedLevel === 'basic' || normalizedLevel === 'deep'
            ? normalizedLevel
            : null;

    const revealEmailFromFields = requestedFields.length > 0 ? requestedFields.includes('email') : null;
    const revealPhoneFromFields = requestedFields.length > 0 ? requestedFields.includes('phone') : null;

    const revealEmail = firstBoolean(
        body?.reveal_email,
        body?.revealEmail,
        config?.reveal_email,
        config?.revealEmail,
        requestedData?.email,
        revealEmailFromFields,
        enrichmentLevel === 'basic' || enrichmentLevel === 'deep' ? true : null
    ) ?? true;

    const revealPhone = firstBoolean(
        body?.reveal_phone,
        body?.revealPhone,
        config?.reveal_phone,
        config?.revealPhone,
        requestedData?.phone,
        revealPhoneFromFields,
        enrichmentLevel === 'basic' ? false : enrichmentLevel === 'deep' ? true : null
    ) ?? true;

    return {
        revealEmail,
        revealPhone,
        enrichmentLevel,
        requestedFields,
    };
}

function buildWebhookUrl(recordId: string, tableName: string, revealPreferences: Pick<RevealPreferences, 'revealEmail' | 'revealPhone'>): string {
    const webhookUrl = new URL(`${BASE_URL}/api/apollo-webhook`);
    webhookUrl.searchParams.set('record_id', recordId);
    webhookUrl.searchParams.set('table_name', tableName);
    webhookUrl.searchParams.set('reveal_email', String(revealPreferences.revealEmail));
    webhookUrl.searchParams.set('reveal_phone', String(revealPreferences.revealPhone));
    return webhookUrl.toString();
}

function extractMissingColumnFromError(message?: string | null): string | null {
    if (!message) return null;
    const match = message.match(/Could not find the '([^']+)' column/i);
    return match ? match[1] : null;
}

async function updateRowWithSchemaFallback(
    supabaseAdmin: any,
    tableName: string,
    recordId: string,
    updates: Record<string, any>
) {
    const safeUpdates: Record<string, any> = { ...updates };
    const removedColumns: string[] = [];
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;

        const { error, data } = await supabaseAdmin
            .from(tableName)
            .update(safeUpdates)
            .eq('id', recordId)
            .select();

        if (!error) {
            return {
                error: null,
                data,
                removedColumns,
                finalUpdates: safeUpdates,
            };
        }

        const missingColumn = extractMissingColumnFromError(error.message);
        if (!missingColumn || !(missingColumn in safeUpdates)) {
            return {
                error,
                data,
                removedColumns,
                finalUpdates: safeUpdates,
            };
        }

        delete safeUpdates[missingColumn];
        removedColumns.push(missingColumn);
        console.warn(`Schema fallback: removed missing column '${missingColumn}' for table '${tableName}'.`);

        if (Object.keys(safeUpdates).length === 0) {
            return {
                error: {
                    message: `Database update failed: No valid columns remain after schema fallback for table ${tableName}`,
                },
                data: null,
                removedColumns,
                finalUpdates: safeUpdates,
            };
        }
    }

    return {
        error: {
            message: `Database update failed: Exceeded schema fallback attempts for table ${tableName}`,
        },
        data: null,
        removedColumns,
        finalUpdates: safeUpdates,
    };
}

function extractPersonFromApolloResponse(response: any): any | null {
    if (response?.person && typeof response.person === 'object') return response.person;

    if (Array.isArray(response?.matches)) {
        const match = response.matches.find((entry: any) => entry && typeof entry === 'object');
        if (match) return match;
    }

    if (Array.isArray(response?.people)) {
        const person = response.people.find((entry: any) => entry && typeof entry === 'object');
        if (person) return person;
    }

    return null;
}

export async function POST(req: Request) {
    console.log('--- Starting Enrichment Request ---');
    try {
        const url = new URL(req.url);
        const body = await req.json().catch(() => ({}));
        const secretKeyHeader = req.headers.get('x-api-secret-key');
        const apiKeyHeader = req.headers.get('x-api-key');
        const secretKeyQuery = url.searchParams.get('secret_key');
        const altSecretKeyQuery = url.searchParams.get('api_secret_key');
        const authHeader = req.headers.get('authorization');

        const bearerToken = authHeader?.toLowerCase().startsWith('bearer ')
            ? authHeader.slice(7)
            : null;

        const secretKeyBody =
            typeof body?.secret_key === 'string'
                ? body.secret_key
                : typeof body?.api_secret_key === 'string'
                    ? body.api_secret_key
                    : null;

        const providedKeyRaw =
            secretKeyHeader ||
            apiKeyHeader ||
            secretKeyQuery ||
            altSecretKeyQuery ||
            bearerToken ||
            secretKeyBody ||
            '';

        const providedKey = providedKeyRaw.trim();
        const expectedKey = (process.env.API_SECRET_KEY || '').trim();
        const apolloApiKey = (process.env.APOLLO_API_KEY || '').trim();

        // DEBUG AUTH
        console.log('--- AUTH DEBUG ---');
        console.log(`URL: ${url.toString()}`);
        console.log(`Header Key Present: ${!!secretKeyHeader}`);
        console.log(`Alt Header x-api-key Present: ${!!apiKeyHeader}`);
        console.log(`Query secret_key Present: ${!!secretKeyQuery}`);
        console.log(`Query api_secret_key Present: ${!!altSecretKeyQuery}`);
        console.log(`Authorization Bearer Present: ${!!bearerToken}`);
        console.log(`Body secret_key Present: ${!!secretKeyBody}`);
        console.log(`Env Key Configured: ${!!expectedKey}`);
        if (expectedKey) console.log(`Env Key First 3 chars: ${expectedKey.substring(0, 3)}`);
        if (providedKey) console.log(`Provided Key First 3 chars: ${providedKey.substring(0, 3)}`);
        console.log('------------------');

        if (!expectedKey) {
            console.error('Server misconfiguration: API_SECRET_KEY is not configured');
            return NextResponse.json({ error: 'Server misconfiguration: Missing API_SECRET_KEY' }, { status: 500 });
        }

        if (providedKey !== expectedKey) {
            console.warn('Unauthorized access attempt: Invalid or Missing Secret Key');
            const providedApolloKeyByMistake = !!(providedKey && apolloApiKey && providedKey === apolloApiKey);

            if (providedApolloKeyByMistake) {
                console.warn('Auth mismatch: Caller sent APOLLO_API_KEY where API_SECRET_KEY is required.');
            }

            const debugAuth = process.env.NODE_ENV !== 'production'
                ? {
                    has_x_api_secret_key: !!secretKeyHeader,
                    has_x_api_key: !!apiKeyHeader,
                    has_secret_key_query: !!secretKeyQuery,
                    has_api_secret_key_query: !!altSecretKeyQuery,
                    has_bearer_token: !!bearerToken,
                    has_secret_key_body: !!secretKeyBody,
                    provided_apollo_key_by_mistake: providedApolloKeyByMistake,
                }
                : undefined;

            const errorMessage = providedApolloKeyByMistake
                ? 'Unauthorized: APOLLO_API_KEY is not valid for /api/enrich auth. Use API_SECRET_KEY instead.'
                : 'Unauthorized: Missing valid x-api-secret-key header or secret_key param';

            return NextResponse.json(
                {
                    error: errorMessage,
                    debug_auth: debugAuth,
                },
                { status: 401 }
            );
        }

        const { lead } = body;
        const record_id = (body.record_id as string)?.trim();
        const table_name = (body.table_name as string)?.trim() || 'enriched_leads';
        const apolloPersonId = (lead?.apollo_id || lead?.id || '').toString().trim();
        const revealPreferences = resolveRevealPreferences(body);

        if (!record_id || !lead || !table_name) {
            return NextResponse.json({ error: 'Missing required fields: record_id, lead, or table_name' }, { status: 400 });
        }

        console.log(`Processing Record ID: ${record_id} for Table: ${table_name}`);
        console.log(
            `Requested reveal settings: email=${revealPreferences.revealEmail}, phone=${revealPreferences.revealPhone}, level=${revealPreferences.enrichmentLevel || 'n/a'}`
        );

        const apiKey = process.env.APOLLO_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Server misconfiguration: Missing APOLLO_API_KEY' }, { status: 500 });
        }

        // 2. Call Apollo API (Match or Enrich by ID)
        let matchResponse;
        if (apolloPersonId) {
            console.log(`Enriching via Apollo ID: ${apolloPersonId}`);
            matchResponse = await enrichWithApolloId(apiKey, apolloPersonId, record_id, table_name, revealPreferences);
        } else {
            console.log('Enrichment: Enriching via Search/Match');
            matchResponse = await enrichWithApollo(apiKey, lead, record_id, table_name, revealPreferences);
        }

        const matchedPerson = extractPersonFromApolloResponse(matchResponse);

        // --- DEBUG LOGGING START ---
        console.log('--- RAW APOLLO RESPONSE ---');
        console.log(JSON.stringify(matchResponse, null, 2));
        console.log('---------------------------');

        if (matchedPerson?.phone_numbers) {
            console.log('Phone numbers found explicitly:', matchedPerson.phone_numbers);
        } else {
            console.log('No phone_numbers array in matched Apollo person payload');
        }
        // --- DEBUG LOGGING END ---

        // 3. Process Results
        // Even with webhook, Apollo might return immediate results if cached.
        let updates: any = {
            enrichment_status: 'pending', // Default to pending since we expect webhook
            updated_at: new Date().toISOString(),
        };

        if (matchedPerson) {
            const p = matchedPerson;
            updates.enrichment_status = 'completed'; // If we got data immediately, mark completed

            // Basic Fields - Fill if available
            if (p.first_name) updates.first_name = p.first_name;
            if (p.last_name) updates.last_name = p.last_name;
            if (p.linkedin_url) updates.linkedin_url = p.linkedin_url;
            if (p.title) updates.title = p.title;

            // Location Data
            if (p.city) updates.city = p.city;
            if (p.state) updates.state = p.state;
            if (p.country) updates.country = p.country;

            // Professional Info
            if (p.headline) updates.headline = p.headline;
            if (p.photo_url) updates.photo_url = p.photo_url;
            if (p.seniority) updates.seniority = p.seniority;
            if (p.departments && p.departments.length > 0) updates.departments = p.departments;

            // Organization Data
            if (p.organization?.name) updates.organization_name = p.organization.name;
            if (p.organization?.primary_domain) updates.organization_domain = p.organization.primary_domain;
            if (p.organization?.industry) updates.organization_industry = p.organization.industry;
            if (p.organization?.estimated_num_employees) updates.organization_size = p.organization.estimated_num_employees;

            // Phone Numbers Logic
            if (revealPreferences.revealPhone) {
                if (p.phone_numbers && p.phone_numbers.length > 0) {
                    updates.phone_numbers = p.phone_numbers;
                    const mobile = p.phone_numbers.find((qn: any) => qn.type === 'mobile');
                    updates.primary_phone = mobile ? mobile.sanitized_number : p.phone_numbers[0].sanitized_number;
                } else if (p.organization && (p.organization.sanitized_phone || p.organization.phone)) {
                    // FALLBACK: Use Organization Phone
                    console.log('No direct phone found. Using Organization Phone fallback.');
                    updates.primary_phone = p.organization.sanitized_phone || p.organization.phone;
                    updates.phone_numbers = [{
                        type: 'work_headquarters',
                        sanitized_number: updates.primary_phone,
                        number: p.organization.phone
                    }];
                }
            } else {
                console.log('Phone reveal disabled by request. Skipping phone updates.');
            }

            // Email Logic
            if (!revealPreferences.revealEmail) {
                console.log('Email reveal disabled by request. Skipping email updates.');
            } else if (p.email && p.email !== 'email_not_unlocked@apollo.io') {
                updates.email = p.email;
                updates.email_status = p.email_status || 'verified';
            } else {
                console.log('Apollo did not return a revealed email. Keeping original.');
            }

            console.log(`Match Found! Email: ${p.email}, Phones: ${p.phone_numbers?.length || 0}, Location: ${p.city}, ${p.state}, ${p.country}`);
        } else {
            console.log('No match found in Apollo (or async pending).');
        }

        // If we got a specific error from our wrapper
        if (matchResponse?.error) {
            updates.enrichment_status = 'failed';
        } else if (!matchedPerson) {
            updates.enrichment_status = 'failed';
        }

        // 4. Update Supabase
        const supabaseAdmin = getServiceSupabase();

        // 4.1 Retry Logic: Wait for row to exist (Race Condition Fix)
        let rowExists = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts && !rowExists) {
            attempts++;
            const { data: checkData } = await supabaseAdmin
                .from(table_name)
                .select('id')
                .eq('id', record_id)
                .single();

            if (checkData) {
                rowExists = true;
                console.log(`Row found on attempt ${attempts}`);
            } else {
                console.log(`Attempt ${attempts}: Row ${record_id} not found yet. Waiting...`);
                if (attempts < maxAttempts) await new Promise(res => setTimeout(res, 2000)); // Wait 2s
            }
        }

        console.log(`Debug Check: Row ${record_id} exists? ${rowExists} after ${attempts} attempts`);

        const {
            error: updateError,
            data: updatedData,
            removedColumns,
            finalUpdates,
        } = await updateRowWithSchemaFallback(
            supabaseAdmin,
            table_name,
            record_id,
            updates
        );

        if (removedColumns.length > 0) {
            console.warn(`Schema fallback removed columns for ${table_name}: ${removedColumns.join(', ')}`);
        }

        let finalStatus = updates.enrichment_status;
        let errorMessage = null;

        if (updateError) {
            console.error('Supabase Update Error:', updateError);
            finalStatus = 'failed';
            errorMessage = updateError.message;
        }

        const dbUpdateCount = Array.isArray(updatedData) ? updatedData.length : 0;

        // 5. Insert into Logs
        const keySuffix = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-5) || 'NONE';

        await supabaseAdmin.from('enrichment_logs').insert({
            record_id,
            table_name,
            status: finalStatus,
            details: {
                match_method: apolloPersonId ? 'apollo_id' : 'people_match',
                match_found: !!(matchedPerson && !matchResponse.error),
                is_async: true,
                key_suffix: keySuffix, // DEBUG KEY SIGNATURE
                requested_reveal: {
                    email: revealPreferences.revealEmail,
                    phone: revealPreferences.revealPhone,
                    enrichment_level: revealPreferences.enrichmentLevel,
                    requested_fields: revealPreferences.requestedFields,
                },
                email_found: finalUpdates.email || null,
                phone_count: finalUpdates.phone_numbers?.length || 0,
                db_update_count: dbUpdateCount,
                row_check_found: rowExists,
                removed_columns: removedColumns,
                check_error: !rowExists ? 'Row not found after retries' : null,
                post_update_db_state: updatedData,
                error: errorMessage || matchResponse?.error,
                supabase_data: finalUpdates,
                apollo_data: matchedPerson || null
            }
        });

        if (updateError) {
            return NextResponse.json({ error: `Database update failed: ${updateError.message}` }, { status: 500 });
        }

        return NextResponse.json({
            success: updates.enrichment_status !== 'failed',
            enrichment_status: updates.enrichment_status,
            data_found: !!matchedPerson,
            debug_apollo_response: matchResponse, // Expose for debugging
            requested_reveal: {
                email: revealPreferences.revealEmail,
                phone: revealPreferences.revealPhone,
                enrichment_level: revealPreferences.enrichmentLevel,
                requested_fields: revealPreferences.requestedFields,
            },
            extracted_data: finalUpdates,
            removed_columns: removedColumns
        });

    } catch (error: any) {
        console.error('Enrichment Worker Error:', error);

        // Log the crash if possible
        try {
            const supabaseAdmin = getServiceSupabase();
            await supabaseAdmin.from('enrichment_logs').insert({
                record_id: 'unknown',
                table_name: 'unknown',
                status: 'error',
                details: { error: error.message }
            });
        } catch (e) { /* ignore log failure */ }

        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function enrichWithApolloId(
    apiKey: string,
    apolloId: string,
    recordId: string,
    tableName: string,
    revealPreferences: RevealPreferences,
    retries = 2
): Promise<any> {
    // Construct Webhook URL
    const webhookUrl = buildWebhookUrl(recordId, tableName, revealPreferences);

    const params = new URLSearchParams();
    params.set('reveal_personal_emails', String(revealPreferences.revealEmail));
    params.set('reveal_phone_number', String(revealPreferences.revealPhone));
    params.set('webhook_url', webhookUrl);

    const url = `https://api.apollo.io/api/v1/people/bulk_match?${params.toString()}`;
    const payload = {
        details: [{ id: apolloId }],
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'accept': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (response.status === 429 && retries > 0) {
            console.warn('Apollo Rate Limit (429). Retrying...');
            await delay(1500 * (3 - retries));
            return enrichWithApolloId(apiKey, apolloId, recordId, tableName, revealPreferences, retries - 1);
        }

        if (!response.ok) {
            const txt = await response.text();
            console.error(`Apollo API Error (${response.status}): ${txt}`);
            return { error: `Apollo API Error (${response.status})`, details: txt };
        }

        return await response.json();

    } catch (error: any) {
        console.error('Apollo Fetch Error (Enrich by ID):', error);
        return { error: error.message || 'Unknown Fetch Error' };
    }
}

async function enrichWithApollo(
    apiKey: string,
    lead: any,
    recordId: string,
    tableName: string,
    revealPreferences: RevealPreferences,
    retries = 2
): Promise<any> {
    // Construct Webhook URL
    const webhookUrl = buildWebhookUrl(recordId, tableName, revealPreferences);

    const params = new URLSearchParams();
    params.set('reveal_personal_emails', String(revealPreferences.revealEmail));
    params.set('reveal_phone_number', String(revealPreferences.revealPhone));
    params.set('webhook_url', webhookUrl);

    if (lead.first_name) params.set('first_name', lead.first_name);
    if (lead.last_name) params.set('last_name', lead.last_name);
    if (lead.email) params.set('email', lead.email);
    if (lead.organization_name) params.set('organization_name', lead.organization_name);

    // Cleanup domain input
    if (lead.organization_domain) {
        params.set('domain', lead.organization_domain.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    }

    if (lead.linkedin_url) params.set('linkedin_url', lead.linkedin_url);

    const url = `https://api.apollo.io/api/v1/people/match?${params.toString()}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'accept': 'application/json',
                'x-api-key': apiKey,
            },
            body: '{}',
        });

        if (response.status === 429 && retries > 0) {
            console.warn('Apollo Rate Limit (429). Retrying...');
            await delay(1500 * (3 - retries)); // Exponential-ish backoff
            return enrichWithApollo(apiKey, lead, recordId, tableName, revealPreferences, retries - 1);
        }

        if (!response.ok) {
            const txt = await response.text();
            console.error(`Apollo API Error (${response.status}): ${txt}`);
            return { error: `Apollo API Error (${response.status})`, details: txt };
        }

        return await response.json();

    } catch (error: any) {
        console.error('Apollo Fetch Error:', error);
        return { error: error.message || 'Unknown Fetch Error' };
    }
}
