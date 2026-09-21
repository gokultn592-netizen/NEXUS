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
            // Purge any stale truncated single-file entries from previous cache version
            caches.open('nexus-files-cache').then(cache => {
                const stalePaths = ['/DB_CAT_2.pdf', '/COA_CAT_2.pdf', '/DAA_notes_C2.pdf', '/Linear_algebra_CAT_2.pdf', '/OS_CAT_2.pdf'];
                cache.keys().then(keys => {
                    keys.forEach(req => {
                        if (stalePaths.some(p => req.url.endsWith(p))) {
                            console.log('[PWA Cache] Purging obsolete single file:', req.url);
                            cache.delete(req);
                        }
                    });
                });
            }).catch(() => {});
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

    // Background Smart Sync — Silently pre-caches top 3 recent materials in background
    // Runs with a 2.5s delay so initial page render and notices load with 100% bandwidth
    async checkAndSyncFiles(materials) {
        if (!navigator.onLine || !this.db || !materials || !materials.length) return;
        
        setTimeout(async () => {
            try {
                // Select top 3 most recently created or updated materials
                const targetMaterials = materials.slice(0, 3);
                const cache = await caches.open('nexus-files-cache');

                for (const file of targetMaterials) {
                    const id = file.id;
                    const fileUrl = file.fileUrl;
                    const version = file.version || 1;
                    if (!fileUrl) continue;

                    const cleanUrl = this.getCleanUrl(fileUrl);
                    const baseUrl = fileUrl.split('?')[0].replace(/\.part\d+$/, '');
                    const cachedRecord = await this.getCachedRecord(id);
                    const isCached = await this.isFileCached(cleanUrl) || await this.isFileCached(baseUrl);

                    // If cached and version matches, skip (0 data used)
                    if (cachedRecord && cachedRecord.version === version && isCached) {
                        continue;
                    }

                    // If material was updated (v1 -> v2), purge old cached files
                    if (cachedRecord && (cachedRecord.version !== version || cachedRecord.fileUrl !== cleanUrl)) {
                        console.log(`⚡ [PWA Sync] Note updated (v${cachedRecord.version} -> v${version}) — purging old cache:`, file.title);
                        await cache.delete(cleanUrl).catch(() => {});
                        await cache.delete(baseUrl).catch(() => {});
                        if (cachedRecord.fileUrl) await cache.delete(cachedRecord.fileUrl).catch(() => {});
                        await this.deleteCachedRecord(id).catch(() => {});
                    }

                    // Silently download complete assembled PDF in background
                    try {
                        const pdfBlob = await this.fetchFileBlob(fileUrl);
                        if (pdfBlob) {
                            await cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } }));
                            await this.saveCachedRecord(id, cleanUrl, version);
                            console.log(`⚡ [PWA Sync] Silently pre-cached for 0ms instant launch: ${file.title || cleanUrl} (v${version})`);
                        }
                    } catch (e) {
                        // Silent fail for background sync
                    }
                }
            } catch (err) {
                console.warn('[PWA Sync] Background pre-cache notice:', err);
            }
        }, 2500);
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

    // High-Speed Multi-Chunk & Direct Stream Fetching Engine with Live Progress Support
    async fetchFileBlob(fileUrl, assetId, onProgress) {
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

        const partsMatch = fileUrl.match(/[?&]parts=(\d+)/);
        const baseUrl = fileUrl.split('?')[0].replace(/\.part\d+$/, '');
        const isChunked = !!partsMatch || fileUrl.includes('.part');

        // 1. Multi-chunk materials: Always fetch all chunks in parallel and assemble into complete file
        if (isChunked) {
            const partsCount = partsMatch ? parseInt(partsMatch[1], 10) : 10;
            let loadedParts = 0;
            const fetchPartPromises = [];
            for (let i = 0; i < partsCount; i++) {
                const partUrl = `${baseUrl}.part${i}`;
                fetchPartPromises.push(
                    fetch(partUrl).then(async (r) => {
                        if (!r.ok) throw new Error(`Failed to fetch part ${i} (${r.status})`);
                        const buf = await r.arrayBuffer();
                        loadedParts++;
                        if (typeof onProgress === 'function') {
                            onProgress((loadedParts / partsCount) * 100, loadedParts, partsCount);
                        }
                        return { index: i, buf };
                    })
                );
            }
            const parts = await Promise.all(fetchPartPromises);
            parts.sort((a, b) => a.index - b.index);
            const buffers = parts.map(p => p.buf);
            return new Blob(buffers, { type: mimeType });
        }

        // 2. Single-file materials: Stream fetch directly with progress
        const directRes = await fetch(baseUrl);
        if (!directRes.ok) throw new Error(`Failed to fetch material binary (${directRes.status})`);
        const totalBytes = parseInt(directRes.headers.get('content-length') || '0', 10);
        if (typeof onProgress === 'function' && directRes.body && totalBytes > 0) {
            const reader = directRes.body.getReader();
            const chunks = [];
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                onProgress((received / totalBytes) * 100, received, totalBytes);
            }
            return new Blob(chunks, { type: mimeType });
        }
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

    // Handle view operation: 0.0s Instant Local Launch (Cached) OR Assembled Blob Launch (Uncached)
    async viewFile(fileUrl, id, version, title, btn, githubAssetId) {
        let originalText = '';
        if (btn) {
            originalText = btn.innerHTML;
            btn.innerHTML = '<span class="inline-block animate-spin mr-1">↻</span> Opening...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };

        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const cachedRecord = await this.getCachedRecord(id);
            const cache = await caches.open('nexus-files-cache');
            
            // Version Invalidation: If note was updated in database, purge stale v1 cache immediately
            if (cachedRecord && (cachedRecord.version !== version || cachedRecord.fileUrl !== cleanUrl)) {
                console.log(`[PWA Cache] Material updated (v${cachedRecord.version} -> v${version}) — purging old cache`);
                await cache.delete(cleanUrl).catch(() => {});
                if (cachedRecord.fileUrl && cachedRecord.fileUrl !== cleanUrl) {
                    await cache.delete(cachedRecord.fileUrl).catch(() => {});
                }
                await this.deleteCachedRecord(id).catch(() => {});
            }

            const match = await cache.match(cleanUrl).catch(() => null);
            
            // 1. If cached locally: Serve instant blob in 0.0 seconds! Zero network request.
            if (match) {
                console.log('[PWA View] 0.0s Instant launch from local storage:', title || cleanUrl);
                const rawBlob = await match.blob();
                const mimeType = this.getMimeType(cleanUrl, title);
                const isPdf = (title || cleanUrl).toLowerCase().includes('.pdf');
                const pdfBlob = new Blob([rawBlob], { type: isPdf ? 'application/pdf' : (rawBlob.type && rawBlob.type !== 'text/plain' && rawBlob.type !== 'application/octet-stream' ? rawBlob.type : mimeType) });
                const blobUrl = URL.createObjectURL(pdfBlob);
                const newWin = window.open(blobUrl, '_blank');
                if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
                    window.location.href = blobUrl;
                }
                setTimeout(() => URL.revokeObjectURL(blobUrl), 180000);
                restoreBtn();
                return;
            }

            // 2. Uncached online materials: Fetch complete assembled binary with progress
            console.log('[PWA View] Fetching complete material binary:', title || cleanUrl);
            const pdfBlob = await this.fetchFileBlob(fileUrl, githubAssetId, (pct) => {
                if (btn) {
                    btn.innerHTML = `<span class="inline-block animate-spin mr-1">↻</span> ${Math.round(pct)}%`;
                }
            });

            // Cache it locally so subsequent opens take 0.0s
            await cache.put(cleanUrl, new Response(pdfBlob, { headers: { 'Content-Type': pdfBlob.type } })).catch(() => {});
            await this.saveCachedRecord(id, cleanUrl, version).catch(() => {});

            // Open clean blob URL in new tab — user NEVER sees raw AWS CloudFront signed links!
            const blobUrl = URL.createObjectURL(pdfBlob);
            const newWin = window.open(blobUrl, '_blank');
            if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
                window.location.href = blobUrl;
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 180000);
            restoreBtn();
        } catch (err) {
            console.error('[PWA View Error]:', err);
            alert('Unable to load document: ' + err.message);
            restoreBtn();
        }
    },

    // Handle download operation: Instant from local cache OR streaming with real-time % progress
    async downloadFile(fileUrl, filename, id, version, btn, githubAssetId) {
        let originalText = '';
        if (btn) {
            originalText = btn.innerHTML;
            btn.innerHTML = '<span class="inline-block animate-spin mr-1">↻</span> Starting...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };

        try {
            const cleanUrl = this.getCleanUrl(fileUrl);
            const baseUrl = fileUrl.split('?')[0].replace(/\.part\d+$/, '');
            const cachedRecord = await this.getCachedRecord(id);
            const cache = await caches.open('nexus-files-cache');
            
            // Check if file version was updated in database — evict stale cache if version changed!
            if (cachedRecord && (cachedRecord.version !== version || cachedRecord.fileUrl !== cleanUrl)) {
                console.log(`[PWA Download] Material updated (v${cachedRecord.version} -> v${version}) — clearing stale cache`);
                await cache.delete(cleanUrl).catch(() => {});
                if (cachedRecord.fileUrl && cachedRecord.fileUrl !== cleanUrl) {
                    await cache.delete(cachedRecord.fileUrl).catch(() => {});
                }
                await this.deleteCachedRecord(id).catch(() => {});
            }

            const match = await cache.match(cleanUrl).catch(() => null);
            
            let rawBlob;
            if (match) {
                console.log('[PWA Download] 0.0s Instant download from local cache:', cleanUrl);
                rawBlob = await match.blob();
            } else {
                console.log('[PWA Download] Streaming download with live progress from CDN...');
                rawBlob = await this.fetchFileBlob(fileUrl, githubAssetId, (pct, loaded, total) => {
                    if (btn) {
                        btn.innerHTML = `<span class="font-mono text-[11px] font-bold text-emerald-400">${Math.round(pct)}%</span>`;
                    }
                });
                await cache.put(cleanUrl, new Response(rawBlob, { headers: { 'Content-Type': rawBlob.type } })).catch(() => {});
                await this.saveCachedRecord(id, cleanUrl, version).catch(() => {});
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
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 3000);

            if (btn) {
                btn.innerHTML = '<span class="text-emerald-400 font-bold">✓ Ready!</span>';
                setTimeout(restoreBtn, 1500);
            }
        } catch (err) {
            console.error('[PWA Download Error]:', err);
            alert('Download error: ' + err.message);
            restoreBtn();
        }
    }
};

// Expose to window for inline click handlers and background sync
window.pwaHelper = pwaHelper;
pwaHelper.init();
