/* =========================================================
   CineScope — script.js
   ---------------------------------------------------------
   1. Config & constants
   2. State
   3. localStorage helpers            (MP4 · Local Storage)
   4. API layer: fetch + async/await  (MP4 · API Integration)
   5. Filtering / sorting logic       (MP3 · arrays & methods)
   6. Rendering                       (MP3 · DOM manipulation)
   7. Library (watchlist / favorites / watched / ratings)
   8. Details modal
   9. Event listeners                 (MP3 · Event handling)
   10. Init
   ========================================================= */

"use strict";

/* ---------- 1. Config ---------- */
const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";

// Genre ids are fixed in TMDB, so no extra request is needed.
const GENRES = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" }, { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" }, { id: 80, name: "Crime" }, { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" }, { id: 10751, name: "Family" }, { id: 14, name: "Fantasy" },
  { id: 36, name: "History" }, { id: 27, name: "Horror" }, { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" }, { id: 10749, name: "Romance" }, { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" }, { id: 10752, name: "War" }, { id: 37, name: "Western" },
];
const GENRE_NAME = Object.fromEntries(GENRES.map((g) => [g.id, g.name]));

const API_VIEWS = {
  trending: { path: "/trending/movie/week", title: "Trending This Week" },
  popular: { path: "/movie/popular", title: "Popular" },
  top_rated: { path: "/movie/top_rated", title: "Top Rated" },
  now_playing: { path: "/movie/now_playing", title: "Now Playing" },
};
const LIB_VIEWS = {
  watchlist: { flag: "watch", title: "My Watchlist", empty: "Your watchlist is empty", tip: "Tap ＋ on any movie to save it for later." },
  favorites: { flag: "fav", title: "My Favorites", empty: "No favorites yet", tip: "Tap ♥ on movies you love." },
  watched: { flag: "seen", title: "Watched", empty: "Nothing marked as watched", tip: "Open a movie and press “Watched”, or give it a star rating." },
};
const LS = { library: "cinescope.library", prefs: "cinescope.prefs", recent: "cinescope.recent", key: "cinescope.apiKey" };

/* ---------- 2. State ---------- */
const state = {
  view: "trending",
  query: "",
  genreId: 0,
  minRating: 0,
  decade: "all",
  sortBy: "default",
  page: 1,
  totalPages: 0,
  totalResults: 0,
  movies: [],
  loading: false,
  error: null,         // { message, status }
  library: {},         // { [id]: movie snapshot + { fav, watch, seen, rating, addedAt } }
  recent: [],          // recent searches
  modalId: null,
};
const detailsCache = new Map();
let requestToken = 0;
let controller = null;

const $ = (s) => document.querySelector(s);
const els = {
  app: $("#app"), setup: $("#setup"), keyForm: $("#keyForm"), keyInput: $("#keyInput"), keyMsg: $("#keyMsg"), keyBtn: $("#keyBtn"),
  searchForm: $("#searchForm"), searchInput: $("#searchInput"), clearSearch: $("#clearSearch"), recentBox: $("#recentBox"),
  hero: $("#hero"), apiTabs: $("#apiTabs"), libTabs: $("#libTabs"), title: $("#title"), count: $("#count"),
  chips: $("#genreChips"), minRating: $("#minRating"), ratingLabel: $("#ratingLabel"), decade: $("#decade"),
  sortBy: $("#sortBy"), resetFilters: $("#resetFilters"), libStats: $("#libStats"),
  status: $("#status"), grid: $("#grid"), pager: $("#pager"), loadMore: $("#loadMore"),
  modal: $("#modal"), modalBox: $("#modalBox"), toast: $("#toast"), logo: $("#logo"),
};

const isLib = () => state.view in LIB_VIEWS;

/* ---------- 3. localStorage ---------- */
function loadJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { showToast("⚠️ Could not save — browser storage unavailable"); }
}
const saveLibrary = () => saveJSON(LS.library, state.library);
const savePrefs = () => saveJSON(LS.prefs, {
  view: state.view, genreId: state.genreId, minRating: state.minRating, decade: state.decade, sortBy: state.sortBy,
});
function getKey() {
  try { const k = localStorage.getItem(LS.key); if (k) return k; } catch { /* ignore */ }
  return typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY.trim() : "";
}

