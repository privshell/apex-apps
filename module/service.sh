#!/system/bin/sh
# APEX // APPS - boot service
MODDIR=${0%/*}
rm -rf /data/adb/apex/cache/.lock 2>/dev/null
sh "$MODDIR/apex.sh" boot >/dev/null 2>&1
nohup sh "$MODDIR/apex.sh" daemon >/dev/null 2>&1 &
