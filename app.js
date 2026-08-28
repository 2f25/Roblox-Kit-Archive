const $ = (s) => document.querySelector(s);

const ui = {
  tree: $("#tree"),
  list: $("#list"),
  crumbs: $("#breadcrumbs"),
  preview: $("#preview"),
  statusLeft: $("#statusLeft"),
  statusRight: $("#statusRight"),
  btnBack: $("#btnBack"),
  btnForward: $("#btnForward"),
  btnUp: $("#btnUp"),
  search: $("#searchInput"),
  clearSearch: $("#clearSearch"),
  listTitle: $("#listTitle"),
};

const ROOT_PATH = "Roblox Kit Archive";

const state = {
  owner: "2f25",
  repo: "Roblox-Kit-Archive",
  branch: "main",
  cwdPath: "",
  history: [],
  forward: [],
  selected: null,
  cache: new Map(),
  query: "",
  fullIndex: null,
  indexingPromise: null,
  searchTimer: null,
};

init().catch(showFatalError);

async function init() {
  wireUI();
  await navigateTo(ROOT_PATH, { push: false, clearSearch: false });
  updateNavButtons();
}

function wireUI() {
  ui.btnBack?.addEventListener("click", async () => {
    const prev = state.history.pop();
    if (prev === undefined) return;
    state.forward.push(state.cwdPath);
    await navigateTo(prev, { push: false });
    updateNavButtons();
  });

  ui.btnForward?.addEventListener("click", async () => {
    const next = state.forward.pop();
    if (next === undefined) return;
    state.history.push(state.cwdPath);
    await navigateTo(next, { push: false });
    updateNavButtons();
  });

  ui.btnUp?.addEventListener("click", async () => {
    if (state.cwdPath === ROOT_PATH) return;
    const parts = splitPath(state.cwdPath);
    parts.pop();
    await navigateTo(joinPath(parts) || ROOT_PATH);
    updateNavButtons();
  });

  // Debounce keeps typing smooth on phones and prevents needless re-renders.
  ui.search?.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(runSearchFromInput, 180);
    updateClearSearchButton();
  });

  ui.search?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSearch();
  });

  ui.clearSearch?.addEventListener("click", () => {
    clearSearch();
    ui.search?.focus();
  });
}

async function runSearchFromInput() {
  const query = (ui.search?.value || "").trim().toLowerCase();
  state.query = query;
  updateClearSearchButton();

  if (!query) {
    renderList();
    updateStatus();
    return;
  }

  const queryAtStart = query;
  ui.listTitle.textContent = "Search";
  ui.list.innerHTML = `<div class="row messageRow"><div>Searching the archive…</div><div></div><div></div></div>`;
  ui.statusLeft.textContent = "Building search index…";

  try {
    await ensureSearchIndex();

    // Ignore an old async result if the user changed the query while it loaded.
    if (state.query !== queryAtStart) return;

    renderSearchResults();
    updateStatus();
  } catch (err) {
    console.error(err);
    if (state.query !== queryAtStart) return;
    ui.listTitle.textContent = "Search";
    ui.list.innerHTML = `
      <div class="row messageRow">
        <div>
          Search could not load right now. You can still browse folders normally.
          <div class="muted" style="margin-top:4px;">${escapeHtml(err.message)}</div>
        </div><div></div><div></div>
      </div>`;
    ui.statusLeft.textContent = "Search unavailable";
  }
}

function clearSearch({ render = true } = {}) {
  clearTimeout(state.searchTimer);
  state.query = "";
  if (ui.search) ui.search.value = "";
  updateClearSearchButton();
  if (render) {
    renderList();
    updateStatus();
  }
}

function updateClearSearchButton() {
  if (!ui.clearSearch || !ui.search) return;
  ui.clearSearch.hidden = ui.search.value.length === 0;
}

function updateNavButtons() {
  if (ui.btnBack) ui.btnBack.disabled = state.history.length === 0;
  if (ui.btnForward) ui.btnForward.disabled = state.forward.length === 0;
  if (ui.btnUp) ui.btnUp.disabled = state.cwdPath === ROOT_PATH;
}

