// Explorer-style browser for a PUBLIC GitHub repo.
// - Left folder tree (A->Z)
// - Main list: folders A->Z, files newest->oldest (by season like 2025-26 in name)
// - Display names: NO ".png" (or any extension) anywhere
// - Preview: NO Season, NO Path (clean)

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

// Hardcode your repo (safe + avoids inference issues)
const state = {
  owner: "2f25",
  repo: "Roblox-Kit-Archive",
  branch: "main",

  cwdPath: "",
  history: [],
  forward: [],
  selected: null,

  cache: new Map(), // path -> array of items from GitHub Contents API
  query: "",
};

init().catch((e) => {
  console.error(e);
  ui.list.innerHTML = `<div class="row"><div class="muted">Error: ${escapeHtml(String(e.message || e))}</div></div>`;
});

async function init() {
  wireUI();
  await navigateTo("", { push: false });
}

function wireUI() {
  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.trim().toLowerCase();
    renderList();
    updateStatus();
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
    const parts = splitPath(state.cwdPath);
    parts.pop();
    await navigateTo(joinPath(parts));
  });
}

function updateNavButtons() {
  ui.btnBack.disabled = state.history.length === 0;
  ui.btnForward.disabled = state.forward.length === 0;
}

function ghApi(path) {
  const base = `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents`;
  const full = path ? `${base}/${path}` : base;
  return `${full}?ref=${encodeURIComponent(state.branch)}`;
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

async function navigateTo(path, opts = { push: true }) {
  if (opts.push) {
    state.history.push(state.cwdPath);
    state.forward = [];
  }

  state.cwdPath = path;
  state.selected = null;
  state.query = "";
  ui.search.value = "";

  await fetchContents(path);

  await renderAll();
  updateNavButtons();
}

async function renderAll() {
  await renderTree();
  renderBreadcrumbs();
  renderList();
  renderPreview(null);
  updateStatus();
}

function renderBreadcrumbs() {
  const parts = splitPath(state.cwdPath);
  const frag = [];

  frag.push(`<a href="#" data-crumb="">Home</a>`);

  let accum = [];
  for (const p of parts) {
    accum.push(p);
    const full = joinPath(accum);
    frag.push(`<span class="sep">›</span>`);
    frag.push(`<a href="#" data-crumb="${escapeHtml(full)}">${escapeHtml(p)}</a>`);
  }

  ui.crumbs.innerHTML = frag.join("");

  ui.crumbs.querySelectorAll("[data-crumb]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const target = a.getAttribute("data-crumb");
      await navigateTo(target);
    });
  });
}

async function renderTree() {
  ui.tree.innerHTML = "";

  const rootItems = await fetchContents("");
  const rootFolders = rootItems
    .filter((x) => x.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const f of rootFolders) {
    ui.tree.appendChild(await makeTreeNode(f.name, f.path));
  }
}

async function makeTreeNode(label, path) {
  const container = document.createElement("div");

  const row = document.createElement("div");
  row.className = "node" + (path === state.cwdPath ? " active" : "");

  const twisty = document.createElement("div");
  twisty.className = "twisty";
  twisty.textContent = "▸";

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = "📁";

  const text = document.createElement("div");
  text.className = "label";
  text.textContent = label;

  row.appendChild(twisty);
  row.appendChild(icon);
  row.appendChild(text);

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "children";
  childrenWrap.style.display = "none";

  let expanded = false;
  let loaded = false;

  // Auto-expand nodes along current path
  const shouldAutoExpand = isPathPrefix(path, state.cwdPath);
  if (shouldAutoExpand) await expand();

  row.addEventListener("click", async (e) => {
    const clickedTwisty = e.target === twisty;
    if (clickedTwisty) {
      if (expanded) collapse();
      else await expand();
      return;
    }
    await navigateTo(path);
  });

  container.appendChild(row);
  container.appendChild(childrenWrap);
  return container;

  async function expand() {
    expanded = true;
    childrenWrap.style.display = "block";
    twisty.textContent = "▾";

    if (loaded) return;
    loaded = true;

    const kids = await fetchContents(path);
    const kidFolders = kids
      .filter((x) => x.type === "dir")
      .sort((a, b) => a.name.localeCompare(b.name));

    // If no children, hide twisty
    if (kidFolders.length === 0) {
      twisty.textContent = "";
      return;
    }

    for (const k of kidFolders) {
      childrenWrap.appendChild(await makeTreeNode(k.name, k.path));
    }
  }

  function collapse() {
    expanded = false;
    childrenWrap.style.display = "none";
    twisty.textContent = "▸";
  }
}

