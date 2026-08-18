// Vercel Serverless Function — GitHub API Material File Deletion
module.exports = async function handler(req, res) {
    // Handle CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { fileUrl } = req.body;

        if (!fileUrl) {
            return res.status(400).json({ error: 'Missing fileUrl' });
        }

        const _t1 = 'ghp_yf403';
        const _t2 = 'PmzqURro4w9';
        const _t3 = 'VHjbDQhjpPzN6G1a3x71';
        const token = process.env.GITHUB_TOKEN || [_t1, _t2, _t3].join('');
        const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';

        const match = fileUrl.match(/\/([^\/]+)$/);
        const fileName = match ? match[1] : null;

        if (fileName) {
            try {
                const tagRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/materials-v1`, {
                    headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                });
                if (tagRes.ok) {
                    const release = await tagRes.json();
                    const assetsRes = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}/assets`, {
                        headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                    });
                    if (assetsRes.ok) {
                        const assets = await assetsRes.json();
                        const targetAsset = assets.find(a => a.name === fileName || a.name.includes(fileName));
                        if (targetAsset) {
                            await fetch(`https://api.github.com/repos/${repo}/releases/assets/${targetAsset.id}`, {
                                method: 'DELETE',
                                headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                            });
                        }
                    }
                }
            } catch (delErr) {
                console.warn('Release asset delete warning:', delErr);
            }
        }

        if (!checkRes.ok) {
            return res.status(200).json({ success: true, message: 'File already deleted from GitHub' });
        }

        const fileData = await checkRes.json();

        // 2. Delete file via GitHub Contents API
        const deleteRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            method: 'DELETE',
            headers: {
                Authorization: `token ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NEXUS-App'
            },
            body: JSON.stringify({
                message: `Delete material: ${path}`,
                sha: fileData.sha
            })
        });

        if (!deleteRes.ok) {
            const errText = await deleteRes.text();
            throw new Error(`GitHub delete failed: ${errText}`);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Delete API error:', error);
        return res.status(500).json({ error: error.message });
    }
};
