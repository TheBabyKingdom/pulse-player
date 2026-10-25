// ================= Pulse – app logic =================
const $ = s => document.querySelector(s);
const store = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SRC = { youtube: 'YouTube', ytmusic: 'YouTube Music', soundcloud: 'SoundCloud' };

const state = {
  queue: store.get('queue', []),
  liked: store.get('liked', []),
  recent: store.get('recent', []),
  source: store.get('source', 'youtube'),
  volume: store.get('volume', 80),
  current: -1, playing: false, shuffle: false, repeat: false, results: []
};
const save = () => ['queue', 'liked', 'recent', 'source', 'volume'].forEach(k => store.set(k, state[k]));
const same = (a, b) => a && b && a.source === b.source && a.id === b.id;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------- navigation ----------------
document.querySelectorAll('.rail [data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
function show(view) {
  document.body.classList.remove('focus');
  document.querySelectorAll('.rail [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
  renderAll();
}

// ---------------- source pills ----------------
document.querySelectorAll('.sources button').forEach(b => {
  b.classList.toggle('active', b.dataset.src === state.source);
  b.onclick = () => {
    state.source = b.dataset.src; save();
    document.querySelectorAll('.sources button').forEach(x => x.classList.toggle('active', x === b));
    if ($('#q').value.trim()) doSearch();
  };
});

// ---------------- links ----------------
function parseLink(url) {
  const yt = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (yt) return { source: 'youtube', id: yt[1], title: 'Loading…', artist: 'YouTube', thumb: `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`, dur: '' };
  if (/soundcloud\.com\//.test(url)) return { source: 'soundcloud', id: url.split('?')[0], title: 'Loading…', artist: 'SoundCloud', thumb: '', dur: '' };
  return null;
}
async function enrich(t) {
  try {
    const u = t.source === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + t.id)}`
      : `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(t.id)}`;
    const d = await (await fetch(u)).json();
    if (d.title) t.title = d.title;
    if (d.author_name) t.artist = d.author_name;
    if (d.thumbnail_url && t.source === 'soundcloud') t.thumb = d.thumbnail_url;
  } catch {}
  if (t.title === 'Loading…') t.title = t.id;
  return t;
}

// ---------------- search ----------------
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
$('#clearQ').onclick = () => { $('#q').value = ''; state.results = []; $('#status').textContent = 'Search above, or paste a link and press Enter.'; renderResults(); };

async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  show('search');
  const link = parseLink(q);
  if (link) {
    $('#q').value = '';
    toast('Adding song…');
    addToQueue(await enrich(link), true);
    return;
  }
  $('#status').textContent = `Searching ${SRC[state.source]}…`;
  try {
    state.results = state.source === 'soundcloud' ? await searchSC(q) : await searchYT(q, state.source === 'ytmusic');
    $('#status').textContent = state.results.length ? `Results from ${SRC[state.source]}` : 'No results.';
  } catch (err) {
    state.results = [];
    $('#status').textContent = err.message;
  }
  renderResults();
}

const decode = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
function fmt(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
function iso(p) {
  const m = (p || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return fmt((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

async function searchYT(q, music) {
  const key = store.get('ytKey', '');
  if (!key) throw new Error('To search, add your free YouTube API key in Customise (⚙). Pasting a link always works without one.');
  let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25&q=${encodeURIComponent(q)}&key=${key}`;
  if (music) url += '&videoCategoryId=10';
  const d = await (await fetch(url)).json();
  if (d.error) throw new Error('YouTube said: ' + d.error.message);
  const items = (d.items || []).map(i => ({
    source: 'youtube', id: i.id.videoId, title: decode(i.snippet.title), artist: decode(i.snippet.channelTitle),
    thumb: i.snippet.thumbnails?.medium?.url || '', year: (i.snippet.publishedAt || '').slice(0, 4), dur: ''
  }));
  if (items.length) {
    try {
      const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${items.map(i => i.id).join(',')}&key=${key}`)).json();
      const map = {}; (v.items || []).forEach(x => map[x.id] = iso(x.contentDetails.duration));
      items.forEach(i => i.dur = map[i.id] || '');
    } catch {}
  }
  return items;
}

async function searchSC(q) {
  const id = store.get('scKey', '');
  if (!id) throw new Error('SoundCloud search needs a client ID in Customise (⚙). You can always paste a SoundCloud link into the search bar instead.');
  const r = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=25&client_id=${id}`);
  if (!r.ok) throw new Error('SoundCloud search failed – check your client ID.');
  const d = await r.json();
  return (d.collection || []).map(t => ({
    source: 'soundcloud', id: t.permalink_url, title: t.title, artist: t.user?.username || '',
    thumb: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t300x300'),
    year: (t.created_at || '').slice(0, 4), dur: fmt(t.duration / 1000)
  }));
}

// ---------------- rendering ----------------
const art = (t, cls = '') => t.thumb ? `<img class="${cls}" src="${esc(t.thumb)}" alt="">` : `<div class="${cls} noart">♪</div>`;
const isLiked = t => state.liked.some(x => same(x, t));

function renderList(ul, list, mode) {
  if (!list.length) { ul.innerHTML = `<li class="empty">Nothing here yet.</li>`; return; }
  ul.innerHTML = list.map((t, i) => `
    <li class="track${mode === 'queue' && i === state.current ? ' playing' : ''}" data-i="${i}">
      <span class="index">${i + 1}</span>${art(t)}
      <div class="meta"><span class="title">${esc(t.title)}</span><span class="sub">${esc(t.artist)} · ${SRC[t.source]}</span></div>
      <div class="acts">
        <button data-a="like" title="Like">${isLiked(t) ? '♥' : '♡'}</button>
        ${mode === 'queue' ? '<button data-a="rm" title="Remove">✕</button>' : '<button data-a="add" title="Add to queue">＋</button>'}
      </div>
      <span class="dur">${esc(t.dur || '')}</span>
    </li>`).join('');
  ul.querySelectorAll('li.track').forEach(li => {
    const i = +li.dataset.i, t = list[i];
    li.onclick = e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'like') return toggleLike(t);
      if (a === 'rm') return removeAt(i);
      if (a === 'add') return addToQueue(t, false);
      mode === 'queue' ? play(i) : addToQueue(t, true);
    };
  });
}

