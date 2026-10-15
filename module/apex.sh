#!/system/bin/sh
# APEX // APPS - engine and CLI
# Usage: apex.sh <command> [args]   (run as root)

if [ -z "$APEX_SH" ]; then
  for b in /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox /data/adb/magisk/busybox; do
    [ -x "$b" ] && APEX_SH=1 ASH_STANDALONE=1 exec "$b" sh "$0" "$@"
  done
fi
export PATH="/system/bin:/system/xbin:/vendor/bin:/data/adb/ksu/bin:$PATH"

MODDIR="${APEX_MODDIR:-/data/adb/modules/apex_apps}"
DATA="${APEX_DATA:-/data/adb/apex}"
CACHE="$DATA/cache"
SNAPS="$DATA/snapshots"
BACKUPS="${APEX_BACKUPS:-/sdcard/Download/APEX}"
SETTINGS="$DATA/settings.conf"
JOURNAL="$DATA/journal.log"
FROZEN="$DATA/frozen.txt"
SAFETY="${APEX_SAFETY:-$MODDIR/lib/safety.txt}"
mkdir -p "$CACHE" "$SNAPS" 2>/dev/null
touch "$JOURNAL" "$FROZEN" 2>/dev/null

# ---------- helpers ----------
valid_pkg() { echo "$1" | grep -Eq '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$'; }
valid_user() { echo "$1" | grep -Eq '^[0-9]{1,3}$'; }
valid_name() { echo "$1" | grep -Eq '^[A-Za-z0-9_-]{1,32}$'; }
valid_op() { echo "$1" | grep -Eq '^[A-Z_]{3,40}$'; }
valid_mode() { case "$1" in allow | deny | ignore | default) return 0 ;; esac; return 1; }
valid_bucket() { case "$1" in active | working_set | frequent | rare | restricted) return 0 ;; esac; return 1; }
jstr() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
now() { date +%s; }

load_settings() {
  FREEZE_ON_SCREEN_OFF=0; SCREEN_DELAY=60; CONFIRM_RISKY=1
  [ -f "$SETTINGS" ] && . "$SETTINGS"
}
set_kv() {
  case "$1" in FREEZE_ON_SCREEN_OFF | SCREEN_DELAY | CONFIRM_RISKY) ;;
    *) echo '{"ok":false,"error":"unknown key"}'; return 1 ;; esac
  echo "$2" | grep -Eq '^[0-9]{1,5}$' || { echo '{"ok":false,"error":"bad value"}'; return 1; }
  touch "$SETTINGS"
  if grep -q "^$1=" "$SETTINGS"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$SETTINGS" > "$SETTINGS.t" && mv "$SETTINGS.t" "$SETTINGS"
  else echo "$1=$2" >> "$SETTINGS"; fi
  echo '{"ok":true}'
}
settings_json() {
  load_settings
  printf '{"FREEZE_ON_SCREEN_OFF":"%s","SCREEN_DELAY":"%s","CONFIRM_RISKY":"%s"}\n' \
    "$FREEZE_ON_SCREEN_OFF" "$SCREEN_DELAY" "$CONFIRM_RISKY"
}

lock_acquire() { n=0; while ! mkdir "$CACHE/.lock" 2>/dev/null; do n=$((n+1)); [ $n -gt 150 ] && rm -rf "$CACHE/.lock"; sleep 0.1; done; }
lock_release() { rmdir "$CACHE/.lock" 2>/dev/null; }

# Append one line to the journal: ts action pkg user detail
note() {
  echo "$(now) $1 $2 $3 $4" >> "$JOURNAL"
  if [ "$(wc -l < "$JOURNAL")" -gt 4000 ]; then
    tail -n 2000 "$JOURNAL" > "$JOURNAL.t" && mv "$JOURNAL.t" "$JOURNAL"
  fi
}

