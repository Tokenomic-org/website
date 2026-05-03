function articlesPage() {
    return {
        activeTab: 'analytics',
        analyticsPeriod: '30d',
        selectedArticle: null,
        sortField: 'views',
        sortDir: 'desc',
        articles: [
            { id:1, title:'Understanding DeFi Tokenomics', category:'tokenomics', sponsorship:'gold', revenue_share:10, status:'published', date:'2026-03-15', content:'', target_repo:'Tokenomic-org/website',
              github_url:'https://github.com/Tokenomic-org/website/blob/main/_posts/2026-03-15-defi-tokenomics.md', live_url:'https://tokenomic.org/articles/defi-tokenomics',
              traffic:{views:8420,visitors:5230,avg_time:'4:32',bounce_rate:'32%',shares:187,revenue:1420,
                referrers:[{source:'Google',visits:2840,pct:54},{source:'Twitter',visits:1120,pct:21},{source:'LinkedIn',visits:680,pct:13},{source:'Direct',visits:590,pct:11}]}},
            { id:2, title:'Smart Contract Security Best Practices', category:'security', sponsorship:'silver', revenue_share:10, status:'published', date:'2026-03-10', content:'', target_repo:'Tokenomic-org/website',
              github_url:'https://github.com/Tokenomic-org/website/blob/main/_posts/2026-03-10-smart-contract-security.md', live_url:'https://tokenomic.org/articles/smart-contract-security',
              traffic:{views:6150,visitors:3890,avg_time:'5:18',bounce_rate:'28%',shares:142,revenue:980,
                referrers:[{source:'Google',visits:1950,pct:50},{source:'Reddit',visits:780,pct:20},{source:'Twitter',visits:620,pct:16},{source:'GitHub',visits:540,pct:14}]}},
            { id:3, title:'Yield Farming Strategies for 2026', category:'defi', sponsorship:'', revenue_share:'', status:'draft', date:'2026-03-20', content:'', target_repo:'Tokenomic-org/website',
              github_url:'', live_url:'', traffic:null},
            { id:4, title:'Introduction to Liquidity Pools', category:'tutorial', sponsorship:'bronze', revenue_share:10, status:'published', date:'2026-02-28', content:'', target_repo:'Tokenomic-org/website',
              github_url:'https://github.com/Tokenomic-org/website/blob/main/_posts/2026-02-28-liquidity-pools.md', live_url:'https://tokenomic.org/articles/liquidity-pools',
              traffic:{views:4280,visitors:2710,avg_time:'3:45',bounce_rate:'41%',shares:94,revenue:580,
                referrers:[{source:'Google',visits:1370,pct:51},{source:'Twitter',visits:650,pct:24},{source:'Direct',visits:420,pct:15},{source:'LinkedIn',visits:270,pct:10}]}},
            { id:5, title:'Zero-Knowledge Proofs: Privacy in DeFi', category:'research', sponsorship:'gold', revenue_share:15, status:'published', date:'2026-03-01', content:'', target_repo:'Tokenomic-org/website',
              github_url:'https://github.com/Tokenomic-org/website/blob/main/_posts/2026-03-01-zk-proofs-privacy.md', live_url:'https://tokenomic.org/articles/zk-proofs-privacy',
              traffic:{views:5890,visitors:3640,avg_time:'6:12',bounce_rate:'24%',shares:168,revenue:1650,
                referrers:[{source:'Google',visits:1760,pct:48},{source:'Twitter',visits:910,pct:25},{source:'Hacker News',visits:580,pct:16},{source:'Direct',visits:390,pct:11}]}},
            { id:6, title:'Gas Optimization in Solidity', category:'tutorial', sponsorship:'', revenue_share:10, status:'published', date:'2026-02-15', content:'', target_repo:'Tokenomic-org/website',
              github_url:'https://github.com/Tokenomic-org/website/blob/main/_posts/2026-02-15-gas-optimization.md', live_url:'https://tokenomic.org/articles/gas-optimization',
              traffic:{views:3210,visitors:2180,avg_time:'4:05',bounce_rate:'38%',shares:76,revenue:320,
                referrers:[{source:'Google',visits:1280,pct:59},{source:'Stack Overflow',visits:430,pct:20},{source:'Twitter',visits:290,pct:13},{source:'Direct',visits:180,pct:8}]}}
        ],
        trafficChart: [
            {label:'Mar 21',views:890},{label:'Mar 22',views:1020},{label:'Mar 23',views:780},
            {label:'Mar 24',views:1150},{label:'Mar 25',views:1340},{label:'Mar 26',views:980},
            {label:'Mar 27',views:1200},{label:'Mar 28',views:1450},{label:'Mar 29',views:1100},
            {label:'Mar 30',views:1380},{label:'Mar 31',views:1520},{label:'Apr 1',views:1680},
            {label:'Apr 2',views:1420},{label:'Apr 3',views:960}
        ],
        get maxChartVal(){ return Math.max(...this.trafficChart.map(d=>d.views)); },
        trafficSources: [
            {name:'Organic Search',pct:48,color:'#38a169'},
            {name:'Social Media',pct:24,color:'#1DA1F2'},
            {name:'Direct',pct:14,color:'#ff6000'},
            {name:'Referral',pct:10,color:'#8b5cf6'},
            {name:'Email',pct:4,color:'#ff8f00'}
        ],
        showEditor:false, showEditorModal:false, filter:'all', publishStatus:'', publishDetails:'',
        draft:{ title:'', slug:'', category:'defi', tags:'', excerpt:'', content:'', sponsorship:'', revenue_share:10, target_repo:'Tokenomic-org/website', author:'', date:new Date().toISOString().split('T')[0], featured_image:'' },
        init() {
            var saved = sessionStorage.getItem('tkn_wallet');
            if (saved) this.draft.author = saved.slice(0,6)+'...'+saved.slice(-4);
        },
        openNewArticle() {
            this.draft = { title:'', slug:'', category:'defi', tags:'', excerpt:'', content:'', sponsorship:'', revenue_share:10, target_repo:'Tokenomic-org/website', author:this.draft.author||'', date:new Date().toISOString().split('T')[0], featured_image:'' };
            this.showEditorModal = true;
            this.activeTab = 'editor';
        },
        closeEditor() {
            this.showEditorModal = false;
        },
        autoSlug() {
            this.draft.slug = this.draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        },
        insertMd(before, after) {
            var ta = document.getElementById('md-editor');
            if (!ta) return;
            var start = ta.selectionStart, end = ta.selectionEnd;
            var text = this.draft.content || '';
            var selected = text.substring(start, end);
            this.draft.content = text.substring(0, start) + before + selected + after + text.substring(end);
            this.$nextTick(function(){ ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + selected.length); });
        },
        previewArticle() {
            if (this.draft.slug) {
                window.open('https://tokenomic.org/articles/' + this.draft.slug, '_blank');
            } else {
                alert('Add a title first to generate the article URL.');
            }
        },
        handleFeaturedImage(event) {
            var file = event.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            var self = this;
            reader.onload = function(e) {
                // Local preview is the data URL — instant feedback.
                self.draft.featured_image = e.target.result;
                // Phase 6: push the cover to Cloudflare Images for CDN
                // delivery + automatic variants. We persist the resulting
                // URL on the article row through the new
                // /api/articles/:id/cover endpoint when the draft has an
                // id (i.e. has been saved at least once). The upload is
                // best-effort — failure leaves the data-URL preview in
                // place.
                self.uploadArticleCover(file);
            };
            reader.readAsDataURL(file);
        },
        uploadArticleCover(blob) {
            var self = this;
            if (!self.draft || !self.draft.id) return; // need server-assigned id
            var apiBase = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/,'');
            var headers = { 'Content-Type': 'application/json' };
            try { var tok = window.TokenomicSupabase && TokenomicSupabase.getToken && TokenomicSupabase.getToken(); if (tok) headers.Authorization = 'Bearer ' + tok; } catch(_) {}
            fetch(apiBase + '/api/content/images/direct-upload', { method:'POST', headers: headers, credentials:'include' })
                .then(function(r){ return r.json(); })
                .then(function(d){
                    if (!d.uploadURL) throw new Error('cf-images-unavailable');
                    var fd = new FormData(); fd.append('file', blob, blob.name || 'cover.png');
                    return fetch(d.uploadURL, { method:'POST', body: fd })
                        .then(function(rr){ return rr.json(); })
                        .then(function(cf){
                            if (!cf.success) throw new Error('cf-upload-failed');
                            var variantUrl = cf.result.variants && cf.result.variants[0];
                            return fetch(apiBase + '/api/articles/' + self.draft.id + '/cover', {
                                method:'POST', headers: headers, credentials:'include',
                                body: JSON.stringify({ url: variantUrl })
                            });
                        });
                })
                .catch(function(e){ console.warn('CF Images cover upload skipped:', e.message); });
        },
        get filteredArticles() { return this.filter==='all' ? this.articles : this.articles.filter(a=>a.status===this.filter); },
        publishedArticles(){ return this.articles.filter(a=>a.status==='published'&&a.traffic); },
        sortedPublishedArticles(){
            var arts=this.publishedArticles().slice();
            var f=this.sortField,d=this.sortDir==='asc'?1:-1;
            arts.sort(function(a,b){
                var va,vb;
                if(f==='title'){va=a.title.toLowerCase();vb=b.title.toLowerCase();return va<vb?-d:va>vb?d:0;}
                if(f==='views'){va=a.traffic.views;vb=b.traffic.views;}
                else if(f==='visitors'){va=a.traffic.visitors;vb=b.traffic.visitors;}
                else if(f==='revenue'){va=a.traffic.revenue;vb=b.traffic.revenue;}
                else{va=a.traffic.views;vb=b.traffic.views;}
                return (va-vb)*d;
            });
            return arts;
        },
        sortArticles(field){
            if(this.sortField===field) this.sortDir=this.sortDir==='asc'?'desc':'asc';
            else{this.sortField=field;this.sortDir='desc';}
        },
        getArticle(id){ return this.articles.find(a=>a.id===id)||this.articles[0]; },
        totalTrafficStat(key){
            var multiplier=this.analyticsPeriod==='7d'?0.25:this.analyticsPeriod==='30d'?1:this.analyticsPeriod==='90d'?2.8:4.2;
            return Math.round(this.publishedArticles().reduce(function(s,a){return s+a.traffic[key];},0)*multiplier);
        },
        trafficTrend(key){
            var trends={views:{7:12,30:18,90:24,all:0},visitors:{7:8,30:15,90:21,all:0}};
            var p=this.analyticsPeriod==='7d'?7:this.analyticsPeriod==='30d'?30:this.analyticsPeriod==='90d'?90:'all';
            return trends[key]?trends[key][p]||0:0;
        },
        avgReadTime(){
            var arts=this.publishedArticles();if(!arts.length) return '0:00';
            var total=arts.reduce(function(s,a){var p=a.traffic.avg_time.split(':');return s+parseInt(p[0])*60+parseInt(p[1]);},0);
            var avg=Math.round(total/arts.length);return Math.floor(avg/60)+':'+(avg%60<10?'0':'')+avg%60;
        },
        avgBounceRate(){
            var arts=this.publishedArticles();if(!arts.length) return 0;
            return Math.round(arts.reduce(function(s,a){return s+parseFloat(a.traffic.bounce_rate);},0)/arts.length);
        },
        bounceTrend(){ return this.analyticsPeriod==='7d'?-3:this.analyticsPeriod==='30d'?-5:this.analyticsPeriod==='90d'?-8:0; },
        totalRevenue(){
            return this.publishedArticles().reduce(function(s,a){return s+a.traffic.revenue;},0);
        },
        sponsorRevenue(){
            return this.publishedArticles().filter(function(a){return a.sponsorship;}).reduce(function(s,a){
                var amt=a.sponsorship==='gold'?1000:a.sponsorship==='silver'?500:250;return s+amt;
            },0);
        },
        adRevenue(){
            return this.publishedArticles().reduce(function(s,a){return s+Math.round(a.traffic.views*0.012);},0);
        },
        yourShare(){
            return this.publishedArticles().reduce(function(s,a){
                var share=a.revenue_share?parseFloat(a.revenue_share)/100:0;return s+Math.round(a.traffic.revenue*share);
            },0);
        },
        editArticle(a) {
            this.draft = {
                id:a.id, title:a.title, slug:a.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''),
                category:a.category, tags:a.tags||'', excerpt:a.excerpt||'', content:a.content,
                sponsorship:a.sponsorship, revenue_share:a.revenue_share,
                target_repo:'Tokenomic-org/website', author:a.author||this.draft.author||'',
                date:a.date, featured_image:a.featured_image||''
            };
            this.showEditorModal = true;
            this.activeTab = 'editor';
        },
        saveDraft() {
            if (!this.draft.title) { alert('Add a title first.'); return; }
            var slug = this.draft.slug || this.draft.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
            var existing = this.articles.find(a=>a.id===this.draft.id);
            if (existing) {
                Object.assign(existing, {title:this.draft.title, category:this.draft.category, sponsorship:this.draft.sponsorship, revenue_share:this.draft.revenue_share, content:this.draft.content, target_repo:'Tokenomic-org/website', tags:this.draft.tags, excerpt:this.draft.excerpt, author:this.draft.author, featured_image:this.draft.featured_image});
            } else {
                this.articles.unshift({id:Date.now(), title:this.draft.title, category:this.draft.category, sponsorship:this.draft.sponsorship, revenue_share:this.draft.revenue_share, status:'draft', date:this.draft.date, content:this.draft.content, target_repo:'Tokenomic-org/website', github_url:'', live_url:'', traffic:null, tags:this.draft.tags, excerpt:this.draft.excerpt, author:this.draft.author, featured_image:this.draft.featured_image});
            }
            try { localStorage.setItem('tkn_draft_'+slug, JSON.stringify(this.draft)); } catch(e){}
            this.publishStatus = 'Draft saved!';
            this.publishDetails = slug;
            this.showEditorModal = false;
        },
        async publishToGitHub() {
            if (!this.draft.title || !this.draft.content) { alert('Add title and content.'); return; }
            var slug = this.draft.slug || this.draft.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
            var repo = 'Tokenomic-org/website';
            var date = this.draft.date || new Date().toISOString().split('T')[0];
            var frontmatter = '---\n' +
                'title: "' + this.draft.title.replace(/"/g,'\\"') + '"\n' +
                'date: ' + date + '\n' +
                'category: ' + this.draft.category + '\n' +
                (this.draft.tags ? 'tags: [' + this.draft.tags.split(',').map(function(t){return '"'+t.trim()+'"';}).join(', ') + ']\n' : '') +
                (this.draft.excerpt ? 'excerpt: "' + this.draft.excerpt.replace(/"/g,'\\"') + '"\n' : '') +
                (this.draft.author ? 'author: "' + this.draft.author + '"\n' : '') +
                (this.draft.sponsorship ? 'sponsorship: ' + this.draft.sponsorship + '\n' : '') +
                (this.draft.featured_image ? 'image: /assets/images/articles/' + slug + '-cover.webp\n' : '') +
                'slug: ' + slug + '\n' +
                '---\n\n';
            var fullContent = frontmatter + this.draft.content;
            var filePath = '_posts/' + date + '-' + slug + '.md';
            var articleData = {id:Date.now(), title:this.draft.title, category:this.draft.category, sponsorship:this.draft.sponsorship, revenue_share:this.draft.revenue_share, date:date, content:this.draft.content, target_repo:repo, tags:this.draft.tags, excerpt:this.draft.excerpt, author:this.draft.author,
                github_url:'https://github.com/'+repo+'/blob/main/'+filePath, live_url:'https://tokenomic.org/articles/'+slug,
                traffic:{views:0,visitors:0,avg_time:'0:00',bounce_rate:'0%',shares:0,revenue:0,referrers:[]}};
            try {
                var resp = await fetch('/api/github/publish', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({repo:repo, path:filePath, content:fullContent, message:'Add article: '+this.draft.title, slug:slug})
                });
                if (resp.ok) {
                    articleData.status = 'published';
                    this.publishStatus = 'Published to GitHub!';
                    this.publishDetails = 'Live at tokenomic.org/articles/' + slug;
                } else {
                    var err = await resp.json().catch(function(){return {};});
                    articleData.status = 'draft';
                    this.publishStatus = 'Saved as draft';
                    this.publishDetails = (err.error || 'GitHub API not configured') + ' — add GITHUB_PERSONAL_ACCESS_TOKEN to publish live.';
                }
            } catch(e) {
                articleData.status = 'draft';
                this.publishStatus = 'Saved as draft';
                this.publishDetails = 'GitHub API not available — article saved locally as draft.';
            }
            this.articles.unshift(articleData);
            try { localStorage.removeItem('tkn_draft_'+slug); } catch(e){}
            this.showEditorModal = false;
        }
    };
}

