/**
 * APEX — auth.js
 * Handles signup, login, validation, password strength,
 * animated canvas background, and localStorage auth.
 */
'use strict';

/* ════════════════════
   GEOMETRIC CANVAS ANIMATION
════════════════════ */
(function initCanvas() {
  const canvas = document.getElementById('geo-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, nodes = [], animId;

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function createNode() {
    return {
      x: rand(0, W), y: rand(0, H),
      vx: rand(-.3, .3), vy: rand(-.3, .3),
      r: rand(1, 3),
      opacity: rand(.3, .8),
    };
  }

  function initNodes() {
    nodes = [];
    const count = Math.floor((W * H) / 12000);
    for (let i = 0; i < count; i++) nodes.push(createNode());
  }

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);

    // Update positions
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });

    // Draw connecting lines
    const CONNECT_DIST = 120;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < CONNECT_DIST) {
          const alpha = (1 - dist / CONNECT_DIST) * .4;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(194, 113, 90, ${alpha})`;
          ctx.lineWidth = .6;
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(194, 113, 90, ${n.opacity})`;
      ctx.fill();
    });

    // Draw occasional triangles
    if (nodes.length >= 3) {
      for (let i = 0; i < nodes.length - 2; i += 8) {
        const a = nodes[i], b = nodes[i+1], c = nodes[i+2];
        const d1 = Math.hypot(a.x-b.x,a.y-b.y);
        const d2 = Math.hypot(b.x-c.x,b.y-c.y);
        if (d1 < 100 && d2 < 100) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(194,113,90,.04)';
          ctx.fill();
        }
      }
    }

    animId = requestAnimationFrame(drawFrame);
  }

  window.addEventListener('resize', () => { cancelAnimationFrame(animId); resize(); initNodes(); drawFrame(); });
  resize(); initNodes(); drawFrame();
})();

/* ════════════════════
   AUTH STORAGE — Supabase
   getUsers / saveUsers removed: Supabase Auth manages the user list.
   Session methods now wrap window._supabase.auth (initialized in index.html).
════════════════════ */
const AuthDB = {
  // Supabase stores its JWT session automatically — nothing extra to do here.
  setSession: () => {},

  // Returns { email, name, id } from the live Supabase session, or null.
  getSession: async () => {
    const { data: { session } } = await window._supabase.auth.getSession();
    if (!session) return null;
    return {
      email: session.user.email,
      name:  session.user.user_metadata?.full_name || session.user.email,
      id:    session.user.id,
    };
  },

  // Signs the user out via Supabase.
  clearSession: async () => {
    await window._supabase.auth.signOut();
  },
};

/* ════════════════════
   TAB SWITCHING
════════════════════ */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById('form-' + target).classList.add('active');
    clearAllErrors();
  });
});

// "Switch to" links inside forms
document.querySelectorAll('[data-switch]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.switch;
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === target);
    });
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById('form-' + target).classList.add('active');
    clearAllErrors();
  });
});

/* ════════════════════
   PASSWORD STRENGTH
════════════════════ */
const RULES = {
  length:  { test: pw => pw.length >= 8,              id: 'rule-length'  },
  upper:   { test: pw => /[A-Z]/.test(pw),            id: 'rule-upper'   },
  number:  { test: pw => /[0-9]/.test(pw),            id: 'rule-number'  },
  special: { test: pw => /[^a-zA-Z0-9]/.test(pw),    id: 'rule-special' },
};

function evaluatePassword(pw) {
  const results = {};
  let score = 0;
  Object.keys(RULES).forEach(k => {
    results[k] = RULES[k].test(pw);
    if (results[k]) score++;
  });

  // Update rule UI
  Object.keys(RULES).forEach(k => {
    const li = document.getElementById(RULES[k].id);
    if (!li) return;
    li.classList.toggle('met', results[k]);
  });

  // Strength bar
  const fill  = document.getElementById('pw-strength-fill');
  const label = document.getElementById('pw-strength-label');
  if (!fill || !label) return score;

  const levels = [
    { pct: 0,   color: 'transparent',     text: '' },
    { pct: 25,  color: '#e05050',         text: 'WEAK' },
    { pct: 50,  color: '#d4884a',         text: 'FAIR' },
    { pct: 75,  color: '#d4b84a',         text: 'GOOD' },
    { pct: 100, color: '#6b9e7e',         text: 'STRONG' },
  ];
  const level = pw.length === 0 ? levels[0] : levels[Math.min(score, 4)];
  fill.style.width      = level.pct + '%';
  fill.style.background = level.color;
  label.textContent     = level.text;
  label.style.color     = level.color;

  return score;
}

