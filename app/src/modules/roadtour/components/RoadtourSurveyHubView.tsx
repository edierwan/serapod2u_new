'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ClipboardList, BarChart3, Inbox } from 'lucide-react'
import { RoadtourSurveyBuilderView } from './RoadtourSurveyBuilderView'
import { RoadtourSurveyResponsesView } from './RoadtourSurveyResponsesView'
import { RoadtourSurveyReportingView } from './RoadtourSurveyReportingView'

interface Props {
    userProfile: any
    onViewChange: (viewId: string) => void
}

type TabKey = 'templates' | 'responses' | 'reporting'

export function RoadtourSurveyHubView({ userProfile, onViewChange }: Props) {
    const [tab, setTab] = useState<TabKey>('templates')

    return (
        <div className="sera-sc-page space-y-5">
            <div className="flex flex-col gap-1">
                <div className="sera-sc-header__bar mb-3 h-1 w-12 rounded-sm bg-[var(--sera-orange)]" />
                    <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--sera-ink)] sm:text-2xl">Survey Templates &amp; Reporting</h2>
                <p className="text-sm text-muted-foreground">
                    Manage RoadTour survey templates, browse submitted responses, and explore dynamic reporting.
                </p>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-5">
                <TabsList className="bg-muted/40">
                    <TabsTrigger value="templates" className="gap-2"><ClipboardList className="h-4 w-4" />Templates</TabsTrigger>
                    <TabsTrigger value="responses" className="gap-2"><Inbox className="h-4 w-4" />Responses</TabsTrigger>
                    <TabsTrigger value="reporting" className="gap-2"><BarChart3 className="h-4 w-4" />Reporting</TabsTrigger>
                </TabsList>

                <TabsContent value="templates" className="mt-0">
                    <RoadtourSurveyBuilderView userProfile={userProfile} onViewChange={onViewChange} />
                </TabsContent>

                <TabsContent value="responses" className="mt-0">
                    <RoadtourSurveyResponsesView userProfile={userProfile} />
                </TabsContent>

                <TabsContent value="reporting" className="mt-0">
                    <RoadtourSurveyReportingView userProfile={userProfile} onNavigateTemplates={() => setTab('templates')} />
                </TabsContent>
            </Tabs>
        </div>
    )
}
