$ErrorActionPreference = "Stop"

function New-HexSecret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($buffer) -replace "-", "").ToLowerInvariant()
}

if (Test-Path ".env") {
    Write-Host ".env already exists. It was not overwritten." -ForegroundColor Yellow
    exit 0
}

$adminSecure = Read-Host "Choose the initial Super Admin password (14-72 UTF-8 bytes)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecure)
try {
    $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$byteCount = [Text.Encoding]::UTF8.GetByteCount($adminPassword)
if ($byteCount -lt 14 -or $byteCount -gt 72) {
    throw "Password must be between 14 and 72 UTF-8 bytes."
}

$dbPassword = New-HexSecret 32
$sessionSecret = New-HexSecret 48
$dataKey = New-HexSecret 32

$adminEscaped = $adminPassword.Replace('\', '\\').Replace('"', '\"')

$content = @"
NODE_ENV=development
PORT=3000
POSTGRES_DB=buraq_holidays
POSTGRES_USER=buraq
POSTGRES_PASSWORD=$dbPassword
DATABASE_URL=postgres://buraq:$dbPassword@db:5432/buraq_holidays
DATA_ENCRYPTION_KEY=$dataKey
SESSION_SECRET=$sessionSecret
ADMIN_USERNAME=admin
ADMIN_NAME="Buraq Super Admin"
ADMIN_PASSWORD="$adminEscaped"
"@

[IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $content, [Text.UTF8Encoding]::new($false))
Write-Host "Created .env with generated database/session/encryption secrets." -ForegroundColor Green
Write-Host "Your initial Super Admin username is: admin"
Write-Host "Keep .env private. Never upload it to GitHub." -ForegroundColor Yellow
