'use client';

import { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignsList } from './_components/CampaignsList';
import { CreateCampaignWizard } from './_components/CreateCampaignWizard';
import { TemplatesManager } from './_components/TemplatesManager';
import { SafetyComplianceSettings } from './_components/SafetySettings';

export default function MarketingPage() {
    const [activeTab, setActiveTab] = useState('campaigns');

    return (
        <div className="container mx-auto p-6 max-w-7xl space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">WhatsApp Broadcast</h1>
                <p className="text-gray-500">Send campaigns to opted-in contacts with scheduling, templates, and safety guardrails.</p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="bg-white border w-full justify-start h-auto p-1 overflow-x-auto">
                    <TabsTrigger value="campaigns" className="px-4 py-2">Campaigns</TabsTrigger>
                    <TabsTrigger value="create" className="px-4 py-2">Create Campaign</TabsTrigger>
                    <TabsTrigger value="templates" className="px-4 py-2">Templates</TabsTrigger>
                    <TabsTrigger value="audience" className="px-4 py-2">Audience Segments</TabsTrigger>
                    <TabsTrigger value="logs" className="px-4 py-2">Send Logs</TabsTrigger>
                    <TabsTrigger value="safety" className="px-4 py-2">Safety</TabsTrigger>
                </TabsList>

                <TabsContent value="campaigns" className="min-h-[400px]">
                    <CampaignsList onNew={() => setActiveTab('create')} />
                </TabsContent>

                <TabsContent value="create">
                    <CreateCampaignWizard 
                        onCancel={() => setActiveTab('campaigns')} 
                        onComplete={() => setActiveTab('campaigns')}
                    />
                </TabsContent>

                <TabsContent value="templates">
                    <TemplatesManager />
                </TabsContent>

                <TabsContent value="audience">
                    <Card><CardContent className="p-8 text-center text-gray-500">Audience & Segments Management (Coming Soon)</CardContent></Card>
                </TabsContent>

                <TabsContent value="logs">
                    <Card><CardContent className="p-8 text-center text-gray-500">Logs & Queue (Coming Soon)</CardContent></Card>
                </TabsContent>

                <TabsContent value="safety">
                    <SafetyComplianceSettings />
                </TabsContent>
            </Tabs>
        </div>
    );
}


