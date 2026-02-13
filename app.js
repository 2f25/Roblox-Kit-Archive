// Explorer-style browser that reads your PUBLIC GitHub repo live (no JSON).
// Folders: A->Z
// Kits: Newest -> Oldest (by season in filename like 2025-26)

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

const state = {
  owner: null,
  repo: null,
  branch: "main",
  cwdPath: "",          // e.g. "International/Europe/England"
  history: [],
  forward: [],
  selected: null,
  cache: new Map(),     // path -> contents array
  query: "",
};

init();

function inferRepoFromPagesUrl() {
  // GitHub Pages typical:
  // https://USERNAME.github.io/REPO/
  const host = window.location.hostname;
  const path = window.location.pathname.replace(/^\/|\/$/g, ""); // trim slashes
  if (host.endsWith("github.io")) {
    const owner = host.split(".github.io")[0];
    const repo = path.split("/")[0] || null;
    return { owner, repo };
  }
  return { owner: null, repo: null }; // custom domain: set manually below
}

async function init() {
  // If you use a custom domain later, hardcode here:
  // state.owner = "2f25";
  // state.repo = "Roblox-Kit-Archive";

  const inferred = inferRepoFromPagesUrl();
  state.owner = state.owner || inferred.owner;
  state.repo = state.repo || inferred.repo;

  if (!state.owner || !state.repo) {
    ui.list.innerHTML = `<div class="row"><div>Couldn’t infer owner/repo. Open app.js and set state.owner/state.repo.</div></div>`;
    return;
  }

  wireUI();

  // Start at root
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
    if (!prev) return;
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
    const parts = state.cwdPath ? state.cwdPath.split("/") : [];
    parts.pop();
    await navigateTo(parts.join("/"));
  });
}

function updateNavButtons() {
  ui.btnBack.disabled = state.history.length === 0;
  ui.btnForward.disabled = state.forward.length === 0;
}

function ghApi(path) {
  // GitHub Contents API
  // https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref=main
  const base = `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents`;
  const full = path ? `${base}/${path}` : base;
  return `${full}?ref=${encodeURIComponent(state.branch)}`;
}

async function fetchContents(path) {
  if (state.cache.has(path)) return state.cache.get(path);

  const res = await fetch(ghApi(path));
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();

  // For folders, GitHub returns an array. For file, returns an object.
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
  ui.search.value = "";
  state.query = "";

  // Ensure contents cached
  await fetchContents(path);

  await renderAll();
  updateNavButtons();
}

async function renderAll() {
  await renderTree();       // builds from top-level only, expands current path
  renderBreadcrumbs();
  renderList();
  renderPreview(null);
  updateStatus();
}

function splitPath(path) {
  return path ? path.split("/").filter(Boolean) : [];
}

function joinPath(parts) {
  return parts.filter(Boolean).join("/");
}

function renderBreadcrumbs() {
  const parts = splitPath(state.cwdPath);

  const frag = [];
  frag.push(`<a href="#" data-crumb="">This PC</a>`);

  let accum = [];
  for (const p of parts) {
    accum.push(p);
    const full = joinPath(accum);
    frag.push(`<span class="sep">›</span>`);
    frag.push(`<a href="#" data-crumb="${escapeHtml(full)}">${escapeHtml(p)}</a>`);
  }

  if (parts.length === 0) {
    frag[0] = `<span class="current">This PC</span>`;
  }

  ui.crumbs.innerHTML = frag.join("");

  ui.crumbs.querySelectorAll("[data-crumb]").forEach(a => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const target = a.getAttribute("data-crumb");
      await navigateTo(target);
    });
  });
}

