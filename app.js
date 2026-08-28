const $ = (s) => document.querySelector(s);

const ui = {
  tree: $("#tree"),
  list: $("#list"),
  crumbs: $("#breadcrumbs"),
  preview: $("#preview"),
  previewPane: $("#previewPane"),
  statusLeft: $("#statusLeft"),
  statusRight: $("#statusRight"),
  btnBack: $("#btnBack"),
  btnForward: $("#btnForward"),
  btnUp: $("#btnUp"),
  btnFolders: $("#btnFolders"),
  btnCloseFolders: $("#btnCloseFolders"),
  btnClosePreview: $("#btnClosePreview"),
  drawerBackdrop: $("#drawerBackdrop"),
  search: $("#searchInput"),
  listTitle: $("#listTitle"),
};

const ROOT_PATH = "Roblox Kit Archive";
const MOBILE_BREAKPOINT = 900;
const SEARCH_DEBOUNCE_MS = 180;

let searchTimer = null;

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
  indexing: false,
  fullIndexPromise: null,
  searchToken: 0,
};

init().catch((err) => {
  console.error(err);
  ui.list.innerHTML = `<div class="row"><div>Error: ${escapeHtml(err.message)}</div><div></div><div></div></div>`;
});

async function init() {
  wireUI();
  await navigateTo(ROOT_PATH, { push: false });
  updateNavButtons();
}

function wireUI() {
  ui.search.addEventListener("input", handleSearchInput);

  ui.search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.search.value) {
      e.preventDefault();
      ui.search.value = "";
      handleSearchInput();
      ui.search.focus();
    }

    if (e.key === "Enter") {
      // Keep mobile browsers from treating Enter as a page/form navigation.
      e.preventDefault();
      ui.search.blur();
    }
  });

  ui.btnBack.addEventListener("click", async () => {
    const prev = state.history.pop();
    if (prev === undefined) return;
    state.forward.push(state.cwdPath);
    await navigateTo(prev, { push: false });
    updateNavButtons();
  });

  ui.btnForward.addEventListener("click", async () => {
    const next = state.forward.pop();
    if (next === undefined) return;
    state.history.push(state.cwdPath);
    await navigateTo(next, { push: false });
    updateNavButtons();
  });

  ui.btnUp.addEventListener("click", async () => {
    if (state.cwdPath === ROOT_PATH) return;
    const parts = splitPath(state.cwdPath);
    parts.pop();
    const next = joinPath(parts);
    await navigateTo(next || ROOT_PATH);
    updateNavButtons();
  });

  ui.btnFolders.addEventListener("click", () => setFoldersOpen(true));
  ui.btnCloseFolders.addEventListener("click", () => setFoldersOpen(false));
  ui.drawerBackdrop.addEventListener("click", () => setFoldersOpen(false));
  ui.btnClosePreview.addEventListener("click", closePreview);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.body.classList.contains("previewOpen")) {
      closePreview();
    } else if (document.body.classList.contains("foldersOpen")) {
      setFoldersOpen(false);
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) {
      setFoldersOpen(false);
      document.body.classList.remove("previewOpen");
    }
  });
}

function handleSearchInput() {
  const query = ui.search.value.trim().toLowerCase();
  state.query = query;
  state.selected = null;
  state.searchToken += 1;
  const token = state.searchToken;

  closePreview();
  clearTimeout(searchTimer);

  if (!query) {
    ui.listTitle.textContent = "Details";
    renderList();
    renderPreview(null);
    updateStatus();
    return;
  }

  // Give immediate feedback while the repository index is being prepared.
  if (!state.fullIndex) {
    ui.listTitle.textContent = "Search";
    ui.list.innerHTML = `
      <div class="searchMessage" role="status">
        <div class="searchSpinner" aria-hidden="true"></div>
        <div>Searching the archive…</div>
      </div>
    `;
  }

  searchTimer = setTimeout(() => runSearch(query, token), SEARCH_DEBOUNCE_MS);
}

async function runSearch(query, token) {
  try {
    await ensureFullIndex();

    // Ignore stale search jobs if the user kept typing or cleared the field.
    if (token !== state.searchToken || query !== state.query) return;

    renderSearchResults(query);
    updateStatus();
  } catch (err) {
    console.error(err);
    if (token !== state.searchToken || query !== state.query) return;

    ui.listTitle.textContent = "Search";
    ui.list.innerHTML = `
      <div class="searchMessage searchError" role="alert">
        <div>Search could not load.</div>
        <button type="button" class="retrySearchBtn">Try again</button>
      </div>
    `;

    const retry = ui.list.querySelector(".retrySearchBtn");
    retry?.addEventListener("click", () => {
      state.fullIndex = null;
      state.fullIndexPromise = null;
      state.indexing = false;
      handleSearchInput();
    });
  }
}

