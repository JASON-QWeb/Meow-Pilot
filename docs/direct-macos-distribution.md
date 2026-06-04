# macOS 不上架正式分发

本项目支持 Mac App Store 之外的正式分发路径：Developer ID 签名、notarization 公证、DMG 构建和随包运行时。Tauri 的 macOS 签名身份可通过 `APPLE_SIGNING_IDENTITY` 环境变量提供，公证可通过 `APPLE_API_ISSUER`、`APPLE_API_KEY` 和 `APPLE_API_KEY_PATH` 提供 App Store Connect API Key。

## 当前项目侧能力

- Tauri release 包会携带 `packages/agent-runtime/dist/server.cjs`。
- Tauri release 包会携带 `apps/desktop/src-tauri/resources/node/bin/node`，避免依赖用户机器已有 Node。
- `PET_NODE_RUNTIME_VERSION` 可覆盖随包 Node 版本；默认版本在 `scripts/prepare-node-runtime.mjs` 中固定。
- `calendar_read` 使用随包 EventKit helper：`apps/desktop/src-tauri/resources/calendar-helper/pet-calendar-helper`。
- 普通 CI 已把 Tauri build 作为硬门槛，并使用 ad-hoc identity 进行无证书打包验证。
- `.github/workflows/macos-direct-distribution.yml` 可在 tag 或手动触发时生成签名并公证的 DMG。

## 本地正式构建

前提：本机 Keychain 已安装 `Developer ID Application` 证书，并且你有 App Store Connect API Key。

```bash
pnpm install
pnpm typecheck
pnpm test

export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="$PWD/private_keys/AuthKey_key-id.p8"

pnpm --filter @pet/desktop tauri:build:direct
```

产物位置：

```bash
apps/desktop/src-tauri/target/release/bundle/dmg/
```

`tauri:build:dmg`、`tauri:build:adhoc` 和 `tauri:build:direct` 默认设置 `CI=true`，用于跳过 create-dmg 的 Finder AppleScript 美化步骤，避免本地或 CI 缺少 Apple Events 权限时 DMG 构建失败。

## GitHub Actions secrets

正式 DMG workflow 需要以下 secrets：

- `APPLE_CERTIFICATE`：从 Keychain 导出的 `.p12` 证书，base64 编码。
- `APPLE_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码。
- `KEYCHAIN_PASSWORD`：CI 临时 keychain 密码。
- `APPLE_API_KEY`：App Store Connect API Key ID。
- `APPLE_API_ISSUER`：App Store Connect Issuer ID。
- `APPLE_API_KEY_P8_BASE64`：`AuthKey_*.p8` 私钥文件的 base64 编码。

常用导出命令：

```bash
openssl base64 -in certificate.p12 -out certificate-base64.txt -A
base64 -i AuthKey_KEYID.p8 -o AuthKey_KEYID.p8.base64
```

## ad-hoc 测试包

没有 Apple Developer 证书时，可以构建 ad-hoc 包做内部测试：

```bash
pnpm --filter @pet/desktop tauri:build:adhoc
```

ad-hoc 签名不是正式分发。用户下载后仍可能需要在 macOS「隐私与安全性」中手动允许运行。

## 验收命令

正式包构建后，建议至少检查：

```bash
codesign --verify --deep --strict --verbose=2 "Pet Agent.app"
spctl -a -vvv -t open "Pet Agent.app"
xcrun stapler validate "Pet Agent.app"
```

如果分发 DMG，也要对 DMG 做 Gatekeeper 检查：

```bash
spctl -a -vvv -t open "Pet Agent_0.1.0_aarch64.dmg"
```

## 注意事项

- 正式公证需要 Apple Developer Program 账号和 Developer ID Application 证书。
- GitHub workflow 只保存构建流程，不保存任何证书或私钥。
- 随包 Node runtime 是项目的运行时基线；升级 Node 后需要重新运行 `pnpm --workspace-root tauri:prepare` 并完整回归 `pnpm test`、`pnpm typecheck`、`pnpm build` 和 Tauri build。
