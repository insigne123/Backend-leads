import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export async function POST(req: Request) {
    console.log('--- Incoming Apollo Webhook ---');

    try {
        const url = new URL(req.url);
        const record_id = url.searchParams.get('record_id');
        const table_name = url.searchParams.get('table_name');

        if (!record_id || !table_name) {
            console.error('Webhook Error: Missing record_id or table_name in query params');
            return NextResponse.json({ error: 'Missing query params' }, { status: 400 });
        }

        const body = await req.json();
        // Apollo sends the person object directly or wrapped. Usually it's the whole person object in the body
        // or inside a `person` key depending on the event. For `people/match` webhook, it mirrors the response.
        // Let's assume the body IS the person object or contains it.
        // Based on docs, it returns the same JSON structure as the API response.

        const person = body.person || body; // Handle both cases just to be safe

        if (!person || !person.email) {
            console.warn('Webhook: No person data found in body', body);
            // We verify if it was a failure payload?
            return NextResponse.json({ received: true, processed: false, reason: 'No person data' });
        }

        console.log(`Webhook Processing: Record ${record_id} for ${table_name}. Found: ${person.email}`);

        // Prepare updates
        const updates: any = {
            enrichment_status: 'completed',
            updated_at: new Date().toISOString(),
            email: person.email,
            email_status: person.email_status || 'verified',
        };

        if (person.phone_numbers && person.phone_numbers.length > 0) {
            updates.phone_numbers = person.phone_numbers;
            const mobile = person.phone_numbers.find((qn: any) => qn.type === 'mobile');
            updates.primary_phone = mobile ? mobile.sanitized_number : person.phone_numbers[0].sanitized_number;
        } else if (person.organization && (person.organization.sanitized_phone || person.organization.phone)) {
            // FALLBACK: Use Organization Phone
            updates.primary_phone = person.organization.sanitized_phone || person.organization.phone;
            updates.phone_numbers = [{
                type: 'work_headquarters',
                sanitized_number: updates.primary_phone,
                number: person.organization.phone
            }];
        }

        // Update Supabase
        const supabaseAdmin = getServiceSupabase();
        const { error: updateError } = await supabaseAdmin
            .from(table_name)
            .update(updates)
            .eq('id', record_id);

        if (updateError) {
            console.error('Webhook Supabase Error:', updateError);
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }

        // Log success
        await supabaseAdmin.from('enrichment_logs').insert({
            record_id,
            table_name,
            status: 'webhook_received',
            details: {
                source: 'webhook',
                email: person.email,
                phone_count: person.phone_numbers?.length || (updates.primary_phone ? 1 : 0)
            }
        });

        return NextResponse.json({ received: true, processed: true });

    } catch (error: any) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
