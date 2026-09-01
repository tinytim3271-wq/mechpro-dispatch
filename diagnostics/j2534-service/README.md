# J2534 Pass-Thru Host (Windows)

Native JSON-RPC named-pipe service used by the MechPro Windows desktop app for Dodge/Ram OEM diagnostics.

## Architecture

```
MechPro Electron → J2534.Host.exe (named pipe) → vendor J2534 DLL → USB adapter → vehicle CAN
```

## Build (Windows or Linux cross-publish)

```bash
# Linux / CI
./scripts/publish-win-x64.sh

# Windows PowerShell
./scripts/publish-win-x64.ps1
```

Output: `publish/win-x64/J2534.Host.exe` (self-contained .NET 8, win-x64).

## Requirements

- .NET 8 SDK
- Windows 10/11 x64 at runtime
- Vendor J2534 driver installed (`HKLM\SOFTWARE\PassThruSupport.04.04`)
- USB J2534 Pass-Thru adapter

## Simulator

Pass `adapterId: "simulator"` to use the bench ECU without hardware. Real adapters are enumerated from the Windows registry.

## Electron packaging

The Windows installer bundles `publish/win-x64/J2534.Host.exe` via `electron-builder` `extraResources`. Build the host **before** `npm run build:windows`.
