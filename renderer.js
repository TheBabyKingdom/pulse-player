// ================= Pulse – app logic (polish build) =================
const $ = s => document.querySelector(s);
const store = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SRC = { youtube: 'YouTube', ytmusic: 'YouTube Music', soundcloud: 'SoundCloud', local: 'This PC' };
const uid = () => Math.random().toString(36).slice(2, 9);

const state = {
  queue: store.get('queue', []),
  liked: store.get('liked', []),
  recent: store.get('recent', []),
  playlists: store.get('playlists', []),
  openList: store.get('openList', ''),
  source: store.get('source', 'youtube'),
  volume: store.get('volume', 80),
  current: -1, playing: false, shuffle: false, repeat: false, results: [],
  failed: store.get('failed', []),
  stage: store.get('stage', 'video'),
  lyrics: null, lyricLine: -1, lyricsFor: null,
  playerDead: false
};
const save = () => ['queue', 'liked', 'recent', 'playlists', 'openList', 'source', 'volume', 'stage', 'failed']
  .forEach(k => store.set(k, state[k]));
const same = (a, b) => a && b && a.source === b.source && a.id === b.id;
const keyOf = t => t ? t.source + ':' + t.id : '';
const isFailed = t => state.failed.includes(keyOf(t));
const findList = id => state.playlists.find(p => p.id === id);
const isLocal = t => t && t.source === 'local';

function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
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

// ---------------- local files ----------------
const localTracks = () => state.queue.filter(isLocal);

async function addLocalFiles() {
  if (!window.pulse) {
    return toast('Local files need the desktop app — update main.js and preload.js first.', 6000);
  }
  let res;
  try { res = await window.pulse.pickAudio(); }
  catch { return toast('Could not open the file picker.'); }
  if (!res.added.length && !res.skipped.length) return;

  let n = 0;
  for (const f of res.added) {
    const clean = f.name.replace(/\.[^.]+$/, '');
    const parts = clean.split(/\s+[-–—]\s+/);
    const t = {
      source: 'local', id: f.file, file: f.file,
      title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : clean,
      artist: parts.length > 1 ? parts[0].trim() : 'This PC',
      thumb: '', dur: ''
    };
    if (addTrackIfNew(t)) n++;
  }
  save(); renderAll();
  $('#localNote').textContent = res.skipped.length
    ? `Added ${n}. Skipped ${res.skipped.length} unsupported file${res.skipped.length === 1 ? '' : 's'}.`
    : `Added ${n} file${n === 1 ? '' : 's'}.`;
  toast(n ? `Added ${n} file${n === 1 ? '' : 's'}` : 'Those files are already in your library');
}

const makeLocalUrl = t => `/music/${encodeURIComponent(t.file || t.id.replace(/^local:/, ''))}`;

$('#pickFiles').onclick = addLocalFiles;
$('#openFolder').onclick = () => window.pulse?.openFolder?.();
$('#pickFiles2').onclick = addLocalFiles;

function removeLocalTrack(t) {
  if (!t) return;
  if (!confirm(`Remove “${t.title}” from the app?\n\nThe copied file is deleted. Your original file is not touched.`)) return;
  window.pulse?.removeLocal?.(t.file || t.id.replace(/^local:/, ''));
  state.queue = state.queue.filter(x => !same(x, t));
  state.liked = state.liked.filter(x => !same(x, t));
  state.recent = state.recent.filter(x => !same(x, t));
  state.playlists.forEach(p => p.tracks = p.tracks.filter(x => !same(x, t)));
  save(); renderAll();
  toast('Removed');
}

// ---------------- links ----------------
function parseLink(url) {
  const yt = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (yt) return { source: 'youtube', id: yt[1], title: 'Loading…', artist: 'YouTube', thumb: `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`, dur: '' };
  if (/soundcloud\.com\//.test(url)) return { source: 'soundcloud', id: url.split('?')[0], title: 'Loading…', artist: 'SoundCloud', thumb: '', dur: '' };
  return null;
}
function isPlaylistLink(url) {
  const ytList = url.match(/[?&]list=([\w-]+)/);
  if (ytList) return { kind: 'ytplaylist', id: ytList[1] };
  if (/soundcloud\.com\/[^/]+\/sets\//.test(url)) return { kind: 'scset', id: url.split('?')[0] };
  if (/open\.spotify\.com\/playlist\//.test(url)) return { kind: 'spotify', id: url.split('?')[0] };
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

// ---------------- playlist import ----------------
async function importYouTubePlaylist(listId) {
  const key = store.get('ytKey', '');
  if (!key) throw new Error('Importing a YouTube playlist needs your free API key (Customise ⚙).');
  const out = [];
  let pageToken = '', guard = 0;
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${key}` +
                (pageToken ? '&pageToken=' + pageToken : '');
    const d = await (await fetch(url)).json();
    if (d.error) throw new Error('YouTube said: ' + d.error.message);
    for (const it of d.items || []) {
      const sn = it.snippet || {};
      if (sn.title === 'Deleted video' || sn.title === 'Private video') continue;
      if (!sn.resourceId?.videoId) continue;
      out.push({
        source: 'youtube', id: sn.resourceId.videoId, title: decode(sn.title),
        artist: decode(sn.videoOwnerChannelTitle || sn.channelTitle || '').replace(/ - Topic$/, ''),
        thumb: sn.thumbnails?.medium?.url || '', dur: ''
      });
    }
    pageToken = d.nextPageToken || '';
  } while (pageToken && ++guard < 12);
  for (let i = 0; i < out.length; i += 50) {
    const ids = out.slice(i, i + 50).map(t => t.id);
    try {
      const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${key}`)).json();
      const map = {}; (v.items || []).forEach(x => map[x.id] = iso(x.contentDetails.duration));
      out.forEach(t => { if (!t.dur && map[t.id]) t.dur = map[t.id]; });
    } catch {}
  }
  return out;
}

