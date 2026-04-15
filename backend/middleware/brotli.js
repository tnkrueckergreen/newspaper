const zlib = require('zlib');

const BROTLI_QUALITY = 4;
const THRESHOLD = 1024;

function brotliJsonMiddleware(req, res, next) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (!acceptEncoding.includes('br')) return next();

    const _json = res.json.bind(res);

    res.json = function brotliJson(body) {
        const jsonStr = JSON.stringify(body);
        const buf = Buffer.from(jsonStr, 'utf8');

        if (buf.length < THRESHOLD) {
            return _json(body);
        }

        zlib.brotliCompress(buf, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY }
        }, (err, compressed) => {
            if (err) return _json(body);
            
            if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Content-Encoding', 'br');
                res.setHeader('Content-Length', compressed.length);
                res.setHeader('Vary', 'Accept-Encoding');
                res.end(compressed);
            }
            // else: headers already sent by another handler before compression
            // finished — do not attempt a second write, which would throw.
        });
    };

    next();
}

module.exports = brotliJsonMiddleware;
