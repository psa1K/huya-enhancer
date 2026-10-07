// ==UserScript==
// @name         虎牙直播增强
// @namespace    https://github.com/psa1K
// @icon         https://www.huya.com/favicon.ico
// @version      1.5.0
// @description  功能：虎牙直播跳过扫码限制、自动切换最高画质、自动切换指定画质、自动进入剧场模式、屏蔽广告推广/礼物特效/推荐直播，支持脚本菜单与播放器内嵌齿轮入口配置
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
	const DEFAULT_VIEW_MODE = "default"; // "default" | "theater"
	const DEFAULT_TARGET_QUALITY = ""; // 留空 = 跟随房间最高画质
	const POLL_INTERVAL_MS = 1000;
	const MAX_WAIT_MS = 30000;
	// 页面 load 事件迟迟不触发时的兜底等待上限，超时后照常开始
	const LOAD_WAIT_FALLBACK_MS = 8000;

	// 屏蔽分组：默认全开，可在脚本菜单逐项开关
	const BLOCK_GROUPS = [
		{
			key: "blockAds",
			label: "屏蔽：广告推广",
			def: true,
			selectors: [
				"#matchComponent2", // 直播间头图
				".diy-toutu2",
				"#room-hd-banner",
				"#J_roomGamePromote",
				"#J_roomSideTop",
				"#sidebarBanner",
				".sidebar-banner",
				"#match-cms-content", // 赛事 CMS 嵌入
			],
		},
		{
			key: "blockGifts",
			label: "屏蔽：礼物特效",
			def: true,
			selectors: [
				".room-player-gift-placeholder",
				"#J_treasureChestContainer",
				".treasureChestContainer",
				"#J_bigStreamerStage",
				".bigStreamerStage",
				"#wrap-income", // 弹幕区收礼 / 贵族进场提示
			],
		},
		{
			key: "blockReco",
			label: "屏蔽：推荐直播",
			def: true,
			selectors: [
				"#room-footer", // 推荐动态 / 猜你喜欢 / 推荐分类
				"#J_roomULike",
				".room-youlike",
				"#J_roomPersonalRecom",
				"#classify-recom",
				".classify-recom",
				"#room-moments",
				".room-moments",
				".sidebar-recom", // 左侧栏推荐分类
			],
		},
	];
	const BLOCK_STYLE_ID = "huya-enhancer-block-style";

	const gmGet = (key, def) => (typeof GM_getValue === "function" ? GM_getValue(key, def) : def);
	const gmSet = (key, val) => {
		if (typeof GM_setValue === "function") GM_setValue(key, val);
	};
	const getViewMode = () => gmGet("viewMode", DEFAULT_VIEW_MODE);
	const getTargetQuality = () => gmGet("targetQuality", DEFAULT_TARGET_QUALITY);

	// 沙箱模式下页面 jQuery 需经 unsafeWindow 获取
	const pageWin = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
	const getPageJQuery = () => (typeof pageWin.$ === "function" ? pageWin.$ : null);

	// 用 CSS 隐藏而非删除节点：虎牙 JS 持有这些节点的引用，删除易触发报错
	function applyBlockStyle() {
		const head = document.head || document.documentElement;
		if (!head) return;
		let style = document.getElementById(BLOCK_STYLE_ID);
		if (!style) {
			style = document.createElement("style");
			style.id = BLOCK_STYLE_ID;
			head.appendChild(style);
		}
		const selectors = BLOCK_GROUPS
			.filter((g) => gmGet(g.key, g.def))
			.reduce((acc, g) => acc.concat(g.selectors), []);
		style.textContent = selectors.map((s) => s + "{display:none !important;}").join("\n");
	}

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

		BLOCK_GROUPS.forEach((g) => {
			const on = gmGet(g.key, g.def);
			menu.ids.push(GM_registerMenuCommand(
				(on ? "✓ " : "") + g.label,
				() => { gmSet(g.key, !on); applyBlockStyle(); rebuildMenu(); },
			));
		});

		menu.ids.push(GM_registerMenuCommand("🔄 恢复默认设置", () => {
			gmSet("viewMode", DEFAULT_VIEW_MODE);
			gmSet("targetQuality", DEFAULT_TARGET_QUALITY);
			BLOCK_GROUPS.forEach((g) => gmSet(g.key, g.def));
			applyBlockStyle();
			rebuildMenu();
		}));
	}
	applyBlockStyle();
	rebuildMenu();

	// ---------- 播放器内嵌设置入口 ----------
	// 在礼物栏"充值"左侧插入一个齿轮按钮，点开是设置浮层（与脚本菜单读同一份配置）
	const BTN_ID = "huya-enhancer-settings-btn";
	const PANEL_ID = "huya-enhancer-panel";
	const HUYA_YELLOW = "#ffd200"; // 虎牙阳光黄
	const GEAR_SVG = '<svg viewBox="0 -8 24 37" width="24" height="37" fill="none" stroke="currentColor" ' +
		'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/>' +
		'<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
		'1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 ' +
		'1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 ' +
		'9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 ' +
		'1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 ' +
		'1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

	// 找礼物栏里"充值"那一项，作为插入锚点；找不到返回 null
	function findGiftBarAnchor() {
		const wrap = document.getElementById("player-gift-wrap");
		if (!wrap) return null;
		// 优先用已知 id（充值项 <li>），最稳定
		const byId = wrap.querySelector("#player-recharge-btn");
		if (byId) return byId;
		// 退路：按文字定位，并向上找到整项（父容器明显变宽时停住）
		if (typeof document.createTreeWalker !== "function") return null;
		const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_ELEMENT);
		let node, leaf = null;
		while ((node = walker.nextNode())) {
			if (node.childElementCount !== 0 || node.textContent.trim() !== "充值") continue;
			const r = node.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) { leaf = node; break; } // 只取可见的那个，避开隐藏模板
		}
		if (!leaf) return null;
		let el = leaf;
		while (el.parentElement && el.parentElement !== wrap) {
			const pw = el.parentElement.getBoundingClientRect().width;
			const ew = el.getBoundingClientRect().width;
			if (pw > ew + 40) break;
			el = el.parentElement;
		}
		return el;
	}

	function createSettingsButton() {
		const btn = document.createElement("div");
		btn.id = BTN_ID;
		btn.title = "设置";
		Object.assign(btn.style, {
			display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
			alignSelf: "center", gap: "2px", minWidth: "44px", margin: "0 4px", flex: "0 0 auto",
			cursor: "pointer", color: "#000", verticalAlign: "middle", lineHeight: "1",
		});
		btn.innerHTML = GEAR_SVG + '<span style="font-size:12px;">设置</span>';
		btn.addEventListener("mouseenter", () => { btn.style.color = HUYA_YELLOW; });
		btn.addEventListener("mouseleave", () => { btn.style.color = "#000"; });
		btn.addEventListener("click", (ev) => { ev.stopPropagation(); togglePanel(btn); });
		return btn;
	}

	function ensureSettingsEntry() {
		const wrap = document.getElementById("player-gift-wrap");
		if (!wrap) return;
		let btn = document.getElementById(BTN_ID);
		if (btn && !wrap.contains(btn)) { btn.remove(); btn = null; }
		if (!btn) btn = createSettingsButton();

		// 每次检查都纠偏：位置不对（含首次量错、被重建）就重新插到"充值"左侧
		const anchor = findGiftBarAnchor();
		if (anchor && anchor.parentElement) {
			const parent = anchor.parentElement;
			const cs = getComputedStyle(parent);
			// 反向排列（row-reverse / rtl）时 DOM 顺序与视觉相反：插到锚点后面才是视觉左侧
			const reversed = cs.flexDirection === "row-reverse" || cs.direction === "rtl";
			const ok = reversed ? btn.previousElementSibling === anchor : btn.nextElementSibling === anchor;
			if (btn.parentElement !== parent || !ok) {
				parent.insertBefore(btn, reversed ? anchor.nextSibling : anchor);
			}
		} else if (btn.parentElement !== wrap || btn !== wrap.firstElementChild) {
			wrap.insertBefore(btn, wrap.firstChild);
		}
	}

	function closePanel() {
		const p = document.getElementById(PANEL_ID);
		if (p) p.remove();
		document.removeEventListener("click", onDocClick, true);
		document.removeEventListener("keydown", onDocKey, true);
	}
	function onDocClick(ev) {
		const p = document.getElementById(PANEL_ID);
		const btn = document.getElementById(BTN_ID);
		if (p && !p.contains(ev.target) && btn && !btn.contains(ev.target)) closePanel();
	}
	function onDocKey(ev) { if (ev.key === "Escape") closePanel(); }

	function togglePanel(btn) {
		if (document.getElementById(PANEL_ID)) closePanel();
		else openPanel(btn);
	}
	function openPanel(btn) {
		closePanel();
		const p = buildPanel();
		document.body.appendChild(p);
		const r = btn.getBoundingClientRect();
		p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - p.offsetWidth - 8)) + "px";
		p.style.top = Math.max(8, r.top - p.offsetHeight - 8) + "px";
		setTimeout(() => {
			document.addEventListener("click", onDocClick, true);
			document.addEventListener("keydown", onDocKey, true);
		}, 0);
	}

	function buildPanel() {
		const p = document.createElement("div");
		p.id = PANEL_ID;
		Object.assign(p.style, {
			position: "fixed", zIndex: "2147483647", minWidth: "212px", maxWidth: "300px",
			background: "#fff", color: "#333", borderRadius: "8px", border: "1px solid #eee",
			boxShadow: "0 6px 24px rgba(0,0,0,.18)", padding: "10px 12px",
			font: "12px/1.7 -apple-system,'Microsoft YaHei',sans-serif",
			maxHeight: "70vh", overflowY: "auto",
		});

		const refresh = () => { const b = document.getElementById(BTN_ID); if (b) openPanel(b); };
		// 一次点击后既保存又按需重排菜单/样式
		const commit = (key, val, apply) => { gmSet(key, val); if (apply) apply(); rebuildMenu(); refresh(); };

		const section = (text) => {
			const h = document.createElement("div");
			h.textContent = text;
			Object.assign(h.style, { margin: "8px 0 4px", color: "#999" });
			p.appendChild(h);
		};
		const choices = (items) => {
			const box = document.createElement("div");
			Object.assign(box.style, { display: "flex", flexWrap: "wrap", gap: "6px" });
			items.forEach(([text, on, onPick]) => {
				const b = document.createElement("button");
				b.type = "button";
				b.textContent = text;
				Object.assign(b.style, {
					cursor: "pointer", font: "inherit", padding: "2px 8px", borderRadius: "4px",
					border: "1px solid " + (on ? HUYA_YELLOW : "#e3e3e3"),
					background: on ? HUYA_YELLOW : "#f7f7f7",
					color: "#333",
				});
				b.addEventListener("click", (ev) => { ev.stopPropagation(); onPick(); });
				box.appendChild(b);
			});
			return box;
		};

		const vm = getViewMode();
		section("视图");
		p.appendChild(choices([["默认", vm === "default", () => commit("viewMode", "default")],
			["剧场", vm === "theater", () => commit("viewMode", "theater")]]));

		const tq = getTargetQuality();
		section("画质");
		const qItems = [["跟随房间最高", tq === "", () => commit("targetQuality", "")]]
			.concat(menu.qualities.map((n) => [n, tq === n, () => commit("targetQuality", n)]));
		qItems.push(["手动输入…", false, () => {
			const input = prompt("输入画质名称（须与页面显示完全一致），留空 = 跟随房间最高画质：", tq);
			if (input === null) return;
			commit("targetQuality", input.trim());
		}]);
		p.appendChild(choices(qItems));

		section("屏蔽");
		p.appendChild(choices(BLOCK_GROUPS.map((g) => [g.label.replace(/^屏蔽：/, ""), gmGet(g.key, g.def),
			() => commit(g.key, !gmGet(g.key, g.def), applyBlockStyle)])));

		const reset = document.createElement("button");
		reset.type = "button";
		reset.textContent = "🔄 恢复默认设置";
		Object.assign(reset.style, {
			marginTop: "10px", width: "100%", cursor: "pointer", font: "inherit",
			padding: "4px 8px", borderRadius: "4px", border: "1px solid #e3e3e3",
			background: "#f7f7f7", color: "#333",
		});
		reset.addEventListener("click", (ev) => {
			ev.stopPropagation();
			gmSet("viewMode", DEFAULT_VIEW_MODE);
			gmSet("targetQuality", DEFAULT_TARGET_QUALITY);
			BLOCK_GROUPS.forEach((g) => gmSet(g.key, g.def));
			applyBlockStyle();
			rebuildMenu();
			refresh();
		});
		p.appendChild(reset);
		return p;
	}

	// 礼物栏由播放器异步渲染、可能被重建：先注入一次，之后仅在礼物栏发生变化时补回，
	// 避免常驻定时器（礼物栏尚未出现时短暂轮询，最多等 MAX_WAIT_MS）
	let entryTimer = 0;
	let entryObserver = null;
	let entryObservedWrap = null;
	function scheduleEnsureEntry() {
		if (entryTimer) return;
		entryTimer = setTimeout(() => {
			entryTimer = 0;
			observeGiftBar();
			ensureSettingsEntry();
		}, 200);
	}
	function observeGiftBar() {
		if (typeof MutationObserver !== "function") return false;
		const wrap = document.getElementById("player-gift-wrap");
		if (!wrap || !wrap.parentElement) return false;
		if (entryObserver && entryObservedWrap === wrap) return true;
		if (entryObserver) entryObserver.disconnect();
		entryObserver = new MutationObserver(scheduleEnsureEntry);
		entryObserver.observe(wrap, { childList: true, subtree: true }); // 礼物栏内部重建
		entryObserver.observe(wrap.parentElement, { childList: true }); // 礼物栏被整体替换
		entryObservedWrap = wrap;
		return true;
	}

	ensureSettingsEntry();
	if (!observeGiftBar()) {
		const retry = setInterval(() => {
			if (observeGiftBar()) { ensureSettingsEntry(); clearInterval(retry); }
		}, POLL_INTERVAL_MS);
		setTimeout(() => { ensureSettingsEntry(); clearInterval(retry); }, MAX_WAIT_MS);
	}

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

			// 优先切到指定画质；本房间不存在时回退到最高画质（不改写保存的偏好）
			const preferred = getTargetQuality();
			let target = "";
			if (preferred && $list.filter((_, el) => itemText(el) === preferred).length > 0) {
				target = preferred;
			}
			if (!target) target = itemText($list[0]);

			const current = $cur.text().trim();
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
