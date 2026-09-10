!macro NSIS_HOOK_POSTUNINSTALL
  ; Aster-managed third-party runtimes and blocked staging files must not survive
  ; a full uninstall. User blueprints, saves and installed community mods remain.
  RMDir /r "$LOCALAPPDATA\dev.aster.launcher\managed-runtimes"
  RMDir /r "$LOCALAPPDATA\dev.aster.launcher\security\quarantine"
  RMDir /r "$LOCALAPPDATA\Aster Launcher\managed-runtimes"
  RMDir /r "$LOCALAPPDATA\Aster Launcher\security\quarantine"
!macroend
