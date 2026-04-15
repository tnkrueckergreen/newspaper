#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { initializeDatabase } = require('../backend/utils/database');

const SITE_URL = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : 'https://andoverview.com';

const TEST_EMAIL = process.argv[2];
if (!TEST_EMAIL) {
    console.error('Usage: node scripts/send-test-email.js <email>');
    process.exit(1);
}

async function run() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.error('GMAIL_USER or GMAIL_APP_PASSWORD not set.');
        process.exit(1);
    }

    const db = await initializeDatabase();

    // Ensure the email is in the subscriptions table with a real token
    let subscriber = await db.get(
        'SELECT email, unsubscribe_token FROM subscriptions WHERE email = ?',
        TEST_EMAIL
    );

    if (!subscriber) {
        const token = crypto.randomBytes(32).toString('hex');
        await db.run(
            'INSERT INTO subscriptions (email, unsubscribe_token) VALUES (?, ?)',
            TEST_EMAIL,
            token
        );
        subscriber = { email: TEST_EMAIL, unsubscribe_token: token };
        console.log(`Added ${TEST_EMAIL} to subscriptions.`);
    } else {
        console.log(`${TEST_EMAIL} is already subscribed.`);
    }

    const rows = await db.all(`
        SELECT article_id, content FROM article_files
        WHERE content LIKE '%Status: Published%'
        ORDER BY updated_at DESC
        LIMIT 1
    `);

    if (rows.length === 0) {
        console.error('No published articles found.');
        process.exit(1);
    }

    const row = rows[0];

    function field(content, name) {
        const m = content.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
        return m ? m[1].trim() : '';
    }

    const article = {
        articleId: row.article_id,
        title: field(row.content, 'Title') || row.article_id,
        description: field(row.content, 'Description'),
        category: field(row.content, 'Category'),
    };

    console.log(`Latest published article: "${article.title}" (${article.articleId})`);

    const articleUrl = `${SITE_URL}/#single-article-page/${article.articleId}`;
    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${subscriber.unsubscribe_token}`;

    const cat = article.category
        ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#002D62;text-transform:uppercase;letter-spacing:0.05em;">${article.category}</p>`
        : '';
    const desc = article.description
        ? `<p style="margin:12px 0 0;font-size:15px;color:#555;line-height:1.6;">${article.description}</p>`
        : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FDFDFC;">
<div style="max-width:600px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="text-align:center;padding:32px 0;border-bottom:2px solid #002D62;margin-bottom:32px;">
    <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:400;color:#002D62;letter-spacing:2px;">ANDOVERVIEW</h1>
    <p style="margin:8px 0 0;font-size:14px;color:#6B7280;">Andover High School's Student Newspaper</p>
  </div>
  <p style="font-size:16px;color:#1A1A1A;margin-bottom:24px;">The following article is now live:</p>
  <div style="background:#fff;border:1px solid #EAEAEA;border-radius:8px;padding:24px;margin-bottom:24px;">
    ${cat}
    <h2 style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:600;line-height:1.3;">
      <a href="${articleUrl}" style="color:#1A1A1A;text-decoration:none;">${article.title}</a>
    </h2>
    ${desc}
    <div style="margin-top:20px;">
      <a href="${articleUrl}" style="display:inline-block;background:#002D62;color:#fff;font-size:14px;font-weight:500;text-decoration:none;padding:10px 20px;border-radius:9999px;">Read Article &rarr;</a>
    </div>
  </div>
  <div style="margin-top:48px;padding-top:24px;border-top:1px solid #EAEAEA;text-align:center;">
    <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.5;">
      You received this email because you subscribed to ANDOVERVIEW updates.<br>
      <a href="${unsubscribeUrl}" style="color:#002D62;text-decoration:none;">Unsubscribe</a>
    </p>
  </div>
</div>
</body>
</html>`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    console.log(`Sending to ${TEST_EMAIL}...`);
    await transporter.sendMail({
        from: `"ANDOVERVIEW" <${process.env.GMAIL_USER}>`,
        to: TEST_EMAIL,
        subject: `New Article: ${article.title}`,
        html,
    });

    console.log('Email sent successfully!');
    process.exit(0);
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