function ghApi(path) {
  return `https://api.github.com/repos/${state.owner}/${state.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(state.branch)}`;
}

function ghTreeApi() {
  return `https://api.github.com/repos/${state.owner}/${state.repo}/git/trees/${encodeURIComponent(state.branch)}?recursive=1`;
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/${encodeURIComponent(state.branch)}/${encodeURIComponentPath(path)}`;
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const suffix = remaining === "0" ? " (GitHub API rate limit reached)" : "";
    throw new Error(`GitHub API error: ${res.status}${suffix}`);
  }

  return res.json();
}

async function fetchContents(path) {
  if (state.cache.has(path)) return state.cache.get(path);

  const data = await fetchJson(ghApi(path));
  const arr = Array.isArray(data) ? data : [];
  state.cache.set(path, arr);
  return arr;
}

async function ensureSearchIndex() {
  if (state.fullIndex) return state.fullIndex;
  if (state.indexingPromise) return state.indexingPromise;

  state.indexingPromise = (async () => {
    const data = await fetchJson(ghTreeApi());

    if (data.truncated) {
      throw new Error("The repository search index was truncated by GitHub.");
    }

    const prefix = `${ROOT_PATH}/`;
    const tree = Array.isArray(data.tree) ? data.tree : [];

    state.fullIndex = tree
      .filter((entry) =>
        (entry.type === "blob" || entry.type === "tree") &&
        (entry.path === ROOT_PATH || entry.path.startsWith(prefix))
      )
      .map((entry) => ({
        type: entry.type === "tree" ? "dir" : "file",
        name: lastPathPart(entry.path),
        path: entry.path,
        size: entry.size || 0,
        download_url: entry.type === "blob" ? rawUrl(entry.path) : null,
      }));

    return state.fullIndex;
  })();

  try {
    return await state.indexingPromise;
  } finally {
    state.indexingPromise = null;
  }
}

async function navigateTo(path, opts = {}) {
  const { push = true, clearSearch: shouldClearSearch = true } = opts;

  if (push && state.cwdPath && state.cwdPath !== path) {
    state.history.push(state.cwdPath);
    state.forward = [];
  }

  state.cwdPath = path;
  state.selected = null;

  if (shouldClearSearch) clearSearch({ render: false });

  await fetchContents(path);

  renderBreadcrumbs();
  await renderTree();
  renderList();
  renderPreview(null);
  updateStatus();
}

function renderBreadcrumbs() {
  const parts = splitPath(state.cwdPath);
  let html = `<a href="#" data-path="${escapeHtml(ROOT_PATH)}">Home</a>`;

  let current = "";
  for (const p of parts) {
    current += (current ? "/" : "") + p;
    if (current === ROOT_PATH) continue;
    html += ` <span class="sep">›</span> <a href="#" data-path="${escapeHtml(current)}">${escapeHtml(p)}</a>`;
  }

  ui.crumbs.innerHTML = html;

  ui.crumbs.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      await navigateTo(a.getAttribute("data-path"));
      updateNavButtons();
    });
  });

  // Keep the current location visible after navigating on narrow screens.
  requestAnimationFrame(() => {
    ui.crumbs.scrollLeft = ui.crumbs.scrollWidth;
  });
}

async function renderTree() {
  ui.tree.innerHTML = "";

  const rootItems = await fetchContents(ROOT_PATH);
  const folders = rootItems
    .filter((x) => x.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    ui.tree.appendChild(await makeTreeNode(folder));
  }
}

async function makeTreeNode(folder) {
  const wrap = document.createElement("div");

  const row = document.createElement("div");
  row.className = "node" + (folder.path === state.cwdPath ? " active" : "");
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  const twisty = document.createElement("div");
  twisty.className = "twisty";
  twisty.textContent = "▸";

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = "📁";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = folder.name;

  row.append(twisty, icon, label);

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "children";
  childrenWrap.style.display = "none";

  wrap.append(row, childrenWrap);

  let expanded = false;
  let loaded = false;

  const shouldAutoExpand =
    state.cwdPath === folder.path || state.cwdPath.startsWith(folder.path + "/");

  if (shouldAutoExpand && !isMobileLayout()) await expand();

  const activate = async (e) => {
    const clickedTwisty = e?.target === twisty;

    if (clickedTwisty && !isMobileLayout()) {
      expanded ? collapse() : await expand();
      return;
    }

    await navigateTo(folder.path);
    updateNavButtons();
  };

  row.addEventListener("click", activate);
  row.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await activate(e);
    }
  });

  async function expand() {
    expanded = true;
    twisty.textContent = "▾";
    childrenWrap.style.display = "block";

    if (loaded) return;
    loaded = true;

    const items = await fetchContents(folder.path);
    const childFolders = items
      .filter((x) => x.type === "dir")
      .sort((a, b) => a.name.localeCompare(b.name));

    if (childFolders.length === 0) {
      twisty.textContent = "";
      return;
    }

    for (const child of childFolders) {
      childrenWrap.appendChild(await makeTreeNode(child));
    }
  }

  function collapse() {
    expanded = false;
    twisty.textContent = "▸";
    childrenWrap.style.display = "none";
  }

  return wrap;
}

function renderList() {
  if (state.query && state.fullIndex) {
    renderSearchResults();
    return;
  }

  ui.listTitle.textContent = "Details";

  const items = state.cache.get(state.cwdPath) || [];
  const folders = items
    .filter((x) => x.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = items
    .filter((x) => x.type === "file")
    .sort((a, b) => extractSeason(b.name) - extractSeason(a.name) || a.name.localeCompare(b.name));

  ui.list.innerHTML = "";

  for (const folder of folders) ui.list.appendChild(makeRow(folder, true));
  for (const file of files) ui.list.appendChild(makeRow(file, false));

  if (folders.length === 0 && files.length === 0) {
    ui.list.innerHTML = `<div class="row messageRow"><div>This folder is empty.</div><div></div><div></div></div>`;
  }
}

function renderSearchResults() {
  const words = state.query.split(/\s+/).filter(Boolean);

  const matches = state.fullIndex
    .filter((item) => item.path !== ROOT_PATH)
    .map((item) => {
      const name = stripExt(item.name).toLowerCase();
      const path = item.path.toLowerCase();
      const matchesAll = words.every((word) => name.includes(word) || path.includes(word));
      if (!matchesAll) return null;

      let score = 0;
      const phrase = state.query;
      if (name === phrase) score += 100;
      if (name.startsWith(phrase)) score += 50;
      if (name.includes(phrase)) score += 25;
      if (item.type === "file") score += 5;
      return { item, score };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.score - a.score ||
      extractSeason(b.item.name) - extractSeason(a.item.name) ||
      a.item.name.localeCompare(b.item.name)
    )
    .slice(0, 250)
    .map(({ item }) => item);

  ui.listTitle.textContent = `Search Results (${matches.length}${matches.length === 250 ? "+" : ""})`;
  ui.list.innerHTML = "";

  if (matches.length === 0) {
    ui.list.innerHTML = `<div class="row messageRow"><div>No kits or folders found matching “${escapeHtml(state.query)}”.</div><div></div><div></div></div>`;
    return;
  }

  for (const item of matches) ui.list.appendChild(makeSearchRow(item));
}

function makeSearchRow(item) {
  const isFolder = item.type === "dir";
  const row = document.createElement("div");
  row.className = "row searchResultRow";
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon">${isFolder ? "📁" : "🖼️"}</div>
      <div class="text">
        <div>${escapeHtml(stripExt(item.name))}</div>
        <div class="resultPath">${escapeHtml(folderLabelFor(item))}</div>
      </div>
    </div>
    <div>${isFolder ? "Folder" : "PNG File"}</div>
    <div>${isFolder ? "" : prettyBytes(item.size)}</div>
  `;

  const activate = async () => {
    if (isFolder) {
      await navigateTo(item.path);
      updateNavButtons();
    } else {
      state.selected = item;
      renderPreview(item);
      markSelectedRow(row);
      updateStatus();
      if (isMobileLayout()) scrollPreviewIntoView();
    }
  };

  row.addEventListener("click", activate);
  row.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await activate();
    }
  });

  return row;
}

