// Example of how to call the Lead Search Microservice from another app

async function searchLeads() {
    const response = await fetch('https://your-microservice-url.com/api/lead-search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // If you add authentication later, include headers here
        },
        body: JSON.stringify({
            industry_keywords: ['software', 'saas'],
            company_location: ['United States'],
            titles: ['CEO', 'CTO'],
            max_results: 50
        })
    });

    const data = await response.json();

    if (response.ok) {
        console.log('Batch Run ID:', data.batch_run_id);
        console.log('Leads Found:', data.leads_count);
        console.log('Leads Data:', data.leads); // Array of leads
    } else {
        console.error('Search failed:', data.error);
    }
}

searchLeads();
