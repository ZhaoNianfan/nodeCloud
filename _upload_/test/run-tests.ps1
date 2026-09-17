$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'
$tmp = $PSScriptRoot
$cj = Join-Path $tmp 'cookies.txt'
Remove-Item $cj -ErrorAction SilentlyContinue
$script:failures = 0

# JSON 请求体写到文件，避免 PowerShell 原生命令引号问题
$bodySetup = '{"username":"admin","password":"passw0rd123"}'
$bodyLoginOk = '{"username":"admin","password":"passw0rd123"}'
$bodyLoginBad = '{"username":"admin","password":"wrongpass"}'
$bodyDir = '{"path":"2024/\u65b0\u7b14\u8bb0"}'
[IO.File]::WriteAllText((Join-Path $tmp 'body-setup.json'), $bodySetup, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $tmp 'body-login-ok.json'), $bodyLoginOk, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $tmp 'body-login-bad.json'), $bodyLoginBad, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $tmp 'body-dir.json'), $bodyDir, [Text.UTF8Encoding]::new($false))

function Status($desc, $expected, $actual) {
  $ok = if ($expected -is [array]) { $expected -contains $actual } else { $actual -eq $expected }
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Output ("[{0}] {1} (expect {2}, got {3})" -f $mark, $desc, ($expected -join '/'), $actual)
  if (-not $ok) { $script:failures++ }
}

Write-Output '=== 1. 初始化与登录 ==='

$r = curl.exe -s "$base/api/auth/status"
Write-Output "status: $r"
Status 'needsSetup=true' $true (($r | ConvertFrom-Json).needsSetup)

$code = curl.exe -s -o NUL -w "%{http_code}" "$base/api/tree"
Status '未登录访问 /api/tree -> 401' 401 $code

$r = curl.exe -s -c $cj -H "Content-Type: application/json" -d "@$tmp/body-setup.json" "$base/api/auth/setup"
Write-Output "setup 响应: $r"
Status '创建管理员账号' $true (($r | ConvertFrom-Json).ok)

$code = curl.exe -s -o NUL -w "%{http_code}" -H "Content-Type: application/json" -d "@$tmp/body-login-bad.json" "$base/api/auth/login"
Status '错误密码登录 -> 401' 401 $code

Remove-Item $cj -ErrorAction SilentlyContinue
$code = curl.exe -s -o NUL -w "%{http_code}" -c $cj -H "Content-Type: application/json" -d "@$tmp/body-login-ok.json" "$base/api/auth/login"
Status '正确密码登录 -> 200' 200 $code

$cookieDump = curl.exe -s -b $cj "$base/api/auth/me"
Status '/api/auth/me 返回用户' $true (($cookieDump | ConvertFrom-Json).user.username -eq 'admin')

$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/auth/me"
Status '/api/auth/me -> 200' 200 $code

Write-Output ''
Write-Output '=== 2. 路径穿越防护 ==='

$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/file?path=../data/users.json"
Status '穿越 ../data/users.json -> 400' 400 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/file?path=..%2f..%2fetc%2fpasswd"
Status '穿越编码 ..%2f..%2fetc%2fpasswd -> 400' 400 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/file?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd"
Status '穿越点号编码 -> 400' 400 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/file?path=2024/..%2f..%2fdata%2fusers.json"
Status '混合穿越 2024/../.. -> 400' 400 $code

Write-Output ''
Write-Output '=== 3. 上传 ==='

$r = curl.exe -s -b $cj -F "path=2024/note1.md" -F "overwrite=1" -F "file=@$tmp/2024/note1.md" "$base/api/upload"
Status '上传 note1 -> ok' $true (($r | ConvertFrom-Json).ok)

$r = curl.exe -s -b $cj -F "path=2024/assets/pic.png" -F "overwrite=1" -F "file=@$tmp/2024/assets/pic.png" "$base/api/upload"
Status '上传 pic.png -> ok' $true (($r | ConvertFrom-Json).ok)

$r = curl.exe -s -b $cj -F "path=note2.md" -F "overwrite=1" -F "file=@$tmp/note2.md" "$base/api/upload"
Status '上传 note2 -> ok' $true (($r | ConvertFrom-Json).ok)