document.getElementById('su-password').addEventListener('input', e => {
  evaluatePassword(e.target.value);
  clearError('su-pw-err');
  // Re-validate confirm if it has a value
  const confirm = document.getElementById('su-confirm').value;
  if (confirm) validateConfirm();
});

/* ════════════════════
   SHOW/HIDE PASSWORD
════════════════════ */
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.textContent = isText ? '👁' : '🙈';
  });
});

/* ════════════════════
   VALIDATION HELPERS
════════════════════ */
function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}
function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.getElementById('login-error-banner')?.classList.add('hidden');
}
function markField(inputId, valid) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.classList.toggle('valid',   valid);
  el.classList.toggle('invalid', !valid);
}

function validateEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}
function validateConfirm() {
  const pw  = document.getElementById('su-password').value;
  const con = document.getElementById('su-confirm').value;
  if (con && pw !== con) {
    setError('su-confirm-err', 'Passwords do not match.');
    markField('su-confirm', false);
    return false;
  } else if (con) {
    clearError('su-confirm-err');
    markField('su-confirm', true);
    return true;
  }
  return false;
}

// Live validation on fields
document.getElementById('su-email').addEventListener('blur', () => {
  const v = document.getElementById('su-email').value.trim();
  if (v && !validateEmail(v)) {
    setError('su-email-err', 'Please enter a valid email address.');
    markField('su-email', false);
  } else if (v) {
    clearError('su-email-err');
    markField('su-email', true);
  }
});
document.getElementById('su-confirm').addEventListener('input', validateConfirm);
document.getElementById('su-name').addEventListener('blur', () => {
  const v = document.getElementById('su-name').value.trim();
  if (v.length < 2) {
    setError('su-name-err', 'Please enter your name.');
  } else {
    clearError('su-name-err'); markField('su-name', true);
  }
});

/* ════════════════════
   SIGN UP
════════════════════ */
document.getElementById('signup-btn').addEventListener('click', handleSignup);
document.getElementById('su-confirm').addEventListener('keydown', e => { if(e.key==='Enter') handleSignup(); });

