'use strict';
/* APEX // APPS WebUI */
const MOD = '/data/adb/modules/apex_apps';
const CLI = `sh ${MOD}/apex.sh`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HAS_KSU = typeof window.ksu !== 'undefined' && typeof window.ksu.exec === 'function';
const VALID_PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- shell bridge ---------- */
let cbn = 0;
function exec(cmd, user) {
  return new Promise(resolve => {
    if (!HAS_KSU) return resolve(mock(cmd));
    const name = `__apex_cb_${Date.now()}_${cbn++}`;
    window[name] = (errno, stdout, stderr) => { delete window[name]; resolve({ errno, stdout: stdout || '', stderr: stderr || '' }); };
    const opts = JSON.stringify({ env: { APEX_USER: String(user == null ? S.user : user) } });
    try { window.ksu.exec(cmd, opts, name); } catch (e) { delete window[name]; resolve({ errno: 1, stdout: '', stderr: String(e) }); }
  });
}
const cli = (a, u) => exec(`${CLI} ${a}`, u);
async function cliJSON(a, fb, u) {
  const r = await cli(a, u);
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  try { return JSON.parse(lines[lines.length - 1]); } catch (e) { return fb; }
}
const q = s => `'${String(s).replace(/'/g, '')}'`;

/* ---------- state ---------- */
const S = {
  apps: [], byPkg: new Map(), labels: new Map(), users: ['0'], user: '0',
  env: {}, settings: {}, sel: new Set(), q: '', filter: 'all', lv: '', tab: 'apps'
};
const LVNAME = { safe: 'Safe', care: 'Careful', keep: 'Required', unknown: 'Unknown' };
const LVTEXT = {
  safe: 'Only the feature itself goes away. Ads, analytics and vendor extras live here.',
  care: 'Something you can see stops working, like the camera or the clock. The system stays fine.',
  keep: 'The system depends on it. APEX refuses to change these.',
  unknown: 'Not in the list, usually an app you installed yourself.'
};
const STNAME = { enabled: 'On', disabled: 'Disabled', hidden: 'Hidden', frozen: 'Frozen' };

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }
function busy(v, txt) { $('#busyTxt').textContent = txt || 'Working'; $('#busy').classList.toggle('on', !!v); }
function openSheet(html, bind) { $('#sheet').innerHTML = html; $('#sheetBg').classList.add('on'); $('#sheet').scrollTop = 0; if (bind) bind($('#sheet')); }
function closeSheet() { $('#sheetBg').classList.remove('on'); }
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
function ask(title, body, okLabel, danger) {
  return new Promise(res => openSheet(`<h2>${esc(title)}</h2><div class="hint" style="margin:10px 2px 14px">${body}</div><div class="toolbar"><button class="${danger ? 'danger' : 'primary'}" id="aOk" style="flex:1">${esc(okLabel)}</button><button class="ghost" id="aNo" style="flex:1">Cancel</button></div>`, s => {
    $('#aOk', s).onclick = () => { closeSheet(); res(true); };
    $('#aNo', s).onclick = () => { closeSheet(); res(false); };
  }));
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function iconHtml(p) {
  const img = `<img loading="lazy" src="ksu://icon/${esc(p)}" onerror="this.remove()">`;
  return `<div class="ic" style="background:hsl(${hue(p)} 62% 70%)">${esc(label(p).charAt(0).toUpperCase())}${img}</div>`;
}
function prettyPkg(p) {
  const skip = new Set(['com', 'org', 'net', 'io', 'android', 'google', 'miui', 'xiaomi', 'mi', 'app', 'apps', 'www', 'co', 'providers']);
  const parts = p.split('.').filter(x => !skip.has(x.toLowerCase()));
  const pick = (parts.length ? parts : p.split('.')).slice(-2);
  return pick.map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}
const label = p => S.labels.get(p) || prettyPkg(p);

/* ---------- loading ---------- */
async function loadEnv() {
  S.env = await cliJSON('doctor', {});
  const r = await cli('users');
  const u = r.stdout.trim().split(/\s+/).filter(x => /^\d+$/.test(x));
  S.users = u.length ? u : ['0'];
  if (!S.users.includes(S.user)) S.user = S.users[0];
  S.settings = await cliJSON('settings', S.settings);
}
async function loadApps() {
  S.apps = await cliJSON('apps', []);
  S.byPkg = new Map(S.apps.map(a => [a.p, a]));
  for (const k of [...S.sel]) if (!S.byPkg.has(k)) S.sel.delete(k);
}
async function loadLabels() {
  try {
    if (!HAS_KSU || typeof window.ksu.getPackagesInfo !== 'function') return;
    const pkgs = S.apps.map(a => a.p);
    for (let i = 0; i < pkgs.length; i += 40) {
      const raw = window.ksu.getPackagesInfo(JSON.stringify(pkgs.slice(i, i + 40)));
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const it of (Array.isArray(arr) ? arr : Object.values(arr || {}))) {
        const p = it.packageName || it.package || it.pkg, l = it.appLabel || it.label || it.name;
        if (p && l) S.labels.set(p, l);
      }
      await sleep(0);
    }
    renderApps(); renderReview();
  } catch (e) { /* labels are optional */ }
}
async function loadAll() {
  $('#subline').textContent = 'Loading...';
  $('#appList').innerHTML = '<div class="empty"><span class="spin"></span> Reading installed apps</div>';
  await loadEnv();
  await loadApps();
  renderAll();
  loadLabels();
}

