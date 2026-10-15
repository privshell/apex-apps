#!/system/bin/sh
# APEX // APPS - installer
SKIPUNZIP=0
ui_print " "
ui_print "  APEX // APPS"
ui_print "  App manager for rooted Android"
ui_print " "
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/apex.sh" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/action.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
DATA=/data/adb/apex
mkdir -p "$DATA/snapshots" "$DATA/backups" "$DATA/cache"
[ -f "$DATA/settings.conf" ] || printf 'FREEZE_ON_SCREEN_OFF=0\nSCREEN_DELAY=60\nCONFIRM_RISKY=1\n' > "$DATA/settings.conf"
ui_print "- Checking environment..."
t=$(APEX_MODDIR="$MODPATH" sh "$MODPATH/apex.sh" doctor 2>/dev/null)
echo "$t" | grep -q '"pm":1' && ui_print "  [ok] package manager" || ui_print "  [!!] package manager not reachable"
echo "$t" | grep -q '"appops":1' && ui_print "  [ok] appops" || ui_print "  [--] appops unavailable"
echo "$t" | grep -q '"users":1' && ui_print "  [ok] multi-user support"
ui_print " "
ui_print "- Nothing is changed until you act in the WebUI."
ui_print "- Every change is recorded and can be undone."
ui_print " "