function renderResults() {
  const top = state.results.slice(0, 5);
  $('#topHead').style.display = top.length ? '' : 'none';
  $('#tiles').innerHTML = top.map((t, i) => `<div class="tile" data-i="${i}">${art(t)}<b>${esc(t.title)}</b><small>${esc(t.artist)}${t.year ? ' · ' + t.year : ''}</small></div>`).join('');
  $('#tiles').querySelectorAll('.tile').forEach(el => el.onclick = () => addToQueue(state.results[+el.dataset.i], true));
  if (state.results.length) renderList($('#results'), state.results, 'results'); else $('#results').innerHTML = '';
}

function renderAll() {
  renderResults();
  renderList($('#queueList'), state.queue, 'queue');
  renderList($('#likedList'), state.liked, 'liked');
  renderList($('#recentList'), state.recent, 'recent');
  $('#bQueue').textContent = state.queue.length;
  $('#bLiked').textContent = state.liked.length;
  const liked = isLiked(cur());
  $('#barLike').textContent = $('#npLike').textContent = liked ? '♥' : '♡';
  $('#shuffleBtn').classList.toggle('on', state.shuffle);
  $('#repeatBtn').classList.toggle('on', state.repeat);
}

// ---------------- queue / likes ----------------
function addToQueue(t, playNow) {
  if (!t) return;
  let i = state.queue.findIndex(x => same(x, t));
  if (i < 0) { state.queue.push({ ...t }); i = state.queue.length - 1; }
  save();
  if (playNow) play(i); else { toast('Added to queue'); renderAll(); }
}
function removeAt(i) {
  state.queue.splice(i, 1);
  if (i < state.current) state.current--;
  else if (i === state.current) { stopAll(); state.current = -1; state.playing = false; updateNow(); updateBtn(); }
  save(); renderAll();
}
function toggleLike(t) {
  if (!t) return;
  state.liked = isLiked(t) ? state.liked.filter(x => !same(x, t)) : [{ ...t }, ...state.liked];
  save(); renderAll();
}
$('#clearQueue').onclick = () => { stopAll(); state.queue = []; state.current = -1; state.playing = false; save(); updateNow(); updateBtn(); renderAll(); };

// ---------------- playback ----------------
let yt = null, ytReady = false, sc = null, scPos = 0, scDur = 0;

window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('ytPlayer', {
    width: '100%', height: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => { ytReady = true; yt.setVolume(state.volume); },
      onStateChange: e => {
        if (e.data === YT.PlayerState.ENDED) ended();
        if (e.data === YT.PlayerState.PLAYING) { state.playing = true; updateBtn(); }
        if (e.data === YT.PlayerState.PAUSED) { state.playing = false; updateBtn(); }
      },
      onError: () => { toast("This video can't be played inside apps – skipping"); setTimeout(next, 1200); }
    }
  });
};

const cur = () => state.queue[state.current];

function stopAll() {
  try { if (ytReady) yt.stopVideo(); } catch {}
  if (sc) { try { sc.pause(); } catch {} sc = null; $('#scFrame').src = 'about:blank'; }
  $('#artBox').dataset.mode = 'none';
}