/* ---------- render: apps ---------- */
function counts() {
  const c = { safe: 0, care: 0, keep: 0, unknown: 0, changed: 0, pre: 0, user: 0 };
  for (const a of S.apps) {
    c[a.lv] = (c[a.lv] || 0) + 1;
    if (a.st !== 'enabled') c.changed++;
    if (a.sys) c.pre++; else c.user++;
  }
  return c;
}
function visible() {
  const t = S.q.trim().toLowerCase();
  return S.apps.filter(a => {
    if (S.filter === 'pre' && !a.sys) return false;
    if (S.filter === 'user' && a.sys) return false;
    if (S.filter === 'changed' && a.st === 'enabled') return false;
    if (S.lv && a.lv !== S.lv) return false;
    if (t && !(`${a.p} ${label(a.p)} ${a.note}`.toLowerCase().includes(t))) return false;
    return true;
  }).sort((a, b) => label(a.p).localeCompare(label(b.p)));
}
function appRow(a) {
  const on = S.sel.has(a.p);
  const chips = [`<span class="chip ${a.lv}">${LVNAME[a.lv]}</span>`];
  if (a.st !== 'enabled') chips.push(`<span class="chip st">${STNAME[a.st] || a.st}</span>`);
  if (!a.sys) chips.push('<span class="chip">Installed by you</span>');
  return `<div class="app ${on ? 'sel' : ''}" data-p="${esc(a.p)}">
    <button class="ck ${on ? 'on' : ''}" data-ck="${esc(a.p)}"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></button>
    ${iconHtml(a.p)}
    <div class="meta"><div class="name">${esc(label(a.p))}</div><div class="pkg">${esc(a.p)}</div>
      <div class="row">${chips.join('')}${a.note ? `<span class="chip" style="background:none;padding:0">${esc(a.note)}</span>` : ''}</div></div>
  </div>`;
}
function renderApps() {
  const list = visible(), c = counts();
  $('#appList').innerHTML = list.length ? list.map(appRow).join('') : '<div class="empty">No apps match.</div>';
  $('#lvbar').innerHTML = `<button data-lv="" class="${S.lv ? '' : 'on'}">Any</button>` +
    ['safe', 'care', 'keep', 'unknown'].map(l => `<button data-lv="${l}" class="${S.lv === l ? 'on' : ''}">${LVNAME[l]} ${c[l] || 0}</button>`).join('');
  $('#selCount').textContent = `${S.sel.size} selected`;
  $('#selbar').classList.toggle('on', S.sel.size > 0);
  $('#notice').innerHTML = S.env.pm === 0 ? '<div class="err">The package manager is not reachable. Open APEX from your root manager.</div>' : '';
}
function renderHeader() {
  const c = counts();
  $('#subline').textContent = `${S.apps.length} apps · ${c.changed} changed · ${c.pre} preinstalled`;
  $('#userPill').textContent = S.user === '0' ? 'User 0' : (S.user === '999' ? 'Dual apps' : 'User ' + S.user);
}
$('#appList').addEventListener('click', e => {
  const ck = e.target.closest('[data-ck]');
  if (ck) { const p = ck.dataset.ck; S.sel.has(p) ? S.sel.delete(p) : S.sel.add(p); renderApps(); return; }
  const row = e.target.closest('.app[data-p]');
  if (row) openApp(row.dataset.p);
});
$('#q').addEventListener('input', e => { S.q = e.target.value; renderApps(); });
$('#appFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#appFilter button').forEach(x => x.classList.toggle('on', x === b)); S.filter = b.dataset.f; renderApps(); });
$('#lvbar').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.lv = b.dataset.lv; renderApps(); });
$('#selClear').onclick = () => { S.sel.clear(); renderApps(); };
$$('#selbar [data-bulk]').forEach(b => b.onclick = () => runBulk(b.dataset.bulk, [...S.sel]));

