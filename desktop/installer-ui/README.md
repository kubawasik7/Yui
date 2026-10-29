# Yui Setup

`Yui Setup.exe` is a separate, frameless Electron application with its own 16:9 HTML/CSS interface. It embeds the normal Electron Builder NSIS package and launches it silently after validating the chosen destination. NSIS still owns extraction, install registration, Start menu shortcut, upgrades, and the uninstaller. The wrapper shows an indeterminate activity indicator while that real installer process runs; it does not invent a percentage because the silent NSIS process does not expose reliable byte progress to the wrapper.

The right-hand key-visual area currently uses an original CSS composition built from the Yui palette and the `結` brand mark. No character illustration is included in the repository. If approved original Yui artwork is supplied later, place it at `desktop/installer-ui/assets/yui-key-visual.png`, use a transparent PNG in sRGB at 1024 × 1536 px (2:3 portrait), and keep the subject centered with a clear margin. The UI composition can then layer it into the existing key-visual panel without changing installer behavior. No absent image path is referenced by the current app.

The installer keeps user data under `%APPDATA%\Yui`; the NSIS uninstall option `deleteAppDataOnUninstall` remains disabled. The optional desktop shortcut is controlled by the setup UI and removed by the Yui uninstaller.
