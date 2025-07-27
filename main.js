// ==UserScript==
// @name         Steam游戏破解状态显示
// @namespace    https://github.com/Qiming-Liu/steam-crack-status
// @version      1.0.1
// @author       Qiming-Liu
// @description  在Steam商店页面显示游戏破解状态
// @license      GPLv3
// @icon         https://www.google.com/s2/favicons?sz=64&domain=store.steampowered.com
// @match        https://store.steampowered.com/app/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      store.steampowered.com
// @connect      gamestatus.info
// ==/UserScript==

(function () {
  "use strict";

  // Define styles for inline status tags
  GM_addStyle(`
        .crack-status-inline {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 14px;
            font-weight: 500;
            vertical-align: middle;
            line-height: 1.5;
            background: var(--gpBackground-LightSoft, rgba(103, 193, 245, 0.2));
            transition: background 0.3s;
        }
        .crack-status-inline:hover {
            background: var(--gpBackground-LightHard, rgba(103, 193, 245, 0.3));
        }
        .crack-status-cracked {
            color: var(--gpColor-Green, #5ba32b);
            border: 1px solid var(--gpColor-GreenHi, #59BF40);
            cursor: pointer;
        }
        .crack-status-uncracked {
            color: var(--gpColor-Red, #D94126);
            border: 1px solid var(--gpColor-RedHi, #EE563B);
            cursor: pointer;
        }
        .crack-status-loading {
            color: var(--gpColor-Yellow, #FFC82C);
            border: 1px solid var(--gpColor-Yellow, #FFC82C);
        }
        .crack-status-error {
            color: var(--gpColor-Orange, #E35E1C);
            border: 1px solid var(--gpColor-Orange, #E35E1C);
        }
        .crack-status-unknown {
            color: var(--gpColor-Yellow, #FFC82C);
            border: 1px solid var(--gpColor-Yellow, #FFC82C);
            cursor: default;
        }
    `);

  const log = (msg, data = null) => {
    const prefix = "%c[CrackStatus]";
    const style =
      "background: #2196f3; color: white; padding: 2px 6px; border-radius: 3px;";
    data
      ? console.log(prefix, style, msg, data)
      : console.log(prefix, style, msg);
  };

  const getAppId = () => {
    const match = window.location.pathname.match(/\/app\/(\d+)/);
    return match ? match[1] : null;
  };

  const formatGameNameForUrl = (name) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  };

  const getGameInfo = (appId) => {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://store.steampowered.com/api/appdetails?appids=${appId}&l=en`,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            if (data && data[appId] && data[appId].success) {
              resolve(data[appId].data);
            } else {
              reject(new Error("Game info unavailable"));
            }
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
      });
    });
  };

  const getCrackStatus = (gameName) => {
    const formatted = formatGameNameForUrl(gameName);
    const url = `https://gamestatus.info/back/api/gameinfo/game/${formatted}`;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            resolve({ data, url: `https://gamestatus.info/${formatted}/en` });
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
      });
    });
  };

  const createInlineStatusElement = (status, url) => {
    const el = document.createElement(
      status && status.crack_date !== undefined ? "a" : "span"
    );
    el.className = "crack-status-inline";
    if (status && !status.readable_status) {
      el.classList.add("crack-status-unknown");
      el.textContent = "⚠ 未知";
      el.title = "无法获取游戏名称，无法查询破解状态";
    } else if (status && status.crack_date !== null) {
      el.classList.add("crack-status-cracked");
      el.href = url;
      el.target = "_blank";
      el.textContent = `✓ 已破解 - ${status.readable_status || "已破解"}`;
      el.title = `跳转查看详情：${url}`;
    } else if (status && status.crack_date === null) {
      el.classList.add("crack-status-uncracked");
      el.href = url;
      el.target = "_blank";
      el.textContent = `✗ 未破解 - ${status.protections || "未知加密"}`;
      el.title = `跳转查看详情：${url}`;
    } else {
      el.classList.add("crack-status-error");
      el.textContent = "破解状态: 获取失败";
      el.title = "gamestatus 接口返回错误";
    }
    return el;
  };

  const main = async () => {
    const appId = getAppId();
    if (!appId) return;

    const titleEl = document.querySelector("#appHubAppName");
    if (!titleEl || titleEl.querySelector(".crack-status-inline")) return;

    const loading = document.createElement("span");
    loading.className = "crack-status-inline crack-status-loading";
    loading.textContent = "破解状态: 加载中...";
    titleEl.appendChild(loading);

    try {
      const gameInfo = await getGameInfo(appId);
      const gameName = gameInfo?.name;
      if (!gameName) {
        loading.replaceWith(createInlineStatusElement("unknown"));
        return;
      }

      const { data, url } = await getCrackStatus(gameName);
      const statusEl = createInlineStatusElement(data, url);
      loading.replaceWith(statusEl);
    } catch (e) {
      console.warn("[CrackStatus] 查询失败:", e);
      loading.replaceWith(createInlineStatusElement("unknown"));
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    setTimeout(main, 1000);
  }

  // Watch for SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      setTimeout(main, 1000);
    }
  }).observe(document, { childList: true, subtree: true });
})();
