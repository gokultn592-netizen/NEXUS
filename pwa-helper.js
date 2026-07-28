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

    ensureDocViewerModal() {
        if (document.getElementById('nexus-doc-viewer-modal')) return;
        const modalHtml = `
        <div id="nexus-doc-viewer-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(3,0,5,0.96); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); z-index:999999; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem 2rem; background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; align-items:center; gap:1rem;">
                    <span id="nexus-doc-viewer-icon" style="font-size:1.8rem;">📄</span>
                    <div>
                        <h3 id="nexus-doc-viewer-title" style="margin:0; color:#fff; font-size:1.1rem; font-family:sans-serif;">Document Reader</h3>
                        <span id="nexus-doc-viewer-sub" style="font-size:0.8rem; color:#a1a1aa;">NEXUS Reader</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:1rem;">
                    <button id="nexus-doc-viewer-dl-btn" style="background:#9d4edd; color:#fff; border:none; padding:0.5rem 1.2rem; border-radius:8px; cursor:pointer; font-weight:600; font-size:0.9rem;">Download</button>
                    <button onclick="window.pwaHelper ? pwaHelper.closeDocViewer() : (document.getElementById('nexus-doc-viewer-modal').style.display='none')" style="background:rgba(255,255,255,0.1); color:#fff; border:none; width:38px; height:38px; border-radius:50%; cursor:pointer; font-size:1.4rem; display:flex; align-items:center; justify-content:center;">×</button>
                </div>
            </div>
            <div id="nexus-doc-viewer-body" style="flex:1; width:100%; height:100%; display:flex; justify-content:center; align-items:center; overflow:hidden; position:relative;">
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    closeDocViewer() {
        const modal = document.getElementById('nexus-doc-viewer-modal');
        const body = document.getElementById('nexus-doc-viewer-body');
        if (modal) modal.style.display = 'none';
        if (body) body.innerHTML = '';
    },

    openDocViewer(fileUrl, title, blobData) {
        this.ensureDocViewerModal();
        const modal = document.getElementById('nexus-doc-viewer-modal');
        const body = document.getElementById('nexus-doc-viewer-body');
        const titleEl = document.getElementById('nexus-doc-viewer-title');
        const downloadBtn = document.getElementById('nexus-doc-viewer-dl-btn');

        if (!modal || !body) return;

        titleEl.textContent = title || 'Document Reader';
        body.innerHTML = '<div style="color:#9d4edd; font-family:sans-serif; text-align:center;"><h2>⚡ Rendering Document...</h2></div>';
        modal.style.display = 'flex';

        downloadBtn.onclick = () => {
            this.downloadFile(fileUrl, title);
        };

        const isPdf = fileUrl.toLowerCase().includes('.pdf');
        const isImage = /\.(png|jpe?g|gif|webp|svg)/i.test(fileUrl);

        try {
            if (isImage) {
                const imgSrc = blobData ? URL.createObjectURL(blobData) : fileUrl;
                body.innerHTML = `<img src="${imgSrc}" style="max-width:90%; max-height:90%; object-fit:contain; border-radius:8px; box-shadow:0 20px 50px rgba(0,0,0,0.5);" />`;
                return;
            }

            // PDF or Document: Render inline object/iframe inside the page container
            let renderUrl = fileUrl;
            if (blobData) {
                const typedBlob = new Blob([blobData], { type: isPdf ? 'application/pdf' : (blobData.type || 'application/octet-stream') });
                renderUrl = URL.createObjectURL(typedBlob);
            }

            if (isPdf) {
                body.innerHTML = `<object data="${renderUrl}" type="application/pdf" width="100%" height="100%">
                    <iframe src="${renderUrl}" width="100%" height="100%" style="border:none;"></iframe>
                </object>`;
            } else if (navigator.onLine) {
                body.innerHTML = `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true" width="100%" height="100%" style="border:none;"></iframe>`;
            } else {
                body.innerHTML = `<object data="${renderUrl}" width="100%" height="100%">
                    <iframe src="${renderUrl}" width="100%" height="100%" style="border:none;"></iframe>
                </object>`;
            }
        } catch (err) {
            console.error('Doc viewer rendering error:', err);
            body.innerHTML = `<iframe src="${fileUrl}" width="100%" height="100%" style="border:none;"></iframe>`;
        }
    },

    // Handle view operation offline-first using in-app Document Viewer
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
            
            let blob = null;
            if (match) {
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl);
                blob = new Blob([rawBlob], { type: rawBlob.type && rawBlob.type !== 'text/plain' ? rawBlob.type : mimeType });
            }

            this.openDocViewer(fileUrl, title || 'Study Material', blob);
        } catch (err) {
            console.error('[PWA Cache] Error viewing file:', err);
            this.openDocViewer(fileUrl, title || 'Study Material', null);
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
