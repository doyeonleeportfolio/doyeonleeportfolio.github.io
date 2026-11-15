/* ==========================================================
   관리도구 — 사이트와 같은 틀(Works · Research · CV · About · Contact)로
   content/data.js 를 고친다. 저장 = GitHub 저장소에 커밋 하나 (github.js)
   = 1분쯤 뒤 사이트 반영. 화면 글은 사이트처럼 전부 영문.
   ========================================================== */
(function () {
  'use strict';

  var DATA = null;
  var dirty = false;
  var view = 'works';        // home | works | studies | cv | about | contact — 사이트 해시와 같은 이름
  var editing = null;        // { list: 'works'|'studies'|'news', id: string }

  var GH = { owner: 'doyeonleeportfolio', repo: 'doyeonleeportfolio.github.io', branch: 'main' };
  /* 권한이 미리 채워진 토큰 만들기 링크 — 고를 게 적어야 틀리지 않는다.
     public_repo = 공개 저장소 쓰기 (이 사이트 저장소가 공개라 이것만으로 충분) */
  var TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=public_repo&description=' +
    encodeURIComponent('Portfolio admin — ' + GH.repo);
  /* 웹에서 올릴 수 있는 한 파일의 크기.
     GitHub blobs API 는 파일을 base64(×1.33)로 받는데, 40MiB(=base64 53MB)까지만 받고
     41MiB 부터 422 "input was too large to process" 를 돌려준다 (2026-10-13 측정).
     문서의 "100MB 까지" 는 git push 에만 해당한다. 여유 2MB 를 두고 38MB. */
  var MAX_WEB_UPLOAD = 38 * 1024 * 1024;
  var store = null;          // GitHubStore — 로그인한 뒤에만 생긴다
  var pendingUploads = {};   // 저장 전까지 브라우저가 들고 있는 새 파일 { 경로: File }
  var pendingDeletes = {};   // 저장할 때 함께 지울 경로 (파일 또는 폴더)
  var previewUrls = {};      // 아직 사이트에 없는 파일의 미리보기 주소 (blob:)

  var main = document.getElementById('main');
  var saveBtn = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var banner = document.getElementById('banner');
  var siteNameBtn = document.getElementById('siteName');
  var siteLink = document.getElementById('siteLink');
  var navBtns = Array.prototype.slice.call(document.querySelectorAll('[data-view]'));

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2600);
  }

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function field(labelText, control, hintText) {
    var f = el('div', 'field');
    var lab = el('label', 'field-label', labelText);
    f.appendChild(lab);
    f.appendChild(control);
    if (hintText) f.appendChild(el('p', 'field-hint', hintText));
    return f;
  }

  function input(value, onInput, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value == null ? '' : value;   // 0 도 값이다 (hover 시작점 0초)
    if (placeholder) i.placeholder = placeholder;
    i.addEventListener('input', function () { onInput(i.value); setDirty(); });
    return i;
  }

  function checkbox(checked, onChange, labelText) {
    var lab = el('label', 'check-row');
    var c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!checked;
    c.addEventListener('change', function () { onChange(c.checked); setDirty(); });
    lab.appendChild(c);
    lab.appendChild(document.createTextNode(labelText));
    return lab;
  }

  function select(value, options, onChange) {
    var s = document.createElement('select');
    options.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = String(value);
    s.addEventListener('change', function () { onChange(s.value); setDirty(); });
    return s;
  }

  function textarea(value, rows, onInput) {
    var ta = document.createElement('textarea');
    ta.value = value || '';
    ta.rows = rows;
    ta.addEventListener('input', function () { onInput(ta.value); setDirty(); });
    return ta;
  }

  function lines(v) {
    return v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* "a, b, c" → ['a','b','c'] */
  function splitList(v) {
    return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function joinList(arr) {
    return Array.isArray(arr) ? arr.join(', ') : String(arr || '');
  }

  /* 홈 문양의 주제 키 — js/home.js MOTIFS · js/app.js THEME_LABELS 와 같은 어휘 */
  var THEMES = [
    ['heritage', 'Digital Heritage'],
    ['media', 'Interactive Media Art'],
    ['xr', 'XR'],
    ['data', 'Data Analysis'],
    ['moving', 'Moving Image']
  ];

  /* js/app.js STATUS_LABELS 와 같은 이름 */
  var STATUS = [['ongoing', 'Ongoing'], ['proposed', 'Proposed'], ['completed', 'Completed']];

  function slugBase(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function uniqueId(title) {
    var base = slugBase(title) || 'item';
    /* 'about' / 'studies' 는 공용 미디어 폴더 — 항목 id 로 쓰이면 삭제 시 그 폴더가 날아간다 */
    var all = ['about', 'studies'].concat(DATA.works.concat(DATA.studies, DATA.news || []).map(function (x) { return x.id; }));
    var id = base, n = 2;
    while (all.indexOf(id) >= 0) { id = base + '-' + n; n++; }
    return id;
  }

  /* 파일 이름은 영문·숫자만 — 같은 이름이 되면 uploadInto 가 -2, -3 … 을 붙인다 */
  function fileSlug(name) {
    var dot = name.lastIndexOf('.');
    var ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    var base = slugBase(dot >= 0 ? name.slice(0, dot) : name) || 'file';
    return base + ext;
  }

  /* 사이트 데이터에서 이미 쓰고 있는 미디어 경로 전부 */
  function usedMediaPaths() {
    var used = {};
    (DATA.works || []).concat(DATA.studies || []).forEach(function (it) {
      if (it.cover) used[it.cover] = true;
      (it.media || []).forEach(function (m) { if (m.src) used[m.src] = true; });
    });
    if (DATA.about && DATA.about.image) used[DATA.about.image] = true;
    if (DATA.about && DATA.about.cvPdf) used[DATA.about.cvPdf] = true;
    (DATA.news || []).forEach(function (n) {
      (n.images || []).forEach(function (src) { if (src) used[src] = true; });
    });
    if (DATA.studiesGif) used[DATA.studiesGif] = true;
    return used;
  }

  function extType(src) {
    var m = /\.([a-z0-9]+)$/i.exec(src || '');
    var e = m ? m[1].toLowerCase() : '';
    if (['mp4', 'webm', 'mov', 'm4v'].indexOf(e) >= 0) return 'video';
    if (['glb', 'gltf'].indexOf(e) >= 0) return 'model';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'].indexOf(e) >= 0) return 'image';
    return null;
  }

  function setDirty() {
    dirty = true;
    saveStatus.textContent = 'Unsaved changes';
    saveStatus.classList.add('dirty');
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- 파일 · 저장 ---------- */

  /* 관리도구 안의 미리보기 주소 — 방금 올려서 아직 사이트에 없는 파일은 브라우저 사본으로 */
  function mediaUrl(src) {
    return previewUrls[src] || '/' + src;
  }

  /* 새 파일은 저장할 때 데이터와 같은 커밋으로 올라간다 — 그때까지 브라우저에 둔다 */
  function stageUpload(file, destRel) {
    if (file.size > MAX_WEB_UPLOAD) {
      return Promise.reject(new Error(
        '"' + file.name + '" is ' + Math.round(file.size / 1048576) + ' MB — the admin can upload up to 38 MB per file.\n' +
        'Compress the video and add it again, or add it as a YouTube / Vimeo link.'));
    }
    pendingUploads[destRel] = file;
    delete pendingDeletes[destRel];
    if (previewUrls[destRel]) URL.revokeObjectURL(previewUrls[destRel]);
    previewUrls[destRel] = URL.createObjectURL(file);
    setDirty();
    return Promise.resolve();
  }

  function stageDelete(destRel) {
    pendingDeletes[destRel] = true;
    Object.keys(pendingUploads).forEach(function (p) {
      if (p === destRel || p.indexOf(destRel + '/') === 0) delete pendingUploads[p];
    });
    setDirty();
  }

  /* 데이터 + 새 파일 + 삭제를 커밋 하나로. 저장이 곧 사이트 반영이다 */
  function save(force) {
    if (!DATA || !store) return;
    saveBtn.disabled = true;
    var text = 'window.SITE_DATA = ' + JSON.stringify(DATA, null, 2) + ';\n';
    var ups = {};
    Object.keys(pendingUploads).forEach(function (p) { ups[p] = pendingUploads[p]; });
    var dels = Object.keys(pendingDeletes);
    var msg = 'Admin save — ' + new Date().toLocaleString('sv-SE').slice(0, 16);
    saveStatus.textContent = 'Saving…';
    store.commit(text, ups, dels, msg, force, function (m) { saveStatus.textContent = m; })
      .then(function () {
        saveBtn.disabled = false;
        Object.keys(ups).forEach(function (p) { if (pendingUploads[p] === ups[p]) delete pendingUploads[p]; });
        dels.forEach(function (p) { delete pendingDeletes[p]; });
        dirty = false;
        saveStatus.classList.remove('dirty');
        saveStatus.textContent = 'Saved · publishing…';
        toast('Saved — the site updates in about a minute');
        watchLive(text, function (ok) {
          if (dirty) return;   // 그 사이 또 고쳤으면 상태줄은 그쪽 몫
          saveStatus.textContent = ok
            ? 'Live on the site ✓ ' + new Date().toTimeString().slice(0, 5)
            : 'Saved · the site is slow to update — try refreshing it';
        });
      })
      .catch(function (e) {
        saveBtn.disabled = false;
        setDirty();
        if (e.code === 'conflict') {
          if (window.confirm('Someone saved from another device or tab first.\n\n' +
              'Overwrite it with what is on this screen?\n' +
              'Cancel changes nothing — reload the page to get the latest version.')) {
            save(true);
          }
          return;
        }
        var why = e.status === 401 ? 'Login expired — log out and log in again with a new token'
          : e.status === 403 || e.status === 404 ? 'No permission to save — Log out (top right), then "Create token" for a new one'
          : 'Save failed';
        toast(why);
        /* 토스트는 금방 사라진다 — 이유는 상단 상태줄에 남긴다 */
        saveStatus.textContent = why + ' · ' + e.message;
      });
  }

  /* 사이트가 방금 저장한 data.js 를 내보내기 시작하면 반영 끝 */
  var liveTimer = null;
  function watchLive(text, done) {
    var want = text.replace(/\r\n/g, '\n');
    var tries = 0;
    if (liveTimer) clearTimeout(liveTimer);
    function again() {
      if (++tries >= 40) { done(false); return; }   // 6초 × 40 = 4분
      liveTimer = setTimeout(poll, 6000);
    }
    function poll() {
      fetch(location.origin + '/content/data.js?live=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) { if (t.replace(/\r\n/g, '\n') === want) done(true); else again(); })
        .catch(again);
    }
    poll();
  }

  saveBtn.addEventListener('click', function () { save(false); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
  });

  /* ---------- PDF → 페이지 이미지 ---------- */

  /* pdf.js 는 이 기능을 쓸 때만 받아온다 (사이트에는 올라가지 않는다 — 관리도구에서만 쓴다) */
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var PDF_PAGE_W = 1600;   // 페이지 이미지 가로 길이 (px) — 화면으로 보기 충분하고 커밋이 무겁지 않다
  var pdfjsPromise = null;

  function ensurePdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = PDFJS + 'pdf.min.js';
      sc.onload = function () {
        if (!window.pdfjsLib) { reject(new Error('Could not start the PDF converter')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      sc.onerror = function () {
        pdfjsPromise = null;
        reject(new Error('Could not load the PDF converter — check your internet connection'));
      };
      document.head.appendChild(sc);
    });
    return pdfjsPromise;
  }

  /* PDF 한 권 → 페이지마다 JPEG 한 장. 사이트는 같은 doc 의 페이지들을 두 칸으로 늘어놓는다 */
  function rasterizePdf(file, onProgress) {
    var base = fileSlug(file.name).replace(/\.pdf$/, '');
    return ensurePdfjs()
      .then(function () { return file.arrayBuffer(); })
      .then(function (buf) { return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; })
      .then(function (pdf) {
        var files = [];
        var digits = Math.max(2, String(pdf.numPages).length);
        var at = 0;

        /* 한 장씩 차례로 — 수십 장을 한꺼번에 그리면 브라우저 메모리가 넘친다 */
        function nextPage() {
          if (++at > pdf.numPages) return Promise.resolve();
          var pageNo = at;
          onProgress(pageNo, pdf.numPages);
          return pdf.getPage(pageNo).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: Math.min(3, PDF_PAGE_W / vp1.width) });
            var c = document.createElement('canvas');
            c.width = Math.round(vp.width);
            c.height = Math.round(vp.height);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';   // PDF 바탕은 투명 — 흰 종이를 깔아 준다
            ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              return new Promise(function (res) {
                c.toBlob(function (blob) {
                  res(new File([blob], base + '-p' + ('0000' + pageNo).slice(-digits) + '.jpg',
                    { type: 'image/jpeg' }));
                }, 'image/jpeg', 0.86);
              });
            });
          }).then(function (f) {
            files.push(f);
            return nextPage();
          });
        }

        return nextPage().then(function () {
          if (pdf.destroy) pdf.destroy();
          return { doc: base, files: files };
        });
      });
  }

  /* PDF 에서 나온 페이지들은 한 덩어리로 다룬다 — 한 장씩 옮기면 책이 흩어진다 */
  function mediaBlock(media, i) {
    var doc = media[i] && media[i].doc;
    if (!doc) return [i, i + 1];
    var a = i, b = i;
    while (a > 0 && media[a - 1].doc === doc) a--;
    while (b < media.length && media[b].doc === doc) b++;
    return [a, b];
  }

  /* 덩어리 하나를 이웃 덩어리와 통째로 맞바꾼다 */
  function moveBlock(media, start, end, dir) {
    if (dir < 0) {
      if (start === 0) return;
      var prev = mediaBlock(media, start - 1);
      media.splice.apply(media, [prev[0], 0].concat(media.splice(start, end - start)));
    } else {
      if (end >= media.length) return;
      var next = mediaBlock(media, end);
      media.splice.apply(media, [start, 0].concat(media.splice(next[0], next[1] - next[0])));
    }
  }

  /* ---------- 파일 선택/업로드 공통 ---------- */

  function pickFiles(accept, multiple, cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = !!multiple;
    inp.addEventListener('change', function () {
      if (inp.files.length) cb(Array.prototype.slice.call(inp.files));
    });
    inp.click();
  }

  function uploadInto(folder, files, done) {
    var results = [];
    var taken = usedMediaPaths();
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var name = fileSlug(f.name);
        var rel = 'content/media/' + folder + '/' + name;
        /* 같은 이름이 이미 있으면 -2, -3… 을 붙여 덮어쓰기를 막는다 */
        var dot = name.lastIndexOf('.');
        var base = dot >= 0 ? name.slice(0, dot) : name;
        var ext = dot >= 0 ? name.slice(dot) : '';
        var n = 2;
        while (taken[rel]) {
          rel = 'content/media/' + folder + '/' + base + '-' + n + ext;
          n++;
        }
        taken[rel] = true;
        return stageUpload(f, rel).then(function () { results.push(rel); });
      });
    });
    chain
      .then(function () { done(null, results); })
      .catch(function (e) { done(e, results); });
  }

  /* 못 올린 파일을 모르고 저장해 버리지 않게 — 토스트 말고 상태줄과 알림창에도 남긴다 */
  function uploadFailed(err) {
    toast('Upload failed: ' + err.message.split('\n')[0]);
    saveStatus.textContent = 'Upload failed — ' + err.message.replace(/\n/g, ' ');
    saveStatus.classList.add('dirty');
    window.alert('Some files were not added.\n\n' + err.message);
  }

  function uploadButton(labelText, accept, multiple, folder, onDone) {
    var b = el('button', 'upload-btn', labelText);
    b.addEventListener('click', function () {
      pickFiles(accept, multiple, function (files) {
        uploadInto(folder, files, function (err, paths) {
          if (err) uploadFailed(err);
          if (paths.length) onDone(paths);
        });
      });
    });
    return b;
  }

  /* 파일 하나 자리 (사진 · PDF · GIF) — 있으면 미리보기 + 제거, 없으면 올리기 */
  function singleFile(src, opts) {
    var wrap = el('div');
    if (src) {
      if (opts.preview) {
        var img = el('img', 'cover-preview');
        img.src = mediaUrl(src);
        wrap.appendChild(img);
      } else {
        wrap.appendChild(el('div', 'media-src', src));
      }
      var rm = el('button', 'mini-btn danger', opts.removeLabel);
      rm.addEventListener('click', function () {
        if (opts.confirm && !confirm(opts.confirm)) return;
        if (opts.deleteFile && src.indexOf('content/media/') === 0) stageDelete(src);
        opts.set('');
        setDirty(); render();
      });
      wrap.appendChild(rm);
    } else {
      wrap.appendChild(uploadButton(opts.uploadLabel, opts.accept, false, opts.folder, function (paths) {
        opts.set(paths[0]);
        setDirty(); render();
      }));
    }
    return wrap;
  }

  /* ---------- 렌더링 ---------- */

  function sectionTitle(text) {
    main.appendChild(el('h2', 'section-title', text));
  }

  function backButton(label) {
    var back = el('button', 'editor-back', '← Back to ' + label);
    back.addEventListener('click', function () { editing = null; render(); });
    main.appendChild(back);
  }

  /* 「View site」는 지금 고치는 방(또는 항목)을 연다 */
  function siteHash() {
    if (editing && editing.list === 'works') return '#w/' + encodeURIComponent(editing.id);
    if (editing && editing.list === 'studies') return '#s/' + encodeURIComponent(editing.id);
    return '#' + view;
  }

  function render() {
    navBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    siteNameBtn.textContent = DATA.siteName || 'PORTFOLIO';
    main.textContent = '';
    main.scrollTop = 0;
    if (editing) {
      if (editing.list === 'news') renderNewsEditor();
      else renderEditor();
    } else if (view === 'home') renderHome();
    else if (view === 'cv') renderCv();
    else if (view === 'about') renderAbout();
    else if (view === 'contact') renderContact();
    else renderList(view === 'studies' ? 'studies' : 'works');
    siteLink.href = '/' + siteHash();
  }

  navBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (!DATA) return;
      view = b.getAttribute('data-view');
      editing = null;
      render();
    });
  });

  /* ----- Home — 사이트 이름을 누르면 오는 곳 ----- */

  function renderHome() {
    sectionTitle('Home');
    main.appendChild(field('Site name', input(DATA.siteName, function (v) { DATA.siteName = v; }), 'Shown at the top left of every page. e.g. DOYEON LEE'));
    main.appendChild(field('Search description',
      input(DATA.siteTagline, function (v) { DATA.siteTagline = v; }, 'Student in Seoul working between …'),
      'Not shown on the page — only search engines (Google) read it. Include your name, field and city.'));
    main.appendChild(el('p', 'field-hint',
      'The home page keywords (Digital Heritage, Interactive Media Art …) are set per work and research, under Themes.'));
  }

  /* ----- About — 사이트 About 과 같은 순서: 사진 · Statement · Biography · Directions ----- */

  function renderAbout() {
    sectionTitle('About');
    var ab = DATA.about;
    main.appendChild(field('Photo (optional)', singleFile(ab.image, {
      preview: true, folder: 'about', accept: 'image/*',
      uploadLabel: 'Upload photo', removeLabel: 'Remove photo',
      set: function (v) { ab.image = v; }
    })));

    main.appendChild(field('Statement',
      textarea(ab.statement || ab.text, 8, function (v) { ab.statement = v; ab.text = v; }),
      'First person · 80–120 words · a blank line between paragraphs. What you work with and what you ask.'));

    main.appendChild(field('Biography',
      textarea(ab.bio, 4, function (v) { ab.bio = v; }),
      'Third person ("Doyeon Lee is …") · under 80 words. Curators and catalogues copy this paragraph as it is.'));

    main.appendChild(field('Directions',
      input(joinList(ab.directions), function (v) { ab.directions = splitList(v); }, 'Interactive Installation, XR & Immersive Space, …'),
      'Comma-separated · 4–8 items. Shown as one line on the About page.'));
  }

  /* ----- Contact ----- */

  function renderContact() {
    sectionTitle('Contact');
    var cwrap = el('div');
    DATA.contact.forEach(function (c, i) {
      var row = el('div', 'contact-edit-row');
      var l = el('div', 'c-label'); l.appendChild(input(c.label, function (v) { c.label = v; }, 'Label (e.g. Email)'));
      var v = el('div', 'c-value'); v.appendChild(input(c.value, function (val) { c.value = val; }, 'Value'));
      var h = el('div', 'c-href'); h.appendChild(input(c.href, function (val) { c.href = val; }, 'Link (blank = automatic)'));
      var d = el('button', 'mini-btn danger', 'Delete');
      d.addEventListener('click', function () { DATA.contact.splice(i, 1); setDirty(); render(); });
      row.appendChild(l); row.appendChild(v); row.appendChild(h); row.appendChild(d);
      cwrap.appendChild(row);
    });
    var add = el('button', 'add-btn', '+ Add contact');
    add.addEventListener('click', function () {
      DATA.contact.push({ label: '', value: '', href: '' });
      setDirty(); render();
    });
    cwrap.appendChild(add);
    main.appendChild(field('Contact list', cwrap,
      'An email becomes a mail link when Link is blank. Other links need the full https:// address.'));
  }

  /* ----- Works · Research 목록 ----- */

  function itemThumb(item) {
    var src = item.cover;
    if (!src && item.media) {
      for (var i = 0; i < item.media.length; i++) {
        if ((item.media[i].type || extType(item.media[i].src)) === 'image') { src = item.media[i].src; break; }
      }
    }
    if (src) {
      var img = el('img', 'item-thumb');
      img.src = mediaUrl(src);
      return img;
    }
    var first = item.media && item.media[0];
    var t = first ? (first.type || extType(first.src) || '—') : '—';
    var label = t === 'video' ? 'VIDEO' : t === 'model' ? '3D' : t === 'embed' ? 'LINK' : '—';
    return el('div', 'item-thumb-blank', label);
  }

  function statusLabel(k) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i][0] === k) return STATUS[i][1];
    return 'Completed';
  }

  function renderList(listName) {
    var arr = DATA[listName];
    var isWorks = listName === 'works';
    sectionTitle(isWorks ? 'Works' : 'Research');
    main.appendChild(el('p', 'field-hint', isWorks
      ? 'The top item comes first in the Works grid. Reorder with ↑ ↓ — put the strongest work first.'
      : 'Grouped on the site as Ongoing → Proposed → Completed; the ↑ ↓ order applies within each group.'));

    var list = el('div', 'item-list');
    arr.forEach(function (item, i) {
      var row = el('div', 'item-row');
      row.appendChild(itemThumb(item));
      row.appendChild(el('span', 'item-name', item.title || '(untitled)'));
      if (!isWorks) row.appendChild(el('span', 'item-year', statusLabel(item.status)));
      if (isWorks && item.hover && item.hover.enabled === false) row.appendChild(el('span', 'item-year', 'Hover off'));
      row.appendChild(el('span', 'item-year', item.year || ''));

      var up = el('button', 'mini-btn', '↑');
      up.disabled = i === 0;
      up.addEventListener('click', function () {
        arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
        setDirty(); render();
      });
      var down = el('button', 'mini-btn', '↓');
      down.disabled = i === arr.length - 1;
      down.addEventListener('click', function () {
        arr.splice(i + 1, 0, arr.splice(i, 1)[0]);
        setDirty(); render();
      });
      var edit = el('button', 'mini-btn', 'Edit');
      edit.addEventListener('click', function () {
        editing = { list: listName, id: item.id };
        render();
      });
      var del = el('button', 'mini-btn danger', 'Delete');
      del.addEventListener('click', function () {
        if (!confirm('Delete "' + (item.title || 'untitled') + '"?\nIts uploaded media files are deleted too.')) return;
        arr.splice(i, 1);
        stageDelete('content/media/' + item.id);
        setDirty(); render();
      });
      row.appendChild(up); row.appendChild(down); row.appendChild(edit); row.appendChild(del);
      list.appendChild(row);
    });
    if (!arr.length) list.appendChild(el('p', 'field-hint', isWorks ? 'No works yet.' : 'No research entries yet.'));
    main.appendChild(list);

    var add = el('button', 'add-btn', isWorks ? '+ Add work' : '+ Add research');
    add.addEventListener('click', function () {
      var title = prompt('Title (you can change it later)', '');
      if (title === null) return;
      title = title.trim() || (isWorks ? 'New Work' : 'New Research');
      var item = {
        id: uniqueId(title),
        title: title,
        year: String(new Date().getFullYear()),
        cover: '',
        media: [],
        description: '',
        links: []
      };
      if (isWorks) {
        item.medium = ''; item.duration = ''; item.format = ''; item.role = '';
        item.tools = ''; item.credits = ''; item.exhibitions = []; item.themes = []; item.descriptionKo = '';
      } else {
        item.status = 'ongoing'; item.keywords = []; item.summary = ''; item.relatedWorks = []; item.themes = [];
      }
      arr.push(item);
      editing = { list: listName, id: item.id };
      setDirty(); render();
    });
    main.appendChild(add);

    /* Research 페이지 GIF — 사이트는 목록 아래에 늘 건다 */
    if (!isWorks) {
      var gifField = field('Research page GIF (optional)', singleFile(DATA.studiesGif, {
        preview: true, folder: 'studies', accept: 'image/*', deleteFile: true,
        uploadLabel: 'Upload GIF / image', removeLabel: 'Remove GIF',
        confirm: 'Remove the Research page GIF?\nThe uploaded file is deleted too.',
        set: function (v) { DATA.studiesGif = v; }
      }), 'An animated image shown below the list on the Research page.');
      gifField.style.marginTop = '48px';
      main.appendChild(gifField);
    }
  }

  /* ----- Works · Research 편집기 ----- */

  function findEditing() {
    var arr = DATA[editing.list];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === editing.id) return arr[i];
    return null;
  }

  function mediaThumb(m) {
    var t = m.type || extType(m.src) || 'image';
    if (t === 'image') {
      var img = el('img', 'media-thumb');
      img.src = mediaUrl(m.src);
      return img;
    }
    return el('div', 'media-badge', t === 'video' ? 'VIDEO' : t === 'model' ? '3D' : 'LINK');
  }

  function moveBtns(media, start, end) {
    var btns = el('div', 'row-btns');
    var up = el('button', 'mini-btn', '↑');
    up.disabled = start === 0;
    up.addEventListener('click', function () { moveBlock(media, start, end, -1); setDirty(); render(); });
    var down = el('button', 'mini-btn', '↓');
    down.disabled = end >= media.length;
    down.addEventListener('click', function () { moveBlock(media, start, end, 1); setDirty(); render(); });
    btns.appendChild(up); btns.appendChild(down);
    return btns;
  }

  function mediaRow(media, i) {
    var m = media[i];
    var row = el('div', 'media-row');
    row.appendChild(mediaThumb(m));

    var info = el('div', 'media-info');
    var cap = document.createElement('input');
    cap.className = 'media-caption-input';
    cap.value = m.caption || '';
    cap.placeholder = 'Caption (optional)';
    cap.addEventListener('input', function () { m.caption = cap.value; setDirty(); });
    info.appendChild(cap);
    info.appendChild(el('div', 'media-src', m.src));
    row.appendChild(info);

    var btns = moveBtns(media, i, i + 1);
    var del = el('button', 'mini-btn danger', 'Delete');
    del.addEventListener('click', function () {
      if (!confirm('Delete this media?')) return;
      var t = m.type || extType(m.src);
      if (t !== 'embed' && m.src && m.src.indexOf('content/media/') === 0) stageDelete(m.src);
      media.splice(i, 1);
      setDirty(); render();
    });
    btns.appendChild(del);
    row.appendChild(btns);
    return row;
  }

  /* PDF 한 권 = 한 줄. 페이지 수십 장이 목록을 덮지 않게 */
  function pdfBlockRow(media, blk) {
    var pages = media.slice(blk[0], blk[1]);
    var row = el('div', 'media-row');
    row.appendChild(mediaThumb(pages[0]));

    var info = el('div', 'media-info');
    info.appendChild(el('div', null, 'PDF · ' + pages.length + ' pages — laid out in two columns in the detail view'));
    info.appendChild(el('div', 'media-src', pages[0].src.replace(/-p\d+\.jpg$/i, '') + ' — ' + pages.length + ' pages'));
    row.appendChild(info);

    var btns = moveBtns(media, blk[0], blk[1]);
    var del = el('button', 'mini-btn danger', 'Delete');
    del.addEventListener('click', function () {
      if (!confirm('Delete all ' + pages.length + ' pages of this PDF?')) return;
      pages.forEach(function (p) {
        if (p.src && p.src.indexOf('content/media/') === 0) stageDelete(p.src);
      });
      media.splice(blk[0], blk[1] - blk[0]);
      setDirty(); render();
    });
    btns.appendChild(del);
    row.appendChild(btns);
    return row;
  }

  /* 홈 문양 키워드 체크 — 작품·연구 공용 */
  function themeChecks(item) {
    var wrap = el('div', 'check-grid');
    THEMES.forEach(function (t) {
      wrap.appendChild(checkbox((item.themes || []).indexOf(t[0]) >= 0, function (on) {
        var arr = (item.themes || []).filter(function (k) { return k !== t[0]; });
        if (on) arr.push(t[0]);
        item.themes = THEMES.map(function (x) { return x[0]; }).filter(function (k) { return arr.indexOf(k) >= 0; });
      }, t[1]));
    });
    return wrap;
  }

  function renderEditor() {
    var item = findEditing();
    if (!item) { editing = null; render(); return; }

    var isWork = editing.list === 'works';
    backButton(isWork ? 'Works' : 'Research');
    sectionTitle(isWork ? 'Edit work' : 'Edit research');

    main.appendChild(field('Title', input(item.title, function (v) { item.title = v; }),
      isWork ? 'Software names go under Tools, not in the title. e.g. Ethereal' : 'e.g. Materiality of Tteoljam'));
    main.appendChild(field(isWork ? 'Year' : 'Period', input(item.year, function (v) { item.year = v; }, isWork ? 'e.g. 2026' : 'e.g. 2025– (ongoing) · 2026 (completed)')));

    if (isWork) {
      /* ---- 작품 정보 (톰스톤) — 비워 두면 그 줄은 사이트에 표시되지 않는다 ---- */
      main.appendChild(field('Medium', input(item.medium, function (v) { item.medium = v; }, 'Single-channel video, colour, sound'),
        'Like a museum label: channels · colour · sound. The part before the first comma appears under the title in the Works grid.'));
      var durRow = el('div', 'link-row');
      var durF = field('Duration', input(item.duration, function (v) { item.duration = v; }, '4:32'));
      durF.style.marginBottom = '0'; durF.style.width = '140px';
      var fmtF = field('Format (optional)', input(item.format, function (v) { item.format = v; }, '3840×2160, 16:9'));
      fmtF.style.marginBottom = '0'; fmtF.style.flex = '1';
      durRow.appendChild(durF); durRow.appendChild(fmtF);
      main.appendChild(field('Duration · Format', durRow));
      main.appendChild(field('Role', input(item.role, function (v) { item.role = v; }, 'Concept, direction, generative pipeline, editing'),
        'What you did in this work. Collaborators go under Credits.'));
      main.appendChild(field('Tools', input(joinList(item.tools), function (v) { item.tools = v; }, 'Unreal Engine 5, ComfyUI, DaVinci Resolve'),
        'Comma-separated. Only what you actually used — tools you want to learn belong in Research keywords.'));
      main.appendChild(field('Credits (optional)', input(item.credits, function (v) { item.credits = v; }, 'Sound: …  ·  Made in Media Art Studio II, Duksung Women\'s University')));
      main.appendChild(field('Exhibited (one per line, optional)',
        textarea(Array.isArray(item.exhibitions) ? item.exhibitions.join('\n') : (item.exhibitions || ''), 3, function (v) {
          item.exhibitions = lines(v);
        }),
        'e.g. 2026 — Degree Show, Duksung Women\'s University, Seoul. School and online shows count too.'));
      main.appendChild(field('Themes (home page keywords)', themeChecks(item),
        'Hovering a checked keyword on the home page shows this work\'s title. Also listed under Themes in the detail view.'));
    } else {
      main.appendChild(field('Status', select(item.status || 'completed', STATUS, function (v) { item.status = v; }),
        'The Research page groups entries in this order. Use Proposed for research you plan to do.'));
      main.appendChild(field('Themes (home page keywords)', themeChecks(item),
        'Shown in the Research list and the detail view. Hovering the keyword on the home page shows this title too.'));
      main.appendChild(field('Summary', input(item.summary, function (v) { item.summary = v; }, 'What the study asks and how — one or two sentences'),
        'Shown under the title in the Research list. Under 40 words.'));
      main.appendChild(field('Keywords', input(joinList(item.keywords), function (v) { item.keywords = splitList(v); }, 'Cultural Heritage, Generative AI, Technical Image'),
        'Comma-separated · 2–5. Shown in the detail view (and in the list when no theme is checked).'));

      var rwWrap = el('div', 'check-grid');
      DATA.works.forEach(function (w) {
        rwWrap.appendChild(checkbox((item.relatedWorks || []).indexOf(w.id) >= 0, function (on) {
          var arr = (item.relatedWorks || []).filter(function (k) { return k !== w.id; });
          if (on) arr.push(w.id);
          item.relatedWorks = arr;
        }, w.title || w.id));
      });
      if (!DATA.works.length) rwWrap.appendChild(el('p', 'field-hint', 'No works yet.'));
      main.appendChild(field('Works', rwWrap, 'Each checked work links to this research from its detail view (Research line), and back.'));
    }

    main.appendChild(field(isWork ? 'Statement' : 'Abstract',
      textarea(item.description, 8, function (v) { item.description = v; }),
      'Shown in the detail view. A blank line starts a new paragraph.'));
    if (isWork) {
      main.appendChild(field('Korean text (optional)',
        textarea(item.descriptionKo, 5, function (v) { item.descriptionKo = v; }),
        'The site is kept in English, so this is empty for every work. Text here appears below the English, after a faint line.'));
    }

    /* 미디어 */
    var mwrap = el('div');
    var mlist = el('div', 'media-list');
    var media = item.media || (item.media = []);
    var mi = 0;
    while (mi < media.length) {
      var blk = mediaBlock(media, mi);
      mlist.appendChild(media[mi].doc ? pdfBlockRow(media, blk) : mediaRow(media, mi));
      mi = blk[1];
    }
    mwrap.appendChild(mlist);

    var urow = el('div', 'upload-row');
    urow.appendChild(uploadButton('+ Add files (image · video · 3D)', 'image/*,video/mp4,video/webm,.glb,.gltf', true, item.id, function (paths) {
      paths.forEach(function (p) {
        item.media.push({ type: extType(p) || 'image', src: p, caption: '' });
      });
      setDirty(); render();
    }));
    var PDF_LABEL = '+ Add PDF (every page as an image)';
    var pdfBtn = el('button', 'upload-btn', PDF_LABEL);
    pdfBtn.addEventListener('click', function () {
      pickFiles('application/pdf,.pdf', false, function (files) {
        pdfBtn.classList.add('busy');
        pdfBtn.textContent = 'Reading the PDF…';
        rasterizePdf(files[0], function (n, total) {
          pdfBtn.textContent = 'Converting pages… ' + n + ' / ' + total;
        }).then(function (out) {
          /* 같은 항목에 PDF 를 두 권 넣어도 묶음이 섞이지 않게 — doc 은 유일해야 한다 */
          var taken = {};
          item.media.forEach(function (m) { if (m.doc) taken[m.doc] = true; });
          var doc = out.doc, n = 2;
          while (taken[doc]) doc = out.doc + '-' + (n++);
          uploadInto(item.id, out.files, function (err, paths) {
            pdfBtn.classList.remove('busy');
            pdfBtn.textContent = PDF_LABEL;
            if (err) uploadFailed(err);
            paths.forEach(function (p) {
              item.media.push({ type: 'image', src: p, caption: '', doc: doc });
            });
            if (paths.length) { setDirty(); render(); }
          });
        }).catch(function (e) {
          pdfBtn.classList.remove('busy');
          pdfBtn.textContent = PDF_LABEL;
          toast(e.message);
        });
      });
    });
    urow.appendChild(pdfBtn);

    var embedBtn = el('button', 'upload-btn', '+ Add YouTube / Vimeo link');
    embedBtn.addEventListener('click', function () {
      var url = prompt('Paste a YouTube or Vimeo URL');
      if (!url) return;
      item.media.push({ type: 'embed', src: url.trim(), caption: '' });
      setDirty(); render();
    });
    urow.appendChild(embedBtn);
    mwrap.appendChild(urow);

    main.appendChild(field('Media (shown top to bottom)', mwrap,
      'Images: jpg / png / webp · Video: mp4, up to 38 MB per file (compress larger videos, or add a YouTube / Vimeo link) · 3D: .glb (Blender → Export → glTF 2.0).\n' +
      'If the first media is a video, it plays on hover in the Works grid — set the clip below.\n' +
      'A PDF becomes one image per page, laid out in two columns in the detail view. Long PDFs take a while — keep this tab open until it finishes.'));

    if (isWork) renderHoverControls(item);

    /* 대표 이미지 */
    main.appendChild(field('Cover image (optional)', singleFile(item.cover, {
      preview: true, folder: item.id, accept: 'image/*',
      uploadLabel: 'Upload cover image', removeLabel: 'Remove cover image',
      set: function (v) { item.cover = v; }
    }), isWork
      ? 'Blank = the first image is used. Recommended for video and 3D works — it is their thumbnail in the Works grid.'
      : 'Blank = the first image is used. Shown as the thumbnail in the Research list.'));

    /* 링크 — 사이트 상세 화면의 Related */
    var lwrap = el('div');
    (item.links || []).forEach(function (l, i) {
      var row = el('div', 'link-row');
      var a = el('div'); a.style.width = '180px'; a.appendChild(input(l.label, function (v) { l.label = v; }, 'Label'));
      var b = el('div'); b.style.flex = '1'; b.appendChild(input(l.href, function (v) { l.href = v; }, 'https://…'));
      var d = el('button', 'mini-btn danger', 'Delete');
      d.addEventListener('click', function () { item.links.splice(i, 1); setDirty(); render(); });
      row.appendChild(a); row.appendChild(b); row.appendChild(d);
      lwrap.appendChild(row);
    });
    var addLink = el('button', 'mini-btn', '+ Add link (paper PDF, external page …)');
    addLink.addEventListener('click', function () {
      if (!item.links) item.links = [];
      item.links.push({ label: '', href: '' });
      setDirty(); render();
    });
    lwrap.appendChild(addLink);
    main.appendChild(field('Related links (optional)', lwrap));
  }

  /* ----- Works 격자 hover 자동 재생 설정 ----- */

  function fmtTime(t) {
    if (!isFinite(t)) return '–';
    var m = Math.floor(t / 60), s = (t - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function renderHoverControls(item) {
    var first = item.media && item.media[0];
    var isVid = first && (first.type || extType(first.src)) === 'video';
    var TITLE = 'Hover preview (Works grid)';
    if (!isVid) {
      main.appendChild(field(TITLE, el('p', 'field-hint', 'Available when the first media is a video — move a video to the top.')));
      return;
    }
    var hv = item.hover || {};
    function H() { return item.hover || (item.hover = {}); }   // 편집 화면을 열기만 해도 저장되지 않게 — 바꿀 때만 생성
    var enabled = hv.enabled !== false;
    var start = (typeof hv.start === 'number' && isFinite(hv.start)) ? hv.start : null;
    var length = (+hv.length >= 1) ? Math.min(+hv.length, 30) : 4;
    var rate = (+hv.rate > 0) ? +hv.rate : 1;
    var loop = hv.loop !== false;

    var wrap = el('div');
    wrap.appendChild(checkbox(enabled, function (on) { H().enabled = on; render(); },
      'Play on hover (off = only the cover image)'));

    var row = el('div', 'link-row');
    var startIn = input(start == null ? '' : start, function (v) {
      H().start = v === '' ? null : Math.max(0, parseFloat(v) || 0);
      updateStatus();
    }, 'Auto (middle)');
    startIn.type = 'number'; startIn.min = 0; startIn.step = 0.1;
    var sf = field('Start (sec)', startIn); sf.style.marginBottom = '0'; sf.style.width = '140px';

    var lenIn = input(length, function (v) {
      var x = parseFloat(v);
      H().length = x >= 1 ? Math.min(x, 30) : 4;
      updateStatus();
    });
    lenIn.type = 'number'; lenIn.min = 1; lenIn.max = 30; lenIn.step = 0.5;
    var lf = field('Length (sec)', lenIn); lf.style.marginBottom = '0'; lf.style.width = '140px';

    var rateSel = select(rate, [['0.5', '0.5×'], ['0.75', '0.75×'], ['1', '1× (default)'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']],
      function (v) { H().rate = parseFloat(v); updateStatus(); });
    var rf = field('Speed', rateSel); rf.style.marginBottom = '0'; rf.style.width = '120px';
    row.appendChild(sf); row.appendChild(lf); row.appendChild(rf);
    wrap.appendChild(row);

    wrap.appendChild(checkbox(loop, function (on) { H().loop = on; },
      'Loop the clip (off = stop on the last frame)'));

    /* 미리보기 — 네이티브 컨트롤의 스크러버가 곧 「장면 고르기」 */
    var pv = document.createElement('video');
    pv.src = mediaUrl(first.src);
    pv.muted = true; pv.playsInline = true; pv.controls = true; pv.preload = 'metadata';
    pv.className = 'hover-preview';
    wrap.appendChild(pv);

    var btns = el('div', 'row-btns');
    var playBtn = el('button', 'mini-btn', '▶ Preview clip');
    var setBtn = el('button', 'mini-btn', 'Use current position as start');
    btns.appendChild(playBtn); btns.appendChild(setBtn);
    wrap.appendChild(btns);
    var status = el('p', 'field-hint', 'Reading the video…');
    wrap.appendChild(status);

    var hlStart = 0, hlEnd = 0;
    function calc() {
      var d = pv.duration;
      if (!isFinite(d) || d <= 0) return false;
      var cur = item.hover || {};
      var s = (typeof cur.start === 'number' && isFinite(cur.start)) ? cur.start : null;
      var L = (+cur.length >= 1) ? Math.min(+cur.length, 30) : 4;
      hlStart = (s == null || s >= d) ? d / 2 : Math.min(s, Math.max(0, d - 0.5));
      hlEnd = Math.min(hlStart + L, d);
      return true;
    }
    function updateStatus() {
      if (!calc()) return;
      var cur = item.hover || {};
      var s = (typeof cur.start === 'number' && isFinite(cur.start)) ? cur.start : null;
      var r = (+cur.rate > 0) ? +cur.rate : 1;
      if (s != null && s >= pv.duration) {
        status.textContent = '⚠ The start is past the end of the video (' + fmtTime(pv.duration) + ') — the site will start from the middle';
      } else {
        status.textContent = 'Video ' + fmtTime(pv.duration) + ' · clip ' + fmtTime(hlStart) + ' → ' + fmtTime(hlEnd) +
          ' (' + (hlEnd - hlStart).toFixed(1) + ' s · ' + r + '×)';
      }
      startIn.max = Math.floor(pv.duration * 10) / 10;
    }
    pv.addEventListener('loadedmetadata', updateStatus);
    pv.addEventListener('timeupdate', function () {
      if (pv.paused || !pv._hl) return;
      if (pv.currentTime >= hlEnd) {
        var cur = item.hover || {};
        if (cur.loop !== false) pv.currentTime = hlStart; else { pv.pause(); pv._hl = false; }
      }
    });
    /* 구간 끝 = 영상 끝이면 브라우저가 먼저 멈춘다 — ended 에서 되감는다 (사이트와 같은 처리) */
    pv.addEventListener('pause', function () { if (!pv.ended) pv._hl = false; });
    pv.addEventListener('ended', function () {
      var cur = item.hover || {};
      if (pv._hl && cur.loop !== false) { pv.currentTime = hlStart; pv.play(); } else pv._hl = false;
    });
    playBtn.addEventListener('click', function () {
      if (!calc()) { toast('The video has not loaded yet'); return; }
      var cur = item.hover || {};
      pv.playbackRate = (+cur.rate > 0) ? +cur.rate : 1;
      pv.currentTime = hlStart;
      pv._hl = true;
      var p = pv.play(); if (p && p.catch) p.catch(function () {});
    });
    setBtn.addEventListener('click', function () {
      if (!isFinite(pv.currentTime)) return;
      H().start = Math.round(pv.currentTime * 10) / 10;
      setDirty(); render();
    });

    [startIn, lenIn, rateSel, playBtn, setBtn].forEach(function (c) { c.disabled = !enabled; });
    if (!enabled) { row.style.opacity = '0.4'; pv.style.opacity = '0.4'; }

    main.appendChild(field(TITLE, wrap,
      'This clip of the first video plays muted when the pointer is over the work in the Works grid. On touch devices it plays when the work reaches the middle of the screen.'));
  }

  /* ----- CV — 사이트 CV 페이지와 같은 순서: 맨 위 블록 · 항목 타임라인 · PDF ----- */

  /* js/app.js NEWS_KINDS 와 같은 이름 — 둘을 같이 고칠 것 */
  var NEWS_KINDS = [
    ['publication', 'Publication'],
    ['award', 'Award'],
    ['scholarship', 'Scholarship'],
    ['conference', 'Conference'],
    ['talk', 'Talk'],
    ['exhibition', 'Exhibition'],
    ['project', 'Project'],
    ['press', 'Press'],
    ['residency', 'Residency'],
    ['service', 'Service']
  ];

  function newsKindLabel(k) {
    for (var i = 0; i < NEWS_KINDS.length; i++) if (NEWS_KINDS[i][0] === k) return NEWS_KINDS[i][1];
    return '';
  }

  /* 사이트와 같은 정렬 기준 — 'YYYY' · 'YYYY-MM' · 'YYYY-MM-DD' 를 모두 받는다 */
  function newsSortKey(d) {
    var p = String(d || '').trim().split(/[-.\/]/);
    function pad(v) { var n = String(v || '').replace(/\D/g, ''); return n ? ('0' + n).slice(-2) : '00'; }
    return (String(p[0] || '0000').replace(/\D/g, '') || '0000') + '-' + pad(p[1]) + '-' + pad(p[2]);
  }

  function renderCv() {
    sectionTitle('CV');
    main.appendChild(el('p', 'field-hint',
      'The CV page shows the top block first, then every entry as one timeline, newest first and grouped by year. ' +
      'Dates that have not come yet are marked Upcoming. The CV menu item is hidden while the page is empty.'));

    var ab = DATA.about;
    main.appendChild(field('Top block (Education …)',
      textarea(Array.isArray(ab.cv) ? ab.cv.join('\n') : (ab.cv || ''), 6, function (v) { ab.cv = lines(v); }),
      'One item per line. A line starting with a year (2026  B.F.A., Duksung Women\'s University, Seoul) gets a year column; ' +
      'a line starting with "- " has no year; any other line (Education) becomes a subheading.'));

    var arr = DATA.news;
    var list = el('div', 'item-list');
    arr.slice().sort(function (a, b) {
      var ka = newsSortKey(a.date), kb = newsSortKey(b.date);
      return ka < kb ? 1 : ka > kb ? -1 : 0;
    }).forEach(function (item) {
      var row = el('div', 'item-row');
      row.appendChild(el('span', 'item-year', item.date || 'No date'));
      row.appendChild(el('span', 'item-name', item.title || '(untitled)'));
      row.appendChild(el('span', 'item-year', newsKindLabel(item.kind)));

      var edit = el('button', 'mini-btn', 'Edit');
      edit.addEventListener('click', function () { editing = { list: 'news', id: item.id }; render(); });
      var del = el('button', 'mini-btn danger', 'Delete');
      del.addEventListener('click', function () {
        if (!confirm('Delete "' + (item.title || 'untitled') + '"?\nIts photos are deleted too.')) return;
        arr.splice(arr.indexOf(item), 1);
        stageDelete('content/media/' + item.id);
        setDirty(); render();
      });
      row.appendChild(edit); row.appendChild(del);
      list.appendChild(row);
    });
    if (!arr.length) list.appendChild(el('p', 'field-hint', 'No entries yet.'));

    var lwrap = el('div');
    lwrap.appendChild(list);
    var add = el('button', 'add-btn', '+ Add entry');
    add.addEventListener('click', function () {
      var title = prompt('Title (you can change it later)\ne.g. Student Volunteer, SIGGRAPH Asia 2026', '');
      if (title === null) return;
      title = title.trim() || 'New Entry';
      var now = new Date();
      var item = {
        id: uniqueId(title),
        date: now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2),
        kind: 'award',
        title: title,
        venue: '',
        note: '',
        href: '',
        images: [],
        related: []
      };
      arr.push(item);
      editing = { list: 'news', id: item.id };
      setDirty(); render();
    });
    lwrap.appendChild(add);
    main.appendChild(field('Entries — publications · awards · scholarships · conferences · activities', lwrap));

    main.appendChild(field('CV PDF (optional)', singleFile(ab.cvPdf, {
      folder: 'about', accept: 'application/pdf,.pdf', deleteFile: true,
      uploadLabel: 'Upload CV PDF', removeLabel: 'Remove PDF',
      confirm: 'Remove the CV PDF?\nThe uploaded file is deleted too.',
      set: function (v) { ab.cvPdf = v; }
    }), 'Shown as "Download CV (PDF)" at the bottom of the CV page.'));
  }

  function renderNewsEditor() {
    var item = findEditing();
    if (!item) { editing = null; render(); return; }

    backButton('CV');
    sectionTitle('Edit CV entry');

    main.appendChild(field('Date', input(item.date, function (v) { item.date = v.trim(); }, '2026-12'),
      'Year-month (2026-12) by default — 2026-12-10 for a day, 2026 for a year only. Used for the order and the Upcoming mark.'));

    main.appendChild(field('Type', select(item.kind || 'award', NEWS_KINDS, function (v) { item.kind = v; }),
      'Shown under the title (Award · Conference …).'));

    main.appendChild(field('Title', input(item.title, function (v) { item.title = v; }, 'Student Volunteer, SIGGRAPH Asia 2026'),
      'One line — role first, as in a CV. Award: the award name. Conference: your role and the conference. Publication: the paper title.'));

    main.appendChild(field('Organiser · place (optional)', input(item.venue, function (v) { item.venue = v; }, 'ACM SIGGRAPH, Tokyo'),
      'Shown next to the type. Publication: the venue and status (Under review · CHI 2027 / Accepted · HCI Korea 2027).'));

    main.appendChild(field('Note (optional)', input(item.note, function (v) { item.note = v; }, 'Selected as a student volunteer for the conference.'),
      'Only when needed — blank means no line. Publication: the authors (Doyeon Lee, Co-author Name).'));

    main.appendChild(field('Link (optional)', input(item.href, function (v) { item.href = v.trim(); }, 'https://…'),
      'Makes the title a link, marked ↗. Publication: the DOI or PDF.'));

    /* 사진 — 여러 장 (상장, 현장 사진, 기사 캡처) */
    var iwrap = el('div');
    var ilist = el('div', 'media-list');
    item.images.forEach(function (src, i) {
      var row = el('div', 'media-row');
      var th = el('img', 'media-thumb');
      th.src = mediaUrl(src);
      row.appendChild(th);
      var info = el('div', 'media-info');
      info.appendChild(el('div', 'media-src', src));
      row.appendChild(info);
      var btns = el('div', 'row-btns');
      var up = el('button', 'mini-btn', '↑');
      up.disabled = i === 0;
      up.addEventListener('click', function () {
        item.images.splice(i - 1, 0, item.images.splice(i, 1)[0]);
        setDirty(); render();
      });
      var down = el('button', 'mini-btn', '↓');
      down.disabled = i === item.images.length - 1;
      down.addEventListener('click', function () {
        item.images.splice(i + 1, 0, item.images.splice(i, 1)[0]);
        setDirty(); render();
      });
      var rm = el('button', 'mini-btn danger', 'Delete');
      rm.addEventListener('click', function () {
        if (src.indexOf('content/media/') === 0) stageDelete(src);
        item.images.splice(i, 1);
        setDirty(); render();
      });
      btns.appendChild(up); btns.appendChild(down); btns.appendChild(rm);
      row.appendChild(btns);
      ilist.appendChild(row);
    });
    iwrap.appendChild(ilist);
    var upRow = el('div', 'upload-row');
    upRow.appendChild(uploadButton('+ Add photos', 'image/*', true, item.id, function (paths) {
      item.images = item.images.concat(paths);
      setDirty(); render();
    }));
    iwrap.appendChild(upRow);
    main.appendChild(field('Photos (optional)', iwrap,
      'Small pictures on the right of the entry (below it on phones), in this order. Landscape pictures fit best.'));

    /* 관련 작품·연구 — 누르면 그 상세로 건너간다 */
    var relWrap = el('div', 'check-grid');
    var pool = DATA.works.map(function (w) { return ['Work · ' + (w.title || w.id), w.id]; })
      .concat(DATA.studies.map(function (s) { return ['Research · ' + (s.title || s.id), s.id]; }));
    pool.forEach(function (o) {
      relWrap.appendChild(checkbox(item.related.indexOf(o[1]) >= 0, function (on) {
        var arr = item.related.filter(function (k) { return k !== o[1]; });
        if (on) arr.push(o[1]);
        item.related = arr;
      }, o[0]));
    });
    if (!pool.length) relWrap.appendChild(el('p', 'field-hint', 'No works or research yet.'));
    main.appendChild(field('Related works · research (optional)', relWrap,
      'Adds a small linked preview under the entry. For a publication, pick its research — that research page then gets a Publications line.'));
  }

  /* ---------- 로그인 (GitHub 토큰) ---------- */

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  function loginError(e) {
    if (e.status === 401) return 'The token is wrong or has expired — create a new one and paste it here';
    if (e.status === 403) return 'This token cannot save — create a new one with "Create token" above · GitHub: ' + e.message;
    if (e.status === 404) return 'This token cannot reach the repository — create a new one with "Create token" above';
    return 'Login failed: ' + e.message;
  }

  function connect(token) {
    var s = window.GitHubStore.create({ owner: GH.owner, repo: GH.repo, branch: GH.branch, token: token });
    return s.load().then(function (text) {
      /* 공개 저장소라 읽기는 아무 토큰으로도 된다 — 저장 권한은 여기서 따로 확인 */
      return s.canWrite().then(function () { return text; }, function (e) {
        var err = new Error(e.message);
        err.status = e.status === 401 ? 401 : e.status ? 403 : 0;   // 0 = 네트워크 오류 — 권한 문제로 오인하지 않게
        throw err;
      });
    }).then(function (text) {
      store = s;
      storage('gh-token', token);
      addLogout();
      start(text);
    });
  }

  function showLogin(msg) {
    banner.textContent = '';
    var box = el('div', 'login-box');
    box.appendChild(el('p', 'login-title', 'Admin login'));
    var how = el('p', 'note');
    how.innerHTML =
      'A GitHub token is needed once per browser.<br>' +
      '1. <a href="' + TOKEN_URL + '" target="_blank" rel="noopener"><u>Create token ↗</u></a> — the name and permission (public_repo) are filled in<br>' +
      '2. Choose an <b>Expiration</b>, then press <b>Generate token</b> at the bottom<br>' +
      '3. Copy the token (ghp_…) and paste it below — it is kept only in this browser';
    box.appendChild(how);
    var tok = document.createElement('input');
    tok.type = 'password';
    tok.placeholder = 'ghp_…';
    tok.autocomplete = 'off';
    box.appendChild(tok);
    var go = el('button', 'banner-btn', 'Log in');
    box.appendChild(go);
    var err = el('p', 'err-note', msg || '');
    box.appendChild(err);
    function submit() {
      var t = tok.value.trim();
      if (!t) return;
      go.disabled = true;
      err.textContent = '';
      connect(t).catch(function (e) {
        go.disabled = false;
        if (e && e.handled) return;
        err.textContent = loginError(e);
      });
    }
    go.addEventListener('click', submit);
    tok.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    banner.appendChild(box);
    banner.hidden = false;
    tok.focus();
  }

  function addLogout() {
    if (document.getElementById('logoutBtn')) return;
    var b = el('button', 'bar-link', 'Log out');
    b.id = 'logoutBtn';
    b.addEventListener('click', function () {
      if (dirty && !window.confirm('Unsaved changes will be lost. Log out?')) return;
      storage('gh-token', null);
      dirty = false;
      location.reload();
    });
    saveBtn.parentNode.insertBefore(b, saveBtn);
  }

  /* ---------- boot ---------- */

  function start(text) {
    try {
      var a = text.indexOf('{');
      var b = text.lastIndexOf('}');
      DATA = JSON.parse(text.slice(a, b + 1));
    } catch (e) {
      banner.textContent = '';
      var box = el('div');
      box.appendChild(el('p', null, 'content/data.js could not be read.'));
      box.appendChild(el('p', null, 'Restore an earlier version from its History in the GitHub repository.'));
      var retry = el('button', 'banner-btn', 'Try again');
      retry.addEventListener('click', function () { location.reload(); });
      box.appendChild(retry);
      banner.appendChild(box);
      banner.hidden = false;
      throw { handled: true };
    }
    DATA.works = DATA.works || [];
    DATA.studies = DATA.studies || [];
    DATA.studies.forEach(function (s) { if (s.status === 'past') s.status = 'completed'; });   // 구 표기 정규화
    DATA.studiesGif = DATA.studiesGif || '';
    DATA.news = DATA.news || [];
    DATA.news.forEach(function (n) {
      n.kind = n.kind || 'award';
      n.date = n.date || '';
      n.venue = n.venue || '';
      n.note = n.note || '';
      n.href = n.href || '';
      /* 사진은 여러 장 — 옛 데이터(image 한 장)는 첫 장으로 옮긴다 */
      n.images = Array.isArray(n.images) ? n.images.filter(Boolean) : [];
      if (!n.images.length && n.image) n.images = [n.image];
      delete n.image;
      n.related = n.related || [];
    });
    DATA.siteTagline = DATA.siteTagline || '';
    DATA.contact = DATA.contact || [];
    DATA.about = DATA.about || { text: '', image: '' };
    DATA.about.statement = DATA.about.statement || DATA.about.text || '';
    DATA.about.bio = DATA.about.bio || '';
    DATA.about.directions = DATA.about.directions || [];
    DATA.about.cv = DATA.about.cv || [];
    DATA.about.cvPdf = DATA.about.cvPdf || '';
    banner.hidden = true;
    render();
  }

  var token = storage('gh-token');
  if (!token) showLogin();
  else connect(token).catch(function (e) {
    if (e && e.handled) return;
    showLogin(loginError(e));
  });
})();
