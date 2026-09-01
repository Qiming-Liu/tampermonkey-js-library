// ==UserScript==
// @name         网盘二维码/链接提取码一键跳转 v4
// @namespace    https://gamers520.com/
// @version      0.4.0
// @description  自动识别百度网盘/夸克网盘的二维码或文字链接，结合附近的提取码，使二维码可直接点击跳转（性能优化版）
// @match        https://gamers520.com/*.html
// @match        https://www.gamer520.com/*.html
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[QR-Helper]', ...a);
  const warn = (...a) => DEBUG && console.warn('[QR-Helper]', ...a);

  // ---------------- 网盘规则 ----------------
  const NETDISK_RULES = [
    {
      type: 'baidu',
      label: '百度网盘',
      urlRegex: /(https?:\/\/)?pan\.baidu\.com\/s\/[A-Za-z0-9_-]+/i,
      buildFinalUrl(url, code) {
        const full = url.startsWith('http') ? url : 'https://' + url;
        const sep = full.includes('?') ? '&' : '?';
        return code ? `${full}${sep}pwd=${code}` : full;
      },
    },
    {
      type: 'quark',
      label: '夸克网盘',
      urlRegex: /(https?:\/\/)?pan\.quark\.cn\/s\/[A-Za-z0-9_-]+/i,
      buildFinalUrl(url, code) {
        const full = url.startsWith('http') ? url : 'https://' + url;
        const sep = full.includes('?') ? '&' : '?';
        return code ? `${full}${sep}pwd=${code}` : full;
      },
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

  // ---------------- 第0道关卡：整页关键词预检查，命中才继续 ----------------
  const PAGE_GATE_REGEX = /网盘|夸克|迅雷|提取码|pan\.baidu\.com|pan\.quark\.cn/;

  // ---------------- 第1道关卡：确定正文范围，缩小扫描面积 ----------------
  const CONTENT_ROOT_SELECTORS = [
    'article',
    '.article-content',
    '.entry-content',
    '.post-content',
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

  // ---------------- 区域排除（导航/菜单/侧边栏——精确词匹配，避免误伤 theiaStickySidebar 这类类名） ----------------
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
  const CODE_REGEX = /(提取码|密码|访问码|口令)[\s:：]*([A-Za-z0-9]{3,8})\b/;

  function getScopeTextExcludingOthers(scope, selfContainer, otherContainers) {
    const skipChildren = new Set();
    Array.from(scope.children || []).forEach((child) => {
      if (child === selfContainer) return;
      const containsOther = otherContainers.some(
        (el) => el !== selfContainer && child.contains(el)
      );
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
      log(`向上第${level}层查找提取码`, text.trim().slice(0, 150));
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

  // ---------------- 快速路径：src参数直接编码链接 ----------------
  function extractFromImgSrc(src) {
    try {
      const u = new URL(src, location.href);
      for (const val of u.searchParams.values()) {
        const decoded = decodeURIComponent(val);
        const matched = matchNetdisk(decoded);
        if (matched) return matched;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // ---------------- 判断图片是否"值得"花代价去解码 ----------------
  function isQRLikeImage(img) {
    const w = img.naturalWidth,
      h = img.naturalHeight;
    if (!w || !h) return false;
    const sizeOk = w >= 50 && w <= 500 && h >= 50 && h <= 500;
    const squareOk = Math.abs(w - h) <= Math.max(w, h) * 0.25;
    return sizeOk && squareOk;
  }
  function hasNearbyNetdiskHint(img) {
    const alt = (img.alt || '').toLowerCase();
    if (/二维码|扫码|qrcode|qr/.test(alt)) return true;
    // 往上找3层，看卡片文字里有没有网盘相关关键词
    let node = img.parentElement;
    for (let i = 0; i < 3 && node; i++) {
      if (PAGE_GATE_REGEX.test(node.textContent || '')) return true;
      node = node.parentElement;
    }
    return false;
  }

  // ---------------- 像素级解码（仅在快速路径失败、且有上下文提示时才会被调用） ----------------
  function fetchImageBlobUrl(src) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: src,
        responseType: 'blob',
        onload: (resp) => (resp.response ? resolve(URL.createObjectURL(resp.response)) : reject(new Error('空响应'))),
        onerror: (e) => reject(e),
      });
    });
  }
  function decodeQRFromImg(imgEl) {
    const src = imgEl.currentSrc || imgEl.src;
    if (!src) return Promise.resolve(null);
    function decodeFromUrl(imgSrc) {
      return new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = im.naturalWidth;
            canvas.height = im.naturalHeight;
            const ctx = canvas.getContext('2d');
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
    return fetchImageBlobUrl(src)
      .then((blobUrl) => decodeFromUrl(blobUrl).then((r) => (URL.revokeObjectURL(blobUrl), r)))
      .catch((err) => {
        warn('GM_xmlhttpRequest失败，回退crossOrigin:', err);
        return new Promise((resolve) => {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = im.naturalWidth;
              canvas.height = im.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(im, 0, 0);
              const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(data.data, data.width, data.height);
              resolve(code ? code.data : null);
            } catch (err2) {
              warn('回退方式也失败:', err2);
              resolve(null);
            }
          };
          im.onerror = () => resolve(null);
          im.src = src;
        });
      });
  }

  function makeImageClickable(img, label, finalUrl) {
    img.style.cursor = 'pointer';
    img.style.outline = '2px solid #2d8cf0';
    img.style.outlineOffset = '2px';
    img.title = `点击跳转 ${label}${finalUrl.includes('pwd=') ? '（已带提取码）' : ''}`;
    img.addEventListener('click', () => window.open(finalUrl, '_blank'));
    log('图片已设为可点击:', label, finalUrl);
  }

  function wrapTextAsLink(textNode, matchedUrl, finalUrl, label) {
    const parent = textNode.parentNode;
    if (!parent) return null;
    const full = textNode.textContent;
    const idx = full.indexOf(matchedUrl);
    if (idx === -1) return parent;
    const before = full.slice(0, idx);
    const after = full.slice(idx + matchedUrl.length);
    const a = document.createElement('a');
    a.href = finalUrl;
    a.target = '_blank';
    a.textContent = matchedUrl;
    a.title = `点击跳转 ${label}`;
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(a);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, textNode);
    return a;
  }

  const processedImgs = new WeakSet();
  const processedTextParents = new WeakSet();
  const processedAnchors = new WeakSet();
  const allCandidates = [];

  function registerCandidate(sourceEl, rule, url, kind) {
    const startEl = kind === 'text' ? sourceEl.parentElement : sourceEl;
    const container = startEl.closest('div,li,section,article,td') || startEl;
    allCandidates.push({ container, rule, url, anchorEl: sourceEl, kind });
    log(`登记候选 [${rule.label}]`, { url, kind });
  }

  async function processImages(root) {
    const imgs = Array.from(root.querySelectorAll('img')).filter(
      (img) => !processedImgs.has(img) && isQRLikeImage(img) && !isInExcludedRegion(img, root)
    );
    for (const img of imgs) {
      processedImgs.add(img);
      const src = img.currentSrc || img.src;
      if (!src) continue;

      let matched = extractFromImgSrc(src);
      if (!matched) {
        // 只有图片本身/附近文字有网盘相关提示时，才值得花代价去真正解码像素
        if (!hasNearbyNetdiskHint(img)) {
          log('图片无网盘相关上下文提示，跳过解码以节省性能:', src.slice(0, 60));
          continue;
        }
        const decoded = await decodeQRFromImg(img);
        if (!decoded) continue;
        matched = matchNetdisk(decoded);
      }
      if (!matched) continue;
      registerCandidate(img, matched.rule, matched.url, 'img');
    }
  }

  function processTextLinks(root) {
    const candidates = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (isInExcludedRegion(node.parentElement, root)) return NodeFilter.FILTER_REJECT;
        if (processedTextParents.has(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const matched = matchNetdisk(node.textContent);
      if (matched) candidates.push({ el: node, matched, kind: 'text' });
    }
    root.querySelectorAll('a[href]').forEach((a) => {
      if (processedAnchors.has(a) || isInExcludedRegion(a, root)) return;
      const matched = matchNetdisk(a.getAttribute('href') || '');
      if (matched) candidates.push({ el: a, matched, kind: 'anchor' });
    });
    candidates.forEach(({ el, matched, kind }) => {
      if (kind === 'text') {
        if (processedTextParents.has(el)) return;
        processedTextParents.add(el);
      } else {
        if (processedAnchors.has(el)) return;
        processedAnchors.add(el);
      }
      registerCandidate(el, matched.rule, matched.url, kind);
    });
  }

  function finalizeCandidates() {
    const containers = allCandidates.map((c) => c.container);
    allCandidates.forEach((c) => {
      const code = findExtractionCode(c.container, containers);
      const finalUrl = c.rule.buildFinalUrl(c.url, code);
      if (c.kind === 'img') makeImageClickable(c.anchorEl, c.rule.label, finalUrl);
      else if (c.kind === 'anchor') {
        c.anchorEl.href = finalUrl;
        c.anchorEl.target = '_blank';
      } else if (c.kind === 'text') wrapTextAsLink(c.anchorEl, c.url, finalUrl, c.rule.label);
    });
    allCandidates.length = 0;
  }

  let scanned = false;
  async function scan() {
    const root = getContentRoot();
    // 第0道关卡：正文里完全没有网盘相关字样，直接跳过，不做任何图片/DOM遍历
    if (!PAGE_GATE_REGEX.test(root.textContent || '')) {
      log('未检测到网盘相关关键词，跳过扫描');
      return;
    }
    log('====== 开始扫描 ======', root);
    await processImages(root);
    processTextLinks(root);
    finalizeCandidates();
    log('====== 扫描结束 ======');
  }

  function init() {
    scan();
    const root = getContentRoot();
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scan, 500);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