/* ---------- actions ---------- */
const ACTW = {
  disable: ['Disable', 'The app stays installed with its data, stops running and leaves the launcher. Reversible any time.'],
  enable: ['Enable', 'Turns the app back on.'],
  hide: ['Hide', 'Removes the app for this user but keeps all of its data on the device. Reversible with Unhide.'],
  unhide: ['Unhide', 'Puts the app back for this user, with its data.'],
  freeze: ['Freeze', 'Stops the app now, and again whenever the screen goes off if that is switched on in Settings.'],
  unfreeze: ['Unfreeze', 'Stops holding the app down.'],
  stop: ['Force stop', 'Stops the app once. It can start again on its own.']
};
async function runBulk(action, pkgs, skipAsk) {
  pkgs = pkgs.filter(p => VALID_PKG.test(p));
  if (!pkgs.length) return;
  const blocked = pkgs.filter(p => (S.byPkg.get(p) || {}).lv === 'keep');
  const targets = pkgs.filter(p => !blocked.includes(p));
  const risky = targets.filter(p => (S.byPkg.get(p) || {}).lv === 'care');
  if (!targets.length) { toast('Every app you picked is required by the system'); return; }
  const [verb, what] = ACTW[action] || [action, ''];
  if (!skipAsk) {
    let body = `<p>${esc(what)}</p><p style="margin-top:8px"><b>${targets.length} app${targets.length > 1 ? 's' : ''}</b>: ${targets.slice(0, 8).map(p => esc(label(p))).join(', ')}${targets.length > 8 ? ` and ${targets.length - 8} more` : ''}</p>`;
    if (blocked.length) body += `<p style="margin-top:8px">Skipping ${blocked.length} app${blocked.length > 1 ? 's' : ''} the system needs: ${blocked.slice(0, 5).map(p => esc(label(p))).join(', ')}.</p>`;
    if (risky.length && S.settings.CONFIRM_RISKY === '1') body += `<p style="margin-top:8px;color:var(--warn)">${risky.length} of these can take a visible feature with them: ${risky.slice(0, 5).map(p => esc(label(p))).join(', ')}.</p>`;
    if (['disable', 'hide', 'freeze'].includes(action)) body += `<p style="margin-top:8px">A snapshot is taken first, so one tap puts everything back.</p>`;
    if (!(await ask(`${verb} ${targets.length} app${targets.length > 1 ? 's' : ''}?`, body, verb, action !== 'enable' && action !== 'unhide'))) return;
  }
  if (['disable', 'hide', 'freeze'].includes(action)) { busy(true, 'Taking a snapshot'); await cli(`snap before_${action}`); }
  busy(true, `${verb}...`);
  const res = await cliJSON(`act ${action} ${targets.map(q).join(' ')}`, { ok: false });
  busy(false);
  const rs = res.results || [];
  const done = rs.filter(r => r.r === 'done').length;
  const failed = rs.filter(r => r.r !== 'done');
  S.sel.clear();
  await loadApps(); renderAll();
  if (failed.length) {
    openSheet(`<h2>${esc(verb)}: ${done} done, ${failed.length} not</h2><p class="hint">Android refused these. System apps on HyperOS sometimes cannot be changed at all.</p>
      <div class="list">${failed.slice(0, 20).map(f => `<div class="rel"><div class="meta"><div class="name">${esc(label(f.p))}</div><div class="pkg">${esc(f.r === 'protected' ? 'required by the system' : f.r)}</div></div></div>`).join('')}</div>
      <button class="ghost" id="fc" style="width:100%;margin-top:12px">Close</button>`, s => { $('#fc', s).onclick = closeSheet; });
  } else toast(`${verb}: ${done} app${done > 1 ? 's' : ''}`);
}

