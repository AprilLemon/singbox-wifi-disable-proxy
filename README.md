# WIFI 禁用代理插件

适用于 [GUI.for.SingBox](https://github.com/GUI-for-Cores/GUI.for.SingBox)（也兼容 GUI.for.Clash 等 GUI.for.Cores 系列客户端）的插件。

## 功能

当 WIFI 发生切换时，如果新连接的 WIFI 名称（SSID）在配置界面里由用户手动填写的列表中，插件就自动**停止代理**。

由于客户端没有提供「WIFI 切换」触发器，插件采用**定时轮询系统命令**的方式检测当前 SSID：

| 系统 | 使用命令 |
| --- | --- |
| Windows | `netsh wlan show interfaces` |
| macOS | `airport -I`，回退 `networksetup -getairportnetwork` |
| Linux | `nmcli` / `iwgetid` |

首次运行只记录当前 SSID 作为基线，之后只有发生实际切换才判断，避免启动时误停。

## 部署地址（raw 链接）

插件已部署到公开仓库，可直接用于插件中心的「链接安装」：

- 插件源码：`https://raw.githubusercontent.com/AprilLemon/singbox-wifi-disable-proxy/main/plugin-wifi-disable-proxy.js`
- 元数据：`https://raw.githubusercontent.com/AprilLemon/singbox-wifi-disable-proxy/main/plugin-wifi-disable-proxy.meta.json`
- 仓库主页：https://github.com/AprilLemon/singbox-wifi-disable-proxy

## 文件说明

- `plugin-wifi-disable-proxy.js`：插件源码（ESM 格式）
- `plugin-wifi-disable-proxy.meta.json`：插件元数据与配置定义（可用于插件中心收录或参考）

## 安装使用

### 方式一：在客户端内新建插件

1. 打开客户端 →「插件」→ 新建插件，名称填写 `WIFI禁用代理`
2. 将 `plugin-wifi-disable-proxy.js` 的完整内容粘贴到源码编辑器
3. 触发器勾选：`on::manual`（运行按钮）、`on::ready`（APP 就绪后）
4. 添加右键菜单：`启动监测 → Start`、`停止监测 → Stop`
5. 按 `plugin-wifi-disable-proxy.meta.json` 中的 `configuration` 添加配置项（key / 组件类型 / 默认值需一致）
6. 保存后，右键插件卡片 →「配置插件」，在「需要禁用代理的 WIFI 名称」中填入目标 SSID
7. 点击插件的运行按钮（或核心状态区的开关）启动监测

### 方式二：作为插件中心插件

将源码与元数据提交到 [Plugin-Hub](https://github.com/GUI-for-Cores/Plugin-Hub)，审核通过后可在客户端插件中心一键安装。

## 配置项

| 配置 key | 说明 | 默认值 |
| --- | --- | --- |
| `WifiList` | 需要禁用代理的 WIFI 名称列表 | 空 |
| `CheckInterval` | 检测间隔（秒），最小 3 | 5 |
| `StopAction` | 停止方式：both / kernel / system | both |
| `MatchMode` | connect（连上目标 WIFI 停止）/ leave（离开目标 WIFI 停止） | connect |
| `Notify` | 停止时是否弹出提示 | true |

## 行为说明

- 状态码：运行时返回 `1`，手动停止返回 `2`，未配置 WIFI 名称时不启动
- APP 重启后，若插件处于运行状态（status=1），`onReady` 会自动恢复监测
- `StopAction` 为 `both` 时会同时清除系统代理并停止内核；若只使用 TUN 模式，可按需选择 `kernel`
- 插件被禁用/卸载时（`onDispose`）会清除定时器与界面开关，不残留后台任务
