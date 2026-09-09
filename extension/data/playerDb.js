// Persistent database of players seen across games (IndexedDB).
//
// Shared verbatim by the service worker (which owns all automatic writes, so a
// game is still recorded with the companion tab closed) and the companion page
// (which owns the user-editable fields). Both contexts are the same extension
// origin, so they open the same database.
//
// Split of ownership matters: `commonName`, `score` and `note` are only ever
// written by the companion, and `names`/`games`/`firstSeen`/`lastSeen` only by
// the worker. Every read-modify-write below stays inside ONE transaction, so
// the two writers can never clobber each other's half of a record.
(function (global) {
  const DB_NAME = 'botc-companion-db';
  const DB_VERSION = 2;

  const HANDLES = 'handles';           // pre-existing: FileSystemDirectoryHandle for the script library
  const PLAYERS = 'players';           // key: account id
  const PARTICIPATIONS = 'participations'; // key: `${playerId}|${gameId}`
  const GAMES = 'games';               // key: game id (the history 'start' entry id)

  const DEFAULT_SCORE = 5;

  let _dbPromise = null;

  function openDb() {
    // Cached: every call site is on a UI or message path that can fire in
    // bursts, and re-opening per operation would serialise them behind
    // repeated version checks.
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // v1 installs already hold `handles` with the script-library directory
        // handle in it — createObjectStore would throw on it, and dropping it
        // would silently lose the user's picked folder.
        if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
        if (!db.objectStoreNames.contains(PLAYERS)) {
          const s = db.createObjectStore(PLAYERS, { keyPath: 'id' });
          s.createIndex('by-lastSeen', 'lastSeen');
          s.createIndex('by-score', 'score');
        }
        if (!db.objectStoreNames.contains(PARTICIPATIONS)) {
          const s = db.createObjectStore(PARTICIPATIONS, { keyPath: 'key' });
          // Lets "which games did I play with X" be an index lookup instead of
          // a full scan of every game ever recorded.
          s.createIndex('by-player', 'playerId');
          s.createIndex('by-game', 'gameId');
        }
        if (!db.objectStoreNames.contains(GAMES)) {
          const s = db.createObjectStore(GAMES, { keyPath: 'id' });
          s.createIndex('by-ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('player db upgrade blocked by another tab'));
    });
    // A failed open must not be cached, or every later call gets the same
    // rejection with no way to retry.
    _dbPromise.catch(() => { _dbPromise = null; });
    return _dbPromise;
  }

  // Promise wrapper for a single request; `tx` is awaited by the caller when the
  // write needs to be durable before continuing.
  const reqDone = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

  // ── Script library directory handle (kept here so there is one opener) ─────

  async function saveDirHandle(handle) {
    const db = await openDb();
    const tx = db.transaction(HANDLES, 'readwrite');
    tx.objectStore(HANDLES).put(handle, 'scriptLibraryDir');
    await txDone(tx);
  }

  async function loadDirHandle() {
    const db = await openDb();
    const tx = db.transaction(HANDLES, 'readonly');
    const result = await reqDone(tx.objectStore(HANDLES).get('scriptLibraryDir'));
    return result ?? null;
  }

  // ── Automatic capture (service worker) ────────────────────────────────────

  // `participants` is [{playerId, name, roleId, roleName, team, alignment,
  // isDead, isStoryteller, won}]. Idempotent: re-recording the same gameId
  // leaves `games`/`participations` identical and does not double-count
  // `games` on the player records, so a repeated 'end' event is harmless.
  async function recordGame({ gameId, ts, edition, isEvilWin, iWasStoryteller, participants }) {
    if (!gameId || !Array.isArray(participants) || participants.length === 0) return;
    const seats = participants.filter(p => p.playerId);
    if (seats.length === 0) return;

    const db = await openDb();
    const tx = db.transaction([GAMES, PLAYERS, PARTICIPATIONS], 'readwrite');
    const games = tx.objectStore(GAMES);
    const players = tx.objectStore(PLAYERS);
    const parts = tx.objectStore(PARTICIPATIONS);

    // Every read is issued before any write and awaited in one batch. An
    // IndexedDB transaction auto-commits as soon as the task drains with no
    // request outstanding, so interleaving `await`ed reads between writes risks
    // a TransactionInactiveError — this keeps the two phases separate.
    const [existingGame, ...existingPlayers] = await Promise.all([
      reqDone(games.get(gameId)),
      ...seats.map(p => reqDone(players.get(String(p.playerId)))),
    ]);
    const alreadyRecorded = !!existingGame;

    games.put({
      id: gameId,
      ts,
      edition: edition ?? null,
      isEvilWin: isEvilWin ?? null,
      iWasStoryteller: !!iWasStoryteller,
      playerCount: seats.filter(p => !p.isStoryteller).length,
    });

    seats.forEach((p, i) => {
      const playerId = String(p.playerId);
      const existing = existingPlayers[i];

      parts.put({
        key: `${playerId}|${gameId}`,
        playerId,
        gameId,
        ts,
        name: p.name ?? null,
        roleId: p.roleId ?? null,
        team: p.team ?? null,
        alignment: p.alignment ?? null,
        isDead: !!p.isDead,
        isStoryteller: !!p.isStoryteller,
        won: p.won ?? null,
        edition: edition ?? null,
      });

      if (!existing) {
        players.put({
          id: playerId,
          // First name we ever saw them under becomes the name we know them by,
          // until the user renames it.
          commonName: p.name ?? playerId,
          names: p.name ? [{ name: p.name, firstSeen: ts, lastSeen: ts }] : [],
          score: DEFAULT_SCORE,
          note: '',
          games: 1,
          firstSeen: ts,
          lastSeen: ts,
        });
        return;
      }

      const names = Array.isArray(existing.names) ? existing.names.map(n => ({ ...n })) : [];
      if (p.name) {
        const hit = names.find(n => n.name === p.name);
        if (hit) hit.lastSeen = Math.max(hit.lastSeen ?? 0, ts);
        else names.push({ name: p.name, firstSeen: ts, lastSeen: ts });
      }
      players.put({
        ...existing,
        names,
        games: (existing.games ?? 0) + (alreadyRecorded ? 0 : 1),
        firstSeen: Math.min(existing.firstSeen ?? ts, ts),
        lastSeen: Math.max(existing.lastSeen ?? 0, ts),
        // Migrate records written before a field existed, without touching
        // whatever the user has since set.
        commonName: existing.commonName ?? p.name ?? playerId,
        score: existing.score ?? DEFAULT_SCORE,
        note: existing.note ?? '',
      });
    });

    await txDone(tx);
  }

  // ── User-editable fields (companion) ──────────────────────────────────────

  // Only the three user-owned fields are written, so a game being recorded at
  // the same moment keeps its `names`/`games`/`lastSeen` updates.
  async function updatePlayer(playerId, fields) {
    const db = await openDb();
    const tx = db.transaction(PLAYERS, 'readwrite');
    const store = tx.objectStore(PLAYERS);
    const existing = await reqDone(store.get(String(playerId)));
    if (!existing) { tx.abort(); return null; }
    const next = { ...existing };
    if (fields.commonName !== undefined) next.commonName = String(fields.commonName).trim() || existing.commonName;
    if (fields.note !== undefined) next.note = String(fields.note);
    if (fields.score !== undefined) {
      const n = Number(fields.score);
      if (Number.isFinite(n)) next.score = Math.min(10, Math.max(0, Math.round(n)));
    }
    store.put(next);
    await txDone(tx);
    return next;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async function getAllPlayers() {
    const db = await openDb();
    const tx = db.transaction(PLAYERS, 'readonly');
    return (await reqDone(tx.objectStore(PLAYERS).getAll())) ?? [];
  }

  async function getPlayer(playerId) {
    const db = await openDb();
    const tx = db.transaction(PLAYERS, 'readonly');
    return (await reqDone(tx.objectStore(PLAYERS).get(String(playerId)))) ?? null;
  }

  // A player's games, newest first, each with the recorded game metadata joined on.
  async function getPlayerGames(playerId) {
    const db = await openDb();
    const tx = db.transaction([PARTICIPATIONS, GAMES], 'readonly');
    const rows = (await reqDone(
      tx.objectStore(PARTICIPATIONS).index('by-player').getAll(String(playerId))
    )) ?? [];
    const gameStore = tx.objectStore(GAMES);
    const metas = await Promise.all(rows.map(row => reqDone(gameStore.get(row.gameId))));
    return rows
      .map((row, i) => ({ ...row, game: metas[i] ?? null }))
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  }

  // Everyone who was in a given game — used to show "played alongside".
  async function getGameParticipants(gameId) {
    const db = await openDb();
    const tx = db.transaction(PARTICIPATIONS, 'readonly');
    return (await reqDone(tx.objectStore(PARTICIPATIONS).index('by-game').getAll(gameId))) ?? [];
  }

  global.PlayerDb = {
    DEFAULT_SCORE,
    openDb,
    saveDirHandle,
    loadDirHandle,
    recordGame,
    updatePlayer,
    getAllPlayers,
    getPlayer,
    getPlayerGames,
    getGameParticipants,
  };
})(typeof self !== 'undefined' ? self : this);
