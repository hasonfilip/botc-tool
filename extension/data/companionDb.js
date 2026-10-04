// The companion's IndexedDB: things that can't live in localStorage settings.
(function (global) {
  const DB_NAME = 'botc-companion-db';
  // v3 also held the (since removed) player database; v4 drops its stores.
  const DB_VERSION = 4;

  const HANDLES = 'handles';  // FileSystemDirectoryHandle for the script library
  const CACHE = 'cache';      // key: arbitrary string — derived data worth not recomputing
  const REMOVED = ['players', 'participations', 'games'];

  let _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Older installs already hold `handles` with the script-library
        // directory handle in it — dropping it would silently lose the
        // user's picked folder.
        if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
        for (const name of REMOVED) {
          if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('companion db upgrade blocked by another tab'));
    });
    // A failed open must not be cached, or every later call gets the same
    // rejection with no way to retry.
    _dbPromise.catch(() => { _dbPromise = null; });
    return _dbPromise;
  }

  const reqDone = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

  // ── Script library directory handle ───────────────────────────────────────

  async function saveDirHandle(handle) {
    const db = await openDb();
    const tx = db.transaction(HANDLES, 'readwrite');
    tx.objectStore(HANDLES).put(handle, 'scriptLibraryDir');
    await txDone(tx);
  }

  async function loadDirHandle() {
    const db = await openDb();
    const tx = db.transaction(HANDLES, 'readonly');
    return (await reqDone(tx.objectStore(HANDLES).get('scriptLibraryDir'))) ?? null;
  }

  // ── Derived-data cache ────────────────────────────────────────────────────

  // Firefox has no persistent directory handle (no showDirectoryPicker), so the
  // scanned script library is cached here instead — otherwise reloading the
  // companion loses the library and the folder has to be picked again.
  async function setCached(key, value) {
    const db = await openDb();
    const tx = db.transaction(CACHE, 'readwrite');
    tx.objectStore(CACHE).put(value, key);
    await txDone(tx);
  }

  async function getCached(key) {
    const db = await openDb();
    const tx = db.transaction(CACHE, 'readonly');
    return (await reqDone(tx.objectStore(CACHE).get(key))) ?? null;
  }

  global.CompanionDb = { saveDirHandle, loadDirHandle, setCached, getCached };
})(typeof self !== 'undefined' ? self : this);
