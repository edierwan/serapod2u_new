$objects = git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' 
$blobs = $objects | Where-Object { $_ -match '^blob ' } 
$processed = $blobs | ForEach-Object {
    $parts = $_ -split ' ', 4
    [PSCustomObject]@{
        Hash = $parts[1]
        SizeKB = [math]::Round([int]$parts[2]/1KB, 2)
        Path = $parts[3]
    }
}
$processed | Sort-Object SizeKB -Descending | Select-Object -First 20 | Format-Table -AutoSize