async function importSoundCloudSet(setUrl) {
  const id = store.get('scKey', '');
  if (!id) throw new Error('Importing a SoundCloud set needs your client ID (Customise ⚙).');
  const r = await fetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(setUrl)}&client_id=${id}`);
  if (!r.ok) throw new Error('SoundCloud could not read that set – check your client ID.');
  const d = await r.json();
  if (!d.tracks || !d.tracks.length) throw new Error('That set has no readable tracks.');
  return d.tracks.filter(t => t && t.permalink_url).map(t => ({
    source: 'soundcloud', id: t.permalink_url, title: t.title, artist: t.user?.username || '',
    thumb: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t300x300'),
    year: (t.created_at || '').slice(0, 4), dur: fmt(t.duration / 1000)
  }));
}

async function importSpotify(url) {
  const out = [];
  const page = await (await fetch(url)).text();
  const m = page.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not read that Spotify playlist. Try pasting the track names instead.');
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new Error('Could not read that Spotify playlist.'); }
  const items = data?.props?.pageProps?.state?.data?.entity?.trackList
             || data?.props?.pageProps?.state?.data?.entity?.tracks?.items || [];
  if (!items.length) throw new Error('That Spotify playlist came back empty.');
  for (const it of items) {
    const title = it.title || it.track?.name;
    const artist = it.subtitle || it.track?.artists?.map(a => a.name).join(', ');
    if (!title) continue;
    const found = await findOnYouTube(`${artist || ''} ${title}`.trim());
    if (found) out.push({ ...found, title, artist: artist || found.artist });
  }
  return out;
}

async function findOnYouTube(q) {
  const key = store.get('ytKey', '');
  if (!key) return null;
  try {
    const d = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(q)}&key=${key}`)).json();
    const i = (d.items || [])[0];
    if (!i) return null;
    return {
      source: 'youtube', id: i.id.videoId, title: decode(i.snippet.title),
      artist: decode(i.snippet.channelTitle), thumb: i.snippet.thumbnails?.medium?.url || '', dur: ''
    };
  } catch { return null; }
}

async function importFromText(text, intoList) {
  const lines = String(text).split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return toast('Nothing to import');
  $('#importGo').disabled = true;
  $('#importNote').textContent = 'Working…';
  let added = 0, skipped = 0;

  for (const line of lines) {
    try {
      const pl = isPlaylistLink(line);
      if (pl) {
        const tracks = pl.kind === 'ytplaylist' ? await importYouTubePlaylist(pl.id)
                     : pl.kind === 'scset' ? await importSoundCloudSet(pl.id)
                     : await importSpotify(pl.id);
        for (const t of tracks) { place(t, intoList) ? added++ : skipped++; }
        $('#importNote').textContent = `Imported ${added} so far…`;
        continue;
      }
      const t = parseLink(line);
      if (!t) { skipped++; continue; }
      await enrich(t);
      place(t, intoList) ? added++ : skipped++;
    } catch (err) {
      skipped++;
      $('#importNote').textContent = err.message;
    }
  }
  save(); renderAll();
  $('#importGo').disabled = false;
  $('#importNote').textContent = `Imported ${added} song${added === 1 ? '' : 's'}` + (skipped ? ` · skipped ${skipped}` : '');
  toast(`Imported ${added} song${added === 1 ? '' : 's'}`);
  if (added) $('#pasteBox').value = '';
}

function place(t, listId) {
  if (!t || !t.id) return false;
  const list = listId ? findList(listId) : null;
  if (list) {
    if (list.tracks.some(x => same(x, t))) return false;
    list.tracks.push({ ...t });
    return true;
  }
  return addTrackIfNew(t);
}
function addTrackIfNew(t) {
  if (!t || !t.id) return false;
  if (state.queue.some(x => same(x, t))) return false;
  state.queue.push({ ...t });
  return true;
}