users() { pm list users 2>/dev/null | sed -n 's/.*UserInfo{\([0-9]*\):.*/\1/p' | tr '\n' ' ' | sed 's/ *$//'; }
cur_user() { echo "${APEX_USER:-0}"; }

doctor() {
  p=0; pm list packages >/dev/null 2>&1 && p=1
  a=0; cmd appops query-op RUN_IN_BACKGROUND allow >/dev/null 2>&1 && a=1
  [ "$a" = 0 ] && { appops get com.android.shell RUN_IN_BACKGROUND >/dev/null 2>&1 && a=1; }
  u=0; [ -n "$(users)" ] && u=1
  b=0; am get-standby-bucket com.android.shell >/dev/null 2>&1 && b=1
  d=0; dumpsys deviceidle whitelist >/dev/null 2>&1 && d=1
  t=0; command -v tar >/dev/null 2>&1 && t=1
  printf '{"pm":%s,"appops":%s,"users":%s,"bucket":%s,"doze":%s,"tar":%s,"sdk":"%s","device":"%s","users_list":"%s"}\n' \
    "$p" "$a" "$u" "$b" "$d" "$t" "$(getprop ro.build.version.sdk)" "$(jstr "$(getprop ro.product.device)")" "$(users)"
}

# ---------- safety classification ----------
# Writes "<level> <note>" for one package.
classify() {
  awk -v p="$1" '
    $1 ~ /^#/ || NF < 2 { next }
    {
      pat = $1; lvl = $2; note = ""
      for (i = 3; i <= NF; i++) note = note (i > 3 ? " " : "") $i
      hit = 0; plen = length(pat)
      if (pat ~ /\*$/) { base = substr(pat, 1, plen - 1); if (index(p, base) == 1) { hit = 1; plen = length(base) } }
      else if (p == pat) hit = 1
      if (hit && plen > best) { best = plen; bl = lvl; bn = note }
    }
    END { if (best) print bl, bn; else print "unknown", "" }' "$SAFETY"
}
is_keep() { [ "$(classify "$1" | cut -d' ' -f1)" = keep ]; }

