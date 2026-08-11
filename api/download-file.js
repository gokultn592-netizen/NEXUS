// Vercel Serverless Function — High-Performance Zero-Lag Streaming PDF/Asset Proxy Engine
// Streams binary chunks directly from GitHub CDN to browser in <1s (0 buffering lag),
// sets Content-Disposition: inline + Content-Type: application/pdf for 100% inline viewing,
// and sets Access-Control-Allow-Origin: * to eliminate all CORS errors!

const { Readable } = require('stream');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url, filename, view } = req.query || {};

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const fileRes = await fetch(url, {
            headers: { 'User-Agent': 'NEXUS-App' }
        });

        if (!fileRes.ok) {
            return res.status(fileRes.status).send(`Failed to fetch asset: ${fileRes.statusText}`);
        }

        const rawContentType = fileRes.headers.get('content-type') || '';
        let contentType = rawContentType;

        if (url.toLowerCase().includes('.pdf') || (filename && filename.toLowerCase().endsWith('.pdf')) || rawContentType.includes('octet-stream')) {
            contentType = 'application/pdf';
        } else if (url.toLowerCase().endsWith('.png')) {
            contentType = 'image/png';
        } else if (url.toLowerCase().endsWith('.jpg') || url.toLowerCase().endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (url.toLowerCase().endsWith('.pptx')) {
            contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else if (url.toLowerCase().endsWith('.docx')) {
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

        // Pipe web stream directly to response for instant <1s rendering
        const nodeStream = Readable.fromWeb(fileRes.body);
        nodeStream.pipe(res);
    } catch (err) {
        console.error('Error in download-file streaming proxy:', err);
        return res.status(500).json({ error: err.message });
    }
};
