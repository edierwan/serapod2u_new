'use client';

import { useState, useCallback } from 'react';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Search, Plus, User, Check } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
    type ParsedRecipient,
    normalizeAdhocRecipientList,
    parseAdhocWhatsAppRecipients,
    summarizeAdhocRecipients,
} from '@/lib/marketing/adhocRecipients';

function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

interface SpecificUserSelectorProps {
    selectedUserIds: string[];
    onSelect: (ids: string[]) => void;
    adhocRecipients: ParsedRecipient[];
    onAdhocRecipientsChange: (recipients: ParsedRecipient[]) => void;
}

const ADHOC_REASON_LABELS: Record<string, string> = {
    duplicate: 'Duplicate',
    invalid_phone: 'Invalid Phone',
    missing_phone: 'Missing Phone',
    not_whatsapp_format: 'Not WhatsApp Format',
};

export function SpecificUserSelector({ selectedUserIds, onSelect, adhocRecipients, onAdhocRecipientsChange }: SpecificUserSelectorProps) {
    const { toast } = useToast();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [pasteInput, setPasteInput] = useState('');
    const [selectedUsers, setSelectedUsers] = useState<any[]>([]);

    const handleSearch = async (q: string) => {
        if (q.length < 2) {
            setResults([]);
            return;
        }
        setSearching(true);
        try {
            const res = await fetch(`/api/wa/marketing/audience/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            setResults(data.users || []);
        } finally {
            setSearching(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const debouncedSearch = useCallback(debounce(handleSearch, 400), []);

    const onSearchChange = (val: string) => {
        setQuery(val);
        debouncedSearch(val);
    };

    const toggleUser = (user: any) => {
        if (selectedUserIds.includes(user.id)) {
            const newIds = selectedUserIds.filter(id => id !== user.id);
            onSelect(newIds);
            setSelectedUsers(prev => prev.filter(u => u.id !== user.id));
        } else {
            onSelect([...selectedUserIds, user.id]);
            setSelectedUsers(prev => [...prev, user]);
        }
    };

    const removeUser = (id: string) => {
        onSelect(selectedUserIds.filter(uid => uid !== id));
        setSelectedUsers(prev => prev.filter(u => u.id !== id));
    };

    const removeAdhocRecipient = (id: string) => {
        onAdhocRecipientsChange(adhocRecipients.filter((recipient) => recipient.id !== id));
    };

    const clearAdhocRecipients = () => {
        onAdhocRecipientsChange([]);
    };

    const handleImportRecipients = () => {
        const importBatchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const parsedRecipients = parseAdhocWhatsAppRecipients(pasteInput).map((recipient, index) => ({
            ...recipient,
            id: `${recipient.id}_${importBatchId}_${index}`,
        }));
        if (parsedRecipients.length === 0) {
            toast({
                title: 'Nothing imported',
                description: 'Paste phone numbers or Excel rows before importing.',
                variant: 'destructive',
            });
            return;
        }

        const mergedRecipients = normalizeAdhocRecipientList([...adhocRecipients, ...parsedRecipients]);
        const importedSummary = summarizeAdhocRecipients(mergedRecipients.slice(adhocRecipients.length));

        onAdhocRecipientsChange(mergedRecipients);
        setPasteInput('');
        toast({
            title: 'Numbers imported',
            description: `Imported ${importedSummary.eligible} recipients. ${importedSummary.excluded} excluded.`,
        });
    };

    const adhocSummary = summarizeAdhocRecipients(adhocRecipients);

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Existing CRM Recipients</p>
                    <p className="text-xs text-muted-foreground">Search and select existing users or contacts.</p>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                    <Input
                        placeholder="Search by name, email, phone..."
                        className="pl-9"
                        value={query}
                        onChange={e => onSearchChange(e.target.value)}
                    />
                </div>

                {selectedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-2 p-2 bg-gray-50 rounded-md border min-h-[40px]">
                        {selectedUsers.map(u => (
                            <Badge key={u.id} variant="secondary" className="flex items-center gap-1 bg-white border shadow-sm">
                                <span>{u.full_name || u.email}</span>
                                <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={() => removeUser(u.id)} />
                            </Badge>
                        ))}
                    </div>
                )}

                <ScrollArea className="h-[180px] border rounded-md">
                    <div className="p-2 space-y-1">
                        {searching && <div className="text-xs text-center text-gray-500 py-2">Searching...</div>}
                        {!searching && query.length >= 2 && results.length === 0 && (
                            <div className="text-xs text-center text-gray-500 py-2">No users found</div>
                        )}
                        {!searching && query.length < 2 && selectedUsers.length === 0 && (
                            <div className="text-xs text-center text-gray-400 py-8">Type to search users</div>
                        )}

                        {results.map(user => {
                            const isSelected = selectedUserIds.includes(user.id);
                            return (
                                <div
                                    key={user.id}
                                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-gray-100 border border-transparent'}`}
                                    onClick={() => toggleUser(user)}
                                >
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-8 w-8">
                                            <AvatarFallback><User className="h-4 w-4 text-gray-500" /></AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium">{user.full_name || 'No Name'}</span>
                                            <span className="text-xs text-gray-500">{user.phone || user.email}</span>
                                        </div>
                                    </div>
                                    {isSelected && <Check className="w-4 h-4 text-primary" />}
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            <div className="border-t pt-4 space-y-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Ad-hoc WhatsApp Recipients</p>
                    <p className="text-xs text-muted-foreground">
                        Paste phone numbers from Excel. These recipients are used only for this broadcast and will not create CRM contacts.
                    </p>
                </div>

                <Textarea
                    value={pasteInput}
                    onChange={(event) => setPasteInput(event.target.value)}
                    className="min-h-[120px] resize-y"
                    placeholder="Paste phone numbers from Excel, one per line, or paste Excel rows with a phone column"
                />

                <div className="flex items-center justify-between gap-2">
                    <Button type="button" onClick={handleImportRecipients} disabled={!pasteInput.trim()}>
                        <Plus className="mr-2 h-4 w-4" /> Import Numbers
                    </Button>
                    {adhocRecipients.length > 0 && (
                        <Button type="button" variant="ghost" onClick={clearAdhocRecipients}>
                            Clear Imported
                        </Button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-md border bg-white p-3">
                        <div className="text-xs text-muted-foreground">Eligible</div>
                        <div className="mt-1 text-lg font-semibold">{adhocSummary.eligible}</div>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                        <div className="text-xs text-muted-foreground">Excluded</div>
                        <div className="mt-1 text-lg font-semibold">{adhocSummary.excluded}</div>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                        <div className="text-xs text-muted-foreground">Duplicate</div>
                        <div className="mt-1 text-lg font-semibold">{adhocSummary.duplicate}</div>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                        <div className="text-xs text-muted-foreground">Invalid</div>
                        <div className="mt-1 text-lg font-semibold">{adhocSummary.invalid}</div>
                    </div>
                </div>

                <ScrollArea className="h-[180px] border rounded-md">
                    <div className="p-2 space-y-2">
                        {adhocRecipients.length === 0 ? (
                            <div className="text-xs text-center text-gray-400 py-8">No ad-hoc recipients imported yet</div>
                        ) : (
                            adhocRecipients.map((recipient) => (
                                <div key={recipient.id} className="flex items-start justify-between gap-3 rounded-md border bg-white p-3">
                                    <div className="space-y-1 overflow-hidden">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium truncate">{recipient.display_name}</span>
                                            <Badge variant={recipient.status === 'eligible' ? 'secondary' : 'destructive'}>
                                                {recipient.status === 'eligible' ? 'Eligible' : ADHOC_REASON_LABELS[recipient.reason || 'invalid_phone']}
                                            </Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">
                                            {recipient.phone_normalized || recipient.phone_raw || 'No phone'}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={() => removeAdhocRecipient(recipient.id)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