$('#importGo').onclick = () => importFromText($('#pasteBox').value, $('#importTarget').value);
$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('#pasteBox').value = await f.text();
  e.target.value = '';
  toast('File loaded – press Import');
};
$('#exportQueue').onclick = () => {
  const list = state.openList ? findList(state.openList) : null;
  const tracks = list ? list.tracks : state.queue;
  const name = list ? list.name : 'queue';
  if (!tracks.length) return toast('Nothing to export yet');
  const text = tracks.map(t => t.source === 'youtube'
    ? `https://www.youtube.com/watch?v=${t.id}`
    : t.source === 'local' ? `(local file) ${t.file}` : t.id).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `pulse-${name.replace(/[^\w -]/g, '')}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Saved as a text file');
};

// ---------------- verifying playable tracks ----------------
// YouTube doesn't publish which videos allow embedding, so the only way to
// know is to try. This walks the queue and drops tracks that refuse.
let verifying = false;
async function verifyAll() {
  if (verifying) return toast('Already checking');
  if (!ytReady) return toast('Wait for the player to load first');
  verifying = true;
  $('#verifyGo').disabled = true;
  const before = state.failed.length;
  let checked = 0;
  const restore = { queue: state.queue.slice(), current: state.current, playing: false };

  for (const t of state.queue) {
    if (t.source !== 'youtube') { checked++; continue; }
    $('#verifyNote').textContent = `Checking ${++checked} of ${state.queue.length}…`;
    const ok = await testVideo(t);
    if (!ok && !state.failed.includes(keyOf(t))) state.failed.push(keyOf(t));
  }

  state.queue = restore.queue;
  state.current = -1;
  save(); renderAll();
  $('#verifyGo').disabled = false;
  verifying = false;
  const found = state.failed.length - before;
  $('#verifyNote').textContent = found
    ? `Found ${found} song${found === 1 ? '' : 's'} that won't play.`
    : 'Everything plays.';
  toast(found ? `${found} broken song${found === 1 ? '' : 's'} marked` : 'Everything plays');
}

// Plays a video silently for a moment and reports whether YouTube accepted it.
function testVideo(t) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      try { yt.stopVideo(); } catch {}
      resolve(ok);
    };
    const onErr = e => { if (e.data === 100 || e.data === 101 || e.data === 150 || e.data === 5) finish(false); };
    const onState = e => { if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.CUED) finish(true); };
    yt.addEventListener('onError', onErr);
    yt.addEventListener('onStateChange', onState);
    try { yt.mute(); yt.loadVideoById(t.id); } catch { finish(false); }
    setTimeout(() => {
      try { yt.removeEventListener('onError'); yt.removeEventListener('onStateChange'); yt.unMute(); } catch {}
      finish(!state.failed.includes(keyOf(t)));
    }, 3500);
  });
}

$('#verifyGo').onclick = verifyAll;
$('#optHideBroken').onchange = e => {
  layout.hideBroken = e.target.checked;
  store.set('layout', layout);
  save(); renderAll();
};

// ---------------- playlists ----------------
$('#newList').onclick = () => {
  const name = prompt('Name this playlist');
  if (!name) return;
  const p = { id: uid(), name: name.trim(), tracks: [] };
  state.playlists.unshift(p);
  state.openList = p.id;
  save(); renderAll();
  toast(`Created “${p.name}”`);
};
$('#addToPlaylist').onclick = () => {
  const t = cur();
  if (!t) return toast('Play something first');
  if (!state.playlists.length) return toast('Create a playlist first');
  const reply = prompt('Add to which playlist?\n\n' + state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n') + '\n\nType a number or the name.');
  if (!reply) return;
  const byNum = state.playlists[+reply - 1];
  const found = byNum || state.playlists.find(p => p.name.toLowerCase() === reply.trim().toLowerCase());
  if (!found) return toast('No playlist by that name');
  if (found.tracks.some(x => same(x, t))) return toast('Already in there');
  found.tracks.push({ ...t });
  save(); renderAll();
  toast(`Added to “${found.name}”`);
};
function renameList(id) {
  const p = findList(id); if (!p) return;
  const name = prompt('Rename playlist', p.name);
  if (!name) return;
  p.name = name.trim(); save(); renderAll();
}
function deleteList(id) {
  const p = findList(id); if (!p) return;
  if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
  state.playlists = state.playlists.filter(x => x.id !== id);
  if (state.openList === id) state.openList = '';
  save(); renderAll();
  toast('Playlist deleted');
}
function playList(id) {
  const p = findList(id); if (!p || !p.tracks.length) return toast('That playlist is empty');
  state.queue = p.tracks.map(t => ({ ...t }));
  state.current = -1;
  save(); renderAll(); play(0);
  toast(`Playing “${p.name}”`);
}
function queueList(id) {
  const p = findList(id); if (!p) return;
  let n = 0;
  for (const t of p.tracks) if (addTrackIfNew({ ...t })) n++;
  save(); renderAll();
  toast(n ? `Added ${n} to the queue` : 'Already in the queue');
}
function openList_(id) { state.openList = id; save(); renderAll(); }

// ---------------- search ----------------
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
$('#clearQ').onclick = () => { $('#q').value = ''; state.results = []; $('#status').textContent = 'Search above, or paste a link and press Enter.'; renderResults(); };

async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  const pl = isPlaylistLink(q);
  if (pl) {
    $('#q').value = '';
    show('import');
    $('#pasteBox').value = q;
    toast('Reading playlist…', 6000);
    await importFromText(q, '');
    return;
  }
  show('search');
  const link = parseLink(q);
  if (link) {
    $('#q').value = '';
    toast('Adding song…');
    addToQueue(await enrich(link), true);
    return;
  }
  if (state.source === 'local') {
    const hits = localTracks().filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q.toLowerCase()));
    state.results = hits;
    $('#status').textContent = hits.length ? 'Results from this PC' : 'Nothing on this PC matches.';
    return renderResults();
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