/* ---------- 4. API layer ---------- */
/** Wrapper around fetch(): adds the key, parses JSON, converts HTTP errors into Error objects. */
async function tmdb(path, params = {}, signal) {
  const key = getKey();
  const url = new URL(API + path);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const options = {};
  // v3 keys are 32 chars; long "Read Access Tokens" (v4) go in a header instead
  if (key.length > 60) options.headers = { Authorization: `Bearer ${key}` };
  else url.searchParams.set("api_key", key);

  // Give up after 15s so a blocked/slow network never leaves the app "loading" forever
  const timer = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => { timedOut = true; timer.abort(); }, 15000);
  if (signal) signal.addEventListener("abort", () => timer.abort());
  options.signal = timer.signal;

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { const j = await res.json(); if (j.status_message) message = j.status_message; } catch { /* no body */ }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError" && timedOut) {
      throw new Error("TMDB took too long to respond. Your network may be blocking api.themoviedb.org — try a VPN or set DNS to 1.1.1.1.");
    }
    if (err.name === "TypeError") { // fetch() network failure
      throw new Error("Couldn’t reach TMDB (api.themoviedb.org). Check your internet, or try a VPN / DNS 1.1.1.1.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalize(m) {
  return {
    id: m.id,
    title: m.title || m.original_title || "Untitled",
    release: m.release_date || "",
    year: m.release_date ? m.release_date.slice(0, 4) : "",
    poster: m.poster_path || null,
    backdrop: m.backdrop_path || null,
    vote: m.vote_average || 0,
    votes: m.vote_count || 0,
    popularity: m.popularity || 0,
    overview: m.overview || "",
    genreIds: m.genre_ids || (m.genres || []).map((g) => g.id),
  };
}

/** Loads a page of movies for the current tab / search. */
async function fetchMovies(append = false) {
  const myToken = ++requestToken;
  if (controller) controller.abort();
  controller = new AbortController();

  state.loading = true;
  state.error = null;
  if (!append) { state.movies = []; state.page = 1; }
  render();

  const hasQuery = state.query.trim().length > 0;
  const path = hasQuery ? "/search/movie" : API_VIEWS[state.view].path;
  const params = { page: state.page };
  if (hasQuery) { params.query = state.query.trim(); params.include_adult = "false"; }

  try {
    const data = await tmdb(path, params, controller.signal);
    if (myToken !== requestToken) return;
    const fresh = data.results.map(normalize);
    const known = new Set(state.movies.map((m) => m.id));
    state.movies = [...state.movies, ...fresh.filter((m) => !known.has(m.id))];
    state.totalPages = data.total_pages;
    state.totalResults = data.total_results;
  } catch (err) {
    if (err.name === "AbortError" || myToken !== requestToken) return;
    state.error = {
      status: err.status,
      message: err.status === 401 ? "TMDB rejected your API key. Please enter a valid key."
        : navigator.onLine ? err.message : "You appear to be offline. Check your connection.",
    };
    if (append) state.page = Math.max(1, state.page - 1);
  } finally {
    if (myToken === requestToken) { state.loading = false; render(); }
  }
}

/* ---------- 5. Filtering & sorting ---------- */
function sourceList() {
  if (!isLib()) return state.movies;
  const { flag } = LIB_VIEWS[state.view];
  return Object.values(state.library).filter((e) => e[flag]).sort((a, b) => b.addedAt - a.addedAt);
}

function getVisible() {
  const term = isLib() ? state.query.trim().toLowerCase() : ""; // API views search on the server instead
  const inDecade = (m) => {
    if (state.decade === "all") return true;
    const y = Number(m.year);
    if (!y) return false;
    return state.decade === "old" ? y < 1980 : y >= Number(state.decade) && y < Number(state.decade) + 10;
  };
  const sorters = {
    default: null,
    rating: (a, b) => b.vote - a.vote,
    popularity: (a, b) => b.popularity - a.popularity,
    newest: (a, b) => b.release.localeCompare(a.release),
    oldest: (a, b) => (a.release || "9").localeCompare(b.release || "9"),
    title: (a, b) => a.title.localeCompare(b.title),
  };

  const list = sourceList()
    .filter((m) => !term || m.title.toLowerCase().includes(term))
    .filter((m) => !state.genreId || m.genreIds.includes(state.genreId))
    .filter((m) => m.vote >= state.minRating)
    .filter(inDecade);

  return sorters[state.sortBy] ? [...list].sort(sorters[state.sortBy]) : list;
}

const filtersActive = () => state.genreId || state.minRating > 0 || state.decade !== "all" || state.sortBy !== "default";
const findMovie = (id) => state.movies.find((m) => m.id === id) || state.library[id] || null;

function fmtRuntime(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
const starsText = (n) => "★".repeat(n) + "☆".repeat(5 - n);

/* ---------- 6. Rendering ---------- */
/** Small element builder. Uses textContent/text nodes, so API data is never injected as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function highlight(text, term) {
  const t = term.trim().toLowerCase();
  if (!t) return text;
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  let i = 0;
  for (;;) {
    const at = lower.indexOf(t, i);
    if (at === -1) break;
    frag.append(text.slice(i, at), h("mark", {}, text.slice(at, at + t.length)));
    i = at + t.length;
  }
  frag.append(text.slice(i));
  return frag;
}

function render() {
  renderNav();
  renderHero();
  renderChips();
  renderGrid();
}

function renderNav() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view && !(state.query && !isLib())));
  const q = state.query.trim();
  els.title.textContent = isLib() ? LIB_VIEWS[state.view].title : q ? `Results for “${q}”` : API_VIEWS[state.view].title;
  els.clearSearch.classList.toggle("hidden", !els.searchInput.value);
  els.resetFilters.classList.toggle("hidden", !filtersActive());
  ["watchlist", "favorites", "watched"].forEach((v) => {
    const flag = LIB_VIEWS[v].flag;
    document.getElementById(`n-${v}`).textContent = Object.values(state.library).filter((e) => e[flag]).length;
  });
}

function renderChips() {
  els.chips.replaceChildren(
    ...GENRES.map((g) => h("button", { class: "chip" + (state.genreId === g.id ? " active" : ""), textContent: g.name, dataset: { genre: g.id } }))
  );
}

function renderHero() {
  const pick = !isLib() && !state.query.trim() ? state.movies.find((m) => m.backdrop && m.overview) : null;
  if (!pick) { els.hero.classList.add("hidden"); return; }
  els.hero.classList.remove("hidden");
  els.hero.style.backgroundImage = `url(${IMG}w1280${pick.backdrop})`;
  const inWl = state.library[pick.id]?.watch;
  els.hero.replaceChildren(
    h("div", { class: "hero-body" },
      h("small", {}, "Featured"),
      h("h2", {}, pick.title),
      h("p", {}, pick.overview),
      h("div", { class: "row" },
        h("button", { class: "btn primary", textContent: "ⓘ More info", dataset: { open: pick.id } }),
        h("button", { class: "btn" + (inWl ? " on" : ""), textContent: inWl ? "✓ In watchlist" : "＋ Watchlist", dataset: { flag: "watch", id: pick.id } }),
        h("span", { class: "fact star" }, `⭐ ${pick.vote.toFixed(1)}`),
        pick.year ? h("span", { class: "fact" }, pick.year) : null
      )
    )
  );
}

function renderGrid() {
  els.status.replaceChildren();
  els.grid.replaceChildren();
  els.pager.classList.add("hidden");
  els.libStats.classList.add("hidden");
  const lib = isLib();

  // Loading state
  if (state.loading && !state.movies.length && !lib) {
    els.count.textContent = "";
    els.grid.append(...Array.from({ length: 12 }, () => h("div", { class: "skel" })));
    return;
  }

  // Error state
  if (state.error && !lib) {
    els.count.textContent = "";
    els.status.append(
      h("div", { class: "box err" },
        h("span", { class: "emoji" }, "⚠️"),
        h("h3", {}, "Couldn’t load movies"),
        h("p", {}, state.error.message),
        h("button", { class: "btn primary", id: "retryBtn", textContent: state.error.status === 401 ? "Enter API key" : "Try again" })
      )
    );
    if (!state.movies.length) return;
  }

  const source = sourceList();

  // Empty state: nothing at all
  if (!state.loading && !state.error && source.length === 0) {
    els.count.textContent = "0 movies";
    els.status.append(
      lib
        ? h("div", { class: "box" }, h("span", { class: "emoji" }, "🍿"), h("h3", {}, LIB_VIEWS[state.view].empty), h("p", {}, LIB_VIEWS[state.view].tip),
            h("button", { class: "btn primary", textContent: "Browse movies", dataset: { view: "trending" } }))
        : h("div", { class: "box" }, h("span", { class: "emoji" }, "🔍"), h("h3", {}, "No movies found"),
            h("p", {}, state.query ? `Nothing matched “${state.query}”. Check the spelling or try another title.` : "Nothing to show here."),
            state.query ? h("button", { class: "btn primary", id: "clearQueryBtn", textContent: "Clear search" }) : null)
    );
    return;
  }

  if (lib) renderLibStats();

  const visible = getVisible();
  els.count.textContent = lib
    ? `${visible.length} of ${source.length}`
    : `${visible.length} shown · ${state.totalResults.toLocaleString()} results`;

  if (!visible.length) {
    els.status.append(
      h("div", { class: "box" }, h("span", { class: "emoji" }, "🧹"), h("h3", {}, "No movies match your filters"),
        h("p", {}, "Try a different genre, lower the rating, or reset the filters."),
        h("button", { class: "btn primary", id: "resetBtn2", textContent: "Reset filters" }))
    );
  } else {
    els.grid.append(...visible.map((m, i) => movieCard(m, i)));
  }

  if (!lib) {
    els.pager.classList.toggle("hidden", state.page >= state.totalPages);
    els.loadMore.disabled = state.loading;
    els.loadMore.textContent = state.loading ? "Loading…" : "Load more movies";
  }
}

function movieCard(m, index) {
  const entry = state.library[m.id] || {};
  const vclass = m.vote >= 7 ? "hi" : m.vote >= 5 ? "mid" : m.vote > 0 ? "lo" : "na";
  const genres = m.genreIds.slice(0, 2).map((id) => GENRE_NAME[id]).filter(Boolean).join(" · ");

  return h("article", { class: "card", tabIndex: 0, dataset: { id: m.id }, style: `animation-delay:${Math.min(index, 12) * 25}ms` },
    m.poster
      ? h("img", { class: "poster", src: `${IMG}w342${m.poster}`, alt: `${m.title} poster`, loading: "lazy" })
      : h("div", { class: "noposter" }, h("div", {}, h("span", {}, "🎬"), "No poster")),
    h("span", { class: `badge ${vclass}` }, m.vote > 0 ? `★ ${m.vote.toFixed(1)}` : "NR"),
    h("div", { class: "flags" },
      h("button", { class: "flag fav" + (entry.fav ? " on" : ""), textContent: "♥", title: entry.fav ? "Remove from favorites" : "Add to favorites", dataset: { flag: "fav", id: m.id } }),
      h("button", { class: "flag wl" + (entry.watch ? " on" : ""), textContent: entry.watch ? "✓" : "＋", title: entry.watch ? "Remove from watchlist" : "Add to watchlist", dataset: { flag: "watch", id: m.id } })
    ),
    h("div", { class: "info" },
      h("h3", {}, highlight(m.title, state.query)),
      h("p", {}, [m.year, genres].filter(Boolean).join(" · ")),
      entry.rating ? h("div", { class: "mine", title: "Your rating" }, starsText(entry.rating)) : null
    )
  );
}

function renderLibStats() {
  const all = Object.values(state.library);
  const rated = all.filter((e) => e.rating > 0);
  const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : "–";
  els.libStats.classList.remove("hidden");
  els.libStats.replaceChildren(
    ...[
      [all.filter((e) => e.watch).length, "In watchlist"],
      [all.filter((e) => e.fav).length, "Favorites"],
      [all.filter((e) => e.seen).length, "Watched"],
      [avg, "Your avg rating (of 5)"],
    ].map(([n, l]) => h("div", { class: "pill" }, h("b", {}, String(n)), l))
  );
}

/* ---------- 7. Library ---------- */
function toggleFlag(movie, flag) {
  const base = state.library[movie.id] || {
    ...movie, fav: false, watch: false, seen: false, rating: 0, addedAt: Date.now(),
  };
  base[flag] = !base[flag];
  if (flag === "seen" && base.seen) base.watch = false;   // watched → no longer "to watch"
  commitEntry(base);
  const names = { fav: "favorites", watch: "watchlist", seen: "watched" };
  showToast(base[flag] ? `Added to ${names[flag]}` : `Removed from ${names[flag]}`);
}

function setRating(movie, n) {
  const base = state.library[movie.id] || {
    ...movie, fav: false, watch: false, seen: false, rating: 0, addedAt: Date.now(),
  };
  base.rating = base.rating === n ? 0 : n;               // click same star again to clear
  if (base.rating) { base.seen = true; base.watch = false; }
  commitEntry(base);
  showToast(base.rating ? `You rated it ${base.rating}/5` : "Rating cleared");
}

function commitEntry(entry) {
  if (!entry.fav && !entry.watch && !entry.seen && !entry.rating) delete state.library[entry.id];
  else state.library[entry.id] = entry;
  saveLibrary();
  render();
  if (state.modalId) renderModal();
}

/* ---------- 8. Details modal ---------- */
async function openModal(id) {
  state.modalId = id;
  els.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderModal();
  if (detailsCache.has(id)) return;
  try {
    const d = await tmdb(`/movie/${id}`, { append_to_response: "videos,credits" });
    detailsCache.set(id, d);
  } catch (err) {
    detailsCache.set(id, { error: err.message });
  }
  if (state.modalId === id) renderModal();
}

function closeModal() {
  state.modalId = null;
  els.modal.classList.add("hidden");
  els.modalBox.replaceChildren();
  document.body.style.overflow = "";
}

function renderModal() {
  const id = state.modalId;
  const base = findMovie(id);
  if (!base) return closeModal();
  const d = detailsCache.get(id);
  const entry = state.library[id] || {};
  const closeBtn = h("button", { class: "m-close", textContent: "✕", dataset: { act: "close" }, "aria-label": "Close" });

  if (d && d.error) {
    els.modalBox.replaceChildren(closeBtn,
      h("div", { class: "m-loading" }, h("span", { style: "font-size:2rem;display:block" }, "⚠️"), h("p", {}, d.error),
        h("button", { class: "btn primary", textContent: "Try again", dataset: { act: "retryModal" } })));
    return;
  }

  const info = d || {};
  const backdrop = info.backdrop_path || base.backdrop;
  const poster = info.poster_path || base.poster;
  const genres = (info.genres || base.genreIds.map((gid) => ({ name: GENRE_NAME[gid] }))).map((g) => g.name).filter(Boolean);
  const cast = (info.credits?.cast || []).slice(0, 12);
  const directors = (info.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name);
  const trailer = (info.videos?.results || []).find((v) => v.site === "YouTube" && v.type === "Trailer")
    || (info.videos?.results || []).find((v) => v.site === "YouTube");

  els.modalBox.replaceChildren(
    closeBtn,
    h("div", { class: "m-top", style: backdrop ? `background-image:url(${IMG}w1280${backdrop})` : "min-height:120px" }),
    h("div", { class: "m-body" },
      poster
        ? h("img", { class: "m-poster", src: `${IMG}w500${poster}`, alt: `${base.title} poster` })
        : h("div", { class: "noposter m-poster" }, h("div", {}, h("span", {}, "🎬"), "No poster")),
      h("div", { class: "m-main" },
        h("h2", {}, base.title, base.year ? ` (${base.year})` : ""),
        info.tagline ? h("p", { class: "tagline" }, info.tagline) : null,
        h("div", { class: "facts" },
          h("span", { class: "fact star" }, `⭐ ${(info.vote_average ?? base.vote).toFixed(1)} / 10`),
          info.runtime ? h("span", { class: "fact" }, fmtRuntime(info.runtime)) : null,
          info.original_language ? h("span", { class: "fact" }, info.original_language.toUpperCase()) : null,
          ...genres.map((g) => h("span", { class: "fact" }, g)),
          directors.length ? h("span", { class: "fact" }, `🎬 ${directors.slice(0, 2).join(", ")}`) : null
        ),
        h("p", { class: "overview" }, info.overview || base.overview || "No synopsis available."),
        h("div", { class: "m-actions" },
          h("button", { class: "btn fav" + (entry.fav ? " on" : ""), textContent: entry.fav ? "♥ Favorite" : "♡ Favorite", dataset: { act: "flag", flag: "fav" } }),
          h("button", { class: "btn" + (entry.watch ? " on" : ""), textContent: entry.watch ? "✓ In watchlist" : "＋ Watchlist", dataset: { act: "flag", flag: "watch" } }),
          h("button", { class: "btn" + (entry.seen ? " on" : ""), textContent: entry.seen ? "✔ Watched" : "Mark watched", dataset: { act: "flag", flag: "seen" } }),
          trailer ? h("button", { class: "btn primary", textContent: "▶ Trailer", dataset: { act: "trailer", key: trailer.key } }) : null
        ),
        h("div", { class: "rate" }, "Your rating:",
          h("span", { class: "stars" },
            ...[1, 2, 3, 4, 5].map((n) => h("button", { class: n <= (entry.rating || 0) ? "on" : "", textContent: "★", title: `${n} star${n > 1 ? "s" : ""}`, dataset: { act: "rate", n } })))
        ),
        h("div", { id: "trailerSlot" }),
        !d ? h("div", { class: "m-loading" }, "Loading cast & details…") : null,
        cast.length ? h("h4", {}, "Top cast") : null,
        cast.length
          ? h("div", { class: "cast" }, ...cast.map((p) =>
              h("div", { class: "person" },
                p.profile_path ? h("img", { src: `${IMG}w185${p.profile_path}`, alt: p.name, loading: "lazy" }) : h("div", { class: "ph" }, "👤"),
                h("b", {}, p.name), h("span", {}, p.character || ""))))
          : null
      )
    )
  );
}

/* ---------- Misc ---------- */
let toastTimer;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function pushRecent(q) {
  const t = q.trim();
  if (t.length < 2) return;
  state.recent = [t, ...state.recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
  saveJSON(LS.recent, state.recent);
}
function renderRecent() {
  if (els.searchInput.value || !state.recent.length) return els.recentBox.classList.add("hidden");
  els.recentBox.classList.remove("hidden");
  els.recentBox.replaceChildren(h("small", {}, "Recent searches"),
    ...state.recent.map((q) => h("button", { type: "button", textContent: q, dataset: { recent: q } })));
}

function runSearch(q) {
  state.query = q;
  els.searchInput.value = q;
  pushRecent(q);
  els.recentBox.classList.add("hidden");
  if (isLib()) render();          // watchlist etc.: filter locally
  else fetchMovies(false);        // otherwise ask the API
}

function setView(view) {
  state.view = view;
  if (!isLib()) { state.query = ""; els.searchInput.value = ""; }
  savePrefs();
  if (isLib()) { requestToken++; if (controller) controller.abort(); state.loading = false; state.error = null; render(); }
  else fetchMovies(false);
}

function resetFilters() {
  Object.assign(state, { genreId: 0, minRating: 0, decade: "all", sortBy: "default" });
  els.minRating.value = 0; els.ratingLabel.textContent = "0";
  els.decade.value = "all"; els.sortBy.value = "default";
  savePrefs();
  render();
}

/* API key setup */
function showSetup(msg = "") {
  els.app.classList.add("hidden");
  els.setup.classList.remove("hidden");
  els.keyMsg.textContent = msg;
  els.keyInput.value = "";
  els.keyInput.focus();
}
function hideSetup() {
  els.setup.classList.add("hidden");
  els.app.classList.remove("hidden");
}

/* ---------- 9. Event listeners ---------- */
// Tabs (API + library)
document.querySelector(".nav").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (b) setView(b.dataset.view);
});
els.logo.addEventListener("click", (e) => { e.preventDefault(); setView("trending"); window.scrollTo({ top: 0, behavior: "smooth" }); });

// Genre chips (client-side filter)
els.chips.addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  const id = Number(c.dataset.genre);
  state.genreId = state.genreId === id ? 0 : id;
  savePrefs();
  render();
});

