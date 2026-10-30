// ==UserScript==
// @name         Replace Title Icon
// @version      1.0.1
// @author       You
// @match        *://*/*
// @run-at       document-start
// @description  修改标题和 favicon 为纯色 PNG
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @namespace    https://github.com/zedca/PublicScript/
// @downloadURL  https://github.com/zedca/PublicScript/raw/main/replace-title-icon.user.js
// @updateURL    https://github.com/zedca/PublicScript/raw/main/replace-title-icon.user.js
// ==/UserScript==

(function () {
  "use strict";

  /************************************************
   * 配置
   ************************************************/

  // 空白标题（零宽空格）
  const TITLE = "\u200B";

  // 32×32 纯色 PNG（Base64）
  const IMG_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NMQEAAAjDMMC/yxnBBHypgKaT1GfzegcAAAAAAAAAAACHLc3dAukDI2crAAAAAElFTkSuQmCC";

  /************************************************
   * 是否启用（当前网站）
   ************************************************/

  const ENABLE_KEY = `title_icon_enable_${location.hostname}`;

  let enabled = GM_getValue(ENABLE_KEY, false);

  GM_registerMenuCommand(
    enabled ? "关闭标题/Favicon修改" : "开启标题/Favicon修改",
    () => {
      enabled = !enabled;
      GM_setValue(ENABLE_KEY, enabled);
      location.reload();
    },
  );

  /************************************************
   * 工具
   ************************************************/

  // Firefox 在 document-start 阶段 document.head 可能还不存在，
  // 直接使用会抛异常（Chrome/Edge 此时已经有了）
  function getHead() {
    return document.head || document.querySelector("head");
  }

  /************************************************
   * 修改标题
   ************************************************/

  function applyTitle() {
    if (!getHead()) return;

    if (document.title !== TITLE) {
      document.title = TITLE;
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
      if (link.id !== "gm_blank_icon") {
        link.remove();
      }
    });

    let icon = document.getElementById("gm_blank_icon");

    if (!icon) {
      icon = document.createElement("link");
      icon.id = "gm_blank_icon";
      icon.rel = "icon";
      icon.type = "image/png";
      icon.setAttribute("href", IMG_ICON);
      head.appendChild(icon);
    } else if (icon.getAttribute("href") !== IMG_ICON) {
      icon.setAttribute("href", IMG_ICON);
    }
  }

  /************************************************
   * 应用
   ************************************************/

  function apply() {
    if (!enabled) return;

    applyTitle();
    applyIcon();

    // head 可能后出现 / 被替换，确保监听始终挂在当前的 head 上
    ensureIconObserver();
  }

  /************************************************
   * MutationObserver
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

  let iconObserver = null;
  let iconObserverTarget = null;

  function ensureIconObserver() {
    const head = getHead();

    if (!head) return;
    if (iconObserver && iconObserverTarget === head) return;

    if (iconObserver) iconObserver.disconnect();

    iconObserver = new MutationObserver(scheduleApply);
    iconObserverTarget = head;
    iconObserver.observe(head, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  }

  /************************************************
   * 初始化
   ************************************************/

  function start() {
    // 等待 documentElement 出现再挂 observer：
    // Firefox 的 document-start 阶段它可能是 null，observe(null) 会抛异常
    if (!document.documentElement) {
      const rootWatcher = new MutationObserver(() => {
        if (!document.documentElement) return;
        rootWatcher.disconnect();
        start();
      });

      rootWatcher.observe(document, { childList: true });

      return;
    }

    apply();

    // 监听 title
    new MutationObserver(scheduleApply).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    // 监听 favicon
    ensureIconObserver();

    // 兜底
    document.addEventListener("DOMContentLoaded", apply);
    window.addEventListener("load", apply);
    window.addEventListener("pageshow", apply);
  }

  if (!enabled) return;

  start();
})();
