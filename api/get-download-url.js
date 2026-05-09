// Vercel Serverless Function — B2 Signed Download URL

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'Missing fileName' });

        const keyId  = process.env.B2_KEY_ID;
        const appKey = process.env.B2_APP_KEY;
        const bucket = process.env.B2_BUCKET;

        // Step 1: Authorize
        const authResponse = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64'),
            },
        });

        if (!authResponse.ok) {
            const err = await authResponse.json();
            throw new Error(`B2 auth failed: ${err.message}`);
        }

        const authData    = await authResponse.json();
        const apiUrl      = authData.apiInfo.storageApi.apiUrl;
        const authToken   = authData.authorizationToken;
        const downloadUrl = authData.apiInfo.storageApi.downloadUrl;

        // Step 2: Get bucket ID
        const listRes = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets?accountId=${authData.accountId}&bucketName=${bucket}`, {
            headers: { Authorization: authToken },
        });

        if (!listRes.ok) {
            const err = await listRes.json();
            throw new Error(`B2 list buckets failed: ${err.message}`);
        }

        const listData = await listRes.json();
        const bucketId = listData.buckets?.[0]?.bucketId;

        if (!bucketId) throw new Error(`Bucket "${bucket}" not found`);

        // Step 3: Get download authorization
        const dlAuthRes = await fetch(`${apiUrl}/b2api/v3/b2_get_download_authorization`, {
            method: 'POST',
            headers: {
                Authorization: authToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bucketId,
                fileNamePrefix: fileName,
                validDurationInSeconds: 3600,
            }),
        });

        if (!dlAuthRes.ok) {
            const err = await dlAuthRes.json();
            throw new Error(`B2 download auth failed: ${JSON.stringify(err)}`);
        }

        const dlAuthData = await dlAuthRes.json();
        const signedUrl  = `${downloadUrl}/file/${bucket}/${fileName}?Authorization=${dlAuthData.authorizationToken}`;

        return res.status(200).json({ signedUrl });

    } catch (error) {
        console.error('Error in get-download-url:', error);
        return res.status(500).json({ error: error.message });
    }
};
