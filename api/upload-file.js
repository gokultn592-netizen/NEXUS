// Vercel Serverless Function — Hugging Face Datasets High-Performance Storage Engine
// Receives files/chunks from browser client, commits directly to Hugging Face Dataset repository,
// and returns direct CORS-enabled resolution URLs (https://huggingface.co/datasets/USER/REPO/resolve/main/FILE.pdf)

global.chunkStore = global.chunkStore || {};

async function uploadToHuggingFace(token, repo, fileName, fileBuffer) {
    const cleanRepo = repo.replace(/^datasets\//, '');
    
    // Method A: Try @huggingface/hub JS SDK if available
    try {
        const hub = await import('@huggingface/hub');
        if (hub && hub.uploadFile) {
            const blob = new Blob([fileBuffer]);
            await hub.uploadFile({
                repo: { type: 'dataset', name: cleanRepo },
                accessToken: token,
                file: {
                    path: fileName,
                    content: blob
                }
            });
            return `https://huggingface.co/datasets/${cleanRepo}/resolve/main/${encodeURIComponent(fileName)}`;
        }
    } catch (sdkErr) {
        console.warn('HF SDK upload notice:', sdkErr.message);
    }

    // Method B: Direct HuggingFace REST Commit API fallback
    const commitUrl = `https://huggingface.co/api/datasets/${cleanRepo}/commit/main`;
    const base64Content = fileBuffer.toString('base64');

    const res = await fetch(commitUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'NEXUS-App'
        },
        body: JSON.stringify({
            summary: `Upload material ${fileName}`,
            operations: [
                {
                    operation: 'addOrUpdate',
                    path: fileName,
                    content: base64Content,
                    encoding: 'base64'
                }
            ]
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HuggingFace upload failed (${res.status}): ${errText}`);
    }

    return `https://huggingface.co/datasets/${cleanRepo}/resolve/main/${encodeURIComponent(fileName)}`;
}

function getCleanBaseFileName(name) {
    if (!name) return '';
    const clean = name.split('?')[0];
    return clean.replace(/\.part\d+$/, '');
}

async function deleteFromHuggingFace(token, repo, fileName) {
    if (!fileName) return;
    const cleanRepo = repo.replace(/^datasets\//, '');
    const baseName = getCleanBaseFileName(fileName);

    const commitUrl = `https://huggingface.co/api/datasets/${cleanRepo}/commit/main`;
    try {
        const ops = [
            { operation: 'delete', path: baseName },
            { operation: 'delete', path: `${baseName}.part0` }
        ];
        for (let i = 1; i < 20; i++) {
            ops.push({ operation: 'delete', path: `${baseName}.part${i}` });
        }

        await fetch(commitUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NEXUS-App'
            },
            body: JSON.stringify({
                summary: `Delete material ${baseName}`,
                operations: ops
            })
        });
    } catch (e) {
        console.warn('HF REST delete failed:', e);
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = process.env.HF_TOKEN || process.env.GITHUB_TOKEN;
    const repo = process.env.HF_REPO || process.env.GITHUB_REPO || 'ThalaivarGokul447/nexus-materials';

    if (!token) {
        return res.status(500).json({ error: 'HF_TOKEN environment variable is not configured' });
    }

    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ready', engine: 'NEXUS HuggingFace Datasets Storage' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { action, uploadId, chunkIndex, totalChunks, fileName, chunkData, oldFileName } = req.body || {};

        // Action: Delete old asset if replacing
        if (action === 'delete' && oldFileName) {
            await deleteFromHuggingFace(token, repo, oldFileName);
            return res.status(200).json({ success: true, message: 'Material deleted from HuggingFace' });
        }

        if (!uploadId || chunkIndex === undefined || totalChunks === undefined || !fileName || !chunkData) {
            return res.status(400).json({ error: 'Missing required upload parameters' });
        }

        const cleanBase64 = chunkData.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
        const chunkBuffer = Buffer.from(cleanBase64, 'base64');

        // Delete old file ONLY if base name changed (e.g., replaced with a completely different file)
        // If oldBase === newBase (re-uploading same file), chunk uploads will overwrite in-place cleanly without race condition!
        const oldBase = getCleanBaseFileName(oldFileName);
        const newBase = getCleanBaseFileName(fileName);
        if (oldBase && oldBase !== newBase && chunkIndex === 0) {
            deleteFromHuggingFace(token, repo, oldBase).catch(e => console.warn('Old file delete notice:', e));
        }

        // Single chunk upload (<= 3.2MB file)
        if (totalChunks === 1) {
            const publicUrl = await uploadToHuggingFace(token, repo, fileName, chunkBuffer);
            return res.status(200).json({
                success: true,
                status: 'completed',
                publicUrl: publicUrl,
                assetName: fileName
            });
        }

        // Multi-chunk upload (> 3.2MB file) — upload chunk directly to HF as fileName.part{chunkIndex}
        const chunkFileName = `${fileName}.part${chunkIndex}`;
        const chunkPublicUrl = await uploadToHuggingFace(token, repo, chunkFileName, chunkBuffer);

        const cleanRepo = repo.replace(/^datasets\//, '');
        const finalUrl = `https://huggingface.co/datasets/${cleanRepo}/resolve/main/${encodeURIComponent(fileName)}.part0?parts=${totalChunks}`;

        return res.status(200).json({
            success: true,
            status: 'chunk_uploaded',
            chunkIndex: chunkIndex,
            totalChunks: totalChunks,
            publicUrl: finalUrl,
            chunkUrl: chunkPublicUrl
        });

    } catch (error) {
        console.error('Error in upload-file Hugging Face handler:', error);
        return res.status(500).json({ error: error.message });
    }
};
