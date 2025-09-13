/* -*- coding: utf-8 -*- */
document.addEventListener('DOMContentLoaded', function(){
  /* —— 新增：识别是否是“创建新表单”模式（?new=1） —— */
  var IS_NEW = new URLSearchParams(location.search).get('new') === '1';
  if (IS_NEW) { document.body.dataset.site = ''; }

  /* =============== 撤销 / 重做 =============== */
  var historyStack=[], redoStack=[];
  function pushHistory(){ historyStack.push(JSON.stringify(schema)); if(historyStack.length>100) historyStack.shift(); redoStack.length=0; scheduleSave(); queueServerSave(); }
  function canUndo(){return historyStack.length>0}
  function canRedo(){return redoStack.length>0}
  function undo(){ if(!canUndo()) return; redoStack.push(JSON.stringify(schema)); schema=JSON.parse(historyStack.pop()); render(); syncSettingsUI(); applyThemeFromSchema(); queueServerSave(); }
  function redo(){ if(!canRedo()) return; historyStack.push(JSON.stringify(schema)); schema=JSON.parse(redoStack.pop()); render(); syncSettingsUI(); applyThemeFromSchema(); queueServerSave(); }

  /* =============== 外观/主题（原功能保留） =============== */
  function setBrand(hex){ document.documentElement.style.setProperty('--brand', hex || '#2563eb'); }
  function applyAppearance(mode){
    var m = mode || (schema.theme && schema.theme.appearance) || 'auto';
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var finalDark = (m==='dark') || (m==='auto' && sysDark);
    document.body.setAttribute('data-appearance', finalDark ? 'dark' : 'light');
  }
  function applyBackground(){
    var style = (schema.settings && schema.settings.display && schema.settings.display.bg_style) ? schema.settings.display.bg_style : 'gradient';
    var hasBg = !!schema.bg;
    var overlay = "linear-gradient(0deg, rgba(255,255,255,.65), rgba(255,255,255,.65)), ";
    var overlayDark = "linear-gradient(0deg, rgba(7,11,20,.45), rgba(7,11,20,.45)), ";
    var isDark = document.body.getAttribute('data-appearance')==='dark';
    if(style==='image' && hasBg){
      document.body.style.backgroundImage = (isDark?overlayDark:overlay) + "url('"+schema.bg+"')";
    }else if(style==='solid'){
      document.body.style.backgroundImage = 'none';
      document.body.style.backgroundColor = schema.bg_color || (schema.theme ? schema.theme.brand : '#2563eb');
    }else{
      document.body.style.backgroundImage = '';
      document.body.style.backgroundColor = '';
    }
  }
  function applyThemeFromSchema(){
    setBrand( (schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb' );
    var cp=document.getElementById('colorPicker'); if(cp){ cp.value = (schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb'; }
    applyAppearance( (schema.theme && schema.theme.appearance) ? schema.theme.appearance : 'auto' );
    applyBackground();
  }

  /* =============== 前端图片压缩（避免413） =============== */
  async function compressImage(file, maxW, maxH, quality){
    return new Promise(function(resolve, reject){
      try{
        var img = new Image();
        var fr = new FileReader();
        fr.onload = function(){ img.onload = function(){
            var w = img.width, h = img.height;
            var confMax = (schema.settings && schema.settings.upload && schema.settings.upload.image_max_w) ? Number(schema.settings.upload.image_max_w) : 1600;
            maxW = maxW || confMax; maxH = maxH || confMax;
            var confQuality = (schema.settings && schema.settings.upload && schema.settings.upload.image_quality!=null) ? Number(schema.settings.upload.image_quality) : 0.85;
            quality = (quality!=null?quality:confQuality); if(!(quality>=0 && quality<=1)) quality=0.85;

            var tw=w, th=h;
            if(w>maxW || h>maxH){
              var ratio = Math.min(maxW/w, maxH/h);
              tw = Math.round(w*ratio); th = Math.round(h*ratio);
            }
            var cvs=document.createElement('canvas'); cvs.width=tw; cvs.height=th;
            var ctx=cvs.getContext('2d'); ctx.drawImage(img,0,0,tw,th);
            resolve(cvs.toDataURL('image/jpeg', quality));
        }; img.src = fr.result; };
        fr.readAsDataURL(file);
      }catch(e){ reject(e); }
    });
  }

  /* =============== Schema =============== */
  // 把后台预填（hidden 输入）解析到 PREFILL
  var PREFILL = (function(){
    try{ var v = document.getElementById('schema_json').value; return v ? JSON.parse(v) : null; }
    catch(e){ return null; }
  })();

  var schema = {
    bg: null, bg_color: null,
    fields: [],
    theme: { brand: '#2563eb', appearance: 'auto' },
    settings: {
      publish: { is_published: true, start_at:"", end_at:"", require_login:false, visibility:"public", allowed_domains:"", whitelist:"" },
      submission: { per_user_limit:0, per_ip_daily_limit:0, max_total:0, duplicate_keys:"", require_review:false, enable_captcha:false },
      upload: { allowed_file_types:"jpg,png,pdf", max_file_mb:5, image_quality:0.85, image_max_w:1600 },
      display: { success_message:"提交成功，感谢填写", redirect_url:"", bg_style:"gradient" },
      notify: { email_to:"", webhook_url:"", export_datefmt:"YYYY-MM-DD HH:mm", export_timezone:"Asia/Shanghai" },
      privacy: { require_consent:false, consent_url:"" }
    }
  };
  function uid(){return 'q'+Math.random().toString(36).slice(2,9)}
  function defaultQuestions(){return[
    {id:uid(),type:"text",required:true,labelHTML:"姓名",options:[],image:null},
    {id:uid(),type:"email",required:true,labelHTML:"电子邮箱",options:[],image:null}
  ]}
  if(PREFILL && typeof PREFILL==='object'){
    try{
      var pre = PREFILL;
      for(var k in pre){ if(pre.hasOwnProperty(k)) schema[k]=pre[k]; }
      if(!schema.fields) schema.fields=[];
      if(!schema.theme) schema.theme={ brand:'#2563eb', appearance:'auto' };
      if(!schema.settings){
        schema.settings = {
          publish: { is_published: true, start_at:"", end_at:"", require_login:false, visibility:"public", allowed_domains:"", whitelist:"" },
          submission: { per_user_limit:0, per_ip_daily_limit:0, max_total:0, duplicate_keys:"", require_review:false, enable_captcha:false },
          upload: { allowed_file_types:"jpg,png,pdf", max_file_mb:5, image_quality:0.85, image_max_w:1600 },
          display: { success_message:"提交成功，感谢填写", redirect_url:"", bg_style:"gradient" },
          notify: { email_to:"", webhook_url:"", export_datefmt:"YYYY-MM-DD HH:mm", export_timezone:"Asia/Shanghai" },
          privacy: { require_consent:false, consent_url:"" }
        };
      }else{
        if(!schema.settings.display) schema.settings.display={};
        if(schema.settings.display.bg_style==null) schema.settings.display.bg_style='gradient';
      }
    }catch(e){ schema.fields=defaultQuestions(); }
  }else{
    schema.fields=defaultQuestions();
  }

  // ✅ 修复：保证 schema.fields 正常（放在 schema 定义完成之后）
  if (!Array.isArray(schema.fields)) schema.fields = [];
  if (schema.fields.length === 0) {
    schema.fields.push({
      id: uid(),
      type: "text",
      required: true,
      labelHTML: "默认问题",
      options: [],
      image: null
    });
  }

  /* =============== DOM 引用 =============== */
  var list=document.getElementById('list');
  var addBtn=document.getElementById('addBtn');
  var bgPicker=document.getElementById('bgPicker');
  var btnPreview=document.getElementById('btnPreview');
  var previewModal=document.getElementById('previewModal');
  var previewRoot=document.getElementById('previewRoot');
  var linkModal=document.getElementById('linkModal');
  var pubUrlInput=document.getElementById('pubUrl');
  var copyPub=document.getElementById('copyPub');
  var colorPicker=document.getElementById('colorPicker');
  var btnClearDraft=document.getElementById('btnClearDraft');
  var form=document.getElementById('builder');
  var btnTheme=document.getElementById('btnTheme');
  var railAdd=document.getElementById('railAdd');
  var railImage=document.getElementById('railImage');


    // 只移动节点，不改样式/事件
   // —— 把现有“保存表单”按钮移到右侧图片（#railImage）正下方 ——
    // 仅移动节点，不改样式/事件
    (function moveSaveUnderRailImage() {
  var formEl = document.getElementById('builder');
  if (!formEl) return;

  var saveBtn = formEl.querySelector('button[type="submit"], input[type="submit"]')
            || document.getElementById('btnSave')
            || document.querySelector('.btn-save');
  if (!saveBtn) return;

  // 确保即使按钮被移出 form 仍然提交这个 form
  saveBtn.setAttribute('form', 'builder');
  saveBtn.type = 'submit';

  if (document.getElementById('railSaveHolder')) return;

  // 1) 先找 #railImage（通常是 <input type="file">）
  var railImg = document.getElementById('railImage');

  // 2) 兜底：找一个“文字包含‘图片’”的按钮/label
  if (!railImg) {
    railImg = Array.from(document.querySelectorAll('label,button,.btn,input'))
      .find(function (el) {
        var t = (el.innerText || el.value || '').trim();
        return /图片/.test(t);
      });
  }

  // 占位容器，保证换行在“下面”
  var holder = document.createElement('div');
  holder.id = 'railSaveHolder';
  holder.style.display = 'block';
  holder.style.width = '100%';
  holder.style.marginTop = '8px';

  // 尽量插在“图片控件”那一行的后面
  var row = railImg && (railImg.closest('.rail-row, .row, .field, .group, label, .sidebar, .right-rail, .rail') || railImg);
  if (row) {
    var parent = row.parentElement;
    if (parent && getComputedStyle(parent).display.indexOf('flex') !== -1) {
      parent.style.flexWrap = 'wrap';
    }
    row.insertAdjacentElement('afterend', holder);
  } else {
    // 实在找不到，就挂到右侧栏的末尾（尽量常见容器选择器）
    var right = document.getElementById('rail') || document.querySelector('.right-rail, .rail, .sidebar');
    if (right) right.insertAdjacentElement('beforeend', holder);
    else formEl.insertAdjacentElement('afterend', holder); // 最兜底
  }

  holder.appendChild(saveBtn);
})();


  /* —— 安全绑定：元素存在才绑定，防止 null.addEventListener 报错中断 —— */
  function bind(el, evt, handler, opts){ if(el && el.addEventListener){ el.addEventListener(evt, handler, opts||false); } }

  /* =============== 本地草稿（刷新不丢） =============== */
  function draftKey(sn){ var name=(typeof sn==='string'?sn:(document.querySelector('input[name=site_name]')||{}).value||'').trim(); return 'form_builder_draft:'+(name||'new') }
  var __saveTimer=null;
  function scheduleSave(force){ if(force){doSave();return} clearTimeout(__saveTimer); __saveTimer=setTimeout(doSave,600); }
  function doSave(){
    try{
      var payload={
        ts:Date.now(),
        form_name:(document.querySelector('input[name=form_name]')||{}).value||'',
        site_name:(document.querySelector('input[name=site_name]')||{}).value||'',
        form_desc:(document.querySelector('textarea[name=form_desc]')||{}).value||'',
        schema:schema||{}
      };
      localStorage.setItem(draftKey(payload.site_name),JSON.stringify(payload));
    }catch(e){}
  }

  /* —— 替换后的 loadDraft：新建页不恢复；有 PREFILL 不覆盖；仅按当前站点名精确恢复 —— */
  function loadDraft(){
    if (IS_NEW) return false;                                   // 新建：绝不加载历史
    if (PREFILL && typeof PREFILL==='object') return false;     // 已有后端数据：不覆盖

    try{
      var sn=document.querySelector('input[name=site_name]');
      var site = (sn && sn.value || '').trim();
      if (!site) return false;                                  // 没站点名不恢复

      var raw = localStorage.getItem(draftKey(site));           // 只取这个站点的草稿
      if (!raw) return false;

      var data = JSON.parse(raw);
      var fn=document.querySelector('input[name=form_name]');
      var fd=document.querySelector('textarea[name=form_desc]');
      if(fn) fn.value=data.form_name||'';
      if(fd) fd.value=data.form_desc||'';
      if(data.schema && typeof data.schema==='object'){ schema=data.schema; }
      return true;
    }catch(e){ return false; }
  }

  (function watchSite(){
    var sn=document.querySelector('input[name=site_name]'); if(!sn) return;
    var last=draftKey(sn.value||'new');
    sn.addEventListener('input',function(e){
      var nk=draftKey(e.target.value||'new');
      if(nk!==last){
        try{ var raw=localStorage.getItem(last); if(raw){localStorage.setItem(nk,raw); localStorage.removeItem(last);} }catch(_){}
        last=nk;
      }
      scheduleSave(); queueServerSave();
    });
  })();
  ['input','change'].forEach(function(ev){
    var fn=document.querySelector('input[name=form_name]');
    var sn=document.querySelector('input[name=site_name]');
    var fd=document.querySelector('textarea[name=form_desc]');
    if(fn) fn.addEventListener(ev,function(){scheduleSave(); queueServerSave();});
    if(sn) sn.addEventListener(ev,function(){scheduleSave(); queueServerSave();});
    if(fd) fd.addEventListener(ev,function(){scheduleSave(); queueServerSave();});
  });
  if(btnClearDraft){
    btnClearDraft.addEventListener('click',function(){
      try{
        var dels=[];
        for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/^form_builder_draft:/.test(k)) dels.push(k); }
        dels.forEach(function(k){ localStorage.removeItem(k); });
      }catch(_){}
      alert('本地草稿已清空（不影响服务器已保存的数据）');
    });
  }
  window.addEventListener('beforeunload',function(){try{doSave()}catch(_){}})

  // 首次尝试从草稿恢复（按新规则）
  loadDraft();

  /* =============== Tabs =============== */
  [].slice.call(document.querySelectorAll('.tabs button')).forEach(function(b){
    b.addEventListener('click',async function(){
      [].slice.call(document.querySelectorAll('.tabs button')).forEach(function(x){x.classList.remove('active')});
      b.classList.add('active');
      [].slice.call(document.querySelectorAll('.tab')).forEach(function(t){t.classList.remove('active')});
      document.getElementById('tab-'+b.dataset.tab).classList.add('active');

      // 进入“回复”页：自动保存一次并重建表头，然后加载
      if(b.dataset.tab==='responses'){
        await ensureServerSaved();     // 静默保存以获取 site
        rebuildRespHeader();           // 动态列头
        loadResponses();               // 加载数据
      }
    });
  });

  /* =============== 工具函数 =============== */
  function stripHTML(html){var d=document.createElement('div'); d.innerHTML=html; return d.textContent||''}
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])})}
  function ensureToastOnTop(){
  var t = document.getElementById('toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  } else if (t.parentNode !== document.body){
    // ⬅️ 如果 toast 被放在某个容器里，移到 body 下面，避免被容器的 z-index/transform 影响
    document.body.appendChild(t);
  }
  // 如果没有样式，也动态补一份（可选）
  if (!document.getElementById('toast-style')){
    var s = document.createElement('style');
    s.id = 'toast-style';
    s.textContent = `
#toast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-6px);z-index:100000;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .18s ease, transform .18s ease;font-weight:600;}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
    `;
    document.head.appendChild(s);
  }
  return t;
}

    function showToast(msg) {
        var t = ensureToastOnTop();
        t.textContent = msg || '操作成功';
        t.classList.add('show');
        clearTimeout(t.__timer);
        t.__timer = setTimeout(function () {
            t.classList.remove('show');
        }, 1500);
    }


  /* =============== 渲染问题 =============== */
  function render(){
    list.innerHTML='';
    schema.fields = Array.isArray(schema.fields) ? schema.fields : [];
    schema.fields.forEach(function(q,idx){ list.appendChild(renderCard(q,idx))});
    sync();
  }

  // 仅允许纯文本粘贴，避免把图片塞进标题
  function preventRichPaste(el){
    el.addEventListener('paste', function(e){
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      e.preventDefault();
      document.execCommand('insertText', false, text);
    });
  }
  function purgeImagesInside(el){
    var imgs = el.querySelectorAll('img'); imgs.forEach(function(n){ n.remove(); });
  }

  function renderCard(q,index){
    var card=document.createElement('div'); card.className='qcard'; card.setAttribute('draggable','true'); card.dataset.id=q.id;

    var row=document.createElement('div'); row.className='q-row';
    var title=document.createElement('div'); title.className='q-title'; title.contentEditable='true'; title.innerHTML=q.labelHTML||'';
    preventRichPaste(title);
    title.addEventListener('input',function(){
      purgeImagesInside(title);
      q.labelHTML=title.innerHTML.trim();
      pushHistory(); sync();
    });

    var tools=document.createElement('div'); tools.className='q-tools';
    var picBtn=document.createElement('label');
    picBtn.className='btn gray';
    picBtn.style.padding='8px 10px';
    picBtn.style.display='inline-flex';
    picBtn.style.flexDirection='row';
    picBtn.style.alignItems='center';
    picBtn.style.gap='6px';
    picBtn.style.whiteSpace='nowrap';
    picBtn.title='插入图片';
    picBtn.innerHTML='🖼️ <span>图片</span>';
    var picInput=document.createElement('input'); picInput.type='file'; picInput.accept='image/*'; picInput.style.display='none';
    picBtn.appendChild(picInput);
    picInput.addEventListener('change', async function(e){
      var f=e && e.target && e.target.files && e.target.files[0]?e.target.files[0]:null;
      if(!f) return;
      var dataUrl = await compressImage(f);
      q.image=dataUrl; pushHistory(); render(); scheduleSave(true); queueServerSave();  // 自动保存
    });

    var typeSel=document.createElement('select'); typeSel.className='tiny select';
    typeSel.innerHTML='<option value="text">简短回答</option><option value="textarea">段落</option><option value="email">邮箱</option><option value="number">数字</option><option value="date">日期</option><option value="time">时间</option><option value="radio">单选</option><option value="checkbox">多选</option><option value="select">下拉</option><option value="file">文件上传</option>';
    typeSel.value=q.type||'text';
    typeSel.addEventListener('change',function(){
      q.type=typeSel.value;
      if(['radio','checkbox','select'].indexOf(q.type)>=0 && !Array.isArray(q.options)){q.options=['选项 1']}
      pushHistory(); render();
    });

    tools.appendChild(picBtn); tools.appendChild(typeSel);
    row.appendChild(title); row.appendChild(tools);
    card.appendChild(row);

    var fmt=document.createElement('div'); fmt.className='format';
    function mk(txt,cmd){
      var b=document.createElement('button'); b.type='button'; b.className='icon'; b.innerHTML=txt;
      b.addEventListener('click',function(){
        title.focus();
        if(cmd==='createLink'){var u=prompt('输入链接地址'); if(!u)return; document.execCommand(cmd,false,u);}
        else{document.execCommand(cmd,false,null);}
        purgeImagesInside(title);
        q.labelHTML=title.innerHTML.trim(); pushHistory(); sync();
      }); return b;
    }
    fmt.appendChild(mk('<b>B</b>','bold'));
    fmt.appendChild(mk('<i>I</i>','italic'));
    fmt.appendChild(mk('<u>U</u>','underline'));
    fmt.appendChild(mk('<s>S</s>','strikeThrough'));
    fmt.appendChild(mk('🔗','createLink'));
    card.appendChild(fmt);

    var prev=document.createElement('div'); prev.className='preview'; prev.innerHTML=renderPreview(q); card.appendChild(prev);

    // —— 题图：只渲染一次（预览下面），带删除按钮
    if(q.image){
      var wrap=document.createElement('div'); wrap.className='q-image-wrap';
      var im=document.createElement('img'); im.className='q-image'; im.src=q.image; wrap.appendChild(im);
      var del=document.createElement('button'); del.type='button'; del.className='q-image-del'; del.textContent='×';
      del.title='删除图片';
      del.addEventListener('click', function(){
        q.image=null; pushHistory(); render(); scheduleSave(true); queueServerSave();  // 自动保存
        showToast('已删除题图');
      });
      wrap.appendChild(del);
      card.appendChild(wrap);
    }

    if(['radio','checkbox','select'].indexOf(q.type)>=0){
      if(!Array.isArray(q.options)) q.options=[];
      var cont=document.createElement('div');
      q.options.forEach(function(opt,i){
        var line=document.createElement('div'); line.className='option-row';
        var icon=document.createElement('span'); icon.textContent=q.type==='radio'?'⭕':'☑️';
        var inp=document.createElement('input'); inp.className='tiny'; inp.value=opt; inp.addEventListener('input',function(){q.options[i]=inp.value; sync(); queueServerSave();});
        var del=document.createElement('button'); del.type='button'; del.className='icon-btn'; del.textContent='🗑️';
        del.addEventListener('click',function(){q.options.splice(i,1); pushHistory(); render();});
        line.appendChild(icon); line.appendChild(inp); line.appendChild(del);
        cont.appendChild(line);
      });
      var addop=document.createElement('button'); addop.type='button'; addop.className='btn'; addop.textContent='添加选项';
      addop.addEventListener('click',function(){q.options.push('选项 '+(q.options.length+1)); pushHistory(); render();});
      cont.appendChild(addop); card.appendChild(cont);
    }

    var foot=document.createElement('div'); foot.className='q-footer';
    var copyBtn=document.createElement('button'); copyBtn.type='button'; copyBtn.className='icon-btn'; copyBtn.textContent='📄'; copyBtn.title='复制';
    copyBtn.addEventListener('click',function(){
      var cp=JSON.parse(JSON.stringify(q)); cp.id=uid();
      schema.fields.splice(index+1,0,cp); pushHistory(); render(); showToast('已复制问题');
    });
    var delBtn=document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn'; delBtn.textContent='🗑️'; delBtn.title='删除';
    delBtn.addEventListener('click',function(){ schema.fields.splice(index,1); pushHistory(); render(); showToast('已删除问题'); });
    var reqWrap=document.createElement('label'); reqWrap.className='switch'; reqWrap.innerHTML='<input type="checkbox" '+(q.required?'checked':'')+'><span>必填</span>';
    reqWrap.querySelector('input').addEventListener('change',function(e){ q.required=e.target.checked; pushHistory(); sync(); showToast('已更新必填'); });
    foot.appendChild(copyBtn); foot.appendChild(delBtn); foot.appendChild(reqWrap);
    card.appendChild(foot);

    // 拖拽排序
    card.addEventListener('dragstart',function(e){ card.classList.add('dragging'); e.dataTransfer.setData('text/plain', q.id); });
    card.addEventListener('dragend',function(){ card.classList.remove('dragging'); });
    card.addEventListener('dragover',function(e){
      e.preventDefault();
      var dragging=document.querySelector('.qcard.dragging'); if(!dragging) return;
      var after=getDragAfterElement(list,e.clientY); if(after==null) list.appendChild(dragging); else list.insertBefore(dragging,after);
    });
    card.addEventListener('drop',function(e){ e.preventDefault(); reorderByDom(); showToast('已排序'); });

    return card;
  }
  function getDragAfterElement(container,y){
    var els=[].slice.call(container.querySelectorAll('.qcard:not(.dragging)'));
    return els.reduce(function(closest,child){
      var box=child.getBoundingClientRect();
      var offset=y-box.top-box.height/2;
      if(offset<0&&offset>closest.offset){ return {offset:offset,element:child}; }
      return closest;
    }, {offset:Number.NEGATIVE_INFINITY}).element;
  }
  function reorderByDom(){
    var ids=[].slice.call(list.querySelectorAll('.qcard')).map(function(x){return x.dataset.id;});
    schema.fields.sort(function(a,b){ return ids.indexOf(a.id)-ids.indexOf(b.id); });
    pushHistory(); sync();
  }
  function renderPreview(q){
    var label=stripHTML(q.labelHTML||'');
    switch(q.type){
      case 'textarea': return label+'<br><textarea rows="3" style="width:100%"></textarea>';
      case 'email':    return label+'<br><input type="email" style="width:100%" placeholder="example@xxx.com">';
      case 'number':   return label+'<br><input type="number" style="width:100%">';
      case 'date':     return label+'<br><input type="date" style="width:100%">';
      case 'time':     return label+'<br><input type="time" style="width:100%">';
      case 'file':     return label+'<br><input type="file">';
      case 'radio':    return label+'<br>'+((q.options||[]).map(function(o){return '<label style="margin-right:12px"><input type="radio" name="'+q.id+'"> '+escapeHTML(o)+'</label>';}).join(''));
      case 'checkbox': return label+'<br>'+((q.options||[]).map(function(o){return '<label style="margin-right:12px"><input type="checkbox"> '+escapeHTML(o)+'</label>';}).join(''));
      case 'select':   return label+'<br><select style="min-width:200px">'+((q.options||[]).map(function(o){return '<option>'+escapeHTML(o)+'</option>';}).join(''))+'</select>';
      default:         return label+'<br><input type="text" style="width:100%" placeholder="简短回答">';
    }
  }

  /* =============== 同步 schema + 主题色 + 设置 =============== */
  function sync(){
    var currentBrand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#2563eb';
    schema.theme = schema.theme || {};
    schema.theme.brand = currentBrand;
    document.getElementById('schema_json').value = JSON.stringify(schema, null, 2);
    scheduleSave();
  }
  function setByPath(obj, path, val){
    var keys = path.split('.'); var cur = obj;
    for(var i=0;i<keys.length-1;i++){ if(typeof cur[keys[i]]!=='object' || cur[keys[i]]===null) cur[keys[i]]={}; cur=cur[keys[i]]; }
    cur[keys[keys.length-1]] = val;
  }
  function getByPath(obj, path){
    var keys = path.split('.'); var cur = obj;
    for(var i=0;i<keys.length;i++){ if(cur==null) return undefined; cur = cur[keys[i]]; }
    return cur;
  }
  function bindSettings(){
    var nodes = document.querySelectorAll('[data-skey]');
    for(var i=0;i<nodes.length;i++){
      (function(el){
        var key = el.getAttribute('data-skey');
        var val = getByPath(schema.settings, key) || getByPath(schema.theme, key.replace('theme.',''));
        if(el.type==='checkbox') el.checked = !!val; else if(val!=null) el.value = String(val);
        el.addEventListener('input', function(){
          var v = (el.type==='checkbox') ? el.checked : el.value;
          if(key.indexOf('theme.')===0){
            setByPath(schema, key, v);
            if(key==='theme.appearance'){ applyAppearance(v); applyBackground(); }
          }else{
            setByPath(schema.settings, key, v);
            if(key==='display.bg_style'){ applyBackground(); }
          }
          sync(); queueServerSave();
        });
      })(nodes[i]);
    }
  }
  function syncSettingsUI(){
    var nodes = document.querySelectorAll('[data-skey]');
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i]; var key = el.getAttribute('data-skey');
      var val = getByPath(schema.settings, key);
      if(key.indexOf('theme.')===0){ val = getByPath(schema, key); }
      if(el.type==='checkbox') el.checked = !!val; else el.value = (val==null?'':val);
    }
    if(colorPicker){ colorPicker.value = (schema.theme && schema.theme.brand) ? schema.theme.brand : '#2563eb'; }
  }

  /* =============== 事件绑定（全部改为“安全绑定”） =============== */
  bind(document.getElementById('railAdd'),'click',function(){ if(addBtn) addBtn.click(); });
  bind(addBtn,'click',function(){ schema.fields.push({id:uid(), type:'text', required:false, labelHTML:'新问题', options:[], image:null}); pushHistory(); render(); showToast('已添加问题'); });

  // 背景图（压缩）
  bind(bgPicker,'change', async function(e){
    var f=e && e.target && e.target.files && e.target.files[0]?e.target.files[0]:null;
    if(!f) return;
    var dataUrl = await compressImage(f, 1920, 1080, (schema.settings && schema.settings.upload && schema.settings.upload.image_quality!=null)?Number(schema.settings.upload.image_quality):0.85);
    schema.bg=dataUrl;
    applyBackground();
    pushHistory(); sync(); showToast('背景已更新'); queueServerSave();
  });

  // 外观快速切换（亮/暗轮换）
  bind(btnTheme,'click', function(){
    var cur = (schema.theme && schema.theme.appearance) ? schema.theme.appearance : 'auto';
    var next = (cur==='light') ? 'dark' : (cur==='dark' ? 'auto' : 'light');
    schema.theme.appearance = next;
    applyAppearance(next); applyBackground(); sync(); queueServerSave();
    showToast('外观已切换为：'+ (next==='auto'?'跟随系统':next));
  });

  // 右栏：标题/图片（压缩）
  bind(document.getElementById('railTitle'),'click', function(){ schema.fields.push({id:uid(), type:'text', required:false, labelHTML:'标题', options:[]}); pushHistory(); render(); showToast('已添加标题'); });
  bind(document.getElementById('railImage'),'change', async function(e){
    var f=e && e.target && e.target.files && e.target.files[0]?e.target.files[0]:null;
    if(!f) return;
    var dataUrl = await compressImage(f);
    schema.fields.push({id:uid(), type:'text', required:false, labelHTML:'', options:[], image:dataUrl});
    pushHistory(); render(); scheduleSave(true); queueServerSave(); showToast('已插入图片');
  });
  bind(document.getElementById('railSave'), 'click', function () {
        if (!form) return;
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();   // 触发你现有的提交逻辑（成功后弹中间卡片）
        } else {
            const ev = new Event('submit', {bubbles: true, cancelable: true});
            form.dispatchEvent(ev);
        }
    });


  // 预览
  bind(btnPreview,'click',function(){
    previewRoot.innerHTML='';
    var h=document.createElement('div'); h.className='card';
    h.innerHTML='<div class="hd"><h2>'+((document.querySelector('input[name=form_name]')||{}).value||'（未命名表单）')+'</h2></div><div class="bd"><div class="muted">'+((document.querySelector('textarea[name=form_desc]')||{}).value||'')+'</div></div>';
    previewRoot.appendChild(h);
    var wrap=document.createElement('div'); wrap.className='card'; wrap.innerHTML='<div class="hd"><h2>问题</h2></div>'; var body=document.createElement('div'); body.className='bd';
    schema.fields.forEach(function(q){
      var block=document.createElement('div'); block.className='qcard';
      var inner='<div class="preview">'+renderPreview(q)+'</div>';
      if(q.image){ inner+='<div class="q-image-wrap"><img class="q-image" src="'+q.image+'"></div>'; }
      block.innerHTML=inner; body.appendChild(block);
    });
    wrap.appendChild(body); previewRoot.appendChild(wrap);
    if(previewModal) previewModal.classList.add('show');
  });
  bind(document.getElementById('closePreview'),'click',function(){ if(previewModal) previewModal.classList.remove('show'); });
  bind(previewModal,'click',function(e){ if(e.target===previewModal){ previewModal.classList.remove('show'); } });

  // 撤销/重做
  bind(document.getElementById('btnUndo'),'click', function(){ undo(); showToast('已撤销'); });
  bind(document.getElementById('btnRedo'),'click', function(){ redo(); showToast('已重做'); });

  // 应用主题与背景（首次）
  applyThemeFromSchema();

  // 初次渲染
  pushHistory(); render(); bindSettings(); syncSettingsUI();

  // ====== 成功页：用 iframe 居中丝滑出现 ======
  function ensureSuccessModalStyle() {
    if (document.getElementById('success-modal-style')) return;
    var css = `
  #linkModal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
             background:rgba(15,18,24,.45);z-index:9999;padding:20px;}
  #linkModal.show{display:flex;animation:fadeIn .22s ease-out;}
  #linkModal .modal-card{width:min(880px,92vw);border-radius:16px;overflow:hidden;background:transparent;box-shadow:none;border:0;padding:0;}
  #linkModal iframe{width:100%;height:480px;border:0;display:block;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)}}
  `;
    var s = document.createElement('style');
    s.id = 'success-modal-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

function __makeSuccessCard(j){
  const abs = u => { try { return u ? new URL(u, window.location.href).href : ''; } catch(_) { return u || ''; } };
  const esc = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const pubAbs = abs(j.public_url);
  const admAbs = abs(j.admin_url);
  const site   = esc(j.site_name || '');

  return `<!doctype html><meta charset="utf-8">
  <style>
    html,body{height:100%}body{margin:0;font-family:system-ui,-apple-system,'Microsoft YaHei',Arial;background:transparent}
    .center{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{width:min(920px,92vw);border-radius:18px;padding:24px;background:#fff;border:1px solid #eef2f7;box-shadow:0 18px 50px rgba(15,23,42,.10)}
    .title{display:flex;align-items:center;gap:12px;margin-bottom:10px;font-weight:900;font-size:22px}
    .ok{width:36px;height:36px;border-radius:10px;background:linear-gradient(180deg,#ff9741,#ff6a00);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:900}
    .sub{color:#374151;margin-bottom:6px}
    .row{display:flex;gap:12px;align-items:center;margin:14px 0}
    .tag{flex:0 0 auto;padding:6px 12px;border-radius:999px;background:#f3f4f6;color:#111;font-weight:700}
    .inp{flex:1 1 auto;display:flex;gap:10px}
    .inp input{width:100%;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa}
    .btn{padding:10px 14px;border:0;border-radius:12px;font-weight:800;cursor:pointer}
    .btn.copy{background:#eef2f7}
    .btn.open{background:#fff;border:1px solid #e5e7eb}
    .actions{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
    .actions .go{background:linear-gradient(180deg,#ff9741,#ff6a00);color:#fff}
    .actions .pub{background:#fff;border:1px solid #e5e7eb}
    .hint{margin-top:8px;color:#6b7280;font-size:12px}
  </style>
  <div class="center">
    <div class="card">
      <div class="title"><span class="ok">✓</span>保存成功</div>
      <div class="sub">表单 <b>${site}</b> 已创建/更新。复制链接发给用户，或直接进入后台管理。</div>

      <div class="row">
        <span class="tag">公开</span>
        <div class="inp">
          <input id="pub" value="${esc(pubAbs)}" readonly onclick="this.select()">
          <button class="btn copy" onclick="copy('#pub')">复制</button>
          <a class="btn open" href="${esc(pubAbs)}" target="_blank">打开</a>
        </div>
      </div>

      <div class="row">
        <span class="tag">后台</span>
        <div class="inp">
          <input id="adm" value="${esc(admAbs)}" readonly onclick="this.select()">
          <button class="btn copy" onclick="copy('#adm')">复制</button>
          <a class="btn open" href="${esc(admAbs)}" target="_top">打开</a>
        </div>
      </div>

      <div class="actions">
        <a class="btn go"  href="${esc(admAbs)}" target="_top">进入后台</a>
        <a class="btn pub" href="${esc(pubAbs)}" target="_blank">打开公开表单</a>
      </div>
      <div class="hint">提示：点击输入框即可全选。</div>
    </div>
  </div>
  <script>
    function copy(sel){
      var ip=document.querySelector(sel);
      ip.select();
      try{ document.execCommand('copy'); }catch(_){ navigator.clipboard && navigator.clipboard.writeText(ip.value); }
    }
  <\/script>`;
}


// 放在 showSaveSuccess 定义之前
var __allowSuccessModal = false;

function showSaveSuccess(payloadOrSite) {
  // ✅ 只有明确允许时才显示（比如提交成功）
  if (!__allowSuccessModal) return;
  __allowSuccessModal = false; // 用一次就复位

  if (!linkModal) return;
  ensureSuccessModalStyle();


  // 允许传 siteName（旧用法）或完整返回体（推荐）
  var j = (typeof payloadOrSite === 'string')
          ? { site_name: payloadOrSite, public_url:'', admin_url:'' }
          : (payloadOrSite || {});

  linkModal.innerHTML = `
    <div class="modal-card">
      <iframe id="__succ_iframe" allow="clipboard-read; clipboard-write"></iframe>
    </div>`;
  var f = linkModal.querySelector('#__succ_iframe');
  f.removeAttribute('src');
  f.srcdoc = __makeSuccessCard(j);

  linkModal.classList.add('show');
  linkModal.onclick = function (e) {
    if (e.target === linkModal) linkModal.classList.remove('show');
  };
}

// 只有点击“保存表单/保存/save”才允许提交
    let __SAVE_INTENT = false;
    document.addEventListener('click', function (ev) {
        const el = ev.target && ev.target.closest('button, input[type=submit]');
        if (!el) return;
        const txt = (el.innerText || el.value || '').trim();
        __SAVE_INTENT = /保存表单|保存|save/i.test(txt);
    }, true);

// 保险：把表单里除“保存表单”之外的 submit 按钮，统一改成 button
    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('builder');
        if (!form) return;
        Array.from(form.querySelectorAll('button[type=submit],input[type=submit]')).forEach(b => {
            const txt = (b.innerText || b.value || '').trim();
            if (!/保存表单|保存|save/i.test(txt)) b.type = 'button';
        });
    });


  /* =============== 保存（手动保存保持原逻辑） =============== */
  (function ensureAjaxParam(){
    var u=form.action||''; if(u.indexOf('ajax=1')===-1){ form.action = u + (u.indexOf('?')>-1 ? '&' : '?') + 'ajax=1'; }
  })();

  // ✅ 修复后的 submit：成功后转成绝对地址 + 只在保存成功时弹层
    bind(form, 'submit', async function (e) {
        e.preventDefault();

        // 不是“保存表单”触发的提交，直接忽略
        const isSaveBtn = e.submitter && /保存表单|保存|save/i.test((e.submitter.innerText || e.submitter.value || '').trim());
        if (!__SAVE_INTENT && !isSaveBtn) return;
        __SAVE_INTENT = false;

        sync();

        const fd = new FormData(form);
        try {
            const resp = await fetch(form.action, {
                method: 'POST',
                body: fd,
                headers: {'Accept': 'application/json'}
            });
            const ct = resp.headers.get('content-type') || '';
            const data = ct.includes('application/json') ? await resp.json() : null;
            if (!resp.ok || !data || !data.ok) {
                throw new Error((data && data.error) || ('HTTP ' + resp.status));
            }

            document.body.dataset.site = data.site_name || '';

            // ✅ 把相对地址补成完整网址（用 location.href，支持子路径部署）
            const toAbs = u => u ? new URL(u, window.location.href).href : '';
            const pubAbs = toAbs(data.public_url);
            const admAbs = toAbs(data.admin_url);

            __allowSuccessModal = true;  // ✅ 仅提交成功才允许弹窗
            // 中间弹层（只在保存成功时出现）
            showSaveSuccess({
                site_name: data.site_name,
                public_url: pubAbs,
                admin_url: admAbs
            });

            // 右侧输入框（若存在）写入绝对地址
            if (pubUrlInput && pubAbs) pubUrlInput.value = pubAbs;

        } catch (err) {
            alert('保存失败：' + err.message);
        }
    });




  bind(copyPub,'click', function(){ if(!pubUrlInput) return; pubUrlInput.select(); document.execCommand('copy'); copyPub.textContent='已复制'; setTimeout(function(){copyPub.textContent='复制';},1200); });
  bind(document.getElementById('closeLink'),'click', function(){ if(linkModal) linkModal.classList.remove('show') });

  /* =============== ☆☆☆ 自动保存到服务器（新增） =============== */
  var __serverTimer=null, __savingNow=false;
  function queueServerSave(){
    clearTimeout(__serverTimer);
    __serverTimer=setTimeout(autoSaveToServerSilently, 1200); // 有改动 1.2s 后静默保存
  }
  async function ensureServerSaved(){
    if((document.body.dataset.site||'').trim()) return true; // 已有 site
    await autoSaveToServerSilently(true);
    return !!(document.body.dataset.site||'').trim();
  }
  async function autoSaveToServerSilently(forceNow){
    if(__savingNow && !forceNow) return;
    var sn=(document.querySelector('input[name=site_name]')||{}).value||'';
    if(!sn.trim()){ return; } // 没网站名则无法在服务器创建
    __savingNow=true;
    try{
      sync(); // 把当前 schema 写入隐藏域
      var fd=new FormData(form);
      var res=await fetch(form.action, {method:'POST', body:fd, headers:{'Accept':'application/json'}});
      var ct=res.headers.get('content-type')||'';
      var data = (ct.indexOf('application/json')>-1) ? await res.json() : null;
      if(res.ok && data && data.ok){
        document.body.dataset.site = data.site_name || document.body.dataset.site || '';
        // 静默：不弹窗
      }
    }catch(_){/* 忽略瞬时错误 */}
    __savingNow=false;
  }

  /* ====== 工具：题目文本 / 归一化键名 / 值格式化（只保留一套，避免覆盖） ====== */
  function __labelText(q){
    var d=document.createElement('div'); d.innerHTML=(q&&q.labelHTML)||'';
    return (d.textContent||'').trim();
  }
  function normalizeKey(s){
    return String(s||'').replace(/[\s_:\-\/（）()\[\]【】<>·.，,。；;:'"|]/g,'').toLowerCase();
  }
  function fmtVal(v){
  if (v == null) return '';

  // 数组：逐个渲染为链接，换行显示
  if (Array.isArray(v)) {
    return v.map(fmtVal).filter(Boolean).join('<br>');
  }

  // 对象：常见 {url,name} 或 {url}；也兼容 {value:...}
  if (typeof v === 'object') {
    try {
      if (v.url) {
        var raw = String(v.url).trim();
        var abs = raw.startsWith('/') ? new URL(raw, window.location.origin).href : raw;
        var name = (v.name && String(v.name).trim()) ||
                   raw.split('?')[0].split('/').pop() || '查看';
        return '<a href="'+abs.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener">'+
               name.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>';
      }
      if ('value' in v) return String(v.value);
      return String(JSON.stringify(v));
    } catch(_) { return String(v); }
  }

  // 字符串
  var s = String(v).trim();

  // 如果是“逗号分隔的多个链接”，拆开分别渲染
  if (s.includes(',') && (/^https?:/i.test(s) || s.trim().startsWith('/'))) {
    return s.split(',').map(function(x){ return fmtVal(x.trim()); }).join('<br>');
  }

  // 单个链接：绝对 http(s) 或以 / 开头的站内路径
  if (/^https?:/i.test(s) || s.startsWith('/')) {
    var abs2 = s.startsWith('/') ? new URL(s, window.location.origin).href : s;
    var fname = s.split('?')[0].split('/').pop() || '查看';
    return '<a href="'+abs2.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener">'+
           fname.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</a>';
  }

  // 普通文本：做转义
  return s.replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

  /* =============== 回复表格：动态列 + 稳定取值 =============== */
  var tbody=document.getElementById('respTbody');
  var qInp=document.getElementById('q');

  function getFixedFieldIds(){
    function fid(keys){
      keys = Array.isArray(keys)?keys:[keys];
      var f = (schema.fields||[]).find(function(q){
        var t=__labelText(q);
        return keys.some(function(k){ return t.includes(k); });
      });
      return f?f.id:null;
    }
    return {
      name:  fid(['姓名','名字','称呼','name','Name']),
      phone: fid(['电话','手机','手机号','联系电话','phone','tel','联系方式','電話']),
      email: fid(['邮箱','电子邮箱','email','Email','郵箱']),
      group: fid(['团体','团队','单位','公司','学校','组织','小组','group']),
      event: fid(['活动名','活动名称','活动','课程','会议','event']),

      // 更严格的关键词，避免把“时间”都算作开始/结束
      startDate: fid(['开始日期','起始日期','start date']),
      startTime: fid(['开始时间','start time']),
      endDate:   fid(['结束日期','截止日期','end date']),
      endTime:   fid(['结束时间','end time']),

      people: fid(['人数','参与人数','报名人数','人数（人）','participants'])
    };
  }
  function valueByQuestion(d,q){
    if(!d||!q) return '';
    var label = __labelText(q);

    if(q.id!=null && Object.prototype.hasOwnProperty.call(d,q.id) && d[q.id]!=null && d[q.id]!==''){
      return d[q.id];
    }
    if(label && Object.prototype.hasOwnProperty.call(d,label) && d[label]!=null && d[label]!==''){
      return d[label];
    }
    var want = normalizeKey(label);
    var hit = '';
    Object.keys(d||{}).some(function(k){
      if(normalizeKey(k)===want){ hit=d[k]; return true; }
      return false;
    });
    return hit;
  }

  var __dynFieldIds=[];
  function rebuildRespHeader(){
    var headTr=document.querySelector('#respTable thead tr'); if(!headTr) return;
    var fixed=getFixedFieldIds();
    var exclude=new Set(Object.values(fixed).filter(Boolean));
    __dynFieldIds=(schema.fields||[]).filter(function(q){ return !exclude.has(q.id); }).map(function(q){return q.id;});

    var before=['ID','姓名','电话','邮箱','团体','活动名','开始','结束','人数'];
    if(!fixed.name)   before.splice(before.indexOf('姓名'),1);
    if(!fixed.phone)  before.splice(before.indexOf('电话'),1);
    if(!fixed.email)  before.splice(before.indexOf('邮箱'),1);
    if(!fixed.group)  before.splice(before.indexOf('团体'),1);
    if(!fixed.event)  before.splice(before.indexOf('活动名'),1);
    if(!(fixed.startDate||fixed.startTime)) before.splice(before.indexOf('开始'),1);
    if(!(fixed.endDate||fixed.endTime))     before.splice(before.indexOf('结束'),1);
    if(!fixed.people) before.splice(before.indexOf('人数'),1);

    var mid=__dynFieldIds.map(function(fid){
      var q=(schema.fields||[]).find(function(x){return x.id===fid});
      var t=escapeHTML(__labelText(q)||('字段'+fid));
      return '<th>'+t+'</th>';
    }).join('');

    var after=['状态','审核说明','导出','发送邮件','删除'];
    headTr.innerHTML = before.map(function(h){return '<th>'+h+'</th>'}).join('') + mid + after.map(function(h){return '<th>'+h+'</th>'}).join('');
  }

  async function loadResponses(){
    var site=(document.body.dataset.site||'').trim();
    if(!site){
      var cols=document.querySelectorAll('#respTable thead th').length||14;
      tbody.innerHTML='<tr><td colspan="'+cols+'" class="muted">正在自动保存表单以加载数据…</td></tr>';
      await ensureServerSaved();
      site=(document.body.dataset.site||'').trim();
      if(!site){tbody.innerHTML='<tr><td colspan="'+cols+'" class="muted">请先在上方填写“网站名”，系统会自动保存后再加载数据</td></tr>';return;}
    }

    rebuildRespHeader();

    var url='/site/'+encodeURIComponent(site)+'/admin/api/submissions?q='+encodeURIComponent(qInp.value||'');
    try{
      var res=await fetch(url); var data=await res.json();
      var cols=document.querySelectorAll('#respTable thead th').length||14;
      if(!res.ok){tbody.innerHTML='<tr><td colspan="'+cols+'">加载失败：'+(data.error||res.status)+'</td></tr>';return;}
      if(!Array.isArray(data.items)||data.items.length===0){tbody.innerHTML='<tr><td colspan="'+cols+'" class="muted">暂无数据</td></tr>';return;}
      tbody.innerHTML='';

      var fixed=getFixedFieldIds();
      function qById(id){ return (schema.fields||[]).find(function(x){return x.id===id}); }

      data.items.forEach(function(row){
        var d=row.data||{}; var tr=document.createElement('tr');

        var name = fmtVal(valueByQuestion(d, qById(fixed.name)));
        var phone= fmtVal(valueByQuestion(d, qById(fixed.phone)));
        var email= fmtVal(valueByQuestion(d, qById(fixed.email)));
        var group= fmtVal(valueByQuestion(d, qById(fixed.group)));
        var eventN= fmtVal(valueByQuestion(d, qById(fixed.event)));

        var start = [ valueByQuestion(d, qById(fixed.startDate)), valueByQuestion(d, qById(fixed.startTime)) ].map(fmtVal).filter(Boolean).join(' ');
        var end   = [ valueByQuestion(d, qById(fixed.endDate)),   valueByQuestion(d, qById(fixed.endTime))   ].map(fmtVal).filter(Boolean).join(' ');
        var people= fmtVal(valueByQuestion(d, qById(fixed.people)));

        var tds=[];
        function push(v){ tds.push('<td>'+(v||'—')+'</td>'); }
        // 固定列顺序（仅在存在对应题目时输出）
        if(fixed.name)   push(name);
        if(fixed.phone)  push(phone);
        if(fixed.email)  push(email);
        if(fixed.group)  push(group);
        if(fixed.event)  push(eventN);
        if(fixed.startDate || fixed.startTime) push(start);
        if(fixed.endDate   || fixed.endTime)   push(end);
        if(fixed.people)  push(people);

        var dynTds = __dynFieldIds.map(function(fid){
          var q=(schema.fields||[]).find(function(x){return x.id===fid});
          return '<td>'+(fmtVal(valueByQuestion(d,q))||'—')+'</td>';
        }).join('');

        var pill=row.status==='已通过'?'<span class="pill good">通过</span>':(row.status==='未通过'?'<span class="pill bad">不通过</span>':'<span class="pill wait">待审核</span>');

        tr.innerHTML =
          '<td>'+row.id+'</td>'+
          tds.join('')+
          dynTds+
          '<td>'+pill+'</td>'+
          '<td><input class="tiny" style="width:160px" placeholder="审核说明" value="'+(row.review_comment||'')+'" data-cid="'+row.id+'"></td>'+
          '<td><a class="btn gray" href="/site/'+site+'/admin/export_word/'+row.id+'" target="_blank">Word</a> '+
               '<a class="btn gray" href="/site/'+site+'/admin/export_excel/'+row.id+'" target="_blank">Excel</a></td>'+
          '<td><button class="btn" data-mail="'+row.id+'">发送邮件</button></td>'+
          '<td><button class="btn danger" data-del="'+row.id+'">删除</button></td>';

        tbody.appendChild(tr);

        var passBtn=document.createElement('button'); passBtn.className='btn'; passBtn.style.background='linear-gradient(180deg,#22c55e,#16a34a)'; passBtn.style.color='#fff'; passBtn.textContent='通过';
        var failBtn=document.createElement('button'); failBtn.className='btn'; failBtn.style.background='linear-gradient(180deg,#ef4444,#b91c1c)'; failBtn.style.color='#fff'; failBtn.textContent='不通过';
        var commentInput=tr.querySelector('input[data-cid="'+row.id+'"]');
        var opDiv=document.createElement('div'); opDiv.style.display='flex'; opDiv.style.gap='6px'; opDiv.style.marginTop='6px';
        opDiv.appendChild(passBtn); opDiv.appendChild(failBtn); commentInput.parentNode.appendChild(opDiv);

        passBtn.addEventListener('click',async function(){await updateStatus(site,row.id,'已通过',commentInput.value); showToast('已标记通过')});
        failBtn.addEventListener('click',async function(){await updateStatus(site,row.id,'未通过',commentInput.value); showToast('已标记不通过')});
        tr.querySelector('[data-del="'+row.id+'"]').addEventListener('click',async function(){if(!confirm('确认删除该记录？'))return; await delRow(site,row.id); showToast('已删除')});
          tr.querySelector('[data-mail="' + row.id + '"]').addEventListener('click', async function () {
              try {
                  const r = await fetch('/site/' + site + '/admin/api/send_mail', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({id: row.id})
                  });
                  const d2 = await r.json().catch(() => ({}));
                  if (!r.ok || !d2.ok) {
                      alert('发送失败：' + (d2.error || r.status));
                      return;
                  }
                  showToast('邮件已发送');
              } catch (err) {
                  alert('发送失败：' + err.message);
              }
          });
      });
    }catch(e){
      var cols=document.querySelectorAll('#respTable thead th').length||14;
      tbody.innerHTML='<tr><td colspan="'+cols+'">加载失败</td></tr>';
    }
  }
  async function updateStatus(site, id, status, comment) {
  const r = await fetch('/site/' + encodeURIComponent(site) + '/admin/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: id,
      status: status,
      review_comment: comment || ''
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    alert('操作失败：' + (d.error || r.status));
    return;
  }
  showToast('已更新状态');
  loadResponses();
}
async function delRow(site, id) {
  const r = await fetch('/site/' + encodeURIComponent(site) + '/admin/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    alert('删除失败：' + (d.error || r.status));
    return;
  }
  showToast('已删除');
  loadResponses();
}

  bind(document.getElementById('btnExportAll'),'click',function(){
    var site=(document.body.dataset.site||'').trim(); if(!site){alert('请先填写网站名，系统会自动保存'); return;}
    location.href='/site/'+site+'/admin/api/export_all_excel'; showToast('已开始导出');
  });
  bind(document.getElementById('btnGallery'),'click',async function(){
    var site=(document.body.dataset.site||'').trim(); if(!site){alert('请先填写网站名，系统会自动保存'); return;}
    var r=await fetch('/site/'+site+'/admin/api/gallery'); var d=await r.json();
    if(!r.ok||!Array.isArray(d.items)){alert('加载失败'); return;}
    var galleryRoot=document.getElementById('galleryRoot'); if(galleryRoot) galleryRoot.innerHTML='';
    d.items.forEach(function(it){
      var a=document.createElement('a'); a.href=it.url; a.download=''; a.title='点击下载';
      var img=new Image(); img.src=it.url; img.style.width='160px'; img.style.height='120px'; img.style.objectFit='cover'; img.style.borderRadius='10px';
      a.appendChild(img); if(galleryRoot) galleryRoot.appendChild(a);
    });
    var galleryModalEl=document.getElementById('galleryModal'); if(galleryModalEl) galleryModalEl.classList.add('show');
  });
  bind(document.getElementById('closeGallery'),'click',function(){
    var gm=document.getElementById('galleryModal'); if(gm) gm.classList.remove('show');
  });
  (function(){
    var gm=document.getElementById('galleryModal');
    bind(gm,'click',function(e){ if(e.target===gm){ gm.classList.remove('show'); } });
  })();

  bind(document.getElementById('btnSearch'),'click',function(){ rebuildRespHeader(); loadResponses(); });
  bind(document.getElementById('btnRefresh'),'click',function(){ rebuildRespHeader(); loadResponses(); });
  if(document.getElementById('autoTick')){
    setInterval(function(){
      if(document.getElementById('autoTick').checked && document.getElementById('tab-responses').classList.contains('active')) loadResponses();
    },30000);
  }
});
