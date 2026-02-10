import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

const EMAIL_PLACEHOLDER = 'email_not_unlocked@apollo.io';

function looksLikePerson(candidate: any) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;

    const keys = [
        'id',
        'email',
        'emails',
        'phone_numbers',
        'first_name',
        'last_name',
        'name',
        'linkedin_url',
        'organization',
        'title',
    ];

    return keys.some((key) => candidate[key] !== undefined && candidate[key] !== null);
}

function resolvePersonFromWebhook(body: any) {
    if (looksLikePerson(body?.person)) return body.person;

    if (Array.isArray(body?.people)) {
        const person = body.people.find((entry: any) => looksLikePerson(entry));
        if (person) return person;
    }

    if (looksLikePerson(body)) return body;

    return null;
}

function resolveEmail(person: any): string | null {
    if (typeof person?.email === 'string') {
        const directEmail = person.email.trim();
        if (directEmail && directEmail !== EMAIL_PLACEHOLDER) {
            return directEmail;
        }
    }

    if (Array.isArray(person?.emails)) {
        for (const emailEntry of person.emails) {
            if (typeof emailEntry === 'string') {
                const email = emailEntry.trim();
                if (email && email !== EMAIL_PLACEHOLDER) return email;
                continue;
            }

            const nestedEmail = emailEntry?.email;
            if (typeof nestedEmail === 'string') {
                const email = nestedEmail.trim();
                if (email && email !== EMAIL_PLACEHOLDER) return email;
            }
        }
    }

    return null;
}

function resolvePhoneNumbers(person: any): any[] {
    if (!Array.isArray(person?.phone_numbers)) return [];
    return person.phone_numbers.filter(Boolean);
}

function resolvePrimaryPhone(phoneNumbers: any[]): string | null {
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

    const mobile = phoneNumbers.find((phone: any) => {
        const type = (phone?.type || phone?.type_cd || '').toString().toLowerCase();
        return type.includes('mobile');
    });

    const selected = mobile || phoneNumbers[0];
    const rawValue = selected?.sanitized_number || selected?.number || selected?.raw_number || null;

    if (typeof rawValue !== 'string') return null;
    const value = rawValue.trim();
    return value || null;
}

export async function POST(req: Request) {
    console.log('--- Incoming Apollo Webhook ---');

    try {
        const url = new URL(req.url);
        const record_id = url.searchParams.get('record_id')?.trim();
        const table_name = url.searchParams.get('table_name')?.trim();

        if (!record_id || !table_name) {
            console.error('Webhook Error: Missing record_id or table_name in query params');
            return NextResponse.json({ error: 'Missing query params' }, { status: 400 });
        }

        const body = await req.json();
        const person = resolvePersonFromWebhook(body);

        if (!person) {
            console.warn('Webhook: No person-like payload found in body', body);
            return NextResponse.json({ received: true, processed: false, reason: 'No person payload' });
        }

        const resolvedEmail = resolveEmail(person);
        const phoneNumbers = resolvePhoneNumbers(person);

        console.log(
            `Webhook Processing: Record ${record_id} for ${table_name}. Email: ${resolvedEmail || 'none'}, Phones: ${phoneNumbers.length}`
        );

        // Prepare updates
        const updates: any = {
            enrichment_status: 'completed',
            updated_at: new Date().toISOString(),
        };

        // Basic Fields
        if (person.first_name) updates.first_name = person.first_name;
        if (person.last_name) updates.last_name = person.last_name;
        if (person.linkedin_url) updates.linkedin_url = person.linkedin_url;
        if (person.title) updates.title = person.title;

        // Location Data
        if (person.city) updates.city = person.city;
        if (person.state) updates.state = person.state;
        if (person.country) updates.country = person.country;

        // Professional Info
        if (person.headline) updates.headline = person.headline;
        if (person.photo_url) updates.photo_url = person.photo_url;
        if (person.seniority) updates.seniority = person.seniority;
        if (person.departments && person.departments.length > 0) updates.departments = person.departments;

        // Organization Data
        if (person.organization?.name) updates.organization_name = person.organization.name;
        if (person.organization?.primary_domain) updates.organization_domain = person.organization.primary_domain;
        if (person.organization?.industry) updates.organization_industry = person.organization.industry;
        if (person.organization?.estimated_num_employees) updates.organization_size = person.organization.estimated_num_employees;

        // Email Data
        if (resolvedEmail) {
            updates.email = resolvedEmail;
            updates.email_status = person.email_status || 'verified';
        }

        // Phone Data
        if (phoneNumbers.length > 0) {
            updates.phone_numbers = phoneNumbers;
            const primaryPhone = resolvePrimaryPhone(phoneNumbers);
            if (primaryPhone) updates.primary_phone = primaryPhone;
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

        // Retry Logic for Race Condition
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
                console.log(`Webhook: Row found on attempt ${attempts}`);
            } else {
                console.log(`Webhook: Attempt ${attempts}: Row ${record_id} not found yet. Waiting...`);
                if (attempts < maxAttempts) await new Promise(res => setTimeout(res, 2000));
            }
        }

        console.log(`Webhook Debug: Row exists? ${rowExists}`);

        const { error: updateError, data: updatedData } = await supabaseAdmin
            .from(table_name)
            .update(updates)
            .eq('id', record_id)
            .select(); // Return the updated rows to verify

        if (updateError) {
            console.error('Webhook Supabase Error:', updateError);
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
        }

        const updatedCount = Array.isArray(updatedData) ? updatedData.length : 0;
        console.log(`Webhook: Updated ${updatedCount} rows in ${table_name}`);

        // Log success
        const keyPrefix = process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 5) || 'NONE';
        console.log(`Debug: Using Service Key starting with: ${keyPrefix}...`);

        await supabaseAdmin.from('enrichment_logs').insert({
            record_id,
            table_name,
            status: 'webhook_received',
            details: {
                source: 'webhook',
                key_prefix: keyPrefix, // EXPOSE THE KEY PREFIX
                email: resolvedEmail,
                phone_count: phoneNumbers.length || (updates.primary_phone ? 1 : 0),
                db_update_count: updatedCount,
                row_check_found: rowExists,
                check_error: !rowExists ? 'Row not found after retries' : null,
                post_update_db_state: updatedData,
                supabase_data: updates,
                apollo_data: person
            }
        });

        return NextResponse.json({ received: true, processed: true });

    } catch (error: any) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
