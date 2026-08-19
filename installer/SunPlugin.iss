; Sun Plugin — Inno Setup installer script
; Produces SunPluginSetup.exe that installs the CEP extension for Premiere Pro.
;
; Installs to: %APPDATA%\Adobe\CEP\extensions\com.sunplugin.premiere\
; Creates:     %USERPROFILE%\Documents\Sun Plugin\ (library root)
; Sets:        HKCU\Software\Adobe\CSXS.* PlayerDebugMode=1 (for unsigned ext)

#define MyAppName "Sun Plugin"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Sun Plugin"
#define MyAppURL "https://sunplugin.com"
#define ExtensionId "com.sunplugin.premiere"

[Setup]
AppId={{B5F8C3D1-7E4A-4B9F-A2D6-1C3E5F8B9D2A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#ExtensionId}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; No license page — skip straight to install
LicenseFile=
; Output settings
OutputDir=Output
OutputBaseFilename=SunPluginSetup
; Use LZMA2 for best compression
Compression=lzma2/ultra64
SolidCompression=yes
; Appearance
WizardStyle=modern
; Icon — use the 256px icon if available
SetupIconFile=sun-plugin.ico
; Don't require admin — CEP extensions install per-user
PrivilegesRequired=lowest
; Architecture
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Uninstall
Uninstallable=yes
UninstallDisplayIcon={app}\icons\icon-48.png
UninstallDisplayName={#MyAppName} for Premiere Pro

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This will install {#MyAppName} v{#MyAppVersion} as an extension for Adobe Premiere Pro.%n%nThe extension will appear under Window > Extensions > Sun Library.%n%nPlease close Premiere Pro before continuing.

[Files]
; Copy the entire built extension
Source: "..\build\com.sunplugin.premiere\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Create the library folder structure in Documents
Name: "{userdocs}\Sun Plugin"
Name: "{userdocs}\Sun Plugin\Library"
Name: "{userdocs}\Sun Plugin\Library\MOGRT"
Name: "{userdocs}\Sun Plugin\Library\SFX"
Name: "{userdocs}\Sun Plugin\Library\Music"
Name: "{userdocs}\Sun Plugin\Library\Transitions"
Name: "{userdocs}\Sun Plugin\Library\LUTs"
Name: "{userdocs}\Sun Plugin\Library\Presets"
Name: "{userdocs}\Sun Plugin\Library\Captions"
Name: "{userdocs}\Sun Plugin\Library\Overlays"
Name: "{userdocs}\Sun Plugin\Library\Effects"
Name: "{userdocs}\Sun Plugin\Library\Guides"
Name: "{userdocs}\Sun Plugin\Library\Templates"
Name: "{userdocs}\Sun Plugin\db"
Name: "{userdocs}\Sun Plugin\cache"
Name: "{userdocs}\Sun Plugin\cache\thumbs"
Name: "{userdocs}\Sun Plugin\cache\previews"

[Registry]
; Enable debug mode for unsigned CEP extensions.
; Required because we don't have a code-signing certificate.
; Set for multiple CSXS versions to cover different Premiere Pro versions.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist

[Run]
; Optionally open Premiere Pro after install
Filename: "{code:GetPremierePath}"; Description: "Launch Adobe Premiere Pro"; Flags: nowait postinstall skipifsilent unchecked

[UninstallDelete]
; Clean up the extension directory fully on uninstall
Type: filesandordirs; Name: "{app}"

[Code]
// Try to find Premiere Pro executable for the post-install launch option.
function GetPremierePath(Param: String): String;
var
  BasePath: String;
begin
  // Common install locations
  BasePath := ExpandConstant('{pf}') + '\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe';
  if FileExists(BasePath) then begin
    Result := BasePath;
    Exit;
  end;

  BasePath := ExpandConstant('{pf}') + '\Adobe\Adobe Premiere Pro 2025\Adobe Premiere Pro.exe';
  if FileExists(BasePath) then begin
    Result := BasePath;
    Exit;
  end;

  BasePath := ExpandConstant('{pf}') + '\Adobe\Adobe Premiere Pro 2024\Adobe Premiere Pro.exe';
  if FileExists(BasePath) then begin
    Result := BasePath;
    Exit;
  end;

  // Fallback — user can launch manually
  Result := '';
end;

// Check if Premiere Pro is running and warn the user.
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;

  // Check if Premiere Pro is running
  if Exec('tasklist', '/FI "IMAGENAME eq Adobe Premiere Pro.exe" /NH', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    // Just proceed — the warning in the welcome message should be enough.
  end;
end;
