/**
 * NeoGalleries
 * ============
 *
 * This module provides the core functionality for the NeoGalleries application, including data loading, filtering,
 * pagination, rendering, and interaction with the Neocities API.
 * 
 * It also includes utility functions for date parsing, formatting, and HTML escaping.
 */
const NeoGalleries = (() => {

  // ------------------------------------------------------------------
  // MARK: Config
  // ------------------------------------------------------------------
  const CONFIG = {
    GALLERY_JSON: "gallery.json",
    GALLERY_DIR: "gallery/",
    PROXY_URL: "https://neogalleries.flarowom.workers.dev/",
    DEFAULT_PAGE_SIZE: 20
  };

  // ------------------------------------------------------------------
  // MARK: Date utils
  // ------------------------------------------------------------------

  function parseCreateDate(str) {
    if (!str) return new Date(0);
    const p = str.split("-").map(Number);
    const [y, mo = 1, d = 1, h = 0, mi = 0] = p;
    return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
  }

  function parseFilterDate(str) {
    const p = str.split("-").map(Number);
    const y = p[0];
    const mo = p[1] ? p[1] - 1 : 0;
    const d = p[2] || 1;
    const h = p[3] || 0;
    const mi = p[4] || 0;
    return new Date(y, mo, d, h, mi);
  }

  function toInputLocal(str) {
    const p = (str || "").split("-");
    if (p.length < 5) return "";
    return `${p[0]}-${p[1]}-${p[2]}T${p[3]}:${p[4]}`;
  }

  function fromInputLocal(value) {
    return value.replace("T", "-").replace(":", "-");
  }

  function nowAsCreateDate() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }

  function formatDisplayDate(str) {
    const d = parseCreateDate(str);
    return d.toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });
  }

  function formatRFC822(date) {
    return date.toUTCString().replace("GMT", "+0000");
  }

  // ------------------------------------------------------------------
  // MARK: Safe text / HTML escaping
  // ------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ------------------------------------------------------------------
  // MARK: Data loading and sorting
  // ------------------------------------------------------------------

  async function loadGallery(baseUrl) {
    let url;
    if (baseUrl) {
      const sitename = baseUrl.replace(/^https?:\/\//, "").replace(/\.neocities\.org\/?$/, "");
      url = CONFIG.PROXY_URL.replace(/\/$/, "") + "/file/" + encodeURIComponent(sitename) + "/" + CONFIG.GALLERY_JSON;
    } else {
      url = CONFIG.GALLERY_JSON;
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Não foi possível carregar o gallery.json");
    const data = await res.json();
    if (!data.items) data.items = [];
    if (!data.site) data.site = {};
    return data;
  }

  function sortByDateDesc(items) {
    return items.slice().sort((a, b) => parseCreateDate(b.createdate) - parseCreateDate(a.createdate));
  }

  // ------------------------------------------------------------------
  // MARK: Children helpers
  // ------------------------------------------------------------------

  function allImages(item) {
    const main = item.filename;
    const children = (item.children || []).slice();
    return [main, ...children];
  }

  function hasMultipleImages(item) {
    return (item.children || []).length > 0;
  }

  function itemImgSrc(filename) {
    return CONFIG.GALLERY_DIR + filename;
  }

  // ------------------------------------------------------------------
  // MARK: Filters
  // ------------------------------------------------------------------

  function filterItems(items, params) {
    let result = items.slice();

    const tags = params.getAll("tag").flatMap(t => t.split(",")).map(t => t.trim()).filter(Boolean);
    if (tags.length) {
      result = result.filter(it => Array.isArray(it.tags) && it.tags.some(t => tags.includes(t)));
    }

    const notTags = params.getAll("not-tag").flatMap(t => t.split(",")).map(t => t.trim()).filter(Boolean);
    if (notTags.length) {
      result = result.filter(it => !Array.isArray(it.tags) || !it.tags.some(t => notTags.includes(t)));
    }

    const authors = params.getAll("author").flatMap(a => a.split(",")).map(a => a.trim()).filter(Boolean);
    if (authors.length) {
      result = result.filter(it => Array.isArray(it.authors) && it.authors.some(a => authors.includes(a)));
    }

    const after = params.get("after");
    if (after) {
      const afterDate = parseFilterDate(after);
      result = result.filter(it => parseCreateDate(it.createdate) >= afterDate);
    }

    const before = params.get("before");
    if (before) {
      const beforeDate = parseFilterDate(before);
      result = result.filter(it => parseCreateDate(it.createdate) < beforeDate);
    }

    return sortByDateDesc(result);
  }

  function searchItems(items, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items.slice();
    return items.filter(it => {
      const haystack = [
        it.filename, it.caption, it.alt, it.description,
        (it.tags || []).join(" "), (it.authors || []).join(" ")
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  function paginate(items, index, page) {
    const idx = Number(index);
    const pg = Number(page);

    if (!idx || idx <= 0) {
      return { pageItems: items, totalPages: 1, page: 1, pageSize: items.length || 1 };
    }
    const totalPages = Math.max(1, Math.ceil(items.length / idx));
    if (!pg || pg <= 0) {
      return { pageItems: items, totalPages, page: 0, pageSize: idx };
    }
    const p = Math.min(Math.max(pg, 1), totalPages);
    const start = (p - 1) * idx;
    return { pageItems: items.slice(start, start + idx), totalPages, page: p, pageSize: idx };
  }

  // ------------------------------------------------------------------
  // MARK: Rendering (cards)
  // ------------------------------------------------------------------

  function imgSrc(filename, baseUrl) {
    const path = CONFIG.GALLERY_DIR + filename;
    return baseUrl ? baseUrl.replace(/\/$/, "") + "/" + path : path;
  }

  function cardHTML(item, opts = {}) {
    const linkHref = opts.link !== false ? `view.html?item=${encodeURIComponent(item.filename)}` : null;
    const tagClasses = (item.tags || []).map(t => "tag-" + t.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "")).join(" ");
    const classes = "ng-card" + (tagClasses ? " " + tagClasses : "");
    const img = `<img src="${escapeHtml(imgSrc(item.filename))}" alt="${escapeHtml(item.alt || "")}" loading="lazy">`;
    if (linkHref) {
      return `<a class="${escapeHtml(classes)}" href="${escapeHtml(linkHref)}" target="_blank" rel="noopener" data-filename="${escapeHtml(item.filename)}">${img}</a>`;
    }
    return `<div class="${escapeHtml(classes)}" data-filename="${escapeHtml(item.filename)}">${img}</div>`;
  }

  function renderGrid(container, items, opts = {}) {
    if (!items.length) {
      container.innerHTML = `<p class="ng-empty">No item found</p>`;
      return;
    }
    container.innerHTML = items.map(it => cardHTML(it, opts)).join("");
  }

  // ------------------------------------------------------------------
  // MARK: RSS
  // ------------------------------------------------------------------

  function siteUrl(gallery, baseUrl) {
    const explicit = String(baseUrl || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");

    const fromData = String((gallery && gallery.site && gallery.site.link) || "").trim();
    if (fromData) return fromData.replace(/\/+$/, "");

    const here = String(window.location.origin || "").replace(/\/+$/, "");
    return here;
  }

  function viewUrl(item, base) {
    return base + "/view.html?item=" + encodeURIComponent(item.filename);
  }

  function tagUrl(tag, base) {
    return base + "/gallery.html?tag=" + encodeURIComponent(tag);
  }

  /** Absolute URL of an image served by the gallery. */
  function imageUrl(item, base) {
    return base + "/" + CONFIG.GALLERY_DIR + item.filename;
  }

  /**
   * HTML body of an RSS <description>. Readers render HTML but strip CSS
   * and <style>, so everything is inlined and self-contained.
   */
  function itemContentHTML(item, base) {
    const title = String(item.caption || "").trim() || item.filename;
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
    const view = viewUrl(item, base);
    const img = imageUrl(item, base);
    const alt = String(item.alt || "").trim() || title;

    const out = [];

    // title as a heading
    out.push(`<h1 style="font-size:1.4em;margin:0 0 .4em;font-weight:700;line-height:1.3">${escapeHtml(title)}</h1>`);

    // tags, each linking to the gallery filtered by that tag
    if (tags.length) {
      const links = tags.map(t => `<a href="${escapeHtml(tagUrl(t, base))}" style="color:#d4a574;text-decoration:none">[${escapeHtml(t)}]</a>`).join(" ");
      out.push(`<p style="margin:0 0 .8em">${links}</p>`);
    }

    // free-form description (already HTML from the author)
    const desc = String(item.description || "").trim();
    if (desc) {
      out.push(`<div style="margin:0 0 1em;line-height:1.5">${desc}</div>`);
    }

    // the image itself
    out.push(`<p style="margin:0 0 .8em"><img src="${escapeHtml(img)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;display:block;border:1px solid rgba(0,0,0,.2)"></p>`);

    // link back to the viewer page
    out.push(`<p style="margin:0"><a href="${escapeHtml(view)}" style="color:#d4a574">[View image]</a></p>`);

    return out.join("\n");
  }

  function buildRSS(gallery, baseUrl) {
    const site = gallery.site || {};
    const items = sortByDateDesc(gallery.items || []);
    const base = siteUrl(gallery, baseUrl);

    const rssItems = items.map(it => `
    <item>
      <title>${escapeHtml(it.caption)}</title>
      <link>${escapeHtml(viewUrl(it, base))}</link>
      <guid isPermaLink="false">${escapeHtml(it.filename)}</guid>
      <description><![CDATA[${itemContentHTML(it, base).replace(/]]>/g, "]]]]><![CDATA[>")}]]></description>
      <pubDate>${formatRFC822(parseCreateDate(it.createdate))}</pubDate>
    </item>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(site.title || "Unamed Gallery")}</title>
    <link>${escapeHtml(base + "/index.html")}</link>
    <description>${escapeHtml(site.description || "")}</description>
    <lastBuildDate>${formatRFC822(new Date())}</lastBuildDate>${rssItems}
  </channel>
</rss>
`;
  }

  // ------------------------------------------------------------------
  // MARK: Neocities API Client
  // ------------------------------------------------------------------

  const NeoCitiesAPI = (() => {

    function authHeader(auth) {
      if (auth.apiKey) return { Authorization: "Bearer " + auth.apiKey };
      return { Authorization: "Basic " + btoa(`${auth.user}:${auth.pass}`) };
    }

    function apiUrl(path) {
      if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes("SEU-WORKER")) {
        throw new Error("Configure PROXY_URL in neogalleries.js (see proxy-worker/worker.js) before using the admin panel.");
      }
      return CONFIG.PROXY_URL.replace(/\/$/, "") + "/api/" + path;
    }

    async function call(path, auth, options = {}) {
      const res = await fetch(apiUrl(path), {
        method: options.method || "GET",
        headers: { ...authHeader(auth), ...(options.headers || {}) },
        body: options.body
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* no JSON response */ }
      if (!res.ok || data.result === "error") {
        throw new Error(data.message || `Neocities API error (HTTP ${res.status})`);
      }
      return data;
    }

    function getApiKey(user, pass) {
      return call("key", { user, pass }).then(d => d.api_key);
    }

    function info(auth) {
      return call("info", auth);
    }

    function list(auth, path) {
      return call("list" + (path ? "?path=" + encodeURIComponent(path) : ""), auth);
    }

    function createDirectory(auth, path) {
      const body = new URLSearchParams();
      body.set("path", path);
      return call("create_directory", auth, { method: "POST", body });
    }

    function deleteFiles(auth, filenames) {
      const body = new URLSearchParams();
      filenames.forEach(f => body.append("filenames[]", f));
      return call("delete", auth, { method: "POST", body });
    }

    function upload(auth, files) {
      const form = new FormData();
      Object.entries(files).forEach(([name, blob]) => {
        form.append(name, blob, name.split("/").pop());
      });
      return call("upload", auth, { method: "POST", body: form });
    }

    return { getApiKey, info, list, createDirectory, deleteFiles, upload };
  })();

  function openAdminWindow() {
    window.open('https://flarom.github.io/neogalleries-admin', '_blank', 'location=yes,height=570,width=520,scrollbars=yes,status=yes');
  }

  // ------------------------------------------------------------------
  return {
    CONFIG,
    parseCreateDate, parseFilterDate, toInputLocal, fromInputLocal,
    nowAsCreateDate, formatDisplayDate, formatRFC822,
    escapeHtml, loadGallery, sortByDateDesc, filterItems, searchItems, paginate,
    imgSrc, cardHTML, renderGrid, allImages, hasMultipleImages, itemImgSrc,
    siteUrl, viewUrl, tagUrl, imageUrl, itemContentHTML, buildRSS, NeoCitiesAPI, openAdminWindow
  };
})();
