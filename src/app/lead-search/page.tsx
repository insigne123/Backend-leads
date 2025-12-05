'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Search, Database, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
        const { data, error } = await supabase
            .from('people_search_leads')
            .select('batch_run_id, created_at')
            .order('created_at', { ascending: false })
            .limit(500);

        if (error) {
            console.error('Error fetching runs:', error);
            return;
        }

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
        <div className="container mx-auto p-8 max-w-6xl space-y-8">
            <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-full">
                    <Search className="w-8 h-8 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Lead Search Microservice</h1>
                    <p className="text-muted-foreground">Automate your B2B prospecting with Apollo.io</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Configuration Panel */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="w-5 h-5" />
                            New Search
                        </CardTitle>
                        <CardDescription>Configure your search parameters below.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSearch} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="industry">Industry Keywords</Label>
                                <Input
                                    id="industry"
                                    placeholder="e.g. software, saas, marketing"
                                    value={industryKeywords}
                                    onChange={(e) => setIndustryKeywords(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">Comma separated values</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="location">Locations</Label>
                                <Input
                                    id="location"
                                    placeholder="e.g. United States, California"
                                    value={locations}
                                    onChange={(e) => setLocations(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="titles">Job Titles</Label>
                                <Input
                                    id="titles"
                                    placeholder="e.g. CEO, Founder, Marketing Director"
                                    value={titles}
                                    onChange={(e) => setTitles(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="maxResults">Max Results</Label>
                                <Input
                                    id="maxResults"
                                    type="number"
                                    value={maxResults}
                                    onChange={(e) => setMaxResults(Number(e.target.value))}
                                    min={1}
                                    max={1000}
                                />
                            </div>

                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Searching...
                                    </>
                                ) : (
                                    'Start Search'
                                )}
                            </Button>
                        </form>

                        {status && (
                            <Alert className={`mt-6 ${status.startsWith('Error') ? 'variant-destructive' : ''}`}>
                                {status.startsWith('Error') ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                <AlertTitle>{status.startsWith('Error') ? 'Error' : 'Success'}</AlertTitle>
                                <AlertDescription>
                                    {status}
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>

                {/* Execution Logs */}
                <Card className="h-fit">
                    <CardHeader>
                        <CardTitle>Recent Batch Runs</CardTitle>
                        <CardDescription>History of your recent search executions.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Batch ID</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead className="text-right">Leads</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {runs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-24 text-center">
                                                No runs found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        runs.map((run) => (
                                            <TableRow key={run.batch_run_id}>
                                                <TableCell className="font-mono text-xs">{run.batch_run_id.slice(0, 8)}...</TableCell>
                                                <TableCell>{new Date(run.created_at).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right font-medium">{run.count}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
