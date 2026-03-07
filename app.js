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
};

init().catch((err) => {
  console.error(err);
  ui.list.innerHTML = `<div class="row"><div>Error: ${err.message}</div><div></div><div></div></div>`;
});

async function init() {
  wireUI();
  await navigateTo(ROOT_PATH, { push: false });
  updateNavButtons();
}

function wireUI() {
  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.trim().toLowerCase();
    renderList();
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
}

function updateNavButtons() {
  ui.btnBack.disabled = state.history.length === 0;
  ui.btnForward.disabled = state.forward.length === 0;
  ui.btnUp.disabled = state.cwdPath === ROOT_PATH;
}

function ghApi(path) {
  return `https://api.github.com/repos/${state.owner}/${state.repo}/contents/${encodeURIComponentPath(path)}?ref=${state.branch}`;
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchContents(path) {
  if (state.cache.has(path)) return state.cache.get(path);

  const res = await fetch(ghApi(path));
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const arr = Array.isArray(data) ? data : [];
  state.cache.set(path, arr);
  return arr;
}

async function navigateTo(path, opts = { push: true }) {
  if (opts.push && state.cwdPath) {
    state.history.push(state.cwdPath);
    state.forward = [];
  }

  state.cwdPath = path;
  state.selected = null;

  await fetchContents(path);

  renderBreadcrumbs();
  await renderTree();
  renderList();
  renderPreview(null);
  updateStatus();
}

function renderBreadcrumbs() {
  const parts = splitPath(state.cwdPath);
  let html = `<a href="#" data-path="${ROOT_PATH}">Home</a>`;

  let current = "";
  for (const p of parts) {
    current += (current ? "/" : "") + p;
    html += ` › <a href="#" data-path="${escapeHtml(current)}">${escapeHtml(p)}</a>`;
  }

  ui.crumbs.innerHTML = html;

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

  const twisty = document.createElement("div");
  twisty.className = "twisty";
  twisty.textContent = "▸";

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = "📁";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = folder.name;

  row.appendChild(twisty);
  row.appendChild(icon);
  row.appendChild(label);

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "children";
  childrenWrap.style.display = "none";

  wrap.appendChild(row);
  wrap.appendChild(childrenWrap);

  let expanded = false;
  let loaded = false;

  const shouldAutoExpand =
    state.cwdPath === folder.path || state.cwdPath.startsWith(folder.path + "/");

  if (shouldAutoExpand) {
    await expand();
  }

  row.addEventListener("click", async (e) => {
    const clickedTwisty = e.target === twisty;

    if (clickedTwisty) {
      if (expanded) {
        collapse();
      } else {
        await expand();
      }
      return;
    }

    await navigateTo(folder.path);
    updateNavButtons();
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
  const items = state.cache.get(state.cwdPath) || [];
  const query = state.query;

  let folders = items.filter((x) => x.type === "dir");
  let files = items.filter((x) => x.type === "file");

  if (query) {
    folders = folders.filter((x) => stripExt(x.name).toLowerCase().includes(query));
    files = files.filter((x) => stripExt(x.name).toLowerCase().includes(query));
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => extractSeason(b.name) - extractSeason(a.name));

  ui.list.innerHTML = "";

  for (const folder of folders) {
    ui.list.appendChild(makeRow(folder, true));
  }

  for (const file of files) {
    ui.list.appendChild(makeRow(file, false));
  }
}

function makeRow(item, isFolder) {
  const row = document.createElement("div");
  row.className = "row";

  const cleanName = stripExt(item.name);

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon">${isFolder ? "📁" : "🖼️"}</div>
      <div class="text">${escapeHtml(cleanName)}</div>
    </div>
    <div>${isFolder ? "Folder" : "PNG File"}</div>
    <div>${isFolder ? "" : prettyBytes(item.size)}</div>
  `;

  row.addEventListener("click", async () => {
    if (isFolder) {
      await navigateTo(item.path);
      updateNavButtons();
    } else {
      state.selected = item;
      renderPreview(item);
      updateStatus();
    }
  });

  return row;
}

function renderPreview(file) {
  if (!file) {
    ui.preview.innerHTML = `<div class="muted">Select a kit to preview.</div>`;
    return;
  }

  ui.preview.innerHTML = `
    <img src="${file.download_url}" style="width:100%;border-radius:10px;" />
    <div style="margin-top:12px;font-weight:bold;">
      ${escapeHtml(stripExt(file.name))}
    </div>
    <div style="margin-top:8px;">
      <a href="${file.download_url}" target="_blank" rel="noreferrer">Open image</a>
    </div>
  `;
}

function updateStatus() {
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
