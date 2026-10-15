# APEX // APPS

An app manager for rooted Android, shipped as a KernelSU module with a full WebUI. Reviewing preinstalled apps, holding background apps down, tuning battery policy and backing apps up all live in one place, with every change recorded and reversible.

No companion app, no accessibility service, no Xposed module. The engine is a small shell script; the UI is the module's WebUI.

## Why another app manager
Existing tools each cover one piece: one lists apps, another freezes them, a third backs them up, and the debloat lists people pass around are plain text with no idea what your device needs.

| Pain point | APEX answer |
| --- | --- |
| Debloat lists that brick devices | Every package is matched against a built-in safety list and labelled Safe, Careful or Required. Required apps are refused, not just warned about |
| No way back after a bad batch | A snapshot is taken automatically before any batch change. Restoring only turns apps back on, so it can never make things worse |
| "Uninstall" that destroys data | Hide uses the reversible path: removed for this user, data untouched, one tap to bring it back |
| Background apps that drain overnight | Freeze stops an app now and again every time the screen goes off, with a delay so quick toggles do not kill what you were using |
| Hidden permissions nothing exposes | Run in background, wake lock, start at boot, clipboard, overlays, usage access and "install other apps", all per app |
| Battery settings buried in menus | Standby bucket and the Doze whitelist per app, in one row each |
| Dual apps and second space ignored | Each Android user is listed and handled separately |
| No record of what you changed | A journal of every change, with a one-tap undo of the last one |

## Features
- App list with search, filters (preinstalled, installed by you, changed) and safety filters
- Bulk selection with Freeze, Disable and Enable
- Review tab: preinstalled apps grouped by consequence, with bulk actions per group
- Three reversible states per app: Freeze, Disable, Hide
- Background permissions and battery policy per app
- Backups to `Download/APEX`, app files always, data optional
- Snapshots, automatic before batches and manual any time
- Change journal and undo
- Action button prints a summary of everything changed so far

## Safety model
Each package gets one of four labels:

| Label | Meaning |
| --- | --- |
| **Safe** | Only that feature goes away. Analytics, ad frameworks, preinstalled stubs and vendor extras. |
| **Careful** | Something visible stops working, such as the camera, clock or keyboard. The system stays fine. |
| **Required** | The system depends on it. APEX refuses to change its state; background permissions can still be adjusted. |
| **Unknown** | Not in the list, usually an app you installed yourself. |

The list lives in `module/lib/safety.txt`, one rule per line, longest match wins. Patterns ending in `*` match a prefix. Pull requests that correct or extend it are welcome; include the device and ROM you tested on.

## What each state does
| State | What happens | Reversible with |
| --- | --- | --- |
| Freeze | Force-stopped now, and again whenever the screen goes off | Unfreeze |
| Disable | Stays installed with its data, stops running, leaves the launcher | Enable |
| Hide | Removed for this user, all data kept on the device | Unhide |

Hide is `pm uninstall -k --user <id>`, the path Android itself uses, so `pm install-existing` brings the app back with its data. Nothing in APEX deletes an app's data or touches the system partition.

## Requirements
- KernelSU, KernelSU Next, SukiSU, BakaSU, APatch, or Magisk with a WebUI app
- Android 9 or newer

Some HyperOS and OneUI builds refuse to disable certain system apps whatever you do. APEX reports those as failures instead of pretending they worked.

## Install
Install from [KernelSU Modules](https://modules.kernelsu.org) or flash the ZIP from [Releases](https://github.com/kreza6173-pixel/apex-apps/releases) in your root manager, then open the WebUI from the module card.

Installing changes nothing on its own.

## CLI
```
sh /data/adb/modules/apex_apps/apex.sh <command>
```
`doctor`, `apps`, `detail <pkg>`, `classify <pkg>`, `ops <pkg>`, `setop <pkg> <OP> <mode>`, `bucket <pkg> <bucket>`, `doze <pkg> on|off`, `act <action> <pkg...>`, `undo`, `snap [name]`, `snaps`, `snapdiff <id>`, `snaprestore <id>`, `backup <pkg> [data]`, `backups`, `restore <file>`, `journal`, `summary`, `users`.

Set `APEX_USER` to work on another Android user:
```
APEX_USER=999 sh /data/adb/modules/apex_apps/apex.sh apps
```

## Files
Everything lives in `/data/adb/apex` and survives module updates.
- `settings.conf` settings
- `journal.log` every change, one line each
- `frozen.txt` frozen apps, `<package> <user>` per line
- `snapshots/<id>/` one snapshot
- Backups go to `/sdcard/Download/APEX`

## Notes
- Restoring app data across different Android versions often fails. The app files restore fine either way.
- Freezing an app you actually use will make its notifications late. Freeze is for apps you want running on your terms only.
- Pairs with [AEGIS // FIREWALL](https://github.com/kreza6173-pixel/aegis-firewall) if you also want per-app network rules.

## Releasing (maintainers)
Bump `version` and `versionCode` in `module/module.prop`, then run the **Release** workflow from the Actions tab (or push a `v*` tag). Copy `docs/release.yml` to `.github/workflows/release.yml` once to enable it.

## Support
APEX is free and open source, built in spare time. If it saved you time, you can [support the work with a small crypto donation](https://github.com/kreza6173-pixel/kreza6173-pixel/blob/main/DONATE.md) (USDT on TRC20, or USDC / SOL on Solana). Starring the repo or opening a clear issue helps just as much.

## License
MIT
