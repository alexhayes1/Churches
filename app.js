/* app.js: map, list, forms and the Data panel */
(function () {
  "use strict";

  var CT = window.CT;
  var MAX_PHOTOS = 8;
  var REMIND_DAYS = 30;
  var VERSION = "Version: Stage 4 (search and details)";
  var churches = [];
  var pendingInfo = null;
  var map = null;
  var sheetState = 1;
  var pendingLatLng = null;
  var pickMode = false;
  var pickMarker = null;
  var editingId = null;
  var currentId = null;
  var toastTimer = null;
  var formPhotos = [];
  var busy = false;

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  function showToast(msg) {
    var t = byId("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 3500);
  }

  CT.notify = showToast;

  function formatDate(v) {
    if (!v) { return ""; }
    var d = new Date(v + "T12:00:00");
    if (isNaN(d.getTime())) { return v; }
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return "Never"; }
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function photosOf(c) {
    return (c && c.photos && c.photos.length) ? c.photos : [];
  }

  function findChurch(id) {
    for (var i = 0; i < churches.length; i++) {
      if (churches[i].id === id) { return churches[i]; }
    }
    return null;
  }

  function reload(cb) {
    CT.loadAll(function (list) {
      churches = list;
      cb();
    });
  }

  /* ---------- Backup reminder ---------- */

  function isOverdue() {
    if (!churches.length) { return false; }
    var days = CT.daysSinceBackup();
    return days === null || days >= REMIND_DAYS;
  }

  function updateDot() {
    if (isOverdue()) { byId("dataDot").classList.remove("hidden"); }
    else { byId("dataDot").classList.add("hidden"); }
  }

  function reminderText() {
    var days = CT.daysSinceBackup();
    if (days === null) { return "You have not backed up yet. Tap Data at the top, then Back up now."; }
    return "Your last backup was " + days + " days ago. Tap Data at the top, then Back up now.";
  }

  /* ---------- Photos in the form ---------- */

  function processNext(files, index, done) {
    if (index >= files.length) { done(); return; }
    if (formPhotos.length >= MAX_PHOTOS) {
      showToast("Maximum of " + MAX_PHOTOS + " photos per church.");
      done();
      return;
    }
    CT.readPhoto(files[index], function (photo) {
      formPhotos.push(photo);
      processNext(files, index + 1, done);
    }, function (msg) {
      showToast(msg);
      processNext(files, index + 1, done);
    });
  }

  function handlePhotoChoice() {
    var input = byId("fPhotos");
    var files = [];
    for (var i = 0; i < input.files.length; i++) { files.push(input.files[i]); }
    if (!files.length) { return; }
    busy = true;
    showToast("Processing photos...");
    processNext(files, 0, function () {
      input.value = "";
      busy = false;
      renderFormPhotos();
    });
  }

  function makePhotoItem(i) {
    var p = formPhotos[i];
    var box = el("div", "pitem");
    var img = document.createElement("img");
    img.src = p.thumb;
    img.alt = "";
    img.addEventListener("click", function () {
      if (i === 0) { return; }
      var moved = formPhotos.splice(i, 1)[0];
      formPhotos.unshift(moved);
      renderFormPhotos();
      showToast("Set as the icon.");
    });
    box.appendChild(img);
    var x = el("button", "x", "x");
    x.addEventListener("click", function () {
      formPhotos.splice(i, 1);
      renderFormPhotos();
    });
    box.appendChild(x);
    if (i === 0) { box.appendChild(el("div", "badge", "Icon")); }
    return box;
  }

  function renderFormPhotos() {
    var grid = byId("pgrid");
    grid.innerHTML = "";
    for (var i = 0; i < formPhotos.length; i++) {
      grid.appendChild(makePhotoItem(i));
    }
    byId("photoBtn").textContent = "Add photos (" + formPhotos.length + " of " + MAX_PHOTOS + ")";
  }

  function openViewer(src) {
    byId("viewerImg").src = src;
    byId("viewer").classList.remove("hidden");
  }

  function closeViewer() {
    byId("viewer").classList.add("hidden");
    byId("viewerImg").src = "";
  }

  /* ---------- Map ---------- */

  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([54.5, -3], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    CT.markers.init(map, function (id) { selectChurch(id); });

    map.on("click", function (e) {
      if (!pickMode) { return; }
      pickMode = false;
      byId("pickBanner").classList.add("hidden");
      setPending(e.latlng.lat, e.latlng.lng);
      byId("formWrap").classList.remove("hidden");
    });
  }

  function fitAll() {
    if (!churches.length) {
      map.setView([54.5, -3], 5);
      return;
    }
    var pts = [];
    for (var i = 0; i < churches.length; i++) { pts.push([churches[i].lat, churches[i].lng]); }
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [30, 30],
      paddingBottomRight: [30, Math.round(window.innerHeight * 0.4)],
      maxZoom: 12
    });
  }

  /* ---------- Rendering ---------- */

  function renderAll() {
    CT.markers.set(churches, currentId);
    renderList();
    updateDot();
    byId("count").textContent = churches.length ? "(" + churches.length + ")" : "";
  }

  function renderList() {
    var list = byId("list");
    list.innerHTML = "";
    var sorted = churches.slice().sort(function (a, b) {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });

    if (isOverdue()) { list.appendChild(el("div", "notice", reminderText())); }

    if (!sorted.length) {
      list.appendChild(el("div", "empty", "No churches yet. Tap + Add, or load the sample churches below to see how it works."));
    }

    sorted.forEach(function (c) {
      var item = el("div", "item");
      var thumb = el("div", "thumb");
      var ph = photosOf(c);
      if (ph.length) {
        var im = document.createElement("img");
        im.src = ph[0].thumb;
        im.alt = "";
        thumb.appendChild(im);
      } else {
        thumb.textContent = "\u26EA";
      }
      item.appendChild(thumb);
      var txt = el("div", "");
      txt.appendChild(el("div", "itemname", c.name));
      var sub = c.dateVisited ? "Visited " + formatDate(c.dateVisited) : "No date added";
      txt.appendChild(el("div", "itemsub", sub));
      item.appendChild(txt);
      item.addEventListener("click", function () { selectChurch(c.id); });
      list.appendChild(item);
    });

    var tools = el("div", "tools");
    var loadBtn = el("button", "", "Load 3 sample churches");
    loadBtn.addEventListener("click", loadSamples);
    var removeBtn = el("button", "", "Remove sample churches");
    removeBtn.addEventListener("click", removeSamples);
    tools.appendChild(loadBtn);
    tools.appendChild(removeBtn);
    tools.appendChild(el("div", "version", VERSION));
    list.appendChild(tools);
  }

  /* ---------- Bottom sheet ---------- */

  function setSheet(n) {
    sheetState = n;
    byId("sheet").className = "sheet s" + n;
  }

  function initSheet() {
    var handle = byId("handle");
    var startY = null;
    handle.addEventListener("touchstart", function (e) {
      startY = e.touches[0].clientY;
    }, { passive: true });
    handle.addEventListener("touchend", function (e) {
      if (startY === null) { return; }
      var dy = e.changedTouches[0].clientY - startY;
      startY = null;
      if (dy < -30) { setSheet(Math.min(2, sheetState + 1)); }
      else if (dy > 30) { setSheet(Math.max(0, sheetState - 1)); }
      else { setSheet(sheetState === 0 ? 1 : (sheetState === 1 ? 2 : 0)); }
    }, { passive: true });
  }

  /* ---------- Detail card ---------- */

  function selectChurch(id) {
    var c = findChurch(id);
    if (!c) { return; }
    currentId = id;
    CT.markers.setSelected(id);
    setSheet(0);
    map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });

    var body = byId("detailBody");
    body.innerHTML = "";
    body.appendChild(el("h2", "", c.name));

    var ph = photosOf(c);
    if (ph.length) {
      var strip = el("div", "strip");
      ph.forEach(function (p) {
        var im = document.createElement("img");
        im.src = p.full;
        im.alt = "";
        im.addEventListener("click", function () { openViewer(p.full); });
        strip.appendChild(im);
      });
      body.appendChild(strip);
    }

    if (c.dateVisited) { body.appendChild(el("p", "", "Visited: " + formatDate(c.dateVisited))); }
    if (c.notes) { body.appendChild(el("p", "", c.notes)); }
    body.appendChild(el("p", "small", "Location: " + c.lat.toFixed(5) + ", " + c.lng.toFixed(5)));
    if (c.sample) { body.appendChild(el("p", "small", "This is a sample church for testing.")); }
    if (CT.finder) {
      try { CT.finder.renderDetails(body, c); }
      catch (err) { body.appendChild(el("p", "small", "Details could not be shown: " + (err && err.message ? err.message : err))); }
    } else {
      body.appendChild(el("p", "small", "The details feature did not load. Check that finder.js was pasted in full (its last line is /* END OF finder.js */)."));
    }
    byId("detail").classList.remove("hidden");
  }

  function closeDetail() {
    byId("detail").classList.add("hidden");
    currentId = null;
    CT.markers.setSelected(null);
    setSheet(1);
  }

  /* ---------- Add / edit form ---------- */

  function setPending(lat, lng) {
    pendingLatLng = { lat: lat, lng: lng };
    byId("locLabel").textContent = "Location set: " + lat.toFixed(5) + ", " + lng.toFixed(5);
    if (pickMarker) { map.removeLayer(pickMarker); }
    pickMarker = L.circleMarker([lat, lng], { radius: 12, color: "#8a1c2b", weight: 3, fillColor: "#8a1c2b", fillOpacity: 0.35 }).addTo(map);
  }

  function clearPickMarker() {
    if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  }

  function openForm(church) {
    editingId = church ? church.id : null;
    byId("formTitle").textContent = church ? "Edit church" : "Add a church";
    byId("fName").value = church ? church.name : "";
    byId("fDate").value = church && church.dateVisited ? church.dateVisited : "";
    byId("fNotes").value = church && church.notes ? church.notes : "";
    formPhotos = photosOf(church).slice();
    renderFormPhotos();
    pendingInfo = (church && church.info) ? church.info : null;
    if (CT.finder) { CT.finder.resetSearch(pendingInfo); }
    pendingLatLng = null;
    clearPickMarker();
    byId("locLabel").textContent = "No location chosen yet";
    if (church) { setPending(church.lat, church.lng); }
    byId("detail").classList.add("hidden");
    setSheet(0);
    byId("formWrap").classList.remove("hidden");
  }

  function closeForm() {
    byId("formWrap").classList.add("hidden");
    byId("pickBanner").classList.add("hidden");
    pickMode = false;
    clearPickMarker();
    editingId = null;
    formPhotos = [];
    pendingInfo = null;
    setSheet(1);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      showToast("Location is not available on this device.");
      return;
    }
    showToast("Finding your location...");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setPending(pos.coords.latitude, pos.coords.longitude);
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      showToast("Location found.");
    }, function () {
      showToast("Could not get your location. Check Safari location permission.");
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  function startPicking() {
    pickMode = true;
    byId("formWrap").classList.add("hidden");
    byId("pickBanner").classList.remove("hidden");
  }

  function cancelPicking() {
    pickMode = false;
    byId("pickBanner").classList.add("hidden");
    byId("formWrap").classList.remove("hidden");
  }

  function saveForm() {
    if (busy) { showToast("Still processing photos. Try again in a moment."); return; }
    var name = byId("fName").value.replace(/^\s+|\s+$/g, "");
    if (!name) { showToast("Please enter a name."); return; }
    if (!pendingLatLng) { showToast("Please choose a location."); return; }

    var record;
    if (editingId) {
      record = findChurch(editingId);
    } else {
      record = { id: CT.newId(), created: new Date().toISOString() };
    }
    record.name = name;
    record.dateVisited = byId("fDate").value;
    record.notes = byId("fNotes").value;
    record.lat = pendingLatLng.lat;
    record.lng = pendingLatLng.lng;
    record.photos = formPhotos.slice();
    if (pendingInfo) { record.info = pendingInfo; } else { delete record.info; }
    record.updated = new Date().toISOString();

    var savedId = record.id;
    CT.saveMany([record], function () {
      reload(function () {
        renderAll();
        closeForm();
        showToast("Saved.");
        selectChurch(savedId);
      });
    });
  }

  function deleteCurrent() {
    var c = findChurch(currentId);
    if (!c) { return; }
    if (!window.confirm("Delete " + c.name + "? This cannot be undone.")) { return; }
    CT.deleteMany([c.id], function () {
      reload(function () {
        renderAll();
        closeDetail();
        showToast("Deleted.");
      });
    });
  }

  /* ---------- Samples ---------- */

  function loadSamples() {
    var now = new Date().toISOString();
    var samples = [
      { id: "sample-1", name: "St Paul's Cathedral, London", lat: 51.5138, lng: -0.0984, dateVisited: "2026-05-02", notes: "Sample church. Climbed the dome.", sample: true, created: now },
      { id: "sample-2", name: "Salisbury Cathedral", lat: 51.0645, lng: -1.7976, dateVisited: "2026-06-14", notes: "Sample church. Tallest spire in the UK.", sample: true, created: now },
      { id: "sample-3", name: "York Minster", lat: 53.9621, lng: -1.0819, dateVisited: "2026-08-23", notes: "Sample church. Beautiful stained glass.", sample: true, created: now }
    ];
    CT.saveMany(samples, function () {
      reload(function () {
        renderAll();
        fitAll();
        showToast("Sample churches loaded.");
      });
    });
  }

  function removeSamples() {
    var ids = [];
    for (var i = 0; i < churches.length; i++) {
      if (churches[i].sample) { ids.push(churches[i].id); }
    }
    if (!ids.length) { showToast("No sample churches to remove."); return; }
    CT.deleteMany(ids, function () {
      reload(function () {
        renderAll();
        showToast("Sample churches removed.");
      });
    });
  }

  /* ---------- Data panel: backup and restore ---------- */

  function refreshDataPanel() {
    byId("dCount").textContent = String(churches.length);
    var last = CT.lastBackup();
    byId("dLast").textContent = last ? formatStamp(last) : "Never";
    byId("dStore").textContent = "Checking...";
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (yes) {
        byId("dStore").textContent = yes ? "On" : "Standard (keep backups)";
      }).catch(function () {
        byId("dStore").textContent = "Unknown";
      });
    } else {
      byId("dStore").textContent = "Unknown";
    }
  }

  function openData() {
    refreshDataPanel();
    byId("dataWrap").classList.remove("hidden");
  }

  function closeData() {
    byId("dataWrap").classList.add("hidden");
  }

  function doBackup() {
    if (!churches.length) { showToast("Nothing to back up yet."); return; }
    CT.exportBackup(churches, function (result) {
      if (result === "cancelled") { showToast("Backup cancelled."); }
      else if (result === "failed") { showToast("Backup did not complete. Please try again."); }
      else { showToast("Backup created. Keep the file somewhere safe."); }
      refreshDataPanel();
      renderList();
      updateDot();
    });
  }

  function handleRestoreFile() {
    var input = byId("fRestore");
    var file = input.files && input.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      input.value = "";
      var res = CT.parseBackup(String(reader.result));
      if (!res.churches) { showToast(res.error); return; }
      var msg = "Restore " + res.churches.length + " churches from this backup?";
      if (res.skipped) { msg += " " + res.skipped + " unreadable entries will be skipped."; }
      msg += " Churches already here with the same ID will be updated. Nothing else is deleted.";
      if (!window.confirm(msg)) { return; }
      CT.saveMany(res.churches, function () {
        reload(function () {
          renderAll();
          fitAll();
          refreshDataPanel();
          showToast("Restore complete: " + res.churches.length + " churches.");
        });
      });
    };
    reader.onerror = function () {
      input.value = "";
      showToast("Could not read that file.");
    };
    reader.readAsText(file);
  }

  /* ---------- Hooks used by finder.js ---------- */

  CT.hooks = {
    setPlace: function (lat, lng) {
      setPending(lat, lng);
      map.setView([lat, lng], 16);
    },
    setInfo: function (info) { pendingInfo = info; },
    saveInfo: function (id, info, cb) {
      var c = findChurch(id);
      if (!c) { cb(false); return; }
      c.info = info;
      c.updated = new Date().toISOString();
      CT.saveMany([c], function () {
        reload(function () {
          renderAll();
          selectChurch(id);
          cb(true);
        });
      });
    },
    toast: showToast
  };

  /* ---------- Start-up ---------- */

  function wireButtons() {
    byId("addBtn").addEventListener("click", function () { openForm(null); });
    byId("dataBtn").addEventListener("click", openData);
    byId("dataClose").addEventListener("click", closeData);
    byId("backupBtn").addEventListener("click", doBackup);
    byId("restoreBtn").addEventListener("click", function () { byId("fRestore").click(); });
    byId("fRestore").addEventListener("change", handleRestoreFile);
    byId("cancelBtn").addEventListener("click", closeForm);
    byId("saveBtn").addEventListener("click", saveForm);
    byId("useLocBtn").addEventListener("click", useMyLocation);
    byId("pickBtn").addEventListener("click", startPicking);
    byId("pickCancel").addEventListener("click", cancelPicking);
    byId("closeDetailBtn").addEventListener("click", closeDetail);
    byId("deleteBtn").addEventListener("click", deleteCurrent);
    byId("editBtn").addEventListener("click", function () {
      var c = findChurch(currentId);
      if (c) { openForm(c); }
    });
    byId("title").addEventListener("click", fitAll);
    byId("photoBtn").addEventListener("click", function () {
      if (formPhotos.length >= MAX_PHOTOS) {
        showToast("Maximum of " + MAX_PHOTOS + " photos per church.");
        return;
      }
      byId("fPhotos").click();
    });
    byId("fPhotos").addEventListener("change", handlePhotoChoice);
    byId("viewer").addEventListener("click", closeViewer);
    byId("viewerClose").addEventListener("click", closeViewer);
  }

  function start() {
    initMap();
    initSheet();
    wireButtons();
    CT.openDb(function () {
      reload(function () {
        renderAll();
        fitAll();
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist();
        }
      });
    });
  }

  start();
})();

/* END OF app.js */
