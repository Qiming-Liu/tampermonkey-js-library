// ==UserScript==
// @name         网盘二维码/链接提取码一键跳转 v5
// @namespace    https://gamers520.com/
// @version      0.5.0
// @description  自动识别百度/夸克/迅雷网盘的二维码或文字链接，结合附近的提取码，使二维码可直接点击跳转
// @match        *://*.gamers520.com/*.html
// @match        *://*.gamer520.com/*.html
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[QR-Helper]', ...a);
  const warn = (...a) => DEBUG && console.warn('[QR-Helper]', ...a);

  // ---------------- 网盘规则 ----------------
  // 链接自身带的 pwd 优先于页面上找到的提取码
  function buildWithPwd(url, code) {
    const full = url.startsWith('http') ? url : 'https://' + url;
    try {
      const u = new URL(full);
      if (u.searchParams.get('pwd')) return u.href;
      if (code) u.searchParams.set('pwd', code);
      return u.href;
    } catch (e) {
      return full;
    }
  }

  const NETDISK_RULES = [
    {
      type: 'baidu',
      label: '百度网盘',
      urlRegex: /(https?:\/\/)?pan\.baidu\.com\/s\/[A-Za-z0-9_-]+(\?[^\s"'<>]*)?/i,
    },
    {
      type: 'quark',
      label: '夸克网盘',
      urlRegex: /(https?:\/\/)?pan\.quark\.cn\/s\/[A-Za-z0-9_-]+(\?[^\s"'<>]*)?/i,
    },
    {
      type: 'xunlei',
      label: '迅雷云盘',
      urlRegex: /(https?:\/\/)?pan\.xunlei\.com\/s\/[A-Za-z0-9_-]+(\?[^\s"'<>]*)?/i,
    },
  ];

  function matchNetdisk(text) {
    if (!text) return null;
    for (const rule of NETDISK_RULES) {
      const m = text.match(rule.urlRegex);
      if (m) return { rule, url: m[0] };
    }
    return null;
  }

  // ---------------- 第0道关卡：整页关键词预检查 ----------------
  const PAGE_GATE_REGEX = /网盘|夸克|迅雷|提取码|pan\.baidu\.com|pan\.quark\.cn|pan\.xunlei\.com/;

  // ---------------- 第1道关卡：确定正文范围 ----------------
  const CONTENT_ROOT_SELECTORS = [
    '.entry-content',
    '.article-content',
    '.post-content',
    'article',
    '.content-column',
    'main',
  ];
  function getContentRoot() {
    for (const sel of CONTENT_ROOT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  // ---------------- 区域排除（导航/菜单/侧边栏） ----------------
  const EXCLUDE_KEYWORDS = ['nav', 'navbar', 'menu', 'sidebar', 'widget'];
  function tokenMatchesExcluded(str) {
    if (!str) return false;
    return str.split(/\s+/).some((tok) => {
      const t = tok.toLowerCase();
      if (!t) return false;
      if (EXCLUDE_KEYWORDS.includes(t)) return true;
      if (EXCLUDE_KEYWORDS.some((k) => t.startsWith(k + '-') || t.startsWith(k + '_'))) return true;
      if (EXCLUDE_KEYWORDS.some((k) => t.endsWith('-' + k) || t.endsWith('_' + k))) return true;
      return false;
    });
  }
  function isInExcludedRegion(el, boundary) {
    let node = el;
    while (node && node !== boundary && node !== document.body) {
      const tag = node.tagName;
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'ASIDE') return true;
      const cls = typeof node.className === 'string' ? node.className : '';
      if (tokenMatchesExcluded(cls) || tokenMatchesExcluded(node.id || '')) return true;
      node = node.parentElement;
    }
    return false;
  }

  // ---------------- 提取码就近查找 ----------------
  // 排除“解压密码”，它不是网盘提取码
  const CODE_REGEX = /(?<!解压)(提取码|密码|访问码|口令)[\s:：]*([A-Za-z0-9]{3,8})(?![A-Za-z0-9])/;

  function getScopeTextExcludingOthers(scope, selfContainer, otherContainers) {
    const skipChildren = new Set();
    Array.from(scope.children || []).forEach((child) => {
      if (child === selfContainer) return;
      const containsOther = otherContainers.some((el) => el !== selfContainer && child.contains(el));
      if (containsOther) skipChildren.add(child);
    });
    let text = '';
    (function walk(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (skipChildren.has(node)) return;
        node.childNodes.forEach(walk);
      } else if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent + ' ';
      }
    })(scope);
    return text;
  }

  function findExtractionCode(anchorContainer, allContainers, maxLevels = 4) {
    let scope = anchorContainer;
    for (let level = 0; level < maxLevels && scope; level++) {
      const text = getScopeTextExcludingOthers(scope, anchorContainer, allContainers);
      const m = text.match(CODE_REGEX);
      if (m) {
        log('✅ 找到提取码:', m[2]);
        return m[2];
      }
      scope = scope.parentElement;
    }
    warn('❌ 未找到提取码', anchorContainer);
    return null;
  }

  // ---------------- 快速路径：图片 src 参数里直接编码了链接（如 api.qrserver.com） ----------------
  function extractFromImgSrc(src) {
    let u;
    try {
      u = new URL(src, location.href);
    } catch (e) {
      return null;
    }
    for (const val of u.searchParams.values()) {
      let decoded = val;
      try {
        decoded = decodeURIComponent(val);
      } catch (e) {
        /* 已经解码过 */
      }
      const matched = matchNetdisk(decoded);
      if (matched) return matched;
    }
    return null;
  }

  // ---------------- 判断图片是否值得做像素解码 ----------------
  function isQRLikeImage(img) {
    const w = img.naturalWidth,
      h = img.naturalHeight;
    if (!w || !h) return false;
    const sizeOk = w >= 50 && w <= 600 && h >= 50 && h <= 600;
    const squareOk = Math.abs(w - h) <= Math.max(w, h) * 0.25;
    return sizeOk && squareOk;
  }
  function hasNearbyNetdiskHint(img) {
    if (/二维码|扫码|qrcode|qr/i.test(img.alt || '')) return true;
    let node = img.parentElement;
    for (let i = 0; i < 3 && node; i++) {
      if (PAGE_GATE_REGEX.test(node.textContent || '')) return true;
      node = node.parentElement;
    }
    return false;
  }

  // ---------------- 像素级解码 ----------------
  function fetchImageBlobUrl(src) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: src,
        responseType: 'blob',
        onload: (resp) =>
          resp.response ? resolve(URL.createObjectURL(resp.response)) : reject(new Error('空响应')),
        onerror: reject,
        ontimeout: reject,
        timeout: 10000,
      });
    });
  }
  function decodeFromUrl(imgSrc, crossOrigin) {
    return new Promise((resolve) => {
      const im = new Image();
      if (crossOrigin) im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = im.naturalWidth;
          canvas.height = im.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(im, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(data.data, data.width, data.height);
          resolve(code ? code.data : null);
        } catch (err) {
          warn('canvas解析异常:', err);
          resolve(null);
        }
      };
      im.onerror = () => resolve(null);
      im.src = imgSrc;
    });
  }
  async function decodeQRFromImg(imgEl) {
    if (typeof jsQR !== 'function') return null;
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return null;
    try {
      const blobUrl = await fetchImageBlobUrl(src);
      try {
        return await decodeFromUrl(blobUrl, false);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      warn('GM_xmlhttpRequest失败，回退crossOrigin:', err);
      return decodeFromUrl(src, true);
    }
  }

  // ---------------- DOM 改造 ----------------
  function makeImageClickable(img, label, finalUrl) {
    if (img.dataset.qrHelperUrl) return;
    img.dataset.qrHelperUrl = finalUrl;
    img.style.cursor = 'pointer';
    img.style.outline = '2px solid #2d8cf0';
    img.style.outlineOffset = '2px';
    img.title = `点击跳转 ${label}${/[?&]pwd=/.test(finalUrl) ? '（已带提取码）' : ''}`;
    img.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(img.dataset.qrHelperUrl, '_blank');
    });
    log('图片已设为可点击:', label, finalUrl);
  }

  function wrapTextAsLink(textNode, matchedUrl, finalUrl, label) {
    const parent = textNode.parentNode;
    if (!parent) return;
    const full = textNode.textContent;
    const idx = full.indexOf(matchedUrl);
    if (idx === -1) return;
    const a = document.createElement('a');
    a.href = finalUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = matchedUrl;
    a.title = `点击跳转 ${label}`;
    const frag = document.createDocumentFragment();
    if (idx > 0) frag.appendChild(document.createTextNode(full.slice(0, idx)));
    frag.appendChild(a);
    const after = full.slice(idx + matchedUrl.length);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, textNode);
  }

  // ---------------- 扫描 ----------------
  const processed = new WeakSet();
  const pendingImgs = new WeakSet();

  function registerCandidate(list, sourceEl, matched, kind) {
    const startEl = kind === 'text' ? sourceEl.parentElement : sourceEl;
    const container = startEl.closest('div,li,section,article,td,p') || startEl;
    list.push({ container, rule: matched.rule, url: matched.url, el: sourceEl, kind });
    log(`登记候选 [${matched.rule.label}]`, matched.url, kind);
  }

  async function processImages(root, list) {
    for (const img of root.querySelectorAll('img')) {
      if (processed.has(img) || isInExcludedRegion(img, root)) continue;
      const src = img.currentSrc || img.src;
      if (!src) continue;

      // 快速路径不依赖图片是否已加载
      let matched = extractFromImgSrc(src);
      if (!matched) {
        if (!img.complete || !img.naturalWidth) {
          // 懒加载/未加载完的图片：等加载后再扫一次
          if (!pendingImgs.has(img)) {
            pendingImgs.add(img);
            img.addEventListener('load', scheduleScan, { once: true });
          }
          continue;
        }
        if (!isQRLikeImage(img) || !hasNearbyNetdiskHint(img)) {
          processed.add(img);
          continue;
        }
        processed.add(img);
        const decoded = await decodeQRFromImg(img);
        matched = decoded && matchNetdisk(decoded);
      }
      processed.add(img);
      if (matched) registerCandidate(list, img, matched, 'img');
    }
  }

  function processTextLinks(root, list) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        // 已经在链接里的文字交给下面的 a[href] 处理，否则会重复包裹
        if (p.closest('a')) return NodeFilter.FILTER_REJECT;
        if (processed.has(node) || isInExcludedRegion(p, root)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      processed.add(node);
      const matched = matchNetdisk(node.textContent);
      if (matched) registerCandidate(list, node, matched, 'text');
    }
    root.querySelectorAll('a[href]').forEach((a) => {
      if (processed.has(a) || isInExcludedRegion(a, root)) return;
      processed.add(a);
      const matched = matchNetdisk(a.getAttribute('href') || '');
      if (matched) registerCandidate(list, a, matched, 'anchor');
    });
  }

  function finalizeCandidates(list) {
    const containers = list.map((c) => c.container);
    for (const c of list) {
      const code = findExtractionCode(c.container, containers);
      const finalUrl = buildWithPwd(c.url, code);
      if (c.kind === 'img') makeImageClickable(c.el, c.rule.label, finalUrl);
      else if (c.kind === 'anchor') {
        c.el.href = finalUrl;
        c.el.target = '_blank';
      } else wrapTextAsLink(c.el, c.url, finalUrl, c.rule.label);
    }
  }

  let scanning = false;
  let rescanRequested = false;
  async function scan() {
    if (scanning) {
      rescanRequested = true;
      return;
    }
    scanning = true;
    try {
      const root = getContentRoot();
      if (!PAGE_GATE_REGEX.test(root.textContent || '')) {
        log('未检测到网盘相关关键词，跳过扫描');
        return;
      }
      const list = [];
      await processImages(root, list);
      processTextLinks(root, list);
      finalizeCandidates(list);
    } catch (e) {
      warn('扫描异常:', e);
    } finally {
      scanning = false;
      if (rescanRequested) {
        rescanRequested = false;
        scheduleScan();
      }
    }
  }

  let debounceTimer = null;
  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, 300);
  }

  function init() {
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