Write-Output ''
Write-Output '=== 4. 目录树与读取 ==='

$tree = (curl.exe -s -b $cj "$base/api/tree") | ConvertFrom-Json
Status 'tree 包含 2024 目录' $true ([bool]($tree.children | Where-Object { $_.name -eq '2024' }))
Status 'tree 包含 note2.md' $true ([bool]($tree.children | Where-Object { $_.name -eq 'note2.md' }))
$dir2024 = $tree.children | Where-Object { $_.name -eq '2024' }
Status '2024 含 note1.md' $true ([bool]($dir2024.children | Where-Object { $_.name -eq 'note1.md' }))
Status '2024 含 assets 目录' $true ([bool]($dir2024.children | Where-Object { $_.name -eq 'assets' }))

$content = (curl.exe -s -b $cj "$base/api/file?path=2024/note1.md") -join "`n"
Status '读取 note1 内容正确' $true ($content -like '*我的第一篇笔记*')

$ct = curl.exe -s -o NUL -w "%{content_type}" -b $cj "$base/api/file?path=2024/assets/pic.png"
Write-Output "pic content-type: $ct"
Status '图片 content-type 为 image/png' $true ($ct -like 'image/png*')

Write-Output ''
Write-Output '=== 5. 冲突策略 ==='

$r = curl.exe -s -b $cj -F "path=note2.md" -F "overwrite=0" -F "file=@$tmp/note2.md" "$base/api/upload"
$ren = ($r | ConvertFrom-Json).files[0]
Write-Output "keepboth: renamed=$($ren.renamed) rel=$($ren.rel)"
Status '冲突且保留两者 -> 改名' $true ([bool]$ren.renamed)
Status '改名后含 (1) 后缀' $true ($ren.rel -match '\(1\)')

$r = curl.exe -s -b $cj -F "path=note2.md" -F "overwrite=1" -F "file=@$tmp/note2.md" "$base/api/upload"
$conf = ($r | ConvertFrom-Json).files[0]
Status '冲突且覆盖 -> conflict=true' $true ([bool]$conf.conflict)

Write-Output ''
Write-Output '=== 6. 文件夹操作 ==='

$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj -H "Content-Type: application/json" -d "@$tmp/body-dir.json" "$base/api/dir"
Status '新建文件夹(中文名) -> 200' 200 $code

$dirName = [uri]::EscapeDataString('新笔记')
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj -X DELETE "$base/api/file?path=2024/$dirName"
Status '删除文件夹 -> 200' 200 $code

Write-Output ''
Write-Output '=== 7. ZIP 下载 ==='

curl.exe -s -b $cj -o "$tmp/dl.zip" "$base/api/zip?path=2024"
$zipOk = (Test-Path "$tmp/dl.zip") -and ((Get-Item "$tmp/dl.zip").Length -gt 100)
Status 'ZIP 下载成功且非空' $true $zipOk

$code = curl.exe -s -o NUL -w "%{http_code}" "$base/api/zip?path=2024"
Status '未登录 ZIP -> 401' 401 $code

Write-Output ''
Write-Output '=== 8. 角色权限（游客） ==='

# 管理员创建游客账号
$bodyGuest = '{"username":"guest01","password":"guestpass123"}'
[IO.File]::WriteAllText((Join-Path $tmp 'body-guest.json'), $bodyGuest, [Text.UTF8Encoding]::new($false))
$r = curl.exe -s -b $cj -H "Content-Type: application/json" -d "@$tmp/body-guest.json" "$base/api/auth/users"
$guestRole = ($r | ConvertFrom-Json).user.role
Status '管理员创建游客账号 (role=guest)' 'guest' $guestRole

# 未登录访问用户管理
$code = curl.exe -s -o NUL -w "%{http_code}" "$base/api/auth/users"
Status '未登录访问用户管理 -> 401' 401 $code

# 游客登录（独立 cookie）
$cjg = Join-Path $tmp 'cookies-guest.txt'
Remove-Item $cjg -ErrorAction SilentlyContinue
$code = curl.exe -s -o NUL -w "%{http_code}" -c $cjg -H "Content-Type: application/json" -d "@$tmp/body-guest.json" "$base/api/auth/login"
Status '游客登录 -> 200' 200 $code
$r = curl.exe -s -b $cjg "$base/api/auth/me"
Status 'me 返回游客角色' 'guest' (($r | ConvertFrom-Json).user.role)

