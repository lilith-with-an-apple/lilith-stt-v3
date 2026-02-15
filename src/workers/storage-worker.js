// storage-worker.js - Standard Worker version
let db;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('STT_Database', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('history')) {
                db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveHistory(text) {
    if (!db) await initDB();
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    store.add({ text: text, timestamp: new Date().toISOString() });
}

async function exportHistory() {
    if (!db) await initDB();
    const tx = db.transaction('history', 'readonly');
    const store = tx.objectStore('history');
    const request = store.getAll();
    request.onsuccess = () => {
        self.postMessage({ type: 'export_data', data: request.result });
    };
}

self.onmessage = async (e) => {
    const { type, data } = e.data;
    switch (type) {
        case 'init':
            await initDB();
            break;
        case 'save_history':
            await saveHistory(data);
            break;
        case 'export_history':
            await exportHistory();
            break;
    }
};
