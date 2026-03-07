 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/app.js b/app.js
index 37a64d0679ba4ee0883743efa2ac37f2873046cc..88d42ead8f868049406d811baa2eef25d911b3df 100644
--- a/app.js
+++ b/app.js
@@ -338,52 +338,75 @@ function updateStatus() {
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
-  // Looks for "2025-26" pattern. If none, returns -1 so those sort last.
-  const m = filename.match(/((19|20)\d{2})\s*-\s*(\d{2})/);
-  if (!m) return -1;
-  const startYear = parseInt(m[1], 10);
-  const endYY = parseInt(m[3], 10);
-  return startYear * 100 + endYY;
+  // Sort newest -> oldest.
+  // 1) Prefer explicit season ranges like "2025-26" or "2025-2026".
+  // 2) Fallback to the newest standalone 4-digit year in the filename.
+  // 3) No year => sort last.
+  const range = String(filename).match(/((?:19|20)\d{2})\s*-\s*((?:19|20)?\d{2})/);
+  if (range) {
+    const startYear = parseInt(range[1], 10);
+    let endYear = parseInt(range[2], 10);
+
+    // Convert short end year (e.g. 26 in 2025-26) to a full year.
+    if (endYear < 100) {
+      const century = Math.floor(startYear / 100) * 100;
+      endYear = century + endYear;
+      if (endYear < startYear) endYear += 100;
+    }
+
+    return startYear * 10000 + endYear;
+  }
+
+  const yearRegex = /(?:19|20)\d{2}/g;
+  let bestYear = -1;
+  let m;
+  while ((m = yearRegex.exec(String(filename))) !== null) {
+    const y = parseInt(m[0], 10);
+    if (y > bestYear) bestYear = y;
+  }
+
+  if (bestYear === -1) return -1;
+  return bestYear * 10000;
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
 
EOF
)
