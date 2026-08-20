/* HotHub 前端逻辑：加载 data/hotboards.json，渲染导航与榜单 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const DATA_URL = "data/hotboards.json";

  const state = {
    data: null,
    boardId: null,
    tabId: null,
    dimKey: null,
  };

  /* ---------- 主题 ---------- */
  const themeBtn = $("#theme-toggle");
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
    localStorage.setItem("hothub-theme", t);
  }
  const saved = localStorage.getItem("hothub-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  /* ---------- 工具 ---------- */
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function fmtTime(iso) {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtStat(n) {
    if (n == null) return "--";
    if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
    if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }

  /* ---------- 导航渲染 ---------- */
  function renderNav() {
    const nav = $("#nav");
    const groups = [];
    for (const b of state.data.boards) {
      let g = groups.find((x) => x.name === b.group);
      if (!g) {
        g = { name: b.group, boards: [] };
        groups.push(g);
      }
      g.boards.push(b);
    }
    nav.innerHTML = "";
    for (const g of groups) {
      const title = document.createElement("div");
      title.className = "nav-group-title";
      title.textContent = g.name;
      nav.appendChild(title);
      for (const b of g.boards) {
        const btn = document.createElement("button");
        btn.className = "nav-item" + (b.id === state.boardId ? " active" : "");
        btn.dataset.board = b.id;
        const tabCount = b.tabs ? b.tabs.length : 0;
        btn.innerHTML = `<span class="dot">${tabCount > 1 ? "📊" : "🔥"}</span><span>${esc(b.name)}</span>${
          tabCount > 1 ? `<span class="badge">${tabCount}</span>` : ""
        }`;
        btn.addEventListener("click", () => {
          selectBoard(b.id);
          closeSidebar();
        });
        nav.appendChild(btn);
      }
    }
  }

  /* ---------- 主区渲染 ---------- */
  function currentBoard() {
    return state.data.boards.find((b) => b.id === state.boardId) || null;
  }
  function currentTab() {
    const b = currentBoard();
    if (!b) return null;
    return b.tabs.find((t) => t.id === state.tabId) || b.tabs[0] || null;
  }

  function renderBoard() {
    const b = currentBoard();
    if (!b) return;
    $("#board-title").textContent = b.name;

    // tabs
    const tabsEl = $("#tabs");
    tabsEl.innerHTML = "";
    for (const t of b.tabs) {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (t.id === state.tabId ? " active" : "");
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        state.tabId = t.id;
        state.dimKey = t.dimensions ? t.dimensions[0].key : null;
        renderBoard();
      });
      tabsEl.appendChild(btn);
    }

    const t = currentTab();
    const dimsEl = $("#dims");
    dimsEl.innerHTML = "";
    if (t && t.dimensions && t.dimensions.length) {
      for (const d of t.dimensions) {
        const btn = document.createElement("button");
        btn.className = "dim-btn" + (d.key === state.dimKey ? " active" : "");
        btn.textContent = d.label;
        btn.addEventListener("click", () => {
          state.dimKey = d.key;
          renderBoard();
        });
        dimsEl.appendChild(btn);
      }
    }

    // update time
    $("#board-update").textContent = t && t.updateTime ? "更新于 " + fmtTime(t.updateTime) : "";
    renderList(t);
  }

  function renderList(t) {
    const list = $("#list");
    if (!t) {
      list.innerHTML = `<div class="empty">暂无数据</div>`;
      return;
    }
    if (t.error) {
      list.innerHTML = `<div class="error">⚠️ ${esc(t.error)}<br/>该榜单暂时无法获取，可能为数据源限制，稍后自动重试。</div>`;
      return;
    }
    let items = t.items || [];
    if (t.dimensions && state.dimKey) {
      items = [...items].sort((a, b) => (b.stats?.[state.dimKey] ?? -1) - (a.stats?.[state.dimKey] ?? -1));
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty">该榜单暂无条目</div>`;
      return;
    }
    list.innerHTML = "";
    items.forEach((it, i) => {
      const a = document.createElement("a");
      a.className = "item";
      a.href = it.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";

      const rank = document.createElement("span");
      rank.className = "rank" + (i === 0 ? " r1" : i === 1 ? " r2" : i === 2 ? " r3" : "");
      rank.textContent = it.rank || i + 1;

      const mid = document.createElement("div");
      mid.className = "item-mid";
      mid.style.flex = "1";
      mid.style.minWidth = "0";
      const title = document.createElement("div");
      title.className = "item-title";
      title.textContent = it.title || "(无标题)";
      mid.appendChild(title);

      const subs = [];
      if (it.desc) subs.push(it.desc);
      if (it.lang) subs.push(it.lang);
      if (it.sub) subs.push("r/" + it.sub);
      if (it.author) subs.push("@" + it.author);
      if (subs.length) {
        const sub = document.createElement("div");
        sub.className = "item-sub";
        sub.textContent = subs.join(" · ");
        mid.appendChild(sub);
      }

      const heat = document.createElement("span");
      heat.className = "item-heat";
      if (t.dimensions && state.dimKey && it.stats) {
        const dim = t.dimensions.find((d) => d.key === state.dimKey);
        heat.textContent = (dim ? dim.label : "") + " " + fmtStat(it.stats[state.dimKey]);
      } else {
        heat.textContent = it.heat || "";
      }

      a.appendChild(rank);
      a.appendChild(mid);
      a.appendChild(heat);
      list.appendChild(a);
    });
  }

  /* ---------- 交互 ---------- */
  function selectBoard(id) {
    state.boardId = id;
    const b = state.data.boards.find((x) => x.id === id);
    state.tabId = b && b.tabs.length ? b.tabs[0].id : null;
    state.dimKey = b && b.tabs[0] && b.tabs[0].dimensions ? b.tabs[0].dimensions[0].key : null;
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.board === id));
    renderBoard();
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#mask").classList.add("show");
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#mask").classList.remove("show");
  }
  $("#menu-btn").addEventListener("click", openSidebar);
  $("#mask").addEventListener("click", closeSidebar);
  $("#reload-btn").addEventListener("click", () => location.reload());

  /* ---------- 加载数据 ---------- */
  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.data = await res.json();
      $("#data-time").textContent = "数据更新于 " + fmtTime(state.data.updatedAt);
      if (!state.data.boards || !state.data.boards.length) throw new Error("数据为空");
      renderNav();
      const first = new URLSearchParams(location.search).get("b") || state.data.boards[0].id;
      selectBoard(first);
    } catch (e) {
      $("#list").innerHTML = `<div class="error">⚠️ 数据加载失败：${esc(e.message)}<br/>请确认 data/hotboards.json 存在（部署后由 GitHub Actions 自动生成）。</div>`;
      $("#board-title").textContent = "加载失败";
    }
  }

  load();
})();
