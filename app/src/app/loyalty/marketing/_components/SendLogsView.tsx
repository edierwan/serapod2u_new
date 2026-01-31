'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';

export function SendLogsView() {
    const [loading, setLoading] = useState(false); // Mock loading state
    
    // Mock data for MVP display
    const logs = [
        { id: 1, time: new Date().toISOString(), campaign: 'End of Month Promo', recipient: '+60123456789', status: 'delivered', error: null },
        { id: 2, time: new Date(Date.now() - 3600000).toISOString(), campaign: 'End of Month Promo', recipient: '+60198765432', status: 'read', error: null },
        { id: 3, time: new Date(Date.now() - 7200000).toISOString(), campaign: 'Test Send', recipient: '+601122334455', status: 'failed', error: 'Invalid number' },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Sent Today</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1,234</div>
                        <p className="text-xs text-muted-foreground">+12% from yesterday</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Failed Today</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">23</div>
                        <p className="text-xs text-muted-foreground">1.8% failure rate</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Avg Delivery Time</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1.2s</div>
                        <p className="text-xs text-muted-foreground">Within acceptable range</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">2</div>
                        <p className="text-xs text-muted-foreground">Sending now</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Delivery Logs</CardTitle>
                    <CardDescription>Real-time status of message delivery.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                       <div className="relative flex-1">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search recipient or campaign..." className="pl-8" />
                        </div>
                         <Button variant="outline" size="icon" onClick={() => {}}><RotateCcw className="h-4 w-4" /></Button>
                    </div>

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Time</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Recipient</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Error Info</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell>{format(new Date(log.time), 'HH:mm:ss')}</TableCell>
                                    <TableCell>{log.campaign}</TableCell>
                                    <TableCell className="font-mono text-xs">{log.recipient}</TableCell>
                                    <TableCell>
                                        <Badge variant={log.status === 'failed' ? 'destructive' : log.status === 'read' ? 'default' : 'secondary'}>
                                            {log.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-red-500">{log.error}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
