'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Copy, Send, Loader2, Search, Filter, Sparkles, ShieldCheck, ShieldAlert, ShieldX, Link, User, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import {
    validateTemplate,
    getRiskLevel,
    getRiskBadgeColor,
    getRiskBadgeLabel,
    renderPreview,
    SUPPORTED_VARIABLES,
    type TemplateSafetyResult,
    type RiskLevel
} from '@/lib/template-safety.client';
import { useDebounce } from '@/hooks/use-debounce';

type Template = {
    id: string;
    name: string;
    category: string;
    body: string;
    is_system?: boolean;
    risk_score?: number;
    risk_flags?: string[];
    language?: string;
};

type TemplatesManagerProps = {
    onUseTemplate?: (tmpl: Template) => void;
    selectedLanguage?: 'EN' | 'BM';
    onLanguageChange?: (lang: 'EN' | 'BM') => void;
};

export function TemplatesManager({ onUseTemplate, selectedLanguage: propLanguage, onLanguageChange }: TemplatesManagerProps) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    // Use prop language if provided, otherwise local state
    const [localLanguage, setLocalLanguage] = useState<'EN' | 'BM'>('EN');
    const selectedLanguage = propLanguage ?? localLanguage;
    const setSelectedLanguage = onLanguageChange ?? setLocalLanguage;
    const [saving, setSaving] = useState(false);

    // Form state
    const [editData, setEditData] = useState<Partial<Template>>({});

    // Safety validation state
    const [safetyResult, setSafetyResult] = useState<TemplateSafetyResult | null>(null);
    const debouncedBody = useDebounce(editData.body || '', 400);

    // Run validation when body changes
    useEffect(() => {
        if (debouncedBody) {
            const result = validateTemplate(debouncedBody);
            setSafetyResult(result);
        } else {
            setSafetyResult(null);
        }
    }, [debouncedBody]);

    const fetchTemplates = async () => {
        try {
            const res = await fetch('/api/wa/marketing/templates');
            if (res.ok) {
                const data = await res.json();
                // Compute risk scores for templates
                const templatesWithRisk = (data || []).map((t: Template) => {
                    const validation = validateTemplate(t.body || '');
                    return {
                        ...t,
                        language: (t.language || 'EN').toUpperCase(),
                        risk_score: validation.riskScore,
                        risk_flags: validation.riskFlags.map(f => f.code)
                    };
                });
                setTemplates(templatesWithRisk);
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

    // Get unique categories from templates
    const categories = useMemo(() => {
        const cats = new Set(templates.map(t => t.category || 'General'));
        return ['all', ...Array.from(cats).sort()];
    }, [templates]);

    // Filter templates based on search and category
    const filteredTemplates = useMemo(() => {
        return templates.filter(t => {
            const templateLanguage = (t.language || 'EN').toUpperCase();
            const matchesSearch = searchQuery === '' ||
                t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t.body.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
            const matchesLanguage = templateLanguage === selectedLanguage;
            return matchesSearch && matchesCategory && matchesLanguage;
        });
    }, [templates, searchQuery, selectedCategory, selectedLanguage]);

    // Group templates by category for display
    const groupedTemplates = useMemo(() => {
        const groups: Record<string, Template[]> = {};
        filteredTemplates.forEach(t => {
            const cat = t.category || 'General';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(t);
        });
        return groups;
    }, [filteredTemplates]);

    const handleEdit = (tmpl: Template) => {
        setSelectedTemplate(tmpl);
        setEditData({ ...tmpl, language: (tmpl.language || 'EN').toUpperCase() });
        setSafetyResult(null);  // Reset safety result
        setIsEditing(true);
    };

    const handleCreate = () => {
        setSelectedTemplate(null);
        setEditData({ name: '', category: 'General', body: '', language: selectedLanguage });
        setSafetyResult(null);  // Reset safety result
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!editData.name || !editData.body) return;

        // Validate template before saving
        const validation = validateTemplate(editData.body);
        if (!validation.isValid) {
            alert(`Cannot save template:\n${validation.errors.map(e => e.message).join('\n')}`);
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/wa/marketing/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...editData,
                    risk_score: validation.riskScore,
                    risk_flags: validation.riskFlags.map(f => f.code)
                })
            });
            if (res.ok) {
                fetchTemplates();
                setIsEditing(false);
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to save template');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin inline-block mr-2" /> Loading templates...</div>;

    // Risk badge icon helper
    const getRiskIcon = (score: number) => {
        const level = getRiskLevel(score);
        switch (level) {
            case 'safe': return <ShieldCheck className="h-3 w-3" />;
            case 'warning': return <ShieldAlert className="h-3 w-3" />;
            case 'blocked': return <ShieldX className="h-3 w-3" />;
        }
    };

    // Category badge colors
    const getCategoryColor = (category: string) => {
        const colors: Record<string, string> = {
            'Promotional': 'bg-orange-100 text-orange-700 border-orange-200',
            'Loyalty': 'bg-purple-100 text-purple-700 border-purple-200',
            'Engagement': 'bg-blue-100 text-blue-700 border-blue-200',
            'Seasonal': 'bg-green-100 text-green-700 border-green-200',
            'Informational': 'bg-gray-100 text-gray-700 border-gray-200',
            'Reactivation': 'bg-red-100 text-red-700 border-red-200',
            'VIP': 'bg-yellow-100 text-yellow-700 border-yellow-200',
        };
        return colors[category] || 'bg-gray-100 text-gray-600 border-gray-200';
    };

    return (
        <div className="space-y-6">
            {/* Header with filters */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h3 className="text-lg font-medium">Message Templates</h3>
                    <p className="text-sm text-muted-foreground">
                        {filteredTemplates.length} templates available
                    </p>
                </div>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search templates..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                        <Select value={selectedLanguage} onValueChange={(value: 'EN' | 'BM') => setSelectedLanguage(value)}>
                            <SelectTrigger className="w-[110px]">
                                <SelectValue placeholder="Language" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="EN">EN</SelectItem>
                                <SelectItem value="BM">BM</SelectItem>
                            </SelectContent>
                        </Select>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="w-[150px]">
                            <Filter className="h-4 w-4 mr-2" />
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map(cat => (
                                <SelectItem key={cat} value={cat}>
                                    {cat === 'all' ? 'All Categories' : cat}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleCreate}><Plus className="w-4 h-4 mr-2" /> New</Button>
                </div>
            </div>

            {/* System templates notice */}
            {templates.some(t => t.is_system) && (
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-100">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-600" />
                        <span className="font-medium text-purple-800">Ready-Made Templates</span>
                    </div>
                    <p className="text-sm text-purple-700 mt-1">
                        We've prepared professional templates for common marketing scenarios.
                        System templates cannot be edited but you can duplicate and customize them.
                    </p>
                </div>
            )}

            {/* Grouped templates */}
            {Object.keys(groupedTemplates).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    No templates found matching your criteria.
                </div>
            ) : (
                <div className="space-y-8">
                    {Object.entries(groupedTemplates).sort().map(([category, categoryTemplates]) => (
                        <div key={category}>
                            <div className="flex items-center gap-2 mb-4">
                                <Badge className={`${getCategoryColor(category)} border`}>
                                    {category}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    {categoryTemplates.length} template{categoryTemplates.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {categoryTemplates.map(tmpl => (
                                    <Card
                                        key={tmpl.id}
                                        className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
                                        onClick={() => handleEdit(tmpl)}
                                    >
                                        <CardHeader className="pb-2">
                                            <div className="flex justify-between items-start">
                                                <CardTitle className="text-sm font-medium group-hover:text-primary transition-colors">
                                                    {tmpl.name}
                                                </CardTitle>
                                                <div className="flex items-center gap-1">
                                                    {/* Risk Badge */}
                                                    {tmpl.risk_score !== undefined && (
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-[10px] px-1.5 py-0 flex items-center gap-1 ${getRiskBadgeColor(getRiskLevel(tmpl.risk_score))}`}
                                                        >
                                                            {getRiskIcon(tmpl.risk_score)}
                                                            {getRiskBadgeLabel(getRiskLevel(tmpl.risk_score))}
                                                        </Badge>
                                                    )}
                                                    {tmpl.is_system && (
                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                            System
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-xs text-gray-500 line-clamp-3">{tmpl.body}</p>
                                            {/* Quick stats */}
                                            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Link className="h-3 w-3" />
                                                    {(tmpl.body?.match(/https?:\/\/[^\s]+/gi) || []).length + (tmpl.body?.includes('{short_link}') ? 1 : 0)} links
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <User className="h-3 w-3" />
                                                    {tmpl.body?.includes('{name}') || tmpl.body?.includes('{city}') ? 'Yes' : 'No'}
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

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
                                    onChange={e => setEditData({ ...editData, name: e.target.value })}
                                    disabled={selectedTemplate?.is_system}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-base font-semibold">Category</Label>
                                <Select
                                    value={editData.category || 'General'}
                                    onValueChange={(v) => setEditData({ ...editData, category: v })}
                                    disabled={selectedTemplate?.is_system}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select a category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Promotional">Promotional</SelectItem>
                                        <SelectItem value="Loyalty">Loyalty</SelectItem>
                                        <SelectItem value="Engagement">Engagement</SelectItem>
                                        <SelectItem value="Seasonal">Seasonal</SelectItem>
                                        <SelectItem value="Informational">Informational</SelectItem>
                                        <SelectItem value="Reactivation">Reactivation</SelectItem>
                                        <SelectItem value="VIP">VIP</SelectItem>
                                        <SelectItem value="General">General</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-base font-semibold">Language</Label>
                                <Select
                                    value={(editData.language || 'EN').toString().toUpperCase()}
                                    onValueChange={(v) => setEditData({ ...editData, language: v })}
                                    disabled={selectedTemplate?.is_system}
                                >
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select language" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="EN">EN</SelectItem>
                                        <SelectItem value="BM">BM</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <Label className="text-base font-semibold">Message Body</Label>
                                    <span className="text-xs text-muted-foreground">{editData.body?.length || 0} chars</span>
                                </div>
                                <Textarea
                                    className="h-[200px] font-mono text-sm resize-none bg-gray-50 focus:bg-white transition-colors"
                                    placeholder="Type your message here... Use {variable} for dynamic content."
                                    value={editData.body}
                                    onChange={e => setEditData({ ...editData, body: e.target.value })}
                                    disabled={selectedTemplate?.is_system}
                                />
                                <div className="p-3 bg-blue-50 text-blue-800 text-xs rounded-md border border-blue-100 leading-relaxed">
                                    <strong>Supported variables:</strong> {'{name}, {city}, {points_balance}, {short_link}'}
                                </div>
                            </div>

                            {/* Safety Checks Panel */}
                            {safetyResult && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-base font-semibold flex items-center gap-2">
                                            <ShieldCheck className="h-4 w-4" />
                                            Safety Checks
                                        </Label>
                                        <Badge
                                            variant="outline"
                                            className={`flex items-center gap-1 ${getRiskBadgeColor(getRiskLevel(safetyResult.riskScore))}`}
                                        >
                                            {getRiskIcon(safetyResult.riskScore)}
                                            Risk Score: {safetyResult.riskScore}
                                        </Badge>
                                    </div>

                                    {/* Quick Stats */}
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div className="bg-gray-50 rounded p-2 text-center">
                                            <div className="font-semibold">{safetyResult.metadata.linkCount}</div>
                                            <div className="text-muted-foreground">Links</div>
                                        </div>
                                        <div className="bg-gray-50 rounded p-2 text-center">
                                            <div className="font-semibold">{safetyResult.metadata.personalizationTokens.length}</div>
                                            <div className="text-muted-foreground">Personal</div>
                                        </div>
                                        <div className="bg-gray-50 rounded p-2 text-center">
                                            <div className="font-semibold">{safetyResult.metadata.emojiCount}</div>
                                            <div className="text-muted-foreground">Emojis</div>
                                        </div>
                                    </div>

                                    {/* Errors */}
                                    {safetyResult.errors.length > 0 && (
                                        <div className="space-y-1">
                                            {safetyResult.errors.map((error, i) => (
                                                <div key={i} className="flex items-start gap-2 text-xs bg-red-50 text-red-700 p-2 rounded border border-red-200">
                                                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                                    <span>{error.message}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Warnings */}
                                    {safetyResult.warnings.length > 0 && (
                                        <div className="space-y-1">
                                            {safetyResult.warnings.map((warning, i) => (
                                                <div key={i} className="flex items-start gap-2 text-xs bg-amber-50 text-amber-700 p-2 rounded border border-amber-200">
                                                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                                    <div>
                                                        <span>{warning.message}</span>
                                                        {warning.suggestion && (
                                                            <span className="block text-amber-600 mt-0.5">💡 {warning.suggestion}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* All Good */}
                                    {safetyResult.errors.length === 0 && safetyResult.warnings.length === 0 && (
                                        <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 p-2 rounded border border-green-200">
                                            <CheckCircle className="h-3.5 w-3.5" />
                                            <span>All safety checks passed!</span>
                                        </div>
                                    )}
                                </div>
                            )}
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
                                        {editData.body ? renderPreview(editData.body) : <span className="text-gray-400 italic">Your message will appear here...</span>}
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
