/*
    CHANGELOG â€” api/delete-file.js
    ================================
    [2026-05-09] Changes made vs original GitHub version:

    COMPLETE REWRITE â€” old version called a /api/delete-file backend route that
    didn't exist, so deletions always failed silently.

    New version uses B2's native HTTP API:
      Step 1: b2_authorize_account      â†’ gets auth token + API URL
      Step 2: b2_list_file_versions     â†’ finds the fileId for the given filename
      Step 3: b2_delete_file_version    â†’ permanently deletes the file from B2

    No AWS SDK dependency needed â€” uses Node.js built-in fetch().
*/
// Vercel Serverless Function â€” B2 Native File Deletion
// Uses B2's own delete API instead of S3-compatible DeleteObject.

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

        const keyId  = process.env.B2_KEY_ID;
        const appKey = process.env.B2_APP_KEY;
        const bucket = process.env.B2_BUCKET;

        // â”€â”€â”€ Step 1: Authorize Account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const authResponse = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64'),
            },
        });

        if (!authResponse.ok) {
            const err = await authResponse.json();
            throw new Error(`B2 auth failed: ${err.message}`);
        }

        const authData  = await authResponse.json();
        const apiUrl    = authData.apiInfo.storageApi.apiUrl;
        const authToken = authData.authorizationToken;

        // â”€â”€â”€ Step 2: Extract file name from URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // URL format: https://fXXX.backblazeb2.com/file/bucket-name/materials/xxx_file.pdf
        const fileNameMatch = fileUrl.match(/\/file\/[^/]+\/(.+)$/);
        if (!fileNameMatch) {
            throw new Error('Could not extract file name from URL');
        }
        const fileName = fileNameMatch[1];

        // â”€â”€â”€ Step 3: List file versions to get the fileId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const listResponse = await fetch(`${apiUrl}/b2api/v3/b2_list_file_versions?bucketName=${bucket}&startFileName=${encodeURIComponent(fileName)}&maxFileCount=1`, {
            headers: { Authorization: authToken },
        });

        if (!listResponse.ok) {
            const err = await listResponse.json();
            throw new Error(`B2 list file versions failed: ${err.message}`);
        }

        const listData = await listResponse.json();
        const file = listData.files?.[0];

        if (!file || file.fileName !== fileName) {
            // File already gone â€” treat as success
            return res.status(200).json({ success: true, message: 'File not found (already deleted)' });
        }

        // â”€â”€â”€ Step 4: Delete the file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const deleteResponse = await fetch(`${apiUrl}/b2api/v3/b2_delete_file_version`, {
            method: 'POST',
            headers: {
                Authorization: authToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileId:   file.fileId,
                fileName: file.fileName,
            }),
        });

        if (!deleteResponse.ok) {
            const err = await deleteResponse.json();
            throw new Error(`B2 delete failed: ${err.message}`);
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Error in delete-file:', error);
        return res.status(500).json({ error: error.message });
    }
};
