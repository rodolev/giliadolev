/**
 * Gilia Dolev | Admin Panel Client Logic
 * Supports both local server mode (localhost:3000) and GitHub Pages cloud mode
 * with a simple password login (no technical steps required for the end user).
 */

const GITHUB_REPO = 'rodolev/giliadolev';
const GITHUB_BRANCH = 'main';

// Web Crypto helpers to unlock the GitHub save key using Gilia's simple password
const hexToBytes = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
};

const decryptGithubToken = async (password, vault) => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password.trim()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: hexToBytes(vault.salt),
      iterations: 250000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(vault.iv) },
    key,
    hexToBytes(vault.cipher)
  );
  return new TextDecoder().decode(decrypted);
};

const bytesToHex = (bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const encryptGithubToken = async (password, ghToken) => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password.trim()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(ghToken)
  );
  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    cipher: bytesToHex(new Uint8Array(cipherBuf))
  };
};

// UTF-8 safe base64 encoding for GitHub API
const toBase64Utf8 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const saveFileToGithub = async (ghToken, filePath, base64Content, commitMessage) => {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${ghToken}`,
    Accept: 'application/vnd.github+json'
  };

  // Get current file SHA if it exists
  let sha;
  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}&t=${Date.now()}`, { headers });
  if (getRes.ok) {
    const fileInfo = await getRes.json();
    sha = fileInfo.sha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  if (!putRes.ok) {
    throw new Error('GitHub API save failed');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.protocol === 'file:') {
    window.location.replace('http://localhost:3000/admin');
    return;
  }

  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  const API_BASE =
    isLocalhost && window.location.port !== '3000'
      ? 'http://localhost:3000'
      : '';

  const getToken = () => sessionStorage.getItem('gilia_admin_token') || '';
  const setToken = (t) => {
    if (t) sessionStorage.setItem('gilia_admin_token', t);
    else sessionStorage.removeItem('gilia_admin_token');
  };

  const getGhToken = () => sessionStorage.getItem('gilia_gh_token') || '';
  const setGhToken = (t) => {
    if (t) sessionStorage.setItem('gilia_gh_token', t);
    else sessionStorage.removeItem('gilia_gh_token');
  };

  const getActiveUser = () => sessionStorage.getItem('gilia_active_user') || 'gilia';
  const setActiveUser = (u) => {
    if (u) sessionStorage.setItem('gilia_active_user', u);
    else sessionStorage.removeItem('gilia_active_user');
  };

  const apiFetch = (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include'
    });
  };

  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const passwordInput = document.getElementById('current-password');
  const togglePasswordBtn = document.getElementById('toggle-password');

  const contentForm = document.getElementById('content-editor-form');
  const topSaveBtn = document.getElementById('top-save-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const saveToast = document.getElementById('save-toast');

  const photoInput = document.getElementById('photo-file-input');
  const photoPreview = document.getElementById('admin-photo-preview');
  const leadsContainer = document.getElementById('leads-container');
  const refreshLeadsBtn = document.getElementById('refresh-leads-btn');
  const passwordForm = document.getElementById('password-form');

  // Hide local-only inquiries section when running on static GitHub Pages
  if (!isLocalhost) {
    const leadsSection = document.getElementById('sec-leads')?.closest('.editor-card');
    if (leadsSection) leadsSection.hidden = true;
  }

  let pendingPhotoDataUrl = null;
  let currentHeroImage = 'assets/gilia-dolev.jpg';

  const showToast = (msg) => {
    if (!saveToast) return;
    saveToast.textContent = msg;
    saveToast.hidden = false;
    setTimeout(() => {
      saveToast.hidden = true;
    }, 4000);
  };

  togglePasswordBtn?.addEventListener('click', () => {
    if (!passwordInput) return;
    const isShowing = passwordInput.type === 'text';
    passwordInput.type = isShowing ? 'password' : 'text';
    togglePasswordBtn.setAttribute('aria-pressed', String(!isShowing));
    togglePasswordBtn.textContent = isShowing ? 'הצגת סיסמה' : 'הסתרת סיסמה';
  });

  const populateEditor = (data) => {
    if (!data) return;
    const textKeys = [
      'brandName',
      'brandRole',
      'phoneDisplay',
      'heroEyebrow',
      'heroTitle',
      'heroLead',
      'heroWhatsappBtn',
      'heroContactBtn',
      'aboutHeading',
      'aboutParagraph1',
      'aboutParagraph2',
      'qualificationsHeading',
      'visitHeading',
      'contactHeading',
      'contactSubtitle',
      'footerCopy'
    ];

    textKeys.forEach((key) => {
      const el = document.getElementById(`edit-${key}`);
      if (el && typeof data[key] === 'string') {
        el.value = data[key];
      }
    });

    const qualBulletsEl = document.getElementById('edit-qualificationsBullets');
    if (qualBulletsEl && Array.isArray(data.qualificationsBullets)) {
      qualBulletsEl.value = data.qualificationsBullets.join('\n');
    }

    const bulletsEl = document.getElementById('edit-visitBullets');
    if (bulletsEl && Array.isArray(data.visitBullets)) {
      bulletsEl.value = data.visitBullets.join('\n');
    }

    if (typeof data.heroImage === 'string' && data.heroImage) {
      currentHeroImage = data.heroImage;
      if (photoPreview) photoPreview.src = `${data.heroImage}?t=${Date.now()}`;
    }
  };

  const renderLeads = (leads) => {
    if (!leadsContainer) return;
    if (!Array.isArray(leads) || leads.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'empty-leads';
      emptyP.textContent = 'עדיין לא התקבלו פניות דרך הטופס באתר.';
      leadsContainer.replaceChildren(emptyP);
      return;
    }

    const items = leads.map((lead) => {
      const row = document.createElement('div');
      row.className = 'lead-item';

      const infoDiv = document.createElement('div');
      const titleStrong = document.createElement('strong');
      titleStrong.textContent = `${lead.name || 'ללא שם'} · ${lead.phone || ''}`;

      const dateSpan = document.createElement('div');
      dateSpan.className = 'lead-meta';
      dateSpan.textContent = lead.createdAt
        ? new Date(lead.createdAt).toLocaleString('he-IL')
        : '';

      infoDiv.append(titleStrong, dateSpan);

      if (lead.notes) {
        const notesP = document.createElement('p');
        notesP.className = 'lead-notes';
        notesP.textContent = lead.notes;
        infoDiv.append(notesP);
      }

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'lead-actions';

      const cleanDigits = String(lead.phone || '').replace(/\D/g, '').replace(/^0/, '972');
      if (cleanDigits) {
        const waBtn = document.createElement('a');
        waBtn.className = 'btn btn-primary btn-sm';
        waBtn.href = `https://wa.me/${cleanDigits}?text=${encodeURIComponent(`היי ${lead.name || ''}, כאן גיליה דולב יועצת הנקה, בהמשך לפנייתך באתר:`)}`;
        waBtn.target = '_blank';
        waBtn.rel = 'noopener noreferrer';
        waBtn.textContent = 'מענה בוואטסאפ';
        actionsDiv.append(waBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-secondary btn-sm';
      delBtn.textContent = 'מחיקה';
      delBtn.addEventListener('click', async () => {
        const res = await apiFetch(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          loadDashboardData();
        }
      });

      actionsDiv.append(delBtn);
      row.append(infoDiv, actionsDiv);
      return row;
    });

    leadsContainer.replaceChildren(...items);
  };

  const loadDashboardData = async () => {
    if (!isLocalhost) {
      // GitHub Pages mode: load data/content.json directly
      const res = await fetch(`data/content.json?t=${Date.now()}`, { cache: 'no-cache' });
      if (res.ok) {
        const contentData = await res.json();
        populateEditor(contentData);
      }
      loginView.hidden = true;
      dashboardView.hidden = false;
      return;
    }

    try {
      const [contentRes, leadsRes] = await Promise.all([
        apiFetch('/api/content', { cache: 'no-cache' }),
        apiFetch('/api/leads', { cache: 'no-cache' })
      ]);

      if (contentRes.status === 401 || leadsRes.status === 401) {
        loginView.hidden = false;
        dashboardView.hidden = true;
        return;
      }

      if (contentRes.ok) {
        const contentData = await contentRes.json();
        populateEditor(contentData);
      }
      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        renderLeads(leadsData.leads || []);
      }

      loginView.hidden = true;
      dashboardView.hidden = false;
    } catch {
      if (loginError) {
        loginError.textContent = 'שרת הניהול אינו פעיל כרגע.';
        loginError.hidden = false;
      }
    }
  };

  // Auto-restore session if already logged in
  if (!isLocalhost) {
    if (getGhToken()) {
      loadDashboardData();
    }
  } else {
    apiFetch('/api/session', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { authenticated: false }))
      .then((status) => {
        if (status.authenticated) {
          loadDashboardData();
        }
      })
      .catch(() => {});
  }

  // Handle Login Submit
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginError) loginError.hidden = true;

    const formData = new FormData(loginForm);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '').trim();

    if (!isLocalhost) {
      // GitHub Pages mode: decrypt multi-user vault with password
      try {
        const vRes = await fetch(`data/cloud-vault.json?t=${Date.now()}`, { cache: 'no-cache' });
        if (!vRes.ok) {
          throw new Error('missing-vault');
        }
        const vaultData = await vRes.json();
        const usersMap = vaultData.users || { gilia: vaultData };

        const cleanName = username.toLowerCase();
        const matchedUser =
          cleanName === 'roi' || cleanName === 'רועי' ? 'roi' : 'gilia';

        if (!usersMap[matchedUser]) {
          throw new Error('invalid-user');
        }

        const unlockedGhToken = await decryptGithubToken(password, usersMap[matchedUser]);

        setGhToken(unlockedGhToken);
        setActiveUser(matchedUser);
        passwordInput.value = '';
        await loadDashboardData();
      } catch {
        if (loginError) {
          loginError.textContent = 'שם משתמש או סיסמה שגויים.';
          loginError.hidden = false;
        }
      }
      return;
    }

    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (loginError) {
          loginError.textContent = resData.error || 'שם משתמש או סיסמה שגויים.';
          loginError.hidden = false;
        }
        return;
      }

      if (resData.token) {
        setToken(resData.token);
      }
      passwordInput.value = '';
      await loadDashboardData();
    } catch {
      if (loginError) {
        loginError.textContent = 'לא ניתן להתחבר לשרת.';
        loginError.hidden = false;
      }
    }
  });

  // Handle Photo File Selection
  photoInput?.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        pendingPhotoDataUrl = reader.result;
        if (photoPreview) photoPreview.src = pendingPhotoDataUrl;
      }
    });
    reader.readAsDataURL(file);
  });

  // Handle Save Content
  const saveAllChanges = async () => {
    if (!contentForm) return;

    const rawPhone = String(document.getElementById('edit-phoneDisplay')?.value || '').trim();
    const digitsOnly = rawPhone.replace(/\D/g, '');
    const phoneClean = digitsOnly.startsWith('0')
      ? `972${digitsOnly.slice(1)}`
      : digitsOnly || '972522524579';

    const qualBulletsRaw = String(document.getElementById('edit-qualificationsBullets')?.value || '');
    const qualificationsBullets = qualBulletsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const bulletsRaw = String(document.getElementById('edit-visitBullets')?.value || '');
    const visitBullets = bulletsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let uploadedImagePath = currentHeroImage;

    // Cloud save mode (GitHub Pages)
    if (!isLocalhost) {
      const ghToken = getGhToken();
      if (!ghToken) return;

      try {
        showToast('שומר שינויים באתר...');
        if (pendingPhotoDataUrl) {
          const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(pendingPhotoDataUrl);
          if (match) {
            const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
            const filePath = `assets/gilia-custom.${ext}`;
            await saveFileToGithub(ghToken, filePath, match[2], 'Update website photo');
            uploadedImagePath = filePath;
            currentHeroImage = filePath;
            pendingPhotoDataUrl = null;
          }
        }

        const payload = {
          brandName: String(document.getElementById('edit-brandName')?.value || '').trim(),
          brandRole: String(document.getElementById('edit-brandRole')?.value || '').trim(),
          phoneDisplay: rawPhone,
          phoneClean,
          heroEyebrow: String(document.getElementById('edit-heroEyebrow')?.value || '').trim(),
          heroTitle: String(document.getElementById('edit-heroTitle')?.value || '').trim(),
          heroLead: String(document.getElementById('edit-heroLead')?.value || '').trim(),
          heroWhatsappBtn: String(document.getElementById('edit-heroWhatsappBtn')?.value || '').trim(),
          heroContactBtn: String(document.getElementById('edit-heroContactBtn')?.value || '').trim(),
          heroImage: uploadedImagePath,
          aboutHeading: String(document.getElementById('edit-aboutHeading')?.value || '').trim(),
          aboutParagraph1: String(document.getElementById('edit-aboutParagraph1')?.value || '').trim(),
          aboutParagraph2: String(document.getElementById('edit-aboutParagraph2')?.value || '').trim(),
          qualificationsHeading: String(document.getElementById('edit-qualificationsHeading')?.value || '').trim(),
          qualificationsBullets,
          visitHeading: String(document.getElementById('edit-visitHeading')?.value || '').trim(),
          visitBullets,
          contactHeading: String(document.getElementById('edit-contactHeading')?.value || '').trim(),
          contactSubtitle: String(document.getElementById('edit-contactSubtitle')?.value || '').trim(),
          footerCopy: String(document.getElementById('edit-footerCopy')?.value || '').trim()
        };

        await saveFileToGithub(
          ghToken,
          'data/content.json',
          toBase64Utf8(JSON.stringify(payload, null, 2)),
          'Update website content via Admin Panel'
        );

        showToast('✓ השינויים נשמרו! האתר יתעדכן תוך כדקה.');
      } catch {
        showToast('אירעה שגיאה בשמירת השינויים.');
      }
      return;
    }

    // Localhost server mode
    if (pendingPhotoDataUrl) {
      const uploadRes = await apiFetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: pendingPhotoDataUrl })
      });
      if (uploadRes.ok) {
        const upJson = await uploadRes.json();
        uploadedImagePath = upJson.path || currentHeroImage;
        currentHeroImage = uploadedImagePath;
        pendingPhotoDataUrl = null;
      }
    }

    const payload = {
      brandName: String(document.getElementById('edit-brandName')?.value || '').trim(),
      brandRole: String(document.getElementById('edit-brandRole')?.value || '').trim(),
      phoneDisplay: rawPhone,
      phoneClean,
      heroEyebrow: String(document.getElementById('edit-heroEyebrow')?.value || '').trim(),
      heroTitle: String(document.getElementById('edit-heroTitle')?.value || '').trim(),
      heroLead: String(document.getElementById('edit-heroLead')?.value || '').trim(),
      heroWhatsappBtn: String(document.getElementById('edit-heroWhatsappBtn')?.value || '').trim(),
      heroContactBtn: String(document.getElementById('edit-heroContactBtn')?.value || '').trim(),
      heroImage: uploadedImagePath,
      aboutHeading: String(document.getElementById('edit-aboutHeading')?.value || '').trim(),
      aboutParagraph1: String(document.getElementById('edit-aboutParagraph1')?.value || '').trim(),
      aboutParagraph2: String(document.getElementById('edit-aboutParagraph2')?.value || '').trim(),
      qualificationsHeading: String(document.getElementById('edit-qualificationsHeading')?.value || '').trim(),
      qualificationsBullets,
      visitHeading: String(document.getElementById('edit-visitHeading')?.value || '').trim(),
      visitBullets,
      contactHeading: String(document.getElementById('edit-contactHeading')?.value || '').trim(),
      contactSubtitle: String(document.getElementById('edit-contactSubtitle')?.value || '').trim(),
      footerCopy: String(document.getElementById('edit-footerCopy')?.value || '').trim()
    };

    const res = await apiFetch('/api/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('✓ השינויים נשמרו והאתר עודכן בהצלחה!');
    } else {
      showToast('אירעה שגיאה בשמירת השינויים.');
    }
  };

  contentForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveAllChanges();
  });

  topSaveBtn?.addEventListener('click', () => {
    saveAllChanges();
  });

  refreshLeadsBtn?.addEventListener('click', () => {
    loadDashboardData();
  });

  passwordForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = String(document.getElementById('new-password')?.value || '').trim();
    const targetUser = getActiveUser();
    if (newPassword.length < 6) return;

    if (!isLocalhost) {
      const ghToken = getGhToken();
      if (!ghToken) return;
      try {
        const vRes = await fetch(`data/cloud-vault.json?t=${Date.now()}`, { cache: 'no-cache' });
        const existingData = vRes.ok ? await vRes.json() : {};
        const usersMap = existingData.users || (existingData.cipher ? { gilia: existingData } : {});

        usersMap[targetUser] = await encryptGithubToken(newPassword, ghToken);
        const updatedVaultFile = { users: usersMap };

        await saveFileToGithub(
          ghToken,
          'data/cloud-vault.json',
          toBase64Utf8(JSON.stringify(updatedVaultFile, null, 2)),
          `Update encrypted admin password for ${targetUser}`
        );
        passwordForm.reset();
        showToast('✓ הסיסמה עודכנה בהצלחה!');
      } catch {
        showToast('אירעה שגיאה בעדכון הסיסמה.');
      }
      return;
    }

    const res = await apiFetch('/api/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });

    if (res.ok) {
      passwordForm.reset();
      showToast('✓ הסיסמה עודכנה בהצלחה!');
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    if (isLocalhost) {
      await apiFetch('/api/logout', { method: 'POST' });
    }
    setToken('');
    setGhToken('');
    dashboardView.hidden = true;
    loginView.hidden = false;
  });
});
