'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useToast } from '@/components/ui/use-toast'
import { 
  Palette, Sun, Moon, Monitor, Check, Sparkles
} from 'lucide-react'

const themeVariants = [
  {
    id: 'default',
    name: 'Classic Blue',
    description: 'Professional blue theme for business',
    icon: '💼',
    preview: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    category: 'Light'
  },
  {
    id: 'slate',
    name: 'Corporate Slate',
    description: 'Neutral and professional for corporate environments',
    icon: '🏢',
    preview: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
    category: 'Light'
  },
  {
    id: 'ocean',
    name: 'Ocean Breeze',
    description: 'Calming blue-green for relaxed productivity',
    icon: '🌊',
    preview: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    category: 'Light'
  },
  {
    id: 'forest',
    name: 'Forest Green',
    description: 'Natural green theme for sustainability focus',
    icon: '🌲',
    preview: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    category: 'Light'
  },
  {
    id: 'purple',
    name: 'Creative Purple',
    description: 'Modern purple for creative professionals',
    icon: '🎨',
    preview: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
    category: 'Light'
  },
  {
    id: 'sunset',
    name: 'Sunset Orange',
    description: 'Warm and energetic orange theme',
    icon: '🌅',
    preview: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    category: 'Light'
  },
  {
    id: 'black',
    name: 'True Black',
    description: 'OLED-friendly pure black theme',
    icon: '🌑',
    preview: 'linear-gradient(135deg, #000000 0%, #1f1f1f 100%)',
    category: 'Dark'
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Cool minimalist theme (Developer favorite)',
    icon: '❄️',
    preview: 'linear-gradient(135deg, #5e81ac 0%, #81a1c1 100%)',
    category: 'Light'
  },
]

export default function ThemePreferencesCard() {
  const { theme, setTheme, themeVariant, setThemeVariant } = useTheme()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  const handleThemeModeChange = (mode: 'light' | 'dark' | 'system') => {
    setTheme(mode)
    toast({
      title: "Theme Mode Updated",
      description: `Switched to ${mode} mode`,
    })
  }

  const handleVariantChange = (variantId: string) => {
    setThemeVariant(variantId as any)
    toast({
      title: "Theme Applied",
      description: `${themeVariants.find(v => v.id === variantId)?.name} theme has been applied`,
    })
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Appearance & Theme Preferences</CardTitle>
            <CardDescription>
              Customize your visual experience with modern themes
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Theme Mode Selection */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-semibold">Display Mode</Label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant={theme === 'light' ? 'default' : 'outline'}
              onClick={() => handleThemeModeChange('light')}
              className="flex flex-col items-center gap-2 h-auto py-4"
            >
              <Sun className="h-5 w-5" />
              <span className="text-xs">Light</span>
              {theme === 'light' && <Check className="h-3 w-3" />}
            </Button>
            
            <Button
              variant={theme === 'dark' ? 'default' : 'outline'}
              onClick={() => handleThemeModeChange('dark')}
              className="flex flex-col items-center gap-2 h-auto py-4"
            >
              <Moon className="h-5 w-5" />
              <span className="text-xs">Dark</span>
              {theme === 'dark' && <Check className="h-3 w-3" />}
            </Button>
            
            <Button
              variant={theme === 'system' ? 'default' : 'outline'}
              onClick={() => handleThemeModeChange('system')}
              className="flex flex-col items-center gap-2 h-auto py-4"
            >
              <Monitor className="h-5 w-5" />
              <span className="text-xs">Auto</span>
              {theme === 'system' && <Check className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {/* Theme Variants Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Theme Colors</Label>
            <Badge variant="secondary" className="text-xs">
              {themeVariants.find(v => v.id === themeVariant)?.name || 'Classic Blue'}
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {themeVariants.map((variant) => (
              <button
                key={variant.id}
                onClick={() => handleVariantChange(variant.id)}
                className={`relative group rounded-lg border-2 transition-all hover:scale-105 overflow-hidden ${
                  themeVariant === variant.id
                    ? 'border-primary shadow-lg'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {/* Color Preview */}
                <div 
                  className="h-24 w-full"
                  style={{ background: variant.preview }}
                />
                
                {/* Theme Info */}
                <div className="p-3 bg-card">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{variant.icon}</span>
                    <p className="text-xs font-semibold text-foreground truncate">
                      {variant.name}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {variant.description}
                  </p>
                  <Badge 
                    variant={variant.category === 'Dark' ? 'secondary' : 'outline'} 
                    className="mt-2 text-xs"
                  >
                    {variant.category}
                  </Badge>
                </div>

                {/* Selected Indicator */}
                {themeVariant === variant.id && (
                  <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                    <Check className="h-3 w-3" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Info Alert */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-4">
          <div className="flex gap-3">
            <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                Personalized Experience
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Your theme preference is saved to your browser and will persist across sessions. 
                Each user can have their own unique theme without affecting others.
              </p>
            </div>
          </div>
        </div>

        {/* Popular Choice Badge */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>💡 Popular choices:</span>
          <Badge variant="outline" className="text-xs">Classic Blue</Badge>
          <Badge variant="outline" className="text-xs">Nord</Badge>
          <Badge variant="outline" className="text-xs">True Black</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
