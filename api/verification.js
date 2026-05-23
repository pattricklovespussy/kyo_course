const axios = require('axios');
const { normalizeHttpUrl } = require('./_utils');

const SUPABASE_URL = normalizeHttpUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_UID_VERIFY_TABLE = process.env.SUPABASE_UID_VERIFY_TABLE || 'discord_uid_verifications';

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function readCookie(headerValue, name) {
  if (!headerValue) return null;
  const pairs = headerValue.split(';').map(part => part.trim());
  const found = pairs.find(part => part.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

function getSessionUser(req) {
  try {
    if (req.session && req.session.user) {
      return req.session.user;
    }

    const cookieHeader = req.headers.cookie || '';
    const raw = readCookie(cookieHeader, 'kyo_session');
    if (!raw) return null;
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return decoded && decoded.user ? decoded.user : null;
  } catch (_) {
    return null;
  }
}

async function supabaseRest(method, table, { query = '', data = null } = {}) {
  if (!SUPABASE_ENABLED) throw new Error('Supabase not configured');
  const response = await axios.request({
    method,
    url: `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`,
    data,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    validateStatus: () => true
  });
  return response;
}

async function isAdminRequest(req) {
  if (!SUPABASE_ENABLED) return false;

  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return false;
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) return false;

  try {
    const response = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`
      },
      validateStatus: () => true
    });
    return response.status === 200;
  } catch (_) {
    return false;
  }
}

function normalizeRequestRow(row) {
  if (!row) return null;
  return {
    userId: String(row.user_id || ''),
    userName: String(row.discord_username || ''),
    uid: String(row.discord_uid || ''),
    status: String(row.status || 'unverified'),
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewNote: row.review_note || null,
    updatedAt: row.updated_at || null
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!SUPABASE_ENABLED) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  try {
    if (req.method === 'GET') {
      const adminMode = String(req.query?.admin || '').trim() === '1';

      if (adminMode) {
        const isAdmin = await isAdminRequest(req);
        if (!isAdmin) return res.status(403).json({ error: 'Admin authorization required' });

        const statusFilter = String(req.query?.status || '').trim().toLowerCase();
        const queryParts = [
          'select=user_id,discord_username,discord_uid,status,submitted_at,reviewed_at,reviewed_by,review_note,updated_at',
          'order=submitted_at.desc'
        ];
        if (statusFilter) {
          queryParts.push(`status=eq.${encodeURIComponent(statusFilter)}`);
        }
        const response = await supabaseRest('GET', SUPABASE_UID_VERIFY_TABLE, { query: queryParts.join('&') });
        if (response.status !== 200) {
          return res.status(500).json({ error: `HTTP ${response.status}`, detail: response.data || null });
        }

        const requests = Array.isArray(response.data)
          ? response.data.map(normalizeRequestRow).filter(Boolean)
          : [];
        return res.status(200).json({ requests });
      }

      const user = getSessionUser(req);
      if (!user || !user.id) {
        return res.status(401).json({ loggedIn: false });
      }

      const userId = encodeURIComponent(String(user.id).trim());
      const response = await supabaseRest('GET', SUPABASE_UID_VERIFY_TABLE, {
        query: `user_id=eq.${userId}&select=user_id,discord_username,discord_uid,status,submitted_at,reviewed_at,reviewed_by,review_note,updated_at&limit=1`
      });

      if (response.status !== 200) {
        return res.status(500).json({ error: `HTTP ${response.status}`, detail: response.data || null });
      }

      const row = Array.isArray(response.data) ? response.data[0] : null;
      if (!row) {
        return res.status(200).json({
          loggedIn: true,
          verification: {
            userId: String(user.id),
            userName: String(user.username || user.global_name || ''),
            uid: '',
            status: 'unverified',
            submittedAt: null,
            reviewedAt: null,
            reviewedBy: null,
            reviewNote: null,
            updatedAt: null
          }
        });
      }

      return res.status(200).json({ loggedIn: true, verification: normalizeRequestRow(row) });
    }

    if (req.method === 'POST') {
      const user = getSessionUser(req);
      if (!user || !user.id) {
        return res.status(401).json({ error: 'Login required' });
      }

      const body = req.body || req;
      const uid = String(body.uid || '').trim();
      if (!/^\d{5,30}$/.test(uid)) {
        return res.status(400).json({ error: 'UID must be 5-30 digits' });
      }

      const row = {
        user_id: String(user.id).trim(),
        discord_username: String(user.username || user.global_name || '').trim(),
        discord_uid: uid,
        status: 'pending',
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
        updated_at: new Date().toISOString()
      };

      const response = await supabaseRest('POST', SUPABASE_UID_VERIFY_TABLE, {
        query: 'on_conflict=user_id',
        data: row
      });

      if (response.status < 200 || response.status >= 300) {
        return res.status(500).json({ error: `HTTP ${response.status}`, detail: response.data || null });
      }

      const saved = Array.isArray(response.data) ? response.data[0] : response.data;
      return res.status(200).json({ verification: normalizeRequestRow(saved || row) });
    }

    if (req.method === 'PATCH') {
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) return res.status(403).json({ error: 'Admin authorization required' });

      const body = req.body || req;
      const userId = String(body.userId || body.user_id || '').trim();
      const status = String(body.status || '').trim().toLowerCase();
      const reviewNote = String(body.reviewNote || body.review_note || '').trim();

      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ error: 'status must be approved or rejected' });
      }

      const updatePayload = {
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'admin',
        review_note: reviewNote || null,
        updated_at: new Date().toISOString()
      };

      const response = await supabaseRest('PATCH', SUPABASE_UID_VERIFY_TABLE, {
        query: `user_id=eq.${encodeURIComponent(userId)}`,
        data: updatePayload
      });

      if (response.status < 200 || response.status >= 300) {
        return res.status(500).json({ error: `HTTP ${response.status}`, detail: response.data || null });
      }

      const updated = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!updated) {
        return res.status(404).json({ error: 'Verification request not found' });
      }

      return res.status(200).json({ verification: normalizeRequestRow(updated) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/verification error', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};