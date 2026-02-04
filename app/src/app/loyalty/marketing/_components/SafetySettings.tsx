'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
    Info, ShieldCheck, AlertTriangle, Activity, 
    Flame, Thermometer, Clock, 
    Fingerprint, BarChart3, Lock, Zap, 
    Lightbulb, Save, FolderCog,
    Globe, Check, AlertCircle, Trash2
} from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// Import safety library
import {
  SafetyPreset,
  SafetyPresetSettings,
  NumberHealth,
  SYSTEM_PRESETS,
  BALANCED_PRESET,
  getSystemPreset,
  recommendPresetForSafety,
  hasChangesFromPreset,
  SAFETY_CONSTRAINTS,
} from '@/lib/wa-safety';

import {
  SafetyLanguage,
  SafetyTranslations,
  getTranslations,
} from '@/lib/wa-safety/i18n';

// Number Health Panel Component
function NumberHealthPanel({ 
  health, 
  t, 
}: { 
  health: NumberHealth; 
  t: SafetyTranslations; 
}) {
  const getHealthStatus = () => {
    if (health.riskScore < 30) return { label: t.numberHealth.healthy, color: 'green' };
    if (health.riskScore < 60) return { label: t.numberHealth.warning, color: 'yellow' };
    return { label: t.numberHealth.critical, color: 'red' };
  };

  const status = getHealthStatus();

  return (
    <Card>
      <CardHeader className="bg-muted/30 pb-3">
        <CardTitle className="text-sm uppercase text-gray-500 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          {t.numberHealth.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{t.numberHealth.riskScore}</span>
          <Badge className={cn("ml-auto", 
            status.color === 'green' ? "bg-green-100 text-green-800 hover:bg-green-100" : 
            status.color === 'yellow' ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" : 
            "bg-red-100 text-red-800 hover:bg-red-100"
          )}>
            {health.riskScore} / 100
          </Badge>
        </div>
        
        <div className="space-y-3 pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Zap className="w-3 h-3" /> {t.numberHealth.uptime}
            </span>
            <span className="font-medium">{health.uptime24h}%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> {t.numberHealth.disconnects}
            </span>
            <span className="font-medium">{health.disconnects24h}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <BarChart3 className="w-3 h-3" /> {t.numberHealth.successRate}
            </span>
            <span className="font-medium">{health.successRate}%</span>
          </div>
        </div>

        {health.lastIssueRecency && (
          <>
            <Separator />
            <div className="text-xs text-muted-foreground bg-yellow-50 p-2 rounded border border-yellow-100">
              <span className="font-semibold text-yellow-700">{t.numberHealth.lastIssue}:</span> {health.lastIssueRecency}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Advisor Card Component
function AdvisorCard({ 
  health, 
  t, 
  lang,
  onApplyPreset 
}: { 
  health: NumberHealth; 
  t: SafetyTranslations; 
  lang: SafetyLanguage;
  onApplyPreset: (presetId: string) => void;
}) {
  const recommendation = recommendPresetForSafety(health);
  const preset = getSystemPreset(recommendation.presetId);
  
  if (!preset) return null;

  const reason = lang === 'ms' ? recommendation.reasonMs : recommendation.reason;

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-blue-600" />
          {t.advisor.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {t.advisor.basedOnHealth}
        </div>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t.advisor.recommendedPreset}:</span>
            <Badge variant="outline" className="bg-white">
              {lang === 'ms' ? preset.nameMs : preset.name}
            </Badge>
          </div>
          <p className="text-xs text-gray-600">{reason}</p>
        </div>

        <Button 
          size="sm" 
          className="w-full"
          onClick={() => onApplyPreset(recommendation.presetId)}
        >
          <Check className="w-4 h-4 mr-2" />
          {t.advisor.applyRecommended}
        </Button>
      </CardContent>
    </Card>
  );
}

// Save Preset Modal
function SavePresetModal({
  open,
  onOpenChange,
  t,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: SafetyTranslations;
  onSave: (name: string, description: string, isDefault: boolean) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name, description, isDefault);
      onOpenChange(false);
      setName('');
      setDescription('');
      setIsDefault(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.savePresetModal.title}</DialogTitle>
          <DialogDescription>
            {t.pageSubtitle}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t.savePresetModal.nameLabel}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.savePresetModal.namePlaceholder}
            />
          </div>
          
          <div className="space-y-2">
            <Label>{t.savePresetModal.descriptionLabel}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.savePresetModal.descriptionPlaceholder}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>{t.savePresetModal.setAsDefault}</Label>
              <p className="text-xs text-muted-foreground">{t.savePresetModal.setAsDefaultDesc}</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.savePresetModal.cancel}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? t.savePresetModal.saving : t.savePresetModal.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Manage Presets Modal
