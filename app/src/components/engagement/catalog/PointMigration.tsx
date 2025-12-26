import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react"

export function PointMigration() {
  const [file, setFile] = useState<File | null>(null)
  const [defaultPassword, setDefaultPassword] = useState("")
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResult(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return
    if (!defaultPassword) {
        alert("Please enter a default password for new users.")
        return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('defaultPassword', defaultPassword)

    try {
      const res = await fetch('/api/admin/point-migration', {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Upload failed')
      }

      // Handle File Download
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `migration_results_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setResult({ success: true, message: "Processing complete. Results file downloaded." })
    } catch (error: any) {
      console.error(error)
      setResult({ success: false, error: error.message || 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const downloadTemplate = () => {
    // Create a dummy CSV/Excel and download
    const headers = ['Joined Date', 'Name', 'Phone', 'Email', 'Location', 'Points']
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + "2023-01-01,John Doe,60123456789,john@example.com,Selangor,100"
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", "migration_template.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Point Migration</CardTitle>
          <CardDescription>Upload an Excel file to migrate user points and update details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="migration-file">Migration File (Excel/CSV)</Label>
            <Input id="migration-file" type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} />
          </div>

          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="default-password">Default Password for New Users</Label>
            <Input 
                id="default-password" 
                type="text" 
                placeholder="Enter default password" 
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">This password will be used for any new accounts created during migration.</p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={!file || !defaultPassword || uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {uploading ? 'Processing...' : 'Upload & Process'}
            </Button>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Download Template
            </Button>
          </div>

          {result && (
            <div className="mt-4 space-y-2">
              {result.success ? (
                <Alert className="border-green-200 bg-green-50">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <h5 className="mb-1 font-medium leading-none tracking-tight text-green-800">Migration Complete</h5>
                  <AlertDescription className="text-green-700">
                    {result.message} Check the downloaded file for details.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-red-500/50 text-red-600 dark:border-red-500 [&>svg]:text-red-600 bg-red-50">
                  <AlertCircle className="h-4 w-4" />
                  <h5 className="mb-1 font-medium leading-none tracking-tight">Error</h5>
                  <AlertDescription>{result.error || 'Unknown error occurred'}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
