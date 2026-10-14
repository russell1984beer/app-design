# Sets up this PowerShell window for Android builds. Use:  . .\scripts\android-env.ps1
# - Java 17 (React Native does not support Android Studio's bundled Java 25).
# - AVG's HTTPS scanning re-signs websites with its own root certificate, which Java does
#   not trust; plotwise-truststore.jks is Java's normal list plus that AVG root.

$env:JAVA_HOME = 'C:\dev\jdk-17'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;" +
  [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$trustStore = "$env:USERPROFILE\.gradle\plotwise-truststore.jks"
if (Test-Path $trustStore) {
  $env:JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStore=$trustStore -Djavax.net.ssl.trustStorePassword=changeit"
}
