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
        
        // 3. Register Service Worker with Auto-Reload on Update
        if ('serviceWorker' in navigator) {
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('✅ ServiceWorker registered on scope:', reg.scope))
                    .catch(err => console.error('❌ ServiceWorker registration failed:', err));
            });
        }

        // 4. Capture beforeinstallprompt event for WebAPK App Installation
        window.deferredPwaPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            window.deferredPwaPrompt = e;
            console.log('⚡ PWA beforeinstallprompt event captured!');
            const installBtns = document.querySelectorAll('.pwa-install-btn');
            installBtns.forEach(btn => { btn.style.display = 'inline-flex'; });
        });

        window.triggerPwaInstall = function() {
            if (window.deferredPwaPrompt) {
                window.deferredPwaPrompt.prompt();
                window.deferredPwaPrompt.userChoice.then((choice) => {
                    if (choice.outcome === 'accepted') {
                        console.log('User accepted PWA WebAPK installation');
                    }
                    window.deferredPwaPrompt = null;
                });
            } else {
                alert('To install NEXUS as a standalone app:\n\n1. Open Chrome menu (3 dots at top right)\n2. Tap "Install app" or "Add to Home screen"\n3. Confirm App Installation!');
            }
        };
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
            const githubAssetId = file.githubAssetId || file.assetId;
            const version = file.version || 1;
            
            if (!fileUrl && !githubAssetId) return;

            try {
                const cleanUrl = this.getCleanUrl(fileUrl || (`https://nexus.app/materials/${id}`));
                const cachedRecord = await this.getCachedRecord(id);
                const isCached = await this.isFileCached(cleanUrl);

                if (!cachedRecord || !isCached || cachedRecord.version !== version) {
                    const cache = await caches.open('nexus-files-cache');
                    const pdfBlob = await this.fetchGitHubAssetBlob(fileUrl, githubAssetId);
                    if (pdfBlob) {
                        await cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } }));
                        await this.saveCachedRecord(id, cleanUrl, version);
                        console.log('✅ Auto pre-cached PDF in background:', file.title || cleanUrl);
                    }
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

    async fetchGitHubAssetBlob(fileUrl, githubAssetId) {
        const clean = ((fileUrl || '') + ' ' + (githubAssetId || '')).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (clean.includes('.pdf')) mimeType = 'application/pdf';
        else if (clean.includes('.png')) mimeType = 'image/png';
        else if (clean.includes('.jpg') || clean.includes('.jpeg')) mimeType = 'image/jpeg';

        // Try direct fetch first if fileUrl is a public URL
        if (fileUrl) {
            try {
                const directRes = await fetch(fileUrl);
                if (directRes.ok) {
                    const arrayBuf = await directRes.arrayBuffer();
                    return new Blob([arrayBuf], { type: mimeType });
                }
            } catch (e) {
                // Direct fetch blocked by CORS or network, proceed to proxy fallback
            }
        }

        let apiUrl = '';
        if (githubAssetId) {
            apiUrl = `https://nexus-omega-jet.vercel.app/api/download-file?assetId=${encodeURIComponent(githubAssetId)}&view=inline`;
        } else if (fileUrl) {
            apiUrl = `https://nexus-omega-jet.vercel.app/api/download-file?url=${encodeURIComponent(fileUrl)}&view=inline`;
        }

        if (!apiUrl) throw new Error('No valid file URL or Asset ID provided');

        const res = await fetch(apiUrl);
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Failed to fetch material binary (${res.status}): ${errText}`);
        }

        const arrayBuf = await res.arrayBuffer();
        return new Blob([arrayBuf], { type: mimeType });
    },

    // Handle view operation: Direct local blob URL via backend proxy (0 client tokens & 0 forced downloads!)
    async viewFile(fileUrl, id, version, title, btn, githubAssetId) {
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

            // 2. Fetch binary via serverless proxy by githubAssetId or url
            const pdfBlob = await this.fetchGitHubAssetBlob(fileUrl, githubAssetId);
            const blobUrl = URL.createObjectURL(pdfBlob);

            // Save to PWA Cache for 0ms instant future opens
            cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } })).catch(() => {});
            this.saveCachedRecord(id, cleanUrl, version).catch(() => {});

            window.open(blobUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
            restoreBtn();
        } catch (err) {
            console.error('[PWA View Error]:', err);
            alert('Unable to load document inline: ' + err.message);
            restoreBtn();
        }
    },

    // Handle download operation: Direct browser download via serverless proxy
    async downloadFile(fileUrl, filename, id, version, btn, githubAssetId) {
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
            
            let rawBlob;
            if (match) {
                console.log('[PWA Cache] Serving download from local cache:', cleanUrl);
                rawBlob = await match.blob();
            } else {
                console.log('[PWA Cache] Downloading file via serverless proxy...');
                rawBlob = await this.fetchGitHubAssetBlob(fileUrl, githubAssetId);
                cache.put(cleanUrl, new Response(rawBlob, { headers: { 'Content-Type': rawBlob.type } })).catch(() => {});
                this.saveCachedRecord(id, cleanUrl, version).catch(() => {});
            }
            
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
            restoreBtn();
        } catch (err) {
            console.error('[PWA Download Error]:', err);
            alert('Download failed: ' + err.message);
            restoreBtn();
        }
    }
};

// Expose to window for inline click handlers and background sync
window.pwaHelper = pwaHelper;
pwaHelper.init();
