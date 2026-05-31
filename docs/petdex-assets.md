# Petdex 形象资源

本项目内置的 Petdex 形象来自 [crafter-station/petdex](https://github.com/crafter-station/petdex) 的公开 manifest 与 spritesheet 资源，格式为 1536×1872 的 WebP spritesheet。每个 spritesheet 按 192×208 的帧尺寸渲染，使用 Petdex 的状态行约定展示 idle、running、waving、jumping、failed、waiting、review 等动作。

## 自定义图片动作图集

宠物图片工作室导入 JPG、PNG 或 WebP 后，会在本机生成两类素材：

- 三层拆件：脚部、身体、头部，作为旧版分层动画和微调回退。
- Petdex 兼容动作图集：1536×1872，8 列 × 9 行，每帧 192×208。

动作图集行约定与内置 Petdex 模板一致：

| 行 | 状态 | 帧数 | 用途 |
| --- | --- | --- | --- |
| 0 | idle | 6 | 待机、呼吸 |
| 1 | running-right | 8 | 向右移动 |
| 2 | running-left | 8 | 向左移动 |
| 3 | waving | 4 | 打招呼、说话 |
| 4 | jumping | 5 | 跳跃、提醒 |
| 5 | failed | 8 | 失败或低落 |
| 6 | waiting | 6 | 聆听、等待 |
| 7 | running | 6 | 原地奔跑 |
| 8 | review | 6 | 思考、检查 |

桌面宠物运行时会优先播放自定义动作图集；如果旧素材没有 `actionSpritesheet` 字段，则回退到三层拆件动画。工作室也可以导出 Petdex 结构的 zip 包，包含 `pet.json` 和 `spritesheet.webp`（若当前 WebView 不支持 WebP canvas 导出，则导出 `spritesheet.png`）。

已内置模板。运行时读取的是项目内已解包的 spritesheet；原始 zip 包不是运行时依赖，如果需要长期保留原包，应单独放到明确的素材归档目录再提交。

| Slug | 显示名 | 提交者 | 来源 |
| --- | --- | --- | --- |
| noir-webling | Noir Webling | local zip | project:apps/desktop/src/assets/petdex/noir-webling.webp |
| doraemon | Doraemon | local zip | project:apps/desktop/src/assets/petdex/doraemon.webp |
| eve | EVE | local zip | project:apps/desktop/src/assets/petdex/eve.webp |
| chaossprite-default | chaossprite | local zip | project:apps/desktop/src/assets/petdex/chaossprite-default.png |
| yupi-penguin | Yupi Penguin | local zip | project:apps/desktop/src/assets/petdex/yupi-penguin.webp |
| capy | Capy | local zip | project:apps/desktop/src/assets/petdex/capy.webp |
| fafa | fafa | local zip | project:apps/desktop/src/assets/petdex/fafa.webp |
| clawd | Clawd | local zip | project:apps/desktop/src/assets/petdex/clawd.webp |
| ducduc | ducduc | local zip | project:apps/desktop/src/assets/petdex/ducduc.webp |
| maodie | 耄耋 | local zip | project:apps/desktop/src/assets/petdex/maodie.webp |
| boba | Boba | railly | https://petdex.crafter.run/pets/boba |
| byte-bunny | Byte Bunny | railly | https://petdex.crafter.run/pets/byte-bunny |
| lulu-capybara-2 | 噜噜 | gitcjp | https://petdex.crafter.run/pets/lulu-capybara-2 |
| mochi | Mochi | Aoi | https://petdex.crafter.run/pets/mochi |
| axobotl | Axobotl | Joel E. | https://petdex.crafter.run/pets/axobotl |
| peri-the-owl | Peri the Owl | asyncsan | https://petdex.crafter.run/pets/peri-the-owl |
| golden-retriever | Golden Retriever | Prem S. | https://petdex.crafter.run/pets/golden-retriever |
| skillbit | Skillbit | Shreyansh S. | https://petdex.crafter.run/pets/skillbit |

Petdex 源代码使用 MIT License。Petdex README 说明宠物素材由各提交者拥有，遵循提交者声明的授权；新增或替换素材时应保留来源、提交者与 slug 信息。
