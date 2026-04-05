var fs = require('fs');
var path = require('path');

var cssDir = path.join('_site', 'assets', 'css');
if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir, { recursive: true });
if (fs.existsSync('assets/css/dashboard.css')) {
  fs.copyFileSync('assets/css/dashboard.css', path.join(cssDir, 'dashboard.css'));
  console.log('Copied dashboard.css to _site/assets/css/');
}
if (fs.existsSync('assets/css/expert-profile.css')) {
  fs.copyFileSync('assets/css/expert-profile.css', path.join(cssDir, 'expert-profile.css'));
  console.log('Copied expert-profile.css to _site/assets/css/');
}
if (fs.existsSync('assets/css/community-profile.css')) {
  fs.copyFileSync('assets/css/community-profile.css', path.join(cssDir, 'community-profile.css'));
  console.log('Copied community-profile.css to _site/assets/css/');
}

var sharedJsDir = path.join('_site', 'shared', 'assets', 'js');
if (!fs.existsSync(sharedJsDir)) fs.mkdirSync(sharedJsDir, { recursive: true });
['supabase-client.js', 'web3-wallet.js', 'profile-photo.js', 'site-search.js'].forEach(function(jsFile) {
  var src = path.join('shared', 'assets', 'js', jsFile);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(sharedJsDir, jsFile));
  }
});
console.log('Copied shared JS files to _site/shared/assets/js/');

var site = {
  url: 'https://tokenomic.org',
  title: 'Tokenomic',
  logo_url: '/assets/images/logo.png',
  twitter_url: 'https://twitter.com/tknmic',
  facebook_url: 'https://facebook.com/tknmic',
  instagram_url: 'https://instagram.com/tknmic',
  youtube_url: 'https://www.youtube.com/@tknmic',
  email: 'info@tokenomic.org',
  office_address: 'Rue Robert-Céard 6, 1204 Geneva, Switzerland'
};

var headerHtml = fs.readFileSync('_includes/header.html', 'utf-8');
headerHtml = headerHtml.replace(/\{\{site\.url\}\}/g, site.url)
  .replace(/\{\{site\.title\}\}/g, site.title)
  .replace(/\{\{site\.logo_url\}\}/g, site.logo_url);

var navHtml = '<li><a href="/">Home</a></li>\n' +
  '                                    <li><a href="/courses/">Courses</a></li>\n' +
  '                                    <li><a href="/communities/">Communities</a></li>\n' +
  '                                    <li><a href="/experts/">Experts</a></li>\n' +
  '                                    <li><a href="/articles/">Articles</a></li>';

var navLoopStart = headerHtml.indexOf('{% for navigation');
if (navLoopStart !== -1) {
  var endforTag = '{% endfor %}';
  var firstEndfor = headerHtml.indexOf(endforTag, navLoopStart);
  var outerEndfor = headerHtml.indexOf(endforTag, firstEndfor + endforTag.length);
  if (outerEndfor !== -1) {
    outerEndfor += endforTag.length;
    headerHtml = headerHtml.substring(0, navLoopStart) + navHtml + headerHtml.substring(outerEndfor);
  }
}

while (headerHtml.indexOf('{%') !== -1) {
  var tagStart = headerHtml.indexOf('{%');
  var tagEnd = headerHtml.indexOf('%}', tagStart);
  if (tagEnd === -1) break;
  tagEnd += 2;
  var lineStart = headerHtml.lastIndexOf('\n', tagStart);
  var lineEnd = headerHtml.indexOf('\n', tagEnd);
  if (lineEnd === -1) lineEnd = tagEnd;
  if (lineStart === -1) lineStart = tagStart;
  headerHtml = headerHtml.substring(0, lineStart) + headerHtml.substring(lineEnd);
}

