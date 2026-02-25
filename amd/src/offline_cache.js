// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * IndexedDB offline cache for the grading interface.
 *
 * Provides persistent browser-side storage for unsaved work (grade values,
 * feedback text, annotation JSON) so that data survives connection drops,
 * tab closes, and browser crashes.
 *
 * @module     local_unifiedgrader/offline_cache
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** @type {string} Database name. */
const DB_NAME = 'local_unifiedgrader';

/** @type {number} Database version. */
const DB_VERSION = 1;

/** @type {string} Object store name. */
const STORE_NAME = 'drafts';

/** @type {IDBDatabase|null} Open database handle. */
let _db = null;

/** @type {boolean} Whether IndexedDB is available and working. */
let _available = false;

/**
 * Check whether IndexedDB is available in this browser environment.
 *
 * @return {boolean}
 */
export const isAvailable = () => _available;

/**
 * Open (or create) the IndexedDB database.
 *
 * @return {Promise<void>}
 */
export const init = () => new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
        _available = false;
        resolve();
        return;
    }

    try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {keyPath: 'key'});
                store.createIndex('cmid', 'cmid', {unique: false});
                store.createIndex('userid', 'userid', {unique: false});
                store.createIndex('timestamp', 'timestamp', {unique: false});
            }
        };

        request.onsuccess = (event) => {
            _db = event.target.result;
            _available = true;
            resolve();
        };

        request.onerror = () => {
            _available = false;
            window.console.warn('[offline_cache] IndexedDB open failed');
            resolve();
        };
    } catch (e) {
        // Private browsing or other restriction.
        _available = false;
        window.console.warn('[offline_cache] IndexedDB unavailable:', e);
        resolve();
    }
});

/**
 * Build the compound key for a cache entry.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @param {string} type Data type ('grade', 'feedback', 'annotations').
 * @return {string}
 */
const _makeKey = (cmid, userid, type) => `${cmid}_${userid}_${type}`;

/**
 * Get a read-write transaction and object store. Returns null if DB is unavailable.
 *
 * @param {string} mode 'readwrite' or 'readonly'.
 * @return {IDBObjectStore|null}
 */
const _getStore = (mode) => {
    if (!_db) {
        return null;
    }
    try {
        const tx = _db.transaction(STORE_NAME, mode);
        return tx.objectStore(STORE_NAME);
    } catch (e) {
        window.console.warn('[offline_cache] Transaction error:', e);
        return null;
    }
};

/**
 * Wrap an IDBRequest in a promise.
 *
 * @param {IDBRequest} request IndexedDB request.
 * @return {Promise<*>}
 */
const _promisify = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

/**
 * Save (upsert) a cache entry.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @param {string} type Data type.
 * @param {*} data The data to cache.
 * @return {Promise<void>}
 */
export const save = async(cmid, userid, type, data) => {
    if (!_available) {
        return;
    }
    const store = _getStore('readwrite');
    if (!store) {
        return;
    }
    const record = {
        key: _makeKey(cmid, userid, type),
        cmid,
        userid,
        type,
        data,
        timestamp: Date.now(),
    };
    try {
        await _promisify(store.put(record));
    } catch (e) {
        window.console.warn('[offline_cache] Save failed:', e);
    }
};

/**
 * Load a single cache entry.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @param {string} type Data type.
 * @return {Promise<object|null>}
 */
export const load = async(cmid, userid, type) => {
    if (!_available) {
        return null;
    }
    const store = _getStore('readonly');
    if (!store) {
        return null;
    }
    try {
        const result = await _promisify(store.get(_makeKey(cmid, userid, type)));
        return result || null;
    } catch (e) {
        window.console.warn('[offline_cache] Load failed:', e);
        return null;
    }
};

/**
 * Load all cache entries for a given student in a given activity.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @return {Promise<object[]>}
 */
export const loadAll = async(cmid, userid) => {
    if (!_available) {
        return [];
    }
    const store = _getStore('readonly');
    if (!store) {
        return [];
    }
    try {
        const all = await _promisify(store.getAll());
        return (all || []).filter(r => r.cmid === cmid && r.userid === userid);
    } catch (e) {
        window.console.warn('[offline_cache] LoadAll failed:', e);
        return [];
    }
};

/**
 * Remove a single cache entry.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @param {string} type Data type.
 * @return {Promise<void>}
 */
export const remove = async(cmid, userid, type) => {
    if (!_available) {
        return;
    }
    const store = _getStore('readwrite');
    if (!store) {
        return;
    }
    try {
        await _promisify(store.delete(_makeKey(cmid, userid, type)));
    } catch (e) {
        window.console.warn('[offline_cache] Remove failed:', e);
    }
};

/**
 * Remove all cache entries for a given student in a given activity.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid User ID.
 * @return {Promise<void>}
 */
export const removeAll = async(cmid, userid) => {
    if (!_available) {
        return;
    }
    const types = ['grade', 'feedback', 'annotations'];
    const store = _getStore('readwrite');
    if (!store) {
        return;
    }
    try {
        await Promise.all(types.map(type =>
            _promisify(store.delete(_makeKey(cmid, userid, type)))
        ));
    } catch (e) {
        window.console.warn('[offline_cache] RemoveAll failed:', e);
    }
};
