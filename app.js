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
  // Sort newest -> oldest using the most recent year signal in the filename.
  // Supports ranges like 2025-26, 2025-2026, and 2025/26.
  const text = String(filename);

  let bestScore = -1;

  const rangeRegex = /((?:19|20)\d{2})\s*[-/]\s*((?:19|20)?\d{2})/g;
  let rangeMatch;
  while ((rangeMatch = rangeRegex.exec(text)) !== null) {
    const startYear = parseInt(rangeMatch[1], 10);
    let endYear = parseInt(rangeMatch[2], 10);

    if (endYear < 100) {
      const century = Math.floor(startYear / 100) * 100;
      endYear = century + endYear;
      if (endYear < startYear) endYear += 100;
    }

    // Prioritize latest end-year, then start-year.
    const score = endYear * 10000 + startYear;
    if (score > bestScore) bestScore = score;
  }

  const yearRegex = /(?:19|20)\d{2}/g;
  let yearMatch;
  while ((yearMatch = yearRegex.exec(text)) !== null) {
    const year = parseInt(yearMatch[0], 10);
    const score = year * 10000;
    if (score > bestScore) bestScore = score;
  }

  return bestScore;
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