while (headerHtml.indexOf('{{') !== -1) {
  var tagStart2 = headerHtml.indexOf('{{');
  var tagEnd2 = headerHtml.indexOf('}}', tagStart2);
  if (tagEnd2 === -1) break;
  tagEnd2 += 2;
  var lineStart2 = headerHtml.lastIndexOf('\n', tagStart2);
  var lineEnd2 = headerHtml.indexOf('\n', tagEnd2);
  if (lineEnd2 === -1) lineEnd2 = tagEnd2;
  if (lineStart2 === -1) lineStart2 = tagStart2;
  headerHtml = headerHtml.substring(0, lineStart2) + headerHtml.substring(lineEnd2);
}

var footer = fs.readFileSync('_includes/footer.html', 'utf-8');
footer = footer.replace(/\{\{site\.url\}\}/g, site.url)
  .replace(/\{\{site\.title\}\}/g, site.title)
  .replace(/\{\{site\.logo_url\}\}/g, site.logo_url);

var newsletterScript = '<script>function submitNewsletter(e){e.preventDefault();var f=e.target;var email=f.querySelector("input[name=email]").value;var btn=f.querySelector("button");var msg=f.closest(".newsletter-widget").querySelector(".newsletter-msg")||document.createElement("div");btn.disabled=true;btn.textContent="Subscribing...";fetch("/api/newsletter/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})}).then(function(r){return r.json()}).then(function(d){if(d.success){btn.textContent="Subscribed!";btn.style.background="#38a169";if(msg.classList){msg.textContent=d.message;msg.style.display="block";msg.style.color="#38a169";}f.querySelector("input[name=email]").value="";}else{throw new Error(d.error)}}).catch(function(err){btn.textContent="Subscribe Now";btn.disabled=false;if(msg.classList){msg.textContent=err.message||"Please try again";msg.style.display="block";msg.style.color="#e53e3e";}});return false;}</script>';

var pageTitles = {
  'dashboard.html': 'Dashboard',
  'dashboard-articles.html': 'Articles',
  'dashboard-bookings.html': 'Bookings',
  'dashboard-chat.html': 'Chat',
  'dashboard-communities.html': 'Communities',
  'dashboard-courses.html': 'Courses',
  'dashboard-events.html': 'Events',
  'dashboard-leaderboard.html': 'Leaderboard',
  'dashboard-profile.html': 'Profile',
  'dashboard-revenue.html': 'Revenue',
  'dashboard-social.html': 'Social'
};

