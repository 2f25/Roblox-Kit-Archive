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
    ui
