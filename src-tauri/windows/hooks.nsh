; NSIS Installer Hooks for Local Minutes
; Visual C++ Redistributable の自動インストール

!macro NSIS_HOOK_POSTINSTALL
  ; Check if Visual C++ 2015-2022 Redistributable is installed
  ReadRegDWord $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 == 1
    DetailPrint "Visual C++ Redistributable already installed"
    Goto vcredist_done
  ${EndIf}

  ; Install from bundled EXE if not installed
  ${If} ${FileExists} "$INSTDIR\resources\vc_redist.x64.exe"
    DetailPrint "Installing Visual C++ Redistributable..."
    CopyFiles "$INSTDIR\resources\vc_redist.x64.exe" "$TEMP\vc_redist.x64.exe"
    ExecWait '"$TEMP\vc_redist.x64.exe" /install /passive /norestart' $0

    ${If} $0 == 0
      DetailPrint "Visual C++ Redistributable installed successfully"
    ${ElseIf} $0 == 1638
      ; 1638 = already installed (newer version)
      DetailPrint "Visual C++ Redistributable: newer version already present"
    ${ElseIf} $0 == 3010
      ; 3010 = success, reboot required
      DetailPrint "Visual C++ Redistributable installed (reboot may be needed)"
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Visual C++ Redistributable のインストールに失敗しました (code=$0)。$\nバックエンド機能が正常に動作しない可能性があります。$\n$\nhttps://aka.ms/vs/17/release/vc_redist.x64.exe$\nから手動でインストールしてください。"
    ${EndIf}

    ; Clean up
    Delete "$TEMP\vc_redist.x64.exe"
    Delete "$INSTDIR\resources\vc_redist.x64.exe"
  ${Else}
    DetailPrint "vc_redist.x64.exe not found in resources, skipping VC++ install"
  ${EndIf}

  vcredist_done:
!macroend
