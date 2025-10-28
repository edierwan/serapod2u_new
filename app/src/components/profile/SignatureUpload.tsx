/**
 * Signature Upload Component
 * Allows users to upload or draw their digital signature
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Upload, X, Check, AlertCircle, Pencil, Eraser, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SignatureUploadProps {
  userId: string;
  currentSignatureUrl?: string | null;
  onSignatureUpdated?: (url: string) => void;
}

export default function SignatureUpload({
  userId,
  currentSignatureUrl,
  onSignatureUpdated,
}: SignatureUploadProps) {
  const [signatureUrl, setSignatureUrl] = useState<string | null>(currentSignatureUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'draw'>('draw');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Canvas drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [penColor, setPenColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawn(true);

    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let x, y;
    if ('touches' in e) {
      e.preventDefault();
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const saveDrawnSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      setError('Please draw your signature first');
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const supabase = createClient();

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create image'));
        }, 'image/png');
      });

      // Generate unique filename
      const fileName = `${userId}_${Date.now()}.png`;
      const filePath = `signatures/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, blob, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/png',
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from('documents').getPublicUrl(filePath);

      // Update user record
      const { error: updateError } = await supabase
        .from('users')
        .update({ signature_url: publicUrl })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      setSignatureUrl(publicUrl);
      setSuccess(true);
      clearCanvas();

      if (onSignatureUpdated) {
        onSignatureUpdated(publicUrl);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Error saving signature:', err);
      setError(err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG recommended for transparency)');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('File size must be less than 2MB');
      return;
    }

    setError(null);
    setSuccess(false);
    setIsUploading(true);

    try {
      const supabase = createClient();

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}_${Date.now()}.${fileExt}`;
      const filePath = `signatures/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError, data } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from('documents').getPublicUrl(filePath);

      // Update user record
      const { error: updateError } = await supabase
        .from('users')
        .update({ signature_url: publicUrl })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      setSignatureUrl(publicUrl);
      setSuccess(true);
      
      if (onSignatureUpdated) {
        onSignatureUpdated(publicUrl);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Error uploading signature:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload signature');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveSignature = async () => {
    if (!confirm('Are you sure you want to remove your signature?')) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Update user record to remove signature
      const { error: updateError } = await supabase
        .from('users')
        .update({ signature_url: null })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      setSignatureUrl(null);
      setSuccess(true);

      if (onSignatureUpdated) {
        onSignatureUpdated('');
      }
    } catch (err) {
      console.error('Error removing signature:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove signature');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          <span>Signature {signatureUrl ? 'saved' : 'removed'} successfully!</span>
        </div>
      )}

      {signatureUrl ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">Current Signature</span>
            <button
              onClick={handleRemoveSignature}
              disabled={isUploading}
              className="text-red-600 hover:text-red-700 text-sm flex items-center gap-1 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Remove
            </button>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center min-h-[120px]">
            <Image
              src={signatureUrl}
              alt="Digital Signature"
              width={300}
              height={100}
              className="max-w-full h-auto"
            />
          </div>
          <button
            onClick={() => {
              setSignatureUrl(null);
              setActiveTab('draw');
            }}
            disabled={isUploading}
            className="mt-4 w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Change Signature
          </button>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'draw')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="draw" className="gap-2">
              <Pencil className="w-4 h-4" />
              Draw Signature
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="w-4 h-4" />
              Upload Image
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draw" className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Draw Your Signature
              </label>
              <p className="text-xs text-gray-500 mb-4">
                Use your mouse or touch screen to draw your signature in the box below.
              </p>
            </div>

            <div className="border-2 border-gray-300 rounded-lg p-4 bg-white">
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full border border-gray-200 rounded cursor-crosshair bg-white"
                style={{ touchAction: 'none' }}
              />
              
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Color:</label>
                  <input
                    type="color"
                    value={penColor}
                    onChange={(e) => setPenColor(e.target.value)}
                    className="w-8 h-8 rounded border cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Thickness:</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={penWidth}
                    onChange={(e) => setPenWidth(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-xs text-gray-600 w-6">{penWidth}px</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearCanvas}
                  disabled={!hasDrawn}
                  className="ml-auto gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear
                </Button>
              </div>
            </div>

            <Button
              onClick={saveDrawnSignature}
              disabled={!hasDrawn || isUploading}
              className="w-full gap-2"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Signature
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="upload" className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Signature Image
              </label>
              <p className="text-xs text-gray-500 mb-4">
                Upload a transparent PNG of your signature. Recommended: 300x100px transparent background.
              </p>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
            >
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm font-medium text-gray-700 mb-1">
                {isUploading ? 'Uploading...' : 'Click to upload signature'}
              </p>
              <p className="text-xs text-gray-500">PNG, JPG up to 2MB</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
          </TabsContent>
        </Tabs>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium mb-2">Important Notes:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Your signature will be used to digitally sign Purchase Orders, Invoices, and other documents</li>
          <li>Use a clear signature for best results</li>
          <li>Once signed, documents cannot be unsigned</li>
          <li>Your signature will be timestamped and cryptographically verified</li>
        </ul>
      </div>
    </div>
  );
}