function makeRow(item, isFolder) {
  const row = document.createElement("div");
  row.className = "row";
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon">${isFolder ? "📁" : "🖼️"}</div>
      <div class="text">${escapeHtml(stripExt(item.name))}</div>
    </div>
    <div>${isFolder ? "Folder" : "PNG File"}</div>
    <div>${isFolder ? "" : prettyBytes(item.size)}</div>
  `;

  const activate = async () => {
    if (isFolder) {
      await navigateTo(item.path);
      updateNavButtons();
    } else {
      state.selected = item;
      renderPreview(item);
      markSelectedRow(row);
      updateStatus();
      if (isMobileLayout()) scrollPreviewIntoView();
    }
  };

  row.addEventListener("click", activate);
  row.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await activate();
    }
  });

  return row;
}

function markSelectedRow(row) {
  ui.list.querySelectorAll(".row.selected").forEach((el) => el.classList.remove("selected"));
  row.classList.add("selected");
}

function renderPreview(file) {
  if (!file) {
    ui.preview.innerHTML = `<div class="muted">Select a kit to preview.</div>`;
    return;
  }

  const src = file.download_url || rawUrl(file.path);
  ui.preview.innerHTML = `
    <img src="${escapeHtml(src)}" alt="${escapeHtml(stripExt(file.name))}" loading="lazy" />
    <div class="previewName">${escapeHtml(stripExt(file.name))}</div>
    <div class="previewActions">
      <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">Open image</a>
    </div>
  `;
}

function scrollPreviewIntoView() {
  const previewPanel = document.querySelector(".preview");
  if (!previewPanel) return;
  requestAnimationFrame(() => {
    previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function updateStatus() {
  if (state.query && state.fullIndex) {
    const words = state.query.split(/\s+/).filter(Boolean);
    const count = state.fullIndex.filter((item) => {
      if (item.path === ROOT_PATH) return false;
      const haystack = `${stripExt(item.name)} ${item.path}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    }).length;
    ui.statusLeft.textContent = `${count} search result${count === 1 ? "" : "s"}`;
  } else {
    const items = state.cache.get(state.cwdPath) || [];
    const folderCount = items.filter((x) => x.type === "dir").length;
    const fileCount = items.filter((x) => x.type === "file").length;
    ui.statusLeft.textContent = `${folderCount} folder(s), ${fileCount} file(s)`;
  }

  ui.statusRight.textContent = state.selected ? stripExt(state.selected.name) : "";
}

function folderLabelFor(item) {
  const parts = splitPath(item.path);
  parts.pop();
  if (parts[0] === ROOT_PATH) parts.shift();
  return parts.length ? parts.join(" / ") : "Home";
}

function lastPathPart(path) {
  const parts = splitPath(path);
  return parts[parts.length - 1] || path;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function stripExt(name) {
  return String(name).replace(/\.[^/.]+$/, "");
}

function extractSeason(name) {
  const match = String(name).match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : 0;
}

function prettyBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = bytes;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return `${Math.round(value)} ${units[i]}`;
}

function splitPath(path) {
  return path ? path.split("/").filter(Boolean) : [];
}

function joinPath(parts) {
  return parts.filter(Boolean).join("/");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

function showFatalError(err) {
  console.error(err);
  if (ui.list) {
    ui.list.innerHTML = `<div class="row messageRow"><div>Error: ${escapeHtml(err.message)}</div><div></div><div></div></div>`;
  }
  if (ui.statusLeft) ui.statusLeft.textContent = "Could not load archive";
}
