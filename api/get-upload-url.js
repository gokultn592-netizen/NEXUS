// Vercel Serverless Function — B2 Native Upload URL
// Uses B2's own API instead of S3-compatible presigned URLs.
// This avoids the "authorization token missing" error caused by
// SigV4 presigned URL incompatibilities with B2's CORS policy.

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
        const { fileName, fileType } = req.body;

        if (!fileName || !fileType) {
            return res.status(400).json({ error: 'Missing fileName or fileType' });
        }

        const keyId  = process.env.B2_KEY_ID;
        const appKey = process.env.B2_APP_KEY;
        const bucket = process.env.B2_BUCKET;

        // ─── Step 1: Authorize Account ────────────────────────────────────────
        const authResponse = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64'),
            },
        });

        if (!authResponse.ok) {
            const err = await authResponse.json();
            throw new Error(`B2 auth failed: ${err.message}`);
        }

        const authData = await authResponse.json();
        const apiUrl   = authData.apiInfo.storageApi.apiUrl;
        const authToken = authData.authorizationToken;

        // ─── Step 2: List buckets to find the bucket ID ───────────────────────
        const listResponse = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets?accountId=${authData.accountId}&bucketName=${bucket}`, {
            headers: { Authorization: authToken },
        });

        if (!listResponse.ok) {
            const err = await listResponse.json();
            throw new Error(`B2 list buckets failed: ${err.message}`);
        }

        const listData = await listResponse.json();
        const bucketId = listData.buckets?.[0]?.bucketId;

        if (!bucketId) {
            throw new Error(`Bucket "${bucket}" not found`);
        }

        // ─── Step 3: Get Upload URL ───────────────────────────────────────────
        const uploadUrlResponse = await fetch(`${apiUrl}/b2api/v3/b2_get_upload_url`, {
            method: 'POST',
            headers: {
                Authorization: authToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ bucketId }),
        });

        if (!uploadUrlResponse.ok) {
            const err = await uploadUrlResponse.json();
            throw new Error(`B2 get upload URL failed: ${err.message}`);
        }

        const uploadData = await uploadUrlResponse.json();

        // ─── Build the public download URL ────────────────────────────────────
        const uniqueFileName = `materials/${Date.now()}_${fileName}`;
        const downloadUrl    = authData.apiInfo.storageApi.downloadUrl;
        const publicUrl      = `${downloadUrl}/file/${bucket}/${uniqueFileName}`;

        // Return everything the frontend needs
        return res.status(200).json({
            uploadUrl:  uploadData.uploadUrl,
            authToken:  uploadData.authorizationToken,
            fileName:   uniqueFileName,
            publicUrl,
        });

    } catch (error) {
        console.error('Error in get-upload-url:', error);
        return res.status(500).json({ error: error.message });
    }
};
