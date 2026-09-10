# 用无头 Chrome 截 4 张图到 .shots/，供 build/test-site.mjs 的 D / E / G 组回读。
#
# 为什么验收要靠截图：本机无头 Chrome 的 stdout / stderr 恒为 0 字节，任何
# console.log 都取不回来。所以 selftest.html / sitetest.html 把每条断言画成
# 40x40 的 LED 色块（白=对齐基准、绿=通过、红=失败、蓝=终止符），
# test-site.mjs 手工解码 PNG（zlib inflate + 逐行反滤波）把结论读回来。
# 读不到蓝色终止符就说明页面脚本中途崩了 —— 这条本身就是断言之一。
#
# 用法:  pwsh -File build/shoot.ps1   然后   node build/test-site.mjs

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$shots = Join-Path $root '.shots'
$prof  = Join-Path $root '.chrome-profile'
$site  = 'file:///' + ((Join-Path $root 'site') -replace '\\', '/')

# 依次探测常见安装位置；Chrome 与 Edge 都是 Chromium，参数通用
$browser = @(
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
  "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $browser) { throw '找不到 Chrome / Edge，请把浏览器路径写进本脚本的 $browser 列表' }
"浏览器: $browser"
"站点  : $site"

New-Item -ItemType Directory -Force -Path $shots | Out-Null
# 每次都用全新的用户数据目录：残留的 localStorage 会让"首次启动"类断言失真
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue

# 输出名, 窗口尺寸, 目标页, 是否需要 --allow-file-access-from-files
# 最后一项：selftest/sitetest 用 iframe 加载同目录页面，file:// 下默认被当作跨源拒绝
$jobs = @(
  @('quiz.png',     '1280,1900', 'index.html',    $false),
  @('handout.png',  '1400,900',  'handout.html',  $false),
  @('selftest.png', '1400,400',  'selftest.html', $true),
  # sitetest 的宽度必须容得下整条 LED：约 40 格 x 40px，窄了会截掉蓝色终止符，
  # 于是"读到终止符"这条断言假失败 —— 加断言时记得同步加宽。
  @('sitetest.png', '2200,400',  'sitetest.html', $true)
)

foreach ($j in $jobs) {
  $cargs = @(
    "--user-data-dir=$prof", '--headless=old', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1', "--window-size=$($j[1])",
    '--virtual-time-budget=15000', "--screenshot=$(Join-Path $shots $j[0])", "$site/$($j[2])"
  )
  if ($j[3]) { $cargs = @('--allow-file-access-from-files') + $cargs }
  $p = Start-Process -FilePath $browser -ArgumentList $cargs -Wait -PassThru -NoNewWindow
  $f = Get-Item (Join-Path $shots $j[0]) -ErrorAction SilentlyContinue
  '{0,-14} exit={1}  {2}' -f $j[0], $p.ExitCode, $(if ($f) { '{0,9:N0} bytes' -f $f.Length } else { '未生成' })
}

Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
"`n截图完成。接着跑: node build/test-site.mjs"