/* ---------- app detail ---------- */
async function openApp(p) {
  const a = S.byPkg.get(p); if (!a) return;
  openSheet(`<div class="empty"><span class="spin"></span> Reading ${esc(label(p))}</div>`);
  const d = await cliJSON(`detail ${q(p)}`, {});
  const ops = S.env.appops ? await cliJSON(`ops ${q(p)}`, []) : [];
  const keep = a.lv === 'keep';
  const st = a.st;
  const acts = [
    ['freeze', st === 'frozen' ? 'unfreeze' : 'freeze', st === 'frozen' ? 'Frozen' : 'Freeze', st === 'frozen' ? 'tap to release' : 'stop it now'],
    ['disable', st === 'disabled' ? 'enable' : 'disable', st === 'disabled' ? 'Disabled' : 'Disable', st === 'disabled' ? 'tap to enable' : 'keeps data'],
    ['hide', st === 'hidden' ? 'unhide' : 'hide', st === 'hidden' ? 'Hidden' : 'Hide', st === 'hidden' ? 'tap to restore' : 'keeps data']
  ];
  openSheet(`
    <div style="display:flex;gap:12px;align-items:center">${iconHtml(p)}<div class="meta"><h2>${esc(label(p))}</h2><div class="pkg mono">${esc(p)}</div></div></div>
    <div class="row" style="margin-top:10px"><span class="chip ${a.lv}">${LVNAME[a.lv]}</span>${a.st !== 'enabled' ? `<span class="chip st">${STNAME[a.st]}</span>` : ''}${a.sys ? '<span class="chip">Preinstalled</span>' : '<span class="chip">Installed by you</span>'}</div>
    <p class="hint" style="margin-top:10px">${esc(a.note || LVTEXT[a.lv])}</p>
    ${keep ? '<div class="err">The system depends on this app, so APEX will not change its state. You can still adjust its background permissions below.</div>' : ''}
    <h4>State</h4>
    <div class="acts">${acts.map(([base, act, lab, sub]) => `<button data-act="${act}" ${keep ? 'disabled' : ''} class="${st === base || (base === 'freeze' && st === 'frozen') ? 'on' : ''}">${esc(lab)}<small>${esc(sub)}</small></button>`).join('')}</div>
    <div class="toolbar" style="margin-top:8px"><button class="ghost" data-act="stop" style="flex:1">Force stop now</button><button class="ghost" id="bk" style="flex:1">Back up</button></div>
    <h4>Battery</h4>
    <div class="opr"><div class="l"><b>Standby bucket</b><small>How aggressively Android holds the app back when idle</small></div>
      <select class="f" id="bucket" style="flex:none;width:auto">${['active', 'working_set', 'frequent', 'rare', 'restricted'].map(b => `<option value="${b}" ${d.bucket === b ? 'selected' : ''}>${b.replace('_', ' ')}</option>`).join('')}</select></div>
    <div class="opr"><div class="l"><b>Ignore battery saving</b><small>Lets the app keep working during Doze. Only for things you need, like alarms</small></div>
      <label class="sw"><input type="checkbox" id="doze" ${d.doze ? 'checked' : ''}><span></span></label></div>
    ${ops.length ? `<h4>Background permissions</h4><div id="opsBox">${ops.map(o => opRow(o)).join('')}</div>` : ''}
    <h4>Details</h4>
    <div class="kv"><span>Version</span><span>${esc(d.version || '-')}</span><span>UID</span><span>${esc(d.uid || '-')}</span><span>Target SDK</span><span>${esc(d.targetSdk || '-')}</span><span>Installer</span><span>${esc(d.installer || '-')}</span><span>Permissions</span><span>${esc(d.perms == null ? '-' : d.perms)}</span><span>User</span><span>${esc(S.user)}</span></div>
  `, s => {
    $$('[data-act]', s).forEach(b => b.onclick = async () => { closeSheet(); await runBulk(b.dataset.act, [p]); });
    $('#bucket', s).onchange = async e => { const r = await cliJSON(`bucket ${q(p)} ${q(e.target.value)}`, { ok: false }); toast(r.ok ? 'Standby bucket set' : (r.error || 'Could not set it')); };
    $('#doze', s).onchange = async e => { const r = await cliJSON(`doze ${q(p)} ${e.target.checked ? 'on' : 'off'}`, { ok: false }); toast(r.ok ? 'Saved' : 'Could not change it'); };
    $('#bk', s).onclick = () => backupSheet(p);
    $$('#opsBox [data-op]', s).forEach(b => b.onclick = async () => {
      const [op, mode] = [b.dataset.op, b.dataset.mode];
      const r = await cliJSON(`setop ${q(p)} ${q(op)} ${q(mode)}`, { ok: false });
      if (!r.ok) return toast(r.error || 'Android refused this change');
      $$(`#opsBox [data-op="${op}"]`, s).forEach(x => x.classList.toggle('on', x === b));
      toast('Saved');
    });
  });
}
const OPNAME = {
  RUN_IN_BACKGROUND: ['Run in background', 'Lets the app do work while you are not in it'],
  RUN_ANY_IN_BACKGROUND: ['Any background work', 'The broader version of the same thing'],
  WAKE_LOCK: ['Keep the device awake', 'A common cause of overnight battery drain'],
  START_FOREGROUND: ['Foreground service', 'The sticky notification kind of service'],
  INSTANT_APP_START_FOREGROUND: ['Instant app foreground', 'For instant apps only'],
  BOOT_COMPLETED: ['Start at boot', 'Lets the app launch itself after a restart'],
  READ_CLIPBOARD: ['Read the clipboard', 'Can see whatever you copied'],
  WRITE_CLIPBOARD: ['Write the clipboard', 'Can replace what you copied'],
  SYSTEM_ALERT_WINDOW: ['Draw over other apps', 'Floating windows and overlays'],
  GET_USAGE_STATS: ['Read app usage', 'Sees which apps you open and for how long'],
  REQUEST_INSTALL_PACKAGES: ['Install other apps', 'How preinstalled stores push apps on you'],
  CHANGE_WIFI_STATE: ['Change Wi-Fi', 'Can switch Wi-Fi on and off'],
  VIBRATE: ['Vibrate', ''],
  POST_NOTIFICATION: ['Post notifications', '']
};
function opRow(o) {
  const [n, d] = OPNAME[o.op] || [o.op, ''];
  return `<div class="opr"><div class="l"><b>${esc(n)}</b>${d ? `<small>${esc(d)}</small>` : ''}</div>
    <div class="modes">${['allow', 'ignore', 'deny'].map(m => `<button data-op="${esc(o.op)}" data-mode="${m}" class="${o.mode === m ? 'on' : ''}">${m}</button>`).join('')}</div></div>`;
}
function backupSheet(p) {
  openSheet(`<h2>Back up ${esc(label(p))}</h2><p class="hint">The archive goes to Download/APEX. App files are always included.</p>
    <div class="set"><div class="l"><b>Include app data</b><small>Accounts, settings and saved files. Bigger archive, and restoring data only works on the same Android version</small></div><label class="sw"><input type="checkbox" id="wd"><span></span></label></div>
    <button class="primary" id="go" style="width:100%;margin-top:12px">Back up now</button>`, s => {
    $('#go', s).onclick = async () => {
      const wd = $('#wd', s).checked; closeSheet(); busy(true, 'Backing up');
      const r = await cliJSON(`backup ${q(p)} ${wd ? 'data' : ''}`, { ok: false });
      busy(false);
      toast(r.ok ? `Saved ${String(r.file).split('/').pop()}` : (r.error || 'Backup failed'));
      if (S.tab === 'backups') renderBackups();
    };
  });
}