async function renderTree() {
  ui.tree.innerHTML = "";
  const root = await fetchContents("");

  // Only folders at root
  const folders = root.filter(x => x.type === "dir").sort((a,b) => a.name.localeCompare(b.name));
  for (const f of folders) {
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

  const shouldAutoExpand = isPathPrefix(path, state.cwdPath);

  if (shouldAutoExpand) {
    await expand();
  } else {
    twisty.textContent = "▸";
  }

  async function expand() {
    expanded = true;
    childrenWrap.style.display = "block";
    twisty.textContent = "▾";

    if (!loaded) {
      loaded = true;
      const kids = await fetchContents(path);
      const kidFolders = kids.filter(x => x.type === "dir").sort((a,b) => a.name.localeCompare(b.name));
      for (const k of kidFolders) {
        childrenWrap.appendChild(await makeTreeNode(k.name, k.path));
      }
    }
  }

  function collapse() {
    expanded = false;
    childrenWrap.style.display = "none";
    twisty.textContent = "▸";
  }

  row.addEventListener("click", async (e) => {
    const clickedTwisty = e.target === twisty;
    if (clickedTwisty) {
      if (expanded) collapse(); else await expand();
      return;
    }
    await navigateTo(path);
  });

  container.appendChild(row);
  container.appendChild(childrenWrap);
  return container;
}

function isPathPrefix(prefix, full) {
  if (!prefix) return true;
  if (!full) return false;
  return full === prefix || full.startsWith(prefix + "/");
}

function renderList() {
  const items = state.cache.get(state.cwdPath) || [];

  const folders = items.filter(x => x.type === "dir");
  const files = items.filter(x => x.type === "file");

  // Filter by search
  const q = state.query;
  const fFolders = q ? folders.filter(x => x.name.toLowerCase().includes(q)) : folders;
  const fFiles = q ? files.filter(x => x.name.toLowerCase().includes(q)) : files;

  // Sort folders A->Z always
  fFolders.sort((a,b) => a.name.localeCompare(b.name));

  // Sort files (kits) newest -> oldest based on season in filename; fallback A->Z
  fFiles.sort((a,b) => {
    const sa = extractSeasonScore(a.name);
    const sb = extractSeasonScore(b.name);
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });

  ui.listTitle.textContent = state.cwdPath ? state.cwdPath.split("/").slice(-1)[0] : "Details";

  ui.list.innerHTML = "";
  for (const d of fFolders) ui.list.appendChild(renderRow(d, "folder"));
  for (const f of fFiles) ui.list.appendChild(renderRow(f, "file"));

  if (fFolders.length === 0 && fFiles.length === 0) {
    ui.list.innerHTML = `<div class="row"><div class="muted">No items found.</div></div>`;
  }
}

function renderRow(item, kind) {
  const row = document.createElement("div");
  row.className = "row" + (state.selected?.path === item.path ? " selected" : "");

  const icon = kind === "folder" ? "📁" : iconForExt(item.name);
  const season = kind === "file" ? extractSeasonLabel(item.name) : "";
  const type = kind === "folder" ? "File folder" : (ext(item.name).toUpperCase() + " File");
  const size = kind === "file" ? prettyBytes(item.size || 0) : "";

  row.innerHTML = `
    <div class="nameCell">
      <div class="fileIcon">${icon}</div>
      <div class="text">${escapeHtml(stripExt(item.name))}</div>
    </div>
    <div>${escapeHtml(season)}</div>
    <div>${escapeHtml(type)}</div>
    <div>${escapeHtml(size)}</div>
  `;

  row.addEventListener("click", async () => {
    // Folder: open
    if (kind === "folder") {
      await navigateTo(item.path);
      return;
    }

    // File: select + preview
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

  const season = extractSeasonLabel(file.name);
  ui.preview.innerHTML = `
    <img src="${file.download_url}" alt="${escapeHtml(file.name)}" loading="lazy" />
    <div class="meta">
      <div><b>Name:</b> ${escapeHtml(file.name)}</div>
      <div><b>Season:</b> ${escapeHtml(season || "—")}</div>
      <div><b>Path:</b> ${escapeHtml(file.path)}</div>
      <div><b>Size:</b> ${escapeHtml(prettyBytes(file.size || 0))}</div>
      <div style="margin-top:8px;">
        <a href="${file.download_url}" target="_blank" rel="noreferrer">Open image</a>
      </div>
    </div>
  `;
}

function updateStatus() {
  const items = state.cache.get(state.cwdPath) || [];
  const folders = items.filter(x => x.type === "dir").length;
  const files = items.filter(x => x.type === "file").length;
  ui.statusLeft.textContent = `${folders} folder(s), ${files} file(s)`;
  ui.statusRight.textContent = state.selected ? state.selected.name : "";
}

function ext(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
function iconForExt(name) {
  const e = ext(name);
  if (["png","jpg","jpeg","webp","gif"].includes(e)) return "🖼️";
  return "📄";
}

function extractSeasonLabel(filename) {
  // Finds patterns like 2025-26 or 2024-25 anywhere in the name
  const m = filename.match(/(19|20)\d{2}\s*-\s*\d{2}/);
  return m ? m[0].replace(/\s*/g,"") : "";
}

function extractSeasonScore(filename) {
  // Convert "2025-26" to numeric score for sorting.
  // Higher = newer. If no season, return -1.
  const label = extractSeasonLabel(filename);
  if (!label) return -1;
  const m = label.match(/((19|20)\d{2})-(\d{2})/);
  if (!m) return -1;
  const startYear = parseInt(m[1], 10);
  const endYY = parseInt(m[3], 10);
  // Use startYear as primary; endYY as tie-break
  return startYear * 100 + endYY;
}

function prettyBytes(bytes) {
  if (!bytes) return "";
  const units = ["B","KB","MB","GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 0)} ${units[i]}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function stripExt(name) {
  return name.replace(/\.[^/.]+$/, "");
}
