// Vercel Serverless Function — NEXUS High-Speed Material Proxy Engine
// Resolves GitHub Release Asset redirects, removes Content-Disposition attachment restriction,
// and streams raw binary with Access-Control-Allow-Origin: * so PDFs view inline and PWA caching succeeds 100%!

module.exports = async function handler(req, res) {
    // Enable CORS for all web clients
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

        if (url.toLowerCase().endsWith('.pdf') || (filename && filename.toLowerCase().endsWith('.pdf')) || rawContentType.includes('octet-stream')) {
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

        if (view === '1' || view === 'true' || view === 'inline') {
            res.setHeader('Content-Disposition', 'inline');
        } else if (filename) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        } else {
            res.setHeader('Content-Disposition', 'inline');
        }

        const arrayBuffer = await fileRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (err) {
        console.error('Error in download-file proxy:', err);
        return res.status(500).json({ error: err.message });
    }
};
