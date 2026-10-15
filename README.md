# dsh-sidebar-tab-actions

给 dsh Web GUI 右侧栏的标签右键菜单补上该有的那几个操作。装之前菜单里只有一条「关闭」，装之后同一个菜单变成：

```
关闭              ← 套件自带的
────────────────
📌 固定
关闭其他
关闭右侧
关闭左侧
关闭全部          ← 危险色
```

只跟 dsh 0.2.0-rc.2 及之后的版本对齐，只在浏览器半边运行，host 半边是空的。

## 行为

| 菜单项 | 关掉什么 |
|---|---|
| 固定 / 取消固定 | 切换当前标签的固定状态，按会话持久化 |
| 关闭其他 | 同一分栏里除自己以外的全部标签 |
| 关闭右侧 | 同一分栏里排在自己右边的全部标签 |
| 关闭左侧 | 同一分栏里排在自己左边的全部标签 |
| 关闭全部 | 同一分栏的全部标签，包括自己 |

文案刻意压到两到四字，跟 dsh 自己那套 dock 词汇（`关闭`／`分栏`／`全屏`）同一种语感——菜单里只有套件那条「关闭」是两字、其余都四字以上，读起来会跳。

五条规则，一句话说完：

1. **固定标签不被任何批量关闭动到**，四个关闭项都会跳过它。
2. **目标为空的项不出现**。右键第一个标签时没有「关闭左侧」，整个分栏只剩一个标签时四个关闭项全不出现。
3. **顺序就是屏幕上看到的顺序**。dsh 按分栏自己的标签数组画 chip，所以 DOM 顺序就是布局顺序。
4. **唯一停靠的引导页不算可关闭**，那种分栏上只剩下「固定」一项，和 dsh 自己藏掉关闭按钮的规则一致。
5. **固定状态按会话存**，键是 `dsh.sidebar-tab-actions.pins.v1.<sessionId>`，刷新页面和重启应用都还在。

固定的 chip 会在标题左边出一枚图钉。

## 已知限制

- **固定拦不住单点关闭。** chip 上的 × 和套件自带的「关闭」由 dsh 自己决定，插件没有席位去否决。所以固定的语义是「不被批量关掉」，跟 VS Code、Chrome 的固定标签可以单独关闭是一致的。
- **批量关闭会产生多条撤销记录。** dsh 的 `ISidebarRight` 只有单个 `close(tabId)`，关 N 个标签就是 N 步撤销，和手动逐个关闭一样。
- **关掉分栏最后一个标签会让整列收起**，这是 dsh 自身规则，「关闭全部」因此可能把右栏收起来。固定一个标签就能避免。
- **固定按标签 id 记，不按内容记。** 关掉再重新打开同一个文件，固定会丢——dsh 的 chip 上只有标签 id 可读，而 VS Code 的 pin 也是绑定在 editor 实例上的。
- **图钉是 DOM 装饰。** 插件往 chip 上写一个自己拥有的 `data-dsh-tab-pinned` 属性并注入一张样式表，随插件一起回收。不想要就配 `badge: false`。

## 安装

```sh
git clone https://github.com/zhaoruizhe81/dsh-sidebar-tab-actions.git
cd dsh-sidebar-tab-actions

# 先退出 DeepSeek Harness，profile 的 package.json 有文件锁
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add link:"$PWD"
```

装完重新打开 App。`dsh` 会把包名写进 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`，包里的 `cordis.patch.yml` 再作为 bundle 层把插件行插进 roster——profile 自己的 `cordis.patch.yml` 不用动。

两个可能绊到你的地方：

- **`cli/bin/dsh` 没有可执行位**，直接跑会 `Permission denied`，用 `sh "<那个路径>"` 调。
- **`ERR_PNPM_IGNORED_BUILDS` 会让退出码非零**，于是 `dsh` 跳过自动写 `dsh.profile.bundles` 那一步。依赖和软链已经装好了，手动把 `"dsh-sidebar-tab-actions"` 加进 `dsh.profile.bundles` 数组末尾即可。（那几条被忽略的构建脚本来自 profile 里既有的 `@google/genai`、`protobufjs`，跟本插件无关。）

卸载：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop remove dsh-sidebar-tab-actions
```

或者在「设置 → 插件」里直接停用这个 bundle。

## 配置

在 profile 的 `cordis.patch.yml` 里用同一个 id 覆盖：

```yaml
- id: sidebar-tab-actions
  name: dsh-sidebar-tab-actions
  config:
    badge: false        # 关掉固定标签的 chip 图钉
```

## 改代码

`lib/client.js` 就是产物本身，没有构建步骤——它是按 dsh 客户端模块系统要求的闭包工厂形状手写的，只 require 模块表里的基线条目（React、`dsh-client-store`、`dsh-client-ui-primitives`）。

**保存即生效：不用刷新，不用重启，也不用在设置里停用再启用。**

host 侧的 `dsh-client-hmr` 按固定间隔 stat 轮询每个 bundle 的 `client.js`（刻意用轮询——网络挂载不产生 inotify 事件），mtime / ctime / size 一变就换掉该 row 的 revision，通过 `/plugins/events` 的 SSE 推给页面，页面随即重新 import 这一行；插件的 effect 先拆再装，新文案直接上屏。实测从写盘到页面拿到新 revision 在秒级。

改动包元数据（`package.json` 的 `dsh.client`、`cordis.patch.yml`）或 profile 的 `dsh.profile.bundles` 也算数：profile HMR 监视 profile 的 `package.json` 与两层 `cordis.patch.yml`，一有变化就重算补丁并 `reconcile` 到运行中的 loader，同样不需要重启——本插件第一次加载就是这么上线的（加完 bundles 条目 2 秒后页面就拉到了 bundle）。

```sh
npm test          # 41 项，纯 node:test，无依赖
```

测试覆盖纯逻辑（目标集合计算、分栏读取、固定集合读取、图钉样式表）、注册接线、组件渲染出的行与点击顺序，以及在假 DOM 上跑的图钉装饰器安装/标记/回收。

## 为什么这么写

dsh 右侧栏的标签菜单只有一个扩展位：`sidebar.right.tab.menu.item`，需要 `sidebarRight` 服务，并且**不允许**插件拿到分栏的标签列表——`ctx.sidebarRight` 上只有 `close` / `focus` / `openTab` 这些动作，没有任何读取接口。

所以这个插件从三个公开契约上取信息：

- **菜单内容**走 `sidebar.right.tab.menu.item` 席位，菜单行用共享原件 `MenuItemButton` 渲染（它本身就是 `role="menuitem"`，dsh 靠这个角色判断菜单是不是空的）。
- **分栏里的标签顺序**从 chip 的标记读：`[data-dockkit-tab]` 在 `[data-dockkit-strip-tabs]` 里的文档顺序，也就是 dsh 自己读自己那一行 chip 的方式。
- **当前会话**从 `[data-sidebar-right-session]` 读，用来定位这个会话自己的固定集合。

固定集合存在插件自己的一个 `defineStore` 里（会话作用域 + `persist`），组件通过 store 席位读写，装饰器读自己那个 localStorage 键。
