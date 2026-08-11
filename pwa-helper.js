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
        // Strip query parameters from url to use as clean cache key
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

    // Background Smart Sync — pre-caches materials in parallel so they open INSTANTLY in class!
    async checkAndSyncFiles(materials) {
        if (!navigator.onLine || !this.db || !materials || !materials.length) return;
        
        const targetMaterials = materials.slice(0, 15);

        const syncPromises = targetMaterials.map(async (file) => {
            const id = file.id;
            const fileUrl = file.fileUrl;
            const version = file.version || 1;
            
            // Skip JS fetch pre-caching for GitHub Release Asset URLs to prevent browser CORS console errors
            if (fileUrl && (fileUrl.includes('github.com/releases/download') || fileUrl.includes('uploads.github.com'))) {
                return;
            }

            try {
                const cachedRecord = await this.getCachedRecord(id);
                const isCached = await this.isFileCached(fileUrl);

                if (!cachedRecord || !isCached || cachedRecord.version !== version) {
                    await this.fetchAndCacheFile(id, fileUrl, version, 20000);
                }
            } catch (err) {
                // Ignore sync errors quietly
            }
        });

        await Promise.allSettled(syncPromises);
    },

    // Helper to fetch file with signed URL, timeout, and cache it under clean URL
    async fetchAndCacheFile(id, fileUrl, version, timeoutMs = 25000) {
        const cleanUrl = this.getCleanUrl(fileUrl);
        const cache = await caches.open('nexus-files-cache');
        
        const signedUrl = await this.getSignedUrl(fileUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
            const response = await fetch(signedUrl, { signal: controller.signal }).catch(() => null);
            clearTimeout(timeoutId);
            if (!response || !response.ok) return null;
            
            const copy = response.clone();
            await cache.put(cleanUrl, copy);
            await this.saveCachedRecord(id, cleanUrl, version);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            return null;
        }
    },

    async getSignedUrl(fileUrl) {
        return fileUrl || '';
    },

    // Helper to extract proper MIME type from filename or URL
    getMimeType(url, filename) {
        const clean = ((filename || '') + ' ' + (url || '')).toLowerCase();
        if (clean.includes('.pdf')) return 'application/pdf';
        if (clean.includes('.png')) return 'image/png';
        if (clean.includes('.jpg') || clean.includes('.jpeg')) return 'image/jpeg';
        if (clean.includes('.pptx') || clean.includes('.ppt')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (clean.includes('.docx') || clean.includes('.doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        return 'application/octet-stream';
    },

    // Handle view operation: Local blob:https://nexus-e7a36.web.app URLs with instant caching
    async viewFile(fileUrl, id, version, title, btn) {
        let originalText = '';
        if (btn) {
            originalText = btn.textContent;
            btn.textContent = 'Opening...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.textContent = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };

        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cache = await caches.open('nexus-files-cache');
            const match = await cache.match(cleanUrl).catch(() => null);
            
            // 1. If cached, open local blob URL immediately with 0ms latency!
            if (match) {
                console.log('[PWA Cache] Serving instant blob from local cache:', cleanUrl);
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl, title);
                const isPdf = (title || cleanUrl).toLowerCase().includes('.pdf');
                const pdfBlob = new Blob([rawBlob], { type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' && rawBlob.type !== 'application/octet-stream' ? rawBlob.type : mimeType) });
                const blobUrl = URL.createObjectURL(pdfBlob);
                window.open(blobUrl, '_blank');
                setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
                restoreBtn();
                return;
            }

            // 2. Fetch binary via streaming proxy and build local blob:https://nexus-e7a36.web.app/ URL!
            const proxyUrl = `https://nexus-omega-jet.vercel.app/api/download-file?url=${encodeURIComponent(fileUrl)}&view=inline`;
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error('Proxy fetch failed');

            const rawBlob = await response.blob();
            const mimeType = this.getMimeType(cleanUrl, title);
            const isPdf = (title || cleanUrl).toLowerCase().includes('.pdf');
            const pdfBlob = new Blob([rawBlob], { type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' && rawBlob.type !== 'application/octet-stream' ? rawBlob.type : mimeType) });
            const blobUrl = URL.createObjectURL(pdfBlob);

            // Pre-cache blob in background so every future click is 0ms instant!
            cache.put(cleanUrl, new Response(rawBlob, { headers: { 'Content-Type': pdfBlob.type } })).catch(() => {});
            this.saveCachedRecord(id, cleanUrl, version).catch(() => {});

            window.open(blobUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
            restoreBtn();
        } catch (err) {
            console.warn('[PWA View] Blob creation fallback:', err);
            const proxyUrl = `https://nexus-omega-jet.vercel.app/api/download-file?url=${encodeURIComponent(fileUrl)}&view=inline`;
            window.open(proxyUrl, '_blank');
            restoreBtn();
        }
    },

    // Handle download operation: Instant stream with download disposition
    async downloadFile(fileUrl, filename, id, version, btn) {
        let originalText = '';
        if (btn) {
            originalText = btn.textContent;
            btn.textContent = 'Downloading...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.textContent = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };

        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cache = await caches.open('nexus-files-cache');
            const match = await cache.match(cleanUrl).catch(() => null);
            
            if (match) {
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl, filename);
                const isPdf = (filename || cleanUrl).toLowerCase().includes('.pdf');
                const correctedBlob = new Blob([rawBlob], { 
                    type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' && rawBlob.type !== 'application/octet-stream' ? rawBlob.type : mimeType) 
                });

                let downloadName = filename || 'download';
                if (isPdf && !downloadName.toLowerCase().endsWith('.pdf')) {
                    downloadName += '.pdf';
                }

                const blobUrl = URL.createObjectURL(correctedBlob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = downloadName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
            } else {
                const downloadProxyUrl = `https://nexus-omega-jet.vercel.app/api/download-file?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename || 'material.pdf')}&view=download`;
                window.open(downloadProxyUrl, '_blank');
            }
            restoreBtn();
        } catch (err) {
            console.error('[PWA Cache] Error downloading file:', err);
            alert('Download failed: ' + err.message);
            restoreBtn();
        }
    }
};

// Expose to window for inline click handlers and background sync
window.pwaHelper = pwaHelper;
pwaHelper.init();