/* ---------- review ---------- */
function renderReview() {
  const groups = ['safe', 'care', 'unknown', 'keep'];
  const box = $('#reviewBox');
  box.innerHTML = groups.map(lv => {
    const list = S.apps.filter(a => a.lv === lv && a.sys);
    if (!list.length) return '';
    const off = list.filter(a => a.st !== 'enabled').length;
    return `<div class="box"><h3><span class="chip ${lv}">${LVNAME[lv]}</span> ${list.length} preinstalled${off ? ` · ${off} already off` : ''}</h3>
      <p class="hint">${esc(LVTEXT[lv])}</p>
      ${lv !== 'keep' ? `<div class="toolbar"><button class="ghost" data-rev="${lv}" data-a="disable">Disable all that are on</button><button class="ghost" data-rev="${lv}" data-a="select">Select them</button></div>` : ''}
      <div class="row" style="margin-top:10px">${list.slice(0, 40).map(a => `<span class="chip" style="background:var(--s2)">${esc(label(a.p))}${a.st !== 'enabled' ? ' ✓' : ''}</span>`).join('')}${list.length > 40 ? `<span class="chip">+${list.length - 40} more</span>` : ''}</div></div>`;
  }).join('') || '<div class="empty">No preinstalled apps found.</div>';
  $$('[data-rev]', box).forEach(b => b.onclick = () => {
    const list = S.apps.filter(a => a.lv === b.dataset.rev && a.sys && a.st === 'enabled').map(a => a.p);
    if (!list.length) return toast('Nothing left to change here');
    if (b.dataset.a === 'select') { S.sel = new Set(list); gotoTab('apps'); renderApps(); toast(`${list.length} selected`); }
    else runBulk('disable', list);
  });
}

