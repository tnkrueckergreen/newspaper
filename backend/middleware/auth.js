const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'You must be logged in to perform this action.' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.is_admin) {
        next();
    } else {
        res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
};

module.exports = { isAuthenticated, isAdmin };
