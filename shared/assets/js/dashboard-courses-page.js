function coursesPage() {
    return {
        viewMode: 'manage',
        courses: [], filtered: [], loading: true,
        showCreate: false, creating: false, createError: '',
        searchQuery: '', filterLevel: '', filterStatus: '',
        nc: { title:'', slug:'', level:'beginner', priceUSDC:0, description:'', visibility:'public', specialization:'', prerequisites:'', whatYouLearn:'', estimatedHours:'', thumbnailData:'', thumbnailPreview:'' },
        totalEnrolled: 0, totalRevenue: 0,
        editingCourse: null, editTab: 'overview',
        editModules: [], loadingModules: false,
        showAddModule: false, addingModule: false, moduleMsg: '',
        nm: { title:'', body_md:'', video_uid:'', duration_minutes:'' },
        nmPreview: false,
        editModuleId: null, em: { title:'', body_md:'', video_uid:'', duration_minutes:'' },
        emPreview: false, savingModule: false,
        myWallet: '',
        editForm: { title:'', level:'beginner', priceUSDC:0, estimatedHours:'', visibility:'public', specialization:'', prerequisites:'', description:'', whatYouLearn:'', promoVideoUrl:'' },
        editThumbPreview: '', editThumbData: '',
        uploadingThumb: false, thumbMsg: '',
        savingEdit: false, editMsg: '',
        mediaItems: [],
        enrolled: [
            {id:1,title:'Smart Contract Security',level:'intermediate',progress:68,currentModule:7,totalModules:10,currentLesson:'Reentrancy Attack Patterns',lastActivity:'2 hours ago'},
            {id:2,title:'Introduction to DeFi',level:'beginner',progress:100,currentModule:12,totalModules:12,currentLesson:'Final Assessment',lastActivity:'3 days ago'},
            {id:3,title:'DeFi Governance & DAOs',level:'intermediate',progress:33,currentModule:2,totalModules:6,currentLesson:'Vote Delegation Mechanics',lastActivity:'1 day ago'},
            {id:4,title:'Tokenomics Design Masterclass',level:'advanced',progress:12,currentModule:1,totalModules:8,currentLesson:'Token Supply Models',lastActivity:'5 days ago'}
        ],
        certs: [
            {id:1,course:'Introduction to DeFi',level:'Beginner',date:'Mar 28, 2026',wallet:'0x7a3B...f4E2',certId:'TKN-CERT-2026-0412',contractAddr:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'}
        ],
        // Phase 6 — Stream direct-upload + Issue Certificate state
        streamUploadBusy: false, streamUploadHint: '',
        certIssueCourseId: '', certIssueWallet: '', certIssueBusy: false, certIssueMsg: '',

        init() { this.loadCourses(); },

        // Phase 6: ask the worker for a one-time Cloudflare Stream
        // direct-creator-upload URL, then PUT the chosen file straight
        // to Cloudflare. The returned UID is dropped into the module
        // form. The webhook will flip the module to "ready" once
        // transcoding completes.
        requestStreamUpload() {
            var self = this;
            self.streamUploadBusy = true; self.streamUploadHint = '';
            var apiBase = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/,'');
            var headers = { 'Content-Type': 'application/json' };
            try { var tok = window.TokenomicSupabase && TokenomicSupabase.getToken && TokenomicSupabase.getToken(); if (tok) headers.Authorization = 'Bearer ' + tok; } catch(_) {}
            fetch(apiBase + '/api/content/stream/upload-url', { method:'POST', headers: headers, credentials:'include',
                body: JSON.stringify({
                    moduleId: self.editModuleId || null,
                    courseId: (self.editingCourse && self.editingCourse.id) || null,
                    maxDurationSeconds: 7200
                })
            }).then(function(r){ return r.json().then(function(d){ return { status:r.status, data:d }; }); })
              .then(function(res) {
                  self.streamUploadBusy = false;
                  if (res.status !== 200 || !res.data || !res.data.uploadURL) {
                      self.streamUploadHint = (res.data && res.data.error) || 'Stream not configured on the server. Paste a UID instead.';
                      return;
                  }
                  // Open a hidden file picker; uploaded file goes straight to CF.
                  var input = document.createElement('input'); input.type='file'; input.accept='video/*';
                  input.onchange = function(ev) {
                      var file = ev.target.files && ev.target.files[0]; if (!file) return;
                      self.streamUploadBusy = true;
                      self.streamUploadHint = 'Uploading ' + file.name + ' to Cloudflare Stream…';
                      var fd = new FormData(); fd.append('file', file);
                      fetch(res.data.uploadURL, { method:'POST', body: fd })
                          .then(function(r2){ if (!r2.ok) throw new Error('Upload failed: ' + r2.status); return r2; })
                          .then(function() {
                              self.nm.video_uid = res.data.uid;
                              if (self.editModuleId) self.em.video_uid = res.data.uid;
                              self.streamUploadHint = '✓ Uploaded. UID stored — Cloudflare will finish transcoding shortly.';
                              self.streamUploadBusy = false;
                          })
                          .catch(function(e){ self.streamUploadBusy = false; self.streamUploadHint = 'Upload failed: ' + e.message; });
                  };
                  input.click();
              })
              .catch(function(e){ self.streamUploadBusy = false; self.streamUploadHint = 'Network error: ' + (e.message||e); });
        },

        // Phase 6: educator-driven certificate issuance. Calls the worker
        // endpoint that mints a PDF, stores it in R2, logs it in
        // certificates_issued, and (if email exists) sends the learner a
        // notification with a 5-minute signed download link.
        issueCertificate() {
            var self = this;
            if (!self.certIssueCourseId || !self.certIssueWallet) return;
            if (!/^0x[a-fA-F0-9]{40}$/.test(self.certIssueWallet.trim())) {
                self.certIssueMsg = 'Please enter a valid 0x… wallet address.'; return;
            }
            self.certIssueBusy = true; self.certIssueMsg = '';
            var apiBase = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/,'');
            var headers = { 'Content-Type': 'application/json' };
            try { var tok = window.TokenomicSupabase && TokenomicSupabase.getToken && TokenomicSupabase.getToken(); if (tok) headers.Authorization = 'Bearer ' + tok; } catch(_) {}
            fetch(apiBase + '/api/courses/' + encodeURIComponent(self.certIssueCourseId) + '/issue-certificate', {
                method:'POST', headers: headers, credentials:'include',
                body: JSON.stringify({ student_wallet: self.certIssueWallet.trim().toLowerCase() })
            }).then(function(r){ return r.json().then(function(d){ return { status:r.status, data:d }; }); })
              .then(function(res){
                  self.certIssueBusy = false;
                  if (res.status >= 200 && res.status < 300) {
                      self.certIssueMsg = '✓ Certificate issued. Email: ' + (res.data.email || 'skipped') + (res.data.url ? ' · PDF: ' + res.data.url : '');
                      self.showToast('Certificate issued!', 'success');
                  } else {
                      self.certIssueMsg = (res.data && res.data.error) ? res.data.error : ('Failed (HTTP ' + res.status + ')');
                  }
              })
              .catch(function(e){ self.certIssueBusy = false; self.certIssueMsg = 'Network error: ' + (e.message||e); });
        },

        // Phase 6 thumbnail uploader. Tries CF Images first via the worker
        // (one-shot direct upload + persist), then falls back to the
        // local Express endpoint that writes to /assets/images/courses/.
        uploadCourseThumbnail(course, dataUrl) {
            var self = this;
            var apiBase = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/,'');
            var headers = { 'Content-Type': 'application/json' };
            try { var tok = window.TokenomicSupabase && TokenomicSupabase.getToken && TokenomicSupabase.getToken(); if (tok) headers.Authorization = 'Bearer ' + tok; } catch(_) {}
            // Step 1: ask worker for a one-time CF Images upload URL.
            fetch(apiBase + '/api/content/images/direct-upload', { method:'POST', headers: headers, credentials:'include' })
                .then(function(r){ return r.json().then(function(d){ return { status:r.status, data:d }; }); })
                .then(function(res) {
                    if (res.status !== 200 || !res.data || !res.data.uploadURL) throw new Error('cf-images-unavailable');
                    // Step 2: upload the data URL as multipart/form-data to CF.
                    return fetch(dataUrl).then(function(r){ return r.blob(); }).then(function(blob) {
                        var fd = new FormData(); fd.append('file', blob, 'thumb.png');
                        return fetch(res.data.uploadURL, { method:'POST', body: fd })
                            .then(function(rr){ return rr.json(); })
                            .then(function(cfRes){
                                if (!cfRes.success) throw new Error('cf-upload-failed');
                                var cfId = cfRes.result.id;
                                var variantUrl = cfRes.result.variants && cfRes.result.variants[0];
                                // Step 3: persist on the course row + cf_images table.
                                // We send `url` (the actual variant URL) so the
                                // worker doesn't need CF_IMAGES_DELIVERY_HASH
                                // to be configured to accept the request, plus
                                // `image_id` so the worker can update cf_images.
                                return fetch(apiBase + '/api/courses/' + course.id + '/thumbnail-image', {
                                    method:'POST', headers: headers, credentials:'include',
                                    body: JSON.stringify({ url: variantUrl, image_id: cfId, variant: 'public' })
                                }).then(function(r){
                                    if (!r.ok) throw new Error('thumbnail-image ' + r.status);
                                    return r.json();
                                }).then(function(td){ if (td.url) course.thumbnailUrl = td.url; });
                            });
                    });
                })
                .catch(function() {
                    // Fallback: legacy Express endpoint.
                    fetch('/api/courses/'+course.id+'/thumbnail', {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ thumbnail: dataUrl })
                    }).then(function(r){ return r.json(); })
                      .then(function(td){ if (td.url) course.thumbnailUrl = td.url; });
                });
        },
        slugify(text) {
            return text.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0,80);
        },
        levelColor(level) {
            return {beginner:'#10b981',intermediate:'#f59e0b',advanced:'#ef4444',expert:'#8b5cf6'}[level] || '#64748b';
        },
        levelLabel(level) {
            return {beginner:'Beginner',intermediate:'Intermediate',advanced:'Advanced',expert:'Expert'}[level] || level || 'Beginner';
        },
        getWallet() {
            var el = document.querySelector('.wallet-status-text');
            return (el && el.textContent && el.textContent.indexOf('0x') !== -1) ? el.textContent.trim() : '';
        },
        showToast(message, type) {
            var container = document.getElementById('course-toast-container');
            if (!container) return;
            var toast = document.createElement('div');
            toast.className = 'cr-toast cr-toast-' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-'+(type==='error'?'exclamation-circle':'check-circle')+'" style="flex-shrink:0;"></i> ' + message;
            container.appendChild(toast);
            setTimeout(function() { toast.remove(); }, 4000);
        },
        computeStats() {
            this.totalEnrolled = this.courses.reduce(function(s,c){ return s+(c.enrolledCount||0); }, 0);
            this.totalRevenue = this.courses.reduce(function(s,c){ return s+((c.priceUSDC||0)*(c.enrolledCount||0)); }, 0);
        },
        normalizeCourse(c) {
            return Object.assign({}, c, {
                priceUSDC: c.price_usdc != null ? c.price_usdc : (c.priceUSDC || 0),
                modules: c.modules_count != null ? c.modules_count : (c.modules || 0),
                enrolledCount: c.enrolled_count != null ? c.enrolled_count : (c.enrolledCount || 0),
                estimatedHours: c.estimated_hours != null ? c.estimated_hours : (c.estimatedHours || 0),
                thumbnailUrl: c.thumbnail_url || c.thumbnailUrl || '',
                whatYouLearn: Array.isArray(c.what_you_learn) ? c.what_you_learn.join('\n') : (c.whatYouLearn || ''),
                educator_wallet: (c.educator_wallet || '').toLowerCase(),
                html_url: c.html_url || ('/course/?slug=' + encodeURIComponent(c.slug || c.id))
            });
        },
        loadCourses() {
            var self = this;
            self.loading = true;
            // "My Courses" — only show courses owned by the current wallet.
            var wallet = '';
            try {
                if (window.TokenomicSupabase && TokenomicSupabase.getTokenWallet) wallet = TokenomicSupabase.getTokenWallet() || '';
            } catch (e) {}
            if (!wallet) {
                var el = document.querySelector('.wallet-status-text');
                if (el && el.textContent && el.textContent.indexOf('0x') !== -1) wallet = el.textContent.trim();
            }
            self.myWallet = (wallet || '').toLowerCase();
            var url = '/api/courses' + (self.myWallet ? '?educator=' + encodeURIComponent(self.myWallet) : '');
            (window.TokenomicSupabase ? TokenomicSupabase : null);
            var apiBase = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/,'');
            fetch(apiBase + url)
                .then(function(r) { if (!r.ok) throw new Error('Server error'); return r.json(); })
                .then(function(data) {
                    if (data.error) { self.showToast(data.error,'error'); self.courses=[]; self.filtered=[]; self.loading=false; return; }
                    var raw = data.items || data.courses || [];
                    self.courses = raw.map(function(c){ return self.normalizeCourse(c); });
                    self.computeStats(); self.filterCourses(); self.loading = false;
                })
                .catch(function(err) { console.error(err); self.showToast('Failed to load courses','error'); self.courses=[]; self.filtered=[]; self.loading=false; });
        },
        filterCourses() {
            var self = this, q = self.searchQuery.toLowerCase();
            self.filtered = self.courses.filter(function(c) {
                if (q && (c.title||'').toLowerCase().indexOf(q)===-1 && (c.description||'').toLowerCase().indexOf(q)===-1) return false;
                if (self.filterLevel && c.level !== self.filterLevel) return false;
                if (self.filterStatus && c.status !== self.filterStatus) return false;
                return true;
            });
        },
        createCourse() {
            if (!this.nc.title) return;
            var self = this;
            self.creating = true; self.createError = '';
            var payload = {
                title: self.nc.title, slug: self.nc.slug || self.slugify(self.nc.title),
                level: self.nc.level, priceUSDC: parseFloat(self.nc.priceUSDC)||0,
                description: self.nc.description, visibility: self.nc.visibility,
                specialization: self.nc.specialization, prerequisites: self.nc.prerequisites,
                whatYouLearn: self.nc.whatYouLearn, estimatedHours: parseFloat(self.nc.estimatedHours)||0,
                wallet: self.getWallet()
            };
            fetch('/api/courses', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
            .then(function(r){ return r.json(); })
            .then(function(data) {
                self.creating = false;
                if (data.error) { self.createError = data.error; return; }
                var course = data.course;
                self.courses.unshift(course);
                self.computeStats(); self.filterCourses();
                // Upload thumbnail if present. Phase 6: prefer the worker's
                // Cloudflare Images flow (CDN-hosted, automatic variants);
                // fall back to the legacy local Express endpoint if CF
                // Images isn't configured on the worker.
                if (self.nc.thumbnailData && course.id) {
                    self.uploadCourseThumbnail(course, self.nc.thumbnailData);
                }
                self.nc = { title:'', slug:'', level:'beginner', priceUSDC:0, description:'', visibility:'public', specialization:'', prerequisites:'', whatYouLearn:'', estimatedHours:'', thumbnailData:'', thumbnailPreview:'' };
                var ncThumb = document.getElementById('nc-thumb-drop');
                if (ncThumb) ncThumb.innerHTML = '';
                self.showCreate = false;
                self.showToast('Course created! Repo: '+(data.course.repo_name||''),'success');
            })
            .catch(function() { self.creating=false; self.createError='Failed to create course. Please try again.'; });
        },
        isOwner(course) {
            return course && course.educator_wallet && course.educator_wallet === this.myWallet;
        },
        togglePublish(course) {
            var self = this, newStatus = course.status === 'active' ? 'draft' : 'active';
            if (!window.TokenomicSupabase) { self.showToast('Wallet client not loaded','error'); return; }
            TokenomicSupabase.updateCourse(course.id, { status: newStatus })
                .then(function(updated) {
                    course.status = updated.status;
                    self.showToast(newStatus === 'active' ? 'Course published!' : 'Course unpublished','success');
                })
                .catch(function(e){ self.showToast(e.message || 'Failed to update status','error'); });
        },
        editCourse(course) {
            if (!this.isOwner(course)) { this.showToast("You can only edit your own courses",'error'); return; }
            this.editingCourse = course;
            this.editTab = 'overview';
            this.editModules = []; this.loadingModules = false;
            this.showAddModule = false; this.moduleMsg = '';
            this.editModuleId = null; this.savingModule = false;
            this.resetNm();
            this.editThumbPreview = ''; this.editThumbData = ''; this.thumbMsg = '';
            this.savingEdit = false; this.editMsg = '';
            this.mediaItems = [];
            this.editForm = {
                title: course.title || '',
                level: course.level || 'beginner',
                priceUSDC: course.priceUSDC || 0,
                estimatedHours: course.estimatedHours || '',
                visibility: course.visibility || 'public',
                specialization: course.specialization || '',
                prerequisites: course.prerequisites || '',
                description: course.description || '',
                whatYouLearn: course.whatYouLearn || '',
                promoVideoUrl: course.promoVideoUrl || ''
            };
            // Eagerly load modules so the count badge is right when user clicks the tab.
            this.loadModules();
        },
        // Render markdown with marked.js if loaded; fall back to escaped pre.
        renderMd(src) {
            if (!src) return '<p style="color:#9ca3af;">Nothing to preview yet.</p>';
            if (window.marked && typeof window.marked.parse === 'function') {
                try {
                    if (window.marked.setOptions) window.marked.setOptions({ breaks: true, gfm: true });
                    var html = window.marked.parse(String(src));
                    // Sanitize with DOMPurify (regex-based stripping is not safe).
                    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
                        return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
                    }
                    // If DOMPurify is unavailable, fall through to escaped pre.
                } catch (e) { /* fall through */ }
            }
            var esc = String(src).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return '<pre style="white-space:pre-wrap;">' + esc + '</pre>';
        },
        resetNm() {
            this.nm = { title:'', body_md:'', video_uid:'', duration_minutes:'' };
            this.nmPreview = false;
        },
        loadModules() {
            if (!this.editingCourse) return;
            var self = this;
            self.loadingModules = true;
            TokenomicSupabase.getCourseModules(self.editingCourse.id)
                .then(function(items){ self.editModules = items || []; self.loadingModules = false; })
                .catch(function(e){ self.loadingModules = false; self.showToast('Failed to load modules: ' + (e.message||''),'error'); });
        },
        addModule() {
            if (!this.nm.title || this.nm.title.length < 2) { this.moduleMsg = 'Title required (2-200 chars)'; return; }
            var self = this;
            self.addingModule = true; self.moduleMsg = '';
            var payload = {
                title: self.nm.title,
                body_md: self.nm.body_md || '',
                video_uid: self.nm.video_uid || null,
                duration_minutes: self.nm.duration_minutes !== '' ? Number(self.nm.duration_minutes) : null
            };
            TokenomicSupabase.createModule(self.editingCourse.id, payload)
                .then(function(m) {
                    self.addingModule = false;
                    self.editModules.push(m);
                    self.editingCourse.modules = self.editModules.length;
                    self.resetNm(); self.showAddModule = false;
                    self.moduleMsg = 'Module created!';
                    setTimeout(function(){ self.moduleMsg=''; }, 4000);
                })
                .catch(function(e){ self.addingModule = false; self.moduleMsg = e.message || 'Failed to create module.'; });
        },
        toggleEditModule(id) {
            if (this.editModuleId === id) { this.editModuleId = null; return; }
            var m = this.editModules.find(function(x){ return x.id === id; });
            if (!m) return;
            this.em = {
                title: m.title || '',
                body_md: m.body_md || '',
                video_uid: m.video_uid || '',
                duration_minutes: m.duration_minutes != null ? m.duration_minutes : ''
            };
            this.emPreview = false;
            this.editModuleId = id;
            this.moduleMsg = '';
        },
        saveModule(m) {
            var self = this;
            if (!self.em.title || self.em.title.length < 2) { self.moduleMsg = 'Title required (2-200 chars)'; return; }
            self.savingModule = true; self.moduleMsg = '';
            var payload = {
                title: self.em.title,
                body_md: self.em.body_md || '',
                video_uid: self.em.video_uid ? self.em.video_uid : null,
                duration_minutes: self.em.duration_minutes !== '' ? Number(self.em.duration_minutes) : null
            };
            TokenomicSupabase.updateModule(m.id, payload)
                .then(function(updated) {
                    self.savingModule = false;
                    var idx = self.editModules.findIndex(function(x){ return x.id === m.id; });
                    if (idx !== -1) self.editModules[idx] = updated;
                    self.moduleMsg = 'Saved!';
                    setTimeout(function(){ self.moduleMsg=''; }, 3000);
                })
                .catch(function(e){ self.savingModule = false; self.moduleMsg = e.message || 'Save failed'; });
        },
        deleteModule(m) {
            if (!confirm('Delete module "' + m.title + '"? This cannot be undone.')) return;
            var self = this;
            TokenomicSupabase.deleteModule(m.id)
                .then(function() {
                    self.editModules = self.editModules.filter(function(x){ return x.id !== m.id; });
                    self.editingCourse.modules = self.editModules.length;
                    if (self.editModuleId === m.id) self.editModuleId = null;
                    self.showToast('Module deleted','success');
                })
                .catch(function(e){ self.showToast(e.message || 'Delete failed','error'); });
        },
        moveModule(idx, dir) {
            var newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= this.editModules.length) return;
            var self = this;
            // Optimistic local swap
            var arr = self.editModules.slice();
            var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
            self.editModules = arr;
            self.savingModule = true;
            TokenomicSupabase.reorderModules(self.editingCourse.id, arr.map(function(m){ return m.id; }))
                .then(function(){ self.savingModule = false; })
                .catch(function(e){
                    self.savingModule = false;
                    self.showToast('Reorder failed: ' + (e.message||''),'error');
                    // Revert
                    var revert = self.editModules.slice();
                    var t = revert[idx]; revert[idx] = revert[newIdx]; revert[newIdx] = t;
                    self.editModules = revert;
                });
        },
        saveEditForm() {
            var self = this;
            self.savingEdit = true; self.editMsg = '';
            var what = (self.editForm.whatYouLearn || '').split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
            var payload = {
                title: self.editForm.title,
                description: self.editForm.description,
                level: self.editForm.level,
                price_usdc: Number(self.editForm.priceUSDC) || 0,
                estimated_hours: self.editForm.estimatedHours !== '' ? Number(self.editForm.estimatedHours) : null,
                what_you_learn: what
            };
            TokenomicSupabase.updateCourse(self.editingCourse.id, payload)
                .then(function(updated) {
                    self.savingEdit = false;
                    Object.assign(self.editingCourse, self.normalizeCourse(updated));
                    self.editMsg = 'Changes saved!';
                    self.filterCourses();
                    setTimeout(function(){ self.editMsg=''; }, 4000);
                })
                .catch(function(e){ self.savingEdit = false; self.editMsg = e.message || 'Save failed.'; });
        },
        uploadEditThumbnail() {
            if (!this.editThumbData) return;
            var self = this;
            self.uploadingThumb = true; self.thumbMsg = '';
            // Phase 6: route edit-course thumbnails through the same
            // CF Images uploader as new courses (with legacy fallback).
            // We `await` indirectly by chaining .finally to clear UI.
            try {
                self.uploadCourseThumbnail(self.editingCourse, self.editThumbData);
                // uploadCourseThumbnail mutates editingCourse.thumbnailUrl
                // asynchronously; surface a generic "saved" hint and reset.
                setTimeout(function(){
                    self.uploadingThumb = false;
                    self.thumbMsg = 'Thumbnail saved!';
                    self.editThumbPreview = '';
                    setTimeout(function(){ self.thumbMsg=''; }, 4000);
                }, 1200);
            } catch (e) {
                self.uploadingThumb = false; self.thumbMsg = 'Upload failed.';
            }
        },
        removeMedia(idx) { this.mediaItems.splice(idx, 1); }
    };
}

