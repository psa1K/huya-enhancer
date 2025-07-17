// ==UserScript==
// @name         虎牙直播自动切换画质
// @description  功能：虎牙直播自动切换最高画质、自动切换指定画质
// @namespace    https://github.com/psa1K
// @icon         https://www.huya.com/favicon.ico
// @version      1.0.0
// @author       psa1K
// @match        *://*.huya.com/*
// @grant        none
// @license      WTFPL
// @noframes
// ==/UserScript==

(function () {
  const switchToTopQuality = setInterval(() => {
    const $cur = $(".player-videotype-cur");
    const $list = $(".player-videotype-list li");

    if ($cur.length === 0 || $list.length === 0) return;

    if ($cur.text().trim() !== $list.first().text().trim()) {
      $list.first().click();
    } else {
      clearInterval(switchToTopQuality);
    }
  }, 1000);
})();

//如果你希望自动切换到特定的画质，只需将下面的 targetQuality 参数设置为你想要的画质，并删除其他多余的代码，然后取消注释以下代码即可。
/*
(function () {
    const targetQuality = '蓝光4M';//修改此处
    const switchToTopQuality = setInterval(() => {
        if ($('.player-videotype-cur').length === 0 || $('.player-videotype-list li').length === 0) return;

        if ($('.player-videotype-cur').text().trim() === targetQuality) {
            clearInterval(switchToTopQuality);
            return;
        }

        const $match = $('.player-videotype-list li').filter((_, el) => $(el).text().trim() === targetQuality);
        if ($match.length > 0) {
            $match.click();
            clearInterval(switchToTopQuality);
        }
    }, 1000);
})();
*/
