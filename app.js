diff --git a/app.js b/app.js
index 37a64d0679ba4ee0883743efa2ac37f2873046cc..321993ffac2b8074037c20cd063c3e54923a75d9 100644
--- a/app.js
+++ b/app.js
@@ -338,52 +338,58 @@ function updateStatus() {
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
+  // Prefer "2025-26" seasons, but also support single-year names like "Brazil 2022 Home".
+  // If no year is found, return -1 so unknown files sort last.
   const m = filename.match(/((19|20)\d{2})\s*-\s*(\d{2})/);
+  if (m) {
+    const startYear = parseInt(m[1], 10);
+    const endYY = parseInt(m[3], 10);
+    return startYear * 100 + endYY;
+  }
+
+  const years = [...filename.matchAll(/(19|20)\d{2}/g)].map((x) => parseInt(x[0], 10));
+  if (years.length === 0) return -1;
+  return Math.max(...years) * 100;
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
