# CineScope — Movie Search & Watchlist App

**Course:** CSE-2340 Software Development I · **Assessment:** Mini Project 3–4 (MP3 + MP4)
**Department of CSE, International Islamic University Chittagong**

CineScope is an interactive, API-driven movie application built with plain **HTML, CSS and JavaScript** (no frameworks, no build step). It loads live data from **The Movie Database (TMDB)**, lets you search and filter movies, view details with cast and trailer, and keep a personal watchlist, favorites, watched list and star ratings that persist after refresh.

## 1. Get a free TMDB API key (2 minutes)

1. Create a free account at <https://www.themoviedb.org/signup>
2. Go to **Settings → API** (<https://www.themoviedb.org/settings/api>) and request a *Developer* key
3. Copy the **API Key (v3 auth)**

Then either:
- open `index.html` and paste the key into the form shown on first launch (stored in `localStorage`), **or**
- paste it in `config.js`: `const TMDB_API_KEY = "your_key_here";`

## 2. Run

Open `index.html` in a modern browser (or use VS Code *Live Server*). Internet connection required.

## Features

- Tabs: Trending, Popular, Top Rated, Now Playing (live TMDB data)
- Debounced search + recent searches
- Client-side filters: genre chips, minimum rating slider, decade, sorting (rating / popularity / newest / oldest / A–Z)
- Details modal: backdrop, synopsis, runtime, genres, director, top cast, embedded YouTube trailer
- Personal library: **Watchlist**, **Favorites**, **Watched**, and your own 1–5 star rating
- Loading skeletons, error state with retry (offline + invalid key handled), empty states
- "Load more" pagination, keyboard support (`/` focus search, `Esc` close modal)

## Requirement mapping

| Requirement | Marks | Where |
|---|---|---|
| **MP3 · DOM manipulation & dynamic rendering** | 4 | `render()`, `renderGrid()`, `movieCard()`, `renderModal()`, `renderHero()`; helper `h()` builds elements with `createElement` + `textContent`; search, filtering, selecting a movie to open details |
| **MP3 · Event handling & JS logic** | 3 | Section 9 of `script.js` — `addEventListener` for tabs, chips, search, slider, selects, cards (event delegation), modal, keyboard, `online`. `getVisible()` uses `filter`, `sort`, `map`, `find`, `includes`, `Object.entries/values`, `Set`; library is an object of movie objects |
| **MP4 · API integration & async** | 4 | `tmdb()` + `fetchMovies()` + `openModal()` use `fetch()` with `async/await`, `try/catch/finally`; **loading** (skeleton), **error** (retry / invalid key / offline) and **empty** states; `AbortController` cancels stale requests |
| **MP4 · Local Storage** | 3 | Section 3 — `cinescope.library` (watchlist/favorites/watched/ratings), `cinescope.recent` (recent searches), `cinescope.prefs` (tab & filters), `cinescope.apiKey`; all restored on page load |

## Project structure

```
cinescope/
├── index.html
├── style.css
├── script.js
├── config.js      ← put your TMDB key here (optional)
└── README.md
```

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.

Name: _your name_ · ID: _your ID_
