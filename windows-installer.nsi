Unicode True
Name "MechPro"
Caption "MechPro Setup"
OutFile "dist\windows\MechPro-Setup-1.0.0-current.exe"
InstallDir "$PROGRAMFILES64\MechPro"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "MechPro"
  SetOutPath "$INSTDIR"
  File /r "dist\windows\win-unpacked-current\*"
  CreateDirectory "$SMPROGRAMS\MechPro"
  CreateShortCut "$DESKTOP\MechPro.lnk" "$INSTDIR\MechPro.exe"
  CreateShortCut "$SMPROGRAMS\MechPro\MechPro.lnk" "$INSTDIR\MechPro.exe"
  CreateShortCut "$SMPROGRAMS\MechPro\Uninstall MechPro.lnk" "$INSTDIR\Uninstall.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "DisplayName" "MechPro"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "DisplayVersion" "1.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "Publisher" "MechPro"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\MechPro.lnk"
  Delete "$SMPROGRAMS\MechPro\MechPro.lnk"
  Delete "$SMPROGRAMS\MechPro\Uninstall MechPro.lnk"
  RMDir "$SMPROGRAMS\MechPro"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MechPro"
SectionEnd
