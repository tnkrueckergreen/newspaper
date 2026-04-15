const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { initializeDatabase } = require('./database');
const { updateArticleStatus, reloadContent } = require('./content-parser');

const SITE_URL = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : 'https://andoverview.com';

function createTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

function extractFrontmatterField(content, field) {
    const regex = new RegExp(`^${field}:\\s*(.+)$`, 'mi');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
}

function buildEmailHtml(articles, unsubscribeToken) {
    const articleBlocks = articles.map(({ articleId, title, description, category }) => {
        const articleUrl = `${SITE_URL}/#single-article-page/${articleId}`;
        const cat = category ? `<p style="margin: 0 0 8px; font-family: -apple-system, sans-serif; font-size: 12px; font-weight: 700; color: #002D62; text-transform: uppercase; letter-spacing: 0.05em;">${category}</p>` : '';
        const desc = description ? `<p style="margin: 12px 0 0; font-family: -apple-system, sans-serif; font-size: 15px; color: #555555; line-height: 1.6;">${description}</p>` : '';
        return `
        <div style="background-color: #ffffff; border: 1px solid #EAEAEA; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
            ${cat}
            <h2 style="margin: 0; font-family: Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3;">
                <a href="${articleUrl}" style="color: #1A1A1A; text-decoration: none;">${title}</a>
            </h2>
            ${desc}
            <div style="margin-top: 20px;">
                <a href="${articleUrl}" style="display: inline-block; background-color: #002D62; color: #ffffff; font-family: -apple-system, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none; padding: 10px 20px; border-radius: 9999px;">Read Article &rarr;</a>
            </div>
        </div>`;
    }).join('');

    const plural = articles.length > 1 ? 'articles are' : 'article is';
    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`;
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FDFDFC; -webkit-font-smoothing: antialiased;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 2px solid #002D62; margin-bottom: 32px;">
            <h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px; font-weight: 400; color: #002D62; letter-spacing: 2px;">ANDOVERVIEW</h1>
            <p style="margin: 8px 0 0; font-size: 14px; color: #6B7280;">Andover High School's Student Newspaper</p>
        </div>

        <!-- Intro -->
        <p style="font-size: 16px; color: #1A1A1A; margin-bottom: 24px;">The following ${plural} now live:</p>

        <!-- Articles -->
        ${articleBlocks}

        <!-- Footer -->
        <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #EAEAEA; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">
                You received this email because you subscribed to ANDOVERVIEW updates.<br>
                <a href="${unsubscribeUrl}" style="color: #002D62; text-decoration: none;">Unsubscribe</a>
            </p>
        </div>

    </div>
</body>
</html>`;
}

async function sendWelcomeEmail(email, unsubscribeToken) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('[Mailer] Email credentials not set — skipping welcome email.');
        return;
    }

    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FDFDFC; -webkit-font-smoothing: antialiased;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 2px solid #002D62; margin-bottom: 32px;">
            <h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px; font-weight: 400; color: #002D62; letter-spacing: 2px;">ANDOVERVIEW</h1>
            <p style="margin: 8px 0 0; font-size: 14px; color: #6B7280;">Andover High School's Student Newspaper</p>
        </div>

        <!-- Body -->
        <h2 style="font-family: Georgia, serif; font-size: 22px; font-weight: 600; color: #1A1A1A; margin: 0 0 16px;">Welcome to ANDOVERVIEW.</h2>
        <p style="font-size: 16px; color: #1A1A1A; line-height: 1.7; margin: 0 0 16px;">
            Thanks for subscribing! You'll now receive email updates whenever new stories are published by our student journalists.
        </p>
        <p style="font-size: 16px; color: #1A1A1A; line-height: 1.7; margin: 0 0 32px;">
            In the meantime, head over to the site to catch up on the latest coverage.
        </p>
        <div style="text-align: center; margin-bottom: 40px;">
            <a href="${SITE_URL}" style="display: inline-block; background-color: #002D62; color: #ffffff; font-family: -apple-system, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none; padding: 12px 28px; border-radius: 9999px;">Visit ANDOVERVIEW &rarr;</a>
        </div>

        <!-- Footer -->
        <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #EAEAEA; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">
                You received this email because you subscribed to ANDOVERVIEW updates.<br>
                <a href="${unsubscribeUrl}" style="color: #002D62; text-decoration: none;">Unsubscribe</a>
            </p>
        </div>

    </div>
