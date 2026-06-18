const crypto = require('crypto');

const SESSION_COOKIE = 'sop_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const PUBLIC_ROUTES = [
    { method: 'GET', path: '/login' },
    { method: 'POST', path: '/login' },
    { method: 'POST', path: '/api/external/competitor-monitor' },
    { method: 'POST', path: '/api/v1/metrics/upload' }
];

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};
    for (const part of header.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq);
        const value = trimmed.slice(eq + 1);
        cookies[key] = decodeURIComponent(value);
    }
    return cookies;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    try {
        const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
    } catch (e) {
        return false;
    }
}

function pruneSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (!session || session.expiresAt <= now) {
            sessions.delete(token);
        }
    }
}

function createSession(user) {
    pruneSessions();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        userId: user.id,
        name: user.name,
        role: user.role,
        mustChangePassword: !!user.must_change_password,
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
}

function getSession(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return session;
}

function destroySession(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) sessions.delete(token);
}

function setSessionCookie(res, token) {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    );
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isPublicRoute(req) {
    return PUBLIC_ROUTES.some(
        route => route.method === req.method && route.path === req.path
    );
}

function requireLogin(req, res, next) {
    if (isPublicRoute(req)) return next();

    const session = getSession(req);
    if (!session) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: '未登录' });
        }
        const nextUrl = encodeURIComponent(req.originalUrl || '/');
        return res.redirect(`/login?next=${nextUrl}`);
    }

    req.currentUser = {
        id: session.userId,
        name: session.name,
        role: session.role,
        mustChangePassword: !!session.mustChangePassword
    };
    res.locals.currentUser = req.currentUser;
    next();
}

function attachCurrentUser(req, res, next) {
    const session = getSession(req);
    const user = session
        ? {
            id: session.userId,
            name: session.name,
            role: session.role,
            mustChangePassword: !!session.mustChangePassword
        }
        : null;
    req.currentUser = user;
    res.locals.currentUser = user;
    next();
}

const PASSWORD_CHANGE_ALLOWED = [
    { method: 'GET', path: '/account/change-password' },
    { method: 'POST', path: '/account/change-password' },
    { method: 'POST', path: '/logout' }
];

function isPasswordChangeAllowed(req) {
    return PASSWORD_CHANGE_ALLOWED.some(
        route => route.method === req.method && route.path === req.path
    );
}

function requirePasswordChanged(req, res, next) {
    if (!req.currentUser || !req.currentUser.mustChangePassword) return next();
    if (isPasswordChangeAllowed(req)) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: '请先修改密码' });
    }
    return res.redirect('/account/change-password');
}

function updateSessionUser(req, patch) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) return;
    const session = sessions.get(token);
    if (!session) return;
    Object.assign(session, patch);
}

/**
 * 当系统中没有任何可登录账号时，创建默认管理员（首次登录后须改密）。
 */
async function ensureDefaultAdmin({ queryOne, runSql }) {
    const row = await queryOne(
        'SELECT COUNT(*) AS cnt FROM users WHERE password_hash IS NOT NULL AND password_hash != \'\''
    );
    if (row && Number(row.cnt) > 0) return null;

    const adminName = String(process.env.ADMIN_NAME || 'admin').trim() || 'admin';
    const adminPassword = String(process.env.ADMIN_PASSWORD || 'admin123');
    if (adminPassword.length < 4) {
        throw new Error('ADMIN_PASSWORD 至少 4 位');
    }

    const password_hash = hashPassword(adminPassword);
    const existing = await queryOne('SELECT id FROM users WHERE name = ?', [adminName]);

    if (existing) {
        await runSql(
            'UPDATE users SET password_hash = ?, role = \'MANAGER\', must_change_password = 1, updated_at = NOW() WHERE id = ?',
            [password_hash, existing.id]
        );
    } else {
        await runSql(
            'INSERT INTO users (name, password_hash, role, must_change_password) VALUES (?, ?, \'MANAGER\', 1)',
            [adminName, password_hash]
        );
    }

    console.log('');
    console.log('='.repeat(50));
    console.log('  首次部署：已创建默认管理员账号');
    console.log(`  账号: ${adminName}`);
    console.log(`  密码: ${adminPassword}`);
    console.log('  首次登录后须立即修改密码');
    console.log('='.repeat(50));
    console.log('');

    return { name: adminName, password: adminPassword };
}

module.exports = {
    hashPassword,
    verifyPassword,
    createSession,
    getSession,
    destroySession,
    setSessionCookie,
    clearSessionCookie,
    requireLogin,
    attachCurrentUser,
    requirePasswordChanged,
    updateSessionUser,
    ensureDefaultAdmin
};