Object.keys(pageTitles).forEach(function(f) {
  if (!fs.existsSync(f)) {
    console.log(f + ': not found, skipping');
    return;
  }

  var source = fs.readFileSync(f, 'utf-8');
  var fmEnd = source.indexOf('---', 4);
  var content = source.substring(fmEnd + 3).trim();
  var title = pageTitles[f];

  var page = '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '    <head>\n' +
    '        <meta charset="utf-8" />\n' +
    '        <title>Tokenomic - ' + title + '</title>\n' +
    '        <link href="/assets/css/bootstrap.css" rel="stylesheet" />\n' +
    '        <link href="/assets/css/style.css" rel="stylesheet" />\n' +
    '        <link href="/assets/css/responsive.css" rel="stylesheet" />\n' +
    '        <link href="/assets/css/dashboard.css" rel="stylesheet" />\n' +
    '        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />\n' +
    '        <link rel="shortcut icon" href="/assets/images/favicon.png" type="image/x-icon" />\n' +
    '        <link rel="icon" href="/assets/images/favicon.png" type="image/x-icon" />\n' +
    '        <meta http-equiv="X-UA-Compatible" content="IE=edge" />\n' +
    '        <meta name="viewport" content="width=device-width,height=device-height,initial-scale=1.0,maximum-scale=2.0,minimum-scale=1.0" />\n' +
    '        <script async src="https://www.googletagmanager.com/gtag/js?id=G-1MD9B5BB1P"></script>\n' +
    '        <script>\n' +
    '          window.dataLayer = window.dataLayer || [];\n' +
    '          function gtag(){dataLayer.push(arguments);}\n' +
    '          gtag("js", new Date());\n' +
    '          gtag("config", "G-1MD9B5BB1P");\n' +
    '        </script>\n' +
    '        <style>\n' +
    '            .header-style-two { top: 0; background: #0A0F1A; }\n' +
    '            .dashboard-section { padding-top: 100px !important; }\n' +
    '            .main-menu .navigation > li { margin-right: 20px; }\n' +
    '            .main-menu .navigation > li > a { font-size: 15px; }\n' +
    '        </style>\n' +
    '        <link rel="alternate" type="application/rss+xml" title="Tokenomic RSS Feed" href="/feed.xml" />\n' +
    '    </head>\n' +
    '    <body>\n' +
    '        <div class="page-wrapper">\n' +
    headerHtml + '\n' +
    content + '\n' +
    footer + '\n' +
    newsletterScript + '\n' +
    '        </div>\n' +
    '        <div class="scroll-to-top scroll-to-target" data-target="html"><span class="flaticon-up-arrow"></span></div>\n' +
    '        <script src="/assets/js/jquery.js"></script>\n' +
    '        <script src="/assets/js/popper.min.js"></script>\n' +
    '        <script src="/assets/js/bootstrap.min.js"></script>\n' +
    '        <script src="/assets/js/jquery-ui.js"></script>\n' +
    '        <script src="/assets/js/jquery.fancybox.js"></script>\n' +
    '        <script src="/assets/js/owl.js"></script>\n' +
    '        <script src="/assets/js/scrollbar.js"></script>\n' +
    '        <script src="/assets/js/knob.js"></script>\n' +
    '        <script src="/assets/js/paroller.js"></script>\n' +
    '        <script src="/assets/js/tilt.js"></script>\n' +
    '        <script src="/assets/js/isotope.js"></script>\n' +
    '        <script src="/assets/js/appear.js"></script>\n' +
    '        <script src="/assets/js/wow.js"></script>\n' +
    '        <script src="/assets/js/custom-script.js"></script>\n' +
    '        <script src="/shared/assets/js/supabase-client.js"></script>\n' +
    '        <script src="/shared/assets/js/profile-photo.js"></script>\n' +
    '        <script src="/shared/assets/js/web3-wallet.js"></script>\n' +
    '        <script src="/assets/js/simple-jekyll-search.min.js"></script>\n' +
    '        <script src="/shared/assets/js/site-search.js"></script>\n' +
    '        <script defer src="https://unpkg.com/alpinejs@3.13.3/dist/cdn.min.js"></script>\n' +
    '        <script>\n' +
    '        (function() {\n' +
    '            var flatIconMap = {"flaticon-home-1":"fas fa-home","flaticon-user-3":"fas fa-users","flaticon-notebook":"fas fa-book","flaticon-calendar":"fas fa-calendar","flaticon-money":"fas fa-chart-line","flaticon-speech-bubble":"fas fa-comments","flaticon-edit":"fas fa-pen-to-square","flaticon-share":"fas fa-share-nodes","flaticon-trophy":"fas fa-trophy","flaticon-suitcase":"fas fa-calendar-check","flaticon-user":"fas fa-user"};\n' +
    '            function initMobileDashNav() {\n' +
    '                if (window.innerWidth > 991) return;\n' +
    '                var sidebar = document.querySelector(".dashboard-sidebar");\n' +
    '                if (!sidebar) return;\n' +
    '                var sidebarCol = sidebar.parentElement;\n' +
    '                var contentCol = sidebarCol ? sidebarCol.nextElementSibling : null;\n' +
    '                if (sidebarCol) sidebarCol.classList.add("dashboard-sidebar-col");\n' +
    '                if (contentCol) contentCol.classList.add("dashboard-content-col");\n' +
    '                function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML;}\n' +
    '                var profileData = {};\n' +
    '                try { profileData = JSON.parse(localStorage.getItem("tkn_profile_data") || "{}"); } catch(e) {}\n' +
    '                var userName = esc(profileData.displayName || profileData.name || "Tokenomic");\n' +
    '                var photo = esc(localStorage.getItem("tkn_profile_photo") || "");\n' +
    '                var initials = (userName || "T").trim().charAt(0).toUpperCase();\n' +
    '                var avatarHtml = photo\n' +
    '                    ? \'<img src="\' + photo + \'" alt="\' + userName + \'" />\'\n' +
    '                    : initials;\n' +
    '                var navItemsHtml = "";\n' +
    '                var children = sidebar.querySelectorAll(".sidebar-section-label, .dash-nav-item");\n' +
    '                for (var i = 0; i < children.length; i++) {\n' +
    '                    var el = children[i];\n' +
    '                    if (el.classList.contains("sidebar-section-label")) {\n' +
    '                        navItemsHtml += \'<div class="mob-section-label">\' + el.textContent.trim() + "</div>";\n' +
    '                    } else {\n' +
    '                        var href = el.getAttribute("href") || "#";\n' +
    '                        var iconEl = el.querySelector("i");\n' +
    '                        var iconHtml = "";\n' +
    '                        if (iconEl) { iconHtml = iconEl.outerHTML; }\n' +
    '                        else {\n' +
    '                            var spanIcon = el.querySelector("span[class*=flaticon]");\n' +
    '                            if (spanIcon) {\n' +
    '                                var cls = spanIcon.className.split(" ").filter(function(c){return c.indexOf("flaticon")===0;})[0] || "";\n' +
    '                                var faClass = flatIconMap[cls] || "fas fa-circle";\n' +
    '                                iconHtml = \'<i class="\' + faClass + \'"></i>\';\n' +
    '                            }\n' +
    '                        }\n' +
    '                        var label = el.textContent.trim();\n' +
    '                        var isActive = el.classList.contains("active") ? " active" : "";\n' +
    '                        navItemsHtml += \'<a href="\' + href + \'" class="mob-nav-item\' + isActive + \'">\' + iconHtml + " " + label + "</a>";\n' +
    '                    }\n' +
    '                }\n' +
    '                var barHtml = \'<div class="mobile-dash-bar" id="mobileDashBar">\' +\n' +
    '                    \'<div class="mobile-dash-bar-user">\' +\n' +
    '                    \'<div class="mobile-dash-bar-avatar">\' + avatarHtml + "</div>" +\n' +
    '                    \'<div class="mobile-dash-bar-info">\' +\n' +
    '                    \'<span class="mobile-dash-bar-name">\' + userName + "</span>" +\n' +
    '                    \'<span class="mobile-dash-bar-label">Dashboard</span>\' +\n' +
    '                    "</div></div>" +\n' +
    '                    \'<button class="mobile-dash-bar-toggle" aria-label="Toggle navigation">\' +\n' +
    '                    \'Menu <i class="fas fa-chevron-down mob-chevron"></i>\' +\n' +
    '                    "</button></div>";\n' +
    '                var dropdownHtml = \'<div class="mobile-dash-dropdown" id="mobileDashDropdown">\' + navItemsHtml + "</div>";\n' +
    '                if (contentCol) {\n' +
    '                    contentCol.insertAdjacentHTML("afterbegin", dropdownHtml);\n' +
    '                    contentCol.insertAdjacentHTML("afterbegin", barHtml);\n' +
    '                }\n' +
    '                var bar = document.getElementById("mobileDashBar");\n' +
    '                var dropdown = document.getElementById("mobileDashDropdown");\n' +
    '                if (bar && dropdown) {\n' +
    '                    bar.addEventListener("click", function() {\n' +
    '                        bar.classList.toggle("open");\n' +
    '                        dropdown.classList.toggle("open");\n' +
    '                    });\n' +
    '                    var links = dropdown.querySelectorAll(".mob-nav-item");\n' +
    '                    for (var j = 0; j < links.length; j++) {\n' +
    '                        links[j].addEventListener("click", function() {\n' +
    '                            bar.classList.remove("open");\n' +
    '                            dropdown.classList.remove("open");\n' +
    '                        });\n' +
    '                    }\n' +
    '                }\n' +
    '            }\n' +
    '            if (document.readyState === "loading") {\n' +
    '                document.addEventListener("DOMContentLoaded", initMobileDashNav);\n' +
    '            } else {\n' +
    '                initMobileDashNav();\n' +
    '            }\n' +
    '        })();\n' +
    '        </script>\n' +
    '    </body>\n' +
    '</html>\n';

  var dirName = f.replace(/\.html$/, '');
  var siteDir = '_site/' + dirName;
  if (!fs.existsSync(siteDir)) {
    fs.mkdirSync(siteDir, { recursive: true });
  }
  fs.writeFileSync(siteDir + '/index.html', page);
  console.log('Built: ' + siteDir + '/index.html (' + page.length + ' bytes)');
});

