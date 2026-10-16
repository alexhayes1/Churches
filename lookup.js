/* lookup.js: finds churches and public details from OpenStreetMap and Wikipedia */
(function () {
  "use strict";

  var CT = window.CT = window.CT || {};

  var NOMINATIM = "https://nominatim.openstreetmap.org/";
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  var SEARCH_GAP_MS = 1100;
  var lastSearchAt = 0;
  var searchCache = {};

  /* ---------- Small helpers ---------- */

  function request(url, init, ms, cb) {
    var finished = false;
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (finished) { return; }
      finished = true;
      if (ctl) { ctl.abort(); }
      cb("timed out");
    }, ms);
    var options = init || {};
    if (ctl) { options.signal = ctl.signal; }
    fetch(url, options).then(function (r) {
      if (!r.ok) { throw new Error("error " + r.status); }
      return r.json();
    }).then(function (data) {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      cb(null, data);
    }).catch(function (e) {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      cb(String(e && e.message ? e.message : e));
    });
  }

  function trim(s) { return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, ""); }

  function pretty(v) {
    var s = trim(v).replace(/_/g, " ").replace(/;/g, ", ");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function shorten(text, max) {
    var s = trim(String(text || "").replace(/\s+/g, " "));
    if (s.length <= max) { return s; }
    var cut = s.substring(0, max);
    var stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (stop > 120) { return cut.substring(0, stop + 1); }
    var sp = cut.lastIndexOf(" ");
    return (sp > 0 ? cut.substring(0, sp) : cut) + "...";
  }

  function distanceM(lat1, lng1, lat2, lng2) {
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function words(s) {
    var t = String(s || "").toLowerCase().replace(/['\u2019]s\b/g, "").replace(/[^a-z0-9 ]+/g, " ");
    var parts = t.split(/\s+/);
    var skip = { st: 1, saint: 1, church: 1, of: 1, the: 1, and: 1, in: 1, parish: 1, s: 1, all: 1 };
    var out = {};
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && !skip[parts[i]]) { out[parts[i]] = 1; }
    }
    return out;
  }

  function similarity(a, b) {
    var wa = words(a);
    var wb = words(b);
    var inter = 0;
    var uni = 0;
    var k;
    for (k in wa) { if (wa.hasOwnProperty(k)) { uni++; if (wb.hasOwnProperty(k)) { inter++; } } }
    for (k in wb) { if (wb.hasOwnProperty(k) && !wa.hasOwnProperty(k)) { uni++; } }
    return uni ? inter / uni : 0;
  }

  function safeUrl(u) {
    var s = trim(u);
    if (!s || s.length > 300) { return ""; }
    if (/^https?:\/\//i.test(s)) { return s; }
    if (/^www\./i.test(s)) { return "https://" + s; }
    if (/^[a-z0-9.\-]+\.[a-z]{2,}(\/|$)/i.test(s)) { return "https://" + s; }
    return "";
  }

  /* ---------- Turning OpenStreetMap data into saved details ---------- */

  function addressFromTags(t) {
    var street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    var place = t["addr:city"] || t["addr:town"] || t["addr:village"] || t["addr:suburb"] || "";
    return [t["addr:housename"], street, place, t["addr:postcode"]].filter(Boolean).join(", ");
  }

  function addressFromNominatim(a) {
    if (!a) { return ""; }
    var street = [a.house_number, a.road].filter(Boolean).join(" ");
    var place = a.village || a.town || a.city || a.suburb || a.hamlet || "";
    return [street, place, a.postcode].filter(Boolean).join(", ");
  }

  function infoFromTags(tags, address) {
    var t = tags || {};
    var info = {};
    function put(key, value) {
      var v = trim(value);
      if (v) { info[key] = v.substring(0, 300); }
    }
    put("denomination", pretty(t.denomination));
    put("religion", pretty(t.religion));
    put("address", address || addressFromTags(t));
    put("website", safeUrl(t.website || t["contact:website"] || t.url));
    put("phone", t.phone || t["contact:phone"]);
    put("openingHours", t.opening_hours);
    put("serviceTimes", t.service_times);
    put("startDate", t.start_date);
    put("listedStatus", t.listed_status);
    if (/^\d{4,8}$/.test(trim(t["ref:GB:nhle"]))) { info.nhle = trim(t["ref:GB:nhle"]); }
    if (/^Q\d+$/.test(trim(t.wikidata))) { info.wikidata = trim(t.wikidata); }
    put("wikiTag", t.wikipedia);
    return info;
  }

  function isChurchy(category, type) {
    if (category === "amenity" && type === "place_of_worship") { return true; }
    if (category === "building" && /^(church|chapel|cathedral)$/.test(type)) { return true; }
    if (category === "historic" && /^(church|monastery|abbey)$/.test(type)) { return true; }
    return false;
  }

  function placeFromResult(r) {
    if (!r) { return null; }
    var lat = parseFloat(r.lat);
    var lng = parseFloat(r.lon);
    if (!isFinite(lat) || !isFinite(lng)) { return null; }
    var name = trim(r.name);
    if (!name) { return null; }
    var info = infoFromTags(r.extratags, addressFromNominatim(r.address));
    info.officialName = name;
    if (/^(node|way|relation)$/.test(String(r.osm_type)) && /^\d+$/.test(String(r.osm_id))) {
      info.osmType = String(r.osm_type);
      info.osmId = String(r.osm_id);
    }
    var label = info.address || trim(String(r.display_name || "").replace(/,\s*United Kingdom$/i, ""));
    return {
      name: name,
      lat: lat,
      lng: lng,
      label: label,
      kind: pretty(r.type),
      isChurch: isChurchy(r.category, r.type),
      info: info
    };
  }

  /* ---------- Search by name ---------- */

  CT.lookup = {};

  CT.lookup.similarity = similarity;
  CT.lookup.safeUrl = safeUrl;

  CT.lookup.merge = function (oldInfo, newInfo) {
    var out = {};
    var k;
    if (oldInfo) { for (k in oldInfo) { if (oldInfo.hasOwnProperty(k)) { out[k] = oldInfo[k]; } } }
    if (newInfo) { for (k in newInfo) { if (newInfo.hasOwnProperty(k)) { out[k] = newInfo[k]; } } }
    return out;
  };

  CT.lookup.search = function (text, cb) {
    var q = trim(text);
    if (q.length < 3) { cb("short"); return; }
    var key = q.toLowerCase();
    if (searchCache[key]) { cb(null, searchCache[key]); return; }
    var now = Date.now();
    if (now - lastSearchAt < SEARCH_GAP_MS) { cb("busy"); return; }
    lastSearchAt = now;

    var query = /(church|chapel|cathedral|abbey|minster|priory|kirk|basilica|friary|temple)/i.test(q) ? q : q + " church";
    var url = NOMINATIM + "search?format=jsonv2&addressdetails=1&extratags=1&countrycodes=gb&limit=15&accept-language=en-GB&q=" + encodeURIComponent(query);

    request(url, null, 15000, function (err, data) {
      if (err || !Array.isArray(data)) { cb("network"); return; }
      var all = [];
      var i;
      for (i = 0; i < data.length; i++) {
        var p = placeFromResult(data[i]);
        if (p) { all.push(p); }
      }
      var churchy = all.filter(function (p) { return p.isChurch; });
      var loose = churchy.length === 0;
      var pool = loose ? all.slice(0, 5) : churchy;

      var kept = [];
      for (i = 0; i < pool.length; i++) {
        var dup = false;
        for (var j = 0; j < kept.length; j++) {
          if (kept[j].name.toLowerCase() === pool[i].name.toLowerCase() &&
              distanceM(kept[j].lat, kept[j].lng, pool[i].lat, pool[i].lng) < 80) { dup = true; break; }
        }
        if (!dup) { kept.push(pool[i]); }
        if (kept.length >= 8) { break; }
      }
      var result = { places: kept, loose: loose };
      searchCache[key] = result;
      cb(null, result);
    });
  };

  /* ---------- Details for a church that is already on the map ---------- */

  function pickBest(elements, lat, lng, name) {
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < elements.length; i++) {
      var e = elements[i];
      var t = e.tags || {};
      var c = (e.type === "node") ? { lat: e.lat, lon: e.lon } : e.center;
      if (!c || !t.name) { continue; }
      var d = distanceM(lat, lng, c.lat, c.lon);
      var score = similarity(name, t.name) + Math.max(0, 1 - d / 120) * 0.6 + (t.amenity === "place_of_worship" ? 0.2 : 0);
      if (score > bestScore) { bestScore = score; best = { el: e, tags: t, distance: d }; }
    }
    if (!best) { return null; }
    var info = infoFromTags(best.tags);
    info.officialName = trim(best.tags.name);
    if (/^(node|way|relation)$/.test(String(best.el.type)) && /^\d+$/.test(String(best.el.id))) {
      info.osmType = String(best.el.type);
      info.osmId = String(best.el.id);
    }
    return { info: info, distance: best.distance };
  }

  function overpassNearby(lat, lng, name, cb) {
    var around = "(around:120," + lat.toFixed(6) + "," + lng.toFixed(6) + ")";
    var q = "[out:json][timeout:15];(nwr" + around + "[\"amenity\"=\"place_of_worship\"];nwr" + around + "[\"building\"~\"^(church|chapel|cathedral)$\"];);out tags center 30;";
    function attempt(i) {
      if (i >= OVERPASS.length) { cb("unreachable"); return; }
      var init = {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q)
      };
      request(OVERPASS[i], init, 14000, function (err, data) {
        if (err || !data || !Array.isArray(data.elements)) { attempt(i + 1); return; }
        cb(null, pickBest(data.elements, lat, lng, name));
      });
    }
    attempt(0);
  }

  function nominatimReverse(lat, lng, cb) {
    var url = NOMINATIM + "reverse?format=jsonv2&addressdetails=1&extratags=1&zoom=18&accept-language=en-GB&lat=" + lat.toFixed(6) + "&lon=" + lng.toFixed(6);
    request(url, null, 12000, function (err, r) {
      if (err) { cb(err); return; }
      var p = (r && !r.error) ? placeFromResult(r) : null;
      cb(null, (p && p.isChurch) ? p : null);
    });
  }

  function wikiHost(lang) {
    return /^[a-z]{2,3}(-[a-z]+)?$/.test(lang) ? "https://" + lang + ".wikipedia.org/" : "";
  }

  function wikiPage(lang, title, cb) {
    var host = wikiHost(lang);
    if (!host) { cb(null, null); return; }
    var url = host + "w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts%7Cinfo%7Cpageprops&ppprop=disambiguation&exintro=1&explaintext=1&exsentences=4&inprop=url&titles=" + encodeURIComponent(title);
    request(url, null, 12000, function (err, d) {
      if (err) { cb("network", null); return; }
      var pages = d && d.query && d.query.pages ? d.query.pages : null;
      var page = null;
      var key;
      if (pages) { for (key in pages) { if (pages.hasOwnProperty(key)) { page = pages[key]; break; } } }
      if (!page || page.missing !== undefined || !page.extract) { cb(null, null); return; }
      if (page.pageprops && page.pageprops.disambiguation !== undefined) { cb(null, null); return; }
      var link = String(page.fullurl || "");
      if (link.indexOf(host) !== 0) { link = host + "wiki/" + encodeURIComponent(String(page.title).replace(/ /g, "_")); }
      cb(null, { title: String(page.title), lang: lang, url: link, extract: shorten(page.extract, 420) });
    });
  }

  function wikiNearby(lat, lng, name, cb) {
    var url = "https://en.wikipedia.org/w/api.php?action=query&list=geosearch&format=json&origin=*&gsradius=300&gslimit=15&gscoord=" + encodeURIComponent(lat.toFixed(6) + "|" + lng.toFixed(6));
    request(url, null, 12000, function (err, d) {
      if (err) { cb("network", null); return; }
      var list = d && d.query && d.query.geosearch ? d.query.geosearch : [];
      var best = null;
      var bestScore = 0;
      for (var i = 0; i < list.length; i++) {
        var s = similarity(name, list[i].title);
        if (s > bestScore) { bestScore = s; best = list[i]; }
      }
      if (!best || bestScore < 0.6) { cb(null, null); return; }
      wikiPage("en", best.title, cb);
    });
  }

  function wikiFor(info, lat, lng, name, cb) {
    var m = (info && info.wikiTag) ? /^([a-z]{2,3}(?:-[a-z]+)?):(.+)$/.exec(info.wikiTag) : null;
    function nearby() {
      wikiNearby(lat, lng, name, function (err, w) { cb(err, w, true); });
    }
    if (m) {
      wikiPage(m[1], m[2], function (err, w) {
        if (w) { cb(null, w, false); } else { nearby(); }
      });
    } else {
      nearby();
    }
  }

  CT.lookup.findDetails = function (church, cb) {
    var out = { info: null, matched: "", distance: null, osmFound: false, wikiFound: false, nearbyWiki: false, osmError: false, wikiError: false };

    function afterOsm(info) {
      var base = info || {};
      var lookFor = base.officialName || church.name;
      wikiFor(base, church.lat, church.lng, lookFor, function (err, wiki, viaNearby) {
        if (err) { out.wikiError = true; }
        if (wiki) {
          base.wikipedia = wiki;
          out.wikiFound = true;
          out.nearbyWiki = !!viaNearby;
        }
        var any = false;
        for (var k in base) { if (base.hasOwnProperty(k)) { any = true; break; } }
        if (any) {
          base.source = "OpenStreetMap";
          base.fetched = new Date().toISOString();
          out.info = base;
        }
        cb(out);
      });
    }

    if (church.info && church.info.osmId) {
      var copy = {};
      for (var k in church.info) { if (church.info.hasOwnProperty(k)) { copy[k] = church.info[k]; } }
      out.osmFound = true;
      out.matched = copy.officialName || "";
      afterOsm(copy);
      return;
    }

    overpassNearby(church.lat, church.lng, church.name, function (err, hit) {
      if (hit) {
        out.osmFound = true;
        out.matched = hit.info.officialName || "";
        out.distance = Math.round(hit.distance);
        afterOsm(hit.info);
        return;
      }
      if (!err) { afterOsm(null); return; }
      nominatimReverse(church.lat, church.lng, function (err2, place) {
        if (place) {
          out.osmFound = true;
          out.matched = place.info.officialName || "";
          out.distance = Math.round(distanceM(church.lat, church.lng, place.lat, place.lng));
          afterOsm(place.info);
        } else {
          if (err2) { out.osmError = true; }
          afterOsm(null);
        }
      });
    });
  };

  /* ---------- Connection check (shown in the Data panel) ---------- */

  CT.lookup.check = function (cb) {
    var probe = "[out:json][timeout:10];node(around:50,50.4318,-3.6877);out tags 1;";
    function post() {
      return {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(probe)
      };
    }
    var tests = [
      { label: "Church search (OpenStreetMap)", url: NOMINATIM + "search?format=jsonv2&limit=1&q=Totnes", init: function () { return null; }, ok: function (d) { return Array.isArray(d); } },
      { label: "Nearby places (main server)", url: OVERPASS[0], init: post, ok: function (d) { return d && Array.isArray(d.elements); } },
      { label: "Nearby places (spare server)", url: OVERPASS[1], init: post, ok: function (d) { return d && Array.isArray(d.elements); } },
      { label: "Wikipedia", url: "https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*", init: function () { return null; }, ok: function (d) { return d && d.query; } }
    ];
    var results = [];
    var left = tests.length;
    tests.forEach(function (t, index) {
      request(t.url, t.init(), 15000, function (err, data) {
        if (err) { results[index] = { label: t.label, ok: false, detail: err }; }
        else if (!t.ok(data)) { results[index] = { label: t.label, ok: false, detail: "unexpected reply" }; }
        else { results[index] = { label: t.label, ok: true, detail: "working" }; }
        left--;
        if (left === 0) { cb(results); }
      });
    });
  };
})();

/* END OF lookup.js */
