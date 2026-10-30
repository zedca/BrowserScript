// ==UserScript==
// @name         Replace Title Icon
// @version      1.0.0
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
   * 修改标题
   ************************************************/

  function applyTitle() {
    if (document.title !== TITLE) {
      document.title = TITLE;
    }

    let title = document.querySelector("title");

    if (!title) {
      title = document.createElement("title");
      document.head.appendChild(title);
    }

    if (title.textContent !== TITLE) {
      title.textContent = TITLE;
    }
  }

  /************************************************
   * 修改 favicon
   ************************************************/

  function applyIcon() {
    if (!document.head) return;

    // 删除网站原来的 favicon
    document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
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
      document.head.appendChild(icon);
    }

    if (icon.href !== IMG_ICON) {
      icon.href = IMG_ICON;
    }
  }

  /************************************************
   * 应用
   ************************************************/

  function apply() {
    if (!enabled) return;

    applyTitle();
    applyIcon();
  }

  /************************************************
   * 初始化
   ************************************************/

  apply();

  document.addEventListener("DOMContentLoaded", apply);
  window.addEventListener("load", apply);

  /************************************************
   * 监听 title
   ************************************************/

  new MutationObserver(() => {
    if (!enabled) return;
    applyTitle();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  /************************************************
   * 监听 favicon
   ************************************************/

  new MutationObserver(() => {
    if (!enabled) return;
    requestAnimationFrame(applyIcon);
  }).observe(document.head || document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["href", "rel"],
  });
})();
