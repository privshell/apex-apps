## APEX // APPS v1.0.0

First public release.

- Every preinstalled app is matched against a built-in safety list and labelled Safe, Careful or Required
- Apps the system depends on are refused outright, so a bad tap cannot break the boot
- Disable, hide (keeps all data) or freeze apps, one at a time or in bulk, per Android user
- Snapshots: a snapshot is taken automatically before any batch change, and restoring one only turns apps back on
- Review tab groups preinstalled apps by consequence, with bulk actions per group
- Background permissions per app: run in background, wake lock, start at boot, clipboard, overlays, usage access, installing other apps
- Battery policy per app: standby bucket and the Doze whitelist
- Backups to Download/APEX with the app files and, optionally, its data
- Dual apps and second space are handled as separate users
- A change journal with a one-tap undo of the last change
- Action button prints a summary of everything changed so far

Nothing is changed at install time. Requires a WebUI-capable root manager.
