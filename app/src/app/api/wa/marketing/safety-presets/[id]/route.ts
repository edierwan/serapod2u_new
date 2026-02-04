// PUT, DELETE - Safety Presets by ID
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  SYSTEM_PRESETS,
  SafetyPreset,
  UpdatePresetRequest,
  validateSettings,
} from '@/lib/wa-safety';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PUT /api/wa/marketing/safety-presets/[id]
// Update a custom preset (only type=custom allowed)
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    // Check if trying to update a system preset
    const isSystemPreset = SYSTEM_PRESETS.some(p => p.id === id);
    if (isSystemPreset) {
      return NextResponse.json(
        { error: 'System presets cannot be modified' },
        { status: 403 }
      );
    }
    
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
    
    // Check if preset exists and belongs to this company
    const { data: existingPreset } = await (supabase as any)
      .from('wa_safety_presets')
      .select('*')
      .eq('id', id)
      .eq('company_id', profile.organization_id)
      .single();
    
    if (!existingPreset) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 }
      );
    }
    
    const body: UpdatePresetRequest = await request.json();
    
    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    
    if (body.name !== undefined) {
      if (body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Preset name cannot be empty' },
          { status: 400 }
        );
      }
      
      // Check for duplicate name (excluding current preset)
      const { data: duplicate } = await (supabase as any)
        .from('wa_safety_presets')
        .select('id')
        .eq('company_id', profile.organization_id)
        .eq('name', body.name.trim())
        .neq('id', id)
        .single();
      
      if (duplicate) {
        return NextResponse.json(
          { error: 'A preset with this name already exists' },
          { status: 400 }
        );
      }
      
      updates.name = body.name.trim();
    }
    
    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }
    
    if (body.settings !== undefined) {
      // Validate and sanitize settings
      const validation = validateSettings(body.settings);
      updates.settings = validation.sanitized;
    }
    
    if (body.isDefault !== undefined) {
      // If setting as default, unset other defaults first
      if (body.isDefault) {
        await (supabase as any)
          .from('wa_safety_presets')
          .update({ is_default: false })
          .eq('company_id', profile.organization_id);
      }
      updates.is_default = body.isDefault;
    }
    
    // Update the preset
    const { data: updatedPreset, error } = await (supabase as any)
      .from('wa_safety_presets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating preset:', error);
      return NextResponse.json(
        { error: 'Failed to update preset' },
        { status: 500 }
      );
    }
    
    // Transform to SafetyPreset format
    const preset: SafetyPreset = {
      id: updatedPreset.id,
      name: updatedPreset.name,
      description: updatedPreset.description || '',
      type: 'custom',
      locked: false,
      settings: updatedPreset.settings,
      createdBy: updatedPreset.created_by,
      createdAt: updatedPreset.created_at,
      updatedAt: updatedPreset.updated_at,
      isDefault: updatedPreset.is_default,
    };
    
    return NextResponse.json({ preset });
  } catch (error) {
    console.error('Error in PUT safety-presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/wa/marketing/safety-presets/[id]
// Delete a custom preset (only type=custom allowed)
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    // Check if trying to delete a system preset
    const isSystemPreset = SYSTEM_PRESETS.some(p => p.id === id);
    if (isSystemPreset) {
      return NextResponse.json(
        { error: 'System presets cannot be deleted' },
        { status: 403 }
      );
    }
    
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
    
    // Delete the preset (will only delete if it belongs to this company)
    const { error } = await (supabase as any)
      .from('wa_safety_presets')
      .delete()
      .eq('id', id)
      .eq('company_id', profile.organization_id);
    
    if (error) {
      console.error('Error deleting preset:', error);
      return NextResponse.json(
        { error: 'Failed to delete preset' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE safety-presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
