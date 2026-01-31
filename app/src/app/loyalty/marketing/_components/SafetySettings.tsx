'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SafetyComplianceSettings() {
     return (
        <Card>
            <CardHeader><CardTitle>Compliance & Safety</CardTitle></CardHeader>
            <CardContent className="space-y-6 max-w-2xl">
                <div className="flex items-center justify-between p-4 border rounded bg-gray-50">
                    <div className="space-y-1">
                        <Label>Quiet Hours</Label>
                        <p className="text-sm text-gray-500">Do not send messages between 10:00 PM and 09:00 AM</p>
                    </div>
                    <Switch checked={true} />
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded bg-gray-50">
                    <div className="space-y-1">
                        <Label>Frequency Cap</Label>
                        <p className="text-sm text-gray-500">Limit to 1 message per 24 hours per user</p>
                    </div>
                     <Select defaultValue="24">
                        <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="24">24h</SelectItem></SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between p-4 border rounded bg-gray-50">
                    <div className="space-y-1">
                        <Label>Opt-out Enforcement</Label>
                        <p className="text-sm text-gray-500">Automatically exclude users who replied STOP</p>
                    </div>
                    <Switch checked={true} disabled />
                </div>
            </CardContent>
        </Card>
    )
}
