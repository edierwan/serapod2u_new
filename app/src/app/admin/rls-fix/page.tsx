'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, Copy, Database, CheckCircle2 } from 'lucide-react'

export default function RLSFixPage() {
  const sqlCode = `-- Fix RLS policy to allow shops to view their own QR scans
-- This resolves the issue where shops see 0 or incorrect point balance

DROP POLICY IF EXISTS "Users can view their own scans" ON consumer_qr_scans;
DROP POLICY IF EXISTS "Admins can view all consumer scans" ON consumer_qr_scans;

CREATE POLICY "Users and shops can view relevant scans"
  ON consumer_qr_scans
  FOR SELECT
  TO authenticated
  USING (
    -- Consumers can view their own scans
    consumer_id = auth.uid()
    OR
    -- Shops can view scans where they collected points (CRITICAL FIX)
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.organization_id = consumer_qr_scans.shop_id
    )
    OR
    -- Admins can view all scans
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'POWER_USER')
    )
  );

-- Verify the policy was created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd
FROM pg_policies
WHERE tablename = 'consumer_qr_scans'
ORDER BY policyname;`

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sqlCode)
    alert('SQL copied to clipboard!')
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-6 w-6" />
            <CardTitle className="text-2xl">RLS Policy Fix Required</CardTitle>
          </div>
          <CardDescription>
            Apply this SQL in your Supabase SQL Editor to fix shop point catalog viewing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Issue Description */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Issue:</strong> Shops cannot see their QR scans due to restrictive Row Level Security (RLS) policy.
              The policy only allows users to view scans where <code className="text-xs bg-muted px-1 py-0.5 rounded">consumer_id = auth.uid()</code>,
              but shops need to see scans where <code className="text-xs bg-muted px-1 py-0.5 rounded">shop_id = their organization_id</code>.
            </AlertDescription>
          </Alert>

          {/* Steps */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Steps to Apply Fix:</h3>
            <ol className="list-decimal list-inside space-y-3 ml-2">
              <li className="text-sm">
                Open your <strong>Supabase Dashboard</strong>
              </li>
              <li className="text-sm">
                Navigate to <strong>SQL Editor</strong> (left sidebar)
              </li>
              <li className="text-sm">
                Click <strong>New Query</strong>
              </li>
              <li className="text-sm">
                Copy the SQL code below and paste it into the editor
              </li>
              <li className="text-sm">
                Click <strong>Run</strong> to execute the SQL
              </li>
              <li className="text-sm">
                Refresh the shop&apos;s Point Catalog page
              </li>
            </ol>
          </div>

          {/* SQL Code */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">SQL Code:</h3>
              <Button 
                onClick={copyToClipboard}
                variant="outline" 
                size="sm"
                className="gap-2"
              >
                <Copy className="h-4 w-4" />
                Copy to Clipboard
              </Button>
            </div>
            <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto text-xs">
              <code>{sqlCode}</code>
            </pre>
          </div>

          {/* Expected Results */}
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-emerald-900">
              <strong>Expected Results:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
                <li>Shop balance will show <strong>1,966 points</strong> (instead of 533 or 0)</li>
                <li>Product summary table will display all scanned products</li>
                <li>Transaction history will show complete QR scan records</li>
                <li>Console errors will disappear</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* File Reference */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>Migration file: <code className="bg-muted px-1 py-0.5 rounded">migrations/034_shop_can_view_own_scans.sql</code></p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
