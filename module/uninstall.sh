#!/system/bin/sh
# APEX // APPS - stop the daemon. Snapshots and backups in /data/adb/apex are kept,
# so a reinstall can still restore anything you changed.
pid=$(cat /data/adb/apex/cache/daemon.pid 2>/dev/null)
[ -n "$pid" ] && kill "$pid" 2>/dev/null
pkill -f "apex.sh daemon" 2>/dev/null
rm -rf /data/adb/apex/cache
