; NSIS Installer Hooks for Local Minutes

; ============================================================
; PREINSTALL: 旧バイナリを強制削除してから新バイナリをコピーさせる
;
; PyInstaller ビルドのバイナリには Windows バージョンリソースが
; 含まれないため、NSIS のバージョン比較ロジックが同バージョン
; 再インストール時にファイルを上書きしないことがある。
; プロセスを終了してから旧ファイルを明示的に削除することで、
; 確実に最新バイナリが配置されるようにする。
; ============================================================
!macro NSIS_HOOK_PREINSTALL
  ; バックエンドとllama-serverのプロセスを強制終了
  nsExec::Exec 'taskkill /F /IM local-minutes-backend.exe'
  nsExec::Exec 'taskkill /F /IM llama-server.exe'
  ; プロセス終了後にファイルロックが解放されるまで待機
  Sleep 1500
  ; 旧バイナリを明示的に削除（NSISが確実に新バイナリをコピーするように）
  Delete "$INSTDIR\local-minutes-backend.exe"
  Delete "$INSTDIR\llama-server.exe"
!macroend

; ============================================================
; POSTINSTALL: Visual C++ Redistributable の自動インストール
; ============================================================
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
