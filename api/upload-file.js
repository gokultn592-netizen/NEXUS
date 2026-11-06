// Vercel Serverless Function — Hugging Face Datasets High-Performance Storage Engine
// Receives files/chunks from browser client, commits directly to Hugging Face Dataset repository,
// and returns direct CORS-enabled resolution URLs (https://huggingface.co/datasets/USER/REPO/resolve/main/FILE.pdf)

const { uploadFile, deleteFiles, listFiles } = require('@huggingface/hub');

global.chunkStore = global.chunkStore || {};

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'zip', 'png', 'jpg', 'jpeg']);

function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return '';
    const clean = name.split('?')[0];
    const base = clean.split(/[/\\]/).pop();
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
}

function isValidExtension(name) {
    if (!name) return false;
    const parts = name.split('.');
    if (parts.length < 2) return false;
    const ext = parts.pop().toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
}

async function uploadToHuggingFace(token, repo, fileName, fileBuffer, maxRetries = 3) {
    const cleanRepo = repo.replace(/^datasets\//, '');
    const blob = new Blob([fileBuffer]);

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await uploadFile({
                repo: { type: 'dataset', name: cleanRepo },
                accessToken: token,
                file: {
                    path: fileName,
                    content: blob
                },
                commitTitle: `Upload material ${fileName}`
            });
            return `https://huggingface.co/datasets/${cleanRepo}/resolve/main/${encodeURIComponent(fileName)}`;
        } catch (err) {
            lastError = err;
            console.warn(`[HF Upload] Attempt ${attempt}/${maxRetries} for ${fileName} failed:`, err.message);
            if (attempt === maxRetries) {
                throw new Error(`Hugging Face upload failed for ${fileName} after ${maxRetries} attempts: ${err.message}`);
            }
            // Exponential backoff with random jitter to allow Git HEAD to settle
            const jitter = Math.floor(Math.random() * 300);
            const delay = Math.pow(2, attempt - 1) * 800 + jitter;
            await new Promise(res => setTimeout(res, delay));
        }
    }
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
    if (!baseName || baseName === '.' || baseName === '..') return;

    try {
        const existingPaths = [];
        for await (const file of listFiles({ repo: { type: 'dataset', name: cleanRepo }, accessToken: token })) {
            if (file.path === baseName || file.path.startsWith(`${baseName}.part`)) {
                existingPaths.push(file.path);
            }
        }

        if (existingPaths.length > 0) {
            await deleteFiles({
                repo: { type: 'dataset', name: cleanRepo },
                accessToken: token,
                paths: existingPaths,
                commitTitle: `Delete material ${baseName}`
            });
            console.log(`[HF Delete] Successfully deleted ${existingPaths.length} file(s) for ${baseName}`);
        }
    } catch (e) {
        console.warn('[HF Delete] Notice:', e.message);
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');

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

        // Action: Get upload credentials for direct client-side single-commit upload (Option 1)
        if (action === 'get_upload_auth') {
            if (oldFileName) {
                const safeOld = sanitizeFilename(oldFileName);
                if (safeOld) {
                    deleteFromHuggingFace(token, repo, safeOld).catch(e => console.warn('Old file delete notice:', e));
                }
            }
            return res.status(200).json({
                success: true,
                token: token,
                repo: repo
            });
        }

        // Action: Delete old asset if replacing
        if (action === 'delete' && oldFileName) {
            const safeOld = sanitizeFilename(oldFileName);
            if (safeOld) {
                await deleteFromHuggingFace(token, repo, safeOld);
            }
            return res.status(200).json({ success: true, message: 'Material deleted from HuggingFace' });
        }

        if (!uploadId || chunkIndex === undefined || totalChunks === undefined || !fileName || !chunkData) {
            return res.status(400).json({ error: 'Missing required upload parameters' });
        }

        const safeFileName = sanitizeFilename(fileName);
        if (!safeFileName || !isValidExtension(safeFileName)) {
            return res.status(400).json({ error: 'Invalid file name or unsupported file extension' });
        }

        const numTotalChunks = parseInt(totalChunks, 10);
        const numChunkIndex = parseInt(chunkIndex, 10);
        if (isNaN(numTotalChunks) || numTotalChunks < 1 || numTotalChunks > 100) {
            return res.status(400).json({ error: 'Invalid totalChunks value (must be 1-100)' });
        }
        if (isNaN(numChunkIndex) || numChunkIndex < 0 || numChunkIndex >= numTotalChunks) {
            return res.status(400).json({ error: 'Invalid chunkIndex value' });
        }

        if (typeof chunkData !== 'string' || chunkData.length > 9 * 1024 * 1024) {
            return res.status(413).json({ error: 'Payload chunk too large' });
        }

        const cleanBase64 = chunkData.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
        const chunkBuffer = Buffer.from(cleanBase64, 'base64');

        // Delete old file ONLY if base name changed (e.g., replaced with a completely different file)
        const safeOldFileName = sanitizeFilename(oldFileName);
        const oldBase = getCleanBaseFileName(safeOldFileName);
        const newBase = getCleanBaseFileName(safeFileName);
        if (oldBase && oldBase !== newBase && numChunkIndex === 0) {
            await deleteFromHuggingFace(token, repo, oldBase).catch(e => console.warn('Old file delete notice:', e));
        }

        // Single chunk upload (<= 3.2MB file)
        if (numTotalChunks === 1) {
            const publicUrl = await uploadToHuggingFace(token, repo, safeFileName, chunkBuffer);
            return res.status(200).json({
                success: true,
                status: 'completed',
                publicUrl: publicUrl,
                assetName: safeFileName
            });
        }

        // Multi-chunk upload (> 3.2MB file) — upload chunk directly to HF as safeFileName.part{numChunkIndex}
        const chunkFileName = `${safeFileName}.part${numChunkIndex}`;
        const chunkPublicUrl = await uploadToHuggingFace(token, repo, chunkFileName, chunkBuffer);

        const cleanRepo = repo.replace(/^datasets\//, '');
        const finalUrl = `https://huggingface.co/datasets/${cleanRepo}/resolve/main/${encodeURIComponent(safeFileName)}.part0?parts=${numTotalChunks}`;

        return res.status(200).json({
            success: true,
            status: 'chunk_uploaded',
            chunkIndex: numChunkIndex,
            totalChunks: numTotalChunks,
            publicUrl: finalUrl,
            chunkUrl: chunkPublicUrl
        });

    } catch (error) {
        console.error('Error in upload-file Hugging Face handler:', error);
        return res.status(500).json({ error: error.message });
    }
};