/* ---------- snapshots ---------- */
async function renderSnaps() {
  const list = await cliJSON('snaps', []);
  $('#snapList').innerHTML = list.length ? list.reverse().map(s => `<div class="box" style="margin-bottom:8px"><h3>${esc(s.id)}</h3>
    <p class="hint">User ${esc(s.user)} · ${s.apps} apps · ${s.disabled} disabled · ${s.hidden} hidden at the time</p>
    <div class="toolbar"><button class="ghost" data-sr="${esc(s.id)}">Restore</button><button class="ghost" data-sd="${esc(s.id)}">What changed</button><button class="danger" data-sx="${esc(s.id)}" style="padding:8px 12px">Delete</button></div></div>`).join('')
    : '<div class="empty">No snapshots yet. Take one before you change anything.</div>';
  const box = $('#snapList');
  $$('[data-sd]', box).forEach(b => b.onclick = async () => {
    busy(true, 'Comparing'); const d = await cliJSON(`snapdiff ${q(b.dataset.sd)}`, { ok: false }); busy(false);
    if (!d.ok) return toast('Could not read that snapshot');
    const en = d.enable || [], di = d.disable || [];
    openSheet(`<h2>Restoring would</h2>
      <h4>Turn back on (${en.length})</h4><div class="row">${en.length ? en.map(p => `<span class="chip" style="background:var(--s2)">${esc(label(p))}</span>`).join('') : '<span class="hint">Nothing</span>'}</div>
      <h4>Switch off again (${di.length})</h4><div class="row">${di.length ? di.map(p => `<span class="chip" style="background:var(--s2)">${esc(label(p))}</span>`).join('') : '<span class="hint">Nothing</span>'}</div>
      <p class="hint" style="margin-top:14px">Restoring only turns apps back on. It never switches anything off, so it cannot make things worse.</p>
      <button class="ghost" id="dc" style="width:100%">Close</button>`, s => { $('#dc', s).onclick = closeSheet; });
  });
  $$('[data-sr]', box).forEach(b => b.onclick = async () => {
    if (!(await ask('Restore snapshot', '<p>Every app that was on when this snapshot was taken is turned back on. Apps you switched off later come back.</p>', 'Restore'))) return;
    busy(true, 'Restoring');
    const r = await cliJSON(`snaprestore ${q(b.dataset.sr)}`, { ok: false });
    busy(false);
    await loadApps(); renderAll();
    toast(r.ok ? `${r.restored} app${r.restored === 1 ? '' : 's'} restored` : 'Restore failed');
  });
  $$('[data-sx]', box).forEach(b => b.onclick = async () => {
    if (!(await ask('Delete snapshot', '<p>The snapshot is removed. Your apps are not changed.</p>', 'Delete', true))) return;
    await cli(`snapdelete ${q(b.dataset.sx)}`); renderSnaps();
  });
}
$('#snapNew').onclick = async () => {
  const n = $('#snapName').value.trim() || 'manual';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(n)) return toast('Use letters, numbers, - or _');
  busy(true, 'Taking a snapshot');
  const r = await cliJSON(`snap ${q(n)}`, { ok: false });
  busy(false);
  $('#snapName').value = '';
  toast(r.ok ? `Snapshot of ${r.apps} apps saved` : 'Could not take a snapshot');
  renderSnaps();
};

/* ---------- backups ---------- */
async function renderBackups() {
  const list = await cliJSON('backups', []);
  $('#bkList').innerHTML = list.length ? list.reverse().map(b => `<div class="app"><div class="meta"><div class="name">${esc(b.name)}</div><div class="pkg">${(b.size / 1048576).toFixed(1)} MB</div></div><button class="ghost" data-rb="${esc(b.file)}">Restore</button></div>`).join('')
    : '<div class="empty">No backups yet. Open any app and choose Back up.</div>';
  $$('[data-rb]', $('#bkList')).forEach(b => b.onclick = async () => {
    if (!(await ask('Restore from backup', '<p>The app is installed from the archive. If the archive holds data, the current data of that app is replaced.</p><p style="margin-top:8px">Restoring data across different Android versions often fails, and the app may need its storage cleared afterwards.</p>', 'Restore', true))) return;
    busy(true, 'Restoring');
    const r = await cliJSON(`restore ${q(b.dataset.rb)}`, { ok: false });
    busy(false);
    await loadApps(); renderAll();
    toast(r.ok ? `Restored ${r.p}` : (r.error || 'Restore failed'));
  });
}

