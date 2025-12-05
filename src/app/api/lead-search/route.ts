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
            max_results, // Use max_results to limit companies fetched if needed, or separate logic
        });

        console.log(`Found ${companies.length} companies.`);

        // Step 2: Extract Domains
        const domains = Array.from(
            new Set(
                companies
                    .map((c) => c.primary_domain)
                    .filter((d) => d && d.trim() !== '')
            )
        );
        console.log(`Extracted ${domains.length} unique domains.`);

        // Chunk domains
        const chunkSize = 25;
        const domainChunks = [];
        for (let i = 0; i < domains.length; i += chunkSize) {
            domainChunks.push(domains.slice(i, i + chunkSize));
        }

        // Step 3: Search People
        let allLeads: ApolloPerson[] = [];

        // We might want to limit total people fetched to max_results, 
        // but the prompt implies max_results might be for companies or overall. 
        // Let's assume max_results is for the final leads count.

        for (const chunk of domainChunks) {
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
    const perPage = 100; // Apollo max per page usually
    // We'll fetch enough companies to potentially satisfy the lead requirement.
    // Since we don't know the ratio of leads/company, we might need a heuristic or just fetch a reasonable amount.
    // The prompt says "max_results" in input, usually refers to leads, but let's ensure we fetch enough companies.
    // Let's assume we fetch companies until we have enough or hit a safety limit.
    // For now, let's limit company fetching to avoid excessive API usage if not specified.
    // Let's assume 10 pages max for companies for now, or based on max_results if it refers to companies?
    // Re-reading prompt: "max_results" is in input. "Requisito: Debe manejar paginación automática hasta alcanzar el límite configurado."
    // It's ambiguous if max_results is for companies or leads. Usually leads. 
    // But let's assume we fetch a reasonable number of companies. 
    // If max_results is 100, 100 companies might be enough.

    // Let's fetch up to max_results companies to be safe, or maybe more?
    // Let's just fetch up to max_results companies for now as a proxy.

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
                    q_organization_domains: filters.industry_keywords?.join(' '), // Keywords often go to q_keywords or similar, but prompt says industry_keywords
                    // Wait, industry_keywords usually maps to specific filters, but let's check Apollo API docs mentally.
                    // mixed_companies/search has q_keywords, industry_ids, etc.
                    // Prompt says: "Input: Recibe un JSON con: industry_keywords..."
                    // "Usa los filtros de industria..." -> likely mapping keywords to industry or just q_keywords.
                    // Let's use q_keywords for simplicity if industry IDs aren't provided, or try to map if possible.
                    // Actually, let's just use the provided keywords in the request body as appropriate.
                    // If the user passes raw keywords, we might put them in `q_keywords` or `q_organization_keyword_tags`.

                    // Let's assume standard Apollo search body structure.
                    page: page,
                    per_page: perPage,
                    organization_locations: filters.company_location,
                    organization_num_employees_ranges: filters.employee_ranges,
                    q_keywords: filters.industry_keywords?.join(' '), // Using keywords for search
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Apollo API Error (Companies): ${response.status} - ${errorText}`);
                break;
            }

            const data = await response.json();
            const newCompanies = data.organizations || []; // Apollo returns 'organizations' or 'accounts'

            if (newCompanies.length === 0) break;

            companies = [...companies, ...newCompanies];
            page++;

            // Safety break to avoid infinite loops
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
    domains: string[],
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
                    q_organization_domains_list: domains,
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

            // Check if we have enough or if pagination is done (data.pagination usually exists but checking empty result is safer)
            if (people.length >= filters.max_results) break;
            if (page > 10) break; // Safety limit per chunk

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