// Search
const debounced = debounce((v) => runSearch(v), 500);
els.searchInput.addEventListener("input", (e) => {
  els.clearSearch.classList.toggle("hidden", !e.target.value);
  renderRecent();
  debounced(e.target.value);
});
els.searchInput.addEventListener("focus", renderRecent);
els.searchInput.addEventListener("blur", () => setTimeout(() => els.recentBox.classList.add("hidden"), 150));
els.searchForm.addEventListener("submit", (e) => { e.preventDefault(); runSearch(els.searchInput.value); });
els.clearSearch.addEventListener("click", () => { runSearch(""); els.searchInput.focus(); });
els.recentBox.addEventListener("mousedown", (e) => {
  const b = e.target.closest("[data-recent]");
  if (b) { e.preventDefault(); runSearch(b.dataset.recent); }
});

// Filters
els.minRating.addEventListener("input", (e) => {
  state.minRating = Number(e.target.value);
  els.ratingLabel.textContent = state.minRating;
  savePrefs(); render();
});
els.decade.addEventListener("change", (e) => { state.decade = e.target.value; savePrefs(); render(); });
els.sortBy.addEventListener("change", (e) => { state.sortBy = e.target.value; savePrefs(); render(); });
els.resetFilters.addEventListener("click", resetFilters);

