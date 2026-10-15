# Publishing APEX // APPS on KernelSU Modules

One-time setup, then every release is automatic.

## 1. Enable immutable releases
In this repository: **Settings → General → Releases → Enable release immutability**.

Do this *before* creating the first release. KernelSU Modules only accepts immutable releases, and a release that is already published cannot be made immutable afterwards.

## 2. Enable the release workflow
Copy `docs/release.yml` to `.github/workflows/release.yml` (through the GitHub web editor is fine).

## 3. Cut the release
Bump `version` and `versionCode` in `module/module.prop` if needed, then **Actions → Release → Run workflow**. It tags the commit, validates the ZIP with the KernelSU Modules validator and publishes `apex_apps-<versionCode>-<version>.zip` as an immutable release.

Doing it by hand instead: create a **draft** release tagged `v1.0.0`, upload the ZIP, *then* publish. Assets cannot be added after publishing.

## 4. Register the module
1. Sign in at [developers.kernelsu.org](https://developers.kernelsu.org) with GitHub.
2. Install the read-only KernelSU Modules GitHub App on this repository.
3. **My repositories → Precheck**, and fix anything marked as an error.
4. **Submit**, confirm the module ID `apex_apps`, tick the three boxes, send it for review.

Review usually takes a few days and only checks the rules, not the code. After approval every new release with a higher `versionCode` is published automatically.

## 5. Optional: in-manager updates
Add this line to `module/module.prop` after the module is listed, so root managers offer updates with a changelog:

```
updateJson=https://modules.kernelsu.org/api/v1/modules/apex_apps/update.json
```

KernelSU Modules generates and maintains that file.

## Checklist
- [ ] Release immutability enabled
- [ ] `module.yaml` on the default branch, `id` matches `module.prop`
- [ ] Exactly one ZIP per release, `module.prop` at its root
- [ ] `versionCode` higher than every earlier release
- [ ] Precheck passes
- [ ] Submitted in the portal
