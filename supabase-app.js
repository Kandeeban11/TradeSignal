/* Supabase deployment adapter for the static TradeSignal app. */
(function () {
  const config = window.TRADESIGNAL_SUPABASE || {};
  const configured = config.url && config.anonKey && !config.url.includes('YOUR_PROJECT') && !config.anonKey.includes('YOUR_');
  let client;
  let recoveryMode = false;

  function notice(message, error) {
    const root = document.getElementById('authNotice');
    if (root) root.innerHTML = `<div class="notice ${error ? 'error' : ''}">${message}</div>`;
  }

  function setupScreen() {
    document.body.innerHTML = `<div class="auth-screen"><aside class="auth-aside"><div class="logo">trade<span>signal</span></div><div class="aside-copy"><h1>Connect your workspace.</h1><p>Supabase is ready to power authentication, accounts, trades, and analytics. Add your project URL and anon key to start.</p></div><div class="aside-foot">DEPLOYMENT SETUP REQUIRED</div></aside><main class="auth-card"><div class="auth-inner"><div class="eyebrow">Supabase connection</div><h2>Almost ready</h2><p class="muted">Set the public project values in <b>supabase-config.js</b>, then reload this page.</p><div class="notice error">The demo database has been removed. No sample users or trades are loaded.</div></div></main></div>`;
  }

  function authScreen() {
    window.auth();
    const hint = document.querySelector('.auth-actions .small');
    if (hint) hint.textContent = 'Email verification is handled by Supabase';
    const form = document.getElementById('loginForm');
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Signing in...';
      const { error } = await client.auth.signInWithPassword({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      });
      if (error) {
        notice(error.message, true);
        button.disabled = false;
        button.textContent = 'Sign in to workspace';
        return;
      }
      await loadWorkspace();
    };
    document.getElementById('forgotBtn').onclick = showReset;
  }

  function showReset() {
    document.querySelector('.auth-inner').innerHTML = `<div class="eyebrow">Account recovery</div><h2>Reset your password</h2><p class="muted">Supabase will send a secure reset link to your registered email.</p><form class="form" id="resetForm"><div class="field"><label>Work email</label><input id="resetEmail" type="email" required></div><button class="primary" style="width:100%">Send reset email</button></form><div class="auth-actions"><button class="link" id="backLogin">Back to sign in</button></div><div id="authNotice"></div>`;
    document.getElementById('backLogin').onclick = authScreen;
    document.getElementById('resetForm').onsubmit = async (event) => {
      event.preventDefault();
      const redirectTo = config.redirectUrl || `${location.origin}${location.pathname}`;
      const { error } = await client.auth.resetPasswordForEmail(document.getElementById('resetEmail').value.trim(), { redirectTo });
      notice(error ? error.message : 'Reset email sent. Check your inbox.', !!error);
    };
  }

  function showPasswordRecovery() {
    recoveryMode = true;
    document.body.innerHTML = `<div class="auth-screen"><aside class="auth-aside"><div class="logo">trade<span>signal</span></div><div class="aside-copy"><h1>Set a new password.</h1><p>Your recovery link has been verified. Choose a new password for your TradeSignal administrator account.</p></div><div class="aside-foot">SECURE ACCOUNT RECOVERY</div></aside><main class="auth-card"><div class="auth-inner"><div class="eyebrow">Verified recovery link</div><h2>New password</h2><p class="muted">Use at least 8 characters, then sign in again.</p><form class="form" id="newPasswordForm"><div class="field"><label>New password</label><input id="newPassword" type="password" minlength="8" required></div><div class="field"><label>Confirm password</label><input id="confirmPassword" type="password" minlength="8" required></div><button class="primary" style="width:100%">Update password</button></form><div id="authNotice"></div></div></main></div>`;
    document.getElementById('newPasswordForm').onsubmit = async (event) => {
      event.preventDefault();
      const password = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;
      if (password !== confirm) return notice('Passwords do not match.', true);
      const { error } = await client.auth.updateUser({ password });
      if (error) return notice(error.message, true);
      notice('Password updated. You can now sign in.');
      setTimeout(() => { history.replaceState({}, document.title, location.pathname); recoveryMode = false; authScreen(); }, 900);
    };
  }

  async function loadWorkspace() {
    const { data: sessionData } = await client.auth.getSession();
    const session = sessionData.session;
    if (!session) return authScreen();
    const profileResult = await client.from('profiles').select('*').eq('id', session.user.id).single();
    if (profileResult.error || profileResult.data.role !== 'admin' || profileResult.data.status !== 'active') {
      await client.auth.signOut();
      authScreen();
      notice('This account is not an active administrator.', true);
      return;
    }
    currentAdmin = { name: profileResult.data.full_name, email: profileResult.data.email || session.user.email || '' };
    pageHeader = function (title, sub) {
      const displayName = currentAdmin.name || currentAdmin.email || 'Administrator';
      return `<div class="topbar"><div><h1>${title}</h1><p class="muted">${sub}</p></div><div class="profile"><div class="avatar">${initials(displayName)}</div><div><strong>${displayName}</strong><span>${currentAdmin.email}</span></div></div></div>`;
    };
    const [profilesResult, tradesResult, monthlyResult] = await Promise.all([
      client.from('profiles').select('*').eq('role', 'trader').order('created_at', { ascending: false }),
      client.from('trades').select('*, profiles(full_name, email)').order('closed_at', { ascending: false }),
      client.from('monthly_pnl').select('*').order('month', { ascending: true })
    ]);
    if (profilesResult.error || tradesResult.error) {
      authScreen();
      notice('Supabase tables are not ready. Run supabase-schema.sql first.', true);
      return;
    }
    store = {
      users: profilesResult.data.map((user) => ({ id: user.id, name: user.full_name, email: user.email, role: 'Trader', status: user.status, joined: user.created_at.slice(0, 10), pnl: 0, trades: 0 })),
      trades: tradesResult.data.map((trade) => ({ user: trade.profiles?.full_name || 'Unknown trader', asset: trade.asset, side: trade.side, date: new Date(trade.closed_at || trade.opened_at).toLocaleDateString(), pnl: Number(trade.pnl), userId: trade.user_id })),
    };
    store.users.forEach((user) => {
      const userTrades = store.trades.filter((trade) => trade.userId === user.id);
      user.trades = userTrades.length;
      user.pnl = userTrades.reduce((total, trade) => total + trade.pnl, 0);
    });
    if (Array.isArray(defaultMonths)) {
      defaultMonths.splice(0, defaultMonths.length, ...(monthlyResult.data || []).reduce((months, row) => {
        const key = row.month.slice(0, 7);
        const existing = months.find((month) => month.key === key);
        if (existing) existing.value += Number(row.pnl); else months.push({ key, month: new Date(`${row.month}T00:00:00`).toLocaleString(undefined, { month: 'short' }), value: Number(row.pnl) });
        return months;
      }, []).map((month) => ({ month: month.month, value: month.value })));
    }
    window.renderApp();
  }

  window.modal = function (user) {
    const editing = Boolean(user);
    document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><div class="eyebrow">${editing ? 'Edit account' : 'New account'}</div><h2>${editing ? 'Update trader' : 'Invite a trader'}</h2><p class="muted">${editing ? 'Changes are saved to Supabase.' : 'Supabase will send an invitation email.'}</p></div><button class="close" id="closeModal">×</button></div><form class="form" id="userForm"><div class="field"><label>Full name</label><input id="userName" required value="${editing ? user.name : ''}"></div><div class="field"><label>Registered email</label><input id="userEmail" type="email" required value="${editing ? user.email : ''}"></div><div class="field"><label>Account status</label><select id="userStatus"><option ${!editing || user.status === 'active' ? 'selected' : ''}>active</option><option ${editing && user.status === 'disabled' ? 'selected' : ''}>disabled</option></select></div><div id="modalNotice" class="notice">${editing ? 'Update this trader profile.' : 'The create-user Edge Function sends the invite securely.'}</div><div class="modal-actions"><button type="button" class="secondary" id="cancelModal">Cancel</button><button class="primary">${editing ? 'Save changes' : 'Create & send invite'}</button></div></form></div></div>`;
    const close = () => { document.getElementById('modalRoot').innerHTML = ''; };
    document.getElementById('closeModal').onclick = close;
    document.getElementById('cancelModal').onclick = close;
    document.getElementById('userForm').onsubmit = async (event) => {
      event.preventDefault();
      const name = document.getElementById('userName').value.trim();
      const email = document.getElementById('userEmail').value.trim();
      const status = document.getElementById('userStatus').value;
      const submit = event.target.querySelector('button.primary');
      submit.disabled = true;
      if (editing) {
        const { error } = await client.from('profiles').update({ full_name: name, email, status }).eq('id', user.id);
        if (error) document.getElementById('modalNotice').textContent = error.message;
        else { close(); await loadWorkspace(); }
      } else {
        const { error } = await client.functions.invoke('create-user', { body: { full_name: name, email, status } });
        if (error) {
          const details = error.message || 'Unknown Supabase function error';
          document.getElementById('modalNotice').textContent = `Could not send invite: ${details}. Deploy create-user and configure its service-role secret.`;
        }
        else { close(); await loadWorkspace(); }
      }
      submit.disabled = false;
    };
  };

  window.bindPage = function () {
    document.querySelectorAll('[data-view-user]').forEach((button) => button.onclick = () => { page = 'analytics'; renderPage(); });
    document.getElementById('manageBtn')?.addEventListener('click', () => { page = 'users'; renderPage(); });
    document.getElementById('addUser')?.addEventListener('click', () => modal());
    document.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => modal(store.users.find((user) => user.id === button.dataset.edit)));
    document.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => {
      const user = store.users.find((item) => item.id === button.dataset.delete);
      if (!user || !confirm(`Delete ${user.name}'s profile and trades?`)) return;
      const { error } = await client.from('profiles').delete().eq('id', user.id);
      if (error) alert(error.message); else await loadWorkspace();
    });
    document.getElementById('tradeUser')?.addEventListener('change', (event) => document.querySelectorAll('#tradesTable tbody tr').forEach((row) => { row.style.display = event.target.value === 'All traders' || row.dataset.trader === event.target.value ? '' : 'none'; }));
    document.getElementById('statusFilter')?.addEventListener('change', () => filterUsers());
    document.getElementById('userSearch')?.addEventListener('input', () => filterUsers());
  };

  window.supabaseBoot = async function () {
    if (!configured || !window.supabase) return setupScreen();
    client = window.supabase.createClient(config.url, config.anonKey);
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !recoveryMode) showPasswordRecovery();
    });
    const params = new URLSearchParams(location.search);
    if (params.get('code')) {
      const { error } = await client.auth.exchangeCodeForSession(params.get('code'));
      if (error) {
        authScreen();
        notice(`Recovery link could not be verified: ${error.message}`, true);
        return;
      }
      return showPasswordRecovery();
    }
    if (location.hash.includes('type=recovery')) return showPasswordRecovery();
    const { data } = await client.auth.getSession();
    if (data.session) return loadWorkspace();
    authScreen();
  };
})();