// Load more
els.loadMore.addEventListener("click", () => {
  if (state.loading) return;
  state.page += 1;
  fetchMovies(true);
});

// Grid + hero + status (event delegation)
function handleMovieClick(e) {
  const flagBtn = e.target.closest("[data-flag]");
  if (flagBtn) {
    e.stopPropagation();
    const m = findMovie(Number(flagBtn.dataset.id));
    if (m) toggleFlag(m, flagBtn.dataset.flag);
    return;
  }
  const openBtn = e.target.closest("[data-open]");
  if (openBtn) return openModal(Number(openBtn.dataset.open));
  const card = e.target.closest(".card");
  if (card) openModal(Number(card.dataset.id));
}
els.grid.addEventListener("click", handleMovieClick);
els.hero.addEventListener("click", handleMovieClick);
els.grid.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("card")) openModal(Number(e.target.dataset.id));
});
els.status.addEventListener("click", (e) => {
  const id = e.target.id;
  if (id === "retryBtn") {
    if (state.error?.status === 401) return showSetup("Your previous key was rejected. Paste a new one.");
    if (state.movies.length) { state.page += 1; fetchMovies(true); } else fetchMovies(false);
  }
  if (id === "clearQueryBtn") runSearch("");
  if (id === "resetBtn2") resetFilters();
  const v = e.target.closest("[data-view]");
  if (v) setView(v.dataset.view);
});