// ---------------- lyrics ----------------
const NOISE = /\((?:official|lyric|audio|video|hd|hq|4k|remaster(?:ed)?|visuali[sz]er|music video|mv|explicit|clean)[^)]*\)|\[(?:official|lyric|audio|video|hd|hq|4k|mv)[^\]]*\]/gi;

function splitTitle(t) {
  let title = String(t.title || '').replace(NOISE, ' ');
  let artist = String(t.artist || '').trim();
  const dash = title.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    const left = dash[0].trim(), right = dash.slice(1).join(' - ').trim();
    if (left.length > 1 && left.length < 60) { artist = left; title = right; }
  }
  title = title.replace(/\b(feat|ft|featuring)\.?\s+[^(\[]+/gi, '').replace(/["']/g, '').trim();
  title = title.replace(/\s{2,}/g, ' ').replace(/\s*[-–—]\s*$/, '').trim();
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  if (artist === 'This PC') artist = '';
  return { artist, title };
}

async function fetchLyrics(t) {
  const { artist, title } = splitTitle(t);
  const url = 'https://lrclib.net/api/search?track_name=' + encodeURIComponent(title) +
              (artist ? '&artist_name=' + encodeURIComponent(artist) : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Lyrics lookup failed');
  const hits = await r.json();
  if (!hits || !hits.length) return { synced: false, lines: [], missing: true, artist, title };
  const synced = hits.find(h => h.syncedLyrics) || null;
  const plain = hits.find(h => h.plainLyrics) || null;
  const pick = synced || plain;
  if (!pick) return { synced: false, lines: [], missing: true, artist, title };
  if (synced) return { synced: true, lines: parseLRC(synced.syncedLyrics), artist, title, name: pick.trackName, by: pick.artistName };
  return {
    synced: false,
    lines: String(plain.plainLyrics).split('\n').map(s => ({ time: null, text: s })),
    artist, title, name: plain.trackName, by: plain.artistName
  };
}

function parseLRC(lrc) {
  const out = [];
  for (const raw of String(lrc).split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!stamps.length) continue;
    for (const s of stamps) out.push({ time: (+s[1]) * 60 + parseFloat(s[2]), text });
  }
  return out.sort((a, b) => a.time - b.time);
}

async function loadLyrics(t) {
  if (!t) return;
  const key = keyOf(t);
  state.lyricsFor = key;
  state.lyrics = null;
  state.lyricLine = -1;
  renderStage();
  try { state.lyrics = await fetchLyrics(t); }
  catch { state.lyrics = { synced: false, lines: [], missing: true, error: true }; }
  if (state.lyricsFor !== key) return;
  renderStage();
}

function renderStage() {
  const box = $('#artBox');
  const wantLyrics = state.stage === 'lyrics' && state.lyricsFor === keyOf(cur());
  box.dataset.stage = wantLyrics ? 'lyrics' : 'video';
  $('#lyricsBtn').classList.toggle('on', state.stage === 'lyrics');
  if (!wantLyrics) return;

  const pane = $('#lyrics');
  const L = state.lyrics;
  if (!L) { pane.innerHTML = `<p class="lyr-empty">${svg('clock', 22)} Looking for lyrics…</p>`; return; }
  if (L.missing || !L.lines.length) {
    pane.innerHTML = `<p class="lyr-empty">${svg('lyrics', 22)}<br>No lyrics found for this one.<br><small>Try the search box below.</small></p>`;
    return;
  }
  pane.innerHTML =
    `<p class="lyr-head">${esc(L.name || '')}${L.by ? ' — ' + esc(L.by) : ''}${L.synced ? '' : ' · not timed'}</p>` +
    `<div class="lyr-body">${L.lines.map((l, i) => `<p class="lyr-line" data-i="${i}">${esc(l.text) || '&nbsp;'}</p>`).join('')}</div>`;
  pane.querySelectorAll('.lyr-line').forEach(el => el.onclick = () => {
    const l = state.lyrics.lines[+el.dataset.i];
    if (l && l.time != null) { seek(l.time); scrollLyrics(+el.dataset.i, true); }
  });
}

function highlightLyrics(pos) {
  if (state.stage !== 'lyrics' || !state.lyrics || !state.lyrics.synced) return;
  const lines = state.lyrics.lines;
  let i = -1;
  for (let k = 0; k < lines.length; k++) { if (lines[k].time <= pos + 0.2) i = k; else break; }
  if (i === state.lyricLine) return;
  state.lyricLine = i;
  scrollLyrics(i, false);
}

function scrollLyrics(i) {
  const pane = $('#lyrics');
  const el = pane.querySelector(`.lyr-line[data-i="${i}"]`);
  pane.querySelectorAll('.lyr-line.active').forEach(x => x.classList.remove('active'));
  if (!el) return;
  el.classList.add('active');
  const box = pane.querySelector('.lyr-body');
  if (!box) return;
  const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

$('#lyrSearch').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) return;
  const t = cur();
  if (!t) return toast('Play something first');
  state.lyrics = null; state.lyricsFor = keyOf(t); renderStage();
  try {
    const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q));
    const hits = await r.json();
    const synced = hits.find(h => h.syncedLyrics);
    const plain = hits.find(h => h.plainLyrics);
    const pick = synced || plain;
    if (!pick) state.lyrics = { synced: false, lines: [], missing: true };
    else if (synced) state.lyrics = { synced: true, lines: parseLRC(synced.syncedLyrics), name: pick.trackName, by: pick.artistName };
    else state.lyrics = { synced: false, lines: String(plain.plainLyrics).split('\n').map(s => ({ time: null, text: s })), name: plain.trackName, by: plain.artistName };
  } catch { state.lyrics = { synced: false, lines: [], missing: true }; }
  renderStage();
});

