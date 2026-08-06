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

        const token = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';
        const match = fileUrl.match(/\/materials\/(.+)$/);
        const path = match ? `materials/${match[1]}` : fileUrl.split('/').slice(-2).join('/');

        // 1. Get SHA of target file in GitHub repo
        const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            headers: {
                Authorization: `token ${token}`,
                'User-Agent': 'NEXUS-App'
            }
        });

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
