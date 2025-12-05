import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Types for the request body
interface LeadSearchRequest {
    user_id: string; // Added user_id
    industry_keywords?: string[];
    company_location?: string[];
    titles?: string[];
    seniorities?: string[];
    employee_ranges?: string[];
    max_results?: number;
}

// Apollo API Types (Simplified)
interface ApolloCompany {
    id: string;
    name: string;
    primary_domain: string;
}

interface ApolloPerson {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    linkedin_url: string;
    organization: {
        name: string;
    };
    title: string;
}

export async function POST(req: Request) {
    const debugLogs: string[] = [];
    const log = (msg: string, data?: any) => {
        const timestamp = new Date().toISOString();
        const message = data ? `${msg} ${JSON.stringify(data, null, 2)}` : msg;
        console.log(`[${timestamp}] ${message}`);
        debugLogs.push(`[${timestamp}] ${message}`);
    };

    try {
        const body: LeadSearchRequest = await req.json();
        const {
            user_id,
            industry_keywords,
            company_location,
            titles,
            seniorities,
            employee_ranges,
            max_results = 100,
        } = body;

        if (!user_id) {
            return NextResponse.json(
                { error: 'Missing user_id' },
                { status: 400 }
            );
        }

        const apiKey = process.env.APOLLO_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing APOLLO_API_KEY' },
                { status: 500 }
            );
        }

        const batchRunId = uuidv4();
        log(`Starting batch run: ${batchRunId} for user: ${user_id}`);
        log('Request Body:', body);

        // --- Pagination Logic Start ---
        // 1. Generate Filter Hash
        const filtersForHash = {
            industry_keywords,
            company_location,
            employee_ranges,
            // We only hash company filters because that's what we paginate
        };
        const filtersHash = crypto
            .createHash('md5')
            .update(JSON.stringify(filtersForHash))
            .digest('hex');

        log(`Filters Hash: ${filtersHash}`);

        // 2. Check Search Progress
        let startPage = 1;
        const { data: progressData, error: progressError } = await supabase
            .from('search_progress')
            .select('last_company_page')
            .eq('user_id', user_id)
            .eq('filters_hash', filtersHash)
            .single();

        if (progressData) {
            startPage = progressData.last_company_page + 1;
            log(`Found previous progress. Resuming from Company Page ${startPage}`);
        } else {
            log('No previous progress found. Starting from Company Page 1');
        }
        // --- Pagination Logic End ---

        // Step 1: Search Companies
        const { companies, lastPageFetched } = await fetchCompanies(apiKey, {
            industry_keywords,
            company_location,
            employee_ranges,
            max_results,
            start_page: startPage
        }, log);

        log(`Found ${companies.length} companies.`);

        // Update Progress if we fetched anything
        if (lastPageFetched >= startPage) {
            const { error: upsertError } = await supabase
                .from('search_progress')
                .upsert({
                    user_id,
                    filters_hash: filtersHash,
                    last_company_page: lastPageFetched,
                    updated_at: new Date().toISOString()
                });

            if (upsertError) {
                log('Warning: Failed to save search progress:', upsertError);
            } else {
                log(`Saved search progress. Last Company Page: ${lastPageFetched}`);
            }
        }

        if (companies.length === 0) {
            return NextResponse.json({
                batch_run_id: batchRunId,
                leads_count: 0,
                leads: [],
                debug_logs: debugLogs,
            });
        }

        // Step 2: Extract Organization IDs
        const orgIds = Array.from(
            new Set(
                companies
                    .map((c) => c.id)
                    .filter((id) => id && id.trim() !== '')
            )
        );
        log(`Extracted ${orgIds.length} unique organization IDs.`);

        // Chunk IDs
        const chunkSize = 25;
        const idChunks = [];
        for (let i = 0; i < orgIds.length; i += chunkSize) {
            idChunks.push(orgIds.slice(i, i + chunkSize));
        }

        // Step 3: Search People
        let allLeads: ApolloPerson[] = [];

        for (const chunk of idChunks) {
            if (allLeads.length >= max_results) break;

            const remaining = max_results - allLeads.length;
            const leads = await fetchPeople(apiKey, chunk, {
                titles,
                seniorities,
                max_results: remaining,
            }, log);
            allLeads = [...allLeads, ...leads];
        }

        log(`Found ${allLeads.length} leads.`);

        // Step 4: Persist to Supabase
        await saveToSupabase(allLeads, batchRunId, log);

        return NextResponse.json({
            batch_run_id: batchRunId,
            leads_count: allLeads.length,
            leads: allLeads,
            debug_logs: debugLogs,
        });
    } catch (error: any) {
        log('Error in lead search:', error.message);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error', debug_logs: debugLogs },
            { status: 500 }
        );
    }
}

