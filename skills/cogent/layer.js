// Cogent comment layer. Added to every page by `cogent serve`; it never edits the page.
(() => {
  if (window.__cogent) return;
  window.__cogent = true;

  const API = "/__cogent/api";
  const PAGE_PATH = location.pathname;
  let comments = [];
  let user = "you";
  let mode = false;          // comment mode
  let pinsHidden = false;
  let hoverBase = null, depth = 0, cursor = null;
  let composer = null;       // {el, target, alsoEls, draft}
  let openThread = null;     // comment id shown as a full card
  let peek = null;           // comment id shown as a hover preview
  let menuOpen = false, editing = false, confirmDelete = false;
  let panelOpen = false, showResolved = false, panelThread = null, listScroll = 0;
  let pendingSel = null;     // {range, text}
  let located = new Map();   // id -> element | null

  // ---------- icons ----------
  const I = {
    comment: '<svg viewBox="0 0 16 16"><path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11.5H8l-3 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5Z"/></svg>',
    check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
    undo: '<svg viewBox="0 0 16 16"><path d="M5 4 2.5 6.5 5 9M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    more: '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="12.5" cy="8" r=".6"/></svg>',
    pencil: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 13V3.5M4 7.5 8 3.5l4 4"/></svg>',
    back: '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  };

  // ---------- host ----------
  const host = document.createElement("cogent-layer");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;
      --ink:#1d1d1f;--muted:#6e6e73;--faint:#a1a1a6;--line:rgba(0,0,0,.1);--card:#fff;--soft:#f2f2f4;
      --accent:#0a66ff;--accent-soft:rgba(10,102,255,.08);--amber:#c27a00;--danger:#b42318;--tip:#1d1d1f;
      --ring:rgba(0,0,0,.09);--shadow:0 0 0 1px var(--ring),0 10px 32px rgba(0,0,0,.14);
      font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;color:var(--ink);
      -webkit-font-smoothing:antialiased}
    @media (prefers-color-scheme:dark){:host{--ink:#f2f2f4;--muted:#a1a1a8;--faint:#6e6e75;--line:rgba(255,255,255,.12);--card:#232326;--soft:#303034;
      --accent:#3d8bff;--accent-soft:rgba(61,139,255,.14);--amber:#e09a2b;--danger:#ff6b5e;--tip:#000;--ring:rgba(255,255,255,.14);--shadow:0 0 0 1px var(--ring),0 10px 32px rgba(0,0,0,.5)}}
    *{box-sizing:border-box}
    svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
    button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
    .hl{position:fixed;border:1.5px solid var(--accent);background:var(--accent-soft);border-radius:4px;pointer-events:none;display:none}
    .hl.also{border-style:dashed;background:none}
    .tag{position:fixed;background:var(--accent);color:#fff;font-size:11px;font-weight:500;padding:2px 6px;border-radius:4px;pointer-events:none;display:none;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}

    /* tooltips: small and dark, above the control (below it in the bar) */
    [data-tip]{position:relative}
    [data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
      background:var(--tip);color:#fff;font-size:12px;font-weight:500;line-height:1;padding:6px 8px;border-radius:6px;white-space:nowrap;pointer-events:none;z-index:2}
    .bar [data-tip]:hover::after{bottom:auto;top:calc(100% + 8px)}
    .panel [data-tip]:hover::after{bottom:auto;top:calc(100% + 6px);left:auto;right:0;transform:none}

    /* pins: a bubble with its tail on the spot; on hover the same bubble grows into the preview.
       Opening shifts the bubble up-left by 6px while the avatar moves down-right by 6px, so the avatar stays put. */
    .pin{position:fixed;width:32px;height:32px;border-radius:16px 16px 16px 4px;background:var(--card);box-shadow:var(--shadow);
      pointer-events:auto;cursor:pointer;overflow:hidden;
      transition:width .18s cubic-bezier(.2,.8,.2,1),height .18s cubic-bezier(.2,.8,.2,1),transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s}
    .pin.expanded{transform:translate(-6px,-6px)}
    .pin .pav{position:absolute;z-index:1;left:4px;top:4px;width:24px;height:24px;border-radius:12px;display:grid;place-items:center;
      font-size:11px;font-weight:600;transition:left .18s cubic-bezier(.2,.8,.2,1),top .18s cubic-bezier(.2,.8,.2,1)}
    .pin.expanded .pav{left:10px;top:10px}
    .pin.on{box-shadow:0 0 0 2px var(--accent),0 10px 32px rgba(0,0,0,.2)}
    .pin .pbody{position:absolute;z-index:1;left:10px;top:10px;width:max-content;max-width:260px;opacity:0;transition:opacity .1s;pointer-events:none}
    .pin.expanded .pbody{opacity:1;transition:opacity .14s .06s}
    .pbody .who{line-height:24px;padding-left:32px}
    .pbody .ptxt{margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
    .pbody .more{margin:4px 0 0;color:var(--muted);font-size:12px}

    /* an agent at work: a light that travels around the border, in the agent's colour */
    @keyframes sp-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
    .working::before{content:"";position:absolute;z-index:0;left:50%;top:50%;width:640px;height:640px;
      background:conic-gradient(from 0deg,transparent 0deg 200deg,var(--work) 300deg,color-mix(in srgb,var(--work) 40%,#fff) 345deg,transparent 360deg);
      transform:translate(-50%,-50%);animation:sp-spin 1.6s linear infinite}
    .working::after{content:"";position:absolute;z-index:0;inset:2px;background:var(--card);border-radius:inherit}
    .pin.working{box-shadow:0 0 0 1px color-mix(in srgb,var(--work) 35%,transparent),0 10px 32px rgba(0,0,0,.2)}
    .pin.working::after{border-radius:14px 14px 14px 3px}
    /* open, the working row says it; the ring stays on the small pin only */
    .pin.working.expanded::before,.pin.working.expanded::after{display:none}
    .pin.working.expanded{box-shadow:var(--shadow)}
    @media (prefers-reduced-motion:reduce){.working::before{animation:none;background:var(--work)}}

    /* the agent at work, in the bar */
    .busy{display:flex;gap:2px}
    .busy:empty{display:none}
    .bar .work{padding:0 4px}
    .wring{position:relative;width:24px;height:24px;border-radius:12px;overflow:hidden;display:grid;place-items:center}
    .wring.working::before{width:60px;height:60px}
    .wring.working::after{background:var(--card)}
    .wring .wav{position:relative;z-index:1;width:18px;height:18px;border-radius:9px;display:grid;place-items:center;color:#fff;font-size:10px;font-weight:600}
    .wrow{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--muted)}
    .wrow .wdot{width:22px;height:22px;border-radius:11px;display:grid;place-items:center;color:#fff;font-size:10px;font-weight:600;flex:none}
    .wrow.small{gap:6px;margin:6px 0 0;font-size:12px}
    .wrow.small .wdot{width:16px;height:16px;font-size:9px}
    .more .wrow.small{margin:0}
    .typing{display:inline-flex;gap:3px;margin-left:-2px;vertical-align:middle;color:var(--work)}
    .typing i{width:4px;height:4px;border-radius:2px;background:currentColor;opacity:.3;animation:sp-dot 1.2s infinite}
    .typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
    @keyframes sp-dot{0%,60%,100%{opacity:.3}30%{opacity:1}}

    /* cards */
    .card{position:fixed;width:300px;background:var(--card);border-radius:12px;box-shadow:var(--shadow);pointer-events:auto;padding:12px 14px}
    .where{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px}
    .where .what{color:var(--ink)}
    .quote{border-left:2px solid var(--line);padding-left:8px;color:var(--muted);margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .msg{display:grid;grid-template-columns:22px 1fr auto;column-gap:8px;margin-bottom:12px}
    .av{width:22px;height:22px;border-radius:11px;display:grid;place-items:center;font-size:10px;font-weight:600;text-transform:uppercase;color:#fff}
    .who{display:flex;gap:6px;align-items:baseline;line-height:22px;min-width:0}.who b{font-weight:600}.who time{color:var(--faint);font-size:12px}
    .txt{grid-column:1/4;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}
    .txt .ed{color:var(--faint);font-size:12px}
    .acts{display:flex;gap:2px;margin:-1px -6px 0 0}
    .ic{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--muted)}
    .ic:hover,.ic.on{background:var(--soft);color:var(--ink)}
    .menu{position:absolute;right:30px;top:24px;min-width:170px;background:var(--card);border-radius:10px;box-shadow:var(--shadow);padding:5px;z-index:3}
    .menu button{display:flex;align-items:center;gap:10px;width:100%;padding:7px 9px;border-radius:6px;font-size:13px;text-align:left}
    .menu button:hover{background:var(--soft)}
    .menu .del{color:var(--danger)}
    .more{color:var(--muted);font-size:12px;margin:-4px 0 8px 30px}
    .field{border:1px solid var(--line);border-radius:8px;padding:6px 6px 6px 10px;display:flex;align-items:flex-end;gap:6px}
    .field:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
    .compose .field{border:0;padding:0;box-shadow:none}
    textarea{flex:1;min-width:0;border:0;outline:none;resize:none;background:none;font:inherit;color:inherit;padding:2px 0;height:22px;max-height:160px;overflow:hidden;display:block}
    textarea::placeholder{color:var(--faint)}
    .send{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:var(--soft);color:var(--ink);flex:none}
    .send:hover{background:var(--line)}
    .send:disabled{color:var(--faint);cursor:default;background:var(--soft)}
    .send svg{width:15px;height:15px;stroke-width:1.75}
    .send[data-tip]:hover::after{bottom:auto;top:50%;left:calc(100% + 8px);transform:translateY(-50%)}
    .send:disabled[data-tip]:hover::after{display:none}
    .edit-row{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
    .edit-row button{padding:4px 10px;border-radius:6px;font-size:12px}
    .edit-row .save{background:var(--soft)}
    .edit-row button:hover{background:var(--line)}
    .status{font-size:12px;color:var(--faint);margin-top:8px}

    /* the bar, top right */
    .bar{position:fixed;top:12px;right:12px;display:flex;align-items:center;gap:2px;padding:3px;background:var(--card);border-radius:10px;box-shadow:var(--shadow);pointer-events:auto}
    .bar button{height:28px;border-radius:7px;display:flex;align-items:center;gap:6px;padding:0 7px;color:var(--ink)}
    .bar button:hover{background:var(--soft)}
    .bar .mode.on{background:var(--accent);color:#fff}
    kbd{font:500 11px/1 -apple-system,sans-serif;padding:2px 5px;border-radius:4px;background:var(--soft);color:var(--muted)}
    .mode.on kbd{background:rgba(255,255,255,.22);color:#fff}
    .count{padding:0 10px!important;font-weight:500;font-variant-numeric:tabular-nums}
    .count b{font-weight:600}
    .sep{width:1px;height:16px;background:var(--line);margin:0 3px;flex:none}
    .count.none{color:var(--faint);font-weight:500}

    /* the panel drops down from the bar */
    .panel{position:fixed;top:52px;right:12px;width:340px;max-height:min(70vh,640px);display:flex;flex-direction:column;background:var(--card);border-radius:12px;box-shadow:var(--shadow);pointer-events:auto;overflow:hidden}
    .panel .top{display:flex;align-items:center;gap:8px;padding:12px 10px 6px 14px}
    .panel .top h3{flex:1;margin:0;font-size:14px;font-weight:600}
    .panel .list{overflow:auto;padding:0 6px 8px;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    /* a thread whose spot is gone takes over the panel; back returns to the list */
    .panel .detail{overflow:auto;padding:0 6px 10px;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    .card.inpanel{position:static;width:auto;box-shadow:none;padding:4px 8px 2px;background:transparent}
    .pin.s-resolved .pav{filter:grayscale(1);opacity:.65}
    textarea{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    .group{display:flex;justify-content:space-between;align-items:center;margin:10px 8px 4px;font-size:11px;font-weight:600;color:var(--muted)}
    .group button{font-weight:500;color:var(--accent)}
    .item{display:grid;grid-template-columns:22px 1fr;column-gap:8px;padding:8px;border-radius:8px;cursor:pointer}
    .item:hover,.item.on{background:var(--soft)}
    .item .w{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px}
    .item .x{grid-column:1/-1;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .item .more{grid-column:1/-1;margin:4px 0 0;color:var(--muted);font-size:12px}
    .panel .top .tres{font-size:12px;color:var(--muted);padding:4px 8px;border-radius:6px}
    .panel .top .tres:hover,.panel .top .tres.on{background:var(--soft);color:var(--ink)}
    .item.done{opacity:.55}
    .empty{padding:20px 16px 26px;text-align:center;color:var(--muted)}
    .empty b{display:block;color:var(--ink);font-weight:600;margin-bottom:4px}
    .selbtn{position:fixed;pointer-events:auto;height:28px;padding:0 10px;border-radius:8px;background:var(--card);box-shadow:var(--shadow);display:none;align-items:center;gap:6px;font-weight:500}
  </style>
  <div class="hl"></div><div class="tag"></div><div class="alsos"></div><div class="pins"></div>
  <button class="selbtn">${I.comment}Comment</button>
  <div class="bar"><div class="busy"></div><button class="mode" data-tip="Comment mode">${I.comment}<kbd>C</kbd></button><span class="sep"></span><button class="count"></button></div>`;
  (document.body || document.documentElement).appendChild(host);
  const $ = (s) => root.querySelector(s);
  const hl = $(".hl"), tag = $(".tag"), pinsEl = $(".pins"), alsosEl = $(".alsos"), selbtn = $(".selbtn");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  // Selected words stay highlighted without touching the page's DOM (CSS Custom Highlight API).
  const HL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
  if (HL) {
    const st = document.createElement("style");
    st.textContent = "::highlight(cogent){background:rgba(255,196,0,.28)}::highlight(cogent-on){background:rgba(255,184,0,.55)}";
    document.head.appendChild(st);
  }

  // ---------- describing and finding elements ----------
  const ours = (el) => el === host || host.contains(el);
  const notePath = (el) => {
    const out = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (e.dataset && e.dataset.note) out.unshift(e.dataset.note);
    return out;
  };
  // Visible text, with a space where one element's text meets another's ("B Features", not "BFeatures").
  const text = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) { const t = n.data.trim(); if (t) out.push(t); }
    return out.join(" ").replace(/\s+/g, " ").trim();
  };
  const nameOf = (el) => {
    if (el.dataset && el.dataset.note) return el.dataset.note;
    const cls = [...el.classList].filter((c) => !/^\d/.test(c))[0];
    const t = text(el);
    return el.tagName.toLowerCase() + (cls ? "." + cls : "") + (t ? ` "${t.slice(0, 40)}${t.length > 40 ? "…" : ""}"` : "");
  };
  // The nearest heading before the element: what a person would call "where" on an unnamed page.
  const HEADS = "h1,h2,h3,h4,h5,h6,[role=heading]";
  const headingOf = (el) => {
    const inside = el.matches && el.matches(HEADS) ? el : el.querySelector && el.querySelector(HEADS);
    if (inside && !ours(inside)) return text(inside).slice(0, 80);  // a section is named by its own heading
    let best = null;
    for (const h of document.querySelectorAll(HEADS)) {
      if (ours(h)) continue;
      if (h === el || h.contains(el) || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h; else break;
    }
    return best ? text(best).slice(0, 80) : null;
  };
  const cssFrom = (anchor, el) => {
    const parts = [];
    for (let e = el; e && e !== anchor; e = e.parentElement) {
      const sibs = [...e.parentElement.children].filter((s) => s.tagName === e.tagName);
      parts.unshift(e.tagName.toLowerCase() + (sibs.length > 1 ? `:nth-of-type(${sibs.indexOf(e) + 1})` : ""));
    }
    return parts.join(" > ");
  };
  // A named element: anchor is its own name, path is the names around it, css is "".
  // Anything else: anchor is the nearest named section, path ends with it, css leads from it to the element.
  const describe = (el, selection, point) => {
    const anchor = el.closest("[data-note]") || document.body;
    const r = el.getBoundingClientRect();
    return {
      anchor: anchor.dataset && anchor.dataset.note ? anchor.dataset.note : null,
      path: anchor === el ? notePath(el.parentElement) : notePath(el),
      location: headingOf(el),
      name: nameOf(el),
      css: anchor === el ? "" : cssFrom(anchor, el),
      tag: el.tagName.toLowerCase(),
      text: text(el).slice(0, 300),
      selection: selection || null,
      point: point || null,
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: innerWidth,
    };
  };
  const anchorFor = (t) => {
    if (!t.anchor) return document.body;
    const want = (t.css === "" ? [...t.path, t.anchor] : t.path).join("/");
    const all = [...document.querySelectorAll("[data-note]")];
    const exact = all.find((e) => notePath(e).join("/") === want);
    if (exact) return exact;
    const byName = all.filter((e) => e.dataset.note === t.anchor);
    return byName.length === 1 ? byName[0] : null;
  };
  const words = (x) => new Set((x || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const similar = (now, was) => {
    if (!was || now === was) return true;
    const a = words(now), b = words(was);
    if (a.size <= 3 && b.size <= 3) return true;  // a short label that was reworded
    let both = 0; for (const w of a) if (b.has(w)) both++;
    return both / new Set([...a, ...b]).size >= 0.4;
  };
  const locate = (t) => {
    const a = anchorFor(t);
    if (!a) return null;
    if (t.css === "") return a;
    let el = null;
    try { el = a.querySelector(":scope > " + t.css); } catch (e) {}
    // Same spot, same kind of element, recognisably the same words: it's this one, edited.
    // (Without the word check, deleting a bullet hands its comment to the next bullet.)
    if (el && el.tagName.toLowerCase() === t.tag && similar(text(el).slice(0, 300), t.text)) return el;
    // The spot is gone: look for the same element by its text, but only if exactly one matches.
    if (t.text) {
      const hits = [...a.querySelectorAll(t.tag)].filter((e) => text(e).slice(0, 300) === t.text);
      if (hits.length === 1) return hits[0];
    }
    return null;
  };
  // Find the selected words inside the element again, as a Range (whitespace runs count as one space).
  const rangeFor = (el, words) => {
    if (!el || !words) return null;
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let s = "";
    for (let n; (n = w.nextNode()); ) { nodes.push([n, s.length]); s += n.data; }
    let flat = "";
    const map = [];
    for (let i = 0; i < s.length; i++) {
      const ws = /\s/.test(s[i]);
      if (ws && (flat === "" || flat.endsWith(" "))) continue;
      flat += ws ? " " : s[i]; map.push(i);
    }
    const at = flat.indexOf(words);
    if (at < 0) return null;
    const pos = (raw) => { let k = nodes.length - 1; while (k > 0 && nodes[k][1] > raw) k--; return [nodes[k][0], raw - nodes[k][1]]; };
    const [sn, so] = pos(map[at]), [en, eo] = pos(map[at + words.length - 1]);
    const r = document.createRange();
    r.setStart(sn, so); r.setEnd(en, eo + 1);
    return r;
  };

  // ---------- data ----------
  const api = (body) => fetch(API + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: PAGE_PATH, ...body }) }).then((r) => r.json());
  const load = async () => {
    const d = await fetch(API + "/comments?page=" + encodeURIComponent(PAGE_PATH)).then((r) => r.json());
    comments = d.comments || [];
    user = d.user || user;
    render();
  };

  // ---------- helpers ----------
  const AGENTS = new Set(["claude", "codex"]);
  const initial = (who) => (who || "?")[0].toUpperCase();
  // One colour per person, the same on the pin, in the thread and in the list.
  const COLORS = { claude: "#c96442", codex: "#0f9b8e" };
  const PALETTE = ["#6e56cf", "#d6336c", "#1c7ed6", "#e8590c", "#2b8a3e", "#ae3ec9"];
  const colorOf = (who) => {
    if (COLORS[who]) return COLORS[who];
    if (who === user) return PALETTE[0];
    let h = 0; for (const ch of who || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[1 + (h % (PALETTE.length - 1))];
  };
  const avatar = (who, cls = "av", extra = "") => `<div class="${cls}${extra}" style="background:${colorOf(who)}">${esc(initial(who))}</div>`;
  const display = (who) => (who || "").charAt(0).toUpperCase() + (who || "").slice(1);
  const lastBy = (c) => c.thread[c.thread.length - 1].by;
  const whereOf = (t) => {
    const names = [...(t.path || [])];
    if (names.length) return names.join(" › ") + (t.css === "" ? " › " + t.name : "");
    return t.location || t.name;
  };
  // What you're commenting on, then where it is: "Set Up…" · Ask and AI cleanup as optional steps
  const whatOf = (t) => {
    if (t.css === "" && t.anchor) return t.name;
    if (t.tag === "svg") return "Icon";
    if (t.tag === "img") return "Image";
    if (!t.text) return t.tag;
    return "“" + (t.text.length > 48 ? t.text.slice(0, 45).trim() + "…" : t.text) + "”";
  };
  const placeOf = (t) => (t.path && t.path.length ? t.path.join(" › ") : t.location) || "";
  const sameAsPlace = (t) => t.text && t.location && t.text.slice(0, 80) === t.location;
  const whereHTML = (t) => sameAsPlace(t) ? `<span class="what">${esc(t.location)}</span>`
    : `<span class="what">${esc(whatOf(t))}</span>${placeOf(t) ? ` · ${esc(placeOf(t))}` : ""}`;
  const whereText = (t) => sameAsPlace(t) ? t.location : whatOf(t) + (placeOf(t) ? " · " + placeOf(t) : "");
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  const unresolved = () => comments.filter((c) => c.status !== "resolved");
  // Where the pin goes: the end of the selected words, the spot clicked, or the element's top right.
  const spot = (c, el) => {
    const t = c.target;
    const rg = t.selection && rangeFor(el, t.selection);
    if (rg) { const rs = rg.getClientRects(); const last = rs[rs.length - 1]; if (last) return { x: last.right + 2, y: last.top + 2 }; }
    const r = el.getBoundingClientRect();
    if (t.point) return { x: r.left + t.point.x * r.width, y: r.top + t.point.y * r.height };
    return { x: r.right - 4, y: r.top + 6 };
  };

  // ---------- rendering ----------
  function render() {
    located = new Map(comments.map((c) => [c.id, locate(c.target)]));
    const n = unresolved().length;
    const count = $(".count");
    count.innerHTML = `<b>${n}</b> ${n === 1 ? "comment" : "comments"}`;
    count.classList.toggle("none", !n);
    $(".mode").classList.toggle("on", mode);
    const busy = {};
    for (const c of comments) if (c.status === "taken") busy[c.taken_by] = (busy[c.taken_by] || 0) + 1;
    $(".busy").innerHTML = Object.entries(busy).map(([who, k]) =>
      `<button class="work" data-tip="${esc(display(who))} is working on ${k} comment${k === 1 ? "" : "s"}"><span class="wring working" style="--work:${colorOf(who)}"><span class="wav" style="background:${colorOf(who)}">${esc(initial(who))}</span></span></button>`).join("");
    root.querySelectorAll(".bar .work").forEach((b) => b.onclick = () => { panelOpen = true; openThread = null; resetCard(); if (mode) setMode(false); render(); });
    renderPins();
    renderHighlights();
    renderPanel();
    renderThread();
  }
  function renderHighlights() {
    if (!HL) return;
    const all = [], on = [];
    for (const c of comments) {
      if (c.status === "resolved" && c.id !== openThread) continue;
      const el = located.get(c.id);
      const rg = el && c.target.selection && rangeFor(el, c.target.selection);
      if (rg) (c.id === openThread || c.id === peek ? on : all).push(rg);
    }
    CSS.highlights.set("cogent", new Highlight(...all));
    CSS.highlights.set("cogent-on", new Highlight(...on));
  }
  const pinEls = new Map();  // id -> pin element, kept across renders so hover and motion survive scrolling
  const workingRow = (who, small) => `<div class="wrow${small ? " small" : ""}" style="--work:${colorOf(who)}"><span class="wdot" style="background:${colorOf(who)}">${esc(initial(who))}</span>` +
    `<span>${esc(display(who))} is working on this</span><span class="typing"><i></i><i></i><i></i></span></div>`;
  const pinBody = (c) => {
    const first = c.thread[0], replies = c.thread.length - 1;
    return `<div class="who"><b>${esc(display(first.by))}</b><time>${ago(first.at)}</time></div><div class="ptxt">${esc(first.text)}</div>` +
      (replies ? `<div class="more">${replies} ${replies === 1 ? "reply" : "replies"} · latest from ${esc(display(lastBy(c)))}</div>` : "") +
      (c.status === "taken" ? workingRow(c.taken_by, true) : "");
  };
  const sizePin = (p, open) => {
    if (!open) { p.style.width = "32px"; p.style.height = "32px"; return; }
    const b = p.querySelector(".pbody");
    p.style.width = Math.max(32, Math.min(10 + b.offsetWidth + 14, 300)) + "px";
    p.style.height = Math.max(32, 10 + b.offsetHeight + 10) + "px";
  };
  function renderPins() {
    const keep = new Set();
    if (!pinsHidden) for (const c of comments) {
      const el = located.get(c.id);
      if (!el || !visible(el)) continue;
      if (c.status === "resolved" && c.id !== openThread) continue;  // resolved pins appear only while you look at them
      const p0 = spot(c, el);
      if (p0.y < 0 || p0.y > innerHeight + 32) continue;
      keep.add(c.id);
      let p = pinEls.get(c.id);
      if (!p) {
        p = document.createElement("div");
        p.innerHTML = '<div class="pav"></div><div class="pbody"></div>';
        p.onmouseenter = () => { if (openThread === c.id) return; peek = c.id; p.classList.add("expanded"); sizePin(p, true); renderPins(); renderHighlights(); };
        p.onmouseleave = () => { peek = null; p.classList.remove("expanded"); sizePin(p, false); renderPins(); renderHighlights(); };
        p.onclick = (e) => { e.stopPropagation(); peek = null; p.classList.remove("expanded"); sizePin(p, false);
          openThread = openThread === c.id ? null : c.id; resetCard(); panelOpen = false; render(); };
        pinsEl.appendChild(p);
        pinEls.set(c.id, p);
      }
      const cur = comments.find((x) => x.id === c.id);
      p.className = `pin s-${cur.status}${cur.status === "taken" ? " working" : ""}${openThread === c.id ? " on" : ""}${peek === c.id ? " expanded" : ""}`;
      if (cur.status === "taken") p.style.setProperty("--work", colorOf(cur.taken_by));
      const pav = p.querySelector(".pav");  // who started it, in their colour
      pav.textContent = initial(cur.thread[0].by);
      pav.style.background = colorOf(cur.thread[0].by);
      pav.style.color = "#fff";
      const body = pinBody(cur);
      if (p.dataset.body !== body) { p.dataset.body = body; p.querySelector(".pbody").innerHTML = body; if (peek === c.id) sizePin(p, true); }
      // Tail on the spot; nudge left only if the open bubble would leave the window.
      // The thread you opened from the panel keeps its pin beside the panel rather than under it.
      const w = parseFloat(p.style.width) || 32, right = c.id === openThread ? edge() : innerWidth;
      p.style.left = Math.max(4, Math.min(p0.x, right - w - 8)) + "px";
      p.style.top = p0.y - 32 + "px";
    }
    for (const [id, p] of pinEls) if (!keep.has(id)) { p.remove(); pinEls.delete(id); if (peek === id) peek = null; }
  }
  const resetCard = () => { menuOpen = false; editing = false; confirmDelete = false; };
  const edge = () => panelOpen ? innerWidth - 352 : innerWidth;  // the panel's left side while it stays open
  const place = (card, x, y) => {
    const w = card.offsetWidth || 300, h = card.offsetHeight || 160;
    let left = x + 40;  // clear of the pin, which sits at x..x+32 with its tail on the spot
    const right = edge();
    if (left + w > right - 8) left = Math.max(8, Math.min(x, right - 40) - w - 8);  // left of the pin, which may itself be nudged off the panel
    card.style.left = left + "px";
    card.style.top = Math.max(8, Math.min(innerHeight - h - 8, y - 32)) + "px";
  };
  const placeAt = (card, c) => {
    const el = located.get(c.id);
    if (el) { const p = spot(c, el); place(card, Math.min(p.x, innerWidth - 30), p.y); }
    else { card.style.left = Math.max(8, innerWidth - 300 - 364) + "px"; card.style.top = "52px"; }
  };
  const msgHTML = (m, acts = "") => `<div class="msg">${avatar(m.by)}
    <div class="who"><b>${esc(display(m.by))}</b><time>${ago(m.at)}</time></div>${acts ? `<div class="acts">${acts}</div>` : "<div></div>"}
    <div class="txt">${esc(m.text)}${m.edited ? ' <span class="ed">(edited)</span>' : ""}</div></div>`;
  const grow = (ta) => { ta.style.height = "22px"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; ta.style.overflowY = ta.scrollHeight > 160 ? "auto" : "hidden"; };

  function renderThread() {
    root.querySelectorAll(".card.thread").forEach((n) => n.remove());
    const inPanel = !!(panelOpen && panelThread);
    const c = comments.find((x) => x.id === (inPanel ? panelThread : openThread));
    if (!c) return;
    const close = inPanel ? backToList : closeThread;
    const el = located.get(c.id), t = c.target;
    const resolved = c.status === "resolved";
    const mineIdx = c.thread.map((m) => m.by).lastIndexOf(user);
    const acts = `<button class="ic res" data-tip="${resolved ? "Reopen" : "Resolve"}">${resolved ? I.undo : I.check}</button>
      <button class="ic dots${menuOpen ? " on" : ""}" data-tip="More">${I.more}</button>
      ${inPanel ? "" : `<button class="ic x" data-tip="Close">${I.close}</button>`}`;
    const menu = menuOpen ? `<div class="menu">${mineIdx >= 0 ? `<button class="edit">${I.pencil}Edit</button>` : ""}
      <button class="del">${I.trash}${confirmDelete ? "Click again to delete" : "Delete thread"}</button></div>` : "";
    const msgs = c.thread.map((m, i) => {
      if (editing && i === mineIdx) return `<div class="msg">${avatar(m.by)}<div class="who"><b>${esc(display(m.by))}</b></div><div></div>
        <div class="txt"><div class="field"><textarea class="edit-ta" rows="1">${esc(m.text)}</textarea></div>
        <div class="edit-row"><button class="cancel">Cancel</button><button class="save">Save</button></div></div></div>`;
      return msgHTML(m, i === 0 ? acts : "");
    }).join("");
    const card = document.createElement("div");
    card.className = inPanel ? "card thread inpanel" : "card thread";
    card.innerHTML = `${t.selection ? `<div class="quote">${esc(t.selection)}</div>` : `<div class="where">${whereHTML(t)}</div>`}
      ${el ? "" : `<div class="where">Not on the page anymore</div>`}
      ${msgs}${c.status === "taken" ? workingRow(c.taken_by) : ""}${menu}
      <div class="field"><textarea class="reply" rows="1" placeholder="Reply"></textarea><button class="send" disabled data-tip="Reply ↵">${I.up}</button></div>
`;
    if (inPanel) {
      const host = root.querySelector(".panel .detail");
      if (!host) return;
      host.appendChild(card);
    } else {
      root.appendChild(card);
      placeAt(card, c);
      if (el) showBox(hl, el);
    }
    const ta = card.querySelector(".reply"), send = card.querySelector(".send");
    ta.oninput = () => { grow(ta); send.disabled = !ta.value.trim(); };
    const go = async () => { const v = ta.value.trim(); if (!v) return; ta.value = ""; await api({ action: "reply", id: c.id, text: v }); await load(); };
    send.onclick = go;
    ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } if (e.key === "Escape") close(); };
    const xb = card.querySelector(".x");
    if (xb) xb.onclick = closeThread;
    card.querySelector(".res").onclick = async () => { await api({ action: resolved ? "reopen" : "resolve", id: c.id }); close(); await load(); };
    card.querySelector(".dots").onclick = () => { menuOpen = !menuOpen; confirmDelete = false; renderThread(); };
    const ed = card.querySelector(".menu .edit");
    if (ed) ed.onclick = () => { menuOpen = false; editing = true; renderThread(); const e2 = root.querySelector(".edit-ta"); if (e2) { grow(e2); e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); } };
    const del = card.querySelector(".menu .del");
    if (del) del.onclick = async () => {
      if (!confirmDelete) { confirmDelete = true; renderThread(); return; }
      await api({ action: "delete", id: c.id }); close(); await load();
    };
    const eta = card.querySelector(".edit-ta");
    if (eta) {
      eta.oninput = () => grow(eta);
      const save = async () => { const v = eta.value.trim(); if (!v) return; editing = false; await api({ action: "edit", id: c.id, text: v }); await load(); };
      card.querySelector(".save").onclick = save;
      card.querySelector(".cancel").onclick = () => { editing = false; renderThread(); };
      eta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") { editing = false; renderThread(); } };
    }
  }
  const closeThread = () => { openThread = null; resetCard(); hideBox(); render(); };
  const backToList = () => { panelThread = null; resetCard(); render(); };

  function renderPanel() {
    root.querySelectorAll(".panel").forEach((n) => n.remove());
    if (!panelOpen) return;
    const panel = document.createElement("div");
    panel.className = "panel";
    const live = (c) => located.get(c.id);
    const pageOrder = (a, b) => (live(a).compareDocumentPosition(live(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const onPage = comments.filter((c) => c.status !== "resolved" && live(c)).sort(pageOrder);
    const gone = comments.filter((c) => c.status !== "resolved" && !live(c));
    const done = comments.filter((c) => c.status === "resolved");
    const item = (c) => {
      const first = c.thread[0], replies = c.thread.length - 1;
      return `<div class="item${c.status === "resolved" ? " done" : ""}${c.id === openThread ? " on" : ""}" data-id="${c.id}">${avatar(first.by, "av", " s-" + c.status)}
        <div class="w">${esc(c.target.selection ? "“" + c.target.selection + "”" : whereText(c.target))} · ${ago(c.thread[c.thread.length - 1].at)}</div>
        <div class="x">${esc(first.text)}</div>
        ${c.status === "taken" ? `<div class="more">${workingRow(c.taken_by, true)}</div>` : replies ? `<div class="more">${replies} ${replies === 1 ? "reply" : "replies"} · ${esc(display(lastBy(c)))}</div>` : ""}</div>`;
    };
    let html = onPage.map(item).join("");
    if (gone.length) html += `<div class="group"><span>Not on the page anymore · ${gone.length}</span></div>${gone.map(item).join("")}`;
    if (showResolved && done.length) html += `<div class="group"><span>Resolved · ${done.length}</span></div>${done.map(item).join("")}`;
    if (!comments.length) html = `<div class="empty"><b>No comments yet</b>Press C, then click anything on the page.</div>`;
    else if (!onPage.length && !gone.length && !showResolved) html = `<div class="empty"><b>All resolved</b></div>`;
    const toggle = done.length ? `<button class="tres${showResolved ? " on" : ""}">${showResolved ? "Hide" : "Show"} resolved</button>` : "";
    if (panelThread && comments.some((x) => x.id === panelThread)) {
      panel.innerHTML = `<div class="top"><button class="ic back" data-tip="All comments">${I.back}</button><h3>Comments</h3><button class="ic x" data-tip="Close">${I.close}</button></div><div class="detail"></div>`;
      root.appendChild(panel);
      panel.querySelector(".back").onclick = backToList;
      panel.querySelector(".x").onclick = () => { panelOpen = false; panelThread = null; resetCard(); render(); };
      return;
    }
    panelThread = null;
    panel.innerHTML = `<div class="top"><h3>Comments</h3>${toggle}<button class="ic x" data-tip="Close">${I.close}</button></div><div class="list">${html}</div>`;
    root.appendChild(panel);
    const list = panel.querySelector(".list");
    list.scrollTop = listScroll;
    list.onscroll = () => { listScroll = list.scrollTop; };
    panel.querySelector(".x").onclick = () => { panelOpen = false; render(); };
    // Has a place on the page: go there. No place: read it in the panel. Resolved threads keep the panel open.
    panel.querySelectorAll(".item").forEach((it) => it.onclick = () => {
      const id = it.dataset.id, el = located.get(id), c = comments.find((x) => x.id === id);
      listScroll = list.scrollTop; resetCard();
      if (!el) { panelThread = id; openThread = null; hideBox(); render(); return; }
      openThread = id;
      if (c.status !== "resolved") panelOpen = false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(render, 350);
    });
    const tr = panel.querySelector(".tres");
    if (tr) tr.onclick = () => { showResolved = !showResolved; render(); };
  }
  const showBox = (box, el) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px" });
  };
  const hideBox = () => { hl.style.display = "none"; tag.style.display = "none"; };

  // ---------- composing ----------
  function openComposer(el, selection, point) {
    composer = { el, target: describe(el, selection, point), alsoEls: [] };
    openThread = null; resetCard(); panelOpen = false; hideBox();
    render(); drawComposer();
  }
  const closeComposer = () => { composer = null; drawComposer(); hideBox(); renderHighlights(); };
  const composerSpot = () => {
    const r = composer.el.getBoundingClientRect(), t = composer.target;
    if (t.selection) { const rg = rangeFor(composer.el, t.selection); const rs = rg && rg.getClientRects(); const last = rs && rs[rs.length - 1]; if (last) return { x: last.right, y: last.bottom + 26 }; }
    return { x: Math.min(t.point ? r.left + t.point.x * r.width : r.right, innerWidth - 30), y: t.point ? r.top + t.point.y * r.height : r.top + 26 };
  };
  function drawComposer() {
    root.querySelectorAll(".card.compose").forEach((n) => n.remove());
    alsosEl.innerHTML = "";
    if (!composer) return;
    const { el, target } = composer;
    if (target.selection && HL) { const rg = rangeFor(el, target.selection); CSS.highlights.set("cogent-on", rg ? new Highlight(rg) : new Highlight()); }
    else showBox(hl, el);
    for (const a of composer.alsoEls) { const b = document.createElement("div"); b.className = "hl also"; alsosEl.appendChild(b); showBox(b, a); }
    const card = document.createElement("div");
    card.className = "card compose";
    const placeLine = target.selection ? (placeOf(target) && placeOf(target) !== target.selection ? esc(placeOf(target)) : "") : whereHTML(target);
    card.innerHTML = `${placeLine ? `<div class="where">${placeLine}</div>` : ""}
      ${target.selection ? `<div class="quote">${esc(target.selection)}</div>` : ""}
      ${composer.alsoEls.map((a) => `<div class="where" style="margin-top:-4px">+ ${esc(nameOf(a))}</div>`).join("")}
      <div class="field"><textarea rows="1" placeholder="Add a comment"></textarea><button class="send" disabled data-tip="Add comment ↵">${I.up}</button></div>`;
    root.appendChild(card);
    const p = composerSpot();
    place(card, p.x, p.y);
    const ta = card.querySelector("textarea"), send = card.querySelector(".send");
    ta.value = composer.draft || "";
    grow(ta); send.disabled = !ta.value.trim();
    ta.oninput = () => { composer.draft = ta.value; grow(ta); send.disabled = !ta.value.trim(); };
    setTimeout(() => ta.focus(), 0);
    const post = async () => {
      if (!ta.value.trim()) return;
      const body = { action: "create", target, also: composer.alsoEls.map((a) => describe(a)), text: ta.value.trim() };
      closeComposer();
      await api(body); await load();
    };
    send.onclick = post;
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); }
      if (e.key === "Escape") closeComposer();
    };
  }

  // ---------- picking ----------
  // Only the page's outermost container is never a target: html, body, main, and any wrapper that is the
  // page's only child all the way down (body > div.app > div.shell). ↑ stops below them.
  const WRAPPERS = new Set([document.documentElement, document.body, document.querySelector("main")].filter(Boolean));
  const only = (el) => [...el.children].filter((c) => c !== host && !/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(c.tagName));
  for (const start of [document.body, document.querySelector("main")]) {
    for (let e = start, kids = e && only(e); e && kids.length === 1; e = kids[0], kids = only(e)) WRAPPERS.add(kids[0]);
  }
  const targetEl = () => {
    let e = hoverBase;
    for (let i = 0; i < depth && e && e.parentElement && !WRAPPERS.has(e.parentElement); i++) e = e.parentElement;
    return e && !WRAPPERS.has(e) ? e : null;
  };
  const pickAt = (el) => {
    const svg = el.closest && el.closest("svg");
    if (svg) return svg;  // an icon is one thing, not its paths
    return WRAPPERS.has(el) ? null : el;
  };
  function setMode(on) {
    mode = on;
    if (!on) { hideBox(); hoverBase = null; }
    else { panelOpen = false; openThread = null; resetCard(); }
    document.documentElement.style.cursor = on ? "crosshair" : "";
    render();
    if (on && cursor) hoverAt(cursor.x, cursor.y);
  }
  const drawHover = () => {
    const t = targetEl();
    if (!t) return hideBox();
    showBox(hl, t);
    tag.textContent = [...notePath(t.dataset && t.dataset.note ? t.parentElement : t), nameOf(t)].join(" › ");
    const r = t.getBoundingClientRect();
    Object.assign(tag.style, { display: "block", left: Math.max(4, r.left) + "px", top: (r.top > 24 ? r.top - 22 : r.bottom + 4) + "px" });
  };
  const hoverAt = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    const el = hit && !ours(hit) ? pickAt(hit) : null;
    if (!el) { if (depth === 0) hoverBase = null; return hideBox(); }
    if (el !== hoverBase) { hoverBase = el; depth = 0; }
    drawHover();
  };
  document.addEventListener("mousemove", (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    if (mode && !composer) hoverAt(cursor.x, cursor.y);
  }, true);
  const swallow = (e) => { if (mode && !ours(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick"].forEach((t) => document.addEventListener(t, swallow, true));
  document.addEventListener("click", (e) => {
    if (ours(e.target)) return;
    // Anything open closes on the first click outside it. In comment mode that click does nothing else.
    const somethingOpen = openThread || panelOpen || (composer && !(mode && e.shiftKey));
    if (somethingOpen) {
      if (composer) closeComposer();
      openThread = null; resetCard(); panelOpen = false; panelThread = null; hideBox(); render();
      if (mode) { e.preventDefault(); e.stopPropagation(); if (cursor) hoverAt(cursor.x, cursor.y); }
      return;
    }
    if (!mode) return;
    e.preventDefault(); e.stopPropagation();
    const t = composer && e.shiftKey ? pickAt(e.target) : targetEl();
    if (!t) { if (composer && !e.shiftKey) closeComposer(); return; }
    if (composer && e.shiftKey) { if (t !== composer.el && !composer.alsoEls.includes(t)) composer.alsoEls.push(t); drawComposer(); return; }
    const r = t.getBoundingClientRect();
    const point = r.width && r.height ? { x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3) } : null;
    openComposer(t, null, point);
  }, true);

  // Selected text: comment on those words, with or without comment mode.
  document.addEventListener("mouseup", (e) => {
    if (ours(e.target)) return;
    setTimeout(() => {
      const s = getSelection();
      const txt = s && s.toString().replace(/\s+/g, " ").trim();
      if (!txt || s.rangeCount === 0) { selbtn.style.display = "none"; pendingSel = null; return; }
      const range = s.getRangeAt(0);
      pendingSel = { range, text: txt.slice(0, 500) };
      const r = range.getBoundingClientRect();
      Object.assign(selbtn.style, { display: "flex", left: Math.min(innerWidth - 120, r.right + 6) + "px", top: Math.max(6, r.top - 34) + "px" });
    }, 0);
  });
  selbtn.onmousedown = (e) => e.preventDefault();
  selbtn.onclick = () => {
    if (!pendingSel) return;
    // The smallest element holding all the selected words. (A selection that ends at the start of the
    // next element has the whole section as its common ancestor; start from where it begins instead.)
    const words0 = pendingSel.text;
    let el = pendingSel.range.startContainer;
    if (el.nodeType !== 1) el = el.parentElement;
    while (el && el.parentElement && !text(el).includes(words0)) el = el.parentElement;
    if (!el) { el = pendingSel.range.commonAncestorContainer; if (el.nodeType !== 1) el = el.parentElement; }
    selbtn.style.display = "none";
    const words = pendingSel.text;
    pendingSel = null;
    getSelection().removeAllRanges();
    openComposer(el, words);
  };

  // ---------- keys and buttons ----------
  const typing = (e) => { const p = e.composedPath()[0]; return p && (p.tagName === "TEXTAREA" || p.tagName === "INPUT" || p.isContentEditable); };
  document.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === "c" && plain) { setMode(!mode); e.preventDefault(); }
    else if (e.key === "h" && plain) { pinsHidden = !pinsHidden; render(); }
    else if (e.key === "Escape") {
      if (composer) closeComposer();
      else if (menuOpen) { menuOpen = false; confirmDelete = false; renderThread(); }
      else if (openThread) closeThread();
      else if (panelOpen && panelThread) backToList();
      else if (panelOpen) { panelOpen = false; render(); }
      else if (mode) setMode(false);
    }
    else if (mode && hoverBase && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      depth = Math.max(0, depth + (e.key === "ArrowUp" ? 1 : -1));
      drawHover();
    }
  }, true);
  $(".mode").onclick = () => setMode(!mode);
  $(".count").onclick = () => { panelOpen = !panelOpen; if (panelOpen) { openThread = null; resetCard(); if (mode) setMode(false); } render(); };

  // Keep pins, highlights and cards on their elements while scrolling and resizing.
  let raf = 0;
  const follow = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      renderPins();
      const th = root.querySelector(".card.thread"), c = comments.find((x) => x.id === openThread);
      if (th && c) { placeAt(th, c); const el = located.get(c.id); if (el) showBox(hl, el); }
      if (composer) {
        const cc = root.querySelector(".card.compose");
        if (cc) { const p = composerSpot(); place(cc, p.x, p.y); }
        if (!composer.target.selection) showBox(hl, composer.el);
        [...alsosEl.children].forEach((b, i) => composer.alsoEls[i] && showBox(b, composer.alsoEls[i]));
      } else if (mode && cursor) hoverAt(cursor.x, cursor.y);
    });
  };
  addEventListener("scroll", follow, true);
  addEventListener("resize", follow);

  // ---------- live: reload when the page is rebuilt, refresh when comments change ----------
  const KEY = "cogent:scroll:" + PAGE_PATH;
  try { const y = sessionStorage.getItem(KEY); if (y) { sessionStorage.removeItem(KEY); requestAnimationFrame(() => scrollTo(0, +y)); } } catch (e) {}
  let seen = null;
  const poll = async () => {
    try {
      const s = await fetch(API + "/state?page=" + encodeURIComponent(PAGE_PATH)).then((r) => r.json());
      if (seen && s.files !== seen.files && !composer) {
        try { sessionStorage.setItem(KEY, String(scrollY)); } catch (e) {}
        location.reload();
        return;
      }
      if (seen && s.comments !== seen.comments && !editing) await load();
      seen = s;
    } catch (e) {}
    setTimeout(poll, 1500);
  };
  load().then(poll);
})();
