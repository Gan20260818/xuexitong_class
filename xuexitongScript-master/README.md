# 学习通自动刷课脚本 V3 稳定版

当前版本以 `v3_optimized.js` 为**唯一源码**，`v3_optimized.user.js` 是「油猴元数据块 + 同一份源码」——仓库里**已不再包含构建脚本**，两个文件需要**手工保持一致**。当前油猴版版本号见 `v3_optimized.user.js` 的 `@version`（**3.8.1**）。

它聚焦于稳定播放与课程导航：

- 自动播放视频
- 视频结束后先切换到**同一小节的下一个任务点**，本节任务点全部走完才进下一小节
- 一个知识点下挂着多个视频任务点时逐个连播，不遗漏
- 章节测验页面的受限跳转（最多尝试 3 次，防止循环）
- 从“学习目标”步骤自动切到“视频”步骤
- 手动点任务点标签后自动重新接管播放

这版的目标是保持原模板的行为方式，不再额外叠加复杂的后台保活、通知、测试按钮等附加层，尽量减少冲突。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `v3_optimized.js` | **唯一源码**，控制台直接执行版本 |
| `v3_optimized.user.js` | Tampermonkey 油猴版本 = 元数据块 + 上面同一份源码 |
| `read and utilise immediately.txt` | 三步快速上手说明 |
| `image/` | 上手截图：`图1.png` 打开课程页、`图2.png` `F12` 控制台 |

> 两个 `.js` 的**正文必须逐字节一致**，只有 `v3_optimized.user.js` 开头多一段 `// ==UserScript==` 元数据块。改了一个记得同步另一个。

## 当前脚本行为

### 1. 学习目标页

如果当前小节先进入的是“学习目标”而不是视频页，脚本会尝试点击顶部的 `2视频` / `视频` 标签进入视频步骤。

说明：
- 这条路径已经按当前页面结构收紧，只走顶部视频标签，不再点击底部 `下一节` 按钮
- 原因是底部按钮在当前页面里可能触发额外调试/暂停逻辑，稳定性较差

### 2. 视频页

进入视频页后，脚本会：

- 识别 iframe 内的真实视频元素
- 自动调用 `play()`
- 如果播放被短暂中断，则尝试恢复播放
- 如果普通播放失败，则尝试静音播放

当前默认配置：

```javascript
configs: {
    playbackRate: 1,
    autoplay: true,
    retryInterval: 2000,
    maxRetries: 10,
    videoCheckInterval: 1000,
    guardNoProgressMs: 7000,
    guardResumeCooldownMs: 1500,
    autoAdvanceNoVideo: false,
}
```

### 3. 视频结束后

视频触发结束事件（`ended`）后，脚本调用 `nextUnit()`：

1. 先 `_advanceTaskpoint()` —— 优先推进到**同一小节的下一个任务点**（详见下一节）
2. 本节任务点全部走完后，才回课程目录树定位并点击**下一小节**

这条链路上如果一直找不到视频，会先按次数重试再打印明确日志后停止，不会静默卡住。

### 4. 小节内有多个任务点（知识点）

超星允许一个小节拆成多个任务点，在播放器上方以标签条展示，例如：

```
1 原始社会 | 2 奴隶社会 | 3 古希腊科学 | 4 古希腊哲学
```

**这里有个容易踩的坑：标签条不是任务点序列，而是「知识点」分组。**
实测数据：某个小节标签条只有 4 项，而 `.ans-attach-ct.videoContainer` 有 **8 个** —— 也就是说**一个知识点下面可能挂着多个视频任务点**。所以「点下一个标签」会整块跳过知识点，漏掉它下面的第 2 个任务点。

因此脚本的导航**只认任务点容器在文档中的顺序**（实测范围约 1~10 个，不做任何固定数量假设）：

```html
div.wrap > #pageDivans-cc
  <p sequence-id="1">
  <div class="ans-attach-ct videoContainer"><iframe 播放器 /></div>   <!-- 任务点 1 -->
  <p sequence-id="2">
  <div class="ans-attach-ct videoContainer"><iframe 播放器 /></div>   <!-- 任务点 2 -->
```

