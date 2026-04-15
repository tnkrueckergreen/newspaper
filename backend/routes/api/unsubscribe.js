const express = require('express');
const { initializeDatabase } = require('../../utils/database.js');

const router = express.Router();

const renderPage = (message, detail, customAction, extraHead = '') => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ANDOVERVIEW – Subscription</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #FDFDFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: #fff; border: 1px solid #EAEAEA; border-radius: 12px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; }
        .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 400; color: #002D62; letter-spacing: 2px; margin-bottom: 32px; }
        h1 { font-family: Georgia, serif; font-size: 24px; color: #1A1A1A; margin-bottom: 12px; }
        p { font-size: 15px; color: #6B7280; line-height: 1.6; margin-bottom: 28px; }
        a.btn-return { display: inline-block; background-color: #002D62; color: #fff; font-size: 14px; font-weight: 500; text-decoration: none; padding: 10px 24px; border-radius: 9999px; transition: background-color 0.2s; }
        a.btn-return:hover { background-color: #003d8a; }
        .btn-danger { display: inline-block; background-color: #dc2626; color: #fff; font-size: 14px; font-weight: 500; border: none; padding: 10px 24px; border-radius: 9999px; cursor: pointer; text-decoration: none; transition: background-color 0.2s; }
        .btn-danger:hover { background-color: #b91c1c; }
        .btn-secondary { display: inline-block; background-color: #f3f4f6; color: #374151; font-size: 14px; font-weight: 500; border: 1px solid #d1d5db; padding: 9px 24px; border-radius: 9999px; cursor: pointer; text-decoration: none; transition: background-color 0.2s; }
        .btn-secondary:hover { background-color: #e5e7eb; }
        .action-group { display: flex; justify-content: center; gap: 12px; margin-top: 20px; }
    </style>
    ${extraHead}
</head>
<body>
    <div class="card">
        <div class="logo">ANDOVERVIEW</div>
        <h1>${message}</h1>
        <p>${detail}</p>
        ${customAction || '<a href="/" class="btn-return">Return to ANDOVERVIEW</a>'}
    </div>
</body>
</html>`;

router.get('/', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).send(renderPage(
            'Invalid link',
            'This unsubscribe link is missing required information. Please use the link from your email.'
        ));
    }

    try {
        const db = await initializeDatabase();
        const subscriber = await db.get(
            'SELECT email FROM subscriptions WHERE unsubscribe_token = ?',
            token
        );

        if (!subscriber) {
            return res.status(404).send(renderPage(
                'Already unsubscribed',
                'This email address is not on our mailing list, or has already been removed.'
            ));
        }

        const actionHtml = `
            <div id="action-container" class="action-group">
                <button id="confirm-btn" class="btn-danger" onclick="confirmUnsubscribe('${token}')">Yes, unsubscribe</button>
                <a href="/" class="btn-secondary">Cancel</a>
            </div>
            <div id="loading" style="display: none; margin-top: 20px; font-size: 14px; color: #6B7280; font-weight: 500;">Processing...</div>
        `;

        const extraHead = `
            <script>
                function getCsrfToken() {
                    const match = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/);
                    return match ? decodeURIComponent(match[1]) : '';
                }

                async function confirmUnsubscribe(token) {
                    document.getElementById('action-container').style.display = 'none';
                    document.getElementById('loading').style.display = 'block';

                    try {
                        const res = await fetch('/api/unsubscribe', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-csrf-token': getCsrfToken()
                            },
                            body: JSON.stringify({ token: token })
                        });

                        const html = await res.text();
                        document.open();
                        document.write(html);
                        document.close();
                    } catch (err) {
                        alert('Network error. Please try again.');
                        document.getElementById('action-container').style.display = 'flex';
                        document.getElementById('loading').style.display = 'none';
                    }
                }
            </script>
        `;

        return res.send(renderPage(
            'Confirm Unsubscribe',
            `Are you sure you want to unsubscribe <strong>${subscriber.email}</strong> from the ANDOVERVIEW mailing list?`,
            actionHtml,
            extraHead
        ));
    } catch (error) {
        console.error('Unsubscribe check error:', error);
        return res.status(500).send(renderPage(
            'Something went wrong',
            'We couldn\'t process your request. Please try again later.'
        ));
    }
});

router.post('/', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).send(renderPage(
            'Invalid request',
            'Missing subscription token.'
        ));
    }

    try {
        const db = await initializeDatabase();
        const subscriber = await db.get(
            'SELECT email FROM subscriptions WHERE unsubscribe_token = ?',
            token
        );

        if (!subscriber) {
            return res.status(404).send(renderPage(
                'Already unsubscribed',
                'This email address is not on our mailing list, or has already been removed.'
            ));
        }

        await db.run('DELETE FROM subscriptions WHERE unsubscribe_token = ?', token);

        return res.send(renderPage(
            'You\'ve been unsubscribed',
            `<strong>${subscriber.email}</strong> has been removed from the ANDOVERVIEW mailing list. You won't receive any further emails from us.`
        ));
    } catch (error) {
        console.error('Unsubscribe error:', error);
        return res.status(500).send(renderPage(
            'Something went wrong',
            'We couldn\'t process your request. Please try again later.'
        ));
    }
});

module.exports = router;