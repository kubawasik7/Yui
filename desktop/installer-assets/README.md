# Yui installation package assets

`installer.nsh` customizes the embedded Electron Builder NSIS engine. End users launch `Yui Setup.exe`, the separate frameless Electron installer UI configured in `electron-builder-installer.json`; the NSIS engine is bundled as an internal payload and launched silently to carry out installation and upgrades.

The custom UI uses an original CSS key-visual composition and the Yui `結` mark. No character illustration is included. See [`../installer-ui/README.md`](../installer-ui/README.md) for the future artwork slot and asset requirements.

`generate-branding.ps1` recreates the legacy NSIS header and sidebar bitmaps. The custom setup UI does not display those assets.

From `desktop/`, build the Windows setup app with:

```powershell
npm run build:windows
```
