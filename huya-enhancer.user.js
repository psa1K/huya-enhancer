// ==UserScript==
// @name         虎牙直播自动切换画质
// @namespace    https://github.com/psa1K
// @icon         https://www.huya.com/favicon.ico
// @version      1.4.0
// @description  功能：虎牙直播跳过扫码限制、自动切换最高画质、自动切换指定画质、自动进入剧场模式，支持脚本菜单配置视图与画质
// @author       psa1K
// @match        *://*.huya.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @license      MIT
// @noframes
// @run-at       document-idle
// @downloadURL https://github.com/psa1K/huya-enhancer/raw/refs/heads/main/huya-enhancer.user.js
// ==/UserScript==

(function () {
	// 未在脚本菜单中设置过时的默认值
	const DEFAULT_VIEW_MODE = "theater"; // "default" | "theater"
	const DEFAULT_TARGET_QUALITY = ""; // 留空 = 跟随房间最高画质
	const POLL_INTERVAL_MS = 1000;
	const MAX_WAIT_MS = 30000;
	// 页面 load 事件迟迟不触发时的兜底等待上限，超时后照常开始
	const LOAD_WAIT_FALLBACK_MS = 8000;

	const gmGet = (key, def) => (typeof GM_getValue === "function" ? GM_getValue(key, def) : def);
	const gmSet = (key, val) => {
		if (typeof GM_setValue === "function") GM_setValue(key, val);
	};
	const getViewMode = () => gmGet("viewMode", DEFAULT_VIEW_MODE);
	const getTargetQuality = () => gmGet("targetQuality", DEFAULT_TARGET_QUALITY);

	// 沙箱模式下页面 jQuery 需经 unsafeWindow 获取
	const pageWin = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
	const getPageJQuery = () => (typeof pageWin.$ === "function" ? pageWin.$ : null);

	let elapsed = 0;
	let layoutDone = false;
	let qualityDone = false;
	let pageSettled = document.readyState === "complete";
	if (!pageSettled) {
		window.addEventListener("load", () => { pageSettled = true; }, { once: true });
	}

	// ---------- 脚本菜单 ----------
	const menu = { ids: [], qualities: [] };
	function rebuildMenu() {
		if (typeof GM_registerMenuCommand !== "function") return; // 管理器不支持菜单 API 时跳过
		if (menu.ids.length > 0 && typeof GM_unregisterMenuCommand !== "function") return;
		menu.ids.forEach((id) => GM_unregisterMenuCommand(id));
		menu.ids = [];

		const vm = getViewMode();
		[["default", "视图：默认"], ["theater", "视图：剧场"]].forEach(([val, label]) => {
			menu.ids.push(GM_registerMenuCommand(
				(vm === val ? "✓ " : "") + label,
				() => { gmSet("viewMode", val); rebuildMenu(); },
			));
		});

		const tq = getTargetQuality();
		[["跟随房间最高", ""]].concat(menu.qualities.map((n) => [n, n])).forEach(([label, val]) => {
			menu.ids.push(GM_registerMenuCommand(
				(tq === val ? "✓ 画质：" : "画质：") + label,
				() => { gmSet("targetQuality", val); rebuildMenu(); },
			));
		});
		menu.ids.push(GM_registerMenuCommand("画质：手动输入…", () => {
			const input = prompt("输入画质名称（须与页面显示完全一致），留空 = 跟随房间最高画质：", tq);
			if (input === null) return;
			gmSet("targetQuality", input.trim());
			rebuildMenu();
		}));
		menu.ids.push(GM_registerMenuCommand("🔄 恢复默认设置", () => {
			gmSet("viewMode", DEFAULT_VIEW_MODE);
			gmSet("targetQuality", DEFAULT_TARGET_QUALITY);
			rebuildMenu();
		}));
	}
	rebuildMenu();

	// 只读取画质名（li 内第一个 span），避免"扫码即享"等徽标文本干扰匹配
	function itemText(el) {
		const span = el.querySelector ? el.querySelector("span") : null;
		return ((span && span.textContent) || el.textContent || "").trim();
	}
	function collectQualityNames($list) {
		const names = [];
		for (let i = 0; i < $list.length; i++) {
			const name = itemText($list[i]);
			if (name && names.indexOf(name) === -1) names.push(name);
		}
		return names;
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

		const jq = getPageJQuery();
		if (!jq) return;

		const $list = jq(".player-videotype-list li");
		const $cur = jq(".player-videotype-cur");
		if ($list.length === 0 || $cur.length === 0) return;

		// 房间真实画质列表就绪后，用它重建动态画质菜单
		if (menu.qualities.length === 0) {
			const names = collectQualityNames($list);
			if (names.length > 0) {
				menu.qualities = names;
				rebuildMenu();
			}
		}

		if (!qualityDone) {
			// --- 解锁扫码限制的画质（跨沙箱可能失败，降级不影响切换） ---
			try {
				$list.each((_, li) => {
					const dataObj = jq(li).data("data");
					if (dataObj && dataObj.status !== 0) {
						dataObj.status = 0;
					}
				});
			} catch (e) { /* 解锁失败不阻塞主流程 */ }

			const current = $cur.text().trim();
			const target = getTargetQuality() || itemText($list[0]);
			if (target) {
				if (current === target) {
					qualityDone = true;
				} else {
					const $match = $list.filter((_, el) => itemText(el) === target);
					if ($match.length > 0) {
						$match[0].click();
						return; // 等下一 tick 确认结果
					}
				}
			}
		}

		if (qualityDone && !layoutDone) {
			// --- 视图模式：画质就位后最后执行，避免与画质切换互相干扰 ---
			if (getViewMode() === "theater") {
				const btnEl = jq("#player-fullpage-btn")[0];
				if (btnEl && (!btnEl.style || btnEl.style.display !== "none")) {
					btnEl.click();
				}
			}
			layoutDone = true;
		}

		if (qualityDone && layoutDone) {
			clearInterval(timer); // 本房间动作全部完成：停止轮询，之后可自由切换
		}
	}, POLL_INTERVAL_MS);
})();