function play(i) {
  if (i < 0 || i >= state.queue.length) return;
  const t = state.queue[i];
  if (t.source === 'youtube' && !ytReady) { toast('Player loading…'); setTimeout(() => play(i), 800); return; }
  stopAll();
  state.current = i; scPos = 0; scDur = 0;
  $('#artBox').dataset.mode = t.source;
  if (t.source === 'youtube') {
    yt.loadVideoById(t.id);
  } else {
    const f = $('#scFrame');
    f.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(t.id)}&auto_play=true&visual=true&show_comments=false&hide_related=true&show_teaser=false`;
    const w = SC.Widget(f); sc = w;
    w.bind(SC.Widget.Events.READY, () => { w.setVolume(state.volume); w.play(); w.getDuration(d => scDur = d / 1000); });
    w.bind(SC.Widget.Events.PLAY_PROGRESS, e => { scPos = e.currentPosition / 1000; });
    w.bind(SC.Widget.Events.PLAY, () => { state.playing = true; updateBtn(); });
    w.bind(SC.Widget.Events.PAUSE, () => { state.playing = false; updateBtn(); });
    w.bind(SC.Widget.Events.FINISH, ended);
  }
  state.playing = true;
  state.recent = [{ ...t }, ...state.recent.filter(x => !same(x, t))].slice(0, 50);
  save(); updateNow(); updateBtn(); renderAll();
}

function toggle() {
  const t = cur();
  if (!t) { if (state.queue.length) play(0); else toast('Add a song first'); return; }
  if (t.source === 'youtube') state.playing ? yt.pauseVideo() : yt.playVideo();
  else if (sc) state.playing ? sc.pause() : sc.play();
  state.playing = !state.playing; updateBtn();
}
function next() {
  if (!state.queue.length) return;
  let n = state.shuffle && state.queue.length > 1
    ? (state.current + 1 + Math.floor(Math.random() * (state.queue.length - 1))) % state.queue.length
    : state.current + 1;
  if (n >= state.queue.length) n = 0;
  play(n);
}
function prev() {
  if (position() > 3) return seek(0);
  play(Math.max(0, state.current - 1));
}
function ended() {
  if (state.repeat) return play(state.current);
  if (!state.shuffle && state.current >= state.queue.length - 1) { state.playing = false; updateBtn(); return; }
  next();
}
function position() { const t = cur(); if (!t) return 0; return t.source === 'youtube' ? (ytReady ? yt.getCurrentTime() || 0 : 0) : scPos; }
function duration() { const t = cur(); if (!t) return 0; return t.source === 'youtube' ? (ytReady ? yt.getDuration() || 0 : 0) : scDur; }
function seek(s) { const t = cur(); if (!t) return; if (t.source === 'youtube') yt.seekTo(s, true); else if (sc) sc.seekTo(s * 1000); }

setInterval(() => {
  const p = position(), d = duration();
  $('#elapsed').textContent = fmt(p);
  $('#total').textContent = fmt(d);
  $('#progressFill').style.width = (d ? Math.min(100, p / d * 100) : 0) + '%';
  const t = cur();
  if (t && !t.dur && d > 0) { t.dur = fmt(d); save(); }
}, 500);

$('#progress').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * duration()); };

function updateBtn() {
  $('#playBtn').textContent = state.playing ? '❚❚' : '▶';
  $('#barArt').classList.toggle('spin', state.playing);
}
function updateNow() {
  const t = cur();
  $('#npTitle').textContent = $('#barTitle').textContent = t ? t.title : 'Nothing playing';
  $('#npArtist').textContent = $('#barArtist').textContent = t ? t.artist : '';
  const ba = $('#barArt');
  ba.style.backgroundImage = t && t.thumb ? `url("${t.thumb}")` : '';
  ba.textContent = t && t.thumb ? '' : '♪';
  document.title = t ? `${t.title} – Pulse` : 'Pulse';
}

// controls
$('#playBtn').onclick = toggle;
$('#nextBtn').onclick = next;
$('#prevBtn').onclick = prev;
$('#shuffleBtn').onclick = () => { state.shuffle = !state.shuffle; toast(state.shuffle ? 'Shuffle on' : 'Shuffle off'); renderAll(); };
$('#repeatBtn').onclick = () => { state.repeat = !state.repeat; toast(state.repeat ? 'Repeat one on' : 'Repeat off'); renderAll(); };
$('#barLike').onclick = $('#npLike').onclick = () => toggleLike(cur());
$('#queueBtn').onclick = $('#npQueue').onclick = () => show('queue');
$('#npFocus').onclick = () => document.body.classList.toggle('focus');
$('#npClose').onclick = () => { layout.nowPanel = false; store.set('layout', layout); applyTheme(); };

const vol = $('#vol');
vol.value = state.volume;
vol.oninput = () => {
  state.volume = +vol.value; save();
  try { if (ytReady) yt.setVolume(state.volume); } catch {}
  if (sc) sc.setVolume(state.volume);
};

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowRight' && e.ctrlKey) next();
  if (e.code === 'ArrowLeft' && e.ctrlKey) prev();
  if (e.code === 'Escape') document.body.classList.remove('focus');
});

// ---------------- customisation ----------------
const DEFAULT_THEME = {
  '--bg': '#0a0a0a', '--panel': '#141414', '--panel-2': '#1f1f1f', '--text': '#f2f2f2', '--muted': '#8a8a8a',
  '--accent': '#ffffff', '--accent-text': '#0a0a0a', '--radius': '16px', '--gap': '14px',
  '--font': "system-ui, 'Segoe UI', sans-serif"
};
const PRESETS = {
  Midnight: {},
  Spotify: { '--accent': '#1db954', '--accent-text': '#000000' },
  Sunset: { '--accent': '#ff7a59', '--accent-text': '#140b0b', '--bg': '#140b0b', '--panel': '#1f1212', '--panel-2': '#2c1a1a' },
  Ocean: { '--accent': '#4cc9f0', '--accent-text': '#07111a', '--bg': '#07111a', '--panel': '#0e1b27', '--panel-2': '#172a3a' },
  Rose: { '--accent': '#ff6fa8', '--accent-text': '#160a10', '--bg': '#100a0d', '--panel': '#1a1015', '--panel-2': '#28171f' },
  Light: { '--bg': '#ececec', '--panel': '#ffffff', '--panel-2': '#e8e8e8', '--text': '#111111', '--muted': '#6b6b6b', '--accent': '#111111', '--accent-text': '#ffffff' }
};
let theme = { ...DEFAULT_THEME, ...store.get('theme', {}) };
let layout = { nowPanel: true, compact: false, ...store.get('layout', {}) };

function applyTheme() {
  for (const [k, v] of Object.entries(theme)) document.documentElement.style.setProperty(k, v);
  document.querySelectorAll('[data-var]').forEach(el => {
    const v = theme[el.dataset.var] || '';
    el.value = el.dataset.unit ? parseInt(v) : v;
  });
  document.body.classList.toggle('no-now', !layout.nowPanel);
  document.body.classList.toggle('compact', layout.compact);
  $('#optNow').checked = layout.nowPanel;
  $('#optCompact').checked = layout.compact;
}
document.querySelectorAll('[data-var]').forEach(el => el.oninput = () => {
  theme[el.dataset.var] = el.value + (el.dataset.unit || '');
  store.set('theme', theme); applyTheme();
});
$('#presets').innerHTML = Object.entries(PRESETS).map(([name, p]) => {
  const t = { ...DEFAULT_THEME, ...p };
  return `<button data-p="${name}"><i style="background:${t['--bg']};border:3px solid ${t['--accent']}"></i>${name}</button>`;
}).join('');
$('#presets').querySelectorAll('button').forEach(b => b.onclick = () => {
  theme = { ...DEFAULT_THEME, ...PRESETS[b.dataset.p], '--radius': theme['--radius'], '--gap': theme['--gap'], '--font': theme['--font'] };
  store.set('theme', theme); applyTheme();
});
$('#optNow').onchange = e => { layout.nowPanel = e.target.checked; store.set('layout', layout); applyTheme(); };
$('#optCompact').onchange = e => { layout.compact = e.target.checked; store.set('layout', layout); applyTheme(); };
$('#resetTheme').onclick = () => { theme = { ...DEFAULT_THEME }; layout = { nowPanel: true, compact: false }; store.set('theme', theme); store.set('layout', layout); applyTheme(); toast('Look reset'); };
$('#resetData').onclick = () => {
  if (!confirm('Remove your queue, liked songs and history?')) return;
  stopAll(); Object.assign(state, { queue: [], liked: [], recent: [], current: -1, playing: false });
  save(); updateNow(); updateBtn(); renderAll(); toast('Cleared');
};

const ytKey = $('#ytKey'), scKey = $('#scKey');
ytKey.value = store.get('ytKey', ''); scKey.value = store.get('scKey', '');
ytKey.onchange = () => { store.set('ytKey', ytKey.value.trim()); toast('YouTube key saved'); };
scKey.onchange = () => { store.set('scKey', scKey.value.trim()); toast('SoundCloud ID saved'); };

applyTheme();
renderAll();
