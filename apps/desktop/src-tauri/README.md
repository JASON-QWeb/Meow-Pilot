# 原生桌面壳

这是桌面宠物的 Tauri 壳。它负责透明置顶宠物窗口、工作窗口、macOS 打包资源、随包 Node runtime、EventKit 日历 helper，以及不上架直分发所需的签名/公证配置。

常用命令：

```bash
pnpm --filter @pet/desktop tauri:build
pnpm --filter @pet/desktop tauri:build:adhoc
pnpm --filter @pet/desktop tauri:build:direct
```

`tauri:build` 会通过 `beforeBuildCommand` 自动构建 protocol、agent runtime、前端、随包 Node runtime 和 EventKit helper。

直分发说明见：

```text
docs/direct-macos-distribution.md
```

## English

This directory contains the Tauri shell for the desktop pet app. It owns the transparent always-on-top pet window, the work window, macOS bundle resources, the packaged Node runtime, the EventKit calendar helper, and the signing/notarization configuration for direct macOS distribution outside the Mac App Store.

Common commands:

```bash
pnpm --filter @pet/desktop tauri:build
pnpm --filter @pet/desktop tauri:build:adhoc
pnpm --filter @pet/desktop tauri:build:direct
```

`tauri:build` uses `beforeBuildCommand` to build the protocol package, agent runtime, frontend, packaged Node runtime, and EventKit helper.

See the direct distribution guide:

```text
docs/direct-macos-distribution.md
```
