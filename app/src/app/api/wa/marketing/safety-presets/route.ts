// GET, POST - Safety Presets API
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  SYSTEM_PRESETS, 
  DEFAULT_PRESET_ID,
  SafetyPreset,
  CreatePresetRequest,
  validateSettings,
} from '@/lib/wa-safety';

// GET /api/wa/marketing/safety-presets
// Returns all system presets + custom presets for the org
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get current user's company
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get user's organization_id from users table
    // Note: Using 'any' cast until types are regenerated after migration
    const { data: profile } = await (supabase as any)
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    
    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'No company found' }, { status: 400 });
    }
    
    // Fetch custom presets for this company
    const { data: customPresets, error } = await (supabase as any)
      .from('wa_safety_presets')
      .select('*')
      .eq('company_id', profile.organization_id)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching custom presets:', error);
      // Return system presets even if custom fetch fails
      return NextResponse.json({
        presets: SYSTEM_PRESETS,
        activePresetId: DEFAULT_PRESET_ID,
      });
    }
    
    // Transform custom presets to SafetyPreset format
    const transformedCustomPresets: SafetyPreset[] = (customPresets || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      type: 'custom' as const,
      locked: false,
      settings: p.settings,
      createdBy: p.created_by,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      isDefault: p.is_default,
    }));
    
    // Fetch active preset for this company
    const { data: activeSettings } = await (supabase as any)
      .from('wa_safety_settings')
      .select('active_preset_id')
      .eq('company_id', profile.organization_id)
      .single();
    
    // Combine system + custom presets
    const allPresets = [...SYSTEM_PRESETS, ...transformedCustomPresets];
    
    return NextResponse.json({
      presets: allPresets,
      activePresetId: activeSettings?.active_preset_id || DEFAULT_PRESET_ID,
    });
  } catch (error) {
    console.error('Error in GET safety-presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/wa/marketing/safety-presets
// Create a new custom preset
export async function POST(request: Request) {
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
    
    const body: CreatePresetRequest = await request.json();
    
    // Validate required fields
    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Preset name is required' },
        { status: 400 }
      );
    }
    
    // Validate and sanitize settings
    const validation = validateSettings(body.settings);
    if (!validation.isValid) {
      console.warn('Settings adjusted during validation:', validation.errors);
    }
    
    // Check for duplicate name
    const { data: existing } = await (supabase as any)
      .from('wa_safety_presets')
      .select('id')
      .eq('company_id', profile.organization_id)
      .eq('name', body.name.trim())
      .single();
    
    if (existing) {
      return NextResponse.json(
        { error: 'A preset with this name already exists' },
        { status: 400 }
      );
    }
    
    // If this is set as default, unset other defaults
    if (body.isDefault) {
      await (supabase as any)
        .from('wa_safety_presets')
        .update({ is_default: false })
        .eq('company_id', profile.organization_id);
    }
    
    // Create the preset
    const { data: newPreset, error } = await (supabase as any)
      .from('wa_safety_presets')
      .insert({
        company_id: profile.organization_id,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        settings: validation.sanitized,
        is_default: body.isDefault || false,
        created_by: user.id,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating preset:', error);
      return NextResponse.json(
        { error: 'Failed to create preset' },
        { status: 500 }
      );
    }
    
    // Transform to SafetyPreset format
    const preset: SafetyPreset = {
      id: newPreset.id,
      name: newPreset.name,
      description: newPreset.description || '',
      type: 'custom',
      locked: false,
      settings: newPreset.settings,
      createdBy: newPreset.created_by,
      createdAt: newPreset.created_at,
      updatedAt: newPreset.updated_at,
      isDefault: newPreset.is_default,
    };
    
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    console.error('Error in POST safety-presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
