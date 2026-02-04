'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lightbulb, Clock, AlertTriangle, Check, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  NumberHealth,
  recommendPreset,
  getSystemPreset,
  formatRuntime,
  formatRuntimeMs,
} from '@/lib/wa-safety';
import {
  SafetyLanguage,
  getTranslations,
} from '@/lib/wa-safety/i18n';

interface CampaignSafetyAdvisorProps {
  recipientCount: number;
  health: NumberHealth;
  lang?: SafetyLanguage;
  onApplyPreset?: (presetId: string) => void;
  compact?: boolean;
}

/**
 * Safety Advisor component for Create Campaign page
 * Shows recommended preset based on recipient count and number health
 */
export function CampaignSafetyAdvisor({
  recipientCount,
  health,
  lang = 'en',
  onApplyPreset,
  compact = false,
}: CampaignSafetyAdvisorProps) {
  const t = getTranslations(lang);
  
  // Get recommendation
  const recommendation = recommendPreset({
    recipientCount,
    health,
  });
  
  const preset = getSystemPreset(recommendation.presetId);
  if (!preset) return null;
  
  const presetName = lang === 'ms' ? preset.nameMs || preset.name : preset.name;
  const reason = lang === 'ms' ? recommendation.reasonMs : recommendation.reason;
  const warnings = lang === 'ms' ? recommendation.warningsMs : recommendation.warnings;
  const runtime = lang === 'ms' 
    ? formatRuntimeMs(recommendation.estimatedRuntimeMinutes)
    : formatRuntime(recommendation.estimatedRuntimeMinutes);

  if (compact) {
    return (
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-900">{t.advisor.recommendedPreset}:</span>
            <Badge variant="outline" className="bg-white">{presetName}</Badge>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <HelpCircle className="w-4 h-4 text-blue-600" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-2">
                <h4 className="font-medium text-sm">{t.advisor.viewWhy}</h4>
                <p className="text-xs text-muted-foreground">{reason}</p>
                {warnings && warnings.length > 0 && (
                  <div className="space-y-1 pt-2 border-t">
                    <p className="text-xs font-medium text-amber-700">{t.advisor.warnings}:</p>
                    {warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-600 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{t.advisor.estimatedRuntime}: {runtime}</span>
          </div>
          {onApplyPreset && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-blue-600"
              onClick={() => onApplyPreset(recommendation.presetId)}
            >
              {t.advisor.applyRecommended}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-blue-600" />
          {t.advisor.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          {t.advisor.basedOnList}
        </div>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t.advisor.recommendedPreset}:</span>
            <Badge variant="outline" className="bg-white">{presetName}</Badge>
          </div>
          <p className="text-xs text-gray-600">{reason}</p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{t.advisor.estimatedRuntime}:</span>
          </div>
          <span className="font-mono font-medium">{runtime}</span>
        </div>

        {warnings && warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-amber-800">{t.advisor.warnings}:</p>
            {warnings.map((warning, i) => (
              <p key={i} className="text-xs text-amber-700 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        )}

        {onApplyPreset && (
          <Button 
            size="sm" 
            className="w-full"
            onClick={() => onApplyPreset(recommendation.presetId)}
          >
            <Check className="w-4 h-4 mr-2" />
            {t.advisor.applyRecommended}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