var publicPages = {
  'courses.html': { dir: '_site/courses', title: 'Courses' },
  'communities.html': { dir: '_site/communities', title: 'Communities' },
  'educators.html': { dir: '_site/experts', title: 'Experts' },
  'learn.html': { dir: '_site/articles', title: 'Articles' },
  'articles.html': { dir: '_site/articles', title: 'Articles' },
  'expert-profile.html': { dir: '_site/expert', title: 'Expert Profile' },
  'community-profile.html': { dir: '_site/community', title: 'Community' }
};

Object.keys(publicPages).forEach(function(f) {
  if (!fs.existsSync(f)) return;
  var conf = publicPages[f];
  var source = fs.readFileSync(f, 'utf-8');
  var fmEnd = source.indexOf('---', 4);
  var content = source.substring(fmEnd + 3).trim();
  content = content.replace(/\{%\s*include\s+header\.html\s*%\}/g, '');
  content = content.replace(/<script\s+src="\/shared\/assets\/js\/[^"]+"><\/script>\s*/g, '');

  var publicPage = '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '    <head>\n' +
    '        <meta charset="utf-8" />\n' +
    '        <title>Tokenomic - ' + conf.title + '</title>\n' +
    '        <link href="/assets/css/bootstrap.css" rel="stylesheet" />\n' +
    '        <link href="/assets/css/style.css" rel="stylesheet" />\n' +
    '        <link href="/assets/css/responsive.css" rel="stylesheet" />\n' +
    '        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />\n' +
    '        <link rel="shortcut icon" href="/assets/images/favicon.png" type="image/x-icon" />\n' +
    '        <link rel="icon" href="/assets/images/favicon.png" type="image/x-icon" />\n' +
    '        <meta http-equiv="X-UA-Compatible" content="IE=edge" />\n' +
    '        <meta name="viewport" content="width=device-width,height=device-height,initial-scale=1.0,maximum-scale=2.0,minimum-scale=1.0" />\n' +
    '        <script async src="https://www.googletagmanager.com/gtag/js?id=G-1MD9B5BB1P"></script>\n' +
    '        <script>\n' +
    '          window.dataLayer = window.dataLayer || [];\n' +
    '          function gtag(){dataLayer.push(arguments);}\n' +
    '          gtag("js", new Date());\n' +
    '          gtag("config", "G-1MD9B5BB1P");\n' +
    '        </script>\n' +
    '        <style>\n' +
    '            .header-style-two { top: 0; background: #0A0F1A; }\n' +
    '            .main-menu .navigation > li { margin-right: 20px; }\n' +
    '            .main-menu .navigation > li > a { font-size: 15px; }\n' +
    '        </style>\n' +
    '        <link rel="alternate" type="application/rss+xml" title="Tokenomic RSS Feed" href="/feed.xml" />\n' +
    '    </head>\n' +
    '    <body>\n' +
    '        <div class="page-wrapper">\n' +
    headerHtml + '\n' +
    content + '\n' +
    footer + '\n' +
    newsletterScript + '\n' +
    '        </div>\n' +
    '        <div class="scroll-to-top scroll-to-target" data-target="html"><span class="flaticon-up-arrow"></span></div>\n' +
    '        <script src="/assets/js/jquery.js"></script>\n' +
    '        <script src="/assets/js/popper.min.js"></script>\n' +
    '        <script src="/assets/js/bootstrap.min.js"></script>\n' +
    '        <script src="/assets/js/jquery-ui.js"></script>\n' +
    '        <script src="/assets/js/jquery.fancybox.js"></script>\n' +
    '        <script src="/assets/js/owl.js"></script>\n' +
    '        <script src="/assets/js/scrollbar.js"></script>\n' +
    '        <script src="/assets/js/knob.js"></script>\n' +
    '        <script src="/assets/js/paroller.js"></script>\n' +
    '        <script src="/assets/js/tilt.js"></script>\n' +
    '        <script src="/assets/js/isotope.js"></script>\n' +
    '        <script src="/assets/js/appear.js"></script>\n' +
    '        <script src="/assets/js/wow.js"></script>\n' +
    '        <script src="/assets/js/custom-script.js"></script>\n' +
    '        <script src="/shared/assets/js/supabase-client.js"></script>\n' +
    '        <script src="/shared/assets/js/profile-photo.js"></script>\n' +
    '        <script src="/shared/assets/js/web3-wallet.js"></script>\n' +
    '        <script src="/assets/js/simple-jekyll-search.min.js"></script>\n' +
    '        <script src="/shared/assets/js/site-search.js"></script>\n' +
    '    </body>\n' +
    '</html>\n';

  if (!fs.existsSync(conf.dir)) {
    fs.mkdirSync(conf.dir, { recursive: true });
  }
  fs.writeFileSync(conf.dir + '/index.html', publicPage);
  console.log('Built: ' + conf.dir + '/index.html (' + publicPage.length + ' bytes)');
});

