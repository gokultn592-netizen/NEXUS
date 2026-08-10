// Vercel Serverless Function — GitHub Release Storage Engine
// Uploads up to 2GB per file directly to GitHub Release Assets with 100% free unlimited CDN hosting

async function getOrCreateRelease(token, repo) {
    const tag = 'materials-v1';
    const tagRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
        headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
    });

    if (tagRes.ok) {
        const releaseData = await tagRes.json();
        return releaseData;
    }

    // Create release if it doesn't exist
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

    try {
        const release = await getOrCreateRelease(token, repo);

        if (req.method === 'GET') {
            return res.status(200).json({
                token: token,
                repo: repo,
                releaseId: release.id,
                tagName: release.tag_name,
                uploadUrl: release.upload_url
            });
        }

        if (req.method === 'POST') {
            const { action, oldFileName } = req.body || {};

            // Handle asset deletion if requested
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

            return res.status(200).json({
                token: token,
                repo: repo,
                releaseId: release.id,
                tagName: release.tag_name
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error in upload-file endpoint:', error);
        return res.status(500).json({ error: error.message });
    }
};