function ManagePresetsModal({
  open,
  onOpenChange,
  presets,
  t,
  lang,
  onDelete,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: SafetyPreset[];
  t: SafetyTranslations;
  lang: SafetyLanguage;
  onDelete: (id: string) => Promise<void>;
  onApply: (presetId: string) => void;
}) {
  const systemPresets = presets.filter(p => p.type === 'system');
  const customPresets = presets.filter(p => p.type === 'custom');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderCog className="w-5 h-5" />
            {t.managePresetsModal.title}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
          {/* System Presets */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {t.managePresetsModal.systemPresets}
            </h4>
            <div className="space-y-2">
              {systemPresets.map((preset) => (
                <div 
                  key={preset.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-4 h-4 text-gray-400" />
                    <div>
                      <p className="font-medium text-sm">
                        {lang === 'ms' ? preset.nameMs : preset.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {lang === 'ms' ? preset.descriptionMs : preset.description}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">{t.presets.systemBadge}</Badge>
                </div>
              ))}
            </div>
          </div>
          
          {/* Custom Presets */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {t.managePresetsModal.customPresets}
            </h4>
            {customPresets.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-3 bg-gray-50 rounded-lg">
                {t.managePresetsModal.noCustomPresets}
              </p>
            ) : (
              <div className="space-y-2">
                {customPresets.map((preset) => (
                  <div 
                    key={preset.id}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{preset.name}</p>
                        {preset.isDefault && (
                          <Badge variant="outline" className="text-xs">Default</Badge>
                        )}
                      </div>
                      {preset.description && (
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onApply(preset.id);
                          onOpenChange(false);
                        }}
                      >
                        {t.actions.apply}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(t.managePresetsModal.deleteConfirm)) {
                            onDelete(preset.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.managePresetsModal.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Language Switcher Component
function LanguageSwitcher({
  lang,
  onLanguageChange,
  t,
}: {
  lang: SafetyLanguage;
  onLanguageChange: (lang: SafetyLanguage) => void;
  t: SafetyTranslations;
}) {
  return (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-muted-foreground" />
      <Select value={lang} onValueChange={(v) => onLanguageChange(v as SafetyLanguage)}>
        <SelectTrigger className="w-[140px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">{t.language.en}</SelectItem>
          <SelectItem value="ms">{t.language.ms}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// Preset Selector Component
function PresetSelector({
  presets,
  selectedPresetId,
  onSelectPreset,
  hasChanges,
  t,
  lang,
}: {
  presets: SafetyPreset[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string) => void;
  hasChanges: boolean;
  t: SafetyTranslations;
  lang: SafetyLanguage;
}) {
  const selectedPreset = presets.find(p => p.id === selectedPresetId);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{t.presets.selectLabel}</Label>
      <Select value={selectedPresetId || ''} onValueChange={onSelectPreset}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t.presets.selectLabel}>
            {selectedPreset && (
              <div className="flex items-center gap-2">
                {selectedPreset.locked && <Lock className="w-3 h-3 text-gray-400" />}
                <span>{lang === 'ms' ? selectedPreset.nameMs || selectedPreset.name : selectedPreset.name}</span>
                <Badge variant="secondary" className="text-xs ml-2">
                  {selectedPreset.type === 'system' ? t.presets.systemBadge : t.presets.customBadge}
                </Badge>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              <div className="flex items-center gap-2">
                {preset.locked && <Lock className="w-3 h-3 text-gray-400" />}
                <span>{lang === 'ms' ? preset.nameMs || preset.name : preset.name}</span>
                <Badge variant="secondary" className="text-xs ml-2">
                  {preset.type === 'system' ? t.presets.systemBadge : t.presets.customBadge}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {hasChanges && (
        <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
          <AlertCircle className="w-3 h-3" />
          {t.presets.customChanges}
        </div>
      )}
    </div>
  );
}

// Main Component
export function SafetyComplianceSettings() {
  const { toast } = useToast();
  
  // Language state
  const [lang, setLang] = useState<SafetyLanguage>('en');
  const t = getTranslations(lang);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Presets state
  const [presets, setPresets] = useState<SafetyPreset[]>(SYSTEM_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('system-balanced');
  const [originalSettings, setOriginalSettings] = useState<SafetyPresetSettings | null>(null);
  
  // Settings state (matches SafetyPresetSettings)
  const [settings, setSettings] = useState<SafetyPresetSettings>(BALANCED_PRESET.settings);
  
  // Modal states
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [managePresetsModalOpen, setManagePresetsModalOpen] = useState(false);
  
  // Mock health data (in real app, fetch from API)
  const [health] = useState<NumberHealth>({
    riskScore: 15,
    uptime24h: 98.5,
    disconnects24h: 3,
    successRate: 94.2,
    lastIssueRecency: '2h ago (Connection Lost)',
  });

  // Check if settings have changed from selected preset
  const hasChanges = originalSettings ? hasChangesFromPreset(settings, originalSettings) : false;

  // Load presets and settings
  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch presets
        const presetsRes = await fetch('/api/wa/marketing/safety-presets');
        if (presetsRes.ok) {
          const data = await presetsRes.json();
          setPresets(data.presets);
          if (data.activePresetId) {
            setSelectedPresetId(data.activePresetId);
          }
        }
        
        // Fetch current settings
        const settingsRes = await fetch('/api/wa/marketing/safety/apply');
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          if (data.settings) {
            setSettings(data.settings);
            setOriginalSettings(data.settings);
          }
        }
      } catch (error) {
        console.error('Error loading safety data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, []);

  // Apply preset
  const handleSelectPreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    
    setSelectedPresetId(presetId);
    setSettings({ ...preset.settings });
    setOriginalSettings({ ...preset.settings });
    
    toast({
      title: t.presets.appliedToast,
      description: `${lang === 'ms' ? preset.nameMs || preset.name : preset.name}`,
    });
  }, [presets, t, lang, toast]);

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/wa/marketing/safety/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: selectedPresetId,
          settings,
        }),
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      setOriginalSettings({ ...settings });
      
      toast({
        title: t.messages.settingsSaved,
        description: t.messages.settingsSavedDesc,
      });
    } catch (error) {
      toast({
        title: t.messages.error,
        description: t.messages.errorSaving,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Create custom preset
  const handleCreatePreset = async (name: string, description: string, isDefault: boolean) => {
    const res = await fetch('/api/wa/marketing/safety-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        settings,
        isDefault,
      }),
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to create preset');
    }
    
    const { preset } = await res.json();
    setPresets(prev => [...prev, preset]);
    setSelectedPresetId(preset.id);
    setOriginalSettings({ ...settings });
    
    toast({
      title: t.messages.presetCreated,
      description: preset.name,
    });
  };

  // Delete custom preset
  const handleDeletePreset = async (presetId: string) => {
    const res = await fetch(`/api/wa/marketing/safety-presets/${presetId}`, {
      method: 'DELETE',
    });
    
    if (!res.ok) throw new Error('Failed to delete');
    
    setPresets(prev => prev.filter(p => p.id !== presetId));
    
    // If deleted preset was selected, switch to Balanced
    if (selectedPresetId === presetId) {
      handleSelectPreset('system-balanced');
    }
    
    toast({
      title: t.messages.presetDeleted,
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with Language Switcher */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t.pageTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.pageSubtitle}</p>
        </div>
        <LanguageSwitcher lang={lang} onLanguageChange={setLang} t={t} />
      </div>

      {/* Preset Selector Bar */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex-1">
              <PresetSelector
                presets={presets}
                selectedPresetId={selectedPresetId}
                onSelectPreset={handleSelectPreset}
                hasChanges={hasChanges}
                t={t}
                lang={lang}
              />
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSavePresetModalOpen(true)}
              >
                <Save className="w-4 h-4 mr-2" />
                {t.presets.saveAsPreset}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setManagePresetsModalOpen(true)}
              >
                <FolderCog className="w-4 h-4 mr-2" />
                {t.presets.managePresets}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col xl:flex-row gap-6">
        {/* Main Settings Area */}
        <div className="flex-1 space-y-6">
          {/* Best Practices Box */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <span className="font-semibold block mb-1">{t.antiBanGuardrails.title}</span>
              <p className="mb-2">{t.antiBanGuardrails.description}</p>
              <ul className="list-disc pl-4 space-y-1 text-xs">
                {t.antiBanGuardrails.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Warm-Up Mode */}
          <Card className={cn("border-l-4", settings.warmUpMode ? "border-l-indigo-500" : "border-l-transparent")}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className={cn("w-5 h-5", settings.warmUpMode ? "text-indigo-600" : "text-gray-400")} />
                  {t.warmUpMode.title}
                </div>
                <Switch 
                  checked={settings.warmUpMode} 
                  onCheckedChange={(checked) => setSettings({...settings, warmUpMode: checked})} 
                />
              </CardTitle>
              <CardDescription>{t.warmUpMode.description}</CardDescription>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Volume Caps */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="w-4 h-4 text-primary" /> 
                  {t.volumeCaps.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>{t.volumeCaps.dailyCap}</Label>
                    <span className="text-xs text-muted-foreground">{settings.dailyCap} {t.volumeCaps.perDay}</span>
                  </div>
                  <Input 
                    type="number" 
                    value={settings.dailyCap}
                    min={SAFETY_CONSTRAINTS.dailyCap.min}
                    max={SAFETY_CONSTRAINTS.dailyCap.max}
                    onChange={e => setSettings({...settings, dailyCap: Number(e.target.value)})}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>{t.volumeCaps.rolling24h}</Label>
                    <span className="text-xs text-muted-foreground">{settings.rolling24hCap} {t.volumeCaps.per24h}</span>
                  </div>
                  <Input 
                    type="number" 
                    value={settings.rolling24hCap}
                    min={SAFETY_CONSTRAINTS.rollingCap.min}
                    max={SAFETY_CONSTRAINTS.rollingCap.max}
                    onChange={e => setSettings({...settings, rolling24hCap: Number(e.target.value)})}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Session Cooling */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Thermometer className="w-4 h-4 text-blue-500" /> 
                  {t.sessionCooling.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>{t.sessionCooling.burstSize}</Label>
                    <span className="text-xs text-muted-foreground">{t.sessionCooling.restAfter} {settings.burstSize} msgs</span>
                  </div>
                  <Slider 
                    value={[settings.burstSize]} 
                    min={SAFETY_CONSTRAINTS.burstSize.min} 
                    max={SAFETY_CONSTRAINTS.burstSize.max} 
                    step={5}
                    onValueChange={(v) => setSettings({...settings, burstSize: v[0]})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">{t.sessionCooling.cooldown}</Label>
                    <Input 
                      type="number" 
                      value={settings.cooldownMin}
                      min={SAFETY_CONSTRAINTS.cooldown.min}
                      max={SAFETY_CONSTRAINTS.cooldown.max}
                      onChange={e => setSettings({...settings, cooldownMin: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">{t.sessionCooling.maxRuntime}</Label>
                    <Input 
                      type="number" 
                      value={settings.maxRuntimeMin}
                      min={SAFETY_CONSTRAINTS.maxRuntime.min}
                      max={SAFETY_CONSTRAINTS.maxRuntime.max}
                      onChange={e => setSettings({...settings, maxRuntimeMin: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Delivery Speed */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-green-600" />
                {t.deliverySpeed.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label>{t.deliverySpeed.throttle}</Label>
                  <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">{settings.throttle} {t.deliverySpeed.msgsPerMin}</span>
                </div>
                <Slider 
                  value={[settings.throttle]} 
                  min={SAFETY_CONSTRAINTS.throttle.min} 
                  max={SAFETY_CONSTRAINTS.throttle.max} 
                  step={1}
                  onValueChange={(v) => setSettings({...settings, throttle: v[0]})}
                />
              </div>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label>{t.deliverySpeed.jitter}</Label>
                  <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {settings.jitterMin}{t.deliverySpeed.seconds} - {settings.jitterMax}{t.deliverySpeed.seconds}
                  </span>
                </div>
                <div className="flex gap-4 items-center">
                  <Input 
                    type="number" 
                    className="w-20" 
                    value={settings.jitterMin}
                    min={SAFETY_CONSTRAINTS.jitter.min}
                    max={settings.jitterMax}
                    onChange={e => setSettings({...settings, jitterMin: Number(e.target.value)})}
                  />
                  <span>{t.deliverySpeed.to}</span>
                  <Input 
                    type="number" 
                    className="w-20" 
                    value={settings.jitterMax}
                    min={settings.jitterMin}
                    max={SAFETY_CONSTRAINTS.jitter.max}
                    onChange={e => setSettings({...settings, jitterMax: Number(e.target.value)})}
                  />
                </div>
                <p className="text-xs text-gray-500">{t.deliverySpeed.jitterDesc}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Engagement Guard */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="w-4 h-4 text-purple-600" /> 
                  {t.engagementGuard.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t.engagementGuard.minReplyRate}</Label>
                    <p className="text-xs text-muted-foreground">{t.engagementGuard.minReplyRateDesc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      type="number" 
                      className="w-16" 
                      value={settings.minReplyRate}
                      min={SAFETY_CONSTRAINTS.minReplyRate.min}
                      max={SAFETY_CONSTRAINTS.minReplyRate.max}
                      step={0.5}
                      onChange={e => setSettings({...settings, minReplyRate: Number(e.target.value)})}
                    />
                    <span className="text-sm">%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t.engagementGuard.optOutSpike}</Label>
                    <p className="text-xs text-muted-foreground">{t.engagementGuard.optOutSpikeDesc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      type="number" 
                      className="w-16" 
                      value={settings.optOutSpike}
                      min={SAFETY_CONSTRAINTS.optOutSpike.min}
                      max={SAFETY_CONSTRAINTS.optOutSpike.max}
                      step={0.1}
                      onChange={e => setSettings({...settings, optOutSpike: Number(e.target.value)})}
                    />
                    <span className="text-sm">%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Content Fingerprint */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Fingerprint className="w-4 h-4 text-orange-600" /> 
                  {t.contentFingerprint.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t.contentFingerprint.blockShorteners}</Label>
                  <Switch 
                    checked={settings.contentFingerprint.blockShorteners} 
                    onCheckedChange={c => setSettings({
                      ...settings, 
                      contentFingerprint: {...settings.contentFingerprint, blockShorteners: c}
                    })} 
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t.contentFingerprint.requirePersonalization}</Label>
                  <Switch 
                    checked={settings.contentFingerprint.requirePersonalization} 
                    onCheckedChange={c => setSettings({
                      ...settings, 
                      contentFingerprint: {...settings.contentFingerprint, requirePersonalization: c}
                    })} 
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t.contentFingerprint.maxEmojis}</Label>
                    <Input 
                      type="number" 
                      value={settings.contentFingerprint.maxEmojis}
                      min={SAFETY_CONSTRAINTS.maxEmojis.min}
                      max={SAFETY_CONSTRAINTS.maxEmojis.max}
                      onChange={e => setSettings({
                        ...settings, 
                        contentFingerprint: {...settings.contentFingerprint, maxEmojis: Number(e.target.value)}
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.contentFingerprint.maxCaps}</Label>
                    <Input 
                      type="number" 
                      value={settings.contentFingerprint.maxCapsPct}
                      min={SAFETY_CONSTRAINTS.maxCapsPct.min}
                      max={SAFETY_CONSTRAINTS.maxCapsPct.max}
                      onChange={e => setSettings({
                        ...settings, 
                        contentFingerprint: {...settings.contentFingerprint, maxCapsPct: Number(e.target.value)}
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.contentFingerprint.maxLinks}</Label>
                    <Input 
                      type="number" 
                      value={settings.contentFingerprint.maxLinks}
                      min={SAFETY_CONSTRAINTS.maxLinks.min}
                      max={SAFETY_CONSTRAINTS.maxLinks.max}
                      onChange={e => setSettings({
                        ...settings, 
                        contentFingerprint: {...settings.contentFingerprint, maxLinks: Number(e.target.value)}
                      })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full xl:w-80 space-y-6">
          {/* Number Health Panel */}
          <NumberHealthPanel health={health} t={t} />
          
          {/* Advisor Card */}
          <AdvisorCard 
            health={health} 
            t={t} 
            lang={lang}
            onApplyPreset={handleSelectPreset}
          />

          {/* Global Enforcements */}
          <Card className="xl:sticky xl:top-4">
            <CardHeader>
              <CardTitle className="text-sm uppercase text-gray-500">
                {t.globalEnforcements.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>{t.globalEnforcements.quietHours}</Label>
                  <p className="text-xs text-gray-500">{t.globalEnforcements.quietHoursTime}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{t.globalEnforcements.alwaysOn}</Badge>
                  <Switch checked={true} disabled />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>{t.globalEnforcements.strictOptOut}</Label>
                  <p className="text-xs text-gray-500">{t.globalEnforcements.strictOptOutDesc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{t.globalEnforcements.alwaysOn}</Badge>
                  <Switch checked={true} disabled />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t.globalEnforcements.failureAutoPause}</Label>
                  <span className="text-xs">{settings.failureAutoPause}%</span>
                </div>
                <Slider 
                  value={[settings.failureAutoPause]} 
                  min={SAFETY_CONSTRAINTS.failureAutoPause.min} 
                  max={SAFETY_CONSTRAINTS.failureAutoPause.max} 
                  step={1}
                  onValueChange={v => setSettings({...settings, failureAutoPause: v[0]})}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? t.actions.saving : t.actions.save}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Modals */}
      <SavePresetModal
        open={savePresetModalOpen}
        onOpenChange={setSavePresetModalOpen}
        t={t}
        onSave={handleCreatePreset}
      />
      
      <ManagePresetsModal
        open={managePresetsModalOpen}
        onOpenChange={setManagePresetsModalOpen}
        presets={presets}
        t={t}
        lang={lang}
        onDelete={handleDeletePreset}
        onApply={handleSelectPreset}
      />
    </div>
  );
}
