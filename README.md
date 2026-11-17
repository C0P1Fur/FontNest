<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" height="96" alt="FontNest 图标">

# FontNest

**极简 · 本地 · 跨平台字体管理器**

只做三件事：**找到字体 → 看清字体 → 用上字体**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4a4a4a?style=flat-square)](#平台支持)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.96-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

[功能](#功能) · [快速开始](#快速开始) · [字体识别](#字体识别) · [架构](#架构) · [文档](#文档)

</div>

![FontNest 主界面](docs/images/app-main.png)

> 截图来自 Vite 浏览器预览（数据是内置示例字体），桌面版界面完全一致。

---

## 它解决什么问题

大多数人的硬盘里躺着几百个字体文件，但只敢装几个——装多了，Photoshop 和 Word 的字体列表会变成灾难。

于是形成了一个死循环：**想用不敢装，不装又看不清它长什么样。**

FontNest 想拆掉这个循环。

| | 常见字体管理器 | FontNest |
|---|---|---|
| **未安装的字体** | 列表里看不到 | 用真实字形预览，看得清再决定装不装 |
| **安装方式** | 系统级，可能要管理员权限 | **当前用户级**，不弹 UAC，随时可撤回 |
| **找一款字体** | 只能按名字搜 | 还可以**截图反查**——输入图上的文字，从本机全库里找最像的 |
| **你的数据** | 可能上传、可能联网 | 全部留在本机：无账号、无遥测、离线可用 |

---

## 功能

- **扫描** — 系统字体目录 + 任意多个自定义目录，`.ttf / .otf / .ttc` 全支持（含字体集合里的多 face）
- **预览** — 每张卡的名字和样张**都用该字体本身渲染**，未安装的也一样
- **检索** — 名字/厂商模糊搜索，按状态、按字形分类筛选，四种排序
- **收藏与分类** — 收藏是个人标记；分类是你自己圈的组，只用来筛选，**不会改动任何字体文件**
- **启用 / 停用** — 真正把字体现装进系统（Windows 当前用户级），也可以随时卸掉
- **截图识别** — 给一张文字截图 + 输入图上的字，返回最相似的几款
- **首次引导** — 五步聚光灯导览，只讲不显然的事，可跳过、可重看

---

## 截图

### 首次启动的分步引导

![首次引导](docs/images/app-tour.png)

聚光灯只高亮当前这一步要讲的元素，其余压暗。可讲概念的那几步会**拦截点击**，
避免用户中途跑去点别的而漏掉信息；需要动手的步骤则放行。

---

## 快速开始

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | ≥ 20 |
| pnpm | ≥ 11（注意是 11，构建脚本配置项与旧版不同） |
| Rust | ≥ 1.80（开发时用的是 1.96） |

Windows 还需要 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 自带）。

### 运行

```bash
pnpm install
pnpm desktop          # 启动桌面应用（Tauri 窗口）
```

只想看界面、不启动 Rust 后端的话：

```bash
pnpm dev              # 浏览器预览，数据走内置 mock
```

### 构建

```bash
pnpm desktop:build    # 产出安装包（bundle 尚未启用，当前只出可执行文件）
```

---

## 使用

### 键盘

| 按键 | 作用 |
|---|---|
| `⌘K` / `/` | 聚焦搜索 |
| `↑` `↓` | 在结果间移动 |
| `Space` | 启用 / 停用当前字体 |
| `F` | 收藏 / 取消收藏 |
| `1`–`5` | 切换预览字号 |
| `T` | 切换样张文本 |
| `G` / `L` | 网格 / 列表视图 |
| `Esc` | 清空搜索 |

### 添加字体目录

点顶栏的**文件夹＋图标**，或左栏底部的「刷新索引」旁的说明入口。

支持任意路径，扫描**只读不改**——你加进来的文件夹里的文件，FontNest 一个字节都不会动。

### 启用 / 停用的边界

这是全软件**唯一会写入系统文件**的功能，所以边界收得很紧：

| 规则 | 实现 |
|---|---|
| 只处理**自定义目录**里的字体 | 系统字体永远不被改动，界面上显示为「系统字体 · 只读」 |
| 卸载前校验内容哈希 | 文件被替换过就拒绝删除，只提示不动手 |
| 删除 = 移入回收站 | `%APPDATA%\FontNest\trash\<时间戳>-<文件名>`，7 天内可人工恢复 |
| 一切以清单为准 | 清单里没有的字体，磁盘上任何文件都不碰 |

---

## 字体识别

**这是一个"查表比对"，不是"看懂字体"。**

### 怎么用

1. 点顶栏的扫描框图标
2. 选一张**含有文字**的图片
3. 把图上的文字**照抄**进去（这一步不能省，见下）
4. 得到按相似度排序的候选，每一条都用该字体自身渲染

### 为什么必须输入文字

因为它的原理是：**拿每个候选字体把同一段文字画一遍，再和你的图叠着比。**

```
你的截图  →  二值化 → 裁到墨迹 → 压成 48×48 的小格子图
每个候选字体 → 渲染同样文字 → 同样三步 → 48×48
                                          ↓
                          两张小图逐格比"墨迹重叠了多少"（IoU）
```

不知道画的是什么，就没法画——所以文字必须由你提供。

### 快在哪

早期版本跑完 399 个字体要 **123 秒**，现在 release 构建下 **0.23 秒**。关键改动是
把渲染库从「加载时解码全部字形」换成「用哪个才读哪个」——加载耗时从 46 ms/字体
降到 0.005 ms/字体，而识别每个字体只需要 6 个字形。

### 能力边界

它假设**输入是干净的单行文字图**。以下情况会明显掉分，且**不会报错**，
只会安静地给出一个错误的排序：

- 背景不是纯色（照片、渐变、杂纹理）
- 字间距被手动调大过
- 图片被拉伸变形、有明显透视
- 文字过小或严重模糊

代码里有一道**质量门槛**：提取出的墨迹如果不像文字（占比异常、碎块过多、形状不对），
会直接拒绝并说明原因，而不是硬排一个名次出来。

> 更完整的原理、实测数据与被否决的方案，见 [docs/BACKEND.md](docs/BACKEND.md)。

---

## 实测数据

在 24 逻辑核的 Windows 11 机器上，针对本机 377 个字体文件 / 399 个 face：

| 操作 | 耗时 |
|---|---|
| 首次全量扫描 | 776 ms |
| 搜索 / 筛选 / 排序（客户端） | 1–2 ms（10k 条量级仍可用） |
| 字体识别（全库 399 个，release） | **232 ms** |
| 字体文件解析（惰性，仅取用到的字形） | 0.005 ms / 字体 |

测试：`cargo test -p fontnest-core` **33 passed** · `pnpm test` **13 passed**

---

## 架构

```
Cargo.toml                  workspace 根
├─ crates/fontnest-core     扫描 · 解析 · 索引 · 安装 · 识别（无 GUI 依赖，可单测）
├─ crates/fontnest-cli      调试 CLI：扫描/识别/自测/诊断
└─ src-tauri                Tauri 2 壳：命令搬运 + 自定义协议
src/                        React 19 + TypeScript 前端
```

**为什么把核心拆出来**：`fontnest-core` 不依赖 Tauri，也不依赖任何窗口系统。
所以整条链路都能在终端里验证——

```bash
cargo run -p fontnest-cli -- scan                      # 扫描摘要
cargo run -p fontnest-cli -- diag                      # 体检：哪些字体读不出来
cargo run -p fontnest-cli -- selftest --count 30       # 随机抽样自测识别准确率
```

后端出问题时先在这里定位，再去怀疑 IPC。

---

## 平台支持

| 功能 | Windows | macOS | Linux |
|---|---|---|---|
| 扫描 / 预览 / 搜索 / 收藏 / 分类 | ✅ | ✅ | ✅ |
| 截图识别 | ✅ | ✅ | ✅ |
| 启用 / 停用（安装到系统） | ✅ 当前用户级 | ❌ 未实现 | ❌ 未实现 |
| 原生文件夹选择器 | ✅ | ✅ | ✅ |
| 安装包 | ⏳ 待打包 | ⏳ | ⏳ |

macOS / Linux 上「启用」会明确返回"当前平台尚未实现"，而不是静默失败。

---

## 已知限制

- **安装后端只有 Windows。** macOS 需要 CoreText、Linux 需要 fc-cache，都还没写。
- **不支持 WOFF / WOFF2。** 这类文件会被扫描跳过，但会**在界面上报出跳过了多少个**，不会静默消失。
- **字体识别只对干净图有效**，详见[能力边界](#能力边界)。
- **没有打包产物。** `bundle.active` 仍是 false，没做过安装器。
- **尚未添加 LICENSE 文件。** 在补上之前，默认保留所有权利。

---

## 开发

```bash
pnpm install
pnpm dev              # 前端热更新（mock 数据）
pnpm desktop          # 桌面应用
pnpm build            # tsc --noEmit && vite build
pnpm test             # vitest

cargo test -p fontnest-core
cargo check --workspace
```

### 隔离沙箱

设置一个环境变量，整个后端就活在一个临时世界里（数据目录、字体目录、注册表全部隔离），
端到端验证安装/卸载时**不会碰真实系统**：

```powershell
$env:FONTNEST_SANDBOX_DIR = "$env:TEMP\fn-sandbox"
```

---

## 文档

| 文档 | 内容 |
|---|---|
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | 产品计划、里程碑、决策记录 |
| [docs/FRONTEND.md](docs/FRONTEND.md) | 前端架构、状态模型、设计语言 |
| [docs/BACKEND.md](docs/BACKEND.md) | 后端结构、IPC 契约、实测数据、被否决的方案 |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | 首次引导的分步设计稿 |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 交接说明：现状、踩过的坑、下一步 |

---

## 致谢

字体解析与栅格化依赖 [swash](https://github.com/dfrg/swash)，
界面基于 [Tauri](https://tauri.app) 与 [React](https://react.dev)，
图标与视觉规范来自本项目自己的三个原型迭代（已从版本库移除，仅保留结论）。
