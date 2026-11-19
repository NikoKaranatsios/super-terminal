# Runtime attribution

`seccomp.json` derives from the [Playwright 1.64.1 Docker seccomp profile](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json), under the [Apache 2.0 license](LICENSE.playwright). Portions copyright Microsoft Corporation and Google Inc.

Super Terminal adds `chroot` to the unconditional syscall allow rule. This allows Chromium to chroot inside its unprivileged user namespace while the outer container retains `cap-drop=ALL` and `no-new-privileges`. Chromium's sandbox remains enabled. The upstream namespace rules for `clone`, `setns` and `unshare` are retained. This profile is not an assertion that containers provide a separate kernel.
