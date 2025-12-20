import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(req: Request) {
    console.log('--- Starting Enrichment Request ---');

    // 1. Security Check
    const secretKey = req.headers.get('x-api-secret-key');
    if (secretKey !== process.env.API_SECRET_KEY) {
        console.warn('Unauthorized access attempt: Invalid Secret Key');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { record_id, lead, config, table_name } = body;

        if (!record_id || !lead || !table_name) {
            return NextResponse.json({ error: 'Missing required fields: record_id, lead, or table_name' }, { status: 400 });
        }

        console.log(`Processing Record ID: ${record_id} for Table: ${table_name}`);

        const apiKey = process.env.APOLLO_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'Server misconfiguration: Missing APOLLO_API_KEY' }, { status: 500 });
        }

        // 2. Call Apollo API (Match or Enrich by ID)
        let matchResponse;
        if (lead.apollo_id) {
            console.log(`Enriching via Apollo ID: ${lead.apollo_id}`);
            matchResponse = await enrichWithApolloId(apiKey, lead.apollo_id);
        } else {
            console.log('Enrichment: Enriching via Search/Match');
            matchResponse = await enrichWithApollo(apiKey, lead);
        }

        // --- DEBUG LOGGING START ---
        console.log('--- RAW APOLLO RESPONSE ---');
        console.log(JSON.stringify(matchResponse, null, 2));
        console.log('---------------------------');

        if (matchResponse?.person?.phone_numbers) {
            console.log('Phone numbers found explicitly:', matchResponse.person.phone_numbers);
        } else {
            console.log('No phone_numbers array in matchResponse.person');
        }
        // --- DEBUG LOGGING END ---

        // 3. Process Results
        let updates: any = {
            enrichment_status: 'failed',
            updated_at: new Date().toISOString(),
        };

        if (matchResponse && matchResponse.person) {
            const p = matchResponse.person;
            updates.enrichment_status = 'completed';

            // Phone Numbers
            if (p.phone_numbers && p.phone_numbers.length > 0) {
                updates.phone_numbers = p.phone_numbers;
                // Try to find a mobile or direct number for primary
                const mobile = p.phone_numbers.find((qn: any) => qn.type === 'mobile');
                updates.primary_phone = mobile ? mobile.sanitized_number : p.phone_numbers[0].sanitized_number;
            }

            // Email Logic
            if (p.email && p.email !== 'email_not_unlocked@apollo.io') {
                updates.email = p.email;
                updates.email_status = p.email_status || 'verified';
            } else {
                console.log('Apollo did not return a revealed email. Keeping original.');
            }

            console.log(`Match Found! Email: ${p.email}, Phones: ${p.phone_numbers?.length || 0}`);
        } else {
            console.log('No match found in Apollo.');
        }

        // 4. Update Supabase (using Service Role to bypass RLS)
        const supabaseAdmin = getServiceSupabase();

        // Update the Lead Record
        const { error: updateError } = await supabaseAdmin
            .from(table_name)
            .update(updates)
            .eq('id', record_id);

        let finalStatus = updates.enrichment_status;
        let errorMessage = null;

        if (updateError) {
            console.error('Supabase Update Error:', updateError);
            finalStatus = 'failed';
            errorMessage = updateError.message;
        }

        // 5. Insert into Logs
        await supabaseAdmin.from('enrichment_logs').insert({
            record_id,
            table_name,
            status: finalStatus,
            details: {
                match_method: lead.apollo_id ? 'apollo_id' : 'people_match',
                match_found: !!(matchResponse && matchResponse.person),
                email_found: updates.email || null,
                phone_count: updates.phone_numbers?.length || 0,
                error: errorMessage,
                apollo_data: matchResponse?.person ? {
                    email: matchResponse.person.email,
                    name: `${matchResponse.person.first_name} ${matchResponse.person.last_name}`
                } : null
            }
        });

        if (updateError) {
            return NextResponse.json({ error: `Database update failed: ${updateError.message}` }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            enrichment_status: updates.enrichment_status,
            data_found: !!(matchResponse && matchResponse.person),
            debug_apollo_response: matchResponse // Expose for debugging
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

async function enrichWithApolloId(apiKey: string, apolloId: string, retries = 2): Promise<any> {
    const url = 'https://api.apollo.io/v1/people/enrich';

    // Per user instructions: reveal_personal_emails: false, reveal_phone_number: true
    const payload = {
        api_key: apiKey,
        id: apolloId,
        reveal_personal_emails: false,
        reveal_phone_number: true
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (response.status === 429 && retries > 0) {
            console.warn('Apollo Rate Limit (429). Retrying...');
            await delay(1500 * (3 - retries));
            return enrichWithApolloId(apiKey, apolloId, retries - 1);
        }

        if (!response.ok) {
            const txt = await response.text();
            console.error(`Apollo API Error (${response.status}): ${txt}`);
            return null;
        }

        return await response.json();

    } catch (error: any) {
        console.error('Apollo Fetch Error (Enrich by ID):', error);
        return { error: error.message || 'Unknown Fetch Error' };
    }
}

async function enrichWithApollo(apiKey: string, lead: any, retries = 2): Promise<any> {
    const url = 'https://api.apollo.io/v1/people/match';

    const payload: any = {
        api_key: apiKey, // Apollo Match uses body param often, verify if header supported. Docs say body for match usually works best or header. Stick to header if X-Api-Key works, but for safety lets use headers as we did before.
        reveal_personal_emails: true,
        reveal_phone_number: true,
    };

    if (lead.first_name) payload.first_name = lead.first_name;
    if (lead.last_name) payload.last_name = lead.last_name;
    if (lead.email) payload.email = lead.email;
    if (lead.organization_name) payload.organization_name = lead.organization_name;
    if (lead.organization_domain) payload.domain = lead.organization_domain;
    if (lead.linkedin_url) payload.linkedin_url = lead.linkedin_url;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (response.status === 429 && retries > 0) {
            console.warn('Apollo Rate Limit (429). Retrying...');
            await delay(1500 * (3 - retries)); // Exponential-ish backoff
            return enrichWithApollo(apiKey, lead, retries - 1);
        }

        if (!response.ok) {
            const txt = await response.text();
            console.error(`Apollo API Error (${response.status}): ${txt}`);
            return null;
        }

        return await response.json();

    } catch (error: any) {
        console.error('Apollo Fetch Error:', error);
        return { error: error.message || 'Unknown Fetch Error' };
    }
}
