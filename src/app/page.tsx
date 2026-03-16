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

type SearchMode = 'batch' | 'linkedin_profile' | 'company_name';

interface OrganizationCandidate {
  id: string;
  name: string;
  primary_domain?: string | null;
  website_url?: string | null;
  match_score?: number;
}

function parseCommaList(value: string): string[] | undefined {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function resolvePrimaryPhone(lead: any): string {
  if (typeof lead?.primary_phone === 'string' && lead.primary_phone.trim()) {
    return lead.primary_phone.trim();
  }

  if (!Array.isArray(lead?.phone_numbers) || lead.phone_numbers.length === 0) {
    return 'N/A';
  }

  const mobile = lead.phone_numbers.find((phone: any) => {
    const type = (phone?.type || phone?.type_cd || '').toString().toLowerCase();
    return type.includes('mobile');
  });

  const selected = mobile || lead.phone_numbers[0];
  const phone = selected?.sanitized_number || selected?.number || selected?.raw_number || null;

  if (typeof phone !== 'string') return 'N/A';
  const trimmed = phone.trim();
  return trimmed || 'N/A';
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [status, setStatus] = useState<string>('');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [organizationCandidates, setOrganizationCandidates] = useState<OrganizationCandidate[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');

  // Form State
  const [userId, setUserId] = useState('test-user-1');
  const [searchMode, setSearchMode] = useState<SearchMode>('batch');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [organizationDomains, setOrganizationDomains] = useState('');
  const [industryKeywords, setIndustryKeywords] = useState('');
  const [locations, setLocations] = useState('');
  const [titles, setTitles] = useState('');
  const [seniorities, setSeniorities] = useState('');
  const [maxResults, setMaxResults] = useState(100);

  useEffect(() => {
    fetchRuns();
  }, []);

  useEffect(() => {
    if (searchMode !== 'company_name') {
      setOrganizationCandidates([]);
      setSelectedOrganizationId('');
    }
  }, [searchMode]);

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
    setStatus(
      searchMode === 'linkedin_profile'
        ? 'Searching profile...'
        : searchMode === 'company_name'
          ? (selectedOrganizationId ? 'Searching employees...' : 'Searching company...')
          : 'Starting search...'
    );
    setDebugLogs([]);
    setLeads([]);

    try {
      const payload: Record<string, any> = {
        user_id: userId,
        search_mode: searchMode,
      };

      if (searchMode === 'linkedin_profile') {
        payload.linkedin_url = linkedinUrl.trim();
        payload.reveal_email = true;
        payload.reveal_phone = true;
        payload.max_results = 1;
      } else if (searchMode === 'company_name') {
        payload.company_name = companyName.trim();
        payload.organization_domains = parseCommaList(organizationDomains);
        payload.titles = parseCommaList(titles);
        payload.seniorities = parseCommaList(seniorities);
        payload.include_similar_titles = false;
        payload.max_results = Number(maxResults);

        if (selectedOrganizationId) {
          payload.selected_organization_id = selectedOrganizationId;
          const selectedOrg = organizationCandidates.find((candidate) => candidate.id === selectedOrganizationId);
          if (selectedOrg?.name) payload.selected_organization_name = selectedOrg.name;
          if (selectedOrg?.primary_domain) payload.selected_organization_domain = selectedOrg.primary_domain;
        }
      } else {
        payload.industry_keywords = parseCommaList(industryKeywords);
        payload.company_location = parseCommaList(locations);
        payload.titles = parseCommaList(titles);
        payload.max_results = Number(maxResults);
      }

      const res = await fetch('/api/lead-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.debug_logs) {
          setDebugLogs(data.debug_logs);
        }
        throw new Error(data.error || 'Search failed');
      }

      if (searchMode === 'company_name' && data.requires_organization_selection) {
        const candidates = Array.isArray(data.organization_candidates)
          ? data.organization_candidates
          : [];

        setOrganizationCandidates(candidates);
        setSelectedOrganizationId('');
        setStatus(
          `Found ${candidates.length} organizations for "${data.company_name || companyName.trim()}". Select one and search again.`
        );

        if (data.debug_logs) {
          setDebugLogs(data.debug_logs);
        }

        return;
      }

      const isLinkedInProfileSearch = data.search_mode === 'linkedin_profile' || searchMode === 'linkedin_profile';
      const isCompanySearch = data.search_mode === 'company_name' || searchMode === 'company_name';

      if (isCompanySearch) {
        const selectedOrgName = data.selected_organization?.name || companyName.trim();
        setStatus(`Success! Found ${data.leads_count} leads in ${selectedOrgName}. Batch ID: ${data.batch_run_id}`);
        setOrganizationCandidates([]);
        setSelectedOrganizationId('');
      } else if (isLinkedInProfileSearch) {
        setStatus(
          data.leads_count > 0
            ? `Success! Profile found. Batch ID: ${data.batch_run_id}`
            : `No profile match found for that LinkedIn URL. Batch ID: ${data.batch_run_id}`
        );
      } else {
        setStatus(`Success! Found ${data.leads_count} leads. Batch ID: ${data.batch_run_id}`);
      }

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
                <Label htmlFor="searchMode">Search Mode</Label>
                <select
                  id="searchMode"
                  value={searchMode}
                  onChange={(e) => setSearchMode(e.target.value as SearchMode)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="batch">Batch lead search</option>
                  <option value="linkedin_profile">Single profile by LinkedIn URL</option>
                  <option value="company_name">Employees by company name</option>
                </select>
              </div>

              {searchMode === 'linkedin_profile' ? (
                <div className="space-y-2">
                  <Label htmlFor="linkedinUrl">LinkedIn Profile URL</Label>
                  <Input
                    id="linkedinUrl"
                    placeholder="https://www.linkedin.com/in/username"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Finds a single person via Apollo People Enrichment.
                  </p>
                </div>
              ) : searchMode === 'company_name' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      placeholder="e.g. Microsoft"
                      value={companyName}
                      onChange={(e) => {
                        setCompanyName(e.target.value);
                        if (organizationCandidates.length > 0) {
                          setOrganizationCandidates([]);
                          setSelectedOrganizationId('');
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Search by company name and optionally narrow the match with one or more domains.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="organizationDomains">Organization Domains (Optional)</Label>
                    <Input
                      id="organizationDomains"
                      placeholder="e.g. grupoexpro.com"
                      value={organizationDomains}
                      onChange={(e) => {
                        setOrganizationDomains(e.target.value);
                        if (organizationCandidates.length > 0) {
                          setOrganizationCandidates([]);
                          setSelectedOrganizationId('');
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Add one or more domains separated by commas to target an exact company.
                    </p>
                  </div>

                  {organizationCandidates.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="organizationCandidate">Select Organization</Label>
                      <select
                        id="organizationCandidate"
                        value={selectedOrganizationId}
                        onChange={(e) => setSelectedOrganizationId(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                        required
                      >
                        <option value="">Choose organization</option>
                        {organizationCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                            {candidate.primary_domain ? ` (${candidate.primary_domain})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="seniorities">Management Levels</Label>
                    <Input
                      id="seniorities"
                      placeholder="e.g. c_suite, vp, director"
                      value={seniorities}
                      onChange={(e) => setSeniorities(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Comma separated Apollo seniorities</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="titles">Job Titles (Optional)</Label>
                    <Input
                      id="titles"
                      placeholder="e.g. VP Marketing, Director of Sales"
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
                </>
              ) : (
                <>
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
                </>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  searchMode === 'linkedin_profile'
                    ? 'Find Profile'
                    : searchMode === 'company_name'
                      ? (organizationCandidates.length > 0 ? 'Search Selected Company' : 'Find Company')
                      : 'Start Search'
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
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>LinkedIn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell
                        className="font-mono text-xs text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors"
                        title="Click to copy full ID"
                        onClick={(e) => {
                          const target = e.currentTarget;
                          navigator.clipboard.writeText(lead.id);
                          const originalText = target.innerText;
                          target.innerText = "Copied!";
                          setTimeout(() => { target.innerText = lead.id.substring(0, 8) + "..."; }, 1000);
                        }}
                      >
                        {lead.id.substring(0, 8)}...
                      </TableCell>
                      <TableCell className="font-medium">{lead.first_name} {lead.last_name}</TableCell>
                      <TableCell>{lead.title}</TableCell>
                      <TableCell>{lead.organization?.name || lead.organization_name}</TableCell>
                      <TableCell>{lead.email || 'N/A'}</TableCell>
                      <TableCell>{resolvePrimaryPhone(lead)}</TableCell>
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
      const res = await fetch(`/api/enrich?secret_key=${encodeURIComponent(secretKey)}`, {
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
  const [selectedLog, setSelectedLog] = useState<any>(null);

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
    <>
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
                  <TableHead>Table</TableHead>
                  <TableHead>Record ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Match?</TableHead>
                  <TableHead>Found Data</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No enrichment activity yet... waiting for orders.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.table_name}</TableCell>
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
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal Overlay */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold">Enrichment Details</h3>
                {selectedLog.details?.db_update_count !== undefined && (
                  <span className={`px-2 py-1 rounded text-xs font-bold ${selectedLog.details.db_update_count > 0
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                    }`}>
                    Rows Updated: {selectedLog.details.db_update_count}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedLog(null)}>Close</Button>
            </div>
            <div className="p-4 overflow-auto flex-1 grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-muted-foreground">Apollo Response (Source)</h4>
                <div className="bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap h-full overflow-auto max-h-[60vh]">
                  {selectedLog.details?.apollo_data
                    ? JSON.stringify(selectedLog.details.apollo_data, null, 2)
                    : 'No Apollo data logged.'}
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-muted-foreground">Supabase Updates (Target)</h4>
                <div className="bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap h-full overflow-auto max-h-[60vh]">
                  {selectedLog.details?.supabase_data
                    ? JSON.stringify(selectedLog.details.supabase_data, null, 2)
                    : 'No Update data logged.'}
                </div>
                {selectedLog.details?.post_update_db_state && (
                  <div className="mt-4 border-t pt-2">
                    <h4 className="font-medium text-sm text-green-600 mb-1">✅ Actual DB Result (Post-Update):</h4>
                    <div className="bg-green-50 p-2 rounded text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(selectedLog.details.post_update_db_state, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
