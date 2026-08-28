// Vercel Serverless Function — High-Performance Chunked GitHub Release Storage Engine
// Receives chunks from browser client (bypassing Vercel 4.5MB body limit),
// stores temporary chunks on GitHub Releases (stateless across Vercel serverless containers),
// concatenates them on final chunk, uploads final asset, and cleans up temporary chunk assets!

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
        const { action, uploadId, chunkIndex, totalChunks, fileName, chunkData, oldFileName } = req.body || {};

        const release = await getOrCreateRelease(token, repo);

        // Action: Delete old asset if replacing
        if (action === 'delete' && oldFileName) {
            try {
                const assetsRes = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}/assets`, {
                    headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                });
                if (assetsRes.ok) {
                    const assets = await assetsRes.json();
                    const targetAsset = assets.find(a => a.name === oldFileName);
                    if (targetAsset) {
                        await fetch(`https://api.github.com/repos/${repo}/releases/assets/${targetAsset.id}`, {
                            method: 'DELETE',
                            headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                        });
                    }
                }
            } catch (delErr) {
                console.warn('Failed to delete old release asset:', delErr);
            }
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
            const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;
            const uploadRes = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/octet-stream',
                    'User-Agent': 'NEXUS-App'
                },
                body: chunkBuffer
            });

            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`GitHub Release Asset upload failed (${uploadRes.status}): ${errText}`);
            }

            const assetData = await uploadRes.json();
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
        const chunkUploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(chunkAssetName)}`;

        const chunkRes = await fetch(chunkUploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/octet-stream',
                'User-Agent': 'NEXUS-App'
            },
            body: chunkBuffer
        });

        if (!chunkRes.ok) {
            const errText = await chunkRes.text();
            throw new Error(`GitHub chunk upload failed (${chunkRes.status}): ${errText}`);
        }

        if (chunkIndex < totalChunks - 1) {
            return res.status(200).json({
                success: true,
                status: 'chunk_saved',
                chunkIndex: chunkIndex,
                totalChunks: totalChunks
            });
        }

        // Final chunk received! Assembling full file from GitHub temporary chunk assets...
        const assetsRes = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}/assets`, {
            headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
        });

        if (!assetsRes.ok) throw new Error('Failed to fetch release assets for chunk assembly');
        const allAssets = await assetsRes.json();

        const chunkBuffers = [];
        const tmpAssetsToDelete = [];

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

        const fullFileBuffer = Buffer.concat(chunkBuffers);

        // Upload combined binary buffer directly to GitHub Release Assets
        const finalUploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;
        const finalUploadRes = await fetch(finalUploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/octet-stream',
                'User-Agent': 'NEXUS-App'
            },
            body: fullFileBuffer
        });

        if (!finalUploadRes.ok) {
            const errText = await finalUploadRes.text();
            throw new Error(`Final GitHub Release Asset upload failed (${finalUploadRes.status}): ${errText}`);
        }

        const assetData = await finalUploadRes.json();
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
