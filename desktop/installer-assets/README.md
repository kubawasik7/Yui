# Yui NSIS installer assets

The Windows installer uses `electron-builder`'s assisted NSIS flow and the project-local `installer.nsh` include. Its welcome and ready pages use dark graphite surfaces, violet accents, English copy, and the version from `desktop/package.json`. Folder selection, install progress, shortcuts, the default finish-page launch option, and preservation of `%APPDATA%\Yui` on uninstall remain enabled.

The illustration area on the right side of the welcome page is intentionally reserved and currently shows the Yui `結` mark. There is no original character illustration in this repository, so the installer does not reference or bundle a missing image. To fill that area later, supply an original image as a **24-bit RGB BMP, approximately 220 × 300 px**, with a dark `#191820` background (BMP does not support alpha). Keep the character centered in the crop and avoid embedded text. The artwork should fit the right-side panel without touching its edges.

`generate-branding.ps1` recreates the small 150 × 57 px header and 164 × 314 px sidebar BMP assets in this folder. Those are abstract Yui branding graphics, not substitutes for the character art.

From `desktop/`, build the Windows installer with:

```powershell
npm run build:windows
```
