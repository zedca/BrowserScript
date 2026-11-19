// ==UserScript==
// @name         Auto Paginate
// @name:zh-CN   网页自动翻页
// @namespace    https://github.com/zedca/BrowserScript/
// @version      1.1.3
// @description  Auto-load the next page of results when scrolling to the bottom (Google search built in, more sites via adapters)
// @description:zh-CN  滚动到底部时自动加载下一页结果；内置 Google 搜索，可按模板扩展其他站点
// @author       You
// @match        *://www.google.com/search*
// @match        *://www.google.com.hk/search*
// @match        *://www.google.co.jp/search*
// @match        *://www.google.com.tw/search*
// @match        *://www.google.com.sg/search*
// @include      /^https?:\/\/(www\.)?google\.[a-z]{2,4}(\.[a-z]{2})?\/search/
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      purge.jsdelivr.net
// @run-at       document-idle
// @noframes
// @downloadURL  https://github.com/zedca/BrowserScript/raw/main/auto-paginate.user.js
// @updateURL    https://github.com/zedca/BrowserScript/raw/main/auto-paginate.user.js
// ==/UserScript==

/*
 * 多站点结构说明
 *
 * 新增一个网站只需要两步：
 *   1. 脚本头部的 @match 加上该站点的 URL 规则（否则脚本不会被注入）
 *   2. 在下面的 ADAPTERS 数组里加一个适配器
 *
 * 大部分适配器只需要写 test / root / nextHref，其余走通用实现；
 * 文件末尾有一份可直接复制的模板。
 *
 * 适配器可覆盖的字段：
 *   id            唯一标识（日志里用来区分）
 *   name          显示名称
 *   test(url)     当前 URL 是否由这个适配器处理（必填）
 *   pageSize      每页条数，用于推算当前页号
 *   currentPage   从 URL 解析当前页号，默认读取 page 参数
 *   root(doc)     结果容器（追加的落点）
 *   source(doc)   从远端页面取要追加的节点，默认同 root
 *   nextAnchor(doc)  下一页按钮，默认 a[rel="next"] / a.next
 *   nextHref(doc, base)  下一页链接，默认取 nextAnchor 的 href
 *   fetchPage(href)  自定义请求，默认 fetch + credentials: include
 *   extraStyles(doc)  从远端页面额外带过来的样式（远端页面里的 <style> 内容）
 *   collectTargets(node)  收集用于去重的链接
 *   skipBlock(node)  需要整块跳过的节点（广告、推荐位等）
 *   sanitize(node)   插入前清理，默认去掉 script / 内联事件
 *   fixImages(root)  懒加载图片修复
 *   fixLayout(nodes)  追加后修正结果排版（样式被站点脚本改写后的兜底）
 */