- 容器可能在顶层文档，也可能在内层 `#iframe` 里 → 用 `_collectContainers()` 跨 iframe 递归收集
- 判断某个 video 属于哪个容器 → 用 `ownerDocument.defaultView.frameElement` 逐层爬 iframe 链（`contains()` 跨不了 iframe）
- 导航流程：`nextUnit()` → `_advanceTaskpoint()` → `_advanceByContainer()`（取当前容器下标 +1）→ 走完本节的容器才回目录树跳下一节
- 若某个任务点不是视频（课件/讨论等），因为只收集 `.videoContainer`，讨论区**根本不会进入任务点列表**，自然跳过

#### 为什么不能用标签条 / 平台的「下一节」按钮

| 元素 | onclick | 后果 |
| --- | --- | --- |
| 标签条 `#prev_tab li` | `changeDisplayContent(知识点序号, 知识点总数, ...)` | 按知识点跳，漏掉知识点下的第 2 个任务点 |
| 「下一节」`#prevNextFocusNext` | `PCount.next('4', ...)`（`count` = 知识点数） | **实测**点击后 URL 直接从 `chapterId=1224365416` 跳到 `1224365418`（下一节），同样会漏 |

#### 怎么把下一个任务点拉起来（实测有效）

堆叠的播放器**已经带好 `src`**，但 `preload="none"` + `autoplay=false`，所以它不会自己加载 —— 平台是等用户去点播放按钮的。脚本只需显式拉起：

```javascript
targetVideo.load();   // 触发资源加载
targetVideo.play();   // 开始播放
```

实测：`readyState=0 dur=0` → `readyState=4 dur=1177 paused=false`，而且**平台自己的播放器 UI 会跟着走**（暂停按钮、时间、进度条都正常），说明进度上报不受影响。

#### 一条重要的健壮性约束

`_getVideoEl()` **只要页面上存在 `<video>`，就绝不返回 `null`**。切换小节时若因“没找到理想的新播放器”而返回 `null`，整个流程会直接卡死 —— 这是 3.8.0 引入过的回归：旧版是“拿到哪个用哪个”所以能继续走，严格返回 `null` 就停住了。找不到理想目标时会退回可用播放器并打印日志：

```
未找到理想的新播放器，退回可用播放器（避免卡住）
```

#### 调试命令

```javascript
app.dumpTabs()            // 打印标签条、视频容器数量、每个 video 的状态
app.probeNextTaskpoint()  // 对下一个任务点逐个试 4 种激活方式，报告哪种有效
app.nextUnit()            // 手动推进到下一个任务点/小节
```

### 5. 章节测验

如果当前不是视频而是“章节测验”页面，脚本会尝试点击：

```javascript
#prevNextFocusNext
```

以跳过当前测验步骤并继续后续流程。

## 使用方法

> 最快上手路径见 `read and utilise immediately.txt`：打开课程页（`image/图1.png`）→ `F12` 控制台（`image/图2.png`）粘贴源码运行；有浏览器扩展就用油猴版。

### 方法一：控制台执行（临时用）

1. 打开学习通课程播放页（对应 `image/图1.png`）
2. 按 `F12` → 进入 `Console`（对应 `image/图2.png`）
3. 打开 `v3_optimized.js` → `Ctrl+A` 全选 → `Ctrl+C`
4. 粘贴到控制台 → 回车执行

首次执行后可用：

```javascript
app.run()       // 重新初始化并接管当前页
app.nextUnit()  // 手动推进到下一个任务点/小节
```

> ⚠️ **刷新页面后需要重新粘贴一次**（控制台注入的代码不跨页面加载）。
> 嫌重复粘贴麻烦的话：`F12` → **「源代码 / Sources」→「代码段 / Snippets」** 新建一段保存起来，以后每次刷新后按 `Ctrl+Enter` 运行即可。

### 方法二：Tampermonkey（推荐，长期使用）

1. 安装 Tampermonkey 扩展，并在扩展详情里把**网站访问权限设为「在所有网站上」**
2. **完全重启浏览器**（权限变更需重启才生效）
3. 篡改猴 → **管理面板 → 实用工具 → 导入文件** → 选 `v3_optimized.user.js` → **安装**
4. 确认列表里**版本 = 3.8.1**、状态**已启用**
5. 打开课程播放页并按 `F5` 刷新

