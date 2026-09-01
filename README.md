# steam-crack-status

一些个人使用的篡改猴（Tampermonkey）脚本集合。

## 目录说明

所有脚本都放在 [src/](src) 目录下：

- [src/steam-crack-status.js](src/steam-crack-status.js)：本仓库的主要脚本。在 Steam 商店游戏页面自动查询并显示该游戏的破解状态（数据来自 [gamestatus.info](https://gamestatus.info)），并提供跳转到 [gamer520.com](https://www.gamer520.com) 搜索该游戏的按钮。
- [src/others/](src/others)：其他一些篡改猴脚本，与主脚本无直接关联。
  - [gamer520-netdisk-qr-jump.js](src/others/gamer520-netdisk-qr-jump.js)：在 gamer520.com 网站页面上，自动识别百度网盘 / 夸克网盘的二维码或文字链接，并结合附近的提取码使其可一键点击跳转。

## 安装

在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展后，打开对应的 `.js` 文件，点击「Raw」按钮，Tampermonkey 会自动识别并提示安装。
