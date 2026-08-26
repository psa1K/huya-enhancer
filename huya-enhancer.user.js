// ==UserScript==
// @name         虎牙直播自动切换画质
// @namespace    https://github.com/psa1K
// @icon         https://www.huya.com/favicon.ico
// @version      1.3.2
// @description  功能：虎牙直播跳过扫码限制、自动切换最高画质、自动切换指定画质、自动进入剧场模式
// @author       psa1K
// @match        *://*.huya.com/*
// @grant        none
// @license      MIT
// @noframes
// @run-at       document-idle
// @downloadURL https://github.com/psa1K/huya-enhancer/raw/refs/heads/main/huya-enhancer.user.js
// ==/UserScript==

(function () {
	// 指定要切换到的画质名称（须与页面显示完全一致，如 "蓝光4M"）；留空 = 自动切换到最高画质
	const TARGET_QUALITY = "";
	// 进入直播间后自动开启剧场模式；false = 关闭该功能
	const THEATER_MODE = true;
	const POLL_INTERVAL_MS = 1000;
	const MAX_WAIT_MS = 30000;
	// 页面 load 事件迟迟不触发时的兜底等待上限，超时后照常开始
	const LOAD_WAIT_FALLBACK_MS = 8000;

	let elapsed = 0;
	let theaterDone = false;
	let pageSettled = document.readyState === "complete";
	if (!pageSettled) {
		window.addEventListener("load", () => { pageSettled = true; }, { once: true });
	}

	const timer = setInterval(() => {
		elapsed += POLL_INTERVAL_MS;
		if (elapsed >= MAX_WAIT_MS) {
			clearInterval(timer);
			return;
		}
		// 等页面完全加载完再动作：加载中途点击会注入额外挂起请求，
		// 导致标签页转圈不止（load 事件被无限推迟）
		if (!pageSettled && elapsed < LOAD_WAIT_FALLBACK_MS) return;
		pageSettled = true; // 兜底：load 卡死也继续工作
		if (typeof $ !== "function") return;

		const $list = $(".player-videotype-list li");
		const $cur = $(".player-videotype-cur");
		if ($list.length === 0 || $cur.length === 0) return;

		// --- 解锁扫码限制的画质 ---
		$list.each((_, li) => {
			const dataObj = $(li).data("data");
			if (dataObj && dataObj.status !== 0) {
				dataObj.status = 0;
			}
		});

		// 只读取画质名（li 内第一个 span），避免"扫码即享"等徽标文本干扰匹配
		const itemText = (el) => {
			const span = el.querySelector ? el.querySelector("span") : null;
			return ((span && span.textContent) || el.textContent || "").trim();
		};

		const current = $cur.text().trim();
		const target = TARGET_QUALITY ? TARGET_QUALITY.trim() : itemText($list[0]);
		if (!target) return;

		if (current === target) {
			// --- 自动进入剧场模式：画质就位后最后执行，避免与画质切换互相干扰 ---
			if (THEATER_MODE && !theaterDone) {
				const btnEl = $("#player-fullpage-btn")[0];
				if (btnEl && (!btnEl.style || btnEl.style.display !== "none")) {
					btnEl.click();
					theaterDone = true;
				}
			}
			clearInterval(timer); // 已就位：停止轮询，之后可自由切换画质
		} else {
			const $target = $list.filter((_, el) => itemText(el) === target);
			if ($target.length > 0) {
				$target[0].click();
			}
		}
	}, POLL_INTERVAL_MS);
})();
