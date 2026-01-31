'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignsList } from './_components/CampaignsList';
import { CreateCampaignWizard } from './_components/CreateCampaignWizard';
import { TemplatesManager } from './_components/TemplatesManager';
import { SafetyComplianceSettings } from './_components/SafetySettings';
import { SendLogsView } from './_components/SendLogsView';
import { AudienceSegmentsManager } from './_components/AudienceSegmentsManager';

function MarketingPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    // Default to 'campaigns' tab if not specified
    const initialTab = searchParams.get('tab') || 'campaigns';
    const [activeTab, setActiveTab] = useState(initialTab);

    // Sync state with URL when it changes externally (e.g. back button)
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab && tab !== activeTab) {
            setActiveTab(tab);
        }
    }, [searchParams]); // Remove activeTab from deprecency to avoid circular update loop if not careful, but here it is fine.

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        // Use replace to avoid filling history stack too much, or push to allow back navigation
        router.push(`?tab=${value}`);
    };

    return (
        <div className="container mx-auto p-6 max-w-7xl space-y-6">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">WhatsApp Broadcast</h1>
                    <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-medium">Pro</span>
                </div>
                <p className="text-gray-500">Send campaigns to opted-in contacts with scheduling, templates, and safety guardrails.</p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                <TabsList className="bg-white border w-full justify-start h-auto p-1 overflow-x-auto rounded-md shadow-sm">
                    <TabsTrigger 
                        value="campaigns" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Campaigns
                    </TabsTrigger>
                    <TabsTrigger 
                        value="create" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Create Campaign
                    </TabsTrigger>
                    <TabsTrigger 
                        value="templates" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Templates
                    </TabsTrigger>
                    <TabsTrigger 
                        value="audience" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Audience Segments
                    </TabsTrigger>
                    <TabsTrigger 
                        value="logs" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Send Logs
                    </TabsTrigger>
                    <TabsTrigger 
                        value="safety" 
                        className="px-4 py-2 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none"
                    >
                        Safety
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="campaigns" className="min-h-[400px]">
                    <CampaignsList onNew={() => handleTabChange('create')} />
                </TabsContent>

                <TabsContent value="create">
                    <CreateCampaignWizard
                        onCancel={() => handleTabChange('campaigns')}
                        onComplete={() => handleTabChange('campaigns')}
                    />
                </TabsContent>

                <TabsContent value="templates">
                    <TemplatesManager onUseTemplate={() => handleTabChange('create')} />
                </TabsContent>

                <TabsContent value="audience">
                    <AudienceSegmentsManager />
                </TabsContent>

                <TabsContent value="logs">
                    <SendLogsView />
                </TabsContent>

                <TabsContent value="safety">
                    <SafetyComplianceSettings />
                </TabsContent>
            </Tabs>
        </div>
    );
}

export default function MarketingPage() {
    return (
        <Suspense fallback={<div>Loading Dashboard...</div>}>
            <MarketingPageContent />
        </Suspense>
    );
}
