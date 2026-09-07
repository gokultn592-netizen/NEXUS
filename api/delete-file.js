// Vercel Serverless Function — Hugging Face Material File Deletion Engine

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
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = process.env.HF_TOKEN || process.env.GITHUB_TOKEN;
    const repo = process.env.HF_REPO || process.env.GITHUB_REPO || 'gokultn592-netizen/nexus-materials';

    if (!token) {
        return res.status(500).json({ error: 'HF_TOKEN environment variable is not configured' });
    }

    try {
        const { fileUrl } = req.body || {};

        if (!fileUrl) {
            return res.status(400).json({ error: 'Missing fileUrl' });
        }

        let fileName = null;
        try {
            const urlObj = new URL(fileUrl);
            const parts = urlObj.pathname.split('/');
            fileName = decodeURIComponent(parts[parts.length - 1]);
        } catch (e) {
            const match = fileUrl.match(/\/([^\/]+)$/);
            fileName = match ? decodeURIComponent(match[1]) : null;
        }

        if (fileName) {
            await deleteFromHuggingFace(token, repo, fileName);
        }

        return res.status(200).json({ success: true, message: 'Material deleted from Hugging Face Dataset' });
    } catch (error) {
        console.error('Delete API error:', error);
        return res.status(500).json({ error: error.message });
    }
};
