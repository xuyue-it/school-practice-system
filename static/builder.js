/* static/builder.js */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {

    /* ---------- 工具：安全绑定 ---------- */
    function bind(el, evt, handler, opts) {
      if (el && el.addEventListener) el.addEventListener(evt, handler, opts || false);
    }

    /* ---------- 读取 PREFILL（后端放到隐藏域） ---------- */
    function safeJSON(txt, fallback) {
      try {
        const j = JSON.parse(String(txt || 'null'));
        return (j && typeof j === 'object') ? j : (fallback || null);
      } catch { return (fallback || null); }
    }
    const PREFILL = (function () {
      const h = document.getElementById('schema_json');
      if (!h) return null;
      const raw = h.value || h.getAttribute('value') || '';
      return safeJSON(raw, null);
    })();

    /* ---------- 基础 Schema ---------- */
    const schemaDefault = {
      bg: null, bg_color: null,
      fields: [],
      theme: { brand: '#2563eb', appearance: 'auto' },
      settings: {
        publish: { is_published: true, start_at: '', end_at: '', require_login: false, visibility: 'public', allowed_domains: '', whitelist: '' },
        submission: { per_user_limit: 0, per_ip_daily_limit: 0, max_total: 0, duplicate_keys: '', require_review: false, enable_captcha: false },
        upload: { allowed_file_types: 'jpg,png,pdf', max_file_mb: 5, image_quality: 0.85, image_max_w: 1600 },
        display: { success_message: '提交成功，感谢填写', redirect_url: '', bg_style: 'gradient' },
        notify: { email_to: '', webhook_url: '', export_datefmt: 'YYYY-MM-DD HH:mm', export_timezone: 'Asia/Shanghai' },
        privacy: { require_consent: false, consent_url: '' }
      }
    };

    function uid() { return 'q' + Math.random().toString(36).slice(2, 9); }
    function defaultQuestions() {
      return [
        { id: uid(), type: 'text', required: true, labelHTML: '姓名', options: [], image: null },
        { id: uid(), type: 'email', required: true, labelHTML: '电子邮箱', options: [], image: null },
      ];
    }

    let schema = JSON.parse(JSON.stringify(schemaDefault));
    if (PREFILL) {
      // 合并 PREFILL
      for (const k in PREFILL) if (Object.prototype.hasOwnProperty.call(PREFILL, k)) schema[k] = PREFILL[k];
      if (!schema.fields) schema.fields = [];
      if (!schema.theme) schema.theme = { brand: '#2563eb', appearance: 'auto' };
      if (!schema.settings) schema.settings = JSON.parse(JSON.stringify(schemaDefault.settings));
      if (!schema.settings.display) schema.settings.display = {};
      if (schema.settings.display.bg_style == null) schema.settings.display.bg_style = 'gradient';
    } else {
      schema.fields = defaultQuestions();
    }
    if (!Array.isArray(schema.fields)) schema.fields = [];
    if (!schema.fields.length) schema.fields = defaultQuestions();

    /* ---------- 全局 DOM ---------- */
    const list = document.getElementById('list');
    const addBtn = document.getElementById('addBtn');
    const colorPicker = document.getElementById('colorPicker');
    const bgPicker = document.getElementById('bgPicker');
    const btnTheme = document.getElementById('btnTheme');
    const btnPreview = document.getElementById('btnPreview');
    const previewModal = document.getElementById('previewModal');
    const previewRoot = document.getElementById('previewRoot');
    const linkModal = document.getElementById('linkModal');
    const pubUrlInput = document.getElementById('pubUrl');
    const copyPub = document.getElementById('copyPub');
    const railAdd = document.getElementById('railAdd');
    const railImage = document.getElementById('railImage');
    const form = document.getElementById('builder');

    /* ---------- 亮/暗 + 主题 ---------- */
    function setBrand(hex) { document.documentElement.style.setProperty('--brand', hex || '#2563eb'); }
    function applyAppearance(mode) {
      const m = (mode || (schema.theme && schema.theme.appearance) || 'auto');
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const finalDark = (m === 'dark') || (m === 'auto' && sysDark);
      document.body.setAttribute('data-appearance', finalDark ? 'dark' : 'light');
    }
    function applyBackground() {
      const style = (schema.settings && schema.settings.display && schema.settings.display.bg_style) ? schema.settings.display.bg_style : 'gradient';
      const hasBg = !!schema.bg;
      const overlay = 'linear-gradient(0deg, rgba(255,255,255,.65), rgba(255,255,255,.65)), ';
      const overlayDark = 'linear-gradient(0deg, rgba(7,11,20,.45), rgba(7,11,20,.45)), ';
      const isDark = document.body.getAttribute('data-appearance') === 'dark';
      if (style === 'image' && hasBg) {
        document.body.style.backgroundImage = (isDark ? overlayDark : overlay) + 'url("' + schema.bg + '")';
      } else if (style === 'solid') {
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = schema.bg_color || (schema.theme ? schema.theme.brand : '#2563eb');
      } else {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundColor = '';
      }
    }
    function applyThemeFromSchema() {
      setBrand((schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb');
      if (colorPicker) colorPicker.value = (schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb';
      applyAppearance((schema.theme && schema.theme.appearance) ? schema.theme.appearance : 'auto');
      applyBackground();
    }

    /* ---------- 图片压缩（前端） ---------- */
    async function compressImage(file, maxW, maxH, quality) {
      return new Promise((resolve, reject) => {
        try {
          const img = new Image();
          const fr = new FileReader();
          fr.onload = function () {
            img.onload = function () {
              const confMax = Number(schema?.settings?.upload?.image_max_w ?? 1600);
              const confQuality = Number(schema?.settings?.upload?.image_quality ?? 0.85);
              maxW = maxW || confMax;
              maxH = maxH || confMax;
              quality = (quality != null ? quality : confQuality);
              if (!(quality >= 0 && quality <= 1)) quality = 0.85;

              let w = img.width, h = img.height, tw = w, th = h;
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h);
                tw = Math.round(w * ratio); th = Math.round(h * ratio);
              }
              const cvs = document.createElement('canvas');
              cvs.width = tw; cvs.height = th;
              const ctx = cvs.getContext('2d');
              ctx.drawImage(img, 0, 0, tw, th);
              resolve(cvs.toDataURL('image/jpeg', quality));
            };
            img.src = fr.result;
          };
          fr.readAsDataURL(file);
        } catch (e) { reject(e); }
      });
    }

    /* ---------- 撤销 / 重做 ---------- */
    let historyStack = [], redoStack = [];
    function pushHistory() {
      historyStack.push(JSON.stringify(schema));
      if (historyStack.length > 100) historyStack.shift();
      redoStack.length = 0;
      scheduleSave(); queueServerSave();
    }
    function undo() {
      if (!historyStack.length) return;
      redoStack.push(JSON.stringify(schema));
      schema = JSON.parse(historyStack.pop());
      render(); syncSettingsUI(); applyThemeFromSchema(); queueServerSave();
    }
    function redo() {
      if (!redoStack.length) return;
      historyStack.push(JSON.stringify(schema));
      schema = JSON.parse(redoStack.pop());
      render(); syncSettingsUI(); applyThemeFromSchema(); queueServerSave();
    }

    /* ---------- Toast ---------- */
    function ensureToastOnTop() {
      let t = document.getElementById('toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        document.body.appendChild(t);
      } else if (t.parentNode !== document.body) {
        document.body.appendChild(t);
      }
      if (!document.getElementById('toast-style')) {
        const s = document.createElement('style');
        s.id = 'toast-style';
        s.textContent = '#toast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-6px);z-index:100000;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .18s ease, transform .18s ease;font-weight:600;}#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}';
        document.head.appendChild(s);
      }
      return t;
    }
    function showToast(msg) {
      const t = ensureToastOnTop();
      t.textContent = msg || '操作成功';
      t.classList.add('show');
      clearTimeout(t.__timer);
      t.__timer = setTimeout(() => t.classList.remove('show'), 1500);
    }

    /* ---------- 渲染问题 ---------- */
    function stripHTML(html) { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent || ''; }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
    function preventRichPaste(el) {
      el.addEventListener('paste', function (e) {
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        e.preventDefault();
        document.execCommand('insertText', false, text);
      });
    }
    function purgeImagesInside(el) { el.querySelectorAll('img').forEach(n => n.remove()); }

    function renderPreview(q) {
      const label = stripHTML(q.labelHTML || '');
      switch (q.type) {
        case 'textarea': return label + '<br><textarea rows="3" style="width:100%"></textarea>';
        case 'email': return label + '<br><input type="email" style="width:100%" placeholder="example@xxx.com">';
        case 'number': return label + '<br><input type="number" style="width:100%">';
        case 'date': return label + '<br><input type="date" style="width:100%">';
        case 'time': return label + '<br><input type="time" style="width:100%">';
        case 'file': return label + '<br><input type="file">';
        case 'radio': return label + '<br>' + ((q.options || []).map(o => '<label style="margin-right:12px"><input type="radio" name="' + q.id + '"> ' + escapeHTML(o) + '</label>').join(''));
        case 'checkbox': return label + '<br>' + ((q.options || []).map(o => '<label style="margin-right:12px"><input type="checkbox"> ' + escapeHTML(o) + '</label>').join(''));
        case 'select': return label + '<br><select style="min-width:200px">' + ((q.options || []).map(o => '<option>' + escapeHTML(o) + '</option>').join('')) + '</select>';
        default: return label + '<br><input type="text" style="width:100%" placeholder="简短回答">';
      }
    }

    function renderCard(q, index) {
      const card = document.createElement('div');
      card.className = 'qcard';
      card.setAttribute('draggable', 'true');
      card.dataset.id = q.id;

      const row = document.createElement('div');
      row.className = 'q-row';

      const title = document.createElement('div');
      title.className = 'q-title';
      title.contentEditable = 'true';
      title.innerHTML = q.labelHTML || '';
      preventRichPaste(title);
      title.addEventListener('input', function () {
        purgeImagesInside(title);
        q.labelHTML = title.innerHTML.trim();
        pushHistory(); sync();
      });

      const tools = document.createElement('div');
      tools.className = 'q-tools';

      const picBtn = document.createElement('label');
      picBtn.className = 'btn gray';
      picBtn.style.padding = '8px 10px';
      picBtn.style.display = 'inline-flex';
      picBtn.style.alignItems = 'center';
      picBtn.style.gap = '6px';
      picBtn.style.whiteSpace = 'nowrap';
      picBtn.title = '插入图片';
      picBtn.innerHTML = '🖼️ <span>图片</span>';
      const picInput = document.createElement('input');
      picInput.type = 'file';
      picInput.accept = 'image/*';
      picInput.style.display = 'none';
      picBtn.appendChild(picInput);
      bind(picInput, 'change', async function (e) {
        const f = e?.target?.files?.[0];
        if (!f) return;
        const dataUrl = await compressImage(f);
        q.image = dataUrl; pushHistory(); render(); scheduleSave(true); queueServerSave();
      });

      const typeSel = document.createElement('select');
      typeSel.className = 'tiny select';
      typeSel.innerHTML = '<option value="text">简短回答</option><option value="textarea">段落</option><option value="email">邮箱</option><option value="number">数字</option><option value="date">日期</option><option value="time">时间</option><option value="radio">单选</option><option value="checkbox">多选</option><option value="select">下拉</option><option value="file">文件上传</option>';
      typeSel.value = q.type || 'text';
      bind(typeSel, 'change', function () {
        q.type = typeSel.value;
        if (['radio', 'checkbox', 'select'].includes(q.type) && !Array.isArray(q.options)) q.options = ['选项 1'];
        pushHistory(); render();
      });

      tools.appendChild(picBtn);
      tools.appendChild(typeSel);
      row.appendChild(title);
      row.appendChild(tools);
      card.appendChild(row);

      const fmt = document.createElement('div');
      fmt.className = 'format';
      function mk(txt, cmd) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'icon'; b.innerHTML = txt;
        bind(b, 'click', function () {
          title.focus();
          if (cmd === 'createLink') {
            const u = prompt('输入链接地址'); if (!u) return; document.execCommand(cmd, false, u);
          } else {
            document.execCommand(cmd, false, null);
          }
          purgeImagesInside(title);
          q.labelHTML = title.innerHTML.trim(); pushHistory(); sync();
        });
        return b;
      }
      fmt.appendChild(mk('<b>B</b>', 'bold'));
      fmt.appendChild(mk('<i>I</i>', 'italic'));
      fmt.appendChild(mk('<u>U</u>', 'underline'));
      fmt.appendChild(mk('<s>S</s>', 'strikeThrough'));
      fmt.appendChild(mk('🔗', 'createLink'));
      card.appendChild(fmt);

      const prev = document.createElement('div');
      prev.className = 'preview';
      prev.innerHTML = renderPreview(q);
      card.appendChild(prev);

      if (q.image) {
        const wrap = document.createElement('div'); wrap.className = 'q-image-wrap';
        const im = document.createElement('img'); im.className = 'q-image'; im.src = q.image; wrap.appendChild(im);
        const del = document.createElement('button'); del.type = 'button'; del.className = 'q-image-del'; del.textContent = '×'; del.title = '删除图片';
        bind(del, 'click', function () {
          q.image = null; pushHistory(); render(); scheduleSave(true); queueServerSave(); showToast('已删除题图');
        });
        wrap.appendChild(del);
        card.appendChild(wrap);
      }

      if (['radio', 'checkbox', 'select'].includes(q.type)) {
        if (!Array.isArray(q.options)) q.options = [];
        const cont = document.createElement('div');
        (q.options || []).forEach(function (opt, i) {
          const line = document.createElement('div'); line.className = 'option-row';
          const icon = document.createElement('span'); icon.textContent = (q.type === 'radio' ? '⭕' : '☑️');
          const inp = document.createElement('input'); inp.className = 'tiny'; inp.value = opt;
          bind(inp, 'input', function () { q.options[i] = inp.value; sync(); queueServerSave(); });
          const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.textContent = '🗑️';
          bind(del, 'click', function () { q.options.splice(i, 1); pushHistory(); render(); });
          line.appendChild(icon); line.appendChild(inp); line.appendChild(del);
          cont.appendChild(line);
        });
        const addop = document.createElement('button'); addop.type = 'button'; addop.className = 'btn'; addop.textContent = '添加选项';
        bind(addop, 'click', function () { q.options.push('选项 ' + ((q.options?.length || 0) + 1)); pushHistory(); render(); });
        cont.appendChild(addop);
        card.appendChild(cont);
      }

      const foot = document.createElement('div'); foot.className = 'q-footer';
      const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'icon-btn'; copyBtn.textContent = '📄'; copyBtn.title = '复制';
      bind(copyBtn, 'click', function () {
        const cp = JSON.parse(JSON.stringify(q)); cp.id = uid();
        schema.fields.splice(index + 1, 0, cp); pushHistory(); render(); showToast('已复制问题');
      });
      const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'icon-btn'; delBtn.textContent = '🗑️'; delBtn.title = '删除';
      bind(delBtn, 'click', function () { schema.fields.splice(index, 1); pushHistory(); render(); showToast('已删除问题'); });
      const reqWrap = document.createElement('label'); reqWrap.className = 'switch'; reqWrap.innerHTML = '<input type="checkbox" ' + (q.required ? 'checked' : '') + '><span>必填</span>';
      bind(reqWrap.querySelector('input'), 'change', function (e) { q.required = e.target.checked; pushHistory(); sync(); showToast('已更新必填'); });
      foot.appendChild(copyBtn); foot.appendChild(delBtn); foot.appendChild(reqWrap);
      card.appendChild(foot);

      // 拖拽排序
      bind(card, 'dragstart', function (e) { card.classList.add('dragging'); e.dataTransfer.setData('text/plain', q.id); });
      bind(card, 'dragend', function () { card.classList.remove('dragging'); });
      bind(card, 'dragover', function (e) {
        e.preventDefault();
        const dragging = document.querySelector('.qcard.dragging'); if (!dragging) return;
        const after = getDragAfterElement(list, e.clientY);
        if (after == null) list.appendChild(dragging); else list.insertBefore(dragging, after);
      });
      bind(card, 'drop', function (e) { e.preventDefault(); reorderByDom(); showToast('已排序'); });

      return card;
    }
    function getDragAfterElement(container, y) {
      const els = Array.from(container.querySelectorAll('.qcard:not(.dragging)'));
      return els.reduce(function (closest, child) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    function reorderByDom() {
      const ids = Array.from(list.querySelectorAll('.qcard')).map(x => x.dataset.id);
      schema.fields.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      pushHistory(); sync();
    }

    function render() {
      list.innerHTML = '';
      schema.fields = Array.isArray(schema.fields) ? schema.fields : [];
      schema.fields.forEach((q, idx) => list.appendChild(renderCard(q, idx)));
      sync();
    }

    /* ---------- 同步 schema 到隐藏域 ---------- */
    function sync() {
      schema.theme = schema.theme || {};
      const currentBrand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#2563eb';
      schema.theme.brand = currentBrand;
      const hidden = document.getElementById('schema_json');
      if (hidden) hidden.value = JSON.stringify(schema, null, 2);
      scheduleSave();
    }

    /* ---------- 设置面板绑定 ---------- */
    function setByPath(obj, path, val) {
      const keys = path.split('.');
      let cur = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = val;
    }
    function getByPath(obj, path) {
      const keys = path.split('.'); let cur = obj;
      for (let i = 0; i < keys.length; i++) { if (cur == null) return undefined; cur = cur[keys[i]]; }
      return cur;
    }
    function bindSettings() {
      const nodes = document.querySelectorAll('[data-skey]');
      nodes.forEach(el => {
        const key = el.getAttribute('data-skey');
        let val = getByPath(schema.settings, key) ?? getByPath(schema, key);
        if (el.type === 'checkbox') el.checked = !!val; else if (val != null) el.value = String(val);
        bind(el, 'input', function () {
          const v = (el.type === 'checkbox') ? el.checked : el.value;
          if (key.startsWith('theme.')) {
            setByPath(schema, key, v);
            if (key === 'theme.appearance') { applyAppearance(v); applyBackground(); }
          } else {
            setByPath(schema.settings, key, v);
            if (key === 'display.bg_style') applyBackground();
          }
          sync(); queueServerSave();
        });
      });
    }
    function syncSettingsUI() {
      const nodes = document.querySelectorAll('[data-skey]');
      nodes.forEach(el => {
        const key = el.getAttribute('data-skey');
        let val = key.startsWith('theme.') ? getByPath(schema, key) : getByPath(schema.settings, key);
        if (el.type === 'checkbox') el.checked = !!val; else el.value = (val == null ? '' : val);
      });
      if (colorPicker) colorPicker.value = (schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb';
    }

    /* ---------- 本地草稿 ---------- */
    function draftKey(sn) {
      const name = (typeof sn === 'string' ? sn : (document.querySelector('input[name=site_name]') || {}).value || '').trim();
      return 'form_builder_draft:' + (name || 'new');
    }
    let __saveTimer = null;
    function scheduleSave(force) { if (force) { doSave(); return; } clearTimeout(__saveTimer); __saveTimer = setTimeout(doSave, 600); }
    function doSave() {
      try {
        const payload = {
          ts: Date.now(),
          form_name: (document.querySelector('input[name=form_name]') || {}).value || '',
          site_name: (document.querySelector('input[name=site_name]') || {}).value || '',
          form_desc: (document.querySelector('textarea[name=form_desc]') || {}).value || '',
          schema: schema || {}
        };
        localStorage.setItem(draftKey(payload.site_name), JSON.stringify(payload));
      } catch { }
    }
    // 初次不覆盖后端数据
    (function loadDraft() {
      if (PREFILL && typeof PREFILL === 'object') return;
      try {
        const sn = document.querySelector('input[name=site_name]');
        const site = (sn && sn.value || '').trim();
        if (!site) return;
        const raw = localStorage.getItem(draftKey(site));
        if (!raw) return;
        const data = JSON.parse(raw);
        const fn = document.querySelector('input[name=form_name]');
        const fd = document.querySelector('textarea[name=form_desc]');
        if (fn) fn.value = data.form_name || '';
        if (fd) fd.value = data.form_desc || '';
        if (data.schema && typeof data.schema === 'object') schema = data.schema;
      } catch { }
    })();
    (function watchSite() {
      const sn = document.querySelector('input[name=site_name]'); if (!sn) return;
      let last = draftKey(sn.value || 'new');
      bind(sn, 'input', function (e) {
        const nk = draftKey(e.target.value || 'new');
        if (nk !== last) {
          try {
            const raw = localStorage.getItem(last);
            if (raw) { localStorage.setItem(nk, raw); localStorage.removeItem(last); }
          } catch { }
          last = nk;
        }
        scheduleSave(); queueServerSave();
      });
    })();
    ['input', 'change'].forEach(ev => {
      const fn = document.querySelector('input[name=form_name]');
      const sn = document.querySelector('input[name=site_name]');
      const fd = document.querySelector('textarea[name=form_desc]');
      bind(fn, ev, () => { scheduleSave(); queueServerSave(); });
      bind(sn, ev, () => { scheduleSave(); queueServerSave(); });
      bind(fd, ev, () => { scheduleSave(); queueServerSave(); });
    });
    bind(window, 'beforeunload', () => { try { doSave(); } catch { } });

    /* ---------- Tabs：进入“数据”页时再请求 ---------- */
    Array.from(document.querySelectorAll('.tabs button')).forEach(b => {
      bind(b, 'click', async function () {
        Array.from(document.querySelectorAll('.tabs button')).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        Array.from(document.querySelectorAll('.tab')).forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + b.dataset.tab)?.classList.add('active');

        if (b.dataset.tab === 'responses') {
          await ensureServerSaved();
          rebuildRespHeader();
          loadResponses();
        }
      });
    });

    /* ---------- 事件：新增、主题、背景、右栏按钮、撤销/重做、预览 ---------- */
    bind(railAdd, 'click', function () { addBtn?.click(); });
    bind(addBtn, 'click', function () {
      schema.fields.push({ id: uid(), type: 'text', required: false, labelHTML: '新问题', options: [], image: null });
      pushHistory(); render(); showToast('已添加问题');
    });

    bind(bgPicker, 'change', async function (e) {
      const f = e?.target?.files?.[0]; if (!f) return;
      const dataUrl = await compressImage(f, 1920, 1080, Number(schema?.settings?.upload?.image_quality ?? 0.85));
      schema.bg = dataUrl; applyBackground(); pushHistory(); sync(); showToast('背景已更新'); queueServerSave();
    });

    bind(btnTheme, 'click', function () {
      const cur = (schema.theme && schema.theme.appearance) ? schema.theme.appearance : 'auto';
      const next = (cur === 'light') ? 'dark' : (cur === 'dark' ? 'auto' : 'light');
      schema.theme.appearance = next;
      applyAppearance(next); applyBackground(); sync(); queueServerSave();
      showToast('外观已切换为：' + (next === 'auto' ? '跟随系统' : next));
    });

    bind(document.getElementById('railTitle'), 'click', function () {
      schema.fields.push({ id: uid(), type: 'text', required: false, labelHTML: '标题', options: [] });
      pushHistory(); render(); showToast('已添加标题');
    });
    bind(railImage, 'change', async function (e) {
      const f = e?.target?.files?.[0]; if (!f) return;
      const dataUrl = await compressImage(f);
      schema.fields.push({ id: uid(), type: 'text', required: false, labelHTML: '', options: [], image: dataUrl });
      pushHistory(); render(); scheduleSave(true); queueServerSave(); showToast('已插入图片');
    });

    bind(document.getElementById('btnUndo'), 'click', function () { undo(); showToast('已撤销'); });
    bind(document.getElementById('btnRedo'), 'click', function () { redo(); showToast('已重做'); });

    bind(btnPreview, 'click', function () {
      if (!previewModal || !previewRoot) return;
      previewRoot.innerHTML = '';
      const h = document.createElement('div'); h.className = 'card';
      h.innerHTML = '<div class="hd"><h2>' + ((document.querySelector('input[name=form_name]') || {}).value || '（未命名表单）') + '</h2></div><div class="bd"><div class="muted">' + ((document.querySelector('textarea[name=form_desc]') || {}).value || '') + '</div></div>';
      previewRoot.appendChild(h);
      const wrap = document.createElement('div'); wrap.className = 'card'; wrap.innerHTML = '<div class="hd"><h2>问题</h2></div>'; const body = document.createElement('div'); body.className = 'bd';
      schema.fields.forEach(function (q) {
        const block = document.createElement('div'); block.className = 'qcard';
        let inner = '<div class="preview">' + renderPreview(q) + '</div>';
        if (q.image) inner += '<div class="q-image-wrap"><img class="q-image" src="' + q.image + '"></div>';
        block.innerHTML = inner; body.appendChild(block);
      });
      wrap.appendChild(body); previewRoot.appendChild(wrap);
      previewModal.classList.add('show');
    });
    bind(document.getElementById('closePreview'), 'click', function () { previewModal?.classList.remove('show'); });
    bind(previewModal, 'click', function (e) { if (e.target === previewModal) previewModal.classList.remove('show'); });

    /* ---------- 保存（表单 Ajax 提交，确保 ?ajax=1） ---------- */
    (function ensureAjaxParam() {
      if (!form) return;
      const u = form.action || '';
      if (!/([?&])ajax=1($|&)/.test(u)) form.action = u + (u.indexOf('?') > -1 ? '&' : '?') + 'ajax=1';
    })();

    bind(form, 'submit', async function (e) {
      e.preventDefault();
      sync();
      const fd = new FormData(form);
      try {
        const resp = await fetch(form.action, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
        const ct = resp.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await resp.json() : null;
        if (!resp.ok || !data || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + resp.status));

        // 保存成功：写入 site / 公开链接
        document.body.dataset.site = data.site_name || document.body.dataset.site || '';
        const toAbs = u => u ? new URL(u, window.location.href).href : '';
        const pubAbs = toAbs(data.public_url);
        if (pubUrlInput && pubAbs) pubUrlInput.value = pubAbs;

        showToast('保存成功');
      } catch (err) {
        alert('保存失败：' + err.message);
      }
    });

    bind(copyPub, 'click', function () {
      if (!pubUrlInput) return;
      pubUrlInput.select();
      try { document.execCommand('copy'); } catch { navigator.clipboard && navigator.clipboard.writeText(pubUrlInput.value || ''); }
      copyPub.textContent = '已复制'; setTimeout(() => { copyPub.textContent = '复制'; }, 1200);
    });
    bind(document.getElementById('closeLink'), 'click', function () { linkModal?.classList.remove('show'); });

    /* ---------- 自动保存到服务器（静默） ---------- */
    let __serverTimer = null, __savingNow = false;
    function queueServerSave() {
      clearTimeout(__serverTimer);
      __serverTimer = setTimeout(autoSaveToServerSilently, 1200);
    }
    async function ensureServerSaved() {
      if ((document.body.dataset.site || '').trim()) return true;
      await autoSaveToServerSilently(true);
      return !!(document.body.dataset.site || '').trim();
    }
    async function autoSaveToServerSilently(forceNow) {
      if (!form) return;
      if (__savingNow && !forceNow) return;
      const sn = (document.querySelector('input[name=site_name]') || {}).value || '';
      if (!sn.trim()) return;
      __savingNow = true;
      try {
        sync();
        const fd = new FormData(form);
        const res = await fetch(form.action, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
        const ct = res.headers.get('content-type') || '';
        const data = (ct.indexOf('application/json') > -1) ? await res.json() : null;
        if (res.ok && data && data.ok) {
          document.body.dataset.site = data.site_name || document.body.dataset.site || '';
        }
      } catch { }
      __savingNow = false;
    }

    /* ---------- 回复数据页（乱码修复 + 双接口回退） ---------- */
    const thead = document.getElementById('respThead');
    const tbody = document.getElementById('respTbody');
    const qInput = document.getElementById('q');
    const btnSearch = document.getElementById('btnSearch');
    const btnRefresh = document.getElementById('btnRefresh');

    function __labelText(q) { const d = document.createElement('div'); d.innerHTML = (q && q.labelHTML) || ''; return (d.textContent || '').trim(); }
    function normalizeKey(s) { return String(s || '').replace(/[\s_:\-\/（）()\[\]【】<>·.，,。；;:'"|]/g, '').toLowerCase(); }
    function fmtVal(v) {
      if (v == null) return '';
      if (Array.isArray(v)) return v.map(fmtVal).filter(Boolean).join('、');
      if (typeof v === 'object') {
        try {
          if (v.url) return '<a href="' + String(v.url).replace(/"/g, '&quot;') + '" target="_blank">查看</a>';
          if ('value' in v) return String(v.value);
          return String(JSON.stringify(v));
        } catch { return String(v); }
      }
      const s = String(v);
      if (/^https?:/i.test(s) && /\.(png|jpe?g|gif|webp|bmp)$/i.test(s)) return '<a href="' + s.replace(/"/g, '&quot;') + '" target="_blank">图片</a>';
      if (/^https?:/i.test(s)) return '<a href="' + s.replace(/"/g, '&quot;') + '" target="_blank">链接</a>';
      return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 固定字段的题目ID识别（用于友好列名）
    function getFixedFieldIds() {
      function fid(keys) {
        keys = Array.isArray(keys) ? keys : [keys];
        const f = (schema.fields || []).find(q => {
          const t = __labelText(q);
          return keys.some(k => t.includes(k));
        });
        return f ? f.id : null;
      }
      return {
        name: fid(['姓名', '名字', '称呼', 'name', 'Name']),
        phone: fid(['电话', '手机', '手机号', '联系电话', 'phone', 'tel', '联系方式', '電話']),
        email: fid(['邮箱', '电子邮箱', 'email', 'Email', '郵箱']),
        group: fid(['团体', '团队', '单位', '公司', '学校', '组织', '小组', 'group']),
        event: fid(['活动名', '活动名称', '活动', '课程', '会议', 'event']),
        startDate: fid(['开始日期', '起始日期', 'start date']),
        startTime: fid(['开始时间', 'start time']),
        endDate: fid(['结束日期', '截止日期', 'end date']),
        endTime: fid(['结束时间', 'end time']),
        people: fid(['人数', '参与人数', '报名人数', '人数（人）', 'participants'])
      };
    }

    function valueByQuestion(d, q) {
      if (!d || !q) return '';
      const label = __labelText(q);
      if (q.id != null && Object.prototype.hasOwnProperty.call(d, q.id) && d[q.id] != null && d[q.id] !== '') return d[q.id];
      if (label && Object.prototype.hasOwnProperty.call(d, label) && d[label] != null && d[label] !== '') return d[label];
      const want = normalizeKey(label);
      let hit = '';
      Object.keys(d || {}).some(k => {
        if (normalizeKey(k) === want) { hit = d[k]; return true; }
        return false;
      });
      return hit;
    }

    let __dynFieldIds = [];
    function rebuildRespHeader() {
      const head = document.querySelector('#respTable thead');
      if (!head) return;
      // 先尝试按 schema 组装；后端列定义在 loadResponses 里也会覆盖
      const headRow = document.createElement('tr');

      const fixed = getFixedFieldIds();
      const exclude = new Set(Object.values(fixed).filter(Boolean));
      __dynFieldIds = (schema.fields || []).filter(q => !exclude.has(q.id)).map(q => q.id);

      const before = [['ID', 'ID']];
      if (fixed.name) before.push(['姓名', '姓名']);
      if (fixed.phone) before.push(['电话', '电话']);
      if (fixed.email) before.push(['邮箱', '邮箱']);
      if (fixed.group) before.push(['团体', '团体']);
      if (fixed.event) before.push(['活动名', '活动名']);
      if (fixed.startDate || fixed.startTime) before.push(['开始', '开始']);
      if (fixed.endDate || fixed.endTime) before.push(['结束', '结束']);
      if (fixed.people) before.push(['人数', '人数']);

      before.forEach(([t]) => {
        const th = document.createElement('th'); th.textContent = t; headRow.appendChild(th);
      });

      __dynFieldIds.forEach(fid => {
        const q = (schema.fields || []).find(x => x.id === fid);
        const th = document.createElement('th'); th.textContent = __labelText(q) || ('字段' + fid);
        headRow.appendChild(th);
      });

      ['状态', '审核说明', '导出', '发送邮件', '删除'].forEach(t => {
        const th = document.createElement('th'); th.textContent = t; headRow.appendChild(th);
      });

      thead.innerHTML = ''; thead.appendChild(headRow);
    }

    async function loadResponses() {
      let site = (document.body.dataset.site || '').trim();
      const colsCount = document.querySelectorAll('#respTable thead th').length || 14;

      async function fetchJSON(url, opt) {
        const r = await fetch(url, opt);
        const ct = r.headers.get('content-type') || '';
        const j = ct.includes('application/json') ? await r.json() : null;
        return { ok: r.ok, data: j, status: r.status };
      }

      if (!site) {
        tbody.innerHTML = '<tr><td colspan="' + colsCount + '" class="muted">正在自动保存表单以加载数据…</td></tr>';
        await ensureServerSaved();
        site = (document.body.dataset.site || '').trim();
        if (!site) {
          tbody.innerHTML = '<tr><td colspan="' + colsCount + '" class="muted">请先在上方填写“网站名”，系统会自动保存后再加载数据</td></tr>';
          return;
        }
      }

      // 先试 /responses，再回退 /list
      const base = '/site/' + encodeURIComponent(site) + '/admin/api/';
      const q = encodeURIComponent(qInput?.value || '');
      let url1 = base + 'responses?q=' + q;
      let url2 = base + 'list?query=' + q;

      // 拉数据
      let hit = await fetchJSON(url1);
      if (!hit.ok || !hit.data || !Array.isArray(hit.data.items)) {
        hit = await fetchJSON(url2);
      }

      if (!hit.ok) {
        tbody.innerHTML = '<tr><td colspan="' + colsCount + '">加载失败：HTTP ' + hit.status + '</td></tr>';
        return;
      }
      const payload = hit.data || {};
      const items = payload.items || payload.rows || [];

      // 表头：优先后端 columns/titleMap
      if (payload.columns || payload.headers || payload.titleMap || payload.labels) {
        const cols = payload.columns || payload.headers || [];
        const map = payload.titleMap || payload.labels || {};
        const row = document.createElement('tr');
        if (cols.length) {
          row.appendChild(th('ID'));
          cols.forEach(c => row.appendChild(th(c.title || c.label || c.text || c.name || c.key)));
          ['状态', '审核说明', '导出', '发送邮件', '删除'].forEach(t => row.appendChild(th(t)));
          thead.innerHTML = ''; thead.appendChild(row);
          __dynFieldIds = cols.map(c => c.key || c.id || c.name).filter(Boolean);
        } else if (Object.keys(map).length) {
          row.appendChild(th('ID'));
          Object.keys(map).forEach(k => row.appendChild(th(String(map[k] || k))));
          ['状态', '审核说明', '导出', '发送邮件', '删除'].forEach(t => row.appendChild(th(t)));
          thead.innerHTML = ''; thead.appendChild(row);
          __dynFieldIds = Object.keys(map);
        } else {
          rebuildRespHeader();
        }
      } else {
        rebuildRespHeader();
      }

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="' + (document.querySelectorAll('#respTable thead th').length || 14) + '" class="muted">暂无数据</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      const fixed = getFixedFieldIds();
      function qById(id) { return (schema.fields || []).find(x => x.id === id); }

      items.forEach(row => {
        const d = row.data || {};
        const tr = document.createElement('tr');

        const name = fmtVal(valueByQuestion(d, qById(fixed.name)));
        const phone = fmtVal(valueByQuestion(d, qById(fixed.phone)));
        const email = fmtVal(valueByQuestion(d, qById(fixed.email)));
        const group = fmtVal(valueByQuestion(d, qById(fixed.group)));
        const eventN = fmtVal(valueByQuestion(d, qById(fixed.event)));
        const start = [valueByQuestion(d, qById(fixed.startDate)), valueByQuestion(d, qById(fixed.startTime))].map(fmtVal).filter(Boolean).join(' ');
        const end = [valueByQuestion(d, qById(fixed.endDate)), valueByQuestion(d, qById(fixed.endTime))].map(fmtVal).filter(Boolean).join(' ');
        const people = fmtVal(valueByQuestion(d, qById(fixed.people)));

        const tds = [];
        function pushTD(v) { tds.push('<td>' + (v || '—') + '</td>'); }
        // 固定列
        if (fixed.name) pushTD(name);
        if (fixed.phone) pushTD(phone);
        if (fixed.email) pushTD(email);
        if (fixed.group) pushTD(group);
        if (fixed.event) pushTD(eventN);
        if (fixed.startDate || fixed.startTime) pushTD(start);
        if (fixed.endDate || fixed.endTime) pushTD(end);
        if (fixed.people) pushTD(people);

        // 动态列
        const dyn = (__dynFieldIds || []).map(fid => {
          const q = (schema.fields || []).find(x => x.id === fid);
          return '<td>' + (fmtVal(valueByQuestion(d, q)) || '—') + '</td>';
        }).join('');

        const pill = row.status === '已通过' ? '<span class="pill good">通过</span>' :
          (row.status === '未通过' ? '<span class="pill bad">不通过</span>' : '<span class="pill wait">待审核</span>');

        tr.innerHTML =
          '<td>' + row.id + '</td>' +
          tds.join('') +
          dyn +
          '<td>' + pill + '</td>' +
          '<td><input class="tiny" style="width:160px" placeholder="审核说明" value="' + (row.review_comment || '') + '" data-cid="' + row.id + '"></td>' +
          '<td><a class="btn gray" href="/site/' + site + '/admin/export_word/' + row.id + '" target="_blank">Word</a> ' +
          '<a class="btn gray" href="/site/' + site + '/admin/export_excel/' + row.id + '" target="_blank">Excel</a></td>' +
          '<td><button class="btn" data-mail="' + row.id + '">发送邮件</button></td>' +
          '<td><button class="btn danger" data-del="' + row.id + '">删除</button></td>';

        tbody.appendChild(tr);

        const commentInput = tr.querySelector('input[data-cid="' + row.id + '"]');
        const opDiv = document.createElement('div');
        opDiv.style.display = 'flex'; opDiv.style.gap = '6px'; opDiv.style.marginTop = '6px';

        const passBtn = document.createElement('button'); passBtn.className = 'btn'; passBtn.style.background = 'linear-gradient(180deg,#22c55e,#16a34a)'; passBtn.style.color = '#fff'; passBtn.textContent = '通过';
        const failBtn = document.createElement('button'); failBtn.className = 'btn'; failBtn.style.background = 'linear-gradient(180deg,#ef4444,#b91c1c)'; failBtn.style.color = '#fff'; failBtn.textContent = '不通过';
        opDiv.appendChild(passBtn); opDiv.appendChild(failBtn);
        commentInput.parentNode.appendChild(opDiv);

        bind(passBtn, 'click', async function () { await updateStatus(site, row.id, '已通过', commentInput.value); showToast('已标记通过'); });
        bind(failBtn, 'click', async function () { await updateStatus(site, row.id, '未通过', commentInput.value); showToast('已标记不通过'); });
        bind(tr.querySelector('[data-del="' + row.id + '"]'), 'click', async function () { if (!confirm('确认删除该记录？')) return; await delRow(site, row.id); showToast('已删除'); });
        bind(tr.querySelector('[data-mail="' + row.id + '"]'), 'click', async function () {
          const subject = prompt('邮件主题：', '您在本表单的申请结果通知'); if (subject === null) return;
          const body = prompt('邮件内容：', '你好，您的申请已处理。'); if (body === null) return;
          try {
            const r = await fetch('/site/' + site + '/admin/api/send_email/' + row.id, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, body })
            });
            const d2 = await r.json();
            if (!r.ok || !d2.ok) { alert('发送失败：' + (d2.error || r.status)); return; }
            showToast('邮件已发送');
          } catch (err) { alert('发送失败：' + err.message); }
        });
      });

      function th(text) { const el = document.createElement('th'); el.textContent = text; return el; }
    }

    async function updateStatus(site, id, status, comment) {
      const r = await fetch('/site/' + site + '/admin/api/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, review_comment: comment || '' })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { alert('操作失败：' + (d.error || r.status)); return; }
      loadResponses();
    }

    async function delRow(site, id) {
      const r = await fetch('/site/' + site + '/admin/api/delete/' + id, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok || !d.ok) { alert('删除失败：' + (d.error || r.status)); return; }
      loadResponses();
    }

    bind(document.getElementById('btnExportAll'), 'click', function () {
      const site = (document.body.dataset.site || '').trim(); if (!site) { alert('请先填写网站名，系统会自动保存'); return; }
      location.href = '/site/' + site + '/admin/api/export_all_excel'; showToast('已开始导出');
    });
    bind(document.getElementById('btnGallery'), 'click', async function () {
      const site = (document.body.dataset.site || '').trim(); if (!site) { alert('请先填写网站名，系统会自动保存'); return; }
      const r = await fetch('/site/' + site + '/admin/api/gallery'); const d = await r.json();
      if (!r.ok || !Array.isArray(d.items)) { alert('加载失败'); return; }
      const galleryRoot = document.getElementById('galleryRoot'); if (galleryRoot) galleryRoot.innerHTML = '';
      d.items.forEach(it => {
        const a = document.createElement('a'); a.href = it.url; a.download = ''; a.title = '点击下载';
        const img = new Image(); img.src = it.url; img.style.width = '160px'; img.style.height = '120px'; img.style.objectFit = 'cover'; img.style.borderRadius = '10px';
        a.appendChild(img); galleryRoot && galleryRoot.appendChild(a);
      });
      const galleryModalEl = document.getElementById('galleryModal'); if (galleryModalEl) galleryModalEl.classList.add('show');
    });
    bind(document.getElementById('closeGallery'), 'click', function () {
      const gm = document.getElementById('galleryModal'); if (gm) gm.classList.remove('show');
    });
    (function () {
      const gm = document.getElementById('galleryModal');
      bind(gm, 'click', function (e) { if (e.target === gm) gm.classList.remove('show'); });
    })();
    bind(btnSearch, 'click', function () { rebuildRespHeader(); loadResponses(); });
    bind(btnRefresh, 'click', function () { rebuildRespHeader(); loadResponses(); });
    if (document.getElementById('autoTick')) {
      setInterval(function () {
        if (document.getElementById('autoTick').checked && document.getElementById('tab-responses').classList.contains('active')) loadResponses();
      }, 30000);
    }

    /* ---------- 初始应用 & 暴露给外部 ---------- */
    applyThemeFromSchema();
    pushHistory(); render(); bindSettings(); syncSettingsUI();

    // 供预览/其他脚本调用
    window.builder = window.builder || {};
    window.builder.getSchema = function () { return JSON.parse(JSON.stringify(schema)); };

    // 供“数据页 rewire”脚本/其他脚本使用
    window.rebuildRespHeader = rebuildRespHeader;
    window.loadResponses = loadResponses;
    window.queueServerSave = queueServerSave;
    window.ensureServerSaved = ensureServerSaved;
  });
})();
