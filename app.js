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

init();

async function init() {
  wireUI();
  await navigateTo("", { push: false });
}

function wireUI() {
  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.toLowerCase();
    renderList();
  });

  ui.btnUp.addEventListener("click", async () => {
    const parts = state.cwdPath.split("/").filter(Boolean);
    parts.pop();
    await navigateTo(parts.join("/"));
  });
}

function ghApi(path) {
  return `https://api.github.com/repos/${state.owner}/${state.repo}/contents/${path}?ref=${state.branch}`;
}

async function fetchContents(path) {
  if (state.cache.has(path)) return state.cache.get(path);
  const res = await fetch(ghApi(path));
  const data = await res.json();
  state.cache.set(path, data);
  return data;
}

async function navigateTo(path) {
  state.cwdPath = path;
  await fetchContents(path);
  renderBreadcrumbs();
  renderList();
  renderPreview(null);
}

function renderBreadcrumbs() {
  const parts = state.cwdPath.split("/").filter(Boolean);
  let html = `<a href="#" onclick="navigateTo('')">Home</a>`;
  let current = "";
  for (let p of parts) {
    current += (current ? "/" : "") + p;
    html += ` › <a href="#" onclick="navigateTo('${current}')">${p}</a>`;
  }
  ui.crumbs.innerHTML = html;
}

function renderList() {
  const items = state.cache.get(state.cwdPath) || [];
  const folders = items.filter(x => x.type === "dir");
  const files = items.filter(x => x.type === "file");

  folders.sort((a,b)=>a.name.localeCompare(b.name));
  files.sort((a,b)=>extractSeason(b.name)-extractSeason(a.name));

  ui.list.innerHTML = "";

  for (let f of folders) {
    ui.list.appendChild(makeRow(f,true));
  }
  for (let f of files) {
    ui.list.appendChild(makeRow(f,false));
  }
}

function makeRow(item,isFolder){
  const row=document.createElement("div");
  row.className="row";

  const cleanName=stripExt(item.name);

  row.innerHTML=`
    <div class="nameCell">
      <div>${isFolder?"📁":"🖼️"}</div>
      <div class="text">${cleanName}</div>
    </div>
    <div></div>
    <div>${isFolder?"Folder":"PNG File"}</div>
    <div>${isFolder?"":prettyBytes(item.size)}</div>
  `;

  row.onclick=async()=>{
    if(isFolder){
      await navigateTo(item.path);
    }else{
      renderPreview(item);
    }
  };

  return row;
}

function renderPreview(file){
  if(!file){
    ui.preview.innerHTML=`<div class="muted">Select a kit to preview.</div>`;
    return;
  }

  ui.preview.innerHTML=`
    <img src="${file.download_url}" style="width:100%;border-radius:10px;" />
    <div style="margin-top:12px;font-weight:bold;">
      ${stripExt(file.name)}
    </div>
  `;
}

function stripExt(name){
  return name.replace(/\.[^/.]+$/,"");
}

function extractSeason(name){
  const match=name.match(/(19|20)\d{2}/);
  return match?parseInt(match[0]):0;
}

function prettyBytes(bytes){
  if(!bytes)return "";
  const units=["B","KB","MB"];
  let i=0;
  while(bytes>=1024&&i<units.length-1){
    bytes/=1024;i++;
  }
  return Math.round(bytes)+" "+units[i];
}
