// ==UserScript==
// @name         Web Image Manager
// @version      1.0.5
// @description  稳定版图片/视频/SVG控制
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      purge.jsdelivr.net
// @namespace    https://github.com/zedca/BrowserScript/
// @downloadURL  https://github.com/zedca/BrowserScript/raw/main/web-image-manager.user.js
// @updateURL    https://github.com/zedca/BrowserScript/raw/main/web-image-manager.user.js
// ==/UserScript==

(function () {
  "use strict";

  /* ---------------- 配置 ---------------- */

  const miniSize = 60;

  const defaultMode = "show";

  const modes = ["hide", "mini", "show"];

  const excludeSites = ["figma.com", "photopea.com"];

  if (excludeSites.includes(location.hostname)) {
    return;
  }

  /* ---------------- 存储 ---------------- */

  const siteKey = `mode_${location.hostname}`;
  const videoKey = `video_${location.hostname}`;
  const svgKey = `svg_${location.hostname}`;

  let mode = GM_getValue(siteKey, defaultMode);

  let videoEnabled = GM_getValue(videoKey, true);

  let svgEnabled = GM_getValue(svgKey, true);

  /* ---------------- 图标 ---------------- */

  const icons = {
    hide: "❌",
    mini: "🔍",
    show: "🖼️",
  };

  /* ---------------- Root State ---------------- */

  function applyRootMode() {
    const html = document.documentElement;

    html.setAttribute("img-toggle", mode);

    html.setAttribute("img-video", videoEnabled ? "on" : "off");

    html.setAttribute("img-svg", svgEnabled ? "on" : "off");
  }

  /* ---------------- Style ---------------- */

  function injectStyle() {
    if (document.getElementById("__imgToggleStyle")) return;

    const style = document.createElement("style");

    style.id = "__imgToggleStyle";

    style.innerHTML = `
      /* =========================
         HIDE MODE
      ========================= */

      html[img-toggle="hide"] img {
        display: none !important;
      }

      html[img-toggle="hide"] picture {
        display: none !important;
      }

      html[img-toggle="hide"] source {
        display: none !important;
      }

      /* background-image */

      html[img-toggle="hide"] [style*="background"],
      html[img-toggle="hide"] [class*="bg"],
      html[img-toggle="hide"] [class*="cover"] {
        background-image: none !important;
      }

      /* SVG */

      html[img-svg="off"] svg {
        visibility: hidden !important;
      }

      html[img-svg="off"] img[src$=".svg"] {
        display: none !important;
      }

      html[img-svg="off"] object[data$=".svg"] {
        display: none !important;
      }

      html[img-svg="off"] embed[src$=".svg"] {
        display: none !important;
      }

      /* Video */

      html[img-toggle="hide"][img-video="off"] video {
        display: none !important;
      }

      html[img-toggle="hide"][img-video="off"] iframe[src*="youtube"],
      html[img-toggle="hide"][img-video="off"] iframe[src*="bilibili"],
      html[img-toggle="hide"][img-video="off"] iframe[src*="vimeo"] {
        display: none !important;
      }

      /* =========================
         MINI MODE
      ========================= */

      html[img-toggle="mini"] img,
      html[img-toggle="mini"] video {
        width: ${miniSize}px !important;
        height: ${miniSize}px !important;
        object-fit: cover !important;
      }

      html[img-toggle="mini"] svg {
        max-width: ${miniSize}px !important;
        max-height: ${miniSize}px !important;
      }

      html[img-toggle="mini"] iframe[src*="youtube"],
      html[img-toggle="mini"] iframe[src*="bilibili"] {
        width: ${miniSize}px !important;
        height: ${miniSize}px !important;
      }
    `;

    document.head.appendChild(style);
  }

  /* ---------------- 懒加载修复 ---------------- */

  function fixLazyImages(root = document) {
    const imgs = root.querySelectorAll("img");

    imgs.forEach((img) => {
      const lazyAttrs = [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-url",
      ];

      for (const attr of lazyAttrs) {
        const value = img.getAttribute(attr);

        if (value && !img.src) {
          img.src = value;
          break;
        }
      }

      if (img.dataset.srcset && !img.srcset) {
        img.srcset = img.dataset.srcset;
      }
    });
  }

  /* ---------------- MutationObserver ---------------- */

  function observe() {
    let pending = false;

    const observer = new MutationObserver(() => {
      if (pending) return;

      pending = true;

      requestAnimationFrame(() => {
        fixLazyImages();

        layoutButton();

        pending = false;
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /* ---------------- 模式 ---------------- */

  function setMode(newMode) {
    if (!modes.includes(newMode)) return;

    mode = newMode;

    GM_setValue(siteKey, mode);

    applyRootMode();

    updateButton();
  }

  function toggleMode() {
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];

    setMode(next);
  }

  function toggleVideo() {
    videoEnabled = !videoEnabled;

    GM_setValue(videoKey, videoEnabled);

    applyRootMode();

    refreshMenu();

    alert(`视频：${videoEnabled ? "开启" : "关闭"}`);
  }

  function toggleSvg() {
    svgEnabled = !svgEnabled;

    GM_setValue(svgKey, svgEnabled);

    applyRootMode();

    refreshMenu();

    alert(`SVG：${svgEnabled ? "开启" : "关闭"}`);
  }

  /* ---------------- Button ---------------- */

  function createButton() {
    const btn = document.createElement("div");

    btn.id = "__imgToggleBtn";

    const buttonSize = 20;

    btn.style.cssText = `
      position: fixed;
      right: 15px;
      bottom: 15px;
      width: ${buttonSize}px;
      height: ${buttonSize}px;
      font-size: ${buttonSize * 0.6}px;
      border-radius: ${buttonSize * 0.3}px;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:2147483647;
      cursor:pointer;
      background: rgba(0,0,0,0.5);
      color:#fff;
      backdrop-filter: blur(6px);
      transition: all .2s ease;
      user-select:none;
    `;

    btn.onmouseenter = () => {
      btn.style.transform = "scale(1.1)";
    };

    btn.onmouseleave = () => {
      btn.style.transform = "scale(1)";
    };

    btn.onclick = toggleMode;

    document.body.appendChild(btn);

    updateButton();

    layoutButton();

    window.addEventListener("resize", layoutButton);
  }

  function updateButton() {
    const btn = document.getElementById("__imgToggleBtn");

    if (btn) {
      btn.innerText = icons[mode];
    }
  }

  /* ---------------- 位置：避开自动翻页角标 ---------------- */

  const autoPaginateBadgeId = "__autoPaginateBadge";

  const cornerOffset = 15;

  // 自动翻页角标也在右下角，存在时把图标叠到它上面，避免重叠
  function layoutButton() {
    const btn = document.getElementById("__imgToggleBtn");

    if (!btn) return;

    const badge = document.getElementById(autoPaginateBadgeId);

    const rect = badge ? badge.getBoundingClientRect() : null;

    const bottom =
      rect && rect.height > 0
        ? window.innerHeight - rect.top + 8
        : cornerOffset;

    btn.style.bottom = `${bottom}px`;
  }

  /* ---------------- 更新 ---------------- */

  const LOG = "[Web Image Manager]";

  function log(...args) {
    try {
      console.debug(LOG, ...args);
    } catch (e) {
      /* 忽略 */
    }
  }

  // 和脚本头部的 @updateURL 保持一致
  const SCRIPT_PAGE =
    "https://github.com/zedca/BrowserScript/raw/main/web-image-manager.user.js";

  const JSDELIVR_SCRIPT =
    "https://cdn.jsdelivr.net/gh/zedca/BrowserScript@main/web-image-manager.user.js";
  const PURGE_URL =
    "https://purge.jsdelivr.net/gh/zedca/BrowserScript@main/web-image-manager.user.js";

  // 取新版本用：GitHub raw 更新最及时，jsDelivr 当备用线路（分支内容会缓存一段时间）
  const SCRIPT_SOURCES = [
    "https://raw.githubusercontent.com/zedca/BrowserScript/main/web-image-manager.user.js",
    SCRIPT_PAGE,
    JSDELIVR_SCRIPT,
  ];

  // 油猴没给 GM_info 时用它兜底（记得和头部的 @version 一起改）
  const FALLBACK_VERSION = "1.0.5";

  function localVersion() {
    try {
      const version =
        typeof GM_info !== "undefined" &&
        GM_info &&
        GM_info.script &&
        GM_info.script.version;

      if (version) return version;
    } catch (e) {
      log("读取脚本版本失败:", e);
    }

    return FALLBACK_VERSION;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      // 页面自己的 fetch 会被 CSP 拦住，优先走油猴的请求
      if (typeof GM_xmlhttpRequest !== "function") {
        fetch(url, { cache: "no-store" })
          .then((res) =>
            res.ok
              ? res.text()
              : Promise.reject(new Error(`HTTP ${res.status}`)),
          )
          .then(resolve, reject);

        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 15000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error(`HTTP ${res.status}`));
        },
        onerror: () => reject(new Error("网络错误")),
        ontimeout: () => reject(new Error("超时")),
      });
    });
  }

  async function fetchRemoteScript() {
    for (const url of SCRIPT_SOURCES) {
      try {
        const text = await requestText(url);

        if (text && text.includes("@version")) return { url, text };
      } catch (e) {
        log("更新脚本：下载失败", url, e);
      }
    }

    return null;
  }

  // raw.githubusercontent 的 CDN 会把文件缓存约 5 分钟，刚提交的版本可能还看不到。
  // 这种情况下让 jsDelivr 刷新一次缓存再取，免得把新版误报成“已是最新”。
  async function fetchRemoteScriptFresh() {
    const remote = await fetchRemoteScript();

    if (remote && isNewer(parseVersion(remote.text), localVersion())) {
      return { ...remote, verified: true };
    }

    try {
      await requestText(PURGE_URL);

      const text = await requestText(JSDELIVR_SCRIPT);

      if (text && text.includes("@version")) {
        return { url: JSDELIVR_SCRIPT, text, verified: true };
      }
    } catch (e) {
      log("更新脚本：刷新 jsDelivr 缓存失败", e);
    }

    return remote && { ...remote, verified: false };
  }

  function parseVersion(text) {
    const match = /^\/\/\s*@version\s+(\S+)/m.exec(text);

    return match ? match[1] : "";
  }

  // 逐段按数字比较，1.2.10 比 1.2.9 新
  function isNewer(remote, local) {
    const a = String(remote).split(".");
    const b = String(local).split(".");

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = parseInt(a[i], 10) || 0;
      const y = parseInt(b[i], 10) || 0;

      if (x !== y) return x > y;
    }

    return false;
  }

  function openScriptPage(url) {
    try {
      if (typeof GM_openInTab === "function") {
        GM_openInTab(url, { active: true, insert: true });

        return;
      }
    } catch (e) {
      log("打开脚本页面失败:", e);
    }

    window.open(url, "_blank");
  }

  async function checkUpdate() {
    const local = localVersion();

    const remote = await fetchRemoteScriptFresh();

    if (!remote) {
      alert(
        `检查更新失败（下载不到脚本）\n当前版本：v${local}\n可以手动打开下面的地址：\n${SCRIPT_PAGE}`,
      );

      return;
    }

    const version = parseVersion(remote.text);

    if (!version || !isNewer(version, local)) {
      alert(
        remote.verified
          ? `已是最新版本：v${local}`
          : `暂未发现新版本：v${local}\n（GitHub 的文件缓存约 5 分钟，刚提交的版本可能还没生效）`,
      );

      return;
    }

    if (!confirm(`发现新版本：v${version}（当前 v${local}）\n\n打开安装页更新？`)) return;

    // 直接打开 .user.js，剩下交给油猴的安装页面
    openScriptPage(SCRIPT_PAGE);
  }

  /* ---------------- Menu ---------------- */

  const menuCommandIds = [];

  const supportsMenuUnregister = typeof GM_unregisterMenuCommand === "function";

  // 拿不到菜单 id 时无法反注册，退化为只注册一次，避免菜单项重复堆积
  let canRefreshMenu = supportsMenuUnregister;

  function registerMenu() {
    const add = (caption, onClick) => {
      const id = GM_registerMenuCommand(caption, onClick);

      if (id === undefined || id === null) canRefreshMenu = false;

      else menuCommandIds.push(id);
    };

    modes.forEach((m) => add(`模式: ${m}`, () => setMode(m)));

    add(`视频: ${videoEnabled ? "开" : "关"}`, toggleVideo);

    add(`SVG: ${svgEnabled ? "开" : "关"}`, toggleSvg);

    add(`更新脚本（当前 v${localVersion()}）`, checkUpdate);

    add("重置", reset);
  }

  // 先反注册旧菜单项再重新注册，让「视频/SVG」标签跟随最新状态
  function refreshMenu() {
    if (!canRefreshMenu) return;

    menuCommandIds.splice(0).forEach((id) => GM_unregisterMenuCommand(id));

    registerMenu();
  }

  function reset() {
    GM_deleteValue(siteKey);

    GM_deleteValue(videoKey);

    GM_deleteValue(svgKey);

    mode = defaultMode;

    videoEnabled = true;

    svgEnabled = true;

    applyRootMode();

    updateButton();

    refreshMenu();

    alert("已重置");
  }

  /* ---------------- Init ---------------- */

  function init() {
    injectStyle();

    applyRootMode();

    createButton();

    registerMenu();

    observe();

    fixLazyImages();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
