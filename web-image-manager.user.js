// ==UserScript==
// @name         Web Image Manager
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  稳定版图片/视频/SVG控制
// @author       cg
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @namespace    https://github.com/zedca/PublicScript/
// @downloadURL  https://github.com/zedca/PublicScript/raw/main/web-image-manager.user.js
// @updateURL    https://github.com/zedca/PublicScript/raw/main/web-image-manager.user.js
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

    alert(`视频：${videoEnabled ? "开启" : "关闭"}`);
  }

  function toggleSvg() {
    svgEnabled = !svgEnabled;

    GM_setValue(svgKey, svgEnabled);

    applyRootMode();

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
  }

  function updateButton() {
    const btn = document.getElementById("__imgToggleBtn");

    if (btn) {
      btn.innerText = icons[mode];
    }
  }

  /* ---------------- 快捷键 ---------------- */

  function registerHotkeys() {
    document.addEventListener("keydown", (e) => {
      // Alt + I
      if (e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();

        toggleMode();
      }

      // Alt + V
      if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();

        toggleVideo();
      }

      // Alt + S
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();

        toggleSvg();
      }
    });
  }

  /* ---------------- Menu ---------------- */

  function registerMenu() {
    modes.forEach((m) => {
      GM_registerMenuCommand(`模式: ${m}`, () => setMode(m));
    });

    GM_registerMenuCommand(`视频: ${videoEnabled ? "开" : "关"}`, toggleVideo);

    GM_registerMenuCommand(`SVG: ${svgEnabled ? "开" : "关"}`, toggleSvg);

    GM_registerMenuCommand("重置", () => {
      GM_deleteValue(siteKey);

      GM_deleteValue(videoKey);

      GM_deleteValue(svgKey);

      mode = defaultMode;

      videoEnabled = true;

      svgEnabled = true;

      applyRootMode();

      updateButton();

      alert("已重置");
    });
  }

  /* ---------------- Init ---------------- */

  function init() {
    injectStyle();

    applyRootMode();

    createButton();

    registerMenu();

    registerHotkeys();

    observe();

    fixLazyImages();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
