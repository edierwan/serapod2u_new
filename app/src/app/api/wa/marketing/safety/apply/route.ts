// POST - Apply Safety Settings
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  SYSTEM_PRESETS,
  validateSettings,
  ApplySettingsRequest,
} from '@/lib/wa-safety';

// POST /api/wa/marketing/safety/apply
// Save current active settings for the org
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get user's organization_id
    // Note: Using 'any' cast until types are regenerated after migration
    const { data: profile } = await (supabase as any)
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    
    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'No company found' }, { status: 400 });
    }
    
    const body: ApplySettingsRequest = await request.json();
    
    // Validate and sanitize settings
    const validation = validateSettings(body.settings);
    
    // Upsert settings for this company
    const { error } = await (supabase as any)
      .from('wa_safety_settings')
      .upsert({
        company_id: profile.organization_id,
        active_preset_id: body.presetId || null,
        settings: validation.sanitized,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }, {
        onConflict: 'company_id',
      });
    
    if (error) {
      console.error('Error applying settings:', error);
      return NextResponse.json(
        { error: 'Failed to apply settings' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      settings: validation.sanitized,
      warnings: validation.errors,
    });
  } catch (error) {
    console.error('Error in POST safety/apply:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Get current safety settings
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get user's organization_id
    const { data: profile } = await (supabase as any)
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    
    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'No company found' }, { status: 400 });
    }
    
    // Fetch current settings
    const { data: settingsRow } = await (supabase as any)
      .from('wa_safety_settings')
      .select('*')
      .eq('company_id', profile.organization_id)
      .single();
    
    if (!settingsRow) {
      // Return default (balanced) preset settings
      const balancedPreset = SYSTEM_PRESETS.find(p => p.id === 'system-balanced');
      return NextResponse.json({
        settings: balancedPreset?.settings,
        activePresetId: 'system-balanced',
      });
    }
    
    return NextResponse.json({
      settings: settingsRow.settings,
      activePresetId: settingsRow.active_preset_id,
    });
  } catch (error) {
    console.error('Error in GET safety/apply:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
