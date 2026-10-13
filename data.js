/* data.js: storage, photo shrinking, backup and restore */
(function () {
  "use strict";

  var CT = window.CT = window.CT || {};
  var DB_NAME = "churchTracker";
  var STORE = "churches";
  var BACKUP_KEY = "churchTrackerLastBackup";
  var db = null;

  CT.VERSION = "Version: Stage 5 (backup and restore)";
  CT.notify = function () {};

  /* ---------- Database (IndexedDB) ---------- */

  CT.openDb = function (cb) {
    if (!window.indexedDB) {
      CT.notify("This browser cannot save data.");
      return;
    }
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = function (e) { db = e.target.result; cb(); };
    req.onerror = function () { CT.notify("Could not open storage."); };
  };

  CT.loadAll = function (cb) {
    var tx = db.transaction(STORE, "readonly");
    var rq = tx.objectStore(STORE).getAll();
    rq.onsuccess = function () { cb(rq.result || []); };
    rq.onerror = function () { CT.notify("Could not read saved churches."); };
  };

  CT.saveMany = function (items, cb) {
    var tx = db.transaction(STORE, "readwrite");
    var store = tx.objectStore(STORE);
    for (var i = 0; i < items.length; i++) { store.put(items[i]); }
    tx.oncomplete = function () { if (cb) { cb(); } };
    tx.onabort = function () { CT.notify("Could not save. Storage may be full."); };
  };

  CT.deleteMany = function (ids, cb) {
    var tx = db.transaction(STORE, "readwrite");
    var store = tx.objectStore(STORE);
    for (var i = 0; i < ids.length; i++) { store.delete(ids[i]); }
    tx.oncomplete = function () { if (cb) { cb(); } };
    tx.onabort = function () { CT.notify("Could not delete."); };
  };

  CT.newId = function () {
    return "c" + Date.now() + "-" + Math.floor(Math.random() * 100000);
  };

  /* ---------- Photos ---------- */

  function drawScaled(img, maxSide, quality) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function drawSquare(img, size, quality) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var side = Math.min(w, h);
    var sx = (w - side) / 2;
    var sy = (h - side) / 2;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", quality);
  }

  CT.readPhoto = function (file, ok, fail) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var result = null;
      try {
        result = { full: drawScaled(img, 1000, 0.8), thumb: drawSquare(img, 120, 0.8) };
      } catch (err) {
        result = null;
      }
      URL.revokeObjectURL(url);
      if (result) { ok(result); } else { fail("One photo was too large to process."); }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      fail("Could not read one of the photos.");
    };
    img.src = url;
  };

  /* ---------- Backup ---------- */

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  CT.lastBackup = function () {
    try { return localStorage.getItem(BACKUP_KEY) || ""; } catch (e) { return ""; }
  };

  CT.markBackup = function () {
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) { }
  };

  CT.daysSinceBackup = function () {
    var s = CT.lastBackup();
    if (!s) { return null; }
    var t = Date.parse(s);
    if (isNaN(t)) { return null; }
    return Math.floor((Date.now() - t) / 86400000);
  };

  CT.buildBackup = function (churches) {
    return JSON.stringify({
      app: "church-tracker",
      format: 1,
      exported: new Date().toISOString(),
      count: churches.length,
      churches: churches
    });
  };

  /* Must be called straight from a button tap so the iPhone share sheet is allowed. */
  CT.exportBackup = function (churches, done) {
    var d = new Date();
    var name = "churches-backup-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".json";
    var blob = new Blob([CT.buildBackup(churches)], { type: "application/json" });
    var file = null;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) { file = null; }

    var canShare = false;
    try { canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e2) { canShare = false; }

    if (canShare) {
      navigator.share({ files: [file], title: "Church tracker backup" }).then(function () {
        CT.markBackup();
        done("saved");
      }).catch(function (err) {
        if (err && err.name === "AbortError") { done("cancelled"); } else { done("failed"); }
      });
      return;
    }

    try {
      downloadBlob(blob, name);
      CT.markBackup();
      done("saved");
    } catch (e3) {
      done("failed");
    }
  };

  /* ---------- Restore ---------- */

  function validChurch(c) {
    if (!c || typeof c !== "object") { return false; }
    if (typeof c.id !== "string" || !c.id) { return false; }
    if (typeof c.name !== "string" || !c.name) { return false; }
    if (typeof c.lat !== "number" || !isFinite(c.lat) || c.lat < -90 || c.lat > 90) { return false; }
    if (typeof c.lng !== "number" || !isFinite(c.lng) || c.lng < -180 || c.lng > 180) { return false; }
    if (c.photos !== undefined) {
      if (!Array.isArray(c.photos)) { return false; }
      for (var i = 0; i < c.photos.length; i++) {
        var p = c.photos[i];
        if (!p || typeof p.full !== "string" || typeof p.thumb !== "string") { return false; }
        if (p.full.indexOf("data:image/") !== 0 || p.thumb.indexOf("data:image/") !== 0) { return false; }
      }
    }
    return true;
  }

  CT.parseBackup = function (text) {
    var obj = null;
    try { obj = JSON.parse(text); } catch (e) { return { churches: null, error: "That file is not a valid backup." }; }
    if (!obj || obj.app !== "church-tracker" || !Array.isArray(obj.churches)) {
      return { churches: null, error: "That file is not a church tracker backup." };
    }
    var good = [];
    var skipped = 0;
    for (var i = 0; i < obj.churches.length; i++) {
      if (validChurch(obj.churches[i])) { good.push(obj.churches[i]); } else { skipped++; }
    }
    if (!good.length) { return { churches: null, error: "No readable churches were found in that file." }; }
    return { churches: good, skipped: skipped, error: "" };
  };
})();

/* END OF data.js */
