
import { createClient } from '@/lib/supabase/server';
import { SegmentEditor } from '../../_components/SegmentEditor';
import { notFound } from 'next/navigation';

export default async function EditSegmentPage({ params }: { params: { id: string } }) {
    const supabase = await createClient();
    
    // params is a Promise in recent Next.js versions (15+), but let's check current usage.
    // If this is Next.js 13/14 App Router, params is directly accessible.
    // However, to be safe, we can await it if needed, or just access it.
    // Standard destructuring:
    const { id } = params;

    const { data: segment, error } = await supabase
        .from('marketing_segments')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !segment) {
        notFound();
    }

    return (
        <SegmentEditor 
            isEditing={true} 
            initialData={segment} 
        />
    );
}
