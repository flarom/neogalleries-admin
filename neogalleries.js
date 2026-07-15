/**
 * neogalleries.js
 * -----------------------------------------------------------------------
 * Cérebro compartilhado do site: carrega o gallery.json, filtra, ordena,
 * pagina, renderiza os cards, gera o rss.xml e fala com a API do
 * Neocities (usado só pelo admin.html).
 *
 * Inclua este arquivo em toda página com:
 *   <script src="neogalleries.js"></script>
 * -----------------------------------------------------------------------
 */

const NeoGalleries = (() => {

  // ------------------------------------------------------------------
  // config
  // ------------------------------------------------------------------
  const CONFIG = {
    GALLERY_JSON: "gallery.json",
    GALLERY_DIR: "gallery/",
    SITE_URL: window.location.origin || "https://flarom.neocities.org",
    PROXY_URL: "https://neogalleries.flarowom.workers.dev/",
    DEFAULT_PAGE_SIZE: 20
  };

  // ------------------------------------------------------------------
  // date utilities
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
    return d.toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" });
  }

  function formatRFC822(date) {
    return date.toUTCString().replace("GMT", "+0000");
  }

  // ------------------------------------------------------------------
  // secure text
  // ------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ------------------------------------------------------------------
  // data loading
  // ------------------------------------------------------------------

  async function loadGallery() {
    const res = await fetch(CONFIG.GALLERY_JSON, { cache: "no-store" });
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
  // helper children
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
  // filters
  // ------------------------------------------------------------------

  function filterItems(items, params) {
    let result = items.slice();

    const tags = params.getAll("tag").flatMap(t => t.split(",")).map(t => t.trim()).filter(Boolean);
    if (tags.length) {
      result = result.filter(it => Array.isArray(it.tags) && it.tags.some(t => tags.includes(t)));
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
  // render cards
  // ------------------------------------------------------------------

  function imgSrc(filename) {
    return CONFIG.GALLERY_DIR + filename;
  }

  function cardHTML(item, opts = {}) {
    const linkHref = opts.link !== false ? `viewer.html?item=${encodeURIComponent(item.filename)}` : null;
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
  // rss
  // ------------------------------------------------------------------

  function buildRSS(gallery) {
    const site = gallery.site || {};
    const items = sortByDateDesc(gallery.items || []);
    const base = CONFIG.SITE_URL.replace(/\/$/, "");

    const rssItems = items.map(it => `
    <item>
      <title>${escapeHtml(it.caption)}</title>
      <link>${escapeHtml(base + "/viewer.html?item=" + encodeURIComponent(it.filename))}</link>
      <guid isPermaLink="false">${escapeHtml(it.filename)}</guid>
      <description><![CDATA[${it.description || ""}]]></description>
      <pubDate>${formatRFC822(parseCreateDate(it.createdate))}</pubDate>
    </item>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(site.title || "Galeria")}</title>
    <link>${escapeHtml(base + "/index.html")}</link>
    <description>${escapeHtml(site.description || "")}</description>
    <lastBuildDate>${formatRFC822(new Date())}</lastBuildDate>${rssItems}
  </channel>
</rss>
`;
  }

  // ------------------------------------------------------------------
  // neocities api client
  // ------------------------------------------------------------------

  const NeoCitiesAPI = (() => {

    function authHeader(auth) {
      if (auth.apiKey) return { Authorization: "Bearer " + auth.apiKey };
      return { Authorization: "Basic " + btoa(`${auth.user}:${auth.pass}`) };
    }

    function apiUrl(path) {
      if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes("SEU-WORKER")) {
        throw new Error("Configure PROXY_URL em neogalleries.js (veja proxy-worker/worker.js) antes de usar o painel admin.");
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
      try { data = await res.json(); } catch (_) { /* resposta sem corpo JSON */ }
      if (!res.ok || data.result === "error") {
        throw new Error(data.message || `Erro na API do Neocities (HTTP ${res.status})`);
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

  // ------------------------------------------------------------------
  return {
    CONFIG,
    parseCreateDate, parseFilterDate, toInputLocal, fromInputLocal,
    nowAsCreateDate, formatDisplayDate, formatRFC822,
    escapeHtml, loadGallery, sortByDateDesc, filterItems, paginate,
    imgSrc, cardHTML, renderGrid, allImages, hasMultipleImages, itemImgSrc,
    buildRSS, NeoCitiesAPI
  };
})();
