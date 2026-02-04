'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Eye, Check, AlertCircle } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";

type Variable = {
    token: string;
    description: string;
    source: string;
    fallback: string;
    example: string;
};


type PreviewResult = {
    resolved_message: string;
    missing_tokens: string[];
    token_debug: Record<string, { value: string; resolved: boolean; usedFallback?: boolean; missingReason?: string } | string>;
    test_user: { id: string; full_name: string; phone: string } | null;
    user_found?: boolean;
    search_input?: string | null;
};

export function MessageSetupManager() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('variables');

    // Variables state
    const [variables, setVariables] = useState<Variable[]>([]);
    const [loadingVariables, setLoadingVariables] = useState(true);


    // Preview state
    const [testMessage, setTestMessage] = useState('');
    const [testUserId, setTestUserId] = useState('');
    const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // User search for preview
    const [userSearch, setUserSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchingUsers, setSearchingUsers] = useState(false);

    const usedTokens = useMemo(() => {
        const tokenPattern = /\{[a-zA-Z0-9_-]+\}/g;
        const matches = testMessage.match(tokenPattern) || [];
        return Array.from(new Set(matches));
    }, [testMessage]);


    const normalizedTokenDebug = useMemo(() => {
        const debug: Record<string, { value: string; resolved: boolean; usedFallback?: boolean; missingReason?: string }> = {};
        if (!previewResult?.token_debug) return debug;

        for (const [token, entry] of Object.entries(previewResult.token_debug)) {
            if (typeof entry === 'string') {
                debug[token] = {
                    value: entry,
                    resolved: entry !== ''
                };
            } else {
                debug[token] = entry;
            }
        }

        return debug;
    }, [previewResult]);

    const tokenDetails = useMemo(() => {
        if (!previewResult) return [] as Array<{ token: string; value: string; status: string; statusTone: 'success' | 'warning' | 'muted' }>;

        return usedTokens.map((token) => {
            const entry = normalizedTokenDebug[token] || {
                value: '',
                resolved: false,
                missingReason: 'Unknown token'
            };

            let status = 'Missing (no data)';
            let statusTone: 'success' | 'warning' | 'muted' = 'warning';

            if (entry.resolved) {
                if (entry.usedFallback) {
                    status = 'Resolved (fallback)';
                    statusTone = 'muted';
                } else {
                    status = 'Resolved';
                    statusTone = 'success';
                }
            } else if (entry.missingReason === 'Unknown token') {
                status = 'Missing (unknown token)';
                statusTone = 'warning';
            } else if (entry.missingReason) {
                status = `Missing (${entry.missingReason.toLowerCase()})`;
                statusTone = 'warning';
            }

            return {
                token,
                value: entry.value || '(empty)',
                status,
                statusTone
            };
        });
    }, [previewResult, usedTokens, normalizedTokenDebug]);

    // Fetch variables
    useEffect(() => {
        fetchVariables();
    }, []);

    const fetchVariables = async () => {
        setLoadingVariables(true);
        try {
            const res = await fetch('/api/message-setup/variables');
            if (res.ok) {
                const data = await res.json();
                setVariables(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingVariables(false);
        }
    };

    const handlePreview = async () => {
        if (!testMessage) {
            toast({ title: 'Error', description: 'Please enter a message to preview', variant: 'destructive' });
            return;
        }


        setLoadingPreview(true);
        try {
            const trimmedSearch = userSearch.trim();
            const testPhone = !testUserId && trimmedSearch ? trimmedSearch : undefined;

            const res = await fetch('/api/message-setup/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message_template: testMessage,
                    test_user_id: testUserId || undefined,
                    test_phone: testPhone,
                    external_url: undefined
                })
            });
            if (res.ok) {
                const data = await res.json();
                setPreviewResult(data);
            } else {
                const error = await res.json();
                toast({ title: 'Error', description: error.error, variant: 'destructive' });
            }
        } catch (err) {
            toast({ title: 'Error', description: 'Failed to preview message', variant: 'destructive' });
        } finally {
            setLoadingPreview(false);
        }
    };

    const searchUsers = async (query: string) => {
        if (!query || query.length < 2) {
            setSearchResults([]);
            return;
        }
        setSearchingUsers(true);
        try {
            const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=5`);
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSearchingUsers(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">Message Setup</h2>
                <p className="text-gray-500">Configure message variables and test your templates.</p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-white border">
                    <TabsTrigger value="variables">Variables</TabsTrigger>
                </TabsList>

                {/* Variables Tab */}
                <TabsContent value="variables" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Supported Message Tokens</CardTitle>
                            <CardDescription>
                                Use these tokens in your campaign messages. They will be automatically replaced with actual values for each recipient.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loadingVariables ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[150px]">Token</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead>Source</TableHead>
                                            <TableHead>Fallback</TableHead>
                                            <TableHead>Example</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {variables.map((v) => (
                                            <TableRow key={v.token}>
                                                <TableCell>
                                                    <Badge variant="secondary" className="font-mono">
                                                        {v.token}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{v.description}</TableCell>
                                                <TableCell className="text-muted-foreground text-sm font-mono">
                                                    {v.source}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {v.fallback || <span className="text-gray-300">—</span>}
                                                </TableCell>
                                                <TableCell className="text-blue-600 font-medium">
                                                    {v.example}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    {/* Test Variables Panel */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Test Variables</CardTitle>
                            <CardDescription>
                                Preview how your message will appear with actual user data.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Select Test User</Label>
                                        <div className="relative">
                                            <Input
                                                placeholder="Search by name, email, or phone..."
                                                value={userSearch}
                                                onChange={(e) => {
                                                    setUserSearch(e.target.value);
                                                    searchUsers(e.target.value);
                                                }}
                                            />
                                            {searchingUsers && (
                                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                                            )}
                                        </div>
                                        {searchResults.length > 0 && (
                                            <div className="border rounded-md max-h-40 overflow-y-auto">
                                                {searchResults.map((user) => (
                                                    <div
                                                        key={user.id}
                                                        className={`p-2 hover:bg-gray-50 cursor-pointer ${testUserId === user.id ? 'bg-blue-50' : ''}`}
                                                        onClick={() => {
                                                            setTestUserId(user.id);
                                                            setUserSearch(user.full_name || user.email);
                                                            setSearchResults([]);
                                                        }}
                                                    >
                                                        <div className="font-medium">{user.full_name || 'No name'}</div>
                                                        <div className="text-xs text-gray-500">{user.email} • {user.phone}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>


                                    <div className="space-y-2">
                                        <Label>Message Template</Label>
                                        <Textarea
                                            placeholder="Hello {name}! You have {points_balance} points. Open the app: {short_link}"
                                            value={testMessage}
                                            onChange={(e) => setTestMessage(e.target.value)}
                                            rows={4}
                                        />
                                        <div className="flex flex-wrap gap-1">
                                            {variables.map(v => (
                                                <Button
                                                    key={v.token}
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-xs"
                                                    onClick={() => setTestMessage(prev => prev + v.token)}
                                                >
                                                    {v.token}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>

                                    <Button onClick={handlePreview} disabled={loadingPreview || !testMessage}>
                                        {loadingPreview ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : (
                                            <Eye className="h-4 w-4 mr-2" />
                                        )}
                                        Preview Resolved Message
                                    </Button>
                                </div>

                                <div className="space-y-4">
                                    {previewResult && (
                                        <>
                                            {/* Show test user info or warning */}
                                            {previewResult.test_user ? (
                                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                                                    <div className="flex items-center gap-2 text-blue-700 font-medium mb-1">
                                                        <Check className="h-4 w-4" />
                                                        Test User Found
                                                    </div>
                                                    <div className="text-blue-600">
                                                        <span className="font-medium">{previewResult.test_user.full_name}</span>
                                                        <span className="mx-2">•</span>
                                                        <span>{previewResult.test_user.phone}</span>
                                                    </div>
                                                </div>
                                            ) : previewResult.search_input ? (
                                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                                                    <div className="flex items-center gap-2 text-amber-700 font-medium mb-1">
                                                        <AlertCircle className="h-4 w-4" />
                                                        No User Found
                                                    </div>
                                                    <div className="text-amber-600">
                                                        No user found for "{previewResult.search_input}". Using fallback values.
                                                    </div>
                                                </div>
                                            ) : null}

                                            <div className="space-y-2">
                                                <Label>Resolved Preview</Label>
                                                <div className="p-4 bg-green-50 border border-green-200 rounded-lg whitespace-pre-wrap text-sm">
                                                    {previewResult.resolved_message}
                                                </div>
                                            </div>

                                            {previewResult.missing_tokens.length > 0 && (
                                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                                    <div className="flex items-center gap-2 text-amber-700 font-medium text-sm mb-1">
                                                        <AlertCircle className="h-4 w-4" />
                                                        Action Required
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {previewResult.missing_tokens.map(t => (
                                                            <Badge key={t} variant="outline" className="text-amber-700 border-amber-300">
                                                                {t}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-2">
                                                <Label className="text-xs text-gray-500">Token Resolution Details</Label>
                                                <div className="border rounded-lg overflow-hidden">
                                                    <div className="grid grid-cols-3 bg-gray-50 text-xs text-gray-500 font-medium px-3 py-2">
                                                        <div>Token</div>
                                                        <div>Value</div>
                                                        <div>Status</div>
                                                    </div>
                                                    <div className="divide-y">
                                                        {tokenDetails.map((detail) => (
                                                            <div key={detail.token} className="grid grid-cols-3 text-xs px-3 py-2">
                                                                <div className="font-mono text-gray-700">{detail.token}</div>
                                                                <div className="text-gray-900 truncate">{detail.value}</div>
                                                                <div
                                                                    className={
                                                                        detail.statusTone === 'success'
                                                                            ? 'text-green-700'
                                                                            : detail.statusTone === 'muted'
                                                                                ? 'text-gray-500'
                                                                                : 'text-amber-700'
                                                                    }
                                                                >
                                                                    {detail.status}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

            </Tabs>
        </div>
    );
}
