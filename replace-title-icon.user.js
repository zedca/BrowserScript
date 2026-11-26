// ==UserScript==
// @name         Replace Title Icon
// @version      1.0.4
// @author       You
// @match        *://*/*
// @run-at       document-start
// @noframes
// @description  修改标题和 favicon 为纯色 PNG
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      purge.jsdelivr.net
// @namespace    https://github.com/zedca/BrowserScript/
// @downloadURL  https://github.com/zedca/BrowserScript/raw/main/replace-title-icon.user.js
// @updateURL    https://github.com/zedca/BrowserScript/raw/main/replace-title-icon.user.js
// ==/UserScript==

(function () {
  "use strict";

  /************************************************
   * 配置
   ************************************************/

  // 空白标题（零宽空格）
  const TITLE = "\u200B";

  // 32×32 纯色 PNG（Base64）：Edge 等浏览器用 #E3E3E3
  const IMG_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NMQEAAAjDMMC/yxnBBHypgKaT1GfzegcAAAAAAAAAAACHLc3dAukDI2crAAAAAElFTkSuQmCC";

  // 32×32 纯色 PNG（Base64）：Firefox 用 #EBE4F7，和 Nightly 标题栏同色
  const IMG_ICON_NIGHTLY =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAK0lEQVR42mN4/eQ7TRHDqAWjFoxaMGrBqAWjFoxaMGrBqAWjFoxaMFQsAABNKximqQ7AhwAAAABJRU5ErkJggg==";

  // Nightly 的 UA 和正式版一样（都是 Firefox/161.0），只能按内核区分
  const IS_FIREFOX = /Firefox\//.test(navigator.userAgent);

  const ICON_HREF = IS_FIREFOX ? IMG_ICON_NIGHTLY : IMG_ICON;

  const ICON_ID = "gm_blank_icon";

  const LOG = "[Replace Title Icon]";

  function log(...args) {
    try {
      console.debug(LOG, ...args);
    } catch (e) {
      /* 忽略 */
    }
  }

  /************************************************
   * 更新
   ************************************************/

  // 和脚本头部的 @updateURL 保持一致
  const SCRIPT_PAGE =
    "https://github.com/zedca/BrowserScript/raw/main/replace-title-icon.user.js";

  const JSDELIVR_SCRIPT =
    "https://cdn.jsdelivr.net/gh/zedca/BrowserScript@main/replace-title-icon.user.js";
  const PURGE_URL =
    "https://purge.jsdelivr.net/gh/zedca/BrowserScript@main/replace-title-icon.user.js";

  // 取新版本用：GitHub raw 更新最及时，jsDelivr 当备用线路（分支内容会缓存一段时间）
  const SCRIPT_SOURCES = [
    "https://raw.githubusercontent.com/zedca/BrowserScript/main/replace-title-icon.user.js",
    SCRIPT_PAGE,
    JSDELIVR_SCRIPT,
  ];

  // 油猴没给 GM_info 时用它兜底（记得和头部的 @version 一起改）
  const FALLBACK_VERSION = "1.0.4";

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

  /************************************************
   * 是否启用（当前网站）
   ************************************************/

  const ENABLE_PREFIX = "title_icon_enable_";

  // 例如 a.b.example.com → [a.b.example.com, b.example.com, example.com]
  // 在父域名上开启后子域名自动生效；IP / localhost 只匹配自身
  function candidateHosts(hostname) {
    const labels = hostname.split(".").filter(Boolean);
    const tld = labels[labels.length - 1] || "";

    if (labels.length < 2 || !/^[a-z]{2,}$/i.test(tld)) {
      return [hostname];
    }

    const hosts = [];

    // 只到二级后缀为止（不产生 "com" 这种无意义的键）
    for (let i = 0; i < labels.length - 1; i++) {
      hosts.push(labels.slice(i).join("."));
    }

    return hosts;
  }

  function readEnabled() {
    try {
      for (const host of candidateHosts(location.hostname)) {
        const value = GM_getValue(ENABLE_PREFIX + host, undefined);

        if (typeof value === "boolean") return value;
        if (value === "true" || value === "false") return value === "true";
      }
    } catch (e) {
      log("GM_getValue 失败:", e);
    }

    return false;
  }

  let enabled = readEnabled();

  try {
    GM_registerMenuCommand(
      enabled ? "关闭标题/Favicon修改" : "开启标题/Favicon修改",
      () => {
        // 显式写在当前域名上，覆盖从父域名继承来的值
        try {
          GM_setValue(ENABLE_PREFIX + location.hostname, !enabled);
        } catch (e) {
          log("GM_setValue 失败:", e);
        }
        location.reload();
      },
    );
  } catch (e) {
    log("GM_registerMenuCommand 失败:", e);
  }

  try {
    GM_registerMenuCommand(`更新脚本（当前 v${localVersion()}）`, checkUpdate);
  } catch (e) {
    log("GM_registerMenuCommand 失败:", e);
  }

  log(
    enabled ? "已启用" : "未启用（可在脚本菜单里开启当前网站）",
    location.hostname,
    IS_FIREFOX ? "色块 #EBE4F7" : "色块 #E3E3E3",
  );

  if (!enabled) return;

  /************************************************
   * 工具
   ************************************************/

  // Firefox 在 document-start 阶段 document.head / documentElement 都可能不存在
  function getHead() {
    return document.head || document.querySelector("head");
  }

  /************************************************
   * 修改标题
   ************************************************/

  function applyTitle() {
    // document.title 在 documentElement 存在后即可使用（会自动创建 title）
    if (!document.documentElement) return;

    if (document.title !== TITLE) {
      document.title = TITLE;
    }

    const title = document.querySelector("title");

    if (title && title.textContent !== TITLE) {
      title.textContent = TITLE;
    }
  }

  /************************************************
   * 修改 favicon
   ************************************************/

  function applyIcon() {
    const head = getHead();

    if (!head) return;

    // 删除网站原来的 favicon
    head.querySelectorAll('link[rel*="icon" i]').forEach((link) => {
      if (link.id !== ICON_ID) {
        link.remove();
      }
    });

    let icon = document.getElementById(ICON_ID);

    // 元素被网站连同 head 一起替换掉时，重新插入
    if (icon && icon.parentNode !== head) {
      icon.remove();
      icon = null;
    }

    if (!icon) {
      icon = document.createElement("link");
      icon.id = ICON_ID;
      icon.rel = "icon";
      icon.type = "image/png";
      icon.setAttribute("sizes", "32x32");
      icon.setAttribute("href", ICON_HREF);
      head.appendChild(icon);
    } else if (icon.getAttribute("href") !== ICON_HREF) {
      icon.setAttribute("href", ICON_HREF);
    }
  }

  /************************************************
   * 应用
   ************************************************/

  function apply() {
    if (!enabled) return;

    try {
      applyTitle();
    } catch (e) {
      log("修改标题失败:", e);
    }

    try {
      applyIcon();
    } catch (e) {
      log("修改 favicon 失败:", e);
    }

    ensureObservers();
  }

  /************************************************
   * MutationObserver（只是加速手段，不依赖它）
   ************************************************/

  let scheduled = false;

  function scheduleApply() {
    if (!enabled || scheduled) return;

    scheduled = true;

    setTimeout(() => {
      scheduled = false;
      apply();
    }, 0);
  }

  let rootObserver = null;
  let headObserver = null;
  let headObserverTarget = null;

  function ensureObservers() {
    const root = document.documentElement;

    if (!root) return;

    // 监听 title 变化（包括网站脚本动态改标题）
    if (!rootObserver) {
      try {
        rootObserver = new MutationObserver(scheduleApply);
        rootObserver.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      } catch (e) {
        rootObserver = null;
        log("标题监听失败:", e);
      }
    }

    // 监听 favicon 变化（head 可能被替换，需要重新绑定）
    const head = getHead();

    if (head && head !== headObserverTarget) {
      try {
        if (headObserver) headObserver.disconnect();

        headObserver = new MutationObserver(scheduleApply);
        headObserver.observe(head, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["href", "rel"],
        });
        headObserverTarget = head;
      } catch (e) {
        headObserver = null;
        headObserverTarget = null;
        log("favicon 监听失败:", e);
      }
    }
  }

  /************************************************
   * 初始化
   ************************************************/

  // 立即应用一次（head 不存在时会自动跳过）
  apply();

  // Firefox 的 document-start 阶段 DOM 还不完整，观察器也可能拿不到可观察的节点，
  // 所以用短间隔轮询兜底：前 10 秒每 100ms 一次，之后每 2 秒一次
  let fastTries = 0;

  const fastTimer = setInterval(() => {
    apply();
    fastTries += 1;

    if (fastTries >= 100 || document.readyState === "complete") {
      clearInterval(fastTimer);
    }
  }, 100);

  setInterval(apply, 2000);

  // 兜底事件
  document.addEventListener("DOMContentLoaded", apply);
  window.addEventListener("load", apply);
  window.addEventListener("pageshow", apply);
})();