# ---------- app listing ----------
# One JSON object per app for the given user.
apps_json() {
  u=$(cur_user); valid_user "$u" || u=0
  all="$CACHE/all.$u"; sys="$CACHE/sys.$u"; dis="$CACHE/dis.$u"; non="$CACHE/non.$u"
  pm list packages --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$all"
  pm list packages -s --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$sys"
  pm list packages -d --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$dis"
  # -u also reports packages that are not installed for this user. Whatever it lists
  # and the plain list does not = hidden, with its data still on the device.
  pm list packages -u --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$CACHE/withu.$u"
  comm -13 "$all" "$CACHE/withu.$u" > "$non"
  awk -v sysf="$sys" -v disf="$dis" -v nonf="$non" -v saf="$SAFETY" -v frz="$FROZEN" -v u="$u" '
    function level(p,   i, pat, plen, base, hit, best, bl, bn) {
      best = 0; bl = "unknown"; bn = ""
      for (i = 1; i <= NR_SAF; i++) {
        pat = SP[i]; hit = 0; plen = length(pat)
        if (substr(pat, plen) == "*") { base = substr(pat, 1, plen - 1); if (index(p, base) == 1) { hit = 1; plen = length(base) } }
        else if (p == pat) hit = 1
        if (hit && plen > best) { best = plen; bl = SL[i]; bn = SN[i] }
      }
      LV = bl; NT = bn
    }
    BEGIN {
      while ((getline l < sysf) > 0) SY[l] = 1
      while ((getline l < disf) > 0) DI[l] = 1
      while ((getline l < nonf) > 0) UN[l] = 1
      while ((getline l < frz) > 0) { split(l, f, " "); if (f[2] == u) FZ[f[1]] = 1 }
      n = 0
      while ((getline l < saf) > 0) {
        if (l ~ /^#/) continue
        c = split(l, f, " "); if (c < 2) continue
        n++; SP[n] = f[1]; SL[n] = f[2]; s = ""
        for (i = 3; i <= c; i++) s = s (i > 3 ? " " : "") f[i]
        SN[n] = s
      }
      NR_SAF = n
      printf "["
    }
    {
      p = $0
      st = "enabled"
      if (p in UN) st = "hidden"; else if (p in DI) st = "disabled"
      if (p in FZ && st != "hidden") st = "frozen"
      level(p)
      printf "%s{\"p\":\"%s\",\"sys\":%d,\"st\":\"%s\",\"lv\":\"%s\",\"note\":\"%s\"}", (k++ ? "," : ""), p, (p in SY) ? 1 : 0, st, LV, NT
    }
    END { print "]" }' "$all"
}

detail_json() {
  p=$1; u=$(cur_user); valid_pkg "$p" || { echo '{"error":"bad package"}'; return 1; }
  set -- $(classify "$p"); lv=$1; shift; nt="$*"
  ver=$(dumpsys package "$p" 2>/dev/null | sed -n 's/^ *versionName=//p' | head -n1)
  uid=$(dumpsys package "$p" 2>/dev/null | sed -n 's/^ *userId=\([0-9]*\).*/\1/p' | head -n1)
  tgt=$(dumpsys package "$p" 2>/dev/null | sed -n 's/^ *targetSdk=\([0-9]*\).*/\1/p' | head -n1)
  apk=$(pm path --user "$u" "$p" 2>/dev/null | sed -n 's/^package://p' | head -n1)
  inst=$(pm list packages -i --user "$u" "$p" 2>/dev/null | sed -n 's/.*installer=//p' | head -n1)
  bucket=$(am get-standby-bucket "$p" 2>/dev/null | tr -dc 'a-zA-Z0-9_')
  doze=0; dumpsys deviceidle whitelist 2>/dev/null | grep -q ",$p," && doze=1
  perms=$(dumpsys package "$p" 2>/dev/null | awk '/requested permissions:/{f=1;next} f && /^ *[a-z]+ [a-z]+:/{f=0} f && /permission/{n++} END{print n+0}')
  printf '{"p":"%s","level":"%s","note":"%s","version":"%s","uid":"%s","targetSdk":"%s","apk":"%s","installer":"%s","bucket":"%s","doze":%s,"perms":%s,"user":"%s"}\n' \
    "$(jstr "$p")" "$lv" "$(jstr "$nt")" "$(jstr "$ver")" "$uid" "$tgt" "$(jstr "$apk")" "$(jstr "$inst")" "$bucket" "$doze" "${perms:-0}" "$u"
}

# ---------- app ops ----------
OPS="RUN_IN_BACKGROUND RUN_ANY_IN_BACKGROUND WAKE_LOCK START_FOREGROUND INSTANT_APP_START_FOREGROUND BOOT_COMPLETED READ_CLIPBOARD WRITE_CLIPBOARD SYSTEM_ALERT_WINDOW GET_USAGE_STATS REQUEST_INSTALL_PACKAGES CHANGE_WIFI_STATE VIBRATE POST_NOTIFICATION"
ops_json() {
  p=$1; valid_pkg "$p" || { echo '[]'; return 1; }
  printf '['; s=""
  for o in $OPS; do
    v=$( (cmd appops get "$p" "$o" 2>/dev/null || appops get "$p" "$o" 2>/dev/null) | sed -n "s/.*$o: *\([a-z]*\).*/\1/p" | head -n1)
    [ -z "$v" ] && v=unknown
    printf '%s{"op":"%s","mode":"%s"}' "$s" "$o" "$v"; s=","
  done
  printf ']\n'
}
set_op() {
  p=$1; o=$2; m=$3
  valid_pkg "$p" && valid_op "$o" && valid_mode "$m" || { echo '{"ok":false,"error":"invalid arguments"}'; return 1; }
  if cmd appops set "$p" "$o" "$m" 2>/dev/null || appops set "$p" "$o" "$m" 2>/dev/null; then
    note appop "$p" "$(cur_user)" "$o=$m"; echo '{"ok":true}'
  else echo '{"ok":false,"error":"appops rejected this change"}'; return 1; fi
}
set_bucket() {
  p=$1; b=$2
  valid_pkg "$p" && valid_bucket "$b" || { echo '{"ok":false,"error":"invalid arguments"}'; return 1; }
  if am set-standby-bucket "$p" "$b" 2>/dev/null; then note bucket "$p" "$(cur_user)" "$b"; echo '{"ok":true}'
  else echo '{"ok":false,"error":"could not set the standby bucket"}'; return 1; fi
}
set_doze() {
  p=$1; valid_pkg "$p" || { echo '{"ok":false,"error":"bad package"}'; return 1; }
  case "$2" in
    on) dumpsys deviceidle whitelist "+$p" >/dev/null 2>&1 ;;
    off) dumpsys deviceidle whitelist "-$p" >/dev/null 2>&1 ;;
    *) echo '{"ok":false,"error":"on or off"}'; return 1 ;;
  esac
  note doze "$p" "$(cur_user)" "$2"; echo '{"ok":true}'
}

