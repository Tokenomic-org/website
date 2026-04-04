var fs = require('fs');
var path = require('path');

var cssDir = path.join('_site', 'assets', 'css');
if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir, { recursive: true });
if (fs.existsSync('assets/css/dashboard.css')) {
  fs.copyFileSync('assets/css/dashboard.css', path.join(cssDir, 'dashboard.css'));
  console.log('Copied dashboard.css to _site/assets/css/');
}

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
  '                                    <li><a href="/about/">About</a></li>\n' +
  '                                    <li><a href="/experts/">Experts</a></li>\n' +
  '                                    <li><a href="/learn/">Learn</a></li>';

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
    '            function initMobileSidebar() {\n' +
    '                var sidebarCol = document.querySelector(".dashboard-sidebar")\n' +
    '                    ? document.querySelector(".dashboard-sidebar").parentElement\n' +
    '                    : null;\n' +
    '                if (!sidebarCol) return;\n' +
    '                sidebarCol.classList.add("dashboard-sidebar-col");\n' +
    '                var contentCol = sidebarCol.nextElementSibling;\n' +
    '                if (contentCol) contentCol.classList.add("dashboard-content-col");\n' +
    '                var sidebar = sidebarCol.querySelector(".dashboard-sidebar");\n' +
    '                var closeBtn = document.createElement("button");\n' +
    '                closeBtn.className = "sidebar-close-btn";\n' +
    '                closeBtn.innerHTML = \'<i class="fas fa-times"></i>\';\n' +
    '                closeBtn.setAttribute("aria-label", "Close menu");\n' +
    '                sidebar.insertBefore(closeBtn, sidebar.firstChild);\n' +
    '                var overlay = document.createElement("div");\n' +
    '                overlay.className = "sidebar-overlay";\n' +
    '                document.body.appendChild(overlay);\n' +
    '                var toggleBtn = document.createElement("button");\n' +
    '                toggleBtn.className = "sidebar-toggle-btn";\n' +
    '                toggleBtn.innerHTML = \'<i class="fas fa-bars"></i>\';\n' +
    '                toggleBtn.setAttribute("aria-label", "Open menu");\n' +
    '                document.body.appendChild(toggleBtn);\n' +
    '                function openSidebar() {\n' +
    '                    sidebarCol.classList.add("open");\n' +
    '                    overlay.classList.add("visible");\n' +
    '                    toggleBtn.classList.add("open");\n' +
    '                    document.body.style.overflow = "hidden";\n' +
    '                }\n' +
    '                function closeSidebar() {\n' +
    '                    sidebarCol.classList.remove("open");\n' +
    '                    overlay.classList.remove("visible");\n' +
    '                    toggleBtn.classList.remove("open");\n' +
    '                    document.body.style.overflow = "";\n' +
    '                }\n' +
    '                toggleBtn.addEventListener("click", openSidebar);\n' +
    '                closeBtn.addEventListener("click", closeSidebar);\n' +
    '                overlay.addEventListener("click", closeSidebar);\n' +
    '                var navLinks = sidebar.querySelectorAll(".dash-nav-item");\n' +
    '                for (var i = 0; i < navLinks.length; i++) {\n' +
    '                    navLinks[i].addEventListener("click", closeSidebar);\n' +
    '                }\n' +
    '                window.addEventListener("resize", function() {\n' +
    '                    if (window.innerWidth > 991) closeSidebar();\n' +
    '                });\n' +
    '            }\n' +
    '            if (document.readyState === "loading") {\n' +
    '                document.addEventListener("DOMContentLoaded", initMobileSidebar);\n' +
    '            } else {\n' +
    '                initMobileSidebar();\n' +
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
