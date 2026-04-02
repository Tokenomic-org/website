(function() {
    var searchArticles = null;

    function loadArticles(callback) {
        if (searchArticles) return callback(searchArticles);
        if (typeof TokenomicSupabase !== 'undefined') {
            if (!TokenomicSupabase.client && !TokenomicSupabase._initialized) {
                TokenomicSupabase.init();
                TokenomicSupabase._initialized = true;
            }
            TokenomicSupabase.getArticles().then(function(data) {
                searchArticles = data || [];
                callback(searchArticles);
            }).catch(function() {
                searchArticles = [];
                callback(searchArticles);
            });
        } else {
            searchArticles = [];
            callback(searchArticles);
        }
    }

    function performSearch(query) {
        var container = document.getElementById('results-container');
        if (!container) return;
        if (!query || query.trim().length < 2) {
            container.innerHTML = '<li class="search-message">Type at least 2 characters to search</li>';
            return;
        }

        container.innerHTML = '<li class="search-message">Searching...</li>';

        loadArticles(function(articles) {
            var terms = query.toLowerCase().trim().split(/\s+/);
            var results = [];

            for (var i = 0; i < articles.length; i++) {
                var a = articles[i];
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
                    results.push({ article: a, score: matchCount });
                }
            }

            results.sort(function(a, b) { return b.score - a.score; });

            if (results.length === 0) {
                container.innerHTML = '<li class="search-message">No articles found for "' + query.replace(/</g, '&lt;') + '"</li>';
                return;
            }

            var html = '';
            var limit = results.length > 8 ? 8 : results.length;
            for (var r = 0; r < limit; r++) {
                var art = results[r].article;
                var link = '/' + art.slug;
                var authorName = (art.profiles && art.profiles.display_name) ? art.profiles.display_name : 'Tokenomic Team';
                html += '<li class="search-result-item">';
                html += '<a href="' + link + '">';
                html += '<span class="sr-cat">' + (art.category || '') + '</span>';
                html += '<span class="sr-title">' + art.title + '</span>';
                html += '<span class="sr-author">By ' + authorName + '</span>';
                html += '</a></li>';
            }
            if (results.length > 8) {
                html += '<li class="search-message" style="font-size:13px;color:#5a8299;">Showing 8 of ' + results.length + ' results</li>';
            }
            container.innerHTML = html;
        });
    }

    function initSearch() {
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
                if (popup.classList.contains('active') || popup.style.display === 'block') {
                    input.focus();
                    loadArticles(function() {});
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
        '#results-container .sr-cat { display: inline-block; padding: 2px 10px; background: #ff6000; color: #fff; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }' +
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
