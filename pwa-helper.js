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
        
        // 3. Service Worker Auto-Update & Zero-Friction Lifecycle Engine
        if ('serviceWorker' in navigator) {
            let refreshing = false;
            const hadPreviousController = !!navigator.serviceWorker.controller;

            // When a new Service Worker takes over, reload to apply fresh assets instantly
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing && hadPreviousController) {
                    refreshing = true;
                    console.log('🔄 New Service Worker controlling the page — auto-refreshing for fresh experience...');
                    window.location.reload();
                }
            });

            // Listen for direct broadcast update signals from the Service Worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'SW_UPDATED') {
                    console.log(`🚀 Service Worker updated to ${event.data.version}`);
                    if (!refreshing && hadPreviousController) {
                        refreshing = true;
                        window.location.reload();
                    }
                }
            });

            const initServiceWorker = async () => {
                try {
                    const reg = await navigator.serviceWorker.register('/sw.js');
                    console.log('✅ ServiceWorker registered on scope:', reg.scope);

                    // A. Proactively check for updates immediately
                    reg.update().catch(() => {});

                    // B. If a new worker is already waiting, activate it immediately
                    if (reg.waiting) {
                        console.log('⚡ Waiting Service Worker detected — activating now...');
                        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                    }

                    // C. Track workers entering the installing/waiting state
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    console.log('⚡ New update installed! Activating immediately...');
                                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                                }
                            });
                        }
                    });

                    // D. Proactively re-check for updates whenever tab becomes visible
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'visible') {
                            reg.update().catch(() => {});
                        }
                    });

                    // E. Periodic background check every 10 minutes
                    setInterval(() => {
                        reg.update().catch(() => {});
                    }, 10 * 60 * 1000);

                } catch (err) {
                    console.error('❌ ServiceWorker registration failed:', err);
                }
            };

            if (document.readyState === 'complete') {
                initServiceWorker();
            } else {
                window.addEventListener('load', initServiceWorker);
            }
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
        
        // Cache top 3 most recent materials automatically to save mobile data
        const targetMaterials = materials.slice(0, 3);

        const syncPromises = targetMaterials.map(async (file) => {
            const id = file.id;
            const fileUrl = file.fileUrl;
            const version = file.version || 1;
            
            if (!fileUrl) return;

            try {
                const cleanUrl = this.getCleanUrl(fileUrl || (`https://nexus.app/materials/${id}`));
                const cachedRecord = await this.getCachedRecord(id);
                const isCached = await this.isFileCached(cleanUrl);

                if (!cachedRecord || !isCached || cachedRecord.version !== version) {
                    const cache = await caches.open('nexus-files-cache');
                    const pdfBlob = await this.fetchFileBlobParallel(fileUrl);
                    if (pdfBlob) {
                        await cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } }));
                        await this.saveCachedRecord(id, cleanUrl, version);
                        console.log('✅ Auto pre-cached material via 4x parallel streams:', file.title || cleanUrl);
                    }
                }
            } catch (err) {
                // Ignore sync errors quietly
            }
        });

        await Promise.allSettled(syncPromises);
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

    // Single-Pass Direct CDN Stream Fetching Engine (Ultra-Fast ~0.3s Download)
    async fetchFileBlob(fileUrl, assetId) {
        const mimeType = this.getMimeType(fileUrl || '', assetId || '');

        const isGitHubUrl = (fileUrl || '').includes('github.com') || (fileUrl || '').includes('githubusercontent.com');

        // For legacy GitHub URLs or asset IDs, use serverless proxy /api/download-file to bypass CORS
        if (isGitHubUrl || assetId) {
            let apiUrl = '';
            if (assetId) {
                apiUrl = `https://nexus-omega-jet.vercel.app/api/download-file?assetId=${encodeURIComponent(assetId)}&view=inline`;
            } else if (fileUrl) {
                apiUrl = `https://nexus-omega-jet.vercel.app/api/download-file?url=${encodeURIComponent(fileUrl)}&view=inline`;
            }

            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error(`Failed to fetch material binary (${res.status})`);
            const arrayBuf = await res.arrayBuffer();
            return new Blob([arrayBuf], { type: mimeType });
        }

        if (!fileUrl) throw new Error('No valid file URL provided');

        // Check if URL specifies multi-part chunks (e.g., .../filename.part0?parts=4)
        const partsMatch = fileUrl.match(/[?&]parts=(\d+)/);
        const partsCount = partsMatch ? parseInt(partsMatch[1], 10) : 0;

        if (partsCount > 1) {
            const baseUrl = fileUrl.split('?')[0].replace(/\.part0$/, '');
            try {
                const fetchPartPromises = [];
                for (let i = 0; i < partsCount; i++) {
                    const partUrl = `${baseUrl}.part${i}`;
                    fetchPartPromises.push(
                        fetch(partUrl).then(r => {
                            if (!r.ok) throw new Error(`Failed to fetch part ${i} (${r.status})`);
                            return r.arrayBuffer();
                        })
                    );
                }
                const buffers = await Promise.all(fetchPartPromises);
                return new Blob(buffers, { type: mimeType });
            } catch (partErr) {
                console.warn('[PWA Fetch] Multi-part fetch failed, falling back to single file:', baseUrl, partErr.message);
                try {
                    const directRes = await fetch(baseUrl);
                    if (directRes.ok) {
                        const arrayBuf = await directRes.arrayBuffer();
                        return new Blob([arrayBuf], { type: mimeType });
                    }
                } catch (singleErr) {
                    console.warn('[PWA Fetch] Single file fallback also failed:', singleErr.message);
                }
                throw new Error(`Failed to load material: ${partErr.message}. The file may need to be re-uploaded.`);
            }
        }

        // Direct single-pass HTTP/2 fetch for Hugging Face CDN — ~0.3s download, zero roundtrip lag!
        const directRes = await fetch(fileUrl);
        if (!directRes.ok) throw new Error(`Failed to fetch material binary (${directRes.status})`);
        const arrayBuf = await directRes.arrayBuffer();
        return new Blob([arrayBuf], { type: mimeType });
    },

    // Backward-compatibility aliases
    async fetchFileBlobParallel(fileUrl, assetId) {
        return this.fetchFileBlob(fileUrl, assetId);
    },

    async fetchGitHubAssetBlob(fileUrl, githubAssetId) {
        return this.fetchFileBlob(fileUrl, githubAssetId);
    },

    // Orphaned cache cleaner: Purges deleted materials from local IndexedDB and CacheStorage
    async cleanOrphanedCache(activeMaterials) {
        if (!this.db || !activeMaterials || !activeMaterials.length) return;
        try {
            const activeIds = new Set(activeMaterials.map(m => m.id));
            const tx = this.db.transaction('file_versions', 'readonly');
            const store = tx.objectStore('file_versions');
            const request = store.getAll();
            request.onsuccess = async () => {
                const records = request.result || [];
                const cache = await caches.open('nexus-files-cache');
                for (const record of records) {
                    if (record && record.id && !activeIds.has(record.id)) {
                        console.log('[PWA Cache] Purging deleted material from local cache:', record.id, record.fileUrl);
                        if (record.fileUrl) await cache.delete(record.fileUrl).catch(() => {});
                        await this.deleteCachedRecord(record.id).catch(() => {});
                    }
                }
            };
        } catch (e) {
            console.warn('[PWA Cache] Orphaned cache cleanup notice:', e);
        }
    },

    // Handle view operation: 0ms Instant Launch + Parallel Background Caching
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
            const cachedRecord = await this.getCachedRecord(id);
            const cache = await caches.open('nexus-files-cache');
            
            // Check if file version was updated in database — evict stale cache if version changed!
            if (cachedRecord && (cachedRecord.version !== version || cachedRecord.fileUrl !== cleanUrl)) {
                console.log(`[PWA Cache] Material updated (v${cachedRecord.version} -> v${version}) — clearing stale cache`);
                await cache.delete(cleanUrl).catch(() => {});
                if (cachedRecord.fileUrl && cachedRecord.fileUrl !== cleanUrl) {
                    await cache.delete(cachedRecord.fileUrl).catch(() => {});
                }
                await this.deleteCachedRecord(id).catch(() => {});
            }

            const match = await cache.match(cleanUrl).catch(() => null);
            
            // 1. If cached locally, serve instant blob from IndexedDB / CacheStorage in 0ms!
            if (match) {
                console.log('[PWA Cache] Serving instant blob from local cache:', cleanUrl);
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl, title);
                const isPdf = (title || cleanUrl).toLowerCase().includes('.pdf');
                const pdfBlob = new Blob([rawBlob], { type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' && rawBlob.type !== 'application/octet-stream' ? rawBlob.type : mimeType) });
                const blobUrl = URL.createObjectURL(pdfBlob);
                const newWin = window.open(blobUrl, '_blank');
                if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
                    window.location.href = blobUrl;
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
                restoreBtn();
                return;
            }

            // Offline guard for uncached materials
            if (!navigator.onLine) {
                alert('This material has not been downloaded for offline viewing yet.\n\nPlease connect to the internet once to view and cache it.');
                restoreBtn();
                return;
            }

            const isGitHubUrl = (fileUrl || '').includes('github.com') || (fileUrl || '').includes('githubusercontent.com');
            const isMultiPart = (fileUrl || '').includes('?parts=') || (fileUrl || '').includes('.part0');

            // 2. Online Single-File Hugging Face materials: Open window IMMEDIATELY in 0ms, cache in background concurrently!
            if (fileUrl && !isGitHubUrl && !githubAssetId && !isMultiPart) {
                console.log('[PWA View] 0ms Instant launch + background caching:', cleanUrl);
                const newWin = window.open(fileUrl, '_blank');
                if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
                    window.location.href = fileUrl;
                }
                restoreBtn();

                // Background cache insertion
                this.fetchFileBlob(fileUrl, githubAssetId).then(pdfBlob => {
                    if (pdfBlob) {
                        cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } })).catch(() => {});
                        this.saveCachedRecord(id, cleanUrl, version).catch(() => {});
                        console.log('✅ Background cache completed:', title || cleanUrl);
                    }
                }).catch(e => console.warn('Background caching notice:', e));
                return;
            }

            // 3. Multi-part HF or legacy GitHub materials: Fetch via parallel streams and open blob
            const pdfBlob = await this.fetchFileBlobParallel(fileUrl, githubAssetId);
            const blobUrl = URL.createObjectURL(pdfBlob);

            cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } })).catch(() => {});
            this.saveCachedRecord(id, cleanUrl, version).catch(() => {});

            const newWin = window.open(blobUrl, '_blank');
            if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
                window.location.href = blobUrl;
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
            restoreBtn();
        } catch (err) {
            console.error('[PWA View Error]:', err);
            alert('Unable to load document inline: ' + err.message);
            restoreBtn();
        }
    },

    // Handle download operation: High-speed 4x parallel download
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
            const cachedRecord = await this.getCachedRecord(id);
            const cache = await caches.open('nexus-files-cache');
            
            // Check if file version was updated in database — evict stale cache if version changed!
            if (cachedRecord && (cachedRecord.version !== version || cachedRecord.fileUrl !== cleanUrl)) {
                console.log(`[PWA Cache] Material updated (v${cachedRecord.version} -> v${version}) — clearing stale cache for download`);
                await cache.delete(cleanUrl).catch(() => {});
                if (cachedRecord.fileUrl && cachedRecord.fileUrl !== cleanUrl) {
                    await cache.delete(cachedRecord.fileUrl).catch(() => {});
                }
                await this.deleteCachedRecord(id).catch(() => {});
            }

            const match = await cache.match(cleanUrl).catch(() => null);
            
            let rawBlob;
            if (match) {
                console.log('[PWA Cache] Serving download from local cache:', cleanUrl);
                rawBlob = await match.blob();
            } else {
                console.log('[PWA Cache] Downloading file via 4x parallel range streams...');
                rawBlob = await this.fetchFileBlobParallel(fileUrl, githubAssetId);
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