/* ---------- settings ---------- */
async function setSetting(k, v) { await cli(`set ${k} ${v}`); S.settings[k] = v; }
async function renderSettings() {
  const e = S.env, yn = v => v ? '<span style="color:var(--ac2)">yes</span>' : '<span style="color:var(--bad)">no</span>';
  const j = await cliJSON('journal', []);
  $('#settingsBox').innerHTML = `
  <div class="box"><h3>Freezing</h3>
    <div class="set"><div class="l"><b>Freeze when the screen goes off</b><small>Frozen apps are stopped again every time the screen turns off</small></div><label class="sw"><input type="checkbox" data-set="FREEZE_ON_SCREEN_OFF" ${S.settings.FREEZE_ON_SCREEN_OFF === '1' ? 'checked' : ''}><span></span></label></div>
    <div class="set"><div class="l"><b>Wait before freezing</b><small>So a quick screen toggle does not kill what you were using</small></div>
      <select class="f" id="sd" style="flex:none;width:auto">${[30, 60, 120, 300, 600].map(v => `<option value="${v}" ${S.settings.SCREEN_DELAY == v ? 'selected' : ''}>${v < 60 ? v + ' s' : v / 60 + ' min'}</option>`).join('')}</select></div>
  </div>
  <div class="box"><h3>Safety</h3>
    <div class="set"><div class="l"><b>Warn before careful apps</b><small>Ask again when a change takes a visible feature with it</small></div><label class="sw"><input type="checkbox" data-set="CONFIRM_RISKY" ${S.settings.CONFIRM_RISKY === '1' ? 'checked' : ''}><span></span></label></div>
    <p class="hint">Apps the system depends on are always refused, whatever these switches say.</p>
  </div>
  <div class="box"><h3>Recent changes</h3>
    ${j.length ? `<div>${j.slice(-25).reverse().map(x => `<div class="opr"><div class="l"><b>${esc(x.a)} · ${esc(label(x.p))}</b><small>${esc(new Date(x.ts * 1000).toLocaleString())} · user ${esc(x.u)}${x.d && x.d !== 'ok' ? ' · ' + esc(x.d) : ''}</small></div></div>`).join('')}</div>` : '<p class="hint">Nothing yet.</p>'}
    <button class="ghost" id="undo" style="width:100%;margin-top:10px">Undo the last change</button>
  </div>
  <div class="box"><h3>Diagnostics</h3><div class="kv">
    <span>Package manager</span><span>${yn(e.pm)}</span><span>App ops</span><span>${yn(e.appops)}</span><span>Standby buckets</span><span>${yn(e.bucket)}</span>
    <span>Battery whitelist</span><span>${yn(e.doze)}</span><span>Archiving</span><span>${yn(e.tar)}</span>
    <span>Users</span><span>${esc(e.users_list || '0')}</span><span>Android API</span><span>${esc(e.sdk || '-')}</span><span>Device</span><span>${esc(e.device || '-')}</span></div></div>
  <div class="box"><h3>About</h3><div class="kv"><span>Version</span><span>v1.0.0</span><span>Author</span><span>kreza6173-pixel</span><span>Companion</span><span>Pairs with AEGIS // FIREWALL for per-app network rules</span></div></div>`;
  const box = $('#settingsBox');
  $$('[data-set]', box).forEach(i => i.onchange = () => setSetting(i.dataset.set, i.checked ? '1' : '0'));
  $('#sd', box).onchange = e2 => setSetting('SCREEN_DELAY', e2.target.value);
  $('#undo', box).onclick = async () => {
    busy(true, 'Undoing'); const r = await cliJSON('undo', { ok: false }); busy(false);
    if (!r.ok) return toast(r.error || 'Nothing to undo');
    await loadApps(); renderAll(); renderSettings();
    toast(`${r.action} ${label(r.p)}`);
  };
}

/* ---------- user switch ---------- */
$('#userPill').onclick = () => {
  openSheet(`<h2>Which user</h2><p class="hint">Dual apps and a second space are separate Android users. Rules and states are per user.</p>
    <div class="list">${S.users.map(u => `<button class="ghost" data-u="${esc(u)}" style="text-align:left">${u === '0' ? 'User 0 (main)' : u === '999' ? 'User 999 (Dual apps)' : 'User ' + esc(u)}${u === S.user ? ' · current' : ''}</button>`).join('')}</div>`, s => {
    $$('[data-u]', s).forEach(b => b.onclick = async () => {
      closeSheet(); S.user = b.dataset.u; S.sel.clear();
      busy(true, 'Switching user'); await loadApps(); busy(false); renderAll();
    });
  });
};