# 已登录游客访问用户管理仍被拒绝
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/auth/users"
Status '游客访问用户管理 -> 403' 403 $code

# 游客可看目录树与在线读取
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/tree"
Status '游客查看目录树 -> 200' 200 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/file?path=2024/note1.md"
Status '游客在线读取笔记 -> 200' 200 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/file?path=2024/assets/pic.png"
Status '游客在线查看图片 -> 200' 200 $code

# 游客禁止：上传/下载/打包/建目录/删除
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg -F "path=g.md" -F "overwrite=1" -F "file=@$tmp/2024/note1.md" "$base/api/upload"
Status '游客上传 -> 403' 403 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/file?path=2024/note1.md&download=1"
Status '游客下载文件 -> 403' 403 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/zip?path=2024"
Status '游客打包下载 -> 403' 403 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg -H "Content-Type: application/json" -d "@$tmp/body-dir.json" "$base/api/dir"
Status '游客新建文件夹 -> 403' 403 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg -X DELETE "$base/api/file?path=2024/note1.md"
Status '游客删除 -> 403' 403 $code

# 管理员删除游客后其会话立即失效
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj -X DELETE "$base/api/auth/users/guest01"
Status '管理员删除游客 -> 200' 200 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cjg "$base/api/tree"
Status '被删游客会话立即失效 -> 401' 401 $code

Write-Output ''
Write-Output '=== 9. 安全：跨站与限流 ==='

$code = curl.exe -s -o NUL -w "%{http_code}" -H "Origin: http://evil.example.com" -H "Content-Type: application/json" -d "@$tmp/body-dir.json" "$base/api/dir"
Status '跨站 Origin -> 403' 403 $code

$last = 0
for ($i = 0; $i -lt 6; $i++) {
  $bad = '{"username":"admin","password":"badpass' + $i + '"}'
  [IO.File]::WriteAllText((Join-Path $tmp 'body-bad.json'), $bad, [Text.UTF8Encoding]::new($false))
  $last = curl.exe -s -o NUL -w "%{http_code}" -H "Content-Type: application/json" -d "@$tmp/body-bad.json" "$base/api/auth/login"
}
Status '连续错误登录 -> 限流 429' 429 $last

Write-Output ''
Write-Output '=== 10. 登出 ==='

$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj -c $cj -X POST "$base/api/auth/logout"
Status '登出 -> 200' 200 $code
$code = curl.exe -s -o NUL -w "%{http_code}" -b $cj "$base/api/tree"
Status '登出后访问 -> 401' 401 $code

Write-Output ''
Write-Output '=== 11. 前端页面与静态资源 ==='

$code = curl.exe -s -o NUL -w "%{http_code}" "$base/"
Status '首页 -> 200' 200 $code
$html = (curl.exe -s "$base/") -join "`n"
Status '首页包含 NoteCloud' $true ($html -like '*NoteCloud*')
foreach ($v in @('vendor/marked.min.js', 'vendor/purify.min.js', 'vendor/highlight.common.js', 'vendor/highlight-github.css', 'style.css', 'app.js')) {
  $c = curl.exe -s -o NUL -w "%{http_code}" "$base/$v"
  Status "$v -> 200" 200 $c
}

# ZIP 内容校验
$zipCheck = Join-Path $tmp 'zipcheck'
Remove-Item $zipCheck -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path (Join-Path $tmp 'dl.zip') -DestinationPath $zipCheck -Force
$zipFiles = Get-ChildItem $zipCheck -Recurse -File | ForEach-Object { $_.FullName.Substring($zipCheck.Length + 1) }
Status 'ZIP 含 note1.md' $true ($zipFiles -contains '2024\note1.md' -or $zipFiles -contains '2024/note1.md')
Status 'ZIP 含 assets/pic.png' $true ([bool]($zipFiles | Where-Object { $_ -like '*pic.png' }))

Write-Output ''
if ($script:failures -eq 0) { Write-Output '== ALL TESTS PASSED ==' } else { Write-Output "== $($script:failures) TESTS FAILED ==" }
exit $script:failures
