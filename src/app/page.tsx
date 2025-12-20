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

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [status, setStatus] = useState<string>('');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [leads, setLeads] = useState<any[]>([]);

  // Form State
  const [userId, setUserId] = useState('test-user-1');
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
    setDebugLogs([]);
    setLeads([]);

    try {
      const payload = {
        user_id: userId,
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
      if (data.debug_logs) {
        setDebugLogs(data.debug_logs);
      }
      if (data.leads) {
        setLeads(data.leads);
      }
      fetchRuns(); // Refresh logs
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      if (error.debug_logs) {
        setDebugLogs(error.debug_logs);
      }
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
                <Label htmlFor="userId">User ID (for pagination testing)</Label>
                <Input
                  id="userId"
                  placeholder="e.g. user-123"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  required
                />
              </div>

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

            {debugLogs.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">Debug Logs</h3>
                <div className="bg-muted p-4 rounded-md overflow-auto max-h-[300px] text-xs font-mono whitespace-pre-wrap">
                  {debugLogs.join('\n')}
                </div>
              </div>
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

      {/* Results Table */}
      {leads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Search Results</CardTitle>
            <CardDescription>Found {leads.length} leads in this session.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>LinkedIn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.first_name} {lead.last_name}</TableCell>
                      <TableCell>{lead.title}</TableCell>
                      <TableCell>{lead.organization?.name || lead.organization_name}</TableCell>
                      <TableCell>{lead.email || 'N/A'}</TableCell>
                      <TableCell>
                        {lead.linkedin_url ? (
                          <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            View Profile
                          </a>
                        ) : (
                          'N/A'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enrichment Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <EnrichmentMonitor />
        <EnrichmentTester />
      </div>
    </div>
  );
}

function EnrichmentTester() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Form State
  const [tableName, setTableName] = useState('enriched_leads');
  const [recordId, setRecordId] = useState('test-id-1');
  const [apolloId, setApolloId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [domain, setDomain] = useState('');
  const [company, setCompany] = useState('');

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const payload = {
        table_name: tableName,
        record_id: recordId,
        lead: {
          apollo_id: apolloId || undefined,
          first_name: firstName,
          last_name: lastName,
          email: '', // Allow manual input if needed later
          organization_name: company,
          organization_domain: domain,
        }
      };

      // We need to bypass the secret key check for this local test or provide it.
      // Since this is a client-side call, we can't easily inject the server-side secret.
      // FOR TESTING ONLY: You might need to temporarily allow requests without the key OR
      // pass a specific header if you know it.
      // HOWEVER, for security, the API requires `x-api-secret-key`. 
      // We will ask the user to input it for the test or hardcode it if they are testing locally.
      // Let's assume for this local tool we might fail auth if we don't send it.
      // Let's adding a "Test Secret" field or similar? 
      // Actually, since we are in the same app, let's just use a hardcoded dev key if env matches, 
      // but the browser doesn't know the server env.

      // IMPORTANT: Real world you wouldn't expose this UI publicly.
      // We will add a prompt for the secret key in the form to be safe.
    } catch (err) {
      // ...
    }
    // Retrying logic above nicely inside the component...
  };

  // Re-writing the component properly:

  const [secretKey, setSecretKey] = useState('');

  const runTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret-key': secretKey
        },
        body: JSON.stringify({
          table_name: tableName,
          record_id: recordId,
          lead: {
            apollo_id: apolloId || undefined,
            first_name: firstName,
            last_name: lastName,
            organization_name: company,
            organization_domain: domain
          }
        })
      });

      const data = await res.json();
      setResult(data);
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-blue-500/20 bg-blue-500/5 h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          Enrichment Tester
        </CardTitle>
        <CardDescription>Manually trigger enrichment to debug missing phones/data.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={runTest} className="space-y-4">
          <div className="space-y-2">
            <Label>API Secret Key (Required)</Label>
            <Input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)} placeholder="Enter valid x-api-secret-key" required />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Table Name</Label>
              <Input value={tableName} onChange={e => setTableName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Record ID</Label>
              <Input value={recordId} onChange={e => setRecordId(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Apollo ID (Optional, overrides others)</Label>
            <Input value={apolloId} onChange={e => setApolloId(e.target.value)} placeholder="Target specific Apollo ID" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input value={firstName} onChange={e => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Company</Label>
              <Input value={company} onChange={e => setCompany(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Domain</Label>
              <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="microsoft.com" />
            </div>
          </div>

          <Button type="submit" className="w-full" variant="secondary" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Test Enrichment'}
          </Button>

          {result && (
            <div className="mt-4 p-2 bg-background rounded border text-xs font-mono overflow-auto max-h-60">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function EnrichmentMonitor() {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from('enrichment_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) setLogs(data);
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Enrichment Live Monitor
        </CardTitle>
        <CardDescription>Real-time feed of worker activity coming from the other app.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Record ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match?</TableHead>
                <TableHead>Found Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No enrichment activity yet... waiting for orders.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.record_id?.slice(0, 8)}...</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${log.status === 'completed' ? 'bg-green-100 text-green-700' :
                        log.status === 'error' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                        {log.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {log.details?.match_found ? '✅' : '❌'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.details?.email_found && <div>📧 {log.details.email_found}</div>}
                      {log.details?.phone_count > 0 && <div>📱 {log.details.phone_count} phones</div>}
                      {log.details?.error && <div className="text-red-500">{log.details.error}</div>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