</body>
</html>`;

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"ANDOVERVIEW" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Welcome to ANDOVERVIEW',
            html,
        });
        console.log(`[Mailer] Welcome email sent to ${email}.`);
    } catch (err) {
        console.error(`[Mailer] Failed to send welcome email to ${email}:`, err.message);
    }
}

async function sendSubscriberEmails(publishedArticles) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('[Scheduler] Email credentials not set — skipping subscriber notification.');
        return;
    }

    const db = await initializeDatabase();
    const subscribers = await db.all('SELECT email, unsubscribe_token FROM subscriptions');
    if (subscribers.length === 0) {
        console.log('[Scheduler] No subscribers to notify.');
        return;
    }

    const transporter = createTransporter();
    const subject = publishedArticles.length === 1
        ? `New Article: ${publishedArticles[0].title}`
        : `${publishedArticles.length} New Articles on ANDOVERVIEW`;

    let sent = 0;
    for (const subscriber of subscribers) {
        const html = buildEmailHtml(publishedArticles, subscriber.unsubscribe_token);
        try {
            await transporter.sendMail({
                from: `"ANDOVERVIEW" <${process.env.GMAIL_USER}>`,
                to: subscriber.email,
                subject,
                html,
            });
            sent++;
        } catch (err) {
            console.error(`[Scheduler] Failed to send email to ${subscriber.email}:`, err.message);
        }
    }
    console.log(`[Scheduler] Notified ${sent}/${subscribers.length} subscriber(s) about ${publishedArticles.length} new article(s).`);
}

async function publishDueArticles() {
    const db = await initializeDatabase();
    const now = new Date();

    const rows = await db.all(
        `SELECT article_id, content FROM article_files 
         WHERE content LIKE '%Status: Scheduled%'`
    );

    const toPublish = [];

    for (const row of rows) {
        const match = row.content.match(/^ScheduledAt:\s*(.+)$/m);
        if (!match) continue;

        const scheduledAt = new Date(match[1].trim());
        if (isNaN(scheduledAt.getTime())) continue;

        if (scheduledAt <= now) {
            toPublish.push({
                articleId: row.article_id,
                title: extractFrontmatterField(row.content, 'Title') || row.article_id,
                description: extractFrontmatterField(row.content, 'Description'),
                category: extractFrontmatterField(row.content, 'Category'),
            });
        }
    }

    if (toPublish.length === 0) return;

    for (const article of toPublish) {
        await updateArticleStatus(article.articleId, 'Published', { skipReload: true });
        console.log(`[Scheduler] Published article: ${article.articleId}`);
    }

    await reloadContent();
    console.log(`[Scheduler] Published ${toPublish.length} scheduled article(s).`);

    await sendSubscriberEmails(toPublish);
}

function initScheduler() {
    cron.schedule('* * * * *', async () => {
        try {
            await publishDueArticles();
        } catch (err) {
            console.error('[Scheduler] Error during scheduled publish check:', err);
        }
    });

    console.log('[Scheduler] Scheduled publishing initialized (runs every minute).');
}

async function sendPasswordResetEmail(email, resetUrl) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('[Mailer] Email credentials not set — skipping password reset email.');
        return;
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FDFDFC; -webkit-font-smoothing: antialiased;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

        <!-- Header -->
        <div style="text-align: center; padding: 32px 0; border-bottom: 2px solid #002D62; margin-bottom: 32px;">
            <h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px; font-weight: 400; color: #002D62; letter-spacing: 2px;">ANDOVERVIEW</h1>
            <p style="margin: 8px 0 0; font-size: 14px; color: #6B7280;">Andover High School's Student Newspaper</p>
        </div>

        <!-- Body -->
        <h2 style="font-family: Georgia, serif; font-size: 22px; font-weight: 600; color: #1A1A1A; margin: 0 0 16px;">Reset your password</h2>
        <p style="font-size: 16px; color: #1A1A1A; line-height: 1.7; margin: 0 0 16px;">
            We received a request to reset the password for your ANDOVERVIEW account. Click the button below to choose a new password.
        </p>
        <p style="font-size: 14px; color: #6B7280; line-height: 1.6; margin: 0 0 32px;">
            This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
        </p>
        <div style="text-align: center; margin-bottom: 40px;">
            <a href="${resetUrl}" style="display: inline-block; background-color: #002D62; color: #ffffff; font-family: -apple-system, sans-serif; font-size: 14px; font-weight: 500; text-decoration: none; padding: 12px 28px; border-radius: 9999px;">Reset Password &rarr;</a>
        </div>
        <p style="font-size: 13px; color: #9CA3AF; line-height: 1.6; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetUrl}" style="color: #002D62; word-break: break-all;">${resetUrl}</a>
        </p>

        <!-- Footer -->
        <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #EAEAEA; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #6B7280; line-height: 1.5;">
                ANDOVERVIEW &mdash; Andover High School's Student Newspaper
            </p>
        </div>

    </div>
</body>
</html>`;

    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"ANDOVERVIEW" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Reset your ANDOVERVIEW password',
            html,
        });
        console.log(`[Mailer] Password reset email sent to ${email}.`);
    } catch (err) {
        console.error(`[Mailer] Failed to send password reset email to ${email}:`, err.message);
    }
}

module.exports = { initScheduler, sendSubscriberEmails, sendWelcomeEmail, sendPasswordResetEmail };