// Modal
els.modal.addEventListener("click", (e) => {
  if (e.target === els.modal) return closeModal();
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const movie = findMovie(state.modalId);
  switch (t.dataset.act) {
    case "close": closeModal(); break;
    case "flag": if (movie) toggleFlag(movie, t.dataset.flag); break;
    case "rate": if (movie) setRating(movie, Number(t.dataset.n)); break;
    case "retryModal": detailsCache.delete(state.modalId); openModal(state.modalId); break;
    case "trailer": {
      const slot = document.getElementById("trailerSlot");
      slot.replaceChildren(h("iframe", {
        class: "trailer", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.dataset.key)}?autoplay=1&rel=0`,
        allow: "autoplay; encrypted-media; picture-in-picture", allowFullscreen: true, title: "Trailer",
      }));
      slot.scrollIntoView({ behavior: "smooth", block: "center" });
      break;
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.modalId) closeModal();
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName) && !state.modalId) {
    e.preventDefault(); els.searchInput.focus();
  }
});
window.addEventListener("online", () => { if (state.error && !isLib()) fetchMovies(false); });

// API key form
els.keyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = els.keyInput.value.trim();
  if (!key) { els.keyMsg.textContent = "Please paste your key first."; return; }
  els.keyMsg.textContent = "Checking key…";
  try {
    // Temporarily save so tmdb() can use it; remove again if invalid
    localStorage.setItem(LS.key, key);
    await tmdb("/configuration");
    hideSetup();
    fetchMovies(false);
  } catch (err) {
    try { localStorage.removeItem(LS.key); } catch { /* ignore */ }
    els.keyMsg.textContent = err.status === 401 ? "TMDB rejected that key. Double-check it and try again." : `Couldn’t verify key: ${err.message}`;
  }
});
els.keyBtn.addEventListener("click", () => {
  if (!els.setup.classList.contains("hidden") && getKey()) hideSetup();
  else showSetup();
});

/* ---------- 10. Init ---------- */
function init() {
  state.library = loadJSON(LS.library, {});
  state.recent = loadJSON(LS.recent, []);
  const p = loadJSON(LS.prefs, {});
  if (p.view in API_VIEWS || p.view in LIB_VIEWS) state.view = p.view;
  state.genreId = Number(p.genreId) || 0;
  state.minRating = Number(p.minRating) || 0;
  if (["all", "2020", "2010", "2000", "1990", "1980", "old"].includes(p.decade)) state.decade = p.decade;
  if (["default", "rating", "popularity", "newest", "oldest", "title"].includes(p.sortBy)) state.sortBy = p.sortBy;

  els.minRating.value = state.minRating;
  els.ratingLabel.textContent = state.minRating;
  els.decade.value = state.decade;
  els.sortBy.value = state.sortBy;

  if (!getKey()) {
    render();
    showSetup();
    return;
  }
  if (isLib()) render();
  else fetchMovies(false);
}

init();