验证是否生效（`F12` → Console）：

```javascript
typeof window.__xuexitongPlayerV3   // 应为 "object"
typeof app._advanceByContainer      // 应为 "function"
```

## 已知说明

### 1. 无视频或课件页面

默认不会自动跳过无法识别的无视频页面，避免在课件未完成时反复触发“当前章节还有任务未完成”的平台提示。控制台会给出明确日志；确认当前节点无需处理后，可手动执行 `app.nextUnit()`。

如果课程结构已确认安全，才可在控制台将 `app.configs.autoAdvanceNoVideo = true`，让脚本自动切换无视频小节。

### 2. 为什么有时会看到 `AbortError`

常见报错：

```text
The play() request was interrupted by a call to pause()
```

这通常不是视频坏了，而是：

- 页面从步骤页切到视频页时，播放器初始化会短暂停一下
- 页面内部脚本会在加载过程中重置播放状态
- 浏览器对媒体播放请求进行了短暂中断

脚本会优先尝试恢复播放，而不是立即判定失败。

### 3. 为什么会出现重复日志

如果同一页面反复粘贴执行脚本，会导致同一套监听和定时逻辑叠加，从而出现多次日志。

建议：

- 刷新页面后只执行一次
- 如果使用油猴版，尽量不要再在控制台重复粘贴执行

### 4. 为什么“静音播放成功”但一开始还能听到声音

旧逻辑里曾经会在静音启动成功后恢复声音。当前建议使用持续静音方式，不再自动恢复。

## 当前调试结论

目前这版已经验证：

- 顶部 `2视频` 标签可以程序化点击
- 手动进入视频页后可以自动播放
- 静音恢复链路可用
- **同一小节内的多个任务点按容器顺序依次连播，不再漏知识点下的第 2 个任务点**
- **跨小节跳转正常**（1.2 → 1.3），不会因为找不到理想播放器而卡住

实测过程中被证伪 / 修正过的做法（避免重复踩坑）：

| 做法 | 结果 |
| --- | --- |
| 按标签条 `li.active` 推进任务点 | ❌ 标签是知识点分组，会漏任务点 |
| 调平台原生 `PCount.next` | ❌ 同样按知识点跳，实测直接跳到下一节 |
| 用播放器"可见性"判断当前任务点 | ❌ 8 个播放器全部 `display:block`，区分不出来 |
| 用"是否加载了元数据"判断 | ⚠️ 可用，但新任务点初始 `readyState=0`，只能作优先项 |
| 切小节时在 `_getVideoEl()` 里返回 `null` | ❌ **会卡死**（3.8.0 的回归，3.8.1 已修） |
| 目标容器有 `src` 时直接 `load() + play()` | ✅ **实测有效** |

目前重点保留的是稳定性，不再继续叠加额外功能。

## 维护与验证

仓库里**已不包含构建脚本与测试脚本**，两个入口需要**手工保持一致**：

1. 改完 `v3_optimized.js` 后，把同样的改动同步到 `v3_optimized.user.js` 的**正文部分**（不要动它的元数据块）
2. 校验正文是否逐字节一致（PowerShell）：

```powershell
$a = 'd:\xuexitongScript-master\v3_optimized.js'
$b = 'd:\xuexitongScript-master\v3_optimized.user.js'
$marker = '// ==/UserScript=='
$src = (Get-Content -Raw $a) -replace "`r`n", "`n"
$us  = (Get-Content -Raw $b) -replace "`r`n", "`n"
$p   = $us.Substring($us.IndexOf($marker) + $marker.Length + 2)
"IDENTICAL = $($src -ceq $p)"
```

3. `.user.js` 里 `// ==/UserScript==` 后面**必须保留一个空行**，否则上面这段比对会失败
4. 改完油猴版后，要在篡改猴里**重新导入一次**才会生效（脚本只在页面加载时注入，记得 `F5`）


## 免责声明

本项目仅用于脚本调试、前端自动化研究和页面行为分析，请遵守目标平台的使用规定。