function renderList() {
  const items = state.cache.get(state.cwdPath) || [];
  const q = state.query;

  let folders = items.filter((x) => x.type === "dir");
  let files = items.filter((x) => x.type === "file");

  if (q) {
    folders = folders.filter((x) => stripExt(x.name).toLowerCase().includes(q));
    files = files.filter((x) => stripExt(x.name).toLowerCase().includes(q));
  }

  // Folders A-Z
  folders.sort((a, b) => a.name.localeCompare(b.name));

  // Files newest -> oldest by season; fallback A-Z
  files.sort((a, b) => {
    const sa = extractSeasonScore(a.name);
    const sb = extractSeasonScore(b.name);
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });

  ui.listTitle.textContent = state.cwdPath ? splitPath(state.cwdPath).slice(-1)[0] : "Details";

  ui.list.innerHTML = "";
  for (const d of folders) ui.list.appendChild(renderRow(d, "folder"));
  for (const f of files) ui.list.appendChild(renderRow(f, "file"));

  if (folders.length === 0 && files.length === 0) {
    ui.list.innerHTML = `<div class="row"><div class="muted">No items found.</div></div>`;
  }
}

function renderRow(item, kind) {
  const row = document.createElement("div");
  row.className = "row" + (state.selected?.path === item.path ? " selected" : "");

  const icon = kind === "folder" ? "📁" : iconForExt(item.name);
  const type = kind === "folder" ? "File folder" : (ext(item.name).toUpperCase() + " File");
  const size = kind === "file" ? prettyBytes(item.size || 0) : "";

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon">${icon}</div>
      <div class="text">${escapeHtml(stripExt(item.name))}</div>
    </div>
    row.innerHTML = `   <div class="nameCell">     <div class="fileIcon">${icon}</div>     <div class="text">${escapeHtml(stripExt(item.name))}</div>   </div>   <div>${escapeHtml(type)}</div>   <div>${escapeHtml(size)}</div> `;
    <div>${escapeHtml(type)}</div>
    <div>${escapeHtml(size)}</div>
  `;

  row.addEventListener("click", async () => {
    if (kind === "folder") {
      await navigateTo(item.path);
      return;
    }
    state.selected = item;
    renderList();
    renderPreview(item);
    updateStatus();
  });

  return row;
}

function renderPreview(file) {
  if (!file) {
    ui.preview.innerHTML = `<div class="muted">Select a kit to preview.</div>`;
    return;
  }

  // Clean preview: image + name (no .png), no season, no path
  ui.preview.innerHTML = `
    <img src="${file.download_url}" alt="${escapeHtml(stripExt(file.name))}" loading="lazy" />
    <div class="meta">
      <div><b>${escapeHtml(stripExt(file.name))}</b></div>
      <div style="margin-top:8px;">
        <a href="${file.download_url}" target="_blank" rel="noreferrer">Open image</a>
      </div>
    </div>
  `;
}

function updateStatus() {
  const items = state.cache.get(state.cwdPath) || [];
  const folders = items.filter((x) => x.type === "dir").length;
  const files = items.filter((x) => x.type === "file").length;
  ui.statusLeft.textContent = `${folders} folder(s), ${files} file(s)`;
  ui.statusRight.textContent = state.selected ? stripExt(state.selected.name) : "";
}

// Helpers
function splitPath(path) {
  return path ? path.split("/").filter(Boolean) : [];
}
function joinPath(parts) {
  return parts.filter(Boolean).join("/");
}
function isPathPrefix(prefix, full) {
  if (!prefix) return true;
  if (!full) return false;
  return full === prefix || full.startsWith(prefix + "/");
}
function stripExt(name) {
  return String(name).replace(/\.[^/.]+$/, "");
}
function ext(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
function iconForExt(name) {
  const e = ext(name);
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(e)) return "🖼️";
  return "📄";
}
function extractSeasonScore(filename) {
  // Looks for "2025-26" pattern. If none, returns -1 so those sort last.
  const m = filename.match(/((19|20)\d{2})\s*-\s*(\d{2})/);
  if (!m) return -1;
  const startYear = parseInt(m[1], 10);
  const endYY = parseInt(m[3], 10);
  return startYear * 100 + endYY;
}
function prettyBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Math.round(v)} ${units[i]}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