# ---------- snapshots ----------
# A snapshot records the current state of every app for one user, so any batch
# of changes can be put back exactly as it was.
# Current disabled / hidden sets for one user, into $CACHE/nd and $CACHE/nh.
state_now() {
  pm list packages -d --user "$1" 2>/dev/null | sed 's/^package://' | sort > "$CACHE/nd"
  pm list packages --user "$1" 2>/dev/null | sed 's/^package://' | sort > "$CACHE/np"
  pm list packages -u --user "$1" 2>/dev/null | sed 's/^package://' | sort > "$CACHE/nu"
  comm -13 "$CACHE/np" "$CACHE/nu" > "$CACHE/nh"
}

snap_create() {
  lbl=$1; valid_name "$lbl" || lbl="auto"
  u=$(cur_user); id="$(date +%Y%m%d-%H%M%S)-$lbl"
  d="$SNAPS/$id"; mkdir -p "$d" || { echo '{"ok":false}'; return 1; }
  echo "$u" > "$d/user"
  pm list packages --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$d/present"
  pm list packages -d --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$d/disabled"
  pm list packages -u --user "$u" 2>/dev/null | sed 's/^package://' | sort > "$CACHE/wu"
  comm -13 "$d/present" "$CACHE/wu" > "$d/hidden"
  cp "$FROZEN" "$d/frozen" 2>/dev/null
  printf '{"ok":true,"id":"%s","apps":%s}\n' "$id" "$(wc -l < "$d/present" | tr -d ' ')"
}
snaps_json() {
  printf '['; s=""
  for d in "$SNAPS"/*/; do
    [ -d "$d" ] || continue; n=$(basename "$d")
    printf '%s{"id":"%s","user":"%s","apps":%s,"disabled":%s,"hidden":%s}' "$s" "$n" \
      "$(cat "$d/user" 2>/dev/null || echo 0)" \
      "$(wc -l < "$d/present" 2>/dev/null | tr -d ' ')" \
      "$(wc -l < "$d/disabled" 2>/dev/null | tr -d ' ')" \
      "$(wc -l < "$d/hidden" 2>/dev/null | tr -d ' ')"
    s=","
  done
  printf ']\n'
}
# What would change if this snapshot were restored.
snap_diff() {
  valid_name "${1#*-*-}" >/dev/null 2>&1
  d="$SNAPS/$1"; [ -d "$d" ] || { echo '{"ok":false,"error":"no such snapshot"}'; return 1; }
  u=$(cat "$d/user" 2>/dev/null || echo 0)
  state_now "$u"
  printf '{"ok":true,"user":"%s","enable":[' "$u"
  # was fine then, disabled or hidden now -> restoring brings it back
  s=""; cat "$CACHE/nd" "$CACHE/nh" | sort -u | while read -r p; do
    [ -n "$p" ] || continue
    grep -qx "$p" "$d/disabled" 2>/dev/null && continue
    grep -qx "$p" "$d/hidden" 2>/dev/null && continue
    echo "$p"
  done | awk '{printf "%s\"%s\"", (n++ ? "," : ""), $0}'
  printf '],"disable":['
  cat "$d/disabled" "$d/hidden" 2>/dev/null | sort -u | while read -r p; do
    [ -n "$p" ] || continue
    grep -qx "$p" "$CACHE/nd" 2>/dev/null && continue
    grep -qx "$p" "$CACHE/nh" 2>/dev/null && continue
    echo "$p"
  done | awk '{printf "%s\"%s\"", (n++ ? "," : ""), $0}'
  printf ']}\n'
}
snap_restore() {
  d="$SNAPS/$1"; [ -d "$d" ] || { echo '{"ok":false,"error":"no such snapshot"}'; return 1; }
  lock_acquire
  u=$(cat "$d/user" 2>/dev/null || echo 0); valid_user "$u" || u=0
  ok=0; fail=0
  # bring back anything that is off now but was on in the snapshot
  state_now "$u"
  while read -r p; do
    [ -n "$p" ] && valid_pkg "$p" || continue
    grep -qx "$p" "$d/disabled" 2>/dev/null && continue
    grep -qx "$p" "$d/hidden" 2>/dev/null && continue
    if grep -qx "$p" "$CACHE/nh" 2>/dev/null; then
      pm install-existing --user "$u" "$p" >/dev/null 2>&1 && ok=$((ok+1)) || fail=$((fail+1))
    fi
    if grep -qx "$p" "$CACHE/nd" 2>/dev/null; then
      pm enable --user "$u" "$p" >/dev/null 2>&1 && ok=$((ok+1)) || fail=$((fail+1))
    fi
  done < "$(cat "$CACHE/nd" "$CACHE/nh" | sort -u > "$CACHE/off"; echo "$CACHE/off")"
  # put the frozen list back
  [ -f "$d/frozen" ] && cp "$d/frozen" "$FROZEN"
  note restore snapshot "$u" "$1 restored=$ok failed=$fail"
  lock_release
  printf '{"ok":true,"restored":%s,"failed":%s}\n' "$ok" "$fail"
}
snap_delete() {
  d="$SNAPS/$1"; case "$1" in */* | '' | .*) echo '{"ok":false}'; return 1 ;; esac
  [ -d "$d" ] || { echo '{"ok":false,"error":"no such snapshot"}'; return 1; }
  rm -rf "$d"; echo '{"ok":true}'
}

