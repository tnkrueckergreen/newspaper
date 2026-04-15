const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { initializeDatabase } = require('../utils/database');
const { isAuthenticated } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/scheduler');

const router = express.Router();
const saltRounds = 10;

router.put('/username', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { newUsername } = req.body;
    const { user_id, username: oldUsername } = req.session.user;

    if (!newUsername || newUsername.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    try {
        const existingUser = await db.get('SELECT user_id FROM users WHERE username = ? AND user_id != ?', newUsername, user_id);
        if (existingUser) {
            return res.status(409).json({ error: 'That username is already taken.' });
        }

        await Promise.all([
             db.run('UPDATE users SET username = ? WHERE user_id = ?', newUsername, user_id),
             db.run('UPDATE comments SET author_name = ? WHERE author_id = ?', newUsername, user_id)
        ]);

        const updatedUser = await db.get('SELECT user_id, username, email, custom_avatar, is_admin FROM users WHERE user_id = ?', user_id);

        req.session.user = updatedUser;

        res.status(200).json({ success: true, user: updatedUser });

    } catch (error) {
        console.error('Username change error:', error);
        res.status(500).json({ error: 'An error occurred while changing your username.' });
    }
});

router.put('/email', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { newEmail } = req.body;
    const { user_id } = req.session.user;

    if (!newEmail || !/^\S+@\S+\.\S+$/.test(newEmail)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }

    try {
        const existing = await db.get('SELECT user_id FROM users WHERE email = ? AND user_id != ?', newEmail, user_id);
        if (existing) {
            return res.status(409).json({ error: 'That email address is already in use.' });
        }

        await db.run('UPDATE users SET email = ? WHERE user_id = ?', newEmail, user_id);

        const updatedUser = await db.get('SELECT user_id, username, email, custom_avatar, is_admin FROM users WHERE user_id = ?', user_id);
        req.session.user = updatedUser;

        res.status(200).json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('Email change error:', error);
        res.status(500).json({ error: 'An error occurred while changing your email.' });
    }
});

router.put('/password', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { currentPassword, newPassword } = req.body;
    const { user_id } = req.session.user;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    try {
        const user = await db.get('SELECT password_hash FROM users WHERE user_id = ?', user_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const match = await bcrypt.compare(currentPassword, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Incorrect current password.' });
        }

        const new_password_hash = await bcrypt.hash(newPassword, saltRounds);
        await db.run('UPDATE users SET password_hash = ? WHERE user_id = ?', new_password_hash, user_id);

        res.status(200).json({ success: true, message: 'Password updated successfully.' });

    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ error: 'An error occurred while changing your password.' });
    }
});

router.post('/signup', async (req, res) => {
    const db = await initializeDatabase();
    const { username, password, email } = req.body;

    if (!username || !password || password.length < 6) {
        return res.status(400).json({ error: 'Username and a password of at least 6 characters are required.' });
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }

    try {
        const existingUsername = await db.get('SELECT user_id FROM users WHERE username = ?', username);
        if (existingUsername) {
            return res.status(409).json({ error: 'Username already taken.' });
        }
        const existingEmail = await db.get('SELECT user_id FROM users WHERE email = ?', email);
        if (existingEmail) {
            return res.status(409).json({ error: 'An account with that email already exists.' });
        }

        const password_hash = await bcrypt.hash(password, saltRounds);
        const result = await db.run(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            username, password_hash, email
        );
        const user = { user_id: result.lastID, username, email, custom_avatar: null, is_admin: 0 };
        req.session.user = user;
        res.status(201).json(user);
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'An error occurred during signup.' });
    }
});

router.post('/login', async (req, res) => {
    const db = await initializeDatabase();
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username/email and password are required.' });
    }
    try {
        const user = await db.get(
            'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
            username, username
        );
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const userSessionData = {
            user_id: user.user_id,
            username: user.username,
            email: user.email || null,
            custom_avatar: user.custom_avatar,
            is_admin: user.is_admin || 0
        };
        req.session.user = userSessionData;
        res.status(200).json(userSessionData);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    // Always return success to prevent email enumeration
    const genericSuccess = { success: true, message: 'If an account with that email exists, a reset link has been sent.' };

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(200).json(genericSuccess);
    }

    try {
        const db = await initializeDatabase();
        const user = await db.get('SELECT user_id, email FROM users WHERE email = ?', email);

        if (!user) {
            return res.status(200).json(genericSuccess);
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await db.run(
            'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
            token, user.user_id, expiresAt
        );

        const SITE_URL = process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : 'https://andoverview.com';

        const resetUrl = `${SITE_URL}/#reset-password/${token}`;
        sendPasswordResetEmail(user.email, resetUrl).catch(err =>
            console.error('[ForgotPassword] Email error:', err.message)
        );

        res.status(200).json(genericSuccess);
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'An error occurred. Please try again.' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Reset token is required.' });
    }
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    try {
        const db = await initializeDatabase();
        const record = await db.get(
            'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0',
            token
        );

        if (!record) {
            return res.status(400).json({ error: 'Invalid or already used reset link.' });
        }
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
        }

        const password_hash = await bcrypt.hash(newPassword, saltRounds);
        await db.run('UPDATE users SET password_hash = ? WHERE user_id = ?', password_hash, record.user_id);
        await db.run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', token);

        res.status(200).json({ success: true, message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'An error occurred. Please try again.' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

router.get('/status', async (req, res) => {
    if (req.session.user) {
        const db = await initializeDatabase();
        try {
            const user = await db.get(
                'SELECT user_id, username, email, custom_avatar, is_admin FROM users WHERE user_id = ?',
                req.session.user.user_id
            );
            if (user) {
                req.session.user = user;
                res.status(200).json({ loggedIn: true, user });
            } else {
                req.session.destroy();
                res.status(200).json({ loggedIn: false });
            }
        } catch (error) {
            console.error('Error fetching user status:', error);
            res.status(500).json({ loggedIn: false, error: 'Failed to fetch user status' });
        }
    } else {
        res.status(200).json({ loggedIn: false });
    }
});


module.exports = router;