function isMobile() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function setFoldersOpen(open) {
  document.body.classList.toggle("foldersOpen", open && isMobile());
  ui.btnFolders.setAttribute("aria-expanded", String(open && isMobile()));
}

function openPreview() {
  if (isMobile()) document.body.classList.add("previewOpen");
}

function closePreview() {
  document.body.classList.remove("previewOpen");
}

function updateNavButtons() {
  ui.btnBack.disabled = state.history.length === 0;
  ui.btnForward.disabled = state.forward.length === 0;
  ui.btnUp.disabled = state.cwdPath === ROOT_PATH;
}

function ghApi(path) {
  return `https://api.github.com/repos/${state.owner}/${state.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(state.branch)}`;
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchContents(path) {
  if (state.cache.has(path)) return state.cache.get(path);

  const res = await fetch(ghApi(path));
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : [];
  state.cache.set(path, arr);
  return arr;
}

async function ensureFullIndex() {
  if (state.fullIndex) return state.fullIndex;
  if (state.fullIndexPromise) return state.fullIndexPromise;

  state.indexing = true;
  state.fullIndexPromise = buildFullIndex()
    .then((files) => {
      state.fullIndex = files;
      return files;
    })
    .finally(() => {
      state.indexing = false;
      state.fullIndexPromise = null;
    });

  return state.fullIndexPromise;
}

async function buildFullIndex() {
  // One recursive Git tree request replaces dozens/hundreds of per-folder
  // Contents API requests. This is substantially faster and more reliable on mobile.
  const treeUrl = `https://api.github.com/repos/${state.owner}/${state.repo}/git/trees/${encodeURIComponent(state.branch)}?recursive=1`;
  const res = await fetch(treeUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!res.ok) throw new Error(`GitHub search index error: ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error("GitHub returned an invalid search index.");
  if (data.truncated) throw new Error("The repository search index was truncated by GitHub.");

  const rootPrefix = `${ROOT_PATH}/`;

  return data.tree
    .filter((item) => item.type === "blob" && item.path.startsWith(rootPrefix))
    .map((item) => {
      const parts = splitPath(item.path);
      const name = parts[parts.length - 1] || item.path;

      return {
        type: "file",
        name,
        path: item.path,
        size: item.size || 0,
        download_url: rawFileUrl(item.path),
      };
    });
}

function rawFileUrl(path) {
  return `https://raw.githubusercontent.com/${state.owner}/${state.repo}/${encodeURIComponent(state.branch)}/${encodeURIComponentPath(path)}`;
}

function folderLabelFor(item) {
  const parts = splitPath(item.path);
  const rootIndex = parts.indexOf(ROOT_PATH);
  const start = rootIndex >= 0 ? rootIndex + 1 : 0;
  const folders = parts.slice(start, -1);
  return folders.length ? folders.join(" / ") : "Home";
}

async function navigateTo(path, opts = { push: true }) {
  if (opts.push && state.cwdPath) {
    state.history.push(state.cwdPath);
    state.forward = [];
  }

  state.cwdPath = path;
  state.selected = null;
  state.query = "";
  ui.search.value = "";
  closePreview();

  await fetchContents(path);

  renderBreadcrumbs();
  await renderTree();
  renderList();
  renderPreview(null);
  updateStatus();

  if (isMobile()) setFoldersOpen(false);
}

function renderBreadcrumbs() {
  const parts = splitPath(state.cwdPath);
  const rootParts = splitPath(ROOT_PATH);
  const relativeParts = parts.slice(rootParts.length);

  let html = `<a href="#" data-path="${escapeHtml(ROOT_PATH)}">Home</a>`;
  let current = ROOT_PATH;

  for (const part of relativeParts) {
    current += `/${part}`;
    html += ` <span aria-hidden="true">›</span> <a href="#" data-path="${escapeHtml(current)}">${escapeHtml(part)}</a>`;
  }

  ui.crumbs.innerHTML = html;
  ui.crumbs.scrollLeft = ui.crumbs.scrollWidth;

  ui.crumbs.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const path = a.getAttribute("data-path");
      await navigateTo(path);
      updateNavButtons();
    });
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
  row.tabIndex = 0;
  row.setAttribute("role", "button");

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

  if (shouldAutoExpand) await expand();

  const activate = async (e) => {
    const clickedTwisty = e.target === twisty;

    if (clickedTwisty) {
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
      await navigateTo(folder.path);
      updateNavButtons();
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
  if (state.query) {
    if (state.fullIndex) renderSearchResults(state.query);
    return;
  }

  ui.listTitle.textContent = "Details";

  const items = state.cache.get(state.cwdPath) || [];
  const folders = items.filter((x) => x.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((x) => x.type === "file").sort((a, b) => extractSeason(b.name) - extractSeason(a.name));

  ui.list.innerHTML = "";

  if (folders.length === 0 && files.length === 0) {
    ui.list.innerHTML = `<div class="row"><div class="muted">This folder is empty.</div><div></div><div></div></div>`;
    return;
  }

  for (const folder of folders) ui.list.appendChild(makeRow(folder, true));
  for (const file of files) ui.list.appendChild(makeRow(file, false));
}

function renderSearchResults(query = state.query) {
  const matches = state.fullIndex
    .filter((x) => searchableText(x).includes(query))
    .sort((a, b) => compareSearchResults(a, b, query));

  ui.listTitle.textContent = `Search Results (${matches.length})`;
  ui.list.innerHTML = "";

  if (matches.length === 0) {
    ui.list.innerHTML = `<div class="row"><div>No kits found matching “${escapeHtml(query)}”.</div><div></div><div></div></div>`;
    return;
  }

  for (const file of matches) ui.list.appendChild(makeSearchRow(file));
}

function searchableText(item) {
  return `${stripExt(item.name)} ${folderLabelFor(item)}`.toLowerCase();
}

function compareSearchResults(a, b, query) {
  const aName = stripExt(a.name).toLowerCase();
  const bName = stripExt(b.name).toLowerCase();
  const aStarts = aName.startsWith(query) ? 1 : 0;
  const bStarts = bName.startsWith(query) ? 1 : 0;

  if (aStarts !== bStarts) return bStarts - aStarts;

  const seasonDiff = extractSeason(b.name) - extractSeason(a.name);
  if (seasonDiff) return seasonDiff;

  return aName.localeCompare(bName);
}

function makeSearchRow(item) {
  const row = createInteractiveRow();
  const cleanName = stripExt(item.name);
  const folderLabel = folderLabelFor(item);

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon" aria-hidden="true">🖼️</div>
      <div class="text">
        ${escapeHtml(cleanName)}
        <div class="searchPath">${escapeHtml(folderLabel)}</div>
      </div>
    </div>
    <div>PNG File</div>
    <div>${prettyBytes(item.size)}</div>
  `;

  addRowActivation(row, () => selectFile(item, row));
  return row;
}

function makeRow(item, isFolder) {
  const row = createInteractiveRow();
  const cleanName = stripExt(item.name);

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon" aria-hidden="true">${isFolder ? "📁" : "🖼️"}</div>
      <div class="text">${escapeHtml(cleanName)}</div>
    </div>
    <div>${isFolder ? "Folder" : "PNG File"}</div>
    <div>${isFolder ? "" : prettyBytes(item.size)}</div>
  `;

  addRowActivation(row, async () => {
    if (isFolder) {
      await navigateTo(item.path);
      updateNavButtons();
    } else {
      selectFile(item, row);
    }
  });

  return row;
}

function createInteractiveRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.tabIndex = 0;
  row.setAttribute("role", "listitem");
  return row;
}

function addRowActivation(row, callback) {
  row.addEventListener("click", callback);
  row.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await callback();
    }
  });
}

