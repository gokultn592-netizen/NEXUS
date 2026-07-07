// Vercel Serverless Function — B2 Signed Download URL
// Generates a time-limited download URL for private B2 files

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { fileName } = req.body;

        if (!fileName) {
            return res.status(400).json({ error: 'Missing fileName' });
        }

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

        const authData  = await authResponse.json();
        const apiUrl    = authData.apiInfo.storageApi.apiUrl;
        const authToken = authData.authorizationToken;

        // Step 2: Get download authorization (valid for 1 hour)
        const dlAuthResponse = await fetch(`${apiUrl}/b2api/v3/b2_get_download_authorization`, {
            method: 'POST',
            headers: {
                Authorization: authToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bucketId:               authData.apiInfo.storageApi.bucketId || await getBucketId(apiUrl, authToken, authData.accountId, bucket),
                fileNamePrefix:         fileName,
                validDurationInSeconds: 3600, // 1 hour
            }),
        });

        // Fallback: get bucketId first then retry
        if (!dlAuthResponse.ok) {
            // Get bucket ID
            const listRes = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets?accountId=${authData.accountId}&bucketName=${bucket}`, {
                headers: { Authorization: authToken },
            });
            const listData = await listRes.json();
            const bucketId = listData.buckets?.[0]?.bucketId;

            const dlAuthResponse2 = await fetch(`${apiUrl}/b2api/v3/b2_get_download_authorization`, {
                method: 'POST',
                headers: {
                    Authorization: authToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    bucketId,
                    fileNamePrefix:         fileName,
                    validDurationInSeconds: 3600,
                }),
            });

            if (!dlAuthResponse2.ok) {
                const err = await dlAuthResponse2.json();
                throw new Error(`B2 download auth failed: ${err.message}`);
            }

            const dlAuthData = await dlAuthResponse2.json();
            const downloadUrl = authData.apiInfo.storageApi.downloadUrl;
            const signedUrl = `${downloadUrl}/file/${bucket}/${fileName}?Authorization=${dlAuthData.authorizationToken}`;
            return res.status(200).json({ signedUrl });
        }

        const dlAuthData  = await dlAuthResponse.json();
        const downloadUrl = authData.apiInfo.storageApi.downloadUrl;
        const signedUrl   = `${downloadUrl}/file/${bucket}/${fileName}?Authorization=${dlAuthData.authorizationToken}`;

        return res.status(200).json({ signedUrl });

    } catch (error) {
        console.error('Error in get-download-url:', error);
        return res.status(500).json({ error: error.message });
    }
};