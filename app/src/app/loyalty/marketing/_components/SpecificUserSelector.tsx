'use client';

import { useState, useCallback } from 'react';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Search, Plus, User, Check } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Simple debounce implementation
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
}

export function SpecificUserSelector({ selectedUserIds, onSelect }: SpecificUserSelectorProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    // Maintain a map of selected users details to display them even if not in search results
    // For now we just show IDs or fetch them? Ideally parent manages full objects or we fetch details.
    // Simplifying: We only show details if we have them. 
    // Wait, UI requirement: "show selected users pills/chips with remove"
    // To show name in pill, we need the name.
    // I'll assume we can't easily get name for existing IDs without fetching.
    // But this component is valid only for creating new campaign, so we start with empty.

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

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                <Input
                    placeholder="Search by name, email, phone..."
                    className="pl-9"
                    value={query}
                    onChange={e => onSearchChange(e.target.value)}
                />
            </div>

            {/* Selected Pills */}
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

            {/* Search Results */}
            <ScrollArea className="h-[200px] border rounded-md">
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
    );
}
