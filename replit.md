# Project Notes

## Architecture
- Node/Express backend with SQLite for dynamic data and file-backed article content stored in the `article_files` table.
- Public article routes live under `backend/routes/api/`, and admin article management lives in `backend/routes/admin.js`.
- Frontend pages are plain JavaScript modules under `js/pages/`.

## Recent Changes
- Added per-article comment disabling for admins.
- The `articles` table now stores `comments_disabled` as article metadata.
- Admin article create/edit form includes a “Disable comments” toggle in the Publishing card.
- Public and admin article APIs return `comments_disabled`.
- Comment posting is blocked server-side for articles where comments are disabled, while existing comments can still display.
- Added admin staff ordering controls. Staff records use `sort_order`; admins can move members up/down in Account → Admin → Staff, and the About page follows that order.
