  document.getElementById('year').textContent = new Date().getFullYear();

  // Reveal paw prints / route as it scrolls into view (progressive enhancement)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting){ e.target.classList.add('in-view'); }
    });
  }, { threshold: 0.3 });
  document.querySelectorAll('.paw').forEach(el => observer.observe(el));

  // ============================================================
  // CONFIG
  // ============================================================
  const ADMIN_EMAIL = "gaporp456@gmail.com";
  const GOOGLE_CLIENT_ID = "282672384779-dnvi5jc5jbdmqdi140p4pa54ast1jd7q.apps.googleusercontent.com";
  const SESSION_LENGTH_HOURS = 12;
  const GITHUB_OWNER = "gphillips15";
  const GITHUB_REPO = "PupTruck";
  const GITHUB_BRANCH = "main";
  const GITHUB_FILE_PATH = "content.json";
  // ============================================================

  // ---------- Admin session ----------
  function getAdminSession(){
    try {
      const raw = localStorage.getItem('pptAdminSession');
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (session.email === ADMIN_EMAIL && session.exp > Date.now()) return session;
      localStorage.removeItem('pptAdminSession');
      return null;
    } catch { return null; }
  }

  function decodeJwt(token){
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(base64))));
  }

  let googleInitialized = false;
  function initGoogleSignIn(){
    if (googleInitialized) return;
    try {
      if (typeof google === 'undefined' || !google.accounts) {
        throw new Error('Google sign-in script did not load (an ad blocker or privacy setting may be blocking it).');
      }
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
      });
      google.accounts.id.renderButton(
        document.getElementById('google-signin-button'),
        { theme: 'outline', size: 'large', text: 'signin_with' }
      );
      googleInitialized = true;
    } catch (err) {
      const statusEl = document.getElementById('signin-status');
      statusEl.textContent = err.message;
      statusEl.style.display = 'block';
      console.error(err);
    }
  }

  function handleCredentialResponse(response){
    const statusEl = document.getElementById('signin-status');
    try {
      if (!response || !response.credential) throw new Error('No credential received from Google.');
      const payload = decodeJwt(response.credential);

      if (payload.email === ADMIN_EMAIL && payload.email_verified) {
        const session = { email: payload.email, exp: Date.now() + SESSION_LENGTH_HOURS * 60 * 60 * 1000 };
        localStorage.setItem('pptAdminSession', JSON.stringify(session));
        document.getElementById('signin-overlay').style.display = 'none';
        statusEl.style.display = 'none';
        enableEditMode(session);
      } else {
        statusEl.textContent = `"${payload.email}" isn't the admin account for this site.`;
        statusEl.style.display = 'block';
      }
    } catch (err) {
      statusEl.textContent = 'Sign-in error: ' + err.message;
      statusEl.style.display = 'block';
      console.error(err);
    }
  }

  const adminOpenBtn = document.getElementById('admin-open-btn');
  if (adminOpenBtn) adminOpenBtn.addEventListener('click', () => {
    document.getElementById('signin-overlay').style.display = 'flex';
    initGoogleSignIn();
  });
  const signinCloseBtn = document.getElementById('signin-close-btn');
  if (signinCloseBtn) signinCloseBtn.addEventListener('click', () => {
    document.getElementById('signin-overlay').style.display = 'none';
  });

  // ---------- GitHub auto-save ----------
  function getGithubToken(){ return localStorage.getItem('pptGithubToken'); }

  function promptForGithubToken(){
    const token = prompt(
      "Paste your GitHub Personal Access Token to enable auto-save.\n\n" +
      "Don't have one yet?\n" +
      "1. Go to github.com/settings/tokens?type=beta\n" +
      "2. Generate new token -> Fine-grained token\n" +
      "3. Repository access: Only select repositories -> PupTruck\n" +
      "4. Permissions -> Contents -> Read and write\n" +
      "5. Generate, then copy/paste it here.\n\n" +
      "This is stored only in this browser."
    );
    if (token) {
      localStorage.setItem('pptGithubToken', token.trim());
      return token.trim();
    }
    return null;
  }

  async function commitContentJson(newState){
    let token = getGithubToken();
    if (!token) {
      token = promptForGithubToken();
      if (!token) throw new Error('Auto-save needs a GitHub token to continue.');
    }

    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
    const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}&_=${Date.now()}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!getRes.ok) {
      if (getRes.status === 401 || getRes.status === 403) {
        localStorage.removeItem('pptGithubToken');
        throw new Error('That GitHub token was rejected or has expired. Please reconnect and try again.');
      }
      throw new Error(`Could not read the current file from GitHub (status ${getRes.status}).`);
    }
    const currentFile = await getRes.json();

    const contentStr = JSON.stringify(newState, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(contentStr)));

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Update site content via admin panel',
        content: encoded,
        sha: currentFile.sha,
        branch: GITHUB_BRANCH
      })
    });
    if (!putRes.ok) {
      const errBody = await putRes.json().catch(() => ({}));
      throw new Error(errBody.message || `GitHub rejected the update (status ${putRes.status}).`);
    }
    return true;
  }

  function downloadContentJsonBackup(){
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'content.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- State + rendering ----------
  let state = null;
  let dirty = false;
  const genericIconSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="15" rx="6" ry="4.5" stroke="#4B3358" stroke-width="1.8"/><ellipse cx="7" cy="9" rx="2.2" ry="2.8" stroke="#4B3358" stroke-width="1.8"/><ellipse cx="17" cy="9" rx="2.2" ry="2.8" stroke="#4B3358" stroke-width="1.8"/><ellipse cx="9.5" cy="6" rx="1.8" ry="2.3" stroke="#4B3358" stroke-width="1.8"/><ellipse cx="14.5" cy="6" rx="1.8" ry="2.3" stroke="#4B3358" stroke-width="1.8"/></svg>`;

  function setDeep(obj, path, value){
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }

  function bindTextEl(el, path, isHtml){
    if (!el) return;
    el.dataset.bind = path;
    const value = path.split('.').reduce((o,k)=>o?.[k], state);
    if (isHtml) el.innerHTML = value || ''; else el.textContent = value || '';
  }

  function renderStatic(){
    bindTextEl(document.getElementById('hero-eyebrow'), 'hero.eyebrow');
    bindTextEl(document.getElementById('hero-lede'), 'hero.lede');
    bindTextEl(document.getElementById('about-p1'), 'about.paragraph1');
    bindTextEl(document.getElementById('about-p2'), 'about.paragraph2');
    bindTextEl(document.getElementById('about-p3'), 'about.paragraph3');
    bindTextEl(document.getElementById('footer-tagline'), 'footerTagline', true);
    bindTextEl(document.getElementById('footer-name'), 'siteName');
    bindTextEl(document.getElementById('footer-name-2'), 'siteName');

    const title = document.getElementById('hero-title');
    if (title) {
      title.innerHTML = `<span data-bind="hero.titleLine1">${state.hero.titleLine1||''}</span><br><span class="hl" data-bind="hero.titleHighlight">${state.hero.titleHighlight||''}</span>,<br><span data-bind="hero.titleLine2">${state.hero.titleLine2||''}</span>`;
    }

    const ig = document.getElementById('link-instagram');
    const fb = document.getElementById('link-facebook');
    const tx = document.getElementById('link-textlist');
    if (ig) ig.href = state.social?.instagram || '#';
    if (fb) fb.href = state.social?.facebook || '#';
    if (tx) tx.href = state.social?.textList || '#';
    if (ig) ig.dataset.socialKey = 'instagram';
    if (fb) fb.dataset.socialKey = 'facebook';
    if (tx) tx.dataset.socialKey = 'textList';

    if (state.images) {
      const navLogo = document.getElementById('nav-logo-img');
      const truckImg = document.getElementById('truck-img');
      const aboutImg = document.getElementById('about-photo-img');
      if (state.images.navLogo && navLogo) navLogo.src = state.images.navLogo;
      if (state.images.truck && truckImg) truckImg.src = state.images.truck;
      if (state.images.aboutPhoto && aboutImg) aboutImg.src = state.images.aboutPhoto;
    }
  }

  function renderNews(editMode){
    const newsSection = document.getElementById('news');
    const newsList = document.getElementById('news-list');
    if (!newsSection || !newsList) return;
    const items = state.news || [];
    if (items.length === 0 && !editMode) { newsSection.style.display = 'none'; return; }
    newsSection.style.display = '';
    newsList.innerHTML = items.map((item, i) => `
      <div class="news-card">
        ${editMode ? `<button class="remove-item-btn" data-list="news" data-index="${i}">&times;</button>` : ''}
        ${item.date || editMode ? `<div class="news-date" ${editMode ? `contenteditable="true" data-list="news" data-index="${i}" data-field="date"` : ''}>${item.date||''}</div>` : ''}
        <h3 ${editMode ? `contenteditable="true" data-list="news" data-index="${i}" data-field="title"` : ''}>${item.title||''}</h3>
        <p ${editMode ? `contenteditable="true" data-list="news" data-index="${i}" data-field="body"` : ''}>${item.body||''}</p>
      </div>
    `).join('');
    const parent = newsList.parentElement;
    parent.querySelectorAll('.add-item-btn').forEach(b => b.remove());
    if (editMode) {
      const btn = document.createElement('button');
      btn.className = 'add-item-btn';
      btn.textContent = '+ Add news item';
      btn.onclick = () => { state.news = state.news || []; state.news.push({date:'',title:'New update',body:''}); markDirty(); renderNews(true); };
      parent.appendChild(btn);
    }
  }

  // Full menu grid (used on menu.html, and index.html if it has #menu-grid)
  function renderMenu(editMode){
    const menuGrid = document.getElementById('menu-grid');
    if (!menuGrid) return;
    const items = state.menu || [];
    menuGrid.innerHTML = items.map((item, i) => `
      <div class="menu-card">
        ${editMode ? `<button class="remove-item-btn" data-list="menu" data-index="${i}">&times;</button>` : ''}
        <div class="icon">${genericIconSvg}</div>
        <h3 ${editMode ? `contenteditable="true" data-list="menu" data-index="${i}" data-field="name"` : ''}>${item.name||''}</h3>
        <p ${editMode ? `contenteditable="true" data-list="menu" data-index="${i}" data-field="description"` : ''}>${item.description||''}</p>
        <span class="price-tag" ${editMode ? `contenteditable="true" data-list="menu" data-index="${i}" data-field="price"` : ''}>${item.price||''}</span>
      </div>
    `).join('');
    const parent = menuGrid.parentElement;
    parent.querySelectorAll('.add-item-btn').forEach(b => b.remove());
    if (editMode) {
      const btn = document.createElement('button');
      btn.className = 'add-item-btn';
      btn.textContent = '+ Add menu item';
      btn.onclick = () => { state.menu = state.menu || []; state.menu.push({name:'New item',description:'',price:''}); markDirty(); renderMenu(true); };
      parent.appendChild(btn);
    }
  }

  // Condensed menu teaser (homepage) — first 3 items + link to menu.html
  function renderMenuTeaser(){
    const teaser = document.getElementById('menu-teaser-grid');
    if (!teaser) return;
    const items = (state.menu || []).slice(0, 3);
    teaser.innerHTML = items.map(item => `
      <div class="menu-card">
        <div class="icon">${genericIconSvg}</div>
        <h3>${item.name||''}</h3>
        <p>${item.description||''}</p>
        <span class="price-tag">${item.price||''}</span>
      </div>
    `).join('');
  }

  // Full schedule (used on find.html)
  function renderSchedule(editMode){
    const scheduleList = document.getElementById('schedule-list');
    if (!scheduleList) return;
    const items = state.schedule || [];
    scheduleList.innerHTML = items.map((stop, i) => `
      <div class="stop-card">
        ${editMode ? `<button class="remove-item-btn" data-list="schedule" data-index="${i}">&times;</button>` : ''}
        <div class="day" ${editMode ? `contenteditable="true" data-list="schedule" data-index="${i}" data-field="day"` : ''}>${stop.day||''}</div>
        <div class="place" ${editMode ? `contenteditable="true" data-list="schedule" data-index="${i}" data-field="place"` : ''}>${stop.place||''}</div>
        <div class="time" ${editMode ? `contenteditable="true" data-list="schedule" data-index="${i}" data-field="time"` : ''}>${stop.time||''}</div>
        ${editMode
          ? `<label class="address-label">Address (for directions)</label><div class="address-edit" contenteditable="true" data-list="schedule" data-index="${i}" data-field="address">${stop.address||''}</div>`
          : (stop.address ? `<button class="directions-btn" data-index="${i}">📍 Get Directions</button>` : '')}
      </div>
    `).join('');
    const parent = scheduleList.parentElement;
    parent.querySelectorAll('.add-item-btn').forEach(b => b.remove());
    if (editMode) {
      const btn = document.createElement('button');
      btn.className = 'add-item-btn';
      btn.textContent = '+ Add stop';
      btn.onclick = () => { state.schedule = state.schedule || []; state.schedule.push({day:'',place:'',time:'',address:''}); markDirty(); renderSchedule(true); };
      parent.appendChild(btn);
    }
    if (!editMode) {
      scheduleList.querySelectorAll('.directions-btn').forEach(btn => {
        btn.addEventListener('click', () => openDirectionsChooser(items[parseInt(btn.dataset.index,10)]));
      });
    }
  }

  // Condensed "next stop" teaser (homepage) — first schedule item + link to find.html
  function renderFindTeaser(){
    const teaser = document.getElementById('find-teaser');
    if (!teaser) return;
    const items = state.schedule || [];
    if (items.length === 0) { teaser.innerHTML = '<p>Schedule coming soon!</p>'; return; }
    const next = items[0];
    teaser.innerHTML = `
      <div class="stop-card">
        <div class="day">${next.day||''}</div>
        <div class="place">${next.place||''}</div>
        <div class="time">${next.time||''}</div>
        ${next.address ? `<button class="directions-btn" id="teaser-directions-btn">📍 Get Directions</button>` : ''}
      </div>
    `;
    const btn = document.getElementById('teaser-directions-btn');
    if (btn) btn.addEventListener('click', () => openDirectionsChooser(next));
  }

  // ---------- Directions chooser (Google Maps vs Apple Maps) ----------
  function openDirectionsChooser(stop){
    const address = stop.address || stop.place || '';
    const encoded = encodeURIComponent(address);
    const overlay = document.getElementById('directions-overlay');
    if (!overlay) return;
    document.getElementById('directions-place-name').textContent = stop.place || address;
    document.getElementById('directions-google-link').href = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
    document.getElementById('directions-apple-link').href = `https://maps.apple.com/?daddr=${encoded}`;
    overlay.style.display = 'flex';
  }
  const directionsCloseBtn = document.getElementById('directions-close-btn');
  if (directionsCloseBtn) directionsCloseBtn.addEventListener('click', () => {
    document.getElementById('directions-overlay').style.display = 'none';
  });

  // ---------- Photo collage (About page) ----------
  let collageEditIndex = null;
  function renderCollage(editMode){
    const grid = document.getElementById('about-collage');
    if (!grid) return;
    const photos = (state.images && state.images.collage) || [];
    grid.innerHTML = photos.map((src, i) => `
      <div class="collage-item">
        ${editMode ? `<button class="remove-item-btn" data-collage-remove="${i}">&times;</button>` : ''}
        <img src="${src}" alt="Photo of Penny" class="${editMode ? 'editable-img' : ''}" data-collage-replace="${i}">
      </div>
    `).join('');
    const parent = grid.parentElement;
    parent.querySelectorAll('.add-item-btn').forEach(b => b.remove());
    if (editMode) {
      grid.querySelectorAll('[data-collage-replace]').forEach(img => {
        img.title = 'Click to replace this photo';
        img.addEventListener('click', () => {
          collageEditIndex = parseInt(img.dataset.collageReplace, 10);
          document.getElementById('file-collage').click();
        });
      });
      const btn = document.createElement('button');
      btn.className = 'add-item-btn';
      btn.textContent = '+ Add photo';
      btn.onclick = () => {
        collageEditIndex = -1;
        document.getElementById('file-collage').click();
      };
      parent.appendChild(btn);
    }
  }

  function renderAll(editMode){
    renderStatic();
    renderNews(editMode);
    renderMenu(editMode);
    renderMenuTeaser();
    renderSchedule(editMode);
    renderFindTeaser();
    renderCollage(editMode);
  }

  function markDirty(){
    dirty = true;
    const el = document.getElementById('admin-status');
    if (el) el.textContent = 'Unsaved changes';
  }
  function markClean(msg){
    dirty = false;
    const el = document.getElementById('admin-status');
    if (el) el.textContent = msg || 'All changes saved';
  }

  // ---------- Enable edit mode ----------
  function enableEditMode(session){
    document.body.classList.add('admin-edit-mode');
    document.getElementById('admin-toolbar').style.display = 'flex';
    document.getElementById('admin-status').textContent = `Editing as ${session.email}`;

    renderAll(true);

    // Make simple bound text elements editable
    document.querySelectorAll('[data-bind]').forEach(el => {
      el.contentEditable = 'true';
      el.addEventListener('input', () => {
        setDeep(state, el.dataset.bind, el.innerHTML.includes('<') ? el.innerHTML : el.textContent);
        markDirty();
      });
    });

    // Event delegation for list field edits + removals
    document.addEventListener('input', (e) => {
      const { list, field, index } = e.target.dataset;
      if (list && field && index !== undefined) {
        state[list][index][field] = e.target.textContent;
        markDirty();
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-item-btn')) {
        const { list, index, collageRemove } = e.target.dataset;
        if (collageRemove !== undefined) {
          state.images = state.images || {};
          state.images.collage = state.images.collage || [];
          state.images.collage.splice(parseInt(collageRemove,10), 1);
          markDirty();
          renderCollage(true);
          return;
        }
        state[list].splice(parseInt(index,10), 1);
        markDirty();
        if (list === 'news') renderNews(true);
        if (list === 'menu') renderMenu(true);
        if (list === 'schedule') renderSchedule(true);
      }
    });

    // Images — click to replace
    const imageMap = { 'nav-logo-img': 'navLogo', 'truck-img': 'truck', 'about-photo-img': 'aboutPhoto' };
    Object.entries(imageMap).forEach(([imgId, key]) => {
      const img = document.getElementById(imgId);
      if (!img) return;
      img.classList.add('editable-img');
      img.title = 'Click to replace this image';
      img.addEventListener('click', () => document.getElementById('file-' + key).click());
    });
    ['navLogo','truck','aboutPhoto'].forEach(key => {
      const fileInput = document.getElementById('file-' + key);
      if (!fileInput) return;
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          state.images = state.images || {};
          state.images[key] = ev.target.result;
          const targetId = Object.keys(imageMap).find(k => imageMap[k] === key);
          const targetEl = document.getElementById(targetId);
          if (targetEl) targetEl.src = ev.target.result;
          markDirty();
        };
        reader.readAsDataURL(file);
      });
    });

    // Photo collage — replace or add via the shared hidden file input
    const collageFileInput = document.getElementById('file-collage');
    if (collageFileInput) {
      collageFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          state.images = state.images || {};
          state.images.collage = state.images.collage || [];
          if (collageEditIndex === -1) {
            state.images.collage.push(ev.target.result);
          } else {
            state.images.collage[collageEditIndex] = ev.target.result;
          }
          markDirty();
          renderCollage(true);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      });
    }

    // Social links — click to edit URL instead of navigating
    document.querySelectorAll('[data-social-key]').forEach(link => {
      link.classList.add('editable-link');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const key = link.dataset.socialKey;
        const current = state.social?.[key] || '';
        const next = prompt('Enter the URL for this link:', current);
        if (next !== null) {
          state.social = state.social || {};
          state.social[key] = next;
          link.href = next;
          markDirty();
        }
      });
    });

    // Save — commits directly to GitHub so the live site updates automatically
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('admin-status');
      const saveBtn = document.getElementById('edit-save-btn');
      saveBtn.disabled = true;
      statusEl.textContent = 'Saving…';
      try {
        await commitContentJson(state);
        markClean('✅ Saved! Live in about a minute.');
      } catch (err) {
        console.error(err);
        statusEl.textContent = '⚠️ ' + err.message;
        if (confirm('Auto-save failed: ' + err.message + '\n\nDownload a backup content.json instead?')) {
          downloadContentJsonBackup();
        }
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Sign out
    document.getElementById('edit-signout-btn').addEventListener('click', () => {
      if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
      localStorage.removeItem('pptAdminSession');
      location.reload();
    });

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ---------- Load content, then render ----------
  fetch('content.json?_=' + Date.now(), { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error('content.json not found (status ' + res.status + ')');
      return res.json();
    })
    .then(data => {
      state = data;
      const session = getAdminSession();
      if (session) {
        enableEditMode(session);
      } else {
        renderAll(false);
      }
    })
    .catch(err => console.error('Could not load content.json', err));
