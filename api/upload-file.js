// Vercel Serverless Function — GitHub Release Storage Engine Backend Proxy
// Proxies file uploads directly to GitHub Release Assets with ZERO CORS issues & support for up to 2GB per file!

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
            body: 'Permanent storage for NEXUS course materials (supports up to 2GB per file).',
            draft: false,
            prerelease: false
        })
    });

    if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Failed to create release tag: ${errText}`);
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
        return res.status(200).json({ token, repo });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { fileName, fileBase64, oldFileName } = req.body || {};

        if (!fileName || !fileBase64) {
            return res.status(400).json({ error: 'Missing fileName or fileBase64' });
        }

        const release = await getOrCreateRelease(token, repo);

        // Delete old asset if replacing
        if (oldFileName && oldFileName !== fileName) {
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
        }

        // Clean Base64 string and convert to binary Buffer
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
        const fileBuffer = Buffer.from(cleanBase64, 'base64');

        // Upload raw binary stream directly from Node backend to GitHub Release Assets
        const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;

        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/octet-stream',
                'User-Agent': 'NEXUS-App'
            },
            body: fileBuffer
        });

        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`GitHub Release Asset upload failed (${uploadRes.status}): ${errText}`);
        }

        const assetData = await uploadRes.json();
        const publicUrl = assetData.browser_download_url || `https://github.com/${repo}/releases/download/materials-v1/${fileName}`;

        return res.status(200).json({
            success: true,
            publicUrl: publicUrl
        });

    } catch (error) {
        console.error('Error in upload-file backend:', error);
        return res.status(500).json({ error: error.message });
    }
};
