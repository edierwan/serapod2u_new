'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function TemplatesManager() {
    const templates = [
        { id: 1, name: 'Standard Promo', content: 'Hello {name}, check out our latest offers!' },
        { id: 2, name: 'Birthday Greeting', content: 'Happy Birthday {name}! Here is a gift for you.' },
    ];

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Message Templates</CardTitle>
                    <CardDescription>Manage your reusable message templates here.</CardDescription>
                </div>
                <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" /> New Template
                </Button>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4">
                    {templates.map(t => (
                        <div key={t.id} className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                            <div className="font-medium mb-1">{t.name}</div>
                            <div className="text-sm text-gray-500 font-mono truncate">{t.content}</div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
