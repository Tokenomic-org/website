var fs = require('fs');

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

var header5 = fs.readFileSync('_includes/header_5.html', 'utf-8');
header5 = header5.replace(/\{\{site\.url\}\}/g, site.url)
  .replace(/\{\{site\.title\}\}/g, site.title)
  .replace(/\{\{site\.logo_url\}\}/g, site.logo_url)
  .replace(/\{\{site\.twitter_url\}\}/g, site.twitter_url)
  .replace(/\{\{site\.facebook_url\}\}/g, site.facebook_url)
  .replace(/\{\{site\.instagram_url\}\}/g, site.instagram_url)
  .replace(/\{\{site\.youtube_url\}\}/g, site.youtube_url)
  .replace(/\{\{site\.email\}\}/g, site.email)
  .replace(/\{\{site\.office_address\}\}/g, site.office_address);

var navHtml = '<li><a href="/">Home</a></li>\n' +
  '                                    <li><a href="/about/">About</a></li>\n' +
  '                                    <li><a href="/experts/">Experts</a></li>\n' +
  '                                    <li><a href="/learn/">Learn</a></li>';

var navLoopStart = header5.indexOf('{% for navigation');
if (navLoopStart !== -1) {
  var endforTag = '{% endfor %}';
  var firstEndfor = header5.indexOf(endforTag, navLoopStart);
  var outerEndfor = header5.indexOf(endforTag, firstEndfor + endforTag.length);
  if (outerEndfor !== -1) {
    outerEndfor += endforTag.length;
    header5 = header5.substring(0, navLoopStart) + navHtml + header5.substring(outerEndfor);
  }
}

var socialHtml = '<li><a href="' + site.twitter_url + '"><span class="fab fa-twitter"></span></a></li>\n' +
  '<li><a href="' + site.facebook_url + '"><span class="fab fa-facebook-square"></span></a></li>\n' +
  '<li><a href="' + site.instagram_url + '"><span class="fab fa-instagram"></span></a></li>\n' +
  '<li><a href="' + site.youtube_url + '"><span class="fab fa-youtube"></span></a></li>\n';

while (header5.indexOf('{%') !== -1) {
  var tagStart = header5.indexOf('{%');
  var tagEnd = header5.indexOf('%}', tagStart);
  if (tagEnd === -1) break;
  tagEnd += 2;
  var line = header5.substring(tagStart, tagEnd);
  var lineStart = header5.lastIndexOf('\n', tagStart);
  var lineEnd = header5.indexOf('\n', tagEnd);
  if (lineEnd === -1) lineEnd = tagEnd;
  if (lineStart === -1) lineStart = tagStart;
  header5 = header5.substring(0, lineStart) + header5.substring(lineEnd);
}

while (header5.indexOf('{{') !== -1) {
  var tagStart2 = header5.indexOf('{{');
  var tagEnd2 = header5.indexOf('}}', tagStart2);
  if (tagEnd2 === -1) break;
  tagEnd2 += 2;
  var lineStart2 = header5.lastIndexOf('\n', tagStart2);
  var lineEnd2 = header5.indexOf('\n', tagEnd2);
  if (lineEnd2 === -1) lineEnd2 = tagEnd2;
  if (lineStart2 === -1) lineStart2 = tagStart2;
  header5 = header5.substring(0, lineStart2) + header5.substring(lineEnd2);
}

if (header5.indexOf('wallet-btn-header') === -1 && header5.indexOf('tkn-login-box') !== -1) {
  var loginBoxStart = header5.indexOf('<div class="tkn-login-box">');
  var loginBoxEnd = header5.indexOf('</div>', header5.indexOf('</a>', header5.indexOf('wallet-logged-in-btn', loginBoxStart)));
  if (loginBoxEnd !== -1) {
    loginBoxEnd = header5.indexOf('</div>', loginBoxEnd + 6) + '</div>'.length;
    var newLoginBox = '<div class="other-links clearfix">\n' +
      '                    <div class="search-btn">\n' +
      '                        <button class="search-toggler"><span class="flaticon-search"></span></button>\n' +
      '                    </div>\n' +
      '                    <div class="wallet-btn-header">\n' +
      '                        <a href="#" class="wallet-login-btn" onclick="TokenomicWallet.connect(); return false;">Connect Wallet</a>\n' +
      '                        <a href="/dashboard/" class="wallet-logged-in-btn" style="display:none;">Dashboard</a>\n' +
      '                    </div>\n' +
      '                </div>';
    header5 = header5.substring(0, loginBoxStart) + newLoginBox + header5.substring(loginBoxEnd);
  }
}

var footer = fs.readFileSync('_includes/footer.html', 'utf-8');
footer = footer.replace(/\{\{site\.url\}\}/g, site.url)
  .replace(/\{\{site\.title\}\}/g, site.title)
  .replace(/\{\{site\.logo_url\}\}/g, site.logo_url);

var headerStyles = '<style>\n' +
  '.header-upper .inner { display:flex !important;align-items:center;justify-content:space-between; }\n' +
  '.header-upper .nav-content { float:none !important;width:auto !important;flex:1; }\n' +
  '.header-upper .other-links { display:flex !important;align-items:center;gap:12px;float:none !important;background:none !important;padding:0 !important;position:static !important;top:auto !important;flex-shrink:0; }\n' +
  '.header-upper .search-btn { float:none !important;display:flex !important;align-items:center; } .header-upper .search-btn .search-toggler { display:flex !important;align-items:center;justify-content:center;background:none !important;border:none !important;padding:0 !important;margin:0 !important;cursor:pointer;color:#ffffff;font-size:18px;line-height:1;width:32px;height:32px; }\n' +
  '.wallet-btn-header { display:inline-flex;align-items:center; }\n' +
  '.wallet-btn-header a.wallet-login-btn,.wallet-btn-header a.wallet-logged-in-btn { align-items:center;gap:6px;padding:6px 18px;font-size:12px;font-weight:600;border-radius:30px;background:#ff6000;color:#fff;text-decoration:none;white-space:nowrap;letter-spacing:0.5px;transition:background 0.2s;border:none;box-shadow:none;line-height:1.4; }\n' +
  '.wallet-btn-header a:hover { background:#e55500 !important; }\n' +
  '@media (max-width: 991px) {\n' +
  '    .wallet-btn-header { display:none !important; }\n' +
  '    .main-header .header-upper { padding:8px 0 !important; }\n' +
  '    .header-upper .inner { display:flex !important;align-items:center;justify-content:space-between;flex-wrap:nowrap; }\n' +
  '    .header-upper .logo-box { flex-shrink:0; }\n' +
  '    .header-upper .nav-content { float:none !important;width:auto !important;flex:none !important;order:3; }\n' +
  '    .header-upper .other-links { display:flex !important;align-items:center;gap:8px;flex-shrink:0;order:2;margin-left:auto; }\n' +
  '    .nav-outer .mobile-nav-toggler { margin:0 !important;padding:8px 0 !important;float:none !important; }\n' +
  '}\n' +
  '.mobile-menu .wallet-mobile-btn a {\n' +
  '    display:block;text-align:center;padding:14px 20px;border-radius:30px;\n' +
  '    background:#ff6000;color:#fff;font-size:14px;font-weight:600;\n' +
  '    text-decoration:none;letter-spacing:0.5px;transition:background 0.2s;\n' +
  '}\n' +
  '.mobile-menu .wallet-mobile-btn a:hover { background:#e55500; }\n' +
  '</style>';

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
    headerStyles + '\n' +
    header5 + '\n' +
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
