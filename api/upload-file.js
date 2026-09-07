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

async function deleteFromHuggingFace(token, repo, fileName) {
    if (!fileName) return;
    const cleanRepo = repo.replace(/^datasets\//, '');

    try {
        const hub = await import('@huggingface/hub');
        if (hub && hub.deleteFile) {
            await hub.deleteFile({
                repo: { type: 'dataset', name: cleanRepo },
                accessToken: token,
                path: fileName
            });
            return;
        }
    } catch (sdkErr) {
        console.warn('HF SDK delete notice:', sdkErr.message);
    }

    // Direct REST API deletion fallback
    const commitUrl = `https://huggingface.co/api/datasets/${cleanRepo}/commit/main`;
    try {
        await fetch(commitUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NEXUS-App'
            },
            body: JSON.stringify({
                summary: `Delete material ${fileName}`,
                operations: [
                    {
                        operation: 'delete',
                        path: fileName
                    }
                ]
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

        // Case A: Single chunk upload (file <= 3MB)
        if (totalChunks === 1) {
            if (oldFileName && oldFileName !== fileName) {
                await deleteFromHuggingFace(token, repo, oldFileName);
            }

            const publicUrl = await uploadToHuggingFace(token, repo, fileName, chunkBuffer);

            return res.status(200).json({
                success: true,
                status: 'completed',
                publicUrl: publicUrl,
                assetName: fileName
            });
        }

        // Case B: Multi-chunk upload (> 3MB file) — accumulate chunk in memory
        if (!global.chunkStore[uploadId]) {
            global.chunkStore[uploadId] = [];
        }
        global.chunkStore[uploadId][chunkIndex] = chunkBuffer;

        if (chunkIndex < totalChunks - 1) {
            return res.status(200).json({
                success: true,
                status: 'chunk_saved',
                chunkIndex: chunkIndex,
                totalChunks: totalChunks
            });
        }

        // Final chunk received! Assemble full file buffer and upload to Hugging Face
        const allChunks = global.chunkStore[uploadId] || [];
        const fullFileBuffer = Buffer.concat(allChunks);
        delete global.chunkStore[uploadId];

        if (oldFileName && oldFileName !== fileName) {
            await deleteFromHuggingFace(token, repo, oldFileName);
        }

        const publicUrl = await uploadToHuggingFace(token, repo, fileName, fullFileBuffer);

        return res.status(200).json({
            success: true,
            status: 'completed',
            publicUrl: publicUrl,
            assetName: fileName
        });

    } catch (error) {
        console.error('Error in upload-file Hugging Face handler:', error);
        return res.status(500).json({ error: error.message });
    }
};
