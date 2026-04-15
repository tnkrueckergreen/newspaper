const express = require('express');
const { initializeDatabase } = require('../../utils/database.js');

const router = express.Router();

router.post('/', async (req, res) => {
    const { name, email, website, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
    }

    try {
        const db = await initializeDatabase();
        await db.run(
            'INSERT INTO contacts (name, email, website, message) VALUES (?, ?, ?, ?)',
            name, email, website || null, message
        );
        res.status(201).json({ success: true, message: 'Message received!' });
    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ error: 'Could not save message.' });
    }
});

module.exports = router;
