// In-memory stand-ins for the Apps Script services used by apps_script/Code.gs, so its logic can be tested in a browser.
(function () {
  // ---- SHA-256 and HMAC (synchronous, on UTF-8 bytes)
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, withOne = l + 1, k = (64 - ((withOne + 8) % 64)) % 64;
    const m = new Uint8Array(withOne + k + 8); m.set(bytes); m[l] = 0x80;
    const bits = l * 8; for (let i = 0; i < 8; i++) m[m.length - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    const out = []; H.forEach((v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255));
    return out;
  }
  const utf8 = (s) => Array.from(new TextEncoder().encode(String(s)));
  const signed = (arr) => arr.map((b) => (b > 127 ? b - 256 : b));
  function hmac(key, msg) {
    let k = utf8(key); if (k.length > 64) k = sha256(k);
    const kk = new Array(64).fill(0); k.forEach((b, i) => { kk[i] = b; });
    return sha256(kk.map((b) => b ^ 0x5c).concat(sha256(kk.map((b) => b ^ 0x36).concat(utf8(msg)))));
  }

  // ---- Drive
  let seq = 0; const nid = (p) => `${p}${++seq}`;
  const folders = {}, files = {};
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  function fileObj(id) {
    const f = files[id];
    return {
      getId: () => id, getName: () => f.name, getMimeType: () => f.mime,
      getBlob: () => ({ getDataAsString: () => f.content }),
      setContent: (s) => { f.content = String(s); f.updated = new Date(); },
      getLastUpdated: () => f.updated,
      moveTo: (folder) => { f.folder = folder.getId(); },
    };
  }
  function folderObj(id) {
    return {
      getId: () => id, getName: () => folders[id].name,
      createFolder: (name) => { const c = nid('folder'); folders[c] = { name, parent: id }; return folderObj(c); },
      createFile: (name, content, mime) => { const c = nid('file'); files[c] = { name, content: String(content), mime, folder: id, updated: new Date() }; return fileObj(c); },
      getFilesByName: (name) => iter(Object.keys(files).filter((k) => files[k].folder === id && files[k].name === name).map(fileObj)),
      getFiles: () => iter(Object.keys(files).filter((k) => files[k].folder === id).map(fileObj)),
    };
  }
  folders.root0 = { name: 'Teacher folder', parent: null };
  window.DriveApp = {
    getFolderById: (id) => { if (!folders[id]) throw new Error('No folder ' + id); return folderObj(id); },
    getFileById: (id) => { if (!files[id] && !sheets[id]) throw new Error('No file ' + id); if (sheets[id]) { files[id] = files[id] || { name: sheets[id].name, content: '', mime: 'sheet', folder: null, updated: new Date() }; } return fileObj(id); },
  };

  // ---- Sheets
  const sheets = {};
  function sheetObj(book, idx) {
    const sh = () => sheets[book].tabs[idx];
    const ensure = (r, c) => { const rows = sh().rows; while (rows.length < r) rows.push([]); rows.forEach((row) => { while (row.length < c) row.push(''); }); };
    const range = (r, c, nr, nc) => ({
      setValues: (vals) => { ensure(r + nr - 1, c + nc - 1); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh().rows[r - 1 + i][c - 1 + j] = vals[i][j]; return this; },
      setValue: (v) => { ensure(r, c); sh().rows[r - 1][c - 1] = v; },
      getValues: () => { ensure(r + nr - 1, c + nc - 1); return sh().rows.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)); },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh().rows[r - 1 + i]) sh().rows[r - 1 + i][c - 1 + j] = ''; },
    });
    return {
      setName: (n) => { sh().name = n; }, getName: () => sh().name, setFrozenRows: () => {},
      getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
      getDataRange: () => { const rows = sh().rows; const w = Math.max(1, ...rows.map((x) => x.length)); return range(1, 1, Math.max(1, rows.length), w); },
      appendRow: (arr) => { sh().rows.push(arr.slice()); },
      getLastRow: () => sh().rows.length,
    };
  }
  function bookObj(id) {
    return {
      getId: () => id, getUrl: () => `https://docs.google.com/spreadsheets/d/${id}`,
      getSheets: () => sheets[id].tabs.map((_, i) => sheetObj(id, i)),
      getSheetByName: (n) => { const i = sheets[id].tabs.findIndex((t) => t.name === n); return i < 0 ? null : sheetObj(id, i); },
      insertSheet: (n) => { sheets[id].tabs.push({ name: n, rows: [] }); return sheetObj(id, sheets[id].tabs.length - 1); },
    };
  }
  window.SpreadsheetApp = {
    create: (name) => { const id = nid('sheet'); sheets[id] = { name, tabs: [{ name: 'Sheet1', rows: [] }] }; return bookObj(id); },
    openById: (id) => bookObj(id),
  };

  // ---- Other services
  const props = {}, cache = {}, triggers = [];
  window.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: (o) => { Object.assign(props, o); },
  }) };
  window.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); } }) };
  window.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  window.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, s) => signed(sha256(utf8(s))),
    computeHmacSha256Signature: (value, key) => signed(hmac(key, value)),
    getUuid: () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; },
  };
  window.ContentService = { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }) };
  window.ScriptApp = {
    getProjectTriggers: () => triggers.slice(), deleteTrigger: () => {},
    newTrigger: (fn) => ({ timeBased() { return this; }, everyHours(h) { this.h = h; return this; }, create() { triggers.push({ fn, h: this.h }); } }),
  };
  window.__logs = [];
  window.Logger = { log: (s) => window.__logs.push(String(s)) };

  // ---- Test helpers
  window.__gas = {
    folders, files, sheets, triggers, props, cache,
    post: (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    get: (params, pathInfo) => JSON.parse(doGet({ parameter: params, pathInfo }).getContent()),
    tab: (name) => { const id = props.SHEET_ID; const t = sheets[id].tabs.find((x) => x.name === name); return t.rows; },
    filesIn: (folderId) => Object.keys(files).filter((k) => files[k].folder === folderId).map((k) => ({ id: k, ...files[k] })),
    dropFile: (folderId, name, content) => folderObj(folderId).createFile(name, content, 'application/json').getId(),
    sha256hex: (s) => sha256(utf8(s)).map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
})();