# ---------- state changes ----------
# disable: the app stays installed, stops running and disappears from the launcher
# hide:    removed for this user with its data kept, reversible with install-existing
# freeze:  force-stopped now and whenever the screen goes off, nothing else changes
act_one() { # action pkg user -> prints a result word
  a=$1; p=$2; u=$3
  valid_pkg "$p" || { echo badpkg; return 1; }
  valid_user "$u" || { echo baduser; return 1; }
  if is_keep "$p"; then echo protected; return 1; fi
  case "$a" in
    disable) pm disable-user --user "$u" "$p" >/dev/null 2>&1 && echo done || echo failed ;;
    enable) pm enable --user "$u" "$p" >/dev/null 2>&1 && echo done || echo failed ;;
    hide) pm uninstall -k --user "$u" "$p" >/dev/null 2>&1 && echo done || echo failed ;;
    unhide) pm install-existing --user "$u" "$p" >/dev/null 2>&1 && echo done || echo failed ;;
    freeze)
      am force-stop --user "$u" "$p" >/dev/null 2>&1
      grep -qx "$p $u" "$FROZEN" 2>/dev/null || echo "$p $u" >> "$FROZEN"
      echo done ;;
    unfreeze)
      awk -v p="$p" -v u="$u" '!($1 == p && $2 == u)' "$FROZEN" > "$FROZEN.t" && mv "$FROZEN.t" "$FROZEN"
      echo done ;;
    stop) am force-stop --user "$u" "$p" >/dev/null 2>&1 && echo done || echo failed ;;
    trim) pm trim-caches 999G >/dev/null 2>&1; echo done ;;
    *) echo unknown ;;
  esac
}
act() { # action pkg... (space separated), uses APEX_USER
  a=$1; shift
  case "$a" in disable | enable | hide | unhide | freeze | unfreeze | stop) ;;
    *) echo '{"ok":false,"error":"unknown action"}'; return 1 ;; esac
  u=$(cur_user); valid_user "$u" || u=0
  lock_acquire
  printf '{"ok":true,"action":"%s","results":[' "$a"; s=""
  for p in "$@"; do
    [ -n "$p" ] || continue
    r=$(act_one "$a" "$p" "$u")
    [ "$r" = done ] && note "$a" "$p" "$u" ok
    printf '%s{"p":"%s","r":"%s"}' "$s" "$(jstr "$p")" "$r"; s=","
  done
  printf ']}\n'
  lock_release
}
undo_last() { # revert the newest journal entry that can be reverted
  l=$(grep -E ' (disable|hide|freeze) ' "$JOURNAL" 2>/dev/null | tail -n1)
  [ -n "$l" ] || { echo '{"ok":false,"error":"nothing to undo"}'; return 1; }
  set -- $l
  case "$2" in disable) r=enable ;; hide) r=unhide ;; freeze) r=unfreeze ;; *) echo '{"ok":false}'; return 1 ;; esac
  res=$(act_one "$r" "$3" "$4")
  note "$r" "$3" "$4" undo
  printf '{"ok":true,"action":"%s","p":"%s","r":"%s"}\n' "$r" "$(jstr "$3")" "$res"
}