// ---------------- rendering ----------------
const art = (t, cls = '') => t.thumb
  ? `<img class="${cls}" src="${esc(t.thumb)}" alt="">`
  : `<div class="${cls} noart">${svg(isLocal(t) ? 'disc' : 'lyrics', 20)}</div>`;
const isLiked = t => state.liked.some(x => same(x, t));

// the filter that hides songs YouTube won't play
const hideBroken = t => layout.hideBroken && isFailed(t);
const shown = list => list.filter(t => !hideBroken(t));

function renderList(ul, list, mode) {
  const visible = shown(list);
  if (!visible.length) {
    ul.innerHTML = `<li class="empty">Nothing here yet.</li>`;
    return;
  }
  ul.innerHTML = visible.map((t, i) => `
    <li class="track${mode === 'queue' && same(t, cur()) ? ' playing' : ''}${isFailed(t) ? ' failed' : ''}${isLocal(t) ? ' local' : ''}" data-i="${list.indexOf(t)}">
      <span class="index">${i + 1}</span>${art(t)}
      <div class="meta">
        <span class="title">${esc(t.title)}</span>
        <span class="sub">${esc(t.artist)} · ${SRC[t.source]}${isFailed(t) ? ' · won\\'t play in apps' : ''}</span>
      </div>
      <div class="hover-controls">
        <button data-a="play" class="hc" title="${same(t, cur()) && state.playing ? 'Pause' : 'Play'}">${svg(same(t, cur()) && state.playing ? 'pause' : 'play', 16)}</button>
        <button data-a="prev" class="hc" title="Back">${svg('prev', 16)}</button>
        <button data-a="next" class="hc" title="Skip">${svg('next', 16)}</button>
      </div>
      <div class="acts">
        <button data-a="like" title="Like">${svg(isLiked(t) ? 'heartOn' : 'heart', 17)}</button>
        <button data-a="topl" title="Add to a playlist">${svg('plus', 17)}</button>
        ${isLocal(t) ? `<button data-a="delf" title="Remove from app">${svg('trash', 17)}</button>` : ''}
        ${mode === 'queue' ? `<button data-a="rm" title="Remove">${svg('close', 17)}</button>`
                           : `<button data-a="add" title="Add to queue">${svg('upload', 17)}</button>`}
      </div>
      <span class="dur">${esc(t.dur || '')}</span>
    </li>`).join('');

  ul.querySelectorAll('li.track').forEach(li => {
    const i = +li.dataset.i, t = list[i];
    li.onclick = e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'like') return toggleLike(t);
      if (a === 'topl') return addTrackToPlaylist(t);
      if (a === 'delf') return removeLocalTrack(t);
      if (a === 'rm') return removeAt(i);
      if (a === 'add') return addToQueue(t, false);
      if (a === 'play') {
        if (mode === 'queue') return same(t, cur()) ? toggle() : play(i);
        return addToQueue(t, true);
      }
      if (a === 'prev') return prev();
      if (a === 'next') return next();
      mode === 'queue' ? play(i) : addToQueue(t, true);
    };
  });
}

