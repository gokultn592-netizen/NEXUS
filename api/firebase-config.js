// Vercel Serverless Function — Serve Firebase Configuration
// This avoids hardcoding the Firebase API key in frontend files that get committed to GitHub,
// preventing Google's secret-scanning bots from auto-revoking the key.

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    return res.status(200).json({
        apiKey: process.env.FIREBASE_API_KEY || "",
        authDomain: "nexus-e7a36.firebaseapp.com",
        projectId: "nexus-e7a36",
        storageBucket: "nexus-e7a36.firebasestorage.app",
        messagingSenderId: "516259533933",
        appId: "1:516259533933:web:fc190f6c0f203e47785b64"
    });
};