# ---------- backup ----------
backup_app() { # pkg [data]
  p=$1; valid_pkg "$p" || { echo '{"ok":false,"error":"bad package"}'; return 1; }
  u=$(cur_user); mkdir -p "$BACKUPS" 2>/dev/null
  ver=$(dumpsys package "$p" 2>/dev/null | sed -n 's/^ *versionName=//p' | head -n1 | tr -c 'A-Za-z0-9._-' '_')
  out="$BACKUPS/$p-${ver:-unknown}-$(date +%Y%m%d-%H%M%S)"
  tmp="$CACHE/bk"; rm -rf "$tmp"; mkdir -p "$tmp/apk"
  n=0
  pm path --user "$u" "$p" 2>/dev/null | sed 's/^package://' | while read -r a; do
    [ -f "$a" ] && cp "$a" "$tmp/apk/" 2>/dev/null
  done
  n=$(ls "$tmp/apk" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || { rm -rf "$tmp"; echo '{"ok":false,"error":"could not read the app files"}'; return 1; }
  dsz=0
  if [ "$2" = data ]; then
    for dd in "/data/data/$p" "/data/user/$u/$p"; do
      [ -d "$dd" ] && { tar -cf "$tmp/data.tar" -C "$(dirname "$dd")" "$(basename "$dd")" 2>/dev/null; break; }
    done
    [ -f "$tmp/data.tar" ] && dsz=$(wc -c < "$tmp/data.tar")
  fi
  printf 'package=%s\nversion=%s\nuser=%s\ncreated=%s\nsplits=%s\ndata=%s\n' "$p" "$ver" "$u" "$(now)" "$n" "$([ "$dsz" -gt 0 ] && echo 1 || echo 0)" > "$tmp/apex-backup.prop"
  if tar -czf "$out.tar.gz" -C "$tmp" . 2>/dev/null; then
    rm -rf "$tmp"; note backup "$p" "$u" "$(basename "$out.tar.gz")"
    printf '{"ok":true,"file":"%s","splits":%s,"size":%s}\n' "$(jstr "$out.tar.gz")" "$n" "$(wc -c < "$out.tar.gz" | tr -d ' ')"
  else rm -rf "$tmp"; echo '{"ok":false,"error":"could not write the archive"}'; return 1; fi
}
backups_json() {
  printf '['; s=""
  for f in "$BACKUPS"/*.tar.gz; do
    [ -f "$f" ] || continue
    printf '%s{"file":"%s","name":"%s","size":%s}' "$s" "$(jstr "$f")" "$(jstr "$(basename "$f")")" "$(wc -c < "$f" | tr -d ' ')"
    s=","
  done
  printf ']\n'
}
restore_app() {
  f=$1
  case "$f" in "$BACKUPS"/*.tar.gz) ;; *) echo '{"ok":false,"error":"invalid file"}'; return 1 ;; esac
  [ -f "$f" ] || { echo '{"ok":false,"error":"file not found"}'; return 1; }
  u=$(cur_user); tmp="$CACHE/rs"; rm -rf "$tmp"; mkdir -p "$tmp"
  tar -xzf "$f" -C "$tmp" 2>/dev/null || { rm -rf "$tmp"; echo '{"ok":false,"error":"could not read the archive"}'; return 1; }
  p=$(sed -n 's/^package=//p' "$tmp/apex-backup.prop" 2>/dev/null)
  valid_pkg "$p" || { rm -rf "$tmp"; echo '{"ok":false,"error":"the archive has no package name"}'; return 1; }
  set -- "$tmp"/apk/*.apk
  [ -f "$1" ] || { rm -rf "$tmp"; echo '{"ok":false,"error":"the archive has no app files"}'; return 1; }
  err=""
  if [ $# -gt 1 ]; then
    sid=$(pm install-create -r --user "$u" 2>/dev/null | sed -n 's/.*\[\([0-9]*\)\].*/\1/p')
    if [ -n "$sid" ]; then
      i=0; for a in "$@"; do i=$((i+1)); pm install-write -S "$(wc -c < "$a")" "$sid" "split$i" "$a" >/dev/null 2>&1 < "$a"; done
      pm install-commit "$sid" >/dev/null 2>&1 || err="install-commit failed"
    else err="could not start a split install"; fi
  else
    pm install -r --user "$u" "$1" >/dev/null 2>&1 || err="install failed"
  fi
  [ -n "$err" ] && { rm -rf "$tmp"; printf '{"ok":false,"error":"%s"}\n' "$(jstr "$err")"; return 1; }
  if [ -f "$tmp/data.tar" ]; then
    am force-stop --user "$u" "$p" >/dev/null 2>&1
    own=$(stat -c '%u:%g' "/data/user/$u/$p" 2>/dev/null || stat -c '%u:%g' "/data/data/$p" 2>/dev/null)
    tar -xf "$tmp/data.tar" -C "/data/user/$u" 2>/dev/null || tar -xf "$tmp/data.tar" -C /data/data 2>/dev/null
    [ -n "$own" ] && chown -R "$own" "/data/user/$u/$p" 2>/dev/null
    restorecon -R "/data/user/$u/$p" 2>/dev/null
  fi
  rm -rf "$tmp"; note restore "$p" "$u" "$(basename "$f")"
  printf '{"ok":true,"p":"%s"}\n' "$(jstr "$p")"
}

# ---------- journal / summary ----------
journal_json() {
  printf '['; tail -n 200 "$JOURNAL" 2>/dev/null | awk '{
    d = ""; for (i = 5; i <= NF; i++) d = d (i > 5 ? " " : "") $i
    gsub(/"/, "", d)
    printf "%s{\"ts\":%s,\"a\":\"%s\",\"p\":\"%s\",\"u\":\"%s\",\"d\":\"%s\"}", (n++ ? "," : ""), ($1 + 0), $2, $3, $4, d
  }'; printf ']\n'
}
summary() {
  load_settings
  echo "APEX // APPS"
  u=$(cur_user)
  echo "User: $u"
  echo " "
  state_now "$u"
  d=$(wc -l < "$CACHE/nd" | tr -d ' ')
  h=$(wc -l < "$CACHE/nh" | tr -d ' ')
  f=$(awk -v u="$u" '$2 == u' "$FROZEN" 2>/dev/null | wc -l | tr -d ' ')
  s=$(ls -d "$SNAPS"/*/ 2>/dev/null | wc -l | tr -d ' ')
  echo "Disabled: $d"
  echo "Hidden (data kept): $h"
  echo "Frozen: $f"
  echo "Snapshots: $s"
  echo " "
  echo "Recent changes:"
  tail -n 12 "$JOURNAL" 2>/dev/null | while read -r ts a p uu rest; do
    echo "  $(date -d "@$ts" '+%m-%d %H:%M' 2>/dev/null || echo "$ts")  $a  $p"
  done
  echo " "
  echo "Open the WebUI to review or undo anything."
}

# ---------- daemon ----------
screen_state() {
  case "$(dumpsys power 2>/dev/null | grep -m1 -o 'mWakefulness=[A-Za-z]*')" in
    *Awake*) echo on ;; '') echo on ;; *) echo off ;;
  esac
}
apply_frozen() {
  [ -s "$FROZEN" ] || return 0
  while read -r p u; do
    valid_pkg "$p" && valid_user "$u" || continue
    am force-stop --user "$u" "$p" >/dev/null 2>&1
  done < "$FROZEN"
}
daemon() {
  pidf="$CACHE/daemon.pid"
  old=$(cat "$pidf" 2>/dev/null)
  [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null && { echo "daemon already running ($old)"; return 0; }
  echo $$ > "$pidf"
  prev=on
  while :; do
    sleep 10
    load_settings
    [ "$FREEZE_ON_SCREEN_OFF" = 1 ] || { prev=$(screen_state); continue; }
    st=$(screen_state)
    if [ "$st" = off ] && [ "$prev" = on ]; then
      sleep "${SCREEN_DELAY:-60}"
      [ "$(screen_state)" = off ] && apply_frozen
    fi
    prev=$st
  done
}
boot() { load_settings; apply_frozen; }

# ---------- entry ----------
cmd_=$1; [ $# -gt 0 ] && shift
case "$cmd_" in
  doctor) doctor ;;
  apps) apps_json ;;
  detail) detail_json "$1" ;;
  classify) classify "$1" ;;
  ops) ops_json "$1" ;;
  setop) set_op "$1" "$2" "$3" ;;
  bucket) set_bucket "$1" "$2" ;;
  doze) set_doze "$1" "$2" ;;
  act) act "$@" ;;
  undo) undo_last ;;
  snap) snap_create "$1" ;;
  snaps) snaps_json ;;
  snapdiff) snap_diff "$1" ;;
  snaprestore) snap_restore "$1" ;;
  snapdelete) snap_delete "$1" ;;
  backup) backup_app "$1" "$2" ;;
  backups) backups_json ;;
  restore) restore_app "$1" ;;
  journal) journal_json ;;
  settings) settings_json ;;
  set) set_kv "$1" "$2" ;;
  users) users ;;
  summary) summary ;;
  frozen) cat "$FROZEN" 2>/dev/null ;;
  daemon) daemon ;;
  boot) boot ;;
  *) echo "APEX // APPS"
     echo "commands: doctor apps detail classify ops setop bucket doze act undo"
     echo "          snap snaps snapdiff snaprestore snapdelete backup backups restore"
     echo "          journal settings set users summary frozen daemon boot" ;;
esac
