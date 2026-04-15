const express = require('express');
const crypto = require('crypto');
const { initializeDatabase } = require('../../utils/database.js');
const { sendWelcomeEmail } = require('../../utils/scheduler.js');

const router = express.Router();

router.post('/', async (req, res) => {
    const { email } = req.body;

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
    }

    try {
        const db = await initializeDatabase();
        const token = crypto.randomBytes(32).toString('hex');
        const existing = await db.get('SELECT email FROM subscriptions WHERE email = ?', email);
        if (existing) {
            return res.status(200).json({ success: true, message: 'Subscribed successfully!' });
        }
        await db.run(
            'INSERT INTO subscriptions (email, unsubscribe_token) VALUES (?, ?)',
            email,
            token
        );
        res.status(200).json({ success: true, message: 'Subscribed successfully!' });
        sendWelcomeEmail(email, token).catch(err =>
            console.error('[Subscribe] Welcome email error:', err.message)
        );
    } catch (error) {
        console.error('Subscription error:', error);
        res.status(500).json({ error: 'Could not process subscription.' });
    }
});

module.exports = router;
