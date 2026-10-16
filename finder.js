/* finder.js: the search box in the Add form and the Details section on a church card */
(function () {
  "use strict";

  var CT = window.CT = window.CT || {};
  var token = 0;
  var searching = false;

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

  function formatStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ""; }
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function okHref(h) { return /^https?:\/\//i.test(String(h || "")); }

  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(String(url));
    return m ? m[1].replace(/^www\./i, "") : String(url);
  }

  function link(href, text, cls) {
    var a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    if (cls) { a.className = cls; }
    return a;
  }

  /* ---------- Details section ---------- */

  function addRow(box, label, value, href) {
    var row = el("div", "irow");
    row.appendChild(el("div", "ilabel", label));
    var v = el("div", "ivalue");
    if (href && okHref(href)) { v.appendChild(link(href, value)); }
    else { v.textContent = value; }
    row.appendChild(v);
    box.appendChild(row);
  }

  /* When base is given, only details that are new or different from base are shown. */
  function infoRows(box, info, churchName, base) {
    function fresh(key) { return !base || base[key] !== info[key]; }
    if (info.officialName && fresh("officialName") && info.officialName.toLowerCase() !== String(churchName || "").toLowerCase()) {
      addRow(box, "Official name", info.officialName);
    }
    if (info.denomination) { if (fresh("denomination")) { addRow(box, "Denomination", info.denomination); } }
    else if (info.religion && fresh("religion")) { addRow(box, "Religion", info.religion); }
    if (info.address && fresh("address")) { addRow(box, "Address", info.address); }
    if (info.website && okHref(info.website) && fresh("website")) { addRow(box, "Website", hostOf(info.website), info.website); }
    if (info.phone && fresh("phone")) { addRow(box, "Phone", info.phone); }
    if (info.openingHours && fresh("openingHours")) { addRow(box, "Opening hours", info.openingHours); }
    if (info.serviceTimes && fresh("serviceTimes")) { addRow(box, "Services", info.serviceTimes); }
    if (info.startDate && fresh("startDate")) { addRow(box, "Dates from", info.startDate); }
    if (info.listedStatus && fresh("listedStatus")) { addRow(box, "Listed", info.listedStatus); }
    if (info.nhle && /^\d+$/.test(info.nhle) && fresh("nhle")) {
      addRow(box, "Heritage list", "Entry " + info.nhle, "https://historicengland.org.uk/listing/the-list/list-entry/" + info.nhle);
    }
    var w = info.wikipedia;
    var wikiIsNew = !base || !base.wikipedia || base.wikipedia.title !== (w && w.title);
    if (w && w.extract && wikiIsNew) {
      var wb = el("div", "wiki");
      wb.appendChild(el("div", "", w.extract));
      if (w.url && okHref(w.url)) { wb.appendChild(link(w.url, "Read more on Wikipedia")); }
      box.appendChild(wb);
    }
  }

  function sourceLine(info) {
    var text = "Source: OpenStreetMap contributors";
    if (info.wikipedia && info.wikipedia.extract) { text += " and Wikipedia (CC BY-SA)"; }
    var when = info.fetched ? formatStamp(info.fetched) : "";
    text += when ? ". Found on " + when + ". Check opening times before you travel." : ".";
    return el("div", "isource", text);
  }

  function linkRow(church, info) {
    var row = el("div", "linkrow");
    row.appendChild(link("https://maps.apple.com/?daddr=" + church.lat + "," + church.lng, "Directions", "linkbtn"));
    var osmUrl = "https://www.openstreetmap.org/?mlat=" + church.lat + "&mlon=" + church.lng + "#map=18/" + church.lat + "/" + church.lng;
    if (info && /^(node|way|relation)$/.test(String(info.osmType)) && /^\d+$/.test(String(info.osmId))) {
      osmUrl = "https://www.openstreetmap.org/" + info.osmType + "/" + info.osmId;
    }
    row.appendChild(link(osmUrl, "OpenStreetMap", "linkbtn"));
    if (info && info.nhle && /^\d+$/.test(info.nhle)) {
      row.appendChild(link("https://historicengland.org.uk/listing/the-list/list-entry/" + info.nhle, "Historic England entry", "linkbtn"));
    } else {
      row.appendChild(link("https://historicengland.org.uk/listing/the-list/results/", "Search Historic England", "linkbtn"));
    }
    if (!(info && info.wikipedia && info.wikipedia.extract)) {
      row.appendChild(link("https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(church.name), "Search Wikipedia", "linkbtn"));
    }
    return row;
  }

  function showResult(out, church, res) {
    if (!res.info) {
      var down = res.osmError || res.wikiError;
      out.appendChild(el("div", "statusline", down
        ? "Could not reach the online services just now. Check your signal and try again."
        : "No public details were found for this spot. The church may not be on OpenStreetMap yet, or the pin may be some way from the building."));
      return;
    }
    if (church.info && res.osmFound && res.distance === null && !res.wikiFound) {
      out.appendChild(el("div", "statusline", res.wikiError
        ? "Could not reach Wikipedia just now. Your saved details are unchanged."
        : "Nothing new was found. Your saved details are unchanged."));
      return;
    }

    var pv = el("div", "preview");
    var notes = [];
    if (res.osmFound && res.distance !== null) {
      notes.push("Matched to " + res.matched + ", about " + res.distance + " m from your pin. Please check this is the right church.");
    } else if (!res.osmFound) {
      notes.push("No OpenStreetMap entry was found here.");
    }
    if (res.wikiFound && res.nearbyWiki) { notes.push("The Wikipedia article was matched by name and location, so please check it too."); }
    if (res.osmError || res.wikiError) { notes.push("Some services could not be reached, so this may be incomplete."); }
    for (var i = 0; i < notes.length; i++) { pv.appendChild(el("div", "pnote", notes[i])); }

    if (church.info) { pv.appendChild(el("div", "pnote", "New details found:")); }
    infoRows(pv, res.info, church.name, church.info);

    var btns = el("div", "linkrow");
    var save = el("button", "actbtn primary", "Save these details");
    var drop = el("button", "actbtn", "Discard");
    btns.appendChild(save);
    btns.appendChild(drop);
    pv.appendChild(btns);
    out.appendChild(pv);

    save.addEventListener("click", function () {
      save.disabled = true;
      CT.hooks.saveInfo(church.id, CT.lookup.merge(church.info, res.info), function (ok) {
        CT.hooks.toast(ok ? "Details saved." : "Could not save the details.");
      });
    });
    drop.addEventListener("click", function () { out.innerHTML = ""; });
  }

  function renderDetails(body, church) {
    token++;
    var myToken = token;
    var info = church.info || null;
    var box = el("div", "infobox");
    box.appendChild(el("h3", "", "Details"));

    if (info) { infoRows(box, info, church.name); }
    else { box.appendChild(el("div", "statusline", "No public details saved yet. Tap the button to look them up.")); }

    var label = info ? "Find more details" : "Find public details";
    var actions = el("div", "linkrow");
    var findBtn = el("button", "actbtn primary", label);
    actions.appendChild(findBtn);
    box.appendChild(actions);

    var out = el("div", "");
    box.appendChild(out);
    box.appendChild(linkRow(church, info));
    if (info) { box.appendChild(sourceLine(info)); }
    body.appendChild(box);

    findBtn.addEventListener("click", function () {
      if (!CT.hooks) { return; }
      findBtn.disabled = true;
      findBtn.textContent = "Looking...";
      out.innerHTML = "";
      out.appendChild(el("div", "statusline", "Looking up public details. This can take up to 30 seconds."));
      CT.lookup.findDetails(church, function (res) {
        if (myToken !== token) { return; }
        findBtn.disabled = false;
        findBtn.textContent = label;
        out.innerHTML = "";
        showResult(out, church, res);
      });
    });
  }

  /* ---------- Search box in the Add form ---------- */

  function setStatus(text) { byId("searchStatus").textContent = text || ""; }

  function resetSearch(info) {
    byId("fSearch").value = "";
    byId("searchResults").innerHTML = "";
    setStatus("");
    byId("infoNote").textContent = info ? "Public details are saved with this church." : "";
  }

  function applyPlace(p) {
    if (!CT.hooks) { return; }
    CT.hooks.setPlace(p.lat, p.lng);
    CT.hooks.setInfo(p.info);
    var nameEl = byId("fName");
    var typed = trim(nameEl.value);
    var kept = false;
    if (!typed) { nameEl.value = p.name; }
    else if (typed !== p.name) { kept = true; }
    byId("searchResults").innerHTML = "";
    setStatus("Selected " + p.name + ". The location and public details are filled in." + (kept ? " Your own name was kept." : ""));
    byId("infoNote").textContent = "Public details from OpenStreetMap will be saved with this church.";
  }

  function showPlaces(res) {
    var box = byId("searchResults");
    box.innerHTML = "";
    res.places.forEach(function (p) {
      var b = el("button", "res");
      b.type = "button";
      b.appendChild(el("div", "rname", p.name));
      var sub = p.label || "";
      if (p.kind && !p.isChurch) { sub = (sub ? sub + " - " : "") + p.kind; }
      if (sub) { b.appendChild(el("div", "rsub", sub)); }
      b.addEventListener("click", function () { applyPlace(p); });
      box.appendChild(b);
    });
  }

  function doSearch() {
    if (searching) { return; }
    byId("searchResults").innerHTML = "";
    setStatus("Searching...");
    searching = true;
    byId("searchBtn").disabled = true;
    CT.lookup.search(byId("fSearch").value, function (err, res) {
      searching = false;
      byId("searchBtn").disabled = false;
      if (err === "short") { setStatus("Type at least three letters, for example a church name and the town."); return; }
      if (err === "busy") { setStatus("One moment, then tap Search again."); return; }
      if (err) { setStatus("The search did not work. Check your signal and try again. If it keeps failing, open Data and tap Check online services."); return; }
      if (!res.places.length) { setStatus("No churches found. Try adding the town, or use Choose on map to place the pin yourself."); return; }
      setStatus(res.loose ? "No churches matched exactly. These are the closest places found:" : "Tap the right church:");
      showPlaces(res);
    });
  }

  function runCheck() {
    var btn = byId("checkBtn");
    var out = byId("checkOut");
    btn.disabled = true;
    out.innerHTML = "";
    out.appendChild(el("div", "", "Checking. This can take up to 15 seconds..."));
    CT.lookup.check(function (results) {
      btn.disabled = false;
      out.innerHTML = "";
      results.forEach(function (r) {
        var line = el("div", r.ok ? "ok" : "bad", (r.ok ? "Working: " : "Not working: ") + r.label + (r.ok ? "" : " (" + r.detail + ")"));
        out.appendChild(line);
      });
    });
  }

  function init() {
    byId("searchBtn").addEventListener("click", doSearch);
    byId("fSearch").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        byId("fSearch").blur();
        doSearch();
      }
    });
    byId("checkBtn").addEventListener("click", runCheck);
  }

  CT.finder = { renderDetails: renderDetails, resetSearch: resetSearch };
  init();
})();

/* END OF finder.js */
