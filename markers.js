/* markers.js: map pins that become a photo icon plus name where there is room */
(function () {
  "use strict";

  var CT = window.CT = window.CT || {};

  var LABEL_MIN_ZOOM = 7;
  var DOT = 28;
  var PILL_H = 34;
  var ANCHOR = 17;
  var EXTRA_W = 51;
  var MAX_TEXT = 150;
  var GAP = 4;

  var map = null;
  var layer = null;
  var onSelect = null;
  var items = [];
  var selectedId = null;
  var timer = null;
  var measureCtx = null;
  var widthCache = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  function textWidth(name) {
    if (widthCache[name] !== undefined) { return widthCache[name]; }
    var w = name.length * 7.6;
    try {
      if (!measureCtx) {
        measureCtx = document.createElement("canvas").getContext("2d");
        measureCtx.font = "600 13px -apple-system, Arial, sans-serif";
      }
      var m = measureCtx.measureText(name).width;
      if (m > 0) { w = m; }
    } catch (e) { }
    w = Math.min(MAX_TEXT, Math.ceil(w) + 2);
    widthCache[name] = w;
    return w;
  }

  function dotIcon() {
    return L.divIcon({
      className: "",
      html: el("div", "pin-dot", "\u26EA"),
      iconSize: [DOT, DOT],
      iconAnchor: [DOT / 2, DOT / 2]
    });
  }

  function labelIcon(rec, selected, textW) {
    var width = EXTRA_W + textW;
    var pill = el("div", selected ? "lbl sel" : "lbl");
    pill.style.width = width + "px";
    var ic = el("div", "lbl-ic");
    var ph = (rec.photos && rec.photos.length) ? rec.photos[0] : null;
    if (ph && ph.thumb) {
      var im = document.createElement("img");
      im.src = ph.thumb;
      im.alt = "";
      ic.appendChild(im);
    } else {
      ic.textContent = "\u26EA";
    }
    pill.appendChild(ic);
    pill.appendChild(el("div", "lbl-tx", rec.name));
    return L.divIcon({
      className: "",
      html: pill,
      iconSize: [width, PILL_H],
      iconAnchor: [ANCHOR, ANCHOR]
    });
  }

  function overlaps(a, b) {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  }

  function dotBox(it) {
    var h = DOT / 2 + 1;
    return { x1: it.x - h, y1: it.y - h, x2: it.x + h, y2: it.y + h };
  }

  function byName(a, b) {
    if (a.rec.id === selectedId) { return -1; }
    if (b.rec.id === selectedId) { return 1; }
    var an = a.rec.name.toLowerCase();
    var bn = b.rec.name.toLowerCase();
    return an < bn ? -1 : (an > bn ? 1 : 0);
  }

  function refresh() {
    timer = null;
    if (!map) { return; }
    var size = map.getSize();
    var zoom = map.getZoom();
    var pad = 250;
    var i;

    for (i = 0; i < items.length; i++) {
      var p = map.latLngToContainerPoint([items[i].rec.lat, items[i].rec.lng]);
      items[i].x = p.x;
      items[i].y = p.y;
      items[i].vis = p.x > -pad && p.x < size.x + pad && p.y > -pad && p.y < size.y + pad;
    }

    var order = items.slice().sort(byName);
    var placed = [];

    for (i = 0; i < order.length; i++) {
      var it = order[i];
      var isSel = it.rec.id === selectedId;
      var mode = "dot";

      if (it.vis && (isSel || zoom >= LABEL_MIN_ZOOM)) {
        var box = {
          x1: it.x - ANCHOR - GAP,
          y1: it.y - ANCHOR - GAP,
          x2: it.x - ANCHOR + EXTRA_W + it.textW + GAP,
          y2: it.y + ANCHOR + GAP
        };
        var ok = true;
        if (!isSel) {
          var j;
          for (j = 0; j < placed.length; j++) {
            if (overlaps(box, placed[j])) { ok = false; break; }
          }
          if (ok) {
            for (j = 0; j < items.length; j++) {
              if (items[j] !== it && items[j].vis && overlaps(box, dotBox(items[j]))) { ok = false; break; }
            }
          }
        }
        if (ok) {
          mode = "label";
          placed.push(box);
        }
      }

      var key = mode + (isSel ? "-sel" : "");
      if (it.mode !== key) {
        it.mode = key;
        it.marker.setIcon(mode === "label" ? labelIcon(it.rec, isSel, it.textW) : dotIcon());
        it.marker.setZIndexOffset(isSel ? 1000 : (mode === "label" ? 200 : 0));
      }
    }
  }

  function schedule() {
    if (timer) { return; }
    timer = setTimeout(refresh, 20);
  }

  function addItem(rec) {
    var m = L.marker([rec.lat, rec.lng], { icon: dotIcon() });
    m.on("click", function () { if (onSelect) { onSelect(rec.id); } });
    m.addTo(layer);
    items.push({ rec: rec, marker: m, mode: "dot", textW: textWidth(rec.name), x: 0, y: 0, vis: false });
  }

  CT.markers = {
    init: function (mapObj, selectFn) {
      map = mapObj;
      onSelect = selectFn;
      layer = L.layerGroup().addTo(map);
      map.on("zoomend moveend resize", schedule);
    },
    set: function (list, selId) {
      selectedId = selId || null;
      layer.clearLayers();
      items = [];
      for (var i = 0; i < list.length; i++) { addItem(list[i]); }
      refresh();
    },
    setSelected: function (id) {
      selectedId = id || null;
      refresh();
    }
  };
})();

/* END OF markers.js */