async function fetchCompanies(
    apiKey: string,
    filters: {
        industry_keywords?: string[];
        company_location?: string[];
        employee_ranges?: string[];
        max_results: number;
        start_page: number;
    },
    log: (msg: string, data?: any) => void
): Promise<{ companies: ApolloCompany[], lastPageFetched: number }> {
    let companies: ApolloCompany[] = [];
    let page = filters.start_page;
    const perPage = 100;
    const maxCompanies = filters.max_results || 100;
    let lastPageFetched = page - 1;

    while (companies.length < maxCompanies) {
        try {
            const payload = {
                q_keywords: filters.industry_keywords?.join(' '),
                page: page,
                per_page: perPage,
                organization_locations: filters.company_location,
                organization_num_employees_ranges: filters.employee_ranges,
            };

            log(`Fetching Companies (Page ${page}) Payload:`, payload);

            // Use X-Api-Key header
            const response = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`Apollo API Error (Companies): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newCompanies = data.organizations || [];

            if (newCompanies.length === 0) {
                log('No companies found in this page.');
                break;
            }

            companies = [...companies, ...newCompanies];
            lastPageFetched = page;
            page++;

            // Safety break to avoid infinite loops, but allow fetching enough pages
            if (page > filters.start_page + 10) break;

        } catch (error) {
            log('Error fetching companies:', error);
            break;
        }
    }

    return { companies: companies.slice(0, maxCompanies), lastPageFetched };
}

async function fetchPeople(
    apiKey: string,
    organizationIds: string[],
    filters: {
        titles?: string[];
        seniorities?: string[];
        max_results: number;
    },
    log: (msg: string, data?: any) => void
): Promise<ApolloPerson[]> {
    let people: ApolloPerson[] = [];
    let page = 1;
    const perPage = 100;

    while (people.length < filters.max_results) {
        try {
            const payload = {
                organization_ids: organizationIds,
                page: page,
                per_page: perPage,
                person_titles: filters.titles,
                person_seniorities: filters.seniorities,
            };

            log(`Fetching People (Page ${page}) Payload:`, payload);

            // Use X-Api-Key header
            const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`Apollo API Error (People): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newPeople = data.people || [];

            if (newPeople.length === 0) {
                log('No people found in this page.');
                break;
            }

            people = [...people, ...newPeople];
            page++;

            if (people.length >= filters.max_results) break;
            if (page > 10) break;

        } catch (error) {
            log('Error fetching people:', error);
            break;
        }
    }

    return people.slice(0, filters.max_results);
}

async function saveToSupabase(leads: ApolloPerson[], batchRunId: string, log: (msg: string, data?: any) => void) {
    if (leads.length === 0) return;

    const records = leads.map((lead) => ({
        id: lead.id,
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        linkedin_url: lead.linkedin_url,
        organization_name: lead.organization?.name,
        title: lead.title,
        batch_run_id: batchRunId,
        updated_at: new Date().toISOString(),
    }));

    // Perform upsert and select the inserted rows to verify visibility
    const { data, error } = await supabase
        .from('people_search_leads')
        .upsert(records, { onConflict: 'id' })
        .select();

    if (error) {
        log('Error saving to Supabase:', error);
        throw new Error(`Supabase Error: ${error.message}`);
    } else {
        log(`Saved ${leads.length} leads to Supabase.`);

        if (data) {
            log(`Verification: API successfully read back ${data.length} rows.`);
        } else {
            log('Verification: API read back 0 rows (RLS might be blocking SELECT).');
        }

        // Double check count for this batch
        const { count, error: countError } = await supabase
            .from('people_search_leads')
            .select('*', { count: 'exact', head: true })
            .eq('batch_run_id', batchRunId);

        if (countError) {
            log('Verification Error (Count):', countError);
        } else {
            log(`Verification: Total rows in DB for this batch: ${count}`);
        }
    }
}
