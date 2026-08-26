# 虎牙直播自动切换画质

一个用于 **虎牙直播** 的用户脚本：自动跳过扫码限制的画质，并自动切换到最高画质或你指定的画质。通过 Tampermonkey / Violentmonkey 等浏览器扩展运行。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
   （Chrome / Firefox / Edge 均支持，Violentmonkey 同样适用）

2. 以下方式任选其一：

   **[点击安装 huya-enhancer.user.js](https://github.com/psa1K/huya-enhancer/raw/refs/heads/main/huya-enhancer.user.js)**

   或前往 [Greasyfork](https://greasyfork.org/zh-CN/scripts/542837) 安装

## 功能

- 跳过扫码解锁限制（蓝光等画质无需登录 App 扫码）
- 默认自动切换到最高画质
- 可选：自动切换到指定画质
- 自动进入剧场模式（可通过配置关闭）

## 自定义配置（可选）

打开脚本文件，顶部有两个配置项：

1. 指定画质（默认留空 = 自动切换到最高画质）：
   ```js
   const TARGET_QUALITY = ""; // 例如 "蓝光4M"，须与页面显示完全一致
   ```
2. 自动剧场模式（默认开启）：
   ```js
   const THEATER_MODE = true; // false = 进入直播间不自动开剧场模式
   ```

## 工作方式

脚本在进入直播间后每秒检查一次画质列表：

- 等页面完全加载完成后才开始动作（最多等 8 秒兜底），避免干扰加载过程；
- 画质就位后自动停止轮询，之后可自由手动切换；
- 最长等待 30 秒，超时自动停止（弱网环境下也不会一直干扰）。

## 已知限制

- "跳过扫码"通过修改播放器内部数据实现，虎牙前端改版后可能失效。
- 页面需加载完成后才会生效；若播放器加载超过 30 秒，本次不会自动切换。

## License

[MIT](LICENSE)
