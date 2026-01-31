'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Copy, Send, Loader2 } from 'lucide-react';

type Template = {
    id: string;
    name: string;
    category: string;
    body: string;
    is_system?: boolean;
};

export function TemplatesManager({ onUseTemplate }: { onUseTemplate?: (tmpl: Template) => void }) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    // Form state
    const [editData, setEditData] = useState<Partial<Template>>({});

    const fetchTemplates = async () => {
        try {
            const res = await fetch('/api/wa/marketing/templates');
            if (res.ok) {
                const data = await res.json();
                setTemplates(data || []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    const handleEdit = (tmpl: Template) => {
        setSelectedTemplate(tmpl);
        setEditData({ ...tmpl });
        setIsEditing(true);
    };

    const handleCreate = () => {
        setSelectedTemplate(null);
        setEditData({ name: '', category: 'General', body: '' });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!editData.name || !editData.body) return;
        
        try {
            const res = await fetch('/api/wa/marketing/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editData)
            });
            if (res.ok) {
                fetchTemplates();
                setIsEditing(false);
            }
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin inline-block mr-2" /> Loading templates...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Message Templates</h3>
                <Button onClick={handleCreate}><Plus className="w-4 h-4 mr-2" /> New Template</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {templates.map(tmpl => (
                    <Card key={tmpl.id} className="cursor-pointer hover:border-primary transition-colors group" onClick={() => handleEdit(tmpl)}>
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-base">{tmpl.name}</CardTitle>
                                {tmpl.is_system && <Badge variant="secondary">System</Badge>}
                            </div>
                            <Badge variant="outline" className="font-normal text-xs">{tmpl.category || 'General'}</Badge>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-500 line-clamp-3 h-[60px]">{tmpl.body}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Sheet open={isEditing} onOpenChange={setIsEditing}>
                <SheetContent className="w-[100vw] sm:w-[80vw] md:w-[900px] lg:w-[1000px] max-w-[1200px] overflow-y-auto sm:max-w-none">
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-2xl">{selectedTemplate ? 'Edit Template' : 'Create New Template'}</SheetTitle>
                        <SheetDescription>Design your WhatsApp message template with dynamic variables and preview.</SheetDescription>
                    </SheetHeader>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 py-2">
                        {/* Editor */}
                        <div className="space-y-6 lg:border-r lg:pr-8">
                            <div className="space-y-2">
                                <Label className="text-base font-semibold">Template Name</Label>
                                <Input 
                                    className="h-10"
                                    placeholder="e.g. Monthly Promo"
                                    value={editData.name} 
                                    onChange={e => setEditData({...editData, name: e.target.value})} 
                                    disabled={selectedTemplate?.is_system}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-base font-semibold">Category</Label>
                                <Input 
                                    className="h-10"
                                    placeholder="e.g. Marketing"
                                    value={editData.category} 
                                    onChange={e => setEditData({...editData, category: e.target.value})}
                                    disabled={selectedTemplate?.is_system}
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <Label className="text-base font-semibold">Message Body</Label>
                                    <span className="text-xs text-muted-foreground">{editData.body?.length || 0} chars</span>
                                </div>
                                <Textarea 
                                    className="h-[300px] font-mono text-sm resize-none bg-gray-50 focus:bg-white transition-colors"
                                    placeholder="Type your message here... Use {variable} for dynamic content."
                                    value={editData.body}
                                    onChange={e => setEditData({...editData, body: e.target.value})}
                                    disabled={selectedTemplate?.is_system}
                                />
                                <div className="p-3 bg-blue-50 text-blue-800 text-xs rounded-md border border-blue-100 leading-relaxed">
                                    <strong>Supported variables:</strong> {'{name}, {city}, {points_balance}, {short_link}'}
                                </div>
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="flex flex-col items-center justify-center bg-gray-50/50 rounded-xl border-2 border-dashed border-gray-100 p-6">
                            <div className="mb-4 text-sm font-medium text-gray-400 uppercase tracking-widest">Live Preview</div>
                            <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-[360px] h-[640px] overflow-hidden border-[8px] border-gray-900 relative">
                                {/* Notch */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-32 bg-gray-900 rounded-b-xl z-20"></div>
                                
                                {/* Status Bar */}
                                <div className="bg-[#075e54] h-20 pt-8 px-4 flex items-center gap-3 shadow-md z-10 relative">
                                    <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 border border-white/20">S</div>
                                    <div className="text-white">
                                        <div className="font-semibold text-sm">Serapod2u</div>
                                        <div className="text-[10px] opacity-80">Official Business Account</div>
                                    </div>
                                </div>
                                
                                {/* Chat Area */}
                                <div className="bg-[#e5ddd5] h-full p-4 flex flex-col gap-2 overflow-y-auto pb-20 relative">
                                    <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4a4a4a 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                                    <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm text-sm self-start max-w-[90%] whitespace-pre-wrap relative z-10 mx-1 mt-2">
                                        {editData.body || <span className="text-gray-400 italic">Your message will appear here...</span>}
                                        <div className="text-[10px] text-gray-400 text-right mt-1 flex justify-end gap-1 items-center">
                                            12:00 PM <span className="text-blue-500">✓✓</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <SheetFooter className="flex justify-between sm:justify-between">
                         <div className="flex gap-2">
                             {onUseTemplate && (
                                 <Button variant="outline" onClick={() => {
                                     onUseTemplate(editData as Template);
                                     setIsEditing(false);
                                 }}>
                                     Use this Template
                                 </Button>
                             )}
                         </div>
                         <div className="flex gap-2">
                             <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
                             {!selectedTemplate?.is_system && (
                                 <Button onClick={handleSave}>Save Template</Button>
                             )}
                         </div>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    );
}
