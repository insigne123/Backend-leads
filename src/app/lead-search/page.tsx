'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Search, Database, AlertCircle, CheckCircle2 } from 'lucide-react';

interface BatchRun {
    batch_run_id: string;
    created_at: string;
    count: number;
}

export default function LeadSearchPage() {
    const [loading, setLoading] = useState(false);
    const [runs, setRuns] = useState<BatchRun[]>([]);
    const [status, setStatus] = useState<string>('');

    // Form State
    const [industryKeywords, setIndustryKeywords] = useState('');
    const [locations, setLocations] = useState('');
    const [titles, setTitles] = useState('');
    const [maxResults, setMaxResults] = useState(100);

    useEffect(() => {
        fetchRuns();
    }, []);

    const fetchRuns = async () => {
        // Fetch distinct batch_run_ids and their counts
        // Note: Supabase doesn't support "GROUP BY" easily in the JS client without RPC or raw SQL usually.
        // For simplicity, we'll fetch the latest 100 leads and group them client-side or just show a list of leads.
        // Better approach for "Logs": Create a separate 'logs' table? 
        // Or just fetch all unique batch_run_ids from the leads table?
        // Let's try to fetch unique batch_run_ids.

        const { data, error } = await supabase
            .from('people_search_leads')
            .select('batch_run_id, created_at')
            .order('created_at', { ascending: false })
            .limit(500);

        if (error) {
            console.error('Error fetching runs:', error);
            return;
        }

        // Group by batch_run_id
        const grouped = data.reduce((acc: any, curr: any) => {
            if (!acc[curr.batch_run_id]) {
                acc[curr.batch_run_id] = {
                    batch_run_id: curr.batch_run_id,
                    created_at: curr.created_at,
                    count: 0,
                };
            }
            acc[curr.batch_run_id].count++;
            return acc;
        }, {});

        setRuns(Object.values(grouped));
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatus('Starting search...');

        try {
            const payload = {
                industry_keywords: industryKeywords ? industryKeywords.split(',').map(s => s.trim()) : undefined,
                company_location: locations ? locations.split(',').map(s => s.trim()) : undefined,
                titles: titles ? titles.split(',').map(s => s.trim()) : undefined,
                max_results: Number(maxResults),
            };

            const res = await fetch('/api/lead-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Search failed');
            }

            setStatus(`Success! Found ${data.leads_count} leads. Batch ID: ${data.batch_run_id}`);
            fetchRuns(); // Refresh logs
        } catch (error: any) {
            setStatus(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-8 max-w-6xl">
            <h1 className="text-3xl font-bold mb-8 flex items-center gap-2">
                <Search className="w-8 h-8" />
                Lead Search Microservice
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Configuration Panel */}
                <div className="bg-card border rounded-lg p-6 shadow-sm">
                    <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                        <Database className="w-5 h-5" />
                        New Search
                    </h2>

                    <form onSubmit={handleSearch} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Industry Keywords (comma separated)</label>
                            <input
                                type="text"
                                className="w-full p-2 border rounded-md bg-background"
                                placeholder="e.g. software, saas, marketing"
                                value={industryKeywords}
                                onChange={(e) => setIndustryKeywords(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Locations (comma separated)</label>
                            <input
                                type="text"
                                className="w-full p-2 border rounded-md bg-background"
                                placeholder="e.g. United States, California"
                                value={locations}
                                onChange={(e) => setLocations(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Job Titles (comma separated)</label>
                            <input
                                type="text"
                                className="w-full p-2 border rounded-md bg-background"
                                placeholder="e.g. CEO, Founder, Marketing Director"
                                value={titles}
                                onChange={(e) => setTitles(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Max Results</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded-md bg-background"
                                value={maxResults}
                                onChange={(e) => setMaxResults(Number(e.target.value))}
                                min={1}
                                max={1000}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-2 px-4 rounded-md font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Search'}
                        </button>
                    </form>

                    {status && (
                        <div className={`mt-4 p-3 rounded-md text-sm flex items-start gap-2 ${status.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
                            {status.startsWith('Error') ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 mt-0.5" />}
                            <p>{status}</p>
                        </div>
                    )}
                </div>

                {/* Execution Logs */}
                <div className="bg-card border rounded-lg p-6 shadow-sm">
                    <h2 className="text-xl font-semibold mb-4">Recent Batch Runs</h2>
                    <div className="overflow-auto max-h-[500px]">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted text-muted-foreground sticky top-0">
                                <tr>
                                    <th className="p-3">Batch ID</th>
                                    <th className="p-3">Date</th>
                                    <th className="p-3 text-right">Leads Found</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {runs.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="p-4 text-center text-muted-foreground">No runs found yet.</td>
                                    </tr>
                                ) : (
                                    runs.map((run) => (
                                        <tr key={run.batch_run_id} className="hover:bg-muted/50">
                                            <td className="p-3 font-mono text-xs">{run.batch_run_id.slice(0, 8)}...</td>
                                            <td className="p-3">{new Date(run.created_at).toLocaleString()}</td>
                                            <td className="p-3 text-right font-medium">{run.count}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
