// Vercel Serverless Function — High-Performance Chunked GitHub Release Storage Engine
// Receives chunks from browser client (bypassing Vercel 4.5MB body limit),
// stores temporary chunks on GitHub Releases (stateless across Vercel serverless containers),
// concatenates them on final chunk with full paginated asset lookup & assetId tracking,
// uploads final asset with 422 retry/auto-overwrite, and cleans up temporary chunks!

async function getOrCreateRelease(token, repo) {
    const tag = 'materials-v1';
    const tagRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
        headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
    });

    if (tagRes.ok) {
        return await tagRes.json();
    }

    const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: 'POST',
        headers: {
            Authorization: `token ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'NEXUS-App'
        },
        body: JSON.stringify({
            tag_name: tag,
            name: 'NEXUS Course Materials',
            body: 'Permanent high-speed storage for NEXUS course materials (supports up to 2GB per file).',
            draft: false,
            prerelease: false
        })
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Failed to create GitHub release tag: ${errText}`);
    }

    return await createRes.json();
}

async function getAllReleaseAssets(token, repo, releaseId) {
    let allAssets = [];
    let page = 1;
    while (true) {
        try {
            const res = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}/assets?per_page=100&page=${page}`, {
                headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
            });
            if (!res.ok) break;
            const assets = await res.json();
            if (!assets || !Array.isArray(assets) || !assets.length) break;
            allAssets = allAssets.concat(assets);
            if (assets.length < 100) break;
            page++;
            if (page > 10) break; // Limit to 1000 assets max safety
        } catch (e) {
            break;
        }
    }
    return allAssets;
}

async function deleteReleaseAssetByName(token, repo, releaseId, name) {
    if (!name) return;
    try {
        const assets = await getAllReleaseAssets(token, repo, releaseId);
        const matchingAssets = assets.filter(a => a.name === name);
        for (const asset of matchingAssets) {
            await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, {
                method: 'DELETE',
                headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
            });
        }
    } catch (e) {
        console.warn(`Failed to delete existing asset ${name}:`, e);
    }
}

async function uploadToReleaseWithRetry(token, repo, releaseId, fileName, bodyBuffer) {
    // Step 1: Pre-emptively delete any existing asset with this filename
    await deleteReleaseAssetByName(token, repo, releaseId, fileName);

    const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;
    
    let uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/octet-stream',
            'User-Agent': 'NEXUS-App'
        },
        body: bodyBuffer
    });

    // If GitHub returns 422 already_exists due to propagation delay, force-delete again, wait 350ms, and retry
    if (uploadRes.status === 422) {
        console.warn(`Asset ${fileName} returned 422. Retrying deletion and upload...`);
        await deleteReleaseAssetByName(token, repo, releaseId, fileName);
        await new Promise(r => setTimeout(r, 350));

        uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/octet-stream',
                'User-Agent': 'NEXUS-App'
            },
            body: bodyBuffer
        });
    }

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Final GitHub Release Asset upload failed (${uploadRes.status}): ${errText}`);
    }

    return await uploadRes.json();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';

    if (!token) {
        return res.status(500).json({ error: 'GITHUB_TOKEN environment variable is not configured' });
    }

    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ready', engine: 'NEXUS Chunked Release Storage' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { action, uploadId, chunkIndex, totalChunks, fileName, chunkData, oldFileName, chunkAssetIds } = req.body || {};

        const release = await getOrCreateRelease(token, repo);

        // Action: Delete old asset if replacing
        if (action === 'delete' && oldFileName) {
            await deleteReleaseAssetByName(token, repo, release.id, oldFileName);
            return res.status(200).json({ success: true, message: 'Asset deleted' });
        }

        // Action: Upload chunk
        if (!uploadId || chunkIndex === undefined || totalChunks === undefined || !fileName || !chunkData) {
            return res.status(400).json({ error: 'Missing required chunk parameters' });
        }

        const cleanBase64 = chunkData.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
        const chunkBuffer = Buffer.from(cleanBase64, 'base64');

        // Case A: Single chunk upload (<= 3MB file) — Upload directly in 1 request!
        if (totalChunks === 1) {
            if (oldFileName && oldFileName !== fileName) {
                await deleteReleaseAssetByName(token, repo, release.id, oldFileName);
            }

            const assetData = await uploadToReleaseWithRetry(token, repo, release.id, fileName, chunkBuffer);
            const publicUrl = assetData.browser_download_url || `https://github.com/${repo}/releases/download/materials-v1/${fileName}`;

            return res.status(200).json({
                success: true,
                status: 'completed',
                publicUrl: publicUrl,
                assetId: assetData.id,
                assetName: assetData.name || fileName
            });
        }

        // Case B: Multi-chunk upload (> 3MB file) — Upload chunk as temporary asset on GitHub (stateless)
        const chunkAssetName = `_tmp_${uploadId}_part_${chunkIndex}`;
        
        const chunkAssetData = await uploadToReleaseWithRetry(token, repo, release.id, chunkAssetName, chunkBuffer);

        if (chunkIndex < totalChunks - 1) {
            return res.status(200).json({
                success: true,
                status: 'chunk_saved',
                chunkIndex: chunkIndex,
                totalChunks: totalChunks,
                assetId: chunkAssetData.id
            });
        }

        // Final chunk received! Assembling full file from GitHub temporary chunk assets...
        const chunkBuffers = [];
        const tmpAssetsToDelete = [];

        // Build list of all chunk asset IDs if passed by client, otherwise look up in all release assets
        let fullChunkAssetIds = Array.isArray(chunkAssetIds) ? [...chunkAssetIds, chunkAssetData.id] : null;

        if (fullChunkAssetIds && fullChunkAssetIds.length === totalChunks) {
            // Direct Asset ID lookup — 0ms search overhead!
            for (let i = 0; i < totalChunks; i++) {
                const assetId = fullChunkAssetIds[i];
                tmpAssetsToDelete.push(assetId);
                const downloadRes = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, {
                    headers: {
                        Authorization: `token ${token}`,
                        'Accept': 'application/octet-stream',
                        'User-Agent': 'NEXUS-App'
                    }
                });
                if (!downloadRes.ok) throw new Error(`Failed to download temporary chunk ${i} (ID: ${assetId})`);
                const buf = Buffer.from(await downloadRes.arrayBuffer());
                chunkBuffers.push(buf);
            }
        } else {
            // Fallback: Paginated release asset lookup across all pages
            const allAssets = await getAllReleaseAssets(token, repo, release.id);
            for (let i = 0; i < totalChunks; i++) {
                const partName = `_tmp_${uploadId}_part_${i}`;
                const targetAsset = allAssets.find(a => a.name === partName);
                if (!targetAsset) throw new Error(`Missing temporary chunk ${i} on GitHub Release`);
                tmpAssetsToDelete.push(targetAsset.id);

                const downloadRes = await fetch(targetAsset.url, {
                    headers: {
                        Authorization: `token ${token}`,
                        'Accept': 'application/octet-stream',
                        'User-Agent': 'NEXUS-App'
                    }
                });

                if (!downloadRes.ok) throw new Error(`Failed to download temporary chunk ${i}`);
                const buf = Buffer.from(await downloadRes.arrayBuffer());
                chunkBuffers.push(buf);
            }
        }

        const fullFileBuffer = Buffer.concat(chunkBuffers);

        if (oldFileName && oldFileName !== fileName) {
            await deleteReleaseAssetByName(token, repo, release.id, oldFileName);
        }

        // Upload combined binary buffer directly to GitHub Release Assets with 422 retry logic
        const assetData = await uploadToReleaseWithRetry(token, repo, release.id, fileName, fullFileBuffer);
        const publicUrl = assetData.browser_download_url || `https://github.com/${repo}/releases/download/materials-v1/${fileName}`;

        // Cleanup temporary chunk assets from GitHub asynchronously
        for (const delId of tmpAssetsToDelete) {
            try {
                await fetch(`https://api.github.com/repos/${repo}/releases/assets/${delId}`, {
                    method: 'DELETE',
                    headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                });
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            status: 'completed',
            publicUrl: publicUrl,
            assetId: assetData.id,
            assetName: assetData.name || fileName
        });

    } catch (error) {
        console.error('Error in upload-file chunk handler:', error);
        return res.status(500).json({ error: error.message });
    }
};
