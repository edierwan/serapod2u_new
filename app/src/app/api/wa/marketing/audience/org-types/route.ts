import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data } = await supabase
      .from('organizations')
      .select('org_type_code')
      .not('org_type_code', 'is', null);

    const uniqueTypes = Array.from(new Set(
      data?.map(d => d.org_type_code).filter(Boolean)
    )).sort();

    return NextResponse.json({ organization_types: uniqueTypes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
