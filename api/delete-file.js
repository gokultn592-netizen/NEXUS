const { deleteFiles, listFiles } = require('@huggingface/hub');

function getCleanBaseFileName(name) {
    if (!name) return '';
    const clean = name.split('?')[0];
    return clean.replace(/\.part\d+$/, '');
}

async function deleteFromHuggingFace(token, repo, fileName) {
    if (!fileName) return;
    const cleanRepo = repo.replace(/^datasets\//, '');
    const baseName = getCleanBaseFileName(fileName);

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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = process.env.HF_TOKEN || process.env.GITHUB_TOKEN;
    const repo = process.env.HF_REPO || process.env.GITHUB_REPO || 'ThalaivarGokul447/nexus-materials';

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
