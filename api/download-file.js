// Vercel / Serverless Proxy Function — Secure Asset Streaming Engine
// Accepts assetId or url parameter, reads process.env.GITHUB_TOKEN securely on backend,
// streams raw binary from GitHub Release Assets, sets Content-Disposition: inline + Content-Type: application/pdf,
// and sets Access-Control-Allow-Origin: * to eliminate all browser CORS errors!

const { Readable } = require('stream');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { assetId, url, filename, view } = req.query || {};
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';

    if (!token) {
        return res.status(500).json({ error: 'GITHUB_TOKEN environment variable is not configured' });
    }

    if (!assetId && !url) {
        return res.status(400).json({ error: 'Missing assetId or url parameter' });
    }

    try {
        let targetFetchUrl = url;
        const fetchHeaders = { 'User-Agent': 'NEXUS-App' };

        if (assetId) {
            targetFetchUrl = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`;
            fetchHeaders['Authorization'] = `token ${token}`;
            fetchHeaders['Accept'] = 'application/octet-stream';
        }

        const fileRes = await fetch(targetFetchUrl, { headers: fetchHeaders });

        if (!fileRes.ok) {
            return res.status(fileRes.status).send(`Failed to fetch asset (${fileRes.status}): ${fileRes.statusText}`);
        }

        const rawContentType = fileRes.headers.get('content-type') || '';
        let contentType = rawContentType;
        const targetClean = ((filename || '') + ' ' + (url || '')).toLowerCase();

        if (targetClean.includes('.pdf') || rawContentType.includes('octet-stream') || assetId) {
            contentType = 'application/pdf';
        } else if (targetClean.includes('.png')) {
            contentType = 'image/png';
        } else if (targetClean.includes('.jpg') || targetClean.includes('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (targetClean.includes('.pptx')) {
            contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else if (targetClean.includes('.docx')) {
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }

        res.setHeader('Content-Type', contentType);

        if (view === 'download' || (filename && view !== 'inline' && view !== '1' && view !== 'true')) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'material.pdf')}"`);
        } else {
            res.setHeader('Content-Disposition', 'inline');
        }

        const contentLength = fileRes.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);

        // Stream binary directly to client with 0 buffering lag
        const nodeStream = Readable.fromWeb(fileRes.body);
        nodeStream.pipe(res);
    } catch (err) {
        console.error('Error in download-file streaming proxy:', err);
        return res.status(500).json({ error: err.message });
    }
};
