// Vercel Serverless Function — Material Download Redirect & Fallback Engine
// HuggingFace Datasets support direct CORS-friendly browser fetch.
// This function returns an instant 302 redirect to the target HuggingFace resolution URL.

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query || {};

    if (url) {
        return res.redirect(302, url);
    }

    return res.status(400).json({ error: 'Missing file URL' });
};