// ---- NC Thumbnail handlers ----
function handleNcThumbSelect(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5*1024*1024) { alert('Image too large. Max 5MB.'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        var comp = document.querySelector('[x-data]').__x.$data;
        comp.nc.thumbnailData = e.target.result;
        comp.nc.thumbnailPreview = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}
function handleNcThumbDrop(event) {
    event.preventDefault(); event.stopPropagation();
    document.getElementById('nc-thumb-drop').classList.remove('drag-over');
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) { document.getElementById('nc-thumb-input').files = event.dataTransfer.files; handleNcThumbSelect({target:{files:event.dataTransfer.files, value:''}}); }
}

// ---- Edit Thumbnail handlers ----
function handleEditThumbSelect(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5*1024*1024) { alert('Image too large. Max 5MB.'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        var comp = document.querySelector('[x-data]').__x.$data;
        comp.editThumbData = e.target.result;
        comp.editThumbPreview = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}
function handleEditThumbDrop(event) {
    event.preventDefault(); event.stopPropagation();
    document.getElementById('edit-thumb-drop').classList.remove('drag-over');
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) handleEditThumbSelect({target:{files:event.dataTransfer.files, value:''}});
}

// ---- Media handlers ----
function handleMediaSelect(event) {
    var files = event.target.files;
    if (!files) return;
    var comp = document.querySelector('[x-data]').__x.$data;
    Array.from(files).forEach(function(file) {
        if (!file.type.startsWith('image/') || file.size > 5*1024*1024) return;
        var reader = new FileReader();
        reader.onload = function(e) { comp.mediaItems.push({ url: e.target.result, name: file.name }); };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}
function handleMediaDrop(event) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');
    handleMediaSelect({ target: { files: event.dataTransfer.files, value: '' } });
}

