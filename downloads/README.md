# MechPro Windows downloads

Installer binaries are **not** committed to git. They are published by GitHub Actions on every push to `main` (workflow: `windows-desktop.yml`):

- `MechPro-Setup-1.0.0.exe` — NSIS installer (built on `windows-latest`)
- `MechPro-Setup-1.0.0.zip` — portable zip (same build)

Public URLs (after publish):

- https://www.yourcarguy806.com/downloads/MechPro-Setup-1.0.0.exe
- https://www.yourcarguy806.com/downloads/MechPro-Setup-1.0.0.zip

GitHub Release (updated on each successful `main` build):

- https://github.com/tinytim3271-wq/mechpro-dispatch/releases/tag/desktop-v1.0.0

Manual publish (requires AWS credentials with access to the site bucket):

```bash
aws s3 cp dist/windows/MechPro-Setup-1.0.0.exe s3://<site-bucket>/downloads/MechPro-Setup-1.0.0.exe --content-type application/octet-stream
aws s3 cp dist/windows/MechPro-Setup-1.0.0.zip s3://<site-bucket>/downloads/MechPro-Setup-1.0.0.zip --content-type application/zip
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/downloads/*"
```
