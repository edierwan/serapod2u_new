
import { useState, useEffect, useRef } from 'react'
import { Search, X, User as UserIcon, Loader2 } from 'lucide-react'
import { Input } from "../../ui/input"
import { Badge } from "../../ui/badge"
import { useDebounce } from "../../../hooks/use-debounce"
import { ScrollArea } from "../../ui/scroll-area"

interface User {
    id: string
    full_name: string
    email?: string
    phone?: string
}

interface UserMultiSelectProps {
    selectedUserIds: string[]
    onSelectionChange: (ids: string[]) => void
}

export function UserMultiSelect({ selectedUserIds, onSelectionChange }: UserMultiSelectProps) {
    const [query, setQuery] = useState('')
    const debouncedQuery = useDebounce(query, 300)
    const [results, setResults] = useState<User[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedUsers, setSelectedUsers] = useState<User[]>([])
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Fetch details for pre-selected IDs on mount
    useEffect(() => {
        const fetchSelectedUsers = async () => {
            if (selectedUserIds.length === 0) {
                setSelectedUsers([])
                return
            }
            
            // Avoid refetching if we already have the objects and count matches
            if (selectedUsers.length === selectedUserIds.length && selectedUsers.every(u => selectedUserIds.includes(u.id))) {
                return
            }

            // In a real app we might want a bulk fetch endpoint.
            // For now, we'll try to rely on the fact that if this is used in the drawer, 
            // the resolving logic might have populated it, or we fetch them.
            // Since we don't have a bulk fetch by ID endpoint specified, 
            // we will search for them one by one or assume the setting might store details too?
            // The requirement says: "recipient_users: string[] (array of user IDs)"
            // So we only have IDs. 
            // We can add a "get users by ids" endpoint or just reuse search if the ID is passed?
            // Or simplest: Just show the IDs or fetch them. 
            // Use search endpoint with a special param or just rely on search finding them if we pass names?
            // Let's implement a simple hydration fetch.
            
            try {
                // Fetching users by ID is not strictly in the search API spec but let's see if we can search by ID
                // Or we can add logic to fetch these.
                // For this task, I'll assumme we can use the search query to find them if needed, 
                // OR better, since we don't have a specific "get users" endpoint, we can try to skip hydration visual details 
                // until the user searches, BUT that's bad UX.
                // If the user IDs are saved, we need to show names.
                // I will add a method to fetch users to the search route or a new route?
                // Creating a new route /api/users/details might be best but I'm limited.
                // I'll skip hydration for now and just show "User ID: ..." if details missing,
                // OR I will hack it by searching for the ID if it looks like a UUID?
                // Let's just store the selected user objects in the parent/setting for now? 
                // The prompt says "recipient_users: string[]".
                // I will update the search API to allow fetching by IDs?
                // Or I can just fetch them client side? No, need DB.
                // Let's modify the search API to support `ids` param.
            } catch (e) {
                console.error(e)
            }
        }
        
        // fetchSelectedUsers()
        // For now, rely on parent or just show IDs if we can't fetch names easily.
        // Actually, I can update the search API to accept specific IDs!
    }, [selectedUserIds])

    useEffect(() => {
        const searchUsers = async () => {
            if (!debouncedQuery) {
                setResults([])
                return
            }

            setLoading(true)
            try {
                const res = await fetch(`/api/users/search?q=${encodeURIComponent(debouncedQuery)}`)
                const data = await res.json()
                if (data.users) {
                    setResults(data.users)
                    setOpen(true)
                }
            } catch (error) {
                console.error(error)
            } finally {
                setLoading(false)
            }
        }

        searchUsers()
    }, [debouncedQuery])
    
    // Attempt to hydrate users via search API if we have IDs but no objects
    // This is a bit hacky but works without new endpoint
    useEffect(() => {
        const hydrate = async () => {
             if (selectedUserIds.length > 0 && selectedUsers.length === 0) {
                 // Fetch details for these IDs? 
                 // If I can't fetch them, I can't show names.
                 // I will add logic to the route to fetch by IDs.
                 const params = new URLSearchParams()
                 selectedUserIds.forEach(id => params.append('ids', id))
                 const res = await fetch(`/api/users/search?${params.toString()}`)
                 const data = await res.json()
                 if(data.users) setSelectedUsers(data.users)
             } else if (selectedUserIds.length === 0) {
                 setSelectedUsers([])
             }
        }
        hydrate()
    }, [selectedUserIds.length]) // Only when count changes significantly

    const handleSelect = (user: User) => {
        if (!selectedUserIds.includes(user.id)) {
            const newIds = [...selectedUserIds, user.id]
            onSelectionChange(newIds)
            setSelectedUsers([...selectedUsers, user])
        }
        setQuery('')
        setOpen(false)
    }

    const handleRemove = (userId: string) => {
        onSelectionChange(selectedUserIds.filter(id => id !== userId))
        setSelectedUsers(selectedUsers.filter(u => u.id !== userId))
    }

    return (
        <div className="space-y-3" ref={containerRef}>
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                <Input
                    placeholder="Search by Full Name, Email, Phone..."
                    className="pl-9"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        if (!open) setOpen(true)
                    }}
                    onFocus={() => {
                        if (results.length > 0) setOpen(true)
                    }}
                />
                {loading && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-gray-500" />
                )}
                
                {open && results.length > 0 && (
                    <div className="absolute top-full mt-1 w-full bg-white border rounded-md shadow-lg z-50 max-h-[200px] overflow-auto">
                        {results.map(user => (
                            <div 
                                key={user.id}
                                className="p-2 hover:bg-gray-50 cursor-pointer flex justify-between items-center"
                                onClick={() => handleSelect(user)}
                            >
                                <div className="overflow-hidden">
                                    <div className="font-medium text-sm truncate">{user.full_name || user.email?.split('@')[0]}</div>
                                    <div className="text-xs text-gray-500 truncate">
                                        {user.email}
                                        {user.phone ? <span className="opacity-75"> | {user.phone}</span> : ''}
                                    </div>
                                </div>
                                {selectedUserIds.includes(user.id) && <Badge variant="secondary" className="text-[10px] ml-2 shrink-0">Selected</Badge>}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {selectedUsers.map(user => (
                    <div className="group relative" key={user.id} title={`${user.email}${user.phone ? ' | ' + user.phone : ''}`}>
                    <Badge variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1 cursor-help">
                        <UserIcon className="w-3 h-3 text-gray-500" />
                        <span>{user.full_name}</span>
                        <button 
                            onClick={() => handleRemove(user.id)}
                            className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </Badge>
                    </div>
                ))}
                 {/* Fallback for IDs that failed hydration */}
                 {selectedUserIds.filter(id => !selectedUsers.find(u => u.id === id)).map(id => (
                    <Badge key={id} variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1">
                        <UserIcon className="w-3 h-3 text-gray-500" />
                        <span className="font-mono text-xs">{id.substring(0,8)}...</span>
                        <button 
                            onClick={() => handleRemove(id)}
                            className="ml-1 hover:bg-gray-200 rounded-full p-0.5"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </Badge>
                ))}
            </div>
        </div>
    )
}
