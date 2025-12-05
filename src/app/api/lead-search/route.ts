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
        console.log(`Starting batch run: ${batchRunId}`);

        // Step 1: Search Companies
        const companies = await fetchCompanies(apiKey, {
            industry_keywords,
            company_location,
            employee_ranges,
            max_results,
        });

        console.log(`Found ${companies.length} companies.`);

        // Step 2: Extract Organization IDs
        const orgIds = Array.from(
            new Set(
                companies
                    .map((c) => c.id)
                    .filter((id) => id && id.trim() !== '')
            )
        );
        console.log(`Extracted ${orgIds.length} unique organization IDs.`);

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
            });
            allLeads = [...allLeads, ...leads];
        }

        console.log(`Found ${allLeads.length} leads.`);

        // Step 4: Persist to Supabase
        await saveToSupabase(allLeads, batchRunId);

        return NextResponse.json({
            batch_run_id: batchRunId,
            leads_count: allLeads.length,
            leads: allLeads,
        });
    } catch (error: any) {
        console.error('Error in lead search:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
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
    }
): Promise<ApolloCompany[]> {
    let companies: ApolloCompany[] = [];
    let page = 1;
    const perPage = 100;
    const maxCompanies = filters.max_results || 100;

    while (companies.length < maxCompanies) {
        try {
            const response = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'api-key': apiKey,
                },
                body: JSON.stringify({
                    q_organization_keyword_tags: filters.industry_keywords,
                    page: page,
                    per_page: perPage,
                    organization_locations: filters.company_location,
                    organization_num_employees_ranges: filters.employee_ranges,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Apollo API Error (Companies): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newCompanies = data.organizations || [];

            if (newCompanies.length === 0) break;

            companies = [...companies, ...newCompanies];
            page++;

            if (page > 20) break;

        } catch (error) {
            console.error('Error fetching companies:', error);
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
    }
): Promise<ApolloPerson[]> {
    let people: ApolloPerson[] = [];
    let page = 1;
    const perPage = 100;

    while (people.length < filters.max_results) {
        try {
            const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'api-key': apiKey,
                },
                body: JSON.stringify({
                    organization_ids: organizationIds,
                    page: page,
                    per_page: perPage,
                    person_titles: filters.titles,
                    person_seniorities: filters.seniorities,
                }),
            });

            if (!response.ok) {
                console.error(`Apollo API Error (People): ${response.status}`);
                break;
            }

            const data = await response.json();
            const newPeople = data.people || [];

            if (newPeople.length === 0) break;

            people = [...people, ...newPeople];
            page++;

            if (people.length >= filters.max_results) break;
            if (page > 10) break;

        } catch (error) {
            console.error('Error fetching people:', error);
            break;
        }
    }

    return people.slice(0, filters.max_results);
}

async function saveToSupabase(leads: ApolloPerson[], batchRunId: string) {
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
        console.error('Error saving to Supabase:', error);
        throw new Error(`Supabase Error: ${error.message}`);
    }
}
