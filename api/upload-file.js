// Vercel Serverless Function — GitHub Storage Upload
// Commits uploaded files directly to GitHub repository for 100% free unlimited CDN hosting

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
        const { fileName, fileBase64, oldFileName } = req.body;

        if (!fileName || !fileBase64) {
            return res.status(400).json({ error: 'Missing fileName or fileBase64' });
        }

        const token = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';

        if (!token) {
            throw new Error('GITHUB_TOKEN environment variable is not configured');
        }

        // If oldFileName is provided and different, delete old file from GitHub storage
        if (oldFileName && oldFileName !== fileName) {
            try {
                const oldPath = `materials/${oldFileName}`;
                const checkOld = await fetch(`https://api.github.com/repos/${repo}/contents/${oldPath}`, {
                    headers: { Authorization: `token ${token}`, 'User-Agent': 'NEXUS-App' }
                });
                if (checkOld.ok) {
                    const oldData = await checkOld.json();
                    await fetch(`https://api.github.com/repos/${repo}/contents/${oldPath}`, {
                        method: 'DELETE',
                        headers: {
                            Authorization: `token ${token}`,
                            'Content-Type': 'application/json',
                            'User-Agent': 'NEXUS-App'
                        },
                        body: JSON.stringify({
                            message: `Delete replaced material: ${oldFileName}`,
                            sha: oldData.sha
                        })
                    });
                }
            } catch (delErr) {
                console.warn('Failed to delete old file on GitHub:', delErr);
            }
        }

        // Clean base64 string if data URI scheme header is present and strip newlines
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
        const path = `materials/${fileName}`;

        // Step 1: Check if file exists to get existing SHA for updates
        let sha = null;
        const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            headers: {
                Authorization: `token ${token}`,
                'User-Agent': 'NEXUS-App'
            }
        });
        if (checkRes.ok) {
            const existingData = await checkRes.json();
            sha = existingData.sha;
        }

        const putBody = {
            message: `Upload material: ${fileName}`,
            content: cleanBase64
        };
        if (sha) putBody.sha = sha;

        // Step 2: Upload or update file via GitHub Contents API
        const uploadRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            method: 'PUT',
            headers: {
                Authorization: `token ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NEXUS-App'
            },
            body: JSON.stringify(putBody)
        });

        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`GitHub upload failed (${uploadRes.status}): ${errText}`);
        }

        const data = await uploadRes.json();
        const publicUrl = `https://raw.githubusercontent.com/${repo}/main/${path}`;

        return res.status(200).json({
            success: true,
            publicUrl: publicUrl,
            downloadUrl: data.content.download_url
        });

    } catch (error) {
        console.error('Error in upload-file:', error);
        return res.status(500).json({ error: error.message });
    }
};
