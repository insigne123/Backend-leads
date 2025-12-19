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

        // 2. Call Apollo Match API
        const matchResponse = await enrichWithApollo(apiKey, lead);

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

            // Email Logic: Only update if we got a new valid one and it's not "email locked" override
            // Note: Apollo match returns 'email' field.
            if (p.email && p.email !== 'email_not_unlocked@apollo.io') {
                updates.email = p.email;
                updates.email_status = p.email_status || 'verified';
            } else {
                // If Apollo didn't give a better email, keep the original one if it existed
                console.log('Apollo did not return a revealed email. Keeping original.');
            }

            // Helpful logging
            console.log(`Match Found! Email: ${p.email}, Phones: ${p.phone_numbers?.length || 0}`);
        } else {
            console.log('No match found in Apollo.');
        }

        // 4. Update Supabase (using Service Role to bypass RLS)
        const supabaseAdmin = getServiceSupabase();
        const { error: updateError } = await supabaseAdmin
            .from(table_name)
            .update(updates)
            .eq('id', record_id);

        if (updateError) {
            console.error('Supabase Update Error:', updateError);
            return NextResponse.json({ error: `Database update failed: ${updateError.message}` }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            enrichment_status: updates.enrichment_status,
            data_found: !!(matchResponse && matchResponse.person)
        });

    } catch (error: any) {
        console.error('Enrichment Worker Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function enrichWithApollo(apiKey: string, lead: any, retries = 2): Promise<any> {
    const url = 'https://api.apollo.io/v1/people/match';

    // Construct match payload based on available data
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

    } catch (error) {
        console.error('Apollo Fetch Error:', error);
        return null;
    }
}