function selectFile(item, row) {
  state.selected = item;
  ui.list.querySelectorAll(".row.selected").forEach((el) => el.classList.remove("selected"));
  row?.classList.add("selected");
  renderPreview(item);
  updateStatus();
  openPreview();
}

function renderPreview(file) {
  if (!file) {
    ui.preview.innerHTML = `<div class="muted">Select a kit to preview.</div>`;
    return;
  }

  const name = stripExt(file.name);
  ui.preview.innerHTML = `
    <img src="${file.download_url}" alt="${escapeHtml(name)} kit" decoding="async" />
    <div class="previewName">${escapeHtml(name)}</div>
    <div class="previewActions">
      <a href="${file.download_url}" target="_blank" rel="noreferrer">Open full image</a>
    </div>
  `;
}

function updateStatus() {
  if (state.query && state.fullIndex) {
    const matches = state.fullIndex.filter((x) => searchableText(x).includes(state.query));
    ui.statusLeft.textContent = `${matches.length} result(s) across all folders`;
    ui.statusRight.textContent = state.selected ? stripExt(state.selected.name) : "";
    return;
  }

  const items = state.cache.get(state.cwdPath) || [];
  const folderCount = items.filter((x) => x.type === "dir").length;
  const fileCount = items.filter((x) => x.type === "file").length;
  ui.statusLeft.textContent = `${folderCount} folder(s), ${fileCount} file(s)`;
  ui.statusRight.textContent = state.selected ? stripExt(state.selected.name) : "";
}

function stripExt(name) {
  return String(name).replace(/\.[^/.]+$/, "");
}

function extractSeason(name) {
  const match = name.match(/(19|20)\d{2}/);
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
