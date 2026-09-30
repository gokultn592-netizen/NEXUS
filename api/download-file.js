// Vercel / Serverless Proxy Function — Hybrid Asset Download & Streaming Engine
// Accepts assetId or url parameter.
// For Hugging Face Datasets URLs: Redirects immediately (302) for direct CORS browser fetch.
// For Legacy GitHub Release Assets / Asset IDs: Streams raw binary from GitHub API with CORS headers.

const { Readable } = require('stream');

// Allowed hostnames for the streaming proxy to prevent SSRF and open proxy abuse
const ALLOWED_HOSTS = [
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'api.github.com',
    'github.com',
    'raw.githubusercontent.com',
    'github-releases.githubusercontent.com',
    'objects.githubusercontent.com'
];

function isAllowedHost(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return ALLOWED_HOSTS.some(allowed => lower === allowed || lower.endsWith('.' + allowed));
}

function sanitizeFilename(filename) {
    if (!filename) return 'material.pdf';
    // Remove control characters, newlines, quotes, semicolons, and slashes to prevent HTTP header injection
    const clean = filename.replace(/[\r\n\x00-\x1f\x7f"';\\]/g, '_').trim();
    return clean || 'material.pdf';
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { assetId, url, filename, view } = req.query || {};
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gokultn592-netizen/NEXUS';

    if (!assetId && !url) {
        return res.status(400).json({ error: 'Missing assetId or url parameter' });
    }

    try {
        let parsedUrl = null;
        if (url) {
            try {
                parsedUrl = new URL(url);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid URL format' });
            }

            // Enforce HTTPS
            if (parsedUrl.protocol !== 'https:') {
                return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
            }

            // Check hostname against whitelist to prevent SSRF
            if (!isAllowedHost(parsedUrl.hostname)) {
                return res.status(403).json({ error: 'Domain not permitted for streaming proxy' });
            }

            // If it's a verified Hugging Face URL, issue 302 redirect for direct browser fetch
            if (parsedUrl.hostname === 'huggingface.co' || parsedUrl.hostname.endsWith('.huggingface.co')) {
                return res.redirect(302, parsedUrl.href);
            }
        }

        let targetFetchUrl = parsedUrl ? parsedUrl.href : null;
        const fetchHeaders = { 'User-Agent': 'NEXUS-App' };

        if (assetId) {
            // Strictly validate that assetId is numeric to prevent API path injection
            if (!/^\d+$/i.test(String(assetId).trim())) {
                return res.status(400).json({ error: 'Invalid assetId format' });
            }
            targetFetchUrl = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`;
            if (token) fetchHeaders['Authorization'] = `token ${token}`;
            fetchHeaders['Accept'] = 'application/octet-stream';
        } else if (parsedUrl && parsedUrl.hostname === 'api.github.com') {
            // Only send GitHub authorization header to official api.github.com
            if (token) fetchHeaders['Authorization'] = `token ${token}`;
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
        }

        res.setHeader('Content-Type', contentType);

        const safeFilename = sanitizeFilename(filename);
        if (view === 'download' || (filename && view !== 'inline' && view !== '1' && view !== 'true')) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
        } else {
            res.setHeader('Content-Disposition', 'inline');
        }

        const contentLength = fileRes.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);

        // Stream binary directly to client with CORS headers
        const nodeStream = Readable.fromWeb(fileRes.body);
        nodeStream.pipe(res);
    } catch (err) {
        console.error('Error in download-file streaming proxy:', err);
        return res.status(500).json({ error: err.message });
    }
};
