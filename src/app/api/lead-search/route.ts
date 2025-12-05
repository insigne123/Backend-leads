import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// Types for the request body
interface LeadSearchRequest {
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
            industry_keywords,
            company_location,
            titles,
            seniorities,
            employee_ranges,
            max_results = 100,
        } = body;

        const apiKey = process.env.APOLLO_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing APOLLO_API_KEY' },
                { status: 500 }
            );
        }

        const batchRunId = uuidv4();
        log(`Starting batch run: ${batchRunId}`);
        log('Request Body:', body);

        // Step 1: Search Companies
        const companies = await fetchCompanies(apiKey, {
            industry_keywords,
            company_location,
            employee_ranges,
            max_results,
        }, log);

        log(`Found ${companies.length} companies.`);

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
    },
    log: (msg: string, data?: any) => void
): Promise<ApolloCompany[]> {
    let companies: ApolloCompany[] = [];
    let page = 1;
    const perPage = 100;
    const maxCompanies = filters.max_results || 100;

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

            // Pass API key as query parameter
            const response = await fetch(`https://api.apollo.io/v1/mixed_companies/search?api_key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
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
            page++;

            if (page > 10) break;

        } catch (error) {
            log('Error fetching companies:', error);
            break;
        }
    }

    return companies.slice(0, maxCompanies);
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

            // Pass API key as query parameter
            const response = await fetch(`https://api.apollo.io/v1/mixed_people/search?api_key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
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

    const { error } = await supabase
        .from('people_search_leads')
        .upsert(records, { onConflict: 'id' });

    if (error) {
        log('Error saving to Supabase:', error);
        throw new Error(`Supabase Error: ${error.message}`);
    } else {
        log(`Saved ${leads.length} leads to Supabase.`);
    }
}
