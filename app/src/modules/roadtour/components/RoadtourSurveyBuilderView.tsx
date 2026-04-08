'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  ArrowDown, ArrowUp, ClipboardList, Edit, GripVertical, Loader2, Plus, Save, Trash2
} from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface RoadtourSurveyBuilderViewProps {
  userProfile: any
  onViewChange: (viewId: string) => void
}

interface SurveyTemplate {
  id: string
  org_id: string
  name: string
  description: string | null
  is_active: boolean
  version: number
  created_at: string
}

interface SurveyField {
  id: string
  template_id: string
  field_key: string
  label: string
  field_type: string
  options: string[] | null
  is_required: boolean
  sort_order: number
}

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'single_select', label: 'Single Select (Dropdown)' },
  { value: 'multi_select', label: 'Multi Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'number', label: 'Number' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'photo', label: 'Photo Upload' },
]

export function RoadtourSurveyBuilderView({ userProfile, onViewChange }: RoadtourSurveyBuilderViewProps) {
  const supabase = createClient()
  const companyId = userProfile.organizations.id

  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<SurveyTemplate[]>([])

  // Editing state
  const [editingTemplate, setEditingTemplate] = useState<SurveyTemplate | null>(null)
  const [fields, setFields] = useState<SurveyField[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Template dialog
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateDialogMode, setTemplateDialogMode] = useState<'create' | 'edit'>('create')
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formActive, setFormActive] = useState(true)

  // Field dialog
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false)
  const [fieldDialogMode, setFieldDialogMode] = useState<'create' | 'edit'>('create')
  const [editFieldId, setEditFieldId] = useState<string | null>(null)
  const [fKey, setFKey] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fType, setFType] = useState('text')
  const [fRequired, setFRequired] = useState(true)
  const [fOptions, setFOptions] = useState('')

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await (supabase as any)
        .from('roadtour_survey_templates')
        .select('*')
        .eq('org_id', companyId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setTemplates(data || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load survey templates.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [companyId, supabase])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const loadFields = useCallback(async (templateId: string) => {
    try {
      setFieldsLoading(true)
      const { data, error } = await (supabase as any)
        .from('roadtour_survey_template_fields')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')
      if (error) throw error
      setFields(data || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load fields.', variant: 'destructive' })
    } finally {
      setFieldsLoading(false)
    }
  }, [supabase])

  const openTemplateForEdit = (t: SurveyTemplate) => {
    setEditingTemplate(t)
    loadFields(t.id)
  }

  const closeEditor = () => {
    setEditingTemplate(null)
    setFields([])
  }

  // Template CRUD
  const openCreateTemplate = () => {
    setFormName('')
    setFormDesc('')
    setFormActive(true)
    setTemplateDialogMode('create')
    setTemplateDialogOpen(true)
  }

  const openEditTemplate = () => {
    if (!editingTemplate) return
    setFormName(editingTemplate.name)
    setFormDesc(editingTemplate.description || '')
    setFormActive(editingTemplate.is_active)
    setTemplateDialogMode('edit')
    setTemplateDialogOpen(true)
  }

  const handleSaveTemplate = async () => {
    if (!formName.trim()) { toast({ title: 'Validation', description: 'Template name is required.', variant: 'destructive' }); return }
    try {
      setSaving(true)
      if (templateDialogMode === 'create') {
        const { data, error } = await (supabase as any).from('roadtour_survey_templates').insert({
          org_id: companyId,
          name: formName.trim(),
          description: formDesc.trim() || null,
          is_active: formActive,
          created_by: userProfile.id,
        }).select().single()
        if (error) throw error
        toast({ title: 'Created', description: `Survey template "${formName}" created.` })
        setTemplateDialogOpen(false)
        await loadTemplates()
        if (data) openTemplateForEdit(data)
      } else if (editingTemplate) {
        const { error } = await (supabase as any).from('roadtour_survey_templates').update({
          name: formName.trim(),
          description: formDesc.trim() || null,
          is_active: formActive,
        }).eq('id', editingTemplate.id)
        if (error) throw error
        toast({ title: 'Updated', description: 'Survey template updated.' })
        setEditingTemplate({ ...editingTemplate, name: formName.trim(), description: formDesc.trim() || null, is_active: formActive })
        setTemplateDialogOpen(false)
        loadTemplates()
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await (supabase as any).from('roadtour_survey_templates').delete().eq('id', id)
      if (error) throw error
      toast({ title: 'Deleted', description: 'Survey template deleted.' })
      closeEditor()
      loadTemplates()
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  // Field CRUD
  const openAddField = () => {
    setFKey('')
    setFLabel('')
    setFType('text')
    setFRequired(true)
    setFOptions('')
    setEditFieldId(null)
    setFieldDialogMode('create')
    setFieldDialogOpen(true)
  }

  const openEditField = (f: SurveyField) => {
    setFKey(f.field_key)
    setFLabel(f.label)
    setFType(f.field_type)
    setFRequired(f.is_required)
    setFOptions(f.options?.join('\n') || '')
    setEditFieldId(f.id)
    setFieldDialogMode('edit')
    setFieldDialogOpen(true)
  }

  const handleSaveField = async () => {
    if (!editingTemplate) return
    if (!fKey.trim() || !fLabel.trim()) { toast({ title: 'Validation', description: 'Field key and label are required.', variant: 'destructive' }); return }

    const optionsArr = ['single_select', 'multi_select', 'radio'].includes(fType)
      ? fOptions.split('\n').map((o) => o.trim()).filter(Boolean)
      : null

    try {
      setSaving(true)
      if (fieldDialogMode === 'create') {
        const sortOrder = fields.length + 1
        const { error } = await (supabase as any).from('roadtour_survey_template_fields').insert({
          template_id: editingTemplate.id,
          field_key: fKey.trim(),
          label: fLabel.trim(),
          field_type: fType,
          is_required: fRequired,
          options: optionsArr,
          sort_order: sortOrder,
        })
        if (error) throw error
        toast({ title: 'Field Added', description: `"${fLabel}" added to survey.` })
      } else if (editFieldId) {
        const { error } = await (supabase as any).from('roadtour_survey_template_fields').update({
          field_key: fKey.trim(),
          label: fLabel.trim(),
          field_type: fType,
          is_required: fRequired,
          options: optionsArr,
        }).eq('id', editFieldId)
        if (error) throw error
        toast({ title: 'Field Updated' })
      }
      setFieldDialogOpen(false)
      loadFields(editingTemplate.id)
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteField = async (fieldId: string) => {
    if (!editingTemplate) return
    try {
      const { error } = await (supabase as any).from('roadtour_survey_template_fields').delete().eq('id', fieldId)
      if (error) throw error
      toast({ title: 'Removed', description: 'Field removed.' })
      loadFields(editingTemplate.id)
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  const moveField = async (fieldId: string, direction: 'up' | 'down') => {
    if (!editingTemplate) return
    const idx = fields.findIndex((f) => f.id === fieldId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= fields.length) return

    try {
      await Promise.all([
        (supabase as any).from('roadtour_survey_template_fields').update({ sort_order: fields[swapIdx].sort_order }).eq('id', fields[idx].id),
        (supabase as any).from('roadtour_survey_template_fields').update({ sort_order: fields[idx].sort_order }).eq('id', fields[swapIdx].id),
      ])
      loadFields(editingTemplate.id)
    } catch {
      toast({ title: 'Error', description: 'Failed to reorder.', variant: 'destructive' })
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

  // Field builder view
  if (editingTemplate) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={closeEditor}>← Back</Button>
              <h3 className="text-xl font-semibold">{editingTemplate.name}</h3>
              <Badge variant={editingTemplate.is_active ? 'default' : 'secondary'}>{editingTemplate.is_active ? 'Active' : 'Inactive'}</Badge>
            </div>
            {editingTemplate.description && <p className="text-sm text-muted-foreground mt-1 ml-20">{editingTemplate.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openEditTemplate}><Edit className="h-4 w-4 mr-1" />Edit Info</Button>
            <Button size="sm" onClick={openAddField} className="gap-1"><Plus className="h-4 w-4" />Add Field</Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Survey Fields ({fields.length})</CardTitle></CardHeader>
          <CardContent>
            {fieldsLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : fields.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No fields yet. Click &quot;Add Field&quot; to create survey questions.</p>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex flex-col gap-0.5">
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => moveField(f.id, 'up')} disabled={i === 0}><ArrowUp className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => moveField(f.id, 'down')} disabled={i === fields.length - 1}><ArrowDown className="h-3 w-3" /></Button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{f.label}</p>
                        {f.is_required && <Badge variant="outline" className="text-xs">Required</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{f.field_key} · {FIELD_TYPES.find((t) => t.value === f.field_type)?.label || f.field_type}</p>
                      {f.options && f.options.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">Options: {f.options.join(', ')}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEditField(f)}><Edit className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteField(f.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Field Dialog */}
        <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{fieldDialogMode === 'create' ? 'Add Field' : 'Edit Field'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Field Key *</Label><Input value={fKey} onChange={(e) => setFKey(e.target.value.replace(/[^a-z0-9_]/g, ''))} placeholder="e.g. selling_serapod" /><p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores only.</p></div>
              <div className="space-y-2"><Label>Label *</Label><Input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="e.g. Is the shop selling Serapod?" /></div>
              <div className="space-y-2">
                <Label>Field Type</Label>
                <Select value={fType} onValueChange={setFType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {['single_select', 'multi_select', 'radio'].includes(fType) && (
                <div className="space-y-2"><Label>Options (one per line)</Label><textarea className="w-full rounded-md border p-2 text-sm min-h-[80px]" value={fOptions} onChange={(e) => setFOptions(e.target.value)} placeholder={"Option 1\nOption 2\nOption 3"} /></div>
              )}
              <div className="flex items-center gap-2"><Switch checked={fRequired} onCheckedChange={setFRequired} /><Label>Required</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFieldDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveField} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{fieldDialogMode === 'create' ? 'Add' : 'Update'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Template Edit Dialog */}
        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Edit Template Info</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Description</Label><Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} /></div>
              <div className="flex items-center gap-2"><Switch checked={formActive} onCheckedChange={setFormActive} /><Label>Active</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveTemplate} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Template list view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Survey Templates</h3>
          <p className="text-sm text-muted-foreground mt-1">Create and manage survey templates for RoadTour campaigns.</p>
        </div>
        <Button onClick={openCreateTemplate} className="gap-2"><Plus className="h-4 w-4" />Create Template</Button>
      </div>

      {templates.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No survey templates yet. Create one to get started.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => openTemplateForEdit(t)}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <Badge variant={t.is_active ? 'default' : 'secondary'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">v{t.version} · Created {new Date(t.created_at).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Template Dialog */}
      <Dialog open={templateDialogOpen && templateDialogMode === 'create'} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Survey Template</DialogTitle>
            <DialogDescription>Create a new survey template that can be used in RoadTour campaigns.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Template Name *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Standard Shop Visit Survey" /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional description" /></div>
            <div className="flex items-center gap-2"><Switch checked={formActive} onCheckedChange={setFormActive} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