function addTrackToPlaylist(t) {
  if (!state.playlists.length) return toast('Create a playlist first');
  const reply = prompt('Add “' + t.title.slice(0, 40) + '” to which playlist?\n\n' +
    state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n') + '\n\nType a number or the name.');
  if (!reply) return;
  const p = state.playlists[+reply - 1] || state.playlists.find(x => x.name.toLowerCase() === reply.trim().toLowerCase());
  if (!p) return toast('No playlist by that name');
  if (p.tracks.some(x => same(x, t))) return toast('Already in there');
  p.tracks.push({ ...t });
  save(); renderAll();
  toast(`Added to “${p.name}”`);
}

function renderResults() {
  const list = shown(state.results);
  const top = list.slice(0, 5);
  $('#topHead').style.display = top.length ? '' : 'none';
  $('#tiles').innerHTML = top.map((t, i) => `<div class="tile" data-i="${i}">${art(t)}<b>${esc(t.title)}</b><small>${esc(t.artist)}${t.year ? ' · ' + t.year : ''}</small></div>`).join('');
  $('#tiles').querySelectorAll('.tile').forEach(el => el.onclick = () => addToQueue(state.results[+el.dataset.i], true));
  state.results = list;
  if (list.length) renderList($('#results'), list, 'results'); else $('#results').innerHTML = '';
}

function renderPlaylists() {
  const open = state.openList ? findList(state.openList) : null;
  $('#plIndex').style.display = open ? 'none' : 'block';
  $('#plDetail').style.display = open ? 'block' : 'none';
  if (open) {
    $('#plName').textContent = open.name;
    $('#plCount').textContent = `${open.tracks.length} song${open.tracks.length === 1 ? '' : 's'}`;
    renderList($('#plTracks'), open.tracks, 'playlist');
    return;
  }
  const grid = $('#plGrid');
  if (!state.playlists.length) {
    grid.innerHTML = '<p class="empty">No playlists yet. Press <b>New playlist</b> to make one.</p>';
    return;
  }
  grid.innerHTML = state.playlists.map(p => `
    <div class="pl-card" data-id="${p.id}">
      <div class="pl-art">${p.tracks[0]?.thumb ? `<img src="${esc(p.tracks[0].thumb)}" alt="">` : svg('disc', 30)}</div>
      <b>${esc(p.name)}</b>
      <small>${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}</small>
      <div class="pl-acts">
        <button data-a="play" title="Play">${svg('play', 17)}</button>
        <button data-a="queue" title="Add to queue">${svg('upload', 17)}</button>
        <button data-a="rename" title="Rename">${svg('edit', 17)}</button>
        <button data-a="del" title="Delete">${svg('trash', 17)}</button>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.pl-card').forEach(card => {
    const id = card.dataset.id;
    card.onclick = e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'play') return playList(id);
      if (a === 'queue') return queueList(id);
      if (a === 'rename') return renameList(id);
      if (a === 'del') return deleteList(id);
      openList_(id);
    };
  });
}

function renderAll() {
  renderResults();
  renderList($('#queueList'), state.queue, 'queue');
  renderList($('#likedList'), state.liked, 'liked');
  renderList($('#recentList'), state.recent, 'recent');
  renderList($('#localList'), localTracks(), 'local');
  renderPlaylists();
  $('#bQueue').textContent = state.queue.length;
  $('#bLiked').textContent = state.liked.length;
  $('#bLists').textContent = state.playlists.length;
  $('#bLocal').textContent = localTracks().length;
  $('#localCount').textContent = localTracks().length;
  const liked = isLiked(cur());
  $('#barLike').innerHTML = $('#npLike').innerHTML = svg(liked ? 'heartOn' : 'heart', 19);
  $('#shuffleBtn').classList.toggle('on', state.shuffle);
  $('#repeatBtn').classList.toggle('on', state.repeat);
  $('#importTarget').innerHTML = '<option value="">Queue</option>' +
    state.playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#importTarget').value = state.openList || '';
  renderStage();
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
  const gone = state.queue[i];
  if (gone && isLocal(gone)) return removeLocalTrack(gone);
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
let localEl = null;
let pending = null, skipGuard = 0, lastEndedAt = 0;

window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('ytPlayer', {
    height: '360', width: '640',
    // NOTE: no `origin` here. YouTube's API rejects the local http://127.0.0.1
    // origin this app is served from, and the player then never becomes ready.
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        ytReady = true;
        state.playerDead = false;
        try { yt.setVolume(state.volume); } catch {}
        if (pending !== null) { const p = pending; pending = null; play(p); }
      },
      onStateChange: e => {
        if (e.data === YT.PlayerState.PLAYING) { state.playing = true; skipGuard = 0; updateBtn(); }
        else if (e.data === YT.PlayerState.PAUSED) { state.playing = false; updateBtn(); }
        else if (e.data === YT.PlayerState.ENDED) ended();
      },
      onError: e => onPlayerError(e.data)
    }
  });
};

setTimeout(() => {
  if (!ytReady) {
    state.playerDead = true;
    toast('The video player did not load. Check your internet connection, then restart the app.', 8000);
  }
}, 10000);

function onPlayerError(code) {
  const t = cur();
  if (t) { const k = keyOf(t); if (!state.failed.includes(k)) { state.failed.push(k); save(); } }
  const reasons = { 2: 'Bad video id', 5: 'Blocked from apps', 100: 'Video not found', 101: 'Owner blocks playback in apps', 150: 'Owner blocks playback in apps' };
  toast((reasons[code] || 'YouTube refused this video') + ' — skipping', 4000);
  if (++skipGuard > 3) { skipGuard = 0; state.playing = false; updateBtn(); renderAll(); return; }
  setTimeout(next, 1200);
}

const cur = () => state.queue[state.current];

function stopAll() {
  try { if (ytReady) yt.stopVideo(); } catch {}
  if (sc) { try { sc.pause(); } catch {} sc = null; $('#scFrame').src = 'about:blank'; }
  if (localEl) { localEl.pause(); localEl.removeAttribute('src'); localEl.load(); }
  $('#artBox').dataset.mode = 'none';
}

function play(i) {
  if (i < 0 || i >= state.queue.length) return;
  const t = state.queue[i];

  if (isLocal(t)) {
    stopAll();
    state.current = i;
    $('#artBox').dataset.mode = 'local';
    if (!localEl) {
      localEl = new Audio();
      localEl.preload = 'metadata';
      localEl.addEventListener('ended', ended);
      localEl.addEventListener('play', () => { state.playing = true; updateBtn(); });
      localEl.addEventListener('pause', () => { state.playing = false; updateBtn(); });
      localEl.addEventListener('loadedmetadata', () => { scDur = localEl.duration || 0; });
      localEl.addEventListener('timeupdate', () => { scPos = localEl.currentTime || 0; });
      localEl.addEventListener('error', () => {
        const c = cur();
        if (c) { const k = keyOf(c); if (!state.failed.includes(k)) { state.failed.push(k); save(); } }
        toast('This file could not be played — its format is not supported.', 5000);
        setTimeout(next, 1200);
      });
    }
    localEl.src = makeLocalUrl(t);
    localEl.volume = state.volume / 100;
    localEl.play().catch(() => toast('Could not start that file.'));
    state.playing = true;
    state.recent = [{ ...t }, ...state.recent.filter(x => !same(x, t))].slice(0, 50);
    save(); updateNow(); updateBtn(); renderAll();
    loadLyrics(t);
    return;
  }

  if (t.source === 'youtube' && !ytReady) {
    pending = i;
    toast(state.playerDead ? 'The video player still is not loaded. Try restarting the app.' : 'Loading the YouTube player…', 5000);
    return;
  }
  stopAll();
  state.current = i; scPos = 0; scDur = 0;
  $('#artBox').dataset.mode = t.source;
  if (t.source === 'youtube') {
    $('#artBox').dataset.yt = 'on';
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
  loadLyrics(t);
}

function toggle() {
  const t = cur();
  if (!t) { if (state.queue.length) play(0); else toast('Add a song first'); return; }
  if (isLocal(t)) {
    if (!localEl) return play(state.current);
    state.playing ? localEl.pause() : localEl.play().catch(() => {});
  } else if (t.source === 'youtube') {
    if (!ytReady) { pending = state.current; toast('Loading the YouTube player…'); return; }
    state.playing ? yt.pauseVideo() : yt.playVideo();
  } else if (sc) {
    state.playing ? sc.pause() : sc.play();
  }
  state.playing = !state.playing; updateBtn();
}
function next() {
  if (!state.queue.length) return;
  const order = shown(state.queue).length ? shown(state.queue) : state.queue;
  if (order.length === 1) return play(state.queue.indexOf(order[0]));
  let idx = order.indexOf(cur());
  let n = state.shuffle
    ? (idx + 1 + Math.floor(Math.random() * (order.length - 1))) % order.length
    : (idx + 1) % order.length;
  play(state.queue.indexOf(order[n]));
}
function prev() {
  if (position() > 3) return seek(0);
  const order = shown(state.queue).length ? shown(state.queue) : state.queue;
  let idx = order.indexOf(cur());
  if (idx < 0) idx = 0;
  play(state.queue.indexOf(order[(idx - 1 + order.length) % order.length]));
}
function ended() {
  const now = Date.now();
  if (now - lastEndedAt < 700) return;
  lastEndedAt = now;
  if (state.repeat) return play(state.current);
  next();
}
function position() {
  const t = cur(); if (!t) return 0;
  if (isLocal(t)) return localEl ? localEl.currentTime || 0 : 0;
  return t.source === 'youtube' ? (ytReady ? yt.getCurrentTime() || 0 : 0) : scPos;
}
function duration() {
  const t = cur(); if (!t) return 0;
  if (isLocal(t)) return localEl ? localEl.duration || 0 : 0;
  return t.source === 'youtube' ? (ytReady ? yt.getDuration() || 0 : 0) : scDur;
}
function seek(s) {
  const t = cur(); if (!t) return;
  if (isLocal(t)) { if (localEl && isFinite(s)) localEl.currentTime = s; return; }
  if (t.source === 'youtube') yt.seekTo(s, true); else if (sc) sc.seekTo(s * 1000);
}

setInterval(() => {
  const p = position(), d = duration();
  $('#elapsed').textContent = fmt(p);
  $('#total').textContent = fmt(d);
  $('#progressFill').style.width = (d ? Math.min(100, p / d * 100) : 0) + '%';
  highlightLyrics(p);
  const t = cur();
  if (t && !t.dur && d > 0) { t.dur = fmt(d); save(); }
}, 250);

$('#progress').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * duration()); };

function updateBtn() {
  $('#playBtn').innerHTML = svg(state.playing ? 'pause' : 'play', 22);
  $('#barArt').classList.toggle('spin', state.playing);
}
function updateNow() {
  const t = cur();
  $('#npTitle').textContent = $('#barTitle').textContent = t ? t.title : 'Nothing playing';
  $('#npArtist').textContent = $('#barArtist').textContent = t ? t.artist : '';
  const ba = $('#barArt');
  ba.style.backgroundImage = t && t.thumb ? `url("${t.thumb}")` : '';
  ba.innerHTML = t && t.thumb ? '' : svg(isLocal(t) ? 'disc' : 'lyrics', 22);
  document.title = t ? `${t.title} – Pulse` : 'Pulse';
}

$('#playBtn').onclick = toggle;
$('#nextBtn').onclick = next;
$('#prevBtn').onclick = prev;
$('#shuffleBtn').onclick = () => { state.shuffle = !state.shuffle; toast(state.shuffle ? 'Shuffle on' : 'Shuffle off'); renderAll(); };
$('#repeatBtn').onclick = () => { state.repeat = !state.repeat; toast(state.repeat ? 'Repeat one on' : 'Repeat off'); renderAll(); };
$('#barLike').onclick = $('#npLike').onclick = () => toggleLike(cur());
$('#queueBtn').onclick = $('#npQueue').onclick = () => show('queue');
$('#npFocus').onclick = () => document.body.classList.toggle('focus');
$('#npClose').onclick = () => { layout.nowPanel = false; store.set('layout', layout); applyTheme(); };
$('#npAdd').onclick = () => $('#addToPlaylist').click();

$('#videoBtn').onclick = () => { state.stage = 'video'; save(); renderStage(); };
$('#lyricsBtn').onclick = () => {
  state.stage = 'lyrics'; save();
  const t = cur();
  if (t && state.lyricsFor !== keyOf(t)) loadLyrics(t);
  renderStage();
};

const vol = $('#vol');
vol.value = state.volume;
vol.oninput = () => {
  state.volume = +vol.value; save();
  try { if (ytReady) yt.setVolume(state.volume); } catch {}
  if (localEl) localEl.volume = state.volume / 100;
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
let layout = { nowPanel: true, compact: false, hideBroken: false, ...store.get('layout', {}) };

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
  $('#optHideBroken').checked = !!layout.hideBroken;
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
$('#resetTheme').onclick = () => { theme = { ...DEFAULT_THEME }; layout = { nowPanel: true, compact: false, hideBroken: false }; store.set('theme', theme); store.set('layout', layout); applyTheme(); toast('Look reset'); };
$('#resetData').onclick = () => {
  if (!confirm('Remove your queue, liked songs, playlists and history?')) return;
  stopAll(); Object.assign(state, { queue: [], liked: [], recent: [], playlists: [], openList: '', current: -1, playing: false, failed: [] });
  save(); updateNow(); updateBtn(); renderAll(); toast('Cleared');
};

const ytKey = $('#ytKey'), scKey = $('#scKey');
ytKey.value = store.get('ytKey', ''); scKey.value = store.get('scKey', '');
ytKey.onchange = () => { store.set('ytKey', ytKey.value.trim()); toast('YouTube key saved'); };
scKey.onchange = () => { store.set('scKey', scKey.value.trim()); toast('SoundCloud ID saved'); };
$('#backToLists').onclick = () => { state.openList = ''; save(); renderAll(); };

// paint every static icon on the page
document.querySelectorAll('[data-icon]').forEach(el => {
  el.innerHTML = svg(el.dataset.icon, +el.dataset.size || 20);
});

applyTheme();
renderAll();