(function buildFeed() {
  var articlesPath = path.join('scripts', 'articles-data.json');
  if (!fs.existsSync(articlesPath)) return;
  var articles = JSON.parse(fs.readFileSync(articlesPath, 'utf-8'));
  var siteUrl = 'https://tokenomic.org';
  var now = new Date().toUTCString();

  function escXml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  var items = articles
    .filter(function(a) { return a.slug && a.title && a.date; })
    .sort(function(a, b) { return new Date(b.date) - new Date(a.date); })
    .map(function(a) {
      var url = siteUrl + '/articles/' + a.slug + '/';
      var excerpt = escXml(stripHtml(a.content));
      var imgLine = a.featured_image ? '\n      <enclosure url="' + siteUrl + a.featured_image + '" type="image/jpeg" length="0" />' : '';
      return '    <item>\n' +
        '      <title>' + escXml(a.title) + '</title>\n' +
        '      <link>' + url + '</link>\n' +
        '      <guid isPermaLink="true">' + url + '</guid>\n' +
        '      <pubDate>' + new Date(a.date + 'T00:00:00Z').toUTCString() + '</pubDate>\n' +
        '      <category>' + escXml(a.category) + '</category>\n' +
        '      <author>' + escXml(a.author) + '</author>\n' +
        '      <description>' + excerpt + '</description>' + imgLine + '\n' +
        '    </item>';
    }).join('\n');

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n' +
    '  <channel>\n' +
    '    <title>Tokenomic</title>\n' +
    '    <link>' + siteUrl + '</link>\n' +
    '    <description>Institutional DeFi education, intelligence, and tokenomic research.</description>\n' +
    '    <language>en-us</language>\n' +
    '    <managingEditor>hello@tokenomic.org (Guillaume Lauzier)</managingEditor>\n' +
    '    <webMaster>hello@tokenomic.org (Guillaume Lauzier)</webMaster>\n' +
    '    <lastBuildDate>' + now + '</lastBuildDate>\n' +
    '    <atom:link href="' + siteUrl + '/feed.xml" rel="self" type="application/rss+xml" />\n' +
    '    <image>\n' +
    '      <url>' + siteUrl + '/assets/images/favicon.png</url>\n' +
    '      <title>Tokenomic</title>\n' +
    '      <link>' + siteUrl + '</link>\n' +
    '    </image>\n' +
    items + '\n' +
    '  </channel>\n' +
    '</rss>';

  fs.writeFileSync(path.join('_site', 'feed.xml'), xml);
  console.log('Built: _site/feed.xml (' + articles.length + ' articles)');
})();
