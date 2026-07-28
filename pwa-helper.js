const pwaHelper = {
    db: null,
    
    async init() {
        // 1. Storage persistence request to prevent eviction
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persist();
                console.log(`💾 PWA Storage persistence granted: ${isPersisted}`);
            } catch (e) {
                console.warn('💾 Storage persistence request failed:', e);
            }
        }
        
        // 2. Open IndexedDB for version tracking
        try {
            this.db = await this.openDb();
            console.log('✅ IndexedDB file version tracker ready');
        } catch (e) {
            console.error('❌ Failed to open IndexedDB:', e);
        }
        
        // 3. Register Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('✅ ServiceWorker registered on scope:', reg.scope))
                    .catch(err => console.error('❌ ServiceWorker registration failed:', err));
            });
        }
    },
    
    openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('nexus-pwa-db', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('file_versions')) {
                    db.createObjectStore('file_versions', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(request.error);
        });
    },
    
    getCachedRecord(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('file_versions', 'readonly');
            const store = tx.objectStore('file_versions');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    
    saveCachedRecord(id, fileUrl, version) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('file_versions', 'readwrite');
            const store = tx.objectStore('file_versions');
            const request = store.put({ id, fileUrl, version, cachedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },
    
    deleteCachedRecord(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('file_versions', 'readwrite');
            const store = tx.objectStore('file_versions');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    getCleanUrl(fileUrl) {
        // Strip authorization query parameters from Backblaze B2 url to use as clean cache key
        try {
            const url = new URL(fileUrl);
            return `${url.origin}${url.pathname}`;
        } catch (e) {
            return fileUrl;
        }
    },

    async isFileCached(fileUrl) {
        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cache = await caches.open('nexus-files-cache');
            const match = await cache.match(cleanUrl);
            return !!match;
        } catch (e) {
            return false;
        }
    },

    // Background Smart Sync — triggered online on app open
    async checkAndSyncFiles(materials) {
        if (!navigator.onLine || !this.db) return;
        
        console.log('[PWA Sync] Checking for outdated cached files...');
        for (const file of materials) {
            const id = file.id;
            const fileUrl = file.fileUrl;
            const version = file.version || 1;
            
            try {
                const cachedRecord = await this.getCachedRecord(id);
                if (cachedRecord) {
                    if (cachedRecord.version !== version) {
                        console.log(`[PWA Sync] Outdated version for "${file.title}" (Local: ${cachedRecord.version}, Remote: ${version}). Updating in background...`);
                        await this.fetchAndCacheFile(id, fileUrl, version);
                        console.log(`[PWA Sync] Updated cache for "${file.title}" to version ${version}`);
                    }
                }
            } catch (err) {
                console.error(`[PWA Sync] Error checking/syncing "${file.title}":`, err);
            }
        }
    },

    // Helper to fetch B2 file with signed URL and cache it under clean URL
    async fetchAndCacheFile(id, fileUrl, version) {
        const cleanUrl = this.getCleanUrl(fileUrl);
        const cache = await caches.open('nexus-files-cache');
        
        // 1. Get signed download URL from Vercel backend
        const signedUrl = await this.getSignedUrl(fileUrl);
        
        // 2. Fetch file via CORS
        const response = await fetch(signedUrl);
        if (!response.ok) throw new Error(`HTTP error ${response.status} fetching file`);
        
        // 3. Put cloned response in Cache Storage under clean URL
        const copy = response.clone();
        await cache.put(cleanUrl, copy);
        
        // 4. Save metadata version to IndexedDB
        await this.saveCachedRecord(id, cleanUrl, version);
        
        return response;
    },

    async getSignedUrl(fileUrl) {
        if (fileUrl.includes('raw.githubusercontent.com') || fileUrl.includes('github.com')) {
            return fileUrl;
        }

        const match = fileUrl.match(/\/file\/[^/]+\/(.+)$/);
        if (!match) return fileUrl;
        const fileName = match[1];

        // 1. Check localStorage cache (valid for 50 minutes, persists across tab closes)
        const cacheKey = `nexus_b2_url_${fileName}`;
        try {
            const cachedStr = localStorage.getItem(cacheKey);
            if (cachedStr) {
                const cachedData = JSON.parse(cachedStr);
                // 50 minutes in ms = 3,000,000 ms
                if (Date.now() - cachedData.timestamp < 50 * 60 * 1000) {
                    console.log('[PWA Helper] Serving signed URL from localStorage cache:', fileName);
                    return cachedData.signedUrl;
                }
            }
        } catch (e) {
            console.warn('[PWA Helper] localStorage read error:', e);
        }

        // 2. Fetch new signed URL from Vercel backend
        const response = await fetch('https://nexus-omega-jet.vercel.app/api/get-download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName })
        });

        if (!response.ok) return fileUrl;
        const { signedUrl } = await response.json();

        // 3. Cache the signed URL in localStorage
        if (signedUrl) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    signedUrl: signedUrl,
                    timestamp: Date.now()
                }));
            } catch (e) {
                console.warn('[PWA Helper] localStorage write error:', e);
            }
        }

        return signedUrl;
    },

    // Helper to extract proper MIME type from filename or URL
    getMimeType(url) {
        const clean = (url || '').toLowerCase();
        if (clean.includes('.pdf')) return 'application/pdf';
        if (clean.includes('.png')) return 'image/png';
        if (clean.includes('.jpg') || clean.includes('.jpeg')) return 'image/jpeg';
        if (clean.includes('.pptx') || clean.includes('.ppt')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (clean.includes('.docx') || clean.includes('.doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        return 'application/octet-stream';
    },

    // Handle view operation offline-first using Native Browser Engine
    async viewFile(fileUrl, id, version, title) {
        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cache = await caches.open('nexus-files-cache');
            let match = await cache.match(cleanUrl);
            
            if (!match) {
                if (!navigator.onLine) {
                    alert('You are offline, and this file has not been cached yet.');
                    return;
                }
                console.log('[PWA Cache] File not in cache. Downloading and caching...');
                await this.fetchAndCacheFile(id, fileUrl, version);
                match = await cache.match(cleanUrl);
            } else {
                console.log('[PWA Cache] Serving file from cache:', cleanUrl);
            }
            
            if (match) {
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl);
                const isPdf = cleanUrl.endsWith('.pdf');
                const pdfBlob = new Blob([rawBlob], { type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' ? rawBlob.type : mimeType) });
                const blobUrl = URL.createObjectURL(pdfBlob);
                window.open(blobUrl, '_blank');
            } else {
                window.open(fileUrl, '_blank');
            }
        } catch (err) {
            console.error('[PWA Cache] Error viewing file:', err);
            window.open(fileUrl, '_blank');
        }
    },

    // Handle download operation offline-first
    async downloadFile(fileUrl, filename, id, version) {
        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cache = await caches.open('nexus-files-cache');
            const match = await cache.match(cleanUrl);
            
            let blob;
            if (match) {
                console.log('[PWA Cache] Serving download from cache:', cleanUrl);
                blob = await match.blob();
            } else {
                if (!navigator.onLine) {
                    alert('You are offline, and this file has not been cached yet.');
                    return;
                }
                console.log('[PWA Cache] File not in cache. Downloading and caching...');
                const response = await this.fetchAndCacheFile(id, fileUrl, version);
                blob = await response.blob();
            }
            
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Revoke URL to prevent memory leaks
            setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        } catch (err) {
            console.error('[PWA Cache] Error downloading file:', err);
            alert('Download failed: ' + err.message);
        }
    }
};

// Expose to window for inline click handlers and background sync
window.pwaHelper = pwaHelper;
pwaHelper.init();
