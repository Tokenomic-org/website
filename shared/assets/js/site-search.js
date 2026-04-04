(function() {
    var searchData = null;

    function loadSearchData(callback) {
        if (searchData) return callback(searchData);
        if (typeof TokenomicSupabase === 'undefined') {
            searchData = { articles: [], educators: [], consultants: [] };
            return callback(searchData);
        }
        if (!TokenomicSupabase.client && !TokenomicSupabase._initialized) {
            TokenomicSupabase.init();
            TokenomicSupabase._initialized = true;
        }
        var loaded = { articles: null, educators: null, consultants: null };
        var remaining = 3;
        function checkDone() {
            remaining--;
            if (remaining <= 0) {
                searchData = {
                    articles: loaded.articles || [],
                    educators: loaded.educators || [],
                    consultants: loaded.consultants || []
                };
                callback(searchData);
            }
        }
        TokenomicSupabase.getArticles().then(function(d) { loaded.articles = d; checkDone(); }).catch(function() { checkDone(); });
        TokenomicSupabase.getEducators().then(function(d) { loaded.educators = d; checkDone(); }).catch(function() { checkDone(); });
        TokenomicSupabase.getConsultants().then(function(d) { loaded.consultants = d; checkDone(); }).catch(function() { checkDone(); });
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function performSearch(query) {
        var container = document.getElementById('results-container');
        if (!container) return;
        if (!query || query.trim().length < 2) {
            container.innerHTML = '<li class="search-message">Type at least 2 characters to search</li>';
            return;
        }

        container.innerHTML = '<li class="search-message">Searching...</li>';

        loadSearchData(function(data) {
            var terms = query.toLowerCase().trim().split(/\s+/);
            var results = [];

            for (var i = 0; i < data.articles.length; i++) {
                var a = data.articles[i];
                var searchText = [
                    a.title || '',
                    a.category || '',
                    a.excerpt || '',
                    a.slug ? a.slug.replace(/-/g, ' ') : '',
                    (a.profiles && a.profiles.display_name) ? a.profiles.display_name : ''
                ].join(' ').toLowerCase();

                var matchCount = 0;
                for (var t = 0; t < terms.length; t++) {
                    if (searchText.indexOf(terms[t]) !== -1) matchCount++;
                }
                if (matchCount > 0) {
                    results.push({
                        type: 'article',
                        title: a.title,
                        subtitle: 'By ' + ((a.profiles && a.profiles.display_name) ? a.profiles.display_name : 'Tokenomic Team'),
                        badge: a.category || 'Article',
                        link: '/articles/' + a.slug,
                        score: matchCount
                    });
                }
            }

            for (var e = 0; e < data.educators.length; e++) {
                var ed = data.educators[e];
                var edText = [
                    ed.display_name || '',
                    ed.specialty || '',
                    ed.bio || '',
                    ed.wallet_address || '',
                    'educator'
                ].join(' ').toLowerCase();

                var edMatch = 0;
                for (var t2 = 0; t2 < terms.length; t2++) {
                    if (edText.indexOf(terms[t2]) !== -1) edMatch++;
                }
                if (edMatch > 0) {
                    results.push({
                        type: 'educator',
                        title: ed.display_name || 'Educator',
                        subtitle: ed.specialty || '',
                        badge: 'Educator',
                        link: '/experts/',
                        score: edMatch
                    });
                }
            }

            for (var c = 0; c < data.consultants.length; c++) {
                var con = data.consultants[c];
                var conText = [
                    con.display_name || '',
                    con.specialty || '',
                    con.bio || '',
                    con.wallet_address || '',
                    'consultant'
                ].join(' ').toLowerCase();

                var conMatch = 0;
                for (var t3 = 0; t3 < terms.length; t3++) {
                    if (conText.indexOf(terms[t3]) !== -1) conMatch++;
                }
                if (conMatch > 0) {
                    var isDuplicate = false;
                    for (var d = 0; d < results.length; d++) {
                        if (results[d].type === 'educator' && results[d].title === con.display_name) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (!isDuplicate) {
                        results.push({
                            type: 'consultant',
                            title: con.display_name || 'Consultant',
                            subtitle: con.specialty || '',
                            badge: 'Consultant',
                            link: '/experts/#consultants',
                            score: conMatch
                        });
                    }
                }
            }

            results.sort(function(a, b) { return b.score - a.score; });

            if (results.length === 0) {
                container.innerHTML = '<li class="search-message">No results found for "' + escapeHtml(query) + '"</li>';
                return;
            }

            var html = '';
            var limit = results.length > 10 ? 10 : results.length;
            for (var r = 0; r < limit; r++) {
                var item = results[r];
                var badgeClass = 'sr-badge-' + item.type;
                html += '<li class="search-result-item">';
                html += '<a href="' + item.link + '">';
                html += '<span class="sr-cat ' + badgeClass + '">' + escapeHtml(item.badge) + '</span>';
                html += '<span class="sr-title">' + escapeHtml(item.title) + '</span>';
                html += '<span class="sr-author">' + escapeHtml(item.subtitle) + '</span>';
                html += '</a></li>';
            }
            if (results.length > 10) {
                html += '<li class="search-message" style="font-size:13px;color:#5a8299;">Showing 10 of ' + results.length + ' results</li>';
            }
            container.innerHTML = html;
        });
    }

    function ensurePopupExists() {
        if (document.getElementById('search-popup')) return;
        var popupHtml = '<div id="search-popup" class="search-popup">' +
            '<div class="close-search theme-btn"><span class="flaticon-targeting-cross"></span></div>' +
            '<div class="popup-inner">' +
            '<div class="overlay-layer"></div>' +
            '<div class="search-form">' +
            '<form action="javascript:void(0)">' +
            '<div class="form-group"><fieldset>' +
            '<input type="search" class="form-control" name="search-input" value="" id="search-input" placeholder="Search Here" required />' +
            '<input type="submit" value="Search Now!" class="theme-btn" />' +
            '</fieldset></div></form>' +
            '<ul id="results-container"></ul>' +
            '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', popupHtml);

        var popup = document.getElementById('search-popup');
        var closeBtn = popup.querySelector('.close-search');
        var overlay = popup.querySelector('.overlay-layer');
        if (closeBtn) closeBtn.addEventListener('click', function() { popup.classList.remove('popup-visible'); document.body.classList.remove('search-visible'); });
        if (overlay) overlay.addEventListener('click', function() { popup.classList.remove('popup-visible'); document.body.classList.remove('search-visible'); });
        document.addEventListener('keydown', function(e) { if (e.keyCode === 27) { popup.classList.remove('popup-visible'); document.body.classList.remove('search-visible'); } });

        var togglers = document.querySelectorAll('.search-toggler');
        for (var i = 0; i < togglers.length; i++) {
            togglers[i].addEventListener('click', function() {
                popup.classList.add('popup-visible');
                document.body.classList.add('search-visible');
            });
        }
    }

    function initSearch() {
        ensurePopupExists();
        var popup = document.getElementById('search-popup');
        var input = document.getElementById('search-input');
        if (!popup || !input) return;

        var form = input.closest('form');
        if (form) {
            form.setAttribute('action', 'javascript:void(0)');
            form.removeAttribute('method');
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                performSearch(input.value);
            });
        }

        var debounceTimer;
        input.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            var val = input.value;
            debounceTimer = setTimeout(function() {
                performSearch(val);
            }, 300);
        });

        var observer = new MutationObserver(function(mutations) {
            for (var m = 0; m < mutations.length; m++) {
                if (popup.classList.contains('popup-visible') || popup.classList.contains('active') || popup.style.display === 'block') {
                    input.focus();
                    loadSearchData(function() {});
                    break;
                }
            }
        });
        observer.observe(popup, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    var style = document.createElement('style');
    style.textContent = '' +
        '#results-container { list-style: none; padding: 0; margin: 20px 0 0; max-height: 400px; overflow-y: auto; }' +
        '#results-container .search-result-item { margin-bottom: 2px; }' +
        '#results-container .search-result-item a { display: block; padding: 14px 18px; background: rgba(255,255,255,0.05); border-radius: 8px; text-decoration: none; transition: background 0.2s; }' +
        '#results-container .search-result-item a:hover { background: rgba(255,96,0,0.15); }' +
        '#results-container .sr-cat { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }' +
        '#results-container .sr-badge-article { background: #ff6000; color: #fff; }' +
        '#results-container .sr-badge-educator { background: #00C853; color: #fff; }' +
        '#results-container .sr-badge-consultant { background: #2196F3; color: #fff; }' +
        '#results-container .sr-title { display: block; color: #fff; font-size: 16px; font-weight: 600; line-height: 1.4; margin-top: 4px; }' +
        '#results-container .sr-author { display: block; color: #5a8299; font-size: 12px; margin-top: 4px; }' +
        '#results-container .search-message { padding: 16px; color: #5a8299; font-size: 14px; text-align: center; }';
    document.head.appendChild(style);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSearch);
    } else {
        initSearch();
    }
})();