async function handleSignup() {
  let valid = true;
  clearAllErrors();

  const name    = document.getElementById('su-name').value.trim();
  const email   = document.getElementById('su-email').value.trim();
  const pw      = document.getElementById('su-password').value;
  const confirm = document.getElementById('su-confirm').value;
  const terms   = document.getElementById('su-terms').checked;

  if (name.length < 2) {
    setError('su-name-err', 'Please enter your name.'); markField('su-name', false); valid = false;
  }
  if (!validateEmail(email)) {
    setError('su-email-err', 'Please enter a valid email address.'); markField('su-email', false); valid = false;
  }

  const pwScore = evaluatePassword(pw);
  if (pw.length < 8) {
    setError('su-pw-err', 'Password must be at least 8 characters.'); markField('su-password', false); valid = false;
  } else if (pwScore < 2) {
    setError('su-pw-err', 'Password is too weak. Add numbers or symbols.'); markField('su-password', false); valid = false;
  } else {
    markField('su-password', true);
  }

  if (pw !== confirm) {
    setError('su-confirm-err', 'Passwords do not match.'); markField('su-confirm', false); valid = false;
  } else if (confirm) {
    markField('su-confirm', true);
  }

  if (!terms) {
    setError('su-terms-err', 'You must agree to the Terms of Service.'); valid = false;
  }

  if (!valid) return;

  const btn = document.getElementById('signup-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const { error } = await window._supabase.auth.signUp({
      email:   email.toLowerCase(),
      password: pw,
      options: { data: { full_name: name } },  // stored in user_metadata
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        setError('su-email-err', 'An account with this email already exists.');
        markField('su-email', false);
      } else {
        setError('su-email-err', error.message);
      }
      btn.classList.remove('loading'); btn.disabled = false;
      return;
    }

    btn.classList.remove('loading'); btn.disabled = false;

    // Show success screen
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById('form-success').classList.add('active');
    document.getElementById('auth-tabs').style.display = 'none';

  } catch (err) {
    setError('su-email-err', 'Sign-up failed. Please try again.');
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

/* ════════════════════
   LOGIN
════════════════════ */
document.getElementById('login-btn').addEventListener('click', handleLogin);
document.getElementById('li-password').addEventListener('keydown', e => { if(e.key==='Enter') handleLogin(); });

async function handleLogin() {
  clearAllErrors();
  const banner = document.getElementById('login-error-banner');
  banner.classList.add('hidden');

  const email  = document.getElementById('li-email').value.trim();
  const pw     = document.getElementById('li-password').value;
  const remember = document.getElementById('li-remember').checked;
  let valid = true;

  if (!validateEmail(email)) {
    setError('li-email-err', 'Please enter a valid email.'); markField('li-email', false); valid = false;
  }
  if (!pw) {
    setError('li-pw-err', 'Please enter your password.'); markField('li-password', false); valid = false;
  }
  if (!valid) return;

  const btn = document.getElementById('login-btn');
  btn.classList.add('loading'); btn.disabled = true;

  try {
    const { data, error } = await window._supabase.auth.signInWithPassword({
      email:    email.toLowerCase(),
      password: pw,
    });

    btn.classList.remove('loading'); btn.disabled = false;

    if (error) {
      document.getElementById('login-error-msg').textContent = 'Incorrect email or password.';
      banner.classList.remove('hidden');
      markField('li-password', false);
      const card = document.getElementById('auth-card');
      card.style.animation = 'none'; card.offsetHeight;
      card.style.animation = 'shake .4s ease';
      return;
    }

    // Hand the verified session to the orchestration layer
    revealDashboard({
      email: data.user.email,
      name:  data.user.user_metadata?.full_name || data.user.email,
      id:    data.user.id,
    });

  } catch (err) {
    btn.classList.remove('loading'); btn.disabled = false;
    document.getElementById('login-error-msg').textContent = 'Login failed. Please try again.';
    banner.classList.remove('hidden');
  }
}

/* ════════════════════
   FORGOT PASSWORD (demo)
════════════════════ */
document.getElementById('forgot-pw-btn').addEventListener('click', () => {
  const email = document.getElementById('li-email').value.trim();
  if (!email || !validateEmail(email)) {
    setError('li-email-err', 'Enter your email address first.');
    markField('li-email', false); return;
  }
  // In production: POST to /api/forgot-password
  document.getElementById('li-email').value = '';
  document.getElementById('li-password').value = '';
  const banner = document.getElementById('login-error-banner');
  document.getElementById('login-error-msg').textContent =
    `If ${email} is registered, a reset link has been sent.`;
  banner.style.background = 'rgba(107,158,126,.1)';
  banner.style.borderColor = 'rgba(107,158,126,.3)';
  banner.style.color = '#6b9e7e';
  banner.querySelector('span:first-child').textContent = '✓';
  banner.classList.remove('hidden');
});

/* ════════════════════
   GO TO DASHBOARD
════════════════════ */
document.getElementById('goto-dashboard').addEventListener('click', async () => {
  const sess = await AuthDB.getSession();
  revealDashboard(sess);
});


/* ════════════════════
   SHAKE ANIMATION (inject dynamically)
════════════════════ */
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    15%  { transform: translateX(-6px); }
    30%  { transform: translateX(6px); }
    45%  { transform: translateX(-4px); }
    60%  { transform: translateX(4px); }
    75%  { transform: translateX(-2px); }
    90%  { transform: translateX(2px); }
  }
`;
document.head.appendChild(shakeStyle);


