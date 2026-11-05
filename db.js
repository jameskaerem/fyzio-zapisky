/*
 * Lesson library storage in IndexedDB (much larger than localStorage).
 * Falls back to an in-memory store if IndexedDB is unavailable.
 */
(function () {
  "use strict";

  const DB_NAME = "lesson-notes";
  const STORE = "lessons";
  let dbPromise = null;
  let memory = null; // fallback Map

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      console.warn("IndexedDB unavailable, using memory only:", e);
      memory = new Map();
      return null;
    });
    return dbPromise;
  }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const LessonDB = {
    async all() {
      const db = await open();
      if (!db) return [...memory.values()];
      return tx(db, "readonly", (s) => s.getAll());
    },
    async put(lesson) {
      const db = await open();
      if (!db) { memory.set(lesson.id, lesson); return; }
      await tx(db, "readwrite", (s) => s.put(lesson));
    },
    async remove(id) {
      const db = await open();
      if (!db) { memory.delete(id); return; }
      await tx(db, "readwrite", (s) => s.delete(id));
    },
    async persistent() {
      const db = await open();
      return !!db;
    },
  };

  // Ask the browser not to evict the library under storage pressure (best effort)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ignore */ }

  window.LessonDB = LessonDB;
})();