(function () {
  "use strict";

  /************************************************
   * 配置
   ************************************************/

  const DEFAULT_ENABLED = true;

  // append：把下一页结果追加到当前页；click：直接跳转到下一页
  const DEFAULT_MODE = "append";

  // 最多自动加载到第几页（含当前页）
  const DEFAULT_MAX_PAGES = 10;

  // 距离页面底部多少像素时开始加载
  const TRIGGER_DISTANCE = 800;

  // 加载失败后，至少间隔多久才再次尝试（毫秒）
  const RETRY_INTERVAL = 3000;

  // 自动重试次数上限（间隔依次为 3s、6s、9s）
  const MAX_RETRY = 3;

  const STORE_PREFIX = "auto_page_";

  const BADGE_ID = "__autoPaginateBadge";

  const STYLE_ID = "__autoPaginateStyle";

  const DIVIDER_CLASS = "__autoPaginateDivider";

  const LOG = "[自动翻页]";

  /************************************************
   * 工具
   ************************************************/

  function log(...args) {
    try {
      console.debug(LOG, ...args);
    } catch (e) {
      /* 忽略 */
    }
  }

  function toPositiveInt(value, fallback) {
    const n = parseInt(value, 10);

    return Number.isFinite(n) && n >= 1 ? n : fallback;
  }

  function absoluteUrl(href, base) {
    if (!href) return null;

    try {
      return new URL(href, base || location.href).href;
    } catch (e) {
      return null;
    }
  }

  /************************************************
   * 存储
   ************************************************/

  function read(key, fallback) {
    try {
      const value = GM_getValue(STORE_PREFIX + key, undefined);

      if (value !== undefined && value !== null) return value;
    } catch (e) {
      log("读取设置失败:", e);
    }

    return fallback;
  }

  function write(key, value) {
    try {
      GM_setValue(STORE_PREFIX + key, value);
    } catch (e) {
      log("保存设置失败:", e);
    }
  }

  let enabled = read("enabled", DEFAULT_ENABLED) !== false;

  let mode = read("mode", DEFAULT_MODE) === "click" ? "click" : "append";

  let maxPages = toPositiveInt(
    read("maxPages", DEFAULT_MAX_PAGES),
    DEFAULT_MAX_PAGES,
  );

  /************************************************
   * 通用去重与追加
   ************************************************/

  const SKIP_HREF = /^(javascript:|mailto:|tel:|#)/i;

  function genericTargets(root) {
    const urls = new Set();

    root.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");

      if (!href || SKIP_HREF.test(href.trim())) return;

      const url = absoluteUrl(href, location.href);

      // 去掉 hash，同一个锚点的不同位置算同一条
      if (url) urls.add(url.split("#")[0]);
    });

    return urls;
  }

  function removeDuplicateIds(node) {
    const local = new Set();

    const strip = (el) => {
      if (!el.id) return;

      // 页面里已有，或同一个块内部重复，都去掉 id
      if (document.getElementById(el.id) || local.has(el.id)) {
        el.removeAttribute("id");
      } else {
        local.add(el.id);
      }
    };

    strip(node);

    node.querySelectorAll("[id]").forEach(strip);
  }

  // 抓回来的 HTML 里带 <script> 和内联事件，插入页面后会被重新执行/触发，
  // 这里统一清掉（页面原本的行为由站点自己的脚本负责）
  function sanitizeNode(node) {
    node.querySelectorAll("script").forEach((script) => script.remove());

    [node, ...node.querySelectorAll("*")].forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (name === "href" && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });
  }

  function fixLazyImages(root) {
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("data-src");

      if (src && !img.getAttribute("src")) img.setAttribute("src", src);

      const srcset = img.getAttribute("data-srcset");

      if (srcset && !img.getAttribute("srcset")) {
        img.setAttribute("srcset", srcset);
      }
    });
  }

  /************************************************
   * 附加样式
   ************************************************/

  // Google 把结果卡片的网格布局规则按 data-snc 写在 <style> 里，
  // 而且这些 <style> 可能挂在结果容器外面。只追加结果节点会丢掉规则，
  // 带右侧缩略图的结果就会标题/摘要压到图片上。这里把远端页面的
  // 布局样式一起搬过来，已经存在的规则不重复注入。
  function collectSncKeys(text) {
    const keys = new Set();

    const re = /\[data-snc=["']([^"']+)["']\]/g;

    let match;

    while ((match = re.exec(text))) keys.add(match[1]);

    return keys;
  }

  const injectedStyles = new Set();

  function injectExtraStyles(doc) {
    if (!adapter) return;

    let list;

    try {
      list = adapter.extraStyles(doc) || [];
    } catch (e) {
      log("提取附加样式失败:", e);
      return;
    }

    const known = new Set();

    const knownTexts = new Set();

    document.querySelectorAll("style").forEach((style) => {
      const text = style.textContent || "";

      knownTexts.add(text);

      collectSncKeys(text).forEach((key) => known.add(key));
    });

    list.forEach((text) => {
      if (!text || !text.trim()) return;

      // 内容和页面上已有的一模一样就不用再来一份
      if (injectedStyles.has(text) || knownTexts.has(text)) return;

      const keys = collectSncKeys(text);

      // 页面上已经有这些规则（比如第一页自己的）就不再重复注入
      if (keys.size > 0 && Array.from(keys).every((key) => known.has(key))) {
        injectedStyles.add(text);

        return;
      }

      const style = document.createElement("style");

      style.textContent = text;

      document.head.appendChild(style);

      injectedStyles.add(text);

      keys.forEach((key) => known.add(key));
    });
  }

  /************************************************
   * 适配器
   ************************************************/

  function createAdapter(def) {
    if (!def || typeof def.test !== "function") {
      throw new Error("适配器缺少 test()");
    }

    const root = def.root || ((doc) => doc.querySelector("main"));

    const nextAnchor =
      def.nextAnchor ||
      ((doc) => doc.querySelector('a[rel="next"], link[rel="next"], a.next'));

    return {
      id: def.id || "unknown",

      name: def.name || def.id || "未命名站点",

      pageSize: toPositiveInt(def.pageSize, 10),

      test: def.test,

      currentPage:
        def.currentPage ||
        ((url) => toPositiveInt(url.searchParams.get("page"), 1)),

      root,

      source: def.source || root,

      nextAnchor,

      nextHref:
        def.nextHref ||
        ((doc, base) => {
          const anchor = nextAnchor(doc);

          return anchor
            ? absoluteUrl(anchor.getAttribute("href"), base)
            : null;
        }),

      fetchPage:
        def.fetchPage ||
        ((href) => fetch(href, { credentials: "include" })),

      extraStyles: def.extraStyles || (() => []),

      collectTargets: def.collectTargets || genericTargets,

      skipBlock: def.skipBlock || (() => false),

      sanitize: def.sanitize || sanitizeNode,

      fixImages: def.fixImages || fixLazyImages,

      fixLayout: def.fixLayout || (() => {}),

      observe: def.observe || (() => {}),
    };
  }

  const GOOGLE_PAGE_SIZE = 10;

  // Google 的脚本会在结果卡片进入视口后用新的 data-snc 重新渲染它们，
  // 改写后的卡片找不到对应的 [data-snc] 布局规则，缩略图会和标题叠在一起。
  // 卡片自身在子元素上写了 grid-area 名字，这里按名字补一份模板兜底。
  function fixGoogleLayout(nodes) {
    nodes.forEach((node) => {
      if (!node.querySelectorAll) return;

      Array.from(node.querySelectorAll(".srKDX")).forEach((grid) => {
        if (window.getComputedStyle(grid).gridTemplateAreas !== "none") return;

        const areas = Array.from(grid.children)
          .map((child) => (child.style && child.style.gridArea) || "")
          .filter(Boolean);

        const textAreas = areas.filter((area) => area !== "Vjbam");

        // 没有右侧缩略图就不需要模板，单列反而正常
        if (!areas.includes("Vjbam") || textAreas.length === 0) return;

        // 图片那两列必须连成一块矩形，所以正文行先排，
        // 空一行让图片占满，整行宽的区块（如 gdePb）放最后
        const rows = textAreas
          .filter((area) => area !== "gdePb")
          .map((area) =>
            Array(10).fill(area).concat(["Vjbam", "Vjbam"]),
          );

        rows.push(Array(10).fill(".").concat(["Vjbam", "Vjbam"]));

        textAreas
          .filter((area) => area === "gdePb")
          .forEach((area) => rows.push(Array(12).fill(area)));

        grid.style.gridTemplateColumns = "repeat(12, minmax(auto, 54px))";

        grid.style.gridTemplateAreas = rows
          .map((row) => `"${row.join(" ")}"`)
          .join(" ");
      });
    });
  }

  // data-snc 被改写时补一次排版，防抖避免滚动时频繁触发
  function watchGoogleLayout(root) {
    if (!root || !window.MutationObserver) return null;

    let timer = null;

    const observer = new MutationObserver(() => {
      clearTimeout(timer);

      timer = setTimeout(() => {
        // Google 重新渲染时会连结果容器一起换掉，旧的监听就失效了
        if (!root.isConnected) {
          startObserving();

          return;
        }

        fixGoogleLayout([root]);
      }, 300);
    });

    // 卡片既可能是原地改写 data-snc，也可能整块换掉，两种都要跟
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-snc"],
      childList: true,
      subtree: true,
    });

    return observer;
  }

  // 适配器可以在结果被站点脚本改写时通知我们（目前只有 Google 用）
  let layoutObserver = null;

  function startObserving() {
    if (!adapter) return;

    if (layoutObserver) {
      try {
        layoutObserver.disconnect();
      } catch (e) {
        log("断开排版监听失败:", e);
      }

      layoutObserver = null;
    }

    try {
      const root = adapter.root(document);

      if (root) layoutObserver = adapter.observe(root) || null;
    } catch (e) {
      log("注册排版监听失败:", e);
    }
  }

  const googleAdapter = createAdapter({
    id: "google",

    name: "Google 搜索",

    pageSize: GOOGLE_PAGE_SIZE,

    test: (url) => {
      if (url.pathname !== "/search") return false;

      // 图片、视频、新闻、购物等标签页结构不同，不处理
      if (url.searchParams.has("tbm")) return false;

      // udm=14 是“网页”标签，结构和普通搜索一致；其余 udm 不处理
      const udm = url.searchParams.get("udm");

      if (udm && udm !== "14") return false;

      return true;
    },

    currentPage: (url) => {
      const start = parseInt(url.searchParams.get("start") || "0", 10);

      if (!Number.isFinite(start) || start < 0) return 1;

      return Math.floor(start / GOOGLE_PAGE_SIZE) + 1;
    },

    root: (doc) => doc.querySelector("#rso"),

    nextAnchor: (doc) =>
      doc.querySelector("a#pnnext") ||
      doc.querySelector('#botstuff a[aria-label="Next"]') ||
      doc.querySelector('#botstuff a[aria-label="下一页"]'),

    // 结果卡片的网格布局写在页面 <style> 里，规则有时按 data-snc 生成，
    // 有时直接写 .srKDX / grid-template-areas。把这些样式跟着结果一起搬过来，
    // 缩略图与标题才不会重叠（相同的样式 injectExtraStyles 会自动跳过）
    extraStyles: (doc) =>
      Array.from(doc.querySelectorAll("style"))
        .map((style) => style.textContent || "")
        .filter(
          (text) =>
            text.includes("[data-snc=") ||
            text.includes(".srKDX") ||
            text.includes("grid-template-areas"),
        ),

    // Google 的结果链接是 /url?q=... 形式
    collectTargets: (node) => {
      const urls = new Set();

      node.querySelectorAll("a[href]").forEach((anchor) => {
        const href = anchor.getAttribute("href");

        if (!href) return;

        try {
          if (href.startsWith("/url?")) {
            const q = new URL(href, location.href).searchParams.get("q");

            if (q) urls.add(q);

            return;
          }
        } catch (e) {
          return;
        }

        if (/^https?:\/\//i.test(href)) urls.add(href);
      });

      return urls;
    },

    // 广告位不要重复追加
    skipBlock: (node) => ["tads", "tadsb", "bottomads"].includes(node.id),

    fixLayout: fixGoogleLayout,

    observe: watchGoogleLayout,
  });

  // 想支持新网站，往这里加适配器即可（顺序即匹配优先级）
  const ADAPTERS = [googleAdapter];

  function resolveAdapter(url) {
    for (const adapter of ADAPTERS) {
      try {
        if (adapter.test(url)) return adapter;
      } catch (e) {
        log(`适配器 ${adapter.id} 匹配失败:`, e);
      }
    }

    return null;
  }

  /************************************************
   * 状态
   ************************************************/

  let adapter = null;

  function currentPage() {
    if (!adapter) return 1;

    try {
      return adapter.currentPage(new URL(location.href));
    } catch (e) {
      return 1;
    }
  }

  let page = 1;

  let status = enabled ? "idle" : "off";

  let loading = false;

  // 已到最后一页 / 达到页数上限
  let finished = false;

  let lastErrorAt = 0;

  // 失败后自动重试
  let retryTimer = null;

  let retryCount = 0;

  // 远端页面解析出的下一页；当前页面上的按钮不可用时兜底
  let pendingHref = null;

  /************************************************
   * 下一页
   ************************************************/

  function nextHref() {
    if (!adapter) return null;

    try {
      const live = adapter.nextHref(document, location.href);

      if (live) return live;
    } catch (e) {
      log("解析下一页失败:", e);
    }

    return pendingHref;
  }

  /************************************************
   * 结果追加
   ************************************************/

  function appendResults(source, target, pageNo) {
    const seen = adapter.collectTargets(target);

    const nodes = [];

    Array.from(source.children).forEach((node) => {
      if (adapter.skipBlock(node)) return;

      // 纯脚本块没有可见内容
      if (node.tagName === "SCRIPT") return;

      const links = adapter.collectTargets(node);

      // 和当前页结果完全重复的块（跨页重叠）跳过
      if (links.size > 0 && Array.from(links).every((url) => seen.has(url))) {
        return;
      }

      links.forEach((url) => seen.add(url));

      const clone = document.importNode(node, true);

      adapter.sanitize(clone);

      nodes.push(clone);
    });

    if (nodes.length === 0) return 0;

    const divider = document.createElement("div");

    divider.className = DIVIDER_CLASS;

    divider.textContent = `第 ${pageNo} 页`;

    target.appendChild(divider);

    nodes.forEach((node) => {
      removeDuplicateIds(node);

      target.appendChild(node);
    });

    adapter.fixImages(target);

    try {
      adapter.fixLayout(nodes);
    } catch (e) {
      log("修正结果排版失败:", e);
    }

    return nodes.length;
  }

  /************************************************
   * 加载
   ************************************************/

  function nearBottom() {
    const scrolled = window.scrollY + window.innerHeight;

    return scrolled >= document.documentElement.scrollHeight - TRIGGER_DISTANCE;
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    retryCount = 0;
  }

  // 网络抖动很常见，失败后在底部时自动退避重试几次
  function scheduleRetry() {
    if (retryTimer || retryCount >= MAX_RETRY) return 0;

    if (!enabled || finished) return 0;

    retryCount += 1;

    const delay = RETRY_INTERVAL * retryCount + 200;

    retryTimer = setTimeout(() => {
      retryTimer = null;

      maybeLoad();
    }, delay);

    return delay;
  }

  function maybeLoad() {
    if (!adapter || !enabled || loading || finished) return;

    if (Date.now() - lastErrorAt < RETRY_INTERVAL) return;

    // 页面结构还没准备好时先不动
    if (!adapter.root(document)) return;

    if (page >= maxPages) {
      renderBadge("max");
      return;
    }

    if (!nextHref()) {
      finished = true;
      renderBadge("end");
      return;
    }

    if (!nearBottom()) return;

    loadNext();
  }

  async function loadNext() {
    if (!adapter || !enabled || loading || finished) return;

    if (page >= maxPages) {
      renderBadge("max");
      return;
    }

    const href = nextHref();

    if (!href) {
      finished = true;
      renderBadge("end");
      return;
    }

    loading = true;

    // 跳转模式：直接打开下一页
    if (mode === "click") {
      renderBadge("loading");
      location.href = href;
      return;
    }

    renderBadge("loading");

    try {
      const res = await adapter.fetchPage(href);

      if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);

      const html = await res.text();

      // 等待期间用户可能已经把脚本关掉了
      if (!enabled) return;

      const remote = new DOMParser().parseFromString(html, "text/html");

      const source = adapter.source(remote);

      const target = adapter.root(document);

      if (!source || !target) {
        throw new Error("没有找到结果容器（可能触发了人机验证）");
      }

      const added = appendResults(source, target, page + 1);

      // 远端页面里影响结果排版的样式要一起带上
      if (added > 0) injectExtraStyles(remote);

      if (added === 0) {
        finished = true;

        clearRetry();

        renderBadge("end");

        return;
      }

      page += 1;

      clearRetry();

      // 记下远端页面的下一页链接，同时更新页面底部的按钮，
      // 让手动点“下一页”也能按追加后的进度走
      const remoteHref = adapter.nextHref(remote, href);

      pendingHref = remoteHref;

      const liveAnchor = adapter.nextAnchor(document);

      if (remoteHref && liveAnchor) {
        liveAnchor.setAttribute("href", remoteHref);
      } else if (!remoteHref) {
        finished = true;
      }

      renderBadge(finished ? "end" : "idle");

      // 追加后页面仍然不够长时接着往下加载
      setTimeout(maybeLoad, 600);
    } catch (e) {
      lastErrorAt = Date.now();

      log("加载下一页失败:", e);

      renderBadge("error");

      // 自动重试期间提示一下，避免用户误以为脚本卡住了
      if (scheduleRetry()) {
        const badge = document.getElementById(BADGE_ID);

        if (badge) badge.textContent = "加载失败 · 即将自动重试";
      }
    } finally {
      loading = false;
    }
  }

  /************************************************
   * 状态角标
   ************************************************/

  function badgeLabels() {
    return {
      off: "自动翻页已关闭",
      idle: `第 ${page} 页 · 滚动自动加载`,
      loading: `正在加载第 ${page + 1} 页…`,
      end: `已到最后一页（第 ${page} 页）`,
      max: `已达上限（${maxPages} 页）`,
      error: "加载失败 · 点击翻页",
    };
  }

  function renderBadge(next) {
    if (next) status = next;

    const badge = document.getElementById(BADGE_ID);

    if (!badge) return;

    const labels = badgeLabels();

    badge.textContent = labels[status] || labels.idle;

    badge.title = `${adapter ? adapter.name : ""} · 点击开启/关闭自动翻页 · Alt+J 切换 · Alt+K 加载下一页`;
  }

  function hideBadge() {
    const badge = document.getElementById(BADGE_ID);

    if (badge) badge.remove();
  }

  function onBadgeClick() {
    // 追加失败时，点击角标改为直接跳转下一页
    if (status === "error") {
      const href = nextHref();

      if (href) {
        loading = true;
        location.href = href;
        return;
      }
    }

    setEnabled(!enabled);
  }

  function createBadge() {
    if (document.getElementById(BADGE_ID)) return;

    const badge = document.createElement("div");

    badge.id = BADGE_ID;

    badge.style.cssText = `
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483647;
      padding: 4px 9px;
      border-radius: 8px;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #fff;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      cursor: pointer;
      user-select: none;
      opacity: 0.6;
      transition: opacity .2s ease;
    `;

    badge.addEventListener("mouseenter", () => {
      badge.style.opacity = "1";
    });

    badge.addEventListener("mouseleave", () => {
      badge.style.opacity = "0.6";
    });

    badge.addEventListener("click", onBadgeClick);

    document.body.appendChild(badge);
  }

  /************************************************
   * 分页分割线样式
   ************************************************/

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");

    style.id = STYLE_ID;

    style.textContent = `
      .${DIVIDER_CLASS} {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 20px 0 8px;
        font-size: 13px;
        color: #70757a;
        user-select: none;
      }

      .${DIVIDER_CLASS}::before,
      .${DIVIDER_CLASS}::after {
        content: "";
        flex: 1;
        height: 1px;
        background: currentColor;
        opacity: .3;
      }

      @media (prefers-color-scheme: dark) {
        .${DIVIDER_CLASS} {
          color: #9aa0a6;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /************************************************
   * 开关
   ************************************************/

  function setEnabled(value) {
    enabled = Boolean(value);

    write("enabled", enabled);

    if (!enabled) {
      clearRetry();

      renderBadge("off");

      return;
    }

    finished = false;

    lastErrorAt = 0;

    clearRetry();

    renderBadge("idle");

    maybeLoad();
  }

  /************************************************
   * 更新
   ************************************************/

  // 和脚本头部的 @updateURL 保持一致
  const SCRIPT_PAGE =
    "https://github.com/zedca/BrowserScript/raw/main/auto-paginate.user.js";

  const JSDELIVR_SCRIPT =
    "https://cdn.jsdelivr.net/gh/zedca/BrowserScript@main/auto-paginate.user.js";
  const PURGE_URL =
    "https://purge.jsdelivr.net/gh/zedca/BrowserScript@main/auto-paginate.user.js";

  // 取新版本用：GitHub raw 更新最及时，jsDelivr 当备用线路（分支内容会缓存一段时间）
  const SCRIPT_SOURCES = [
    "https://raw.githubusercontent.com/zedca/BrowserScript/main/auto-paginate.user.js",
    SCRIPT_PAGE,
    JSDELIVR_SCRIPT,
  ];

  // 油猴没给 GM_info 时用它兜底（记得和头部的 @version 一起改）
  const FALLBACK_VERSION = "1.1.3";

  function localVersion() {
    try {
      const version = GM_info && GM_info.script && GM_info.script.version;

      if (version) return version;
    } catch (e) {
      log("读取脚本版本失败:", e);
    }

    return FALLBACK_VERSION;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      // 页面自己的 fetch 会被 Google 的 CSP 拦住，优先走油猴的请求
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
   * 菜单
   ************************************************/

  function registerMenu() {
    const safe = (label, fn) => {
      try {
        GM_registerMenuCommand(label, fn);
      } catch (e) {
        log("注册菜单失败:", e);
      }
    };

    safe("开启 / 关闭自动翻页", () => setEnabled(!enabled));

    safe(`翻页方式：${mode === "append" ? "追加结果" : "跳转下一页"}`, () => {
      mode = mode === "append" ? "click" : "append";

      write("mode", mode);

      alert(
        `翻页方式已切换为：${mode === "append" ? "追加结果" : "跳转下一页"}`,
      );
    });

    safe(`最大页数（当前 ${maxPages}）`, () => {
      const input = prompt(
        "最多自动加载到第几页（含当前页）",
        String(maxPages),
      );

      if (input === null) return;

      const value = toPositiveInt(input, 0);

      if (!value) {
        alert("请输入大于 0 的整数");
        return;
      }

      maxPages = value;

      write("maxPages", value);

      finished = false;

      renderBadge(enabled ? "idle" : "off");

      maybeLoad();
    });

    safe("立即加载下一页", () => {
      finished = false;

      lastErrorAt = 0;

      clearRetry();

      if (!enabled) setEnabled(true);

      loadNext();
    });

    safe(`更新脚本（当前 v${localVersion()}）`, checkUpdate);

    // 以后适配多个站点时，用来确认当前页面命中的是哪一个
    safe(`当前站点：${adapter ? adapter.name : "未识别"}`, () => {
      alert(
        [
          `适配器：${adapter ? adapter.name : "未识别"}`,
          `每页条数：${adapter ? adapter.pageSize : "-"}`,
          `翻页方式：${mode === "append" ? "追加结果" : "跳转下一页"}`,
          `最大页数：${maxPages}`,
          `当前页：${page}`,
        ].join("\n"),
      );
    });

    safe("重置设置", () => {
      enabled = DEFAULT_ENABLED;

      mode = DEFAULT_MODE;

      maxPages = DEFAULT_MAX_PAGES;

      write("enabled", enabled);

      write("mode", mode);

      write("maxPages", maxPages);

      finished = false;

      lastErrorAt = 0;

      renderBadge(enabled ? "idle" : "off");

      alert("已重置");
    });
  }

  /************************************************
   * 快捷键
   ************************************************/

  function registerHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      const key = e.key.toLowerCase();

      // Alt + J：开启/关闭
      if (key === "j") {
        e.preventDefault();

        setEnabled(!enabled);

        return;
      }

      // Alt + K：立即加载下一页
      if (key === "k") {
        e.preventDefault();

        finished = false;

        lastErrorAt = 0;

        clearRetry();

        if (!enabled) setEnabled(true);

        loadNext();
      }
    });
  }

  /************************************************
   * URL 变化（Google 等站点会用 History API 切换搜索条件）
   ************************************************/

  function watchUrlChange() {
    let last = location.href;

    setInterval(() => {
      if (location.href === last) return;

      last = location.href;

      const next = resolveAdapter(new URL(location.href));

      pendingHref = null;

      // 从支持翻页的页面切到了不支持的页面
      if (!next) {
        adapter = null;

        clearRetry();

        hideBadge();

        return;
      }

      adapter = next;

      page = currentPage();

      finished = false;

      lastErrorAt = 0;

      clearRetry();

      createBadge();

      startObserving();

      renderBadge(enabled ? "idle" : "off");

      maybeLoad();
    }, 1000);
  }

  /************************************************
   * 初始化
   ************************************************/

  let scrollScheduled = false;

  function onScroll() {
    if (scrollScheduled) return;

    scrollScheduled = true;

    requestAnimationFrame(() => {
      scrollScheduled = false;

      maybeLoad();
    });
  }

  function init() {
    adapter = resolveAdapter(new URL(location.href));

    if (!adapter) {
      log("当前页面没有匹配的适配器，跳过");
      return;
    }

    log(`已启用：${adapter.name}`);

    page = currentPage();

    injectStyle();

    createBadge();

    startObserving();

    if (enabled && page >= maxPages) {
      renderBadge("max");
    } else {
      renderBadge(enabled ? "idle" : "off");
    }

    window.addEventListener("scroll", onScroll, { passive: true });

    window.addEventListener("resize", onScroll, { passive: true });

    registerMenu();

    registerHotkeys();

    watchUrlChange();

    // 首屏内容不足一屏时补一页
    setTimeout(maybeLoad, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/************************************************
 * 新站点模板
 *
 * 复制到 ADAPTERS 数组里，再把 @match 加上对应域名。
 * 最简只需要 test / root / nextHref 三项。
 ************************************************/

/*
const exampleAdapter = createAdapter({
  id: "example",
  name: "示例站点",
  test: (url) => url.hostname === "example.com" && url.pathname === "/list",

  // 每页 20 条，页码在 ?p= 里，从 1 开始
  pageSize: 20,
  currentPage: (url) => toPositiveInt(url.searchParams.get("p"), 1),

  root: (doc) => doc.querySelector(".result-list"),

  // 下一页按钮；没有就返回 null
  nextHref: (doc, base) => {
    const anchor = doc.querySelector("a.next-page");

    return anchor ? absoluteUrl(anchor.getAttribute("href"), base) : null;
  },

  // 可选：广告 / 推荐位整块跳过
  skipBlock: (node) => node.classList.contains("ad"),
});
*/