/* ---------- nav ---------- */
function gotoTab(t) {
  S.tab = t;
  $$('nav.bottom button').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  $$('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + t));
  window.scrollTo(0, 0);
  if (t === 'review') renderReview();
  if (t === 'snaps') renderSnaps();
  if (t === 'backups') renderBackups();
  if (t === 'settings') renderSettings();
}
$$('nav.bottom button').forEach(b => b.onclick = () => gotoTab(b.dataset.tab));
function renderAll() { renderHeader(); renderApps(); if (S.tab === 'review') renderReview(); if (S.tab === 'settings') renderSettings(); }

/* ---------- browser preview mock ---------- */
function mock(cmd) {
  const a = cmd.replace(CLI + ' ', '').split(' ')[0];
  const mk = (p, sys, st, lv, note) => ({ p, sys, st, lv, note });
  const out = {
    doctor: '{"pm":1,"appops":1,"users":1,"bucket":1,"doze":1,"tar":1,"sdk":"36","device":"tanzanite","users_list":"0 999"}',
    users: '0 999',
    settings: '{"FREEZE_ON_SCREEN_OFF":"0","SCREEN_DELAY":"60","CONFIRM_RISKY":"1"}',
    apps: JSON.stringify([
      mk('com.android.systemui', 1, 'enabled', 'keep', 'System UI, status bar and navigation'),
      mk('com.android.settings', 1, 'enabled', 'keep', 'Settings'),
      mk('com.miui.analytics', 1, 'disabled', 'safe', 'Xiaomi analytics'),
      mk('com.miui.msa.global', 1, 'hidden', 'safe', 'Xiaomi ad framework'),
      mk('com.xiaomi.joyose', 1, 'enabled', 'safe', 'Xiaomi performance and telemetry service'),
      mk('com.miui.cleanmaster', 1, 'enabled', 'safe', 'Cleaner'),
      mk('com.xiaomi.mipicks', 1, 'enabled', 'safe', 'App recommendations'),
      mk('com.miui.camera', 1, 'enabled', 'care', 'Camera app'),
      mk('com.android.calculator2', 1, 'enabled', 'care', 'Calculator'),
      mk('com.miui.calendar', 1, 'enabled', 'care', 'Calendar app, also shows ads'),
      mk('com.whatsapp', 0, 'enabled', 'unknown', ''),
      mk('org.telegram.messenger', 0, 'frozen', 'unknown', ''),
      mk('com.instagram.android', 0, 'enabled', 'unknown', '')
    ]),
    detail: '{"p":"x","level":"safe","note":"","version":"1.2.3","uid":"10090","targetSdk":"34","apk":"/data/app/base.apk","installer":"com.android.vending","bucket":"rare","doze":0,"perms":14,"user":"0"}',
    ops: JSON.stringify(['RUN_IN_BACKGROUND', 'WAKE_LOCK', 'BOOT_COMPLETED', 'READ_CLIPBOARD', 'SYSTEM_ALERT_WINDOW', 'GET_USAGE_STATS', 'REQUEST_INSTALL_PACKAGES'].map((op, i) => ({ op, mode: ['allow', 'deny', 'ignore'][i % 3] }))),
    snaps: '[{"id":"20261012-2030-manual","user":"0","apps":312,"disabled":4,"hidden":2}]',
    snapdiff: '{"ok":true,"user":"0","enable":["com.miui.analytics","com.xiaomi.mipicks"],"disable":[]}',
    backups: '[{"file":"/sdcard/Download/APEX/com.whatsapp-2.24-x.tar.gz","name":"com.whatsapp-2.24-x.tar.gz","size":94371840}]',
    journal: '[{"ts":' + ((Date.now() / 1000 | 0) - 300) + ',"a":"disable","p":"com.miui.analytics","u":"0","d":"ok"},{"ts":' + ((Date.now() / 1000 | 0) - 120) + ',"a":"hide","p":"com.miui.msa.global","u":"0","d":"ok"}]'
  }[a];
  return { errno: 0, stdout: out !== undefined ? out : '{"ok":true,"results":[]}', stderr: '' };
}

loadAll();
