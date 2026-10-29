!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
Var YuiPageDialog
Var YuiPageBackground
Var YuiTitleFont
Var YuiHeadingFont
Var YuiBodyFont
Var YuiSmallFont
Var YuiPanel
Var YuiLabel

!macro customWelcomePage
  Page custom YuiWelcomePage YuiWelcomeLeave
!macroend

!macro customPageAfterChangeDir
  Page custom YuiReadyPage YuiReadyLeave
!macroend

Function YuiSetNextButtonText
  Pop $0
  GetDlgItem $1 $HWNDPARENT 1
  SendMessage $1 ${WM_SETTEXT} 0 "STR:$0"
FunctionEnd

Function YuiWelcomePage
  nsDialogs::Create 1018
  Pop $YuiPageDialog
  ${If} $YuiPageDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 100% ""
  Pop $YuiPageBackground
  SetCtlColors $YuiPageBackground "111116" "111116"

  CreateFont $YuiTitleFont "Segoe UI" 11 700
  CreateFont $YuiHeadingFont "Segoe UI" 21 700
  CreateFont $YuiBodyFont "Segoe UI" 10 400
  CreateFont $YuiSmallFont "Segoe UI" 8 400

  ${NSD_CreateLabel} 20u 18u 260u 26u "Yui"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "C4B3FF" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiTitleFont 1

  ${NSD_CreateLabel} 20u 57u 270u 18u "PERSONAL LANGUAGE STUDIO"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "A7A2B5" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  ${NSD_CreateLabel} 20u 86u 285u 36u "A better way"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "F5F3FA" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiHeadingFont 1

  ${NSD_CreateLabel} 20u 121u 285u 36u "to remember."
  Pop $YuiLabel
  SetCtlColors $YuiLabel "F5F3FA" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiHeadingFont 1

  ${NSD_CreateLabel} 22u 173u 270u 24u "Your personal space for learning."
  Pop $YuiLabel
  SetCtlColors $YuiLabel "C4B3FF" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiBodyFont 1

  ${NSD_CreateLabel} 22u 207u 270u 40u "Build a steady study rhythm with a calm, focused workspace."
  Pop $YuiLabel
  SetCtlColors $YuiLabel "A7A2B5" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  ; Reserved illustration panel. The page remains complete when no character artwork is supplied.
  ${NSD_CreateLabel} 326u 23u 155u 216u ""
  Pop $YuiPanel
  SetCtlColors $YuiPanel "191820" "191820"

  ${NSD_CreateLabel} 347u 73u 113u 74u "結"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "9B7BFF" "191820"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiHeadingFont 1

  ${NSD_CreateLabel} 346u 174u 116u 18u "YUI  /  STUDY"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "C4B3FF" "191820"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  ${NSD_CreateLabel} 20u 247u 280u 15u "VERSION ${VERSION}"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "716C7D" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  Push "Continue"
  Call YuiSetNextButtonText
  nsDialogs::Show
FunctionEnd

Function YuiWelcomeLeave
FunctionEnd

Function YuiReadyPage
  nsDialogs::Create 1018
  Pop $YuiPageDialog
  ${If} $YuiPageDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 100% ""
  Pop $YuiPageBackground
  SetCtlColors $YuiPageBackground "111116" "111116"

  CreateFont $YuiHeadingFont "Segoe UI" 20 700
  CreateFont $YuiBodyFont "Segoe UI" 10 400
  CreateFont $YuiSmallFont "Segoe UI" 8 400

  ${NSD_CreateLabel} 24u 34u 440u 34u "Ready to install Yui"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "F5F3FA" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiHeadingFont 1

  ${NSD_CreateLabel} 26u 91u 432u 26u "Your learning workspace is ready to be set up."
  Pop $YuiLabel
  SetCtlColors $YuiLabel "C4B3FF" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiBodyFont 1

  ${NSD_CreateLabel} 26u 135u 432u 42u "The installer will add Yui and create the shortcuts you selected. Your existing Yui data will remain untouched."
  Pop $YuiLabel
  SetCtlColors $YuiLabel "A7A2B5" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  ${NSD_CreateLabel} 26u 203u 432u 24u "INSTALL  /  YUI DESKTOP ${VERSION}"
  Pop $YuiLabel
  SetCtlColors $YuiLabel "9B7BFF" "111116"
  SendMessage $YuiLabel ${WM_SETFONT} $YuiSmallFont 1

  Push "Install Yui"
  Call YuiSetNextButtonText
  nsDialogs::Show
FunctionEnd

Function YuiReadyLeave
FunctionEnd
!endif

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "Remove Yui"
  !define MUI_UNWELCOMEPAGE_TEXT "Yui will be removed from this computer. Your database and personal settings will be kept."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
